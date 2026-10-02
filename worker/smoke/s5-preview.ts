/**
 * S5: โหลดคลิปตัวอย่าง 720p ของคลิปที่มีอยู่แล้วในโปรเจกต์ ด้วยโค้ดจริงของบอท (clipCapture.capturePreview — ทางเดียวกับขั้น
 * download-preview ของรอบ 3: ลิงก์ตรง → เมนู) · ไม่กดสร้างอะไร ไม่เสียเครดิต ไม่แตะงานในคิว (เขียนแค่ FlowActivity "download" ของ jobId smoke-s5 เหมือน s4)
 * mediaId = FlowJobImage.flowMediaId ของคลิปนั้น (uuid) — หลังเปิดโปรเจกต์ใหม่ thumbnail ไม่มี id บอทจึงส่องเมนู 720p ทีละช่องก่อน
 * รัน (ต้องปิดบอทก่อน — stop.bat · โปรไฟล์ Chrome เปิดได้ทีละตัว): npx tsx worker/smoke/s5-preview.ts <projectId> <mediaId>
 * ผลลัพธ์: worker/smoke/out/s5/r3-preview.mp4 · steps ใน console · ถ้าพัง worker/smoke/out/s5-failure/
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { loadWorkerConfig } from "../config";
import { launchFlowBrowser, openFlowAndSettle } from "../browser";
import { selectorSetForHost } from "../flow-selectors";
import { clipCapture } from "../clip-capture";
import { randInt, sleepMs } from "../humanize";
import { StepLog, captureFailure } from "../failure";
import { isFlowStepError } from "../errors";

async function main() {
  const [projectId, mediaId] = process.argv.slice(2);
  if (!projectId || !mediaId) {
    console.error("usage: npx tsx worker/smoke/s5-preview.ts <projectId> <mediaId>");
    process.exit(2);
  }
  const cfg = loadWorkerConfig();
  const outDir = path.resolve("worker/smoke/out/s5");
  const checkpointDir = path.join(outDir, "checkpoints");
  mkdirSync(checkpointDir, { recursive: true });
  const log = new StepLog(true);
  const { context, page } = await launchFlowBrowser(cfg);
  page.on("crash", () => console.log(`[${new Date().toISOString()}] PAGE CRASH`));
  page.on("download", (d) => console.log(`[${new Date().toISOString()}] DOWNLOAD EVENT ${d.url().slice(0, 120)}`));
  try {
    const { host } = await openFlowAndSettle(page, cfg);
    const sel = selectorSetForHost(host);
    await page.goto(sel.projectUrl(projectId), { waitUntil: "domcontentloaded", timeout: 45_000 });
    await sleepMs(randInt([3000, 6000]));
    const capture = clipCapture({
      page, cfg, sel, log, outDir, jobId: "smoke-s5", round: 3,
      checkpoint: async (n, name) => {
        await page.screenshot({ path: path.join(checkpointDir, `r3-preview-${String(n)}-${name}.jpg`), type: "jpeg", quality: 55 }).catch(() => {});
      },
    });
    const result = await capture.capturePreview(mediaId, "r3-preview.mp4");
    console.log("RESULT", JSON.stringify(result));
    if (result.file === null) process.exitCode = 1;
  } catch (e) {
    const step = isFlowStepError(e) ? e.step : "unknown";
    const kind = isFlowStepError(e) ? e.kind : "worker_crash";
    const message = e instanceof Error ? e.message : String(e);
    await captureFailure({ page, dir: path.resolve("worker/smoke/out/s5-failure"), step, kind, message, log, state: { smoke: "s5" } }).catch(() => {});
    console.error(`S5 FAILED step=${step} kind=${kind}: ${message}`);
    process.exitCode = 1;
  } finally {
    await context.close().catch(() => {});
  }
}

main();
