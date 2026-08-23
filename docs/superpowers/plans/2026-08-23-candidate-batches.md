# แยกสินค้าที่แคปมาเป็น "ชุด" (CandidateBatch) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ทำให้การอัปแคปหน้าจัดอันดับแต่ละครั้งกลายเป็น "ชุด" ที่แยกขาดจากกัน หน้าเว็บแสดงเฉพาะชุดล่าสุดของแต่ละหมวด และลบชุดเก่าได้ทั้งชุด

**Architecture:** เพิ่มตาราง `CandidateBatch` แล้วผูก `ProductCandidate` เข้ากับชุดด้วย `batchId` (cascade) · `nameKey` เปลี่ยนจาก unique ทั้งตารางเป็น unique ต่อชุด · ตัดคอลัมน์ `status` และระบบ triage (สนใจ/ปัดตก) ทิ้งทั้งหมด เหลือ `linkedEntryId` เป็นข้อเท็จจริงที่ระบบบันทึกเอง · ป้ายแนะนำคิดท็อป 3 แยกตาม (ชุด × หมวด)

**Tech Stack:** Next.js 16.2.10 (App Router, Server Actions) · Prisma 7 + `@prisma/adapter-better-sqlite3` · SQLite · React 19 client component · Tailwind v4

**Spec:** `docs/superpowers/specs/2026-08-23-candidate-batches-design.md`

## Global Constraints

- **ห้ามรัน `npm run build` / `npm run dev` ที่ชน port 3000** — ผู้ใช้รัน `start.bat` อยู่และใช้ทำงานหาเงินทุกวัน ใช้ `npx tsc --noEmit` แทน build และถ้าต้องรันแอปให้ใช้ dev server แยก: `NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001` (ก๊อป `cp dev.db dev-test.db` ก่อน)
- **ห้ามทดสอบบน `dev.db` ตัวจริง** — ใช้สำเนาเสมอ `dev.db` ไม่มี backup และไม่ได้เปิด WAL
- **ห้าม `DELETE FROM <table>` แบบไม่มี `WHERE`**
- เช็ก `git diff tsconfig.json` ก่อน commit ทุกครั้ง ถ้าเปลี่ยนให้ `git checkout -- tsconfig.json` (dev server แก้เอง)
- ห้าม `git add -A` — ระบุไฟล์เสมอ · ห้ามใส่ emoji ในโค้ด/คอมมิต
- UI ภาษาไทยทั้งหมด · ห้ามขนาดตัวอักษร arbitrary (`text-[...]`) ใช้ `text-xs`/`sm`/`base`/`lg`/`xl`/`2xl`/`3xl` เท่านั้น · ห้าม hex ในไฟล์ `components/*`
- `--border` = เส้นคั่นตกแต่ง · `--border-interactive` = ขอบของสิ่งที่กดได้ อย่าสลับกัน
- `line-height` ข้อความไทยขั้นต่ำ 1.6 (`leading-relaxed`) · ห้าม `tracking-widest`/`uppercase` กับข้อความไทย
- ปุ่มสูงขั้นต่ำ 44px ที่ต่ำกว่า `lg:` — คุมจาก `size` ใน `components/ui/button.tsx` อย่าเขียนความสูงเอง
- **JetBrains Mono (`font-mono`) ใช้ได้เฉพาะตัวเลขที่เรียงเป็นคอลัมน์ ห้ามใช้กับข้อความไทย** (ไม่มี glyph ไทย)
- generated Prisma client ไม่มี index barrel — import จาก `@/lib/generated/prisma/client` โดยตรง
- หลังแก้ `prisma/schema.prisma` ต้อง `npx prisma generate` เสมอ

---

## File Structure

| ไฟล์ | หน้าที่ | Task |
|---|---|---|
| `prisma/schema.prisma` | เพิ่ม `CandidateBatch` · แก้ `ProductCandidate` | 1 |
| `prisma/migrations/<ts>_add_candidate_batch/migration.sql` | สร้างตาราง + ย้ายข้อมูลเดิม 162 แถวเข้าชุด | 1 |
| `lib/candidates.ts` | ตรรกะบริสุทธิ์: ป้ายท็อป 3 แยกตามชุด×หมวด + หาชุดล่าสุดต่อหมวด | 2 |
| `scripts/check-candidates.mjs` | เทสต์ของ `lib/candidates.ts` (แทน test runner ที่โปรเจกต์ไม่มี) | 2 |
| `lib/candidate-queries.ts` | คิวรีทั้งหมดของหน้านี้ — คืน `rows` + `batches` + `focus` | 2 |
| `app/actions.ts` | `extractCandidates` สร้างชุดใหม่ · เพิ่ม `deleteCandidateBatch` · ลบ `setCandidateStatus` | 2 |
| `components/candidates-route.tsx` | UI ทั้งหน้า: แผงรายการชุด, ปุ่มลบ, ตัวกรอง 3 ปุ่ม, คอลัมน์ปุ่มในตาราง | 2 (แค่ให้ compile ผ่าน) · 3 (ของจริง) |
| `app/products/page.tsx` | ส่ง prop ใหม่ให้ `CandidatesRoute` | 3 |

**หมายเหตุเรื่องลำดับ:** Task 1 แก้ schema อย่างเดียว ซึ่งจะทำให้ `npx tsc --noEmit` **ยังไม่เขียว** จนกว่าจะจบ Task 2 — ตั้งใจแบบนี้ เพราะการตัดคอลัมน์ `status` กับโค้ดที่อ้างถึงมันต้องเปลี่ยนพร้อมกัน แยกให้ tsc เขียวทุก task ไม่ได้จริง Task 1 จึงตรวจด้วยสคริปต์เช็คฐานข้อมูลแทน

---

### Task 1: Schema + migration + ย้ายข้อมูลเดิม

**Files:**
- Modify: `prisma/schema.prisma` (บล็อก `model ProductCandidate` ท้ายไฟล์)
- Create: `prisma/migrations/<timestamp>_add_candidate_batch/migration.sql`
- Create (ชั่วคราว ลบทิ้งก่อน commit): `scripts/tmp-verify-batch-migration.js`

**Interfaces:**
- Consumes: ไม่มี
- Produces: ตาราง `CandidateBatch { id, capturedOn, createdAt }` · `ProductCandidate.batchId` (required, FK cascade) · `@@unique([batchId, nameKey])` · คอลัมน์ `status` หายไป · Prisma client มี `prisma.candidateBatch`

- [ ] **Step 1: แก้ `prisma/schema.prisma`**

แทนที่บล็อก `model ProductCandidate` ทั้งบล็อก (รวม doc comment เดิมด้านบน) ด้วย:

```prisma
/// 1 ชุด = 1 ครั้งที่กด "อ่านข้อมูลจากรูป" — เป็นภาพนิ่งของลิสต์จัดอันดับ ณ เวลานั้น
///
/// ไม่เก็บ categoryLabel ที่ระดับชุด เพราะ 1 ชุดมีได้หลายหมวด (ผู้ใช้แปะแคปหลายหมวดพร้อมกันได้)
/// หมวดอยู่ที่ระดับแถว การสรุปว่าชุดนี้มีหมวดอะไรบ้างจึงคำนวณจากแถวเอา
model CandidateBatch {
  id         String             @id @default(cuid())
  /// เวลาที่กดอ่านข้อมูลจากรูป — ใช้ตัดสินว่าชุดไหนใหม่กว่าของหมวดเดียวกัน
  capturedOn DateTime
  createdAt  DateTime           @default(now())
  rows       ProductCandidate[]

  @@index([capturedOn])
}

/// สินค้าที่กำลังพิจารณาว่าจะทำคลิปไหม — มาจากแคปหน้าจัดอันดับ TikTok Shop
///
/// ไม่ผูก relation กับ PromptEntry โดยตั้งใจ (เก็บ linkedEntryId เป็น String เปล่า)
/// เพราะงานที่ทำไปแล้วไม่ควรหายตามเมื่อลบชุด — ลบชุดแล้วเสียแค่ "ลิงก์" ไม่ใช่ตัว entry
model ProductCandidate {
  id            String         @id @default(cuid())
  batchId       String
  batch         CandidateBatch @relation(fields: [batchId], references: [id], onDelete: Cascade)
  /// ชื่อเต็มตามภาพ ไม่ย่อ
  name          String
  /// normalizeName(name) — unique ต่อชุด ไม่ใช่ทั้งตาราง: สินค้าเดิมอยู่คนละชุดได้
  /// แต่ในชุดเดียวกันยังกันซ้ำอยู่ เพราะแคปแบบเลื่อนจอมักมีสินค้าซ้ำตรงรอยต่อภาพ
  nameKey       String
  price         Float
  commission    Float
  /// null = แคปมาจากหน้าที่ไม่มีตัวเลขยอดขาย (แถบ "คะแนนสูงสุด")
  weeklySales   Int?
  /// ชื่อหมวดที่ AI อ่านจากหัวข้อบนสุดของภาพ
  categoryLabel String
  /// เท่ากับ capturedOn ของชุดเสมอ เก็บซ้ำไว้เพื่อให้คิวรีรายแถวไม่ต้อง join
  capturedOn    DateTime
  note          String         @default("")
  /// เซ็ตโดยระบบตอนกด "สร้างงานเลย" ไม่ใช่ป้ายที่ผู้ใช้ติดเอง
  linkedEntryId String?
  createdAt     DateTime       @default(now())

  @@unique([batchId, nameKey])
  @@index([categoryLabel])
  @@index([batchId])
}
```

- [ ] **Step 2: สร้างโครง migration แบบยังไม่ apply**

Run: `npx prisma migrate dev --create-only --name add_candidate_batch`

Expected: สร้างโฟลเดอร์ `prisma/migrations/<timestamp>_add_candidate_batch/` พร้อม `migration.sql` ที่ Prisma เขียนให้

- [ ] **Step 3: เขียนทับ `migration.sql` ทั้งไฟล์**

SQL ที่ Prisma เขียนให้จะไม่ backfill `batchId` (คอลัมน์ required ใหม่) จึงต้องเขียนเอง เขียนทับด้วยไฟล์นี้ทั้งไฟล์:

```sql
-- CreateTable
CREATE TABLE "CandidateBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "capturedOn" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "CandidateBatch_capturedOn_idx" ON "CandidateBatch"("capturedOn");

-- ย้ายข้อมูลเดิม: 1 ชุดต่อ 1 "วันเวลาไทย" ที่เคยเก็บ
--
-- capturedOn เก็บเป็น TEXT ISO 8601 (เช่น "2026-08-20T05:50:43.452+00:00") ไม่ใช่ integer
-- SQLite จึง parse ตรงได้เลย ห้ามใช้สูตร unixepoch (ลองแล้วได้ 1970-01-01 ทุกแถว)
--
-- '+7 hours' = ตัดวันตามเวลาไทย ไม่ใช่ UTC — บั๊กคลาสเดียวกับ toDateInputValue/
-- toLocalDateInputValue ใน production-panel.tsx ถ้าตัดด้วย UTC การอัปก่อน 7 โมงเช้า
-- จะถูกจัดเข้าวันก่อนหน้า
--
-- วัดกับข้อมูลจริงแล้ว (2026-08-23): ได้ 4 ชุด (18, 19, 20, 23 ส.ค.) รวม 162 แถว
-- และไม่มี nameKey ซ้ำภายในวันเดียวกันเลย จึงไม่ชน @@unique([batchId, nameKey])
INSERT INTO "CandidateBatch" ("id", "capturedOn", "createdAt")
SELECT
    'legacy-' || DATE("capturedOn", '+7 hours'),
    MIN("capturedOn"),
    CURRENT_TIMESTAMP
FROM "ProductCandidate"
GROUP BY DATE("capturedOn", '+7 hours');

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ProductCandidate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "price" REAL NOT NULL,
    "commission" REAL NOT NULL,
    "weeklySales" INTEGER,
    "categoryLabel" TEXT NOT NULL,
    "capturedOn" DATETIME NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "linkedEntryId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductCandidate_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "CandidateBatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ProductCandidate" ("id", "batchId", "name", "nameKey", "price", "commission", "weeklySales", "categoryLabel", "capturedOn", "note", "linkedEntryId", "createdAt")
SELECT
    "id",
    'legacy-' || DATE("capturedOn", '+7 hours'),
    "name",
    "nameKey",
    "price",
    "commission",
    "weeklySales",
    "categoryLabel",
    "capturedOn",
    "note",
    "linkedEntryId",
    "createdAt"
FROM "ProductCandidate";
DROP TABLE "ProductCandidate";
ALTER TABLE "new_ProductCandidate" RENAME TO "ProductCandidate";
CREATE UNIQUE INDEX "ProductCandidate_batchId_nameKey_key" ON "ProductCandidate"("batchId", "nameKey");
CREATE INDEX "ProductCandidate_categoryLabel_idx" ON "ProductCandidate"("categoryLabel");
CREATE INDEX "ProductCandidate_batchId_idx" ON "ProductCandidate"("batchId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
```

- [ ] **Step 4: ทดสอบ migration บนสำเนาก่อน แล้วค่อยแตะของจริง**

```bash
cp dev.db dev-test.db
DATABASE_URL="file:./dev-test.db" npx prisma migrate deploy
```

Expected: `Applying migration ...add_candidate_batch` แล้วจบด้วย success ไม่มี error เรื่อง constraint

- [ ] **Step 5: เขียนสคริปต์ตรวจผลการย้ายข้อมูล**

สร้าง `scripts/tmp-verify-batch-migration.js` (ไฟล์ชั่วคราว จะลบก่อน commit):

```js
// ตรวจว่า migration ย้ายข้อมูลครบ — รันกับ dev-test.db เท่านั้น
const path = require("node:path");
const Database = require(path.join(process.cwd(), "node_modules", "better-sqlite3"));

const db = new Database(path.join(process.cwd(), "dev-test.db"), { readonly: true });

const batches = db.prepare(`SELECT id, capturedOn FROM CandidateBatch ORDER BY capturedOn`).all();
const rowCount = db.prepare(`SELECT COUNT(*) AS n FROM ProductCandidate`).get().n;
const orphans = db
  .prepare(
    `SELECT COUNT(*) AS n FROM ProductCandidate p
     LEFT JOIN CandidateBatch b ON b.id = p.batchId
     WHERE b.id IS NULL`
  )
  .get().n;
const linked = db
  .prepare(`SELECT COUNT(*) AS n FROM ProductCandidate WHERE linkedEntryId IS NOT NULL`)
  .get().n;
const hasStatus = db
  .prepare(`SELECT COUNT(*) AS n FROM pragma_table_info('ProductCandidate') WHERE name = 'status'`)
  .get().n;

let failed = 0;
const check = (name, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` — ได้ ${actual} ควรได้ ${expected}`}`);
};

console.log("ชุดที่ได้:", batches.map((b) => b.id).join(", "));
check("จำนวนชุด = 4", batches.length, 4);
check("จำนวนแถวยังครบ 162", rowCount, 162);
check("ไม่มีแถวกำพร้า (batchId ชี้ไปที่ชุดที่ไม่มีจริง)", orphans, 0);
check("แถวที่ผูก entry ยังครบ 5", linked, 5);
check("คอลัมน์ status ถูกลบแล้ว", hasStatus, 0);

db.close();
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 6: รันสคริปต์ตรวจ**

Run: `node scripts/tmp-verify-batch-migration.js`

Expected: PASS ทั้ง 5 ข้อ และพิมพ์ชุด `legacy-2026-08-18, legacy-2026-08-19, legacy-2026-08-20, legacy-2026-08-23`

- [ ] **Step 7: apply migration กับ `dev.db` จริง แล้ว regenerate client**

```bash
npx prisma migrate deploy
npx prisma generate
```

Expected: migration apply สำเร็จ และ `lib/generated/prisma/` ถูกสร้างใหม่ (ไฟล์นี้ gitignore ไว้)

- [ ] **Step 8: เช็คว่า Prisma ไม่มองว่า schema กับ migration ไม่ตรงกัน**

Run: `npx prisma migrate status`

Expected: `Database schema is up to date!` — ถ้าขึ้น drift แปลว่า SQL ที่เขียนเองสร้างโครงไม่ตรงกับ schema ให้เทียบชื่อ index/constraint ให้ตรงเป๊ะ

- [ ] **Step 9: ลบไฟล์ชั่วคราวแล้ว commit**

```bash
rm scripts/tmp-verify-batch-migration.js
rm -f dev-test.db
git diff tsconfig.json
git add prisma/schema.prisma prisma/migrations
git commit -m "Add CandidateBatch and scope candidates to a batch

Rows were keyed by product name across all time, so products that drop
out of TikTok's ranking lingered forever — 25 of 162 real rows were
already stale leftovers. Each upload now owns its rows through a batch,
and nameKey is unique per batch rather than globally.

Drops the status column: interested/rejected triage is being removed
entirely, and keeping it would force a ~40-item re-triage every refresh
once batches are independent.

Backfills existing rows into one batch per Thai-local capture day
(4 batches, 162 rows preserved, 5 entry links intact). Grouping uses
DATE(capturedOn, '+7 hours') because capturedOn is stored as ISO text,
not epoch integers, and UTC day boundaries would misfile uploads made
before 7am local."
```

---

### Task 2: ตรรกะและ server layer

**Files:**
- Modify: `lib/candidates.ts` (`TOP_BADGE_COUNT`, `pickCandidateBadges`, เพิ่ม `latestBatchPerCategory`)
- Modify: `scripts/check-candidates.mjs` (บล็อกเทสต์ป้าย บรรทัด ~123-212)
- Modify: `lib/candidate-queries.ts` (ทั้งไฟล์)
- Modify: `app/actions.ts` (`extractCandidates` ~944-1015, `setCandidateStatus` ~1017-1027, `createEntryFromCandidate` ~1055-1058)
- Modify: `components/candidates-route.tsx` (เฉพาะเท่าที่ต้องแก้ให้ compile ผ่าน — ของจริงอยู่ Task 3)

**Interfaces:**
- Consumes: `prisma.candidateBatch` และ `ProductCandidate.batchId` จาก Task 1
- Produces:
  - `pickCandidateBadges(rows: { id: string; batchId: string; commission: number; commissionPercent: number; weeklySales: number | null; categoryLabel: string }[]): Map<string, CandidateBadge[]>`
  - `latestBatchPerCategory(rows: { batchId: string; categoryLabel: string; capturedOn: Date }[]): Map<string, string>`
  - `getCandidatesData(): Promise<{ rows: CandidateRow[]; batches: BatchSummary[]; focus: FocusCategory[] }>`
  - `CandidateRow` มี `batchId: string` และ `isLatestForCategory: boolean` ไม่มี `status`
  - `BatchSummary = { id: string; capturedOn: Date; rowCount: number; categories: { label: string; count: number }[]; isLatestForAnyCategory: boolean }`
  - `extractCandidates(formData: FormData): Promise<{ batchId: string; added: number; skipped: number }>`
  - `deleteCandidateBatch(batchId: string): Promise<void>`

- [ ] **Step 1: เขียนเทสต์ที่ต้องตกก่อน — ป้ายท็อป 3 และแยกตามชุด**

ใน `scripts/check-candidates.mjs` แทนที่บล็อกตั้งแต่คอมเมนต์ `// --- pickCandidateBadges (TOP_BADGE_COUNT = 4, ...` (บรรทัด ~123) จนถึงก่อน `// --- คำนวณ ---` (บรรทัด ~214) ด้วย:

```js
  // --- pickCandidateBadges (TOP_BADGE_COUNT = 3, badge เก็บ rank ด้วย) ---
  // ไม่มีเกณฑ์ %ค่าคอมเทียบร้านอีกแล้ว (ถอดออก 2026-08-19) — จัดอันดับด้วยเงินจริงล้วนๆ
  // เหลือเกณฑ์กรองเดียว: %สมเหตุสมผล (≤100%, กันข้อมูลราคาอ่านผิด)
  // ไม่มี status ให้กรองแล้ว (ตัดระบบปัดตก/สนใจทิ้งทั้งหมด 2026-08-23)
  const B = "batch-1";
  const badgeRows = [
    { id: "junk", batchId: B, commission: 300, commissionPercent: 6901, weeklySales: 9000, categoryLabel: "หมวดทดสอบ" }, // %ไม่น่าเชื่อถือ (ราคาอ่านผิด) -> ไม่ติดป้ายแม้ตัวเลขดิบสูงสุดในชุด
    { id: "top", batchId: B, commission: 100, commissionPercent: 10.0, weeklySales: 1000, categoryLabel: "หมวดทดสอบ" }, // อันดับ 1 ทั้งยอดขายและค่าคอม -> ติด 2 ป้าย rank 1 พร้อมกัน
    { id: "s2", batchId: B, commission: 9, commissionPercent: 10.0, weeklySales: 900, categoryLabel: "หมวดทดสอบ" },
    { id: "s3", batchId: B, commission: 8, commissionPercent: 10.0, weeklySales: 800, categoryLabel: "หมวดทดสอบ" },
    { id: "s4", batchId: B, commission: 7, commissionPercent: 10.0, weeklySales: 700, categoryLabel: "หมวดทดสอบ" }, // อันดับ 4 ยอดขาย -> เกิน TOP_BADGE_COUNT=3 ไม่ติดป้าย
    // เคสจริง (2026-08-19, หมวดโซฟา): สินค้า %ต่ำมาก (2.3%) แต่ค่าคอมบาทสูง (Woodpanda ฿249.95/ชิ้น)
    // เคยถูกกรองทิ้งเพราะ %ต่ำกว่าเกณฑ์ร้าน ทั้งที่จ่ายเงินจริงมากกว่าตัวที่เคยติดป้าย
    { id: "lowpercent", batchId: B, commission: 95, commissionPercent: 2.3, weeklySales: 10, categoryLabel: "หมวดทดสอบ" },
    { id: "c3", batchId: B, commission: 80, commissionPercent: 10.0, weeklySales: 40, categoryLabel: "หมวดทดสอบ" }, // อันดับ 4 ค่าคอม -> เกิน TOP_BADGE_COUNT ไม่ติดป้าย
    { id: "f", batchId: B, commission: 85, commissionPercent: 10.0, weeklySales: null, categoryLabel: "หมวดทดสอบ" }, // ไม่มียอดขาย -> ชิงป้ายยอดขายดีไม่ได้ แต่ยังชิงป้ายค่าคอมสูงสุดได้ปกติ
  ];
  const badges = c.pickCandidateBadges(badgeRows);
  checkDeep(
    "แถว top อันดับ 1 ทั้งยอดขายและค่าคอม -> ติด 2 ป้าย rank 1 พร้อมกัน",
    badges.get("top"),
    [{ type: "topSeller", rank: 1 }, { type: "topCommission", rank: 1 }]
  );
  checkDeep("แถว s2 ยอดขายอันดับ 2 -> ติดป้ายยอดขายดี rank 2", badges.get("s2"), [{ type: "topSeller", rank: 2 }]);
  checkDeep("แถว s3 ยอดขายอันดับ 3 -> ติดป้ายยอดขายดี rank 3", badges.get("s3"), [{ type: "topSeller", rank: 3 }]);
  check("แถว s4 ยอดขายอันดับ 4 -> เกิน TOP_BADGE_COUNT=3 ไม่ติดป้าย", badges.has("s4"), false);
  checkDeep(
    "แถว lowpercent %ต่ำมาก (2.3%) แต่ค่าคอมบาทอันดับ 2 -> ยังติดป้ายค่าคอมสูงสุดได้ (เคส Woodpanda)",
    badges.get("lowpercent"),
    [{ type: "topCommission", rank: 2 }]
  );
  checkDeep(
    "แถว f ไม่มียอดขายแต่ค่าคอมอันดับ 3 -> ยังติดป้ายค่าคอมสูงสุดได้ (ไม่ติดยอดขายดี)",
    badges.get("f"),
    [{ type: "topCommission", rank: 3 }]
  );
  check("แถว c3 ค่าคอมอันดับ 4 -> เกิน TOP_BADGE_COUNT ไม่ติดป้าย", badges.has("c3"), false);
  check("แถว junk %ไม่น่าเชื่อถือ -> ไม่ติดป้ายเลยแม้ตัวเลขดิบสูงสุดในชุด", badges.has("junk"), false);

  // จัดอันดับด้วยเงินบาทจริงล้วนๆ — ของถูก %สูงลิ่วแต่เงินจริงน้อย (๓.๖๔ บาท) ยังคงแพ้ของแพง
  // %ต่ำกว่าแต่เงินจริงเยอะกว่า (๓๘.๗๒ บาท) ตามธรรมชาติของการจัดอันดับเอง ไม่ต้องมีเกณฑ์ %ช่วย
  const bahtVsPercent = c.pickCandidateBadges([
    { id: "cheap", batchId: B, commission: 3.64, commissionPercent: 16.2, weeklySales: null, categoryLabel: "หมวดทดสอบ" },
    { id: "pricey", batchId: B, commission: 38.72, commissionPercent: 8.9, weeklySales: null, categoryLabel: "หมวดทดสอบ" },
    { id: "mid", batchId: B, commission: 24.1, commissionPercent: 12.6, weeklySales: null, categoryLabel: "หมวดทดสอบ" },
    { id: "filler1", batchId: B, commission: 20, commissionPercent: 10.0, weeklySales: null, categoryLabel: "หมวดทดสอบ" },
  ]);
  checkDeep("ของแพงค่าคอมบาทสูง ติดป้ายค่าคอมสูงสุด rank 1", bahtVsPercent.get("pricey"), [{ type: "topCommission", rank: 1 }]);
  check(
    "ของถูก %สูงลิ่วแต่เงินจริงน้อย หลุดอันดับ 4 ตามธรรมชาติ -> ไม่ติดป้าย (ไม่ต้องพึ่งเกณฑ์ %)",
    bahtVsPercent.has("cheap"),
    false
  );

  // เคสจริง (2026-08-19): ราคา ฿0.01 (โปรโมชั่น/อ่านผิด) ทำให้ %ค่าคอมพุ่งไป 6900%
  check("%ค่าคอม 6900% ไม่น่าเชื่อถือ", c.isCommissionPercentPlausible(6900), false);
  check("%ค่าคอม 100% ยังน่าเชื่อถือ (ขอบเขต)", c.isCommissionPercentPlausible(100), true);
  check("%ค่าคอม 12.6% น่าเชื่อถือปกติ", c.isCommissionPercentPlausible(12.6), true);

  // อัปโหลด 2 ประเภทสินค้าในชุดเดียว (การ์ดจัดอันดับคนละใบ คนละสเกลตัวเลข) ต้องได้ป้ายแยกกัน
  // ประเภทละชุด ไม่ใช่รวมเป็นกองเดียวแล้วประเภทที่ตัวเลขเล็กกว่า (เฟอร์นิเจอร์) แพ้ประเภทที่
  // ตัวเลขใหญ่กว่าโดยธรรมชาติ (ของสิ้นเปลือง) ไปทั้งหมด
  const twoCategoryBadges = c.pickCandidateBadges([
    { id: "furniture-a", batchId: B, commission: 24.1, commissionPercent: 12.6, weeklySales: 103, categoryLabel: "เฟอร์นิเจอร์" },
    { id: "furniture-b", batchId: B, commission: 38.72, commissionPercent: 8.9, weeklySales: 62, categoryLabel: "เฟอร์นิเจอร์" },
    { id: "consumable-a", batchId: B, commission: 6.88, commissionPercent: 7.7, weeklySales: 5700, categoryLabel: "ของสิ้นเปลือง" },
    { id: "consumable-b", batchId: B, commission: 12.06, commissionPercent: 9.0, weeklySales: 4900, categoryLabel: "ของสิ้นเปลือง" },
  ]);
  check("2 ประเภทในชุดเดียว -> ติดป้ายรวม 4 รายการ (ไม่ใช่แค่ 2)", twoCategoryBadges.size, 4);
  check(
    "เฟอร์นิเจอร์ได้ป้ายของตัวเอง แม้ตัวเลขเล็กกว่าของสิ้นเปลืองมาก",
    twoCategoryBadges.has("furniture-a") && twoCategoryBadges.has("furniture-b"),
    true
  );

  // หัวใจของฟีเจอร์ชุด (2026-08-23): หมวดเดียวกันแต่คนละชุด ต้องคิดอันดับแยกขาดจากกัน
  // ไม่ใช่เอาของเก่ากับของใหม่มาแย่งอันดับกัน ซึ่งเป็นบั๊กที่ทำให้ต้องมีฟีเจอร์นี้ตั้งแต่ต้น
  const twoBatchBadges = c.pickCandidateBadges([
    { id: "old-1", batchId: "batch-old", commission: 999, commissionPercent: 10.0, weeklySales: 9999, categoryLabel: "โซฟา" },
    { id: "old-2", batchId: "batch-old", commission: 900, commissionPercent: 10.0, weeklySales: 9000, categoryLabel: "โซฟา" },
    { id: "new-1", batchId: "batch-new", commission: 10, commissionPercent: 10.0, weeklySales: 100, categoryLabel: "โซฟา" },
    { id: "new-2", batchId: "batch-new", commission: 9, commissionPercent: 10.0, weeklySales: 90, categoryLabel: "โซฟา" },
  ]);
  checkDeep(
    "ชุดใหม่ได้ rank 1 ของตัวเอง แม้ตัวเลขต่ำกว่าชุดเก่ามาก (ไม่ข้ามชุดมาแย่งอันดับ)",
    twoBatchBadges.get("new-1"),
    [{ type: "topSeller", rank: 1 }, { type: "topCommission", rank: 1 }]
  );
  checkDeep(
    "ชุดเก่าก็ยังมี rank 1 ของตัวเองแยกต่างหาก",
    twoBatchBadges.get("old-1"),
    [{ type: "topSeller", rank: 1 }, { type: "topCommission", rank: 1 }]
  );

  // --- latestBatchPerCategory ---
  // หมวดเดียวกันอาจอยู่หลายชุด ต้องเลือกชุดที่ capturedOn ใหม่สุดของหมวดนั้นๆ แยกกันทีละหมวด
  // (ชุดเดียวมีได้หลายหมวด และชุดที่ใหม่สุดของหมวด A อาจไม่ใช่ชุดที่ใหม่สุดของหมวด B)
  const latest = c.latestBatchPerCategory([
    { batchId: "b-aug20", categoryLabel: "โซฟา", capturedOn: new Date("2026-08-20T05:00:00Z") },
    { batchId: "b-aug23", categoryLabel: "โซฟา", capturedOn: new Date("2026-08-23T05:00:00Z") },
    { batchId: "b-aug20", categoryLabel: "ชั้นวาง", capturedOn: new Date("2026-08-20T05:00:00Z") },
  ]);
  check("โซฟา -> ชุด 23 ส.ค. (ใหม่สุดของหมวดนี้)", latest.get("โซฟา"), "b-aug23");
  check("ชั้นวาง -> ชุด 20 ส.ค. (มีชุดเดียว ไม่ถูกชุดใหม่ของหมวดอื่นแย่ง)", latest.get("ชั้นวาง"), "b-aug20");
  check("หมวดที่ไม่มีข้อมูล -> undefined", latest.get("ไม่มีจริง"), undefined);
```

- [ ] **Step 2: รันเทสต์ให้เห็นว่าตก**

Run: `node scripts/check-candidates.mjs`

Expected: FAIL — เคส `s4`/`c3` ตกเพราะ `TOP_BADGE_COUNT` ยังเป็น 4, เคส `twoBatchBadges` ตกเพราะยังไม่แยกตามชุด, และพังตอนเรียก `c.latestBatchPerCategory` เพราะยังไม่มีฟังก์ชันนี้

- [ ] **Step 3: แก้ `lib/candidates.ts`**

3.1 เปลี่ยนค่าคงที่ (บรรทัด ~163):

```ts
/** จำนวนแถวที่ติดป้ายต่อประเภท — ปรับได้ตรงนี้จุดเดียวถ้ารู้สึกว่าน้อย/เยอะไป */
const TOP_BADGE_COUNT = 3;
```

3.2 ใน doc comment ของ `pickCandidateBadges` แทนที่ย่อหน้าที่ขึ้นต้นว่า `คำนวณเฉพาะแถวที่ (1) ยังไม่ถูกปัดตก และ (2) %ค่าคอมสมเหตุสมผล` ด้วย:

```
 * คำนวณเฉพาะแถวที่ %ค่าคอมสมเหตุสมผล (≤100%) — กันแค่แถวที่ราคาอ่านผิด (เช่น ฿0.01 จากราคา
 * โปรโมชั่น) ไม่ให้ % ที่สูงเกินจริงมาปนข้อมูล ไม่ใช่การกรองคุณภาพดีล (เดิมมีเกณฑ์ "ไม่ถูกปัดตก"
 * ด้วย ถอดออกพร้อมระบบ triage ทั้งหมดเมื่อ 2026-08-23)
 *
 * **จัดกลุ่มด้วย batchId + categoryLabel ไม่ใช่ categoryLabel อย่างเดียว** — ป้ายคือ "อันดับใน
 * ลิสต์นี้" ซึ่งลิสต์คือ 1 ชุด = 1 ครั้งที่แคปมา ถ้าปล่อยให้ข้ามชุด ของที่หลุดอันดับไปแล้วจะมา
 * แย่งอันดับกับของรอบปัจจุบัน ซึ่งไม่มีความหมายและเป็นบั๊กที่ทำให้ต้องมีฟีเจอร์ชุดตั้งแต่ต้น
```

3.3 เปลี่ยน signature และการจัดกลุ่ม (แทนที่ตั้งแต่ `export function pickCandidateBadges(` ถึงบรรทัด `  for (const group of byCategory.values()) {` และบรรทัด `eligible` ที่ตามมา):

```ts
export function pickCandidateBadges(
  rows: {
    id: string;
    batchId: string;
    commission: number;
    commissionPercent: number;
    weeklySales: number | null;
    categoryLabel: string;
  }[]
): Map<string, CandidateBadge[]> {
  const result = new Map<string, CandidateBadge[]>();

  const addBadge = (id: string, badge: CandidateBadge) => {
    const existing = result.get(id);
    if (existing) existing.push(badge);
    else result.set(id, [badge]);
  };

  //   เป็นตัวคั่นเพราะเป็นอักขระเดียวที่ชื่อหมวดจาก AI เป็นไปไม่ได้ที่จะมี
  const byGroup = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = `${r.batchId} ${r.categoryLabel}`;
    const group = byGroup.get(key);
    if (group) group.push(r);
    else byGroup.set(key, [r]);
  }

  for (const group of byGroup.values()) {
    const eligible = group.filter((r) => isCommissionPercentPlausible(r.commissionPercent));
```

(ส่วนที่เหลือของฟังก์ชันตั้งแต่ `eligible.filter((r) => r.weeklySales !== null)` ลงไปไม่ต้องแก้)

3.4 เพิ่มฟังก์ชันใหม่ต่อท้าย `pickCandidateBadges` (ก่อน doc comment ของ `categorize`):

```ts
/**
 * หา "ชุดล่าสุด" ของแต่ละหมวด — คืน Map<categoryLabel, batchId>
 *
 * ต้องคิดแยกทีละหมวด ไม่ใช่หาชุดที่ใหม่สุดทั้งหมดแล้วใช้ร่วมกัน เพราะ 1 ชุดมีได้หลายหมวด
 * และผู้ใช้ไม่ได้รีเฟรชทุกหมวดพร้อมกัน — ชุดที่ใหม่สุดของ "โซฟา" อาจเป็นคนละชุดกับชุดที่
 * ใหม่สุดของ "ชั้นวาง" ถ้าใช้ชุดใหม่สุดตัวเดียวร่วมกัน หมวดที่ไม่ได้รีเฟรชรอบนี้จะหายไปทั้งหมด
 */
export function latestBatchPerCategory(
  rows: { batchId: string; categoryLabel: string; capturedOn: Date }[]
): Map<string, string> {
  const best = new Map<string, { batchId: string; at: number }>();
  for (const r of rows) {
    const at = r.capturedOn.getTime();
    const prev = best.get(r.categoryLabel);
    if (prev === undefined || at > prev.at) {
      best.set(r.categoryLabel, { batchId: r.batchId, at });
    }
  }
  const result = new Map<string, string>();
  for (const [category, v] of best) result.set(category, v.batchId);
  return result;
}
```

- [ ] **Step 4: รันเทสต์ให้ผ่าน**

Run: `node scripts/check-candidates.mjs`

Expected: `ผ่านทุกเคส` และ exit code 0

- [ ] **Step 5: เขียน `lib/candidate-queries.ts` ใหม่ทั้งไฟล์**

```ts
import { prisma } from "@/lib/prisma";
import { PAID_STATUS } from "@/lib/affiliate";
import {
  categorize,
  commissionPercent,
  demandTotal,
  detectFlags,
  latestBatchPerCategory,
  pickCandidateBadges,
  type CandidateBadge,
  type CandidateFlag,
} from "@/lib/candidates";

export type CandidateRow = {
  id: string;
  batchId: string;
  name: string;
  price: number;
  commission: number;
  weeklySales: number | null;
  categoryLabel: string;
  capturedOn: Date;
  note: string;
  linkedEntryId: string | null;
  commissionPercent: number;
  demandTotal: number | null;
  flags: CandidateFlag[];
  badges: CandidateBadge[];
  /** แถวนี้อยู่ในชุดล่าสุดของหมวดตัวเองไหม — มุมมองดีฟอลต์ของหน้าแสดงเฉพาะแถวที่เป็น true */
  isLatestForCategory: boolean;
};

export type BatchSummary = {
  id: string;
  capturedOn: Date;
  rowCount: number;
  /** หมวดในชุดนี้พร้อมจำนวนแถว เรียงจากแถวมากไปน้อย */
  categories: { label: string; count: number }[];
  /** true ถ้าชุดนี้เป็นชุดล่าสุดของอย่างน้อย 1 หมวดที่อยู่ในนั้น */
  isLatestForAnyCategory: boolean;
};

export type FocusCategory = {
  label: string;
  ratePercent: number;
  orderCount: number;
};

export async function getCandidatesData(): Promise<{
  rows: CandidateRow[];
  batches: BatchSummary[];
  focus: FocusCategory[];
}> {
  const [candidates, batchRecords, paidOrders] = await Promise.all([
    prisma.productCandidate.findMany({ orderBy: { capturedOn: "desc" } }),
    prisma.candidateBatch.findMany({ orderBy: { capturedOn: "desc" } }),
    prisma.affiliateOrder.findMany({
      where: { status: PAID_STATUS },
      select: { productName: true, gmv: true, finalRevenue: true },
    }),
  ]);

  const latest = latestBatchPerCategory(candidates);

  const rowsWithoutBadges = candidates.map((c) => ({
    id: c.id,
    batchId: c.batchId,
    name: c.name,
    price: c.price,
    commission: c.commission,
    weeklySales: c.weeklySales,
    categoryLabel: c.categoryLabel,
    capturedOn: c.capturedOn,
    note: c.note,
    linkedEntryId: c.linkedEntryId,
    commissionPercent: commissionPercent(c.price, c.commission),
    demandTotal: demandTotal(c.commission, c.weeklySales),
    flags: detectFlags(c.name),
    isLatestForCategory: latest.get(c.categoryLabel) === c.batchId,
  }));

  const badgeMap = pickCandidateBadges(rowsWithoutBadges);
  const rows: CandidateRow[] = rowsWithoutBadges.map((r) => ({
    ...r,
    badges: badgeMap.get(r.id) ?? [],
  }));

  // สรุปรายชุด — นับแถวและหมวดที่อยู่ในชุดนั้น
  const countsByBatch = new Map<string, Map<string, number>>();
  for (const c of candidates) {
    const label = c.categoryLabel.trim() === "" ? "ไม่ระบุหมวด" : c.categoryLabel;
    let perCategory = countsByBatch.get(c.batchId);
    if (perCategory === undefined) {
      perCategory = new Map();
      countsByBatch.set(c.batchId, perCategory);
    }
    perCategory.set(label, (perCategory.get(label) ?? 0) + 1);
  }

  const latestBatchIds = new Set(latest.values());
  const batches: BatchSummary[] = batchRecords.map((b) => {
    const perCategory = countsByBatch.get(b.id) ?? new Map<string, number>();
    const categories = [...perCategory.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b2) => b2.count - a.count);
    return {
      id: b.id,
      capturedOn: b.capturedOn,
      rowCount: categories.reduce((sum, c) => sum + c.count, 0),
      categories,
      isLatestForAnyCategory: latestBatchIds.has(b.id),
    };
  });

  // แถบเตือนหมวดที่ควรโฟกัส — ต้องมีจำนวนออเดอร์กำกับเสมอ เพราะบางหมวด %สูง
  // แต่มาจากออเดอร์น้อยมาก ถ้าโชว์แต่ % จะอ่านผิดว่าหมวดนั้นดีกว่า
  const focusMap = new Map<string, { gmv: number; rev: number; n: number }>();
  for (const o of paidOrders) {
    const cat = categorize(o.productName);
    if (cat === null) continue;
    const prev = focusMap.get(cat) ?? { gmv: 0, rev: 0, n: 0 };
    prev.gmv += o.gmv;
    prev.rev += o.finalRevenue ?? 0;
    prev.n++;
    focusMap.set(cat, prev);
  }
  const focus: FocusCategory[] = [...focusMap.entries()]
    .map(([label, v]) => ({
      label,
      ratePercent: v.gmv > 0 ? (v.rev / v.gmv) * 100 : 0,
      orderCount: v.n,
    }))
    .sort((a, b) => b.ratePercent - a.ratePercent);

  return { rows, batches, focus };
}
```

- [ ] **Step 6: แก้ `app/actions.ts` — `extractCandidates`**

แทนที่ตั้งแต่บรรทัด `const raw = await extractCandidateRows({ images });` จนถึง `return { added, updated, skipped };` (ท้ายฟังก์ชัน) ด้วย:

```ts
  const raw = await extractCandidateRows({ images });
  const { rows, skipped } = parseCandidateRows(raw);

  // ต้องเช็คก่อนสร้างชุด ไม่งั้นจะเหลือชุดเปล่าค้างในรายการให้ผู้ใช้มางงว่าคืออะไร
  if (rows.length === 0) {
    throw new Error("อ่านข้อมูลจากรูปไม่ได้เลยสักแถว ลองแคปใหม่ให้เห็นตัวเลขชัดขึ้น");
  }

  const capturedOn = new Date();
  const batch = await prisma.candidateBatch.create({ data: { capturedOn } });

  // ชุดใหม่ไม่แตะชุดเก่าเลย — สินค้าชื่อเดิมอยู่คนละชุดได้ แต่ในชุดเดียวกันยังกันซ้ำอยู่
  // เพราะแคปแบบเลื่อนจอมักมีสินค้าซ้ำตรงรอยต่อระหว่างภาพ
  const seen = new Set<string>();
  for (const row of rows) {
    const nameKey = normalizeName(row.name);
    await prisma.productCandidate.upsert({
      where: { batchId_nameKey: { batchId: batch.id, nameKey } },
      create: {
        batchId: batch.id,
        name: row.name,
        nameKey,
        price: row.price,
        commission: row.commission,
        weeklySales: row.weeklySales,
        categoryLabel: row.categoryLabel,
        capturedOn,
      },
      update: {
        name: row.name,
        price: row.price,
        commission: row.commission,
        weeklySales: row.weeklySales,
        categoryLabel: row.categoryLabel,
      },
    });
    seen.add(nameKey);
  }

  revalidatePath("/products");
  return { batchId: batch.id, added: seen.size, skipped };
```

และแก้ return type ของฟังก์ชัน (บรรทัด ~946) จาก:

```ts
): Promise<{ added: number; updated: number; skipped: number }> {
```

เป็น:

```ts
): Promise<{ batchId: string; added: number; skipped: number }> {
```

- [ ] **Step 7: แก้ `app/actions.ts` — ลบ `setCandidateStatus` เพิ่ม `deleteCandidateBatch`**

ลบฟังก์ชัน `setCandidateStatus` ทั้งฟังก์ชัน (รวม doc comment ถ้ามี) แล้ววาง `deleteCandidateBatch` แทนที่ตรงนั้น:

```ts
/**
 * ลบทั้งชุด — แถวในชุดหายตามด้วย FK cascade
 *
 * ตัว PromptEntry ที่เคยสร้างจากแถวในชุดนี้ไม่ถูกลบ (ไม่มี relation ผูกกัน linkedEntryId
 * เป็น String เปล่าโดยตั้งใจ) ลบชุดจึงเสียแค่ "ลิงก์" ไม่ใช่ตัวงาน
 */
export async function deleteCandidateBatch(batchId: string): Promise<void> {
  await prisma.candidateBatch.delete({ where: { id: batchId } });
  revalidatePath("/products");
}
```

- [ ] **Step 8: แก้ `app/actions.ts` — `createEntryFromCandidate` ไม่เซ็ต status**

แทนที่:

```ts
  await prisma.productCandidate.update({
    where: { id },
    data: { status: "done", linkedEntryId: created.id },
  });
```

ด้วย:

```ts
  await prisma.productCandidate.update({
    where: { id },
    data: { linkedEntryId: created.id },
  });
```

- [ ] **Step 9: แก้ `components/candidates-route.tsx` ให้ compile ผ่าน**

งาน UI จริงอยู่ Task 3 ขั้นนี้แค่ตัดสิ่งที่อ้างถึง `status` ออกเพื่อให้ tsc เขียว:

9.1 ใน import จาก `@/app/actions` ลบ `setCandidateStatus` ออก เหลือ:

```tsx
import { createEntryFromCandidate, extractCandidates } from "@/app/actions";
```

9.2 แทนที่บล็อก `type StatusFilter` และ `const FILTERS` (บรรทัด ~31-39) ด้วย:

```tsx
type CreatedFilter = "all" | "todo" | "created";

const FILTERS: { key: CreatedFilter; label: string }[] = [
  { key: "all", label: "ทั้งหมด" },
  { key: "todo", label: "ยังไม่ได้สร้าง" },
  { key: "created", label: "สร้างแล้ว" },
];
```

9.3 แทนที่ `const [filter, setFilter] = useState<StatusFilter>("active");` ด้วย:

```tsx
  const [filter, setFilter] = useState<CreatedFilter>("all");
```

9.4 แทนที่บล็อก `const visible = useMemo(...)` ทั้งบล็อกด้วย:

```tsx
  const visible = useMemo(() => {
    let list = rows.filter((r) => r.isLatestForCategory);
    if (filter === "todo") list = list.filter((r) => r.linkedEntryId === null);
    else if (filter === "created") list = list.filter((r) => r.linkedEntryId !== null);
    // เรียงตามศักยภาพรายได้มากไปน้อย แถวที่ไม่มีศักยภาพรายได้ (ขาดยอดขาย) ไปท้ายสุด
    return [...list].sort((a, b) => (b.demandTotal ?? -1) - (a.demandTotal ?? -1));
  }, [rows, filter]);
```

9.5 ลบฟังก์ชัน `handleStatus` ทั้งฟังก์ชัน

9.6 ในเซลล์ปุ่มของตาราง แทนที่บล็อกตั้งแต่ `{r.status === "done" ? (` จนถึง `)}` ที่ปิดบล็อกนั้น ด้วย:

```tsx
                        {r.linkedEntryId === null ? (
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => handleCreate(r.id)}
                            disabled={isUpdating}
                          >
                            สร้างงานเลย
                          </Button>
                        ) : (
                          <Link
                            href={`/entry/${r.linkedEntryId}`}
                            className="text-primary underline underline-offset-2"
                          >
                            สร้างแล้ว →
                          </Link>
                        )}
```

และเพิ่ม import ที่หัวไฟล์:

```tsx
import Link from "next/link";
```

9.7 เปลี่ยน type ของ props: ลบ `summaries: CategorySummary[]` ออกจากทั้ง destructure และ type แล้วใส่ `batches: BatchSummary[]` แทน · แก้ import type ให้เป็น:

```tsx
import type {
  BatchSummary,
  CandidateRow,
  FocusCategory,
} from "@/lib/candidate-queries";
```

9.8 ลบ `<section>` "เก็บมาแล้วในระบบ" ทั้งบล็อก (ที่ขึ้นต้นด้วย `{summaries.length > 0 && (`) — จะสร้างใหม่เป็นแผงรายการชุดใน Task 3

9.9 ใน `app/products/page.tsx` เปลี่ยน `summaries={data.summaries}` เป็น `batches={data.batches}`

- [ ] **Step 10: ตรวจทั้งชุด**

```bash
npx tsc --noEmit
npm run lint
node scripts/check-candidates.mjs
```

Expected: ทั้งสามคำสั่งจบด้วย exit 0 · `check-candidates.mjs` พิมพ์ `ผ่านทุกเคส`

- [ ] **Step 11: Commit**

```bash
git diff tsconfig.json
git add lib/candidates.ts lib/candidate-queries.ts app/actions.ts components/candidates-route.tsx app/products/page.tsx scripts/check-candidates.mjs
git commit -m "Scope candidate badges and queries to a batch

Badges rank within a batch and category rather than a category alone:
a badge means rank in one captured list, so letting rows from an older
capture compete with the current one produced meaningless rankings.
Top count drops from 4 to 3.

Uploading now creates a batch and never touches earlier ones, and refuses
to create an empty batch when nothing parsed. Removes the interested/
rejected triage: setCandidateStatus is gone, createEntryFromCandidate
only records the entry link, and the filter is now created vs not.

Adds latestBatchPerCategory so the page can default to the newest capture
of each category — computed per category because one batch can hold
several and categories are refreshed independently."
```

---

### Task 3: UI — แผงรายการชุด, ปุ่มลบ, มุมมองต่อชุด

**Files:**
- Modify: `components/candidates-route.tsx`

**Interfaces:**
- Consumes: `BatchSummary`, `CandidateRow.isLatestForCategory`, `CandidateRow.batchId`, `deleteCandidateBatch` จาก Task 2
- Produces: UI สมบูรณ์ (ไม่มีอะไรให้ task ถัดไปใช้ต่อ)

- [ ] **Step 1: เพิ่ม import และ state ของมุมมองชุด**

1.1 เพิ่ม `deleteCandidateBatch` เข้า import จาก `@/app/actions`:

```tsx
import {
  createEntryFromCandidate,
  deleteCandidateBatch,
  extractCandidates,
} from "@/app/actions";
```

1.2 เพิ่ม `Trash2` และ `Layers` เข้า import จาก `lucide-react` (เรียงตามตัวอักษรให้ตรงกับของเดิม)

1.3 เพิ่ม state ต่อจาก `const [filter, setFilter] = useState<CreatedFilter>("all");`:

```tsx
  // null = มุมมองดีฟอลต์ (ชุดล่าสุดของแต่ละหมวด) · ไม่ null = ดูชุดเดียวเจาะจง
  const [batchView, setBatchView] = useState<string | null>(null);
  // เก็บ id ของชุดที่กดลบไว้รอยืนยัน — ยืนยันในที่เดิมแทนการเปิด dialog
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
```

- [ ] **Step 2: ให้ `visible` เคารพมุมมองชุด**

แทนที่บล็อก `const visible = useMemo(...)` ด้วย:

```tsx
  const visible = useMemo(() => {
    let list =
      batchView === null
        ? rows.filter((r) => r.isLatestForCategory)
        : rows.filter((r) => r.batchId === batchView);
    if (filter === "todo") list = list.filter((r) => r.linkedEntryId === null);
    else if (filter === "created") list = list.filter((r) => r.linkedEntryId !== null);
    // เรียงตามศักยภาพรายได้มากไปน้อย แถวที่ไม่มีศักยภาพรายได้ (ขาดยอดขาย) ไปท้ายสุด
    return [...list].sort((a, b) => (b.demandTotal ?? -1) - (a.demandTotal ?? -1));
  }, [rows, filter, batchView]);
```

- [ ] **Step 3: เพิ่ม handler ลบชุด**

วางต่อจาก `handleCreate`:

```tsx
  function handleDeleteBatch(batchId: string) {
    startUpdating(async () => {
      try {
        await deleteCandidateBatch(batchId);
        setConfirmDelete(null);
        // ถ้ากำลังดูชุดที่เพิ่งลบอยู่ ต้องเด้งกลับมุมมองดีฟอลต์ ไม่งั้นหน้าจะว่างเปล่าแบบงงๆ
        setBatchView((current) => (current === batchId ? null : current));
      } catch (e) {
        setError(e instanceof Error ? e.message : "ลบชุดไม่สำเร็จ");
      }
    });
  }
```

- [ ] **Step 4: วางแผงรายการชุด**

แทนที่ตำแหน่งที่เคยเป็น `<section>` "เก็บมาแล้วในระบบ" (ระหว่าง section แถบโฟกัส กับ section กล่องแปะรูป) ด้วย:

```tsx
      {/* รายการชุด — 1 ชุด = 1 ครั้งที่อ่านข้อมูลจากรูป ดูเจาะจงหรือลบทั้งชุดได้จากตรงนี้ */}
      {batches.length > 0 && (
        <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5 leading-relaxed">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <Layers className="size-4 shrink-0 text-primary" />
              ชุดที่เก็บมาแล้ว
            </p>
            <button
              type="button"
              onClick={() => setBatchView(null)}
              aria-pressed={batchView === null}
              className={
                "inline-flex h-9 items-center rounded-lg border border-border-interactive px-3 text-sm transition-colors " +
                (batchView === null
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground hover:bg-foreground/5")
              }
            >
              ดูชุดล่าสุดของทุกหมวด
            </button>
          </div>

          <ul className="flex flex-col gap-2">
            {batches.map((b) => {
              const selected = batchView === b.id;
              return (
                <li
                  key={b.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border p-3"
                >
                  <span className="text-sm text-foreground">
                    {b.categories.map((c) => `${c.label} ${c.count}`).join(" · ")}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    เก็บ {formatThaiDate(b.capturedOn)}
                  </span>
                  {b.isLatestForAnyCategory && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs leading-relaxed font-medium text-primary">
                      ล่าสุด
                    </span>
                  )}

                  <span className="ml-auto flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={selected ? "default" : "outline"}
                      onClick={() => setBatchView(selected ? null : b.id)}
                      aria-pressed={selected}
                    >
                      {selected ? "กำลังดูชุดนี้" : "ดูชุดนี้"}
                    </Button>

                    {confirmDelete === b.id ? (
                      <>
                        <span className="text-sm text-destructive">
                          ลบ {b.rowCount} รายการถาวร? (งานที่สร้างไปแล้วไม่หาย เสียแค่ลิงก์)
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => handleDeleteBatch(b.id)}
                          disabled={isUpdating}
                        >
                          ยืนยันลบ
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setConfirmDelete(null)}
                        >
                          ยกเลิก
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setConfirmDelete(b.id)}
                        disabled={isUpdating}
                      >
                        <Trash2 className="size-4" />
                        ลบชุดนี้
                      </Button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
```

- [ ] **Step 5: ปรับข้อความสรุปหลังอ่านข้อมูลจากรูป**

ใน `handleExtract` แทนที่บล็อก `setResult(...)` ด้วย:

```tsx
        setResult(
          `เพิ่มชุดใหม่ ${r.added} รายการ` +
            (r.skipped > 0 ? ` · ข้ามบรรทัดที่อ่านไม่ออก ${r.skipped}` : "")
        );
```

- [ ] **Step 6: ปรับข้อความตอนไม่มีแถวให้แสดง**

แทนที่ข้อความในบล็อก `visible.length === 0` ด้วย:

```tsx
        <p className="rounded-xl border border-border bg-surface p-5 text-sm leading-relaxed text-muted-foreground">
          {rows.length === 0
            ? "ยังไม่มีสินค้าในระบบ — แปะแคปหน้าจัดอันดับสินค้าด้านบนเพื่อเริ่ม"
            : "ไม่มีสินค้าที่ตรงกับตัวกรองนี้"}
        </p>
```

- [ ] **Step 7: ตรวจ type/lint/สี**

```bash
npx tsc --noEmit
npm run lint
node scripts/check-contrast.mjs
```

Expected: ทั้งสามจบด้วย exit 0

- [ ] **Step 8: ทดสอบจริงบน dev server แยก**

```bash
cp dev.db dev-test.db
NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001
```

เปิด `http://localhost:3001/products` แล้วยืนยันทีละข้อ:

1. แผง "ชุดที่เก็บมาแล้ว" แสดง 4 ชุด · ชุด 23 ส.ค. และ 20 ส.ค. มีป้าย "ล่าสุด" (23 ส.ค. ล่าสุดของโซฟา · 20 ส.ค. ล่าสุดของอีก 3 หมวด) ส่วน 18 และ 19 ส.ค. ไม่มีป้าย
2. มุมมองดีฟอลต์แสดง 137 แถว (39+40+37+21) ไม่ใช่ 162 — ของตกค้าง 25 แถวหายจากสายตา
3. กด "ดูชุดนี้" ที่ชุด 18 ส.ค. → เห็นเฉพาะ 6 แถวของชุดนั้น
4. ตัวกรอง "สร้างแล้ว" → เหลือเฉพาะแถวที่มีลิงก์ "สร้างแล้ว →" · กดลิงก์แล้วไปหน้า entry ได้จริง
5. ป้ายในหมวดหนึ่งมีไม่เกิน 3 ต่อชนิด (นับ "ขายดี #1..#3" ไม่มี #4)
6. กด "ลบชุดนี้" → ขึ้นข้อความยืนยันพร้อมจำนวนแถว → กด "ยกเลิก" แล้วไม่มีอะไรหาย → กดใหม่แล้ว "ยืนยันลบ" → ชุดหายจากรายการและแถวหายจากตาราง
7. หลังลบชุดที่กำลังดูอยู่ หน้าเด้งกลับมุมมองดีฟอลต์เอง ไม่ค้างหน้าว่าง
8. ไม่มี console error / hydration error

- [ ] **Step 9: ตรวจว่าลบชุดแล้ว entry ไม่หาย**

ก่อนลบ จดจำนวน `PromptEntry` ไว้ก่อนด้วยสคริปต์ชั่วคราว แล้วเทียบหลังลบ:

```bash
npx prisma db execute --url "file:./dev-test.db" --stdin <<< "SELECT COUNT(*) FROM PromptEntry;"
```

Expected: จำนวนเท่าเดิมทั้งก่อนและหลังลบชุดที่มีแถว `linkedEntryId`

- [ ] **Step 10: ถ่าย screenshot responsive**

```bash
PW_ROOT=<โฟลเดอร์ที่ติดตั้ง playwright> ENTRY_ID=<cuid จริงจาก dev-test.db> node scripts/shot.mjs .shots-batches
```

Expected: ผ่านทุกหน้าที่ 390/820/1440px โดยไม่มีหน้าไหนสกรอลแนวนอน

- [ ] **Step 11: เก็บกวาดแล้ว commit**

```bash
rm -rf .next-dev .shots-batches
rm -f dev-test.db
git diff tsconfig.json
git add components/candidates-route.tsx
git commit -m "Add batch list with per-batch view and delete

The page defaults to the newest capture of each category, so products
that fell out of the ranking disappear on the next upload without any
cleanup. The batch list makes what is stored visible and deletable as a
unit, with an inline confirm that states the row count and that already
created work survives — deleting a batch drops the entry link, not the
entry. Viewing a batch that then gets deleted falls back to the default
view rather than leaving an empty page."
```

---

## Self-Review

**Spec coverage:**

| ข้อกำหนดใน spec | Task |
|---|---|
| ตาราง `CandidateBatch` | 1 |
| `batchId` + cascade · ลบ `status` · `@@unique([batchId, nameKey])` | 1 |
| ย้าย 162 แถวเดิมเข้าชุดตามวัน (4 ชุด) | 1 |
| อัปโหลดสร้างชุดใหม่ ไม่แตะชุดเก่า | 2 |
| ไม่สร้างชุดเปล่าเมื่ออ่านไม่ได้เลย | 2 |
| return `{ batchId, added, skipped }` | 2 |
| ป้ายท็อป 3 · คิดใน (ชุด × หมวด) | 2 |
| ลบ `setCandidateStatus` · `createEntryFromCandidate` ไม่เซ็ต status | 2 |
| ตัวกรอง 3 ปุ่ม (ทั้งหมด / ยังไม่ได้สร้าง / สร้างแล้ว) | 2 |
| ดีฟอลต์แสดงชุดล่าสุดของแต่ละหมวด | 2 (ตรรกะ) · 3 (สลับมุมมอง) |
| แสดง "สร้างแล้ว →" เป็นลิงก์ไป entry | 2 |
| รายการชุด + ดูเจาะจง + ลบทั้งชุดพร้อมยืนยัน | 3 |
| ยืนยันบอกจำนวนแถวและว่างานไม่หาย | 3 |

**Placeholder scan:** ไม่มี TBD/TODO · ทุก step ที่แก้โค้ดมีโค้ดจริงครบ · ทุก step ที่รันคำสั่งมีคำสั่งจริงและผลที่คาด

**Type consistency:** `pickCandidateBadges` รับ `batchId` (ไม่มี `status`) ตรงกันทั้งใน Task 2 Step 1 (เทสต์), Step 3 (implementation) และ Step 5 (call site) · `latestBatchPerCategory` คืน `Map<string, string>` ใช้เป็น `latest.get(c.categoryLabel) === c.batchId` ตรงกัน · `BatchSummary` ที่ประกาศใน Task 2 มี field ครบตามที่ Task 3 ใช้ (`id`, `capturedOn`, `rowCount`, `categories`, `isLatestForAnyCategory`) · `extractCandidates` คืน `{ batchId, added, skipped }` และ Task 3 Step 5 ใช้แค่ `r.added`/`r.skipped` ซึ่งมีจริง
