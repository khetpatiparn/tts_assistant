"use client";

import { useTransition } from "react";
import { TriangleAlert, Plus } from "lucide-react";

import { createEntryFromOrder } from "@/app/actions";
import type { DashboardView } from "@/lib/dashboard-view";
import { ClipThumbnail } from "@/components/clip-thumbnail";
import { Button } from "@/components/ui/button";

/** unmatched = สินค้าที่ขายได้แต่ยังไม่มี entry (unmatchedProducts ใน lib/dashboard.ts คำนวณฝั่ง server) */
export function Reconciliation({ unmatched }: { unmatched: DashboardView["unmatched"] }) {
  const [isPending, startTransition] = useTransition();

  if (unmatched.length === 0) return null;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-primary/40 bg-primary/5 p-4">
      <span className="flex items-center gap-1.5 font-medium text-foreground/90">
        <TriangleAlert className="size-4 text-primary" />
        ขายได้แต่ยังไม่มีในแอป — ควรเพิ่ม entry
      </span>
      {unmatched.map((u) => (
        <div key={u.contentId} className="flex items-center gap-3">
          <ClipThumbnail contentId={u.contentId} />
          <span className="min-w-0 flex-1 truncate text-sm text-foreground/90">
            {u.productName || u.contentId}{" "}
            <span className="text-xs text-muted-foreground">
              (<span className="font-mono">{u.orders}</span> ออเดอร์)
            </span>
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                await createEntryFromOrder(u.contentId, u.productName);
              })
            }
          >
            <Plus className="size-3.5" />
            สร้าง entry
          </Button>
        </div>
      ))}
    </div>
  );
}
