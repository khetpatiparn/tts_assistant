/**
 * เน็ตสะดุดชั่วคราว (เครื่องเราเอง ไม่ใช่ Google) จากข้อความ error ของ Chrome — pure ไม่มี import เลย เพราะใช้ทั้ง
 * worker/flow-signals.ts (ลองเปิดหน้าใหม่ตอน goto) · lib/flow-lifecycle.ts (นโยบายข้ามงาน) · หน้า /flow (หมายเหตุใต้งานที่พัง
 * ตัดสินจาก errorMessage ที่เก็บไว้) — รายการรหัสอยู่ที่เดียว ตัวที่ลองซ้ำกับตัวที่ข้ามงานจึงเห็นตรงกันเสมอ
 *
 * เคสจริง 2026-10-05: net::ERR_NETWORK_CHANGED ตอนเปิดโปรเจกต์ถูกตีเป็น worker_crash แล้วหยุดทั้งคิวเป็นชั่วโมง
 * รับเฉพาะรหัสที่แปลว่า "เน็ตหาย/เปลี่ยน" — ERR_BLOCKED_*, ERR_CERT_* และ timeout ไม่นับ (ลองซ้ำแล้วไม่หาย)
 */
const TRANSIENT_NET_CODES = [
  "ERR_NETWORK_CHANGED",
  "ERR_INTERNET_DISCONNECTED",
  "ERR_NAME_NOT_RESOLVED",
  "ERR_NETWORK_IO_SUSPENDED",
  "ERR_CONNECTION_RESET",
  "ERR_CONNECTION_CLOSED",
  "ERR_CONNECTION_TIMED_OUT",
  "ERR_CONNECTION_REFUSED",
  "ERR_ADDRESS_UNREACHABLE",
];

/**
 * โหลดหน้าไม่ทัน (page.goto Timeout) — เคสจริง 2026-10-06: Flow ตอบโครงหน้ามาแต่แอปไม่วาดภายใน 45 วิ (จอดำ)
 * ยังไม่ได้ถึงขั้นหาปุ่ม จึงไม่ใช่ selector_drift · ทำเหมือนเน็ตสะดุด: ลองใหม่ แล้วข้ามงานถ้ายังไม่ผ่าน
 * เฉพาะ "page.goto" เท่านั้น — timeout ของการรอ/หาปุ่ม (locator, waitFor) ยังเป็นสัญญาณหน้าเปลี่ยนตามเดิม
 */
const PAGE_LOAD_TIMEOUT_MARKER = "page.goto: Timeout";

export function isTransientNetworkMessage(message: string): boolean {
  return message.includes(PAGE_LOAD_TIMEOUT_MARKER) || TRANSIENT_NET_CODES.some((code) => message.includes(`net::${code}`));
}
