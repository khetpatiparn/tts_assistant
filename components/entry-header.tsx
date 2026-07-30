import Link from "next/link";
import { ArrowLeft, Compass } from "lucide-react";

export function EntryHeader({
  productName,
  children,
}: {
  productName: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="relative bg-ink text-paper">
      <div className="px-4 pt-3 sm:px-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 font-mono text-xs text-paper/50 transition-colors hover:text-paper"
        >
          <ArrowLeft className="size-3.5" />
          กลับไปรายการ
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 px-4 pt-2 pb-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <Compass className="size-6 shrink-0 text-teal" strokeWidth={1.75} />
          <div>
            <h1 className="text-xl leading-none font-extrabold tracking-wide text-paper sm:text-2xl">
              Angle <span className="text-sm font-normal text-paper/50">by LAGR</span>
            </h1>
            <p className="mt-1 text-xs text-paper/60">
              ประกอบ Core Prompt สำหรับวิดีโอ TikTok Shop
            </p>
          </div>
        </div>

        <div className="-rotate-2 rounded-md border border-paper/15 bg-ink-2 px-4 py-2 shadow-[3px_3px_0_0_rgba(0,0,0,0.35)]">
          <p className="max-w-[14rem] truncate font-mono text-sm text-teal">
            {productName || "ยังไม่ตั้งชื่อสินค้า"}
          </p>
        </div>
      </div>

      {children}

      <div className="brand-divider h-1 w-full" />
    </header>
  );
}
