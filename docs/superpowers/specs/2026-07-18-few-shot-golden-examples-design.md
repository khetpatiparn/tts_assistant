# Few-shot Golden Examples — แก้ปัญหา output drift — Design

วันที่: 2026-07-18 · สถานะ: อนุมัติแล้ว (brainstorming เสร็จ)

## ปัญหา

คลิปที่เจนจากแอปเริ่มมีอาการที่ไม่เคยเจอมาก่อน โผล่ถี่ขึ้นเรื่อยๆ:

1. **มีโลโก้/watermark TikTok ติดมาในวิดีโอ** ทั้งที่ Core Prompt สั่งห้าม watermark อยู่แล้ว
2. **เสียง voice-over สลับเพศ** (ชายบ้างหญิงบ้าง) ทั้งที่ต้องการเสียงผู้หญิงเสมอ

## Root cause (ยืนยันจาก dev.db แล้ว)

`lib/few-shot.ts` ดึง **2 entry ล่าสุด** ที่มี `chatgptOutput` มาเป็นตัวอย่างสอนโมเดลทุกครั้งที่กด
"สร้างด้วย AI" — ตัวอย่างพวกนี้คือ output ที่ "โมเดลเจนออกมาเอง" ก่อนหน้านี้

พอมี output หนึ่งบังเอิญหลุด (เช่น Negative Prompt section ไม่มี clause ห้าม watermark
เพราะ temperature สุ่ม) → มันกลายเป็นตัวอย่างของ entry ถัดไปทันที → โมเดลเลียนแบบฟอร์แมตที่
"ไม่มี clause นั้น" → entry ถัดไปก็ยิ่งไม่มี → **เป็นวงจรไล่ตัวเองออก (self-reinforcing drift)**
ทีละสเต็ป จนตอนนี้ทุก entry ล่าสุดไม่เหลือ clause ห้าม watermark แล้ว

ตรวจ Negative Prompt section ของ chatgptOutput จริงยืนยันชัด:
- entry ก่อน 2026-07-16 บ่าย (ที่ลับเล็บแมว, หมอนสุขภาพ): **มี** `"watermark เพิ่ม"` clause
- entry ตั้งแต่ 2026-07-16 14:47 เป็นต้นมา (Osttech อาหารแมว, หม้อสตูว์, กระทะ, รถเข็น,
  ที่นอนแมว, กระดาษรองกรง): **ไม่มี** clause นี้เลยสักตัว

Core Prompt (system instruction) กับ `lib/prompt-template.ts` **ไม่เคยถูกแก้เลย** ตั้งแต่ต้นโปรเจกต์
รูปอ้างอิงก็เป็นรูปถ่ายเปล่า 100% เสมอ — ปัจจัยเดียวที่เปลี่ยนคือ **ตัวอย่าง few-shot ที่หมุนตาม
output ที่เพี้ยน** นี่คือ model-eating-its-own-output ย่อส่วน

### กลไก watermark เพิ่มเติม (จากการทดลองของผู้ใช้)

ผู้ใช้ทดลองเอง: แก้คำว่า "TikTok Shop" → "วิดีโอสั้น" ในข้อความ 10-part output ที่วางเข้า
Gemini Flow แล้ว **โลโก้ TikTok หายไป 2/2 คลิป**

อธิบายได้: โมเดลวิดีโอ (Gemini Flow) เห็นแค่ 10-part output เท่านั้น ไม่เคยเห็น Core Prompt
พอในข้อความมีคำว่า "TikTok" โมเดลที่เทรนจากคลิป TikTok จริง (ซึ่งส่วนใหญ่มี watermark ติด) จึง
ตีความว่า "ทำคลิป TikTok" = "ทำคลิปที่มี UI ของ TikTok ติด" — คำว่า TikTok เป็น **positive
trigger** ของ watermark การลบคำออก = ตัดต้นเหตุ ซึ่งแรงกว่าคำสั่งเชิงลบ ("ห้ามมี watermark")
เพราะโมเดลมักทำพลาดกับคำสั่งเชิงลบ

## เป้าหมาย

ตัดวงจร drift ให้ output กลับมานิ่ง (ฟอร์แมต + กฎบ้านสม่ำเสมอทุกคลิป) โดย**ไม่ลด**ความหลากหลาย
ของเนื้อหาสร้างสรรค์ และให้ manual งานน้อยที่สุด (ตั้งค่าครั้งเดียว ใช้ตลอด)

## แนวทางที่เลือก: Golden examples แช่แข็งในไฟล์ + สุ่มหยิบ

แทนที่จะดึง "2 entry ล่าสุด" (ซึ่งหมุนตาม output ที่อาจเพี้ยน) → ใช้ชุดตัวอย่างที่**คัดแล้ว
ว่าดี แช่แข็งไว้ในไฟล์** แล้วสุ่มหยิบมาใช้

- **drift-immune 100% by construction** — กองตัวอย่างไม่หมุนตาม output ใหม่ ของที่เพี้ยน
  ไม่มีทางแอบเข้ากอง
- **แก้ทั้งคลาส ไม่ใช่แค่ watermark** — ถ้าตัวอย่าง golden มีเสียงผู้หญิง + clause ห้าม watermark
  ครบ + ใช้คำ "วิดีโอสั้น" ทุกเรื่องถูก anchor พร้อมกัน
- **manual = ศูนย์แบบต่อเนื่อง** — คัดครั้งเดียว ต่อให้เพิ่มคลิปเป็นร้อย กองก็ยังเป็นชุดเดิม
- **ขัดตัวอย่างให้เพอร์เฟกต์ได้** — เพราะเป็น text แช่แข็ง ไม่ใช่ output ดิบ จึงแก้ให้เป็น
  มาตรฐานทองได้ (สิ่งที่ mark-ของจริง-ใน-DB ทำไม่ได้)

### ความหลากหลายไม่หาย (แยก 3 ชนิด)

- **เนื้อหาสร้างสรรค์** (hook/ซีน/คำพูด VO/use case) — มาจาก **brief + รูปสินค้าจริง** ของแต่ละ
  entry ซึ่ง unique ทุกตัว → golden set ไม่แตะ → ยังต่างกันทุกคลิป
- **โทน/สไตล์การใช้คำ** — แก้ด้วยการมี **กอง 5-6 อัน แล้วสุ่มหยิบ 3** ต่อครั้ง → เห็น anchor
  สไตล์ต่างกันไปเรื่อยๆ ไม่ homogenize
- **ฟอร์แมต/กฎบ้าน** (โครง 10 ส่วน/ห้าม watermark/เสียงผู้หญิง/ไม่มีข้อความบนจอ) — อันนี้
  *อยาก*ให้เหมือนกันทุกคลิป และเป็นสิ่งที่ few-shot ล็อกให้

## ขอบเขต

### สิ่งที่แก้ (แทร็กโค้ด)

- **`lib/few-shot.ts`** — เปลี่ยนแหล่งตัวอย่าง: จาก Prisma query "2 ล่าสุด" → สุ่ม
  `min(3, poolSize)` อันจากกอง golden ที่ import จากไฟล์ใหม่ ยังคง signature เดิม
  (`getFewShotExamples(excludeEntryId): Promise<{ brief; output }[]>`) เพื่อไม่กระทบ caller
  ใน `app/actions.ts`
- **ไฟล์ golden ใหม่** — เก็บ 5-6 ตัวอย่างที่คัดจาก entry ก่อนช่วง drift (ที่ลับเล็บแมว,
  หมอนสุขภาพ, คอนโดแมว ฯลฯ — พวกที่ยังมี clause ห้าม watermark ครบ) แต่ละอันเก็บ input fields
  (`productInfo`, `riskModule`, `extraNotes`, `images`) + `output` ที่ **ขัดจนเพอร์เฟกต์**:
  - คำ identity เป็น "วิดีโอสั้น" (ไม่ใช่ "TikTok Shop")
  - Negative Prompt มี clause ห้าม watermark/UI แอปโซเชียล ครบ (ไม่เอ่ยชื่อ TikTok)
  - บทพากย์เป็นเสียงผู้หญิง

### สิ่งที่ไม่แตะ (ยืนยันกับผู้ใช้แล้ว)

- **input form** — กรอกเหมือนเดิมทุกอย่าง
- **output format 10 ส่วน** — โครงสร้างเดิมเป๊ะ ไม่เปลี่ยนชนิดของ output
- **Core Prompt content** — โค้ด B2 ไม่แตะ (system instruction คนละส่วนกับ few-shot)
- **`lib/gemini.ts`, `lib/prompt-template.ts`** — ไม่แตะ

### แทร็ก manual (ผู้ใช้ทำเองในแอป แท็บ ③ Core Prompt — นอกขอบเขตโค้ด)

แก้ Core Prompt 3 จุด ให้ system instruction ชี้ทางเดียวกับ golden examples:
1. บรรทัด identity "TikTok Shop" → "วิดีโอสั้น"
2. เพิ่ม "เป็นเสียงผู้หญิงเสมอ" ต่อจาก "ใช้ voice-over ภาษาไทยเท่านั้น"
3. clause ห้าม watermark **แบบไม่เอ่ยชื่อ TikTok** เช่น "ห้ามมีโลโก้แอปหรือ UI ของแอปโซเชียล
   ใดๆ ในวิดีโอ" (เพราะการเอ่ยชื่อ TikTok แม้ในประโยคห้ามอาจย้อนกลับมาเป็น trigger)

> **หมายเหตุ:** แทร็ก manual นี้ไม่อยู่ในแผน implement โค้ด แต่ golden examples ที่คัดต้อง
> สอดคล้องกับมัน (วิดีโอสั้น/เสียงผู้หญิง/ห้าม watermark) เพื่อให้ทุกสัญญาณชี้ทางเดียวกัน

## รายละเอียดการออกแบบ

### รูปแบบไฟล์ golden

TS module (`lib/golden-examples.ts`) export array — import ตรง ไม่ต้องอ่านไฟล์ผ่าน fs (ทำงาน
ได้ทุก runtime ของ Next.js) เก็บ input fields แล้วให้ few-shot ประกอบ brief ผ่าน
`buildPromptText` เดิม เพื่อให้ฟอร์แมต brief ตรงกับของจริงเสมอ:

```ts
export type GoldenExample = {
  productInfo: string;
  riskModule: string;
  extraNotes: string;
  images: string[];
  output: string; // 10-part prompt ที่ขัดจนเพอร์เฟกต์แล้ว
};

export const GOLDEN_EXAMPLES: GoldenExample[] = [ /* 5-6 อัน */ ];
```

### การสุ่ม

- สุ่มแบบ shuffle-and-slice หยิบ `Math.min(3, GOLDEN_EXAMPLES.length)` อัน
- ใช้ `Math.random()` ได้ปกติ (เป็น server module ไม่ใช่ Workflow script)
- ไม่ต้องมีพารามิเตอร์ `excludeEntryId` มาเกี่ยวกับการเลือกแล้ว (golden ไม่ใช่ entry ในระบบ
  จึงไม่มีทางตรงกับตัวที่กำลังเจน) แต่คง signature ไว้เพื่อไม่ต้องแก้ caller

### จำนวน

- กอง golden: **5-6 อัน**
- สุ่มหยิบต่อครั้ง: **3 อัน** (มากกว่าเดิมที่ 2 เล็กน้อย เพื่อล็อกฟอร์แมตแน่นขึ้น — ปลอดภัย
  เพราะทุกอันในกองสะอาดหมด ไม่เพิ่มความเสี่ยง drift)

### Fallback

ไฟล์ golden ถูก commit ไปกับโค้ด จึงมีข้อมูลเสมอ ไม่ต้องมี fallback ไป query DB อีก
กันเหนียว: ถ้ากองมีน้อยกว่า 3 ให้ใช้เท่าที่มี (`Math.min`)

## Constraints (จาก CLAUDE.md)

- ไม่มี test runner — verify ด้วย `npm run build` (type-check ในตัว) + `npm run lint` +
  ทดสอบเจนจริงผ่านหน้าเว็บ (Playwright ใน scratch dir)
- ห้าม build/dev ซ้อนกับ `start.bat` ของผู้ใช้ — เช็ก port 3000 ก่อน
- `dev.db` มีข้อมูลจริง ไม่มี backup — อ่านอย่างเดียวตอนคัด golden ห้าม `DELETE`/`UPDATE`
- generated Prisma client import จาก `@/lib/generated/prisma/client` โดยตรง
- ข้อความ UI/โค้ดคอมเมนต์ภาษาไทยตามสไตล์เดิม

## การทดสอบ / verification

1. **`npm run build` + `npm run lint` สะอาด** — type ของ `GoldenExample` ตรง, `few-shot.ts`
   ยังคืน `{ brief; output }[]` เหมือนเดิม
2. **เจนคลิปจริง 1 ตัวผ่านหน้าเว็บ** แล้วตรวจ 10-part output ที่ได้:
   - Style/identity ใช้คำ "วิดีโอสั้น" ไม่มีคำ "TikTok Shop"
   - Negative Prompt มี clause ห้าม watermark/UI แอปโซเชียล
   - บทพากย์ระบุเสียงผู้หญิง
3. **เจนซ้ำ 2-3 รอบ** ยืนยันว่าตัวอย่างที่สุ่มต่างกันได้ (ความหลากหลายโทนยังอยู่) และทั้ง 3 ข้อ
   ด้านบนคงเส้นคงวาทุกรอบ (drift หาย)
4. **ข้อมูลจริงใน dev.db ไม่ถูกแตะ** — entry/order/CorePrompt ครบเท่าเดิม
5. เทียบเชิงพฤติกรรม (หลังผู้ใช้แก้ Core Prompt manual แล้ว): คลิปที่เจนใหม่ไม่มีโลโก้ TikTok
   และเสียงเป็นผู้หญิง (ยอมรับว่าเป็นพฤติกรรมโมเดลภายนอกที่คุมได้ไม่ 100% — ตั้งเป้าลดความถี่
   ให้เหลือน้อยสุด ไม่ใช่การันตีหาย)

## การแตกงาน (ส่งต่อให้ writing-plans)

1. สร้าง `lib/golden-examples.ts` — type + คัด 5-6 ตัวอย่างจาก dev.db แล้วขัดให้เพอร์เฟกต์
2. แก้ `lib/few-shot.ts` — เปลี่ยนมาสุ่มจาก `GOLDEN_EXAMPLES` (คง signature เดิม)
3. Verify — build/lint + เจนจริงตรวจ 3 เงื่อนไข

## Git

แตก branch ใหม่จาก `master`: `feature/few-shot-golden-examples`
