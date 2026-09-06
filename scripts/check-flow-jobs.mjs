/**
 * ตรวจตรรกะ pure ของ lib/flow-jobs.ts — รัน: node scripts/check-flow-jobs.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const out = mkdtempSync(join(process.cwd(), ".check-flow-tmp-"));
let failed = 0;
function check(name, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`      ได้ ${JSON.stringify(actual)} ควรได้ ${JSON.stringify(expected)}`);
}
function checkThrows(name, fn) {
  let threw = false;
  try { fn(); } catch { threw = true; }
  if (!threw) failed++;
  console.log(`${threw ? "PASS" : "FAIL"}  ${name}`);
}

try {
  execFileSync("npx", ["tsc", "lib/flow-jobs.ts", "--outDir", out, "--module", "es2022", "--target", "ES2017", "--moduleResolution", "bundler"], { stdio: "inherit", shell: true });
  const f = await import(pathToFileURL(join(out, "flow-jobs.js")).href);

  check("queuedStatus(1)", f.queuedStatus(1), "queued_r1");
  check("runningStatus(2)", f.runningStatus(2), "running_r2");
  check("reviewStatus(2)", f.reviewStatus(2), "review_r2");
  check("roundOf review_r1", f.roundOf("review_r1"), 1);
  check("roundOf done", f.roundOf("done"), 2);
  check("roundOf failed → null", f.roundOf("failed"), null);
  check("isOpenStatus done → false", f.isOpenStatus("done"), false);
  check("isOpenStatus skipped → false", f.isOpenStatus("skipped"), false);
  check("isOpenStatus review_r1 → true", f.isOpenStatus("review_r1"), true);

  check("prompt round 1", f.buildFlowPrompt(1, "ที่ลับเล็บแมว"), 'ขอภาพสินค้าอย่างเดียวเท่านั้น พื้นหลังขาว สินค้าคือ "ที่ลับเล็บแมว"');
  check("prompt round 2", f.buildFlowPrompt(2, "ที่ลับเล็บแมว"), 'ขอภาพสินค้าตอนใช้งาน สินค้าคือ "ที่ลับเล็บแมว"');
  check("candidateFilename", f.candidateFilename(1, 2, 3, "png"), "r1-a2-3.png");
  check("sourceFilename", f.sourceFilename(0, "jpg"), "source-0.jpg");

  check("afterChoose review_r1 → queued_r2", f.afterChoose("review_r1").status, "queued_r2");
  check("afterChoose review_r2 → done", f.afterChoose("review_r2").status, "done");
  checkThrows("afterChoose queued_r1 throws", () => f.afterChoose("queued_r1"));
  check("afterRedo review_r1 → queued_r1", f.afterRedo("review_r1").status, "queued_r1");
  check("afterRedo review_r2 → queued_r2", f.afterRedo("review_r2").status, "queued_r2");
  checkThrows("afterRedo done throws", () => f.afterRedo("done"));
  check("afterResume(2) → queued_r2", f.afterResume(2).status, "queued_r2");

  const s = f.summarizeQueue([
    { status: "queued_r1" }, { status: "running_r2" }, { status: "review_r1" },
    { status: "review_r2" }, { status: "done" }, { status: "failed" }, { status: "skipped" },
  ]);
  check("summarize waitingBot (queued+running)", s.waitingBot, 2);
  check("summarize waitingUser (review_*)", s.waitingUser, 2);
  check("summarize done", s.done, 1);
  check("summarize failed", s.failed, 1);

  const now = new Date("2026-09-06T10:00:00Z");
  check("worker alive within 3× heartbeat", f.isWorkerAlive(new Date("2026-09-06T09:59:20Z"), now, 30000), true);
  check("worker dead after 3× heartbeat", f.isWorkerAlive(new Date("2026-09-06T09:58:00Z"), now, 30000), false);
  check("worker dead when never seen", f.isWorkerAlive(null, now, 30000), false);
  check("STEP_LABELS has click-generate", typeof f.STEP_LABELS["click-generate"], "string");
  check("DEFAULT_CAPTIONS round 1", f.DEFAULT_CAPTIONS[1], "สินค้า พื้นหลังขาว");
} finally {
  rmSync(out, { recursive: true, force: true });
}
if (failed > 0) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log("\nall checks passed");
