"use client";

import { useActionState, useState } from "react";
import { ChevronDown, ChevronRight, Upload } from "lucide-react";

import { importAffiliateOrders, importClipMetrics } from "@/app/actions";
import type { AffiliateImportSummary, ClipMetricImportSummary } from "@/app/actions";
import { ImportLogPanel } from "@/components/import-log-panel";
import type { ImportLogRecord } from "@/lib/import-log";
import type { ClipMetricRecord } from "@/lib/recommender";
import {
  summarizeOrders,
  type AffiliateOrderRecord,
  type ReminderState,
} from "@/lib/dashboard";
import { Reconciliation } from "@/components/reconciliation";
import { Recommendations } from "@/components/recommendations";
import { ReminderBanner } from "@/components/reminder-banner";
import { RevenueByClipList } from "@/components/revenue-by-clip";
import { RevenueTrend } from "@/components/revenue-charts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function baht(n: number): string {
  return "฿" + n.toLocaleString("th-TH", { maximumFractionDigits: 0 });
}

type ImportState = { summary: AffiliateImportSummary | null; error: string | null };

export function DashboardPanel({
  orders,
  clipMetrics,
  importLogs,
  reminder,
  reminderActive,
  lastOrdersImportedAt,
  lastMetricsImportedAt,
  entries,
  now,
  onOpenEntry,
}: {
  orders: AffiliateOrderRecord[];
  clipMetrics: ClipMetricRecord[];
  importLogs: ImportLogRecord[];
  reminder: ReminderState;
  reminderActive: boolean;
  lastOrdersImportedAt: Date | null;
  lastMetricsImportedAt: Date | null;
  entries: {
    id: string;
    productName: string;
    duplicatedFromId: string | null;
    videoUrl: string;
    postedAt: Date | null;
  }[];
  now: Date;
  onOpenEntry: (entryId: string) => void;
}) {
  const summary = summarizeOrders(orders);

  // กางเองเมื่อข้อมูลถึงรอบต้องนำเข้า — ผู้ใช้ลืมง่าย ระบบจึงยกงานขึ้นมาเองแทนที่จะให้จำ
  // หลังจากนั้นกดสลับเองได้อิสระ (ค่านี้เป็นแค่ค่าตั้งต้นตอน mount)
  const [importsOpen, setImportsOpen] = useState(reminderActive);

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

  const [metricState, metricAction, isImportingMetrics] = useActionState<
    { summary: ClipMetricImportSummary | null; error: string | null },
    FormData
  >(
    async (_prev, formData) => {
      try {
        const summary = await importClipMetrics(formData);
        return { summary, error: null };
      } catch (e) {
        return { summary: null, error: e instanceof Error ? e.message : "อัปโหลดไม่สำเร็จ" };
      }
    },
    { summary: null, error: null }
  );


  return (
    <section className="flex flex-1 flex-col gap-5 rounded-xl border border-border bg-surface p-5 sm:p-6">
      <div className="flex items-center gap-2 border-b border-border pb-3">
        <span className="h-4 w-1 rounded-full bg-primary" />
        <h2 className="text-xs text-primary">
          Dashboard · รายได้ Affiliate
        </h2>
      </div>

      {reminderActive && <ReminderBanner reminder={reminder} />}

      <Recommendations
        entries={entries}
        metrics={clipMetrics}
        orders={orders}
        now={now}
        lastOrdersImportedAt={lastOrdersImportedAt}
        lastMetricsImportedAt={lastMetricsImportedAt}
        onOpenEntry={onOpenEntry}
      />

      {orders.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          ยังไม่มีข้อมูลรายได้ — นำเข้าไฟล์ด้านล่างเพื่อเริ่ม
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {/* เงินจริง — พระเอก */}
            <div className="flex flex-col gap-1 rounded-xl border border-primary/40 bg-primary/5 p-5">
              <span className="text-xs text-primary">
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
            <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-5">
              <span className="text-xs text-muted-foreground">
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
          <p className="text-xs leading-relaxed text-muted-foreground">
            ยอดสั่งรวมทุกสถานะ <span className="font-mono">{baht(summary.totalGmv)}</span> · ขายได้{" "}
            <span className="font-mono">{summary.itemCount.toLocaleString("th-TH")}</span> ชิ้น · ไม่มีสิทธิ์{" "}
            <span className="font-mono">{summary.ineligibleOrders}</span> ออเดอร์ (ไม่ได้ค่าคอม)
            <br />
            {summary.realizedRate !== null && (
              <>*ประเมินจากอัตราค่าคอมจริง{" "}
              <span className="font-mono">{(summary.realizedRate * 100).toFixed(1)}%</span> · </>
            )}
            ตัวเลขฝั่งเงินเท่านั้น (ไม่มียอดวิว) และช้ากว่าจริง ~สัปดาห์ เพราะออเดอร์ทยอย settle
          </p>
        </div>
      )}

      {orders.length > 0 && <RevenueByClipList orders={orders} />}
      {orders.length > 0 && <RevenueTrend orders={orders} />}
      {orders.length > 0 && <Reconciliation orders={orders} />}

      {/* นำเข้าข้อมูล — งานประจำสัปดาห์ อยู่ล่างสุด พับไว้เมื่อยังไม่ถึงรอบ */}
      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <button
          type="button"
          onClick={() => setImportsOpen((open) => !open)}
          aria-expanded={importsOpen}
          className="flex items-center gap-1.5 self-start text-xs text-primary hover:text-primary/80"
        >
          {importsOpen ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
          นำเข้าข้อมูล
        </button>

        {/* แผงสถานะอยู่นอกส่วนที่พับเสมอ — พับหรือกางก็ต้องเห็น */}
        <ImportLogPanel
          logs={importLogs}
          reminder={reminder}
          now={now}
          lastOrdersImportedAt={lastOrdersImportedAt}
          lastMetricsImportedAt={lastMetricsImportedAt}
        />

        {importsOpen && (
          <>
            <form action={action} className="flex flex-wrap items-center gap-2">
              <Input
                type="file"
                name="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="h-auto max-w-xs py-1.5"
                required
              />
              <Button type="submit" size="sm" disabled={isImporting}>
                <Upload className="size-3.5" />
                {isImporting ? "กำลังนำเข้า..." : "นำเข้าไฟล์รายได้"}
              </Button>
              <span className="text-xs text-muted-foreground">
                โหลดจาก TikTok Studio → คำสั่งซื้อในโปรแกรมนายหน้า → ดาวน์โหลด (.xlsx)
              </span>
            </form>

            {state.error && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {state.error}
              </p>
            )}

            {state.summary && (
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                นำเข้า {state.summary.total} ออเดอร์ · จับคู่คลิปได้ {state.summary.matched}
              </div>
            )}

            <form action={metricAction} className="flex flex-wrap items-center gap-2">
              <Input
                type="file"
                name="files"
                accept=".csv,text/csv"
                multiple
                className="h-auto max-w-xs py-1.5"
                required
              />
              <Button
                type="submit"
                size="sm"
                variant="outline"
                disabled={isImportingMetrics}
              >
                <Upload className="size-3.5" />
                {isImportingMetrics ? "กำลังนำเข้า..." : "นำเข้าข้อมูลวิว"}
              </Button>
              <span className="text-xs text-muted-foreground">
                โหลดจาก TikTok Studio → Analytics → Content → Download (.csv) · เลือกได้หลายไฟล์พร้อมกัน (ช่วง 7 + 28 + 60 วัน)
              </span>
            </form>

            {metricState.error && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {metricState.error}
              </p>
            )}

            {metricState.summary && (
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                นำเข้า {metricState.summary.files} ไฟล์ · {metricState.summary.total} คลิป ·
                จับคู่ได้ {metricState.summary.matched} · ไม่มีในแอป {metricState.summary.unmatched}
                {metricState.summary.duplicates.length > 0 && (
                  <span className="text-destructive">
                    {" "}
                    · ไฟล์ที่เคยอัปแล้ว {metricState.summary.duplicates.length} ไฟล์
                  </span>
                )}
                {metricState.summary.failed > 0 && (
                  <span className="text-destructive">
                    {" "}
                    · อ่านไม่ได้ {metricState.summary.failed} ไฟล์
                  </span>
                )}
              </div>
            )}

          </>
        )}
      </div>
    </section>
  );
}
