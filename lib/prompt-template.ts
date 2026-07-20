export type PromptFormData = {
  productName: string;
  productInfo: string;
  riskModule: string;
  extraNotes: string;
  imageCaptions: string[];
};

export function buildPromptText({
  productName,
  productInfo,
  riskModule,
  extraNotes,
  imageCaptions,
}: PromptFormData): string {
  const imageLines = imageCaptions
    .map((caption, index) => `รูปที่ ${index + 1}: ${caption || "[ไม่มีคำอธิบาย]"}`)
    .join("\n");

  return `ใช้ Core Prompt ด้านบนสร้าง prompt สำหรับ Gemini Flow

ให้วิเคราะห์ข้อมูลสินค้า รูปอ้างอิง, Product Accuracy, Product Risk, Category Module, Shot / Angle Template และ Performance Card ภายในก่อน
แต่ไม่ต้องแสดง Product Card หรือ Performance Card ออกมา

ให้ output เฉพาะ prompt สำหรับ Gemini Flow ตามโครงสร้าง 10 ส่วนของ Core Prompt
โดยเขียนให้กระชับ ไม่ซ้ำ ไม่มีคำสั่งที่ขัดกัน และเหมาะกับคลิป 10 วินาที

ชื่อสินค้า:
"""
${productName}
"""

รูปอ้างอิงที่แนบ (แต่ละใบมี caption กำกับ และจะถูกแนบให้ดูทีละใบพร้อม caption ด้านล่างของโจทย์นี้):
${imageLines}

ข้อมูลสินค้าจากเว็บ/ร้านค้า:
"""
${productInfo}
"""

Product Risk Module ที่ต้องใช้:
"""
${riskModule}
"""

ข้อมูลเพิ่มเติมจากฉัน ถ้ามี:
"""
${extraNotes}
"""

สิ่งที่ต้องทำ:
- เลือก use case เดียวที่เหมาะที่สุด เสี่ยงเพี้ยนน้อย และขายของได้ใน 10 วินาที
- เลือก action ที่ง่ายที่สุดแต่เห็นประโยชน์สินค้าเร็ว
- อ่านรูปอ้างอิงแต่ละใบตาม caption ที่กำกับ แล้วถอดโครงสร้างที่เห็นจริง (รูปทรง สี ชิ้นส่วน สัดส่วน ตำแหน่ง logo ด้านหน้า/หลัง กลไก) ลง Product Accuracy และ Critical Product Structure ให้ครบ**ตามระดับความเสี่ยงของสินค้า** — สินค้าซับซ้อน/อสมมาตร (logo ด้านเดียว, พับ/กาง/มีกลไก) ให้บรรยายละเอียดพอจะกันเพี้ยน ส่วนสินค้าเรียบง่ายเขียนสั้นกระชับ ไม่ต้องยัดเยิน
- caption ของรูปคือความจริงเรื่องด้าน/ชิ้นส่วน ใช้เพื่อไม่ให้ output บรรยายผิดด้าน (เช่นถ้า caption บอก logo อยู่ด้านหน้าเท่านั้น ห้ามให้ output ใส่ logo ด้านหลัง)
- วิเคราะห์ Product Accuracy ที่ห้ามพลาดจากรูปและข้อมูลสินค้า
- วิเคราะห์ Critical Product Structure ที่ต้องคงไว้
- วิเคราะห์จุดที่ AI มีโอกาสทำเพี้ยน แล้วใส่กันไว้ใน Product Accuracy / Negative Prompt
- เลือกจำนวน visual beats ให้เหมาะกับความเสี่ยงของสินค้า
- ถ้าสินค้าเสี่ยงเพี้ยนสูง เช่น พับได้ กางได้ ยืดได้ หมุนได้ มีโครงขา หรือมีกลไก ให้ใช้ 3–4 visual beats ที่ปลอดภัยกว่า
- ถ้าสินค้าเสี่ยงต่ำ ให้ใช้ 4–5 visual beats เพื่อให้คลิปมีจังหวะ

กฎสำคัญ:
- ใช้รูปอ้างอิงเป็นหลักก่อนข้อมูลเว็บ
- ห้ามเดาคุณสมบัติที่ไม่มีในรูปหรือข้อมูลสินค้า
- ถ้าไม่แน่ใจ ให้เลือกทาง conservative และเสี่ยงเพี้ยนน้อยที่สุด
- ห้ามเคลมเกินจริง
- ต้องเห็นสินค้าใน 1–2 วินาทีแรก
- ภายใน 2 วินาทีแรกต้องมี movement ชัดเจน
- คลิปต้องเร็ว แต่ห้ามทำให้สินค้า วิธีใช้ หรือโครงสร้างเพี้ยน
- ห้ามมีข้อความทุกชนิดในวิดีโอ
- ห้ามซับ ห้าม label ห้าม poster ห้าม UI overlay ห้าม callout ห้ามราคา ห้ามตัวหนังสือในฉากหลัง
- บทพากย์ไทยเท่านั้น 3–5 วลี/จังหวะพูดสั้น รวมประมาณ 30–35 คำเท่านั้นและห้ามเกิน 35 คำ มี hook ใน 1–2 วินาทีแรก และไม่มี dead air ยาว

**important**:
กรณีที่เป็นสินค้าแนวน้ำยาปรับผ้านุ่ม/ซักผ้า/ล้างจาน/ของเหลวต่างๆ
เนื่องจากสินค้าแนวของเหลวมักจะไม่มีรูปที่เป็นของเหลวต้นฉบับให้ จึงต้องไม่เน้นไปเรื่องการเทให้เห็นของเหลว
ไม่ควรให้คลิปพึ่งการเห็นตัวของเหลวเป็นหลัก
ให้ทำแนว Package-led UGC คือ "แพ็กเกจเป็นพระเอก + before /after ของการแก้ปัญหาที่ได้จากการใช้สินค้าแทน"

Output:
สร้าง prompt สำหรับ Gemini Flow ตาม 10 ส่วนนี้เท่านั้น:
1. Style
2. Scene
3. Subject
4. Product Accuracy
5. Action Timeline
6. Camera
7. Framing
8. Lighting / Color
9. Negative Prompt
10. Quick QA Checklist`;
}

export const DEFAULT_IMAGE_LABELS = ["ภาพหน้าสินค้า", "ภาพตอนใช้งาน"];
