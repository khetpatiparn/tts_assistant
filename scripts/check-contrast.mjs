/**
 * ตรวจว่าคู่สีในธีมผ่านเกณฑ์ WCAG จริง — ทำหน้าที่แทน test suite ที่โปรเจกต์นี้ไม่มี
 *
 * อ่านค่าจริงจาก app/globals.css ไม่ใช่ค่าที่ hardcode ไว้ในสคริปต์ เพื่อให้การแก้สี
 * ในอนาคตถูกจับได้ทันที ถ้า hardcode ไว้สองที่ มันจะเพี้ยนออกจากกันโดยไม่มีใครรู้
 *
 * รัน: node scripts/check-contrast.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "..", "app", "globals.css"), "utf8");

/** ตัดเนื้อในของบล็อก CSS ตัวแรกที่ตรงกับ selector โดยนับวงเล็บปีกกาให้สมดุล */
function blockBody(selector) {
  const at = css.indexOf(selector + " {");
  if (at === -1) throw new Error(`ไม่พบบล็อก ${selector} ใน globals.css`);
  const start = css.indexOf("{", at) + 1;
  let depth = 1;
  let i = start;
  while (depth > 0) {
    if (i >= css.length) throw new Error(`บล็อก ${selector} ปิดวงเล็บไม่ครบ`);
    const ch = css[i++];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
  }
  return css.slice(start, i - 1);
}

function declarations(body) {
  const map = new Map();
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    map.set(m[1], m[2].trim());
  }
  return map;
}

const lightDecls = declarations(blockBody(":root"));
const darkDecls = new Map([
  ...lightDecls,
  ...declarations(blockBody(':root[data-theme="dark"]')),
]);

/** คลี่ var(--x) ทีละชั้นจนเจอค่า oklch() จริง */
function resolve(map, name, seen = 0) {
  const raw = map.get(name);
  if (raw === undefined) throw new Error(`ไม่มี token ${name}`);
  const ref = raw.match(/^var\(\s*(--[\w-]+)\s*\)$/);
  if (ref) {
    if (seen > 8) throw new Error(`var() วนซ้ำที่ ${name}`);
    return resolve(map, ref[1], seen + 1);
  }
  return raw;
}

function parseOklch(value, name) {
  const m = value.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/);
  if (!m) throw new Error(`token ${name} ไม่ใช่ oklch() ล้วน: ${value}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function oklchToSrgb(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const enc = (x) => {
    const v = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
    return Math.min(1, Math.max(0, v));
  };
  return [enc(r), enc(g), enc(bl)];
}

function channel(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance([r, g, b]) {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * 4.5 = ข้อความ (WCAG 1.4.3) · 3.0 = ขอบ/ไอคอนที่สื่อความหมาย (WCAG 1.4.11)
 * เส้นคั่นตกแต่ง (--border) ไม่อยู่ในตารางนี้โดยตั้งใจ — มันเป็นของประดับ ไม่ใช่ตัวสื่อความหมาย
 */
const PAIRS = [
  ["--foreground", "--background", 4.5],
  ["--foreground", "--surface", 4.5],
  ["--foreground", "--surface-2", 4.5],
  ["--muted-foreground", "--background", 4.5],
  ["--muted-foreground", "--surface", 4.5],
  ["--muted-foreground", "--surface-2", 4.5],
  ["--primary-foreground", "--primary", 4.5],
  ["--destructive", "--surface", 4.5],
  ["--border-interactive", "--background", 3.0],
  ["--border-interactive", "--surface", 3.0],
  ["--border-interactive", "--surface-2", 3.0],
  ["--ring", "--background", 3.0],
  ["--status-success", "--surface-2", 3.0],
  ["--status-warning", "--surface-2", 3.0],
  ["--status-danger", "--surface-2", 3.0],
  ["--status-neutral", "--surface-2", 3.0],
  ["--status-warning", "--surface", 4.5],
  ["--status-success", "--surface", 4.5],
  ["--header-foreground", "--header", 4.5],
  ["--header-muted", "--header", 4.5],
  ["--header-active-foreground", "--header-active", 4.5],
];

let failures = 0;
for (const [label, decls] of [["สว่าง", lightDecls], ["มืด", darkDecls]]) {
  console.log(`\n=== โหมด${label} ===`);
  for (const [fgName, bgName, need] of PAIRS) {
    const fg = oklchToSrgb(...parseOklch(resolve(decls, fgName), fgName));
    const bg = oklchToSrgb(...parseOklch(resolve(decls, bgName), bgName));
    const r = ratio(fg, bg);
    const ok = r >= need;
    if (!ok) failures++;
    console.log(
      `${ok ? "PASS" : "FAIL"} ${r.toFixed(2).padStart(6)}:1 (ต้อง >= ${need})  ${fgName} บน ${bgName}`
    );
  }
}

if (failures > 0) {
  console.error(`\nตกเกณฑ์ ${failures} คู่ — แก้ค่าใน app/globals.css แล้วรันใหม่`);
  process.exit(1);
}
console.log("\nผ่านทุกคู่");
