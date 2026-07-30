import { cn } from "@/lib/utils";

const BADGE_VARIANT_CLASS = {
  success: "bg-success text-success-foreground",
  warning: "bg-secondary text-secondary-foreground",
  neutral: "bg-muted text-foreground",
  danger: "bg-destructive/10 text-destructive",
} as const;

export type BadgeVariant = keyof typeof BADGE_VARIANT_CLASS;

/**
 * Badge สถานะ — ใช้สี tint เสมอ ไม่ใช่สีปุ่ม action (--primary) โดยตั้งใจ
 * เพื่อแยกบทบาท "ระบบบอกสถานะ" ออกจาก "ผู้ใช้กดทำ action" ตามสเปกการรีแบรนด์
 */
export function Badge({
  variant,
  children,
  className,
}: {
  variant: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[0.6rem] font-bold tracking-wide",
        BADGE_VARIANT_CLASS[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
