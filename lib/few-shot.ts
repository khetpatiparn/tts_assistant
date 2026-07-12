import { prisma } from "@/lib/prisma";
import { buildPromptText } from "@/lib/prompt-template";

/**
 * Past entries that shipped real clips, reused to teach the model the exact
 * output format and voice. Excludes the entry being generated so the model
 * never sees the answer it is being asked for.
 *
 * Text-only (brief -> output) on purpose: the originals' photos were attached
 * by hand in ChatGPT and never stored. The examples' job is to lock the format,
 * not to teach image reading — the real photos ride along with the brief.
 */
export async function getFewShotExamples(
  excludeEntryId: string
): Promise<{ brief: string; output: string }[]> {
  const rows = await prisma.promptEntry.findMany({
    where: {
      id: { not: excludeEntryId },
      chatgptOutput: { not: "" },
    },
    orderBy: { createdAt: "desc" },
    take: 2,
  });

  return rows
    .filter((row) => row.chatgptOutput.length > 3000)
    .map((row) => {
      let images: string[] = [];
      try {
        images = JSON.parse(row.images);
      } catch {
        images = [];
      }
      return {
        brief: buildPromptText({
          productInfo: row.productInfo,
          riskModule: row.riskModule,
          extraNotes: row.extraNotes,
          images,
        }),
        output: row.chatgptOutput,
      };
    });
}
