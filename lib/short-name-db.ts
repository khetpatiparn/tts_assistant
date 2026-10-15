/**
 * ย่อชื่อสินค้า (Short name ใน CONTEXT.md) ของ entry ที่มาจากร้าน แล้วบันทึก — ส่วนที่แตะ DB (กติกา pure อยู่ lib/flow-jobs.ts:
 * isUnshortenedName / shortNameOutcome / productInfoWithFullTitle) · ticket 07 (2026-10-04)
 *
 * ผู้ใช้สามทาง เรียกตัวเดียวกัน: server action ย่อเบื้องหลังหลังสร้าง entry (shortenInBackground — ไม่มีใครรอ) · บอทก่อนหยิบงาน
 * รอบ 1–2 (ensureShortName ใน worker/index.ts) · สคริปต์ย้อนหลัง · **ห้าม import อะไรของ Next** (บอทและสคริปต์ import ผ่าน tsx)
 * ตรวจกับ SQLite จริง: npx tsx scripts/check-short-name-db.ts <สำเนา DB>
 */
import { prisma } from "@/lib/prisma";
import { shortenProductName } from "@/lib/gemini";
import {
  SHORT_NAME_ATTEMPT_TIMEOUT_MS, isUnshortenedName, productInfoWithFullTitle, shortNameOutcome, withTimeout,
} from "@/lib/flow-jobs";

export type Shortener = (fullTitle: string) => Promise<string>;

/**
 * not_needed = ชื่อไม่ใช่ชื่อเต็มของร้าน (ย่อแล้ว / ผู้ใช้ตั้งเอง / ไม่ได้มาจากร้าน / entry ไม่มีแล้ว) · shortened = เพิ่งย่อ
 * · kept_full = ชื่อร้านสั้นอยู่แล้ว ≤ 30 ตัว (บันทึกว่าตัดสินแล้ว) · failed = ย่อไม่ได้รอบนี้ ชื่อยังเป็นชื่อร้าน — ไม่มีการตัดชื่อเอง
 */
export type ShortNameOutcome = "not_needed" | "shortened" | "kept_full" | "failed";

/** ชื่อเต็มของร้านที่ผูก entry นี้ (ProductCandidate.linkedEntryId) — ว่าง = entry ไม่ได้มาจาก Showcase/หาสินค้า */
export async function linkedShopTitles(entryId: string): Promise<string[]> {
  const rows = await prisma.productCandidate.findMany({ where: { linkedEntryId: entryId }, select: { name: true } });
  return rows.map((r) => r.name);
}

async function readState(entryId: string) {
  const entry = await prisma.promptEntry.findUnique({ where: { id: entryId }, select: { productName: true, productInfo: true } });
  if (entry === null) return null;
  return { entry, shopTitles: await linkedShopTitles(entryId) };
}

/** ชื่อยังเป็นชื่อเต็มของร้านไหม — อ่าน DB แล้วตัดสินด้วย isUnshortenedName (บอทใช้ตรวจซ้ำก่อนพิมพ์ชื่อลงพรอมต์) */
export async function hasUnshortenedName(entryId: string): Promise<boolean> {
  const s = await readState(entryId);
  return s !== null && isUnshortenedName(s.entry, s.shopTitles);
}

/**
 * ย่อชื่อของ entry ถ้ายังเป็นชื่อเต็มของร้าน (ไม่ throw) — เขียนแบบมีเงื่อนไข: productName/productInfo ต้องยังเป็นค่าที่อ่านมา
 * (ผู้ใช้แก้ระหว่างรอตัวย่อ = ไม่ทับ แล้วตัดสินใหม่จากค่าปัจจุบัน) · ตัวย่อแต่ละครั้งรอไม่เกิน timeoutMs
 */
export async function ensureShortName(
  entryId: string,
  opts: { shorten?: Shortener; timeoutMs?: number } = {},
): Promise<{ outcome: ShortNameOutcome; name?: string; error?: string }> {
  const shorten = opts.shorten ?? shortenProductName;
  try {
    const s = await readState(entryId);
    if (s === null || !isUnshortenedName(s.entry, s.shopTitles)) return { outcome: "not_needed" };
    const fullTitle = s.entry.productName;
    const answer = await withTimeout(shorten(fullTitle), opts.timeoutMs ?? SHORT_NAME_ATTEMPT_TIMEOUT_MS, "ย่อชื่อสินค้า");
    const result = shortNameOutcome(answer, fullTitle);
    if (result === null) return { outcome: "failed", error: `คำตอบของตัวย่อชื่อใช้ไม่ได้: ${JSON.stringify(answer.slice(0, 80))}` };
    const written = await prisma.promptEntry.updateMany({
      where: { id: entryId, productName: s.entry.productName, productInfo: s.entry.productInfo },
      data: { productName: result.name, productInfo: productInfoWithFullTitle(s.entry.productInfo, fullTitle) },
    });
    if (written.count === 0) {
      return (await hasUnshortenedName(entryId))
        ? { outcome: "failed", error: "ข้อมูลสินค้าเปลี่ยนระหว่างย่อชื่อ" }
        : { outcome: "not_needed" };
    }
    return { outcome: result.name === fullTitle ? "kept_full" : "shortened", name: result.name };
  } catch (e) {
    return { outcome: "failed", error: e instanceof Error ? e.message : String(e) };
  }
}

/** เวลารอก่อนลองใหม่ของการย่อเบื้องหลัง — ครบแล้วยังไม่ได้ บอทย่อเองก่อนวาด (ไม่มีงานไหนวาดด้วยชื่อร้าน) */
export const BACKGROUND_RETRY_DELAYS_MS = [10_000, 60_000, 300_000];

/**
 * ย่อเบื้องหลังหลังสร้าง entry (fire-and-forget จาก server action — ห้าม await ในเส้นทางที่ผู้ใช้รอ) · ลองซ้ำตาม delaysMs
 * หยุดเมื่อสำเร็จ/ไม่ต้องย่อแล้ว · ไม่ throw ทุกกรณี
 */
export async function shortenInBackground(
  entryId: string,
  opts: { shorten?: Shortener; delaysMs?: number[]; log?: (msg: string) => void } = {},
): Promise<void> {
  const delays = opts.delaysMs ?? BACKGROUND_RETRY_DELAYS_MS;
  const log = opts.log ?? ((msg: string) => console.error(msg));
  try {
    for (let attempt = 0; ; attempt++) {
      const r = await ensureShortName(entryId, { shorten: opts.shorten });
      if (r.outcome !== "failed") return;
      if (attempt >= delays.length) {
        log(`ย่อชื่อสินค้าเบื้องหลังไม่สำเร็จครบ ${attempt + 1} ครั้ง (${entryId}) — บอทจะย่อเองก่อนวาด: ${r.error ?? ""}`);
        return;
      }
      log(`ย่อชื่อสินค้าไม่สำเร็จ ครั้งที่ ${attempt + 1} (${entryId}) ลองใหม่ใน ${Math.round(delays[attempt] / 1000)} วิ: ${r.error ?? ""}`);
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  } catch (e) {
    log(`ย่อชื่อสินค้าเบื้องหลังล้ม (${entryId}): ${e instanceof Error ? e.message : String(e)}`);
  }
}
