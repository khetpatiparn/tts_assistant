/**
 * ตรรกะล้วนของหน้า "หาสินค้า" — parse ตัวเลข/บรรทัดจากผลลัพธ์ AI, ธงเตือน, คำนวณ
 *
 * ไฟล์นี้ห้าม import Prisma/Gemini/node:* เพื่อให้ scripts/check-candidates.mjs
 * คอมไพล์และทดสอบได้โดยไม่ต้องมี DB หรือ API key
 */

export type CandidateFlag = "mechanism" | "heavyText";

export type ParsedRow = {
  name: string;
  price: number;
  commission: number;
  weeklySales: number | null;
  categoryLabel: string;
};

/** คำในชื่อสินค้าที่บ่งบอกว่ามีกลไก — AI generate วิดีโอมักเลือกกลไกผิดกับสินค้ากลุ่มนี้ */
const MECHANISM_WORDS = [
  "พับได้", "พับ", "หมุน", "360", "ยืด", "ปรับระดับ", "อัตโนมัติ", "สไลด์", "บานพับ",
];

/** คำที่บ่งบอกว่า น่าจะมีฉลาก/ตารางข้อความบนตัวสินค้า — AI generate ตัวหนังสือเพี้ยนเป็นกลุ่มแรก */
const HEAVY_TEXT_WORDS = [
  "อาหาร", "ขนม", "ผง", "น้ำยา", "ครีม", "เจล", "วิตามิน", "อาหารเสริม",
];

/**
 * แปลงข้อความตัวเลขจากหน้า TikTok Shop เป็นตัวเลขจริง
 *
 * รองรับ: suffix K (13.9K -> 13900), สัญลักษณ์เงิน, คอมมาคั่นหลัก,
 * และช่วงราคา (17.52 – 21.90) ซึ่งเลือกค่าต่ำสุดเสมอตามหลัก conservative ของ Core Prompt
 * คืน null เมื่ออ่านไม่ออกหรือเป็นขีด "-" (ช่องที่หน้านั้นไม่มีข้อมูล)
 */
export function parseThaiNumber(text: string): number | null {
  const cleaned = text.replace(/[฿,\s]/g, "");
  if (cleaned === "" || cleaned === "-") return null;

  // ช่วงตัวเลข: ตัดที่ตัวคั่นช่วง (– en dash, — em dash, - hyphen) แล้วใช้ตัวแรก
  // ต้องเช็คหลังตัด , และช่องว่างแล้ว เพื่อให้ "17.52 – 21.90" กลายเป็น "17.52–21.90"
  const rangeMatch = cleaned.match(/^([\d.]+)[–—-][\d.]+$/);
  const target = rangeMatch ? rangeMatch[1] : cleaned;

  const kMatch = target.match(/^([\d.]+)[Kk]$/);
  if (kMatch) {
    const n = Number.parseFloat(kMatch[1]);
    return Number.isFinite(n) ? Math.round(n * 1000) : null;
  }

  if (!/^[\d.]+$/.test(target)) return null;
  const n = Number.parseFloat(target);
  return Number.isFinite(n) ? n : null;
}

/** ทำให้ชื่อสินค้าเทียบกันได้ตอนกันซ้ำ — ยุบช่องว่างซ้ำ ตัดหัวท้าย ลดเป็นตัวพิมพ์เล็ก */
export function normalizeName(name: string): string {
  return name.replace(/\s+/g, " ").trim().toLowerCase();
}

/** ตรวจธงเตือนจากชื่อสินค้าด้วยคำ ไม่ใช้ AI — ถูกกว่า เร็วกว่า และทดสอบได้ */
export function detectFlags(name: string): CandidateFlag[] {
  const flags: CandidateFlag[] = [];
  if (MECHANISM_WORDS.some((w) => name.includes(w))) flags.push("mechanism");
  if (HEAVY_TEXT_WORDS.some((w) => name.includes(w))) flags.push("heavyText");
  return flags;
}

/**
 * แยกผลลัพธ์ดิบจาก AI เป็นแถวสินค้า
 *
 * ฟอร์แมตที่คาดหวัง:
 *   หมวด: <ชื่อหมวด>
 *   <ชื่อสินค้า> | <ราคา> | <ค่าคอม> | <ยอดขาย>
 *
 * บรรทัดที่ผิดรูปหรือมีตัวเลขที่จำเป็นอ่านไม่ออก จะถูกข้ามเฉพาะบรรทัดนั้นและนับใน skipped
 * ไม่ throw — ปรัชญาเดียวกับ lib/caption.ts (อย่าทิ้งผลลัพธ์ที่จ่ายโควตาไปแล้วทั้งชุด)
 */
export function parseCandidateRows(raw: string): { rows: ParsedRow[]; skipped: number } {
  const rows: ParsedRow[] = [];
  let skipped = 0;
  let categoryLabel = "";

  for (const line of raw.split("\n")) {
    const trimmed = line.replace(/\*\*/g, "").trim();
    if (trimmed === "") continue;

    const headerMatch = trimmed.match(/^หมวด:\s*(.+)$/);
    if (headerMatch) {
      categoryLabel = headerMatch[1].trim();
      continue;
    }

    const parts = trimmed.split("|").map((p) => p.trim());
    if (parts.length !== 4) {
      skipped++;
      continue;
    }

    const [name, priceText, commissionText, salesText] = parts;
    const price = parseThaiNumber(priceText);
    const commission = parseThaiNumber(commissionText);
    if (name === "" || price === null || commission === null) {
      skipped++;
      continue;
    }

    rows.push({
      name,
      price,
      commission,
      weeklySales: parseThaiNumber(salesText),
      categoryLabel,
    });
  }

  return { rows, skipped };
}

/** %ค่าคอม — ราคา 0 คืน 0 แทน Infinity เพื่อไม่ให้ตารางพังถ้า AI อ่านราคาเพี้ยน */
export function commissionPercent(price: number, commission: number): number {
  if (price <= 0) return 0;
  return (commission / price) * 100;
}

/** ดีมานด์รวม — null เมื่อไม่มียอดขาย (แคปมาจากหน้า "คะแนนสูงสุด" ที่ไม่โชว์ตัวเลขนี้) */
export function demandTotal(commission: number, weeklySales: number | null): number | null {
  if (weeklySales === null) return null;
  return commission * weeklySales;
}

/**
 * จับกลุ่มหมวดจากคำในชื่อสินค้า — ใช้กับ "แถบเตือนหมวดที่ควรโฟกัส" เท่านั้น
 *
 * ห้ามเอาไปใช้กับเกณฑ์ตัดสินสถานะเขียว/แดง (ดูสเปกหัวข้อ "หมายเหตุความไม่สมมาตรที่ตั้งใจ") —
 * แถบเตือนจับกลุ่มพลาดก็แค่เลขบนป้ายคลาดเคลื่อน แต่เกณฑ์ตัดสินขับการตัดสินใจจริง
 * จึงใช้ค่ารวมทั้งร้านที่ไม่มีทางเพี้ยนแทน
 *
 * ลำดับการเช็คสำคัญ: จัดระเบียบบ้านต้องเช็คก่อนเครื่องครัว เพราะสินค้าอย่าง
 * "ชั้นวางของ ... สำหรับครัว" ควรถูกจัดเป็นจัดระเบียบบ้าน (ชั้นวางคือตัวสินค้าจริง)
 * ไม่ใช่เครื่องครัว (แค่บอกว่าใช้ที่ไหน) — ถ้าสลับลำดับ สินค้ากลุ่มนี้จะเข้าเครื่องครัวผิดหมวด
 *
 * "หมา" ใช้ negative lookbehind กัน "เ" นำหน้า เพราะ "หมา" เป็น substring ของ "เหมาะ"
 * (คำไทยทั่วไปแปลว่า "เหมาะสำหรับ") ซึ่งไม่เกี่ยวกับสัตว์เลี้ยงเลย
 */
export function categorize(productName: string): string | null {
  const n = productName;
  if (/แมว|(?<!เ)หมา|สุนัข|สัตว์|กระต่าย/.test(n)) return "สัตว์เลี้ยง";
  if (/ชั้นวาง|รถเข็น|ตู้|เคาเตอร์|โต๊ะ|ราวตาก|ม่าน|กล่องเก็บ/.test(n)) return "จัดระเบียบบ้าน";
  if (/หม้อ|กระทะ|ช้อน|เขียง|ถ้วย|ชาม|ครัว|กระปุก/.test(n)) return "เครื่องครัว";
  return null;
}
