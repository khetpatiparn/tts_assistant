# Prompt Archive — Design

วันที่: 2026-07-11
Branch: `feature/prompt-archive`

## ปัญหา

แอปนี้เป็นแค่ส่วนหนึ่งของ workflow จริง ซึ่งเต็มๆ คือ:

```
[แอปนี้] ประกอบ meta-prompt (ข้อความ)
    ↓ paste meta-prompt + รูปสินค้าจริง
[ChatGPT] ตอบกลับเป็น 10-part prompt   ← สูตรที่กำหนดหน้าตาคลิปจริง
    ↓ paste 10-part prompt + รูปสินค้าจริง
[Google Flow (Gemini)] สร้างคลิป AI 10 วินาที 9:16
    ↓
[TikTok] ลงคลิป affiliate (ปัจจุบันลงวันละ 1 คลิป มาแล้ว ~1 เดือน)
```

ปัจจุบันแอปเก็บแค่ **input ที่ส่งให้ ChatGPT** แต่ไม่เก็บ **output ที่ ChatGPT ตอบกลับ** ทำให้:

1. **ทำซ้ำไม่ได้** — ChatGPT ไม่ deterministic เพราะฉะนั้น meta-prompt เดิมส่ง 2 ครั้งได้ 10-part prompt คนละแบบ รู้แค่ meta-prompt จึงไม่พอที่จะบอกว่าคลิปนั้นมาจากสูตรอะไร ถ้าคลิปไหนปังแล้วอยากใช้สูตรเดิมซ้ำ ก็หาไม่เจอเพราะมันอยู่ในแชทที่ scroll หายไปแล้ว
2. **เทียบไม่ได้** — ไม่มีเส้นเชื่อมว่า prompt ไหนกลายเป็นคลิปไหน จึงตอบไม่ได้ว่า "แนวทางไหนเวิร์ค"
3. **Core prompt ไม่ได้อยู่ในระบบเลย** — ปัจจุบันแปะครั้งเดียวตอนเปิดแชท ChatGPT ใหม่ ผ่านมา 4 เวอร์ชันแล้ว และมีแนวโน้มจะเปลี่ยนอีก พอเปลี่ยนเป็น v5 ข้อมูลเก่าจะเทียบกับของใหม่ไม่ได้ทันทีเพราะไม่รู้ว่า entry ไหนใช้เวอร์ชันอะไร

## ขอบเขต: เก็บเฉพาะสิ่งที่กู้คืนไม่ได้

หลักการตัดสินใจคือ **เก็บสิ่งที่ย้อนกลับไปหาไม่ได้ ส่วนที่หาย้อนหลังได้ให้รอไปก่อน**

**กู้คืนไม่ได้ → ต้องเก็บเดี๋ยวนี้**
- 10-part prompt ที่ ChatGPT ตอบ (ฝังอยู่ในแชท หายได้)
- เส้นเชื่อม prompt → คลิป (ไม่มีใครจดไว้ที่ไหน)
- Core prompt แต่ละเวอร์ชัน + entry ไหนใช้เวอร์ชันไหน

**หาย้อนหลังได้ → รอได้**
- ยอดวิวบนหน้าคลิป (อยู่ตลอด ย้อนดูเมื่อไหร่ก็ได้) — เก็บเป็นช่องเดียวแบบกรอกเมื่อไหร่ก็ได้ ไม่มีกำหนด

**ยังไม่ทำใน phase นี้**
- Analytics ละเอียดของ TikTok (traffic source, คำค้นหา, retention) — **หมายเหตุสำคัญ: ข้อมูลพวกนี้หมดอายุ ~21 วันหลังลงคลิป ถ้าจะเก็บต้องเก็บภายในหน้าต่างนั้น** แต่ตอนนี้ยังไม่รู้ว่าจะวัดอะไร การไล่เก็บโดยไม่รู้เป้าหมายจะเหนื่อยและอาจเก็บผิดตัว ให้ตัดสินใจเรื่องนี้ทีหลังเมื่อรู้ชัดว่าจะวัดอะไร
- Dashboard / กราฟ / การวิเคราะห์อัตโนมัติ — ไม่มีประโยชน์จนกว่าจะมี label ว่าอะไรเวิร์ค
- Vector DB / RAG / fine-tuning — ที่ระดับ ~100 entry ข้อมูลทั้งหมดยัดเข้า context LLM ได้ในทีเดียว (ราว 400KB) ยังไม่จำเป็น และทุกเทคนิคเหล่านี้ต้องการ label ว่าตัวอย่างไหนดี ซึ่งยังไม่มี
- เรียก ChatGPT/Gemini ผ่าน API — แก้ปัญหา "ขี้เกียจ paste" ซึ่งเป็นปัญหาเล็ก ไม่ได้แก้ปัญหา "ไม่รู้ว่ามาถูกทางไหม" ซึ่งเป็นปัญหาใหญ่

## โครงสร้างข้อมูล

```prisma
model CorePrompt {
  id        String   @id @default(cuid())
  label     String   // เช่น "v4"
  content   String   // ข้อความ core prompt เต็ม
  isActive  Boolean  @default(false)  // เวอร์ชันที่ใช้อยู่ตอนนี้ (active ได้ทีละอัน)
  createdAt DateTime @default(now())
  entries   PromptEntry[]
}

model PromptEntry {
  // --- ของเดิม ---
  id          String   @id @default(cuid())
  productName String
  productInfo String
  riskModule  String
  extraNotes  String
  images      String
  createdAt   DateTime @default(now())

  // --- เพิ่มใหม่ ---
  corePromptId   String?      // ผูกว่าใช้ core prompt เวอร์ชันไหน
  corePrompt     CorePrompt?  @relation(fields: [corePromptId], references: [id])
  chatgptOutput  String   @default("")  // 10-part prompt ที่ ChatGPT ตอบ
  videoUrl       String   @default("")  // ลิงก์คลิป TikTok
  views          Int?                    // ยอดวิว (ว่างได้)
  viewsUpdatedAt DateTime?               // บันทึกยอดวิวเมื่อไหร่ (รู้ว่าตัวเลขเก่าแค่ไหน)
}
```

ฟิลด์ใหม่ทั้งหมด optional/มี default เพื่อให้ entry เดิมที่มีอยู่ไม่พัง และเพื่อให้ backfill คลิปเก่าได้แบบทยอยทำ ไม่ต้องกรอกครบ

ตอนกด "สร้าง Prompt" ระบบผูก core prompt ที่ `isActive = true` ให้อัตโนมัติ ผู้ใช้ไม่ต้องเลือกเอง

## หน้าจอ

หน้าเดิมเริ่มยาว การใส่คอลัมน์ที่ 3 จะทำให้แต่ละคอลัมน์แคบเกินไปสำหรับ 10-part prompt ซึ่งเป็นข้อความยาว จึงใช้ **แท็บบน header** แทน — เหมาะกับ workflow จริงที่แต่ละแท็บทำคนละช่วงเวลากันอยู่แล้ว

```
┌──────────────────────────────────────────────────────────┐
│ 🎬 Pooling Prompt              [ TAKE 02 · หมอนรองคอ ]    │
│ [ ① Brief & Script ] [ ② ผลลัพธ์ & คลิป ] [ ③ Core Prompt ]│
├─────────┬────────────────────────────────────────────────┤
│ Sidebar │  เนื้อหาตามแท็บที่เลือก                          │
│  T03    │                                                │
│  T02    │                                                │
└─────────┴────────────────────────────────────────────────┘
```

- **แท็บ ① Brief & Script** — ของเดิมทั้งหมด (BriefForm ซ้าย / ScriptOutput ขวา) ไม่แก้อะไร
- **แท็บ ② ผลลัพธ์ & คลิป** — เต็มความกว้าง: textarea ใหญ่สำหรับ 10-part prompt จาก ChatGPT, ช่องลิงก์ TikTok, ช่องยอดวิว (แสดงว่าอัปเดตล่าสุดเมื่อไหร่), ปุ่มบันทึก
- **แท็บ ③ Core Prompt** — ลิสต์เวอร์ชันทั้งหมด, ปุ่มเพิ่มเวอร์ชันใหม่, เลือกว่าอันไหน active

Sidebar แสดงตลอดทุกแท็บ เพื่อให้เลือก entry เก่าแล้วสลับไปแท็บ ② เติมผลลัพธ์ได้ทันที

แท็บ ② กดไม่ได้ (disabled) ถ้ายังไม่ได้เลือก entry ที่บันทึกแล้ว เพราะยังไม่มีอะไรให้ผูกผลลัพธ์เข้าไป

## ไฟล์

**แก้ไข**
- `prisma/schema.prisma` — เพิ่ม `CorePrompt`, เพิ่มฟิลด์ใน `PromptEntry`
- `app/actions.ts` — เพิ่ม `updateProduction()`, `createCorePrompt()`, `setActiveCorePrompt()`; `createPrompt()` ผูก active core prompt
- `app/page.tsx` — ดึง `corePrompts` เพิ่มจาก DB
- `components/prompt-workspace.tsx` — เพิ่ม state แท็บ, ย้ายเนื้อหาเดิมไปใต้แท็บ ①
- `components/clapper-header.tsx` — เพิ่มแถบแท็บ

**สร้างใหม่**
- `components/production-panel.tsx` — แท็บ ②
- `components/core-prompt-panel.tsx` — แท็บ ③

ใช้ design token / component เดิมทั้งหมด (`Button`, `Input`, `Textarea`, สี `ink`/`paper`/`marigold`/`rust`) ไม่เพิ่มสีหรือฟอนต์ใหม่

## การทดสอบ

ไม่มี test runner ในโปรเจกต์ ใช้วิธีเดิมคือรันจริง:

1. `npm run build` (type-check ในตัว) + `npm run lint`
2. `npx prisma migrate dev` แล้ว `npx prisma generate`
3. ขับผ่าน Playwright (ติดตั้งใน scratch dir):
   - เพิ่ม core prompt v4 → ตั้งเป็น active
   - สร้าง entry ใหม่ → เช็กว่า `corePromptId` ผูกกับ v4 อัตโนมัติ
   - สลับไปแท็บ ② → กรอก 10-part prompt + ลิงก์ + ยอดวิว → บันทึก
   - รีโหลดหน้า → เลือก entry เดิมจาก sidebar → ข้อมูลผลลัพธ์ยังอยู่ครบ
   - เช็ก entry เดิมที่สร้างก่อน migration ว่ายังเปิดได้ปกติ (ฟิลด์ใหม่ว่าง)
   - ไม่มี console error
