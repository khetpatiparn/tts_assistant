"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ImagePlus, Send, X } from "lucide-react";

import { enqueueFlowJob } from "@/app/actions";
import { STATUS_LABELS, type FlowStatus } from "@/lib/flow-jobs";
import { Button } from "@/components/ui/button";

const ALLOWED = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 10 * 1024 * 1024;

export type FlowJobSummary = { id: string; status: string; round: number; attempt: number };

/**
 * แผง "รูปแคปสินค้า → Flow" — รูปชุดนี้คือแคปดิบจาก TikTok Shop ที่จะส่งให้บอทแนบเข้า Flow
 * ไม่ใช่ ProductImage (รูปอ้างอิงที่ AI อ่าน) — สองอย่างนี้คนละตาราง คนละโฟลเดอร์
 */
export function FlowEnqueuePanel({
  entryId,
  productName,
  job,
}: {
  entryId: string;
  productName: string;
  job: FlowJobSummary | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  const canEnqueue = productName.trim() !== "" && files.length > 0 && !isPending;

  function addFiles(list: FileList | null) {
    if (!list) return;
    const picked = Array.from(list);
    if (picked.some((f) => !ALLOWED.includes(f.type))) return setError("รองรับเฉพาะ JPEG, PNG, WebP");
    if (picked.some((f) => f.size > MAX_BYTES)) return setError("ไฟล์ใหญ่เกิน 10MB");
    setError(null);
    setFiles((prev) => [...prev, ...picked]);
  }

  function submit() {
    const formData = new FormData();
    formData.set("entryId", entryId);
    for (const f of files) formData.append("files", f);
    startTransition(async () => {
      try {
        await enqueueFlowJob(formData);
        setFiles([]);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "เข้าคิวไม่สำเร็จ");
      }
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <h3 className="text-sm font-semibold leading-relaxed text-foreground">รูปแคปสินค้า → ให้บอทวาดใน Flow</h3>

      {job ? (
        <p className="text-sm leading-relaxed text-muted-foreground">
          สถานะ: {STATUS_LABELS[job.status as FlowStatus] ?? job.status}
          {job.attempt > 1 ? ` (ครั้งที่ ${job.attempt})` : ""} ·{" "}
          <Link href="/flow" className="text-primary underline-offset-4 hover:underline">ไปหน้าคิว Flow</Link>
        </p>
      ) : (
        <>
          <p className="text-xs leading-relaxed text-muted-foreground">
            แคปรูปสินค้าจาก TikTok Shop (รูปแรกจะถูกแนบเข้า Flow) — บอทจะวาดพื้นหลังขาว 4 รูปให้เลือก แล้ววาดตอนใช้งานต่อ
          </p>
          {productName.trim() === "" && (
            <p className="text-xs text-destructive">ต้องมีชื่อสินค้าก่อน (สกัดจากแคปหน้าสินค้า หรือพิมพ์เอง)</p>
          )}
          <div className="flex flex-wrap gap-2">
            {previews.map((src, i) => (
              <div key={src} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`รูปแคป ${i + 1}`} className="size-20 rounded-md border border-border object-cover" />
                <Button
                  type="button"
                  variant="destructive"
                  size="icon-xs"
                  aria-label="เอารูปออก"
                  className="absolute -top-1.5 -right-1.5 rounded-full"
                  onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                >
                  <X className="size-3" />
                </Button>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => inputRef.current?.click()}>
              <ImagePlus data-icon="inline-start" /> เลือกรูปแคป
            </Button>
            <Button type="button" disabled={!canEnqueue} onClick={submit}>
              <Send data-icon="inline-start" /> เข้าคิว Flow
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
        </>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </section>
  );
}
