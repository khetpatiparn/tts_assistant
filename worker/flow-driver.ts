import { writeFileSync } from "node:fs";
import path from "node:path";
import type { Locator, Page, Response } from "playwright";
import type { WorkerConfig } from "./config";
import { FlowStepError, type ErrorKind } from "./errors";
import { humanClick, maybeIdleScroll, prepareHumanClick, randInt, sleepMs, sleepRange, typeHuman } from "./humanize";
import type { SelectorSet } from "./flow-selectors";
import type { StepLog } from "./failure";
import { hasSignInButton } from "./browser";

export type RoundInput = {
  round: 1 | 2;
  /** รอบ 1 = รูปแคปจากผู้ใช้ · รอบ 2 = รูป candidate ที่ผู้ใช้เลือก (อัปโหลดซ้ำจากดิสก์) */
  productName: string;
  referencePath: string;
  outDir: string;
  /** ชื่อไฟล์ผลลัพธ์ = `${filePrefix}-${index}.png` */
  filePrefix: string;
  /** รอบ 2 ใช้ project เดิมของรอบ 1 · null = สร้างใหม่ */
  projectId: string | null;
};

export type RoundResult = { files: string[]; projectId: string; responseBody: unknown };

/** ลำดับขั้นตายตัว — ชื่อพวกนี้คือค่าใน FlowJob.failedStep และ UI ใช้แปลเป็นคำอธิบาย */
export const FLOW_STEPS = [
  "open-flow",
  "ensure-project",
  "switch-image-mode",
  "set-model",
  "set-aspect-3-4",
  "set-count-4",
  "attach-reference",
  "type-prompt",
  "click-generate",
  "wait-results",
  "dwell",
  "download-4",
] as const;

export type FlowStep = (typeof FLOW_STEPS)[number];

const ASPECT = "3:4";
const COUNT = 4;

/** พรอมต์ตายตัว 2 แบบ (spec §3) — ต้องเหมือน buildFlowPrompt ใน lib/flow-jobs.ts ทุกตัวอักษร */
export function flowPromptFor(round: 1 | 2, productName: string): string {
  return round === 1
    ? `ขอภาพสินค้าอย่างเดียวเท่านั้น พื้นหลังขาว สินค้าคือ "${productName}"`
    : `ขอภาพสินค้าตอนใช้งาน สินค้าคือ "${productName}"`;
}

function isTimeout(e: unknown): boolean {
  return e instanceof Error && (e.name === "TimeoutError" || /Timeout \d+ms exceeded/.test(e.message));
}

/** ลอง selector ตามลำดับ คืนตัวแรกที่ visible · ไม่เจอเลย = selector_drift */
async function firstVisible(page: Page, step: FlowStep, candidates: string[], timeoutMs: number): Promise<Locator> {
  const perCandidate = Math.max(1000, Math.floor(timeoutMs / candidates.length));
  for (const sel of candidates) {
    const loc = page.locator(sel).first();
    try {
      await loc.waitFor({ state: "visible", timeout: perCandidate });
      return loc;
    } catch {
      // ลองตัวถัดไป
    }
  }
  throw new FlowStepError(step, "selector_drift", `หา element ไม่เจอ: ${candidates.join(" | ")}`);
}

/**
 * อ่านกลับว่าตัวเลือกที่เพิ่งกดขึ้นสถานะ "ถูกเลือก" จริง — ไม่ใช่กดแล้วเชื่อ
 *
 * จำเป็นเพราะ humanClick กดด้วย mouse.down/up ตามพิกัดของ boundingBox ไม่ผ่านการตรวจ
 * actionability แบบ locator.click() ถ้ามีอะไรบัง (toast / tooltip / แผงที่เพิ่งเรนเดอร์)
 * คลิกจะไปโดนตัวบังแล้วขั้นนี้ "ผ่าน" ทั้งที่เลือกไม่ติด กลายเป็นรูปผิดสัดส่วน/ผิดโหมด
 * ที่ผู้ใช้ต้องมาไล่เองแทนที่จะพังตรงขั้นที่ผิดจริง
 *
 * Radix (labs) ใช้ aria-selected ส่วน Angular Material (migrated) ใช้ aria-checked
 * จึงยอมรับทั้งสองตัว ตัวไหนเป็น "true" ก็ถือว่าผ่าน
 */
async function assertSelected(loc: Locator, step: FlowStep, what: string): Promise<void> {
  const checked = await loc.getAttribute("aria-checked");
  const selfSelected = await loc.getAttribute("aria-selected");
  if (checked !== "true" && selfSelected !== "true") {
    throw new FlowStepError(
      step,
      "selector_drift",
      `กด ${what} แล้วแต่ไม่ถูกเลือก (aria-checked=${checked ?? "null"} aria-selected=${selfSelected ?? "null"})`
    );
  }
}

/** สัญญาณอันตรายที่ต้องเช็กก่อนทุกขั้น — login หลุด / captcha / modal ที่กิน pointer events */
async function assertPageUsable(page: Page, step: FlowStep, sel: SelectorSet, cfg: WorkerConfig, log: StepLog): Promise<void> {
  const host = new URL(page.url()).host;
  if (host.includes("accounts.google.com") || (await hasSignInButton(page))) {
    throw new FlowStepError(step, "login_required", "ถูกส่งไปหน้า login / เจอปุ่ม Sign in");
  }
  if (!sel.hosts.includes(host)) {
    throw new FlowStepError(step, "host_unsupported", `โฮสต์ ${host} ไม่ตรงกับ selector set ${sel.name}`);
  }
  for (const c of sel.captchaSignals) {
    if ((await page.locator(c).count()) > 0) {
      throw new FlowStepError(step, "captcha", `เจอสัญญาณ captcha: ${c}`);
    }
  }
  const blocked = await page.evaluate(() => getComputedStyle(document.body).pointerEvents === "none");
  if (blocked) {
    log.log(step, "body มี pointer-events:none — ลองปิด overlay");
    await dismissOverlays(page, sel, cfg, log);
    const still = await page.evaluate(() => getComputedStyle(document.body).pointerEvents === "none");
    if (still) throw new FlowStepError(step, "selector_drift", "มี overlay บังหน้าและปิดไม่ได้");
  }
}

async function dismissOverlays(page: Page, sel: SelectorSet, cfg: WorkerConfig, log: StepLog): Promise<void> {
  for (const s of [...sel.consentButtons, ...sel.overlayCloseButtons]) {
    const loc = page.locator(s).first();
    if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
      log.log("open-flow", `ปิด overlay ด้วย ${s}`);
      await humanClick(page, loc, cfg);
      await sleepMs(randInt([600, 1400]));
    }
  }
  await page.keyboard.press("Escape");
  await sleepMs(400);
}

function extractProjectId(url: string, fragment: string): string {
  const after = url.split(fragment)[1] ?? "";
  return after.split("?")[0].split("/")[0];
}

/** เดิน JSON ทั้งก้อน เก็บ URL รูปที่ host อยู่ใน allowlist — ไม่พึ่งชื่อ field (fifeUrl ฯลฯ) */
export function collectImageUrls(body: unknown, hosts: string[], out: Set<string> = new Set()): string[] {
  if (typeof body === "string") {
    if (/^https:\/\//.test(body)) {
      try {
        const h = new URL(body).host;
        if (hosts.some((allowed) => h === allowed || h.endsWith("." + allowed))) out.add(body);
      } catch {
        // ไม่ใช่ URL
      }
    }
  } else if (Array.isArray(body)) {
    for (const v of body) collectImageUrls(v, hosts, out);
  } else if (body && typeof body === "object") {
    for (const v of Object.values(body as Record<string, unknown>)) collectImageUrls(v, hosts, out);
  }
  return [...out];
}

function kindForStatus(status: number): ErrorKind | null {
  if (status === 401) return "login_required";
  if (status === 403) return "captcha";
  if (status === 429) return "flow_error";
  if (status >= 400) return "flow_error";
  return null;
}

/**
 * ทำ 1 รอบ (12 ขั้น) — ทุกขั้นตั้งชื่อไว้ใน FLOW_STEPS · ทุก error ที่หลุดออกไปเป็น FlowStepError
 * opts.forceFailStep ใช้ทดสอบ fail-fast (S4): ถึงขั้นนั้นแล้วโยน selector_drift ทันที
 */
export async function runRound(
  page: Page,
  input: RoundInput,
  cfg: WorkerConfig,
  sel: SelectorSet,
  log: StepLog,
  opts: { forceFailStep?: string } = {}
): Promise<RoundResult> {
  let projectId = input.projectId;
  const responses: { status: number; body: unknown; at: number }[] = [];
  let submitAt = 0;

  const onResponse = async (res: Response) => {
    if (!res.url().includes(sel.results.responseUrlPart)) return;
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      try {
        body = await res.text();
      } catch {
        body = null;
      }
    }
    responses.push({ status: res.status(), body, at: Date.now() });
  };

  async function step<T>(name: FlowStep, fn: () => Promise<T>): Promise<T> {
    if (opts.forceFailStep === name) {
      throw new FlowStepError(name, "selector_drift", "บังคับพังด้วย FLOW_FORCE_FAIL_STEP");
    }
    log.log(name, "เริ่ม");
    await assertPageUsable(page, name, sel, cfg, log);
    try {
      const out = await fn();
      log.log(name, "เสร็จ");
      return out;
    } catch (e) {
      if (e instanceof FlowStepError) throw e;
      if (isTimeout(e)) throw new FlowStepError(name, "selector_drift", `timeout: ${(e as Error).message}`);
      throw new FlowStepError(name, "worker_crash", e instanceof Error ? e.message : String(e));
    }
  }

  try {
    page.on("response", onResponse);

    await step("open-flow", async () => {
      const url = projectId ? sel.projectUrl(projectId) : cfg.flowUrl;
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await sleepMs(randInt([3000, 6000]));
      await dismissOverlays(page, sel, cfg, log);
    });

    projectId = await step("ensure-project", async () => {
      if (page.url().includes(sel.projectUrlFragment)) {
        return extractProjectId(page.url(), sel.projectUrlFragment);
      }
      const btn = await firstVisible(page, "ensure-project", sel.newProject, cfg.selectorTimeoutMs);
      await humanClick(page, btn, cfg);
      await page.waitForURL((u) => u.toString().includes(sel.projectUrlFragment), { timeout: 20_000 });
      await sleepMs(randInt([2000, 4000]));
      await dismissOverlays(page, sel, cfg, log);
      return extractProjectId(page.url(), sel.projectUrlFragment);
    });

    /**
     * เปิดแผงตั้งค่าแบบ idempotent — เปิดอยู่แล้วไม่ต้องกดซ้ำ (กดซ้ำ = ปิด)
     * โฮสต์ที่ไม่ได้ประกาศ settingsPanelOpen ยังกด trigger ทุกครั้งเหมือนเดิม
     */
    async function openSettings(name: FlowStep): Promise<void> {
      if (sel.settingsPanelOpen) {
        const open = await page.locator(sel.settingsPanelOpen).first().isVisible().catch(() => false);
        if (open) return;
      }
      const trigger = await firstVisible(page, name, sel.modeTrigger, cfg.selectorTimeoutMs);
      await humanClick(page, trigger, cfg);
      await sleepMs(randInt([600, 1000]));
    }

    /** ปิดแผงตั้งค่า — ดูคอมเมนต์ settingsPanelOpen ใน flow-selectors ว่าทำไมห้าม Escape */
    async function closeSettings(name: FlowStep): Promise<void> {
      if (!sel.settingsPanelOpen) {
        await page.keyboard.press("Escape");
        await sleepMs(500);
        return;
      }
      const pane = page.locator(sel.settingsPanelOpen).first();
      if (await pane.isVisible().catch(() => false)) {
        const trigger = await firstVisible(page, name, sel.modeTrigger, cfg.selectorTimeoutMs);
        await humanClick(page, trigger, cfg);
        await pane.waitFor({ state: "hidden", timeout: cfg.selectorTimeoutMs });
      }
      await sleepMs(randInt([400, 800]));
    }

    await step("switch-image-mode", async () => {
      await openSettings("switch-image-mode");
      const tab = await firstVisible(page, "switch-image-mode", sel.imageTab, cfg.selectorTimeoutMs);
      await humanClick(page, tab, cfg);
      await sleepMs(randInt([900, 1500]));
      // อ่านกลับก่อนปิดแผง — โหมดผิดแปลว่าได้วิดีโอแทนรูปทั้งรอบ
      await assertSelected(tab, "switch-image-mode", "โหมดรูป");
      // โฮสต์ที่ประกาศ settingsPanelOpen (migrated) ไม่ปิดแผงตรงนี้ — 3 ขั้นถัดไป
      // (โมเดล/สัดส่วน/จำนวน) ใช้แผงเดียวกันต่อ ส่วน labs ยังปิดเมนูด้วย Escape
      // แล้วให้ set-model เปิดใหม่เหมือนเดิม
      if (!sel.settingsPanelOpen) {
        await page.keyboard.press("Escape");
        await sleepMs(500);
      }
    });

    await step("set-model", async () => {
      await openSettings("set-model");
      const modelBtn = await firstVisible(page, "set-model", sel.modelTrigger, cfg.selectorTimeoutMs);
      await humanClick(page, modelBtn, cfg);
      await sleepMs(randInt([500, 900]));
      const option = page.locator(sel.modelOptionNanoBanana2);
      const n = await option.count();
      if (n !== 1) {
        const labels = await page.locator("[role='menuitem'], [role='option']").allInnerTexts();
        throw new FlowStepError("set-model", "selector_drift", `ตัวเลือก Nano Banana 2 แมตช์ ${n} ตัว (ต้อง 1) — เมนูมี: ${labels.join(" / ")}`);
      }
      await humanClick(page, option.first(), cfg);
      await sleepMs(randInt([500, 900]));
    });

    await step("set-aspect-3-4", async () => {
      const tab = page.locator(sel.aspectTab(ASPECT)).first();
      await tab.waitFor({ state: "visible", timeout: cfg.selectorTimeoutMs });
      await humanClick(page, tab, cfg);
      await sleepMs(randInt([400, 800]));
      await assertSelected(tab, "set-aspect-3-4", ASPECT);
    });

    await step("set-count-4", async () => {
      const tabs = page.locator(sel.countTabs).filter({ hasText: sel.countTabPattern });
      const target = tabs.nth(COUNT - 1);
      await target.waitFor({ state: "visible", timeout: cfg.selectorTimeoutMs });
      await humanClick(page, target, cfg);
      await sleepMs(randInt([400, 800]));
      await assertSelected(target, "set-count-4", "x4");
      await closeSettings("set-count-4");
    });

    await step("attach-reference", async () => {
      const add = await firstVisible(page, "attach-reference", sel.addMedia, cfg.selectorTimeoutMs);
      await humanClick(page, add, cfg);
      await sleepMs(randInt([800, 1400]));
      const uploadBtn = await firstVisible(page, "attach-reference", sel.uploadButtonInDialog, cfg.selectorTimeoutMs);
      const uploadResponse = page.waitForResponse((r) => r.url().includes(sel.uploadResponseUrlPart) && r.request().method() === "POST", { timeout: cfg.uploadTimeoutMs });
      // uploadResponse ถูกสร้างไว้ก่อน Promise.all ด้านล่างโดยตั้งใจ (ต้องเริ่มฟังก่อนคลิก) แต่ถ้า
      // waitForEvent("filechooser") ข้างล่าง timeout ก่อน โค้ดจะ throw ทิ้ง uploadResponse ที่ยังรอ
      // อยู่กลางอากาศ — พอมันหมดเวลาเองอีก uploadTimeoutMs (ค่าเริ่มต้น 120s) ทีหลัง จะกลาย
      // เป็น unhandled rejection พังทั้งโปรเซส node (พิสูจน์แล้วจริงตอน E2E: 2026-09-07) แนบ
      // catch เปล่าตรงนี้กันไว้ — ไม่กระทบ `await uploadResponse` ตัวจริงด้านล่างที่ยังโยน error ตามปกติ
      uploadResponse.catch(() => {});
      // จังหวะ "คน" (หน่วง actionDelayMs + เลื่อนเมาส์) ต้องเกิดให้จบ**ก่อน**เริ่มจับเวลา
      // filechooser ไม่งั้น timeout 8 วิถูกกินไปกับการหน่วงจนเหลือเวลาจริงให้ Chrome ยิง event
      // แค่ ~4 วิ แล้วพังเป็น selector_drift ปลอม (เกิดจริงตอน E2E 2026-09-07)
      const clickUpload = await prepareHumanClick(page, uploadBtn, cfg);
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser", { timeout: cfg.selectorTimeoutMs }),
        clickUpload(),
      ]);
      await chooser.setFiles(input.referencePath);
      const up = await uploadResponse;
      if (up.status() >= 400) {
        throw new FlowStepError("attach-reference", "flow_error", `อัปโหลดรูปตอบ HTTP ${up.status()}`);
      }
      await sleepMs(randInt([1000, 2000]));
      const dialog = page.locator(sel.openDialog).last();
      // เว็บใหม่ไม่เลือกไฟล์ที่เพิ่งอัปให้เอง — ยังคาที่สื่อชิ้นเดิม ถ้ากดยืนยันเลยจะได้ของผิดชิ้น
      // จึงต้องรอให้แถวของไฟล์เรานี้มี thumbnail (= อัปเสร็จ) แล้วกดเลือกก่อน
      if (sel.uploadedAssetItem) {
        const item = page.locator(sel.uploadedAssetItem(path.basename(input.referencePath))).first();
        await item.waitFor({ state: "visible", timeout: cfg.uploadTimeoutMs });
        await humanClick(page, item, cfg);
        await sleepMs(randInt([800, 1500]));
      }
      // บางหน้าตาของไดอะล็อกแนบรูปให้ทันทีที่กดเลือกแล้วปิดตัวเอง (โปรเจกต์เปล่าบนเว็บใหม่)
      // บางหน้าตายังเปิดค้างรอปุ่มยืนยัน — เช็กว่ายังเปิดอยู่ไหมก่อน ไม่ใช่บังคับหาปุ่มเสมอ
      if (await dialog.isVisible().catch(() => false)) {
        // ปุ่ม "Add to prompt": ใช้ selector จริงถ้ามี · ไม่มีก็ถอยไปใช้ heuristic
        // "ปุ่มสุดท้ายในไดอะล็อกที่ไม่มีไอคอน" (ข้อความเปลี่ยนตามภาษา จึงไม่จับด้วยข้อความ)
        const confirm = sel.confirmMedia
          ? await firstVisible(page, "attach-reference", sel.confirmMedia, cfg.selectorTimeoutMs)
          : dialog.locator("button").filter({ hasNot: page.locator("i, mat-icon") }).last();
        if ((await confirm.count()) > 0 && (await confirm.isVisible().catch(() => false))) {
          await humanClick(page, confirm, cfg);
        }
        await dialog.waitFor({ state: "hidden", timeout: 15_000 });
      }
      await sleepMs(randInt([1000, 2000]));
    });

    await step("type-prompt", async () => {
      const box = await firstVisible(page, "type-prompt", sel.promptBox, cfg.selectorTimeoutMs);
      await humanClick(page, box, cfg);
      await page.keyboard.press("Control+A");
      await page.keyboard.press("Delete");
      await sleepMs(randInt([300, 700]));
      await typeHuman(page, flowPromptFor(input.round, input.productName), cfg.typeCharDelayMs);
      await sleepMs(randInt([500, 1200]));
    });

    const beforeImgs = await page.locator("img").evaluateAll((els) => els.map((e) => (e as HTMLImageElement).src));

    await step("click-generate", async () => {
      const btn = await firstVisible(page, "click-generate", sel.submit, cfg.selectorTimeoutMs);
      submitAt = Date.now();
      await humanClick(page, btn, cfg);
    });

    const urls = await step("wait-results", async () => {
      const deadline = Date.now() + cfg.generationTimeoutMs;
      while (Date.now() < deadline) {
        if (sel.results.strategy === "network") {
          const fresh = responses.filter((r) => r.at >= submitAt);
          for (const r of fresh) {
            const kind = kindForStatus(r.status);
            if (kind !== null) {
              const snippet = typeof r.body === "string" ? r.body.slice(0, 300) : JSON.stringify(r.body).slice(0, 300);
              throw new FlowStepError("wait-results", kind, `Flow ตอบ HTTP ${r.status}: ${snippet}`);
            }
          }
          const found = collectImageUrls(fresh.map((r) => r.body), sel.results.imageUrlHosts);
          if (found.length >= COUNT) {
            await sleepMs(2500); // เผื่อ response ที่มาช้า (straggler)
            return collectImageUrls(responses.filter((r) => r.at >= submitAt).map((r) => r.body), sel.results.imageUrlHosts);
          }
        } else {
          const now = await page.locator("img").evaluateAll((els) => els.map((e) => (e as HTMLImageElement).src));
          const fresh = now.filter((s) => !beforeImgs.includes(s));
          const good = collectImageUrls(fresh, sel.results.imageUrlHosts);
          if (good.length >= COUNT) {
            await sleepMs(2500);
            return good;
          }
        }
        const alert = page.locator("[role='alert'], [aria-live='assertive']");
        if ((await alert.count()) > 0) {
          const text = (await alert.allInnerTexts()).join(" ").trim();
          if (/policy|can't create|violat|not able to generate|error/i.test(text)) {
            throw new FlowStepError("wait-results", "flow_error", `Flow แจ้ง: ${text.slice(0, 200)}`);
          }
        }
        await sleepMs(2000);
      }
      throw new FlowStepError("wait-results", "generation_timeout", `รอผลเกิน ${cfg.generationTimeoutMs} ms`);
    });

    await step("dwell", async () => {
      await sleepRange(cfg.dwellAfterResultsMs);
      await maybeIdleScroll(page, cfg);
    });

    const files = await step("download-4", async () => {
      const picked = urls.slice(0, COUNT);
      if (picked.length < COUNT) {
        throw new FlowStepError("download-4", "download_failed", `ได้ URL รูปแค่ ${picked.length} จาก ${COUNT}`);
      }
      const written: string[] = [];
      for (const [i, url] of picked.entries()) {
        const res = await page.request.get(url, { maxRedirects: 5, timeout: 120_000 });
        if (!res.ok()) throw new FlowStepError("download-4", "download_failed", `โหลดรูป ${i} ตอบ HTTP ${res.status()}`);
        const buf = await res.body();
        const isPng = buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50;
        const isJpg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8;
        if (!isPng && !isJpg) throw new FlowStepError("download-4", "download_failed", `ไฟล์ ${i} ไม่ใช่ PNG/JPEG (${buf.length} bytes)`);
        const file = path.join(input.outDir, `${input.filePrefix}-${i}.${isPng ? "png" : "jpg"}`);
        writeFileSync(file, buf);
        written.push(file);
        await sleepMs(randInt([300, 900]));
      }
      return written;
    });

    return { files, projectId: projectId as string, responseBody: responses.filter((r) => r.at >= submitAt).map((r) => r.body) };
  } finally {
    page.off("response", onResponse);
  }
}
