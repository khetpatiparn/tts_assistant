/**
 * ตรวจตรรกะ pure ของ lib/flow-jobs.ts — รัน: node scripts/check-flow-jobs.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  check("prompt รอบ 2 + ข้อความเพิ่มเติม", f.buildFlowPrompt(2, "ที่ลับเล็บแมว", "วางบนโซฟา"), 'ขอภาพสินค้าตอนใช้งาน สินค้าคือ "ที่ลับเล็บแมว" วางบนโซฟา');
  check("normalize ยุบขึ้นบรรทัด (Enter ในช่อง Flow = ส่ง)", f.normalizeExtraPrompt("  เอาแค่\nแผ่นเดียว  "), "เอาแค่ แผ่นเดียว");
  check("normalize ตัดความยาว", f.normalizeExtraPrompt("ก".repeat(500)).length, f.EXTRA_PROMPT_MAX);
  check("normalize null = ว่าง", f.normalizeExtraPrompt(null), "");
  check("candidateFilename", f.candidateFilename(1, 2, 3, "png"), "r1-a2-3.png");
  check("sourceFilename", f.sourceFilename(0, "jpg"), "source-0.jpg");

  check("videoFilename", f.videoFilename(2), "r3-a2.mp4");
  check("videoDownloadName ตัดอักขระต้องห้ามของ Windows", f.videoDownloadName('กล่อง 2/3 "ใหม่"'), "กล่อง 2 3 ใหม่.mp4");
  check("videoDownloadName ชื่อว่าง", f.videoDownloadName("  "), "clip.mp4");
  const tenPart = "1. Style\nบรรทัดสอง\n\n2. Scene";
  check("render prompt ไม่มีข้อความเพิ่มเติม = 10-part prompt ทุกตัวอักษร (ขึ้นบรรทัดคงเดิม)", f.buildRenderPrompt(tenPart, ""), tenPart);
  check("render prompt + ข้อความเพิ่มเติม ต่อท้ายด้วยช่องว่างเดียว", f.buildRenderPrompt(tenPart, "ห้ามมีคน"), `${tenPart} ห้ามมีคน`);

  check("backup profile: เจอชื่อมี Flow สำรอง", f.pickBackupBrowserProfile({ Default: { name: "Person 1" }, "Profile 3": { name: "Flow สำรอง" } }), "Profile 3");
  check("backup profile: ไม่เจอ = null", f.pickBackupBrowserProfile({ Default: { name: "Person 1" }, "Profile 2": { name: "test triple bot" } }), null);
  check("backup profile: เจอสองอัน = null (ไม่เดา)", f.pickBackupBrowserProfile({ a: { name: "flow 1" }, b: { name: "backup" } }), null);
  check("ชื่อสั้นปกติ", f.acceptShortName("  ผ้าเช็ดตัวสัตว์เลี้ยง ", "Jaotoob ผ้าเช็ดตัวสัตว์เลี้ยง สำหรับสุนัขและแมว หนานุ่มพิเศษ"), "ผ้าเช็ดตัวสัตว์เลี้ยง");
  check("ชื่อสั้นว่าง → ชื่อเต็ม", f.acceptShortName("", "ชื่อเต็มยาวๆ"), "ชื่อเต็มยาวๆ");
  check("ชื่อสั้นเกิน 60 → ชื่อเต็ม", f.acceptShortName("ก".repeat(61), "ข".repeat(80)), "ข".repeat(80));
  check("ชื่อสั้นหลายบรรทัด → ชื่อเต็ม", f.acceptShortName("ผ้า\nเช็ดตัว", "ผ้าเช็ดตัวสัตว์เลี้ยงหนานุ่ม"), "ผ้าเช็ดตัวสัตว์เลี้ยงหนานุ่ม");
  check("ชื่อสั้นยาวพอๆ ชื่อเต็ม → ชื่อเต็ม (ไม่ได้ย่อจริง)", f.acceptShortName("ตะขอแขวน", "ตะขอแขวน"), "ตะขอแขวน");
  check("flowProjectUrl ปกติ", f.flowProjectUrl("367b48db-a868-48ba-bfa5-0933d33728e5"), "https://flow.google.com/project/367b48db-a868-48ba-bfa5-0933d33728e5?hl=en");
  check("flowProjectUrl ว่าง = ''", f.flowProjectUrl(""), "");
  check("flowProjectUrl มีอักขระแปลก = ''", f.flowProjectUrl("abc/../x?y"), "");
  check("flowGoogleProjectUrl (ลิงก์ที่บอทเปิด) ไม่ตรวจ id", f.flowGoogleProjectUrl("abc"), "https://flow.google.com/project/abc?hl=en");

  // พรอมต์รอบรูปและลิงก์โปรเจกต์มีที่เดียวใน lib/flow-jobs.ts — บอทต้อง import ไปใช้ ห้ามมีสำเนาใน worker/
  {
    const driver = readFileSync("worker/flow-driver.ts", "utf8");
    const selectors = readFileSync("worker/flow-selectors.ts", "utf8");
    check("flow-driver ใช้ buildFlowPrompt จาก lib (ไม่มีสำเนาพรอมต์)", /import \{[^}]*\bbuildFlowPrompt\b[^}]*\} from "@\/lib\/flow-jobs"/.test(driver) && !driver.includes("ขอภาพสินค้า"), true);
    check("flow-selectors ไม่มีรูปแบบลิงก์ flow.google.com/project ของตัวเอง", selectors.includes("flow.google.com/project/"), false);
    // โหลด flow-selectors.ts จริงด้วย tsx แบบเดียวกับที่ npm run flow-worker รัน (ยืนยันว่า alias @/ ใช้ได้ตอนรันบอท)
    writeFileSync(
      join(out, "selectors-probe.ts"),
      'import { SELECTOR_SETS } from "../worker/flow-selectors";\nconsole.log(SELECTOR_SETS.migrated.projectUrl("367b48db-a868-48ba-bfa5-0933d33728e5"));\n',
    );
    const probed = execFileSync("npx", ["tsx", join(out, "selectors-probe.ts")], { shell: true, encoding: "utf8" }).trim();
    check("บอทเปิดลิงก์โปรเจกต์เดิมทุกตัวอักษร (tsx)", probed, "https://flow.google.com/project/367b48db-a868-48ba-bfa5-0933d33728e5?hl=en");
  }
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
  // ---------- แท็บหน้าคิว /flow (pure grouping) ----------
  const tabOf = (st) => f.flowTabOf(st);
  check("tab review_r1 = choose", tabOf("review_r1"), "choose");
  check("tab review_r2 = choose", tabOf("review_r2"), "choose");
  check("tab review_r3 = clip", tabOf("review_r3"), "clip");
  check("tab failed = failed", tabOf("failed"), "failed");
  for (const st of ["queued_r1", "running_r1", "queued_r2", "running_r2", "awaiting_prompt", "queued_r3", "running_r3", "queued_upscale", "running_upscale"]) {
    check(`tab ${st} = bot`, tabOf(st), "bot");
  }
  check("tab done = closed", tabOf("done"), "closed");
  check("tab skipped = closed", tabOf("skipped"), "closed");
  check("ทุกสถานะอยู่ในแท็บที่รู้จัก", Object.values(f.FLOW_STATUS).every((st) => f.FLOW_TABS.some((t) => t.key === tabOf(st))), true);
  check("ลำดับแท็บ", f.FLOW_TABS.map((t) => t.key).join(","), "choose,clip,failed,bot,closed");
  check("ป้ายแท็บเลือกรูป", f.FLOW_TABS[0].label, "เลือกรูป");
  check("countByTab", JSON.stringify(f.countByTab([{ status: "review_r1" }, { status: "review_r2" }, { status: "skipped" }, { status: "done" }])), JSON.stringify({ choose: 2, clip: 0, failed: 0, bot: 0, closed: 2 }));
  const cnt = (o) => ({ choose: 0, clip: 0, failed: 0, bot: 0, closed: 0, ...o });
  check("default tab: มีเลือกรูป", f.defaultFlowTab(cnt({ choose: 1, clip: 2, bot: 5 })), "choose");
  check("default tab: ข้ามเลือกรูปที่ว่าง -> clip", f.defaultFlowTab(cnt({ clip: 1, failed: 1 })), "clip");
  check("default tab: เหลือแค่พัง", f.defaultFlowTab(cnt({ failed: 1, bot: 3 })), "failed");
  check("default tab: ไม่มีงานรอผู้ใช้ -> bot", f.defaultFlowTab(cnt({ bot: 1, closed: 4 })), "bot");
  check("default tab: ว่างหมด -> bot", f.defaultFlowTab(cnt({})), "bot");
  check("parseFlowTab ถูก", f.parseFlowTab("clip"), "clip");
  check("parseFlowTab แปลก = null", f.parseFlowTab("zzz"), null);
  check("parseFlowTab null = null", f.parseFlowTab(null), null);
  check("tabBadge review_r1", f.jobKindLabel("review_r1", 1), "รอบ 1");
  check("tabBadge review_r2", f.jobKindLabel("review_r2", 2), "รอบ 2");
  check("kind queued_r1", f.jobKindLabel("queued_r1", 1), "วาดรูป รอบ 1");
  check("kind running_r2", f.jobKindLabel("running_r2", 2), "วาดรูป รอบ 2");
  check("kind queued_r3", f.jobKindLabel("queued_r3", 3), "เรนเดอร์คลิป");
  check("kind running_r3", f.jobKindLabel("running_r3", 3), "เรนเดอร์คลิป");
  check("kind queued_upscale", f.jobKindLabel("queued_upscale", 4), "โหลด 1080p");
  check("kind running_upscale", f.jobKindLabel("running_upscale", 4), "โหลด 1080p");
  check("kind awaiting_prompt", f.jobKindLabel("awaiting_prompt", 3), "รอพรอมต์");
  check("kind done = null", f.jobKindLabel("done", 3), null);

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
  check("DEFAULT_CAPTIONS round 1", f.DEFAULT_CAPTIONS[1], "สินค้า พื้นหลังขาว");

  // B4: ย่อชื่อด้วย Gemini ต้องมีเพดานเวลา และต้องเรียกก่อนเช็กกันสร้างงานซ้ำ (ช่อง guard→create สั้นเหมือนเดิม)
  {
    check("SHORT_NAME_TIMEOUT_MS = 8 วิ", f.SHORT_NAME_TIMEOUT_MS, 8000);
    const fast = await f.withTimeout(new Promise((r) => setTimeout(() => r("ok"), 10)), 500, "ย่อชื่อ");
    check("เสร็จก่อนหมดเวลา → ได้ค่า", fast, "ok");
    let msg = null;
    const t0 = Date.now();
    try { await f.withTimeout(new Promise((r) => setTimeout(() => r("late"), 2000)), 50, "ย่อชื่อ"); } catch (e) { msg = e instanceof Error ? e.message : String(e); }
    check("ช้าเกิน → โยน error ที่บอกชื่องาน", msg !== null && msg.includes("ย่อชื่อ"), true);
    check("ไม่รอจนงานช้าเสร็จ", Date.now() - t0 < 1000, true);
    let rej = null;
    try { await f.withTimeout(Promise.reject(new Error("api ล้ม")), 500, "ย่อชื่อ"); } catch (e) { rej = e instanceof Error ? e.message : String(e); }
    check("งานล้มเอง → error เดิมส่งต่อ", rej, "api ล้ม");

    const src = readFileSync("app/actions.ts", "utf8").replace(/\r\n/g, "\n");
    const body = (name) => {
      const at = src.indexOf(`export async function ${name}(`);
      const end = src.indexOf("\nexport async function ", at + 1);
      return at < 0 ? "" : src.slice(at, end < 0 ? undefined : end);
    };
    const showcase = body("startShowcaseProduct");
    const nameAt = showcase.indexOf("shortNameForEntry(");
    const guardAt = showcase.indexOf("linkedEntryId !== null");
    check("startShowcaseProduct ย่อชื่อก่อนเช็กกันสร้างซ้ำ", nameAt >= 0 && guardAt >= 0 && nameAt < guardAt, true);
    check("startShowcaseProduct ไม่เรียก Gemini ระหว่าง guard กับ create", showcase.slice(guardAt, showcase.indexOf("promptEntry.create")).includes("shortNameForEntry("), false);
    const helperAt = src.indexOf("async function shortNameForEntry(");
    check("shortNameForEntry ครอบ Gemini ด้วย withTimeout", src.slice(helperAt, src.indexOf("\n}\n", helperAt)).includes("withTimeout("), true);
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}
if (failed > 0) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log("\nall checks passed");
