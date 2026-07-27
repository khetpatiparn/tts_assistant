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

  // entry เปลี่ยนตัว -> โหลดสเปกของตัวใหม่ (คอลัมน์นี้ไม่ได้ถูก key ตาม entry)
  const [loadedFor, setLoadedFor] = useState(entryId);
  if (loadedFor !== entryId) {
    setLoadedFor(entryId);
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
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex items-center gap-1.5 font-mono text-xs tracking-widest text-marigold uppercase hover:text-marigold/80"
        >
          <PackageSearch className="size-3.5" />
          สเปกสินค้า (สกัดจากรูป)
        </button>

        <Button
          type="button"
          size="sm"
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="bg-marigold text-ink hover:bg-marigold/90"
        >
          {isRefreshing ? "กำลังสกัด..." : "สกัดสเปกใหม่"}
        </Button>
      </div>

      {draft.trim() === "" && !isRefreshing && (
        <p className="font-mono text-[0.7rem] text-muted-foreground">
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
          <span className="font-mono text-[0.7rem] text-muted-foreground">
            {isSaving ? "กำลังบันทึก..." : "บันทึกเมื่อคลิกออกจากช่อง"}
          </span>
        </>
      )}

      {error && <p className="font-mono text-[0.7rem] text-record">{error}</p>}
    </section>
  );
}
