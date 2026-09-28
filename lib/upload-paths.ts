import path from "node:path";

// Turbopack วิเคราะห์ path ที่สร้างจาก process.cwd() ตอน build แล้วลากไฟล์ใน uploads/ ทั้งโฟลเดอร์
// (~18,000 ไฟล์) เข้า trace ของทุก route ที่ import actions — build ช้าและขึ้น warning
// "Overly broad patterns" ทุกครั้ง · ไฟล์เหล่านี้เป็นข้อมูลที่ผู้ใช้อัปตอนรันจริง ไม่ใช่ของที่ต้อง bundle
export const UPLOAD_ROOT = path.join(/* turbopackIgnore: true */ process.cwd(), "uploads");
export const CANDIDATE_IMAGE_ROOT = path.join(UPLOAD_ROOT, "_candidates");

// ใช้ต่อ path ที่มีชื่อไฟล์แบบ `${uuid}.${ext}` — ถ้าต่อตรงในที่เรียก writeFile/copyFile จุด "." ใน
// template string ทำให้ Turbopack สร้าง pattern ที่ไล่ทั้งโปรเจกต์ (~30,000 ไฟล์) ผ่านฟังก์ชันนี้แล้วเป็นค่าทึบ
export function joinPath(...segments: string[]): string {
  return path.join(...segments);
}
