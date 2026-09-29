import { resolveAdapter } from '#adapter'
import { ScannerError } from './domain/errors.js'
import { handleMessage } from './messaging/handle.js'
import { validateMessage } from './messaging/validate.js'
import { openCheckpointStore } from './storage/checkpoints.js'
import type { AdapterPurpose } from './adapters/types.js'
import type { ProbeRegistry, RunRegistry } from './messaging/handle.js'
import type { ScannerMessageType, ScannerResponse } from './messaging/schema.js'

/** §2.2 — หนึ่งบัญชีต่อ browser profile; ยังไม่มี UI ตั้งค่าใน M1 จึงคงที่ไว้ก่อน */
const SOURCE_REF = 'local-profile-01'
const STORE_NAME = 'showcase-scanner-checkpoints'

// เริ่มเปิด IndexedDB ทันทีตอน module โหลด ไม่รอ message แรก — ไม่ block การลงทะเบียน listener
// เพราะเก็บไว้เป็น promise แล้ว await ทีหลังในนี้
const storePromise = openCheckpointStore(STORE_NAME)

// registry อยู่ในหน่วยความจำเท่านั้น หายได้ถ้า service worker ถูกหยุด — ข้อมูลจริงอยู่ IndexedDB
// เสมอ (ดู messaging/handle.ts และ dashboard/resume.ts ที่ชดเชยกรณีนี้)
const registry: RunRegistry = { currentController: null, currentReport: null }

// กันกดซ้อน: probe หนึ่งครั้งต่อหนึ่ง service worker ณ เวลาหนึ่ง (ครอบทุกแท็บ ไม่ใช่แค่ปุ่มที่ disable)
const probeRegistry: ProbeRegistry = { inFlight: false }

/**
 * จะ resolve adapter ด้วยเจตนาอะไร — ขึ้นกับชนิดของ message ไม่ใช่ค่าคงที่ค่าเดียว
 * message ที่ไม่ต้องอ่านข้อมูลจริงใช้ `metadata_only` เพื่อให้ dashboard ของ live build
 * ใช้ส่วนที่ไม่แตะ network ได้ตามปกติ แทนที่จะพังทั้งหน้าเพราะ gate ของ full scan
 */
const PURPOSE_BY_TYPE: Partial<Record<ScannerMessageType, AdapterPurpose>> = {
  'adapter.probe': 'manual_probe',
  // `manual_scan` ไม่ใช่ `full_scan` — อ่านข้อมูลชุดเดียวกันแต่ยืนอยู่บนการอนุญาตของเจ้าของโปรเจกต์
  // บนบัญชีตนเองเท่านั้น ไม่ใช่ `G0_VERIFIED` ซึ่งยังรอการอนุญาตจาก TikTok (ดู domain/version.ts)
  'run.start': 'manual_scan',
}

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new DOMException('aborted', 'AbortError'))
      },
      { once: true },
    )
  })

// ลงทะเบียน listener แบบ synchronous ที่ top level — MV3 จะทิ้ง listener ที่ผูกหลัง await
// เมื่อ service worker ถูกปลุกใหม่ (spec §10)
// ติดตั้งครั้งแรก → เปิดหน้า "วิธีใช้" ให้เลย (ไม่ใช่ตอนอัปเดต/รีโหลด) — ผู้ใช้จริงติดตั้งจาก zip แล้วไม่รู้ว่า
// ต้องทำอะไรต่อ เพราะคู่มือเป็นไฟล์ .md ในโฟลเดอร์ที่ไม่มีใครเปิด (2026-09-29) · tabs.create ไม่ต้องขอสิทธิ์ "tabs"
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason !== 'install') return
  void chrome.tabs.create({ url: chrome.runtime.getURL('help/index.html') })
})

chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
  void (async (): Promise<void> => {
    let response: ScannerResponse
    try {
      const message = validateMessage(raw, { id: sender.id, url: sender.url }, chrome.runtime.id)
      const store = await storePromise
      // resolveAdapter() ต้องเรียกในนี้ ไม่ใช่ top level: release channel โยน
      // live_adapter_not_implemented และห้ามทำให้ทั้ง module พังตอนโหลด (G0 ยังไม่ผ่าน)
      response = await handleMessage(message, {
        adapter: resolveAdapter(PURPOSE_BY_TYPE[message.type] ?? 'metadata_only'),
        store,
        sourceRef: SOURCE_REF,
        registry,
        probeRegistry,
        now: () => Date.now(),
        sleep,
      })
    } catch (error) {
      response = { ok: false, code: error instanceof ScannerError ? error.code : 'msg_malformed' }
    }
    sendResponse(response)
  })()
  return true
})
