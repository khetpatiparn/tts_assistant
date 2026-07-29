"use client";

import { useRouter } from "next/navigation";

import { DashboardPanel } from "@/components/dashboard-panel";
import type { ComponentProps } from "react";

type DashboardPanelProps = ComponentProps<typeof DashboardPanel>;

/**
 * แปลง onOpenEntry ของ DashboardPanel จาก callback ที่เคยตั้ง state ในหน้าเดียว
 * ให้กลายเป็นการเปลี่ยน route แทน — ตัว DashboardPanel ไม่ต้องรู้เรื่อง routing
 */
export function DashboardRoute(props: Omit<DashboardPanelProps, "onOpenEntry">) {
  const router = useRouter();
  return (
    <DashboardPanel
      {...props}
      onOpenEntry={(entryId) => router.push(`/entry/${entryId}`)}
    />
  );
}
