# Sidebar Menu + Wider Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ทำให้ชื่อสินค้าใน sidebar อ่านออก (ยุบไอคอน 2 อันเป็นเมนูเดียว) และค้นหาเจอจากข้อมูลสินค้าไม่ใช่แค่ชื่อ

**Architecture:** Task 1 ขยายเงื่อนไขค้นหาใน `useMemo` ของ `history-rail.tsx` ให้แมตช์ 3 ฟิลด์ · Task 2 รื้อโครงสร้างแถวจาก `<button>` ครอบทุกอย่าง เป็น `<li>` flex ที่ถือปุ่มเลือกกับ `Menu.Trigger` เป็นพี่น้องกัน (จำเป็นเพราะ Base UI `Menu.Trigger` เรนเดอร์เป็น `<button>` จริง ซ้อนใน `<button>` ไม่ได้) แล้วย้าย action ทั้งสองเข้า dropdown

**Tech Stack:** Next.js 16 (custom build) · React 19 · `@base-ui/react` Menu primitives (มีอยู่แล้ว ไม่ต้องลงเพิ่ม) · lucide-react v1.23.0 · Tailwind v4

## Global Constraints

- **shadcn/ui ในโปรเจกต์นี้สร้างบน `@base-ui/react` ไม่ใช่ Radix** — ห้ามเดา prop shape ถ้าต้องเช็กเพิ่มให้อ่าน `.d.ts` จริงใน `node_modules/@base-ui/react/menu/`
- **ไอคอน 3 จุดต้องใช้ `EllipsisVertical` ห้ามใช้ `MoreVertical`** — `MoreVertical` เป็นแค่ alias เก่า (`more-vertical.mjs` มีบรรทัดเดียว `export { default } from './ellipsis-vertical.mjs'`)
- ห้าม emoji · ข้อความ UI ภาษาไทย · ใช้ design token เดิมเท่านั้น (`ink`/`ink-2`/`paper`/`marigold`/`record`) ห้ามเพิ่มสีใหม่
- **ห้ามรัน `npm run build`/`npm run dev` เปล่าๆ** — ชนกับ production server ของผู้ใช้ที่ port 3000 (`start.bat`) ใช้ `npx tsc --noEmit` เช็ก type
- ทดสอบ UI ใช้ isolated dev server เท่านั้น: `cp dev.db dev-test.db` แล้ว `NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001` — cleanup `dev-test.db` หลังเสร็จ, **ห้ามแตะ/kill port 3000**
- **เช็ก `git diff tsconfig.json` ก่อน commit ทุกครั้ง** — ถ้าเปลี่ยนให้ `git checkout -- tsconfig.json` (repo pin `target: "ES2017"` ตั้งใจ)
- ไม่มี test runner — verify ด้วย `npx tsc --noEmit` + `npm run lint` + Playwright
- **ห้าม `git add -A`** — add เฉพาะไฟล์ที่ตั้งใจแก้
- Branch: `feature/sidebar-menu-search` (สร้างแล้ว) · spec committed เป็น `5fde604`

---

### Task 1: ค้นหาให้ครอบคลุม productName + productInfo + extraNotes

**Files:**
- Modify: `components/history-rail.tsx` (เพิ่ม helper ใกล้บรรทัด 16 · แก้เงื่อนไขบรรทัด 67)

**Interfaces:**
- Consumes: `PromptEntry` type ที่ import อยู่แล้ว (มี `productInfo`, `extraNotes` ครบ — ดู `components/prompt-workspace.tsx:35-53`)
- Produces: ไม่มีอะไรที่ Task 2 ต้องใช้ (2 tasks แยกอิสระกัน)

- [ ] **Step 1: เพิ่ม helper `matchesQuery`**

ใน `components/history-rail.tsx` วางต่อจากฟังก์ชัน `isIncomplete` (ปิดที่บรรทัด 16) ก่อนคอมเมนต์ของ `monthLabel`:

```tsx
/**
 * ฟิลด์ที่คำค้นจะถูกนำไปแมตช์ — riskModule ถูกตัดออกตั้งใจ เพราะเนื้อหาเป็นวลีซ้ำทั่วไป
 * ("พับได้" / "มีกลไก") ที่ใช้ร่วมกันหลายสิบรายการ ถ้ารวมเข้ามาผลค้นหาจะกว้างขึ้นแทนที่จะแคบลง
 */
function matchesQuery(entry: PromptEntry, needle: string) {
  return (
    entry.productName.toLowerCase().includes(needle) ||
    entry.productInfo.toLowerCase().includes(needle) ||
    entry.extraNotes.toLowerCase().includes(needle)
  );
}
```

- [ ] **Step 2: ใช้ helper ในตัวกรอง**

แทนที่บรรทัด 67 (ในบล็อก `const visible = numbered.filter(...)`) จากเดิม:

```tsx
      if (needle && !entry.productName.toLowerCase().includes(needle)) return false;
```

เป็น:

```tsx
      if (needle && !matchesQuery(entry, needle)) return false;
```

(บรรทัดอื่นในบล็อก `filter` คงเดิมทั้งหมด)

- [ ] **Step 3: type-check + lint**

Run: `npx tsc --noEmit`
Expected: ผ่าน ไม่มี error

Run: `npm run lint`
Expected: สะอาด ไม่มี warning ใหม่

- [ ] **Step 4: verify การค้นหาใน UI จริง**

```bash
cp dev.db dev-test.db
NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001
```

เปิด `localhost:3001` (Playwright ใน scratch dir นอก repo):

1. เลือกรายการสินค้าสักอันในแท็บ Brief แล้วอ่านช่อง **"ข้อมูลสินค้าจากเว็บ/ร้านค้า"** จดคำที่**มีอยู่ในช่องนั้นแต่ไม่มีในชื่อสินค้า** ไว้ 1 คำ
2. พิมพ์คำนั้นลงช่องค้นหาใน sidebar → **ต้องเจอรายการนั้น** (เคสที่พังอยู่ตอนนี้)
3. พิมพ์คำที่อยู่ใน **Product Risk Module** อย่างเดียว (เช่น "พับได้") ของรายการที่ชื่อ/ข้อมูลสินค้าไม่มีคำนั้น → **ต้องไม่เจอ** (ยืนยันว่าตัด riskModule ออกจริง)
4. ตัวนับด้านบน list แสดง `แสดง N/M` สอดคล้องกับจำนวนที่เห็นจริง

หยุด dev server ตัวเอง แล้ว `rm dev-test.db`

- [ ] **Step 5: เช็ก tsconfig แล้ว commit**

Run: `git diff tsconfig.json`
Expected: ว่าง — ถ้าไม่ว่างให้ `git checkout -- tsconfig.json` ก่อน

```bash
git add components/history-rail.tsx
git commit -m "Search product info and notes, not just the name"
```

---

### Task 2: รื้อโครงสร้างแถว + ยุบ action เป็นเมนูเดียว

**Files:**
- Modify: `components/history-rail.tsx` (imports บรรทัด 3-4 · props type บรรทัด 41-49 · row JSX บรรทัด 139-174)
- Modify: `components/prompt-workspace.tsx` (`handleDelete` บรรทัด 193-199 · `handleDuplicate` บรรทัด 201-214)

**Interfaces:**
- Consumes: `Menu` จาก `@base-ui/react/menu` (parts: `Root`/`Trigger`/`Portal`/`Positioner`/`Popup`/`Item` — ยืนยันแล้วว่ามีครบ)
- Produces: prop signature ใหม่ **`onDuplicate: (id: string) => void`** และ **`onDelete: (id: string) => void`** (ตัด `event` ออกทั้งคู่)

**API ที่ยืนยันจาก `.d.ts` จริงแล้ว (ไม่ต้องเช็กซ้ำ):**
- `Menu.Trigger` เรนเดอร์เป็น `<button>` (`BaseUIComponentProps<'button'>`) — เหตุผลที่ต้องรื้อโครงสร้าง ห้ามเอาไปซ้อนใน `<button>` เดิม
- `Menu.Item` รับ `onClick` และ `className` (`BaseUIComponentProps<'div'>`) ปิดเมนูเองหลังคลิก
- `Menu.Positioner` รับ `side` / `align` / `sideOffset` / `className`
- `Menu.Popup` รับ `className` (`BaseUIComponentProps<'div'>`)
- data attributes ที่ใช้ style ได้: **`data-highlighted`** (item ที่ถูกโฟกัส/ชี้อยู่) และ **`data-popup-open`** (trigger ตอนเมนูเปิด)
- import แบบเดียวกับที่โปรเจกต์ใช้อยู่ (`components/ui/button.tsx:1`): `import { Menu } from "@base-ui/react/menu";`

- [ ] **Step 1: แก้ imports ใน `components/history-rail.tsx`**

แทนที่บรรทัด 3-4 เดิม:

```tsx
import { useMemo, useState } from "react";
import { Copy, Plus, Search, Trash2 } from "lucide-react";
```

ด้วย:

```tsx
import { useMemo, useState } from "react";
import { Copy, EllipsisVertical, Plus, Search, Trash2 } from "lucide-react";
import { Menu } from "@base-ui/react/menu";
```

- [ ] **Step 2: แก้ prop type ให้ตัด `event` ออก**

ในบล็อก props ของ `HistoryRail` แทนที่ 2 บรรทัดนี้ (บรรทัด 48-49):

```tsx
  onDuplicate: (id: string, event: React.MouseEvent) => void;
  onDelete: (id: string, event: React.MouseEvent) => void;
```

ด้วย:

```tsx
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
```

(บรรทัดอื่นในบล็อก props และ destructure params คงเดิมทั้งหมด)

- [ ] **Step 3: แทนที่ row JSX ทั้งบล็อก**

แทนที่ตั้งแต่ `<li key={entry.id}>` จนถึง `</li>` (บรรทัด 139-174) ด้วยโค้ดนี้ทั้งหมด:

```tsx
                  <li
                    key={entry.id}
                    className={cn(
                      "group flex items-center rounded-md border-l-2 border-transparent text-sm text-paper/80 transition-colors hover:bg-ink-2 hover:text-paper",
                      isActive && "border-marigold bg-ink-2 text-paper"
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(entry)}
                      className="flex min-w-0 flex-1 items-center gap-2 py-2 pl-2.5 text-left"
                    >
                      <span className="shrink-0 font-mono text-[0.65rem] text-marigold/80">
                        T{String(takeNumber).padStart(2, "0")}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{entry.productName}</span>
                      {date && (
                        <span className="shrink-0 font-mono text-[0.6rem] text-paper/30">
                          {date}
                        </span>
                      )}
                    </button>

                    <Menu.Root>
                      <Menu.Trigger
                        aria-label="เมนูรายการ"
                        className="shrink-0 rounded-md px-1.5 py-2 text-paper/30 opacity-0 transition-opacity hover:text-paper focus-visible:opacity-100 group-hover:opacity-100 data-[popup-open]:opacity-100"
                      >
                        <EllipsisVertical className="size-3.5" />
                      </Menu.Trigger>
                      <Menu.Portal>
                        <Menu.Positioner
                          side="bottom"
                          align="end"
                          sideOffset={4}
                          className="z-50"
                        >
                          <Menu.Popup className="min-w-32 rounded-md border border-paper/15 bg-ink-2 py-1 text-sm text-paper shadow-lg">
                            <Menu.Item
                              onClick={() => onDuplicate(entry.id)}
                              className="flex cursor-pointer items-center gap-2 px-3 py-1.5 outline-none data-[highlighted]:bg-ink"
                            >
                              <Copy className="size-3.5" />
                              ทำซ้ำ
                            </Menu.Item>
                            <Menu.Item
                              onClick={() => onDelete(entry.id)}
                              className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-record outline-none data-[highlighted]:bg-ink"
                            >
                              <Trash2 className="size-3.5" />
                              ลบ
                            </Menu.Item>
                          </Menu.Popup>
                        </Menu.Positioner>
                      </Menu.Portal>
                    </Menu.Root>
                  </li>
```

**สิ่งที่เปลี่ยนเทียบของเดิม:** สไตล์ `group`/hover/active ย้ายจาก `<button>` ไปที่ `<li>` · ปุ่มเลือกเหลือแค่ take number + ชื่อ + วันที่ และเป็น `flex-1 min-w-0` · `<span role="button">` 2 อันหายไป แทนด้วย `Menu.Root` ที่เป็น sibling ของปุ่มเลือก · `px-2.5` เดิมถูกแยกเป็น `pl-2.5` ที่ปุ่มเลือกกับ `px-1.5` ที่ trigger เพื่อให้ระยะขอบรวมใกล้เคียงเดิม

- [ ] **Step 4: แก้ handler ใน `components/prompt-workspace.tsx` ให้ตรง signature ใหม่**

แทนที่ `handleDelete` (บรรทัด 193-199) จากเดิม:

```tsx
  function handleDelete(id: string, event: React.MouseEvent) {
    event.stopPropagation();
    if (!confirm("ลบรายการนี้?")) return;
    startDeleteTransition(async () => {
      await deletePrompt(id);
      if (selectedId === id) startNew();
    });
  }
```

ด้วย:

```tsx
  function handleDelete(id: string) {
    if (!confirm("ลบรายการนี้?")) return;
    startDeleteTransition(async () => {
      await deletePrompt(id);
      if (selectedId === id) startNew();
    });
  }
```

และแทนที่ `handleDuplicate` (บรรทัด 201-214) จากเดิม:

```tsx
  function handleDuplicate(id: string, event: React.MouseEvent) {
    event.stopPropagation();
    const source = prompts.find((p) => p.id === id);
    if (!source) return;
    startDuplicateTransition(async () => {
      const newId = await duplicatePrompt(id);
      setSelectedId(newId);
      setForm(entryToForm(source)); // ข้อความคลิปซ้ำ = source เป๊ะ — ตั้งตรงไม่พึ่ง auto-sync
      setPendingImages([]);
      setImageError(null);
      setGenError(null);
      setTab("brief");
    });
  }
```

ด้วย:

```tsx
  function handleDuplicate(id: string) {
    const source = prompts.find((p) => p.id === id);
    if (!source) return;
    startDuplicateTransition(async () => {
      const newId = await duplicatePrompt(id);
      setSelectedId(newId);
      setForm(entryToForm(source)); // ข้อความคลิปซ้ำ = source เป๊ะ — ตั้งตรงไม่พึ่ง auto-sync
      setPendingImages([]);
      setImageError(null);
      setGenError(null);
      setTab("brief");
    });
  }
```

**เหตุผลที่ตัด `event.stopPropagation()` ออกได้:** `Menu.Item` เรนเดอร์อยู่ใน `Menu.Portal` (คนละ DOM subtree กับแถว) คลิกจึงไม่ bubble ไปโดนปุ่มเลือกอยู่แล้ว และปุ่มเลือกกับ trigger ตอนนี้เป็นพี่น้องกัน ไม่ซ้อนกัน

(บรรทัดที่ส่ง prop `onDuplicate={handleDuplicate}` / `onDelete={handleDelete}` ให้ `<HistoryRail>` คงเดิม ไม่ต้องแก้)

- [ ] **Step 5: type-check + lint**

Run: `npx tsc --noEmit`
Expected: ผ่าน ไม่มี error

Run: `npm run lint`
Expected: สะอาด ไม่มี warning ใหม่

- [ ] **Step 6: verify UI จริง**

```bash
cp dev.db dev-test.db
NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001
```

เปิด `localhost:3001` (Playwright ใน scratch dir นอก repo) ตรวจ 7 ข้อ:

1. **ชื่อสินค้ายาวขึ้นเห็นได้ชัด** — เทียบ screenshot กับก่อนแก้ ชื่อที่เคยถูกตัดสั้นตอนนี้แสดงตัวอักษรได้มากกว่าเดิม (เพราะไอคอน 2 อันไม่กินพื้นที่แล้ว)
2. hover ที่แถว → เห็นไอคอน 3 จุดอันเดียว (ไม่ใช่ 2 ไอคอน)
3. กดไอคอน 3 จุด → เมนูเปิด เห็น "ทำซ้ำ" กับ "ลบ" (ลบเป็นสีแดง/record)
4. **popup ไม่โดน sidebar ตัดขอบ** — ทดสอบกับรายการที่อยู่**ล่างสุดของ list ที่ต้องเลื่อน scroll ลงไป** เมนูต้องแสดงเต็มใบ ไม่ถูก clip
5. กด "ทำซ้ำ" → สร้าง entry ใหม่ + เด้งไปแท็บ Brief พร้อมรูปครบ (พฤติกรรมเดิมไม่เสีย)
6. กด "ลบ" → ขึ้น confirm ก่อนลบ (พฤติกรรมเดิมไม่เสีย) — กด cancel แล้วรายการต้องยังอยู่
7. **กดที่ตัวแถว (ไม่ใช่ไอคอน) → เลือกรายการได้ปกติ** และกดไอคอน 3 จุดแล้ว**ไม่**ไปเลือกรายการนั้นด้วย

ตรวจ console: ไม่มี error / hydration error

หยุด dev server ตัวเอง แล้ว `rm dev-test.db`

- [ ] **Step 7: เช็ก tsconfig แล้ว commit**

Run: `git diff tsconfig.json`
Expected: ว่าง — ถ้าไม่ว่างให้ `git checkout -- tsconfig.json` ก่อน

```bash
git add components/history-rail.tsx components/prompt-workspace.tsx
git commit -m "Collapse row actions into a menu so the product name has room"
```

---

## Self-Review

**Spec coverage:**
- §1 จัดโครงสร้างแถวใหม่ (ปุ่มเลือกกับ trigger เป็นพี่น้อง, ย้าย group/active ไป `<li>`) → Task 2 Step 3 ✓
- §2 รวม action เป็นเมนูเดียว (`EllipsisVertical`, hover-reveal, Portal, style ด้วย token เดิม, ไม่สร้างไฟล์ ui ใหม่) → Task 2 Step 1+3 ✓
- §3 ลด handler signature เป็น `(id: string) => void` + ลบ `stopPropagation` → Task 2 Step 2+4 ✓
- §4 ค้นหา 3 ฟิลด์ ตัด riskModule → Task 1 Step 1-2 ✓
- Non-goals (ไม่สร้าง `components/ui/menu.tsx`, ไม่ทำ fuzzy search, ไม่เพิ่ม action ใหม่, ไม่แตะ logic จัดกลุ่ม/take number, ไม่ทำ virtualization) → ไม่มี task ไหนทำ ✓
- Verification ทุกข้อใน spec → Task 1 Step 4 + Task 2 Step 6 ✓

**Placeholder scan:** ไม่มี TBD/TODO · ทุก step ที่แก้โค้ดมีโค้ดเต็มวางได้เลย · verification เป็นคำสั่งจริงพร้อมผลที่คาดหวังเจาะจง · ไม่มี unit test เพราะโปรเจกต์ไม่มี test runner (ระบุใน Global Constraints)

**Type consistency:** `onDuplicate: (id: string) => void` / `onDelete: (id: string) => void` ตรงกัน 3 จุด — prop type (Task 2 Step 2), จุดเรียกใน `Menu.Item` (Step 3), และนิยาม handler (Step 4) · `matchesQuery(entry: PromptEntry, needle: string)` ใช้ `PromptEntry` ที่ import อยู่แล้วในไฟล์ · ไม่มี type ใหม่ถูกสร้างขึ้น

**ลำดับ task:** Task 1 กับ Task 2 แก้คนละส่วนของ `history-rail.tsx` (Task 1 = helper + `useMemo` บรรทัด ~67 · Task 2 = imports + props + row JSX) แทบไม่ทับกัน ทำ Task 1 ก่อนเพราะเล็กและได้ค่าทันที

**จุดที่ต้องระวังตอน implement:** Task 2 Step 3 ต้องแทนที่ `<li>` ทั้งบล็อกรวมปิด `</li>` ให้ครบ ถ้าเหลือ `<button>` ครอบเดิมค้างไว้จะกลายเป็น `<button>` ซ้อน `<button>` ซึ่งเป็นสิ่งที่ task นี้ตั้งใจกำจัด · `sideOffset={4}` เป็นตัวเลข ไม่ใช่สตริง
