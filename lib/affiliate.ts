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

// ตำแหน่งคอลัมน์ (0-based) ในไฟล์ affiliate export ของ TikTok Studio
const COL = {
  orderId: 0,
  productName: 2,
  productId: 3,
  itemsSold: 5,
  itemsRefunded: 6,
  currency: 11,
  status: 13,
  contentId: 17,
  gmv: 23,
  actualCommission: 34,
  finalRevenue: 44,
  orderDate: 45,
} as const;

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
