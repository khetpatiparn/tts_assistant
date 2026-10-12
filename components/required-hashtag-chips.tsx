import { cn } from "@/lib/utils";

/**
 * แฮชแท็กที่ต้องลง (CONTEXT.md) แบบอ่านอย่างเดียวสำหรับแถวในรายการ — ไม่มีปุ่มคัดลอก
 * เพราะแถวพวกนี้เป็นลิงก์/ปุ่มทั้งแถว (ปุ่มซ้อนในลิงก์ไม่ได้) · ตัวคัดลอกอยู่ที่ RequiredHashtagCopy ในหน้า entry / งาน /flow
 *
 * บรรทัดเดียวเสมอ: โชว์ max อันแรก ที่เหลือเป็น "+N" · ว่าง = ไม่ render อะไร
 * tone="rail" ใช้บนพื้นเข้มของแถบข้าง (token header-*)
 */
export function RequiredHashtagChips({
  hashtags,
  max = 2,
  showLabel = false,
  tone = "default",
  className,
}: {
  hashtags: string[] | undefined;
  max?: number;
  showLabel?: boolean;
  tone?: "default" | "rail";
  className?: string;
}) {
  if (hashtags === undefined || hashtags.length === 0) return null;
  const shown = hashtags.slice(0, max);
  const rest = hashtags.length - shown.length;
  const rail = tone === "rail";
  return (
    <span
      className={cn(
        "flex min-w-0 items-center gap-1 overflow-hidden text-xs leading-relaxed whitespace-nowrap",
        rail ? "text-header-muted" : "text-muted-foreground",
        className
      )}
    >
      {showLabel && <span className="shrink-0">ต้องลง</span>}
      {shown.map((tag) => (
        <code
          key={tag}
          className={cn(
            "min-w-0 truncate rounded px-1.5 text-xs",
            rail ? "bg-header-foreground/10 text-header-foreground" : "bg-surface-2 text-foreground"
          )}
        >
          {tag}
        </code>
      ))}
      {rest > 0 && <span className="shrink-0">+{rest}</span>}
    </span>
  );
}
