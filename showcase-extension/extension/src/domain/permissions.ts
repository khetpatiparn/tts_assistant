/**
 * ต้องตรงกับ `optional_host_permissions` ใน extension/manifest.json เป๊ะ — เป็น source of truth
 * เดียวที่ resolve.live.ts (เช็คก่อนยิง request จริง) และ dashboard (ปุ่มขอสิทธิ์จาก user gesture)
 * ใช้ร่วมกัน กันไม่ให้ค่าต่างกันโดยไม่ตั้งใจระหว่างสองที่ (§7.1 — ไม่เพิ่มสิทธิ์เกิน spec)
 *
 * ไฟล์นี้ไม่ import อะไรจาก adapters/ หรือ dashboard/ เลย — เป็น shared constant ล้วน ๆ
 * เพื่อให้ทั้งสอง build channel (mock/live) และทั้ง background/dashboard bundle ได้โดยไม่ผูกกัน
 */
export const SHOWCASE_HOST_PERMISSION_ORIGIN = 'https://shop.tiktok.com/*' as const

/**
 * แอปหลัก pooling_prompt เอง (localhost เสมอ รันโดย start.bat) — คนละความเสี่ยงกับ shop.tiktok.com
 * ด้านบนโดยสิ้นเชิง (ไม่ใช่ third-party, ไม่มีประเด็น ToS/rate-limit) แต่ยังเป็น optional permission
 * เหมือนกันเพื่อให้สอดคล้องกับรูปแบบเดิมของไฟล์นี้ (ขอสิทธิ์จาก user gesture ในหน้า dashboard เท่านั้น
 * ไม่มีอะไรถูกขอเองจากเบื้องหลัง) ใช้เพื่อดึงรายการ product ID ที่มีอยู่แล้วในระบบมาช่วยหยุดสแกนอัตโนมัติ
 * (ดู dashboard/main.ts และ core/runner.ts stopReason 'known_ids_reached')
 */
export const APP_HOST_PERMISSION_ORIGIN = 'http://localhost:3000/*' as const
