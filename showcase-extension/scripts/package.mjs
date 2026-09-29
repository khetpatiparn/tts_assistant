/**
 * zip สำหรับแจก — dist-release + คู่มือ + เอกสาร integration + ตัวอย่าง
 * รันผ่าน `npm run package` (build ก่อนเสมอ) · ใช้ PowerShell Compress-Archive เพราะเครื่องเจ้าของเป็น Windows
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
execFileSync("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path '${stage}\\*' -DestinationPath '${zip}' -Force`], { stdio: "inherit" });
console.log(`packaged → ${zip}`);
