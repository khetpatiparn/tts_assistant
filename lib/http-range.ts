/**
 * อ่าน header `Range: bytes=...` แบบช่วงเดียว (pure — ทดสอบด้วย scripts/check-flow-jobs.mjs)
 * ใช้ใน app/api/uploads/[...path]/route.ts ให้ <video> เลื่อนดูคลิปได้ — Chrome ไม่ยอม seek ถ้าเซิร์ฟเวอร์
 * ไม่ตอบ 206 · หลายช่วง (bytes=0-1,5-9) ไม่รองรับ ตอบทั้งไฟล์แทน (ตามที่ RFC 9110 อนุญาต)
 *
 * @returns null = ไม่มี Range/อ่านไม่ออก → ตอบทั้งไฟล์ · "unsatisfiable" = ช่วงเลยท้ายไฟล์ → 416
 */
export function parseByteRange(header: string | null, size: number): { start: number; end: number } | "unsatisfiable" | null {
  if (header === null) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (m === null || (m[1] === "" && m[2] === "")) return null;
  if (m[1] === "") {
    // bytes=-N = N ไบต์สุดท้าย
    const suffix = Number(m[2]);
    if (suffix === 0) return "unsatisfiable";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(m[1]);
  if (start >= size) return "unsatisfiable";
  const end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (end < start) return null;
  return { start, end };
}
