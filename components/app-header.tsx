import Link from "next/link";
import { Compass } from "lucide-react";

import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";

export type NavKey = "list" | "entry" | "core" | "dashboard" | "products" | "flow";

const NAV: { key: NavKey; href: string; label: string }[] = [
  { key: "list", href: "/", label: "รายการสินค้า" },
  { key: "products", href: "/products", label: "หาสินค้า" },
  { key: "flow", href: "/flow", label: "คิว Flow" },
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
    <header className="relative bg-header text-header-foreground">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
        <Link href="/" className="flex items-center gap-2.5">
          <Compass className="size-6 shrink-0 text-header-active" strokeWidth={1.75} />
          <div>
            <h1 className="text-lg leading-none font-extrabold text-header-foreground sm:text-xl lg:text-2xl">
              Angle <span className="text-sm font-normal text-header-muted">by LAGR</span>
            </h1>
            {/* คำโปรยเป็นข้อมูลเสริมล้วน — บนมือถือมันกินความสูงที่ควรเป็นของเนื้อหา */}
            <p className="mt-1 hidden text-xs leading-relaxed text-header-muted sm:block">
              ประกอบ Core Prompt สำหรับวิดีโอ TikTok Shop
            </p>
          </div>
        </Link>
        <div className="flex items-center gap-2">
          {children}
          <ThemeToggle />
        </div>
      </div>

      {/* กลุ่มตัวเลือก: กรอบรวมรอบทั้งกลุ่มเป็นตัวบอกว่าทั้งแถวกดได้
          ตัวที่ไม่ได้เลือกจึงไม่ต้องมีขอบของตัวเอง (สเปกหัวข้อ 6.2) */}
      <nav
        className="mx-4 mb-3 flex max-w-full gap-1 overflow-x-auto rounded-lg border border-header-muted/40 p-1 sm:mx-6 sm:inline-flex sm:flex-wrap sm:overflow-visible"
        aria-label="เมนูหลัก"
      >
        {NAV.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active === item.key ? "page" : undefined}
            className={cn(
              "inline-flex h-11 items-center rounded-md px-3 text-sm font-medium transition-colors lg:h-9",
              "focus-visible:ring-2 focus-visible:ring-header-active focus-visible:outline-none",
              active === item.key
                ? "bg-header-active text-header-active-foreground"
                : "text-header-muted hover:bg-header-foreground/10 hover:text-header-foreground"
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
