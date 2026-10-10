/**
 * ตรวจตรรกะของ lib/showcase.ts (สถานะ/ยุบแถวซ้ำ/วันเริ่มนับ/ลำดับ) — แทน test suite ที่โปรเจกต์นี้ไม่มี
 *
 * รัน: node scripts/check-showcase.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const out = mkdtempSync(join(process.cwd(), ".check-showcase-tmp-"));
let failed = 0;

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`      ได้ ${JSON.stringify(actual)}\n      ควรได้ ${JSON.stringify(expected)}`);
}

const SINCE = new Date("2026-09-29T00:00:00+07:00");
const day = (d) => new Date(`2026-${d}T12:00:00+07:00`);
const img = [{ id: "i1", filename: "a.jpg" }];
let n = 0;
const row = (over) => ({
  id: `r${++n}`,
  sourceProductId: "P",
  name: "สินค้า",
  price: 100,
  commission: 10,
  capturedOn: day("09-30"),
  linkedEntryId: null,
  dismissedAt: null,
  images: img,
  ...over,
});

try {
  // lib/showcase.ts ใช้ gate เดียวกับ /flow (canChangeSource ใน lib/flow-lifecycle.ts) — คอมไพล์ด้วยกันแล้วชี้ "@/lib/x" ไปไฟล์ข้างๆ
  // ไม่ได้ส่ง paths ให้ tsc: TS2307 ของ "@/lib/..." ตั้งใจ (ยัง emit .js, exit 2) แบบเดียวกับ check-flow-lifecycle.mjs
  try {
    execFileSync(
      "npx",
      ["tsc", "lib/showcase.ts", "lib/flow-lifecycle.ts", "lib/flow-jobs.ts", "lib/flow-network.ts", "--outDir", out, "--module", "es2022", "--target", "ES2017", "--moduleResolution", "bundler"],
      { stdio: "pipe", shell: true }
    );
  } catch (e) {
    const diag = String(e.stdout ?? "");
    if (e.status !== 2 || diag.split("\n").some((l) => l.includes("error TS") && !l.includes("TS2307"))) {
      console.log(diag);
      throw e;
    }
  }
  for (const f of ["showcase.js", "flow-lifecycle.js"]) {
    const file = join(out, f);
    writeFileSync(file, readFileSync(file, "utf8").replace(/["']@\/lib\/([\w-]+)["']/g, '"./$1.js"'));
  }
  const s = await import(pathToFileURL(join(out, "showcase.js")).href);
  const build = (rows, urls = new Map()) => s.buildShowcaseItems(rows, urls, SINCE);

  // --- สถานะ ---
  check("ยังไม่ทำอะไร = todo", build([row()]).map((i) => i.status), ["todo"]);
  check("ผูกงานแล้วไม่มีลิงก์คลิป = in_progress", build([row({ linkedEntryId: "E" })], new Map([["E", ""]])).map((i) => i.status), ["in_progress"]);
  check("งานมีลิงก์คลิป = posted", build([row({ linkedEntryId: "E" })], new Map([["E", "https://tiktok.com/@a/video/1"]])).map((i) => i.status), ["posted"]);
  check("กดไม่ทำแล้ว = dismissed", build([row({ dismissedAt: day("09-30") })]).map((i) => i.status), ["dismissed"]);
  check("ผูกงานแล้วชนะไม่ทำแล้ว", build([row({ linkedEntryId: "E", dismissedAt: day("09-30") })], new Map([["E", ""]])).map((i) => i.status), ["in_progress"]);
  check("Entry ถูกลบไปแล้ว (ลิงก์ค้าง) = กลับเป็น todo", build([row({ linkedEntryId: "GONE" })]).map((i) => [i.status, i.linkedEntryId]), [["todo", null]]);

  // --- วันเริ่มนับ ---
  check("เข้ามาก่อนวันเริ่มนับ = ไม่นับ", build([row({ capturedOn: day("09-24") })]).length, 0);
  check("วันเริ่มนับพอดี (เที่ยงคืนไทย) = นับ", build([row({ capturedOn: SINCE })]).length, 1);
  check(
    "เห็นครั้งแรกก่อนวันเริ่ม แล้วถูกส่งซ้ำหลังวันเริ่ม = ยังไม่นับ",
    build([row({ capturedOn: day("09-24") }), row({ capturedOn: day("10-01") })]).length,
    0
  );

  // --- ยุบแถวซ้ำ ---
  const linked = row({ capturedOn: day("10-02"), linkedEntryId: "E" });
  const merged = build([row({ capturedOn: day("09-30") }), linked], new Map([["E", ""]]));
  check("สินค้าเดียว 2 ชุด = เหลือ 1 รายการ", merged.length, 1);
  check("แถวที่ผูกงานชนะ", merged[0].id, linked.id);
  check("firstSeen = ครั้งแรกที่เห็น ไม่ใช่ของแถวที่ชนะ", merged[0].firstSeen.toISOString(), day("09-30").toISOString());
  const noImg = row({ capturedOn: day("09-30"), images: [] });
  const withImg = row({ capturedOn: day("10-01") });
  check("ไม่ผูกงานทั้งคู่ = แถวที่มีรูปชนะ", build([noImg, withImg])[0].id, withImg.id);
  check(
    "ไม่ทำแล้วติดอยู่ แม้ชุดที่ส่งซ้ำมาทีหลังยังว่าง",
    build([row({ capturedOn: day("09-30"), dismissedAt: day("09-30") }), row({ capturedOn: day("10-01") })])[0].status,
    "dismissed"
  );
  check(
    "สินค้าคนละ ID ชื่อซ้ำกัน = แยกกัน 2 รายการ (ห้ามจับด้วยชื่อ)",
    build([row({ sourceProductId: "A", name: "ที่ลับเล็บแมว" }), row({ sourceProductId: "B", name: "ที่ลับเล็บแมว" })]).length,
    2
  );

  // --- ลำดับในแท็บ ---
  const items = build([
    row({ sourceProductId: "new", capturedOn: day("10-03") }),
    row({ sourceProductId: "old", capturedOn: day("09-30") }),
    row({ sourceProductId: "mid", capturedOn: day("10-01") }),
  ]);
  check("ยังไม่เริ่ม: ค้างนานสุดขึ้นก่อน", s.itemsForTab(items, "todo").map((i) => i.sourceProductId), ["old", "mid", "new"]);
  const done = build(
    [
      row({ sourceProductId: "d1", capturedOn: day("09-30"), dismissedAt: day("10-05") }),
      row({ sourceProductId: "d2", capturedOn: day("10-02"), dismissedAt: day("10-05") }),
    ]
  );
  check("แท็บอื่น: ใหม่สุดขึ้นก่อน", s.itemsForTab(done, "dismissed").map((i) => i.sourceProductId), ["d2", "d1"]);
  check("แท็บกรองเฉพาะสถานะนั้น", s.itemsForTab(done, "todo").length, 0);

  // --- ปุ่ม "เลือกรูปใหม่" (ticket 05: กติกาเดียวกับ "เปลี่ยนรูปต้นทาง" ของ /flow — canChangeSource) ---
  // retry = ไม่มีงาน/งานพังหรือถูกข้าม (ป้ายแดง) · change = งานยังเปิดก่อนเริ่มเรนเดอร์ (ปุ่มเฉยๆ) · blocked = ไปจัดการที่คิว Flow · busy = ไม่มีปุ่ม
  check("ยังไม่มีงาน Flow = เลือกรูปใหม่ได้", s.showcaseFlowState(null), "retry");
  check("งานถูกข้ามรอบ 1 = เลือกรูปใหม่ได้", s.showcaseFlowState({ status: "skipped", errorKind: "", round: 1 }), "retry");
  check("งานถูกข้ามรอบ 2 = เลือกรูปใหม่ได้", s.showcaseFlowState({ status: "skipped", errorKind: "", round: 2 }), "retry");
  check("งานถูกข้ามตอนเรนเดอร์ (รอบ 3+) = ไม่มีปุ่ม (เริ่มเรนเดอร์แล้ว)", s.showcaseFlowState({ status: "skipped", errorKind: "", round: 3 }), "busy");
  check("Flow วาดไม่สำเร็จเอง = เลือกรูปใหม่ได้", s.showcaseFlowState({ status: "failed", errorKind: "flow_error", round: 1 }), "retry");
  check("Flow วาดไม่สำเร็จเองรอบ 2 = เลือกรูปใหม่ได้", s.showcaseFlowState({ status: "failed", errorKind: "flow_error", round: 2 }), "retry");
  check("โดนจับว่าเป็นบอท = ห้ามทางลัด (ต้องพัก 1 ชม.)", s.showcaseFlowState({ status: "failed", errorKind: "captcha", round: 1 }), "blocked");
  check("login หลุด = ห้ามทางลัด", s.showcaseFlowState({ status: "failed", errorKind: "login_required", round: 1 }), "blocked");
  check(
    "Render (รอบ 3) พังแม้เป็น flow_error = ห้ามทางลัด (จะทิ้งรูปที่เลือกไว้ทั้ง 2 รอบ)",
    s.showcaseFlowState({ status: "failed", errorKind: "flow_error", round: 3 }),
    "blocked"
  );
  check(
    "โหลด 1080p (round 4) พัง = ห้ามทางลัด",
    s.showcaseFlowState({ status: "failed", errorKind: "download_failed", round: 4 }),
    "blocked"
  );
  for (const [st, round] of [["queued_r1", 1], ["review_r1", 1], ["queued_r2", 2], ["review_r2", 2], ["awaiting_prompt", 3], ["queued_r3", 3]]) {
    check(`${st} = เปลี่ยนรูปได้ (ก่อนเริ่มเรนเดอร์)`, s.showcaseFlowState({ status: st, errorKind: "", round }), "change");
  }
  for (const [st, round] of [["running_r1", 1], ["running_r2", 2], ["running_r3", 3], ["review_r3", 3], ["queued_upscale", 4], ["running_upscale", 4], ["done", 3], ["done", 2]]) {
    check(`${st} = ไม่มีปุ่ม`, s.showcaseFlowState({ status: st, errorKind: "", round }), "busy");
  }

  // --- รูปจากร้านของ entry (ตัวเลือกรูปต้นทางในหน้า /flow) ---
  {
    const im = (id) => ({ id, filename: `${id}.jpg` });
    const r = (over) => ({ id: "x", sourceProductId: "P", linkedEntryId: null, capturedOn: day("09-30"), images: [], ...over });
    const photos = (rows) => s.shopPhotosForEntry(rows, "E").map((p) => `${p.candidateId}/${p.filename}`);
    check("แถวที่ผูกกับ entry และมีรูป → รูปของแถวนั้นตามลำดับ", photos([r({ id: "a", linkedEntryId: "E", images: [im("1"), im("2")] })]), ["a/1.jpg", "a/2.jpg"]);
    check("แถวที่ผูกไม่มีรูป → ใช้แถวเก่าสุดของสินค้าเดียวกันที่มีรูป",
      photos([r({ id: "a", linkedEntryId: "E" }), r({ id: "b", capturedOn: day("10-02"), images: [im("3")] }), r({ id: "c", capturedOn: day("10-01"), images: [im("4")] })]), ["c/4.jpg"]);
    check("สแกนซ้ำ (หลายแถวมีรูป) → ชุดเดียว ไม่ซ้ำ (แถวที่ผูกชนะ)",
      photos([r({ id: "b", capturedOn: day("09-29"), images: [im("5")] }), r({ id: "a", linkedEntryId: "E", images: [im("1")] })]), ["a/1.jpg"]);
    check("สินค้าที่ไม่ได้ผูกกับ entry นี้ไม่มา", photos([r({ id: "z", sourceProductId: "Q", linkedEntryId: "OTHER", images: [im("9")] }), r({ id: "y", sourceProductId: "Q", images: [im("8")] })]), []);
    check("entry ที่ไม่ได้มาจาก Showcase → ว่าง", photos([]), []);
  }

  // --- แฮชแท็กที่ต้องลง ---
  {
    const withTags = s.buildShowcaseItems(
      [row({ sourceProductId: "P1" }), row({ sourceProductId: "P2" })],
      new Map(),
      SINCE,
      new Map([["P1", ["#a", "#b"]]])
    );
    check("สินค้าที่มีแฮชแท็กได้รายการ", withTags.find((i) => i.sourceProductId === "P1").hashtags, ["#a", "#b"]);
    check("สินค้าที่ไม่มี = รายการว่าง (ไม่ใช่ undefined)", withTags.find((i) => i.sourceProductId === "P2").hashtags, []);
    check("ไม่ส่ง map = ทุกตัวว่าง (เรียกแบบเดิมยังได้)", build([row()])[0].hashtags, []);
    const twoBatches = s.buildShowcaseItems(
      [row({ sourceProductId: "P1", capturedOn: day("09-30") }), row({ sourceProductId: "P1", capturedOn: day("10-02") })],
      new Map(),
      SINCE,
      new Map([["P1", ["#x"]]])
    );
    check("สินค้าเดียว 2 ชุด = รายการเดียว แฮชแท็กเดียว", twoBatches.map((i) => i.hashtags), [["#x"]]);
  }

  // --- ชุดที่เข้ามาล่าสุด (ปุ่ม "เลือกชุดล่าสุด" ของหน้า Showcase) ---
  {
    const it = (id, firstSeen) => ({ sourceProductId: id, firstSeen });
    const ids = (r) => (r === null ? null : r.ids);
    const t = (iso) => new Date(iso);
    check(
      "ชุดล่าสุด = สินค้าที่เวลาเข้ามาตรงกับรอบล่าสุดเป๊ะ (ของเก่าไม่ปน)",
      ids(s.latestArrivalBatch([it("A", t("2026-10-04T07:36:50.407Z")), it("B", t("2026-10-10T11:28:37.602Z")), it("C", t("2026-10-10T11:28:37.602Z"))])),
      ["B", "C"]
    );
    check(
      "คนละมิลลิวินาที = คนละชุด",
      ids(s.latestArrivalBatch([it("B", t("2026-10-10T11:28:37.602Z")), it("C", t("2026-10-10T11:28:37.603Z"))])),
      ["C"]
    );
    check("ไม่ขึ้นกับลำดับในอาร์เรย์", ids(s.latestArrivalBatch([it("N", t("2026-10-10T11:28:37.602Z")), it("O", t("2026-10-04T07:36:50.407Z"))])), ["N"]);
    check("รายการเดียว = ชุดนั้น", ids(s.latestArrivalBatch([it("A", t("2026-10-04T07:36:50.407Z"))])), ["A"]);
    check("ไม่มีรายการ = null", s.latestArrivalBatch([]), null);
    check(
      "คืนเวลาที่เข้ามาของชุดไว้แสดงบนปุ่ม",
      s.latestArrivalBatch([it("A", t("2026-10-04T07:36:50.407Z")), it("B", t("2026-10-10T11:28:37.602Z"))]).arrivedAt.toISOString(),
      "2026-10-10T11:28:37.602Z"
    );
  }

  console.log(failed === 0 ? "\nผ่านทุกเคส" : `\nตก ${failed} เคส`);
} finally {
  rmSync(out, { recursive: true, force: true });
}

process.exit(failed === 0 ? 0 : 1);
