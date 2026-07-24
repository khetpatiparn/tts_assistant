# ฟีเจอร์ "ทำซ้ำ" (Duplicate clip) — Design

## Problem

ผู้ใช้ต้องทำคลิปซ้ำสำหรับ **สินค้าตัวเดียวกัน** อยู่เรื่อยๆ กรณีจริงที่เจอ:

1. **Product Pool มี listing ซ้ำ** — ร้านค้าลงสินค้าตัวเดียวกันเป็น 2 listing (คนละ SKU/รายการ) ผู้ใช้ทำคลิปให้ listing แรกไปแล้ว แล้วต้องทำอีกคลิปให้ listing ที่สอง ทั้งที่เป็นสินค้าเดียวกันเป๊ะ
2. **ทำคลิปเพิ่มจาก winner** — สินค้าที่พิสูจน์แล้วว่าขายได้ (เช่น "ที่ลับเล็บแมว" = 83% ของรายได้ทั้งช่อง) อยากปั๊มคลิปเพิ่มเพื่อเจอ winner ซ้ำ

ทั้งสองกรณีคือสิ่งเดียวกัน: **"ได้คลิปใหม่ที่เริ่มจากของเดิม แล้วปรับเล็กน้อยก่อนโพสต์"**

**ความเจ็บปวดจริง:** ตอนนี้ถ้าเลือกสินค้าเดิมใน list แล้วกด "สร้าง Prompt" ระบบสร้าง entry ใหม่ที่ **ไม่มีรูปติดมาด้วย** ผู้ใช้จึงต้องไปหา/สร้างรูปสินค้าใหม่ทั้งหมด ซึ่งเป็นขั้นที่เสียเวลาที่สุด (แคปรูปจาก TikTok Shop + สร้างรูปผ่าน Nano Banana Pro)

## ข้อเท็จจริงจากโค้ดจริง (load-bearing — อ่านก่อนออกแบบ)

- **แต่ละ `PromptEntry` = 1 คลิปที่โพสต์** — มี `videoUrl`, `postedAt` ของตัวเอง และ affiliate order จับคู่รายได้เข้ามาที่ entry นั้นผ่าน `videoUrl` → `contentId` (`app/actions.ts` `importAffiliateOrders`) ดังนั้นคลิปที่ 2 ของสินค้าเดิม **ต้องเป็น entry ใหม่** ไม่ใช่ reuse entry เดิม (ไม่งั้นรายได้ 2 คลิปจะปน / output คลิปเก่าโดนทับ)
- **`createPrompt` (`app/actions.ts:22`) สร้าง entry เปล่าใหม่** — ก๊อปเฉพาะ 4 ช่องข้อความจาก `formData` และผูก core prompt ที่ active ไม่มีการก๊อปรูป
- **รูปสินค้าเก็บ 2 ที่:** metadata อยู่ในตาราง `ProductImage` (filename, mimeType, caption, sortOrder, entryId) ส่วนไฟล์จริงอยู่บนดิสก์ที่ `uploads/<entryId>/<filename>` (`UPLOAD_ROOT` ใน `app/actions.ts:181`) — การก๊อปรูปต้องทำทั้ง 2 ที่: ก๊อปไฟล์บนดิสก์ (ชื่อไฟล์ใหม่ UUID กัน collision) + สร้างแถว `ProductImage` ใหม่ชี้ entry ใหม่
- **`ProductImage.onDelete: Cascade`** — ลบ entry แล้วแถวรูปหายตาม (แต่ไฟล์บนดิสก์ไม่ถูกลบ ตาม CLAUDE.md) การก๊อปสร้างไฟล์+แถวชุดใหม่แยกกัน ไม่กระทบต้นฉบับ
- **แอปรองรับสลับรูปทีละใบอยู่แล้ว** — `brief-form.tsx` มีปุ่มลบรูป (`deleteProductImage`) + paste/drag รูปใหม่ ดังนั้นหลังทำซ้ำ ผู้ใช้ลบเฉพาะ "รูปตอนใช้งาน" เก่าแล้ว paste ฉากใหม่ได้เอง ไม่ต้องสร้าง UI เพิ่ม
- **`history-rail.tsx` มีปุ่มลบต่อรายการอยู่แล้ว** (ไอคอน `Trash2` โผล่ตอน hover, บรรทัด 155-162) — ปุ่ม "ทำซ้ำ" วางคู่กันในรูปแบบเดียวกันได้
- **Nano Banana Pro = 0 เครดิต สร้างรูปไม่จำกัด** (จาก workflow ของผู้ใช้) — การสร้างรูปฉากใหม่เพื่อเลี่ยงคลิปซ้ำ ไม่เสียเครดิต เสียแค่เวลา จึงไม่ใช่ข้อจำกัดของฟีเจอร์นี้

## Design

### 1. Data model — เพิ่ม `duplicatedFromId` ใน `PromptEntry`

```prisma
duplicatedFromId String?
```

- nullable, ไม่มี relation กลับ (self-relation ไม่จำเป็นสำหรับการใช้งานปัจจุบัน — เก็บแค่ค่า id ไว้พอ)
- **ยังไม่ทำ UI ใดๆ กับค่านี้** — เก็บเป็นข้อมูลดิบไว้จับกลุ่มคลิปของสินค้าเดียวกัน (ต่อให้ pool แยกเป็น 2 listing) เพื่อวิเคราะห์ผลการทำซ้ำ/angle ในอนาคต ถ้าไม่เก็บตอนกดทำซ้ำ ข้อมูลนี้สร้างย้อนหลังไม่ได้ (productName เชื่อไม่ได้, รายได้ผูกที่ videoUrl รายคลิป)

### 2. Server Action — `duplicatePrompt(sourceId: string): Promise<string>`

ใน `app/actions.ts`:

1. อ่าน entry ต้นทางพร้อม `productImages` (เรียง `sortOrder`)
2. สร้าง entry ใหม่ **ก๊อปฟิลด์ที่ใช้ซ้ำได้:** `productName`, `productInfo`, `riskModule`, `extraNotes`, `chatgptOutput`, `caption`, `hashtags`, `corePromptId` (ก๊อปตรงจากต้นทาง ไม่ต้อง re-query active core prompt — คลิปซ้ำควรอิง core prompt เดียวกับต้นฉบับ), `images` (ก๊อปค่า legacy field มาตรงๆ), และตั้ง `duplicatedFromId = sourceId`
3. **ฟิลด์ที่ปล่อยเป็นค่า default (สดใหม่):** `videoUrl` (`""`), `postedAt` (`null`), `postedTimeOfDay` (`null`), `postedTimeSource` (`null`), `isScheduledPost` (`false`) — เพราะเป็นข้อเท็จจริง/ตัวผูกรายได้รายคลิป
4. ก๊อปรูปทุกใบ: สำหรับแต่ละ `ProductImage` ต้นทาง — อ่านไฟล์จาก `uploads/<sourceId>/<oldFilename>`, เขียนไฟล์ใหม่ที่ `uploads/<newId>/<newUUID.ext>`, สร้างแถว `ProductImage` ใหม่ (คง `caption`, `sortOrder`, `mimeType` เดิม, `filename` ใหม่, `entryId` = newId)
   - **ถ้าไฟล์ต้นทางหายบนดิสก์** (แถวมีแต่ไฟล์ไม่มี) — ข้ามรูปใบนั้น ไม่ให้ทั้ง action ล้ม (row เป็น source of truth แต่คลิปซ้ำที่ขาดรูปบางใบดีกว่า error ทั้งหมด) — สอดคล้องกับแนวทาง `deleteProductImage` ที่ยอมให้ไฟล์หายได้
5. `revalidatePath("/")` แล้ว return `newId`

### 3. UI — ปุ่ม "ทำซ้ำ" ใน history rail

- `history-rail.tsx`: เพิ่มไอคอนปุ่ม "ทำซ้ำ" (lucide `Copy`) คู่กับปุ่มลบ ในรูปแบบ hover-to-reveal เดียวกัน — รับ prop ใหม่ `onDuplicate: (id: string, event: React.MouseEvent) => void`
- `prompt-workspace.tsx`: handler `handleDuplicate(sourceId, event)`:
  - `event.stopPropagation()` (กันไป trigger `onSelect` ของ list item)
  - หา source entry จาก `prompts.find((p) => p.id === sourceId)` — มีอยู่แล้วในมือ ข้อความของคลิปซ้ำ = ข้อความ source เป๊ะ
  - `await duplicatePrompt(sourceId)` → `newId`
  - `setSelectedId(newId)` · `setForm(entryToForm(sourceEntry))` (ข้อความเหมือน source) · `setTab("brief")` · `setPendingImages([])` · `setImageError(null)` · `setGenError(null)`
  - **การ sync เป็น deterministic:** ไม่พึ่ง auto-sync ใดๆ — `form` ตั้งตรงจาก source entry (ข้อความเท่ากัน) ส่วน `selectedEntry` จะชี้ entry ใหม่หลัง revalidate ทำให้ prompts มีมัน (รูปที่โชว์มาจาก `selectedEntry.productImages` ของ entry ใหม่) ครบทุกส่วนโดยไม่มี race
  - ใช้ `useTransition` (เช่นเดียวกับ `startGenerating`) ครอบ action เพื่อกันดับเบิลคลิก

### 4. Flow หลังใช้งาน (ยืนยันว่าดีไซน์ตอบโจทย์)

กด "ทำซ้ำ" → รูป+บรีฟ+10-part+caption ก๊อปมาครบ → (ถ้าอยากได้ฉากต่าง) ลบรูปตอนใช้งานเก่า + paste ฉากใหม่ (ฟรีผ่าน Nano Banana Pro) → regenerate 10-part ถ้าต้องการ → ปรับ caption เล็กน้อย → โพสต์เป็นคลิปใหม่ที่มี videoUrl/รายได้ของตัวเอง

## Non-goals (YAGNI — ตัดออกชัดเจน)

- **ไม่ทำระบบวัด/เปรียบเทียบ angle** — ที่ volume ปัจจุบัน (~48 คลิป, วิวแปรปรวน 60 เท่า, conv แบน) การทดสอบ angle ยังไม่มีนัยสำคัญทางสถิติ ยังไม่คุ้มสร้าง
- **ไม่ทำ UI แสดง lineage / จับกลุ่มคลิปพี่น้อง** — เก็บแค่ `duplicatedFromId` เป็นข้อมูลดิบ ค่อยต่อยอดเมื่อมี volume พอ
- **ไม่ remodel Product→Clips** — การแยกเป็นตาราง Product ที่ถือหลาย Clip เป็น refactor ใหญ่ ได้ประโยชน์เพิ่มน้อยเทียบต้นทุน ตอนนี้ duplicate action ได้ 90% ของคุณค่าที่ 5% ของต้นทุน
- **ไม่สร้าง UI สลับรูปเพิ่ม** — แอปมีลบ/เพิ่มรูปทีละใบใน brief อยู่แล้ว

## Constraints (จาก CLAUDE.md)

- Prisma 7 + driver adapter — หลังแก้ `prisma/schema.prisma` รัน `npx prisma migrate dev --name add_duplicated_from` + `npx prisma generate` · import client จาก `@/lib/generated/prisma/client`
- ห้ามใช้ `dev.db` ตัวจริงทดสอบ UI — ก๊อป `dev-test.db` ตามแพตเทิร์น isolated dev server (`NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001`)
- ห้ามรัน `npm run build`/`npm run dev` ชนกับ `start.bat` ของผู้ใช้ที่ port 3000 — ใช้ `npx tsc --noEmit` เช็ก type · เช็ก `git diff tsconfig.json` ก่อน commit ทุกครั้ง (dev server อาจ auto-patch)
- ห้าม emoji, ข้อความ UI ภาษาไทย, ใช้ design token/ไอคอน lucide เดิม
- ไม่มี test runner — verify ด้วย `npx tsc --noEmit` + `npm run lint` + Playwright ใน scratch dir

## Verification

- `npx tsc --noEmit` + `npm run lint` สะอาด
- migration รันผ่าน, `PromptEntry` มีคอลัมน์ `duplicatedFromId`
- ทดสอบ UI จริง (dev-test.db): เลือกสินค้าที่มีรูป → กด "ทำซ้ำ" → เกิด entry ใหม่ที่:
  - ข้อความ 4 ช่อง + 10-part output + caption + hashtag ตรงกับต้นฉบับ
  - **รูปสินค้าโชว์ครบทุกใบ** (ไฟล์ก๊อปไปที่ `uploads/<newId>/` จริง, caption ตรง) — เปิดดูรูปผ่าน `/api/uploads/<newId>/<filename>` ได้
  - `videoUrl` ว่าง, ไม่มีวันโพสต์
  - `duplicatedFromId` = id ต้นฉบับ (เช็คใน dev-test.db)
  - แท็บสลับไป Brief อัตโนมัติ, entry ใหม่ถูกเลือก
- ลบรูปใบหนึ่งใน entry ใหม่ → รูปต้นฉบับ **ไม่หาย** (ไฟล์/แถวแยกกัน)
- ข้อมูลจริงใน dev-test.db ครบเท่าเดิม (ไม่มี entry หาย)

## Git

แตก branch ใหม่จาก `master`: `feature/duplicate-clip` (สร้างแล้ว)
