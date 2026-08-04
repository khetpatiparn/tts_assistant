# Rolling 7-Day Revenue Trend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** แก้ `revenueTrend()` ให้เทียบ "7 วันล่าสุดที่มีข้อมูล" กับ "7 วันก่อนหน้านั้น" (rolling, ไม่ใช่ปฏิทิน/ไม่ใช่หารครึ่งประวัติทั้งหมดแบบเดิม) แล้วโชว์ตัวเลขทั้งสองช่วงในแถบ "แนวโน้มรายได้" บนหน้า `/dashboard`

**Architecture:** เปลี่ยน pure function เดียวใน `lib/dashboard.ts` (ไม่แตะ schema/DB) แล้วอัปเดต client component `components/revenue-charts.tsx` ให้ใช้ field ใหม่แทนของเดิม

**Tech Stack:** TypeScript, Next.js (React client component), ไม่มี test runner — verify ด้วยสคริปต์ node ที่คอมไพล์ผ่าน `tsc` เอง

## Global Constraints

- ตัวเลขที่เทียบคือ `settledRevenue` (`finalRevenue ?? 0`) เท่านั้น ไม่ใช่ GMV
- ช่วงเวลาต้อง rolling 7 วันเทียบ 7 วัน จุดยึดคือ **วันที่ล่าสุดที่มีออเดอร์จริง** (`Math.max` ของ `orderDate`) ไม่ใช่ `new Date()` วันนี้ตามนาฬิกา
- `orderDate` เป็น timestamp จริงเวลาไทย (ไม่ใช่ UTC midnight) — ต้องใช้ local getter (`getFullYear`/`getMonth`/`getDate`) เหมือน `dayKey()` ที่มีอยู่แล้วในไฟล์เดียวกัน **ห้ามใช้ UTC getter**
- ห้ามรัน `npm run build`/`npm run dev` ชนพอร์ต 3000 ของผู้ใช้ — ใช้ `npx tsc --noEmit` + isolated dev server (`cp dev.db dev-test.db` + `NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001`) แล้ว cleanup
- เช็ก `git diff tsconfig.json` ก่อน commit ทุกครั้ง (dev server มัก auto-patch ไฟล์นี้) ถ้าเปลี่ยนให้ `git checkout -- tsconfig.json`
- ห้าม `git add -A` · UI ภาษาไทย · design token เดิม (ห้ามเพิ่มสี/ฟอนต์ใหม่)

---

## วิธีรันเทสต์ในโปรเจกต์นี้

โปรเจกต์**ไม่มี test runner** และ**ไม่มี `tsx`** วิธีทดสอบ pure function คือคอมไพล์ด้วย `tsc` ลง scratch dir แล้วรันด้วย `node` โดยต้องแก้ปัญหา path alias `@/` เองเพราะ `tsc` ไม่เขียน path ใน `require()` ให้

**สคริปต์ตั้งต้น** — สร้างไฟล์นี้ก่อนเทสต์ครั้งแรก (`<scratch>` = scratch dir ของ session ห้ามสร้างในโฟลเดอร์ repo):

สร้าง `<scratch>/run-tests.sh`:

```bash
#!/usr/bin/env bash
set -e
REPO="C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt"
OUT="$1"; shift
cd "$REPO"
npx tsc "$@" \
  --outDir "$OUT" --rootDir . \
  --module commonjs --target ES2017 --moduleResolution node \
  --skipLibCheck --esModuleInterop
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

เรียกใช้: `TEST_OUT=<out> node -r <scratch>/alias.js <scratch>/test-xxx.js`

---

### Task 1: `revenueTrend()` แบบ rolling 7 วัน

**Files:**
- Modify: `lib/dashboard.ts:94-120` (ฟังก์ชัน `revenueTrend` เดิมทั้งก้อน)
- Test: `<scratch>/test-revenue-trend.js`

**Interfaces:**
- Consumes: `AffiliateOrderRecord` type ที่มีอยู่แล้วในไฟล์เดียวกัน (มี `orderDate: Date`, `finalRevenue: number | null`)
- Produces:
  ```ts
  function revenueTrend(orders: AffiliateOrderRecord[]): {
    points: number[]; // 14 จุด รายวัน settledRevenue เรียงเก่า→ใหม่ (dense, เติม 0)
    currentWindowRevenue: number;
    previousWindowRevenue: number;
    changePct: number;
    direction: "up" | "down" | "flat";
  }
  ```
  Task 2 จะ import `revenueTrend` ตัวนี้และอ่าน field ทั้ง 5 ตัวตรงๆ

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

สร้าง `<scratch>/test-revenue-trend.js`:

```js
const assert = require("assert");
const { revenueTrend } = require("@/lib/dashboard");

function order(orderId, orderDateStr, finalRevenue) {
  return {
    orderId,
    productName: "p",
    contentId: "c",
    status: "ชำระแล้ว",
    gmv: 100,
    itemsSold: 1,
    itemsRefunded: 0,
    actualCommission: 10,
    finalRevenue,
    orderDate: new Date(orderDateStr),
    matchedEntryId: null,
    importedAt: new Date(orderDateStr),
  };
}

// เคส 1: orders ว่าง → คืนค่า 0 ทั้งหมด ไม่ throw
{
  const r = revenueTrend([]);
  assert.deepStrictEqual(r, {
    points: [],
    currentWindowRevenue: 0,
    previousWindowRevenue: 0,
    changePct: 0,
    direction: "flat",
  });
  console.log("PASS: orders ว่าง");
}

// เคส 2: ข้อมูล 14 วันเป๊ะ ยึดจากวันที่ล่าสุดที่มีออเดอร์จริง (ไม่ใช่ new Date())
// สมมติวันนี้ตามนาฬิกาต่างจากข้อมูลมาก (ปี 2020) — ถ้าฟังก์ชันดันไปใช้ new Date() เทสต์นี้จะพัง
{
  const orders = [
    // ช่วง B (เก่ากว่า): 7 วัน 2020-01-01 .. 2020-01-07 รวม finalRevenue = 700
    order("b1", "2020-01-01T10:00:00", 100),
    order("b2", "2020-01-02T10:00:00", 100),
    order("b3", "2020-01-03T10:00:00", 100),
    order("b4", "2020-01-04T10:00:00", 100),
    order("b5", "2020-01-05T10:00:00", 100),
    order("b6", "2020-01-06T10:00:00", 100),
    order("b7", "2020-01-07T10:00:00", 100),
    // ช่วง A (ล่าสุด): 7 วัน 2020-01-08 .. 2020-01-14 รวม finalRevenue = 1400
    order("a1", "2020-01-08T10:00:00", 200),
    order("a2", "2020-01-09T10:00:00", 200),
    order("a3", "2020-01-10T10:00:00", 200),
    order("a4", "2020-01-11T10:00:00", 200),
    order("a5", "2020-01-12T10:00:00", 200),
    order("a6", "2020-01-13T10:00:00", 200),
    order("a7", "2020-01-14T10:00:00", 200),
  ];
  const r = revenueTrend(orders);
  assert.strictEqual(r.previousWindowRevenue, 700, "previousWindowRevenue");
  assert.strictEqual(r.currentWindowRevenue, 1400, "currentWindowRevenue");
  assert.strictEqual(r.changePct, 100, "changePct = (1400-700)/700*100 = 100");
  assert.strictEqual(r.direction, "up");
  assert.strictEqual(r.points.length, 14, "points ต้องมี 14 จุด");
  assert.deepStrictEqual(r.points, [100,100,100,100,100,100,100,200,200,200,200,200,200,200]);
  console.log("PASS: 14 วันเป๊ะ ยึดจากวันที่ล่าสุดในข้อมูล");
}

// เคส 3: ข้อมูลห่างไม่สม่ำเสมอ (มีแค่ไม่กี่ออเดอร์ใน 14 วัน + มีออเดอร์เก่ากว่าช่วง B อยู่ด้วย
// ต้องไม่ถูกนับเข้าไปในสองช่วง)
{
  const orders = [
    order("old", "2019-12-01T10:00:00", 9999), // เก่ากว่าช่วง B มาก ต้องไม่ถูกนับ
    order("b1", "2020-01-03T10:00:00", 50),
    order("a1", "2020-01-14T10:00:00", 300),
  ];
  const r = revenueTrend(orders);
  assert.strictEqual(r.previousWindowRevenue, 50);
  assert.strictEqual(r.currentWindowRevenue, 300);
  console.log("PASS: ข้อมูลห่างไม่สม่ำเสมอ ไม่นับออเดอร์เก่าเกินช่วง");
}

// เคส 4: previousWindowRevenue = 0 → changePct = 100 ไม่ใช่ Infinity/NaN
{
  const orders = [order("a1", "2020-01-14T10:00:00", 500)];
  const r = revenueTrend(orders);
  assert.strictEqual(r.previousWindowRevenue, 0);
  assert.strictEqual(r.changePct, 100);
  assert.ok(Number.isFinite(r.changePct));
  console.log("PASS: previousWindowRevenue = 0");
}

console.log("ALL PASS");
```

- [ ] **Step 2: รันเทสต์เพื่อยืนยันว่าพัง**

```bash
bash <scratch>/run-tests.sh <scratch>/out lib/dashboard.ts
TEST_OUT=<scratch>/out node -r <scratch>/alias.js <scratch>/test-revenue-trend.js
```

Expected: FAIL (`currentWindowRevenue` เป็น `undefined` เพราะฟังก์ชันเดิมยังไม่มี field นี้)

- [ ] **Step 3: แก้ `revenueTrend()` ใน `lib/dashboard.ts`**

แทนที่ทั้งฟังก์ชันเดิม (บรรทัด 94-120) ด้วย:

```ts
const DAY_MS = 24 * 60 * 60 * 1000;

/** ตัดเวลาออก เหลือแค่วันตามปฏิทินท้องถิ่น — ใช้ตัดขอบหน้าต่าง 7 วัน */
function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * แนวโน้มรายได้ rolling 7 วัน: เทียบ "7 วันล่าสุดที่มีข้อมูลจริง" กับ "7 วันก่อนหน้านั้น"
 *
 * จุดยึดคือวันที่ล่าสุดที่มีออเดอร์จริงในระบบ ไม่ใช่ new Date() วันนี้ตามนาฬิกา — เหตุผลเดียวกับ
 * filterByRange ใน components/revenue-charts.tsx: ข้อมูลนำเข้ามือมักค้างหลายวัน ถ้านับจากวันนี้จริง
 * ช่วง 7 วันอาจว่างเปล่าทั้งที่มีข้อมูล และผู้ใช้อัปข้อมูลไม่ตรงรอบตายตัว (5-7 วัน) จึงใช้ rolling
 * ไม่ใช่ปฏิทินจันทร์-อาทิตย์ — ปฏิทินจะทำให้สัปดาห์ปัจจุบัน "ยังไม่จบ" เกือบทุกครั้งที่อัปข้อมูล
 */
export function revenueTrend(orders: AffiliateOrderRecord[]): {
  points: number[];
  currentWindowRevenue: number;
  previousWindowRevenue: number;
  changePct: number;
  direction: "up" | "down" | "flat";
} {
  if (orders.length === 0) {
    return { points: [], currentWindowRevenue: 0, previousWindowRevenue: 0, changePct: 0, direction: "flat" };
  }

  const latestOrderDate = new Date(Math.max(...orders.map((o) => o.orderDate.getTime())));
  const windowAEnd = startOfLocalDay(latestOrderDate).getTime() + DAY_MS; // exclusive
  const windowAStart = windowAEnd - 7 * DAY_MS;
  const windowBStart = windowAStart - 7 * DAY_MS;

  const daily = new Array<number>(14).fill(0);
  let currentWindowRevenue = 0;
  let previousWindowRevenue = 0;

  for (const o of orders) {
    const t = o.orderDate.getTime();
    if (t < windowBStart || t >= windowAEnd) continue;
    const dayIndex = Math.floor((t - windowBStart) / DAY_MS);
    const revenue = o.finalRevenue ?? 0;
    daily[dayIndex] += revenue;
    if (t >= windowAStart) currentWindowRevenue += revenue;
    else previousWindowRevenue += revenue;
  }

  let changePct: number;
  if (previousWindowRevenue === 0) {
    changePct = currentWindowRevenue > 0 ? 100 : 0;
  } else {
    changePct = ((currentWindowRevenue - previousWindowRevenue) / previousWindowRevenue) * 100;
  }
  const direction = changePct > 5 ? "up" : changePct < -5 ? "down" : "flat";

  return { points: daily, currentWindowRevenue, previousWindowRevenue, changePct, direction };
}
```

- [ ] **Step 4: รันเทสต์เพื่อยืนยันว่าผ่าน**

```bash
bash <scratch>/run-tests.sh <scratch>/out lib/dashboard.ts
TEST_OUT=<scratch>/out node -r <scratch>/alias.js <scratch>/test-revenue-trend.js
```

Expected: `ALL PASS`

- [ ] **Step 5: `tsc --noEmit` ทั้งโปรเจกต์**

```bash
npx tsc --noEmit
```

Expected: มี error ที่ `components/revenue-charts.tsx` เพราะยังใช้ field เก่า (`direction`/`changePct` มีอยู่ แต่ `points` เปลี่ยนความหมาย และโค้ดเดิมไม่เคยอ่าน `currentWindowRevenue`/`previousWindowRevenue`) — เป็นเรื่องปกติ Task 2 จะแก้ไฟล์นี้ต่อ ตรวจแค่ว่า **ไม่มี error ในไฟล์อื่นนอกจาก `revenue-charts.tsx`**

- [ ] **Step 6: Commit**

```bash
git add lib/dashboard.ts
git commit -m "Change revenueTrend to compare rolling 7-day windows

Anchors on the latest order date in the data (not the real clock),
since the user imports revenue files on an irregular 5-7 day cadence
rather than fixed calendar weeks."
```

---

### Task 2: อัปเดต `RevenueTrend` component ให้ใช้ field ใหม่

**Files:**
- Modify: `components/revenue-charts.tsx:157-190` (ฟังก์ชัน `RevenueTrend`)

**Interfaces:**
- Consumes: `revenueTrend()` จาก Task 1 — `{ points, currentWindowRevenue, previousWindowRevenue, changePct, direction }`
- Produces: ไม่มี (leaf component)

- [ ] **Step 1: แก้ `RevenueTrend` ใน `components/revenue-charts.tsx`**

แทนที่ฟังก์ชัน `RevenueTrend` เดิม (บรรทัด 157-190) ด้วย:

```tsx
function baht(n: number): string {
  return "฿" + n.toLocaleString("th-TH", { maximumFractionDigits: 0 });
}

export function RevenueTrend({ orders }: { orders: AffiliateOrderRecord[] }) {
  const [open, setOpen] = useState(false);
  if (orders.length === 0) return null;
  const { points, currentWindowRevenue, previousWindowRevenue, direction, changePct } =
    revenueTrend(orders);

  const Arrow = direction === "up" ? TrendingUp : direction === "down" ? TrendingDown : Minus;
  const arrowClass =
    direction === "up" ? "text-teal" : direction === "down" ? "text-danger" : "text-smoke";
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
          className="ml-auto font-mono text-xs text-teal hover:underline"
        >
          {open ? "ซ่อนกราฟ" : "ดูกราฟ"}
        </button>
      </div>
      <p className="font-mono text-[0.7rem] text-muted-foreground">
        7 วันล่าสุด {baht(currentWindowRevenue)} · 7 วันก่อนหน้า {baht(previousWindowRevenue)}
      </p>
      {open && <TimeChart orders={orders} />}
    </div>
  );
}
```

หมายเหตุ: `baht()` มีอยู่แล้วบนสุดของไฟล์นี้ (บรรทัด 21-23) — **อย่าประกาศซ้ำ** โค้ดข้างบนแสดงไว้เพื่อความชัดเจนเฉยๆ ให้ลบบรรทัด `function baht(n: number)...` ออกตอนแก้จริง เหลือแค่ตัว `RevenueTrend` เท่านั้น

- [ ] **Step 2: `tsc --noEmit` + lint ทั้งโปรเจกต์**

```bash
npx tsc --noEmit
npm run lint
```

Expected: ผ่านสะอาด ไม่มี error/warning ใหม่

- [ ] **Step 3: verify ด้วย isolated dev server**

```bash
cp dev.db dev-test.db
NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001
```

เปิด `http://localhost:3001/dashboard` แล้วตรวจ:
- แถบ "แนวโน้มรายได้" โชว์ sparkline + ลูกศร + % + บรรทัดใหม่ "7 วันล่าสุด ฿X · 7 วันก่อนหน้า ฿Y" (ตัวเลขไม่ใช่ 0 ทั้งคู่ ถ้า `dev-test.db` มีออเดอร์จริงอยู่)
- กด "ดูกราฟ" ยังเปิด `TimeChart` ได้ปกติเหมือนเดิม (ฟีเจอร์นี้ไม่ถูกแตะ)
- ไม่มี console error / hydration error

หยุด server แล้วเก็บกวาด:

```bash
git diff --stat tsconfig.json   # ถ้ามีการเปลี่ยน ให้ git checkout -- tsconfig.json
rm -f dev-test.db
rm -rf .next-dev
```

- [ ] **Step 4: Commit**

```bash
git add components/revenue-charts.tsx
git commit -m "Show rolling 7-day revenue numbers next to the trend arrow"
```

---

## Final Step: Merge

หลัง Task 2 ผ่านครบ ใช้ superpowers:finishing-a-development-branch เพื่อรีวิวรวมทั้ง branch แล้ว merge เข้า `master`
