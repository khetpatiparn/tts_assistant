import type { Locator, Page } from "playwright";

/**
 * หา button/[role=button]/input[type=submit] จาก "ความหมาย" (ข้อความรวม innerText + aria-label +
 * title) แทนการพึ่ง CSS class/attribute ตายตัว — ทนต่อ Google เปลี่ยน class/markup ได้ตราบใดที่
 * label เชิงความหมายยังคล้ายเดิม
 *
 * ที่มา: พบว่าปุ่ม "Settings trigger" ของ Flow (flow.google.com) เปลี่ยน markup เมื่อ 2026-09-22
 * (class เดิมหาย ถูกแทนด้วยปุ่มใหม่ที่มี aria-label="Settings" + <mat-icon>tune</mat-icon>)
 * จนบอทพังทั้งคิว — หลักฐานที่ uploads/_flow-failures/ ยืนยันซ้ำ 2 ครั้งอิสระกัน แนวทางนี้ยืมมา
 * จาก TB.findButton ใน extension "Triple Bot" (พบตอนสำรวจไฟล์ zip อีก repo หนึ่ง 2026-09-23)
 *
 * **นี่คือ fallback ชั้นสุดท้ายเท่านั้น ห้ามใช้แทน selector ที่ยืนยันสดแล้วใน flow-selectors.ts**
 * เพราะยังไม่มีการยืนยันสดว่า regex ที่เขียนไว้แม่นสำหรับปุ่มอื่นๆ ในหน้า (เสี่ยง false-positive
 * คลิกผิดปุ่ม) — เขียน regex ใหม่ทุกครั้งต้องมีหลักฐาน DOM dump จริงรองรับ ไม่ใช่เดา
 */
export async function findByIntent(page: Page, matchRe: RegExp, excludeRe?: RegExp): Promise<Locator | null> {
  const marker = `data-tb-intent-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const found = await page.evaluate(
    ({ matchSrc, matchFlags, excludeSrc, excludeFlags, marker }) => {
      const match = new RegExp(matchSrc, matchFlags);
      const exclude = excludeSrc ? new RegExp(excludeSrc, excludeFlags) : null;
      const isVisible = (el: Element) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
      };
      const candidates = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"]'));
      for (const el of candidates) {
        if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") continue;
        if (!isVisible(el)) continue;
        const label = [
          (el as HTMLElement).innerText || el.textContent || "",
          el.getAttribute("aria-label") || "",
          (el as HTMLElement).title || "",
        ].join(" ");
        if (exclude && exclude.test(label)) continue;
        if (match.test(label)) {
          el.setAttribute(marker, "1");
          return true;
        }
      }
      return false;
    },
    { matchSrc: matchRe.source, matchFlags: matchRe.flags, excludeSrc: excludeRe?.source ?? null, excludeFlags: excludeRe?.flags ?? "", marker }
  );
  if (!found) return null;
  return page.locator(`[${marker}]`).first();
}
