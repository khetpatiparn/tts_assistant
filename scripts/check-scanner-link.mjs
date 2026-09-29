import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const out = mkdtempSync(join(process.cwd(), ".check-scanner-link-tmp-"));
let failed = 0;
const check = (name, actual, expected) => {
  const ok = Object.is(actual, expected);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` — ได้ ${JSON.stringify(actual)} ควรได้ ${JSON.stringify(expected)}`}`);
};
try {
  execFileSync("npx", ["tsc", "lib/scanner-link.ts", "--outDir", out, "--module", "es2022", "--target", "ES2017", "--moduleResolution", "bundler", "--types", "node"], { stdio: "inherit", shell: true });
  const s = await import(pathToFileURL(join(out, "scanner-link.js")).href);
  const t = s.newToken();
  check("token ยาว 64 hex", /^[0-9a-f]{64}$/.test(t), true);
  check("token สุ่มไม่ซ้ำ", s.newToken() === t, false);
  check("ตรงกัน", s.tokensMatch(t, t), true);
  check("ไม่ตรง", s.tokensMatch("a".repeat(64), t), false);
  check("ความยาวไม่เท่า ไม่ throw", s.tokensMatch("abc", t), false);
  check("null", s.tokensMatch(null, t), false);
  check("protocol", s.SCANNER_PROTOCOL, "showcase-scanner/1");
  console.log(failed === 0 ? "\nผ่านทุกเคส" : `\nตก ${failed} เคส`);
  if (failed > 0) process.exitCode = 1;
} finally {
  rmSync(out, { recursive: true, force: true });
}
