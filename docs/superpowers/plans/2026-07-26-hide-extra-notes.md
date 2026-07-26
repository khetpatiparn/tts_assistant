# Hide Extra Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** พับช่อง "ข้อมูลเพิ่มเติมจากฉัน" (ว่างทั้ง 55/55 entries) เป็นปุ่ม toggle — default ปิด เปิดอัตโนมัติเมื่อ entry มี note จริง เหมือน pattern ที่ทำกับ risk module

**Architecture:** เปลี่ยน presentation ล้วนใน `components/brief-form.tsx` ไฟล์เดียว: state `notesOpen` + effect เปิดอัตโนมัติเมื่อ `form.extraNotes` มีเนื้อหา, ปุ่ม toggle ไอคอน `NotebookPen`, และ hidden input ถือค่าตอนพับ (ฟอร์ม submit ผ่าน native FormData — input ที่ unmount จะหายจาก submission) — คัดลอกโครง risk module ในไฟล์เดียวกันเป๊ะ

**Tech Stack:** React 19 · lucide-react v1.23.0 · Tailwind v4

## Global Constraints

- **ไอคอนใช้ `NotebookPen`** — เช็คแล้วเป็น canonical (`notebook-pen.mjs` export ตรง ไม่ใช่ alias) ต่างจาก risk module (`TriangleAlert`) เพื่อแยกความหมาย 2 ปุ่มที่อยู่ติดกัน
- **extraNotes เช็คแค่ `trim() !== ""`** — ไม่มีประวัติ placeholder "-" (ต่างจาก riskModule) จึงไม่ต้องกรอง "-"
- **ห้ามรัน `npm run build`/`npm run dev` เปล่าๆ** — ชนกับ production server ของผู้ใช้ที่ port 3000 (`start.bat`) ใช้ `npx tsc --noEmit` เช็ก type
- ทดสอบ UI ใช้ isolated dev server เท่านั้น: `cp dev.db dev-test.db` แล้ว `NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001` — cleanup `dev-test.db` หลังเสร็จ, **ห้ามแตะ/kill port 3000**
- **เช็ก `git diff tsconfig.json` ก่อน commit ทุกครั้ง** — ถ้าเปลี่ยนให้ `git checkout -- tsconfig.json` (repo pin `target: "ES2017"` ตั้งใจ)
- ห้าม emoji · design token เดิม (`marigold`) · label ภาษาไทยเดิม
- ไม่มี test runner — verify ด้วย `npx tsc --noEmit` + `npm run lint` + Playwright (ติดตั้งแล้วที่ `C:\Users\patip\AppData\Local\Temp\claude\pw-scratch-history-rail`)
- **ห้าม `git add -A`** — add เฉพาะ `components/brief-form.tsx`
- ไม่แตะ `FormState`, server actions, schema, `lib/prompt-template.ts`, `lib/golden-examples.ts`, การค้นหาใน `history-rail.tsx` ใดๆ
- Branch: `feature/hide-extra-notes` (สร้างแล้ว) · spec committed เป็น `b3ae308`

---

### Task 1: พับช่อง Extra Notes เป็นปุ่ม toggle

**Files:**
- Modify: `components/brief-form.tsx` (import บรรทัด 4 · state หลังบรรทัด 103 · แทนที่ Field block บรรทัด 337-345)

**Interfaces:**
- Consumes: `form.extraNotes` / `onFieldChange` (prop เดิม) · `useState`/`useEffect` (import อยู่แล้ว) · pattern จาก risk module ในไฟล์เดียวกัน (บรรทัด 97-103, 311-335)
- Produces: ไม่มี — task เดียวจบ

- [ ] **Step 1: เพิ่ม `NotebookPen` ใน import lucide**

ดูบรรทัด 4 ปัจจุบัน:

```tsx
import { ClipboardPaste, ScanText, TriangleAlert, X } from "lucide-react";
```

แทนที่ด้วย (เพิ่ม `NotebookPen` เรียงตามตัวอักษร):

```tsx
import { ClipboardPaste, NotebookPen, ScanText, TriangleAlert, X } from "lucide-react";
```

- [ ] **Step 2: เพิ่ม state + auto-open effect**

วางต่อจากบล็อก effect ของ risk module (หลังบรรทัด 103 — บรรทัดที่ปิด `}, [hasRealRisk]);`) ก่อนบล็อก `extractPreviews`:

```tsx
  // ช่อง "ข้อมูลเพิ่มเติมจากฉัน" พับเป็น default — สำรวจจริง (2026-07-26) พบว่าว่างทั้ง 55/55
  // entries (ผู้ใช้ปล่อยให้ AI คิดเอง) ไม่มีประวัติ placeholder "-" จึงเช็คแค่ค่าว่าง
  // effect เปิดอย่างเดียว ไม่เคยปิดให้อัตโนมัติ (ปัจจุบันยังไม่ trigger เพราะไม่มี entry ที่มี note
  // แต่ใส่ไว้เพื่อความสม่ำเสมอกับ risk module และเผื่ออนาคตที่ผู้ใช้เริ่มกรอก)
  const [notesOpen, setNotesOpen] = useState(false);
  const hasRealNotes = form.extraNotes.trim() !== "";
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (hasRealNotes) setNotesOpen(true);
  }, [hasRealNotes]);
```

- [ ] **Step 3: แทนที่ Field block ของ Extra Notes**

แทนที่บล็อกนี้ (บรรทัด 337-345 ปัจจุบัน):

```tsx
        <Field label="ข้อมูลเพิ่มเติมจากฉัน (ถ้ามี)">
          <Textarea
            name="extraNotes"
            rows={3}
            value={form.extraNotes}
            onChange={(e) => onFieldChange("extraNotes", e.target.value)}
            placeholder="เช่น อยากเน้นคนอยู่หอ / ไม่อยากโชว์การพับ"
          />
        </Field>
```

ด้วย (โครงเดียวกับ risk module ที่อยู่เหนือมัน — พับ + hidden input กันค่าหายตอน submit):

```tsx
        {/* พับไว้เพราะว่างทั้ง 55/55 entries — ตอนพับต้องมี hidden input ถือค่าแทน
            เพราะฟอร์ม submit ผ่าน native FormData ซึ่งอ่านเฉพาะ input ที่ render อยู่:
            ถ้าพิมพ์ note แล้วพับก่อนกดสร้าง ค่าจะหายจาก submission เงียบๆ */}
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => setNotesOpen((open) => !open)}
            aria-expanded={notesOpen}
            className="flex items-center gap-1.5 self-start font-mono text-xs tracking-widest text-marigold uppercase hover:text-marigold/80"
          >
            <NotebookPen className="size-3.5" />
            ข้อมูลเพิ่มเติมจากฉัน (ถ้ามี)
          </button>
          {notesOpen ? (
            <Textarea
              name="extraNotes"
              rows={3}
              value={form.extraNotes}
              onChange={(e) => onFieldChange("extraNotes", e.target.value)}
              placeholder="เช่น อยากเน้นคนอยู่หอ / ไม่อยากโชว์การพับ"
            />
          ) : (
            <input type="hidden" name="extraNotes" value={form.extraNotes} />
          )}
        </div>
```

(มี input ชื่อ `extraNotes` ตัวเดียวเสมอ — เปิด = Textarea, ปิด = hidden — ไม่มีเคสชื่อซ้ำ)

- [ ] **Step 4: type-check + lint**

Run: `npx tsc --noEmit`
Expected: ผ่าน ไม่มี error

Run: `npm run lint`
Expected: สะอาด ไม่มี warning ใหม่

- [ ] **Step 5: verify UI จริง**

```bash
cp dev.db dev-test.db
NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001
```

เปิด `localhost:3001` (Playwright จาก `C:\Users\patip\AppData\Local\Temp\claude\pw-scratch-history-rail` — มีติดตั้งแล้ว) ตรวจ 6 ข้อ:

1. เปิดแท็บ Brief (ยังไม่เลือกรายการ) → **ไม่เห็น** textarea ของ extra notes เห็นแค่ปุ่ม "ข้อมูลเพิ่มเติมจากฉัน (ถ้ามี)" (uppercase จาก CSS) อยู่**คู่กับ**ปุ่ม "Product Risk Module (ถ้ามี)"
2. กดปุ่ม notes → textarea กางออก พิมพ์ "เน้นคนอยู่หอ" ได้ · กดปุ่มอีกครั้ง → พับ → กดเปิดใหม่ → ข้อความยังอยู่ (state อยู่ที่ form)
3. **เคสสำคัญที่สุด (hidden input):** กรอกชื่อสินค้า+ข้อมูลสินค้า → เปิดแผง notes พิมพ์ "เน้นคนอยู่หอ" → **พับแผง** → กด "สร้าง Prompt" → เช็ค dev-test.db ว่า entry ใหม่มี `extraNotes = "เน้นคนอยู่หอ"` (พิสูจน์ hidden input — ถ้าหายคือบั๊กที่ spec เตือน)
4. สร้าง entry ใหม่โดยไม่แตะ notes เลย → บันทึกสำเร็จ เช็ค dev-test.db ว่า `extraNotes = ""`
5. ปุ่ม risk module + notes อยู่คู่กัน เปิด/ปิดแยกอิสระ (เปิด risk ไม่ทำให้ notes เปิดตาม และกลับกัน)
6. ช่องอื่น + แผงสกัด + รูปสินค้าจริง + ค้นหาใน sidebar ทำงานเหมือนเดิม · console ไม่มี error/hydration error

เช็ค dev-test.db ด้วยสคริปต์ node + `better-sqlite3` (readonly, เขียนเป็นไฟล์ `.js` จริงใน scratch, `require()` ด้วย absolute path เข้า `node_modules` ของ repo — ห้าม inline `node -e`)

หยุด dev server ตัวเอง แล้ว `rm dev-test.db`

- [ ] **Step 6: เช็ก tsconfig แล้ว commit**

Run: `git diff tsconfig.json`
Expected: ว่าง — ถ้าไม่ว่างให้ `git checkout -- tsconfig.json` ก่อน

```bash
git add components/brief-form.tsx
git commit -m "Collapse the always-empty extra-notes field behind a toggle"
```

---

## Self-Review

**Spec coverage:** §ปุ่ม toggle default ปิด → Step 2-3 ✓ · §เช็คแค่ `!== ""` (ไม่มี "-") → Step 2 ✓ · §hidden input กันค่าหาย → Step 3 + verify ข้อ 3 ✓ · §ไอคอน `NotebookPen` canonical ต่างจาก risk module → Step 1 + Global Constraints ✓ · §auto-open effect เปิดอย่างเดียว → Step 2 ✓ · §ไม่แตะ FormState/actions/schema/prompt-template/golden-examples/search → ไม่มี step ไหนแตะ ✓ · Non-goals (ไม่ลบช่อง/คอลัมน์, ไม่ซ่อนช่องอื่น, ไม่มี animation) → ไม่มีใน plan ✓ · Verification ทุกข้อใน spec → Step 5 ✓

**Placeholder scan:** ไม่มี TBD/TODO · ทุก step ที่แก้โค้ดมีโค้ดเต็ม · ไม่มี unit test เพราะโปรเจกต์ไม่มี test runner (ระบุใน Global Constraints)

**Type consistency:** ไม่มี type/ฟังก์ชันใหม่ข้าม task (task เดียว) · `notesOpen: boolean` เป็น state เดียวที่เพิ่ม · ใช้ `form.extraNotes`/`onFieldChange` ตาม signature เดิมของ prop · ชื่อ state/handler (`notesOpen`/`setNotesOpen`/`hasRealNotes`) ไม่ชนกับ risk module (`riskOpen`/`setRiskOpen`/`hasRealRisk`) ที่มีอยู่แล้ว

**จุดที่ต้องระวังตอน implement:** effect Step 2 ผูก deps กับ `hasRealNotes` (boolean คำนวณแล้ว) ไม่ใช่ `form.extraNotes` ตรงๆ — ตั้งใจ ไม่ให้ effect วิ่งทุกตัวอักษร · `eslint-disable-next-line react-hooks/set-state-in-effect` ต้องมี (lint rule เดียวกับ risk module, มี precedent `clip-thumbnail.tsx:20`) · `<Field>` component ยังใช้กับช่องอื่น (ชื่อสินค้า/ข้อมูลสินค้า) ห้ามลบ · บล็อกใหม่ต้องวางตำแหน่งเดิม (ใต้ปุ่ม risk module เหนือปุ่ม submit) ให้ 2 ปุ่มพับอยู่คู่กัน
