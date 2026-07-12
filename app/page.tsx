import { prisma } from "@/lib/prisma";
import { PromptWorkspace } from "@/components/prompt-workspace";

export default async function PoolingPrompt() {
  const [prompts, corePrompts] = await Promise.all([
    prisma.promptEntry.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.corePrompt.findMany({ orderBy: { createdAt: "desc" } }),
  ]);

  return <PromptWorkspace prompts={prompts} corePrompts={corePrompts} />;
}
