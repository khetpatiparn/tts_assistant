"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ImagePlus, RefreshCw } from "lucide-react";

import { addLibraryPhotoToProductImages, changeFlowSource } from "@/app/actions";
import type { LibraryPhoto, PhotoLibrary } from "@/lib/photo-library";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShowcasePhotoPicker } from "@/components/showcase-photo-picker";

type Picking = { photo: LibraryPhoto; action: "add" | "source" };

/**
 * คลังรูป (Photo library) ในหน้า entry — รูปจากร้าน + รูปที่ Flow วาดทุกรอบ (read model: lib/photo-library.ts)
 * แต่ละรูป "เพิ่มเข้ารูปสินค้า" / "ใช้เป็นรูปต้นทางใหม่" ผ่าน ShowcasePhotoPicker ตัวเดียวกับ Showcase และ /flow (ครอปก่อนได้)
 * ปุ่ม/ป้ายเห็นตลอด ไม่พึ่ง hover (ใช้บนมือถือได้) · พับไว้ตอนเปิดหน้า — รูปเยอะ ไม่แย่งที่งานหลักของหน้า
 */
export function PhotoLibraryPanel({
  entryId,
  productName,
  library,
}: {
  entryId: string;
  productName: string;
  library: PhotoLibrary;
}) {
  const router = useRouter();
  const [picking, setPicking] = useState<Picking | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const { shopPhotos, flowImages, currentSource, sourceChange } = library;
  const total = shopPhotos.length + flowImages.length;

  function confirm(file: File, extra: string) {
    if (picking === null) return;
    const action = picking.action;
    setMessage(null);
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.set("photo", file);
        if (action === "add") {
          formData.set("entryId", entryId);
          const r = await addLibraryPhotoToProductImages(formData);
          setMessage(r.added ? { tone: "ok", text: "เพิ่มเข้ารูปสินค้าแล้ว" } : { tone: "error", text: r.message ?? "เพิ่มรูปไม่สำเร็จ" });
        } else if (sourceChange !== null) {
          formData.set("jobId", sourceChange.jobId);
          formData.set("extraPrompt", extra);
          const r = await changeFlowSource(formData);
          setMessage(
            r.changed
              ? { tone: "ok", text: "เปลี่ยนรูปต้นทางแล้ว — บอทจะวาดรอบ 1 ใหม่ด้วยรูปนี้" }
              : { tone: "error", text: r.message ?? "เปลี่ยนรูปต้นทางไม่สำเร็จ" },
          );
        }
        router.refresh();
      } catch (e) {
        setMessage({ tone: "error", text: e instanceof Error ? e.message : "ทำรายการไม่สำเร็จ" });
      }
      setPicking(null);
    });
  }

  const tile = (p: LibraryPhoto) => (
    <li key={p.key} className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-border bg-background p-1.5">
      {/* แตะรูป = เปิดรูปเต็มในแท็บใหม่ (ดูรายละเอียดก่อนตัดสินใจ) */}
      <a href={p.src} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={p.src} alt={p.label ?? "รูปจากร้าน"} loading="lazy" className="aspect-square w-full object-cover" />
      </a>
      {(p.label !== null || p.chosen || p.isCurrentSource || p.inProductImages) && (
        <div className="flex flex-wrap gap-1">
          {p.label !== null && <span className="px-1 text-xs leading-relaxed text-muted-foreground">{p.label}</span>}
          {p.chosen && <Badge variant="success">เลือกแล้ว</Badge>}
          {p.isCurrentSource && <Badge variant="warning">รูปต้นทางตอนนี้</Badge>}
          {p.inProductImages && <Badge variant="neutral">อยู่ในรูปสินค้าแล้ว</Badge>}
        </div>
      )}
      <div className="mt-auto flex flex-col gap-1">
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="w-full"
          disabled={isPending}
          onClick={() => setPicking({ photo: p, action: "add" })}
        >
          <ImagePlus />
          เพิ่มเข้ารูปสินค้า
        </Button>
        {sourceChange?.allowed && (
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="w-full"
            disabled={isPending || p.isCurrentSource}
            onClick={() => setPicking({ photo: p, action: "source" })}
          >
            <RefreshCw />
            ใช้เป็นรูปต้นทางใหม่
          </Button>
        )}
      </div>
    </li>
  );

  const grid = (photos: LibraryPhoto[]) => (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-3">{photos.map(tile)}</ul>
  );

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <details className="group">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 lg:min-h-9 [&::-webkit-details-marker]:hidden">
          <h3 className="text-sm font-semibold leading-relaxed text-foreground">คลังรูป</h3>
          <span className="text-xs leading-relaxed text-muted-foreground">
            {total === 0
              ? "ยังไม่มีรูป"
              : [shopPhotos.length > 0 ? `รูปจากร้าน ${shopPhotos.length}` : null, `รูปที่ Flow วาด ${flowImages.length}`].filter(Boolean).join(" · ")}
          </span>
          <ChevronDown className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>

        <div className="mt-3 flex flex-col gap-4">
          {currentSource !== null && (
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={currentSource.src} alt="รูปต้นทางตอนนี้" className="size-16 shrink-0 rounded-md border border-border object-cover" />
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="text-sm leading-relaxed text-foreground">รูปต้นทางตอนนี้ (รูปที่บอทแนบเข้า Flow)</p>
                {sourceChange !== null && !sourceChange.allowed && sourceChange.reason !== null && (
                  <p className="text-xs leading-relaxed text-muted-foreground">{sourceChange.reason}</p>
                )}
              </div>
            </div>
          )}

          {shopPhotos.length > 0 && (
            <div className="flex flex-col gap-2">
              <h4 className="text-sm font-medium leading-relaxed text-foreground">รูปจากร้าน</h4>
              {grid(shopPhotos)}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <h4 className="text-sm font-medium leading-relaxed text-foreground">รูปที่ Flow วาด</h4>
            {flowImages.length > 0 ? (
              grid(flowImages)
            ) : (
              <p className="text-xs leading-relaxed text-muted-foreground">ยังไม่มี — บอทวาดเสร็จแล้วรูปทุกรอบจะเก็บไว้ที่นี่</p>
            )}
          </div>

          {message && (
            <p className={message.tone === "ok" ? "text-sm leading-relaxed text-foreground" : "text-sm leading-relaxed text-destructive"}>
              {message.text}
            </p>
          )}
        </div>
      </details>

      {picking !== null && (
        <ShowcasePhotoPicker
          productName={productName}
          images={[{ id: picking.photo.key, src: picking.photo.src, filename: picking.photo.filename }]}
          busy={isPending}
          confirmVerb={picking.action === "add" ? "เพิ่มเข้ารูปสินค้า" : "ใช้เป็นรูปต้นทางใหม่"}
          note={
            picking.action === "add"
              ? "รูปนี้จะเป็นรูปสินค้าที่ AI อ่าน (เหมือนรูปที่เพิ่มเอง) — ครอปตัดตัวหนังสือ/ป้ายของร้านออกได้"
              : "งานจะกลับไปรอบอทวาดรอบ 1 ใหม่ด้วยรูปนี้ — รูปที่วาดไปแล้วยังอยู่ในคลังรูป"
          }
          showExtraPrompt={picking.action === "source"}
          onConfirm={confirm}
          onCancel={() => setPicking(null)}
        />
      )}
    </section>
  );
}
