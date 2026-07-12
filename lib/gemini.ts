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

export type GeminiImage = { base64: string; mimeType: string };

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

  // Then the real task, then the photos it must be based on.
  input.push({ type: "text", text: `### โจทย์จริง\n${args.brief}` });
  for (const image of args.images) {
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
