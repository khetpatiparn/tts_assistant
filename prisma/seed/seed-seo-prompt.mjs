import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const root = process.cwd();
const content = fs.readFileSync(
  path.join(root, "prisma/seed/seo-prompt-v1.md"),
  "utf8"
);

const db = new Database(path.join(root, "dev.db"));

const existing = db
  .prepare("SELECT COUNT(*) c FROM CorePrompt WHERE kind = 'caption'")
  .get().c;

if (existing > 0) {
  console.log(`มี caption prompt อยู่แล้ว ${existing} เวอร์ชัน — ไม่ทำอะไร`);
} else {
  db.prepare(
    `INSERT INTO CorePrompt (id, label, content, isActive, kind, createdAt)
     VALUES (?, ?, ?, 1, 'caption', ?)`
  ).run(
    `seo${Date.now().toString(36)}`,
    "SEO v1",
    content,
    Date.now()
  );
  console.log("seed SEO v1 เรียบร้อย");
}

db.close();
