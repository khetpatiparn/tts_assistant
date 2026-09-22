# Showcase Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user pull TikTok Showcase products (name/price/commission/real product photos) from an external Chrome extension into `pooling_prompt`'s existing "หาสินค้า" candidate pool, then turn a chosen candidate into a `PromptEntry` with its photos auto-queued into the Flow bot — cutting the manual "type product name + hunt for source photos" step.

**Architecture:** Reuse the existing `ProductCandidate`/`CandidateBatch` tables (add an image side-table + a real-ID dedupe key), add one pure-logic module for parsing/normalizing the Showcase JSON contract, one image-download module, a DB-orchestration layer reused by both a manual-file-upload Server Action and a push-style API route, and a small UI addition for uploading + picking images before Flow-enqueue. No changes to the Flow worker itself.

**Tech Stack:** Next.js 16.2.10 (custom build) App Router, Prisma 7 + `@prisma/adapter-better-sqlite3`, Server Actions in `app/actions.ts`, plain Route Handlers for the new HTTP endpoints, no test framework — this repo verifies pure logic via hand-rolled `scripts/check-*.mjs` scripts (compile with `tsc`, import the JS, assert) and everything else via manual click-through on an isolated dev server.

**Spec:** `docs/superpowers/specs/2026-09-22-showcase-import-design.md` — this plan implements it task-by-task; read both.

## Global Constraints

- **No test runner in this repo.** Verification for pure `lib/*.ts` logic = a `scripts/check-*.mjs` script that compiles the file with `tsc` to a temp dir, imports the compiled JS, and asserts with hand-rolled `check()`/`checkDeep()` helpers (see `scripts/check-candidates.mjs` for the exact pattern to copy). There is no `npm test`.
- **Never run `npm run build`/`npm run dev` against the same `.next` the user's `start.bat` uses.** Use `npx tsc --noEmit` + `npm run lint` for type/lint checks; use `NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001` (after `cp dev.db dev-test.db`) for any UI click-through.
- **Check `git diff tsconfig.json` after any isolated dev-server run** and `git checkout -- tsconfig.json` if Next.js auto-patched it — this repo pins `target: "ES2017"` on purpose.
- **`dev.db` is WAL-mode.** New DB copies need `node scripts/enable-wal.mjs <file>` once. Never run unscoped `DELETE FROM`.
- **After any `prisma/schema.prisma` change:** `npx prisma migrate dev --name <name>` then `npx prisma generate`.
- **Import from `@/lib/generated/prisma/client` directly** — no barrel file.
- **Thai comment density matches the surrounding file** — this codebase writes long explanatory Thai comments at every non-obvious decision; match that style in new code, don't write terse English comments.
- **No arbitrary Tailwind sizes (`text-[...]`), no hex in `components/*`, buttons stay on `buttonVariants` sizing** — see CLAUDE.md Architecture section if any new UI needs styling decisions beyond reusing existing components.
- **This feature's data source is not yet permitted by TikTok** (documented in the spec's risk section) — this is accepted and out of scope to re-litigate in this plan.

---

## File Structure

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` | Modify: add `CandidateImage` model, add `sourceProductId` + relation to `ProductCandidate` |
| `lib/showcase-import.ts` | New. Pure logic: parse/validate the Showcase JSON payload → normalized rows. No Prisma, no `node:*` (mirrors `lib/candidates.ts`'s purity so it stays unit-checkable) |
| `lib/showcase-images.ts` | New. Image download: given a URL, fetch it and return `{buffer, ext}` or `null` on failure. Isolated because it does real I/O — kept separate from the pure parser so the parser stays trivially checkable |
| `app/actions.ts` | Modify: add `importShowcaseBatch()` (DB orchestration shared by both entry points), `importShowcaseFile()` (Server Action for the manual upload form), refactor `enqueueFlowJob` into a shared core + thin FormData wrapper, add `createEntryFromCandidateWithImages()` |
| `app/api/showcase-import/route.ts` | New. `POST` — secret-checked push endpoint from the extension, delegates to `importShowcaseBatch()` |
| `app/api/showcase-import/health/route.ts` | New. `GET` — liveness probe for the extension's connection-status indicator |
| `components/candidates-route.tsx` | Modify: add the manual `.json` upload form, add thumbnail rendering for candidates that have images |
| `components/candidate-image-picker.tsx` | New. Dialog shown when "สร้างงาน" is clicked on a candidate that has `CandidateImage` rows |
| `scripts/check-showcase-import.mjs` | New. Verifies `lib/showcase-import.ts` the way `scripts/check-candidates.mjs` verifies `lib/candidates.ts` |
| `showcase-extension/` | New top-level folder. Copied wholesale from the external project (Task 1) — self-contained `package.json`/build, not touched by any later task in this plan |

---

### Task 1: Copy the extension source into `showcase-extension/`

**Files:**
- Create: `showcase-extension/` (copy of `C:\Users\patip\Desktop\playground\Export Tiktok Production Lines Extension with Internal API\{extension,docs,README.md,package.json,package-lock.json,tsconfig.json,vitest.config.ts,playwright.config.ts,.gitignore,scripts,tests}`)

**Interfaces:**
- Produces: nothing consumed by later tasks — this folder is inert cargo, not wired into pooling_prompt's build. Later tasks only need to agree on the JSON *shape* it exports (documented in `docs/api-observations.md` inside the copy), which Task 3 encodes independently.

- [ ] **Step 1: Copy the source folder, excluding build artifacts and dependencies**

**Run this from the repo root you are actually working in** (if you were dispatched into an isolated worktree, that is this worktree's root, NOT the main checkout — use `$(pwd)` for the destination, never a hardcoded main-checkout path, since a worktree is a separate directory on disk):

```bash
SRC="/c/Users/patip/Desktop/playground/Export Tiktok Production Lines Extension with Internal API"
DST="$(pwd)/showcase-extension"
mkdir -p "$DST"
for item in extension docs README.md package.json package-lock.json tsconfig.json vitest.config.ts playwright.config.ts .gitignore scripts tests; do
  cp -r "$SRC/$item" "$DST/$item"
done
```

- [ ] **Step 2: Verify the copy still builds standalone, on its own toolchain**

```bash
cd showcase-extension
npm install
npm run typecheck
npm run build:mock
cd ..
```

Expected: all three succeed, `dist/` appears under `showcase-extension/`. This proves the copy is complete and self-contained (its own `node_modules`, own `dist`, no path assumptions on the original folder).

- [ ] **Step 3: Confirm it doesn't leak into pooling_prompt's own tooling**

```bash
git status --short showcase-extension | head -5   # sanity: files are untracked, ready to add
npx tsc --noEmit   # pooling_prompt's own typecheck — must still pass unchanged
```

Expected: `npx tsc --noEmit` at the repo root passes exactly as it did before this copy (the subfolder has its own `tsconfig.json`, so the root tsc run does not descend into it — confirm no new errors appeared).

- [ ] **Step 4: Add `showcase-extension/node_modules` and `dist*` to the root `.gitignore` if not already covered, commit**

```bash
grep -q "^showcase-extension/node_modules" .gitignore || echo "showcase-extension/node_modules/" >> .gitignore
grep -q "^showcase-extension/dist" .gitignore || printf "showcase-extension/dist/\nshowcase-extension/dist-release/\nshowcase-extension/coverage/\nshowcase-extension/test-results/\n" >> .gitignore
git add showcase-extension .gitignore
git commit -m "Copy showcase-extension source from the external project

Self-contained subfolder — own package.json/build, does not touch
pooling_prompt's own tooling. See docs/superpowers/specs/2026-09-22-showcase-import-design.md.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Prisma schema — `CandidateImage` + `sourceProductId`

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: `CandidateImage` model (`id`, `candidateId`, `filename`, `mimeType`, `sortOrder`, `createdAt`), `ProductCandidate.sourceProductId: String?`, `ProductCandidate.images: CandidateImage[]` — Task 5 and Task 8 write/read these directly via `prisma.candidateImage.*` and `prisma.productCandidate.findUnique({ include: { images: true } })`.

- [ ] **Step 1: Edit the schema**

In `prisma/schema.prisma`, add the new model right after `model ProductCandidate { ... }`:

```prisma
/// รูปสินค้าจริงจากร้าน ที่มากับ candidate บางแหล่ง (เช่น Showcase import) — candidate ที่มาจาก
/// แคปหน้าจัดอันดับแบบเดิมจะไม่มีแถวในตารางนี้เลย (ไม่ใช่ optional field ว่าง แต่ไม่มีแถวจริงๆ)
model CandidateImage {
  id          String           @id @default(cuid())
  candidateId String
  candidate   ProductCandidate @relation(fields: [candidateId], references: [id], onDelete: Cascade)
  filename    String
  mimeType    String
  sortOrder   Int              @default(0)
  createdAt   DateTime         @default(now())

  @@index([candidateId])
}
```

Then modify `model ProductCandidate` — add these two lines inside the model body (keep every existing field untouched) and one new `@@unique`:

```prisma
  /// Product ID จริงจาก Showcase — null สำหรับ candidate จากแคปหน้าจัดอันดับ (ไม่มี ID ที่เชื่อถือได้)
  sourceProductId String?
  images          CandidateImage[]
```

```prisma
  @@unique([batchId, sourceProductId])
```

(add this alongside the existing `@@unique([batchId, nameKey])` — both constraints coexist; SQLite treats `NULL` as distinct in unique indexes, so rows with `sourceProductId = null` never collide on this constraint and keep relying on the `nameKey` constraint as before.)

- [ ] **Step 2: Generate the migration**

```bash
npx prisma migrate dev --name add_candidate_image_and_source_product_id
```

Expected: migration applies cleanly to `dev.db`, no data loss warning (both new fields/table are additive).

- [ ] **Step 3: Regenerate the client**

```bash
npx prisma generate
```

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit
```

Expected: passes (nothing references the new fields yet).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "Add CandidateImage table and ProductCandidate.sourceProductId

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: `lib/showcase-import.ts` — parse & normalize the Showcase payload

**Files:**
- Create: `lib/showcase-import.ts`
- Create: `scripts/check-showcase-import.mjs`

**Interfaces:**
- Consumes: nothing (pure, no imports beyond plain TS).
- Produces:
  - `type ShowcaseProductRaw` — the shape a single product takes in the extension's exported JSON.
  - `type ShowcaseImportPayload = { products: ShowcaseProductRaw[] }`
  - `type NormalizedShowcaseCandidate = { sourceProductId: string; name: string; price: number; commission: number; categoryLabel: string; imageUrls: string[] }`
  - `function parseShowcasePayload(raw: unknown): { rows: NormalizedShowcaseCandidate[]; skipped: number }` — Task 5 calls this first, before touching Prisma.

- [ ] **Step 1: Write `lib/showcase-import.ts`**

```typescript
/**
 * แปลง JSON ที่ extension ภายนอก export มา → แถวที่พร้อม upsert ลง ProductCandidate
 *
 * Pure — ไม่มี Prisma ไม่มี node:* (ทดสอบด้วย scripts/check-showcase-import.mjs แบบเดียวกับ
 * lib/candidates.ts) shape ของ ShowcaseProductRaw อิงจาก data dictionary ที่ยืนยันจากบัญชีจริง
 * ในโปรเจกต์ extension ต้นทาง (docs/api-observations.md §2 ของโปรเจกต์นั้น) — ไม่ใช่การเดา
 */

export type ShowcaseProductRaw = {
  product_id: string;
  title: string;
  format_available_price: string;
  seller_info?: { shop_name?: string };
  affiliate_info?: { commission_rate?: number };
  category_info?: { name?: string };
  cover?: { url_list?: string[] };
  images?: { url_list?: string[] }[];
};

export type ShowcaseImportPayload = {
  products: ShowcaseProductRaw[];
};

export type NormalizedShowcaseCandidate = {
  sourceProductId: string;
  name: string;
  price: number;
  /** เปอร์เซ็นต์ (เช่น 12.5 = 12.5%) ไม่ใช่ basis points ดิบ — ดูหมายเหตุใน parseCommissionRate */
  commission: number;
  categoryLabel: string;
  imageUrls: string[];
};

/** "฿128.71" -> 128.71 — เอาทุกอย่างที่ไม่ใช่เลข/จุดออก ตามแบบ format_available_price ที่สังเกตได้ */
function parsePrice(display: string): number {
  const n = parseFloat(display.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/**
 * commission_rate ที่สังเกตได้ (1100/1200/1300/1600) มีหน่วยที่ "ยังไม่พิสูจน์" ตามที่โปรเจกต์
 * ต้นทางบันทึกไว้ตรงๆ — สมมติฐานที่ใช้ที่นี่ (ยึดตามรูปแบบ basis-points ที่พบบ่อยสุดใน API
 * TikTok/e-commerce ทั่วไป): หาร 100 ก่อนเก็บ (1200 -> 12.00%) ต้องตรวจกับข้อมูลจริงอีกทีใน
 * Task 12 (ทดสอบ end-to-end) ว่าตัวเลขที่ได้สมเหตุสมผลกับที่ผู้ใช้เห็นในหน้า Showcase จริงไหม
 */
function parseCommissionRate(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw)) return 0;
  return raw / 100;
}

export function parseShowcasePayload(raw: unknown): {
  rows: NormalizedShowcaseCandidate[];
  skipped: number;
} {
  if (typeof raw !== "object" || raw === null || !Array.isArray((raw as ShowcaseImportPayload).products)) {
    throw new Error("ไฟล์ไม่ใช่ Showcase export ที่ถูกต้อง — ต้องมี field 'products' เป็น array");
  }

  const products = (raw as ShowcaseImportPayload).products;
  const rows: NormalizedShowcaseCandidate[] = [];
  let skipped = 0;

  for (const p of products) {
    const productId = String(p.product_id ?? "").trim();
    const title = String(p.title ?? "").trim();
    // ไม่มี ID หรือไม่มีชื่อ = แถวใช้งานไม่ได้ ข้ามไปเงียบๆ นับไว้ใน skipped
    if (!productId || !title) {
      skipped++;
      continue;
    }

    const imageUrls = [
      ...(p.cover?.url_list ?? []),
      ...(p.images ?? []).flatMap((img) => img.url_list ?? []),
    ].filter((url): url is string => typeof url === "string" && url.length > 0);

    rows.push({
      sourceProductId: productId,
      name: title,
      price: parsePrice(p.format_available_price ?? ""),
      commission: parseCommissionRate(p.affiliate_info?.commission_rate),
      categoryLabel: p.category_info?.name ?? "",
      imageUrls,
    });
  }

  return { rows, skipped };
}
```

- [ ] **Step 2: Write the fixture used by the check script**

Create `tests/fixtures/showcase-sample.json` (repo root `tests/` — new folder, only for this fixture; this repo has no test runner so this is just static data, not a test-framework directory):

```json
{
  "products": [
    {
      "product_id": "1736476547228075452",
      "title": "ชั้นวางของในครัว 2 ชั้น",
      "format_available_price": "฿128.71",
      "seller_info": { "shop_name": "exampleshop_" },
      "affiliate_info": { "commission_rate": 1200 },
      "category_info": { "name": "เครื่องครัว" },
      "cover": { "url_list": ["https://p16-oec-sg.ibyteimg.com/example-cover.jpeg?sig=abc"] },
      "images": [
        { "url_list": ["https://p16-oec-sg.ibyteimg.com/example-1.jpeg?sig=abc"] },
        { "url_list": ["https://p16-oec-sg.ibyteimg.com/example-2.jpeg?sig=abc"] }
      ]
    },
    {
      "product_id": "",
      "title": "สินค้าไม่มี ID",
      "format_available_price": "฿50.00"
    },
    {
      "product_id": "1736141205259257672",
      "title": "PETLUSCI แผ่นลับเล็บแมว",
      "format_available_price": "฿70.00",
      "affiliate_info": { "commission_rate": 1600 },
      "category_info": { "name": "สัตว์เลี้ยง" }
    },
    {
      "product_id": "1735661139711723379",
      "title": "ชั้นวางของในครัว 1 ชั้น",
      "format_available_price": "฿99.00"
    }
  ]
}
```

(Third product has no `cover`/`images` — proves the parser tolerates missing image fields entirely. Fourth product has no `affiliate_info`/`category_info` at all — proves the parser falls back to `commission: 0`/`categoryLabel: ""` instead of throwing, matching the "affiliate_info shapes vary, fields can be missing entirely" finding from the source project's own data dictionary.)

- [ ] **Step 3: Write `scripts/check-showcase-import.mjs`**

```javascript
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
```

- [ ] **Step 4: Run it and confirm every line is PASS**

```bash
node scripts/check-showcase-import.mjs
```

Expected: `ALL PASS`, exit code 0. If any line is `FAIL`, fix `lib/showcase-import.ts` (not the check script) until it is.

- [ ] **Step 5: Commit**

```bash
git add lib/showcase-import.ts scripts/check-showcase-import.mjs tests/fixtures/showcase-sample.json
git commit -m "Add Showcase JSON parser with real-fixture verification

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: `lib/showcase-images.ts` — download a product image

**Files:**
- Create: `lib/showcase-images.ts`

**Interfaces:**
- Consumes: nothing beyond global `fetch` (Node 22+ has it built in — matches `showcase-extension`'s own `minimum: Node.js 22` requirement, and this repo's own scripts already assume a modern Node).
- Produces: `async function downloadImage(url: string): Promise<{ buffer: Buffer; ext: "jpg" | "png" | "webp" } | null>` — Task 5 calls this once per URL in `NormalizedShowcaseCandidate.imageUrls`; a `null` return means "skip this one image, keep going" per the spec's error-handling table.

- [ ] **Step 1: Write `lib/showcase-images.ts`**

```typescript
/**
 * โหลดรูปสินค้าจาก URL ที่มากับ Showcase JSON ลงเป็น Buffer — แยกจาก lib/showcase-import.ts
 * เพราะไฟล์นั้นต้องเป็น pure (ทดสอบด้วย scripts/check-showcase-import.mjs โดยไม่มี network)
 * ส่วนไฟล์นี้ทำ I/O จริง ไม่มี pure-logic ให้ check script ตรวจ — พึ่งการทดสอบ end-to-end
 * ใน Task 12 แทน (ตาม pattern เดียวกับ lib/tiktok-oembed.ts ซึ่งเป็นจุดยิงเน็ตอีกจุดของแอปนี้)
 *
 * โหลดไม่สำเร็จ (URL หมดอายุ/เน็ตมีปัญหา/ไม่ใช่รูปจริง) = คืน null ไม่ throw — ผู้เรียก (Task 5)
 * ตัดสินใจว่าจะข้ามรูปนั้นแล้วไปต่อ ตามที่ระบุไว้ในสเปกหัวข้อ error handling
 */

const TIMEOUT_MS = 15_000;

const EXT_BY_CONTENT_TYPE: Record<string, "jpg" | "png" | "webp"> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function downloadImage(
  url: string
): Promise<{ buffer: Buffer; ext: "jpg" | "png" | "webp" } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;

    const contentType = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    const ext = EXT_BY_CONTENT_TYPE[contentType];
    if (!ext) return null; // ไม่ใช่รูปที่รองรับ (หรือ response ไม่ใช่รูปเลย เช่นหน้า error HTML)

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0) return null;
    return { buffer, ext };
  } catch {
    // timeout, network error, DNS ล้มเหลว ฯลฯ — ทั้งหมดคือ "โหลดไม่สำเร็จ" เหมือนกัน
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Manual smoke check against a real public image URL (no fixture — this is real I/O, not pure logic)**

```bash
node -e "
const { pathToFileURL } = require('node:url');
(async () => {
  const out = require('node:fs').mkdtempSync('.check-showcase-images-tmp-');
  require('node:child_process').execFileSync('npx', ['tsc', 'lib/showcase-images.ts', '--outDir', out, '--module', 'es2022', '--target', 'ES2017', '--moduleResolution', 'bundler'], { stdio: 'inherit', shell: true });
  const m = await import(pathToFileURL(require('node:path').join(out, 'showcase-images.js')).href);
  const ok = await m.downloadImage('https://httpbin.org/image/jpeg');
  console.log('downloaded real jpeg:', ok !== null && ok.ext === 'jpg' && ok.buffer.length > 0);
  const bad = await m.downloadImage('https://httpbin.org/status/404');
  console.log('404 returns null:', bad === null);
  require('node:fs').rmSync(out, { recursive: true, force: true });
})();
"
```

Expected: both lines print `true`. This is a one-off manual check (not saved as a script) because it depends on network reachability, unlike the pure-logic check in Task 3.

- [ ] **Step 4: Commit**

```bash
git add lib/showcase-images.ts
git commit -m "Add Showcase product image downloader

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: DB orchestration — `importShowcaseBatch` + manual-upload Server Action

**Files:**
- Modify: `app/actions.ts`

**Interfaces:**
- Consumes: `parseShowcasePayload` (Task 3), `downloadImage` (Task 4), `prisma.candidateBatch`/`prisma.productCandidate`/`prisma.candidateImage` (Task 2).
- Produces:
  - `async function importShowcaseBatch(payload: unknown): Promise<{ batchId: string; added: number; skipped: number; imagesFailed: number }>` — Task 10's API route calls this directly.
  - `async function importShowcaseFile(formData: FormData): Promise<{ batchId: string; added: number; skipped: number; imagesFailed: number }>` — the manual-upload Server Action, thin wrapper that reads the uploaded file's text and calls `importShowcaseBatch`. Task 6's UI calls this.

- [ ] **Step 1: Add imports at the top of `app/actions.ts`**

Add alongside the existing imports (near where `extractCandidateRows`/`parseCandidateRows` are imported for the existing candidates feature):

```typescript
import { parseShowcasePayload } from "@/lib/showcase-import";
import { downloadImage } from "@/lib/showcase-images";
```

- [ ] **Step 2: Add `importShowcaseBatch` right after `createEntryFromCandidate` (the natural neighbor — both work on the candidates feature)**

```typescript
const CANDIDATE_IMAGE_ROOT = path.join(process.cwd(), "uploads", "_candidates");

/**
 * นำเข้า Showcase JSON (จาก extension ภายนอก หรือไฟล์ที่อัปโหลดมือ) → CandidateBatch ใหม่
 *
 * ต่างจาก extractCandidates (แคปหน้าจัดอันดับ) ตรงที่มี Product ID จริงให้ dedupe และมีรูปสินค้า
 * จริงติดมาด้วย — โหลดรูปลงดิสก์ทันทีในฟังก์ชันนี้เพราะ URL ในไฟล์ JSON หมดอายุได้ (ดูสเปก)
 *
 * โหลดรูปบางรูปไม่สำเร็จ = ข้ามเฉพาะรูปนั้น ไม่ทำทั้ง candidate fail (ดูสเปกหัวข้อ error handling)
 */
export async function importShowcaseBatch(
  payload: unknown
): Promise<{ batchId: string; added: number; skipped: number; imagesFailed: number }> {
  const { rows, skipped } = parseShowcasePayload(payload);
  if (rows.length === 0) {
    throw new Error("ไม่มีสินค้าที่นำเข้าได้เลยสักรายการในไฟล์นี้");
  }

  const capturedOn = new Date();
  let imagesFailed = 0;

  // สร้างชุด + candidate ทุกแถวในทรานแซกชันเดียวก่อน (เหมือน extractCandidates) — การโหลดรูป
  // (I/O ช้า, ไม่ transactional) ทำแยกหลัง transaction commit แล้ว เพื่อไม่ให้ธุรกรรม DB ค้าง
  // รอ network นานเกินไป — ถ้าโหลดรูปพังกลางทาง candidate ที่สร้างไปแล้วยังอยู่ครบ แค่ไม่มีรูป
  const batch = await prisma.$transaction(async (tx) => {
    const created = await tx.candidateBatch.create({ data: { capturedOn } });
    for (const row of rows) {
      await tx.productCandidate.upsert({
        where: { batchId_sourceProductId: { batchId: created.id, sourceProductId: row.sourceProductId } },
        create: {
          batchId: created.id,
          name: row.name,
          nameKey: normalizeName(row.name),
          price: row.price,
          commission: row.commission,
          weeklySales: null,
          categoryLabel: row.categoryLabel,
          sourceProductId: row.sourceProductId,
          capturedOn,
        },
        update: {
          name: row.name,
          price: row.price,
          commission: row.commission,
          categoryLabel: row.categoryLabel,
        },
      });
    }
    return created;
  });

  const created = await prisma.productCandidate.findMany({
    where: { batchId: batch.id },
    select: { id: true, sourceProductId: true },
  });
  const idByProductId = new Map(created.map((c) => [c.sourceProductId, c.id]));

  for (const row of rows) {
    const candidateId = idByProductId.get(row.sourceProductId);
    if (!candidateId) continue; // ไม่ควรเกิด แต่กันไว้เผื่อ race
    const dir = path.join(CANDIDATE_IMAGE_ROOT, candidateId);
    let sortOrder = 0;
    for (const url of row.imageUrls) {
      const downloaded = await downloadImage(url);
      if (!downloaded) {
        imagesFailed++;
        continue;
      }
      await mkdir(dir, { recursive: true });
      const filename = `${crypto.randomUUID()}.${downloaded.ext}`;
      await writeFile(path.join(dir, filename), downloaded.buffer);
      await prisma.candidateImage.create({
        data: {
          candidateId,
          filename,
          mimeType: `image/${downloaded.ext === "jpg" ? "jpeg" : downloaded.ext}`,
          sortOrder: sortOrder++,
        },
      });
    }
  }

  revalidatePath("/products");
  return { batchId: batch.id, added: created.length, skipped, imagesFailed };
}

/** ทางสำรอง — อัปโหลดไฟล์ .json มือแทนการรับ push จาก extension */
export async function importShowcaseFile(
  formData: FormData
): Promise<{ batchId: string; added: number; skipped: number; imagesFailed: number }> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("กรุณาเลือกไฟล์ .json ที่ export มาจาก extension");
  }
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("ไฟล์ไม่ใช่ JSON ที่ถูกต้อง");
  }
  return importShowcaseBatch(parsed);
}
```

- [ ] **Step 3: Add the compound-unique-key helper Prisma expects**

Prisma names the composite `@@unique([batchId, sourceProductId])` field `batchId_sourceProductId` by default (same convention already used for `batchId_nameKey` in the existing model — no code change needed beyond what Step 2 already assumes, just confirming here so the implementer doesn't second-guess the generated name). Run:

```bash
npx tsc --noEmit
```

Expected: passes. If `batchId_sourceProductId` is reported as unknown, open `lib/generated/prisma/client` and confirm the actual generated key name matches (rerun `npx prisma generate` if Task 2 wasn't regenerated after schema edits — should already be done, this is a safety check).

- [ ] **Step 4: Commit**

```bash
git add app/actions.ts
git commit -m "Add importShowcaseBatch and importShowcaseFile

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5b: Harden `lib/showcase-images.ts` against SSRF and resource exhaustion

**Added after Task 4 was already merged**, by a background automated security review that
flagged two real issues the original task's review didn't ask its reviewer to check for.
`downloadImage(url)` fetches an arbitrary URL server-side; once Task 5 wires it into
`importShowcaseBatch`, that URL comes from a payload that is only semi-trusted (pushed by an
external client through a shared-secret-gated endpoint, or uploaded as a plain `.json` file
with zero gating) — this task closes both gaps before Task 6/9's UI make the feature end-to-end
usable.

**Files:**
- Modify: `lib/showcase-images.ts`

**Interfaces:**
- Consumes: `node:dns/promises`, `node:net` (both Node built-ins, no new dependency).
- Produces: `downloadImage`'s exported signature is UNCHANGED (`(url: string) => Promise<{buffer, ext} | null>`) — callers (Task 5, already written) need no changes. The added safety checks fold into the existing "return null on any failure" contract, so a blocked URL just looks like any other failed download to the caller.

- [ ] **Step 1: Replace `lib/showcase-images.ts` with the hardened version**

```typescript
/**
 * โหลดรูปสินค้าจาก URL ที่มากับ Showcase JSON ลงเป็น Buffer — แยกจาก lib/showcase-import.ts
 * เพราะไฟล์นั้นต้องเป็น pure (ทดสอบด้วย scripts/check-showcase-import.mjs โดยไม่มี network)
 * ส่วนไฟล์นี้ทำ I/O จริง ไม่มี pure-logic ให้ check script ตรวจ — พึ่งการทดสอบ end-to-end
 * ใน Task 12 แทน (ตาม pattern เดียวกับ lib/tiktok-oembed.ts ซึ่งเป็นจุดยิงเน็ตอีกจุดของแอปนี้)
 *
 * โหลดไม่สำเร็จ (URL หมดอายุ/เน็ตมีปัญหา/ไม่ใช่รูปจริง/ไม่ผ่านเกณฑ์ความปลอดภัยด้านล่าง) =
 * คืน null ไม่ throw — ผู้เรียก (Task 5) ตัดสินใจว่าจะข้ามรูปนั้นแล้วไปต่อ
 *
 * เพิ่มเมื่อ 2026-09-22 (หลัง security review อัตโนมัติของ commit ที่สร้างไฟล์นี้ครั้งแรก):
 * URL ในนี้มาจาก payload ที่ยังเชื่อใจได้แค่ครึ่งเดียว (ยิงมาจาก extension ผ่าน endpoint ที่มี
 * secret คุ้มครอง หรืออัปโหลดเป็นไฟล์ .json มือที่ไม่มีการคุ้มครองเลย) — ถ้าไม่กัน จะเปิดช่องให้
 * ยิง request จากเซิร์ฟเวอร์ไปยัง URL ภายในเครื่อง/เครือข่ายได้ (SSRF) เช่น
 * http://169.254.169.254/... (cloud metadata) หรือ service ภายใน LAN — จึงบังคับ https: เท่านั้น
 * (ตรงกับ URL รูปจริงที่สังเกตได้ทั้งหมดอยู่แล้ว) และปฏิเสธ hostname ที่ resolve เข้า IP
 * ส่วนตัว/loopback/link-local ก่อนยิง fetch จริงทุกครั้ง — ป้องกัน resource exhaustion คู่กันด้วย
 * การเช็ค Content-Length ก่อนโหลด (ถ้ามี) บวกเช็คขนาด buffer จริงหลังโหลดเป็นด่านสำรอง (เผื่อ
 * server โกหก header) ร่วมกับ timeout เดิม 15 วิที่จำกัดปริมาณสูงสุดที่โหลดได้ต่อครั้งอยู่แล้ว
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const TIMEOUT_MS = 15_000;
const MAX_BYTES = 20 * 1024 * 1024; // 20MB — เผื่อเหลือเฟือสำหรับรูปสินค้าจริง กันการโหลดมโหฬาร

const EXT_BY_CONTENT_TYPE: Record<string, "jpg" | "png" | "webp"> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** ช่วง IP ที่ไม่ควรให้เซิร์ฟเวอร์ยิง request ไปหาเอง (loopback, private, link-local/cloud metadata) */
function isPrivateOrReservedIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const parts = ip.split(".").map(Number);
    const [a, b] = parts;
    if (a === 127) return true; // loopback
    if (a === 10) return true; // RFC1918
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 192 && b === 168) return true; // RFC1918
    if (a === 169 && b === 254) return true; // link-local รวม cloud metadata (169.254.169.254)
    if (a === 0) return true; // "this network"
    return false;
  }
  // IPv6 — กันแบบหยาบเท่าที่ป้องกันเคสที่พบบ่อยสุด (loopback, unique-local, link-local)
  const lower = ip.toLowerCase();
  return lower === "::1" || lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd");
}

/** ตรวจก่อน fetch ทุกครั้ง — https เท่านั้น + resolve แล้วต้องไม่ใช่ IP ภายใน */
async function isUrlSafe(url: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const hostname = parsed.hostname;
  if (hostname === "localhost") return false;
  if (isIP(hostname)) return !isPrivateOrReservedIp(hostname);
  try {
    const { address } = await lookup(hostname);
    return !isPrivateOrReservedIp(address);
  } catch {
    return false; // resolve ไม่ได้ = ปฏิเสธไว้ก่อน
  }
}

export async function downloadImage(
  url: string
): Promise<{ buffer: Buffer; ext: "jpg" | "png" | "webp" } | null> {
  if (!(await isUrlSafe(url))) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;

    const contentLength = res.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_BYTES) return null;

    const contentType = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    const ext = EXT_BY_CONTENT_TYPE[contentType];
    if (!ext) return null; // ไม่ใช่รูปที่รองรับ (หรือ response ไม่ใช่รูปเลย เช่นหน้า error HTML)

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0) return null;
    if (buffer.length > MAX_BYTES) return null; // ด่านสำรอง เผื่อ Content-Length ไม่มี/โกหก
    return { buffer, ext };
  } catch {
    // timeout, network error, DNS ล้มเหลว ฯลฯ — ทั้งหมดคือ "โหลดไม่สำเร็จ" เหมือนกัน
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Manual verification — both the original smoke test AND the new safety checks**

```bash
node -e "
const { pathToFileURL } = require('node:url');
(async () => {
  const out = require('node:fs').mkdtempSync('.check-showcase-images-tmp-');
  require('node:child_process').execFileSync('npx', ['tsc', 'lib/showcase-images.ts', '--outDir', out, '--module', 'es2022', '--target', 'ES2017', '--moduleResolution', 'bundler'], { stdio: 'inherit', shell: true });
  const m = await import(pathToFileURL(require('node:path').join(out, 'showcase-images.js')).href);

  const ok = await m.downloadImage('https://httpbin.org/image/jpeg');
  console.log('still downloads a real https jpeg:', ok !== null && ok.ext === 'jpg');

  const http = await m.downloadImage('http://httpbin.org/image/jpeg');
  console.log('plain http:// is rejected:', http === null);

  const localhost = await m.downloadImage('https://localhost:1/whatever');
  console.log('https://localhost is rejected:', localhost === null);

  const metadata = await m.downloadImage('https://169.254.169.254/latest/meta-data/');
  console.log('link-local/cloud-metadata IP is rejected:', metadata === null);

  const privateIp = await m.downloadImage('https://192.168.1.1/');
  console.log('private RFC1918 IP is rejected:', privateIp === null);

  require('node:fs').rmSync(out, { recursive: true, force: true });
})();
"
```

Expected: all five lines print `true`. If `httpbin.org` (or any substitute URL you use, per Task 4's original note about network reachability) is unreachable from your environment, still run the scheme/IP-rejection checks (they don't need the target to actually respond — the rejection happens before or independent of a real successful fetch for the localhost/metadata/private-IP cases specifically, though note the DNS `lookup()` call itself still needs working DNS resolution even for a rejected hostname like `localhost`, which resolves locally without external network).

- [ ] **Step 4: Commit**

```bash
git add lib/showcase-images.ts
git commit -m "Harden downloadImage against SSRF and resource exhaustion

Flagged by an automated security review of the original commit
(flow: lib/showcase-images.ts fetches an arbitrary URL server-side
that will soon come from a semi-trusted Showcase-import payload).
Restricts to https:, rejects hostnames resolving to private/loopback/
link-local IPs (blocks cloud metadata + LAN targets), and caps
response size via Content-Length pre-check + a post-download backstop.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: UI — manual upload form + candidate thumbnails

**Files:**
- Modify: `lib/candidate-queries.ts` (NOT `app/products/page.tsx` — confirmed by reading the actual
  code: `app/products/page.tsx` only calls `getCandidatesData()` from `lib/candidate-queries.ts` and
  passes the result straight through to `<CandidatesRoute>`; the `prisma.productCandidate.findMany`
  call and the `CandidateRow` type both live in `lib/candidate-queries.ts`)
- Modify: `components/candidates-route.tsx`

**Interfaces:**
- Consumes: `importShowcaseFile` (Task 5).
- Produces: `CandidateRow.images: { id: string; filename: string }[]` (widened type) — nothing else consumed by later tasks. (Task 9 adds a *separate* new component for the image picker; it does not extend this file's exports.)

- [ ] **Step 1: Widen `lib/candidate-queries.ts` to include and expose each candidate's images**

Three small edits to `lib/candidate-queries.ts`:

1. Add `images` to the `CandidateRow` type (add this line anywhere in the type body, e.g. right after `linkedEntryId: string | null;`):

```typescript
  images: { id: string; filename: string }[];
```

2. Add `include` to the existing `prisma.productCandidate.findMany` call:

```typescript
    prisma.productCandidate.findMany({
      orderBy: { capturedOn: "desc" },
      include: { images: { orderBy: { sortOrder: "asc" }, select: { id: true, filename: true } } },
    }),
```

(this replaces the current `prisma.productCandidate.findMany({ orderBy: { capturedOn: "desc" } })` — same call, same position in the `Promise.all([...])` array, just with the new `include` added)

3. Add `images: c.images,` to the `rowsWithoutBadges` mapping (the object literal that starts `id: c.id, batchId: c.batchId, ...` — add the new field anywhere in that object, e.g. right after `linkedEntryId: c.linkedEntryId,`).

- [ ] **Step 2: Add the import and a small upload form in `components/candidates-route.tsx`**

Add to the existing import block from `@/app/actions` (currently `createEntryFromCandidate, deleteCandidateBatch, extractCandidates`):

```typescript
import {
  createEntryFromCandidate,
  deleteCandidateBatch,
  extractCandidates,
  importShowcaseFile,
} from "@/app/actions";
```

Add a sibling upload form (find the existing screenshot-capture upload UI — the file already has an `extractCandidates`-driven flow using `files`/`setFiles`/`handleExtract`, `isExtracting`/`startExtracting`, and a `result`/`setResult` state that `handleExtract` already uses for its success message; place this new form right after that UI, inside the same card/section, and reuse `result`/`setResult`/`error`/`setError`/`isUpdating`/`startUpdating` — do not introduce new state for this):

```tsx
<form
  className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-3"
  action={(formData) => {
    setError(null);
    setResult(null);
    startUpdating(async () => {
      try {
        const r = await importShowcaseFile(formData);
        setResult(
          `นำเข้า ${r.added} รายการ` +
            (r.skipped > 0 ? ` · ข้ามบรรทัดที่อ่านไม่ออก ${r.skipped}` : "") +
            (r.imagesFailed > 0 ? ` · โหลดรูปไม่สำเร็จ ${r.imagesFailed} รูป` : "")
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "นำเข้าไฟล์ไม่สำเร็จ");
      }
    });
  }}
>
  <label className="text-sm leading-relaxed text-foreground" htmlFor="showcase-json">
    นำเข้าจากไฟล์ Showcase (.json)
  </label>
  <input
    id="showcase-json"
    name="file"
    type="file"
    accept="application/json"
    required
    className="text-sm"
  />
  <Button type="submit" disabled={isUpdating}>
    นำเข้า
  </Button>
</form>
```

- [ ] **Step 3: Render thumbnails for candidates that have images**

Find the row-rendering code for a single `CandidateRow` (the table row / card that shows name/price/commission and the "สร้างงาน" button, inside the `.map()` over `visible`). Add a thumbnail strip when `r.images.length > 0`:

```tsx
{r.images.length > 0 && (
  <div className="flex gap-1">
    {r.images.slice(0, 3).map((img) => (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        key={img.id}
        src={`/api/uploads/_candidates/${r.id}/${img.filename}`}
        alt=""
        className="size-10 rounded border border-border object-cover"
      />
    ))}
  </div>
)}
```

This reuses the existing `app/api/uploads/[...path]/route.ts` handler that already serves `uploads/<entryId>/...` — confirm it also serves `uploads/_candidates/...` (same catch-all path segment, no special-casing needed) by opening one such URL directly in the browser during Task 12's manual pass; if it turns out to special-case the path in a way that rejects `_candidates`, that's a real finding to report, not something to route around silently.

- [ ] **Step 4: Typecheck and lint**

```bash
npx tsc --noEmit
npm run lint
```

- [ ] **Step 5: Commit**

```bash
git add lib/candidate-queries.ts components/candidates-route.tsx
git commit -m "Add manual Showcase JSON upload and candidate thumbnails

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Refactor `enqueueFlowJob` into a shared core

**Files:**
- Modify: `app/actions.ts`

**Interfaces:**
- Consumes: existing `FLOW_STATUS`, `sourceFilename`, `UPLOAD_ROOT` (all already in scope in `app/actions.ts`).
- Produces: `async function enqueueFlowJobCore(entryId: string, images: { buffer: Buffer; mimeType: string }[]): Promise<string>` — Task 8 calls this directly with buffers read from `CandidateImage` files on disk, bypassing the FormData-only path.

- [ ] **Step 1: Extract the core out of the existing `enqueueFlowJob`**

Replace the current `enqueueFlowJob` function body with:

```typescript
/**
 * แกนกลางของการเข้าคิว Flow — แยกจาก FormData เพราะตอนนี้มีสองต้นทางของรูป:
 * (1) ผู้ใช้อัปโหลดผ่านฟอร์ม (FormData, path เดิม) (2) รูปที่โหลดมาแล้วจาก Showcase import
 * ผ่าน CandidateImage (Task 8) — ทั้งสองทางต้องได้ผลลัพธ์เดียวกันทุกจุด (validation, FlowJob
 * ที่สร้าง, error message) จึงรวมไว้ที่เดียวแล้วให้สองทางเรียกใช้ร่วมกัน
 */
async function enqueueFlowJobCore(
  entryId: string,
  images: { buffer: Buffer; mimeType: string }[]
): Promise<string> {
  if (!entryId) throw new Error("ไม่พบรายการที่ต้องการเข้าคิว Flow");
  const entry = await prisma.promptEntry.findUnique({ where: { id: entryId }, select: { id: true, productName: true } });
  if (!entry) throw new Error("ไม่พบรายการที่ต้องการเข้าคิว Flow");
  if (entry.productName.trim() === "") throw new Error("ต้องมีชื่อสินค้าก่อน (พรอมต์ของ Flow ใช้ชื่อสินค้า)");

  const open = await prisma.flowJob.findFirst({
    where: { entryId, status: { notIn: [FLOW_STATUS.DONE, FLOW_STATUS.SKIPPED] } },
    select: { id: true },
  });
  if (open) throw new Error("รายการนี้มีงาน Flow ค้างอยู่แล้ว");

  if (images.length === 0) throw new Error("กรุณาเลือกรูปแคปสินค้าอย่างน้อย 1 รูป");
  for (const img of images) {
    // HEIC ไม่รับ — Flow อัปโหลดไม่ได้ และ Playwright ส่งไฟล์ตามที่เป็น
    if (!["image/jpeg", "image/png", "image/webp"].includes(img.mimeType)) {
      throw new Error("รองรับเฉพาะ JPEG, PNG, WebP");
    }
    if (img.buffer.length > MAX_IMAGE_BYTES) throw new Error("ไฟล์ใหญ่เกิน 10MB");
  }

  const dir = path.join(UPLOAD_ROOT, entryId, "flow");
  await mkdir(dir, { recursive: true });

  const job = await prisma.flowJob.create({ data: { entryId, status: FLOW_STATUS.QUEUED_R1, round: 1, attempt: 1 } });
  for (const [index, img] of images.entries()) {
    const filename = sourceFilename(index, extFromMime(img.mimeType));
    await writeFile(path.join(dir, filename), img.buffer);
    await prisma.flowJobImage.create({
      data: { jobId: job.id, kind: "source", round: 0, attempt: 1, index, filename, mimeType: img.mimeType },
    });
  }

  revalidatePath("/flow");
  revalidatePath(`/entry/${entryId}`);
  return job.id;
}

/** อัปรูปแคปสินค้า + สร้างงาน queued_r1 — 1 entry มีงานค้างได้ทีละ 1 */
export async function enqueueFlowJob(formData: FormData): Promise<string> {
  const entryId = String(formData.get("entryId") ?? "").trim();
  const files = formData.getAll("files").filter((v): v is File => v instanceof File && v.size > 0);
  const images = await Promise.all(
    files.map(async (file) => ({ buffer: Buffer.from(await file.arrayBuffer()), mimeType: file.type }))
  );
  return enqueueFlowJobCore(entryId, images);
}
```

This is a pure refactor — behavior for every existing caller of `enqueueFlowJob(formData)` must be byte-for-byte identical (same error messages, same validation order, same DB writes).

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Manual regression check on the isolated dev server**

```bash
cp dev.db dev-test.db
node scripts/enable-wal.mjs dev-test.db
NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001
```

Open an existing entry with no open Flow job, use the existing "รูปแคปสินค้า → ให้บอทวาดใน Flow" panel exactly as before, confirm:
- Uploading 1+ image still creates a `queued_r1` job (visible on `/flow`)
- Uploading a `.gif`/oversized file still shows the same error messages as before this refactor
- Uploading to an entry that already has an open job still shows "รายการนี้มีงาน Flow ค้างอยู่แล้ว"

Then `git diff tsconfig.json` — revert with `git checkout -- tsconfig.json` if Next.js patched it, per Global Constraints.

- [ ] **Step 4: Commit**

```bash
git add app/actions.ts
git commit -m "Refactor enqueueFlowJob into a shared core

Extracts enqueueFlowJobCore(entryId, images) so a second call site
(candidate-image path, next task) can enqueue without going through
FormData. No behavior change for the existing form-based caller.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: `createEntryFromCandidateWithImages`

**Files:**
- Modify: `app/actions.ts`

**Interfaces:**
- Consumes: `enqueueFlowJobCore` (Task 7), `prisma.candidateImage`, `prisma.productCandidate`.
- Produces: `async function createEntryFromCandidateWithImages(candidateId: string, chosenImageIds: string[]): Promise<string>` — Task 9's picker dialog calls this on confirm; returns the new `entryId` the same way `createEntryFromCandidate` does (caller navigates to `/entry/${id}`).

- [ ] **Step 1: Add the function right after the existing `createEntryFromCandidate`**

```typescript
/**
 * เหมือน createEntryFromCandidate แต่สำหรับ candidate ที่มีรูป (มาจาก Showcase import) —
 * สร้าง entry แล้ว "ก็อป" รูปที่ผู้ใช้เลือกจาก uploads/_candidates/<candidateId>/ เข้าคิว Flow
 * ทันที (ผ่าน enqueueFlowJobCore) แทนที่จะปล่อยให้ผู้ใช้ไปอัปโหลดรูปเองที่หน้า entry
 */
export async function createEntryFromCandidateWithImages(
  candidateId: string,
  chosenImageIds: string[]
): Promise<string> {
  if (chosenImageIds.length === 0) {
    throw new Error("กรุณาเลือกรูปอย่างน้อย 1 รูป");
  }

  const candidate = await prisma.productCandidate.findUnique({
    where: { id: candidateId },
    include: { images: true },
  });
  if (!candidate) throw new Error("ไม่พบสินค้าที่เลือก");

  const chosen = candidate.images.filter((img) => chosenImageIds.includes(img.id));
  if (chosen.length !== chosenImageIds.length) {
    throw new Error("รูปที่เลือกบางรูปไม่ตรงกับสินค้านี้");
  }

  const active = await prisma.corePrompt.findFirst({ where: { isActive: true, kind: "core" } });

  const created = await prisma.promptEntry.create({
    data: {
      productName: candidate.name,
      productInfo: "",
      riskModule: "",
      extraNotes: "",
      images: "[]",
      corePromptId: active?.id ?? null,
    },
  });

  await prisma.productCandidate.update({
    where: { id: candidateId },
    data: { linkedEntryId: created.id },
  });

  const images = await Promise.all(
    chosen.map(async (img) => ({
      buffer: await readFile(path.join(CANDIDATE_IMAGE_ROOT, candidateId, img.filename)),
      mimeType: img.mimeType,
    }))
  );
  // เข้าคิว Flow — ถ้าพังตรงนี้ (เช่น รูปหายจากดิสก์) entry ยังถูกสร้างไปแล้ว ผู้ใช้ไปอัปโหลด
  // รูปเองที่หน้า entry ได้ตามปกติ ไม่ทำให้ entry ที่สร้างไปแล้วหายหรือใช้งานไม่ได้
  try {
    await enqueueFlowJobCore(created.id, images);
  } catch (err) {
    console.error("เข้าคิว Flow อัตโนมัติไม่สำเร็จ ผู้ใช้ต้องอัปโหลดรูปเองที่หน้า entry:", err);
  }

  revalidatePath("/products");
  revalidatePath("/");
  return created.id;
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add app/actions.ts
git commit -m "Add createEntryFromCandidateWithImages

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: UI — image picker dialog

**Files:**
- Create: `components/candidate-image-picker.tsx`
- Modify: `components/candidates-route.tsx`

**Interfaces:**
- Consumes: `createEntryFromCandidateWithImages` (Task 8), `createEntryFromCandidate` (existing, for the no-image path).
- Produces: nothing consumed further — this is the top of the UI call chain for this feature.

- [ ] **Step 1: Write `components/candidate-image-picker.tsx`**

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export type CandidateImageOption = { id: string; filename: string };

export function CandidateImagePicker({
  candidateId,
  images,
  onConfirm,
  onCancel,
}: {
  candidateId: string;
  images: CandidateImageOption[];
  onConfirm: (candidateId: string, chosenImageIds: string[]) => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-lg border border-border bg-surface p-4">
        <h3 className="text-sm font-semibold leading-relaxed text-foreground">
          เลือกรูปที่จะใช้เป็นรูปอ้างอิงให้ Flow
        </h3>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {images.map((img) => {
            const isSelected = selected.has(img.id);
            return (
              <button
                key={img.id}
                type="button"
                onClick={() => toggle(img.id)}
                className={`overflow-hidden rounded-md border-2 outline-none ${
                  isSelected ? "border-primary" : "border-border-interactive"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/uploads/_candidates/${candidateId}/${img.filename}`}
                  alt=""
                  className="aspect-square w-full object-cover"
                />
              </button>
            );
          })}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            ยกเลิก
          </Button>
          <Button
            type="button"
            disabled={selected.size === 0}
            onClick={() => onConfirm(candidateId, [...selected])}
          >
            สร้างงาน ({selected.size} รูป)
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Read the current call sites first — there are TWO, not one**

```bash
grep -n "handleCreate" components/candidates-route.tsx
```

Confirmed by reading the file directly: the definition is at `components/candidates-route.tsx:179-187`:

```typescript
function handleCreate(id: string) {
  startUpdating(async () => {
    try {
      await createEntryFromCandidate(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "สร้างรายการไม่สำเร็จ");
    }
  });
}
```

and it is called from **two separate places** — `onClick={() => handleCreate(r.id)}` at both line 469 and line 702 (one for the card layout used below `md`, one for the table layout used at `md` and up — this file renders the same row data twice for the two breakpoints, per its own existing pattern of "ใช้ร่วมกันทั้งการ์ด...และตาราง"). Both call sites iterate the same `CandidateRow` rows and use `r` as the loop variable. **Both must be updated**, not just one — missing the second one means the image picker only appears on one screen size and the other silently falls back to instant blank-entry creation, which would be a real, easy-to-miss regression since it only shows up at certain viewport widths.

- [ ] **Step 3: Change the signature to take the full candidate, not just its id**

Replace the function and update both call sites:

```typescript
import { CandidateImagePicker } from "@/components/candidate-image-picker";
import { createEntryFromCandidateWithImages } from "@/app/actions";

// ...inside the component, alongside existing state (isUpdating, error, etc.):
const [pickerFor, setPickerFor] = useState<{ id: string; images: { id: string; filename: string }[] } | null>(null);

function handleCreate(candidate: { id: string; images: { id: string; filename: string }[] }) {
  if (candidate.images.length > 0) {
    setPickerFor({ id: candidate.id, images: candidate.images });
    return;
  }
  startUpdating(async () => {
    try {
      await createEntryFromCandidate(candidate.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "สร้างรายการไม่สำเร็จ");
    }
  });
}

function handleConfirmPicker(candidateId: string, chosenImageIds: string[]) {
  setPickerFor(null);
  startUpdating(async () => {
    try {
      await createEntryFromCandidateWithImages(candidateId, chosenImageIds);
    } catch (e) {
      setError(e instanceof Error ? e.message : "สร้างรายการไม่สำเร็จ");
    }
  });
}
```

Update **both** call sites found in Step 2 (line 469 and line 702) from `handleCreate(r.id)` to `handleCreate(r)`, passing the whole row object — it already carries `id`, and after Task 6 it also carries `images` (from the widened `prisma.productCandidate.findMany({ include: { images: ... } })` query in `lib/candidate-queries.ts`). The parameter type on `handleCreate` above is `{ id: string; images: {...}[] }`, which `CandidateRow` (imported from `@/lib/candidate-queries`) already satisfies structurally — no cast needed, just pass `r` directly.

Render the dialog once near the bottom of the component's top-level JSX (a sibling of the component's main content, so it overlays everything regardless of which layout — card or table — triggered it). Note: the file's *existing* delete-confirmation UI is an **inline** replacement of the delete button with a confirm/cancel message in place, not a modal overlay — this new picker is intentionally a different pattern (a full-screen overlay) because it needs to show a grid of images, which doesn't fit inline in a table row or card the way a short text confirmation does. Don't go looking for an existing modal to match; there isn't one in this file or `components/ui/` (confirmed: no `Dialog`/`Modal` component exists anywhere in this codebase, only `Popover`, which is used elsewhere in this same file for a small tap-triggered tooltip and doesn't fit a multi-image grid either) — this component is meant to be self-contained, which the JSX below already achieves:

```tsx
{pickerFor && (
  <CandidateImagePicker
    candidateId={pickerFor.id}
    images={pickerFor.images}
    onConfirm={handleConfirmPicker}
    onCancel={() => setPickerFor(null)}
  />
)}
```

- [ ] **Step 4: Typecheck and lint**

```bash
npx tsc --noEmit
npm run lint
```

- [ ] **Step 5: Contrast check (new border/overlay colors used)**

```bash
node scripts/check-contrast.mjs
```

- [ ] **Step 6: Commit**

```bash
git add components/candidate-image-picker.tsx components/candidates-route.tsx
git commit -m "Add image picker dialog before creating an entry from a Showcase candidate

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: `POST /api/showcase-import` — push endpoint

**Files:**
- Create: `app/api/showcase-import/route.ts`

**Interfaces:**
- Consumes: `importShowcaseBatch` (Task 5).
- Produces: nothing consumed by later tasks in this plan (the `showcase-extension` copy's own push-button feature is explicitly out of scope — see spec — this route just needs to exist and be correct per its documented contract).

- [ ] **Step 1: Add the env var**

Add to `.env` (never commit real secrets, but this repo's `.env` is already gitignored — confirm before editing):

```
SHOWCASE_IMPORT_SECRET=<generate with: node -e "console.log(require('crypto').randomBytes(24).toString('hex'))">
```

- [ ] **Step 2: Write `app/api/showcase-import/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { importShowcaseBatch } from "@/app/actions";

/**
 * ทางเข้าหลัก — extension ยิง POST ตรงเข้ามาที่นี่ (localhost เท่านั้น ทั้งสองระบบอยู่เครื่อง
 * เดียวกันเสมอ) ป้องกันด้วย shared secret เพราะ endpoint นี้รับ URL รูปจากภายนอกแล้วไปดึงมา —
 * ไม่กันเลย กระบวนการอื่นบนเครื่องเดียวกัน (รวมถึงหน้าเว็บที่มี JS ร้าย) มีโอกาสทฤษฎียิงเข้ามาได้
 */
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-showcase-secret");
  const expected = process.env.SHOWCASE_IMPORT_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  try {
    const result = await importShowcaseBatch(body);
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "import failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Manual verification against the isolated dev server**

```bash
NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001
```

```bash
# no secret — expect 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3001/api/showcase-import -H "Content-Type: application/json" -d '{"products":[]}'

# correct secret, valid payload — expect 200 and a batchId
curl -s -X POST http://localhost:3001/api/showcase-import \
  -H "Content-Type: application/json" \
  -H "X-Showcase-Secret: <value from .env>" \
  -d @tests/fixtures/showcase-sample.json
```

Expected: first call prints `401`; second call returns JSON with `batchId`, `added: 3`, `skipped: 1` (matches the fixture from Task 3 — note `imagesFailed` will likely be 3 since the fixture's image URLs are fake `example-*.jpeg` placeholders that don't resolve to real images; that's expected here, not a bug).

- [ ] **Step 5: Commit**

Confirmed while writing this brief: `.env.example` does **not** exist in this repo (checked via `ls .env.example`) — do not create one, that would be inventing a new convention this repo doesn't already use. `.env` itself is gitignored, so there is nothing to add there either; only the route file is new/tracked:

```bash
git add app/api/showcase-import/route.ts
git commit -m "Add POST /api/showcase-import push endpoint

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 11: `GET /api/showcase-import/health`

**Files:**
- Create: `app/api/showcase-import/health/route.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed by later tasks in this plan (the extension's connection-status UI is out of scope here — see spec).

- [ ] **Step 1: Write the route**

```typescript
import { NextResponse } from "next/server";

/** ping เบาๆ ให้ extension เช็คว่า pooling_prompt server เปิดอยู่ก่อนเปิดปุ่ม "ส่ง" */
export async function GET() {
  return NextResponse.json({ ok: true, service: "pooling_prompt" }, { status: 200 });
}
```

- [ ] **Step 2: Verify**

```bash
curl -s http://localhost:3001/api/showcase-import/health
```

Expected: `{"ok":true,"service":"pooling_prompt"}`

- [ ] **Step 3: Commit**

```bash
git add app/api/showcase-import/health/route.ts
git commit -m "Add showcase-import health-check endpoint

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 12: End-to-end verification

**Files:** none (verification only)

**Interfaces:** none — this task exercises everything Tasks 1-11 produced together.

- [ ] **Step 1: Full pure-logic check**

```bash
node scripts/check-showcase-import.mjs
node scripts/check-candidates.mjs   # regression: existing candidates logic untouched
node scripts/check-flow-jobs.mjs    # regression: FLOW_STATUS helpers untouched
```

Expected: `ALL PASS` on all three.

- [ ] **Step 2: Type/lint on the whole repo**

```bash
npx tsc --noEmit
npm run lint
```

- [ ] **Step 3: Full click-through on the isolated dev server**

```bash
cp dev.db dev-test.db
node scripts/enable-wal.mjs dev-test.db
NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001
```

Walk through, in order:
1. Open `/products`, upload `tests/fixtures/showcase-sample.json` via the new manual-upload form — confirm a new batch appears with 2 candidates, one showing thumbnails (may be 0 real thumbnails since the fixture's URLs are placeholders — see Task 10 note; if so, redo this step with one real Showcase export file if available, otherwise accept 0 thumbnails as expected for the fake fixture and move on)
2. Click "สร้างงาน" on a candidate **without** images (existing screenshot-sourced candidate, if any exist in `dev-test.db`) — confirm it creates the entry immediately, no picker dialog (old behavior unchanged)
3. Click "สร้างงาน" on a candidate **with** images (needs a real Showcase export — if none available, verify this step conceptually by temporarily seeding one `CandidateImage` row pointing at any existing JPEG under `uploads/` via `npx prisma db execute --stdin`, then clean it up after) — confirm the picker dialog opens, selecting 1+ images and confirming creates the entry AND a `queued_r1` FlowJob (check `/flow`)
4. `curl` the health endpoint again to confirm it's still `200` after all the above
5. `git diff tsconfig.json` — revert if Next.js auto-patched it

- [ ] **Step 4: Confirm `app/api/uploads/[...path]/route.ts` serves `uploads/_candidates/...`**

Open `http://localhost:3001/api/uploads/_candidates/<any-candidateId>/<filename>` directly in a browser tab during Step 3 — confirm the image renders. If it 404s, read `app/api/uploads/[...path]/route.ts` and fix any path-segment assumption that doesn't generalize past `uploads/<entryId>/...` (this is the one place Task 6/9's thumbnail URLs could break silently).

- [ ] **Step 5: Full production build (only if everything above passed) — check port 3000 is free first**

```bash
netstat -ano | grep ':3000' | grep LISTENING
```

If port 3000 is in use by the user's own `start.bat`, **stop here and ask the user** rather than killing it. If free:

```bash
rm -rf .next
npm run build
```

Expected: builds clean, no type errors, no missing-migration errors.

- [ ] **Step 6: Final commit (only if Steps 1-5 revealed fixes)**

```bash
git add -A
git commit -m "Fix issues found during Showcase import end-to-end verification

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

If no fixes were needed, skip this commit — the feature is already fully committed task-by-task.
