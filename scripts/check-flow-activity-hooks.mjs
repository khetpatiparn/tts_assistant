/**
 * ตรวจว่า worker เรียก logActivity ครบทุกจุดที่สเปก §3 กำหนด — อ่านซอร์สตรงๆ (รันบอทจริงไม่ได้ในเทสต์)
 * รัน: node scripts/check-flow-activity-hooks.mjs
 */
import { readFileSync } from "node:fs";

const rd = (f) =>
  readFileSync(f, "utf8")
    .split(String.fromCharCode(13, 10))
    .join(String.fromCharCode(10))
    .split(String.fromCharCode(10))
    .filter((l) => !l.trim().startsWith("//")) // ตัดบรรทัดคอมเมนต์ กันเจอ needle ในคอมเมนต์
    .join(String.fromCharCode(10));
const driver = rd("worker/flow-driver.ts");
const index = rd("worker/index.ts");
let failed = 0;
function must(name, ok) {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
}
/** `needle` ต้องอยู่ในบล็อกที่เริ่มด้วย `start` ก่อนถึง `end` ตัวถัดไป */
function within(src, start, end, needle) {
  const i = src.indexOf(start);
  if (i < 0) return false;
  const j = src.indexOf(end, i + start.length);
  return src.slice(i, j < 0 ? undefined : j).includes(needle);
}

must("driver import logActivity", driver.includes('import { logActivity } from "./activity"'));
must(
  "click-generate → generate_image/generate_video หลัง submitAt (ทั้งรอบรูปและ Render)",
  (driver.match(/submitAt = Date\.now\(\);\s*\n\s*logActivity\(\{ kind: input\.round === 3 \? "generate_video" : "generate_image"/g) ?? []).length >= 2
);
must("attach-reference → upload หลัง setFiles", within(driver, "async function attachReferences", "\n    }\n", 'kind: "upload"') && /setFiles\(paths\);\s*\n\s*logActivity/.test(driver));
must("ensure-project → new_project หลังคลิป New project", /humanClick\(page, btn, cfg\);\s*\n\s*logActivity\(\{ kind: "new_project"/.test(driver));
must("downloadVideoDirect → download via direct หลังเขียนไฟล์", /writeFileSync\(file, buf\);[^]*?via: "direct"/.test(driver) && within(driver, "async function downloadVideoDirect", "async function downloadVideo(", 'via: "direct"'));
must("downloadVideo (menu) → download via menu หลังเขียนไฟล์ที่ดึงเอง", /Flow ขอไฟล์แล้ว[^]*?writeFileSync\(file, buf\);[^]*?via: "menu"/.test(driver));
must("wait loops: HTTP-status stop ทั้ง 3 จุด → bot_signal http", (driver.match(/kind: "bot_signal"[^\n]*signal: `http \$\{r\.status\}`/g) ?? []).length >= 3);
must("assertPageUsable bot_signal มี jobId/round", (driver.match(/kind: "bot_signal", jobId, round,/g) ?? []).length >= 2);
must("download-4 → download files:4", within(driver, 'step("download-4"', "return written;", "files: 4"));
must("onResponse → http_warn on 429/403/5xx", within(driver, "const onResponse", "};", 'kind: "http_warn"') && within(driver, "const onResponse", "};", "res.status() === 429 || res.status() === 403 || res.status() >= 500"));
must("http_warn ตัด url ≤ 120", within(driver, "const onResponse", "};", "res.url().slice(0, 120)"));
must("assertPageUsable → bot_signal (captcha)", within(driver, "async function assertPageUsable", "\n}\n", 'kind: "bot_signal", jobId, round, detail: { signal: c }'));
must("assertPageUsable → bot_signal (login_required)", within(driver, "async function assertPageUsable", "\n}\n", 'signal: "login_required"'));
must("wait loops → bot_signal ก่อน throw captcha (≥ 2 จุด: wait-results + wait-render)", (driver.match(/kind: "bot_signal"[^\n]*wait-loop/g) ?? []).length >= 2);
must("index import logActivity", index.includes('import { logActivity } from "./activity"'));
must("session_start with config หลังเปิด Flow", within(index, "เปิด Flow แล้ว", "let longBreakTarget", 'kind: "session_start"') && within(index, 'kind: "session_start"', "});", "longBreakMs: cfg.longBreakMs"));
must("break why:long ก่อน sleepUntil ของพักยาว", within(index, "พักยาว ${", "longBreakTarget = pickLongBreakTarget", 'why: "long"'));
must("break why:between ก่อน sleepUntil ต่อสินค้า", within(index, "const pause = randInt(", "await sleepUntil(Date.now() + pause)", 'why: "between"'));
must("ห้าม await logActivity (fire-and-forget)", !/await logActivity\(/.test(driver) && !/await logActivity\(/.test(index));

console.log(failed === 0 ? "\nผ่านทุกเคส" : `\nตก ${failed} เคส`);
process.exit(failed === 0 ? 0 : 1);
