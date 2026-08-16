import { GoogleGenAI } from "@google/genai";

/**
 * The only models the app may call. Both were validated against the real product
 * photos: each returns all 10 sections and describes the photographed product
 * accurately. Their free-tier quotas are separate pools, so offering both roughly
 * doubles daily capacity. The first entry is the default.
 */
export const GEMINI_MODELS = [
  { id: "gemini-3.1-flash-lite", label: "เร็ว (500/วัน)" },
  { id: "gemini-3.5-flash", label: "ละเอียด (20/วัน)" },
] as const;

export type GeminiModelId = (typeof GEMINI_MODELS)[number]["id"];

export function isGeminiModelId(value: string): value is GeminiModelId {
  return GEMINI_MODELS.some((model) => model.id === value);
}

export type GeminiImage = { base64: string; mimeType: string; caption: string };

export async function generateTenPartPrompt(args: {
  model: GeminiModelId;
  systemInstruction: string;
  examples: { brief: string; output: string }[];
  brief: string;
  images: GeminiImage[];
}): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("ยังไม่ได้ตั้งค่า GEMINI_API_KEY ในไฟล์ .env");
  }

  const client = new GoogleGenAI({ apiKey });

  const input: object[] = [];

  // Few-shot first: completed brief -> output pairs teach the exact format.
  for (const [index, example] of args.examples.entries()) {
    input.push({
      type: "text",
      text:
        `### ตัวอย่างที่ ${index + 1} — โจทย์\n${example.brief}\n\n` +
        `### ตัวอย่างที่ ${index + 1} — คำตอบที่ถูกต้อง\n${example.output}`,
    });
  }

  // Then the real task, then each photo immediately preceded by its caption so the
  // model binds "รูปที่ N = this side" instead of guessing by position.
  input.push({ type: "text", text: `### โจทย์จริง\n${args.brief}` });
  for (const [index, image] of args.images.entries()) {
    input.push({
      type: "text",
      text: `รูปที่ ${index + 1}${image.caption ? ` — ${image.caption}` : ""}`,
    });
    input.push({ type: "image", data: image.base64, mime_type: image.mimeType });
  }

  const response = await client.interactions.create({
    model: args.model,
    // snake_case is correct. The web docs show `systemInstruction`, which the API
    // ignores in silence — the Core Prompt would never reach the model and nothing
    // would error. Verified against CreateModelInteraction in the SDK's own types.
    system_instruction: args.systemInstruction,
    generation_config: { temperature: 0.3 },
    input,
  });

  const text = response.output_text;
  if (!text || text.trim() === "") {
    throw new Error("AI ไม่ได้ตอบกลับ ลองใหม่อีกครั้ง");
  }
  return text;
}

/**
 * Caption ถูกล็อกไว้ที่โมเดลเร็วเสมอ ไม่ตามที่ผู้ใช้เลือกใน dropdown:
 * โควตา free tier แยกคนละ pool และ gemini-3.5-flash มีแค่ 20 ครั้ง/วัน — การจ่าย
 * โควตานั้นไปกับงานเขียนข้อความล้วนจะเหลือคลิปทำได้แค่ครึ่งเดียวโดยไม่ได้อะไรกลับมา
 */
export const CAPTION_MODEL: GeminiModelId = "gemini-3.1-flash-lite";

export async function generateCaptionAndHashtags(args: {
  systemInstruction: string;
  tenPartPrompt: string;
}): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("ยังไม่ได้ตั้งค่า GEMINI_API_KEY ในไฟล์ .env");
  }

  const client = new GoogleGenAI({ apiKey });

  const response = await client.interactions.create({
    model: CAPTION_MODEL,
    // snake_case — camelCase จะถูก API เมินแบบเงียบๆ แล้ว SEO prompt จะไม่ไปถึงโมเดลเลย
    system_instruction: args.systemInstruction,
    generation_config: { temperature: 0.3 },
    input: [
      {
        type: "text",
        text: `### Video Prompt\n${args.tenPartPrompt}\n\n### Output Mode\nready_to_post`,
      },
    ],
  });

  const text = response.output_text;
  if (!text || text.trim() === "") {
    throw new Error("AI ไม่ได้ตอบกลับตอนสร้าง Caption");
  }
  return text;
}

/**
 * งานสกัดข้อความจากแคปหน้าสินค้าล็อกที่โมเดลเร็วเสมอ เหตุผลเดียวกับ CAPTION_MODEL:
 * เป็นงานอ่านข้อความล้วน ไม่ควรจ่ายโควตาโมเดลละเอียด (20/วัน) ให้งานที่ flash-lite (500/วัน) ทำได้
 */
export const EXTRACT_MODEL: GeminiModelId = "gemini-3.1-flash-lite";

// ชื่อสินค้าให้สรุปสั้น — ชื่อบนหน้าร้านเป็นชื่อ SEO ยาวเหยียด ถ้าใส่ตรงๆ sidebar/หัวคลิปจะรก
// (ชื่อเต็มไม่หาย: ถูกเก็บไว้ที่บรรทัดแรกของรายละเอียด) ส่วนรายละเอียดให้คงบรรทัด/หัวข้อ
// ตามภาพ ไม่ใช่ยุบเป็นก้อนเดียว — อ่านตรวจในฟอร์มง่ายกว่า
const EXTRACT_INSTRUCTION = `คุณคือผู้ช่วยสกัดข้อความจากภาพแคปหน้าจอสินค้า TikTok Shop
อ่านทุกภาพที่แนบมา แล้วตอบกลับในรูปแบบนี้เท่านั้น:

ชื่อสินค้า: <ชื่อเรียกสินค้าแบบสั้นกระชับ 2-5 คำ สรุปจากชื่อเต็มในภาพ เช่น "ของเล่นสกุชชี่ขนมปัง" ไม่เอาชื่อ SEO ยาวทั้งพวง>
รายละเอียดสินค้า: <ชื่อเต็มของสินค้าตามภาพ 1 บรรทัด ตามด้วยรายละเอียด/คำอธิบายทั้งหมดที่อ่านได้จากภาพ โดยคงการขึ้นบรรทัดและหัวข้อย่อยตามที่เห็นในภาพ>

กติกา: คัดลอกข้อความตามที่เห็นจริงในภาพ ใช้ภาษาเดิมตามภาพ ไม่แต่งเติม ไม่ใส่ความเห็น
ห้ามสรุปย่อหรือตัดเนื้อหาในส่วนรายละเอียด (มีข้อยกเว้นเดียวคือชื่อสินค้าที่ให้สรุปสั้น)
ถ้าข้อความบางส่วนถูกตัดขอบภาพ ให้ใส่เท่าที่อ่านได้`;

export async function extractProductFields(args: {
  images: GeminiImage[];
}): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("ยังไม่ได้ตั้งค่า GEMINI_API_KEY ในไฟล์ .env");
  }

  const client = new GoogleGenAI({ apiKey });

  const input: object[] = [];
  for (const image of args.images) {
    input.push({ type: "image", data: image.base64, mime_type: image.mimeType });
  }

  const response = await client.interactions.create({
    model: EXTRACT_MODEL,
    // snake_case — camelCase จะถูก API เมินแบบเงียบๆ (ดูคอมเมนต์ใน generateTenPartPrompt)
    system_instruction: EXTRACT_INSTRUCTION,
    // temperature 0 — งานคัดลอกข้อความ ไม่ใช่งานสร้างสรรค์
    generation_config: { temperature: 0 },
    input,
  });

  const text = response.output_text;
  if (!text || text.trim() === "") {
    throw new Error("AI ไม่ได้ตอบกลับตอนสกัดข้อมูล ลองใหม่อีกครั้ง");
  }
  return text;
}

/**
 * งานคิด angle ล็อกที่โมเดลเร็วเสมอ เหตุผลเดียวกับ CAPTION_MODEL/EXTRACT_MODEL:
 * เป็นงานข้อความล้วนสั้นๆ ไม่ควรจ่ายโควตาโมเดลละเอียด (20/วัน) ให้งานที่ flash-lite (500/วัน) ทำได้
 */
export const ANGLE_MODEL: GeminiModelId = "gemini-3.1-flash-lite";

const ANGLE_INSTRUCTION = `คุณคือผู้ช่วยคิดมุมนำเสนอ (angle) สำหรับคลิปสั้นขายสินค้าบน TikTok Shop ความยาว 10 วินาที
เสนอ angle ใหม่ 3 แบบที่ต่างกันชัดเจน และต้องไม่ซ้ำแนวกับ angle ที่เคยใช้ไปแล้ว

ตอบกลับในรูปแบบนี้เท่านั้น:
1. <angle: ปัญหาหรือแรงจูงใจที่ใช้เปิดคลิป + ฉากที่ใช้ + สิ่งที่โชว์ เขียนรวมใน 1-2 บรรทัด>
เพราะ: <เหตุผลสั้นบรรทัดเดียวว่าทำไม angle นี้น่าลอง และต่างจากของเดิมอย่างไร>
2. <angle>
เพราะ: <เหตุผล>
3. <angle>
เพราะ: <เหตุผล>

กติกา: ทุก angle ต้องถ่ายได้จริงในคลิป 10 วินาที ไม่มีข้อความบนจอ ไม่มีหน้าคน
ห้ามเขียนบทพูด ห้ามบรรยายโครงสร้างสินค้า ห้ามใส่หัวข้ออื่นนอกเหนือจากฟอร์แมตด้านบน
เขียนเป็นภาษาไทย`;

export async function suggestAngleOptions(args: {
  productName: string;
  productInfo: string;
  productSpec: string;
  usedAngles: string[];
}): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("ยังไม่ได้ตั้งค่า GEMINI_API_KEY ในไฟล์ .env");
  }

  const client = new GoogleGenAI({ apiKey });

  const usedBlock =
    args.usedAngles.length === 0
      ? "ยังไม่เคยทำคลิปสินค้านี้มาก่อน"
      : args.usedAngles.map((a, i) => `${i + 1}. ${a}`).join("\n");

  // productSpec ว่างได้ (entry เก่าที่ยังไม่เคยสกัดสเปกจากรูป) — ไม่ใส่หัวข้อนี้เลยถ้าว่าง
  // แทนที่จะส่งหัวข้อเปล่าไปสร้างความสับสนให้โมเดล
  const specBlock =
    args.productSpec.trim() === ""
      ? ""
      : `\n\n### สเปกสินค้าที่สกัดจากรูปจริง\n${args.productSpec}`;

  const response = await client.interactions.create({
    model: ANGLE_MODEL,
    // snake_case — camelCase จะถูก API เมินแบบเงียบๆ (ดูคอมเมนต์ใน generateTenPartPrompt)
    system_instruction: ANGLE_INSTRUCTION,
    // อุณหภูมิสูงกว่างานสกัด/caption เพราะงานนี้ต้องการความหลากหลาย ไม่ใช่ความแม่น
    generation_config: { temperature: 0.9 },
    input: [
      {
        type: "text",
        text:
          `### ชื่อสินค้า\n${args.productName}\n\n` +
          `### ข้อมูลสินค้า\n${args.productInfo}${specBlock}\n\n` +
          `### angle ที่เคยใช้ไปแล้ว (ห้ามซ้ำแนวนี้)\n${usedBlock}`,
      },
    ],
  });

  const text = response.output_text;
  if (!text || text.trim() === "") {
    throw new Error("AI ไม่ได้ตอบกลับตอนคิด angle ลองใหม่อีกครั้ง");
  }
  return text;
}

/**
 * สกัดสเปกสินค้าจากรูป — เป็นขั้นแยกต่างหากก่อนเจน 10 ส่วน
 *
 * เหตุผลที่ต้องแยก: เดิมโมเดลต้องมองรูป + ถอดสเปก + แต่งฉาก/กล้อง/บทพูด + คุมฟอร์แมต
 * 10 ส่วนพร้อมกันในการเรียกครั้งเดียว งานที่โดนเบียดคือการถอดสเปก — วัดจากพรอมต์ 10 คลิป
 * ล่าสุดพบว่าใช้บรรยายตัวสินค้าแค่ 20.7% ที่เหลือเป็น style/scene/camera ที่แทบเหมือนกัน
 * ทุกสินค้า ผลคือพื้นผิวแผ่นชั้น (ชั้นวาง) และกลไกฝา (กล่องขนม) ไม่เคยถูกเขียนลงพรอมต์เลย
 * แล้ว Flow เดาเอาเองจนเพี้ยน
 *
 * ไม่ล็อกโมเดลไว้ที่ flash-lite ต่างจาก CAPTION_MODEL/EXTRACT_MODEL/ANGLE_MODEL เพราะนี่เป็น
 * งาน "มองรูป" ไม่ใช่งานข้อความล้วน — ตรงกับแบบแผนเดิมที่งาน vision ให้ผู้ใช้เลือกโมเดลเอง
 * และเพราะสกัดครั้งเดียวต่อสินค้าแล้วใช้ซ้ำ การใช้โมเดลละเอียด (20/วัน) จึงไม่เปลืองโควตา
 */
const PRODUCT_SPEC_INSTRUCTION = `คุณคือผู้ช่วยถอดสเปกสินค้าจากรูปถ่ายจริง เพื่อส่งต่อให้ AI สร้างวิดีโอ

อ่านรูปทุกใบที่แนบมาอย่างละเอียด แล้วตอบกลับตามหัวข้อนี้เท่านั้น:

รูปทรงและสัดส่วน:
วัสดุและพื้นผิว (แยกทีละส่วน ระบุให้ชัดว่าทึบหรือมีรู):
ชิ้นส่วนและกลไก (เปิด/ปิด/พับ/หมุน/ถอด — อธิบายว่าทำงานอย่างไร):
สี:
ฉลาก/โลโก้/ข้อความบนตัวสินค้า (ตำแหน่ง สี ขนาด ข้อความที่อ่านได้):
จุดที่ AI มักทำเพี้ยนกับสินค้าแบบนี้:

กติกา:
- บรรยายเฉพาะสิ่งที่เห็นในรูปจริง ห้ามเดาสิ่งที่มองไม่เห็น
- ถ้าข้อมูลสินค้าจากร้านขัดกับสิ่งที่เห็นในรูป ให้ยึดรูปและทิ้งคำนั้นไป (ข้อมูลร้านมักแปลด้วยเครื่องจากภาษาจีนและผิดจากของจริง)
- ห้ามใช้คำนามหรือคำขยายที่กำกวม เช่น "กระปุก" (ให้ระบุว่ากล่อง/โหล/ถัง ตามทรงที่เห็น) หรือ "โปร่ง" (ให้ระบุว่าทึบ หรือ มีรู/ตะแกรง)
- หัวข้อ "วัสดุและพื้นผิว" กับ "ชิ้นส่วนและกลไก" ห้ามข้ามเด็ดขาด แม้สินค้าจะดูเรียบง่าย
- เขียนเป็นภาษาไทย กระชับแต่ครบ ไม่ต้องมีคำนำหรือบทสรุป`;

export async function extractProductSpec(args: {
  model: GeminiModelId;
  productName: string;
  productInfo: string;
  images: GeminiImage[];
}): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("ยังไม่ได้ตั้งค่า GEMINI_API_KEY ในไฟล์ .env");
  }

  const client = new GoogleGenAI({ apiKey });

  const input: object[] = [];
  input.push({
    type: "text",
    text:
      `### ชื่อสินค้า\n${args.productName}\n\n` +
      `### ข้อมูลสินค้าจากร้าน (ใช้ประกอบ แต่ยึดรูปเป็นหลัก)\n${args.productInfo}`,
  });
  // แนบ caption นำหน้ารูปของตัวเองทีละคู่ เหมือน generateTenPartPrompt — กันโมเดลเดาด้านผิด
  for (const [index, image] of args.images.entries()) {
    input.push({
      type: "text",
      text: `รูปที่ ${index + 1}${image.caption ? ` — ${image.caption}` : ""}`,
    });
    input.push({ type: "image", data: image.base64, mime_type: image.mimeType });
  }

  const response = await client.interactions.create({
    model: args.model,
    // snake_case — camelCase จะถูก API เมินแบบเงียบๆ (ดูคอมเมนต์ใน generateTenPartPrompt)
    system_instruction: PRODUCT_SPEC_INSTRUCTION,
    // ต่ำกว่างานเจนพรอมต์เพราะเป็นงานสังเกตและบันทึก ไม่ใช่งานสร้างสรรค์
    generation_config: { temperature: 0.2 },
    input,
  });

  const text = response.output_text;
  if (!text || text.trim() === "") {
    throw new Error("AI ไม่ได้ตอบกลับตอนสกัดสเปกสินค้า ลองใหม่อีกครั้ง");
  }
  return text;
}

const CANDIDATE_INSTRUCTION = `คุณคือผู้ช่วยอ่านตารางจัดอันดับสินค้าจากภาพแคปหน้าจอ TikTok Shop
อ่านทุกภาพที่แนบมา แล้วตอบกลับตามรูปแบบนี้เท่านั้น:

หมวด: <ชื่อหมวดจากหัวข้อบนสุดของภาพ>
<ชื่อสินค้าเต็ม> | <ราคาขาย> | <ค่าคอม> | <ยอดขายต่อสัปดาห์>
<ชื่อสินค้าเต็ม> | <ราคาขาย> | <ค่าคอม> | <ยอดขายต่อสัปดาห์>

กติกา:
- ชื่อสินค้าให้เอาเต็มตามที่เห็นในภาพ ห้ามย่อ ห้ามสรุป
- ตัวเลขให้คัดลอกตามที่เห็น รวมสัญลักษณ์ K เช่น 13.9K (ห้ามแปลงเป็น 13900 เอง)
- ราคาขายคือตัวเลขราคาสินค้า ส่วนค่าคอมคือตัวเลขที่ขึ้นต้นด้วยคำว่า "รับ"
- ยอดขายคือตัวเลขในข้อความ "ขายได้ X ชิ้นในสัปดาห์ที่ผ่านมา"
- ถ้าช่องใดไม่มีในภาพ ให้ใส่ขีด - แทน (เช่นหน้าที่โชว์ "รีวิวเชิงบวก 100.0%" แทนยอดขาย)
- ถ้ามีหลายหมวดในภาพเดียว ให้ขึ้นบรรทัด "หมวด:" ใหม่ก่อนกลุ่มสินค้าของหมวดนั้น
- ห้ามใส่หัวข้ออื่น ห้ามอธิบาย ห้ามสรุปท้าย`;

/**
 * อ่านตารางจัดอันดับสินค้าจากภาพ คืนข้อความดิบให้ parseCandidateRows แยกต่อ
 *
 * ล็อกที่ EXTRACT_MODEL เหมือน extractProductFields — เป็นงานอ่านข้อความจากภาพ
 * ไม่ใช่งานตีความภาพเชิงลึกแบบ extractProductSpec ที่ให้ผู้ใช้เลือกโมเดลเอง
 */
export async function extractCandidateRows(args: {
  images: GeminiImage[];
}): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("ยังไม่ได้ตั้งค่า GEMINI_API_KEY ในไฟล์ .env");
  }

  const client = new GoogleGenAI({ apiKey });
  const input: object[] = [];
  for (const image of args.images) {
    input.push({ type: "image", data: image.base64, mime_type: image.mimeType });
  }

  const response = await client.interactions.create({
    model: EXTRACT_MODEL,
    // snake_case — camelCase จะถูก API เมินแบบเงียบๆ
    system_instruction: CANDIDATE_INSTRUCTION,
    // temperature 0 — งานคัดลอกตัวเลข ไม่ใช่งานสร้างสรรค์
    generation_config: { temperature: 0 },
    input,
  });

  const text = response.output_text;
  if (!text || text.trim() === "") {
    throw new Error("AI ไม่ได้ตอบกลับตอนอ่านข้อมูลจากรูป ลองใหม่อีกครั้ง");
  }
  return text;
}
