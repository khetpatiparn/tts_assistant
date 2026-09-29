/**
 * ไคลเอนต์ Jev (TypeSafe) ขั้นต่ำ — ใช้แค่คำถามแบบ choice ข้อเดียว · API: docs.typesafe.ai/api
 * (POST /v1/systemone, Bearer TYPESAFE_API_KEY จาก .env) · Jev ตอบได้แต่ "เลือกจากตัวเลือก + ความน่าจะเป็น"
 * เขียนข้อความไม่ได้ และรับได้แต่ข้อความ (ไม่รับรูป)
 *
 * ทุกความผิดพลาด (ไม่มี key / เน็ต / 4xx / 5xx / timeout) คืน null เงียบๆ — Jev เป็นแค่ตัวสำรองของ
 * selector ถ้าใช้ไม่ได้บอทต้องทำงานแบบเดิมทุกประการ (พังเป็น selector_drift ให้คนแก้) ไม่ใช่พังเพราะ Jev
 * ปิดได้ด้วย FLOW_JEV=0
 */
const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const TIMEOUT_MS = 6000;

export function jevEnabled(): boolean {
  return Boolean(process.env.TYPESAFE_API_KEY) && process.env.FLOW_JEV !== "0";
}

export async function askJevChoice(
  instructions: string,
  criteria: Record<string, string>,
  state: unknown
): Promise<{ choice: string; p: number } | null> {
  if (!jevEnabled()) return null;
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "jev-latest",
        state,
        questions: { target: { type: "choice", instructions, criteria } },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      answers?: { target?: { choice?: string; probabilities?: Record<string, number>; confidence?: number } };
    };
    const a = body.answers?.target;
    if (!a?.choice) return null;
    return { choice: a.choice, p: a.probabilities?.[a.choice] ?? a.confidence ?? 0 };
  } catch {
    return null;
  }
}
