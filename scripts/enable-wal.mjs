/**
 * เปิด WAL บนไฟล์ SQLite ครั้งเดียว (ค่าติดไปกับไฟล์ถาวร) — ต้องทำก่อนให้ worker กับ Next
 * เขียนพร้อมกัน ไม่งั้นชน "database is locked"
 * รัน: node scripts/enable-wal.mjs [dev.db]
 */
import Database from "better-sqlite3";

const file = process.argv[2] ?? "dev.db";
const db = new Database(file);
const mode = db.pragma("journal_mode = WAL", { simple: true });
db.close();
console.log(`${file}: journal_mode=${mode}`);
if (mode !== "wal") process.exit(1);
