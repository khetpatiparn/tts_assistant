# Spec: ปุ่มกรองวันด่วน + ตัวสลับฐานวันที่ + ปุ่มล้างตัวกรองที่คงอยู่

## Context

หน้ารายการ (`/`) มีตัวกรองอยู่แล้ว: คำค้น, สถานะ (4 ปุ่ม), ช่วงวันที่ (ปฏิทิน 2 ช่อง `DateRangeFields` ในฟอร์มค้นหา) — ทั้งหมดเป็น URL query params อ่านที่ `app/page.tsx` (server component) ไม่มี client state

ผู้ใช้เจอ 2 ปัญหาจริงจากการใช้งาน:
1. **อยากรู้เร็วๆ ว่า "วันนี้/สัปดาห์นี้/เดือนนี้" ทำอะไรไปแล้วบ้าง** โดยไม่ต้องเปิดปฏิทินเลือกวันเอง
2. **ปุ่ม "ล้างตัวกรองทั้งหมด" หายไปเมื่อกรองแล้วยังเจอผลลัพธ์บ้าง** — ปัจจุบัน (`components/entry-list.tsx:160`) ปุ่มนี้เรนเดอร์เฉพาะตอน `rows.length === 0` เท่านั้น ผู้ใช้ต้อง refresh หน้าเว็บเองเพื่อล้างตัวกรอง

## การตัดสินใจที่ยืนยันแล้วกับผู้ใช้

- **ปุ่มด่วนใช้ได้ทั้งสองฐานวันที่** (`postedAt` วันลงคลิป กับ `createdAt` วันสร้าง) สลับกันได้ด้วย toggle เล็กๆ — ไม่ล็อกไว้ฐานเดียว
- **ตำแหน่ง:** แถวเดียวกับปุ่มสถานะ (ทั้งหมด/ยังไม่มี prompt/รอลงคลิป/ลงแล้ว) ต่อท้ายด้วยเส้นแบ่ง แล้วตามด้วยปุ่มด่วน + ตัวสลับ
- **ปุ่มล้างตัวกรอง** ย้ายไปแปะที่บรรทัดสรุปผล (`พบ N จาก M รายการ`) ซึ่งเรนเดอร์เสมอเมื่อ `isFiltering === true` ไม่ว่าจะเจอผลลัพธ์กี่รายการ — ปุ่มเดิมในกล่อง "ไม่พบรายการ" ตัดออกเพราะซ้ำซ้อน
- **ไม่แตะ** `DateRangeFields`/`DatePickerField` (ปฏิทินเลือกเอง) — เป็นฟีเจอร์คนละจุดประสงค์ ใช้คู่กันได้ตามปกติ
- **Risk ที่ยอมรับ:** "วันนี้" คำนวณจากเวลาเซิร์ฟเวอร์ตอน request (`new Date()`) ถ้าเซิร์ฟเวอร์ไม่ได้รันโซนเวลาไทย อาจเพี้ยน 1 วันช่วงตี 0-7 — ความเสี่ยงนี้มีอยู่แล้วในฟีเจอร์ปฏิทินเดิม ไม่ใช่ปัญหาใหม่ที่งานนี้สร้าง ไม่แก้ในงานนี้

## Design

### `lib/entry-date-filter.ts` — เพิ่ม 2 exports ใหม่ ไม่แก้ของเดิม

```ts
export type DateFilterBasis = "posted" | "created";

/** ค่า invalid หรือไม่มีค่า → fallback "posted" (พฤติกรรมเดิมของลิงก์เก่าที่ไม่มี by param) */
export function parseDateBasisParam(raw: string | string[] | undefined): DateFilterBasis {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "created" ? "created" : "posted";
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

  function startOfLocalDay(dateStr: string): number {
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(y, m - 1, d).getTime();
  }
  function endOfLocalDay(dateStr: string): number {
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
  }

  const fromMs = from !== null ? startOfLocalDay(from) : -Infinity;
  const toMs = to !== null ? endOfLocalDay(to) : Infinity;

  return rows.filter((r) => {
    const ms = new Date(r.createdAt).getTime();
    return ms >= fromMs && ms <= toMs;
  });
}
```

### `app/page.tsx` — เลือกฟังก์ชันกรองตาม `by`

```ts
import {
  filterByPostedDateRange,
  filterByCreatedDateRange,
  parseDateParam,
  parseDateBasisParam,
} from "@/lib/entry-date-filter";

// ...
const by = parseDateBasisParam(sp.by);
const dateFiltered =
  by === "created"
    ? filterByCreatedDateRange(rows, from, to)
    : filterByPostedDateRange(rows, from, to);
```

ส่ง `by` เพิ่มเป็น prop ให้ `EntryList`

### `components/entry-list.tsx`

**1. `buildHref` เพิ่มพารามิเตอร์ `by`:**

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
  if (params.by === "created") sp.set("by", params.by); // "posted" คือ default ไม่ต้องใส่
  if (params.page > 1) sp.set("page", String(params.page));
  const qs = sp.toString();
  return qs === "" ? "/" : `/?${qs}`;
}
```

ทุกจุดที่เรียก `buildHref` เดิม (ปุ่มสถานะ) ต้องส่ง `by` เพิ่มด้วย (ใช้ `by` prop ที่รับมา คงค่าเดิมไว้)

**2. Prop ใหม่ของ `EntryList`:** เพิ่ม `by: DateFilterBasis` เข้า props type

**3. คำนวณช่วงวันที่ด่วน — วางไว้ในตัว component เอง (server component, คำนวณตอน render):**

```ts
/** "YYYY-MM-DD" ของวันนี้ตามฐานที่เลือก — posted ใช้ UTC getter (คีย์เดียวกับที่ postedAt เก็บ),
 *  created ใช้ local getter (คีย์เดียวกับ createdAt) เหตุผลเดียวกับฟังก์ชันกรองด้านบน */
function todayKey(by: DateFilterBasis): string {
  const now = new Date();
  const y = by === "created" ? now.getFullYear() : now.getUTCFullYear();
  const m = by === "created" ? now.getMonth() : now.getUTCMonth();
  const d = by === "created" ? now.getDate() : now.getUTCDate();
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function daysAgoKey(by: DateFilterBasis, days: number): string {
  const now = new Date();
  const base = by === "created"
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

**4. JSX — แถวปุ่มสถานะเดิม ต่อท้ายด้วยกลุ่มใหม่ (แทนที่บล็อกบรรทัด 123-139 เดิม):**

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

**5. บรรทัดสรุปผล — เพิ่มลิงก์ล้างตัวกรอง (แทนที่บรรทัด 141-143 เดิม):**

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

**6. กล่อง "ไม่พบรายการ" (บรรทัด 145-164 เดิม) — ตัดปุ่ม "ล้างตัวกรองทั้งหมด" ที่ซ้ำซ้อนออก** เหลือแค่ข้อความ + ปุ่ม "เพิ่มสินค้าแรก" (เฉพาะกรณี `total === 0`) เพราะบรรทัดสรุปผลด้านบนมีลิงก์ล้างตัวกรองอยู่แล้วเสมอเมื่อ `isFiltering`

### ไม่แตะ

- `DateRangeFields`, `DatePickerField`, `lib/entry-rows.ts`, `lib/entry-queries.ts` — ปฏิทินเลือกเองและตัวกรองค้นหา/สถานะทำงานเหมือนเดิมทุกอย่าง
- `filterByPostedDateRange` เดิม — ไม่แก้ ใช้คู่กับตัวใหม่

## Backward compatibility

ลิงก์เก่าที่ไม่มี `by` param → `parseDateBasisParam` คืน `"posted"` → พฤติกรรมเหมือนก่อนมีงานนี้ทุกประการ ไม่มี breaking change

## Verification

ไม่มี test runner ในโปรเจกต์ — verify ด้วย:
1. สคริปต์ node ใน scratch (คอมไพล์ผ่าน `tsc` ชั่วคราว) เช็ค `filterByCreatedDateRange`:
   - entry ที่ `createdAt` อยู่ในช่วง → ผ่าน, นอกช่วง → ถูกกรองออก
   - entry ที่สร้างเวลา 06:00 น. เวลาไทย (ก่อน UTC เที่ยงคืนข้าม) ต้องอยู่วันที่ถูกต้องตาม local ไม่ใช่ UTC
   - `from`/`to` เป็น `null` ทั้งคู่ → คืนทุกแถว
   - `parseDateBasisParam`: `undefined`/ค่าประหลาด → `"posted"`, `"created"` → `"created"`
2. `npx tsc --noEmit` + `npm run lint`
3. รัน dev server แยก (`dev-test.db` + `.next-dev`) เปิด `/` แล้วเช็ค:
   - กดปุ่ม "วันนี้/7วัน/30วัน" ได้ผลลัพธ์ตรงช่วง ปุ่ม active ไฮไลต์ถูก
   - สลับ "ลงคลิป/สร้าง" แล้วผลลัพธ์เปลี่ยนตามฐานที่เลือก (ไม่ต้องล้าง from/to)
   - กรองแล้วเจอผลลัพธ์บ้าง → ลิงก์ "ล้างตัวกรองทั้งหมด" ยังโผล่อยู่ (แก้บั๊กเดิม)
   - กรองแล้วไม่เจอเลย → ยังมีทางล้างตัวกรองได้ (ผ่านบรรทัดสรุปผลด้านบน ไม่ใช่กล่อง empty-state เดิม)
   - ลิงก์เก่าที่ไม่มี `by` (เช่น `/?status=posted`) ยังทำงานเหมือนก่อนแก้
