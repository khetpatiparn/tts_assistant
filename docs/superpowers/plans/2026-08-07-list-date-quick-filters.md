# List Date Quick Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เพิ่มปุ่มด่วน "วันนี้/7 วัน/30 วัน" + ตัวสลับฐานวันที่ (ลงคลิป/สร้าง) และแก้บั๊กปุ่ม "ล้างตัวกรองทั้งหมด" ที่หายไปเมื่อกรองแล้วยังเจอผลลัพธ์บ้าง ในหน้ารายการ (`/`)

**Architecture:** ทุกตัวกรองในหน้านี้เป็น URL query params อ่านที่ server component (`app/page.tsx`) ไม่มี client state — งานนี้เพิ่มฟังก์ชันกรองคู่แฝดใหม่ (`filterByCreatedDateRange`) ต่อยอดจาก `filterByPostedDateRange` ที่มีอยู่แล้ว แล้วเพิ่มปุ่ม/ลิงก์ในหน้ารายการที่คำนวณ href ไว้ล่วงหน้า ไม่ต้องมี client component ใหม่

**Tech Stack:** TypeScript, Next.js (App Router server component), ไม่มี test runner — verify ด้วยสคริปต์ node ที่คอมไพล์ผ่าน `tsc` เอง

## Global Constraints

- `createdAt` เป็น timestamp จริง (ไม่ใช่ UTC midnight แบบ `postedAt`) — ต้องใช้ local getter (`getFullYear`/`getMonth`/`getDate`) เสมอ **ห้ามใช้ UTC getter** กับฟิลด์นี้
- `postedAt` เก็บเป็น UTC midnight — ต้องใช้ UTC getter (`getUTCFullYear`/`getUTCMonth`/`getUTCDate`) เสมอ **ห้ามใช้ local getter**
- ลิงก์เก่าที่ไม่มี `by` param ต้อง fallback เป็น `"posted"` เสมอ (backward compatibility — ห้าม breaking change)
- ห้ามรัน `npm run build`/`npm run dev` ชนพอร์ต 3000 ของผู้ใช้ — ใช้ `npx tsc --noEmit` + isolated dev server (`cp dev.db dev-test.db` + `NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001`) แล้ว cleanup
- เช็ก `git diff tsconfig.json` ก่อน commit ทุกครั้ง (dev server มัก auto-patch ไฟล์นี้) ถ้าเปลี่ยนให้ `git checkout -- tsconfig.json`
- ห้าม `git add -A` · UI ภาษาไทย · design token เดิม (ห้ามเพิ่มสี/ฟอนต์ใหม่) · ห้าม emoji ใน UI

---

## วิธีรันเทสต์ในโปรเจกต์นี้

โปรเจกต์**ไม่มี test runner** และ**ไม่มี `tsx`** วิธีทดสอบ pure function คือคอมไพล์ด้วย `tsc` ลง scratch dir แล้วรันด้วย `node` โดยต้องแก้ปัญหา path alias `@/` เองเพราะ `tsc` ไม่เขียน path ใน `require()` ให้

**สคริปต์ตั้งต้น** — สร้างไฟล์นี้ก่อนเทสต์ครั้งแรก (`<scratch>` = scratch dir ของ session ห้ามสร้างในโฟลเดอร์ repo):

สร้าง `<scratch>/tsconfig-list-filter.json`:

```json
{
  "extends": "C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt/tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "outDir": "./out",
    "rootDir": "C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt",
    "module": "commonjs",
    "target": "es2020",
    "moduleResolution": "node"
  },
  "files": [
    "C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt/lib/entry-date-filter.ts"
  ]
}
```

และ `<scratch>/alias.js`:

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

คอมไพล์: `cd <scratch> && npx tsc -p tsconfig-list-filter.json`
รัน: `TEST_OUT=<scratch>/out node -r <scratch>/alias.js <scratch>/test-xxx.js` (รันจากโฟลเดอร์ repo เพื่อให้ `node_modules` resolve ได้)

---

### Task 1: `filterByCreatedDateRange` + `parseDateBasisParam` + wiring ใน `app/page.tsx`

**Files:**
- Modify: `lib/entry-date-filter.ts` (เพิ่ม export ใหม่ 2 ตัว ไม่แก้ของเดิม)
- Modify: `app/page.tsx:1-25` (import ใหม่ + เลือกฟังก์ชันกรองตาม `by` + ส่ง prop ใหม่)
- Test: `<scratch>/test-entry-date-filter.js`

**Interfaces:**
- Consumes: ไม่มี (pure function ใหม่ ไม่พึ่งโค้ดอื่น)
- Produces:
  - `type DateFilterBasis = "posted" | "created"`
  - `function parseDateBasisParam(raw: string | string[] | undefined): DateFilterBasis`
  - `function filterByCreatedDateRange<T extends { createdAt: Date }>(rows: T[], from: string | null, to: string | null): T[]`
  - Task 2 จะ import `DateFilterBasis` จาก `@/lib/entry-date-filter` และรับ `by: DateFilterBasis` เป็น prop ของ `EntryList`

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

สร้าง `<scratch>/test-entry-date-filter.js`:

```js
const assert = require("assert");
const { filterByCreatedDateRange, parseDateBasisParam } = require("@/lib/entry-date-filter");

// เคส 1: parseDateBasisParam — ค่า invalid/ไม่มีค่า fallback เป็น "posted"
{
  assert.strictEqual(parseDateBasisParam(undefined), "posted");
  assert.strictEqual(parseDateBasisParam("garbage"), "posted");
  assert.strictEqual(parseDateBasisParam(""), "posted");
  assert.strictEqual(parseDateBasisParam(["posted", "created"]), "posted");
  console.log("PASS: parseDateBasisParam ค่า invalid -> posted");
}

// เคส 2: parseDateBasisParam — "created" ต้องคืน "created"
{
  assert.strictEqual(parseDateBasisParam("created"), "created");
  assert.strictEqual(parseDateBasisParam(["created"]), "created");
  console.log("PASS: parseDateBasisParam created");
}

// เคส 3: filterByCreatedDateRange — from/to เป็น null ทั้งคู่ -> คืนทุกแถว
{
  const rows = [{ id: "a", createdAt: new Date("2026-01-01T10:00:00") }];
  const r = filterByCreatedDateRange(rows, null, null);
  assert.strictEqual(r.length, 1);
  console.log("PASS: from/to null คืนทุกแถว");
}

// เคส 4: filterByCreatedDateRange — กรองตามช่วงถูกต้อง (entry ในช่วง/นอกช่วง)
{
  const rows = [
    { id: "in-range", createdAt: new Date("2026-01-15T12:00:00") },
    { id: "before", createdAt: new Date("2026-01-01T12:00:00") },
    { id: "after", createdAt: new Date("2026-02-01T12:00:00") },
  ];
  const r = filterByCreatedDateRange(rows, "2026-01-10", "2026-01-20");
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].id, "in-range");
  console.log("PASS: กรองตามช่วง from-to ถูกต้อง");
}

// เคส 5: filterByCreatedDateRange — ต้องใช้ local getter ไม่ใช่ UTC
// entry สร้างเวลา 03:00 น. ของวันที่ 2026-01-15 ตามเวลาท้องถิ่น (ไม่ใช่ UTC) ต้องนับเป็นวันที่ 15
// (ทดสอบด้วย `new Date(y, m-1, d, h, ...)` ซึ่งตีความเป็นเวลาท้องถิ่นของเครื่องที่รันเทสต์เสมอ
//  ตรงกับที่ createdAt ถูกอ่าน/เขียนด้วย local getter ทั้งฝั่ง filter และฝั่งเทสต์นี้)
{
  const earlyMorning = new Date(2026, 0, 15, 3, 0, 0); // 2026-01-15 03:00 เวลาท้องถิ่น
  const rows = [{ id: "early", createdAt: earlyMorning }];
  const r = filterByCreatedDateRange(rows, "2026-01-15", "2026-01-15");
  assert.strictEqual(r.length, 1, "entry เวลาตี 3 ต้องอยู่ในวันที่ 15 ตาม local ไม่ใช่ UTC");
  console.log("PASS: ใช้ local getter ไม่ใช่ UTC");
}

// เคส 6: filterByCreatedDateRange — from อย่างเดียว (to เป็น null)
{
  const rows = [
    { id: "a", createdAt: new Date(2026, 0, 5, 10, 0, 0) },
    { id: "b", createdAt: new Date(2026, 0, 20, 10, 0, 0) },
  ];
  const r = filterByCreatedDateRange(rows, "2026-01-10", null);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].id, "b");
  console.log("PASS: from อย่างเดียว");
}

console.log("ALL PASS");
```

- [ ] **Step 2: คอมไพล์และรันเทสต์เพื่อยืนยันว่าพัง**

```bash
cd <scratch>
npx tsc -p tsconfig-list-filter.json
```

Expected: FAIL (`filterByCreatedDateRange` และ `parseDateBasisParam` ยังไม่มีใน `lib/entry-date-filter.ts`)

- [ ] **Step 3: เพิ่มโค้ดใหม่ใน `lib/entry-date-filter.ts`**

ต่อท้ายไฟล์เดิม (ไม่แก้ `parseDateParam`/`filterByPostedDateRange` ที่มีอยู่):

```ts
export type DateFilterBasis = "posted" | "created";

/** ค่า invalid หรือไม่มีค่า → fallback "posted" (พฤติกรรมเดิมของลิงก์เก่าที่ไม่มี by param) */
export function parseDateBasisParam(raw: string | string[] | undefined): DateFilterBasis {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "created" ? "created" : "posted";
}

function startOfLocalDay(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

function endOfLocalDay(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
}

/**
 * กรองแถวที่ createdAt (timestamp จริง ไม่ใช่ UTC midnight แบบ postedAt) อยู่ในช่วง [from, to]
 * ต้องใช้ local getter อ่าน from/to ไม่ใช่ UTC — บั๊กคลาสเดียวกับ toDateInputValue/
 * toLocalDateInputValue ที่ CLAUDE.md เตือนไว้ ถ้าสลับกันจะเพี้ยนไป 1 วันสำหรับ entry
 * ที่สร้างก่อน 7 โมงเช้าเวลาไทย
 *
 * createdAt ไม่เคยเป็น null (ต่างจาก postedAt) จึงไม่ต้องมีเงื่อนไขซ่อนแถวแบบ
 * filterByPostedDateRange
 */
export function filterByCreatedDateRange<T extends { createdAt: Date }>(
  rows: T[],
  from: string | null,
  to: string | null
): T[] {
  if (from === null && to === null) return rows;

  const fromMs = from !== null ? startOfLocalDay(from) : -Infinity;
  const toMs = to !== null ? endOfLocalDay(to) : Infinity;

  return rows.filter((r) => {
    const ms = new Date(r.createdAt).getTime();
    return ms >= fromMs && ms <= toMs;
  });
}
```

- [ ] **Step 4: คอมไพล์และรันเทสต์เพื่อยืนยันว่าผ่าน**

```bash
cd <scratch>
npx tsc -p tsconfig-list-filter.json
TEST_OUT=<scratch>/out node -r <scratch>/alias.js <scratch>/test-entry-date-filter.js
```

รันจากโฟลเดอร์ repo (`cd` กลับไปที่ `C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt` ก่อนรันคำสั่ง `node`) เพื่อให้ `node_modules` resolve ได้

Expected: `ALL PASS`

- [ ] **Step 5: แก้ `app/page.tsx` ให้เลือกฟังก์ชันกรองตาม `by`**

แก้ import (บรรทัด 8 เดิม):

```ts
import {
  filterByPostedDateRange,
  filterByCreatedDateRange,
  parseDateParam,
  parseDateBasisParam,
} from "@/lib/entry-date-filter";
```

แก้ในตัวฟังก์ชัน (หลังบรรทัด `const to = parseDateParam(sp.to);` เดิม):

```ts
const by = parseDateBasisParam(sp.by);
```

แก้บรรทัด `const dateFiltered = filterByPostedDateRange(rows, from, to);` เดิม เป็น:

```ts
const dateFiltered =
  by === "created"
    ? filterByCreatedDateRange(rows, from, to)
    : filterByPostedDateRange(rows, from, to);
```

แก้ในบล็อก `<EntryList ...>` เพิ่ม prop `by={by}` ต่อจาก `to={to}` เดิม

- [ ] **Step 6: `tsc --noEmit` ทั้งโปรเจกต์**

```bash
npx tsc --noEmit
```

Expected: มี error เดียวที่ `components/entry-list.tsx` เพราะ `EntryList` ยังไม่รับ prop `by` — เป็นเรื่องปกติ Task 2 จะแก้ไฟล์นี้ต่อ ตรวจแค่ว่า**ไม่มี error ในไฟล์อื่น**

- [ ] **Step 7: Commit**

```bash
git add lib/entry-date-filter.ts app/page.tsx
git commit -m "Add filterByCreatedDateRange and by-param wiring for list page

Lets the date range filter switch between postedAt (clip-posted date,
UTC midnight) and createdAt (real local timestamp) without touching
the existing filterByPostedDateRange path — old links without ?by=
still default to posted."
```

---

### Task 2: ปุ่มด่วน + ตัวสลับฐานวันที่ + ปุ่มล้างตัวกรองที่คงอยู่ใน `components/entry-list.tsx`

**Files:**
- Modify: `components/entry-list.tsx` (ทั้งไฟล์ — `buildHref`, props type, JSX 3 จุด)

**Interfaces:**
- Consumes: `DateFilterBasis` type จาก `@/lib/entry-date-filter` (Task 1)
- Produces: ไม่มี (leaf component — หน้าสุดท้ายของ feature นี้)

- [ ] **Step 1: แก้ import เพิ่ม `DateFilterBasis`**

แก้บรรทัด `import type { EntryRow, EntryStatus } from "@/lib/entry-rows";` เดิม เพิ่มบรรทัดใหม่ต่อ:

```ts
import type { DateFilterBasis } from "@/lib/entry-date-filter";
```

- [ ] **Step 2: แก้ `buildHref` ให้รับ/ส่ง `by`**

แทนที่ฟังก์ชัน `buildHref` เดิมทั้งก้อน (บรรทัด 55-70 เดิม) ด้วย:

```ts
function buildHref(params: {
  query: string;
  status: EntryStatus | "all";
  from: string | null;
  to: string | null;
  by: DateFilterBasis;
  page: number;
}) {
  const sp = new URLSearchParams();
  if (params.query.trim() !== "") sp.set("q", params.query);
  if (params.status !== "all") sp.set("status", params.status);
  if (params.from !== null) sp.set("from", params.from);
  if (params.to !== null) sp.set("to", params.to);
  if (params.by === "created") sp.set("by", params.by);
  if (params.page > 1) sp.set("page", String(params.page));
  const qs = sp.toString();
  return qs === "" ? "/" : `/?${qs}`;
}
```

- [ ] **Step 3: เพิ่มฟังก์ชันคำนวณช่วงวันที่ด่วน — วางต่อจาก `buildHref`**

```ts
/** "YYYY-MM-DD" ของวันนี้ตามฐานที่เลือก — posted ใช้ UTC getter (คีย์เดียวกับที่ postedAt เก็บ),
 *  created ใช้ local getter (คีย์เดียวกับ createdAt) เหตุผลเดียวกับ filterByCreatedDateRange */
function todayKey(by: DateFilterBasis): string {
  const now = new Date();
  const y = by === "created" ? now.getFullYear() : now.getUTCFullYear();
  const m = by === "created" ? now.getMonth() : now.getUTCMonth();
  const d = by === "created" ? now.getDate() : now.getUTCDate();
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function daysAgoKey(by: DateFilterBasis, days: number): string {
  const now = new Date();
  const base =
    by === "created"
      ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  base.setTime(base.getTime() - days * 86400000);
  const y = by === "created" ? base.getFullYear() : base.getUTCFullYear();
  const m = by === "created" ? base.getMonth() : base.getUTCMonth();
  const d = by === "created" ? base.getDate() : base.getUTCDate();
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const QUICK_RANGES: { label: string; days: number }[] = [
  { label: "วันนี้", days: 0 },
  { label: "7 วัน", days: 6 },
  { label: "30 วัน", days: 29 },
];
```

- [ ] **Step 4: แก้ props type ของ `EntryList` ให้รับ `by`**

แก้ signature ของ `export function EntryList({ ... }: { ... })` เดิม — เพิ่ม `by,` ใน destructure params (ต่อจาก `to,`) และเพิ่ม `by: DateFilterBasis;` ใน type (ต่อจาก `to: string | null;`)

- [ ] **Step 5: แก้ปุ่มสถานะเดิมให้ส่ง `by` เข้า `buildHref`**

ในบล็อกปุ่มสถานะเดิม (`{FILTERS.map((f) => ( <Link href={buildHref({ query, status: f.value, from, to, page: 1 })} ...` แก้เป็น `buildHref({ query, status: f.value, from, to, by, page: 1 })`

- [ ] **Step 6: แทนที่บล็อกปุ่มสถานะทั้งก้อน (บรรทัด 123-139 เดิม) ด้วยเวอร์ชันที่มีปุ่มด่วน + ตัวสลับต่อท้าย**

```tsx
      <div className="flex flex-wrap items-center gap-1">
        {FILTERS.map((f) => (
          <Link
            key={f.value}
            href={buildHref({ query, status: f.value, from, to, by, page: 1 })}
            aria-current={status === f.value ? "page" : undefined}
            className={cn(
              "rounded-md px-2.5 py-1.5 font-mono text-[0.65rem] tracking-widest uppercase transition-colors",
              status === f.value
                ? "bg-teal text-primary-foreground"
                : "text-muted-foreground hover:bg-card hover:text-foreground"
            )}
          >
            {f.label}
          </Link>
        ))}

        <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />

        {QUICK_RANGES.map((r) => {
          const rangeTo = todayKey(by);
          const rangeFrom = daysAgoKey(by, r.days);
          const isActive = from === rangeFrom && to === rangeTo;
          return (
            <Link
              key={r.label}
              href={buildHref({ query, status, from: rangeFrom, to: rangeTo, by, page: 1 })}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "rounded-md px-2.5 py-1.5 font-mono text-[0.65rem] tracking-widest uppercase transition-colors",
                isActive
                  ? "bg-teal text-primary-foreground"
                  : "text-muted-foreground hover:bg-card hover:text-foreground"
              )}
            >
              {r.label}
            </Link>
          );
        })}

        <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />

        <span className="font-mono text-[0.65rem] text-muted-foreground">ตามวัน:</span>
        <Link
          href={buildHref({ query, status, from, to, by: "posted", page: 1 })}
          aria-current={by === "posted" ? "page" : undefined}
          className={cn(
            "rounded-md px-2 py-1 font-mono text-[0.65rem] uppercase transition-colors",
            by === "posted"
              ? "bg-teal/20 text-teal"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          ลงคลิป
        </Link>
        <Link
          href={buildHref({ query, status, from, to, by: "created", page: 1 })}
          aria-current={by === "created" ? "page" : undefined}
          className={cn(
            "rounded-md px-2 py-1 font-mono text-[0.65rem] uppercase transition-colors",
            by === "created"
              ? "bg-teal/20 text-teal"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          สร้าง
        </Link>
      </div>
```

- [ ] **Step 7: แก้บรรทัดสรุปผลให้มีลิงก์ล้างตัวกรอง (แทนที่บรรทัด 141-143 เดิม)**

```tsx
      <p className="flex items-center gap-2 font-mono text-[0.65rem] tracking-widest text-muted-foreground uppercase">
        {isFiltering ? `พบ ${matchCount} จาก ${total}` : `ทั้งหมด ${total} รายการ`}
        {isFiltering && (
          <Link href="/" className="text-teal normal-case hover:underline">
            ล้างตัวกรองทั้งหมด
          </Link>
        )}
      </p>
```

- [ ] **Step 8: ตัดปุ่ม "ล้างตัวกรองทั้งหมด" ที่ซ้ำซ้อนออกจากกล่อง empty-state**

ในบล็อก `rows.length === 0 ? ( ... )` เดิม (บรรทัด 145-164) มี `total === 0 ? (...) : (...)` อยู่ 2 จุด — จุดแรกอยู่ใน `<p>` ข้อความ (**อย่าแตะ**) จุดที่สองคือปุ่มด้านล่างข้อความนั้น (ternary ที่ render `<Button>` สองแบบ — เพิ่มสินค้าแรก vs ล้างตัวกรองทั้งหมด) แทนที่**เฉพาะ ternary จุดที่สอง**นี้ด้วย:

```tsx
          {total === 0 && (
            <Button render={<Link href="/entry/new" />} nativeButton={false} size="sm">
              <Plus className="size-4" />
              เพิ่มสินค้าแรก
            </Button>
          )}
```

(ลบปุ่ม `<Button render={<Link href="/" />} ... > ล้างตัวกรองทั้งหมด </Button>` ของ else-branch เดิมทิ้ง เพราะบรรทัดสรุปผลใน Step 7 ครอบคลุมกรณีนี้อยู่แล้วเสมอเมื่อ `isFiltering`)

- [ ] **Step 9: `tsc --noEmit` + `lint` ทั้งโปรเจกต์**

```bash
npx tsc --noEmit
npm run lint
```

Expected: ผ่านสะอาด ไม่มี error/warning ใหม่

- [ ] **Step 10: verify ด้วย isolated dev server**

```bash
cp dev.db dev-test.db
NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001
```

เปิด `http://localhost:3001/` แล้วตรวจ:
- ปุ่ม "วันนี้/7 วัน/30 วัน" ต่อท้ายปุ่มสถานะ กดแล้วรายการกรองตรงช่วง ปุ่มที่ active ไฮไลต์ถูก
- ตัวสลับ "ตามวัน: ลงคลิป/สร้าง" สลับแล้วผลลัพธ์เปลี่ยนตามฐานที่เลือก โดย `from`/`to` เดิม (ถ้ามี) ไม่หาย
- กรองด้วยสถานะหรือคำค้นจนเจอผลลัพธ์บางส่วน (ไม่ใช่ 0) → ลิงก์ "ล้างตัวกรองทั้งหมด" ยังโผล่อยู่ที่บรรทัดสรุปผล (แก้บั๊กเดิมที่รายงานไว้)
- กรองจนไม่เจอผลลัพธ์เลย → มีทางล้างตัวกรองได้ผ่านบรรทัดสรุปผลด้านบน (ไม่ใช่ปุ่มในกล่อง empty-state เดิมที่ถูกตัดออก)
- เปิด URL เก่าที่ไม่มี `by` param (เช่น `/?status=posted`) → ยังทำงานปกติเหมือนก่อนแก้ (default `by=posted`)
- ไม่มี console/hydration error

หยุด server แล้วเก็บกวาด:

```bash
git diff --stat tsconfig.json   # ถ้ามีการเปลี่ยน ให้ git checkout -- tsconfig.json
rm -f dev-test.db
rm -rf .next-dev
```

- [ ] **Step 11: Commit**

```bash
git add components/entry-list.tsx
git commit -m "Add quick date filters and fix persistent clear-filters link

Today/7-day/30-day quick range buttons switch between postedAt and
createdAt via a small toggle. The clear-filters link now lives on the
result-count line, which renders whenever isFiltering is true — before
it only showed up inside the zero-results empty state, so filtering
down to a partial match left no way to clear without a manual refresh."
```

---

## Final Step: Merge

หลัง Task 2 ผ่านครบ ใช้ superpowers:finishing-a-development-branch เพื่อรีวิวรวมทั้ง branch แล้ว merge เข้า `master`
