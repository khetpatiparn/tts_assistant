/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * สแกนข้อมูลจริง (อ่านอย่างเดียว) ด้วย lib/claim-check.ts — รัน: node scripts/claim-scan.js [dbPath]
 * ห้ามชี้ไปที่ dev.db ตัวจริง ให้ก๊อปเป็น dev-test.db ก่อน
 */
const path = require("node:path");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const Database = require(path.join(root, "node_modules", "better-sqlite3"));
const dbPath = path.resolve(root, process.argv[2] || "dev-test.db");
const limit = Number(process.argv[3] || 60);

const out = fs.mkdtempSync(path.join(root, ".claim-scan-tmp-"));
try {
  execFileSync("npx", ["tsc", "lib/claim-check.ts", "--outDir", out, "--module", "commonjs", "--target", "ES2017"], { cwd: root, stdio: "inherit", shell: true });
  const { checkClaims } = require(path.join(out, "claim-check.js"));
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const rows = db
    .prepare("SELECT productName, chatgptOutput, caption, hashtags FROM PromptEntry WHERE chatgptOutput <> '' ORDER BY createdAt DESC LIMIT ?")
    .all(limit);
  const counts = {};
  let total = 0;
  for (const r of rows) {
    const hits = checkClaims({ tenPart: r.chatgptOutput, caption: r.caption || "", hashtags: r.hashtags || "" });
    for (const h of hits) {
      total++;
      counts[h.word] = (counts[h.word] || 0) + 1;
      console.log(`[${h.level}] ${h.where} "${h.word}"  | ${r.productName} | ${h.snippet}`);
    }
  }
  console.log(`\nentries=${rows.length} hits=${total}`);
  console.log(JSON.stringify(counts));
  db.close();
} finally {
  fs.rmSync(out, { recursive: true, force: true });
}
