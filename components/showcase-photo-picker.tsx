"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Crop, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EXTRA_PROMPT_MAX } from "@/lib/flow-jobs";

type Box = { x: number; y: number; w: number; h: number };

/** รูปให้เลือก 1 รูป — src = URL ที่เปิดได้ (รูปจากร้านผ่าน /api/uploads หรือ blob: ของไฟล์จากเครื่อง) · file = ไฟล์จากเครื่อง (ไม่ต้องโหลดซ้ำ) */
export type PickerPhoto = { id: string; src: string; filename: string; file?: File };

/** URL ของรูปจากร้าน (uploads/_candidates/<candidateId>/<filename>) */
export function shopPhotoSrc(candidateId: string, filename: string): string {
  return `/api/uploads/_candidates/${candidateId}/${filename}`;
}

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
 * เลือกรูปต้นทาง 1 รูป (รูปของร้าน หรือไฟล์จากเครื่องถ้า allowLocalFile) แล้วครอปถ้าต้องการ (ลากกรอบอิสระ) — ผลลัพธ์เป็นไฟล์เดียวส่งให้ onConfirm
 * ใช้ทั้ง Showcase ("ทำคลิปตัวนี้"/"เลือกรูปใหม่"), หน้า /flow ("เปลี่ยนรูปต้นทาง") และคลังรูปในหน้า entry ("เพิ่มเข้ารูปสินค้า"/"ใช้เป็นรูปต้นทางใหม่") · ครอปด้วย canvas ในเบราว์เซอร์ที่ความละเอียดเต็มของรูป
 * (naturalWidth) ไม่ใช่ขนาดที่โชว์บนจอ · รูปมาจาก /api/uploads (origin เดียวกัน) หรือ blob: ของไฟล์จากเครื่อง canvas จึงไม่ถูก taint ·
 * ไม่ครอป = ส่งไฟล์ต้นฉบับตรงๆ ไม่เข้ารหัสใหม่
 */
export function ShowcasePhotoPicker({
  productName,
  images,
  busy,
  onConfirm,
  onCancel,
  allowLocalFile = false,
  confirmVerb = "ส่งเข้าคิว Flow",
  note,
  showExtraPrompt = true,
}: {
  productName: string;
  images: PickerPhoto[];
  busy: boolean;
  /** extra = ข้อความต่อท้ายพรอมต์ของ Flow ("" = พรอมต์ตั้งต้น) */
  onConfirm: (photo: File, extra: string) => void;
  onCancel: () => void;
  /** มีปุ่ม "เลือกไฟล์จากเครื่อง" (entry ที่ไม่ได้มาจาก Showcase ไม่มีรูปจากร้าน) */
  allowLocalFile?: boolean;
  /** คำบนปุ่มยืนยัน ต่อจาก "ใช้ทั้งรูป →" / "ใช้ส่วนที่ครอป →" */
  confirmVerb?: string;
  /** บรรทัดอธิบายผลของการยืนยัน (เช่น งานกลับไปวาดรอบ 1) */
  note?: string;
  /** ช่อง "ข้อความเพิ่มเติมถึง Flow" — ปิดเมื่อรูปไม่ได้ไปที่ Flow (คลังรูป "เพิ่มเข้ารูปสินค้า") · ปิดแล้ว extra = "" เสมอ */
  showExtraPrompt?: boolean;
}) {
  const [local, setLocal] = useState<PickerPhoto[]>([]);
  const all = [...images, ...local];
  const [chosen, setChosen] = useState<PickerPhoto | null>(images.length === 1 && !allowLocalFile ? images[0] : null);
  const fileInput = useRef<HTMLInputElement>(null);
  // blob: URL ของไฟล์จากเครื่อง — คืนหน่วยความจำตอนปิดหน้าต่าง
  const blobUrls = useRef<string[]>([]);
  useEffect(() => {
    const urls = blobUrls.current;
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, []);
  const [box, setBox] = useState<Box | null>(null);
  const [error, setError] = useState<string | null>(null);
  // รู้ตั้งแต่ตอนเลือกรูปได้ว่ารูปมีสินค้าหลายชิ้น/มีตัวหนังสือ — บอก Flow ได้เลยตั้งแต่รอบแรก
  const [extra, setExtra] = useState("");
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  function pointFrom(e: React.PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
  }

  async function confirm(useCrop: boolean) {
    if (chosen === null) return;
    setError(null);
    try {
      const mime = chosen.file?.type || mimeFromFilename(chosen.filename);
      if (!useCrop || box === null) {
        if (chosen.file) {
          onConfirm(chosen.file, extra);
          return;
        }
        const blob = await (await fetch(chosen.src)).blob();
        onConfirm(new File([blob], chosen.filename, { type: mime }), extra);
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
      onConfirm(new File([blob], `crop.${ext}`, { type: blob.type }), extra);
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

        {note && <p className="text-sm leading-relaxed text-muted-foreground">{note}</p>}

        {chosen === null ? (
          <div className="flex flex-col gap-3">
          {all.length === 0 && (
            <p className="text-sm leading-relaxed text-muted-foreground">สินค้านี้ไม่มีรูปจากร้าน — เลือกไฟล์รูปจากเครื่อง</p>
          )}
          {allowLocalFile && (
            <div>
              <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  const photo: PickerPhoto = { id: `local-${Date.now()}`, src: URL.createObjectURL(file), filename: file.name, file };
                  blobUrls.current.push(photo.src);
                  setLocal((prev) => [...prev, photo]);
                  setChosen(photo);
                  setBox(null);
                }}
              />
              <Button type="button" variant="outline" onClick={() => fileInput.current?.click()} disabled={busy}>
                <FolderOpen className="size-4" />
                เลือกไฟล์จากเครื่อง
              </Button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {all.map((img) => (
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
                <img src={img.src} alt="" className="aspect-square w-full object-cover" />
              </button>
            ))}
          </div>
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
                  src={chosen.src}
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

        {chosen !== null && showExtraPrompt && (
          <div className="flex flex-col gap-1">
            <label htmlFor="showcase-extra" className="text-sm leading-relaxed text-foreground">
              ข้อความเพิ่มเติมถึง Flow (ไม่ใส่ก็ได้)
            </label>
            <input
              id="showcase-extra"
              type="text"
              value={extra}
              maxLength={EXTRA_PROMPT_MAX}
              placeholder="เช่น เอาแค่แผ่นเดียว, ไม่ต้องมีป้ายห้อย"
              onChange={(e) => setExtra(e.target.value)}
              className="h-11 rounded-md border border-border-interactive bg-background px-3 text-sm lg:h-9"
            />
          </div>
        )}

        {error && <p className="text-sm leading-relaxed text-destructive">{error}</p>}

        <div className="flex flex-wrap items-center justify-end gap-2">
          {chosen !== null && (all.length > 1 || allowLocalFile) && (
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
              {busy ? "กำลังส่ง..." : box !== null ? `ใช้ส่วนที่ครอป → ${confirmVerb}` : `ใช้ทั้งรูป → ${confirmVerb}`}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
