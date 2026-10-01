/**
 * ตรวจ lib/claim-check.ts (pure) — รัน: node scripts/check-claims.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const out = mkdtempSync(join(process.cwd(), ".check-claims-tmp-"));
let failed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`      ได้ ${a} ควรได้ ${e}`);
}
try {
  execFileSync("npx", ["tsc", "lib/claim-check.ts", "--outDir", out, "--module", "es2022", "--target", "ES2017", "--moduleResolution", "bundler"], { stdio: "inherit", shell: true });
  const c = await import(pathToFileURL(join(out, "claim-check.js")).href);

  const tenPart = [
    "5. **Action Timeline**",
    "**Full voice-over script:**",
    "“ตะขอตัวนี้ดีที่สุดเลย แขวนได้เยอะ”",
    "",
    "**00:00–00:02**",
    "มือคล้องตะขอ",
    "เสียงพากย์: “ทนทานมาก ใช้ได้นาน”",
    "",
    "9. **Negative Prompt**",
    "ห้ามพูดว่าดีที่สุด ห้ามคำว่า 100% ห้ามการันตี",
  ].join("\n");

  const script = c.extractVoiceoverScript(tenPart);
  check("บทพากย์สำหรับ TTS = บล็อก script ครั้งเดียว ไม่ซ้ำกับบรรทัดเสียงพากย์", script, "ตะขอตัวนี้ดีที่สุดเลย แขวนได้เยอะ");
  check("ไม่มีบล็อก script = ต่อบรรทัดเสียงพากย์", c.extractVoiceoverScript("เสียงพากย์: “ก”\nเสียงพากย์: “ข”"), "ก\nข");
  const vo = c.extractVoiceover(tenPart);
  check("voice-over รวม script + บรรทัดเสียงพากย์", vo.includes("ดีที่สุดเลย") && vo.includes("ทนทานมาก"), true);
  check("voice-over ไม่รวม Negative Prompt", vo.includes("ห้ามคำว่า 100%"), false);

  const hits = c.checkClaims({ tenPart, caption: "ของแท้ 100% ปลอดภัย", hashtags: "#ขายดี #ตะขอ" });
  check("เจอ ดีที่สุด (ban) ในเสียงพากย์", hits.some((h) => h.word === "ดีที่สุด" && h.level === "ban" && h.where === "voiceover"), true);
  check("เจอ ทนทาน (check) ในเสียงพากย์", hits.some((h) => h.word === "ทนทาน" && h.level === "check" && h.where === "voiceover"), true);
  check("ไม่จับ 100% จาก Negative Prompt (ในเสียงพากย์ไม่มี 100%)", hits.filter((h) => h.where === "voiceover" && h.word === "100%").length, 0);
  check("เจอ 100% (ban) ในแคปชัน", hits.some((h) => h.word === "100%" && h.where === "caption"), true);
  check("เจอ ปลอดภัย (check) ในแคปชัน", hits.some((h) => h.word === "ปลอดภัย" && h.level === "check" && h.where === "caption"), true);
  check("เจอ ขายดี (check) ในแฮชแท็ก", hits.some((h) => h.word === "ขายดี" && h.where === "hashtags"), true);
  check("ข้อความสะอาด = ไม่มี hit", c.checkClaims({ tenPart: "เสียงพากย์: “แขวนเสื้อได้เยอะ ประหยัดพื้นที่”", caption: "จัดระเบียบหลังประตู", hashtags: "#ตะขอ" }), []);
  check("คำเดียวกันซ้ำในที่เดียวกัน รายงานครั้งเดียว", c.checkClaims({ tenPart: "", caption: "ดีที่สุด ดีที่สุด", hashtags: "" }).length, 1);
  check("snippet มีคำที่เจอ", c.checkClaims({ tenPart: "", caption: "กล่องนี้ถูกที่สุดในตลาด", hashtags: "" })[0].snippet.includes("ถูกที่สุด"), true);
  check("ถูกที่สุด จับเป็นคำเดียว ไม่ซ้ำกับ ดีที่สุด", c.checkClaims({ tenPart: "", caption: "ถูกที่สุด", hashtags: "" }).map((h) => h.word), ["ถูกที่สุด"]);
  check("เก็บรักษา / รักษาความสะอาด ไม่ใช่คำเสี่ยง", c.checkClaims({ tenPart: "", caption: "เก็บรักษาง่าย ช่วยรักษาความสะอาด", hashtags: "" }), []);
  check("รักษาโรค ยังจับ", c.checkClaims({ tenPart: "", caption: "ช่วยรักษาแผล", hashtags: "" }).map((h) => h.word), ["รักษา"]);
} finally {
  rmSync(out, { recursive: true, force: true });
}
console.log(failed === 0 ? "\nผ่านทุกเคส" : `\nตก ${failed} เคส`);
process.exit(failed === 0 ? 0 : 1);
