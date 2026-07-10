"use client";

import { Plus, X } from "lucide-react";

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
}: {
  form: FormState;
  isCreating: boolean;
  onFieldChange: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  onImageChange: (index: number, value: string) => void;
  onAddImage: () => void;
  onRemoveImage: (index: number) => void;
  action: (formData: FormData) => void;
}) {
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
    </section>
  );
}
