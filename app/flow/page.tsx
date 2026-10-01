import { getFlowQueueData } from "@/lib/flow-queries";
import { AppHeader } from "@/components/app-header";
import { FlowRoute } from "@/components/flow-route";

export const dynamic = "force-dynamic";

export default async function FlowPage() {
  const data = await getFlowQueueData();

  return (
    <div className="flex min-h-dvh flex-1 flex-col lg:h-dvh lg:overflow-hidden">
      <AppHeader active="flow" />
      <div className="flex flex-1 flex-col p-4 sm:p-6 lg:min-h-0 lg:overflow-hidden">
        <FlowRoute jobs={data.jobs} worker={data.worker} summary={data.summary} now={new Date()} />
      </div>
    </div>
  );
}
