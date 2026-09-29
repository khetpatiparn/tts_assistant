"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { ImageOff, Link2 } from "lucide-react";

import {
  createEntryFromCandidate,
  importShowcaseFile,
  setShowcaseDismissed,
  startShowcaseProduct,
} from "@/app/actions";
import { commissionPercent, isCommissionPercentPlausible } from "@/lib/candidates";
import {
  itemsForTab,
  SHOWCASE_STATUS_LABEL,
  type ShowcaseItem,
  type ShowcaseStatus,
} from "@/lib/showcase";
import { cn } from "@/lib/utils";
import { ScannerLinkBox } from "@/components/scanner-link-box";
import { ShowcasePhotoPicker } from "@/components/showcase-photo-picker";
import { Button } from "@/components/ui/button";

const TABS: ShowcaseStatus[] = ["todo", "in_progress", "posted", "dismissed"];

const EMPTY_TEXT: Record<ShowcaseStatus, string> = {
  todo: "ไม่มีสินค้าค้าง — เพิ่มสินค้าเข้า Showcase ใน TikTok แล้วกดปุ่มสแกนใน extension สินค้าใหม่จะมาอยู่ที่นี่",
  in_progress: "ยังไม่มีสินค้าที่กำลังทำ",
  posted: "ยังไม่มีสินค้าที่โพสต์คลิปแล้ว",
  dismissed: "ไม่มีสินค้าที่เลิกทำ",
};

function formatThaiDate(d: Date): string {
  return d.toLocaleDateString("th-TH", { day: "numeric", month: "short" });
}

/**
 * หน้า Showcase — รายการงานที่ต้องทำ (CONTEXT.md) · สถานะคิดเองจากข้อมูล (lib/showcase.ts) ผู้ใช้กดเองแค่
 * "ทำคลิปตัวนี้" (เลือก/ครอปรูปต้นทาง 1 รูป → สร้างงาน + เข้าคิว Flow) กับ "ไม่ทำแล้ว"
 */
export function ShowcaseRoute({ items, scannerToken }: { items: ShowcaseItem[]; scannerToken: string }) {
  const [tab, setTab] = useState<ShowcaseStatus>("todo");
  const [picking, setPicking] = useState<ShowcaseItem | null>(null);
  const [message, setMessage] = useState<{ text: string; entryId?: string; tone: "ok" | "error" } | null>(null);
  const [pending, startTransition] = useTransition();

  const counts = useMemo(() => {
    const c: Record<ShowcaseStatus, number> = { todo: 0, in_progress: 0, posted: 0, dismissed: 0 };
    for (const i of items) c[i.status]++;
    return c;
  }, [items]);
  const visible = useMemo(() => itemsForTab(items, tab), [items, tab]);

  function start(item: ShowcaseItem, photo: File | null) {
    setMessage(null);
    startTransition(async () => {
      try {
        if (photo === null) {
          // ไม่มีรูปของร้านเลย (โหลดไม่สำเร็จตอนนำเข้า) — สร้างงานเปล่า ให้ไปแปะรูปเองในหน้างาน
          const entryId = await createEntryFromCandidate(item.id);
          setMessage({ tone: "ok", entryId, text: `สร้างงาน "${item.name}" แล้ว — สินค้านี้ไม่มีรูป ไปแปะรูปเองในหน้างาน` });
          return;
        }
        const formData = new FormData();
        formData.set("candidateId", item.id);
        formData.set("photo", photo);
        const { entryId, flowEnqueueError } = await startShowcaseProduct(formData);
        setMessage(
          flowEnqueueError
            ? { tone: "error", entryId, text: `สร้างงานแล้ว แต่ส่งเข้าคิว Flow ไม่สำเร็จ (${flowEnqueueError}) — ไปแปะรูปเองในหน้างาน` }
            : { tone: "ok", entryId, text: `ส่ง "${item.name}" เข้าคิว Flow แล้ว — ย้ายไปแท็บ "กำลังทำ"` }
        );
      } catch (e) {
        setMessage({ tone: "error", text: e instanceof Error ? e.message : "เริ่มทำไม่สำเร็จ" });
      }
      // ปิดหน้าต่างเลือกรูปทั้งตอนสำเร็จและพัง — ข้อความผลลัพธ์อยู่บนหน้า ถ้าหน้าต่างยังเปิดจะบังจนไม่เห็น
      setPicking(null);
    });
  }

  function dismiss(item: ShowcaseItem, dismissed: boolean) {
    setMessage(null);
    startTransition(async () => {
      try {
        await setShowcaseDismissed(item.id, dismissed);
      } catch (e) {
        setMessage({ tone: "error", text: e instanceof Error ? e.message : "บันทึกไม่สำเร็จ" });
      }
    });
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* เชื่อม extension ทำครั้งเดียว — พับไว้ ไม่ให้แย่งที่รายการงาน · เปิดเองถ้ายังไม่มีสินค้าเลย (น่าจะยังไม่ได้เชื่อม) */}
      <details
        className="group rounded-xl border border-border bg-surface p-4 leading-relaxed"
        open={items.length === 0}
      >
        <summary className="flex cursor-pointer items-center gap-1.5 text-sm font-medium text-foreground">
          <Link2 className="size-4 shrink-0 text-primary" />
          เชื่อมกับ Showcase Scanner (extension)
        </summary>
        <div className="mt-3 flex flex-col gap-3">
          <ScannerLinkBox token={scannerToken} />
          <form
            className="flex flex-wrap items-center gap-2 text-sm"
            action={(formData) => {
              setMessage(null);
              startTransition(async () => {
                try {
                  const r = await importShowcaseFile(formData);
                  setMessage({ tone: "ok", text: `นำเข้า ${r.added} รายการ` });
                } catch (e) {
                  setMessage({ tone: "error", text: e instanceof Error ? e.message : "นำเข้าไฟล์ไม่สำเร็จ" });
                }
              });
            }}
          >
            <label htmlFor="showcase-json" className="text-muted-foreground">
              ทางสำรอง: นำเข้าไฟล์ .json ที่ดาวน์โหลดจาก extension
            </label>
            <input id="showcase-json" name="file" type="file" accept="application/json" required className="text-sm" />
            <Button type="submit" variant="outline" size="sm" disabled={pending}>
              นำเข้า
            </Button>
          </form>
        </div>
      </details>

      <div className="inline-flex flex-wrap gap-1 self-start rounded-lg border border-border-interactive p-1" role="tablist">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              "inline-flex h-11 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors lg:h-9",
              tab === t
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
            )}
          >
            {SHOWCASE_STATUS_LABEL[t]}
            <span className="font-mono">{counts[t]}</span>
          </button>
        ))}
      </div>

      {message && (
        <p
          className={cn(
            "rounded-lg border p-3 text-sm leading-relaxed",
            message.tone === "ok" ? "border-border bg-surface text-foreground" : "border-destructive text-destructive"
          )}
          role="status"
        >
          {message.text}
          {message.entryId && (
            <>
              {" · "}
              <Link href={`/entry/${message.entryId}`} className="text-primary underline underline-offset-2">
                เปิดงาน
              </Link>
              {" · "}
              <Link href="/flow" className="text-primary underline underline-offset-2">
                ดูคิว Flow
              </Link>
            </>
          )}
        </p>
      )}

      {visible.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface p-6 text-center text-sm leading-relaxed text-muted-foreground">
          {EMPTY_TEXT[tab]}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((item) => {
            const pct = commissionPercent(item.price, item.commission);
            const cover = item.images[0];
            return (
              <li
                key={item.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-3 sm:flex-nowrap"
              >
                {cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/uploads/_candidates/${item.id}/${cover.filename}`}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="size-16 shrink-0 rounded-lg border border-border object-cover"
                  />
                ) : (
                  <span className="flex size-16 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground">
                    <ImageOff className="size-5" />
                  </span>
                )}

                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <p className="line-clamp-2 text-sm leading-relaxed font-medium text-foreground">{item.name}</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    <span className="font-mono">฿{item.price.toLocaleString()}</span>
                    {" · ค่าคอม "}
                    <span className="font-mono">฿{item.commission.toLocaleString()}</span>
                    {isCommissionPercentPlausible(pct) && <span className="font-mono"> ({pct.toFixed(1)}%)</span>}
                    {" · เข้ามา "}
                    {formatThaiDate(item.firstSeen)}
                    {item.images.length > 0 && ` · รูป ${item.images.length}`}
                  </p>
                </div>

                <div className="flex w-full shrink-0 flex-wrap items-center justify-end gap-2 sm:w-auto">
                  {item.status === "todo" && (
                    <>
                      <Button type="button" variant="outline" size="sm" onClick={() => dismiss(item, true)} disabled={pending}>
                        ไม่ทำแล้ว
                      </Button>
                      <Button
                        type="button"
                        onClick={() => (item.images.length === 0 ? start(item, null) : setPicking(item))}
                        disabled={pending}
                      >
                        ทำคลิปตัวนี้
                      </Button>
                    </>
                  )}
                  {item.status === "dismissed" && (
                    <Button type="button" variant="outline" size="sm" onClick={() => dismiss(item, false)} disabled={pending}>
                      กู้คืน
                    </Button>
                  )}
                  {(item.status === "in_progress" || item.status === "posted") && item.linkedEntryId && (
                    <Link
                      href={`/entry/${item.linkedEntryId}`}
                      className="inline-flex h-11 items-center px-2 text-sm text-primary underline underline-offset-2 lg:h-9"
                    >
                      เปิดงาน →
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {picking && (
        <ShowcasePhotoPicker
          candidateId={picking.id}
          productName={picking.name}
          images={picking.images}
          busy={pending}
          onConfirm={(photo) => start(picking, photo)}
          onCancel={() => setPicking(null)}
        />
      )}
    </div>
  );
}
