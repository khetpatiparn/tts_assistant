/**
 * Flow session — ส่วนที่ทุกสูตรใน flow-driver.ts (วาดรูป / Render / Final clip) ใช้ร่วมกันบนหน้า Flow ที่เปิดอยู่:
 * ขั้นที่มีชื่อ (`step`/`softStep` + ตรวจหน้าก่อนทุกขั้น) · ภาพจุดเช็ก · เปิดโปรเจกต์ (open-flow + ensure-project) ·
 * แผงตั้งค่า · แนบรูปอ้างอิง · กด Generate · ดัก response ของ RPC เจน · ต่อสายสัญญาณบอทเข้า FlowActivity
 *
 * ไม่ใช่ interface ของบอท — ผู้เรียกภายนอก (worker/index.ts, smoke) ใช้สูตรใน flow-driver.ts เท่านั้น
 * session มีอายุเท่าหนึ่งสูตร (`withFlowSession` ติด/ถอด listener ของ response ให้เอง) · ไม่มีสถานะข้ามสูตร
 *
 * ชื่อขั้น (FLOW_STEPS) คือค่าใน FlowJob.failedStep — หลักฐานตอนพัง ข้อความใน /flow (STEP_LABELS) และ steps.log ผูกกับมัน
 */
import path from "node:path";
import type { Locator, Page, Response } from "playwright";
import type { WorkerConfig } from "./config";
import { FlowStepError } from "./errors";
import { humanClick, prepareHumanClick, randInt, sleepMs } from "./humanize";
import { findByIntent, findByJev } from "./dom-heuristics";
import type { SelectorSet } from "./flow-selectors";
import type { StepLog } from "./failure";
import { hasSignInButton } from "./browser";
import { logActivity } from "./activity";
import { isBrowserErrorPage, postRenderFailReason, retryTransientNav, stepErrorKind } from "./flow-signals";
import { isNetworkRetryStep } from "@/lib/flow-network";
import { attachCountMismatchMessage } from "@/lib/flow-lifecycle";
import { clipCapture, type ClipCapture } from "./clip-capture";
import type { ObservedResponse } from "./generation-watch";

/** ลำดับขั้นตายตัว — ชื่อพวกนี้คือค่าใน FlowJob.failedStep และ UI ใช้แปลเป็นคำอธิบาย (STEP_LABELS) */
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
  // Render คลิป (รอบ 3) — ใช้ open-flow/ensure-project/attach-reference/click-generate/dwell ร่วมกับรอบรูป
  "switch-video-mode",
  "set-video-settings",
  "paste-prompt",
  "wait-render",
  "download-preview",
  // โหลดคลิปที่ผ่านแบบ 1080p (รอบ 4) — ใช้ open-flow/ensure-project ร่วม
  "find-video",
  "download-final",
] as const;

export type FlowStep = (typeof FLOW_STEPS)[number];

/** หน้า Flow ที่บอทคุมอยู่ + งานที่กำลังทำ — เหมือนกันทุกสูตรของงานเดียว */
export type FlowContext = {
  page: Page;
  cfg: WorkerConfig;
  sel: SelectorSet;
  log: StepLog;
  /** สำหรับ FlowActivity เท่านั้น */
  jobId: string;
  /** hook ทดสอบ fail-fast (FLOW_FORCE_FAIL_STEP): ถึงขั้นนี้แล้วโยน selector_drift ทันที (ก่อนแตะหน้า) · ไม่ตั้ง = ไม่มีผล */
  forceFailStep?: string;
};

/** ที่เขียนผลของสูตร — ชื่อไฟล์ผลลัพธ์และภาพจุดเช็กขึ้นต้นด้วย prefix เดียวกัน */
export type OutputFiles = {
  /** โฟลเดอร์ไฟล์ผลลัพธ์ */
  dir: string;
  /** รูป `${prefix}-${i}.png` · คลิป `${prefix}.mp4` · ภาพจุดเช็ก `${prefix}-${n}-${name}.jpg` */
  prefix: string;
  /** โฟลเดอร์ภาพจุดเช็ก · null = ไม่เก็บ (smoke test) */
  checkpointDir: string | null;
};

/**
 * คำอธิบายปุ่มให้ Jev ตอน selector พัง (firstVisible → findByJev) — เฉพาะปุ่มที่กดผิดแล้วไม่เสียของ
 * ข้อความเดียวกับที่ใช้ทดสอบย้อนหลังกับ page.html จริง (ดู JEV_MIN_PROBABILITY) แก้แล้วควรทดสอบซ้ำ
 * **ไม่มี Generate กับช่องพิมพ์พรอมต์โดยตั้งใจ**
 */
const JEV_INTENT = {
  newProject: "The button that creates a new project.",
  settings:
    "The button that opens the image generation settings panel (where you pick the model, aspect ratio and number of outputs) next to the prompt box.",
  addMedia: "The button next to the prompt box that adds or attaches a reference image/media (ingredients) to the prompt.",
  upload: "The button inside the media picker dialog that uploads a new image file from the computer.",
  confirmMedia: "The button inside the media picker dialog that adds the selected media to the prompt.",
} as const;

/**
 * ลอง selector ตามลำดับ คืนตัวแรกที่ visible · ไม่เจอเลย = selector_drift
 * `intent` (ถ้ามี) คือ fallback ชั้นสุดท้ายหลัง CSS selector ทุกตัวพังหมด — หาแทนด้วยความหมาย
 * ของปุ่ม (ดูคอมเมนต์ที่ findByIntent) ใส่เฉพาะจุดที่มีหลักฐาน DOM dump จริงรองรับแล้วเท่านั้น
 */
export async function firstVisible(
  page: Page,
  step: FlowStep,
  candidates: string[],
  timeoutMs: number,
  intent?: { match: RegExp; exclude?: RegExp },
  jev?: { intent: string; log: StepLog }
): Promise<Locator> {
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
  if (intent) {
    const loc = await findByIntent(page, intent.match, intent.exclude);
    if (loc) return loc;
  }
  // ด่านสุดท้าย: ให้ Jev เลือกจากรายการปุ่มในหน้า (ดู findByJev — ใช้เฉพาะปุ่มที่กดผิดแล้วไม่เสียของ)
  if (jev) {
    const loc = await findByJev(page, jev.intent, (msg) => jev.log.log(step, msg));
    if (loc) return loc;
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
/**
 * เช็คว่า locator นี้อยู่ในสถานะ "ถูกเลือก" ไหม โดยไม่โยน error — ใช้ทั้งใน assertSelected
 * (ยืนยันหลังคลิก) และเป็น pre-check ก่อนคลิกเพื่อข้ามการคลิก+รอที่ไม่จำเป็น (แก้ 2026-09-23:
 * ค่าตั้งค่า image/aspect/count ยืนยันสดแล้วว่าติดข้ามโปรเจกต์ใหม่จริง — รอบที่ 2 เป็นต้นไปของ
 * worker session เดียวกันจึงมักไม่ต้องคลิกอะไรเลยในขั้นเหล่านี้ ประหยัดเวลาได้จริงไม่ใช่แค่ลด
 * ความหน่วงที่จงใจใส่ไว้ — ต่างจาก actionDelayMs/typeCharDelayMs/dwellAfterResultsMs ที่ลดแล้ว
 * มีผลเรื่องความเสี่ยงโดนตรวจจับบอท อันนี้คือการตัดงานซ้ำที่ไม่จำเป็นล้วนๆ)
 */
export async function isChecked(loc: Locator): Promise<boolean> {
  const checked = await loc.getAttribute("aria-checked").catch(() => null);
  const selfSelected = await loc.getAttribute("aria-selected").catch(() => null);
  const classAttr = await loc.getAttribute("class").catch(() => null);
  const classChecked = classAttr?.includes("mat-button-toggle-checked") ?? false;
  return checked === "true" || selfSelected === "true" || classChecked;
}

export async function assertSelected(loc: Locator, step: FlowStep, what: string): Promise<void> {
  if (await isChecked(loc)) return;
  const checked = await loc.getAttribute("aria-checked");
  const selfSelected = await loc.getAttribute("aria-selected");
  const classAttr = await loc.getAttribute("class");
  throw new FlowStepError(
    step,
    "selector_drift",
    `กด ${what} แล้วแต่ไม่ถูกเลือก (aria-checked=${checked ?? "null"} aria-selected=${selfSelected ?? "null"} class=${classAttr ?? "null"})`
  );
}

/** สัญญาณอันตรายที่ต้องเช็กก่อนทุกขั้น — login หลุด / captcha / modal ที่กิน pointer events */
async function assertPageUsable(page: Page, step: FlowStep, sel: SelectorSet, cfg: WorkerConfig, log: StepLog, jobId: string, round: number): Promise<void> {
  // งานก่อนหน้าข้ามไปเพราะเน็ตสะดุด → แท็บค้างที่หน้า error ของ Chrome · open-flow จะ goto ทับอยู่แล้ว ไม่มีอะไรของ Google ให้ตรวจ
  // (ensure-project ถัดไปตรวจหน้าจริงตามปกติ)
  if (step === "open-flow" && isBrowserErrorPage(page.url())) return;
  const host = new URL(page.url()).host;
  if (host.includes("accounts.google.com") || (await hasSignInButton(page))) {
    logActivity({ kind: "bot_signal", jobId, round, detail: { signal: "login_required" } });
    throw new FlowStepError(step, "login_required", "ถูกส่งไปหน้า login / เจอปุ่ม Sign in");
  }
  if (!sel.hosts.includes(host)) {
    throw new FlowStepError(step, "host_unsupported", `โฮสต์ ${host} ไม่ตรงกับ selector set ${sel.name}`);
  }
  for (const c of sel.captchaSignals) {
    if ((await page.locator(c).count()) > 0) {
      logActivity({ kind: "bot_signal", jobId, round, detail: { signal: c } });
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

export type SoftStepResult<T> = { ok: true; value: T } | { ok: false; reason: string };

/** สิ่งที่สูตรหนึ่งใช้บนหน้า Flow — สร้างโดย withFlowSession เท่านั้น */
export type FlowSession = {
  readonly page: Page;
  readonly cfg: WorkerConfig;
  readonly sel: SelectorSet;
  readonly log: StepLog;
  readonly out: OutputFiles;
  /** response ของ RPC เจน (sel.results.responseUrlPart) ที่ดักได้ตั้งแต่เริ่มสูตร — array เดียวที่ยังโตอยู่ */
  readonly responses: readonly ObservedResponse[];
  /** ตัวเฝ้าหลังกด Generate (generation-watch.ts) เจอ captcha/login → ลง FlowActivity ก่อน throw */
  onBotSignal(signal: string): void;
  /**
   * ขั้นที่ต้องสำเร็จ — ตรวจหน้าก่อน (assertPageUsable) แล้วทำ · error ทุกชนิดออกไปเป็น FlowStepError ชื่อขั้นนี้
   * (timeout ของ Playwright = selector_drift · อื่นๆ = worker_crash)
   */
  step<T>(name: FlowStep, fn: () => Promise<T>): Promise<T>;
  /**
   * ขั้นหลัง Render สำเร็จ: ห้ามทำให้งาน failed/pause (เครดิตจ่ายแล้ว) — assertPageUsable และตัวขั้นเองถูกจับไว้หมด
   * แล้วคืน {ok:false} ให้ผู้เรียกข้ามการโหลด (ไม่ hover/คลิกหน้าที่โดนธง) · ขั้น pre-render ของงานถัดไปยัง fail-fast
   * เรื่อง captcha ผ่าน assertPageUsable ตามเดิม · FLOW_FORCE_FAIL_STEP ยัง throw ได้ (hook ทดสอบเท่านั้น)
   */
  softStep<T>(name: FlowStep, fn: () => Promise<T>): Promise<SoftStepResult<T>>;
  /** ภาพจุดเช็ก `${out.prefix}-${n}-${name}.jpg` — ห้ามทำให้งานพัง */
  checkpoint(n: number, name: string): Promise<void>;
  /**
   * ขั้น open-flow + ensure-project → id ของโปรเจกต์ · projectId null = หน้าแรกของ Flow แล้วสร้างโปรเจกต์ใหม่
   * existingOnly = ต้องเปิดโปรเจกต์เดิมได้เท่านั้น ห้ามสร้างใหม่ (Final clip — คลิปที่ผ่านอยู่ในโปรเจกต์เดิม)
   */
  openProject(projectId: string | null, existingOnly: boolean): Promise<string>;
  openSettings(name: FlowStep): Promise<void>;
  closeSettings(name: FlowStep): Promise<void>;
  /**
   * แนบรูปอ้างอิงเข้าช่องพรอมต์ (ผู้เรียกห่อด้วยขั้น attach-reference) — expectChips: ต้องมีชิปรูปเท่านี้พอดีหลังแนบครบ
   * ไม่งั้นพังตรงนี้ ไม่ปล่อยไปเสียเครดิต · จบด้วยภาพจุดเช็ก 2 "reference"
   */
  attachReferences(paths: string[], expectChips?: { selector: string; count: number }): Promise<void>;
  /** ขั้น click-generate: กดครั้งเดียว ลง FlowActivity ตาม kind · คืนเวลาที่กด (submitAt — response ก่อนหน้านี้ไม่นับ) */
  clickGenerate(kind: "generate_image" | "generate_video"): Promise<number>;
  /** ตัวดึงไฟล์คลิป (clip-capture.ts) ของสูตรนี้ — สร้างใหม่ทุกครั้งที่เรียก สถานะไม่ข้าม instance */
  clipCapture(): ClipCapture;
};

/**
 * เปิด session ให้สูตรหนึ่งบนหน้า Flow — ติด listener ของ response ก่อนเริ่ม ถอดออกเสมอเมื่อสูตรจบ (สำเร็จหรือพัง)
 * round ใช้ลง FlowActivity เท่านั้น (1-2 รูป · 3 Render · 4 Final clip)
 */
export async function withFlowSession<T>(
  ctx: FlowContext,
  round: 1 | 2 | 3 | 4,
  out: OutputFiles,
  fn: (s: FlowSession) => Promise<T>,
): Promise<T> {
  const { page, cfg, sel, log, jobId } = ctx;
  const responses: ObservedResponse[] = [];

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
    // สัญญาณเตือนล่วงหน้า — Google ตอบไม่ปกติแม้งานยังไม่พัง (spec 2026-09-30 §3)
    if (res.status() === 429 || res.status() === 403 || res.status() >= 500) {
      logActivity({ kind: "http_warn", jobId, round, detail: { status: res.status(), url: res.url().slice(0, 120) } });
    }
  };

  const onBotSignal = (signal: string): void => {
    logActivity({ kind: "bot_signal", jobId, round, detail: { signal } });
  };

  /**
   * ภาพจุดเช็กให้ผู้ใช้ย้อนดูว่าบอททำถูกไหม (ตั้งค่า / แนบรูป / พรอมต์ก่อนกด / ผลลัพธ์) — แยกจากหลักฐานตอนพัง
   * (captureFailure) ซึ่งเก็บเฉพาะงานที่พัง · ถ่ายด้วย CDP ฝั่ง Chrome หน้าเว็บมองไม่เห็น ไม่เพิ่มสัญญาณบอท
   * ห้ามทำให้งานพังเด็ดขาด — ถ่ายไม่ได้ก็ข้าม · attempt เดียวกันรันซ้ำ = เขียนทับ · ลบเองหลัง CHECKPOINT_KEEP_DAYS วัน (worker/index.ts)
   */
  async function checkpoint(n: number, name: string): Promise<void> {
    if (out.checkpointDir === null) return;
    const file = path.join(out.checkpointDir, `${out.prefix}-${String(n)}-${name}.jpg`);
    await page.screenshot({ path: file, type: "jpeg", quality: 55 }).catch(() => {});
  }

  async function step<T>(name: FlowStep, fn: () => Promise<T>): Promise<T> {
    if (ctx.forceFailStep === name) {
      throw new FlowStepError(name, "selector_drift", "บังคับพังด้วย FLOW_FORCE_FAIL_STEP");
    }
    log.log(name, "เริ่ม");
    await assertPageUsable(page, name, sel, cfg, log, jobId, round);
    try {
      const value = await fn();
      log.log(name, "เสร็จ");
      return value;
    } catch (e) {
      if (e instanceof FlowStepError) throw e;
      // timeout = selector_drift ยกเว้นโหลดหน้าไม่ทันที่ open-flow รอบ 1–3 = worker_crash (นโยบายข้ามงานรู้จัก) — กติกาอยู่ stepErrorKind
      const message = e instanceof Error ? e.message : String(e);
      const kind = stepErrorKind(name, round, e);
      throw new FlowStepError(name, kind, kind === "selector_drift" ? `timeout: ${message}` : message);
    }
  }

  async function softStep<T>(name: FlowStep, fn: () => Promise<T>): Promise<SoftStepResult<T>> {
    if (ctx.forceFailStep === name) {
      throw new FlowStepError(name, "selector_drift", "บังคับพังด้วย FLOW_FORCE_FAIL_STEP");
    }
    log.log(name, "เริ่ม");
    try {
      await assertPageUsable(page, name, sel, cfg, log, jobId, round);
      const value = await fn();
      log.log(name, "เสร็จ");
      return { ok: true, value };
    } catch (e) {
      const reason = postRenderFailReason(name, e instanceof Error ? e.message : String(e));
      log.log(name, `${reason} — ไม่ทำให้งานพัง คลิปยังอยู่ใน Flow`);
      return { ok: false, reason };
    }
  }

  async function openProject(projectId: string | null, existingOnly: boolean): Promise<string> {
    await step("open-flow", async () => {
      const url = projectId ? sel.projectUrl(projectId) : cfg.flowUrl;
      const navigate = () => page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      if (isNetworkRetryStep("open-flow", round)) {
        // เน็ตสะดุด (ERR_NETWORK_CHANGED ฯลฯ) ก่อนแตะ Google — รอแล้วลองใหม่ 5 ครั้ง ครบแล้วค่อยพังเหมือนเดิม
        await retryTransientNav(navigate, {
          tries: 5,
          waitMs: 15_000,
          sleep: sleepMs,
          onRetry: (n, e) => log.log("open-flow", `เน็ตสะดุด (${n}/5) — รอ 15 วิแล้วลองใหม่: ${(e instanceof Error ? e.message : String(e)).slice(0, 80)}`),
        });
      } else {
        // รอบ 4 (โหลด 1080p): พฤติกรรมเดิม — goto ครั้งเดียว ไม่ลองซ้ำ
        await navigate();
      }
      await sleepMs(randInt([3000, 6000]));
      await dismissOverlays(page, sel, cfg, log);
    });

    return step("ensure-project", async () => {
      if (page.url().includes(sel.projectUrlFragment)) {
        return extractProjectId(page.url(), sel.projectUrlFragment);
      }
      // Final clip ต้องกลับไปโปรเจกต์เดิมเท่านั้น (คลิปที่ผ่านอยู่ในนั้น) — สร้างใหม่ = โปรเจกต์ว่างที่ไม่มีวันเจอคลิป
      if (existingOnly) {
        throw new FlowStepError("ensure-project", "selector_drift", `เปิดโปรเจกต์เดิม (${projectId ?? "ไม่มี id"}) ไม่ได้ — URL ตอนนี้ ${page.url()}`);
      }
      const btn = await firstVisible(page, "ensure-project", sel.newProject, cfg.selectorTimeoutMs, undefined, { intent: JEV_INTENT.newProject, log });
      await humanClick(page, btn, cfg);
      logActivity({ kind: "new_project", jobId, round });
      await page.waitForURL((u) => u.toString().includes(sel.projectUrlFragment), { timeout: 20_000 });
      await sleepMs(randInt([2000, 4000]));
      await dismissOverlays(page, sel, cfg, log);
      return extractProjectId(page.url(), sel.projectUrlFragment);
    });
  }

  /**
   * เปิดแผงตั้งค่าแบบ idempotent — เปิดอยู่แล้วไม่ต้องกดซ้ำ (กดซ้ำ = ปิด บนโฮสต์ที่ panel เป็น
   * .cdk-overlay-pane ลอย — ดู closeSettingsButton ถ้า panel เป็นแบบฝังถาวรที่กด trigger ซ้ำ
   * ไม่ toggle ปิด) โฮสต์ที่ไม่ได้ประกาศ settingsPanelOpen ยังกด trigger ทุกครั้งเหมือนเดิม
   *
   * แก้ 2026-09-23: หลังเปิด/ยืนยันว่าเปิดอยู่แล้ว ถ้าโฮสต์ประกาศ confirmPolicyNever ให้กดเสมอ
   * (กดซ้ำที่ตัวเลือกที่เลือกอยู่แล้วของ radio button ไม่มีผลข้างเคียง ปลอดภัยที่จะกดทุกครั้ง) —
   * กันแผงเจนที่ต้องกดยืนยันก่อนทุกครั้งซึ่งบอทไม่รู้จักหน้านั้น
   */
  async function openSettings(name: FlowStep): Promise<void> {
    // ต้องปิด Agent mode ก่อนเสมอ — ตัว modeTrigger (.settings-trigger-button) ถูกซ่อนด้วย
    // hidden="" ตอน Agent ON (ปุ่มที่โชว์แทนคือ .agent-action-button คนละตัว) ถ้าไม่ปิดก่อน
    // firstVisible ด้านล่างจะ timeout เจอ element แต่ไม่ visible
    await ensureAgentModeOff();
    if (sel.settingsPanelOpen) {
      const open = await page.locator(sel.settingsPanelOpen).first().isVisible().catch(() => false);
      if (open) {
        await ensureConfirmPolicyNever();
        return;
      }
    }
    const trigger = await firstVisible(page, name, sel.modeTrigger, cfg.selectorTimeoutMs, sel.modeTriggerIntent, { intent: JEV_INTENT.settings, log });
    await humanClick(page, trigger, cfg);
    await sleepMs(randInt([600, 1000]));
    await ensureConfirmPolicyNever();
  }

  /**
   * ปิด Agent mode (แชท AI) ก่อนเริ่มงานเสมอ — ตั้งใจเลี่ยงไม่ใช้โหมดนี้เลย เพราะยืนยันจริงแล้ว
   * ว่าไม่รับประกันว่าฟังค่า default ที่ตั้งไว้ (ตั้ง count=4 ถูกต้อง แต่ Agent generate ได้แค่
   * ~1 ภาพ) เช็ก aria-pressed ก่อนกด — ปลอดภัยที่จะเรียกซ้ำได้ทุกรอบ (ค่านี้ผูกระดับบัญชี/
   * session ไม่ใช่ต่อโปรเจกต์ ยืนยันสด 2026-09-23 ว่าติดข้าม New project ด้วย จึงน่าจะต้องกด
   * แค่ครั้งแรกที่เจอ ON เท่านั้น แต่เช็กทุกรอบไว้เพื่อความปลอดภัย ต้นทุนต่ำมาก)
   */
  async function ensureAgentModeOff(): Promise<void> {
    if (!sel.agentModeChip) return;
    const chip = page.locator(sel.agentModeChip).first();
    const pressed = await chip.getAttribute("aria-pressed").catch(() => null);
    if (pressed === "true") {
      await humanClick(page, chip, cfg);
      await sleepMs(randInt([500, 900]));
    }
  }

  async function ensureConfirmPolicyNever(): Promise<void> {
    if (!sel.confirmPolicyNever) return;
    const never = page.locator(sel.confirmPolicyNever).first();
    if (await never.isVisible().catch(() => false)) {
      await humanClick(page, never, cfg);
      await sleepMs(randInt([200, 400]));
    }
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
      if (sel.closeSettingsButton) {
        // panel ฝังถาวร (ไม่ใช่ .cdk-overlay-pane) — กด trigger ซ้ำไม่รับประกันว่า toggle ปิด
        // ใช้ปุ่มปิดเฉพาะที่ประกาศไว้แทน (เช่นปุ่ม Back)
        const closeBtn = await firstVisible(page, name, sel.closeSettingsButton, cfg.selectorTimeoutMs);
        await humanClick(page, closeBtn, cfg);
      } else {
        const trigger = await firstVisible(page, name, sel.modeTrigger, cfg.selectorTimeoutMs, sel.modeTriggerIntent);
        await humanClick(page, trigger, cfg);
      }
      await pane.waitFor({ state: "hidden", timeout: cfg.selectorTimeoutMs });
    }
    await sleepMs(randInt([400, 800]));
  }

  /**
   * แนบรูปอ้างอิงเข้าช่องพรอมต์ — รอบรูปแนบ 1 รูป · Render แนบ 2 รูป (เลือกรอบ 1 + รอบ 2)
   * อัปทุกไฟล์ใน filechooser เดียว (Flow รับหลายไฟล์พร้อมกันได้ ยืนยันสด 2026-09-30) แต่ไดอะล็อกเลือกเข้าพรอมต์
   * ได้ทีละรูป (ไม่มี multi-select) — รูปที่สองขึ้นไปต้องเปิดเมนูแนบใหม่แล้วคลิกแถวของไฟล์นั้น
   * expectChips: ถ้าระบุ ต้องมีชิปรูปในช่องพรอมต์เท่านี้พอดีหลังแนบครบ (Render) ไม่งั้นพังตรงนี้ ไม่ปล่อยไปเสียเครดิต
   */
  async function attachReferences(paths: string[], expectChips?: { selector: string; count: number }): Promise<void> {
    const add = await firstVisible(page, "attach-reference", sel.addMedia, cfg.selectorTimeoutMs, undefined, { intent: JEV_INTENT.addMedia, log });
    await humanClick(page, add, cfg);
    await sleepMs(randInt([800, 1400]));
    const uploadBtn = await firstVisible(page, "attach-reference", sel.uploadButtonInDialog, cfg.selectorTimeoutMs, undefined, { intent: JEV_INTENT.upload, log });
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
    await chooser.setFiles(paths);
    logActivity({ kind: "upload", jobId, round, detail: { files: paths.length } });
    const up = await uploadResponse;
    if (up.status() >= 400) {
      throw new FlowStepError("attach-reference", "flow_error", `อัปโหลดรูปตอบ HTTP ${up.status()}`);
    }
    await sleepMs(randInt([1000, 2000]));
    const dialog = page.locator(sel.openDialog).last();
    for (const [i, file] of paths.entries()) {
      if (i > 0) {
        // ไดอะล็อกปิดไปแล้วหลังแนบรูปก่อนหน้า — เปิดเมนูแนบใหม่เพื่อเลือกรูปถัดไป (ไฟล์อัปไปพร้อมกันแล้ว)
        const again = await firstVisible(page, "attach-reference", sel.addMedia, cfg.selectorTimeoutMs, undefined, { intent: JEV_INTENT.addMedia, log });
        await humanClick(page, again, cfg);
        await sleepMs(randInt([800, 1400]));
      }
      // เว็บใหม่ไม่เลือกไฟล์ที่เพิ่งอัปให้เอง — ยังคาที่สื่อชิ้นเดิม ถ้ากดยืนยันเลยจะได้ของผิดชิ้น
      // จึงต้องรอให้แถวของไฟล์เรานี้มี thumbnail (= อัปเสร็จ) แล้วกดเลือกก่อน
      if (sel.uploadedAssetItem) {
        const item = page.locator(sel.uploadedAssetItem(path.basename(file))).first();
        await item.waitFor({ state: "visible", timeout: cfg.uploadTimeoutMs });
        await humanClick(page, item, cfg);
        await sleepMs(randInt([800, 1500]));
      }
      // บางหน้าตาของไดอะล็อกแนบรูปให้ทันทีที่กดเลือกแล้วปิดตัวเอง (โปรเจกต์เปล่าบนเว็บใหม่ / รูปที่สองของ Render)
      // บางหน้าตายังเปิดค้างรอปุ่มยืนยัน — เช็กว่ายังเปิดอยู่ไหมก่อน ไม่ใช่บังคับหาปุ่มเสมอ
      if (await dialog.isVisible().catch(() => false)) {
        // ปุ่ม "Add to prompt": ใช้ selector จริงถ้ามี · ไม่มีก็ถอยไปใช้ heuristic
        // "ปุ่มสุดท้ายในไดอะล็อกที่ไม่มีไอคอน" (ข้อความเปลี่ยนตามภาษา จึงไม่จับด้วยข้อความ)
        const confirm = sel.confirmMedia
          ? await firstVisible(page, "attach-reference", sel.confirmMedia, cfg.selectorTimeoutMs, undefined, { intent: JEV_INTENT.confirmMedia, log })
          : dialog.locator("button").filter({ hasNot: page.locator("i, mat-icon") }).last();
        if ((await confirm.count()) > 0 && (await confirm.isVisible().catch(() => false))) {
          await humanClick(page, confirm, cfg);
        }
        await dialog.waitFor({ state: "hidden", timeout: 15_000 });
      }
      await sleepMs(randInt([1000, 2000]));
    }
    if (expectChips) {
      const chips = await page.locator(expectChips.selector).count();
      if (chips !== expectChips.count) {
        // ด่านข้อมูลของงานนั้น (ยังไม่ได้กดสร้าง) — นโยบายจอดงานอ่านข้อความนี้ด้วย isAttachCountMismatch (lib/flow-lifecycle.ts)
        throw new FlowStepError("attach-reference", "selector_drift", attachCountMismatchMessage(chips, expectChips.count));
      }
    }
    await checkpoint(2, "reference");
  }

  function clickGenerate(kind: "generate_image" | "generate_video"): Promise<number> {
    return step("click-generate", async () => {
      const btn = await firstVisible(page, "click-generate", sel.submit, cfg.selectorTimeoutMs);
      const submitAt = Date.now();
      logActivity({ kind, jobId, round });
      await humanClick(page, btn, cfg);
      return submitAt;
    });
  }

  const session: FlowSession = {
    page, cfg, sel, log, out, responses, onBotSignal,
    step, softStep, checkpoint, openProject, openSettings, closeSettings, attachReferences, clickGenerate,
    clipCapture: () => clipCapture({ page, cfg, sel, log, outDir: out.dir, jobId, round, checkpoint }),
  };

  try {
    page.on("response", onResponse);
    return await fn(session);
  } finally {
    page.off("response", onResponse);
  }
}
