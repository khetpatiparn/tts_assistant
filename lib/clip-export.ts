/**
 * ตรรกะ pure ของปุ่ม "ส่งเข้าโฟลเดอร์ TTS" — ห้าม import node:* (ทดสอบด้วย scripts/check-clip-export.mjs)
 * ส่วนที่แตะดิสก์อยู่ใน lib/clip-export-fs.ts (exportClip) — server action exportClipToFolder แค่เรียกแล้วเปิด Explorer
 */
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

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
    // วงเล็บโปรของร้าน เช่น 【พร้อมฝา+ช้อน】 กินที่ชื่อโฟลเดอร์โดยไม่บอกว่าสินค้าคืออะไร
    .replace(/【[^】]*】/g, " ")
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

/**
 * ข้อความโพสต์: ชื่อสินค้า / แคปชัน / แฮชแท็ก คั่นบรรทัดว่าง ข้ามส่วนที่ว่าง · productId (เฉพาะสินค้าจาก Showcase)
 * ต่อท้ายเป็นบรรทัด "Product ID: …" ไว้ค้นตอนปักตะกร้า — ไม่มี/ว่าง = ไม่มีบรรทัด
 */
export function buildPostText(args: { productName: string; caption: string; hashtags: string; productId?: string | null }): string {
  const id = (args.productId ?? "").trim();
  return [args.productName, args.caption, args.hashtags, id === "" ? "" : `Product ID: ${id}`]
    .map((s) => s.trim())
    .filter((s) => s !== "")
    .join("\n\n");
}

/** ปุ่ม "คัดลอกแคปชัน + แฮชแท็ก" ที่ /flow = ข้อความโพสต์แบบเดียวกัน (คั่นบรรทัดว่าง ข้ามส่วนว่าง) แต่ไม่มีชื่อสินค้า/Product ID */
export function buildCaptionHashtagsText(args: { caption: string; hashtags: string }): string {
  return buildPostText({ productName: "", caption: args.caption, hashtags: args.hashtags });
}

/** ชื่อไฟล์รูปต้นทาง (รูปแคปที่ผู้ใช้ใส่ตอนเข้าคิว) ในโฟลเดอร์ TTS ของงานที่ทำต่อเอง · ext มีจุดนำหน้า เช่น ".png" */
export function sourcePhotoName(ext: string): string {
  return `รูปต้นทาง${ext}`;
}

// ---------------------------------------------------------------------------
// โฟลเดอร์ตามวันโพสต์: วันที่ใน <เดือน>\<d-m-yy> = วันที่จะโพสต์ ไม่ใช่วันที่กดส่ง
// ---------------------------------------------------------------------------

/** จำนวนคลิปต่อวันโพสต์ที่ใช้เมื่อไม่ได้ตั้งค่า (เป้าของผู้ใช้ 3–5 คลิป/วัน) */
export const DEFAULT_POSTS_PER_DAY = 4;
export const MIN_POSTS_PER_DAY = 1;
export const MAX_POSTS_PER_DAY = 20;

/** คลิปต่อวัน: จำนวนเต็ม 1–20 (รับข้อความตัวเลขด้วย) นอกนั้น = null */
export function parsePostsPerDay(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isInteger(n) && n >= MIN_POSTS_PER_DAY && n <= MAX_POSTS_PER_DAY ? n : null;
}

/** parsePostsPerDay แต่ค่าที่ใช้ไม่ได้ = ค่าเริ่มต้น 4 */
export function normalizePostsPerDay(value: unknown): number {
  return parsePostsPerDay(value) ?? DEFAULT_POSTS_PER_DAY;
}

/** เที่ยงคืนท้องถิ่นของพรุ่งนี้ — วันแรกที่คลิปที่ส่งวันนี้จะลงได้ */
export function tomorrowOf(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
}

/**
 * วันโพสต์ของคลิปที่กำลังจะส่ง: ไล่จาก tomorrow ไปข้างหน้า วันแรกที่มีโฟลเดอร์ย่อยน้อยกว่า perDay ชนะ
 * countsByDay = จำนวนโฟลเดอร์ย่อยที่มีอยู่จริงของแต่ละวัน key เป็นชื่อโฟลเดอร์วัน ("d-m-yy" จาก exportDateParts) —
 * นับรวมโฟลเดอร์ที่ผู้ใช้สร้างเอง · วันก่อน tomorrow ไม่เคยถูกพิจารณา (วันที่ผ่านไปแล้วไม่รับคลิปใหม่)
 */
export function pickPostingDay(countsByDay: Readonly<Record<string, number>>, tomorrow: Date, perDay: number): Date {
  for (let i = 0; i < 3660; i++) {
    const day = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate() + i);
    if ((countsByDay[exportDateParts(day).day] ?? 0) < perDay) return day;
  }
  // ไม่เกิดขึ้นจริง (10 ปีเต็มทุกวัน) — กันลูปไม่รู้จบ
  return tomorrow;
}

/** สิ่งที่จำไว้จากแถว FlowActivity `user_export_clip` — video = ชื่อไฟล์คลิปของงานตอนส่ง (null = แถวก่อนเก็บค่านี้) */
export type ExportRecord = { path: string; video: string | null };

/** อ่าน detail ของแถว `user_export_clip` · เสีย/ไม่มี path = null */
export function parseExportDetail(detail: string): ExportRecord | null {
  try {
    const d = JSON.parse(detail) as { path?: unknown; video?: unknown };
    if (typeof d.path !== "string" || d.path === "") return null;
    return { path: d.path, video: typeof d.video === "string" && d.video !== "" ? d.video : null };
  } catch {
    return null;
  }
}

/**
 * กด "ส่งเข้าโฟลเดอร์ TTS" แล้วทำอะไร (prev = แถวล่าสุดของงานนี้):
 * already = คลิปเดิมและโฟลเดอร์ยังอยู่ (เปิดของเดิม) · update = โฟลเดอร์ยังอยู่แต่คลิปของงานเปลี่ยน (720p → 1080p
 * หรือเรนเดอร์ใหม่) หรือแถวเก่าไม่รู้ว่าส่งคลิปไหน → เขียนทับในโฟลเดอร์เดิม · new = ยังไม่เคยส่ง/โฟลเดอร์ถูกลบ
 */
export function exportAction(prev: ExportRecord | null, folderExists: boolean, currentVideo: string): "already" | "update" | "new" {
  if (prev === null || !folderExists) return "new";
  return prev.video === currentVideo ? "already" : "update";
}

const CLIP_1080 = "คลิป-1080p.mp4";
const CLIP_720 = "คลิป-720p.mp4";

/** ชื่อไฟล์คลิปในโฟลเดอร์ TTS · isFinal = ไฟล์ 1080p (FINAL_VIDEO_FILENAME) */
export function exportClipName(isFinal: boolean): string {
  return isFinal ? CLIP_1080 : CLIP_720;
}

/** คลิปอีกขนาดที่ต้องลบออกจากโฟลเดอร์ตอนอัปเดต — กันมีทั้ง 720p และ 1080p ค้างคู่กัน */
export function otherExportClipName(isFinal: boolean): string {
  return isFinal ? CLIP_720 : CLIP_1080;
}

/** ข้อความชวนกดอัปเดตเมื่อคลิปที่ส่งไว้ไม่ใช่คลิปปัจจุบัน · ไม่รู้ว่าส่งอะไรไว้ (แถวเก่า) หรือไม่มีคลิปตอนนี้ = null */
export function exportStaleHint(exportedVideo: string | null, currentVideo: string | null, finalVideoFilename: string): string | null {
  if (exportedVideo === null || currentVideo === null || exportedVideo === currentVideo) return null;
  if (currentVideo === finalVideoFilename && exportedVideo !== finalVideoFilename) return "ส่งไว้เป็น 720p — กดเพื่ออัปเดตเป็น 1080p";
  return "มีคลิปใหม่กว่า — กดเพื่ออัปเดต";
}
