# สกัดข้อมูลสินค้าจากแคปหน้าจอ — Design

## Problem

ข้อมูลสินค้า (ชื่อ + รายละเอียด) อยู่ใน TikTok Shop tools ที่มีแค่บนมือถือ workflow ปัจจุบันของผู้ใช้คือ: เปิดมือถือผ่าน Windows Phone Link → แคปหน้าสินค้า (ได้ไฟล์บน PC อยู่แล้ว) → เอารูปไปวางในแชท Gemini → prompt ให้สกัดข้อความ → ก๊อปผลลัพธ์ → วางลงช่องฟอร์มในแอปทีละช่อง

ขั้น "วางใน Gemini แชท → รอ → ก๊อป → วางกลับ" เป็นแรงงานมือล้วนที่ทำซ้ำทุกสินค้า ทั้งที่แอปมี Gemini client ที่ส่งรูปเป็นอยู่แล้ว

**ข้อเท็จจริงสำคัญจากผู้ใช้:** แคปที่ใช้สกัดเป็น**คนละชุด**กับ "รูปสินค้าจริง" ที่แนบเข้าระบบ — แคปสกัดส่วนใหญ่เป็นหน้าข้อความล้วน (รายละเอียดสินค้า) ไม่ได้เอามาแปะในแอป ดังนั้นรูปพวกนี้**ต้องไม่**ปนเข้าไปใน `ProductImage` (รูปสินค้าจริงถูกส่งให้ AI ตอน generate วิดีโอ ถ้ามีแคปหน้าข้อความปนจะทำให้ 10-part prompt เพี้ยน)

## ข้อเท็จจริงจากโค้ดจริง (load-bearing — อ่านก่อนออกแบบ)

- **`lib/gemini.ts` เป็นไฟล์เดียวที่รู้จัก SDK** (`@google/genai`) — ฟังก์ชันสกัดใหม่ต้องอยู่ที่นี่ ตามกฎ architecture เดิม · API ใช้ **snake_case** (`system_instruction`, `generation_config`) สะกดผิดแล้วเงียบ ไม่ error
- **โมเดล flash-lite มีโควตา 500/วัน แยก pool จาก 3.5-flash (20/วัน)** — งานสกัดข้อความเป็นงานเบา ควรล็อกที่ `gemini-3.1-flash-lite` เสมอ เหตุผลเดียวกับ `CAPTION_MODEL` ใน `lib/gemini.ts:81`
- **`brief-form.tsx:112-122` มี window-level paste listener อยู่แล้ว** ที่ดักรูปทุกครั้งที่ paste บนแท็บ Brief แล้วส่งเข้า "รูปสินค้าจริง" ผ่าน `onAddImages` — โซนสกัดใหม่ต้องแย่ง paste ได้เฉพาะตอนที่เปิดอยู่ ไม่งั้นรูปแคปข้อความจะไหลเข้ารูปสินค้าจริง
- **`lib/caption.ts` เป็นแบบอย่างของ parser**: ถ้าโมเดลตอบผิดฟอร์แมตจนแยกไม่ได้ → คืนทั้งก้อนลงช่องหลัก ไม่ throw ไม่ทิ้งของที่จ่ายโควตาไปแล้ว
- **`next.config.ts:14` ตั้ง `bodySizeLimit: "32mb"` แล้ว** — ส่งแคปหลายรูปผ่าน Server Action ได้สบาย
- **Form state (`form`/`setForm`) อยู่ใน `prompt-workspace.tsx`** — BriefForm รับ `onFieldChange` เป็น prop การเติมผลสกัดต้องวิ่งผ่าน callback จาก workspace
- **BriefForm เรียก Server Action ตรงได้** — มี precedent แล้ว (`deleteProductImage` ถูก import และเรียกตรงใน `brief-form.tsx:6,233`)
- **Gemini safety classifier มี false positive กับรูปที่มีองค์ประกอบเด็ก/ของเล่น** (CLAUDE.md) — error ต้องแสดงให้เห็นชัดและมีเส้นทาง fallback (Gemini แชทแบบเดิม) เสมอ

## Design

### 1. `lib/extract.ts` — parser (pure, ตามแบบ `lib/caption.ts`)

```
parseExtractOutput(raw: string): { productName: string; productInfo: string }
```

คาดหวังฟอร์แมต `ชื่อสินค้า: ...` / `รายละเอียดสินค้า: ...` จากโมเดล — ถ้าแยกไม่ได้ คืน `productName: ""` และทั้งก้อนลง `productInfo` (ไม่ throw ไม่ทิ้งของ)

### 2. `lib/gemini.ts` — ฟังก์ชันเรียกโมเดลใหม่

```
extractProductFields(args: { images: GeminiImage[] }): Promise<string>
```

- ใช้ `EXTRACT_MODEL = "gemini-3.1-flash-lite"` **เสมอ** (ค่าคงที่ใหม่ ข้างๆ `CAPTION_MODEL` พร้อมคอมเมนต์เหตุผลโควตาแบบเดียวกัน)
- `system_instruction` (snake_case!) สั่งให้สกัดข้อความจากแคปหน้าสินค้า TikTok Shop ตอบเป็นฟอร์แมต `ชื่อสินค้า:` / `รายละเอียดสินค้า:` ภาษาเดิมตามที่เห็นในรูป ไม่แต่งเติม
- ส่งรูปเรียงตามลำดับที่ผู้ใช้แปะ (caption ของ `GeminiImage` ปล่อยว่างได้ — งานนี้ไม่ต้อง interleave label เพราะไม่มี label)

### 3. `app/actions.ts` — Server Action `extractProductInfo`

```
extractProductInfo(formData: FormData): Promise<{ productName: string; productInfo: string }>
```

- validate ไฟล์ด้วยกติกาเดิม (`ALLOWED_IMAGE_TYPES`, `MAX_IMAGE_BYTES` — ค่าคงที่มีอยู่แล้วในไฟล์)
- แปลงเป็น base64 **in-memory เท่านั้น** — ไม่เขียนดิสก์ ไม่สร้างแถว DB ไม่แตะ `uploads/` (รูปสกัดเป็นของใช้แล้วทิ้ง)
- เรียก `extractProductFields` → `parseExtractOutput` → คืนผล
- **ไม่เรียก `revalidatePath`** — action นี้ไม่แตะข้อมูลใดๆ

### 4. UI ใน `brief-form.tsx` — โซนสกัดแบบเปิด/ปิด

- ปุ่ม toggle "สกัดจากแคปหน้าสินค้า" ใต้ dropzone รูปสินค้าจริง (ใช้ไอคอน lucide `ScanText`) — **ค่าเริ่มต้นปิด**
- ตอนเปิด: แสดงแผงที่มี (ก) พื้นที่แปะ/เลือกไฟล์ของตัวเอง (ข) preview รูปที่แปะแล้ว + ปุ่มลบรายใบ (ค) ปุ่ม "สกัดข้อมูล" (disabled ถ้ายังไม่มีรูป/กำลังสกัด)
- **ตอนแผงเปิดอยู่ window paste ต้องวิ่งเข้าแผงสกัดแทนรูปสินค้าจริง** — แก้ handler เดิมให้เช็ค state แผงก่อน route (จุดตัดสินสำคัญ: ตัดสินใน handler เดียว ไม่ตั้ง listener ซ้อนกัน 2 ตัวแข่งกัน)
- state ของแผง (เปิด/ปิด, รูปที่รอสกัด, isExtracting ผ่าน `useTransition`, error) อยู่ใน BriefForm ทั้งหมด — เรียก `extractProductInfo` ตรง (ตาม precedent `deleteProductImage`)
- สำเร็จ: เรียก prop callback ใหม่ `onExtracted({ productName, productInfo })` → workspace `setForm` **ทับ 2 ช่องนี้** (riskModule/extraNotes ไม่แตะ) — **ยกเว้นค่าที่สกัดมาเป็นสตริงว่าง ให้คงค่าเดิมของช่องนั้นไว้** (กันเคส parser fallback ที่คืน `productName: ""` ไปลบชื่อที่ผู้ใช้พิมพ์ไว้แล้ว) → เคลียร์รูปในแผง + ปิดแผง — ผู้ใช้ตรวจ/แก้ในฟอร์มก่อนกด "สร้าง Prompt" ตามปกติ (ยังไม่มีอะไรถูกบันทึกลง DB)
- ล้มเหลว: โชว์ข้อความ error สีแดง (โทน `text-record` เดิม) ในแผง รูปยังอยู่ กดสกัดซ้ำได้ — fallback สุดท้ายคือเส้นทาง Gemini แชทแบบเดิมซึ่งไม่ถูกแตะต้อง

### 5. เรื่องที่ไม่ใช่สินค้า (หลักเกณฑ์ที่โดนละเมิด ฯลฯ) — ไม่ทำ feature

Claude Code อ่านรูปได้โดยตรง (แปะเข้าหน้าต่างแชท หรือบอก path ไฟล์แคป) — ใช้ช่องทางนั้นได้ทันทีโดยไม่ต้องสร้างอะไร

## Non-goals (YAGNI)

- ไม่เก็บรูปสกัดถาวร (ไม่มีดิสก์/DB/schema ใหม่)
- ไม่ทำ folder watcher / สกัดอัตโนมัติตอนแปะ — ต้องกดปุ่มเอง ผู้ใช้คุมโควตาและจังหวะ
- ไม่สกัดลง `riskModule`/`extraNotes` — สองช่องนั้นเป็นความคิดของผู้ใช้เอง ไม่ใช่ข้อมูลจากหน้าร้าน
- ไม่ให้เลือกโมเดล — ล็อก flash-lite (งานสกัดไม่ต้องการโมเดลละเอียด)
- ไม่แตะ workflow รูปสินค้าจริง / การ generate เดิมแม้แต่บรรทัดเดียว

## Constraints (จาก CLAUDE.md)

- `lib/gemini.ts` เป็นไฟล์เดียวที่รู้จัก SDK · **snake_case** (`system_instruction`, `generation_config`) — สะกดผิด API เงียบ ห้ามกลบด้วย `as any` ให้เช็ค `CreateModelInteraction` ใน `node_modules/@google/genai/dist/genai.d.ts`
- ห้ามรัน `npm run build`/`npm run dev` ชน `start.bat` port 3000 — ใช้ `npx tsc --noEmit` + isolated dev server (`cp dev.db dev-test.db` + `NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001`) แล้ว cleanup
- เช็ก `git diff tsconfig.json` ก่อน commit ทุกครั้ง
- ห้าม emoji · UI ภาษาไทย · design token เดิม (`record` สำหรับ error, `marigold` สำหรับ accent) · ไอคอน lucide
- ไม่มี test runner — verify ด้วย `npx tsc --noEmit` + `npm run lint` + Playwright (การเรียก Gemini จริงต้องใช้ `GEMINI_API_KEY` ใน `.env` ซึ่งมีอยู่แล้วบนเครื่องนี้)
- ห้าม `git add -A`

## Verification

- `npx tsc --noEmit` + `npm run lint` สะอาด
- ทดสอบ UI จริง (dev-test.db, port 3001):
  - แผงสกัดเริ่มต้น**ปิด** — paste บนแท็บ Brief ยังเข้ารูปสินค้าจริงเหมือนเดิมทุกอย่าง (ไม่มี regression)
  - เปิดแผง → paste แคปหน้าสินค้าจริง (ใช้แคปจริงจาก TikTok Shop ที่มีชื่อ+รายละเอียด) → รูปโผล่ในแผง **ไม่โผล่ในรูปสินค้าจริง**
  - กด "สกัดข้อมูล" → ช่องชื่อสินค้า + ข้อมูลสินค้าถูกเติมด้วยข้อความที่ตรงกับในรูป (เรียก Gemini จริง) → แผงปิด รูปในแผงถูกเคลียร์
  - ช่อง riskModule / extraNotes ไม่ถูกแตะ
  - ปิดแผงแล้ว paste อีกครั้ง → เข้ารูปสินค้าจริงตามเดิม (listener สลับกลับถูกต้อง)
  - เคส error: ตัด GEMINI_API_KEY ใน env ของ dev server ชั่วคราว (หรือ mock) → error สีแดงแสดงในแผง รูปไม่หาย
- ไม่มีไฟล์ใหม่ใน `uploads/` และไม่มีแถว DB ใหม่เกิดจากการสกัด (เช็ค dev-test.db ก่อน/หลัง)
- ไม่มี console error / hydration error

## Git

แตก branch ใหม่จาก `master`: `feature/extract-from-screenshot` (สร้างแล้ว)
