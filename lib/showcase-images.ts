/**
 * โหลดรูปสินค้าจาก URL ที่มากับ Showcase JSON ลงเป็น Buffer — แยกจาก lib/showcase-import.ts
 * เพราะไฟล์นั้นต้องเป็น pure (ทดสอบด้วย scripts/check-showcase-import.mjs โดยไม่มี network)
 * ส่วนไฟล์นี้ทำ I/O จริง ไม่มี pure-logic ให้ check script ตรวจ — พึ่งการทดสอบ end-to-end
 * ใน Task 12 แทน (ตาม pattern เดียวกับ lib/tiktok-oembed.ts ซึ่งเป็นจุดยิงเน็ตอีกจุดของแอปนี้)
 *
 * โหลดไม่สำเร็จ (URL หมดอายุ/เน็ตมีปัญหา/ไม่ใช่รูปจริง/ไม่ผ่านเกณฑ์ความปลอดภัยด้านล่าง) =
 * คืน null ไม่ throw — ผู้เรียก (Task 5) ตัดสินใจว่าจะข้ามรูปนั้นแล้วไปต่อ
 *
 * เพิ่มเมื่อ 2026-09-22 (หลัง security review อัตโนมัติของ commit ที่สร้างไฟล์นี้ครั้งแรก):
 * URL ในนี้มาจาก payload ที่ยังเชื่อใจได้แค่ครึ่งเดียว (ยิงมาจาก extension ผ่าน endpoint ที่มี
 * secret คุ้มครอง หรืออัปโหลดเป็นไฟล์ .json มือที่ไม่มีการคุ้มครองเลย) — ถ้าไม่กัน จะเปิดช่องให้
 * ยิง request จากเซิร์ฟเวอร์ไปยัง URL ภายในเครื่อง/เครือข่ายได้ (SSRF) เช่น
 * http://169.254.169.254/... (cloud metadata) หรือ service ภายใน LAN — จึงบังคับ https: เท่านั้น
 * (ตรงกับ URL รูปจริงที่สังเกตได้ทั้งหมดอยู่แล้ว) และปฏิเสธ hostname ที่ resolve เข้า IP
 * ส่วนตัว/loopback/link-local ก่อนยิง fetch จริงทุกครั้ง — ป้องกัน resource exhaustion คู่กันด้วย
 * การเช็ค Content-Length ก่อนโหลด (ถ้ามี) บวกเช็คขนาด buffer จริงหลังโหลดเป็นด่านสำรอง (เผื่อ
 * server โกหก header) ร่วมกับ timeout เดิม 15 วิที่จำกัดปริมาณสูงสุดที่โหลดได้ต่อครั้งอยู่แล้ว
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const TIMEOUT_MS = 15_000;
const MAX_BYTES = 20 * 1024 * 1024; // 20MB — เผื่อเหลือเฟือสำหรับรูปสินค้าจริง กันการโหลดมโหฬาร

const EXT_BY_CONTENT_TYPE: Record<string, "jpg" | "png" | "webp"> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** ช่วง IP ที่ไม่ควรให้เซิร์ฟเวอร์ยิง request ไปหาเอง (loopback, private, link-local/cloud metadata) */
function isPrivateOrReservedIp(ip: string): boolean {
  if (isIP(ip) === 4) {
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
  // IPv6 — กันแบบหยาบเท่าที่ป้องกันเคสที่พบบ่อยสุด (loopback, unique-local, link-local)
  const lower = ip.toLowerCase();
  return lower === "::1" || lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd");
}

/** ตรวจก่อน fetch ทุกครั้ง — https เท่านั้น + resolve แล้วต้องไม่ใช่ IP ภายใน */
async function isUrlSafe(url: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const hostname = parsed.hostname;
  if (hostname === "localhost") return false;
  if (isIP(hostname)) return !isPrivateOrReservedIp(hostname);
  try {
    const { address } = await lookup(hostname);
    return !isPrivateOrReservedIp(address);
  } catch {
    return false; // resolve ไม่ได้ = ปฏิเสธไว้ก่อน
  }
}

export async function downloadImage(
  url: string
): Promise<{ buffer: Buffer; ext: "jpg" | "png" | "webp" } | null> {
  if (!(await isUrlSafe(url))) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;

    const contentLength = res.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_BYTES) return null;

    const contentType = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    const ext = EXT_BY_CONTENT_TYPE[contentType];
    if (!ext) return null; // ไม่ใช่รูปที่รองรับ (หรือ response ไม่ใช่รูปเลย เช่นหน้า error HTML)

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0) return null;
    if (buffer.length > MAX_BYTES) return null; // ด่านสำรอง เผื่อ Content-Length ไม่มี/โกหก
    return { buffer, ext };
  } catch {
    // timeout, network error, DNS ล้มเหลว ฯลฯ — ทั้งหมดคือ "โหลดไม่สำเร็จ" เหมือนกัน
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
