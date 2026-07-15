"use client";

import { cn } from "@/lib/utils";

export type WorkspaceTab = "brief" | "production" | "core" | "dashboard";

const TABS: { id: WorkspaceTab; label: string }[] = [
  { id: "brief", label: "① Brief & Script" },
  { id: "production", label: "② ผลลัพธ์ & คลิป" },
  { id: "core", label: "③ Core Prompt" },
  { id: "dashboard", label: "④ รายได้" },
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
    <nav className="flex flex-wrap gap-1 px-4 pb-3 sm:px-6" aria-label="มุมมองงาน">
      {TABS.map((tab) => {
        const isDisabled = tab.id === "production" && productionDisabled;
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            disabled={isDisabled}
            aria-current={isActive ? "page" : undefined}
            title={isDisabled ? "เลือกรายการจากประวัติก่อน" : undefined}
            onClick={() => onChange(tab.id)}
            className={cn(
              "rounded-md px-3 py-1.5 font-mono text-xs tracking-wide transition-colors",
              "focus-visible:ring-2 focus-visible:ring-marigold focus-visible:outline-none",
              isActive
                ? "bg-marigold text-ink"
                : "text-paper/60 hover:bg-ink-2 hover:text-paper",
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
