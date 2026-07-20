import { buildPromptText } from "@/lib/prompt-template";
import { GOLDEN_EXAMPLES } from "@/lib/golden-examples";

/**
 * จำนวนตัวอย่างที่สุ่มหยิบต่อการเจน 1 ครั้ง — 3 อันจากกอง golden ที่คัด+ขัดแล้ว
 * (มากกว่าเดิมที่ 2 เล็กน้อยเพื่อล็อกฟอร์แมตแน่นขึ้น ปลอดภัยเพราะทุกอันในกองสะอาดหมด)
 */
const SAMPLE_COUNT = 3;

/**
 * ตัวอย่าง few-shot ที่ป้อนให้โมเดลตอนสร้าง 10-part prompt — ตอนนี้สุ่มจากชุด golden ที่
 * แช่แข็งไว้ใน lib/golden-examples.ts (ไม่ดึง entry ล่าสุดจาก DB อีกต่อไป)
 *
 * เหตุผล: การดึง "entry ล่าสุด" ทำให้ few-shot หมุนตาม output ที่โมเดลเจนเอง — พอมีอันหนึ่ง
 * หลุด (เช่น watermark, เสียงเพศ) มันก็สอนตัวถัดไปให้หลุดตาม เป็นวงจร drift ไล่ตัวเองออก
 * ชุด golden ตัดวงจรนี้เพราะไม่มีทางให้ output ที่เพี้ยนแอบเข้ากอง
 *
 * คง signature เดิม (async + รับ excludeEntryId) เพื่อไม่ต้องแตะ caller ใน app/actions.ts
 * พารามิเตอร์ไม่ถูกใช้แล้วเพราะ golden ไม่ใช่ entry ในระบบ จึงไม่มีทางชนกับตัวที่กำลังเจน
 */
export async function getFewShotExamples(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- คง signature ไว้ให้ caller เดิมไม่ต้องแก้
  _excludeEntryId: string
): Promise<{ brief: string; output: string }[]> {
  const pool = [...GOLDEN_EXAMPLES];
  // Fisher-Yates shuffle เพื่อให้เห็น anchor สไตล์ต่างกันไปแต่ละครั้ง (ความหลากหลายด้านโทน)
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const picked = pool.slice(0, Math.min(SAMPLE_COUNT, pool.length));
  return picked.map((ex) => ({
    brief: buildPromptText({
      productName: ex.productName,
      productInfo: ex.productInfo,
      riskModule: ex.riskModule,
      extraNotes: ex.extraNotes,
      imageCaptions: ex.images,
    }),
    output: ex.output,
  }));
}
