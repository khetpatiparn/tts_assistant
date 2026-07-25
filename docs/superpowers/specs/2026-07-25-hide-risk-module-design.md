# ซ่อนช่อง Product Risk Module (พับ default) — Design

## Problem

จากการสำรวจ dev.db จริง (55 entries): ช่อง Product Risk Module ถูกกรอกเนื้อหาจริงแค่ **2/55 (4%)** — อีก 49 รายการผู้ใช้พิมพ์แค่ "-" ทิ้งไว้เพื่อผ่านไป (ทั้งที่ช่องไม่ได้ required) ช่องนี้จึงเป็นภาระสายตา+ภาระพิมพ์ "-" ทุกครั้งโดยแทบไม่เคยให้ประโยชน์ ผู้ใช้เสนอเองว่าควรซ่อนเป็น default แล้วค่อยกดเปิดเมื่อจะใช้

## ข้อเท็จจริงจากโค้ด/ข้อมูลจริง (load-bearing)

- **สถิติการใช้:** riskModule เนื้อหาจริง 2/55 (4%) · ค่า "-" 49/55 · ว่าง 4/55 — สำรวจเมื่อ 2026-07-25
- **ช่องอยู่ใน `<form>` ของ `components/brief-form.tsx`** (Field "Product Risk Module" ~บรรทัด 299-307 บน master ปัจจุบัน `cde4fd7`) — เป็น controlled input ผูกกับ `form.riskModule` ผ่าน `onFieldChange`
- **ช่องไม่ได้ `required`** — ซ่อนแล้วส่งฟอร์มได้ปกติ ค่าจะเป็น `""` (server `createPrompt` trim อยู่แล้ว ไม่มี validation ที่ต้องการค่านี้)
- **มี pattern ปุ่มพับใน codebase แล้ว 2 ที่**: แผงสกัดใน brief-form (ปุ่ม font-mono marigold + `aria-expanded`) และกลุ่ม import ใน dashboard — ใช้สไตล์เดียวกันเพื่อความสม่ำเสมอ
- **BriefForm ไม่ถูก key ตาม entry** — component เดิม persist ข้าม selection ดังนั้น state เปิด/ปิดต้อง sync กับการเปลี่ยน entry ผ่านการ observe `form.riskModule` (ไม่ใช่ mount ใหม่)
- **ไอคอน `TriangleAlert` คือชื่อ canonical ใน lucide v1.23.0** — `AlertTriangle` เป็น alias เก่า (`alert-triangle.mjs` re-export จาก `triangle-alert.mjs`) ห้ามใช้ชื่อเก่า
- **prompt-template ใส่ riskModule ลงโจทย์เสมอ** (หัวข้อ "Product Risk Module ที่ต้องใช้") — ค่าว่างจะกลายเป็น `""""""` ว่างในโจทย์ ซึ่งเป็นพฤติกรรมปัจจุบันของ 4 รายการที่ว่างอยู่แล้ว ไม่ใช่ regression

## Design

### UI ใน `components/brief-form.tsx` (ไฟล์เดียวที่แตะ)

แทนที่ `<Field label="Product Risk Module">` ที่โชว์ตลอด ด้วยบล็อกพับได้:

- **ปุ่ม toggle** สไตล์เดียวกับปุ่ม "สกัดจากแคปหน้าสินค้า" (font-mono text-xs marigold + `aria-expanded`): ไอคอน `TriangleAlert` + ข้อความ **"Product Risk Module (ถ้ามี)"** — อยู่ตำแหน่งเดิมในฟอร์ม (ระหว่างช่องข้อมูลสินค้า กับช่องข้อมูลเพิ่มเติมจากฉัน)
- **default ปิด** — เห็นแค่ปุ่มบรรทัดเดียว ไม่ต้องพิมพ์ "-" อีก
- ตอนเปิด: แสดง `<Field>` + `<Textarea>` เดิมเป๊ะ (name/value/onChange/placeholder เดิมทุกอย่าง)
- **เปิดอัตโนมัติเมื่อ entry ที่เลือกมี risk จริง**: state `riskOpen` ใน BriefForm + `useEffect` ที่ observe `form.riskModule` — เมื่อค่าเปลี่ยนเป็นเนื้อหาจริง (trim แล้วไม่ว่างและไม่ใช่ `"-"`) ให้ `setRiskOpen(true)` — ครอบคลุมทั้งการเลือก entry เก่า (2 อันที่มี risk จริง), การทำซ้ำ entry ที่มี risk, และกรณีอนาคตที่ค่าถูกเติมจากภายนอก
  - ค่า `"-"` ถือว่าว่าง → ไม่เปิด (49 รายการเก่าจะเห็นเป็นปุ่มปิดเฉยๆ — ถ้ากดเปิดจะเห็น "-" ตามจริง ไม่ mิigrate ข้อมูล)
  - effect นี้เปิดอย่างเดียว ไม่ปิดให้อัตโนมัติ — ผู้ใช้ปิดเองได้เสมอและการเลือก entry ใหม่ที่ไม่มี risk จะไม่ดึงแผงปิดลง (ไม่รบกวนถ้าผู้ใช้เพิ่งเปิดเอง) ยกเว้นกรณีเดียว: **กด "สินค้าใหม่" (`startNew`) ไม่ reset การเปิด/ปิด** — ยอมรับได้ เพราะสถานะเปิดค้างแค่ทำให้เห็นช่องว่าง ไม่มีข้อมูลผิด
- **กันค่าหายตอนแผงปิด (จุดพลาดที่มองข้ามง่ายที่สุด):** ฟอร์ม submit ผ่าน native FormData ซึ่งอ่านจาก input ที่ render อยู่จริงเท่านั้น — ถ้าผู้ใช้เปิดแผง พิมพ์ risk แล้ว**พับแผงก่อนกด "สร้าง Prompt"** Textarea ถูก unmount ค่าจะหายจาก submission เงียบๆ ทั้งที่ยังเห็นอยู่ใน state → **ตอนแผงปิด ต้อง render `<input type="hidden" name="riskModule" value={form.riskModule} />` แทน** (ปิด = hidden input · เปิด = Textarea ตัวเดิม — มี input ชื่อ `riskModule` ตัวเดียวเสมอ ไม่ซ้ำกัน)
- ไม่แตะ `FormState`, server actions, schema, prompt-template ใดๆ — เป็นการเปลี่ยน presentation ล้วน

### สิ่งที่ไม่ทำ (YAGNI)

- **ไม่ลบช่อง/คอลัมน์** — มี 2 entries ใช้จริง และสเปกผลิตภัณฑ์ (`requirements/req1.md`) ยังนับ Product Risk Module เป็นส่วนหนึ่งของ input template
- **ไม่ migrate ค่า "-" เก่า 49 รายการ** — ไม่มีผลกับอะไร (โจทย์ AI เคยเห็น "-" มาตลอดและ output ดี) แตะข้อมูลจริงโดยไม่จำเป็นขัดหลักความปลอดภัย
- **ไม่ซ่อนช่องอื่น** — ผลสำรวจชี้ว่าช่องอื่นทุกช่องมีเหตุผลการใช้รองรับ (postedTimeOfDay/isScheduledPost ต่ำโดยธรรมชาติของคลิปตั้งเวลา, caption/hashtags ต่ำเพราะฟีเจอร์มาทีหลัง)
- **ไม่ทำ animation พับ/กาง** — pattern เดิมในแอปก็ไม่มี

## Constraints (จาก CLAUDE.md)

- ห้ามรัน `npm run build`/`npm run dev` ชน `start.bat` port 3000 — ใช้ `npx tsc --noEmit` + isolated dev server (`cp dev.db dev-test.db` + `NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001`) แล้ว cleanup
- เช็ก `git diff tsconfig.json` ก่อน commit ทุกครั้ง · ห้าม `git add -A`
- ห้าม emoji · UI ภาษาไทย (label ช่องเดิมเป็นชื่ออังกฤษ "Product Risk Module" อยู่แล้ว คงเดิม) · design token เดิม (`marigold`) · ไอคอน lucide ชื่อ canonical
- ไม่มี test runner — verify ด้วย tsc + lint + Playwright

## Verification

- `npx tsc --noEmit` + `npm run lint` สะอาด
- ทดสอบ UI จริง (dev-test.db, port 3001):
  - เข้าแท็บ Brief (รายการใหม่) → **ไม่เห็น** textarea ของ Risk Module เห็นแค่ปุ่ม "Product Risk Module (ถ้ามี)"
  - กดปุ่ม → ช่องกางออก พิมพ์ได้ · กดอีกครั้ง → พับ (ค่าที่พิมพ์ไว้ไม่หาย — state อยู่ที่ `form` ไม่ใช่ตัวช่อง)
  - **เคสสำคัญ:** เปิดแผง → พิมพ์ risk → **พับแผง** → กด "สร้าง Prompt" → entry ที่ได้ต้องมี riskModule ตามที่พิมพ์ (พิสูจน์ว่า hidden input ทำงาน ไม่หายเงียบ)
  - เลือก entry เก่าที่มี risk จริง (มี 2 อัน เช่นตู้ roll-top) → แผง**เปิดเอง** เห็นเนื้อหาครบ
  - เลือก entry เก่าที่ riskModule = "-" → แผง**ไม่เปิดเอง**
  - สร้าง entry ใหม่โดยไม่แตะ Risk Module เลย → บันทึกสำเร็จ riskModule เป็นค่าว่าง (ไม่ใช่ "-")
  - ฟอร์มส่วนอื่น + แผงสกัด + รูปสินค้าจริง ทำงานเหมือนเดิม ไม่มี console error
- เช็ก dev-test.db: entry ที่สร้างใหม่มี `riskModule = ""`

## Git

แตก branch ใหม่จาก `master`: `feature/hide-risk-module` (สร้างแล้ว)
