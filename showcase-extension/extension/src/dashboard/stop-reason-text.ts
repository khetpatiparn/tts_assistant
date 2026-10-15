import type { StopReason } from '../core/runner.js'

/**
 * เหตุผลที่สแกนหยุด เป็นภาษาคน + บอกว่าต้องทำอะไรต่อ — หน้าจัดการเคยโชว์ค่า enum ดิบ (`page_limit_reached`)
 * ผู้ใช้จริงอ่านไม่ออกว่าต้องทำอะไร (2026-09-29) · ค่าดิบยังอยู่ในส่วน "รายละเอียดสำหรับนักพัฒนา"
 *
 * `Record<StopReason, …>` ทำให้ tsc บังคับให้เพิ่มข้อความทุกครั้งที่มีเหตุผลใหม่ใน runner.ts
 */
const RETRY_LATER = 'กด "เริ่มสแกน" อีกครั้ง'
const REPORT_IT =
  'ลองสแกนใหม่อีกครั้ง ถ้ายังเป็นอีกให้ส่งภาพหน้าจอนี้ (กางส่วน "รายละเอียดสำหรับนักพัฒนา" ด้วย) ให้คนดูแล extension'

const TEXT: Record<StopReason, string> = {
  endpoint_end: 'สแกนครบทุกหน้าแล้ว',
  known_ids_reached: 'หยุดเองเพราะเจอหน้าที่มีแต่สินค้าที่เคยส่งไปแล้ว',
  page_limit_reached: 'หยุดตามจำนวนหน้าที่ตั้งไว้ในส่วน "ตั้งค่า" — อยากสแกนต่อให้กด "ทั้งหมด" แล้วสแกนใหม่',
  cancelled: 'คุณกดยกเลิกเอง',
  auth_required: 'TikTok ให้ล็อกอินใหม่ — เปิด shop.tiktok.com ในเบราว์เซอร์นี้ ล็อกอินให้เรียบร้อย แล้ว' + RETRY_LATER,
  challenge_required:
    'TikTok ขอให้ยืนยันตัวตน (เช่น CAPTCHA) — เปิด shop.tiktok.com ในเบราว์เซอร์นี้ ทำตามที่ขึ้นมา แล้ว' + RETRY_LATER,
  permission_required: 'extension ยังไม่ได้สิทธิ์เข้า shop.tiktok.com — ถอดแล้วติดตั้ง extension ใหม่',
  access_denied: 'TikTok ไม่ให้เข้าถึง Showcase นี้ — เช็กว่าล็อกอินบัญชีที่ถูกต้องอยู่ แล้ว' + RETRY_LATER,
  identity_changed: 'บัญชี TikTok เปลี่ยนระหว่างสแกน — ใช้บัญชีเดียวตลอดรอบ แล้ว' + RETRY_LATER,
  rate_limited: 'TikTok ขอให้ช้าลง — รอสักพักแล้ว' + RETRY_LATER,
  transport_error: 'เชื่อมต่อ TikTok ไม่ได้ (เน็ตหลุด?) — เช็กอินเทอร์เน็ตแล้ว' + RETRY_LATER,
  run_already_active: 'มีการสแกนอื่นทำงานอยู่ (อาจอยู่อีกแท็บ) — รอให้จบก่อน',
  time_limit_reached: 'สแกนนานเกินขีดจำกัดของรอบเดียว — ' + RETRY_LATER,
  request_limit_reached: 'อ่านหน้าเยอะเกินขีดจำกัดของรอบเดียว — ' + RETRY_LATER,
  product_limit_reached: 'สินค้าเยอะเกินขีดจำกัดของรอบเดียว — ' + RETRY_LATER,
  staging_limit_reached: 'พื้นที่เก็บผลสแกนเต็ม — กด "ล้างข้อมูลที่เก็บไว้" ในส่วนตั้งค่า แล้ว' + RETRY_LATER,
  storage_error: 'บันทึกผลสแกนในเบราว์เซอร์ไม่ได้ — ' + REPORT_IT,
  pagination_stalled: 'TikTok ส่งหน้าเดิมซ้ำ — ' + REPORT_IT,
  pagination_conflict: 'จำนวนสินค้าที่ TikTok บอกเปลี่ยนกลางทาง — ' + REPORT_IT,
  schema_changed: 'TikTok ตอบกลับมาในรูปแบบที่ไม่เหมือนเดิม — ' + REPORT_IT,
  business_error: 'TikTok ตอบกลับมาว่ามีข้อผิดพลาด — ' + REPORT_IT,
  body_too_large: 'ข้อมูลที่ TikTok ส่งมาใหญ่ผิดปกติ — ' + REPORT_IT,
  redirect_blocked: 'TikTok พาไปหน้าอื่นที่ไม่ใช่ข้อมูลสินค้า — ' + REPORT_IT,
}

export const stopReasonText = (reason: StopReason): string => TEXT[reason]
