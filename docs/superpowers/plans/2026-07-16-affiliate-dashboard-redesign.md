# Affiliate Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ทำ dashboard แท็บ ④ ใหม่ให้ตัวเงินซื่อสัตย์ (เงินจริงเป็นพระเอก แยกที่รอออก), เห็นว่าคลิปไหนคือคลิปไหน (thumbnail จาก TikTok oEmbed), บอก reconciliation เป็นชื่อ, ย่อกราฟ, ย้ายแถบเตือน — ทำเป็นกลางๆ สะอาด ไม่ใส่ธีมหนัง

**Architecture:** ขยาย aggregation ใน `lib/dashboard.ts` (pure) · เพิ่มระบบ thumbnail: ตาราง `VideoThumbnail` (cache) + `lib/tiktok-oembed.ts` (ไฟล์เดียวที่รู้จัก oEmbed) + Server Action `resolveThumbnail` (อ่าน cache/ยิง/เขียน cache/fallback) · แล้วประกอบ UI ใหม่ใน `components/dashboard-panel.tsx` โดยแยกส่วนใหญ่เป็น component ย่อย

**Tech Stack:** Next.js 16.2.10 (custom build) · Prisma 7 + SQLite (driver adapter) · Tailwind v4 · lucide-react · TikTok oEmbed (สาธารณะ ไม่ต้อง auth)

**Spec:** `docs/superpowers/specs/2026-07-16-affiliate-dashboard-redesign-design.md` — อ่านก่อนเริ่ม

## Global Constraints

- **ห้ามใช้ emoji ใน UI** — ใช้ไอคอน `lucide-react`
- **ใช้ design token เดิมเท่านั้น** (`ink`/`ink-2`/`paper`/`marigold`/`rust`/`smoke`/`record`/`muted`/`muted-foreground`/`border`/`card`/`foreground`) ใช้ `Button`/`Input` จาก `components/ui/` — **และรอบนี้ห้ามเพิ่ม motif ธีมหนัง** (ห้ามใช้ `.clapper-stripes` หรือลาย/สัญลักษณ์คลปเปอร์บอร์ดใน dashboard) ทำเป็นกลางๆ สะอาด
- **ข้อความ UI ภาษาไทยทั้งหมด**
- **GMV ≠ เงินจริง** — เงินจริง (hero) = ผลรวม `finalRevenue`; ที่รอ = gmv ของสถานะ pending แยกออก + ประเมินค่าคอม; "ไม่มีสิทธิ์" แยกเป็นหมายเหตุ; **เลิกโชว์ "GMV รวม" เป็นหัว**
- **thumbnail มาจาก TikTok oEmbed (สาธารณะ)** — เป็นการยิงเน็ตออกนอกเครื่องครั้งแรกของแอป ต้อง **cache ในตาราง `VideoThumbnail`** และมี **fallback** ตอนดึงไม่ได้ (คลิปโดนลบ/ปิด/offline) `lib/tiktok-oembed.ts` เป็นไฟล์เดียวที่รู้จัก endpoint — **ยืนยัน endpoint/รูปแบบ URL/response จริงตอนสร้าง อย่าเดา**
- **Prisma 7:** generated client import จาก `@/lib/generated/prisma/client`; หลังแก้ `prisma/schema.prisma` รัน `npx prisma migrate dev --name <name>` แล้ว `npx prisma generate`
- **`dev.db` มีข้อมูลจริง (22 entries + Core Prompt + 79 AffiliateOrder) ไม่มี backup** — **ห้ามรัน `DELETE FROM <table>;` แบบไม่มี `WHERE`** ล้างข้อมูลทดสอบด้วย `WHERE` เจาะจง
- **ห้าม build/dev ซ้อนกับ `start.bat`** — เช็ก `netstat -ano | grep ':3000' | grep LISTENING` ก่อน ถ้ามีของที่ **ไม่ใช่ที่ตัวเองสตาร์ท** อย่าเพิ่งฆ่า (อาจเป็น start.bat ของผู้ใช้) ถ้าเจอ `Cannot find module 'better-sqlite3-...'` ให้ `rm -rf .next` แล้ว build ใหม่ · ห้ามทิ้ง process ค้างท้าย task
- **ไม่มี test runner** — verify ด้วย `npm run build` (type-check ในตัว) + `npm run lint` + Playwright (ติดตั้งใน scratch dir ห้ามใส่ `package.json`)
- **ไฟล์ตัวอย่างจริง** `affiliate_orders_7661818732840453895.xlsx` ที่ root — gitignore ไว้ ห้าม commit
- **commit ทุก task ห้ามรวบ**

## File Structure

**Created**
- `lib/tiktok-oembed.ts` — สร้าง/แยก URL + ยิง oEmbed (ไฟล์เดียวที่รู้จัก endpoint)
- `components/clip-thumbnail.tsx` — thumbnail คลิปตัวเดียว (client, lazy + fallback)
- `components/revenue-by-clip.tsx` — คลิปทำเงินเรียงอันดับ + thumbnail (บน 5 + ดูทั้งหมด)
- `components/reconciliation.tsx` — สินค้าที่ขายได้แต่ยังไม่มี entry (ชื่อ + thumbnail + สร้าง entry)
- `prisma/migrations/<ts>_video_thumbnail/migration.sql` (generate เอา)

**Modified**
- `lib/dashboard.ts` — ขยาย `summarizeOrders` + เพิ่ม `revenueTrend`
- `prisma/schema.prisma` — model `VideoThumbnail`
- `app/actions.ts` — `resolveThumbnail`, `createEntryFromOrder`
- `components/revenue-charts.tsx` — เหลือ `RevenueTrend` (sparkline + กราฟยุบ), ลบ `StatusChart`/`ClipChart`
- `components/dashboard-panel.tsx` — ประกอบใหม่: ส่วนเงิน + reminder detail + RevenueTrend + RevenueByClipList + Reconciliation
- `components/reminder-banner.tsx` — ย้ายมาแสดงในแท็บ dashboard + โชว์ชื่อคลิปที่รอรายได้
- `components/workspace-tabs.tsx` — badge บนแท็บ ④
- `components/prompt-workspace.tsx` — เอา ReminderBanner ออกจาก header, ส่ง props ใหม่, badge
- `app/page.tsx` — คำนวณ `awaitingClips` ส่งต่อ
- `CLAUDE.md`

**Boundaries:** `lib/tiktok-oembed.ts` ไฟล์เดียวที่รู้จัก oEmbed · `lib/dashboard.ts` pure ไม่แตะ DB/network · thumbnail resolve ทำใน Server Action + cache DB, client แค่เรียก

---

### Task 1: ขยาย aggregation (`lib/dashboard.ts`)

**Files:**
- Modify: `lib/dashboard.ts`

**Interfaces:**
- Consumes: `PAID_STATUS` จาก `@/lib/affiliate`, `AffiliateOrderRecord` (มีอยู่แล้ว)
- Produces:
  - `summarizeOrders(orders)` คืนเพิ่ม: `paidGmv`, `pendingGmv`, `pendingOrders`, `ineligibleOrders`, `ineligibleGmv`, `realizedRate: number | null`, `estimatedPendingCommission: number | null` (คง field เดิม `totalGmv`/`settledRevenue`/`orderCount`/`itemCount`/`paidOrderCount`)
  - `revenueTrend(orders): { points: number[]; direction: "up" | "down" | "flat"; changePct: number }`
  - `export const INELIGIBLE_STATUS = "ไม่มีสิทธิ์"`

- [ ] **Step 1: แก้ `summarizeOrders` + เพิ่ม constant/trend**

แทนที่ `summarizeOrders` เดิม และเพิ่มของใหม่ (วางต่อจาก `ordersByDay` ที่มีอยู่). เปิด `lib/dashboard.ts`, เปลี่ยนบล็อก `summarizeOrders`:

```ts
export const INELIGIBLE_STATUS = "ไม่มีสิทธิ์";

export function summarizeOrders(orders: AffiliateOrderRecord[]) {
  let totalGmv = 0;
  let settledRevenue = 0;
  let itemCount = 0;
  let paidOrderCount = 0;
  let paidGmv = 0;
  let pendingOrders = 0;
  let pendingGmv = 0;
  let ineligibleOrders = 0;
  let ineligibleGmv = 0;

  for (const o of orders) {
    totalGmv += o.gmv;
    settledRevenue += o.finalRevenue ?? 0;
    itemCount += o.itemsSold;
    if (o.status === PAID_STATUS) {
      paidOrderCount++;
      paidGmv += o.gmv;
    } else if (o.status === INELIGIBLE_STATUS) {
      ineligibleOrders++;
      ineligibleGmv += o.gmv;
    } else {
      pendingOrders++;
      pendingGmv += o.gmv;
    }
  }

  // อัตราค่าคอมจริงที่สังเกตจากออเดอร์ที่ settle แล้ว — เอาไปประเมินของที่ยังรอ
  const realizedRate = paidGmv > 0 ? settledRevenue / paidGmv : null;
  const estimatedPendingCommission =
    realizedRate !== null ? pendingGmv * realizedRate : null;

  return {
    totalGmv,
    settledRevenue,
    orderCount: orders.length,
    itemCount,
    paidOrderCount,
    paidGmv,
    pendingOrders,
    pendingGmv,
    ineligibleOrders,
    ineligibleGmv,
    realizedRate,
    estimatedPendingCommission,
  };
}

/**
 * แนวโน้มรายได้สำหรับ sparkline — เทียบผลรวมครึ่งหลังกับครึ่งแรกของช่วง
 * points = gmv รายวัน (ใช้วาดเส้นจิ๋ว)
 */
export function revenueTrend(orders: AffiliateOrderRecord[]): {
  points: number[];
  direction: "up" | "down" | "flat";
  changePct: number;
} {
  const points = ordersByDay(orders).map((d) => d.gmv);
  if (points.length < 2) {
    return { points, direction: "flat", changePct: 0 };
  }
  const mid = Math.floor(points.length / 2);
  const firstSum = points.slice(0, mid).reduce((a, b) => a + b, 0);
  const secondSum = points.slice(mid).reduce((a, b) => a + b, 0);
  let changePct: number;
  if (firstSum === 0) {
    changePct = secondSum > 0 ? 100 : 0;
  } else {
    changePct = ((secondSum - firstSum) / firstSum) * 100;
  }
  const direction = changePct > 5 ? "up" : changePct < -5 ? "down" : "flat";
  return { points, direction, changePct };
}
```

- [ ] **Step 2: build + lint + commit**

```bash
npm run build && npm run lint
git add lib/dashboard.ts
git commit -m "Add settled/pending money split and revenue trend"
```

---

### Task 2: ระบบ thumbnail — schema + oEmbed lib + actions

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `lib/tiktok-oembed.ts`
- Modify: `app/actions.ts`
- Create: `prisma/migrations/<ts>_video_thumbnail/migration.sql` (generate)

**Interfaces:**
- Produces:
  - Prisma model `VideoThumbnail { contentId String @id, thumbnailUrl String?, title String?, ok Boolean, fetchedAt DateTime }`
  - `lib/tiktok-oembed.ts` → `handleFromUrl(url: string): string | null`, `buildVideoUrl(contentId: string, handle: string): string`, `fetchOembedThumbnail(videoUrl: string): Promise<{ thumbnailUrl: string | null; title: string | null; ok: boolean }>`
  - `app/actions.ts` → `resolveThumbnail(contentId: string, videoUrl?: string): Promise<{ thumbnailUrl: string | null }>`, `createEntryFromOrder(contentId: string, productName: string): Promise<void>`

- [ ] **Step 1: model + migrate**

ใน `prisma/schema.prisma` เพิ่มท้ายไฟล์:

```prisma
model VideoThumbnail {
  contentId    String   @id
  thumbnailUrl String?
  title        String?
  ok           Boolean  @default(false)
  fetchedAt    DateTime @default(now())
}
```

```bash
npx prisma migrate dev --name video_thumbnail
npx prisma generate
```
ยืนยันข้อมูลจริงรอด:
```bash
node -e "const D=require('better-sqlite3');const db=new D('dev.db',{readonly:true});console.log('entries:',db.prepare('SELECT COUNT(*) c FROM PromptEntry').get().c,'orders:',db.prepare('SELECT COUNT(*) c FROM AffiliateOrder').get().c);db.close();"
```
คาดหวัง: `entries: 22 orders: 79`

- [ ] **Step 2: `lib/tiktok-oembed.ts`**

> **ยืนยันจริงก่อนเขียน:** เปิดเน็ตทดสอบ endpoint จริงก่อน (อ่าน API จริง ไม่เดา):
> ```bash
> curl -s "https://www.tiktok.com/oembed?url=https://www.tiktok.com/@rainny0192/video/7656417754160958737" | head -c 500
> ```
> ดูว่ามี field `thumbnail_url` ไหม และต้องมี `User-Agent` header หรือเปล่า ถ้า response ต่างจากที่โค้ดคาด ให้ปรับ `fetchOembedThumbnail` ให้ตรงของจริง

สร้าง `lib/tiktok-oembed.ts`:

```ts
/** ดึง @handle จากลิงก์ TikTok เช่น https://www.tiktok.com/@rainny0192/video/123 -> rainny0192 */
export function handleFromUrl(url: string): string | null {
  const m = url.match(/tiktok\.com\/@([\w.]+)/i);
  return m ? m[1] : null;
}

/** ประกอบลิงก์คลิปจาก content id + handle (ใช้กับออเดอร์ที่ยังไม่มี entry) */
export function buildVideoUrl(contentId: string, handle: string): string {
  return `https://www.tiktok.com/@${handle}/video/${contentId}`;
}

/**
 * ยิง TikTok oEmbed (สาธารณะ ไม่ต้อง auth) เอา thumbnail + ชื่อคลิป
 * ok=false เมื่อคลิปโดนลบ/ปิด/ยิงพลาด — ให้ caller เก็บ cache แล้วโชว์ fallback
 */
export async function fetchOembedThumbnail(videoUrl: string): Promise<{
  thumbnailUrl: string | null;
  title: string | null;
  ok: boolean;
}> {
  try {
    const endpoint = `https://www.tiktok.com/oembed?url=${encodeURIComponent(videoUrl)}`;
    const res = await fetch(endpoint, {
      headers: { "User-Agent": "Mozilla/5.0 (pooling-prompt)" },
    });
    if (!res.ok) return { thumbnailUrl: null, title: null, ok: false };
    const json = (await res.json()) as { thumbnail_url?: string; title?: string };
    const thumbnailUrl = json.thumbnail_url ?? null;
    return { thumbnailUrl, title: json.title ?? null, ok: Boolean(thumbnailUrl) };
  } catch {
    return { thumbnailUrl: null, title: null, ok: false };
  }
}
```

- [ ] **Step 3: actions ใน `app/actions.ts`**

เพิ่ม import (ต่อจากของเดิม):
```ts
import { handleFromUrl, buildVideoUrl, fetchOembedThumbnail } from "@/lib/tiktok-oembed";
```

เพิ่ม 2 actions ท้ายไฟล์:

```ts
/**
 * หา thumbnail ของคลิปจาก content id — อ่าน cache ก่อน ถ้าไม่มีค่อยยิง oEmbed แล้ว cache
 * เก็บผลแม้ล้มเหลว (ok=false) เพื่อไม่ยิงซ้ำถี่ๆ
 */
export async function resolveThumbnail(
  contentId: string,
  videoUrl?: string
): Promise<{ thumbnailUrl: string | null }> {
  const cached = await prisma.videoThumbnail.findUnique({ where: { contentId } });
  if (cached) return { thumbnailUrl: cached.thumbnailUrl };

  // หา URL: ถ้ามี videoUrl (คลิปที่จับคู่แล้ว) ใช้ตรงๆ; ถ้าไม่มี ประกอบจาก handle ของ entry ใดก็ได้
  let url = videoUrl && videoUrl.trim() !== "" ? videoUrl : undefined;
  if (!url) {
    const anyEntry = await prisma.promptEntry.findFirst({
      where: { videoUrl: { not: "" } },
      select: { videoUrl: true },
    });
    const handle = anyEntry ? handleFromUrl(anyEntry.videoUrl) : null;
    if (handle) url = buildVideoUrl(contentId, handle);
  }

  if (!url) {
    await prisma.videoThumbnail.create({
      data: { contentId, thumbnailUrl: null, title: null, ok: false },
    });
    return { thumbnailUrl: null };
  }

  const r = await fetchOembedThumbnail(url);
  await prisma.videoThumbnail.upsert({
    where: { contentId },
    create: { contentId, thumbnailUrl: r.thumbnailUrl, title: r.title, ok: r.ok },
    update: {
      thumbnailUrl: r.thumbnailUrl,
      title: r.title,
      ok: r.ok,
      fetchedAt: new Date(),
    },
  });
  return { thumbnailUrl: r.thumbnailUrl };
}

/**
 * สร้าง entry ขั้นต่ำจากออเดอร์ที่ขายได้แต่ยังไม่มีในแอป แล้วผูกออเดอร์ที่มี content id เดียวกันให้เลย
 * (ปิด loop reconciliation ทันที ไม่ต้องรอ import รอบใหม่)
 */
export async function createEntryFromOrder(contentId: string, productName: string) {
  const name = productName.trim() || "สินค้าจากออเดอร์";
  const anyEntry = await prisma.promptEntry.findFirst({
    where: { videoUrl: { not: "" } },
    select: { videoUrl: true },
  });
  const handle = anyEntry ? handleFromUrl(anyEntry.videoUrl) : null;
  const videoUrl = handle ? buildVideoUrl(contentId, handle) : "";

  const active = await prisma.corePrompt.findFirst({
    where: { isActive: true, kind: "core" },
  });

  const created = await prisma.promptEntry.create({
    data: {
      productName: name,
      productInfo: "",
      riskModule: "",
      extraNotes: "",
      images: "[]",
      corePromptId: active?.id ?? null,
      videoUrl,
    },
  });

  await prisma.affiliateOrder.updateMany({
    where: { contentId },
    data: { matchedEntryId: created.id },
  });

  revalidatePath("/");
}
```

- [ ] **Step 4: ทดสอบ oEmbed จริง (scratch) + build + commit**

```bash
npm run build && npm run lint
```
ทดสอบ endpoint จริงอีกครั้งด้วย content id ที่มีในไฟล์ (`7656417754160958737`) ว่าได้ thumbnail:
```bash
curl -s "https://www.tiktok.com/oembed?url=https://www.tiktok.com/@rainny0192/video/7656417754160958737" | grep -o '"thumbnail_url":"[^"]*"' | head -c 200
```
คาดหวัง: เห็น `"thumbnail_url":"https://...`  (ถ้าไม่เห็น → ปรับ `fetchOembedThumbnail` ตามของจริงก่อน commit)

```bash
git add prisma/schema.prisma prisma/migrations lib/tiktok-oembed.ts app/actions.ts
git commit -m "Fetch and cache TikTok clip thumbnails via oEmbed"
```

---

### Task 3: `<ClipThumbnail>` component

**Files:**
- Create: `components/clip-thumbnail.tsx`

**Interfaces:**
- Consumes: `resolveThumbnail` (Task 2)
- Produces: `ClipThumbnail({ contentId, videoUrl }: { contentId: string; videoUrl?: string })`

- [ ] **Step 1: เขียน component**

สร้าง `components/clip-thumbnail.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";

import { resolveThumbnail } from "@/app/actions";

export function ClipThumbnail({
  contentId,
  videoUrl,
}: {
  contentId: string;
  videoUrl?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;
    resolveThumbnail(contentId, videoUrl)
      .then((r) => {
        if (!alive) return;
        setUrl(r.thumbnailUrl);
        setDone(true);
      })
      .catch(() => {
        if (alive) setDone(true);
      });
    return () => {
      alive = false;
    };
  }, [contentId, videoUrl]);

  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt=""
        className="size-12 shrink-0 rounded-md border border-border object-cover"
      />
    );
  }

  return (
    <div className="flex size-12 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
      {done ? (
        <ImageOff className="size-4" />
      ) : (
        <span className="size-3 animate-pulse rounded-full bg-smoke/40" />
      )}
    </div>
  );
}
```

- [ ] **Step 2: build + lint + commit**

```bash
npm run build && npm run lint
git add components/clip-thumbnail.tsx
git commit -m "Add lazy clip thumbnail with fallback"
```

---

### Task 4: ส่วนเงินใหม่ (dashboard-panel)

**Files:**
- Modify: `components/dashboard-panel.tsx`

**Interfaces:**
- Consumes: `summarizeOrders` (extended, Task 1)
- Produces: ส่วนเงินใหม่แทนกริด 4 การ์ดเดิม (ยังไม่แตะส่วน import/สรุป และยังไม่แตะ RevenueCharts — task อื่นทำ)

- [ ] **Step 1: แทนบล็อกตัวเลขสรุป**

ใน `components/dashboard-panel.tsx` — บล็อกปัจจุบันที่ขึ้นต้น `{orders.length === 0 ? (` จนถึงกริด `<Tile ...>` 4 อัน ให้แทนด้วยส่วนเงินใหม่. ลบ helper `Tile` เดิมทิ้ง แล้วใช้โครงนี้แทน (วางแทนที่ทั้งบล็อก `{orders.length === 0 ? (...) : (...)}`):

```tsx
      {orders.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          ยังไม่มีข้อมูลรายได้ — นำเข้าไฟล์ด้านบนเพื่อเริ่ม
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {/* เงินจริง — พระเอก */}
            <div className="flex flex-col gap-1 rounded-xl border border-marigold/40 bg-marigold/5 p-5">
              <span className="font-mono text-[0.65rem] tracking-widest text-marigold uppercase">
                เงินที่ได้จริงแล้ว
              </span>
              <span className="font-display text-4xl text-foreground">
                {baht(summary.settledRevenue)}
              </span>
              <span className="text-xs text-muted-foreground">
                จาก {summary.paidOrderCount.toLocaleString("th-TH")} ออเดอร์ที่ชำระแล้ว
              </span>
            </div>

            {/* กำลังรอ — รอง จางกว่า */}
            <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-5">
              <span className="font-mono text-[0.65rem] tracking-widest text-smoke uppercase">
                กำลังรอ (ยังไม่ใช่เงินเรา)
              </span>
              <span className="font-display text-2xl text-foreground/80">
                {summary.pendingOrders.toLocaleString("th-TH")} ออเดอร์ ·{" "}
                {baht(summary.pendingGmv)}
              </span>
              <span className="text-xs text-muted-foreground">
                {summary.estimatedPendingCommission !== null
                  ? `ประเมินค่าคอมถ้าจ่ายครบ ~${baht(summary.estimatedPendingCommission)}*`
                  : "ยังประเมินค่าคอมไม่ได้ (ยังไม่มีออเดอร์ที่ชำระแล้ว)"}
              </span>
            </div>
          </div>

          {/* แถวเล็กจาง + หมายเหตุความซื่อสัตย์ */}
          <p className="font-mono text-[0.7rem] leading-relaxed text-muted-foreground">
            ยอดสั่งรวมทุกสถานะ {baht(summary.totalGmv)} · ขายได้{" "}
            {summary.itemCount.toLocaleString("th-TH")} ชิ้น · ไม่มีสิทธิ์{" "}
            {summary.ineligibleOrders} ออเดอร์ (ไม่ได้ค่าคอม)
            <br />
            {summary.realizedRate !== null && (
              <>*ประเมินจากอัตราค่าคอมจริง{" "}
              {(summary.realizedRate * 100).toFixed(1)}% · </>
            )}
            ตัวเลขฝั่งเงินเท่านั้น (ไม่มียอดวิว) และช้ากว่าจริง ~สัปดาห์ เพราะออเดอร์ทยอย settle
          </p>
        </div>
      )}
```

**หมายเหตุ:** ลบ `function Tile(...)` ที่ไม่ใช้แล้วออกด้วย ไม่งั้น lint จะ error (unused)

- [ ] **Step 2: build + lint + commit**

```bash
npm run build && npm run lint
git add components/dashboard-panel.tsx
git commit -m "Lead with real settled money, split pending out"
```

---

### Task 5: คลิปทำเงิน + thumbnail (`revenue-by-clip.tsx`)

**Files:**
- Create: `components/revenue-by-clip.tsx`
- Modify: `components/dashboard-panel.tsx` (เรียกใช้)

**Interfaces:**
- Consumes: `revenueByClip` + `AffiliateOrderRecord` (`lib/dashboard.ts`), `ClipThumbnail` (Task 3)
- Produces: `RevenueByClipList({ orders }: { orders: AffiliateOrderRecord[] })`

- [ ] **Step 1: เขียน component**

สร้าง `components/revenue-by-clip.tsx`:

```tsx
"use client";

import { useState } from "react";

import { revenueByClip, type AffiliateOrderRecord } from "@/lib/dashboard";
import { ClipThumbnail } from "@/components/clip-thumbnail";

function baht(n: number): string {
  return "฿" + n.toLocaleString("th-TH", { maximumFractionDigits: 0 });
}

export function RevenueByClipList({ orders }: { orders: AffiliateOrderRecord[] }) {
  const [showAll, setShowAll] = useState(false);
  const clips = revenueByClip(orders);
  if (clips.length === 0) return null;

  const shown = showAll ? clips : clips.slice(0, 5);
  const max = Math.max(...clips.map((c) => c.gmv), 1);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-[0.7rem] tracking-widest text-smoke uppercase">
          คลิปทำเงิน
        </h3>
        {clips.length > 5 && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="font-mono text-xs text-marigold hover:underline"
          >
            {showAll ? "ย่อ" : `ดูทั้งหมด (${clips.length})`}
          </button>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {shown.map((c) => (
          <div key={c.contentId} className="flex items-center gap-3">
            <ClipThumbnail contentId={c.contentId} />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-foreground/90">
                  {c.productName || c.contentId}
                  {c.matchedEntryId === null && (
                    <span className="ml-1 text-marigold">(ยังไม่มีในแอป)</span>
                  )}
                </span>
                <span className="shrink-0 font-mono text-muted-foreground">
                  {baht(c.gmv)} · {c.orders} ออเดอร์
                </span>
              </div>
              <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
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
          </div>
        ))}
      </div>

      <div className="flex gap-4 font-mono text-[0.65rem] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block size-2 rounded-full bg-marigold" /> จ่ายแล้ว
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block size-2 rounded-full bg-smoke/50" /> รอ/ยังไม่จ่าย
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: เรียกใน dashboard-panel**

ใน `components/dashboard-panel.tsx` เพิ่ม import:
```tsx
import { RevenueByClipList } from "@/components/revenue-by-clip";
```
บรรทัดที่ตอนนี้เป็น `{orders.length > 0 && <RevenueCharts orders={orders} />}` — ยังไม่แตะ (Task 6 จะจัดการ) แต่เพิ่ม `RevenueByClipList` ก่อนหน้า:
```tsx
      {orders.length > 0 && <RevenueByClipList orders={orders} />}
      {orders.length > 0 && <RevenueCharts orders={orders} />}
```

- [ ] **Step 3: build + lint + commit**

```bash
npm run build && npm run lint
git add components/revenue-by-clip.tsx components/dashboard-panel.tsx
git commit -m "Rank revenue per clip with thumbnails"
```

---

### Task 6: sparkline + กราฟยุบ (`revenue-charts.tsx`)

**Files:**
- Modify: `components/revenue-charts.tsx`
- Modify: `components/dashboard-panel.tsx`

**Interfaces:**
- Consumes: `revenueTrend` + `ordersByDay` (`lib/dashboard.ts`)
- Produces: `RevenueTrend({ orders }: { orders: AffiliateOrderRecord[] })` (แทน `RevenueCharts`)

- [ ] **Step 1: เขียน `revenue-charts.tsx` ใหม่ทั้งไฟล์**

แทนที่ทั้งไฟล์ `components/revenue-charts.tsx` (ลบ `ClipChart`/`StatusChart`, เก็บ `TimeChart` ไว้หลังปุ่ม, เพิ่ม sparkline):

```tsx
"use client";

import { useState } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

import {
  ordersByDay,
  revenueTrend,
  type AffiliateOrderRecord,
} from "@/lib/dashboard";

function baht(n: number): string {
  return "฿" + n.toLocaleString("th-TH", { maximumFractionDigits: 0 });
}

/** เส้น GMV ตามวัน — กางจากปุ่มดูกราฟ */
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
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 w-full" role="img" aria-label="กราฟ GMV ตามวัน">
      <polygon points={area} className="fill-marigold/15" />
      <polyline points={line} className="fill-none stroke-rust" strokeWidth={2} strokeLinejoin="round" />
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
  );
}

/** sparkline จิ๋วในบรรทัดเดียว */
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

- [ ] **Step 2: เปลี่ยนการเรียกใน dashboard-panel**

ใน `components/dashboard-panel.tsx`:
- เปลี่ยน import จาก `import { RevenueCharts } from "@/components/revenue-charts";` เป็น `import { RevenueTrend } from "@/components/revenue-charts";`
- เปลี่ยน `{orders.length > 0 && <RevenueCharts orders={orders} />}` เป็น `{orders.length > 0 && <RevenueTrend orders={orders} />}`

- [ ] **Step 3: build + lint + commit**

```bash
npm run build && npm run lint
git add components/revenue-charts.tsx components/dashboard-panel.tsx
git commit -m "Shrink charts to a glanceable trend with expandable detail"
```

---

### Task 7: Reconciliation ถาวร (ชื่อ + thumbnail + สร้าง entry)

**Files:**
- Create: `components/reconciliation.tsx`
- Modify: `components/dashboard-panel.tsx`

**Interfaces:**
- Consumes: `AffiliateOrderRecord`, `ClipThumbnail` (Task 3), `createEntryFromOrder` (Task 2)
- Produces: `Reconciliation({ orders }: { orders: AffiliateOrderRecord[] })`

- [ ] **Step 1: เขียน component**

สร้าง `components/reconciliation.tsx`:

```tsx
"use client";

import { useMemo, useTransition } from "react";
import { TriangleAlert, Plus } from "lucide-react";

import { createEntryFromOrder } from "@/app/actions";
import type { AffiliateOrderRecord } from "@/lib/dashboard";
import { ClipThumbnail } from "@/components/clip-thumbnail";
import { Button } from "@/components/ui/button";

export function Reconciliation({ orders }: { orders: AffiliateOrderRecord[] }) {
  const [isPending, startTransition] = useTransition();

  // สินค้าที่ขายได้แต่ยังไม่มี entry — รวมตาม content id
  const unmatched = useMemo(() => {
    const map = new Map<
      string,
      { contentId: string; productName: string; orders: number }
    >();
    for (const o of orders) {
      if (o.matchedEntryId !== null) continue;
      const ex = map.get(o.contentId);
      if (ex) ex.orders++;
      else map.set(o.contentId, { contentId: o.contentId, productName: o.productName, orders: 1 });
    }
    return [...map.values()].sort((a, b) => b.orders - a.orders);
  }, [orders]);

  if (unmatched.length === 0) return null;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-marigold/40 bg-marigold/5 p-4">
      <span className="flex items-center gap-1.5 font-medium text-foreground/90">
        <TriangleAlert className="size-4 text-marigold" />
        ขายได้แต่ยังไม่มีในแอป — ควรเพิ่ม entry
      </span>
      {unmatched.map((u) => (
        <div key={u.contentId} className="flex items-center gap-3">
          <ClipThumbnail contentId={u.contentId} />
          <span className="min-w-0 flex-1 truncate text-sm text-foreground/90">
            {u.productName || u.contentId}{" "}
            <span className="font-mono text-xs text-muted-foreground">
              ({u.orders} ออเดอร์)
            </span>
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                await createEntryFromOrder(u.contentId, u.productName);
              })
            }
          >
            <Plus className="size-3.5" />
            สร้าง entry
          </Button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: เรียกใน dashboard-panel**

ใน `components/dashboard-panel.tsx` เพิ่ม import:
```tsx
import { Reconciliation } from "@/components/reconciliation";
```
เพิ่มการเรียก **หลัง** ส่วนเงิน (ก่อน `RevenueByClipList`):
```tsx
      {orders.length > 0 && <Reconciliation orders={orders} />}
```
และ **ลบ** บล็อก reconciliation แบบเดิมที่โผล่ตอน import (บล็อก `{state.summary && (...)}` ที่มี `unmatchedProducts.map`) ออก — เหลือแค่บรรทัดสรุปสั้นๆ ว่านำเข้ากี่ออเดอร์ (แก้บล็อก `{state.summary && ...}` ให้เหลือ):
```tsx
      {state.summary && (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
          นำเข้า {state.summary.total} ออเดอร์ · จับคู่คลิปได้ {state.summary.matched}
        </div>
      )}
```

- [ ] **Step 3: build + lint + commit**

```bash
npm run build && npm run lint
git add components/reconciliation.tsx components/dashboard-panel.tsx
git commit -m "Name unmatched clips with thumbnails and one-click add"
```

---

### Task 8: ย้ายแถบเตือน (badge บนแท็บ + ในแท็บ dashboard) + ชื่อคลิปที่รอ

**Files:**
- Modify: `app/page.tsx`
- Modify: `components/prompt-workspace.tsx`
- Modify: `components/workspace-tabs.tsx`
- Modify: `components/reminder-banner.tsx`
- Modify: `components/dashboard-panel.tsx`

**Interfaces:**
- Produces: `WorkspaceTabs` รับ prop `dashboardAlert: boolean`; `DashboardPanel` รับ props เพิ่ม `reminder`, `reminderActive`, `awaitingClips`; `ReminderBanner` รับ prop เพิ่ม `awaitingClips: { id: string; productName: string }[]`
- type `AwaitingClip = { id: string; productName: string }`

- [ ] **Step 1: page.tsx — ส่งชื่อคลิปที่รอ**

ใน `app/page.tsx` — ตอนนี้คำนวณ `clipsAwaitingRevenue` เป็นตัวเลข ให้เก็บเป็นรายการด้วย. แก้ส่วนคำนวณ (แทนบล็อก `const clipsAwaitingRevenue = prompts.filter(...)`):

```tsx
  const awaitingClips = prompts
    .filter((p) => videoIdFromUrl(p.videoUrl) !== null && !matchedEntryIds.has(p.id))
    .map((p) => ({ id: p.id, productName: p.productName }));
  const clipsAwaitingRevenue = awaitingClips.length;
```
แล้วส่ง prop เพิ่มใน `<PromptWorkspace ...>`:
```tsx
      awaitingClips={awaitingClips}
```

- [ ] **Step 2: workspace-tabs.tsx — badge**

ใน `components/workspace-tabs.tsx` เพิ่ม prop `dashboardAlert` และจุดบนแท็บ dashboard. แก้ signature:
```tsx
export function WorkspaceTabs({
  active,
  onChange,
  productionDisabled,
  dashboardAlert,
}: {
  active: WorkspaceTab;
  onChange: (tab: WorkspaceTab) => void;
  productionDisabled: boolean;
  dashboardAlert: boolean;
}) {
```
ในปุ่ม (ใน `.map`) เพิ่มจุดหลัง label เมื่อเป็นแท็บ dashboard และ `dashboardAlert`:
```tsx
            {tab.label}
            {tab.id === "dashboard" && dashboardAlert && (
              <span className="ml-1 inline-block size-1.5 rounded-full bg-record align-middle" />
            )}
```

- [ ] **Step 3: reminder-banner.tsx — รับ awaitingClips + โชว์ชื่อ**

ใน `components/reminder-banner.tsx` แก้ `messages()` และ signature ให้รับ `awaitingClips`. เปลี่ยน `messages`:
```tsx
function messages(r: ReminderState, awaitingClips: { id: string; productName: string }[]): string[] {
  const out: string[] = [];
  if (r.daysSinceImport !== null && r.daysSinceImport > 7) {
    out.push(`ไม่ได้นำเข้าข้อมูลรายได้มา ${r.daysSinceImport} วันแล้ว`);
  }
  if (r.clipsAwaitingRevenue >= 3) {
    const names = awaitingClips.slice(0, 3).map((c) => c.productName).join(", ");
    const more = awaitingClips.length > 3 ? ` และอีก ${awaitingClips.length - 3}` : "";
    out.push(`คลิปที่ยังไม่มีข้อมูลรายได้: ${names}${more}`);
  }
  if (r.unmatchedSoldProducts > 0) {
    out.push(`มี ${r.unmatchedSoldProducts} สินค้าที่ขายได้แต่ยังไม่มีในแอป`);
  }
  return out;
}
```
แก้ signature ของ `ReminderBanner` ให้รับ `awaitingClips` และส่งเข้า `messages`:
```tsx
export function ReminderBanner({
  reminder,
  onGoImport,
  awaitingClips,
}: {
  reminder: ReminderState;
  onGoImport: () => void;
  awaitingClips: { id: string; productName: string }[];
}) {
  const msgs = messages(reminder, awaitingClips);
```
> คง logic `useSyncExternalStore` / signature / dismiss เดิมไว้ทั้งหมด แก้แค่ `messages` + signature

- [ ] **Step 4: prompt-workspace.tsx — เอา banner ออกจาก header, ส่ง props, badge**

ใน `components/prompt-workspace.tsx`:

เพิ่ม type + prop ใน signature (เพิ่ม `awaitingClips`):
```tsx
  affiliateOrders,
  reminder,
  reminderActive,
  awaitingClips,
}: {
  prompts: PromptEntry[];
  corePrompts: CorePromptRecord[];
  affiliateOrders: AffiliateOrderRecord[];
  reminder: ReminderState;
  reminderActive: boolean;
  awaitingClips: { id: string; productName: string }[];
}) {
```
**ลบ** บรรทัด ReminderBanner ที่คั่นกลาง (บรรทัด `{reminderActive && <ReminderBanner ... />}` ใต้ `</ClapperHeader>`) ออก และลบ import `ReminderBanner` (ย้ายไปใช้ใน dashboard-panel)

ส่ง `dashboardAlert` ให้ WorkspaceTabs:
```tsx
        <WorkspaceTabs
          active={tab}
          onChange={setTab}
          productionDisabled={selectedEntry === null}
          dashboardAlert={reminderActive}
        />
```
ส่ง props ให้ DashboardPanel:
```tsx
        {tab === "dashboard" && (
          <div className="flex flex-1 flex-col p-4 sm:p-6 lg:overflow-y-auto">
            <DashboardPanel
              orders={affiliateOrders}
              reminder={reminder}
              reminderActive={reminderActive}
              awaitingClips={awaitingClips}
            />
          </div>
        )}
```

- [ ] **Step 5: dashboard-panel.tsx — รับ props + แสดง reminder บนสุด**

ใน `components/dashboard-panel.tsx`:
เพิ่ม import:
```tsx
import { ReminderBanner } from "@/components/reminder-banner";
import type { ReminderState } from "@/lib/dashboard";
```
แก้ signature:
```tsx
export function DashboardPanel({
  orders,
  reminder,
  reminderActive,
  awaitingClips,
}: {
  orders: AffiliateOrderRecord[];
  reminder: ReminderState;
  reminderActive: boolean;
  awaitingClips: { id: string; productName: string }[];
}) {
```
ใส่ ReminderBanner บนสุดของ section (หลัง `<div className="flex items-center gap-2 border-b ...">` ที่เป็นหัว "Dashboard"):
```tsx
      {reminderActive && (
        <ReminderBanner
          reminder={reminder}
          onGoImport={() => {}}
          awaitingClips={awaitingClips}
        />
      )}
```
> `onGoImport` ในแท็บ dashboard ไม่ต้องพาไปไหน (อยู่ในแท็บนี้แล้ว) ส่งฟังก์ชันเปล่า — แต่เพื่อไม่ให้ปุ่ม "ไปที่ Dashboard" งง ให้แก้ปุ่มใน reminder-banner ตอนอยู่ในแท็บนี้... (คงปุ่มไว้ กดแล้วเฉยๆ ยอมรับได้ หรือถ้าจะเนียนให้เอาปุ่มออกเมื่อ onGoImport เป็น noop — ทำ optional) — **ทางเลือกที่สะอาด:** ทำ `onGoImport` เป็น optional ใน ReminderBanner ถ้าไม่ส่งมาก็ไม่โชว์ปุ่ม:

ปรับ `ReminderBanner` prop เป็น `onGoImport?: () => void` และซ่อนปุ่มเมื่อไม่มี:
```tsx
        {onGoImport && (
          <Button type="button" size="sm" onClick={onGoImport} className="bg-marigold text-ink hover:bg-marigold/90">
            ไปที่ Dashboard
          </Button>
        )}
```
แล้วใน dashboard-panel ส่ง `onGoImport` แบบไม่ส่ง (undefined) — ลบ prop นั้นออกจากการเรียก:
```tsx
      {reminderActive && (
        <ReminderBanner reminder={reminder} awaitingClips={awaitingClips} />
      )}
```

- [ ] **Step 6: build + lint + commit**

```bash
npm run build && npm run lint
git add app/page.tsx components/prompt-workspace.tsx components/workspace-tabs.tsx components/reminder-banner.tsx components/dashboard-panel.tsx
git commit -m "Move the reminder onto a tab badge and into the dashboard"
```

---

### Task 9: ทดสอบ end-to-end + CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: ขับจริงในเบราว์เซอร์**

เคลียร์ port (เช็กก่อนว่าไม่ใช่ start.bat ของผู้ใช้) แล้ว `npm run dev &`, รอ `UP`. เขียน `$SCRATCH/redesign-e2e.js` (Playwright ใน scratch) ตรวจ:
1. เปิดแอป → มี **จุดแดงบนแท็บ "④ รายได้"** (reminderActive) → คลิกแท็บ
2. **ส่วนเงิน:** การ์ด "เงินที่ได้จริงแล้ว" โชว์ ~฿544 (ตัวใหญ่สุด), การ์ด "กำลังรอ" โชว์จำนวน+มูลค่า+ประเมินค่าคอม ~฿725, ไม่มีคำว่า "GMV รวม" เป็นหัวการ์ดอีก (มีแค่ในบรรทัดเล็ก)
3. **thumbnail:** ในส่วน "คลิปทำเงิน" มี `img` ขึ้นจริง (`naturalWidth > 0`) อย่างน้อย 1 รูป (รอ resolve สัก 3-5 วิ) — ยืนยันว่า oEmbed + cache ทำงาน
4. **sparkline:** มี "แนวโน้มรายได้" + ปุ่ม "ดูกราฟ" → กดแล้ว `svg[aria-label="กราฟ GMV ตามวัน"]` โผล่
5. **reconciliation:** ส่วน "ขายได้แต่ยังไม่มีในแอป" โชว์ชื่อสินค้า (เช่นโต๊ะรีดผ้า) + ปุ่ม "สร้าง entry"
6. **แถบเตือนไม่คั่นกลาง header/content แล้ว** (ตรวจว่าไม่มี ReminderBanner อยู่นอกแท็บ dashboard)
7. ไม่มี console error, ไม่มี emoji ในหน้า

รายงานผลจริงเป็นตัวเลข ห้ามสรุปว่า "น่าจะผ่าน"

- [ ] **Step 2: ตรวจ DB + ข้อมูลจริงไม่หาย**

```bash
node -e "const D=require('better-sqlite3');const db=new D('dev.db',{readonly:true});console.log('entries:',db.prepare('SELECT COUNT(*) c FROM PromptEntry').get().c,'orders:',db.prepare('SELECT COUNT(*) c FROM AffiliateOrder').get().c,'thumbs cached:',db.prepare('SELECT COUNT(*) c FROM VideoThumbnail').get().c);db.close();"
```
คาดหวัง: `entries` ≥ 22 (อาจ +1 ถ้าเทสกดสร้าง entry — ถ้าเทสสร้าง entry ให้ลบเฉพาะตัวที่สร้างด้วย `WHERE productName='<ชื่อที่กด>'` และ productInfo=''), `orders: 79`, `thumbs cached` > 0

> **ถ้า e2e กดปุ่ม "สร้าง entry":** จะมี PromptEntry stub เพิ่ม + ออเดอร์ถูกผูก — ล้างเฉพาะที่ทดสอบ: `npx prisma db execute --stdin <<< "DELETE FROM PromptEntry WHERE productInfo = '' AND productName = '<ชื่อสินค้าที่กด>';"` (ระวัง: เจาะจง ห้ามลบกว้าง) แล้ว re-import ไฟล์เพื่อคืน matchedEntryId ให้ตรง หรือปล่อยไว้ก็ได้ถ้าไม่กระทบ

- [ ] **Step 3: ปิด dev server** (`taskkill //PID <pid> //F` เฉพาะตัวที่ตัวเองสตาร์ท)

- [ ] **Step 4: CLAUDE.md**

แก้ section `## Dashboard รายได้ (แท็บ ④)` — เพิ่มบรรทัด:
```
- ส่วนเงินแยก "เงินที่ได้จริง" (`settledRevenue`) เป็นพระเอก กับ "กำลังรอ" (`pendingGmv` + `estimatedPendingCommission` = pendingGmv × อัตราจริง) — ไม่โชว์ GMV รวมเป็นหัวอีก (`summarizeOrders` ใน `lib/dashboard.ts` คืน field แยกครบ)
- thumbnail คลิปมาจาก **TikTok oEmbed** (สาธารณะ ไม่ต้อง auth) — `lib/tiktok-oembed.ts` ไฟล์เดียวที่รู้จัก endpoint, cache ในตาราง `VideoThumbnail` (เก็บแม้ล้มเหลว ok=false กันยิงซ้ำ), resolve ผ่าน Server Action `resolveThumbnail` (client เรียก lazy), fallback เป็นไอคอนเมื่อคลิปโดนลบ — นี่คือการยิงเน็ตออกนอกเครื่องที่เดียวของแอป
- `createEntryFromOrder` สร้าง entry ขั้นต่ำจากออเดอร์ที่ยังไม่มีในแอป แล้ว `updateMany` ผูก `matchedEntryId` ให้ทันที
- **ธีม dashboard ทำเป็นกลางๆ ไม่ใส่ motif คลปเปอร์บอร์ด** (ผู้ใช้กำลังจะเลิกธีมหนัง — การเปลี่ยนชื่อ+re-theme ทั้งแอปเป็นโปรเจกต์แยก)
```

- [ ] **Step 5: build + commit**

```bash
npm run build && npm run lint
git add CLAUDE.md
git commit -m "Document the dashboard redesign"
```

---

## Verification (ทั้งฟีเจอร์)

- `npm run build` + `npm run lint` สะอาด
- เงินจริง (settled ~฿544) เป็นพระเอก, กำลังรอแยก + ประเมิน ~฿725, ไม่มี "GMV รวม" เป็นหัว
- thumbnail โหลดจริงในคลิปทำเงิน + reconciliation, fallback ตอนดึงไม่ได้ ไม่พัง
- sparkline + ปุ่มดูกราฟ, กราฟสถานะ/คลิปแบบเดิมหายไป
- reconciliation โชว์ชื่อ + thumbnail + สร้าง entry ได้ (ผูก order ทันที)
- แถบเตือนไม่คั่น header แล้ว มี badge บนแท็บ ④ + รายละเอียด(ชื่อคลิป)ในแท็บ
- ไม่มี emoji, ไม่มี motif ธีมหนังใหม่
- ข้อมูลจริง (entries + Core Prompt + AffiliateOrder) ไม่หาย

## Git

ทำต่อบน branch `feature/affiliate-dashboard` (redesign แก้โค้ดที่ PR #2 สร้าง — fold เข้า PR เดิม) **หรือ** merge PR #2 ก่อนแล้วแตก branch ใหม่ — ตัดสินใจตอนเริ่ม subagent-driven-development
