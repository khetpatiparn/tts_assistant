import * as XLSX from "xlsx";

/** สถานะที่ถือว่า "จ่ายเงินแล้วจริง" (col 13) — อย่างอื่นคือรอ/ยกเลิก */
export const PAID_STATUS = "ชำระแล้ว";

export type AffiliateOrderInput = {
  orderId: string;
  productName: string;
  productId: string;
  contentId: string;
  status: string;
  currency: string;
  gmv: number;
  itemsSold: number;
  itemsRefunded: number;
  actualCommission: number | null;
  finalRevenue: number | null;
  orderDate: Date;
};

/**
 * ชื่อคอลัมน์ (แถวหัวตาราง) ที่ต้องใช้ — หาโดยชื่อ ไม่ใช่ตำแหน่งตายตัว
 *
 * เคยผูกกับตำแหน่ง (0-based) ตรงๆ มาก่อน แล้วพังจริงเมื่อ TikTok Studio แทรกคอลัมน์ใหม่
 * "รูปภาพแบบเลื่อน" เข้ามาระหว่าง "ประเภทเนื้อหา" กับ "รหัสเนื้อหา" (พบ 5 ก.ย. 2569) ทำให้
 * ทุกคอลัมน์ตั้งแต่ "รหัสเนื้อหา" เป็นต้นไปเลื่อนไป +1 ตำแหน่งทั้งหมด — orderDate (เดิม index 45)
 * ไปตกที่คอลัมน์ว่าง ทำให้ parseThaiDate คืน null ทุกแถว แล้ว parser ข้ามทุกแถวจนไฟล์อ่านได้ 0
 * ออเดอร์ (throw "ไม่พบออเดอร์ในไฟล์") ทั้งที่ไฟล์มีข้อมูลจริงเกือบ 2,000 แถว
 *
 * ชื่อหัวตารางเองไม่เคยเปลี่ยนระหว่างสองไฟล์จริงที่เจอปัญหานี้ (15 ก.ค. vs 5 ก.ย. 2569)
 * แม้ตำแหน่งจะเลื่อน — หาด้วยชื่อจึงทนทานต่อ TikTok แทรก/สลับคอลัมน์แบบนี้ได้ในอนาคตด้วย
 */
const HEADER = {
  orderId: "หมายเลขคำสั่งซื้อ",
  productName: "ชื่อสินค้า",
  productId: "รหัสสินค้า",
  itemsSold: "สินค้าที่ขายได้",
  itemsRefunded: "สินค้าที่มีการคืนเงิน",
  currency: "สกุลเงิน",
  status: "สถานะการชำระคำสั่งซื้อ",
  contentId: "รหัสเนื้อหา",
  gmv: "GMV",
  actualCommission: "ฐานค่าคอมมิชชั่นตามจริง",
  finalRevenue: "ยอดรายได้รวมสุดท้าย",
  orderDate: "วันที่สั่งซื้อ",
} as const;

/**
 * แปลงแถวหัวตาราง (rows[0]) เป็นตำแหน่งคอลัมน์จริงของไฟล์นี้ — เรียกครั้งเดียวต่อไฟล์
 * ถ้าหาชื่อไม่เจอเลย (TikTok เปลี่ยนชื่อคอลัมน์ ไม่ใช่แค่ย้ายตำแหน่ง) โยน error บอกชื่อ
 * คอลัมน์ที่หาไม่เจอตรงๆ ดีกว่าปล่อยให้เงียบแล้วได้ "ไม่พบออเดอร์ในไฟล์" อีกครั้งแบบไม่รู้สาเหตุ
 */
function resolveColumns(headerRow: string[]): Record<keyof typeof HEADER, number> {
  const out = {} as Record<keyof typeof HEADER, number>;
  for (const key of Object.keys(HEADER) as (keyof typeof HEADER)[]) {
    const name = HEADER[key];
    const idx = headerRow.findIndex((h) => String(h).trim() === name);
    if (idx === -1) {
      throw new Error(
        `ไฟล์รายได้เปลี่ยนรูปแบบ — หาคอลัมน์ "${name}" ไม่เจอในแถวหัวตาราง กรุณาตรวจไฟล์`
      );
    }
    out[key] = idx;
  }
  return out;
}

/** วันที่ในไฟล์เป็น "DD/MM/YYYY HH:MM:SS" (ไม่ใช่ ISO) */
function parseThaiDate(s: string): Date | null {
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, dd, mm, yyyy, hh, mi, ss] = m;
  return new Date(
    Number(yyyy),
    Number(mm) - 1,
    Number(dd),
    Number(hh),
    Number(mi),
    Number(ss)
  );
}

function num(v: unknown): number {
  const n = parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function numOrNull(v: unknown): number | null {
  const s = String(v ?? "").trim();
  if (s === "") return null;
  const n = parseFloat(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** ดึง video id จากลิงก์ TikTok — .../video/<id> */
export function videoIdFromUrl(url: string): string | null {
  const m = url.match(/\/video\/(\d{6,25})/);
  return m ? m[1] : null;
}

/**
 * รวมค่า nullable แบบ null-safe: null ถือเป็น 0 ตอนบวก
 * ยกเว้นทุกตัวใน group เป็น null หมด — กรณีนั้นผลลัพธ์ยังเป็น null
 * (กันไม่ให้ "ยังไม่คำนวณ" กลายเป็น "ศูนย์" ปลอมๆ)
 */
function sumNullable(values: (number | null)[]): number | null {
  if (values.every((v) => v === null)) return null;
  return values.reduce<number>((acc, v) => acc + (v ?? 0), 0);
}

/**
 * บาง order ในไฟล์ export ของ TikTok Studio มีมากกว่า 1 แถวต่อ orderId เดียวกัน
 * (พบจริง 4 order ในไฟล์ตัวอย่าง — productId/contentId/status/currency/orderDate/
 * productName/itemsSold/itemsRefunded เหมือนกันทุกแถว มีแค่ gmv ที่ต่างกัน เช่น
 * ถูกแยกเป็นราคาปกติ/ราคาโปร) ถ้าไม่รวมแถวเหล่านี้ก่อน upsert ด้วย orderId เดียว
 * แถวหลังจะเขียนทับแถวแรกจน gmv ของแถวแรกหายไปเงียบๆ — เลยต้อง group แล้ว sum
 * gmv ให้ครบก่อน return
 */
function mergeByOrderId(rows: AffiliateOrderInput[]): AffiliateOrderInput[] {
  const groups = new Map<string, AffiliateOrderInput[]>();
  for (const row of rows) {
    const group = groups.get(row.orderId);
    if (group) {
      group.push(row);
    } else {
      groups.set(row.orderId, [row]);
    }
  }

  const merged: AffiliateOrderInput[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    merged.push({
      ...first,
      gmv: group.reduce((acc, r) => acc + r.gmv, 0),
      actualCommission: sumNullable(group.map((r) => r.actualCommission)),
      finalRevenue: sumNullable(group.map((r) => r.finalRevenue)),
      // itemsSold/itemsRefunded ไม่ sum — ยืนยันจากข้อมูลจริงว่าเหมือนกันทุกแถวใน
      // group เดียวกัน (คือของชิ้นเดียวกัน แค่ gmv ถูกแยกบรรทัด) ใช้ค่าแถวแรกพอ
      itemsSold: first.itemsSold,
      itemsRefunded: first.itemsRefunded,
    });
  }
  return merged;
}

export function parseAffiliateXlsx(buffer: Buffer): AffiliateOrderInput[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  // header:1 => array-of-arrays, raw:false => ได้ string ตามที่แสดง, defval:"" กันช่องว่างหาย
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
  });

  if (rows.length === 0) return [];
  const COL = resolveColumns(rows[0]);

  const out: AffiliateOrderInput[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const orderId = String(r[COL.orderId] ?? "").trim();
    if (!orderId) continue;
    const orderDate = parseThaiDate(String(r[COL.orderDate] ?? ""));
    if (!orderDate) continue;
    out.push({
      orderId,
      productName: String(r[COL.productName] ?? "").trim(),
      productId: String(r[COL.productId] ?? "").trim(),
      contentId: String(r[COL.contentId] ?? "").trim(),
      status: String(r[COL.status] ?? "").trim(),
      currency: String(r[COL.currency] ?? "").trim(),
      gmv: num(r[COL.gmv]),
      itemsSold: Math.round(num(r[COL.itemsSold])),
      itemsRefunded: Math.round(num(r[COL.itemsRefunded])),
      actualCommission: numOrNull(r[COL.actualCommission]),
      finalRevenue: numOrNull(r[COL.finalRevenue]),
      orderDate,
    });
  }
  return mergeByOrderId(out);
}
