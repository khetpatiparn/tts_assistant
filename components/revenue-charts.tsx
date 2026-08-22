"use client";

import { useEffect, useState } from "react";
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
  weeklyGmvTrend,
  type AffiliateOrderRecord,
} from "@/lib/dashboard";

function baht(n: number): string {
  return "฿" + n.toLocaleString("th-TH", { maximumFractionDigits: 0 });
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Recharts รับค่าผ่าน props (width ของแกน, ความถี่ของ tick) ไม่ใช่ CSS
 * จึงใช้ breakpoint ของ Tailwind ไม่ได้ ต้องอ่านความกว้างจริงจาก matchMedia
 *
 * ค่าเริ่มต้นเป็น false เพื่อให้ตรงกับฝั่งเซิร์ฟเวอร์ (ไม่มี window) แล้ว effect
 * ค่อยแก้ให้ถูกหลัง mount — ป้องกัน hydration mismatch
 */
function useIsNarrow(): boolean {
  const [isNarrow, setIsNarrow] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setIsNarrow(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return isNarrow;
}

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
    <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs shadow-sm">
      <div className="font-mono text-muted-foreground">{d.date}</div>
      <div className="font-mono text-foreground">GMV {baht(d.gmv)}</div>
      <div className="text-muted-foreground">
        <span className="font-mono">{d.orders.toLocaleString("th-TH")}</span> ออเดอร์
      </div>
    </div>
  );
}

type WeekPoint = { weekStart: string; gmv: number };

function WeeklyTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: WeekPoint }[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs shadow-sm">
      <div className="text-muted-foreground">
        สัปดาห์ <span className="font-mono">{d.weekStart}</span>
      </div>
      <div className="font-mono text-foreground">GMV {baht(d.gmv)}</div>
    </div>
  );
}

/** ยอดขาย (GMV) รายสัปดาห์ 8 สัปดาห์ล่าสุด — ภาพรวมยาว ต่างจาก TimeChart ที่เป็นรายวัน */
function WeeklyTrendChart({ orders }: { orders: AffiliateOrderRecord[] }) {
  const isNarrow = useIsNarrow();
  const data = weeklyGmvTrend(orders, 8);
  if (data.length < 2) return null;

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-muted-foreground">
        แนวโน้มยอดขายรายสัปดาห์ (8 สัปดาห์ล่าสุด)
      </span>
      <div className="h-40 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--color-border)"
              vertical={false}
            />
            <XAxis
              dataKey="weekStart"
              tickFormatter={(v: string) => v.slice(5)}
              tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
              tickLine={false}
              axisLine={{ stroke: "var(--color-border)" }}
              // จอแคบแสดง tick เว้นระยะ ไม่งั้นวันที่ทับกันจนอ่านไม่ออก
              interval={isNarrow ? "preserveStartEnd" : "preserveEnd"}
              minTickGap={isNarrow ? 32 : 8}
            />
            <YAxis
              tickFormatter={(v: number) => baht(v)}
              tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
              tickLine={false}
              axisLine={false}
              width={isNarrow ? 40 : 64}
            />
            <Tooltip
              content={<WeeklyTooltip />}
              cursor={{ stroke: "var(--color-muted-foreground)", strokeDasharray: "3 3" }}
            />
            <Area
              type="monotone"
              dataKey="gmv"
              stroke="var(--color-status-warning)"
              strokeWidth={2}
              fill="var(--color-primary)"
              fillOpacity={0.15}
              dot={{ r: 2.5, fill: "var(--color-status-warning)", strokeWidth: 0 }}
              activeDot={{ r: 4, fill: "var(--color-status-warning)" }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** กราฟ GMV ตามวัน — Recharts, hover ดูรายวันได้ + เลือกช่วงเวลา */
function TimeChart({ orders }: { orders: AffiliateOrderRecord[] }) {
  const isNarrow = useIsNarrow();
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
            className={`inline-flex h-11 items-center rounded-md border px-3 text-xs lg:h-9 ${
              range === r.key
                ? "border-primary bg-primary/10 text-primary"
                : "border-border-interactive text-muted-foreground hover:text-foreground"
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
                // จอแคบแสดง tick เว้นระยะ ไม่งั้นวันที่ทับกันจนอ่านไม่ออก
                interval={isNarrow ? "preserveStartEnd" : "preserveEnd"}
                minTickGap={isNarrow ? 32 : 8}
              />
              <YAxis
                tickFormatter={(v: number) => baht(v)}
                tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                tickLine={false}
                axisLine={false}
                width={isNarrow ? 40 : 64}
              />
              <Tooltip
                content={<ChartTooltip />}
                cursor={{ stroke: "var(--color-muted-foreground)", strokeDasharray: "3 3" }}
              />
              <Area
                type="monotone"
                dataKey="gmv"
                stroke="var(--color-status-warning)"
                strokeWidth={2}
                fill="var(--color-primary)"
                fillOpacity={0.15}
                dot={{ r: 2.5, fill: "var(--color-status-warning)", strokeWidth: 0 }}
                activeDot={{ r: 4, fill: "var(--color-status-warning)" }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

/**
 * แท่งคู่เทียบยอดรวม 2 ช่วง (ไม่ใช่เส้นรายวัน) — ข้อมูลระดับวันของช่องนี้เบาบางเกินกว่าจะเล่า
 * "แนวโน้มรายวัน" ได้น่าเชื่อถือ (มัธยฐาน 0 ออเดอร์/วัน) เส้นจะเต็มไปด้วยช่วงแบนราบเป็น 0 สลับพีค
 * ซึ่งเป็น noise ไม่ใช่สัญญาณจริง แท่งคู่สื่อแค่สิ่งที่คำนวณจริง (ผลรวม 2 ก้อน) ไม่มากไปกว่านั้น
 */
function WindowCompareBars({ previous, current }: { previous: number; current: number }) {
  const max = Math.max(previous, current, 1);
  return (
    <div className="flex h-6 items-end gap-1" aria-hidden="true">
      <div
        className="w-3 rounded-sm bg-muted-foreground/50"
        style={{ height: `${Math.max((previous / max) * 100, 4)}%` }}
        title="7 วันก่อนหน้า"
      />
      <div
        className="w-3 rounded-sm bg-primary"
        style={{ height: `${Math.max((current / max) * 100, 4)}%` }}
        title="7 วันล่าสุด"
      />
    </div>
  );
}

export function RevenueTrend({ orders }: { orders: AffiliateOrderRecord[] }) {
  const [open, setOpen] = useState(false);
  if (orders.length === 0) return null;
  const { currentWindowGmv, previousWindowGmv, direction, changePct } = revenueTrend(orders);

  const Arrow = direction === "up" ? TrendingUp : direction === "down" ? TrendingDown : Minus;
  const arrowClass =
    direction === "up"
      ? "text-primary"
      : direction === "down"
        ? "text-destructive"
        : "text-muted-foreground";
  const pctLabel =
    direction === "flat" ? "ทรงตัว" : `${changePct > 0 ? "+" : ""}${changePct.toFixed(0)}%`;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground">
          แนวโน้มรายได้
        </span>
        <WindowCompareBars previous={previousWindowGmv} current={currentWindowGmv} />
        <span className={`flex items-center gap-1 text-sm ${arrowClass}`}>
          <Arrow className="size-4" />
          {pctLabel}
        </span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="ml-auto text-xs text-primary hover:underline"
        >
          {open ? "ซ่อนกราฟ" : "ดูกราฟ"}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        ยอดขาย (GMV) 7 วันล่าสุด <span className="font-mono">{baht(currentWindowGmv)}</span> · 7 วันก่อนหน้า{" "}
        <span className="font-mono">{baht(previousWindowGmv)}</span>
      </p>
      {open && (
        <>
          <WeeklyTrendChart orders={orders} />
          <TimeChart orders={orders} />
        </>
      )}
    </div>
  );
}
