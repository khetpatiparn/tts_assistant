/**
 * S1: โปรไฟล์จำ login ไหม + บัญชีนี้อยู่โฮสต์ไหน
 * รัน: npm run flow-smoke:s1   (ต้องรัน flow-login.bat แล้วปิด Chrome ก่อน)
 * ผลลัพธ์: worker/smoke/out/s1.png, s1-dom.txt และบรรทัดสรุป HOST= / LOGGED_IN= / SELECTOR_SET=
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { loadWorkerConfig } from "../config";
import { launchFlowBrowser, openFlowAndSettle, checkSession, hasSignInButton } from "../browser";
import { dumpDom } from "./dump-dom";

async function main() {
  const cfg = loadWorkerConfig();
  const outDir = path.resolve("worker/smoke/out");
  mkdirSync(outDir, { recursive: true });

  const { context, page } = await launchFlowBrowser(cfg);
  try {
    const { host, url } = await openFlowAndSettle(page, cfg);
    const { email } = await checkSession(page);
    const signIn = await hasSignInButton(page);
    await page.screenshot({ path: path.join(outDir, "s1.png"), fullPage: true });
    await dumpDom(page, path.join(outDir, "s1-dom.txt"));

    const selectorSet = host === "flow.google.com" ? "migrated" : "labs";
    console.log(`URL=${url}`);
    console.log(`HOST=${host}`);
    console.log(`EMAIL=${email ?? "-"}`);
    console.log(`LOGGED_IN=${email !== null && !signIn ? "yes" : "no"}`);
    console.log(`SELECTOR_SET=${selectorSet}`);
    console.log(`DOM_DUMP=${path.join(outDir, "s1-dom.txt")}`);
  } finally {
    await context.close();
  }
}

main().catch((e) => {
  console.error("S1 FAILED:", e);
  process.exit(1);
});
