# List Page UX Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เพิ่มปุ่มย้อนกลับจากหน้า entry ไปหน้ารายการ, เพิ่มยอดขาย/ยอดวิวในแต่ละแถวของหน้ารายการ, และเพิ่มตัวกรองช่วงวันที่

**Architecture:** ตรรกะกรองวันที่และตรรกะรวมยอดขาย/วิวต่อ entry เป็น pure function แยกไฟล์ (ทดสอบด้วย node ได้ ไม่แตะ Prisma) ส่วนการคิวรีจริงอยู่ใน `lib/entry-queries.ts` ไฟล์เดียวเหมือนเดิม `app/page.tsx` เป็นจุดประกอบร่างเดียว (ดึงข้อมูล → กรองวันที่ → ค้นหา/กรองสถานะ → แบ่งหน้า → แนบยอดขาย/วิวเฉพาะ 30 แถวที่แสดง)

**Tech Stack:** Next.js 16.2.10 (custom build) · React 19 · Prisma 7 + SQLite · Tailwind v4 CSS-first · lucide-react v1.23.0

**Spec:** `docs/superpowers/specs/2026-07-29-list-page-ux-polish-design.md`

## Global Constraints

- **ห้ามรัน `npm run build` หรือ `npm run dev` บนพอร์ต 3000** — ผู้ใช้รัน `start.bat` อยู่และใช้แอปทำงานหาเงินจริงทุกวัน ใช้ `npx tsc --noEmit` แทน build · ถ้าต้องรันแอปให้ใช้ isolated dev server เท่านั้น: `cp dev.db dev-test.db` แล้ว `NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001` แล้ว cleanup ด้วย `rm -rf .next-dev dev-test.db`
- **ห้ามแตะ `dev.db` ตัวจริงในการทดสอบที่มีการเขียน** — อ่านแบบ `readonly: true` ได้
- **ไม่มี test runner และไม่มี `tsx` ในโปรเจกต์ ห้ามติดตั้งเพิ่ม** — ทดสอบ pure function ด้วยการคอมไพล์ไปที่ scratch แล้วรันด้วย node
- **สคริปต์ทดสอบต้องเขียนเป็นไฟล์ `.js` จริงด้วย Write tool ในโฟลเดอร์ scratch** (ห้าม `node -e "..."` ผ่าน bash) และ `require()` ด้วย absolute path เข้า `node_modules` ของ repo
- **ห้าม emoji** ทุกที่ · ข้อความ UI เป็นภาษาไทย
- **ใช้ design token เดิมเท่านั้น**: `ink` `ink-2` `paper` `marigold` `rust` `smoke` `record` `border` `card` `muted-foreground` `foreground` `background` `primary-foreground` — ห้ามเพิ่มสีใหม่
- **ไอคอน lucide ต้องชื่อ canonical** — เปิดไฟล์ `node_modules/lucide-react/dist/esm/icons/<kebab-name>.mjs` เช็กก่อนใช้ทุกครั้ง (ตรวจแล้ว: `ArrowLeft` มีจริง — `export { __iconNode, ArrowLeft as default }`)
- **ห้ามแก้ `lib/entry-rows.ts` · `lib/entry-search.ts` · `lib/entry-sort.ts` · `lib/angle.ts` · `lib/dashboard.ts` · `lib/affiliate.ts` · `lib/recommender.ts` · `lib/weekly-scoreboard.ts` · `lib/post-time.ts`** — เพิ่มไฟล์ใหม่แทน
- **`settledRevenue`/`pendingGmv` ต้องแยกด้วย `finalRevenue === null` เท่านั้น ห้ามใช้สถานะออเดอร์ (`status` string)** — ตรวจกับ `dev.db` จริงแล้วว่า `finalRevenue` เป็น `null` ก็ต่อเมื่อออเดอร์ยังไม่ถึงรอบ (`"รอดำเนินการ"`/`"AwaitingPayment"`) เท่านั้น ส่วน `"ไม่มีสิทธิ์"` มี `finalRevenue: 0` อยู่แล้ว (ไม่ใช่ null) — ใช้ null-ness ตรงๆ ให้ผลถูกต้องโดยไม่ต้อง import `PAID_STATUS`/`INELIGIBLE_STATUS` จาก `lib/affiliate.ts`/`lib/dashboard.ts` เลย และตรงกับที่ `summarizeOrders`/`weekly-scoreboard.ts` ใช้อยู่แล้ว (`finalRevenue ?? 0` ไม่มี status filter)
- **`git diff tsconfig.json` ต้องว่างก่อน commit ทุกครั้ง** ถ้าไม่ว่างให้ `git checkout -- tsconfig.json`
- **ห้าม `git add -A`** — ระบุไฟล์ที่แก้เสมอ
- ทำงานบน branch `feature/list-page-ux-polish` (สร้างแล้ว spec commit อยู่บนนั้น)

---

### Task 1: ปุ่มย้อนกลับหน้ารายการใน `ClapperHeader`

**Files:**
- Modify: `components/clapper-header.tsx`

**Interfaces:**
- Consumes: ไม่มี
- Produces: ไม่มี (ไม่เปลี่ยน prop ของ `ClapperHeader`)

**บริบทที่ต้องรู้:**

`ClapperHeader` ใช้เฉพาะใน `components/entry-workspace.tsx` เท่านั้น (`<ClapperHeader sceneName={form.productName} takeNumber={takeNumber}>`) — หน้าอื่น (`/`, `/dashboard`, `/core-prompt`) ใช้ `AppHeader` ที่มี nav อยู่แล้ว จึงใส่ลิงก์กลับแบบถาวรได้เลยโดยไม่ต้องเพิ่ม prop

- [ ] **Step 1: แก้ `components/clapper-header.tsx`**

ไฟล์เดิมทั้งไฟล์:

```tsx
import { Clapperboard } from "lucide-react";

export function ClapperHeader({
  sceneName,
  takeNumber,
  children,
}: {
  sceneName: string;
  takeNumber: number;
  children?: React.ReactNode;
}) {
  return (
    <header className="relative bg-ink text-paper">
      <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <Clapperboard className="size-6 shrink-0 text-marigold" strokeWidth={1.75} />
          <div>
            <h1 className="font-display text-xl leading-none tracking-wide text-paper sm:text-2xl">
              Pooling Prompt
            </h1>
            <p className="mt-1 text-xs text-paper/60">
              ประกอบ Core Prompt สำหรับวิดีโอ TikTok Shop
            </p>
          </div>
        </div>

        <div className="-rotate-2 rounded-md border border-paper/15 bg-ink-2 px-4 py-2 shadow-[3px_3px_0_0_rgba(0,0,0,0.35)]">
          <div className="flex items-center gap-4 font-mono text-[0.7rem] tracking-widest text-paper/50 uppercase">
            <span>Take {String(takeNumber).padStart(2, "0")}</span>
          </div>
          <p className="mt-0.5 max-w-[14rem] truncate font-mono text-sm text-marigold">
            {sceneName || "ยังไม่ตั้งชื่อสินค้า"}
          </p>
        </div>
      </div>

      {children}

      <div className="clapper-stripes h-2 w-full" />
    </header>
  );
}
```

แทนที่ทั้งไฟล์ด้วย:

```tsx
import Link from "next/link";
import { ArrowLeft, Clapperboard } from "lucide-react";

export function ClapperHeader({
  sceneName,
  takeNumber,
  children,
}: {
  sceneName: string;
  takeNumber: number;
  children?: React.ReactNode;
}) {
  return (
    <header className="relative bg-ink text-paper">
      <div className="px-4 pt-3 sm:px-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 font-mono text-xs text-paper/50 transition-colors hover:text-paper"
        >
          <ArrowLeft className="size-3.5" />
          กลับไปรายการ
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 px-4 pt-2 pb-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <Clapperboard className="size-6 shrink-0 text-marigold" strokeWidth={1.75} />
          <div>
            <h1 className="font-display text-xl leading-none tracking-wide text-paper sm:text-2xl">
              Pooling Prompt
            </h1>
            <p className="mt-1 text-xs text-paper/60">
              ประกอบ Core Prompt สำหรับวิดีโอ TikTok Shop
            </p>
          </div>
        </div>

        <div className="-rotate-2 rounded-md border border-paper/15 bg-ink-2 px-4 py-2 shadow-[3px_3px_0_0_rgba(0,0,0,0.35)]">
          <div className="flex items-center gap-4 font-mono text-[0.7rem] tracking-widest text-paper/50 uppercase">
            <span>Take {String(takeNumber).padStart(2, "0")}</span>
          </div>
          <p className="mt-0.5 max-w-[14rem] truncate font-mono text-sm text-marigold">
            {sceneName || "ยังไม่ตั้งชื่อสินค้า"}
          </p>
        </div>
      </div>

      {children}

      <div className="clapper-stripes h-2 w-full" />
    </header>
  );
}
```

**สิ่งที่เปลี่ยน:** เพิ่มแถวลิงก์กลับเหนือโลโก้ (`px-4 pt-3`) · แถวโลโก้เดิมเปลี่ยน `py-4` เป็น `pt-2 pb-4` เพื่อไม่ให้ระยะห่างรวมเปลี่ยนมากเกินไป · เพิ่ม import `Link` จาก `next/link` และ `ArrowLeft` จาก `lucide-react`

- [ ] **Step 2: ตรวจ type และ lint**

Run: `npx tsc --noEmit`
Expected: ไม่มี error

Run: `npm run lint`
Expected: ไม่มี error

- [ ] **Step 3: ทดสอบ UI จริง**

```bash
cp dev.db dev-test.db
NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001
```

ตรวจ:
- เปิด `/entry/<id ใดก็ได้>` — เห็นลิงก์ "← กลับไปรายการ" เหนือโลโก้ทันทีโดยไม่ต้องเลื่อน
- กดแล้วไปที่ `/` ถูกต้อง
- Take number กับชื่อสินค้ายังแสดงตำแหน่งเดิม ไม่ถูกลิงก์ใหม่บัง
- `/entry/new` ก็มีลิงก์นี้เหมือนกัน (ClapperHeader ใช้ร่วมกัน)
- ไม่มี console error / hydration warning

ปิด server แล้ว cleanup: `rm -rf .next-dev dev-test.db`

- [ ] **Step 4: Commit**

```bash
git diff tsconfig.json   # ต้องว่าง
git add components/clapper-header.tsx
git commit -F - <<'EOF'
Add a way back to the list page from an entry

Getting back to / meant scrolling to the bottom of a 15-row rail to find
the one link that led there. It's now the first thing on the page.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 2: ตัวกรองช่วงวันที่บนหน้ารายการ

**Files:**
- Create: `lib/entry-date-filter.ts`
- Create (scratch, ไม่ commit): `<scratch>/test-date-filter.js`
- Modify: `app/page.tsx`
- Modify: `components/entry-list.tsx`

**Interfaces:**
- Consumes: ไม่มี (pure ล้วน)
- Produces (ใช้ใน `app/page.tsx`/`components/entry-list.tsx`):
  - `function parseDateParam(raw: string | string[] | undefined): string | null`
  - `function filterByPostedDateRange<T extends { postedAt: Date | null }>(rows: T[], from: string | null, to: string | null): T[]`

**บริบทที่ต้องรู้:**

`app/page.tsx` ตอนนี้ (อ่านให้แน่ใจก่อนแก้ — เนื้อหาปัจจุบันทั้งไฟล์):

```tsx
import { getEntryRows, getSearchText } from "@/lib/entry-queries";
import {
  paginate,
  parsePageParam,
  parseStatusParam,
  searchAndFilter,
} from "@/lib/entry-rows";
import { AppHeader } from "@/components/app-header";
import { EntryList } from "@/components/entry-list";

export default async function EntryListPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const query = (Array.isArray(sp.q) ? sp.q[0] : sp.q) ?? "";
  const status = parseStatusParam(sp.status);
  const page = parsePageParam(sp.page);

  const rows = await getEntryRows();

  // อ่านข้อความเฉพาะตอนที่ต้องค้นจริง — ไม่มีคำค้นก็ไม่ต้องแตะ productInfo เลย
  const searchText = query.trim() === "" ? null : await getSearchText();
  const searchable = rows.map((r) => ({
    ...r,
    productName: r.productName,
    productInfo: searchText?.get(r.id)?.productInfo ?? "",
    extraNotes: searchText?.get(r.id)?.extraNotes ?? "",
  }));

  const filtered = searchAndFilter(searchable, { query, status });
  const { items, totalPages, page: safePage } = paginate(filtered, page);

  return (
    <div className="flex min-h-screen flex-1 flex-col lg:h-screen lg:overflow-hidden">
      <AppHeader active="list" />
      <div className="flex flex-1 flex-col p-4 sm:p-6 lg:overflow-y-auto">
        <EntryList
          rows={items.map((r) => ({
            id: r.id,
            productName: r.productName,
            angle: r.angle,
            videoUrl: r.videoUrl,
            postedAt: r.postedAt,
            createdAt: r.createdAt,
            duplicatedFromId: r.duplicatedFromId,
            status: r.status,
            thumbnailFilename: r.thumbnailFilename,
            postedTimeOfDay: r.postedTimeOfDay,
            postedTimeSource: r.postedTimeSource,
            isScheduledPost: r.isScheduledPost,
          }))}
          query={query}
          status={status}
          page={safePage}
          totalPages={totalPages}
          matchCount={filtered.length}
          total={rows.length}
        />
      </div>
    </div>
  );
}
```

Task 3 จะแก้ไฟล์นี้ต่ออีกรอบ (เพิ่มยอดขาย/วิว) — งานนี้ (Task 2) แก้เฉพาะส่วนตัวกรองวันที่ก่อน

**กฎการกรอง (จากสเปก หัวข้อ 4.2):** กรองบน `postedAt` เทียบ UTC date · entry ที่ `postedAt` เป็น `null` ถูกซ่อนทันทีที่มี `from` หรือ `to` ไม่ว่าง · ใช้ร่วมกับค้นหา/กรองสถานะได้ (AND กันทั้งหมด)

- [ ] **Step 1: เขียนสคริปต์ทดสอบที่ยังไม่ผ่าน**

เขียนไฟล์ `<scratch>/test-date-filter.js` ด้วย Write tool (แทน `<scratch>` ด้วย scratchpad dir ของเซสชัน):

```js
const { parseDateParam, filterByPostedDateRange } = require("<scratch>/build/entry-date-filter.js");

let failed = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label} - got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
}

// ---------- parseDateParam ----------
eq("รูปแบบถูกต้อง", parseDateParam("2026-07-15"), "2026-07-15");
eq("ไม่ส่งมา -> null", parseDateParam(undefined), null);
eq("ว่างเปล่า -> null", parseDateParam(""), null);
eq("รูปแบบผิด (ไม่มีขีด) -> null", parseDateParam("20260715"), null);
eq("รูปแบบผิด (เดือน 2 หลักไม่ครบ) -> null", parseDateParam("2026-7-15"), null);
eq("วันที่ไม่มีจริง -> null", parseDateParam("2026-13-40"), null);
eq("ส่งมาเป็น array เอาตัวแรก", parseDateParam(["2026-07-01", "2026-08-01"]), "2026-07-01");
eq("ขยะล้วน -> null", parseDateParam("ไม่ใช่วันที่"), null);

// ---------- filterByPostedDateRange ----------
const row = (id, postedAt) => ({ id, postedAt: postedAt ? new Date(postedAt) : null });
const rows = [
  row("a", "2026-07-01T00:00:00.000Z"),
  row("b", "2026-07-15T00:00:00.000Z"),
  row("c", "2026-07-31T00:00:00.000Z"),
  row("d", null), // ยังไม่ได้ลงคลิป
];

eq("ไม่กรองวันที่เลย -> ได้ครบทุกแถวรวม null",
  filterByPostedDateRange(rows, null, null).map((r) => r.id), ["a", "b", "c", "d"]);

eq("มี from อย่างเดียว -> ตั้งแต่วันนั้นเป็นต้นไป และซ่อน null",
  filterByPostedDateRange(rows, "2026-07-10", null).map((r) => r.id), ["b", "c"]);

eq("มี to อย่างเดียว -> จนถึงวันนั้น และซ่อน null",
  filterByPostedDateRange(rows, null, "2026-07-10").map((r) => r.id), ["a"]);

eq("มีทั้งคู่ -> อยู่ในช่วง และซ่อน null",
  filterByPostedDateRange(rows, "2026-07-05", "2026-07-20").map((r) => r.id), ["b"]);

eq("ขอบเขตรวมวันที่ตรงเป๊ะ (from = วันของแถว a)",
  filterByPostedDateRange(rows, "2026-07-01", "2026-07-01").map((r) => r.id), ["a"]);

eq("ขอบเขตรวมวันที่ตรงเป๊ะ (to = วันของแถว c)",
  filterByPostedDateRange(rows, "2026-07-31", "2026-07-31").map((r) => r.id), ["c"]);

eq("ช่วงที่ไม่มีอะไรตรงเลย -> ว่าง",
  filterByPostedDateRange(rows, "2026-08-01", "2026-08-31").map((r) => r.id), []);

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 2: รันให้เห็นว่าล้มเหลว**

Run: `node "<scratch>/test-date-filter.js"`
Expected: FAIL — `Cannot find module '<scratch>/build/entry-date-filter.js'`

- [ ] **Step 3: เขียน `lib/entry-date-filter.ts`**

```ts
/**
 * ตัวกรองช่วงวันที่ของหน้ารายการ — แยกออกจาก lib/entry-rows.ts โดยตั้งใจ (ห้ามแก้ไฟล์นั้น)
 * ไม่มี dependency ใดๆ จึงคอมไพล์เดี่ยวแล้วทดสอบด้วย node ได้
 */

/** คืนสตริง YYYY-MM-DD ที่ parse ได้จริงเท่านั้น ค่าอื่นคืน null เสมอ ไม่ throw */
export function parseDateParam(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(ms) ? value : null;
}

/**
 * กรองแถวที่ postedAt (เก็บเป็น UTC midnight) อยู่ในช่วง [from, to] แบบรวมขอบ
 *
 * entry ที่ postedAt เป็น null (ยังไม่ได้ลงคลิป) ถูกซ่อนทันทีที่ from หรือ to
 * อย่างใดอย่างหนึ่งไม่ว่าง — เพราะ "อยู่ในช่วงวันที่" กับ entry ที่ไม่มีวันที่เป็นเรื่อง
 * กำกวม เลือกซ่อนแทนการเดา
 */
export function filterByPostedDateRange<T extends { postedAt: Date | null }>(
  rows: T[],
  from: string | null,
  to: string | null
): T[] {
  if (from === null && to === null) return rows;

  const fromMs = from !== null ? Date.parse(`${from}T00:00:00.000Z`) : -Infinity;
  const toMs = to !== null ? Date.parse(`${to}T23:59:59.999Z`) : Infinity;

  return rows.filter((r) => {
    if (r.postedAt === null) return false;
    const ms = new Date(r.postedAt).getTime();
    return ms >= fromMs && ms <= toMs;
  });
}
```

- [ ] **Step 4: คอมไพล์แล้วรันสคริปต์ทดสอบให้ผ่านทั้งหมด**

ไม่มี import จึงคอมไพล์เดี่ยวได้:

Run: `npx tsc lib/entry-date-filter.ts --outDir "<scratch>/build" --module commonjs --target ES2017 --skipLibCheck`
Expected: ไม่มี error เกิดไฟล์ `<scratch>/build/entry-date-filter.js`

Run: `node "<scratch>/test-date-filter.js"`
Expected: ทุกบรรทัด `PASS` และปิดท้าย `ALL PASS`

**ห้ามแก้ค่าคาดหวังในสคริปต์ทดสอบเพื่อให้ผ่าน**

- [ ] **Step 5: ตรวจ type และ lint**

Run: `npx tsc --noEmit`
Expected: ไม่มี error

Run: `npm run lint`
Expected: ไม่มี error

- [ ] **Step 6: ต่อเข้า `app/page.tsx`**

แทนที่ทั้งไฟล์ (`app/page.tsx`) ด้วย:

```tsx
import { getEntryRows, getSearchText } from "@/lib/entry-queries";
import {
  paginate,
  parsePageParam,
  parseStatusParam,
  searchAndFilter,
} from "@/lib/entry-rows";
import { filterByPostedDateRange, parseDateParam } from "@/lib/entry-date-filter";
import { AppHeader } from "@/components/app-header";
import { EntryList } from "@/components/entry-list";

export default async function EntryListPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const query = (Array.isArray(sp.q) ? sp.q[0] : sp.q) ?? "";
  const status = parseStatusParam(sp.status);
  const page = parsePageParam(sp.page);
  const from = parseDateParam(sp.from);
  const to = parseDateParam(sp.to);

  const rows = await getEntryRows();
  const dateFiltered = filterByPostedDateRange(rows, from, to);

  // อ่านข้อความเฉพาะตอนที่ต้องค้นจริง — ไม่มีคำค้นก็ไม่ต้องแตะ productInfo เลย
  const searchText = query.trim() === "" ? null : await getSearchText();
  const searchable = dateFiltered.map((r) => ({
    ...r,
    productName: r.productName,
    productInfo: searchText?.get(r.id)?.productInfo ?? "",
    extraNotes: searchText?.get(r.id)?.extraNotes ?? "",
  }));

  const filtered = searchAndFilter(searchable, { query, status });
  const { items, totalPages, page: safePage } = paginate(filtered, page);

  return (
    <div className="flex min-h-screen flex-1 flex-col lg:h-screen lg:overflow-hidden">
      <AppHeader active="list" />
      <div className="flex flex-1 flex-col p-4 sm:p-6 lg:overflow-y-auto">
        <EntryList
          rows={items.map((r) => ({
            id: r.id,
            productName: r.productName,
            angle: r.angle,
            videoUrl: r.videoUrl,
            postedAt: r.postedAt,
            createdAt: r.createdAt,
            duplicatedFromId: r.duplicatedFromId,
            status: r.status,
            thumbnailFilename: r.thumbnailFilename,
            postedTimeOfDay: r.postedTimeOfDay,
            postedTimeSource: r.postedTimeSource,
            isScheduledPost: r.isScheduledPost,
          }))}
          query={query}
          status={status}
          from={from}
          to={to}
          page={safePage}
          totalPages={totalPages}
          matchCount={filtered.length}
          total={rows.length}
        />
      </div>
    </div>
  );
}
```

**สิ่งที่เปลี่ยน:** เพิ่ม `from`/`to` parsing · เพิ่มขั้น `filterByPostedDateRange` ก่อน map เป็น `searchable` (กรองวันที่ก่อนค้นหา เพราะการค้นหาเปลี่ยนลำดับ ส่วนกรองวันที่ไม่ควรถูกกระทบ) · ส่ง `from`/`to` เป็น prop ใหม่ให้ `EntryList`

- [ ] **Step 7: เพิ่มช่องกรองวันที่ใน `components/entry-list.tsx`**

อ่านไฟล์เดิมทั้งไฟล์ก่อนแก้ (305 บรรทัด จาก merge ล่าสุด) — งานนี้แก้เฉพาะส่วน type, `buildHref`, และฟอร์มค้นหา ไม่แตะส่วนเรนเดอร์แถว (Task 3 จะแก้ส่วนนั้น)

**7.1 แก้ signature ของ `buildHref` (เพิ่ม `from`/`to`):**

จากเดิม:
```tsx
function buildHref(params: {
  query: string;
  status: EntryStatus | "all";
  page: number;
}) {
  const sp = new URLSearchParams();
  if (params.query.trim() !== "") sp.set("q", params.query);
  if (params.status !== "all") sp.set("status", params.status);
  if (params.page > 1) sp.set("page", String(params.page));
  const qs = sp.toString();
  return qs === "" ? "/" : `/?${qs}`;
}
```

เป็น:
```tsx
function buildHref(params: {
  query: string;
  status: EntryStatus | "all";
  from: string | null;
  to: string | null;
  page: number;
}) {
  const sp = new URLSearchParams();
  if (params.query.trim() !== "") sp.set("q", params.query);
  if (params.status !== "all") sp.set("status", params.status);
  if (params.from !== null) sp.set("from", params.from);
  if (params.to !== null) sp.set("to", params.to);
  if (params.page > 1) sp.set("page", String(params.page));
  const qs = sp.toString();
  return qs === "" ? "/" : `/?${qs}`;
}
```

**7.2 แก้ props ของ `EntryList` (เพิ่ม `from`/`to` เข้า destructure และ type):**

จากเดิม:
```tsx
export function EntryList({
  rows,
  query,
  status,
  page,
  totalPages,
  matchCount,
  total,
}: {
  rows: EntryRow[];
  query: string;
  status: EntryStatus | "all";
  page: number;
  totalPages: number;
  matchCount: number;
  total: number;
}) {
```

เป็น:
```tsx
export function EntryList({
  rows,
  query,
  status,
  from,
  to,
  page,
  totalPages,
  matchCount,
  total,
}: {
  rows: EntryRow[];
  query: string;
  status: EntryStatus | "all";
  from: string | null;
  to: string | null;
  page: number;
  totalPages: number;
  matchCount: number;
  total: number;
}) {
```

**7.3 ทุกจุดที่เรียก `buildHref({ query, status: ..., page: ... })` ต้องเพิ่ม `from, to` เข้าไปด้วย** — มี 3 จุด: ตัวกรองสถานะ (`FILTERS.map`) และปุ่ม "ก่อนหน้า"/"ถัดไป" ในส่วนแบ่งหน้า ทั้งหมดเปลี่ยนจาก

```tsx
href={buildHref({ query, status: f.value, page: 1 })}
```

เป็น

```tsx
href={buildHref({ query, status: f.value, from, to, page: 1 })}
```

(และเช่นเดียวกันสำหรับ `page: page - 1` / `page: page + 1` — เติม `from, to` เข้าไปในทุกก้อน `buildHref({...})` ที่มีอยู่)

**7.4 เพิ่มช่องวันที่ในฟอร์มค้นหา** — แทนที่ `<form method="get" action="/" className="flex items-center gap-2">...</form>` เดิมด้วย:

```tsx
        <form method="get" action="/" className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              name="q"
              defaultValue={query}
              placeholder="ค้นหาสินค้า"
              aria-label="ค้นหาสินค้า"
              className="w-64 pl-8"
            />
          </div>
          {status !== "all" && <input type="hidden" name="status" value={status} />}
          <Input
            type="date"
            name="from"
            defaultValue={from ?? ""}
            aria-label="ตั้งแต่วันที่"
            className="w-36"
          />
          <span className="text-xs text-muted-foreground">ถึง</span>
          <Input
            type="date"
            name="to"
            defaultValue={to ?? ""}
            aria-label="ถึงวันที่"
            className="w-36"
          />
          <Button type="submit" variant="secondary">
            ค้นหา
          </Button>
        </form>
```

**ระวัง:** `<input type="date">` คืนค่าเป็น string รูปแบบ `YYYY-MM-DD` อยู่แล้วจาก browser (มาตรฐาน HTML) จึงส่งตรงเข้า `parseDateParam` ได้โดยไม่ต้องแปลง

- [ ] **Step 8: ตรวจ type และ lint**

Run: `npx tsc --noEmit`
Expected: ไม่มี error

Run: `npm run lint`
Expected: ไม่มี error

- [ ] **Step 9: ทดสอบ UI จริง**

```bash
cp dev.db dev-test.db
NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001
```

ตรวจ:
- เลือกช่วงวันที่ครอบคลุมบางส่วนของข้อมูล — ผลลัพธ์แคบลงตรงตามช่วง URL กลายเป็น `/?from=...&to=...`
- **สินค้าที่ยังไม่ได้ลงคลิปหายไปทันทีที่ตั้งช่วงวันที่** (ไม่ว่าจะตั้ง from หรือ to อย่างเดียวก็ตาม)
- เอาช่วงวันที่ออก (ลบค่าในช่องแล้วกดค้นหา) — สินค้าที่ยังไม่ได้ลงคลิปกลับมาเหมือนเดิม
- ใช้ช่วงวันที่ร่วมกับตัวกรองสถานะ + คำค้น — ทั้งสามเงื่อนไขทำงานร่วมกัน (AND)
- ตั้งช่วงวันที่ + กรองสถานะ "ยังไม่มี prompt"/"รอลงคลิป" (ที่ไม่มีวันที่แน่นอน) — ควรได้ผลว่างเสมอ ไม่ error
- **แบ่งหน้า** ยังคง from/to ไว้ใน URL เมื่อกดถัดไป/ก่อนหน้า
- **กด back ของเบราว์เซอร์** กลับไปช่วงวันที่ก่อนหน้าได้ถูกต้อง
- ไม่มี console error / hydration warning

ปิด server แล้ว cleanup: `rm -rf .next-dev dev-test.db`

- [ ] **Step 10: Commit**

```bash
git diff tsconfig.json   # ต้องว่าง
git add lib/entry-date-filter.ts app/page.tsx components/entry-list.tsx
git commit -F - <<'EOF'
Add a date-range filter to the list page

Entries with no posted date can't meaningfully sit "inside" a date range, so
setting either bound hides them rather than guessing — combined with a
status filter for undated entries, that correctly empties the result instead
of showing something misleading.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 3: ยอดขาย + ยอดวิวในแต่ละแถว

**Files:**
- Create: `lib/entry-sales.ts`
- Create (scratch, ไม่ commit): `<scratch>/test-entry-sales.js`
- Modify: `lib/entry-queries.ts`
- Modify: `app/page.tsx`
- Modify: `components/entry-list.tsx`

**Interfaces:**
- Consumes: ไม่มี (pure ล้วน — ไม่ import จาก `lib/affiliate.ts`/`lib/dashboard.ts` ตามที่ Global Constraints ระบุ)
- Produces:
  - `type EntrySalesSummary = { settledRevenue: number; pendingGmv: number; orderCount: number; views: number | null }`
  - `function summarizeEntrySales(orders, metrics): Map<string, EntrySalesSummary>`
  - `function getEntrySales(): Promise<Map<string, EntrySalesSummary>>` (ใน `lib/entry-queries.ts`)

**บริบทที่ต้องรู้ (สำคัญ พลาดง่าย):**

**ห้ามใช้สถานะออเดอร์ (`status` string, `PAID_STATUS`/`INELIGIBLE_STATUS`) ในการแยก settled/pending** ตรวจกับ `dev.db` จริงแล้วว่า `finalRevenue` เป็น `null` ก็ต่อเมื่อออเดอร์ยังไม่ถึงรอบ (`"รอดำเนินการ"`/`"AwaitingPayment"`) เท่านั้น — ออเดอร์สถานะ `"ไม่มีสิทธิ์"` มี `finalRevenue: 0` อยู่แล้ว (ไม่ใช่ null) ดังนั้น:
- `settledRevenue` = `sum(finalRevenue)` เฉพาะแถวที่ `finalRevenue !== null`
- `pendingGmv` = `sum(gmv)` เฉพาะแถวที่ `finalRevenue === null`

วิธีนี้ตรงกับที่ `summarizeOrders`/`weekly-scoreboard.ts` ใช้อยู่แล้ว (`finalRevenue ?? 0` ไม่มี status filter) และทำให้ไฟล์นี้ไม่ต้อง import อะไรเลย คอมไพล์เดี่ยวได้ง่ายกว่าที่คิดไว้ตอนแรกในสเปก (สเปกเขียนไว้ก่อนตรวจข้อมูลจริง — Global Constraints มีค่าชนะ)

`lib/angle.ts` มี `summarizeEntryOutcome()` อยู่แล้วแต่**ไม่ใช้ในงานนี้** — มันไม่แยก settled/pending (รวม `finalRevenue` ทุกแถวเป็นก้อนเดียว) เหมาะกับแผง angle ที่สนใจผลรวม ไม่เหมาะกับหน้ารายการที่ต้องแยกให้ชัด

- [ ] **Step 1: เขียนสคริปต์ทดสอบที่ยังไม่ผ่าน**

เขียนไฟล์ `<scratch>/test-entry-sales.js` ด้วย Write tool:

```js
const { summarizeEntrySales } = require("<scratch>/build/entry-sales.js");

let failed = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label} - got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
}

function toObj(map) {
  return Object.fromEntries([...map.entries()].sort());
}

// ---------- ออเดอร์เดียว settle แล้ว ----------
eq("ออเดอร์ settle แล้ว 1 ตัว",
  toObj(summarizeEntrySales(
    [{ matchedEntryId: "e1", status: "ชำระแล้ว", gmv: 100, finalRevenue: 20 }],
    []
  )),
  { e1: { settledRevenue: 20, pendingGmv: 0, orderCount: 1, views: null } });

// ---------- ออเดอร์รอ (finalRevenue null) ----------
eq("ออเดอร์รอรอบจ่าย (finalRevenue null)",
  toObj(summarizeEntrySales(
    [{ matchedEntryId: "e1", status: "รอดำเนินการ", gmv: 100, finalRevenue: null }],
    []
  )),
  { e1: { settledRevenue: 0, pendingGmv: 100, orderCount: 1, views: null } });

// ---------- ออเดอร์ "ไม่มีสิทธิ์" (finalRevenue = 0 ไม่ใช่ null) -> settled ไม่ใช่ pending ----------
eq("ออเดอร์ไม่มีสิทธิ์ finalRevenue=0 ไม่ใช่ pending",
  toObj(summarizeEntrySales(
    [{ matchedEntryId: "e1", status: "ไม่มีสิทธิ์", gmv: 100, finalRevenue: 0 }],
    []
  )),
  { e1: { settledRevenue: 0, pendingGmv: 0, orderCount: 1, views: null } });

// ---------- ผสมหลายออเดอร์ต่อ entry เดียว ----------
eq("ผสม settle + pending สะสมถูกต้อง",
  toObj(summarizeEntrySales(
    [
      { matchedEntryId: "e1", status: "ชำระแล้ว", gmv: 100, finalRevenue: 30 },
      { matchedEntryId: "e1", status: "ชำระแล้ว", gmv: 50, finalRevenue: 15 },
      { matchedEntryId: "e1", status: "รอดำเนินการ", gmv: 20, finalRevenue: null },
    ],
    []
  )),
  { e1: { settledRevenue: 45, pendingGmv: 20, orderCount: 3, views: null } });

// ---------- matchedEntryId null ถูกข้าม ----------
eq("ออเดอร์ที่ยังไม่ match entry ใดถูกข้าม",
  toObj(summarizeEntrySales(
    [{ matchedEntryId: null, status: "ชำระแล้ว", gmv: 100, finalRevenue: 30 }],
    []
  )),
  {});

// ---------- หลาย entry แยกกันถูกต้อง ----------
eq("หลาย entry ไม่ปนกัน",
  toObj(summarizeEntrySales(
    [
      { matchedEntryId: "e1", status: "ชำระแล้ว", gmv: 100, finalRevenue: 30 },
      { matchedEntryId: "e2", status: "ชำระแล้ว", gmv: 200, finalRevenue: 60 },
    ],
    []
  )),
  {
    e1: { settledRevenue: 30, pendingGmv: 0, orderCount: 1, views: null },
    e2: { settledRevenue: 60, pendingGmv: 0, orderCount: 1, views: null },
  });

// ---------- views: เอาค่าที่ capturedOn ล่าสุด ไม่ใช่ค่าสุดท้ายที่เจอในลิสต์ ----------
eq("views ใช้ค่า capturedOn ล่าสุดแม้อยู่ลำดับแรกในอาร์เรย์",
  toObj(summarizeEntrySales(
    [],
    [
      { matchedEntryId: "e1", views: 999, capturedOn: new Date("2026-07-20T00:00:00Z") },
      { matchedEntryId: "e1", views: 111, capturedOn: new Date("2026-07-01T00:00:00Z") },
    ]
  )),
  { e1: { settledRevenue: 0, pendingGmv: 0, orderCount: 0, views: 999 } });

// ---------- metric ที่ matchedEntryId null ถูกข้าม ----------
eq("metric ที่ยังไม่ match entry ถูกข้าม",
  toObj(summarizeEntrySales(
    [],
    [{ matchedEntryId: null, views: 500, capturedOn: new Date("2026-07-01T00:00:00Z") }]
  )),
  {});

// ---------- ไม่มีทั้ง order และ metric เลย ----------
eq("ไม่มีข้อมูลเลย -> map ว่าง", toObj(summarizeEntrySales([], [])), {});

// ---------- entry มี order แต่ไม่มี metric -> views เป็น null ----------
eq("มี order ไม่มี metric -> views null",
  toObj(summarizeEntrySales(
    [{ matchedEntryId: "e1", status: "ชำระแล้ว", gmv: 100, finalRevenue: 30 }],
    []
  )).e1.views,
  null);

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 2: รันให้เห็นว่าล้มเหลว**

Run: `node "<scratch>/test-entry-sales.js"`
Expected: FAIL — `Cannot find module '<scratch>/build/entry-sales.js'`

- [ ] **Step 3: เขียน `lib/entry-sales.ts`**

```ts
/**
 * รวมยอดขาย/ยอดวิวต่อ entry — ครั้งเดียวต่อ request ไม่ query ซ้ำต่อแถวที่แสดง
 *
 * ไม่มี dependency ใดๆ ตั้งใจ (ไม่ import PAID_STATUS/INELIGIBLE_STATUS จาก
 * lib/affiliate.ts หรือ lib/dashboard.ts) — ตรวจกับข้อมูลจริงแล้วว่า finalRevenue
 * เป็น null ก็ต่อเมื่อออเดอร์ยังไม่ถึงรอบจ่ายเท่านั้น ("ไม่มีสิทธิ์" มี finalRevenue: 0
 * อยู่แล้ว ไม่ใช่ null) การใช้ finalRevenue === null ตรงๆ จึงถูกต้องและตรงกับที่
 * summarizeOrders (lib/dashboard.ts) ใช้อยู่แล้วโดยไม่ต้องพึ่งสถานะออเดอร์เลย
 */

export type EntrySalesSummary = {
  /** เงินที่ได้จริง — sum(finalRevenue) เฉพาะออเดอร์ที่ finalRevenue ไม่ null */
  settledRevenue: number;
  /** ยอดขายตั้งต้นของออเดอร์ที่ยังไม่ถึงรอบจ่าย (finalRevenue เป็น null) */
  pendingGmv: number;
  orderCount: number;
  /** จำนวนวิวจาก ClipMetric ที่ capturedOn ล่าสุด — null ถ้าไม่มี metric match เลย */
  views: number | null;
};

type OrderInput = {
  matchedEntryId: string | null;
  gmv: number;
  finalRevenue: number | null;
};

type MetricInput = {
  matchedEntryId: string | null;
  views: number;
  capturedOn: Date;
};

function ensure(
  map: Map<string, EntrySalesSummary>,
  entryId: string
): EntrySalesSummary {
  let s = map.get(entryId);
  if (!s) {
    s = { settledRevenue: 0, pendingGmv: 0, orderCount: 0, views: null };
    map.set(entryId, s);
  }
  return s;
}

export function summarizeEntrySales(
  orders: OrderInput[],
  metrics: MetricInput[]
): Map<string, EntrySalesSummary> {
  const map = new Map<string, EntrySalesSummary>();

  for (const o of orders) {
    if (o.matchedEntryId === null) continue;
    const s = ensure(map, o.matchedEntryId);
    s.orderCount++;
    if (o.finalRevenue !== null) {
      s.settledRevenue += o.finalRevenue;
    } else {
      s.pendingGmv += o.gmv;
    }
  }

  // เก็บ views ของ capturedOn ล่าสุดต่อ entry — ต้องเทียบทีละแถว ไม่ใช่ใช้ค่าสุดท้าย
  // ที่เจอในอาร์เรย์ (อาร์เรย์อาจไม่ได้เรียงตามเวลา)
  const latestCapturedOnMs = new Map<string, number>();
  for (const m of metrics) {
    if (m.matchedEntryId === null) continue;
    const at = m.capturedOn.getTime();
    const prevAt = latestCapturedOnMs.get(m.matchedEntryId) ?? -Infinity;
    if (at > prevAt) {
      latestCapturedOnMs.set(m.matchedEntryId, at);
      const s = ensure(map, m.matchedEntryId);
      s.views = m.views;
    }
  }

  return map;
}
```

- [ ] **Step 4: คอมไพล์แล้วรันสคริปต์ทดสอบให้ผ่านทั้งหมด**

ไม่มี import จึงคอมไพล์เดี่ยวได้:

Run: `npx tsc lib/entry-sales.ts --outDir "<scratch>/build" --module commonjs --target ES2017 --skipLibCheck`
Expected: ไม่มี error เกิดไฟล์ `<scratch>/build/entry-sales.js`

Run: `node "<scratch>/test-entry-sales.js"`
Expected: ทุกบรรทัด `PASS` และปิดท้าย `ALL PASS`

**ห้ามแก้ค่าคาดหวังในสคริปต์ทดสอบเพื่อให้ผ่าน**

- [ ] **Step 5: ตรวจกับข้อมูลจริงว่า `settledRevenue` รวมกันได้เท่ากับที่แอปคำนวณอยู่แล้ว**

เขียนไฟล์ `<scratch>/verify-entry-sales.js` (อ่าน `dev.db` แบบ **readonly** ห้ามเขียน — แทน `<REPO>` ด้วย `C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt`):

```js
const Database = require("<REPO>/node_modules/better-sqlite3");
const { summarizeEntrySales } = require("<scratch>/build/entry-sales.js");
const db = new Database("<REPO>/dev.db", { readonly: true });

const orders = db.prepare(`SELECT matchedEntryId, gmv, finalRevenue FROM AffiliateOrder`).all();
const metrics = db.prepare(`SELECT matchedEntryId, views, capturedOn FROM ClipMetric`).all().map((m) => ({
  ...m,
  capturedOn: new Date(m.capturedOn),
}));

const perEntry = summarizeEntrySales(orders, metrics);

let sumSettled = 0;
for (const s of perEntry.values()) sumSettled += s.settledRevenue;

// ผลรวม settledRevenue ต่อ entry ต้องเท่ากับผลรวม finalRevenue ของออเดอร์ที่ match กับ
// entry ใดก็ได้ (matchedEntryId ไม่ null) เพราะ summarizeEntrySales ไม่ทิ้งออเดอร์ที่
// match แล้วแม้แต่แถวเดียว
const expectedSettled = orders
  .filter((o) => o.matchedEntryId !== null)
  .reduce((sum, o) => sum + (o.finalRevenue ?? 0), 0);

let failed = 0;
function check(label, got, want) {
  const ok = Math.abs(got - want) < 0.01;
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"} ${label}: ${got} (คาด ${want})`);
}

console.log(`entry ที่มีออเดอร์/metric อย่างน้อย 1 อย่าง: ${perEntry.size}`);
check("ผลรวม settledRevenue ตรงกับผลรวม finalRevenue ของออเดอร์ที่ match แล้ว",
  sumSettled, expectedSettled);

const sumOrderCount = [...perEntry.values()].reduce((s, v) => s + v.orderCount, 0);
const expectedOrderCount = orders.filter((o) => o.matchedEntryId !== null).length;
check("ผลรวม orderCount ตรงกับจำนวนออเดอร์ที่ match แล้ว", sumOrderCount, expectedOrderCount);

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
```

Run: `node "<scratch>/verify-entry-sales.js"`
Expected: ทุกบรรทัด `PASS` และ `ALL PASS`

- [ ] **Step 6: เพิ่ม `getEntrySales` ใน `lib/entry-queries.ts`**

เพิ่ม import ที่หัวไฟล์ (ต่อจาก import อื่นที่มีอยู่):

```ts
import { summarizeEntrySales, type EntrySalesSummary } from "@/lib/entry-sales";
```

แล้วเพิ่มฟังก์ชันท้ายไฟล์:

```ts
/**
 * ยอดขาย/ยอดวิวต่อ entry ทั้งหมด — โหลด AffiliateOrder/ClipMetric แบบเบา (แค่ฟิลด์ที่
 * summarizeEntrySales ใช้จริง) ครั้งเดียวต่อ request ไม่ query ซ้ำต่อแถวที่แสดงใน
 * หน้ารายการ ตารางทั้งสองยังมีขนาดหลักร้อยแถว (เทียบเท่าที่ /dashboard โหลดอยู่แล้ว)
 */
export async function getEntrySales(): Promise<Map<string, EntrySalesSummary>> {
  const [orders, metrics] = await Promise.all([
    prisma.affiliateOrder.findMany({
      select: { matchedEntryId: true, gmv: true, finalRevenue: true },
    }),
    prisma.clipMetric.findMany({
      select: { matchedEntryId: true, views: true, capturedOn: true },
    }),
  ]);
  return summarizeEntrySales(orders, metrics);
}
```

- [ ] **Step 7: ต่อเข้า `app/page.tsx`**

เพิ่ม import (ต่อจากบรรทัด import จาก `@/lib/entry-queries` เดิม — รวมเป็นบรรทัดเดียว):

```tsx
import { getEntryRows, getEntrySales, getSearchText } from "@/lib/entry-queries";
```

แล้วในตัว component เพิ่มการดึงข้อมูลคู่กับ `getEntryRows()` (แก้จาก `const rows = await getEntryRows();` เป็น):

```tsx
  const [rows, salesByEntry] = await Promise.all([getEntryRows(), getEntrySales()]);
```

และแก้ `rows={items.map((r) => ({...}))}` ให้แนบ `sales` เข้าไปต่อท้าย object literal เดิมทุก field (เพิ่มบรรทัดเดียว):

```tsx
            sales: salesByEntry.get(r.id) ?? null,
```

(วางต่อจากบรรทัด `isScheduledPost: r.isScheduledPost,` ในก้อน `.map()` เดิม)

- [ ] **Step 8: แก้ `components/entry-list.tsx` — เพิ่ม type, ฟังก์ชันช่วยฟอร์แมต, และแสดงผล**

**8.1 เพิ่ม import `EntrySalesSummary`:**

```tsx
import type { EntrySalesSummary } from "@/lib/entry-sales";
```

**8.2 เพิ่มฟังก์ชัน `baht` — วางต่อจาก import ทั้งหมด ก่อน `STATUS_LABEL`:**

```tsx
function baht(n: number): string {
  return "฿" + n.toLocaleString("th-TH", { maximumFractionDigits: 0 });
}
```

**8.3 แก้ type ของ prop `rows`** — จากเดิม `rows: EntryRow[];` เป็น:

```tsx
  rows: (EntryRow & { sales: EntrySalesSummary | null })[];
```

(แก้ทั้งใน destructure params ด้านบนและ type object ด้านล่างของ `EntryList` — เป็น type เดียวกัน)

**8.4 แก้บล็อกเรนเดอร์แถว** — แทนที่ `<div className="flex shrink-0 flex-col items-end gap-1">...</div>` (ก้อนขวาสุดของแถว ที่มี status badge กับวันที่) ด้วย:

```tsx
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 font-mono text-[0.6rem] tracking-wide",
                        STATUS_STYLE[row.status]
                      )}
                    >
                      {STATUS_LABEL[row.status]}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {posted ?? `สร้าง ${createdLabel(row.createdAt)}`}
                    </span>
                    {row.sales !== null && row.sales.orderCount > 0 && (
                      <span className="flex items-center gap-1 font-mono text-[0.65rem] text-marigold">
                        {baht(row.sales.settledRevenue)} · {row.sales.orderCount} ออเดอร์
                        {row.sales.pendingGmv > 0 && (
                          <span className="rounded-full border border-smoke/40 px-1.5 py-0.5 text-[0.55rem] text-smoke">
                            รอรอบจ่าย
                          </span>
                        )}
                      </span>
                    )}
                    {row.sales !== null && row.sales.views !== null && (
                      <span className="font-mono text-[0.65rem] text-muted-foreground">
                        {row.sales.views.toLocaleString("th-TH")} วิว
                      </span>
                    )}
                  </div>
```

**สิ่งที่เปลี่ยนจากเดิม:** วันที่ขยายจาก `text-[0.6rem]` เป็น `text-xs` (ตามสเปกข้อ 3.4) · เพิ่มบรรทัดยอดขาย (แสดงเมื่อ `orderCount > 0` เท่านั้น) · เพิ่มบรรทัดยอดวิว (แสดงเมื่อมี `views` เท่านั้น)

- [ ] **Step 9: ตรวจ type และ lint**

Run: `npx tsc --noEmit`
Expected: ไม่มี error

Run: `npm run lint`
Expected: ไม่มี error

- [ ] **Step 10: ทดสอบ UI จริง**

```bash
cp dev.db dev-test.db
NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001
```

ตรวจ:
- **สินค้าที่มีออเดอร์จับคู่แล้ว** (หา entry ที่มี `matchedEntryId` ใน `AffiliateOrder` ของ `dev-test.db` ก่อน) — แถวนั้นโชว์ `฿<จำนวน> · N ออเดอร์`
- **สินค้าที่มีออเดอร์ยังไม่ถึงรอบจ่าย** — เห็น tag "รอรอบจ่าย" ต่อท้าย
- **สินค้าที่ไม่มีออเดอร์เลย** — ไม่มีบรรทัดยอดขายโผล่มา (ไม่ใช่ ฿0)
- **สินค้าที่มี `ClipMetric` match** — เห็นจำนวนวิว
- วันที่ในแถวใหญ่ขึ้นเห็นชัดกว่าเดิม
- **ตัวเลขยอดขายตรงกับที่แดชบอร์ด (`/dashboard`) แสดงสำหรับสินค้าเดียวกัน** เทียบ 2-3 ตัวข้าม `/` กับ `/dashboard` เพื่อยืนยันว่าไม่ขัดกัน (คนละวิธีคำนวณ แต่ควรได้ตัวเลขไปในทิศทางเดียวกัน — ตัวเลขที่ `/` ต้องไม่มากกว่ายอดรวมของสินค้านั้นที่เห็นใน `revenue-by-clip` ของแดชบอร์ด)
- ค้นหา/กรองสถานะ/กรองวันที่ (จาก Task 2) ยังทำงานถูกต้องร่วมกับข้อมูลยอดขายใหม่
- เลื่อนดูหน้าอื่น (ถ้ามีมากกว่า 30 แถว) — ยอดขาย/วิวของแต่ละแถวยังถูกต้องตามหน้า
- ไม่มี console error / hydration warning

ปิด server แล้ว cleanup: `rm -rf .next-dev dev-test.db`

- [ ] **Step 11: Commit**

```bash
git diff tsconfig.json   # ต้องว่าง
git add lib/entry-sales.ts lib/entry-queries.ts app/page.tsx components/entry-list.tsx
git commit -F - <<'EOF'
Show settled revenue, pending orders, and views on the list

A row with no sales data showed nothing, which is correct - the alternative,
showing an entry with orders in flight as flat zero revenue, is the same
settlement-lag confusion the list page dropped a revenue column to avoid
during the route split. Settled vs pending is read straight off whether
finalRevenue is null, matching how summarizeOrders already defines it,
rather than introducing a second definition keyed on order status text.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Self-Review

**ความครอบคลุมของ spec:**

| ข้อกำหนดใน spec | Task ที่ทำ |
|---|---|
| §2 ปุ่มย้อนกลับ | Task 1 |
| §3.1-3.2 กฎแยก settled/pending + tag "รอรอบจ่าย" | Task 3 (พบระหว่างตรวจข้อมูลจริงว่าใช้ `finalRevenue === null` ได้ตรงกว่าที่สเปกร่างไว้ — Global Constraints อัปเดตแล้ว) |
| §3.2 `orderCount === 0` ไม่โชว์บรรทัดยอดขาย | Task 3 Step 8.4 |
| §3.2 views จาก ClipMetric ล่าสุด | Task 3 (`summarizeEntrySales` เทียบ `capturedOn`) + assert เฉพาะ |
| §3.3 คำนวณฝั่ง server ครั้งเดียว ไม่ query ซ้ำต่อแถว | Task 3 Step 6 (`getEntrySales` เรียกครั้งเดียวต่อ request) |
| §3.4 ขยายฟอนต์วันที่ | Task 3 Step 8.4 (`text-[0.6rem]` → `text-xs`) |
| §4.1-4.2 ตัวกรองช่วงวันที่ + ซ่อน entry ไม่มีวันที่ | Task 2 |
| §4.2 AND กับตัวกรองอื่น | Task 2 Step 6 (`filterByPostedDateRange` ก่อน `searchAndFilter`) |
| §4.3 UI ช่องวันที่ + carry ผ่าน pagination | Task 2 Step 7 |
| §5 ไม่แก้ `lib/dashboard.ts`/`lib/angle.ts`/`lib/entry-rows.ts` | ทุก Task (ไฟล์ใหม่แยกทั้งหมด) |
| §5 ไม่เรียงลำดับใหม่ตามยอดขาย/วิว | Task 3 (ใช้ลำดับจาก `getEntryRows()`/`sortEntriesForRail` เดิมทั้งหมด ไม่แตะการเรียง) |
| §5 ไม่ใช้ calendar UI พิเศษ | Task 2 Step 7 (`<input type="date">` ธรรมดา) |
| §6.6 ไม่ส่งข้อมูล order/metric ดิบลง client | Task 3 (`EntrySalesSummary` มีแค่ 4 ตัวเลข ไม่มี raw order/metric) |
| §6.7 วันที่ไม่เพี้ยน | Task 3 (ไม่แตะตรรกะ `postedLabel`/`createdLabel` แค่เปลี่ยน class) |

**ความสอดคล้องของชื่อ/ชนิด:** `parseDateParam`/`filterByPostedDateRange` นิยาม Task 2 ใช้ Task 2 เอง ✓ · `EntrySalesSummary`/`summarizeEntrySales` นิยาม Task 3 ใช้ต่อใน `lib/entry-queries.ts`/`app/page.tsx`/`components/entry-list.tsx` ทั้งหมดด้วยชื่อเดียวกัน ✓ · prop `sales: EntrySalesSummary | null` ใช้ชื่อเดียวกันทั้ง `app/page.tsx` (ที่แนบ) และ `components/entry-list.tsx` (ที่รับ) ✓ · `buildHref` เพิ่ม `from`/`to` ครบทุกจุดเรียกใน Task 2 Step 7.3 ✓

**สิ่งที่พบระหว่าง self-review และแก้แล้ว:** สเปกเดิม (หัวข้อ 3.1) ตั้งใจให้แยก settled/pending ด้วยสถานะออเดอร์แบบเดียวกับ `revenueByClip` แต่หลังตรวจ `dev.db` จริงพบว่า `finalRevenue === null` เพียงพอและตรงกับที่แอปใช้อยู่แล้ว (`summarizeOrders`) — Task 3 จึงไม่ต้อง import `PAID_STATUS`/`INELIGIBLE_STATUS` เลย ทำให้ `lib/entry-sales.ts` เป็น pure function ไม่มี dependency ง่ายต่อการทดสอบกว่าที่ร่างไว้ในสเปก (บันทึกไว้ใน Global Constraints ของแผนนี้แล้วว่าเป็นค่าที่ถูกต้อง)
