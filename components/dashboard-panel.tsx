"use client";

import { useActionState } from "react";
import { Upload, TriangleAlert } from "lucide-react";

import { importAffiliateOrders } from "@/app/actions";
import type { AffiliateImportSummary } from "@/app/actions";
import { summarizeOrders, type AffiliateOrderRecord } from "@/lib/dashboard";
import { RevenueByClipList } from "@/components/revenue-by-clip";
import { RevenueTrend } from "@/components/revenue-charts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function baht(n: number): string {
  return "฿" + n.toLocaleString("th-TH", { maximumFractionDigits: 0 });
}

type ImportState = { summary: AffiliateImportSummary | null; error: string | null };

export function DashboardPanel({ orders }: { orders: AffiliateOrderRecord[] }) {
  const summary = summarizeOrders(orders);

  const [state, action, isImporting] = useActionState<ImportState, FormData>(
    async (_prev, formData) => {
      try {
        const summary = await importAffiliateOrders(formData);
        return { summary, error: null };
      } catch (e) {
        return {
          summary: null,
          error: e instanceof Error ? e.message : "อัปโหลดไม่สำเร็จ",
        };
      }
    },
    { summary: null, error: null }
  );

  return (
    <section className="flex flex-1 flex-col gap-5 rounded-xl border border-border bg-card p-5 sm:p-6">
      <div className="flex items-center gap-2 border-b border-border pb-3">
        <span className="h-4 w-1 rounded-full bg-marigold" />
        <h2 className="font-mono text-xs tracking-widest text-marigold uppercase">
          Dashboard · รายได้ Affiliate
        </h2>
      </div>

      {/* อัปโหลด */}
      <form action={action} className="flex flex-wrap items-center gap-2">
        <Input
          type="file"
          name="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="h-auto max-w-xs py-1.5"
          required
        />
        <Button
          type="submit"
          size="sm"
          disabled={isImporting}
          className="bg-rust text-primary-foreground hover:bg-rust/90"
        >
          <Upload className="size-3.5" />
          {isImporting ? "กำลังนำเข้า..." : "นำเข้าไฟล์รายได้"}
        </Button>
        <span className="font-mono text-[0.7rem] text-muted-foreground">
          โหลดจาก TikTok Studio → คำสั่งซื้อในโปรแกรมนายหน้า → ดาวน์โหลด (.xlsx)
        </span>
      </form>

      {state.error && (
        <p className="rounded-md border border-record/40 bg-record/10 px-3 py-2 text-sm text-record">
          {state.error}
        </p>
      )}

      {state.summary && (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
          นำเข้า {state.summary.total} ออเดอร์ · จับคู่คลิปได้ {state.summary.matched} ·
          ยังไม่มี entry {state.summary.unmatched}
          {state.summary.unmatchedProducts.length > 0 && (
            <div className="mt-2 flex flex-col gap-1 border-t border-border pt-2">
              <span className="flex items-center gap-1.5 font-medium text-foreground/90">
                <TriangleAlert className="size-3.5 text-marigold" />
                สินค้าที่ขายได้แต่ยังไม่มีในแอป — ควรเพิ่ม entry
              </span>
              {state.summary.unmatchedProducts.map((p) => (
                <span key={p.contentId} className="font-mono text-xs text-muted-foreground">
                  {p.productName || p.contentId} ({p.orders} ออเดอร์)
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {orders.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          ยังไม่มีข้อมูลรายได้ — นำเข้าไฟล์ด้านบนเพื่อเริ่ม
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {/* เงินจริง — พระเอก */}
            <div className="flex flex-col gap-1 rounded-xl border border-marigold/40 bg-marigold/5 p-5">
              <span className="font-mono text-[0.65rem] tracking-widest text-marigold uppercase">
                เงินที่ได้จริงแล้ว
              </span>
              <span className="font-display text-4xl text-foreground">
                {baht(summary.settledRevenue)}
              </span>
              <span className="text-xs text-muted-foreground">
                จาก {summary.paidOrderCount.toLocaleString("th-TH")} ออเดอร์ที่ชำระแล้ว
              </span>
            </div>

            {/* กำลังรอ — รอง จางกว่า */}
            <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-5">
              <span className="font-mono text-[0.65rem] tracking-widest text-smoke uppercase">
                กำลังรอ (ยังไม่ใช่เงินเรา)
              </span>
              <span className="font-display text-2xl text-foreground/80">
                {summary.pendingOrders.toLocaleString("th-TH")} ออเดอร์ ·{" "}
                {baht(summary.pendingGmv)}
              </span>
              <span className="text-xs text-muted-foreground">
                {summary.estimatedPendingCommission !== null
                  ? `ประเมินค่าคอมถ้าจ่ายครบ ~${baht(summary.estimatedPendingCommission)}*`
                  : "ยังประเมินค่าคอมไม่ได้ (ยังไม่มีออเดอร์ที่ชำระแล้ว)"}
              </span>
            </div>
          </div>

          {/* แถวเล็กจาง + หมายเหตุความซื่อสัตย์ */}
          <p className="font-mono text-[0.7rem] leading-relaxed text-muted-foreground">
            ยอดสั่งรวมทุกสถานะ {baht(summary.totalGmv)} · ขายได้{" "}
            {summary.itemCount.toLocaleString("th-TH")} ชิ้น · ไม่มีสิทธิ์{" "}
            {summary.ineligibleOrders} ออเดอร์ (ไม่ได้ค่าคอม)
            <br />
            {summary.realizedRate !== null && (
              <>*ประเมินจากอัตราค่าคอมจริง{" "}
              {(summary.realizedRate * 100).toFixed(1)}% · </>
            )}
            ตัวเลขฝั่งเงินเท่านั้น (ไม่มียอดวิว) และช้ากว่าจริง ~สัปดาห์ เพราะออเดอร์ทยอย settle
          </p>
        </div>
      )}

      {orders.length > 0 && <RevenueByClipList orders={orders} />}
      {orders.length > 0 && <RevenueTrend orders={orders} />}
    </section>
  );
}
