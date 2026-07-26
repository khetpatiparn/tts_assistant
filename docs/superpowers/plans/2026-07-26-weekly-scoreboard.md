# Weekly Scoreboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เพิ่มแผง "4 สัปดาห์ล่าสุด" (คลิป / เงินที่ได้จริง / winner ใหม่) ในแท็บ ④ รายได้ และแก้คำเตือนความสดข้อมูลให้แยกไฟล์รายได้กับไฟล์วิว

**Architecture:** ตรรกะการจัดกลุ่มรายสัปดาห์ทั้งหมดอยู่ใน `lib/weekly-scoreboard.ts` ซึ่งเป็น pure function ล้วน (รับข้อมูลที่ `app/page.tsx` ดึงมาแล้ว ไม่แตะ Prisma/Date.now เอง) · `components/weekly-scoreboard.tsx` เป็นตัวแสดงผลอย่างเดียว ไม่มี state · การแก้ความสดข้อมูลเป็นการขยาย `ReminderState` จาก 1 เป็น 2 ค่า แล้วไล่แก้จุดที่อ่านมัน — **ไม่มี schema ใหม่ ไม่มี server action ใหม่ ไม่เรียก AI**

**Tech Stack:** Next.js 16.2.10 (custom build) · React Server Component (`app/page.tsx`) ส่ง props ลง client components · Prisma 7 + SQLite (อ่านอย่างเดียว ไม่แก้ schema) · Tailwind v4 CSS-first · lucide-react v1.23.0

**Spec:** `docs/superpowers/specs/2026-07-26-weekly-scoreboard-design.md`

## Global Constraints

- **ห้ามรัน `npm run build` หรือ `npm run dev` บนพอร์ต 3000** — ผู้ใช้รัน `start.bat` อยู่และใช้แอปทำงานจริงทุกวัน ใช้ `npx tsc --noEmit` แทน build และถ้าต้องรันแอปให้ใช้ isolated dev server เท่านั้น: `cp dev.db dev-test.db` แล้ว `NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001`
- **ห้ามแตะ `dev.db` ตัวจริงในการทดสอบ** — ใช้ `dev-test.db` เท่านั้น · ห้าม `DELETE FROM` แบบไม่มี `WHERE`
- **สคริปต์ตรวจข้อมูลต้องเขียนเป็นไฟล์ `.js` จริงด้วย Write tool ในโฟลเดอร์ scratch** (ห้าม `node -e "..."` ผ่าน bash — git-bash แปลง path จนพัง) และ `require()` ด้วย absolute path เข้า `node_modules` ของ repo
- **ห้าม emoji** ทุกที่ · ข้อความ UI เป็นภาษาไทย
- **ใช้ design token เดิมเท่านั้น**: `ink` `paper` `marigold` `rust` `smoke` `record` `border` `card` `muted-foreground` `foreground` — ห้ามเพิ่มสีใหม่
- **ไอคอน lucide ต้องใช้ชื่อ canonical** — `CalendarRange` ตรวจแล้วว่าเป็นชื่อจริงใน `node_modules/lucide-react/dist/esm/icons/calendar-range.mjs` (ห้ามเปลี่ยนไปใช้ชื่ออื่นโดยไม่ตรวจไฟล์ `.mjs`)
- **`git diff tsconfig.json` ต้องว่างก่อน commit ทุกครั้ง** (dev server แก้ไฟล์นี้เองได้ — repo pin `target: "ES2017"` ไว้ตั้งใจ) ถ้าเปลี่ยนให้ `git checkout -- tsconfig.json`
- **ห้าม `git add -A`** — ระบุไฟล์ที่แก้เสมอ
- ทำงานบน branch `feature/weekly-scoreboard` (สร้างแล้ว spec commit อยู่บนนั้น)
- ไม่มี test runner ในโปรเจกต์ — "test" ของแผนนี้คือสคริปต์ node ใน scratch dir ที่ assert เอง แล้วตามด้วยการตรวจ UI จริง **ห้ามติดตั้ง test runner ใหม่**
- **ห้ามแตะ `lib/recommender.ts`** และห้ามแก้ตรรกะการนำเข้าไฟล์ใน `app/actions.ts`

---

### Task 1: `lib/weekly-scoreboard.ts` — ตรรกะจัดกลุ่มรายสัปดาห์ (pure)

**Files:**
- Create: `lib/weekly-scoreboard.ts`
- Create (scratch, ไม่ commit): `<scratch>/test-weekly-scoreboard.js`

**Interfaces:**
- Consumes: `AffiliateOrderRecord` จาก `@/lib/dashboard` (มีอยู่แล้ว — ใช้ฟิลด์ `finalRevenue: number | null`, `orderDate: Date`, `matchedEntryId: string | null`)
- Produces (Task 2 ใช้ต่อ):
  - `type ScoreboardEntry = { id: string; postedAt: Date | null }`
  - `type WeekRow = { weekStart: Date; weekEnd: Date; isCurrent: boolean; clips: number; settledRevenue: number; newWinners: number }`
  - `type Scoreboard = { weeks: WeekRow[]; tooEarlyClips: number }`
  - `function buildWeeklyScoreboard(args: { entries: ScoreboardEntry[]; orders: AffiliateOrderRecord[]; now: Date; weeks?: number }): Scoreboard`

**บริบทที่ต้องรู้ก่อนเขียน (สำคัญมาก — พลาดตรงนี้ตัวเลขจะเพี้ยนแบบเงียบๆ):**

`PromptEntry.postedAt` เก็บเป็น **UTC midnight ของวันที่โพสต์** (ดู `toDateInputValue` ใน `components/production-panel.tsx`) จึงต้องอ่านด้วย `getUTCFullYear()/getUTCMonth()/getUTCDate()` ส่วน `AffiliateOrder.orderDate` เป็น **timestamp จริงในเวลาไทย** จึงต้องอ่านด้วย local getters (แบบเดียวกับ `dayKey()` ใน `lib/dashboard.ts:71-77`) — ใช้ตัวอ่านผิดจะทำให้ entry ที่โพสต์วันจันทร์ตกไปอยู่สัปดาห์ก่อนหน้า

- [ ] **Step 1: เขียนสคริปต์ทดสอบที่ยังไม่ผ่าน**

โปรเจกต์นี้**ไม่มี `tsx` และไม่มี test runner** (ตรวจแล้ว — `node_modules/.bin/` ไม่มี `tsx`) และห้ามติดตั้งเพิ่ม วิธีทดสอบคือ **คอมไพล์ไฟล์เดียวไป scratch แล้วรันด้วย node**

เขียนไฟล์ `<scratch>/test-weekly-scoreboard.js` ด้วย Write tool (แทน `<scratch>` ด้วย scratchpad dir ของเซสชัน) — ไฟล์นี้ `require` ผลลัพธ์ที่คอมไพล์แล้วจาก Step 2:

```js
const { buildWeeklyScoreboard } = require("<scratch>/build/weekly-scoreboard.js");

let failed = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label} — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
}

// postedAt = UTC midnight (แบบเดียวกับที่ระบบเก็บจริง)
const posted = (iso) => new Date(iso + "T00:00:00.000Z");
// orderDate = timestamp เวลาไทย (local)
const ordered = (y, m, d, h = 12) => new Date(y, m - 1, d, h);

function order(id, entryId, date, revenue) {
  return {
    orderId: id,
    productName: "x",
    productId: "p",
    contentId: "c",
    status: revenue === null ? "รอ" : "ชำระแล้ว",
    currency: "THB",
    gmv: 100,
    itemsSold: 1,
    itemsRefunded: 0,
    actualCommission: revenue,
    finalRevenue: revenue,
    orderDate: date,
    matchedEntryId: entryId,
    importedAt: date,
  };
}

// now = พฤหัส 23 ก.ค. 2026 → สัปดาห์ปัจจุบันคือ จ.20 – อา.26 ก.ค.
const now = new Date(2026, 6, 23, 10, 0, 0);

const entries = [
  { id: "a", postedAt: posted("2026-07-20") }, // จันทร์ต้นสัปดาห์ปัจจุบัน (เคสขอบ)
  { id: "b", postedAt: posted("2026-07-26") }, // อาทิตย์ท้ายสัปดาห์ปัจจุบัน (เคสขอบ)
  { id: "c", postedAt: posted("2026-07-19") }, // อาทิตย์ของสัปดาห์ก่อน (เคสขอบ)
  { id: "d", postedAt: null },                  // ยังไม่ได้ลงคลิป — ต้องไม่ถูกนับ
];

const orders = [
  order("o1", "a", ordered(2026, 7, 21), 50),   // เงินเข้าสัปดาห์ปัจจุบัน + winner ใหม่ของ a
  order("o2", "a", ordered(2026, 7, 22), 25),   // เงินเพิ่ม แต่ไม่ใช่ winner ใหม่ซ้ำ
  order("o3", "c", ordered(2026, 7, 15), 30),   // สัปดาห์ก่อน — winner ใหม่ของ c
  order("o4", "c", ordered(2026, 7, 21), 10),   // สัปดาห์ปัจจุบัน แต่ c เป็น winner ตั้งแต่สัปดาห์ก่อนแล้ว
  order("o5", "b", ordered(2026, 7, 22), null), // ยังไม่ได้เงิน — ไม่นับทั้งเงินและ winner
];

const sb = buildWeeklyScoreboard({ entries, orders, now, weeks: 4 });

eq("จำนวนแถว", sb.weeks.length, 4);
eq("แถวแรกคือสัปดาห์ปัจจุบัน", sb.weeks[0].isCurrent, true);
eq("แถวที่สองไม่ใช่สัปดาห์ปัจจุบัน", sb.weeks[1].isCurrent, false);
eq("วันเริ่มสัปดาห์ปัจจุบัน", sb.weeks[0].weekStart.toISOString().slice(0, 10), "2026-07-20");
eq("วันจบสัปดาห์ปัจจุบัน", sb.weeks[0].weekEnd.toISOString().slice(0, 10), "2026-07-26");
eq("วันเริ่มสัปดาห์ก่อน", sb.weeks[1].weekStart.toISOString().slice(0, 10), "2026-07-13");

eq("คลิปสัปดาห์ปัจจุบัน (จันทร์+อาทิตย์)", sb.weeks[0].clips, 2);
eq("คลิปสัปดาห์ก่อน", sb.weeks[1].clips, 1);
eq("เงินสัปดาห์ปัจจุบัน", sb.weeks[0].settledRevenue, 85);
eq("เงินสัปดาห์ก่อน", sb.weeks[1].settledRevenue, 30);
eq("winner ใหม่สัปดาห์ปัจจุบัน", sb.weeks[0].newWinners, 1);
eq("winner ใหม่สัปดาห์ก่อน", sb.weeks[1].newWinners, 1);
eq("สัปดาห์ที่ไม่มีข้อมูลต้องเป็น 0 ไม่ใช่ NaN", sb.weeks[3].settledRevenue, 0);

// คลิปที่โพสต์ไม่ถึง 7 วัน: a (20 ก.ค.) เท่านั้น — b โพสต์ 26 ก.ค. ซึ่งเป็นอนาคตเทียบ now
eq("คลิปที่ยังเร็วเกินสรุป", sb.tooEarlyClips, 1);

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 2: รันให้เห็นว่าล้มเหลว**

Run: `node "<scratch>/test-weekly-scoreboard.js"`
Expected: FAIL — `Cannot find module '<scratch>/build/weekly-scoreboard.js'` เพราะยังไม่ได้เขียนและคอมไพล์ไฟล์ต้นทาง

- [ ] **Step 3: เขียน `lib/weekly-scoreboard.ts`**

```ts
import type { AffiliateOrderRecord } from "@/lib/dashboard";

const DAY_MS = 24 * 60 * 60 * 1000;

/** entry เท่าที่ scoreboard ต้องใช้ — รับเป็น shape แคบๆ เพื่อให้ทดสอบง่ายและไม่ผูกกับ Prisma */
export type ScoreboardEntry = {
  id: string;
  postedAt: Date | null;
};

export type WeekRow = {
  /** จันทร์ 00:00 UTC ใช้เป็นคีย์ของสัปดาห์ (ไม่ใช่เวลาจริง — เป็นวันตามปฏิทิน) */
  weekStart: Date;
  /** อาทิตย์ของสัปดาห์เดียวกัน */
  weekEnd: Date;
  isCurrent: boolean;
  clips: number;
  settledRevenue: number;
  newWinners: number;
};

export type Scoreboard = {
  /** เรียงใหม่→เก่า แถวแรกคือสัปดาห์ปัจจุบัน */
  weeks: WeekRow[];
  /** คลิปที่โพสต์ไม่ถึง 7 วัน — ยังสรุปผลไม่ได้ */
  tooEarlyClips: number;
};

/**
 * หาวันจันทร์ของสัปดาห์ที่วันตามปฏิทิน (y, m, d) นั้นอยู่ คืนเป็น Date ที่ UTC midnight
 * รับเป็นตัวเลขวันตามปฏิทินแทน Date เพื่อบังคับให้ผู้เรียกตัดสินใจก่อนว่าจะอ่านวันจาก
 * UTC หรือ local — สองแหล่งข้อมูลในแอปนี้เก็บคนละแบบ (ดูคอมเมนต์สองฟังก์ชันถัดไป)
 */
function mondayUtc(year: number, monthIndex: number, day: number): Date {
  const dt = new Date(Date.UTC(year, monthIndex, day));
  const back = (dt.getUTCDay() + 6) % 7; // อาทิตย์(0) ต้องถอย 6 วัน
  return new Date(dt.getTime() - back * DAY_MS);
}

/** `postedAt` เก็บเป็น UTC midnight ของวันที่โพสต์ — ต้องอ่านด้วย getUTC* ไม่งั้นเพี้ยนไป 1 วัน */
export function weekStartOfPostedAt(d: Date): Date {
  return mondayUtc(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** `orderDate` และ `now` เป็น timestamp เวลาไทย — อ่านด้วย local getter (เหมือน dayKey ใน lib/dashboard.ts) */
export function weekStartOfLocal(d: Date): Date {
  return mondayUtc(d.getFullYear(), d.getMonth(), d.getDate());
}

export function buildWeeklyScoreboard(args: {
  entries: ScoreboardEntry[];
  orders: AffiliateOrderRecord[];
  now: Date;
  weeks?: number;
}): Scoreboard {
  const { entries, orders, now } = args;
  const weekCount = args.weeks ?? 4;

  const currentWeek = weekStartOfLocal(now);

  // โครงแถวว่างของ N สัปดาห์ล่าสุด (ใหม่→เก่า) สร้างก่อนเสมอ เพื่อให้สัปดาห์ที่ไม่มีข้อมูล
  // แสดงเป็น 0 ไม่ใช่หายไปจากตาราง
  const rows: WeekRow[] = [];
  const indexByKey = new Map<number, number>();
  for (let i = 0; i < weekCount; i++) {
    const weekStart = new Date(currentWeek.getTime() - i * 7 * DAY_MS);
    rows.push({
      weekStart,
      weekEnd: new Date(weekStart.getTime() + 6 * DAY_MS),
      isCurrent: i === 0,
      clips: 0,
      settledRevenue: 0,
      newWinners: 0,
    });
    indexByKey.set(weekStart.getTime(), i);
  }

  for (const e of entries) {
    if (!e.postedAt) continue;
    const idx = indexByKey.get(weekStartOfPostedAt(e.postedAt).getTime());
    if (idx !== undefined) rows[idx].clips++;
  }

  // เงินที่ได้จริง — นิยามเดียวกับ settledRevenue ใน summarizeOrders (ผลรวม finalRevenue)
  // ต้องตรงกัน ไม่งั้นตัวเลขสองที่ในหน้าเดียวกันจะขัดกันเอง
  for (const o of orders) {
    const revenue = o.finalRevenue ?? 0;
    if (revenue === 0) continue;
    const idx = indexByKey.get(weekStartOfLocal(o.orderDate).getTime());
    if (idx !== undefined) rows[idx].settledRevenue += revenue;
  }

  // winner ใหม่ = entry ที่ "ได้เงินจริงครั้งแรก" ในสัปดาห์นั้น
  // ต้องหาจากออเดอร์ทั้งหมด ไม่ใช่เฉพาะ 4 สัปดาห์ล่าสุด ไม่งั้น entry ที่เคยได้เงินตั้งแต่
  // เดือนก่อนจะถูกนับเป็น winner ใหม่ซ้ำ
  const firstRevenueAt = new Map<string, Date>();
  for (const o of orders) {
    if (!o.matchedEntryId) continue;
    if ((o.finalRevenue ?? 0) === 0) continue;
    const prev = firstRevenueAt.get(o.matchedEntryId);
    if (!prev || o.orderDate.getTime() < prev.getTime()) {
      firstRevenueAt.set(o.matchedEntryId, o.orderDate);
    }
  }
  for (const first of firstRevenueAt.values()) {
    const idx = indexByKey.get(weekStartOfLocal(first).getTime());
    if (idx !== undefined) rows[idx].newWinners++;
  }

  const tooEarlyClips = entries.filter((e) => {
    if (!e.postedAt) return false;
    const age = now.getTime() - e.postedAt.getTime();
    return age >= 0 && age < 7 * DAY_MS;
  }).length;

  return { weeks: rows, tooEarlyClips };
}
```

- [ ] **Step 4: คอมไพล์แล้วรันสคริปต์ทดสอบให้ผ่านทั้งหมด**

`lib/weekly-scoreboard.ts` import แค่ `type` จาก `@/lib/dashboard` ซึ่งถูกลบทิ้งตอนคอมไพล์ จึงคอมไพล์เดี่ยวๆ ได้โดยไม่ต้องแก้ path alias:

Run: `npx tsc lib/weekly-scoreboard.ts --outDir "<scratch>/build" --module commonjs --target ES2017 --skipLibCheck`
Expected: ไม่มี error และเกิดไฟล์ `<scratch>/build/weekly-scoreboard.js`

Run: `node "<scratch>/test-weekly-scoreboard.js"`
Expected: ทุกบรรทัดขึ้น `PASS` และปิดท้ายด้วย `ALL PASS`

ถ้ามีบรรทัด FAIL ให้แก้ `lib/weekly-scoreboard.ts` จนผ่านครบ **ห้ามแก้ค่าคาดหวังในสคริปต์ทดสอบเพื่อให้ผ่าน**

- [ ] **Step 5: ตรวจ type และ lint**

Run: `npx tsc --noEmit`
Expected: ไม่มี error

Run: `npm run lint`
Expected: ไม่มี error (ถ้าเจอ error ที่ชี้ไปยังไฟล์ใน `.next-dev` ให้ `rm -rf .next-dev` แล้วรันใหม่)

- [ ] **Step 6: เทียบตัวเลขกับข้อมูลจริงใน dev.db**

เขียนไฟล์ `<scratch>/verify-scoreboard.js` ด้วย Write tool (อ่าน `dev.db` แบบ **readonly** ห้ามเขียน):

```js
const Database = require("C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt/node_modules/better-sqlite3");
const db = new Database("C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt/dev.db", { readonly: true });

// จัดกลุ่มด้วย SQL อย่างอิสระจากโค้ด TS เพื่อใช้เป็นค่าอ้างอิง
// %W ของ SQLite นับสัปดาห์แบบเริ่มวันจันทร์ ตรงกับที่ scoreboard ใช้
console.log("== คลิปต่อสัปดาห์ (จาก postedAt, UTC) ==");
console.log(db.prepare(`
  SELECT strftime('%Y-W%W', postedAt) wk, COUNT(*) clips
  FROM PromptEntry WHERE postedAt IS NOT NULL
  GROUP BY wk ORDER BY wk DESC LIMIT 6`).all());

console.log("== เงินที่ได้จริงต่อสัปดาห์ (จาก orderDate, local) ==");
console.log(db.prepare(`
  SELECT strftime('%Y-W%W', datetime(orderDate, 'localtime')) wk,
         ROUND(SUM(COALESCE(finalRevenue,0)), 2) revenue
  FROM AffiliateOrder
  GROUP BY wk ORDER BY wk DESC LIMIT 6`).all());

console.log("== winner ใหม่ต่อสัปดาห์ (สัปดาห์ที่ entry ได้เงินครั้งแรก) ==");
console.log(db.prepare(`
  SELECT wk, COUNT(*) newWinners FROM (
    SELECT matchedEntryId,
           strftime('%Y-W%W', datetime(MIN(orderDate), 'localtime')) wk
    FROM AffiliateOrder
    WHERE matchedEntryId IS NOT NULL AND COALESCE(finalRevenue,0) > 0
    GROUP BY matchedEntryId
  ) GROUP BY wk ORDER BY wk DESC LIMIT 6`).all());
```

Run: `node "<scratch>/verify-scoreboard.js"`

เก็บผลไว้เทียบกับหน้าจอใน Task 2 (**ยังไม่ต้องเทียบตอนนี้ — แค่บันทึกตัวเลขไว้**) หมายเหตุ: `%W` ของ SQLite กับการคำนวณใน TS อาจต่างกันที่สัปดาห์คร่อมปี ซึ่งไม่กระทบข้อมูลชุดนี้ (พ.ค.–ก.ค. 2026)

- [ ] **Step 7: Commit**

```bash
git add lib/weekly-scoreboard.ts
git commit -m "Add weekly scoreboard aggregation

postedAt is stored as UTC midnight while orderDate is a real Thai-time
timestamp, so the two are bucketed with different getters — mixing them
shifts Monday and Sunday clips into the wrong week.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: แผง "4 สัปดาห์ล่าสุด" ในแท็บรายได้

**Files:**
- Create: `components/weekly-scoreboard.tsx`
- Modify: `components/dashboard-panel.tsx` (imports ราวบรรทัด 1-25, JSX ราวบรรทัด 118-125)

**Interfaces:**
- Consumes: `buildWeeklyScoreboard`, `type ScoreboardEntry` จาก Task 1 · `AffiliateOrderRecord` จาก `@/lib/dashboard`
- Produces: `<WeeklyScoreboard entries={...} orders={...} now={...} />` — props: `entries: ScoreboardEntry[]`, `orders: AffiliateOrderRecord[]`, `now: Date`

**บริบทที่ต้องรู้ (ตรวจโค้ดจริงแล้ว):** `DashboardPanel` รับ prop `entries: PostTimeEntry[]` อยู่แล้ว แต่ **`PostTimeEntry` (`components/post-time-panel.tsx:25-32`) ไม่มีฟิลด์ `postedAt`** — มีแค่ `id`, `productName`, `videoUrl`, `postedTimeOfDay`, `postedTimeSource`, `isScheduledPost` · ตัว array นี้สร้างที่ `components/prompt-workspace.tsx:271-282` (`dashboardEntries` useMemo) จาก `prompts` ซึ่ง**มี `postedAt: Date | null` อยู่แล้ว**

**วิธีที่เลือก:** เติม `postedAt` เข้าไปใน `dashboardEntries` แล้วขยายชนิดของ prop `entries` ใน `DashboardPanel` เป็น `(PostTimeEntry & ScoreboardEntry)[]` — ไม่เพิ่ม prop ใหม่ ไม่แก้ `PostTimeEntry` (ซึ่งเป็นสัญญาของ `PostTimePanel` และรับ object ที่มีฟิลด์เกินได้อยู่แล้ว)

- [ ] **Step 1: เติม `postedAt` เข้า `dashboardEntries`**

ใน `components/prompt-workspace.tsx` เพิ่มบรรทัดเดียวใน useMemo (หลัง `id: p.id,` บรรทัด 274):

```tsx
        postedAt: p.postedAt,
```

- [ ] **Step 2: เขียน `components/weekly-scoreboard.tsx`**

```tsx
"use client";

import { useMemo } from "react";
import { CalendarRange } from "lucide-react";

import type { AffiliateOrderRecord } from "@/lib/dashboard";
import {
  buildWeeklyScoreboard,
  type ScoreboardEntry,
} from "@/lib/weekly-scoreboard";

function baht(n: number): string {
  return "฿" + n.toLocaleString("th-TH", { maximumFractionDigits: 0 });
}

/** weekStart/weekEnd เป็นวันตามปฏิทินที่เก็บไว้ที่ UTC midnight — ต้องฟอร์แมตด้วย timeZone: "UTC" */
function dayMonth(d: Date): string {
  return d.toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function WeeklyScoreboard({
  entries,
  orders,
  now,
}: {
  entries: ScoreboardEntry[];
  orders: AffiliateOrderRecord[];
  now: Date;
}) {
  const board = useMemo(
    () => buildWeeklyScoreboard({ entries, orders, now, weeks: 4 }),
    [entries, orders, now]
  );

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <span className="flex items-center gap-1.5 font-medium text-foreground/90">
        <CalendarRange className="size-4 text-marigold" />
        4 สัปดาห์ล่าสุด
      </span>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[22rem] border-collapse text-sm">
          <thead>
            <tr className="text-left font-mono text-[0.65rem] tracking-widest text-muted-foreground uppercase">
              <th className="pb-2 font-normal">สัปดาห์</th>
              <th className="pb-2 text-right font-normal">คลิป</th>
              <th className="pb-2 text-right font-normal">เงินที่ได้จริง</th>
              <th className="pb-2 text-right font-normal">winner ใหม่</th>
            </tr>
          </thead>
          <tbody>
            {board.weeks.map((w) => (
              <tr
                key={w.weekStart.toISOString()}
                className="border-t border-border first:border-t-0"
              >
                <td className="py-2 text-foreground/80">
                  {dayMonth(w.weekStart)}–{dayMonth(w.weekEnd)}
                  {w.isCurrent && (
                    <span className="ml-1.5 font-mono text-[0.65rem] text-marigold">
                      (นี้)
                    </span>
                  )}
                </td>
                <td className="py-2 text-right font-mono text-foreground/90">{w.clips}</td>
                <td className="py-2 text-right font-mono text-foreground/90">
                  {baht(w.settledRevenue)}
                </td>
                <td className="py-2 text-right font-mono text-foreground/90">
                  {w.newWinners}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {board.tooEarlyClips > 0 && (
        <p className="font-mono text-[0.7rem] text-muted-foreground">
          มี {board.tooEarlyClips} คลิปที่เพิ่งลงไม่ถึง 7 วัน — ยังเร็วเกินสรุป
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: วางแผงลงใน `components/dashboard-panel.tsx`**

เพิ่ม import ต่อจากบรรทัด `import { RevenueTrend } from "@/components/revenue-charts";` (บรรทัด 23):

```tsx
import { WeeklyScoreboard } from "@/components/weekly-scoreboard";
```

ขยายชนิดของ prop `entries` ใน signature ของ `DashboardPanel` (บรรทัด 55) จาก `entries: PostTimeEntry[];` เป็น:

```tsx
  entries: (PostTimeEntry & ScoreboardEntry)[];
```

โดยเพิ่ม `ScoreboardEntry` เข้า import ของ `@/lib/weekly-scoreboard`:

```tsx
import { WeeklyScoreboard } from "@/components/weekly-scoreboard";
import type { ScoreboardEntry } from "@/lib/weekly-scoreboard";
```

แล้วแทรก JSX **ระหว่าง `ReminderBanner` (บรรทัด 118) กับ `Recommendations` (บรรทัด 120)** — ภาพรวมต้องอ่านก่อนคำแนะนำต่อคลิป:

```tsx
      <WeeklyScoreboard entries={entries} orders={orders} now={now} />
```

- [ ] **Step 4: ตรวจ type และ lint**

Run: `npx tsc --noEmit`
Expected: ไม่มี error

Run: `npm run lint`
Expected: ไม่มี error

- [ ] **Step 5: ทดสอบบน isolated dev server**

```bash
cp dev.db dev-test.db
NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001
```

เปิด `http://localhost:3001` ไปแท็บ **④ รายได้** แล้วตรวจ:
- แผง "4 สัปดาห์ล่าสุด" อยู่**เหนือ** การ์ด "ควรทำอะไรต่อ"
- มี 4 แถว แถวบนสุดมีป้าย "(นี้)"
- ตัวเลขทั้ง 3 คอลัมน์**ตรงกับผลสคริปต์ SQL จาก Task 1 Step 6** (เทียบทีละสัปดาห์)
- สัปดาห์ที่ไม่มีข้อมูลแสดง `0` และ `฿0` ไม่ใช่ช่องว่างหรือ `NaN`
- ส่วนอื่นของแท็บ ④ ไม่เพี้ยน (การ์ดเงิน, กราฟ, ราย-คลิป, เวลาโพสต์, ฟอร์มนำเข้า)
- Console ของเบราว์เซอร์ไม่มี error/hydration warning
- ย่อหน้าต่างให้แคบ — ตารางต้องเลื่อนแนวนอนในกล่องตัวเอง ไม่ดันหน้าเว็บให้เลื่อนทั้งหน้า

ปิด server แล้วลบไฟล์ทดสอบ: `rm -rf .next-dev dev-test.db`

- [ ] **Step 6: Commit**

```bash
git diff tsconfig.json   # ต้องว่าง ถ้าไม่ว่างให้ git checkout -- tsconfig.json
git add components/weekly-scoreboard.tsx components/dashboard-panel.tsx components/prompt-workspace.tsx
git commit -m "Show the last four weeks above the per-clip advice

Clip counts swing hard week to week (3, 23, 9), so a single week-over-week
delta reads as noise; four rows side by side show direction instead. The
panel reports measured facts only — no percentages, no verdict on whether a
week was good.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: แยกคำเตือนความสดข้อมูลตามไฟล์ + บันทึกวิธี export ลง CLAUDE.md

**Files:**
- Modify: `lib/dashboard.ts:176-179` (type `ReminderState`)
- Modify: `app/page.tsx:32-53`
- Modify: `components/reminder-banner.tsx:14-23, 46-48`
- Modify: `components/dashboard-panel.tsx:39-57, 205-222`
- Modify: `components/prompt-workspace.tsx` (prop `lastImportedAt` → 2 ค่า)
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `ClipMetric.importedAt` (มีอยู่แล้วใน schema ไม่ต้อง migrate)
- Produces: `ReminderState = { daysSinceOrdersImport: number | null; daysSinceMetricsImport: number | null; unmatchedSoldProducts: number }`

**บริบท:** ตอนนี้ `app/page.tsx:36` คำนวณความสดจาก `AffiliateOrder` อย่างเดียว → อัปแค่ไฟล์รายได้ก็รีเซ็ตคำเตือน ทั้งที่ข้อมูลวิวอาจเก่าหลายสัปดาห์ · **ไม่ติดตาม `FollowerActivity`** โดยตั้งใจ (เปลี่ยนช้า การเตือนจะกลายเป็น noise)

- [ ] **Step 1: ขยาย type ใน `lib/dashboard.ts`**

แทนที่บรรทัด 176-179:

```ts
export type ReminderState = {
  /** ไฟล์รายได้ (xlsx) — ตัววัดผลหลัก */
  daysSinceOrdersImport: number | null;
  /** ไฟล์วิวคลิป (Content.csv) — เดิมไม่ถูกติดตามเลย ทำให้เตือนผิดเมื่ออัปแค่ไฟล์เดียว */
  daysSinceMetricsImport: number | null;
  unmatchedSoldProducts: number;
};
```

- [ ] **Step 2: คำนวณเพิ่มใน `app/page.tsx`**

แทนที่บรรทัด 32-53 ทั้งบล็อก:

```tsx
  // reminder: ผ่านไปกี่วันจาก import ล่าสุด แยกรายไฟล์ —
  // ไฟล์รายได้กับไฟล์วิวถูกอัปคนละรอบได้ ถ้านับรวมเป็นค่าเดียวจะเตือนผิด
  let daysSinceOrdersImport: number | null = null;
  let lastOrdersImportedAt: Date | null = null;
  if (orders.length > 0) {
    const last = Math.max(...orders.map((o) => o.importedAt.getTime()));
    lastOrdersImportedAt = new Date(last);
    daysSinceOrdersImport = daysSince(last);
  }

  let daysSinceMetricsImport: number | null = null;
  let lastMetricsImportedAt: Date | null = null;
  if (clipMetrics.length > 0) {
    const last = Math.max(...clipMetrics.map((m) => m.importedAt.getTime()));
    lastMetricsImportedAt = new Date(last);
    daysSinceMetricsImport = daysSince(last);
  }

  // สินค้าที่ขายได้แต่ยังไม่มี entry (content id ที่จับคู่ไม่ได้)
  const unmatchedSoldProducts = new Set(
    orders.filter((o) => o.matchedEntryId === null).map((o) => o.contentId)
  ).size;

  const reminder: ReminderState = {
    daysSinceOrdersImport,
    daysSinceMetricsImport,
    unmatchedSoldProducts,
  };

  const reminderActive =
    (daysSinceOrdersImport !== null && daysSinceOrdersImport > IMPORT_STALE_DAYS) ||
    (daysSinceMetricsImport !== null && daysSinceMetricsImport > IMPORT_STALE_DAYS) ||
    unmatchedSoldProducts > 0;
```

แล้วแก้ props ที่ส่งลง `<PromptWorkspace>` (บรรทัด 64) จาก `lastImportedAt={lastImportedAt}` เป็น:

```tsx
      lastOrdersImportedAt={lastOrdersImportedAt}
      lastMetricsImportedAt={lastMetricsImportedAt}
```

- [ ] **Step 3: แก้ข้อความใน `components/reminder-banner.tsx`**

แทนที่ฟังก์ชัน `messages` (บรรทัด 14-23):

```tsx
function messages(r: ReminderState): string[] {
  const out: string[] = [];
  if (r.daysSinceOrdersImport !== null && r.daysSinceOrdersImport > IMPORT_STALE_DAYS) {
    out.push(`ไม่ได้นำเข้าข้อมูลรายได้มา ${r.daysSinceOrdersImport} วันแล้ว`);
  }
  if (r.daysSinceMetricsImport !== null && r.daysSinceMetricsImport > IMPORT_STALE_DAYS) {
    out.push(`ไม่ได้นำเข้าข้อมูลวิวมา ${r.daysSinceMetricsImport} วันแล้ว`);
  }
  if (r.unmatchedSoldProducts > 0) {
    out.push(`มี ${r.unmatchedSoldProducts} สินค้าที่ขายได้แต่ยังไม่มีในแอป`);
  }
  return out;
}
```

และแก้ signature (บรรทัด 48) ให้ครอบคลุมค่าที่เพิ่ม ไม่งั้น banner ที่เคยกดปิดจะไม่กลับมาแสดงเมื่อสถานะไฟล์วิวเปลี่ยน:

```tsx
  const signature = `${reminder.daysSinceOrdersImport}|${reminder.daysSinceMetricsImport}|${reminder.unmatchedSoldProducts}`;
```

- [ ] **Step 4: แก้บรรทัดสถานะใน `components/dashboard-panel.tsx`**

เปลี่ยน props ใน signature (บรรทัด 45 และ 54) จาก `lastImportedAt` เป็นสองตัว:

```tsx
  lastOrdersImportedAt,
  lastMetricsImportedAt,
```
```tsx
  lastOrdersImportedAt: Date | null;
  lastMetricsImportedAt: Date | null;
```

เพิ่ม helper ใต้ `thaiShortDate` (บรรทัด 35):

```tsx
/** บรรทัดสถานะของไฟล์นำเข้าหนึ่งไฟล์ — ไฟล์รายได้กับไฟล์วิวใช้ข้อความชุดเดียวกัน */
function ImportStatusLine({
  label,
  lastAt,
  days,
}: {
  label: string;
  lastAt: Date | null;
  days: number | null;
}) {
  if (lastAt === null || days === null) return null;
  if (days > IMPORT_STALE_DAYS) {
    return (
      <p className="font-mono text-[0.7rem] text-record">
        {label}: เกินกำหนดมา {days - IMPORT_STALE_DAYS} วัน — ไป export ไฟล์ใหม่จาก TikTok
        Studio ได้แล้ว (นำเข้าล่าสุด {thaiShortDate(lastAt)})
      </p>
    );
  }
  return (
    <p className="font-mono text-[0.7rem] text-muted-foreground">
      {label}: นำเข้าล่าสุด {thaiShortDate(lastAt)}{" "}
      {days === 0 ? "(วันนี้)" : `(${days} วันก่อน)`} · รอบถัดไป ~
      {thaiShortDate(new Date(lastAt.getTime() + IMPORT_STALE_DAYS * DAY_MS))}
    </p>
  );
}
```

แล้วแทนที่บล็อกบรรทัด 205-222 ทั้งก้อนด้วย:

```tsx
        {/* บรรทัดสถานะอยู่นอกส่วนที่พับเสมอ — พับหรือกางก็ต้องเห็น · แยกรายไฟล์เพราะ
            อัปไฟล์เดียวไม่ได้แปลว่าข้อมูลอีกไฟล์สดตามไปด้วย */}
        <ImportStatusLine
          label="รายได้"
          lastAt={lastOrdersImportedAt}
          days={reminder.daysSinceOrdersImport}
        />
        <ImportStatusLine
          label="วิวคลิป"
          lastAt={lastMetricsImportedAt}
          days={reminder.daysSinceMetricsImport}
        />
```

- [ ] **Step 5: ส่ง props ผ่าน `components/prompt-workspace.tsx`**

Run: `grep -n "lastImportedAt" components/prompt-workspace.tsx`
Expected: เจอ 3 จุด (destructure, type, ส่งต่อให้ `<DashboardPanel>`)

แก้ทั้ง 3 จุดให้เป็น `lastOrdersImportedAt` และ `lastMetricsImportedAt` (ชนิด `Date | null` ทั้งคู่)

- [ ] **Step 6: ตรวจ type และ lint**

Run: `npx tsc --noEmit`
Expected: ไม่มี error (ถ้ายังมี error ว่าไม่รู้จัก `daysSinceImport` แปลว่ามีจุดที่ยังอ่านชื่อเดิมอยู่ — ค้นด้วย `grep -rn "daysSinceImport\|lastImportedAt" app components lib` แล้วแก้ให้ครบ)

Run: `npm run lint`
Expected: ไม่มี error

- [ ] **Step 7: ทดสอบว่าคำเตือนแยกไฟล์จริง**

```bash
cp dev.db dev-test.db
```

ทำให้ข้อมูลวิวเก่าเกินกำหนดใน **dev-test.db เท่านั้น** (สคริปต์ `<scratch>/age-metrics.js` เขียนด้วย Write tool):

```js
const Database = require("C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt/node_modules/better-sqlite3");
const db = new Database("C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt/dev-test.db");
const info = db.prepare(`UPDATE ClipMetric SET importedAt = datetime('now', '-20 days')`).run();
console.log("aged rows:", info.changes);
```

Run: `node "<scratch>/age-metrics.js"` แล้วเปิด isolated dev server:

```bash
NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001
```

ตรวจในแท็บ ④:
- แถบเตือนด้านบนขึ้นข้อความ **"ไม่ได้นำเข้าข้อมูลวิวมา 20 วันแล้ว"** แต่**ไม่ขึ้น**ข้อความเรื่องข้อมูลรายได้ (เพราะไฟล์รายได้ยังสด)
- แท็บ ④ ในแถบแท็บมีจุดแดง
- ใต้ฟอร์มนำเข้าเห็น 2 บรรทัด: "รายได้: นำเข้าล่าสุด ... (วันนี้)" สีปกติ และ "วิวคลิป: เกินกำหนดมา 13 วัน ..." สีแดง
- กดปิดแถบเตือน แล้วรีเฟรช — ยังปิดอยู่ (signature ทำงาน)

ปิด server แล้วลบไฟล์ทดสอบ: `rm -rf .next-dev dev-test.db`

- [ ] **Step 8: บันทึกความรู้เรื่อง export ลง `CLAUDE.md`**

เพิ่มหัวข้อย่อยใต้หัวข้อ **"Dashboard รายได้ (แท็บ ④)"** (วางต่อจากบูลเล็ตที่พูดถึง `lib/csv.ts`):

```markdown
### ข้อจำกัดของไฟล์ที่ export จาก TikTok Studio (ตรวจจากไฟล์จริง 2026-07-26)

- **Content.csv ให้สูงสุด 15 แถวเสมอ** ไม่ว่าเลือกช่วง 7/28/60/365 วัน — เป็น "ท็อป N ตามวิว" ของช่วงนั้น ไม่ใช่คลิปทั้งหมด (ยืนยันแล้ว: ช่วง 60 วันได้ 15 แถวเรียงวิว 67,703→1,159 · ช่วง 7 วันได้ 15 แถวคนละชุด มีคลิปวิวต่ำถึง 321)
- **วิธีเลี่ยงเพดาน: export 2 ครั้งในวันเดียวกัน (ช่วง 7 วัน + ช่วง 365 วัน) แล้วอัปทั้งคู่** — `ClipMetric` unique ที่ `(videoId, capturedOn)` และ `capturedOn` มาจากคอลัมน์ `Time` (วันที่ export) ทั้งสองไฟล์จึงรวมเป็น snapshot เดียวที่ครอบคลุมกว่า (พิสูจน์แล้ว: 15+15 → 23 คลิปใน snapshot เดียว) · สัปดาห์ที่ลงคลิปเกิน ~12 ควร export กลางสัปดาห์เพิ่มอีกรอบ ไม่งั้นคลิปวิวน้อยหลุดเพดาน
- **ไฟล์รายได้ (xlsx) ให้เลือกช่วงกว้างที่สุดเสมอ** — `importAffiliateOrders` เป็น upsert by `orderId` ที่อัปเดตสถานะย้อนหลัง (รอ→ชำระแล้ว) ถ้าเลือกช่วงแคบ ออเดอร์เก่าที่เพิ่ง settle จะไม่ถูกอัปเดต ทำให้รายได้จริงต่ำกว่าความเป็นจริง
- **ผลข้างเคียงที่ต้องรู้เวลาอ่านสถิติ:** ตอนมีแต่ข้อมูลท็อป 15 ค่า median วิวของช่องอยู่ที่ 1,828 พอเติมคลิปวิวน้อยเข้าไปเหลือ 1,538 — `detectSignals` ใช้ median เป็นเกณฑ์ (`max(500, median*2)`) เกณฑ์จึงเคยตั้งสูงเกินจริง ยิ่งอัปครอบคลุมยิ่งแม่น
```

- [ ] **Step 9: Commit**

```bash
git diff tsconfig.json   # ต้องว่าง
git add lib/dashboard.ts app/page.tsx components/reminder-banner.tsx components/dashboard-panel.tsx components/prompt-workspace.tsx CLAUDE.md
git commit -m "Track import freshness per file

The reminder read only the affiliate orders file, so importing that alone
reset it while the view data quietly went weeks stale. ClipMetric already
carries importedAt, so this needs no migration.

Also records what the exported files actually contain: Content.csv caps at
15 rows per range, which is why two exports on the same day are unioned.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**ความครอบคลุมของ spec:**

| ข้อกำหนดใน spec | Task ที่ทำ |
|---|---|
| แผง 4 สัปดาห์ (คลิป/เงินที่ได้จริง/winner ใหม่) | Task 1 (ตรรกะ) + Task 2 (UI) |
| วางเหนือ `Recommendations` ใต้ `ReminderBanner` | Task 2 Step 3 |
| แถวปัจจุบันกำกับ "(นี้)" | Task 2 Step 2 |
| บรรทัด "ยังเร็วเกินสรุป" | Task 1 (`tooEarlyClips`) + Task 2 Step 2 |
| ไม่คิด % ไม่ตัดสินว่าดี/แย่ | ไม่มี task ไหนสร้าง — ตรวจซ้ำใน Task 2 Step 5 |
| `settledRevenue` นิยามเดียวกับ `summarizeOrders` | Task 1 Step 3 (คอมเมนต์กำกับไว้ในโค้ด) |
| `ReminderState` 3 ฟิลด์ + แยกคำเตือน | Task 3 Steps 1-5 |
| ไม่ติดตาม `FollowerActivity` | Task 3 (ไม่มี step ไหนเพิ่ม — ระบุไว้ในบริบท) |
| บันทึกวิธี export ลง CLAUDE.md | Task 3 Step 8 |
| ตรวจตัวเลขเทียบ SQL | Task 1 Step 6 + Task 2 Step 5 |
| เคสขอบวันจันทร์/อาทิตย์ | Task 1 Step 1 (fixture `a`, `b`, `c`) |
| สัปดาห์ว่างต้องเป็น 0 ไม่ใช่ NaN | Task 1 Step 1 (assert) + Task 2 Step 5 |

**สิ่งที่ spec ระบุว่าไม่ทำ และแผนนี้ไม่ได้ทำ:** แท็บใหม่ · ตารางใหม่ · AI · เควส · บทเรียน · ประตูข้อมูล · gamification · UI สอน export · การเตือนเรื่องจำนวนคลิปต่อสัปดาห์ ✓

**ความสอดคล้องของชื่อ/ชนิด:** `ScoreboardEntry`, `WeekRow`, `Scoreboard`, `buildWeeklyScoreboard`, `weekStartOfPostedAt`, `weekStartOfLocal` ใช้ชื่อเดียวกันทุกจุดใน Task 1-2 ✓ · `daysSinceOrdersImport` / `daysSinceMetricsImport` / `lastOrdersImportedAt` / `lastMetricsImportedAt` ใช้ชื่อเดียวกันทุกจุดใน Task 3 ✓ · `ReminderState` ที่ Task 3 เปลี่ยน ถูกอ้างใน `reminder-banner.tsx` และ `dashboard-panel.tsx` ซึ่งอยู่ในรายการไฟล์ที่แก้ครบแล้ว ✓
