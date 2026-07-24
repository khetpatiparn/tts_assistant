# Sidebar: เมนูรวม action + ค้นหาให้ครอบคลุม — Design

## Problem

หลังเพิ่มปุ่ม "ทำซ้ำ" เข้าไปใน history rail ผู้ใช้เจอ 2 ปัญหาที่แยกจากกัน:

1. **ชื่อสินค้าถูกบีบจนอ่านไม่ออก** — แถวรายการมีไอคอน 2 อัน (ทำซ้ำ + ลบ) เบียดพื้นที่ชื่อสินค้า เห็นชื่อได้แค่ไม่กี่ตัวอักษร
2. **ค้นหาไม่เจอทั้งที่มีสินค้านั้นอยู่** — พิมพ์คำที่จำได้จากข้อมูลสินค้าแล้วไม่เจอ เพราะระบบค้นเฉพาะชื่อสินค้าเท่านั้น

ปัญหาทวีขึ้นเมื่อรายการสินค้าเยอะขึ้น (ตอนนี้ ~48 รายการและเพิ่มเรื่อยๆ)

## ข้อเท็จจริงจากโค้ดจริง (load-bearing — อ่านก่อนออกแบบ)

- **ไอคอนกินพื้นที่แม้ตอนมองไม่เห็น** — `components/history-rail.tsx:157-172` ไอคอนทั้งสองใช้ `opacity-0 group-hover:opacity-100` ซึ่งทำให้**โปร่งใสแต่ยังกิน layout อยู่ตลอดเวลา** ชื่อสินค้าที่เป็น `min-w-0 flex-1 truncate` (บรรทัด 151) จึงถูกบีบตลอด ไม่ใช่แค่ตอน hover
- **ค้นหาแตะฟิลด์เดียว** — `components/history-rail.tsx:67`: `if (needle && !entry.productName.toLowerCase().includes(needle)) return false;` — ไม่แตะ `productInfo`, `extraNotes`, `riskModule` เลย ทั้งที่ข้อมูลเหล่านี้มีอยู่ครบใน `PromptEntry` ที่ส่งมาให้แล้ว (ดู type ที่ `components/prompt-workspace.tsx:35-53`)
- **โครงสร้างแถวปัจจุบันเป็น `<button>` ครอบ `<span role="button">`** (บรรทัด 140-173) — เป็น invalid HTML ที่ "รอดมาได้" เพราะ span ไม่ใช่ปุ่มจริง **แต่ Menu.Trigger ของ Base UI เรนเดอร์เป็น `<button>` จริง** การเอา `<button>` ซ้อนใน `<button>` ทำให้ event/accessibility พังจริงในเบราว์เซอร์ — โครงสร้างแถวจึงต้องถูกจัดใหม่ ไม่ใช่แค่สลับไอคอน
- **Base UI มี Menu primitives ครบแล้ว ไม่ต้องลง dependency เพิ่ม** — ยืนยันจาก `node_modules/@base-ui/react/menu/`: มี `root/`, `trigger/`, `portal/`, `positioner/`, `popup/`, `item/` — **โครงสร้างต่างจาก Radix ตรงที่แยก `Positioner` ออกจาก `Popup`** (Radix รวมเป็น `Content` ตัวเดียว) ห้ามเดา prop shape ต้องอ่าน `.d.ts` จริงก่อนเขียน
- **sidebar เป็น scroll container** — `<aside>` มี `overflow-hidden` (บรรทัด 90) และ list มี `overflow-y-auto` (บรรทัด 128) ถ้า popup เรนเดอร์อยู่ในสายนี้จะโดน clip → **ต้องใช้ `Menu.Portal`**
- **`onDuplicate`/`onDelete` ใช้เฉพาะที่นี่ที่เดียว** — grep ทั้ง repo แล้วเจอแค่ใน `history-rail.tsx` (นิยาม+เรียก) กับ `prompt-workspace.tsx:304-305` (ส่ง prop) เท่านั้น การเปลี่ยน signature จึงปลอดภัย ไม่มีที่อื่นพัง
- **ไอคอน 3 จุดใน lucide v1.23.0 ชื่อ `EllipsisVertical`** — `MoreVertical` ยังมีอยู่แต่เป็นแค่ alias (`more-vertical.mjs` มีบรรทัดเดียวคือ `export { default } from './ellipsis-vertical.mjs'`) ต้องใช้ชื่อ canonical ตามที่ AGENTS.md สั่งให้ heed deprecation

## Design

### 1. จัดโครงสร้างแถวใหม่ — ปุ่มเลือกกับ trigger เป็นพี่น้องกัน (ไม่ซ้อนกัน)

เปลี่ยนจาก `<button>` ครอบทุกอย่าง เป็น `<li>` ที่เป็น flex container ถือของ 2 อย่างแบบ **sibling**:

- `<button>` สำหรับเลือกรายการ — กิน `flex-1 min-w-0` ถือ take number + ชื่อสินค้า + วันที่
- `<Menu.Trigger>` (เป็น `<button>` จริง) — อยู่ข้างนอกปุ่มเลือก ไม่ซ้อนใน

สไตล์ active/hover ของทั้งแถว (`border-marigold bg-ink-2 text-paper`, `hover:bg-ink-2`) ย้ายจาก `<button>` ไปไว้ที่ `<li>` และ `group` ก็ย้ายไป `<li>` เพื่อให้ trigger ยัง hover-reveal ตามแถวได้เหมือนเดิม

**ผลพลอยได้:** invalid HTML nesting เดิม (span role=button ใน button) หายไปด้วย

### 2. รวม 2 action เป็นเมนูเดียว

- **Trigger:** ไอคอน `EllipsisVertical` (lucide) ปุ่มเดียว hover-reveal เหมือนเดิม (`opacity-0 group-hover:opacity-100`) — เหลือไอคอนเดียวเท่ากับตอนก่อนเพิ่มฟีเจอร์ทำซ้ำ ซึ่งเป็นระดับที่ไม่เคยมีปัญหา
  - **ใช้ชื่อ `EllipsisVertical` เท่านั้น ห้ามใช้ `MoreVertical`** — ตรวจใน `node_modules/lucide-react/dist/esm/icons/more-vertical.mjs` แล้วพบว่าเป็นแค่ alias เก่าที่ `export { default } from './ellipsis-vertical.mjs'` (lucide-react v1.23.0) ชื่อ canonical คือ `EllipsisVertical`
- **เมนู 2 รายการ:** "ทำซ้ำ" (ไอคอน `Copy`) และ "ลบ" (ไอคอน `Trash2`, สี `record` เหมือนเดิม)
- ประกอบด้วย `Menu.Root` → `Menu.Trigger` + `Menu.Portal` → `Menu.Positioner` → `Menu.Popup` → `Menu.Item` × 2
- **ต้องใช้ `Menu.Portal`** เพื่อไม่ให้ popup โดน sidebar clip
- **สไตล์เขียนตรงใน `history-rail.tsx` ด้วย design token เดิม** (`bg-ink-2`, `text-paper`, `border-paper/15`, `hover:bg-ink`, `text-record`) — ไม่สร้างไฟล์ `components/ui/menu.tsx` ใหม่ เพราะมีที่ใช้แค่จุดเดียวและมีแค่ 2 รายการ ถ้าวันหน้ามีเมนูที่ 2 ค่อยแยกออกมาเป็น component กลาง

### 3. ลดความซับซ้อนของ handler signature

`Menu.Item` อยู่ใน Portal (คนละ DOM subtree กับแถว) คลิกจึงไม่ bubble ไปโดนปุ่มเลือกอยู่แล้ว → `event.stopPropagation()` ที่มีอยู่ใน `handleDuplicate`/`handleDelete` (`prompt-workspace.tsx`) **หมดความจำเป็น**

เปลี่ยน signature ทั้งคู่จาก `(id: string, event: React.MouseEvent) => void` เป็น **`(id: string) => void`** แล้วลบบรรทัด `event.stopPropagation()` ออก — เพื่อไม่ทิ้งโค้ดที่อ่านแล้วเข้าใจผิดว่ายังจำเป็น

(`handleDelete` ยังคง `confirm()` ก่อนลบเหมือนเดิม)

### 4. ค้นหาให้ครอบคลุม 3 ฟิลด์

เปลี่ยนเงื่อนไขที่ `history-rail.tsx:67` ให้แมตช์เมื่อคำค้นเจอใน **`productName` หรือ `productInfo` หรือ `extraNotes`** (or กัน)

**เหตุผลที่เลือก 3 ฟิลด์นี้ และตัด `riskModule` ออก:**
- `productInfo` — เป็นสาเหตุตรงของปัญหา เป็นข้อความยาวที่ก๊อปจากเว็บ/ร้านค้า มีชื่อแบรนด์/สเปกที่ชื่อสินค้าสั้นๆ ไม่มี
- `extraNotes` — โน้ตที่ผู้ใช้เขียนเองเจาะจงรายการ (เช่น "เน้นคนอยู่หอ") มีโอกาสถูกใช้เป็นคำค้น และ false positive ต่ำเพราะเป็นข้อความเฉพาะตัว
- **ตัด `riskModule`** — เนื้อหามักเป็นวลีซ้ำทั่วไป (พับได้/กางได้/มีกลไก) ที่ใช้ร่วมกันหลายสิบรายการ ถ้ารวมเข้าไป พิมพ์ "พับ" ครั้งเดียวจะโผล่มาเป็นสิบรายการที่ไม่เกี่ยวกัน ขัดกับจุดประสงค์ของการค้นหาที่ต้องการให้ผลลัพธ์**แคบลง**

## Non-goals (YAGNI — ตัดออกชัดเจน)

- **ไม่สร้าง `components/ui/menu.tsx`** — มีที่ใช้จุดเดียว 2 รายการ ยังไม่คุ้มแยกเป็น component กลาง
- **ไม่ทำ fuzzy search / highlight คำที่แมตช์ / จัดอันดับผลลัพธ์** — substring matching ธรรมดาพอสำหรับสเกลปัจจุบัน (~48 รายการ)
- **ไม่เพิ่ม action ใหม่ในเมนู** (เช่น rename, archive) — ย้าย 2 อันที่มีอยู่เท่านั้น
- **ไม่แตะ logic การจัดกลุ่มตามเดือน / take number / ตัวกรอง "ยังไม่ได้กรอกผลลัพธ์"**
- **ไม่ทำ virtualization ของ list** — 48 รายการยังไม่ถึงจุดที่ต้องใช้

## Constraints (จาก CLAUDE.md)

- **shadcn/ui ในโปรเจกต์นี้สร้างบน `@base-ui/react` ไม่ใช่ Radix** — ห้ามเดา prop shape ต้องอ่าน `.d.ts` จริงใน `node_modules/@base-ui/react/menu/` ก่อนเขียนโค้ด (กฎเดียวกับ Gemini SDK / Recharts)
- ห้าม emoji · ข้อความ UI ภาษาไทย · ใช้ design token เดิม (`ink`/`ink-2`/`paper`/`marigold`/`record`) ห้ามเพิ่มสีใหม่ · ไอคอนจาก lucide
- ห้ามรัน `npm run build`/`npm run dev` ชนกับ `start.bat` ของผู้ใช้ที่ port 3000 — ใช้ `npx tsc --noEmit` เช็ก type
- ทดสอบ UI ใช้ isolated dev server: `cp dev.db dev-test.db` แล้ว `NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001` — cleanup `dev-test.db` หลังเสร็จ, ห้ามแตะ port 3000
- เช็ก `git diff tsconfig.json` ก่อน commit ทุกครั้ง (dev server อาจ auto-patch, repo pin `target: "ES2017"` ตั้งใจ)
- ไม่มี test runner — verify ด้วย `npx tsc --noEmit` + `npm run lint` + Playwright
- **ห้าม `git add -A`** — add เฉพาะไฟล์ที่ตั้งใจแก้

## Verification

- `npx tsc --noEmit` + `npm run lint` สะอาด
- ทดสอบ UI จริง (dev-test.db, port 3001):
  - **ชื่อสินค้ายาวขึ้นอย่างเห็นได้ชัด** — เทียบก่อน/หลัง ชื่อที่เคยถูกตัดตอนนี้แสดงได้มากกว่าเดิม (เพราะไอคอน 2 อันหายไปจาก layout)
  - hover แถว → เห็นไอคอน 3 จุด (`MoreVertical`) อันเดียว
  - กดไอคอน → เมนูเปิด เห็น "ทำซ้ำ" กับ "ลบ" · **popup ไม่โดน sidebar ตัดขอบ** (ทดสอบกับรายการที่อยู่ล่างสุดของ list ที่ต้องเลื่อน scroll ด้วย)
  - กด "ทำซ้ำ" → สร้าง entry ใหม่ + เด้งไปแท็บ Brief พร้อมรูปครบ (พฤติกรรมเดิมไม่เสีย)
  - กด "ลบ" → ขึ้น confirm ก่อนลบ (พฤติกรรมเดิมไม่เสีย)
  - **กดที่ตัวแถว (ไม่ใช่ไอคอน) → ยังเลือกรายการได้ปกติ** และกดไอคอนแล้ว**ไม่**ไปเลือกรายการนั้นด้วย
  - ค้นหา: พิมพ์คำที่มีอยู่ใน **ข้อมูลสินค้า** (ไม่ใช่ชื่อสินค้า) ของรายการใดรายการหนึ่ง → **เจอรายการนั้น** (เคสที่พังอยู่ตอนนี้)
  - ค้นหา: พิมพ์คำที่อยู่ใน `riskModule` อย่างเดียว (เช่น "พับได้") → **ไม่ควรแมตช์** จากฟิลด์นั้น (ยืนยันว่าตัด riskModule ออกจริง)
  - ตัวนับ "แสดง N/M" ยังถูกต้องตามผลค้นหาใหม่
- ไม่มี console error / hydration error

## Git

แตก branch ใหม่จาก `master`: `feature/sidebar-menu-search` (สร้างแล้ว)
