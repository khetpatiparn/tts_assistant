import Link from "next/link";
import { Compass } from "lucide-react";

import { cn } from "@/lib/utils";

export type NavKey = "list" | "entry" | "core" | "dashboard";

const NAV: { key: NavKey; href: string; label: string }[] = [
  { key: "list", href: "/", label: "รายการสินค้า" },
  { key: "core", href: "/core-prompt", label: "Core Prompt" },
  { key: "dashboard", href: "/dashboard", label: "รายได้" },
];

/**
 * หัวเว็บของหน้าที่ไม่ผูกกับ entry ตัวใดตัวหนึ่ง
 *
 * แยกจาก EntryHeader เพราะตัวนั้นบังคับให้มีชื่อสินค้า ซึ่งหน้ารายการ
 * หน้ารายได้ และหน้า Core Prompt ไม่มี
 */
export function AppHeader({
  active,
  children,
}: {
  active: NavKey;
  children?: React.ReactNode;
}) {
  return (
    <header className="relative bg-ink text-paper">
      <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <Compass className="size-6 shrink-0 text-teal" strokeWidth={1.75} />
          <div>
            <h1 className="text-xl leading-none font-extrabold tracking-wide text-paper sm:text-2xl">
              Angle <span className="text-sm font-normal text-paper/50">by LAGR</span>
            </h1>
            <p className="mt-1 text-xs text-paper/60">
              ประกอบ Core Prompt สำหรับวิดีโอ TikTok Shop
            </p>
          </div>
        </Link>
        {children}
      </div>

      <nav className="flex flex-wrap gap-1 px-4 pb-3 sm:px-6" aria-label="เมนูหลัก">
        {NAV.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active === item.key ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 font-mono text-xs tracking-wide transition-colors",
              "focus-visible:ring-2 focus-visible:ring-teal focus-visible:outline-none",
              active === item.key
                ? "bg-teal text-primary-foreground"
                : "text-paper/60 hover:bg-ink-2 hover:text-paper"
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="brand-divider h-1 w-full" />
    </header>
  );
}
