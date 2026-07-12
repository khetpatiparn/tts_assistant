"use client";

import { useActionState, useMemo, useState, useTransition } from "react";

import { createPrompt, deletePrompt } from "@/app/actions";
import { ClapperHeader } from "@/components/clapper-header";
import { HistoryRail } from "@/components/history-rail";
import { BriefForm, type FormState } from "@/components/brief-form";
import { ScriptOutput } from "@/components/script-output";
import { ProductionPanel } from "@/components/production-panel";
import { CorePromptPanel } from "@/components/core-prompt-panel";
import { buildPromptText, DEFAULT_IMAGE_LABELS } from "@/lib/prompt-template";
import { WorkspaceTabs, type WorkspaceTab } from "@/components/workspace-tabs";

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
  views: number | null;
  viewsUpdatedAt: Date | null;
  postedAt: Date | null;
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
          <div className="flex flex-1 flex-col gap-5 p-4 sm:p-6 lg:overflow-y-auto xl:flex-row">
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
