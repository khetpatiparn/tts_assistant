"use client";

import { useMemo, useTransition } from "react";
import { TriangleAlert, Plus } from "lucide-react";

import { createEntryFromOrder } from "@/app/actions";
import type { AffiliateOrderRecord } from "@/lib/dashboard";
import { ClipThumbnail } from "@/components/clip-thumbnail";
import { Button } from "@/components/ui/button";

export function Reconciliation({ orders }: { orders: AffiliateOrderRecord[] }) {
  const [isPending, startTransition] = useTransition();

  // สินค้าที่ขายได้แต่ยังไม่มี entry — รวมตาม content id
  const unmatched = useMemo(() => {
    const map = new Map<
      string,
      { contentId: string; productName: string; orders: number }
    >();
    for (const o of orders) {
      if (o.matchedEntryId !== null) continue;
      const ex = map.get(o.contentId);
      if (ex) ex.orders++;
      else map.set(o.contentId, { contentId: o.contentId, productName: o.productName, orders: 1 });
    }
    return [...map.values()].sort((a, b) => b.orders - a.orders);
  }, [orders]);

  if (unmatched.length === 0) return null;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-marigold/40 bg-marigold/5 p-4">
      <span className="flex items-center gap-1.5 font-medium text-foreground/90">
        <TriangleAlert className="size-4 text-marigold" />
        ขายได้แต่ยังไม่มีในแอป — ควรเพิ่ม entry
      </span>
      {unmatched.map((u) => (
        <div key={u.contentId} className="flex items-center gap-3">
          <ClipThumbnail contentId={u.contentId} />
          <span className="min-w-0 flex-1 truncate text-sm text-foreground/90">
            {u.productName || u.contentId}{" "}
            <span className="font-mono text-xs text-muted-foreground">
              ({u.orders} ออเดอร์)
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
