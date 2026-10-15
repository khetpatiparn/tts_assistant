/**
 * S6: รันรอบ 3 (Render คลิป + โหลดตัวอย่าง 720p) ด้วยโค้ดจริงของบอท (renderClip) โดยไม่แตะคิว
 * **เสีย 15 เครดิตถ้าไปถึงขั้น click-generate** — ทดสอบฟรีถึงก่อนกดสร้างด้วย FLOW_FORCE_FAIL_STEP=click-generate
 * (เปิดโปรเจกต์ → โหมดวิดีโอ → ตั้งค่า → แนบรูป 2 รูป → วางพรอมต์ แล้วพังที่ click-generate ก่อนคลิก)
 * รัน (ต้องปิดบอทก่อน — stop.bat · โปรไฟล์ Chrome เปิดได้ทีละตัว):
 *   npx tsx worker/smoke/s6-render.ts <รูปรอบ1> <รูปรอบ2> <ไฟล์ 10-part prompt .txt> [projectId]
 * ไม่ใส่ projectId = สร้างโปรเจกต์ใหม่ · FlowActivity ลงด้วย jobId smoke-s6 (นับใน "ยิง Flow วันนี้" ตามจริง)
 * ผลลัพธ์: worker/smoke/out/s6/r3-a1.mp4 + checkpoints/ · บรรทัด RESULT · ถ้าพัง worker/smoke/out/s6-failure/
 */
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadWorkerConfig } from "../config";
import { launchFlowBrowser, openFlowAndSettle } from "../browser";
import { selectorSetForHost } from "../flow-selectors";
import { renderClip } from "../flow-driver";
import { StepLog, captureFailure } from "../failure";
import { isFlowStepError } from "../errors";

async function main() {
  const [ref1, ref2, promptFile, projectId] = process.argv.slice(2);
  if (!ref1 || !ref2 || !promptFile) {
    console.error("usage: npx tsx worker/smoke/s6-render.ts <round1.png> <round2.png> <prompt.txt> [projectId]");
    process.exit(2);
  }
  const tenPartPrompt = readFileSync(promptFile, "utf8");
  const cfg = loadWorkerConfig();
  const outDir = path.resolve("worker/smoke/out/s6");
  const checkpointDir = path.join(outDir, "checkpoints");
  mkdirSync(checkpointDir, { recursive: true });
  const log = new StepLog(true);
  const { context, page } = await launchFlowBrowser(cfg);
  page.on("crash", () => console.log(`[${new Date().toISOString()}] PAGE CRASH`));
  page.on("download", (d) => console.log(`[${new Date().toISOString()}] DOWNLOAD EVENT ${d.url().slice(0, 120)}`));
  try {
    const { host } = await openFlowAndSettle(page, cfg);
    const sel = selectorSetForHost(host);
    const result = await renderClip(
      { page, cfg, sel, log, jobId: "smoke-s6", forceFailStep: process.env.FLOW_FORCE_FAIL_STEP },
      {
        references: [path.resolve(ref1), path.resolve(ref2)], tenPartPrompt, extraPrompt: "",
        projectId: projectId ?? null, out: { dir: outDir, prefix: "r3-a1", checkpointDir },
      },
    );
    console.log(`PROJECT_ID=${result.projectId}`);
    console.log(`MEDIA_ID=${result.mediaId}`);
    console.log("RESULT", JSON.stringify(result));
    if (result.file === null) process.exitCode = 1;
  } catch (e) {
    const step = isFlowStepError(e) ? e.step : "unknown";
    const kind = isFlowStepError(e) ? e.kind : "worker_crash";
    const message = e instanceof Error ? e.message : String(e);
    await captureFailure({ page, dir: path.resolve("worker/smoke/out/s6-failure"), step, kind, message, log, state: { smoke: "s6" } }).catch(() => {});
    console.error(`S6 FAILED step=${step} kind=${kind}: ${message}`);
    process.exitCode = 1;
  } finally {
    await context.close().catch(() => {});
  }
}

main();
