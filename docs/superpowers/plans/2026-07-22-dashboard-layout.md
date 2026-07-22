# Dashboard Layout Reorganization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** จัดลำดับ section ในแท็บ Dashboard ใหม่ตามความถี่ที่ใช้จริง และยุบฟอร์มอัปโหลด 3 อันเป็นกลุ่มพับได้ที่กางเองเมื่อข้อมูลถึงรอบต้องนำเข้า

**Architecture:** แตะไฟล์เดียวคือ `components/dashboard-panel.tsx` — เปลี่ยนลำดับที่เรียก component ใน JSX, ย้าย feedback ของฟอร์มแรกให้ติดกับฟอร์มตัวเอง, แก้ข้อความ empty state ที่จะชี้ผิดทาง, แล้วครอบฟอร์มทั้ง 3 ด้วยกลุ่มพับได้ที่ค่าเริ่มต้นมาจาก `reminderActive` ไม่แตะ logic การคำนวณหรือ component ลูกใดๆ

**Tech Stack:** Next.js 16 (App Router, client component), React 19 (`useState`/`useActionState`), Tailwind v4, lucide-react

## Global Constraints

- **ไม่มี test runner** — verify ด้วย `npx tsc --noEmit` + `npm run lint` + ดู UI จริง ไม่ใช่ unit test
- **ห้ามรัน `npm run build`** — ผู้ใช้รัน production server บน port 3000 อยู่เกือบตลอด `npx tsc --noEmit` ใช้แทนได้และไม่แตะ `.next` · **ห้าม kill process บน port 3000 เด็ดขาด** (เป็น server ที่ผู้ใช้ใช้ทำงานจริงทุกวัน)
- **ดู UI จริงต้องแยกทุกอย่างออกจากของผู้ใช้:** `cp dev.db dev-test.db` แล้ว `NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001` · เสร็จแล้ว stop server ตัวเอง + `rm dev-test.db`
- **การรัน dev server อาจแก้ `tsconfig.json` transient** (Next auto-patch) — เช็ก `git diff tsconfig.json` ก่อน commit ทุกครั้ง ถ้าเปลี่ยนให้ `git checkout -- tsconfig.json` (repo pin `target: "ES2017"` ไว้ตั้งใจ)
- **ห้าม emoji · ข้อความไทย · design token เดิมเท่านั้น** (`ink`/`paper`/`marigold`/`rust`/`smoke`/`record`) ห้ามเพิ่มสี/ฟอนต์ใหม่
- **ห้ามแตะ logic การคำนวณ** — `summarizeOrders`, `useActionState` ทั้ง 3 ตัว, และ component ลูก (`Recommendations`/`PostTimePanel`/`Reconciliation`/`RevenueByClipList`/`RevenueTrend`/`ReminderBanner`) ห้ามแก้ข้างใน แค่เปลี่ยนลำดับที่เรียก
- **ห้ามตัด/ย่อโน้ตความซื่อสัตย์ใต้การ์ดเงิน** (ยอดสั่งรวม/ชิ้น/ไม่มีสิทธิ์/อัตราค่าคอม/คำเตือนว่าช้ากว่าจริง) — เป็นหลักการของโปรเจกต์ว่าข้อมูลเงินต้องไม่ทำให้เข้าใจผิด
- **ต้องคง guard `orders.length > 0` ทุกจุด** — `Reconciliation`/`RevenueByClipList`/`RevenueTrend`/การ์ดเงิน ถ้าทำหายหน้าจะพังตอนยังไม่มีข้อมูล
- ห้าม `git add -A` / `git add .` — stage เฉพาะไฟล์ที่ระบุ
- branch: `feature/dashboard-layout` (มี spec commit `f07f69c` แล้ว)

**ลำดับเป้าหมายสุดท้าย (ทั้ง 2 task รวมกันแล้วต้องได้แบบนี้):**

```
[หัวข้อ Dashboard]
[ReminderBanner]                    ← reminderActive
[ควรทำอะไรต่อ]                      ← Recommendations
[การ์ดเงิน + โน้ต | empty state]     ← orders.length ternary
[รายได้ต่อคลิป]                      ← orders.length > 0
[กราฟเทรนด์]                        ← orders.length > 0
[สินค้าขายได้แต่ยังไม่มี entry]        ← orders.length > 0
[เวลาโพสต์ vs วิว]                   ← PostTimePanel
[กลุ่มนำเข้าข้อมูล]                   ← ปุ่มพับ + บรรทัดสถานะ + 3 ฟอร์ม
```

---

### Task 1: เรียงลำดับใหม่ + ย้าย feedback + แก้ข้อความ empty state

**Files:**
- Modify: `components/dashboard-panel.tsx` (เฉพาะ JSX ใน `return` ตั้งแต่บรรทัด ~105 ถึงท้ายไฟล์)

**Interfaces:**
- Consumes: props เดิมทั้งหมด (`orders`, `clipMetrics`, `followerActivity`, `reminder`, `reminderActive`, `lastImportedAt`, `entries`, `now`) และ state เดิมทั้ง 3 ชุด (`state`/`action`/`isImporting`, `metricState`/`metricAction`/`isImportingMetrics`, `followerState`/`followerAction`/`isImportingFollowers`) — **ไม่เพิ่ม ไม่ลบ prop หรือ state ใดๆ ใน task นี้**
- Produces: ลำดับ JSX ใหม่ที่ Task 2 จะเอาไปครอบด้วยกลุ่มพับได้

**หมายเหตุ:** task นี้เป็นการ**ย้ายบล็อกล้วนๆ** ไม่สร้าง state ใหม่ ไม่แตะ logic — ทุกบล็อกที่ย้ายต้องคัดลอกมาทั้งก้อนแบบไม่แก้เนื้อใน ยกเว้นข้อความ empty state 1 คำที่ระบุใน Step 2

- [ ] **Step 1: แทนที่ JSX ทั้งบล็อก `return` ด้วยลำดับใหม่**

เปิด `components/dashboard-panel.tsx` แล้วแทนที่ตั้งแต่ `return (` (บรรทัด ~105) จนจบไฟล์ ด้วยโค้ดนี้ทั้งหมด:

```tsx
  return (
    <section className="flex flex-1 flex-col gap-5 rounded-xl border border-border bg-card p-5 sm:p-6">
      <div className="flex items-center gap-2 border-b border-border pb-3">
        <span className="h-4 w-1 rounded-full bg-marigold" />
        <h2 className="font-mono text-xs tracking-widest text-marigold uppercase">
          Dashboard · รายได้ Affiliate
        </h2>
      </div>

      {reminderActive && <ReminderBanner reminder={reminder} />}

      <Recommendations
        entries={entries}
        metrics={clipMetrics}
        orders={orders}
        now={now}
      />

      {orders.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          ยังไม่มีข้อมูลรายได้ — นำเข้าไฟล์ด้านล่างเพื่อเริ่ม
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

      {orders.length > 0 && <RevenueByClipList orders={orders} />}
      {orders.length > 0 && <RevenueTrend orders={orders} />}
      {orders.length > 0 && <Reconciliation orders={orders} />}

      <PostTimePanel
        entries={entries}
        metrics={clipMetrics}
        followerActivity={followerActivity}
      />

      {/* นำเข้าข้อมูล — งานประจำสัปดาห์ อยู่ล่างสุด */}
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
          นำเข้า {state.summary.total} ออเดอร์ · จับคู่คลิปได้ {state.summary.matched}
        </div>
      )}

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

      <form action={followerAction} className="flex flex-wrap items-center gap-2">
        <Input
          type="file"
          name="file"
          accept=".csv,text/csv"
          className="h-auto max-w-xs py-1.5"
          required
        />
        <Button type="submit" size="sm" variant="outline" disabled={isImportingFollowers}>
          <Upload className="size-3.5" />
          {isImportingFollowers ? "กำลังนำเข้า..." : "นำเข้าผู้ติดตามรายชั่วโมง"}
        </Button>
        <span className="font-mono text-[0.7rem] text-muted-foreground">
          โหลดจาก TikTok Studio → Analytics → Followers → Download (FollowerActivity.csv)
        </span>
      </form>

      {followerState.error && (
        <p className="rounded-md border border-record/40 bg-record/10 px-3 py-2 text-sm text-record">
          {followerState.error}
        </p>
      )}

      {followerState.summary && (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
          นำเข้า {followerState.summary.total} แถว · {followerState.summary.days} วัน
        </div>
      )}

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
    </section>
  );
}
```

การเปลี่ยนแปลงเทียบของเดิมมี 4 อย่างเท่านั้น: (1) `Recommendations` ขึ้นมาก่อนการ์ดเงิน (2) `PostTimePanel` ย้ายลงไปหลัง `Reconciliation` (3) ฟอร์มทั้ง 3 + บรรทัดสถานะย้ายลงล่างสุด โดย `state.error`/`state.summary` ของฟอร์มแรกย้ายมาอยู่ใต้ฟอร์มแรก (4) `Reconciliation` ย้ายมาหลัง `RevenueTrend`

- [ ] **Step 2: ยืนยันว่าข้อความ empty state แก้แล้ว**

ในโค้ดที่วางไปแล้ว ตรวจว่าบรรทัดนี้เป็น **"ด้านล่าง"** ไม่ใช่ "ด้านบน":

```tsx
          ยังไม่มีข้อมูลรายได้ — นำเข้าไฟล์ด้านล่างเพื่อเริ่ม
```

Run: `grep -n "นำเข้าไฟล์ด้าน" components/dashboard-panel.tsx`
Expected: เจอ 1 บรรทัด และเป็น `ด้านล่าง` (ถ้ายังเจอ `ด้านบน` แปลว่าวางโค้ดไม่ครบ)

- [ ] **Step 3: Verify type-check + lint**

Run: `npx tsc --noEmit`
Expected: ผ่าน ไม่มี error

Run: `npm run lint`
Expected: สะอาด ไม่มี warning ใหม่

- [ ] **Step 4: Verify ลำดับใน UI จริง**

```bash
cp dev.db dev-test.db
NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001
```

เปิด `localhost:3001` แท็บ Dashboard
Expected: ลำดับจากบนลงล่างเป็น **ควรทำอะไรต่อ → การ์ดเงิน → รายได้ต่อคลิป → กราฟเทรนด์ → สินค้าขายได้แต่ยังไม่มี entry → เวลาโพสต์ → ฟอร์มอัปโหลด 3 อัน → บรรทัดสถานะนำเข้า**
และข้อมูลเดิมยังแสดงครบ (การ์ดเงินมีตัวเลข, ควรทำอะไรต่อมี 2 สัญญาณ, สินค้าไม่มี entry มี 3 รายการ) ไม่มี console error

หยุด dev server ตัวเอง แล้ว `rm dev-test.db`

- [ ] **Step 5: เช็ก tsconfig แล้ว commit**

Run: `git diff tsconfig.json`
Expected: ว่าง — ถ้าไม่ว่างให้ `git checkout -- tsconfig.json` ก่อน

```bash
git add components/dashboard-panel.tsx
git commit -m "Reorder dashboard by how often each block is read"
```

---

### Task 2: ยุบฟอร์มอัปโหลดเป็นกลุ่มพับได้ที่กางเองเมื่อถึงรอบ

**Files:**
- Modify: `components/dashboard-panel.tsx` (import ด้านบน + บล็อกฟอร์มท้ายไฟล์)

**Interfaces:**
- Consumes: ลำดับ JSX จาก Task 1 · prop `reminderActive: boolean` (มีอยู่แล้ว) · prop `lastImportedAt` และ `reminder` สำหรับบรรทัดสถานะ
- Produces: ไม่มี — เป็น task สุดท้าย

- [ ] **Step 1: เพิ่ม `useState` และไอคอน chevron ใน import**

แก้ 2 บรรทัดบนสุดของไฟล์:

```tsx
import { useActionState, useState } from "react";
import { ChevronDown, ChevronRight, Upload } from "lucide-react";
```

- [ ] **Step 2: เพิ่ม state ของกลุ่มพับ**

ใน `DashboardPanel` วางต่อจากบรรทัด `const summary = summarizeOrders(orders);`:

```tsx
  // กางเองเมื่อข้อมูลถึงรอบต้องนำเข้า — ผู้ใช้ลืมง่าย ระบบจึงยกงานขึ้นมาเองแทนที่จะให้จำ
  // หลังจากนั้นกดสลับเองได้อิสระ (ค่านี้เป็นแค่ค่าตั้งต้นตอน mount)
  const [importsOpen, setImportsOpen] = useState(reminderActive);
```

- [ ] **Step 3: ครอบฟอร์มทั้ง 3 ด้วยกลุ่มพับได้**

แทนที่ทุกอย่างตั้งแต่คอมเมนต์ `{/* นำเข้าข้อมูล — งานประจำสัปดาห์ อยู่ล่างสุด */}` จนถึงก่อน `</section>` ด้วยโค้ดนี้:

```tsx
      {/* นำเข้าข้อมูล — งานประจำสัปดาห์ อยู่ล่างสุด พับไว้เมื่อยังไม่ถึงรอบ */}
      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <button
          type="button"
          onClick={() => setImportsOpen((open) => !open)}
          aria-expanded={importsOpen}
          className="flex items-center gap-1.5 self-start font-mono text-xs tracking-widest text-marigold uppercase hover:text-marigold/80"
        >
          {importsOpen ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
          นำเข้าข้อมูล
        </button>

        {/* บรรทัดสถานะอยู่นอกส่วนที่พับเสมอ — พับหรือกางก็ต้องเห็น */}
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

        {importsOpen && (
          <>
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
                นำเข้า {state.summary.total} ออเดอร์ · จับคู่คลิปได้ {state.summary.matched}
              </div>
            )}

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

            <form action={followerAction} className="flex flex-wrap items-center gap-2">
              <Input
                type="file"
                name="file"
                accept=".csv,text/csv"
                className="h-auto max-w-xs py-1.5"
                required
              />
              <Button type="submit" size="sm" variant="outline" disabled={isImportingFollowers}>
                <Upload className="size-3.5" />
                {isImportingFollowers ? "กำลังนำเข้า..." : "นำเข้าผู้ติดตามรายชั่วโมง"}
              </Button>
              <span className="font-mono text-[0.7rem] text-muted-foreground">
                โหลดจาก TikTok Studio → Analytics → Followers → Download (FollowerActivity.csv)
              </span>
            </form>

            {followerState.error && (
              <p className="rounded-md border border-record/40 bg-record/10 px-3 py-2 text-sm text-record">
                {followerState.error}
              </p>
            )}

            {followerState.summary && (
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                นำเข้า {followerState.summary.total} แถว · {followerState.summary.days} วัน
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Verify type-check + lint**

Run: `npx tsc --noEmit`
Expected: ผ่าน

Run: `npm run lint`
Expected: สะอาด ไม่มี warning ใหม่

- [ ] **Step 5: Verify พฤติกรรมพับ/กางใน UI จริง**

```bash
cp dev.db dev-test.db
NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001
```

เปิด `localhost:3001` แท็บ Dashboard แล้วตรวจ 4 ข้อ:

1. **กลุ่ม "นำเข้าข้อมูล" พับอยู่** (เห็นแค่ปุ่มกับ chevron ชี้ขวา ไม่เห็นฟอร์ม) — เพราะ import ล่าสุดคือ 20 ก.ค. ยังไม่เกิน `IMPORT_STALE_DAYS` (7 วัน) ดังนั้น `reminderActive` เป็น false
2. **บรรทัดสถานะ "นำเข้าล่าสุด ... · รอบถัดไป ~..." ยังเห็นอยู่ทั้งที่พับ**
3. กดปุ่ม → กางออก เห็นฟอร์มครบ 3 อัน chevron เปลี่ยนเป็นชี้ลง กดอีกทีพับกลับได้
4. กางแล้วลองอัปโหลด `creative_data/Followers_rainny0192/FollowerActivity.csv` → ขึ้นสรุป "นำเข้า 168 แถว · 7 วัน" **ใต้ฟอร์มตัวเอง** (ไม่ใช่ไปโผล่ที่อื่น) และกลุ่มไม่พับตัวเองหลังส่งฟอร์ม

หยุด dev server ตัวเอง แล้ว `rm dev-test.db`

- [ ] **Step 6: เช็ก tsconfig แล้ว commit**

Run: `git diff tsconfig.json`
Expected: ว่าง — ถ้าไม่ว่างให้ `git checkout -- tsconfig.json` ก่อน

```bash
git add components/dashboard-panel.tsx
git commit -m "Collapse the import forms into a group that opens itself when data is stale"
```

---

## Self-Review (ผู้เขียนแผนตรวจแล้ว)

**Spec coverage:** §ลำดับใหม่ → Task 1 Step 1 · §feedback ติดฟอร์มทุกอัน → Task 1 Step 1 (ย้าย `state.error`/`state.summary` มาใต้ฟอร์มแรก) · §แก้ข้อความ empty state → Task 1 Step 1-2 · §กลุ่มพับได้ + กางเองเมื่อ `reminderActive` → Task 2 Step 2-3 · §บรรทัดสถานะอยู่นอกส่วนพับ ใต้ปุ่ม → Task 2 Step 3 · §คง guard `orders.length > 0` → มีครบทั้ง 4 จุดในโค้ด Task 1 · §ห้ามตัดโน้ตความซื่อสัตย์ → คัดลอกมาครบทุกบรรทัดใน Task 1 · §ไม่ทำ 2 คอลัมน์/ไม่รวมฟอร์ม/ไม่แตะ logic → ไม่มี task ไหนทำ (ถูกต้อง)

**Type consistency:** ไม่มี type ใหม่ในแผนนี้เลย — ใช้ prop และ state เดิมทั้งหมด · `importsOpen: boolean` เป็น local state ตัวเดียวที่เพิ่ม ใช้เฉพาะใน Task 2 · ชื่อ handler เดิม (`action`/`metricAction`/`followerAction`) และ flag เดิม (`isImporting`/`isImportingMetrics`/`isImportingFollowers`) ใช้ตรงกันทั้ง 2 task

**Placeholder scan:** ไม่มี TBD/TODO — ทุก step ที่แก้โค้ดมีโค้ดเต็มให้วางได้เลย · verification เป็นคำสั่งจริงพร้อมค่าที่คาดหวังเจาะจง (ลำดับ 8 บล็อก, พับอยู่เพราะ 20 ก.ค. ยังไม่เกิน 7 วัน, 168 แถว) · ไม่มี unit test เพราะโปรเจกต์ไม่มี test runner (ระบุใน Global Constraints)

**จุดที่ต้องระวังเป็นพิเศษ:** Task 2 ย้ายบรรทัดสถานะที่ Task 1 เพิ่งวางไว้ท้ายสุด ขึ้นไปอยู่ใต้ปุ่มพับ — ถ้าลืมลบของเดิมจะมีบรรทัดสถานะซ้ำสองอัน (โค้ดใน Task 2 Step 3 สั่งแทนที่ตั้งแต่คอมเมนต์ถึงก่อน `</section>` ซึ่งครอบคลุมบรรทัดสถานะเดิมอยู่แล้ว)
