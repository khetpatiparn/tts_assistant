# Flow Image Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A batch worker that drives Google Flow (headed real Chrome, spare Google account) to generate the two reference images per product (white-background, then in-use), with a `/flow` review page where the user picks 1 of 4 per round; the two chosen images become ordinary `ProductImage` rows.

**Architecture:** Three pieces that only talk through SQLite: ① the existing Next.js app (new `/flow` page + enqueue panel on the entry page + Server Actions), ② three new Prisma tables (`FlowJob`, `FlowJobImage`, `FlowWorkerState`), ③ a separate Node process `worker/` (Playwright + real Chrome persistent profile) started by `flow-worker.bat`. The worker fails fast and pauses the whole queue on any anomaly, capturing evidence to `uploads/_flow-failures/`.

**Tech Stack:** Next.js 16.2.10 (custom build — read `node_modules/next/dist/docs/` before App Router code), Prisma 7 + `@prisma/adapter-better-sqlite3`, Playwright 1.63 (`channel: "chrome"`), `tsx` to run the worker's TypeScript, Tailwind v4 + shadcn (Base UI), Thai UI copy.

**Spec:** `docs/superpowers/specs/2026-09-06-flow-image-bot-design.md` — read it first; this plan argues from it. Also read `CLAUDE.md` (project rules) before touching any file.

## Global Constraints

Copied from the spec + CLAUDE.md. Every task implicitly includes these.

- **Language:** all UI copy, comments and commit messages body in Thai (identifiers/technical terms stay English). Commit subject lines in English are fine (match `git log`).
- **Branch:** all work on `flow-image-bot` (already exists, spec committed). Never commit to `master`.
- **Never run `npm run build` / `npm run dev` on the shared `.next`** while the user's `start.bat` server may be running. Type-check with `npx tsc --noEmit`; lint with `npm run lint`. For UI checks run `NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001` (copy `cp dev.db dev-test.db` first). After any dev run: `git diff tsconfig.json` and `git checkout -- tsconfig.json` if changed.
- **Never use the real `dev.db` for testing UI or the worker end-to-end.** Worker tests use `DATABASE_URL="file:./dev-test.db"`.
- **Never `DELETE FROM <table>` without a `WHERE`.**
- **Prisma:** import the client from `@/lib/generated/prisma/client` (no index barrel). After schema changes: `npx prisma migrate dev --name <name>` then `npx prisma generate`. Adapter class is `PrismaBetterSqlite3`.
- **UI rules (CLAUDE.md):** no `text-[...]` arbitrary sizes (use `text-xs`…`text-3xl`), no hex colors in `components/*`, `--border` is decorative / `--border-interactive` is for clickable edges, Thai line-height ≥ 1.6, no `uppercase`/`tracking-widest` on Thai, buttons ≥ 44px below `lg:` (use `<Button>` from `components/ui/button.tsx` — it already does `h-11 lg:h-9`), icon click target 24×24. Colors only via tokens (`bg-status-success`, `text-destructive`, `bg-surface-2`, `border-border-interactive`, …). 1440px desktop layout must not change for existing pages.
- **Run `node scripts/check-contrast.mjs`** after any color change (we add no new colors, so it must still pass).
- **`ProductImage` semantics do not change.** The bot never writes `ProductImage` rows except in `chooseFlowCandidate` for round 2 (copies 2 files).
- **Flow prompts are fixed strings** (spec §3): round 1 `ขอภาพสินค้าอย่างเดียวเท่านั้น พื้นหลังขาว สินค้าคือ "<productName>"`, round 2 `ขอภาพสินค้าตอนใช้งาน สินค้าคือ "<productName>"`. Settings: aspect **3:4**, count **×4**, model **Nano Banana 2** (not Lite, not Pro).
- **Worker stop rules (spec §7.4):** on any anomaly → mark job `failed` with `failedStep`/`errorKind`, set `FlowWorkerState.pausedReason`, capture evidence, and STOP processing. Never auto-retry a failed step. Never reset cookies.
- **Human pacing defaults (spec §7.3)** live in `flow-worker.config.json`; nothing in code hardcodes a delay.
- **Windows:** the user's machine is Windows 11; shell tool is Git Bash. To kill by port: `netstat -ano | grep ':3000' | grep LISTENING` then `taskkill //PID <pid> //F`. Node is v22.20.0. Chrome is at `C:\Program Files\Google\Chrome\Application\chrome.exe`.
- **Playwright** becomes a real dependency in this plan (spec §9). `scripts/shot.mjs` keeps its `PW_ROOT` mechanism untouched.

## Key facts learned from `ffroliva/gflow-cli` (2026-09-06) that shape the driver

Full report: `docs/superpowers/specs/2026-09-06-gflow-cli-dom-map.md` (read it before Task 4); the essentials:

1. **Login must happen in real Chrome launched WITHOUT Playwright** (`chrome.exe --user-data-dir=<profile>`); Google rejects sign-in from automation-launched browsers ("this browser may not be secure"). After sign-in the user closes Chrome; Playwright then opens the same profile with `channel: "chrome"`.
2. **Headed only, viewport 1920×1080, `locale: "en-US"`, URL `https://labs.google/fx/tools/flow?hl=en`.** Launch args `--disable-blink-features=AutomationControlled --password-store=basic --disable-dev-shm-usage`, `ignoreDefaultArgs: ["--enable-automation"]`, and an init script that makes `navigator.webdriver` undefined — without this Flow's reCAPTCHA Enterprise scores the session as a bot and `batchGenerateImages` returns 403 immediately. This is the minimum, not fingerprint spoofing.
3. **Google is migrating accounts to `flow.google.com` (since ~2026-09-03).** The new frontend is Angular Material (`mat-icon`, `.cdk-overlay-pane`) with none of the old `<i class="google-symbols">` ligature icons. gflow-cli cannot generate images there yet. **Task 3 must detect which host the spare account lands on**; the selectors file carries two sets (`labs` verified from gflow-cli, `migrated` = hints only, to be verified in Task 4).
4. **labs.google classic composer DOM** (Radix): mode/settings trigger `button[aria-haspopup='menu']:has(i.google-symbols:text('crop_16_9'))` (or any `crop_*`), image tab `[role='menu'] [role='tab'][aria-controls*='IMAGE']`, model trigger `button[aria-haspopup='menu']:has(i.google-symbols:text-is('arrow_drop_down'))` + `[role='menuitem']:has-text('Nano Banana 2'):not(:has-text('Lite'))`, aspect `[role="tab"]:text-is("3:4")`, count `[role="tab"]` filtered by `/^(1x|x[1-4])$/` positional, prompt `div[role="textbox"][data-slate-editor="true"]` (use `keyboard.insertText`, never `fill`), submit `button:has(i.google-symbols:text('arrow_forward'))`, add media `button[aria-haspopup='dialog']:has(i.google-symbols:text-is('add_2'))` → in the open dialog `button:has(i.google-symbols:text-is('upload'))` opens a file chooser → wait for a response whose URL contains `uploadImage` → click the last icon-less `button` in `[role='dialog'][data-state='open']` → dialog hidden.
5. **Results are captured from the network, not the DOM:** `page.on("response")` for URLs containing `batchGenerateImages`; the JSON body carries the image URLs (`fifeUrl`); download with `page.request.get(url)`. HTTP 401 = login expired, 403 = reCAPTCHA/WAF rejection (stop!), 429 = rate limit, 400 with `PUBLIC_ERROR_UNSAFE_*` = content policy.
6. **Rate reality:** ~14 submissions within 10 minutes → 403; runs spaced 30–60 min apart pass. Our defaults (one submission per product, 2–6 min between products, long break every 4–6) stay far below that.
7. **Overlays:** a changelog/announcement modal sets `body { pointer-events: none }` and eats clicks; consent buttons `button#L2AGLb`, `button[aria-label='Accept all']`; close buttons `button:has(i.google-symbols:text('close'))`, `[aria-label='Close']`. Check `getComputedStyle(document.body).pointerEvents` before clicking anything.
8. **Round 2 reference:** simplest robust path is to re-upload the chosen candidate PNG from disk through the same dialog (no picker search). This plan does that.

## File map

| Path | Responsibility |
|---|---|
| `flow-worker.config.json` | pacing/caps (spec §7.3), the only place with numbers |
| `worker/config.ts` | load + validate the JSON → typed `WorkerConfig` |
| `worker/humanize.ts` | `randInt`, `sleepRange`, `typeHuman`, `moveMouseCurve`, `humanClick`, `idleScroll` |
| `worker/schedule.ts` | pure: active-hours window, daily reset, next wake computation |
| `worker/errors.ts` | `FlowStepError` (step + kind), `ERROR_KINDS` |
| `worker/browser.ts` | launch persistent Chrome context, session/host check |
| `worker/flow-selectors.ts` | every selector, two sets: `labs` and `migrated` |
| `worker/failure.ts` | write `screenshot.png`, `page.html`, `steps.log`, `state.json` |
| `worker/flow-driver.ts` | `runRound(page, input, deps)` — the 12 named steps of one round |
| `worker/smoke/s1-session.ts` | Task 3 smoke: profile remembers login, report host |
| `worker/smoke/s2-round.ts` | Task 4 smoke: one full round from a local image → 4 PNGs |
| `worker/smoke/s3-round2.ts` | Task 5 smoke: round 2 using a downloaded PNG as reference |
| `worker/index.ts` | the loop: heartbeat, claim, pacing, stop rules |
| `flow-login.bat`, `flow-worker.bat`, `flow-worker-stop.bat` | user-facing launchers |
| `prisma/schema.prisma` + migration | `FlowJob`, `FlowJobImage`, `FlowWorkerState` |
| `scripts/enable-wal.mjs` | one-shot `PRAGMA journal_mode=WAL` on a db file |
| `lib/flow-jobs.ts` | pure: statuses, transitions, prompt builder, filenames, summaries |
| `lib/flow-queries.ts` | server-only reads for `/flow` and the entry panel |
| `app/actions.ts` (append) | `enqueueFlowJob`, `chooseFlowCandidate`, `redoFlowRound`, `resumeFlowWorker`, `skipFlowJob` |
| `app/flow/page.tsx`, `components/flow-route.tsx`, `components/flow-review-row.tsx`, `components/flow-lightbox.tsx` | `/flow` page |
| `components/flow-enqueue-panel.tsx` | entry page panel (upload source screenshots + enqueue + status line) |
| `scripts/check-flow-jobs.mjs`, `scripts/check-flow-worker-pure.mjs` | tests for the pure modules (project has no test runner; follow `scripts/check-candidates.mjs`) |

---

### Task 1: Dependencies, ignores, and the worker config module

**Files:**
- Modify: `package.json` (add deps + scripts)
- Modify: `.gitignore`
- Create: `flow-worker.config.json`
- Create: `worker/config.ts`
- Create: `scripts/check-flow-worker-pure.mjs` (first section; later tasks append to it)

**Interfaces:**
- Produces: `loadWorkerConfig(path?: string): WorkerConfig` and the `WorkerConfig` type (below). `Range = [number, number]`.

- [ ] **Step 1: Install dependencies**

Run from repo root:
```bash
npm install playwright@1.63.0 tsx@4.23.13
npx playwright install chromium
```
(`playwright install chromium` is only so Playwright's own browser exists for sanity checks; the worker uses `channel: "chrome"` = the system Chrome.) Expected: `package.json` gains `"playwright": "^1.63.0"` under dependencies and `"tsx": "^4.23.13"` (move it to `devDependencies` by hand if npm put it under dependencies — either is fine, keep it consistent).

- [ ] **Step 2: Add npm scripts**

In `package.json` `"scripts"` add:
```json
"flow-worker": "tsx worker/index.ts",
"flow-smoke:s1": "tsx worker/smoke/s1-session.ts",
"flow-smoke:s2": "tsx worker/smoke/s2-round.ts",
"flow-smoke:s3": "tsx worker/smoke/s3-round2.ts",
"check:flow": "node scripts/check-flow-worker-pure.mjs && node scripts/check-flow-jobs.mjs"
```

- [ ] **Step 3: Ignore runtime artifacts**

Append to `.gitignore`:
```
# Flow bot runtime (Chrome profile of the spare account, failure evidence, smoke outputs)
/.flow-profile/
/uploads/_flow-failures/
/worker/smoke/out/
/.check-flow-tmp-*/
```

- [ ] **Step 4: Write the config file with the spec defaults**

Create `flow-worker.config.json`:
```json
{
  "flowUrl": "https://labs.google/fx/tools/flow?hl=en",
  "profileDir": ".flow-profile",
  "viewport": { "width": 1920, "height": 1080 },
  "actionDelayMs": [800, 3000],
  "typeCharDelayMs": [40, 120],
  "dwellAfterResultsMs": [5000, 25000],
  "betweenBatchesMs": [20000, 60000],
  "betweenProductsMs": [120000, 360000],
  "longBreakEvery": [4, 6],
  "longBreakMs": [900000, 2400000],
  "dailyBatchCap": 24,
  "activeHours": null,
  "generationTimeoutMs": 300000,
  "uploadTimeoutMs": 120000,
  "selectorTimeoutMs": 8000,
  "pollIdleMs": 30000,
  "heartbeatMs": 30000,
  "mouse": { "curve": true, "idleScrollChance": 0.3 }
}
```

- [ ] **Step 5: Write the failing check for config validation**

Create `scripts/check-flow-worker-pure.mjs` (this script compiles the pure worker modules with `tsc` into a temp dir and imports them — same technique as `scripts/check-candidates.mjs`):
```js
/**
 * ตรวจโมดูล pure ของ worker (config / humanize / schedule) — แทน test runner ที่โปรเจกต์ไม่มี
 * รัน: node scripts/check-flow-worker-pure.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const out = mkdtempSync(join(process.cwd(), ".check-flow-tmp-"));
let failed = 0;

function check(name, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`      ได้ ${JSON.stringify(actual)} ควรได้ ${JSON.stringify(expected)}`);
}
function checkThrows(name, fn, includes) {
  let msg = null;
  try { fn(); } catch (e) { msg = e instanceof Error ? e.message : String(e); }
  const ok = msg !== null && msg.includes(includes);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`      ได้ ${JSON.stringify(msg)} ควรมีคำว่า ${JSON.stringify(includes)}`);
}

try {
  execFileSync(
    "npx",
    ["tsc", "worker/config.ts", "worker/humanize.ts", "worker/schedule.ts",
     "--outDir", out, "--module", "es2022", "--target", "ES2020", "--moduleResolution", "bundler",
     "--esModuleInterop", "--skipLibCheck"],
    { stdio: "inherit", shell: true }
  );

  // ---------- config ----------
  const cfg = await import(pathToFileURL(join(out, "config.js")).href);
  const good = cfg.loadWorkerConfig("flow-worker.config.json");
  check("default dailyBatchCap = 24", good.dailyBatchCap, 24);
  check("default activeHours = null", good.activeHours, null);
  check("actionDelayMs is a range", Array.isArray(good.actionDelayMs) && good.actionDelayMs.length === 2, true);

  const badPath = join(out, "bad.json");
  writeFileSync(badPath, JSON.stringify({ ...good, actionDelayMs: [3000, 800] }));
  checkThrows("range with min > max rejected", () => cfg.loadWorkerConfig(badPath), "actionDelayMs");

  writeFileSync(badPath, JSON.stringify({ ...good, activeHours: ["25:00", "07:00"] }));
  checkThrows("activeHours invalid hour rejected", () => cfg.loadWorkerConfig(badPath), "activeHours");

  writeFileSync(badPath, JSON.stringify({ ...good, dailyBatchCap: 0 }));
  checkThrows("dailyBatchCap must be >= 1", () => cfg.loadWorkerConfig(badPath), "dailyBatchCap");

  // ---------- humanize / schedule checks are appended by later tasks ----------
} finally {
  rmSync(out, { recursive: true, force: true });
}

if (failed > 0) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log("\nall checks passed");
```

- [ ] **Step 6: Run it to verify it fails**

Run: `node scripts/check-flow-worker-pure.mjs`
Expected: tsc error `Cannot find module` / file not found for `worker/config.ts` (exit code 1).

- [ ] **Step 7: Implement `worker/config.ts`**

```ts
import { readFileSync } from "node:fs";
import path from "node:path";

/** ช่วงสุ่ม [ต่ำสุด, สูงสุด] เป็นมิลลิวินาที (หรือจำนวนนับ สำหรับ longBreakEvery) */
export type Range = [number, number];

export type WorkerConfig = {
  flowUrl: string;
  profileDir: string;
  viewport: { width: number; height: number };
  actionDelayMs: Range;
  typeCharDelayMs: Range;
  dwellAfterResultsMs: Range;
  betweenBatchesMs: Range;
  betweenProductsMs: Range;
  longBreakEvery: Range;
  longBreakMs: Range;
  dailyBatchCap: number;
  /** ["22:00","07:00"] = ทำงานเฉพาะช่วงนี้ (ข้ามเที่ยงคืนได้) · null = ตลอดเวลา */
  activeHours: [string, string] | null;
  generationTimeoutMs: number;
  uploadTimeoutMs: number;
  selectorTimeoutMs: number;
  pollIdleMs: number;
  heartbeatMs: number;
  mouse: { curve: boolean; idleScrollChance: number };
};

const RANGE_KEYS = [
  "actionDelayMs", "typeCharDelayMs", "dwellAfterResultsMs", "betweenBatchesMs",
  "betweenProductsMs", "longBreakEvery", "longBreakMs",
] as const;

const POSITIVE_KEYS = [
  "dailyBatchCap", "generationTimeoutMs", "uploadTimeoutMs", "selectorTimeoutMs", "pollIdleMs", "heartbeatMs",
] as const;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function assertRange(key: string, value: unknown): asserts value is Range {
  if (!Array.isArray(value) || value.length !== 2 || !value.every((n) => Number.isFinite(n) && n >= 0)) {
    throw new Error(`config ${key} ต้องเป็น [min, max] ที่เป็นตัวเลข ≥ 0`);
  }
  if (value[0] > value[1]) throw new Error(`config ${key}: min (${value[0]}) มากกว่า max (${value[1]})`);
}

/**
 * อ่าน flow-worker.config.json แล้ว validate ทุก field — ค่าผิดต้องล้มตั้งแต่ตอนเปิด worker
 * ไม่ใช่ตอนกำลังคลิกอยู่ใน Flow
 */
export function loadWorkerConfig(file = "flow-worker.config.json"): WorkerConfig {
  const raw = JSON.parse(readFileSync(path.resolve(file), "utf8")) as Record<string, unknown>;

  if (typeof raw.flowUrl !== "string" || !raw.flowUrl.startsWith("https://")) {
    throw new Error("config flowUrl ต้องเป็น URL https");
  }
  if (typeof raw.profileDir !== "string" || raw.profileDir.length === 0) {
    throw new Error("config profileDir ต้องไม่ว่าง");
  }
  const vp = raw.viewport as { width?: unknown; height?: unknown } | undefined;
  if (!vp || typeof vp.width !== "number" || typeof vp.height !== "number") {
    throw new Error("config viewport ต้องมี width/height เป็นตัวเลข");
  }
  for (const key of RANGE_KEYS) assertRange(key, raw[key]);
  for (const key of POSITIVE_KEYS) {
    const v = raw[key];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1) {
      throw new Error(`config ${key} ต้องเป็นจำนวนเต็ม ≥ 1`);
    }
  }
  const ah = raw.activeHours;
  if (ah !== null) {
    if (!Array.isArray(ah) || ah.length !== 2 || !ah.every((s) => typeof s === "string" && HHMM.test(s))) {
      throw new Error('config activeHours ต้องเป็น null หรือ ["HH:MM","HH:MM"]');
    }
  }
  const mouse = raw.mouse as { curve?: unknown; idleScrollChance?: unknown } | undefined;
  if (!mouse || typeof mouse.curve !== "boolean" || typeof mouse.idleScrollChance !== "number"
      || mouse.idleScrollChance < 0 || mouse.idleScrollChance > 1) {
    throw new Error("config mouse ต้องมี curve (boolean) และ idleScrollChance (0..1)");
  }

  return raw as unknown as WorkerConfig;
}
```

- [ ] **Step 8: Run the check to verify it passes**

Run: `node scripts/check-flow-worker-pure.mjs`
Expected: the 6 config checks print `PASS` … then `all checks passed`. (The compile also touches `worker/humanize.ts` and `worker/schedule.ts` — create them as empty files `export {};` for now so tsc succeeds; Task 2 fills them.)

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json .gitignore flow-worker.config.json worker/config.ts worker/humanize.ts worker/schedule.ts scripts/check-flow-worker-pure.mjs
git commit -m "Add flow worker config module, deps and ignores

playwright/tsx เป็น dependency จริงแล้วสำหรับ worker · ค่าจังหวะทั้งหมดอยู่ใน flow-worker.config.json
ตาม spec §7.3 และ validate ตั้งแต่ตอนเปิด worker

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ajzf2iLhcMZZnYu7Mru6fQ"
```

---

### Task 2: Pure helpers — `humanize.ts` and `schedule.ts`

**Files:**
- Create/replace: `worker/humanize.ts`
- Create/replace: `worker/schedule.ts`
- Modify: `scripts/check-flow-worker-pure.mjs` (append checks)

**Interfaces:**
- Produces (humanize): `randInt(range: Range): number` · `sleepRange(range: Range): Promise<void>` · `typeHuman(page: Page, text: string, charDelay: Range): Promise<void>` · `moveMouseCurve(page: Page, to: {x:number;y:number}, from?: {x:number;y:number}): Promise<void>` · `humanClick(page: Page, locator: Locator, cfg: WorkerConfig): Promise<void>` · `maybeIdleScroll(page: Page, cfg: WorkerConfig): Promise<void>`
- Produces (schedule): `isWithinActiveHours(now: Date, activeHours: [string,string] | null): boolean` · `msUntilActiveWindow(now: Date, activeHours: [string,string]): number` · `localDateKey(d: Date): string` · `pickLongBreakTarget(range: Range): number`

- [ ] **Step 1: Append failing checks**

In `scripts/check-flow-worker-pure.mjs`, replace the line `// ---------- humanize / schedule checks are appended by later tasks ----------` with:
```js
  // ---------- humanize (pure parts only) ----------
  const hz = await import(pathToFileURL(join(out, "humanize.js")).href);
  {
    let inRange = true;
    for (let i = 0; i < 500; i++) {
      const v = hz.randInt([10, 20]);
      if (!Number.isInteger(v) || v < 10 || v > 20) inRange = false;
    }
    check("randInt stays inside [min,max] and is an integer", inRange, true);
    check("randInt with min==max returns min", hz.randInt([7, 7]), 7);
    const pts = hz.bezierPoints({ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }, 5);
    check("bezierPoints returns steps+1 points", pts.length, 6);
    check("bezierPoints starts at from", pts[0].x === 0 && pts[0].y === 0, true);
    check("bezierPoints ends at to", pts[5].x === 100 && pts[5].y === 100, true);
  }

  // ---------- schedule ----------
  const sc = await import(pathToFileURL(join(out, "schedule.js")).href);
  const at = (h, m) => new Date(2026, 8, 6, h, m, 0, 0); // 2026-09-06 local
  check("activeHours null → always active", sc.isWithinActiveHours(at(13, 0), null), true);
  check("same-day window 09:00-17:00 at 13:00 → active", sc.isWithinActiveHours(at(13, 0), ["09:00", "17:00"]), true);
  check("same-day window at 18:00 → inactive", sc.isWithinActiveHours(at(18, 0), ["09:00", "17:00"]), false);
  check("overnight window 22:00-07:00 at 23:30 → active", sc.isWithinActiveHours(at(23, 30), ["22:00", "07:00"]), true);
  check("overnight window at 03:00 → active", sc.isWithinActiveHours(at(3, 0), ["22:00", "07:00"]), true);
  check("overnight window at 12:00 → inactive", sc.isWithinActiveHours(at(12, 0), ["22:00", "07:00"]), false);
  check("window end is exclusive (07:00 → inactive)", sc.isWithinActiveHours(at(7, 0), ["22:00", "07:00"]), false);
  check("msUntilActiveWindow 12:00 → 22:00 = 10h", sc.msUntilActiveWindow(at(12, 0), ["22:00", "07:00"]), 10 * 3600000);
  check("msUntilActiveWindow 18:00 → next day 09:00 = 15h", sc.msUntilActiveWindow(at(18, 0), ["09:00", "17:00"]), 15 * 3600000);
  check("localDateKey formats YYYY-MM-DD local", sc.localDateKey(at(0, 5)), "2026-09-06");
  {
    let ok = true;
    for (let i = 0; i < 200; i++) { const t = sc.pickLongBreakTarget([4, 6]); if (t < 4 || t > 6) ok = false; }
    check("pickLongBreakTarget within range", ok, true);
  }
```

- [ ] **Step 2: Run to verify it fails**

Run: `node scripts/check-flow-worker-pure.mjs`
Expected: FAIL/TypeError lines for `hz.randInt` / `sc.isWithinActiveHours` (functions undefined), exit 1.

- [ ] **Step 3: Implement `worker/humanize.ts`**

```ts
import type { Locator, Page } from "playwright";
import type { Range, WorkerConfig } from "./config";

/** สุ่มจำนวนเต็มในช่วง [min, max] ทั้งสองปลายรวม */
export function randInt([min, max]: Range): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function sleepRange(range: Range): Promise<void> {
  return sleepMs(randInt(range));
}

export type Point = { x: number; y: number };

/** จุดบนเส้นโค้ง quadratic bezier — export ไว้ให้ทดสอบได้โดยไม่ต้องมี browser */
export function bezierPoints(from: Point, to: Point, control: Point, steps: number): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = (1 - t) * (1 - t) * from.x + 2 * (1 - t) * t * control.x + t * t * to.x;
    const y = (1 - t) * (1 - t) * from.y + 2 * (1 - t) * t * control.y + t * t * to.y;
    pts.push({ x, y });
  }
  return pts;
}

let lastMouse: Point = { x: 200, y: 200 };

/**
 * เลื่อนเมาส์ไปยังจุดหมายเป็นเส้นโค้งหลายสเต็ป — Playwright ค่าเริ่มต้นวาร์ปเมาส์ทันที
 * ซึ่งต่างจากคนชัดเจน
 */
export async function moveMouseCurve(page: Page, to: Point, from: Point = lastMouse): Promise<void> {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const control: Point = {
    x: from.x + dx * 0.5 + (Math.random() - 0.5) * Math.abs(dy) * 0.6,
    y: from.y + dy * 0.5 + (Math.random() - 0.5) * Math.abs(dx) * 0.6,
  };
  const steps = randInt([18, 40]);
  for (const p of bezierPoints(from, to, control, steps)) {
    await page.mouse.move(p.x, p.y);
    await sleepMs(randInt([4, 14]));
  }
  lastMouse = to;
}

/**
 * คลิก element แบบคน: หน่วงก่อน → เลื่อนเมาส์โค้งไปจุดสุ่มภายในกล่อง → กด
 * ถ้า element ไม่มี bounding box (ซ่อนอยู่) ให้ตกไปใช้ locator.click() ปกติ เพื่อให้
 * error ที่ได้เป็น timeout ของ Playwright ตามเดิม (ผู้เรียกแปลงเป็น selector_drift เอง)
 */
export async function humanClick(page: Page, locator: Locator, cfg: WorkerConfig): Promise<void> {
  await sleepRange(cfg.actionDelayMs);
  const box = await locator.boundingBox();
  if (box === null || !cfg.mouse.curve) {
    await locator.click({ timeout: cfg.selectorTimeoutMs });
    return;
  }
  const target: Point = {
    x: box.x + box.width * (0.3 + Math.random() * 0.4),
    y: box.y + box.height * (0.3 + Math.random() * 0.4),
  };
  await moveMouseCurve(page, target);
  await sleepMs(randInt([40, 160]));
  await page.mouse.down();
  await sleepMs(randInt([30, 110]));
  await page.mouse.up();
}

/**
 * พิมพ์ทีละตัวอักษรด้วย insertText — ใช้กับ Slate editor ของ Flow ได้ (fill() ใช้ไม่ได้)
 * และรองรับตัวอักษรไทยที่ keyboard.type จับคู่ key ไม่ได้
 */
export async function typeHuman(page: Page, text: string, charDelay: Range): Promise<void> {
  for (const ch of text) {
    await page.keyboard.insertText(ch);
    await sleepMs(randInt(charDelay));
  }
}

/** บางครั้งเลื่อนหน้าขึ้นลงเปล่าๆ เหมือนคนกำลังมอง — ไม่กระทบสถานะอะไรใน Flow */
export async function maybeIdleScroll(page: Page, cfg: WorkerConfig): Promise<void> {
  if (Math.random() >= cfg.mouse.idleScrollChance) return;
  const amount = randInt([120, 480]) * (Math.random() < 0.5 ? -1 : 1);
  await page.mouse.wheel(0, amount);
  await sleepMs(randInt([300, 1200]));
  await page.mouse.wheel(0, -amount);
}
```

- [ ] **Step 4: Implement `worker/schedule.ts`**

```ts
import type { Range } from "./config";
import { randInt } from "./humanize";

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function minutesNow(now: Date): number {
  return now.getHours() * 60 + now.getMinutes();
}

/**
 * อยู่ในช่วงเวลาทำงานไหม — ปลายทางเป็น exclusive และรองรับช่วงข้ามเที่ยงคืน
 * (["22:00","07:00"] = 22:00 ถึง 06:59)
 */
export function isWithinActiveHours(now: Date, activeHours: [string, string] | null): boolean {
  if (activeHours === null) return true;
  const start = minutesOf(activeHours[0]);
  const end = minutesOf(activeHours[1]);
  const cur = minutesNow(now);
  if (start === end) return true;
  if (start < end) return cur >= start && cur < end;
  return cur >= start || cur < end;
}

/** กี่มิลลิวินาทีจนถึงเวลาเริ่มช่วงถัดไป (เรียกเฉพาะตอน isWithinActiveHours เป็น false) */
export function msUntilActiveWindow(now: Date, activeHours: [string, string]): number {
  const start = minutesOf(activeHours[0]);
  const cur = minutesNow(now);
  const deltaMin = start > cur ? start - cur : 24 * 60 - cur + start;
  // ตัดวินาที/มิลลิวินาทีของ now ออก ให้ตื่นตรงนาทีเป้า
  return deltaMin * 60000 - now.getSeconds() * 1000 - now.getMilliseconds();
}

/** "YYYY-MM-DD" ตามเวลาท้องถิ่น — ห้ามใช้ toISOString() (จะได้วัน UTC ซึ่งเพี้ยนก่อนตี 7) */
export function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** สุ่มว่าจะทำต่อเนื่องกี่สินค้าก่อนพักยาว — สุ่มใหม่ทุกครั้งหลังพัก */
export function pickLongBreakTarget(range: Range): number {
  return randInt(range);
}
```

- [ ] **Step 5: Run the checks**

Run: `node scripts/check-flow-worker-pure.mjs`
Expected: all PASS, `all checks passed`.

- [ ] **Step 6: Commit**

```bash
git add worker/humanize.ts worker/schedule.ts scripts/check-flow-worker-pure.mjs
git commit -m "Add worker humanize and schedule helpers

เมาส์เลื่อนเป็น bezier · พิมพ์ทีละตัวด้วย insertText (Slate + ไทย) · ช่วงเวลาทำงานข้ามเที่ยงคืนได้

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ajzf2iLhcMZZnYu7Mru6fQ"
```

---

### Task 3: Browser launch, login launcher, and smoke S1 (session persists + which host)

**Files:**
- Create: `worker/errors.ts`
- Create: `worker/browser.ts`
- Create: `flow-login.bat`
- Create: `worker/smoke/s1-session.ts`
- Create: `worker/smoke/dump-dom.ts`

**Interfaces:**
- Produces: `ERROR_KINDS`, `ErrorKind`, `class FlowStepError extends Error { step: string; kind: ErrorKind }` · `launchFlowBrowser(cfg: WorkerConfig): Promise<{ context: BrowserContext; page: Page }>` · `openFlowAndSettle(page, cfg): Promise<{ host: string; url: string }>` · `checkSession(page): Promise<{ email: string | null }>` · `dumpDom(page, outFile): Promise<void>`

- [ ] **Step 1: `worker/errors.ts`**

```ts
/**
 * ชนิดความผิดพลาดที่ worker จำแนกได้ — ตรงกับ spec §7.4 บวก host_unsupported
 * (พบระหว่างอ่าน gflow-cli ว่า Google กำลังย้ายบัญชีไป flow.google.com ซึ่ง DOM คนละชุด)
 */
export const ERROR_KINDS = [
  "selector_drift",
  "login_required",
  "captcha",
  "generation_timeout",
  "flow_error",
  "download_failed",
  "worker_crash",
  "host_unsupported",
] as const;

export type ErrorKind = (typeof ERROR_KINDS)[number];

/** ความผิดพลาดที่รู้ว่าเกิดขั้นไหน — ทุก step ใน flow-driver โยนตัวนี้เท่านั้น */
export class FlowStepError extends Error {
  constructor(
    public readonly step: string,
    public readonly kind: ErrorKind,
    message: string
  ) {
    super(message);
    this.name = "FlowStepError";
  }
}

export function isFlowStepError(e: unknown): e is FlowStepError {
  return e instanceof FlowStepError;
}
```

- [ ] **Step 2: `worker/browser.ts`**

```ts
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import type { WorkerConfig } from "./config";
import { sleepMs } from "./humanize";

/**
 * เปิด Chrome จริง (channel "chrome") ด้วยโปรไฟล์ถาวรของบอท
 *
 * ข้อบังคับที่เรียนจาก gflow-cli: headed เท่านั้น · viewport 1920×1080 (ต่ำกว่านี้ Flow
 * ข้าม responsive breakpoint แล้ว selector เพี้ยน) · ซ่อน automation flag + navigator.webdriver
 * ไม่งั้น reCAPTCHA Enterprise ของ Flow ให้คะแนนเป็นบอทและ batchGenerateImages ตอบ 403 ทันที
 * — นี่คือขั้นต่ำเพื่อให้ browser ดูเป็น Chrome ปกติ ไม่ใช่การปลอม fingerprint
 */
export async function launchFlowBrowser(
  cfg: WorkerConfig
): Promise<{ context: BrowserContext; page: Page }> {
  const profileDir = path.resolve(cfg.profileDir);
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: "chrome",
    headless: false,
    viewport: cfg.viewport,
    locale: "en-US",
    args: [
      "--disable-blink-features=AutomationControlled",
      "--password-store=basic",
      "--disable-dev-shm-usage",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
    acceptDownloads: true,
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  const page = context.pages()[0] ?? (await context.newPage());
  return { context, page };
}

/**
 * ไปหน้า Flow แล้วรอให้ redirect จบ — Flow อาจ (1) เติม locale ใน path
 * (/fx/th/tools/flow) หรือ (2) ย้ายทั้งโฮสต์ไป flow.google.com ด้วย location.replace
 * หลังโหลดเสร็จ จึงต้องรอหลังจาก goto กลับมาแล้วอีกช่วงหนึ่งก่อนอ่าน URL
 */
export async function openFlowAndSettle(
  page: Page,
  cfg: WorkerConfig
): Promise<{ host: string; url: string }> {
  await page.goto(cfg.flowUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await sleepMs(6_000);
  const url = page.url();
  return { host: new URL(url).host, url };
}

/** ถาม session endpoint ของ labs.google ว่าล็อกอินอยู่ไหม — คืน email หรือ null */
export async function checkSession(page: Page): Promise<{ email: string | null }> {
  try {
    const res = await page.request.get("https://labs.google/fx/api/auth/session", {
      headers: { Referer: "https://labs.google/fx/tools/flow" },
      timeout: 15_000,
    });
    if (!res.ok()) return { email: null };
    const body = (await res.json()) as { user?: { email?: string } };
    const email = body?.user?.email;
    return { email: typeof email === "string" && email.length > 0 ? email : null };
  } catch {
    return { email: null };
  }
}

/** เจอปุ่ม Sign in บนหน้า = session หลุด (ใช้เป็นตัวตรวจร่วมกับ checkSession) */
export async function hasSignInButton(page: Page): Promise<boolean> {
  return (await page.locator("button:has-text('Sign in'), a:has-text('Sign in')").count()) > 0;
}
```

- [ ] **Step 3: `worker/smoke/dump-dom.ts`** (DOM inventory — used by S1 and again whenever Flow changes)

```ts
import { writeFileSync } from "node:fs";
import type { Page } from "playwright";

/**
 * เขียนรายการ element ที่กดได้ทั้งหมดของหน้า พร้อมชื่อไอคอน/aria-label/ข้อความ
 * ลงไฟล์ — ใช้เป็น "แผนที่" ตอนต้องหา selector ใหม่ (โฮสต์ใหม่ หรือ Flow เปลี่ยนหน้า)
 * ไม่มี logic ตัดสินใจ แค่ inventory
 */
export async function dumpDom(page: Page, outFile: string): Promise<void> {
  const rows = await page.evaluate(() => {
    const out: string[] = [];
    const els = document.querySelectorAll<HTMLElement>(
      "button, [role='button'], [role='tab'], [role='menuitem'], [role='option'], a[href], [contenteditable='true'], textarea, input[type='file']"
    );
    els.forEach((el, i) => {
      const icons = Array.from(el.querySelectorAll("i, mat-icon, svg"))
        .map((n) => (n.tagName === "SVG" ? "svg" : (n.textContent ?? "").trim()))
        .filter(Boolean)
        .join("|");
      const attrs = ["aria-label", "aria-haspopup", "aria-controls", "aria-selected", "aria-pressed", "role", "data-state", "id", "class"]
        .map((a) => (el.getAttribute(a) ? `${a}="${el.getAttribute(a)}"` : ""))
        .filter(Boolean)
        .join(" ");
      const text = (el.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
      const r = el.getBoundingClientRect();
      const visible = r.width > 0 && r.height > 0;
      out.push(`${i}\t${el.tagName.toLowerCase()}\tvisible=${visible}\ticons=[${icons}]\ttext="${text}"\t${attrs}`);
    });
    return out;
  });
  const aria = await page.locator("body").ariaSnapshot();
  writeFileSync(outFile, `URL: ${page.url()}\n\n=== clickable inventory ===\n${rows.join("\n")}\n\n=== aria snapshot ===\n${aria}\n`, "utf8");
}
```

- [ ] **Step 4: `worker/smoke/s1-session.ts`**

```ts
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
```

- [ ] **Step 5: `flow-login.bat`** (real Chrome, no Playwright — see "Key facts" #1)

```bat
@echo off
setlocal
cd /d "%~dp0"
echo.
echo  Opening Chrome with the bot profile (.flow-profile).
echo  1) Sign in with the SPARE Google account (never the main one).
echo  2) Wait until the Flow page is fully loaded.
echo  3) Close ALL Chrome windows of this profile before running flow-worker.bat
echo     (Chrome keeps an exclusive lock on the cookie file while open).
echo.
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir="%~dp0.flow-profile" --no-first-run --no-default-browser-check "https://labs.google/fx/tools/flow?hl=en"
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (If `playwright` types complain about `ariaSnapshot`, the installed version is < 1.49 — re-run `npm install playwright@1.63.0`.)

- [ ] **Step 7: CHECKPOINT — needs the user (do not skip, do not fake)**

Tell the user, in Thai:
1. Run `flow-login.bat`, sign in with the **spare** account, wait for Flow to load, then close every Chrome window.
2. Then you run `npm run flow-smoke:s1` **twice** (the second run proves the profile persisted without re-login). Playwright will open a visible Chrome window each time; the user should not touch it.

Record the output lines of the second run. Decision table:

| Output | Meaning | What to do next |
|---|---|---|
| `LOGGED_IN=yes`, `HOST=labs.google` | classic host, selectors from gflow-cli apply | proceed to Task 4 with `SELECTOR_SET=labs` |
| `LOGGED_IN=yes`, `HOST=flow.google.com` | account migrated; `migrated` selector set must be verified against `s1-dom.txt` in Task 4 Step 2 | proceed to Task 4 with `SELECTOR_SET=migrated` and expect to edit selectors |
| `LOGGED_IN=no` on the 2nd run | profile did not persist or Chrome was still open during login | ask the user to close all Chrome windows and repeat step 1; if it persists, check that `.flow-profile/Default/Cookies` exists |
| Playwright error containing `Target page, context or browser has been closed` immediately | Chrome of the same profile is still running | ask the user to close Chrome, retry |

Write the result (host, selector set, date) into the spec under a new heading `## Spike findings` (append; keep the spec's existing text). Commit:

```bash
git add worker/errors.ts worker/browser.ts worker/smoke/dump-dom.ts worker/smoke/s1-session.ts flow-login.bat docs/superpowers/specs/2026-09-06-flow-image-bot-design.md
git commit -m "Add Flow browser launcher, login launcher and S1 smoke

login ผ่าน Chrome จริงเท่านั้น (Google ปฏิเสธ sign-in จาก browser ที่ automation เปิด) แล้ว Playwright
เปิดโปรไฟล์เดิมด้วย channel chrome · S1 รายงานว่าบัญชีอยู่ labs.google หรือ flow.google.com

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ajzf2iLhcMZZnYu7Mru6fQ"
```

---

### Task 4: Selectors, failure evidence, the round driver, and smoke S2 (one full round)

**Files:**
- Create: `worker/flow-selectors.ts`
- Create: `worker/failure.ts`
- Create: `worker/flow-driver.ts`
- Create: `worker/smoke/s2-round.ts`

**Interfaces:**
- Consumes: `WorkerConfig`, `FlowStepError`, `launchFlowBrowser`, `openFlowAndSettle`, `checkSession`, `hasSignInButton`, `humanClick`, `typeHuman`, `sleepRange`, `sleepMs`, `maybeIdleScroll`, `randInt`.
- Produces:
  - `selectorSetForHost(host: string): SelectorSet` and `type SelectorSet` (below)
  - `class StepLog { log(step: string, msg: string): void; lines(): string[] }`
  - `captureFailure(args: { page: Page; dir: string; step: string; kind: ErrorKind; message: string; log: StepLog; state: Record<string, unknown> }): Promise<void>`
  - `runRound(page: Page, input: RoundInput, cfg: WorkerConfig, sel: SelectorSet, log: StepLog, opts?: { forceFailStep?: string }): Promise<RoundResult>` with
    `RoundInput = { round: 1 | 2; productName: string; referencePath: string; outDir: string; filePrefix: string; projectId: string | null }`,
    `RoundResult = { files: string[]; projectId: string; responseBody: unknown }`
  - `FLOW_STEPS` — ordered list of step names (used by the UI to explain `failedStep`).

- [ ] **Step 1: `worker/flow-selectors.ts`**

```ts
/**
 * selector ทุกตัวของ Flow อยู่ที่นี่ที่เดียว — วันที่ Flow เปลี่ยนหน้า แก้ไฟล์นี้ไฟล์เดียว
 *
 * ชุด "labs"    = labs.google classic composer (Radix UI + ไอคอน <i class="google-symbols">)
 *                 ทุกตัวถอดจากซอร์ส ffroliva/gflow-cli (v0.68.0, 2026-09-05) ซึ่งใช้งานจริง
 * ชุด "migrated"= flow.google.com (Angular Material) — gflow-cli ยังเจนรูปที่นี่ไม่ได้ ค่าในชุดนี้
 *                 เป็นแค่ "คำใบ้" จากรายงาน ต้องยืนยันกับ s1-dom.txt ก่อนใช้ (Task 4 Step 2)
 *
 * กติกา: หลาย selector ต่อขั้น = ลองตามลำดับ ตัวแรกที่ visible ชนะ (cascade)
 * ไอคอนใช้ ligature name (add_2, upload, crop_16_9, arrow_forward, arrow_drop_down) เพราะ
 * ข้อความบนปุ่มเปลี่ยนตามภาษาโปรไฟล์ Chrome แต่ชื่อไอคอนไม่เปลี่ยน
 */
export type SelectorSet = {
  name: "labs" | "migrated";
  hosts: string[];
  /** ปุ่มยอมรับ consent / ปิดประกาศ — กดได้ทุกตัวที่เจอ ไม่เจอก็ไม่เป็นไร */
  consentButtons: string[];
  overlayCloseButtons: string[];
  /** iframe/element ของ reCAPTCHA หรือข้อความ "unusual traffic" */
  captchaSignals: string[];
  newProject: string[];
  projectUrlFragment: string;
  /** ปุ่มเปิดเมนูโหมด/ตั้งค่า (ไอคอน crop_*) */
  modeTrigger: string[];
  imageTab: string[];
  modelTrigger: string[];
  /** ต้องแมตช์ 1 ตัวพอดี — 0 หรือ >1 = drift (เคยพังตอน "Nano Banana 2 Lite" โผล่มา) */
  modelOptionNanoBanana2: string;
  aspectTab: (label: string) => string;
  countTabs: string;
  countTabPattern: RegExp;
  addMedia: string[];
  uploadButtonInDialog: string[];
  openDialog: string;
  uploadResponseUrlPart: string;
  promptBox: string[];
  submit: string[];
  results: {
    /** network = ดัก response ของ endpoint เจนรูป · dom = เทียบ <img> ใหม่ที่โผล่ */
    strategy: "network" | "dom";
    responseUrlPart: string;
    /** host ของ URL รูปที่ยอมโหลด */
    imageUrlHosts: string[];
  };
};

const LABS: SelectorSet = {
  name: "labs",
  hosts: ["labs.google"],
  consentButtons: [
    "button#L2AGLb",
    "button[aria-label='Accept all']",
    "button[aria-label='I agree']",
    "button:has-text('Create with Flow')",
    "button:has-text('Get Started')",
  ],
  overlayCloseButtons: [
    "[role='dialog']:has(a[href*='changelog']) button",
    "button:has(i.google-symbols:text('clear'))",
    "button:has(i.google-symbols:text('close'))",
    "[aria-label='Close']",
    "[aria-label='Dismiss']",
  ],
  captchaSignals: [
    "iframe[src*='recaptcha'][src*='bframe']",
    "text=/unusual traffic/i",
    "text=/verify you are human/i",
  ],
  newProject: [
    "button:has(i.google-symbols:text('add_2'))",
    "button:has(i:text('add_2'))",
    "[role='button']:has(i.google-symbols:text('add_2'))",
    "button:has-text('New project')",
  ],
  projectUrlFragment: "/project/",
  modeTrigger: [
    "button[aria-haspopup='menu']:has(i.google-symbols:text('crop_16_9'))",
    "button[aria-haspopup='menu']:has(i.google-symbols:text('crop_9_16'))",
    "button[aria-haspopup='menu']:has(i.google-symbols:text('crop_square'))",
    "button[aria-haspopup='menu']:has(i.google-symbols:text('crop_portrait'))",
    "button[aria-haspopup='menu']:has(i.google-symbols:text('crop_landscape'))",
    "button[aria-haspopup='menu']:has(i.google-symbols:text('crop_original'))",
  ],
  imageTab: [
    "[role='menu'] [role='tab'][aria-controls*='IMAGE']",
    "[role='tab'][aria-controls*='IMAGE']",
    "[role='menu'] [role='tab']:has-text('Image')",
    "[role='menu'] [role='tab']:has(i:text('image'))",
  ],
  modelTrigger: [
    "button[aria-haspopup='menu']:has(i.google-symbols:text-is('arrow_drop_down'))",
  ],
  modelOptionNanoBanana2: "[role='menuitem']:has-text('Nano Banana 2'):not(:has-text('Lite')):not(:has-text('Pro'))",
  aspectTab: (label) => `[role="tab"]:text-is("${label}")`,
  countTabs: '[role="tab"]',
  countTabPattern: /^(1x|x[1-4])$/,
  addMedia: [
    "button[aria-haspopup='dialog']:has(i.google-symbols:text-is('add_2'))",
  ],
  uploadButtonInDialog: [
    "[role='dialog'][data-state='open'] button:has(i.google-symbols:text-is('upload'))",
    "[role='dialog'][data-state='open'] button:has-text('Upload media')",
  ],
  openDialog: "[role='dialog'][data-state='open']",
  uploadResponseUrlPart: "uploadImage",
  promptBox: [
    'div[role="textbox"][data-slate-editor="true"]',
    'div[contenteditable="true"]',
    "textarea",
  ],
  submit: [
    "button:has(i.google-symbols:text('arrow_forward'))",
    "button:has(i:text('arrow_forward'))",
  ],
  results: {
    strategy: "network",
    responseUrlPart: "batchGenerateImages",
    imageUrlHosts: ["googleusercontent.com", "flow-content.google", "googleapis.com"],
  },
};

/** คำใบ้จากรายงาน gflow-cli §7 เท่านั้น — ยังไม่เคยมีใครยืนยันกับหน้าจริง */
const MIGRATED: SelectorSet = {
  name: "migrated",
  hosts: ["flow.google.com"],
  consentButtons: LABS.consentButtons,
  overlayCloseButtons: ["button:has(mat-icon:text('close'))", "[aria-label='Close']", "[aria-label='Dismiss']"],
  captchaSignals: LABS.captchaSignals,
  newProject: ["button:has(mat-icon:text('add'))", "button:has-text('New project')"],
  projectUrlFragment: "/project/",
  modeTrigger: [
    ".settings-trigger-button",
    "button:has(mat-icon:text('crop_16_9'))",
    "button:has(mat-icon:text('crop_9_16'))",
  ],
  imageTab: [".cdk-overlay-pane [role='radio']:has-text('Image')", ".cdk-overlay-pane [role='tab']:has-text('Image')"],
  modelTrigger: ["button:has(mat-icon:text('arrow_drop_down'))"],
  modelOptionNanoBanana2: ".cdk-overlay-pane [role='menuitem']:has-text('Nano Banana 2'):not(:has-text('Lite')):not(:has-text('Pro')), .cdk-overlay-pane [role='option']:has-text('Nano Banana 2'):not(:has-text('Lite')):not(:has-text('Pro'))",
  aspectTab: (label) => `.cdk-overlay-pane [role="radio"]:text-is("${label}"), .cdk-overlay-pane [role="tab"]:text-is("${label}")`,
  countTabs: ".cdk-overlay-pane [role='radio'], .cdk-overlay-pane [role='tab']",
  countTabPattern: /^(1x|x[1-4]|[1-4])$/,
  addMedia: ["flow-prompt-box button.empty-chip", "button:has(mat-icon:text('add'))"],
  uploadButtonInDialog: ["flow-add-menu-popover-content button:has(mat-icon:text('upload'))", ".cdk-overlay-pane button:has(mat-icon:text('upload'))"],
  openDialog: ".cdk-overlay-pane",
  uploadResponseUrlPart: "batchexecute",
  promptBox: ["flow-prompt-box [contenteditable='true']", "[contenteditable='true']"],
  submit: ["button:has(mat-icon:text('arrow_forward'))"],
  results: {
    strategy: "dom",
    responseUrlPart: "batchexecute",
    imageUrlHosts: ["flow-content.google", "googleusercontent.com"],
  },
};

export function selectorSetForHost(host: string): SelectorSet {
  if (LABS.hosts.includes(host)) return LABS;
  if (MIGRATED.hosts.includes(host)) return MIGRATED;
  throw new Error(`ไม่รู้จักโฮสต์ ${host} — ไม่มี selector set สำหรับมัน`);
}

export const SELECTOR_SETS = { labs: LABS, migrated: MIGRATED } as const;
```

- [ ] **Step 2: If S1 said `SELECTOR_SET=migrated`, verify hints against `worker/smoke/out/s1-dom.txt` now**

Procedure (mechanical, no guessing):
1. Open `s1-dom.txt`. For each key of `MIGRATED` (`newProject`, `modeTrigger`, `imageTab`, `modelTrigger`, `addMedia`, `uploadButtonInDialog`, `promptBox`, `submit`), search the inventory for a row whose `icons=[...]` or `text="..."` matches the icon/text used in the hint (e.g. `arrow_forward`, `add`, `upload`, `crop_`).
2. If a matching row exists but its tag/attributes differ from the hint, rewrite the selector from that row (use `tag:has(mat-icon:text('<icon>'))` or `[aria-label='<label>']` — copy the exact strings from the row).
3. If no row matches at all, leave the hint and note the key in the spec's `## Spike findings` as `unverified`. Task 4 Step 8's failure evidence will show which step fails first; fix one step at a time and re-run S2.
4. Overlay panels (`.cdk-overlay-pane`) only exist while open; menu/dialog children cannot be verified from `s1-dom.txt` — S2 verifies them.

- [ ] **Step 3: `worker/failure.ts`**

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import type { ErrorKind } from "./errors";

/** บันทึกเวลาต่อขั้น — ทั้งไว้เขียน steps.log ตอนพัง และไว้พิมพ์ระหว่าง smoke */
export class StepLog {
  private readonly rows: string[] = [];
  constructor(private readonly echo: boolean = true) {}
  log(step: string, msg: string): void {
    const line = `${new Date().toISOString()}\t${step}\t${msg}`;
    this.rows.push(line);
    if (this.echo) console.log(line);
  }
  lines(): string[] {
    return [...this.rows];
  }
}

/**
 * เก็บหลักฐานตอนพังลงโฟลเดอร์เดียว: screenshot.png · page.html · steps.log · state.json
 * state.json คือของที่ได้จากการเอาบัญชีสำรองมาเสี่ยง — ทำไปกี่ชุดแล้วถึงเจอสัญญาณ
 * ฟังก์ชันนี้ห้าม throw (พังซ้อนพังจะกลบสาเหตุจริง) — ล้มขั้นไหนก็ข้ามขั้นนั้น
 */
export async function captureFailure(args: {
  page: Page;
  dir: string;
  step: string;
  kind: ErrorKind;
  message: string;
  log: StepLog;
  state: Record<string, unknown>;
}): Promise<void> {
  const { page, dir, step, kind, message, log, state } = args;
  mkdirSync(dir, { recursive: true });
  try {
    await page.screenshot({ path: path.join(dir, "screenshot.png"), fullPage: true, timeout: 15_000 });
  } catch (e) {
    log.log("capture", `screenshot ล้มเหลว: ${String(e)}`);
  }
  try {
    writeFileSync(path.join(dir, "page.html"), await page.content(), "utf8");
  } catch (e) {
    log.log("capture", `page.html ล้มเหลว: ${String(e)}`);
  }
  try {
    writeFileSync(
      path.join(dir, "state.json"),
      JSON.stringify({ step, kind, message, url: page.url(), capturedAt: new Date().toISOString(), ...state }, null, 2),
      "utf8"
    );
  } catch (e) {
    log.log("capture", `state.json ล้มเหลว: ${String(e)}`);
  }
  writeFileSync(path.join(dir, "steps.log"), log.lines().join("\n") + "\n", "utf8");
}
```

- [ ] **Step 4: `worker/flow-driver.ts`** — the 12 named steps

```ts
import { writeFileSync } from "node:fs";
import path from "node:path";
import type { Locator, Page, Response } from "playwright";
import type { WorkerConfig } from "./config";
import { FlowStepError, type ErrorKind } from "./errors";
import { humanClick, maybeIdleScroll, randInt, sleepMs, sleepRange, typeHuman } from "./humanize";
import type { SelectorSet } from "./flow-selectors";
import type { StepLog } from "./failure";
import { hasSignInButton } from "./browser";

export type RoundInput = {
  round: 1 | 2;
  productName: string;
  /** รอบ 1 = รูปแคปจากผู้ใช้ · รอบ 2 = รูป candidate ที่ผู้ใช้เลือก (อัปโหลดซ้ำจากดิสก์) */
  referencePath: string;
  outDir: string;
  /** ชื่อไฟล์ผลลัพธ์ = `${filePrefix}-${index}.png` */
  filePrefix: string;
  /** รอบ 2 ใช้ project เดิมของรอบ 1 · null = สร้างใหม่ */
  projectId: string | null;
};

export type RoundResult = { files: string[]; projectId: string; responseBody: unknown };

/** ลำดับขั้นตายตัว — ชื่อพวกนี้คือค่าใน FlowJob.failedStep และ UI ใช้แปลเป็นคำอธิบาย */
export const FLOW_STEPS = [
  "open-flow",
  "ensure-project",
  "switch-image-mode",
  "set-model",
  "set-aspect-3-4",
  "set-count-4",
  "attach-reference",
  "type-prompt",
  "click-generate",
  "wait-results",
  "dwell",
  "download-4",
] as const;

export type FlowStep = (typeof FLOW_STEPS)[number];

const ASPECT = "3:4";
const COUNT = 4;

/** พรอมต์ตายตัว 2 แบบ (spec §3) — ต้องเหมือน buildFlowPrompt ใน lib/flow-jobs.ts ทุกตัวอักษร */
export function flowPromptFor(round: 1 | 2, productName: string): string {
  return round === 1
    ? `ขอภาพสินค้าอย่างเดียวเท่านั้น พื้นหลังขาว สินค้าคือ "${productName}"`
    : `ขอภาพสินค้าตอนใช้งาน สินค้าคือ "${productName}"`;
}

function isTimeout(e: unknown): boolean {
  return e instanceof Error && (e.name === "TimeoutError" || /Timeout \d+ms exceeded/.test(e.message));
}

/** ลอง selector ตามลำดับ คืนตัวแรกที่ visible · ไม่เจอเลย = selector_drift */
async function firstVisible(page: Page, step: FlowStep, candidates: string[], timeoutMs: number): Promise<Locator> {
  const perCandidate = Math.max(1000, Math.floor(timeoutMs / candidates.length));
  for (const sel of candidates) {
    const loc = page.locator(sel).first();
    try {
      await loc.waitFor({ state: "visible", timeout: perCandidate });
      return loc;
    } catch {
      // ลองตัวถัดไป
    }
  }
  throw new FlowStepError(step, "selector_drift", `หา element ไม่เจอ: ${candidates.join(" | ")}`);
}

/** สัญญาณอันตรายที่ต้องเช็กก่อนทุกขั้น — login หลุด / captcha / modal ที่กิน pointer events */
async function assertPageUsable(page: Page, step: FlowStep, sel: SelectorSet, cfg: WorkerConfig, log: StepLog): Promise<void> {
  const host = new URL(page.url()).host;
  if (host.includes("accounts.google.com") || (await hasSignInButton(page))) {
    throw new FlowStepError(step, "login_required", "ถูกส่งไปหน้า login / เจอปุ่ม Sign in");
  }
  if (!sel.hosts.includes(host)) {
    throw new FlowStepError(step, "host_unsupported", `โฮสต์ ${host} ไม่ตรงกับ selector set ${sel.name}`);
  }
  for (const c of sel.captchaSignals) {
    if ((await page.locator(c).count()) > 0) {
      throw new FlowStepError(step, "captcha", `เจอสัญญาณ captcha: ${c}`);
    }
  }
  const blocked = await page.evaluate(() => getComputedStyle(document.body).pointerEvents === "none");
  if (blocked) {
    log.log(step, "body มี pointer-events:none — ลองปิด overlay");
    await dismissOverlays(page, sel, cfg, log);
    const still = await page.evaluate(() => getComputedStyle(document.body).pointerEvents === "none");
    if (still) throw new FlowStepError(step, "selector_drift", "มี overlay บังหน้าและปิดไม่ได้");
  }
}

async function dismissOverlays(page: Page, sel: SelectorSet, cfg: WorkerConfig, log: StepLog): Promise<void> {
  for (const s of [...sel.consentButtons, ...sel.overlayCloseButtons]) {
    const loc = page.locator(s).first();
    if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
      log.log("open-flow", `ปิด overlay ด้วย ${s}`);
      await humanClick(page, loc, cfg);
      await sleepMs(randInt([600, 1400]));
    }
  }
  await page.keyboard.press("Escape");
  await sleepMs(400);
}

function extractProjectId(url: string, fragment: string): string {
  const after = url.split(fragment)[1] ?? "";
  return after.split("?")[0].split("/")[0];
}

/** เดิน JSON ทั้งก้อน เก็บ URL รูปที่ host อยู่ใน allowlist — ไม่พึ่งชื่อ field (fifeUrl ฯลฯ) */
export function collectImageUrls(body: unknown, hosts: string[], out: Set<string> = new Set()): string[] {
  if (typeof body === "string") {
    if (/^https:\/\//.test(body)) {
      try {
        const h = new URL(body).host;
        if (hosts.some((allowed) => h === allowed || h.endsWith("." + allowed))) out.add(body);
      } catch {
        // ไม่ใช่ URL
      }
    }
  } else if (Array.isArray(body)) {
    for (const v of body) collectImageUrls(v, hosts, out);
  } else if (body && typeof body === "object") {
    for (const v of Object.values(body as Record<string, unknown>)) collectImageUrls(v, hosts, out);
  }
  return [...out];
}

function kindForStatus(status: number): ErrorKind | null {
  if (status === 401) return "login_required";
  if (status === 403) return "captcha";
  if (status === 429) return "flow_error";
  if (status >= 400) return "flow_error";
  return null;
}

/**
 * ทำ 1 รอบ (12 ขั้น) — ทุกขั้นตั้งชื่อไว้ใน FLOW_STEPS · ทุก error ที่หลุดออกไปเป็น FlowStepError
 * opts.forceFailStep ใช้ทดสอบ fail-fast (S4): ถึงขั้นนั้นแล้วโยน selector_drift ทันที
 */
export async function runRound(
  page: Page,
  input: RoundInput,
  cfg: WorkerConfig,
  sel: SelectorSet,
  log: StepLog,
  opts: { forceFailStep?: string } = {}
): Promise<RoundResult> {
  let projectId = input.projectId;
  const responses: { status: number; body: unknown; at: number }[] = [];
  let submitAt = 0;

  const onResponse = async (res: Response) => {
    if (!res.url().includes(sel.results.responseUrlPart)) return;
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      try {
        body = await res.text();
      } catch {
        body = null;
      }
    }
    responses.push({ status: res.status(), body, at: Date.now() });
  };

  async function step<T>(name: FlowStep, fn: () => Promise<T>): Promise<T> {
    if (opts.forceFailStep === name) {
      throw new FlowStepError(name, "selector_drift", "บังคับพังด้วย FLOW_FORCE_FAIL_STEP");
    }
    log.log(name, "เริ่ม");
    await assertPageUsable(page, name, sel, cfg, log);
    try {
      const out = await fn();
      log.log(name, "เสร็จ");
      return out;
    } catch (e) {
      if (e instanceof FlowStepError) throw e;
      if (isTimeout(e)) throw new FlowStepError(name, "selector_drift", `timeout: ${(e as Error).message}`);
      throw new FlowStepError(name, "worker_crash", e instanceof Error ? e.message : String(e));
    }
  }

  try {
    page.on("response", onResponse);

    await step("open-flow", async () => {
      const url = projectId ? `https://${sel.hosts[0]}/fx/tools/flow${sel.projectUrlFragment}${projectId}` : cfg.flowUrl;
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await sleepMs(randInt([3000, 6000]));
      await dismissOverlays(page, sel, cfg, log);
    });

    projectId = await step("ensure-project", async () => {
      if (page.url().includes(sel.projectUrlFragment)) {
        return extractProjectId(page.url(), sel.projectUrlFragment);
      }
      const btn = await firstVisible(page, "ensure-project", sel.newProject, cfg.selectorTimeoutMs);
      await humanClick(page, btn, cfg);
      await page.waitForURL((u) => u.toString().includes(sel.projectUrlFragment), { timeout: 20_000 });
      await sleepMs(randInt([2000, 4000]));
      await dismissOverlays(page, sel, cfg, log);
      return extractProjectId(page.url(), sel.projectUrlFragment);
    });

    await step("switch-image-mode", async () => {
      const trigger = await firstVisible(page, "switch-image-mode", sel.modeTrigger, cfg.selectorTimeoutMs);
      await humanClick(page, trigger, cfg);
      await sleepMs(randInt([600, 1000]));
      const tab = await firstVisible(page, "switch-image-mode", sel.imageTab, cfg.selectorTimeoutMs);
      await humanClick(page, tab, cfg);
      await sleepMs(randInt([900, 1500]));
      await page.keyboard.press("Escape");
      await sleepMs(500);
    });

    await step("set-model", async () => {
      const trigger = await firstVisible(page, "set-model", sel.modeTrigger, cfg.selectorTimeoutMs);
      await humanClick(page, trigger, cfg);
      await sleepMs(randInt([600, 1000]));
      const modelBtn = await firstVisible(page, "set-model", sel.modelTrigger, cfg.selectorTimeoutMs);
      await humanClick(page, modelBtn, cfg);
      await sleepMs(randInt([500, 900]));
      const option = page.locator(sel.modelOptionNanoBanana2);
      const n = await option.count();
      if (n !== 1) {
        const labels = await page.locator("[role='menuitem'], [role='option']").allInnerTexts();
        throw new FlowStepError("set-model", "selector_drift", `ตัวเลือก Nano Banana 2 แมตช์ ${n} ตัว (ต้อง 1) — เมนูมี: ${labels.join(" / ")}`);
      }
      await humanClick(page, option.first(), cfg);
      await sleepMs(randInt([500, 900]));
    });

    await step("set-aspect-3-4", async () => {
      const tab = page.locator(sel.aspectTab(ASPECT)).first();
      await tab.waitFor({ state: "visible", timeout: cfg.selectorTimeoutMs });
      await humanClick(page, tab, cfg);
      await sleepMs(randInt([400, 800]));
    });

    await step("set-count-4", async () => {
      const tabs = page.locator(sel.countTabs).filter({ hasText: sel.countTabPattern });
      const target = tabs.nth(COUNT - 1);
      await target.waitFor({ state: "visible", timeout: cfg.selectorTimeoutMs });
      await humanClick(page, target, cfg);
      await sleepMs(randInt([400, 800]));
      // อ่านกลับ: แท็บที่กดต้องกลายเป็น aria-selected="true" (Radix tablist) — ไม่ใช่แค่กดแล้วเชื่อ
      const selfSelected = await target.getAttribute("aria-selected");
      if (selfSelected !== "true") {
        throw new FlowStepError("set-count-4", "selector_drift", `กด x4 แล้วแต่ aria-selected ไม่ใช่ true (${selfSelected ?? "null"})`);
      }
      await page.keyboard.press("Escape");
      await sleepMs(randInt([400, 800]));
    });

    await step("attach-reference", async () => {
      const add = await firstVisible(page, "attach-reference", sel.addMedia, cfg.selectorTimeoutMs);
      await humanClick(page, add, cfg);
      await sleepMs(randInt([800, 1400]));
      const uploadBtn = await firstVisible(page, "attach-reference", sel.uploadButtonInDialog, cfg.selectorTimeoutMs);
      const uploadResponse = page.waitForResponse((r) => r.url().includes(sel.uploadResponseUrlPart) && r.request().method() === "POST", { timeout: cfg.uploadTimeoutMs });
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser", { timeout: cfg.selectorTimeoutMs }),
        humanClick(page, uploadBtn, cfg),
      ]);
      await chooser.setFiles(input.referencePath);
      const up = await uploadResponse;
      if (up.status() >= 400) {
        throw new FlowStepError("attach-reference", "flow_error", `อัปโหลดรูปตอบ HTTP ${up.status()}`);
      }
      await sleepMs(randInt([1000, 2000]));
      // ปุ่ม "Add to prompt" = ปุ่มสุดท้ายในไดอะล็อกที่ไม่มีไอคอน (ข้อความเปลี่ยนตามภาษา จึงไม่จับด้วยข้อความ)
      const dialog = page.locator(sel.openDialog).last();
      const confirm = dialog.locator("button").filter({ hasNot: page.locator("i, mat-icon") }).last();
      if ((await confirm.count()) > 0 && (await confirm.isVisible().catch(() => false))) {
        await humanClick(page, confirm, cfg);
      }
      await dialog.waitFor({ state: "hidden", timeout: 15_000 });
      await sleepMs(randInt([1000, 2000]));
    });

    await step("type-prompt", async () => {
      const box = await firstVisible(page, "type-prompt", sel.promptBox, cfg.selectorTimeoutMs);
      await humanClick(page, box, cfg);
      await page.keyboard.press("Control+A");
      await page.keyboard.press("Delete");
      await sleepMs(randInt([300, 700]));
      await typeHuman(page, flowPromptFor(input.round, input.productName), cfg.typeCharDelayMs);
      await sleepMs(randInt([500, 1200]));
    });

    const beforeImgs = await page.locator("img").evaluateAll((els) => els.map((e) => (e as HTMLImageElement).src));

    await step("click-generate", async () => {
      const btn = await firstVisible(page, "click-generate", sel.submit, cfg.selectorTimeoutMs);
      submitAt = Date.now();
      await humanClick(page, btn, cfg);
    });

    const urls = await step("wait-results", async () => {
      const deadline = Date.now() + cfg.generationTimeoutMs;
      while (Date.now() < deadline) {
        if (sel.results.strategy === "network") {
          const fresh = responses.filter((r) => r.at >= submitAt);
          for (const r of fresh) {
            const kind = kindForStatus(r.status);
            if (kind !== null) {
              const snippet = typeof r.body === "string" ? r.body.slice(0, 300) : JSON.stringify(r.body).slice(0, 300);
              throw new FlowStepError("wait-results", kind, `Flow ตอบ HTTP ${r.status}: ${snippet}`);
            }
          }
          const found = collectImageUrls(fresh.map((r) => r.body), sel.results.imageUrlHosts);
          if (found.length >= COUNT) {
            await sleepMs(2500); // เผื่อ response ที่มาช้า (straggler)
            return collectImageUrls(responses.filter((r) => r.at >= submitAt).map((r) => r.body), sel.results.imageUrlHosts);
          }
        } else {
          const now = await page.locator("img").evaluateAll((els) => els.map((e) => (e as HTMLImageElement).src));
          const fresh = now.filter((s) => !beforeImgs.includes(s));
          const good = collectImageUrls(fresh, sel.results.imageUrlHosts);
          if (good.length >= COUNT) {
            await sleepMs(2500);
            return good;
          }
        }
        const alert = page.locator("[role='alert'], [aria-live='assertive']");
        if ((await alert.count()) > 0) {
          const text = (await alert.allInnerTexts()).join(" ").trim();
          if (/policy|can't create|violat|not able to generate|error/i.test(text)) {
            throw new FlowStepError("wait-results", "flow_error", `Flow แจ้ง: ${text.slice(0, 200)}`);
          }
        }
        await sleepMs(2000);
      }
      throw new FlowStepError("wait-results", "generation_timeout", `รอผลเกิน ${cfg.generationTimeoutMs} ms`);
    });

    await step("dwell", async () => {
      await sleepRange(cfg.dwellAfterResultsMs);
      await maybeIdleScroll(page, cfg);
    });

    const files = await step("download-4", async () => {
      const picked = urls.slice(0, COUNT);
      if (picked.length < COUNT) {
        throw new FlowStepError("download-4", "download_failed", `ได้ URL รูปแค่ ${picked.length} จาก ${COUNT}`);
      }
      const written: string[] = [];
      for (const [i, url] of picked.entries()) {
        const res = await page.request.get(url, { maxRedirects: 5, timeout: 120_000 });
        if (!res.ok()) throw new FlowStepError("download-4", "download_failed", `โหลดรูป ${i} ตอบ HTTP ${res.status()}`);
        const buf = await res.body();
        const isPng = buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50;
        const isJpg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8;
        if (!isPng && !isJpg) throw new FlowStepError("download-4", "download_failed", `ไฟล์ ${i} ไม่ใช่ PNG/JPEG (${buf.length} bytes)`);
        const file = path.join(input.outDir, `${input.filePrefix}-${i}.${isPng ? "png" : "jpg"}`);
        writeFileSync(file, buf);
        written.push(file);
        await sleepMs(randInt([300, 900]));
      }
      return written;
    });

    return { files, projectId: projectId as string, responseBody: responses.filter((r) => r.at >= submitAt).map((r) => r.body) };
  } finally {
    page.off("response", onResponse);
  }
}
```

- [ ] **Step 5: `worker/smoke/s2-round.ts`**

```ts
/**
 * S2: ทำรอบ 1 ครบ 12 ขั้นจากรูปจริง 1 รูป → ต้องได้ 4 ไฟล์
 * รัน: npm run flow-smoke:s2 -- <path/to/product-screenshot.png> "<ชื่อสินค้า>"
 * ตัวเลือก: FLOW_FORCE_FAIL_STEP=<step> เพื่อทดสอบ fail-fast (S4)
 * ผลลัพธ์: worker/smoke/out/s2/*.png · s2-response.json · ถ้าพัง worker/smoke/out/s2-failure/
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadWorkerConfig } from "../config";
import { launchFlowBrowser, openFlowAndSettle } from "../browser";
import { selectorSetForHost } from "../flow-selectors";
import { runRound } from "../flow-driver";
import { StepLog, captureFailure } from "../failure";
import { isFlowStepError } from "../errors";

async function main() {
  const [refPath, productName] = process.argv.slice(2);
  if (!refPath || !productName) {
    console.error('usage: npm run flow-smoke:s2 -- <image> "<product name>"');
    process.exit(2);
  }
  const cfg = loadWorkerConfig();
  const outDir = path.resolve("worker/smoke/out/s2");
  mkdirSync(outDir, { recursive: true });
  const log = new StepLog(true);

  const { context, page } = await launchFlowBrowser(cfg);
  try {
    const { host } = await openFlowAndSettle(page, cfg);
    const sel = selectorSetForHost(host);
    log.log("s2", `host=${host} selectorSet=${sel.name}`);
    const result = await runRound(
      page,
      { round: 1, productName, referencePath: path.resolve(refPath), outDir, filePrefix: "r1-a1", projectId: null },
      cfg,
      sel,
      log,
      { forceFailStep: process.env.FLOW_FORCE_FAIL_STEP }
    );
    writeFileSync(path.join(outDir, "s2-response.json"), JSON.stringify(result.responseBody, null, 2), "utf8");
    console.log(`PROJECT_ID=${result.projectId}`);
    for (const f of result.files) console.log(`FILE=${f}`);
    console.log("S2 OK");
  } catch (e) {
    const step = isFlowStepError(e) ? e.step : "unknown";
    const kind = isFlowStepError(e) ? e.kind : "worker_crash";
    const message = e instanceof Error ? e.message : String(e);
    await captureFailure({ page, dir: path.resolve("worker/smoke/out/s2-failure"), step, kind, message, log, state: { smoke: "s2" } });
    console.error(`S2 FAILED step=${step} kind=${kind}: ${message}`);
    console.error("evidence: worker/smoke/out/s2-failure/");
    process.exitCode = 1;
  } finally {
    await context.close();
  }
}

main();
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit` → no errors.

- [ ] **Step 7: CHECKPOINT — run S2 with the user watching**

Ask the user for one real product screenshot (any recent one, saved as PNG/JPG) and the product name. Run:
```bash
npm run flow-smoke:s2 -- "C:/path/to/shot.png" "ชื่อสินค้า"
```
Expected: the visible Chrome walks through the steps (each printed with a timestamp), then `FILE=...` ×4 and `S2 OK`. Open the 4 files (Read tool) and ask the user whether they look like what Flow gives by hand (white background, 3:4, 4 variants).

- [ ] **Step 8: If S2 fails — fix ONE step, re-run, repeat**

The console shows `S2 FAILED step=<name> kind=<kind>`. Open `worker/smoke/out/s2-failure/screenshot.png` (Read tool shows images) and `steps.log`. Then:

| kind | Do |
|---|---|
| `selector_drift` at step X | Run `npx tsx -e "..."` is NOT allowed (bash mangles); instead add a temporary `await dumpDom(page, "worker/smoke/out/s2-dom.txt")` call right before the failing step in `flow-driver.ts`, re-run, read the inventory, correct only that step's entry in `flow-selectors.ts`, remove the temporary call. Never loosen a selector to something that could match >1 element. |
| `login_required` | Ask user to run `flow-login.bat` again, close Chrome, re-run. |
| `captcha` / HTTP 403 | STOP. Tell the user; wait ≥ 60 minutes before any further run (gflow-cli data: heat decays over hours). Do not tweak stealth flags. |
| `generation_timeout` with a screenshot that clearly shows 4 images | the results strategy mismatched — switch `results.strategy` of that selector set to `"dom"` (labs) / verify `imageUrlHosts` against the `src` values in `s2-dom.txt`. |
| `download_failed` "ได้ URL รูปแค่ N" | `collectImageUrls` filtered too hard: open `s2-response.json` (it is written even on success; on failure add a `writeFileSync` of `responses` in the catch of `wait-results` temporarily), find the image URL host, add it to `imageUrlHosts`. |

Each fix is one commit (`git commit -m "Fix Flow selector for <step>"`). Record final selectors' verification date in the spec `## Spike findings`.

- [ ] **Step 9: Commit**

```bash
git add worker/flow-selectors.ts worker/failure.ts worker/flow-driver.ts worker/smoke/s2-round.ts docs/superpowers/specs/2026-09-06-flow-image-bot-design.md
git commit -m "Add Flow round driver with named steps and S2 smoke

12 ขั้นตายตัว ทุก error เป็น FlowStepError(step, kind) · ผลรูปดักจาก network response ของ
batchGenerateImages (แนวเดียวกับ gflow-cli) · หลักฐานตอนพังลง screenshot/page.html/steps.log/state.json

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ajzf2iLhcMZZnYu7Mru6fQ"
```

---

### Task 5: Smoke S3 (round 2 re-uses a generated image) and S4 (fail-fast)

**Files:**
- Create: `worker/smoke/s3-round2.ts`
- Modify: `docs/superpowers/specs/2026-09-06-flow-image-bot-design.md` (append findings)

**Interfaces:**
- Consumes: `runRound`, `selectorSetForHost`, `captureFailure`, `StepLog`.

- [ ] **Step 1: `worker/smoke/s3-round2.ts`**

```ts
/**
 * S3: รอบ 2 ("ตอนใช้งาน") โดยอัปโหลดรูปที่ Flow วาดในรอบ 1 กลับเข้าไปเป็นรูปอ้างอิง
 * รัน: npm run flow-smoke:s3 -- worker/smoke/out/s2/r1-a1-0.png "<ชื่อสินค้า>" [projectId]
 * ถ้าใส่ projectId (จากบรรทัด PROJECT_ID= ของ S2) จะใช้ project เดิม ไม่งั้นสร้างใหม่
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadWorkerConfig } from "../config";
import { launchFlowBrowser, openFlowAndSettle } from "../browser";
import { selectorSetForHost } from "../flow-selectors";
import { runRound } from "../flow-driver";
import { StepLog, captureFailure } from "../failure";
import { isFlowStepError } from "../errors";

async function main() {
  const [refPath, productName, projectId] = process.argv.slice(2);
  if (!refPath || !productName) {
    console.error('usage: npm run flow-smoke:s3 -- <candidate.png> "<product name>" [projectId]');
    process.exit(2);
  }
  const cfg = loadWorkerConfig();
  const outDir = path.resolve("worker/smoke/out/s3");
  mkdirSync(outDir, { recursive: true });
  const log = new StepLog(true);

  const { context, page } = await launchFlowBrowser(cfg);
  try {
    const { host } = await openFlowAndSettle(page, cfg);
    const sel = selectorSetForHost(host);
    const result = await runRound(
      page,
      { round: 2, productName, referencePath: path.resolve(refPath), outDir, filePrefix: "r2-a1", projectId: projectId ?? null },
      cfg,
      sel,
      log
    );
    writeFileSync(path.join(outDir, "s3-response.json"), JSON.stringify(result.responseBody, null, 2), "utf8");
    for (const f of result.files) console.log(`FILE=${f}`);
    console.log("S3 OK");
  } catch (e) {
    const step = isFlowStepError(e) ? e.step : "unknown";
    const kind = isFlowStepError(e) ? e.kind : "worker_crash";
    const message = e instanceof Error ? e.message : String(e);
    await captureFailure({ page, dir: path.resolve("worker/smoke/out/s3-failure"), step, kind, message, log, state: { smoke: "s3" } });
    console.error(`S3 FAILED step=${step} kind=${kind}: ${message}`);
    process.exitCode = 1;
  } finally {
    await context.close();
  }
}

main();
```

- [ ] **Step 2: CHECKPOINT S3 — run it**

Wait **at least the `betweenProductsMs` minimum (2 minutes)** after S2 finished (be a human). Run:
```bash
npm run flow-smoke:s3 -- worker/smoke/out/s2/r1-a1-0.png "<same product name>" <PROJECT_ID from S2>
```
Expected: `FILE=` ×4, `S3 OK`, images show the product in use. If `open-flow` fails on the project URL with the given id, re-run without the id (new project) and record in the spec that "round 2 must open a fresh project" — then in Task 8 pass `projectId: null` for round 2.

- [ ] **Step 3: CHECKPOINT S4 — fail-fast proof (no Flow submission happens)**

Run (any image, any name):
```bash
FLOW_FORCE_FAIL_STEP=click-generate npm run flow-smoke:s2 -- worker/smoke/out/s2/r1-a1-0.png "ทดสอบ"
```
Expected:
- console: `S2 FAILED step=click-generate kind=selector_drift: บังคับพังด้วย FLOW_FORCE_FAIL_STEP`
- `worker/smoke/out/s2-failure/` contains `screenshot.png`, `page.html`, `steps.log`, `state.json`; `steps.log` ends at `type-prompt เสร็จ` (the generate button was never clicked → zero images generated).
- `state.json` has `"step": "click-generate"`, `"kind": "selector_drift"`.

- [ ] **Step 4: Record spike findings in the spec**

Append to the spec under `## Spike findings` (created in Task 3): host + selector set, whether round 2 can reuse the project, generation time per batch observed in `steps.log` (time between `click-generate เสร็จ` and `wait-results เสร็จ`), upload time, any selector edited. Then commit:

```bash
git add worker/smoke/s3-round2.ts docs/superpowers/specs/2026-09-06-flow-image-bot-design.md
git commit -m "Add S3 round-2 smoke and record spike findings

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ajzf2iLhcMZZnYu7Mru6fQ"
```

**GATE:** Do not continue to Task 6 until S2, S3 and S4 have all passed on the spare account. Report to the user with the 8 image files if they have not seen them.

---

### Task 6: Schema (3 tables), WAL, and the pure `lib/flow-jobs.ts`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_flow_jobs/migration.sql` (generated by Prisma)
- Create: `scripts/enable-wal.mjs`
- Create: `lib/flow-jobs.ts`
- Create: `scripts/check-flow-jobs.mjs`
- Modify: `CLAUDE.md` (Database section: WAL note)

**Interfaces:**
- Produces (`lib/flow-jobs.ts`, pure, importable from client components — **no `node:` imports**):
  - `FLOW_STATUS` object + `FlowStatus` type, `FLOW_ROUND_1_STATUSES`, `isOpenStatus(status)`, `roundOf(status): 1 | 2 | null`
  - `queuedStatus(round)`, `runningStatus(round)`, `reviewStatus(round)`
  - `buildFlowPrompt(round: 1|2, productName: string): string`
  - `candidateFilename(round, attempt, index, ext: "png"|"jpg")`, `sourceFilename(index, ext)`
  - `afterChoose(status)`, `afterRedo(status)`, `afterResume(round)` — each returns `{ status: FlowStatus }` or throws `Error` with a Thai message
  - `summarizeQueue(jobs: { status: string }[]): { waitingBot: number; waitingUser: number; done: number; failed: number }`
  - `isWorkerAlive(lastSeenAt: Date | null, now: Date, heartbeatMs: number): boolean`
  - `STEP_LABELS: Record<string, string>`, `ERROR_KIND_LABELS: Record<string, string>`, `STATUS_LABELS: Record<FlowStatus, string>`, `DEFAULT_CAPTIONS: { 1: string; 2: string }`, `WORKER_STATE_ID = "singleton"`

- [ ] **Step 1: Add the models to `prisma/schema.prisma`**

Add `flowJobs FlowJob[]` inside `model PromptEntry` (after `clipMetrics ClipMetric[]`), then append at the end of the file:

```prisma
/// งาน 1 แถว = สินค้า 1 ตัวที่รอ/กำลัง/เสร็จการวาดรูปอ้างอิงใน Google Flow (spec §5-6)
/// status: queued_r1 → running_r1 → review_r1 → queued_r2 → running_r2 → review_r2 → done
///         running_* → failed → (รันต่อ) queued_r<round> | (ข้าม) skipped
model FlowJob {
  id            String      @id @default(cuid())
  entryId       String
  entry         PromptEntry @relation(fields: [entryId], references: [id], onDelete: Cascade)
  status        String
  round         Int         @default(1)
  attempt       Int         @default(1)
  flowProjectId String      @default("")
  failedStep    String      @default("")
  errorKind     String      @default("")
  errorMessage  String      @default("")
  failureDir    String      @default("")
  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt
  startedAt     DateTime?
  finishedAt    DateTime?
  images        FlowJobImage[]

  @@index([status])
  @@index([entryId])
}

/// รูปของงาน — kind "source" = แคปจากผู้ใช้ (round 0) · "candidate" = Flow วาด (round 1|2)
/// ไฟล์อยู่ที่ uploads/<entryId>/flow/<filename>
model FlowJobImage {
  id        String   @id @default(cuid())
  jobId     String
  job       FlowJob  @relation(fields: [jobId], references: [id], onDelete: Cascade)
  kind      String
  round     Int      @default(0)
  attempt   Int      @default(1)
  index     Int      @default(0)
  filename  String
  mimeType  String
  chosen    Boolean  @default(false)
  createdAt DateTime @default(now())

  @@index([jobId])
}

/// แถวเดียว id = "singleton" — สถานะของ worker ที่ UI อ่าน (spec §5)
model FlowWorkerState {
  id            String    @id
  lastSeenAt    DateTime?
  currentJobId  String?
  pausedReason  String    @default("")
  pausedAt      DateTime?
  todayDate     String    @default("")
  todayBatches  Int       @default(0)
  sessionStreak Int       @default(0)
  nextWakeAt    DateTime?
  updatedAt     DateTime  @updatedAt
}
```

- [ ] **Step 2: Migrate and generate**

```bash
cp dev.db dev-backup-$(date +%Y%m%d)-flow.db     # backup first (pattern already gitignored)
npx prisma migrate dev --name add_flow_jobs
npx prisma generate
```
Expected: a new folder `prisma/migrations/<ts>_add_flow_jobs/` with `CREATE TABLE "FlowJob"…`, and `npx tsc --noEmit` still passes.

- [ ] **Step 3: `scripts/enable-wal.mjs` and run it**

```js
/**
 * เปิด WAL บนไฟล์ SQLite ครั้งเดียว (ค่าติดไปกับไฟล์ถาวร) — ต้องทำก่อนให้ worker กับ Next
 * เขียนพร้อมกัน ไม่งั้นชน "database is locked"
 * รัน: node scripts/enable-wal.mjs [dev.db]
 */
import Database from "better-sqlite3";

const file = process.argv[2] ?? "dev.db";
const db = new Database(file);
const mode = db.pragma("journal_mode = WAL", { simple: true });
db.close();
console.log(`${file}: journal_mode=${mode}`);
if (mode !== "wal") process.exit(1);
```
Run: `node scripts/enable-wal.mjs dev.db` → `dev.db: journal_mode=wal`. Also run it on `dev-test.db` if that file exists.

- [ ] **Step 4: Write the failing check `scripts/check-flow-jobs.mjs`**

```js
/**
 * ตรวจตรรกะ pure ของ lib/flow-jobs.ts — รัน: node scripts/check-flow-jobs.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const out = mkdtempSync(join(process.cwd(), ".check-flow-tmp-"));
let failed = 0;
function check(name, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`      ได้ ${JSON.stringify(actual)} ควรได้ ${JSON.stringify(expected)}`);
}
function checkThrows(name, fn) {
  let threw = false;
  try { fn(); } catch { threw = true; }
  if (!threw) failed++;
  console.log(`${threw ? "PASS" : "FAIL"}  ${name}`);
}

try {
  execFileSync("npx", ["tsc", "lib/flow-jobs.ts", "--outDir", out, "--module", "es2022", "--target", "ES2017", "--moduleResolution", "bundler"], { stdio: "inherit", shell: true });
  const f = await import(pathToFileURL(join(out, "flow-jobs.js")).href);

  check("queuedStatus(1)", f.queuedStatus(1), "queued_r1");
  check("runningStatus(2)", f.runningStatus(2), "running_r2");
  check("reviewStatus(2)", f.reviewStatus(2), "review_r2");
  check("roundOf review_r1", f.roundOf("review_r1"), 1);
  check("roundOf done", f.roundOf("done"), 2);
  check("roundOf failed → null", f.roundOf("failed"), null);
  check("isOpenStatus done → false", f.isOpenStatus("done"), false);
  check("isOpenStatus skipped → false", f.isOpenStatus("skipped"), false);
  check("isOpenStatus review_r1 → true", f.isOpenStatus("review_r1"), true);

  check("prompt round 1", f.buildFlowPrompt(1, "ที่ลับเล็บแมว"), 'ขอภาพสินค้าอย่างเดียวเท่านั้น พื้นหลังขาว สินค้าคือ "ที่ลับเล็บแมว"');
  check("prompt round 2", f.buildFlowPrompt(2, "ที่ลับเล็บแมว"), 'ขอภาพสินค้าตอนใช้งาน สินค้าคือ "ที่ลับเล็บแมว"');
  check("candidateFilename", f.candidateFilename(1, 2, 3, "png"), "r1-a2-3.png");
  check("sourceFilename", f.sourceFilename(0, "jpg"), "source-0.jpg");

  check("afterChoose review_r1 → queued_r2", f.afterChoose("review_r1").status, "queued_r2");
  check("afterChoose review_r2 → done", f.afterChoose("review_r2").status, "done");
  checkThrows("afterChoose queued_r1 throws", () => f.afterChoose("queued_r1"));
  check("afterRedo review_r1 → queued_r1", f.afterRedo("review_r1").status, "queued_r1");
  check("afterRedo review_r2 → queued_r2", f.afterRedo("review_r2").status, "queued_r2");
  checkThrows("afterRedo done throws", () => f.afterRedo("done"));
  check("afterResume(2) → queued_r2", f.afterResume(2).status, "queued_r2");

  const s = f.summarizeQueue([
    { status: "queued_r1" }, { status: "running_r2" }, { status: "review_r1" },
    { status: "review_r2" }, { status: "done" }, { status: "failed" }, { status: "skipped" },
  ]);
  check("summarize waitingBot (queued+running)", s.waitingBot, 2);
  check("summarize waitingUser (review_*)", s.waitingUser, 2);
  check("summarize done", s.done, 1);
  check("summarize failed", s.failed, 1);

  const now = new Date("2026-09-06T10:00:00Z");
  check("worker alive within 3× heartbeat", f.isWorkerAlive(new Date("2026-09-06T09:59:20Z"), now, 30000), true);
  check("worker dead after 3× heartbeat", f.isWorkerAlive(new Date("2026-09-06T09:58:00Z"), now, 30000), false);
  check("worker dead when never seen", f.isWorkerAlive(null, now, 30000), false);
  check("STEP_LABELS has click-generate", typeof f.STEP_LABELS["click-generate"], "string");
  check("DEFAULT_CAPTIONS round 1", f.DEFAULT_CAPTIONS[1], "สินค้า พื้นหลังขาว");
} finally {
  rmSync(out, { recursive: true, force: true });
}
if (failed > 0) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log("\nall checks passed");
```

Run: `node scripts/check-flow-jobs.mjs` → tsc fails: `lib/flow-jobs.ts` not found.

- [ ] **Step 5: Implement `lib/flow-jobs.ts`**

```ts
/**
 * ตรรกะ pure ของคิว Flow — ไม่มี Prisma ไม่มี node:* เพราะ client component ก็ import
 * (แนวเดียวกับ lib/entry-rows.ts) ทดสอบด้วย scripts/check-flow-jobs.mjs
 */
export const FLOW_STATUS = {
  QUEUED_R1: "queued_r1",
  RUNNING_R1: "running_r1",
  REVIEW_R1: "review_r1",
  QUEUED_R2: "queued_r2",
  RUNNING_R2: "running_r2",
  REVIEW_R2: "review_r2",
  DONE: "done",
  FAILED: "failed",
  SKIPPED: "skipped",
} as const;

export type FlowStatus = (typeof FLOW_STATUS)[keyof typeof FLOW_STATUS];
export type FlowRound = 1 | 2;

export const WORKER_STATE_ID = "singleton";

export function queuedStatus(round: FlowRound): FlowStatus {
  return round === 1 ? FLOW_STATUS.QUEUED_R1 : FLOW_STATUS.QUEUED_R2;
}
export function runningStatus(round: FlowRound): FlowStatus {
  return round === 1 ? FLOW_STATUS.RUNNING_R1 : FLOW_STATUS.RUNNING_R2;
}
export function reviewStatus(round: FlowRound): FlowStatus {
  return round === 1 ? FLOW_STATUS.REVIEW_R1 : FLOW_STATUS.REVIEW_R2;
}

/** รอบที่ status นี้อยู่ · done = 2 · failed/skipped ไม่รู้จากชื่อ (ใช้ job.round แทน) */
export function roundOf(status: string): FlowRound | null {
  if (status.endsWith("_r1")) return 1;
  if (status.endsWith("_r2") || status === FLOW_STATUS.DONE) return 2;
  return null;
}

/** ยังไม่จบ = entry นี้มีงานค้าง ห้ามเข้าคิวซ้ำ */
export function isOpenStatus(status: string): boolean {
  return status !== FLOW_STATUS.DONE && status !== FLOW_STATUS.SKIPPED;
}

/** พรอมต์ตายตัว (spec §3) — worker/flow-driver.ts มีสำเนาเดียวกัน ต้องแก้พร้อมกัน */
export function buildFlowPrompt(round: FlowRound, productName: string): string {
  return round === 1
    ? `ขอภาพสินค้าอย่างเดียวเท่านั้น พื้นหลังขาว สินค้าคือ "${productName}"`
    : `ขอภาพสินค้าตอนใช้งาน สินค้าคือ "${productName}"`;
}

export function candidateFilename(round: FlowRound, attempt: number, index: number, ext: "png" | "jpg"): string {
  return `r${round}-a${attempt}-${index}.${ext}`;
}
export function sourceFilename(index: number, ext: string): string {
  return `source-${index}.${ext}`;
}

export function afterChoose(status: string): { status: FlowStatus } {
  if (status === FLOW_STATUS.REVIEW_R1) return { status: FLOW_STATUS.QUEUED_R2 };
  if (status === FLOW_STATUS.REVIEW_R2) return { status: FLOW_STATUS.DONE };
  throw new Error("งานนี้ไม่ได้อยู่ในขั้นรอเลือกรูป");
}

export function afterRedo(status: string): { status: FlowStatus } {
  if (status === FLOW_STATUS.REVIEW_R1) return { status: FLOW_STATUS.QUEUED_R1 };
  if (status === FLOW_STATUS.REVIEW_R2) return { status: FLOW_STATUS.QUEUED_R2 };
  throw new Error("วาดใหม่ได้เฉพาะงานที่รอเลือกรูป");
}

export function afterResume(round: FlowRound): { status: FlowStatus } {
  return { status: queuedStatus(round) };
}

export function summarizeQueue(jobs: { status: string }[]): {
  waitingBot: number;
  waitingUser: number;
  done: number;
  failed: number;
} {
  let waitingBot = 0, waitingUser = 0, done = 0, failed = 0;
  for (const j of jobs) {
    if (j.status.startsWith("queued_") || j.status.startsWith("running_")) waitingBot++;
    else if (j.status.startsWith("review_")) waitingUser++;
    else if (j.status === FLOW_STATUS.DONE) done++;
    else if (j.status === FLOW_STATUS.FAILED) failed++;
  }
  return { waitingBot, waitingUser, done, failed };
}

/** heartbeat หายเกิน 3 รอบ = ถือว่าบอทไม่อยู่แล้ว */
export function isWorkerAlive(lastSeenAt: Date | null, now: Date, heartbeatMs: number): boolean {
  if (lastSeenAt === null) return false;
  return now.getTime() - lastSeenAt.getTime() < heartbeatMs * 3;
}

export const DEFAULT_CAPTIONS: Record<FlowRound, string> = {
  1: "สินค้า พื้นหลังขาว",
  2: "สินค้าตอนใช้งาน",
};

export const STATUS_LABELS: Record<FlowStatus, string> = {
  queued_r1: "รอบอท · รอบ 1",
  running_r1: "บอทกำลังวาด · รอบ 1",
  review_r1: "รอคุณเลือก · รอบ 1 (พื้นหลังขาว)",
  queued_r2: "รอบอท · รอบ 2",
  running_r2: "บอทกำลังวาด · รอบ 2",
  review_r2: "รอคุณเลือก · รอบ 2 (ตอนใช้งาน)",
  done: "เสร็จ · 2 รูปอยู่ใน entry แล้ว",
  failed: "พัง",
  skipped: "ข้ามแล้ว",
};

export const STEP_LABELS: Record<string, string> = {
  "open-flow": "เปิดหน้า Flow",
  "ensure-project": "เปิด/สร้าง project",
  "switch-image-mode": "สลับเป็นโหมดรูป",
  "set-model": "เลือกโมเดล Nano Banana 2",
  "set-aspect-3-4": "ตั้งอัตราส่วน 3:4",
  "set-count-4": "ตั้งจำนวน ×4",
  "attach-reference": "แนบรูปอ้างอิง",
  "type-prompt": "พิมพ์พรอมต์",
  "click-generate": "กดสร้าง",
  "wait-results": "รอผล",
  dwell: "ดูผลก่อนโหลด",
  "download-4": "โหลด 4 รูป",
};

export const ERROR_KIND_LABELS: Record<string, string> = {
  selector_drift: "หาปุ่ม/ช่องไม่เจอ — Flow อาจเปลี่ยนหน้า",
  login_required: "session หลุด — ต้อง login ใหม่ด้วย flow-login.bat",
  captcha: "โดน captcha / ถูกปฏิเสธ (403) — พักอย่างน้อย 1 ชั่วโมงก่อนรันต่อ",
  generation_timeout: "รอผลนานเกินกำหนด",
  flow_error: "Flow แจ้ง error",
  download_failed: "โหลดรูปกลับไม่ครบ",
  worker_crash: "บอทล้มโดยไม่ทราบสาเหตุ",
  host_unsupported: "บัญชีอยู่บนโฮสต์ที่ยังไม่รองรับ",
};
```

- [ ] **Step 6: Run the check**

`node scripts/check-flow-jobs.mjs` → all PASS. Then `npx tsc --noEmit` → no errors.

- [ ] **Step 7: Document WAL in `CLAUDE.md`**

In the `## Database` section, after the bullet about `npx prisma migrate deploy`, add:
```
- **`dev.db` เปิด WAL แล้ว (2026-09-xx, เพื่อให้ worker ของ Flow bot กับ Next เขียนพร้อมกันได้)** — จะมี `dev.db-wal`/`dev.db-shm` ข้างๆ เสมอ **backup ต้องก๊อป 3 ไฟล์ด้วยกัน** หรือรัน `PRAGMA wal_checkpoint(TRUNCATE)` ก่อนก๊อป ไฟล์ db ใหม่ (เช่น `dev-test.db` ที่ก๊อปมา) ให้รัน `node scripts/enable-wal.mjs <file>` หนึ่งครั้ง
```
(replace `xx` with the real date.)

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations scripts/enable-wal.mjs lib/flow-jobs.ts scripts/check-flow-jobs.mjs CLAUDE.md
git commit -m "Add FlowJob tables, WAL script and pure flow-jobs logic

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ajzf2iLhcMZZnYu7Mru6fQ"
```

---

### Task 7: Server-side reads (`lib/flow-queries.ts`) and Server Actions

**Files:**
- Create: `lib/flow-queries.ts`
- Modify: `app/actions.ts` (append at end of file)
- Modify: `app/api/uploads/[...path]/route.ts` (serve evidence text files)

**Interfaces:**
- Produces:
  - `type FlowImageRow = { id: string; kind: string; round: number; attempt: number; index: number; filename: string; chosen: boolean }`
  - `type FlowJobRow = { id; entryId; productName; status; round; attempt; failedStep; errorKind; errorMessage; failureDir; createdAt; updatedAt; startedAt; finishedAt; sources: FlowImageRow[]; candidates: FlowImageRow[]; chosenRound1: FlowImageRow | null; chosenRound2: FlowImageRow | null }`
  - `type FlowWorkerView = { alive: boolean; lastSeenAt: Date | null; pausedReason: string; pausedAt: Date | null; todayBatches: number; dailyBatchCap: number; nextWakeAt: Date | null; currentJobId: string | null }`
  - `getFlowQueueData(): Promise<{ jobs: FlowJobRow[]; worker: FlowWorkerView; summary: ReturnType<typeof summarizeQueue> }>`
  - `getOpenFlowJobForEntry(entryId): Promise<{ id: string; status: string; round: number; attempt: number } | null>`
  - Server Actions: `enqueueFlowJob(formData: FormData): Promise<string>` (returns jobId) · `chooseFlowCandidate(jobId: string, imageId: string): Promise<void>` · `redoFlowRound(jobId: string): Promise<void>` · `resumeFlowWorker(jobId: string): Promise<void>` · `skipFlowJob(jobId: string): Promise<void>`

- [ ] **Step 1: `lib/flow-queries.ts`**

```ts
import { prisma } from "@/lib/prisma";
import { loadWorkerConfig } from "@/worker/config";
import { FLOW_STATUS, WORKER_STATE_ID, isWorkerAlive, summarizeQueue } from "@/lib/flow-jobs";

export type FlowImageRow = {
  id: string;
  kind: string;
  round: number;
  attempt: number;
  index: number;
  filename: string;
  chosen: boolean;
};

export type FlowJobRow = {
  id: string;
  entryId: string;
  productName: string;
  status: string;
  round: number;
  attempt: number;
  failedStep: string;
  errorKind: string;
  errorMessage: string;
  failureDir: string;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  sources: FlowImageRow[];
  /** candidate ของรอบ/attempt ปัจจุบันเท่านั้น (attempt เก่าเก็บไว้ในตาราง ไม่โชว์) */
  candidates: FlowImageRow[];
  chosenRound1: FlowImageRow | null;
  chosenRound2: FlowImageRow | null;
};

export type FlowWorkerView = {
  alive: boolean;
  lastSeenAt: Date | null;
  pausedReason: string;
  pausedAt: Date | null;
  todayBatches: number;
  dailyBatchCap: number;
  nextWakeAt: Date | null;
  currentJobId: string | null;
};

const DONE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** ลำดับแสดง: รอคุณเลือกก่อน (คนต้องทำ) → พัง → รอบอท/กำลังทำ → เสร็จ/ข้าม */
function rank(status: string): number {
  if (status.startsWith("review_")) return 0;
  if (status === FLOW_STATUS.FAILED) return 1;
  if (status.startsWith("queued_") || status.startsWith("running_")) return 2;
  return 3;
}

export async function getFlowQueueData(): Promise<{
  jobs: FlowJobRow[];
  worker: FlowWorkerView;
  summary: ReturnType<typeof summarizeQueue>;
}> {
  const since = new Date(Date.now() - DONE_WINDOW_MS);
  const [raw, state] = await Promise.all([
    prisma.flowJob.findMany({
      where: {
        OR: [
          { status: { notIn: [FLOW_STATUS.DONE, FLOW_STATUS.SKIPPED] } },
          { updatedAt: { gte: since } },
        ],
      },
      include: {
        entry: { select: { productName: true } },
        images: { orderBy: [{ round: "asc" }, { attempt: "asc" }, { index: "asc" }] },
      },
    }),
    prisma.flowWorkerState.findUnique({ where: { id: WORKER_STATE_ID } }),
  ]);

  const jobs: FlowJobRow[] = raw
    .map((j) => {
      const imgs: FlowImageRow[] = j.images.map((i) => ({
        id: i.id, kind: i.kind, round: i.round, attempt: i.attempt, index: i.index, filename: i.filename, chosen: i.chosen,
      }));
      return {
        id: j.id,
        entryId: j.entryId,
        productName: j.entry.productName,
        status: j.status,
        round: j.round,
        attempt: j.attempt,
        failedStep: j.failedStep,
        errorKind: j.errorKind,
        errorMessage: j.errorMessage,
        failureDir: j.failureDir,
        createdAt: j.createdAt,
        updatedAt: j.updatedAt,
        startedAt: j.startedAt,
        finishedAt: j.finishedAt,
        sources: imgs.filter((i) => i.kind === "source"),
        candidates: imgs.filter((i) => i.kind === "candidate" && i.round === j.round && i.attempt === j.attempt),
        chosenRound1: imgs.find((i) => i.kind === "candidate" && i.round === 1 && i.chosen) ?? null,
        chosenRound2: imgs.find((i) => i.kind === "candidate" && i.round === 2 && i.chosen) ?? null,
      };
    })
    .sort((a, b) => rank(a.status) - rank(b.status) || a.createdAt.getTime() - b.createdAt.getTime());

  const cfg = loadWorkerConfig();
  const now = new Date();
  const worker: FlowWorkerView = {
    alive: isWorkerAlive(state?.lastSeenAt ?? null, now, cfg.heartbeatMs),
    lastSeenAt: state?.lastSeenAt ?? null,
    pausedReason: state?.pausedReason ?? "",
    pausedAt: state?.pausedAt ?? null,
    todayBatches: state?.todayBatches ?? 0,
    dailyBatchCap: cfg.dailyBatchCap,
    nextWakeAt: state?.nextWakeAt ?? null,
    currentJobId: state?.currentJobId ?? null,
  };

  return { jobs, worker, summary: summarizeQueue(jobs) };
}

export async function getOpenFlowJobForEntry(
  entryId: string
): Promise<{ id: string; status: string; round: number; attempt: number } | null> {
  const job = await prisma.flowJob.findFirst({
    where: { entryId, status: { notIn: [FLOW_STATUS.DONE, FLOW_STATUS.SKIPPED] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, round: true, attempt: true },
  });
  return job;
}
```

- [ ] **Step 2: Serve evidence text files** — in `app/api/uploads/[...path]/route.ts` extend `MIME_BY_EXT`:

```ts
const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
  // หลักฐานตอน Flow bot พัง (uploads/_flow-failures/) — เสิร์ฟเป็น text ล้วน ไม่ render HTML
  ".html": "text/plain; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".json": "text/plain; charset=utf-8",
};
```

- [ ] **Step 3: Append the Server Actions to `app/actions.ts`**

Add these imports near the top (keep existing ones):
```ts
import { copyFile } from "node:fs/promises";
import {
  DEFAULT_CAPTIONS,
  FLOW_STATUS,
  WORKER_STATE_ID,
  afterChoose,
  afterRedo,
  afterResume,
  isOpenStatus,
  sourceFilename,
  type FlowRound,
} from "@/lib/flow-jobs";
```
Append at the end of the file:
```ts
// ---------------------------------------------------------------------------
// Flow image bot (spec docs/superpowers/specs/2026-09-06-flow-image-bot-design.md)
// ทุก action ที่นี่แตะแค่ FlowJob/FlowJobImage/FlowWorkerState — ยกเว้น chooseFlowCandidate
// รอบ 2 ซึ่งเป็นที่เดียวที่สร้าง ProductImage (ก๊อป 2 ไฟล์ที่ผู้ใช้เลือก)
// ---------------------------------------------------------------------------

function extFromMime(mime: string): "png" | "webp" | "jpg" {
  return mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
}

/** อัปรูปแคปสินค้า + สร้างงาน queued_r1 — 1 entry มีงานค้างได้ทีละ 1 */
export async function enqueueFlowJob(formData: FormData): Promise<string> {
  const entryId = String(formData.get("entryId") ?? "").trim();
  if (!entryId) throw new Error("ไม่พบรายการที่ต้องการเข้าคิว Flow");
  const entry = await prisma.promptEntry.findUnique({ where: { id: entryId }, select: { id: true, productName: true } });
  if (!entry) throw new Error("ไม่พบรายการที่ต้องการเข้าคิว Flow");
  if (entry.productName.trim() === "") throw new Error("ต้องมีชื่อสินค้าก่อน (พรอมต์ของ Flow ใช้ชื่อสินค้า)");

  const open = await prisma.flowJob.findFirst({
    where: { entryId, status: { notIn: [FLOW_STATUS.DONE, FLOW_STATUS.SKIPPED] } },
    select: { id: true },
  });
  if (open) throw new Error("รายการนี้มีงาน Flow ค้างอยู่แล้ว");

  const files = formData.getAll("files").filter((v): v is File => v instanceof File && v.size > 0);
  if (files.length === 0) throw new Error("กรุณาเลือกรูปแคปสินค้าอย่างน้อย 1 รูป");
  for (const file of files) {
    // HEIC ไม่รับ — Flow อัปโหลดไม่ได้ และ Playwright ส่งไฟล์ตามที่เป็น
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("รองรับเฉพาะ JPEG, PNG, WebP");
    if (file.size > MAX_IMAGE_BYTES) throw new Error("ไฟล์ใหญ่เกิน 10MB");
  }

  const dir = path.join(UPLOAD_ROOT, entryId, "flow");
  await mkdir(dir, { recursive: true });

  const job = await prisma.flowJob.create({ data: { entryId, status: FLOW_STATUS.QUEUED_R1, round: 1, attempt: 1 } });
  for (const [index, file] of files.entries()) {
    const filename = sourceFilename(index, extFromMime(file.type));
    await writeFile(path.join(dir, filename), Buffer.from(await file.arrayBuffer()));
    await prisma.flowJobImage.create({
      data: { jobId: job.id, kind: "source", round: 0, attempt: 1, index, filename, mimeType: file.type },
    });
  }

  revalidatePath("/flow");
  revalidatePath(`/entry/${entryId}`);
  return job.id;
}

/**
 * ผู้ใช้เลือก 1 ใน 4 — รอบ 1 → เข้าคิวรอบ 2 · รอบ 2 → done และก๊อป 2 รูปที่เลือกเป็น ProductImage
 * (caption ตั้งต้นตาม DEFAULT_CAPTIONS แก้ได้ในหน้า entry เหมือนรูปที่อัปเอง)
 */
export async function chooseFlowCandidate(jobId: string, imageId: string): Promise<void> {
  const job = await prisma.flowJob.findUnique({ where: { id: jobId }, include: { images: true } });
  if (!job) throw new Error("ไม่พบงาน Flow");
  const image = job.images.find((i) => i.id === imageId);
  if (!image || image.kind !== "candidate" || image.round !== job.round || image.attempt !== job.attempt) {
    throw new Error("รูปที่เลือกไม่ใช่ของรอบปัจจุบัน");
  }
  const next = afterChoose(job.status);

  await prisma.$transaction(async (tx) => {
    await tx.flowJobImage.updateMany({
      where: { jobId, kind: "candidate", round: job.round },
      data: { chosen: false },
    });
    await tx.flowJobImage.update({ where: { id: imageId }, data: { chosen: true } });

    if (next.status === FLOW_STATUS.QUEUED_R2) {
      await tx.flowJob.update({ where: { id: jobId }, data: { status: next.status, round: 2, attempt: 1 } });
      return;
    }

    // done: รูปที่เลือกรอบ 1 + รูปนี้ (รอบ 2) → ProductImage 2 แถว
    const round1 = job.images.find((i) => i.kind === "candidate" && i.round === 1 && i.chosen);
    if (!round1) throw new Error("ไม่พบรูปที่เลือกไว้ในรอบ 1");
    const existingCount = await tx.productImage.count({ where: { entryId: job.entryId } });
    const picks: { img: typeof image; round: FlowRound }[] = [
      { img: round1, round: 1 },
      { img: image, round: 2 },
    ];
    for (const [i, { img, round }] of picks.entries()) {
      const ext = path.extname(img.filename).slice(1) || "png";
      const filename = `${crypto.randomUUID()}.${ext}`;
      await copyFile(
        path.join(UPLOAD_ROOT, job.entryId, "flow", img.filename),
        path.join(UPLOAD_ROOT, job.entryId, filename)
      );
      await tx.productImage.create({
        data: {
          entryId: job.entryId,
          filename,
          mimeType: img.mimeType,
          caption: DEFAULT_CAPTIONS[round],
          sortOrder: existingCount + i,
        },
      });
    }
    await tx.flowJob.update({ where: { id: jobId }, data: { status: FLOW_STATUS.DONE, finishedAt: new Date() } });
  });

  revalidatePath("/flow");
  revalidatePath(`/entry/${job.entryId}`);
  revalidatePath("/");
}

/** "ไม่ผ่านสักรูป วาดใหม่" — พรอมต์เดิม attempt+1 · candidate เก่าเก็บไว้ (ข้อมูลว่าเพี้ยนบ่อยแค่ไหน) */
export async function redoFlowRound(jobId: string): Promise<void> {
  const job = await prisma.flowJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error("ไม่พบงาน Flow");
  const next = afterRedo(job.status);
  await prisma.flowJob.update({ where: { id: jobId }, data: { status: next.status, attempt: job.attempt + 1 } });
  revalidatePath("/flow");
  revalidatePath(`/entry/${job.entryId}`);
}

/** "รันต่อ (หลังซ่อม)" — งานที่พังกลับเข้าคิวรอบเดิม และปลดการหยุดของ worker */
export async function resumeFlowWorker(jobId: string): Promise<void> {
  const job = await prisma.flowJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error("ไม่พบงาน Flow");
  if (job.status !== FLOW_STATUS.FAILED) throw new Error("รันต่อได้เฉพาะงานที่พัง");
  const round = (job.round === 2 ? 2 : 1) as FlowRound;
  await prisma.$transaction([
    prisma.flowJob.update({
      where: { id: jobId },
      data: { status: afterResume(round).status, failedStep: "", errorKind: "", errorMessage: "", failureDir: "" },
    }),
    prisma.flowWorkerState.upsert({
      where: { id: WORKER_STATE_ID },
      create: { id: WORKER_STATE_ID, pausedReason: "", pausedAt: null },
      update: { pausedReason: "", pausedAt: null },
    }),
  ]);
  revalidatePath("/flow");
  revalidatePath(`/entry/${job.entryId}`);
}

/** "ข้าม" — ทิ้งงานที่พัง ปลดการหยุดของ worker ให้ทำงานอื่นต่อ */
export async function skipFlowJob(jobId: string): Promise<void> {
  const job = await prisma.flowJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error("ไม่พบงาน Flow");
  if (!isOpenStatus(job.status)) return;
  await prisma.$transaction([
    prisma.flowJob.update({ where: { id: jobId }, data: { status: FLOW_STATUS.SKIPPED, finishedAt: new Date() } }),
    prisma.flowWorkerState.upsert({
      where: { id: WORKER_STATE_ID },
      create: { id: WORKER_STATE_ID, pausedReason: "", pausedAt: null },
      update: { pausedReason: "", pausedAt: null },
    }),
  ]);
  revalidatePath("/flow");
  revalidatePath(`/entry/${job.entryId}`);
}
```

- [ ] **Step 4: Type-check and lint**

`npx tsc --noEmit` and `npm run lint` → clean. (If `@/worker/config` fails to resolve inside Next, the `paths` alias `@/*` → `./*` covers `worker/`; the file only uses `node:fs`/`node:path`, allowed in server files.)

- [ ] **Step 5: Commit**

```bash
git add lib/flow-queries.ts app/actions.ts "app/api/uploads/[...path]/route.ts"
git commit -m "Add Flow queue queries and server actions

enqueue / choose / redo / resume / skip — chooseFlowCandidate รอบ 2 คือที่เดียวที่สร้าง ProductImage

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ajzf2iLhcMZZnYu7Mru6fQ"
```

---

### Task 8: The worker loop (`worker/index.ts`) and launchers

**Files:**
- Create: `worker/index.ts`
- Create: `flow-worker.bat`, `flow-worker-stop.bat`
- Modify: `.gitignore` (add `/flow-worker.log`, `/.flow-worker.stop`)

**Interfaces:**
- Consumes: everything from Tasks 1–6 plus `prisma` (`@/lib/prisma`).
- Behavior contract (spec §7.1, §7.4): heartbeat every `heartbeatMs`; claim `queued_r2` before `queued_r1`; pause on any `FlowStepError`; never retry; stop file `.flow-worker.stop` ends the loop between jobs.

- [ ] **Step 1: `worker/index.ts`**

```ts
/**
 * Flow image bot — โปรเซสแยกจาก Next.js คุยกันผ่านตาราง FlowJob/FlowWorkerState เท่านั้น
 * รัน: npm run flow-worker (หรือ flow-worker.bat) · หยุด: flow-worker-stop.bat (สร้างไฟล์ .flow-worker.stop
 * แล้ว worker จะจบหลังงานปัจจุบันเสร็จ — ไม่ฆ่ากลางคลิก)
 */
import "dotenv/config";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import {
  FLOW_STATUS, WORKER_STATE_ID, candidateFilename, queuedStatus, reviewStatus, runningStatus, type FlowRound,
} from "@/lib/flow-jobs";
import { loadWorkerConfig, type WorkerConfig } from "./config";
import { launchFlowBrowser, openFlowAndSettle } from "./browser";
import { selectorSetForHost, type SelectorSet } from "./flow-selectors";
import { runRound } from "./flow-driver";
import { StepLog, captureFailure } from "./failure";
import { FlowStepError, isFlowStepError, type ErrorKind } from "./errors";
import { randInt, sleepMs, sleepRange } from "./humanize";
import { isWithinActiveHours, localDateKey, msUntilActiveWindow, pickLongBreakTarget } from "./schedule";
import type { Page } from "playwright";

const UPLOAD_ROOT = path.join(process.cwd(), "uploads");
const STOP_FILE = path.join(process.cwd(), ".flow-worker.stop");
const SLEEP_CHUNK_MS = 20_000;

function log(msg: string): void {
  console.log(`${new Date().toISOString()}  ${msg}`);
}

async function upsertState(data: Record<string, unknown>) {
  await prisma.flowWorkerState.upsert({
    where: { id: WORKER_STATE_ID },
    create: { id: WORKER_STATE_ID, ...data },
    update: data,
  });
}

async function readState() {
  return prisma.flowWorkerState.findUnique({ where: { id: WORKER_STATE_ID } });
}

function stopRequested(): boolean {
  return existsSync(STOP_FILE);
}

/** นอนเป็นช่วงสั้นๆ เพื่อให้ heartbeat/ตรวจ stop/ตรวจ pause ยังทำงานระหว่างพักยาว */
async function sleepUntil(target: number): Promise<void> {
  while (Date.now() < target) {
    if (stopRequested()) return;
    await sleepMs(Math.min(SLEEP_CHUNK_MS, target - Date.now()));
  }
}

async function pauseWorker(reason: ErrorKind): Promise<void> {
  await upsertState({ pausedReason: reason, pausedAt: new Date(), currentJobId: null, nextWakeAt: null });
}

/** หยิบงาน: รอบ 2 ก่อน (คนรออยู่) แล้วค่อยรอบ 1 เรียงตามเวลาเข้าคิว — claim ด้วย updateMany กันหยิบซ้ำ */
async function claimNextJob() {
  for (const round of [2, 1] as FlowRound[]) {
    const candidate = await prisma.flowJob.findFirst({
      where: { status: queuedStatus(round) },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!candidate) continue;
    const claimed = await prisma.flowJob.updateMany({
      where: { id: candidate.id, status: queuedStatus(round) },
      data: { status: runningStatus(round), startedAt: new Date(), failedStep: "", errorKind: "", errorMessage: "", failureDir: "" },
    });
    if (claimed.count === 1) {
      return prisma.flowJob.findUniqueOrThrow({ where: { id: candidate.id }, include: { entry: true, images: true } });
    }
  }
  return null;
}

type ClaimedJob = NonNullable<Awaited<ReturnType<typeof claimNextJob>>>;

function referencePathFor(job: ClaimedJob): string {
  const dir = path.join(UPLOAD_ROOT, job.entryId, "flow");
  if (job.round === 1) {
    const src = job.images.filter((i) => i.kind === "source").sort((a, b) => a.index - b.index)[0];
    if (!src) throw new FlowStepError("open-flow", "worker_crash", "งานนี้ไม่มีรูปแคปต้นทาง");
    return path.join(dir, src.filename);
  }
  const chosen = job.images.find((i) => i.kind === "candidate" && i.round === 1 && i.chosen);
  if (!chosen) throw new FlowStepError("open-flow", "worker_crash", "งานนี้ยังไม่ได้เลือกรูปรอบ 1");
  return path.join(dir, chosen.filename);
}

async function processJob(page: Page, job: ClaimedJob, cfg: WorkerConfig, sel: SelectorSet, lastBatchAt: number): Promise<boolean> {
  const round = (job.round === 2 ? 2 : 1) as FlowRound;
  const outDir = path.join(UPLOAD_ROOT, job.entryId, "flow");
  mkdirSync(outDir, { recursive: true });
  const stepLog = new StepLog(true);
  await upsertState({ currentJobId: job.id, nextWakeAt: null });
  log(`เริ่มงาน ${job.id} (${job.entry.productName}) รอบ ${round} attempt ${job.attempt}`);

  try {
    const result = await runRound(
      page,
      {
        round,
        productName: job.entry.productName,
        referencePath: referencePathFor(job),
        outDir,
        filePrefix: `r${round}-a${job.attempt}`,
        // ถ้า spike (Task 5) พบว่ารอบ 2 เปิด project เดิมไม่ได้ ให้เปลี่ยนบรรทัดนี้เป็น null เสมอ
        projectId: job.flowProjectId || null,
      },
      cfg,
      sel,
      stepLog,
      // hook ทดสอบ fail-fast (S4) — ไม่ตั้ง env = ไม่มีผล
      { forceFailStep: process.env.FLOW_FORCE_FAIL_STEP }
    );

    await prisma.$transaction(async (tx) => {
      for (const [index, file] of result.files.entries()) {
        const ext = path.extname(file).slice(1) === "jpg" ? "jpg" : "png";
        await tx.flowJobImage.create({
          data: {
            jobId: job.id,
            kind: "candidate",
            round,
            attempt: job.attempt,
            index,
            filename: candidateFilename(round, job.attempt, index, ext),
            mimeType: ext === "jpg" ? "image/jpeg" : "image/png",
          },
        });
      }
      await tx.flowJob.update({
        where: { id: job.id },
        data: { status: reviewStatus(round), flowProjectId: result.projectId },
      });
    });
    log(`งาน ${job.id} รอบ ${round} เสร็จ → รอผู้ใช้เลือก`);
    return true;
  } catch (e) {
    const step = isFlowStepError(e) ? e.step : "unknown";
    const kind: ErrorKind = isFlowStepError(e) ? e.kind : "worker_crash";
    const message = e instanceof Error ? e.message : String(e);
    const state = await readState();
    const failureDirAbs = path.join(UPLOAD_ROOT, "_flow-failures", `${job.id}-${Date.now()}`);
    await captureFailure({
      page, dir: failureDirAbs, step, kind, message, log: stepLog,
      state: {
        jobId: job.id, round, attempt: job.attempt,
        todayBatches: state?.todayBatches ?? 0,
        sessionStreak: state?.sessionStreak ?? 0,
        msSinceLastBatch: lastBatchAt > 0 ? Date.now() - lastBatchAt : null,
      },
    });
    await prisma.flowJob.update({
      where: { id: job.id },
      data: {
        status: FLOW_STATUS.FAILED, failedStep: step, errorKind: kind, errorMessage: message.slice(0, 2000),
        failureDir: path.relative(process.cwd(), failureDirAbs).split(path.sep).join("/"),
      },
    });
    await pauseWorker(kind);
    log(`งาน ${job.id} พังที่ ${step} (${kind}) — หยุดทั้งคิว หลักฐาน: ${failureDirAbs}`);
    return false;
  }
}

async function main() {
  const cfg = loadWorkerConfig();
  if (existsSync(STOP_FILE)) unlinkSync(STOP_FILE);

  // งานที่ค้าง running_* = worker รอบก่อนตายกลางคัน → พัง ไม่ reset เป็น queued เอง (กัน loop)
  const stale = await prisma.flowJob.updateMany({
    where: { status: { in: [FLOW_STATUS.RUNNING_R1, FLOW_STATUS.RUNNING_R2] } },
    data: { status: FLOW_STATUS.FAILED, failedStep: "unknown", errorKind: "worker_crash", errorMessage: "worker ตายกลางคันในรอบก่อน" },
  });
  if (stale.count > 0) {
    await pauseWorker("worker_crash");
    log(`พบงานค้าง running ${stale.count} งาน → failed + หยุดคิว รอผู้ใช้กดรันต่อ`);
  }

  await upsertState({ lastSeenAt: new Date(), currentJobId: null });
  const heartbeat = setInterval(() => {
    upsertState({ lastSeenAt: new Date() }).catch((e) => log(`heartbeat ล้มเหลว: ${String(e)}`));
  }, cfg.heartbeatMs);

  const { context, page } = await launchFlowBrowser(cfg);
  let sel: SelectorSet;
  try {
    const { host } = await openFlowAndSettle(page, cfg);
    sel = selectorSetForHost(host);
    log(`เปิด Flow แล้ว host=${host} selectorSet=${sel.name}`);
  } catch (e) {
    await pauseWorker("host_unsupported");
    log(`เปิด Flow ไม่ได้: ${String(e)}`);
    clearInterval(heartbeat);
    await context.close();
    process.exit(1);
  }

  let longBreakTarget = pickLongBreakTarget(cfg.longBreakEvery);
  let lastBatchAt = 0;

  while (!stopRequested()) {
    const state = await readState();
    const now = new Date();

    if (state?.pausedReason) {
      await sleepMs(cfg.pollIdleMs);
      continue;
    }
    if (state?.todayDate !== localDateKey(now)) {
      await upsertState({ todayDate: localDateKey(now), todayBatches: 0 });
      continue;
    }
    if (!isWithinActiveHours(now, cfg.activeHours)) {
      const wake = Date.now() + msUntilActiveWindow(now, cfg.activeHours as [string, string]);
      await upsertState({ nextWakeAt: new Date(wake) });
      await sleepUntil(Math.min(wake, Date.now() + 5 * 60_000));
      continue;
    }
    if ((state?.todayBatches ?? 0) >= cfg.dailyBatchCap) {
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
      await upsertState({ nextWakeAt: midnight });
      await sleepUntil(Math.min(midnight.getTime(), Date.now() + 5 * 60_000));
      continue;
    }
    if ((state?.sessionStreak ?? 0) >= longBreakTarget) {
      const ms = randInt(cfg.longBreakMs);
      log(`พักยาว ${Math.round(ms / 60000)} นาที`);
      await upsertState({ nextWakeAt: new Date(Date.now() + ms), sessionStreak: 0 });
      await sleepUntil(Date.now() + ms);
      longBreakTarget = pickLongBreakTarget(cfg.longBreakEvery);
      continue;
    }

    const job = await claimNextJob();
    if (!job) {
      await upsertState({ nextWakeAt: null });
      await sleepMs(cfg.pollIdleMs);
      continue;
    }

    const ok = await processJob(page, job, cfg, sel, lastBatchAt);
    if (!ok) continue;

    lastBatchAt = Date.now();
    await prisma.flowWorkerState.update({
      where: { id: WORKER_STATE_ID },
      data: { currentJobId: null, todayBatches: { increment: 1 }, sessionStreak: { increment: 1 } },
    });

    const pause = randInt(cfg.betweenProductsMs);
    await upsertState({ nextWakeAt: new Date(Date.now() + pause) });
    await sleepUntil(Date.now() + pause);
  }

  log("ได้รับคำสั่งหยุด — ปิด browser");
  clearInterval(heartbeat);
  await upsertState({ currentJobId: null, nextWakeAt: null });
  await context.close();
  if (existsSync(STOP_FILE)) unlinkSync(STOP_FILE);
}

main().catch(async (e) => {
  log(`worker ล้ม: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  await pauseWorker("worker_crash").catch(() => undefined);
  process.exit(1);
});
```
Note: `betweenBatchesMs` from the config is intentionally unused here — with one submission per product per round, `betweenProductsMs` already spaces submissions; keep the key for the future video worker. Say so in a comment above `const pause`.

- [ ] **Step 2: Launchers**

`flow-worker.bat`:
```bat
@echo off
setlocal
cd /d "%~dp0"
if exist ".flow-worker.stop" del ".flow-worker.stop"
echo Starting Flow worker in background (log: flow-worker.log). Chrome window will open - do not close it.
start "Flow Worker" /min cmd /c "npm run flow-worker >> flow-worker.log 2>&1"
```
`flow-worker-stop.bat`:
```bat
@echo off
setlocal
cd /d "%~dp0"
echo stop > ".flow-worker.stop"
echo Stop requested. The worker finishes its current job (if any) and exits; watch flow-worker.log.
```
Append to `.gitignore`:
```
/flow-worker.log
/.flow-worker.stop
```

- [ ] **Step 3: Type-check** — `npx tsc --noEmit` clean.

- [ ] **Step 4: Dry run against `dev-test.db` (no Flow submission)**

```bash
cp dev.db dev-test.db && node scripts/enable-wal.mjs dev-test.db
DATABASE_URL="file:./dev-test.db" npm run flow-worker
```
Expected within ~15 s: log lines `เปิด Flow แล้ว host=… selectorSet=…`, then idle polling (no queued jobs). Check the state row:
```bash
npx prisma db execute --url "file:./dev-test.db" --stdin <<< "SELECT id, lastSeenAt, pausedReason, todayDate FROM FlowWorkerState;"
```
(if `--url` is not accepted by this Prisma version, write a 5-line `.js` in the scratchpad using better-sqlite3 via the repo's absolute `node_modules` path, per CLAUDE.md). Then `flow-worker-stop.bat` (or create `.flow-worker.stop`) → worker exits cleanly.

- [ ] **Step 5: Commit**

```bash
git add worker/index.ts flow-worker.bat flow-worker-stop.bat .gitignore
git commit -m "Add Flow worker loop with pacing, caps and fail-fast pause

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ajzf2iLhcMZZnYu7Mru6fQ"
```

---

### Task 9: The `/flow` page

**Files:**
- Modify: `components/app-header.tsx` (add nav item)
- Create: `app/flow/page.tsx`
- Create: `components/flow-route.tsx`
- Create: `components/flow-review-row.tsx`
- Create: `components/flow-lightbox.tsx`

**Interfaces:**
- Consumes: `getFlowQueueData`, `FlowJobRow`, `FlowWorkerView`, `chooseFlowCandidate`, `redoFlowRound`, `resumeFlowWorker`, `skipFlowJob`, `STATUS_LABELS`, `STEP_LABELS`, `ERROR_KIND_LABELS`, `FLOW_STATUS`, `Button`, `Badge`.
- Produces: `NavKey` gains `"flow"`.

- [ ] **Step 1: Nav item** — in `components/app-header.tsx`:

```ts
export type NavKey = "list" | "entry" | "core" | "dashboard" | "products" | "flow";

const NAV: { key: NavKey; href: string; label: string }[] = [
  { key: "list", href: "/", label: "รายการสินค้า" },
  { key: "products", href: "/products", label: "หาสินค้า" },
  { key: "flow", href: "/flow", label: "คิว Flow" },
  { key: "core", href: "/core-prompt", label: "Core Prompt" },
  { key: "dashboard", href: "/dashboard", label: "รายได้" },
];
```

- [ ] **Step 2: `app/flow/page.tsx`** (mirror `app/products/page.tsx`)

```tsx
import { getFlowQueueData } from "@/lib/flow-queries";
import { AppHeader } from "@/components/app-header";
import { FlowRoute } from "@/components/flow-route";

export const dynamic = "force-dynamic";

export default async function FlowPage() {
  const data = await getFlowQueueData();

  return (
    <div className="flex min-h-dvh flex-1 flex-col lg:h-dvh lg:overflow-hidden">
      <AppHeader active="flow" />
      <div className="flex flex-1 flex-col p-4 sm:p-6 lg:overflow-y-auto">
        <FlowRoute jobs={data.jobs} worker={data.worker} summary={data.summary} now={new Date()} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: `components/flow-lightbox.tsx`**

```tsx
"use client";

import { useEffect } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

import { Button } from "@/components/ui/button";

export type LightboxItem = { src: string; label: string };

/**
 * ขยายรูปเทียบกัน: ซ้าย = รูปแคปต้นทาง (คงที่) · ขวา = candidate ที่เลื่อนดูได้
 * ผู้ใช้ตัดสิน "แป๊ะไหม" ด้วยการเลื่อนดูไปมาระหว่างสองรูปนี้ (สัมภาษณ์ 2026-09-06)
 */
export function FlowLightbox({
  source,
  items,
  index,
  onIndexChange,
  onClose,
}: {
  source: LightboxItem;
  items: LightboxItem[];
  index: number;
  onIndexChange: (next: number) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") onIndexChange((index + 1) % items.length);
      if (e.key === "ArrowLeft") onIndexChange((index - 1 + items.length) % items.length);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, items.length, onClose, onIndexChange]);

  const current = items[index];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="เทียบรูปแคปกับรูปที่วาด"
      className="fixed inset-0 z-50 flex flex-col bg-background/95 p-3 sm:p-6"
      onClick={onClose}
    >
      <div className="flex items-center justify-between gap-2" onClick={(e) => e.stopPropagation()}>
        <p className="text-sm text-muted-foreground">
          ซ้าย: รูปแคปต้นทาง · ขวา: {current.label} ({index + 1}/{items.length}) — ลูกศร ←/→ เลื่อน · Esc ปิด
        </p>
        <Button type="button" variant="outline" size="icon" aria-label="ปิด" onClick={onClose}>
          <X />
        </Button>
      </div>
      <div className="mt-3 grid flex-1 grid-cols-1 gap-3 md:grid-cols-2" onClick={(e) => e.stopPropagation()}>
        <div className="relative min-h-0 overflow-hidden rounded-lg border border-border bg-surface">
          <Image src={source.src} alt={source.label} fill sizes="50vw" className="object-contain" />
        </div>
        <div className="relative min-h-0 overflow-hidden rounded-lg border border-border bg-surface">
          <Image src={current.src} alt={current.label} fill sizes="50vw" className="object-contain" />
          <div className="absolute inset-x-0 bottom-2 flex justify-center gap-2">
            <Button type="button" variant="secondary" size="icon" aria-label="รูปก่อนหน้า" onClick={() => onIndexChange((index - 1 + items.length) % items.length)}>
              <ChevronLeft />
            </Button>
            <Button type="button" variant="secondary" size="icon" aria-label="รูปถัดไป" onClick={() => onIndexChange((index + 1) % items.length)}>
              <ChevronRight />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: `components/flow-review-row.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { Check, RotateCcw, SkipForward, Play } from "lucide-react";

import { chooseFlowCandidate, redoFlowRound, resumeFlowWorker, skipFlowJob } from "@/app/actions";
import type { FlowJobRow, FlowImageRow } from "@/lib/flow-queries";
import { ERROR_KIND_LABELS, FLOW_STATUS, STATUS_LABELS, STEP_LABELS, type FlowStatus } from "@/lib/flow-jobs";
import { cn } from "@/lib/utils";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FlowLightbox } from "@/components/flow-lightbox";

function badgeVariant(status: string): BadgeVariant {
  if (status.startsWith("review_")) return "warning";
  if (status === FLOW_STATUS.DONE) return "success";
  if (status === FLOW_STATUS.FAILED) return "danger";
  return "neutral";
}

function imgUrl(entryId: string, filename: string): string {
  return `/api/uploads/${entryId}/flow/${filename}`;
}

function timeLabel(d: Date | null): string {
  if (d === null) return "";
  return d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
}

export function FlowReviewRow({ job }: { job: FlowJobRow }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isReview = job.status.startsWith("review_");
  const source = job.sources[0] ?? null;

  function run(action: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await action();
      } catch (e) {
        setError(e instanceof Error ? e.message : "ทำรายการไม่สำเร็จ");
      }
    });
  }

  const lightboxItems = job.candidates.map((c, i) => ({ src: imgUrl(job.entryId, c.filename), label: `รูป ${i + 1}` }));

  return (
    <li className="grid gap-4 border-b border-border py-4 md:grid-cols-[220px_1fr]">
      <div className="flex flex-col gap-1.5">
        <Link href={`/entry/${job.entryId}`} className="font-semibold leading-relaxed text-foreground hover:underline">
          {job.productName}
        </Link>
        <p className="text-xs leading-relaxed text-muted-foreground">
          เข้าคิว {timeLabel(job.createdAt)}
          {job.startedAt ? ` · เริ่มรอบ ${job.round} ${timeLabel(job.startedAt)}` : ""}
          {job.attempt > 1 ? ` · ครั้งที่ ${job.attempt}` : ""}
        </p>
        <div>
          <Badge variant={badgeVariant(job.status)}>{STATUS_LABELS[job.status as FlowStatus] ?? job.status}</Badge>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {isReview && (
          <>
            <div className="flex flex-wrap items-start gap-3">
              {source && (
                <figure className="flex w-24 flex-col gap-1">
                  <Image
                    src={imgUrl(job.entryId, source.filename)}
                    alt="รูปแคปต้นทาง"
                    width={400}
                    height={533}
                    className="aspect-[3/4] w-24 rounded-md border border-border object-cover"
                  />
                  <figcaption className="text-xs leading-relaxed text-muted-foreground">รูปแคป</figcaption>
                </figure>
              )}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {job.candidates.map((c: FlowImageRow, i: number) => (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={selected === c.id}
                    aria-label={`เลือกรูป ${i + 1}`}
                    onClick={() => setSelected(c.id)}
                    onDoubleClick={() => setLightbox(i)}
                    className={cn(
                      "relative w-28 overflow-hidden rounded-md border-2 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                      selected === c.id ? "border-primary" : "border-border-interactive"
                    )}
                  >
                    <Image
                      src={imgUrl(job.entryId, c.filename)}
                      alt={`รูปที่วาด ${i + 1}`}
                      width={400}
                      height={533}
                      className="aspect-[3/4] w-full object-cover"
                    />
                    {selected === c.id && (
                      <span className="absolute top-1 right-1 rounded-full bg-primary p-0.5 text-primary-foreground">
                        <Check className="size-4" />
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                disabled={selected === null || isPending}
                onClick={() => selected && run(() => chooseFlowCandidate(job.id, selected))}
              >
                {job.status === FLOW_STATUS.REVIEW_R1 ? "ใช้รูปนี้ → ให้บอทวาดรอบ 2" : "ใช้รูปนี้ → บันทึกเป็นรูปสินค้า"}
              </Button>
              <Button type="button" variant="outline" disabled={isPending} onClick={() => run(() => redoFlowRound(job.id))}>
                <RotateCcw data-icon="inline-start" /> ไม่ผ่านสักรูป วาดใหม่
              </Button>
              <Button type="button" variant="ghost" disabled={job.candidates.length === 0} onClick={() => setLightbox(0)}>
                ขยายเทียบกับรูปแคป
              </Button>
            </div>
          </>
        )}

        {job.status === FLOW_STATUS.FAILED && (
          <div className="flex flex-col gap-2 rounded-md border-l-4 border-status-danger bg-surface-2 p-3 leading-relaxed">
            <p className="text-sm font-medium text-foreground">
              พังที่ขั้น "{STEP_LABELS[job.failedStep] ?? job.failedStep}" — {ERROR_KIND_LABELS[job.errorKind] ?? job.errorKind}
            </p>
            {job.errorMessage && <p className="text-xs text-muted-foreground">{job.errorMessage}</p>}
            {job.failureDir && (
              <p className="text-xs text-muted-foreground">
                หลักฐาน:{" "}
                <a className="underline" href={`/api/${job.failureDir}/screenshot.png`} target="_blank" rel="noreferrer">screenshot</a>
                {" · "}
                <a className="underline" href={`/api/${job.failureDir}/steps.log`} target="_blank" rel="noreferrer">steps.log</a>
                {" · "}
                <a className="underline" href={`/api/${job.failureDir}/page.html`} target="_blank" rel="noreferrer">page.html</a>
                {" · โฟลเดอร์ "}<code className="text-xs">{job.failureDir}</code>
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={isPending} onClick={() => run(() => resumeFlowWorker(job.id))}>
                <Play data-icon="inline-start" /> รันต่อ (หลังซ่อม)
              </Button>
              <Button type="button" variant="outline" disabled={isPending} onClick={() => run(() => skipFlowJob(job.id))}>
                <SkipForward data-icon="inline-start" /> ข้ามงานนี้
              </Button>
            </div>
          </div>
        )}

        {job.status === FLOW_STATUS.DONE && (
          <div className="flex flex-wrap items-center gap-3">
            {[job.chosenRound1, job.chosenRound2].map((c, i) =>
              c ? (
                <Image
                  key={c.id}
                  src={imgUrl(job.entryId, c.filename)}
                  alt={i === 0 ? "รูปที่เลือก พื้นหลังขาว" : "รูปที่เลือก ตอนใช้งาน"}
                  width={400}
                  height={533}
                  className="aspect-[3/4] w-20 rounded-md border-2 border-status-success object-cover"
                />
              ) : null
            )}
            <Link href={`/entry/${job.entryId}`} className="text-sm text-primary underline-offset-4 hover:underline">
              ไปหน้า entry ใส่ caption / สกัดสเปก →
            </Link>
          </div>
        )}

        {(job.status.startsWith("queued_") || job.status.startsWith("running_")) && (
          <p className="text-sm leading-relaxed text-muted-foreground">
            {job.status.startsWith("running_") ? "บอทกำลังทำอยู่ตอนนี้" : "รอบอทหยิบงาน"}
          </p>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>

      {lightbox !== null && source && (
        <FlowLightbox
          source={{ src: imgUrl(job.entryId, source.filename), label: "รูปแคปต้นทาง" }}
          items={lightboxItems}
          index={lightbox}
          onIndexChange={setLightbox}
          onClose={() => setLightbox(null)}
        />
      )}
    </li>
  );
}
```
Note the failure links: `job.failureDir` is `uploads/_flow-failures/<id>` (relative, forward slashes) and the route is `/api/uploads/...`, so `/api/${failureDir}/...` resolves correctly.

- [ ] **Step 5: `components/flow-route.tsx`**

```tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import type { FlowJobRow, FlowWorkerView } from "@/lib/flow-queries";
import { ERROR_KIND_LABELS, summarizeQueue } from "@/lib/flow-jobs";
import { cn } from "@/lib/utils";
import { FlowReviewRow } from "@/components/flow-review-row";

const REFRESH_MS = 30_000;

function minutesAgo(d: Date | null, now: Date): string {
  if (d === null) return "ไม่เคยเห็น";
  const m = Math.max(0, Math.round((now.getTime() - d.getTime()) / 60000));
  return m === 0 ? "เมื่อครู่" : `${m} นาทีก่อน`;
}

function minutesUntil(d: Date | null, now: Date): string | null {
  if (d === null) return null;
  const m = Math.round((d.getTime() - now.getTime()) / 60000);
  return m <= 0 ? "กำลังจะหยิบงานถัดไป" : `อีก ~${m} นาทีจะหยิบงานถัดไป`;
}

export function FlowRoute({
  jobs,
  worker,
  summary,
  now,
}: {
  jobs: FlowJobRow[];
  worker: FlowWorkerView;
  summary: ReturnType<typeof summarizeQueue>;
  now: Date;
}) {
  const router = useRouter();

  // หน้านี้อ่านสถานะที่ worker (คนละโปรเซส) เขียน — ไม่มี revalidatePath จากฝั่งนั้น จึง refresh เอง
  useEffect(() => {
    const id = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(id);
  }, [router]);

  const paused = worker.pausedReason !== "";
  const wake = minutesUntil(worker.nextWakeAt, now);

  return (
    <section className="flex flex-col gap-4">
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3 leading-relaxed",
          paused ? "bg-surface-2" : "bg-surface"
        )}
        aria-live="polite"
      >
        <div className="flex items-center gap-2 text-sm">
          <span
            aria-hidden="true"
            className={cn("size-2.5 shrink-0 rounded-full", paused ? "bg-status-danger" : worker.alive ? "bg-status-success" : "bg-status-neutral")}
          />
          {paused ? (
            <span className="font-medium text-foreground">
              บอทหยุดแล้ว — {ERROR_KIND_LABELS[worker.pausedReason] ?? worker.pausedReason}
              {worker.pausedAt ? ` (หยุดเมื่อ ${minutesAgo(worker.pausedAt, now)})` : ""}
            </span>
          ) : worker.alive ? (
            <span className="text-foreground">
              บอททำงานอยู่ · เห็นล่าสุด {minutesAgo(worker.lastSeenAt, now)} · วันนี้วาดไป {worker.todayBatches}/{worker.dailyBatchCap} ชุด
              {wake ? ` · ${wake}` : ""}
            </span>
          ) : (
            <span className="text-muted-foreground">
              บอทไม่ได้เปิดอยู่ (เห็นล่าสุด {minutesAgo(worker.lastSeenAt, now)}) — เปิดด้วย flow-worker.bat
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          รอบอท {summary.waitingBot} · รอคุณเลือก {summary.waitingUser} · เสร็จ {summary.done} · พัง {summary.failed}
        </p>
      </div>

      {jobs.length === 0 ? (
        <p className="text-sm leading-relaxed text-muted-foreground">
          ยังไม่มีงานในคิว — ไปที่หน้า entry ของสินค้า อัปรูปแคป แล้วกด "เข้าคิว Flow"
        </p>
      ) : (
        <ul className="flex flex-col">
          {jobs.map((job) => (
            <FlowReviewRow key={job.id} job={job} />
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 6: Type-check, lint, contrast**

`npx tsc --noEmit` · `npm run lint` · `node scripts/check-contrast.mjs` → all clean (no new colors were introduced; if lint complains about `<a>` for `/api/...` links, they are file downloads not routes — add `// eslint-disable-next-line @next/next/no-html-link-for-pages` above each).

- [ ] **Step 7: Visual check on the isolated dev server**

```bash
cp dev.db dev-test.db && node scripts/enable-wal.mjs dev-test.db
NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001
```
Open `http://localhost:3001/flow` with the Playwright MCP browser (or `scripts/shot.mjs`, Task 11) at 1440 and 390 px. Seed one job to see a review row: run the worker against `dev-test.db` for one product from the spare account (Task 11 does this fully) — or, for layout only, insert rows by hand with a scratch `.js` using better-sqlite3 (absolute `node_modules` path per CLAUDE.md) pointing the `filename`s at the S2 output files copied into `uploads/<entryId>/flow/`. Then `git checkout -- tsconfig.json` if it changed.

- [ ] **Step 8: Commit**

```bash
git add components/app-header.tsx app/flow/page.tsx components/flow-route.tsx components/flow-review-row.tsx components/flow-lightbox.tsx
git commit -m "Add /flow queue page with review rows and compare lightbox

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ajzf2iLhcMZZnYu7Mru6fQ"
```

---

### Task 10: Entry page — upload source screenshots and enqueue

**Files:**
- Create: `components/flow-enqueue-panel.tsx`
- Modify: `components/entry-workspace.tsx` (new prop + render)
- Modify: `app/entry/[id]/page.tsx`, `app/entry/new/page.tsx`

**Interfaces:**
- Consumes: `enqueueFlowJob`, `getOpenFlowJobForEntry`, `STATUS_LABELS`.
- Produces: `EntryWorkspace` prop `flowJob: { id: string; status: string; round: number; attempt: number } | null`.

- [ ] **Step 1: `components/flow-enqueue-panel.tsx`**

```tsx
"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ImagePlus, Send, X } from "lucide-react";

import { enqueueFlowJob } from "@/app/actions";
import { STATUS_LABELS, type FlowStatus } from "@/lib/flow-jobs";
import { Button } from "@/components/ui/button";

const ALLOWED = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 10 * 1024 * 1024;

export type FlowJobSummary = { id: string; status: string; round: number; attempt: number };

/**
 * แผง "รูปแคปสินค้า → Flow" — รูปชุดนี้คือแคปดิบจาก TikTok Shop ที่จะส่งให้บอทแนบเข้า Flow
 * ไม่ใช่ ProductImage (รูปอ้างอิงที่ AI อ่าน) — สองอย่างนี้คนละตาราง คนละโฟลเดอร์
 */
export function FlowEnqueuePanel({
  entryId,
  productName,
  job,
}: {
  entryId: string;
  productName: string;
  job: FlowJobSummary | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  const canEnqueue = productName.trim() !== "" && files.length > 0 && !isPending;

  function addFiles(list: FileList | null) {
    if (!list) return;
    const picked = Array.from(list);
    if (picked.some((f) => !ALLOWED.includes(f.type))) return setError("รองรับเฉพาะ JPEG, PNG, WebP");
    if (picked.some((f) => f.size > MAX_BYTES)) return setError("ไฟล์ใหญ่เกิน 10MB");
    setError(null);
    setFiles((prev) => [...prev, ...picked]);
  }

  function submit() {
    const formData = new FormData();
    formData.set("entryId", entryId);
    for (const f of files) formData.append("files", f);
    startTransition(async () => {
      try {
        await enqueueFlowJob(formData);
        setFiles([]);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "เข้าคิวไม่สำเร็จ");
      }
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <h3 className="text-sm font-semibold leading-relaxed text-foreground">รูปแคปสินค้า → ให้บอทวาดใน Flow</h3>

      {job ? (
        <p className="text-sm leading-relaxed text-muted-foreground">
          สถานะ: {STATUS_LABELS[job.status as FlowStatus] ?? job.status}
          {job.attempt > 1 ? ` (ครั้งที่ ${job.attempt})` : ""} ·{" "}
          <Link href="/flow" className="text-primary underline-offset-4 hover:underline">ไปหน้าคิว Flow</Link>
        </p>
      ) : (
        <>
          <p className="text-xs leading-relaxed text-muted-foreground">
            แคปรูปสินค้าจาก TikTok Shop (รูปแรกจะถูกแนบเข้า Flow) — บอทจะวาดพื้นหลังขาว 4 รูปให้เลือก แล้ววาดตอนใช้งานต่อ
          </p>
          {productName.trim() === "" && (
            <p className="text-xs text-destructive">ต้องมีชื่อสินค้าก่อน (สกัดจากแคปหน้าสินค้า หรือพิมพ์เอง)</p>
          )}
          <div className="flex flex-wrap gap-2">
            {previews.map((src, i) => (
              <div key={src} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`รูปแคป ${i + 1}`} className="size-20 rounded-md border border-border object-cover" />
                <Button
                  type="button"
                  variant="destructive"
                  size="icon-xs"
                  aria-label="เอารูปออก"
                  className="absolute -top-1.5 -right-1.5 rounded-full"
                  onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                >
                  <X className="size-3" />
                </Button>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => inputRef.current?.click()}>
              <ImagePlus data-icon="inline-start" /> เลือกรูปแคป
            </Button>
            <Button type="button" disabled={!canEnqueue} onClick={submit}>
              <Send data-icon="inline-start" /> เข้าคิว Flow
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
        </>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </section>
  );
}
```

- [ ] **Step 2: Wire it into `components/entry-workspace.tsx`**

Add to imports: `import { FlowEnqueuePanel, type FlowJobSummary } from "@/components/flow-enqueue-panel";`
Add prop to the component signature (next to `usedAngles`): `flowJob: FlowJobSummary | null;`
Render it as the first child of the right column (before `ProductSpecPanel`):
```tsx
              <div className="flex flex-1 flex-col gap-5">
                {entry !== null && (
                  <FlowEnqueuePanel entryId={entry.id} productName={form.productName} job={flowJob} />
                )}
                {entry !== null && (
                  <ProductSpecPanel
```

- [ ] **Step 3: Pages** — `app/entry/[id]/page.tsx`:
```ts
import { getOpenFlowJobForEntry } from "@/lib/flow-queries";
// ...
  const [entry, rows, usedAngles, flowJob] = await Promise.all([
    getEntryDetail(id),
    getEntryRows(),
    getUsedAngles(id),
    getOpenFlowJobForEntry(id),
  ]);
// ...
    <EntryWorkspace entry={entry} rows={railRows} usedAngles={usedAngles} flowJob={flowJob} />
```
`app/entry/new/page.tsx`: add `flowJob={null}`.

- [ ] **Step 4: Type-check, lint, visual check at 1440 (entry page desktop layout must look the same apart from the new card in the right column)**

`npx tsc --noEmit` · `npm run lint` · dev server on 3001 with `dev-test.db` → `/entry/<id>` — the card appears above "สเปกสินค้า"; upload a PNG, click "เข้าคิว Flow" → card switches to the status line with a link; `/flow` shows the job as "รอบอท · รอบ 1". `git checkout -- tsconfig.json` if changed.

- [ ] **Step 5: Commit**

```bash
git add components/flow-enqueue-panel.tsx components/entry-workspace.tsx "app/entry/[id]/page.tsx" app/entry/new/page.tsx
git commit -m "Add Flow enqueue panel to the entry page

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ajzf2iLhcMZZnYu7Mru6fQ"
```

---

### Task 11: End-to-end on the spare account, responsive shots, docs, wrap-up

**Files:**
- Modify: `scripts/shot.mjs` (add `/flow`)
- Modify: `CLAUDE.md` (new section)
- Modify: `docs/superpowers/specs/2026-09-06-flow-image-bot-design.md` (append E2E result)

- [ ] **Step 1: Add the page to the responsive shot list** — in `scripts/shot.mjs` `PAGES`, after `products`:
```js
  { name: "flow", path: "/flow" },
```

- [ ] **Step 2: Full E2E on `dev-test.db` (never `dev.db`)**

1. `cp dev.db dev-test.db && node scripts/enable-wal.mjs dev-test.db`
2. Start the app: `NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001`
3. In the browser: open an existing entry that has a `productName`, upload 1 real product screenshot in the new card, click "เข้าคิว Flow". `/flow` shows "รอบอท · รอบ 1".
4. Start the worker against the same DB: `DATABASE_URL="file:./dev-test.db" npm run flow-worker` (foreground, so you see the log). Expected: within ~1 min the job goes `running_r1` → (a few minutes) `review_r1`; `/flow` (auto-refresh 30 s) shows the screenshot + 4 candidates.
5. Select one → "ใช้รูปนี้ → ให้บอทวาดรอบ 2". Job → `queued_r2`; worker (after `betweenProductsMs`) → `running_r2` → `review_r2`.
6. Select one → "ใช้รูปนี้ → บันทึกเป็นรูปสินค้า". Job → `done`; open the entry: 2 new product images with captions "สินค้า พื้นหลังขาว" / "สินค้าตอนใช้งาน"; `uploads/<entryId>/` has the 2 copied files.
7. Stop the worker (`.flow-worker.stop` or Ctrl+C). Verify `FlowWorkerState.todayBatches` = 2 (scratch `.js` + better-sqlite3 per CLAUDE.md).
8. Fail path: enqueue another entry, start the worker with `FLOW_FORCE_FAIL_STEP=set-model DATABASE_URL="file:./dev-test.db" npm run flow-worker` (the worker passes this env to `runRound` — Task 8). Expected: `/flow` shows the red bar "บอทหยุดแล้ว — หาปุ่ม/ช่องไม่เจอ", the row shows step "เลือกโมเดล Nano Banana 2", evidence links open (`screenshot.png` renders, `steps.log` plain text). Click "รันต่อ" with the env unset worker restarted → job completes.
9. Delete the test rows you created **with a WHERE on their ids** from `dev-test.db` only if you want to reuse it; `dev-test.db` is disposable anyway.

- [ ] **Step 3: Responsive screenshots**

```bash
PW_ROOT=<scratch>/pw BASE_URL=http://localhost:3001 ENTRY_ID=<cuid from dev-test.db> node scripts/shot.mjs <scratch>/shots
```
(If no separate `PW_ROOT` install exists, install one in the scratch dir: `mkdir -p <scratch>/pw && cd <scratch>/pw && npm init -y && npm i playwright@1.63.0 && npx playwright install chromium`.) Expected: no `FAIL` lines (no horizontal scroll at 390/820/1440). Look at `flow-1440.png`, `flow-390.png`, `entry-1440.png` with the Read tool: candidates grid 4-across on desktop, 2-across on phone; the 1440 entry layout unchanged apart from the new card.

- [ ] **Step 4: Document in `CLAUDE.md`** — add a section after `## Dashboard รายได้ (แท็บ ④)`:

```markdown
## Flow image bot (หน้า `/flow` + `worker/`)

- spec: `docs/superpowers/specs/2026-09-06-flow-image-bot-design.md` · แผน: `docs/superpowers/plans/2026-09-06-flow-image-bot.md`
- **บอทเป็นโปรเซสแยกจาก Next** (`worker/index.ts` เปิดด้วย `flow-worker.bat` หยุดด้วย `flow-worker-stop.bat` ซึ่งสร้างไฟล์ `.flow-worker.stop` ให้บอทจบเองหลังงานปัจจุบัน) คุยกับเว็บผ่านตาราง `FlowJob`/`FlowJobImage`/`FlowWorkerState` เท่านั้น — `/flow` refresh ตัวเองทุก 30 วิ เพราะ worker เรียก `revalidatePath` ไม่ได้
- **login ต้องผ่าน `flow-login.bat` (Chrome จริง ไม่ผ่าน Playwright)** ด้วยบัญชี Flow **สำรอง** เท่านั้น แล้วปิด Chrome ก่อนเปิด worker — Google ปฏิเสธ sign-in จาก browser ที่ automation เปิด โปรไฟล์อยู่ `.flow-profile/` (gitignore)
- **selector ทั้งหมดอยู่ `worker/flow-selectors.ts` ไฟล์เดียว** มี 2 ชุด (`labs` = labs.google ยืนยันแล้ว · `migrated` = flow.google.com ยังเป็นคำใบ้) — Flow เปลี่ยนหน้าเมื่อไหร่ บอทจะพังที่ขั้นแรกที่หา element ไม่เจอ พร้อมหลักฐานใน `uploads/_flow-failures/<jobId>-<ts>/` (screenshot.png / page.html / steps.log / state.json) ให้แก้ selector ของขั้นนั้นแล้วยืนยันด้วย `npm run flow-smoke:s2 -- <รูป> "<ชื่อสินค้า>"` ก่อนกด "รันต่อ" ใน `/flow`
- **พังแล้วหยุดทั้งคิว ไม่ retry เอง (ตั้งใจ)** — การลองซ้ำกับหน้าที่พังคือสัญญาณบอทที่ชัดที่สุด · `errorKind` `captcha` (รวม HTTP 403) = พักอย่างน้อย 1 ชั่วโมงก่อนรันต่อ (ข้อมูล gflow-cli: ~14 submissions/10 นาที → 403)
- **ค่าจังหวะ/เพดานทั้งหมดใน `flow-worker.config.json`** (ไม่ต้อง build) เริ่มระวัง: 24 ชุด/วัน พักยาวทุก 4-6 สินค้า — ขยับขึ้นทีละนิดเมื่อไม่มีสัญญาณอะไรเป็นสัปดาห์ `state.json` ในโฟลเดอร์หลักฐานบอกว่าเจอสัญญาณตอนทำไปแล้วกี่ชุด
- **พรอมต์ Flow 2 แบบตายตัวมีสำเนา 2 ที่ต้องแก้พร้อมกัน:** `buildFlowPrompt` ใน `lib/flow-jobs.ts` และ `flowPromptFor` ใน `worker/flow-driver.ts` (worker ไม่ import จาก lib เพื่อไม่ผูกกับ bundle ของ Next)
- `ProductImage` ถูกสร้างจาก Flow ที่เดียวคือ `chooseFlowCandidate` รอบ 2 (ก๊อป 2 ไฟล์ที่เลือก caption ตั้งต้น "สินค้า พื้นหลังขาว"/"สินค้าตอนใช้งาน") — pipeline อื่นไม่ต้องรู้จัก Flow
- ทดสอบ: `npm run check:flow` (pure) · smoke S1/S2/S3 ต้องใช้บัญชีสำรองจริง · `FLOW_FORCE_FAIL_STEP=<step>` บังคับพังเพื่อทดสอบ fail-fast
```

- [ ] **Step 5: Final verification (verification-before-completion)**

Run and paste real output in the final report:
```bash
npx tsc --noEmit
npm run lint
npm run check:flow
node scripts/check-contrast.mjs
git status
git diff master --stat
```
Then `npm run build` **only if** `netstat -ano | grep ':3000' | grep LISTENING` is empty; otherwise ask the user before building. After a build, `rm -rf .next-dev` is fine; never touch `.next` while port 3000 is in use.

- [ ] **Step 6: Commit and hand off**

```bash
git add scripts/shot.mjs CLAUDE.md docs/superpowers/specs/2026-09-06-flow-image-bot-design.md worker/index.ts
git commit -m "Document the Flow image bot and add /flow to responsive shots

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ajzf2iLhcMZZnYu7Mru6fQ"
```
Then invoke `superpowers:finishing-a-development-branch` (merge into `master` is the user's call; remember the CLAUDE.md rule: after merging a schema change into `master` run `npx prisma migrate deploy && npx prisma generate` at the repo root, and `node scripts/enable-wal.mjs dev.db` has already been run in Task 6).

---

## Plan self-review (done by the author, 2026-09-06)

- **Spec coverage:** §1-3 goals/workflow → Tasks 7, 9, 10 · §4 architecture (3 pieces, no HTTP between) → Tasks 7, 8 · §4.1 WAL → Task 6 · §5 data model → Task 6 (adds `flowProjectId`, spec amended in Task 5 findings) · §6 state machine → `lib/flow-jobs.ts` (Task 6) + actions (Task 7) + worker (Task 8) · §7.1 loop → Task 8 · §7.2 named steps → Task 4 (`FLOW_STEPS`) · §7.3 config → Task 1 · §7.4 stop rules + evidence → Tasks 4, 8 (adds `host_unsupported`) · §8 UI → Tasks 9, 10 (lightbox + source-beside-candidates as the user asked) · §9 file layout → File map (worker files match; `lib/flow-jobs.ts` pure; `playwright` real dep) · §10 spike S1-S4 → Tasks 3, 4, 5 (kept as reusable smoke scripts, not deleted — they are how selectors get re-verified after Flow changes) · §11 testing → `check:flow`, smoke, `shot.mjs`, contrast, E2E (Task 11) · §12 risks → Key facts + `captcha` cool-down rule.
- **Placeholders:** none — the one open item (migrated-host selectors) is explicitly procedural (Task 4 Step 2 + Step 8) with evidence-driven fixes, because no source can supply verified `flow.google.com` selectors today.
- **Type consistency:** `FlowStepError(step, kind, message)` used identically in Tasks 3-8; `RoundInput.projectId: string | null` ↔ `job.flowProjectId || null`; `candidateFilename(round, attempt, index, ext)` ↔ worker `filePrefix` `r<round>-a<attempt>` + `-<index>.<ext>` produced by the driver (same shape); `getOpenFlowJobForEntry` return type ↔ `FlowJobSummary`; `STATUS_LABELS` keyed by `FlowStatus`; `failureDir` stored relative with forward slashes ↔ UI builds `/api/${failureDir}/…`.
- **Known deliberate deviations from the spec:** `betweenBatchesMs` unused in the image worker (one submission per product per round); smoke scripts kept under `worker/smoke/` instead of scratch; `host_unsupported` error kind and `flowProjectId` column added; `.html/.log/.json` served as `text/plain` from the uploads route.

