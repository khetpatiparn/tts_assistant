import { open, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { UPLOAD_ROOT } from "@/lib/upload-paths";
import { parseByteRange } from "@/lib/http-range";

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
  // คลิปที่บอท Flow ทำ (uploads/<entryId>/flow/r3-a<n>.mp4) — ต้องตอบ Range ด้วย ไม่งั้น <video> เลื่อนดูไม่ได้
  ".mp4": "video/mp4",
  // เสียงพากย์ TTS (uploads/<entryId>/flow/tts-audio.wav)
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  // หลักฐานตอน Flow bot พัง (uploads/_flow-failures/) — เสิร์ฟเป็น text ล้วน ไม่ render HTML
  ".html": "text/plain; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".json": "text/plain; charset=utf-8",
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: segments } = await params;

  const target = path.join(UPLOAD_ROOT, ...segments);
  // Reject any path that escapes the upload root (e.g. via "..").
  if (!path.resolve(target).startsWith(path.resolve(UPLOAD_ROOT) + path.sep)) {
    return new Response("Not found", { status: 404 });
  }

  const mime = MIME_BY_EXT[path.extname(target).toLowerCase()];
  if (!mime) {
    return new Response("Not found", { status: 404 });
  }

  let size: number;
  try {
    const info = await stat(target);
    if (!info.isFile()) return new Response("Not found", { status: 404 });
    size = info.size;
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const baseHeaders = {
    "Content-Type": mime,
    "Cache-Control": "private, max-age=3600",
    "Accept-Ranges": "bytes",
  };

  const range = parseByteRange(request.headers.get("range"), size);
  if (range === "unsatisfiable") {
    return new Response(null, { status: 416, headers: { ...baseHeaders, "Content-Range": `bytes */${size}` } });
  }

  try {
    if (range === null) {
      const file = await readFile(target);
      return new Response(new Uint8Array(file), { headers: { ...baseHeaders, "Content-Length": String(file.length) } });
    }
    // อ่านเฉพาะช่วงที่ขอ — คลิป 1080p ใหญ่หลาย MB และ <video> ขอเป็นช่วงๆ ตอนเลื่อน
    const length = range.end - range.start + 1;
    const buf = Buffer.alloc(length);
    const handle = await open(target, "r");
    try {
      await handle.read(buf, 0, length, range.start);
    } finally {
      await handle.close();
    }
    return new Response(new Uint8Array(buf), {
      status: 206,
      headers: {
        ...baseHeaders,
        "Content-Length": String(length),
        "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
