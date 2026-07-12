# AI Generate (Gemini) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user generate the 10-part Gemini Flow prompt directly inside the app — upload product photos, click one button, get the prompt back and saved — instead of copy-pasting between the app and the ChatGPT web UI.

**Architecture:** Add product-image upload (files on disk, paths in SQLite). A new `lib/gemini.ts` builds a request from three pieces already in the database — the active `CorePrompt` as system instruction, two past entries as few-shot examples, and the assembled brief from `lib/prompt-template.ts` — plus the uploaded images, and calls Gemini via `@google/genai`. A Server Action writes the result straight into `PromptEntry.chatgptOutput`. The existing manual copy-paste path stays fully working as a fallback.

**Tech Stack:** Next.js 16.2.10 (App Router, Server Actions), React 19, Prisma 7 + SQLite (`@prisma/adapter-better-sqlite3`), Tailwind v4, shadcn/ui on `@base-ui/react`, TypeScript, `@google/genai`.

Design/plan source: `C:\Users\patip\.claude\plans\generic-pondering-lemur.md`
Branch: `feature/ai-generate` (create from `master`)

## Global Constraints

- **This is NOT stock Next.js.** `next` is pinned at `16.2.10`, a custom build shipping its own docs at `node_modules/next/dist/docs/`. Server Actions, `revalidatePath`, and `<form action={...}>` behave like classic v15 App Router — use those patterns, do not re-research them.
- **Prisma 7 requires a driver adapter.** The client is built in `lib/prisma.ts` with `PrismaBetterSqlite3` (note the casing). Import the generated client from `@/lib/generated/prisma/client` — there is no index barrel. Datasource URL lives in `prisma.config.ts`.
- **The Gemini SDK call shape is VERIFIED — use exactly this.** Read from the installed `node_modules/@google/genai/dist/genai.d.ts` during Task 1 (`CreateModelInteraction`). The published web docs are WRONG about two parameters; the `.d.ts` is ground truth. The Interactions API uses **snake_case**:

  ```ts
  import { GoogleGenAI } from "@google/genai";
  const client = new GoogleGenAI({ apiKey });
  const res = await client.interactions.create({
    model,                                     // string
    system_instruction: corePromptText,        // snake_case — NOT systemInstruction
    generation_config: { temperature: 0.3 },   // temperature lives HERE — not top-level
    input: [
      { type: "text",  text: "..." },
      { type: "image", data: base64, mime_type: "image/png" },  // "image/jpeg" | "image/webp" also valid
    ],
  });
  const text = res.output_text;
  ```

  **Why this matters:** the docs' `systemInstruction` (camelCase) is silently ignored by the API — no error, no warning. The Core Prompt would simply never reach the model and the output would drift with nothing to explain why. If TypeScript complains, fix the call to match the `.d.ts` — never silence it with `as any`.

- **The model list lives in exactly one place: the `GEMINI_MODELS` allow-list in `lib/gemini.ts`** (Task 4, Step 4). The UI builds its dropdown from it and the Server Action validates against it. Do not scatter model IDs into other files, and do not read the model from an env var — the picker is a client component and cannot see `process.env` anyway. Both models were validated in Task 1 against the user's real product photos:
  | Model | Quota/day | Speed | Reads images | Verdict |
  |---|---:|---:|---|---|
  | `gemini-3.1-flash-lite` | **500** | **13.6s** | ✅ accurate | **default** (first in the list) |
  | `gemini-3.5-flash` | 20 | 120s | ✅ accurate | richer output, use for tricky mechanisms |

  The two quotas are **separate pools** (520/day combined), which is why the UI exposes a switcher. Deprecated, do not use: Gemini 2.0 Flash, 2.0 Flash-Lite, 3.0 Pro Preview.

- **Only these two model IDs may be selected from the UI.** Reject anything else server-side — the model string arrives from the client and must never be passed to the API unchecked.
- **NEVER commit secrets.** `GEMINI_API_KEY` goes in `.env` (already gitignored via `.env*`). Never print the key, never write it into a report, never `git add` a file containing it.
- **`dev.db` holds the user's REAL data** — the real Core Prompt v4 and 17 real product entries with their live TikTok clips. It is gitignored with no backup. **NEVER run an unscoped `DELETE FROM <table>;`.** Scope every cleanup delete with `WHERE` to rows you created yourself (e.g. `WHERE productName = 'ทดสอบ AI'`). A past session destroyed user data this way.
- **No test runner is configured.** "Tests" mean `npm run build` (which type-checks), `npm run lint`, and driving the real app in a browser via Playwright. Do not add Jest/Vitest.
- **Playwright is not a project dependency.** Install it ad-hoc in your session's scratchpad directory. Do NOT add it to `package.json`.
- **Reuse existing design tokens only.** Colors: `ink`, `ink-2`, `paper`, `marigold`, `rust`, `smoke`, `record`. Fonts: `font-display`, `font-sans`, `font-mono`. Reuse `Button`, `Input`, `Textarea` from `components/ui/`.
- **All user-facing copy is Thai**, matching the existing voice (`สร้าง Prompt`, `คัดลอก`, `บันทึกผลลัพธ์`, `ยังไม่มีรายการ`).
- **The manual path must keep working.** The "คัดลอก" button for the assembled brief and the hand-paste `chatgptOutput` textarea stay functional — they are the fallback when the API is down or out of quota.
- **On Windows/git-bash, kill a process by port with double slashes:** `netstat -ano | grep ':3000' | grep LISTENING` then `taskkill //PID <pid> //F`. Check port 3000 before starting a dev server.
- **Commit after each task.** Do not squash tasks together.

## Prerequisites — ✅ ALL SATISFIED (Task 1 is complete; start at Task 2)

1. ✅ `GEMINI_API_KEY` in `.env` — working (the only env var this feature needs)
2. ✅ Real product photos at `image_example/` (gitignored)

**Task 1 (validation) already ran and PASSED.** Its findings are baked into the Global Constraints above. Do not re-run it. Summary of what it proved against the user's real `เคาเตอร์ครัว` photos and the real Core Prompt v4:

- Both `gemini-3.1-flash-lite` and `gemini-3.5-flash` produce all 10 sections, 3–5 beats, a Thai voice-over of 151/171 characters (inside the 124–174 range every shipped clip fell in), and the no-on-screen-text rule.
- **Both read product photos accurately** — each independently described the ribbed-glass flip-up doors and the round knob on each door, matching the photos.
- The API's real parameter names are snake_case (see Global Constraints); the published docs are wrong.

**One data-quality issue was found and is NOT this feature's problem:** the `riskModule` text on the `เคาเตอร์ครัว` entry describes a *roll-top slatted door with an open bottom shelf*, which is a different product from the one in the photos (two ribbed-glass flip-up doors). When image and text conflict, `3.5-flash` follows the image and `flash-lite` follows the text. Neither is a bug — the input contradicts itself. Do not "fix" this in code.

## File Structure

**Created**
- `lib/gemini.ts` — builds the Gemini request (system instruction + few-shot + brief + images) and calls the API. The only file that knows the SDK exists.
- `lib/few-shot.ts` — picks which past entries to use as examples and formats them. Kept separate so the selection rule is one small, obvious thing.
- `app/api/uploads/[...path]/route.ts` — serves an uploaded image back to the browser for thumbnails.

**Modified**
- `prisma/schema.prisma` — new `ProductImage` model
- `app/actions.ts` — `uploadProductImages`, `deleteProductImage`, `generateWithAI`
- `components/brief-form.tsx` — file input + thumbnails
- `components/prompt-workspace.tsx` — thread images through; `PromptEntry` gains `images` relation
- `app/page.tsx` — include images in the query
- `components/script-output.tsx` — "สร้างด้วย AI" button
- `.gitignore` — ignore `uploads/`
- `CLAUDE.md` — document the new pieces

**Boundaries:** `lib/gemini.ts` is the only place that imports `@google/genai`. `app/actions.ts` stays a thin Server Action layer. Image *files* live on disk under `uploads/`; only their metadata goes in SQLite.

---

### Task 1: Validation harness — ✅ DONE (do not re-run)

Ran against the real `เคาเตอร์ครัว` photos, the real Core Prompt v4, and 2 few-shot examples pulled from the shipped entries. Both candidate models PASSED every objective criterion (10/10 sections, 3 beats, Thai voice-over of 151 and 171 chars, no-on-screen-text rule) and both described the photographed product accurately.

Its two outputs live in the scratch dir only — nothing was committed, by design. The findings that matter are already recorded in **Global Constraints** and **Prerequisites** above: the verified snake_case API shape, the model table, and the separate quota pools.

**Start work at Task 2.**

---

### Task 2: Store product images

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `.gitignore`
- Modify: `app/actions.ts`
- Create: `prisma/migrations/<timestamp>_product_images/migration.sql` (generated — do not hand-write)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - Prisma model `ProductImage` with fields `id: string`, `entryId: string`, `filename: string`, `mimeType: string`, `sortOrder: number`, `createdAt: Date`, and relation `entry`.
  - `PromptEntry` gains `productImages: ProductImage[]`.
  - `uploadProductImages(formData: FormData): Promise<void>` — reads `entryId` plus one or more `files` from the FormData, writes them under `uploads/<entryId>/`, inserts `ProductImage` rows.
  - `deleteProductImage(id: string): Promise<void>` — removes the row and the file.

- [ ] **Step 1: Add the model**

In `prisma/schema.prisma`, add a new model and a back-relation on `PromptEntry`.

Add this new model after `PromptEntry`:

```prisma
model ProductImage {
  id        String      @id @default(cuid())
  entryId   String
  entry     PromptEntry @relation(fields: [entryId], references: [id], onDelete: Cascade)
  filename  String
  mimeType  String
  sortOrder Int         @default(0)
  createdAt DateTime    @default(now())
}
```

And inside `model PromptEntry`, add this one line at the end of the block (leave every existing field untouched):

```prisma
  productImages  ProductImage[]
```

Note `onDelete: Cascade` — deleting an entry removes its image rows automatically.

- [ ] **Step 2: Migrate and regenerate**

```bash
npx prisma migrate dev --name product_images
npx prisma generate
```

Expected: `Your database is now in sync with your schema.` then `✔ Generated Prisma Client`.

Confirm the user's real data survived:
```bash
node -e "
const Database = require('better-sqlite3');
const db = new Database('dev.db', { readonly: true });
console.log('entries:', db.prepare('SELECT COUNT(*) c FROM PromptEntry').get().c);
console.log('core prompts:', db.prepare('SELECT COUNT(*) c FROM CorePrompt').get().c);
db.close();
"
```
Expected: 17 entries (or however many exist), and **exactly 1 core prompt** — that row is the user's real Core Prompt v4.

- [ ] **Step 3: Ignore the uploads directory**

Append to `.gitignore`:

```
# uploaded product photos (local only)
/uploads
```

- [ ] **Step 4: Add the upload and delete actions**

In `app/actions.ts`, add these imports at the top of the file (below the existing ones):

```ts
import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
```

Then append these two Server Actions at the end of the file:

```ts
const UPLOAD_ROOT = path.join(process.cwd(), "uploads");
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB

export async function uploadProductImages(formData: FormData) {
  const entryId = String(formData.get("entryId") ?? "").trim();
  if (!entryId) {
    throw new Error("ไม่พบรายการที่ต้องการแนบรูป");
  }

  const entry = await prisma.promptEntry.findUnique({ where: { id: entryId } });
  if (!entry) {
    throw new Error("ไม่พบรายการที่ต้องการแนบรูป");
  }

  const files = formData.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    throw new Error("กรุณาเลือกรูปอย่างน้อย 1 รูป");
  }

  const existingCount = await prisma.productImage.count({ where: { entryId } });

  await mkdir(path.join(UPLOAD_ROOT, entryId), { recursive: true });

  for (const [i, file] of files.entries()) {
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      throw new Error("รองรับเฉพาะไฟล์ JPEG, PNG, WebP");
    }
    if (file.size > MAX_IMAGE_BYTES) {
      throw new Error("ไฟล์ใหญ่เกิน 10MB");
    }

    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    // cuid, not the original filename — the original could contain path separators.
    const filename = `${crypto.randomUUID()}.${ext}`;

    const bytes = Buffer.from(await file.arrayBuffer());
    await writeFile(path.join(UPLOAD_ROOT, entryId, filename), bytes);

    await prisma.productImage.create({
      data: {
        entryId,
        filename,
        mimeType: file.type,
        sortOrder: existingCount + i,
      },
    });
  }

  revalidatePath("/");
}

export async function deleteProductImage(id: string) {
  const image = await prisma.productImage.findUnique({ where: { id } });
  if (!image) return;

  await prisma.productImage.delete({ where: { id } });

  // The DB row is the source of truth; a missing file must not break the delete.
  try {
    await unlink(path.join(UPLOAD_ROOT, image.entryId, image.filename));
  } catch {
    // file already gone — nothing to do
  }

  revalidatePath("/");
}
```

Note the filename is a generated UUID, never the user's original filename — an uploaded name like `../../evil.js` would otherwise escape the upload directory.

- [ ] **Step 5: Verify build and lint**

```bash
npm run build && npm run lint
```
Expected: `✓ Compiled successfully`, `Finished TypeScript`, no lint output.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations app/actions.ts .gitignore
git commit -m "Store product images for entries"
```

---

### Task 3: Upload images in the brief form

**Files:**
- Create: `app/api/uploads/[...path]/route.ts`
- Modify: `app/page.tsx`
- Modify: `components/prompt-workspace.tsx`
- Modify: `components/brief-form.tsx`

**Interfaces:**
- Consumes: `uploadProductImages(formData)` and `deleteProductImage(id)` from Task 2 (`app/actions.ts`).
- Produces:
  - `ProductImageRecord` type exported from `components/prompt-workspace.tsx`: `{ id: string; entryId: string; filename: string; mimeType: string; sortOrder: number }`
  - `PromptEntry` type gains `productImages: ProductImageRecord[]`
  - `BriefForm` gains props `entryId: string | null` and `productImages: ProductImageRecord[]`
  - Task 4 relies on `entry.productImages` being present on the selected entry.

- [ ] **Step 1: Serve uploaded files**

Uploads live outside `public/`, so they need a route to be viewable. Create `app/api/uploads/[...path]/route.ts`:

```ts
import { readFile } from "node:fs/promises";
import path from "node:path";

const UPLOAD_ROOT = path.join(process.cwd(), "uploads");

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: segments } = await params;

  const target = path.join(UPLOAD_ROOT, ...segments);
  // Reject any path that escapes the upload root (e.g. via "..").
  if (!path.resolve(target).startsWith(path.resolve(UPLOAD_ROOT) + path.sep)) {
    return new Response("Not found", { status: 404 });
  }

  const mime = MIME_BY_EXT[path.extname(target).toLowerCase()];
  if (!mime) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const file = await readFile(target);
    return new Response(new Uint8Array(file), {
      headers: {
        "Content-Type": mime,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
```

Note `params` is a `Promise` — that is this Next version's convention, not a mistake.

- [ ] **Step 2: Fetch images with the entries**

Replace the whole of `app/page.tsx` with:

```tsx
import { prisma } from "@/lib/prisma";
import { PromptWorkspace } from "@/components/prompt-workspace";
import { sortEntriesForRail } from "@/lib/entry-sort";

export default async function PoolingPrompt() {
  const [prompts, corePrompts] = await Promise.all([
    prisma.promptEntry.findMany({
      orderBy: { createdAt: "desc" },
      include: { productImages: { orderBy: { sortOrder: "asc" } } },
    }),
    prisma.corePrompt.findMany({ orderBy: { createdAt: "desc" } }),
  ]);

  return (
    <PromptWorkspace
      prompts={sortEntriesForRail(prompts)}
      corePrompts={corePrompts}
    />
  );
}
```

- [ ] **Step 3: Thread the images through the workspace**

In `components/prompt-workspace.tsx`:

Add the new type just above the existing `PromptEntry` type:

```tsx
export type ProductImageRecord = {
  id: string;
  entryId: string;
  filename: string;
  mimeType: string;
  sortOrder: number;
};
```

Add one field to the `PromptEntry` type (leave every existing field):

```tsx
  productImages: ProductImageRecord[];
```

Then pass the selected entry's id and images into `BriefForm`. Find the `<BriefForm ... />` usage and add two props to it:

```tsx
              <BriefForm
                form={form}
                isCreating={isCreating}
                onFieldChange={updateField}
                onImageChange={updateImage}
                onAddImage={addImage}
                onRemoveImage={removeImage}
                action={createAction}
                entryId={selectedEntry?.id ?? null}
                productImages={selectedEntry?.productImages ?? []}
              />
```

`selectedEntry` already exists in this file — do not redeclare it.

- [ ] **Step 4: Add the upload UI**

In `components/brief-form.tsx`, add these imports at the top:

```tsx
import { useActionState } from "react";
import { uploadProductImages, deleteProductImage } from "@/app/actions";
import type { ProductImageRecord } from "@/components/prompt-workspace";
```

Extend the component's props (add the two new ones to the existing prop list and its type):

```tsx
export function BriefForm({
  form,
  isCreating,
  onFieldChange,
  onImageChange,
  onAddImage,
  onRemoveImage,
  action,
  entryId,
  productImages,
}: {
  form: FormState;
  isCreating: boolean;
  onFieldChange: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  onImageChange: (index: number, value: string) => void;
  onAddImage: () => void;
  onRemoveImage: (index: number) => void;
  action: (formData: FormData) => void;
  entryId: string | null;
  productImages: ProductImageRecord[];
}) {
```

Inside the component body, above the `return`, add the upload action state:

```tsx
  const [, uploadAction, isUploading] = useActionState(
    async (_prev: { ok: boolean } | null, formData: FormData) => {
      await uploadProductImages(formData);
      return { ok: true };
    },
    null
  );
```

Now add the upload block to the JSX. Put it immediately **after** the closing `</Field>` of the existing `รูปอ้างอิงที่แนบ` field and **before** the submit `<Button>`:

```tsx
        {entryId ? (
          <Field label="รูปสินค้าจริง (ส่งให้ AI อ่าน)">
            <div className="flex flex-col gap-3">
              {productImages.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {productImages.map((img) => (
                    <div key={img.id} className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/uploads/${img.entryId}/${img.filename}`}
                        alt="รูปสินค้า"
                        className="size-20 rounded-md border border-border object-cover"
                      />
                      <button
                        type="button"
                        aria-label="ลบรูป"
                        onClick={() => deleteProductImage(img.id)}
                        className="absolute -top-1.5 -right-1.5 rounded-full bg-record p-0.5 text-paper"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <form action={uploadAction} className="flex items-center gap-2">
                <input type="hidden" name="entryId" value={entryId} />
                <Input
                  type="file"
                  name="files"
                  multiple
                  accept="image/jpeg,image/png,image/webp"
                  className="h-auto py-1.5"
                />
                <Button type="submit" variant="outline" size="sm" disabled={isUploading}>
                  {isUploading ? "กำลังอัปโหลด..." : "อัปโหลด"}
                </Button>
              </form>
            </div>
          </Field>
        ) : (
          <p className="font-mono text-[0.7rem] text-muted-foreground">
            กด &quot;สร้าง Prompt&quot; ก่อน แล้วจึงแนบรูปสินค้าจริงเพื่อให้ AI อ่านได้
          </p>
        )}
```

The upload is its own `<form>` because the outer form belongs to `createAction`. Images attach to an entry that already exists, so the upload block only appears once an entry is selected.

- [ ] **Step 5: Verify build and lint**

```bash
npm run build && npm run lint
```
Expected: clean.

- [ ] **Step 6: Drive it in a browser**

Free port 3000 first, then start the dev server:
```bash
netstat -ano | grep ':3000' | grep LISTENING   # if a PID appears: taskkill //PID <pid> //F
npm run dev &
timeout 40 bash -c 'until curl -sf http://localhost:3000 >/dev/null; do sleep 1; done' && echo UP
```

Set up Playwright in your scratchpad (not the project) and write `$SCRATCH/upload.js`:

```js
const { chromium } = require("playwright");
const path = require("path");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await page.goto("http://localhost:3000", { waitUntil: "networkidle" });

  await page.fill('input[name="productName"]', "ทดสอบอัปโหลด");
  await page.fill('textarea[name="productInfo"]', "ข้อมูลทดสอบ");
  await page.click('button:has-text("สร้าง Prompt")');
  await page.waitForSelector('button:has-text("ทดสอบอัปโหลด")', { timeout: 10000 });
  await page.waitForTimeout(500);

  // The upload block only appears once an entry is selected.
  await page.setInputFiles('input[name="files"]', process.argv[2]);
  await page.click('button:has-text("อัปโหลด")');
  await page.waitForSelector('img[alt="รูปสินค้า"]', { timeout: 15000 });

  // The thumbnail must actually load (not a broken image).
  const loaded = await page.locator('img[alt="รูปสินค้า"]').first().evaluate(
    (el) => el.complete && el.naturalWidth > 0
  );

  await page.reload({ waitUntil: "networkidle" });
  await page.click('button:has-text("ทดสอบอัปโหลด")');
  await page.waitForTimeout(500);
  const persisted = await page.locator('img[alt="รูปสินค้า"]').count();

  console.log(JSON.stringify({ thumbnailLoaded: loaded, persistedAfterReload: persisted, errors }, null, 2));
  await browser.close();
})().catch((e) => { console.error("FAILED:", e); process.exit(1); });
```

Run it with one real photo:
```bash
node "$SCRATCH/upload.js" "<path-to-a-real-product-photo>"
```

Expected: `thumbnailLoaded: true`, `persistedAfterReload: 1`, `errors: []`. `thumbnailLoaded` is the one that matters — it proves the route handler actually serves the bytes, not just that an `<img>` tag exists.

- [ ] **Step 7: Clean up and stop the server**

Scoped delete only — the other rows are the user's real data:
```bash
npx prisma db execute --stdin <<< "DELETE FROM PromptEntry WHERE productName = 'ทดสอบอัปโหลด';"
rm -rf uploads/*   # only test uploads exist at this point
netstat -ano | grep ':3000' | grep LISTENING
taskkill //PID <pid> //F
```

Confirm the real data is intact:
```bash
node -e "
const Database = require('better-sqlite3');
const db = new Database('dev.db', { readonly: true });
console.log('core prompts:', db.prepare('SELECT COUNT(*) c FROM CorePrompt').get().c);
db.close();
"
```
Expected: `core prompts: 1`.

- [ ] **Step 8: Commit**

```bash
git add app/api components/brief-form.tsx components/prompt-workspace.tsx app/page.tsx
git commit -m "Upload and display real product photos per entry"
```

---

### Task 4: Generate the 10-part prompt with Gemini

**Files:**
- Create: `lib/few-shot.ts`
- Create: `lib/gemini.ts`
- Modify: `app/actions.ts`
- Modify: `components/script-output.tsx`
- Modify: `components/prompt-workspace.tsx`

**Interfaces:**
- Consumes: `buildPromptText` from `lib/prompt-template.ts`; `ProductImage` rows from Task 2; `PromptEntry` / `ProductImageRecord` types from Task 3.
- Produces:
  - `lib/gemini.ts` → `GEMINI_MODELS` (the allow-list), `type GeminiModelId`, `isGeminiModelId(v: string): v is GeminiModelId`, and `generateTenPartPrompt(args: { model: GeminiModelId; systemInstruction: string; examples: { brief: string; output: string }[]; brief: string; images: { base64: string; mimeType: string }[] }): Promise<string>`
  - `lib/few-shot.ts` → `getFewShotExamples(excludeEntryId: string): Promise<{ brief: string; output: string }[]>`
  - `app/actions.ts` → `generateWithAI(entryId: string, model: string): Promise<void>` — generates and saves into `chatgptOutput`
  - `ScriptOutput` gains props `onGenerate: () => void`, `isGenerating: boolean`, `canGenerate: boolean`, `model: string`, `onModelChange: (m: string) => void`

- [ ] **Step 1: Install the SDK**

```bash
npm install @google/genai
```

- [ ] **Step 2: Confirm the verified call shape**

The exact shape is already recorded in **Global Constraints** — it was read out of `node_modules/@google/genai/dist/genai.d.ts` (`CreateModelInteraction`) during Task 1 and confirmed with live API calls. It is **snake_case**, and the published web docs are wrong.

Re-confirm it still matches the installed version before writing code:

```bash
grep -n "system_instruction\|generation_config" node_modules/@google/genai/dist/genai.d.ts | head -5
```

Expected: both names appear. If they don't, the SDK changed — read `CreateModelInteraction` again and adjust. **Never write `systemInstruction` (camelCase): the API ignores it silently, the Core Prompt never reaches the model, and nothing errors.**

- [ ] **Step 3: Pick the few-shot examples**

Create `lib/few-shot.ts`:

```ts
import { prisma } from "@/lib/prisma";
import { buildPromptText } from "@/lib/prompt-template";

/**
 * Past entries that shipped real clips, reused to teach the model the exact
 * output format and voice. Excludes the entry being generated so the model
 * never sees the answer it is being asked for.
 *
 * These are text-only (brief -> output). The originals' photos were attached
 * in ChatGPT and never stored, so examples cannot include images — which is
 * fine: their job is to lock the format, not to teach image reading.
 */
export async function getFewShotExamples(
  excludeEntryId: string
): Promise<{ brief: string; output: string }[]> {
  const rows = await prisma.promptEntry.findMany({
    where: {
      id: { not: excludeEntryId },
      chatgptOutput: { not: "" },
    },
    orderBy: { createdAt: "desc" },
    take: 2,
  });

  return rows
    .filter((r) => r.chatgptOutput.length > 3000)
    .map((r) => {
      let images: string[] = [];
      try {
        images = JSON.parse(r.images);
      } catch {
        images = [];
      }
      return {
        brief: buildPromptText({
          productInfo: r.productInfo,
          riskModule: r.riskModule,
          extraNotes: r.extraNotes,
          images,
        }),
        output: r.chatgptOutput,
      };
    });
}
```

- [ ] **Step 4: Call Gemini**

Create `lib/gemini.ts`. The parameter names below are **verified** (snake_case) — do not "correct" them to camelCase.

```ts
import { GoogleGenAI } from "@google/genai";

/**
 * The only models the app may call. Both were validated against real product
 * photos: each produces all 10 sections and reads the photos accurately.
 * Their free-tier quotas are separate pools, so offering both roughly doubles
 * daily capacity.
 */
export const GEMINI_MODELS = [
  { id: "gemini-3.1-flash-lite", label: "เร็ว (500/วัน)" },
  { id: "gemini-3.5-flash", label: "ละเอียด (20/วัน)" },
] as const;

export type GeminiModelId = (typeof GEMINI_MODELS)[number]["id"];

export function isGeminiModelId(value: string): value is GeminiModelId {
  return GEMINI_MODELS.some((m) => m.id === value);
}

export type GeminiImage = { base64: string; mimeType: string };

export async function generateTenPartPrompt(args: {
  model: GeminiModelId;
  systemInstruction: string;
  examples: { brief: string; output: string }[];
  brief: string;
  images: GeminiImage[];
}): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("ยังไม่ได้ตั้งค่า GEMINI_API_KEY ในไฟล์ .env");

  const client = new GoogleGenAI({ apiKey });

  const input: object[] = [];

  // Few-shot first: completed input -> output pairs teach the exact format.
  for (const [i, ex] of args.examples.entries()) {
    input.push({
      type: "text",
      text:
        `### ตัวอย่างที่ ${i + 1} — โจทย์\n${ex.brief}\n\n` +
        `### ตัวอย่างที่ ${i + 1} — คำตอบที่ถูกต้อง\n${ex.output}`,
    });
  }

  // Then the real task, then the photos it must be based on.
  input.push({ type: "text", text: `### โจทย์จริง\n${args.brief}` });
  for (const img of args.images) {
    input.push({ type: "image", data: img.base64, mime_type: img.mimeType });
  }

  const res = await client.interactions.create({
    model: args.model,
    // snake_case is correct — the web docs' camelCase `systemInstruction` is
    // silently ignored by the API, which would drop the Core Prompt with no error.
    system_instruction: args.systemInstruction,
    generation_config: { temperature: 0.3 },
    input,
  });

  const text = res.output_text;
  if (!text || text.trim() === "") {
    throw new Error("AI ไม่ได้ตอบกลับ ลองใหม่อีกครั้ง");
  }
  return text;
}
```

- [ ] **Step 5: Add the Server Action**

In `app/actions.ts`, add these imports below the existing ones:

```ts
import { readFile } from "node:fs/promises";
import { buildPromptText } from "@/lib/prompt-template";
import { getFewShotExamples } from "@/lib/few-shot";
import { generateTenPartPrompt, isGeminiModelId } from "@/lib/gemini";
```

Then append this action at the end of the file:

```ts
export async function generateWithAI(entryId: string, model: string) {
  // The model string comes from the client — never pass it to the API unchecked.
  if (!isGeminiModelId(model)) {
    throw new Error("โมเดลไม่ถูกต้อง");
  }

  const entry = await prisma.promptEntry.findUnique({
    where: { id: entryId },
    include: { productImages: { orderBy: { sortOrder: "asc" } } },
  });
  if (!entry) {
    throw new Error("ไม่พบรายการที่ต้องการสร้าง");
  }
  if (entry.productImages.length === 0) {
    throw new Error("กรุณาแนบรูปสินค้าจริงอย่างน้อย 1 รูปก่อนสร้างด้วย AI");
  }

  const core = await prisma.corePrompt.findFirst({ where: { isActive: true } });
  if (!core) {
    throw new Error("ยังไม่ได้ตั้ง Core Prompt ที่ใช้งานอยู่");
  }

  let images: string[] = [];
  try {
    images = JSON.parse(entry.images);
  } catch {
    images = [];
  }

  const brief = buildPromptText({
    productInfo: entry.productInfo,
    riskModule: entry.riskModule,
    extraNotes: entry.extraNotes,
    images,
  });

  const photos = await Promise.all(
    entry.productImages.map(async (img) => ({
      base64: (
        await readFile(path.join(UPLOAD_ROOT, img.entryId, img.filename))
      ).toString("base64"),
      mimeType: img.mimeType,
    }))
  );

  const output = await generateTenPartPrompt({
    model,
    systemInstruction: core.content,
    examples: await getFewShotExamples(entryId),
    brief,
    images: photos,
  });

  await prisma.promptEntry.update({
    where: { id: entryId },
    data: { chatgptOutput: output },
  });

  revalidatePath("/");
}
```

`UPLOAD_ROOT` and `path` already exist in this file from Task 2 — do not redeclare them.

- [ ] **Step 6: Add the model picker and the generate button**

In `components/script-output.tsx`, add this import:

```tsx
import { GEMINI_MODELS } from "@/lib/gemini";
```

Change the component signature to:

```tsx
export function ScriptOutput({
  output,
  copied,
  onCopy,
  onGenerate,
  isGenerating,
  canGenerate,
  model,
  onModelChange,
}: {
  output: string;
  copied: boolean;
  onCopy: () => void;
  onGenerate: () => void;
  isGenerating: boolean;
  canGenerate: boolean;
  model: string;
  onModelChange: (model: string) => void;
}) {
```

Then, in the header row that currently holds the copy button, add the picker and the generate button immediately **before** the existing copy `<Button>`:

```tsx
        <select
          value={model}
          onChange={(e) => onModelChange(e.target.value)}
          disabled={isGenerating}
          aria-label="เลือกโมเดล AI"
          className="h-7 rounded-lg border border-input bg-background px-2 font-mono text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
        >
          {GEMINI_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>

        <Button
          type="button"
          size="sm"
          disabled={!canGenerate || isGenerating}
          onClick={onGenerate}
          title={canGenerate ? undefined : "แนบรูปสินค้าจริงก่อน"}
          className="bg-rust text-primary-foreground hover:bg-rust/90"
        >
          {isGenerating ? "กำลังสร้าง..." : "สร้างด้วย AI"}
        </Button>
```

A plain `<select>` is used rather than a shadcn primitive — the project has no select component and this does not warrant adding one.

- [ ] **Step 7: Wire it up**

In `components/prompt-workspace.tsx`:

Add to the imports:

```tsx
import { generateWithAI } from "@/app/actions";
import { GEMINI_MODELS } from "@/lib/gemini";
```

Inside the component, below the existing `handleCopy` function, add:

```tsx
  const [isGenerating, startGenerating] = useTransition();
  const [genError, setGenError] = useState<string | null>(null);
  // Defaults to the fast, high-quota model. Both models were validated; the
  // slower one has a separate quota pool and richer output for tricky products.
  const [model, setModel] = useState<string>(GEMINI_MODELS[0].id);

  function handleGenerate() {
    if (!selectedEntry) return;
    setGenError(null);
    startGenerating(async () => {
      try {
        await generateWithAI(selectedEntry.id, model);
      } catch (e) {
        setGenError(e instanceof Error ? e.message : "สร้างด้วย AI ไม่สำเร็จ");
      }
    });
  }
```

`useTransition` and `useState` are already imported in this file. `selectedEntry` already exists — do not redeclare it.

Then pass the new props to `<ScriptOutput>`:

```tsx
            <ScriptOutput
              output={output}
              copied={copied}
              onCopy={handleCopy}
              onGenerate={handleGenerate}
              isGenerating={isGenerating}
              canGenerate={(selectedEntry?.productImages.length ?? 0) > 0}
              model={model}
              onModelChange={setModel}
            />
```

And show the error. Add this immediately after the `</ScriptOutput>`'s parent `<div>` closes inside the brief tab — i.e. put it inside the brief tab block, just below the inner row `<div>`:

```tsx
            {genError && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {genError}
              </p>
            )}
```

- [ ] **Step 8: Verify build and lint**

```bash
npm run build && npm run lint
```
Expected: clean. If TypeScript complains about `system_instruction` or `generation_config`, the SDK changed — re-read `CreateModelInteraction` in `node_modules/@google/genai/dist/genai.d.ts` and fix `lib/gemini.ts` to match. **Do not silence it with `as any`:** a wrong name means the Core Prompt never reaches the model, silently.

- [ ] **Step 9: Drive the whole flow for real**

This calls the live API and costs real quota. Do it once, carefully.

Start the dev server (free port 3000 first). Then, in the browser (you may drive this by hand rather than scripting it, since it is a single one-shot check):

1. Create an entry named `ทดสอบ AI` with real `productInfo` text.
2. Attach the real เคาเตอร์ครัว photos.
3. Click **สร้างด้วย AI**.
4. Wait for it to finish.

Then confirm the output actually landed in the database:
```bash
node -e "
const Database = require('better-sqlite3');
const db = new Database('dev.db', { readonly: true });
const r = db.prepare(\"SELECT productName, length(chatgptOutput) len FROM PromptEntry WHERE productName = 'ทดสอบ AI'\").get();
console.log(r);
db.close();
"
```
Expected: `len` is a few thousand characters — the generated 10-part prompt, saved automatically.

Also check the failure path: temporarily rename `GEMINI_API_KEY` in `.env` to something invalid, restart the dev server, click **สร้างด้วย AI**, and confirm a **Thai error message appears in the UI and the page does not crash**. Then restore the key.

- [ ] **Step 10: Confirm the manual path still works**

Regression check — the fallback must survive:
- The **คัดลอก** button still copies the assembled brief.
- The **② ผลลัพธ์ & คลิป** tab still lets you paste a 10-part prompt by hand and save it.

- [ ] **Step 11: Clean up**

```bash
npx prisma db execute --stdin <<< "DELETE FROM PromptEntry WHERE productName = 'ทดสอบ AI';"
netstat -ano | grep ':3000' | grep LISTENING
taskkill //PID <pid> //F
node -e "
const Database = require('better-sqlite3');
const db = new Database('dev.db', { readonly: true });
console.log('core prompts:', db.prepare('SELECT COUNT(*) c FROM CorePrompt').get().c);
console.log('entries:', db.prepare('SELECT COUNT(*) c FROM PromptEntry').get().c);
db.close();
"
```
Expected: `core prompts: 1`, and the entry count back to what it was before.

- [ ] **Step 12: Commit**

```bash
git add lib/gemini.ts lib/few-shot.ts app/actions.ts components/script-output.tsx components/prompt-workspace.tsx package.json package-lock.json
git commit -m "Generate the 10-part prompt with Gemini from inside the app"
```

**Confirm no secret was committed:**
```bash
git show --stat HEAD
git diff HEAD~1 HEAD | grep -i "GEMINI_API_KEY" || echo "no key in diff — good"
```
`.env` must not appear in the commit.

---

### Task 5: Document it

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: everything from Tasks 2–4.
- Produces: nothing.

- [ ] **Step 1: Update `CLAUDE.md`**

In the `## Architecture` section, append this bullet at the end of the list:

```
- สร้าง 10-part prompt ด้วย AI ได้ในแอป: `lib/gemini.ts` (ที่เดียวที่ import `@google/genai`) ประกอบ system instruction = `CorePrompt` ที่ active, few-shot 2 ตัวอย่างจาก entry เก่า (`lib/few-shot.ts`), brief จาก `lib/prompt-template.ts` และรูปสินค้าจริง แล้ว `generateWithAI()` ใน `app/actions.ts` บันทึกผลลง `chatgptOutput` ให้เลย — เส้นทาง copy-paste เดิมยังใช้ได้ปกติในฐานะ fallback
```

In the `## Database` section, append:

```
- `ProductImage` เก็บ metadata ของรูปสินค้าจริง (ไฟล์อยู่ใน `uploads/<entryId>/` ซึ่ง gitignore ไว้ ไม่ได้เก็บใน DB) เสิร์ฟผ่าน `app/api/uploads/[...path]/route.ts` — ลบ entry แล้วรูปถูกลบตาม (`onDelete: Cascade`)
```

Add a new section after `## Database`:

```
## Gemini API

- ใช้ `@google/genai` (ไม่ใช่ `@google/generative-ai` ตัวเก่า) เรียกผ่าน `client.interactions.create(...)`
- **API ตัวนี้ใช้ snake_case** — `system_instruction` (ไม่ใช่ `systemInstruction`) และ `temperature` อยู่ใน `generation_config` ถ้าสะกดผิด API จะ**เงียบ** ไม่ error แต่ Core Prompt จะไม่ถูกส่งไปเลย → **ห้ามเดา API shape** ให้อ่าน type จริงใน `node_modules/@google/genai/dist/genai.d.ts` (`CreateModelInteraction`) และห้ามกลบด้วย `as any`
- **รายชื่อโมเดลอยู่ที่เดียวคือ `GEMINI_MODELS` ใน `lib/gemini.ts`** — UI สร้าง dropdown จากตัวนี้ และ Server Action validate ด้วยตัวนี้ (ห้าม hard-code ที่อื่น) ตอนนี้มี `gemini-3.1-flash-lite` (เร็ว 500/วัน, default) กับ `gemini-3.5-flash` (ช้ากว่า 20/วัน, ละเอียดกว่า) — โควตาแยกคนละ pool กัน
- Google เลิกประกาศตัวเลข quota ของ free tier ในเอกสารแล้ว — ดู limit จริงของบัญชีที่ `https://aistudio.google.com/rate-limit`
- `GEMINI_API_KEY` อยู่ใน `.env` (gitignore แล้ว) — **ห้าม commit เด็ดขาด**
```

- [ ] **Step 2: Verify build and lint**

```bash
npm run build && npm run lint
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "Document the in-app AI generation path"
```

---

## Done

The branch `feature/ai-generate` now contains four implementation commits (Task 1 produced no committed code by design).

**Deliberately out of scope:** generating the video itself (still manual in Google Flow), switching to OpenAI, and any change to how the prompt's *content* is written — the shipped data shows the prompt is not what drives clip performance, so this feature only removes toil.
