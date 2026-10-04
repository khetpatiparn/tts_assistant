/**
 * ตรวจ lib/auto-source-image-db.ts กับ SQLite จริง: รูปต้นทางอัตโนมัติในรูปสินค้า (ProductImage) ของ entry
 *   - เข้าคิว → แถวรูปต้นทาง 1 แถว · เข้าคิวซ้ำ → แทนแถวเดิม (ไม่ซ้ำ) ไฟล์เก่าหาย
 *   - เลือกรูปรอบ 2 → แถว+ไฟล์รูปต้นทางอัตโนมัติหาย ได้รูปที่ Flow วาด 2 รูปแทน · แถวที่ผู้ใช้เพิ่มเองอยู่ครบ
 *   - ก่อนเลือกรอบ 2 รูปต้นทางอ่านได้จาก path เดียวกับที่ generateWithAI (loadGeminiImages) อ่าน
 *
 * ต้องชี้สำเนาของ DB เท่านั้น — ปฏิเสธไฟล์ชื่อ dev.db · ไฟล์รูปเขียนลงโฟลเดอร์ชั่วคราว ไม่แตะ uploads/ จริง:
 *   cp dev.db dev-test.db   (ก๊อป -wal/-shm ด้วย)
 *   npx tsx scripts/check-product-image-source-db.ts dev-test.db
 * ไม่อยู่ใน check:flow เพราะต้องมีสำเนา DB · ลบ entry ทดสอบ (แถวรูปหายตาม Cascade) และโฟลเดอร์ชั่วคราวตอนจบ
 */
import path from "node:path";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import * as ai from "@/lib/auto-source-image";
import { AUTO_SOURCE_CAPTION, isAutoSourceImage } from "@/lib/auto-source-image";

type Prisma = (typeof import("@/lib/prisma"))["prisma"];
type DbMod = typeof import("@/lib/auto-source-image-db");

const REPO = path.resolve(__dirname, "..");
const TEST_NAME = "__check-product-image-source-db__";
const USER_FILE = "0b6a2c1e-4f1d-4c4e-9a51-3f0b1e2d7c11.jpg";

let prisma: Prisma;
let db: DbMod;
let root: string;
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

/** entry ทดสอบที่มีรูปที่ผู้ใช้เพิ่มเอง 1 รูป (แถว + ไฟล์) */
async function entryWithUserImage(): Promise<string> {
  const e = await prisma.promptEntry.create({ data: { productName: TEST_NAME, productInfo: "", riskModule: "", extraNotes: "", images: "[]" } });
  createdEntries.push(e.id);
  mkdirSync(path.join(root, e.id), { recursive: true });
  writeFileSync(path.join(root, e.id, USER_FILE), "user-photo");
  await prisma.productImage.create({ data: { entryId: e.id, filename: USER_FILE, mimeType: "image/jpeg", caption: "ของผู้ใช้", sortOrder: 0 } });
  return e.id;
}

async function rows(entryId: string) {
  return prisma.productImage.findMany({ where: { entryId }, orderBy: { sortOrder: "asc" } });
}

const fileAt = (entryId: string, filename: string) => path.join(root, entryId, filename);

async function enqueueReplaces() {
  console.log("\n== เข้าคิว: ใส่/แทนรูปต้นทางอัตโนมัติ ==");
  const id = await entryWithUserImage();

  await db.replaceAutoSourceImage(root, id, { buffer: Buffer.from("source-A"), mimeType: "image/jpeg" });
  let r = await rows(id);
  const autoA = r.filter((x) => isAutoSourceImage(x.filename));
  check(
    "เข้าคิวครั้งแรก → รูปต้นทางอัตโนมัติ 1 แถว (caption ตั้งต้น, .jpg) + รูปผู้ใช้ยังอยู่",
    autoA.length === 1 && autoA[0].caption === AUTO_SOURCE_CAPTION && autoA[0].mimeType === "image/jpeg" && autoA[0].filename.endsWith(".jpg") &&
      r.some((x) => x.filename === USER_FILE && x.caption === "ของผู้ใช้"),
    JSON.stringify(r),
  );
  check("ไฟล์รูปต้นทางอยู่ในโฟลเดอร์ของ entry ตรงชื่อแถว", existsSync(fileAt(id, autoA[0].filename)) && readFileSync(fileAt(id, autoA[0].filename), "utf8") === "source-A");
  // generateWithAI ก่อนเลือกรอบ 2: ต้องมีรูปอย่างน้อย 1 รูป และ loadGeminiImages อ่าน path.join(UPLOAD_ROOT, entryId, filename)
  check("ก่อนเลือกรอบ 2 รูปต้นทางเป็นรูปสินค้าที่ Gemini อ่านได้ (path เดียวกับ loadGeminiImages)", r.length >= 1 && r.every((x) => existsSync(path.join(root, x.entryId, x.filename))));
  const sortA = autoA[0].sortOrder;

  await db.replaceAutoSourceImage(root, id, { buffer: Buffer.from("source-B"), mimeType: "image/png" });
  r = await rows(id);
  const autoB = r.filter((x) => isAutoSourceImage(x.filename));
  check(
    "เข้าคิวซ้ำ → ยังมีรูปต้นทางอัตโนมัติแถวเดียว เป็นรูปใหม่ (.png) ตำแหน่งเดิม · รวม 2 แถว",
    autoB.length === 1 && autoB[0].filename !== autoA[0].filename && autoB[0].mimeType === "image/png" && autoB[0].filename.endsWith(".png") &&
      autoB[0].sortOrder === sortA && r.length === 2,
    JSON.stringify(r),
  );
  check("ไฟล์รูปต้นทางเก่าถูกลบ ไฟล์ใหม่อยู่", !existsSync(fileAt(id, autoA[0].filename)) && readFileSync(fileAt(id, autoB[0].filename), "utf8") === "source-B");
  check("รูปที่ผู้ใช้เพิ่มเองไม่ถูกแตะ (แถว + ไฟล์)", r.some((x) => x.filename === USER_FILE) && readFileSync(fileAt(id, USER_FILE), "utf8") === "user-photo");

  // entry ที่ยังไม่มีรูปเลย (เข้าคิวด้วยรูปแคปจากหน้า entry / Showcase ตัวใหม่)
  const e2 = await prisma.promptEntry.create({ data: { productName: TEST_NAME, productInfo: "", riskModule: "", extraNotes: "", images: "[]" } });
  createdEntries.push(e2.id);
  await db.replaceAutoSourceImage(root, e2.id, { buffer: Buffer.from("x"), mimeType: "image/webp" });
  const r2 = await rows(e2.id);
  check("entry ไม่มีรูปมาก่อน (ยังไม่มีโฟลเดอร์) → สร้างโฟลเดอร์ + รูปต้นทาง 1 แถว sortOrder 0", r2.length === 1 && isAutoSourceImage(r2[0].filename) && r2[0].sortOrder === 0 && r2[0].filename.endsWith(".webp") && existsSync(fileAt(e2.id, r2[0].filename)), JSON.stringify(r2));
}

/** โฟลเดอร์ flow/ ของ entry ที่มีรูปที่บอทวาดรอบ 1 กับรอบ 2 */
function seedFlowFiles(entryId: string) {
  mkdirSync(path.join(root, entryId, "flow"), { recursive: true });
  writeFileSync(path.join(root, entryId, "flow", "r1-a1-2.png"), "flow-r1");
  writeFileSync(path.join(root, entryId, "flow", "r2-a1-0.png"), "flow-r2");
  return [
    { filename: "r1-a1-2.png", mimeType: "image/png", round: 1 as const },
    { filename: "r2-a1-0.png", mimeType: "image/png", round: 2 as const },
  ];
}

async function round2Choose() {
  console.log("\n== เลือกรูปรอบ 2: รูปต้นทางอัตโนมัติถูกแทนด้วยรูปที่ Flow วาด ==");
  const id = await entryWithUserImage();
  await db.replaceAutoSourceImage(root, id, { buffer: Buffer.from("source"), mimeType: "image/jpeg" });
  const auto = (await rows(id)).find((x) => isAutoSourceImage(x.filename))!;
  const picks = seedFlowFiles(id);

  const removed = await prisma.$transaction((tx) => db.replaceAutoSourceWithFlowImages(tx, root, id, picks));
  check("ไฟล์รูปต้นทางยังอยู่จนกว่าทรานแซกชัน commit แล้วผู้เรียกลบเอง", existsSync(fileAt(id, auto.filename)) && removed.length === 1 && removed[0] === auto.filename, JSON.stringify(removed));
  await db.removeAutomaticImageFiles(root, id, removed);

  const r = await rows(id);
  check(
    "หลังเลือกรอบ 2: ไม่มีรูปต้นทางอัตโนมัติ · รูปผู้ใช้อยู่ที่เดิม · รูปที่ Flow วาด 2 รูป caption ตั้งต้นตามรอบ",
    !r.some((x) => isAutoSourceImage(x.filename)) &&
      r.length === 3 &&
      r[0].filename === USER_FILE &&
      r[1].caption === "สินค้า พื้นหลังขาว" && r[2].caption === "สินค้าตอนใช้งาน" &&
      r[1].sortOrder === 1 && r[2].sortOrder === 2 && r[1].mimeType === "image/png",
    JSON.stringify(r),
  );
  check("ไฟล์รูปต้นทางอัตโนมัติถูกลบ", !existsSync(fileAt(id, auto.filename)));
  check(
    "ไฟล์ของรูปที่ Flow วาดถูกก๊อปเข้าโฟลเดอร์ entry (ต้นฉบับใน flow/ ยังอยู่) · ไฟล์ผู้ใช้ยังอยู่",
    readFileSync(fileAt(id, r[1].filename), "utf8") === "flow-r1" && readFileSync(fileAt(id, r[2].filename), "utf8") === "flow-r2" &&
      existsSync(path.join(root, id, "flow", "r1-a1-2.png")) && readFileSync(fileAt(id, USER_FILE), "utf8") === "user-photo",
  );

  // entry ที่ไม่เคยมีรูปต้นทางอัตโนมัติ (ผู้ใช้ลบเองไปแล้ว / งานเก่าก่อนมีฟีเจอร์นี้) — เลือกรอบ 2 ได้ตามเดิม
  const id2 = await entryWithUserImage();
  const removed2 = await prisma.$transaction((tx) => db.replaceAutoSourceWithFlowImages(tx, root, id2, seedFlowFiles(id2)));
  const r2 = await rows(id2);
  check("ไม่มีรูปต้นทางอัตโนมัติ → ไม่มีอะไรให้ลบ ได้รูปผู้ใช้ + รูป Flow 2 รูป", removed2.length === 0 && r2.length === 3 && r2[0].filename === USER_FILE, JSON.stringify({ removed2, r2 }));
}

/**
 * เปลี่ยนรูปต้นทางหลังเลือกรอบ 2 แล้ว (awaiting_prompt / queued_r3) แล้วเลือกรอบ 2 ใหม่ — รูปที่ Flow วาดจากรูปต้นทางเก่าต้องไม่ค้าง
 * (Gemini จะได้รูปของรูปต้นทางเก่า) · รูปที่ผู้ใช้เพิ่มเอง และรูปรอบ 2 รุ่นเก่า (ก่อนมี auto-flow- ชื่อ uuid ล้วน) ไม่ถูกแตะ
 */
async function automaticCopiesAreReplaced() {
  console.log("\n== รูปที่ Flow วาด (รอบ 2) เป็นรูปอัตโนมัติ: เปลี่ยนรูปต้นทาง / เลือกรอบ 2 ใหม่ แทนที่ ==");
  const id = await entryWithUserImage();
  // รูปรอบ 2 รุ่นเก่า (ก๊อปก่อนมี prefix) — แยกจากรูปที่ผู้ใช้เพิ่มเองไม่ได้ ต้องไม่ถูกแตะ
  const LEGACY = "6f1c2d3e-0000-4000-8000-000000000001.png";
  writeFileSync(fileAt(id, LEGACY), "legacy-flow");
  await prisma.productImage.create({ data: { entryId: id, filename: LEGACY, mimeType: "image/png", caption: "สินค้า พื้นหลังขาว", sortOrder: 1 } });
  await db.replaceAutoSourceImage(root, id, { buffer: Buffer.from("source-1"), mimeType: "image/jpeg" });

  const removed1 = await prisma.$transaction((tx) => db.replaceAutoSourceWithFlowImages(tx, root, id, seedFlowFiles(id)));
  await db.removeAutomaticImageFiles(root, id, removed1);
  let r = await rows(id);
  const flow1 = r.filter((x) => ai.isAutoFlowImage(x.filename));
  check("เลือกรอบ 2 → รูปที่ Flow วาด 2 รูปชื่อขึ้นต้น auto-flow- (caption ตั้งต้น) · ไม่มีรูปต้นทางอัตโนมัติ",
    flow1.length === 2 && flow1[0].caption === "สินค้า พื้นหลังขาว" && flow1[1].caption === "สินค้าตอนใช้งาน" && !r.some((x) => isAutoSourceImage(x.filename)),
    JSON.stringify(r));

  // เปลี่ยนรูปต้นทาง (changeSourcePhoto เรียกตัวนี้) → รูป Flow อัตโนมัติออกทั้งแถวและไฟล์ รูปต้นทางใหม่เข้าที่ตำแหน่งแรกของรูปอัตโนมัติ
  await db.replaceAutoSourceImage(root, id, { buffer: Buffer.from("source-2"), mimeType: "image/png" });
  r = await rows(id);
  const src2 = r.filter((x) => isAutoSourceImage(x.filename));
  check("เปลี่ยนรูปต้นทางหลังเลือกรอบ 2 → รูป Flow อัตโนมัติออกหมด · รูปต้นทางใหม่ 1 แถว ที่ตำแหน่งของรูปอัตโนมัติแรก",
    !r.some((x) => ai.isAutoFlowImage(x.filename)) && src2.length === 1 && src2[0].sortOrder === flow1[0].sortOrder &&
      readFileSync(fileAt(id, src2[0].filename), "utf8") === "source-2",
    JSON.stringify(r));
  check("ไฟล์รูป Flow อัตโนมัติเก่าถูกลบ (ต้นฉบับใน flow/ ยังอยู่)",
    flow1.every((x) => !existsSync(fileAt(id, x.filename))) && existsSync(path.join(root, id, "flow", "r1-a1-2.png")));
  check("รูปผู้ใช้ + รูปรอบ 2 รุ่นเก่า (ไม่มี prefix) ไม่ถูกแตะ (แถว + ไฟล์ + caption)",
    r.some((x) => x.filename === USER_FILE && x.caption === "ของผู้ใช้") && r.some((x) => x.filename === LEGACY && x.caption === "สินค้า พื้นหลังขาว") &&
      readFileSync(fileAt(id, LEGACY), "utf8") === "legacy-flow" && readFileSync(fileAt(id, USER_FILE), "utf8") === "user-photo");

  // เลือกรอบ 2 ใหม่ → รูป Flow อัตโนมัติ 2 รูปชุดใหม่เท่านั้น (ไม่สะสมเป็น 4)
  const removed2 = await prisma.$transaction((tx) => db.replaceAutoSourceWithFlowImages(tx, root, id, seedFlowFiles(id)));
  await db.removeAutomaticImageFiles(root, id, removed2);
  r = await rows(id);
  const flow2 = r.filter((x) => ai.isAutoFlowImage(x.filename));
  check("เลือกรอบ 2 ใหม่ → รูป Flow อัตโนมัติ 2 รูป (ไม่สะสม) · รูปต้นทางอัตโนมัติออก · รวม 4 แถว (ผู้ใช้ + รุ่นเก่า + 2)",
    flow2.length === 2 && !r.some((x) => isAutoSourceImage(x.filename)) && r.length === 4 && !existsSync(fileAt(id, src2[0].filename)),
    JSON.stringify(r));

  // เลือกรอบ 2 ซ้ำโดยไม่ได้เปลี่ยนรูปต้นทาง (งานใหม่ของ entry เดิม) → แทนชุดเดิม ไฟล์ชุดเดิมลบหลัง commit
  const removed3 = await prisma.$transaction((tx) => db.replaceAutoSourceWithFlowImages(tx, root, id, seedFlowFiles(id)));
  check("รูป Flow อัตโนมัติเก่า: แถวออกในทรานแซกชัน ไฟล์ยังอยู่จนผู้เรียกลบหลัง commit",
    removed3.length === 2 && removed3.every((f) => ai.isAutoFlowImage(f) && existsSync(fileAt(id, f))), JSON.stringify(removed3));
  await db.removeAutomaticImageFiles(root, id, removed3);
  r = await rows(id);
  check("หลังลบ: รูป Flow อัตโนมัติ 2 รูปชุดล่าสุด · ไฟล์ชุดก่อนหาย", r.filter((x) => ai.isAutoFlowImage(x.filename)).length === 2 && removed3.every((f) => !existsSync(fileAt(id, f))));
}

async function round2Rollback() {
  console.log("\n== เลือกรอบ 2 พังกลางทาง: ไม่เสียรูปต้นทาง ==");
  const id = await entryWithUserImage();
  await db.replaceAutoSourceImage(root, id, { buffer: Buffer.from("source"), mimeType: "image/jpeg" });
  const before = await rows(id);
  const auto = before.find((x) => isAutoSourceImage(x.filename))!;
  const picks = seedFlowFiles(id);
  rmSync(path.join(root, id, "flow", picks[1].filename)); // ไฟล์รอบ 2 หาย → copyFile พัง
  let threw = false;
  try {
    await prisma.$transaction((tx) => db.replaceAutoSourceWithFlowImages(tx, root, id, picks));
  } catch {
    threw = true;
  }
  const after = await rows(id);
  const entryFiles = (await import("node:fs")).readdirSync(path.join(root, id)).filter((f) => f !== "flow").sort();
  check(
    "copyFile พัง → rollback: แถวเหมือนเดิม (รูปต้นทางยังอยู่) · ไฟล์รูปต้นทางยังอยู่ · ไม่มีไฟล์ก๊อปค้าง",
    threw && JSON.stringify(after) === JSON.stringify(before) && existsSync(fileAt(id, auto.filename)) &&
      JSON.stringify(entryFiles) === JSON.stringify([auto.filename, USER_FILE].sort()),
    JSON.stringify({ threw, after, entryFiles }),
  );
}

async function neverTouchesOthers() {
  console.log("\n== ลบไฟล์ได้เฉพาะรูปต้นทางอัตโนมัติในโฟลเดอร์ของ entry ==");
  const id = await entryWithUserImage();
  writeFileSync(path.join(root, "outside.jpg"), "outside");
  await db.removeAutomaticImageFiles(root, id, [USER_FILE, "../outside.jpg", "auto-source-x/../../outside.jpg", "auto-flow-x/../../outside.jpg"]);
  check("ชื่อที่ไม่มี prefix / มี path → ไม่ลบอะไรเลย", existsSync(fileAt(id, USER_FILE)) && existsSync(path.join(root, "outside.jpg")));
  await db.removeAutomaticImageFiles(root, id, ["auto-source-missing.jpg"]);
  check("ไฟล์รูปต้นทางที่หายไปแล้วไม่ทำให้พัง", true);
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("usage: npx tsx scripts/check-product-image-source-db.ts <path to a COPY of dev.db>");
    process.exit(2);
  }
  const abs = path.resolve(arg);
  if (abs.toLowerCase() === path.join(REPO, "dev.db").toLowerCase() || path.basename(abs).toLowerCase() === "dev.db") {
    console.error("ไม่รับ dev.db ตัวจริง — ก๊อปเป็นไฟล์อื่นก่อน");
    process.exit(2);
  }
  process.env.DATABASE_URL = `file:${abs.split(path.sep).join("/")}`;
  prisma = (await import("@/lib/prisma")).prisma;
  db = await import("@/lib/auto-source-image-db");
  root = mkdtempSync(path.join(os.tmpdir(), "check-product-image-source-"));

  try {
    await enqueueReplaces();
    await round2Choose();
    await automaticCopiesAreReplaced();
    await round2Rollback();
    await neverTouchesOthers();
  } catch (e) {
    failures++;
    console.log(`FAIL (โยน error) ${e instanceof Error ? e.stack : String(e)}`);
  } finally {
    await prisma.promptEntry.deleteMany({ where: { id: { in: createdEntries }, productName: TEST_NAME } });
    await prisma.$disconnect();
    rmSync(root, { recursive: true, force: true });
  }
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
