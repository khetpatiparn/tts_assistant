"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { ImageOff, Link2 } from "lucide-react";

import {
  clearRequiredHashtags,
  createEntryFromCandidate,
  importShowcaseFile,
  retryShowcasePhoto,
  setRequiredHashtags,
  setShowcaseDismissed,
  startShowcaseProduct,
} from "@/app/actions";
import { commissionPercent, isCommissionPercentPlausible } from "@/lib/candidates";
import { planHashtagApply, suggestHashtags, visibleSelection } from "@/lib/required-hashtag";
import {
  itemsForTab,
  SHOWCASE_STATUS_LABEL,
  type ShowcaseItem,
  type ShowcaseStatus,
} from "@/lib/showcase";
import { cn } from "@/lib/utils";
import { ScannerLinkBox } from "@/components/scanner-link-box";
import { ShowcasePhotoPicker, shopPhotoSrc } from "@/components/showcase-photo-picker";
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
  // retry = สินค้าที่เริ่มทำแล้ว ส่งรูปต้นทางใหม่ (มีงาน Flow = เปลี่ยนรูปต้นทางของงานเดิม ไม่มี = เข้าคิวใหม่)
  const [picking, setPicking] = useState<{ item: ShowcaseItem; retry: boolean } | null>(null);
  const [message, setMessage] = useState<{ text: string; entryId?: string; tone: "ok" | "error" } | null>(null);
  const [pending, startTransition] = useTransition();
  // ติ๊กเลือกสินค้า (sourceProductId) เพื่อใส่แฮชแท็กที่ต้องลงทีเดียวหลายตัว · เปลี่ยนแท็บ = ล้าง ไม่งั้นจะใส่ให้ตัวที่มองไม่เห็น
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [hashtagText, setHashtagText] = useState("");
  const suggestions = useMemo(() => suggestHashtags(items.map((i) => i.hashtags)), [items]);

  const counts = useMemo(() => {
    const c: Record<ShowcaseStatus, number> = { todo: 0, in_progress: 0, posted: 0, dismissed: 0 };
    for (const i of items) c[i.status]++;
    return c;
  }, [items]);
  const visible = useMemo(() => itemsForTab(items, tab), [items, tab]);
  // ที่ติ๊กไว้ แต่ยังอยู่ในแท็บที่เห็น — ติ๊กแล้วกด "ไม่ทำแล้ว"/"ทำคลิปตัวนี้" แถวย้ายแท็บ แต่ id ยังค้างใน selected
  const selectedIds = useMemo(
    () => visibleSelection(selected, visible.map((i) => i.sourceProductId)),
    [selected, visible]
  );

  function retry(item: ShowcaseItem, photo: File, extra: string) {
    setMessage(null);
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.set("candidateId", item.id);
        formData.set("photo", photo);
        formData.set("extraPrompt", extra);
        const { entryId, error } = await retryShowcasePhoto(formData);
        setMessage(
          error !== null
            ? { tone: "error", text: error }
            : { tone: "ok", entryId, text: `ส่งรูปใหม่ของ "${item.name}" แล้ว — บอทจะวาดรอบ 1 ใหม่ด้วยรูปนี้` }
        );
      } catch (e) {
        setMessage({ tone: "error", text: e instanceof Error ? e.message : "ส่งรูปใหม่ไม่สำเร็จ" });
      }
      setPicking(null);
    });
  }

  function start(item: ShowcaseItem, photo: File | null, extra = "") {
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
        formData.set("extraPrompt", extra);
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

  function toggle(sourceProductId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sourceProductId)) next.delete(sourceProductId);
      else next.add(sourceProductId);
      return next;
    });
  }

  function applyHashtags() {
    setMessage(null);
    // ตรวจที่หน้าจอก่อน: server action ที่ throw ใน production ถูกซ่อนข้อความ (ผู้ใช้จะไม่เห็นเหตุผลภาษาไทย)
    const plan = planHashtagApply(selected, visible.map((i) => i.sourceProductId), hashtagText);
    if (plan.ok === false) {
      setMessage({ tone: "error", text: plan.message });
      return;
    }
    startTransition(async () => {
      try {
        const { updated } = await setRequiredHashtags(plan.ids, plan.text);
        setMessage({ tone: "ok", text: `ใส่แฮชแท็กที่ต้องลงให้ ${updated} สินค้าแล้ว` });
        // ล้างทั้งช่องพิมพ์และที่เลือก — ค่าเก่าค้างแล้วไปใช้กับชุดถัดไปโดยไม่ตั้งใจอันตรายกว่ากดเลือกใหม่
        setHashtagText("");
        setSelected(new Set());
      } catch (e) {
        // production ซ่อนข้อความ error ของ action — ใช้ข้อความไทยตายตัวแทน (ดู comment ด้านบน)
        console.error("setRequiredHashtags:", e);
        setMessage({ tone: "error", text: "ใส่แฮชแท็กไม่สำเร็จ — ลองใหม่อีกครั้ง (ถ้ายังไม่ได้ ให้เช็กว่ารัน migrate ฐานข้อมูลแล้ว)" });
      }
    });
  }

  function removeHashtags() {
    setMessage(null);
    if (selectedIds.length === 0) {
      setMessage({ tone: "error", text: "ยังไม่ได้เลือกสินค้าในแท็บนี้" });
      return;
    }
    startTransition(async () => {
      try {
        const { cleared } = await clearRequiredHashtags(selectedIds);
        setMessage({ tone: "ok", text: cleared > 0 ? `ลบแฮชแท็กของ ${cleared} สินค้าแล้ว` : "สินค้าที่เลือกยังไม่มีแฮชแท็กให้ลบ" });
        setSelected(new Set());
      } catch (e) {
        console.error("clearRequiredHashtags:", e);
        setMessage({ tone: "error", text: "ลบแฮชแท็กไม่สำเร็จ — ลองใหม่อีกครั้ง (ถ้ายังไม่ได้ ให้เช็กว่ารัน migrate ฐานข้อมูลแล้ว)" });
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
            onClick={() => {
              setTab(t);
              setSelected(new Set());
            }}
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
        <>
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSelected(new Set(visible.map((i) => i.sourceProductId)))}
              disabled={pending}
            >
              เลือกทั้งหมดในแท็บนี้
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setSelected(new Set())} disabled={pending || selectedIds.length === 0}>
              ไม่เลือกเลย
            </Button>
            <span className="text-sm leading-relaxed text-muted-foreground" role="status">
              เลือกอยู่ <span className="font-mono">{selectedIds.length}</span> จาก <span className="font-mono">{visible.length}</span>
            </span>
          </div>
          {selectedIds.length > 0 && (
            <div className="flex flex-col gap-2">
              <label htmlFor="required-hashtag-input" className="text-sm leading-relaxed font-medium text-foreground">
                แฮชแท็กที่ต้องลง (หลายอันเว้นวรรคหรือคั่นด้วยจุลภาค)
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  id="required-hashtag-input"
                  type="text"
                  value={hashtagText}
                  onChange={(e) => setHashtagText(e.target.value)}
                  placeholder="#trendyselected"
                  autoComplete="off"
                  className="h-11 min-w-0 flex-1 rounded-lg border border-border-interactive bg-background px-3 text-sm lg:h-9"
                />
                <Button type="button" onClick={applyHashtags} disabled={pending || hashtagText.trim() === ""}>
                  ใส่แฮชแท็ก
                </Button>
                <Button type="button" variant="outline" onClick={removeHashtags} disabled={pending}>
                  ลบแฮชแท็ก
                </Button>
              </div>
              {suggestions.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs leading-relaxed text-muted-foreground">ที่เคยใช้:</span>
                  {suggestions.map((tag) => (
                    <Button key={tag} type="button" variant="outline" size="xs" onClick={() => setHashtagText(tag)} disabled={pending}>
                      {tag}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <ul className="flex flex-col gap-2">
          {visible.map((item) => {
            const pct = commissionPercent(item.price, item.commission);
            const cover = item.images[0];
            return (
              <li
                key={item.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-3 sm:flex-nowrap"
              >
                <label className="flex size-11 shrink-0 cursor-pointer items-center justify-center lg:size-9">
                  <input
                    type="checkbox"
                    checked={selected.has(item.sourceProductId)}
                    onChange={() => toggle(item.sourceProductId)}
                    aria-label={`เลือก ${item.name}`}
                    className="size-5 accent-primary"
                  />
                </label>

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
                  {item.hashtags.length > 0 && (
                    <p className="flex flex-wrap items-center gap-1 text-xs leading-relaxed">
                      <span className="text-muted-foreground">แฮชแท็กที่ต้องลง</span>
                      {item.hashtags.map((tag) => (
                        <span key={tag} className="rounded-md bg-surface-2 px-2 py-0.5 text-foreground">
                          {tag}
                        </span>
                      ))}
                    </p>
                  )}
                </div>

                <div className="flex w-full shrink-0 flex-wrap items-center justify-end gap-2 sm:w-auto">
                  {item.status === "todo" && (
                    <>
                      <Button type="button" variant="outline" size="sm" onClick={() => dismiss(item, true)} disabled={pending}>
                        ไม่ทำแล้ว
                      </Button>
                      <Button
                        type="button"
                        onClick={() => (item.images.length === 0 ? start(item, null) : setPicking({ item, retry: false }))}
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
                  {item.status === "in_progress" && (item.flowState === "retry" || item.flowState === "change") && (
                    <>
                      {item.flowState === "retry" && (
                        <span className="text-xs leading-relaxed text-destructive">Flow วาดไม่สำเร็จ / ถูกข้าม</span>
                      )}
                      {item.images.length > 0 && (
                        <Button
                          type="button"
                          size="sm"
                          // งานยังเดินอยู่ (change) = ปุ่มรอง ไม่ดึงสายตาเท่างานที่พัง/ถูกข้าม
                          variant={item.flowState === "change" ? "outline" : "default"}
                          onClick={() => setPicking({ item, retry: true })}
                          disabled={pending}
                        >
                          เลือกรูปใหม่
                        </Button>
                      )}
                    </>
                  )}
                  {item.status === "in_progress" && item.flowState === "blocked" && (
                    <Link
                      href="/flow"
                      className="inline-flex h-11 items-center px-2 text-xs leading-relaxed text-destructive underline underline-offset-2 lg:h-9"
                    >
                      งาน Flow หยุด — ดูที่คิว Flow
                    </Link>
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
        </>
      )}

      {picking && (
        <ShowcasePhotoPicker
          productName={picking.item.name}
          images={picking.item.images.map((img) => ({ ...img, src: shopPhotoSrc(picking.item.id, img.filename) }))}
          note={picking.retry && picking.item.flowState === "change" ? "งาน Flow ของสินค้านี้จะกลับไปวาดรอบ 1 ใหม่ด้วยรูปนี้ — รูปที่วาดไปแล้วยังเก็บไว้" : undefined}
          confirmVerb={picking.retry && picking.item.flowState === "change" ? "เปลี่ยนรูปต้นทาง" : "ส่งเข้าคิว Flow"}
          busy={pending}
          onConfirm={(photo, extra) => (picking.retry ? retry(picking.item, photo, extra) : start(picking.item, photo, extra))}
          onCancel={() => setPicking(null)}
        />
      )}
    </div>
  );
}
