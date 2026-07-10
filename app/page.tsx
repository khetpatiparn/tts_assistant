import { prisma } from "@/lib/prisma";
import { PromptWorkspace } from "@/components/prompt-workspace";

export default async function PoolingPrompt() {
  const prompts = await prisma.promptEntry.findMany({
    orderBy: { createdAt: "desc" },
  });

  return <PromptWorkspace prompts={prompts} />;
}
