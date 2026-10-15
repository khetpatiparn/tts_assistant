import { spawn } from "node:child_process";

/**
 * แจ้งเตือน Windows (toast) ตอนบอทต้องการคน — รูปพร้อมให้เลือก / บอทหยุด
 * เป้าคือให้ผู้ใช้ทำอย่างอื่นได้โดยไม่ต้องคอยเปิดหน้า /flow เช็กเอง (ดู docs/backlog.md "Attended time")
 *
 * ยิงผ่าน Windows PowerShell 5.1 + WinRT ToastNotificationManager ไม่ต้องติดตั้งอะไรเพิ่ม
 * · AppId ยืมของ PowerShell เอง (toast ต้องผูกกับ AppUserModelID ที่ลงทะเบียนแล้ว)
 * · ส่งสคริปต์ผ่าน -EncodedCommand (UTF-16LE base64) กันปัญหา quote/ภาษาไทยในบรรทัดคำสั่ง
 * · กด toast แล้วเปิดหน้า /flow (activationType="protocol")
 * · fire-and-forget: แจ้งเตือนพังต้องไม่ทำให้บอทพัง ห้าม throw ห้าม await
 * ปิดได้ด้วย env FLOW_NOTIFY=0 (เช่นตอนรัน smoke test)
 */
const APP_ID = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe";
const FLOW_PAGE_URL = "http://localhost:3000/flow";

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** แยกออกมาให้ทดสอบรันแบบรอผลได้ (notify จริงไม่ดู stdout/stderr เลย) */
export function buildToastScript(title: string, body: string): string {
  const xml =
    `<toast activationType="protocol" launch="${FLOW_PAGE_URL}"><visual><binding template="ToastGeneric">` +
    `<text>${xmlEscape(title)}</text><text>${xmlEscape(body)}</text></binding></visual></toast>`;
  return [
    "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null",
    "[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null",
    "$x = New-Object Windows.Data.Xml.Dom.XmlDocument",
    // xmlEscape แปลง ' เป็น &apos; ไปแล้ว string literal แบบ '...' ของ PowerShell จึงไม่มีทางถูกปิดกลางคัน
    `$x.LoadXml('${xml}')`,
    `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${APP_ID}').Show([Windows.UI.Notifications.ToastNotification]::new($x))`,
  ].join("; ");
}

export function encodedToastArgs(title: string, body: string): string[] {
  const script = buildToastScript(title, body);
  return ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")];
}

export function notify(title: string, body: string): void {
  if (process.platform !== "win32" || process.env.FLOW_NOTIFY === "0") return;
  try {
    const child = spawn(
      "powershell.exe",
      encodedToastArgs(title, body),
      { stdio: "ignore", windowsHide: true }
    );
    child.on("error", () => undefined);
    child.unref();
  } catch {
    // ไม่มี powershell.exe / spawn พัง — ข้ามไปเงียบๆ
  }
}
