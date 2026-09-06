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

/**
 * เจอปุ่ม Sign in ที่ **มองเห็นจริง** บนหน้า = session หลุด (ใช้เป็นตัวตรวจร่วมกับ checkSession)
 *
 * ต้องกรอง visible ด้วยเพราะ assertPageUsable เรียกตัวนี้ก่อนทุกขั้น (12 ครั้ง/รอบ) แบบไม่มีคนดู
 * ถ้านับแค่ count() ปุ่ม Sign in ที่ซ่อนอยู่ใน SPA (เมนูที่ยังไม่กาง / แผงบัญชีที่ hidden)
 * ตัวเดียวก็หยุดทั้งคิวเป็น login_required แล้วสั่งให้ผู้ใช้ล็อกอินใหม่ทั้งที่ session ยังดีอยู่
 */
export async function hasSignInButton(page: Page): Promise<boolean> {
  const loc = page.locator("button:has-text('Sign in'), a:has-text('Sign in')");
  const count = await loc.count();
  for (let i = 0; i < count; i++) {
    if (await loc.nth(i).isVisible().catch(() => false)) return true;
  }
  return false;
}
