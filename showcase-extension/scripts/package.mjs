/**
 * zip สำหรับแจก — รันผ่าน `npm run package` (build ก่อนเสมอ)
 *
 * โครงสร้าง: **ตัว extension อยู่ที่รากของ zip เลย** แตกไฟล์แล้วโฟลเดอร์ที่ได้ = โฟลเดอร์ที่กด Load unpacked
 * ได้ทันที · รุ่นแรก (2026-09-29) ซ่อนไว้ในโฟลเดอร์ย่อย `extension/` แล้วผู้ใช้จริงเลือกโฟลเดอร์ชั้นนอกจน
 * Brave ขึ้น "Manifest file is missing" — เอกสารสำหรับ developer จึงย้ายไปไว้ใน `developer/` แทน (Chrome
 * ไม่สนไฟล์ .md/.js/.ts/.gs ที่ manifest ไม่ได้อ้างถึง; ห้ามมีชื่อไฟล์/โฟลเดอร์ขึ้นต้นด้วย `_` ซึ่ง Chrome
 * สงวนไว้และจะไม่ยอมโหลด)
 *
 * เขียน zip ด้วย bsdtar ที่มากับ Windows (System32\tar.exe) — Compress-Archive ของ PS 5.1 ใส่ชื่อไฟล์ด้วย \
 * ทำให้ macOS/Linux แตกไม่ถูก · ต้องเรียกด้วย path เต็ม เพราะ `tar` ใน Git Bash เป็น GNU tar เขียน zip ไม่ได้
 */
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

const version = JSON.parse(readFileSync("extension/manifest.json", "utf8")).version;
const stage = resolve(`dist-zip/showcase-scanner-${version}`);
rmSync("dist-zip", { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync("dist-release", stage, { recursive: true, filter: (src) => !src.endsWith("meta.json") });
cpSync("docs/INSTALL.md", join(stage, "INSTALL.md"));
cpSync("docs/INTEGRATION.md", join(stage, "developer", "INTEGRATION.md"));
cpSync("docs/examples", join(stage, "developer", "examples"), { recursive: true });

const reserved = readdirSync(stage, { recursive: true }).filter((p) => String(p).split(/[\\/]/).some((seg) => seg.startsWith("_")));
if (reserved.length > 0) throw new Error(`Chrome จะไม่โหลด extension ที่มีชื่อขึ้นต้นด้วย "_": ${reserved.join(", ")}`);

const zip = resolve(`dist-zip/showcase-scanner-${version}.zip`);
const tar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
execFileSync(tar, ["-a", "-c", "-f", zip, "-C", stage, "."], { stdio: "inherit" });
console.log(`packaged → ${zip}`);
