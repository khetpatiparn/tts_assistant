# Gemini & prompt generation (ปุ่ม "สร้างด้วย AI", Core Prompt, angle)

ครอบคลุม: `lib/gemini.ts`, `lib/prompt-template.ts`, `lib/few-shot.ts`, `lib/caption.ts`, `lib/angle.ts`, `generateWithAI`/`saveAngle`/`suggestAngleOptions`/`duplicatePrompt` ใน `app/actions.ts`, ตาราง `CorePrompt`, หน้า `/core-prompt`, `components/angle-panel.tsx` · สเปกผลิตภัณฑ์เต็ม: `requirements/req1.md`

## ผลลัพธ์ที่ต้องได้: 10-part prompt (จาก `requirements/req1.md`)

The generated output must follow a strict 10-part structure: Style, Scene, Subject, Product Accuracy, Action Timeline, Camera, Framing, Lighting/Color, Negative Prompt, Quick QA Checklist. Target generator: "Gemini Flow" (Google Flow). Input = the Core Prompt template filled with reference product photos + shop info + "Product Risk Module" + extra notes. Content rules to preserve in prompt-generation logic:
- The video carries no on-screen text/subtitles/labels/UI overlays/prices.
- Thai voiceover only, 3–5 short phrases, ~30–35 words max total, with a hook in the first 1–2 seconds and no dead air.
- Product appears within 1–2 seconds with clear movement.
- 3–4 visual beats for higher-risk/mechanism products (e.g. foldable/expandable items), 4–5 beats for lower-risk products, sized for a 10-second clip.
- Liquid products (fabric softener, dish soap, etc.) use "package-led UGC" (package as hero, before/after style) instead of showing liquid, since real liquid reference photos are usually unavailable.

## SDK `@google/genai`

- SDK คือ `@google/genai` (ไม่ใช่ `@google/generative-ai` ตัวเก่า) · `lib/gemini.ts` เป็นไฟล์เดียวที่รู้จัก SDK
- **API ใช้ snake_case:** `system_instruction` (camelCase `systemInstruction` ถูกเมินเงียบๆ) และ `temperature` อยู่ใน `generation_config` — สะกดผิด API ไม่ error แต่ Core Prompt ไม่ถูกส่งไปเลย · ยึด shape จาก `CreateModelInteraction` ใน `node_modules/@google/genai/dist/genai.d.ts` และให้ type ตรวจได้จริง (ไม่ใช้ `as any`)
- **รายชื่อโมเดลอยู่ที่ `GEMINI_MODELS` (`lib/gemini.ts`) ที่เดียว** — dropdown สร้างจากตัวนี้ และ Server Action validate ด้วยตัวนี้ (โมเดลจาก client เชื่อไม่ได้) · ตอนนี้: `gemini-3.1-flash-lite` (default, ~15 วิ) กับ `gemini-3.5-flash` (~54 วิ ยาว/ละเอียดกว่า) · โควตา free tier แยก pool ต่อโมเดล (3.5-flash มี 20 ครั้ง/วัน) ดูตัวเลขจริงที่ `https://aistudio.google.com/rate-limit`
- งานข้อความล้วนที่รันบ่อยล็อกโมเดลไว้ที่ `gemini-3.1-flash-lite` เสมอ: `CAPTION_MODEL`, `EXTRACT_MODEL`, `ANGLE_MODEL` (และย่อชื่อสินค้าของ Showcase)
- อัปโหลดรูปวิ่งผ่าน Server Action ซึ่งจำกัด body 1MB by default → ขยายที่ `experimental.serverActions.bodySizeLimit` ใน `next.config.ts` (ไม่ใช่ที่ action)

## Pipeline ของ `generateWithAI(entryId, model)` — 3 ขั้นใน action เดียว

`lib/few-shot.ts` เลือกตัวอย่างเก่ามา 2 อัน · ผลบันทึกลง `chatgptOutput`

0. **สกัดสเปกสินค้าจากรูป** (`extractProductSpec`) → `PromptEntry.productSpec` — **สกัดเฉพาะเมื่อ `productSpec` ว่าง** เพราะผู้ใช้แก้สเปกด้วยมือได้ในแผงของ UI · ใช้โมเดลที่ผู้ใช้เลือก (งาน vision ครั้งเดียวต่อสินค้า จึงไม่ล็อก flash-lite) · ขั้นนี้ throw ได้ ให้ทั้ง action ล้ม
1. **รูป + บรีฟ + Core Prompt + สเปก → 10-part prompt** ด้วยโมเดลที่ผู้ใช้เลือก (`generateTenPartPrompt`) — **บันทึกลง DB ก่อนเริ่มขั้น 2 เสมอ**
   - รูปกับ caption ส่งแบบ interleave: caption ของรูปตามด้วยรูปนั้นทันทีทีละคู่ (ไม่รวม label เป็นก้อนแล้วตามด้วยรูปทั้งหมด) — กันโมเดลนับตำแหน่งผิด (เคยพังกับสินค้าไม่สมมาตร เช่น logo อยู่ด้านเดียว)
2. **10-part prompt (ข้อความล้วน ไม่ส่งรูป) + SEO Prompt → Caption/Hashtags** ด้วย `CAPTION_MODEL` — **ขั้นนี้คืน `{ captionError }` แทนการ throw** (throw ก่อน `revalidatePath` = หน้าเว็บไม่เห็น 10-part prompt ที่บันทึกไปแล้ว) · `lib/caption.ts` แยก caption/hashtags ถ้าโมเดลตอบผิดฟอร์แมตยัดทั้งก้อนลง caption (ไม่ทิ้งของ)

## `buildPromptText` (`lib/prompt-template.ts`)

- **มี 3 call sites: `app/actions.ts`, `components/entry-workspace.tsx`, `lib/few-shot.ts`** — เปลี่ยน signature (เช่น `productSpec`, `angle`) ต้องแก้ทั้ง 3 จุดพร้อมกัน · `getFewShotExamples` ส่ง `angle: ""` เสมอ (golden examples ไม่มี angle)
- **`angle` ว่าง → output เหมือนก่อนมีฟีเจอร์ angle ทุกตัวอักษร** — entry เดิมทั้งหมด (55 ตัว) ไม่มี angle จึงพึ่งพฤติกรรมนี้ ความเบี่ยงเบนตรงนี้คือ regression จริง · angle ไม่ว่าง → เพิ่มบล็อกสั่งใช้ angle นั้นแทนให้โมเดลเลือกเอง
- **บล็อกสเปกสั่งให้บรรยายพื้นผิว/กลไกเต็มที่ทุกสินค้า** — ถอดเงื่อนไข "ตามระดับความเสี่ยงของสินค้า" และคำว่า "ไม่ต้องยัดเยิน" ออกถาวรโดยตั้งใจ: เงื่อนไขความเสี่ยงทำให้โมเดลข้ามการบรรยายสินค้าที่ดูเรียบง่าย และ "ไม่ต้องยัดเยิน" บีบสเปกละเอียดให้ย่อจนขาดรายละเอียดสำคัญ อย่าใส่สองอย่างนี้กลับ
- **กฎความแม่นยำที่ต้องปรับจูนบ่อย (ห้ามคำกำกวม, ต้องระบุพื้นผิว/กลไกเสมอ ฯลฯ) อยู่ใน Core Prompt ในฐานข้อมูล** — แก้ที่หน้า `/core-prompt` ได้ทันทีไม่ต้อง rebuild · โค้ดเก็บเฉพาะสิ่งที่ลบถาวร (ข้อบน) · เนื้อหาตั้งต้นของกฎชุดนี้: `prisma/seed/core-prompt-v8.md` (ก่อนมีชุดนี้ ข้อความที่บรรยายสินค้าจริง (ข้อ 3+4) เฉลี่ยแค่ 20.7% ของพรอมต์ ที่เหลือเป็น boilerplate สไตล์/ฉาก/กล้อง)

## Core Prompt (ตาราง `CorePrompt`)

- เก็บแบบมีเวอร์ชัน แยกชนิดด้วย `kind`: `core` (สร้างวิดีโอ) กับ `caption` (SEO prompt) · **active ได้ทีละอันต่อ kind** (บังคับผ่าน transaction ใน `app/actions.ts`) · สร้าง `PromptEntry` ใหม่ระบบผูกเวอร์ชัน `core` ที่ active ให้อัตโนมัติ
- **ทุก query ที่เขียนหรืออ่าน `isActive: true` ใส่ `kind` ใน `where` เสมอ** (`findFirst({ where: { isActive: true, kind: "core" } })`) — ไม่ใส่ = เพิ่มเวอร์ชันฝั่งหนึ่งไปปิด active อีกฝั่ง / อ่านได้แถวมั่วเมื่อ 2 kind active พร้อมกัน (เคยพังเงียบใน `generateWithAI` และ `createPrompt`)
- SEO prompt ตั้งต้นอยู่ `prisma/seed/seo-prompt-v1.md` · seed ด้วย `node prisma/seed/seed-seo-prompt.mjs` (idempotent)

## Angle (`PromptEntry.angle`, `lib/angle.ts`)

- `angle` (`String @default("")`) เก็บแนวคลิปที่เลือก · ค่าว่าง = ยังไม่ได้เลือก (entry ก่อนฟีเจอร์นี้เป็นค่านี้หมด) · `lib/angle.ts` เป็นไฟล์เดียวที่รู้จักตรรกะ angle
- **"สินค้าเดียวกัน" = สายเลือด `duplicatedFromId` (`collectFamily`) เท่านั้น** — `dev.db` จริงมี entry ชื่อ `"ที่ลับเล็บแมว"` ซ้ำหลายอันที่เป็นสินค้าคนละชิ้น จับด้วย `productName` จะเอา angle ของสินค้าอื่นมาปน
- `collectUsedAngles` ข้าม "ร่างเปล่า" (ยังไม่ลงคลิป + ยังไม่ตั้ง angle) เพราะ `duplicatePrompt` ก๊อป `chatgptOutput` ของต้นฉบับมาด้วย ร่างที่ยังไม่ regenerate จะถูกอ่านว่าใช้ angle เดิมไปแล้ว
- **`duplicatePrompt` ก๊อป `productSpec` แต่ให้ entry ใหม่เริ่มด้วย `angle` ว่างเสมอ** (ตั้งใจตรงข้ามกัน มีคอมเมนต์กำกับตรง `data: {...}` ใน `app/actions.ts`): ทำซ้ำคือสินค้าตัวเดิม สเปกไม่เปลี่ยน · คลิปที่ทำซ้ำต้องได้ angle ใหม่ — หัวใจของ angle tracking (อย่าเพิ่ม `angle: source.angle`)
- ช่อง angle บันทึกผ่าน Server Action ของตัวเอง `saveAngle(entryId, angle)` ตอน blur (แบบเดียวกับ `updateProductImageCaption`) ไม่ผ่านฟอร์ม Brief — เพราะ `generateWithAI` อ่าน `angle` จาก DB
- `suggestAngleOptions` (ปุ่ม "เสนอ angle ใหม่") ใช้ `ANGLE_MODEL`
- `components/angle-panel.tsx` แสดงวิว/ออเดอร์/รายได้ของแต่ละ angle เป็นข้อเท็จจริงล้วน ไม่จัดอันดับ ไม่ชี้ว่า angle ไหนดีกว่า — คลิปทดสอบต่อสินค้ามีแค่ 1–3 ตัว แยกผลจริงกับดวงไม่ได้

## เมื่อ Gemini ใช้ไม่ได้

- เส้นทาง manual (คัดลอก prompt ไปวางในแชทเอง แล้ว paste คำตอบกลับ) ใช้ได้เสมอ — fallback ตอน API ล่มหรือโควตาหมด
- **safety classifier ของ Gemini ปฏิเสธรูปปกติได้** — error 400 `"Input blocked: ... Prohibited Use policy"` กับรูปที่มีองค์ประกอบเด็ก/ของเล่น (เช่นชั้นเก็บของจัดฉากห้องเด็ก) เป็น false positive ไม่ใช่บั๊กโค้ด · ให้ผู้ใช้ลองรูปอื่น/ถอดรูปที่สงสัย หรือใช้เส้นทาง manual
- `GEMINI_API_KEY` อยู่ใน `.env` (กฎของ `.env` อยู่ใน CLAUDE.md)

## ช่องว่างที่รู้แล้วแต่ยังไม่ทำเป็นกฎ (รอยืนยันอีก 1–2 เคส, n=1)

- **caption ของรูปไม่ได้ใช้เลือกกลไกที่จะโชว์** (2026-07-28) — `lib/prompt-template.ts` ใช้ caption แค่กันบรรยายผิดด้าน · สินค้ามีกลไกซ้อน (เช่น "กล่องเก็บตะเกียบติดผนัง": ฝาบนบานพับ + ช่องหน้าเปิดเฉียง) แม้ผู้ใช้ถ่ายเน้น action เดียว (caption ซ้ำ) โมเดลก็เลือก use case เองและเลือกผิดได้จริง (ทดสอบใน Flow) · วิธีแก้มือที่ยืนยันแล้ว: เขียน 10-part prompt เอง เลือก action ตาม caption ที่ผู้ใช้เน้นซ้ำ + กฎ "ห้ามรวมกลไกทั้งสองเป็นอันเดียวกัน" · รายละเอียดใน auto-memory `project_caption_driven_mechanism_selection.md`
- **ขีดจำกัดการเรนเดอร์ของ Flow ที่แก้ด้วยพรอมต์ไม่ได้** (2026-07-28, "ขวดน้ำเก็บอุณหภูมิ Honey Lion") — กลไกเล็กหลายชิ้นสีต่างกันอัดในพื้นที่แคบ (ฝาเปิดเผยวงแหวนเขียว+ซีลเทา+จุกดื่มชมพู) เรนเดอร์ผิดทั้ง 4 รอบแม้ (1) ครอปรูปให้ชัด (2) ตัดรูปที่ขัดแย้ง (3) บรรยายซ้ำหลายหัวข้อ (4) สั่งห้ามเจาะจงผลผิด · **diagnostic:** ลองครบทั้งฝั่งรูปและฝั่งข้อความแล้วยังพังเหมือนเดิม → เลิกแก้พรอมต์ ออกแบบ Action Timeline ใหม่ให้เลี่ยงสถานะที่มีปัญหา (เคสนี้ตัด action "เปิดฝา" ใช้แค่สถานะปิด) · ยังไม่ทำกฎ auto-detect เพราะเสี่ยง overfit
