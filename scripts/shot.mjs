/**
 * ถ่าย screenshot ทุกหน้าที่ 390 / 820 / 1440px เพื่อตรวจงาน responsive
 *
 * 1440px คือ checkpoint บังคับ — ใช้เทียบกับชุด baseline เพื่อพิสูจน์ว่าเลย์เอาต์
 * เดสก์ท็อปไม่เปลี่ยน (ดู Global Constraints ข้อแรกของแผน)
 *
 * Playwright ไม่ใช่ dependency ของโปรเจกต์ ต้องชี้ผ่าน env:
 *   PW_ROOT=<scratch>/pw BASE_URL=http://localhost:3001 node scripts/shot.mjs <outDir>
 */
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const outDir = process.argv[2];
if (!outDir) {
  console.error("usage: node scripts/shot.mjs <outDir>");
  process.exit(1);
}

const pwRoot = process.env.PW_ROOT;
if (!pwRoot) {
  console.error("ต้องตั้ง PW_ROOT ให้ชี้ไปที่โฟลเดอร์ที่ npm i playwright ไว้");
  process.exit(1);
}

const baseUrl = process.env.BASE_URL || "http://localhost:3001";

// playwright ที่ติดตั้งไว้ (1.62.1) ไม่ export `chromium` เป็น named export ที่
// top level ของ module namespace เมื่อ import ตรงจาก index.js (มันอยู่ใต้ `.default`
// แทน) — รองรับทั้งสองแบบกันพังถ้าเวอร์ชันเปลี่ยนอีกในอนาคต
const playwrightModule = await import(
  pathToFileURL(join(pwRoot, "node_modules", "playwright", "index.js")).href
);
const chromium = playwrightModule.chromium ?? playwrightModule.default.chromium;

// entryId ถูกฉีดผ่าน env เพราะ id เป็น cuid ที่ต่างกันในแต่ละเครื่อง
// หา id จริงได้ด้วย: npx prisma db execute --stdin <<< "SELECT id FROM PromptEntry LIMIT 1;"
const entryId = process.env.ENTRY_ID || "";

const PAGES = [
  { name: "list", path: "/" },
  { name: "products", path: "/products" },
  { name: "flow", path: "/flow" },
  { name: "dashboard", path: "/dashboard" },
  { name: "core-prompt", path: "/core-prompt" },
  { name: "entry-new", path: "/entry/new" },
  ...(entryId ? [{ name: "entry", path: `/entry/${entryId}` }] : []),
];

const WIDTHS = [390, 820, 1440];

mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
let failures = 0;

for (const width of WIDTHS) {
  const context = await browser.newContext({
    viewport: { width, height: 800 },
    deviceScaleFactor: 2,
    // ต่ำกว่า lg: คือเป้าหมายจอสัมผัส เปิด touch ให้ hover ไม่ทำงานเหมือนของจริง
    hasTouch: width < 1024,
    isMobile: width < 768,
  });
  const page = await context.newPage();

  for (const p of PAGES) {
    const res = await page.goto(`${baseUrl}${p.path}`, { waitUntil: "networkidle" });
    if (!res || res.status() >= 400) {
      console.error(`FAIL ${p.path} @${width} -> ${res ? res.status() : "no response"}`);
      failures += 1;
      continue;
    }

    // หน้าเพจต้องไม่สกรอลแนวนอน — เป็นข้อผิดพลาดที่ตามองข้ามได้ง่ายในภาพนิ่ง
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    if (overflow > 0) {
      console.error(`OVERFLOW ${p.path} @${width} -> ล้น ${overflow}px`);
      failures += 1;
    }

    await page.screenshot({
      path: resolve(outDir, `${p.name}-${width}.png`),
      fullPage: true,
    });
    console.log(`ok ${p.name}-${width}.png`);
  }

  await context.close();
}

await browser.close();

if (failures > 0) {
  console.error(`\n${failures} ปัญหา`);
  process.exit(1);
}
console.log("\nผ่านทั้งหมด");
