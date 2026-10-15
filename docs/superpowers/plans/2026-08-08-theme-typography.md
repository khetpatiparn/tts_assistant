# Theme + Typography Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เปลี่ยนแอปจากพาเลตต์สว่างชุดเดียว เป็นธีม Navy + Brass ที่สลับสว่าง/มืดได้ พร้อมสเกลตัวอักษรและกฎ affordance ที่ผ่านเกณฑ์ contrast จริง

**Architecture:** token 3 ชั้นใน `app/globals.css` (primitive OKLCH → semantic → คอมโพเนนต์) · โหมดสลับด้วย attribute `data-theme` บน `<html>` ตามสูตรทางการใน `node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md` · สคริปต์ Node ตัวหนึ่งอ่าน `globals.css` แล้วตรวจ contrast ทุกคู่ ทำหน้าที่แทน test suite ที่โปรเจกต์นี้ไม่มี

**Tech Stack:** Next.js 16.2.10 (custom build), React 19, Tailwind CSS v4 (CSS-first, ไม่มีไฟล์ config), shadcn/ui บน `@base-ui/react`, `next/font/google`

**Spec:** `docs/superpowers/specs/2026-08-08-theme-typography-design.md`

## Global Constraints

ทุก task อยู่ใต้ข้อบังคับเหล่านี้ทั้งหมด:

- **ห้ามรัน `npm run build` หรือ `npm run dev` บน `.next` โฟลเดอร์หลัก** — ผู้ใช้รัน `start.bat` ที่ port 3000 อยู่ตลอดและใช้ทำงานหาเงินทุกวัน ใช้ `npx tsc --noEmit` + `npm run lint` แทน ถ้าต้องดู UI จริงให้ใช้ dev server แยก: `cp dev.db dev-test.db` แล้ว `NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001`
- **cleanup หลังใช้ dev server ทุกครั้ง:** `netstat -ano | grep ':3001' | grep LISTENING` แล้ว `taskkill //PID <pid> //F` (double-slash บังคับบน git-bash เครื่องนี้) + `rm -f dev-test.db` + `rm -rf .next-dev`
- **`git diff tsconfig.json` ต้องว่างก่อน commit ทุกครั้ง** — dev server auto-patch ได้ ถ้าเปลี่ยนให้ `git checkout -- tsconfig.json` (repo pin `target: "ES2017"` ไว้ตั้งใจ)
- **ห้าม `git add -A`** — ระบุไฟล์ที่ commit เสมอ
- **ห้าม emoji** ในโค้ด คอมเมนต์ และ UI
- **UI ทุกข้อความเป็นภาษาไทย**
- **ห้ามแตะไฟล์เหล่านี้:** `components/entry-list.tsx` (โปรเจกต์ B) และ `components/recommendations.tsx` (โปรเจกต์ C) — มี alias สีเก่ารองรับให้แล้วใน Task 1
- **ห้ามแตะตรรกะ:** `lib/*`, `app/actions.ts`, `prisma/*`, การคิวรีทั้งหมด งานนี้เปลี่ยนเฉพาะการนำเสนอ
- **ห้ามใส่ hex สีลงในไฟล์ `components/*`** — ใช้ semantic token เท่านั้น
- **ห้ามใช้ขนาดตัวอักษรแบบ arbitrary** (`text-[0.65rem]`, `text-[11px]`) — ใช้ `text-xs/sm/base/lg/xl/2xl/3xl` เท่านั้น
- **ห้าม `tracking-widest` หรือ `uppercase` กับข้อความภาษาไทย** — `uppercase` เป็น no-op กับอักษรไทย ส่วน `tracking-widest` ทำให้สระลอยห่างจากพยัญชนะ
- branch: `feature/theme-typography` (สร้างแล้ว) — ห้าม merge เข้า master เอง

---

## File Structure

| ไฟล์ | หน้าที่ | Task |
|---|---|---|
| `scripts/check-contrast.mjs` | **สร้างใหม่** — อ่าน `globals.css` แล้วยืนยันว่าทุกคู่สีผ่านเกณฑ์ WCAG ทำหน้าที่แทน test suite | 1 |
| `app/globals.css` | token 3 ชั้นทั้งหมด + สเกลตัวอักษร + `@custom-variant dark` | 1 |
| `app/layout.tsx` | ฟอนต์ + `data-theme` + สคริปต์กันกระพริบใน `<head>` | 2 |
| `components/theme-toggle.tsx` | **สร้างใหม่** — ปุ่มสลับธีม ไม่มี React state (อ่าน/เขียน DOM ตรง) | 2 |
| `components/app-header.tsx` | หัวเว็บของ `/`, `/core-prompt`, `/dashboard` + ที่วางปุ่มสลับ | 3 |
| `components/entry-header.tsx` | หัวเว็บของหน้า entry + ที่วางปุ่มสลับ | 3 |
| `components/workspace-tabs.tsx` | แท็บในหัวเว็บหน้า entry — ต้องเป็น segmented control | 3 |
| `components/ui/{button,badge,input,textarea}.tsx` | primitive ที่บังคับกฎ affordance ให้ทั้งแอป | 4 |
| หน้า entry 6 ไฟล์ | กวาดตัวอักษร/ฟอนต์/ชื่อสี | 5 |
| หน้า dashboard + core 6 ไฟล์ | กวาดตัวอักษร/ฟอนต์/ชื่อสี | 6 |
| `CLAUDE.md` | กฎใหม่ + แก้ชื่อไฟล์ที่ล้าสมัย | 6 |

---

### Task 1: สคริปต์ตรวจ contrast + token ชุดใหม่ใน globals.css

**Files:**
- Create: `scripts/check-contrast.mjs`
- Modify: `app/globals.css` (เขียนใหม่ทั้งไฟล์)

**Interfaces:**
- Consumes: ไม่มี (task แรก)
- Produces: semantic token ที่ทุก task ถัดไปใช้ — `--background` `--foreground` `--surface` `--surface-2` `--card` `--card-foreground` `--muted` `--muted-foreground` `--primary` `--primary-foreground` `--secondary` `--secondary-foreground` `--accent` `--accent-foreground` `--border` `--border-interactive` `--input` `--ring` `--destructive` `--destructive-foreground` `--status-success` `--status-warning` `--status-danger` `--status-neutral` `--header` `--header-foreground` `--header-muted` `--header-active` `--header-active-foreground` `--chart-1..5` · คลาส Tailwind ที่ตามมา: `bg-surface` `bg-surface-2` `border-border-interactive` `bg-status-success` `bg-header` `text-header-foreground` `text-header-muted` `bg-header-active` `text-header-active-foreground` · คำสั่งตรวจ: `node scripts/check-contrast.mjs`

- [ ] **Step 1: เขียนสคริปต์ตรวจ contrast (นี่คือ "test" ของ task นี้ ต้องเขียนก่อน)**

สร้าง `scripts/check-contrast.mjs`:

```js
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
  ["--ring", "--background", 3.0],
  ["--status-success", "--surface-2", 3.0],
  ["--status-warning", "--surface-2", 3.0],
  ["--status-danger", "--surface-2", 3.0],
  ["--status-neutral", "--surface-2", 3.0],
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
```

- [ ] **Step 2: รันสคริปต์เพื่อยืนยันว่ามัน fail (ยังไม่มี token ใหม่)**

Run: `node scripts/check-contrast.mjs`
Expected: FAIL — โยน `Error: ไม่มี token --surface` (หรือ `ไม่พบบล็อก :root[data-theme="dark"]`) เพราะ `globals.css` ยังเป็นของเดิม

- [ ] **Step 3: เขียน `app/globals.css` ใหม่ทั้งไฟล์**

แทนที่เนื้อหาทั้งไฟล์ด้วย:

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";

/* ธีมสลับด้วย attribute data-theme บน <html> ตามสูตรทางการของ Next.js เวอร์ชันนี้
   (node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md)
   ไม่ใช่ class .dark — ต้องจับทั้งตัว <html> เองและลูกหลานทั้งหมด */
@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));

@theme inline {
  /* ฟอนต์ — Noto Sans Thai คุมทั้งไทยและละติน (มี glyph ครบทั้งสองชุด)
     JetBrains Mono เหลือใช้เฉพาะตัวเลขที่เรียงเป็นคอลัมน์ ห้ามใช้กับข้อความไทย
     เพราะไม่มี glyph ไทย ข้อความจะตกไปใช้ฟอนต์สำรองแบบควบคุมไม่ได้ */
  --font-sans: var(--font-thai), sans-serif;
  --font-mono: var(--font-mono-src), ui-monospace, monospace;
  --font-display: var(--font-sans);
  --font-heading: var(--font-sans);

  /* สเกลตัวอักษร — 12px คือพื้นต่ำสุด ห้ามมีอะไรเล็กกว่านี้
     line-height ของข้อความ 1.6 เพราะภาษาไทยมีสระบนและวรรณยุกต์ซ้อนสองชั้น
     ค่ามาตรฐาน 1.5 ของภาษาละตินตึงเกินไปจนสระชนบรรทัดบน */
  --text-xs: 0.75rem;
  --text-xs--line-height: 1.5;
  --text-sm: 0.875rem;
  --text-sm--line-height: 1.6;
  --text-base: 0.9375rem;
  --text-base--line-height: 1.6;
  --text-lg: 1.125rem;
  --text-lg--line-height: 1.5;
  --text-xl: 1.25rem;
  --text-xl--line-height: 1.35;
  --text-2xl: 1.5rem;
  --text-2xl--line-height: 1.35;
  --text-3xl: 1.875rem;
  --text-3xl--line-height: 1.35;

  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-surface: var(--surface);
  --color-surface-2: var(--surface-2);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-border-interactive: var(--border-interactive);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-status-success: var(--status-success);
  --color-status-warning: var(--status-warning);
  --color-status-danger: var(--status-danger);
  --color-status-neutral: var(--status-neutral);
  --color-header: var(--header);
  --color-header-foreground: var(--header-foreground);
  --color-header-muted: var(--header-muted);
  --color-header-active: var(--header-active);
  --color-header-active-foreground: var(--header-active-foreground);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);

  /* alias ชั่วคราวของชื่อพาเลตต์เดิม — ดูคอมเมนต์ท้าย :root */
  --color-ink: var(--ink);
  --color-ink-2: var(--ink-2);
  --color-paper: var(--paper);
  --color-teal: var(--teal);
  --color-amber: var(--amber);
  --color-smoke: var(--smoke);
  --color-danger: var(--danger);
  --color-success: var(--success);
  --color-success-foreground: var(--success-foreground);

  --radius-sm: calc(var(--radius) * 0.6);
  --radius-md: calc(var(--radius) * 0.8);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) * 1.4);
  --radius-2xl: calc(var(--radius) * 1.8);
  --radius-3xl: calc(var(--radius) * 2.2);
  --radius-4xl: calc(var(--radius) * 2.6);
}

:root {
  /* ═══ ชั้นที่ 1: primitive ═══
     สเกล navy สร้างบน OKLCH เพราะค่า L ตรงกับความสว่างที่ตารับรู้จริง
     ต่างจาก hex ที่ต้องเดา · เลขมากกว่า = เข้มกว่า (ตามแบบแผน Tailwind)
     พื้นที่ยิ่งกว้าง chroma ยิ่งต่ำ — พื้นหลัง/การ์ดอยู่แถว 0.006-0.020
     เก็บ chroma สูง (0.07-0.17) ไว้ให้ปุ่มและจุดสถานะซึ่งกินพื้นที่น้อย
     นี่คือกลไกที่ทำให้ตาไม่ล้า ไม่ใช่การเลือกเฉดสี */
  --navy-950: oklch(0.16 0.02 250);
  --navy-900: oklch(0.19 0.018 250);
  --navy-850: oklch(0.25 0.02 250);
  --navy-800: oklch(0.29 0.015 250);
  --navy-700: oklch(0.34 0.018 250);
  --navy-600: oklch(0.52 0.018 250);
  --navy-550: oklch(0.55 0.018 250);
  --navy-500: oklch(0.62 0.012 250);
  --navy-400: oklch(0.69 0.015 250);
  --navy-300: oklch(0.87 0.01 250);
  --navy-200: oklch(0.93 0.008 250);
  --navy-100: oklch(0.945 0.006 250);
  --navy-50: oklch(0.965 0.006 250);
  --navy-25: oklch(0.99 0.003 250);
  /* กรมท่าเข้มพิเศษสำหรับตัวอักษรบนพื้นทองเหลือง และปุ่มหลักในโหมดสว่าง */
  --navy-ink: oklch(0.18 0.03 250);
  --navy-accent: oklch(0.38 0.07 250);
  --brass-400: oklch(0.75 0.11 85);
  --brass-500: oklch(0.72 0.12 85);
  --brass-600: oklch(0.55 0.12 85);
  --green-400: oklch(0.72 0.12 155);
  --green-600: oklch(0.52 0.13 155);
  --red-400: oklch(0.7 0.14 25);
  --red-600: oklch(0.5 0.17 25);

  /* ═══ ชั้นที่ 2: semantic (โหมดสว่าง) ═══ */
  --background: var(--navy-50);
  --foreground: var(--navy-850);
  --surface: var(--navy-25);
  --surface-2: var(--navy-100);
  --card: var(--surface);
  --card-foreground: var(--foreground);
  --popover: var(--surface);
  --popover-foreground: var(--foreground);
  --muted: var(--surface-2);
  --muted-foreground: var(--navy-600);
  /* ปุ่มหลักต้องตัดกับพื้นหน้าเสมอ โหมดสว่างพื้นเกือบขาว ปุ่มจึงเป็นกรมท่าเข้ม
     โหมดมืดพื้นเป็นกรมท่า ปุ่มจึงเป็นทองเหลืองสว่าง (ดูบล็อกด้านล่าง) */
  --primary: var(--navy-accent);
  --primary-foreground: var(--navy-25);
  --secondary: var(--surface-2);
  --secondary-foreground: var(--foreground);
  --accent: var(--surface-2);
  --accent-foreground: var(--foreground);
  /* --border คือเส้นคั่นตกแต่ง จางได้ · --border-interactive คือขอบของสิ่งที่กดได้
     ต้องผ่าน 3:1 ตาม WCAG 1.4.11 ห้ามทำให้จางกว่านี้ไม่ว่าจะอยากให้ดูมินิมอลแค่ไหน
     การใช้ token เดียวทำสองหน้าที่คือสาเหตุที่ธีมเดิมแยกไม่ออกว่าอะไรกดได้ */
  --border: var(--navy-300);
  --border-interactive: var(--navy-500);
  --input: var(--border-interactive);
  --ring: var(--navy-accent);
  --destructive: var(--red-600);
  --destructive-foreground: var(--navy-25);
  --status-success: var(--green-600);
  --status-warning: var(--brass-600);
  --status-danger: var(--red-600);
  --status-neutral: var(--navy-600);
  /* หัวเว็บเป็นแถบเข้มในทั้งสองโหมดโดยตั้งใจ (เป็นองค์ประกอบแบรนด์)
     จึงมี token ของตัวเองแทนการอ้าง --background/--foreground */
  --header: var(--navy-900);
  --header-foreground: var(--navy-50);
  --header-muted: var(--navy-400);
  --header-active: var(--brass-500);
  --header-active-foreground: var(--navy-ink);
  --chart-1: var(--navy-accent);
  --chart-2: var(--brass-600);
  --chart-3: var(--navy-600);
  --chart-4: var(--green-600);
  --chart-5: var(--red-600);
  --sidebar: var(--header);
  --sidebar-foreground: var(--header-foreground);
  --sidebar-primary: var(--header-active);
  --sidebar-primary-foreground: var(--header-active-foreground);
  --sidebar-accent: var(--navy-850);
  --sidebar-accent-foreground: var(--header-foreground);
  --sidebar-border: var(--navy-700);
  --sidebar-ring: var(--ring);
  --radius: 0.75rem;

  /* ── alias ชั่วคราวของชื่อพาเลตต์เดิม ──
     เหลือไว้ให้ components/entry-list.tsx (โปรเจกต์ B) และ
     components/recommendations.tsx (โปรเจกต์ C) เท่านั้น ซึ่งจะถูกรื้อทั้งไฟล์
     ห้ามใช้ในโค้ดใหม่ · ลบทั้งบล็อกนี้และคู่ --color-* ด้านบนเมื่อสองไฟล์นั้นเสร็จ */
  --ink: var(--header);
  --ink-2: var(--navy-850);
  --paper: var(--header-foreground);
  --teal: var(--primary);
  --amber: var(--status-warning);
  --smoke: var(--muted-foreground);
  --danger: var(--destructive);
  --success: var(--surface-2);
  --success-foreground: var(--status-success);
}

/* ═══ ชั้นที่ 2: semantic (โหมดมืด) ═══
   เขียนทับเฉพาะตัวที่ต่างจริง — ตัวที่อ้าง var() ของ token ที่ถูกทับ
   (เช่น --card: var(--surface)) จะตามมาเองเพราะ CSS คลี่ var ตอนใช้งาน */
:root[data-theme="dark"] {
  --background: var(--navy-900);
  --foreground: var(--navy-200);
  --surface: var(--navy-850);
  --surface-2: var(--navy-800);
  --muted-foreground: var(--navy-400);
  --primary: var(--brass-500);
  --primary-foreground: var(--navy-ink);
  --border: var(--navy-700);
  --border-interactive: var(--navy-550);
  --ring: var(--brass-400);
  --destructive: var(--red-400);
  --destructive-foreground: var(--navy-ink);
  --status-success: var(--green-400);
  --status-warning: var(--brass-400);
  --status-danger: var(--red-400);
  --status-neutral: var(--navy-400);
  --header: var(--navy-950);
  --chart-2: var(--brass-400);
  --chart-3: var(--navy-400);
  --chart-4: var(--green-400);
  --chart-5: var(--red-400);
  --sidebar-accent: var(--navy-800);
  --sidebar-border: var(--navy-700);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground text-base;
  }
  html {
    @apply font-sans;
  }
}

@layer utilities {
  /* เส้นคั่นบางๆ ไล่สีแบรนด์ท้ายหัวเว็บ */
  .brand-divider {
    background-image: linear-gradient(90deg, var(--navy-accent), var(--brass-500));
  }
}
```

- [ ] **Step 4: รันสคริปต์ให้ผ่าน**

Run: `node scripts/check-contrast.mjs`
Expected: PASS ทุกบรรทัด ปิดท้ายด้วย `ผ่านทุกคู่` และ exit code 0
ถ้ามีคู่ไหน FAIL **ห้ามลดเกณฑ์ในสคริปต์** ให้ปรับค่า `L` ของ primitive แทน

- [ ] **Step 5: ตรวจ type และ lint**

Run: `npx tsc --noEmit` แล้ว `npm run lint`
Expected: ทั้งคู่สะอาด
หมายเหตุ: `--font-mono-src` ยังไม่มีใครนิยาม (จะถูกสร้างใน Task 2 จาก `next/font`) — ตรงนี้ไม่ทำให้ lint พัง เพราะเป็น CSS variable ที่ยังไม่ถูก resolve เท่านั้น

- [ ] **Step 6: Commit**

```bash
git add scripts/check-contrast.mjs app/globals.css
git commit -m "Add three-layer OKLCH tokens and a contrast checker"
```

---

### Task 2: ฟอนต์ + กลไกสลับธีม

**Files:**
- Modify: `app/layout.tsx` (เขียนใหม่ทั้งไฟล์)
- Create: `components/theme-toggle.tsx`

**Interfaces:**
- Consumes: token จาก Task 1 (`--color-header-*`, `--color-border-interactive`) · `@custom-variant dark` ที่จับ `[data-theme="dark"]`
- Produces: `export function ThemeToggle(): JSX.Element` จาก `@/components/theme-toggle` — ปุ่มไอคอนไม่มี prop ใดๆ Task 3 นำไปวางในหัวเว็บทั้งสองตัว · CSS variable `--font-thai` และ `--font-mono-src` ที่ `globals.css` อ้างถึง

- [ ] **Step 1: เขียน `app/layout.tsx` ใหม่**

```tsx
import type { Metadata } from "next";
import { JetBrains_Mono, Noto_Sans_Thai } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";

// Noto Sans Thai คุมทั้งข้อความไทยและละติน จึงต้องโหลด subset ทั้งสองชุด
// ถ้าใส่แค่ ["thai"] ตัวอักษรละตินจะไม่มี glyph แล้วตกไปใช้ฟอนต์ระบบแบบควบคุมไม่ได้
const thaiFont = Noto_Sans_Thai({
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-thai",
});

// เหลือไว้เฉพาะตัวเลขที่เรียงเป็นคอลัมน์ (เงิน วิว วันที่) ซึ่งความกว้างเท่ากันช่วยให้อ่านง่าย
// ห้ามใช้กับข้อความไทย — ฟอนต์นี้ไม่มี glyph ไทย
const monoFont = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono-src",
});

export const metadata: Metadata = {
  title: "Angle",
  description: "by LAGR — ประกอบ Core Prompt สำหรับสร้างวิดีโอ TikTok Shop ด้วย Gemini Flow",
};

// สคริปต์นี้ทำงานตอนเบราว์เซอร์ parse HTML คือก่อนหน้าจอวาดครั้งแรก จึงไม่มีอาการกระพริบ
// วิธีนี้มาจากเอกสารทางการของ Next.js เวอร์ชันนี้:
// node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md
// ค่าเริ่มต้นคือ "dark" ตามที่ตั้งไว้บน <html> — สคริปต์เขียนทับเฉพาะเมื่อผู้ใช้เคยเลือกไว้
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="th"
      data-theme="dark"
      suppressHydrationWarning
      className={cn("h-full", "antialiased", thaiFont.variable, monoFont.variable, "font-sans")}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col lg:h-full lg:overflow-hidden">
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Step 2: สร้าง `components/theme-toggle.tsx`**

```tsx
"use client";

import { Moon, Sun } from "lucide-react";

/**
 * ปุ่มสลับธีม — จงใจไม่เก็บ React state
 *
 * ธีมถูกตั้งบน <html data-theme> โดยสคริปต์ใน layout ก่อน React จะ hydrate
 * ถ้าคอมโพเนนต์นี้ถือ state ของตัวเอง ค่าฝั่ง server (มืดเสมอ) จะไม่ตรงกับ DOM จริง
 * ทำให้ไอคอนกระพริบสลับตอนโหลด — จึงอ่านและเขียน DOM ตรงๆ แล้วให้ CSS เป็นตัวเลือกไอคอน
 */
export function ThemeToggle() {
  function toggle() {
    const root = document.documentElement;
    const next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
    root.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      // โหมดส่วนตัวบางเบราว์เซอร์เขียน localStorage ไม่ได้ — ธีมยังสลับได้ในรอบนี้ แค่ไม่ถูกจำ
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="สลับธีมสว่างและมืด"
      title="สลับธีมสว่างและมืด"
      className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-header-muted/50 text-header-foreground transition-colors hover:bg-header-foreground/10 focus-visible:ring-2 focus-visible:ring-header-active focus-visible:outline-none"
    >
      <Moon className="size-4 dark:hidden" />
      <Sun className="hidden size-4 dark:block" />
    </button>
  );
}
```

- [ ] **Step 3: ตรวจ type และ lint**

Run: `npx tsc --noEmit` แล้ว `npm run lint`
Expected: สะอาดทั้งคู่ · `node scripts/check-contrast.mjs` ยังผ่าน

- [ ] **Step 4: ตรวจด้วย dev server แยก**

```bash
cp dev.db dev-test.db
NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001
```

ตรวจใน `http://localhost:3001`:
- เปิดครั้งแรกได้โหมดมืด (พื้นกรมท่าเข้ม ไม่ใช่ดำสนิท)
- ยังไม่มีปุ่มสลับให้กด (จะมาใน Task 3) — ทดสอบด้วย DevTools console: `localStorage.setItem("theme","light");location.reload()` แล้วต้องได้โหมดสว่าง **โดยไม่กระพริบมืดก่อน**
- กลับเป็นมืด: `localStorage.setItem("theme","dark");location.reload()` — ต้องไม่กระพริบขาว
- ข้อความไทยและตัวเลขละตินใช้ Noto Sans Thai (เช็คด้วย DevTools > Computed > font-family)
- ไม่มี hydration error ใน console

cleanup:
```bash
netstat -ano | grep ':3001' | grep LISTENING
taskkill //PID <pid> //F
rm -f dev-test.db && rm -rf .next-dev
```

- [ ] **Step 5: Commit**

```bash
git diff --stat tsconfig.json   # ต้องว่าง ถ้าไม่ว่างให้ git checkout -- tsconfig.json
git add app/layout.tsx components/theme-toggle.tsx
git commit -m "Switch to Noto Sans Thai and add flash-free theme toggle"
```

---

### Task 3: หัวเว็บทั้งสองตัว + แท็บ

**Files:**
- Modify: `components/app-header.tsx`
- Modify: `components/entry-header.tsx`
- Modify: `components/workspace-tabs.tsx`

**Interfaces:**
- Consumes: `ThemeToggle` จาก `@/components/theme-toggle` (Task 2) · token `--color-header-*` (Task 1)
- Produces: ไม่มี export ใหม่ — signature ของ `AppHeader`, `EntryHeader`, `WorkspaceTabs` ไม่เปลี่ยน จึงไม่ต้องแก้ผู้เรียก

หัวเว็บทั้งสองไฟล์มี **hex ดิบ `text-[#22c1b3]`** อยู่บนไอคอน `Compass` ซึ่งผิดกฎ "ห้าม hex ในคอมโพเนนต์" ต้องเปลี่ยนเป็น `text-header-active`

- [ ] **Step 1: แก้ `components/app-header.tsx`**

เปลี่ยน import เพิ่ม `ThemeToggle`:

```tsx
import Link from "next/link";
import { Compass } from "lucide-react";

import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";
```

แทน `<header ...>` เดิมด้วย (ทั้งบล็อก return):

```tsx
    <header className="relative bg-header text-header-foreground">
      <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <Compass className="size-6 shrink-0 text-header-active" strokeWidth={1.75} />
          <div>
            <h1 className="text-xl leading-none font-extrabold text-header-foreground sm:text-2xl">
              Angle <span className="text-sm font-normal text-header-muted">by LAGR</span>
            </h1>
            <p className="mt-1 text-xs text-header-muted">
              ประกอบ Core Prompt สำหรับวิดีโอ TikTok Shop
            </p>
          </div>
        </Link>
        <div className="flex items-center gap-2">
          {children}
          <ThemeToggle />
        </div>
      </div>

      {/* กลุ่มตัวเลือก: กรอบรวมรอบทั้งกลุ่มเป็นตัวบอกว่าทั้งแถวกดได้
          ตัวที่ไม่ได้เลือกจึงไม่ต้องมีขอบของตัวเอง (สเปกหัวข้อ 6.2) */}
      <nav
        className="mx-4 mb-3 inline-flex flex-wrap gap-1 rounded-lg border border-header-muted/40 p-1 sm:mx-6"
        aria-label="เมนูหลัก"
      >
        {NAV.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active === item.key ? "page" : undefined}
            className={cn(
              "inline-flex h-9 items-center rounded-md px-3 text-sm font-medium transition-colors",
              "focus-visible:ring-2 focus-visible:ring-header-active focus-visible:outline-none",
              active === item.key
                ? "bg-header-active text-header-active-foreground"
                : "text-header-muted hover:bg-header-foreground/10 hover:text-header-foreground"
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="brand-divider h-1 w-full" />
    </header>
```

การเปลี่ยนแปลง: `bg-ink text-paper` → `bg-header text-header-foreground` · `text-[#22c1b3]` → `text-header-active` · `text-paper/50`,`text-paper/60` → `text-header-muted` · เมนูจาก `font-mono text-xs tracking-wide` → `text-sm font-medium` (mono กับข้อความไทยเป็นของผิด) · เพิ่มความสูง `h-9` = 36px ตามเกณฑ์ · เพิ่มกรอบรวมรอบ nav · `bg-teal` → `bg-header-active` · ลบ `tracking-wide` ออกจากหัวข้อไทย

- [ ] **Step 2: แก้ `components/entry-header.tsx`**

```tsx
import Link from "next/link";
import { ArrowLeft, Compass } from "lucide-react";

import { ThemeToggle } from "@/components/theme-toggle";

export function EntryHeader({
  productName,
  children,
}: {
  productName: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="relative bg-header text-header-foreground">
      <div className="px-4 pt-3 sm:px-6">
        <Link
          href="/"
          className="inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-sm text-header-muted transition-colors hover:bg-header-foreground/10 hover:text-header-foreground focus-visible:ring-2 focus-visible:ring-header-active focus-visible:outline-none"
        >
          <ArrowLeft className="size-4" />
          กลับไปรายการ
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 px-4 pt-2 pb-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <Compass className="size-6 shrink-0 text-header-active" strokeWidth={1.75} />
          <div>
            <h1 className="text-xl leading-none font-extrabold text-header-foreground sm:text-2xl">
              Angle <span className="text-sm font-normal text-header-muted">by LAGR</span>
            </h1>
            <p className="mt-1 text-xs text-header-muted">
              ประกอบ Core Prompt สำหรับวิดีโอ TikTok Shop
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="rounded-lg border border-header-muted/40 bg-header-foreground/5 px-4 py-2">
            <p className="max-w-[14rem] truncate text-sm text-header-foreground">
              {productName || "ยังไม่ตั้งชื่อสินค้า"}
            </p>
          </div>
          <ThemeToggle />
        </div>
      </div>

      {children}

      <div className="brand-divider h-1 w-full" />
    </header>
  );
}
```

การเปลี่ยนแปลง: token สีทั้งหมด · ตัดป้ายชื่อสินค้าที่เอียง `-rotate-2` และเงา `shadow-[3px_3px_0_0_rgba(0,0,0,0.35)]` ออก (เงาเป็นสีดิบที่ผิดกฎ และป้ายเอียงอ่านยาก) · ชื่อสินค้าเลิกใช้ `font-mono` เพราะเป็นข้อความไทย · ลิงก์กลับสูง 36px

- [ ] **Step 3: แก้ `components/workspace-tabs.tsx`**

แทน `<nav>` เดิมทั้งบล็อก:

```tsx
    <nav
      className="mx-4 mb-3 inline-flex flex-wrap gap-1 rounded-lg border border-header-muted/40 p-1 sm:mx-6"
      aria-label="มุมมองงาน"
    >
      {TABS.map((tab) => {
        const isDisabled = tab.id === "production" && productionDisabled;
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            disabled={isDisabled}
            aria-current={isActive ? "page" : undefined}
            title={isDisabled ? "ยังไม่ได้บันทึกสินค้านี้" : undefined}
            onClick={() => onChange(tab.id)}
            className={cn(
              "inline-flex h-9 items-center rounded-md px-3 text-sm font-medium transition-colors",
              "focus-visible:ring-2 focus-visible:ring-header-active focus-visible:outline-none",
              isActive
                ? "bg-header-active text-header-active-foreground"
                : "text-header-muted hover:bg-header-foreground/10 hover:text-header-foreground",
              isDisabled && "cursor-not-allowed opacity-40 hover:bg-transparent"
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
```

- [ ] **Step 4: ตรวจว่าไม่มี hex และ mono ผิดที่หลงเหลือใน 3 ไฟล์นี้**

```bash
grep -n "#[0-9a-fA-F]\{3,8\}\|font-mono\|text-\[\|tracking-widest\|-teal\|-paper\|-ink\|-smoke\|-amber" components/app-header.tsx components/entry-header.tsx components/workspace-tabs.tsx
```
Expected: ไม่มีผลลัพธ์เลย

- [ ] **Step 5: ตรวจ type, lint, contrast**

Run: `npx tsc --noEmit` · `npm run lint` · `node scripts/check-contrast.mjs`
Expected: สะอาดทั้งหมด

- [ ] **Step 6: ตรวจด้วย dev server แยก**

```bash
cp dev.db dev-test.db
NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001
```

ตรวจ:
- ปุ่มสลับธีมอยู่มุมขวาบนของทั้ง `/` และ `/entry/<id>` — กดแล้วสลับทันที
- รีเฟรชแล้วธีมยังคงเดิม **และไม่กระพริบ**
- ไอคอนเปลี่ยนถูก: โหมดมืดโชว์ดวงอาทิตย์ โหมดสว่างโชว์พระจันทร์
- เมนูหลักมีกรอบรวมเห็นชัดว่าเป็นกลุ่มปุ่ม ทั้งสองโหมด
- กด Tab ไล่ทุกปุ่มในหัวเว็บ เห็นวงแหวน focus ชัดทั้งสองโหมด

cleanup ตาม Global Constraints

- [ ] **Step 7: Commit**

```bash
git diff --stat tsconfig.json
git add components/app-header.tsx components/entry-header.tsx components/workspace-tabs.tsx
git commit -m "Rework headers with theme tokens, segmented nav, and theme toggle"
```

---

### Task 4: primitive ใน components/ui

**Files:**
- Modify: `components/ui/button.tsx`
- Modify: `components/ui/badge.tsx`
- Modify: `components/ui/input.tsx`
- Modify: `components/ui/textarea.tsx`

**Interfaces:**
- Consumes: token จาก Task 1
- Produces: `Badge` เปลี่ยน API — เพิ่ม prop **บังคับ** ไม่ได้ แต่พฤติกรรมเปลี่ยน: ทุก variant ใช้พื้น `bg-surface-2` เหมือนกันหมด และแสดง **จุดสี** ตาม variant · `BadgeVariant` ยังเป็น `"success" | "warning" | "neutral" | "danger"` เหมือนเดิม ผู้เรียกไม่ต้องแก้ · ขนาดปุ่ม `default` เปลี่ยนจาก `h-8` (32px) เป็น `h-9` (36px), `sm` จาก `h-7` เป็น `h-8`, `icon` จาก `size-8` เป็น `size-9`

- [ ] **Step 1: แก้ `components/ui/button.tsx` — ขนาดและ variant**

ในบล็อก `variants.variant` แทน 2 บรรทัดนี้:

```tsx
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
```
เป็น
```tsx
        // ขอบต้องผ่าน 3:1 เพราะเป็นสัญญาณเดียวที่บอกว่ากดได้ (สเปกหัวข้อ 6.2)
        outline:
          "border-border-interactive bg-transparent hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
```

และแทน
```tsx
        secondary:
          "border border-[color-mix(in_oklch,var(--secondary-foreground),transparent_80%)] bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
```
เป็น
```tsx
        secondary:
          "border-border-interactive bg-secondary text-secondary-foreground hover:bg-muted aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
```

ในบล็อก `variants.size` แทนทั้งบล็อกด้วย (ปุ่มสูงขั้นต่ำ 36px เป้าไอคอนขั้นต่ำ 24px):

```tsx
      size: {
        default:
          "h-9 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-8 gap-1 rounded-[min(var(--radius-md),10px)] px-2.5 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-8 gap-1 rounded-[min(var(--radius-md),12px)] px-3 text-sm in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 gap-1.5 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-9",
        "icon-xs":
          "size-8 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm":
          "size-8 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-10",
      },
```

**หมายเหตุ:** `size: "sm"` เดิมใช้ `text-[0.8rem]` ซึ่งเป็นขนาด arbitrary ที่ผิดกฎ — เปลี่ยนเป็น `text-sm` แล้วในโค้ดข้างบน

- [ ] **Step 2: เขียน `components/ui/badge.tsx` ใหม่ทั้งไฟล์**

```tsx
import { cn } from "@/lib/utils";

/**
 * จุดสีเป็นตัวสื่อสถานะ ส่วนพื้นและตัวอักษรเป็นกลางเหมือนกันทุก variant
 *
 * เหตุผล: ถ้าย้อมทั้งก้อนตามสถานะ badge จะหน้าตาใกล้ปุ่มจนแยกไม่ออกว่าอันไหนกดได้
 * และตัวอักษรสีเดียวกับพื้นของมันเอง (tone-on-tone) อ่านยากกว่าที่คิด
 * จุดสีทุกตัวผ่าน 3:1 บนพื้น --surface-2 ตาม WCAG 1.4.11 (ตรวจโดย scripts/check-contrast.mjs)
 */
const BADGE_DOT_CLASS = {
  success: "bg-status-success",
  warning: "bg-status-warning",
  neutral: "bg-status-neutral",
  danger: "bg-status-danger",
} as const;

export type BadgeVariant = keyof typeof BADGE_DOT_CLASS;

export function Badge({
  variant,
  children,
  className,
}: {
  variant: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        // ทรงแคปซูลและจุดสีคือสิ่งที่แยก badge ออกจากปุ่ม ซึ่งมุมโค้ง 8px และไม่มีจุด
        "inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-foreground",
        className
      )}
    >
      <span
        aria-hidden="true"
        className={cn("size-1.5 shrink-0 rounded-full", BADGE_DOT_CLASS[variant])}
      />
      {children}
    </span>
  );
}
```

- [ ] **Step 3: แก้ `components/ui/input.tsx`**

แทนสตริงคลาสทั้งก้อนใน `cn(...)` ด้วย:

```tsx
        "flex h-9 w-full min-w-0 rounded-lg border border-input bg-surface px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
```

(สูง 36px · พื้น `bg-surface` ให้ต่างจากพื้นหน้า · ตัด `dark:bg-input/30` ที่กลบพื้นในโหมดมืดออก เพราะ token จัดการให้แล้ว)

- [ ] **Step 4: แก้ `components/ui/textarea.tsx`**

```tsx
        "flex min-h-20 w-full rounded-lg border border-input bg-surface px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
```

- [ ] **Step 5: ตรวจ type และ lint**

Run: `npx tsc --noEmit` · `npm run lint`
Expected: สะอาด — โดยเฉพาะต้องไม่มี error จากผู้เรียก `Badge` เพราะ signature ไม่เปลี่ยน

- [ ] **Step 6: ตรวจว่าไม่เหลือของต้องห้ามใน 4 ไฟล์**

```bash
grep -n "text-\[\|#[0-9a-fA-F]\{3,8\}\|font-mono" components/ui/button.tsx components/ui/badge.tsx components/ui/input.tsx components/ui/textarea.tsx
```
Expected: ไม่มีผลลัพธ์

- [ ] **Step 7: ตรวจด้วย dev server แยก**

เปิด `/` และ `/entry/<id>` แล้วดู:
- ปุ่มทุกตัวสูงอย่างน้อย 36px (วัดด้วย DevTools)
- ปุ่ม outline/secondary มีขอบเห็นชัดทั้งสองโหมด แยกออกจากกล่องธรรมดาได้โดยไม่ต้อง hover
- badge เป็นแคปซูลมีจุดสีนำหน้า และ**ดูไม่เหมือนปุ่ม**
- ช่องกรอกมีขอบชัด และ focus ring เห็นชัดทั้งสองโหมด

cleanup ตาม Global Constraints

- [ ] **Step 8: Commit**

```bash
git diff --stat tsconfig.json
git add components/ui/button.tsx components/ui/badge.tsx components/ui/input.tsx components/ui/textarea.tsx
git commit -m "Give buttons, badges, and fields visible affordance and 36px targets"
```

---

### Task 5: กวาดหน้า entry

**Files:**
- Modify: `components/brief-form.tsx`
- Modify: `components/product-spec-panel.tsx`
- Modify: `components/production-panel.tsx`
- Modify: `components/script-output.tsx`
- Modify: `components/angle-panel.tsx`
- Modify: `components/history-rail.tsx`

**Interfaces:**
- Consumes: token (Task 1), `Badge`/`Button` ที่เปลี่ยนพฤติกรรมแล้ว (Task 4)
- Produces: ไม่มี export ใหม่ ไม่มี signature เปลี่ยน — งานนี้แก้เฉพาะคลาส CSS

**ตารางแปลงคลาส — ใช้ตัวนี้กับทุกไฟล์ในทั้ง Task 5 และ 6:**

| เจอแบบนี้ | เปลี่ยนเป็น | เหตุผล |
|---|---|---|
| `text-[0.55rem]` `text-[0.6rem]` `text-[0.65rem]` `text-[0.7rem]` `text-[0.8rem]` | `text-xs` | ต่ำกว่าพื้น 12px |
| `font-mono` ที่ห่อ **ข้อความไทย** | ลบทิ้ง | ฟอนต์ไม่มี glyph ไทย |
| `font-mono` ที่ห่อ **ตัวเลข/วันที่/รหัส** | เก็บไว้ | ตัวเลขความกว้างเท่ากันช่วยอ่านคอลัมน์ |
| `tracking-widest` / `tracking-wide` บนข้อความไทย | ลบทิ้ง | ทำให้สระลอยห่างจากพยัญชนะ |
| `uppercase` บนข้อความไทย | ลบทิ้ง | เป็น no-op กับอักษรไทย |
| `leading-snug` บนข้อความไทย | ลบทิ้ง (ให้ใช้ค่า 1.6 จาก token) | 1.375 ตึงเกินไปสำหรับไทย |
| `bg-teal` | `bg-primary` | |
| `text-teal` | `text-primary` | |
| `border-teal` / `border-teal/50` | `border-primary` / `border-primary/50` | |
| `focus-visible:ring-teal` | `focus-visible:ring-ring` | |
| `bg-ink` / `bg-ink-2` | `bg-header` / `bg-surface-2` | |
| `text-paper` / `text-paper/50` / `text-paper/60` | `text-header-foreground` / `text-header-muted` | เฉพาะที่อยู่บนพื้นหัวเว็บ |
| `text-smoke` | `text-muted-foreground` | |
| `bg-amber` / `text-amber` | `bg-status-warning` / `text-status-warning` | |
| `text-danger` / `bg-danger` | `text-destructive` / `bg-destructive` | |
| `bg-success` / `text-success-foreground` | `bg-surface-2` / `text-status-success` | |
| `bg-card` | `bg-surface` | ชื่อตามบทบาทจริง |
| `border-border` บนสิ่งที่**กดได้** | `border-border-interactive` | ต้องผ่าน 3:1 |
| `border-border` บนกล่อง/เส้นคั่น | คงเดิม | เป็นของตกแต่ง |
| hex ดิบใดๆ (`text-[#22c1b3]`, `rgba(...)` ใน shadow) | token ที่ตรงบทบาท | |

- [ ] **Step 1: ไล่ดูของต้องแก้ในทั้ง 6 ไฟล์**

```bash
grep -n "text-\[\|font-mono\|tracking-wide\|uppercase\|leading-snug\|-teal\|-paper\|-ink\|-smoke\|-amber\|-danger\|bg-success\|bg-card\|#[0-9a-fA-F]\{3,8\}" components/brief-form.tsx components/product-spec-panel.tsx components/production-panel.tsx components/script-output.tsx components/angle-panel.tsx components/history-rail.tsx
```

บันทึกจำนวนบรรทัดที่เจอไว้ก่อนแก้ เพื่อเทียบตอนจบ

- [ ] **Step 2: แก้ทีละไฟล์ตามตารางแปลงคลาส**

ทำทีละไฟล์ตามลำดับด้านบน สำหรับแต่ละจุดที่ grep เจอ ให้ตัดสินจากบริบทว่าข้อความนั้นเป็นไทยหรือตัวเลข แล้วใช้ตารางแปลง

**เพิ่มเติมเฉพาะจุด:**
- `history-rail.tsx` — เป็นแถบข้างที่มีรายการ 15 อัน ชื่อสินค้าในนั้นให้ใช้ `text-sm font-semibold` (ไม่ใช่ `text-lg` เพราะเป็นแถบแคบ ไม่ใช่รายการหลัก)
- `script-output.tsx` — กล่องแสดง 10-part prompt เป็น **ข้อความยาวปนไทย-อังกฤษ** ให้ใช้ `font-sans text-sm` ไม่ใช่ `font-mono` (mono ทำให้ท่อนไทยพัง) แต่ถ้ามีกล่องโค้ด/JSON ให้คง `font-mono`
- `production-panel.tsx` — ตัวเลขรายได้/วิว/วันที่ **คง `font-mono`** ไว้ · ระวังอย่าแตะ `toDateInputValue` / `toLocalDateInputValue` (ตรรกะวันที่ ห้ามแตะตาม Global Constraints)
- `brief-form.tsx` — ปุ่มลบรูปที่เป็นวงกลมเล็ก ต้องมีเป้าคลิกอย่างน้อย 24×24px (`size-6` ขึ้นไป)

- [ ] **Step 3: ยืนยันว่าของต้องห้ามเหลือศูนย์**

```bash
grep -n "text-\[\|-teal\|-paper\|-ink\|-smoke\|-amber\|-danger\b\|bg-success\|#[0-9a-fA-F]\{3,8\}" components/brief-form.tsx components/product-spec-panel.tsx components/production-panel.tsx components/script-output.tsx components/angle-panel.tsx components/history-rail.tsx
```
Expected: ไม่มีผลลัพธ์

```bash
grep -n "font-mono" components/brief-form.tsx components/product-spec-panel.tsx components/production-panel.tsx components/script-output.tsx components/angle-panel.tsx components/history-rail.tsx
```
Expected: เหลือเฉพาะบรรทัดที่ห่อตัวเลข/วันที่/รหัสเท่านั้น — ตรวจทีละบรรทัดด้วยตา ไม่ใช่แค่นับจำนวน

- [ ] **Step 4: ตรวจ type, lint, contrast**

Run: `npx tsc --noEmit` · `npm run lint` · `node scripts/check-contrast.mjs`

- [ ] **Step 5: ตรวจด้วย dev server แยก**

เปิด `/entry/<id>` แล้วไล่ทั้งสองแท็บ ทั้งสองโหมด:
- ไม่มีข้อความไทยที่ตัวอักษรห่างผิดปกติหรือสระชนบรรทัดบน
- ทุกปุ่มดูออกว่ากดได้โดยไม่ต้อง hover
- แผงสเปกสินค้า/angle/รูปภาพ อ่านออกทั้งสองโหมด
- ไม่มีข้อความจางจนอ่านไม่ออกบนพื้นใดๆ

cleanup ตาม Global Constraints

- [ ] **Step 6: Commit**

```bash
git diff --stat tsconfig.json
git add components/brief-form.tsx components/product-spec-panel.tsx components/production-panel.tsx components/script-output.tsx components/angle-panel.tsx components/history-rail.tsx
git commit -m "Apply new type scale and theme tokens across entry page panels"
```

---

### Task 6: กวาดหน้ารายได้และ Core Prompt + ปิดงาน

**Files:**
- Modify: `components/dashboard-panel.tsx`
- Modify: `components/revenue-charts.tsx`
- Modify: `components/revenue-by-clip.tsx`
- Modify: `components/import-log-panel.tsx`
- Modify: `components/reconciliation.tsx`
- Modify: `components/core-prompt-panel.tsx`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: ทุกอย่างจาก Task 1-5
- Produces: ไม่มี export ใหม่

- [ ] **Step 1: ไล่ดูของต้องแก้**

```bash
grep -n "text-\[\|font-mono\|tracking-wide\|uppercase\|leading-snug\|-teal\|-paper\|-ink\|-smoke\|-amber\|-danger\|bg-success\|bg-card\|#[0-9a-fA-F]\{3,8\}" components/dashboard-panel.tsx components/revenue-charts.tsx components/revenue-by-clip.tsx components/import-log-panel.tsx components/reconciliation.tsx components/core-prompt-panel.tsx
```

- [ ] **Step 2: แก้ทีละไฟล์ตามตารางแปลงคลาสใน Task 5**

**เพิ่มเติมเฉพาะจุด:**
- `revenue-charts.tsx` ใช้ **Recharts v3.9.2** ซึ่ง API ต่างจากตัวอย่างทั่วไปที่มักเป็น v2 — **ห้ามเดา prop shape** ถ้าต้องแก้ prop ให้เช็ค `node_modules/recharts/types/` ก่อน · สีของกราฟผูกผ่าน `var(--color-chart-N)` อยู่แล้ว ซึ่ง Task 1 นิยามให้สลับตามโหมดแล้ว จึงไม่ต้องแก้ตรรกะสี แค่แก้ label/ตัวอักษรรอบกราฟ
- `revenue-charts.tsx` มีคอมโพเนนต์วาดเอง `WindowCompareBars` และ `Sparkline` ที่ใช้ `bg-smoke/50` และ `bg-teal` — แปลงเป็น `bg-muted-foreground/50` และ `bg-primary`
- ตัวเลขเงิน/วิว/เปอร์เซ็นต์ทั้งหมดในหน้านี้ **คง `font-mono`** ไว้ (นี่คือเหตุผลหลักที่เก็บ mono ไว้ตั้งแต่แรก)
- `dashboard-panel.tsx` และ `import-log-panel.tsx` — ป้าย "เกินกำหนดมา N วัน" และแถบเตือน ใช้ `text-status-warning` / `text-destructive` ตามความรุนแรง

- [ ] **Step 3: ยืนยันของต้องห้ามเหลือศูนย์ทั้งแอป (ยกเว้น 2 ไฟล์ที่กันไว้)**

```bash
grep -rn "text-\[0\.\|text-\[1[01]px\]" --include=*.tsx components app | grep -v "entry-list.tsx\|recommendations.tsx"
```
Expected: ไม่มีผลลัพธ์

```bash
grep -rn "#[0-9a-fA-F]\{3,8\}" --include=*.tsx components app | grep -v "entry-list.tsx\|recommendations.tsx"
```
Expected: ไม่มีผลลัพธ์

```bash
grep -rn "\-teal\b\|\-paper\b\|\-ink\b\|\-ink-2\b\|\-smoke\b\|\-amber\b" --include=*.tsx components app | grep -v "entry-list.tsx\|recommendations.tsx"
```
Expected: ไม่มีผลลัพธ์ — ถ้ามีเหลือแปลว่ายังกวาดไม่ครบ

- [ ] **Step 4: อัปเดต `CLAUDE.md`**

ในหัวข้อ `## Architecture` ให้แก้ 3 จุด:

1. แทนบรรทัดที่ระบุ design token เดิม:
```
- Design tokens ที่กำหนดเอง (สีชื่อ `ink`/`paper`/`teal`/`amber`/`smoke`/`danger`/`success` — palette "Dusk Market", ฟอนต์ `Plus Jakarta Sans`/`Noto Sans Thai`/`JetBrains Mono`) อยู่ใน `app/globals.css` และ `app/layout.tsx` — ให้ใช้ของเดิม อย่าเพิ่มสี/ฟอนต์ใหม่ขึ้นมาเอง
```
ด้วย:
```
- **ธีมเป็น token 3 ชั้นใน `app/globals.css`** (primitive OKLCH `--navy-*`/`--brass-*`/`--green-*`/`--red-*` → semantic `--background`/`--surface`/`--primary`/… → คอมโพเนนต์) สลับสว่าง/มืดด้วย attribute `data-theme` บน `<html>` (ไม่ใช่ class `.dark`) ตามสูตรใน `node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md` — สคริปต์กันกระพริบอยู่ใน `<head>` ของ `app/layout.tsx` ปุ่มสลับคือ `components/theme-toggle.tsx` (ไม่มี React state โดยตั้งใจ อ่าน/เขียน DOM ตรง) ฟอนต์คือ **Noto Sans Thai** ทั้งไทยและละติน ส่วน **JetBrains Mono ใช้เฉพาะตัวเลขที่เรียงเป็นคอลัมน์ ห้ามใช้กับข้อความไทยเด็ดขาด** (ไม่มี glyph ไทย)
- **กฎที่ห้ามละเมิดเวลาแก้ UI:** ① ห้ามใช้ขนาดตัวอักษร arbitrary (`text-[...]`) ใช้ `text-xs`(12px พื้นต่ำสุด)/`sm`/`base`/`lg`/`xl`/`2xl`/`3xl` เท่านั้น ② ห้ามใส่ hex ในไฟล์ `components/*` ③ **`--border` คือเส้นคั่นตกแต่ง ส่วน `--border-interactive` คือขอบของสิ่งที่กดได้ซึ่งต้องผ่าน 3:1** อย่าสลับกัน — การใช้ token เดียวทำสองหน้าที่คือสาเหตุที่ธีมเดิมแยกไม่ออกว่าอะไรกดได้ ④ `line-height` ข้อความไทยขั้นต่ำ 1.6 และห้าม `tracking-widest`/`uppercase` กับข้อความไทย ⑤ ปุ่มสูงขั้นต่ำ 36px เป้าคลิกไอคอน 24×24px
- **`node scripts/check-contrast.mjs` คือ test เดียวที่ธีมนี้มี** — อ่านค่าจริงจาก `globals.css` แล้วตรวจทุกคู่สีตาม WCAG ต้องรันและผ่านทุกครั้งที่แก้สี ถ้าตกเกณฑ์ให้ปรับค่า `L` ของ primitive **ห้ามลดเกณฑ์ในสคริปต์**
- **หนี้ที่ค้างอยู่:** `:root` ยังมี alias ชื่อสีเก่า (`--teal`/`--paper`/`--ink`/`--smoke`/`--amber`/…) เหลือไว้ให้ `components/entry-list.tsx` และ `components/recommendations.tsx` ซึ่งจะถูกรื้อในโปรเจกต์ถัดไป **ห้ามใช้ชื่อพวกนี้ในโค้ดใหม่** และให้ลบทั้งบล็อกเมื่อสองไฟล์นั้นเสร็จ
```

2. ในบรรทัดที่บรรยายโครงสร้าง route แก้ชื่อไฟล์ `clapper-header.tsx` เป็น `entry-header.tsx` (ไฟล์ชื่อ `clapper-header.tsx` ไม่มีอยู่จริงแล้ว) และตัดวลี "(มี take number)" ออกถ้ามี

3. ในหัวข้อ `## Testing / verification` เพิ่มบรรทัด:
```
- แก้ UI/สี ต้องรัน `node scripts/check-contrast.mjs` ให้ผ่านก่อนเสมอ (ดูหัวข้อ Architecture)
```

- [ ] **Step 5: ตรวจ type, lint, contrast**

Run: `npx tsc --noEmit` · `npm run lint` · `node scripts/check-contrast.mjs`
Expected: สะอาดทั้งหมด

- [ ] **Step 6: ตรวจด้วย dev server แยก — ไล่ทุกหน้า ทั้งสองโหมด**

```bash
cp dev.db dev-test.db
NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001
```

รายการตรวจ (ทำซ้ำทั้งโหมดมืดและสว่าง):
- `/` — หน้ารายการ (ยังใช้สีผ่าน alias อยู่ ต้องไม่พังและอ่านออก)
- `/entry/<id>` — ทั้งสองแท็บ
- `/entry/new`
- `/core-prompt` — ทั้งสอง instance (core และ caption)
- `/dashboard` — กราฟ Recharts ทั้งหมดต้องอ่านออกทั้งสองโหมด เส้น/แกน/tooltip ไม่จมพื้น
- สลับธีมค้างไว้แล้วรีเฟรชทุกหน้า ต้องไม่กระพริบ
- กด Tab ไล่ทั้งหน้า วงแหวน focus เห็นชัดทุกจุด
- console ต้องไม่มี error หรือ hydration warning

cleanup ตาม Global Constraints

- [ ] **Step 7: Commit**

```bash
git diff --stat tsconfig.json
git add components/dashboard-panel.tsx components/revenue-charts.tsx components/revenue-by-clip.tsx components/import-log-panel.tsx components/reconciliation.tsx components/core-prompt-panel.tsx CLAUDE.md
git commit -m "Sweep dashboard and core-prompt pages, document new theme rules"
```

- [ ] **Step 8: build เต็ม — ต้องขออนุญาตผู้ใช้ก่อน**

**ห้ามรันเอง** ให้ถามผู้ใช้ก่อนว่า port 3000 ว่างไหม (ผู้ใช้รัน `start.bat` อยู่) เมื่อได้รับอนุญาตแล้ว:

```bash
netstat -ano | grep ':3000' | grep LISTENING   # ต้องไม่มีผลลัพธ์
npm run build
```
Expected: build สำเร็จ ไม่มี type error

ถ้า `.next` เคยถูกเขียนซ้อนจนพัง (`Cannot find module 'better-sqlite3-...'`) ให้ `rm -rf .next` แล้ว build ใหม่

---

## Self-Review

ตรวจแผนกับสเปกแล้ว:

| สเปกหัวข้อ | ครอบคลุมโดย |
|---|---|
| 3 การตัดสินใจ 6 ข้อ | Task 1 (สี), 2 (ฟอนต์+toggle+ค่าเริ่มต้นมืด), 3 (ตำแหน่งปุ่มทั้ง 2 หัวเว็บ), 5-6 (ขอบเขตกวาด เว้น 2 ไฟล์) |
| 3.1 ข้อห้าม AI slop | Task 1 (ไม่มีดำ/ขาวสนิท ไม่มี gradient ม่วง-น้ำเงิน), Task 4 (badge เลิก tone-on-tone) |
| 4.1 token 3 ชั้น | Task 1 Step 3 |
| 4.2 บทบาท navy/brass | Task 1 Step 3 (คอมเมนต์ `--primary`) |
| 4.3 ค่าจริง | Task 1 Step 3 + ตรวจโดย Step 4 |
| 4.4 ปุ่ม brass ใช้ตัวอักษร ink | Task 1 (`--primary-foreground: var(--navy-ink)` ในบล็อกมืด) |
| 4.4 แยก border 2 token | Task 1 + Task 4 Step 1 (`border-border-interactive`) |
| 4.5 alias 143 จุด | Task 1 Step 3 (บล็อก alias) + Task 6 Step 4 (บันทึกหนี้ใน CLAUDE.md) |
| 5.1 ฟอนต์ + `subsets: ["thai","latin"]` | Task 2 Step 1 |
| 5.2 สเกล | Task 1 Step 3 (`@theme inline` ส่วน `--text-*`) |
| 5.3 กฎบังคับ 3 ข้อ | Global Constraints + ตารางแปลงคลาส Task 5 + grep ใน Task 6 Step 3 |
| 6.1-6.2 affordance 3 ระดับ | Task 3 (กลุ่มตัวเลือกมีกรอบรวม), Task 4 (หลัก/รอง) |
| 6.3 ขนาด 36px / 24×24 | Task 4 Step 1 + Task 5 Step 2 (ปุ่มลบรูป) |
| 6.4 focus/hover/active/disabled | Task 4 (คง `active:translate-y-px` และ ring เดิม) + Task 3 (ring ในหัวเว็บ) |
| 6.5 badge ≠ ปุ่ม | Task 4 Step 2 |
| 7 กลไก toggle | Task 2 |
| 9 การตรวจสอบ | ทุก task มี step ตรวจ + Task 6 Step 8 |
| 10 CLAUDE.md | Task 6 Step 4 |

**ช่องว่างที่รู้ตัวและยอมรับ:** สเปกหัวข้อ 6.2 ระดับ "กลุ่มตัวเลือก" ถูกนำไปใช้จริงแค่ในหัวเว็บ (Task 3) — แถวตัวกรองในหน้ารายการซึ่งเป็นตัวอย่างที่ผู้ใช้บ่นถึงโดยตรงอยู่ใน `entry-list.tsx` ที่กันไว้ให้โปรเจกต์ B ตามการตัดสินใจข้อ 6 ในสเปก
