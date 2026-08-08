"use client";

import { useState, useTransition } from "react";
import { PackageSearch } from "lucide-react";

import { refreshProductSpec, saveProductSpec } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function ProductSpecPanel({
  entryId,
  spec,
  model,
}: {
  entryId: string;
  spec: string;
  model: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(spec);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startSaving] = useTransition();
  const [isRefreshing, startRefreshing] = useTransition();

  // entry เปลี่ยนตัว หรือ server เขียนสเปกใหม่ทับของ entry เดิม (เช่น auto-extract
  // ตอน generateWithAI ครั้งแรก) -> resync draft ให้ตรงกับค่าจริงจาก server เสมอ
  const [synced, setSynced] = useState({ entryId, spec });
  if (synced.entryId !== entryId || synced.spec !== spec) {
    setSynced({ entryId, spec });
    setDraft(spec);
    setError(null);
  }

  function commit(value: string) {
    if (value.trim() === spec.trim()) return;
    setError(null);
    startSaving(async () => {
      try {
        await saveProductSpec(entryId, value);
      } catch (e) {
        setError(e instanceof Error ? e.message : "บันทึกสเปกไม่สำเร็จ");
      }
    });
  }

  function handleRefresh() {
    setError(null);
    startRefreshing(async () => {
      try {
        setDraft(await refreshProductSpec(entryId, model));
      } catch (e) {
        setError(e instanceof Error ? e.message : "สกัดสเปกไม่สำเร็จ");
      }
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80"
        >
          <PackageSearch className="size-3.5" />
          สเปกสินค้า (สกัดจากรูป)
        </button>

        <Button type="button" size="sm" variant="outline" onClick={handleRefresh} disabled={isRefreshing}>
          {isRefreshing ? "กำลังสกัด..." : "สกัดสเปกใหม่"}
        </Button>
      </div>

      {synced.spec.trim() === "" && !isRefreshing && (
        <p className="text-xs text-muted-foreground">
          ยังไม่มีสเปก — จะถูกสกัดอัตโนมัติตอนกด &quot;สร้างด้วย AI&quot; ครั้งแรก
        </p>
      )}

      {open && (
        <>
          <Textarea
            rows={12}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commit(draft)}
            placeholder="สเปกสินค้าที่ AI ถอดจากรูป — แก้ได้ถ้าอ่านผิด"
            className="font-sans text-sm leading-[1.6em]"
          />
          <span className="text-xs text-muted-foreground">
            {isSaving ? "กำลังบันทึก..." : "บันทึกเมื่อคลิกออกจากช่อง"}
          </span>
        </>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </section>
  );
}
