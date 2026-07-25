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

const EXTRACT_INSTRUCTION = `คุณคือผู้ช่วยสกัดข้อความจากภาพแคปหน้าจอสินค้า TikTok Shop
อ่านทุกภาพที่แนบมา แล้วตอบกลับในรูปแบบนี้เท่านั้น:

ชื่อสินค้า: <ชื่อสินค้าตามที่เห็นในภาพ>
รายละเอียดสินค้า: <รายละเอียด/คำอธิบายสินค้าทั้งหมดที่อ่านได้จากภาพ เรียงต่อกัน>

กติกา: คัดลอกข้อความตามที่เห็นจริงในภาพ ใช้ภาษาเดิมตามภาพ ไม่แต่งเติม ไม่สรุปย่อ ไม่ใส่ความเห็น
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
