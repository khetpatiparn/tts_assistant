"use client";

import { useState } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

import {
  ordersByDay,
  revenueTrend,
  type AffiliateOrderRecord,
} from "@/lib/dashboard";

function baht(n: number): string {
  return "฿" + n.toLocaleString("th-TH", { maximumFractionDigits: 0 });
}

/** เส้น GMV ตามวัน — กางจากปุ่มดูกราฟ */
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
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 w-full" role="img" aria-label="กราฟ GMV ตามวัน">
      <polygon points={area} className="fill-marigold/15" />
      <polyline points={line} className="fill-none stroke-rust" strokeWidth={2} strokeLinejoin="round" />
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
  );
}

/** sparkline จิ๋วในบรรทัดเดียว */
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
