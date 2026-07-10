import { Clapperboard } from "lucide-react";

export function ClapperHeader({
  sceneName,
  takeNumber,
}: {
  sceneName: string;
  takeNumber: number;
}) {
  return (
    <header className="relative bg-ink text-paper">
      <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <Clapperboard className="size-6 shrink-0 text-marigold" strokeWidth={1.75} />
          <div>
            <h1 className="font-display text-xl leading-none tracking-wide text-paper sm:text-2xl">
              Pooling Prompt
            </h1>
            <p className="mt-1 text-xs text-paper/60">
              ประกอบ Core Prompt สำหรับวิดีโอ TikTok Shop
            </p>
          </div>
        </div>

        <div className="-rotate-2 rounded-md border border-paper/15 bg-ink-2 px-4 py-2 shadow-[3px_3px_0_0_rgba(0,0,0,0.35)]">
          <div className="flex items-center gap-4 font-mono text-[0.7rem] tracking-widest text-paper/50 uppercase">
            <span>Take {String(takeNumber).padStart(2, "0")}</span>
          </div>
          <p className="mt-0.5 max-w-[14rem] truncate font-mono text-sm text-marigold">
            {sceneName || "ยังไม่ตั้งชื่อสินค้า"}
          </p>
        </div>
      </div>
      <div className="clapper-stripes h-2 w-full" />
    </header>
  );
}
