/**
 * S2: ทำรอบ 1 ครบ 12 ขั้นจากรูปจริง 1 รูป → ต้องได้ 4 ไฟล์
 * รัน: npm run flow-smoke:s2 -- <path/to/product-screenshot.png> "<ชื่อสินค้า>"
 * ตัวเลือก: FLOW_FORCE_FAIL_STEP=<step> เพื่อทดสอบ fail-fast (S4)
 * ผลลัพธ์: worker/smoke/out/s2/*.png · s2-response.json · ถ้าพัง worker/smoke/out/s2-failure/
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadWorkerConfig } from "../config";
import { launchFlowBrowser, openFlowAndSettle } from "../browser";
import { selectorSetForHost } from "../flow-selectors";
import { runRound } from "../flow-driver";
import { StepLog, captureFailure } from "../failure";
import { isFlowStepError } from "../errors";

async function main() {
  const [refPath, productName] = process.argv.slice(2);
  if (!refPath || !productName) {
    console.error('usage: npm run flow-smoke:s2 -- <image> "<product name>"');
    process.exit(2);
  }
  const cfg = loadWorkerConfig();
  const outDir = path.resolve("worker/smoke/out/s2");
  mkdirSync(outDir, { recursive: true });
  const log = new StepLog(true);

  const { context, page } = await launchFlowBrowser(cfg);
  try {
    const { host } = await openFlowAndSettle(page, cfg);
    const sel = selectorSetForHost(host);
    log.log("s2", `host=${host} selectorSet=${sel.name}`);
    const result = await runRound(
      page,
      { jobId: "smoke", round: 1, productName, referencePaths: [path.resolve(refPath)], outDir, filePrefix: "r1-a1", projectId: null, extraPrompt: "", checkpointDir: null },
      cfg,
      sel,
      log,
      { forceFailStep: process.env.FLOW_FORCE_FAIL_STEP }
    );
    writeFileSync(path.join(outDir, "s2-response.json"), JSON.stringify(result.responseBody, null, 2), "utf8");
    console.log(`PROJECT_ID=${result.projectId}`);
    for (const f of result.files) console.log(`FILE=${f}`);
    console.log("S2 OK");
  } catch (e) {
    const step = isFlowStepError(e) ? e.step : "unknown";
    const kind = isFlowStepError(e) ? e.kind : "worker_crash";
    const message = e instanceof Error ? e.message : String(e);
    await captureFailure({ page, dir: path.resolve("worker/smoke/out/s2-failure"), step, kind, message, log, state: { smoke: "s2" } });
    console.error(`S2 FAILED step=${step} kind=${kind}: ${message}`);
    console.error("evidence: worker/smoke/out/s2-failure/");
    process.exitCode = 1;
  } finally {
    await context.close();
  }
}

main();
