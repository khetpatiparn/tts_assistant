import type { ResponseMap } from '../messaging/schema.js'
import { setText } from '../dashboard/dom.js'

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

// HTML มีข้อความของ mock channel เป็นค่าเริ่มต้น (E2E ตรวจคำว่า MOCK-ONLY อยู่) — live build ซ่อนป้าย
// ทิ้งทั้งอัน: ข้อความ "LIVE TRIAL BUILD … full scan ยังปิดอยู่" ที่เคยใส่ไว้ตรงนี้ผิดความจริง (full scan
// ใช้งานจริงแล้ว) และผู้ใช้ถามว่าคืออะไร (2026-09-29) — ป้ายที่ต้องอธิบายคือป้ายที่ไม่ควรมี
function renderChannelBanner(): void {
  if (__ADAPTER_MODE__ !== 'live') return
  requireElement('channel-banner').hidden = true
}

const statusCard = requireElement('status-card')
const statusDot = requireElement('status-dot')
const statusText = requireElement('status')

// การ์ดสถานะโชว์เฉพาะตอนมีเรื่องให้รู้/ทำ (กำลังสแกน · ค้างกลางทาง · อ่านสถานะไม่ได้) — ตอนว่างหรือสแกน
// เสร็จแล้วซ่อน เพราะ "สแกนล่าสุด: 201 รายการ" ผู้ใช้บอกว่าไม่มีประโยชน์ (ผลสแกนดูที่หน้าจัดการ/แอปหลัก)
// data-phase ตั้งทุกกรณี ให้ E2E ยืนยันได้ว่าคุยกับ service worker สำเร็จแม้การ์ดจะซ่อน
function setPhase(phase: 'idle' | 'running' | 'finished' | 'error'): void {
  statusCard.dataset.phase = phase
}

function showStatus(dotState: 'idle' | 'running', text: string): void {
  statusDot.className = `status-dot status-dot-${dotState}`
  setText(statusText, text)
  statusCard.hidden = false
}

// ใช้ `run.status` (สถานะจริงใน checkpoint store) ไม่ใช่ `status.get` ที่ hardcode 'idle' ไว้ตายตัว
void (async (): Promise<void> => {
  const response = (await chrome.runtime.sendMessage({ type: 'run.status' })) as ResponseMap['run.status']

  if (!response.ok) {
    setPhase('error')
    showStatus('idle', `อ่านสถานะไม่ได้: ${response.code}`)
    return
  }

  if (response.phase === 'running') {
    setPhase('running')
    const staged = response.resume?.kind === 'running' ? response.resume.productCount : 0
    showStatus('running', `กำลังสแกน… เก็บแล้ว ${String(staged)} รายการ`)
    return
  }

  if (response.resume?.kind === 'interrupted') {
    setPhase('idle')
    showStatus(
      'idle',
      `การสแกนก่อนหน้าค้างกลางทาง (เก็บไว้ ${String(response.resume.productCount)} รายการ) — ดูที่หน้าจัดการ`,
    )
    return
  }

  setPhase(response.phase === 'finished' ? 'finished' : 'idle')
})()

renderChannelBanner()
