"use client";

import { Moon, Sun } from "lucide-react";

/**
 * ปุ่มสลับธีม — จงใจไม่เก็บ React state
 *
 * ธีมถูกตั้งบน <html data-theme> โดยสคริปต์ใน layout ก่อน React จะ hydrate
 * ถ้าคอมโพเนนต์นี้ถือ state ของตัวเอง ค่าฝั่ง server (มืดเสมอ) จะไม่ตรงกับ DOM จริง
 * ทำให้ไอคอนกระพริบสลับตอนโหลด — จึงอ่านและเขียน DOM ตรงๆ แล้วให้ CSS เป็นตัวเลือกไอคอน
 */
export function ThemeToggle() {
  function toggle() {
    const root = document.documentElement;
    const next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
    root.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      // โหมดส่วนตัวบางเบราว์เซอร์เขียน localStorage ไม่ได้ — ธีมยังสลับได้ในรอบนี้ แค่ไม่ถูกจำ
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="สลับธีมสว่างและมืด"
      title="สลับธีมสว่างและมืด"
      className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg border border-header-muted/50 text-header-foreground transition-colors hover:bg-header-foreground/10 focus-visible:ring-2 focus-visible:ring-header-active focus-visible:outline-none lg:size-9"
    >
      <Moon className="size-4 dark:hidden" />
      <Sun className="hidden size-4 dark:block" />
    </button>
  );
}
