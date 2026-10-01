/**
 * ตรรกะ pure ของปุ่ม "ส่งเข้าโฟลเดอร์ TTS" — ห้าม import node:* (ทดสอบด้วย scripts/check-clip-export.mjs)
 * ส่วนที่แตะดิสก์อยู่ใน exportClipToFolder (app/actions.ts)
 */
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** เดือนอังกฤษ + "d-m-yy" (yy = ปี พ.ศ. 2 หลัก, ไม่เติม 0 นำหน้า) ตามวันที่ท้องถิ่นของ d */
export function exportDateParts(d: Date): { month: string; day: string } {
  const yy = (d.getFullYear() + 543) % 100;
  return { month: MONTHS[d.getMonth()], day: `${d.getDate()}-${d.getMonth() + 1}-${yy}` };
}

/** เลขลำดับถัดไปจากชื่อโฟลเดอร์ย่อย (รับเฉพาะโฟลเดอร์) — `1`, `2`, `1_xxx` นับหมด · ชื่อที่ไม่ขึ้นต้นด้วยเลขข้าม */
export function nextSlotNumber(existingDirNames: string[]): number {
  let max = 0;
  for (const name of existingDirNames) {
    const m = /^(\d+)/.exec(name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

const SHORT_NAME_MAX = 30;

/** ชื่อสั้นของโฟลเดอร์: ตัดอักขระต้องห้ามของ Windows + ขึ้นบรรทัดใหม่, ยุบช่องว่าง, ตัดที่ 30 ตัว, ว่าง = "clip" */
export function shortFolderName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // ตัดตาม code point ไม่ให้ผ่ากลาง surrogate pair
  const cut = Array.from(cleaned).slice(0, SHORT_NAME_MAX).join("").trim();
  // Windows ไม่รับชื่อที่ลงท้ายด้วยจุด
  const safe = cut.replace(/\.+$/, "");
  return safe === "" ? "clip" : safe;
}

export function slotFolderName(n: number, shortName: string): string {
  return `${n}_${shortName}`;
}

/** ข้อความโพสต์: ชื่อสินค้า / แคปชัน / แฮชแท็ก คั่นบรรทัดว่าง ข้ามส่วนที่ว่าง */
export function buildPostText(args: { productName: string; caption: string; hashtags: string }): string {
  return [args.productName, args.caption, args.hashtags]
    .map((s) => s.trim())
    .filter((s) => s !== "")
    .join("\n\n");
}
