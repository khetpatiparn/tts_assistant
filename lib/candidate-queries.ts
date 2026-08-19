import { prisma } from "@/lib/prisma";
import { PAID_STATUS } from "@/lib/affiliate";
import {
  categorize,
  commissionPercent,
  demandTotal,
  detectFlags,
  pickCandidateBadges,
  type CandidateBadge,
  type CandidateFlag,
} from "@/lib/candidates";

export type CandidateRow = {
  id: string;
  name: string;
  price: number;
  commission: number;
  weeklySales: number | null;
  categoryLabel: string;
  capturedOn: Date;
  status: string;
  note: string;
  linkedEntryId: string | null;
  commissionPercent: number;
  demandTotal: number | null;
  flags: CandidateFlag[];
  badges: CandidateBadge[];
};

export type CategorySummary = {
  label: string;
  count: number;
  lastCapturedOn: Date;
};

export type FocusCategory = {
  label: string;
  ratePercent: number;
  orderCount: number;
};

export async function getCandidatesData(): Promise<{
  rows: CandidateRow[];
  summaries: CategorySummary[];
  benchmarkPercent: number;
  benchmarkOrderCount: number;
  focus: FocusCategory[];
}> {
  const [candidates, paidOrders] = await Promise.all([
    prisma.productCandidate.findMany({ orderBy: { capturedOn: "desc" } }),
    prisma.affiliateOrder.findMany({
      where: { status: PAID_STATUS },
      select: { productName: true, gmv: true, finalRevenue: true },
    }),
  ]);

  // เกณฑ์ตัดสินสถานะเขียว/แดง — ค่าคอมจริงเฉลี่ยรวมทั้งร้าน (settled ÷ GMV) คำนวณสดทุกครั้ง
  // ใช้ค่าเดียวรวมทุกหมวดโดยตั้งใจ: ไม่ต้องมีตารางจับคู่หมวดที่ต้องดูแล และหมวดที่
  // ไม่เคยขายมาก่อนก็ยังมีค่าเทียบเสมอ — คำนวณก่อน rows เพราะป้ายกำกับด้านล่างต้องใช้ค่านี้
  let benchGmv = 0;
  let benchRev = 0;
  for (const o of paidOrders) {
    benchGmv += o.gmv;
    benchRev += o.finalRevenue ?? 0;
  }
  const benchmarkPercent = benchGmv > 0 ? (benchRev / benchGmv) * 100 : 0;
  const benchmarkOrderCount = paidOrders.length;

  const rowsWithoutBadges = candidates.map((c) => ({
    id: c.id,
    name: c.name,
    price: c.price,
    commission: c.commission,
    weeklySales: c.weeklySales,
    categoryLabel: c.categoryLabel,
    capturedOn: c.capturedOn,
    status: c.status,
    note: c.note,
    linkedEntryId: c.linkedEntryId,
    commissionPercent: commissionPercent(c.price, c.commission),
    demandTotal: demandTotal(c.commission, c.weeklySales),
    flags: detectFlags(c.name),
  }));

  const badgeMap = pickCandidateBadges(rowsWithoutBadges);
  const rows: CandidateRow[] = rowsWithoutBadges.map((r) => ({
    ...r,
    badges: badgeMap.get(r.id) ?? [],
  }));

  // สรุปรายหมวด — นับจำนวนและหาวันเก็บล่าสุดของแต่ละหมวด
  const byCategory = new Map<string, { count: number; last: Date }>();
  for (const c of candidates) {
    const key = c.categoryLabel.trim() === "" ? "ไม่ระบุหมวด" : c.categoryLabel;
    const prev = byCategory.get(key);
    if (!prev) {
      byCategory.set(key, { count: 1, last: c.capturedOn });
    } else {
      prev.count++;
      if (c.capturedOn > prev.last) prev.last = c.capturedOn;
    }
  }
  const summaries: CategorySummary[] = [...byCategory.entries()]
    .map(([label, v]) => ({ label, count: v.count, lastCapturedOn: v.last }))
    .sort((a, b) => b.lastCapturedOn.getTime() - a.lastCapturedOn.getTime());

  // แถบเตือนหมวดที่ควรโฟกัส — ต้องมีจำนวนออเดอร์กำกับเสมอ เพราะบางหมวด %สูง
  // แต่มาจากออเดอร์น้อยมาก ถ้าโชว์แต่ % จะอ่านผิดว่าหมวดนั้นดีกว่า
  const focusMap = new Map<string, { gmv: number; rev: number; n: number }>();
  for (const o of paidOrders) {
    const cat = categorize(o.productName);
    if (cat === null) continue;
    const prev = focusMap.get(cat) ?? { gmv: 0, rev: 0, n: 0 };
    prev.gmv += o.gmv;
    prev.rev += o.finalRevenue ?? 0;
    prev.n++;
    focusMap.set(cat, prev);
  }
  const focus: FocusCategory[] = [...focusMap.entries()]
    .map(([label, v]) => ({
      label,
      ratePercent: v.gmv > 0 ? (v.rev / v.gmv) * 100 : 0,
      orderCount: v.n,
    }))
    .sort((a, b) => b.ratePercent - a.ratePercent);

  return {
    rows,
    summaries,
    benchmarkPercent,
    benchmarkOrderCount,
    focus,
  };
}
