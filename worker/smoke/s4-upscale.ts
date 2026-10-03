/**
 * S4: รันรอบ 4 (หาคลิปที่ผ่าน + โหลด 1080p) ด้วยโค้ดจริงของบอท (fetchFinalClip) โดยไม่แตะ DB · ไม่เสียเครดิต
 * รัน (ต้องปิดบอทก่อน — โปรไฟล์ Chrome เปิดได้ทีละตัว): npx tsx worker/smoke/s4-upscale.ts <projectId> <mediaId>
 * ผลลัพธ์: worker/smoke/out/s4/r3-final.mp4 · steps ใน console · ถ้าพัง worker/smoke/out/s4-failure/
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { loadWorkerConfig } from "../config";
import { launchFlowBrowser, openFlowAndSettle } from "../browser";
import { selectorSetForHost } from "../flow-selectors";
import { fetchFinalClip } from "../flow-driver";
import { StepLog, captureFailure } from "../failure";
import { isFlowStepError } from "../errors";

async function main() {
  const [projectId, mediaId] = process.argv.slice(2);
  if (!projectId || !mediaId) {
    console.error("usage: npx tsx worker/smoke/s4-upscale.ts <projectId> <mediaId>");
    process.exit(2);
  }
  const cfg = loadWorkerConfig();
  const outDir = path.resolve("worker/smoke/out/s4");
  mkdirSync(path.join(outDir, "checkpoints"), { recursive: true });
  const log = new StepLog(true);
  const { context, page } = await launchFlowBrowser(cfg);
  context.on("close", () => console.log(`[${new Date().toISOString()}] CONTEXT CLOSED`));
  page.on("crash", () => console.log(`[${new Date().toISOString()}] PAGE CRASH`));
  context.on("page", (p) => console.log(`[${new Date().toISOString()}] NEW PAGE ${p.url()}`));
  page.on("download", (d) => console.log(`[${new Date().toISOString()}] DOWNLOAD EVENT ${d.url().slice(0, 120)}`));
  try {
    const { host } = await openFlowAndSettle(page, cfg);
    const sel = selectorSetForHost(host);
    const result = await fetchFinalClip(
      { page, cfg, sel, log, jobId: "smoke-s4", forceFailStep: process.env.FLOW_FORCE_FAIL_STEP },
      { projectId, mediaId, out: { dir: outDir, prefix: "r3-final", checkpointDir: path.join(outDir, "checkpoints") } },
    );
    console.log("RESULT", JSON.stringify(result));
    if (result.file === null) process.exitCode = 1;
  } catch (e) {
    const step = isFlowStepError(e) ? e.step : "unknown";
    const kind = isFlowStepError(e) ? e.kind : "worker_crash";
    const message = e instanceof Error ? e.message : String(e);
    await captureFailure({ page, dir: path.resolve("worker/smoke/out/s4-failure"), step, kind, message, log, state: { smoke: "s4" } }).catch(() => {});
    console.error(`S4 FAILED step=${step} kind=${kind}: ${message}`);
    process.exitCode = 1;
  } finally {
    await context.close().catch(() => {});
  }
}

main();
