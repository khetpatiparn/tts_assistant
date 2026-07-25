# Hide Risk Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** พับช่อง Product Risk Module (ใช้จริงแค่ 2/55 entries) เป็นปุ่ม toggle — default ปิด เปิดอัตโนมัติเมื่อ entry ที่เลือกมี risk จริง

**Architecture:** เปลี่ยน presentation ล้วนใน `components/brief-form.tsx` ไฟล์เดียว: state `riskOpen` + effect เปิดอัตโนมัติเมื่อ `form.riskModule` มีเนื้อหาจริง, ปุ่ม toggle สไตล์เดียวกับแผงสกัด, และ**hidden input ถือค่าตอนแผงปิด** (ฟอร์ม submit ผ่าน native FormData — input ที่ unmount จะหายจาก submission)

**Tech Stack:** React 19 · lucide-react v1.23.0 · Tailwind v4

## Global Constraints

- **ไอคอนใช้ `TriangleAlert` ห้ามใช้ `AlertTriangle`** — เช็คแล้ว `alert-triangle.mjs` เป็น alias เก่าที่ re-export จาก `triangle-alert.mjs`
- **ค่า `"-"` ถือว่าว่าง** — เป็น placeholder เก่าใน 49 entries ต้องไม่ทำให้แผงเปิดเอง
- **ห้ามรัน `npm run build`/`npm run dev` เปล่าๆ** — ชนกับ production server ของผู้ใช้ที่ port 3000 (`start.bat`) ใช้ `npx tsc --noEmit` เช็ก type
- ทดสอบ UI ใช้ isolated dev server เท่านั้น: `cp dev.db dev-test.db` แล้ว `NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001` — cleanup `dev-test.db` หลังเสร็จ, **ห้ามแตะ/kill port 3000**
- **เช็ก `git diff tsconfig.json` ก่อน commit ทุกครั้ง** — ถ้าเปลี่ยนให้ `git checkout -- tsconfig.json` (repo pin `target: "ES2017"` ตั้งใจ)
- ห้าม emoji · design token เดิม (`marigold`) · label "Product Risk Module" เป็นชื่ออังกฤษเดิมอยู่แล้ว คงเดิม
- ไม่มี test runner — verify ด้วย `npx tsc --noEmit` + `npm run lint` + Playwright ใน scratch dir นอก repo
- **ห้าม `git add -A`** — add เฉพาะ `components/brief-form.tsx`
- ไม่แตะ `FormState`, server actions, schema, `lib/prompt-template.ts` ใดๆ ทั้งสิ้น
- Branch: `feature/hide-risk-module` (สร้างแล้ว) · spec committed เป็น `86da258`

---

### Task 1: พับช่อง Risk Module เป็นปุ่ม toggle

**Files:**
- Modify: `components/brief-form.tsx` (import บรรทัด 4 · state หลังบรรทัด 91 · แทนที่ Field block บรรทัด 299-307)

**Interfaces:**
- Consumes: `form.riskModule` / `onFieldChange` (prop เดิม) · `useState`/`useEffect` (import อยู่แล้ว)
- Produces: ไม่มี — task เดียวจบ

- [ ] **Step 1: เพิ่ม `TriangleAlert` ใน import lucide**

แทนที่บรรทัด 4:

```tsx
import { ClipboardPaste, ScanText, X } from "lucide-react";
```

ด้วย:

```tsx
import { ClipboardPaste, ScanText, TriangleAlert, X } from "lucide-react";
```

- [ ] **Step 2: เพิ่ม state + auto-open effect**

วางต่อจากบรรทัด 91 (`const extractInputRef = useRef<HTMLInputElement>(null);`) ก่อนบล็อก `extractPreviews`:

```tsx
  // ช่อง Risk Module พับเป็น default — สำรวจจริง (2026-07-25) พบใช้เนื้อหาจริงแค่ 2/55 entries
  // ที่เหลือ 49 อันเป็น placeholder "-" ล้วนๆ จึงถือว่า "-" = ว่าง ไม่นับเป็นเนื้อหา
  // effect นี้เปิดอย่างเดียว (ตอนสลับไป entry ที่มี risk จริง) ไม่เคยปิดให้อัตโนมัติ —
  // ผู้ใช้พับเองได้เสมอโดยไม่โดนดึงกลับ
  const [riskOpen, setRiskOpen] = useState(false);
  const hasRealRisk =
    form.riskModule.trim() !== "" && form.riskModule.trim() !== "-";
  useEffect(() => {
    if (hasRealRisk) setRiskOpen(true);
  }, [hasRealRisk]);
```

- [ ] **Step 3: แทนที่ Field block ของ Risk Module**

แทนที่บล็อกนี้ (บรรทัด 299-307 เดิม):

```tsx
        <Field label="Product Risk Module">
          <Textarea
            name="riskModule"
            rows={3}
            value={form.riskModule}
            onChange={(e) => onFieldChange("riskModule", e.target.value)}
            placeholder="ความเสี่ยงที่ต้องระวัง เช่น พับได้ / กางได้ / มีกลไก"
          />
        </Field>
```

ด้วย:

```tsx
        {/* พับไว้เพราะใช้จริงแค่ 2/55 entries — ตอนพับต้องมี hidden input ถือค่าแทน
            เพราะฟอร์ม submit ผ่าน native FormData ซึ่งอ่านเฉพาะ input ที่ render อยู่:
            ถ้าพิมพ์ risk แล้วพับก่อนกดสร้าง ค่าจะหายจาก submission เงียบๆ */}
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => setRiskOpen((open) => !open)}
            aria-expanded={riskOpen}
            className="flex items-center gap-1.5 self-start font-mono text-xs tracking-widest text-marigold uppercase hover:text-marigold/80"
          >
            <TriangleAlert className="size-3.5" />
            Product Risk Module (ถ้ามี)
          </button>
          {riskOpen ? (
            <Textarea
              name="riskModule"
              rows={3}
              value={form.riskModule}
              onChange={(e) => onFieldChange("riskModule", e.target.value)}
              placeholder="ความเสี่ยงที่ต้องระวัง เช่น พับได้ / กางได้ / มีกลไก"
            />
          ) : (
            <input type="hidden" name="riskModule" value={form.riskModule} />
          )}
        </div>
```

(มี input ชื่อ `riskModule` ตัวเดียวเสมอ — เปิด = Textarea, ปิด = hidden — ไม่มีเคสชื่อซ้ำ)

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

เปิด `localhost:3001` (Playwright ใน scratch dir นอก repo) ตรวจ 7 ข้อ:

1. เปิดแท็บ Brief (ยังไม่เลือกรายการ) → **ไม่เห็น** textarea ของ Risk Module เห็นแค่ปุ่ม "PRODUCT RISK MODULE (ถ้ามี)" (uppercase จาก CSS)
2. กดปุ่ม → textarea กางออก พิมพ์ "ทดสอบ risk" ได้ · กดปุ่มอีกครั้ง → พับ → กดเปิดใหม่ → ข้อความ "ทดสอบ risk" ยังอยู่ (state อยู่ที่ form)
3. **เคสสำคัญที่สุด:** กรอกชื่อสินค้า+ข้อมูลสินค้า → เปิดแผง risk พิมพ์ "ทดสอบ risk ตอนพับ" → **พับแผง** → กด "สร้าง Prompt" → เช็ค dev-test.db ว่า entry ใหม่มี `riskModule = "ทดสอบ risk ตอนพับ"` (พิสูจน์ hidden input — ถ้าไม่มีคือบั๊กที่ spec เตือนไว้)
4. เลือก entry เก่าที่มี risk จริงใน sidebar (มี 2 อัน — ค้นหาคำว่า "รถเข็น" หรือ "ตู้เก็บของ" ช่วยหาได้) → แผง**เปิดเอง** เห็นเนื้อหาเต็ม
5. เลือก entry เก่าที่ riskModule เป็น "-" (รายการส่วนใหญ่) → แผง**ไม่เปิดเอง**
6. สร้าง entry ใหม่โดยไม่แตะ Risk Module เลย → บันทึกสำเร็จ เช็ค dev-test.db ว่า `riskModule = ""` (สตริงว่าง ไม่ใช่ "-")
7. แผงสกัด + รูปสินค้าจริง + ช่องอื่นๆ ทำงานเหมือนเดิม · console ไม่มี error/hydration error

เช็ค dev-test.db ด้วยสคริปต์ node + `better-sqlite3` (readonly, เขียนเป็นไฟล์ `.js` จริงใน scratch, `require()` ด้วย absolute path เข้า `node_modules` ของ repo — ห้าม inline `node -e`)

หยุด dev server ตัวเอง แล้ว `rm dev-test.db`

- [ ] **Step 6: เช็ก tsconfig แล้ว commit**

Run: `git diff tsconfig.json`
Expected: ว่าง — ถ้าไม่ว่างให้ `git checkout -- tsconfig.json` ก่อน

```bash
git add components/brief-form.tsx
git commit -m "Collapse the rarely-used risk module field behind a toggle"
```

---

## Self-Review

**Spec coverage:** §ปุ่ม toggle default ปิด → Step 2-3 ✓ · §เปิดอัตโนมัติเมื่อมี risk จริง ("-" = ว่าง / effect เปิดอย่างเดียว) → Step 2 ✓ · §hidden input กันค่าหายตอนพับ → Step 3 + verify ข้อ 3 ✓ · §ไอคอน `TriangleAlert` canonical → Step 1 + Global Constraints ✓ · §ไม่แตะ FormState/actions/schema/prompt-template → ไม่มี step ไหนแตะ ✓ · Non-goals (ไม่ลบช่อง/ไม่ migrate "-"/ไม่ซ่อนช่องอื่น/ไม่มี animation) → ไม่มีใน plan ✓ · Verification ทุกข้อใน spec → Step 5 ✓

**Placeholder scan:** ไม่มี TBD/TODO · ทุก step ที่แก้โค้ดมีโค้ดเต็ม · ไม่มี unit test เพราะโปรเจกต์ไม่มี test runner (ระบุใน Global Constraints)

**Type consistency:** ไม่มี type/ฟังก์ชันใหม่ข้าม task (task เดียว) · `riskOpen: boolean` เป็น state เดียวที่เพิ่ม · ใช้ `form.riskModule`/`onFieldChange` ตาม signature เดิมของ prop

**จุดที่ต้องระวังตอน implement:** effect ใน Step 2 ผูก deps กับ `hasRealRisk` (boolean ที่คำนวณแล้ว) ไม่ใช่ `form.riskModule` ตรงๆ — ตั้งใจ เพื่อไม่ให้ effect วิ่งทุกตัวอักษรที่พิมพ์ แต่วิ่งเฉพาะตอนสถานะ "มี/ไม่มีเนื้อหาจริง" พลิก · `<Field>` component เดิมไม่ถูกใช้กับช่องนี้แล้ว (ปุ่มทำหน้าที่ label แทน) แต่ `Field` ยังถูกใช้กับช่องอื่น ห้ามลบ
