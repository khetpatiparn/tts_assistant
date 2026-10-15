/**
 * เฝ้าหน้า Flow หลังกด Generate — ที่เดียวของลูปรอผลทั้งรอบรูป (`wait-results`) และรอบ Render (`wait-render`)
 * เดิมเป็นสำเนา 2 ชุดใน flow-driver.ts ที่เริ่มแยกทางกันแล้ว (HTTP 429 ฝั่งหนึ่งเป็น flow_error อีกฝั่งเป็น captcha — a9c3e9a)
 *
 * ใช้ 2 ขั้น: `armImageWatch` / `armRenderWatch` นับสภาพหน้า **ก่อนกด** Generate แล้วคืนตัวเฝ้า → หลังกด
 * เรียก `wait(...)` ได้ผลลัพธ์ (URL รูป / id ของคลิปใหม่) หรือ FlowStepError ชื่อขั้น `wait-results`/`wait-render`
 * (ชื่อนี้คือค่าใน FlowJob.failedStep — หลักฐานตอนพังและข้อความใน /flow ผูกกับมัน)
 *
 * กติกาที่อยู่ที่นี่ที่เดียว:
 * - **ไม่กด Generate ซ้ำเด็ดขาด** — โมดูลนี้อ่านหน้าอย่างเดียว ไม่มีทางคลิกอะไร (AI4Next พบว่ากดซ้ำได้งานเจนซ้อน)
 * - **ไม่แน่ใจให้เอียงไปทาง captcha** (พักยาว) — คำแนะนำของ flow_error คือ "กดรันต่อ" = ยิงซ้ำใส่หน้าที่บล็อกเรา
 * - captcha/login ทุกทางเรียก `onBotSignal` ก่อน throw (ผู้เรียกต่อเข้า FlowActivity `bot_signal`)
 *
 * นโยบาย (สัญญาณไหน → ErrorKind / เสร็จ / รอต่อ) เป็นฟังก์ชัน pure `judgeTick` + ลูป `runWatch` ที่รับ clock —
 * ตรวจได้โดยไม่ต้องมี browser ใน scripts/check-flow-worker-pure.mjs · ส่วนที่แตะหน้าเว็บคือ adapter สองตัวท้ายไฟล์
 * (อ่านอย่างเดียว ลำดับการอ่านตามโค้ดเดิมของแต่ละรอบ)
 *
 * ไฟล์นี้ห้าม import ของที่ผูก DB/Next (activity, flow-selectors → lib) — pure check คอมไพล์มันตรงๆ ด้วย tsc
 */
import type { Page } from "playwright";
import { FlowStepError, type ErrorKind } from "./errors";
import { blockKindForStatus, errorKindForTileTexts, generateAccepted, pickNewThumbnail } from "./flow-signals";
import { sleepMs } from "./humanize";

/** Flow ขึ้นช่อง "กำลังวาด" ทันทีที่รับคำสั่ง — เผื่อเน็ตช้า 45 วิก่อนสรุปว่าคลิก Generate ไม่ติด */
export const GENERATE_ACCEPT_MS = 45_000;
/** ได้ผลครบแล้วรออีกนิด เผื่อ response ที่มาช้า (straggler) */
export const SETTLE_MS = 2500;
/** เว้นระหว่างการดูหน้าแต่ละครั้ง */
export const TICK_MS = 2000;
/** ข้อความ role=alert / aria-live ที่แปลว่า Flow ไม่ทำงานนี้ */
const ALERT_FAIL = /policy|can't create|violat|not able to generate|error/i;
const TILE_BOT_BLOCK_MESSAGE = "Flow แจ้ง unusual activity (โดนจับว่าเป็นบอท) — พักก่อน";

/** selector ที่ตัวเฝ้าอ่าน — SelectorSet (flow-selectors.ts) ใส่แทนได้ตรงๆ (ไม่ import เพราะไฟล์นั้นผูก lib/) */
export type WatchSelectors = {
  captchaSignals: string[];
  errorTile?: string;
  resultTile?: string;
  pendingTile?: string;
  results: { strategy: "network" | "dom"; imageUrlHosts: string[] };
};

/** response ของ RPC เจนที่ Flow session ดักไว้ (onResponse ใน flow-session.ts) — array เดียวกันที่ยังโตอยู่ระหว่างรอ */
export type ObservedResponse = { status: number; body: unknown; at: number };

/** สิ่งที่ต่างกันระหว่างรอบรูปกับรอบ Render — นอกนั้นใช้กฎชุดเดียวกัน */
export type WatchPolicy = {
  step: "wait-results" | "wait-render";
  /** จำนวนผลที่ขอ (รูป 4 · คลิป 1) */
  expected: number;
  /**
   * ได้ผลครบแล้วชนะการ์ด error ในกริดไหม — รอบรูปเช็ก "ได้รูปครบ" ก่อนการ์ด error ส่วนรอบ Render เช็กการ์ด error
   * ก่อน "มีคลิปใหม่" (ลำดับของโค้ดเดิมแต่ละรอบ คงไว้ตามเดิม — ในทางปฏิบัติสองอย่างนี้ไม่เกิดพร้อมกัน)
   */
  resultFirst: boolean;
  /** Render: เสร็จต่อเมื่อไม่เหลือช่องที่กำลังทำ (ช่องที่เสร็จมีแค่ thumbnail) */
  waitPendingClear: boolean;
  /** HTTP status ของ response หลังกด → หยุดด้วย kind ไหน (null = ไม่หยุด) */
  statusKind: (status: number) => ErrorKind | null;
  text: {
    captchaSelector: (selector: string) => string;
    http: (r: { status: number; body: unknown }) => string;
    tilesFailed: (freshFailed: number) => string;
    notAccepted: string;
    timeout: (ms: number) => string;
  };
};

/** โฮสต์ network strategy อ่าน response ของ RPC เจนรูปตรงๆ — รหัสบล็อก (401/403/429) ใช้กฎเดียวกับ blockKindForStatus ที่เหลือ ≥400 = flow_error */
export function networkKindForStatus(status: number): ErrorKind | null {
  return blockKindForStatus(status) ?? (status >= 400 ? "flow_error" : null);
}

export function imageWatchPolicy(strategy: "network" | "dom", count: number): WatchPolicy {
  return {
    step: "wait-results",
    expected: count,
    resultFirst: true,
    waitPendingClear: false,
    // network อ่านผลจาก response ของ RPC เจนรูปเอง → ≥400 ไหนก็พัง · dom (batchexecute รวมหลาย RPC) นับเฉพาะรหัสบล็อก
    // — เดิมโฮสต์ dom ไม่เช็ก HTTP status เลย โดน 403/429 แล้วบอทไม่รู้ตัว
    statusKind: strategy === "network" ? networkKindForStatus : blockKindForStatus,
    text: {
      captchaSelector: (c) => `เจอสัญญาณ captcha ระหว่างรอผล: ${c}`,
      http:
        strategy === "network"
          ? (r) => `Flow ตอบ HTTP ${r.status}: ${typeof r.body === "string" ? r.body.slice(0, 300) : JSON.stringify(r.body).slice(0, 300)}`
          : (r) => `Flow ตอบ HTTP ${r.status} หลังกด Generate`,
      tilesFailed: (n) => `Flow วาดไม่สำเร็จ ${String(n)}/${String(count)} รูป (failed to generate — ไม่เสียเครดิต)`,
      notAccepted: `กด Generate แล้วแต่ Flow ไม่เริ่มวาดภายใน ${String(GENERATE_ACCEPT_MS / 1000)} วิ (คลิกไม่ติด หรือปุ่มเปลี่ยน)`,
      timeout: (ms) => `รอผลเกิน ${ms} ms`,
    },
  };
}

export const RENDER_WATCH: WatchPolicy = {
  step: "wait-render",
  expected: 1,
  resultFirst: false,
  waitPendingClear: true,
  statusKind: blockKindForStatus,
  text: {
    captchaSelector: (c) => `เจอสัญญาณ captcha ระหว่างรอคลิป: ${c}`,
    http: (r) => `Flow ตอบ HTTP ${r.status} หลังกดสร้างคลิป`,
    // การ์ดพังของวิดีโอ — สันนิษฐานว่าเป็น <flow-error-tile> เหมือนรูป (ยังไม่เคยเห็นวิดีโอพังจริง ดู spec Render)
    tilesFailed: () => "Flow ทำคลิปไม่สำเร็จ (การ์ด error ในกริด)",
    notAccepted: `กดสร้างคลิปแล้วแต่ Flow ไม่เริ่มทำภายใน ${String(GENERATE_ACCEPT_MS / 1000)} วิ (คลิกไม่ติด หรือปุ่มเปลี่ยน)`,
    timeout: (ms) => `รอคลิปเกิน ${String(ms)} ms`,
  },
};

/** สิ่งที่เห็นในหน้า 1 ครั้ง · field ที่ไม่ได้อ่าน (adapter หยุดอ่านเพราะได้คำตัดสินแล้ว — ลำดับเดียวกับโค้ดเดิม) เป็นค่าว่าง */
export type WatchTick<T> = {
  /** captcha selector ตัวแรกที่เจอ · null = ไม่เจอ */
  captchaHit: string | null;
  /** response หลังกด Generate ตามลำดับที่มา */
  responses: { status: number; body: unknown }[];
  /** ผลที่ได้แล้ว (รูปใหม่ที่โหลดได้ · คลิปใหม่ 0/1) */
  goodCount: number;
  /** สิ่งที่คืนถ้ารอบนี้ "เสร็จ" */
  value: T | null;
  /** การ์ด <flow-error-tile> ที่เพิ่มขึ้นหลังกด (นับก่อนกดแล้วหักออก — การ์ดเก่าจากรอบ retry ยังค้างในโปรเจกต์) */
  freshErrorTiles: number;
  /** ข้อความของการ์ด error (อ่านเฉพาะเมื่อมีการ์ดใหม่) */
  errorTileTexts: string[];
  tilesBefore: number;
  /** จำนวนช่องในกริดตอนนี้ · null = ไม่ได้อ่าน (รับคำสั่งแล้ว / โฮสต์ไม่มี resultTile) */
  tilesNow: number | null;
  pendingNow: number;
  /** ข้อความ role=alert รวมกัน · null = ไม่มี alert */
  alertText: string | null;
};

export type WatchVerdict =
  | { kind: "wait"; accepted: boolean }
  | { kind: "done" }
  | { kind: "fail"; errorKind: ErrorKind; message: string; botSignal: string | null };

/** response แรกหลังกดที่ต้องหยุด (ตาม policy.statusKind) · null = ไม่มี */
export function blockingResponse(
  responses: { status: number; body: unknown }[],
  p: WatchPolicy,
): { r: { status: number; body: unknown }; kind: ErrorKind } | null {
  for (const r of responses) {
    const kind = p.statusKind(r.status);
    if (kind !== null) return { r, kind };
  }
  return null;
}

function fail(errorKind: ErrorKind, message: string, botSignal: string | null): WatchVerdict {
  return { kind: "fail", errorKind, message, botSignal };
}

/** การ์ด error ใหม่ตัดสินแล้วหรือยัง — บล็อก = captcha ทันที · ทุกช่องที่ขอจบแล้ว (พัง + ดี ≥ ที่ขอ) = flow_error · ไม่งั้น null (รอช่องที่เหลือ) */
export function errorTileVerdict(freshErrorTiles: number, texts: string[], goodCount: number, p: WatchPolicy): WatchVerdict | null {
  if (freshErrorTiles <= 0) return null;
  if (errorKindForTileTexts(texts) === "captcha") return fail("captcha", TILE_BOT_BLOCK_MESSAGE, "wait-loop");
  if (freshErrorTiles + goodCount >= p.expected) return fail("flow_error", p.text.tilesFailed(freshErrorTiles), null);
  return null;
}

/**
 * ตัดสินจากสิ่งที่เห็น 1 ครั้ง (pure) — ลำดับคือลำดับความสำคัญ:
 * captcha selector → HTTP บล็อก → [รอบรูป: ได้ผลครบ] → การ์ด error (บล็อก = captcha · ครบทุกช่องแล้ว = flow_error)
 * → คลิกไม่ติดใน 45 วิ → [Render: มีคลิปใหม่และไม่เหลือช่องกำลังทำ] → alert ของ Flow → รอต่อ
 */
export function judgeTick<T>(tick: WatchTick<T>, s: { accepted: boolean; acceptBy: number; now: number }, p: WatchPolicy): WatchVerdict {
  // สัญญาณบอทก่อนอย่างอื่น — ถ้าหน้าเปลี่ยนเป็นหน้าบล็อกระหว่างรอ (เดิมเช็กแค่ก่อนเริ่มแต่ละขั้น)
  if (tick.captchaHit !== null) return fail("captcha", p.text.captchaSelector(tick.captchaHit), "wait-loop");
  const blocked = blockingResponse(tick.responses, p);
  if (blocked !== null) {
    const { r, kind } = blocked;
    return fail(kind, p.text.http(r), kind === "captcha" || kind === "login_required" ? `http ${r.status}` : null);
  }
  const ready = tick.goodCount >= p.expected && (!p.waitPendingClear || tick.pendingNow === 0);
  if (p.resultFirst && ready) return { kind: "done" };
  // การ์ด "Failed — Sorry, this image failed to generate" ของ Flow เอง (ไม่เสียเครดิต) — ไม่มี role=alert
  // จึงไม่ถูกจับด้วยเช็ก alert ด้านล่าง ถ้าทุกช่องที่ขอจบแล้วแต่ไม่ครบเป็นผลดี ต้องหยุดทันที ไม่ใช่นั่งรอจนหมดเวลา
  // แล้วรายงานผิดว่า "ช้า" · element เดียวกันใช้ทั้งตอน "วาดไม่สำเร็จ" และตอนโดนบล็อก — บล็อกไม่ต้องรอให้ครบทุกช่อง
  const tilesVerdict = errorTileVerdict(tick.freshErrorTiles, tick.errorTileTexts, tick.goodCount, p);
  if (tilesVerdict !== null) return tilesVerdict;
  // ยืนยันภายใน 45 วิว่า Flow รับคำสั่งแล้ว — ไม่งั้นแปลว่าคลิก Generate ไม่ติด (ห้ามกดซ้ำเอง: AI4Next
  // พบว่ากดซ้ำได้งานเจนซ้อน 2 ชุด) · tilesNow null = รับแล้ว หรือโฮสต์ที่ยังไม่ยืนยัน DOM (ไม่มี resultTile) ข้ามการเช็กนี้
  let accepted = s.accepted;
  if (!accepted && tick.tilesNow !== null) {
    accepted = generateAccepted({
      tilesBefore: tick.tilesBefore,
      tilesNow: tick.tilesNow,
      pendingNow: tick.pendingNow,
      freshErrorTiles: tick.freshErrorTiles,
      goodCount: tick.goodCount,
    });
    if (!accepted && s.now > s.acceptBy) return fail("selector_drift", p.text.notAccepted, null);
  }
  if (!p.resultFirst && ready) return { kind: "done" };
  if (tick.alertText !== null && ALERT_FAIL.test(tick.alertText)) {
    return fail("flow_error", `Flow แจ้ง: ${tick.alertText.slice(0, 200)}`, null);
  }
  return { kind: "wait", accepted };
}

/** แหล่งของ tick — adapter ที่อ่านหน้า Flow จริง (ท้ายไฟล์) หรือของปลอมในเทสต์ */
export type TickSource<T> = {
  /** false = โฮสต์ไม่มี resultTile ยืนยันไม่ได้ว่า Flow รับคำสั่ง → ถือว่ารับแล้ว */
  canConfirmAccept: boolean;
  /** accepted = รู้แล้วว่า Flow รับคำสั่ง (ไม่ต้องนับช่องในกริดอีก) */
  observe(accepted: boolean): Promise<WatchTick<T>>;
  /** ผลสุดท้ายหลังรอ straggler (network อ่าน response ใหม่ทั้งหมดอีกรอบ) */
  settle(tick: WatchTick<T>): T;
};

export type WatchClock = { now(): number; sleep(ms: number): Promise<void> };
const REAL_CLOCK: WatchClock = { now: () => Date.now(), sleep: sleepMs };

export type WatchRun = {
  /** เวลาที่กด Generate (Date.now()) — response ก่อนหน้านี้ไม่นับ */
  submitAt: number;
  responses: readonly ObservedResponse[];
  timeoutMs: number;
  /** เรียกก่อน throw ทุกครั้งที่เจอ captcha/login — ผู้เรียกต่อเข้า logActivity bot_signal (ห้าม throw) */
  onBotSignal: (signal: string) => void;
};

/** ลูปรอผล — ดูหน้าทุก 2 วิจนได้คำตัดสิน หรือครบ timeoutMs (= generation_timeout) */
export async function runWatch<T>(
  source: TickSource<T>,
  policy: WatchPolicy,
  run: Pick<WatchRun, "submitAt" | "timeoutMs" | "onBotSignal">,
  clock: WatchClock = REAL_CLOCK,
): Promise<T> {
  const deadline = clock.now() + run.timeoutMs;
  const acceptBy = run.submitAt + GENERATE_ACCEPT_MS;
  let accepted = !source.canConfirmAccept;
  while (clock.now() < deadline) {
    const tick = await source.observe(accepted);
    const verdict = judgeTick(tick, { accepted, acceptBy, now: clock.now() }, policy);
    if (verdict.kind === "fail") {
      if (verdict.botSignal !== null) run.onBotSignal(verdict.botSignal);
      throw new FlowStepError(policy.step, verdict.errorKind, verdict.message);
    }
    if (verdict.kind === "done") {
      await clock.sleep(SETTLE_MS);
      return source.settle(tick);
    }
    accepted = verdict.accepted;
    await clock.sleep(TICK_MS);
  }
  throw new FlowStepError(policy.step, "generation_timeout", policy.text.timeout(run.timeoutMs));
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

// ---------------------------------------------------------------------------------------------
// adapter หน้า Flow จริง — อ่านอย่างเดียว ไม่คลิก

/** clock ใส่ได้เฉพาะในเทสต์ (หน้าปลอม) — บอทใช้เวลาจริงเสมอ */
export type GenerationWatch<T> = { wait(run: WatchRun, clock?: WatchClock): Promise<T> };

function responsesSince(responses: readonly ObservedResponse[], submitAt: number): ObservedResponse[] {
  return responses.filter((r) => r.at >= submitAt);
}

function blankTick<T>(captchaHit: string | null, responses: { status: number; body: unknown }[], tilesBefore: number): WatchTick<T> {
  return {
    captchaHit, responses, goodCount: 0, value: null, freshErrorTiles: 0, errorTileTexts: [],
    tilesBefore, tilesNow: null, pendingNow: 0, alertText: null,
  };
}

async function firstCaptchaHit(page: Page, signals: string[]): Promise<string | null> {
  for (const c of signals) {
    if ((await page.locator(c).count()) > 0) return c;
  }
  return null;
}

async function readErrorTiles(page: Page, sel: WatchSelectors, before: number): Promise<{ fresh: number; texts: string[] }> {
  if (!sel.errorTile) return { fresh: 0, texts: [] };
  const tiles = page.locator(sel.errorTile);
  const fresh = (await tiles.count()) - before;
  // อ่านข้อความของการ์ด error เท่านั้น (ไม่ใช่ทั้งหน้า — พรอมต์เราอยู่ในหน้าด้วย)
  return { fresh, texts: fresh > 0 ? await tiles.allInnerTexts() : [] };
}

async function readAlert(page: Page): Promise<string | null> {
  const alert = page.locator("[role='alert'], [aria-live='assertive']");
  if ((await alert.count()) === 0) return null;
  return (await alert.allInnerTexts()).join(" ").trim();
}

async function readImgSrcs(page: Page): Promise<string[]> {
  return page.locator("img").evaluateAll((els) => els.map((e) => (e as HTMLImageElement).src));
}

/**
 * รอบรูป: นับสภาพหน้าก่อนกด Generate (เรียกหลังพิมพ์พรอมต์ ก่อนขั้น click-generate)
 * ผลของ wait = URL รูปใหม่ (≥ count ตัว — ผู้เรียกตัดเอง)
 */
export async function armImageWatch(page: Page, sel: WatchSelectors, count: number): Promise<GenerationWatch<string[]>> {
  const beforeImgs = await readImgSrcs(page);
  // ต้องนับ "ก่อนกด" เพราะ ensure-project ใช้โปรเจกต์เดิมซ้ำได้ (รอบ retry) — การ์ด Failed เก่า
  // จากความพยายามก่อนหน้ายังค้างอยู่ในหน้า ถ้าไม่หักออกจะเข้าใจผิดว่ารอบนี้พังทันทีตั้งแต่ยังไม่ทันวาด
  const beforeErrorTiles = sel.errorTile ? await page.locator(sel.errorTile).count() : 0;
  const beforeTiles = sel.resultTile ? await page.locator(sel.resultTile).count() : 0;
  const policy = imageWatchPolicy(sel.results.strategy, count);
  const hosts = sel.results.imageUrlHosts;
  return {
    wait: (run, clock) => {
      const source: TickSource<string[]> = {
        canConfirmAccept: !!sel.resultTile,
        async observe(accepted) {
          const captchaHit = await firstCaptchaHit(page, sel.captchaSignals);
          if (captchaHit !== null) return blankTick(captchaHit, [], beforeTiles);
          const fresh = responsesSince(run.responses, run.submitAt);
          if (blockingResponse(fresh, policy) !== null) return blankTick(null, fresh, beforeTiles);
          let good: string[];
          if (sel.results.strategy === "network") {
            good = collectImageUrls(fresh.map((r) => r.body), hosts);
          } else {
            const now = await readImgSrcs(page);
            good = collectImageUrls(now.filter((s) => !beforeImgs.includes(s)), hosts);
          }
          // ได้ครบแล้ว = เสร็จ (รอบรูปเช็กผลก่อนการ์ด error) — ไม่อ่านหน้าต่อ เหมือนโค้ดเดิมที่คืนผลทันที
          if (good.length >= count) return { ...blankTick<string[]>(null, fresh, beforeTiles), goodCount: good.length, value: good };
          const tiles = await readErrorTiles(page, sel, beforeErrorTiles);
          // การ์ด error ตัดสินแล้ว (บล็อก / ครบทุกช่อง) — ไม่อ่านหน้าต่อ เหมือนโค้ดเดิมที่ throw ตรงนั้น
          if (errorTileVerdict(tiles.fresh, tiles.texts, good.length, policy) !== null) {
            return { ...blankTick<string[]>(null, fresh, beforeTiles), goodCount: good.length, value: good, freshErrorTiles: tiles.fresh, errorTileTexts: tiles.texts };
          }
          const needAccept = !accepted && !!sel.resultTile;
          const tilesNow = needAccept && sel.resultTile ? await page.locator(sel.resultTile).count() : null;
          const pendingNow = needAccept && sel.pendingTile ? await page.locator(sel.pendingTile).count() : 0;
          const alertText = await readAlert(page);
          return {
            captchaHit: null, responses: fresh, goodCount: good.length, value: good,
            freshErrorTiles: tiles.fresh, errorTileTexts: tiles.texts, tilesBefore: beforeTiles, tilesNow, pendingNow, alertText,
          };
        },
        settle(tick) {
          // network: อ่าน response ทั้งหมดอีกรอบหลังรอ straggler · dom: รูปชุดที่เห็นตอนครบ
          return sel.results.strategy === "network"
            ? collectImageUrls(responsesSince(run.responses, run.submitAt).map((r) => r.body), hosts)
            : (tick.value ?? []);
        },
      };
      return runWatch(source, policy, run, clock);
    },
  };
}

/**
 * รอบ Render: นับสภาพหน้าก่อนกดสร้างคลิป (หลังวางพรอมต์) · readVideoIds(step) = id ของทุกช่องวิดีโอตามลำดับ DOM
 * ("" = ยังไม่มี thumbnail) — step คือชื่อขั้นที่อ่าน ("click-generate" ตอนนับก่อนกด · "wait-render" ระหว่างรอ)
 * ผลของ wait = id ของช่องวิดีโอใหม่ที่เสร็จแล้ว (ไม่เหลือช่องกำลังทำ)
 */
export async function armRenderWatch(
  page: Page,
  sel: WatchSelectors,
  readVideoIds: (step: "click-generate" | "wait-render") => Promise<string[]>,
): Promise<GenerationWatch<string>> {
  const beforeErrorTiles = sel.errorTile ? await page.locator(sel.errorTile).count() : 0;
  const beforeTiles = sel.resultTile ? await page.locator(sel.resultTile).count() : 0;
  const beforeVideoIds = await readVideoIds("click-generate");
  return {
    wait: (run, clock) => {
      const source: TickSource<string> = {
        canConfirmAccept: !!sel.resultTile,
        async observe(accepted) {
          const captchaHit = await firstCaptchaHit(page, sel.captchaSignals);
          if (captchaHit !== null) return blankTick(captchaHit, [], beforeTiles);
          const fresh = responsesSince(run.responses, run.submitAt);
          if (blockingResponse(fresh, RENDER_WATCH) !== null) return blankTick(null, fresh, beforeTiles);
          const tiles = await readErrorTiles(page, sel, beforeErrorTiles);
          // การ์ด error ตัดสินแล้ว (คลิปขอ 1 ช่อง — ใบเดียวก็ตัดสิน) — ไม่อ่านหน้าต่อ เหมือนโค้ดเดิมที่ throw ตรงนั้น
          if (errorTileVerdict(tiles.fresh, tiles.texts, 0, RENDER_WATCH) !== null) return { ...blankTick<string>(null, fresh, beforeTiles), freshErrorTiles: tiles.fresh, errorTileTexts: tiles.texts };
          const pendingNow = sel.pendingTile ? await page.locator(sel.pendingTile).count() : 0;
          const newId = pickNewThumbnail(beforeVideoIds, await readVideoIds("wait-render"));
          const tilesNow = !accepted && sel.resultTile ? await page.locator(sel.resultTile).count() : null;
          // มีคลิปใหม่และไม่เหลือช่องกำลังทำ = เสร็จ (เช็กก่อน alert) — ไม่อ่าน alert เหมือนโค้ดเดิม
          const alertText = newId !== null && pendingNow === 0 ? null : await readAlert(page);
          return {
            captchaHit: null, responses: fresh, goodCount: newId === null ? 0 : 1, value: newId,
            freshErrorTiles: tiles.fresh, errorTileTexts: tiles.texts, tilesBefore: beforeTiles, tilesNow, pendingNow, alertText,
          };
        },
        settle(tick) {
          return tick.value ?? "";
        },
      };
      return runWatch(source, RENDER_WATCH, run, clock);
    },
  };
}
