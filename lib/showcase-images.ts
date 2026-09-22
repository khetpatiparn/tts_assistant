/**
 * โหลดรูปสินค้าจาก URL ที่มากับ Showcase JSON ลงเป็น Buffer — แยกจาก lib/showcase-import.ts
 * เพราะไฟล์นั้นต้องเป็น pure (ทดสอบด้วย scripts/check-showcase-import.mjs โดยไม่มี network)
 * ส่วนไฟล์นี้ทำ I/O จริง ไม่มี pure-logic ให้ check script ตรวจ — พึ่งการทดสอบ end-to-end
 * ใน Task 12 แทน (ตาม pattern เดียวกับ lib/tiktok-oembed.ts ซึ่งเป็นจุดยิงเน็ตอีกจุดของแอปนี้)
 *
 * โหลดไม่สำเร็จ (URL หมดอายุ/เน็ตมีปัญหา/ไม่ใช่รูปจริง) = คืน null ไม่ throw — ผู้เรียก (Task 5)
 * ตัดสินใจว่าจะข้ามรูปนั้นแล้วไปต่อ ตามที่ระบุไว้ในสเปกหัวข้อ error handling
 */

const TIMEOUT_MS = 15_000;

const EXT_BY_CONTENT_TYPE: Record<string, "jpg" | "png" | "webp"> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function downloadImage(
  url: string
): Promise<{ buffer: Buffer; ext: "jpg" | "png" | "webp" } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;

    const contentType = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    const ext = EXT_BY_CONTENT_TYPE[contentType];
    if (!ext) return null; // ไม่ใช่รูปที่รองรับ (หรือ response ไม่ใช่รูปเลย เช่นหน้า error HTML)

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0) return null;
    return { buffer, ext };
  } catch {
    // timeout, network error, DNS ล้มเหลว ฯลฯ — ทั้งหมดคือ "โหลดไม่สำเร็จ" เหมือนกัน
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
