/**
 * ตรวจ buildDashboardView (lib/dashboard-view.ts) — ผลสรุปที่หน้า /dashboard ส่งลง client แทนออเดอร์ดิบ
 *
 * ใช้ fixture สังเคราะห์ ไม่แตะ DB · รัน: npx tsx scripts/check-dashboard-view.ts
 * เน้นกฎเรื่องเงินใน docs/agents/dashboard.md: revenueByClip ต้องแบ่ง 3 ทาง (จ่ายแล้ว/รอ/ไม่มีสิทธิ์)
 * ให้ตรงกับ summarizeOrders เสมอ และ view ต้องไม่พาออเดอร์ดิบติดไปด้วย
 */
import assert from "node:assert/strict";

import { PAID_STATUS } from "@/lib/affiliate";
import {
  INELIGIBLE_STATUS,
  filterByRange,
  ordersByDay,
  type AffiliateOrderRecord,
} from "@/lib/dashboard";
import { buildDashboardView } from "@/lib/dashboard-view";
import { repeatStatus } from "@/lib/angle";
import { groupLatestRound } from "@/lib/import-log";
import type { ClipMetricRecord } from "@/lib/recommender";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`PASS  ${name}`);
}

const PENDING = "รอดำเนินการ";

function order(
  i: number,
  over: Partial<AffiliateOrderRecord> & { day: number }
): AffiliateOrderRecord {
  const { day, ...rest } = over;
  return {
    orderId: `o${i}`,
    productName: "สินค้า",
    contentId: "c1",
    status: PAID_STATUS,
    gmv: 100,
    itemsSold: 1,
    itemsRefunded: 0,
    actualCommission: 10,
    finalRevenue: 10,
    orderDate: new Date(2026, 8, day, 14, 0),
    matchedEntryId: "e1",
    importedAt: new Date(2026, 9, 1, 9, 0),
    ...rest,
  };
}

const orders: AffiliateOrderRecord[] = [
  order(1, { day: 1, contentId: "c1", gmv: 120 }),
  order(2, { day: 2, contentId: "c1", gmv: 80, status: PENDING, finalRevenue: null }),
  order(3, { day: 3, contentId: "c1", gmv: 50, status: INELIGIBLE_STATUS, finalRevenue: null }),
  order(4, { day: 20, contentId: "c2", gmv: 300, matchedEntryId: "e2" }),
  order(5, { day: 25, contentId: "c2", gmv: 40, status: PENDING, finalRevenue: null, matchedEntryId: "e2" }),
  order(6, { day: 28, contentId: "c3", gmv: 70, matchedEntryId: null, productName: "ยังไม่มีในแอป" }),
  order(7, { day: 29, contentId: "c3", gmv: 30, status: PENDING, finalRevenue: null, matchedEntryId: null, productName: "ยังไม่มีในแอป" }),
  order(8, { day: 29, contentId: "c4", gmv: 10, status: INELIGIBLE_STATUS, finalRevenue: null, matchedEntryId: null, productName: "อีกตัว" }),
];

function metric(entryId: string, views: number, day: number): ClipMetricRecord {
  return {
    id: `${entryId}-${day}`,
    videoId: `v-${entryId}`,
    matchedEntryId: entryId,
    title: "",
    postedDate: "",
    views,
    likes: 0,
    comments: 0,
    shares: 0,
    capturedOn: new Date(Date.UTC(2026, 8, day)),
    importedAt: new Date(2026, 8, day, 10, 0),
  };
}

const entries = [
  { id: "e1", productName: "สินค้า", duplicatedFromId: null, videoUrl: "https://x/video/1", postedAt: new Date(Date.UTC(2026, 7, 30)) },
  { id: "e2", productName: "ขายดี", duplicatedFromId: null, videoUrl: "https://x/video/2", postedAt: new Date(Date.UTC(2026, 8, 15)) },
  { id: "e3", productName: "ซ้ำของ e2", duplicatedFromId: "e2", videoUrl: "", postedAt: null },
  { id: "e4", productName: "ไม่มีวิว", duplicatedFromId: null, videoUrl: "", postedAt: null },
];

const now = new Date(2026, 9, 1, 12, 0);

const view = buildDashboardView({
  orders,
  // e2 ได้ 2 ออเดอร์จาก 50 วิว (conv สูงกว่าช่องมาก) และมี e3 ทำซ้ำอยู่ — ใช้ตรวจว่ามี task + repeat ติดมา
  clipMetrics: [metric("e1", 20000, 20), metric("e2", 40, 20), metric("e1", 21000, 27), metric("e2", 50, 27)],
  importLogs: [
    { kind: "clips", uploadedAt: new Date(2026, 8, 27, 9, 0), rowCount: 15, summary: "a" },
    { kind: "clips", uploadedAt: new Date(2026, 8, 27, 9, 5), rowCount: 15, summary: "b" },
    { kind: "orders", uploadedAt: new Date(2026, 8, 20, 9, 0), rowCount: 8, summary: "c" },
    { kind: "orders", uploadedAt: new Date(2026, 9, 1, 9, 0), rowCount: 8, summary: "d" },
  ],
  entries,
  now,
});

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

check("revenueByClip แบ่ง 3 ทางรวมกันได้เท่า summarizeOrders (จ่ายแล้ว/รอ/ไม่มีสิทธิ์)", () => {
  const s = view.summary;
  assert.equal(sum(view.clips.map((c) => c.paidGmv)), s.paidGmv);
  assert.equal(sum(view.clips.map((c) => c.pendingGmv)), s.pendingGmv);
  assert.equal(sum(view.clips.map((c) => c.ineligibleGmv)), s.ineligibleGmv);
  assert.equal(sum(view.clips.map((c) => c.gmv)), s.totalGmv);
  assert.equal(sum(view.clips.map((c) => c.orders)), s.orderCount);
  assert.equal(s.paidGmv + s.pendingGmv + s.ineligibleGmv, s.totalGmv);
});

check("GMV ≠ เงินจริง: settledRevenue มาจาก finalRevenue ไม่ใช่ GMV", () => {
  assert.equal(view.summary.totalGmv, 700);
  assert.equal(view.summary.settledRevenue, 30);
  assert.equal(view.summary.ineligibleOrders, 2);
});

check("กราฟรายวันครบ 3 ช่วง และตรงกับ ordersByDay(filterByRange) ทุกช่วง", () => {
  assert.deepEqual(
    view.daily.map((d) => d.key),
    ["7d", "30d", "all"]
  );
  const days = { "7d": 7, "30d": 30, all: null } as const;
  for (const d of view.daily) {
    assert.deepEqual(d.points, ordersByDay(filterByRange(orders, days[d.key])));
  }
  // 7 วันนับจากออเดอร์ล่าสุด (29 ก.ย.) ไม่ใช่จาก now
  assert.deepEqual(
    view.daily[0].points.map((p) => p.date),
    ["2026-09-25", "2026-09-28", "2026-09-29"]
  );
});

check("สินค้าที่ขายได้แต่ยังไม่มี entry รวมตาม content id เรียงออเดอร์มาก→น้อย", () => {
  assert.deepEqual(view.unmatched, [
    { contentId: "c3", productName: "ยังไม่มีในแอป", orders: 2 },
    { contentId: "c4", productName: "อีกตัว", orders: 1 },
  ]);
});

check("งานรอบนี้: repeat ที่ติดมากับแต่ละ task = repeatStatus ของ entry นั้น", () => {
  assert.ok(view.recommendations.tasks.length > 0, "fixture ควรมีอย่างน้อย 1 งาน");
  for (const t of view.recommendations.tasks) {
    assert.deepEqual(t.repeat, repeatStatus(entries, t.entryId));
  }
  const e2 = view.recommendations.tasks.find((t) => t.entryId === "e2");
  assert.ok(e2, "e2 (conv สูง) ควรเป็นงาน");
  assert.equal(e2.repeat.repeats, 1);
  assert.equal(e2.repeat.hasUnposted, true);
});

check("ตัวนับใต้แผงงาน: คลิปที่ตรวจ / entry ที่ยังไม่มีวิว / มี snapshot 2 วันแล้ว", () => {
  assert.equal(view.recommendations.checkedClips, 2);
  assert.equal(view.recommendations.missingMetrics, 2);
  assert.equal(view.recommendations.hasDelta, true);
  const single = buildDashboardView({
    orders,
    clipMetrics: [metric("e1", 10, 20)],
    importLogs: [],
    entries,
    now,
  });
  assert.equal(single.recommendations.hasDelta, false);
});

check("log การนำเข้า = groupLatestRound", () => {
  assert.deepEqual(
    view.importRounds,
    groupLatestRound([
      { kind: "clips", uploadedAt: new Date(2026, 8, 27, 9, 0), rowCount: 15, summary: "a" },
      { kind: "clips", uploadedAt: new Date(2026, 8, 27, 9, 5), rowCount: 15, summary: "b" },
      { kind: "orders", uploadedAt: new Date(2026, 8, 20, 9, 0), rowCount: 8, summary: "c" },
      { kind: "orders", uploadedAt: new Date(2026, 9, 1, 9, 0), rowCount: 8, summary: "d" },
    ])
  );
});

check("view ไม่พาออเดอร์ดิบติดไป (ไม่มี orderId / ไม่มีรายการยาวเท่าจำนวนออเดอร์)", () => {
  const json = JSON.stringify(view);
  assert.ok(!json.includes('"orderId"'));
  assert.ok(!json.includes('"actualCommission"'));
});

check("ไม่มีออเดอร์เลย: view ยังสร้างได้ (หน้าโชว์ข้อความ 'ยังไม่มีข้อมูลรายได้')", () => {
  const empty = buildDashboardView({ orders: [], clipMetrics: [], importLogs: [], entries, now });
  assert.equal(empty.summary.orderCount, 0);
  assert.deepEqual(empty.clips, []);
  assert.deepEqual(empty.weekly, []);
  assert.ok(empty.daily.every((d) => d.points.length === 0));
});

console.log(`\nผ่านทุกเคส (${passed})`);
