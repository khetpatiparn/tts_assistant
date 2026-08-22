import Link from "next/link";
import { ArrowLeft, Compass } from "lucide-react";

import { SoundToggle } from "@/components/sound-toggle";
import { ThemeToggle } from "@/components/theme-toggle";

export function EntryHeader({
  productName,
  children,
}: {
  productName: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="relative bg-header text-header-foreground">
      <div className="px-4 pt-3 sm:px-6">
        <Link
          href="/"
          className="inline-flex h-11 items-center gap-1.5 rounded-md px-2 text-sm text-header-muted transition-colors hover:bg-header-foreground/10 hover:text-header-foreground focus-visible:ring-2 focus-visible:ring-header-active focus-visible:outline-none lg:h-9"
        >
          <ArrowLeft className="size-4" />
          กลับไปรายการ
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 px-4 pt-2 pb-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <Compass className="size-6 shrink-0 text-header-active" strokeWidth={1.75} />
          <div>
            <h1 className="text-xl leading-none font-extrabold text-header-foreground sm:text-2xl">
              Angle <span className="text-sm font-normal text-header-muted">by LAGR</span>
            </h1>
            <p className="mt-1 text-xs text-header-muted">
              ประกอบ Core Prompt สำหรับวิดีโอ TikTok Shop
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="rounded-lg border border-header-muted/40 bg-header-foreground/5 px-4 py-2">
            <p className="max-w-[14rem] truncate text-sm text-header-foreground">
              {productName || "ยังไม่ตั้งชื่อสินค้า"}
            </p>
          </div>
          <SoundToggle />
          <ThemeToggle />
        </div>
      </div>

      {children}

      <div className="brand-divider h-1 w-full" />
    </header>
  );
}
