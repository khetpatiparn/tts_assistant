import { FlowAError } from '../domain/errors.js'
import { SHOWCASE_HOST_PERMISSION_ORIGIN } from '../domain/permissions.js'
import {
  ADAPTER_VERSION_LIVE,
  G0_TECHNICAL_EVIDENCE_COMPLETE,
  G0_VERIFIED,
  OWNER_MANUAL_PROBE_AUTHORIZED,
  OWNER_MANUAL_SCAN_AUTHORIZED,
} from '../domain/version.js'
import { createLiveShowcaseAdapter } from './live-showcase.js'
import { createFetchTransport } from './live-transport.js'
import type { AdapterPurpose, ShowcaseAdapter } from './types.js'

/**
 * เช็คอย่างเดียว — ไม่เคยเรียก `chrome.permissions.request` จากไฟล์นี้หรือที่ใดใน background
 * (PK02 มี static check บน release bundle ยืนยันไว้แล้วว่า background.js ต้องไม่มี
 * `permissions.request` เลย) การขอสิทธิ์ต้องมาจาก user gesture ในหน้า dashboard เท่านั้น
 */
const hasHostPermission = (): Promise<boolean> =>
  chrome.permissions.contains({ origins: [SHOWCASE_HOST_PERMISSION_ORIGIN] })

/**
 * adapter ที่บอกได้แค่ว่าเป็น channel ไหน/เวอร์ชันอะไร แต่ยิง request ไม่ได้เลย
 * ใช้กับ message ที่ไม่ต้องอ่านข้อมูลจริง (app.info, status.get, run.status, run.export,
 * data.clear) เพื่อให้ dashboard ของ live build ใช้งานส่วนที่ไม่แตะ network ได้ตามปกติ
 */
const metadataOnlyAdapter = (): ShowcaseAdapter => ({
  adapterVersion: ADAPTER_VERSION_LIVE,
  mode: 'live',
  fetchPage: () => Promise.reject(new FlowAError('g0_not_verified')),
})

/**
 * Release channel — gate แยกตาม "จะเอา adapter ไปทำอะไร" ไม่ใช่ค่าเดียวคุมทุกอย่าง
 * (ดูเหตุผลและนิยามของค่าทั้งสามใน extension/src/domain/version.ts)
 *
 * | purpose         | เงื่อนไข                                                        | สถานะตอนนี้ |
 * |-----------------|-----------------------------------------------------------------|-------------|
 * | `metadata_only` | ไม่มีเงื่อนไข (ยิง request ไม่ได้อยู่แล้ว)                        | ใช้ได้      |
 * | `manual_probe`  | หลักฐานเทคนิคครบ **และ** เจ้าของอนุญาตทดลองหนึ่งหน้า              | ใช้ได้      |
 * | `manual_scan`   | หลักฐานเทคนิคครบ **และ** เจ้าของอนุญาตทดลองหลายหน้า               | ใช้ได้      |
 * | `full_scan`     | `G0_VERIFIED` (รวมการอนุญาตจาก TikTok ด้วย)                      | **ถูกปฏิเสธ** |
 *
 * การอนุญาตของ `manual_probe` กับ `manual_scan` เป็นคนละค่ากัน ปิดทีละอันได้โดยไม่กระทบกัน
 *
 * ไม่มี runtime override/debug switch ใด ๆ ที่ข้ามเช็คนี้ได้ — ทุกค่าเป็น compile-time constant
 * ที่แก้ได้เฉพาะตอน commit โค้ด ไม่มี query string, storage key หรือ message ใดเปลี่ยนได้ตอน runtime
 */
export function resolveAdapter(purpose: AdapterPurpose = 'full_scan'): ShowcaseAdapter {
  if (purpose === 'metadata_only') return metadataOnlyAdapter()

  if (purpose === 'full_scan') {
    // full scan ยังต้องรอ G0 ครบทุกด้าน รวมถึงการอนุญาตจาก TikTok ที่ยังไม่มี
    if (!G0_VERIFIED) throw new FlowAError('g0_not_verified')
  } else {
    // manual_probe / manual_scan — ทั้งคู่ต้องมีหลักฐานเทคนิคครบก่อนเสมอ
    if (!G0_TECHNICAL_EVIDENCE_COMPLETE) throw new FlowAError('g0_not_verified')
    if (purpose === 'manual_scan') {
      // ทดลองหลายหน้าจนจบที่ผู้ใช้กดเอง
      if (!OWNER_MANUAL_SCAN_AUTHORIZED) throw new FlowAError('manual_scan_not_authorized')
    } else {
      // ทดลองหนึ่งหน้าที่ผู้ใช้กดเอง (spec §14.1)
      if (!OWNER_MANUAL_PROBE_AUTHORIZED) throw new FlowAError('manual_probe_not_authorized')
    }
  }

  const transport = createFetchTransport()
  return createLiveShowcaseAdapter({ transport, hasHostPermission })
}
