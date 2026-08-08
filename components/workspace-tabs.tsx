"use client";

import { cn } from "@/lib/utils";

export type WorkspaceTab = "brief" | "production";

const TABS: { id: WorkspaceTab; label: string }[] = [
  { id: "brief", label: "① Brief & Script" },
  { id: "production", label: "② ผลลัพธ์ & คลิป" },
];

export function WorkspaceTabs({
  active,
  onChange,
  productionDisabled,
}: {
  active: WorkspaceTab;
  onChange: (tab: WorkspaceTab) => void;
  productionDisabled: boolean;
}) {
  return (
    <nav
      className="mx-4 mb-3 inline-flex flex-wrap gap-1 rounded-lg border border-header-muted/40 p-1 sm:mx-6"
      aria-label="มุมมองงาน"
    >
      {TABS.map((tab) => {
        const isDisabled = tab.id === "production" && productionDisabled;
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            disabled={isDisabled}
            aria-current={isActive ? "page" : undefined}
            title={isDisabled ? "ยังไม่ได้บันทึกสินค้านี้" : undefined}
            onClick={() => onChange(tab.id)}
            className={cn(
              "inline-flex h-9 items-center rounded-md px-3 text-sm font-medium transition-colors",
              "focus-visible:ring-2 focus-visible:ring-header-active focus-visible:outline-none",
              isActive
                ? "bg-header-active text-header-active-foreground"
                : "text-header-muted hover:bg-header-foreground/10 hover:text-header-foreground",
              isDisabled && "cursor-not-allowed opacity-40 hover:bg-transparent"
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
