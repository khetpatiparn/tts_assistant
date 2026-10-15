/**
 * รายงานความถี่ที่บอทยิง Flow ในวันที่กำหนด (เวลาท้องถิ่น) — ใช้ตอนวิเคราะห์ว่า "ก่อนโดนแบน ยิงถี่แค่ไหน"
 * รัน: node scripts/flow-activity-report.mjs 2026-10-01 [dev.db]   (ไม่ใส่วัน = วันนี้) · อ่านอย่างเดียว
 */
import Database from "better-sqlite3";
import path from "node:path";

const day = process.argv[2] ?? new Date().toLocaleDateString("sv-SE");
const dbPath = process.argv[3] ?? "dev.db";
const start = new Date(`${day}T00:00:00`);
const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
const db = new Database(path.resolve(dbPath), { readonly: true });
const iso = (d) => d.toISOString().replace("Z", "+00:00"); // รูปแบบเดียวกับที่ adapter เขียน
// Prisma เก็บ DateTime ใน SQLite เป็นข้อความ ISO (ยืนยันจากไฟล์จริง) — เทียบเป็นสตริง ISO
const rows = db
  .prepare("SELECT at, kind, jobId, round, detail FROM FlowActivity WHERE at >= ? AND at < ? ORDER BY at")
  .all(iso(start), iso(end))
  .map((r) => ({ ...r, at: new Date(r.at) }));

const REQUEST = new Set(["generate_image", "generate_video", "upload", "new_project", "download"]);
const buckets = new Map();
for (const r of rows) {
  if (!REQUEST.has(r.kind)) continue;
  const b = new Date(r.at);
  b.setMinutes(Math.floor(b.getMinutes() / 10) * 10, 0, 0);
  const key = b.toTimeString().slice(0, 5);
  buckets.set(key, (buckets.get(key) ?? 0) + 1);
}
console.log(`FlowActivity ${day}: ${rows.length} แถว · คำขอ ${rows.filter((r) => REQUEST.has(r.kind)).length} ครั้ง`);
console.log("\nความถี่ต่อ 10 นาที:");
for (const [k, n] of [...buckets.entries()].sort()) console.log(`  ${k}  ${"#".repeat(n)} ${n}`);
const warns = rows.filter((r) => r.kind === "http_warn" || r.kind === "bot_signal");
console.log(`\nสัญญาณเตือน ${warns.length} ครั้ง:`);
for (const w of warns) console.log(`  ${w.at.toTimeString().slice(0, 8)}  ${w.kind}  ${w.detail}`);
const sessions = rows.filter((r) => r.kind === "session_start");
console.log(`\nเปิดบอท ${sessions.length} ครั้ง:`);
for (const s of sessions) console.log(`  ${s.at.toTimeString().slice(0, 8)}  ${s.detail}`);
function breakMs(detail) {
  try {
    return JSON.parse(detail || "{}").ms ?? 0;
  } catch {
    return 0;
  }
}
const breaks = rows.filter((r) => r.kind === "break");
const totalBreak = breaks.reduce((sum, b) => sum + breakMs(b.detail), 0);
console.log(`\nพักจริงรวม ${Math.round(totalBreak / 60000)} นาที (${breaks.length} ครั้ง)`);

// ───────── พฤติกรรมของคุณ (การกระทำของผู้ใช้ kind "user_*" + ประวัติงาน — ทั้งหมดที่เคยบันทึก ไม่จำกัดวัน) ─────────
const median = (xs) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const fmtWait = (ms) => (ms === null ? "-" : ms < 90000 ? `${Math.round(ms / 1000)} วิ` : `${Math.round(ms / 60000)} นาที`);
const parseDetail = (d) => {
  try {
    return JSON.parse(d || "{}");
  } catch {
    return {};
  }
};
// ทำต่อเอง = แถว user_take_over (+ user_finish_manual ของปุ่มเก่า) — การเลือกของผู้ใช้ ไม่ใช่ตัวชี้ว่าบอทพลาด
// งานที่ทำต่อเองไม่นับในตัวเลขคุณภาพของบอท (เรนเดอร์ต่อคลิปที่ผ่าน ฯลฯ) เพราะบอทไม่ได้ทำงานนั้นจนจบ
const TAKEOVER_KINDS = new Set(["user_take_over", "user_finish_manual"]);
const STAGE_LABELS = {
  queued_r1: "รอบอทวาดรอบ 1", review_r1: "เลือกรูปรอบ 1", queued_r2: "รอบอทวาดรอบ 2", review_r2: "เลือกรูปรอบ 2",
  awaiting_prompt: "รอพรอมต์", queued_r3: "รอบอทเรนเดอร์", review_r3: "ดูคลิปตัวอย่าง", queued_upscale: "รอโหลด 1080p", failed: "งานที่พัง",
};
const USER_FILTER = "kind LIKE 'user\\_%' ESCAPE '\\'";
const userRows = db
  .prepare(`SELECT at, kind, jobId, round, detail FROM FlowActivity WHERE ${USER_FILTER} ORDER BY at`)
  .all()
  .map((r) => ({ ...r, d: parseDetail(r.detail) }));
console.log("\n══ พฤติกรรมของคุณ ══");
if (userRows.length === 0) {
  console.log("ยังไม่มีการกระทำของผู้ใช้ที่บันทึกไว้ (เริ่มบันทึกตั้งแต่ฟีเจอร์นี้เปิดใช้)");
} else {
  const jobs = db
    .prepare(
      `SELECT j.id, j.status, j.round, j.attempt, e.productName FROM FlowJob j JOIN PromptEntry e ON e.id = j.entryId
       WHERE j.id IN (SELECT DISTINCT jobId FROM FlowActivity WHERE ${USER_FILTER})`
    )
    .all();
  const cand = db
    .prepare("SELECT jobId, round, COUNT(DISTINCT attempt) AS draws FROM FlowJobImage WHERE kind = 'candidate' GROUP BY jobId, round")
    .all();
  const drawsOf = (jobId, round) => cand.find((c) => c.jobId === jobId && c.round === round)?.draws ?? 0;
  const DECISION = new Set(["user_choose", "user_redraw", "user_approve_render", "user_redo_render"]);
  const perJob = [];
  const takeoverRows = userRows.filter((r) => TAKEOVER_KINDS.has(r.kind));
  const takeoverJobIds = new Set(takeoverRows.map((r) => r.jobId));
  for (const j of jobs) {
    if (takeoverJobIds.has(j.id)) continue;
    const mine = userRows.filter((r) => r.jobId === j.id);
    // เรนเดอร์ = attempt ของงานเมื่ออยู่รอบ 3-4 (redo เพิ่ม attempt ทีละ 1) · ยังไม่ถึงขั้นเรนเดอร์ = 0
    const renders = j.round >= 3 && j.status !== "awaiting_prompt" ? j.attempt : 0;
    const approved = mine.some((r) => r.kind === "user_approve_render");
    const waits = mine.filter((r) => DECISION.has(r.kind) && typeof r.d.waitedMs === "number").map((r) => r.d.waitedMs);
    perJob.push({ name: j.productName, r1: drawsOf(j.id, 1), r2: drawsOf(j.id, 2), renders, approved, wait: median(waits) });
  }
  console.log(`งานที่มีการกระทำของคุณ ${perJob.length} งาน (ไม่รวมงานที่ทำต่อเอง — ดูหัวข้อด้านล่าง) · การกระทำทั้งหมด ${userRows.length} ครั้ง`);
  const byKind = new Map();
  for (const r of userRows) byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + 1);
  console.log("  " + [...byKind.entries()].map(([k, n]) => `${k}=${n}`).join("  "));
  console.log("\nต่องาน (วาดรอบ1 / วาดรอบ2 / เรนเดอร์ / ผ่านไหม / รอตัดสินใจ median):");
  for (const p of perJob) {
    console.log(`  ${p.name.slice(0, 40).padEnd(40)}  ${p.r1} / ${p.r2} / ${p.renders} / ${p.approved ? "ผ่าน" : "ยัง"} / ${fmtWait(p.wait)}`);
  }
  const approvedJobs = perJob.filter((p) => p.approved);
  const totalRenders = approvedJobs.reduce((s, p) => s + p.renders, 0);
  const avg = (n, d) => (d === 0 ? "-" : (n / d).toFixed(2));
  console.log("\nภาพรวม:");
  console.log(`  คลิปที่ผ่านแล้ว ${approvedJobs.length} คลิป`);
  console.log(`  เรนเดอร์เฉลี่ยต่อคลิปที่ผ่าน: ${avg(totalRenders, approvedJobs.length)} ครั้ง`);
  console.log(`  เครดิตต่อคลิปที่ผ่าน (15 ต่อครั้ง): ${approvedJobs.length === 0 ? "-" : Math.round((totalRenders * 15) / approvedJobs.length)}`);
  const r1 = perJob.filter((p) => p.r1 > 0);
  const r2 = perJob.filter((p) => p.r2 > 0);
  console.log(`  วาดเฉลี่ยต่อรอบ: รอบ 1 = ${avg(r1.reduce((s, p) => s + p.r1, 0), r1.length)} · รอบ 2 = ${avg(r2.reduce((s, p) => s + p.r2, 0), r2.length)}`);
  console.log(`  รอตัดสินใจ (median ทุกงาน): ${fmtWait(median(perJob.map((p) => p.wait).filter((w) => w !== null)))}`);
}

// ───────── ทำต่อเอง (เป็นการเลือกของคุณ ไม่ใช่ตัวชี้ว่าบอทพลาด) ─────────
// นับต่องาน (แถวล่าสุดของงาน) แยกตามขั้นที่รับงานไปทำเอง · แถวเก่า user_finish_manual ไม่มี fromStatus เหมือนกัน
{
  const latest = new Map();
  for (const r of userRows) if (TAKEOVER_KINDS.has(r.kind)) latest.set(r.jobId, r);
  console.log("\n══ ทำต่อเอง ══");
  if (latest.size === 0) {
    console.log("ยังไม่เคยกดทำต่อเอง");
  } else {
    const byStage = new Map();
    for (const r of latest.values()) {
      const from = typeof r.d.fromStatus === "string" ? r.d.fromStatus : null;
      const label = from === null ? "ไม่ทราบขั้น" : (STAGE_LABELS[from] ?? from);
      const e = byStage.get(label) ?? { n: 0, waits: [] };
      e.n++;
      if (typeof r.d.waitedMs === "number") e.waits.push(r.d.waitedMs);
      byStage.set(label, e);
    }
    console.log(`รับงานไปทำเอง ${latest.size} งาน (ตัวเลขของบอทด้านบนไม่รวมงานเหล่านี้)`);
    for (const [label, e] of [...byStage.entries()].sort((a, b) => b[1].n - a[1].n)) {
      console.log(`  ${label.padEnd(22)}  ${e.n} งาน · รอมา (median) ${fmtWait(median(e.waits))}`);
    }
  }
}
