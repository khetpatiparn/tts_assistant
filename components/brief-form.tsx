"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ClipboardPaste, NotebookPen, ScanText, TriangleAlert, X } from "lucide-react";

import { deleteProductImage, extractProductInfo } from "@/app/actions";
import { AnglePanel, type UsedAngleWithOutcome } from "@/components/angle-panel";
import type { ProductImageRecord } from "@/components/entry-workspace";
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
  onExtracted,
  isUploading,
  imageError,
  angleEntryId,
  angleValue,
  usedAngles,
  hasSelectedEntry,
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
  onExtracted: (fields: { productName: string; productInfo: string }) => void;
  isUploading: boolean;
  imageError: string | null;
  angleEntryId: string | null;
  angleValue: string;
  usedAngles: UsedAngleWithOutcome[];
  hasSelectedEntry: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // แผงสกัดข้อมูลจากแคปหน้าสินค้า — รูปชุดนี้ใช้แล้วทิ้ง อยู่แค่ใน memory ฝั่ง client
  const [extractOpen, setExtractOpen] = useState(false);
  const [extractImages, setExtractImages] = useState<File[]>([]);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [isExtracting, startExtracting] = useTransition();
  const extractInputRef = useRef<HTMLInputElement>(null);

  // ช่อง Risk Module พับเป็น default — สำรวจจริง (2026-07-25) พบใช้เนื้อหาจริงแค่ 2/55 entries
  // ที่เหลือ 49 อันเป็น placeholder "-" ล้วนๆ จึงถือว่า "-" = ว่าง ไม่นับเป็นเนื้อหา
  // effect นี้เปิดอย่างเดียว (ตอนสลับไป entry ที่มี risk จริง) ไม่เคยปิดให้อัตโนมัติ —
  // ผู้ใช้พับเองได้เสมอโดยไม่โดนดึงกลับ
  const [riskOpen, setRiskOpen] = useState(false);
  const hasRealRisk =
    form.riskModule.trim() !== "" && form.riskModule.trim() !== "-";
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (hasRealRisk) setRiskOpen(true);
  }, [hasRealRisk]);

  // ช่อง "ข้อมูลเพิ่มเติมจากฉัน" พับเป็น default — สำรวจจริง (2026-07-26) พบว่าว่างทั้ง 55/55
  // entries (ผู้ใช้ปล่อยให้ AI คิดเอง) ไม่มีประวัติ placeholder "-" จึงเช็คแค่ค่าว่าง
  // effect เปิดอย่างเดียว ไม่เคยปิดให้อัตโนมัติ (ปัจจุบันยังไม่ trigger เพราะไม่มี entry ที่มี note
  // แต่ใส่ไว้เพื่อความสม่ำเสมอกับ risk module และเผื่ออนาคตที่ผู้ใช้เริ่มกรอก)
  const [notesOpen, setNotesOpen] = useState(false);
  const hasRealNotes = form.extraNotes.trim() !== "";
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (hasRealNotes) setNotesOpen(true);
  }, [hasRealNotes]);

  const extractPreviews = useMemo(
    () => extractImages.map((file) => URL.createObjectURL(file)),
    [extractImages]
  );
  useEffect(() => {
    return () => {
      for (const url of extractPreviews) URL.revokeObjectURL(url);
    };
  }, [extractPreviews]);

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

  function acceptExtractFiles(files: File[]) {
    if (files.length === 0) return;
    const reason = rejectionReason(files);
    if (reason) {
      setExtractError(reason);
      return;
    }
    setExtractError(null);
    setExtractImages((prev) => [...prev, ...files]);
  }

  function handleExtract() {
    if (extractImages.length === 0) return;
    setExtractError(null);
    startExtracting(async () => {
      try {
        const formData = new FormData();
        for (const file of extractImages) formData.append("files", file);
        const fields = await extractProductInfo(formData);
        onExtracted(fields);
        setExtractImages([]);
        setExtractOpen(false);
      } catch (e) {
        setExtractError(e instanceof Error ? e.message : "สกัดข้อมูลไม่สำเร็จ");
      }
    });
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
      // ตอนแผงสกัดเปิดอยู่ paste ต้องเข้าแผงสกัด ไม่ใช่รูปสินค้าจริง — ตัดสินใน
      // handler เดียว ไม่ตั้ง listener ซ้อนกันสองตัวแข่งกัน (effect นี้ไม่มี deps
      // array ตั้งใจ: ลงทะเบียนใหม่ทุก render closure จึงเห็น state สดเสมอ)
      if (extractOpen) {
        acceptExtractFiles(files);
      } else {
        acceptFiles(files);
      }
    }

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  });

  const shownError = localError ?? imageError;

  return (
    <section className="flex flex-1 flex-col gap-5 rounded-xl border border-border bg-card p-5 sm:p-6">
      <div className="flex items-center gap-2 border-b border-border pb-3">
        <span className="h-4 w-1 rounded-full bg-amber" />
        <h2 className="font-mono text-xs tracking-widest text-secondary-foreground uppercase">
          Brief · ข้อมูลสินค้า
        </h2>
      </div>

      {/* สกัดข้อมูลจากแคปหน้าสินค้า — วางก่อนฟอร์มเพราะเติมช่องชื่อ/ข้อมูลสินค้าด้านล่าง
          ตรงตามลำดับงานจริง (สกัดก่อน แล้วค่อยกรอก/แก้ที่เหลือ) รูปชุดนี้เป็นคนละชุด
          กับรูปสินค้าจริงด้านล่าง: ส่งให้ AI อ่านข้อความแล้วทิ้ง ไม่ถูกเก็บลงดิสก์/DB
          และห้ามปนเข้ารูปสินค้าจริง เพราะแคปหน้าข้อความจะทำให้ 10-part prompt เพี้ยน */}
      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => setExtractOpen((open) => !open)}
          aria-expanded={extractOpen}
          className="flex items-center gap-1.5 self-start font-mono text-xs tracking-widest text-teal uppercase hover:text-teal/80"
        >
          <ScanText className="size-3.5" />
          สกัดจากแคปหน้าสินค้า
        </button>

        {extractOpen && (
          <div className="flex flex-col gap-3 rounded-lg border border-dashed border-teal/40 p-3">
            <div
              role="button"
              tabIndex={0}
              aria-label="วางหรือเลือกแคปหน้าสินค้าเพื่อสกัดข้อมูล"
              onClick={() => extractInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") extractInputRef.current?.click();
              }}
              className="flex cursor-pointer flex-col gap-2"
            >
              {extractImages.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {extractImages.map((file, index) => (
                    <div key={`${file.name}-${index}`} className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={extractPreviews[index]}
                        alt="แคปหน้าสินค้า (ใช้สกัดแล้วทิ้ง)"
                        className="size-24 rounded-md border border-dashed border-teal object-cover"
                      />
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon-xs"
                        aria-label="ลบแคป"
                        onClick={(e) => {
                          e.stopPropagation();
                          setExtractImages((prev) => prev.filter((_, i) => i !== index));
                        }}
                        className="absolute -top-1.5 -right-1.5 rounded-full"
                      >
                        <X className="size-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <p className="flex items-center gap-1.5 font-mono text-[0.7rem] text-muted-foreground">
                <ClipboardPaste className="size-3.5 shrink-0" />
                กด Ctrl+V เพื่อวางแคปหน้าสินค้า (ชื่อ/รายละเอียด) — รูปชุดนี้ใช้สกัดแล้วทิ้ง ไม่ถูกเก็บ
              </p>

              <input
                ref={extractInputRef}
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp"
                hidden
                onChange={(e) => {
                  acceptExtractFiles(imageFilesFrom(e.target.files));
                  e.target.value = "";
                }}
              />
            </div>

            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleExtract}
              disabled={isExtracting || extractImages.length === 0}
            >
              {isExtracting ? "กำลังสกัด..." : "สกัดข้อมูล"}
            </Button>

            {extractError && (
              <p className="font-mono text-[0.7rem] text-danger">{extractError}</p>
            )}
          </div>
        )}
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

        {/* พับไว้เพราะใช้จริงแค่ 2/55 entries — ตอนพับต้องมี hidden input ถือค่าแทน
            เพราะฟอร์ม submit ผ่าน native FormData ซึ่งอ่านเฉพาะ input ที่ render อยู่:
            ถ้าพิมพ์ risk แล้วพับก่อนกดสร้าง ค่าจะหายจาก submission เงียบๆ */}
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => setRiskOpen((open) => !open)}
            aria-expanded={riskOpen}
            className="flex items-center gap-1.5 self-start font-mono text-xs tracking-widest text-teal uppercase hover:text-teal/80"
          >
            <TriangleAlert className="size-3.5" />
            Product Risk Module (ถ้ามี)
          </button>
          {riskOpen ? (
            <Textarea
              name="riskModule"
              rows={3}
              value={form.riskModule}
              onChange={(e) => onFieldChange("riskModule", e.target.value)}
              placeholder="ความเสี่ยงที่ต้องระวัง เช่น พับได้ / กางได้ / มีกลไก"
            />
          ) : (
            <input type="hidden" name="riskModule" value={form.riskModule} />
          )}
        </div>

        {/* พับไว้เพราะว่างทั้ง 55/55 entries — ตอนพับต้องมี hidden input ถือค่าแทน
            เพราะฟอร์ม submit ผ่าน native FormData ซึ่งอ่านเฉพาะ input ที่ render อยู่:
            ถ้าพิมพ์ note แล้วพับก่อนกดสร้าง ค่าจะหายจาก submission เงียบๆ */}
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => setNotesOpen((open) => !open)}
            aria-expanded={notesOpen}
            className="flex items-center gap-1.5 self-start font-mono text-xs tracking-widest text-teal uppercase hover:text-teal/80"
          >
            <NotebookPen className="size-3.5" />
            ข้อมูลเพิ่มเติมจากฉัน (ถ้ามี)
          </button>
          {notesOpen ? (
            <Textarea
              name="extraNotes"
              rows={3}
              value={form.extraNotes}
              onChange={(e) => onFieldChange("extraNotes", e.target.value)}
              placeholder="เช่น อยากเน้นคนอยู่หอ / ไม่อยากโชว์การพับ"
            />
          ) : (
            <input type="hidden" name="extraNotes" value={form.extraNotes} />
          )}
        </div>

        <div className="flex flex-col gap-1">
          <Button type="submit" disabled={isCreating} size="lg" className="mt-1 self-start">
            {isCreating
              ? "กำลังสร้าง..."
              : hasSelectedEntry
                ? "สร้างเป็นรายการใหม่"
                : "สร้าง Prompt"}
          </Button>
          {/* ปุ่มนี้เรียก createPrompt ซึ่งสร้าง entry ใหม่ที่ duplicatedFromId = null เสมอ
              กดพลาดหลังกดทำซ้ำ = สายเลือดขาด ระบบตามรอย angle ไม่ได้ */}
          {hasSelectedEntry && (
            <span className="font-mono text-[0.7rem] text-muted-foreground">
              จะได้รายการใหม่ที่ไม่ผูกกับสินค้าเดิม — ถ้าจะแก้รายการนี้ ใช้ปุ่ม &quot;สร้างด้วย AI&quot; ทางขวา
            </span>
          )}
        </div>
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
            isDraggingOver ? "border-teal bg-teal/5" : "border-border"
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
                    <Button
                      type="button"
                      variant="destructive"
                      size="icon-xs"
                      aria-label="ลบรูป"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteProductImage(image.id);
                      }}
                      className="absolute -top-1.5 -right-1.5 rounded-full"
                    >
                      <X className="size-3" />
                    </Button>
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
                      className="size-24 rounded-md border border-dashed border-teal object-cover"
                    />
                    <Button
                      type="button"
                      variant="destructive"
                      size="icon-xs"
                      aria-label="ลบรูป"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemovePending(index);
                      }}
                      className="absolute -top-1.5 -right-1.5 rounded-full"
                    >
                      <X className="size-3" />
                    </Button>
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
          <p className="font-mono text-[0.7rem] text-danger">{shownError}</p>
        )}
      </div>

      {/* แผง angle อยู่นอก <form> เพราะมีปุ่ม/ช่องของตัวเองที่ต้องไม่ submit ฟอร์ม
          และ angle บันทึกผ่าน server action ของมันเอง (generateWithAI อ่านจาก DB) */}
      {angleEntryId !== null && (
        <AnglePanel entryId={angleEntryId} angle={angleValue} used={usedAngles} />
      )}
    </section>
  );
}
