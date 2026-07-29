import { getDashboardData, getEntryRows } from "@/lib/entry-queries";
import { AppHeader } from "@/components/app-header";
import { DashboardRoute } from "@/components/dashboard-route";

export default async function DashboardPage() {
  const [data, rows] = await Promise.all([getDashboardData(), getEntryRows()]);

  return (
    <div className="flex min-h-screen flex-1 flex-col lg:h-screen lg:overflow-hidden">
      <AppHeader active="dashboard" />
      <div className="flex flex-1 flex-col p-4 sm:p-6 lg:overflow-y-auto">
        <DashboardRoute
          orders={data.orders}
          clipMetrics={data.clipMetrics}
          followerActivity={data.followerActivity}
          reminder={data.reminder}
          reminderActive={data.reminderActive}
          lastOrdersImportedAt={data.lastOrdersImportedAt}
          lastMetricsImportedAt={data.lastMetricsImportedAt}
          entries={rows.map((r) => ({
            id: r.id,
            duplicatedFromId: r.duplicatedFromId,
            postedAt: r.postedAt,
            productName: r.productName,
            videoUrl: r.videoUrl,
            postedTimeOfDay: r.postedTimeOfDay,
            postedTimeSource: r.postedTimeSource,
            isScheduledPost: r.isScheduledPost,
          }))}
          now={new Date()}
        />
      </div>
    </div>
  );
}
