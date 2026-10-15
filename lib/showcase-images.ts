/**
 * โหลดรูปสินค้าจาก URL ที่มากับ Showcase JSON ลงเป็น Buffer — แยกจาก lib/showcase-import.ts
 * เพราะไฟล์นั้นต้องเป็น pure (ทดสอบด้วย scripts/check-showcase-import.mjs โดยไม่มี network)
 * ส่วนไฟล์นี้ทำ I/O จริง ไม่มี pure-logic ให้ check script ตรวจ — พึ่งการทดสอบ end-to-end
 * ใน Task 12 แทน (ตาม pattern เดียวกับ lib/tiktok-oembed.ts ซึ่งเป็นจุดยิงเน็ตอีกจุดของแอปนี้)
 *
 * โหลดไม่สำเร็จ (URL หมดอายุ/เน็ตมีปัญหา/ไม่ใช่รูปจริง/ไม่ผ่านเกณฑ์ความปลอดภัยด้านล่าง) =
 * คืน null ไม่ throw — ผู้เรียก (Task 5) ตัดสินใจว่าจะข้ามรูปนั้นแล้วไปต่อ
 *
 * ประวัติการเสริมความปลอดภัย (2026-09-22, หลัง security review อัตโนมัติ 3 รอบติดกันของ
 * commit ที่สร้าง/แก้ไฟล์นี้): URL ในนี้มาจาก payload ที่เชื่อใจได้แค่ครึ่งเดียว (ยิงมาจาก
 * extension ผ่าน endpoint ที่มี secret คุ้มครอง หรืออัปโหลดเป็นไฟล์ .json มือที่ไม่มีการ
 * คุ้มครองเลย) — รอบแรกเพิ่ม: บังคับ https:, ปฏิเสธ hostname ที่ resolve เข้า IP ส่วนตัว/
 * loopback/link-local, จำกัดขนาดโหลด รอบสอง (นี้) ปิดช่องที่รอบแรกยังเหลือ 3 จุด:
 * 1. **DNS rebinding (TOCTOU)** — รอบแรก resolve ตรวจแล้วปล่อยให้ fetch() resolve เองอีกรอบ
 *    ซ้ำ — ถ้า attacker คุม DNS server ได้ ตอบ IP ปลอดภัยตอนตรวจ แต่ตอบ IP ภายในตอน fetch จริง
 *    ก็หลบผ่านได้ แก้ด้วยการ "pin" การเชื่อมต่อจริงให้ใช้ IP เดียวกับที่ตรวจผ่านแล้วเท่านั้น
 *    ผ่าน undici Agent + custom lookup (พิสูจน์แล้วว่าใช้งานได้จริงด้วยการทดสอบสดกับ host จริง)
 * 2. **Redirect ไม่ถูกตรวจซ้ำ** — fetch() ตามค่าเริ่มต้นเดิน redirect เองอัตโนมัติโดยไม่เช็ค
 *    ปลายทางใหม่เลย ถ้าปลายทางแรกผ่านแต่ตอบ 3xx ไปยัง URL ภายใน ก็หลุดไปได้ แก้ด้วย
 *    redirect: "manual" แล้วเช็ค checkUrlSafe() ซ้ำทุก hop เอง (จำกัดไม่เกิน 5 hop กันวนไม่จบ)
 * 3. **IPv4-mapped IPv6 หลบ blocklist ได้** — เดิมเช็ค IPv6 แบบหยาบ ไม่ครอบคลุมที่อยู่แบบ
 *    "::ffff:127.0.0.1" ซึ่งเป็น IPv4 ปลอมตัวเป็น IPv6 แก้ด้วยการ "บังคับ resolve แบบ IPv4
 *    เท่านั้น" (dns.lookup(hostname, {family: 4})) — ปฏิเสธ IPv6 ทุกรูปแบบไปเลย (ปลอดภัยกว่า
 *    การพยายาม blocklist ทุกวิธีเขียน IPv6 ที่ไม่ปลอดภัย — URL รูปจริงจากร้านทั้งหมดที่สังเกต
 *    ได้ก็เป็น IPv4-reachable อยู่แล้ว ไม่เสียของจริง)
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

const TIMEOUT_MS = 15_000;
// 10MB — จับคู่กับ MAX_IMAGE_BYTES ใน app/actions.ts (enqueueFlowJobCore validate ด้วยค่าเดียวกัน)
// เดิมตั้งไว้ 20MB ซึ่งกว้างกว่าเพดานฝั่งเข้าคิว Flow — ทำให้รูป 10-20MB โหลดสำเร็จที่นี่แต่ไป
// throw "ไฟล์ใหญ่เกิน 10MB" ตอน enqueueFlowJobCore ในภายหลัง (ดู startShowcaseProduct)
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 5;

const EXT_BY_CONTENT_TYPE: Record<string, "jpg" | "png" | "webp"> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** ช่วง IPv4 ที่ไม่ควรให้เซิร์ฟเวอร์ยิง request ไปหาเอง (loopback, private, link-local/cloud metadata) */
function isPrivateOrReservedIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  const [a, b] = parts;
  if (a === 127) return true; // loopback
  if (a === 10) return true; // RFC1918
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 169 && b === 254) return true; // link-local รวม cloud metadata (169.254.169.254)
  if (a === 0) return true; // "this network"
  return false;
}

/**
 * ตรวจ URL ก่อน fetch ทุกครั้ง (เรียกซ้ำทุก redirect hop ด้วย) — https เท่านั้น + บังคับ resolve
 * แบบ IPv4 เท่านั้น (ปฏิเสธ IPv6 ทุกรูปแบบไปเลย กัน bypass ผ่าน IPv4-mapped IPv6) + ต้องไม่ใช่
 * IP ภายใน คืน IP ที่ resolve ได้กลับไปด้วย เพื่อให้ผู้เรียก "pin" การเชื่อมต่อจริงเข้ากับ IP นี้
 */
async function checkUrlSafe(url: string): Promise<{ safe: boolean; ip: string | null }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { safe: false, ip: null };
  }
  if (parsed.protocol !== "https:") return { safe: false, ip: null };
  const hostname = parsed.hostname;
  if (hostname === "localhost") return { safe: false, ip: null };

  if (isIP(hostname) === 6) return { safe: false, ip: null }; // ปฏิเสธ IPv6 literal ไปเลย
  if (isIP(hostname) === 4) {
    return isPrivateOrReservedIpv4(hostname) ? { safe: false, ip: null } : { safe: true, ip: hostname };
  }

  try {
    const { address, family } = await lookup(hostname, { family: 4 }); // บังคับ IPv4 เท่านั้น
    if (family !== 4 || isPrivateOrReservedIpv4(address)) return { safe: false, ip: null };
    return { safe: true, ip: address };
  } catch {
    return { safe: false, ip: null }; // resolve ไม่ได้/ไม่มี IPv4 เลย = ปฏิเสธไว้ก่อน
  }
}

/** เชื่อมต่อเฉพาะ IP ที่ตรวจผ่านแล้ว (ไม่ให้ fetch ไป resolve hostname ซ้ำเอง) กัน DNS rebinding */
function pinnedDispatcher(ip: string): Agent {
  return new Agent({
    connect: { lookup: (_hostname, _options, callback) => callback(null, [{ address: ip, family: 4 }]) },
  });
}

export async function downloadImage(
  url: string
): Promise<{ buffer: Buffer; ext: "jpg" | "png" | "webp" } | null> {
  let currentUrl = url;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const { safe, ip } = await checkUrlSafe(currentUrl);
      if (!safe || !ip) return null;

      const dispatcher = pinnedDispatcher(ip);
      try {
        const res = await undiciFetch(currentUrl, {
          signal: controller.signal,
          redirect: "manual",
          dispatcher,
        });

        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get("location");
          if (!location) return null;
          currentUrl = new URL(location, currentUrl).toString(); // เผื่อ Location เป็น relative
          continue; // ตรวจ URL ปลายทางใหม่ซ้ำในรอบถัดไปของลูป ไม่ตามไปเฉยๆ
        }

        if (!res.ok) return null;

        const contentLength = res.headers.get("content-length");
        if (contentLength && Number(contentLength) > MAX_BYTES) return null;

        const contentType = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
        const ext = EXT_BY_CONTENT_TYPE[contentType];
        if (!ext) return null; // ไม่ใช่รูปที่รองรับ (หรือ response ไม่ใช่รูปเลย เช่นหน้า error HTML)

        // อ่าน body ให้เสร็จก่อนปิด dispatcher เสมอ — ปิดก่อนอ่านจบทำให้ body อ่านไม่ได้
        const buffer = Buffer.from(await res.arrayBuffer());
        if (buffer.length === 0) return null;
        if (buffer.length > MAX_BYTES) return null; // ด่านสำรอง เผื่อ Content-Length ไม่มี/โกหก
        return { buffer, ext };
      } finally {
        dispatcher.destroy();
      }
    }
    return null; // redirect เกิน MAX_REDIRECTS hop — ถือว่าไม่สำเร็จ
  } catch {
    // timeout, network error, DNS ล้มเหลว ฯลฯ — ทั้งหมดคือ "โหลดไม่สำเร็จ" เหมือนกัน
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
