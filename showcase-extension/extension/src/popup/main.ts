import { setText } from '../dashboard/dom.js'
import type { ResponseMap } from '../messaging/schema.js'

declare const __ADAPTER_MODE__: 'mock' | 'live'

const requireElement = (id: string): HTMLElement => {
  const el = document.getElementById(id)
  if (el === null) throw new Error(`missing element: ${id}`)
  return el
}

// §10: ปิด popup ไม่ใช่ cancel — งานอยู่ที่ worker ไม่ใช่ popup
requireElement('open-dashboard').addEventListener('click', () => {
  chrome.runtime.openOptionsPage()
})

// เหตุผลเดียวกับ dashboard/main.ts renderChannelBanner — HTML มีข้อความของ mock channel เป็น
// ค่าเริ่มต้น (E2E ตรวจคำว่า MOCK-ONLY อยู่) live channel ต้องไม่โฆษณาตัวเองว่า mock เพราะมันยิง
// TikTok จริงได้เมื่อผู้ใช้กดเอง — popup เคยไม่มีโค้ดนี้เลย จึงค้างข้อความ mock ไว้ตลอดแม้รัน live build
function renderChannelBanner(): void {
  if (__ADAPTER_MODE__ !== 'live') return
  setText(
    requireElement('channel-banner'),
    'LIVE TRIAL BUILD — ทดลองอ่านหนึ่งหน้าด้วยการกดเองเท่านั้น · full scan ยังปิดอยู่',
  )
}

const statusDot = requireElement('status-dot')
const statusText = requireElement('status')

function setStatus(dotState: 'idle' | 'running' | 'finished', text: string): void {
  statusDot.className = `status-dot status-dot-${dotState}`
  setText(statusText, text)
}

// เดิม popup อ่านจาก message `status.get` ซึ่ง handler ใน messaging/handle.ts คืนค่า
// hardcode ตายตัวว่า state: 'idle' เสมอ (ของเหลือจากช่วง M1.1 ก่อนมี state machine จริงของ run.*) —
// จึงค้างคำว่า "idle" ไว้ตลอดไม่ว่าจะกำลังสแกนอยู่จริงหรือไม่ ต้องใช้ `run.status` เหมือน dashboard
// ที่ต่อกับสถานะจริงถูกต้อง (idle/running/finished ตามข้อมูลจริงใน checkpoint store)
void (async (): Promise<void> => {
  const response = (await chrome.runtime.sendMessage({ type: 'run.status' })) as ResponseMap['run.status']

  if (!response.ok) {
    setStatus('idle', `อ่านสถานะไม่ได้: ${response.code}`)
    return
  }

  if (response.phase === 'running') {
    const staged = response.resume?.kind === 'running' ? response.resume.productCount : 0
    setStatus('running', `กำลังสแกน… เก็บแล้ว ${String(staged)} รายการ`)
    return
  }

  if (response.phase === 'finished' && response.report !== null) {
    const { report } = response
    const coverageNote = report.scanCoverage === 'reached_endpoint_end' ? '' : ' (ไม่ครบ)'
    setStatus('finished', `สแกนล่าสุด: ${String(report.counters.uniqueValidProducts)} รายการ${coverageNote}`)
    return
  }

  if (response.resume?.kind === 'interrupted') {
    setStatus(
      'idle',
      `การสแกนก่อนหน้าถูกขัดจังหวะ — มีสินค้า staged แล้ว ${String(response.resume.productCount)} รายการ`,
    )
    return
  }

  setStatus('idle', 'พร้อมสแกน')
})()

renderChannelBanner()
