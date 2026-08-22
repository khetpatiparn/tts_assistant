/**
 * คัดลอกข้อความแบบมีทางสำรอง
 *
 * navigator.clipboard ทำงานเฉพาะ secure context (HTTPS หรือ localhost) — การเปิดแอป
 * จากมือถือผ่าน LAN คือ http://192.168.x.x:3000 ซึ่งไม่ใช่ ปุ่มคัดลอกจึงตายเงียบ
 * ทั้งที่เป็นหัวใจของ workflow (คัดลอก 10-part prompt ไป Google Flow)
 *
 * แยก deps ออกมาเป็นพารามิเตอร์เพื่อให้ scripts/check-clipboard.mjs ทดสอบตรรกะ
 * การเลือกทางได้ในสภาพแวดล้อม node ที่ไม่มี DOM
 */

/** ทางที่ใช้คัดลอกจริง — "manual" แปลว่าคัดลอกให้ไม่ได้ ต้องให้ผู้ใช้ทำเอง */
export type CopyOutcome = "clipboard-api" | "exec-command" | "manual";

export type ClipboardDeps = {
  /** null เมื่อเบราว์เซอร์ไม่มี navigator.clipboard เลย (non-secure context) */
  writeToClipboard: ((text: string) => Promise<void>) | null;
  /** null เมื่อไม่มี document ให้ใช้ (เช่นตอนทดสอบใน node) */
  execCopy: ((text: string) => boolean) | null;
};

export async function copyText(text: string, deps: ClipboardDeps): Promise<CopyOutcome> {
  if (deps.writeToClipboard !== null) {
    try {
      await deps.writeToClipboard(text);
      return "clipboard-api";
    } catch {
      // ตกลงไปใช้ทางสำรอง — เคสนี้เกิดจริงเมื่อ origin ไม่ใช่ secure context
    }
  }

  if (deps.execCopy !== null) {
    try {
      if (deps.execCopy(text)) {
        return "exec-command";
      }
    } catch {
      // execCommand ถูกถอดออกในเบราว์เซอร์ใหม่บางตัว — ตกไปทางสุดท้าย
    }
  }

  return "manual";
}

export function browserClipboardDeps(): ClipboardDeps {
  const canUseClipboardApi =
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard !== "undefined" &&
    typeof navigator.clipboard.writeText === "function";

  const canUseExecCommand =
    typeof document !== "undefined" && typeof document.execCommand === "function";

  return {
    writeToClipboard: canUseClipboardApi
      ? (text: string) => navigator.clipboard.writeText(text)
      : null,
    execCopy: canUseExecCommand
      ? (text: string) => {
          // textarea (ไม่ใช่ input) เพราะข้อความมีหลายบรรทัด
          const area = document.createElement("textarea");
          area.value = text;
          // ต้องอยู่ใน DOM จริงถึงจะ select ได้ แต่ต้องไม่เลื่อนหน้าจอ
          area.setAttribute("readonly", "");
          area.style.position = "fixed";
          area.style.top = "0";
          area.style.left = "0";
          area.style.opacity = "0";
          document.body.appendChild(area);
          try {
            area.select();
            area.setSelectionRange(0, text.length);
            return document.execCommand("copy");
          } finally {
            document.body.removeChild(area);
          }
        }
      : null,
  };
}

/** ทางลัดสำหรับ client component — ประกอบ deps จากเบราว์เซอร์ให้เอง */
export function copyInBrowser(text: string): Promise<CopyOutcome> {
  return copyText(text, browserClipboardDeps());
}
