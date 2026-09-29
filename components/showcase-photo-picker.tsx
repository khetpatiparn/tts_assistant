"use client";

import { useRef, useState } from "react";
import { ArrowLeft, Crop } from "lucide-react";
import { Button } from "@/components/ui/button";

type Box = { x: number; y: number; w: number; h: number };

/** กรอบเล็กกว่านี้ (สัดส่วนของรูป) = คลิกพลาด ไม่ใช่ตั้งใจครอป */
const MIN_BOX = 0.03;

function mimeFromFilename(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  return ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
}

function normalize(start: { x: number; y: number }, end: { x: number; y: number }): Box {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const x1 = clamp(Math.min(start.x, end.x));
  const y1 = clamp(Math.min(start.y, end.y));
  return { x: x1, y: y1, w: clamp(Math.max(start.x, end.x)) - x1, h: clamp(Math.max(start.y, end.y)) - y1 };
}

/**
 * เลือกรูปต้นทาง 1 รูปจากรูปของร้าน แล้วครอปถ้าต้องการ (ลากกรอบอิสระ) — ผลลัพธ์เป็นไฟล์เดียวส่งให้ onConfirm
 * ครอปด้วย canvas ในเบราว์เซอร์ที่ความละเอียดเต็มของรูป (naturalWidth) ไม่ใช่ขนาดที่โชว์บนจอ · รูปมาจาก
 * /api/uploads ซึ่ง origin เดียวกัน canvas จึงไม่ถูก taint · ไม่ครอป = ส่งไฟล์ต้นฉบับตรงๆ ไม่เข้ารหัสใหม่
 */
export function ShowcasePhotoPicker({
  candidateId,
  productName,
  images,
  busy,
  onConfirm,
  onCancel,
}: {
  candidateId: string;
  productName: string;
  images: { id: string; filename: string }[];
  busy: boolean;
  onConfirm: (photo: File) => void;
  onCancel: () => void;
}) {
  const [chosen, setChosen] = useState<{ id: string; filename: string } | null>(
    images.length === 1 ? images[0] : null
  );
  const [box, setBox] = useState<Box | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const srcOf = (filename: string) => `/api/uploads/_candidates/${candidateId}/${filename}`;

  function pointFrom(e: React.PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
  }

  async function confirm(useCrop: boolean) {
    if (chosen === null) return;
    setError(null);
    try {
      const mime = mimeFromFilename(chosen.filename);
      if (!useCrop || box === null) {
        const blob = await (await fetch(srcOf(chosen.filename))).blob();
        onConfirm(new File([blob], chosen.filename, { type: mime }));
        return;
      }
      const img = imgRef.current;
      if (img === null) return;
      const sx = Math.round(box.x * img.naturalWidth);
      const sy = Math.round(box.y * img.naturalHeight);
      const sw = Math.max(1, Math.round(box.w * img.naturalWidth));
      const sh = Math.max(1, Math.round(box.h * img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = sw;
      canvas.height = sh;
      canvas.getContext("2d")?.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, 0.92));
      if (blob === null) throw new Error("ครอปรูปไม่สำเร็จ");
      // toBlob คืนชนิดที่เบราว์เซอร์ทำได้จริง (อาจไม่ตรง mime ที่ขอ) — ใช้ชนิดของ blob เสมอ
      const ext = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
      onConfirm(new File([blob], `crop.${ext}`, { type: blob.type }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "เตรียมรูปไม่สำเร็จ");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col gap-3 overflow-y-auto rounded-xl border border-border bg-surface p-4 sm:p-5">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-base leading-relaxed font-semibold text-foreground">
            {chosen === null ? "เลือกรูปที่ใช้ได้ 1 รูป" : "ครอปถ้าต้องการ"}
          </h3>
          <p className="line-clamp-1 text-sm leading-relaxed text-muted-foreground">{productName}</p>
        </div>

        {chosen === null ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {images.map((img) => (
              <button
                key={img.id}
                type="button"
                onClick={() => {
                  setChosen(img);
                  setBox(null);
                }}
                className="overflow-hidden rounded-lg border-2 border-border-interactive outline-none hover:border-primary focus-visible:border-primary"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={srcOf(img.filename)} alt="" className="aspect-square w-full object-cover" />
              </button>
            ))}
          </div>
        ) : (
          <>
            <p className="flex items-center gap-1.5 text-sm leading-relaxed text-muted-foreground">
              <Crop className="size-4 shrink-0" />
              ลากบนรูปเพื่อเลือกส่วนที่จะใช้ — ไม่ลาก = ใช้ทั้งรูป
            </p>
            <div className="flex justify-center">
              {/* ขยายตามความกว้างเสมอ (รูปของร้านมักเล็ก ~300px ลากกรอบยาก) — กรอบครอปคิดเป็นสัดส่วนของรูป
                  จึงไม่ขึ้นกับขนาดที่โชว์ · ห้ามใช้ object-contain เพราะกล่องจะใหญ่กว่ารูปจริงแล้วสัดส่วนเพี้ยน */}
              <div
                className="relative w-full max-w-xl touch-none overflow-hidden rounded-lg select-none"
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  dragStart.current = pointFrom(e);
                  setBox(null);
                }}
                onPointerMove={(e) => {
                  if (dragStart.current === null) return;
                  setBox(normalize(dragStart.current, pointFrom(e)));
                }}
                onPointerUp={(e) => {
                  if (dragStart.current === null) return;
                  const b = normalize(dragStart.current, pointFrom(e));
                  dragStart.current = null;
                  setBox(b.w < MIN_BOX || b.h < MIN_BOX ? null : b);
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  ref={imgRef}
                  src={srcOf(chosen.filename)}
                  alt=""
                  draggable={false}
                  className="block h-auto w-full cursor-crosshair"
                />
                {box !== null && (
                  <div
                    className="pointer-events-none absolute border-2 border-primary shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]"
                    style={{
                      left: `${box.x * 100}%`,
                      top: `${box.y * 100}%`,
                      width: `${box.w * 100}%`,
                      height: `${box.h * 100}%`,
                    }}
                  />
                )}
              </div>
            </div>
          </>
        )}

        {error && <p className="text-sm leading-relaxed text-destructive">{error}</p>}

        <div className="flex flex-wrap items-center justify-end gap-2">
          {chosen !== null && images.length > 1 && (
            <Button type="button" variant="outline" className="mr-auto" onClick={() => setChosen(null)} disabled={busy}>
              <ArrowLeft className="size-4" />
              เลือกรูปอื่น
            </Button>
          )}
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            ยกเลิก
          </Button>
          {chosen !== null && (
            <Button type="button" onClick={() => void confirm(box !== null)} disabled={busy}>
              {busy ? "กำลังส่ง..." : box !== null ? "ใช้ส่วนที่ครอป → ส่งเข้าคิว Flow" : "ใช้ทั้งรูป → ส่งเข้าคิว Flow"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
