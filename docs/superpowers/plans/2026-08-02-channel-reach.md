# Channel Reach (นำเข้า Overview.csv) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** นำเข้า `Overview.csv` จาก TikTok Studio (วิวรวมทั้งช่องรายวัน แบบไม่มีเพดาน 15 แถว) แล้วแสดง conversion ระดับช่องรายสัปดาห์ที่ไม่มี selection bias

**Architecture:** ตารางใหม่ `ChannelMetric` (1 แถว = 1 วัน) + parser ที่ใช้ `lib/csv.ts` เดิมซ้ำ + pure aggregation ที่จับคู่วิวรายวันกับออเดอร์รายวันแล้วสรุปเป็นสัปดาห์ + แผงตารางในหน้า `/dashboard` โครงทั้งหมดลอกจากเส้นทาง `FollowerActivity` ที่มีอยู่แล้ว (parser → server action → query → panel)

**Tech Stack:** Next.js 16.2.10 (App Router, Server Actions), Prisma 7 + better-sqlite3 adapter, React 19, Tailwind v4, shadcn/ui บน Base UI

**Spec:** `docs/superpowers/specs/2026-08-02-channel-reach-design.md`

## Global Constraints

- UI ภาษาไทยทั้งหมด **ห้ามใช้ emoji**
- ใช้ design token เดิมเท่านั้น (palette "Dusk Market": `teal`/`amber`/`smoke`/`danger`/`success`, ฟอนต์ `Plus Jakarta Sans`/`Noto Sans Thai`/`JetBrains Mono`) **ห้ามเพิ่มสีหรือฟอนต์ใหม่**
- **ห้ามรัน `npm run build` หรือ `npm run dev` บน port 3000** — ผู้ใช้รัน production server อยู่ผ่าน `start.bat` ตลอดเวลา ให้ใช้ `npx tsc --noEmit` + `npm run lint` แทน และถ้าต้องรันแอปจริงให้ใช้ isolated dev server เท่านั้น: `NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001` (ก๊อป `cp dev.db dev-test.db` ก่อน)
- **ห้ามใช้ `dev.db` ตัวจริงตอนทดสอบ** — ไม่มี backup กู้คืนไม่ได้ ใช้ `dev-test.db` เสมอ
- **เช็ก `git diff tsconfig.json` ก่อน commit ทุกครั้ง** — dev server ของ Next.js แก้ไฟล์นี้เองได้ ถ้าเปลี่ยนให้ `git checkout -- tsconfig.json` (repo pin `target: "ES2017"` ไว้ตั้งใจ)
- **ห้าม `git add -A`** — ระบุไฟล์ที่จะ stage เสมอ
- Prisma client ไม่มี index barrel — import จาก `@/lib/generated/prisma/client` โดยตรง
- หลังแก้ `prisma/schema.prisma` ต้องรัน `npx prisma migrate dev --name <name>` แล้วตามด้วย `npx prisma generate`
- Path alias `@/*` ชี้ไปที่ root ของ repo

## File Structure

| ไฟล์ | หน้าที่ | Task |
|---|---|---|
| `prisma/schema.prisma` (แก้) | เพิ่มโมเดล `ChannelMetric` | 1 |
| `lib/channel-metrics.ts` (ใหม่) | parse `Overview.csv` → `ChannelMetricInput[]` + จำนวนแถวที่ข้าม | 1 |
| `lib/channel-reach.ts` (ใหม่) | pure aggregation: วิว+ออเดอร์ → แถวรายสัปดาห์ + สรุป 30 วัน | 2 |
| `app/actions.ts` (แก้) | Server Action `importChannelMetrics` | 3 |
| `lib/entry-queries.ts` (แก้) | ดึง `channelMetrics` ใน `getDashboardData` | 3 |
| `components/channel-reach-panel.tsx` (ใหม่) | ตารางรายสัปดาห์ + แถบสรุป | 4 |
| `components/dashboard-panel.tsx` (แก้) | ฟอร์มอัปโหลดตัวที่ 4 + วางแผงใหม่ | 4 |
| `app/dashboard/page.tsx` (แก้) | ส่ง prop `channelMetrics` | 4 |
| `CLAUDE.md` (แก้) | บันทึกกฎที่ต้องรู้ของฟีเจอร์นี้ | 5 |

## วิธีรันเทสต์ในโปรเจกต์นี้

โปรเจกต์**ไม่มี test runner** และ**ไม่มี `tsx`** วิธีทดสอบ pure function คือคอมไพล์ด้วย `tsc` ลง scratch dir แล้วรันด้วย `node` โดยต้องแก้ปัญหา path alias `@/` เองเพราะ `tsc` ไม่เขียน path ใน `require()` ให้

**สคริปต์ตั้งต้นที่ทุก Task ใช้ร่วมกัน** — สร้างไฟล์นี้ก่อนเทสต์ครั้งแรก:

สร้าง `<scratch>/run-tests.sh` (`<scratch>` = scratch dir ของ session ห้ามสร้างในโฟลเดอร์ repo):

```bash
#!/usr/bin/env bash
set -e
REPO="C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt"
OUT="$1"; shift
cd "$REPO"
npx tsc "$@" \
  --outDir "$OUT" --rootDir . \
  --module commonjs --target ES2017 --moduleResolution node \
  --skipLibCheck --esModuleInterop
```

และ `<scratch>/alias.js` (ตัวลงทะเบียน alias `@/` ให้ node หาไฟล์ที่คอมไพล์แล้วเจอ ไม่ต้องลง dependency ใหม่):

```js
const Module = require("module");
const path = require("path");
const OUT = process.env.TEST_OUT;
const orig = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request.startsWith("@/")) {
    request = path.join(OUT, request.slice(2));
  }
  return orig.call(this, request, ...args);
};
```

เรียกใช้: `TEST_OUT=<out> node -r <scratch>/alias.js <scratch>/test-xxx.js`

---

### Task 1: ตาราง `ChannelMetric` + parser `Overview.csv`

**Files:**
- Modify: `prisma/schema.prisma` (เพิ่มโมเดลท้ายไฟล์)
- Create: `lib/channel-metrics.ts`
- Test: `<scratch>/test-channel-metrics.js`

**Interfaces:**
- Consumes: `parseCsvRows`, `parseMonthDayLabel` จาก `@/lib/csv` (มีอยู่แล้ว)
- Produces:
  - `type ChannelMetricInput = { statsOn: Date; videoViews: number; profileViews: number; likes: number; comments: number; shares: number }`
  - `type OverviewParseResult = { rows: ChannelMetricInput[]; skipped: number }`
  - `function parseOverviewCsv(text: string, importedAt: Date): OverviewParseResult`
  - โมเดล Prisma `ChannelMetric` ที่มี `statsOn` เป็น `@unique`

- [ ] **Step 1: เพิ่มโมเดลลง `prisma/schema.prisma`**

ต่อท้ายไฟล์ (หลังโมเดล `FollowerActivity`):

```prisma
/// สถิติระดับ "ทั้งช่อง" รายวัน จาก Overview.csv — ต่างจาก ClipMetric ที่เป็นรายคลิป
/// ไฟล์นี้ไม่มีเพดานจำนวนแถวแบบ Content.csv จึงเป็นแหล่งวิวชุดเดียวที่ครบทุกคลิป
model ChannelMetric {
  id           String   @id @default(cuid())
  /// วันของสถิติ (เวลาไทย) เก็บเป็น UTC midnight เหมือน postedAt — อ่านด้วย getUTC* เท่านั้น
  statsOn      DateTime @unique
  videoViews   Int
  profileViews Int
  likes        Int
  /// ติดลบได้ (คอมเมนต์ถูกลบ) ห้ามใส่ constraint หรือ Math.abs
  comments     Int
  shares       Int
  importedAt   DateTime @default(now())
}
```

- [ ] **Step 2: รัน migration**

```bash
npx prisma migrate dev --name add_channel_metric
npx prisma generate
```

Expected: migration ผ่าน และ `lib/generated/prisma/` ถูก regenerate

- [ ] **Step 3: เขียนเทสต์ที่ยังไม่ผ่าน**

สร้าง `<scratch>/test-channel-metrics.js`:

```js
const assert = require("assert");
const path = require("path");
const { parseOverviewCsv } = require(path.join(process.env.TEST_OUT, "lib/channel-metrics.js"));

const HEAD = '"Date","Video Views","Profile Views","Likes","Comments","Shares"';
const REF = new Date("2026-07-12T00:00:00Z");

// 1. แถวปกติ อ่านครบทุกฟิลด์ และวันที่เป็น UTC midnight
{
  const r = parseOverviewCsv(`${HEAD}\n"June 13","67","3","2","1","0"\n`, REF);
  assert.strictEqual(r.rows.length, 1, "ต้องได้ 1 แถว");
  assert.strictEqual(r.skipped, 0);
  const row = r.rows[0];
  assert.strictEqual(row.videoViews, 67);
  assert.strictEqual(row.profileViews, 3);
  assert.strictEqual(row.likes, 2);
  assert.strictEqual(row.comments, 1);
  assert.strictEqual(row.shares, 0);
  assert.strictEqual(row.statsOn.toISOString(), "2026-06-13T00:00:00.000Z");
}

// 2. คอมเมนต์ติดลบต้องเก็บตามจริง (พบจริงในไฟล์: "June 20" มี Comments = -6)
{
  const r = parseOverviewCsv(`${HEAD}\n"June 20","474","6","5","-6","1"\n`, REF);
  assert.strictEqual(r.rows[0].comments, -6, "ค่าติดลบต้องไม่ถูกแปลงเป็น 0 หรือ 6");
}

// 3. Video Views ที่อ่านไม่ออกต้องข้ามทั้งแถว ไม่ใช่บันทึกเป็น 0
{
  const r = parseOverviewCsv(
    `${HEAD}\n"July 10","4593","5","30","0","8"\n"July 11","undefined","0","0","0","0"\n`,
    REF
  );
  assert.strictEqual(r.rows.length, 1, "แถว undefined ต้องถูกข้าม");
  assert.strictEqual(r.rows[0].videoViews, 4593);
  assert.strictEqual(r.skipped, 1, "ต้องรายงานว่าข้ามไป 1 แถว");
}

// 4. BOM นำหน้าไฟล์ต้องไม่ทำให้แถวแรกเพี้ยน
{
  const r = parseOverviewCsv(`\uFEFF${HEAD}\n"June 13","67","0","0","0","0"\n`, REF);
  assert.strictEqual(r.rows.length, 1, "BOM ต้องถูกตัด");
}

// 5. ตัวเลขที่มีคอมมาคั่นหลัก
{
  const r = parseOverviewCsv(`${HEAD}\n"July 10","4,593","5","30","0","8"\n`, REF);
  assert.strictEqual(r.rows[0].videoViews, 4593);
}

// 6. แถวสั้น/ขาดคอลัมน์ ต้องไม่ throw และเติม 0 ให้ฟิลด์ที่ขาด
{
  const r = parseOverviewCsv('"Date","Video Views"\n"June 13","67"\n', REF);
  assert.strictEqual(r.rows.length, 1);
  assert.strictEqual(r.rows[0].shares, 0);
}

// 7. วันที่อ่านไม่ออก (เช่นแถวสรุปท้ายไฟล์) ต้องถูกข้าม
{
  const r = parseOverviewCsv(`${HEAD}\n"Total","999","0","0","0","0"\n`, REF);
  assert.strictEqual(r.rows.length, 0);
  assert.strictEqual(r.skipped, 1);
}

// 8. ไฟล์ที่มีแต่หัวตาราง
{
  const r = parseOverviewCsv(`${HEAD}\n`, REF);
  assert.strictEqual(r.rows.length, 0);
  assert.strictEqual(r.skipped, 0);
}

console.log("PASS: channel-metrics parser (8 กรณี)");
```

- [ ] **Step 4: รันเทสต์ให้เห็นว่าไม่ผ่าน**

```bash
bash <scratch>/run-tests.sh <scratch>/out lib/csv.ts lib/channel-metrics.ts
```

Expected: FAIL — `error TS6053: File 'lib/channel-metrics.ts' not found.`

- [ ] **Step 5: เขียน `lib/channel-metrics.ts`**

```ts
import { parseCsvRows, parseMonthDayLabel } from "@/lib/csv";

export type ChannelMetricInput = {
  statsOn: Date;
  videoViews: number;
  profileViews: number;
  likes: number;
  comments: number;
  shares: number;
};

export type OverviewParseResult = {
  rows: ChannelMetricInput[];
  /** แถวข้อมูลที่อ่านไม่ได้ (วันที่เพี้ยน หรือวิวไม่ใช่ตัวเลข) — รายงานต่อให้ผู้ใช้เห็น */
  skipped: number;
};

// ตำแหน่งคอลัมน์ (0-based) ใน Overview.csv ของ TikTok Studio
const COL = {
  date: 0,
  videoViews: 1,
  profileViews: 2,
  likes: 3,
  comments: 4,
  shares: 5,
} as const;

/**
 * แปลงตัวเลขจากไฟล์ — คืน null เมื่ออ่านไม่ออก
 *
 * ต่างจาก num() ใน lib/clip-metrics.ts ที่คืน 0 เพราะไฟล์นี้ต้องแยกให้ออกระหว่าง
 * "ศูนย์จริง" กับ "ไม่มีข้อมูล" (ไฟล์ export ของ TikTok ใส่คำว่า "undefined" มาในวัน
 * ที่ยังไม่มีข้อมูล) และใช้ Number() แทน parseInt() เพราะ parseInt("12abc") = 12
 * ซึ่งกลืนข้อมูลเสียเข้ามาเงียบๆ
 *
 * ต้องรองรับค่าติดลบ: คอลัมน์ Comments เป็นลบได้เมื่อคอมเมนต์ถูกลบ (พบจริง "June 20" = -6)
 */
function num(v: unknown): number | null {
  const s = String(v ?? "")
    .replace(/,/g, "")
    .trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export function parseOverviewCsv(text: string, importedAt: Date): OverviewParseResult {
  // ไฟล์จาก TikTok Studio มี BOM นำหน้า ถ้าไม่ตัด ชื่อคอลัมน์แรกจะเพี้ยนและ parse ผิด
  const allRows = parseCsvRows(text.replace(/^\uFEFF/, ""));
  if (allRows.length < 2) return { rows: [], skipped: 0 };

  const rows: ChannelMetricInput[] = [];
  let skipped = 0;

  for (let i = 1; i < allRows.length; i++) {
    const r = allRows[i];
    const statsOn = parseMonthDayLabel(String(r[COL.date] ?? ""), importedAt);
    if (!statsOn) {
      skipped++;
      continue;
    }

    // วิววิดีโอเป็นตัวหารของ conversion — ถ้าอ่านไม่ออกต้องข้ามทั้งแถว ห้ามบันทึกเป็น 0
    // เพราะจะกลายเป็นวัน "มีออเดอร์แต่วิวศูนย์" ปลอมๆ แล้วลาก conversion ให้เพี้ยน
    const videoViews = num(r[COL.videoViews]);
    if (videoViews === null) {
      skipped++;
      continue;
    }

    rows.push({
      statsOn,
      videoViews,
      profileViews: num(r[COL.profileViews]) ?? 0,
      likes: num(r[COL.likes]) ?? 0,
      comments: num(r[COL.comments]) ?? 0,
      shares: num(r[COL.shares]) ?? 0,
    });
  }

  return { rows, skipped };
}
```

- [ ] **Step 6: รันเทสต์ให้ผ่าน**

```bash
bash <scratch>/run-tests.sh <scratch>/out lib/csv.ts lib/channel-metrics.ts
TEST_OUT=<scratch>/out node -r <scratch>/alias.js <scratch>/test-channel-metrics.js
```

Expected: `PASS: channel-metrics parser (8 กรณี)`

- [ ] **Step 7: ตรวจ type/lint และ commit**

```bash
npx tsc --noEmit
npm run lint
git diff tsconfig.json    # ต้องว่าง
git add prisma/schema.prisma prisma/migrations lib/channel-metrics.ts
git commit -m "Add ChannelMetric table and Overview.csv parser"
```

---

### Task 2: Aggregation `lib/channel-reach.ts`

**Files:**
- Create: `lib/channel-reach.ts`
- Test: `<scratch>/test-channel-reach.js`

**Interfaces:**
- Consumes: `weekStartOfPostedAt`, `weekStartOfLocal` จาก `@/lib/weekly-scoreboard` · `AffiliateOrderRecord` จาก `@/lib/dashboard`
- Produces:
  - `type ChannelMetricRecord = { statsOn: Date; videoViews: number }`
  - `type ReachWeekRow = { weekStart: Date; views: number; orders: number; convPct: number | null }`
  - `type ChannelReach = { weeks: ReachWeekRow[]; views30d: number; orders30d: number; conv30d: number | null; convPrev30d: number | null }`
  - `function buildChannelReach(args: { metrics: ChannelMetricRecord[]; orders: AffiliateOrderRecord[] }): ChannelReach`

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

สร้าง `<scratch>/test-channel-reach.js`:

```js
const assert = require("assert");
const path = require("path");
const { buildChannelReach } = require(path.join(process.env.TEST_OUT, "lib/channel-reach.js"));

/** ออเดอร์ปลอมที่มีครบทุกฟิลด์ตาม AffiliateOrderRecord */
function mkOrder(orderDate, id = String(Math.random())) {
  return {
    orderId: id,
    productName: "สินค้าทดสอบ",
    contentId: "c1",
    status: "ชำระแล้ว",
    gmv: 100,
    itemsSold: 1,
    itemsRefunded: 0,
    actualCommission: 10,
    finalRevenue: 8,
    orderDate,
    matchedEntryId: null,
    importedAt: new Date(),
  };
}
/** statsOn เก็บเป็น UTC midnight (เหมือนที่ parseMonthDayLabel สร้าง) */
const stats = (y, m, d) => new Date(Date.UTC(y, m, d));

// 1. *** เทสต์สำคัญที่สุด *** statsOn (UTC) กับ orderDate (local) ที่เป็นวันเดียวกัน
//    ตามปฏิทินไทย ต้องถูกจัดลงสัปดาห์เดียวกัน — จับบั๊กสลับ getUTC*/get* โดยตรง
{
  const r = buildChannelReach({
    metrics: [{ statsOn: stats(2026, 6, 8), videoViews: 1000 }],
    orders: [mkOrder(new Date(2026, 6, 8, 14, 30))], // 8 ก.ค. 14:30 เวลาเครื่อง
  });
  assert.strictEqual(r.weeks.length, 1);
  assert.strictEqual(r.weeks[0].orders, 1, "ออเดอร์วันเดียวกับข้อมูลวิวต้องถูกนับ");
  assert.strictEqual(r.weeks[0].views, 1000);
  assert.ok(Math.abs(r.weeks[0].convPct - 0.1) < 1e-9, "conv ต้อง = 0.1%");
}

// 2. ออเดอร์ในวันที่ไม่มีข้อมูลวิว ต้องไม่ถูกนับ แม้จะอยู่สัปดาห์เดียวกัน
//    (สัปดาห์หัวท้ายของช่วง import มีวิวไม่ครบ 7 วัน ถ้านับหมดจะทำให้ conv สูงเกินจริง)
{
  const r = buildChannelReach({
    metrics: [{ statsOn: stats(2026, 6, 8), videoViews: 1000 }],
    orders: [mkOrder(new Date(2026, 6, 9, 10, 0))], // 9 ก.ค. อยู่สัปดาห์เดียวกันแต่ไม่มีวิว
  });
  assert.strictEqual(r.weeks[0].orders, 0, "วันที่ไม่มีข้อมูลวิวต้องไม่นับออเดอร์");
}

// 3. วิวเป็นศูนย์ต้องได้ convPct === null ไม่ใช่ Infinity หรือ NaN
{
  const r = buildChannelReach({
    metrics: [{ statsOn: stats(2026, 6, 8), videoViews: 0 }],
    orders: [mkOrder(new Date(2026, 6, 8, 9, 0))],
  });
  assert.strictEqual(r.weeks[0].convPct, null);
}

// 4. หลายวันในสัปดาห์เดียวกันต้องรวมกัน และเรียงใหม่→เก่า
{
  const r = buildChannelReach({
    metrics: [
      { statsOn: stats(2026, 6, 6), videoViews: 100 },  // จันทร์
      { statsOn: stats(2026, 6, 7), videoViews: 200 },  // อังคาร
      { statsOn: stats(2026, 6, 13), videoViews: 50 },  // จันทร์ถัดไป
    ],
    orders: [],
  });
  assert.strictEqual(r.weeks.length, 2);
  assert.strictEqual(r.weeks[0].views, 50, "แถวแรกต้องเป็นสัปดาห์ใหม่สุด");
  assert.strictEqual(r.weeks[1].views, 300, "สองวันในสัปดาห์เดียวต้องรวมกัน");
}

// 5. สรุป 30 วันนับถอยจากวันที่มีข้อมูลล่าสุด ไม่ใช่จากวันนี้
{
  const metrics = [];
  for (let d = 1; d <= 60; d++) {
    metrics.push({ statsOn: stats(2026, 4, d), videoViews: 100 }); // พ.ค. 1-60 (ล้นไป มิ.ย.)
  }
  const r = buildChannelReach({ metrics, orders: [] });
  assert.strictEqual(r.views30d, 3000, "30 วันล่าสุด = 30 วัน x 100 วิว");
}

// 6. input ว่างต้องไม่ throw
{
  const r = buildChannelReach({ metrics: [], orders: [] });
  assert.deepStrictEqual(r.weeks, []);
  assert.strictEqual(r.conv30d, null);
  assert.strictEqual(r.convPrev30d, null);
}

// 7. ไม่มีข้อมูลช่วงก่อนหน้า → convPrev30d ต้องเป็น null (UI จะได้ซ่อนลูกศร)
{
  const r = buildChannelReach({
    metrics: [{ statsOn: stats(2026, 6, 8), videoViews: 1000 }],
    orders: [mkOrder(new Date(2026, 6, 8, 9, 0))],
  });
  assert.strictEqual(r.convPrev30d, null);
}

console.log("PASS: channel-reach aggregation (7 กรณี)");
```

- [ ] **Step 2: รันเทสต์ให้เห็นว่าไม่ผ่าน**

```bash
bash <scratch>/run-tests.sh <scratch>/out lib/csv.ts lib/channel-metrics.ts lib/channel-reach.ts lib/weekly-scoreboard.ts lib/dashboard.ts lib/affiliate.ts
```

Expected: FAIL — `File 'lib/channel-reach.ts' not found.`

- [ ] **Step 3: เขียน `lib/channel-reach.ts`**

```ts
import type { AffiliateOrderRecord } from "@/lib/dashboard";
import { weekStartOfLocal, weekStartOfPostedAt } from "@/lib/weekly-scoreboard";

const DAY_MS = 24 * 60 * 60 * 1000;

/** รับ shape แคบๆ ไม่ผูกกับ Prisma เพื่อให้ทดสอบง่าย (แบบเดียวกับ ScoreboardEntry) */
export type ChannelMetricRecord = {
  statsOn: Date;
  videoViews: number;
};

export type ReachWeekRow = {
  /** จันทร์ 00:00 UTC ใช้เป็นคีย์ของสัปดาห์ (วันตามปฏิทิน ไม่ใช่เวลาจริง) */
  weekStart: Date;
  views: number;
  orders: number;
  /** null เมื่อสัปดาห์นั้นวิวเป็นศูนย์ — ห้ามคืน Infinity/NaN ให้ UI ไปเรนเดอร์ */
  convPct: number | null;
};

export type ChannelReach = {
  /** เรียงใหม่→เก่า */
  weeks: ReachWeekRow[];
  views30d: number;
  orders30d: number;
  conv30d: number | null;
  /** conversion ของ 30 วันก่อนหน้านั้นอีกช่วง — null เมื่อยังไม่มีข้อมูล (UI ซ่อนลูกศร) */
  convPrev30d: number | null;
};

/**
 * คีย์วันตามปฏิทินจาก statsOn ซึ่งเก็บเป็น UTC midnight — ต้องอ่านด้วย getUTC*
 * คู่กับ dayKeyLocal ด้านล่าง สลับกันเมื่อไรวันจะเลื่อนไป 1 วันเงียบๆ
 */
function dayKeyUtc(d: Date): string {
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

/** คีย์วันตามปฏิทินจาก orderDate ซึ่งเป็น timestamp จริง — ต้องอ่านด้วย local getter */
function dayKeyLocal(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function buildChannelReach(args: {
  metrics: ChannelMetricRecord[];
  orders: AffiliateOrderRecord[];
}): ChannelReach {
  const { metrics, orders } = args;

  if (metrics.length === 0) {
    return { weeks: [], views30d: 0, orders30d: 0, conv30d: null, convPrev30d: null };
  }

  // วิวรายสัปดาห์ + จำวันที่มีข้อมูลวิวไว้ เพื่อใช้กรองออเดอร์ทีหลัง
  //
  // statsOn เก็บเป็น UTC midnight → ใช้ weekStartOfPostedAt (UTC getter)
  // ส่วน orderDate เป็น timestamp จริง → ใช้ weekStartOfLocal (local getter) ด้านล่าง
  // *** ห้ามสลับสองตัวนี้ *** สลับแล้วสัปดาห์จะเหลื่อมกันโดยไม่มีอะไรฟ้อง
  const viewsByWeek = new Map<number, number>();
  const dayToWeek = new Map<string, number>();
  for (const m of metrics) {
    const wk = weekStartOfPostedAt(m.statsOn).getTime();
    viewsByWeek.set(wk, (viewsByWeek.get(wk) ?? 0) + m.videoViews);
    dayToWeek.set(dayKeyUtc(m.statsOn), wk);
  }

  // นับออเดอร์เฉพาะวันที่มีข้อมูลวิวจริงเท่านั้น — สัปดาห์หัวท้ายของช่วง import มักมีวิว
  // ไม่ครบ 7 วัน ถ้านับออเดอร์ทั้งสัปดาห์มาหารด้วยวิวแค่ 5 วัน conv% จะสูงเกินจริง
  const ordersByWeek = new Map<number, number>();
  for (const o of orders) {
    const wk = dayToWeek.get(dayKeyLocal(o.orderDate));
    if (wk === undefined) continue;
    ordersByWeek.set(wk, (ordersByWeek.get(wk) ?? 0) + 1);
  }

  const weeks: ReachWeekRow[] = [...viewsByWeek.entries()]
    .map(([wk, views]) => {
      const count = ordersByWeek.get(wk) ?? 0;
      return {
        weekStart: new Date(wk),
        views,
        orders: count,
        convPct: views > 0 ? (100 * count) / views : null,
      };
    })
    .sort((a, b) => b.weekStart.getTime() - a.weekStart.getTime());

  // ช่วง 30 วันนับถอยจาก "วันที่มีข้อมูลล่าสุดในตาราง" ไม่ใช่จากวันนี้ — ถ้านับจากวันนี้
  // ช่วงที่ยังไม่ได้ import จะถูกนับเป็นวิว 0 แล้วลาก conversion ให้เพี้ยน
  const latest = Math.max(...metrics.map((m) => m.statsOn.getTime()));

  function window(fromMs: number, toMs: number) {
    const days = new Set<string>();
    let views = 0;
    for (const m of metrics) {
      const t = m.statsOn.getTime();
      if (t < fromMs || t > toMs) continue;
      days.add(dayKeyUtc(m.statsOn));
      views += m.videoViews;
    }
    let count = 0;
    for (const o of orders) {
      if (days.has(dayKeyLocal(o.orderDate))) count++;
    }
    return { views, orders: count, conv: views > 0 ? (100 * count) / views : null };
  }

  const cur = window(latest - 29 * DAY_MS, latest);
  const prev = window(latest - 59 * DAY_MS, latest - 30 * DAY_MS);

  return {
    weeks,
    views30d: cur.views,
    orders30d: cur.orders,
    conv30d: cur.conv,
    convPrev30d: prev.conv,
  };
}
```

- [ ] **Step 4: รันเทสต์ให้ผ่าน**

```bash
bash <scratch>/run-tests.sh <scratch>/out lib/csv.ts lib/channel-metrics.ts lib/channel-reach.ts lib/weekly-scoreboard.ts lib/dashboard.ts lib/affiliate.ts
TEST_OUT=<scratch>/out node -r <scratch>/alias.js <scratch>/test-channel-reach.js
```

Expected: `PASS: channel-reach aggregation (7 กรณี)`

- [ ] **Step 5: ตรวจ type/lint และ commit**

```bash
npx tsc --noEmit
npm run lint
git diff tsconfig.json    # ต้องว่าง
git add lib/channel-reach.ts
git commit -m "Add channel reach aggregation with day-level order matching"
```

---

### Task 3: Server Action + ดึงข้อมูลเข้าหน้า dashboard

**Files:**
- Modify: `app/actions.ts` (เพิ่ม import + action ใหม่ต่อจาก `importFollowerActivity`)
- Modify: `lib/entry-queries.ts` (ใน `getDashboardData`)

**Interfaces:**
- Consumes: `parseOverviewCsv`, `OverviewParseResult` จาก Task 1
- Produces:
  - `type ChannelMetricImportSummary = { total: number; skipped: number; firstDate: Date | null; lastDate: Date | null }`
  - `async function importChannelMetrics(formData: FormData): Promise<ChannelMetricImportSummary>`
  - `getDashboardData()` คืนฟิลด์ `channelMetrics` เพิ่ม (ชนิด `ChannelMetric[]` ของ Prisma)

- [ ] **Step 1: เพิ่ม import ใน `app/actions.ts`**

หาบรรทัด `import { parseFollowerActivityCsv } from "@/lib/follower-activity";` แล้วเพิ่มต่อท้าย:

```ts
import { parseOverviewCsv } from "@/lib/channel-metrics";
```

- [ ] **Step 2: เพิ่ม Server Action ต่อจาก `importFollowerActivity`**

วางต่อจากบรรทัดปิดปีกกาของ `importFollowerActivity` (ก่อน `export async function deleteProductImage`):

```ts
export type ChannelMetricImportSummary = {
  total: number;
  skipped: number;
  firstDate: Date | null;
  lastDate: Date | null;
};

/**
 * นำเข้า Overview.csv — วิวรวมทั้งช่องรายวัน
 *
 * ต่างจาก Content.csv ตรงที่ไฟล์นี้ไม่มีเพดาน 15 แถว จึงเป็นแหล่งวิวชุดเดียวที่ครบ
 * ทุกคลิป ใช้เป็นตัวหารของ conversion ระดับช่องที่ไม่มี selection bias
 */
export async function importChannelMetrics(
  formData: FormData
): Promise<ChannelMetricImportSummary> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("กรุณาเลือกไฟล์ Overview (.csv)");
  }

  const text = await file.text();
  const importedAt = new Date();
  let parsed;
  try {
    parsed = parseOverviewCsv(text, importedAt);
  } catch {
    throw new Error("อ่านไฟล์ไม่สำเร็จ — ต้องเป็นไฟล์ Overview (.csv) จาก TikTok Studio");
  }
  if (parsed.rows.length === 0) {
    throw new Error("ไม่พบข้อมูลวิวรายวันในไฟล์ — ตรวจว่าเลือก Overview.csv ไม่ใช่ไฟล์อื่น");
  }

  // upsert ด้วย statsOn — โยนไฟล์เดิมซ้ำได้ ไม่เกิดแถวซ้ำ (ช่วง 28 วันของแต่ละไฟล์ทับกันอยู่แล้ว)
  for (const r of parsed.rows) {
    await prisma.channelMetric.upsert({
      where: { statsOn: r.statsOn },
      create: r,
      update: { ...r, importedAt: new Date() },
    });
  }

  const times = parsed.rows.map((r) => r.statsOn.getTime());
  revalidatePath("/dashboard");
  return {
    total: parsed.rows.length,
    skipped: parsed.skipped,
    firstDate: new Date(Math.min(...times)),
    lastDate: new Date(Math.max(...times)),
  };
}
```

- [ ] **Step 3: ดึง `channelMetrics` ใน `getDashboardData`**

ใน `lib/entry-queries.ts` แก้ destructure ของ `Promise.all` (บรรทัด ~97) จาก:

```ts
  const [orders, clipMetrics, followerActivity] = await Promise.all([
    prisma.affiliateOrder.findMany({ orderBy: { orderDate: "asc" } }),
    prisma.clipMetric.findMany({ orderBy: { capturedOn: "asc" } }),
    prisma.followerActivity.findMany({
      orderBy: [{ activityOn: "asc" }, { hour: "asc" }],
    }),
  ]);
```

เป็น:

```ts
  const [orders, clipMetrics, followerActivity, channelMetrics] = await Promise.all([
    prisma.affiliateOrder.findMany({ orderBy: { orderDate: "asc" } }),
    prisma.clipMetric.findMany({ orderBy: { capturedOn: "asc" } }),
    prisma.followerActivity.findMany({
      orderBy: [{ activityOn: "asc" }, { hour: "asc" }],
    }),
    prisma.channelMetric.findMany({ orderBy: { statsOn: "asc" } }),
  ]);
```

แล้วในบล็อก `return { ... }` ท้ายฟังก์ชัน เพิ่มบรรทัดต่อจาก `followerActivity,`:

```ts
    channelMetrics,
```

- [ ] **Step 4: ตรวจ type/lint**

```bash
npx tsc --noEmit
npm run lint
```

Expected: ไม่มี error ทั้งคู่

- [ ] **Step 5: ทดสอบ action จริงด้วย isolated dev server**

```bash
cp dev.db dev-test.db
NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001
```

ยังไม่มี UI ให้กด — ตรวจแค่ว่าเซิร์ฟเวอร์ขึ้นได้ไม่มี error ตอน compile แล้วปิด

```bash
# หา PID ที่ฟัง port 3001 แล้วปิด (Windows/git-bash ต้องใช้ double-slash)
netstat -ano | grep ':3001' | grep LISTENING
taskkill //PID <pid> //F
rm -rf .next-dev dev-test.db
git checkout -- tsconfig.json    # dev server แก้ไฟล์นี้เองได้
```

- [ ] **Step 6: Commit**

```bash
git diff tsconfig.json    # ต้องว่าง
git add app/actions.ts lib/entry-queries.ts
git commit -m "Add importChannelMetrics action and load channel metrics on the dashboard"
```

---

### Task 4: แผง UI + ฟอร์มอัปโหลด

**Files:**
- Create: `components/channel-reach-panel.tsx`
- Modify: `components/dashboard-panel.tsx`
- Modify: `app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `buildChannelReach`, `ChannelMetricRecord`, `ChannelReach` จาก Task 2 · `importChannelMetrics`, `ChannelMetricImportSummary` จาก Task 3
- Produces: `function ChannelReachPanel(props: { metrics: ChannelMetricRecord[]; orders: AffiliateOrderRecord[] }): JSX.Element`

- [ ] **Step 1: เขียน `components/channel-reach-panel.tsx`**

```tsx
"use client";

import { useMemo } from "react";

import type { AffiliateOrderRecord } from "@/lib/dashboard";
import { buildChannelReach, type ChannelMetricRecord } from "@/lib/channel-reach";

function int(n: number): string {
  return n.toLocaleString("th-TH");
}

function pct(v: number | null): string {
  return v === null ? "—" : `${v.toFixed(2)}%`;
}

/**
 * "27 ก.ค." — weekStart เป็น UTC midnight (มาจาก mondayUtc ใน lib/weekly-scoreboard.ts)
 * ต้องฟอร์แมตด้วย timeZone: "UTC" ไม่งั้นจะเลื่อนไป 1 วันในโซนเวลาไทย
 */
function weekLabel(d: Date): string {
  return d.toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function ChannelReachPanel({
  metrics,
  orders,
}: {
  metrics: ChannelMetricRecord[];
  orders: AffiliateOrderRecord[];
}) {
  const reach = useMemo(() => buildChannelReach({ metrics, orders }), [metrics, orders]);

  if (reach.weeks.length === 0) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="h-4 w-1 rounded-full bg-teal" />
          <h3 className="font-mono text-xs tracking-widest text-teal uppercase">
            วิวทั้งช่อง &amp; conversion
          </h3>
        </div>
        <p className="text-sm text-muted-foreground">
          ยังไม่มีข้อมูล — อัป Overview.csv จาก TikTok Studio เพื่อดูวิวรวมทั้งช่องแบบครบทุกคลิป
        </p>
      </div>
    );
  }

  const trend =
    reach.conv30d !== null && reach.convPrev30d !== null
      ? reach.conv30d >= reach.convPrev30d
        ? "up"
        : "down"
      : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="h-4 w-1 rounded-full bg-teal" />
        <h3 className="font-mono text-xs tracking-widest text-teal uppercase">
          วิวทั้งช่อง &amp; conversion
        </h3>
      </div>

      <div className="flex flex-wrap gap-x-8 gap-y-2">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[0.6rem] tracking-wide text-muted-foreground uppercase">
            วิวทั้งช่อง 30 วัน
          </span>
          <span className="font-mono text-lg font-bold">{int(reach.views30d)}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[0.6rem] tracking-wide text-muted-foreground uppercase">
            conversion 30 วัน
          </span>
          <span className="flex items-baseline gap-1.5">
            <span className="font-mono text-lg font-bold text-teal">{pct(reach.conv30d)}</span>
            {trend !== null && (
              <span
                className={
                  trend === "up"
                    ? "font-mono text-[0.7rem] text-success-foreground"
                    : "font-mono text-[0.7rem] text-danger"
                }
              >
                {trend === "up" ? "▲" : "▼"} จาก {pct(reach.convPrev30d)}
              </span>
            )}
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-96 text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="py-1.5 pr-3 font-mono text-[0.6rem] tracking-wide font-normal text-muted-foreground uppercase">
                สัปดาห์
              </th>
              <th className="py-1.5 pr-3 text-right font-mono text-[0.6rem] tracking-wide font-normal text-muted-foreground uppercase">
                วิวทั้งช่อง
              </th>
              <th className="py-1.5 pr-3 text-right font-mono text-[0.6rem] tracking-wide font-normal text-muted-foreground uppercase">
                ออเดอร์
              </th>
              <th className="py-1.5 text-right font-mono text-[0.6rem] tracking-wide font-normal text-muted-foreground uppercase">
                conv%
              </th>
            </tr>
          </thead>
          <tbody>
            {reach.weeks.map((w) => (
              <tr key={w.weekStart.getTime()} className="border-b border-border/50">
                <td className="py-1.5 pr-3 font-mono text-xs">{weekLabel(w.weekStart)}</td>
                <td className="py-1.5 pr-3 text-right font-mono text-xs">{int(w.views)}</td>
                <td className="py-1.5 pr-3 text-right font-mono text-xs">{int(w.orders)}</td>
                <td className="py-1.5 text-right font-mono text-xs font-semibold">
                  {pct(w.convPct)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        ออเดอร์นับตามวันที่สั่งซื้อ ส่วนวิวนับตามวันที่เกิดวิว — คนดูคลิปวันนี้อาจไปสั่งพรุ่งนี้
        ดังนั้น conv% รายสัปดาห์เป็นค่าประมาณ ใช้ดูแนวโน้มข้ามหลายสัปดาห์ได้
        แต่อย่าอ่านสัปดาห์เดียวแล้วสรุป · นับเฉพาะวันที่มีข้อมูลวิวเท่านั้น
      </p>
    </div>
  );
}
```

- [ ] **Step 2: เพิ่ม import และ state ใน `components/dashboard-panel.tsx`**

เพิ่มต่อจากบรรทัด `import { importFollowerActivity } from "@/app/actions";`:

```ts
import { importChannelMetrics, type ChannelMetricImportSummary } from "@/app/actions";
import { ChannelReachPanel } from "@/components/channel-reach-panel";
import type { ChannelMetricRecord } from "@/lib/channel-reach";
```

เพิ่ม prop `channelMetrics` เข้าไปใน type ของ props (ต่อจาก `followerActivity`) และใน destructure:

```ts
  channelMetrics: ChannelMetricRecord[];
```

เพิ่ม `useActionState` block ต่อจากของ `followerAction` (บรรทัด ~141):

```tsx
  const [channelState, channelAction, isImportingChannel] = useActionState<
    { summary: ChannelMetricImportSummary | null; error: string | null },
    FormData
  >(
    async (_prev, formData) => {
      try {
        const summary = await importChannelMetrics(formData);
        return { summary, error: null };
      } catch (e) {
        return { summary: null, error: e instanceof Error ? e.message : "อัปโหลดไม่สำเร็จ" };
      }
    },
    { summary: null, error: null }
  );
```

- [ ] **Step 3: เพิ่มฟอร์มอัปโหลดตัวที่ 4**

วางต่อจากบล็อก `{followerState.summary && (...)}` (ก่อน `</>` ที่ปิดกล่อง import):

```tsx
            <form action={channelAction} className="flex flex-wrap items-center gap-2">
              <Input
                type="file"
                name="file"
                accept=".csv,text/csv"
                className="h-auto max-w-xs py-1.5"
                required
              />
              <Button type="submit" size="sm" variant="outline" disabled={isImportingChannel}>
                <Upload className="size-3.5" />
                {isImportingChannel ? "กำลังนำเข้า..." : "นำเข้าวิวทั้งช่อง"}
              </Button>
              <span className="font-mono text-[0.7rem] text-muted-foreground">
                โหลดจาก TikTok Studio → Analytics → Overview → Download (Overview.csv) · ให้ย้อนหลัง 28 วัน อัปทุก ≤28 วันจะได้ประวัติต่อเนื่อง
              </span>
            </form>

            {channelState.error && (
              <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
                {channelState.error}
              </p>
            )}

            {channelState.summary && (
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                นำเข้า {channelState.summary.total} วัน
                {channelState.summary.skipped > 0 && ` · ข้าม ${channelState.summary.skipped} แถว`}
              </div>
            )}
```

- [ ] **Step 4: วางแผงใหม่ในหน้า dashboard**

หาบรรทัด `{orders.length > 0 && <RevenueByClipList orders={orders} />}` แล้วเพิ่มบรรทัดนี้**ก่อนหน้า**:

```tsx
      <ChannelReachPanel metrics={channelMetrics} orders={orders} />
```

- [ ] **Step 5: ส่ง prop จาก `app/dashboard/page.tsx`**

เพิ่มบรรทัดต่อจาก `followerActivity={data.followerActivity}`:

```tsx
          channelMetrics={data.channelMetrics}
```

- [ ] **Step 6: ตรวจ type/lint**

```bash
npx tsc --noEmit
npm run lint
```

Expected: ไม่มี error ทั้งคู่

- [ ] **Step 7: Commit**

```bash
git diff tsconfig.json    # ต้องว่าง
git add components/channel-reach-panel.tsx components/dashboard-panel.tsx app/dashboard/page.tsx
git commit -m "Show channel-wide reach and conversion on the dashboard"
```

---

### Task 5: ตรวจปลายทางด้วยข้อมูลจริง + อัปเดต CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: ทุก Task ก่อนหน้า
- Produces: ไม่มี (จุดสิ้นสุดของแผน)

- [ ] **Step 1: รัน isolated dev server แล้วอัปไฟล์จริง**

```bash
cp dev.db dev-test.db
NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001
```

เปิด `http://localhost:3001/dashboard` แล้วอัป `data_last28days/Overview.csv` ผ่านฟอร์ม "นำเข้าวิวทั้งช่อง"

**ตัวเลขที่ต้องได้ (คำนวณไว้แล้วในสเปกจากข้อมูลจริง):** ไฟล์นี้ครอบคลุม 13 มิ.ย.–10 ก.ค. รวม **28 วัน · 24,598 วิว · 56 ออเดอร์ · conv 0.228%**

ตรวจว่า:
1. แถบสรุปขึ้น "นำเข้า 28 วัน" (ไม่มี "ข้าม")
2. ตารางแสดงสัปดาห์ของช่วงนั้น
3. รวมวิวทุกสัปดาห์ในตาราง = 24,598 และรวมออเดอร์ = 56
4. อัปไฟล์เดิมซ้ำอีกครั้ง → ยังได้ "นำเข้า 28 วัน" เท่าเดิม ตัวเลขในตารางไม่เปลี่ยน (upsert ไม่สร้างซ้ำ)

- [ ] **Step 2: ตรวจค่าติดลบใน DB**

```bash
npx prisma db execute --stdin <<'SQL'
SELECT statsOn, videoViews, comments FROM ChannelMetric WHERE comments < 0;
SQL
```

Expected: เจออย่างน้อย 1 แถว (20 มิ.ย. comments = -6) — ถ้าไม่เจอแปลว่ามีโค้ดตรงไหนแปลงค่าติดลบทิ้ง

**หมายเหตุ:** คำสั่งนี้ชี้ไปที่ `dev.db` ตามค่า `prisma.config.ts` ถ้าอยากตรวจ `dev-test.db` ให้ตั้ง `DATABASE_URL="file:./dev-test.db"` นำหน้าคำสั่ง

- [ ] **Step 3: ตรวจ dark mode และ console**

บังคับ dark mode ด้วย devtools (เพิ่ม class `dark` ให้ `<html>`) แล้วดูว่าตารางกับแถบสรุปอ่านออกทุกจุด · ไม่มี console error หรือ hydration warning

- [ ] **Step 4: ปิดเซิร์ฟเวอร์และเก็บกวาด**

```bash
netstat -ano | grep ':3001' | grep LISTENING
taskkill //PID <pid> //F
rm -rf .next-dev dev-test.db
git checkout -- tsconfig.json
```

- [ ] **Step 5: อัปเดต `CLAUDE.md`**

ในหัวข้อ **Dashboard รายได้ (แท็บ ④)** เพิ่มบรรทัดต่อจากบรรทัดที่อธิบาย `lib/csv.ts`:

```markdown
- **`lib/channel-metrics.ts` + `lib/channel-reach.ts`** จัดการ `Overview.csv` (วิวรวมทั้งช่องรายวัน) — ไฟล์นี้**ไม่มีเพดาน 15 แถวแบบ Content.csv** จึงเป็นแหล่งวิวชุดเดียวที่ครบทุกคลิป ใช้เป็นตัวหารของ conversion ระดับช่องที่ไม่มี selection bias · `parseOverviewCsv` คืน `{ rows, skipped }` และ **ต้องข้ามแถวที่ Video Views อ่านไม่ออก (ไฟล์ TikTok ใส่ `"undefined"` ในวันที่ยังไม่มีข้อมูล) ห้ามบันทึกเป็น 0** ไม่งั้น conversion เพี้ยน · **คอลัมน์ Comments ติดลบได้** (คอมเมนต์ถูกลบ) ห้ามใส่ `Math.abs`/`Math.max(0,…)` · `buildChannelReach` นับออเดอร์**เฉพาะวันที่มีข้อมูลวิวจริง** เพราะสัปดาห์หัวท้ายของช่วง import มีวิวไม่ครบ 7 วัน ถ้านับหมดจะทำให้ conv% สูงเกินจริง
```

ในหัวข้อ **ข้อจำกัดของไฟล์ที่ export จาก TikTok Studio** เพิ่มบรรทัด:

```markdown
- **`Overview.csv` ให้ย้อนหลัง 28 วันแต่ไม่มีเพดานจำนวนแถว** — ต่างจาก Content.csv ที่ได้แค่ท็อป 15 ตามวิว ดังนั้น**ต้อง export ทุก ≤28 วัน** ไม่งั้นช่วงที่ขาดจะหายถาวร (import ย้อนหลังไม่ได้ ต่างจากไฟล์รายได้ xlsx ที่ upsert ย้อนหลังได้เสมอ) · อีก 4 ไฟล์ในชุดเดียวกัน (`Viewers.csv`/`FollowerHistory.csv`/`FollowerGender.csv`/`FollowerTopTerritories.csv`) ตรวจแล้วไม่มีอันไหนเปลี่ยนการตัดสินใจ **จงใจไม่นำเข้า** (เหตุผลเต็มอยู่ในหัวข้อ "สิ่งที่ตัดออกโดยตั้งใจ" ของ `docs/superpowers/specs/2026-08-02-channel-reach-design.md`)
```

ในหัวข้อ **ค่าคงที่ที่ผูกกับสเกลข้อมูล** — ไม่ต้องเพิ่มอะไร ฟีเจอร์นี้ไม่มี threshold ที่ผูกกับสเกล

- [ ] **Step 6: ตรวจรอบสุดท้ายและ commit**

```bash
npx tsc --noEmit
npm run lint
git status --short          # ต้องไม่มี .next-dev หรือ dev-test.db หลงเหลือ
git diff tsconfig.json      # ต้องว่าง
git add CLAUDE.md
git commit -m "Document the Overview.csv import rules in CLAUDE.md"
```

---

## Self-Review

**1. ความครอบคลุมของ spec**

| ข้อกำหนดใน spec | Task ที่ทำ |
|---|---|
| ตาราง `ChannelMetric` เก็บทุกคอลัมน์ | Task 1 Step 1 |
| `statsOn` เป็น `@unique` เพื่อ upsert | Task 1 Step 1 · ใช้จริง Task 3 Step 2 |
| parser ใช้ `lib/csv.ts` เดิมซ้ำ | Task 1 Step 5 |
| ค่าติดลบต้องเก็บตามจริง | Task 1 เทสต์ #2 · ยืนยันใน DB จริง Task 5 Step 2 |
| แถว `undefined` ต้องข้ามไม่ใช่บันทึก 0 | Task 1 เทสต์ #3 |
| รายงานจำนวนแถวที่ข้าม (`skipped`) | Task 1 (parser) · Task 3 (action) · Task 4 Step 3 (UI) |
| action ลอกโครงจาก `importFollowerActivity` | Task 3 Step 2 |
| `weekStartOfPostedAt` สำหรับ statsOn / `weekStartOfLocal` สำหรับ orderDate | Task 2 Step 3 · เทสต์ #1 |
| กันหารศูนย์ → `convPct: null` | Task 2 เทสต์ #3 |
| สรุป 30 วันนับจากวันที่มีข้อมูลล่าสุด | Task 2 Step 3 · เทสต์ #5 |
| ซ่อนลูกศรเมื่อไม่มีข้อมูลช่วงก่อน | Task 2 เทสต์ #7 · Task 4 Step 1 (`trend === null`) |
| ตารางเรียงใหม่→เก่า แสดงทุกสัปดาห์ | Task 2 เทสต์ #4 · Task 4 Step 1 |
| ข้อความกำกับใต้ตาราง | Task 4 Step 1 |
| ฟอร์มอัปโหลดตัวที่ 4 | Task 4 Step 3 |
| ตรวจด้วยข้อมูลจริง 24,598/56/0.228% | Task 5 Step 1 |
| ไม่ทำกราฟ / ไม่คำนวณวิวคลิปที่ไม่ติด top-15 / ไม่นำเข้า 4 ไฟล์ที่เหลือ | ไม่มี task ใดทำ — ยืนยันแล้วว่าอยู่นอกขอบเขตโดยตั้งใจ |

**2. Placeholder scan:** ไม่มี TBD/TODO · ทุก step ที่ต้องเขียนโค้ดมีโค้ดจริงครบ · ทุกคำสั่งรันได้จริง

**3. ความสอดคล้องของชนิด/ชื่อ:**
- `parseOverviewCsv` คืน `OverviewParseResult` (Task 1) → Task 3 อ่าน `.rows`/`.skipped` ตรงกัน ✓
- `ChannelMetricRecord` มีแค่ `{ statsOn, videoViews }` (Task 2) — `prisma.channelMetric.findMany()` คืนฟิลด์ครบกว่านั้นซึ่ง assign เข้า type แคบกว่าได้ตามปกติของ TypeScript ✓
- `ChannelMetricImportSummary` (Task 3) → Task 4 อ่าน `.total`/`.skipped` ตรงกัน ✓
- `buildChannelReach({ metrics, orders })` (Task 2) → Task 4 เรียกด้วยชื่อพารามิเตอร์เดียวกัน ✓
- `weekStart` เป็น UTC midnight → Task 4 ฟอร์แมตด้วย `timeZone: "UTC"` ตรงกัน ✓
