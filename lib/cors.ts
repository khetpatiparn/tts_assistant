/**
 * ใช้เฉพาะ 2 endpoint ของ showcase-extension (`/api/showcase-import` POST และ
 * `/api/showcase-import/known-ids` GET) — หน้า dashboard ของ extension (origin
 * `chrome-extension://<id>`) เป็นคนละ origin จาก `localhost:3000` เสมอ browser จึงบังคับ CORS
 * เต็มรูปแบบกับ fetch จากหน้านั้น **แม้จะมี host permission ที่ manifest ประกาศไว้แล้วก็ตาม** —
 * host permission ควบคุมแค่ว่า extension "ยิง request ได้ไหม" ไม่ได้ยกเว้น CORS ของฝั่ง response
 * เลย (ยืนยันสดจริง 2026-09-24: ปุ่ม "ส่งเข้าระบบเลย" พังด้วย error ตรงตัว "No
 * 'Access-Control-Allow-Origin' header is present" ทั้งที่ permission ถูก grant แล้ว — เข้าใจผิด
 * มาก่อนว่า permission พอแล้ว)
 *
 * ใช้ `*` เพราะไม่มี credential/cookie เกี่ยวข้องกับสอง endpoint นี้เลย (การยืนยันตัวตนของ POST คือ
 * header `x-showcase-secret` เทียบกับ `SHOWCASE_IMPORT_SECRET` ไม่ใช่ cookie/session) การอนุญาต
 * origin กว้างตรงนี้จึงไม่ได้ลดความปลอดภัยของ secret check ที่ POST ยังบังคับผ่านอยู่เหมือนเดิม —
 * ผู้โจมตีที่ไม่รู้ secret ยังยิงผ่านไม่ได้แม้ preflight จะผ่านก็ตาม
 */
export const SHOWCASE_CORS_HEADERS: Readonly<Record<string, string>> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-showcase-secret",
};
