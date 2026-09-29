/**
 * zip สำหรับแจก — dist-release + คู่มือ + เอกสาร integration + ตัวอย่าง
 * รันผ่าน `npm run package` (build ก่อนเสมอ) · ใช้ bsdtar ที่มากับ Windows (System32\tar.exe) เขียน zip — Compress-Archive ของ PS 5.1 ใส่ชื่อไฟล์ด้วย \ ทำให้ macOS/Linux แตกไม่ถูก · ต้องเรียกด้วย path เต็ม เพราะ `tar` ใน Git Bash เป็น GNU tar เขียน zip ไม่ได้
 */
import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

const version = JSON.parse(readFileSync("extension/manifest.json", "utf8")).version;
const stage = resolve(`dist-zip/showcase-scanner-${version}`);
rmSync("dist-zip", { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync("dist-release", join(stage, "extension"), { recursive: true, filter: (src) => !src.endsWith("meta.json") });
cpSync("docs/INSTALL.md", join(stage, "INSTALL.md"));
cpSync("docs/INTEGRATION.md", join(stage, "INTEGRATION.md"));
cpSync("docs/examples", join(stage, "examples"), { recursive: true });
const zip = resolve(`dist-zip/showcase-scanner-${version}.zip`);
const tar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
execFileSync(tar, ["-a", "-c", "-f", zip, "-C", stage, "."], { stdio: "inherit" });
console.log(`packaged → ${zip}`);
