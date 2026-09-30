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
// Prisma เก็บ DateTime ใน SQLite เป็นข้อความ ISO (ยืนยันจากไฟล์จริง) — เทียบเป็นสตริง ISO
const rows = db
  .prepare("SELECT at, kind, jobId, round, detail FROM FlowActivity WHERE at >= ? AND at < ? ORDER BY at")
  .all(start.toISOString(), end.toISOString())
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
const breaks = rows.filter((r) => r.kind === "break");
const totalBreak = breaks.reduce((sum, b) => sum + (JSON.parse(b.detail || "{}").ms ?? 0), 0);
console.log(`\nพักจริงรวม ${Math.round(totalBreak / 60000)} นาที (${breaks.length} ครั้ง)`);
