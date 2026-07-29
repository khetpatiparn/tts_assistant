/**
 * ตรรกะค้นหารายการในแถบข้าง — แยกออกมาจาก history-rail.tsx เพื่อให้ทดสอบได้
 * (โปรเจกต์ไม่มี test runner จึงต้องเป็น pure function ที่คอมไพล์เดี่ยวแล้วรันด้วย node ได้)
 */

/** ฟิลด์ที่คำค้นถูกนำไปแมตช์ — riskModule ถูกตัดออกตั้งใจ ดูคอมเมนต์ใน matchTier */
export type SearchableEntry = {
  productName: string;
  productInfo: string;
  extraNotes: string;
};

/** ชั้นของผลลัพธ์ เรียงตามความน่าเชื่อถือจากมากไปน้อย */
export type MatchTier = "name" | "notes" | "info";

/**
 * ตัดคำค้นด้วยช่องว่าง แล้วลดเป็นตัวพิมพ์เล็ก
 *
 * เดิม matchesQuery เอาคำค้นทั้งประโยครวมเว้นวรรคไปหาเป็น substring เดียว ทำให้พิมพ์
 * เว้นวรรคเมื่อไหร่ได้ 0 เสมอทั้งที่มีของอยู่ (ทดสอบกับข้อมูลจริงล้มเหลว 5/5 เคส เช่น
 * "ที่นอน แมว" ได้ 0 ทั้งที่แยกคำแล้วเจอ 7 รายการ) — และล้มเหลวแบบเงียบ ไม่มีอะไรบอกสาเหตุ
 */
export function splitTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter((t) => t !== "");
}

/**
 * จัดชั้นของรายการตาม "ฟิลด์ที่อ่อนที่สุดที่จำเป็นต้องใช้" เพื่อให้ทุกคำถูกเจอครบ
 *
 * เมื่อค้นหลายคำ รายการหนึ่งอาจเจอคำหนึ่งในชื่อ อีกคำในรายละเอียด — กฎนี้ทำให้แต่ละรายการ
 * ตกอยู่ชั้นเดียวเสมอ ไม่ซ้ำสองที่ และชั้นที่น่าเชื่อถือกว่าชนะเสมอ
 *
 * riskModule ไม่ถูกค้นโดยตั้งใจ (ยกมาจากคอมเมนต์เดิมใน history-rail.tsx): เนื้อหาเป็นวลีซ้ำ
 * ทั่วไป ("พับได้" / "มีกลไก") ที่ใช้ร่วมกันหลายสิบรายการ ถ้ารวมเข้ามาผลค้นหาจะกว้างขึ้น
 * แทนที่จะแคบลง
 */
export function matchTier<T extends SearchableEntry>(
  entry: T,
  terms: string[]
): MatchTier | null {
  if (terms.length === 0) return null;

  const name = entry.productName.toLowerCase();
  const nameAndNotes = name + " " + entry.extraNotes.toLowerCase();
  const all = nameAndNotes + " " + entry.productInfo.toLowerCase();

  if (terms.every((t) => name.includes(t))) return "name";
  if (terms.every((t) => nameAndNotes.includes(t))) return "notes";
  if (terms.every((t) => all.includes(t))) return "info";
  return null;
}
