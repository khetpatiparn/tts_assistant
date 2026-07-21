"use client";

import { useActionState, useMemo, useState, useTransition } from "react";

import {
  createPrompt,
  deletePrompt,
  generateWithAI,
  updateProductImageCaption,
  uploadProductImages,
} from "@/app/actions";
import { GEMINI_MODELS } from "@/lib/gemini";
import { ClapperHeader } from "@/components/clapper-header";
import { HistoryRail } from "@/components/history-rail";
import { BriefForm, type FormState } from "@/components/brief-form";
import { ScriptOutput } from "@/components/script-output";
import { ProductionPanel } from "@/components/production-panel";
import { CorePromptPanel } from "@/components/core-prompt-panel";
import { buildPromptText } from "@/lib/prompt-template";
import { WorkspaceTabs, type WorkspaceTab } from "@/components/workspace-tabs";
import { DashboardPanel } from "@/components/dashboard-panel";
import type { AffiliateOrderRecord, ReminderState } from "@/lib/dashboard";
import type { ClipMetricRecord } from "@/lib/recommender";

export type ProductImageRecord = {
  id: string;
  entryId: string;
  filename: string;
  mimeType: string;
  caption: string;
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
  caption: string;
  hashtags: string;
  videoUrl: string;
  postedAt: Date | null;
  postedTimeOfDay: string | null;
  createdAt: Date;
  productImages: ProductImageRecord[];
};

export type CorePromptRecord = {
  id: string;
  label: string;
  content: string;
  isActive: boolean;
  kind: string;
};

export type { AffiliateOrderRecord } from "@/lib/dashboard";
export type { ClipMetricRecord } from "@/lib/recommender";

const emptyForm: FormState = {
  productName: "",
  productInfo: "",
  riskModule: "",
  extraNotes: "",
};

function entryToForm(entry: PromptEntry): FormState {
  return {
    productName: entry.productName,
    productInfo: entry.productInfo,
    riskModule: entry.riskModule,
    extraNotes: entry.extraNotes,
  };
}

export function PromptWorkspace({
  prompts,
  corePrompts,
  affiliateOrders,
  clipMetrics,
  reminder,
  reminderActive,
  lastImportedAt,
  now,
}: {
  prompts: PromptEntry[];
  corePrompts: CorePromptRecord[];
  affiliateOrders: AffiliateOrderRecord[];
  clipMetrics: ClipMetricRecord[];
  reminder: ReminderState;
  reminderActive: boolean;
  lastImportedAt: Date | null;
  now: Date;
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

  // Photos pasted before the entry exists. They ride along in memory and are
  // uploaded the moment createPrompt hands back an id to attach them to.
  const [pendingImages, setPendingImages] = useState<{ file: File; caption: string }[]>([]);
  const [isUploading, startUploading] = useTransition();
  const [imageError, setImageError] = useState<string | null>(null);

  function uploadImagesTo(entryId: string, items: { file: File; caption: string }[]) {
    const formData = new FormData();
    formData.set("entryId", entryId);
    for (const { file, caption } of items) {
      formData.append("files", file);
      formData.append("captions", caption);
    }
    return uploadProductImages(formData);
  }

  const [, createAction, isCreating] = useActionState(
    async (_prevState: { ok: boolean } | null, formData: FormData) => {
      const id = await createPrompt(formData);
      if (pendingImages.length > 0) {
        await uploadImagesTo(id, pendingImages);
        setPendingImages([]);
      }
      setSelectedId(id);
      return { ok: true };
    },
    null
  );

  function handleAddImages(files: File[]) {
    if (files.length === 0) return;
    setImageError(null);

    // With an entry to hang them on, photos save immediately. Without one, they
    // wait — either way the user just pastes and it works.
    if (selectedId === null) {
      setPendingImages((prev) => [...prev, ...files.map((file) => ({ file, caption: "" }))]);
      return;
    }

    startUploading(async () => {
      try {
        await uploadImagesTo(selectedId, files.map((file) => ({ file, caption: "" })));
      } catch (e) {
        setImageError(e instanceof Error ? e.message : "แนบรูปไม่สำเร็จ");
      }
    });
  }

  function handleRemovePending(index: number) {
    setPendingImages((prev) => prev.filter((_, i) => i !== index));
  }

  function updatePendingCaption(index: number, caption: string) {
    setPendingImages((prev) => prev.map((it, i) => (i === index ? { ...it, caption } : it)));
  }

  function selectPrompt(entry: PromptEntry) {
    setSelectedId(entry.id);
    setForm(entryToForm(entry));
    setPendingImages([]);
    setImageError(null);
    setGenError(null);
  }

  function startNew() {
    setSelectedId(null);
    setForm(emptyForm);
    setPendingImages([]);
    setImageError(null);
    setGenError(null);
    setTab("brief");
  }

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleDelete(id: string, event: React.MouseEvent) {
    event.stopPropagation();
    if (!confirm("ลบรายการนี้?")) return;
    startDeleteTransition(async () => {
      await deletePrompt(id);
      if (selectedId === id) startNew();
    });
  }

  const selectedEntry = prompts.find((p) => p.id === selectedId) ?? null;

  const output = useMemo(() => {
    const imageCaptions =
      selectedEntry !== null
        ? selectedEntry.productImages.map((p) => p.caption)
        : pendingImages.map((p) => p.caption);
    return buildPromptText({
      productName: form.productName,
      productInfo: form.productInfo,
      riskModule: form.riskModule,
      extraNotes: form.extraNotes,
      imageCaptions,
    });
  }, [form, selectedEntry, pendingImages]);

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
        const result = await generateWithAI(selectedEntry.id, model);
        // 10-part prompt บันทึกแล้วแน่นอน แม้ caption จะพัง — ไปแท็บผลลัพธ์เสมอ
        setTab("production");
        if (result.captionError) {
          setGenError(`สร้าง 10-part prompt สำเร็จ แต่ Caption ไม่สำเร็จ: ${result.captionError}`);
        }
      } catch (e) {
        setGenError(e instanceof Error ? e.message : "สร้างด้วย AI ไม่สำเร็จ");
      }
    });
  }

  const dashboardEntries = useMemo(
    () => prompts.map((p) => ({ id: p.id, productName: p.productName })),
    [prompts]
  );

  const selectedIndex = prompts.findIndex((p) => p.id === selectedId);
  const takeNumber =
    selectedIndex >= 0 ? prompts.length - selectedIndex : prompts.length + 1;

  return (
    <div className="flex min-h-screen flex-1 flex-col lg:h-screen lg:overflow-hidden">
      <ClapperHeader sceneName={form.productName} takeNumber={takeNumber}>
        <WorkspaceTabs
          active={tab}
          onChange={setTab}
          productionDisabled={selectedEntry === null}
          dashboardAlert={reminderActive}
        />
      </ClapperHeader>

      {genError && (
        <p className="mx-4 mt-3 rounded-md border border-record/40 bg-record/10 px-3 py-2 text-sm text-record sm:mx-6">
          {genError}
        </p>
      )}

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
                action={createAction}
                productImages={selectedEntry?.productImages ?? []}
                pendingImages={pendingImages}
                onAddImages={handleAddImages}
                onRemovePending={handleRemovePending}
                onUpdatePendingCaption={updatePendingCaption}
                onSaveCaption={(id, caption) => updateProductImageCaption(id, caption)}
                isUploading={isUploading}
                imageError={imageError}
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
          </div>
        )}

        {tab === "production" && selectedEntry && (
          <div className="flex flex-1 flex-col p-4 sm:p-6 lg:overflow-y-auto">
            <ProductionPanel key={selectedEntry.id} entry={selectedEntry} />
          </div>
        )}

        {tab === "core" && (
          <div className="flex flex-1 flex-col gap-5 p-4 sm:p-6 lg:overflow-y-auto">
            <CorePromptPanel
              corePrompts={corePrompts.filter((c) => c.kind === "core")}
              kind="core"
              title="Core Prompt · สร้างวิดีโอ"
            />
            <CorePromptPanel
              corePrompts={corePrompts.filter((c) => c.kind === "caption")}
              kind="caption"
              title="SEO Prompt · Caption & Hashtag"
            />
          </div>
        )}

        {tab === "dashboard" && (
          <div className="flex flex-1 flex-col p-4 sm:p-6 lg:overflow-y-auto">
            <DashboardPanel
              orders={affiliateOrders}
              clipMetrics={clipMetrics}
              reminder={reminder}
              reminderActive={reminderActive}
              lastImportedAt={lastImportedAt}
              entries={dashboardEntries}
              now={now}
            />
          </div>
        )}
      </div>
    </div>
  );
}
