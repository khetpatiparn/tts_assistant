# Design: ผูก caption↔รูป + เสริม Product Accuracy + productName

วันที่: 2026-07-20
สถานะ: อนุมัติ scope แล้ว รอ writing-plans

## ปัญหา (Root cause)

pipeline การสร้างคลิปมี 2 ก้าว และแอปคุมได้แค่ก้าวแรก:

```
ก้าว 1 (ในแอป):      รูป + brief + Core Prompt → Gemini → 10-part TEXT prompt
ก้าว 2 (เครื่องเจนคลิป): 10-part TEXT prompt + รูปชุดเดิม → วิดีโอ
```

ก้าว 1 ส่งข้อมูลเข้าโมเดลแบบ **"label เป็น text ก้อนเดียวก่อน แล้วรูปทั้งหมดตามมาแบบไม่มีป้ายกำกับ"**
(`lib/gemini.ts` `generateTenPartPrompt`) โมเดลต้องเดา mapping ระหว่าง label กับรูปด้วยการนับตำแหน่ง

หลักฐานจริง (entry "กระติกน้ำแข็ง" `cmrrat57f000d9kp7e2nzujzz`): ผู้ใช้พิมพ์ label ละเอียด **5 อัน**
(ระบุ "ด้านหน้ามี logo / ด้านหลังไม่มี logo / ตอนเปิดฝา") แต่อัปรูปจริง **4 ใบ** → เลขไม่ตรงกันตั้งแต่แรก
และ label ทั้งหมดลอยอยู่ในข้อความ ไม่เกาะกับ pixel ใบไหน → โมเดลอ่านรูปไม่แตก → เขียน **Product Accuracy**
บางและผิดด้าน → เครื่องเจนคลิป (ก้าว 2) ได้ข้อความกำกับที่อ่อน เลย freelance จนคลิปมั่ว

ทำไม Product Accuracy สำคัญ: มันคือ **สิ่งเดียวที่ข้ามพรมแดนจากแอปไปถึงเครื่องเจนคลิป** — ก้าว 2 ใช้
รูปชุดเดิม + ข้อความ 10-part เป็นคำสั่งกำกับ ถ้าข้อความบรรยายโครงสร้างถูก (logo อยู่ด้านไหน โครงเป็นยังไง)
เครื่องเจนคลิปก็ freelance น้อยลงมาก

การผูก caption ในก้าว 1 ไม่ได้วิ่งไปสั่งก้าว 2 ตรงๆ — มันทำให้ก้าว 1 **อ่านรูปแตกแล้วเขียนโครงสร้างที่ถูกต้อง
ลงข้อความ** ซึ่งข้อความนั้นเดินทางไปคุมก้าว 2 แทน

## หลักการมัลติโมดัลที่อยู่เบื้องหลัง

โมเดลรับ text+image เป็น **ลำดับเดียว (sequence)** รูปถูกแปลงเป็น image token แทรกตามตำแหน่งในลำดับ
สิ่งที่อยู่ติดกัน = เชื่อมโยงกันแน่นกว่า (attention-based ไม่ใช่ hard key แต่ adjacency ทำให้แม่นขึ้นจริง
เป็นแนวที่ Google/Anthropic แนะนำเอง) หน้าต่างแชท (ChatGPT/Claude/Gemini) ทำแบบนี้อยู่แล้วโดยธรรมชาติ
เพราะ user วางรูปแล้วพิมพ์ต่อกัน — แอปนี้ทำตรงข้าม (แยกกอง) เราแค่ทำให้แอปวาง caption ประกบรูปเหมือนแชท

## ขอบเขต (Scope)

**ทำ:** (1) ผูก caption ต่อรูป + interleave ตอนส่งเข้าโมเดล · (2) เสริมคำสั่งดึงโครงสร้างจากรูปลง
Product Accuracy · (3) ส่ง `productName` เข้าโมเดล

**ไม่ทำรอบนี้:** ช่อง "จุดขายที่ต้องพูดถึงแน่ๆ" (detail ความจุ/ชั่วโมงหาย — คนละแกน) · import
comparison · recommender

## สถาปัตยกรรม

### 1. Data model — ย้าย caption ไปอยู่บนตัวรูป

เพิ่ม `caption String @default("")` ใน model `ProductImage` (migration แบบ additive ปลอดภัย ไม่มี data loss)

- **แหล่งความจริงเดียว** = `ProductImage.caption` เรียงตาม `sortOrder` → จำนวน caption = จำนวนรูป **เสมอ**
  (mismatch class เช่น 5-label/4-รูป ตายถาวรโดยโครงสร้าง)
- `PromptEntry.images` (JSON labels เดิม) **เลิกใช้ในเส้นทางเจน** — คอลัมน์ยังอยู่ ไม่ drop (drop = destructive)
  แต่ createPrompt เลิกเขียนค่าใหม่ลงไป

### 2. Form UX — รวม 2 ส่วนเป็นอันเดียว

ปัจจุบันฟอร์มมี 2 ส่วนแยกกันที่ทำให้ mismatch: "รูปอ้างอิงที่แนบ" (ช่อง label ลอยๆ `form.images`,
add/remove เอง) กับ "รูปสินค้าจริง" (อัปไฟล์ `pendingImages`/`productImages`)

**ตัดส่วน label ลอยทิ้งทั้งหมด** → caption ไปอยู่ **ใต้ thumbnail รูปแต่ละใบ** ในส่วนอัปรูป:

- **รูป pending** (ยังไม่บันทึก entry): state เปลี่ยนจาก `File[]` เป็น `{ file: File; caption: string }[]`
  → ตอน `createPrompt` ส่ง caption ไปพร้อมไฟล์เพื่อบันทึกลง `ProductImage.caption`
- **รูปที่บันทึกแล้ว**: caption input ใต้รูป → onBlur เรียก Server Action ใหม่ `updateProductImageCaption(id, caption)`
- default labels เดิม (`DEFAULT_IMAGE_LABELS` = "ภาพหน้าสินค้า"/"ภาพตอนใช้งาน") กลายเป็น **placeholder แนะนำ**
  ไม่ pre-fill เป็นค่า (caption ว่างได้ ไม่บังคับ)
- `addImage`/`removeImage`/`updateImage`/`form.images` ใน `prompt-workspace.tsx` ถูกถอดออก

### 3. ส่งเข้าโมเดล — interleave (หัวใจของ fix)

`generateTenPartPrompt` เปลี่ยน param `images` จาก `{base64,mimeType}[]` เป็น `{base64,mimeType,caption}[]`
แล้วสร้าง input array แบบ caption นำหน้ารูปของมันทีละคู่:

```
[few-shot examples (text)...]
[brief text]
[text: "รูปที่ 1 — ด้านหน้า มี logo"][image 1]
[text: "รูปที่ 2 — ด้านหลัง ไม่มี logo"][image 2]
...
```

- `buildPromptText` **ยังลิสต์ caption เป็นข้อความไว้ด้วย** (belt-and-suspenders: ให้ overview เชิงข้อความ +
  ให้ few-shot ที่เป็น text-only เห็น format เดิม) — ทั้งลิสต์ในข้อความและ caption ที่ interleave **ดึงจาก
  `ProductImage.caption` ชุดเดียวกัน เรียง sortOrder เดียวกัน** จึงไม่มีทางขัดกัน
- caption ว่าง → interleave ส่งแค่ "รูปที่ N" (ไม่มีคำบรรยาย) ไม่พัง

### 4. #3 productName

`buildPromptText` รับ `productName` เพิ่ม → ใส่หัว brief ("ชื่อสินค้า: ...") ปิดช่องที่ชื่อสินค้าไม่เคยถึงโมเดล
(ยืนยันแล้วว่าปัจจุบัน `buildPromptText` ไม่รับ productName — `app/actions.ts:258`)

### 5. #2 เสริม Product Accuracy

แก้ instruction ใน `lib/prompt-template.ts` ให้ "ดึงโครงสร้างจากรูปลง Product Accuracy / Critical Structure
ให้ครบ **ตามระดับความเสี่ยงของสินค้า**" (ใช้หลัก risk-based เดิมที่เทมเพลตมีอยู่ — สินค้าเสี่ยงสูงบรรยายละเอียด
สินค้าง่ายไม่ต้องบวม) ถ้าเทสต์แล้ว golden examples ดึง output กลับให้บาง ค่อยเสริม section Product Accuracy
ใน `lib/golden-examples.ts` ด้วย (ประเมินตอน implement)

## Data flow ใหม่ (generateWithAI)

```
photos = entry.productImages (เรียง sortOrder) — แต่ละใบมี caption แล้ว
captions = photos.map(p => p.caption)
brief = buildPromptText({ productName, productInfo, riskModule, extraNotes, imageCaptions: captions })
output = generateTenPartPrompt({
  ...,
  brief,
  images: photos.map(p => ({ base64, mimeType, caption: p.caption })),
})
```

ลิสต์ caption ใน brief กับ caption ที่ interleave มาจาก `photos` ชุดเดียว ลำดับเดียว → consistent เสมอ

## ไฟล์ที่แตะ

- `prisma/schema.prisma` — เพิ่ม `caption` ใน `ProductImage` (+ `npx prisma migrate dev` + `generate`)
- `app/actions.ts` — `uploadProductImages` รับ caption ต่อไฟล์ · `createPrompt` เลิกเขียน `images` · เพิ่ม
  `updateProductImageCaption` · `generateWithAI` ประกอบ brief/images ใหม่
- `components/brief-form.tsx` — ตัดส่วน label ลอย · caption input ใต้รูปแต่ละใบ (pending + saved)
- `components/prompt-workspace.tsx` — `pendingImages` เป็น `{file,caption}[]` · ถอด form.images/add/remove/updateImage
- `lib/gemini.ts` — `generateTenPartPrompt` interleave caption+image
- `lib/prompt-template.ts` — `buildPromptText` รับ productName + imageCaptions · เสริมคำสั่ง Product Accuracy
- `lib/few-shot.ts` — ปรับ signature ให้เข้ากับ buildPromptText ใหม่ (ex.images → imageCaptions)
- `lib/golden-examples.ts` — (เผื่อ) เสริม Product Accuracy ในตัวอย่าง ถ้าเทสต์แล้วจำเป็น

## Backward compat (39 entry เดิม)

`ProductImage` เดิมได้ `caption=""` โดย default — เพิ่ม **backfill script (best-effort)**: copy
`PromptEntry.images[i]` → `productImages[i].caption` ตาม `sortOrder` กันกรณีผู้ใช้เจนซ้ำ entry เก่าแล้ว
caption หาย **ยอมรับว่า imperfect** สำหรับ entry ที่เคยมี label≠จำนวนรูป (เช่นกระติก 5/4) — ส่วนเกินตกหล่นได้
แต่ไม่แย่กว่าของเดิม และ entry เก่าเจนไปแล้วส่วนใหญ่ไม่ต้องเจนซ้ำ

## Verification (กัน 2 ความเสี่ยง)

1. **regression บนสินค้าง่าย** — เพราะ #2 เปลี่ยน output ทุกคลิป ต้องเทสต์เทียบก่อน-หลังทั้ง 2 ขั้ว:
   - สินค้ายาก (กระติกน้ำแข็ง / รถเข็นตู้เก็บเครื่องสำอาง) → Product Accuracy ต้องดีขึ้น (logo/ด้าน/โครงถูก)
   - สินค้าง่าย (ชุดช้อนส้อม) → ต้องไม่บวม ไม่ regress
2. **few-shot anchor สู้คำสั่งใหม่** — ถ้า output ถูกดึงกลับให้บาง เสริม golden examples
3. ยิงจริงผ่าน Gemini API (โควตา flash-lite ต่างหาก ไม่ mock) — ไม่มี test runner ต้อง verify ด้วยการรันจริง
4. `npm run build` (type-check ในตัว) + `npm run lint` สะอาด
5. **ห้ามรัน build ซ้อน `start.bat`** — ขอให้ผู้ใช้ปิด server ก่อน (ตาม CLAUDE.md)

## Constraints (จาก CLAUDE.md)

- Next.js 16 custom build — Server Actions/form ทำงานเหมือน v15 คลาสสิก (ยืนยันแล้ว ไม่ต้องเช็กซ้ำ)
- Prisma 7 + driver adapter · generated client import จาก `@/lib/generated/prisma/client` · หลังแก้ schema
  รัน `npx prisma migrate dev` + `generate`
- Gemini API ใช้ snake_case (`system_instruction`, `generation_config`) — ห้ามเดา shape อ่าน
  `CreateModelInteraction` ใน `node_modules/@google/genai/dist/genai.d.ts`
- ห้าม DELETE FROM ไม่มี WHERE บน `dev.db` (ไม่มี backup)
- อัปรูปวิ่งผ่าน Server Action ที่ตั้ง `bodySizeLimit` ใน `next.config.ts` แล้ว

## การแตกงาน (ส่งต่อ writing-plans)

1. Schema `ProductImage.caption` + migration + backfill script
2. Server layer: `uploadProductImages`/`createPrompt`/`updateProductImageCaption`/`generateWithAI`
3. `lib/gemini.ts` interleave + `lib/prompt-template.ts` (productName + Product Accuracy) + `lib/few-shot.ts` signature
4. Form UX: `brief-form.tsx` + `prompt-workspace.tsx` (caption ต่อรูป, ถอด label ลอย)
5. Verify ก่อน-หลัง (สินค้าง่าย+ยาก) + build/lint

## Git

แตก branch ใหม่จาก `master`: `feature/image-caption-binding`
