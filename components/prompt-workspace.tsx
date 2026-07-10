"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { Trash2, X } from "lucide-react";

import { createPrompt, deletePrompt } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { buildPromptText, DEFAULT_IMAGE_LABELS } from "@/lib/prompt-template";

export type PromptEntry = {
  id: string;
  productName: string;
  productInfo: string;
  riskModule: string;
  extraNotes: string;
  images: string;
};

type FormState = {
  productName: string;
  productInfo: string;
  riskModule: string;
  extraNotes: string;
  images: string[];
};

const emptyForm: FormState = {
  productName: "",
  productInfo: "",
  riskModule: "",
  extraNotes: "",
  images: DEFAULT_IMAGE_LABELS,
};

function entryToForm(entry: PromptEntry): FormState {
  let images: string[] = [];
  try {
    images = JSON.parse(entry.images);
  } catch {
    images = [];
  }
  return {
    productName: entry.productName,
    productInfo: entry.productInfo,
    riskModule: entry.riskModule,
    extraNotes: entry.extraNotes,
    images: images.length > 0 ? images : DEFAULT_IMAGE_LABELS,
  };
}

export function PromptWorkspace({ prompts }: { prompts: PromptEntry[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [copied, setCopied] = useState(false);
  const [, startDeleteTransition] = useTransition();

  const [, createAction, isCreating] = useActionState(
    async (_prevState: { ok: boolean } | null, formData: FormData) => {
      await createPrompt(formData);
      setForm(emptyForm);
      setSelectedId(null);
      return { ok: true };
    },
    null
  );

  function selectPrompt(entry: PromptEntry) {
    setSelectedId(entry.id);
    setForm(entryToForm(entry));
  }

  function startNew() {
    setSelectedId(null);
    setForm(emptyForm);
  }

  function updateImage(index: number, value: string) {
    setForm((f) => ({
      ...f,
      images: f.images.map((v, i) => (i === index ? value : v)),
    }));
  }

  function addImage() {
    setForm((f) => ({ ...f, images: [...f.images, ""] }));
  }

  function removeImage(index: number) {
    setForm((f) => ({ ...f, images: f.images.filter((_, i) => i !== index) }));
  }

  function handleDelete(id: string, event: React.MouseEvent) {
    event.stopPropagation();
    if (!confirm("ลบรายการนี้?")) return;
    startDeleteTransition(async () => {
      await deletePrompt(id);
      if (selectedId === id) startNew();
    });
  }

  const output = useMemo(
    () =>
      buildPromptText({
        productInfo: form.productInfo,
        riskModule: form.riskModule,
        extraNotes: form.extraNotes,
        images: form.images,
      }),
    [form]
  );

  async function handleCopy() {
    await navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex flex-1">
      <aside className="flex w-64 shrink-0 flex-col gap-2 border-r border-border p-3">
        <Button onClick={startNew} className="w-full">
          + สินค้าใหม่
        </Button>
        <ul className="flex flex-1 flex-col gap-1 overflow-y-auto">
          {prompts.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                onClick={() => selectPrompt(entry)}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-muted",
                  selectedId === entry.id && "bg-muted"
                )}
              >
                <span className="truncate">{entry.productName}</span>
                <span
                  role="button"
                  aria-label="ลบรายการ"
                  onClick={(event) => handleDelete(entry.id, event)}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </span>
              </button>
            </li>
          ))}
          {prompts.length === 0 && (
            <li className="px-2.5 py-1.5 text-sm text-muted-foreground">
              ยังไม่มีรายการ
            </li>
          )}
        </ul>
      </aside>

      <main className="flex max-w-3xl flex-1 flex-col gap-6 p-6">
        <form action={createAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">ชื่อสินค้า</label>
            <Input
              name="productName"
              value={form.productName}
              onChange={(e) => setForm((f) => ({ ...f, productName: e.target.value }))}
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">ข้อมูลสินค้าจากเว็บ/ร้านค้า</label>
            <Textarea
              name="productInfo"
              rows={5}
              value={form.productInfo}
              onChange={(e) => setForm((f) => ({ ...f, productInfo: e.target.value }))}
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Product Risk Module</label>
            <Textarea
              name="riskModule"
              rows={3}
              value={form.riskModule}
              onChange={(e) => setForm((f) => ({ ...f, riskModule: e.target.value }))}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">ข้อมูลเพิ่มเติมจากฉัน (ถ้ามี)</label>
            <Textarea
              name="extraNotes"
              rows={3}
              value={form.extraNotes}
              onChange={(e) => setForm((f) => ({ ...f, extraNotes: e.target.value }))}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">รูปอ้างอิงที่แนบ</label>
            <div className="flex flex-col gap-2">
              {form.images.map((label, index) => (
                <div key={index} className="flex items-center gap-2">
                  <span className="w-16 shrink-0 text-sm text-muted-foreground">
                    รูปที่ {index + 1}
                  </span>
                  <Input
                    name="images"
                    value={label}
                    onChange={(e) => updateImage(index, e.target.value)}
                  />
                  {index >= 2 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => removeImage(index)}
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
                onClick={addImage}
                className="self-start"
              >
                + เพิ่มรูป
              </Button>
            </div>
          </div>

          <Button type="submit" disabled={isCreating} className="self-start">
            {isCreating ? "กำลังสร้าง..." : "สร้าง Prompt"}
          </Button>
        </form>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Prompt ที่ประกอบแล้ว</label>
            <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
              {copied ? "คัดลอกแล้ว" : "Copy"}
            </Button>
          </div>
          <Textarea readOnly rows={20} value={output} className="font-mono text-xs" />
        </div>
      </main>
    </div>
  );
}
