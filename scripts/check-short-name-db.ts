/**
 * ตรวจ lib/short-name-db.ts กับ SQLite จริง (ticket 07 — ชื่อสั้นสำเร็จ 100%) ด้วยตัวย่อชื่อปลอม (ไม่เรียก Gemini):
 *   - ensureShortName: ย่อได้ → productName สั้น + ชื่อเต็มใน productInfo · ครั้งต่อไปไม่เรียกตัวย่ออีก · พลาด/คำตอบเสีย = ไม่แตะ
 *     · ชื่อร้านสั้นพออยู่แล้ว = ใช้ชื่อร้าน ไม่วนย่อซ้ำ · ไม่ได้มาจากร้าน = ไม่แตะ · ผู้ใช้แก้ชื่อระหว่างรอ = ไม่ทับ
 *   - shortenInBackground: ลองซ้ำเองจนสำเร็จ · พลาดทุกครั้งก็ไม่ throw
 *
 * ต้องชี้สำเนาของ DB เท่านั้น — ปฏิเสธไฟล์ชื่อ dev.db:
 *   cp dev.db dev-test.db   (ก๊อป -wal/-shm ด้วย)
 *   npx tsx scripts/check-short-name-db.ts dev-test.db
 * ไม่อยู่ใน check:flow เพราะต้องมีสำเนา DB · ลบ entry + ชุดสินค้าทดสอบตอนจบ
 */
import path from "node:path";
import { FULL_TITLE_PREFIX } from "@/lib/flow-jobs";

type Prisma = (typeof import("@/lib/prisma"))["prisma"];
type Mod = typeof import("@/lib/short-name-db");

const REPO = path.resolve(__dirname, "..");
const TEST_TAG = "__check-short-name-db__";
const SHOP = `${TEST_TAG} Jaotoob ผ้าเช็ดตัวสัตว์เลี้ยง สำหรับสุนัขและแมว หนานุ่มพิเศษ ซึมซับดี แห้งไว`;

let prisma: Prisma;
let mod: Mod;
let batchId = "";
let failures = 0;
let passes = 0;
const createdEntries: string[] = [];

function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passes++;
    console.log(`PASS ${name}`);
  } else {
    failures++;
    console.log(`FAIL ${name}${detail ? `\n  ${detail}` : ""}`);
  }
}

/** entry แบบที่ "ทำคลิปตัวนี้" สร้าง: ชื่อ = ชื่อร้าน · ผูก ProductCandidate (linkedEntryId) ถ้า linked */
async function shopEntry(title = SHOP, linked = true, productInfo = ""): Promise<string> {
  const e = await prisma.promptEntry.create({ data: { productName: title, productInfo, riskModule: "", extraNotes: "", images: "[]" } });
  createdEntries.push(e.id);
  if (linked) {
    await prisma.productCandidate.create({
      data: { batchId, name: title, nameKey: `${e.id}`, price: 1, commission: 1, categoryLabel: TEST_TAG, capturedOn: new Date(), linkedEntryId: e.id, sourceProductId: `${TEST_TAG}${e.id}` },
    });
  }
  return e.id;
}

const entry = (id: string) => prisma.promptEntry.findUniqueOrThrow({ where: { id }, select: { productName: true, productInfo: true } });

function counting(answer: (title: string) => Promise<string>) {
  const fn = Object.assign(async (title: string) => { fn.calls++; return answer(title); }, { calls: 0 });
  return fn;
}

async function ensure() {
  console.log("\n== ensureShortName ==");
  const id = await shopEntry();
  const ok = counting(async () => "ผ้าเช็ดตัวสัตว์เลี้ยง");
  const r1 = await mod.ensureShortName(id, { shorten: ok });
  let e = await entry(id);
  check("ย่อได้ → shortened · productName สั้น · ชื่อเต็มของร้านใน productInfo", r1.outcome === "shortened" && e.productName === "ผ้าเช็ดตัวสัตว์เลี้ยง" && e.productInfo === `${FULL_TITLE_PREFIX}${SHOP}`, JSON.stringify({ r1, e }));
  const r2 = await mod.ensureShortName(id, { shorten: ok });
  check("ครั้งต่อไป → not_needed ไม่เรียกตัวย่ออีก", r2.outcome === "not_needed" && ok.calls === 1, JSON.stringify({ r2, calls: ok.calls }));

  const failId = await shopEntry();
  const boom = counting(async () => { throw new Error("Gemini 503"); });
  const r3 = await mod.ensureShortName(failId, { shorten: boom });
  e = await entry(failId);
  check("ตัวย่อ throw → failed (มีข้อความ) · entry ไม่ถูกแตะ", r3.outcome === "failed" && (r3.error ?? "").includes("Gemini 503") && e.productName === SHOP && e.productInfo === "", JSON.stringify({ r3, e }));
  const r4 = await mod.ensureShortName(failId, { shorten: counting(async () => "") });
  e = await entry(failId);
  check("คำตอบเสีย (ว่าง) → failed · ไม่ตัดชื่อเอง ไม่แตะ", r4.outcome === "failed" && e.productName === SHOP && e.productInfo === "", JSON.stringify({ r4, e }));
  const hang = counting(() => new Promise<string>(() => undefined));
  const t0 = Date.now();
  const r5 = await mod.ensureShortName(failId, { shorten: hang, timeoutMs: 50 });
  check("ตัวย่อค้างไม่ตอบ → failed ตามเวลารอต่อครั้ง (ไม่ค้างตลอดไป)", r5.outcome === "failed" && Date.now() - t0 < 2000, JSON.stringify(r5));

  const shortTitle = `${TEST_TAG}ตะขอ`;
  const shortId = await shopEntry(shortTitle);
  const same = counting(async () => shortTitle);
  const r6 = await mod.ensureShortName(shortId, { shorten: same });
  e = await entry(shortId);
  check("ชื่อร้านสั้นพออยู่แล้ว → kept_full · ชื่อเดิม + ชื่อเต็มใน productInfo", r6.outcome === "kept_full" && e.productName === shortTitle && e.productInfo === `${FULL_TITLE_PREFIX}${shortTitle}`, JSON.stringify({ r6, e }));
  const r7 = await mod.ensureShortName(shortId, { shorten: same });
  check("kept_full แล้วไม่วนย่อซ้ำ", r7.outcome === "not_needed" && same.calls === 1, JSON.stringify({ r7, calls: same.calls }));

  // พรอมต์ Flow ไม่เคยใช้ชื่อเต็มของร้าน: ชื่อร้านยาว (> 30 ตัว) ที่ตัวย่อตอบกลับมาเท่าเดิม = ไม่สำเร็จ ไม่ใช่ kept_full
  const midTitle = `${TEST_TAG}ผ้าเช็ดตัวสัตว์เลี้ยง หนานุ่ม`;
  const midId = await shopEntry(midTitle);
  const echo = counting(async (t) => t);
  const r11 = await mod.ensureShortName(midId, { shorten: echo });
  e = await entry(midId);
  check("ชื่อร้านยาว ตัวย่อตอบชื่อเดิม → failed · entry ไม่ถูกแตะ (ยังรอชื่อสั้น)", r11.outcome === "failed" && e.productName === midTitle && e.productInfo === "", JSON.stringify({ r11, e }));

  // งานเก่าที่กติกาเดิมบันทึก kept_full ให้ชื่อร้านยาว (prefix อยู่ใน productInfo แล้ว) → ยังนับว่าไม่ย่อ · ย่อแล้วไม่ใส่ prefix ซ้ำ
  const legacyInfo = `ผ้าฝ้าย 100%\n${FULL_TITLE_PREFIX}${SHOP}`;
  const legacyId = await shopEntry(SHOP, true, legacyInfo);
  check("kept_full เดิมของชื่อร้านยาว → hasUnshortenedName = true (บอทไม่วาดด้วยชื่อนี้)", await mod.hasUnshortenedName(legacyId));
  const r12 = await mod.ensureShortName(legacyId, { shorten: counting(async () => "ผ้าเช็ดตัวสัตว์เลี้ยง") });
  e = await entry(legacyId);
  check("kept_full เดิมของชื่อร้านยาว → ย่อได้ · productInfo มีชื่อเต็มครั้งเดียว (ไม่ซ้ำ prefix)", r12.outcome === "shortened" && e.productName === "ผ้าเช็ดตัวสัตว์เลี้ยง" && e.productInfo === legacyInfo, JSON.stringify({ r12, e }));
  check("ย่อแล้ว → hasUnshortenedName = false", !(await mod.hasUnshortenedName(legacyId)));

  const manualId = await shopEntry(SHOP, false);
  const never = counting(async () => "x");
  const r8 = await mod.ensureShortName(manualId, { shorten: never });
  check("entry ที่ไม่ได้มาจากร้าน (ไม่มี ProductCandidate ผูก) → not_needed ไม่เรียกตัวย่อ", r8.outcome === "not_needed" && never.calls === 0, JSON.stringify(r8));

  const infoId = await shopEntry(SHOP, true, "ผ้าฝ้าย 100%");
  await mod.ensureShortName(infoId, { shorten: ok });
  e = await entry(infoId);
  check("productInfo ที่ผู้ใช้เขียนไว้คงอยู่ ชื่อเต็มต่อบรรทัดใหม่", e.productInfo === `ผ้าฝ้าย 100%\n${FULL_TITLE_PREFIX}${SHOP}`, JSON.stringify(e));

  const raceId = await shopEntry();
  const userEdits = counting(async () => {
    await prisma.promptEntry.update({ where: { id: raceId }, data: { productName: "ชื่อที่ผู้ใช้ตั้งเอง" } });
    return "ผ้าเช็ดตัว";
  });
  const r9 = await mod.ensureShortName(raceId, { shorten: userEdits });
  e = await entry(raceId);
  check("ผู้ใช้แก้ชื่อระหว่างรอตัวย่อ → ไม่ทับชื่อของผู้ใช้ · not_needed (ชื่อไม่ใช่ชื่อร้านแล้ว)", r9.outcome === "not_needed" && e.productName === "ชื่อที่ผู้ใช้ตั้งเอง" && e.productInfo === "", JSON.stringify({ r9, e }));

  const r10 = await mod.ensureShortName("ไม่มี-entry-นี้", { shorten: never });
  check("entry ไม่มีแล้ว → not_needed ไม่ throw", r10.outcome === "not_needed", JSON.stringify(r10));
}

async function background() {
  console.log("\n== shortenInBackground ==");
  const id = await shopEntry();
  let n = 0;
  const flaky = counting(async () => { n++; if (n < 3) throw new Error(`พลาดครั้งที่ ${n}`); return "ผ้าเช็ดตัวสัตว์เลี้ยง"; });
  await mod.shortenInBackground(id, { shorten: flaky, delaysMs: [5, 5, 5], log: () => undefined });
  const e = await entry(id);
  check("พลาด 2 ครั้งแล้วสำเร็จครั้งที่ 3 → ชื่อสั้น", flaky.calls === 3 && e.productName === "ผ้าเช็ดตัวสัตว์เลี้ยง", JSON.stringify({ calls: flaky.calls, e }));

  const deadId = await shopEntry();
  const dead = counting(async () => { throw new Error("ล่ม"); });
  let threw = false;
  try {
    await mod.shortenInBackground(deadId, { shorten: dead, delaysMs: [5, 5], log: () => undefined });
  } catch {
    threw = true;
  }
  const d = await entry(deadId);
  check("พลาดทุกครั้ง → ลองครบ (1 + จำนวน delay) แล้วจบเงียบๆ ไม่ throw · ชื่อยังเป็นชื่อร้าน (บอทย่อเองทีหลัง)", !threw && dead.calls === 3 && d.productName === SHOP, JSON.stringify({ threw, calls: dead.calls }));

  let threwBadId = false;
  try {
    await mod.shortenInBackground("ไม่มี-entry-นี้", { shorten: dead, delaysMs: [], log: () => undefined });
  } catch {
    threwBadId = true;
  }
  check("entry ไม่มี → จบเงียบๆ ไม่ throw", !threwBadId);
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("usage: npx tsx scripts/check-short-name-db.ts <path to a COPY of dev.db>");
    process.exit(2);
  }
  const abs = path.resolve(arg);
  if (abs.toLowerCase() === path.join(REPO, "dev.db").toLowerCase() || path.basename(abs).toLowerCase() === "dev.db") {
    console.error("ไม่รับ dev.db ตัวจริง — ก๊อปเป็นไฟล์อื่นก่อน");
    process.exit(2);
  }
  process.env.DATABASE_URL = `file:${abs.split(path.sep).join("/")}`;
  prisma = (await import("@/lib/prisma")).prisma;
  mod = await import("@/lib/short-name-db");
  batchId = (await prisma.candidateBatch.create({ data: { capturedOn: new Date() } })).id;

  try {
    await ensure();
    await background();
  } catch (e) {
    failures++;
    console.log(`FAIL (โยน error) ${e instanceof Error ? e.stack : String(e)}`);
  } finally {
    await prisma.candidateBatch.deleteMany({ where: { id: batchId } });
    await prisma.promptEntry.deleteMany({ where: { id: { in: createdEntries } } });
    await prisma.$disconnect();
  }
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
