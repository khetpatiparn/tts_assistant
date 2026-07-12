"use client";

import { useActionState, useMemo, useState, useTransition } from "react";

import { createPrompt, deletePrompt, generateWithAI } from "@/app/actions";
import { GEMINI_MODELS } from "@/lib/gemini";
import { ClapperHeader } from "@/components/clapper-header";
import { HistoryRail } from "@/components/history-rail";
import { BriefForm, type FormState } from "@/components/brief-form";
import { ScriptOutput } from "@/components/script-output";
import { ProductionPanel } from "@/components/production-panel";
import { CorePromptPanel } from "@/components/core-prompt-panel";
import { buildPromptText, DEFAULT_IMAGE_LABELS } from "@/lib/prompt-template";
import { WorkspaceTabs, type WorkspaceTab } from "@/components/workspace-tabs";

export type ProductImageRecord = {
  id: string;
  entryId: string;
  filename: string;
  mimeType: string;
  sortOrder: number;
};

export type PromptEntry = {
  id: string;
  productName: string;
  productInfo: string;
  riskModule: string;
  extraNotes: string;
  images: string;
  corePromptId: string | null;
  chatgptOutput: string;
  videoUrl: string;
  postedAt: Date | null;
  productImages: ProductImageRecord[];
};

export type CorePromptRecord = {
  id: string;
  label: string;
  content: string;
  isActive: boolean;
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

export function PromptWorkspace({
  prompts,
  corePrompts,
}: {
  prompts: PromptEntry[];
  corePrompts: CorePromptRecord[];
}) {
  const [tab, setTab] = useState<WorkspaceTab>("brief");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [copied, setCopied] = useState(false);
  const [, startDeleteTransition] = useTransition();
  const [isGenerating, startGenerating] = useTransition();
  const [genError, setGenError] = useState<string | null>(null);
  // Defaults to the fast, high-quota model; the other one is slower but richer.
  const [model, setModel] = useState<string>(GEMINI_MODELS[0].id);

  const [, createAction, isCreating] = useActionState(
    async (_prevState: { ok: boolean } | null, formData: FormData) => {
      const id = await createPrompt(formData);
      setSelectedId(id);
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
    setTab("brief");
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

  function handleGenerate() {
    if (!selectedEntry) return;
    setGenError(null);
    startGenerating(async () => {
      try {
        await generateWithAI(selectedEntry.id, model);
        // The result is saved onto the entry, which the ผลลัพธ์ tab shows.
        setTab("production");
      } catch (e) {
        setGenError(e instanceof Error ? e.message : "สร้างด้วย AI ไม่สำเร็จ");
      }
    });
  }

  const selectedIndex = prompts.findIndex((p) => p.id === selectedId);
  const takeNumber =
    selectedIndex >= 0 ? prompts.length - selectedIndex : prompts.length + 1;

  const selectedEntry = prompts.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="flex min-h-screen flex-1 flex-col lg:h-screen lg:overflow-hidden">
      <ClapperHeader sceneName={form.productName} takeNumber={takeNumber}>
        <WorkspaceTabs
          active={tab}
          onChange={setTab}
          productionDisabled={selectedEntry === null}
        />
      </ClapperHeader>

      <div className="flex flex-1 flex-col lg:flex-row lg:overflow-hidden">
        <HistoryRail
          prompts={prompts}
          selectedId={selectedId}
          onSelect={selectPrompt}
          onNew={startNew}
          onDelete={handleDelete}
        />

        {tab === "brief" && (
          <div className="flex flex-1 flex-col p-4 sm:p-6 lg:overflow-y-auto">
            {/* Inner row is content-height so the cards grow with their content
                and the outer box scrolls, instead of the cards being clipped to
                the viewport. */}
            <div className="flex flex-col gap-5 xl:flex-row">
              <BriefForm
                form={form}
                isCreating={isCreating}
                onFieldChange={updateField}
                onImageChange={updateImage}
                onAddImage={addImage}
                onRemoveImage={removeImage}
                action={createAction}
                entryId={selectedEntry?.id ?? null}
                productImages={selectedEntry?.productImages ?? []}
              />
              <ScriptOutput
                output={output}
                copied={copied}
                onCopy={handleCopy}
                onGenerate={handleGenerate}
                isGenerating={isGenerating}
                canGenerate={(selectedEntry?.productImages.length ?? 0) > 0}
                model={model}
                onModelChange={setModel}
              />
            </div>

            {genError && (
              <p className="mt-3 rounded-md border border-record/40 bg-record/10 px-3 py-2 text-sm text-record">
                {genError}
              </p>
            )}
          </div>
        )}

        {tab === "production" && selectedEntry && (
          <div className="flex flex-1 flex-col p-4 sm:p-6 lg:overflow-y-auto">
            <ProductionPanel key={selectedEntry.id} entry={selectedEntry} />
          </div>
        )}

        {tab === "core" && (
          <div className="flex flex-1 flex-col p-4 sm:p-6 lg:overflow-y-auto">
            <CorePromptPanel corePrompts={corePrompts} />
          </div>
        )}
      </div>
    </div>
  );
}
