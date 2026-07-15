"use client";
import type { AffiliateOrderRecord } from "@/lib/dashboard";
export function DashboardPanel({ orders }: { orders: AffiliateOrderRecord[] }) {
  return <div className="text-sm text-muted-foreground">Dashboard ({orders.length} ออเดอร์) — อยู่ระหว่างสร้าง</div>;
}
