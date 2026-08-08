import { cn } from "@/lib/utils";

/**
 * จุดสีเป็นตัวสื่อสถานะ ส่วนพื้นและตัวอักษรเป็นกลางเหมือนกันทุก variant
 *
 * เหตุผล: ถ้าย้อมทั้งก้อนตามสถานะ badge จะหน้าตาใกล้ปุ่มจนแยกไม่ออกว่าอันไหนกดได้
 * และตัวอักษรสีเดียวกับพื้นของมันเอง (tone-on-tone) อ่านยากกว่าที่คิด
 * จุดสีทุกตัวผ่าน 3:1 บนพื้น --surface-2 ตาม WCAG 1.4.11 (ตรวจโดย scripts/check-contrast.mjs)
 */
const BADGE_DOT_CLASS = {
  success: "bg-status-success",
  warning: "bg-status-warning",
  neutral: "bg-status-neutral",
  danger: "bg-status-danger",
} as const;

export type BadgeVariant = keyof typeof BADGE_DOT_CLASS;

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
        // ทรงแคปซูลและจุดสีคือสิ่งที่แยก badge ออกจากปุ่ม ซึ่งมุมโค้ง 8px และไม่มีจุด
        "inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-foreground",
        className
      )}
    >
      <span
        aria-hidden="true"
        className={cn("size-1.5 shrink-0 rounded-full", BADGE_DOT_CLASS[variant])}
      />
      {children}
    </span>
  );
}
