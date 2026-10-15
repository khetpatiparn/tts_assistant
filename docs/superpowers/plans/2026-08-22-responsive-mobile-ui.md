# Responsive Mobile/Tablet UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ทำให้แอปใช้งานได้จริงบนโทรศัพท์และแท็บเล็ต โดยเลย์เอาต์เดสก์ท็อปที่ผู้ใช้ทำงานทุกวันต้องไม่เปลี่ยนแม้แต่พิกเซลเดียว

**Architecture:** เพิ่มพฤติกรรมใหม่เฉพาะช่วง `base`–`md:` แล้วปล่อยให้คลาส `lg:`/`xl:` ที่มีอยู่ทำงานเหมือนเดิมทุกตัวอักษร ไม่มีการสร้างคอมโพเนนต์มือถือแยกชุด ไม่มี bottom tab bar ไม่มี PWA ทุกอย่างอยู่ในไฟล์เดิม ยกเว้น `lib/clipboard.ts` ที่แยกออกมาเพราะมี 3 call sites ใช้ร่วมกัน

**Tech Stack:** Next.js 16.2.10 (custom build) · React 19.2.4 · Tailwind v4 (CSS-first, ไม่มี `tailwind.config.*`) · `@base-ui/react` 1.6 (ไม่ใช่ Radix) · Recharts 3.9.2 · Prisma 7 + SQLite · Playwright (ติดตั้งใน scratch dir ไม่ใช่ dependency ของโปรเจกต์)

**Spec:** `docs/superpowers/specs/2026-08-22-responsive-mobile-ui-design.md`

## Global Constraints

ข้อกำหนดต่อไปนี้ใช้กับ**ทุก task** ในแผนนี้ ไม่ต้องเขียนซ้ำในแต่ละ task:

- **`lg:` ขึ้นไปห้ามแตะ** — คลาสที่ขึ้นต้นด้วย `lg:` หรือ `xl:` ที่มีอยู่แล้วต้องเหลือเหมือนเดิมทุกตัวอักษร การเพิ่ม `lg:` ใหม่เพื่อ**คืน**ค่าเดิมทำได้ (เช่น `flex-col lg:flex-row` แทน `flex-row`) แต่การเปลี่ยนค่าที่ `lg:` เคยให้ไว้ทำไม่ได้
- **breakpoints:** `base` 0–639px (โทรศัพท์) · `sm:` 640px · `md:` 768px (แท็บเล็ต, 2 คอลัมน์) · `lg:` 1024px (เดสก์ท็อป, ของเดิม)
- **ห้ามใช้ขนาดตัวอักษร arbitrary** (`text-[...]`) — ใช้ `text-xs`(12px พื้นต่ำสุด)/`sm`/`base`/`lg`/`xl`/`2xl`/`3xl` เท่านั้น
- **ห้ามใส่ hex ในไฟล์ `components/*`**
- **`--border` คือเส้นคั่นตกแต่ง · `--border-interactive` คือขอบของสิ่งที่กดได้ (ต้องผ่าน 3:1)** ห้ามสลับกัน
- **`line-height` ข้อความไทยขั้นต่ำ 1.6** และห้าม `tracking-widest`/`uppercase` กับข้อความไทย
- **เป้าสัมผัส 44px ที่ต่ำกว่า `lg:` · 36px ที่ `lg:` ขึ้นไป** (กฎเดิมคือ 36px ทุกขนาดจอ — ผู้ใช้อนุมัติการแก้แล้ว Task 15 จะไปอัปเดต CLAUDE.md)
- **`JetBrains Mono` ใช้เฉพาะตัวเลขที่เรียงเป็นคอลัมน์ ห้ามใช้กับข้อความไทยเด็ดขาด** (ไม่มี glyph ไทย)
- **ห้ามใช้ `dev.db` ตัวจริงตอนทดสอบ UI** — ใช้ `dev-test.db` เสมอ (SQLite ไม่ได้เปิด WAL เสี่ยง lock ชนกับผู้ใช้)
- **ห้ามรัน `npm run build`/`npm run dev` ซ้อนกันบน `.next` โฟลเดอร์เดียวกัน** — dev server ของ agent ต้องใช้ `NEXT_DIST_DIR=.next-dev` เสมอ
- **ห้าม kill process บน port 3000** — นั่นคือ `start.bat` ของผู้ใช้ ถ้า port ไม่ว่างและจำเป็นต้องใช้ ให้ถามผู้ใช้
- **`git diff tsconfig.json` ก่อน commit ทุกครั้ง** — dev server auto-patch ได้ ถ้าเปลี่ยนให้ `git checkout -- tsconfig.json` (repo pin `target: "ES2017"` ไว้ตั้งใจ)
- **ห้ามเดา API ของ Next.js / Recharts / Base UI** — `next` เป็น build พิเศษ อ่าน `node_modules/next/dist/docs/01-app/` · Recharts v3.9.2 อ่าน `node_modules/recharts/types/` · Base UI อ่าน `node_modules/@base-ui/react/docs/react/components/`

---

## File Structure

**สร้างใหม่:**

| ไฟล์ | หน้าที่ |
|---|---|
| `lib/clipboard.ts` | ตรรกะคัดลอกข้อความแบบ 3 ชั้น (Clipboard API → execCommand → manual) แยก deps ออกมาให้ทดสอบได้ ไม่ import อะไรเลย |
| `scripts/check-clipboard.mjs` | ตรวจ `lib/clipboard.ts` ตามแพตเทิร์นเดียวกับ `scripts/check-date-filter-label.mjs` |
| `scripts/shot.mjs` | ถ่าย screenshot ทุกหน้าที่ 390/820/1440px ด้วย Playwright (อยู่ใน repo ได้เพราะ Playwright ถูก resolve จาก scratch dir ผ่าน env) |

**แก้ไข (เฟส 1):** `app/layout.tsx` · `app/globals.css` · `next.config.ts` · `components/ui/button.tsx` · `components/history-rail.tsx` · `components/workspace-tabs.tsx` · `components/entry-workspace.tsx` · `components/entry-header.tsx` · `components/app-header.tsx` · `components/entry-list.tsx` · `components/production-panel.tsx` · `components/brief-form.tsx`

**แก้ไข (เฟส 2):** `components/candidates-route.tsx` · `components/revenue-charts.tsx` · `components/revenue-by-clip.tsx` · `components/recommendations.tsx` · `components/angle-panel.tsx` · `components/import-log-panel.tsx` · `components/date-picker-field.tsx` · `components/dashboard-panel.tsx` · `components/core-prompt-panel.tsx` · `components/entry-filters.tsx` · `components/script-output.tsx` · `CLAUDE.md`

**ไม่แตะ:** `app/actions.ts` · `lib/entry-queries.ts` · `lib/dashboard.ts` · `lib/recommender.ts` · `lib/affiliate.ts` · `prisma/` — งานนี้ไม่แตะตรรกะธุรกิจหรือฐานข้อมูลเลยแม้แต่บรรทัดเดียว

---

# เฟส 1 — ทำให้ใช้งานได้จริง

## Task 1: ชุดตรวจสอบ + screenshot ฐาน

ทุก task ที่เหลือพึ่งชุดนี้ และ screenshot ที่ 1440px จาก task นี้คือ**หลักฐานฐาน**ที่ใช้พิสูจน์ว่าเดสก์ท็อปไม่เปลี่ยน

**Files:**
- Create: `scripts/shot.mjs`
- Create: `dev-test.db` (คัดลอกจาก `dev.db`, gitignore แล้ว)
- Create: `docs/superpowers/plans/screenshots/baseline/` (ผลลัพธ์ ไม่ commit)

**Interfaces:**
- Consumes: ไม่มี
- Produces: `node scripts/shot.mjs <outDir>` ถ่าย screenshot ทุกหน้าที่ 3 ความกว้าง ตั้งชื่อไฟล์ `<page>-<width>.png`

- [ ] **Step 1: คัดลอกฐานข้อมูลทดสอบ**

```bash
cd "C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt"
cp dev.db dev-test.db
git check-ignore dev-test.db && echo "gitignored OK"
```

Expected: พิมพ์ `dev-test.db` แล้วตามด้วย `gitignored OK` — ถ้าไม่ขึ้นให้หยุดและเพิ่มลง `.gitignore` ก่อน

- [ ] **Step 2: ติดตั้ง Playwright ใน scratch dir (ไม่ใช่ใน repo)**

```bash
SCRATCH="C:/Users/patip/AppData/Local/Temp/claude/C--Users-patip-Desktop-playground-tts-assistant-pooling-pooling-prompt/aca2ec64-8550-488c-b8cb-003298a3e965/scratchpad"
mkdir -p "$SCRATCH/pw" && cd "$SCRATCH/pw"
npm init -y >/dev/null
npm i playwright
npx playwright install chromium
```

Expected: ติดตั้งสำเร็จ ไม่มี error

> **ทำไมไม่ติดตั้งใน repo:** `package.json` จะเปลี่ยนและกลายเป็น dependency ถาวรของโปรเจกต์ที่ผู้ใช้ไม่ได้ขอ

- [ ] **Step 3: เขียน `scripts/shot.mjs`**

```js
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

const { chromium } = await import(
  pathToFileURL(join(pwRoot, "node_modules", "playwright", "index.js")).href
);

// entryId ถูกฉีดผ่าน env เพราะ id เป็น cuid ที่ต่างกันในแต่ละเครื่อง
// หา id จริงได้ด้วย: npx prisma db execute --stdin <<< "SELECT id FROM PromptEntry LIMIT 1;"
const entryId = process.env.ENTRY_ID || "";

const PAGES = [
  { name: "list", path: "/" },
  { name: "products", path: "/products" },
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
```

- [ ] **Step 4: หา entryId จริงจากฐานข้อมูลทดสอบ**

```bash
cd "C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt"
npx prisma db execute --stdin <<< "SELECT id FROM PromptEntry WHERE chatgptOutput != '' LIMIT 1;"
```

Expected: ได้ cuid หนึ่งตัว จดไว้ใช้เป็น `ENTRY_ID` ในทุก task ถัดไป

> ถ้าคำสั่งนี้ไม่คืนค่า ให้ใช้ `SELECT id FROM PromptEntry LIMIT 1;` แทน — จะได้ entry ที่ยังไม่มี prompt ซึ่งยังใช้ถ่ายภาพได้ แค่แท็บ ② จะถูก disable

- [ ] **Step 5: รัน dev server แยกแล้วถ่าย baseline**

```bash
cd "C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt"
NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001 &
# รอจน server ตอบ 200 แล้วค่อยยิง (อย่า sleep แบบเดา)
until curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/ | grep -q 200; do :; done

SCRATCH="C:/Users/patip/AppData/Local/Temp/claude/C--Users-patip-Desktop-playground-tts-assistant-pooling-pooling-prompt/aca2ec64-8550-488c-b8cb-003298a3e965/scratchpad"
PW_ROOT="$SCRATCH/pw" ENTRY_ID="<cuid จาก Step 4>" \
  node scripts/shot.mjs "$SCRATCH/shots/baseline"
```

Expected: ได้ไฟล์ `.png` ครบทุกหน้า × 3 ความกว้าง

> **ผลลัพธ์ที่คาดไว้และไม่ใช่ความผิดพลาด:** script จะรายงาน `OVERFLOW` ที่ 390px ในบางหน้า — นั่นคือปัญหาที่แผนนี้มีไว้แก้ **จดไว้ว่าหน้าไหนล้นเท่าไหร่** แล้วใช้เป็นเกณฑ์วัดตอนจบ ที่ 1440px ต้องไม่มี `OVERFLOW` เลย ถ้ามีแปลว่าโค้ดเดิมมีปัญหาอยู่ก่อนแล้ว ให้รายงานผู้ใช้ก่อนไปต่อ

- [ ] **Step 6: เช็ก tsconfig แล้ว commit**

```bash
cd "C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt"
git diff --quiet tsconfig.json || git checkout -- tsconfig.json
git add scripts/shot.mjs
git commit -m "Add responsive screenshot harness for 390/820/1440px checks"
```

---

## Task 2: `lib/clipboard.ts` — ปุ่มคัดลอกต้องไม่ตายเงียบ

`navigator.clipboard` ทำงานเฉพาะ secure context การเปิดจากมือถือผ่าน LAN คือ HTTP ธรรมดา ปุ่มคัดลอกทั้ง 3 จุดจึงตายเงียบ — และนี่คือหัวใจของ workflow (คัดลอก prompt ไป Google Flow)

**Files:**
- Create: `lib/clipboard.ts`
- Create: `scripts/check-clipboard.mjs`
- Modify: `components/entry-workspace.tsx:203-207` (`handleCopy`)
- Modify: `components/production-panel.tsx:72-83` (`copyForPost`, `copyPrompt`)

**Interfaces:**
- Consumes: ไม่มี
- Produces:
  - `type CopyOutcome = "clipboard-api" | "exec-command" | "manual"`
  - `type ClipboardDeps = { writeToClipboard: ((text: string) => Promise<void>) | null; execCopy: ((text: string) => boolean) | null }`
  - `copyText(text: string, deps: ClipboardDeps): Promise<CopyOutcome>`
  - `browserClipboardDeps(): ClipboardDeps`
  - `copyInBrowser(text: string): Promise<CopyOutcome>`

- [ ] **Step 1: เขียนไฟล์ทดสอบก่อน (ยังไม่มีโค้ดให้ทดสอบ)**

สร้าง `scripts/check-clipboard.mjs`:

```js
/**
 * ตรวจ lib/clipboard.ts — ตรรกะเลือกทางคัดลอก 3 ชั้น
 *
 * แพตเทิร์นเดียวกับ scripts/check-date-filter-label.mjs: ไฟล์เป้าหมายไม่ import
 * อะไรเลย จึงคอมไพล์เดี่ยวด้วย tsc ไปยัง temp dir แล้ว dynamic import ได้
 * โดยไม่ต้องพึ่ง path alias
 *
 * รัน: node scripts/check-clipboard.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const sourceFile = join(repoRoot, "lib", "clipboard.ts");
const outDir = mkdtempSync(join(tmpdir(), "check-clipboard-"));

let failures = 0;
function check(label, actual, expected) {
  if (actual !== expected) {
    console.error(`FAIL ${label}: ได้ ${actual} ควรเป็น ${expected}`);
    failures += 1;
  } else {
    console.log(`ok   ${label}`);
  }
}

try {
  const tscBin = join(
    repoRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "tsc.cmd" : "tsc"
  );
  execFileSync(
    tscBin,
    [sourceFile, "--outDir", outDir, "--module", "commonjs", "--target", "ES2017"],
    { cwd: repoRoot, stdio: "inherit", shell: process.platform === "win32" }
  );

  const { copyText } = await import(pathToFileURL(join(outDir, "clipboard.js")).href);

  // 1. Clipboard API ใช้ได้ → ต้องใช้ทางนั้นและไม่แตะทางสำรอง
  let execCalled = false;
  check(
    "clipboard api สำเร็จ",
    await copyText("hello", {
      writeToClipboard: async () => {},
      execCopy: () => {
        execCalled = true;
        return true;
      },
    }),
    "clipboard-api"
  );
  check("clipboard api สำเร็จแล้วไม่เรียก execCopy", execCalled, false);

  // 2. Clipboard API โยน error (กรณี HTTP จริง) → ตกไปใช้ execCommand
  check(
    "clipboard api พังแล้วตกไป execCommand",
    await copyText("hello", {
      writeToClipboard: async () => {
        throw new Error("NotAllowedError");
      },
      execCopy: () => true,
    }),
    "exec-command"
  );

  // 3. ไม่มี Clipboard API เลย (navigator.clipboard เป็น undefined) → execCommand
  check(
    "ไม่มี clipboard api เลย",
    await copyText("hello", { writeToClipboard: null, execCopy: () => true }),
    "exec-command"
  );

  // 4. execCommand คืน false → ต้องบอกว่า manual ไม่ใช่แกล้งว่าสำเร็จ
  check(
    "execCommand คืน false",
    await copyText("hello", { writeToClipboard: null, execCopy: () => false }),
    "manual"
  );

  // 5. execCommand โยน error → ต้องไม่ throw ออกมา ต้องคืน manual
  check(
    "execCommand โยน error",
    await copyText("hello", {
      writeToClipboard: null,
      execCopy: () => {
        throw new Error("boom");
      },
    }),
    "manual"
  );

  // 6. ไม่มีทางไหนเลย
  check(
    "ไม่มีทางไหนใช้ได้",
    await copyText("hello", { writeToClipboard: null, execCopy: null }),
    "manual"
  );

  // 7. ข้อความว่างต้องไม่ทำให้พัง
  check(
    "ข้อความว่าง",
    await copyText("", { writeToClipboard: async () => {}, execCopy: null }),
    "clipboard-api"
  );
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} เคสไม่ผ่าน`);
  process.exit(1);
}
console.log("\nผ่านทั้งหมด");
```

- [ ] **Step 2: รันให้เห็นว่าล้มเหลว**

```bash
cd "C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt"
node scripts/check-clipboard.mjs
```

Expected: FAIL — `tsc` บอกว่าหาไฟล์ `lib/clipboard.ts` ไม่เจอ

- [ ] **Step 3: เขียน `lib/clipboard.ts`**

```ts
/**
 * คัดลอกข้อความแบบมีทางสำรอง
 *
 * navigator.clipboard ทำงานเฉพาะ secure context (HTTPS หรือ localhost) — การเปิดแอป
 * จากมือถือผ่าน LAN คือ http://192.168.x.x:3000 ซึ่งไม่ใช่ ปุ่มคัดลอกจึงตายเงียบ
 * ทั้งที่เป็นหัวใจของ workflow (คัดลอก 10-part prompt ไป Google Flow)
 *
 * แยก deps ออกมาเป็นพารามิเตอร์เพื่อให้ scripts/check-clipboard.mjs ทดสอบตรรกะ
 * การเลือกทางได้ในสภาพแวดล้อม node ที่ไม่มี DOM
 */

/** ทางที่ใช้คัดลอกจริง — "manual" แปลว่าคัดลอกให้ไม่ได้ ต้องให้ผู้ใช้ทำเอง */
export type CopyOutcome = "clipboard-api" | "exec-command" | "manual";

export type ClipboardDeps = {
  /** null เมื่อเบราว์เซอร์ไม่มี navigator.clipboard เลย (non-secure context) */
  writeToClipboard: ((text: string) => Promise<void>) | null;
  /** null เมื่อไม่มี document ให้ใช้ (เช่นตอนทดสอบใน node) */
  execCopy: ((text: string) => boolean) | null;
};

export async function copyText(text: string, deps: ClipboardDeps): Promise<CopyOutcome> {
  if (deps.writeToClipboard !== null) {
    try {
      await deps.writeToClipboard(text);
      return "clipboard-api";
    } catch {
      // ตกลงไปใช้ทางสำรอง — เคสนี้เกิดจริงเมื่อ origin ไม่ใช่ secure context
    }
  }

  if (deps.execCopy !== null) {
    try {
      if (deps.execCopy(text)) {
        return "exec-command";
      }
    } catch {
      // execCommand ถูกถอดออกในเบราว์เซอร์ใหม่บางตัว — ตกไปทางสุดท้าย
    }
  }

  return "manual";
}

export function browserClipboardDeps(): ClipboardDeps {
  const canUseClipboardApi =
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard !== "undefined" &&
    typeof navigator.clipboard.writeText === "function";

  const canUseExecCommand =
    typeof document !== "undefined" && typeof document.execCommand === "function";

  return {
    writeToClipboard: canUseClipboardApi
      ? (text: string) => navigator.clipboard.writeText(text)
      : null,
    execCopy: canUseExecCommand
      ? (text: string) => {
          // textarea (ไม่ใช่ input) เพราะข้อความมีหลายบรรทัด
          const area = document.createElement("textarea");
          area.value = text;
          // ต้องอยู่ใน DOM จริงถึงจะ select ได้ แต่ต้องไม่เลื่อนหน้าจอ
          area.setAttribute("readonly", "");
          area.style.position = "fixed";
          area.style.top = "0";
          area.style.left = "0";
          area.style.opacity = "0";
          document.body.appendChild(area);
          try {
            area.select();
            area.setSelectionRange(0, text.length);
            return document.execCommand("copy");
          } finally {
            document.body.removeChild(area);
          }
        }
      : null,
  };
}

/** ทางลัดสำหรับ client component — ประกอบ deps จากเบราว์เซอร์ให้เอง */
export function copyInBrowser(text: string): Promise<CopyOutcome> {
  return copyText(text, browserClipboardDeps());
}
```

- [ ] **Step 4: รันให้ผ่าน**

```bash
cd "C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt"
node scripts/check-clipboard.mjs
```

Expected: `ok` ครบ 8 บรรทัด แล้วปิดท้ายด้วย `ผ่านทั้งหมด`

- [ ] **Step 5: ต่อสาย `entry-workspace.tsx`**

เพิ่ม import ที่ต้นไฟล์ (ใกล้ import อื่นจาก `@/lib`):

```ts
import { copyInBrowser } from "@/lib/clipboard";
```

เพิ่ม state ใกล้ `const [copied, setCopied] = useState(false);` (บรรทัด 92):

```ts
const [copyFailed, setCopyFailed] = useState(false);
```

แทนที่ `handleCopy` (บรรทัด 203-207) ทั้งฟังก์ชัน:

```tsx
  async function handleCopy() {
    const outcome = await copyInBrowser(output);
    if (outcome === "manual") {
      // คัดลอกให้ไม่ได้จริง ๆ — ต้องบอก ไม่ใช่แกล้งว่าสำเร็จเหมือนเดิม
      setCopyFailed(true);
      setTimeout(() => setCopyFailed(false), 6000);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
```

เพิ่มแถบแจ้งเตือนใต้ `{genError && (...)}` (หลังบรรทัด 243):

```tsx
      {copyFailed && (
        <p className="mx-4 mt-3 rounded-md border border-border bg-muted px-3 py-2 text-sm leading-relaxed text-foreground sm:mx-6">
          เบราว์เซอร์นี้คัดลอกให้อัตโนมัติไม่ได้ (เปิดผ่าน HTTP) — กดค้างที่กล่องข้อความแล้วเลือก
          &quot;เลือกทั้งหมด&quot; เพื่อคัดลอกเอง
        </p>
      )}
```

- [ ] **Step 6: ต่อสาย `production-panel.tsx`**

เพิ่ม import:

```ts
import { copyInBrowser } from "@/lib/clipboard";
```

เพิ่ม state ใกล้ state `copied`/`promptCopied` เดิม:

```ts
const [copyFailed, setCopyFailed] = useState(false);
```

แทนที่ทั้งสองฟังก์ชัน (บรรทัด 72-83):

```tsx
  async function copyForPost() {
    // ผู้ใช้โพสต์แบบ caption แล้วขึ้นบรรทัดใหม่ตบด้วย hashtag — คัดลอกให้ตรงแบบนั้นเลย
    const outcome = await copyInBrowser(`${caption}\n${hashtags}`.trim());
    if (outcome === "manual") {
      setCopyFailed(true);
      setTimeout(() => setCopyFailed(false), 6000);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function copyPrompt() {
    const outcome = await copyInBrowser(chatgptOutput);
    if (outcome === "manual") {
      setCopyFailed(true);
      setTimeout(() => setCopyFailed(false), 6000);
      return;
    }
    setPromptCopied(true);
    setTimeout(() => setPromptCopied(false), 1500);
  }
```

เพิ่มแถบแจ้งเตือนใต้หัวข้อ `Production · ผลลัพธ์ & คลิป` (หลัง `</div>` ที่ปิดบล็อกบรรทัด 95-100):

```tsx
      {copyFailed && (
        <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm leading-relaxed text-foreground">
          เบราว์เซอร์นี้คัดลอกให้อัตโนมัติไม่ได้ (เปิดผ่าน HTTP) — กดค้างที่กล่องข้อความแล้วเลือก
          &quot;เลือกทั้งหมด&quot; เพื่อคัดลอกเอง
        </p>
      )}
```

- [ ] **Step 7: ตรวจ type และ lint**

```bash
cd "C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt"
npx tsc --noEmit && npm run lint
```

Expected: ทั้งคู่ผ่าน ไม่มี error

- [ ] **Step 8: Commit**

```bash
cd "C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt"
git diff --quiet tsconfig.json || git checkout -- tsconfig.json
git add lib/clipboard.ts scripts/check-clipboard.mjs components/entry-workspace.tsx components/production-panel.tsx
git commit -m "Fall back and report failure when the clipboard API is unavailable

Opening the app from a phone over LAN is a plain-HTTP origin, where
navigator.clipboard does not exist. All three copy buttons silently did
nothing there while still showing the success state."
```

---

## Task 3: หน่วย viewport, safe area และ `dvh`

`vh` บนมือถือคิดรวมแถบ URL ที่ยุบเข้าออก ทำให้เนื้อหาโดนตัด และหน้าเว็บยังไม่ได้บอกเบราว์เซอร์เรื่อง `viewport-fit` สำหรับรอยบากไอโฟน

**Files:**
- Modify: `app/layout.tsx` (เพิ่ม `viewport` export, `dvh` บน `body`)
- Modify: `components/entry-workspace.tsx:230` (`min-h-screen` → `min-h-dvh`, `lg:h-screen` → `lg:h-dvh`)
- Modify: `app/globals.css` (utility สำหรับ safe area)

**Interfaces:**
- Consumes: ไม่มี
- Produces: คลาส `pb-safe` ใช้ได้ทั่วแอป

- [ ] **Step 1: เพิ่ม `viewport` export ใน `app/layout.tsx`**

เพิ่ม `Viewport` เข้าไปใน import type บรรทัด 1:

```ts
import type { Metadata, Viewport } from "next";
```

เพิ่มบล็อกนี้ใต้ `export const metadata` (หลังบรรทัด 25):

```ts
/**
 * ยืนยันตาม node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-viewport.md
 * และ node_modules/next/dist/lib/metadata/types/extra-types.d.ts (viewportFit, interactiveWidget)
 *
 * ห้ามใส่ maximumScale/userScalable เพื่อปิดการซูม — เป็นปัญหา accessibility
 * viewportFit: "cover" ทำให้เนื้อหากินพื้นที่ใต้รอยบากได้ จึงต้องคู่กับ padding
 * safe-area ใน globals.css ไม่งั้นปุ่มล่างสุดจะถูกแถบ home indicator ทับ
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // แป้นพิมพ์มือถือย่อ visual viewport แทนที่จะดันเลย์เอาต์ — กันฟอร์มกระโดด
  interactiveWidget: "resizes-visual",
};
```

แก้ `<body>` (บรรทัด 48) — `min-h-full` พึ่ง `h-full` ของ `<html>` ซึ่งพึ่ง `vh`:

```tsx
      <body className="flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden">
```

> **ห้ามลืม:** `lg:overflow-hidden` ต้องอยู่ครบ — CLAUDE.md อธิบายว่า flex child ที่มี `flex-1` จะดันความสูงของ ancestor ที่มีแค่ `min-height` ให้ยืดเกิน viewport ถ้าถอดออกจะพังทั้งเลย์เอาต์เดสก์ท็อป

- [ ] **Step 2: เพิ่ม utility safe-area ใน `app/globals.css`**

เพิ่มต่อท้ายไฟล์:

```css
/* viewportFit: "cover" ใน app/layout.tsx ทำให้เนื้อหากินพื้นที่ใต้ home indicator
   ของไอโฟนได้ — ปุ่มหรือแถบที่อยู่ล่างสุดจึงต้องเว้นระยะคืนด้วยตัวเอง */
@utility pb-safe {
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
```

- [ ] **Step 3: แก้ `entry-workspace.tsx` บรรทัด 230**

```tsx
    <div className="flex min-h-dvh flex-1 flex-col lg:h-dvh lg:overflow-hidden">
```

- [ ] **Step 4: ตรวจว่าไม่มี `screen` หลงเหลือ**

```bash
cd "C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt"
grep -rn -E 'h-screen|min-h-screen|max-h-screen|h-\[100vh\]' app components
```

Expected: ไม่มีผลลัพธ์ ถ้ามีให้แก้ให้หมดก่อนไปต่อ

- [ ] **Step 5: ตรวจ type, lint และ contrast**

```bash
cd "C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt"
npx tsc --noEmit && npm run lint && node scripts/check-contrast.mjs
```

Expected: ผ่านทั้งสาม (`check-contrast` รันเพราะแตะ `globals.css` แม้จะไม่ได้แตะสี)

- [ ] **Step 6: ถ่าย screenshot เทียบกับ baseline**

```bash
SCRATCH="C:/Users/patip/AppData/Local/Temp/claude/C--Users-patip-Desktop-playground-tts-assistant-pooling-pooling-prompt/aca2ec64-8550-488c-b8cb-003298a3e965/scratchpad"
PW_ROOT="$SCRATCH/pw" ENTRY_ID="<cuid>" node scripts/shot.mjs "$SCRATCH/shots/task3"
```

Expected: ที่ 1440px ต้องไม่มี `OVERFLOW` และภาพต้องเหมือน baseline — เปิดดูเทียบด้วยตาอย่างน้อย `list-1440.png` และ `entry-1440.png`

- [ ] **Step 7: Commit**

```bash
cd "C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt"
git diff --quiet tsconfig.json || git checkout -- tsconfig.json
git add app/layout.tsx app/globals.css components/entry-workspace.tsx
git commit -m "Use dynamic viewport units and declare a mobile viewport

vh includes the collapsing browser chrome on mobile, so full-height
regions were clipped. Also declares viewport-fit=cover with a matching
safe-area utility, and leaves zoom enabled."
```

---

## Task 4: เป้าสัมผัส 44px ทั่วทั้งแอปด้วยการแก้ไฟล์เดียว

ปุ่มทุกตัวในแอปมาจาก `buttonVariants` ไฟล์เดียว การแก้ที่ต้นทางจึงครอบคลุมทุก call site โดยไม่ต้องไล่แก้ทีละคอมโพเนนต์

**Files:**
- Modify: `components/ui/button.tsx:23-35` (บล็อก `size`)

**Interfaces:**
- Consumes: ไม่มี
- Produces: `buttonVariants` ทุก size ให้ความสูง ≥44px ที่ต่ำกว่า `lg:` และคงค่าเดิมที่ `lg:` ขึ้นไป

- [ ] **Step 1: แทนที่บล็อก `size` ทั้งบล็อก**

```ts
      size: {
        // ความสูงคู่กันเสมอ: ตัวแรกคือเป้าสัมผัส 44px ตัวหลัง lg: คือค่าเดิมสำหรับเมาส์
        // แก้ที่นี่ที่เดียวครอบคลุมทุกปุ่มในแอป — อย่าไปไล่ใส่ h-11 ทีละ call site
        default:
          "h-11 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5 lg:h-9",
        xs: "h-11 gap-1 rounded-[min(var(--radius-md),10px)] px-2.5 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 lg:h-8 [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-11 gap-1 rounded-[min(var(--radius-md),12px)] px-3 text-sm in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 lg:h-8 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-11 gap-1.5 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3 lg:h-10",
        icon: "size-11 lg:size-9",
        "icon-xs":
          "size-11 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg lg:size-8 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm":
          "size-11 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg lg:size-8",
        "icon-lg": "size-11 lg:size-10",
      },
```

- [ ] **Step 2: หาปุ่มที่ไม่ได้ใช้ `buttonVariants` (ต้องแก้มือ)**

```bash
cd "C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt"
grep -rn -E '<button|<Link' components app --include=*.tsx | grep -E 'h-9|h-8' 
```

Expected: เจอในไฟล์เหล่านี้ (ทุกอันคือปุ่มที่เขียน `h-9` เอง ไม่ผ่าน `buttonVariants`) — แก้ `h-9` เป็น `h-11 lg:h-9` ทุกจุด:
- `components/app-header.tsx:61` (ลิงก์เมนูหลัก)
- `components/workspace-tabs.tsx:38` (แท็บ)
- `components/entry-header.tsx:19` (ลิงก์ "กลับไปรายการ")
- `components/entry-filters.tsx:176, 209, 224, 239, 293, 310` (ชิปกรองสถานะ, ช่วงวันที่, ฐานวันที่)

> ถ้า grep เจอไฟล์นอกรายการนี้ ให้แก้ด้วยแบบเดียวกัน รายการข้างบนคือสิ่งที่พบตอนเขียนแผน ไม่ใช่รายการปิด

- [ ] **Step 3: ตรวจว่าไม่มี `h-9`/`h-8` ที่กดได้หลงเหลือ**

```bash
cd "C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt"
grep -rn -E 'h-(8|9)\b' components app --include=*.tsx | grep -v 'lg:h-' | grep -v 'components/ui/button.tsx'
```

Expected: เหลือเฉพาะ element ที่ไม่ใช่เป้าคลิก (เช่นกล่องแสดงผล) — ตรวจทีละบรรทัดว่ากดได้หรือไม่ ถ้ากดได้ต้องแก้

- [ ] **Step 4: ตรวจ type และ lint**

```bash
cd "C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt"
npx tsc --noEmit && npm run lint
```

Expected: ผ่านทั้งคู่

- [ ] **Step 5: ถ่าย screenshot — ตรวจสองเรื่องพร้อมกัน**

```bash
SCRATCH="C:/Users/patip/AppData/Local/Temp/claude/C--Users-patip-Desktop-playground-tts-assistant-pooling-pooling-prompt/aca2ec64-8550-488c-b8cb-003298a3e965/scratchpad"
PW_ROOT="$SCRATCH/pw" ENTRY_ID="<cuid>" node scripts/shot.mjs "$SCRATCH/shots/task4"
```

Expected:
1. ที่ **1440px** ภาพต้องเหมือน baseline เป๊ะ (ปุ่มยังสูง 36px) — นี่คือจุดที่พลาดง่ายที่สุดใน task นี้ ถ้าปุ่มโตขึ้นที่ 1440px แปลว่าลืมใส่ `lg:` ที่ไหนสักแห่ง
2. ที่ **390px** ปุ่มโตขึ้นชัดเจน และแถวที่มีปุ่มหลายตัวต้องยัง `flex-wrap` ได้ไม่ล้น (script จะจับ `OVERFLOW` ให้)

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt"
git diff --quiet tsconfig.json || git checkout -- tsconfig.json
git add components/ui/button.tsx components/app-header.tsx components/workspace-tabs.tsx components/entry-header.tsx components/entry-filters.tsx
git commit -m "Raise touch targets to 44px below lg, keep 36px for mouse

The 36px minimum was sized for a cursor. Changing the size variants in
buttonVariants covers every button in the app from one place; the few
hand-rolled h-9 controls are updated alongside."
```

---

## Task 5: `history-rail.tsx` → ลิ้นชักที่ต่ำกว่า `lg:` และเมนู ⋮ ที่เห็นบนสัมผัส

สองปัญหาในไฟล์เดียวกัน: บรรทัด 53 `w-full ... lg:w-60` ทำให้แถบข้างกลายเป็นบล็อกเต็มความกว้างวาง**เหนือ**ฟอร์ม (ต้องเลื่อนผ่าน 15 รายการก่อนถึงช่องกรอกบรีฟ) และบรรทัด 112 ใช้ `group-hover` ซึ่งจอสัมผัสไม่มี ทำให้เมนูทำซ้ำ/ลบหายไปทั้งหมด

**Files:**
- Modify: `components/history-rail.tsx` (แยกเนื้อในออกมา + เพิ่ม drawer + แก้ ⋮)
- Modify: `components/workspace-tabs.tsx:23` (ถอด margin ของตัวเองออก ให้ตัวห่อคุมแทน)
- Modify: `components/entry-workspace.tsx:231-251`

**Interfaces:**
- Consumes: `EntryRow` จาก `@/lib/entry-rows` (มีอยู่แล้ว)
- Produces:
  - `HistoryRail({ rows, selectedId, onDuplicate, onDelete })` — `<aside>` เดิม แต่ `hidden lg:flex`
  - `HistoryRailDrawer({ rows, selectedId, onDuplicate, onDelete })` — ปุ่ม + ลิ้นชัก `lg:hidden`

- [ ] **Step 1: แก้ `components/history-rail.tsx`**

เพิ่ม import ที่ต้นไฟล์:

```ts
import { Drawer } from "@base-ui/react/drawer";
import { Copy, EllipsisVertical, PanelLeft, Plus, Trash2 } from "lucide-react";
```

(บรรทัด 4 เดิมคือ `import { Copy, EllipsisVertical, Plus, Trash2 } from "lucide-react";` — เพิ่ม `PanelLeft` เข้าไป)

ประกาศ type ร่วมใต้ helper วันที่:

```ts
type RailProps = {
  rows: EntryRow[];
  selectedId: string | null;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
};
```

แยกเนื้อในออกมาเป็นคอมโพเนนต์ของตัวเอง — เนื้อหาเหมือนของเดิมทุกบรรทัด เปลี่ยนแค่บรรทัด `className` ของ `Menu.Trigger`:

```tsx
/**
 * เนื้อในของแถบประวัติ ใช้ร่วมกันทั้งฝั่ง sidebar (เดสก์ท็อป) และฝั่งลิ้นชัก (สัมผัส)
 *
 * onNavigate ให้ฝั่งลิ้นชักปิดตัวเองหลังผู้ใช้เลือกรายการ — ฝั่ง sidebar ส่ง undefined
 */
function RailBody({
  rows,
  selectedId,
  onDuplicate,
  onDelete,
  onNavigate,
}: RailProps & { onNavigate?: () => void }) {
  return (
    <>
      <Link
        href="/entry/new"
        onClick={onNavigate}
        className={cn(buttonVariants(), "w-full shadow-none")}
      >
        <Plus className="size-4" />
        สินค้าใหม่
      </Link>

      <p className="px-1 text-xs text-header-muted">ล่าสุด</p>

      <div className="flex flex-1 flex-col gap-1 overflow-y-auto">
        <ul className="flex flex-col gap-1">
          {rows.map((row) => {
            const isActive = selectedId === row.id;
            const date = shortDate(row.postedAt);
            return (
              <li
                key={row.id}
                className={cn(
                  "group flex items-center rounded-md border-l-2 border-transparent text-sm text-header-muted transition-colors hover:bg-header-foreground/10 hover:text-header-foreground",
                  isActive && "border-header-active bg-header-foreground/10 text-header-foreground"
                )}
              >
                <Link
                  href={`/entry/${row.id}`}
                  onClick={onNavigate}
                  className="flex min-w-0 flex-1 items-start gap-2 py-2 pl-2.5 text-left"
                >
                  {row.thumbnailFilename ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/uploads/${row.id}/${row.thumbnailFilename}`}
                      alt=""
                      loading="lazy"
                      className="size-9 shrink-0 rounded border border-header-foreground/10 object-cover"
                    />
                  ) : (
                    <span className="size-9 shrink-0 rounded border border-dashed border-header-foreground/10" />
                  )}

                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="line-clamp-2 text-sm leading-tight font-semibold">
                      {row.productName}
                    </span>
                    <span className="flex items-center gap-1.5 text-xs">
                      {date ? (
                        <span className="font-mono text-header-muted">{date}</span>
                      ) : (
                        <span className="text-header-muted">
                          สร้าง <span className="font-mono">{shortCreatedDate(row.createdAt)}</span>
                        </span>
                      )}
                    </span>
                  </span>
                </Link>

                <Menu.Root>
                  {/* จอสัมผัสไม่มี hover — ต่ำกว่า lg: จึงต้องเห็นตลอด ไม่งั้นทำซ้ำ/ลบหายไปทั้งหมด */}
                  <Menu.Trigger
                    aria-label="เมนูรายการ"
                    className="flex size-11 shrink-0 items-center justify-center rounded-md text-header-muted opacity-100 transition-opacity hover:text-header-foreground focus-visible:opacity-100 data-[popup-open]:opacity-100 lg:size-auto lg:px-1.5 lg:py-2 lg:opacity-0 lg:group-hover:opacity-100"
                  >
                    <EllipsisVertical className="size-3.5" />
                  </Menu.Trigger>
                  <Menu.Portal>
                    <Menu.Positioner side="bottom" align="end" sideOffset={4} className="z-50">
                      <Menu.Popup className="min-w-32 rounded-md border border-border bg-popover py-1 text-sm text-popover-foreground shadow-lg">
                        <Menu.Item
                          onClick={() => onDuplicate(row.id)}
                          className="flex cursor-pointer items-center gap-2 px-3 py-2.5 outline-none data-[highlighted]:bg-muted lg:py-1.5"
                        >
                          <Copy className="size-3.5" />
                          ทำซ้ำ
                        </Menu.Item>
                        <Menu.Item
                          onClick={() => onDelete(row.id)}
                          className="flex cursor-pointer items-center gap-2 px-3 py-2.5 text-destructive outline-none data-[highlighted]:bg-muted lg:py-1.5"
                        >
                          <Trash2 className="size-3.5" />
                          ลบ
                        </Menu.Item>
                      </Menu.Popup>
                    </Menu.Positioner>
                  </Menu.Portal>
                </Menu.Root>
              </li>
            );
          })}
        </ul>

        <Link
          href="/"
          onClick={onNavigate}
          className="mt-1 rounded-md px-2.5 py-2 text-center text-xs text-header-muted transition-colors hover:bg-header-foreground/10 hover:text-header-foreground"
        >
          ดูทั้งหมด
        </Link>
      </div>
    </>
  );
}
```

แทนที่ `export function HistoryRail` เดิมทั้งฟังก์ชันด้วยสองตัวนี้:

```tsx
/**
 * แถบข้างของหน้าทำงาน — โชว์เฉพาะรายการล่าสุดเพื่อสลับงานเร็วๆ
 *
 * การค้นหา ตัวกรอง และการจัดกลุ่มย้ายไปหน้ารายการ (/) ทั้งหมดแล้ว เพราะกว้าง 240px
 * ใส่ได้แค่ชื่อกับวันที่ ไม่มีที่ให้ตัวกรองหรือคอลัมน์สถานะ
 *
 * ต่ำกว่า lg: ตัวนี้ถูกซ่อนและใช้ HistoryRailDrawer แทน — ของเดิมเป็น w-full ซึ่งกลายเป็น
 * บล็อกเต็มความกว้างวางเหนือฟอร์ม ทำให้บนมือถือต้องเลื่อนผ่าน 15 รายการก่อนถึงช่องกรอก
 */
export function HistoryRail({ rows, selectedId, onDuplicate, onDelete }: RailProps) {
  return (
    <aside className="hidden shrink-0 flex-col gap-3 overflow-hidden bg-header px-3 py-4 text-header-foreground lg:flex lg:h-full lg:w-60">
      <RailBody
        rows={rows}
        selectedId={selectedId}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
      />
    </aside>
  );
}

/**
 * แถบเดียวกันในรูปลิ้นชักสำหรับจอสัมผัส
 *
 * ใช้ Drawer ของ Base UI ซึ่งมี swipe-to-dismiss และ virtual keyboard handling มาให้
 * โครงสร้าง part อ้างอิงจาก node_modules/@base-ui/react/docs/react/components/drawer.md
 * (ตัวอย่างในเอกสารเป็นลิ้นชักฝั่งขวา — ตัวนี้กลับด้านเป็นซ้ายให้ตรงกับตำแหน่ง sidebar เดิม)
 */
export function HistoryRailDrawer({ rows, selectedId, onDuplicate, onDelete }: RailProps) {
  const [open, setOpen] = useState(false);

  return (
    <Drawer.Root open={open} onOpenChange={setOpen} swipeDirection="left">
      <Drawer.Trigger
        aria-label="เปิดรายการล่าสุด"
        className="inline-flex h-11 items-center gap-1.5 rounded-md border border-header-muted/40 px-3 text-sm font-medium text-header-muted transition-colors hover:bg-header-foreground/10 hover:text-header-foreground focus-visible:ring-2 focus-visible:ring-header-active focus-visible:outline-none lg:hidden"
      >
        <PanelLeft className="size-4" />
        ล่าสุด
      </Drawer.Trigger>

      <Drawer.Portal>
        <Drawer.Backdrop className="fixed inset-0 z-40 min-h-dvh bg-black/50 opacity-[calc(1-var(--drawer-swipe-progress))] transition-opacity duration-300 data-ending-style:opacity-0 data-starting-style:opacity-0 data-swiping:duration-0" />
        <Drawer.Viewport className="fixed inset-0 z-50 flex items-stretch justify-start">
          <Drawer.Popup className="flex h-full w-72 max-w-[85vw] flex-col gap-3 overflow-y-auto overscroll-contain border-r border-header-muted/40 bg-header px-3 py-4 text-header-foreground outline-none [transform:translateX(var(--drawer-swipe-movement-x))] transition-transform duration-300 ease-out data-ending-style:[transform:translateX(-100%)] data-starting-style:[transform:translateX(-100%)]">
            <Drawer.Title className="px-1 text-sm font-semibold text-header-foreground">
              รายการล่าสุด
            </Drawer.Title>
            <Drawer.Description className="sr-only">
              เลือกสินค้าเพื่อสลับไปทำงานชิ้นนั้น
            </Drawer.Description>
            <Drawer.Content className="flex min-h-0 flex-1 flex-col gap-3">
              <RailBody
                rows={rows}
                selectedId={selectedId}
                onDuplicate={onDuplicate}
                onDelete={onDelete}
                onNavigate={() => setOpen(false)}
              />
            </Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
```

เพิ่ม `useState` เข้า import React ที่ต้นไฟล์:

```ts
import { useState } from "react";
```

- [ ] **Step 2: ถอด margin ของ `workspace-tabs.tsx` ออก**

บรรทัด 23 เดิมเป็น `"mx-4 mb-3 inline-flex flex-wrap gap-1 rounded-lg border border-header-muted/40 p-1 sm:mx-6"` เปลี่ยนเป็น:

```tsx
      className="inline-flex flex-wrap gap-1 rounded-lg border border-header-muted/40 p-1"
```

> margin ย้ายไปอยู่บนตัวห่อใน `entry-workspace.tsx` แทน เพราะตอนนี้แท็บต้องอยู่แถวเดียวกับปุ่มเปิดลิ้นชัก ถ้าปล่อยให้ทั้งคู่มี margin ของตัวเองจะได้ระยะซ้อนกัน — `WorkspaceTabs` ถูกใช้ที่เดียวคือ `entry-workspace.tsx` จึงปลอดภัย

- [ ] **Step 3: ต่อสายใน `entry-workspace.tsx`**

แก้ import บรรทัด 18:

```ts
import { HistoryRail, HistoryRailDrawer } from "@/components/history-rail";
```

แทนที่บล็อก `<EntryHeader>` (บรรทัด 231-237):

```tsx
      <EntryHeader productName={form.productName}>
        <div className="mx-4 mb-3 flex flex-wrap items-center gap-2 sm:mx-6">
          <HistoryRailDrawer
            rows={rows}
            selectedId={entry?.id ?? null}
            onDuplicate={handleDuplicate}
            onDelete={handleDelete}
          />
          <WorkspaceTabs
            active={tab}
            onChange={setTab}
            productionDisabled={entry === null}
          />
        </div>
      </EntryHeader>
```

`<HistoryRail>` (บรรทัด 246-251) ไม่ต้องแก้ — มันซ่อนตัวเองด้วย `hidden lg:flex` แล้ว

- [ ] **Step 4: ตรวจ type และ lint**

```bash
cd "C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt"
npx tsc --noEmit && npm run lint
```

Expected: ผ่านทั้งคู่ — ถ้า `tsc` บ่นเรื่อง prop ของ `Drawer` ให้เปิด `node_modules/@base-ui/react/drawer/root/DrawerRoot.d.ts` อ่าน prop จริง **ห้ามกลบด้วย `as any`**

- [ ] **Step 5: ทดสอบว่าลิ้นชักเปิดได้จริง**

เขียนสคริปต์ชั่วคราวที่ scratch dir (ไม่ commit) แล้วรัน:

```js
// $SCRATCH/pw/drawer-check.mjs
import { chromium } from "playwright";

const entryId = process.env.ENTRY_ID;
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 800 },
  hasTouch: true,
  isMobile: true,
});
const page = await context.newPage();
await page.goto(`http://localhost:3001/entry/${entryId}`, { waitUntil: "networkidle" });

// ก่อนเปิด: รายการต้องไม่อยู่บนหน้าจอ
const before = await page.getByText("รายการล่าสุด").count();
console.log("ก่อนกด มีหัวข้อลิ้นชักกี่อัน:", before, before === 0 ? "ok" : "FAIL");

await page.getByRole("button", { name: "เปิดรายการล่าสุด" }).tap();
await page.getByText("รายการล่าสุด").waitFor({ state: "visible", timeout: 3000 });
console.log("เปิดลิ้นชักได้ ok");

// เมนู ⋮ ต้องมองเห็นบนสัมผัส (ของเดิม opacity-0 จนกว่าจะ hover)
const kebab = page.getByRole("button", { name: "เมนูรายการ" }).first();
const opacity = await kebab.evaluate((el) => getComputedStyle(el).opacity);
console.log("opacity ของเมนู ⋮:", opacity, opacity === "1" ? "ok" : "FAIL");

await page.screenshot({ path: "drawer-open-390.png", fullPage: false });
await browser.close();
```

```bash
SCRATCH="C:/Users/patip/AppData/Local/Temp/claude/C--Users-patip-Desktop-playground-tts-assistant-pooling-pooling-prompt/aca2ec64-8550-488c-b8cb-003298a3e965/scratchpad"
cd "$SCRATCH/pw" && ENTRY_ID="<cuid>" node drawer-check.mjs
```

Expected: ทั้งสามบรรทัดลงท้ายด้วย `ok`

- [ ] **Step 6: ถ่าย screenshot ชุดเต็ม**

```bash
SCRATCH="C:/Users/patip/AppData/Local/Temp/claude/C--Users-patip-Desktop-playground-tts-assistant-pooling-pooling-prompt/aca2ec64-8550-488c-b8cb-003298a3e965/scratchpad"
PW_ROOT="$SCRATCH/pw" ENTRY_ID="<cuid>" node scripts/shot.mjs "$SCRATCH/shots/task5"
```

Expected: `entry-390.png` ต้องเห็นช่องกรอกบรีฟ**ทันทีโดยไม่ต้องเลื่อน** (ก่อนหน้านี้มีรายการ 15 อันขวางอยู่) · `entry-1440.png` ต้องเหมือน baseline

- [ ] **Step 7: Commit**

```bash
cd "C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt"
git diff --quiet tsconfig.json || git checkout -- tsconfig.json
git add components/history-rail.tsx components/workspace-tabs.tsx components/entry-workspace.tsx
git commit -m "Move the history rail into a drawer below lg and expose its menu on touch

Below lg the rail was a full-width block above the form, so reaching the
brief meant scrolling past 15 entries. Its per-row menu was also
hover-only, which makes duplicate and delete unreachable without a mouse."
```

---

## Task 6: `entry-list.tsx` → การ์ดที่ต่ำกว่า `md:`

แถวใช้ความกว้างตายตัว: รูป `size-20` (80) + สถานะ `w-32` (128) + วันที่ `w-28` (112) + gap/padding ≈ 392px **ก่อน**ที่ชื่อสินค้าจะได้พื้นที่ บนจอ 390px ชื่อสินค้าจึงเหลือศูนย์

**Files:**
- Modify: `components/entry-list.tsx:116-175`

**Interfaces:**
- Consumes: `EntryRow`, `EntryStatus` จาก `@/lib/entry-rows` (มีอยู่แล้ว)
- Produces: ไม่มี export ใหม่

- [ ] **Step 1: แทนที่บล็อกรายการทั้งบล็อก (บรรทัด 116-175)**

```tsx
        <div className="flex flex-col">
          {/* หัวคอลัมน์ไม่ใช่แถวที่กดได้ — ไม่มีการเรียงลำดับตามคอลัมน์
              การเรียงยังเป็นแบบเดิมจาก lib/entry-sort.ts (ยังไม่ลงคลิปอยู่บนสุด แล้วใหม่ไปเก่า)
              ซ่อนที่ base เพราะต่ำกว่า md: ไม่มีคอลัมน์ให้หัวแล้ว */}
          <div
            className="hidden items-center gap-4 border-b border-border px-4 pb-2 text-xs text-muted-foreground md:flex"
            aria-hidden="true"
          >
            <span className="w-20 shrink-0">รูป</span>
            <span className="flex-1">สินค้า</span>
            <span className="w-32 shrink-0">สถานะ</span>
            <span className="w-28 shrink-0 text-right">{dateColumnLabel}</span>
          </div>

          <ul className="flex flex-col gap-2 pt-2">
            {rows.map((row) => {
              const dateText =
                by === "created"
                  ? createdLabel(row.createdAt)
                  : (postedLabel(row.postedAt) ?? "-");

              return (
                <li key={row.id}>
                  <Link
                    href={`/entry/${row.id}`}
                    className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3 transition-colors hover:border-border-interactive md:gap-4"
                  >
                    {row.thumbnailFilename ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/uploads/${row.id}/${row.thumbnailFilename}`}
                        alt=""
                        loading="lazy"
                        className="size-16 shrink-0 rounded-lg border border-border object-cover md:size-20"
                      />
                    ) : (
                      <span className="size-16 shrink-0 rounded-lg border border-dashed border-border md:size-20" />
                    )}

                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <p className="truncate text-base font-bold md:text-lg">{row.productName}</p>
                      {row.angle !== "" && (
                        <p className="line-clamp-1 text-sm text-muted-foreground">
                          angle: {row.angle}
                        </p>
                      )}

                      {/* ต่ำกว่า md: สถานะกับวันที่ย้ายลงมาอยู่ใต้ชื่อแทนที่จะเป็นคอลัมน์ตายตัว
                          ที่กินความกว้าง 240px จนชื่อสินค้าไม่เหลือที่บนจอ 390px */}
                      <div className="flex flex-wrap items-center gap-2 md:hidden">
                        <Badge variant={STATUS_BADGE_VARIANT[row.status]}>
                          {STATUS_LABEL[row.status]}
                        </Badge>
                        <span className="text-xs whitespace-nowrap text-muted-foreground">
                          {dateText}
                        </span>
                      </div>
                    </div>

                    <div className="hidden w-32 shrink-0 md:block">
                      <Badge variant={STATUS_BADGE_VARIANT[row.status]}>
                        {STATUS_LABEL[row.status]}
                      </Badge>
                    </div>

                    <div className="hidden w-28 shrink-0 text-right md:block">
                      <span className="text-sm whitespace-nowrap">{dateText}</span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
```

- [ ] **Step 2: ตรวจ type และ lint**

```bash
cd "C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt"
npx tsc --noEmit && npm run lint
```

Expected: ผ่านทั้งคู่

- [ ] **Step 3: ตรวจว่าชื่อสินค้าได้ความกว้างจริงที่ 390px**

เขียนสคริปต์ชั่วคราวที่ scratch dir:

```js
// $SCRATCH/pw/list-width-check.mjs
import { chromium } from "playwright";

const browser = await chromium.launch();
let failures = 0;

for (const width of [390, 820, 1440]) {
  const context = await browser.newContext({
    viewport: { width, height: 800 },
    hasTouch: width < 1024,
    isMobile: width < 768,
  });
  const page = await context.newPage();
  await page.goto("http://localhost:3001/", { waitUntil: "networkidle" });

  const nameWidth = await page
    .locator("ul > li a p")
    .first()
    .evaluate((el) => el.getBoundingClientRect().width);

  // ชื่อสินค้าต้องได้อย่างน้อย 40% ของความกว้างจอ ไม่ใช่ถูกบีบจนเหลือศูนย์
  const min = width * 0.4;
  const ok = nameWidth >= min;
  if (!ok) failures += 1;
  console.log(
    `@${width}: ชื่อสินค้ากว้าง ${Math.round(nameWidth)}px (ต้อง >= ${Math.round(min)}px) ${ok ? "ok" : "FAIL"}`
  );

  await context.close();
}

await browser.close();
process.exit(failures > 0 ? 1 : 0);
```

```bash
SCRATCH="C:/Users/patip/AppData/Local/Temp/claude/C--Users-patip-Desktop-playground-tts-assistant-pooling-pooling-prompt/aca2ec64-8550-488c-b8cb-003298a3e965/scratchpad"
cd "$SCRATCH/pw" && node list-width-check.mjs
```

Expected: ทั้งสามความกว้างขึ้น `ok` — ถ้ารันสคริปต์นี้กับโค้ดก่อนแก้ บรรทัด `@390` จะ FAIL ซึ่งคือปัญหาที่ task นี้แก้

- [ ] **Step 4: ถ่าย screenshot**

```bash
SCRATCH="C:/Users/patip/AppData/Local/Temp/claude/C--Users-patip-Desktop-playground-tts-assistant-pooling-pooling-prompt/aca2ec64-8550-488c-b8cb-003298a3e965/scratchpad"
PW_ROOT="$SCRATCH/pw" ENTRY_ID="<cuid>" node scripts/shot.mjs "$SCRATCH/shots/task6"
```

Expected: `list-1440.png` เหมือน baseline · `list-390.png` อ่านชื่อสินค้าได้ครบ

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt"
git diff --quiet tsconfig.json || git checkout -- tsconfig.json
git add components/entry-list.tsx
git commit -m "Stack entry rows into cards below md

The fixed status and date columns consumed ~392px before the product
name got any width, leaving the name at zero on a 390px screen."
```

---

## Task 7: `next/image` — ลดหน้ารายการจาก ~13MB เหลือ ~0.4MB

`uploads/` 205 MB / 308 ไฟล์ = เฉลี่ย 665 KB ต่อรูป หน้ารายการ 20 แถวจึงโหลดราว 13 MB ทุกครั้ง บน 4G คือทั้งช้าและเปลืองเน็ตผู้ใช้เอง — `sharp` ติดตั้งอยู่แล้วแต่ยังไม่มีที่ไหนใช้ `next/image` เลย

**Files:**
- Modify: `next.config.ts` (เพิ่ม `images.localPatterns`)
- Modify: `components/entry-list.tsx` (รูปในแถว)
- Modify: `components/history-rail.tsx` (รูปใน `RailBody`)
- Modify: `components/brief-form.tsx:440-447` (รูปในแผงแก้ caption)

**Interfaces:**
- Consumes: URL รูปแบบ `/api/uploads/<entryId>/<filename>` เสิร์ฟโดย `app/api/uploads/[...path]/route.ts` (คืน `Content-Type` ถูกต้องแล้ว)
- Produces: ไม่มี export ใหม่

- [ ] **Step 1: จำกัด path ที่ optimizer ยอมย่อ**

แก้ `next.config.ts` เพิ่ม `images` เข้าไปใน `nextConfig`:

```ts
  // จำกัดให้ optimizer ย่อได้เฉพาะรูปสินค้า — ถ้าไม่ตั้ง จะยอมทุก local path ซึ่งเปิดช่อง
  // ให้ถูกใช้เป็น proxy ย่อรูปอะไรก็ได้ในเว็บ (ดู image.md หัวข้อ localPatterns)
  // URL ของเราไม่มี query string จึงตั้ง search เป็นค่าว่างได้
  images: {
    localPatterns: [{ pathname: "/api/uploads/**", search: "" }],
  },
```

- [ ] **Step 2: แก้รูปใน `entry-list.tsx`**

เพิ่ม import ที่ต้นไฟล์:

```ts
import Image from "next/image";
```

แทนที่บล็อกรูป (ที่ Task 6 เขียนไว้):

```tsx
                    {row.thumbnailFilename ? (
                      // width/height คือขนาด intrinsic ที่ขอจาก optimizer ไม่ใช่ขนาดที่แสดง
                      // 160 = 80px (md:size-20) × DPR 2 · object-cover จัดการอัตราส่วนเอง
                      <Image
                        src={`/api/uploads/${row.id}/${row.thumbnailFilename}`}
                        alt=""
                        width={160}
                        height={160}
                        className="size-16 shrink-0 rounded-lg border border-border object-cover md:size-20"
                      />
                    ) : (
                      <span className="size-16 shrink-0 rounded-lg border border-dashed border-border md:size-20" />
                    )}
```

ลบคอมเมนต์ `// eslint-disable-next-line @next/next/no-img-element` ที่อยู่เหนือบล็อกนั้นออก

- [ ] **Step 3: แก้รูปใน `history-rail.tsx` (ภายใน `RailBody`)**

เพิ่ม import:

```ts
import Image from "next/image";
```

แทนที่บล็อกรูป:

```tsx
                  {row.thumbnailFilename ? (
                    // 72 = 36px (size-9) × DPR 2
                    <Image
                      src={`/api/uploads/${row.id}/${row.thumbnailFilename}`}
                      alt=""
                      width={72}
                      height={72}
                      className="size-9 shrink-0 rounded border border-header-foreground/10 object-cover"
                    />
                  ) : (
                    <span className="size-9 shrink-0 rounded border border-dashed border-header-foreground/10" />
                  )}
```

ลบคอมเมนต์ `eslint-disable` ที่อยู่เหนือบล็อกนั้น

- [ ] **Step 4: แก้รูปใน `brief-form.tsx`**

เพิ่ม import:

```ts
import Image from "next/image";
```

แทนที่ `<img>` (บรรทัด 442-447):

```tsx
                    {/* 400 ไม่ใช่ 192 (96×2) เพราะผู้ใช้ต้องอ่านรายละเอียดสินค้าจากรูปนี้
                        เพื่อเขียน caption ย่อมากจะเห็นกลไก/ตัวหนังสือบนสินค้าไม่ชัด */}
                    <Image
                      src={`/api/uploads/${image.entryId}/${image.filename}`}
                      alt="รูปสินค้า"
                      width={400}
                      height={400}
                      className="size-24 rounded-md border border-border object-cover"
                    />
```

ลบคอมเมนต์ `eslint-disable` ที่อยู่เหนือบรรทัดนั้น

- [ ] **Step 5: ตรวจ type และ lint**

```bash
cd "C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt"
npx tsc --noEmit && npm run lint
```

Expected: ผ่านทั้งคู่ และ **ไม่มี warning `no-img-element` เหลือในสามไฟล์นี้** (ถ้ายังมีแปลว่าลืมลบ `eslint-disable` หรือลืมแก้ `<img>` สักจุด)

- [ ] **Step 6: วัดน้ำหนักหน้าจริง ก่อน/หลัง**

รีสตาร์ต dev server ก่อน (เพราะแก้ `next.config.ts`) แล้วเขียนสคริปต์ชั่วคราว:

```js
// $SCRATCH/pw/weight-check.mjs
import { chromium } from "playwright";

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 800 },
  hasTouch: true,
  isMobile: true,
});
const page = await context.newPage();

let imageBytes = 0;
page.on("response", async (res) => {
  const type = res.headers()["content-type"] || "";
  if (!type.startsWith("image/")) return;
  try {
    imageBytes += (await res.body()).length;
  } catch {
    // response ที่ถูก cache อ่าน body ไม่ได้ — ข้ามไป
  }
});

await page.goto("http://localhost:3001/", { waitUntil: "networkidle" });
// รูปเป็น lazy — ต้องเลื่อนจนสุดก่อนถึงจะโหลดครบ
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForLoadState("networkidle");

const mb = imageBytes / 1024 / 1024;
console.log(`น้ำหนักรูปรวมของหน้ารายการ @390px: ${mb.toFixed(2)} MB`);
console.log(mb < 2 ? "ok" : "FAIL — ยังหนักเกิน 2 MB");

await browser.close();
process.exit(mb < 2 ? 0 : 1);
```

```bash
SCRATCH="C:/Users/patip/AppData/Local/Temp/claude/C--Users-patip-Desktop-playground-tts-assistant-pooling-pooling-prompt/aca2ec64-8550-488c-b8cb-003298a3e965/scratchpad"
cd "$SCRATCH/pw" && node weight-check.mjs
```

Expected: `ok` — ตัวเลขควรลดจากหลัก 10 MB เหลือไม่ถึง 1 MB

> **ถ้ารูปไม่ขึ้นเลย (ได้ 0.00 MB และหน้าว่าง):** แปลว่า optimizer ดึง `/api/uploads/...` ไม่ได้ ให้เช็ก terminal ของ dev server หา error จาก `/_next/image` แล้วตรวจ `localPatterns` ใน Step 1 ว่าสะกด pathname ถูก **อย่าแก้ด้วยการใส่ `unoptimized`** — นั่นคือการยกเลิกทั้ง task

- [ ] **Step 7: ถ่าย screenshot**

```bash
SCRATCH="C:/Users/patip/AppData/Local/Temp/claude/C--Users-patip-Desktop-playground-tts-assistant-pooling-pooling-prompt/aca2ec64-8550-488c-b8cb-003298a3e965/scratchpad"
PW_ROOT="$SCRATCH/pw" ENTRY_ID="<cuid>" node scripts/shot.mjs "$SCRATCH/shots/task7"
```

Expected: รูปยังแสดงครบทุกหน้าและทุกความกว้าง ไม่มีช่องว่างแทนที่รูป

- [ ] **Step 8: Commit**

```bash
cd "C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt"
git diff --quiet tsconfig.json || git checkout -- tsconfig.json
git add next.config.ts components/entry-list.tsx components/history-rail.tsx components/brief-form.tsx
git commit -m "Serve product photos through the image optimizer

Uploads average 665KB each, so the list page shipped roughly 13MB of
full-size originals per load. sharp was already installed and no existing
image went through next/image."
```

---

## Task 8: หัวเว็บย่อขนาดบนมือถือ

หัวเว็บกิน ~140px จากจอสูง 780px คือ 18% ของหน้าจอหายไปก่อนเห็นเนื้อหา

**Files:**
- Modify: `components/app-header.tsx:31-47`
- Modify: `components/entry-header.tsx:26-48`

**Interfaces:**
- Consumes: ไม่มี
- Produces: ไม่มี export ใหม่ (signature ของทั้งสองคอมโพเนนต์ไม่เปลี่ยน)

- [ ] **Step 1: แก้ `app-header.tsx`**

แทนที่บล็อกบรรทัด 31-47:

```tsx
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
        <Link href="/" className="flex items-center gap-2.5">
          <Compass className="size-6 shrink-0 text-header-active" strokeWidth={1.75} />
          <div>
            <h1 className="text-lg leading-none font-extrabold text-header-foreground sm:text-xl lg:text-2xl">
              Angle <span className="text-sm font-normal text-header-muted">by LAGR</span>
            </h1>
            {/* คำโปรยเป็นข้อมูลเสริมล้วน — บนมือถือมันกินความสูงที่ควรเป็นของเนื้อหา */}
            <p className="mt-1 hidden text-xs leading-relaxed text-header-muted sm:block">
              ประกอบ Core Prompt สำหรับวิดีโอ TikTok Shop
            </p>
          </div>
        </Link>
        <div className="flex items-center gap-2">
          {children}
          <ThemeToggle />
        </div>
      </div>
```

แถวเมนู (บรรทัด 51-54) — ให้เลื่อนแนวนอนแทนการตัดบรรทัดบนจอแคบ:

```tsx
      <nav
        className="mx-4 mb-3 flex max-w-full gap-1 overflow-x-auto rounded-lg border border-header-muted/40 p-1 sm:mx-6 sm:inline-flex sm:flex-wrap sm:overflow-visible"
        aria-label="เมนูหลัก"
      >
```

- [ ] **Step 2: แก้ `entry-header.tsx`**

แทนที่บล็อกบรรทัด 26-48:

```tsx
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-2 pb-3 sm:px-6 sm:pb-4">
        <div className="flex items-center gap-2.5">
          <Compass className="size-6 shrink-0 text-header-active" strokeWidth={1.75} />
          <div>
            <h1 className="text-lg leading-none font-extrabold text-header-foreground sm:text-xl lg:text-2xl">
              Angle <span className="text-sm font-normal text-header-muted">by LAGR</span>
            </h1>
            <p className="mt-1 hidden text-xs leading-relaxed text-header-muted sm:block">
              ประกอบ Core Prompt สำหรับวิดีโอ TikTok Shop
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {/* ชื่อสินค้าต้องได้ความกว้างที่เหลือทั้งหมดบนจอแคบ ไม่ใช่ถูกล็อกที่ 14rem */}
          <div className="min-w-0 flex-1 rounded-lg border border-header-muted/40 bg-header-foreground/5 px-3 py-2 sm:flex-none sm:px-4">
            <p className="truncate text-sm text-header-foreground sm:max-w-[14rem]">
              {productName || "ยังไม่ตั้งชื่อสินค้า"}
            </p>
          </div>
          <SoundToggle />
          <ThemeToggle />
        </div>
      </div>
```

- [ ] **Step 3: ตรวจ type และ lint**

```bash
cd "C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt"
npx tsc --noEmit && npm run lint
```

Expected: ผ่านทั้งคู่

- [ ] **Step 4: วัดความสูงหัวเว็บจริง**

```js
// $SCRATCH/pw/header-height-check.mjs
import { chromium } from "playwright";

const browser = await chromium.launch();
let failures = 0;

for (const width of [390, 1440]) {
  const context = await browser.newContext({
    viewport: { width, height: 800 },
    hasTouch: width < 1024,
    isMobile: width < 768,
  });
  const page = await context.newPage();
  await page.goto("http://localhost:3001/", { waitUntil: "networkidle" });

  const h = await page.locator("header").first().evaluate((el) => el.getBoundingClientRect().height);
  // 390px: ต้องลดลงเหลือไม่เกิน 110px · 1440px: ต้องยังเป็นค่าเดิม (~140px)
  const limit = width === 390 ? 110 : 200;
  const ok = width === 390 ? h <= limit : h >= 120;
  if (!ok) failures += 1;
  console.log(`@${width}: หัวเว็บสูง ${Math.round(h)}px ${ok ? "ok" : "FAIL"}`);

  await context.close();
}

await browser.close();
process.exit(failures > 0 ? 1 : 0);
```

```bash
SCRATCH="C:/Users/patip/AppData/Local/Temp/claude/C--Users-patip-Desktop-playground-tts-assistant-pooling-pooling-prompt/aca2ec64-8550-488c-b8cb-003298a3e965/scratchpad"
cd "$SCRATCH/pw" && node header-height-check.mjs
```

Expected: ทั้งสองบรรทัด `ok` — บรรทัด `@1440` เป็นตัวยืนยันว่าไม่ได้ย่อหัวเว็บของเดสก์ท็อปไปด้วย

- [ ] **Step 5: ถ่าย screenshot แล้ว commit**

```bash
SCRATCH="C:/Users/patip/AppData/Local/Temp/claude/C--Users-patip-Desktop-playground-tts-assistant-pooling-pooling-prompt/aca2ec64-8550-488c-b8cb-003298a3e965/scratchpad"
PW_ROOT="$SCRATCH/pw" ENTRY_ID="<cuid>" node scripts/shot.mjs "$SCRATCH/shots/task8"

cd "C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt"
git diff --quiet tsconfig.json || git checkout -- tsconfig.json
git add components/app-header.tsx components/entry-header.tsx
git commit -m "Shrink the header on narrow screens

The header consumed 18% of a 780px viewport before any content. The
tagline is supplementary, and the product name was capped at 14rem even
when the whole row was narrower than that."
```

---

## Task 9: ประตูจบเฟส 1 — ตรวจครบแล้วส่งให้ผู้ใช้ลองจริง

**Files:** ไม่แก้ไฟล์ (task นี้คือการตรวจสอบและส่งมอบ)

**Interfaces:**
- Consumes: ทุกอย่างจาก Task 1-8
- Produces: รายงานผลให้ผู้ใช้ + checklist ที่ผู้ใช้ต้องลองเอง

- [ ] **Step 1: รันชุดตรวจอัตโนมัติทั้งหมด**

```bash
cd "C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt"
npx tsc --noEmit && npm run lint && node scripts/check-contrast.mjs && node scripts/check-clipboard.mjs && node scripts/check-date-filter-label.mjs && node scripts/check-recommender.mjs && node scripts/check-candidates.mjs
```

Expected: ผ่านทั้งหมด — สคริปต์สามตัวหลังไม่เกี่ยวกับงานนี้โดยตรง แต่รันเพื่อยืนยันว่าไม่มีอะไรพังข้างเคียง

- [ ] **Step 2: ถ่าย screenshot ชุดสุดท้ายของเฟส 1**

```bash
SCRATCH="C:/Users/patip/AppData/Local/Temp/claude/C--Users-patip-Desktop-playground-tts-assistant-pooling-pooling-prompt/aca2ec64-8550-488c-b8cb-003298a3e965/scratchpad"
PW_ROOT="$SCRATCH/pw" ENTRY_ID="<cuid>" node scripts/shot.mjs "$SCRATCH/shots/phase1-final"
```

Expected: **ไม่มี `OVERFLOW` ที่ความกว้างใดเลย** และ exit code เป็น 0

- [ ] **Step 3: เทียบ 1440px กับ baseline ทีละไฟล์**

```bash
SCRATCH="C:/Users/patip/AppData/Local/Temp/claude/C--Users-patip-Desktop-playground-tts-assistant-pooling-pooling-prompt/aca2ec64-8550-488c-b8cb-003298a3e965/scratchpad"
for f in "$SCRATCH/shots/baseline"/*-1440.png; do
  n=$(basename "$f")
  a=$(node -e "console.log(require('fs').statSync(process.argv[1]).size)" "$f")
  b=$(node -e "console.log(require('fs').statSync(process.argv[1]).size)" "$SCRATCH/shots/phase1-final/$n")
  echo "$n baseline=$a final=$b"
done
```

Expected: ขนาดไฟล์ใกล้เคียงกัน — **ขนาดต่างกันเป็นเรื่องปกติเพราะ Task 7 เปลี่ยนรูปเป็นเวอร์ชันย่อ** สิ่งที่ต้องทำจริงคือ**เปิดดูภาพเทียบด้วยตา**อย่างน้อย `list-1440.png`, `entry-1440.png`, `dashboard-1440.png`, `products-1440.png` แล้วยืนยันว่าเลย์เอาต์ ตำแหน่ง และขนาดปุ่มเหมือนเดิม

- [ ] **Step 4: รายงานผู้ใช้พร้อม checklist ที่ต้องลองเอง**

รายงานให้ผู้ใช้ว่าเฟส 1 เสร็จ พร้อมวิธีเปิดจากมือถือและรายการที่ screenshot พิสูจน์แทนไม่ได้:

```
วิธีเปิดจากมือถือ (ต้องอยู่บน hotspot/wifi วงเดียวกับคอม):
1. บนคอม เปิด PowerShell แล้วรัน:  ipconfig | findstr IPv4
2. บนมือถือเปิด http://<IP ที่ได้>:3000

ต้องลองเองเพราะ screenshot พิสูจน์แทนไม่ได้:
[ ] ลิ้นชัก "ล่าสุด" เปิด/ปิด/ปัดซ้ายเพื่อปิดได้จริงด้วยนิ้ว
[ ] เมนู ⋮ ในลิ้นชัก กดได้ และทำซ้ำ/ลบทำงานจริง
[ ] ปุ่มคัดลอกทั้ง 3 จุด — 10-part prompt, caption+hashtags, prompt ในแท็บ ②
    (ถ้าคัดลอกไม่ได้ต้องขึ้นข้อความบอก ไม่ใช่เงียบ)
[ ] อัปโหลดรูปจากคลังภาพมือถือได้ และรูปที่ได้ไม่ถูกปฏิเสธ
[ ] กด "สร้างด้วย AI" แล้วได้ผลครบ
[ ] ปุ่มทุกตัวกดโดนด้วยนิ้วโดยไม่ต้องเล็ง
```

- [ ] **Step 5: รอ feedback ก่อนเริ่มเฟส 2**

**หยุดที่นี่** — เฟส 2 ต้องเริ่มหลังผู้ใช้ลองจริงแล้ว เพราะสิ่งที่เจอจากการใช้จริงอาจเปลี่ยนลำดับความสำคัญของงานที่เหลือ

---

# เฟส 2 — ขัดหน้าที่เหลือ

> เริ่มเฟสนี้หลัง Task 9 Step 5 เท่านั้น

## Task 10: `/products` — ตาราง 10 คอลัมน์ → การ์ด และคำเตือนที่หายไปบนสัมผัส

สองปัญหา: ตาราง `min-w-[64rem]` (1024px) ทำให้ต้องเลื่อนซ้ายขวาตลอดเวลาบนมือถือ และ**ข้อความคำเตือนฉบับเต็มเก็บไว้ใน `title=` อย่างเดียว** ซึ่งจอสัมผัสไม่มีทางเห็น — หน้าหาสินค้าบนมือถือจึงไม่บอกเลยว่าสินค้าไหนมีปัญหา

**Files:**
- Modify: `components/candidates-route.tsx:285-460`

**Interfaces:**
- Consumes: row shape เดิมของตาราง (ไม่เปลี่ยน type ใด ๆ)
- Produces: ไม่มี export ใหม่

- [ ] **Step 1: อ่านโค้ดส่วนที่จะแก้ให้ครบก่อน**

```bash
cd "C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt"
sed -n '280,470p' components/candidates-route.tsx
```

จดไว้: ชื่อตัวแปรของแต่ละคอลัมน์ · โครงสร้าง `warnings` (array ของ `{ key, text, danger }`) · ปุ่มในคอลัมน์ "จัดการ" · ป้าย (badge) แสดงยังไง

- [ ] **Step 2: ครอบตารางเดิมด้วย `hidden md:block` และเพิ่มรายการการ์ดสำหรับ base**

โครงที่ต้องได้ (เติมชื่อฟิลด์จริงจาก Step 1):

```tsx
        {/* ต่ำกว่า md: เป็นการ์ด — ตาราง 10 คอลัมน์กว้าง 1024px บนจอ 390px คือการเลื่อน
            ซ้ายขวาหาข้อมูลตลอดเวลา · เลือกเฉพาะสิ่งที่ใช้ตัดสินใจ: ชื่อ+ป้ายเป็นหัว
            ศักยภาพรายได้เด่นสุด (เป็นตัวจัดอันดับอยู่แล้ว) ที่เหลือเป็นแถวรอง */}
        <ul className="flex flex-col gap-2 md:hidden">
          {visible.map((r) => {
            const plausible = isCommissionPercentPlausible(r.commissionPercent);
            const warnings: { key: string; text: string; danger: boolean }[] = [];
            // ...ประกอบ warnings ด้วยตรรกะเดียวกับในตาราง (คัดลอกมาให้ตรงกันทุกเงื่อนไข)

            return (
              <li
                key={r.id}
                className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 text-base leading-relaxed font-medium text-foreground">
                    {r.productName}
                  </p>
                  {/* ปุ่มในคอลัมน์ "จัดการ" ย้ายมาอยู่มุมขวาบน */}
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {/* ป้ายทุกอันเหมือนในตาราง */}
                  <span className="text-xs leading-relaxed text-muted-foreground">{r.category}</span>
                </div>

                <p className="text-lg font-bold text-foreground">
                  {/* ศักยภาพรายได้ — ตัวเลขเด่นสุดของการ์ด */}
                </p>

                <dl className="grid grid-cols-3 gap-2 text-xs leading-relaxed">
                  <div>
                    <dt className="text-muted-foreground">ราคา</dt>
                    <dd className="font-mono text-foreground">{/* ราคา */}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">ค่าคอม</dt>
                    <dd className="font-mono text-foreground">{/* ค่าคอม */}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">ขาย/สัปดาห์</dt>
                    <dd className="font-mono text-foreground">{/* ขายต่อสัปดาห์ */}</dd>
                  </div>
                </dl>

                {/* คำเตือนเป็นข้อความจริง ไม่ใช่ title= ที่จอสัมผัสไม่มีทางเห็น */}
                {warnings.length > 0 && (
                  <ul className="flex flex-col gap-1">
                    {warnings.map((w) => (
                      <li
                        key={w.key}
                        className={cn(
                          "text-xs leading-relaxed",
                          w.danger ? "text-destructive" : "text-muted-foreground"
                        )}
                      >
                        {w.text}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
```

จากนั้นเพิ่ม `hidden md:block` เข้าไปใน `className` ของ `<div>` ที่ครอบตาราง (บรรทัด 290):

```tsx
        <div className="relative hidden min-w-0 overflow-x-auto rounded-xl border border-border bg-surface md:block">
```

> **ห้ามลบ `relative`** — คอมเมนต์บรรทัด 285-289 อธิบายว่ามันกัน `sr-only` หลุดไปยืด scrollWidth ของหน้าเพจ 209px และห้ามแตะคอมเมนต์เรื่องหัวตารางไม่ sticky

- [ ] **Step 3: ทำให้คำเตือนเข้าถึงได้ในฝั่งตารางด้วย**

ในตาราง (`md:` ขึ้นไป) คำเตือนยังเป็นไอคอน + `title` ซึ่งบนแท็บเล็ตที่ `md:`–`lg:` ก็เป็นจอสัมผัสเหมือนกัน เปลี่ยนไอคอนคำเตือนให้เป็น `Popover` (มี `components/ui/popover.tsx` อยู่แล้ว) ที่กดแล้วแสดงข้อความ แทนที่จะพึ่ง hover อย่างเดียว — เก็บ `sr-only` เดิมไว้ครบ

- [ ] **Step 4: ตรวจ type และ lint**

```bash
cd "C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt"
npx tsc --noEmit && npm run lint
```

Expected: ผ่านทั้งคู่

- [ ] **Step 5: ตรวจว่าคำเตือนอ่านได้จริงบนจอสัมผัส**

```js
// $SCRATCH/pw/warnings-check.mjs
import { chromium } from "playwright";

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 800 },
  hasTouch: true,
  isMobile: true,
});
const page = await context.newPage();
await page.goto("http://localhost:3001/products", { waitUntil: "networkidle" });

// ข้อความคำเตือนต้องอยู่ใน DOM แบบมองเห็นได้ ไม่ใช่ซ่อนอยู่ใน title=
const titleOnly = await page.evaluate(
  () => document.querySelectorAll("[title]").length
);
const visibleWarnings = await page.evaluate(() => {
  const cards = document.querySelectorAll("ul > li");
  return Array.from(cards).some((c) => c.textContent && c.textContent.trim().length > 0);
});

console.log("จำนวน element ที่มี title= :", titleOnly);
console.log("การ์ดมีข้อความมองเห็นได้:", visibleWarnings, visibleWarnings ? "ok" : "FAIL");

await page.screenshot({ path: "products-390.png", fullPage: true });
await browser.close();
process.exit(visibleWarnings ? 0 : 1);
```

```bash
SCRATCH="C:/Users/patip/AppData/Local/Temp/claude/C--Users-patip-Desktop-playground-tts-assistant-pooling-pooling-prompt/aca2ec64-8550-488c-b8cb-003298a3e965/scratchpad"
cd "$SCRATCH/pw" && node warnings-check.mjs
```

Expected: `ok` และเปิด `products-390.png` ดูว่าคำเตือนของแถวที่เคยมีไอคอนตอนนี้อ่านเป็นข้อความได้

- [ ] **Step 6: ถ่าย screenshot แล้ว commit**

```bash
SCRATCH="C:/Users/patip/AppData/Local/Temp/claude/C--Users-patip-Desktop-playground-tts-assistant-pooling-pooling-prompt/aca2ec64-8550-488c-b8cb-003298a3e965/scratchpad"
PW_ROOT="$SCRATCH/pw" ENTRY_ID="<cuid>" node scripts/shot.mjs "$SCRATCH/shots/task10"

cd "C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt"
git diff --quiet tsconfig.json || git checkout -- tsconfig.json
git add components/candidates-route.tsx
git commit -m "Render candidates as cards below md and surface warnings on touch

The 10-column table is 1024px wide, and every warning's full text lived
only in a title attribute, which touch devices never display."
```

---

## Task 11: กราฟรายได้อ่านได้บนจอแคบ

`ResponsiveContainer width="100%"` ทำให้กราฟไม่พังอยู่แล้ว แต่ `YAxis width={64}` กิน 16% ของจอ 390px และ tick วันที่เบียดกันจนอ่านไม่ออก

**Files:**
- Modify: `components/revenue-charts.tsx:101-137, 174-210`

**Interfaces:**
- Consumes: props เดิมของ `RevenueCharts` (ไม่เปลี่ยน)
- Produces: ไม่มี export ใหม่

- [ ] **Step 1: อ่าน type จริงของ Recharts ก่อน**

```bash
cd "C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt"
grep -n -E 'interval|minTickGap|width\??:' node_modules/recharts/types/cartesian/XAxis.d.ts node_modules/recharts/types/cartesian/YAxis.d.ts | head -20
```

จดชื่อ prop และชนิดที่รับได้จริง — **ห้ามเดาจากตัวอย่าง Recharts v2 ที่พบทั่วไป** (โปรเจกต์นี้ใช้ v3.9.2)

- [ ] **Step 2: เพิ่ม hook ตรวจความกว้างจอ**

Recharts ตั้งค่า axis ผ่าน props ไม่ใช่ CSS จึงใช้ `md:` ไม่ได้ ต้องรู้ความกว้างจริงใน JS — เพิ่มที่ต้นไฟล์ (ไฟล์นี้เป็น `"use client"` อยู่แล้ว):

```tsx
/**
 * Recharts รับค่าผ่าน props (width ของแกน, ความถี่ของ tick) ไม่ใช่ CSS
 * จึงใช้ breakpoint ของ Tailwind ไม่ได้ ต้องอ่านความกว้างจริงจาก matchMedia
 *
 * ค่าเริ่มต้นเป็น false เพื่อให้ตรงกับฝั่งเซิร์ฟเวอร์ (ไม่มี window) แล้ว effect
 * ค่อยแก้ให้ถูกหลัง mount — ป้องกัน hydration mismatch
 */
function useIsNarrow(): boolean {
  const [isNarrow, setIsNarrow] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setIsNarrow(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return isNarrow;
}
```

เพิ่ม `useEffect`, `useState` เข้า import จาก `react` ถ้ายังไม่มี

- [ ] **Step 3: ใช้ค่าที่ได้กับแกนทั้งสองกราฟ**

ในคอมโพเนนต์กราฟ เรียก `const isNarrow = useIsNarrow();` แล้วแก้ทั้งสองที่ (บรรทัด ~108-120 และ ~181-193):

```tsx
            <XAxis
              /* ...props เดิมทั้งหมด... */
              tickFormatter={(v: string) => v.slice(5)}
              // จอแคบแสดง tick เว้นระยะ ไม่งั้นวันที่ทับกันจนอ่านไม่ออก
              interval={isNarrow ? "preserveStartEnd" : "preserveEnd"}
              minTickGap={isNarrow ? 32 : 8}
            />
            <YAxis
              /* ...props เดิมทั้งหมด... */
              tickFormatter={(v: number) => baht(v)}
              width={isNarrow ? 40 : 64}
            />
```

> ถ้า Step 1 พบว่า v3.9.2 ไม่มี `minTickGap` หรือ `interval` ไม่รับค่าเหล่านี้ ให้ใช้ prop ที่มีจริงตามที่อ่านเจอ **ห้ามใส่ prop ที่ type ไม่รับแล้วกลบด้วย `as any`**

- [ ] **Step 4: ตรวจ type, lint แล้วดูภาพ**

```bash
cd "C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt"
npx tsc --noEmit && npm run lint

SCRATCH="C:/Users/patip/AppData/Local/Temp/claude/C--Users-patip-Desktop-playground-tts-assistant-pooling-pooling-prompt/aca2ec64-8550-488c-b8cb-003298a3e965/scratchpad"
PW_ROOT="$SCRATCH/pw" ENTRY_ID="<cuid>" node scripts/shot.mjs "$SCRATCH/shots/task11"
```

Expected: `dashboard-390.png` — ป้ายวันที่บนแกน X ไม่ทับกัน และพื้นที่เส้นกราฟกว้างขึ้นชัดเจน · `dashboard-1440.png` เหมือน baseline

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt"
git diff --quiet tsconfig.json || git checkout -- tsconfig.json
git add components/revenue-charts.tsx
git commit -m "Thin the chart axes on narrow screens

The 64px y-axis took 16% of a 390px viewport and date ticks overlapped.
Recharts configures axes through props, not CSS, so this reads the
viewport with matchMedia rather than a Tailwind breakpoint."
```

---

## Task 12: แผงข้อมูลที่เหลือในหน้ารายได้

`revenue-by-clip.tsx` · `recommendations.tsx` · `angle-panel.tsx` · `import-log-panel.tsx` — ทั้งหมดใช้ `flex ... gap` กับ `flex-wrap` อยู่แล้ว งานคือให้แถวยุบเป็นแนวตั้งที่ base **ไม่ต้องรื้อโครง**

**Files:**
- Modify: `components/revenue-by-clip.tsx`
- Modify: `components/recommendations.tsx`
- Modify: `components/angle-panel.tsx`
- Modify: `components/import-log-panel.tsx`

**Interfaces:**
- Consumes: props เดิมของทั้งสี่คอมโพเนนต์ (ไม่เปลี่ยน)
- Produces: ไม่มี export ใหม่

- [ ] **Step 1: หาแถวที่บีบตัวเองบนจอแคบ**

```bash
cd "C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt"
grep -n -E 'flex items-center (justify-between )?gap|w-[0-9]{2}|whitespace-nowrap' components/revenue-by-clip.tsx components/recommendations.tsx components/angle-panel.tsx components/import-log-panel.tsx
```

- [ ] **Step 2: แก้ทีละแถวตามกฎเดียวกัน**

สำหรับแถวที่มี 3 ส่วนขึ้นไปเบียดกันในบรรทัดเดียว:

```
flex items-center justify-between gap-3
  → flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3
```

สำหรับความกว้างตายตัวที่ทำให้ส่วนอื่นไม่เหลือที่:

```
w-32  →  w-full sm:w-32
```

**ห้ามแตะตรรกะแบ่งเงิน 3 ทางใน `revenue-by-clip.tsx`** (จ่ายแล้ว/รอ/ไม่มีสิทธิ์) — ต้องตรงกับ `summarizeOrders` เสมอ task นี้แตะเฉพาะ `className`

- [ ] **Step 3: ตรวจ type, lint แล้วดูภาพ**

```bash
cd "C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt"
npx tsc --noEmit && npm run lint

SCRATCH="C:/Users/patip/AppData/Local/Temp/claude/C--Users-patip-Desktop-playground-tts-assistant-pooling-pooling-prompt/aca2ec64-8550-488c-b8cb-003298a3e965/scratchpad"
PW_ROOT="$SCRATCH/pw" ENTRY_ID="<cuid>" node scripts/shot.mjs "$SCRATCH/shots/task12"
```

Expected: `dashboard-390.png` — ทุกแผงอ่านได้โดยไม่มีข้อความถูกตัดกลางคัน และ script ไม่รายงาน `OVERFLOW` · `dashboard-1440.png` เหมือน baseline

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt"
git diff --quiet tsconfig.json || git checkout -- tsconfig.json
git add components/revenue-by-clip.tsx components/recommendations.tsx components/angle-panel.tsx components/import-log-panel.tsx
git commit -m "Stack dashboard panel rows vertically on narrow screens"
```

---

## Task 13: หน้าทำงาน entry — ทางเข้ารูปที่ใช้ได้จริงบนมือถือ

`brief-form.tsx` โฆษณา "กด Ctrl+V เพื่อวางรูป" เป็นทางหลัก ซึ่งบนมือถือไม่มีความหมาย กล่อง drop zone กดแล้วเปิด file picker ได้อยู่แล้ว (บรรทัด 419 `onClick`) แต่ไม่มีอะไรบอกผู้ใช้

**Files:**
- Modify: `components/brief-form.tsx:280-283, 415-440, 505-520`
- Modify: `components/production-panel.tsx` (ความสูง textarea)
- Modify: `components/date-picker-field.tsx` (เป้าสัมผัส)

**Interfaces:**
- Consumes: props เดิมของทั้งสามคอมโพเนนต์ (ไม่เปลี่ยน)
- Produces: ไม่มี export ใหม่

- [ ] **Step 1: เปลี่ยนคำโปรยและเพิ่มปุ่มที่เห็นชัดใน drop zone**

แทนที่ `<p>` บรรทัด 507-512:

```tsx
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
            >
              <ImagePlus className="size-4" />
              เลือกรูปจากเครื่อง
            </Button>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {isUploading
                ? "กำลังอัปโหลด..."
                : /* Ctrl+V กับการลากไฟล์ไม่มีอยู่บนมือถือ — เอ่ยถึงเฉพาะบนจอที่ทำได้จริง */
                  ""}
              <span className="hidden sm:inline">
                {isUploading ? "" : "หรือกด Ctrl+V เพื่อวางรูปที่แคปไว้ · หรือลากไฟล์มาวาง"}
              </span>
            </p>
          </div>
```

เพิ่ม `ImagePlus` เข้า import จาก `lucide-react` และเพิ่ม `Button` ถ้ายังไม่ได้ import

ทำแบบเดียวกันกับ `<p>` ของแผงสกัด (บรรทัด 280-283) โดยใช้ `extractInputRef`

- [ ] **Step 2: รับ HEIC ด้วย**

แก้ `accept` ทั้งสอง input (บรรทัด 289 และ 518):

```tsx
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
```

- [ ] **Step 3: ตรวจว่า `imageFilesFrom` ไม่ทิ้ง HEIC**

```bash
cd "C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt"
grep -rn -A 12 'function imageFilesFrom' components lib
```

ถ้าฟังก์ชันกรองด้วยรายชื่อ MIME ตายตัว ให้เพิ่ม `image/heic` และ `image/heif` เข้าไป · ถ้ากรองด้วย `type.startsWith("image/")` อยู่แล้วก็ไม่ต้องแก้

จากนั้นเช็กฝั่งเซิร์ฟเวอร์ด้วย:

```bash
grep -n -B3 -A 12 'ALLOWED\|mimeType' app/actions.ts | head -40
```

ถ้ามีรายชื่อ MIME ที่ยอมรับใน `uploadProductImages` ต้องเพิ่ม HEIC/HEIF ที่นั่นด้วย ไม่งั้นเลือกไฟล์ได้แต่อัปโหลดไม่ผ่าน

> **หมายเหตุ:** `app/api/uploads/[...path]/route.ts` มี `MIME_BY_EXT` ที่รู้จักแค่ `.jpg/.png/.webp` — ถ้ารับ HEIC ต้องเพิ่ม `.heic`/`.heif` ที่นั่นด้วย ไม่งั้นอัปได้แต่แสดงผลไม่ได้ (route คืน 404) **นี่คือจุดที่พลาดง่ายที่สุดใน task นี้**

- [ ] **Step 4: textarea และ date picker**

- `production-panel.tsx` — textarea ที่ยาวมากบนมือถือกินทั้งหน้าจอ ใส่ `max-h-[60dvh] sm:max-h-none` ให้ช่องที่ยาวที่สุด
- `date-picker-field.tsx` — ตรวจว่าปุ่มเปิดปฏิทินและวันที่แต่ละช่องกดได้ด้วยนิ้ว (≥44px ที่ base)

- [ ] **Step 5: ตรวจ type, lint แล้วดูภาพ**

```bash
cd "C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt"
npx tsc --noEmit && npm run lint

SCRATCH="C:/Users/patip/AppData/Local/Temp/claude/C--Users-patip-Desktop-playground-tts-assistant-pooling-pooling-prompt/aca2ec64-8550-488c-b8cb-003298a3e965/scratchpad"
PW_ROOT="$SCRATCH/pw" ENTRY_ID="<cuid>" node scripts/shot.mjs "$SCRATCH/shots/task13"
```

Expected: `entry-new-390.png` เห็นปุ่ม "เลือกรูปจากเครื่อง" ชัดเจน และไม่มีข้อความ "กด Ctrl+V" ที่ 390px

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt"
git diff --quiet tsconfig.json || git checkout -- tsconfig.json
git add components/brief-form.tsx components/production-panel.tsx components/date-picker-field.tsx app/actions.ts "app/api/uploads/[...path]/route.ts"
git commit -m "Give photo upload a visible entry point on touch

The drop zone already opened a file picker on tap, but the only prompt
said Ctrl+V, which does not exist on a phone. Also accepts HEIC/HEIF end
to end, since that is what iPhone cameras produce."
```

---

## Task 14: หน้าที่เหลือ — dashboard, core-prompt, ตัวกรอง

เบาที่สุดในเฟสนี้ ทั้งสามมี `sm:grid-cols-2` / `xl:flex-row` / `flex-wrap` อยู่แล้ว

**Files:**
- Modify: `components/dashboard-panel.tsx:195-240` (ฟอร์มอัปโหลดสองอัน)
- Modify: `components/core-prompt-panel.tsx` (textarea)
- Modify: `components/entry-filters.tsx:140-160` (ช่องค้นหา)

**Interfaces:**
- Consumes: props เดิม (ไม่เปลี่ยน)
- Produces: ไม่มี export ใหม่

- [ ] **Step 1: ฟอร์มอัปโหลดยุบแนวตั้ง**

ทั้งสองฟอร์มใน `dashboard-panel.tsx` (บรรทัด 199 และ 228) ใช้ `flex flex-wrap items-center gap-2` — บนจอแคบ input ไฟล์กับปุ่มจะเบียดกัน เปลี่ยนเป็น:

```tsx
              className="flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center"
```

- [ ] **Step 2: ช่องค้นหาเต็มความกว้างบนมือถือ**

ในฟอร์มค้นหาของ `entry-filters.tsx` ให้ `<form>` เป็น `w-full sm:w-auto` และช่อง `Input` เป็น `flex-1` เพื่อกินความกว้างที่เหลือ · ปุ่ม "ค้นหา" กับ "สินค้าใหม่" (บรรทัด 150-158) ให้อยู่แถวเดียวกันด้วย `flex-1 sm:flex-none` เพื่อไม่ให้ปุ่มแคบจนกดยาก

- [ ] **Step 3: textarea ของ core prompt**

`core-prompt-panel.tsx` ใช้ `xl:flex-row` กับ `xl:w-96` อยู่แล้ว ต่ำกว่านั้นซ้อนกันซึ่งถูกต้อง — ตรวจแค่ว่า textarea ไม่สูงจนกินทั้งหน้าจอบนมือถือ ใส่ `max-h-[60dvh] xl:max-h-none` ถ้าจำเป็น

- [ ] **Step 4: ตรวจ type, lint แล้วดูภาพ**

```bash
cd "C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt"
npx tsc --noEmit && npm run lint

SCRATCH="C:/Users/patip/AppData/Local/Temp/claude/C--Users-patip-Desktop-playground-tts-assistant-pooling-pooling-prompt/aca2ec64-8550-488c-b8cb-003298a3e965/scratchpad"
PW_ROOT="$SCRATCH/pw" ENTRY_ID="<cuid>" node scripts/shot.mjs "$SCRATCH/shots/task14"
```

Expected: ไม่มี `OVERFLOW` ที่ความกว้างใด และภาพ 1440px เหมือน baseline

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt"
git diff --quiet tsconfig.json || git checkout -- tsconfig.json
git add components/dashboard-panel.tsx components/core-prompt-panel.tsx components/entry-filters.tsx
git commit -m "Stack upload forms and widen the search field on narrow screens"
```

---

## Task 15: งานกวาด — `title=`, alias สีเก่า, CLAUDE.md

**Files:**
- Modify: ไฟล์ที่ยังมี `title=` ซึ่งเป็นข้อมูลจำเป็น
- Modify: `app/globals.css` (ลบบล็อก alias สีเก่า)
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: ทุกอย่างจาก Task 1-14
- Produces: ไม่มี export ใหม่

- [ ] **Step 1: ไล่ `title=` ทั้ง 13 จุด**

```bash
cd "C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt"
grep -rn 'title=' components/*.tsx
```

จัดแต่ละจุดเป็นสองกลุ่ม:
- **ข้อมูลจำเป็น** (ข้อความนั้นไม่มีที่อื่นให้อ่าน) → ต้องมีทางเข้าถึงบนสัมผัส: ทำเป็นข้อความจริง หรือ `Popover` ที่กดได้
- **ข้อมูลเสริม** (ซ้ำกับสิ่งที่เห็นอยู่แล้ว เช่น `aria-label` ของปุ่มสลับธีม/เสียง) → ปล่อยไว้ได้

จดเหตุผลของแต่ละจุดไว้ในข้อความ commit

- [ ] **Step 2: ยืนยันว่าไม่มีใครใช้ alias สีเก่าแล้ว**

```bash
cd "C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt"
grep -rn -E '\b(bg|text|border|ring|fill|stroke|from|to|via)-(teal|paper|ink|smoke|amber|danger)\b' components app lib
grep -n -E '^\s*--(teal|paper|ink|smoke|amber|danger)' app/globals.css
```

Expected: คำสั่งแรก**ไม่มีผลลัพธ์** (ยืนยันตอนเขียนแผนแล้วว่าไม่มี) · คำสั่งที่สองแสดงบรรทัดที่ต้องลบ

> ถ้าคำสั่งแรกมีผลลัพธ์ **ห้ามลบ alias** ให้แก้ไฟล์ที่ยังใช้ให้เป็นชื่อ semantic ก่อน แล้วค่อยลบ

- [ ] **Step 3: ลบบล็อก alias แล้วตรวจ contrast**

ลบบรรทัด `--teal`/`--paper`/`--ink`/`--smoke`/`--amber`/`--danger` และตัวที่อยู่ในกลุ่มเดียวกันออกจาก `:root` ใน `app/globals.css` (รวมคอมเมนต์ที่อธิบายว่าเก็บไว้ทำไม)

```bash
cd "C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt"
node scripts/check-contrast.mjs && npx tsc --noEmit && npm run lint
```

Expected: ผ่านทั้งสาม — ถ้า `check-contrast.mjs` พังเพราะอ่าน alias ที่เพิ่งลบ ให้แก้สคริปต์ให้อ่าน token semantic แทน **ห้ามลดเกณฑ์ในสคริปต์**

- [ ] **Step 4: อัปเดต CLAUDE.md**

แก้สามจุด:

1. **หัวข้อ "หนี้ที่ค้างอยู่"** — ลบทั้งย่อหน้าที่บอกว่า `entry-list.tsx`, `recommendations.tsx`, `clip-thumbnail.tsx`, `reminder-banner.tsx`, `entry-workspace.tsx` ยังใช้ alias ชื่อสีเก่า ข้อมูลนี้ล้าสมัยแล้ว (ยืนยันด้วย Step 2) แล้วเขียนแทนว่าบล็อก alias ถูกลบไปแล้วเมื่อ 2026-08-22

2. **กฎ UI ข้อ ⑤** เปลี่ยนจาก `ปุ่มสูงขั้นต่ำ 36px เป้าคลิกไอคอน 24×24px` เป็น:

```
⑤ **ปุ่มสูงขั้นต่ำ 44px ที่ต่ำกว่า `lg:` และ 36px ที่ `lg:` ขึ้นไป** — คุมจากที่เดียวคือบล็อก `size` ใน `components/ui/button.tsx` (ทุก variant เป็น `h-11 ... lg:h-9` คู่กันเสมอ) ปุ่มที่เขียน `h-9` เองโดยไม่ผ่าน `buttonVariants` ต้องเขียนเป็น `h-11 lg:h-9` เป้าคลิกไอคอน 24×24px
```

3. **เพิ่มหัวข้อใหม่เรื่องการทดสอบ responsive** ต่อจากหัวข้อ Testing / verification:

```
### ทดสอบ responsive

- `node scripts/shot.mjs <outDir>` ถ่าย screenshot ทุกหน้าที่ 390/820/1440px และ **fail ถ้าหน้าเพจสกรอลแนวนอน** ต้องตั้ง `PW_ROOT` ชี้ไปที่โฟลเดอร์ที่ติดตั้ง Playwright ไว้ (Playwright ไม่ใช่ dependency ของโปรเจกต์โดยตั้งใจ) และ `ENTRY_ID` เป็น cuid จริงจาก `dev-test.db`
- **1440px คือ checkpoint บังคับทุกครั้งที่แก้ UI** — เลย์เอาต์เดสก์ท็อปคือสิ่งที่ผู้ใช้ทำงานด้วยทุกวัน ห้ามเปลี่ยน
- breakpoint ที่ใช้: `base` โทรศัพท์ · `md:` แท็บเล็ต 2 คอลัมน์ · `lg:` เดสก์ท็อป (ของเดิม ห้ามแตะ)
- Playwright context ต้องตั้ง `hasTouch: true` ที่ต่ำกว่า 1024px ไม่งั้นจะไม่เจอบั๊กคลาส hover-only (`group-hover`, `title=`) ซึ่งเคยทำให้เมนูทำซ้ำ/ลบและคำเตือนในหน้าหาสินค้าหายไปทั้งหมดบนมือถือ
```

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt"
git diff --quiet tsconfig.json || git checkout -- tsconfig.json
git add -A
git commit -m "Retire the legacy color aliases and record the responsive rules

The debt note in CLAUDE.md listed five files still using --teal/--paper
and friends; none of them do any more, so the alias block is gone. Also
records the 44px touch rule and how to run the screenshot check."
```

---

## Task 16: ประตูจบ — build เต็มรูปแบบ

**Files:** ไม่แก้ไฟล์

- [ ] **Step 1: รันชุดตรวจทั้งหมดอีกรอบ**

```bash
cd "C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt"
npx tsc --noEmit && npm run lint && node scripts/check-contrast.mjs && node scripts/check-clipboard.mjs && node scripts/check-date-filter-label.mjs && node scripts/check-recommender.mjs && node scripts/check-candidates.mjs
```

Expected: ผ่านทั้งหมด

- [ ] **Step 2: ถ่าย screenshot ชุดสุดท้าย**

```bash
SCRATCH="C:/Users/patip/AppData/Local/Temp/claude/C--Users-patip-Desktop-playground-tts-assistant-pooling-pooling-prompt/aca2ec64-8550-488c-b8cb-003298a3e965/scratchpad"
PW_ROOT="$SCRATCH/pw" ENTRY_ID="<cuid>" node scripts/shot.mjs "$SCRATCH/shots/final"
```

Expected: exit code 0 — **ไม่มี `OVERFLOW` ที่ความกว้างใดเลย ทุกหน้า**

- [ ] **Step 3: เช็ก port 3000 ก่อน build**

```bash
netstat -ano | grep ':3000' | grep LISTENING
```

- ถ้า**ว่าง** → ไปต่อ Step 4
- ถ้า**ไม่ว่าง** → นั่นคือ `start.bat` ของผู้ใช้ **ห้าม kill** ให้ถามผู้ใช้ว่าปิดได้ไหม แล้วรอคำตอบ

- [ ] **Step 4: หยุด dev server ของ agent แล้ว build เต็มรูปแบบ**

```bash
cd "C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt"
# ปิด dev server ที่ port 3001 ของ agent ก่อน (ไม่ใช่ 3000 ของผู้ใช้)
netstat -ano | grep ':3001' | grep LISTENING
# taskkill //PID <pid> //F   ← double-slash เท่านั้น บน git-bash

npm run build
```

Expected: build ผ่าน ไม่มี error

> ถ้าเจอ `Cannot find module 'better-sqlite3-...'` แปลว่า `.next` ถูกเขียนทับกัน — `rm -rf .next` แล้ว build ใหม่

- [ ] **Step 5: ตรวจ tsconfig แล้วรายงานผู้ใช้**

```bash
cd "C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt"
git diff tsconfig.json
```

Expected: ไม่มี diff — ถ้ามีให้ `git checkout -- tsconfig.json` แล้ว commit

รายงานผู้ใช้: เฟส 2 เสร็จ · หน้าไหนเปลี่ยนอะไรบ้าง · น้ำหนักหน้ารายการลดจากเท่าไหร่เหลือเท่าไหร่ · และย้ำ checklist ที่ต้องลองเองบนเครื่องจริงจาก Task 9 Step 4 อีกครั้งสำหรับหน้าที่เพิ่งแก้ในเฟส 2

---

## Self-Review

ตรวจแผนนี้กับ spec แล้ว:

**Spec coverage:** ทุกหัวข้อในเฟส 1 ของ spec (1.1-1.7) แมปกับ Task 2-8 ครบ · เฟส 2 (2.1-2.6) แมปกับ Task 10-15 ครบ · หัวข้อ "การตรวจสอบ" ของ spec แมปกับ Task 1 (harness), Task 9 (ประตูเฟส 1), Task 16 (ประตูจบ) · หัวข้อ "สิ่งที่ตั้งใจไม่ทำ" ไม่มี task ไหนไปแตะ

**ช่องว่างที่พบและปิดแล้ว:** spec ไม่ได้พูดถึงว่า `app/api/uploads/[...path]/route.ts` มี `MIME_BY_EXT` ที่จะปฏิเสธ HEIC — เพิ่มเป็นหมายเหตุใน Task 13 Step 3 เพราะถ้าพลาดจุดนี้ ผู้ใช้จะอัปรูปจากไอโฟนได้แต่รูปไม่แสดง

**Type consistency:** `CopyOutcome`, `ClipboardDeps`, `copyText`, `copyInBrowser` ใช้ชื่อตรงกันทั้ง Task 2 (นิยาม) และที่อ้างถึงภายหลัง · `RailProps`, `RailBody`, `HistoryRail`, `HistoryRailDrawer` ใช้ชื่อตรงกันทั้ง Task 5 (นิยาม) และ Task 7 (แก้รูปใน `RailBody`) · `useIsNarrow` นิยามและใช้ใน Task 11 เท่านั้น

**ข้อควรระวังที่ฝังไว้ในแผนแล้ว:** ห้าม `as any` กลบ type ของ Base UI/Recharts · ห้าม `unoptimized` เพื่อเลี่ยงปัญหา image optimizer · ห้ามลดเกณฑ์ใน `check-contrast.mjs` · ห้ามลบ `relative` ใน `candidates-route.tsx` · ห้ามแตะตรรกะแบ่งเงินใน `revenue-by-clip.tsx` · ห้าม kill port 3000
