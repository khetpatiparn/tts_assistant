/**
 * แปลง JSON ที่ extension ภายนอก export มา → แถวที่พร้อม upsert ลง ProductCandidate
 *
 * Pure — ไม่มี Prisma ไม่มี node:* (ทดสอบด้วย scripts/check-showcase-import.mjs แบบเดียวกับ
 * lib/candidates.ts) shape ของ ShowcaseProductRaw คือ `NormalizedProduct` ที่ extension ส่งออกจริง
 * (showcase-extension extension/src/domain/product.ts — flat, camelCase, normalize มาแล้ว) —
 * **ไม่ใช่** raw data dictionary ของ TikTok เอง (product_id/seller_info.shop_name/…, docs/
 * api-observations.md §2 ของ extension) โน้ตเดิมเคยอ้างผิดเป็น raw shape จนทุก `productId` อ่านได้
 * ค่าว่าง — import จริงไม่เคยสำเร็จสักแถวเดียว ยืนยันจาก dev.db ก่อนแก้ (2026-09-24): ProductCandidate
 * ที่มี sourceProductId ไม่ว่างมี 0 แถว
 */
export type ShowcaseProductRaw = {
  productId: string;
  title: string;
  priceDisplay?: string | null;
  shopName?: string | null;
  /** raw passthrough จาก extension — อาจเป็น number หรือ string (ยังไม่มั่นใจ type ต้นทางเป๊ะ) */
  commissionRate?: number | string | null;
  imageUrls?: string[];
  categoryLabel?: string | null;
  /**
   * ปรากฏเฉพาะสินค้าที่ TikTok เองขึ้นว่า "Unavailable" เท่านั้น (ผู้ขายลบสินค้า/ไม่ใช่สินค้า
   * affiliate แล้ว) — สัญญาณเดียวที่ยืนยันได้จริงจากหลักฐานจริง (extension docs/api-observations.md
   * §2.3) ต่างจาก stock_status/review_status ซึ่งยังเป็น enum ที่ไม่ทราบความหมายแน่ชัด (extension
   * เองก็ยังไม่กล้าตีความ ปล่อย eligibility เป็น 'unknown' เสมอ) — จึงกรองด้วยตัวนี้ตัวเดียว
   */
  hasStatusPopup?: boolean;
};

export type ShowcaseImportPayload = {
  /** ไม่บังคับเพื่อกันพังกับ payload เก่า/ทดสอบที่ไม่มี field นี้ — ตรวจแยกใน parseShowcasePayload */
  resultKind?: string;
  products: ShowcaseProductRaw[];
};

export type NormalizedShowcaseCandidate = {
  sourceProductId: string;
  name: string;
  price: number;
  /** เปอร์เซ็นต์ (เช่น 12.5 = 12.5%) ไม่ใช่ basis points ดิบ — ดูหมายเหตุใน parseCommissionRate */
  commission: number;
  categoryLabel: string;
  imageUrls: string[];
};

/** "฿128.71" -> 128.71 — เอาทุกอย่างที่ไม่ใช่เลข/จุดออก ตามแบบ format_available_price ที่สังเกตได้ */
function parsePrice(display: string): number {
  const n = parseFloat(display.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/**
 * commission_rate ดิบ (1100/1200/1300/1600 ที่สังเกตได้) เป็นเปอร์เซ็นต์ x100 (basis-points
 * style) — **ยืนยันแล้วจริง** (final-review 2026-09-22, Fix 1): เทียบ commission_rate/100 คูณ
 * ราคากับ affiliate_info.commission_expense/est_commission_expense ของสินค้าจริง 14/14 ชิ้น
 * ตรงกันหมด ไม่ใช่สมมติฐานที่รอพิสูจน์อีกต่อไป รับทั้ง number และ string เพราะ
 * NormalizedProduct.commissionRate เป็น raw passthrough จาก extension (type ต้นทางจาก TikTok
 * ยังไม่ยืนยัน 100%)
 */
function parseCommissionRate(raw: number | string | null | undefined): number {
  const n = typeof raw === "string" ? parseFloat(raw) : raw;
  if (typeof n !== "number" || !Number.isFinite(n)) return 0;
  return n / 100;
}

/**
 * แปลง NormalizedShowcaseCandidate.commission (เปอร์เซ็นต์ — ดูหมายเหตุที่ field ด้านบน) เป็น
 * "บาทต่อชิ้น" ซึ่งเป็นหน่วยจริงของ ProductCandidate.commission ทั้งคอลัมน์ (ดู lib/candidates.ts:
 * commissionPercent/demandTotal คำนวณย้อนจากบาทเสมอ ไม่ใช่ %) — ห้ามเขียนค่า .commission ของ
 * NormalizedShowcaseCandidate ลง Prisma ตรงๆ ต้องแปลงผ่านฟังก์ชันนี้ก่อนเสมอ (ดู
 * app/actions.ts importShowcaseBatch) ไม่งั้นค่าที่เก็บจะเป็นเลขเปอร์เซ็นต์ที่ทุก consumer อื่น
 * ในระบบตีความเป็นบาทผิดหน่วยทันที (แสดงผล "ค่าคอม" ผิด, commissionPercent/demandTotal/ป้าย
 * จัดอันดับคำนวณผิดหมด)
 */
/**
 * ลิงก์รูปขนาดเต็มจากลิงก์ thumbnail ของ TikTok — Showcase ให้รูปแบบ `…~tplv-<id>-resize-jpeg:300:300.jpeg`
 * (300px เสมอ ครอปแล้วเล็กจนดูไม่รู้เรื่อง ผู้ใช้จริงบ่น 2026-09-29) · CDN ของ ByteDance ยอมให้ขอ `:0:0` = ขนาดต้นฉบับ
 * โดยไม่ต้องมี signature (ทดสอบสดกับ p16-oec-sg.ibyteimg.com: 300x107 → 1861x661) · ลิงก์ที่ไม่ตรงรูปแบบคืนเดิม
 * ผู้เรียกต้องถอยไปโหลดลิงก์เดิมเองถ้าลิงก์ขนาดเต็มโหลดไม่ได้
 */
export function originalImageUrl(url: string): string {
  return url.replace(/(~tplv-[^/?#]*?-resize-(?:jpeg|webp|png)):\d+:\d+(\.(?:jpeg|jpg|webp|png))(?=$|[?#])/, "$1:0:0$2");
}

export function commissionBahtFromPercent(price: number, commissionPercent: number): number {
  return (price * commissionPercent) / 100;
}

export function parseShowcasePayload(raw: unknown): {
  rows: NormalizedShowcaseCandidate[];
  skipped: number;
} {
  if (typeof raw !== "object" || raw === null || !Array.isArray((raw as ShowcaseImportPayload).products)) {
    throw new Error("ไฟล์ไม่ใช่ Showcase export ที่ถูกต้อง — ต้องมี field 'products' เป็น array");
  }

  const payload = raw as ShowcaseImportPayload;
  // resultKind มีไว้กันไฟล์ผลทดสอบหนึ่งหน้า (single_page_probe, ดู showcase-extension
  // export/json.ts) ถูกเข้าใจผิดว่าเป็นข้อมูลทั้ง Showcase — ไม่บังคับ field นี้ (payload เก่า/
  // ทดสอบอาจไม่มี) แต่ถ้ามีแล้วไม่ใช่ full_scan ต้องปฏิเสธ ไม่ใช่ import ข้อมูลไม่ครบไปเงียบๆ
  if (payload.resultKind !== undefined && payload.resultKind !== "full_scan") {
    throw new Error(
      `ไฟล์นี้เป็นผลทดสอบหนึ่งหน้า (resultKind: ${payload.resultKind}) ไม่ใช่ผลสแกนเต็ม Showcase — ห้ามนำเข้า`,
    );
  }

  const products = payload.products;
  const rows: NormalizedShowcaseCandidate[] = [];
  let skipped = 0;

  for (const p of products) {
    const productId = String(p.productId ?? "").trim();
    const title = String(p.title ?? "").trim();
    // ไม่มี ID หรือไม่มีชื่อ = แถวใช้งานไม่ได้ ข้ามไปเงียบๆ นับไว้ใน skipped
    if (!productId || !title) {
      skipped++;
      continue;
    }
    // สินค้าที่ TikTok เองยืนยันแล้วว่าตายแล้ว — ข้ามไปเงียบๆ เหมือนแถวใช้งานไม่ได้อื่นๆ
    if (p.hasStatusPopup === true) {
      skipped++;
      continue;
    }

    const imageUrls = (p.imageUrls ?? []).filter(
      (url): url is string => typeof url === "string" && url.length > 0,
    );

    rows.push({
      sourceProductId: productId,
      name: title,
      price: parsePrice(p.priceDisplay ?? ""),
      commission: parseCommissionRate(p.commissionRate),
      categoryLabel: p.categoryLabel ?? "",
      imageUrls,
    });
  }

  return { rows, skipped };
}
