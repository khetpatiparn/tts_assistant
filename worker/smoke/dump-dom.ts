import { writeFileSync } from "node:fs";
import type { Page } from "playwright";

/**
 * เขียนรายการ element ที่กดได้ทั้งหมดของหน้า พร้อมชื่อไอคอน/aria-label/ข้อความ
 * ลงไฟล์ — ใช้เป็น "แผนที่" ตอนต้องหา selector ใหม่ (โฮสต์ใหม่ หรือ Flow เปลี่ยนหน้า)
 * ไม่มี logic ตัดสินใจ แค่ inventory
 */
export async function dumpDom(page: Page, outFile: string): Promise<void> {
  const rows = await page.evaluate(() => {
    const out: string[] = [];
    const els = document.querySelectorAll<HTMLElement>(
      "button, [role='button'], [role='tab'], [role='menuitem'], [role='option'], a[href], [contenteditable='true'], textarea, input[type='file']"
    );
    els.forEach((el, i) => {
      const icons = Array.from(el.querySelectorAll("i, mat-icon, svg"))
        .map((n) => (n.tagName === "SVG" ? "svg" : (n.textContent ?? "").trim()))
        .filter(Boolean)
        .join("|");
      const attrs = ["aria-label", "aria-haspopup", "aria-controls", "aria-selected", "aria-pressed", "role", "data-state", "id", "class"]
        .map((a) => (el.getAttribute(a) ? `${a}="${el.getAttribute(a)}"` : ""))
        .filter(Boolean)
        .join(" ");
      const text = (el.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
      const r = el.getBoundingClientRect();
      const visible = r.width > 0 && r.height > 0;
      out.push(`${i}\t${el.tagName.toLowerCase()}\tvisible=${visible}\ticons=[${icons}]\ttext="${text}"\t${attrs}`);
    });
    return out;
  });
  const aria = await page.locator("body").ariaSnapshot();
  writeFileSync(outFile, `URL: ${page.url()}\n\n=== clickable inventory ===\n${rows.join("\n")}\n\n=== aria snapshot ===\n${aria}\n`, "utf8");
}
