# ImportLog + อัปหลายไฟล์พร้อมกัน Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** บันทึกทุกครั้งที่อัปไฟล์ลงตาราง `ImportLog` แล้วแสดงเป็นแผง "รอบนี้อัปอะไรไปแล้ว" ที่ไม่หายเมื่อ refresh พร้อมให้ฟอร์ม Content.csv เลือกหลายไฟล์พร้อมกันได้

**Architecture:** ตารางใหม่ `ImportLog` (1 แถว = 1 ไฟล์ที่อัปสำเร็จ) + pure function จัดกลุ่มรายการล่าสุดต่อชนิดไฟล์ + แผงแสดงผลที่แทน `ImportStatusLine` เดิม · `importClipMetrics` เปลี่ยนไปรับหลายไฟล์โดยแยกตรรกะต่อไฟล์ออกเป็น helper แล้ววนเรียก ส่วน importer อีก 3 ตัวคงรับไฟล์เดียวเหมือนเดิม เพียงเพิ่มการเขียน log

**Tech Stack:** Next.js 16.2.10 (App Router, Server Actions), Prisma 7 + better-sqlite3, React 19, Tailwind v4, shadcn/ui บน Base UI, `node:crypto` สำหรับ sha256

**Spec:** `docs/superpowers/specs/2026-08-03-import-log-design.md`

## Global Constraints

- UI ภาษาไทยทั้งหมด **ห้ามใช้ emoji**
- ใช้ design token เดิมเท่านั้น (`teal`/`amber`/`smoke`/`danger`/`success` ใน `app/globals.css`) **ห้ามเพิ่มสี/ฟอนต์ใหม่ และห้ามใช้ชื่อสี Tailwind ดิบ** เช่น `text-blue-500`
- **ห้ามรัน `npm run build` หรือ `npm run dev` บน port 3000** — ผู้ใช้รัน production server อยู่ผ่าน `start.bat` ใช้ `npx tsc --noEmit` + `npm run lint` แทน · ถ้าต้องรันแอปจริงให้ใช้ `NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001` (ก๊อป `cp dev.db dev-test.db` ก่อน)
- **ห้ามใช้ `dev.db` ตัวจริงตอนทดสอบ** — ไม่มี backup กู้คืนไม่ได้
- **เช็ก `git diff tsconfig.json` ก่อน commit ทุกครั้ง** — dev server แก้ไฟล์นี้เองได้ ถ้าเปลี่ยนให้ `git checkout -- tsconfig.json` (repo pin `target: "ES2017"` ไว้ตั้งใจ)
- **ห้าม `git add -A`** — ระบุไฟล์ที่จะ stage เสมอ
- Prisma client ไม่มี index barrel — import จาก `@/lib/generated/prisma/client` โดยตรง
- หลังแก้ `prisma/schema.prisma` ต้องรัน `npx prisma migrate dev --name <name>` แล้วตามด้วย `npx prisma generate`
- **`lib/import-log.ts` ต้องไม่ import อะไรจาก `node:*`** — ไฟล์นี้ถูก import โดย client component (แผงแสดงผล) ถ้าดึง `crypto` เข้าไปจะพัง client bundle · การ hash อยู่ใน `app/actions.ts` ซึ่งเป็นฝั่ง server ล้วน

## File Structure

| ไฟล์ | หน้าที่ | Task |
|---|---|---|
| `prisma/schema.prisma` (แก้) | เพิ่มโมเดล `ImportLog` | 1 |
| `lib/import-log.ts` (ใหม่) | types + `groupLatestRound` (pure, ไม่มี node import) | 1 |
| `app/actions.ts` (แก้) | เขียน log ใน importer 3 ตัวเดิม | 2 |
| `app/actions.ts` (แก้) | `importClipMetrics` รับหลายไฟล์ + ตรวจไฟล์ซ้ำ | 3 |
| `lib/entry-queries.ts` (แก้) | ดึง `importLogs` ใน `getDashboardData` | 4 |
| `components/import-log-panel.tsx` (ใหม่) | แผงแสดงผล แทน `ImportStatusLine` | 4 |
| `components/dashboard-panel.tsx` (แก้) | ลบ `ImportStatusLine` · ใช้แผงใหม่ · input `multiple` | 4 |
| `app/dashboard/page.tsx` (แก้) | ส่ง prop `importLogs` | 4 |
| `CLAUDE.md` (แก้) | บันทึกกฎ + ขึ้นทะเบียนค่าคงที่ | 5 |

## วิธีรันเทสต์ในโปรเจกต์นี้

โปรเจกต์**ไม่มี test runner** และ**ไม่มี `tsx`** — คอมไพล์ด้วย `tsc` ลง scratch dir แล้วรันด้วย `node` โดยต้องแก้ path alias `@/` เองเพราะ `tsc` ไม่เขียน path ใน `require()` ให้

สร้าง `<scratch>/alias.js` (`<scratch>` = scratch dir ของ session **ห้ามสร้างในโฟลเดอร์ repo**):

```js
const Module = require("module");
const path = require("path");
const OUT = process.env.TEST_OUT;
const orig = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request.startsWith("@/")) request = path.join(OUT, request.slice(2));
  return orig.call(this, request, ...args);
};
```

คอมไพล์: `npx tsc lib/import-log.ts --outDir "<scratch>/out" --rootDir . --module commonjs --target ES2017 --moduleResolution node --skipLibCheck --esModuleInterop`

รัน: `TEST_OUT=<scratch>/out node -r <scratch>/alias.js <scratch>/test-import-log.js`

---

### Task 1: ตาราง `ImportLog` + `lib/import-log.ts`

**Files:**
- Modify: `prisma/schema.prisma` (เพิ่มโมเดลท้ายไฟล์)
- Create: `lib/import-log.ts`
- Test: `<scratch>/test-import-log.js`

**Interfaces:**
- Consumes: ไม่มี
- Produces:
  - `type ImportKind = "orders" | "clips" | "followers" | "channel"`
  - `type ImportLogRecord = { kind: string; uploadedAt: Date; rowCount: number; summary: string }`
  - `type RoundFile = { uploadedAt: Date; rowCount: number; summary: string }`
  - `type RoundSummary = { kind: string; files: RoundFile[] }`
  - `function groupLatestRound(logs: ImportLogRecord[]): RoundSummary[]`
  - `const EXPECTED_CLIP_FILES = 3`
  - โมเดล Prisma `ImportLog`

- [ ] **Step 1: เพิ่มโมเดลลง `prisma/schema.prisma`**

ต่อท้ายไฟล์ (หลังโมเดล `ChannelMetric`):

```prisma
/// บันทึก 1 แถวต่อ 1 ไฟล์ที่อัปสำเร็จ — ตอบว่า "รอบนี้อัปอะไรไปแล้วบ้าง" ให้รอด refresh
///
/// ต่างจาก importedAt ในตารางข้อมูลตรงที่ importedAt บอกได้แค่ "ล่าสุดเมื่อไร" ไม่บอกว่ากี่ไฟล์
/// ซึ่งเป็นปัญหากับ Content.csv ที่ต้องอัป 3 ไฟล์ต่อรอบและทั้งสามเขียนลง capturedOn เดียวกัน
model ImportLog {
  id         String   @id @default(cuid())
  /// "orders" | "clips" | "followers" | "channel"
  kind       String
  /// timestamp จริง (ไม่ใช่ UTC midnight) — ตัดวันด้วย local getter เสมอ
  uploadedAt DateTime @default(now())
  /// sha256 ของไฟล์ดิบ ใช้ตรวจว่าอัปไฟล์เดิมซ้ำ
  fileHash   String
  rowCount   Int
  /// ลายเซ็นให้ผู้ใช้ดูออกว่าไฟล์ไหนคือไฟล์ไหน เช่น "15 คลิป · เก่าสุด 1 ก.ค."
  summary    String

  @@index([kind, uploadedAt])
  @@index([fileHash])
}
```

- [ ] **Step 2: รัน migration**

```bash
npx prisma migrate dev --name add_import_log
npx prisma generate
```

Expected: migration ผ่าน และ `lib/generated/prisma/` ถูก regenerate

- [ ] **Step 3: เขียนเทสต์ที่ยังไม่ผ่าน**

สร้าง `<scratch>/test-import-log.js`:

```js
const assert = require("assert");
const path = require("path");
const { groupLatestRound, EXPECTED_CLIP_FILES } = require(
  path.join(process.env.TEST_OUT, "lib/import-log.js")
);

const at = (y, m, d, h, min) => new Date(y, m, d, h, min); // local time
const rec = (kind, uploadedAt, rowCount, summary) => ({ kind, uploadedAt, rowCount, summary });

// 1. แต่ละชนิดต้องได้เฉพาะรายการของ "วันล่าสุดของชนิดนั้น" ไม่ใช่วันล่าสุดรวม
{
  const r = groupLatestRound([
    rec("orders", at(2026, 7, 1, 10, 0), 300, "300 ออเดอร์"),   // 1 ส.ค.
    rec("clips", at(2026, 7, 3, 13, 45), 15, "15 คลิป"),        // 3 ส.ค.
  ]);
  const orders = r.find((x) => x.kind === "orders");
  const clips = r.find((x) => x.kind === "clips");
  assert.strictEqual(orders.files.length, 1, "orders ต้องยังแสดงแม้เป็นคนละวันกับ clips");
  assert.strictEqual(orders.files[0].rowCount, 300);
  assert.strictEqual(clips.files.length, 1);
}

// 2. หลายไฟล์ในวันเดียวกันของชนิดเดียวกัน → รวมกลุ่มเดียว เรียงเก่า→ใหม่
{
  const r = groupLatestRound([
    rec("clips", at(2026, 7, 3, 13, 47), 14, "14 คลิป"),
    rec("clips", at(2026, 7, 3, 13, 45), 15, "15 คลิป"),
    rec("clips", at(2026, 7, 3, 13, 50), 15, "15 คลิป · เก่าสุด 28 พ.ค."),
  ]);
  const clips = r.find((x) => x.kind === "clips");
  assert.strictEqual(clips.files.length, 3);
  assert.deepStrictEqual(
    clips.files.map((f) => f.rowCount),
    [15, 14, 15],
    "ต้องเรียงตามเวลาเก่า→ใหม่"
  );
}

// 3. ของวันเก่ากว่าต้องถูกตัดออก เหลือเฉพาะวันล่าสุดของชนิดนั้น
{
  const r = groupLatestRound([
    rec("clips", at(2026, 6, 27, 9, 0), 15, "รอบเก่า"),
    rec("clips", at(2026, 7, 3, 13, 45), 15, "รอบใหม่"),
    rec("clips", at(2026, 7, 3, 13, 47), 14, "รอบใหม่ 2"),
  ]);
  const clips = r.find((x) => x.kind === "clips");
  assert.strictEqual(clips.files.length, 2, "ของวันที่ 27 ก.ค. ต้องไม่ติดมา");
  assert.ok(clips.files.every((f) => f.summary.startsWith("รอบใหม่")));
}

// 4. ชนิดที่ไม่มี log เลย → ไม่โผล่ในผลลัพธ์
{
  const r = groupLatestRound([rec("orders", at(2026, 7, 3, 10, 0), 5, "5 ออเดอร์")]);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r.find((x) => x.kind === "clips"), undefined);
}

// 5. input ว่าง → array ว่าง ไม่ throw
{
  assert.deepStrictEqual(groupLatestRound([]), []);
}

// 6. การอัปตอนเย็นเวลาไทยต้องอยู่วันเดียวกับตอนเช้า (จับบั๊กใช้ UTC getter)
//    23:30 เวลาไทย = 16:30 UTC วันเดียวกัน แต่ 07:00 เวลาไทย = 00:00 UTC วันเดียวกัน
//    ถ้าใช้ UTC getter ตัดวัน ทั้งสองยังอยู่วันเดียวกันอยู่ดี จึงต้องใช้เคสข้ามเที่ยงคืน UTC:
//    06:00 เวลาไทย(+7) = 23:00 UTC ของ "เมื่อวาน" → UTC getter จะแยกเป็นคนละวัน
{
  const r = groupLatestRound([
    rec("clips", at(2026, 7, 3, 6, 0), 15, "เช้า"),    // 3 ส.ค. 06:00 ไทย = 2 ส.ค. 23:00 UTC
    rec("clips", at(2026, 7, 3, 20, 0), 14, "เย็น"),   // 3 ส.ค. 20:00 ไทย = 3 ส.ค. 13:00 UTC
  ]);
  const clips = r.find((x) => x.kind === "clips");
  assert.strictEqual(
    clips.files.length,
    2,
    "สองการอัปในวันเดียวกันตามปฏิทินไทยต้องอยู่กลุ่มเดียวกัน — ถ้าได้ 1 แปลว่าตัดวันด้วย UTC getter"
  );
}

// 7. ค่าคงที่จำนวนไฟล์ Content.csv ต่อรอบ
{
  assert.strictEqual(EXPECTED_CLIP_FILES, 3);
}

console.log("PASS: import-log (7 กรณี)");
```

- [ ] **Step 4: รันเทสต์ให้เห็นว่าไม่ผ่าน**

```bash
npx tsc lib/import-log.ts --outDir "<scratch>/out" --rootDir . --module commonjs --target ES2017 --moduleResolution node --skipLibCheck --esModuleInterop
```

Expected: FAIL — `error TS6053: File 'lib/import-log.ts' not found.`

- [ ] **Step 5: เขียน `lib/import-log.ts`**

```ts
/**
 * ชนิดไฟล์ที่นำเข้าได้ — ตรงกับคอลัมน์ kind ใน ImportLog
 *
 * ไฟล์นี้ถูก import โดย client component ด้วย **ห้ามใส่ import จาก node:* เด็ดขาด**
 * (การ hash ไฟล์อยู่ใน app/actions.ts ซึ่งเป็นฝั่ง server ล้วน)
 */
export type ImportKind = "orders" | "clips" | "followers" | "channel";

/** จำนวนไฟล์ Content.csv ที่ควรอัปต่อรอบ (ช่วง 7 + 28 + 60 วัน) */
export const EXPECTED_CLIP_FILES = 3;

/** รับ shape แคบๆ ไม่ผูกกับ Prisma เพื่อให้ทดสอบง่าย (แบบเดียวกับ ScoreboardEntry) */
export type ImportLogRecord = {
  kind: string;
  uploadedAt: Date;
  rowCount: number;
  summary: string;
};

export type RoundFile = {
  uploadedAt: Date;
  rowCount: number;
  summary: string;
};

export type RoundSummary = {
  kind: string;
  /** ไฟล์ที่อัปในวันล่าสุดของชนิดนี้ เรียงเก่า→ใหม่ */
  files: RoundFile[];
};

/**
 * คีย์วันตามปฏิทิน — uploadedAt เป็น timestamp จริง (ไม่ใช่ UTC midnight แบบ postedAt/statsOn)
 * จึงต้องอ่านด้วย local getter เหมือน orderDate ใน lib/dashboard.ts
 *
 * ใช้ UTC getter แล้วการอัปช่วงเช้าตรู่เวลาไทย (ก่อน 07:00 = ยังเป็นเมื่อวานตาม UTC)
 * จะถูกจัดไปคนละวันกับการอัปตอนบ่ายของวันเดียวกัน
 */
function dayKeyLocal(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * จัดกลุ่ม log ตามชนิดไฟล์ แล้วเก็บเฉพาะรายการของ "วันล่าสุดที่ชนิดนั้นมีการอัป"
 *
 * ยึดวันล่าสุด "ต่อชนิด" ไม่ใช่วันล่าสุดรวม เพราะแต่ละไฟล์มีรอบไม่เท่ากัน
 * (รายได้ทุก 7 วัน · วิวทั้งช่องทุก ~2 เดือน) ถ้ายึดวันล่าสุดรวมจะเห็นแค่ชนิดที่เพิ่งอัป
 *
 * วิธีนี้ครอบทั้งกรณีอัป 3 ไฟล์ในการกดครั้งเดียว และกรณีกด 3 ครั้งแยกกันในวันเดียวกัน
 * โดยไม่ต้องรู้ว่าเป็นแบบไหน
 */
export function groupLatestRound(logs: ImportLogRecord[]): RoundSummary[] {
  const byKind = new Map<string, ImportLogRecord[]>();
  for (const l of logs) {
    const list = byKind.get(l.kind);
    if (list) list.push(l);
    else byKind.set(l.kind, [l]);
  }

  const out: RoundSummary[] = [];
  for (const [kind, list] of byKind) {
    const latestKey = dayKeyLocal(
      new Date(Math.max(...list.map((l) => l.uploadedAt.getTime())))
    );
    const files = list
      .filter((l) => dayKeyLocal(l.uploadedAt) === latestKey)
      .sort((a, b) => a.uploadedAt.getTime() - b.uploadedAt.getTime())
      .map((l) => ({
        uploadedAt: l.uploadedAt,
        rowCount: l.rowCount,
        summary: l.summary,
      }));
    out.push({ kind, files });
  }
  return out;
}
```

- [ ] **Step 6: รันเทสต์ให้ผ่าน**

```bash
npx tsc lib/import-log.ts --outDir "<scratch>/out" --rootDir . --module commonjs --target ES2017 --moduleResolution node --skipLibCheck --esModuleInterop
TEST_OUT=<scratch>/out node -r <scratch>/alias.js <scratch>/test-import-log.js
```

Expected: `PASS: import-log (7 กรณี)`

- [ ] **Step 7: ตรวจ type/lint และ commit**

```bash
npx tsc --noEmit
npm run lint
git diff tsconfig.json    # ต้องว่าง
git add prisma/schema.prisma prisma/migrations lib/import-log.ts
git commit -m "Add ImportLog table and round-grouping helper"
```

---

### Task 2: เขียน log จาก importer 3 ตัวที่รับไฟล์เดียว

**Files:**
- Modify: `app/actions.ts` (`importAffiliateOrders`, `importFollowerActivity`, `importChannelMetrics`)

**Interfaces:**
- Consumes: `ImportKind` จาก `@/lib/import-log` (Task 1) · โมเดล `ImportLog`
- Produces: helper ภายในไฟล์ `writeImportLog(...)` ที่ Task 3 จะใช้ต่อ

- [ ] **Step 1: เพิ่ม import ที่หัวไฟล์ `app/actions.ts`**

เพิ่มต่อจาก import เดิมของ `@/lib/channel-metrics`:

```ts
import { createHash } from "crypto";

import type { ImportKind } from "@/lib/import-log";
```

- [ ] **Step 2: เพิ่ม helper ก่อน `importAffiliateOrders`**

วางเหนือ `export type AffiliateImportSummary`:

```ts
/** sha256 ของไฟล์ดิบ — ใช้ตรวจว่าผู้ใช้เลือกไฟล์เดิมซ้ำ */
function hashFile(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * บันทึกว่าอัปไฟล์อะไรไปเมื่อไร — เรียก**หลัง** import สำเร็จเท่านั้น
 * ไฟล์ที่ parse ไม่ผ่านต้องไม่ถูกบันทึกว่าอัปแล้ว ไม่งั้นแผงสถานะจะโกหก
 */
async function writeImportLog(args: {
  kind: ImportKind;
  fileHash: string;
  rowCount: number;
  summary: string;
}) {
  await prisma.importLog.create({ data: args });
}

/** "2 ส.ค." — สำหรับ Date ที่เป็น timestamp จริง (orderDate, uploadedAt) */
function shortLocal(d: Date): string {
  return d.toLocaleDateString("th-TH", { day: "numeric", month: "short" });
}

/** "2 ส.ค." — สำหรับ Date ที่เก็บเป็น UTC midnight (statsOn, postedAt) */
function shortUtc(d: Date): string {
  return d.toLocaleDateString("th-TH", { day: "numeric", month: "short", timeZone: "UTC" });
}
```

- [ ] **Step 3: เขียน log ใน `importAffiliateOrders`**

ใน `importAffiliateOrders` หาบรรทัด `const buffer = Buffer.from(await file.arrayBuffer());` — ไฟล์ถูกอ่านเป็น Buffer อยู่แล้ว ใช้ตัวนั้น hash ได้เลย

หา `revalidatePath("/dashboard");` ที่ท้ายฟังก์ชัน แล้ว**แทรกก่อนบรรทัดนั้น**:

```ts
  const orderTimes = orders.map((o) => o.orderDate.getTime());
  await writeImportLog({
    kind: "orders",
    fileHash: hashFile(buffer),
    rowCount: orders.length,
    summary:
      `${orders.length} ออเดอร์ · ` +
      `${shortLocal(new Date(Math.min(...orderTimes)))}–${shortLocal(new Date(Math.max(...orderTimes)))}`,
  });
```

- [ ] **Step 4: เขียน log ใน `importFollowerActivity`**

ในฟังก์ชันนี้ไฟล์ถูกอ่านเป็น text (`const text = await file.text();`) จึงต้อง hash จาก text — แก้บรรทัดนั้นเป็น:

```ts
  const buffer = Buffer.from(await file.arrayBuffer());
  const text = buffer.toString("utf8");
```

แล้วแทรกก่อน `revalidatePath("/dashboard");`:

```ts
  const days = new Set(rows.map((r) => r.activityOn.getTime())).size;
  await writeImportLog({
    kind: "followers",
    fileHash: hashFile(buffer),
    rowCount: rows.length,
    summary: `${rows.length} แถว · ${days} วัน`,
  });
```

- [ ] **Step 5: เขียน log ใน `importChannelMetrics`**

แก้ `const text = await file.text();` เป็น:

```ts
  const buffer = Buffer.from(await file.arrayBuffer());
  const text = buffer.toString("utf8");
```

แล้วแทรกก่อน `revalidatePath("/dashboard");`:

```ts
  await writeImportLog({
    kind: "channel",
    fileHash: hashFile(buffer),
    rowCount: parsed.rows.length,
    summary:
      `${parsed.rows.length} วัน · ` +
      `${shortUtc(new Date(Math.min(...times)))}–${shortUtc(new Date(Math.max(...times)))}`,
  });
```

(ตัวแปร `times` ประกาศอยู่แล้วในฟังก์ชันนี้ — อย่าประกาศซ้ำ)

- [ ] **Step 6: ตรวจ type/lint**

```bash
npx tsc --noEmit
npm run lint
```

Expected: ไม่มี error ทั้งคู่

- [ ] **Step 7: ทดสอบว่าเขียน log จริงด้วย DB สำเนา**

```bash
cp dev.db dev-test.db
```

สร้าง `<scratch>/check-log.js`:

```js
const Database = require("C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt/node_modules/better-sqlite3");
const db = new Database(process.argv[2], { readonly: true });
console.log(db.prepare("SELECT kind, datetime(uploadedAt) t, rowCount, summary FROM ImportLog ORDER BY uploadedAt").all());
db.close();
```

รัน dev server แยกแล้วอัปไฟล์รายได้ 1 ไฟล์:

```bash
NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001
```

เปิด `http://localhost:3001/dashboard` → อัปไฟล์ `.xlsx` ที่มีอยู่ (ถ้าไม่มีให้ข้ามไปทดสอบใน Task 5 แทน) แล้วเช็ก:

```bash
node <scratch>/check-log.js "C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt/dev-test.db"
```

Expected: มี 1 แถว `kind: "orders"` พร้อม summary รูปแบบ `"NNN ออเดอร์ · D ม.ค.–D ม.ค."`

ปิดเซิร์ฟเวอร์และเก็บกวาด:

```bash
netstat -ano | grep ':3001' | grep LISTENING
taskkill //PID <pid> //F
rm -rf .next-dev dev-test.db
git checkout -- tsconfig.json
```

- [ ] **Step 8: Commit**

```bash
git diff tsconfig.json    # ต้องว่าง
git add app/actions.ts
git commit -m "Record an ImportLog row for the three single-file importers"
```

---

### Task 3: `importClipMetrics` รับหลายไฟล์ + ตรวจไฟล์ซ้ำ

**Files:**
- Modify: `app/actions.ts` (`importClipMetrics` และ `ClipMetricImportSummary`)

**Interfaces:**
- Consumes: `writeImportLog`, `hashFile`, `shortUtc` (Task 2) · `parseContentCsv`, `parseMonthDayLabel` (มีอยู่แล้ว)
- Produces: `type ClipMetricImportSummary = { files: number; total: number; matched: number; unmatched: number; duplicates: string[]; failed: string[] }`

- [ ] **Step 1: เปลี่ยนชนิดของ summary**

แทนที่ `export type ClipMetricImportSummary = {...}` เดิมด้วย:

```ts
export type ClipMetricImportSummary = {
  /** จำนวนไฟล์ที่นำเข้าสำเร็จ */
  files: number;
  total: number;
  matched: number;
  unmatched: number;
  /** ลายเซ็นของไฟล์ที่ hash ตรงกับที่เคยอัปแล้ว — เตือนอย่างเดียว ไม่บล็อก */
  duplicates: string[];
  /** ลายเซ็นของไฟล์ที่อ่านไม่ผ่าน — ไฟล์ที่เหลือยังทำงานต่อ */
  failed: string[];
};
```

- [ ] **Step 2: แยกตรรกะต่อไฟล์ออกเป็น helper**

แทนที่ทั้งฟังก์ชัน `importClipMetrics` เดิมด้วยโค้ดด้านล่าง — helper `importOneContentFile` คือเนื้อในเดิมทั้งหมดที่ย้ายมา ไม่มีการเปลี่ยนตรรกะ upsert หรือ cross-check `isScheduledPost` แม้แต่บรรทัดเดียว:

```ts
/**
 * นำเข้า Content.csv 1 ไฟล์ — เนื้อในเดิมของ importClipMetrics ที่แยกออกมาเพื่อวนเรียกหลายไฟล์
 *
 * คืน null เมื่อไฟล์อ่านไม่ผ่าน เพื่อให้ผู้เรียกข้ามเฉพาะไฟล์นั้นแล้วทำไฟล์ที่เหลือต่อได้
 * (export จาก TikTok พลาดทีละไฟล์ได้ ไม่ควรทำให้ทั้งชุดล้ม)
 */
async function importOneContentFile(
  buffer: Buffer,
  importedAt: Date
): Promise<{ total: number; matched: number; summary: string } | null> {
  let metrics;
  try {
    metrics = parseContentCsv(buffer.toString("utf8"), importedAt);
  } catch {
    return null;
  }
  if (metrics.length === 0) return null;

  const entries = await prisma.promptEntry.findMany({
    select: { id: true, videoUrl: true },
  });
  const videoToEntry = new Map<string, string>();
  for (const e of entries) {
    const vid = videoIdFromUrl(e.videoUrl);
    if (vid) videoToEntry.set(vid, e.id);
  }

  // upsert ด้วย (videoId, capturedOn) — โยนไฟล์เดิมซ้ำได้ ไม่เกิด snapshot ซ้ำ
  //
  // สำคัญ: matchedEntryId ถูก set ที่นี่เท่านั้น (ไม่มีที่อื่นแตะ ClipMetric.matchedEntryId เลย)
  // และ cross-check เรื่อง isScheduledPost ด้านล่างก็รันในรอบเดียวกันนี้พอดี — เพราะเหตุนี้
  // คลิปที่ตั้งเวลาไว้จะไม่มีทาง "โผล่เป็น live" ได้เลย: ถ้ายังไม่เคย import ไฟล์นี้ คลิปจะยังไม่มี
  // views จับคู่ (analyzePostTimes ข้ามไปเป็น skippedNoViews) และพอ import ครั้งแรกที่มันได้ views
  // มัน ก็จะได้ isScheduledPost มาพร้อมกันในรอบเดียวกันเสมอ — **ถ้าวันหน้ามีจุดอื่นมา set
  // ClipMetric.matchedEntryId แยกจากตรงนี้ (เช่น re-link ตอนแก้ videoUrl) การรับประกันนี้จะพังทันที**
  for (const m of metrics) {
    const matchedEntryId = videoToEntry.get(m.videoId) ?? null;
    await prisma.clipMetric.upsert({
      where: { videoId_capturedOn: { videoId: m.videoId, capturedOn: m.capturedOn } },
      create: { ...m, matchedEntryId },
      update: {
        title: m.title,
        postedDate: m.postedDate,
        views: m.views,
        likes: m.likes,
        comments: m.comments,
        shares: m.shares,
        matchedEntryId,
        importedAt: new Date(),
      },
    });
  }

  // เวลาจาก video id คือ "เวลาอัปโหลด" ถ้าวันเผยแพร่จริงในไฟล์ไม่ตรงกัน แปลว่าคลิปนั้นตั้งเวลาไว้
  // → เวลาที่ถอดได้เชื่อไม่ได้ ต้องทำเครื่องหมายไว้เพื่อให้ analyzePostTimes ตัดออก
  // ทำแบบนี้เพราะระบบต้องไม่พึ่งว่าผู้ใช้ติ๊ก toggle ถูก — ข้อมูลจริงจับได้ทีหลังเสมอ
  for (const m of metrics) {
    const entryId = videoToEntry.get(m.videoId);
    if (!entryId) continue;
    const uploadedAt = uploadedAtFromVideoId(m.videoId);
    if (!uploadedAt) continue;
    const publishedOn = parseMonthDayLabel(m.postedDate, importedAt);
    if (!publishedOn) continue;

    const scheduled = thaiDateKey(uploadedAt) !== publishedOn.toISOString().slice(0, 10);
    if (!scheduled) continue;

    const entry = await prisma.promptEntry.findUnique({
      where: { id: entryId },
      select: { isScheduledPost: true, postedTimeSource: true },
    });
    if (!entry || entry.isScheduledPost) continue;

    await prisma.promptEntry.update({
      where: { id: entryId },
      data: {
        isScheduledPost: true,
        // เวลาที่เคยติดป้ายว่า derived ใช้ไม่ได้แล้ว — ล้างทิ้ง ไม่เก็บของปลอมไว้
        postedTimeSource: entry.postedTimeSource === "manual" ? "manual" : null,
      },
    });
  }

  // ลายเซ็นให้ผู้ใช้แยกออกว่าไฟล์ไหนคือช่วงไหน โดยไม่ต้องเปลี่ยนชื่อไฟล์
  // ใช้ "คลิปเก่าสุดที่โพสต์" เพราะวัดจากไฟล์จริงแล้วแยกช่วง 7/28/60 วันออกจากกันได้
  // (1 ก.ค. / 19 มิ.ย. / 28 พ.ค.) — แต่ **ไม่เดาชื่อช่วงให้** เพราะแยก 60 กับ 365 ไม่ออก
  const postedTimes = metrics
    .map((m) => parseMonthDayLabel(m.postedDate, importedAt))
    .filter((d): d is Date => d !== null)
    .map((d) => d.getTime());
  const oldest = postedTimes.length > 0 ? ` · เก่าสุด ${shortUtc(new Date(Math.min(...postedTimes)))}` : "";

  const matched = metrics.filter((m) => videoToEntry.has(m.videoId)).length;
  return {
    total: metrics.length,
    matched,
    summary: `${metrics.length} คลิป${oldest}`,
  };
}

export async function importClipMetrics(
  formData: FormData
): Promise<ClipMetricImportSummary> {
  const picked = formData.getAll("files").filter(
    (f): f is File => f instanceof File && f.size > 0
  );
  if (picked.length === 0) {
    throw new Error("กรุณาเลือกไฟล์ Content (.csv) อย่างน้อย 1 ไฟล์");
  }

  const importedAt = new Date();
  let files = 0;
  let total = 0;
  let matched = 0;
  const duplicates: string[] = [];
  const failed: string[] = [];

  for (const f of picked) {
    const buffer = Buffer.from(await f.arrayBuffer());
    const result = await importOneContentFile(buffer, importedAt);
    if (!result) {
      failed.push(f.name);
      continue;
    }

    const fileHash = hashFile(buffer);
    const seen = await prisma.importLog.findFirst({ where: { fileHash } });
    if (seen) duplicates.push(result.summary);

    await writeImportLog({
      kind: "clips",
      fileHash,
      rowCount: result.total,
      summary: result.summary,
    });

    files++;
    total += result.total;
    matched += result.matched;
  }

  if (files === 0) {
    throw new Error("อ่านไฟล์ไม่สำเร็จ — ต้องเป็นไฟล์ Content (.csv) จาก TikTok Studio");
  }

  revalidatePath("/dashboard");
  return { files, total, matched, unmatched: total - matched, duplicates, failed };
}
```

- [ ] **Step 3: ตรวจ type/lint**

```bash
npx tsc --noEmit
npm run lint
```

Expected: `npx tsc --noEmit` จะ **error** ที่ `components/dashboard-panel.tsx` เพราะยังอ่าน `summary.total` แบบเดิมและฟอร์มยังส่ง `name="file"` — เป็นเรื่องปกติ Task 4 จะแก้ให้ **อย่าแก้ dashboard-panel.tsx ใน task นี้**

ถ้ามี error ในไฟล์อื่นนอกจาก `components/dashboard-panel.tsx` แปลว่าผิดจริง ต้องแก้

- [ ] **Step 4: Commit**

```bash
git diff tsconfig.json    # ต้องว่าง
git add app/actions.ts
git commit -m "Accept several Content.csv files in one submit and log each"
```

---

### Task 4: แผงสถานะ + ฟอร์มเลือกหลายไฟล์

**Files:**
- Modify: `lib/entry-queries.ts` (`getDashboardData`)
- Create: `components/import-log-panel.tsx`
- Modify: `components/dashboard-panel.tsx`
- Modify: `app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `groupLatestRound`, `EXPECTED_CLIP_FILES`, `ImportLogRecord`, `RoundSummary` จาก `@/lib/import-log` (Task 1) · `ClipMetricImportSummary` ใหม่ (Task 3) · `IMPORT_STALE_DAYS`, `ReminderState` จาก `@/lib/dashboard`
- Produces: `function ImportLogPanel(props: { logs: ImportLogRecord[]; reminder: ReminderState }): JSX.Element`

- [ ] **Step 1: ดึง `importLogs` ใน `getDashboardData`**

ใน `lib/entry-queries.ts` แก้ destructure ของ `Promise.all` เป็น:

```ts
  const [orders, clipMetrics, followerActivity, channelMetrics, importLogs] = await Promise.all([
    prisma.affiliateOrder.findMany({ orderBy: { orderDate: "asc" } }),
    prisma.clipMetric.findMany({ orderBy: { capturedOn: "asc" } }),
    prisma.followerActivity.findMany({
      orderBy: [{ activityOn: "asc" }, { hour: "asc" }],
    }),
    prisma.channelMetric.findMany({ orderBy: { statsOn: "asc" } }),
    prisma.importLog.findMany({ orderBy: { uploadedAt: "asc" } }),
  ]);
```

แล้วในบล็อก `return { ... }` เพิ่มบรรทัดต่อจาก `channelMetrics,`:

```ts
    importLogs,
```

- [ ] **Step 2: เขียน `components/import-log-panel.tsx`**

```tsx
"use client";

import { useMemo } from "react";

import { IMPORT_STALE_DAYS, type ReminderState } from "@/lib/dashboard";
import {
  EXPECTED_CLIP_FILES,
  groupLatestRound,
  type ImportLogRecord,
} from "@/lib/import-log";

const KIND_LABEL: Record<string, string> = {
  orders: "รายได้",
  clips: "วิวคลิป",
  channel: "วิวทั้งช่อง",
  followers: "ผู้ติดตาม",
};

/** เรียงตามความสำคัญของไฟล์ ไม่ใช่ตามตัวอักษร — รายได้สำคัญสุด */
const KIND_ORDER = ["orders", "clips", "channel", "followers"];

/** "3 ส.ค. 13:45" — uploadedAt เป็น timestamp จริง อ่านด้วย local */
function stamp(d: Date): string {
  return (
    d.toLocaleDateString("th-TH", { day: "numeric", month: "short" }) +
    " " +
    d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })
  );
}

/** วันเดียวไม่มีเวลา — ใช้กับหัวกลุ่มที่มีหลายไฟล์ */
function dayOnly(d: Date): string {
  return d.toLocaleDateString("th-TH", { day: "numeric", month: "short" });
}

function staleDaysOf(kind: string, reminder: ReminderState): number | null {
  if (kind === "orders") return reminder.daysSinceOrdersImport;
  if (kind === "clips") return reminder.daysSinceMetricsImport;
  return null;
}

export function ImportLogPanel({
  logs,
  reminder,
}: {
  logs: ImportLogRecord[];
  reminder: ReminderState;
}) {
  const rounds = useMemo(() => groupLatestRound(logs), [logs]);
  if (rounds.length === 0) return null;

  const sorted = [...rounds].sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)
  );

  return (
    <div className="flex flex-col gap-1.5">
      <p className="font-mono text-[0.6rem] tracking-widest text-muted-foreground uppercase">
        อัปล่าสุด
      </p>
      {sorted.map((r) => {
        const many = r.files.length > 1;
        const stale = staleDaysOf(r.kind, reminder);
        const overdue = stale !== null && stale > IMPORT_STALE_DAYS;
        return (
          <div key={r.kind} className="flex flex-col gap-0.5">
            <p className="font-mono text-[0.7rem]">
              <span className="text-muted-foreground">
                {KIND_LABEL[r.kind] ?? r.kind}
              </span>{" "}
              <span className="text-foreground">
                {many
                  ? `${dayOnly(r.files[0].uploadedAt)} · ${r.files.length} จาก ${EXPECTED_CLIP_FILES} ไฟล์`
                  : `${stamp(r.files[0].uploadedAt)} · ${r.files[0].summary}`}
              </span>
              {overdue && (
                <span className="text-danger">
                  {" "}
                  — เกินกำหนดมา {stale - IMPORT_STALE_DAYS} วัน
                </span>
              )}
            </p>
            {many &&
              r.files.map((f) => (
                <p
                  key={f.uploadedAt.getTime()}
                  className="pl-4 font-mono text-[0.65rem] text-muted-foreground"
                >
                  {f.summary} ({stamp(f.uploadedAt)})
                </p>
              ))}
          </div>
        );
      })}
    </div>
  );
}
```

**หมายเหตุ:** `EXPECTED_CLIP_FILES` ถูกใช้กับทุกชนิดที่มีหลายไฟล์ ซึ่งตอนนี้มีแค่ `clips` เท่านั้นที่เป็นไปได้ (อีก 3 ชนิดรับไฟล์เดียว จึงเข้าเงื่อนไข `many` ไม่ได้)

- [ ] **Step 3: แก้ `components/dashboard-panel.tsx` — เปลี่ยน import และ props**

ลบฟังก์ชัน `ImportStatusLine` ทั้งก้อน (ประมาณบรรทัด 43-62) และลบการเรียกใช้ทั้ง 2 จุด (บล็อก `<ImportStatusLine label="รายได้" .../>` และ `<ImportStatusLine label="วิวคลิป" .../>`)

เพิ่ม import:

```ts
import { ImportLogPanel } from "@/components/import-log-panel";
import type { ImportLogRecord } from "@/lib/import-log";
```

เพิ่ม prop ใน type ของ props (ต่อจาก `channelMetrics`) และใน destructure:

```ts
  importLogs: ImportLogRecord[];
```

วางแผงใหม่แทนที่ตำแหน่งเดิมของ `ImportStatusLine` ทั้งสองบรรทัด:

```tsx
        <ImportLogPanel logs={importLogs} reminder={reminder} />
```

ถ้า `thaiShortDate` และ `IMPORT_STALE_DAYS` ไม่ถูกใช้ที่อื่นในไฟล์นี้แล้ว ให้ลบ import ที่ค้างออกด้วย (lint จะฟ้องถ้าลืม)

- [ ] **Step 4: แก้ฟอร์ม Content.csv ให้เลือกหลายไฟล์**

หาฟอร์มที่ใช้ `metricAction` แล้วแก้ `<Input>` จาก `name="file"` เป็น:

```tsx
              <Input
                type="file"
                name="files"
                accept=".csv,text/csv"
                multiple
                className="h-auto max-w-xs py-1.5"
                required
              />
```

และแก้ข้อความสรุปผล (บล็อก `{metricState.summary && (...)}`) เป็น:

```tsx
            {metricState.summary && (
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                นำเข้า {metricState.summary.files} ไฟล์ · {metricState.summary.total} คลิป ·
                จับคู่ได้ {metricState.summary.matched} · ไม่มีในแอป {metricState.summary.unmatched}
                {metricState.summary.duplicates.length > 0 && (
                  <span className="text-danger">
                    {" "}
                    · ไฟล์ที่เคยอัปแล้ว {metricState.summary.duplicates.length} ไฟล์
                  </span>
                )}
                {metricState.summary.failed.length > 0 && (
                  <span className="text-danger">
                    {" "}
                    · อ่านไม่ได้ {metricState.summary.failed.join(", ")}
                  </span>
                )}
              </div>
            )}
```

และแก้ข้อความใต้ฟอร์มให้บอกว่าเลือกได้หลายไฟล์:

```tsx
              <span className="font-mono text-[0.7rem] text-muted-foreground">
                โหลดจาก TikTok Studio → Analytics → Content → Download (.csv) · เลือกได้หลายไฟล์พร้อมกัน (ช่วง 7 + 28 + 60 วัน)
              </span>
```

- [ ] **Step 5: ส่ง prop จาก `app/dashboard/page.tsx`**

เพิ่มบรรทัดต่อจาก `channelMetrics={data.channelMetrics}`:

```tsx
          importLogs={data.importLogs}
```

- [ ] **Step 6: ตรวจ type/lint**

```bash
npx tsc --noEmit
npm run lint
```

Expected: ไม่มี error ทั้งคู่ (error ของ Task 3 ต้องหายไปแล้ว)

- [ ] **Step 7: Commit**

```bash
git diff tsconfig.json    # ต้องว่าง
git add lib/entry-queries.ts components/import-log-panel.tsx components/dashboard-panel.tsx app/dashboard/page.tsx
git commit -m "Show what was imported this round and accept multiple clip files"
```

---

### Task 5: ตรวจปลายทางด้วยไฟล์จริง + อัปเดต CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: ทุก Task ก่อนหน้า
- Produces: ไม่มี (จุดสิ้นสุดของแผน)

- [ ] **Step 1: รัน isolated dev server**

```bash
cp dev.db dev-test.db
NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001
```

- [ ] **Step 2: อัป 3 ไฟล์พร้อมกันในการกดครั้งเดียว**

ที่ `http://localhost:3001/dashboard` → ฟอร์ม "นำเข้าข้อมูลวิว" → เลือก **3 ไฟล์พร้อมกัน**:

```
C:\Users\patip\Desktop\overview tts\Content_07days\Content.csv
C:\Users\patip\Desktop\overview tts\Content_28days\Content.csv
C:\Users\patip\Desktop\overview tts\Content_60days\Content.csv
```

**ตัวเลขที่ต้องได้** (วัดจากไฟล์จริงเมื่อ 2026-08-03): นำเข้า **3 ไฟล์** · รวม **44 คลิป** (15+14+15) · snapshot วันนั้นมี **28 คลิปไม่ซ้ำ**

ตรวจว่าแผง "อัปล่าสุด" แสดง:
- บรรทัด `วิวคลิป` ขึ้นว่า `3 จาก 3 ไฟล์`
- แตกรายการย่อย 3 บรรทัด โดยลายเซ็นต้องเป็น `15 คลิป · เก่าสุด 1 ก.ค.` / `14 คลิป · เก่าสุด 19 มิ.ย.` / `15 คลิป · เก่าสุด 28 พ.ค.`

- [ ] **Step 3: ทดสอบว่า refresh แล้วไม่หาย**

กด F5 refresh หน้า → แผง "อัปล่าสุด" ต้องยังแสดงข้อมูลเดิมครบทั้ง 3 บรรทัด (นี่คือปัญหาต้นทางที่ฟีเจอร์นี้แก้)

- [ ] **Step 4: ทดสอบการเตือนไฟล์ซ้ำ**

อัป `Content_07days\Content.csv` ซ้ำอีกครั้ง (ไฟล์เดียว) → ต้องขึ้น `· ไฟล์ที่เคยอัปแล้ว 1 ไฟล์` **และยังนำเข้าสำเร็จ** (ไม่ throw)

- [ ] **Step 5: ตรวจข้อมูลใน DB**

```bash
node <scratch>/check-log.js "C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt/dev-test.db"
```

Expected: มีแถว `kind: "clips"` 4 แถว (3 จากรอบแรก + 1 จากการอัปซ้ำ) แต่ละแถวมี `summary` ต่างกันตามไฟล์

- [ ] **Step 6: ตรวจ dark mode และ console**

บังคับ dark mode ด้วย devtools (เพิ่ม class `dark` ให้ `<html>`) → แผง "อัปล่าสุด" ต้องอ่านออกทุกบรรทัด · ไม่มี console error หรือ hydration warning

- [ ] **Step 7: ปิดเซิร์ฟเวอร์และเก็บกวาด**

```bash
netstat -ano | grep ':3001' | grep LISTENING
taskkill //PID <pid> //F
rm -rf .next-dev dev-test.db
git checkout -- tsconfig.json
```

- [ ] **Step 8: อัปเดต `CLAUDE.md`**

ในหัวข้อ **Dashboard รายได้ (แท็บ ④)** เพิ่มบรรทัดต่อจากบรรทัดที่อธิบาย `lib/channel-metrics.ts`:

```markdown
- **`lib/import-log.ts` + ตาราง `ImportLog`** บันทึก 1 แถวต่อ 1 ไฟล์ที่อัปสำเร็จ — แก้ปัญหาที่สรุปผลหลังอัปอยู่ใน `useActionState` แล้วหายตอน refresh · `groupLatestRound` ยึด "วันล่าสุดต่อชนิดไฟล์" ไม่ใช่วันล่าสุดรวม เพราะแต่ละไฟล์มีรอบไม่เท่ากัน · **`uploadedAt` เป็น timestamp จริง ต้องตัดวันด้วย local getter** (บั๊กคลาสเดียวกับ `toDateInputValue`/`toLocalDateInputValue`) · **`lib/import-log.ts` ห้าม import `node:*`** เพราะถูก import โดย client component — การ hash อยู่ใน `app/actions.ts` · `importClipMetrics` รับหลายไฟล์ผ่าน `formData.getAll("files")` (ชื่อ field คือ `files` ไม่ใช่ `file`) ไฟล์ที่อ่านไม่ผ่านจะถูกข้ามเฉพาะตัวนั้น ไม่ทำให้ทั้งชุดล้ม · **ไฟล์ซ้ำ (hash ตรงกัน) แค่เตือน ไม่บล็อก** เพราะทุก importer เป็น upsert และการ import ซ้ำโดยตั้งใจเป็นงานจริง (เคยเกิดตอนแก้บั๊กปีของ `Overview.csv`)
```

ในหัวข้อ **ค่าคงที่ที่ผูกกับสเกลข้อมูล (ต้องทบทวนเป็นระยะ)** เพิ่มบรรทัด:

```markdown
- `EXPECTED_CLIP_FILES` (3) ใน `lib/import-log.ts` — จำนวนไฟล์ `Content.csv` ที่ควรอัปต่อรอบ **ผูกกับการตัดสินใจว่าจะ export ช่วงไหนบ้าง (7+28+60 วัน) ไม่ใช่ค่าที่คำนวณได้** ที่มา: วัดจากไฟล์จริง 4 ช่วงเมื่อ 2026-08-03 พบว่าช่วง 365 วันไม่เพิ่มคลิปใหม่เลยแม้แต่ตัวเดียว (ได้คลิปชุดเดียวกับช่วง 60 วันเป๊ะ) ส่วนช่วง 7/28/60 เพิ่ม 15/+8/+5 ตามลำดับ — ถ้าเปลี่ยนชุดช่วงที่ใช้ ต้องแก้ค่านี้ตาม
```

- [ ] **Step 9: ตรวจรอบสุดท้ายและ commit**

```bash
npx tsc --noEmit
npm run lint
git status --short          # ต้องไม่มี .next-dev หรือ dev-test.db หลงเหลือ
git diff tsconfig.json      # ต้องว่าง
git add CLAUDE.md
git commit -m "Document the import log rules in CLAUDE.md"
```

---

## Self-Review

**1. ความครอบคลุมของ spec**

| ข้อกำหนดใน spec | Task ที่ทำ |
|---|---|
| ตาราง `ImportLog` (kind/uploadedAt/fileHash/rowCount/summary + index) | Task 1 Step 1 |
| `groupLatestRound` ยึดวันล่าสุดต่อชนิด | Task 1 Step 5 · เทสต์ #1, #3 |
| ตัดวันด้วย local getter | Task 1 Step 5 · เทสต์ #6 |
| `files` เรียงเก่า→ใหม่ | Task 1 เทสต์ #2 |
| `lib/import-log.ts` ห้ามมี node import | Global Constraints · Task 1 Step 5 (คอมเมนต์กำกับ) |
| hash อยู่ฝั่ง server | Task 2 Step 2 (`hashFile` ใน actions.ts) |
| importer 3 ตัวเดิมเขียน log | Task 2 Steps 3-5 |
| ลายเซ็นแต่ละชนิดตามตารางใน spec | Task 2 Steps 3-5 · Task 3 Step 2 |
| multi-file เฉพาะ `importClipMetrics` | Task 3 Step 2 |
| ไฟล์พังตัวเดียวไม่ทำให้ทั้งชุดล้ม | Task 3 Step 2 (`importOneContentFile` คืน null) |
| ทุกไฟล์พัง → throw | Task 3 Step 2 (`if (files === 0) throw`) |
| `ImportLog` เขียนหลังสำเร็จเท่านั้น | Task 2 Step 2 (คอมเมนต์) · Task 3 Step 2 (เขียนหลัง `result` ไม่ใช่ null) |
| ไฟล์ซ้ำเตือนไม่บล็อก | Task 3 Step 2 · Task 4 Step 4 (UI) · Task 5 Step 4 (ทดสอบ) |
| แผงแทน `ImportStatusLine` + ดูดคำเตือนเกินกำหนดเข้ามา | Task 4 Steps 2-3 |
| "N จาก M ไฟล์" เฉพาะชนิดที่มีหลายไฟล์ | Task 4 Step 2 (เงื่อนไข `many`) |
| ชนิดที่ไม่เคยอัป → ไม่แสดงบรรทัด | Task 4 Step 2 (`groupLatestRound` ไม่คืน kind ที่ไม่มี log) · Task 1 เทสต์ #4 |
| `EXPECTED_CLIP_FILES` ขึ้นทะเบียนใน CLAUDE.md | Task 5 Step 8 |
| ตรวจด้วยไฟล์จริง 3 ไฟล์ + refresh + ไฟล์ซ้ำ | Task 5 Steps 2-5 |

**2. Placeholder scan:** ไม่มี TBD/TODO · ทุก step ที่ต้องเขียนโค้ดมีโค้ดจริงครบ · คำสั่งทุกอันรันได้จริง

**3. ความสอดคล้องของชนิด/ชื่อ:**
- `ImportLogRecord` (Task 1) → Task 4 ใช้เป็น prop type ตรงกัน · `prisma.importLog.findMany()` คืนฟิลด์ครบกว่าซึ่ง assign เข้า type แคบกว่าได้ตามปกติของ TypeScript ✓
- `RoundSummary.files` (Task 1) → Task 4 อ่าน `r.files[0].uploadedAt`, `f.summary` ตรงกัน ✓
- `ClipMetricImportSummary` เปลี่ยนชนิดใน Task 3 → Task 4 Step 4 อ่าน `.files/.total/.matched/.unmatched/.duplicates/.failed` ครบตรงกัน ✓
- `writeImportLog`/`hashFile`/`shortUtc` นิยาม Task 2 → ใช้ใน Task 3 ตรงกัน ✓
- field ฟอร์มเปลี่ยนจาก `file` → `files` ทั้งใน action (Task 3) และ input (Task 4) พร้อมกัน ✓
- `EXPECTED_CLIP_FILES` นิยาม Task 1 → ใช้ Task 4 → ขึ้นทะเบียน Task 5 ✓
