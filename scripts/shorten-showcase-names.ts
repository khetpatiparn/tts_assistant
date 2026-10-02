/**
 * ย่อชื่อสินค้าของงานที่สร้างจาก Showcase/หาสินค้า ก่อนมีการย่ออัตโนมัติ (2026-10-02) — เฉพาะงานที่ยังไม่โพสต์
 * และชื่อยังเป็นชื่อร้านทั้งพวง (productName === ProductCandidate.name) · ชื่อเต็มเก็บไว้ใน productInfo ถ้าช่องนั้นว่าง
 * รัน (ดูก่อน ไม่เขียน):  npx tsx scripts/shorten-showcase-names.ts
 * รันจริง:               npx tsx scripts/shorten-showcase-names.ts --apply
 * ชี้ DB อื่น: DATABASE_URL="file:./dev-test.db" npx tsx scripts/shorten-showcase-names.ts --apply
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { shortenProductName } from "@/lib/gemini";
import { acceptShortName, FULL_TITLE_PREFIX } from "@/lib/flow-jobs";

async function main() {
  const apply = process.argv.includes("--apply");
  const candidates = await prisma.productCandidate.findMany({
    where: { linkedEntryId: { not: null } },
    select: { name: true, linkedEntryId: true },
  });
  let changed = 0;
  for (const c of candidates) {
    const entry = await prisma.promptEntry.findUnique({
      where: { id: c.linkedEntryId as string },
      select: { id: true, productName: true, productInfo: true, videoUrl: true },
    });
    if (!entry || entry.videoUrl !== "" || entry.productName !== c.name || c.name.length <= 40) continue;
    let short = c.name;
    try {
      short = acceptShortName(await shortenProductName(c.name), c.name);
    } catch (e) {
      console.log(`ข้าม (ย่อไม่สำเร็จ): ${c.name.slice(0, 50)} — ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    if (short === c.name) {
      console.log(`ข้าม (ย่อแล้วไม่สั้นลง): ${c.name.slice(0, 50)}`);
      continue;
    }
    console.log(`${apply ? "แก้" : "จะแก้"}: "${c.name.slice(0, 60)}…" → "${short}"`);
    if (apply) {
      await prisma.promptEntry.update({
        where: { id: entry.id },
        data: {
          productName: short,
          ...(entry.productInfo.trim() === "" ? { productInfo: `${FULL_TITLE_PREFIX}${c.name}` } : {}),
        },
      });
    }
    changed++;
  }
  console.log(`\n${apply ? "แก้แล้ว" : "จะแก้"} ${changed} งาน${apply ? "" : " — ใส่ --apply เพื่อแก้จริง"}`);
  await prisma.$disconnect();
}

main();
