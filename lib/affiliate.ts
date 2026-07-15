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
  return out;
}
