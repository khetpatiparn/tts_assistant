/**
 * ใช้กับ `/api/scanner` (ลิงก์ปลายทางของ Showcase Scanner) เท่านั้น — หน้า dashboard ของ extension
 * (origin `chrome-extension://<id>`) เป็นคนละ origin จาก localhost เสมอ browser จึงบังคับ CORS กับ response
 * เสมอ (extension ไม่ขอ permission ของ localhost) · ใช้ `*` ได้เพราะไม่มี cookie/credential เกี่ยวข้อง — การยืนยันตัวตนคือ token ใน query
 * ที่ route เทียบกับแถว ScannerLink ทุก request (ผู้ไม่รู้ token ยังยิงผ่านไม่ได้แม้ preflight จะผ่าน)
 */
export const SHOWCASE_CORS_HEADERS: Readonly<Record<string, string>> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};
