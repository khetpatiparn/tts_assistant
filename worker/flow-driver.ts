/**
 * สูตรของบอทบนหน้า Google Flow — ผู้เรียก (worker/index.ts processJob, smoke) เลือกสูตรตามรอบของงานแล้วเรียกตัวเดียว:
 *
 * - `drawImages`  (รอบ 1-2) วาดรูปอ้างอิง 4 รูปจากรูป 1 รูป → ไฟล์รูป + id โปรเจกต์ · ไม่เสียเครดิต
 * - `renderClip`  (รอบ 3)   Render คลิป 1 ตัวจากรูปที่เลือก 2 รอบ + 10-part prompt → Preview clip 720p (หรือเหตุผลที่โหลดไม่ได้)
 *                           + id ของคลิป · 15 เครดิต · **หลังกดสร้างแล้วไม่ throw** (เครดิตจ่ายแล้ว คลิปอยู่ในโปรเจกต์)
 * - `fetchFinalClip` (รอบ 4) กลับโปรเจกต์เดิม โหลดคลิปที่ผ่านแบบ 1080p Upscaled → ไฟล์ หรือเหตุผล · ไม่กดสร้างอะไร ไม่เสียเครดิต
 *
 * ทุกสูตรเดินบน Flow session (flow-session.ts: ขั้นที่มีชื่อ / ภาพจุดเช็ก / เปิดโปรเจกต์ / ตั้งค่า / แนบรูป / กด Generate)
 * error ที่หลุดออกไปเป็น FlowStepError ที่มีชื่อขั้น (FLOW_STEPS) เสมอ · นโยบายพัง/หยุดคิวเป็นของผู้เรียก
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import type { Locator } from "playwright";
import { buildFlowPrompt, buildRenderPrompt } from "@/lib/flow-jobs";
import { FlowStepError } from "./errors";
import { humanClick, maybeIdleScroll, randInt, sleepMs, sleepRange, typeHuman } from "./humanize";
import { logActivity } from "./activity";
import { renderSettingsLabelOk } from "./flow-signals";
import { videoSelectors, type FinalCapture } from "./clip-capture";
import { armImageWatch, armRenderWatch } from "./generation-watch";
import { assertSelected, firstVisible, isChecked, withFlowSession, type FlowContext, type OutputFiles } from "./flow-session";

export { FLOW_STEPS, type FlowContext, type FlowStep, type OutputFiles } from "./flow-session";

const ASPECT = "3:4";
const COUNT = 4;
/** Render: 9:16 ตามสูตรที่ผู้ใช้ทำมือ · ตัวเลือกข้อความล้วนที่ต้องเลือก (ค่าเริ่มต้นของโปรเจกต์ใหม่คือ 8s ต้องกด 10s) */
const RENDER_ASPECT = "9:16";
const RENDER_TEXT_OPTIONS = ["720p", "10s", "x1"] as const;

export type DrawImagesInput = {
  round: 1 | 2;
  productName: string;
  /** รอบ 1 = รูปแคปจากผู้ใช้ · รอบ 2 = รูปที่ผู้ใช้เลือกรอบ 1 */
  reference: string;
  /** ข้อความที่ผู้ใช้พิมพ์ต่อท้ายพรอมต์ตายตัว (FlowJob.extraPrompt, ทำความสะอาดแล้ว) · "" = พรอมต์ตั้งต้น */
  extraPrompt: string;
  /** รอบ 2 ใช้โปรเจกต์เดิมของรอบ 1 · null = สร้างใหม่ */
  projectId: string | null;
  /** รูป `${prefix}-${i}.png|jpg` (i = 0-3) */
  out: OutputFiles;
};

export type DrawnImages = {
  /** 4 ไฟล์เสมอ (ได้ไม่ครบ = throw download-4) */
  files: string[];
  projectId: string;
  /** response ของ RPC เจนหลังกด Generate (smoke เขียนลงไฟล์ไว้ดู) */
  responseBody: unknown;
};

/**
 * รอบ 1-2: วาดรูป 4 รูป (Nano Banana 2 · 3:4 · x4) จากรูปอ้างอิง 1 รูป ด้วยพรอมต์ตายตัว (buildFlowPrompt) + ข้อความเพิ่มเติม
 * ขั้น: open-flow → ensure-project → switch-image-mode → set-model → set-aspect-3-4 → set-count-4 → attach-reference →
 * type-prompt → click-generate → wait-results → dwell → download-4
 */
export async function drawImages(ctx: FlowContext, input: DrawImagesInput): Promise<DrawnImages> {
  return withFlowSession(ctx, input.round, input.out, async (s) => {
    const { page, cfg, sel } = s;
    const projectId = await s.openProject(input.projectId, false);

    await s.step("switch-image-mode", async () => {
      await s.openSettings("switch-image-mode");
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

    await s.step("set-model", async () => {
      await s.openSettings("set-model");
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

    await s.step("set-aspect-3-4", async () => {
      const tab = page.locator(sel.aspectTab(ASPECT)).first();
      await tab.waitFor({ state: "visible", timeout: cfg.selectorTimeoutMs });
      if (!(await isChecked(tab))) {
        await humanClick(page, tab, cfg);
        await sleepMs(randInt([400, 800]));
      }
      await assertSelected(tab, "set-aspect-3-4", ASPECT);
    });

    await s.step("set-count-4", async () => {
      const tabs = page.locator(sel.countTabs).filter({ hasText: sel.countTabPattern });
      const target = tabs.nth(COUNT - 1);
      await target.waitFor({ state: "visible", timeout: cfg.selectorTimeoutMs });
      if (!(await isChecked(target))) {
        await humanClick(page, target, cfg);
        await sleepMs(randInt([400, 800]));
      }
      await assertSelected(target, "set-count-4", "x4");
      // ถ่ายก่อนปิดแผง — ภาพต้องเห็นโมเดล/สัดส่วน/จำนวนที่เลือกไว้
      await s.checkpoint(1, "settings");
      await s.closeSettings("set-count-4");
    });

    await s.step("attach-reference", () => s.attachReferences([input.reference]));

    await s.step("type-prompt", async () => {
      const box = await firstVisible(page, "type-prompt", sel.promptBox, cfg.selectorTimeoutMs);
      await humanClick(page, box, cfg);
      await page.keyboard.press("Control+A");
      await page.keyboard.press("Delete");
      await sleepMs(randInt([300, 700]));
      await typeHuman(page, buildFlowPrompt(input.round, input.productName, input.extraPrompt), cfg.typeCharDelayMs);
      await sleepMs(randInt([500, 1200]));
      // ภาพนี้เห็นทั้งรูปที่แนบและพรอมต์ที่พิมพ์ครบแล้ว (รวมข้อความเพิ่มเติม) ก่อนกด Generate
      await s.checkpoint(3, "prompt");
    });

    // นับสภาพหน้าก่อนกด (รูป / การ์ด error / ช่องในกริด) — ดู armImageWatch
    const watch = await armImageWatch(page, sel, COUNT);
    const submitAt = await s.clickGenerate("generate_image");

    const urls = await s.step("wait-results", () =>
      watch.wait({ submitAt, responses: s.responses, timeoutMs: cfg.generationTimeoutMs, onBotSignal: s.onBotSignal }),
    );

    await s.step("dwell", async () => {
      await sleepRange(cfg.dwellAfterResultsMs);
      // หลังรอ dwell รูปโหลดครบแล้ว และก่อนเลื่อนจอเล่น (เลื่อนแล้วผลลัพธ์อาจหลุดจากเฟรม)
      await s.checkpoint(4, "results");
      await maybeIdleScroll(page, cfg);
    });

    const files = await s.step("download-4", async () => {
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
        const file = path.join(input.out.dir, `${input.out.prefix}-${i}.${isPng ? "png" : "jpg"}`);
        writeFileSync(file, buf);
        written.push(file);
        await sleepMs(randInt([300, 900]));
      }
      logActivity({ kind: "download", jobId: ctx.jobId, round: input.round, detail: { files: 4 } });
      return written;
    });

    return { files, projectId, responseBody: s.responses.filter((r) => r.at >= submitAt).map((r) => r.body) };
  });
}

export type RenderClipInput = {
  /** รูปที่เลือกรอบ 1 + รอบ 2 — แนบพร้อมกันใน filechooser เดียว */
  references: string[];
  /** 10-part prompt ของ entry (chatgptOutput) — ว่าง = ไม่แตะหน้าเลย (paste-prompt / worker_crash) */
  tenPartPrompt: string;
  /** ต่อท้ายพรอมต์ (buildRenderPrompt) · "" = 10-part prompt อย่างเดียว */
  extraPrompt: string;
  /** โปรเจกต์ของรอบ 1-2 · null = สร้างใหม่ */
  projectId: string | null;
  /** Preview clip `${prefix}.mp4` (r3-a<attempt>) */
  out: OutputFiles;
};

export type RenderedClip = {
  projectId: string;
  /** id ของคลิปใน Flow (เก็บเป็น FlowJobImage.flowMediaId — Final clip ใช้หาช่องนี้) */
  mediaId: string;
  /** Preview clip ที่เขียนแล้ว · null = Flow เรนเดอร์เสร็จแต่โหลดมาไม่ได้ (คลิปยังอยู่ในโปรเจกต์) */
  file: string | null;
  /** เหตุผลที่โหลดไม่ได้ · null = ได้ไฟล์ */
  failed: string | null;
};

/**
 * รอบ 3: Render คลิป 1 ตัวด้วยสูตรที่ผู้ใช้ทำมือ (Video · Ingredients · 9:16 · Omni 1.1 Flash · 720p · 10s · x1
 * = 15 เครดิต) แนบรูปที่เลือก 2 รอบ วาง 10-part prompt แล้วโหลดตัวอย่าง 720p Original size กลับมาให้ดูก่อน
 * (ไฟล์ 1080p ขยายตอนโหลดซึ่งรอนาน — ทำเฉพาะคลิปที่ผู้ใช้กดผ่านแล้ว ใน fetchFinalClip)
 * ขั้น: open-flow → ensure-project → switch-video-mode → set-video-settings → attach-reference → paste-prompt →
 * click-generate → wait-render → dwell* → download-preview* (* = softStep: พังแล้วคืนผล ไม่ throw)
 */
export async function renderClip(ctx: FlowContext, input: RenderClipInput): Promise<RenderedClip> {
  // ไม่มี 10-part prompt = ไม่เปิดหน้าเลย (กันเสียเครดิตกับคลิปที่ไม่มีพรอมต์) — ด่านเดียวของเรื่องนี้
  if (input.tenPartPrompt.trim() === "") {
    throw new FlowStepError("paste-prompt", "worker_crash", "entry นี้ยังไม่มี 10-part prompt — กด สร้างด้วย AI ในหน้างานก่อน");
  }
  // พรอมต์ที่วางทั้งก้อน (10-part prompt + ข้อความเพิ่มเติม)
  const prompt = buildRenderPrompt(input.tenPartPrompt, input.extraPrompt);

  return withFlowSession(ctx, 3, input.out, async (s) => {
    const { page, cfg, sel } = s;
    const projectId = await s.openProject(input.projectId, false);
    const capture = s.clipCapture();

    await s.step("switch-video-mode", async () => {
      const v = videoSelectors(sel, "switch-video-mode");
      await s.openSettings("switch-video-mode");
      const tab = page.locator(v.modeTab).first();
      await tab.waitFor({ state: "visible", timeout: cfg.selectorTimeoutMs });
      if (!(await isChecked(tab))) {
        await humanClick(page, tab, cfg);
        await sleepMs(randInt([900, 1500]));
      }
      // โหมดผิด = ได้รูป 4 รูปแทนคลิป — อ่านกลับเสมอ
      await assertSelected(tab, "switch-video-mode", "โหมดวิดีโอ");
    });

    await s.step("set-video-settings", async () => {
      const v = videoSelectors(sel, "set-video-settings");
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
      await s.checkpoint(1, "settings");
      await s.closeSettings("set-video-settings");
      // ยืนยันทั้งชุดจากป้ายบนปุ่มตั้งค่าอีกชั้น (เห็นจริง: "Video · 720p · 10s" + crop_9_16 + x1)
      const trigger = await firstVisible(page, "set-video-settings", sel.modeTrigger, cfg.selectorTimeoutMs, sel.modeTriggerIntent);
      const triggerText = (await trigger.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
      if (!renderSettingsLabelOk(triggerText)) {
        throw new FlowStepError("set-video-settings", "selector_drift", `ป้ายตั้งค่าไม่ตรงสูตร: "${triggerText}"`);
      }
    });

    const chipSelector = videoSelectors(sel, "attach-reference").ingredientChip;
    await s.step("attach-reference", () =>
      s.attachReferences(input.references, { selector: chipSelector, count: input.references.length })
    );

    await s.step("paste-prompt", async () => {
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
      if (chips !== input.references.length) {
        throw new FlowStepError("paste-prompt", "selector_drift", `หลังวางพรอมต์เหลือรูปแนบ ${String(chips)} รูป (ต้อง ${String(input.references.length)})`);
      }
      await s.checkpoint(3, "prompt");
    });

    // นับสภาพหน้าก่อนกด (การ์ด error / ช่องในกริด / id ของช่องวิดีโอ) — ช่องคลิปเก่าของรอบเรนเดอร์ก่อนอยู่ในโปรเจกต์เดียวกัน
    const watch = await armRenderWatch(page, sel, (step) => capture.tileIds(step));
    const submitAt = await s.clickGenerate("generate_video");

    const mediaId = await s.step("wait-render", () =>
      watch.wait({ submitAt, responses: s.responses, timeoutMs: cfg.renderTimeoutMs, onBotSignal: s.onBotSignal }),
    );

    // หลังจากนี้ห้ามทำให้งาน failed — เครดิตจ่ายแล้ว คลิปมีจริงในโปรเจกต์ (spec 2026-09-30 §2 "หลักการรวม")
    const dwell = await s.softStep("dwell", async () => {
      await sleepRange(cfg.dwellAfterResultsMs);
      await s.checkpoint(4, "results");
      await maybeIdleScroll(page, cfg);
    });
    if (!dwell.ok) return { projectId, mediaId, file: null, failed: dwell.reason };

    // ลำดับ: ลิงก์ตรง → เมนู → ยอมแพ้แบบไม่พัง ให้ผู้ใช้ไปโหลดเองใน Flow (capturePreview ไม่ throw)
    const preview = await s.softStep("download-preview", () => capture.capturePreview(mediaId, `${input.out.prefix}.mp4`));
    if (!preview.ok) return { projectId, mediaId, file: null, failed: preview.reason };
    // uuid จากลิงก์ตรงคงที่ข้ามการเปิดโปรเจกต์ใหม่ (id จาก thumbnail ไม่คงที่) — fetchFinalClip ใช้หาช่องนี้
    return { projectId, mediaId: preview.value.mediaId, file: preview.value.file, failed: preview.value.failed };
  });
}

export type FinalClipInput = {
  /** โปรเจกต์ที่ Render คลิปนี้ (FlowJob.flowProjectId) — ต้องเปิดได้ ไม่สร้างใหม่ */
  projectId: string;
  /** id ของคลิปที่ผ่าน (FlowJobImage.flowMediaId ที่ renderClip คืนมา) */
  mediaId: string;
  /** Final clip `${prefix}.mp4` (r3-final) · ภาพเมนูโหลด `${prefix}-5-menu.jpg` / `-6-submenu.jpg` */
  out: OutputFiles;
};

/**
 * รอบ 4: ผู้ใช้กด "ผ่าน" คลิปตัวอย่างแล้ว — กลับไปโปรเจกต์เดิม หาช่องของคลิปนั้นด้วย id ที่ renderClip คืนมา
 * แล้วโหลดแบบ 1080p Upscaled (Flow ขยายให้ตอนโหลด ไม่เสียเครดิต แต่รอนาน) · ไม่กดสร้างอะไรเลย
 * ขั้น: open-flow → ensure-project (ห้ามสร้างใหม่) → find-video → download-final
 * 1080p ล้ม = ไม่ throw: คืน {file: null, failed} — ผู้ใช้มี 720p อยู่แล้ว (spec 2026-09-30 §2)
 * ผู้เรียกต้องส่ง projectId/mediaId ที่ไม่ว่าง (processJob ตรวจกับแถวของงานก่อนเรียก)
 */
export async function fetchFinalClip(ctx: FlowContext, input: FinalClipInput): Promise<FinalCapture> {
  return withFlowSession(ctx, 4, input.out, async (s) => {
    await s.openProject(input.projectId, true);
    const capture = s.clipCapture();
    await s.step("find-video", () => capture.findClip(input.mediaId));
    return s.step("download-final", () => capture.captureFinal(input.mediaId, `${input.out.prefix}.mp4`));
  });
}
