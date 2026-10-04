/**
 * ตรวจวงจรชีวิตของงานคิว Flow (lib/flow-lifecycle.ts) — แผนของทุกจังหวะต้องเขียนลง FlowJob เหมือนโค้ดเดิมที่เคยกระจาย
 * อยู่ใน app/actions.ts กับ worker/index.ts ทุกช่อง (ค่าที่คาดไว้ข้างล่างคัดจากโค้ดเดิมก่อนย้าย 2026-10-02)
 * รัน: node scripts/check-flow-lifecycle.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const out = mkdtempSync(join(process.cwd(), ".check-flow-tmp-"));
let failed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`      ได้ ${a}\n      ควรได้ ${e}`);
}
function checkThrows(name, fn, includes) {
  let msg = null;
  try { fn(); } catch (e) { msg = e instanceof Error ? e.message : String(e); }
  const ok = msg !== null && msg.includes(includes);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`      ได้ ${JSON.stringify(msg)} ควรมีคำว่า ${JSON.stringify(includes)}`);
}

try {
  try {
    execFileSync(
      "npx",
      ["tsc", "lib/flow-lifecycle.ts", "lib/flow-jobs.ts", "--outDir", out, "--module", "es2022", "--target", "ES2017", "--moduleResolution", "bundler"],
      { stdio: "pipe", shell: true },
    );
  } catch (e) {
    // ไม่ได้ส่ง paths mapping ให้ tsc — "@/lib/flow-jobs" หาไม่เจอ (TS2307) โดยตั้งใจ แต่ยัง emit .js ให้ (exit 2)
    // แบบเดียวกับ check-recommender.mjs · type error จริงจับด้วย npx tsc --noEmit ของทั้งโปรเจกต์
    const diag = String(e.stdout ?? "");
    if (e.status !== 2 || diag.split("\n").some((l) => l.includes("error TS") && !l.includes("TS2307"))) {
      console.log(diag);
      throw e;
    }
  }
  const lcPath = join(out, "flow-lifecycle.js");
  writeFileSync(lcPath, readFileSync(lcPath, "utf8").replace(/["']@\/lib\/([\w-]+)["']/g, '"./$1.js"'));
  const L = await import(pathToFileURL(lcPath).href);

  const now = new Date("2026-10-02T12:00:00Z");
  const cleared = { failedStep: "", errorKind: "", errorMessage: "", failureDir: "" };

  // ---------- ผู้ใช้ ----------
  check("enqueue: งานใหม่รอบ 1 + extraPrompt ผ่าน normalize + แถวรูปต้นทาง",
    L.enqueue("  เอาแค่\nแผ่นเดียว ", [{ filename: "source-0.jpg", mimeType: "image/jpeg" }, { filename: "source-1.png", mimeType: "image/png" }]),
    {
      job: { status: "queued_r1", round: 1, attempt: 1, extraPrompt: "เอาแค่ แผ่นเดียว" },
      sourceRows: [
        { kind: "source", round: 0, attempt: 1, index: 0, filename: "source-0.jpg", mimeType: "image/jpeg" },
        { kind: "source", round: 0, attempt: 1, index: 1, filename: "source-1.png", mimeType: "image/png" },
      ],
    });
  check("enqueue: ไม่มีข้อความเพิ่มเติม = ''", L.enqueue(undefined, []).job.extraPrompt, "");

  const img = (round, attempt = 1) => ({ id: "img1", kind: "candidate", round, attempt });
  const on = () => true;
  const off = () => false;
  {
    const p = L.choose({ status: "review_r1", round: 1, attempt: 2 }, img(1, 2), on, now);
    check("choose รอบ 1 → queued_r2 รอบ 2 attempt 1 ล้าง extraPrompt", p.job, { status: "queued_r2", round: 2, attempt: 1, extraPrompt: "" });
    check("choose รอบ 1 → ตั้ง chosen ของรอบ 1 · ไม่ก๊อป ProductImage", [p.next, p.markChosen, p.copyToProductImages, p.unpauseWorker ?? false, p.deleteVideoRows ?? false],
      ["queued_r2", { round: 1, imageId: "img1" }, false, false, false]);
    check("choose รอบ 1 + ปิด Render ยังไปรอบ 2 ตามปกติ", L.choose({ status: "review_r1", round: 1, attempt: 1 }, img(1), off, now).next, "queued_r2");
  }
  {
    const p = L.choose({ status: "review_r2", round: 2, attempt: 1 }, img(2), on, now);
    check("choose รอบ 2 → awaiting_prompt รอบ 3 ล้าง extraPrompt (ยังไม่จบ ต้อง Render ก่อน)", p.job, { status: "awaiting_prompt", round: 3, attempt: 1, extraPrompt: "" });
    check("choose รอบ 2 → ก๊อป 2 รูปเป็น ProductImage", [p.next, p.copyToProductImages, p.markChosen], ["awaiting_prompt", true, { round: 2, imageId: "img1" }]);
    const d = L.choose({ status: "review_r2", round: 2, attempt: 1 }, img(2), off, now);
    check("choose รอบ 2 + ปิด Render อัตโนมัติ → done (ผู้ใช้ทำคลิปเอง) ไม่แตะ round/extraPrompt", d.job, { status: "done", finishedAt: now });
    check("choose คืนรูปที่เลือก (ใช้ต่อใน action)", d.image.id, "img1");
  }
  checkThrows("choose รูปผิดรอบ", () => L.choose({ status: "review_r2", round: 2, attempt: 1 }, img(1), on, now), "รูปที่เลือกไม่ใช่ของรอบปัจจุบัน");
  checkThrows("choose รูปผิด attempt", () => L.choose({ status: "review_r1", round: 1, attempt: 2 }, img(1, 1), on, now), "รูปที่เลือกไม่ใช่ของรอบปัจจุบัน");
  checkThrows("choose ไม่เจอรูป", () => L.choose({ status: "review_r1", round: 1, attempt: 1 }, undefined, on, now), "รูปที่เลือกไม่ใช่ของรอบปัจจุบัน");
  checkThrows("choose ตรวจรูปก่อนอ่าน config (ลำดับ error เดิม)",
    () => L.choose({ status: "review_r1", round: 1, attempt: 1 }, undefined, () => { throw new Error("config พัง"); }, now), "รูปที่เลือกไม่ใช่ของรอบปัจจุบัน");
  checkThrows("choose อ่าน config ก่อนตรวจสถานะ (ลำดับ error เดิม)",
    () => L.choose({ status: "queued_r1", round: 1, attempt: 1 }, img(1), () => { throw new Error("config พัง"); }, now), "config พัง");
  checkThrows("choose queued_r1 throws", () => L.choose({ status: "queued_r1", round: 1, attempt: 1 }, img(1), on, now), "งานนี้ไม่ได้อยู่ในขั้นรอเลือกรูป");
  checkThrows("choose review_r3 throws (คลิปไม่มีให้เลือก)", () => L.choose({ status: "review_r3", round: 3, attempt: 1 }, { ...img(3) }, on, now), "งานนี้ไม่ได้อยู่ในขั้นรอเลือกรูป");

  check("promptReady: awaiting_prompt → queued_r3", L.promptReady(), { where: { status: "awaiting_prompt" }, job: { status: "queued_r3" } });

  {
    const job = (status, extraPrompt = "เดิม") => ({ status, attempt: 2, extraPrompt });
    check("redo review_r1 ไม่ส่งข้อความ → queued_r1 attempt+1 ไม่แตะ extraPrompt", L.redo(job("review_r1"), undefined).job, { status: "queued_r1", attempt: 3 });
    check("redo review_r1 ไม่ส่งข้อความ → log ใช้ค่าเดิม", L.redo(job("review_r1"), undefined).extraPrompt, "เดิม");
    check("redo review_r2 ส่ง '' = กลับพรอมต์ตั้งต้น", L.redo(job("review_r2"), "").job, { status: "queued_r2", attempt: 3, extraPrompt: "" });
    const r = L.redo(job("review_r3"), " ห้าม\nมีคน ");
    check("redo review_r3 (เรนเดอร์ใหม่) → queued_r3 + normalize ข้อความ", r.job, { status: "queued_r3", attempt: 3, extraPrompt: "ห้าม มีคน" });
    check("redo review_r3 ลบแถวคลิปตัวอย่าง · รูป candidate ไม่ลบ", [r.deleteVideoRows, r.isRender, L.redo(job("review_r1"), undefined).deleteVideoRows], [true, true, false]);
    checkThrows("redo done throws", () => L.redo(job("done"), undefined), "ทำใหม่ได้เฉพาะงานที่รอคุณเลือกรูป/ดูคลิป");
    checkThrows("redo awaiting_prompt throws", () => L.redo(job("awaiting_prompt"), undefined), "ทำใหม่ได้เฉพาะงานที่รอคุณเลือกรูป/ดูคลิป");
  }

  check("approveRender review_r3 + มีคลิป → queued_upscale round 4 (ยังไม่ done จนได้ 1080p)", L.approveRender({ status: "review_r3" }, true), { job: { status: "queued_upscale", round: 4 } });
  checkThrows("approveRender review_r2 throws (ตรวจสถานะก่อนไฟล์)", () => L.approveRender({ status: "review_r2" }, false), "งานนี้ไม่ได้อยู่ในขั้นรอดูคลิป");
  checkThrows("approveRender running_r3 throws", () => L.approveRender({ status: "running_r3" }, true), "งานนี้ไม่ได้อยู่ในขั้นรอดูคลิป");
  checkThrows("approveRender ไม่มีไฟล์คลิป throws", () => L.approveRender({ status: "review_r3" }, false), "ยังไม่มีไฟล์คลิป");
  check("canApproveRender review_r3 + มีไฟล์ → true", L.canApproveRender("review_r3", true), true);
  check("canApproveRender review_r3 + ไม่มีไฟล์ (โหลดไม่ได้) → false", L.canApproveRender("review_r3", false), false);
  check("canApproveRender สถานะอื่น → false", L.canApproveRender("review_r2", true), false);

  const v720 = { filename: "r3-a1.mp4", chosen: false };
  check("canRetryUpscale done + 720p + มีโปรเจกต์ → true", L.canRetryUpscale("done", v720, "proj"), true);
  check("canRetryUpscale ได้ 1080p แล้ว → false", L.canRetryUpscale("done", { filename: "r3-final.mp4", chosen: true }, "proj"), false);
  check("canRetryUpscale ไม่มีคลิป → false", L.canRetryUpscale("done", null, "proj"), false);
  check("canRetryUpscale ไม่รู้โปรเจกต์ → false", L.canRetryUpscale("done", v720, ""), false);
  check("canRetryUpscale ยังไม่จบ → false", L.canRetryUpscale("review_r3", v720, "proj"), false);
  check("retryUpscale → queued_upscale round 4 ล้าง finishedAt + ร่องรอยพัง",
    L.retryUpscale({ status: "done", flowProjectId: "proj" }, v720), { job: { status: "queued_upscale", round: 4, finishedAt: null, ...cleared } });
  checkThrows("retryUpscale ได้ 1080p แล้ว throws", () => L.retryUpscale({ status: "done", flowProjectId: "proj" }, { filename: "r3-final.mp4", chosen: true }), "ลองโหลด 1080p ใหม่ไม่ได้");

  check("resume รอบ 2 → queued_r2 ล้างร่องรอยพัง + ปลดการหยุด", L.resume({ status: "failed", round: 2 }), { job: { status: "queued_r2", ...cleared }, unpauseWorker: true });
  check("resume รอบ 3 → queued_r3 (งาน Render ที่พังกลับเข้าคิว Render)", L.resume({ status: "failed", round: 3 }).job.status, "queued_r3");
  check("resume รอบ 4 → queued_upscale (โหลด 1080p ที่พังไม่ Render ใหม่)", L.resume({ status: "failed", round: 4 }).job.status, "queued_upscale");
  check("resume round แปลก → รอบ 1 (toJobRound)", L.resume({ status: "failed", round: 0 }).job.status, "queued_r1");
  checkThrows("resume งานที่ไม่ได้พัง throws", () => L.resume({ status: "review_r1", round: 1 }), "รันต่อได้เฉพาะงานที่พัง");

  check("skip งานค้าง → skipped + ปลดการหยุด (แม้ไม่ได้พัง)", L.skip({ status: "review_r1" }, now), { job: { status: "skipped", finishedAt: now }, unpauseWorker: true });
  check("skip งานที่จบแล้ว → null (ไม่ทำอะไร)", [L.skip({ status: "done" }, now), L.skip({ status: "skipped" }, now)], [null, null]);

  // ทำต่อเอง (takeOver) แทน finishManually — ได้ทุกสถานะเปิดที่บอทไม่ได้กำลังทำอยู่ · งานพัง = ปลดการหยุด
  const TAKE = ["queued_r1", "review_r1", "queued_r2", "review_r2", "awaiting_prompt", "queued_r3", "review_r3", "queued_upscale", "failed"];
  const ALL_STATUSES = [...TAKE, "running_r1", "running_r2", "running_r3", "running_upscale", "done", "skipped"];
  const NOT_TAKE = ["running_r1", "running_r2", "running_r3", "running_upscale", "done", "skipped"];
  check("canTakeOver: ทุกสถานะเปิดที่ไม่ใช่ running ได้", TAKE.map((s) => L.canTakeOver(s)), TAKE.map(() => true));
  check("canTakeOver: running_* / done / skipped ไม่ได้", NOT_TAKE.map((s) => L.canTakeOver(s)), NOT_TAKE.map(() => false));
  check("TAKEOVER_STATUSES = รายการเดียวกับ gate (adapter ใช้เป็น where กันแข่งกับบอท)", [...L.TAKEOVER_STATUSES].sort(), [...TAKE].sort());
  for (const s of TAKE.filter((x) => x !== "failed")) {
    check(`takeOver ${s} → done + finishedAt ไม่แตะการหยุด`, L.takeOver({ status: s }, now), { job: { status: "done", finishedAt: now }, unpauseWorker: false });
  }
  for (const round of [1, 2, 3, 4]) {
    check(`takeOver failed รอบ ${round} → done + ปลดการหยุด (เหมือนข้าม)`, L.takeOver({ status: "failed", round }, now), { job: { status: "done", finishedAt: now }, unpauseWorker: true });
  }
  check("takeOver แตะแค่ status/finishedAt (ไม่ล้างร่องรอยพัง ไม่แตะ round)", Object.keys(L.takeOver({ status: "failed" }, now).job).sort(), ["finishedAt", "status"]);
  for (const s of ["running_r1", "running_r2", "running_r3", "running_upscale"]) {
    checkThrows(`takeOver ${s} throws (บอทกำลังทำ)`, () => L.takeOver({ status: s }, now), "บอทเพิ่งเริ่มทำงานนี้");
  }
  for (const s of ["done", "skipped"]) checkThrows(`takeOver ${s} throws (จบแล้ว)`, () => L.takeOver({ status: s }, now), "งานนี้จบแล้ว");
  // สถานะที่ทำต่อเองได้มาจากที่เดียว: ตัวช่วยของหน้าจอ + ข้อความปฏิเสธเป็นค่าคงที่เดียว (review fix)
  check("isBotWorking: เฉพาะ running_*", ["running_r1", "running_r2", "running_r3", "running_upscale", "queued_r1", "failed", "done"].map((s) => L.isBotWorking(s)), [true, true, true, true, false, false, false]);
  check("isWaitingForBot: เฉพาะ queued_*", ["queued_r1", "queued_r2", "queued_r3", "queued_upscale", "running_r1", "awaiting_prompt", "failed"].map((s) => L.isWaitingForBot(s)), [true, true, true, true, false, false, false]);
  check("TAKEOVER_STATUSES = ทุกสถานะเปิดที่ไม่ใช่ running (ไม่มีรายการเขียนซ้ำ)", [...L.TAKEOVER_STATUSES].sort(), ALL_STATUSES.filter((x) => x !== "done" && x !== "skipped" && !L.isBotWorking(x)).sort());
  check("ข้อความปฏิเสธบอทกำลังทำ = ค่าคงที่เดียว", typeof L.TAKEOVER_BOT_BUSY_MESSAGE === "string" && L.TAKEOVER_BOT_BUSY_MESSAGE.includes("บอทเพิ่งเริ่มทำงานนี้"), true);
  checkThrows("takeOver running_* ใช้ค่าคงที่นั้น", () => L.takeOver({ status: "running_r3" }, now), L.TAKEOVER_BOT_BUSY_MESSAGE ?? "undefined-constant");
  check("isInRenderStage: awaiting_prompt/queued_r3/review_r3/failed≥3 ใช่ · running_r3/failed รอบ 2/review_r2 ไม่",
    [["awaiting_prompt", 3], ["queued_r3", 3], ["review_r3", 3], ["failed", 3], ["failed", 4], ["running_r3", 3], ["failed", 2], ["review_r2", 2]].map(([s, r]) => L.isInRenderStage(s, r)),
    [true, true, true, true, true, false, false, false]);

  // แก้ 10-part prompt ที่ /flow (ticket 03): gate ต่อสถานะ — queued_r3 / review_r3 / failed รอบ 3 แก้ได้ · running_r3 อ่านอย่างเดียว
  // (action ยังบันทึกให้ + บอกว่ารอบนี้ใช้ของเดิม) · สถานะอื่นปฏิเสธ
  const GATE_CASES = [
    ["queued_r3", 3, "ok"], ["review_r3", 3, "ok"], ["failed", 3, "ok"],
    ["running_r3", 3, "bot_running"],
    ["failed", 4, "refused"], ["failed", 2, "refused"], ["failed", 1, "refused"],
    ["awaiting_prompt", 3, "refused"], ["queued_r1", 1, "refused"], ["review_r2", 2, "refused"], ["running_r1", 1, "refused"],
    ["queued_upscale", 4, "refused"], ["running_upscale", 4, "refused"], ["done", 4, "refused"], ["skipped", 3, "refused"],
  ];
  check("promptSaveGate ต่อสถานะ/รอบ", GATE_CASES.map(([s, r]) => L.promptSaveGate(s, r)), GATE_CASES.map(([, , want]) => want));
  check("canRerenderWithPrompt: เฉพาะ review_r3", ["queued_r3", "review_r3", "failed", "running_r3", "done"].map((s) => L.canRerenderWithPrompt(s)), [false, true, false, false, false]);
  check("PROMPT_BOT_RUNNING_MESSAGE บอกว่ารอบนี้ใช้พรอมต์เดิม", typeof L.PROMPT_BOT_RUNNING_MESSAGE === "string" && L.PROMPT_BOT_RUNNING_MESSAGE.includes("พรอมต์เดิม"), true);
  check("checkPromptText: ว่าง/ช่องว่างล้วน = ข้อความผิดพลาด · มีเนื้อหา = null", [L.checkPromptText(""), L.checkPromptText("  " + String.fromCharCode(10) + " "), L.checkPromptText("1) A")].map((m) => m === null ? null : "err"), ["err", "err", null]);
  const NL = String.fromCharCode(10);
  check("normalizePromptText: ตัดช่องว่างหัวท้าย (เหมือนหน้า entry) คงบรรทัดกลางไว้", L.normalizePromptText("  a" + NL + NL + "b " + NL), "a" + NL + NL + "b");

  // ---------- เปลี่ยนรูปต้นทาง (ticket 05) ----------
  // gate: ตั้งแต่รอเลือกรูปรอบ 1 จนก่อนเริ่มเรนเดอร์ · งานพัง/ถูกข้ามรอบ 1–2 · ไม่ใช่ตอนบอททำอยู่ · ไม่ใช่หลังเริ่มเรนเดอร์
  const CHANGE_CASES = [
    ["queued_r1", 1, true], ["review_r1", 1, true], ["queued_r2", 2, true], ["review_r2", 2, true],
    ["awaiting_prompt", 3, true], ["queued_r3", 3, true],
    ["failed", 1, true], ["failed", 2, true], ["skipped", 1, true], ["skipped", 2, true],
    ["running_r1", 1, false], ["running_r2", 2, false], ["running_r3", 3, false], ["running_upscale", 4, false],
    ["review_r3", 3, false], ["queued_upscale", 4, false], ["done", 2, false], ["done", 4, false],
    ["failed", 3, false], ["failed", 4, false], ["skipped", 3, false], ["skipped", 4, false],
  ];
  check("canChangeSource ต่อสถานะ/รอบ", CHANGE_CASES.map(([s, r]) => L.canChangeSource(s, r)), CHANGE_CASES.map(([, , want]) => want));
  {
    const imgs = [
      { kind: "source", round: 0, attempt: 1 },
      { kind: "candidate", round: 1, attempt: 1 }, { kind: "candidate", round: 1, attempt: 3 },
      { kind: "candidate", round: 2, attempt: 2 },
    ];
    const job = { status: "review_r2", round: 2, attempt: 2, images: imgs };
    const p = L.changeSource(job, { extraPrompt: undefined, mimeType: "image/jpeg", nonce: "n1" });
    // attempt ใหม่ต้องเกินทุก attempt ที่เคยใช้ (รอบ 1 เคยไปถึง a3) — ไม่งั้นรูปรอบ 1 ชุดใหม่ (r1-a<n>) เขียนทับของเก่า
    check("changeSource: attempt = 1 + attempt สูงสุดที่เคยใช้ (งานหรือแถวรูป)", p.attempt, 4);
    check("changeSource: งานกลับไปรอวาดรอบ 1 · ล้างร่องรอยพัง · ล้าง finishedAt · extraPrompt ว่างเป็นค่าตั้งต้น",
      p.job, { status: "queued_r1", round: 1, attempt: 4, extraPrompt: "", finishedAt: null, ...cleared });
    check("changeSource: แถวรูปต้นทางใหม่ (attempt ใหม่ ชื่อไฟล์ไม่ซ้ำต่อ attempt)", p.createImages,
      [{ kind: "source", round: 0, attempt: 4, index: 0, filename: "source-a4-0-n1.jpg", mimeType: "image/jpeg" }]);
    check("changeSource: ล้าง chosen ทุกรูป · ไม่ลบแถวรูป/คลิป · ไม่ปลดการหยุด (งานไม่ได้พัง)",
      [p.clearChosen, p.deleteVideoRows ?? false, p.markChosen ?? null, p.unpauseWorker], [true, false, null, false]);
    check("changeSource: คืน fromStatus/round/attempt เดิม (สำหรับ FlowActivity)", [p.fromStatus, p.fromRound, p.fromAttempt], ["review_r2", 2, 2]);
    check("changeSource: extraPrompt จาก input ผ่าน normalize",
      L.changeSource(job, { extraPrompt: "  เอาแค่\nแผ่นเดียว ", mimeType: "image/png", nonce: "x" }).job.extraPrompt, "เอาแค่ แผ่นเดียว");
    check("changeSource: png → .png", L.changeSource(job, { extraPrompt: "", mimeType: "image/png", nonce: "x" }).createImages[0].filename, "source-a4-0-x.png");
    check("changeSource: webp → .webp", L.changeSource(job, { extraPrompt: "", mimeType: "image/webp", nonce: "x" }).createImages[0].filename, "source-a4-0-x.webp");
    check("changeSource งานพัง → ปลดการหยุด (เหมือนข้าม/ทำต่อเอง)",
      L.changeSource({ status: "failed", round: 1, attempt: 1, images: [] }, { extraPrompt: "", mimeType: "image/jpeg", nonce: "x" }).unpauseWorker, true);
    check("changeSource งานถูกข้าม → ไม่ปลดการหยุด",
      L.changeSource({ status: "skipped", round: 2, attempt: 1, images: [] }, { extraPrompt: "", mimeType: "image/jpeg", nonce: "x" }).unpauseWorker, false);
    check("changeSource awaiting_prompt (round 3 attempt 1) → attempt ข้ามของรอบ 1–2 ที่เคยใช้",
      L.changeSource({ status: "awaiting_prompt", round: 3, attempt: 1, images: imgs }, { extraPrompt: "", mimeType: "image/jpeg", nonce: "x" }).attempt, 4);
    for (const s of ["running_r1", "running_r2", "running_r3"]) {
      checkThrows(`changeSource ${s} throws (บอทกำลังทำ)`, () => L.changeSource({ status: s, round: 1, attempt: 1, images: [] }, { extraPrompt: "", mimeType: "image/jpeg", nonce: "x" }), L.CHANGE_SOURCE_BOT_BUSY_MESSAGE ?? "undefined-constant");
    }
    for (const [s, r] of [["review_r3", 3], ["done", 2], ["failed", 3], ["queued_upscale", 4]]) {
      checkThrows(`changeSource ${s} r${r} throws (เริ่มเรนเดอร์แล้ว/จบแล้ว)`, () => L.changeSource({ status: s, round: r, attempt: 1, images: [] }, { extraPrompt: "", mimeType: "image/jpeg", nonce: "x" }), L.CHANGE_SOURCE_REFUSED_MESSAGE ?? "undefined-constant");
    }
  }
  // เลือกรูปรอบ 1 หลังเปลี่ยนรูปต้นทาง: รอบ 2 ต้องนับ attempt ต่อจากชุดรอบ 2 เก่า (ไม่เริ่ม a1 ใหม่จนเขียนทับ r2-a1-*)
  {
    const imgs = [{ kind: "candidate", round: 2, attempt: 1 }, { kind: "candidate", round: 2, attempt: 3 }, { kind: "candidate", round: 1, attempt: 9 }];
    check("choose รอบ 1 หลังเปลี่ยนรูปต้นทาง → รอบ 2 attempt ต่อจากชุดรอบ 2 เดิม",
      L.choose({ status: "review_r1", round: 1, attempt: 4, images: imgs }, img(1, 4), on, now).job.attempt, 4);
    check("choose รอบ 1 งานใหม่ (ไม่มีรอบ 2 เก่า) → attempt 1 เหมือนเดิม",
      L.choose({ status: "review_r1", round: 1, attempt: 3, images: [{ kind: "candidate", round: 1, attempt: 3 }] }, img(1, 3), on, now).job.attempt, 1);
  }

  // ---------- บอท ----------
  check("claim รอบ 2 → running_r2 + startedAt + ล้างร่องรอยพัง (where กันหยิบซ้ำ)", L.claim(2, now),
    { where: { status: "queued_r2" }, job: { status: "running_r2", startedAt: now, ...cleared } });
  check("claim รอบ 4 → running_upscale", L.claim(4, now).job.status, "running_upscale");
  check("claimCrashed → failed/unknown/worker_crash ตัด 2000 · ไม่แตะ failureDir", L.claimCrashed("x".repeat(3000)),
    { job: { status: "failed", failedStep: "unknown", errorKind: "worker_crash", errorMessage: "x".repeat(2000) } });

  check("imagesReady รอบ 2: แถว candidate (jpg = jpg นอกนั้น png) + review_r2 + project",
    L.imagesReady(2, { attempt: 2, extraPrompt: "บนโต๊ะ" }, ["png", "jpg", ""], "proj"),
    {
      createImages: [
        { kind: "candidate", round: 2, attempt: 2, index: 0, filename: "r2-a2-0.png", mimeType: "image/png", promptExtra: "บนโต๊ะ" },
        { kind: "candidate", round: 2, attempt: 2, index: 1, filename: "r2-a2-1.jpg", mimeType: "image/jpeg", promptExtra: "บนโต๊ะ" },
        { kind: "candidate", round: 2, attempt: 2, index: 2, filename: "r2-a2-2.png", mimeType: "image/png", promptExtra: "บนโต๊ะ" },
      ],
      job: { status: "review_r2", flowProjectId: "proj" },
    });

  // หลัง Render: ต้องเป็น review_r3 เสมอ ไม่มีทาง failed (เครดิตจ่ายแล้ว คลิปอยู่ในโปรเจกต์) — เดิม renderOutcome ใน worker/flow-signals.ts
  {
    const job = { attempt: 1, extraPrompt: "ห้ามมีคน" };
    check("previewReady ได้ไฟล์ → แทนที่แถวคลิปด้วย r3-a1.mp4 + review_r3 ไม่มี errorMessage",
      L.previewReady({ gotFile: true, downloadFailed: null, job, mediaId: "uuid-1", projectId: "proj" }),
      {
        deleteVideoRows: true,
        createImages: [{ kind: "video", round: 3, attempt: 1, index: 0, filename: "r3-a1.mp4", mimeType: "video/mp4", promptExtra: "ห้ามมีคน", flowMediaId: "uuid-1" }],
        job: { status: "review_r3", flowProjectId: "proj", errorMessage: "" },
      });
    const noFile = L.previewReady({ gotFile: false, downloadFailed: "ลิงก์ตรง 403 · เมนูไม่เจอ", job: { attempt: 2, extraPrompt: "" }, mediaId: "", projectId: "proj" });
    check("previewReady ไม่ได้ไฟล์ → ยัง review_r3 ไม่มีแถวคลิป (ลบของเก่า) + errorMessage บอกว่าคลิปอยู่ใน Flow",
      [noFile.job.status, noFile.deleteVideoRows, noFile.createImages.length, noFile.job.errorMessage],
      ["review_r3", true, 0, "โหลดคลิปมาไม่ได้ (คลิปอยู่ในโปรเจกต์ Flow แล้ว): ลิงก์ตรง 403 · เมนูไม่เจอ"]);
    check("previewReady errorMessage ยาวเกิน 2000 ถูกตัด",
      L.previewReady({ gotFile: false, downloadFailed: "x".repeat(5000), job, mediaId: "", projectId: "p" }).job.errorMessage.length, 2000);
    check("previewReady attempt 3 → r3-a3.mp4", L.previewReady({ gotFile: true, downloadFailed: null, job: { attempt: 3, extraPrompt: "" }, mediaId: "", projectId: "p" }).createImages[0].filename, "r3-a3.mp4");
  }
  check("previewUnsaved → review_r3 + ข้อความเดิม", L.previewUnsaved(),
    { job: { status: "review_r3", errorMessage: "คลิปเสร็จแล้วแต่บันทึกลง DB ไม่ได้ — ดูไฟล์ในโฟลเดอร์ flow ของ entry หรือกดเรนเดอร์ใหม่" } });
  check("finalClipSaved → แถวคลิปเป็น Final clip + done ล้างหมายเหตุ 720p", L.finalClipSaved("vid1", now),
    { finalizeVideoRowId: "vid1", job: { status: "done", finishedAt: now, errorMessage: "" } });
  check("finalClipUnsaved → done + ข้อความเดิม", L.finalClipUnsaved(now),
    { job: { status: "done", finishedAt: now, errorMessage: "ได้ไฟล์ 1080p แต่บันทึกลง DB ไม่ได้ — ดู r3-final.mp4 ในโฟลเดอร์ flow ของ entry" } });
  check("finalClipMissing → done + ข้อความ 720p เดิมทุกตัวอักษร", L.finalClipMissing("เมนูไม่เจอ", now),
    { job: { status: "done", finishedAt: now, errorMessage: "ได้ 720p (โหลด 1080p ไม่ได้: เมนูไม่เจอ)" } });
  check("finalClipMissing ไม่มีเหตุผล", L.finalClipMissing(null, now).job.errorMessage, "ได้ 720p (โหลด 1080p ไม่ได้: )");

  {
    const base = { step: "find-video", message: "หาไม่เจอ", failureDir: "uploads/_flow-failures/j-1", now };
    check("roundFailed รอบ 4 มีคลิป + flow_error → done ด้วย 720p ไม่หยุดคิว",
      L.roundFailed({ ...base, round: 4, hasVideoRow: true, kind: "flow_error" }),
      { plan: { job: { status: "done", finishedAt: now, failureDir: base.failureDir, errorMessage: "ได้ 720p (โหลด 1080p ไม่ได้ที่ขั้น find-video: หาไม่เจอ)" } }, pause: null });
    const failedPlan = (kind) => ({ plan: { job: { status: "failed", failedStep: "find-video", errorKind: kind, errorMessage: "หาไม่เจอ", failureDir: base.failureDir } }, pause: kind });
    check("roundFailed รอบ 4 captcha → failed + หยุดคิว (ป้องกันบัญชี)", L.roundFailed({ ...base, round: 4, hasVideoRow: true, kind: "captcha" }), failedPlan("captcha"));
    check("roundFailed รอบ 4 login_required → failed + หยุดคิว", L.roundFailed({ ...base, round: 4, hasVideoRow: true, kind: "login_required" }), failedPlan("login_required"));
    check("roundFailed รอบ 4 ไม่มีคลิป → failed + หยุดคิว", L.roundFailed({ ...base, round: 4, hasVideoRow: false, kind: "flow_error" }), failedPlan("flow_error"));
    check("roundFailed รอบ 3 → failed + หยุดคิว", L.roundFailed({ ...base, round: 3, hasVideoRow: true, kind: "selector_drift" }), failedPlan("selector_drift"));
    check("roundFailed skipPause: งานยัง failed เหมือนเดิมทุกช่อง แต่ pause = null",
      L.roundFailed({ ...base, round: 2, hasVideoRow: false, kind: "flow_error", skipPause: true }),
      { plan: failedPlan("flow_error").plan, pause: null });
    check("roundFailed skipPause=false/ไม่ใส่ = หยุดคิวเหมือนเดิม",
      [L.roundFailed({ ...base, round: 2, hasVideoRow: false, kind: "flow_error", skipPause: false }).pause, L.roundFailed({ ...base, round: 2, hasVideoRow: false, kind: "flow_error" }).pause],
      ["flow_error", "flow_error"]);
    check("roundFailed ข้อความยาวตัด 2000", L.roundFailed({ ...base, round: 1, hasVideoRow: false, kind: "worker_crash", message: "y".repeat(2500) }).plan.job.errorMessage.length, 2000);
  }

  // ---------- failurePolicy: ข้ามงานที่ Flow วาดไม่สำเร็จ ----------
  {
    const t = (h) => new Date(2026, 9, 3, h, 0);
    const ok = { kind: "flow_error", step: "wait-results", round: 1, autoContinuesToday: 0, lastAutoContinueAt: null, lastSuccessAt: t(9), cap: 2 };
    const P = (o) => L.failurePolicy({ ...ok, ...o });
    check("flow_error wait-results รอบ 1 → continue", P({}), "continue");
    check("flow_error wait-render รอบ 3 → continue", P({ step: "wait-render", round: 3 }), "continue");
    check("flow_error wait-results รอบ 2 → continue", P({ round: 2 }), "continue");
    for (const kind of ["captcha", "login_required", "selector_drift", "generation_timeout", "worker_crash", "download_failed", "host_unsupported", ""]) {
      check(`kind ${kind || "(ว่าง)"} ที่ wait-results → pause`, P({ kind }), "pause");
    }
    for (const step of ["click-generate", "attach-reference", "open-flow", "download", "find-video", "unknown", "wait-results ", ""]) {
      check(`flow_error ที่ขั้น ${step || "(ว่าง)"} → pause`, P({ step }), "pause");
    }
    check("รอบ 4 flow_error wait-results → pause (ของเดิม)", P({ round: 4 }), "pause");
    check("cap 0 = ปิดฟีเจอร์ → pause", P({ cap: 0 }), "pause");
    check("cap 1: ใช้ 0 ครั้ง → continue", P({ cap: 1, autoContinuesToday: 0 }), "continue");
    check("cap 1: ใช้ครบ 1 ครั้ง → pause", P({ cap: 1, autoContinuesToday: 1 }), "pause");
    check("cap 2: ใช้ 1 ครั้ง (ข้ามล่าสุดเก่ากว่างานสำเร็จ) → continue", P({ autoContinuesToday: 1, lastAutoContinueAt: t(8), lastSuccessAt: t(9) }), "continue");
    check("cap 2: ใช้ครบ 2 ครั้ง → pause", P({ autoContinuesToday: 2, lastAutoContinueAt: t(8), lastSuccessAt: t(9) }), "pause");
    check("ติดกัน: ข้ามล่าสุดใหม่กว่างานสำเร็จล่าสุด → pause", P({ autoContinuesToday: 1, lastAutoContinueAt: t(10), lastSuccessAt: t(9) }), "pause");
    check("ติดกัน: เวลาเท่ากันเป๊ะ ไม่ถือว่ามีงานสำเร็จคั่น → ไม่ใหม่กว่า → continue", P({ autoContinuesToday: 1, lastAutoContinueAt: t(9), lastSuccessAt: t(9) }), "continue");
    check("ข้ามเมื่อวานล่าสุด ยังไม่เคยสำเร็จหลังจากนั้น → pause", P({ lastAutoContinueAt: new Date(2026, 9, 2, 20, 0), lastSuccessAt: null }), "pause");
    check("ไม่เคยข้าม + ยังไม่เคยมีงานสำเร็จ → continue", P({ lastSuccessAt: null }), "continue");
    check("ข้ามเมื่อวาน (autoContinuesToday 0) แต่มีงานสำเร็จหลังจากนั้น → continue", P({ lastAutoContinueAt: new Date(2026, 9, 2, 20, 0), lastSuccessAt: t(9) }), "continue");
    check("isAutoContinueFailure ตรงกับนโยบาย", [L.isAutoContinueFailure("flow_error", "wait-render", 3), L.isAutoContinueFailure("flow_error", "wait-render", 4), L.isAutoContinueFailure("captcha", "wait-results", 1)], [true, false, false]);
    const failedJob = { status: "failed", round: 1, errorKind: "flow_error", failedStep: "wait-results" };
    check("botMovedOnNote: failed + คิวไม่หยุด → มีหมายเหตุ", typeof L.botMovedOnNote(failedJob, false), "string");
    check("botMovedOnNote: คิวหยุดอยู่ → ไม่มี", L.botMovedOnNote(failedJob, true), null);
    check("botMovedOnNote: kind อื่น → ไม่มี", L.botMovedOnNote({ ...failedJob, errorKind: "selector_drift" }, false), null);
    check("botMovedOnNote: งานไม่ failed → ไม่มี", L.botMovedOnNote({ ...failedJob, status: "queued_r1" }, false), null);
  }

  // ---------- เปิดบอท: กวาดงานค้าง ----------
  check("staleUpscale มีคลิป → done ด้วย 720p ข้อความเดิม", L.staleUpscale(true, now),
    { job: { status: "done", finishedAt: now, errorMessage: "ได้ 720p (บอทปิดกลางทางตอนโหลด 1080p — กด ลองโหลด 1080p อีกครั้ง ได้)" } });
  check("staleUpscale ไม่มีคลิป → null (ปล่อยให้ staleRunning ตีเป็น failed)", L.staleUpscale(false, now), null);
  {
    const started = new Date("2026-10-02T10:00:00Z");
    const after = new Date("2026-10-02T10:03:00Z");
    const before = new Date("2026-10-02T09:00:00Z");
    check("กดสร้างแล้วหลังเริ่มงาน → review", L.staleRenderRecovery(started, [after]), "review");
    check("กดสร้างตรงเวลาเริ่มพอดี → review", L.staleRenderRecovery(started, [started]), "review");
    check("ยังไม่ได้กดสร้าง → failed (หยุดคิวเหมือนเดิม)", L.staleRenderRecovery(started, []), "failed");
    check("generate_video ของ attempt ก่อน (ก่อน startedAt) ไม่นับ → failed", L.staleRenderRecovery(started, [before]), "failed");
    check("ไม่มี startedAt → failed (ไม่เดา)", L.staleRenderRecovery(null, [after]), "failed");
    check("staleRender review → ลบแถวคลิปค้าง + review_r3 + STALE_RENDER_MESSAGE ไม่หยุดคิว", L.staleRender(started, [after]),
      { deleteVideoRows: true, job: { status: "review_r3", errorMessage: L.STALE_RENDER_MESSAGE } });
    check("staleRender failed → null", L.staleRender(started, []), null);
    check("ข้อความบอกว่าคลิปน่าจะอยู่ใน Flow และเรนเดอร์ใหม่เสีย 15 เครดิต",
      L.STALE_RENDER_MESSAGE.includes("คลิปน่าจะอยู่ในโปรเจกต์ Flow แล้ว") && L.STALE_RENDER_MESSAGE.includes("15 เครดิต"), true);
    check("ข้อความนี้โชว์ตรงๆ ในหน้า /flow (ไม่ถูกพับเป็นข้อความเทคนิค)", L.friendlyJobMessage("review_r3", L.STALE_RENDER_MESSAGE).detail, null);
  }
  check("staleRunning → running_* ทั้ง 4 รอบเป็น failed + หยุดคิว worker_crash", L.staleRunning(), {
    where: { status: ["running_r1", "running_r2", "running_r3", "running_upscale"] },
    job: { status: "failed", failedStep: "unknown", errorKind: "worker_crash", errorMessage: "worker ตายกลางคันในรอบก่อน" },
    pause: "worker_crash",
  });
  check("loginRecovered → คืนงานที่พังเพราะ login เข้าคิวรอบเดิม ทีละรอบ 1-4", L.loginRecovered(), [1, 2, 3, 4].map((round) => ({
    where: { status: "failed", errorKind: "login_required", round },
    job: { status: ["queued_r1", "queued_r2", "queued_r3", "queued_upscale"][round - 1], ...cleared },
  })));

  // ---------- errorMessage "ได้ 720p" — คู่เขียน/อ่านคู่เดียว ----------
  check("previewOnlyMessage", L.previewOnlyMessage("abc"), "ได้ 720p (abc)");
  check("previewOnlyMessage ตัด 2000", L.previewOnlyMessage("z".repeat(3000)).length, 2000);
  check("isPreviewOnlyMessage อ่านสิ่งที่เขียน (มีช่องว่างนำหน้าก็ได้)", [L.isPreviewOnlyMessage(L.previewOnlyMessage("x")), L.isPreviewOnlyMessage("  ได้ 720p (x)"), L.isPreviewOnlyMessage("ได้ไฟล์ 1080p แต่บันทึก")], [true, true, false]);
  const fm = L.friendlyJobMessage;
  check("friendly: ว่าง", fm("done", ""), { summary: "", detail: null });
  check("friendly: ได้ 720p", fm("done", "ได้ 720p (โหลด 1080p ไม่ได้: locator.focus: Timeout 8000ms exceeded. Call log: x)").summary, "ได้คลิป 720p — โหลด 1080p ไม่สำเร็จ");
  check("friendly: ได้ 720p เก็บข้อความเต็มใน detail", fm("done", "ได้ 720p (abc)").detail, "ได้ 720p (abc)");
  check("friendly: ทุกข้อความ 720p ที่วงจรชีวิตเขียน → สรุปบรรทัดเดียว",
    [L.finalClipMissing("x", now), L.staleUpscale(true, now), L.roundFailed({ round: 4, hasVideoRow: true, step: "s", kind: "flow_error", message: "m", failureDir: "", now }).plan]
      .map((p) => fm("done", p.job.errorMessage).summary),
    ["ได้คลิป 720p — โหลด 1080p ไม่สำเร็จ", "ได้คลิป 720p — โหลด 1080p ไม่สำเร็จ", "ได้คลิป 720p — โหลด 1080p ไม่สำเร็จ"]);
  check("friendly: failed + ข้อความดิบ → พับ", fm("failed", "locator.click: Timeout 8000ms exceeded.\nCall log:\n - waiting").detail !== null, true);
  check("friendly: ข้อความสั้นอ่านรู้เรื่อง ไม่พับ", fm("failed", "โหลดไม่ครบ"), { summary: "โหลดไม่ครบ", detail: null });
} finally {
  rmSync(out, { recursive: true, force: true });
}

// ---------- ที่เดียวที่เขียน FlowJob: lib/flow-lifecycle-db.ts ----------
{
  const strip = (f) =>
    readFileSync(f, "utf8")
      .replace(/\r\n/g, "\n")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
      .join("\n");
  const callers = ["app/actions.ts", "worker/index.ts", "lib/flow-change-source.ts"];
  for (const f of callers) {
    const src = strip(f);
    const writes = src.match(/\b(flowJob|flowJobImage)\.(update|updateMany|create|createMany|delete|deleteMany|upsert)\(/g) ?? [];
    check(`${f} ไม่เขียน FlowJob/FlowJobImage เอง (ผ่าน lib/flow-lifecycle-db.ts)`, writes, []);
    check(`${f} ไม่ปลดการหยุดของบอทเอง (pausedReason: "")`, /pausedReason: ""/.test(src), false);
  }
  const sources = ["app/actions.ts", "worker/index.ts", "lib/flow-jobs.ts", "lib/flow-lifecycle-db.ts", "components/flow-job-detail.tsx", "components/flow-job-parts.tsx"];
  check("ข้อความ 'ได้ 720p' มีแค่ใน lib/flow-lifecycle.ts", sources.filter((f) => strip(f).includes("ได้ 720p")), []);
  const detail = strip("components/flow-job-detail.tsx");
  check("หน้า /flow ใช้ isInRenderStage/canTakeOver (ไม่มีรายการสถานะซ้ำ)", detail.includes("isInRenderStage(") && detail.includes("canTakeOver(") && !detail.includes("job.round >= 3"), true);
  check("หน้า /flow ไม่เช็กสถานะ running_/queued_ ด้วย string prefix เอง", /startsWith("(running_|queued_)")/.test(detail), false);
  check("ข้อความ 'บอทเพิ่งเริ่มทำงานนี้' มีแค่ใน lib/flow-lifecycle.ts", ["app/actions.ts", "components/flow-job-detail.tsx", "lib/flow-lifecycle-db.ts"].filter((f) => strip(f).includes("บอทเพิ่งเริ่มทำงานนี้")), []);
  const takeOverBody = (strip("app/actions.ts").match(/export async function takeOverFlowJob[^]*?\n}\n/) ?? [""])[0];
  check("takeOverFlowJob ใช้ takeOver + applyTakeOver (เขียนแบบมี where กันแข่งกับบอท)", takeOverBody.includes(" takeOver(") && takeOverBody.includes("applyTakeOver("), true);
  const saveBody = (strip("app/actions.ts").match(/export async function saveFlowPrompt[^]*?\n}\n/) ?? [""])[0];
  check("saveFlowPrompt ใช้ applyPromptSave (gate+เขียนใน transaction เดียว) และ log user_edit_prompt", saveBody.includes("applyPromptSave(") && saveBody.includes('"user_edit_prompt"') && saveBody.includes("rerender: r.rerendered"), true);
  check("หน้า /flow ใช้ promptSaveGate (ไม่เช็กสถานะแก้พรอมต์เอง)", detail.includes("promptSaveGate("), true);
  // ticket 05: เปลี่ยนรูปต้นทางมีทางเดียว (changeSourcePhoto → changeSource + applyChangeSource) ใช้ทั้ง /flow และ Showcase
  const csFlow = strip("lib/flow-change-source.ts");
  check("changeSourcePhoto ใช้ changeSource + applyChangeSource (where status กันแข่งกับบอท) + replaceAutoSourceImage",
    csFlow.includes("changeSource(job") && csFlow.includes("applyChangeSource(") && csFlow.includes("replaceAutoSourceImage("), true);
  const actionsSrc = strip("app/actions.ts");
  const logBody = (actionsSrc.match(/async function changeSourceAndLog[^]*?\n}\n/) ?? [""])[0];
  check("changeSourceAndLog เรียก changeSourcePhoto แล้ว log user_change_source { fromStatus, round, attempt }",
    logBody.includes("changeSourcePhoto(") && logBody.includes('"user_change_source"') && /fromStatus: r\.fromStatus,\s*round: r\.fromRound,\s*attempt: r\.fromAttempt/.test(logBody), true);
  const retryBody = (actionsSrc.match(/export async function retryShowcasePhoto[^]*?\n}\n/) ?? [""])[0];
  check("Showcase เลือกรูปใหม่: มีงาน = changeSourceAndLog (ไม่ข้ามงาน/ไม่สร้างงานใหม่) · ไม่มีงาน = enqueueFlowJobCore",
    retryBody.includes("changeSourceAndLog(latest.id") && retryBody.includes("latest === null") && !retryBody.includes("skipFlowJob("), true);
  const changeBody = (actionsSrc.match(/export async function changeFlowSource[^]*?\n}\n/) ?? [""])[0];
  check("changeFlowSource (หน้า /flow) ใช้ changeSourceAndLog", changeBody.includes("changeSourceAndLog("), true);
  check("หน้า /flow ใช้ canChangeSource (ไม่เช็กสถานะเปลี่ยนรูปเอง)", detail.includes("canChangeSource("), true);
  check("หน้า /flow โชว์รูปต้นทางปัจจุบันด้วย currentSourceImage (ไม่ใช่ sources[0])", detail.includes("currentSourceImage(") && !detail.includes("sources[0]"), true);
  check("ไม่มี finishRenderManually/finishManually/canFinishManually เหลือ", ["app/actions.ts", "lib/flow-lifecycle.ts", "components/flow-job-detail.tsx", "components/manual-render-panel.tsx"].filter((f) => /finishRenderManually|finishManually|canFinishManually/.test(strip(f))), []);
}

if (failed > 0) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log("\nall checks passed");
