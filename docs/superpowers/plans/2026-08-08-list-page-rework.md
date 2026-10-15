# List Page Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** รื้อหน้ารายการสินค้า (`/`) ให้ตัวกรองวันที่รวมเป็นปุ่มเดียวที่ไม่ขัดกันเอง แถวใหญ่ขึ้นพร้อมหัวคอลัมน์ และใช้กฎตัวอักษร/affordance จากโปรเจกต์ A ที่ merge ไปแล้ว

**Architecture:** แยกแถบตัวกรองทั้งหมดออกเป็น client component เดียว (`entry-filters.tsx`) ที่นำทางด้วย `router.push` ส่วน `entry-list.tsx` ยังเป็น server component ที่รับผิดชอบแค่หัวคอลัมน์/แถว/แบ่งหน้า · ตรรกะป้ายและช่วงวันที่แยกไปอยู่ `lib/date-filter-label.ts` ซึ่งเป็นฟังก์ชันบริสุทธิ์ล้วน คอมไพล์เดี่ยวแล้วทดสอบด้วย node ได้

**Tech Stack:** Next.js 16.2.10 (custom build) App Router, React 19, Tailwind v4 CSS-first, shadcn/ui บน `@base-ui/react`, `react-day-picker` v10

**Spec:** `docs/superpowers/specs/2026-08-08-list-page-rework-design.md`

## Global Constraints

- **ห้ามรัน `npm run build` หรือ `npm run dev` บน `.next` โฟลเดอร์หลัก** — ผู้ใช้รัน `start.bat` ที่ port 3000 อยู่ทุกวันและใช้ทำมาหากิน ใช้ `npx tsc --noEmit` + `npm run lint` แทน · ถ้าต้องดู UI จริง: `cp dev.db dev-test.db` แล้ว `NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001`
- **cleanup หลังใช้ dev server ทุกครั้ง:** `netstat -ano | grep ':3001' | grep LISTENING` แล้ว `taskkill //PID <pid> //F` (double-slash บังคับบน git-bash เครื่องนี้) + `rm -f dev-test.db` + `rm -rf .next-dev`
- **`git diff tsconfig.json` ต้องว่างก่อน commit ทุกครั้ง** — dev server auto-patch ได้ ถ้าเปลี่ยนให้ `git checkout -- tsconfig.json`
- **ห้าม `git add -A`** — ระบุไฟล์ที่ commit เสมอ
- **ห้าม emoji** ในโค้ด คอมเมนต์ commit message และ UI
- **UI ทุกข้อความเป็นภาษาไทย**
- **ห้ามใช้ขนาดตัวอักษร arbitrary** (`text-[0.65rem]`) — ใช้ `text-xs`(12px พื้นต่ำสุด)/`sm`/`base`/`lg`/`xl` เท่านั้น
- **ห้ามใส่ hex สีในไฟล์ `components/*`** — ใช้ semantic token
- **ห้ามใช้ชื่อ alias สีเก่า** (`teal`/`paper`/`ink`/`smoke`/`amber`/`danger`) ในโค้ดใหม่
- **ห้าม `font-mono` กับข้อความไทย** — ใช้กับตัวเลข/วันที่เท่านั้น
- **ห้าม `tracking-widest` หรือ `uppercase` กับข้อความไทย**
- **ปุ่มสูงขั้นต่ำ 36px (`h-9`) · เป้าคลิกไอคอนขั้นต่ำ 24x24px**
- **ห้ามแตะตรรกะกรอง/ค้นหา/เรียง:** `lib/entry-rows.ts`, `lib/entry-date-filter.ts`, `lib/entry-sort.ts`, `lib/entry-search.ts` ห้ามแก้แม้แต่บรรทัดเดียว
- **URL parameter ต้องคงเดิมทุกตัว:** `?q=&status=&from=&to=&by=&page=` — บุ๊กมาร์กเก่าต้องยังทำงาน
- branch: `feature/list-page-rework` (สร้างแล้ว) — ห้าม merge เข้า master เอง

---

## หมายเหตุการเบี่ยงจากสเปก 1 จุด (ตั้งใจ ต้องอ่านก่อนเริ่ม)

สเปกหัวข้อ 5.3 เขียนกลไกไว้ว่า "ตัวกรองทั้งหมดอยู่ใน `<form method="get">` ก้อนเดียว กดแล้ว submit" — **แผนนี้ใช้ `router.push()` แทน** ด้วยเหตุผลทางเทคนิค 2 ข้อที่ค้นพบตอนอ่านโค้ดจริง:

1. **`PopoverContent` ของ `@base-ui/react` render ผ่าน Portal** (ยืนยันที่ `components/ui/popover.tsx:31` — `<PopoverPrimitive.Portal>`) ปุ่มในเมนูจึงไม่ได้อยู่ใน `<form>` ตาม DOM สั่ง submit จากตรงนั้นไม่ได้ตรงๆ
2. **ถ้าใช้ hidden input + `setState` แล้ว submit จะเกิด race** — React อัปเดต state แบบ async ค่าใน hidden input ยังเป็นค่าเก่าตอน submit

**พฤติกรรมที่ผู้ใช้เห็นยังตรงตามสเปกทุกข้อ:** กดแล้วมีผลทันที · คำค้นหาที่พิมพ์ค้างถูกพาไปด้วย (อ่านจาก ref ของ input ตอนกด) · URL parameter ชุดเดิม · ปุ่มย้อนกลับเบราว์เซอร์ทำงาน (`router.push` สร้าง history entry) · เลือกตัวกรองแล้วกลับหน้า 1 (ไม่ใส่ `page` ใน URL ใหม่)

---

## File Structure

| ไฟล์ | หน้าที่ | Task |
|---|---|---|
| `lib/date-filter-label.ts` | **สร้างใหม่** — ฟังก์ชันบริสุทธิ์: คีย์วันที่, ช่วงสำเร็จรูป, จับคู่ช่วงปัจจุบัน, ป้ายบนปุ่ม | 1 |
| `components/entry-filters.tsx` | **สร้างใหม่** — client component: ช่องค้นหา + กลุ่มปุ่มสถานะ + เมนูวันที่ ทั้งหมดในที่เดียว | 2 |
| `components/entry-list.tsx` | **เขียนใหม่** — server component: หัวคอลัมน์ + แถว + แบ่งหน้า + สถานะว่าง | 3 |
| `app/page.tsx` | ตัด `getEntrySales` และ prop `sales` | 4 |
| `lib/entry-queries.ts` | ลบ `getEntrySales()` และ import ที่ตายตาม | 4 |
| `lib/entry-sales.ts` | **ลบทั้งไฟล์** | 4 |
| `components/date-range-fields.tsx` | **ลบทั้งไฟล์** | 4 |
| `components/{clip-thumbnail,reminder-banner,entry-workspace}.tsx` | เก็บกวาด alias สีเก่า 4 บรรทัด | 4 |

---

### Task 1: ตรรกะวันที่ที่ทดสอบได้

**Files:**
- Create: `lib/date-filter-label.ts`

**Interfaces:**
- Consumes: ไม่มี (task แรก ไม่ import อะไรเลย)
- Produces: `type QuickRangeId = "all" | "today" | "7d" | "30d" | "custom"` · `QUICK_RANGES: { id: "today"|"7d"|"30d"; label: string; days: number }[]` · `toDateKey(date: Date): string` · `fromDateKey(key: string): Date | undefined` · `todayKey(now?: Date): string` · `daysAgoKey(days: number, now?: Date): string` · `matchQuickRange(from: string | null, to: string | null, now?: Date): QuickRangeId` · `formatDateFilterLabel(from: string | null, to: string | null, now?: Date): string`

- [ ] **Step 1: เขียนไฟล์ `lib/date-filter-label.ts`**

```ts
/**
 * ตรรกะตัวกรองวันที่ของหน้ารายการ — แยกจากคอมโพเนนต์เพราะเป็นฟังก์ชันบริสุทธิ์ล้วน
 * ไม่ import อะไรเลย จึงคอมไพล์เดี่ยวแล้วทดสอบด้วย node ได้ (โปรเจกต์ไม่มี test runner)
 *
 * ทุกฟังก์ชันที่นี่อ่านเวลาปัจจุบันด้วย local getter เสมอ เพราะ new Date() คือ timestamp จริง
 * ไม่ใช่ค่าที่เข้ารหัสเป็น UTC midnight แบบ postedAt ที่เก็บใน DB — การตีความสตริง
 * "YYYY-MM-DD" ต่างกันตามฐานวันที่เป็นหน้าที่ของ lib/entry-date-filter.ts ไม่ใช่ที่นี่
 * (บั๊กคลาสนี้เคยเกิดมาแล้วตอน todayKey/daysAgoKey อยู่ใน entry-list.tsx และทำให้
 * ปุ่มช่วงวันที่เลื่อนไป 1 วันในช่วงเที่ยงคืนถึง 7 โมงเช้าเวลาไทย)
 *
 * ทุกฟังก์ชันรับ now เข้ามาได้เพื่อให้ทดสอบแบบกำหนดเวลาเองได้ ค่าปริยายคือเวลาจริง
 */

export type QuickRangeId = "all" | "today" | "7d" | "30d" | "custom";

/** ช่วงสำเร็จรูปในเมนู — days คือจำนวนวันที่ถอยหลังจากวันนี้ (0 = วันนี้วันเดียว) */
export const QUICK_RANGES: {
  id: "today" | "7d" | "30d";
  label: string;
  days: number;
}[] = [
  { id: "today", label: "วันนี้", days: 0 },
  { id: "7d", label: "7 วันล่าสุด", days: 6 },
  { id: "30d", label: "30 วันล่าสุด", days: 29 },
];

/** Date -> "YYYY-MM-DD" ตามปฏิทินท้องถิ่น */
export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** "YYYY-MM-DD" -> Date เที่ยงคืนตามเวลาท้องถิ่น (undefined ถ้ารูปแบบไม่ถูก) */
export function fromDateKey(key: string): Date | undefined {
  if (!key) return undefined;
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}

export function todayKey(now: Date = new Date()): string {
  return toDateKey(now);
}

export function daysAgoKey(days: number, now: Date = new Date()): string {
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  base.setTime(base.getTime() - days * 86400000);
  return toDateKey(base);
}

/**
 * ช่วงที่กรองอยู่ตรงกับปุ่มสำเร็จรูปตัวไหน
 * ไม่ตรงตัวไหนเลยแต่มีค่าอยู่ = "custom" · ไม่มีค่าเลย = "all"
 */
export function matchQuickRange(
  from: string | null,
  to: string | null,
  now: Date = new Date()
): QuickRangeId {
  if (from === null && to === null) return "all";
  if (to === todayKey(now)) {
    for (const range of QUICK_RANGES) {
      if (from === daysAgoKey(range.days, now)) return range.id;
    }
  }
  return "custom";
}

const THAI_MONTHS = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];

/** "2026-08-05" -> "5 ส.ค." — ไม่ใส่ปีเพราะป้ายบนปุ่มต้องสั้นพอไม่ดันปุ่มข้างๆ */
function shortThaiDate(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return key;
  return `${d} ${THAI_MONTHS[m - 1]}`;
}

/**
 * ข้อความบนปุ่มตัวกรองวันที่
 * ตอนไม่ได้กรองคืนชื่อหมวด ("วันที่") ไม่ใช่ค่า เพื่อไม่ให้ซ้ำกับตัวเลือก "ทั้งหมด"
 * ของตัวกรองสถานะที่อยู่ข้างกันบนหน้าจอเดียวกัน
 */
export function formatDateFilterLabel(
  from: string | null,
  to: string | null,
  now: Date = new Date()
): string {
  const matched = matchQuickRange(from, to, now);
  if (matched === "all") return "วันที่";
  const quick = QUICK_RANGES.find((r) => r.id === matched);
  if (quick) return quick.label;
  if (from !== null && to !== null) {
    return `${shortThaiDate(from)} - ${shortThaiDate(to)}`;
  }
  if (from !== null) return `ตั้งแต่ ${shortThaiDate(from)}`;
  return `ถึง ${shortThaiDate(to as string)}`;
}
```

- [ ] **Step 2: เขียนสคริปต์ทดสอบใน scratch dir**

สร้าง `<SCRATCH>/test-date-filter-label.js` โดย `<SCRATCH>` คือ `C:/Users/patip/AppData/Local/Temp/claude/C--Users-patip-Desktop-playground-tts-assistant-pooling-pooling-prompt/<session>/scratchpad` (ถ้าไม่มีให้ใช้โฟลเดอร์ temp ใดก็ได้นอก repo):

```js
const {
  toDateKey,
  fromDateKey,
  todayKey,
  daysAgoKey,
  matchQuickRange,
  formatDateFilterLabel,
} = require("./date-filter-label.js");

let failed = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}\n      ได้ ${JSON.stringify(actual)} ควรได้ ${JSON.stringify(expected)}`);
}

// เวลาอ้างอิง: 8 ส.ค. 2026 เวลา 14:00 ตามเวลาท้องถิ่น
const NOON = new Date(2026, 7, 8, 14, 0, 0);
// เวลาตี 1 ครึ่ง — ถ้าเผลอใช้ UTC getter จะได้วันที่ 7 ส.ค. แทน 8 ส.ค. (บั๊กที่เคยเกิดจริง)
const EARLY = new Date(2026, 7, 8, 1, 30, 0);

check("toDateKey เติมศูนย์หน้าเลขเดือน/วัน", toDateKey(new Date(2026, 0, 5)), "2026-01-05");
check("fromDateKey คืน Date ท้องถิ่น", toDateKey(fromDateKey("2026-08-05")), "2026-08-05");
check("fromDateKey สตริงว่างคืน undefined", fromDateKey(""), undefined);
check("fromDateKey สตริงพังคืน undefined", fromDateKey("ไม่ใช่วันที่"), undefined);

check("todayKey ตอนบ่าย", todayKey(NOON), "2026-08-08");
check("todayKey ตอนตี 1 ครึ่ง ต้องยังเป็นวันเดียวกัน", todayKey(EARLY), "2026-08-08");
check("daysAgoKey 0 วัน = วันนี้", daysAgoKey(0, NOON), "2026-08-08");
check("daysAgoKey 6 วัน", daysAgoKey(6, NOON), "2026-08-02");
check("daysAgoKey 29 วัน ข้ามเดือน", daysAgoKey(29, NOON), "2026-07-10");
check("daysAgoKey ตอนตี 1 ครึ่งต้องไม่เลื่อน", daysAgoKey(6, EARLY), "2026-08-02");

check("matchQuickRange ไม่มีค่า = all", matchQuickRange(null, null, NOON), "all");
check("matchQuickRange วันนี้", matchQuickRange("2026-08-08", "2026-08-08", NOON), "today");
check("matchQuickRange 7 วัน", matchQuickRange("2026-08-02", "2026-08-08", NOON), "7d");
check("matchQuickRange 30 วัน", matchQuickRange("2026-07-10", "2026-08-08", NOON), "30d");
check("matchQuickRange ช่วงเอง", matchQuickRange("2026-08-01", "2026-08-05", NOON), "custom");
check("matchQuickRange ถึงวันนี้แต่ต้นทางไม่ตรงปุ่มไหน", matchQuickRange("2026-08-04", "2026-08-08", NOON), "custom");
check("matchQuickRange มีแค่ from", matchQuickRange("2026-08-01", null, NOON), "custom");
check("matchQuickRange มีแค่ to", matchQuickRange(null, "2026-08-05", NOON), "custom");

check("label ไม่ได้กรอง", formatDateFilterLabel(null, null, NOON), "วันที่");
check("label วันนี้", formatDateFilterLabel("2026-08-08", "2026-08-08", NOON), "วันนี้");
check("label 7 วัน", formatDateFilterLabel("2026-08-02", "2026-08-08", NOON), "7 วันล่าสุด");
check("label 30 วัน", formatDateFilterLabel("2026-07-10", "2026-08-08", NOON), "30 วันล่าสุด");
check("label ช่วงเองสองด้าน", formatDateFilterLabel("2026-08-05", "2026-08-20", NOON), "5 ส.ค. - 20 ส.ค.");
check("label เฉพาะ from", formatDateFilterLabel("2026-08-05", null, NOON), "ตั้งแต่ 5 ส.ค.");
check("label เฉพาะ to", formatDateFilterLabel(null, "2026-08-20", NOON), "ถึง 20 ส.ค.");
check("label ตอนตี 1 ครึ่งยังจับ 7 วันได้", formatDateFilterLabel("2026-08-02", "2026-08-08", EARLY), "7 วันล่าสุด");

console.log(failed === 0 ? "\nผ่านทุกเคส" : `\nตก ${failed} เคส`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 3: รันเทสต์ให้ fail ก่อน (ยังไม่ได้คอมไพล์)**

Run: `node <SCRATCH>/test-date-filter-label.js`
Expected: FAIL — `Cannot find module './date-filter-label.js'`

- [ ] **Step 4: คอมไพล์แล้วรันให้ผ่าน**

ไฟล์นี้ไม่ import อะไรเลย จึงคอมไพล์เดี่ยวได้ ไม่ต้องใช้ alias hook:

```bash
npx tsc lib/date-filter-label.ts --outDir "<SCRATCH>" --module commonjs --target ES2017
node "<SCRATCH>/test-date-filter-label.js"
```
Expected: PASS ทุกบรรทัด ปิดท้าย `ผ่านทุกเคส` exit code 0

- [ ] **Step 5: ตรวจ type และ lint**

Run: `npx tsc --noEmit` แล้ว `npm run lint`
Expected: สะอาดทั้งคู่ (ไฟล์ใหม่ยังไม่มีใครเรียก แต่ต้องไม่มี type error ในตัวมันเอง)

- [ ] **Step 6: Commit**

```bash
git add lib/date-filter-label.ts
git commit -m "Add pure date-filter label and quick-range logic"
```

---

### Task 2: แถบตัวกรอง (client component)

**Files:**
- Create: `components/entry-filters.tsx`

**Interfaces:**
- Consumes: จาก Task 1 — `QUICK_RANGES`, `toDateKey`, `fromDateKey`, `todayKey`, `daysAgoKey`, `matchQuickRange`, `formatDateFilterLabel`, `type QuickRangeId`
- Produces: `export function EntryFilters(props: { query: string; status: EntryStatus | "all"; from: string | null; to: string | null; by: DateFilterBasis; matchCount: number; total: number }): JSX.Element` — Task 3 เรียกใช้ตัวนี้ตัวเดียว ไม่มี prop อื่น

- [ ] **Step 1: เขียนไฟล์ `components/entry-filters.tsx`**

```tsx
"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, Plus, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  QUICK_RANGES,
  formatDateFilterLabel,
  fromDateKey,
  matchQuickRange,
  toDateKey,
  todayKey,
  daysAgoKey,
  type QuickRangeId,
} from "@/lib/date-filter-label";
import type { EntryStatus } from "@/lib/entry-rows";
import type { DateFilterBasis } from "@/lib/entry-date-filter";

const STATUS_FILTERS: { value: EntryStatus | "all"; label: string }[] = [
  { value: "all", label: "ทั้งหมด" },
  { value: "no-prompt", label: "ยังไม่มี prompt" },
  { value: "awaiting-clip", label: "รอลงคลิป" },
  { value: "posted", label: "ลงแล้ว" },
];

/**
 * แถบตัวกรองทั้งหมดของหน้ารายการ (ค้นหา + สถานะ + วันที่) รวมอยู่ที่เดียว
 *
 * นำทางด้วย router.push ไม่ใช่ form GET โดยตั้งใจ เพราะ PopoverContent ของ base-ui
 * render ผ่าน Portal (components/ui/popover.tsx) ปุ่มในเมนูจึงไม่ได้อยู่ใน <form> ตาม DOM
 * และการใช้ hidden input + setState แล้ว submit จะเกิด race เพราะ state อัปเดตแบบ async
 *
 * ผลที่ผู้ใช้เห็นเหมือนกัน: กดแล้วมีผลทันที · คำค้นหาที่พิมพ์ค้างถูกพาไปด้วย (อ่านจาก ref)
 * · URL parameter ชุดเดิม · ปุ่มย้อนกลับของเบราว์เซอร์ทำงาน
 */
export function EntryFilters({
  query,
  status,
  from,
  to,
  by,
  matchCount,
  total,
}: {
  query: string;
  status: EntryStatus | "all";
  from: string | null;
  to: string | null;
  by: DateFilterBasis;
  matchCount: number;
  total: number;
}) {
  const router = useRouter();
  const queryRef = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const selected = matchQuickRange(from, to);
  const [customFrom, setCustomFrom] = useState(from ?? "");
  const [customTo, setCustomTo] = useState(to ?? "");
  const [showCustom, setShowCustom] = useState(selected === "custom");

  const isFiltering =
    query.trim() !== "" || status !== "all" || from !== null || to !== null;

  /**
   * ประกอบ URL ใหม่จากค่าปัจจุบัน แล้วทับด้วย overrides
   * ไม่ใส่ page ลงไปเลย จึงกลับหน้า 1 ทุกครั้งที่เปลี่ยนตัวกรอง ซึ่งเป็นพฤติกรรมที่ถูก
   * คำค้นหาอ่านจาก ref ไม่ใช่ prop เพื่อให้คำที่พิมพ์ค้างแต่ยังไม่กดค้นหาไม่หายไป
   */
  function pushWith(overrides: {
    status?: EntryStatus | "all";
    from?: string | null;
    to?: string | null;
    by?: DateFilterBasis;
  }) {
    const nextQuery = queryRef.current?.value ?? query;
    const nextStatus = overrides.status ?? status;
    const nextFrom = overrides.from !== undefined ? overrides.from : from;
    const nextTo = overrides.to !== undefined ? overrides.to : to;
    const nextBy = overrides.by ?? by;

    const sp = new URLSearchParams();
    if (nextQuery.trim() !== "") sp.set("q", nextQuery.trim());
    if (nextStatus !== "all") sp.set("status", nextStatus);
    if (nextFrom !== null && nextFrom !== "") sp.set("from", nextFrom);
    if (nextTo !== null && nextTo !== "") sp.set("to", nextTo);
    if (nextBy === "created") sp.set("by", nextBy);

    const qs = sp.toString();
    router.push(qs === "" ? "/" : `/?${qs}`);
  }

  function applyQuickRange(id: QuickRangeId) {
    if (id === "all") {
      setShowCustom(false);
      setMenuOpen(false);
      pushWith({ from: null, to: null });
      return;
    }
    if (id === "custom") {
      // เลือก "กำหนดเอง" แค่เปิดปฏิทินให้กรอก ยังไม่กรองจนกว่าจะกด "ใช้ช่วงนี้"
      setShowCustom(true);
      return;
    }
    const range = QUICK_RANGES.find((r) => r.id === id);
    if (!range) return;
    setShowCustom(false);
    setMenuOpen(false);
    pushWith({ from: daysAgoKey(range.days), to: todayKey() });
  }

  function applyCustomRange() {
    if (customFrom === "" && customTo === "") return;
    setMenuOpen(false);
    pushWith({ from: customFrom || null, to: customTo || null });
  }

  const dateLabel = formatDateFilterLabel(from, to);
  const dateActive = from !== null || to !== null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            pushWith({});
          }}
        >
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={queryRef}
              name="q"
              defaultValue={query}
              placeholder="ค้นหาสินค้า"
              aria-label="ค้นหาสินค้า"
              className="w-64 pl-9"
            />
          </div>
          <Button type="submit" variant="outline">
            ค้นหา
          </Button>
        </form>

        <Button render={<Link href="/entry/new" />} nativeButton={false}>
          <Plus className="size-4" />
          สินค้าใหม่
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {/* กลุ่มตัวเลือก: กรอบรวมรอบทั้งกลุ่มเป็นตัวบอกว่าทั้งแถวกดได้
            ตัวที่ไม่ได้เลือกจึงไม่ต้องมีขอบของตัวเอง (กฎ affordance จากโปรเจกต์ A) */}
        <div
          className="inline-flex flex-wrap gap-1 rounded-lg border border-border-interactive p-1"
          role="group"
          aria-label="กรองตามสถานะ"
        >
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              aria-current={status === filter.value ? "true" : undefined}
              onClick={() => pushWith({ status: filter.value })}
              className={cn(
                "inline-flex h-9 items-center rounded-md px-3 text-sm font-medium transition-colors",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                status === filter.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>

        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger
            render={
              <Button
                type="button"
                variant="outline"
                aria-label="ตัวกรองวันที่"
                className={cn(dateActive && "border-primary bg-muted")}
              />
            }
          >
            <CalendarDays className="size-4" />
            {dateLabel}
          </PopoverTrigger>

          <PopoverContent align="start" className="w-auto min-w-64 gap-3 p-3">
            <div className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => applyQuickRange("all")}
                className={cn(
                  "inline-flex h-9 items-center rounded-md px-3 text-sm transition-colors",
                  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  selected === "all"
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                )}
              >
                ทั้งหมด
              </button>
              {QUICK_RANGES.map((range) => (
                <button
                  key={range.id}
                  type="button"
                  onClick={() => applyQuickRange(range.id)}
                  className={cn(
                    "inline-flex h-9 items-center rounded-md px-3 text-sm transition-colors",
                    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    selected === range.id
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted"
                  )}
                >
                  {range.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => applyQuickRange("custom")}
                aria-expanded={showCustom}
                className={cn(
                  "inline-flex h-9 items-center rounded-md px-3 text-sm transition-colors",
                  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  selected === "custom" && !showCustom
                    ? "bg-primary text-primary-foreground"
                    : showCustom
                      ? "bg-muted"
                      : "hover:bg-muted"
                )}
              >
                กำหนดเอง
              </button>
            </div>

            {showCustom && (
              <div className="flex flex-col gap-2 border-t border-border pt-3">
                <Calendar
                  mode="range"
                  numberOfMonths={1}
                  selected={{
                    from: fromDateKey(customFrom),
                    to: fromDateKey(customTo),
                  }}
                  onSelect={(range) => {
                    setCustomFrom(range?.from ? toDateKey(range.from) : "");
                    setCustomTo(range?.to ? toDateKey(range.to) : "");
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={applyCustomRange}
                  disabled={customFrom === "" && customTo === ""}
                  className="self-end"
                >
                  ใช้ช่วงนี้
                </Button>
              </div>
            )}

            {/* ฐานวันที่เป็นส่วนหนึ่งของการตั้งค่าวันที่ ไม่ใช่ตัวกรองแยก จึงอยู่ในเมนูนี้ */}
            <div className="flex items-center gap-2 border-t border-border pt-3">
              <span className="text-xs text-muted-foreground">นับจาก</span>
              <div
                className="inline-flex gap-1 rounded-lg border border-border-interactive p-1"
                role="group"
                aria-label="นับจากวันที่"
              >
                <button
                  type="button"
                  aria-current={by === "posted" ? "true" : undefined}
                  onClick={() => {
                    setMenuOpen(false);
                    pushWith({ by: "posted" });
                  }}
                  className={cn(
                    "inline-flex h-9 items-center rounded-md px-3 text-sm transition-colors",
                    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    by === "posted"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  ลงคลิป
                </button>
                <button
                  type="button"
                  aria-current={by === "created" ? "true" : undefined}
                  onClick={() => {
                    setMenuOpen(false);
                    pushWith({ by: "created" });
                  }}
                  className={cn(
                    "inline-flex h-9 items-center rounded-md px-3 text-sm transition-colors",
                    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    by === "created"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  สร้าง
                </button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        {isFiltering
          ? `พบ ${matchCount} จาก ${total} รายการ`
          : `ทั้งหมด ${total} รายการ`}
        {isFiltering && (
          <Link href="/" className="text-primary hover:underline">
            ล้างตัวกรองทั้งหมด
          </Link>
        )}
      </p>
    </div>
  );
}
```

- [ ] **Step 2: ตรวจว่า `Input` ส่ง ref ผ่านได้**

Run: `grep -n "ref\|ComponentProps" components/ui/input.tsx`
Expected: เห็น `React.ComponentProps<"input">` — ใน React 19 `ref` เป็น prop ปกติของ function component แล้ว จึงส่งผ่านได้โดยไม่ต้อง `forwardRef`
**ถ้า `npx tsc --noEmit` ใน Step 3 ฟ้องเรื่อง `ref`** ให้แก้ที่ `components/ui/input.tsx` โดยเพิ่ม `ref` เข้า destructure และส่งต่อไปยัง `<input>` — ห้ามใช้ `as any` กลบ

- [ ] **Step 3: ตรวจ type และ lint**

Run: `npx tsc --noEmit` แล้ว `npm run lint`
Expected: สะอาดทั้งคู่ (คอมโพเนนต์ยังไม่มีใครเรียก แต่ต้องคอมไพล์ผ่าน)

- [ ] **Step 4: Commit**

```bash
git add components/entry-filters.tsx
git commit -m "Add unified filter bar with single date-range menu"
```

---

### Task 3: เขียน entry-list.tsx ใหม่

**Files:**
- Modify: `components/entry-list.tsx` (เขียนใหม่ทั้งไฟล์)

**Interfaces:**
- Consumes: `EntryFilters` จาก Task 2 · `EntryRow`, `EntryStatus` จาก `@/lib/entry-rows` · `DateFilterBasis` จาก `@/lib/entry-date-filter`
- Produces: `export function EntryList(props: { rows: EntryRow[]; query: string; status: EntryStatus | "all"; from: string | null; to: string | null; by: DateFilterBasis; page: number; totalPages: number; matchCount: number; total: number }): JSX.Element` — **prop `sales` ถูกตัดออกจาก signature** Task 4 ต้องแก้ `app/page.tsx` ให้เลิกส่ง

- [ ] **Step 1: เขียน `components/entry-list.tsx` ใหม่ทั้งไฟล์**

```tsx
import Link from "next/link";
import { Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EntryFilters } from "@/components/entry-filters";
import type { EntryRow, EntryStatus } from "@/lib/entry-rows";
import type { DateFilterBasis } from "@/lib/entry-date-filter";

const STATUS_LABEL: Record<EntryStatus, string> = {
  "no-prompt": "ยังไม่มี prompt",
  "awaiting-clip": "รอลงคลิป",
  posted: "ลงแล้ว",
};

const STATUS_BADGE_VARIANT: Record<EntryStatus, "success" | "warning" | "neutral"> = {
  "no-prompt": "neutral",
  "awaiting-clip": "warning",
  posted: "success",
};

/** "12 ก.ค. 2026" — postedAt เก็บเป็น UTC midnight จึงต้องอ่านด้วย timeZone UTC */
function postedLabel(postedAt: Date | null): string | null {
  if (!postedAt) return null;
  return new Date(postedAt).toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** createdAt เป็น timestamp จริง อ่านด้วย local getter — ห้ามใช้ตัวเดียวกับ postedLabel */
function createdLabel(createdAt: Date): string {
  return new Date(createdAt).toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function buildPageHref(params: {
  query: string;
  status: EntryStatus | "all";
  from: string | null;
  to: string | null;
  by: DateFilterBasis;
  page: number;
}): string {
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

export function EntryList({
  rows,
  query,
  status,
  from,
  to,
  by,
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
  by: DateFilterBasis;
  page: number;
  totalPages: number;
  matchCount: number;
  total: number;
}) {
  // หัวคอลัมน์ที่ 4 และค่าในแถวต้องมาจากฐานเดียวกันเสมอ ไม่งั้นอ่านแล้วไม่รู้ว่าคอลัมน์นี้คืออะไร
  const dateColumnLabel = by === "created" ? "วันที่สร้าง" : "วันที่ลงคลิป";

  return (
    <div className="flex flex-col gap-4">
      <EntryFilters
        query={query}
        status={status}
        from={from}
        to={to}
        by={by}
        matchCount={matchCount}
        total={total}
      />

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-4 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            {total === 0
              ? "ยังไม่มีรายการ"
              : query.trim() !== ""
                ? "ไม่พบรายการ — ลองใช้คำที่สั้นลงหรือน้อยคำลง"
                : "ไม่พบรายการ — ลองปรับช่วงวันที่หรือตัวกรองสถานะ"}
          </p>
          {total === 0 && (
            <Button render={<Link href="/entry/new" />} nativeButton={false} size="sm">
              <Plus className="size-4" />
              เพิ่มสินค้าแรก
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-col">
          {/* หัวคอลัมน์ไม่ใช่แถวที่กดได้ — ไม่มีการเรียงลำดับตามคอลัมน์
              การเรียงยังเป็นแบบเดิมจาก lib/entry-sort.ts (ยังไม่ลงคลิปอยู่บนสุด แล้วใหม่ไปเก่า) */}
          <div
            className="flex items-center gap-4 border-b border-border px-4 pb-2 text-xs text-muted-foreground"
            aria-hidden="true"
          >
            <span className="w-20 shrink-0">รูป</span>
            <span className="flex-1">สินค้า</span>
            <span className="w-32 shrink-0">สถานะ</span>
            <span className="w-24 shrink-0 text-right">{dateColumnLabel}</span>
          </div>

          <ul className="flex flex-col gap-2 pt-2">
            {rows.map((row) => (
              <li key={row.id}>
                <Link
                  href={`/entry/${row.id}`}
                  className="flex items-center gap-4 rounded-lg border border-border bg-surface p-3 transition-colors hover:border-border-interactive"
                >
                  {row.thumbnailFilename ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/uploads/${row.id}/${row.thumbnailFilename}`}
                      alt=""
                      loading="lazy"
                      className="size-20 shrink-0 rounded-lg border border-border object-cover"
                    />
                  ) : (
                    <span className="size-20 shrink-0 rounded-lg border border-dashed border-border" />
                  )}

                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <p className="truncate text-lg font-bold">{row.productName}</p>
                    {row.angle !== "" && (
                      <p className="line-clamp-1 text-sm text-muted-foreground">
                        angle: {row.angle}
                      </p>
                    )}
                  </div>

                  <div className="w-32 shrink-0">
                    <Badge variant={STATUS_BADGE_VARIANT[row.status]}>
                      {STATUS_LABEL[row.status]}
                    </Badge>
                  </div>

                  <div className="w-24 shrink-0 text-right">
                    <span className="font-mono text-sm">
                      {by === "created"
                        ? createdLabel(row.createdAt)
                        : (postedLabel(row.postedAt) ?? "-")}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {totalPages > 1 && (
        <nav className="flex items-center justify-center gap-3" aria-label="แบ่งหน้า">
          {page > 1 && (
            <Button
              render={
                <Link
                  href={buildPageHref({ query, status, from, to, by, page: page - 1 })}
                />
              }
              nativeButton={false}
              variant="outline"
              size="sm"
            >
              ก่อนหน้า
            </Button>
          )}
          <span className="text-sm text-muted-foreground">
            หน้า <span className="font-mono">{page}</span> จาก{" "}
            <span className="font-mono">{totalPages}</span>
          </span>
          {page < totalPages && (
            <Button
              render={
                <Link
                  href={buildPageHref({ query, status, from, to, by, page: page + 1 })}
                />
              }
              nativeButton={false}
              variant="outline"
              size="sm"
            >
              ถัดไป
            </Button>
          )}
        </nav>
      )}
    </div>
  );
}
```

**หมายเหตุที่ต้องสังเกต:** คอลัมน์วันที่ตอนฐานเป็น `posted` แล้วยังไม่ได้ลงคลิปจะแสดง `-` (ขีด) ไม่ใช่วันที่สร้างแบบเดิม เพราะหัวคอลัมน์บอกว่า "วันที่ลงคลิป" การเอาวันที่สร้างมาใส่ในคอลัมน์นั้นคือการโกหกหัวคอลัมน์

- [ ] **Step 2: ตรวจ type และ lint**

Run: `npx tsc --noEmit` แล้ว `npm run lint`
Expected: **จะ FAIL ที่ `app/page.tsx`** เพราะยังส่ง prop `sales` ที่ถูกตัดออกแล้ว — นี่คือสิ่งที่คาดไว้ Task 4 จะแก้ · ต้องไม่มี error อื่นนอกจากเรื่อง `sales`

- [ ] **Step 3: ตรวจว่าไม่เหลือของต้องห้ามในไฟล์นี้**

```bash
grep -n "text-\[\|-teal\|-paper\|-ink\|-smoke\|-amber\|-danger\|tracking-widest\|uppercase\|leading-snug\|#[0-9a-fA-F]\{3,8\}" components/entry-list.tsx
```
Expected: ไม่มีผลลัพธ์

```bash
grep -n "font-mono" components/entry-list.tsx
```
Expected: เหลือเฉพาะบรรทัดที่ครอบวันที่และเลขหน้าเท่านั้น ไม่มีคำไทยอยู่ใน span เดียวกัน

- [ ] **Step 4: Commit** (ยังไม่ผ่าน tsc ทั้งโปรเจกต์ แต่ commit ไว้เป็นก้อนที่อ่านง่าย Task 4 จะปิดให้ครบ)

```bash
git add components/entry-list.tsx
git commit -m "Rewrite entry list with column header and larger rows"
```

---

### Task 4: ตัดโค้ดที่ตาย และเก็บกวาด alias สีเก่า

**Files:**
- Modify: `app/page.tsx`
- Modify: `lib/entry-queries.ts`
- Delete: `lib/entry-sales.ts`
- Delete: `components/date-range-fields.tsx`
- Modify: `components/clip-thumbnail.tsx`
- Modify: `components/reminder-banner.tsx`
- Modify: `components/entry-workspace.tsx`

**Interfaces:**
- Consumes: `EntryList` ที่ไม่มี prop `sales` แล้ว (Task 3)
- Produces: ไม่มี export ใหม่ — งานนี้ลบของที่ตายกับเปลี่ยนชื่อคลาส

- [ ] **Step 1: แก้ `app/page.tsx`**

แทนบรรทัด import แรก:
```ts
import { getEntryRows, getEntrySales, getSearchText } from "@/lib/entry-queries";
```
เป็น:
```ts
import { getEntryRows, getSearchText } from "@/lib/entry-queries";
```

แทนบรรทัดโหลดข้อมูล:
```ts
  const [rows, salesByEntry] = await Promise.all([getEntryRows(), getEntrySales()]);
```
เป็น:
```ts
  const rows = await getEntryRows();
```

แทนบล็อก `rows={items.map(...)}` ทั้งก้อนด้วย (ตัดฟิลด์ `sales` ออก):
```tsx
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
          }))}
```

- [ ] **Step 2: ลบ `getEntrySales()` ออกจาก `lib/entry-queries.ts`**

ลบทั้งฟังก์ชัน `getEntrySales` พร้อมคอมเมนต์ JSDoc เหนือมัน แล้วลบบรรทัด import ที่ตายตาม:
```ts
import { summarizeEntrySales, type EntrySalesSummary } from "@/lib/entry-sales";
```

- [ ] **Step 3: ลบไฟล์ที่ตาย**

```bash
git rm lib/entry-sales.ts components/date-range-fields.tsx
```

- [ ] **Step 4: ยืนยันว่าไม่มีใครอ้างถึงของที่ลบไปแล้ว**

```bash
grep -rn "entry-sales\|EntrySalesSummary\|getEntrySales\|summarizeEntrySales\|DateRangeFields\|date-range-fields" --include=*.ts --include=*.tsx app lib components
```
Expected: ไม่มีผลลัพธ์เลย

- [ ] **Step 5: เก็บกวาด alias สีเก่า 3 ไฟล์**

`components/clip-thumbnail.tsx` บรรทัด 55 — `bg-smoke/40` เป็น `bg-muted-foreground/40`:
```tsx
        <span className="size-3 animate-pulse rounded-full bg-muted-foreground/40" />
```

`components/reminder-banner.tsx` บรรทัด 66-67 — `border-teal/40 bg-teal/10` และ `text-teal`:
```tsx
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm">
      <BellRing className="size-4 shrink-0 text-primary" />
```

`components/entry-workspace.tsx` บรรทัด 236 — `border-danger/40 bg-danger/10 text-danger`:
```tsx
        <p className="mx-4 mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive sm:mx-6">
```

- [ ] **Step 6: ยืนยันว่าเหลือแค่ recommendations.tsx ที่ยังใช้ alias เก่า**

```bash
grep -rn "\-teal\b\|\-paper\b\|\-ink\b\|\-ink-2\b\|\-smoke\b\|\-amber\b\|\-danger\b" --include=*.tsx components app
```
Expected: มีผลลัพธ์เฉพาะจาก `components/recommendations.tsx` เท่านั้น (ไฟล์ของโปรเจกต์ C)

- [ ] **Step 7: ตรวจ type, lint, contrast**

Run: `npx tsc --noEmit` · `npm run lint` · `node scripts/check-contrast.mjs`
Expected: สะอาดทั้งหมด — คราวนี้ `app/page.tsx` ต้องไม่ฟ้องเรื่อง `sales` แล้ว

- [ ] **Step 8: ตรวจด้วย dev server แยกพอร์ต**

```bash
cp dev.db dev-test.db
NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001
```

ไล่ตรวจที่ `http://localhost:3001/` **ทั้งโหมดมืดและโหมดสว่าง**:
- หัวคอลัมน์ตรงแนวกับค่าในแถวทุกคอลัมน์ · รูป 80px · ชื่อสินค้า 18px
- กดตัวกรองสถานะแต่ละตัว — กลุ่มปุ่มมีกรอบรวมเห็นชัดว่ากดได้ทั้งแถว
- **พิมพ์คำค้นหาค้างไว้ (ยังไม่กด "ค้นหา") แล้วกดตัวกรองวันที่ — คำที่พิมพ์ต้องไม่หาย**
- เปิดเมนูวันที่: กด `7 วันล่าสุด` เมนูปิดและกรองทันที · ปุ่มเปลี่ยนเป็น `7 วันล่าสุด`
- กด `กำหนดเอง` — ปฏิทินโผล่ **เมนูต้องไม่ปิดและยังไม่กรอง** · เลือกช่วง กด `ใช้ช่วงนี้` แล้วปุ่มเปลี่ยนเป็น `5 ส.ค. - 20 ส.ค.`
- กด `ทั้งหมด` ในเมนู — ตัวกรองวันที่หลุด ปุ่มกลับเป็น `วันที่`
- สลับ `นับจาก` เป็น `สร้าง` — **หัวคอลัมน์ที่ 4 ต้องเปลี่ยนเป็น `วันที่สร้าง`** และค่าในแถวเปลี่ยนตาม
- กด `ล้างตัวกรองทั้งหมด`
- ปุ่มย้อนกลับของเบราว์เซอร์ — ต้องกลับไปสถานะตัวกรองก่อนหน้า
- **เปิด URL เก่าตรงๆ: `http://localhost:3001/?from=2026-08-01&to=2026-08-07&by=created&status=posted` ต้องกรองถูกและปุ่มวันที่แสดงช่วงนั้น**
- แบ่งหน้า: ไปหน้า 2 แล้วกดตัวกรองใหม่ ต้องกลับหน้า 1
- ไม่มี console error หรือ hydration warning

cleanup ตาม Global Constraints (kill port 3001, `rm -f dev-test.db`, `rm -rf .next-dev`)

- [ ] **Step 9: Commit**

```bash
git diff --stat tsconfig.json   # ต้องว่าง ถ้าไม่ว่างให้ git checkout -- tsconfig.json
git add app/page.tsx lib/entry-queries.ts components/clip-thumbnail.tsx components/reminder-banner.tsx components/entry-workspace.tsx
git commit -m "Drop dead sales query and sweep remaining legacy color aliases"
```

- [ ] **Step 10: build เต็ม — ต้องขออนุญาตผู้ใช้ก่อน**

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
| 3 การตัดสินใจ 5 ข้อ | Task 2 (รวมเฉพาะวันที่ / ปุ่มเขียน "วันที่" / เมนูเขียน "ทั้งหมด" / มีผลทันที), Task 3 (แถว 80px), Task 4 (เก็บกวาด alias) |
| 4.1 แถบควบคุม 2 แถว | Task 2 Step 1 |
| 4.2 หัวคอลัมน์ + แถว + หัวคอลัมน์เปลี่ยนตามฐาน | Task 3 Step 1 (`dateColumnLabel`) |
| 5.1 ป้ายบนปุ่ม 4 รูปแบบ | Task 1 (`formatDateFilterLabel`) + ทดสอบครบทุกรูปแบบใน Step 2 |
| 5.2 เนื้อในเมนู | Task 2 Step 1 |
| 5.3 ตารางอะไร submit ทันที | Task 2 Step 1 (`applyQuickRange` แยกเคส `custom` ออกไม่ push) — **กลไกเปลี่ยนจาก form GET เป็น router.push** มีหมายเหตุอธิบายไว้ต้นแผน |
| 5.4 URL คงเดิม + รีเซ็ต page | Task 2 (`pushWith` ไม่ใส่ `page`) + ตรวจใน Task 4 Step 8 |
| 6 โค้ดที่ตาย 3 รายการ | Task 4 Step 1-4 |
| 7 ไฟล์ที่เกี่ยวข้อง | ครบทุกไฟล์ในตาราง File Structure |
| 8 การตรวจสอบ 6 ข้อ | Task 1 Step 4 (เทสต์ node รวมเคสตี 1 ครึ่ง), Task 3 Step 3 (grep), Task 4 Step 7-8 (tsc/lint/contrast/dev server), Task 4 Step 9 (tsconfig), Task 4 Step 10 (build) |

**สิ่งที่เปลี่ยนจากสเปกและต้องให้ผู้ใช้รับทราบ:**

1. **กลไกเป็น `router.push` ไม่ใช่ form GET** — เหตุผลอยู่ในหมายเหตุต้นแผน พฤติกรรมที่เห็นตรงตามสเปก
2. **คอลัมน์วันที่แสดง `-` เมื่อยังไม่ลงคลิป** (ฐาน `posted`) แทนที่จะ fallback ไปวันที่สร้างแบบเดิม — เพราะหัวคอลัมน์ระบุชัดว่าเป็น "วันที่ลงคลิป" การใส่วันที่สร้างลงไปคือการโกหกหัวคอลัมน์ · ผู้ใช้ที่อยากเห็นวันที่สร้างสลับฐานได้ในเมนู
