import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import type { WorkerConfig } from "./config";
import { sleepMs } from "./humanize";

/**
 * เปิด Chrome จริง (channel "chrome") ด้วยโปรไฟล์ถาวรของบอท
 *
 * ข้อบังคับที่เรียนจาก gflow-cli: headed เท่านั้น · viewport 1920×1080 (ต่ำกว่านี้ Flow
 * ข้าม responsive breakpoint แล้ว selector เพี้ยน) · ซ่อน automation flag + navigator.webdriver
 * ไม่งั้น reCAPTCHA Enterprise ของ Flow ให้คะแนนเป็นบอทและ batchGenerateImages ตอบ 403 ทันที
 * — นี่คือขั้นต่ำเพื่อให้ browser ดูเป็น Chrome ปกติ ไม่ใช่การปลอม fingerprint
 */
export async function launchFlowBrowser(
  cfg: WorkerConfig
): Promise<{ context: BrowserContext; page: Page }> {
  const profileDir = path.resolve(cfg.profileDir);
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: "chrome",
    headless: false,
    viewport: cfg.viewport,
    locale: "en-US",
    args: [
      "--disable-blink-features=AutomationControlled",
      "--password-store=basic",
      "--disable-dev-shm-usage",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
    acceptDownloads: true,
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  const page = context.pages()[0] ?? (await context.newPage());
  return { context, page };
}

/**
 * ไปหน้า Flow แล้วรอให้ redirect จบ — Flow อาจ (1) เติม locale ใน path
 * (/fx/th/tools/flow) หรือ (2) ย้ายทั้งโฮสต์ไป flow.google.com ด้วย location.replace
 * หลังโหลดเสร็จ จึงต้องรอหลังจาก goto กลับมาแล้วอีกช่วงหนึ่งก่อนอ่าน URL
 */
export async function openFlowAndSettle(
  page: Page,
  cfg: WorkerConfig
): Promise<{ host: string; url: string }> {
  await page.goto(cfg.flowUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await sleepMs(6_000);
  const url = page.url();
  return { host: new URL(url).host, url };
}

/** ถาม session endpoint ของ labs.google ว่าล็อกอินอยู่ไหม — คืน email หรือ null */
export async function checkSession(page: Page): Promise<{ email: string | null }> {
  try {
    const res = await page.request.get("https://labs.google/fx/api/auth/session", {
      headers: { Referer: "https://labs.google/fx/tools/flow" },
      timeout: 15_000,
    });
    if (!res.ok()) return { email: null };
    const body = (await res.json()) as { user?: { email?: string } };
    const email = body?.user?.email;
    return { email: typeof email === "string" && email.length > 0 ? email : null };
  } catch {
    return { email: null };
  }
}

/** เจอปุ่ม Sign in บนหน้า = session หลุด (ใช้เป็นตัวตรวจร่วมกับ checkSession) */
export async function hasSignInButton(page: Page): Promise<boolean> {
  return (await page.locator("button:has-text('Sign in'), a:has-text('Sign in')").count()) > 0;
}
