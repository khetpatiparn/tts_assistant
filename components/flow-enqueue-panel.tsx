"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ImagePlus, Send, X } from "lucide-react";

import { enqueueFlowJob } from "@/app/actions";
import { STATUS_LABELS, type FlowStatus } from "@/lib/flow-jobs";
import { cn } from "@/lib/utils";
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
  // armed = กล่องรับรูปถูกคลิก/โฟกัสอยู่ จึงพร้อมรับ Ctrl+V (ดูคอมเมนต์ที่กล่องด้านล่าง)
  const [armed, setArmed] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  const canEnqueue = productName.trim() !== "" && files.length > 0 && !isPending;

  function addFiles(picked: File[]) {
    if (picked.length === 0) return;
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
          {/* กล่องรับรูป: ต้องคลิกให้โฟกัสก่อนแล้วค่อย Ctrl+V เพราะแท็บนี้มี BriefForm ที่ดัก
              paste ระดับ window อยู่แล้ว (เข้ารูปสินค้าจริง/แคปสกัดข้อมูล) ถ้ากล่องนี้รับ paste
              ทั้งหน้าโดยไม่ต้องคลิก รูปใบเดียวจะถูกรับสองที่พร้อมกัน — ตกลงกับผู้ใช้แล้วว่า
              ยอมคลิกเพิ่ม 1 ทีเพื่อไม่ให้พฤติกรรมเดิมเพี้ยน
              ใช้ state `armed` คุมทั้งขอบและข้อความ ไม่ใช้ :focus-visible เพราะการคลิกด้วย
              เมาส์บน div ไม่ match pseudo-class นั้น (ขอบจะไม่ขึ้นเลยทั้งที่โฟกัสอยู่จริง) */}
          <div
            tabIndex={0}
            role="group"
            aria-label="กล่องรับรูปแคป — คลิกแล้วกด Ctrl+V หรือลากรูปมาวาง"
            onFocus={() => setArmed(true)}
            onBlur={() => setArmed(false)}
            onPaste={(e) => {
              const picked = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
              if (picked.length === 0) return; // วางข้อความล้วน — ปล่อยผ่านให้ช่องที่โฟกัสอยู่ตามปกติ
              e.preventDefault(); // สัญญาณบอก listener ระดับ window ของ BriefForm ว่ารับไปแล้ว
              addFiles(picked);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              addFiles(Array.from(e.dataTransfer.files));
            }}
            className={cn(
              "flex flex-col gap-2 rounded-lg border border-dashed p-3 outline-none transition-colors",
              dragOver || armed ? "border-primary bg-primary/5" : "border-border"
            )}
          >
            {previews.length > 0 && (
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
            )}
            <p className="text-xs leading-relaxed text-muted-foreground">
              {armed ? "พร้อมแล้ว — กด Ctrl+V วางรูปได้เลย" : "คลิกกล่องนี้แล้วกด Ctrl+V หรือลากรูปมาวาง"}
            </p>
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
                addFiles(Array.from(e.target.files ?? []));
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
