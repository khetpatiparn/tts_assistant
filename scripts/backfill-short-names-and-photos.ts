/**
 * สคริปต์ย้อนหลังของ ticket 07 (แทน scripts/shorten-showcase-names.ts เดิม) — idempotent รันซ้ำได้ · ไม่มี --apply = แสดงอย่างเดียว
 *   1. ชื่อสั้น: entry ที่มาจาก Showcase/หาสินค้า ยังไม่โพสต์ และชื่อยังเป็นชื่อเต็มของร้าน (isUnshortenedName) → ย่อด้วย ensureShortName
 *      (ตัวเดียวกับบอท/ย่อเบื้องหลัง เรียก Gemini) · ย่อไม่ได้ = ข้าม (บอทย่อเองก่อนวาด ไม่วาดด้วยชื่อร้าน)
 *   2. รูปต้นทางอัตโนมัติ (ticket 04): งานที่ยังเปิดและยังไม่ได้เลือกรอบ 2 ที่ entry ยังไม่มีรูปต้นทางอัตโนมัติ → ใส่รูปต้นทาง
 *      ปัจจุบันของงาน (currentSourceImage) เป็นรูปสินค้า (replaceAutoSourceImage ตัวเดียวกับตอนเข้าคิว) · ไฟล์รูปต้นทางหาย = ข้าม
 *
 * ผู้ใช้รันเอง (เขียน dev.db + uploads/) — หยุดบอทก่อนไม่จำเป็น:
 *   npx tsx scripts/backfill-short-names-and-photos.ts            (ดูก่อน)
 *   npx tsx scripts/backfill-short-names-and-photos.ts --apply    (แก้จริง)
 * ทดสอบ: DATABASE_URL="file:./dev-test.db" npx tsx scripts/backfill-short-names-and-photos.ts --apply --uploads <โฟลเดอร์ชั่วคราว>
 */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { isUnshortenedName } from "@/lib/flow-jobs";
import { ensureShortName } from "@/lib/short-name-db";
import { autoSourceBackfillPick } from "@/lib/auto-source-image";
import { replaceAutoSourceImage } from "@/lib/auto-source-image-db";
import { UPLOAD_ROOT, joinPath } from "@/lib/upload-paths";

const short = (s: string) => (s.length > 60 ? `${s.slice(0, 60)}…` : s);

async function names(apply: boolean): Promise<number> {
  console.log("== 1. ชื่อสั้น ==");
  const linked = await prisma.productCandidate.findMany({ where: { linkedEntryId: { not: null } }, select: { name: true, linkedEntryId: true } });
  const titlesByEntry = new Map<string, string[]>();
  for (const c of linked) titlesByEntry.set(c.linkedEntryId as string, [...(titlesByEntry.get(c.linkedEntryId as string) ?? []), c.name]);
  const entries = await prisma.promptEntry.findMany({
    where: { id: { in: [...titlesByEntry.keys()] }, videoUrl: "" },
    select: { id: true, productName: true, productInfo: true },
    orderBy: { createdAt: "asc" },
  });
  let n = 0;
  for (const e of entries) {
    if (!isUnshortenedName(e, titlesByEntry.get(e.id) ?? [])) continue;
    n++;
    if (!apply) {
      console.log(`จะย่อ: "${short(e.productName)}"`);
      continue;
    }
    const r = await ensureShortName(e.id);
    if (r.outcome === "shortened") console.log(`ย่อแล้ว: "${short(e.productName)}" → "${r.name ?? ""}"`);
    else if (r.outcome === "kept_full") console.log(`ชื่อร้านสั้นพออยู่แล้ว ใช้ตามเดิม: "${e.productName}"`);
    else if (r.outcome === "not_needed") console.log(`ไม่ต้องย่อแล้ว (เพิ่งถูกย่อ/แก้): "${short(e.productName)}"`);
    else console.log(`ข้าม (ย่อไม่สำเร็จ บอทจะย่อเองก่อนวาด): "${short(e.productName)}" — ${r.error ?? ""}`);
  }
  return n;
}

async function photos(apply: boolean, root: string): Promise<number> {
  console.log("\n== 2. รูปต้นทางอัตโนมัติ ==");
  const jobs = await prisma.flowJob.findMany({
    where: { status: { notIn: ["done", "skipped"] } },
    select: {
      status: true, entryId: true,
      entry: { select: { productName: true, productImages: { select: { filename: true } } } },
      images: { select: { kind: true, round: true, attempt: true, index: true, chosen: true, filename: true, mimeType: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  let n = 0;
  for (const job of jobs) {
    const pick = autoSourceBackfillPick(job, job.entry.productImages.map((p) => p.filename));
    if (pick === null) continue;
    const file = joinPath(root, job.entryId, "flow", pick.filename);
    let buffer: Buffer;
    try {
      buffer = await readFile(file);
    } catch {
      console.log(`ข้าม (ไม่มีไฟล์รูปต้นทาง ${pick.filename}): "${short(job.entry.productName)}" (${job.status})`);
      continue;
    }
    n++;
    if (!apply) {
      console.log(`จะใส่รูปต้นทาง: "${short(job.entry.productName)}" (${job.status})`);
      continue;
    }
    await replaceAutoSourceImage(root, job.entryId, { buffer, mimeType: pick.mimeType });
    console.log(`ใส่รูปต้นทางแล้ว: "${short(job.entry.productName)}" (${job.status})`);
  }
  return n;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const at = process.argv.indexOf("--uploads");
  const root = at >= 0 && process.argv[at + 1] ? path.resolve(process.argv[at + 1]) : UPLOAD_ROOT;
  try {
    const a = await names(apply);
    const b = await photos(apply, root);
    console.log(`\n${apply ? "ทำแล้ว" : "จะทำ"}: ย่อชื่อ ${a} งาน · ใส่รูปต้นทาง ${b} งาน${apply ? "" : " — ใส่ --apply เพื่อแก้จริง"}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
