# Workspace QoL + Dashboard Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ปรับปรุง 4 จุดจากการใช้งานจริง — ปุ่มคัดลอก 10-part prompt, วันที่ลงคลิป auto-fill เมื่อวางลิงก์, สถานะนำเข้าไฟล์ affiliate แบบเห็นตลอด, กราฟแนวโน้มรายได้ interactive ด้วย Recharts

**Architecture:** งานฝั่ง client เกือบล้วน — แก้ 2 client component เดิม (`production-panel.tsx`, `dashboard-panel.tsx`), ส่ง prop ใหม่ 1 ตัวจาก `page.tsx`, และแทน `TimeChart` (SVG วาดเอง) ด้วย Recharts `AreaChart` (dependency ใหม่ตัวเดียว — ต้องผ่าน compatibility gate กับ Next custom build ก่อน) ไม่มี migration, ไม่แตะ Server Action

**Tech Stack:** Next.js 16.2.10 (custom build) · React 19 · Tailwind v4 · Recharts (ใหม่) · lucide-react

**Spec:** `docs/superpowers/specs/2026-07-16-workspace-qol-dashboard-polish-design.md`

## Global Constraints

- **ห้ามใช้ emoji ใน UI** — ใช้ไอคอน `lucide-react`
- **ข้อความ UI ภาษาไทยทั้งหมด** · ใช้ design token เดิมเท่านั้น (`marigold`/`rust`/`smoke`/`record`/`border`/`card`/`muted`/`muted-foreground`/`foreground`) · ห้ามใส่ motif ธีมหนังเพิ่ม
- **CSS variable ของ token**: Tailwind v4 expose เป็น `--color-<name>` (เช็คแล้วใน `app/globals.css` — `--color-marigold`, `--color-rust`, `--color-smoke`, `--color-record`, `--color-border`, `--color-muted-foreground`, `--color-card` มีครบ) ใช้ `var(--color-...)` ใน Recharts props ได้เลย รองรับ dark mode อัตโนมัติ
- **`dev.db` มีข้อมูลจริง (23 entries + Core Prompt + 79 AffiliateOrder) ไม่มี backup** — ห้ามรัน `DELETE FROM <table>;` แบบไม่มี `WHERE` · e2e ห้ามกด "บันทึกผลลัพธ์" บน entry จริง (ทดสอบ client state ได้โดยไม่ submit)
- **ห้าม build/dev ซ้อนกับ `start.bat`** — เช็ค `netstat -ano | grep ':3000' | grep LISTENING` ก่อน ถ้ามีของที่ไม่ใช่ที่ตัวเองสตาร์ท อย่าฆ่า ให้หยุดรายงาน · ห้ามทิ้ง process ค้างท้าย task
- **ไม่มี test runner** — verify ด้วย `npm run build` (type-check ในตัว) + `npm run lint` + Playwright (ติดตั้งใน scratch dir ห้ามใส่ `package.json` ของโปรเจกต์)
- **Recharts เป็น dependency ใหม่ตัวเดียวที่อนุญาต** — ถ้าใช้กับ Next 16.2.10 custom build ไม่ได้ (Task 4 Step 2 fail) ให้หยุดรายงาน BLOCKED ห้าม hack/ห้ามเปลี่ยน library เอง
- **commit ทุก task ห้ามรวบ** · ทำบน branch ใหม่ `feature/workspace-qol` แตกจาก `master`

## File Structure

**Modified**
- `components/production-panel.tsx` — Task 1 (ปุ่มคัดลอก) + Task 2 (auto-fill วันที่)
- `components/prompt-workspace.tsx` — Task 2 (เพิ่ม `createdAt` ใน type) + Task 3 (ส่ง prop `lastImportedAt`)
- `lib/dashboard.ts` — Task 3 (ย้าย `IMPORT_STALE_DAYS` มาเป็น export กลาง)
- `app/page.tsx` — Task 3 (เก็บ/ส่ง `lastImportedAt`)
- `components/dashboard-panel.tsx` — Task 3 (บรรทัดสถานะนำเข้า)
- `components/revenue-charts.tsx` — Task 4 (TimeChart → Recharts + ปุ่มช่วงเวลา)
- `package.json` / `package-lock.json` — Task 4 (เพิ่ม `recharts`)
- `CLAUDE.md` — Task 5

**Boundaries:** `lib/dashboard.ts` ยัง pure (เพิ่มแค่ constant) · Recharts อยู่เฉพาะใน `revenue-charts.tsx` · ไม่มีไฟล์ใหม่

---

### Task 0: แตก branch

- [ ] **Step 1:**

```bash
git checkout master && git pull && git checkout -b feature/workspace-qol
```

---

### Task 1: ปุ่มคัดลอก 10-part prompt

**Files:**
- Modify: `components/production-panel.tsx`

**Interfaces:**
- Consumes: state `chatgptOutput` (มีอยู่แล้วในไฟล์)
- Produces: ไม่มีอะไรให้ task อื่นใช้ — UI ล้วน

- [ ] **Step 1: เพิ่ม state + handler**

ใน `components/production-panel.tsx` — ใต้บรรทัด `const [copied, setCopied] = useState(false);` เพิ่ม:

```tsx
  const [promptCopied, setPromptCopied] = useState(false);
```

ใต้ฟังก์ชัน `copyForPost` เพิ่ม:

```tsx
  async function copyPrompt() {
    await navigator.clipboard.writeText(chatgptOutput);
    setPromptCopied(true);
    setTimeout(() => setPromptCopied(false), 1500);
  }
```

- [ ] **Step 2: เพิ่มปุ่มที่หัวข้อ 10-part prompt**

แทนบล็อก label เดิม:

```tsx
        <div className="flex flex-1 flex-col gap-1.5">
          <label className="text-sm font-medium text-foreground/90">
            10-part prompt ที่ ChatGPT ตอบกลับ
          </label>
```

ด้วย (โครง label-ซ้าย-ปุ่ม-ขวา แบบเดียวกับหัวข้อ Caption & Hashtags ที่อยู่ถัดลงไปในไฟล์เดียวกัน):

```tsx
        <div className="flex flex-1 flex-col gap-1.5">
          <div className="flex items-center justify-between gap-3">
            <label className="text-sm font-medium text-foreground/90">
              10-part prompt ที่ ChatGPT ตอบกลับ
            </label>
            <Button
              type="button"
              size="sm"
              onClick={copyPrompt}
              disabled={!chatgptOutput}
              variant="outline"
            >
              {promptCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {promptCopied ? "คัดลอกแล้ว" : "คัดลอก"}
            </Button>
          </div>
```

(ไอคอน `Check`/`Copy` import อยู่แล้วบรรทัดบนสุดของไฟล์ ไม่ต้องเพิ่ม) ใช้ `variant="outline"` ให้ต่างจากปุ่ม marigold ของ Caption เล็กน้อย — ปุ่ม Caption เป็นปุ่มหลักของ workflow โพสต์ ส่วนปุ่มนี้เป็นรอง

- [ ] **Step 3: build + lint + commit**

```bash
npm run build && npm run lint
git add components/production-panel.tsx
git commit -m "Add a copy button to the 10-part prompt field"
```

---

### Task 2: วันที่ลงคลิป auto-fill เมื่อวางลิงก์

**Files:**
- Modify: `components/prompt-workspace.tsx` (type `PromptEntry`)
- Modify: `components/production-panel.tsx`

**Interfaces:**
- Consumes: `entry.createdAt` — **ต้องเพิ่มใน type ก่อน** (ข้อมูลจริงมีอยู่แล้ว เพราะ `page.tsx` ส่ง Prisma row เต็มแถวลงมา แค่ type ฝั่ง client ไม่ได้ประกาศ)
- Produces: `PromptEntry.createdAt: Date` (type เพิ่ม field)

- [ ] **Step 1: เพิ่ม `createdAt` ใน type `PromptEntry`**

ใน `components/prompt-workspace.tsx` — ใน `export type PromptEntry = {` เพิ่มบรรทัดหลัง `postedAt: Date | null;`:

```tsx
  createdAt: Date;
```

- [ ] **Step 2: auto-fill ใน production-panel**

ใน `components/production-panel.tsx`:

เพิ่ม helper ใต้ `toDateInputValue` เดิม — **ห้ามใช้ `toDateInputValue` กับ `createdAt`**: ตัวเดิมอ่าน UTC parts ซึ่งถูกต้องสำหรับ `postedAt` (เก็บเป็น UTC midnight) แต่ `createdAt` เป็น timestamp จริง — entry ที่สร้างตอนตี 1 เวลาไทย (= 18:00 UTC เมื่อวาน) จะได้วันที่ผิดไป 1 วัน ต้องอ่านด้วย local getters:

```tsx
function toLocalDateInputValue(value: Date): string {
  // createdAt เป็น timestamp จริง (ไม่ใช่ UTC midnight แบบ postedAt) —
  // ต้องอ่านเป็นเวลาท้องถิ่น ไม่งั้น entry ที่สร้างก่อนตี 7 เวลาไทยจะได้วันที่เมื่อวาน
  const d = new Date(value);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
```

แล้วแก้ `onChange` ของช่องลิงก์คลิป (Input `name="videoUrl"`) จาก:

```tsx
                onChange={(e) => setVideoUrl(e.target.value)}
```

เป็น:

```tsx
                onChange={(e) => {
                  const next = e.target.value;
                  // วางลิงก์ = โพสต์คลิปแล้วจริง — เติมวันที่ลงคลิปให้เป็นวันที่เปิด entry
                  // (ผู้ใช้ทำงานวันต่อวัน) เฉพาะตอนช่องวันที่ยังว่าง แก้ทับเองได้เสมอ
                  // และการลบลิงก์ทีหลังจะไม่ลบวันที่คืน
                  if (videoUrl.trim() === "" && next.trim() !== "" && postedAt === "") {
                    setPostedAt(toLocalDateInputValue(entry.createdAt));
                  }
                  setVideoUrl(next);
                }}
```

- [ ] **Step 3: build + lint + commit**

```bash
npm run build && npm run lint
git add components/prompt-workspace.tsx components/production-panel.tsx
git commit -m "Default the posted date to the entry's creation date when the clip link is pasted"
```

---

### Task 3: สถานะนำเข้าไฟล์แบบเห็นตลอด (dashboard)

**Files:**
- Modify: `lib/dashboard.ts`
- Modify: `app/page.tsx`
- Modify: `components/prompt-workspace.tsx`
- Modify: `components/dashboard-panel.tsx`

**Interfaces:**
- Produces: `export const IMPORT_STALE_DAYS = 7` ใน `lib/dashboard.ts` · prop `lastImportedAt: Date | null` ไหล `page.tsx` → `PromptWorkspace` → `DashboardPanel`
- Consumes: `reminder.daysSinceImport` (มีอยู่แล้วใน `ReminderState` — คำนวณฝั่ง server ใช้เทียบ "วันนี้/N วันก่อน/เกินกำหนด" ได้เลยโดยไม่ต้องเรียก `Date.now()` ฝั่ง client)

- [ ] **Step 1: ย้าย constant ไป `lib/dashboard.ts`**

ใน `lib/dashboard.ts` เพิ่มใต้บรรทัด `import { PAID_STATUS } ...` บนสุด:

```ts
/** รอบนำเข้าไฟล์รายได้ — อิงรอบ settle ของ TikTok (~สัปดาห์) ใช้ทั้งแถบเตือนและบรรทัดสถานะ */
export const IMPORT_STALE_DAYS = 7;
```

ใน `app/page.tsx`: ลบบรรทัด `const IMPORT_STALE_DAYS = 7;` แล้วเพิ่ม `IMPORT_STALE_DAYS` เข้า import ที่มีอยู่:

```ts
import { IMPORT_STALE_DAYS, type ReminderState } from "@/lib/dashboard";
```

(แทนบรรทัด `import type { ReminderState } from "@/lib/dashboard";` เดิม)

- [ ] **Step 2: `page.tsx` เก็บวันที่จริง + ส่ง prop**

แทนบล็อกคำนวณ reminder เดิม:

```ts
  // reminder: ผ่านไปกี่วันจาก import ล่าสุด
  let daysSinceImport: number | null = null;
  if (orders.length > 0) {
    const last = Math.max(...orders.map((o) => o.importedAt.getTime()));
    daysSinceImport = daysSince(last);
  }
```

ด้วย:

```ts
  // reminder: ผ่านไปกี่วันจาก import ล่าสุด (เก็บ Date จริงไว้ให้บรรทัดสถานะใน dashboard ด้วย)
  let daysSinceImport: number | null = null;
  let lastImportedAt: Date | null = null;
  if (orders.length > 0) {
    const last = Math.max(...orders.map((o) => o.importedAt.getTime()));
    lastImportedAt = new Date(last);
    daysSinceImport = daysSince(last);
  }
```

แล้วเพิ่ม prop ใน `<PromptWorkspace ...>`:

```tsx
      lastImportedAt={lastImportedAt}
```

- [ ] **Step 3: `prompt-workspace.tsx` ส่งต่อ prop**

เพิ่ม `lastImportedAt` ใน signature ของ `PromptWorkspace` (ทั้ง destructure และ type):

```tsx
  awaitingClips,
  lastImportedAt,
}: {
  prompts: PromptEntry[];
  corePrompts: CorePromptRecord[];
  affiliateOrders: AffiliateOrderRecord[];
  reminder: ReminderState;
  reminderActive: boolean;
  awaitingClips: { id: string; productName: string }[];
  lastImportedAt: Date | null;
}) {
```

และส่งให้ `DashboardPanel`:

```tsx
            <DashboardPanel
              orders={affiliateOrders}
              reminder={reminder}
              reminderActive={reminderActive}
              awaitingClips={awaitingClips}
              lastImportedAt={lastImportedAt}
            />
```

- [ ] **Step 4: `dashboard-panel.tsx` แสดงบรรทัดสถานะ**

เพิ่ม import (แก้บรรทัด import จาก `@/lib/dashboard` เดิม):

```tsx
import {
  IMPORT_STALE_DAYS,
  summarizeOrders,
  type AffiliateOrderRecord,
  type ReminderState,
} from "@/lib/dashboard";
```

เพิ่ม helper ใต้ฟังก์ชัน `baht`:

```tsx
const DAY_MS = 24 * 60 * 60 * 1000;

function thaiShortDate(d: Date): string {
  return d.toLocaleDateString("th-TH", { day: "numeric", month: "short" });
}
```

เพิ่ม prop ใน signature:

```tsx
export function DashboardPanel({
  orders,
  reminder,
  reminderActive,
  awaitingClips,
  lastImportedAt,
}: {
  orders: AffiliateOrderRecord[];
  reminder: ReminderState;
  reminderActive: boolean;
  awaitingClips: { id: string; productName: string }[];
  lastImportedAt: Date | null;
}) {
```

แล้ววางบรรทัดสถานะ **ถัดจาก** ฟอร์มอัปโหลด (`</form>`) ก่อนบล็อก `{state.error && ...}`:

```tsx
      {lastImportedAt !== null && reminder.daysSinceImport !== null && (
        reminder.daysSinceImport > IMPORT_STALE_DAYS ? (
          <p className="font-mono text-[0.7rem] text-record">
            เกินกำหนดมา {reminder.daysSinceImport - IMPORT_STALE_DAYS} วัน — ไป export
            ไฟล์ใหม่จาก TikTok Studio ได้แล้ว (นำเข้าล่าสุด {thaiShortDate(lastImportedAt)})
          </p>
        ) : (
          <p className="font-mono text-[0.7rem] text-muted-foreground">
            นำเข้าล่าสุด {thaiShortDate(lastImportedAt)}{" "}
            {reminder.daysSinceImport === 0
              ? "(วันนี้)"
              : `(${reminder.daysSinceImport} วันก่อน)`}{" "}
            · รอบถัดไป ~
            {thaiShortDate(new Date(lastImportedAt.getTime() + IMPORT_STALE_DAYS * DAY_MS))}
          </p>
        )
      )}
```

หมายเหตุ: กรณีไม่เคยนำเข้า (`lastImportedAt === null`) ไม่แสดงอะไร — empty state "ยังไม่มีข้อมูลรายได้" เดิมทำหน้าที่นั้นแล้ว · การเทียบวัน ("วันนี้"/เกินกำหนด) ใช้ `reminder.daysSinceImport` ที่คำนวณจาก server — client ไม่ต้องเรียก `Date.now()` (เลี่ยงปัญหา purity + hydration mismatch)

- [ ] **Step 5: build + lint + commit**

```bash
npm run build && npm run lint
git add lib/dashboard.ts app/page.tsx components/prompt-workspace.tsx components/dashboard-panel.tsx
git commit -m "Always show the last-import date and the next due date on the dashboard"
```

---

### Task 4: กราฟ interactive ด้วย Recharts

**Files:**
- Modify: `package.json` / `package-lock.json` (dependency ใหม่: `recharts`)
- Modify: `components/revenue-charts.tsx`

**Interfaces:**
- Consumes: `ordersByDay(orders)` → `{ date: string; orders: number; gmv: number }[]` และ `revenueTrend(orders)` จาก `lib/dashboard.ts` (ไม่แตะทั้งคู่) · `AffiliateOrderRecord.orderDate: Date`
- Produces: `RevenueTrend({ orders })` — export ชื่อเดิม signature เดิม caller (`dashboard-panel.tsx`) ไม่ต้องแก้

- [ ] **Step 1: ติดตั้ง Recharts**

```bash
npm install recharts
```

- [ ] **Step 2: Compatibility gate — build ต้องผ่านก่อนเขียนโค้ดจริง**

เช็ค port 3000 ว่าง แล้ว:

```bash
npm run build
```

คาดหวัง: ผ่านปกติ (แค่ติดตั้ง ยังไม่ได้ import) — ถ้า install/build พังตั้งแต่ตรงนี้ → **หยุด รายงาน BLOCKED** พร้อม error เต็มๆ ห้ามแก้ด้วยการ patch node_modules หรือเปลี่ยน library เอง

- [ ] **Step 3: เขียน `revenue-charts.tsx` ใหม่ทั้งไฟล์**

แทนที่ทั้งไฟล์ `components/revenue-charts.tsx` ด้วย (Sparkline + โครง `RevenueTrend` เดิมคงไว้ — เปลี่ยนเฉพาะ `TimeChart` เป็น Recharts + เพิ่มปุ่มช่วงเวลา + tooltip):

```tsx
"use client";

import { useState } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  ordersByDay,
  revenueTrend,
  type AffiliateOrderRecord,
} from "@/lib/dashboard";

function baht(n: number): string {
  return "฿" + n.toLocaleString("th-TH", { maximumFractionDigits: 0 });
}

const DAY_MS = 24 * 60 * 60 * 1000;

type RangeKey = "7d" | "30d" | "all";

const RANGES: { key: RangeKey; label: string; days: number | null }[] = [
  { key: "7d", label: "7 วัน", days: 7 },
  { key: "30d", label: "30 วัน", days: 30 },
  { key: "all", label: "ทั้งหมด", days: null },
];

/**
 * ช่วงเวลานับถอยหลังจากวันที่ล่าสุดที่มีข้อมูล (ไม่ใช่วันนี้) —
 * ข้อมูลนำเข้ามือแล้วมักค้างหลายวัน ถ้านับจากวันนี้ ช่วง 7 วันอาจว่างเปล่าทั้งที่มีข้อมูล
 */
function filterByRange(orders: AffiliateOrderRecord[], days: number | null) {
  if (days === null || orders.length === 0) return orders;
  const latest = Math.max(...orders.map((o) => o.orderDate.getTime()));
  const cutoff = latest - (days - 1) * DAY_MS;
  return orders.filter((o) => o.orderDate.getTime() >= cutoff);
}

type DayPoint = { date: string; orders: number; gmv: number };

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: DayPoint }[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 font-mono text-xs shadow-sm">
      <div className="text-muted-foreground">{d.date}</div>
      <div className="text-foreground">GMV {baht(d.gmv)}</div>
      <div className="text-muted-foreground">{d.orders.toLocaleString("th-TH")} ออเดอร์</div>
    </div>
  );
}

/** กราฟ GMV ตามวัน — Recharts, hover ดูรายวันได้ + เลือกช่วงเวลา */
function TimeChart({ orders }: { orders: AffiliateOrderRecord[] }) {
  const [range, setRange] = useState<RangeKey>("all");
  const days = RANGES.find((r) => r.key === range)!.days;
  const data = ordersByDay(filterByRange(orders, days));

  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="flex gap-1">
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => setRange(r.key)}
            className={`rounded-md border px-2 py-0.5 font-mono text-xs ${
              range === r.key
                ? "border-marigold bg-marigold/10 text-marigold"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {data.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          ไม่มีข้อมูลในช่วงนี้
        </p>
      ) : (
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--color-border)"
                vertical={false}
              />
              <XAxis
                dataKey="date"
                tickFormatter={(v: string) => v.slice(5)}
                tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                tickLine={false}
                axisLine={{ stroke: "var(--color-border)" }}
              />
              <YAxis
                tickFormatter={(v: number) => baht(v)}
                tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                tickLine={false}
                axisLine={false}
                width={64}
              />
              <Tooltip
                content={<ChartTooltip />}
                cursor={{ stroke: "var(--color-smoke)", strokeDasharray: "3 3" }}
              />
              <Area
                type="monotone"
                dataKey="gmv"
                stroke="var(--color-rust)"
                strokeWidth={2}
                fill="var(--color-marigold)"
                fillOpacity={0.15}
                dot={{ r: 2.5, fill: "var(--color-rust)", strokeWidth: 0 }}
                activeDot={{ r: 4, fill: "var(--color-rust)" }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

/** sparkline จิ๋วในบรรทัดเดียว — SVG วาดเองเหมือนเดิม (24px ไม่คุ้มใช้ library) */
function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const W = 96;
  const H = 24;
  const max = Math.max(...points, 1);
  const step = W / (points.length - 1);
  const line = points
    .map((p, i) => `${i * step},${H - (p / max) * (H - 4) - 2}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-6 w-24" aria-hidden="true">
      <polyline points={line} className="fill-none stroke-marigold" strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

export function RevenueTrend({ orders }: { orders: AffiliateOrderRecord[] }) {
  const [open, setOpen] = useState(false);
  if (orders.length === 0) return null;
  const { points, direction, changePct } = revenueTrend(orders);

  const Arrow = direction === "up" ? TrendingUp : direction === "down" ? TrendingDown : Minus;
  const arrowClass =
    direction === "up" ? "text-marigold" : direction === "down" ? "text-record" : "text-smoke";
  const pctLabel =
    direction === "flat" ? "ทรงตัว" : `${changePct > 0 ? "+" : ""}${changePct.toFixed(0)}%`;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <span className="font-mono text-[0.7rem] tracking-widest text-smoke uppercase">
          แนวโน้มรายได้
        </span>
        <Sparkline points={points} />
        <span className={`flex items-center gap-1 text-sm ${arrowClass}`}>
          <Arrow className="size-4" />
          {pctLabel}
        </span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="ml-auto font-mono text-xs text-marigold hover:underline"
        >
          {open ? "ซ่อนกราฟ" : "ดูกราฟ"}
        </button>
      </div>
      {open && <TimeChart orders={orders} />}
    </div>
  );
}
```

หมายเหตุสำหรับผู้เขียน: ถ้า type ของ Recharts props ในเวอร์ชันที่ติดตั้งจริงไม่ตรงกับโค้ดนี้ (เช่น `Tooltip content` / tick props เปลี่ยน shape) **ให้อ่าน type จริงใน `node_modules/recharts/types/` แล้วปรับตามของจริง** — ห้ามกลบด้วย `as any` (กฎเดียวกับ Gemini SDK ของโปรเจกต์นี้)

- [ ] **Step 4: Browser smoke check (gate ที่สอง)**

เช็ค port 3000 ว่างอีกครั้ง แล้ว start dev server background, เขียน Playwright script สั้นๆ ใน scratch dir ตรวจว่า:

1. เปิดแท็บ ④ → กด "ดูกราฟ" → มี element ของ Recharts โผล่ (`.recharts-responsive-container` หรือ `svg.recharts-surface`)
2. hover กลางกราฟ → tooltip มีข้อความ "GMV" และ "ออเดอร์"
3. กดปุ่ม "7 วัน" → กราฟยัง render (จำนวนจุดเปลี่ยนหรือขึ้น "ไม่มีข้อมูลในช่วงนี้" อย่างใดอย่างหนึ่ง — ห้าม crash)
4. console ไม่มี error

รายงานผลจริง ถ้าข้อไหน fail เพราะ Recharts เข้ากับ Next custom build ไม่ได้ → **หยุด รายงาน BLOCKED** · เสร็จแล้วปิด dev server (`taskkill //PID <pid> //F` เฉพาะตัวที่ตัวเองสตาร์ท)

- [ ] **Step 5: build + lint + commit**

```bash
npm run build && npm run lint
git add package.json package-lock.json components/revenue-charts.tsx
git commit -m "Make the revenue chart interactive with Recharts"
```

---

### Task 5: ทดสอบ end-to-end + CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: e2e ทั้ง 4 ฟีเจอร์ในเบราว์เซอร์จริง**

เช็ค port 3000 → `npm run dev` background → Playwright ใน scratch dir (ให้ context `grantPermissions(["clipboard-read", "clipboard-write"])` สำหรับข้อ 1):

1. **ปุ่มคัดลอก:** เลือก entry ที่มี 10-part prompt (เช่น "คอนโดแมวไม้") → แท็บ ② → กดปุ่ม "คัดลอก" ที่หัว 10-part prompt → อ่าน clipboard ต้องได้ข้อความเดียวกับใน textarea → สถานะปุ่มเปลี่ยนเป็น "คัดลอกแล้ว" → ปุ่มของ Caption ไม่เปลี่ยนสถานะตาม
2. **Auto-fill วันที่:** เลือก entry ที่**ยังไม่มี** videoUrl และยังไม่มีวันที่ (ถ้าไม่มี ใช้ entry "ชั้นวางของ 5 ชั้น" ที่ยังว่าง) → พิมพ์ลิงก์ TikTok ลงช่องลิงก์ → ช่องวันที่ต้องเติมเป็นวันที่สร้าง entry อัตโนมัติ → ลบลิงก์ออก → วันที่ต้องยังอยู่ → **ห้ามกด "บันทึกผลลัพธ์"** (ทดสอบ client state เท่านั้น ไม่แตะข้อมูลจริง) → เปลี่ยน entry ทิ้งไปเลย
3. **สถานะนำเข้า:** แท็บ ④ → เห็นบรรทัด "นำเข้าล่าสุด ... · รอบถัดไป ~..." ใต้ฟอร์มอัปโหลด (ข้อมูลจริงนำเข้าเมื่อ 2026-07-15 → ควรขึ้น "(1 วันก่อน)" หรือตามจริง) — รายงานข้อความจริงที่เห็น
4. **กราฟ:** แท็บ ④ → "ดูกราฟ" → Recharts render → hover เห็น tooltip วันที่/GMV/ออเดอร์ (รายงานตัวเลขจริง 1 จุด) → ปุ่ม 7 วัน/30 วัน/ทั้งหมด สลับได้ → console error = 0
5. ไม่มี emoji ในหน้า · ปิด dev server เมื่อเสร็จ

รายงานผลเป็นค่าจริงทุกข้อ ห้าม "น่าจะผ่าน"

- [ ] **Step 2: ตรวจข้อมูลจริงไม่หาย**

```bash
node -e "const D=require('better-sqlite3');const db=new D('dev.db',{readonly:true});console.log('entries:',db.prepare('SELECT COUNT(*) c FROM PromptEntry').get().c,'orders:',db.prepare('SELECT COUNT(*) c FROM AffiliateOrder').get().c);db.close();"
```

คาดหวัง: `entries: 23 orders: 79` (เท่าก่อนเริ่ม — e2e ไม่ได้สร้าง/แก้อะไร)

- [ ] **Step 3: CLAUDE.md**

ใน section `## Dashboard รายได้ (แท็บ ④)`:

แก้บรรทัดเดิม:

```
- `lib/dashboard.ts` เป็น aggregation ล้วน (pure) · กราฟใน `components/revenue-charts.tsx` วาดเองด้วย SVG ไม่มี chart library · reminder banner เตือนเมื่อข้อมูลเก่า >7 วัน / มีคลิปยังไม่มีรายได้ / มีสินค้าขายได้ที่ยังไม่มี entry
```

เป็น:

```
- `lib/dashboard.ts` เป็น aggregation ล้วน (pure) และเป็นเจ้าของ `IMPORT_STALE_DAYS` (รอบนำเข้า 7 วัน ใช้ร่วมกันทั้งแถบเตือนและบรรทัดสถานะ) · กราฟเส้นใน `components/revenue-charts.tsx` ใช้ **Recharts** (library ตัวเดียวในแอป, สีผูกผ่าน `var(--color-*)` ของ Tailwind v4) ส่วน sparkline กับ bar ราย-คลิปยังวาดเองด้วย SVG/div · reminder banner เตือนเมื่อข้อมูลเก่า >7 วัน / มีคลิปยังไม่มีรายได้ / มีสินค้าขายได้ที่ยังไม่มี entry และมีบรรทัดสถานะถาวรใต้ฟอร์มอัปโหลดบอกวันนำเข้าล่าสุด+รอบถัดไป
```

และใน section `## Architecture` แก้คำอธิบายแท็บ ② (บรรทัดแรกของ section ตรง `production-panel.tsx`) จาก:

```
② ผลลัพธ์ & คลิป (`production-panel.tsx` — 10-part prompt textarea, Caption/Hashtags fields + ปุ่มคัดลอกทั้งหมด, video URL, posted date)
```

เป็น:

```
② ผลลัพธ์ & คลิป (`production-panel.tsx` — 10-part prompt textarea + ปุ่มคัดลอก, Caption/Hashtags fields + ปุ่มคัดลอกทั้งหมด, video URL, posted date ที่ auto-fill เป็นวันสร้าง entry ตอนวางลิงก์คลิปครั้งแรก)
```

- [ ] **Step 4: build + lint + commit**

```bash
npm run build && npm run lint
git add CLAUDE.md
git commit -m "Document the QoL round: copy button, auto date, import status, Recharts"
```

---

## Verification (ทั้งฟีเจอร์)

- `npm run build` + `npm run lint` สะอาดทุก task
- ปุ่มคัดลอก 10-part prompt ทำงาน แยก state จากปุ่ม Caption
- วางลิงก์คลิป → วันที่เติมเป็นวันสร้าง entry (เวลาท้องถิ่น) เฉพาะตอนช่องว่าง แก้ทับได้ ลบลิงก์ไม่ลบวันที่
- Dashboard เห็น "นำเข้าล่าสุด + รอบถัดไป" ตลอด, เลยกำหนดเปลี่ยนโทน `record`
- กราฟ Recharts: hover tooltip (วันที่/GMV/ออเดอร์), ปุ่ม 7/30/ทั้งหมด, สี token เดิม, ไม่มี console error
- ข้อมูลจริง (23 entries + 79 orders) ไม่หาย · ไม่มี emoji · ไม่มี motif ใหม่

## Git

Branch ใหม่ `feature/workspace-qol` จาก `master` (Task 0) — จบแล้วใช้ finishing-a-development-branch เลือก merge/PR
