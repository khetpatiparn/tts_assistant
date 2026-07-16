# Workspace QoL + Dashboard Polish — Design

วันที่: 2026-07-16 · สถานะ: อนุมัติแล้ว (brainstorming เสร็จ)

## เป้าหมาย

รวมงานปรับปรุงเล็ก 4 เรื่องจากการใช้งานจริง: ปุ่มคัดลอก 10-part prompt, วันที่ลงคลิป auto-fill,
สถานะนำเข้าไฟล์ affiliate แบบเห็นตลอด, และกราฟแนวโน้มรายได้แบบ interactive ด้วย Recharts

ทั้งหมดเป็นงานฝั่ง client เกือบล้วน — ไม่มี migration, ไม่แตะ Server Action ใดๆ
(ยกเว้น `page.tsx` ส่งค่าที่คำนวณอยู่แล้วลงมาเพิ่ม 1 ตัว)

## 1. ปุ่มคัดลอก 10-part prompt

**ไฟล์:** `components/production-panel.tsx`

- เพิ่มปุ่ม "คัดลอก" ที่หัวข้อ "10-part prompt ที่ ChatGPT ตอบกลับ" — layout เดียวกับหัวข้อ
  Caption & Hashtags ที่มีปุ่มอยู่แล้ว (label ซ้าย ปุ่มขวา ใน flex row)
- พฤติกรรมเหมือนปุ่ม `copyForPost` เดิมทุกอย่าง: `navigator.clipboard.writeText(chatgptOutput)`,
  ไอคอน `Copy` → `Check` + ข้อความ "คัดลอกแล้ว" ค้าง 1.5 วินาที, `disabled` เมื่อค่าว่าง
- ใช้ state `copied` แยกคนละตัวกับของ Caption (กดปุ่มหนึ่งไม่ทำให้อีกปุ่มเปลี่ยนสถานะ)
- คัดลอกเฉพาะ `chatgptOutput` ตรงๆ ไม่แต่งอะไรเพิ่ม

## 2. วันที่ลงคลิป auto-fill เมื่อวางลิงก์

**ไฟล์:** `components/production-panel.tsx`

- เงื่อนไข: เมื่อช่อง "ลิงก์คลิป TikTok" เปลี่ยนจากว่าง → มีค่า **และ** ช่องวันที่ลงคลิปยังว่าง
  ให้เติมวันที่ = วันที่สร้าง entry (`entry.createdAt` แปลงเป็นรูปแบบ date input ด้วย logic
  UTC เดียวกับ `toDateInputValue` เดิม)
- logic อยู่ใน `onChange` ของช่อง videoUrl ฝั่ง client ล้วน — ไม่แตะ DB, ไม่แตะ `updateProduction`
- ผู้ใช้แก้วันที่ทับเองได้ตามปกติ (ช่องยังแก้ไขอิสระ)
- ลบลิงก์ออกภายหลัง **ไม่** ลบวันที่คืน (กันงงว่าวันที่หายไปไหน)
- เหตุผลของเงื่อนไข "เมื่อวางลิงก์" (ผู้ใช้เลือกเอง): การวางลิงก์ TikTok = โพสต์คลิปแล้วจริง
  ส่วนการกดบันทึกก่อนหน้านั้น (เช่นเซฟ 10-part prompt) จะไม่ทำให้วันที่ติดไปโดยไม่ตั้งใจ —
  สถานะ "ยังไม่ได้ลงคลิป" ใน sidebar (เรียงบนสุด) ยังถูกต้องจนกว่าจะโพสต์จริง

## 3. สถานะนำเข้าไฟล์แบบเห็นตลอด (dashboard)

**ไฟล์:** `app/page.tsx`, `components/prompt-workspace.tsx`, `components/dashboard-panel.tsx`

ปัญหา: แถบเตือนปัจจุบันโผล่เฉพาะเมื่อข้อมูลค้างเกิน 7 วัน — ระหว่างนั้นผู้ใช้ไม่รู้ว่า
นำเข้าล่าสุดเมื่อไหร่ และต้องไป export รอบถัดไปวันไหน

- `page.tsx` ส่ง prop ใหม่ `lastImportedAt: Date | null` (คำนวณจาก max `importedAt`
  ของ `AffiliateOrder` — โค้ดคำนวณมีอยู่แล้วในส่วน reminder แค่เก็บ Date จริงไว้ด้วย
  แทนที่จะเก็บแค่จำนวนวัน) ผ่าน `PromptWorkspace` → `DashboardPanel`
- `dashboard-panel.tsx` แสดงบรรทัดสถานะถาวรใต้ฟอร์มอัปโหลด (font-mono ขนาดเล็ก
  โทน muted เหมือน hint เดิม):
  - ยังไม่ครบกำหนด: `นำเข้าล่าสุด 16 ก.ค. (วันนี้) · รอบถัดไป ~23 ก.ค.`
    - แสดง "(วันนี้)" / "(N วันก่อน)" ต่อท้ายวันที่นำเข้าล่าสุด
  - เลยกำหนด: เปลี่ยนเป็นโทนสีเตือน (`record`):
    `เกินกำหนดมา N วัน — ไป export ไฟล์ใหม่จาก TikTok Studio ได้แล้ว`
  - ยังไม่เคยนำเข้าเลย (`lastImportedAt === null`): ไม่แสดงบรรทัดนี้
    (มี empty state "ยังไม่มีข้อมูลรายได้" อยู่แล้ว)
- นิยาม "รอบถัดไป" = วันที่นำเข้าล่าสุด + 7 วัน — ตรงกับ `IMPORT_STALE_DAYS` เดิม
  ที่อิงรอบ settle ของ TikTok ให้ประกาศ constant ร่วมกันไม่ hardcode ซ้ำสองที่
- แถบเตือนเดิม (ReminderBanner, >7 วัน + dismiss ได้) คงพฤติกรรมเดิมทุกอย่าง —
  บรรทัดนี้เป็นข้อมูลเสริมที่เห็นตลอด ไม่มีปุ่มปิด

## 4. กราฟแนวโน้มรายได้แบบ interactive (Recharts)

**ไฟล์:** `components/revenue-charts.tsx`, `package.json` (dependency ใหม่), `CLAUDE.md`

### การตัดสินใจเรื่อง library

ผู้ใช้เลือกลง chart library แทนวาด SVG เองต่อ เหตุผล: hover tooltip / crosshair /
การขยายในอนาคต (zoom, หลายเส้น) ได้จาก library ฟรี ส่วนต้นทุน (bundle ใหญ่ขึ้น,
ต้อง restyle เข้า theme) ยอมรับได้สำหรับแอปใช้คนเดียว

**เลือก Recharts** เพราะ: เป็นตัวที่ ecosystem shadcn/ui ใช้เป็นทางการ, รองรับ React 19
(v2.15+), declarative แบบ React, ผูกสีกับ CSS variable ของ theme ได้ตรงๆ

### สิ่งที่เปลี่ยน

- `TimeChart` เขียนใหม่ด้วย Recharts `AreaChart`:
  - เส้น GMV รายวัน (ข้อมูลจาก `ordersByDay` เดิม — pure function ไม่แตะ)
  - Tooltip hover/tap แสดง: วันที่ · GMV · จำนวนออเดอร์ (ทั้งสาม field มีอยู่แล้วใน
    ผลลัพธ์ `ordersByDay`) พร้อม crosshair/cursor ของ library
  - สีตาม token เดิม: area fill `marigold` โปร่ง, เส้น `rust`, tooltip พื้น `card`
    ขอบ `border` ฟอนต์ mono — ผ่าน CSS variable รองรับ dark mode อัตโนมัติ
- **ปุ่มช่วงเวลา** `7 วัน · 30 วัน · ทั้งหมด` (default: ทั้งหมด) — เป็น UI state ของเราเอง
  filter ออเดอร์ตาม `orderDate` ก่อนส่งเข้า `ordersByDay` แกน Y ปรับ scale ตามช่วงที่เลือก
  - นิยามช่วง: นับถอยหลังจากวันที่ล่าสุดที่มีข้อมูล (ไม่ใช่วันนี้) กันกรณีข้อมูลนำเข้าค้าง
    แล้วกราฟว่างเปล่า
- **sparkline จิ๋ว** บรรทัดบนคงเป็น SVG วาดเองเหมือนเดิม (24px — ไม่คุ้มใช้ library)
- กราฟแท่งราย-คลิป (`revenue-by-clip.tsx`) ไม่แตะ — เป็น div bar ธรรมดา ทำงานดีอยู่

### ความเสี่ยงและ gate

Next.js 16.2.10 เป็น custom build — **ขั้นแรกของ implementation ต้องติดตั้ง Recharts
แล้ว build + เปิดเบราว์เซอร์ทดสอบกราฟตัวอย่างจริงก่อน** ถึงค่อยเขียนต่อ
ถ้า Recharts ใช้ไม่ได้กับ build นี้ ให้หยุดแล้วกลับมาปรึกษาผู้ใช้ (เลือก library อื่น
หรือถอยไปวาดเอง) — ห้ามฝืนแก้แบบ hack

### เอกสาร

CLAUDE.md ส่วน Dashboard: ลบ "วาดเองด้วย SVG ไม่มี chart library" → บันทึกใหม่ว่า
กราฟเส้นใช้ Recharts (ตัวเดียวที่ใช้ library), sparkline + bar ราย-คลิปยังวาดเอง

## Constraints ร่วม (ทุกข้อ)

- ไม่มี emoji ใน UI — ใช้ไอคอน lucide-react
- ข้อความ UI ภาษาไทย, design token เดิมเท่านั้น, ไม่ใส่ motif ธีมหนังเพิ่ม
- `dev.db` มีข้อมูลจริง ไม่มี backup — ห้าม `DELETE FROM` แบบไม่มี `WHERE`
- ห้าม build/dev ซ้อนกับ `start.bat` ของผู้ใช้ — เช็ค port 3000 ก่อนเสมอ
- ไม่มี test runner — verify ด้วย `npm run build` + `npm run lint` + Playwright (scratch dir)

## การทดสอบ (ทั้งฟีเจอร์)

1. ปุ่มคัดลอก: กดแล้ว clipboard ได้ 10-part prompt ครบ, สถานะ "คัดลอกแล้ว" ขึ้นแล้วหาย,
   ปุ่ม Caption เดิมไม่กระทบ
2. Auto-fill วันที่: วางลิงก์ในช่องว่าง → วันที่เติมเป็นวันสร้าง entry; แก้ทับได้;
   ลบลิงก์แล้ววันที่ไม่หาย; entry ที่มีวันที่อยู่แล้วไม่โดนทับ
3. สถานะนำเข้า: แสดงวันที่ล่าสุด + รอบถัดไปถูกต้อง; กรณีเลยกำหนดเปลี่ยนเป็นโทนเตือน;
   ยังไม่เคยนำเข้าไม่แสดง
4. กราฟ: Recharts render กับข้อมูลจริง 79 ออเดอร์, hover เห็น tooltip วันที่/GMV/ออเดอร์,
   ปุ่ม 7/30/ทั้งหมด filter ถูกต้อง, dark mode สีถูก, ไม่มี console error
5. ข้อมูลจริงใน dev.db ไม่หาย (entries ≥ 23, orders 79)
