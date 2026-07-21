# Recommender Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ให้แอปบอกเองว่า "ควรทำอะไรต่อ" โดยวิเคราะห์คลิปด้วยสองแกน (วิว × conversion) จากข้อมูลจริงที่ import เข้ามา แทนที่ผู้ใช้จะต้องเอาข้อมูลไปถาม AI ทีละครั้ง

**Architecture:** เพิ่ม pipeline ที่ 2 สำหรับข้อมูล content (วิว/engagement) จาก TikTok Studio CSV เก็บเป็น snapshot ต่อการ import (จำเป็น เพราะไฟล์ให้ยอดสะสม ไม่มีวิวรายวัน) แล้ววิเคราะห์ด้วย detector ที่เป็น pure function ล้วน ไม่เรียก LLM แสดงผลเป็น section แยกใน Dashboard

**Tech Stack:** Next.js 16 (custom build, App Router + Server Actions), Prisma 7 + better-sqlite3 adapter, React 19, Tailwind v4, Base UI

## Global Constraints

- **ไม่มี test runner** — verify ทุก task ด้วย `npm run build` (type-check ในตัว) + `npm run lint` + รันจริง ไม่ใช่ unit test
- **เช็ก port 3000 ก่อนรัน `npm run build` เสมอ** (`netstat -ano | grep ':3000' | grep LISTENING`) — ถ้ามี process อยู่ **ห้าม kill และห้ามรัน build** ให้หยุดแล้วรายงาน BLOCKED (`.next` พังได้ถ้า build ทับ `start.bat` ของผู้ใช้ ตาม CLAUDE.md) — เคยเกิดปัญหานี้มาแล้ว 2 ครั้ง
- **Prisma 7 driver adapter** — import client จาก `@/lib/generated/prisma/client` เท่านั้น หลังแก้ schema ต้อง `npx prisma migrate dev` แล้ว `npx prisma generate` ถ้า migrate เสนอ reset/destructive ให้หยุดทันทีแล้วรายงาน BLOCKED
- **ห้ามแตะ `PromptEntry.postedAt` semantics** (เก็บเป็น UTC midnight) และห้ามสลับ `toDateInputValue` / `toLocalDateInputValue` ใน `production-panel.tsx` — ใช้ตัวผิดวันที่เพี้ยนไป 1 วัน
- **ห้ามเขียน `dev.db` ด้วย standalone script** (โดน classifier บล็อก) — เขียนผ่านแอป/Prisma เท่านั้น สคริปต์ตรวจสอบต้องเปิดด้วย `{readonly: true}` และ `require()` better-sqlite3 ด้วย absolute path เข้า `node_modules` ของ repo
- **runtime LLM ต้องเป็น Gemini free tier เท่านั้น** — ฟีเจอร์นี้ไม่เรียก LLM เลย ห้ามเพิ่มการเรียก
- **UI: ห้าม emoji · ข้อความไทย · ใช้ design token เดิม** (`ink`/`paper`/`marigold`/`rust`/`smoke`/`record`) ห้ามเพิ่มสี/ฟอนต์ใหม่
- **ห้าม `git add -A` / `git add .`** — stage เฉพาะไฟล์ที่ระบุในแต่ละ task (`creative_data/` ถูก gitignore แล้ว แต่ยังต้องระวัง)
- **branch:** ทำทั้งหมดบน `feature/recommender` (มี spec commit `a89adeb` อยู่แล้ว)
- **ค่าคงที่จาก spec ที่ต้องใช้เป๊ะ:** `MIN_VIEWS_FOR_CONV = 500` · `MIN_ORDERS_FOR_CONV = 2` · `MAX_BAD_RATIO = 0.3` · emerging: `viewDelta ≥ medianViews` และ `conv ≥ 0.8 × channelConv` · hidden-gem: `conv ≥ 1.3 × channelConv` และ `views < medianViews` · reach-no-convert: `views ≥ 2 × medianViews` และ `conv ≤ 0.5 × channelConv` · fading: `viewDelta < 0.05 × views` และไม่มีออเดอร์ 7 วัน

---

### Task 1: Schema — ClipMetric + postedTimeOfDay + migration

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: model `ClipMetric` (Task 3 เขียน, Task 4 อ่าน) · `PromptEntry.postedTimeOfDay: string | null` (Task 6 ใช้)

- [ ] **Step 1: เพิ่ม model ClipMetric และ field ใหม่ใน PromptEntry**

ใน `prisma/schema.prisma` เพิ่ม 2 บรรทัดใน `PromptEntry` (วางต่อจาก `affiliateOrders`):

```prisma
  postedTimeOfDay String?
  clipMetrics     ClipMetric[]
```

แล้วเพิ่ม model ใหม่ต่อท้ายไฟล์:

```prisma
model ClipMetric {
  id             String       @id @default(cuid())
  videoId        String
  matchedEntryId String?
  matchedEntry   PromptEntry? @relation(fields: [matchedEntryId], references: [id], onDelete: SetNull)
  title          String
  postedDate     String
  views          Int
  likes          Int
  comments       Int
  shares         Int
  capturedOn     DateTime
  importedAt     DateTime     @default(now())

  @@unique([videoId, capturedOn])
  @@index([matchedEntryId])
}
```

- [ ] **Step 2: รัน migration + regenerate client**

เช็ก port 3000 ก่อน ถ้าว่างจึงรัน:

Run: `npx prisma migrate dev --name add_clip_metric_and_posted_time`
Expected: migration ใหม่ใน `prisma/migrations/`, ไม่มี data loss warning (เพิ่มตารางใหม่ + คอลัมน์ nullable)

Run: `npx prisma generate`
Expected: สำเร็จ

- [ ] **Step 3: Verify แบบ readonly**

เขียนไฟล์ scratch (นอก repo) `check-schema.js`:

```js
const D = require('C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt/node_modules/better-sqlite3');
const db = new D('C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt/dev.db', { readonly: true });
console.log('ตาราง:', db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%'").all().map(r => r.name).join(', '));
console.log('คอลัมน์ ClipMetric:', db.prepare («PRAGMA table_info(ClipMetric)»).all().map(c => c.name).join(', '));
console.log('PromptEntry มี postedTimeOfDay:', db.prepare("PRAGMA table_info(PromptEntry)").all().some(c => c.name === 'postedTimeOfDay'));
console.log('ข้อมูลเดิมยังอยู่ — entries:', db.prepare('SELECT COUNT(*) c FROM PromptEntry').get().c, '| orders:', db.prepare('SELECT COUNT(*) c FROM AffiliateOrder').get().c);
db.close();
```

หมายเหตุ: บรรทัด `PRAGMA table_info(ClipMetric)` ให้เขียนเป็น string ปกติด้วย double quote — ตัวอย่างข้างบนใช้ guillemet เพื่อไม่ให้ nested quote พังตอนอ่าน plan เท่านั้น

Run: `node <scratch>/check-schema.js`
Expected: มีตาราง `ClipMetric` พร้อมคอลัมน์ครบ · `PromptEntry` มี `postedTimeOfDay` · entries = 41, orders = 209 (ข้อมูลเดิมไม่หาย)

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: สำเร็จ

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "Add ClipMetric snapshots and postedTimeOfDay to the schema"
```

---

### Task 2: CSV parser — `lib/clip-metrics.ts`

**Files:**
- Create: `lib/clip-metrics.ts`

**Interfaces:**
- Consumes: `videoIdFromUrl` จาก `lib/affiliate.ts` (มีอยู่แล้ว: `(url: string) => string | null`)
- Produces: `type ClipMetricInput` · `parseContentCsv(text: string, importedAt: Date): ClipMetricInput[]` (Task 3 เรียก)

**บริบทของไฟล์ที่ parse** (`creative_data/Content_rainny0192/Content.csv`): เป็น CSV ไม่ใช่ xlsx · มี BOM (`﻿`) นำหน้า · ทุก field ครอบด้วย double quote · caption มี comma และ `#hashtag` อยู่ข้างใน จึงต้อง parse แบบรองรับ quoted field · คอลัมน์ `Time` คือวันที่ export (as-of) เหมือนกันทุกแถว และ **ไม่มีปี** (เช่น `July 21`)

- [ ] **Step 1: เขียนไฟล์ `lib/clip-metrics.ts`**

```ts
import { videoIdFromUrl } from "@/lib/affiliate";

export type ClipMetricInput = {
  videoId: string;
  title: string;
  postedDate: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  capturedOn: Date;
};

// ตำแหน่งคอลัมน์ (0-based) ในไฟล์ Content.csv ของ TikTok Studio
const COL = {
  time: 0,
  title: 1,
  link: 2,
  postTime: 3,
  likes: 4,
  comments: 5,
  shares: 6,
  views: 7,
} as const;

const MONTHS: Record<string, number> = {
  January: 0, February: 1, March: 2, April: 3, May: 4, June: 5,
  July: 6, August: 7, September: 8, October: 9, November: 10, December: 11,
};

/**
 * ไฟล์ครอบทุก field ด้วย double quote และ caption มี comma อยู่ข้างใน — split(",") เฉยๆ จะพัง
 * เขียน parser เองแทนการลง dependency ใหม่ (โปรเจกต์มี xlsx อยู่แล้วแต่ไฟล์นี้เป็น CSV)
 */
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

/**
 * คอลัมน์ Time เป็น "July 21" ไม่มีปี — เดาปีจากวันที่ import
 * ถ้าวันที่ที่ได้ล้ำอนาคตเกิน 1 วันจากวันที่ import แปลว่าเป็นปีก่อน (เช่น import ต้นมกราแต่ไฟล์ลงเดือนธันวา)
 */
function parseAsOfDate(label: string, importedAt: Date): Date | null {
  const m = label.trim().match(/^([A-Za-z]+)\s+(\d{1,2})$/);
  if (!m) return null;
  const month = MONTHS[m[1]];
  if (month === undefined) return null;
  const day = Number(m[2]);

  let year = importedAt.getFullYear();
  let d = new Date(Date.UTC(year, month, day));
  if (d.getTime() - importedAt.getTime() > 24 * 60 * 60 * 1000) {
    year -= 1;
    d = new Date(Date.UTC(year, month, day));
  }
  return d;
}

function num(v: unknown): number {
  const n = parseInt(String(v ?? "").replace(/,/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

export function parseContentCsv(text: string, importedAt: Date): ClipMetricInput[] {
  // ไฟล์จาก TikTok Studio มี BOM นำหน้า ถ้าไม่ตัด ชื่อคอลัมน์แรกจะเพี้ยนและ parse ผิด
  const rows = parseCsvRows(text.replace(/^﻿/, ""));
  if (rows.length < 2) return [];

  const out: ClipMetricInput[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const videoId = videoIdFromUrl(String(r[COL.link] ?? ""));
    if (!videoId) continue;
    const capturedOn = parseAsOfDate(String(r[COL.time] ?? ""), importedAt);
    if (!capturedOn) continue;

    out.push({
      videoId,
      title: String(r[COL.title] ?? "").trim(),
      postedDate: String(r[COL.postTime] ?? "").trim(),
      views: num(r[COL.views]),
      likes: num(r[COL.likes]),
      comments: num(r[COL.comments]),
      shares: num(r[COL.shares]),
      capturedOn,
    });
  }
  return out;
}
```

- [ ] **Step 2: Verify กับไฟล์จริง**

เขียนไฟล์ scratch (นอก repo) `check-parser.js` — เรียกผ่าน build output ไม่ได้ จึงตรวจด้วยการ replicate logic ไม่ได้เช่นกัน ให้ตรวจด้วย `npm run build` (type-check) + ตรวจสายตาว่า index คอลัมน์ตรงกับ header จริง:

Run: `head -1 creative_data/Content_rainny0192/Content.csv`
Expected: `"Time","Video title","Video link","Post time","Total likes","Total comments","Total shares","Total views"` — ยืนยันว่า `COL` ตรงกับลำดับจริงทุกตัว

Run: `wc -l < creative_data/Content_rainny0192/Content.csv`
Expected: `15` (header 1 + วิดีโอ 14 บรรทัด แต่มีบรรทัดสุดท้ายไม่ขึ้นบรรทัดใหม่ → parser จะได้ 15 แถวข้อมูล ยืนยันจริงอีกทีใน Task 3)

- [ ] **Step 3: Verify build + lint**

Run: `npm run build`
Expected: สำเร็จ ไม่มี type error

Run: `npm run lint`
Expected: ไม่มี warning ใหม่

- [ ] **Step 4: Commit**

```bash
git add lib/clip-metrics.ts
git commit -m "Add Content.csv parser for clip view metrics"
```

---

### Task 3: Import action + ช่องอัปโหลด + ส่งข้อมูลเข้าหน้า

**Files:**
- Modify: `app/actions.ts` (เพิ่ม `importClipMetrics`)
- Modify: `app/page.tsx` (ดึง `clipMetrics`)
- Modify: `components/prompt-workspace.tsx` (รับ prop ส่งต่อ)
- Modify: `components/dashboard-panel.tsx` (ช่องอัปโหลด CSV)

**Interfaces:**
- Consumes: `parseContentCsv` (Task 2) · `ClipMetric` model (Task 1) · `videoIdFromUrl` จาก `lib/affiliate.ts`
- Produces: `importClipMetrics(formData: FormData): Promise<ClipMetricImportSummary>` · prop `clipMetrics: ClipMetricRecord[]` ไหลถึง `DashboardPanel` (Task 5 ใช้)

- [ ] **Step 1: เพิ่ม `importClipMetrics` ใน `app/actions.ts`**

เพิ่ม import ที่หัวไฟล์ (ต่อจาก import ของ `parseAffiliateXlsx`):

```ts
import { parseContentCsv } from "@/lib/clip-metrics";
```

แล้วเพิ่ม action ต่อจาก `importAffiliateOrders`:

```ts
export type ClipMetricImportSummary = {
  total: number;
  matched: number;
  unmatched: number;
};

export async function importClipMetrics(
  formData: FormData
): Promise<ClipMetricImportSummary> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("กรุณาเลือกไฟล์ Content (.csv)");
  }

  const text = await file.text();
  const importedAt = new Date();
  let metrics;
  try {
    metrics = parseContentCsv(text, importedAt);
  } catch {
    throw new Error("อ่านไฟล์ไม่สำเร็จ — ต้องเป็นไฟล์ Content (.csv) จาก TikTok Studio");
  }
  if (metrics.length === 0) {
    throw new Error("ไม่พบข้อมูลคลิปในไฟล์");
  }

  const entries = await prisma.promptEntry.findMany({
    select: { id: true, videoUrl: true },
  });
  const videoToEntry = new Map<string, string>();
  for (const e of entries) {
    const vid = videoIdFromUrl(e.videoUrl);
    if (vid) videoToEntry.set(vid, e.id);
  }

  // upsert ด้วย (videoId, capturedOn) — โยนไฟล์เดิมซ้ำได้ ไม่เกิด snapshot ซ้ำ
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

  const matched = metrics.filter((m) => videoToEntry.has(m.videoId)).length;
  revalidatePath("/");
  return { total: metrics.length, matched, unmatched: metrics.length - matched };
}
```

- [ ] **Step 2: ดึง `clipMetrics` ใน `app/page.tsx`**

แก้ `Promise.all` ให้ดึงเพิ่ม (เติมเป็นตัวที่ 4):

```ts
  const [prompts, corePrompts, orders, clipMetrics] = await Promise.all([
    prisma.promptEntry.findMany({
      orderBy: { createdAt: "desc" },
      include: { productImages: { orderBy: { sortOrder: "asc" } } },
    }),
    prisma.corePrompt.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.affiliateOrder.findMany({ orderBy: { orderDate: "asc" } }),
    prisma.clipMetric.findMany({ orderBy: { capturedOn: "asc" } }),
  ]);
```

แล้วส่งเข้า `<PromptWorkspace>` เพิ่ม prop:

```tsx
      clipMetrics={clipMetrics}
```

- [ ] **Step 3: ส่ง prop ผ่าน `prompt-workspace.tsx`**

เพิ่ม type ใกล้ๆ ที่ประกาศ `AffiliateOrderRecord` import:

```ts
import type { ClipMetricRecord } from "@/lib/recommender";
```

หมายเหตุ: `lib/recommender.ts` ยังไม่มีใน Task นี้ — **ให้ประกาศ type ไว้ใน `components/prompt-workspace.tsx` ชั่วคราวแทน** เพื่อไม่ให้ build พังก่อน Task 4:

```ts
export type ClipMetricRecord = {
  id: string;
  videoId: string;
  matchedEntryId: string | null;
  title: string;
  postedDate: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  capturedOn: Date;
  importedAt: Date;
};
```

เพิ่มใน props ของ `PromptWorkspace` (ทั้งใน type และ destructure) แล้วส่งต่อให้ `<DashboardPanel clipMetrics={clipMetrics} />`

- [ ] **Step 4: เพิ่มช่องอัปโหลดใน `components/dashboard-panel.tsx`**

เพิ่ม import:

```ts
import { importClipMetrics } from "@/app/actions";
import type { ClipMetricImportSummary } from "@/app/actions";
```

เพิ่ม state สำหรับ action ที่สอง (วางถัดจาก `useActionState` เดิม):

```ts
  const [metricState, metricAction, isImportingMetrics] = useActionState<
    { summary: ClipMetricImportSummary | null; error: string | null },
    FormData
  >(
    async (_prev, formData) => {
      try {
        const summary = await importClipMetrics(formData);
        return { summary, error: null };
      } catch (e) {
        return { summary: null, error: e instanceof Error ? e.message : "อัปโหลดไม่สำเร็จ" };
      }
    },
    { summary: null, error: null }
  );
```

เพิ่มฟอร์มที่สองต่อจากฟอร์ม affiliate เดิม (ก่อนบรรทัดสถานะ):

```tsx
      <form action={metricAction} className="flex flex-wrap items-center gap-2">
        <Input
          type="file"
          name="file"
          accept=".csv,text/csv"
          className="h-auto max-w-xs py-1.5"
          required
        />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={isImportingMetrics}
        >
          <Upload className="size-3.5" />
          {isImportingMetrics ? "กำลังนำเข้า..." : "นำเข้าข้อมูลวิว"}
        </Button>
        <span className="font-mono text-[0.7rem] text-muted-foreground">
          โหลดจาก TikTok Studio → Analytics → Content → Download (.csv)
        </span>
      </form>

      {metricState.error && (
        <p className="rounded-md border border-record/40 bg-record/10 px-3 py-2 text-sm text-record">
          {metricState.error}
        </p>
      )}

      {metricState.summary && (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
          นำเข้า {metricState.summary.total} คลิป · จับคู่ได้ {metricState.summary.matched} ·
          ไม่มีในแอป {metricState.summary.unmatched}
        </div>
      )}
```

เพิ่ม `clipMetrics: ClipMetricRecord[]` ใน props ของ `DashboardPanel` (รับไว้ก่อน ยังไม่ใช้จนถึง Task 5)

- [ ] **Step 5: Verify build + lint**

Run: `npm run build`
Expected: สำเร็จ

Run: `npm run lint`
Expected: ไม่มี warning ใหม่ (ถ้ามี warning เรื่อง `clipMetrics` ไม่ถูกใช้ ให้ปล่อยไว้ — Task 5 จะใช้ แต่ถ้า lint ตั้งเป็น error ให้รายงานแทนการใส่ eslint-disable มั่ว)

- [ ] **Step 6: Verify import จริง**

เปิดแอป (ถ้า port 3000 ว่างเท่านั้น ใช้ `npm run dev`) แล้วอัปโหลด `creative_data/Content_rainny0192/Content.csv` ผ่านช่อง "นำเข้าข้อมูลวิว"
Expected: สรุปขึ้นว่า **นำเข้า 15 คลิป · จับคู่ได้ 13 · ไม่มีในแอป 2**

จากนั้นตรวจ DB แบบ readonly:

```js
const D = require('C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt/node_modules/better-sqlite3');
const db = new D('C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt/dev.db', { readonly: true });
console.log('ClipMetric rows:', db.prepare('SELECT COUNT(*) c FROM ClipMetric').get().c);
console.log('จับคู่ได้:', db.prepare('SELECT COUNT(*) c FROM ClipMetric WHERE matchedEntryId IS NOT NULL').get().c);
for (const r of db.prepare('SELECT title, views, capturedOn FROM ClipMetric ORDER BY views DESC LIMIT 3').all()) console.log(r.views, '|', String(r.title).slice(0, 30), '|', r.capturedOn);
db.close();
```
Expected: 15 แถว, จับคู่ได้ 13, วิวสูงสุด 63053

**อัปโหลดไฟล์เดิมซ้ำอีกครั้ง** → Expected: `ClipMetric` ยังมี **15 แถวเท่าเดิม** (unique constraint ทำงาน ไม่เกิด snapshot ซ้ำ)

- [ ] **Step 7: Commit**

```bash
git add app/actions.ts app/page.tsx components/prompt-workspace.tsx components/dashboard-panel.tsx
git commit -m "Import TikTok content metrics as per-import snapshots"
```

---

### Task 4: Detector — `lib/recommender.ts`

**Files:**
- Create: `lib/recommender.ts`
- Modify: `components/prompt-workspace.tsx` (ย้าย `ClipMetricRecord` ไปใช้ของ recommender)

**Interfaces:**
- Produces: `type ClipMetricRecord` · `type ClipSignal` · `type ClipSignalKind` · `buildClipStats(...)` · `detectSignals(stats: ClipStat[]): ClipSignal[]` (Task 5 เรียก)

**เป็น pure function ล้วน** — ไม่ import prisma ไม่เรียก LLM ไม่อ่าน `Date.now()` ในตัว detector (รับ `now` เข้ามาเป็นพารามิเตอร์) เพื่อให้ผลลัพธ์ deterministic แบบเดียวกับ `lib/dashboard.ts`

- [ ] **Step 1: เขียน `lib/recommender.ts`**

```ts
import { PAID_STATUS } from "@/lib/affiliate";
import { INELIGIBLE_STATUS, type AffiliateOrderRecord } from "@/lib/dashboard";

export type ClipMetricRecord = {
  id: string;
  videoId: string;
  matchedEntryId: string | null;
  title: string;
  postedDate: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  capturedOn: Date;
  importedAt: Date;
};

export type ClipSignalKind = "emerging" | "hidden-gem" | "reach-no-convert" | "fading";

export type ClipSignal = {
  kind: ClipSignalKind;
  entryId: string;
  productName: string;
  headline: string;
  detail: string;
  strength: number;
};

export type ClipStat = {
  entryId: string;
  productName: string;
  views: number;
  viewDelta: number | null;
  orders: number;
  badOrders: number;
  ordersLast7Days: number;
};

/** ต้องมีวิวถึงเกณฑ์ก่อนจึงเชื่อ conversion ได้ — 1 ออเดอร์บน 50 วิว = 2% ซึ่งหลอกตา */
const MIN_VIEWS_FOR_CONV = 500;
/** เคลม "conv สูง" ด้วยออเดอร์เดียวไม่ได้ */
const MIN_ORDERS_FOR_CONV = 2;
/** ออเดอร์ที่ไม่มีสิทธิ์/คืนของเกินสัดส่วนนี้ = ไม่ใช่ของจริง */
const MAX_BAD_RATIO = 0.3;
const DAY_MS = 24 * 60 * 60 * 1000;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * รวม metric snapshot + ออเดอร์ ให้เป็นสถิติต่อคลิป
 * viewDelta = ผลต่างวิวระหว่าง snapshot ล่าสุดกับก่อนหน้า (null ถ้ามี snapshot เดียว)
 */
export function buildClipStats(args: {
  entries: { id: string; productName: string }[];
  metrics: ClipMetricRecord[];
  orders: AffiliateOrderRecord[];
  now: Date;
}): ClipStat[] {
  const { entries, metrics, orders, now } = args;

  const metricsByEntry = new Map<string, ClipMetricRecord[]>();
  for (const m of metrics) {
    if (!m.matchedEntryId) continue;
    const list = metricsByEntry.get(m.matchedEntryId);
    if (list) list.push(m);
    else metricsByEntry.set(m.matchedEntryId, [m]);
  }

  const stats: ClipStat[] = [];
  for (const e of entries) {
    const snaps = (metricsByEntry.get(e.id) ?? []).sort(
      (a, b) => a.capturedOn.getTime() - b.capturedOn.getTime()
    );
    if (snaps.length === 0) continue;

    const latest = snaps[snaps.length - 1];
    const previous = snaps.length >= 2 ? snaps[snaps.length - 2] : null;
    const entryOrders = orders.filter((o) => o.matchedEntryId === e.id);

    stats.push({
      entryId: e.id,
      productName: e.productName,
      views: latest.views,
      viewDelta: previous ? latest.views - previous.views : null,
      orders: entryOrders.length,
      badOrders: entryOrders.filter(
        (o) => o.status === INELIGIBLE_STATUS || o.itemsSold === 0
      ).length,
      ordersLast7Days: entryOrders.filter(
        (o) => now.getTime() - o.orderDate.getTime() <= 7 * DAY_MS
      ).length,
    });
  }
  return stats;
}

export function detectSignals(stats: ClipStat[]): ClipSignal[] {
  const usable = stats.filter((s) => s.views > 0);
  if (usable.length === 0) return [];

  const totalViews = usable.reduce((a, s) => a + s.views, 0);
  const totalOrders = usable.reduce((a, s) => a + s.orders, 0);
  const channelConv = totalViews > 0 ? totalOrders / totalViews : 0;
  const medianViews = median(usable.map((s) => s.views));

  const pct = (n: number) => (n * 100).toFixed(3) + "%";
  const signals: ClipSignal[] = [];

  for (const s of usable) {
    const badRatio = s.orders > 0 ? s.badOrders / s.orders : 0;
    if (badRatio >= MAX_BAD_RATIO) continue;

    const conv = s.views > 0 ? s.orders / s.views : 0;
    const convTrusted = s.views >= MIN_VIEWS_FOR_CONV && s.orders >= MIN_ORDERS_FOR_CONV;
    const reachEnough = s.views >= Math.max(MIN_VIEWS_FOR_CONV, medianViews * 2);

    if (
      s.viewDelta !== null &&
      s.viewDelta >= medianViews &&
      convTrusted &&
      conv >= channelConv * 0.8
    ) {
      signals.push({
        kind: "emerging",
        entryId: s.entryId,
        productName: s.productName,
        headline: "กำลังมา — ทำ angle ใหม่ซ้ำตอนนี้",
        detail: `วิวเพิ่ม ${s.viewDelta.toLocaleString()} ในรอบล่าสุด · ${s.orders} ออเดอร์ · conv ${pct(conv)}`,
        strength: s.viewDelta,
      });
    } else if (convTrusted && conv >= channelConv * 1.3 && s.views < medianViews) {
      signals.push({
        kind: "hidden-gem",
        entryId: s.entryId,
        productName: s.productName,
        headline: "ของดีแต่คนไม่เห็น — ทำใหม่หรือดันด้วยแอด",
        detail: `conv ${pct(conv)} (สูงกว่าค่าเฉลี่ยช่อง ${pct(channelConv)}) แต่ได้แค่ ${s.views.toLocaleString()} วิว`,
        strength: conv / (channelConv || 1),
      });
    } else if (reachEnough && conv <= channelConv * 0.5) {
      signals.push({
        kind: "reach-no-convert",
        entryId: s.entryId,
        productName: s.productName,
        headline: "คนดูเยอะแต่ไม่ซื้อ — คอนเทนต์ใช้ได้ ลองเปลี่ยนสินค้า",
        detail: `${s.views.toLocaleString()} วิว แต่ conv แค่ ${pct(conv)} (ค่าเฉลี่ยช่อง ${pct(channelConv)})`,
        strength: s.views,
      });
    } else if (
      s.viewDelta !== null &&
      s.viewDelta < s.views * 0.05 &&
      s.ordersLast7Days === 0 &&
      s.orders >= 1
    ) {
      signals.push({
        kind: "fading",
        entryId: s.entryId,
        productName: s.productName,
        headline: "หยุดแล้ว — ไม่ต้องลงแรงต่อ",
        detail: `วิวแทบไม่ขยับ (+${s.viewDelta.toLocaleString()}) และไม่มีออเดอร์ใน 7 วัน`,
        strength: 0,
      });
    }
  }

  return signals.sort((a, b) => b.strength - a.strength);
}
```

หมายเหตุการออกแบบ: `reach-no-convert` **ไม่ใช้** `convTrusted` เพราะเคสที่รุนแรงที่สุดคือวิวเยอะแต่ **0 ออเดอร์** ซึ่งจะถูก `MIN_ORDERS_FOR_CONV` ตัดทิ้งถ้าใช้เกณฑ์เดียวกัน — ตัวนี้ใช้ `reachEnough` (วิวถึงเกณฑ์) แทน

- [ ] **Step 2: ย้าย type ออกจาก prompt-workspace**

ลบ `export type ClipMetricRecord = {...}` ที่ประกาศชั่วคราวใน `components/prompt-workspace.tsx` (Task 3) แล้วเปลี่ยนเป็น:

```ts
import type { ClipMetricRecord } from "@/lib/recommender";
```

ถ้ามีไฟล์อื่น import `ClipMetricRecord` จาก `prompt-workspace` ให้แก้ให้ชี้มาที่ `@/lib/recommender` ด้วย

- [ ] **Step 3: Verify build + lint**

Run: `npm run build`
Expected: สำเร็จ

Run: `npm run lint`
Expected: ไม่มี warning ใหม่

- [ ] **Step 4: Verify ผลลัพธ์กับข้อมูลจริง**

หลัง import ข้อมูลแล้ว (Task 3) เปิดหน้า Dashboard แล้วดู — แต่ Task 5 ยังไม่ทำ UI จึงตรวจด้วยสคริปต์ readonly ที่ replicate ตรรกะแทน:

```js
const D = require('C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt/node_modules/better-sqlite3');
const db = new D('C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt/dev.db', { readonly: true });
const metrics = db.prepare('SELECT matchedEntryId, views FROM ClipMetric WHERE matchedEntryId IS NOT NULL').all();
const entries = new Map(db.prepare('SELECT id, productName FROM PromptEntry').all().map(e => [e.id, e.productName]));
const orders = db.prepare('SELECT matchedEntryId, status FROM AffiliateOrder WHERE matchedEntryId IS NOT NULL').all();
const ordCount = new Map();
for (const o of orders) ordCount.set(o.matchedEntryId, (ordCount.get(o.matchedEntryId) || 0) + 1);
const rows = metrics.map(m => ({ name: entries.get(m.matchedEntryId), views: m.views, orders: ordCount.get(m.matchedEntryId) || 0 }));
const totalV = rows.reduce((a, r) => a + r.views, 0), totalO = rows.reduce((a, r) => a + r.orders, 0);
const channelConv = totalO / totalV;
const sorted = rows.map(r => r.views).sort((a, b) => a - b);
const medianViews = sorted[Math.floor(sorted.length / 2)];
console.log('channelConv:', (channelConv * 100).toFixed(3) + '%', '| medianViews:', medianViews);
for (const r of rows) {
  const conv = r.orders / r.views;
  const gem = r.views >= 500 && r.orders >= 2 && conv >= channelConv * 1.3 && r.views < medianViews;
  const rnc = r.views >= Math.max(500, medianViews * 2) && conv <= channelConv * 0.5;
  if (gem || rnc) console.log(gem ? 'hidden-gem' : 'reach-no-convert', '→', r.name, `(views=${r.views}, ord=${r.orders}, conv=${(conv*100).toFixed(3)}%)`);
}
db.close();
```

Expected (import ครั้งแรก มี snapshot เดียว จึงไม่มี emerging/fading):
- `channelConv` ≈ 0.190% · `medianViews` ≈ 1741
- **hidden-gem → กระปุกกรองน้ำมันสแตนเลส** (views 1038, ord 3, conv 0.289%)
- **hidden-gem → ที่ลับเล็บแมว** คลิปที่ 2 (views 1476, ord 6, conv 0.407%)
- ไม่มี `reach-no-convert` (ที่ลับเล็บแมวตัวใหญ่ conv 0.189% ไม่ต่ำพอ)
- ชามสแตนเลส (views 1494) ต้อง**ไม่**ติด `reach-no-convert` เพราะวิวไม่ถึง 2× median

- [ ] **Step 5: Commit**

```bash
git add lib/recommender.ts components/prompt-workspace.tsx
git commit -m "Add pure-code recommender detectors keyed on views and conversion"
```

---

### Task 5: UI — `components/recommendations.tsx` + ต่อเข้า Dashboard

**Files:**
- Create: `components/recommendations.tsx`
- Modify: `components/dashboard-panel.tsx`

**Interfaces:**
- Consumes: `buildClipStats`, `detectSignals`, `ClipSignal`, `ClipMetricRecord` (Task 4) · `AffiliateOrderRecord` จาก `lib/dashboard` · `ClipThumbnail` จาก `components/clip-thumbnail`

- [ ] **Step 1: เขียน `components/recommendations.tsx`**

```tsx
"use client";

import { useMemo } from "react";
import { Lightbulb } from "lucide-react";

import type { AffiliateOrderRecord } from "@/lib/dashboard";
import {
  buildClipStats,
  detectSignals,
  type ClipMetricRecord,
  type ClipSignalKind,
} from "@/lib/recommender";

const KIND_STYLE: Record<ClipSignalKind, { label: string; className: string }> = {
  emerging: { label: "กำลังมา", className: "border-marigold/50 bg-marigold/10 text-marigold" },
  "hidden-gem": { label: "ของดีคนไม่เห็น", className: "border-rust/50 bg-rust/10 text-rust" },
  "reach-no-convert": { label: "ดูเยอะไม่ซื้อ", className: "border-smoke/50 bg-smoke/10 text-smoke" },
  fading: { label: "หยุดแล้ว", className: "border-border bg-muted text-muted-foreground" },
};

export function Recommendations({
  entries,
  metrics,
  orders,
  now,
}: {
  entries: { id: string; productName: string }[];
  metrics: ClipMetricRecord[];
  orders: AffiliateOrderRecord[];
  now: Date;
}) {
  const signals = useMemo(
    () => detectSignals(buildClipStats({ entries, metrics, orders, now })),
    [entries, metrics, orders, now]
  );

  const withMetrics = new Set(
    metrics.filter((m) => m.matchedEntryId !== null).map((m) => m.matchedEntryId)
  );
  const missing = entries.filter((e) => !withMetrics.has(e.id)).length;
  const hasDelta = metrics.length > 0 && new Set(metrics.map((m) => m.capturedOn.getTime())).size >= 2;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <span className="flex items-center gap-1.5 font-medium text-foreground/90">
        <Lightbulb className="size-4 text-marigold" />
        ควรทำอะไรต่อ
      </span>

      {signals.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          ยังไม่มีสัญญาณที่ชัดพอจะแนะนำ — นำเข้าข้อมูลวิวและรายได้ให้ครบก่อน
        </p>
      ) : (
        signals.map((s) => {
          const style = KIND_STYLE[s.kind];
          return (
            <div key={s.entryId + s.kind} className="flex flex-col gap-1 border-t border-border pt-3 first:border-t-0 first:pt-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded border px-1.5 py-0.5 font-mono text-[0.65rem] ${style.className}`}>
                  {style.label}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground/90">
                  {s.productName}
                </span>
              </div>
              <p className="text-sm text-foreground/80">{s.headline}</p>
              <p className="font-mono text-[0.7rem] text-muted-foreground">{s.detail}</p>
            </div>
          );
        })
      )}

      <div className="flex flex-col gap-0.5 border-t border-border pt-2 font-mono text-[0.7rem] text-muted-foreground">
        {missing > 0 && <span>ยังไม่มีข้อมูลวิว {missing} คลิป — นำเข้าไฟล์ Content รอบใหม่เพื่อให้ครบ</span>}
        {!hasDelta && <span>สัญญาณด้านความเคลื่อนไหวจะใช้ได้หลังนำเข้าข้อมูลวิวรอบที่ 2</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: ต่อเข้า `components/dashboard-panel.tsx`**

เพิ่ม import:

```ts
import { Recommendations } from "@/components/recommendations";
```

วาง component ต่อจาก `<ReminderBanner>` (ก่อนฟอร์มอัปโหลด) — ต้องรับ prop `entries` และ `now` เพิ่ม:

```tsx
      <Recommendations
        entries={entries}
        metrics={clipMetrics}
        orders={orders}
        now={now}
      />
```

`entries` และ `now` ยังไม่มีใน props ของ `DashboardPanel` → เพิ่มเข้าไป แล้วส่งมาจาก `prompt-workspace.tsx` (`entries` map จาก `prompts` เอาแค่ `{id, productName}`) และจาก `app/page.tsx` (`now={new Date()}` — คำนวณฝั่ง server เพื่อไม่ให้ `Date.now()` ถูกเรียกใน render body ของ client component ซึ่งผิด purity rule ของ eslint-plugin-react-hooks ตามที่ `app/page.tsx` ระบุไว้แล้ว)

- [ ] **Step 3: Verify build + lint**

Run: `npm run build`
Expected: สำเร็จ

Run: `npm run lint`
Expected: ไม่มี warning ใหม่ (ระวัง purity rule — `now` ต้องมาจาก server ไม่ใช่ `new Date()` ใน component)

- [ ] **Step 4: Verify ในแอปจริง**

ถ้า port 3000 ว่าง รัน `npm run dev` แล้วเปิดแท็บ Dashboard
Expected:
- เห็นกล่อง "ควรทำอะไรต่อ" มี **2 รายการ hidden-gem** (กระปุกกรองน้ำมัน, ที่ลับเล็บแมวคลิปที่ 2)
- เห็นบรรทัด "ยังไม่มีข้อมูลวิว 28 คลิป"
- เห็นบรรทัด "สัญญาณด้านความเคลื่อนไหวจะใช้ได้หลังนำเข้าข้อมูลวิวรอบที่ 2"
- ไม่มี emoji · ข้อความไทยทั้งหมด · ไม่มี console error

- [ ] **Step 5: Commit**

```bash
git add components/recommendations.tsx components/dashboard-panel.tsx components/prompt-workspace.tsx app/page.tsx
git commit -m "Surface recommender signals in the dashboard"
```

---

### Task 6: เก็บเวลาโพสต์

**Files:**
- Modify: `app/actions.ts` (`updateProduction`)
- Modify: `components/production-panel.tsx`

**Interfaces:**
- Consumes: `PromptEntry.postedTimeOfDay` (Task 1)

**เหตุผลที่ทำทั้งที่ยังวิเคราะห์ไม่ได้:** ตอนนี้ไม่มีที่ไหนบันทึกเวลาโพสต์เลย (`postedAt` เก็บแค่วันที่, `Content.csv` ก็ให้แค่วันที่) จึงตอบคำถาม "ควรโพสต์กี่โมง" ไม่ได้ **ต้องเริ่มเก็บก่อนถึงจะวิเคราะห์ได้ในอนาคต**

- [ ] **Step 1: บันทึก `postedTimeOfDay` ใน `updateProduction`**

ใน `app/actions.ts` ฟังก์ชัน `updateProduction` — อ่านค่าเพิ่ม (วางใกล้ๆ `rawPostedAt`):

```ts
  const rawPostedTime = String(formData.get("postedTimeOfDay") ?? "").trim();
  // <input type="time"> ส่ง "HH:MM" — ค่าว่างแปลว่ายังไม่ระบุ
  if (rawPostedTime !== "" && !/^\d{2}:\d{2}$/.test(rawPostedTime)) {
    throw new Error("เวลาที่ลงคลิปไม่ถูกต้อง");
  }
```

แล้วเพิ่มใน `data` ของ `prisma.promptEntry.update`:

```ts
      postedTimeOfDay: rawPostedTime === "" ? null : rawPostedTime,
```

- [ ] **Step 2: เพิ่มช่องเวลาใน `components/production-panel.tsx`**

เพิ่ม state (ต่อจาก `postedAt`):

```ts
  const [postedTimeOfDay, setPostedTimeOfDay] = useState(entry.postedTimeOfDay ?? "");
```

แล้วเพิ่มช่องกรอกถัดจากบล็อก "วันที่ลงคลิป" (ใช้โครงเดียวกัน):

```tsx
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground/90">เวลาที่ลงคลิป</label>
            <Input
              name="postedTimeOfDay"
              type="time"
              value={postedTimeOfDay}
              onChange={(e) => setPostedTimeOfDay(e.target.value)}
            />
            <p className="font-mono text-[0.7rem] text-muted-foreground">
              เก็บไว้วิเคราะห์ช่วงเวลาที่ได้ผลในอนาคต
            </p>
          </div>
```

**ห้ามแตะ** `postedAt`, `toDateInputValue`, `toLocalDateInputValue` — เป็นคนละ field คนละ logic

- [ ] **Step 3: Verify build + lint**

Run: `npm run build`
Expected: สำเร็จ

Run: `npm run lint`
Expected: ไม่มี warning ใหม่

- [ ] **Step 4: Verify ในแอปจริง**

เปิดแอป เลือก entry ที่มีคลิป → กรอกเวลา → บันทึก → เลือก entry อื่นแล้วกลับมา
Expected: เวลาที่กรอกยังอยู่ · วันที่ลงคลิป (`postedAt`) ไม่เปลี่ยน · ลำดับใน sidebar ไม่เพี้ยน

- [ ] **Step 5: Commit**

```bash
git add app/actions.ts components/production-panel.tsx
git commit -m "Capture time of day when a clip was posted"
```

---

## Self-Review (ผู้เขียนแผนตรวจแล้ว)

**Spec coverage:** §data model → Task 1 · §parser → Task 2 · §import action + UI อัปโหลด → Task 3 · §detector 4 แบบ + guard + baseline → Task 4 · §UI section + coverage note → Task 5 · §เวลาโพสต์ → Task 6 · §ไม่ทำหน้าเทียบ import → ไม่มี task (ถูกต้อง)

**Type consistency:** `ClipMetricRecord` ประกาศชั่วคราวใน Task 3 แล้วย้ายไป `lib/recommender.ts` ใน Task 4 (ระบุชัดใน Task 4 Step 2 พร้อมสั่งให้แก้ import ทุกจุด) · `ClipMetricImportSummary` export จาก `app/actions.ts` ใช้ใน `dashboard-panel` · `ClipStat`/`ClipSignal` ใช้ชื่อเดียวกันทั้ง Task 4 และ 5 · `videoIdFromUrl` มีอยู่แล้วใน `lib/affiliate.ts` ไม่ประกาศซ้ำ

**Placeholder scan:** ไม่มี TBD/TODO — ทุก step ที่แก้โค้ดมีโค้ดจริงครบ · verification เป็นคำสั่งจริงของโปรเจกต์ (ไม่มี test runner จึงใช้ build/lint/รันจริง/สคริปต์ readonly แทน unit test โดยตั้งใจ ระบุใน Global Constraints)

**จุดที่ต้องระวังเป็นพิเศษ:** Task 3 Step 3 สร้าง type ชั่วคราวที่ Task 4 ต้องย้าย — ถ้าข้าม Task 4 Step 2 จะเหลือ type ซ้ำสองที่
