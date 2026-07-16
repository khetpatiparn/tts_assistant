"use client";

import { useState } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  ordersByDay,
  revenueTrend,
  type AffiliateOrderRecord,
} from "@/lib/dashboard";

function baht(n: number): string {
  return "฿" + n.toLocaleString("th-TH", { maximumFractionDigits: 0 });
}

const DAY_MS = 24 * 60 * 60 * 1000;

type RangeKey = "7d" | "30d" | "all";

const RANGES: { key: RangeKey; label: string; days: number | null }[] = [
  { key: "7d", label: "7 วัน", days: 7 },
  { key: "30d", label: "30 วัน", days: 30 },
  { key: "all", label: "ทั้งหมด", days: null },
];

/**
 * ช่วงเวลานับถอยหลังจากวันที่ล่าสุดที่มีข้อมูล (ไม่ใช่วันนี้) —
 * ข้อมูลนำเข้ามือแล้วมักค้างหลายวัน ถ้านับจากวันนี้ ช่วง 7 วันอาจว่างเปล่าทั้งที่มีข้อมูล
 */
function filterByRange(orders: AffiliateOrderRecord[], days: number | null) {
  if (days === null || orders.length === 0) return orders;
  const latest = Math.max(...orders.map((o) => o.orderDate.getTime()));
  const cutoff = latest - (days - 1) * DAY_MS;
  return orders.filter((o) => o.orderDate.getTime() >= cutoff);
}

type DayPoint = { date: string; orders: number; gmv: number };

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: DayPoint }[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 font-mono text-xs shadow-sm">
      <div className="text-muted-foreground">{d.date}</div>
      <div className="text-foreground">GMV {baht(d.gmv)}</div>
      <div className="text-muted-foreground">{d.orders.toLocaleString("th-TH")} ออเดอร์</div>
    </div>
  );
}

/** กราฟ GMV ตามวัน — Recharts, hover ดูรายวันได้ + เลือกช่วงเวลา */
function TimeChart({ orders }: { orders: AffiliateOrderRecord[] }) {
  const [range, setRange] = useState<RangeKey>("all");
  const days = RANGES.find((r) => r.key === range)!.days;
  const data = ordersByDay(filterByRange(orders, days));

  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="flex gap-1">
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => setRange(r.key)}
            className={`rounded-md border px-2 py-0.5 font-mono text-xs ${
              range === r.key
                ? "border-marigold bg-marigold/10 text-marigold"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {data.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          ไม่มีข้อมูลในช่วงนี้
        </p>
      ) : (
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--color-border)"
                vertical={false}
              />
              <XAxis
                dataKey="date"
                tickFormatter={(v: string) => v.slice(5)}
                tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                tickLine={false}
                axisLine={{ stroke: "var(--color-border)" }}
              />
              <YAxis
                tickFormatter={(v: number) => baht(v)}
                tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                tickLine={false}
                axisLine={false}
                width={64}
              />
              <Tooltip
                content={<ChartTooltip />}
                cursor={{ stroke: "var(--color-smoke)", strokeDasharray: "3 3" }}
              />
              <Area
                type="monotone"
                dataKey="gmv"
                stroke="var(--color-rust)"
                strokeWidth={2}
                fill="var(--color-marigold)"
                fillOpacity={0.15}
                dot={{ r: 2.5, fill: "var(--color-rust)", strokeWidth: 0 }}
                activeDot={{ r: 4, fill: "var(--color-rust)" }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

/** sparkline จิ๋วในบรรทัดเดียว — SVG วาดเองเหมือนเดิม (24px ไม่คุ้มใช้ library) */
function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const W = 96;
  const H = 24;
  const max = Math.max(...points, 1);
  const step = W / (points.length - 1);
  const line = points
    .map((p, i) => `${i * step},${H - (p / max) * (H - 4) - 2}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-6 w-24" aria-hidden="true">
      <polyline points={line} className="fill-none stroke-marigold" strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

export function RevenueTrend({ orders }: { orders: AffiliateOrderRecord[] }) {
  const [open, setOpen] = useState(false);
  if (orders.length === 0) return null;
  const { points, direction, changePct } = revenueTrend(orders);

  const Arrow = direction === "up" ? TrendingUp : direction === "down" ? TrendingDown : Minus;
  const arrowClass =
    direction === "up" ? "text-marigold" : direction === "down" ? "text-record" : "text-smoke";
  const pctLabel =
    direction === "flat" ? "ทรงตัว" : `${changePct > 0 ? "+" : ""}${changePct.toFixed(0)}%`;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <span className="font-mono text-[0.7rem] tracking-widest text-smoke uppercase">
          แนวโน้มรายได้
        </span>
        <Sparkline points={points} />
        <span className={`flex items-center gap-1 text-sm ${arrowClass}`}>
          <Arrow className="size-4" />
          {pctLabel}
        </span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="ml-auto font-mono text-xs text-marigold hover:underline"
        >
          {open ? "ซ่อนกราฟ" : "ดูกราฟ"}
        </button>
      </div>
      {open && <TimeChart orders={orders} />}
    </div>
  );
}
