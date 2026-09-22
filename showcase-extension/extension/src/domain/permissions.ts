/**
 * ต้องตรงกับ `optional_host_permissions` ใน extension/manifest.json เป๊ะ — เป็น source of truth
 * เดียวที่ resolve.live.ts (เช็คก่อนยิง request จริง) และ dashboard (ปุ่มขอสิทธิ์จาก user gesture)
 * ใช้ร่วมกัน กันไม่ให้ค่าต่างกันโดยไม่ตั้งใจระหว่างสองที่ (§7.1 — ไม่เพิ่มสิทธิ์เกิน spec)
 *
 * ไฟล์นี้ไม่ import อะไรจาก adapters/ หรือ dashboard/ เลย — เป็น shared constant ล้วน ๆ
 * เพื่อให้ทั้งสอง build channel (mock/live) และทั้ง background/dashboard bundle ได้โดยไม่ผูกกัน
 */
export const SHOWCASE_HOST_PERMISSION_ORIGIN = 'https://shop.tiktok.com/*' as const
