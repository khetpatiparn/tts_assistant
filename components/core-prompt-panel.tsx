"use client";

import { useActionState, useState, useTransition } from "react";
import { Check } from "lucide-react";

import { createCorePrompt, setActiveCorePrompt } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { CorePromptRecord } from "@/components/prompt-workspace";

export function CorePromptPanel({
  corePrompts,
}: {
  corePrompts: CorePromptRecord[];
}) {
  const [viewingId, setViewingId] = useState<string | null>(
    corePrompts.find((c) => c.isActive)?.id ?? corePrompts[0]?.id ?? null
  );
  const [isActivating, startActivating] = useTransition();

  const [, addAction, isAdding] = useActionState(
    async (_prev: { ok: boolean } | null, formData: FormData) => {
      await createCorePrompt(formData);
      return { ok: true };
    },
    null
  );

  const viewing = corePrompts.find((c) => c.id === viewingId) ?? null;

  function activate(id: string) {
    startActivating(async () => {
      await setActiveCorePrompt(id);
    });
  }

  return (
    <div className="flex flex-1 flex-col gap-5 xl:flex-row">
      <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 sm:p-6 xl:w-96">
        <div className="flex items-center gap-2 border-b border-border pb-3">
          <span className="h-4 w-1 rounded-full bg-rust" />
          <h2 className="font-mono text-xs tracking-widest text-rust uppercase">
            Core Prompt · เวอร์ชัน
          </h2>
        </div>

        <ul className="flex flex-col gap-1">
          {corePrompts.map((core) => (
            <li key={core.id}>
              <button
                type="button"
                onClick={() => setViewingId(core.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted",
                  viewingId === core.id && "bg-muted"
                )}
              >
                <span className="font-mono text-xs text-muted-foreground">
                  {core.label}
                </span>
                {core.isActive && (
                  <span className="ml-auto flex items-center gap-1 font-mono text-[0.65rem] text-rust">
                    <Check className="size-3" />
                    ใช้อยู่
                  </span>
                )}
              </button>
            </li>
          ))}
          {corePrompts.length === 0 && (
            <li className="px-2.5 py-2 text-sm text-muted-foreground">
              ยังไม่มีเวอร์ชัน
            </li>
          )}
        </ul>

        <form action={addAction} className="flex flex-col gap-3 border-t border-border pt-4">
          <p className="font-mono text-[0.65rem] tracking-widest text-muted-foreground uppercase">
            เพิ่มเวอร์ชันใหม่
          </p>
          <Input name="label" placeholder="ชื่อเวอร์ชัน เช่น v5" required />
          <Textarea
            name="content"
            rows={6}
            placeholder="วางเนื้อหา core prompt ที่นี่"
            required
          />
          <Button
            type="submit"
            disabled={isAdding}
            className="self-start bg-rust text-primary-foreground hover:bg-rust/90"
          >
            {isAdding ? "กำลังเพิ่ม..." : "เพิ่มและใช้เวอร์ชันนี้"}
          </Button>
        </form>
      </section>

      <section className="flex flex-1 flex-col gap-3 rounded-xl border border-border bg-card p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <span className="h-4 w-1 rounded-full bg-marigold" />
            <h2 className="font-mono text-xs tracking-widest text-marigold uppercase">
              {viewing ? viewing.label : "ยังไม่ได้เลือก"}
            </h2>
          </div>
          {viewing && !viewing.isActive && (
            <Button
              type="button"
              size="sm"
              disabled={isActivating}
              onClick={() => activate(viewing.id)}
              className="bg-marigold text-ink hover:bg-marigold/90"
            >
              {isActivating ? "กำลังเปลี่ยน..." : "ใช้เวอร์ชันนี้"}
            </Button>
          )}
        </div>

        <Textarea
          readOnly
          value={viewing?.content ?? ""}
          placeholder="เลือกเวอร์ชันทางซ้ายเพื่อดูเนื้อหา"
          className="min-h-96 flex-1 resize-none border-none bg-transparent p-0 font-sans text-sm leading-[1.6em] shadow-none focus-visible:ring-0"
        />
      </section>
    </div>
  );
}
