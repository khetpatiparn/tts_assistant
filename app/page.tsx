import { prisma } from "@/lib/prisma";
import { PromptWorkspace } from "@/components/prompt-workspace";
import { sortEntriesForRail } from "@/lib/entry-sort";

export default async function PoolingPrompt() {
  const [prompts, orders, clipMetrics] = await Promise.all([
    prisma.promptEntry.findMany({
      orderBy: { createdAt: "desc" },
      include: { productImages: { orderBy: { sortOrder: "asc" } } },
    }),
    prisma.affiliateOrder.findMany({ orderBy: { orderDate: "asc" } }),
    prisma.clipMetric.findMany({ orderBy: { capturedOn: "asc" } }),
  ]);

  return (
    <PromptWorkspace
      prompts={sortEntriesForRail(prompts)}
      affiliateOrders={orders}
      clipMetrics={clipMetrics}
    />
  );
}
