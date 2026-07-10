"use client";

import { useActionState, useMemo, useState, useTransition } from "react";

import { createPrompt, deletePrompt } from "@/app/actions";
import { ClapperHeader } from "@/components/clapper-header";
import { HistoryRail } from "@/components/history-rail";
import { BriefForm, type FormState } from "@/components/brief-form";
import { ScriptOutput } from "@/components/script-output";
import { buildPromptText, DEFAULT_IMAGE_LABELS } from "@/lib/prompt-template";

export type PromptEntry = {
  id: string;
  productName: string;
  productInfo: string;
  riskModule: string;
  extraNotes: string;
  images: string;
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

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
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

  const selectedIndex = prompts.findIndex((p) => p.id === selectedId);
  const takeNumber =
    selectedIndex >= 0 ? prompts.length - selectedIndex : prompts.length + 1;

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <ClapperHeader sceneName={form.productName} takeNumber={takeNumber} />

      <div className="flex flex-1 flex-col lg:flex-row">
        <HistoryRail
          prompts={prompts}
          selectedId={selectedId}
          onSelect={selectPrompt}
          onNew={startNew}
          onDelete={handleDelete}
        />

        <div className="flex flex-1 flex-col gap-5 p-4 sm:p-6 xl:flex-row">
          <BriefForm
            form={form}
            isCreating={isCreating}
            onFieldChange={updateField}
            onImageChange={updateImage}
            onAddImage={addImage}
            onRemoveImage={removeImage}
            action={createAction}
          />
          <ScriptOutput output={output} copied={copied} onCopy={handleCopy} />
        </div>
      </div>
    </div>
  );
}
