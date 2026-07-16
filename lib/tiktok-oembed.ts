/** ดึง @handle จากลิงก์ TikTok เช่น https://www.tiktok.com/@rainny0192/video/123 -> rainny0192 */
export function handleFromUrl(url: string): string | null {
  const m = url.match(/tiktok\.com\/@([\w.]+)/i);
  return m ? m[1] : null;
}

/** ประกอบลิงก์คลิปจาก content id + handle (ใช้กับออเดอร์ที่ยังไม่มี entry) */
export function buildVideoUrl(contentId: string, handle: string): string {
  return `https://www.tiktok.com/@${handle}/video/${contentId}`;
}

/**
 * ยิง TikTok oEmbed (สาธารณะ ไม่ต้อง auth) เอา thumbnail + ชื่อคลิป
 * ok=false เมื่อคลิปโดนลบ/ปิด/ยิงพลาด — ให้ caller เก็บ cache แล้วโชว์ fallback
 */
export async function fetchOembedThumbnail(videoUrl: string): Promise<{
  thumbnailUrl: string | null;
  title: string | null;
  ok: boolean;
}> {
  try {
    const endpoint = `https://www.tiktok.com/oembed?url=${encodeURIComponent(videoUrl)}`;
    const res = await fetch(endpoint, {
      headers: { "User-Agent": "Mozilla/5.0 (pooling-prompt)" },
    });
    if (!res.ok) return { thumbnailUrl: null, title: null, ok: false };
    const json = (await res.json()) as { thumbnail_url?: string; title?: string };
    const thumbnailUrl = json.thumbnail_url ?? null;
    return { thumbnailUrl, title: json.title ?? null, ok: Boolean(thumbnailUrl) };
  } catch {
    return { thumbnailUrl: null, title: null, ok: false };
  }
}
