/**
 * ตรวจ lib/clipboard.ts — ตรรกะเลือกทางคัดลอก 3 ชั้น
 *
 * แพตเทิร์นเดียวกับ scripts/check-date-filter-label.mjs: ไฟล์เป้าหมายไม่ import
 * อะไรเลย จึงคอมไพล์เดี่ยวด้วย tsc ไปยัง temp dir แล้ว dynamic import ได้
 * โดยไม่ต้องพึ่ง path alias
 *
 * รัน: node scripts/check-clipboard.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const sourceFile = join(repoRoot, "lib", "clipboard.ts");
const outDir = mkdtempSync(join(tmpdir(), "check-clipboard-"));

let failures = 0;
function check(label, actual, expected) {
  if (actual !== expected) {
    console.error(`FAIL ${label}: ได้ ${actual} ควรเป็น ${expected}`);
    failures += 1;
  } else {
    console.log(`ok   ${label}`);
  }
}

try {
  const tscBin = join(
    repoRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "tsc.cmd" : "tsc"
  );
  execFileSync(
    tscBin,
    [sourceFile, "--outDir", outDir, "--module", "commonjs", "--target", "ES2017"],
    { cwd: repoRoot, stdio: "inherit", shell: process.platform === "win32" }
  );

  const { copyText } = await import(pathToFileURL(join(outDir, "clipboard.js")).href);

  // 1. Clipboard API ใช้ได้ → ต้องใช้ทางนั้นและไม่แตะทางสำรอง
  let execCalled = false;
  check(
    "clipboard api สำเร็จ",
    await copyText("hello", {
      writeToClipboard: async () => {},
      execCopy: () => {
        execCalled = true;
        return true;
      },
    }),
    "clipboard-api"
  );
  check("clipboard api สำเร็จแล้วไม่เรียก execCopy", execCalled, false);

  // 2. Clipboard API โยน error (กรณี HTTP จริง) → ตกไปใช้ execCommand
  check(
    "clipboard api พังแล้วตกไป execCommand",
    await copyText("hello", {
      writeToClipboard: async () => {
        throw new Error("NotAllowedError");
      },
      execCopy: () => true,
    }),
    "exec-command"
  );

  // 3. ไม่มี Clipboard API เลย (navigator.clipboard เป็น undefined) → execCommand
  check(
    "ไม่มี clipboard api เลย",
    await copyText("hello", { writeToClipboard: null, execCopy: () => true }),
    "exec-command"
  );

  // 4. execCommand คืน false → ต้องบอกว่า manual ไม่ใช่แกล้งว่าสำเร็จ
  check(
    "execCommand คืน false",
    await copyText("hello", { writeToClipboard: null, execCopy: () => false }),
    "manual"
  );

  // 5. execCommand โยน error → ต้องไม่ throw ออกมา ต้องคืน manual
  check(
    "execCommand โยน error",
    await copyText("hello", {
      writeToClipboard: null,
      execCopy: () => {
        throw new Error("boom");
      },
    }),
    "manual"
  );

  // 6. ไม่มีทางไหนเลย
  check(
    "ไม่มีทางไหนใช้ได้",
    await copyText("hello", { writeToClipboard: null, execCopy: null }),
    "manual"
  );

  // 7. ข้อความว่างต้องไม่ทำให้พัง
  check(
    "ข้อความว่าง",
    await copyText("", { writeToClipboard: async () => {}, execCopy: null }),
    "clipboard-api"
  );
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} เคสไม่ผ่าน`);
  process.exit(1);
}
console.log("\nผ่านทั้งหมด");
