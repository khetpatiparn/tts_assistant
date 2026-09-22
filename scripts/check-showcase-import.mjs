/**
 * ตรวจตรรกะของ lib/showcase-import.ts — ทำหน้าที่แทน test suite ที่โปรเจกต์นี้ไม่มี
 * (แบบเดียวกับ scripts/check-candidates.mjs)
 *
 * รัน: node scripts/check-showcase-import.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const out = mkdtempSync(join(process.cwd(), ".check-showcase-import-tmp-"));
let failed = 0;

function check(name, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`      ได้ ${JSON.stringify(actual)} ควรได้ ${JSON.stringify(expected)}`);
}

function checkDeep(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`      ได้ ${JSON.stringify(actual)}\n      ควรได้ ${JSON.stringify(expected)}`);
}

try {
  execFileSync(
    "npx",
    ["tsc", "lib/showcase-import.ts", "--outDir", out, "--module", "es2022", "--target", "ES2017", "--moduleResolution", "bundler"],
    { stdio: "inherit", shell: true }
  );
  const m = await import(pathToFileURL(join(out, "showcase-import.js")).href);

  const fixture = JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/showcase-sample.json"), "utf8"));
  const { rows, skipped } = m.parseShowcasePayload(fixture);

  check("3 usable rows parsed", rows.length, 3);
  check("1 row skipped (missing product_id)", skipped, 1);
  check("first row sourceProductId", rows[0].sourceProductId, "1736476547228075452");
  check("first row name", rows[0].name, "ชั้นวางของในครัว 2 ชั้น");
  check("price parsed from display string", rows[0].price, 128.71);
  check("commission_rate 1200 -> 12", rows[0].commission, 12);
  check("categoryLabel from category_info.name", rows[0].categoryLabel, "เครื่องครัว");
  checkDeep("imageUrls = cover + images flattened", rows[0].imageUrls, [
    "https://p16-oec-sg.ibyteimg.com/example-cover.jpeg?sig=abc",
    "https://p16-oec-sg.ibyteimg.com/example-1.jpeg?sig=abc",
    "https://p16-oec-sg.ibyteimg.com/example-2.jpeg?sig=abc",
  ]);
  check("second row (PETLUSCI, no cover/images) has empty imageUrls", rows[1].imageUrls.length, 0);
  check("commission_rate 1600 -> 16", rows[1].commission, 16);
  check("third row (no affiliate_info at all) commission falls back to 0", rows[2].commission, 0);
  check("third row (no category_info) categoryLabel falls back to empty string", rows[2].categoryLabel, "");

  let threw = false;
  try {
    m.parseShowcasePayload({ not_products: [] });
  } catch {
    threw = true;
  }
  check("malformed payload (no products array) throws", threw, true);
} finally {
  rmSync(out, { recursive: true, force: true });
}

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
