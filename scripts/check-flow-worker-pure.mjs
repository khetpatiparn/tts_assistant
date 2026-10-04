/**
 * ตรวจโมดูล pure ของ worker (config / humanize / schedule) — แทน test runner ที่โปรเจกต์ไม่มี
 * รัน: node scripts/check-flow-worker-pure.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    ["tsc", "worker/config.ts", "worker/humanize.ts", "worker/schedule.ts", "worker/flow-signals.ts", "worker/jev.ts", "worker/generation-watch.ts",
     "--outDir", out, "--module", "es2022", "--target", "ES2020", "--moduleResolution", "bundler",
     "--esModuleInterop", "--skipLibCheck"],
    { stdio: "inherit", shell: true }
  );
  // tsc คง import แบบไม่มีนามสกุล ("./errors") ซึ่ง Node ESM หาไม่เจอ — เติม .js ให้ไฟล์ที่คอมไพล์แล้ว
  for (const f of readdirSync(out).filter((n) => n.endsWith(".js"))) {
    const file = join(out, f);
    writeFileSync(file, readFileSync(file, "utf8").replace(/(from\s+["'])(\.\/[^"']+?)(["'])/g, (m, a, spec, b) => (spec.endsWith(".js") ? m : `${a}${spec}.js${b}`)));
  }

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
  check("subdomain หลอก flow-content.google.evil.com → null", fs2.pickDirectVideoUrl(["https://flow-content.google.evil.com/video/x"]), null);
  check("โดเมนหลอก evil-flow-content.google → null", fs2.pickDirectVideoUrl(["https://evil-flow-content.google/video/x"]), null);
  check("http (ไม่ใช่ https) → null", fs2.pickDirectVideoUrl(["http://flow-content.google/video/x"]), null);

  // uuid ถาวรของคลิป (รอบ 4 หาช่องด้วยค่านี้ เพราะ thumbnail หลังเปิดโปรเจกต์ใหม่เป็น /asb/<ลายเซ็น> ไม่มี id)
  check("uuid จากลิงก์ตรง", fs2.videoUuidFromUrl(direct), "a243bbd9-ab27-4a08-b41b-a51e9caac4b9");
  check("uuid คงที่แม้ลายเซ็นเปลี่ยน", fs2.videoUuidFromUrl(direct.replace("Signature=abc", "Signature=zzz")), "a243bbd9-ab27-4a08-b41b-a51e9caac4b9");
  check("thumbnail /asb/ ไม่ใช่ลิงก์วิดีโอ → ''", fs2.videoUuidFromUrl("https://flow.google.com/asb/ANqvLObCdgr6Jm4"), "");
  check("โดเมนหลอก → ''", fs2.videoUuidFromUrl("https://flow-content.google.evil.com/video/x"), "");
  check("null → ''", fs2.videoUuidFromUrl(null), "");
  check("uuid จากไฟล์ 1080p (_upsampled) = id เดิม", fs2.videoUuidFromUrl("https://flow-content.google/video/3a913221-986f-4141-90ca-c6c7f26bc5bf_upsampled?Expires=1&Signature=x"), "3a913221-986f-4141-90ca-c6c7f26bc5bf");

  // B3: รอบ 4 ห้ามเดาช่อง — ไม่รู้ id ต้องส่องเมนู (แม้โปรเจกต์มีช่องเดียว) และไฟล์ 1080p ต้องเป็นของคลิปนี้จริง
  const U = "3a913221-986f-4141-90ca-c6c7f26bc5bf";
  check("id จาก thumbnail ตรง → ช่องนั้น", fs2.knownTileIndex(["x", U], U, undefined), 1);
  check("ช่องที่จำไว้ → ใช้ได้", fs2.knownTileIndex(["a", "b", "c"], U, 2), 2);
  check("ช่องที่จำไว้เกินจำนวนช่อง → ต้องส่อง", fs2.knownTileIndex(["a"], U, 3), null);
  check("โปรเจกต์มีช่องเดียวแต่ id ไม่ตรง → ต้องส่อง (ห้ามเดาช่อง 0)", fs2.knownTileIndex(["flow.google.com/asb/abc"], U, undefined), null);
  check("mediaId ว่าง → ห้ามจับคู่ช่องที่ thumbnail ยังไม่โหลด", fs2.knownTileIndex(["", "a"], "", undefined), null);
  const up = `https://flow-content.google/video/${U}_upsampled?Expires=1&Signature=x`;
  check("ไฟล์ 1080p ของคลิปนี้ → รับ", fs2.fileUrlIsMedia(up, U), true);
  check("ไฟล์ 1080p ของคลิปอื่น → ไม่รับ", fs2.fileUrlIsMedia(up.replace(U, "aaaaaaaa-0000-0000-0000-000000000000"), U), false);
  check("ไฟล์ 720p ของคลิปนี้ (ส่อง) → รับ", fs2.fileUrlIsMedia(`https://flow-content.google/video/${U}?Expires=1`, U), true);
  check("URL ที่ไม่ใช่ flow-content.google → ไม่รับ", fs2.fileUrlIsMedia(`https://evil.example/video/${U}`, U), false);
  check("mediaId ว่าง → ไม่รับ", fs2.fileUrlIsMedia(up, ""), false);
  check("URL null (ส่องไม่ได้) → ไม่รับ", fs2.fileUrlIsMedia(null, U), false);

  // สิ่งที่เขียนลง DB หลัง Render (เดิม renderOutcome ที่นี่) ย้ายไป previewReady ใน lib/flow-lifecycle.ts — ตรวจใน check-flow-lifecycle.mjs
  check("ขั้นหลัง Render พัง → เหตุผลระบุชื่อขั้น", fs2.postRenderFailReason("dwell", "เจอสัญญาณ captcha: x"), "dwell พังก่อนเริ่มโหลด: เจอสัญญาณ captcha: x");

  // ---------- generation-watch (ลูปเฝ้าหน้าหลังกด Generate — ที่เดียวของรอบรูปและรอบ Render) ----------
  const gw = await import(pathToFileURL(join(out, "generation-watch.js")).href);
  {
    const IMG_DOM = gw.imageWatchPolicy("dom", 4);
    const IMG_NET = gw.imageWatchPolicy("network", 4);
    const VID = gw.RENDER_WATCH;
    const tick = (o = {}) => ({
      captchaHit: null, responses: [], goodCount: 0, value: null, freshErrorTiles: 0, errorTileTexts: [],
      tilesBefore: 5, tilesNow: null, pendingNow: 0, alertText: null, ...o,
    });
    const st = (o = {}) => ({ accepted: true, acceptBy: 45_000, now: 1_000, ...o });
    const v = (t, p, s = st()) => gw.judgeTick(tick(t), s, p);
    const sig = (r) => `${r.kind}|${r.errorKind ?? ""}|${r.botSignal ?? ""}`;

    for (const [name, p] of [["รูป", IMG_DOM], ["รูป network", IMG_NET], ["คลิป", VID]]) {
      check(`[${name}] captcha selector → captcha + bot_signal wait-loop`, sig(v({ captchaHit: "iframe[src*=recaptcha]" }, p)), "fail|captcha|wait-loop");
      check(`[${name}] HTTP 403 → captcha + bot_signal http 403`, sig(v({ responses: [{ status: 403, body: null }] }, p)), "fail|captcha|http 403");
      check(`[${name}] HTTP 429 → captcha (พักยาว) + bot_signal`, sig(v({ responses: [{ status: 429, body: null }] }, p)), "fail|captcha|http 429");
      check(`[${name}] HTTP 401 → login_required + bot_signal`, sig(v({ responses: [{ status: 401, body: null }] }, p)), "fail|login_required|http 401");
      check(`[${name}] การ์ด unusual activity → captcha + bot_signal ไม่รอให้ครบช่อง`,
        sig(v({ freshErrorTiles: 1, errorTileTexts: ["Failed We noticed some unusual activity."] }, p)), "fail|captcha|wait-loop");
      check(`[${name}] captcha selector ชนะ HTTP บล็อก`,
        gw.judgeTick(tick({ captchaHit: "x", responses: [{ status: 403, body: null }] }), st(), p).message.includes("captcha ระหว่างรอ"), true);
      check(`[${name}] alert policy → flow_error`, sig(v({ alertText: "This violates our policy" }, p)), "fail|flow_error|");
      check(`[${name}] alert อื่น → รอต่อ`, v({ alertText: "Saved" }, p).kind, "wait");
      check(`[${name}] ไม่รับคำสั่งเกิน 45 วิ → selector_drift (ไม่กดซ้ำ)`,
        sig(v({ tilesNow: 5 }, p, st({ accepted: false, now: 46_000 }))), "fail|selector_drift|");
      check(`[${name}] ไม่รับคำสั่งแต่ยังไม่ถึง 45 วิ → รอ`, v({ tilesNow: 5 }, p, st({ accepted: false, now: 44_000 })).kind, "wait");
      check(`[${name}] มีช่องกำลังวาด → รับคำสั่งแล้ว`, v({ tilesNow: 5, pendingNow: 1 }, p, st({ accepted: false, now: 46_000 })).accepted, true);
      check(`[${name}] โฮสต์ไม่มี resultTile (tilesNow null) → ไม่เช็กการรับคำสั่ง`, v({ tilesNow: null }, p, st({ accepted: false, now: 99_000 })).kind, "wait");
    }
    check("ข้อความ HTTP คงเดิม: รูป dom", v({ responses: [{ status: 403, body: null }] }, IMG_DOM).message, "Flow ตอบ HTTP 403 หลังกด Generate");
    check("ข้อความ HTTP คงเดิม: คลิป", v({ responses: [{ status: 403, body: null }] }, VID).message, "Flow ตอบ HTTP 403 หลังกดสร้างคลิป");
    check("ข้อความ captcha คงเดิม: คลิป", v({ captchaHit: "x" }, VID).message, "เจอสัญญาณ captcha ระหว่างรอคลิป: x");
    check("ข้อความไม่รับคำสั่ง คงเดิม: รูป", v({ tilesNow: 5 }, IMG_DOM, st({ accepted: false, now: 46_000 })).message,
      "กด Generate แล้วแต่ Flow ไม่เริ่มวาดภายใน 45 วิ (คลิกไม่ติด หรือปุ่มเปลี่ยน)");
    check("network: HTTP 500 ของ RPC เจนรูป → flow_error ไม่ลง bot_signal", sig(v({ responses: [{ status: 500, body: "oops" }] }, IMG_NET)), "fail|flow_error|");
    check("network: ข้อความแนบ body", v({ responses: [{ status: 500, body: "oops" }] }, IMG_NET).message, "Flow ตอบ HTTP 500: oops");
    check("dom: HTTP 500 ของ RPC อื่นใน batchexecute → ไม่หยุด", v({ responses: [{ status: 500, body: null }] }, IMG_DOM).kind, "wait");
    check("คลิป: HTTP 404 → ไม่หยุด", v({ responses: [{ status: 404, body: null }] }, VID).kind, "wait");
    check("รูป: ได้ครบ 4 → เสร็จ", v({ goodCount: 4 }, IMG_DOM).kind, "done");
    check("รูป: การ์ดพัง 2 + รูปดี 2 = ครบทุกช่อง → flow_error ทันที",
      v({ goodCount: 2, freshErrorTiles: 2, errorTileTexts: ["Failed Sorry, this image failed to generate"] }, IMG_DOM).message,
      "Flow วาดไม่สำเร็จ 2/4 รูป (failed to generate — ไม่เสียเครดิต)");
    check("รูป: การ์ดพัง 1 + รูปดี 1 → ยังรอช่องที่เหลือ", v({ goodCount: 1, freshErrorTiles: 1, errorTileTexts: ["failed to generate"] }, IMG_DOM).kind, "wait");
    check("คลิป: การ์ดพัง 1 → flow_error ทันที", v({ freshErrorTiles: 1, errorTileTexts: ["failed"] }, VID).message, "Flow ทำคลิปไม่สำเร็จ (การ์ด error ในกริด)");
    check("คลิป: มีคลิปใหม่แต่ยังมีช่องกำลังทำ → รอ", v({ goodCount: 1, pendingNow: 1 }, VID).kind, "wait");
    check("คลิป: มีคลิปใหม่และไม่เหลือช่องกำลังทำ → เสร็จ", v({ goodCount: 1, pendingNow: 0 }, VID).kind, "done");
    // ลำดับเดิมของแต่ละรอบ (คงไว้): รูปเช็กผลครบก่อนการ์ด · คลิปเช็กการ์ดก่อนผล
    check("รูป: ได้ครบแล้วชนะการ์ด error (ลำดับเดิม)", v({ goodCount: 4, freshErrorTiles: 1, errorTileTexts: ["unusual activity"] }, IMG_DOM).kind, "done");
    check("คลิป: การ์ด error ชนะคลิปใหม่ (ลำดับเดิม)", v({ goodCount: 1, freshErrorTiles: 1, errorTileTexts: ["failed"] }, VID).kind, "fail");
    check("ข้อความหมดเวลา: รูป", IMG_DOM.text.timeout(300000), "รอผลเกิน 300000 ms");
    check("ข้อความหมดเวลา: คลิป", VID.text.timeout(480000), "รอคลิปเกิน 480000 ms");

    // ลูปจริงกับหน้าปลอม + นาฬิกาปลอม (ไม่มี browser)
    const fakeClock = () => { let t = 0; return { now: () => t, sleep: async (ms) => { t += ms; }, at: () => t }; };
    const source = (ticks) => {
      let i = 0;
      const seen = [];
      return {
        seen, canConfirmAccept: true,
        async observe(accepted) { seen.push(accepted); return tick(ticks[Math.min(i++, ticks.length - 1)]); },
        settle: (t) => t.value,
      };
    };
    const run = async (p, src, clock, timeoutMs = 600_000) => {
      const signals = [];
      try {
        const value = await gw.runWatch(src, p, { submitAt: 0, timeoutMs, onBotSignal: (s) => signals.push(s) }, clock);
        return { value, signals };
      } catch (e) {
        return { step: e.step, kind: e.kind, message: e.message, signals };
      }
    };
    {
      const c = fakeClock();
      const r = await run(IMG_DOM, source([{ tilesNow: 9 }, { goodCount: 2 }, { goodCount: 4, value: ["a", "b", "c", "d"] }]), c);
      check("runWatch: ได้รูปครบ → คืนค่า", JSON.stringify(r.value), '["a","b","c","d"]');
      check("runWatch: ดูหน้าทุก 2 วิ แล้วรอ straggler 2.5 วิก่อนคืน", c.at(), 2 * gw.TICK_MS + gw.SETTLE_MS);
    }
    {
      const src = source([{ tilesNow: 9 }, {}]);
      await run(IMG_DOM, src, fakeClock(), 10_000);
      check("runWatch: รับคำสั่งแล้วไม่นับช่องในกริดอีก (accepted ส่งต่อ)", JSON.stringify(src.seen.slice(0, 2)), "[false,true]");
    }
    {
      const r = await run(VID, source([{}, { captchaHit: "text=unusual traffic" }]), fakeClock());
      check("runWatch: captcha → FlowStepError ชื่อขั้น wait-render", `${r.step}|${r.kind}`, "wait-render|captcha");
      check("runWatch: เรียก onBotSignal ครั้งเดียวก่อน throw", JSON.stringify(r.signals), '["wait-loop"]');
    }
    {
      const r = await run(IMG_DOM, source([{ responses: [{ status: 403, body: null }] }]), fakeClock());
      check("runWatch: HTTP 403 → captcha ชื่อขั้น wait-results + bot_signal http 403", `${r.step}|${r.kind}|${r.signals.join()}`, "wait-results|captcha|http 403");
    }
    {
      const r = await run(IMG_DOM, source([{ freshErrorTiles: 4, errorTileTexts: ["failed to generate"] }]), fakeClock());
      check("runWatch: Flow วาดพังเอง → flow_error ไม่ลง bot_signal", `${r.kind}|${r.signals.length}`, "flow_error|0");
    }
    {
      const r = await run(VID, source([{}]), fakeClock(), 10_000);
      check("runWatch: ครบเวลา → generation_timeout", `${r.step}|${r.kind}|${r.message}`, "wait-render|generation_timeout|รอคลิปเกิน 10000 ms");
    }
    {
      const src = { ...source([{ tilesNow: 5 }]), canConfirmAccept: false };
      const r = await run(IMG_DOM, src, fakeClock(), 120_000);
      check("runWatch: โฮสต์ยืนยันการรับคำสั่งไม่ได้ → ไม่พังด้วยคลิกไม่ติด", r.kind, "generation_timeout");
    }
    {
      const r = await run(IMG_DOM, source([{ tilesNow: 5 }]), fakeClock(), 120_000);
      check("runWatch: กดแล้วกริดไม่ขยับเกิน 45 วิ → selector_drift (ไม่กดซ้ำ)", `${r.kind}|${r.step}`, "selector_drift|wait-results");
    }
    check("collectImageUrls: เดิน JSON เก็บเฉพาะ host ที่อนุญาต",
      JSON.stringify(gw.collectImageUrls({ a: ["https://x.googleusercontent.com/i.png", "https://evil.example/i.png"], b: { c: "https://flow.google.com/asb/1" } }, ["googleusercontent.com", "flow.google.com"])),
      '["https://x.googleusercontent.com/i.png","https://flow.google.com/asb/1"]');
  }
  // adapter หน้าจริงกับหน้าปลอม — อ่านเฉพาะที่โค้ดเดิมอ่าน (หยุดอ่านเมื่อได้คำตัดสิน) และได้ผลเดียวกัน
  {
    const SEL = {
      captchaSignals: ["iframe[src*='recaptcha']"], errorTile: "flow-error-tile", resultTile: "flow-grid-tile-container",
      pendingTile: "flow-pending-tile", results: { strategy: "dom", imageUrlHosts: ["flow.google.com"] },
    };
    const fakePage = (st) => {
      const reads = [];
      return {
        reads, st,
        locator: (q) => ({
          count: async () => { reads.push(`count ${q}`); return st.counts[q] ?? 0; },
          allInnerTexts: async () => { reads.push(`texts ${q}`); return st.texts[q] ?? []; },
          evaluateAll: async () => { reads.push(`eval ${q}`); return st.evals[q] ?? []; },
        }),
      };
    };
    const clock = () => { let t = 0; return { now: () => t, sleep: async (ms) => { t += ms; } }; };
    const runArgs = (responses = []) => ({ submitAt: 0, responses, timeoutMs: 600_000, onBotSignal: () => {} });
    const settle = async (p) => { try { return { value: await p }; } catch (e) { return { step: e.step, kind: e.kind, message: e.message }; } };

    {
      const page = fakePage({ counts: { "flow-grid-tile-container": 5 }, texts: {}, evals: { img: ["https://flow.google.com/asb/old"] } });
      const w = await gw.armImageWatch(page, SEL, 4);
      check("armImageWatch นับก่อนกด: รูป → การ์ด error → ช่องในกริด", page.reads.join(" / "), "eval img / count flow-error-tile / count flow-grid-tile-container");
      page.reads.length = 0;
      page.st.evals.img = ["https://flow.google.com/asb/old", ...[1, 2, 3, 4].map((i) => `https://flow.google.com/asb/n${i}`)];
      const r = await settle(w.wait(runArgs(), clock()));
      check("รอบรูป dom: ได้รูปใหม่ 4 รูป (ไม่นับรูปเก่า)", JSON.stringify(r.value), JSON.stringify([1, 2, 3, 4].map((i) => `https://flow.google.com/asb/n${i}`)));
      check("รอบรูป: ได้ครบแล้วไม่อ่านการ์ด error/alert ต่อ (เหมือนเดิม)", page.reads.join(" / "), "count iframe[src*='recaptcha'] / eval img");
    }
    {
      const page = fakePage({ counts: { "flow-grid-tile-container": 5 }, texts: {}, evals: {} });
      const w = await gw.armImageWatch(page, { ...SEL, results: { strategy: "network", imageUrlHosts: ["googleusercontent.com"] } }, 4);
      const responses = [{ status: 200, body: { u: [1, 2, 3, 4].map((i) => `https://x.googleusercontent.com/${i}`) }, at: 10 }];
      const r = await settle(w.wait(runArgs(responses), clock()));
      check("รอบรูป network: URL จาก response หลังกด", r.value?.length, 4);
    }
    {
      const page = fakePage({ counts: { "flow-grid-tile-container": 5 }, texts: {}, evals: {} });
      const w = await gw.armImageWatch(page, SEL, 4);
      page.st.counts["iframe[src*='recaptcha']"] = 1;
      const r = await settle(w.wait(runArgs(), clock()));
      check("รอบรูป: captcha ระหว่างรอ → หยุดอ่านทันที", `${r.kind}|${page.reads.slice(3).join(" / ")}`, "captcha|count iframe[src*='recaptcha']");
    }
    {
      const page = fakePage({ counts: { "flow-grid-tile-container": 5 }, texts: {}, evals: { img: [] } });
      const w = await gw.armImageWatch(page, SEL, 4);
      page.reads.length = 0;
      page.st.counts["flow-error-tile"] = 4;
      page.st.texts["flow-error-tile"] = ["Failed Sorry, this image failed to generate"];
      const r = await settle(w.wait(runArgs(), clock()));
      check("รอบรูป: การ์ดพังครบ 4 → flow_error และไม่อ่านกริด/alert ต่อ (เหมือนเดิม)", `${r.kind}|${page.reads.join(" / ")}`,
        "flow_error|count iframe[src*='recaptcha'] / eval img / count flow-error-tile / texts flow-error-tile");
    }
    {
      const page = fakePage({ counts: { "flow-grid-tile-container": 5 }, texts: {}, evals: { img: [] } });
      const w = await gw.armImageWatch(page, SEL, 4);
      page.reads.length = 0;
      page.st.counts["flow-error-tile"] = 1;
      page.st.texts["flow-error-tile"] = ["failed to generate"];
      const r = await settle(w.wait({ ...runArgs(), timeoutMs: 1 }, clock()));
      check("รอบรูป: การ์ดพัง 1 ใบยังไม่ครบ → อ่านต่อ (กริด → ช่องกำลังวาด → alert) แล้วรอ", `${r.kind}|${page.reads.slice(4).join(" / ")}`,
        "generation_timeout|count flow-grid-tile-container / count flow-pending-tile / count [role='alert'], [aria-live='assertive']");
    }
    {
      const ids = [];
      const page = fakePage({ counts: { "flow-grid-tile-container": 5 }, texts: {}, evals: {} });
      const readIds = async (step) => { page.reads.push(`ids ${step}`); return ids.slice(); };
      ids.push("old");
      const w = await gw.armRenderWatch(page, SEL, readIds);
      check("armRenderWatch นับก่อนกด: การ์ด error → ช่องในกริด → id ช่องวิดีโอ (ขั้น click-generate)",
        page.reads.join(" / "), "count flow-error-tile / count flow-grid-tile-container / ids click-generate");
      page.reads.length = 0;
      page.st.counts["flow-error-tile"] = 1;
      page.st.texts["flow-error-tile"] = ["Failed"];
      const r = await settle(w.wait(runArgs(), clock()));
      check("รอบคลิป: การ์ด error ใหม่ → flow_error ชื่อขั้น wait-render", `${r.step}|${r.kind}`, "wait-render|flow_error");
      check("รอบคลิป: เจอการ์ดแล้วไม่อ่านช่องกำลังทำ/id/alert ต่อ (เหมือนเดิม)",
        page.reads.join(" / "), "count iframe[src*='recaptcha'] / count flow-error-tile / texts flow-error-tile");
    }
    {
      const ids = ["old"];
      const page = fakePage({ counts: { "flow-grid-tile-container": 5 }, texts: {}, evals: {} });
      const w = await gw.armRenderWatch(page, SEL, async (step) => { page.reads.push(`ids ${step}`); return ids.slice(); });
      page.reads.length = 0;
      ids.unshift("new");
      page.st.counts["flow-grid-tile-container"] = 6;
      page.st.counts["flow-pending-tile"] = 1;
      const c = clock();
      let ticks = 0;
      const sleep = c.sleep;
      c.sleep = async (ms) => { ticks++; if (ticks === 1) page.st.counts["flow-pending-tile"] = 0; await sleep(ms); };
      const r = await settle(w.wait(runArgs(), c));
      check("รอบคลิป: ช่องใหม่มี thumbnail + ไม่เหลือช่องกำลังทำ → id ใหม่", r.value, "new");
      check("รอบคลิป: ยังมีช่องกำลังทำ → อ่านครบทุกอย่างแล้วรอ (การ์ด → ช่องกำลังทำ → id → กริด → alert)",
        page.reads.slice(0, 6).join(" / "),
        "count iframe[src*='recaptcha'] / count flow-error-tile / count flow-pending-tile / ids wait-render / count flow-grid-tile-container / count [role='alert'], [aria-live='assertive']");
      check("รอบคลิป: รับคำสั่งแล้ว + เสร็จ → ไม่นับกริด ไม่อ่าน alert (เหมือนเดิม)", page.reads.slice(6).join(" / "),
        "count iframe[src*='recaptcha'] / count flow-error-tile / count flow-pending-tile / ids wait-render");
    }
  }
  // ตัวเฝ้าอ่านหน้าอย่างเดียว — ไม่มีทางกด Generate ซ้ำ
  {
    const src = readFileSync("worker/generation-watch.ts", "utf8");
    check("generation-watch ไม่คลิก/กดอะไรเลย (ไม่มี humanClick / .click( / mouse / keyboard / sel.submit)",
      /humanClick|\.click\(|\.mouse\.|\.keyboard\.|\.submit\b/.test(src), false);
  }

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

// สูตรของบอท (flow-driver.ts) แยกต่อรอบบน Flow session (flow-session.ts) — ไม่มีฟังก์ชันเดียวที่ถือทุกรอบแล้วออกกลางทาง
// (เดิม runRound ถือรอบ 1-4 · ตัวแปรที่ประกาศใต้บรรทัดแยกทางทำรอบ 4 พังด้วย TDZ ทุกครั้ง 2026-10-01)
// ตอนนี้ closure ร่วมอยู่ใน withFlowSession — สถานะของ session ต้องประกาศก่อนฟังก์ชันภายในทุกตัว (กัน TDZ แบบเดียวกัน)
{
  const session = readFileSync("worker/flow-session.ts", "utf8").replace(/\r\n/g, "\n");
  const driver = readFileSync("worker/flow-driver.ts", "utf8").replace(/\r\n/g, "\n");
  const factory = session.indexOf("export async function withFlowSession");
  const body = factory >= 0 ? session.slice(factory) : "";
  const firstFn = body.search(/\n {2}(async )?function /);
  const state = body.slice(0, firstFn < 0 ? 0 : firstFn).split("\n").filter((l) => /^ {2}(let|const) /.test(l));
  const late = (firstFn < 0 ? "" : body.slice(firstFn)).split("\n").filter((l) => /^ {2}let /.test(l));
  check("withFlowSession: สถานะ (responses) ประกาศก่อนฟังก์ชันภายในตัวแรก", state.some((l) => l.includes("const responses")), true);
  check("withFlowSession: ไม่มี let ระดับ session หลังฟังก์ชันภายในตัวแรก", late.join(" | "), "");
  check("flow-driver ไม่แยกทางตามรอบกลางสูตร (ไม่มี round === 3/4)", /round === [34]/.test(driver), false);
  check("flow-driver มีสูตรครบ 3 ตัว", ["drawImages", "renderClip", "fetchFinalClip"].every((n) => driver.includes(`export async function ${n}(`)), true);
  check("ทุกสูตรเดินบน withFlowSession (ติด/ถอด listener ของ response ที่เดียว)", (driver.match(/return withFlowSession\(ctx, /g) ?? []).length, 3);
  check("page.on/off(\"response\") อยู่ flow-session ที่เดียว", /page\.(on|off)\("response"/.test(driver), false);
  // ด่านกันเสียเครดิตกับคลิปที่ไม่มีพรอมต์อยู่ที่สูตรที่จ่ายเครดิต (ก่อนแตะหน้า) ที่เดียว · ด่านข้อมูลคลิปที่ผ่านอยู่ที่ processJob ที่เดียว
  const index = readFileSync("worker/index.ts", "utf8").replace(/\r\n/g, "\n");
  const renderAt = driver.indexOf("export async function renderClip(");
  const guardAt = driver.indexOf('throw new FlowStepError("paste-prompt", "worker_crash", "entry นี้ยังไม่มี 10-part prompt');
  check("renderClip ตรวจ 10-part prompt ว่างก่อน withFlowSession", guardAt > renderAt && guardAt < driver.indexOf("return withFlowSession(ctx, 3,", renderAt), true);
  check("processJob ไม่ตรวจ 10-part prompt ซ้ำ", /chatgptOutput\.trim\(\)/.test(index), false);
  check("ด่าน media id ของ Final clip มีที่เดียว (processJob)", (index + driver).split("ไม่มีข้อมูลคลิปที่ผ่าน (media id / project)").length - 1, 1);
  check("flow-driver ไม่มีด่าน media id ซ้ำ", /mediaId === ""/.test(driver), false);
}

// รอบ 4: findTileIndex ต้องตัดสินด้วย knownTileIndex (ไม่มีทางลัด "ช่องเดียวใช้เลย") และโหลด 1080p ต้องเช็ก id ของไฟล์
// การดึงไฟล์คลิปทั้งหมดอยู่ worker/clip-capture.ts (ADR 0003) — สถานะ (foundTiles / lastDirectVideoUuid) เป็นของ instance
{
  const src = readFileSync("worker/clip-capture.ts", "utf8").replace(/\r\n/g, "\n");
  const driver = readFileSync("worker/flow-driver.ts", "utf8").replace(/\r\n/g, "\n");
  check("clip-capture ไม่มีทางลัดโปรเจกต์ช่องเดียว (ids.length === 1)", /ids\.length === 1/.test(src), false);
  check("findTileIndex ใช้ knownTileIndex", /async function findTileIndex[^]*?knownTileIndex\(/.test(src), true);
  check("downloadVideo เช็ก id ของไฟล์ด้วย fileUrlIsMedia เมื่อ verifyId", /if \(verifyId && !fileUrlIsMedia\(url, mediaId\)\)/.test(src), true);
  check("captureFinal (1080p) เปิด verifyId", /async captureFinal[^]*?downloadVideo\("download-final", mediaId, [^\n]*finalQuality, filename, true\)/.test(src), true);
  const factory = src.indexOf("export function clipCapture(");
  const firstFn = src.indexOf("function videoSel(", factory);
  const stateAt = [src.indexOf("let lastDirectVideoUuid", factory), src.indexOf("const foundTiles", factory)];
  check("สถานะของ clipCapture ประกาศก่อนฟังก์ชันภายในทุกตัว (กัน TDZ)", stateAt.every((i) => i > factory && i < firstFn), true);
  const session = readFileSync("worker/flow-session.ts", "utf8");
  check("flow-driver / flow-session ไม่ถือสถานะของการโหลดคลิปเองแล้ว", /foundTiles|lastDirectVideoUuid/.test(driver + session), false);
}

// ticket 07: บอทไม่วาดรอบ 1–2 ด้วยชื่อเต็มของร้าน — ย่อเองก่อนหยิบ ไม่ได้ = ข้ามไปงานถัดไป งานยังอยู่ในคิว (ไม่ pause ไม่นับงานพัง
// ไม่เสียเพดาน ไม่ลง FlowActivity) · ลำดับ/การรอเป็น pure (claimSequence/shortNameRetryDelayMs ตรวจใน check-flow-jobs.mjs)
{
  const index = readFileSync("worker/index.ts", "utf8").replace(/\r\n/g, "\n");
  const fnBody = (sig) => {
    const at = index.indexOf(sig);
    return at < 0 ? "" : index.slice(at, index.indexOf("\n}\n", at));
  };
  const claimFn = fnBody("async function claimNextJob(");
  const gateFn = fnBody("async function shortNameReady(");
  check("claimNextJob เลือกงานด้วย claimSequence (ข้ามงานที่รอชื่อ)", claimFn.includes("claimSequence("), true);
  const gateAt = claimFn.indexOf("shortNameReady(");
  const claimAt = claimFn.indexOf("applyBulk(claim(");
  check("claimNextJob: ด่านชื่อสั้น (รอบ 1–2) อยู่ก่อน claim — งานที่ย่อไม่ได้ไม่ถูกแตะ ยัง queued", gateAt >= 0 && claimAt > gateAt && /needsShortNameGate\(round\)/.test(claimFn), true);
  check("ด่านชื่อสั้นใช้ ensureShortName ตัวเดียวกับเบื้องหลัง + จำเวลาลองใหม่ด้วย shortNameRetryDelayMs", gateFn.includes("ensureShortName(") && gateFn.includes("shortNameRetryDelayMs("), true);
  check("ย่อไม่ได้ ≠ งานพัง: ไม่ pause ไม่เขียนงาน ไม่ลง FlowActivity", /pauseWorker\(|applyPlan\(|applyBulk\(|logActivity\(|markJobFailed/.test(gateFn), false);
  check("claimNextJob ไม่ pause / ไม่ลง FlowActivity", /pauseWorker\(|logActivity\(/.test(claimFn), false);
  // พรอมต์ Flow ไม่มีทางได้ชื่อเต็ม: drawImages (ที่เดียวที่พิมพ์ productName ผ่าน buildFlowPrompt) ถูกเรียกครั้งเดียว และมีด่านสุดท้ายก่อนหน้า
  const drawCalls = index.split("await drawImages(").length - 1;
  const drawAt = index.indexOf("await drawImages(");
  const backstopAt = index.lastIndexOf("isUnshortenedName(job.entry", drawAt);
  check("drawImages ถูกเรียกที่เดียวใน worker", drawCalls, 1);
  check("processJob ตรวจ isUnshortenedName ของชื่อที่จะพิมพ์ (job.entry) ก่อน drawImages", backstopAt > index.indexOf("async function processJob(") && backstopAt < drawAt, true);
  // ด่านสุดท้ายเจอชื่อร้าน = คืนงานเข้าคิว (lifecycle + applyBulk กันแข่ง) ไม่ใช่งานพัง: ไม่ throw/pause/FlowActivity · main ไม่นับเพดาน/round_ok
  const backstop = backstopAt < 0 ? "" : index.slice(backstopAt, drawAt);
  check("ด่านสุดท้าย: คืนงานด้วย applyBulk(releaseForShortName(round), { id: job.id }) แล้ว return \"released\"",
    /applyBulk\(releaseForShortName\(round\), \{ id: job\.id \}\)/.test(backstop) && backstop.includes('return "released"'), true);
  check("ด่านสุดท้าย: ไม่ throw / ไม่ pause / ไม่ลง FlowActivity", /throw |pauseWorker\(|logActivity\(/.test(backstop), false);
  const loop = fnBody("async function main(");
  const releasedAt = loop.indexOf('ok === "released"');
  check("main: งานที่คืนเข้าคิวข้ามไปก่อนนับ round_ok / เพดาน / พักระหว่างสินค้า",
    releasedAt >= 0 && releasedAt < loop.indexOf('kind: "round_ok"') && releasedAt < loop.indexOf("todayBatches: { increment") && releasedAt < loop.indexOf('why: "between"'), true);
}

// ticket 05 (เปลี่ยนรูปต้นทาง): งานมีแถว source ได้หลายแถว — รอบ 1 ต้องแนบรูปต้นทางล่าสุด (attempt สูงสุด, index ต่ำสุดใน attempt นั้น)
// ไม่ใช่แถวแรกตาม index (ของเดิม = รูปเก่าที่ผู้ใช้เปลี่ยนทิ้งไปแล้ว) · ตัวเลือกเป็น pure ใน lib/flow-jobs.ts ใช้ร่วมกับหน้า /flow และโฟลเดอร์ TTS
{
  const libOut = mkdtempSync(join(process.cwd(), ".check-flow-tmp-"));
  try {
    execFileSync("npx", ["tsc", "lib/flow-jobs.ts", "--outDir", libOut, "--module", "es2022", "--target", "ES2017", "--moduleResolution", "bundler"], { stdio: "inherit", shell: true });
    const f = await import(pathToFileURL(join(libOut, "flow-jobs.js")).href);
    const src = (attempt, index, filename) => ({ kind: "source", round: 0, attempt, index, filename });
    const cand = (round, attempt, index) => ({ kind: "candidate", round, attempt, index, filename: `r${round}-a${attempt}-${index}.png` });
    const pick = (images) => f.currentSourceImage(images)?.filename ?? null;
    check("งานใหม่ (แถว source เดียว) → แถวนั้น", pick([src(1, 0, "source-a1-0-x.jpg"), cand(1, 1, 0)]), "source-a1-0-x.jpg");
    check("เปลี่ยนรูปต้นทางแล้ว → แถว attempt ใหม่ ไม่ใช่แถวแรก", pick([src(1, 0, "old.jpg"), cand(1, 1, 0), cand(2, 1, 0), src(3, 0, "new.jpg")]), "new.jpg");
    check("ลำดับแถวไม่มีผล (DB อาจคืนแถวใหม่ก่อน)", pick([src(4, 0, "newest.png"), src(1, 0, "old.jpg"), src(2, 0, "mid.jpg")]), "newest.png");
    check("วาดใหม่หลังเปลี่ยนรูป (job.attempt เกิน attempt ของ source) → ยังได้รูปล่าสุด", pick([src(1, 0, "old.jpg"), src(3, 0, "new.jpg"), cand(1, 3, 0), cand(1, 4, 0)]), "new.jpg");
    check("เข้าคิวหลายรูปใน attempt เดียว → index ต่ำสุด (รูปแรก)", pick([src(1, 1, "second.jpg"), src(1, 0, "first.jpg")]), "first.jpg");
    check("ชื่อไฟล์แบบเก่า source-<index> ยังเลือกได้", pick([src(1, 0, "source-0.jpg")]), "source-0.jpg");
    check("ไม่มีแถว source → null", pick([cand(1, 1, 0)]), null);
  } finally {
    rmSync(libOut, { recursive: true, force: true });
  }
  const index = readFileSync("worker/index.ts", "utf8").replace(/\r\n/g, "\n");
  const refAt = index.indexOf("function imageReferenceFor(");
  const refFn = refAt < 0 ? "" : index.slice(refAt, index.indexOf("\n}\n", refAt));
  check("imageReferenceFor รอบ 1 ใช้ currentSourceImage (ไม่เรียงตาม index เอง)", refFn.includes("currentSourceImage(job.images)") && !/sort\(/.test(refFn), true);
}

if (failed > 0) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log("\nall checks passed");
