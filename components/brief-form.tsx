"use client";

import { useActionState } from "react";
import { Plus, X } from "lucide-react";

import { deleteProductImage, uploadProductImages } from "@/app/actions";
import type { ProductImageRecord } from "@/components/prompt-workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export type FormState = {
  productName: string;
  productInfo: string;
  riskModule: string;
  extraNotes: string;
  images: string[];
};

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
  onImageChange,
  onAddImage,
  onRemoveImage,
  action,
  entryId,
  productImages,
}: {
  form: FormState;
  isCreating: boolean;
  onFieldChange: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  onImageChange: (index: number, value: string) => void;
  onAddImage: () => void;
  onRemoveImage: (index: number) => void;
  action: (formData: FormData) => void;
  entryId: string | null;
  productImages: ProductImageRecord[];
}) {
  const [uploadError, uploadAction, isUploading] = useActionState(
    async (_prev: string | null, formData: FormData) => {
      try {
        await uploadProductImages(formData);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "อัปโหลดไม่สำเร็จ";
      }
    },
    null
  );

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

        <Field label="รูปอ้างอิงที่แนบ">
          <div className="flex flex-col gap-2">
            {form.images.map((label, index) => (
              <div key={index} className="flex items-center gap-2">
                <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">
                  รูปที่ {index + 1}
                </span>
                <Input
                  name="images"
                  value={label}
                  onChange={(e) => onImageChange(index, e.target.value)}
                />
                {index >= 2 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => onRemoveImage(index)}
                  >
                    <X className="size-3.5" />
                  </Button>
                )}
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onAddImage}
              className="self-start"
            >
              <Plus className="size-3.5" />
              เพิ่มรูป
            </Button>
          </div>
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

      {/* Real photos attach to an entry that already exists, so this lives outside
          the create form — a form cannot be nested inside another form. */}
      <div className="flex flex-col gap-1.5 border-t border-border pt-5">
        <label className="text-sm font-medium text-foreground/90">
          รูปสินค้าจริง (ส่งให้ AI อ่าน)
        </label>

        {entryId === null ? (
          <p className="font-mono text-[0.7rem] text-muted-foreground">
            กด &quot;สร้าง Prompt&quot; ก่อน แล้วจึงแนบรูปสินค้าจริงให้ AI อ่านได้
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {productImages.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {productImages.map((image) => (
                  <div key={image.id} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/uploads/${image.entryId}/${image.filename}`}
                      alt="รูปสินค้า"
                      className="size-20 rounded-md border border-border object-cover"
                    />
                    <button
                      type="button"
                      aria-label="ลบรูป"
                      onClick={() => deleteProductImage(image.id)}
                      className="absolute -top-1.5 -right-1.5 rounded-full bg-record p-0.5 text-paper"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <form action={uploadAction} className="flex items-center gap-2">
              <input type="hidden" name="entryId" value={entryId} />
              <Input
                type="file"
                name="files"
                multiple
                accept="image/jpeg,image/png,image/webp"
                className="h-auto py-1.5"
                required
              />
              <Button type="submit" variant="outline" size="sm" disabled={isUploading}>
                {isUploading ? "กำลังอัปโหลด..." : "อัปโหลด"}
              </Button>
            </form>

            {uploadError && (
              <p className="font-mono text-[0.7rem] text-record">{uploadError}</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
