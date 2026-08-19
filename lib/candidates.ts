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
    // AI มักตอบทั้งป้ายกำกับติดตัวเลขมาด้วย ("รับ ฿2.95", "ขายได้ 3.3K ชิ้นในสัปดาห์ที่ผ่านมา")
    // แม้พรอมต์จะสั่งห้ามแล้ว — ตัดคำเหล่านี้ทิ้งก่อน parse เป็นชั้นกันพลาดที่สอง เพราะ
    // เจอจริงว่าตัวคำสั่งอย่างเดียวไม่พอ (ทุกแถวในการทดสอบจริงครั้งแรกมีป้ายกำกับติดมาหมด)
    const commission = parseThaiNumber(commissionText.replace(/^รับ\s*/, ""));
    if (name === "" || price === null || commission === null) {
      skipped++;
      continue;
    }

    const salesNumberText = salesText
      .replace(/^ขายได้\s*/, "")
      .replace(/\s*ชิ้นในสัปดาห์ที่ผ่านมา$/, "");

    rows.push({
      name,
      price,
      commission,
      weeklySales: parseThaiNumber(salesNumberText),
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

/**
 * เพดานความน่าเชื่อถือของ %ค่าคอม — ในระบบ affiliate ของ TikTok Shop ค่าคอมเป็นไปไม่ได้
 * ที่จะเกินราคาสินค้าเอง (ร้านไม่มีทางจ่ายมากกว่า 100% ของราคา) ค่าที่เกิน 100% แทบจะเป็น
 * สัญญาณเดียวว่าราคาที่อ่านได้ผิดแน่ๆ (เจอจริง 2026-08-19: แคปหน้า "ของใช้สำหรับสัตว์เลี้ยง"
 * บางแถวได้ราคา ฿0.01 ซึ่งน่าจะเป็นราคาโปรโมชั่นแฟลชเซลที่ AI อ่านตามจอจริง แต่ไม่ใช่ราคาที่
 * ใช้เทียบค่าคอมได้ — ทำให้ %ค่าคอมพุ่งไป 6900% แล้วชนะป้าย "ยอดขายดี" ทั้งที่เป็นข้อมูลขยะ)
 */
export const MAX_PLAUSIBLE_COMMISSION_PERCENT = 100;

export function isCommissionPercentPlausible(pct: number): boolean {
  return pct <= MAX_PLAUSIBLE_COMMISSION_PERCENT;
}

/**
 * ศักยภาพรายได้ (เดิมเรียก "ดีมานด์รวม" ในหน้าเว็บ — เปลี่ยนชื่อเพราะสูตรนี้วัด
 * "เงินที่เราได้จริงถ้าอัตราขายนี้ต่อเนื่อง" ไม่ใช่ขนาดตลาด/ดีมานด์ผู้บริโภคจริงๆ
 * ถ้าใช้ราคา×ยอดขายแทนค่าคอม×ยอดขาย จะได้ตัวเลข GMV ซึ่งทำให้สินค้าค่าคอมต่ำแต่ราคาแพง
 * ดูน่าสนใจกว่าสินค้าค่าคอมสูงแต่ราคาถูก ทั้งที่ให้เงินเราน้อยกว่าจริง — บั๊กคลาสเดียวกับ
 * ตอนป้ายค่าคอมสูงสุดเคยใช้ % แทนบาทมาก่อน)
 *
 * null เมื่อไม่มียอดขาย (แคปมาจากหน้า "คะแนนสูงสุด" ที่ไม่โชว์ตัวเลขนี้)
 */
export function demandTotal(commission: number, weeklySales: number | null): number | null {
  if (weeklySales === null) return null;
  return commission * weeklySales;
}

/** rank เริ่มที่ 1 เสมอ (อันดับ 1 = ดีที่สุด) ใช้โชว์เป็นตัวเลขในป้าย เช่น "ยอดขายดี #1" */
export type CandidateBadge = { type: "topSeller" | "topCommission"; rank: number };

/** จำนวนแถวที่ติดป้ายต่อประเภท — ปรับได้ตรงนี้จุดเดียวถ้ารู้สึกว่าน้อย/เยอะไป */
const TOP_BADGE_COUNT = 4;

/**
 * เลือกป้าย "ยอดขายดี"/"ค่าคอมสูงสุด" ท็อป TOP_BADGE_COUNT ต่อป้าย ต่อ "ประเภทสินค้า"
 * (categoryLabel) แยกกัน — แต่ละประเภทคือการ์ดจัดอันดับ 40 รายการของตัวเองใน TikTok Shop
 * (เช่น "แผ่นและเสาลับเล็บแมว" กับ "ของใช้สำหรับสัตว์เลี้ยง" คนละการ์ด คนละสเกลตัวเลข)
 * ถ้าคำนวณรวมทุกประเภทเป็นกองเดียว ประเภทที่ตัวเลขใหญ่กว่าโดยธรรมชาติ (เช่น ของกิน/ของใช้
 * สิ้นเปลือง ยอดขายหลักพัน) จะยึดป้ายไปหมด ประเภทที่ตัวเลขเล็กกว่า (เช่น เฟอร์นิเจอร์
 * ยอดขายหลักร้อย) จะไม่ได้ป้ายเลยแม้จะมีตัวเด่นในประเภทตัวเองจริง — อัปโหลด N ประเภทจึง
 * ควรได้ป้ายรวม N × (TOP_BADGE_COUNT × 2) ไม่ใช่แค่ TOP_BADGE_COUNT × 2 คงที่
 *
 * คำนวณเฉพาะแถวที่ (1) ยังไม่ถูกปัดตก และ (2) %ค่าคอมสมเหตุสมผล (≤100%) เท่านั้น — ข้อ 2
 * กันแค่แถวที่ราคาอ่านผิด (เช่น ฿0.01 จากราคาโปรโมชั่น) ไม่ให้ % ที่สูงเกินจริงมาปนข้อมูล
 * ไม่ใช่การกรองคุณภาพดีล
 *
 * **เคยกรองด้วย "commissionPercent > benchmarkPercent ทั้งร้าน" ด้วย (2026-08-19) แล้วถอดออก**
 * เพราะพิสูจน์แล้วด้วยข้อมูลจริงว่าเกณฑ์นั้นบังของที่ทำเงินได้มากที่สุดในหมวดทิ้งไปเอง —
 * เคสจริง: หมวดโซฟา สินค้าค่าคอม ฿249.95/ชิ้น (สูงสุดในหมวด) ถูกกรองทิ้งเพราะ % แค่ 2.3%
 * (ต่ำกว่าค่าเฉลี่ยร้านที่คำนวณจากของถูกอย่างที่ลับเล็บแมว 20-30 บาท) ทั้งที่ ฿249.95/ชิ้น
 * ไม่ใช่ "กำไรต่ำ" เลยในแง่เงินจริง — สินค้าราคาแพงได้ % ต่ำกว่าเป็นธรรมชาติของตลาด
 * (ต้นทุนคงที่กินสัดส่วนราคาน้อยลงเมื่อของแพงขึ้น) ไม่ใช่สัญญาณว่าดีลแย่ เอา % ของหมวดหนึ่ง
 * ไปเทียบค่าเฉลี่ยที่คำนวณจากหมวดราคาต่ำกว่ามากจึงเทียบกันคนละบริบทตั้งแต่ต้น
 *
 * เหตุผลที่ไม่ต้องมีเกณฑ์กำไรขั้นต่ำแทน: เครื่องมือนี้ผลิตคลิปต้นทุนคงที่ (คลิป AI 10 วิ
 * ต้นทุนเวลา/เครดิตเท่ากันไม่ว่าสินค้าราคาเท่าไหร่) เมื่อต้นทุนต่อคลิปคงที่ ตัวชี้วัดที่ควร
 * ตัดสินใจคือ "เงินจริงที่จะได้" ล้วนๆ ไม่มีเหตุผลต้องคูณ/หารด้วย % ซ้ำอีกชั้น สินค้าค่าคอม
 * น้อยจริงก็จะได้ตัวเลข "ศักยภาพรายได้" (ค่าคอม×ยอดขาย) ต่ำเองอยู่แล้วโดยธรรมชาติ ไม่ต้องมี
 * เกณฑ์ %มาช่วยกรองซ้ำ
 *
 * ป้ายค่าคอมสูงสุดจัดอันดับด้วย "เงินบาทต่อชิ้น" ไม่ใช่ % — เคยใช้ % จัดอันดับแล้วพบว่าเลือกผิด
 * ของจริง: สินค้าราคาถูกที่ % สูงลิ่ว (16.2%) ได้เงินจริงแค่ ฿3.64/ชิ้น ขณะที่สินค้าราคาสูง
 * ที่ % ต่ำกว่า (8.9%) ได้ ฿38.72/ชิ้น — % เป็นแค่อัตราส่วน ไม่ผูกกับเงินที่ได้จริง
 *
 * คืนเป็น Map<id, CandidateBadge[]> เพราะแถวเดียวอาจติดทั้ง 2 ป้ายพร้อมกันได้
 */
export function pickCandidateBadges(
  rows: {
    id: string;
    status: string;
    commission: number;
    commissionPercent: number;
    weeklySales: number | null;
    categoryLabel: string;
  }[]
): Map<string, CandidateBadge[]> {
  const result = new Map<string, CandidateBadge[]>();

  const addBadge = (id: string, badge: CandidateBadge) => {
    const existing = result.get(id);
    if (existing) existing.push(badge);
    else result.set(id, [badge]);
  };

  const byCategory = new Map<string, typeof rows>();
  for (const r of rows) {
    const group = byCategory.get(r.categoryLabel);
    if (group) group.push(r);
    else byCategory.set(r.categoryLabel, [r]);
  }

  for (const group of byCategory.values()) {
    const eligible = group.filter(
      (r) => r.status !== "rejected" && isCommissionPercentPlausible(r.commissionPercent)
    );

    eligible
      .filter((r) => r.weeklySales !== null)
      .sort((a, b) => (b.weeklySales as number) - (a.weeklySales as number))
      .slice(0, TOP_BADGE_COUNT)
      .forEach((r, i) => addBadge(r.id, { type: "topSeller", rank: i + 1 }));

    [...eligible]
      .sort((a, b) => b.commission - a.commission)
      .slice(0, TOP_BADGE_COUNT)
      .forEach((r, i) => addBadge(r.id, { type: "topCommission", rank: i + 1 }));
  }

  return result;
}

/**
 * จับกลุ่มหมวดจากคำในชื่อสินค้า — ใช้กับ "แถบเตือนหมวดที่ควรโฟกัส" เท่านั้น (ตัวเลข
 * advisory คร่าวๆ ไม่ใช่ตัวกรอง/จัดอันดับป้ายแนะนำสินค้า) จับกลุ่มพลาดบ้างก็แค่เลข
 * บนแถบคลาดเคลื่อน ไม่กระทบการตัดสินใจหลัก (ดู pickCandidateBadges ที่ไม่ใช้ % เทียบ
 * ข้ามหมวดแล้วตั้งแต่ 2026-08-19 เพราะพิสูจน์แล้วว่าเทียบข้ามหมวดราคาต่างกันไม่ได้)
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
