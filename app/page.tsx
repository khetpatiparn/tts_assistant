import { prisma } from "@/lib/prisma";
import { PromptWorkspace } from "@/components/prompt-workspace";
import { sortEntriesForRail } from "@/lib/entry-sort";

export default async function PoolingPrompt() {
  const [prompts, corePrompts] = await Promise.all([
    prisma.promptEntry.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.corePrompt.findMany({ orderBy: { createdAt: "desc" } }),
  ]);

  return (
    <PromptWorkspace
      prompts={sortEntriesForRail(prompts)}
      corePrompts={corePrompts}
    />
  );
}
