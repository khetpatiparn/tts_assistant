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
  // งานทุกตัวของ entry ใช้โฟลเดอร์ flow/ เดียวกัน — ชื่อรูปต้นทางต้องไม่ซ้ำข้าม attempt และข้ามงาน (เปลี่ยนรูปต้นทาง ticket 05)
  check("sourceFilename มี attempt + index + nonce", f.sourceFilename(3, 0, "jpg", "ab12"), "source-a3-0-ab12.jpg");
  check("checkSourceImage: jpeg/png/webp ≤10MB ผ่าน · HEIC/ใหญ่เกิน ไม่ผ่าน",
    [["image/jpeg", 1], ["image/png", 10 * 1024 * 1024], ["image/webp", 5], ["image/heic", 1], ["image/png", 10 * 1024 * 1024 + 1]].map(([m, n]) => f.checkSourceImage({ mimeType: m, size: n })).join("|"),
    "|||รองรับเฉพาะ JPEG, PNG, WebP|ไฟล์ใหญ่เกิน 10MB");
  check("imageExtFromMime", ["image/png", "image/webp", "image/jpeg", "x"].map((m) => f.imageExtFromMime(m)).join(","), "png,webp,jpg,jpg");

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

  // ticket 07: "ชื่อยังเป็นชื่อเต็มของร้าน" ตัดสินที่ isUnshortenedName ที่เดียว (บอท/ย่อเบื้องหลัง/สคริปต์ย้อนหลังใช้ตัวเดียวกัน)
  {
    const shop = "Jaotoob ผ้าเช็ดตัวสัตว์เลี้ยง สำหรับสุนัขและแมว หนานุ่มพิเศษ ซึมซับดี";
    const un = (productName, productInfo, titles) => f.isUnshortenedName({ productName, productInfo }, titles);
    check("ชื่อ = ชื่อร้านที่ผูกอยู่ + ไม่มีชื่อเต็มใน productInfo → ยังไม่ย่อ", un(shop, "", [shop]), true);
    check("ช่องว่างต่างกันนิดหน่อยก็ยังนับเป็นชื่อร้าน", un(`  ${shop.replace(" ", "  ")} `, "", [shop]), true);
    check("ย่อแล้ว (ชื่อไม่ตรงชื่อร้าน) → ไม่ต้องย่อ", un("ผ้าเช็ดตัวสัตว์เลี้ยง", `${f.FULL_TITLE_PREFIX}${shop}`, [shop]), false);
    check("ชื่อตรงชื่อร้าน แต่ productInfo มีชื่อเต็มแล้ว (ตัดสินแล้วว่าชื่อร้านสั้นพอ / ผู้ใช้ตั้งเอง) → ไม่ต้องย่อ", un(shop, `${f.FULL_TITLE_PREFIX}${shop}`, [shop]), false);
    check("ไม่ได้มาจาก Showcase/หาสินค้า (ไม่มีชื่อร้านผูก) → ไม่ต้องย่อ", un(shop, "", []), false);
    check("productInfo ที่ผู้ใช้เขียนเอง (ไม่มีชื่อเต็ม) ไม่ทำให้พ้น", un(shop, "ผ้าฝ้าย 100%", [shop]), true);
    check("ผูกหลายแถว ตรงแถวใดแถวหนึ่งก็นับ", un(shop, "", ["อย่างอื่น", shop]), true);

    const o = (answer, full) => JSON.stringify(f.shortNameOutcome(answer, full));
    check("outcome: ย่อได้ → ชื่อสั้น", o("  ผ้าเช็ดตัวสัตว์เลี้ยง ", shop), JSON.stringify({ name: "ผ้าเช็ดตัวสัตว์เลี้ยง" }));
    check("outcome: คำตอบว่าง → ไม่สำเร็จ (ลองใหม่)", o("", shop), "null");
    check("outcome: เกิน 60 → ไม่สำเร็จ", o("ก".repeat(61), "ข".repeat(80)), "null");
    check("outcome: หลายบรรทัด → ไม่สำเร็จ", o("ผ้า\nเช็ดตัว", shop), "null");
    check("outcome: ไม่สั้นลง = ชื่อร้านสั้นพออยู่แล้ว → ใช้ชื่อร้าน (สำเร็จ ไม่วนย่อซ้ำ)", o("ตะขอแขวน", "ตะขอแขวน"), JSON.stringify({ name: "ตะขอแขวน" }));

    const p = (info) => f.productInfoWithFullTitle(info, shop);
    check("productInfo ว่าง → ชื่อเต็มของร้าน", p(""), `${f.FULL_TITLE_PREFIX}${shop}`);
    check("productInfo มีชื่อเต็มแล้ว → ไม่แตะ", p(`${f.FULL_TITLE_PREFIX}เดิม`), `${f.FULL_TITLE_PREFIX}เดิม`);
    check("productInfo ที่ผู้ใช้เขียนเอง → คงไว้ ต่อชื่อเต็มบรรทัดใหม่", p("ผ้าฝ้าย 100%"), `ผ้าฝ้าย 100%\n${f.FULL_TITLE_PREFIX}${shop}`);
    check("หลังย่อ/ตัดสินแล้ว isUnshortenedName = false เสมอ", un(shop, p(""), [shop]), false);
  }
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

  // ticket 07: งานที่รอชื่อสั้นไม่ขวางคิว — ข้ามไปงานถัดไป งานนั้นยังอยู่ในคิว ลองใหม่เมื่อถึงเวลา
  {
    // queued เรียงตามเวลาเข้าคิวแล้ว (DB orderBy createdAt asc)
    const queued = [
      { id: "a", status: "queued_r1" }, { id: "b", status: "queued_r3" }, { id: "c", status: "queued_r1" },
      { id: "d", status: "queued_r2" }, { id: "e", status: "queued_upscale" },
    ];
    const seq = (rounds, waiting, now = 1000) => f.claimSequence(rounds, queued, new Map(Object.entries(waiting)), now).map((j) => `${j.id}${j.round}`).join(",");
    check("claimSequence ตามลำดับรอบของ claimOrder · ในรอบเดียวกันตามเวลาเข้าคิว", seq([4, 2, 3, 1], {}), "e4,d2,b3,a1,c1");
    check("claimSequence ตัดรอบที่ไม่อยู่ใน rounds (ครบเพดาน)", seq([4, 3], {}), "e4,b3");
    check("งานที่ยังไม่ถึงเวลาลองชื่อใหม่ไม่อยู่ในรายการ งานถัดไปในรอบเดียวกันขึ้นมาแทน", seq([4, 2, 3, 1], { a: 5000, d: 5000 }), "e4,b3,c1");
    check("ถึงเวลาแล้ว → กลับมาอยู่ในรายการ (ลำดับเดิมตามเวลาเข้าคิว)", seq([4, 2, 3, 1], { a: 1000 }), "e4,d2,b3,a1,c1");
    check("ทุกงานรอชื่อ = รายการว่าง (บอทว่างเหมือนไม่มีงาน)", f.claimSequence([1], [{ id: "a", status: "queued_r1" }], new Map([["a", 9999]]), 1000).length, 0);

    check("ต้องมีชื่อสั้นก่อน: รอบ 1", f.needsShortNameGate(1), true);
    check("ต้องมีชื่อสั้นก่อน: รอบ 2", f.needsShortNameGate(2), true);
    check("Render / โหลด 1080p ไม่พิมพ์ชื่อ → ไม่รอชื่อ", f.needsShortNameGate(3) || f.needsShortNameGate(4), false);

    const d = (n) => f.shortNameRetryDelayMs(n) / 60_000;
    check("ลองชื่อใหม่: พลาดครั้งแรกรอ 2 นาที", d(1), 2);
    check("ลองชื่อใหม่: ครั้งที่ 2 รอ 5 นาที", d(2), 5);
    check("ลองชื่อใหม่: ครั้งที่ 3 รอ 15 นาที", d(3), 15);
    check("ลองชื่อใหม่: ตั้งแต่ครั้งที่ 4 รอ 30 นาที (ไม่ยาวขึ้นอีก)", d(4) === 30 && d(50) === 30, true);
  }
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

  // ticket 07: กดสร้างงานไม่รอ Gemini อีก — สร้าง entry ด้วยชื่อร้าน + เข้าคิวทันที แล้วย่อเบื้องหลัง (ไม่ await) · กันสร้างซ้ำ
  // (guard → create ติดกันโดยไม่มีการรอตัวย่อคั่น) ยังทำงาน · withTimeout ยังใช้กับการเรียกตัวย่อแต่ละครั้ง (lib/short-name-db.ts)
  {
    check("ไม่มีเพดาน 8 วิ (SHORT_NAME_TIMEOUT_MS) แล้ว", f.SHORT_NAME_TIMEOUT_MS, undefined);
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
    const waitsForName = (code) => /await\s+(shortenProductName|ensureShortName|shortenInBackground|shortNameForEntry)\(/.test(code);
    check("ไม่มี shortNameForEntry (ตัวที่ทำให้ผู้ใช้รอ Gemini) แล้ว", src.includes("shortNameForEntry"), false);
    for (const name of ["startShowcaseProduct", "createEntryFromCandidate"]) {
      const fn = body(name);
      const createAt = fn.indexOf("promptEntry.create");
      const bgAt = fn.indexOf("shortenInBackground(created.id)");
      check(`${name} ไม่ await การย่อชื่อ`, fn !== "" && !waitsForName(fn), true);
      check(`${name} สร้าง entry ด้วยชื่อร้าน (candidate.name)`, /productName:\s*candidate\.name/.test(fn.slice(createAt)), true);
      check(`${name} ย่อเบื้องหลังหลังสร้าง entry`, createAt >= 0 && bgAt > createAt, true);
    }
    const showcase = body("startShowcaseProduct");
    const guardAt = showcase.indexOf("linkedEntryId !== null");
    const between = showcase.slice(guardAt, showcase.indexOf("promptEntry.create"));
    check("startShowcaseProduct: ช่อง guard → create ไม่มีการเรียกตัวย่อชื่อ (กดซ้ำไม่ได้งานซ้ำ)", guardAt >= 0 && !/shorten|ShortName/.test(between), true);
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}
if (failed > 0) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log("\nall checks passed");
