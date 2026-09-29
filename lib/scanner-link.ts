import { randomBytes, timingSafeEqual } from "node:crypto";

/**
 * ลิงก์ปลายทางของ Showcase Scanner ฝั่ง Angle — protocol เดียวกับที่คนอื่นใช้ (ดู
 * showcase-extension/docs/INTEGRATION.md) · ใช้ฝั่ง server เท่านั้น (มี node:crypto)
 */
export const SCANNER_PROTOCOL = "showcase-scanner/1";

export function newToken(): string {
  return randomBytes(32).toString("hex");
}

/** เทียบแบบ timing-safe — ความยาวต่างกันคืน false ก่อน (timingSafeEqual throw ถ้ายาวไม่เท่า) */
export function tokensMatch(given: string | null, expected: string): boolean {
  if (given === null) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
