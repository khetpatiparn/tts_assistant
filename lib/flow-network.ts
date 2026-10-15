/**
 * เน็ตสะดุดชั่วคราว (เครื่องเราเอง ไม่ใช่ Google) จากข้อความ error ของ Chrome — pure ไม่มี import เลย เพราะใช้ทั้ง
 * worker/flow-signals.ts (ลองเปิดหน้าใหม่ตอน goto) · lib/flow-lifecycle.ts (นโยบายข้ามงาน) · หน้า /flow (หมายเหตุใต้งานที่พัง
 * ตัดสินจาก errorMessage ที่เก็บไว้) — รายการรหัสอยู่ที่เดียว ตัวที่ลองซ้ำกับตัวที่ข้ามงานจึงเห็นตรงกันเสมอ
 *
 * เคสจริง 2026-10-05: net::ERR_NETWORK_CHANGED ตอนเปิดโปรเจกต์ถูกตีเป็น worker_crash แล้วหยุดทั้งคิวเป็นชั่วโมง
 * รับเฉพาะรหัส net:: ที่แปลว่า "เน็ตหาย/เปลี่ยน/หลุดกลางทาง" (รวม ERR_TIMED_OUT / ERR_CONNECTION_TIMED_OUT) + page.goto โหลด
 * ไม่ทัน (ด้านล่าง) · **ไม่นับ** (ลองซ้ำแล้วไม่หาย หรือไม่ใช่เน็ต): ERR_BLOCKED_*, ERR_CERT_*, ERR_ABORTED (การนำทางถูกยกเลิก),
 * ERR_ACCESS_DENIED / ERR_NETWORK_ACCESS_DENIED (ไฟร์วอลล์/แอนติไวรัสบล็อก), ERR_HTTP2_PROTOCOL_ERROR (โปรโตคอลพัง),
 * ERR_TOO_MANY_REDIRECTS และ timeout ของการรอ/หาปุ่ม (locator, waitFor)
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
  "ERR_TIMED_OUT",
  "ERR_EMPTY_RESPONSE",
  "ERR_SOCKET_NOT_CONNECTED",
];

/**
 * โหลดหน้าไม่ทัน (page.goto Timeout) — เคสจริง 2026-10-06: Flow ตอบโครงหน้ามาแต่แอปไม่วาดภายใน 45 วิ (จอดำ)
 * ยังไม่ได้ถึงขั้นหาปุ่ม จึงไม่ใช่ selector_drift · ทำเหมือนเน็ตสะดุด: ลองใหม่ แล้วข้ามงานถ้ายังไม่ผ่าน
 * เฉพาะ "page.goto" เท่านั้น — timeout ของการรอ/หาปุ่ม (locator, waitFor) ยังเป็นสัญญาณหน้าเปลี่ยนตามเดิม
 */
const PAGE_LOAD_TIMEOUT_MARKER = "page.goto: Timeout";

/**
 * ขอบเขตของกฎเน็ตสะดุดทั้งชุด (บอทลองเปิดหน้าซ้ำ · step() ตี goto timeout เป็น worker_crash · นโยบายข้ามงาน) — **ขั้น open-flow
 * ของรอบ 1–3 เท่านั้น** · รอบ 4 (โหลด 1080p, fetchFinalClip) คงพฤติกรรมเดิม: goto ครั้งเดียว ไม่ลองซ้ำ goto timeout = selector_drift
 * (มีทางจบด้วย 720p ของตัวเองใน roundFailed) · ขั้นอื่นไม่ได้ goto เอง จึงไม่มี error ของการเปิดหน้า
 */
export function isNetworkRetryStep(step: string, round: number): boolean {
  return step === "open-flow" && round !== 4;
}

export function isTransientNetworkMessage(message: string): boolean {
  return message.includes(PAGE_LOAD_TIMEOUT_MARKER) || TRANSIENT_NET_CODES.some((code) => message.includes(`net::${code}`));
}
