/**
 * แปลง JSON ที่ extension ภายนอก export มา → แถวที่พร้อม upsert ลง ProductCandidate
 *
 * Pure — ไม่มี Prisma ไม่มี node:* (ทดสอบด้วย scripts/check-showcase-import.mjs แบบเดียวกับ
 * lib/candidates.ts) shape ของ ShowcaseProductRaw อิงจาก data dictionary ที่ยืนยันจากบัญชีจริง
 * ในโปรเจกต์ extension ต้นทาง (docs/api-observations.md §2 ของโปรเจกต์นั้น) — ไม่ใช่การเดา
 */

export type ShowcaseProductRaw = {
  product_id: string;
  title: string;
  format_available_price: string;
  seller_info?: { shop_name?: string };
  affiliate_info?: { commission_rate?: number };
  category_info?: { name?: string };
  cover?: { url_list?: string[] };
  images?: { url_list?: string[] }[];
};

export type ShowcaseImportPayload = {
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
 * commission_rate ที่สังเกตได้ (1100/1200/1300/1600) มีหน่วยที่ "ยังไม่พิสูจน์" ตามที่โปรเจกต์
 * ต้นทางบันทึกไว้ตรงๆ — สมมติฐานที่ใช้ที่นี่ (ยึดตามรูปแบบ basis-points ที่พบบ่อยสุดใน API
 * TikTok/e-commerce ทั่วไป): หาร 100 ก่อนเก็บ (1200 -> 12.00%) ต้องตรวจกับข้อมูลจริงอีกทีใน
 * Task 12 (ทดสอบ end-to-end) ว่าตัวเลขที่ได้สมเหตุสมผลกับที่ผู้ใช้เห็นในหน้า Showcase จริงไหม
 */
function parseCommissionRate(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw)) return 0;
  return raw / 100;
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

  const products = (raw as ShowcaseImportPayload).products;
  const rows: NormalizedShowcaseCandidate[] = [];
  let skipped = 0;

  for (const p of products) {
    const productId = String(p.product_id ?? "").trim();
    const title = String(p.title ?? "").trim();
    // ไม่มี ID หรือไม่มีชื่อ = แถวใช้งานไม่ได้ ข้ามไปเงียบๆ นับไว้ใน skipped
    if (!productId || !title) {
      skipped++;
      continue;
    }

    const imageUrls = [
      ...(p.cover?.url_list ?? []),
      ...(p.images ?? []).flatMap((img) => img.url_list ?? []),
    ].filter((url): url is string => typeof url === "string" && url.length > 0);

    rows.push({
      sourceProductId: productId,
      name: title,
      price: parsePrice(p.format_available_price ?? ""),
      commission: parseCommissionRate(p.affiliate_info?.commission_rate),
      categoryLabel: p.category_info?.name ?? "",
      imageUrls,
    });
  }

  return { rows, skipped };
}
