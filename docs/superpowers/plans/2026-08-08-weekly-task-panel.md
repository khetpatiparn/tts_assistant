# Weekly Task Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เปลี่ยนแผง "ควรทำอะไรต่อ" จากรายการ 18 บรรทัดที่เกณฑ์ตั้งด้วยมือ ให้เป็น "งานรอบนี้" 3 แถวที่ผ่านการทดสอบทางสถิติและมี deadline ชัดเจน

**Architecture:** ย้ายการตัดสินใจจากค่าคงที่ที่ตั้งเอง (`MIN_VIEWS_FOR_CONV`, อัตราส่วน 1.3/0.8) ไปเป็นช่วงความเชื่อมั่นแบบ Wilson ที่คำนวณจากข้อมูลเอง — สัญญาณจะเงียบเองเมื่อ n ไม่พอ แทนที่จะยิงผิดอย่างมั่นใจ · ตรรกะสถิติและตารางเวลาแยกเป็นไฟล์ที่ไม่ import อะไรเลย จึงทดสอบด้วย node ได้โดยตรง

**Tech Stack:** Next.js 16.2.10 (custom build) App Router, React 19, Tailwind v4 CSS-first, shadcn/ui บน `@base-ui/react`

**Spec:** `docs/superpowers/specs/2026-08-08-weekly-task-panel-design.md`

## Global Constraints

- **ห้ามรัน `npm run build` หรือ `npm run dev` บน `.next` โฟลเดอร์หลัก** — ผู้ใช้รัน `start.bat` ที่ port 3000 อยู่ทุกวันและใช้ทำมาหากิน ใช้ `npx tsc --noEmit` + `npm run lint` แทน · ถ้าต้องดู UI จริง: `cp dev.db dev-test.db` แล้ว `NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001`
- **cleanup หลังใช้ dev server ทุกครั้ง:** `netstat -ano | grep ':3001' | grep LISTENING` แล้ว `taskkill //PID <pid> //F` (double-slash บังคับบน git-bash เครื่องนี้) + `rm -f dev-test.db` + `rm -rf .next-dev`
- **`git diff tsconfig.json` ต้องว่างก่อน commit ทุกครั้ง** — dev server auto-patch ได้ ถ้าเปลี่ยนให้ `git checkout -- tsconfig.json`
- **ห้าม `git add -A`** — ระบุไฟล์ที่ commit เสมอ
- **ห้าม emoji** ในโค้ด คอมเมนต์ commit message และ UI
- **UI ทุกข้อความเป็นภาษาไทย**
- **ห้ามใช้ขนาดตัวอักษร arbitrary** (`text-[0.65rem]`) — ใช้ `text-xs`(12px พื้นต่ำสุด)/`sm`/`base`/`lg` เท่านั้น
- **ห้ามใส่ hex สีในไฟล์ `components/*`** — ใช้ semantic token
- **ห้ามใช้ชื่อ alias สีเก่า** (`teal`/`paper`/`ink`/`smoke`/`amber`/`danger`) ในโค้ดใหม่
- **ห้าม `font-mono` กับข้อความไทย** — ระวังเป็นพิเศษ: `toLocaleDateString("th-TH", { month: "short" })` คืนค่าที่มีเดือนไทย (`"3 ส.ค."`) จึงห้ามครอบด้วย `font-mono` แม้บรรทัดต้นฉบับจะดูเหมือนเป็นวันที่ล้วน (บั๊กนี้เคยหลุดรีวิวรายทาสก์มาแล้วในโปรเจกต์ก่อน)
- **ห้าม `tracking-widest` หรือ `uppercase` กับข้อความไทย**
- **ปุ่ม/สิ่งที่กดได้สูงขั้นต่ำ 36px (`h-9`)** — รวมถึงแถวงานที่กดได้ในแผงนี้
- **ห้ามแตะการนำเข้าข้อมูล** (`app/actions.ts`, `lib/affiliate.ts`, `lib/clip-metrics.ts`, `lib/csv.ts`) · **ห้ามแตะ schema** · **ห้ามแตะกราฟรายได้/ตารางราย-คลิป/reconciliation**
- **ห้ามแตะ `buildClipStats`** ใน `lib/recommender.ts` — งานนี้เปลี่ยนเฉพาะการตัดสินใจหลังจากมี stats แล้ว
- branch: `feature/weekly-task-panel` (สร้างแล้ว) — ห้าม merge เข้า master เอง

---

## หมายเหตุการทำให้สเปกชัดขึ้น 1 จุด

สเปกหัวข้อ 5.1 เขียนหัวแผงไว้ว่า `คำนวณจากข้อมูลวิวถึง 3 ส.ค. · รายได้ถึง 2 ส.ค.` — คำว่า "ถึง" ชวนให้เข้าใจว่าเป็นวันที่ครอบคลุมของข้อมูล แต่สิ่งที่ระบบรู้จริงและใช้คำนวณ deadline คือ **วันที่นำเข้า** (`AffiliateOrder.importedAt` / `ClipMetric.importedAt`) ซึ่งตรงกับที่สเปกหัวข้อ 6 ระบุไว้เอง

แผนนี้จึงใช้ถ้อยคำว่า **`ข้อมูลวิวนำเข้า 3 ส.ค. · รายได้นำเข้า 8 ส.ค.`** ซึ่งตรงกับข้อมูลที่มีจริงและสอดคล้องกันทั้งหัวแผงและ deadline

---

## File Structure

| ไฟล์ | หน้าที่ | Task |
|---|---|---|
| `lib/stats.ts` | **สร้างใหม่** — `wilsonLowerBound` / `wilsonUpperBound` ไม่ import อะไรเลย | 1 |
| `lib/import-schedule.ts` | **สร้างใหม่** — `IMPORT_STALE_DAYS` (ย้ายมา) + `nextImportDate` + `daysUntil` ไม่ import อะไรเลย | 1 |
| `lib/dashboard.ts` | re-export `IMPORT_STALE_DAYS` จากที่ใหม่ (ผู้เรียกเดิม 3 ไฟล์ไม่ต้องแก้) | 1 |
| `scripts/check-recommender.mjs` | **สร้างใหม่** — regression test ของสถิติ ตารางเวลา และการตัดสินสัญญาณ | 1, 2 |
| `lib/recommender.ts` | เขียน `detectTasks` ใหม่แทน `detectSignals` · ลบ `checkGuardHealth` และค่าคงที่ที่ตั้งเอง | 2 |
| `components/recommendations.tsx` | เขียนใหม่ทั้งไฟล์ — หัวแผง deadline, ป้ายซ้อน, ช่วงตัวเลข, สถานะว่าง | 3 |
| `app/globals.css` | เพิ่มคู่ตรวจ contrast ของ `--status-success` ที่ใช้เป็นสีข้อความใหม่ | 3 |
| `scripts/check-contrast.mjs` | เพิ่มคู่ตรวจ 1 คู่ | 3 |
| `components/import-log-panel.tsx` | เพิ่มบรรทัด "แนะนำรอบหน้า" · แสดงได้แม้ไม่มีแถว log | 4 |
| `components/dashboard-panel.tsx` | ส่ง `lastOrdersImportedAt`/`lastMetricsImportedAt` ลงไปให้ 2 คอมโพเนนต์ | 4 |
| `app/globals.css` | **ลบบล็อก alias สีเก่าทั้งหมด** (ปิดหนี้จากโปรเจกต์ A) | 4 |

---

### Task 1: ตรรกะสถิติและตารางเวลา (ทดสอบได้ด้วย node)

**Files:**
- Create: `lib/stats.ts`
- Create: `lib/import-schedule.ts`
- Create: `scripts/check-recommender.mjs`
- Modify: `lib/dashboard.ts` (บรรทัด 4)

**Interfaces:**
- Consumes: ไม่มี (task แรก)
- Produces: `wilsonLowerBound(successes: number, trials: number, z?: number): number` · `wilsonUpperBound(successes: number, trials: number, z?: number): number` จาก `@/lib/stats` · `IMPORT_STALE_DAYS: number` · `nextImportDate(lastImportedAt: Date | null): Date | null` · `daysUntil(target: Date, now: Date): number` จาก `@/lib/import-schedule` · คำสั่งตรวจ `node scripts/check-recommender.mjs`

- [ ] **Step 1: สร้าง `lib/stats.ts`**

```ts
/**
 * สถิติพื้นฐานสำหรับตัดสินว่าตัวเลขที่เห็นเชื่อได้แค่ไหน
 *
 * ไฟล์นี้ไม่ import อะไรเลยโดยตั้งใจ จึงคอมไพล์เดี่ยวแล้วทดสอบด้วย node ได้
 * (โปรเจกต์นี้ไม่มี test runner)
 */

/** z ของช่วงความเชื่อมั่น 95% สองทาง */
const Z_95 = 1.959964;

/**
 * ขอบล่างของช่วงความเชื่อมั่นแบบ Wilson สำหรับสัดส่วน successes/trials
 *
 * ใช้ Wilson ไม่ใช่สูตร normal ธรรมดา เพราะ conversion ของช่องนี้อยู่แถว 0.2%
 * (1 ออเดอร์ต่อ ~466 วิว) และจำนวนออเดอร์ต่อคลิปน้อย สูตรธรรมดาจะให้ช่วงที่
 * ผิดจนติดลบได้ในย่านนั้น
 *
 * คืน 0 เมื่อ trials <= 0 — ไม่มีข้อมูลแปลว่าพิสูจน์อะไรไม่ได้ ไม่ใช่แปลว่าดี
 */
export function wilsonLowerBound(
  successes: number,
  trials: number,
  z: number = Z_95
): number {
  if (trials <= 0) return 0;
  const k = Math.max(0, Math.min(successes, trials));
  const p = k / trials;
  const denom = 1 + (z * z) / trials;
  const centre = p + (z * z) / (2 * trials);
  const spread =
    z * Math.sqrt((p * (1 - p)) / trials + (z * z) / (4 * trials * trials));
  return Math.max(0, (centre - spread) / denom);
}

/** ขอบบนของช่วงเดียวกัน — ใช้คู่กับขอบล่างเวลาแสดงช่วงให้ผู้ใช้เห็น */
export function wilsonUpperBound(
  successes: number,
  trials: number,
  z: number = Z_95
): number {
  if (trials <= 0) return 0;
  const k = Math.max(0, Math.min(successes, trials));
  const p = k / trials;
  const denom = 1 + (z * z) / trials;
  const centre = p + (z * z) / (2 * trials);
  const spread =
    z * Math.sqrt((p * (1 - p)) / trials + (z * z) / (4 * trials * trials));
  return Math.min(1, (centre + spread) / denom);
}
```

- [ ] **Step 2: สร้าง `lib/import-schedule.ts`**

```ts
/**
 * รอบนำเข้าข้อมูลจาก TikTok Studio
 *
 * ไฟล์นี้ไม่ import อะไรเลยโดยตั้งใจ จึงคอมไพล์เดี่ยวแล้วทดสอบด้วย node ได้
 * IMPORT_STALE_DAYS ย้ายมาจาก lib/dashboard.ts ซึ่ง re-export ต่อให้ผู้เรียกเดิม
 * (lib/entry-queries.ts, components/import-log-panel.tsx, components/reminder-banner.tsx)
 */

/** รอบนำเข้าไฟล์ — อิงรอบ settle ของ TikTok (~สัปดาห์) ใช้ทั้งแถบเตือนและบรรทัดสถานะ */
export const IMPORT_STALE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * วันที่แนะนำให้นำเข้ารอบถัดไป = วันที่นำเข้าล่าสุด + IMPORT_STALE_DAYS
 * คืน null เมื่อยังไม่เคยนำเข้า (ไม่มีฐานให้นับ)
 *
 * ปัดลงเป็นเที่ยงคืนตามปฏิทินท้องถิ่นก่อนบวก เพราะผลลัพธ์คือ "วันที่" ที่ผู้ใช้อ่าน
 * ไม่ใช่เวลาเป๊ะ — importedAt เป็น timestamp จริงจึงต้องอ่านด้วย local getter
 * ไม่ใช่ UTC (การอัปช่วงเช้าตรู่เวลาไทยจะถูกจัดเป็นคนละวันถ้าใช้ UTC)
 */
export function nextImportDate(lastImportedAt: Date | null): Date | null {
  if (lastImportedAt === null) return null;
  const base = new Date(
    lastImportedAt.getFullYear(),
    lastImportedAt.getMonth(),
    lastImportedAt.getDate()
  );
  base.setTime(base.getTime() + IMPORT_STALE_DAYS * DAY_MS);
  return base;
}

/**
 * จำนวนวันจากวันนี้ถึงวันที่กำหนด — บวก = ยังไม่ถึง, 0 = วันนี้, ลบ = เลยมาแล้ว
 * เทียบที่ระดับวันตามปฏิทินท้องถิ่น ไม่ใช่ชั่วโมง
 */
export function daysUntil(target: Date, now: Date): number {
  const t = new Date(
    target.getFullYear(),
    target.getMonth(),
    target.getDate()
  ).getTime();
  const n = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((t - n) / DAY_MS);
}
```

- [ ] **Step 3: แก้ `lib/dashboard.ts` ให้ re-export**

แทนบรรทัดที่ 3-4 เดิม:
```ts
/** รอบนำเข้าไฟล์รายได้ — อิงรอบ settle ของ TikTok (~สัปดาห์) ใช้ทั้งแถบเตือนและบรรทัดสถานะ */
export const IMPORT_STALE_DAYS = 7;
```
ด้วย:
```ts
// ค่าจริงย้ายไป lib/import-schedule.ts แล้ว (ไฟล์นั้นไม่ import อะไรเลยจึงทดสอบเดี่ยวได้)
// re-export ไว้เพื่อให้ผู้เรียกเดิมไม่ต้องแก้: lib/entry-queries.ts,
// components/import-log-panel.tsx, components/reminder-banner.tsx
export { IMPORT_STALE_DAYS } from "@/lib/import-schedule";
```

- [ ] **Step 4: สร้าง `scripts/check-recommender.mjs` (เฉพาะส่วนสถิติและตารางเวลา)**

```js
/**
 * ตรวจตรรกะของแผง "งานรอบนี้" — ทำหน้าที่แทน test suite ที่โปรเจกต์นี้ไม่มี
 *
 * คอมไพล์ไฟล์ .ts ที่เกี่ยวข้องไปยัง temp dir แล้ว import ผลลัพธ์เข้ามาทดสอบ
 * ใช้ fixture สังเคราะห์ ไม่พึ่ง dev.db เพื่อให้ผลคงที่ไม่เปลี่ยนตามข้อมูลจริง
 *
 * รัน: node scripts/check-recommender.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const out = mkdtempSync(join(tmpdir(), "check-recommender-"));
let failed = 0;

function check(name, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`      ได้ ${JSON.stringify(actual)} ควรได้ ${JSON.stringify(expected)}`);
}

function checkClose(name, actual, expected, tolerance) {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`      ได้ ${actual} ควรได้ ~${expected} (คลาดได้ ${tolerance})`);
}

try {
  execFileSync(
    "npx",
    ["tsc", "lib/stats.ts", "lib/import-schedule.ts", "--outDir", out, "--module", "es2022", "--target", "ES2017", "--moduleResolution", "bundler"],
    { stdio: "inherit", shell: true }
  );

  const stats = await import(pathToFileURL(join(out, "stats.js")).href);
  const schedule = await import(pathToFileURL(join(out, "import-schedule.js")).href);

  console.log("=== wilsonLowerBound / wilsonUpperBound ===");
  check("ไม่มีข้อมูลเลย (trials=0) คืน 0", stats.wilsonLowerBound(0, 0), 0);
  check("trials ติดลบ คืน 0", stats.wilsonLowerBound(3, -5), 0);
  check("สำเร็จ 0 ครั้ง ขอบล่างต้องเป็น 0", stats.wilsonLowerBound(0, 100), 0);
  checkClose("สำเร็จทุกครั้ง (10/10) ขอบล่างสูงแต่ไม่ถึง 1", stats.wilsonLowerBound(10, 10), 0.7225, 0.01);
  check("สำเร็จทุกครั้ง ขอบบนต้องเป็น 1", stats.wilsonUpperBound(10, 10), 1);
  checkClose("50/100 ขอบล่าง", stats.wilsonLowerBound(50, 100), 0.4038, 0.01);
  checkClose("50/100 ขอบบน", stats.wilsonUpperBound(50, 100), 0.5962, 0.01);
  check("ขอบล่างต้องไม่เกินขอบบนเสมอ", stats.wilsonLowerBound(3, 1000) <= stats.wilsonUpperBound(3, 1000), true);
  check("successes เกิน trials ถูกตัดให้เท่า trials", stats.wilsonUpperBound(20, 10), 1);
  // n น้อยต้องได้ช่วงกว้างกว่า n มาก ที่สัดส่วนเท่ากัน — นี่คือคุณสมบัติที่ทั้งฟีเจอร์พึ่งพา
  const narrowSpan = stats.wilsonUpperBound(100, 10000) - stats.wilsonLowerBound(100, 10000);
  const wideSpan = stats.wilsonUpperBound(3, 300) - stats.wilsonLowerBound(3, 300);
  check("n น้อยให้ช่วงกว้างกว่า n มาก ที่สัดส่วนเดียวกัน", wideSpan > narrowSpan, true);

  console.log("\n=== IMPORT_STALE_DAYS / nextImportDate / daysUntil ===");
  check("IMPORT_STALE_DAYS = 7", schedule.IMPORT_STALE_DAYS, 7);
  check("ยังไม่เคยนำเข้า คืน null", schedule.nextImportDate(null), null);

  const key = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  check("นำเข้า 3 ส.ค. 16:21 -> รอบหน้า 10 ส.ค.", key(schedule.nextImportDate(new Date(2026, 7, 3, 16, 21))), "2026-08-10");
  check("ข้ามเดือน: 28 ส.ค. -> 4 ก.ย.", key(schedule.nextImportDate(new Date(2026, 7, 28, 9, 0))), "2026-09-04");
  check("ข้ามปี: 28 ธ.ค. -> 4 ม.ค. ปีถัดไป", key(schedule.nextImportDate(new Date(2026, 11, 28, 9, 0))), "2027-01-04");
  // เวลาไทยตี 1 ครึ่ง — ถ้าเผลอใช้ UTC getter จะได้วันก่อนหน้า
  check("นำเข้าตี 1 ครึ่งของวันที่ 3 ยังนับเป็นวันที่ 3", key(schedule.nextImportDate(new Date(2026, 7, 3, 1, 30))), "2026-08-10");

  const NOW = new Date(2026, 7, 8, 14, 0);
  check("อีก 2 วัน", schedule.daysUntil(new Date(2026, 7, 10), NOW), 2);
  check("วันนี้ = 0", schedule.daysUntil(new Date(2026, 7, 8), NOW), 0);
  check("เลยมาแล้ว 3 วัน = -3", schedule.daysUntil(new Date(2026, 7, 5), NOW), -3);
  check("เทียบที่ระดับวัน ไม่ใช่ชั่วโมง", schedule.daysUntil(new Date(2026, 7, 9, 1, 0), NOW), 1);
  check("ตอนตี 1 ครึ่งของวันนี้ ยังได้ 0 สำหรับวันนี้", schedule.daysUntil(new Date(2026, 7, 8), new Date(2026, 7, 8, 1, 30)), 0);

  console.log(failed === 0 ? "\nผ่านทุกเคส" : `\nตก ${failed} เคส`);
} finally {
  rmSync(out, { recursive: true, force: true });
}

process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 5: รันเทสต์ให้ผ่าน**

Run: `node scripts/check-recommender.mjs`
Expected: PASS ทุกบรรทัด ปิดท้าย `ผ่านทุกเคส` exit code 0
ถ้าค่าที่คาดไว้ใน `checkClose` ไม่ตรง **ห้ามแก้ค่าที่คาดไว้ให้ตรงกับผลลัพธ์** — ให้ตรวจสูตรก่อน (ค่าเหล่านี้คำนวณจากสูตร Wilson มาตรฐาน)

- [ ] **Step 6: ตรวจ type และ lint**

Run: `npx tsc --noEmit` แล้ว `npm run lint`
Expected: สะอาดทั้งคู่ — โดยเฉพาะ `lib/entry-queries.ts`, `components/import-log-panel.tsx`, `components/reminder-banner.tsx` ที่ import `IMPORT_STALE_DAYS` จาก `@/lib/dashboard` ต้องยังทำงานผ่าน re-export

- [ ] **Step 7: Commit**

```bash
git add lib/stats.ts lib/import-schedule.ts lib/dashboard.ts scripts/check-recommender.mjs
git commit -m "Add Wilson interval and import-schedule helpers with tests"
```

---

### Task 2: เขียนเกณฑ์สัญญาณใหม่

**Files:**
- Modify: `lib/recommender.ts`
- Modify: `scripts/check-recommender.mjs` (เพิ่มส่วนทดสอบ `detectTasks`)

**Interfaces:**
- Consumes: `wilsonLowerBound`, `wilsonUpperBound` จาก `@/lib/stats` (Task 1)
- Produces: `type ClipSignalKind = "growing" | "proven"` · `type ClipTask = { entryId: string; productName: string; kinds: ClipSignalKind[]; views: number; viewDelta: number | null; orders: number; convRatioRange: { low: number; high: number } | null }` · `detectTasks(stats: ClipStat[]): ClipTask[]` · **`detectSignals`, `checkGuardHealth`, `GuardHealth`, `ClipSignal` ถูกลบ** — Task 3 ต้องเลิกเรียกทั้งหมด · `buildClipStats`, `ClipStat`, `ClipMetricRecord` ไม่เปลี่ยน

- [ ] **Step 1: เพิ่มเคสทดสอบ `detectTasks` ใน `scripts/check-recommender.mjs`**

แทรกก่อนบรรทัด `console.log(failed === 0 ? ...)` ท้ายบล็อก `try`:

```js
  // recommender.ts import จาก @/lib/dashboard ซึ่งลากไปถึง xlsx จึงคอมไพล์เดี่ยวไม่ได้
  // แก้ด้วยการคอมไพล์ทั้งสายแล้ว map @/ ตอน import ผ่าน loader ของ node ไม่ได้ใน .mjs
  // จึงทดสอบ detectTasks ผ่านการ re-implement เกณฑ์ไม่ได้เช่นกัน (จะกลายเป็นทดสอบตัวเอง)
  // -> ทดสอบด้วยการคอมไพล์ recommender.ts พร้อม dependency แล้วแก้ specifier ในไฟล์ผลลัพธ์
  console.log("\n=== detectTasks ===");
  execFileSync(
    "npx",
    ["tsc", "lib/recommender.ts", "--outDir", out, "--module", "es2022", "--target", "ES2017", "--moduleResolution", "bundler", "--skipLibCheck"],
    { stdio: "inherit", shell: true }
  );
  // ไฟล์ผลลัพธ์อ้าง "@/lib/..." ซึ่ง node ไม่รู้จัก — เขียนทับให้ชี้ไฟล์ข้างกันแทน
  const recPath = join(out, "recommender.js");
  const recSrc = readFileSync(recPath, "utf8").replace(/["']@\/lib\/([\w-]+)["']/g, '"./$1.js"');
  writeFileSync(recPath, recSrc);

  const rec = await import(pathToFileURL(recPath).href);

  /** สร้าง ClipStat แบบย่อ — ค่าที่ไม่ระบุใช้ค่าที่ไม่ทำให้ติดเกณฑ์ */
  const stat = (o) => ({
    entryId: o.entryId,
    productName: o.productName ?? o.entryId,
    views: o.views ?? 0,
    viewDelta: o.viewDelta ?? null,
    orders: o.orders ?? 0,
    badOrders: o.badOrders ?? 0,
    ordersLast7Days: o.ordersLast7Days ?? 0,
  });

  check("ไม่มีคลิปเลย คืนลิสต์ว่าง", rec.detectTasks([]).length, 0);
  check("มีคลิปแต่วิว 0 ทั้งหมด คืนลิสต์ว่าง", rec.detectTasks([stat({ entryId: "a", views: 0 })]).length, 0);

  // ฐาน: 3 คลิปธรรมดา วิว 1000 ออเดอร์ 2 -> channelConv ~0.2% medianViews 1000
  const base = [
    stat({ entryId: "b1", views: 1000, orders: 2 }),
    stat({ entryId: "b2", views: 1000, orders: 2 }),
    stat({ entryId: "b3", views: 1000, orders: 2 }),
  ];

  const growing = rec.detectTasks([...base, stat({ entryId: "g", views: 5000, viewDelta: 3000, orders: 4 })]);
  const gTask = growing.find((t) => t.entryId === "g");
  check("วิวโตเกินค่ากลาง ติดป้าย growing", gTask?.kinds.includes("growing"), true);

  const noDelta = rec.detectTasks([...base, stat({ entryId: "nd", views: 5000, viewDelta: null, orders: 4 })]);
  check("ไม่มี viewDelta (นำเข้ารอบเดียว) ไม่ติด growing", noDelta.find((t) => t.entryId === "nd")?.kinds.includes("growing") ?? false, false);

  // conv สูงมากแต่ n น้อย -> ช่วงกว้าง -> ต้องไม่ติด proven
  const tiny = rec.detectTasks([...base, stat({ entryId: "tiny", views: 300, orders: 3 })]);
  check("conv สูงแต่ n น้อย ต้องเงียบ (ไม่ติด proven)", tiny.find((t) => t.entryId === "tiny")?.kinds.includes("proven") ?? false, false);

  // conv สูงและ n เยอะ -> ต้องติด proven
  const proven = rec.detectTasks([...base, stat({ entryId: "pv", views: 20000, orders: 120 })]);
  const pTask = proven.find((t) => t.entryId === "pv");
  check("conv สูงและ n เยอะ ติดป้าย proven", pTask?.kinds.includes("proven"), true);
  check("proven มีช่วง convRatioRange", pTask?.convRatioRange !== null && pTask?.convRatioRange !== undefined, true);
  check("ขอบล่างของช่วงต้องเกิน 1 เท่า", (pTask?.convRatioRange?.low ?? 0) > 1, true);

  // ติดทั้งสองป้ายต้องมาก่อนตัวที่ติดป้ายเดียว
  const both = rec.detectTasks([
    ...base,
    stat({ entryId: "both", views: 20000, viewDelta: 5000, orders: 120 }),
    stat({ entryId: "onlyGrow", views: 9000, viewDelta: 8000, orders: 18 }),
  ]);
  check("คลิปที่ติดสองป้ายมาเป็นอันดับแรก", both[0]?.entryId, "both");
  check("คลิปที่ติดสองป้ายมี kinds ครบสอง", both[0]?.kinds.length, 2);

  // badRatio เกินเกณฑ์ต้องถูกตัดออกก่อนพิจารณาอะไรทั้งสิ้น
  const bad = rec.detectTasks([...base, stat({ entryId: "bad", views: 20000, viewDelta: 9000, orders: 120, badOrders: 60 })]);
  check("badRatio >= 0.3 ถูกตัดออก", bad.find((t) => t.entryId === "bad") === undefined, true);
```

และเพิ่ม import ที่หัวไฟล์:
```js
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
```
(แทนบรรทัด `import { mkdtempSync, rmSync } from "node:fs";` เดิม)

- [ ] **Step 2: รันเทสต์เพื่อยืนยันว่า fail**

Run: `node scripts/check-recommender.mjs`
Expected: FAIL — `rec.detectTasks is not a function` เพราะยังไม่ได้เขียน

- [ ] **Step 3: เขียน `lib/recommender.ts` ส่วนที่เปลี่ยน**

แทน import ที่หัวไฟล์:
```ts
import { INELIGIBLE_STATUS, type AffiliateOrderRecord } from "@/lib/dashboard";
```
เป็น:
```ts
import { INELIGIBLE_STATUS, type AffiliateOrderRecord } from "@/lib/dashboard";
import { wilsonLowerBound, wilsonUpperBound } from "@/lib/stats";
```

แทนบล็อก type เดิม (`ClipSignalKind` และ `ClipSignal`) ด้วย:
```ts
/** สัญญาณเชิงบวกสองแบบ — ตัด "ดูเยอะไม่ซื้อ"/"หยุดแล้ว" ออกแล้วเพราะบอกสิ่งที่รู้อยู่แล้วซ้ำๆ */
export type ClipSignalKind = "growing" | "proven";

export type ClipTask = {
  entryId: string;
  productName: string;
  /** ติดได้มากกว่าหนึ่งป้าย — คลิปที่ทั้งโตและขายดีคือของที่ควรทำซ้ำที่สุด */
  kinds: ClipSignalKind[];
  views: number;
  viewDelta: number | null;
  orders: number;
  /** ช่วงความเชื่อมั่นของ conv เทียบค่าเฉลี่ยช่อง (หน่วยเป็น "เท่า") null เมื่อช่องยังไม่มีออเดอร์เลย */
  convRatioRange: { low: number; high: number } | null;
};
```

ลบค่าคงที่เหล่านี้ทั้งหมดพร้อมคอมเมนต์ของมัน: `MIN_VIEWS_FOR_CONV`, `MIN_ORDERS_FOR_CONV`, `GUARD_STALE_FACTOR` · **เก็บ** `MAX_BAD_RATIO` และ `DAY_MS` ไว้

แทนฟังก์ชัน `detectSignals` ทั้งฟังก์ชันด้วย:
```ts
/**
 * ตัดสินว่าคลิปไหนควรเป็น "งานรอบนี้"
 *
 * ต่างจากเวอร์ชันเดิมตรงที่ไม่มีอัตราส่วนที่ตั้งด้วยมือ (1.3 / 0.8) และไม่มีเกณฑ์
 * จำนวนวิว/ออเดอร์ขั้นต่ำที่แช่ไว้ — ใช้ช่วงความเชื่อมั่นแทน สัญญาณจึงเงียบเอง
 * เมื่อข้อมูลยังน้อย แทนที่จะยิงผิดอย่างมั่นใจ
 *
 * วัดจากข้อมูลจริงแล้ว: เกณฑ์เดิมให้สัญญาณ 18 รายการซึ่ง 2 ใน 3 ของที่เหลือหลัง
 * ตัด "หยุดแล้ว"/"ดูเยอะไม่ซื้อ" ยังแยกจากคลิปธรรมดาไม่ได้ทางสถิติ
 */
export function detectTasks(stats: ClipStat[]): ClipTask[] {
  const usable = stats.filter((s) => s.views > 0);
  if (usable.length === 0) return [];

  const totalViews = usable.reduce((a, s) => a + s.views, 0);
  const totalOrders = usable.reduce((a, s) => a + s.orders, 0);
  const channelConv = totalViews > 0 ? totalOrders / totalViews : 0;
  const medianViews = median(usable.map((s) => s.views));

  const tasks: ClipTask[] = [];
  for (const s of usable) {
    const badRatio = s.orders > 0 ? s.badOrders / s.orders : 0;
    if (badRatio >= MAX_BAD_RATIO) continue;

    const kinds: ClipSignalKind[] = [];

    // "กำลังโต" อ้างเรื่องวิวล้วน ไม่แตะ conversion เลย — วิวเป็นเลขหลักพันขึ้นไป
    // การบอกว่าคลิปกำลังโตจึงไม่ต้องพึ่งการทดสอบทางสถิติ
    // (เกณฑ์เดิมมีท่อน conv >= channelConv * 0.8 พ่วงมาด้วย ซึ่งวัดแล้วพบว่าไม่กรองอะไร
    //  เพราะ 0.8 เท่าคือต่ำกว่าค่าเฉลี่ย จึงถูกตัดทิ้ง)
    if (s.viewDelta !== null && s.viewDelta >= medianViews) kinds.push("growing");

    // "ขายดีจริง" ต้องพิสูจน์ว่า conv สูงกว่าค่าเฉลี่ยช่องจริง ไม่ใช่แค่ดูสูง
    // ขอบล่างของช่วงเชื่อมั่นต้องเกินค่าเฉลี่ยช่อง — n น้อยจะได้ช่วงกว้างจนไม่ผ่านเอง
    // ไม่บังคับว่าวิวต้องน้อยกว่าค่ากลางแบบเกณฑ์เดิม เพราะเงื่อนไขนั้นตัดคลิปที่
    // conv พิสูจน์ได้แน่นที่สุดของช่องทิ้งไปโดยไม่ตั้งใจ
    const low = wilsonLowerBound(s.orders, s.views);
    if (channelConv > 0 && low > channelConv) kinds.push("proven");

    if (kinds.length === 0) continue;

    const high = wilsonUpperBound(s.orders, s.views);
    tasks.push({
      entryId: s.entryId,
      productName: s.productName,
      kinds,
      views: s.views,
      viewDelta: s.viewDelta,
      orders: s.orders,
      convRatioRange:
        channelConv > 0 ? { low: low / channelConv, high: high / channelConv } : null,
    });
  }

  // ติดสองป้ายอยู่บนสุด แล้วเรียงตามวิวที่เพิ่ม แล้วตามความแรงของ conv
  tasks.sort((a, b) => {
    if (a.kinds.length !== b.kinds.length) return b.kinds.length - a.kinds.length;
    const byDelta = (b.viewDelta ?? 0) - (a.viewDelta ?? 0);
    if (byDelta !== 0) return byDelta;
    return (b.convRatioRange?.low ?? 0) - (a.convRatioRange?.low ?? 0);
  });

  return tasks;
}
```

ลบทั้งบล็อกท้ายไฟล์: คอมเมนต์เรื่อง `GUARD_STALE_FACTOR`, `type GuardHealth`, และฟังก์ชัน `checkGuardHealth`

- [ ] **Step 4: รันเทสต์ให้ผ่าน**

Run: `node scripts/check-recommender.mjs`
Expected: PASS ทุกเคส `ผ่านทุกเคส`

- [ ] **Step 5: ตรวจว่าไม่เหลือชื่อเก่าในไฟล์นี้**

```bash
grep -n "detectSignals\|checkGuardHealth\|GuardHealth\|MIN_VIEWS_FOR_CONV\|MIN_ORDERS_FOR_CONV\|GUARD_STALE_FACTOR\|reach-no-convert\|fading\|hidden-gem\|emerging" lib/recommender.ts
```
Expected: ไม่มีผลลัพธ์

- [ ] **Step 6: ตรวจ type และ lint**

Run: `npx tsc --noEmit` แล้ว `npm run lint`
Expected: **จะ FAIL ที่ `components/recommendations.tsx`** เพราะยังเรียก `detectSignals`/`checkGuardHealth` ที่ถูกลบ — นี่คือสิ่งที่คาดไว้ Task 3 จะแก้ · ต้องไม่มี error ในไฟล์อื่นนอกจากไฟล์นั้น

- [ ] **Step 7: Commit**

```bash
git add lib/recommender.ts scripts/check-recommender.mjs
git commit -m "Replace hand-tuned signal thresholds with confidence-interval gating"
```

---

### Task 3: เขียนแผง "งานรอบนี้" ใหม่

**Files:**
- Modify: `components/recommendations.tsx` (เขียนใหม่ทั้งไฟล์)
- Modify: `scripts/check-contrast.mjs` (เพิ่มคู่ตรวจ 1 คู่)

**Interfaces:**
- Consumes: `detectTasks`, `ClipTask`, `ClipSignalKind`, `buildClipStats` จาก `@/lib/recommender` (Task 2) · `nextImportDate`, `daysUntil` จาก `@/lib/import-schedule` (Task 1) · `repeatStatus` จาก `@/lib/angle` (มีอยู่แล้ว)
- Produces: `export function Recommendations(props: { entries: {...}[]; metrics: ClipMetricRecord[]; orders: AffiliateOrderRecord[]; now: Date; lastOrdersImportedAt: Date | null; lastMetricsImportedAt: Date | null; onOpenEntry: (entryId: string) => void }): JSX.Element` — **เพิ่ม 2 prop ใหม่** (`lastOrdersImportedAt`, `lastMetricsImportedAt`) Task 4 ต้องส่งมาจาก `dashboard-panel.tsx`

- [ ] **Step 1: เพิ่มคู่ตรวจ contrast ของสีที่จะใช้เป็นข้อความใหม่**

ใน `scripts/check-contrast.mjs` เพิ่มบรรทัดนี้เข้า array `PAIRS` (ต่อจากบรรทัด `["--status-warning", "--surface", 4.5],`):
```js
  ["--status-success", "--surface", 4.5],
```
เหตุผล: แผงใหม่ใช้ `text-status-success` เป็นสีข้อความของป้าย "ขายดีจริง" ซึ่งเดิมถูกตรวจแค่ระดับจุดสี (3:1) เท่านั้น

- [ ] **Step 2: รันตรวจ contrast**

Run: `node scripts/check-contrast.mjs`
Expected: PASS ทุกคู่รวมคู่ใหม่ ถ้าคู่ใหม่ไม่ผ่าน **ห้ามลดเกณฑ์** ให้เปลี่ยนไปใช้ `text-foreground` กับป้ายนั้นแทนแล้วรายงานเป็น concern

- [ ] **Step 3: เขียน `components/recommendations.tsx` ใหม่ทั้งไฟล์**

```tsx
"use client";

import { useMemo } from "react";
import { ClipboardList } from "lucide-react";

import type { AffiliateOrderRecord } from "@/lib/dashboard";
import { repeatStatus } from "@/lib/angle";
import { daysUntil, nextImportDate } from "@/lib/import-schedule";
import {
  buildClipStats,
  detectTasks,
  type ClipMetricRecord,
  type ClipSignalKind,
  type ClipTask,
} from "@/lib/recommender";

const KIND_LABEL: Record<ClipSignalKind, string> = {
  growing: "กำลังโต",
  proven: "ขายดีจริง",
};

/** ทั้งสองเป็นสัญญาณเชิงบวก ต่างกันที่ "โตเร็ว" กับ "ขายได้จริง" จึงแยกสีให้จำง่าย */
const KIND_CLASS: Record<ClipSignalKind, string> = {
  growing: "border-primary/50 bg-primary/10 text-primary",
  proven: "border-status-success/50 bg-status-success/10 text-status-success",
};

/** "3 ส.ค." — importedAt เป็น timestamp จริง อ่านด้วย local getter */
function shortThaiDate(d: Date): string {
  return d.toLocaleDateString("th-TH", { day: "numeric", month: "short" });
}

/**
 * บรรทัดบอกว่าทำตามงานนี้ไปแล้วหรือยัง — ตรวจจากสายเลือดการทำซ้ำ ไม่ใช่ให้ติ๊กเอง
 * (ปัญหาต้นทางของผู้ใช้คือลืม/ไม่ได้ทำ ของที่ต้องจำไปติ๊กคือของที่ลืมได้อีกอย่าง)
 */
function repeatLine(
  entries: {
    id: string;
    duplicatedFromId: string | null;
    videoUrl: string;
    postedAt: Date | null;
  }[],
  entryId: string
): string | null {
  const status = repeatStatus(entries, entryId);
  if (status.repeats === 0) return null;
  const bits = [`ทำซ้ำไปแล้ว ${status.repeats} คลิป`];
  if (status.lastPostedAt) {
    // postedAt เก็บเป็น UTC midnight จึงต้องอ่านด้วย timeZone UTC ไม่ใช่ local
    bits.push(
      "ลงล่าสุด " +
        status.lastPostedAt.toLocaleDateString("th-TH", {
          day: "numeric",
          month: "short",
          timeZone: "UTC",
        })
    );
  }
  if (status.hasUnposted) bits.push("มีที่ยังไม่ได้ลง");
  return bits.join(" · ");
}

/** บรรทัดตัวเลขใต้ชื่อสินค้า — ประกอบเฉพาะส่วนที่มีข้อมูลจริง */
function detailLine(task: ClipTask): string {
  const bits: string[] = [];
  if (task.viewDelta !== null) {
    bits.push(
      `วิวเพิ่ม ${task.viewDelta.toLocaleString("th-TH")} ในรอบล่าสุด (รวม ${task.views.toLocaleString("th-TH")})`
    );
  } else {
    bits.push(`${task.views.toLocaleString("th-TH")} วิว`);
  }
  bits.push(`${task.orders.toLocaleString("th-TH")} ออเดอร์`);
  if (task.convRatioRange !== null) {
    // แสดงเป็นช่วงไม่ใช่ตัวเลขเดียว — ตัวเลขเดียวสร้างความมั่นใจเกินกว่าที่ข้อมูลรองรับ
    bits.push(
      `conv ${task.convRatioRange.low.toFixed(2)}-${task.convRatioRange.high.toFixed(2)} เท่าของช่อง`
    );
  }
  return bits.join(" · ");
}

export function Recommendations({
  entries,
  metrics,
  orders,
  now,
  lastOrdersImportedAt,
  lastMetricsImportedAt,
  onOpenEntry,
}: {
  entries: {
    id: string;
    productName: string;
    duplicatedFromId: string | null;
    videoUrl: string;
    postedAt: Date | null;
  }[];
  metrics: ClipMetricRecord[];
  orders: AffiliateOrderRecord[];
  now: Date;
  lastOrdersImportedAt: Date | null;
  lastMetricsImportedAt: Date | null;
  onOpenEntry: (entryId: string) => void;
}) {
  const stats = useMemo(
    () => buildClipStats({ entries, metrics, orders, now }),
    [entries, metrics, orders, now]
  );
  const tasks = useMemo(() => detectTasks(stats), [stats]);

  const withMetrics = new Set(
    metrics.filter((m) => m.matchedEntryId !== null).map((m) => m.matchedEntryId)
  );
  const missing = entries.filter((e) => !withMetrics.has(e.id)).length;
  const hasDelta =
    metrics.length > 0 &&
    new Set(metrics.map((m) => m.capturedOn.getTime())).size >= 2;

  // deadline ยึดชนิดข้อมูลที่เก่าที่สุด เพราะผลลัพธ์สดได้เท่ากับข้อมูลที่ล้าหลังที่สุดเท่านั้น
  const importedDates = [lastMetricsImportedAt, lastOrdersImportedAt].filter(
    (d): d is Date => d !== null
  );
  const oldestImport =
    importedDates.length === 0
      ? null
      : new Date(Math.min(...importedDates.map((d) => d.getTime())));
  const due = nextImportDate(oldestImport);
  const daysLeft = due === null ? null : daysUntil(due, now);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="flex items-center gap-1.5 font-medium text-foreground">
          <ClipboardList className="size-4 text-primary" />
          งานรอบนี้
        </span>
        <span className="text-xs text-muted-foreground">
          {tasks.length > 0 ? `${tasks.length} งาน` : "ไม่มีอะไรต้องรีบ"}
        </span>
      </div>

      <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
        <span>
          {lastMetricsImportedAt !== null
            ? `ข้อมูลวิวนำเข้า ${shortThaiDate(lastMetricsImportedAt)}`
            : "ยังไม่เคยนำเข้าข้อมูลวิว"}
          {" · "}
          {lastOrdersImportedAt !== null
            ? `รายได้นำเข้า ${shortThaiDate(lastOrdersImportedAt)}`
            : "ยังไม่เคยนำเข้าข้อมูลรายได้"}
        </span>
        {due !== null && daysLeft !== null && (
          <span>
            {daysLeft >= 0
              ? `ทำก่อนนำเข้ารอบหน้า — ${shortThaiDate(due)} (${daysLeft === 0 ? "วันนี้" : `อีก ${daysLeft} วัน`})`
              : `เลยรอบนำเข้ามาแล้ว ${Math.abs(daysLeft)} วัน — นำเข้าข้อมูลใหม่เพื่อคำนวณงานรอบถัดไป`}
          </span>
        )}
      </div>

      {tasks.length === 0 ? (
        <div className="flex flex-col gap-1 border-t border-border pt-3">
          <p className="text-sm text-muted-foreground">
            รอบนี้ไม่มีคลิปที่เข้าเกณฑ์ — ลงคลิปใหม่ต่อได้ตามปกติ
          </p>
          <p className="text-xs text-muted-foreground">
            (ตรวจ {stats.filter((s) => s.views > 0).length} คลิปที่มีข้อมูลครบ)
          </p>
        </div>
      ) : (
        tasks.map((task) => {
          const line = repeatLine(entries, task.entryId);
          return (
            <button
              type="button"
              key={task.entryId}
              onClick={() => onOpenEntry(task.entryId)}
              className="flex min-h-9 flex-col gap-1 rounded-md border-t border-border px-1 py-2 text-left transition-colors first:border-t-0 hover:bg-muted"
            >
              <div className="flex flex-wrap items-center gap-2">
                {task.kinds.map((kind) => (
                  <span
                    key={kind}
                    className={`rounded border px-1.5 py-0.5 text-xs ${KIND_CLASS[kind]}`}
                  >
                    {KIND_LABEL[kind]}
                  </span>
                ))}
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                  {task.productName}
                </span>
              </div>
              <p className="text-sm text-foreground/80">ทำ angle ใหม่ซ้ำ</p>
              <p className="text-xs text-muted-foreground">{detailLine(task)}</p>
              {line !== null && <p className="text-xs text-primary">{line}</p>}
            </button>
          );
        })
      )}

      <div className="flex flex-col gap-0.5 border-t border-border pt-2 text-xs text-muted-foreground">
        {missing > 0 && (
          <span>
            ยังไม่มีข้อมูลวิว {missing} คลิป — นำเข้าไฟล์ Content รอบใหม่เพื่อให้ครบ
          </span>
        )}
        {!hasDelta && (
          <span>สัญญาณด้านความเคลื่อนไหวจะใช้ได้หลังนำเข้าข้อมูลวิวรอบที่ 2</span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: ตรวจว่าไม่เหลือของต้องห้ามในไฟล์นี้**

```bash
grep -n "text-\[\|-teal\|-paper\|-ink\|-smoke\|-amber\|-danger\b\|font-mono\|tracking-widest\|uppercase\|#[0-9a-fA-F]\{3,8\}\|detectSignals\|checkGuardHealth" components/recommendations.tsx
```
Expected: ไม่มีผลลัพธ์เลย

- [ ] **Step 5: ตรวจ type และ lint**

Run: `npx tsc --noEmit` แล้ว `npm run lint`
Expected: **จะ FAIL ที่ `components/dashboard-panel.tsx`** เพราะยังไม่ส่ง prop ใหม่ 2 ตัว — นี่คือสิ่งที่คาดไว้ Task 4 จะแก้ · ต้องไม่มี error ในไฟล์อื่น

- [ ] **Step 6: Commit**

```bash
git add components/recommendations.tsx scripts/check-contrast.mjs
git commit -m "Rewrite recommendations panel as dated weekly task list"
```

---

### Task 4: ต่อสาย, บรรทัดรอบนำเข้าถัดไป, ปิดหนี้ alias

**Files:**
- Modify: `components/dashboard-panel.tsx`
- Modify: `components/import-log-panel.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: `Recommendations` ที่ต้องการ prop `lastOrdersImportedAt`/`lastMetricsImportedAt` (Task 3) · `nextImportDate`, `daysUntil`, `IMPORT_STALE_DAYS` (Task 1)
- Produces: `ImportLogPanel` รับ prop เพิ่ม 2 ตัว — `lastOrdersImportedAt: Date | null`, `lastMetricsImportedAt: Date | null`

- [ ] **Step 1: แก้ `components/dashboard-panel.tsx` ให้ส่ง prop ที่รับมาอยู่แล้วต่อไป**

ไฟล์นี้ประกาศ `lastOrdersImportedAt` และ `lastMetricsImportedAt` ไว้ใน type ของ props แต่**ไม่ได้ destructure ออกมาใช้** — เพิ่มเข้าไปใน destructure (ต่อจาก `reminderActive,`):
```tsx
  lastOrdersImportedAt,
  lastMetricsImportedAt,
```

แทนบล็อก `<Recommendations ... />` เดิมด้วย:
```tsx
      <Recommendations
        entries={entries}
        metrics={clipMetrics}
        orders={orders}
        now={now}
        lastOrdersImportedAt={lastOrdersImportedAt}
        lastMetricsImportedAt={lastMetricsImportedAt}
        onOpenEntry={onOpenEntry}
      />
```

แทนบล็อก `<ImportLogPanel ... />` เดิมด้วย:
```tsx
        <ImportLogPanel
          logs={importLogs}
          reminder={reminder}
          now={now}
          lastOrdersImportedAt={lastOrdersImportedAt}
          lastMetricsImportedAt={lastMetricsImportedAt}
        />
```

- [ ] **Step 2: เขียน `components/import-log-panel.tsx` ใหม่ทั้งไฟล์**

```tsx
"use client";

import { useMemo } from "react";

import { IMPORT_STALE_DAYS, type ReminderState } from "@/lib/dashboard";
import { daysUntil, nextImportDate } from "@/lib/import-schedule";
import {
  EXPECTED_CLIP_FILES,
  groupLatestRound,
  type ImportLogRecord,
  type RoundSummary,
} from "@/lib/import-log";

const KIND_LABEL: Record<string, string> = {
  orders: "รายได้",
  clips: "วิวคลิป",
};

/** เรียงตามความสำคัญของไฟล์ ไม่ใช่ตามตัวอักษร — รายได้สำคัญสุด */
const KIND_ORDER = ["orders", "clips"];

/** "3 ส.ค. 13:45" — uploadedAt เป็น timestamp จริง อ่านด้วย local */
function stamp(d: Date): string {
  return (
    d.toLocaleDateString("th-TH", { day: "numeric", month: "short" }) +
    " " +
    d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })
  );
}

/** วันเดียวไม่มีเวลา — ใช้กับหัวกลุ่มที่มีหลายไฟล์ และบรรทัดรอบถัดไป */
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
  now,
  lastOrdersImportedAt,
  lastMetricsImportedAt,
}: {
  logs: ImportLogRecord[];
  reminder: ReminderState;
  now: Date;
  lastOrdersImportedAt: Date | null;
  lastMetricsImportedAt: Date | null;
}) {
  const rounds = useMemo(() => groupLatestRound(logs), [logs]);

  function importedAtOf(kind: string): Date | null {
    if (kind === "orders") return lastOrdersImportedAt;
    if (kind === "clips") return lastMetricsImportedAt;
    return null;
  }

  // แสดงชนิดที่ "มีแถว log" หรือ "มีข้อมูลนำเข้าแล้ว" อย่างใดอย่างหนึ่ง
  //
  // สองอย่างนี้ไม่เท่ากัน: ImportLog เพิ่งถูกเพิ่มทีหลัง รอบนำเข้ารายได้ที่เกิดก่อนหน้านั้น
  // จึงไม่มีแถว log ทั้งที่ข้อมูลมีอยู่จริง ถ้ายึดแถว log อย่างเดียวบรรทัดรายได้จะหายไปทั้งบรรทัด
  const visible = KIND_ORDER.map((kind) => ({
    kind,
    round: rounds.find((r) => r.kind === kind) ?? null,
    importedAt: importedAtOf(kind),
  })).filter((v) => v.round !== null || v.importedAt !== null);

  if (visible.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs text-muted-foreground">อัปล่าสุด</p>
      {visible.map(({ kind, round, importedAt }) => {
        // "N จาก M ไฟล์" มีความหมายเฉพาะ kind "clips" เท่านั้น (ต้องอัป 3 ช่วงวันต่อรอบ)
        // ชนิดอื่นที่มีหลายไฟล์ในวันเดียวกันเป็นเรื่องปกติ ไม่มี "จำนวนที่ควรจะเป็น" ให้เทียบ
        const hasMultipleFiles = round !== null && round.files.length > 1;
        const isMultiExpectedKind = kind === "clips" && hasMultipleFiles;
        const stale = staleDaysOf(kind, reminder);
        const overdue = stale !== null && stale > IMPORT_STALE_DAYS;
        const due = nextImportDate(importedAt);
        const daysLeft = due === null ? null : daysUntil(due, now);

        return (
          <div key={kind} className="flex flex-col gap-0.5">
            <p className="text-xs">
              <span className="text-muted-foreground">{KIND_LABEL[kind] ?? kind}</span>{" "}
              <span className="text-foreground">
                {round === null
                  ? importedAt !== null
                    ? stamp(importedAt)
                    : "-"
                  : isMultiExpectedKind
                    ? `${dayOnly(round.files[0].uploadedAt)} · ${round.files.length} จาก ${EXPECTED_CLIP_FILES} ไฟล์`
                    : hasMultipleFiles
                      ? `${dayOnly(round.files[0].uploadedAt)} · อัป ${round.files.length} ครั้ง`
                      : `${stamp(round.files[0].uploadedAt)} · ${round.files[0].summary}`}
              </span>
              {overdue && (
                <span className="text-status-warning">
                  {" "}
                  — เกินกำหนดมา {stale - IMPORT_STALE_DAYS} วัน
                </span>
              )}
            </p>

            {/* เลยกำหนดแล้วใช้ข้อความเตือนด้านบนพอ ไม่ต้องบอกวันที่แนะนำซ้อนอีก */}
            {!overdue && due !== null && daysLeft !== null && (
              <p className="pl-4 text-xs text-muted-foreground">
                แนะนำรอบหน้า {dayOnly(due)}{" "}
                {daysLeft === 0 ? "(วันนี้)" : `(อีก ${daysLeft} วัน)`}
              </p>
            )}

            {hasMultipleFiles &&
              round !== null &&
              round.files.map((f) => (
                <p
                  key={f.uploadedAt.getTime()}
                  className="pl-4 text-xs text-muted-foreground"
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

**หมายเหตุ:** `RoundSummary` ถูก import เพื่อความชัดของชนิดในตัวแปร `visible` — ถ้า `npm run lint` แจ้งว่า import ไม่ถูกใช้ ให้ลบ import นั้นออก อย่าใส่ `eslint-disable`

- [ ] **Step 3: ตรวจ type และ lint**

Run: `npx tsc --noEmit` แล้ว `npm run lint`
Expected: **สะอาดทั้งโปรเจกต์แล้ว** — error จาก Task 2 และ 3 ต้องหายหมด

- [ ] **Step 4: ยืนยันว่าชื่อเก่าหายไปทั้ง repo**

```bash
grep -rn "detectSignals\|checkGuardHealth\|GuardHealth\|MIN_VIEWS_FOR_CONV\|MIN_ORDERS_FOR_CONV\|GUARD_STALE_FACTOR\|reach-no-convert" --include=*.ts --include=*.tsx app lib components
```
Expected: ไม่มีผลลัพธ์

- [ ] **Step 5: ยืนยันว่าไม่มีไฟล์ไหนใช้ alias สีเก่าแล้ว**

```bash
grep -rn "\-teal\b\|\-paper\b\|\-ink\b\|\-ink-2\b\|\-smoke\b\|\-amber\b" --include=*.tsx components app
```
Expected: ไม่มีผลลัพธ์เลย

```bash
grep -rn "\-danger\b" --include=*.tsx components app
```
Expected: เหลือเฉพาะ `components/ui/badge.tsx` ที่เป็นคำว่า `bg-status-danger` (คนละเรื่องกับ alias เก่า เป็น token ปัจจุบัน) — **ถ้ามีไฟล์อื่นโผล่มา ให้หยุดและรายงาน อย่าลบบล็อก alias ใน step ถัดไป**

- [ ] **Step 6: ลบบล็อก alias สีเก่าออกจาก `app/globals.css`**

ลบ 2 บล็อกนี้ทั้งหมด:

1. ใน `@theme inline` — บล็อกที่มีคอมเมนต์ `/* alias ชั่วคราวของชื่อพาเลตต์เดิม — ดูคอมเมนต์ท้าย :root */` พร้อมบรรทัด `--color-ink`, `--color-ink-2`, `--color-paper`, `--color-teal`, `--color-amber`, `--color-smoke`, `--color-danger`, `--color-success`, `--color-success-foreground`
2. ใน `:root` — บล็อกที่มีคอมเมนต์ `/* ── alias ชั่วคราวของชื่อพาเลตต์เดิม ── ...` พร้อมบรรทัด `--ink`, `--ink-2`, `--paper`, `--teal`, `--amber`, `--smoke`, `--danger`, `--success`, `--success-foreground`

- [ ] **Step 7: ตรวจว่าลบแล้วไม่พัง**

Run: `npx tsc --noEmit` · `npm run lint` · `node scripts/check-contrast.mjs` · `node scripts/check-recommender.mjs` · `node scripts/check-date-filter-label.mjs`
Expected: สะอาดทั้งหมด

```bash
grep -n "\-\-teal\|\-\-paper\|\-\-ink\|\-\-smoke\|\-\-amber\|\-\-color-teal\|\-\-color-paper" app/globals.css
```
Expected: ไม่มีผลลัพธ์

- [ ] **Step 8: ตรวจกับข้อมูลจริงว่าเกณฑ์ใหม่ให้ผลตามที่สเปกคาดไว้**

รันสคริปต์ชั่วคราวใน scratch dir (ห้าม commit ไฟล์นี้) โดยคอมไพล์ `lib/recommender.ts` แล้วรันกับ `dev.db` แบบอ่านอย่างเดียว ตรวจว่า:

| ต้องได้ |
|---|
| "กำลังโต" ยิง 2 คลิป: **ชั้นวางของ 5 ชั้น** และ **รถเข็นตู้เก็บเครื่องสำอาง 3 ชั้น** |
| "ขายดีจริง" ยิง 2 คลิป: **ชั้นวางของ 5 ชั้น** และ **โต๊ะรีดผ้ายืนรีด** |
| **กระปุกกรองน้ำมันสแตนเลส ต้องไม่โผล่เลย** (3 ออเดอร์ พิสูจน์ไม่ได้) |
| รวมทั้งหมด 3 แถว (ชั้นวางของติด 2 ป้าย) |

ถ้าผลไม่ตรง **ห้ามแก้ตัวเลขที่คาดไว้** ให้ตรวจสูตรก่อน แล้วรายงานความต่างพร้อมเหตุผล

- [ ] **Step 9: ตรวจด้วย dev server แยกพอร์ต**

```bash
cp dev.db dev-test.db
NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001
```

ตรวจที่ `http://localhost:3001/dashboard` **ทั้งโหมดมืดและโหมดสว่าง**:
- แผงชื่อ "งานรอบนี้" แสดง 3 แถว (ไม่ใช่ 18)
- ชั้นวางของมี 2 ป้าย และอยู่บนสุด
- หัวแผงแสดงวันที่นำเข้าทั้งสองชนิด และบรรทัด deadline
- กดแถวแล้วเปิดหน้า entry นั้นได้
- แผง "อัปล่าสุด" แสดง **ทั้ง "รายได้" และ "วิวคลิป"** (เดิมแสดงแต่ "วิวคลิป" เพราะไม่มีแถว log ของ orders)
- แต่ละชนิดมีบรรทัด "แนะนำรอบหน้า ..." หรือข้อความ "เกินกำหนดมา N วัน" อย่างใดอย่างหนึ่ง ไม่ใช่ทั้งคู่
- ไม่มีคำเตือน `checkGuardHealth` เดิมหลงเหลือ
- ไม่มี console error หรือ hydration warning

cleanup ตาม Global Constraints

- [ ] **Step 10: Commit**

```bash
git diff --stat tsconfig.json   # ต้องว่าง ถ้าไม่ว่างให้ git checkout -- tsconfig.json
git add components/dashboard-panel.tsx components/import-log-panel.tsx app/globals.css
git commit -m "Wire task panel dates, add next-import line, drop legacy color aliases"
```

- [ ] **Step 11: build เต็ม — ต้องขออนุญาตผู้ใช้ก่อน**

**ห้ามรันเอง** ผู้ใช้รัน `start.bat` ที่ port 3000 อยู่ ให้รายงานว่าพร้อม build แล้วรอคำอนุญาต เมื่อได้รับแล้ว:

```bash
netstat -ano | grep ':3000' | grep LISTENING   # ต้องไม่มีผลลัพธ์
npm run build
```
Expected: build สำเร็จ ไม่มี type error

---

## Self-Review

ตรวจแผนกับสเปกแล้ว:

| สเปกหัวข้อ | ครอบคลุมโดย |
|---|---|
| 3 การตัดสินใจ 5 ข้อ | Task 2 (ตัด 2 สัญญาณ), Task 3 (กรอบเวลา/หัวแผง), ไม่ใช้ Gemini (ไม่มี task ไหนแตะ), Task 4 (รอบถัดไป), Task 1-2 (ความน่าเชื่อถือ) |
| 4.3 ชุดสัญญาณใหม่ 2 แบบ | Task 2 Step 3 (`detectTasks`) |
| 4.4 ค่าคงที่ที่ถูกลบ | Task 2 Step 3 + ยืนยันด้วย grep Step 5 และ Task 4 Step 4 |
| 4.5 ผลที่คาดไว้กับข้อมูลปัจจุบัน | Task 4 Step 8 (ตรวจกับ `dev.db` จริง พร้อมตารางค่าที่ต้องได้) |
| 5.1 หัวแผง + deadline | Task 3 Step 3 (`oldestImport` → `nextImportDate` → `daysUntil`) |
| 5.2 แถวงาน ป้ายซ้อน ช่วงตัวเลข | Task 3 Step 3 (`task.kinds.map`, `detailLine`) |
| 5.3 สถานะว่าง | Task 3 Step 3 |
| 5.4 บรรทัดสถานะ + ลบ checkGuardHealth | Task 3 Step 3 (เก็บ 2 บรรทัด ตัดคำเตือน) |
| 6 รอบนำเข้าถัดไป + กรณีไม่มีแถว log | Task 4 Step 2 (`visible` รวมชนิดที่มีข้อมูลแม้ไม่มี log) |
| 7 ไฟล์ที่เกี่ยวข้อง | ครบทุกไฟล์ในตาราง File Structure |
| 8 การตรวจสอบ 7 ข้อ | Task 1 Step 5, Task 2 Step 4, Task 3 Step 2/4, Task 4 Step 3-9, Step 10 (tsconfig), Step 11 (build) |
| 9 งานถัดไป (โปรเจกต์ D) | ไม่อยู่ในแผนนี้โดยตั้งใจ |

**สิ่งที่เปลี่ยนจากสเปกและต้องให้ผู้ใช้รับทราบ:**

1. **ถ้อยคำหัวแผงเปลี่ยนจาก "ข้อมูลวิวถึง" เป็น "ข้อมูลวิวนำเข้า"** — เหตุผลอยู่ในหมายเหตุต้นแผน (ระบบรู้วันที่นำเข้า ไม่ได้รู้วันที่ครอบคลุมของข้อมูล และ deadline คำนวณจากวันที่นำเข้าอยู่แล้ว)
2. **`ImportLogPanel` รับ prop เพิ่ม 3 ตัว** (`now`, `lastOrdersImportedAt`, `lastMetricsImportedAt`) — สเปกไม่ได้ระบุ signature ไว้ แต่จำเป็นเพื่อให้แสดงบรรทัดรอบถัดไปได้แม้ไม่มีแถว log ตามที่สเปกหัวข้อ 6 กำหนด
3. **เพิ่มคู่ตรวจ contrast 1 คู่** (`--status-success` บน `--surface`) เพราะแผงใหม่ใช้สีนี้เป็นสีข้อความ ซึ่งเดิมถูกตรวจแค่ระดับจุดสี (3:1) — เป็นช่องว่างประเภทเดียวกับที่ final review ของโปรเจกต์ก่อนเคยจับได้
