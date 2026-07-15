# Affiliate Revenue Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** อัปโหลดไฟล์ affiliate orders (xlsx) จาก TikTok Studio เข้าแอป จับคู่ออเดอร์กับคลิปอัตโนมัติ แล้วแสดงเป็น dashboard + เตือนให้ import เมื่อข้อมูลเก่า

**Architecture:** เพิ่มตาราง `AffiliateOrder` (ระดับต่อออเดอร์) → parse xlsx ด้วย SheetJS ในไฟล์ pure (`lib/affiliate.ts`) → Server Action `importAffiliateOrders` จับคู่ contentId กับ video id ที่ดึงจาก `PromptEntry.videoUrl` แล้ว upsert กันซ้ำ → aggregation อยู่ใน `lib/dashboard.ts` (pure) → แท็บใหม่ "④ รายได้" แสดงตัวเลขสรุป + กราฟที่วาดเองด้วย SVG → banner เตือนบนหัวแอป

**Tech Stack:** Next.js 16.2.10 (custom build) · Prisma 7 + SQLite (driver adapter) · SheetJS (`xlsx`) · Tailwind v4 · shadcn/ui บน Base UI · lucide-react

## Global Constraints

- **ห้ามใช้ emoji ใน UI จริง** — ใช้ไอคอน `lucide-react` เหมือนส่วนอื่นของแอป
- **ใช้ design token เดิมเท่านั้น** — สี `ink`/`ink-2`/`paper`/`marigold`/`rust`/`smoke`/`record`/`muted`, ใช้ `Button`/`Input` จาก `components/ui/` — ห้ามเพิ่มสี/ฟอนต์/chart library ใหม่ (กราฟวาดเองด้วย SVG/CSS)
- **ข้อความ UI เป็นภาษาไทยทั้งหมด** ให้เข้ากับของเดิม (`สร้าง Prompt`, `คัดลอก`, `บันทึกผลลัพธ์`)
- **join ด้วย content ID เท่านั้น ไม่ใช่ชื่อสินค้า** — สินค้าเดียวมีได้หลายคลิป (video id ต่างกัน)
- **GMV ≠ เงินจริง** — dashboard ต้องแยก "GMV (ยอดสั่ง)" กับ "เงินคอมที่ settle แล้ว" (`finalRevenue`) ให้ชัด สถานะที่ถือว่าจ่ายแล้วคือ `"ชำระแล้ว"` เท่านั้น
- **dedup ด้วย `orderId`** — โยนไฟล์ที่ช่วงเวลาทับกันซ้ำได้ ต้องไม่เพิ่มออเดอร์ซ้ำ (upsert)
- **Prisma 7:** generated client import จาก `@/lib/generated/prisma/client` เท่านั้น, หลังแก้ `prisma/schema.prisma` รัน `npx prisma migrate dev --name <name>` แล้ว `npx prisma generate`
- **`dev.db` มีข้อมูลจริง 19 entries + Core Prompt ไม่มี backup** — **ห้ามรัน `DELETE FROM <table>;` แบบไม่มี `WHERE`** เด็ดขาด ล้างข้อมูลทดสอบด้วย `WHERE` เจาะจง
- **ห้าม build/dev ซ้อนกับ `start.bat` ของผู้ใช้** — เช็ก port 3000 ก่อน (`netstat -ano | grep ':3000' | grep LISTENING` แล้ว `taskkill //PID <pid> //F`) `.next` พังได้ถ้ารันซ้อน ถ้าเจอ `Cannot find module 'better-sqlite3-...'` ให้ `rm -rf .next` แล้ว build ใหม่
- **ไม่มี test runner** — verify ด้วย `npm run build` (type-check ในตัว) + `npm run lint` + ขับจริงผ่าน Playwright (ติดตั้งใน scratch dir ของ session ห้ามใส่ `package.json`)
- **ห้าม commit `.env` / `GEMINI_API_KEY`**
- **ไฟล์ตัวอย่างจริงสำหรับทดสอบ:** `affiliate_orders_7661818732840453895.xlsx` ที่ root (83 ออเดอร์, ที่ลับเล็บแมว 64 ออเดอร์ → content ID `7656417754160958737`) — gitignore ไว้ อย่า commit
- **commit ทุก task ห้ามรวบ**

## File Structure

**Created**
- `lib/affiliate.ts` — parse xlsx → `AffiliateOrderInput[]` (pure, รู้จัก SheetJS ไฟล์เดียว) + helper `videoIdFromUrl`
- `lib/dashboard.ts` — aggregation ล้วน (summary/byDay/byClip/byStatus) ไม่แตะ DB/network
- `components/dashboard-panel.tsx` — แท็บ ④ : upload + ตัวเลขสรุป + กราฟ + reconciliation
- `components/revenue-charts.tsx` — 3 กราฟ SVG (เส้นตามเวลา, bar ต่อคลิป, แยกสถานะ)
- `components/reminder-banner.tsx` — banner เตือน import

**Modified**
- `prisma/schema.prisma` — model `AffiliateOrder` + back-relation ใน `PromptEntry`
- `app/actions.ts` — `importAffiliateOrders(formData)`
- `app/page.tsx` — ดึง affiliate orders + คำนวณ reminder ส่งเข้า workspace
- `components/workspace-tabs.tsx` — เพิ่มแท็บ `dashboard`
- `components/prompt-workspace.tsx` — type ใหม่, render แท็บ dashboard + banner
- `CLAUDE.md` — บันทึกส่วนใหม่
- `package.json` — เพิ่ม `xlsx`

**Boundaries:** `lib/affiliate.ts` เป็นไฟล์เดียวที่ import `xlsx` · `lib/dashboard.ts` เป็น pure function · `app/actions.ts` เป็นชั้นบางประกอบ parse+join+upsert

---

### Task 1: ตาราง AffiliateOrder + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_affiliate_order/migration.sql` (generate เอา ห้ามเขียนมือ)

**Interfaces:**
- Produces: Prisma model `AffiliateOrder` fields — `orderId String @id`, `productName String`, `productId String`, `contentId String`, `status String`, `currency String`, `gmv Float`, `itemsSold Int`, `itemsRefunded Int`, `actualCommission Float?`, `finalRevenue Float?`, `orderDate DateTime`, `matchedEntryId String?`, `importedAt DateTime`. `PromptEntry` gains `affiliateOrders AffiliateOrder[]`.

- [ ] **Step 1: เพิ่ม model**

ใน `prisma/schema.prisma` เพิ่ม 1 บรรทัดใน `model PromptEntry` (ต่อจาก `hashtags`):

```prisma
  affiliateOrders AffiliateOrder[]
```

แล้วเพิ่ม model ใหม่ท้ายไฟล์:

```prisma
model AffiliateOrder {
  orderId          String       @id
  productName      String
  productId        String
  contentId        String
  status           String
  currency         String
  gmv              Float
  itemsSold        Int
  itemsRefunded    Int
  actualCommission Float?
  finalRevenue     Float?
  orderDate        DateTime
  matchedEntryId   String?
  matchedEntry     PromptEntry? @relation(fields: [matchedEntryId], references: [id], onDelete: SetNull)
  importedAt       DateTime     @default(now())

  @@index([contentId])
  @@index([orderDate])
}
```

`onDelete: SetNull` — ลบ entry แล้ว order ไม่หาย แค่ตัด link (เก็บประวัติรายได้ไว้)

- [ ] **Step 2: migrate + generate**

```bash
npx prisma migrate dev --name affiliate_order
npx prisma generate
```
คาดหวัง: `Your database is now in sync with your schema.` + `✔ Generated Prisma Client`

ยืนยันข้อมูลจริงรอด:
```bash
node -e "
const D=require('better-sqlite3');const db=new D('dev.db',{readonly:true});
console.log('entries:', db.prepare('SELECT COUNT(*) c FROM PromptEntry').get().c);
console.log('affiliate orders:', db.prepare('SELECT COUNT(*) c FROM AffiliateOrder').get().c);
db.close();"
```
คาดหวัง: `entries: 19`, `affiliate orders: 0`

- [ ] **Step 3: build + commit**

```bash
npm run build && npm run lint
git add prisma/schema.prisma prisma/migrations
git commit -m "Add AffiliateOrder model for revenue tracking"
```

---

### Task 2: Parser xlsx (`lib/affiliate.ts`)

**Files:**
- Create: `lib/affiliate.ts`
- Modify: `package.json` (เพิ่ม `xlsx`)

**Interfaces:**
- Produces:
  - type `AffiliateOrderInput = { orderId: string; productName: string; productId: string; contentId: string; status: string; currency: string; gmv: number; itemsSold: number; itemsRefunded: number; actualCommission: number | null; finalRevenue: number | null; orderDate: Date }`
  - `parseAffiliateXlsx(buffer: Buffer): AffiliateOrderInput[]`
  - `videoIdFromUrl(url: string): string | null`
  - `PAID_STATUS = "ชำระแล้ว"` (export const)

- [ ] **Step 1: ติดตั้ง SheetJS**

```bash
npm install xlsx@0.18.5
```
(pin เวอร์ชัน 0.18.5 — เวอร์ชันบน npm ที่อ่าน xlsx ได้ครบ รวม inline strings)

- [ ] **Step 2: เขียนไฟล์**

สร้าง `lib/affiliate.ts`:

```ts
import * as XLSX from "xlsx";

/** สถานะที่ถือว่า "จ่ายเงินแล้วจริง" (col 13) — อย่างอื่นคือรอ/ยกเลิก */
export const PAID_STATUS = "ชำระแล้ว";

export type AffiliateOrderInput = {
  orderId: string;
  productName: string;
  productId: string;
  contentId: string;
  status: string;
  currency: string;
  gmv: number;
  itemsSold: number;
  itemsRefunded: number;
  actualCommission: number | null;
  finalRevenue: number | null;
  orderDate: Date;
};

// ตำแหน่งคอลัมน์ (0-based) ในไฟล์ affiliate export ของ TikTok Studio
const COL = {
  orderId: 0,
  productName: 2,
  productId: 3,
  itemsSold: 5,
  itemsRefunded: 6,
  currency: 11,
  status: 13,
  contentId: 17,
  gmv: 23,
  actualCommission: 34,
  finalRevenue: 44,
  orderDate: 45,
} as const;

/** วันที่ในไฟล์เป็น "DD/MM/YYYY HH:MM:SS" (ไม่ใช่ ISO) */
function parseThaiDate(s: string): Date | null {
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, dd, mm, yyyy, hh, mi, ss] = m;
  return new Date(
    Number(yyyy),
    Number(mm) - 1,
    Number(dd),
    Number(hh),
    Number(mi),
    Number(ss)
  );
}

function num(v: unknown): number {
  const n = parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function numOrNull(v: unknown): number | null {
  const s = String(v ?? "").trim();
  if (s === "") return null;
  const n = parseFloat(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** ดึง video id จากลิงก์ TikTok — .../video/<id> */
export function videoIdFromUrl(url: string): string | null {
  const m = url.match(/\/video\/(\d{6,25})/);
  return m ? m[1] : null;
}

export function parseAffiliateXlsx(buffer: Buffer): AffiliateOrderInput[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  // header:1 => array-of-arrays, raw:false => ได้ string ตามที่แสดง, defval:"" กันช่องว่างหาย
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
  });

  const out: AffiliateOrderInput[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const orderId = String(r[COL.orderId] ?? "").trim();
    if (!orderId) continue;
    const orderDate = parseThaiDate(String(r[COL.orderDate] ?? ""));
    if (!orderDate) continue;
    out.push({
      orderId,
      productName: String(r[COL.productName] ?? "").trim(),
      productId: String(r[COL.productId] ?? "").trim(),
      contentId: String(r[COL.contentId] ?? "").trim(),
      status: String(r[COL.status] ?? "").trim(),
      currency: String(r[COL.currency] ?? "").trim(),
      gmv: num(r[COL.gmv]),
      itemsSold: Math.round(num(r[COL.itemsSold])),
      itemsRefunded: Math.round(num(r[COL.itemsRefunded])),
      actualCommission: numOrNull(r[COL.actualCommission]),
      finalRevenue: numOrNull(r[COL.finalRevenue]),
      orderDate,
    });
  }
  return out;
}
```

- [ ] **Step 3: ทดสอบ parser กับไฟล์จริง (ใน scratch)**

เขียน `$SCRATCH/test-parse.mjs` (ไม่ commit):

```js
import path from "node:path";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire("C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt/");
const XLSX = require("xlsx");

const buf = readFileSync("C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt/affiliate_orders_7661818732840453895.xlsx");
const wb = XLSX.read(buf, { type: "buffer" });
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: "" });
console.log("data rows:", rows.length - 1);
console.log("row1 orderId:", rows[1][0], "| contentId:", rows[1][17], "| gmv:", rows[1][23], "| date:", rows[1][45]);
```

```bash
cd "$SCRATCH" && node test-parse.mjs
```
คาดหวัง: `data rows: 83` และ contentId/gmv/date มีค่า (ยืนยันว่า SheetJS อ่าน inline strings ได้)

- [ ] **Step 4: build + commit**

```bash
npm run build && npm run lint
git add lib/affiliate.ts package.json package-lock.json
git commit -m "Parse affiliate orders xlsx"
```

---

### Task 3: Import Server Action

**Files:**
- Modify: `app/actions.ts`

**Interfaces:**
- Consumes: `parseAffiliateXlsx`, `videoIdFromUrl` (Task 2)
- Produces:
  - type `AffiliateImportSummary = { total: number; matched: number; unmatched: number; unmatchedProducts: { contentId: string; productName: string; orders: number }[] }`
  - `importAffiliateOrders(formData: FormData): Promise<AffiliateImportSummary>`

- [ ] **Step 1: เพิ่ม import + action**

ใน `app/actions.ts` เพิ่ม import ต่อจากของเดิม:

```ts
import { parseAffiliateXlsx, videoIdFromUrl } from "@/lib/affiliate";
```

แล้วเพิ่ม type + action ท้ายไฟล์:

```ts
export type AffiliateImportSummary = {
  total: number;
  matched: number;
  unmatched: number;
  unmatchedProducts: { contentId: string; productName: string; orders: number }[];
};

export async function importAffiliateOrders(
  formData: FormData
): Promise<AffiliateImportSummary> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("กรุณาเลือกไฟล์ affiliate orders (.xlsx)");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let orders;
  try {
    orders = parseAffiliateXlsx(buffer);
  } catch {
    throw new Error("อ่านไฟล์ไม่สำเร็จ — ต้องเป็นไฟล์ affiliate orders (.xlsx) จาก TikTok Studio");
  }
  if (orders.length === 0) {
    throw new Error("ไม่พบออเดอร์ในไฟล์");
  }

  // สร้าง map video id -> entry id จาก videoUrl ที่เก็บไว้
  const entries = await prisma.promptEntry.findMany({
    select: { id: true, videoUrl: true },
  });
  const videoToEntry = new Map<string, string>();
  for (const e of entries) {
    const vid = videoIdFromUrl(e.videoUrl);
    if (vid) videoToEntry.set(vid, e.id);
  }

  // upsert กันซ้ำด้วย orderId — โยนไฟล์ทับได้ อัปเดตสถานะ/ยอดให้ด้วย
  for (const o of orders) {
    const matchedEntryId = videoToEntry.get(o.contentId) ?? null;
    await prisma.affiliateOrder.upsert({
      where: { orderId: o.orderId },
      create: { ...o, matchedEntryId },
      update: {
        productName: o.productName,
        status: o.status,
        gmv: o.gmv,
        itemsSold: o.itemsSold,
        itemsRefunded: o.itemsRefunded,
        actualCommission: o.actualCommission,
        finalRevenue: o.finalRevenue,
        matchedEntryId,
        importedAt: new Date(),
      },
    });
  }

  const matched = orders.filter((o) => videoToEntry.has(o.contentId)).length;
  const unmatchedMap = new Map<
    string,
    { contentId: string; productName: string; orders: number }
  >();
  for (const o of orders) {
    if (videoToEntry.has(o.contentId)) continue;
    const ex = unmatchedMap.get(o.contentId);
    if (ex) ex.orders++;
    else
      unmatchedMap.set(o.contentId, {
        contentId: o.contentId,
        productName: o.productName,
        orders: 1,
      });
  }

  revalidatePath("/");
  return {
    total: orders.length,
    matched,
    unmatched: orders.length - matched,
    unmatchedProducts: [...unmatchedMap.values()].sort((a, b) => b.orders - a.orders),
  };
}
```

- [ ] **Step 2: build + commit**

```bash
npm run build && npm run lint
```
คาดหวัง: สะอาด (ยังไม่มี UI เรียก — ปกติ)

```bash
git add app/actions.ts
git commit -m "Import and join affiliate orders to clips"
```

---

### Task 4: Aggregation (`lib/dashboard.ts`) + page query + workspace plumbing

**Files:**
- Create: `lib/dashboard.ts`
- Modify: `app/page.tsx`
- Modify: `components/workspace-tabs.tsx`
- Modify: `components/prompt-workspace.tsx`

**Interfaces:**
- Produces:
  - type `AffiliateOrderRecord = { orderId: string; productName: string; contentId: string; status: string; gmv: number; itemsSold: number; actualCommission: number | null; finalRevenue: number | null; orderDate: Date; matchedEntryId: string | null; importedAt: Date }`
  - `summarizeOrders(orders: AffiliateOrderRecord[]): { totalGmv: number; settledRevenue: number; orderCount: number; itemCount: number }`
  - `ordersByDay(orders: AffiliateOrderRecord[]): { date: string; orders: number; gmv: number }[]`
  - `revenueByClip(orders: AffiliateOrderRecord[]): { contentId: string; productName: string; matchedEntryId: string | null; orders: number; gmv: number; paidGmv: number; pendingGmv: number }[]`
  - `ordersByStatus(orders: AffiliateOrderRecord[]): { status: string; count: number; gmv: number }[]`
  - type `ReminderState = { daysSinceImport: number | null; clipsAwaitingRevenue: number; unmatchedSoldProducts: number }`
  - `WorkspaceTab` gains `"dashboard"`

- [ ] **Step 1: เขียน aggregation**

สร้าง `lib/dashboard.ts`:

```ts
import { PAID_STATUS } from "@/lib/affiliate";

export type AffiliateOrderRecord = {
  orderId: string;
  productName: string;
  contentId: string;
  status: string;
  gmv: number;
  itemsSold: number;
  actualCommission: number | null;
  finalRevenue: number | null;
  orderDate: Date;
  matchedEntryId: string | null;
  importedAt: Date;
};

export function summarizeOrders(orders: AffiliateOrderRecord[]) {
  let totalGmv = 0;
  let settledRevenue = 0;
  let itemCount = 0;
  for (const o of orders) {
    totalGmv += o.gmv;
    settledRevenue += o.finalRevenue ?? 0;
    itemCount += o.itemsSold;
  }
  return { totalGmv, settledRevenue, orderCount: orders.length, itemCount };
}

function dayKey(d: Date): string {
  // ใช้เวลาท้องถิ่น (ออเดอร์ TikTok เป็นเวลาไทยอยู่แล้ว)
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function ordersByDay(orders: AffiliateOrderRecord[]) {
  const map = new Map<string, { date: string; orders: number; gmv: number }>();
  for (const o of orders) {
    const k = dayKey(o.orderDate);
    const ex = map.get(k);
    if (ex) {
      ex.orders++;
      ex.gmv += o.gmv;
    } else {
      map.set(k, { date: k, orders: 1, gmv: o.gmv });
    }
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function revenueByClip(orders: AffiliateOrderRecord[]) {
  const map = new Map<
    string,
    {
      contentId: string;
      productName: string;
      matchedEntryId: string | null;
      orders: number;
      gmv: number;
      paidGmv: number;
      pendingGmv: number;
    }
  >();
  for (const o of orders) {
    const ex = map.get(o.contentId);
    const paid = o.status === PAID_STATUS;
    if (ex) {
      ex.orders++;
      ex.gmv += o.gmv;
      if (paid) ex.paidGmv += o.gmv;
      else ex.pendingGmv += o.gmv;
    } else {
      map.set(o.contentId, {
        contentId: o.contentId,
        productName: o.productName,
        matchedEntryId: o.matchedEntryId,
        orders: 1,
        gmv: o.gmv,
        paidGmv: paid ? o.gmv : 0,
        pendingGmv: paid ? 0 : o.gmv,
      });
    }
  }
  return [...map.values()].sort((a, b) => b.gmv - a.gmv);
}

export function ordersByStatus(orders: AffiliateOrderRecord[]) {
  const map = new Map<string, { status: string; count: number; gmv: number }>();
  for (const o of orders) {
    const ex = map.get(o.status);
    if (ex) {
      ex.count++;
      ex.gmv += o.gmv;
    } else {
      map.set(o.status, { status: o.status, count: 1, gmv: o.gmv });
    }
  }
  return [...map.values()].sort((a, b) => b.gmv - a.gmv);
}

export type ReminderState = {
  daysSinceImport: number | null;
  clipsAwaitingRevenue: number;
  unmatchedSoldProducts: number;
};
```

- [ ] **Step 2: เพิ่มแท็บ dashboard**

ใน `components/workspace-tabs.tsx`:

เปลี่ยน type:
```tsx
export type WorkspaceTab = "brief" | "production" | "core" | "dashboard";
```

เพิ่มใน `TABS` (ต่อจาก core):
```tsx
  { id: "dashboard", label: "④ รายได้" },
```

- [ ] **Step 3: ดึงข้อมูล + คำนวณ reminder ใน page**

แทนที่ `app/page.tsx` ทั้งไฟล์:

```tsx
import { prisma } from "@/lib/prisma";
import { PromptWorkspace } from "@/components/prompt-workspace";
import { sortEntriesForRail } from "@/lib/entry-sort";
import { videoIdFromUrl } from "@/lib/affiliate";
import type { ReminderState } from "@/lib/dashboard";

const DAY_MS = 24 * 60 * 60 * 1000;
const IMPORT_STALE_DAYS = 7;
const CLIP_AWAITING_THRESHOLD = 3;

export default async function PoolingPrompt() {
  const [prompts, corePrompts, orders] = await Promise.all([
    prisma.promptEntry.findMany({
      orderBy: { createdAt: "desc" },
      include: { productImages: { orderBy: { sortOrder: "asc" } } },
    }),
    prisma.corePrompt.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.affiliateOrder.findMany({ orderBy: { orderDate: "asc" } }),
  ]);

  // reminder: ผ่านไปกี่วันจาก import ล่าสุด
  let daysSinceImport: number | null = null;
  if (orders.length > 0) {
    const last = Math.max(...orders.map((o) => o.importedAt.getTime()));
    daysSinceImport = Math.floor((Date.now() - last) / DAY_MS);
  }

  // คลิปที่มี videoUrl แต่ยังไม่มีออเดอร์จับคู่
  const matchedEntryIds = new Set(
    orders.map((o) => o.matchedEntryId).filter((v): v is string => v !== null)
  );
  const clipsAwaitingRevenue = prompts.filter(
    (p) => videoIdFromUrl(p.videoUrl) !== null && !matchedEntryIds.has(p.id)
  ).length;

  // สินค้าที่ขายได้แต่ยังไม่มี entry (content id ที่จับคู่ไม่ได้)
  const unmatchedSoldProducts = new Set(
    orders.filter((o) => o.matchedEntryId === null).map((o) => o.contentId)
  ).size;

  const reminder: ReminderState = {
    daysSinceImport,
    clipsAwaitingRevenue,
    unmatchedSoldProducts,
  };

  const reminderActive =
    (daysSinceImport !== null && daysSinceImport > IMPORT_STALE_DAYS) ||
    clipsAwaitingRevenue >= CLIP_AWAITING_THRESHOLD ||
    unmatchedSoldProducts > 0;

  return (
    <PromptWorkspace
      prompts={sortEntriesForRail(prompts)}
      corePrompts={corePrompts}
      affiliateOrders={orders}
      reminder={reminder}
      reminderActive={reminderActive}
    />
  );
}
```

- [ ] **Step 4: plumbing ใน prompt-workspace**

ใน `components/prompt-workspace.tsx`:

เพิ่ม import:
```tsx
import { DashboardPanel } from "@/components/dashboard-panel";
import { ReminderBanner } from "@/components/reminder-banner";
import type { AffiliateOrderRecord, ReminderState } from "@/lib/dashboard";
```

เพิ่ม type export (ใต้ `CorePromptRecord`):
```tsx
export type { AffiliateOrderRecord } from "@/lib/dashboard";
```

แก้ signature ของ `PromptWorkspace` ให้รับ props ใหม่:
```tsx
export function PromptWorkspace({
  prompts,
  corePrompts,
  affiliateOrders,
  reminder,
  reminderActive,
}: {
  prompts: PromptEntry[];
  corePrompts: CorePromptRecord[];
  affiliateOrders: AffiliateOrderRecord[];
  reminder: ReminderState;
  reminderActive: boolean;
}) {
```

ใส่ `<ReminderBanner>` ไว้ใต้ `<ClapperHeader>...</ClapperHeader>` (ก่อน `<div className="flex flex-1 ...">`):
```tsx
      {reminderActive && <ReminderBanner reminder={reminder} onGoImport={() => setTab("dashboard")} />}
```

เพิ่ม render แท็บ dashboard (ต่อจากบล็อก `{tab === "core" && ...}`):
```tsx
        {tab === "dashboard" && (
          <div className="flex flex-1 flex-col p-4 sm:p-6 lg:overflow-y-auto">
            <DashboardPanel orders={affiliateOrders} />
          </div>
        )}
```

- [ ] **Step 5: build + commit**

จะ error เพราะยังไม่มี `dashboard-panel.tsx` / `reminder-banner.tsx` — สร้าง stub ชั่วคราวก่อนเพื่อให้ build ผ่านใน task นี้:

สร้าง `components/dashboard-panel.tsx` (stub):
```tsx
"use client";
import type { AffiliateOrderRecord } from "@/lib/dashboard";
export function DashboardPanel({ orders }: { orders: AffiliateOrderRecord[] }) {
  return <div className="text-sm text-muted-foreground">Dashboard ({orders.length} ออเดอร์) — อยู่ระหว่างสร้าง</div>;
}
```

สร้าง `components/reminder-banner.tsx` (stub):
```tsx
"use client";
import type { ReminderState } from "@/lib/dashboard";
export function ReminderBanner({
  reminder,
  onGoImport,
}: {
  reminder: ReminderState;
  onGoImport: () => void;
}) {
  void reminder;
  void onGoImport;
  return null;
}
```

```bash
npm run build && npm run lint
git add lib/dashboard.ts app/page.tsx components/workspace-tabs.tsx components/prompt-workspace.tsx components/dashboard-panel.tsx components/reminder-banner.tsx
git commit -m "Wire affiliate orders through to a new dashboard tab (stubs)"
```

---

### Task 5: Dashboard panel — upload + สรุป + reconciliation

**Files:**
- Modify: `components/dashboard-panel.tsx` (แทน stub)

**Interfaces:**
- Consumes: `importAffiliateOrders` + `AffiliateImportSummary` (Task 3), `summarizeOrders`/`revenueByClip`/`ordersByStatus`/`ordersByDay` (Task 4)
- Produces: UI แท็บ ④ (ยังไม่มีกราฟ — Task 6 เติม)

- [ ] **Step 1: เขียน panel เต็ม**

แทนที่ `components/dashboard-panel.tsx` ทั้งไฟล์:

```tsx
"use client";

import { useActionState } from "react";
import { Upload, TriangleAlert } from "lucide-react";

import { importAffiliateOrders } from "@/app/actions";
import type { AffiliateImportSummary } from "@/app/actions";
import { summarizeOrders, type AffiliateOrderRecord } from "@/lib/dashboard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function baht(n: number): string {
  return "฿" + n.toLocaleString("th-TH", { maximumFractionDigits: 0 });
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4">
      <span className="font-mono text-[0.65rem] tracking-widest text-muted-foreground uppercase">
        {label}
      </span>
      <span className="font-display text-2xl text-foreground">{value}</span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

export function DashboardPanel({ orders }: { orders: AffiliateOrderRecord[] }) {
  const summary = summarizeOrders(orders);

  const [state, action, isImporting] = useActionState(
    async (
      _prev: { summary: AffiliateImportSummary | null; error: string | null },
      formData: FormData
    ) => {
      try {
        const summary = await importAffiliateOrders(formData);
        return { summary, error: null };
      } catch (e) {
        return {
          summary: null,
          error: e instanceof Error ? e.message : "อัปโหลดไม่สำเร็จ",
        };
      }
    },
    { summary: null, error: null }
  );

  return (
    <section className="flex flex-1 flex-col gap-5 rounded-xl border border-border bg-card p-5 sm:p-6">
      <div className="flex items-center gap-2 border-b border-border pb-3">
        <span className="h-4 w-1 rounded-full bg-marigold" />
        <h2 className="font-mono text-xs tracking-widest text-marigold uppercase">
          Dashboard · รายได้ Affiliate
        </h2>
      </div>

      {/* อัปโหลด */}
      <form action={action} className="flex flex-wrap items-center gap-2">
        <Input
          type="file"
          name="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="h-auto max-w-xs py-1.5"
          required
        />
        <Button
          type="submit"
          size="sm"
          disabled={isImporting}
          className="bg-rust text-primary-foreground hover:bg-rust/90"
        >
          <Upload className="size-3.5" />
          {isImporting ? "กำลังนำเข้า..." : "นำเข้าไฟล์รายได้"}
        </Button>
        <span className="font-mono text-[0.7rem] text-muted-foreground">
          โหลดจาก TikTok Studio → คำสั่งซื้อในโปรแกรมนายหน้า → ดาวน์โหลด (.xlsx)
        </span>
      </form>

      {state.error && (
        <p className="rounded-md border border-record/40 bg-record/10 px-3 py-2 text-sm text-record">
          {state.error}
        </p>
      )}

      {state.summary && (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
          นำเข้า {state.summary.total} ออเดอร์ · จับคู่คลิปได้ {state.summary.matched} ·
          ยังไม่มี entry {state.summary.unmatched}
          {state.summary.unmatchedProducts.length > 0 && (
            <div className="mt-2 flex flex-col gap-1 border-t border-border pt-2">
              <span className="flex items-center gap-1.5 font-medium text-foreground/90">
                <TriangleAlert className="size-3.5 text-marigold" />
                สินค้าที่ขายได้แต่ยังไม่มีในแอป — ควรเพิ่ม entry
              </span>
              {state.summary.unmatchedProducts.map((p) => (
                <span key={p.contentId} className="font-mono text-xs text-muted-foreground">
                  {p.productName || p.contentId} ({p.orders} ออเดอร์)
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {orders.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          ยังไม่มีข้อมูลรายได้ — นำเข้าไฟล์ด้านบนเพื่อเริ่ม
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="GMV รวม" value={baht(summary.totalGmv)} hint="ยอดสั่งทุกสถานะ" />
          <Tile
            label="เงินคอมที่ได้จริง"
            value={baht(summary.settledRevenue)}
            hint="settle แล้วเท่านั้น"
          />
          <Tile label="ออเดอร์" value={summary.orderCount.toLocaleString("th-TH")} />
          <Tile label="ชิ้นที่ขายได้" value={summary.itemCount.toLocaleString("th-TH")} />
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: build + lint + commit**

```bash
npm run build && npm run lint
git add components/dashboard-panel.tsx
git commit -m "Upload, summarize, and reconcile affiliate orders"
```

---

### Task 6: กราฟ (SVG วาดเอง)

**Files:**
- Create: `components/revenue-charts.tsx`
- Modify: `components/dashboard-panel.tsx` (เรียกกราฟ)

**Interfaces:**
- Consumes: `ordersByDay`/`revenueByClip`/`ordersByStatus` + `AffiliateOrderRecord` (Task 4)
- Produces: `RevenueCharts({ orders }: { orders: AffiliateOrderRecord[] })`

- [ ] **Step 1: เขียนกราฟ**

สร้าง `components/revenue-charts.tsx`:

```tsx
"use client";

import {
  ordersByDay,
  revenueByClip,
  ordersByStatus,
  type AffiliateOrderRecord,
} from "@/lib/dashboard";

function baht(n: number): string {
  return "฿" + n.toLocaleString("th-TH", { maximumFractionDigits: 0 });
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <h3 className="font-mono text-[0.7rem] tracking-widest text-smoke uppercase">
        {title}
      </h3>
      {children}
    </div>
  );
}

/** เส้น GMV ตามวัน */
function TimeChart({ orders }: { orders: AffiliateOrderRecord[] }) {
  const data = ordersByDay(orders);
  if (data.length === 0) return null;
  const W = 640;
  const H = 180;
  const pad = 28;
  const maxGmv = Math.max(...data.map((d) => d.gmv), 1);
  const n = data.length;
  const x = (i: number) => pad + (n === 1 ? 0 : (i / (n - 1)) * (W - 2 * pad));
  const y = (v: number) => H - pad - (v / maxGmv) * (H - 2 * pad);
  const line = data.map((d, i) => `${x(i)},${y(d.gmv)}`).join(" ");
  const area = `${x(0)},${H - pad} ${line} ${x(n - 1)},${H - pad}`;

  return (
    <ChartCard title="GMV ตามวัน">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="กราฟ GMV ตามวัน">
        <polygon points={area} className="fill-marigold/15" />
        <polyline
          points={line}
          className="fill-none stroke-rust"
          strokeWidth={2}
          strokeLinejoin="round"
        />
        {data.map((d, i) => (
          <circle key={d.date} cx={x(i)} cy={y(d.gmv)} r={2.5} className="fill-rust" />
        ))}
        <text x={pad} y={H - 8} className="fill-muted-foreground text-[10px]">
          {data[0].date.slice(5)}
        </text>
        <text x={W - pad} y={H - 8} textAnchor="end" className="fill-muted-foreground text-[10px]">
          {data[n - 1].date.slice(5)}
        </text>
        <text x={pad} y={16} className="fill-muted-foreground text-[10px]">
          สูงสุด {baht(maxGmv)}/วัน
        </text>
      </svg>
    </ChartCard>
  );
}

/** แท่งรายได้ต่อคลิป (จ่ายแล้ว vs รอ) */
function ClipChart({ orders }: { orders: AffiliateOrderRecord[] }) {
  const clips = revenueByClip(orders).slice(0, 10);
  if (clips.length === 0) return null;
  const max = Math.max(...clips.map((c) => c.gmv), 1);

  return (
    <ChartCard title="รายได้ต่อคลิป (บน 10)">
      <div className="flex flex-col gap-2.5">
        {clips.map((c) => (
          <div key={c.contentId} className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-foreground/90">
                {c.productName || c.contentId}
                {c.matchedEntryId === null && (
                  <span className="ml-1 text-marigold">(ยังไม่มี entry)</span>
                )}
              </span>
              <span className="shrink-0 font-mono text-muted-foreground">
                {baht(c.gmv)} · {c.orders} ออเดอร์
              </span>
            </div>
            <div className="flex h-3 overflow-hidden rounded-full bg-muted">
              <div
                className="bg-marigold"
                style={{ width: `${(c.paidGmv / max) * 100}%` }}
                title="จ่ายแล้ว"
              />
              <div
                className="bg-smoke/50"
                style={{ width: `${(c.pendingGmv / max) * 100}%` }}
                title="รอ/ยังไม่จ่าย"
              />
            </div>
          </div>
        ))}
        <div className="flex gap-4 pt-1 font-mono text-[0.65rem] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="inline-block size-2 rounded-full bg-marigold" /> จ่ายแล้ว
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block size-2 rounded-full bg-smoke/50" /> รอ/ยังไม่จ่าย
          </span>
        </div>
      </div>
    </ChartCard>
  );
}

/** แยกตามสถานะ */
function StatusChart({ orders }: { orders: AffiliateOrderRecord[] }) {
  const rows = ordersByStatus(orders);
  if (rows.length === 0) return null;
  const total = rows.reduce((s, r) => s + r.count, 0);

  return (
    <ChartCard title="แยกตามสถานะ">
      <div className="flex flex-col gap-2">
        {rows.map((r) => (
          <div key={r.status} className="flex items-center gap-2 text-xs">
            <span className="w-28 shrink-0 truncate text-foreground/90">{r.status}</span>
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-rust"
                style={{ width: `${(r.count / total) * 100}%` }}
              />
            </div>
            <span className="w-24 shrink-0 text-right font-mono text-muted-foreground">
              {r.count} · {baht(r.gmv)}
            </span>
          </div>
        ))}
      </div>
    </ChartCard>
  );
}

export function RevenueCharts({ orders }: { orders: AffiliateOrderRecord[] }) {
  if (orders.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      <TimeChart orders={orders} />
      <div className="grid gap-3 lg:grid-cols-2">
        <ClipChart orders={orders} />
        <StatusChart orders={orders} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: เรียกกราฟใน panel**

ใน `components/dashboard-panel.tsx` เพิ่ม import:
```tsx
import { RevenueCharts } from "@/components/revenue-charts";
```

ใต้บล็อกตัวเลขสรุป (หลัง `</div>` ที่ปิด grid ของ Tile) เพิ่ม — วางก่อน `</section>` ปิดท้าย:
```tsx
      {orders.length > 0 && <RevenueCharts orders={orders} />}
```

- [ ] **Step 3: build + lint + commit**

```bash
npm run build && npm run lint
git add components/revenue-charts.tsx components/dashboard-panel.tsx
git commit -m "Add revenue charts (time, per-clip, status)"
```

---

### Task 7: Reminder banner

**Files:**
- Modify: `components/reminder-banner.tsx` (แทน stub)

**Interfaces:**
- Consumes: `ReminderState` (Task 4)
- Produces: banner ที่ dismiss ได้ (จำการปิดใน localStorage ตามลายเซ็นของ state)

- [ ] **Step 1: เขียน banner เต็ม**

แทนที่ `components/reminder-banner.tsx` ทั้งไฟล์:

```tsx
"use client";

import { useEffect, useState } from "react";
import { BellRing, X } from "lucide-react";

import type { ReminderState } from "@/lib/dashboard";
import { Button } from "@/components/ui/button";

function messages(r: ReminderState): string[] {
  const out: string[] = [];
  if (r.daysSinceImport !== null && r.daysSinceImport > 7) {
    out.push(`ไม่ได้นำเข้าข้อมูลรายได้มา ${r.daysSinceImport} วันแล้ว`);
  }
  if (r.clipsAwaitingRevenue >= 3) {
    out.push(`มี ${r.clipsAwaitingRevenue} คลิปที่ยังไม่มีข้อมูลรายได้`);
  }
  if (r.unmatchedSoldProducts > 0) {
    out.push(`มี ${r.unmatchedSoldProducts} สินค้าที่ขายได้แต่ยังไม่มีในแอป`);
  }
  return out;
}

export function ReminderBanner({
  reminder,
  onGoImport,
}: {
  reminder: ReminderState;
  onGoImport: () => void;
}) {
  const msgs = messages(reminder);
  // ลายเซ็นของสถานะ — ถ้าเปลี่ยน (มีข้อมูลใหม่) banner จะกลับมาแสดง
  const signature = `${reminder.daysSinceImport}|${reminder.clipsAwaitingRevenue}|${reminder.unmatchedSoldProducts}`;
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem("reminder-dismissed");
    setDismissed(saved === signature);
  }, [signature]);

  if (msgs.length === 0 || dismissed) return null;

  return (
    <div className="mx-4 mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-marigold/40 bg-marigold/10 px-3 py-2 text-sm sm:mx-6">
      <BellRing className="size-4 shrink-0 text-marigold" />
      <span className="text-foreground/90">{msgs.join(" · ")}</span>
      <div className="ml-auto flex items-center gap-1.5">
        <Button
          type="button"
          size="sm"
          onClick={onGoImport}
          className="bg-marigold text-ink hover:bg-marigold/90"
        >
          ไปที่ Dashboard
        </Button>
        <button
          type="button"
          aria-label="ปิด"
          onClick={() => {
            localStorage.setItem("reminder-dismissed", signature);
            setDismissed(true);
          }}
          className="rounded p-1 text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: build + lint + commit**

```bash
npm run build && npm run lint
git add components/reminder-banner.tsx
git commit -m "Remind when revenue data is stale or clips are unlinked"
```

---

### Task 8: ทดสอบ end-to-end + CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: ขับจริงในเบราว์เซอร์**

เคลียร์ port 3000 ก่อน แล้วสตาร์ท dev server:
```bash
netstat -ano | grep ':3000' | grep LISTENING   # ถ้ามี PID: taskkill //PID <pid> //F
npm run dev &
timeout 60 bash -c 'until curl -sf http://localhost:3000 >/dev/null; do sleep 1; done' && echo UP
```

ติดตั้ง Playwright ใน scratchpad แล้วเขียน `$SCRATCH/dashboard-e2e.js` ให้ครอบคลุม:
1. ไปแท็บ **④ รายได้**
2. `setInputFiles('input[name="file"]', '<repo>/affiliate_orders_7661818732840453895.xlsx')` แล้วกด **นำเข้าไฟล์รายได้**
3. รอสรุป → ตรวจว่าขึ้น "นำเข้า 83 ออเดอร์" และ "จับคู่คลิปได้" > 0
4. ตรวจว่าตัวเลข **GMV รวม** และ **เงินคอมที่ได้จริง** โผล่ (ไม่ว่าง) และ GMV รวม >> เงินคอม (ยืนยันว่าแยกถูก)
5. ตรวจว่า SVG กราฟ (`svg[aria-label="กราฟ GMV ตามวัน"]`) มีอยู่ และมีแท่งรายได้ต่อคลิป
6. reload → ข้อมูลยังอยู่ (persist)
7. **โยนไฟล์เดิมซ้ำอีกครั้ง** → ตรวจว่าสรุปยังเป็น 83 (ไม่กลายเป็น 166 — dedup ทำงาน)
8. ไม่มี console error, ไม่มี emoji ในหน้า (grep DOM หา emoji ที่พบบ่อยแล้วต้องไม่เจอ)

รายงานผลจริงเป็นตัวเลข ห้ามสรุปว่า "น่าจะผ่าน"

- [ ] **Step 2: ตรวจ DB หลังทดสอบ**

```bash
node -e "
const D=require('better-sqlite3');const db=new D('dev.db',{readonly:true});
console.log('orders:', db.prepare('SELECT COUNT(*) c FROM AffiliateOrder').get().c);
console.log('matched:', db.prepare('SELECT COUNT(*) c FROM AffiliateOrder WHERE matchedEntryId IS NOT NULL').get().c);
console.log('entries:', db.prepare('SELECT COUNT(*) c FROM PromptEntry').get().c);
db.close();"
```
คาดหวัง: `orders: 83`, `matched: ~79` (ออเดอร์ที่ content id ตรงกับ videoUrl ในแอป), `entries: 19`

> หมายเหตุ: ข้อมูล affiliate ที่ import คือข้อมูลจริงของผู้ใช้ ไม่ต้องลบทิ้ง (เป็นของจริงที่ควรอยู่ต่อ) — ต่างจาก entry ทดสอบที่สร้างเอง ที่นี่ **ไม่ต้องมี cleanup** เพราะไม่ได้สร้าง entry ปลอม แค่ import ไฟล์รายได้จริง

- [ ] **Step 3: ปิด dev server**

```bash
netstat -ano | grep ':3000' | grep LISTENING
taskkill //PID <pid> //F
```

- [ ] **Step 4: อัปเดต CLAUDE.md**

เพิ่ม section ใหม่ต่อจาก `## Gemini API`:

```
## Dashboard รายได้ (แท็บ ④)

- ตาราง `AffiliateOrder` เก็บออเดอร์ระดับต่อออเดอร์ (dedup ด้วย `orderId`) นำเข้าจากไฟล์ xlsx ที่ผู้ใช้โหลดเองจาก TikTok Studio (ไม่มี API — โหลดมือเท่านั้น)
- `lib/affiliate.ts` เป็นไฟล์เดียวที่รู้จัก SheetJS (`xlsx`) — parse ด้วย `sheet_to_json({header:1, raw:false})` อ้างคอลัมน์ตาม index (ไฟล์ใช้ inline strings ไม่มี sharedStrings, วันที่รูปแบบ `DD/MM/YYYY HH:MM:SS`) คอลัมน์ที่ใช้: 0=orderId 2=ชื่อ 3=รหัสสินค้า 5=จำนวน 13=สถานะ 17=รหัสเนื้อหา 23=GMV 34=ค่าคอมจริง 44=รายได้สุดท้าย 45=วันที่
- **จับคู่ออเดอร์กับคลิปด้วย content ID (col 17) = video id ใน `PromptEntry.videoUrl`** (ดึงด้วย `videoIdFromUrl`) ห้ามจับด้วยชื่อสินค้า — สินค้าเดียวมีได้หลายคลิป
- **GMV ≠ เงินจริง** — `summarizeOrders` แยก `totalGmv` (ทุกสถานะ) กับ `settledRevenue` (`finalRevenue` ที่ settle แล้ว) สถานะจ่ายแล้ว = `PAID_STATUS` (`"ชำระแล้ว"`)
- `lib/dashboard.ts` เป็น aggregation ล้วน (pure) · กราฟใน `components/revenue-charts.tsx` วาดเองด้วย SVG ไม่มี chart library · reminder banner เตือนเมื่อข้อมูลเก่า >7 วัน / มีคลิปยังไม่มีรายได้ / มีสินค้าขายได้ที่ยังไม่มี entry
- ไฟล์ตัวอย่างจริง `affiliate_orders_*.xlsx` gitignore ไว้ — ห้าม commit
```

- [ ] **Step 5: build + commit**

```bash
npm run build && npm run lint
git add CLAUDE.md
git commit -m "Document the affiliate revenue dashboard"
```

---

## Verification (ทั้งฟีเจอร์)

- `npm run build` + `npm run lint` สะอาด
- นำเข้าไฟล์จริง → 83 ออเดอร์, จับคู่ contentId ถูก (ที่ลับเล็บแมว 64 → คลิป `7656417754160958737`)
- ตัวเลขสรุป: GMV รวม ~฿15,430 · เงินคอม settle ~฿543 (แยกกันชัด)
- โยนไฟล์เดิมซ้ำ → ยังเป็น 83 ออเดอร์ (dedup)
- reconciliation โชว์สินค้าที่ยังไม่มี entry (เช่นโต๊ะรีดผ้า content id `7644932675983248658`)
- กราฟ 3 ตัว render, ไม่มี console error, **ไม่มี emoji ใน UI**
- reminder banner เด้งถูกเงื่อนไข + dismiss ได้
- ข้อมูลจริง 19 entries + Core Prompt ไม่หาย

## Git

แตก branch ใหม่จาก `master`: `feature/affiliate-dashboard`
