import type { ResponseMap } from '../messaging/schema.js'
import { checkDestination, relativeDaysThai, requestAutoScan, type DestinationStatus } from '../dashboard/destination.js'
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

// ---------- การเชื่อมต่อปลายทาง — สิ่งที่ผู้ใช้อยากรู้ก่อนกดสแกน (2026-09-29) ----------
//
// เขียว = พร้อม กดสแกนแล้วส่งได้เลย · แดง = ติดต่อปลายทางไม่ได้/ลิงก์ใช้ไม่ได้ · เทา = ยังไม่ได้ใส่ลิงก์
// หรือปลายทางไม่บอกสถานะ — ปุ่มสแกนเปิดเฉพาะตอนส่งได้ เพราะสแกนจบแล้วไปรู้ตอนส่งว่าส่งไม่ได้
// คือเสียเวลาทั้งรอบ

const appDot = requireElement('app-dot')
const appTitle = requireElement('app-title')
const appDetail = requireElement('app-detail')
const scanPushButton = requireElement('scan-push') as HTMLButtonElement

let appReady = false
let scanRunning = false

function refreshScanButton(): void {
  scanPushButton.disabled = !appReady || scanRunning
}

function renderConnection(status: DestinationStatus): void {
  const now = Date.now()
  const [tone, title, detail, canScan] = ((): ['ok' | 'bad' | 'idle', string, string, boolean] => {
    switch (status.kind) {
      case 'ready':
        return ['ok', 'เชื่อมต่อปลายทางแล้ว',
          `${String(status.productCount)} สินค้าที่ปลายทาง` +
            (status.lastReceivedAt === null ? '' : ` · รับล่าสุด ${relativeDaysThai(status.lastReceivedAt, now)}`),
          true]
      case 'no_status':
        return ['idle', 'ปลายทางไม่ได้บอกสถานะ — ส่งได้ตามปกติ',
          status.lastDeliveredAt === null ? 'ยังไม่เคยส่ง' : `ส่งสำเร็จล่าสุด ${relativeDaysThai(status.lastDeliveredAt, now)}`,
          true]
      case 'unreachable':
        return ['bad', 'ติดต่อปลายทางไม่ได้', 'เปิดระบบปลายทางของคุณให้ทำงานอยู่ แล้วกดไอคอนนี้ใหม่', false]
      case 'rejected':
        return ['bad', 'ลิงก์ปลายทางใช้ไม่ได้แล้ว', 'อาจถูกสร้างลิงก์ใหม่ — คัดลอกลิงก์ล่าสุดมาใส่ในหน้าจัดการ', false]
      case 'no_link':
        return ['idle', 'ยังไม่ได้ใส่ลิงก์ปลายทาง', 'เปิดหน้าจัดการ → ตั้งค่า → วางลิงก์ (ทำครั้งเดียว)', false]
    }
  })()
  appDot.className = `status-dot status-dot-${tone === 'ok' ? 'finished' : tone === 'bad' ? 'bad' : 'idle'}`
  setText(appTitle, title)
  setText(appDetail, detail)
  appReady = canScan
  refreshScanButton()
}

scanPushButton.addEventListener('click', () => {
  // สแกน+ส่งทำในหน้าจัดการ ไม่ใช่ใน popup — popup ปิดทันทีที่คลิกที่อื่น งานจะขาดกลางทาง · เปิดแท็บใหม่
  // เสมอ (ไม่ใช้ openOptionsPage ที่แค่โฟกัสแท็บเดิมถ้าเปิดค้างไว้ — แท็บเดิมไม่โหลดใหม่ จึงไม่เห็นคำสั่ง)
  void (async () => {
    await requestAutoScan()
    await chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/index.html') })
    window.close()
  })()
})

// ---------- สถานะการสแกน ----------

const statusCard = requireElement('status-card')
const statusDot = requireElement('status-dot')
const statusText = requireElement('status')

// การ์ดสถานะโชว์เฉพาะตอนมีเรื่องให้รู้/ทำ (กำลังสแกน · ค้างกลางทาง · อ่านสถานะไม่ได้) — ตอนว่างหรือสแกน
// เสร็จแล้วซ่อน เพราะ "สแกนล่าสุด: 201 รายการ" ผู้ใช้บอกว่าไม่มีประโยชน์ (ผลสแกนดูที่หน้าจัดการ)
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
async function renderScanStatus(): Promise<void> {
  const response = (await chrome.runtime.sendMessage({ type: 'run.status' })) as ResponseMap['run.status']

  if (!response.ok) {
    setPhase('error')
    showStatus('idle', `อ่านสถานะไม่ได้: ${response.code}`)
    return
  }

  if (response.phase === 'running') {
    setPhase('running')
    scanRunning = true
    refreshScanButton()
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
}

renderChannelBanner()
void renderScanStatus()
void checkDestination().then(renderConnection)
setText(requireElement('version'), `เวอร์ชัน ${chrome.runtime.getManifest().version}`)
