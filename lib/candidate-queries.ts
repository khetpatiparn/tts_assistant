import { prisma } from "@/lib/prisma";
import { PAID_STATUS } from "@/lib/affiliate";
import {
  categorize,
  commissionPercent,
  demandTotal,
  detectFlags,
  latestBatchPerCategory,
  normalizeCategoryLabel,
  pickCandidateBadges,
  type CandidateBadge,
  type CandidateFlag,
} from "@/lib/candidates";

export type CandidateRow = {
  id: string;
  batchId: string;
  name: string;
  price: number;
  commission: number;
  weeklySales: number | null;
  categoryLabel: string;
  capturedOn: Date;
  note: string;
  linkedEntryId: string | null;
  commissionPercent: number;
  demandTotal: number | null;
  flags: CandidateFlag[];
  badges: CandidateBadge[];
  /** แถวนี้อยู่ในชุดล่าสุดของหมวดตัวเองไหม — มุมมองดีฟอลต์ของหน้าแสดงเฉพาะแถวที่เป็น true */
  isLatestForCategory: boolean;
};

export type BatchSummary = {
  id: string;
  capturedOn: Date;
  rowCount: number;
  /** หมวดในชุดนี้พร้อมจำนวนแถว เรียงจากแถวมากไปน้อย */
  categories: { label: string; count: number }[];
  /** true ถ้าชุดนี้เป็นชุดล่าสุดของอย่างน้อย 1 หมวดที่อยู่ในนั้น */
  isLatestForAnyCategory: boolean;
};

export type FocusCategory = {
  label: string;
  ratePercent: number;
  orderCount: number;
};

export async function getCandidatesData(): Promise<{
  rows: CandidateRow[];
  batches: BatchSummary[];
  focus: FocusCategory[];
}> {
  const [candidates, batchRecords, paidOrders] = await Promise.all([
    prisma.productCandidate.findMany({ orderBy: { capturedOn: "desc" } }),
    prisma.candidateBatch.findMany({ orderBy: { capturedOn: "desc" } }),
    prisma.affiliateOrder.findMany({
      where: { status: PAID_STATUS },
      select: { productName: true, gmv: true, finalRevenue: true },
    }),
  ]);

  const latest = latestBatchPerCategory(candidates);

  const rowsWithoutBadges = candidates.map((c) => ({
    id: c.id,
    batchId: c.batchId,
    name: c.name,
    price: c.price,
    commission: c.commission,
    weeklySales: c.weeklySales,
    categoryLabel: c.categoryLabel,
    capturedOn: c.capturedOn,
    note: c.note,
    linkedEntryId: c.linkedEntryId,
    commissionPercent: commissionPercent(c.price, c.commission),
    demandTotal: demandTotal(c.commission, c.weeklySales),
    flags: detectFlags(c.name),
    // latest คีย์ด้วย normalizeCategoryLabel เสมอ (ดูคอมเมนต์ที่ latestBatchPerCategory) —
    // lookup ต้อง normalize categoryLabel ของแถวนี้ก่อนด้วย ไม่งั้นคีย์ไม่ตรงกัน
    isLatestForCategory: latest.get(normalizeCategoryLabel(c.categoryLabel)) === c.batchId,
  }));

  const badgeMap = pickCandidateBadges(rowsWithoutBadges);
  const rows: CandidateRow[] = rowsWithoutBadges.map((r) => ({
    ...r,
    badges: badgeMap.get(r.id) ?? [],
  }));

  // สรุปรายชุด — นับแถวและหมวดที่อยู่ในชุดนั้น
  // ใช้ normalizeCategoryLabel เป็นทั้งคีย์และป้ายที่แสดง — ต่างจากตารางรายแถวที่โชว์
  // categoryLabel ดิบ เพราะที่นี่เป็นก้อนสรุปรวมหลายแถว ไม่มี "ค่าดิบตัวเดียว" ให้แสดงต่อกลุ่ม
  // อยู่แล้ว (นี่คือจุดเดียวกับที่เคยแมปค่าว่างเป็น "ไม่ระบุหมวด" แบบ trim() อย่างเดียว —
  // ตอนนี้ยุบช่องว่างภายในที่ต่างกันเล็กน้อยให้เข้ากลุ่มเดียวกันด้วย ดูเหตุผลที่ normalizeCategoryLabel)
  const countsByBatch = new Map<string, Map<string, number>>();
  for (const c of candidates) {
    const label = normalizeCategoryLabel(c.categoryLabel);
    let perCategory = countsByBatch.get(c.batchId);
    if (perCategory === undefined) {
      perCategory = new Map();
      countsByBatch.set(c.batchId, perCategory);
    }
    perCategory.set(label, (perCategory.get(label) ?? 0) + 1);
  }

  const latestBatchIds = new Set(latest.values());
  const batches: BatchSummary[] = batchRecords.map((b) => {
    const perCategory = countsByBatch.get(b.id) ?? new Map<string, number>();
    const categories = [...perCategory.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b2) => b2.count - a.count);
    return {
      id: b.id,
      capturedOn: b.capturedOn,
      rowCount: categories.reduce((sum, c) => sum + c.count, 0),
      categories,
      isLatestForAnyCategory: latestBatchIds.has(b.id),
    };
  });

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

  return { rows, batches, focus };
}
