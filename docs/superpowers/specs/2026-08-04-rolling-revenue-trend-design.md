# Spec: 7-วันล่าสุด vs 7 วันก่อนหน้า (rolling revenue trend)

## Context

หน้า `/dashboard` มีแถบ "แนวโน้มรายได้" (`components/revenue-charts.tsx` → `RevenueTrend`) อยู่แล้ว มี sparkline + ลูกศรขึ้น/ลง/ทรงตัว + % แต่ตัวเลขที่คำนวณตอนนี้ (`revenueTrend()` ใน `lib/dashboard.ts`) หารข้อมูลรายได้ **ทั้งหมดที่มีในระบบ** ออกเป็นครึ่งแรก/ครึ่งหลังตามจำนวนวัน ไม่ใช่การเทียบสัปดาห์จริง — ยิ่งสะสมประวัติมากเท่าไหร่ยิ่งเจือจางจนไม่มีความหมาย

ผู้ใช้อัปข้อมูลรายได้ไม่ตรงรอบตายตัว (บางครั้งเว้น 5 วัน บางครั้ง 6-7 วัน) และต้องการเห็นตัวเลข "รอบล่าสุดเทียบรอบก่อนหน้า" ทุกครั้งที่อัปข้อมูลใหม่ เพื่อดูว่าดีขึ้นหรือแย่ลง

## การตัดสินใจที่ยืนยันแล้วกับผู้ใช้

- **ตัวเลขที่เทียบ:** `settledRevenue` (ผลรวม `finalRevenue ?? 0`) — นิยามเดียวกับที่การ์ด "เงินที่ได้จริงแล้ว" ใช้ ไม่ใช่ GMV เพราะ GMV รวมออเดอร์ที่ยังไม่รู้ว่าจะได้จริงหรือไม่
- **ขอบเขตช่วงเวลา: rolling 7 วัน ไม่ใช่ปฏิทินจันทร์-อาทิตย์** — เพราะรอบอัปข้อมูลไม่ตรงกับขอบสัปดาห์ปฏิทิน การตัดตามปฏิทินจะทำให้สัปดาห์ปัจจุบัน "ยังไม่จบ" เกือบทุกครั้งที่อัปข้อมูล กลายเป็นตัวชี้วัดหลอกตาแบบเดียวกับปัญหาเดิมที่กำลังแก้
- **จุดยึดคือวันที่ล่าสุดที่มีข้อมูลจริงในระบบ ไม่ใช่วันนี้ตามนาฬิกา** — รูปแบบเดียวกับ `filterByRange` ใน `TimeChart` ที่มีอยู่แล้ว (เหตุผลเดิม: ข้อมูลนำเข้ามือมักค้างหลายวัน นับจากวันนี้จริงอาจได้ช่วงว่างเปล่า)
- ผลคือช่วง A และช่วง B ยาว **7 วันเท่ากันเป๊ะเสมอ** ไม่มีปัญหา "ช่วงปัจจุบันยังไม่ครบ" ให้ต้องจัดการเป็นพิเศษ

## Design

### `lib/dashboard.ts` — แก้ `revenueTrend()`

แทนที่การหารครึ่งข้อมูลทั้งหมดด้วยการคำนวณ 2 หน้าต่างเวลาติดกัน:

```ts
const DAY_MS = 24 * 60 * 60 * 1000;

/** ตัดเวลาออก เหลือแค่วันตามปฏิทินท้องถิ่น — ใช้ตัดขอบหน้าต่าง 7 วัน */
function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function revenueTrend(orders: AffiliateOrderRecord[]): {
  /** 14 จุด รายวัน settledRevenue เรียงเก่า→ใหม่ (7 วันของช่วง B ต่อด้วย 7 วันของช่วง A) ใช้วาด sparkline */
  points: number[];
  currentWindowRevenue: number;
  previousWindowRevenue: number;
  changePct: number;
  direction: "up" | "down" | "flat";
} {
  if (orders.length === 0) {
    return { points: [], currentWindowRevenue: 0, previousWindowRevenue: 0, changePct: 0, direction: "flat" };
  }

  // จุดยึดคือวันที่ล่าสุดที่มีออเดอร์จริง ไม่ใช่ new Date() — เหตุผลเดียวกับ filterByRange ด้านล่าง
  const latestOrderDate = new Date(Math.max(...orders.map((o) => o.orderDate.getTime())));
  const windowAEnd = startOfLocalDay(latestOrderDate).getTime() + DAY_MS; // exclusive
  const windowAStart = windowAEnd - 7 * DAY_MS;
  const windowBStart = windowAStart - 7 * DAY_MS;

  // รายวัน settledRevenue แบบ dense (เติม 0 ให้วันที่ไม่มีออเดอร์) เฉพาะ 14 วันในช่วง B+A
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

หมายเหตุ: ใช้ `startOfLocalDay`/local getters เพราะ `orderDate` เป็น timestamp จริงเวลาไทย (เหมือน `dayKey()` ที่มีอยู่แล้วในไฟล์เดียวกัน) — **ห้ามใช้ UTC getter ตรงนี้**

### `components/revenue-charts.tsx` — แก้ `RevenueTrend`

- เปลี่ยนการอ่านผลลัพธ์จาก `revenueTrend()` ให้ตรงกับ field ใหม่ (`currentWindowRevenue`, `previousWindowRevenue` แทนที่ `points` ตัวเดิมที่เป็น full-history)
- Arrow/pctLabel logic เดิม (`direction`/`changePct`) ใช้ต่อได้เลยไม่ต้องแก้
- เพิ่มบรรทัดเล็กใต้แถวเดิม โชว์ตัวเลขดิบทั้งสองช่วงตรงๆ (ไม่ใช่แค่ %) เพราะเป็นเหตุผลหลักที่ทำฟีเจอร์นี้ — ผู้ใช้อยากเห็นตัวเลขเปรียบเทียบจริง ไม่ใช่แค่สัญลักษณ์:
  ```
  7 วันล่าสุด ฿{currentWindowRevenue}  ·  7 วันก่อนหน้า ฿{previousWindowRevenue}
  ```
- Sparkline (`Sparkline` component) รับ `points` เดิม (14 จุด รายวัน settledRevenue) — ไม่ต้องแก้ตัว component เอง แค่ข้อมูลที่ป้อนเปลี่ยนความหมาย
- ปุ่ม "ดูกราฟ" ที่ขยายเป็น `TimeChart` (เลือกช่วง 7/30 วัน/ทั้งหมด ดู GMV รายวัน) **ไม่แตะ** — เป็นฟีเจอร์คนละจุดประสงค์ (ดูรายละเอียดยาวๆ) อยู่แล้ว

### ไม่แตะ

- `ordersByDay`, `TimeChart`, `filterByRange` — ฟีเจอร์ดูกราฟละเอียดใช้อยู่คนละทาง ไม่เกี่ยวกับตัวเลขสรุปด้านบน
- ไม่มี schema/DB เปลี่ยน เป็น pure function ล้วน

## Verification

ไม่มี test runner ในโปรเจกต์ — verify ด้วย:
1. สคริปต์ node ใน scratch (compile ผ่าน `tsc` ชั่วคราวหรือ mock ข้อมูลตรงๆ) เช็ค 4 เคส:
   - ข้อมูล 14 วันเป๊ะ แบ่งช่วง A/B ถูกต้อง, `changePct` คำนวณตรง
   - ข้อมูลห่างไม่สม่ำเสมอ (อัปทุก 5 วันบ้าง 6 วันบ้าง) ยังยึดจาก `latestOrderDate` ถูกต้อง ไม่ต้องพึ่ง "วันนี้"
   - orders ว่าง → คืนค่า 0 ทั้งหมดไม่ throw
   - `previousWindowRevenue = 0` → `changePct = 100` (ไม่ใช่ Infinity/NaN)
2. `npx tsc --noEmit` + `npm run lint`
3. รัน dev server แยก (`dev-test.db` + `.next-dev`) เปิด `/dashboard` ดูว่าตัวเลข/ลูกศร/sparkline ขึ้นถูกและไม่มี console error
