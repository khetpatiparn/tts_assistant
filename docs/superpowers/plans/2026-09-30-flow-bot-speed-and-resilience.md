# Flow Bot Speed, Resilient Clip Download, Activity Log — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Flow bot finish a product (2 image rounds + clip) in ~10 minutes when the queue is idle, never lose a rendered clip to a failed download, and record enough of the bot's own activity to explain a future account ban.

**Architecture:** Three independent pieces layered on the existing worker (`worker/`) and Flow queue UI (`/flow`). (1) Pacing is config + one new rule in the main loop. (2) The clip download in `runRound` gets a new first strategy — read the `<video src>` Flow injects on hover and fetch it directly — with the existing menu path demoted to fallback, and a "rendered but not downloaded" outcome that keeps the queue moving. (3) A new `FlowActivity` table written fire-and-forget from the worker, summarized on `/flow` and by a report script.

**Tech Stack:** TypeScript, Prisma 7 + SQLite (`dev.db`, WAL), Playwright (headed Chrome, backup Google account), Next.js 16 App Router (custom build — read `node_modules/next/dist/docs/` before touching routes), pure-logic checks via `scripts/check-*.mjs` (no test runner in this repo).

**Spec:** `docs/superpowers/specs/2026-09-30-flow-bot-speed-and-resilience-design.md`

## Global Constraints

- Never write to the real `dev.db`; all DB testing uses `dev-test.db` (`cp dev.db dev-test.db` plus `-wal`/`-shm`, then `DATABASE_URL="file:./dev-test.db" npx prisma migrate deploy`). The user applies migrations to `dev.db` themselves via `! …` commands.
- Never run `npm run build`/`npm run dev` on `.next`; the production server on port 3000 is in use. Type-check with `npx tsc --noEmit`, lint with `npm run lint` (only `app/components/lib/worker/scripts` problems count; `showcase-extension/` has pre-existing lint errors), UI checks on `NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001`; afterwards kill port 3001 only and `git checkout -- tsconfig.json`.
- Never launch the Flow bot, `.flow-profile`, or any real Flow session from this plan. Live validation is done by the user pressing "รันต่อ" on the real queue after deploy.
- `uploads/` paths only via `lib/upload-paths.ts` in app/lib code; delete any test files you create under `uploads/` for entries that exist only in `dev-test.db`.
- UI text is short plain Thai; no `text-[...]` sizes, no hex in `components/*`, buttons via `buttonVariants`, Thai line-height ≥ 1.6.
- Every commit message ends with: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`
- Exact new config values (spec §1): `betweenProductsMs [30000, 90000]`, `betweenBatchesMs [10000, 30000]`, `longBreakEvery [12, 16]`, `longBreakMs [300000, 600000]`, `dailyBatchCap 60`, `videoDailyCap 20`.
- Do not change `actionDelayMs`, `typeCharDelayMs`, or mouse-curve behaviour (spec: "ไม่แตะ").
- Downloaded preview must be verified with `isMp4Header` before it is saved as a video row; a bad file never becomes `review_r3` with a broken player.
- Once Flow has rendered a clip (the `wait-render` step succeeded), no later step may set the job to `failed` or pause the worker (spec §2 "หลักการรวม").

## How this plan is executed and reviewed

Implementer: a mid-tier model executes tasks in order. Reviewer: the most capable model reviews **each task** before the next starts. Tasks 4, 5 and 7 touch Playwright code that no automated test can run here; each carries a **Reviewer checklist** step the reviewer verifies by reading the diff. A task with any failing checklist line is rejected even if all scripts pass.

## Review Focus

1. Idle-reset rule with a queue that empties for 4 minutes (less than `longBreakMs` min of 5): `sessionStreak` must NOT reset — only idle ≥ 5 min counts as a long break. Test in Task 2.
2. Direct video URL whose signature has expired (Flow returns 403): the fetch must fall through to the menu path, not throw `download_failed` immediately. Test in Task 4.
3. Hover succeeds but Flow injects a `<video>` with a `blob:` src instead of `https://flow-content.google/video/…`: the direct strategy must decline (return null) rather than try to fetch a blob URL. Test in Task 3 (`pickDirectVideoUrl`).
4. `logActivity` called when `dev.db` is locked (SQLITE_BUSY from the Next server): the worker must keep going; the log call swallows and prints one line. Test in Task 6.
5. A job whose preview download failed both ways (`review_r3` with no video row): "เรนเดอร์ใหม่" must still work (deletes nothing, requeues), and "ผ่าน" must be disabled because there is no file to approve. Test in Task 8.

---

### Task 1: Faster pacing config

**Files:**
- Modify: `flow-worker.config.json`
- Modify: `scripts/check-flow-worker-pure.mjs:38-52` (config section)

**Interfaces:**
- Consumes: `loadWorkerConfig()` from `worker/config.ts` (unchanged signature).
- Produces: config values listed in Global Constraints; nothing else depends on this task.

- [ ] **Step 1: Update the expectations in the check script first (they will fail)**

In `scripts/check-flow-worker-pure.mjs`, after the line `check("default dailyBatchCap = 24", good.dailyBatchCap, 24);` replace that line and add the new expectations:

```js
  check("dailyBatchCap = 60 (เร่งบอท 2026-09-30)", good.dailyBatchCap, 60);
  check("videoDailyCap = 20", good.videoDailyCap, 20);
  check("betweenProductsMs = [30000, 90000]", JSON.stringify(good.betweenProductsMs), "[30000,90000]");
  check("betweenBatchesMs = [10000, 30000]", JSON.stringify(good.betweenBatchesMs), "[10000,30000]");
  check("longBreakEvery = [12, 16]", JSON.stringify(good.longBreakEvery), "[12,16]");
  check("longBreakMs = [300000, 600000] (5-10 นาที)", JSON.stringify(good.longBreakMs), "[300000,600000]");
```

- [ ] **Step 2: Run the check to see it fail**

Run: `node scripts/check-flow-worker-pure.mjs`
Expected: 6 `FAIL` lines for the values above.

- [ ] **Step 3: Change the config**

In `flow-worker.config.json` set exactly:

```json
  "betweenBatchesMs": [10000, 30000],
  "betweenProductsMs": [30000, 90000],
  "longBreakEvery": [12, 16],
  "longBreakMs": [300000, 600000],
  "dailyBatchCap": 60,
  "videoDailyCap": 20,
```

Leave every other key untouched.

- [ ] **Step 4: Run the check to see it pass**

Run: `node scripts/check-flow-worker-pure.mjs`
Expected: `all checks passed`.

- [ ] **Step 5: Commit**

```bash
git add flow-worker.config.json scripts/check-flow-worker-pure.mjs
git commit -m "Flow bot: faster pacing on the backup account (spec 2026-09-30 §1)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Idle time counts as a long break

**Files:**
- Modify: `worker/schedule.ts` (add pure helper)
- Modify: `worker/index.ts:430-462` (main loop, before the long-break check)
- Modify: `scripts/check-flow-worker-pure.mjs` (schedule section)

**Interfaces:**
- Produces: `idleCountsAsLongBreak(lastJobFinishedAt: number, now: number, longBreakMs: Range): boolean` in `worker/schedule.ts`.

- [ ] **Step 1: Write the failing checks**

In `scripts/check-flow-worker-pure.mjs`, in the `// ---------- schedule ----------` section, after the `pickLongBreakTarget` block add:

```js
  // ว่างนานเท่ากับพักยาว = ไม่ต้องพักยาวซ้ำ (spec 2026-09-30 §1 "พักตามความจริง")
  const MIN5 = 5 * 60000;
  check("ว่าง 4 นาที (< longBreakMs ต่ำสุด 5) → ยังไม่นับเป็นพักยาว", sc.idleCountsAsLongBreak(1_000_000, 1_000_000 + 4 * 60000, [MIN5, 2 * MIN5]), false);
  check("ว่าง 5 นาทีพอดี → นับเป็นพักยาว", sc.idleCountsAsLongBreak(1_000_000, 1_000_000 + MIN5, [MIN5, 2 * MIN5]), true);
  check("ว่าง 30 นาที → นับเป็นพักยาว", sc.idleCountsAsLongBreak(1_000_000, 1_000_000 + 30 * 60000, [MIN5, 2 * MIN5]), true);
  check("ยังไม่เคยทำงานเลย (lastJobFinishedAt = 0) → ไม่นับ (ไม่มีอะไรให้พัก)", sc.idleCountsAsLongBreak(0, 1_000_000, [MIN5, 2 * MIN5]), false);
```

- [ ] **Step 2: Run to verify failure**

Run: `node scripts/check-flow-worker-pure.mjs`
Expected: TypeError `sc.idleCountsAsLongBreak is not a function` (script exits non-zero).

- [ ] **Step 3: Add the helper**

Append to `worker/schedule.ts`:

```ts
/**
 * บอทว่าง (ไม่มีงานในคิว) นานเท่ากับพักยาวขั้นต่ำแล้ว = ถือว่าพักยาวไปแล้ว ไม่ต้องพักซ้ำ —
 * เดิม sessionStreak นับสะสมข้ามช่วงว่าง ผู้ใช้เพิ่มสินค้าตอนบ่ายแล้วเจอพักยาวทันทีทั้งที่บอทว่างมาทั้งเช้า (2026-09-30)
 * lastJobFinishedAt = 0 คือยังไม่เคยทำงานใน session นี้ — ไม่มีอะไรให้นับว่าพัก
 */
export function idleCountsAsLongBreak(lastJobFinishedAt: number, now: number, longBreakMs: Range): boolean {
  if (lastJobFinishedAt <= 0) return false;
  return now - lastJobFinishedAt >= longBreakMs[0];
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node scripts/check-flow-worker-pure.mjs`
Expected: `all checks passed`.

- [ ] **Step 5: Use it in the main loop**

In `worker/index.ts`, change the import line `import { isWithinActiveHours, localDateKey, msUntilActiveWindow, pickLongBreakTarget } from "./schedule";` to also import `idleCountsAsLongBreak`. Then replace the long-break block:

```ts
    if ((state?.sessionStreak ?? 0) >= longBreakTarget) {
      const ms = randInt(cfg.longBreakMs);
      log(`พักยาว ${Math.round(ms / 60000)} นาที`);
      await upsertState({ nextWakeAt: new Date(Date.now() + ms), sessionStreak: 0 });
      await sleepUntil(Date.now() + ms);
      longBreakTarget = pickLongBreakTarget(cfg.longBreakEvery);
      continue;
    }
```

with:

```ts
    if ((state?.sessionStreak ?? 0) >= longBreakTarget) {
      // ว่างมานานเท่าพักยาวแล้ว = ข้ามการพัก แค่รีเซ็ตตัวนับ (spec 2026-09-30 §1)
      if (idleCountsAsLongBreak(lastBatchAt, Date.now(), cfg.longBreakMs)) {
        log("ว่างมานานพอแล้ว — ไม่พักยาวซ้ำ รีเซ็ตตัวนับ");
        await upsertState({ sessionStreak: 0 });
        longBreakTarget = pickLongBreakTarget(cfg.longBreakEvery);
        continue;
      }
      const ms = randInt(cfg.longBreakMs);
      log(`พักยาว ${Math.round(ms / 60000)} นาที`);
      await upsertState({ nextWakeAt: new Date(Date.now() + ms), sessionStreak: 0 });
      await sleepUntil(Date.now() + ms);
      longBreakTarget = pickLongBreakTarget(cfg.longBreakEvery);
      continue;
    }
```

`lastBatchAt` already exists in that scope (declared `let lastBatchAt = 0;` above the loop and set after each finished job).

- [ ] **Step 6: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: tsc silent; no lint problems under `worker/`.

- [ ] **Step 7: Commit**

```bash
git add worker/schedule.ts worker/index.ts scripts/check-flow-worker-pure.mjs
git commit -m "Flow bot: idle time counts as the long break

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Pure helper — pick the direct video URL

**Files:**
- Modify: `worker/flow-signals.ts` (append)
- Modify: `scripts/check-flow-worker-pure.mjs` (flow-signals section)

**Interfaces:**
- Produces: `pickDirectVideoUrl(srcs: (string | null)[]): string | null` — returns the first `https://flow-content.google/video/…` URL, else null.

- [ ] **Step 1: Write the failing checks**

In `scripts/check-flow-worker-pure.mjs`, at the end of the `// ---------- flow-signals` section (after the last `fs2.…` check) add:

```js
  // ลิงก์วิดีโอตรงที่ Flow ใส่ใน <video src> ตอน hover (พิสูจน์แล้ว 2026-09-30: ดึงได้ไม่ต้อง cookie)
  const direct = "https://flow-content.google/video/a243bbd9-ab27-4a08-b41b-a51e9caac4b9?Expires=1790797015&KeyName=labs-flow-prod-cdn-key&Signature=abc";
  check("เจอลิงก์ flow-content.google/video → ใช้", fs2.pickDirectVideoUrl([direct]), direct);
  check("blob: ไม่ใช่ลิงก์ที่ดึงได้ → null", fs2.pickDirectVideoUrl(["blob:https://flow.google.com/1234"]), null);
  check("ลิงก์รูป (/image/) ไม่ใช่วิดีโอ → null", fs2.pickDirectVideoUrl(["https://flow-content.google/image/xyz?Expires=1"]), null);
  check("ว่าง/null → null", fs2.pickDirectVideoUrl([null, ""]), null);
  check("หลายตัว เอาตัวแรกที่ใช่", fs2.pickDirectVideoUrl(["blob:x", direct]), direct);
  check("host อื่นที่ไม่ใช่ flow-content.google → null (กันโดนหลอกให้โหลดจากที่อื่น)", fs2.pickDirectVideoUrl(["https://evil.example/video/abc"]), null);
```

- [ ] **Step 2: Run to verify failure**

Run: `node scripts/check-flow-worker-pure.mjs`
Expected: TypeError `fs2.pickDirectVideoUrl is not a function`.

- [ ] **Step 3: Implement**

Append to `worker/flow-signals.ts`:

```ts
/**
 * ลิงก์ไฟล์วิดีโอตรงจาก <video src> ที่ Flow ใส่ให้ตอน hover ช่องคลิป — รูปแบบจริง (page.html ของหลักฐาน 2026-09-30):
 * `https://flow-content.google/video/<uuid>?Expires=…&KeyName=labs-flow-prod-cdn-key&Signature=…` ดึงได้โดยไม่ต้อง cookie
 * (curl ไม่ล็อกอิน → 200 video/mp4) หมดอายุ ~6 ชม. · รับเฉพาะ host นี้ + path /video/ เท่านั้น: blob:, /image/, host อื่น = null
 * ให้ผู้เรียกถอยไปใช้เมนู
 */
export function pickDirectVideoUrl(srcs: (string | null)[]): string | null {
  for (const src of srcs) {
    if (!src) continue;
    try {
      const u = new URL(src);
      if (u.protocol === "https:" && u.host === "flow-content.google" && u.pathname.startsWith("/video/")) return src;
    } catch {
      // ไม่ใช่ URL
    }
  }
  return null;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node scripts/check-flow-worker-pure.mjs`
Expected: `all checks passed`.

- [ ] **Step 5: Commit**

```bash
git add worker/flow-signals.ts scripts/check-flow-worker-pure.mjs
git commit -m "Flow bot: pickDirectVideoUrl (only flow-content.google/video/)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Direct download first, menu second, "rendered but not downloaded" last

**Files:**
- Modify: `worker/flow-selectors.ts:107-130` (type) and `:333-351` (MIGRATED.video)
- Modify: `worker/flow-driver.ts:566-640` (add `downloadVideoDirect`, wrap `downloadVideo`), `:806-809` (render tail)
- Modify: `worker/index.ts:210-240` (round-3 result handling)
- Modify: `lib/flow-jobs.ts` (STEP_LABELS)
- Modify: `scripts/check-flow-worker-pure.mjs` (one more pure check)

**Interfaces:**
- Consumes: `pickDirectVideoUrl` (Task 3), existing `isMp4Header`, `videoTileIds`, `humanHover`, `checkpoint`, `FlowStepError`.
- Produces: `RoundResult.files` may be `[]` for round 3 with a new field `downloadFailed: string | null` (the reason text). `worker/index.ts` treats `files.length === 0 && round === 3` as "rendered, not downloaded".
- Produces (pure, testable): `renderOutcome(files: string[], downloadFailed: string | null, attempt: number): { status: "review_r3"; createVideoRow: boolean; filename: string | null; errorMessage: string }` in `worker/flow-signals.ts` — the single place that decides what the worker writes after a render. The Playwright part cannot be unit-tested, so every decision lives outside it.

- [ ] **Step 0: Write the failing checks for the pure decision**

In `scripts/check-flow-worker-pure.mjs`, at the end of the `// ---------- flow-signals` section add:

```js
  // หลัง Render: ตัดสินใจว่าเขียนอะไรลง DB — ต้องเป็น review_r3 เสมอ ไม่มีทาง failed (spec §2 "หลักการรวม")
  const okOutcome = fs2.renderOutcome(["C:/x/r3-a1.mp4"], null, 1);
  check("ได้ไฟล์ → review_r3 + สร้างแถว video ชื่อ r3-a1.mp4 ไม่มี errorMessage",
    JSON.stringify(okOutcome), JSON.stringify({ status: "review_r3", createVideoRow: true, filename: "r3-a1.mp4", errorMessage: "" }));
  const noFile = fs2.renderOutcome([], "ลิงก์ตรง 403 · เมนูไม่เจอ", 2);
  check("ไม่ได้ไฟล์ → ยัง review_r3 ไม่สร้างแถว video", noFile.status + "|" + String(noFile.createVideoRow) + "|" + String(noFile.filename), "review_r3|false|null");
  check("ไม่ได้ไฟล์ → errorMessage บอกว่าคลิปอยู่ใน Flow", noFile.errorMessage.startsWith("โหลดคลิปมาไม่ได้ (คลิปอยู่ในโปรเจกต์ Flow แล้ว)"), true);
  check("errorMessage ยาวเกิน 2000 ถูกตัด", fs2.renderOutcome([], "x".repeat(5000), 1).errorMessage.length <= 2000, true);
  check("attempt 3 → ชื่อไฟล์ r3-a3.mp4", fs2.renderOutcome(["C:/x/r3-a3.mp4"], null, 3).filename, "r3-a3.mp4");
```

Run: `node scripts/check-flow-worker-pure.mjs` → expected TypeError `fs2.renderOutcome is not a function`.

Then append to `worker/flow-signals.ts`:

```ts
/**
 * ผลของรอบ Render → สิ่งที่ worker เขียนลง DB (pure เพื่อทดสอบได้ — ส่วน Playwright ทดสอบไม่ได้)
 * กติกา: หลัง Flow เรนเดอร์เสร็จ **ห้ามเป็น failed** ไม่ว่าจะโหลดไฟล์ได้หรือไม่ (เครดิตจ่ายแล้ว คลิปอยู่ในโปรเจกต์)
 * ไม่ได้ไฟล์ = review_r3 โดยไม่มีแถว video + errorMessage บอกเหตุ (UI ปิดปุ่ม "ผ่าน" ผ่าน canApproveRender)
 */
export function renderOutcome(
  files: string[],
  downloadFailed: string | null,
  attempt: number
): { status: "review_r3"; createVideoRow: boolean; filename: string | null; errorMessage: string } {
  const gotFile = files.length > 0;
  return {
    status: "review_r3",
    createVideoRow: gotFile,
    filename: gotFile ? `r3-a${String(attempt)}.mp4` : null,
    errorMessage: gotFile ? "" : `โหลดคลิปมาไม่ได้ (คลิปอยู่ในโปรเจกต์ Flow แล้ว): ${downloadFailed ?? ""}`.slice(0, 2000),
  };
}
```

Run again → `all checks passed`. (Step 5 below must call `renderOutcome` instead of computing these values inline.)

- [ ] **Step 1: Add the selector for the injected video element**

In `worker/flow-selectors.ts` type block (inside `video?: { … }`) add after `tileThumbnail: string;`:

```ts
    /** <video> ที่ Flow ใส่ในช่องตอน hover — src เป็นลิงก์ตรง flow-content.google/video/… (พิสูจน์ 2026-09-30) */
    tileVideo: string;
```

and in `MIGRATED.video` after `tileThumbnail: "img.thumbnail",` add:

```ts
    // ตอน hover Flow ใส่ <video src="https://flow-content.google/video/<uuid>?…"> ไว้ในช่อง (page.html หลักฐาน 2026-09-30)
    tileVideo: "video",
```

- [ ] **Step 2: Add `downloadFailed` to `RoundResult`**

In `worker/flow-driver.ts` find the `RoundResult` type (search `export type RoundResult`) and add the field:

```ts
  /** รอบ 3 เท่านั้น: Flow เรนเดอร์เสร็จแล้วแต่โหลดไฟล์มาไม่ได้ทั้งสองทาง — เหตุผลสั้นๆ · null = ได้ไฟล์ */
  downloadFailed: string | null;
```

Then every `return { files: …, projectId: …, responseBody: …, mediaId … }` in the file must include `downloadFailed: null` (there are 4 return sites: image round, render round, upscale round, and any early return — search `responseBody:` to find them all).

- [ ] **Step 3: Write `downloadVideoDirect` next to `downloadVideo`**

In `worker/flow-driver.ts`, right before `async function downloadVideo(`, add:

```ts
    /**
     * ทางแรกของการโหลดคลิป: hover ช่อง → อ่าน <video src> ที่ Flow ใส่ให้ → ดึงไฟล์ตรงด้วย page.request (แนบ cookie ของบอท
     * ให้เองเผื่อวันหน้า Google บังคับ) · ไม่แตะเมนู ⋯ เลย — เมนูซ้อน 3 ชั้นคือขั้นที่พังบ่อยที่สุด (2 ใน 2 รอบจริง)
     * คืน null เมื่อ (ก) ไม่มี <video src> ที่ใช้ได้ใน 10 วิ (ข) HTTP ไม่ใช่ 2xx เช่น ลายเซ็นหมดอายุ (ค) ไฟล์ไม่ใช่ MP4 —
     * ผู้เรียกถอยไปเมนู · ไม่ throw เพราะยังมีทางถอย
     */
    async function downloadVideoDirect(name: FlowStep, mediaId: string, filename: string): Promise<string | null> {
      const v = videoSel(name);
      const idx = (await videoTileIds(name)).indexOf(mediaId);
      if (idx < 0) return null;
      const container = page.locator(v.tileContainer).nth(idx);
      await container.scrollIntoViewIfNeeded({ timeout: cfg.selectorTimeoutMs });
      await humanHover(page, container.locator(v.tile).first(), cfg);
      let url: string | null = null;
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const srcs = await container.locator(v.tileVideo).evaluateAll((els) =>
          els.map((e) => (e as HTMLVideoElement).currentSrc || e.getAttribute("src"))
        );
        url = pickDirectVideoUrl(srcs);
        if (url !== null) break;
        await sleepMs(500);
      }
      if (url === null) {
        log.log(name, "ไม่เจอ <video src> ลิงก์ตรงใน 10 วิ — ถอยไปใช้เมนู");
        return null;
      }
      const res = await page.request.get(url, { maxRedirects: 3, timeout: cfg.renderDownloadTimeoutMs }).catch(() => null);
      if (res === null || !res.ok()) {
        log.log(name, `ลิงก์ตรงตอบ ${res === null ? "network error" : `HTTP ${String(res.status())}`} — ถอยไปใช้เมนู`);
        return null;
      }
      const buf = await res.body();
      if (!isMp4Header(buf)) {
        log.log(name, `ลิงก์ตรงให้ไฟล์ที่ไม่ใช่ MP4 (${String(buf.length)} bytes) — ถอยไปใช้เมนู`);
        return null;
      }
      const file = path.join(input.outDir, filename);
      writeFileSync(file, buf);
      log.log(name, `ได้ไฟล์ ${filename} ${String(Math.round(buf.length / 1024))} KB (ลิงก์ตรง)`);
      return file;
    }
```

Add `pickDirectVideoUrl` to the import from `./flow-signals` at the top of the file. `writeFileSync` is already imported.

- [ ] **Step 4: Change the render tail to try direct → menu → give up without failing**

Replace in `worker/flow-driver.ts`:

```ts
      const file = await step("download-preview", () =>
        downloadVideo("download-preview", mediaId, videoSel("download-preview").previewQuality, `${input.filePrefix}.mp4`)
      );
      return { files: [file], projectId: projectId as string, responseBody: null, mediaId };
```

with:

```ts
      // หลังจากนี้ห้ามทำให้งาน failed — เครดิตจ่ายแล้ว คลิปมีจริงในโปรเจกต์ (spec 2026-09-30 §2 "หลักการรวม")
      // ลำดับ: ลิงก์ตรง → เมนู (โค้ดเดิม) → ยอมแพ้แบบไม่พัง ให้ผู้ใช้ไปโหลดเองใน Flow
      const preview = await step("download-preview", async () => {
        const direct = await downloadVideoDirect("download-preview", mediaId, `${input.filePrefix}.mp4`);
        if (direct !== null) return { file: direct, failed: null as string | null };
        try {
          const viaMenu = await downloadVideo("download-preview", mediaId, videoSel("download-preview").previewQuality, `${input.filePrefix}.mp4`);
          return { file: viaMenu, failed: null as string | null };
        } catch (e) {
          const reason = e instanceof Error ? e.message : String(e);
          log.log("download-preview", `โหลดไม่ได้ทั้งลิงก์ตรงและเมนู — คลิปยังอยู่ใน Flow ให้ผู้ใช้โหลดเอง: ${reason}`);
          return { file: null as string | null, failed: reason };
        }
      });
      return {
        files: preview.file === null ? [] : [preview.file],
        projectId: projectId as string,
        responseBody: null,
        mediaId,
        downloadFailed: preview.failed,
      };
```

- [ ] **Step 5: Handle the empty-files outcome in the worker (via `renderOutcome`)**

In `worker/index.ts` import `renderOutcome` from `./flow-signals` (add the import if the file has none). Inside `if (round === 3) {` replace the transaction so the decision comes from the pure helper (the job is NOT failed; `errorKind` stays empty so Showcase/UI treat it as normal review):

```ts
    if (round === 3) {
      const outcome = renderOutcome(result.files, result.downloadFailed, job.attempt);
      await prisma.$transaction(async (tx) => {
        // มีได้แถวเดียว — "เรนเดอร์ใหม่" ลบของ attempt ก่อนไปแล้ว แต่ถ้ารันต่อหลังพังแล้วมีแถวค้าง ให้แทนที่
        await tx.flowJobImage.deleteMany({ where: { jobId: job.id, kind: "video" } });
        if (outcome.createVideoRow && outcome.filename !== null) {
          await tx.flowJobImage.create({
            data: {
              jobId: job.id,
              kind: "video",
              round: 3,
              attempt: job.attempt,
              index: 0,
              filename: outcome.filename,
              mimeType: "video/mp4",
              promptExtra: job.extraPrompt,
              flowMediaId: result.mediaId ?? "",
            },
          });
        }
        await tx.flowJob.update({
          where: { id: job.id },
          data: { status: outcome.status, flowProjectId: result.projectId, errorMessage: outcome.errorMessage },
        });
      });
      log(outcome.createVideoRow ? `งาน ${job.id} Render เสร็จ → รอผู้ใช้ดูคลิป` : `งาน ${job.id} Render เสร็จแต่โหลดไม่ได้ → รอผู้ใช้โหลดเองใน Flow`);
      notify(outcome.createVideoRow ? "คลิปพร้อมให้ดู" : "คลิปเสร็จแล้วใน Flow (โหลดมาไม่ได้)", job.entry.productName);
      return true;
    }
```

`videoFilename(attempt)` in `lib/flow-jobs.ts` must produce the same `r3-a<n>.mp4` as `renderOutcome` — add to `scripts/check-flow-jobs.mjs`: `check("videoFilename(2) ตรงกับ renderOutcome", f.videoFilename(2), "r3-a2.mp4");`.

- [ ] **Step 6: Label text**

In `lib/flow-jobs.ts` `STEP_LABELS` change `"download-preview": "โหลดคลิปตัวอย่าง 720p",` to `"download-preview": "โหลดคลิปตัวอย่าง 720p (ลิงก์ตรง → เมนู)",`.

- [ ] **Step 7: Type-check, lint, checks**

Run: `npx tsc --noEmit && npm run lint && npm run check:flow`
Expected: clean; `all checks passed` twice.

- [ ] **Step 7b: Reviewer checklist (no automated test covers this — verify by reading)**

Confirm each line by reading `worker/flow-driver.ts` and `worker/index.ts`; reject the task if any fails:
- After `await step("wait-render", …)` returns, **no code path throws out of `runRound` for round 3** — `downloadVideoDirect` returns null on every failure, the menu path is wrapped in try/catch, and the `step("download-preview", …)` callback never throws. Search for `throw` between `wait-render` and the round-3 `return`.
- `downloadVideoDirect` never calls `page.request.get` on a URL that did not pass `pickDirectVideoUrl` (host allow-list).
- `renderOutcome` is the only place that builds `errorMessage`/`status` for round 3 in `worker/index.ts` (no inline duplicates).
- The `catch` block of `processJob` in `worker/index.ts` is unchanged: a failure **before** `wait-render` (e.g. attach-reference) still marks the job `failed` and pauses — the new rule applies only after the render succeeded.
- `checkpoint(4, "results")` still runs before any download attempt.

- [ ] **Step 8: Commit**

```bash
git add worker/flow-selectors.ts worker/flow-driver.ts worker/flow-signals.ts worker/index.ts lib/flow-jobs.ts scripts/check-flow-worker-pure.mjs scripts/check-flow-jobs.mjs
git commit -m "Flow bot: download the clip from its direct URL first; a rendered clip never fails the job

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: 1080p via keyboard menu navigation, non-fatal

**Files:**
- Modify: `worker/flow-driver.ts` (`downloadVideo` menu section `:604-632`, `upscaleRound` `:812-838`)
- Modify: `worker/index.ts` (round-4 result handling — search `if (round === 4)`)
- Modify: `lib/flow-jobs.ts` (STATUS_LABELS `done` unchanged; add nothing) 

**Interfaces:**
- Consumes: `downloadFailed` from Task 4.
- Produces: round 4 returns `files: []` + `downloadFailed` when the 1080p menu path fails; the worker then marks the job `done` keeping the 720p preview as the final video (renames nothing; the preview row stays kind `"video"`).
- Produces (pure, testable): `submenuArrowDowns(menuTexts: string[], quality: RegExp[]): number | null` in `worker/flow-signals.ts` — how many `ArrowDown` presses after `ArrowRight` reach the wanted submenu item; `null` = not found or disabled.

- [ ] **Step 0: Write the failing checks for the keyboard decision**

In `scripts/check-flow-worker-pure.mjs`, flow-signals section, add:

```js
  // เมนูโหลดจริง (สำรวจสด 2026-09-30): เมนูหลัก 12 รายการ แล้วเมนูย่อย 4 รายการ — ArrowRight ไปที่รายการแรกของเมนูย่อย
  const MENU = ["favorite | Favorite", "keyboard_return | Reuse prompt", "play_movies | Add to scene", "add_2 | Add to prompt",
    "download | Download", "content_copy | Copy", "edit | Rename", "share | Share", "video_library | Publish to YouTube",
    "photo_library | Set project cover", "flag | Flag output", "delete | Move to trash",
    "270p | Animated GIF", "720p | Original size", "1080p | Upscaled", "4K | Upscaled [disabled]"];
  check("720p Original size = รายการที่ 2 ของเมนูย่อย → ArrowDown 1 ครั้ง", fs2.submenuArrowDowns(MENU, [/720p/, /Original size/]), 1);
  check("1080p Upscaled → ArrowDown 2 ครั้ง", fs2.submenuArrowDowns(MENU, [/1080p/, /Upscaled/]), 2);
  check("4K [disabled] → null (กดไม่ได้)", fs2.submenuArrowDowns(MENU, [/4K/, /Upscaled/]), null);
  check("ไม่มีเมนูย่อยเลย (Flow เปลี่ยนหน้า) → null", fs2.submenuArrowDowns(MENU.slice(0, 12), [/1080p/, /Upscaled/]), null);
  check("เมนูย่อยสลับลำดับ ยังนับถูก", fs2.submenuArrowDowns([...MENU.slice(0, 12), "1080p | Upscaled", "720p | Original size"], [/720p/, /Original size/]), 1);
  check("ต้องแมตช์ทุก regex (720p อย่างเดียวไม่พอ)", fs2.submenuArrowDowns([...MENU.slice(0, 12), "720p | Animated GIF", "720p | Original size"], [/720p/, /Original size/]), 1);
```

Run → TypeError. Then append to `worker/flow-signals.ts`:

```ts
/**
 * เมนู Download ของ Flow: หลัง hover "Download" + ArrowRight โฟกัสอยู่ที่รายการแรกของเมนูย่อย — คืนจำนวน ArrowDown
 * ที่ต้องกดจนถึงรายการที่ต้องการ · เมนูย่อย = รายการที่มีคำว่า Animated GIF / Original size / Upscaled (สำรวจสด 2026-09-30)
 * null = ไม่เจอ หรือรายการนั้น [disabled] (เช่น 4K ที่ต้องอัปเกรด) ให้ผู้เรียกพังเป็น selector_drift
 */
export function submenuArrowDowns(menuTexts: string[], quality: RegExp[]): number | null {
  const sub = menuTexts.filter((t) => /Animated GIF|Original size|Upscaled/.test(t));
  if (sub.length === 0) return null;
  const pos = sub.findIndex((t) => quality.every((q) => q.test(t)));
  if (pos < 0 || /\[disabled\]/.test(sub[pos])) return null;
  return pos;
}
```

Run → `all checks passed`. (Step 1 below must use this helper instead of computing an index inline.)

- [ ] **Step 1: Replace the mouse-into-submenu code with keyboard navigation**

In `downloadVideo`, replace everything from the comment `// ห้ามใช้ humanClick กับเมนูย่อย` down to (and including) the line `await page.mouse.up();` with:

```ts
      // เมนูย่อยด้วยคีย์บอร์ด (Angular Material รองรับ ArrowDown/ArrowRight/Enter มาตรฐาน) — เมาส์เดินเส้นโค้งผ่านรายการอื่น
      // ทำให้เมนูย่อยปิด (เจอจริง 2026-09-30) · โฟกัสอยู่ที่ "Download" แล้วหลัง hover → ArrowRight เปิดเมนูย่อย →
      // ArrowDown ไปทีละรายการจนถึงตัวเลือกที่ต้องการ → Enter
      await dl.focus();
      await page.keyboard.press("ArrowRight");
      await sleepMs(randInt([300, 600]));
      const items = page.locator(v.menuItem);
      // ข้อความรวม [disabled] ด้วย เพื่อให้ submenuArrowDowns ปฏิเสธรายการที่กดไม่ได้ (เช่น 4K)
      const texts = await items.evaluateAll((els) =>
        els.map((e) => (e.textContent ?? "").replace(/\s+/g, " ").trim() + (e.getAttribute("aria-disabled") === "true" || (e as HTMLButtonElement).disabled ? " [disabled]" : ""))
      );
      const downs = submenuArrowDowns(texts, quality);
      if (downs === null) {
        throw new FlowStepError(name, "selector_drift", `ไม่เจอเมนูโหลด ${quality.map(String).join(" + ")} — เมนูมี: ${texts.join(" / ")}`);
      }
      const downloadEvent = page.waitForEvent("download", { timeout: cfg.renderDownloadTimeoutMs });
      // กัน unhandled rejection ถ้าขั้นอื่นพังก่อน (บั๊กคลาสเดียวกับ uploadResponse ด้านบน)
      downloadEvent.catch(() => {});
      for (let i = 0; i < downs; i++) {
        await page.keyboard.press("ArrowDown");
        await sleepMs(randInt([120, 250]));
      }
      await page.keyboard.press("Enter");
```

Add `submenuArrowDowns` to the import from `./flow-signals`.

Keep the lines that follow, but change the "did the click register" check to: `if ((await page.locator(v.menuItem).count()) > 0) { throw new FlowStepError(name, "selector_drift", "กด Enter แล้วเมนูไม่ปิด (ไม่ติด) — ยังไม่ได้เริ่มโหลด"); }` (menu still open = Enter did not register). Delete the now-unused `dlBox/tBox` lines and the `target` locator/waitFor block above them. Keep `checkpoint(5, "menu")` before the keyboard part.

- [ ] **Step 2: Make round 4 non-fatal**

In `upscaleRound()` replace:

```ts
      const file = await step("download-final", () =>
        downloadVideo("download-final", mediaId, videoSel("download-final").finalQuality, `${input.filePrefix}.mp4`)
      );
      return { files: [file], projectId: projectId as string, responseBody: null, mediaId };
```

with:

```ts
      // 1080p ล้ม = ไม่พัง: ผู้ใช้มี 720p อยู่แล้ว งานจบด้วยหมายเหตุ (spec 2026-09-30 §2)
      const final = await step("download-final", async () => {
        try {
          return { file: await downloadVideo("download-final", mediaId, videoSel("download-final").finalQuality, `${input.filePrefix}.mp4`), failed: null as string | null };
        } catch (e) {
          const reason = e instanceof Error ? e.message : String(e);
          log.log("download-final", `โหลด 1080p ไม่ได้ — ใช้ 720p ที่มีอยู่แล้ว: ${reason}`);
          return { file: null as string | null, failed: reason };
        }
      });
      return { files: final.file === null ? [] : [final.file], projectId: projectId as string, responseBody: null, mediaId, downloadFailed: final.failed };
```

- [ ] **Step 3: Worker: round 4 with no file → done, keep preview**

In `worker/index.ts` find the `if (round === 4) {` block. Wrap the existing "replace preview with final, delete preview file" logic in `if (result.files.length > 0) { …existing… } else { … }` where the else branch is:

```ts
      } else {
        await prisma.flowJob.update({
          where: { id: job.id },
          data: {
            status: FLOW_STATUS.DONE,
            finishedAt: new Date(),
            errorMessage: `ได้ 720p (โหลด 1080p ไม่ได้: ${result.downloadFailed ?? ""})`.slice(0, 2000),
          },
        });
        log(`งาน ${job.id} จบด้วย 720p (1080p โหลดไม่ได้)`);
      }
```

Make sure `FLOW_STATUS` is imported in `worker/index.ts` (it is — it's used by `markJobFailedImmediately`).

- [ ] **Step 3b: Reviewer checklist (read-only verification)**

- In `downloadVideo`, no `page.mouse.move/down/up` remains between `checkpoint(5, "menu")` and `Enter` — the submenu is reached only by keyboard.
- `submenuArrowDowns` is the only place that decides how many `ArrowDown`s to press.
- In `upscaleRound`, every error from `downloadVideo` is caught. `find-video` failing (clip not in project) may still throw `selector_drift` — that is **before** any download and is acceptable, but confirm the round-4 catch path in `worker/index.ts` does not delete the 720p preview file or row.
- Round 4 with `files: []` ends as `done` (not `failed`, not `review_r3`) and the preview `FlowJobImage` row (kind `"video"`) still exists.

- [ ] **Step 4: Type-check, lint, checks**

Run: `npx tsc --noEmit && npm run lint && npm run check:flow`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add worker/flow-driver.ts worker/flow-signals.ts worker/index.ts scripts/check-flow-worker-pure.mjs
git commit -m "Flow bot: 1080p via keyboard menu; failing to upscale keeps the 720p and finishes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `FlowActivity` table + `logActivity`

**Files:**
- Modify: `prisma/schema.prisma` (append model)
- Create: `prisma/migrations/20260930200000_add_flow_activity/migration.sql`
- Create: `worker/activity.ts`
- Create: `lib/flow-activity.ts` (pure: kinds + summarizer, shared with UI)
- Create: `scripts/check-flow-activity.mjs`
- Modify: `package.json` (`check:flow` runs the new script too)

**Interfaces:**
- Produces: `logActivity(input: { kind: ActivityKind; jobId?: string; round?: number; detail?: Record<string, unknown> }): void` (fire-and-forget, never throws) in `worker/activity.ts`.
- Produces: `ACTIVITY_KINDS`, `type ActivityKind`, `summarizeActivity(rows: { at: Date; kind: string }[], now: Date): { today: number; peakPer10Min: number; lastWarnAt: Date | null }` in `lib/flow-activity.ts`.

- [ ] **Step 1: Write the failing summarizer checks**

Create `scripts/check-flow-activity.mjs`:

```js
/**
 * ตรวจตรรกะ pure ของ lib/flow-activity.ts — รัน: node scripts/check-flow-activity.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const out = mkdtempSync(join(process.cwd(), ".check-activity-tmp-"));
let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`      ได้ ${JSON.stringify(actual)} ควรได้ ${JSON.stringify(expected)}`);
}

try {
  execFileSync("npx", ["tsc", "lib/flow-activity.ts", "--outDir", out, "--module", "es2022", "--target", "ES2017", "--moduleResolution", "bundler"], { stdio: "inherit", shell: true });
  const a = await import(pathToFileURL(join(out, "flow-activity.js")).href);
  const now = new Date("2026-10-01T10:00:00+07:00");
  const at = (min) => new Date(now.getTime() - min * 60000);
  const gen = (min) => ({ at: at(min), kind: "generate_image" });

  check("ไม่มีแถว → 0/0/null", a.summarizeActivity([], now), { today: 0, peakPer10Min: 0, lastWarnAt: null });
  check("นับเฉพาะ kind ที่เป็นการยิง (generate/upload/new_project) ไม่นับ break/session_start",
    a.summarizeActivity([gen(1), { at: at(2), kind: "break" }, { at: at(3), kind: "session_start" }, { at: at(4), kind: "upload" }], now).today, 2);
  check("peak = จำนวนมากสุดในช่วง 10 นาทีใดๆ", a.summarizeActivity([gen(0), gen(1), gen(2), gen(30), gen(31)], now).peakPer10Min, 3);
  check("แถวเมื่อวาน (ก่อนเที่ยงคืนท้องถิ่น) ไม่นับ today", a.summarizeActivity([gen(11 * 60)], now).today, 0);
  check("lastWarnAt = http_warn หรือ bot_signal ล่าสุด", a.summarizeActivity([{ at: at(50), kind: "http_warn" }, { at: at(20), kind: "bot_signal" }, gen(1)], now).lastWarnAt, at(20));
  check("ACTIVITY_KINDS มีครบตามสเปก", a.ACTIVITY_KINDS, ["generate_image", "generate_video", "upload", "new_project", "download", "http_warn", "bot_signal", "break", "session_start"]);
  console.log(failed === 0 ? "\nผ่านทุกเคส" : `\nตก ${failed} เคส`);
} finally {
  rmSync(out, { recursive: true, force: true });
}
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 2: Run to verify failure**

Run: `node scripts/check-flow-activity.mjs`
Expected: tsc error "Cannot find lib/flow-activity.ts" (non-zero exit).

- [ ] **Step 3: Create the pure module**

Create `lib/flow-activity.ts`:

```ts
/**
 * สมุดบันทึกการกระทำของบอท Flow (pure — ไม่มี Prisma, client component import ได้)
 * เป้าหมาย: ถ้าบัญชีโดนจับ ตอบได้ว่า "ก่อนโดน ยิงกี่ครั้งใน 10 นาที / วันนั้น มีสัญญาณเตือนก่อนไหม" (spec 2026-09-30 §3)
 */
export const ACTIVITY_KINDS = [
  "generate_image",
  "generate_video",
  "upload",
  "new_project",
  "download",
  /** Google ตอบ 429/403/5xx โดยที่งานยังไม่พัง — สัญญาณเตือนล่วงหน้า */
  "http_warn",
  /** captcha / unusual activity / login หลุด — จุดที่โดนจริง */
  "bot_signal",
  /** พักจริง (ms อยู่ใน detail) */
  "break",
  /** เปิดบอท — detail เก็บค่าจังหวะที่ใช้ตอนนั้น */
  "session_start",
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/** สิ่งที่ Google เห็นเป็น "คำขอ" จากเรา — ใช้นับความถี่ */
const REQUEST_KINDS: ReadonlySet<string> = new Set(["generate_image", "generate_video", "upload", "new_project", "download"]);
const WARN_KINDS: ReadonlySet<string> = new Set(["http_warn", "bot_signal"]);

function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function summarizeActivity(
  rows: { at: Date; kind: string }[],
  now: Date
): { today: number; peakPer10Min: number; lastWarnAt: Date | null } {
  const requests = rows.filter((r) => REQUEST_KINDS.has(r.kind)).map((r) => r.at.getTime()).sort((x, y) => x - y);
  const today = rows.filter((r) => REQUEST_KINDS.has(r.kind) && sameLocalDay(r.at, now)).length;
  // หน้าต่างเลื่อน 10 นาที: สำหรับแต่ละคำขอ นับคำขอที่อยู่ภายใน 10 นาทีถัดจากมัน
  let peak = 0;
  for (let i = 0; i < requests.length; i++) {
    let j = i;
    while (j < requests.length && requests[j] - requests[i] < 10 * 60000) j++;
    peak = Math.max(peak, j - i);
  }
  const warns = rows.filter((r) => WARN_KINDS.has(r.kind)).map((r) => r.at.getTime());
  const lastWarnAt = warns.length === 0 ? null : new Date(Math.max(...warns));
  return { today, peakPer10Min: peak, lastWarnAt };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node scripts/check-flow-activity.mjs`
Expected: `ผ่านทุกเคส`.

- [ ] **Step 5: Schema + migration (test DB only)**

Append to `prisma/schema.prisma`:

```prisma
/// สมุดบันทึกการกระทำของบอท Flow — 1 แถวต่อ 1 สิ่งที่ Google เห็น (กด Generate/อัปโหลด/สร้างโปรเจกต์/โหลด)
/// + สัญญาณเตือน (HTTP ไม่ใช่ 2xx, captcha) + พักจริง · ไว้วิเคราะห์ว่าถ้าโดนแบน "ยิงถี่แค่ไหนก่อนโดน"
/// (spec 2026-09-30-flow-bot-speed-and-resilience-design.md §3) · kind ดู lib/flow-activity.ts · เก็บตลอด (ไม่กี่ร้อยแถว/วัน)
model FlowActivity {
  id     String   @id @default(cuid())
  at     DateTime @default(now())
  kind   String
  jobId  String   @default("")
  round  Int      @default(0)
  /// JSON สั้นๆ: { status } / { message } / { ms } / { config: {...} }
  detail String   @default("")

  @@index([at])
  @@index([kind, at])
}
```

Create `prisma/migrations/20260930200000_add_flow_activity/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "FlowActivity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "jobId" TEXT NOT NULL DEFAULT '',
    "round" INTEGER NOT NULL DEFAULT 0,
    "detail" TEXT NOT NULL DEFAULT ''
);

-- CreateIndex
CREATE INDEX "FlowActivity_at_idx" ON "FlowActivity"("at");

-- CreateIndex
CREATE INDEX "FlowActivity_kind_at_idx" ON "FlowActivity"("kind", "at");
```

Run:
```bash
rm -f dev-test.db dev-test.db-wal dev-test.db-shm && cp dev.db dev-test.db && (cp dev.db-wal dev-test.db-wal; cp dev.db-shm dev-test.db-shm) 2>/dev/null
DATABASE_URL="file:./dev-test.db" npx prisma migrate deploy
npx prisma generate
```
Expected: migration applied to dev-test.db; client generated. **Do not run migrate against dev.db.**

- [ ] **Step 6: Worker-side writer**

Create `worker/activity.ts`:

```ts
import { prisma } from "@/lib/prisma";
import type { ActivityKind } from "@/lib/flow-activity";

/**
 * บันทึกการกระทำของบอทลง FlowActivity แบบ fire-and-forget — **ห้ามทำให้งานพังเพราะ log** (dev.db ถูก Next ใช้พร้อมกัน
 * อาจชน SQLITE_BUSY) พังก็พิมพ์บรรทัดเดียวแล้วไปต่อ · ไม่ await ที่จุดเรียก
 */
export function logActivity(input: { kind: ActivityKind; jobId?: string; round?: number; detail?: Record<string, unknown> }): void {
  prisma.flowActivity
    .create({
      data: {
        kind: input.kind,
        jobId: input.jobId ?? "",
        round: input.round ?? 0,
        detail: input.detail === undefined ? "" : JSON.stringify(input.detail).slice(0, 2000),
      },
    })
    .catch((e: unknown) => {
      console.log(`${new Date().toISOString()}  บันทึก FlowActivity ไม่สำเร็จ (ไม่กระทบงาน): ${e instanceof Error ? e.message : String(e)}`);
    });
}
```

- [ ] **Step 7: Prove the no-throw behaviour (Review Focus #4)**

Create a throwaway script in your scratchpad (not the repo) that imports `logActivity` with `DATABASE_URL="file:./dev-test.db"`, opens a second `better-sqlite3` connection that holds `BEGIN IMMEDIATE` on dev-test.db, calls `logActivity({ kind: "break", detail: { ms: 1 } })`, waits 3 s, and prints "still alive". Run it with `npx tsx`. Expected: prints the "บันทึก FlowActivity ไม่สำเร็จ" line (or succeeds after the lock if Prisma retried) and then "still alive" — the process never crashes. Then delete the scratch script.

- [ ] **Step 8: Wire into package.json and commit**

In `package.json` change `"check:flow": "node scripts/check-flow-worker-pure.mjs && node scripts/check-flow-jobs.mjs"` to `"check:flow": "node scripts/check-flow-worker-pure.mjs && node scripts/check-flow-jobs.mjs && node scripts/check-flow-activity.mjs"`.

Run: `npx tsc --noEmit && npm run lint && npm run check:flow`
Expected: clean.

```bash
git add prisma/schema.prisma prisma/migrations/20260930200000_add_flow_activity lib/flow-activity.ts worker/activity.ts scripts/check-flow-activity.mjs package.json
git commit -m "FlowActivity: the bot's own activity log (table, writer, summarizer)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Record every request, warning, break and session start

**Files:**
- Modify: `worker/flow-driver.ts` (`onResponse` `:267-280`, `click-generate` step, `attach-reference` upload, `ensure-project` new-project click, both download success points, `assertPageUsable` captcha throw, wait loops' captcha/blockKind throws)
- Modify: `worker/index.ts` (session start after `openFlowAndSettle`, every `sleepUntil`/`sleepMs` pause after a job, `pauseWorker`)

**Interfaces:**
- Consumes: `logActivity` (Task 6).

- [ ] **Step 1: Driver — requests**

In `worker/flow-driver.ts` add `import { logActivity } from "./activity";`. Then:

- In the `click-generate` step, right after `submitAt = Date.now();` add:
  ```ts
      logActivity({ kind: input.round === 3 ? "generate_video" : "generate_image", jobId: input.jobId, round: input.round });
  ```
  `RoundInput` does not carry `jobId` today — add `jobId: string;` to `RoundInput` (doc: `/** สำหรับ FlowActivity เท่านั้น */`), pass `job.id` from `worker/index.ts` and `"smoke"` from `worker/smoke/s2-round.ts` and `worker/smoke/s3-round2.ts`.
- In `attachReferences`, right after `await chooser.setFiles(…)` (the line that hands files to Flow) add `logActivity({ kind: "upload", jobId: input.jobId, round: input.round, detail: { files: paths.length } });` (use whatever the local variable holding the file list is called).
- In `ensure-project`, right after `await humanClick(page, btn, cfg);` (the New project click) add `logActivity({ kind: "new_project", jobId: input.jobId, round: input.round });`.
- In `downloadVideoDirect` and `downloadVideo`, right before each `return file;` add `logActivity({ kind: "download", jobId: input.jobId, round: input.round, detail: { via: "direct" } })` / `{ via: "menu" }`.
- In the image round's `download-4` step, after the loop that writes 4 files add `logActivity({ kind: "download", jobId: input.jobId, round: input.round, detail: { files: 4 } });`.

- [ ] **Step 2: Driver — warnings**

In `onResponse`, after `responses.push({ status: res.status(), body, at: Date.now() });` add:

```ts
    // สัญญาณเตือนล่วงหน้า — Google ตอบไม่ปกติแม้งานยังไม่พัง (spec 2026-09-30 §3)
    if (res.status() === 429 || res.status() === 403 || res.status() >= 500) {
      logActivity({ kind: "http_warn", jobId: input.jobId, round: input.round, detail: { status: res.status(), url: res.url().slice(0, 120) } });
    }
```

In `assertPageUsable`, right before `throw new FlowStepError(step, "captcha", …)` add `logActivity({ kind: "bot_signal", detail: { signal: c } });` and right before the `login_required` throw add `logActivity({ kind: "bot_signal", detail: { signal: "login_required" } });`. In the `wait-results`/`wait-render` loops, right before each `throw new FlowStepError(…, "captcha", …)` add `logActivity({ kind: "bot_signal", jobId: input.jobId, round: input.round, detail: { signal: "wait-loop" } });`.

- [ ] **Step 3: Worker — session start and breaks**

In `worker/index.ts` add `import { logActivity } from "./activity";`. After the line `log(\`เปิด Flow แล้ว host=…\`)` (search `เปิด Flow แล้ว`) add:

```ts
  logActivity({
    kind: "session_start",
    detail: {
      config: {
        betweenProductsMs: cfg.betweenProductsMs, betweenBatchesMs: cfg.betweenBatchesMs,
        longBreakEvery: cfg.longBreakEvery, longBreakMs: cfg.longBreakMs,
        dailyBatchCap: cfg.dailyBatchCap, videoDailyCap: cfg.videoDailyCap,
      },
    },
  });
```

Before the long-break `await sleepUntil(Date.now() + ms);` add `logActivity({ kind: "break", detail: { ms, why: "long" } });`. Before the per-job pause `await sleepUntil(Date.now() + pause);` add `logActivity({ kind: "break", jobId: job.id, round: doneRound, detail: { ms: pause, why: "between" } });`.

- [ ] **Step 4: Structural test — every hook is really there**

The calls cannot be exercised without Flow, so pin their **presence and placement** with a source scan. Create `scripts/check-flow-activity-hooks.mjs`:

```js
/**
 * ตรวจว่า worker เรียก logActivity ครบทุกจุดที่สเปก §3 กำหนด — อ่านซอร์สตรงๆ (รันบอทจริงไม่ได้ในเทสต์)
 * รัน: node scripts/check-flow-activity-hooks.mjs
 */
import { readFileSync } from "node:fs";

const driver = readFileSync("worker/flow-driver.ts", "utf8");
const index = readFileSync("worker/index.ts", "utf8");
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
must("click-generate → generate_image/generate_video", within(driver, 'step("click-generate"', "await step(", 'kind: input.round === 3 ? "generate_video" : "generate_image"'));
must("attach-reference → upload หลัง setFiles", within(driver, "async function attachReferences", "\n    }\n", 'kind: "upload"'));
must("ensure-project → new_project", within(driver, 'step("ensure-project"', "await step(", 'kind: "new_project"'));
must("downloadVideoDirect → download via direct", within(driver, "async function downloadVideoDirect", "async function downloadVideo(", 'via: "direct"'));
must("downloadVideo (menu) → download via menu", within(driver, "async function downloadVideo(", "\n    }\n", 'via: "menu"'));
must("download-4 → download files:4", within(driver, 'step("download-4"', "return written;", "files: 4"));
must("onResponse → http_warn on 429/403/5xx", within(driver, "const onResponse", "};", 'kind: "http_warn"') && within(driver, "const onResponse", "};", "res.status() === 429 || res.status() === 403 || res.status() >= 500"));
must("assertPageUsable → bot_signal (captcha)", within(driver, "async function assertPageUsable", "\n}\n", 'kind: "bot_signal"'));
must("assertPageUsable → bot_signal (login_required)", within(driver, "async function assertPageUsable", "\n}\n", 'signal: "login_required"'));
must("wait loops → bot_signal ก่อน throw captcha (≥ 2 จุด: wait-results + wait-render)", (driver.match(/kind: "bot_signal"[^\n]*wait-loop/g) ?? []).length >= 2);
must("index import logActivity", index.includes('import { logActivity } from "./activity"'));
must("session_start with config หลังเปิด Flow", within(index, "เปิด Flow แล้ว", "let longBreakTarget", 'kind: "session_start"') && within(index, 'kind: "session_start"', "});", "longBreakMs: cfg.longBreakMs"));
must("break why:long ก่อน sleepUntil ของพักยาว", within(index, "พักยาว ${", "longBreakTarget = pickLongBreakTarget", 'why: "long"'));
must("break why:between ก่อน sleepUntil ต่อสินค้า", within(index, "const pause = randInt(", "await sleepUntil(Date.now() + pause)", 'why: "between"'));
must("ห้าม await logActivity (fire-and-forget)", !/await logActivity\(/.test(driver) && !/await logActivity\(/.test(index));

console.log(failed === 0 ? "\nผ่านทุกเคส" : `\nตก ${failed} เคส`);
process.exit(failed === 0 ? 0 : 1);
```

Run: `node scripts/check-flow-activity-hooks.mjs` → expected `ผ่านทุกเคส`. If a `within(...)` anchor does not match your actual code layout, fix the **anchor** to the real text of the block — never weaken the assertion. Add the script to `check:flow` in `package.json`.

- [ ] **Step 4b: Reviewer checklist**

- Every `logActivity` call passes `jobId`/`round` when a job is in scope (driver: `input.jobId`, `input.round`; index: `job.id`, `doneRound`), so per-job frequency can be reconstructed.
- No `logActivity` call is awaited, and none sits where a surrounding `catch` would hide a missing call.
- `detail.url` in `http_warn` is truncated (≤ 120 chars) — signed URLs must not be stored whole.

- [ ] **Step 5: Type-check, lint, checks**

Run: `npx tsc --noEmit && npm run lint && npm run check:flow`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add worker/flow-driver.ts worker/index.ts worker/smoke/s2-round.ts worker/smoke/s3-round2.ts scripts/check-flow-activity-hooks.mjs package.json
git commit -m "Flow bot: write requests, warnings, breaks and session config to FlowActivity

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: `/flow` — activity strip, "rendered but not downloaded" row, report script

**Files:**
- Modify: `lib/flow-queries.ts` (`FlowWorkerView` + `getFlowQueueData`)
- Modify: `components/flow-route.tsx:83-88` (banner line)
- Modify: `components/flow-review-row.tsx:254-…` (review_r3 block)
- Create: `scripts/flow-activity-report.mjs`
- Modify: `scripts/check-flow-jobs.mjs` (Review Focus #5 rules are pure — add checks)

**Interfaces:**
- Consumes: `summarizeActivity` (Task 6); `job.video === null` on a `review_r3` row (Task 4).
- Produces: `FlowWorkerView.activity: { today: number; peakPer10Min: number; lastWarnAt: Date | null }`.

- [ ] **Step 1: Pure rule + check for the no-file review row (Review Focus #5)**

In `lib/flow-jobs.ts` add:

```ts
/** review_r3 ที่ไม่มีไฟล์ (โหลดไม่ได้ทั้งสองทาง): กด "ผ่าน" ไม่ได้ (ไม่มีไฟล์ให้ผ่าน) แต่ "เรนเดอร์ใหม่" ได้ */
export function canApproveRender(status: string, hasVideoFile: boolean): boolean {
  return status === FLOW_STATUS.REVIEW_R3 && hasVideoFile;
}
```

In `scripts/check-flow-jobs.mjs` add:

```js
  check("canApproveRender review_r3 + มีไฟล์ → true", f.canApproveRender("review_r3", true), true);
  check("canApproveRender review_r3 + ไม่มีไฟล์ (โหลดไม่ได้) → false", f.canApproveRender("review_r3", false), false);
  check("canApproveRender สถานะอื่น → false", f.canApproveRender("review_r2", true), false);
  check("afterRedo review_r3 ยังใช้ได้แม้ไม่มีไฟล์ (ไม่ขึ้นกับไฟล์)", f.afterRedo("review_r3").status, "queued_r3");
```

Run `node scripts/check-flow-jobs.mjs` → fails on `canApproveRender` → add the function → passes.

- [ ] **Step 2: Query the activity summary**

In `lib/flow-queries.ts` add to `FlowWorkerView`:

```ts
  /** สรุปสมุดบันทึกการกระทำ (FlowActivity) — วันนี้ยิงกี่ครั้ง · ถี่สุดต่อ 10 นาที (24 ชม.ล่าสุด) · สัญญาณเตือนล่าสุด */
  activity: { today: number; peakPer10Min: number; lastWarnAt: Date | null };
```

In `getFlowQueueData`, add a third query to the `Promise.all`: `prisma.flowActivity.findMany({ where: { at: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } }, select: { at: true, kind: true } })` bound to `activityRows`, and set `activity: summarizeActivity(activityRows, now)` in the `worker` object. Import `summarizeActivity` from `@/lib/flow-activity`.

- [ ] **Step 3: Banner strip**

In `components/flow-route.tsx` inside the `worker.alive` branch, after `· ทำคลิป {worker.todayRenders}/{worker.videoDailyCap}` add:

```tsx
              {" · ยิง Flow วันนี้ "}{worker.activity.today}{" ครั้ง · ถี่สุด "}{worker.activity.peakPer10Min}{"/10 นาที · สัญญาณเตือน: "}
              {worker.activity.lastWarnAt === null ? "ไม่มี" : `ล่าสุด ${minutesAgo(worker.activity.lastWarnAt, now)}`}
```

- [ ] **Step 4: Review row for a clip that could not be downloaded**

In `components/flow-review-row.tsx`, inside the `{isRenderReview && ( … )}` block, wrap the existing `<video>` player so that when `job.video === null` it shows instead:

```tsx
              <div className="flex flex-col gap-2 rounded-md border-l-4 border-status-warning bg-surface-2 p-3 leading-relaxed">
                <p className="text-sm font-medium text-foreground">คลิปเสร็จแล้วใน Flow แต่โหลดมาไม่ได้</p>
                {job.errorMessage && <p className="text-xs text-muted-foreground">{job.errorMessage}</p>}
                <p className="text-xs text-muted-foreground">
                  เปิดโปรเจกต์ในบัญชีสำรองแล้วโหลดเอง (⋯ → Download → 1080p) หรือกด &quot;เรนเดอร์ใหม่&quot; ให้บอทลองอีกครั้ง
                </p>
                {job.flowProjectId && (
                  <a className="text-sm text-primary underline-offset-4 hover:underline" href={`https://flow.google.com/project/${job.flowProjectId}?hl=en`} target="_blank" rel="noreferrer">
                    เปิดโปรเจกต์ใน Flow →
                  </a>
                )}
              </div>
```

`FlowJobRow` must expose `flowProjectId: string` — add it to the type and to the mapping in `lib/flow-queries.ts` (`flowProjectId: j.flowProjectId`). Change the "ผ่าน" button's `disabled` to `disabled={isPending || !canApproveRender(job.status, job.video !== null)}` and import `canApproveRender` from `@/lib/flow-jobs`. Keep "เรนเดอร์ใหม่" enabled.

- [ ] **Step 5: Report script**

Create `scripts/flow-activity-report.mjs`:

```js
/**
 * รายงานความถี่ที่บอทยิง Flow ในวันที่กำหนด (เวลาท้องถิ่น) — ใช้ตอนวิเคราะห์ว่า "ก่อนโดนแบน ยิงถี่แค่ไหน"
 * รัน: node scripts/flow-activity-report.mjs 2026-10-01   (ไม่ใส่วัน = วันนี้) · อ่านอย่างเดียว
 */
import Database from "better-sqlite3";
import path from "node:path";

const day = process.argv[2] ?? new Date().toLocaleDateString("sv-SE");
const start = new Date(`${day}T00:00:00`);
const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
const db = new Database(path.resolve("dev.db"), { readonly: true });
const rows = db
  .prepare("SELECT at, kind, jobId, round, detail FROM FlowActivity WHERE at >= ? AND at < ? ORDER BY at")
  .all(start.getTime(), end.getTime())
  .map((r) => ({ ...r, at: new Date(r.at) }));

const REQUEST = new Set(["generate_image", "generate_video", "upload", "new_project", "download"]);
const buckets = new Map();
for (const r of rows) {
  if (!REQUEST.has(r.kind)) continue;
  const b = new Date(r.at);
  b.setMinutes(Math.floor(b.getMinutes() / 10) * 10, 0, 0);
  const key = b.toTimeString().slice(0, 5);
  buckets.set(key, (buckets.get(key) ?? 0) + 1);
}
console.log(`FlowActivity ${day}: ${rows.length} แถว · คำขอ ${rows.filter((r) => REQUEST.has(r.kind)).length} ครั้ง`);
console.log("\nความถี่ต่อ 10 นาที:");
for (const [k, n] of [...buckets.entries()].sort()) console.log(`  ${k}  ${"#".repeat(n)} ${n}`);
const warns = rows.filter((r) => r.kind === "http_warn" || r.kind === "bot_signal");
console.log(`\nสัญญาณเตือน ${warns.length} ครั้ง:`);
for (const w of warns) console.log(`  ${w.at.toTimeString().slice(0, 8)}  ${w.kind}  ${w.detail}`);
const sessions = rows.filter((r) => r.kind === "session_start");
console.log(`\nเปิดบอท ${sessions.length} ครั้ง:`);
for (const s of sessions) console.log(`  ${s.at.toTimeString().slice(0, 8)}  ${s.detail}`);
const breaks = rows.filter((r) => r.kind === "break");
const totalBreak = breaks.reduce((sum, b) => sum + (JSON.parse(b.detail || "{}").ms ?? 0), 0);
console.log(`\nพักจริงรวม ${Math.round(totalBreak / 60000)} นาที (${breaks.length} ครั้ง)`);
```

Note: Prisma stores `DateTime` in SQLite as milliseconds since epoch for this project's adapter — verify by running the script against `dev-test.db` after Step 6 (change `dev.db` to `dev-test.db` temporarily, or add an optional 3rd argv for the DB path: `const dbPath = process.argv[3] ?? "dev.db";`). If `at` comes back as ISO text instead, compare with `start.toISOString()` strings.

- [ ] **Step 6: UI smoke on the test server**

Start `NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001`. With a scratch `better-sqlite3` script against **dev-test.db only**: insert 12 `FlowActivity` rows (`generate_image`, spread over the last hour, 4 of them within one 10-minute span) and one `http_warn` 20 minutes ago; set the existing `review_r3` job (if none, set one job to `status='review_r3', round=3`) and delete its `FlowJobImage` rows with `kind='video'`. Then with Playwright (`node`, chromium headless, 1440 px) load `/flow` and assert: banner contains "ยิง Flow วันนี้ 12 ครั้ง · ถี่สุด 4/10 นาที · สัญญาณเตือน: ล่าสุด"; the review_r3 row shows "คลิปเสร็จแล้วใน Flow แต่โหลดมาไม่ได้" and the "ผ่าน" button is disabled while "เรนเดอร์ใหม่" is enabled. Run `node scripts/flow-activity-report.mjs <today> dev-test.db` and confirm the 10-minute histogram shows a bucket of 4. Screenshot to your scratchpad. Kill port 3001, `git checkout -- tsconfig.json`, delete scratch rows/files.

- [ ] **Step 7: Type-check, lint, checks, commit**

Run: `npx tsc --noEmit && npm run lint && npm run check:flow && node scripts/check-showcase.mjs`
Expected: clean.

```bash
git add lib/flow-jobs.ts lib/flow-queries.ts components/flow-route.tsx components/flow-review-row.tsx scripts/flow-activity-report.mjs scripts/check-flow-jobs.mjs
git commit -m "/flow: activity strip, review row for a clip that could not be downloaded, report script

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Docs

**Files:**
- Modify: `CLAUDE.md` (Flow image bot section)
- Modify: `docs/superpowers/specs/2026-09-30-flow-bot-speed-and-resilience-design.md` (status line at top)

- [ ] **Step 1: CLAUDE.md**

Under the Flow image bot section, replace the bullet that starts `- **ค่าจังหวะ/เพดานทั้งหมดใน \`flow-worker.config.json\`**` with:

```md
- **ค่าจังหวะ/เพดานทั้งหมดใน `flow-worker.config.json`** (ไม่ต้อง build) — **เร่งแล้ว 2026-09-30** (spec `2026-09-30-flow-bot-speed-and-resilience-design.md`): พักระหว่างสินค้า 30-90 วิ · พักยาว 5-10 นาทีทุก 12-16 สินค้า · 60 ชุด/วัน · 20 คลิป/วัน — ผู้ใช้ยอมรับความเสี่ยงบนบัญชีสำรอง (4 สัปดาห์ก่อนหน้าไม่เคยเจอสัญญาณโดนจับ) · **ว่างนานเท่าพักยาวขั้นต่ำ = ไม่พักยาวซ้ำ** (`idleCountsAsLongBreak`) · ห้ามแตะ `actionDelayMs`/`typeCharDelayMs`/เส้นโค้งเมาส์
- **สมุดบันทึกการกระทำ `FlowActivity`** (`worker/activity.ts` fire-and-forget ห้าม throw · kind ใน `lib/flow-activity.ts`) — ทุก Generate/อัปโหลด/สร้างโปรเจกต์/โหลด + HTTP 429/403/5xx (`http_warn`) + captcha/login (`bot_signal`) + พักจริง + config ตอนเปิดบอท · หน้า /flow โชว์ "ยิง Flow วันนี้ N · ถี่สุด X/10 นาที · สัญญาณเตือน" · **โดนแบนเมื่อไหร่ รัน `node scripts/flow-activity-report.mjs <วัน>` ก่อนทำอย่างอื่น** แล้วตั้งบัญชีใหม่ให้อยู่ใต้ความถี่ที่เห็น
- **โหลดคลิป: ลิงก์ตรงก่อน เมนูทีหลัง คลิปที่เรนเดอร์แล้วไม่มีทาง failed** — hover ช่องคลิปแล้ว Flow ใส่ `<video src="https://flow-content.google/video/<uuid>?…">` ดึงได้ตรงๆ ไม่ต้อง cookie (`downloadVideoDirect`, `pickDirectVideoUrl` รับเฉพาะ host นี้) ได้ 720p · ไม่ได้ → เมนู (คีย์บอร์ด ArrowRight/ArrowDown/Enter ไม่ใช่เมาส์) · ไม่ได้อีก → `review_r3` **ไม่มีแถว video** + `errorMessage` บอกเหตุ หน้า /flow โชว์ลิงก์โปรเจกต์ให้โหลดเอง ปุ่ม "ผ่าน" ปิด (`canApproveRender`) "เรนเดอร์ใหม่" เปิด · 1080p (รอบ 4) ล้ม = `done` ด้วย 720p + หมายเหตุ ไม่หยุดคิว
```

- [ ] **Step 2: Spec status line**

At the top of the spec, under the title, add: `> สถานะ: implemented 2026-09-30 (plan `docs/superpowers/plans/2026-09-30-flow-bot-speed-and-resilience.md`) · ยังไม่ได้รันสดบน Flow — รอผู้ใช้กด "รันต่อ" งานแรก`

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-09-30-flow-bot-speed-and-resilience-design.md
git commit -m "Docs: pacing, FlowActivity, resilient clip download

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Deploy note for the user (not a task — the parent relays this)

`stop.bat` → `! cd "<repo>" && npx prisma migrate deploy && npx prisma generate` → `start.bat` → on `/flow` press "รันต่อ (หลังซ่อม)" on the failed render job (ตะขอหลังประตู) and "สร้างพรอมต์ตอนนี้" on the awaiting one. The first live run validates Tasks 4/5/7; if the direct download works, `steps.log` will contain `(ลิงก์ตรง)`.
