# Prompt Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store the artifacts that cannot be recovered later — ChatGPT's 10-part prompt output, the link to the TikTok video it produced, and versioned core prompts — so past work can be searched, reused, and eventually compared against outcomes.

**Architecture:** Add a `CorePrompt` table and five new optional fields to the existing `PromptEntry` table. Split the single-screen workspace into three tabs driven by client-side state in `prompt-workspace.tsx`: tab ① is the existing Brief/Script UI untouched, tab ② records production results for the selected entry, tab ③ manages core prompt versions. New Server Actions in `app/actions.ts` handle the new writes.

**Tech Stack:** Next.js 16.2.10 (App Router, Server Actions), React 19, Prisma 7 + SQLite (via `@prisma/adapter-better-sqlite3`), Tailwind v4 (CSS-first config), shadcn/ui built on `@base-ui/react`, TypeScript.

Design spec: `docs/superpowers/specs/2026-07-11-prompt-archive-design.md`
Branch: `feature/prompt-archive` (already created and checked out)

## Global Constraints

- **This is NOT stock Next.js.** `next` is pinned at `16.2.10`, a custom build shipping its own docs at `node_modules/next/dist/docs/`. Server Actions, `revalidatePath`, and `<form action={...}>` have already been verified to behave like classic v15 App Router — use those patterns and do not re-research them.
- **Prisma 7 requires a driver adapter.** Plain connection strings do not work. The client is constructed in `lib/prisma.ts` with `PrismaBetterSqlite3` (note the casing — it is NOT `PrismaBetterSQLite3`).
- **Import the generated Prisma client from `@/lib/generated/prisma/client`**, never from the directory `@/lib/generated/prisma` — there is no index barrel.
- **Datasource URL lives in `prisma.config.ts`**, not in `schema.prisma`.
- **No test runner is configured.** "Tests" in this plan mean: `npm run build` (which type-checks), `npm run lint`, and driving the real app in a browser via Playwright. Do not add Jest/Vitest.
- **Playwright is not a project dependency.** It is installed ad-hoc in the scratch directory. Do not add it to `package.json`.
- **Reuse existing design tokens only.** Colors: `ink`, `ink-2`, `paper`, `marigold`, `rust`, `smoke`, `record`. Fonts: `font-display` (Chonburi), `font-sans` (IBM Plex Sans Thai), `font-mono` (JetBrains Mono). Do not introduce new colors or fonts.
- **Reuse existing UI primitives** from `components/ui/`: `Button`, `Input`, `Textarea`. Add a new primitive only if genuinely absent.
- **All user-facing copy is Thai.** Match the existing voice (e.g. `สร้าง Prompt`, `คัดลอก`, `ยังไม่มีรายการ`).
- **All new `PromptEntry` fields must be optional or have defaults** so the ~30 existing rows keep working and backfill can be partial.
- **On Windows/git-bash, kill a process by port with double slashes:** `netstat -ano | grep ':3000' | grep LISTENING` then `taskkill //PID <pid> //F`. Single slashes get mangled into paths.
- **`npx prisma db execute` cannot print `SELECT` results** — it only reports success/failure. To actually *read* rows, use the `db-peek.js` helper below.
- **Commit after each task.** Do not squash multiple tasks into one commit.

### `db-peek.js` — reading the database

Several tasks need to inspect rows. `better-sqlite3` is already a project dependency and is plain CommonJS, so query SQLite directly rather than fighting the generated Prisma client (which ships as `.ts` and will not `require()`).

Create this file **once**, at the project root, at the start of Task 1. It is a throwaway dev tool — **`git rm` it in Task 6, do not commit it.**

```js
// db-peek.js — dev-only. Prints the current contents of both tables.
const Database = require("better-sqlite3");
const db = new Database("dev.db", { readonly: true });

const cores = db
  .prepare("SELECT id, label, isActive FROM CorePrompt ORDER BY createdAt")
  .all();

const entries = db
  .prepare(
    `SELECT e.productName, e.chatgptOutput, e.videoUrl, e.views, e.viewsUpdatedAt,
            c.label AS core
     FROM PromptEntry e
     LEFT JOIN CorePrompt c ON e.corePromptId = c.id
     ORDER BY e.createdAt DESC`
  )
  .all();

console.log(JSON.stringify({ cores, entries }, null, 2));
db.close();
```

Run it with `node db-peek.js` from the project root.

## File Structure

**Modified**
- `prisma/schema.prisma` — add `CorePrompt` model; add 5 fields + relation to `PromptEntry`
- `app/actions.ts` — add `updateProduction`, `createCorePrompt`, `setActiveCorePrompt`; make `createPrompt` attach the active core prompt
- `app/page.tsx` — also fetch `corePrompts`, pass to workspace
- `components/prompt-workspace.tsx` — owns tab state; renders one of three panels; grows the entry type
- `components/clapper-header.tsx` — gains a tab bar

**Created**
- `components/workspace-tabs.tsx` — the tab bar (presentational; no data access)
- `components/production-panel.tsx` — tab ②: 10-part prompt, video URL, views
- `components/core-prompt-panel.tsx` — tab ③: list versions, add one, set active

**Responsibility boundaries:** `prompt-workspace.tsx` remains the only component holding workspace state and calling Server Actions for the brief; the two new panels own their own local form state and call their own actions. `workspace-tabs.tsx` is pure presentation so the header stays dumb.

---

### Task 1: Extend the database schema

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_prompt_archive/migration.sql` (generated by Prisma — do not hand-write)

**Interfaces:**
- Consumes: nothing (first task)
- Produces: Prisma model types used by every later task —
  - `CorePrompt` with fields `id: string`, `label: string`, `content: string`, `isActive: boolean`, `createdAt: Date`
  - `PromptEntry` gains `corePromptId: string | null`, `chatgptOutput: string`, `videoUrl: string`, `views: number | null`, `viewsUpdatedAt: Date | null`

- [ ] **Step 1: Add the `CorePrompt` model and extend `PromptEntry`**

Replace the entire `model PromptEntry { ... }` block in `prisma/schema.prisma` with:

```prisma
model CorePrompt {
  id        String        @id @default(cuid())
  label     String
  content   String
  isActive  Boolean       @default(false)
  createdAt DateTime      @default(now())
  entries   PromptEntry[]
}

model PromptEntry {
  id          String   @id @default(cuid())
  productName String
  productInfo String
  riskModule  String
  extraNotes  String
  images      String
  createdAt   DateTime @default(now())

  corePromptId   String?
  corePrompt     CorePrompt? @relation(fields: [corePromptId], references: [id])
  chatgptOutput  String      @default("")
  videoUrl       String      @default("")
  views          Int?
  viewsUpdatedAt DateTime?
}
```

Leave the `generator` and `datasource` blocks exactly as they are.

- [ ] **Step 2: Create and apply the migration**

Run: `npx prisma migrate dev --name prompt_archive`

Expected: output ends with `Your database is now in sync with your schema.` and a new folder appears under `prisma/migrations/`.

- [ ] **Step 3: Regenerate the Prisma client**

Run: `npx prisma generate`

Expected: `✔ Generated Prisma Client ... to .\lib\generated\prisma`

- [ ] **Step 4: Verify the existing rows survived and the new columns exist**

Run:
```bash
npx prisma db execute --stdin <<< "INSERT INTO CorePrompt (id, label, content, isActive, createdAt) VALUES ('probe', 'probe', 'x', 0, datetime('now'));"
npx prisma db execute --stdin <<< "SELECT id, chatgptOutput, videoUrl, views FROM PromptEntry;"
npx prisma db execute --stdin <<< "DELETE FROM CorePrompt WHERE id = 'probe';"
```

Expected: all three print `Script executed successfully.` with no error about a missing column or table.

- [ ] **Step 5: Create the `db-peek.js` dev helper**

Create `db-peek.js` at the project root with exactly the contents given in Global Constraints above. This has been verified to work against this project's `better-sqlite3` install. Later tasks use it to read rows.

Confirm it runs:

Run: `node db-peek.js`
Expected: JSON like `{ "cores": [], "entries": [...] }` — no error. (`cores` is empty; `entries` lists whatever rows already exist.)

Do **not** commit this file — it gets deleted in Task 6.

- [ ] **Step 6: Verify the app still builds against the new client**

Run: `npm run build`
Expected: `✓ Compiled successfully` and `Finished TypeScript`, no errors.

- [ ] **Step 7: Commit (schema and migration only)**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "Add CorePrompt model and production fields to PromptEntry"
```

Note `db-peek.js` is deliberately left untracked.

---

### Task 2: Server Actions for core prompts and production results

**Files:**
- Modify: `app/actions.ts`

**Interfaces:**
- Consumes: Prisma models from Task 1.
- Produces: four Server Actions imported by later tasks —
  - `createPrompt(formData: FormData): Promise<string>` — **existing**, now also attaches the active core prompt. Still returns the new entry's id.
  - `updateProduction(formData: FormData): Promise<void>` — reads `id`, `chatgptOutput`, `videoUrl`, `views` from the FormData.
  - `createCorePrompt(formData: FormData): Promise<void>` — reads `label`, `content`. The newly created version becomes the active one.
  - `setActiveCorePrompt(id: string): Promise<void>`

- [ ] **Step 1: Rewrite `app/actions.ts`**

Replace the whole file with:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";

export async function createPrompt(formData: FormData) {
  const productName = String(formData.get("productName") ?? "").trim();
  const productInfo = String(formData.get("productInfo") ?? "").trim();
  const riskModule = String(formData.get("riskModule") ?? "").trim();
  const extraNotes = String(formData.get("extraNotes") ?? "").trim();
  const images = formData
    .getAll("images")
    .map((value) => String(value).trim())
    .filter((value) => value.length > 0);

  if (!productName || !productInfo) {
    throw new Error("กรุณากรอกชื่อสินค้าและข้อมูลสินค้า");
  }

  const activeCorePrompt = await prisma.corePrompt.findFirst({
    where: { isActive: true },
  });

  const created = await prisma.promptEntry.create({
    data: {
      productName,
      productInfo,
      riskModule,
      extraNotes,
      images: JSON.stringify(images),
      corePromptId: activeCorePrompt?.id ?? null,
    },
  });

  revalidatePath("/");

  return created.id;
}

export async function deletePrompt(id: string) {
  await prisma.promptEntry.delete({ where: { id } });
  revalidatePath("/");
}

export async function updateProduction(formData: FormData) {
  const id = String(formData.get("id") ?? "").trim();
  if (!id) {
    throw new Error("ไม่พบรายการที่ต้องการบันทึก");
  }

  const chatgptOutput = String(formData.get("chatgptOutput") ?? "").trim();
  const videoUrl = String(formData.get("videoUrl") ?? "").trim();
  const rawViews = String(formData.get("views") ?? "").trim();

  const parsedViews = rawViews === "" ? null : Number(rawViews);
  if (parsedViews !== null && (!Number.isInteger(parsedViews) || parsedViews < 0)) {
    throw new Error("ยอดวิวต้องเป็นจำนวนเต็มไม่ติดลบ");
  }

  const existing = await prisma.promptEntry.findUnique({ where: { id } });
  if (!existing) {
    throw new Error("ไม่พบรายการที่ต้องการบันทึก");
  }

  // Only stamp viewsUpdatedAt when the number actually changes, so the
  // timestamp keeps telling you how old the figure is.
  const viewsChanged = parsedViews !== existing.views;

  await prisma.promptEntry.update({
    where: { id },
    data: {
      chatgptOutput,
      videoUrl,
      views: parsedViews,
      viewsUpdatedAt: viewsChanged
        ? parsedViews === null
          ? null
          : new Date()
        : existing.viewsUpdatedAt,
    },
  });

  revalidatePath("/");
}

export async function createCorePrompt(formData: FormData) {
  const label = String(formData.get("label") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();

  if (!label || !content) {
    throw new Error("กรุณากรอกชื่อเวอร์ชันและเนื้อหา core prompt");
  }

  await prisma.$transaction([
    prisma.corePrompt.updateMany({
      where: { isActive: true },
      data: { isActive: false },
    }),
    prisma.corePrompt.create({
      data: { label, content, isActive: true },
    }),
  ]);

  revalidatePath("/");
}

export async function setActiveCorePrompt(id: string) {
  await prisma.$transaction([
    prisma.corePrompt.updateMany({
      where: { isActive: true },
      data: { isActive: false },
    }),
    prisma.corePrompt.update({
      where: { id },
      data: { isActive: true },
    }),
  ]);

  revalidatePath("/");
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npm run build`
Expected: `✓ Compiled successfully`, `Finished TypeScript`, no errors.

- [ ] **Step 3: Verify lint is clean**

Run: `npm run lint`
Expected: no output (no errors).

- [ ] **Step 4: Commit**

```bash
git add app/actions.ts
git commit -m "Add server actions for core prompt versions and production results"
```

---

### Task 3: Tab bar component and workspace tab state

This task makes the three tabs exist and switch, with tabs ② and ③ showing placeholders. Later tasks fill those panels in. Doing it this way means the tab plumbing is independently reviewable and the app never sits in a broken state.

**Files:**
- Create: `components/workspace-tabs.tsx`
- Modify: `components/clapper-header.tsx`
- Modify: `components/prompt-workspace.tsx`
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: `createPrompt` / `deletePrompt` from `app/actions.ts` (already used).
- Produces:
  - `type WorkspaceTab = "brief" | "production" | "core"` exported from `components/workspace-tabs.tsx`
  - `WorkspaceTabs` component: `{ active: WorkspaceTab; onChange: (tab: WorkspaceTab) => void; productionDisabled: boolean }`
  - `PromptEntry` type in `components/prompt-workspace.tsx` grows to include `corePromptId`, `chatgptOutput`, `videoUrl`, `views`, `viewsUpdatedAt`
  - `CorePromptRecord` type exported from `components/prompt-workspace.tsx`: `{ id: string; label: string; content: string; isActive: boolean }`
  - `PromptWorkspace` now takes `{ prompts: PromptEntry[]; corePrompts: CorePromptRecord[] }`

- [ ] **Step 1: Create the tab bar**

Create `components/workspace-tabs.tsx`:

```tsx
"use client";

import { cn } from "@/lib/utils";

export type WorkspaceTab = "brief" | "production" | "core";

const TABS: { id: WorkspaceTab; label: string }[] = [
  { id: "brief", label: "① Brief & Script" },
  { id: "production", label: "② ผลลัพธ์ & คลิป" },
  { id: "core", label: "③ Core Prompt" },
];

export function WorkspaceTabs({
  active,
  onChange,
  productionDisabled,
}: {
  active: WorkspaceTab;
  onChange: (tab: WorkspaceTab) => void;
  productionDisabled: boolean;
}) {
  return (
    <nav className="flex flex-wrap gap-1 px-4 pb-3 sm:px-6" aria-label="มุมมองงาน">
      {TABS.map((tab) => {
        const isDisabled = tab.id === "production" && productionDisabled;
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            disabled={isDisabled}
            aria-current={isActive ? "page" : undefined}
            title={isDisabled ? "เลือกรายการจากประวัติก่อน" : undefined}
            onClick={() => onChange(tab.id)}
            className={cn(
              "rounded-md px-3 py-1.5 font-mono text-xs tracking-wide transition-colors",
              "focus-visible:ring-2 focus-visible:ring-marigold focus-visible:outline-none",
              isActive
                ? "bg-marigold text-ink"
                : "text-paper/60 hover:bg-ink-2 hover:text-paper",
              isDisabled && "cursor-not-allowed opacity-40 hover:bg-transparent"
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 2: Let the header render the tab bar**

In `components/clapper-header.tsx`, add a `children` prop and render it above the stripe. Replace the whole file with:

```tsx
import { Clapperboard } from "lucide-react";

export function ClapperHeader({
  sceneName,
  takeNumber,
  children,
}: {
  sceneName: string;
  takeNumber: number;
  children?: React.ReactNode;
}) {
  return (
    <header className="relative bg-ink text-paper">
      <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <Clapperboard className="size-6 shrink-0 text-marigold" strokeWidth={1.75} />
          <div>
            <h1 className="font-display text-xl leading-none tracking-wide text-paper sm:text-2xl">
              Pooling Prompt
            </h1>
            <p className="mt-1 text-xs text-paper/60">
              ประกอบ Core Prompt สำหรับวิดีโอ TikTok Shop
            </p>
          </div>
        </div>

        <div className="-rotate-2 rounded-md border border-paper/15 bg-ink-2 px-4 py-2 shadow-[3px_3px_0_0_rgba(0,0,0,0.35)]">
          <div className="flex items-center gap-4 font-mono text-[0.7rem] tracking-widest text-paper/50 uppercase">
            <span>Take {String(takeNumber).padStart(2, "0")}</span>
          </div>
          <p className="mt-0.5 max-w-[14rem] truncate font-mono text-sm text-marigold">
            {sceneName || "ยังไม่ตั้งชื่อสินค้า"}
          </p>
        </div>
      </div>

      {children}

      <div className="clapper-stripes h-2 w-full" />
    </header>
  );
}
```

- [ ] **Step 3: Add tab state to the workspace**

In `components/prompt-workspace.tsx`, make these edits:

Add to the imports at the top:

```tsx
import { WorkspaceTabs, type WorkspaceTab } from "@/components/workspace-tabs";
```

Grow the `PromptEntry` type and add `CorePromptRecord` (replace the existing `PromptEntry` type block):

```tsx
export type PromptEntry = {
  id: string;
  productName: string;
  productInfo: string;
  riskModule: string;
  extraNotes: string;
  images: string;
  corePromptId: string | null;
  chatgptOutput: string;
  videoUrl: string;
  views: number | null;
  viewsUpdatedAt: Date | null;
};

export type CorePromptRecord = {
  id: string;
  label: string;
  content: string;
  isActive: boolean;
};
```

Change the component signature and add tab state. Replace this line:

```tsx
export function PromptWorkspace({ prompts }: { prompts: PromptEntry[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
```

with:

```tsx
export function PromptWorkspace({
  prompts,
  corePrompts,
}: {
  prompts: PromptEntry[];
  corePrompts: CorePromptRecord[];
}) {
  const [tab, setTab] = useState<WorkspaceTab>("brief");
  const [selectedId, setSelectedId] = useState<string | null>(null);
```

Make `startNew()` bounce the user back to the brief tab, since tab ② has nothing to attach to. Replace the existing `startNew` function with:

```tsx
  function startNew() {
    setSelectedId(null);
    setForm(emptyForm);
    setTab("brief");
  }
```

Finally replace the whole `return ( ... )` block with:

```tsx
  const selectedEntry = prompts.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <ClapperHeader sceneName={form.productName} takeNumber={takeNumber}>
        <WorkspaceTabs
          active={tab}
          onChange={setTab}
          productionDisabled={selectedEntry === null}
        />
      </ClapperHeader>

      <div className="flex flex-1 flex-col lg:flex-row">
        <HistoryRail
          prompts={prompts}
          selectedId={selectedId}
          onSelect={selectPrompt}
          onNew={startNew}
          onDelete={handleDelete}
        />

        {tab === "brief" && (
          <div className="flex flex-1 flex-col gap-5 p-4 sm:p-6 xl:flex-row">
            <BriefForm
              form={form}
              isCreating={isCreating}
              onFieldChange={updateField}
              onImageChange={updateImage}
              onAddImage={addImage}
              onRemoveImage={removeImage}
              action={createAction}
            />
            <ScriptOutput output={output} copied={copied} onCopy={handleCopy} />
          </div>
        )}

        {tab === "production" && selectedEntry && (
          <div className="flex flex-1 flex-col p-4 sm:p-6">
            <p className="text-sm text-muted-foreground">แท็บผลลัพธ์ (จะทำใน Task 4)</p>
          </div>
        )}

        {tab === "core" && (
          <div className="flex flex-1 flex-col p-4 sm:p-6">
            <p className="text-sm text-muted-foreground">
              แท็บ Core Prompt ({corePrompts.length} เวอร์ชัน) (จะทำใน Task 5)
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
```

Note: the `selectedIndex` / `takeNumber` lines that already exist just above the old `return` stay exactly as they are — do not delete them.

- [ ] **Step 4: Fetch core prompts on the page**

Replace the whole of `app/page.tsx` with:

```tsx
import { prisma } from "@/lib/prisma";
import { PromptWorkspace } from "@/components/prompt-workspace";

export default async function PoolingPrompt() {
  const [prompts, corePrompts] = await Promise.all([
    prisma.promptEntry.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.corePrompt.findMany({ orderBy: { createdAt: "desc" } }),
  ]);

  return <PromptWorkspace prompts={prompts} corePrompts={corePrompts} />;
}
```

- [ ] **Step 5: Verify build and lint**

Run: `npm run build && npm run lint`
Expected: `✓ Compiled successfully`, `Finished TypeScript`, and no lint output.

- [ ] **Step 6: Drive the app and confirm tabs switch**

Start the server:
```bash
npm run dev &
timeout 30 bash -c 'until curl -sf http://localhost:3000 >/dev/null; do sleep 1; done' && echo UP
```

Set up Playwright once, in **your session's scratchpad directory** (named in your system prompt) — NOT in the project, and do NOT add it to `package.json`. Set `SCRATCH` to `<your scratchpad>/pw` and run:
```bash
mkdir -p "$SCRATCH" && cd "$SCRATCH"
npm init -y >/dev/null && npm install playwright >/dev/null
npx playwright install chromium
```
Reuse this same `$SCRATCH` for Tasks 4, 5, and 6 — install it only once.

Write `$SCRATCH/tabs.js`:
```js
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await page.goto("http://localhost:3000", { waitUntil: "networkidle" });

  // Tab 2 must be disabled with nothing selected.
  const productionDisabledAtStart = await page
    .locator('button:has-text("② ผลลัพธ์")')
    .isDisabled();

  // Tab 3 is always reachable.
  await page.click('button:has-text("③ Core Prompt")');
  const sawCorePanel = await page.locator("text=แท็บ Core Prompt").isVisible();

  // Create an entry, which selects it, which should enable tab 2.
  await page.click('button:has-text("① Brief")');
  await page.fill('input[name="productName"]', "ทดสอบแท็บ");
  await page.fill('textarea[name="productInfo"]', "ข้อมูลทดสอบ");
  await page.click('button:has-text("สร้าง Prompt")');
  await page.waitForSelector('button:has-text("ทดสอบแท็บ")', { timeout: 10000 });
  await page.waitForTimeout(500);

  const productionEnabledAfterCreate = !(await page
    .locator('button:has-text("② ผลลัพธ์")')
    .isDisabled());

  await page.click('button:has-text("② ผลลัพธ์")');
  const sawProductionPanel = await page.locator("text=แท็บผลลัพธ์").isVisible();

  console.log(JSON.stringify({
    productionDisabledAtStart,
    sawCorePanel,
    productionEnabledAfterCreate,
    sawProductionPanel,
    errors,
  }, null, 2));

  await browser.close();
})().catch((e) => { console.error("FAILED:", e); process.exit(1); });
```

Run: `node "$SCRATCH/tabs.js"`

Expected output — all four booleans `true`, `errors` empty:
```json
{
  "productionDisabledAtStart": true,
  "sawCorePanel": true,
  "productionEnabledAfterCreate": true,
  "sawProductionPanel": true,
  "errors": []
}
```

- [ ] **Step 7: Clean up the test row and stop the server**

```bash
cd <project root>
npx prisma db execute --stdin <<< "DELETE FROM PromptEntry WHERE productName = 'ทดสอบแท็บ';"
netstat -ano | grep ':3000' | grep LISTENING   # note the PID
taskkill //PID <pid> //F
```

- [ ] **Step 8: Commit**

```bash
git add components/workspace-tabs.tsx components/clapper-header.tsx components/prompt-workspace.tsx app/page.tsx
git commit -m "Split workspace into brief, production, and core prompt tabs"
```

---

### Task 4: Production panel (tab ②)

**Files:**
- Create: `components/production-panel.tsx`
- Modify: `components/prompt-workspace.tsx` (swap the tab ② placeholder for the real panel)

**Interfaces:**
- Consumes: `updateProduction(formData: FormData)` from `app/actions.ts` (Task 2); `PromptEntry` type from `components/prompt-workspace.tsx` (Task 3).
- Produces: `ProductionPanel` component: `{ entry: PromptEntry }`. It owns its own form state and calls `updateProduction` itself — the parent passes no callbacks.

- [ ] **Step 1: Create the panel**

Create `components/production-panel.tsx`:

```tsx
"use client";

import { useActionState, useState } from "react";
import { ExternalLink } from "lucide-react";

import { updateProduction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { PromptEntry } from "@/components/prompt-workspace";

function formatStamp(value: Date | null) {
  if (!value) return null;
  return new Date(value).toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function ProductionPanel({ entry }: { entry: PromptEntry }) {
  // Keyed on entry.id by the parent, so this initial state is correct on switch.
  const [chatgptOutput, setChatgptOutput] = useState(entry.chatgptOutput);
  const [videoUrl, setVideoUrl] = useState(entry.videoUrl);
  const [views, setViews] = useState(entry.views === null ? "" : String(entry.views));

  const [state, action, isSaving] = useActionState(
    async (_prev: { ok: boolean } | null, formData: FormData) => {
      await updateProduction(formData);
      return { ok: true };
    },
    null
  );

  const stamp = formatStamp(entry.viewsUpdatedAt);

  return (
    <section className="flex flex-1 flex-col gap-5 rounded-xl border border-border bg-card p-5 sm:p-6">
      <div className="flex items-center gap-2 border-b border-border pb-3">
        <span className="h-4 w-1 rounded-full bg-marigold" />
        <h2 className="font-mono text-xs tracking-widest text-marigold uppercase">
          Production · ผลลัพธ์ &amp; คลิป
        </h2>
      </div>

      <form action={action} className="flex flex-1 flex-col gap-5">
        <input type="hidden" name="id" value={entry.id} />

        <div className="flex flex-1 flex-col gap-1.5">
          <label className="text-sm font-medium text-foreground/90">
            10-part prompt ที่ ChatGPT ตอบกลับ
          </label>
          <Textarea
            name="chatgptOutput"
            value={chatgptOutput}
            onChange={(e) => setChatgptOutput(e.target.value)}
            placeholder="วาง 10-part prompt ที่ได้จาก ChatGPT ที่นี่"
            className="min-h-80 flex-1 font-sans text-sm leading-[1.6em]"
          />
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground/90">ลิงก์คลิป TikTok</label>
            <div className="flex items-center gap-2">
              <Input
                name="videoUrl"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                placeholder="https://www.tiktok.com/@.../video/..."
              />
              {videoUrl && (
                <a
                  href={videoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="เปิดคลิป"
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <ExternalLink className="size-4" />
                </a>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground/90">ยอดวิว</label>
            <Input
              name="views"
              type="number"
              min={0}
              step={1}
              value={views}
              onChange={(e) => setViews(e.target.value)}
              placeholder="เช่น 12000"
            />
            <p className="font-mono text-[0.7rem] text-muted-foreground">
              {stamp ? `อัปเดตล่าสุด ${stamp}` : "ยังไม่เคยบันทึกยอดวิว"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button
            type="submit"
            disabled={isSaving}
            size="lg"
            className="self-start bg-rust text-primary-foreground hover:bg-rust/90"
          >
            {isSaving ? "กำลังบันทึก..." : "บันทึกผลลัพธ์"}
          </Button>
          {state?.ok && !isSaving && (
            <span className="font-mono text-xs text-muted-foreground">บันทึกแล้ว</span>
          )}
        </div>
      </form>
    </section>
  );
}
```

- [ ] **Step 2: Wire it into the workspace**

In `components/prompt-workspace.tsx`, add to the imports:

```tsx
import { ProductionPanel } from "@/components/production-panel";
```

Then replace the tab ② placeholder block:

```tsx
        {tab === "production" && selectedEntry && (
          <div className="flex flex-1 flex-col p-4 sm:p-6">
            <p className="text-sm text-muted-foreground">แท็บผลลัพธ์ (จะทำใน Task 4)</p>
          </div>
        )}
```

with:

```tsx
        {tab === "production" && selectedEntry && (
          <div className="flex flex-1 flex-col p-4 sm:p-6">
            <ProductionPanel key={selectedEntry.id} entry={selectedEntry} />
          </div>
        )}
```

The `key` is load-bearing: it forces React to remount the panel when you pick a different entry from the sidebar, so its local form state resets to that entry's saved values.

- [ ] **Step 3: Verify build and lint**

Run: `npm run build && npm run lint`
Expected: `✓ Compiled successfully`, `Finished TypeScript`, no lint output.

- [ ] **Step 4: Drive it end-to-end**

Start the server (`npm run dev &`, wait for port 3000 as in Task 3).

Write `$SCRATCH/production.js`:
```js
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await page.goto("http://localhost:3000", { waitUntil: "networkidle" });

  // Create an entry to attach production data to.
  await page.fill('input[name="productName"]', "ทดสอบผลลัพธ์");
  await page.fill('textarea[name="productInfo"]', "ข้อมูลทดสอบ");
  await page.click('button:has-text("สร้าง Prompt")');
  await page.waitForSelector('button:has-text("ทดสอบผลลัพธ์")', { timeout: 10000 });
  await page.waitForTimeout(500);

  // Fill in production results.
  await page.click('button:has-text("② ผลลัพธ์")');
  await page.fill('textarea[name="chatgptOutput"]', "1. Style: ทดสอบ\n2. Scene: ทดสอบ");
  await page.fill('input[name="videoUrl"]', "https://www.tiktok.com/@x/video/123");
  await page.fill('input[name="views"]', "4200");
  await page.click('button:has-text("บันทึกผลลัพธ์")');
  await page.waitForSelector("text=บันทึกแล้ว", { timeout: 10000 });

  // Reload: the data must come back from the database, not from memory.
  await page.reload({ waitUntil: "networkidle" });
  await page.click('button:has-text("ทดสอบผลลัพธ์")');
  await page.click('button:has-text("② ผลลัพธ์")');

  const persisted = {
    chatgptOutput: await page.locator('textarea[name="chatgptOutput"]').inputValue(),
    videoUrl: await page.locator('input[name="videoUrl"]').inputValue(),
    views: await page.locator('input[name="views"]').inputValue(),
    stampShown: await page.locator("text=อัปเดตล่าสุด").isVisible(),
  };

  console.log(JSON.stringify({ persisted, errors }, null, 2));

  await browser.close();
})().catch((e) => { console.error("FAILED:", e); process.exit(1); });
```

Run: `node "$SCRATCH/production.js"`

Expected:
```json
{
  "persisted": {
    "chatgptOutput": "1. Style: ทดสอบ\n2. Scene: ทดสอบ",
    "videoUrl": "https://www.tiktok.com/@x/video/123",
    "views": "4200",
    "stampShown": true
  },
  "errors": []
}
```

- [ ] **Step 5: Clean up and stop the server**

```bash
npx prisma db execute --stdin <<< "DELETE FROM PromptEntry WHERE productName = 'ทดสอบผลลัพธ์';"
netstat -ano | grep ':3000' | grep LISTENING
taskkill //PID <pid> //F
```

- [ ] **Step 6: Commit**

```bash
git add components/production-panel.tsx components/prompt-workspace.tsx
git commit -m "Add production panel for recording ChatGPT output and video link"
```

---

### Task 5: Core prompt panel (tab ③)

**Files:**
- Create: `components/core-prompt-panel.tsx`
- Modify: `components/prompt-workspace.tsx` (swap the tab ③ placeholder for the real panel)

**Interfaces:**
- Consumes: `createCorePrompt(formData: FormData)` and `setActiveCorePrompt(id: string)` from `app/actions.ts` (Task 2); `CorePromptRecord` type from `components/prompt-workspace.tsx` (Task 3).
- Produces: `CorePromptPanel` component: `{ corePrompts: CorePromptRecord[] }`.

- [ ] **Step 1: Create the panel**

Create `components/core-prompt-panel.tsx`:

```tsx
"use client";

import { useActionState, useState, useTransition } from "react";
import { Check } from "lucide-react";

import { createCorePrompt, setActiveCorePrompt } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { CorePromptRecord } from "@/components/prompt-workspace";

export function CorePromptPanel({
  corePrompts,
}: {
  corePrompts: CorePromptRecord[];
}) {
  const [viewingId, setViewingId] = useState<string | null>(
    corePrompts.find((c) => c.isActive)?.id ?? corePrompts[0]?.id ?? null
  );
  const [isActivating, startActivating] = useTransition();

  const [, addAction, isAdding] = useActionState(
    async (_prev: { ok: boolean } | null, formData: FormData) => {
      await createCorePrompt(formData);
      return { ok: true };
    },
    null
  );

  const viewing = corePrompts.find((c) => c.id === viewingId) ?? null;

  function activate(id: string) {
    startActivating(async () => {
      await setActiveCorePrompt(id);
    });
  }

  return (
    <div className="flex flex-1 flex-col gap-5 xl:flex-row">
      <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 sm:p-6 xl:w-96">
        <div className="flex items-center gap-2 border-b border-border pb-3">
          <span className="h-4 w-1 rounded-full bg-rust" />
          <h2 className="font-mono text-xs tracking-widest text-rust uppercase">
            Core Prompt · เวอร์ชัน
          </h2>
        </div>

        <ul className="flex flex-col gap-1">
          {corePrompts.map((core) => (
            <li key={core.id}>
              <button
                type="button"
                onClick={() => setViewingId(core.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted",
                  viewingId === core.id && "bg-muted"
                )}
              >
                <span className="font-mono text-xs text-muted-foreground">
                  {core.label}
                </span>
                {core.isActive && (
                  <span className="ml-auto flex items-center gap-1 font-mono text-[0.65rem] text-rust">
                    <Check className="size-3" />
                    ใช้อยู่
                  </span>
                )}
              </button>
            </li>
          ))}
          {corePrompts.length === 0 && (
            <li className="px-2.5 py-2 text-sm text-muted-foreground">
              ยังไม่มีเวอร์ชัน
            </li>
          )}
        </ul>

        <form action={addAction} className="flex flex-col gap-3 border-t border-border pt-4">
          <p className="font-mono text-[0.65rem] tracking-widest text-muted-foreground uppercase">
            เพิ่มเวอร์ชันใหม่
          </p>
          <Input name="label" placeholder="ชื่อเวอร์ชัน เช่น v5" required />
          <Textarea
            name="content"
            rows={6}
            placeholder="วางเนื้อหา core prompt ที่นี่"
            required
          />
          <Button
            type="submit"
            disabled={isAdding}
            className="self-start bg-rust text-primary-foreground hover:bg-rust/90"
          >
            {isAdding ? "กำลังเพิ่ม..." : "เพิ่มและใช้เวอร์ชันนี้"}
          </Button>
        </form>
      </section>

      <section className="flex flex-1 flex-col gap-3 rounded-xl border border-border bg-card p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <span className="h-4 w-1 rounded-full bg-marigold" />
            <h2 className="font-mono text-xs tracking-widest text-marigold uppercase">
              {viewing ? viewing.label : "ยังไม่ได้เลือก"}
            </h2>
          </div>
          {viewing && !viewing.isActive && (
            <Button
              type="button"
              size="sm"
              disabled={isActivating}
              onClick={() => activate(viewing.id)}
              className="bg-marigold text-ink hover:bg-marigold/90"
            >
              {isActivating ? "กำลังเปลี่ยน..." : "ใช้เวอร์ชันนี้"}
            </Button>
          )}
        </div>

        <Textarea
          readOnly
          value={viewing?.content ?? ""}
          placeholder="เลือกเวอร์ชันทางซ้ายเพื่อดูเนื้อหา"
          className="min-h-96 flex-1 resize-none border-none bg-transparent p-0 font-sans text-sm leading-[1.6em] shadow-none focus-visible:ring-0"
        />
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Wire it into the workspace**

In `components/prompt-workspace.tsx`, add to the imports:

```tsx
import { CorePromptPanel } from "@/components/core-prompt-panel";
```

Replace the tab ③ placeholder block:

```tsx
        {tab === "core" && (
          <div className="flex flex-1 flex-col p-4 sm:p-6">
            <p className="text-sm text-muted-foreground">
              แท็บ Core Prompt ({corePrompts.length} เวอร์ชัน) (จะทำใน Task 5)
            </p>
          </div>
        )}
```

with:

```tsx
        {tab === "core" && (
          <div className="flex flex-1 flex-col p-4 sm:p-6">
            <CorePromptPanel corePrompts={corePrompts} />
          </div>
        )}
```

- [ ] **Step 3: Verify build and lint**

Run: `npm run build && npm run lint`
Expected: `✓ Compiled successfully`, `Finished TypeScript`, no lint output.

- [ ] **Step 4: Drive it, including the auto-attach behaviour from Task 2**

Start the server (`npm run dev &`, wait for port 3000).

Write `$SCRATCH/core.js`:
```js
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await page.goto("http://localhost:3000", { waitUntil: "networkidle" });

  // Add two core prompt versions. The second becomes active.
  await page.click('button:has-text("③ Core Prompt")');
  await page.fill('input[name="label"]', "ทดสอบ-v1");
  await page.fill('textarea[name="content"]', "เนื้อหา v1");
  await page.click('button:has-text("เพิ่มและใช้เวอร์ชันนี้")');
  await page.waitForSelector('button:has-text("ทดสอบ-v1")', { timeout: 10000 });

  await page.fill('input[name="label"]', "ทดสอบ-v2");
  await page.fill('textarea[name="content"]', "เนื้อหา v2");
  await page.click('button:has-text("เพิ่มและใช้เวอร์ชันนี้")');
  await page.waitForSelector('button:has-text("ทดสอบ-v2")', { timeout: 10000 });
  await page.waitForTimeout(500);

  // Exactly one version may be active, and it must be v2.
  const activeCount = await page.locator("text=ใช้อยู่").count();

  // Switch active back to v1.
  await page.click('button:has-text("ทดสอบ-v1")');
  await page.click('button:has-text("ใช้เวอร์ชันนี้")');
  await page.waitForTimeout(1000);

  // A new entry must auto-attach the active core prompt (v1). We verify via the DB after.
  await page.click('button:has-text("① Brief")');
  await page.fill('input[name="productName"]', "ทดสอบคอร์");
  await page.fill('textarea[name="productInfo"]', "ข้อมูลทดสอบ");
  await page.click('button:has-text("สร้าง Prompt")');
  await page.waitForSelector('button:has-text("ทดสอบคอร์")', { timeout: 10000 });

  console.log(JSON.stringify({ activeCount, errors }, null, 2));

  await browser.close();
})().catch((e) => { console.error("FAILED:", e); process.exit(1); });
```

Run: `node "$SCRATCH/core.js"`

Expected: `activeCount` is `1`, `errors` empty.

- [ ] **Step 5: Confirm in the database that the new entry attached the active core prompt**

Use the `db-peek.js` helper described in Global Constraints (`node db-peek.js` from the project root):

```bash
node db-peek.js
```

Expected: the row for `ทดสอบคอร์` shows `core: "ทดสอบ-v1"` — the version that was active when it was created. If it shows `core: null`, auto-attach is broken; go back and fix `createPrompt` in `app/actions.ts`.

- [ ] **Step 6: Clean up and stop the server**

```bash
npx prisma db execute --stdin <<< "DELETE FROM PromptEntry WHERE productName IN ('VERIFIED', 'ทดสอบคอร์');"
npx prisma db execute --stdin <<< "DELETE FROM CorePrompt WHERE label IN ('ทดสอบ-v1', 'ทดสอบ-v2');"
netstat -ano | grep ':3000' | grep LISTENING
taskkill //PID <pid> //F
```

- [ ] **Step 7: Commit**

```bash
git add components/core-prompt-panel.tsx components/prompt-workspace.tsx
git commit -m "Add core prompt panel for managing prompt versions"
```

---

### Task 6: Full-flow regression check and docs

Confirms the whole feature works together and that pre-existing entries (created before the migration) still open cleanly.

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: everything from Tasks 1–5.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Verify a pre-migration entry still opens**

Insert a row the way the old schema would have — no production fields, no core prompt:

```bash
npx prisma db execute --stdin <<< "INSERT INTO PromptEntry (id, productName, productInfo, riskModule, extraNotes, images, createdAt, chatgptOutput, videoUrl) VALUES ('legacy1', 'สินค้าเก่า', 'ข้อมูลเก่า', '-', '', '[\"ภาพหน้าสินค้า\",\"ภาพตอนใช้งาน\"]', datetime('now', '-30 days'), '', '');"
```

Start the server, then write `$SCRATCH/regression.js`:
```js
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await page.goto("http://localhost:3000", { waitUntil: "networkidle" });

  // The legacy entry loads into the brief form without crashing.
  await page.click('button:has-text("สินค้าเก่า")');
  await page.waitForTimeout(300);
  const legacyName = await page.locator('input[name="productName"]').inputValue();

  // And its (empty) production tab opens.
  await page.click('button:has-text("② ผลลัพธ์")');
  const legacyOutput = await page.locator('textarea[name="chatgptOutput"]').inputValue();
  const legacyViews = await page.locator('input[name="views"]').inputValue();

  await page.screenshot({ path: "regression.png", fullPage: true });

  console.log(JSON.stringify({
    legacyName,
    legacyOutputIsEmpty: legacyOutput === "",
    legacyViewsIsEmpty: legacyViews === "",
    errors,
  }, null, 2));

  await browser.close();
})().catch((e) => { console.error("FAILED:", e); process.exit(1); });
```

Run: `node "$SCRATCH/regression.js"`

Expected:
```json
{
  "legacyName": "สินค้าเก่า",
  "legacyOutputIsEmpty": true,
  "legacyViewsIsEmpty": true,
  "errors": []
}
```

Also open `regression.png` and look at it — the page must render fully, not blank.

- [ ] **Step 2: Clean up and stop the server**

```bash
npx prisma db execute --stdin <<< "DELETE FROM PromptEntry WHERE id = 'legacy1';"
netstat -ano | grep ':3000' | grep LISTENING
taskkill //PID <pid> //F
```

- [ ] **Step 3: Update `CLAUDE.md`**

In the `## Architecture` section, replace this bullet:

```
- `app/page.tsx` render `<PromptWorkspace>` (Server Component ที่ดึงข้อมูลผ่าน Prisma) ตัว workspace แยกเป็น `components/clapper-header.tsx`, `history-rail.tsx`, `brief-form.tsx`, `script-output.tsx` และประกอบร่างโดย `components/prompt-workspace.tsx` ส่วน mutation ทั้งหมดอยู่ใน `app/actions.ts` (`'use server'`)
```

with:

```
- `app/page.tsx` render `<PromptWorkspace>` (Server Component ที่ดึงข้อมูลผ่าน Prisma) ตัว workspace แบ่งเป็น 3 แท็บผ่าน `components/workspace-tabs.tsx` — ① Brief & Script (`brief-form.tsx` + `script-output.tsx`), ② ผลลัพธ์ & คลิป (`production-panel.tsx`), ③ Core Prompt (`core-prompt-panel.tsx`) โดยมี `components/prompt-workspace.tsx` เป็นตัวถือ state ของแท็บและรายการที่เลือก ส่วน `clapper-header.tsx` กับ `history-rail.tsx` แสดงตลอดทุกแท็บ ส่วน mutation ทั้งหมดอยู่ใน `app/actions.ts` (`'use server'`)
```

In the `## Database` section, add this bullet at the end:

```
- `CorePrompt` เก็บ core prompt แบบมีเวอร์ชัน มี `isActive` ได้ทีละอันเดียว (บังคับผ่าน transaction ใน `app/actions.ts`) — ตอนสร้าง `PromptEntry` ใหม่ระบบจะผูกเวอร์ชันที่ active อยู่ให้อัตโนมัติ
```

- [ ] **Step 4: Delete the dev helper**

```bash
rm db-peek.js
```

Confirm it was never committed:

Run: `git status --short`
Expected: `db-peek.js` does not appear (it was untracked and is now gone). Only `CLAUDE.md` shows as modified.

- [ ] **Step 5: Final build and lint**

Run: `npm run build && npm run lint`
Expected: `✓ Compiled successfully`, `Finished TypeScript`, no lint output.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md
git commit -m "Document the tabbed workspace and core prompt versioning"
```

---

## Done

The branch `feature/prompt-archive` now contains six commits. Merge to `master` when the user is satisfied, or leave it for further iteration.

**Follow-up work deliberately excluded from this plan** (from the spec's "ยังไม่ทำใน phase นี้"): detailed TikTok analytics (note: these expire ~21 days after posting), dashboards or charts, RAG/vector search, fine-tuning, and calling ChatGPT/Gemini via API.
