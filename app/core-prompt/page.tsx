import { prisma } from "@/lib/prisma";
import { CorePromptPanel } from "@/components/core-prompt-panel";
import { AppHeader } from "@/components/app-header";

export default async function CorePromptPage() {
  const corePrompts = await prisma.corePrompt.findMany({
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="flex min-h-dvh flex-1 flex-col lg:h-dvh lg:overflow-hidden">
      <AppHeader active="core" />
      <div className="flex flex-1 flex-col gap-5 p-4 sm:p-6 lg:overflow-y-auto">
        <CorePromptPanel
          corePrompts={corePrompts.filter((c) => c.kind === "core")}
          kind="core"
          title="Core Prompt · สร้างวิดีโอ"
        />
        <CorePromptPanel
          corePrompts={corePrompts.filter((c) => c.kind === "caption")}
          kind="caption"
          title="SEO Prompt · Caption & Hashtag"
        />
      </div>
    </div>
  );
}
