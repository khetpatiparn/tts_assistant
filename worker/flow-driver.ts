import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Locator, Page, Response } from "playwright";
import type { WorkerConfig } from "./config";
import { FlowStepError, type ErrorKind } from "./errors";
import { humanClick, humanHover, maybeIdleScroll, prepareHumanClick, randInt, sleepMs, sleepRange, typeHuman } from "./humanize";
import { findByIntent, findByJev } from "./dom-heuristics";
import type { SelectorSet } from "./flow-selectors";
import type { StepLog } from "./failure";
import { hasSignInButton } from "./browser";
import {
  blockKindForStatus, errorKindForTileTexts, flowMediaIdFromSrc, generateAccepted, isMp4Header, pickDirectVideoUrl, pickNewThumbnail, postRenderFailReason,
  renderSettingsLabelOk, submenuArrowDowns,
} from "./flow-signals";

export type RoundInput = {
  /** 1-2 = วาดรูป · 3 = Render คลิป (โหลดตัวอย่าง 720p) · 4 = กลับไปโหลดคลิปที่ผ่านแบบ 1080p */
  round: 1 | 2 | 3 | 4;
  productName: string;
  /**
   * รอบ 1 = รูปแคปจากผู้ใช้ · รอบ 2 = รูป candidate ที่ผู้ใช้เลือกรอบ 1 · รอบ 3 = รูปที่เลือกรอบ 1 + รอบ 2
   * (แนบพร้อมกันใน filechooser เดียว) · รอบ 4 = ไม่ใช้ (ว่าง)
   */
  referencePaths: string[];
  outDir: string;
  /** ชื่อไฟล์ผลลัพธ์ = `${filePrefix}-${index}.png` (รูป) · `${filePrefix}.mp4` (คลิป) */
  filePrefix: string;
  /** รอบ 2-4 ใช้ project เดิมของรอบ 1 · null = สร้างใหม่ (รอบ 4 ต้องมีเสมอ) */
  projectId: string | null;
  /** ข้อความที่ผู้ใช้พิมพ์ต่อท้ายพรอมต์ตายตัว (FlowJob.extraPrompt, ทำความสะอาดแล้ว) · "" = พรอมต์ตั้งต้น */
  extraPrompt: string;
  /** โฟลเดอร์เก็บภาพจุดเช็ก 4 จุดต่อรอบ (ดู checkpoint ใน runRound) · null = ไม่เก็บ (smoke test) */
  checkpointDir: string | null;
  /** รอบ 3: พรอมต์ที่วางทั้งก้อน (10-part prompt + ข้อความเพิ่มเติม — buildRenderPrompt ใน lib/flow-jobs.ts) */
  renderPrompt?: string;
  /** รอบ 4: id ของคลิปที่ผ่าน (FlowJobImage.flowMediaId ที่รอบ 3 เก็บไว้) */
  mediaId?: string;
};

/** mediaId = id ของคลิปใน Flow (รอบ 3-4) ให้ worker เก็บไว้หาช่องเดิมตอนโหลด 1080p */
export type RoundResult = { files: string[]; projectId: string; responseBody: unknown; mediaId?: string;
  /** รอบ 3 เท่านั้น: Flow เรนเดอร์เสร็จแล้วแต่โหลดไฟล์มาไม่ได้ทั้งสองทาง — เหตุผลสั้นๆ · null = ได้ไฟล์ */
  downloadFailed: string | null;
};

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

const ASPECT = "3:4";
const COUNT = 4;
/** Flow ขึ้นช่อง "กำลังวาด" ทันทีที่รับคำสั่ง — เผื่อเน็ตช้า 45 วิก่อนสรุปว่าคลิก Generate ไม่ติด */
const GENERATE_ACCEPT_MS = 45_000;
/** Render: 9:16 ตามสูตรที่ผู้ใช้ทำมือ · ตัวเลือกข้อความล้วนที่ต้องเลือก (ค่าเริ่มต้นของโปรเจกต์ใหม่คือ 8s ต้องกด 10s) */
const RENDER_ASPECT = "9:16";
const RENDER_TEXT_OPTIONS = ["720p", "10s", "x1"] as const;
/** รอบ 4: รอกริดของโปรเจกต์โหลด thumbnail ของคลิปที่ผ่านนานสุดเท่านี้ก่อนสรุปว่าหาไม่เจอ */
const FIND_VIDEO_MS = 30_000;

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

/** พรอมต์ตายตัว 2 แบบ (spec §3) — ต้องเหมือน buildFlowPrompt ใน lib/flow-jobs.ts ทุกตัวอักษร */
export function flowPromptFor(round: 1 | 2, productName: string, extra = ""): string {
  const base =
    round === 1
      ? `ขอภาพสินค้าอย่างเดียวเท่านั้น พื้นหลังขาว สินค้าคือ "${productName}"`
      : `ขอภาพสินค้าตอนใช้งาน สินค้าคือ "${productName}"`;
  return extra === "" ? base : `${base} ${extra}`;
}

function isTimeout(e: unknown): boolean {
  return e instanceof Error && (e.name === "TimeoutError" || /Timeout \d+ms exceeded/.test(e.message));
}

/**
 * ลอง selector ตามลำดับ คืนตัวแรกที่ visible · ไม่เจอเลย = selector_drift
 * `intent` (ถ้ามี) คือ fallback ชั้นสุดท้ายหลัง CSS selector ทุกตัวพังหมด — หาแทนด้วยความหมาย
 * ของปุ่ม (ดูคอมเมนต์ที่ findByIntent) ใส่เฉพาะจุดที่มีหลักฐาน DOM dump จริงรองรับแล้วเท่านั้น
 */
async function firstVisible(
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
async function isChecked(loc: Locator): Promise<boolean> {
  const checked = await loc.getAttribute("aria-checked").catch(() => null);
  const selfSelected = await loc.getAttribute("aria-selected").catch(() => null);
  const classAttr = await loc.getAttribute("class").catch(() => null);
  const classChecked = classAttr?.includes("mat-button-toggle-checked") ?? false;
  return checked === "true" || selfSelected === "true" || classChecked;
}

async function assertSelected(loc: Locator, step: FlowStep, what: string): Promise<void> {
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
 * ทำ 1 รอบ — ทุกขั้นตั้งชื่อไว้ใน FLOW_STEPS · ทุก error ที่หลุดออกไปเป็น FlowStepError
 * รอบ 1-2 วาดรูป 4 รูป (12 ขั้น) · รอบ 3 Render คลิป 1 ตัวแล้วโหลดตัวอย่าง 720p · รอบ 4 กลับไปโปรเจกต์เดิม
 * โหลดคลิปที่ผ่านแบบ 1080p Upscaled (ไม่กดสร้างอะไรเลย ไม่เสียเครดิต) — แยกทางกันหลัง ensure-project
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

  /**
   * ภาพจุดเช็กให้ผู้ใช้ย้อนดูว่าบอททำถูกไหม (ตั้งค่า / แนบรูป / พรอมต์ก่อนกด / ผลลัพธ์) — แยกจากหลักฐานตอนพัง
   * (captureFailure) ซึ่งเก็บเฉพาะงานที่พัง · ถ่ายด้วย CDP ฝั่ง Chrome หน้าเว็บมองไม่เห็น ไม่เพิ่มสัญญาณบอท
   * ห้ามทำให้งานพังเด็ดขาด — ถ่ายไม่ได้ก็ข้าม · ชื่อไฟล์ `${filePrefix}-${n}-${name}.jpg` (attempt เดียวกันรันซ้ำ = เขียนทับ)
   * ลบเองหลัง CHECKPOINT_KEEP_DAYS วัน (worker/index.ts)
   */
  async function checkpoint(n: number, name: string): Promise<void> {
    if (input.checkpointDir === null) return;
    const file = path.join(input.checkpointDir, `${input.filePrefix}-${String(n)}-${name}.jpg`);
    await page.screenshot({ path: file, type: "jpeg", quality: 55 }).catch(() => {});
  }

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

  /**
   * ขั้นหลัง Render สำเร็จ: ห้ามทำให้งาน failed/pause (เครดิตจ่ายแล้ว) — assertPageUsable และตัวขั้นเองถูกจับไว้หมด
   * แล้วคืน {ok:false} ให้ผู้เรียกข้ามการโหลด (ไม่ hover/คลิกหน้าที่โดนธง) · ขั้น pre-render ของงานถัดไปยัง fail-fast
   * เรื่อง captcha ผ่าน assertPageUsable ตามเดิม · FLOW_FORCE_FAIL_STEP ยัง throw ได้ (hook ทดสอบเท่านั้น)
   */
  async function softStep<T>(name: FlowStep, fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; reason: string }> {
    if (opts.forceFailStep === name) {
      throw new FlowStepError(name, "selector_drift", "บังคับพังด้วย FLOW_FORCE_FAIL_STEP");
    }
    log.log(name, "เริ่ม");
    try {
      await assertPageUsable(page, name, sel, cfg, log);
      const value = await fn();
      log.log(name, "เสร็จ");
      return { ok: true, value };
    } catch (e) {
      const reason = postRenderFailReason(name, e instanceof Error ? e.message : String(e));
      log.log(name, `${reason} — ไม่ทำให้งานพัง คลิปยังอยู่ใน Flow`);
      return { ok: false, reason };
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
      // รอบ 4 ต้องกลับไปโปรเจกต์เดิมเท่านั้น (คลิปที่ผ่านอยู่ในนั้น) — สร้างใหม่ = โปรเจกต์ว่างที่ไม่มีวันเจอคลิป
      if (input.round === 4) {
        throw new FlowStepError("ensure-project", "selector_drift", `เปิดโปรเจกต์เดิม (${input.projectId ?? "ไม่มี id"}) ไม่ได้ — URL ตอนนี้ ${page.url()}`);
      }
      const btn = await firstVisible(page, "ensure-project", sel.newProject, cfg.selectorTimeoutMs, undefined, { intent: JEV_INTENT.newProject, log });
      await humanClick(page, btn, cfg);
      await page.waitForURL((u) => u.toString().includes(sel.projectUrlFragment), { timeout: 20_000 });
      await sleepMs(randInt([2000, 4000]));
      await dismissOverlays(page, sel, cfg, log);
      return extractProjectId(page.url(), sel.projectUrlFragment);
    });

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

    // รอบ 3-4 แยกทางตรงนี้ — ใช้ step/checkpoint/openSettings/closeSettings/attachReferences ร่วมกับรอบรูป
    // (ฟังก์ชันประกาศไว้ถัดลงไปใน block เดียวกัน) · ต่อจากนี้คือรอบรูปเดิม ไม่เปลี่ยนพฤติกรรม
    if (input.round === 4) return await upscaleRound();
    if (input.round === 3) return await renderRound();

    await step("switch-image-mode", async () => {
      await openSettings("switch-image-mode");
      // แก้ 2026-09-23: โฮสต์ที่ไม่ประกาศ imageTab (migrated ตั้งแต่รอบนี้) ไม่มีปุ่มสลับโหมด
      // Image/Video แยกให้กดอีกแล้ว — แผงใหม่โชว์ทั้งสอง section พร้อมกัน ข้ามการคลิก+ยืนยันไปเลย
      if (sel.imageTab) {
        const tab = await firstVisible(page, "switch-image-mode", sel.imageTab, cfg.selectorTimeoutMs);
        if (!(await isChecked(tab))) {
          await humanClick(page, tab, cfg);
          await sleepMs(randInt([900, 1500]));
        }
        // อ่านกลับก่อนปิดแผง — โหมดผิดแปลว่าได้วิดีโอแทนรูปทั้งรอบ (เช็คเสมอไม่ว่าจะข้ามคลิกไปหรือไม่)
        await assertSelected(tab, "switch-image-mode", "โหมดรูป");
      }
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
      // ปุ่มนี้โชว์ label ของโมเดลที่เลือกอยู่ในตัวเอง (เช่น "🍌 Nano Banana 2 ...") — เช็คข้อความ
      // ก่อนเปิดเมนูเลย ถ้าถูกอยู่แล้วข้ามการเปิดเมนู+คลิก+ปิดทั้งชุด (ประหยัดสุดในบรรดา 4 ขั้นนี้)
      const currentLabel = (await modelBtn.innerText().catch(() => "")).trim();
      if (/Nano Banana 2(?!\s*(Lite|Pro))/.test(currentLabel)) return;
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
      if (!(await isChecked(tab))) {
        await humanClick(page, tab, cfg);
        await sleepMs(randInt([400, 800]));
      }
      await assertSelected(tab, "set-aspect-3-4", ASPECT);
    });

    await step("set-count-4", async () => {
      const tabs = page.locator(sel.countTabs).filter({ hasText: sel.countTabPattern });
      const target = tabs.nth(COUNT - 1);
      await target.waitFor({ state: "visible", timeout: cfg.selectorTimeoutMs });
      if (!(await isChecked(target))) {
        await humanClick(page, target, cfg);
        await sleepMs(randInt([400, 800]));
      }
      await assertSelected(target, "set-count-4", "x4");
      // ถ่ายก่อนปิดแผง — ภาพต้องเห็นโมเดล/สัดส่วน/จำนวนที่เลือกไว้
      await checkpoint(1, "settings");
      await closeSettings("set-count-4");
    });

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
          throw new FlowStepError(
            "attach-reference",
            "selector_drift",
            `ช่องพรอมต์มีรูปแนบ ${String(chips)} รูป (ต้อง ${String(expectChips.count)}) — ไม่กดสร้างเพื่อไม่เสียเครดิตกับคลิปผิดรูป`,
          );
        }
      }
      await checkpoint(2, "reference");
    }

    /** selector ของ Render — โฮสต์ที่ไม่ประกาศ (labs) Render ไม่ได้ */
    function videoSel(name: FlowStep): NonNullable<SelectorSet["video"]> {
      if (!sel.video) throw new FlowStepError(name, "host_unsupported", `โฮสต์ชุด ${sel.name} ยังไม่รองรับการทำคลิป`);
      return sel.video;
    }

    /** id ของทุกช่องวิดีโอในกริดตามลำดับ DOM ("" = ช่องที่ยังไม่มี thumbnail เช่นกำลังทำ) */
    async function videoTileIds(name: FlowStep): Promise<string[]> {
      const v = videoSel(name);
      const srcs = await page
        .locator(v.tileContainer)
        .evaluateAll((els, thumb) => els.map((el) => el.querySelector(thumb)?.getAttribute("src") ?? ""), v.tileThumbnail);
      return srcs.map(flowMediaIdFromSrc);
    }

    /**
     * ทางแรกของการโหลดคลิป: hover ช่อง → อ่าน <video src> ที่ Flow ใส่ให้ → ดึงไฟล์ตรงด้วย page.request (แนบ cookie ของบอท
     * ให้เองเผื่อวันหน้า Google บังคับ) · ไม่แตะเมนู ⋯ เลย — เมนูซ้อน 3 ชั้นคือขั้นที่พังบ่อยที่สุด (2 ใน 2 รอบจริง)
     * คืน null เมื่อ (ก) ไม่มี <video src> ที่ใช้ได้ใน 10 วิ (ข) HTTP ไม่ใช่ 2xx เช่น ลายเซ็นหมดอายุ (ค) ไฟล์ไม่ใช่ MP4 —
     * ผู้เรียกถอยไปเมนู · ไม่ throw เพราะยังมีทางถอย
     */
    async function downloadVideoDirect(name: FlowStep, mediaId: string, filename: string): Promise<string | null> {
      const v = videoSel(name);
      const idx = (await videoTileIds(name)).indexOf(mediaId);
      if (idx < 0) return null;
      const container = page.locator(v.tileContainer).nth(idx);
      await container.scrollIntoViewIfNeeded({ timeout: cfg.selectorTimeoutMs });
      await humanHover(page, container.locator(v.tile).first(), cfg);
      let url: string | null = null;
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const srcs = await container.locator(v.tileVideo).evaluateAll((els) =>
          els.map((e) => (e as HTMLVideoElement).currentSrc || e.getAttribute("src"))
        );
        url = pickDirectVideoUrl(srcs);
        if (url !== null) break;
        await sleepMs(500);
      }
      if (url === null) {
        log.log(name, "ไม่เจอ <video src> ลิงก์ตรงใน 10 วิ — ถอยไปใช้เมนู");
        return null;
      }
      const res = await page.request.get(url, { maxRedirects: 3, timeout: cfg.renderDownloadTimeoutMs }).catch(() => null);
      if (res === null || !res.ok()) {
        log.log(name, `ลิงก์ตรงตอบ ${res === null ? "network error" : `HTTP ${String(res.status())}`} — ถอยไปใช้เมนู`);
        return null;
      }
      const buf = await res.body();
      if (!isMp4Header(buf)) {
        log.log(name, `ลิงก์ตรงให้ไฟล์ที่ไม่ใช่ MP4 (${String(buf.length)} bytes) — ถอยไปใช้เมนู`);
        return null;
      }
      const file = path.join(input.outDir, filename);
      writeFileSync(file, buf);
      log.log(name, `ได้ไฟล์ ${filename} ${String(Math.round(buf.length / 1024))} KB (ลิงก์ตรง)`);
      return file;
    }

    /**
     * โหลดคลิปของช่องที่มี id นี้ด้วยเมนู More options → Download → ขนาดที่ต้องการ — ปุ่มโผล่เฉพาะตอนเอาเมาส์
     * วางบน <flow-video-tile> จริง (ยืนยันสด 2026-09-30) · Flow ยิงเป็น blob download จึงจับด้วย event "download"
     * แล้ว saveAs · ตรวจหัวไฟล์ว่าเป็น MP4 จริงก่อนคืน
     */
    async function downloadVideo(name: FlowStep, mediaId: string, quality: RegExp[], filename: string): Promise<string> {
      const v = videoSel(name);
      const idx = (await videoTileIds(name)).indexOf(mediaId);
      if (idx < 0) throw new FlowStepError(name, "selector_drift", `หาช่องของคลิป ${mediaId} ในกริดไม่เจอ`);
      const container = page.locator(v.tileContainer).nth(idx);
      await container.scrollIntoViewIfNeeded({ timeout: cfg.selectorTimeoutMs });
      await humanHover(page, container.locator(v.tile).first(), cfg);
      await sleepMs(randInt([500, 900]));
      const more = container.locator(v.moreOptions).first();
      await more.waitFor({ state: "visible", timeout: cfg.selectorTimeoutMs });
      await humanClick(page, more, cfg);
      await sleepMs(randInt([500, 900]));
      const dl = page.locator(v.downloadMenuItem).first();
      await dl.waitFor({ state: "visible", timeout: cfg.selectorTimeoutMs });
      await humanHover(page, dl, cfg);
      await sleepMs(randInt([600, 1000]));
      // ภาพเมนูที่เปิดอยู่ก่อนกด — ย้อนดูได้ว่าเปิดเมนูของช่องไหน และเมนูย่อยโผล่จริงไหม
      await checkpoint(5, "menu");
      // เมนูย่อยด้วยคีย์บอร์ด (Angular Material รองรับ ArrowDown/ArrowRight/Enter มาตรฐาน) — เมาส์เดินเส้นโค้งผ่านรายการอื่น
      // ทำให้เมนูย่อยปิด (เจอจริง 2026-09-30) · โฟกัสอยู่ที่ "Download" แล้วหลัง hover → ArrowRight เปิดเมนูย่อย →
      // ArrowDown ไปทีละรายการจนถึงตัวเลือกที่ต้องการ → Enter
      await dl.focus();
      await page.keyboard.press("ArrowRight");
      await sleepMs(randInt([300, 600]));
      const items = page.locator(v.menuItem);
      // ข้อความรวม [disabled] ด้วย เพื่อให้ submenuArrowDowns ปฏิเสธรายการที่กดไม่ได้ (เช่น 4K)
      const texts = await items.evaluateAll((els) =>
        els.map((e) => (e.textContent ?? "").replace(/\s+/g, " ").trim() + (e.getAttribute("aria-disabled") === "true" || (e as HTMLButtonElement).disabled ? " [disabled]" : ""))
      );
      const downs = submenuArrowDowns(texts, quality);
      if (downs === null) {
        throw new FlowStepError(name, "selector_drift", `ไม่เจอเมนูโหลด ${quality.map(String).join(" + ")} — เมนูมี: ${texts.join(" / ")}`);
      }
      const downloadEvent = page.waitForEvent("download", { timeout: cfg.renderDownloadTimeoutMs });
      // กัน unhandled rejection ถ้าขั้นอื่นพังก่อน (บั๊กคลาสเดียวกับ uploadResponse ด้านบน)
      downloadEvent.catch(() => {});
      for (let i = 0; i < downs; i++) {
        await page.keyboard.press("ArrowDown");
        await sleepMs(randInt([120, 250]));
      }
      await page.keyboard.press("Enter");
      // คลิกติด = เมนูปิดเอง · ถ้าตัวเลือกยังค้างอยู่แปลว่าคลิกไม่ติด → บอกทันที ไม่นั่งรอ 10 นาทีเปล่าๆ
      await sleepMs(3000);
      if ((await page.locator(v.menuItem).count()) > 0) {
        throw new FlowStepError(name, "selector_drift", "กด Enter แล้วเมนูไม่ปิด (ไม่ติด) — ยังไม่ได้เริ่มโหลด");
      }
      const download = await downloadEvent.catch((e: unknown) => {
        if (isTimeout(e)) {
          throw new FlowStepError(name, "download_failed", `กดโหลดแล้วไม่ได้ไฟล์ภายใน ${String(cfg.renderDownloadTimeoutMs / 1000)} วิ`);
        }
        throw e;
      });
      const failure = await download.failure();
      if (failure !== null) throw new FlowStepError(name, "download_failed", `โหลดคลิปไม่สำเร็จ: ${failure}`);
      const file = path.join(input.outDir, filename);
      await download.saveAs(file);
      const buf = readFileSync(file);
      if (!isMp4Header(buf)) {
        throw new FlowStepError(name, "download_failed", `ไฟล์ที่ได้ไม่ใช่ MP4 (${String(buf.length)} bytes)`);
      }
      log.log(name, `ได้ไฟล์ ${filename} ${String(Math.round(buf.length / 1024))} KB`);
      return file;
    }

    /**
     * รอบ 3: Render คลิป 1 ตัวด้วยสูตรที่ผู้ใช้ทำมือ (Video · Ingredients · 9:16 · Omni 1.1 Flash · 720p · 10s · x1
     * = 15 เครดิต) แนบรูปที่เลือก 2 รอบ วาง 10-part prompt แล้วโหลดตัวอย่าง 720p Original size กลับมาให้ดูก่อน
     * (ไฟล์ 1080p ขยายตอนโหลดซึ่งรอนาน — ทำเฉพาะคลิปที่ผู้ใช้กดผ่านแล้ว ในรอบ 4)
     */
    async function renderRound(): Promise<RoundResult> {
      const prompt = input.renderPrompt ?? "";
      if (prompt.trim() === "") throw new FlowStepError("paste-prompt", "worker_crash", "ไม่มี 10-part prompt ให้วาง");

      await step("switch-video-mode", async () => {
        const v = videoSel("switch-video-mode");
        await openSettings("switch-video-mode");
        const tab = page.locator(v.modeTab).first();
        await tab.waitFor({ state: "visible", timeout: cfg.selectorTimeoutMs });
        if (!(await isChecked(tab))) {
          await humanClick(page, tab, cfg);
          await sleepMs(randInt([900, 1500]));
        }
        // โหมดผิด = ได้รูป 4 รูปแทนคลิป — อ่านกลับเสมอ
        await assertSelected(tab, "switch-video-mode", "โหมดวิดีโอ");
      });

      await step("set-video-settings", async () => {
        const v = videoSel("set-video-settings");
        const pick = async (loc: Locator, what: string) => {
          await loc.waitFor({ state: "visible", timeout: cfg.selectorTimeoutMs });
          if (!(await isChecked(loc))) {
            await humanClick(page, loc, cfg);
            await sleepMs(randInt([400, 800]));
          }
          await assertSelected(loc, "set-video-settings", what);
        };
        await pick(page.locator(v.ingredientTab).first(), "Ingredient");
        await pick(page.locator(sel.aspectTab(RENDER_ASPECT)).first(), RENDER_ASPECT);
        // โมเดลไม่เปลี่ยนให้เอง — ถ้าไม่ใช่ตัวที่ผู้ใช้ยืนยันแล้วว่าได้ผล (และราคา 15 เครดิต) ให้หยุดให้คนดู
        // อ่านทุกปุ่มเมนูในแผง (ไม่ผูกว่าต้องมีไอคอน arrow_drop_down แบบปุ่มโมเดลรูป — สเปกยืนยันแค่ class + ข้อความ)
        const modelTexts = (await page.locator(v.modelTrigger).allInnerTexts().catch(() => [] as string[])).map((t) => t.trim());
        if (!modelTexts.some((t) => v.modelLabel.test(t))) {
          throw new FlowStepError(
            "set-video-settings",
            "selector_drift",
            `โมเดลวิดีโอไม่ใช่ Omni 1.1 Flash (ปุ่มโมเดลเขียนว่า: ${modelTexts.map((t) => `"${t}"`).join(" / ") || "ไม่เจอปุ่ม"})`,
          );
        }
        for (const label of RENDER_TEXT_OPTIONS) {
          // ข้อความทั้งปุ่มต้องจบด้วย label พอดี (กัน "10s" ไปโดน "x10" หรือ "4s" ไปโดน "14s")
          const toggle = page.locator(v.optionToggles).filter({ hasText: new RegExp(`(^|\\s)${label}\\s*$`) }).first();
          await pick(toggle, label);
        }
        // ถ่ายก่อนปิดแผง — ภาพต้องเห็นโหมด/อัตราส่วน/โมเดล/ความละเอียด/ความยาว/จำนวนที่เลือกไว้
        await checkpoint(1, "settings");
        await closeSettings("set-video-settings");
        // ยืนยันทั้งชุดจากป้ายบนปุ่มตั้งค่าอีกชั้น (เห็นจริง: "Video · 720p · 10s" + crop_9_16 + x1)
        const trigger = await firstVisible(page, "set-video-settings", sel.modeTrigger, cfg.selectorTimeoutMs, sel.modeTriggerIntent);
        const triggerText = (await trigger.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
        if (!renderSettingsLabelOk(triggerText)) {
          throw new FlowStepError("set-video-settings", "selector_drift", `ป้ายตั้งค่าไม่ตรงสูตร: "${triggerText}"`);
        }
      });

      const chipSelector = videoSel("attach-reference").ingredientChip;
      await step("attach-reference", () =>
        attachReferences(input.referencePaths, { selector: chipSelector, count: input.referencePaths.length })
      );

      await step("paste-prompt", async () => {
        const box = await firstVisible(page, "paste-prompt", sel.promptBox, cfg.selectorTimeoutMs);
        await humanClick(page, box, cfg);
        await page.keyboard.press("Control+A");
        await page.keyboard.press("Delete");
        await sleepMs(randInt([300, 700]));
        // วางทั้งก้อนด้วย insertText ครั้งเดียว — พรอมต์ ~3,000 ตัวพิมพ์ทีละตัวใช้หลายนาที และมีขึ้นบรรทัด ~58 ครั้ง
        // ถ้ากด Enter จะเท่ากับกดส่ง · insertText ใส่ขึ้นบรรทัดเป็นย่อหน้าโดยไม่ส่ง (ยืนยันสด 2026-09-30)
        await page.keyboard.insertText(prompt);
        await sleepMs(randInt([800, 1500]));
        // Ctrl+A/Delete ต้องไม่ลบรูปที่แนบไว้ — เช็กซ้ำก่อนเสียเครดิต
        const chips = await page.locator(chipSelector).count();
        if (chips !== input.referencePaths.length) {
          throw new FlowStepError("paste-prompt", "selector_drift", `หลังวางพรอมต์เหลือรูปแนบ ${String(chips)} รูป (ต้อง ${String(input.referencePaths.length)})`);
        }
        await checkpoint(3, "prompt");
      });

      const beforeErrorTiles = sel.errorTile ? await page.locator(sel.errorTile).count() : 0;
      const beforeTiles = sel.resultTile ? await page.locator(sel.resultTile).count() : 0;
      const beforeVideoIds = await videoTileIds("click-generate");

      await step("click-generate", async () => {
        const btn = await firstVisible(page, "click-generate", sel.submit, cfg.selectorTimeoutMs);
        submitAt = Date.now();
        await humanClick(page, btn, cfg);
      });

      const mediaId = await step("wait-render", async () => {
        const deadline = Date.now() + cfg.renderTimeoutMs;
        const acceptBy = submitAt + GENERATE_ACCEPT_MS;
        let accepted = !sel.resultTile;
        while (Date.now() < deadline) {
          for (const c of sel.captchaSignals) {
            if ((await page.locator(c).count()) > 0) {
              throw new FlowStepError("wait-render", "captcha", `เจอสัญญาณ captcha ระหว่างรอคลิป: ${c}`);
            }
          }
          for (const r of responses.filter((x) => x.at >= submitAt)) {
            const kind = blockKindForStatus(r.status);
            if (kind !== null) throw new FlowStepError("wait-render", kind, `Flow ตอบ HTTP ${r.status} หลังกดสร้างคลิป`);
          }
          // การ์ดพังของวิดีโอ — สันนิษฐานว่าเป็น <flow-error-tile> เหมือนรูป (ยังไม่เคยเห็นวิดีโอพังจริง ดู spec)
          let freshFailed = 0;
          if (sel.errorTile) {
            const tiles = page.locator(sel.errorTile);
            freshFailed = (await tiles.count()) - beforeErrorTiles;
            if (freshFailed > 0) {
              const kind = errorKindForTileTexts(await tiles.allInnerTexts());
              if (kind === "captcha") {
                throw new FlowStepError("wait-render", "captcha", "Flow แจ้ง unusual activity (โดนจับว่าเป็นบอท) — พักก่อน");
              }
              throw new FlowStepError("wait-render", "flow_error", "Flow ทำคลิปไม่สำเร็จ (การ์ด error ในกริด)");
            }
          }
          const pendingNow = sel.pendingTile ? await page.locator(sel.pendingTile).count() : 0;
          const fresh = pickNewThumbnail(beforeVideoIds, await videoTileIds("wait-render"));
          if (!accepted && sel.resultTile) {
            accepted = generateAccepted({
              tilesBefore: beforeTiles,
              tilesNow: await page.locator(sel.resultTile).count(),
              pendingNow,
              freshErrorTiles: freshFailed,
              goodCount: fresh === null ? 0 : 1,
            });
            if (!accepted && Date.now() > acceptBy) {
              throw new FlowStepError(
                "wait-render",
                "selector_drift",
                `กดสร้างคลิปแล้วแต่ Flow ไม่เริ่มทำภายใน ${String(GENERATE_ACCEPT_MS / 1000)} วิ (คลิกไม่ติด หรือปุ่มเปลี่ยน)`,
              );
            }
          }
          // เสร็จ = มีช่องวิดีโอใหม่ที่มี thumbnail แล้ว และไม่เหลือช่องที่กำลังทำ (ช่องที่เสร็จมีแค่ thumbnail ไม่มี <video>)
          if (fresh !== null && pendingNow === 0) {
            await sleepMs(2500);
            return fresh;
          }
          const alert = page.locator("[role='alert'], [aria-live='assertive']");
          if ((await alert.count()) > 0) {
            const text = (await alert.allInnerTexts()).join(" ").trim();
            if (/policy|can't create|violat|not able to generate|error/i.test(text)) {
              throw new FlowStepError("wait-render", "flow_error", `Flow แจ้ง: ${text.slice(0, 200)}`);
            }
          }
          await sleepMs(2000);
        }
        throw new FlowStepError("wait-render", "generation_timeout", `รอคลิปเกิน ${String(cfg.renderTimeoutMs)} ms`);
      });

      const dwell = await softStep("dwell", async () => {
        await sleepRange(cfg.dwellAfterResultsMs);
        await checkpoint(4, "results");
        await maybeIdleScroll(page, cfg);
      });
      if (!dwell.ok) {
        return { files: [], projectId: projectId as string, responseBody: null, mediaId, downloadFailed: dwell.reason };
      }

      // หลังจากนี้ห้ามทำให้งาน failed — เครดิตจ่ายแล้ว คลิปมีจริงในโปรเจกต์ (spec 2026-09-30 §2 "หลักการรวม")
      // ลำดับ: ลิงก์ตรง → เมนู (โค้ดเดิม) → ยอมแพ้แบบไม่พัง ให้ผู้ใช้ไปโหลดเองใน Flow
      const previewStep = await softStep("download-preview", async () => {
        try {
          const direct = await downloadVideoDirect("download-preview", mediaId, `${input.filePrefix}.mp4`);
          if (direct !== null) return { file: direct, failed: null as string | null };
        } catch (e) {
          log.log("download-preview", `ลิงก์ตรงพัง (${e instanceof Error ? e.message : String(e)}) — ถอยไปใช้เมนู`);
        }
        try {
          const viaMenu = await downloadVideo("download-preview", mediaId, videoSel("download-preview").previewQuality, `${input.filePrefix}.mp4`);
          return { file: viaMenu as string | null, failed: null as string | null };
        } catch (e) {
          const reason = e instanceof Error ? e.message : String(e);
          log.log("download-preview", `โหลดไม่ได้ทั้งลิงก์ตรงและเมนู — คลิปยังอยู่ใน Flow ให้ผู้ใช้โหลดเอง: ${reason}`);
          return { file: null as string | null, failed: reason };
        }
      });
      if (!previewStep.ok) {
        return { files: [], projectId: projectId as string, responseBody: null, mediaId, downloadFailed: previewStep.reason };
      }
      const preview = previewStep.value;
      return {
        files: preview.file === null ? [] : [preview.file],
        projectId: projectId as string,
        responseBody: null,
        mediaId,
        downloadFailed: preview.failed,
      };
    }

    /**
     * รอบ 4: ผู้ใช้กด "ผ่าน" คลิปตัวอย่างแล้ว — กลับไปโปรเจกต์เดิม หาช่องของคลิปนั้นด้วย id ที่รอบ 3 เก็บไว้
     * แล้วโหลดแบบ 1080p Upscaled (Flow ขยายให้ตอนโหลด ไม่เสียเครดิต แต่รอนาน) · ไม่กดสร้างอะไรเลย
     */
    async function upscaleRound(): Promise<RoundResult> {
      const mediaId = input.mediaId ?? "";
      if (mediaId === "") throw new FlowStepError("find-video", "worker_crash", "ไม่รู้ว่าคลิปที่ผ่านคือช่องไหนใน Flow (ไม่มี media id)");
      await step("find-video", async () => {
        // กริดของโปรเจกต์โหลด thumbnail ทีหลังหน้าเว็บ — รอให้ช่องของคลิปนี้โผล่ก่อนสรุปว่าไม่เจอ
        const deadline = Date.now() + FIND_VIDEO_MS;
        let ids: string[] = [];
        while (Date.now() < deadline) {
          ids = await videoTileIds("find-video");
          if (ids.includes(mediaId)) return;
          await sleepMs(1500);
        }
        throw new FlowStepError(
          "find-video",
          "selector_drift",
          `ไม่เจอคลิปที่ผ่าน (${mediaId}) ในโปรเจกต์ — มีช่องวิดีโอ ${String(ids.length)} ช่อง: ${ids.join(", ") || "ไม่มี"}`,
        );
      });
      // 1080p ล้ม = ไม่พัง: ผู้ใช้มี 720p อยู่แล้ว งานจบด้วยหมายเหตุ (spec 2026-09-30 §2)
      const final = await step("download-final", async () => {
        try {
          return { file: await downloadVideo("download-final", mediaId, videoSel("download-final").finalQuality, `${input.filePrefix}.mp4`), failed: null as string | null };
        } catch (e) {
          const reason = e instanceof Error ? e.message : String(e);
          log.log("download-final", `โหลด 1080p ไม่ได้ — ใช้ 720p ที่มีอยู่แล้ว: ${reason}`);
          return { file: null as string | null, failed: reason };
        }
      });
      return { files: final.file === null ? [] : [final.file], projectId: projectId as string, responseBody: null, mediaId, downloadFailed: final.failed };
    }

    await step("attach-reference", () => attachReferences(input.referencePaths));

    await step("type-prompt", async () => {
      const box = await firstVisible(page, "type-prompt", sel.promptBox, cfg.selectorTimeoutMs);
      await humanClick(page, box, cfg);
      await page.keyboard.press("Control+A");
      await page.keyboard.press("Delete");
      await sleepMs(randInt([300, 700]));
      await typeHuman(page, flowPromptFor(input.round === 2 ? 2 : 1, input.productName, input.extraPrompt), cfg.typeCharDelayMs);
      await sleepMs(randInt([500, 1200]));
      // ภาพนี้เห็นทั้งรูปที่แนบและพรอมต์ที่พิมพ์ครบแล้ว (รวมข้อความเพิ่มเติม) ก่อนกด Generate
      await checkpoint(3, "prompt");
    });

    const beforeImgs = await page.locator("img").evaluateAll((els) => els.map((e) => (e as HTMLImageElement).src));
    // ต้องนับ "ก่อนกด" เพราะ ensure-project ใช้โปรเจกต์เดิมซ้ำได้ (รอบ retry) — การ์ด Failed เก่า
    // จากความพยายามก่อนหน้ายังค้างอยู่ในหน้า ถ้าไม่หักออกจะเข้าใจผิดว่ารอบนี้พังทันทีตั้งแต่ยังไม่ทันวาด
    const beforeErrorTiles = sel.errorTile ? await page.locator(sel.errorTile).count() : 0;
    const beforeTiles = sel.resultTile ? await page.locator(sel.resultTile).count() : 0;

    await step("click-generate", async () => {
      const btn = await firstVisible(page, "click-generate", sel.submit, cfg.selectorTimeoutMs);
      submitAt = Date.now();
      await humanClick(page, btn, cfg);
    });

    const urls = await step("wait-results", async () => {
      const deadline = Date.now() + cfg.generationTimeoutMs;
      // ยืนยันภายในเวลานี้ว่า Flow รับคำสั่งแล้ว — ไม่งั้นแปลว่าคลิก Generate ไม่ติด (ห้ามกดซ้ำเอง: AI4Next
      // พบว่ากดซ้ำได้งานเจนซ้อน 2 ชุด) · ไม่มี resultTile = โฮสต์ที่ยังไม่ยืนยัน DOM ข้ามการเช็กนี้
      const acceptBy = submitAt + GENERATE_ACCEPT_MS;
      let accepted = !sel.resultTile;
      while (Date.now() < deadline) {
        let goodCount = 0;
        // สัญญาณบอทก่อนอย่างอื่น — ถ้าหน้าเปลี่ยนเป็นหน้าบล็อกระหว่างรอ เดิมเช็กแค่ก่อนเริ่มแต่ละขั้น
        for (const c of sel.captchaSignals) {
          if ((await page.locator(c).count()) > 0) {
            throw new FlowStepError("wait-results", "captcha", `เจอสัญญาณ captcha ระหว่างรอผล: ${c}`);
          }
        }
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
          goodCount = found.length;
          if (found.length >= COUNT) {
            await sleepMs(2500); // เผื่อ response ที่มาช้า (straggler)
            return collectImageUrls(responses.filter((r) => r.at >= submitAt).map((r) => r.body), sel.results.imageUrlHosts);
          }
        } else {
          // เดิมโฮสต์นี้ไม่เช็ก HTTP status เลย (เช็กแต่ฝั่ง network strategy) — โดน 403/429 แล้วบอทไม่รู้ตัว
          for (const r of responses.filter((x) => x.at >= submitAt)) {
            const kind = blockKindForStatus(r.status);
            if (kind !== null) {
              throw new FlowStepError("wait-results", kind, `Flow ตอบ HTTP ${r.status} หลังกด Generate`);
            }
          }
          const now = await page.locator("img").evaluateAll((els) => els.map((e) => (e as HTMLImageElement).src));
          const fresh = now.filter((s) => !beforeImgs.includes(s));
          const good = collectImageUrls(fresh, sel.results.imageUrlHosts);
          goodCount = good.length;
          if (good.length >= COUNT) {
            await sleepMs(2500);
            return good;
          }
        }
        // การ์ด "Failed — Sorry, this image failed to generate" ของ Flow เอง (ไม่เสียเครดิต) —
        // ไม่มี role=alert จึงไม่ถูกจับด้วยเช็ก alert ด้านล่าง ถ้าทุกช่องที่ขอ (COUNT) จบแล้วแต่ไม่ครบ
        // เป็นรูปดี ต้องหยุดทันที ไม่ใช่นั่งรอจน generationTimeoutMs แล้วรายงานผิดว่า "ช้า"
        let freshFailed = 0;
        if (sel.errorTile) {
          const tiles = page.locator(sel.errorTile);
          freshFailed = (await tiles.count()) - beforeErrorTiles;
          if (freshFailed > 0) {
            // อ่านข้อความของการ์ด error เท่านั้น (ไม่ใช่ทั้งหน้า — พรอมต์เราอยู่ในหน้าด้วย) — element เดียวกัน
            // ใช้ทั้งตอน "วาดไม่สำเร็จ" และตอนโดนบล็อก ต้องแยกให้ออก ห้ามรอให้ครบทุกช่องถ้าเป็นการบล็อก
            const kind = errorKindForTileTexts(await tiles.allInnerTexts());
            if (kind === "captcha") {
              throw new FlowStepError("wait-results", "captcha", "Flow แจ้ง unusual activity (โดนจับว่าเป็นบอท) — พักก่อน");
            }
            if (freshFailed + goodCount >= COUNT) {
              throw new FlowStepError(
                "wait-results",
                "flow_error",
                `Flow วาดไม่สำเร็จ ${String(freshFailed)}/${String(COUNT)} รูป (failed to generate — ไม่เสียเครดิต)`,
              );
            }
          }
        }
        if (!accepted && sel.resultTile) {
          accepted = generateAccepted({
            tilesBefore: beforeTiles,
            tilesNow: await page.locator(sel.resultTile).count(),
            pendingNow: sel.pendingTile ? await page.locator(sel.pendingTile).count() : 0,
            freshErrorTiles: freshFailed,
            goodCount,
          });
          if (!accepted && Date.now() > acceptBy) {
            throw new FlowStepError(
              "wait-results",
              "selector_drift",
              `กด Generate แล้วแต่ Flow ไม่เริ่มวาดภายใน ${String(GENERATE_ACCEPT_MS / 1000)} วิ (คลิกไม่ติด หรือปุ่มเปลี่ยน)`,
            );
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
      // หลังรอ dwell รูปโหลดครบแล้ว และก่อนเลื่อนจอเล่น (เลื่อนแล้วผลลัพธ์อาจหลุดจากเฟรม)
      await checkpoint(4, "results");
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

    return { files, projectId: projectId as string, responseBody: responses.filter((r) => r.at >= submitAt).map((r) => r.body), downloadFailed: null };
  } finally {
    page.off("response", onResponse);
  }
}
