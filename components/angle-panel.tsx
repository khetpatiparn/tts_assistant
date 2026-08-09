"use client";

import { useState, useTransition } from "react";
import { Compass } from "lucide-react";

import { saveAngle, suggestAngles } from "@/app/actions";
import type { AngleSuggestion, EntryOutcome, UsedAngle } from "@/lib/angle";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { playCompletionSound } from "@/lib/completion-sound";

export type UsedAngleWithOutcome = UsedAngle & { outcome: EntryOutcome };

function baht(n: number): string {
  return "฿" + n.toLocaleString("th-TH", { maximumFractionDigits: 0 });
}

function thaiShortDate(d: Date): string {
  return d.toLocaleDateString("th-TH", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** บรรทัดผลลัพธ์ของ angle หนึ่ง — ข้อเท็จจริงล้วน ไม่จัดอันดับว่า angle ไหนดีกว่า
 *  เพราะสินค้าหนึ่งมีคลิปแค่ 1-3 อัน เทียบกันแล้วสรุปไม่ได้ (อ่าน noise) */
function outcomeLine(item: UsedAngleWithOutcome): string {
  if (!item.posted) return "ยังไม่ได้ลงคลิป";
  const bits: string[] = [];
  if (item.postedAt) bits.push("ลงแล้ว " + thaiShortDate(item.postedAt));
  bits.push(item.outcome.views === null ? "ยังไม่มีข้อมูลวิว" : `${item.outcome.views.toLocaleString("th-TH")} วิว`);
  bits.push(`${item.outcome.orders} ออเดอร์`);
  bits.push(baht(item.outcome.settledRevenue));
  return bits.join(" · ");
}

export function AnglePanel({
  entryId,
  angle,
  used,
}: {
  entryId: string;
  angle: string;
  used: UsedAngleWithOutcome[];
}) {
  const [draft, setDraft] = useState(angle);
  const [suggestions, setSuggestions] = useState<AngleSuggestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSuggesting, startSuggesting] = useTransition();
  const [isSaving, startSaving] = useTransition();

  // entry เปลี่ยนตัว -> โหลด angle ของตัวใหม่ (BriefForm ไม่ถูก key ตาม entry)
  const [loadedFor, setLoadedFor] = useState(entryId);
  if (loadedFor !== entryId) {
    setLoadedFor(entryId);
    setDraft(angle);
    setSuggestions([]);
    setError(null);
  }

  function commit(value: string) {
    if (value.trim() === angle.trim()) return;
    setError(null);
    startSaving(async () => {
      try {
        await saveAngle(entryId, value);
      } catch (e) {
        setError(e instanceof Error ? e.message : "บันทึก angle ไม่สำเร็จ");
      }
    });
  }

  function handleSuggest() {
    setError(null);
    startSuggesting(async () => {
      let outcome: "success" | "error" = "success";
      try {
        setSuggestions(await suggestAngles(entryId));
      } catch (e) {
        outcome = "error";
        setError(e instanceof Error ? e.message : "คิด angle ไม่สำเร็จ");
      }
      playCompletionSound(outcome);
    });
  }

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-5">
      <span className="flex items-center gap-1.5 text-xs text-primary">
        <Compass className="size-3.5" />
        Angle ของคลิปนี้
      </span>

      {used.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3">
          <span className="text-xs text-muted-foreground">
            เคยใช้กับสินค้านี้แล้ว {used.length} angle
          </span>
          {used.map((item) => (
            <div key={item.entryId} className="flex flex-col gap-0.5">
              <span className="text-sm text-foreground/90">{item.text}</span>
              <span className="text-xs text-muted-foreground">
                {outcomeLine(item)}
              </span>
            </div>
          ))}
        </div>
      )}

      <Button type="button" size="sm" variant="outline" onClick={handleSuggest} disabled={isSuggesting}>
        {isSuggesting ? "กำลังคิด..." : "เสนอ angle ใหม่"}
      </Button>

      {suggestions.length > 0 && (
        <div className="flex flex-col gap-2">
          {suggestions.map((s, index) => (
            <button
              key={index}
              type="button"
              onClick={() => {
                setDraft(s.text);
                commit(s.text);
              }}
              className="flex flex-col gap-0.5 rounded-lg border border-border p-2.5 text-left hover:border-primary"
            >
              <span className="text-sm text-foreground/90">{s.text}</span>
              {s.why !== "" && (
                <span className="text-xs text-muted-foreground">
                  เพราะ: {s.why}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      <Textarea
        rows={2}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commit(draft)}
        placeholder="มุมนำเสนอของคลิปนี้ — กดปุ่มด้านบนให้ AI เสนอ หรือพิมพ์เองก็ได้"
      />
      <span className="text-xs text-muted-foreground">
        {isSaving ? "กำลังบันทึก..." : "บันทึกเมื่อคลิกออกจากช่อง"}
      </span>

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
