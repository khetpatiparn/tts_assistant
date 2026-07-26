# ซ่อนช่อง "ข้อมูลเพิ่มเติมจากฉัน" (พับ default) — Design

## Problem

ช่อง "ข้อมูลเพิ่มเติมจากฉัน (ถ้ามี)" (`extraNotes`) ออกแบบให้เป็นคำสั่งพิเศษถึง AI ต่อคลิป (placeholder: "เช่น อยากเน้นคนอยู่หอ / ไม่อยากโชว์การพับ") แต่จากการสำรวจ dev.db จริง **หลัง migration 2026-07-25 ช่องนี้ว่างทั้ง 55/55 entries** (ก่อนหน้ามี 52 อันแต่เป็นรายละเอียดสินค้าที่ใส่ผิดช่อง ย้ายไป productInfo แล้ว) — ผู้ใช้ยืนยันเองว่า workflow คือ "ปล่อยให้ AI คิดเอง ไม่ค่อยมีอะไรสั่งพิเศษ" ช่องนี้จึงเป็นภาระสายตาโดยแทบไม่เคยให้ค่า เข้าสถานะเดียวกับ Product Risk Module ที่เพิ่งพับไปเมื่อ 2026-07-25

**เลือกซ่อน (พับ) ไม่ใช่ลบ** — ผู้ใช้บอก "ไม่ค่อยมี" ไม่ใช่ "ไม่มีเลย" การพับเก็บ optionality ไว้ด้วยต้นทุนแทบศูนย์ (ปุ่มเล็กบรรทัดเดียว) และ reversible ต่างจากการลบคอลัมน์ที่ต้อง migration + แก้หลายไฟล์เพื่อผลตอบแทนน้อย

## ข้อเท็จจริงจากโค้ด/ข้อมูลจริง (load-bearing)

- **สถิติ:** `extraNotes` เนื้อหาจริง 0/55 (หลัง migration 2026-07-25) — ไม่มี placeholder "-" ในประวัติ (ต่างจาก riskModule ที่มี "-" 49 อัน) จึงเช็คแค่ `trim() !== ""` พอ
- **ช่องปัจจุบันอยู่ `components/brief-form.tsx:337-345`** เป็น `<Field label="ข้อมูลเพิ่มเติมจากฉัน (ถ้ามี)">` + `<Textarea name="extraNotes">` controlled ผูก `form.extraNotes` ผ่าน `onFieldChange` — อยู่ใต้บล็อก risk module ที่พับแล้วพอดี
- **มี pattern พับ + hidden input ที่พิสูจน์แล้วในไฟล์เดียวกัน** (risk module `brief-form.tsx:311-335`) — คัดลอกโครงเดียวกันได้เลย: toggle button (font-mono marigold + `aria-expanded`) + auto-open effect (deps เป็น boolean คำนวณแล้ว, เปิดอย่างเดียว) + hidden input ตอนพับ
- **จุดเสี่ยงเดียวกับ risk module: hidden input กันค่าหายตอนพับ** — ฟอร์ม submit ผ่าน native FormData ซึ่งอ่านเฉพาะ input ที่ render อยู่ ถ้าพิมพ์ note แล้วพับก่อนกด "สร้าง Prompt" ค่าจะหายเงียบ → ตอนพับต้อง render `<input type="hidden" name="extraNotes" value={form.extraNotes} />` (เปิด = Textarea, ปิด = hidden — input ชื่อ `extraNotes` ตัวเดียวเสมอ)
- **ช่องที่ต้องไม่แตะ (extraNotes ถูกใช้ต่อ ต้องยังทำงาน):**
  - `lib/prompt-template.ts:48` — ใส่ `extraNotes` ลงโจทย์ AI (หัวข้อ "ข้อมูลเพิ่มเติมจากฉัน ถ้ามี") ค่าว่างเป็นพฤติกรรมปัจจุบันของทุก entry อยู่แล้ว
  - `components/history-rail.tsx:27` — `extraNotes` เป็น 1 ใน 3 ฟิลด์ที่ค้นหาครอบคลุม (เพิ่งเพิ่ม) — ซ่อนช่องไม่กระทบ logic นี้
  - `lib/golden-examples.ts` / `lib/few-shot.ts` — golden examples hardcode `extraNotes` เป็น few-shot ให้ AI (ข้อมูลแยกจากฟอร์มผู้ใช้) ไม่แตะ
  - `app/actions.ts` — `createPrompt` อ่าน `formData.get("extraNotes")`, `duplicatePrompt` copy `source.extraNotes` จาก DB — ทั้งคู่ไม่พึ่งว่าช่องเปิดอยู่ไหม
- **ไอคอน `NotebookPen` เป็นชื่อ canonical ใน lucide v1.23.0** (เช็คแล้ว: `notebook-pen.mjs` export `NotebookPen` ตรง ไม่ใช่ re-export alias) — ใช้ไอคอนต่างจาก risk module (`TriangleAlert`) เพื่อแยกความหมาย 2 ปุ่มที่อยู่ติดกัน

## Design

### UI ใน `components/brief-form.tsx` (ไฟล์เดียวที่แตะ)

แทนที่ `<Field label="ข้อมูลเพิ่มเติมจากฉัน (ถ้ามี)">` block (บรรทัด 337-345) ด้วยบล็อกพับได้ โครงเดียวกับ risk module เป๊ะ:

- **state:** `const [notesOpen, setNotesOpen] = useState(false)` + `const hasRealNotes = form.extraNotes.trim() !== ""` + effect เปิดอย่างเดียว (deps `[hasRealNotes]`, ใส่ `// eslint-disable-next-line react-hooks/set-state-in-effect` เหมือน risk module เพราะ lint rule เดียวกัน)
- **ปุ่ม toggle:** ไอคอน `NotebookPen` + ข้อความ **"ข้อมูลเพิ่มเติมจากฉัน (ถ้ามี)"** สไตล์ font-mono marigold `aria-expanded` — วางตำแหน่งเดิม (ใต้ปุ่ม risk module)
- **default ปิด** — เห็นแค่ปุ่ม
- ตอนเปิด: `<Textarea name="extraNotes">` เดิมเป๊ะ (rows/value/onChange/placeholder เดิม) · ตอนปิด: `<input type="hidden" name="extraNotes" value={form.extraNotes} />`
- **auto-open เมื่อ entry มี note จริง** — ครอบคลุมกรณีอนาคตที่ผู้ใช้เริ่มกรอกแล้วกลับมาดู entry เดิม, และ duplicate entry ที่มี note (ปัจจุบัน 0 entry มีเนื้อหา effect จึงยังไม่ทำงานจริง แต่ใส่ไว้เพื่อความสม่ำเสมอ + เผื่ออนาคต)
- ไม่แตะ `FormState`, server actions, schema, prompt-template, search logic, golden examples

### ผลลัพธ์ภาพรวมฟอร์ม

Brief เหลือช่องที่ใช้จริงเด่นชัด (ชื่อสินค้า + ข้อมูลสินค้า + รูปสินค้าจริง + ปุ่มสกัด) ส่วน 2 ช่องที่นานๆ ใช้ (risk module + extra notes) พับเป็นปุ่มเล็กคู่กัน

## Non-goals (YAGNI)

- **ไม่ลบช่อง/คอลัมน์** — reversible ดีกว่า, ผู้ใช้บอก "ไม่ค่อยมี" ไม่ใช่ "ไม่มีเลย", สเปกผลิตภัณฑ์ (`requirements/req1.md`) นับ extraNotes เป็นส่วนของ input template, และ golden-examples/prompt-template ยังพึ่งฟิลด์นี้
- **ไม่แตะ golden examples** ที่ hardcode extraNotes (เป็น few-shot ยุคเก่า — คนละเรื่องกับ UI)
- **ไม่ซ่อนช่องอื่น** — ผลสำรวจ 2026-07-25 ยืนยันช่องอื่นมีเหตุผลใช้รองรับหมด
- **ไม่ทำ animation** — pattern เดิมไม่มี

## Constraints (จาก CLAUDE.md)

- ห้ามรัน `npm run build`/`npm run dev` ชน `start.bat` port 3000 — ใช้ `npx tsc --noEmit` + isolated dev server (`cp dev.db dev-test.db` + `NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001`) แล้ว cleanup
- เช็ก `git diff tsconfig.json` ก่อน commit ทุกครั้ง · ห้าม `git add -A`
- ห้าม emoji · design token เดิม (`marigold`) · ไอคอน lucide ชื่อ canonical (ห้าม alias เก่า — เช็ค `.mjs` จริง)
- ไม่มี test runner — verify ด้วย tsc + lint + Playwright ใน scratch dir นอก repo (มี Playwright ติดตั้งแล้วที่ `C:\Users\patip\AppData\Local\Temp\claude\pw-scratch-history-rail`)

## Verification

- `npx tsc --noEmit` + `npm run lint` สะอาด
- ทดสอบ UI จริง (dev-test.db, port 3001):
  - เข้าแท็บ Brief (รายการใหม่) → **ไม่เห็น** textarea ของ extra notes เห็นแค่ปุ่ม "ข้อมูลเพิ่มเติมจากฉัน (ถ้ามี)" (คู่กับปุ่ม risk module)
  - กดปุ่ม → textarea กางออก พิมพ์ได้ · กดอีกครั้ง → พับ (ค่าไม่หาย — state อยู่ที่ form)
  - **เคสสำคัญ (hidden input):** กรอกชื่อ+ข้อมูลสินค้า → เปิดแผง notes พิมพ์ "เน้นคนอยู่หอ" → **พับแผง** → กด "สร้าง Prompt" → เช็ค dev-test.db ว่า entry ใหม่มี `extraNotes = "เน้นคนอยู่หอ"` (ไม่หาย)
  - สร้าง entry ใหม่โดยไม่แตะ notes → บันทึกสำเร็จ `extraNotes = ""`
  - ปุ่ม risk module + notes อยู่คู่กัน ทำงานแยกอิสระ (เปิดอันหนึ่งไม่กระทบอีกอัน)
  - ค้นหาใน sidebar ยังทำงาน (ทดสอบเร็วๆ ว่าไม่พัง) · แผงสกัด + รูปสินค้าจริงเหมือนเดิม · console ไม่มี error
- เช็ก dev-test.db: entry ใหม่มี `extraNotes = ""`

## Git

แตก branch ใหม่จาก `master`: `feature/hide-extra-notes` (สร้างแล้ว)
