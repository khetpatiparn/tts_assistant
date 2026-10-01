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
  execFileSync("npx", ["tsc", "lib/flow-jobs.ts", "lib/http-range.ts", "--outDir", out, "--module", "es2022", "--target", "ES2017", "--moduleResolution", "bundler"], { stdio: "inherit", shell: true });
  const f = await import(pathToFileURL(join(out, "flow-jobs.js")).href);
  const r = await import(pathToFileURL(join(out, "http-range.js")).href);

  check("queuedStatus(1)", f.queuedStatus(1), "queued_r1");
  check("runningStatus(2)", f.runningStatus(2), "running_r2");
  check("reviewStatus(2)", f.reviewStatus(2), "review_r2");
  check("queuedStatus(3) = render", f.queuedStatus(3), "queued_r3");
  check("runningStatus(3)", f.runningStatus(3), "running_r3");
  check("reviewStatus(3)", f.reviewStatus(3), "review_r3");
  check("toJobRound(3)", f.toJobRound(3), 3);
  check("toJobRound(2)", f.toJobRound(2), 2);
  check("toJobRound(4) = โหลด 1080p", f.toJobRound(4), 4);
  check("toJobRound แปลก = 1", f.toJobRound(0), 1);
  check("queuedStatus(4) = queued_upscale", f.queuedStatus(4), "queued_upscale");
  check("runningStatus(4) = running_upscale", f.runningStatus(4), "running_upscale");
  check("roundOf queued_upscale = 4", f.roundOf("queued_upscale"), 4);
  check("isOpenStatus running_upscale → true (ยังไม่จบจนได้ไฟล์ 1080p)", f.isOpenStatus("running_upscale"), true);
  check("roundOf review_r1", f.roundOf("review_r1"), 1);
  check("roundOf running_r3", f.roundOf("running_r3"), 3);
  check("roundOf awaiting_prompt = 3", f.roundOf("awaiting_prompt"), 3);
  check("roundOf done → null (จบรอบ 2 หรือ 3 ก็ได้)", f.roundOf("done"), null);
  check("roundOf failed → null", f.roundOf("failed"), null);
  check("isOpenStatus done → false", f.isOpenStatus("done"), false);
  check("isOpenStatus skipped → false", f.isOpenStatus("skipped"), false);
  check("isOpenStatus review_r1 → true", f.isOpenStatus("review_r1"), true);
  check("isOpenStatus awaiting_prompt → true (entry เข้าคิวซ้ำไม่ได้)", f.isOpenStatus("awaiting_prompt"), true);
  check("isOpenStatus review_r3 → true", f.isOpenStatus("review_r3"), true);

  check("prompt round 1", f.buildFlowPrompt(1, "ที่ลับเล็บแมว"), 'ขอภาพสินค้าอย่างเดียวเท่านั้น พื้นหลังขาว สินค้าคือ "ที่ลับเล็บแมว"');
  check("prompt round 2", f.buildFlowPrompt(2, "ที่ลับเล็บแมว"), 'ขอภาพสินค้าตอนใช้งาน สินค้าคือ "ที่ลับเล็บแมว"');
  check("prompt + ข้อความเพิ่มเติม ต่อท้ายด้วยช่องว่างเดียว", f.buildFlowPrompt(1, "ที่ลับเล็บแมว", "เอาแค่แผ่นเดียว"), 'ขอภาพสินค้าอย่างเดียวเท่านั้น พื้นหลังขาว สินค้าคือ "ที่ลับเล็บแมว" เอาแค่แผ่นเดียว');
  check("ข้อความเพิ่มเติมว่าง = พรอมต์เดิมทุกตัวอักษร", f.buildFlowPrompt(2, "ที่ลับเล็บแมว", ""), 'ขอภาพสินค้าตอนใช้งาน สินค้าคือ "ที่ลับเล็บแมว"');
  check("normalize ยุบขึ้นบรรทัด (Enter ในช่อง Flow = ส่ง)", f.normalizeExtraPrompt("  เอาแค่\nแผ่นเดียว  "), "เอาแค่ แผ่นเดียว");
  check("normalize ตัดความยาว", f.normalizeExtraPrompt("ก".repeat(500)).length, f.EXTRA_PROMPT_MAX);
  check("normalize null = ว่าง", f.normalizeExtraPrompt(null), "");
  check("candidateFilename", f.candidateFilename(1, 2, 3, "png"), "r1-a2-3.png");
  check("sourceFilename", f.sourceFilename(0, "jpg"), "source-0.jpg");

  check("videoFilename", f.videoFilename(2), "r3-a2.mp4");
  check("videoFilename(2) ตรงกับ renderOutcome", f.videoFilename(2), "r3-a2.mp4");
  check("videoDownloadName ตัดอักขระต้องห้ามของ Windows", f.videoDownloadName('กล่อง 2/3 "ใหม่"'), "กล่อง 2 3 ใหม่.mp4");
  check("videoDownloadName ชื่อว่าง", f.videoDownloadName("  "), "clip.mp4");
  const tenPart = "1. Style\nบรรทัดสอง\n\n2. Scene";
  check("render prompt ไม่มีข้อความเพิ่มเติม = 10-part prompt ทุกตัวอักษร (ขึ้นบรรทัดคงเดิม)", f.buildRenderPrompt(tenPart, ""), tenPart);
  check("render prompt + ข้อความเพิ่มเติม ต่อท้ายด้วยช่องว่างเดียว", f.buildRenderPrompt(tenPart, "ห้ามมีคน"), `${tenPart} ห้ามมีคน`);

  check("afterChoose review_r1 → queued_r2", f.afterChoose("review_r1").status, "queued_r2");
  check("afterChoose review_r2 → awaiting_prompt (ยังไม่จบ ต้อง Render ก่อน)", f.afterChoose("review_r2").status, "awaiting_prompt");
  check("afterChoose review_r2 + ปิด Render อัตโนมัติ → done (ผู้ใช้ทำคลิปเอง)", f.afterChoose("review_r2", false).status, "done");
  check("afterChoose review_r1 + ปิด Render ยังไปรอบ 2 ตามปกติ", f.afterChoose("review_r1", false).status, "queued_r2");
  checkThrows("afterChoose queued_r1 throws", () => f.afterChoose("queued_r1"));
  checkThrows("afterChoose review_r3 throws (คลิปไม่มีให้เลือก)", () => f.afterChoose("review_r3"));
  check("afterRedo review_r1 → queued_r1", f.afterRedo("review_r1").status, "queued_r1");
  check("afterRedo review_r2 → queued_r2", f.afterRedo("review_r2").status, "queued_r2");
  check("afterRedo review_r3 → queued_r3 (เรนเดอร์ใหม่)", f.afterRedo("review_r3").status, "queued_r3");
  check("canApproveRender review_r3 + มีไฟล์ → true", f.canApproveRender("review_r3", true), true);
  check("canApproveRender review_r3 + ไม่มีไฟล์ (โหลดไม่ได้) → false", f.canApproveRender("review_r3", false), false);
  check("canApproveRender สถานะอื่น → false", f.canApproveRender("review_r2", true), false);
  const v720 = { filename: "r3-a1.mp4", chosen: false };
  check("canRetryUpscale done + 720p + มีโปรเจกต์ → true", f.canRetryUpscale("done", v720, "proj"), true);
  check("canRetryUpscale ได้ 1080p แล้ว → false", f.canRetryUpscale("done", { filename: "r3-final.mp4", chosen: true }, "proj"), false);
  check("canRetryUpscale ไม่มีคลิป → false", f.canRetryUpscale("done", null, "proj"), false);
  check("canRetryUpscale ไม่รู้โปรเจกต์ → false", f.canRetryUpscale("done", v720, ""), false);
  check("canRetryUpscale ยังไม่จบ → false", f.canRetryUpscale("review_r3", v720, "proj"), false);
  checkThrows("afterRedo done throws", () => f.afterRedo("done"));
  checkThrows("afterRedo awaiting_prompt throws", () => f.afterRedo("awaiting_prompt"));
  check("afterApproveRender review_r3 → queued_upscale (ยังไม่ done จนได้ 1080p)", f.afterApproveRender("review_r3").status, "queued_upscale");
  check("afterApproveRender ย้ายเป็น round 4", f.afterApproveRender("review_r3").round, 4);
  checkThrows("afterApproveRender review_r2 throws", () => f.afterApproveRender("review_r2"));
  checkThrows("afterApproveRender running_r3 throws", () => f.afterApproveRender("running_r3"));
  check("afterResume(2) → queued_r2", f.afterResume(2).status, "queued_r2");
  check("afterResume(3) → queued_r3 (งาน Render ที่พังกลับเข้าคิว Render)", f.afterResume(3).status, "queued_r3");
  check("afterResume(4) → queued_upscale (โหลด 1080p ที่พังไม่ Render ใหม่)", f.afterResume(4).status, "queued_upscale");
  check("claimOrder ปกติ: 1080p → รอบ 2 → Render → รอบ 1", f.claimOrder(true, true).join(","), "4,2,3,1");
  check("claimOrder ครบเพดานคลิป: ยังวาดรูปได้", f.claimOrder(true, false).join(","), "4,2,1");
  check("claimOrder ครบเพดานรูป: ยัง Render ได้", f.claimOrder(false, true).join(","), "4,3");
  check("claimOrder ครบทั้งคู่: เหลือแค่โหลด 1080p (ไม่เสียเครดิต)", f.claimOrder(false, false).join(","), "4");
  check("FINAL_VIDEO_FILENAME", f.FINAL_VIDEO_FILENAME, "r3-final.mp4");

  const s = f.summarizeQueue([
    { status: "queued_r1" }, { status: "running_r2" }, { status: "review_r1" },
    { status: "review_r2" }, { status: "done" }, { status: "failed" }, { status: "skipped" },
    { status: "awaiting_prompt" }, { status: "queued_r3" }, { status: "running_r3" }, { status: "review_r3" },
    { status: "queued_upscale" }, { status: "running_upscale" },
  ]);
  check("summarize waitingBot (queued+running+awaiting_prompt+upscale)", s.waitingBot, 7);
  check("summarize waitingUser (review_* รวมดูคลิป)", s.waitingUser, 3);
  check("summarize done", s.done, 1);
  check("summarize failed", s.failed, 1);
  check("queueCategory skipped = null", f.queueCategory("skipped"), null);
  check("queueCategory awaiting_prompt = waitingBot", f.queueCategory("awaiting_prompt"), "waitingBot");
  check("STATUS_LABELS ครบทุกสถานะ", Object.values(f.FLOW_STATUS).every((st) => typeof f.STATUS_LABELS[st] === "string"), true);
  check("STEP_LABELS has wait-render", typeof f.STEP_LABELS["wait-render"], "string");

  // ---------- Range ของ /api/uploads (ให้ <video> เลื่อนได้) ----------
  const rg = (h, size = 1000) => JSON.stringify(r.parseByteRange(h, size));
  check("ไม่มี Range = ทั้งไฟล์", rg(null), "null");
  check("bytes=0- = ทั้งไฟล์แบบ 206", rg("bytes=0-"), JSON.stringify({ start: 0, end: 999 }));
  check("bytes=100-199", rg("bytes=100-199"), JSON.stringify({ start: 100, end: 199 }));
  check("end เกินไฟล์ = ตัดที่ท้ายไฟล์", rg("bytes=900-5000"), JSON.stringify({ start: 900, end: 999 }));
  check("bytes=-100 = 100 ไบต์สุดท้าย", rg("bytes=-100"), JSON.stringify({ start: 900, end: 999 }));
  check("start เลยท้ายไฟล์ = 416", rg("bytes=1000-"), JSON.stringify("unsatisfiable"));
  check("หลายช่วง = ไม่รองรับ ตอบทั้งไฟล์", rg("bytes=0-1,5-9"), "null");
  check("end < start = อ่านไม่ออก ตอบทั้งไฟล์", rg("bytes=500-100"), "null");

  const now = new Date("2026-09-06T10:00:00Z");
  check("worker alive within 3× heartbeat", f.isWorkerAlive(new Date("2026-09-06T09:59:20Z"), now, 30000), true);
  check("worker dead after 3× heartbeat", f.isWorkerAlive(new Date("2026-09-06T09:58:00Z"), now, 30000), false);
  check("worker dead when never seen", f.isWorkerAlive(null, now, 30000), false);
  check("STEP_LABELS has click-generate", typeof f.STEP_LABELS["click-generate"], "string");
  const fm = f.friendlyJobMessage;
  check("friendly: ว่าง", JSON.stringify(fm("done", "")), JSON.stringify({ summary: "", detail: null }));
  check("friendly: ได้ 720p", fm("done", "ได้ 720p (โหลด 1080p ไม่ได้: locator.focus: Timeout 8000ms exceeded. Call log: x)").summary, "ได้คลิป 720p — โหลด 1080p ไม่สำเร็จ");
  check("friendly: ได้ 720p เก็บข้อความเต็มใน detail", fm("done", "ได้ 720p (abc)").detail, "ได้ 720p (abc)");
  check("friendly: failed + ข้อความดิบ → พับ", fm("failed", "locator.click: Timeout 8000ms exceeded.\nCall log:\n - waiting").detail !== null, true);
  check("friendly: ข้อความสั้นอ่านรู้เรื่อง ไม่พับ", JSON.stringify(fm("failed", "โหลดไม่ครบ")), JSON.stringify({ summary: "โหลดไม่ครบ", detail: null }));
  check("DEFAULT_CAPTIONS round 1", f.DEFAULT_CAPTIONS[1], "สินค้า พื้นหลังขาว");
} finally {
  rmSync(out, { recursive: true, force: true });
}
if (failed > 0) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log("\nall checks passed");
