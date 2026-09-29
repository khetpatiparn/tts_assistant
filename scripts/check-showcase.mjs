/**
 * ตรวจตรรกะของ lib/showcase.ts (สถานะ/ยุบแถวซ้ำ/วันเริ่มนับ/ลำดับ) — แทน test suite ที่โปรเจกต์นี้ไม่มี
 *
 * รัน: node scripts/check-showcase.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
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
  execFileSync(
    "npx",
    ["tsc", "lib/showcase.ts", "--outDir", out, "--module", "es2022", "--target", "ES2017", "--moduleResolution", "bundler"],
    { stdio: "inherit", shell: true }
  );
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

  // --- ปุ่ม "เลือกรูปใหม่" ---
  check("ยังไม่มีงาน Flow = เลือกรูปใหม่ได้", s.showcaseFlowState(null), "retry");
  check("งานถูกข้าม = เลือกรูปใหม่ได้", s.showcaseFlowState({ status: "skipped", errorKind: "", round: 1 }), "retry");
  check("Flow วาดไม่สำเร็จเอง = เลือกรูปใหม่ได้", s.showcaseFlowState({ status: "failed", errorKind: "flow_error", round: 1 }), "retry");
  check("Flow วาดไม่สำเร็จเองรอบ 2 = เลือกรูปใหม่ได้", s.showcaseFlowState({ status: "failed", errorKind: "flow_error", round: 2 }), "retry");
  check("โดนจับว่าเป็นบอท = ห้ามทางลัด (ต้องพัก 1 ชม.)", s.showcaseFlowState({ status: "failed", errorKind: "captcha", round: 1 }), "blocked");
  check("login หลุด = ห้ามทางลัด", s.showcaseFlowState({ status: "failed", errorKind: "login_required", round: 1 }), "blocked");
  check(
    "Render (รอบ 3) พังแม้เป็น flow_error = ห้ามทางลัด (จะทิ้งรูปที่เลือกไว้ทั้ง 2 รอบ)",
    s.showcaseFlowState({ status: "failed", errorKind: "flow_error", round: 3 }),
    "blocked"
  );
  check("กำลังวาด = ไม่มีปุ่ม", s.showcaseFlowState({ status: "running_r1", errorKind: "", round: 1 }), "busy");
  check("รอเลือกรูป = ไม่มีปุ่ม", s.showcaseFlowState({ status: "review_r1", errorKind: "", round: 1 }), "busy");
  check(
    "โหลด 1080p (round 4) พัง = ห้ามทางลัด",
    s.showcaseFlowState({ status: "failed", errorKind: "download_failed", round: 4 }),
    "blocked"
  );
  for (const st of ["awaiting_prompt", "queued_r3", "running_r3", "review_r3"]) {
    check(`${st} = ไม่มีปุ่ม`, s.showcaseFlowState({ status: st, errorKind: "", round: 3 }), "busy");
  }
  for (const st of ["queued_upscale", "running_upscale"]) {
    check(`${st} = ไม่มีปุ่ม`, s.showcaseFlowState({ status: st, errorKind: "", round: 4 }), "busy");
  }
  check("เสร็จแล้ว = ไม่มีปุ่ม", s.showcaseFlowState({ status: "done", errorKind: "", round: 3 }), "busy");

  console.log(failed === 0 ? "\nผ่านทุกเคส" : `\nตก ${failed} เคส`);
} finally {
  rmSync(out, { recursive: true, force: true });
}

process.exit(failed === 0 ? 0 : 1);
