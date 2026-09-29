import type { Locator, Page } from "playwright";
import { acceptJevChoice } from "./flow-signals";
import { askJevChoice, jevEnabled } from "./jev";

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

/**
 * fallback ชั้นสุดท้ายหลัง CSS selector + findByIntent พังหมด: ส่งรายการปุ่มที่มองเห็นในหน้าให้ Jev เลือกว่าตัวไหน
 * ตรงกับ `intent` (worker/jev.ts) — รับเฉพาะเมื่อมั่นใจ ≥ JEV_MIN_PROBABILITY (ดูผลทดสอบย้อนหลังที่นั่น)
 *
 * ขอบเขตที่ตั้งใจ: ผู้เรียกส่ง intent มาเฉพาะปุ่มที่กดผิดแล้วไม่เสียของ (เปิดแผง/แนบรูป/อัปโหลด/สร้างโปรเจกต์)
 * **ห้ามใช้กับปุ่ม Generate** (กดผิด = เสียเครดิต/เจนซ้อน) และช่องพิมพ์พรอมต์ (ทดสอบแล้ว Jev ไม่มั่นใจ ~0.5)
 * ทุกครั้งที่ Jev เลือก จะถูกจดลง steps.log พร้อมคำอธิบายปุ่ม — ใช้เป็นหลักฐานไปแก้ selector ถาวร
 * ส่งชื่อ class ไปด้วยเสมอ (ทดสอบแล้วแม่นกว่าตัดทิ้ง) · ข้อความปุ่มตัดเหลือ 80 ตัว ไม่ส่งเนื้อหาพรอมต์ยาวๆ
 */
export async function findByJev(
  page: Page,
  intent: string,
  logLine: (msg: string) => void
): Promise<Locator | null> {
  if (!jevEnabled()) return null;
  const marker = `data-jev-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const elements = await page.evaluate((marker) => {
    const sel = "button, [role=button], [role=tab], [role=radio], [role=menuitem], [role=option], input[type=submit], a[href], mat-button-toggle";
    const out: { id: string; desc: string }[] = [];
    for (const el of Array.from(document.querySelectorAll(sel))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === "hidden") continue;
      if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") continue;
      const text = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80);
      const parts = [el.tagName.toLowerCase()];
      if (el.getAttribute("role")) parts.push(`role=${el.getAttribute("role")}`);
      if (text) parts.push(`text="${text}"`);
      for (const a of ["aria-label", "title", "aria-pressed", "type"]) {
        const v = el.getAttribute(a);
        if (v) parts.push(`${a}="${v.slice(0, 60)}"`);
      }
      const cls = typeof (el as HTMLElement).className === "string" ? (el as HTMLElement).className : "";
      const keptClass = cls.replace(/\bng-\S+|\bmat-mdc-\S+|\bmdc-\S+/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
      if (keptClass) parts.push(`class="${keptClass}"`);
      const id = `e${out.length}`;
      el.setAttribute(marker, id);
      out.push({ id, desc: parts.join(" | ") });
      if (out.length >= 240) break;
    }
    return out;
  }, marker);
  if (elements.length === 0) return null;

  const criteria: Record<string, string> = {};
  for (const e of elements) criteria[e.id] = e.desc;
  criteria.none = "No element in this list matches the description.";
  const answer = await askJevChoice(`Which element is this: ${intent}`, criteria, {
    page: "Google Flow (AI image/video generator) project page",
    elements: elements.length,
  });
  const picked = acceptJevChoice(answer);
  const desc = elements.find((e) => e.id === answer?.choice)?.desc ?? answer?.choice ?? "-";
  logLine(
    picked
      ? `Jev เลือกปุ่มแทน selector ที่หาไม่เจอ (p=${answer?.p.toFixed(2)}): ${desc}`
      : `Jev ไม่มั่นใจพอ ไม่กดอะไร (${answer ? `${desc} p=${answer.p.toFixed(2)}` : "เรียก Jev ไม่ได้"})`
  );
  return picked ? page.locator(`[${marker}="${picked}"]`).first() : null;
}
