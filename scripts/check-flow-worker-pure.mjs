/**
 * ตรวจโมดูล pure ของ worker (config / humanize / schedule) — แทน test runner ที่โปรเจกต์ไม่มี
 * รัน: node scripts/check-flow-worker-pure.mjs
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
function checkThrows(name, fn, includes) {
  let msg = null;
  try { fn(); } catch (e) { msg = e instanceof Error ? e.message : String(e); }
  const ok = msg !== null && msg.includes(includes);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`      ได้ ${JSON.stringify(msg)} ควรมีคำว่า ${JSON.stringify(includes)}`);
}

try {
  execFileSync(
    "npx",
    ["tsc", "worker/config.ts", "worker/humanize.ts", "worker/schedule.ts", "worker/flow-signals.ts", "worker/jev.ts",
     "--outDir", out, "--module", "es2022", "--target", "ES2020", "--moduleResolution", "bundler",
     "--esModuleInterop", "--skipLibCheck"],
    { stdio: "inherit", shell: true }
  );

  // ---------- config ----------
  const cfg = await import(pathToFileURL(join(out, "config.js")).href);
  const good = cfg.loadWorkerConfig("flow-worker.config.json");
  check("dailyBatchCap = 60 (เร่งบอท 2026-09-30)", good.dailyBatchCap, 60);
  check("videoDailyCap = 20", good.videoDailyCap, 20);
  check("betweenProductsMs = [30000, 90000]", JSON.stringify(good.betweenProductsMs), "[30000,90000]");
  check("betweenBatchesMs = [10000, 30000]", JSON.stringify(good.betweenBatchesMs), "[10000,30000]");
  check("longBreakEvery = [12, 16]", JSON.stringify(good.longBreakEvery), "[12,16]");
  check("longBreakMs = [300000, 600000] (5-10 นาที)", JSON.stringify(good.longBreakMs), "[300000,600000]");
  check("ไฟล์จริงเปิด Render อัตโนมัติ (ผู้ใช้เลือกกลับมาใช้ 2026-09-30)", good.renderEnabled, true);
  {
    const noKey = JSON.parse(readFileSync("flow-worker.config.json", "utf8"));
    delete noKey.renderEnabled;
    writeFileSync(join(out, "nokey.json"), JSON.stringify(noKey));
    check("ไม่มี key renderEnabled = ปิด", cfg.loadWorkerConfig(join(out, "nokey.json")).renderEnabled, false);
    writeFileSync(join(out, "badkey.json"), JSON.stringify({ ...noKey, renderEnabled: "yes" }));
    checkThrows("renderEnabled ต้องเป็น boolean", () => cfg.loadWorkerConfig(join(out, "badkey.json")), "renderEnabled");
  }
  check("default activeHours = null", good.activeHours, null);
  check("actionDelayMs is a range", Array.isArray(good.actionDelayMs) && good.actionDelayMs.length === 2, true);

  const badPath = join(out, "bad.json");
  writeFileSync(badPath, JSON.stringify({ ...good, actionDelayMs: [3000, 800] }));
  checkThrows("range with min > max rejected", () => cfg.loadWorkerConfig(badPath), "actionDelayMs");

  writeFileSync(badPath, JSON.stringify({ ...good, activeHours: ["25:00", "07:00"] }));
  checkThrows("activeHours invalid hour rejected", () => cfg.loadWorkerConfig(badPath), "activeHours");

  writeFileSync(badPath, JSON.stringify({ ...good, dailyBatchCap: 0 }));
  checkThrows("dailyBatchCap must be >= 1", () => cfg.loadWorkerConfig(badPath), "dailyBatchCap");

  // ---------- humanize (pure parts only) ----------
  const hz = await import(pathToFileURL(join(out, "humanize.js")).href);
  {
    let inRange = true;
    for (let i = 0; i < 500; i++) {
      const v = hz.randInt([10, 20]);
      if (!Number.isInteger(v) || v < 10 || v > 20) inRange = false;
    }
    check("randInt stays inside [min,max] and is an integer", inRange, true);
    check("randInt with min==max returns min", hz.randInt([7, 7]), 7);
    const pts = hz.bezierPoints({ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }, 5);
    check("bezierPoints returns steps+1 points", pts.length, 6);
    check("bezierPoints starts at from", pts[0].x === 0 && pts[0].y === 0, true);
    check("bezierPoints ends at to", pts[5].x === 100 && pts[5].y === 100, true);
  }

  // ---------- schedule ----------
  const sc = await import(pathToFileURL(join(out, "schedule.js")).href);
  const at = (h, m) => new Date(2026, 8, 6, h, m, 0, 0); // 2026-09-06 local
  check("activeHours null → always active", sc.isWithinActiveHours(at(13, 0), null), true);
  check("same-day window 09:00-17:00 at 13:00 → active", sc.isWithinActiveHours(at(13, 0), ["09:00", "17:00"]), true);
  check("same-day window at 18:00 → inactive", sc.isWithinActiveHours(at(18, 0), ["09:00", "17:00"]), false);
  check("overnight window 22:00-07:00 at 23:30 → active", sc.isWithinActiveHours(at(23, 30), ["22:00", "07:00"]), true);
  check("overnight window at 03:00 → active", sc.isWithinActiveHours(at(3, 0), ["22:00", "07:00"]), true);
  check("overnight window at 12:00 → inactive", sc.isWithinActiveHours(at(12, 0), ["22:00", "07:00"]), false);
  check("window end is exclusive (07:00 → inactive)", sc.isWithinActiveHours(at(7, 0), ["22:00", "07:00"]), false);
  check("msUntilActiveWindow 12:00 → 22:00 = 10h", sc.msUntilActiveWindow(at(12, 0), ["22:00", "07:00"]), 10 * 3600000);
  check("msUntilActiveWindow 18:00 → next day 09:00 = 15h", sc.msUntilActiveWindow(at(18, 0), ["09:00", "17:00"]), 15 * 3600000);
  check("localDateKey formats YYYY-MM-DD local", sc.localDateKey(at(0, 5)), "2026-09-06");
  {
    let ok = true;
    for (let i = 0; i < 200; i++) { const t = sc.pickLongBreakTarget([4, 6]); if (t < 4 || t > 6) ok = false; }
    check("pickLongBreakTarget within range", ok, true);
  }

  // ว่างนานเท่ากับพักยาว = ไม่ต้องพักยาวซ้ำ (spec 2026-09-30 §1 "พักตามความจริง")
  const MIN5 = 5 * 60000;
  check("ว่าง 4 นาที (< longBreakMs ต่ำสุด 5) → ยังไม่นับเป็นพักยาว", sc.idleCountsAsLongBreak(1_000_000, 1_000_000 + 4 * 60000, [MIN5, 2 * MIN5]), false);
  check("ว่าง 5 นาทีพอดี → นับเป็นพักยาว", sc.idleCountsAsLongBreak(1_000_000, 1_000_000 + MIN5, [MIN5, 2 * MIN5]), true);
  check("ว่าง 30 นาที → นับเป็นพักยาว", sc.idleCountsAsLongBreak(1_000_000, 1_000_000 + 30 * 60000, [MIN5, 2 * MIN5]), true);
  check("ยังไม่เคยทำงานเลย (lastJobFinishedAt = 0) → ไม่นับ (ไม่มีอะไรให้พัก)", sc.idleCountsAsLongBreak(0, 1_000_000, [MIN5, 2 * MIN5]), false);

  // ---------- flow-signals (แยกสัญญาณบอท/วาดพัง/คลิกไม่ติด) ----------
  const fs2 = await import(pathToFileURL(join(out, "flow-signals.js")).href);
  const failedText = "warning Failed Sorry, this image failed to generate. You have not been charged for this generation. refresh undo delete_forever";
  check("การ์ด failed to generate (ข้อความจริงจาก page.html) → flow_error", fs2.errorKindForTileTexts([failedText]), "flow_error");
  check("การ์ด unusual activity → captcha", fs2.errorKindForTileTexts(["Failed We noticed some unusual activity. Help Center"]), "captcha");
  check("มีการ์ดบล็อกปนการ์ดพังธรรมดา → captcha (เอียงไปทางพัก)", fs2.errorKindForTileTexts([failedText, "unusual traffic from your network"]), "captcha");
  check("ไม่มีการ์ด → flow_error", fs2.errorKindForTileTexts([]), "flow_error");
  check("HTTP 403 → captcha", fs2.blockKindForStatus(403), "captcha");
  check("HTTP 429 → captcha (พักยาว ไม่ใช่กดต่อ)", fs2.blockKindForStatus(429), "captcha");
  check("HTTP 401 → login_required", fs2.blockKindForStatus(401), "login_required");
  check("HTTP 404 ของ RPC อื่น → ไม่หยุด", fs2.blockKindForStatus(404), null);
  check("HTTP 500 ของ RPC อื่น → ไม่หยุด", fs2.blockKindForStatus(500), null);
  check("HTTP 200 → ไม่หยุด", fs2.blockKindForStatus(200), null);
  const base = { tilesBefore: 5, tilesNow: 5, pendingNow: 0, freshErrorTiles: 0, goodCount: 0 };
  check("ไม่มีอะไรเปลี่ยน → ยังไม่รับคำสั่ง", fs2.generateAccepted(base), false);
  check("ช่องในกริดเพิ่ม → รับแล้ว", fs2.generateAccepted({ ...base, tilesNow: 9 }), true);
  check("มีช่องกำลังวาด → รับแล้ว", fs2.generateAccepted({ ...base, pendingNow: 1 }), true);
  check("มีการ์ด error ใหม่ → รับแล้ว (วาดแล้วพัง)", fs2.generateAccepted({ ...base, freshErrorTiles: 1 }), true);
  check("ได้รูปแล้ว → รับแล้ว", fs2.generateAccepted({ ...base, goodCount: 2 }), true);
  check("Jev มั่นใจ 0.97 → รับ", fs2.acceptJevChoice({ choice: "e3", p: 0.97 }), "e3");
  check("Jev 0.91 (ช่วงที่เคยผิดตอนทดสอบ) → ไม่รับ", fs2.acceptJevChoice({ choice: "e3", p: 0.91 }), null);
  check("Jev ตอบ none แม้มั่นใจ → ไม่กดอะไร", fs2.acceptJevChoice({ choice: "none", p: 0.99 }), null);
  check("เรียก Jev ไม่ได้ → ไม่กดอะไร", fs2.acceptJevChoice(null), null);

  // ---------- Render คลิป ----------
  check("ป้าย trigger หลังตั้งค่าครบ (ตามที่เห็นจริง) → ผ่าน", fs2.renderSettingsLabelOk("Video · 720p · 10s\ncrop_9_16\nx1"), true);
  check("ป้ายยังเป็น 8s → ไม่ผ่าน", fs2.renderSettingsLabelOk("Video · 720p · 8s crop_9_16 x1"), false);
  check("ป้ายเป็น 16:9 → ไม่ผ่าน", fs2.renderSettingsLabelOk("Video · 720p · 10s crop_16_9 x1"), false);
  check("ป้ายเป็น x2 → ไม่ผ่าน", fs2.renderSettingsLabelOk("Video · 720p · 10s crop_9_16 x2"), false);
  check("ป้ายโหมดรูป → ไม่ผ่าน", fs2.renderSettingsLabelOk("Image crop_9_16 x1"), false);
  const mp4 = Uint8Array.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
  check("หัวไฟล์ ftypisom → mp4", fs2.isMp4Header(mp4), true);
  check("หัวไฟล์ PNG → ไม่ใช่ mp4", fs2.isMp4Header(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])), false);
  check("ไฟล์สั้นเกิน → ไม่ใช่ mp4", fs2.isMp4Header(Uint8Array.from([0, 0, 0, 0x20, 0x66])), false);
  check("thumbnail ใหม่ = src ที่ไม่มีก่อนกด", fs2.pickNewThumbnail(["a", "b"], ["c", "a", "b"]), "c");
  check("src ว่าง (ยังโหลดไม่เสร็จ) ไม่นับ", fs2.pickNewThumbnail(["a"], ["", "a"]), null);
  check("ไม่มีช่องใหม่ → null", fs2.pickNewThumbnail(["a"], ["a"]), null);
  check(
    "media id จาก flow-content.google/image/<uuid> (ตัดลายเซ็นใน query ทิ้ง)",
    fs2.flowMediaIdFromSrc("https://flow-content.google/image/0f1e2d3c-aaaa-bbbb?sig=abc&w=400"),
    "0f1e2d3c-aaaa-bbbb"
  );
  check("media id src แบบอื่น = host+path ไม่เอา query", fs2.flowMediaIdFromSrc("https://flow.google.com/asb/xyz/thumb?x=1"), "flow.google.com/asb/xyz/thumb");
  check("media id src เดียวกันคนละลายเซ็น = id เดียวกัน",
    fs2.flowMediaIdFromSrc("https://flow-content.google/image/U1?sig=1") === fs2.flowMediaIdFromSrc("https://flow-content.google/image/U1?sig=2"), true);
  check("media id src ว่าง = ''", fs2.flowMediaIdFromSrc(""), "");
  check("media id null = ''", fs2.flowMediaIdFromSrc(null), "");

  // ลิงก์วิดีโอตรงที่ Flow ใส่ใน <video src> ตอน hover (พิสูจน์แล้ว 2026-09-30: ดึงได้ไม่ต้อง cookie)
  const direct = "https://flow-content.google/video/a243bbd9-ab27-4a08-b41b-a51e9caac4b9?Expires=1790797015&KeyName=labs-flow-prod-cdn-key&Signature=abc";
  check("เจอลิงก์ flow-content.google/video → ใช้", fs2.pickDirectVideoUrl([direct]), direct);
  check("blob: ไม่ใช่ลิงก์ที่ดึงได้ → null", fs2.pickDirectVideoUrl(["blob:https://flow.google.com/1234"]), null);
  check("ลิงก์รูป (/image/) ไม่ใช่วิดีโอ → null", fs2.pickDirectVideoUrl(["https://flow-content.google/image/xyz?Expires=1"]), null);
  check("ว่าง/null → null", fs2.pickDirectVideoUrl([null, ""]), null);
  check("หลายตัว เอาตัวแรกที่ใช่", fs2.pickDirectVideoUrl(["blob:x", direct]), direct);
  check("host อื่นที่ไม่ใช่ flow-content.google → null (กันโดนหลอกให้โหลดจากที่อื่น)", fs2.pickDirectVideoUrl(["https://evil.example/video/abc"]), null);

  check("default videoDailyCap = 20", good.videoDailyCap, 20);
  check("default renderTimeoutMs = 8 นาที", good.renderTimeoutMs, 480000);
  check("default renderDownloadTimeoutMs = 10 นาที", good.renderDownloadTimeoutMs, 600000);
  writeFileSync(badPath, JSON.stringify({ ...good, videoDailyCap: 0 }));
  checkThrows("videoDailyCap must be >= 1", () => cfg.loadWorkerConfig(badPath), "videoDailyCap");
  const noRender = { ...good };
  delete noRender.renderTimeoutMs;
  writeFileSync(badPath, JSON.stringify(noRender));
  checkThrows("renderTimeoutMs ต้องมี", () => cfg.loadWorkerConfig(badPath), "renderTimeoutMs");
} finally {
  rmSync(out, { recursive: true, force: true });
}

if (failed > 0) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log("\nall checks passed");
