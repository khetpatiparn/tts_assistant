/**
 * ใช้โดย start.bat — build ใหม่เฉพาะเมื่อโค้ดของแอปเปลี่ยนจริงตั้งแต่ build ครั้งล่าสุด
 *
 * ลายนิ้วมือ = object id ใน commit ปัจจุบัน + diff ที่ยังไม่ commit + ไฟล์ใหม่ที่ยังไม่ track
 * **เฉพาะ path ที่ Next build ใช้จริง** (commit ที่แก้แค่ docs/ worker/ showcase-extension/ ไม่ทำให้
 * build ใหม่) · เก็บไว้ใน .next/ จึงหายไปพร้อม .next เสมอ (ลบ .next ทิ้ง = build ใหม่แน่นอน)
 * · ถ้าคำนวณไม่ได้ (เช่นเรียก git ไม่ได้) ให้ build ไว้ก่อนเสมอ
 * · ไม่ครอบคลุม lib/generated/prisma (gitignore) — หลัง `prisma generate` ที่ schema ไม่เปลี่ยน ให้ลบ .next
 *
 * รัน: node scripts/build-if-changed.mjs   (ทดสอบ: NEXT_DIST_DIR=.next-test node scripts/build-if-changed.mjs)
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

// ต้องตรงกับ distDir ใน next.config.ts — override ได้ด้วย env ตัวเดียวกัน (ใช้ทดสอบโดยไม่แตะ .next จริง)
const DIST = process.env.NEXT_DIST_DIR || ".next";
const STAMP = `${DIST}/build-fingerprint.txt`;
const BUILD_INPUTS = [
  "app",
  "components",
  "lib",
  "prisma",
  "public",
  "next.config.ts",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "postcss.config.mjs",
  "prisma.config.ts",
].filter((p) => existsSync(p));

function fingerprint() {
  const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const hash = createHash("sha256");
  hash.update(git("ls-tree", "HEAD", "--", ...BUILD_INPUTS));
  hash.update(git("diff", "HEAD", "--binary", "--", ...BUILD_INPUTS));
  const untracked = git("ls-files", "--others", "--exclude-standard", "--", ...BUILD_INPUTS)
    .split("\n")
    .filter(Boolean)
    .sort();
  for (const file of untracked) {
    hash.update(file);
    hash.update(readFileSync(file));
  }
  return hash.digest("hex");
}

let current = null;
try {
  current = fingerprint();
} catch (err) {
  console.log(`Could not fingerprint the code (${err.message.split("\n")[0]}) - building to be safe.`);
}

const built = existsSync(`${DIST}/BUILD_ID`) && existsSync(STAMP);
if (current && built && readFileSync(STAMP, "utf8") === current) {
  console.log("App code unchanged since the last build - skipping build.");
  process.exit(0);
}
if (process.argv.includes("--dry-run")) {
  console.log("dry-run: code changed or never built - a real run would build.");
  process.exit(0);
}

console.log("Building app...");
const result = spawnSync("npm", ["run", "build"], { stdio: "inherit", shell: true });
if (result.status !== 0) process.exit(result.status ?? 1);
if (current) writeFileSync(STAMP, current);
