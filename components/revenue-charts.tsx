"use client";

import {
  ordersByDay,
  revenueByClip,
  ordersByStatus,
  type AffiliateOrderRecord,
} from "@/lib/dashboard";

function baht(n: number): string {
  return "฿" + n.toLocaleString("th-TH", { maximumFractionDigits: 0 });
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <h3 className="font-mono text-[0.7rem] tracking-widest text-smoke uppercase">
        {title}
      </h3>
      {children}
    </div>
  );
}

/** เส้น GMV ตามวัน */
function TimeChart({ orders }: { orders: AffiliateOrderRecord[] }) {
  const data = ordersByDay(orders);
  if (data.length === 0) return null;
  const W = 640;
  const H = 180;
  const pad = 28;
  const maxGmv = Math.max(...data.map((d) => d.gmv), 1);
  const n = data.length;
  const x = (i: number) => pad + (n === 1 ? 0 : (i / (n - 1)) * (W - 2 * pad));
  const y = (v: number) => H - pad - (v / maxGmv) * (H - 2 * pad);
  const line = data.map((d, i) => `${x(i)},${y(d.gmv)}`).join(" ");
  const area = `${x(0)},${H - pad} ${line} ${x(n - 1)},${H - pad}`;

  return (
    <ChartCard title="GMV ตามวัน">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="กราฟ GMV ตามวัน">
        <polygon points={area} className="fill-marigold/15" />
        <polyline
          points={line}
          className="fill-none stroke-rust"
          strokeWidth={2}
          strokeLinejoin="round"
        />
        {data.map((d, i) => (
          <circle key={d.date} cx={x(i)} cy={y(d.gmv)} r={2.5} className="fill-rust" />
        ))}
        <text x={pad} y={H - 8} className="fill-muted-foreground text-[10px]">
          {data[0].date.slice(5)}
        </text>
        <text x={W - pad} y={H - 8} textAnchor="end" className="fill-muted-foreground text-[10px]">
          {data[n - 1].date.slice(5)}
        </text>
        <text x={pad} y={16} className="fill-muted-foreground text-[10px]">
          สูงสุด {baht(maxGmv)}/วัน
        </text>
      </svg>
    </ChartCard>
  );
}

/** แท่งรายได้ต่อคลิป (จ่ายแล้ว vs รอ) */
function ClipChart({ orders }: { orders: AffiliateOrderRecord[] }) {
  const clips = revenueByClip(orders).slice(0, 10);
  if (clips.length === 0) return null;
  const max = Math.max(...clips.map((c) => c.gmv), 1);

  return (
    <ChartCard title="รายได้ต่อคลิป (บน 10)">
      <div className="flex flex-col gap-2.5">
        {clips.map((c) => (
          <div key={c.contentId} className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-foreground/90">
                {c.productName || c.contentId}
                {c.matchedEntryId === null && (
                  <span className="ml-1 text-marigold">(ยังไม่มี entry)</span>
                )}
              </span>
              <span className="shrink-0 font-mono text-muted-foreground">
                {baht(c.gmv)} · {c.orders} ออเดอร์
              </span>
            </div>
            <div className="flex h-3 overflow-hidden rounded-full bg-muted">
              <div
                className="bg-marigold"
                style={{ width: `${(c.paidGmv / max) * 100}%` }}
                title="จ่ายแล้ว"
              />
              <div
                className="bg-smoke/50"
                style={{ width: `${(c.pendingGmv / max) * 100}%` }}
                title="รอ/ยังไม่จ่าย"
              />
            </div>
          </div>
        ))}
        <div className="flex gap-4 pt-1 font-mono text-[0.65rem] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="inline-block size-2 rounded-full bg-marigold" /> จ่ายแล้ว
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block size-2 rounded-full bg-smoke/50" /> รอ/ยังไม่จ่าย
          </span>
        </div>
      </div>
    </ChartCard>
  );
}

/** แยกตามสถานะ */
function StatusChart({ orders }: { orders: AffiliateOrderRecord[] }) {
  const rows = ordersByStatus(orders);
  if (rows.length === 0) return null;
  const total = rows.reduce((s, r) => s + r.count, 0);

  return (
    <ChartCard title="แยกตามสถานะ">
      <div className="flex flex-col gap-2">
        {rows.map((r) => (
          <div key={r.status} className="flex items-center gap-2 text-xs">
            <span className="w-28 shrink-0 truncate text-foreground/90">{r.status}</span>
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-rust"
                style={{ width: `${(r.count / total) * 100}%` }}
              />
            </div>
            <span className="w-24 shrink-0 text-right font-mono text-muted-foreground">
              {r.count} · {baht(r.gmv)}
            </span>
          </div>
        ))}
      </div>
    </ChartCard>
  );
}

export function RevenueCharts({ orders }: { orders: AffiliateOrderRecord[] }) {
  if (orders.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      <TimeChart orders={orders} />
      <div className="grid gap-3 lg:grid-cols-2">
        <ClipChart orders={orders} />
        <StatusChart orders={orders} />
      </div>
    </div>
  );
}
