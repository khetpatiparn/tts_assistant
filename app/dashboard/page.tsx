import { getDashboardData } from "@/lib/entry-queries";
import { AppHeader } from "@/components/app-header";
import { DashboardRoute } from "@/components/dashboard-route";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const now = new Date();
  const data = await getDashboardData(now);

  return (
    <div className="flex min-h-dvh flex-1 flex-col lg:h-dvh lg:overflow-hidden">
      <AppHeader active="dashboard" />
      <div className="flex flex-1 flex-col p-4 sm:p-6 lg:overflow-y-auto">
        {/* ส่งเฉพาะผลสรุป (data.view) ลง client — ห้ามส่งออเดอร์ดิบทั้งตารางกลับมาเป็น prop */}
        <DashboardRoute
          view={data.view}
          reminder={data.reminder}
          reminderActive={data.reminderActive}
          lastOrdersImportedAt={data.lastOrdersImportedAt}
          lastMetricsImportedAt={data.lastMetricsImportedAt}
          now={now}
        />
      </div>
    </div>
  );
}
