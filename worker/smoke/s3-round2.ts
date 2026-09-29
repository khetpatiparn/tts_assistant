/**
 * S3: รอบ 2 ("ตอนใช้งาน") โดยอัปโหลดรูปที่ Flow วาดในรอบ 1 กลับเข้าไปเป็นรูปอ้างอิง
 * รัน: npm run flow-smoke:s3 -- worker/smoke/out/s2/r1-a1-0.png "<ชื่อสินค้า>" [projectId]
 * ถ้าใส่ projectId (จากบรรทัด PROJECT_ID= ของ S2) จะใช้ project เดิม ไม่งั้นสร้างใหม่
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
  const [refPath, productName, projectId] = process.argv.slice(2);
  if (!refPath || !productName) {
    console.error('usage: npm run flow-smoke:s3 -- <candidate.png> "<product name>" [projectId]');
    process.exit(2);
  }
  const cfg = loadWorkerConfig();
  const outDir = path.resolve("worker/smoke/out/s3");
  mkdirSync(outDir, { recursive: true });
  const log = new StepLog(true);

  const { context, page } = await launchFlowBrowser(cfg);
  try {
    const { host } = await openFlowAndSettle(page, cfg);
    const sel = selectorSetForHost(host);
    const result = await runRound(
      page,
      { round: 2, productName, referencePath: path.resolve(refPath), outDir, filePrefix: "r2-a1", projectId: projectId ?? null, extraPrompt: "", checkpointDir: null },
      cfg,
      sel,
      log
    );
    writeFileSync(path.join(outDir, "s3-response.json"), JSON.stringify(result.responseBody, null, 2), "utf8");
    for (const f of result.files) console.log(`FILE=${f}`);
    console.log("S3 OK");
  } catch (e) {
    const step = isFlowStepError(e) ? e.step : "unknown";
    const kind = isFlowStepError(e) ? e.kind : "worker_crash";
    const message = e instanceof Error ? e.message : String(e);
    await captureFailure({ page, dir: path.resolve("worker/smoke/out/s3-failure"), step, kind, message, log, state: { smoke: "s3" } });
    console.error(`S3 FAILED step=${step} kind=${kind}: ${message}`);
    process.exitCode = 1;
  } finally {
    await context.close();
  }
}

main();
