"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardPaste, X } from "lucide-react";

import { deleteProductImage } from "@/app/actions";
import type { ProductImageRecord } from "@/components/prompt-workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export type FormState = {
  productName: string;
  productInfo: string;
  riskModule: string;
  extraNotes: string;
};

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Same rules the Server Action enforces — checked here only to fail fast. */
function rejectionReason(files: File[]): string | null {
  if (files.some((file) => !ALLOWED_IMAGE_TYPES.includes(file.type))) {
    return "รองรับเฉพาะไฟล์ JPEG, PNG, WebP";
  }
  if (files.some((file) => file.size > MAX_IMAGE_BYTES)) {
    return "ไฟล์ใหญ่เกิน 10MB";
  }
  return null;
}

function imageFilesFrom(list: FileList | null | undefined): File[] {
  if (!list) return [];
  return Array.from(list).filter((file) => file.type.startsWith("image/"));
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-foreground/90">{label}</label>
      {children}
    </div>
  );
}

export function BriefForm({
  form,
  isCreating,
  onFieldChange,
  action,
  productImages,
  pendingImages,
  onAddImages,
  onRemovePending,
  onUpdatePendingCaption,
  onSaveCaption,
  isUploading,
  imageError,
}: {
  form: FormState;
  isCreating: boolean;
  onFieldChange: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  action: (formData: FormData) => void;
  productImages: ProductImageRecord[];
  pendingImages: { file: File; caption: string }[];
  onAddImages: (files: File[]) => void;
  onRemovePending: (index: number) => void;
  onUpdatePendingCaption: (index: number, caption: string) => void;
  onSaveCaption: (id: string, caption: string) => void;
  isUploading: boolean;
  imageError: string | null;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const pendingPreviews = useMemo(
    () => pendingImages.map((it) => URL.createObjectURL(it.file)),
    [pendingImages]
  );

  // Object URLs are held by the browser until revoked; without this every paste
  // leaks the image it created a preview for.
  useEffect(() => {
    return () => {
      for (const url of pendingPreviews) URL.revokeObjectURL(url);
    };
  }, [pendingPreviews]);

  function acceptFiles(files: File[]) {
    if (files.length === 0) return;
    const reason = rejectionReason(files);
    if (reason) {
      setLocalError(reason);
      return;
    }
    setLocalError(null);
    onAddImages(files);
  }

  // Pasting a screenshot must work wherever the cursor happens to be, so the
  // listener lives on the window. BriefForm only renders on the Brief tab, so it
  // cannot swallow pastes elsewhere. Text pastes carry no files and fall through
  // to the focused input untouched.
  useEffect(() => {
    function handlePaste(event: ClipboardEvent) {
      const files = imageFilesFrom(event.clipboardData?.files);
      if (files.length === 0) return;
      event.preventDefault();
      acceptFiles(files);
    }

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  });

  const shownError = localError ?? imageError;

  return (
    <section className="flex flex-1 flex-col gap-5 rounded-xl border border-border bg-card p-5 sm:p-6">
      <div className="flex items-center gap-2 border-b border-border pb-3">
        <span className="h-4 w-1 rounded-full bg-rust" />
        <h2 className="font-mono text-xs tracking-widest text-rust uppercase">
          Brief · ข้อมูลสินค้า
        </h2>
      </div>

      <form action={action} className="flex flex-col gap-5">
        <Field label="ชื่อสินค้า">
          <Input
            name="productName"
            value={form.productName}
            onChange={(e) => onFieldChange("productName", e.target.value)}
            placeholder="เช่น ถ้วยกาแฟสแตนเลส"
            required
          />
        </Field>

        <Field label="ข้อมูลสินค้าจากเว็บ/ร้านค้า">
          <Textarea
            name="productInfo"
            rows={5}
            value={form.productInfo}
            onChange={(e) => onFieldChange("productInfo", e.target.value)}
            placeholder="วางข้อมูลสินค้าที่ copy จากเว็บ/ร้านค้ามาได้เลย"
            required
          />
        </Field>

        <Field label="Product Risk Module">
          <Textarea
            name="riskModule"
            rows={3}
            value={form.riskModule}
            onChange={(e) => onFieldChange("riskModule", e.target.value)}
            placeholder="ความเสี่ยงที่ต้องระวัง เช่น พับได้ / กางได้ / มีกลไก"
          />
        </Field>

        <Field label="ข้อมูลเพิ่มเติมจากฉัน (ถ้ามี)">
          <Textarea
            name="extraNotes"
            rows={3}
            value={form.extraNotes}
            onChange={(e) => onFieldChange("extraNotes", e.target.value)}
            placeholder="เช่น อยากเน้นคนอยู่หอ / ไม่อยากโชว์การพับ"
          />
        </Field>

        <Button
          type="submit"
          disabled={isCreating}
          size="lg"
          className="mt-1 self-start bg-rust text-primary-foreground hover:bg-rust/90"
        >
          {isCreating ? "กำลังสร้าง..." : "สร้าง Prompt"}
        </Button>
      </form>

      {/* Photos attach to a saved entry, so this lives outside the create form —
          a form cannot be nested inside another form. Photos dropped before the
          entry exists wait in memory and upload with it. */}
      <div className="flex flex-col gap-1.5 border-t border-border pt-5">
        <label className="text-sm font-medium text-foreground/90">
          รูปสินค้าจริง (ส่งให้ AI อ่าน)
        </label>

        <div
          role="button"
          tabIndex={0}
          aria-label="วางหรือลากรูปสินค้าจริงมาที่นี่"
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDraggingOver(true);
          }}
          onDragLeave={() => setIsDraggingOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDraggingOver(false);
            acceptFiles(imageFilesFrom(e.dataTransfer.files));
          }}
          className={`flex cursor-pointer flex-col gap-3 rounded-lg border border-dashed p-3 transition-colors ${
            isDraggingOver ? "border-marigold bg-marigold/5" : "border-border"
          }`}
        >
          {(pendingImages.length > 0 || productImages.length > 0) && (
            <div className="flex flex-wrap gap-2">
              {productImages.map((image) => (
                <div key={image.id} className="flex w-24 flex-col gap-1">
                  <div className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/uploads/${image.entryId}/${image.filename}`}
                      alt="รูปสินค้า"
                      className="size-24 rounded-md border border-border object-cover"
                    />
                    <button
                      type="button"
                      aria-label="ลบรูป"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteProductImage(image.id);
                      }}
                      className="absolute -top-1.5 -right-1.5 rounded-full bg-record p-0.5 text-paper"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                  <Input
                    defaultValue={image.caption}
                    placeholder="อธิบายรูปนี้ เช่น ด้านหน้า มี logo"
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => onSaveCaption(image.id, e.target.value)}
                    className="h-7 text-xs"
                  />
                </div>
              ))}

              {pendingImages.map((item, index) => (
                <div key={`${item.file.name}-${index}`} className="flex w-24 flex-col gap-1">
                  <div className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={pendingPreviews[index]}
                      alt="รูปสินค้า (ยังไม่บันทึก)"
                      className="size-24 rounded-md border border-dashed border-marigold object-cover"
                    />
                    <button
                      type="button"
                      aria-label="ลบรูป"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemovePending(index);
                      }}
                      className="absolute -top-1.5 -right-1.5 rounded-full bg-record p-0.5 text-paper"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                  <Input
                    value={item.caption}
                    placeholder="อธิบายรูปนี้ เช่น ด้านหลัง ไม่มี logo"
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => onUpdatePendingCaption(index, e.target.value)}
                    className="h-7 text-xs"
                  />
                </div>
              ))}
            </div>
          )}

          <p className="flex items-center gap-1.5 font-mono text-[0.7rem] text-muted-foreground">
            <ClipboardPaste className="size-3.5 shrink-0" />
            {isUploading
              ? "กำลังอัปโหลด..."
              : "กด Ctrl+V เพื่อวางรูปที่แคปไว้ · หรือลากไฟล์มาวาง"}
          </p>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={(e) => {
              acceptFiles(imageFilesFrom(e.target.files));
              e.target.value = "";
            }}
          />
        </div>

        {shownError && (
          <p className="font-mono text-[0.7rem] text-record">{shownError}</p>
        )}
      </div>
    </section>
  );
}
