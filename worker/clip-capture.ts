/**
 * ดึงไฟล์คลิปออกจาก Flow — ที่เดียวของ "เอาไฟล์ของคลิปนี้ ขนาดนี้" ทั้งรอบ 3 (Preview clip 720p) และรอบ 4 (Final clip 1080p)
 * วิธีตัดสินแล้วใน docs/adr/0003-flow-clip-files-are-captured-not-downloaded.md (ดักคำขอไฟล์แล้วดึงเอง + เมาส์เส้นตรง)
 * — โมดูลนี้แค่ให้มันมีบ้าน ไม่ได้เปลี่ยนวิธี
 *
 * interface:
 * - `tileIds(step)` — id ของทุกช่องวิดีโอในกริด (ตัวเฝ้าหลังกดสร้างคลิปใช้หาช่องใหม่)
 * - `capturePreview(mediaId, filename)` — ขั้น download-preview: ลิงก์ตรง → เมนู · **ไม่ throw** (คลิปที่เรนเดอร์แล้วห้ามทำงานพัง)
 *   คืนไฟล์ (หรือเหตุผลที่ไม่ได้) + id ถาวรของคลิป (uuid จากลิงก์ตรง ถ้าได้ทางนั้น — รอบ 4 ใช้ค่านี้หาช่อง)
 * - `findClip(mediaId)` — ขั้น find-video: ยืนยันว่าเจอช่องของคลิปนี้ (throw selector_drift ถ้าไม่เจอ)
 * - `captureFinal(mediaId, filename)` — ขั้น download-final: 1080p Upscaled ผ่านเมนู ไฟล์ต้องเป็นของ mediaId จริง · **ไม่ throw**
 *
 * สถานะภายใน (ช่องที่หาเจอแล้ว / uuid จากลิงก์ตรง) เป็นของ instance เอง — สูตรใน flow-driver.ts (renderClip / fetchFinalClip)
 * สร้างใหม่ทุกครั้งผ่าน FlowSession.clipCapture() (เดิมเป็น let/const ใน runRound ตัวเก่าที่ต้องประกาศก่อนบรรทัดแยกรอบ —
 * ประกาศผิดที่แล้วรอบ 4 พังด้วย TDZ, 75387b4)
 *
 * ชื่อขั้น (download-preview / find-video / download-final) อยู่ในข้อความ error และ steps.log ตามเดิม
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import type { WorkerConfig } from "./config";
import { FlowStepError } from "./errors";
import type { StepLog } from "./failure";
import type { SelectorSet } from "./flow-selectors";
import { humanClick, humanHover, randInt, sleepMs } from "./humanize";
import { logActivity } from "./activity";
import { fileUrlIsMedia, flowMediaIdFromSrc, isMp4Header, knownTileIndex, pickDirectVideoUrl, videoUuidFromUrl } from "./flow-signals";

/** รอบ 4: รอกริดของโปรเจกต์โหลด thumbnail ของคลิปที่ผ่านนานสุดเท่านี้ก่อนสรุปว่าหาไม่เจอ */
const FIND_VIDEO_MS = 30_000;

export type VideoSelectors = NonNullable<SelectorSet["video"]>;

/** selector ของ Render — โฮสต์ที่ไม่ประกาศ (labs) Render ไม่ได้ · step = ขั้นที่ถาม (ใส่ในข้อความ host_unsupported) */
export function videoSelectors(sel: SelectorSet, step: string): VideoSelectors {
  if (!sel.video) throw new FlowStepError(step, "host_unsupported", `โฮสต์ชุด ${sel.name} ยังไม่รองรับการทำคลิป`);
  return sel.video;
}

/** หน้า Flow ที่เปิดโปรเจกต์ของงานอยู่ + สิ่งที่ต้องใช้บันทึกไฟล์/กิจกรรม */
export type ClipSession = {
  page: Page;
  cfg: WorkerConfig;
  sel: SelectorSet;
  log: StepLog;
  /** โฟลเดอร์ที่เขียนไฟล์คลิป */
  outDir: string;
  /** สำหรับ FlowActivity */
  jobId: string;
  round: number;
  /** ภาพจุดเช็ก (FlowSession.checkpoint) — เมนูที่เปิด `5-menu` / เมนูย่อย `6-submenu` */
  checkpoint: (n: number, name: string) => Promise<void>;
};

export type PreviewCapture = {
  /** path ของไฟล์ที่เขียนแล้ว · null = โหลดไม่ได้ทั้งสองทาง (คลิปยังอยู่ใน Flow) */
  file: string | null;
  /** เหตุผลที่โหลดไม่ได้ · null = ได้ไฟล์ */
  failed: string | null;
  /** id ที่เก็บเป็น FlowJobImage.flowMediaId — uuid จากลิงก์ตรงถ้าได้ทางนั้น ไม่งั้น mediaId ที่ส่งเข้ามา */
  mediaId: string;
};

export type FinalCapture = { file: string | null; failed: string | null };

export type ClipCapture = {
  tileIds(step: string): Promise<string[]>;
  capturePreview(mediaId: string, filename: string): Promise<PreviewCapture>;
  findClip(mediaId: string): Promise<void>;
  captureFinal(mediaId: string, filename: string): Promise<FinalCapture>;
};

export function clipCapture(session: ClipSession): ClipCapture {
  const { page, cfg, sel, log, outDir, jobId, round, checkpoint } = session;
  /** id ถาวรของคลิปที่ลิงก์ตรงล่าสุดโหลดมา — รอบ 3 เก็บค่านี้แทน id จาก thumbnail (ดู videoUuidFromUrl) */
  let lastDirectVideoUuid = "";
  /** ช่องคลิปที่หาเจอแล้ว (mediaId → ลำดับช่อง) — find-video กับ download-final ถามซ้ำ ไม่ต้องเปิดเมนูส่อง id ทุกช่องอีกรอบ */
  const foundTiles = new Map<string, number>();

  function videoSel(name: string): VideoSelectors {
    return videoSelectors(sel, name);
  }

  /** id ของทุกช่องวิดีโอในกริดตามลำดับ DOM ("" = ช่องที่ยังไม่มี thumbnail เช่นกำลังทำ) */
  async function videoTileIds(name: string): Promise<string[]> {
    const v = videoSel(name);
    const srcs = await page
      .locator(v.tileContainer)
      .evaluateAll((els, thumb) => els.map((el) => el.querySelector(thumb)?.getAttribute("src") ?? ""), v.tileThumbnail);
    return srcs.map(flowMediaIdFromSrc);
  }

  /**
   * หาช่องของคลิป (-1 = ไม่เจอ) · id ที่เก็บไว้ = uuid ของคลิป (จากลิงก์ตรง หรือ id จาก thumbnail ตอนเรนเดอร์ — ค่าเดียวกัน)
   * ลำดับ: id จาก thumbnail → ช่องที่จำไว้ (foundTiles) → เปิดเมนูโหลด 720p ของทีละช่อง (แม้มีช่องเดียว) แล้วรับเฉพาะช่องที่
   * id จากคำขอ `/video/<id>` ที่ถูกยกเลิกตรงกับ mediaId (เปิดโปรเจกต์ใหม่แล้ว thumbnail เป็น /asb/<ลายเซ็น> ไม่มี id)
   */
  async function tileIndexOf(name: string, mediaId: string): Promise<number> {
    const found = await findTileIndex(name, mediaId);
    if (found >= 0) foundTiles.set(mediaId, found);
    return found;
  }

  async function findTileIndex(name: string, mediaId: string): Promise<number> {
    const ids = await videoTileIds(name);
    const known = knownTileIndex(ids, mediaId, foundTiles.get(mediaId));
    if (known !== null) return known;
    // ไม่รู้ id จาก thumbnail: หลังเปิดโปรเจกต์ใหม่ทั้ง thumbnail และ <video src> เป็น /asb/<ลายเซ็น> ไม่มี id (เจอจริง 2026-10-01)
    // → เปิดเมนูโหลด 720p ของแต่ละช่อง ดัก URL ที่หน้าเว็บขอ (`/video/<id>`) แล้วยกเลิกทันที ไม่โหลดจริง ไม่เสียเครดิต
    // · ส่องแม้โปรเจกต์มีช่องเดียว — ห้ามเดาว่าเป็นคลิปที่ผ่าน · id ใน URL = id เดียวกับที่รอบ 3 เก็บ
    // (ยืนยันแล้ว: `_upsampled` ของกล่องพลาสติกใสใช้ id เดียวกับ thumbnail ตอนเรนเดอร์)
    const previewQuality = videoSel(name).previewQuality;
    for (let i = 0; i < ids.length; i++) {
      const url = await menuRequestFileUrl(name, i, previewQuality, 30_000).catch((e: unknown) => {
        log.log(name, `ส่องช่องที่ ${String(i + 1)} ไม่ได้: ${e instanceof Error ? e.message : String(e)}`);
        // เมนูอาจค้างเปิดอยู่ — ปิดด้วย Escape (ห้าม Enter: เปิดหน้าแก้ไขคลิป) ก่อนส่องช่องถัดไป
        return page.keyboard.press("Escape").then(() => null, () => null);
      });
      log.log(name, `ช่องที่ ${String(i + 1)}/${String(ids.length)} = ${videoUuidFromUrl(url) || "(ไม่รู้)"}`);
      if (fileUrlIsMedia(url, mediaId)) return i;
      await sleepMs(randInt([800, 1500]));
    }
    return -1;
  }

  /**
   * ทางแรกของการโหลดคลิป: hover ช่อง → อ่าน <video src> ที่ Flow ใส่ให้ → ดึงไฟล์ตรงด้วย page.request (แนบ cookie ของบอท
   * ให้เองเผื่อวันหน้า Google บังคับ) · ไม่แตะเมนู ⋯ เลย — เมนูซ้อน 3 ชั้นคือขั้นที่พังบ่อยที่สุด (2 ใน 2 รอบจริง)
   * คืน null เมื่อ (ก) ไม่มี <video src> ที่ใช้ได้ใน 10 วิ (ข) HTTP ไม่ใช่ 2xx เช่น ลายเซ็นหมดอายุ (ค) ไฟล์ไม่ใช่ MP4 —
   * ผู้เรียกถอยไปเมนู · ไม่ throw เพราะยังมีทางถอย
   */
  async function downloadVideoDirect(name: string, mediaId: string, filename: string): Promise<string | null> {
    const v = videoSel(name);
    const idx = await tileIndexOf(name, mediaId);
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
    const file = path.join(outDir, filename);
    writeFileSync(file, buf);
    lastDirectVideoUuid = videoUuidFromUrl(url);
    log.log(name, `ได้ไฟล์ ${filename} ${String(Math.round(buf.length / 1024))} KB (ลิงก์ตรง)`);
    logActivity({ kind: "download", jobId, round, detail: { via: "direct" } });
    return file;
  }

  /**
   * เปิดเมนู More options → Download → ขนาดที่ต้องการ ของช่องที่ idx แล้วคืน URL ไฟล์ที่หน้าเว็บขอ — **ยกเลิก**
   * คำขอนั้นทุกครั้ง (ไม่มี blob = ไม่มีดาวน์โหลด = Chrome ไม่ crash) ผู้เรียกดึงเองหรือแค่อ่าน id จาก URL
   */
  async function menuRequestFileUrl(name: string, idx: number, quality: RegExp[], timeoutMs: number): Promise<string> {
    const v = videoSel(name);
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
    await sleepMs(randInt([400, 800]));
    // ภาพเมนูที่เปิดอยู่ — ย้อนดูได้ว่าเปิดเมนูของช่องไหน
    await checkpoint(5, "menu");
    // เมนูย่อยด้วยเมาส์ เดินเป็นเส้นตรงเท่านั้น (แบบที่คนทำจริง — ผู้ใช้ยืนยันวิธีนี้ 2026-10-01):
    // ชี้ที่ "Download" → รอเมนูย่อยโผล่ → เลื่อนแนวนอนตรงๆ ที่ระดับแถว Download เข้าเมนูย่อย → ลงแนวดิ่งในเมนูย่อย
    // ถึงตัวเลือก → คลิก · เส้นเมาส์โค้งที่ผ่านรายการอื่นทำให้เมนูย่อยสลับ/ปิด (เจอจริง 2026-09-30)
    // · คีย์บอร์ดใช้ไม่ได้: เมนูของ Flow ไม่เปิดเมนูย่อยด้วย ArrowRight และ Enter ไปเปิดหน้าแก้ไขคลิปแทน
    //   (ภาพ r3-final-6-submenu.jpg 2026-10-01) — ห้ามกลับไปใช้คีย์บอร์ด
    const dlBox = await dl.boundingBox();
    if (dlBox === null) throw new FlowStepError(name, "selector_drift", "หาตำแหน่งปุ่ม Download ในเมนูไม่ได้");
    const rowY = dlBox.y + dlBox.height / 2;
    await page.mouse.move(dlBox.x + dlBox.width * 0.5, rowY, { steps: randInt([12, 20]) });
    let target = page.locator(v.menuItem);
    for (const re of quality) target = target.filter({ hasText: re });
    target = target.first();
    const submenuOpen = await target.waitFor({ state: "visible", timeout: 4000 }).then(() => true, () => false);
    if (!submenuOpen) {
      await checkpoint(6, "submenu");
      throw new FlowStepError(name, "selector_drift", `ชี้ที่ Download แล้วเมนูย่อยไม่โผล่ (ไม่เจอ ${quality.map(String).join(" + ")})`);
    }
    await sleepMs(randInt([250, 500]));
    const tBox = await target.boundingBox();
    if (tBox === null) throw new FlowStepError(name, "selector_drift", "หาตำแหน่งตัวเลือกในเมนูย่อยไม่ได้");
    const disabled = await target.evaluate((e) => e.getAttribute("aria-disabled") === "true" || (e as HTMLButtonElement).disabled);
    if (disabled) throw new FlowStepError(name, "selector_drift", "ตัวเลือกที่ต้องการกดไม่ได้ (disabled) — บัญชีอาจไม่มีสิทธิ์ขนาดนี้");
    const subX = tBox.x + Math.min(40, tBox.width / 3);
    await page.mouse.move(subX, rowY, { steps: randInt([10, 16]) });
    await sleepMs(randInt([150, 300]));
    await page.mouse.move(subX, tBox.y + tBox.height / 2, { steps: randInt([8, 14]) });
    await sleepMs(randInt([200, 400]));
    await checkpoint(6, "submenu");
    if (!(await target.isVisible())) {
      throw new FlowStepError(name, "selector_drift", "เมนูย่อยปิดไประหว่างเลื่อนเมาส์ — ยังไม่ได้กดโหลด");
    }
    const picked = ((await target.textContent()) ?? "").replace(/\s+/g, " ").trim();
    log.log(name, `คลิก "${picked}" ในเมนูย่อย`);
    // สอดแนมจริง 2026-10-01 (worker/smoke/dl-spy.ts): กด "1080p Upscaled" → Flow ขึ้น toast "Upscaling your video…"
    // → ~40 วิต่อมาหน้าเว็บ fetch `https://flow-content.google/video/<mediaId>_upsampled?Expires…` (video/mp4) เอง
    // แล้วค่อยยิงเป็น blob download · 720p "Original size" ก็ fetch `/video/<id>` แบบเดียวกัน
    const wantUpsampled = quality.some((re) => re.test("Upscaled"));
    // **Chrome ของบอท crash ตอนเบราว์เซอร์เริ่ม "ดาวน์โหลด" blob** (crash dump ใน .flow-profile/Crashpad ตรงเวลาเป๊ะ
    // 2 ครั้ง 2026-10-01: ตอนสอดแนมและตอนบอทคลิก) — จึงดัก request ของไฟล์ที่หน้าเว็บ fetch เอง: จด URL แล้ว **ยกเลิก**
    // fetch นั้น (ไม่มี blob → ไม่มีดาวน์โหลด → ไม่ crash) แล้วดึงไฟล์เองจาก URL เดียวกันด้วย page.request
    // · โหลด 720p ผ่านเมนู: ยกเลิกเฉพาะ fetch/xhr (ไม่แตะ <video> ที่โหลดเป็น media ตอน hover)
    const isFileUrl = (u: string) => pickDirectVideoUrl([u]) !== null && /_upsampled(\?|$)/.test(u) === wantUpsampled;
    let resolveFileUrl: (u: string) => void = () => {};
    const fileUrl = new Promise<string>((resolve) => { resolveFileUrl = resolve; });
    const routeMatcher = (u: URL) => pickDirectVideoUrl([u.toString()]) !== null;
    await page.route(routeMatcher, (route) => {
      const req = route.request();
      const u = req.url();
      const type = req.resourceType();
      if (isFileUrl(u) && (wantUpsampled || type === "fetch" || type === "xhr")) {
        resolveFileUrl(u);
        route.abort("aborted").catch(() => {});
        return;
      }
      route.continue().catch(() => {});
    });
    try {
      await page.mouse.down();
      await sleepMs(randInt([60, 140]));
      await page.mouse.up();
      // คลิกติด = เมนูปิดเอง · ถ้าตัวเลือกยังค้างอยู่แปลว่าคลิกไม่ติด → บอกทันที ไม่นั่งรอ 10 นาทีเปล่าๆ
      await sleepMs(3000);
      if ((await page.locator(v.menuItem).filter({ visible: true }).count()) > 0) {
        throw new FlowStepError(name, "selector_drift", "คลิกแล้วเมนูไม่ปิด (ไม่ติด) — ยังไม่ได้เริ่มโหลด");
      }
      let timer: NodeJS.Timeout | undefined;
      const url = await Promise.race([
        fileUrl,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new FlowStepError(name, "download_failed", `กดโหลดแล้ว Flow ไม่ขอไฟล์ภายใน ${String(timeoutMs / 1000)} วิ`)),
            timeoutMs,
          );
        }),
      ]).finally(() => clearTimeout(timer));
      return url;
    } finally {
      await page.unroute(routeMatcher).catch(() => {});
    }
  }

  /**
   * โหลดคลิปของช่องที่มี id นี้ผ่านเมนู แล้วดึงไฟล์เองจาก URL ที่ดักได้ · ตรวจหัวไฟล์ว่าเป็น MP4 จริงก่อนคืน
   * verifyId (รอบ 4): URL ที่หน้าเว็บขอต้องเป็นของคลิป mediaId — ไม่ตรง = ไม่โหลด (ไม่เอาคลิปอื่นมาเป็นไฟล์ 1080p ของงานนี้)
   * · รอบ 3 ไม่เช็ก เพราะ id ตอนนั้นมาจาก thumbnail ซึ่งบางหน้าเป็น /asb/<ลายเซ็น> ไม่ใช่ uuid
   */
  async function downloadVideo(name: string, mediaId: string, quality: RegExp[], filename: string, verifyId = false): Promise<string> {
    const idx = await tileIndexOf(name, mediaId);
    if (idx < 0) throw new FlowStepError(name, "selector_drift", `หาช่องของคลิป ${mediaId} ในกริดไม่เจอ`);
    const url = await menuRequestFileUrl(name, idx, quality, cfg.renderDownloadTimeoutMs);
    if (verifyId && !fileUrlIsMedia(url, mediaId)) {
      throw new FlowStepError(name, "download_failed", `ไฟล์ที่ Flow ขอเป็นของคลิปอื่น (${videoUuidFromUrl(url) || "อ่าน id ไม่ได้"} ไม่ใช่ ${mediaId}) — ไม่โหลด`);
    }
    log.log(name, `Flow ขอไฟล์แล้ว (ยกเลิกฝั่งหน้าเว็บ ดึงเอง): ${url.slice(0, 120)}…`);
    const res = await page.request.get(url, { maxRedirects: 3, timeout: cfg.renderDownloadTimeoutMs });
    if (!res.ok()) throw new FlowStepError(name, "download_failed", `ดึงไฟล์จากลิงก์ตอบ HTTP ${String(res.status())}`);
    const buf = await res.body();
    if (!isMp4Header(buf)) {
      throw new FlowStepError(name, "download_failed", `ไฟล์ที่ได้ไม่ใช่ MP4 (${String(buf.length)} bytes)`);
    }
    const file = path.join(outDir, filename);
    writeFileSync(file, buf);
    log.log(name, `ได้ไฟล์ ${filename} ${String(Math.round(buf.length / 1024))} KB`);
    logActivity({ kind: "download", jobId, round, detail: { via: "menu" } });
    return file;
  }

  /**
   * ตัวอย่าง 720p หลัง Render — หลังจากนี้ห้ามทำให้งาน failed: เครดิตจ่ายแล้ว คลิปมีจริงในโปรเจกต์ (spec 2026-09-30 §2 "หลักการรวม")
   * ลำดับ: ลิงก์ตรง → เมนู → ยอมแพ้แบบไม่พัง ให้ผู้ใช้ไปโหลดเองใน Flow
   */
  async function downloadPreview(mediaId: string, filename: string): Promise<{ file: string | null; failed: string | null }> {
    try {
      const direct = await downloadVideoDirect("download-preview", mediaId, filename);
      if (direct !== null) return { file: direct, failed: null as string | null };
    } catch (e) {
      log.log("download-preview", `ลิงก์ตรงพัง (${e instanceof Error ? e.message : String(e)}) — ถอยไปใช้เมนู`);
    }
    try {
      const viaMenu = await downloadVideo("download-preview", mediaId, videoSel("download-preview").previewQuality, filename);
      return { file: viaMenu as string | null, failed: null as string | null };
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      log.log("download-preview", `โหลดไม่ได้ทั้งลิงก์ตรงและเมนู — คลิปยังอยู่ใน Flow ให้ผู้ใช้โหลดเอง: ${reason}`);
      return { file: null as string | null, failed: reason };
    }
  }

  return {
    tileIds: videoTileIds,

    async capturePreview(mediaId, filename) {
      const got = await downloadPreview(mediaId, filename);
      // uuid จากลิงก์ตรงคงที่ข้ามการเปิดโปรเจกต์ใหม่ (id จาก thumbnail ไม่คงที่) — รอบ 4 ใช้หาช่องนี้
      return { ...got, mediaId: lastDirectVideoUuid || mediaId };
    },

    async findClip(mediaId) {
      // กริดของโปรเจกต์โหลด thumbnail ทีหลังหน้าเว็บ — รอให้ช่องของคลิปนี้โผล่ก่อนสรุปว่าไม่เจอ
      const deadline = Date.now() + FIND_VIDEO_MS;
      let ids: string[] = [];
      while (Date.now() < deadline) {
        ids = await videoTileIds("find-video");
        if (ids.includes(mediaId)) return;
        // thumbnail โหลดครบแล้ว (ไม่มีช่องว่าง) แต่ id ไม่ตรง → หาด้วย tileIndexOf (ช่องที่จำไว้ / ส่องเมนู) ไม่ต้องรอจนหมดเวลา
        if (ids.length > 0 && !ids.includes("")) {
          if ((await tileIndexOf("find-video", mediaId)) >= 0) return;
          break;
        }
        await sleepMs(1500);
      }
      throw new FlowStepError(
        "find-video",
        "selector_drift",
        `ไม่เจอคลิปที่ผ่าน (${mediaId}) ในโปรเจกต์ — มีช่องวิดีโอ ${String(ids.length)} ช่อง: ${ids.join(", ") || "ไม่มี"}`,
      );
    },

    // 1080p ล้ม = ไม่พัง: ผู้ใช้มี 720p อยู่แล้ว งานจบด้วยหมายเหตุ (spec 2026-09-30 §2)
    async captureFinal(mediaId, filename) {
      try {
        const file = await downloadVideo("download-final", mediaId, videoSel("download-final").finalQuality, filename, true);
        return { file, failed: null as string | null };
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        log.log("download-final", `โหลด 1080p ไม่ได้ — ใช้ 720p ที่มีอยู่แล้ว: ${reason}`);
        return { file: null as string | null, failed: reason };
      }
    },
  };
}
