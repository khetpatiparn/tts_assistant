# Route Split and List Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** แยกแอปหน้าเดียวออกเป็น route (`/`, `/entry/[id]`, `/entry/new`, `/dashboard`, `/core-prompt`) เพื่อให้แต่ละหน้าโหลดเฉพาะข้อมูลที่ตัวเองใช้ แล้วเปลี่ยนหน้าแรกเป็นหน้ารายการที่มีตัวกรอง ค้นหา และ pagination

**Architecture:** ตรรกะกรอง/ค้นหา/แบ่งหน้าเป็น pure function ใน `lib/entry-rows.ts` (ทดสอบด้วย node ได้) · การคิวรีทั้งหมดรวมอยู่ที่ `lib/entry-queries.ts` ไฟล์เดียวเพื่อไม่ให้ route แต่ละอันเขียน Prisma เอง · หน้าทำงานรับข้อมูลที่คำนวณเสร็จแล้วจาก server (`usedAngles`, `defaultScheduled`, `takeNumber`) แทนที่จะรับ array ทั้งหมดไปคำนวณเอง · `components/prompt-workspace.tsx` ถูกผ่าออกเป็น route ต่างๆ แล้วลบทิ้ง

**Tech Stack:** Next.js 16.2.10 (custom build — `params`/`searchParams` เป็น `Promise` ต้อง `await`) · React 19 · Prisma 7 + better-sqlite3 adapter · Tailwind v4 CSS-first · lucide-react v1.23.0

**Spec:** `docs/superpowers/specs/2026-07-29-route-split-and-list-page-design.md`

## Global Constraints

- **ห้ามรัน `npm run build` หรือ `npm run dev` บนพอร์ต 3000** — ผู้ใช้รัน `start.bat` อยู่และใช้แอปทำงานหาเงินจริงทุกวัน ใช้ `npx tsc --noEmit` แทน build · ถ้าต้องรันแอปให้ใช้ isolated dev server เท่านั้น: `cp dev.db dev-test.db` แล้ว `NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001` แล้ว cleanup ด้วย `rm -rf .next-dev dev-test.db`
- **ห้ามแตะ `dev.db` ตัวจริงในการทดสอบที่มีการเขียน** — อ่านแบบ `readonly: true` ได้
- **ไม่มี test runner และไม่มี `tsx` ในโปรเจกต์ ห้ามติดตั้งเพิ่ม** — ทดสอบ pure function ด้วยการคอมไพล์ไปที่ scratch แล้วรันด้วย node
- **สคริปต์ทดสอบต้องเขียนเป็นไฟล์ `.js` จริงด้วย Write tool ในโฟลเดอร์ scratch** (ห้าม `node -e "..."` ผ่าน bash — git-bash แปลง path จนพัง) และ `require()` ด้วย absolute path เข้า `node_modules` ของ repo
- **ห้าม emoji** ทุกที่ · ข้อความ UI เป็นภาษาไทย
- **ใช้ design token เดิมเท่านั้น**: `ink` `ink-2` `paper` `marigold` `rust` `smoke` `record` `border` `card` `muted-foreground` `foreground` `background` `primary-foreground` — ห้ามเพิ่มสีใหม่
- **ไอคอน lucide ต้องชื่อ canonical** — เปิดไฟล์ `node_modules/lucide-react/dist/esm/icons/<kebab-name>.mjs` เช็กก่อนใช้ทุกครั้ง
- **ห้ามใช้ `next/image`** — ใช้ `<img>` พร้อม `// eslint-disable-next-line @next/next/no-img-element` ตามแบบแผนเดิมใน `brief-form.tsx` กับ `history-rail.tsx`
- **ห้ามแก้ `lib/entry-sort.ts` · `lib/entry-search.ts` · `lib/angle.ts` · `lib/recommender.ts` · `lib/dashboard.ts` · `lib/weekly-scoreboard.ts` · `lib/post-time.ts`** — งานนี้เปลี่ยนแค่ว่า *ใคร* เรียกและ *ส่งอะไร* เข้าไป ไม่เปลี่ยนตรรกะข้างใน
- **ห้ามแก้ `prisma/schema.prisma`** — งานนี้ไม่มี migration
- **`git diff tsconfig.json` ต้องว่างก่อน commit ทุกครั้ง** (dev server แก้ไฟล์นี้เองได้ — repo pin `target: "ES2017"` ไว้ตั้งใจ) ถ้าไม่ว่างให้ `git checkout -- tsconfig.json`
- **ห้าม `git add -A`** — ระบุไฟล์ที่แก้เสมอ
- ทำงานบน branch `feature/route-split-and-list-page` (สร้างแล้ว spec commit อยู่บนนั้น)
- **ห้าม merge ทีละส่วน** — merge ทีเดียวตอนจบทั้งแผน

---

### Task 1: `lib/entry-rows.ts` — ชนิดข้อมูลแถวเบา + ตรรกะกรอง/ค้นหา/แบ่งหน้า (pure)

**Files:**
- Create: `lib/entry-rows.ts`
- Create (scratch, ไม่ commit): `<scratch>/test-rows.js`, `<scratch>/verify-rows.js`

**Interfaces:**
- Consumes: `splitTerms`, `matchTier`, `type MatchTier` จาก `@/lib/entry-search` (มีอยู่แล้ว ห้ามแก้)
- Produces (Task 2-5 ใช้ต่อ):
  - `type EntryStatus = "no-prompt" | "awaiting-clip" | "posted"`
  - `type EntryRow` (ดูโค้ดใน Step 3)
  - `const PER_PAGE = 30`
  - `function entryStatus(entry: { hasOutput: boolean; videoUrl: string }): EntryStatus`
  - `function searchAndFilter<T extends SearchableEntry & { status: EntryStatus }>(rows: T[], opts: { query: string; status: EntryStatus | "all" }): T[]`
  - `function paginate<T>(rows: T[], page: number): { items: T[]; totalPages: number; page: number }`
  - `function parseStatusParam(raw: string | string[] | undefined): EntryStatus | "all"`
  - `function parsePageParam(raw: string | string[] | undefined): number`

**บริบทที่ต้องรู้:**

`lib/entry-search.ts` มี `matchTier(entry, terms)` ที่คืน `"name" | "notes" | "info" | null` โดยจัดชั้นตามฟิลด์ที่อ่อนที่สุดที่จำเป็นต้องใช้ **ห้ามเขียนตรรกะการแมตช์ใหม่** ไฟล์นี้แค่เอามาเรียงลำดับและแบ่งหน้าต่อ

การเรียงผลค้นหา: ชั้น `name` มาก่อน `notes` มาก่อน `info` แต่**ภายในชั้นเดียวกันต้องคงลำดับเดิมที่ส่งเข้ามา** (ซึ่งคือลำดับจาก `sortEntriesForRail`) — `Array.prototype.sort` ของ JS เสถียรตามสเปก ES2019 เป็นต้นไป จึงพึ่งได้

`parseStatusParam` / `parsePageParam` รับค่าดิบจาก `searchParams` ซึ่งมีชนิด `string | string[] | undefined` — ค่าที่ไม่รู้จักต้องกลายเป็นค่า default ไม่ใช่ throw เพราะผู้ใช้แก้ URL เองได้

- [ ] **Step 1: เขียนสคริปต์ทดสอบที่ยังไม่ผ่าน**

เขียนไฟล์ `<scratch>/test-rows.js` ด้วย Write tool (แทน `<scratch>` ด้วย scratchpad dir ของเซสชัน):

```js
const {
  entryStatus,
  searchAndFilter,
  paginate,
  parseStatusParam,
  parsePageParam,
  PER_PAGE,
} = require("<scratch>/build/entry-rows.js");

let failed = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label} - got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
}

// ---------- entryStatus ----------
eq("ลงคลิปแล้ว", entryStatus({ hasOutput: true, videoUrl: "https://x" }), "posted");
eq("ลงคลิปแล้วแม้ไม่มี prompt", entryStatus({ hasOutput: false, videoUrl: "https://x" }), "posted");
eq("มี prompt รอลงคลิป", entryStatus({ hasOutput: true, videoUrl: "" }), "awaiting-clip");
eq("ยังไม่มี prompt", entryStatus({ hasOutput: false, videoUrl: "" }), "no-prompt");
eq("videoUrl เว้นวรรคล้วนนับว่ายังไม่ลง", entryStatus({ hasOutput: true, videoUrl: "   " }), "awaiting-clip");

// ---------- searchAndFilter ----------
const row = (id, name, status, info = "", notes = "") => ({
  id, productName: name, productInfo: info, extraNotes: notes, status,
});
const rows = [
  row("a", "ที่นอนแมว", "posted"),
  row("b", "ชั้นวางเหล็ก", "awaiting-clip", "แบรนด์ BMZAR"),
  row("c", "ขวดน้ำ", "no-prompt", "", "เน้นห้องครัว"),
];

eq("ไม่กรองอะไรเลยได้ครบและลำดับเดิม",
  searchAndFilter(rows, { query: "", status: "all" }).map((r) => r.id), ["a", "b", "c"]);
eq("กรองสถานะ",
  searchAndFilter(rows, { query: "", status: "awaiting-clip" }).map((r) => r.id), ["b"]);
eq("ค้นชื่อ",
  searchAndFilter(rows, { query: "แมว", status: "all" }).map((r) => r.id), ["a"]);
eq("ค้นแล้วไม่เจอ",
  searchAndFilter(rows, { query: "ซซซ", status: "all" }).map((r) => r.id), []);
eq("ค้นหลายคำ",
  searchAndFilter(rows, { query: "ชั้นวาง เหล็ก", status: "all" }).map((r) => r.id), ["b"]);
eq("ค้นร่วมกับกรองสถานะ",
  searchAndFilter(rows, { query: "แมว", status: "awaiting-clip" }).map((r) => r.id), []);

// ชั้นสูงกว่าต้องมาก่อน: "ครัว" อยู่ในโน้ตของ c และอยู่ในชื่อของ d
const tiered = [
  row("info1", "สินค้า", "posted", "ครัวเรือน"),
  row("notes1", "สินค้า", "posted", "", "ห้องครัว"),
  row("name1", "ชุดครัว", "posted"),
];
eq("เรียงตามชั้น name -> notes -> info",
  searchAndFilter(tiered, { query: "ครัว", status: "all" }).map((r) => r.id),
  ["name1", "notes1", "info1"]);

// ภายในชั้นเดียวกันต้องคงลำดับเดิม
const sameTier = [row("x", "ครัว 1", "posted"), row("y", "ครัว 2", "posted")];
eq("ชั้นเดียวกันคงลำดับเดิม",
  searchAndFilter(sameTier, { query: "ครัว", status: "all" }).map((r) => r.id), ["x", "y"]);

// ---------- paginate ----------
const many = Array.from({ length: 65 }, (_, i) => ({ id: String(i) }));
eq("หน้าแรกได้ PER_PAGE", paginate(many, 1).items.length, PER_PAGE);
eq("จำนวนหน้ารวม", paginate(many, 1).totalPages, 3);
eq("หน้าสุดท้ายได้เศษ", paginate(many, 3).items.length, 5);
eq("หน้าเกินถูกดึงกลับหน้าสุดท้าย", paginate(many, 99).page, 3);
eq("หน้าติดลบถูกดึงกลับหน้าแรก", paginate(many, -5).page, 1);
eq("ลิสต์ว่างยังมี 1 หน้า", paginate([], 1).totalPages, 1);
eq("ลิสต์ว่างไม่มีของ", paginate([], 1).items, []);

// ---------- parse params ----------
eq("status ค่าถูกต้อง", parseStatusParam("posted"), "posted");
eq("status ค่ามั่วกลายเป็น all", parseStatusParam("มั่ว"), "all");
eq("status ไม่ส่งมากลายเป็น all", parseStatusParam(undefined), "all");
eq("status ส่งมาเป็น array เอาตัวแรก", parseStatusParam(["no-prompt", "posted"]), "no-prompt");
eq("page ปกติ", parsePageParam("4"), 4);
eq("page มั่วกลายเป็น 1", parsePageParam("abc"), 1);
eq("page ไม่ส่งมากลายเป็น 1", parsePageParam(undefined), 1);
eq("page ศูนย์กลายเป็น 1", parsePageParam("0"), 1);

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 2: รันให้เห็นว่าล้มเหลว**

Run: `node "<scratch>/test-rows.js"`
Expected: FAIL — `Cannot find module '<scratch>/build/entry-rows.js'` เพราะยังไม่ได้เขียนและคอมไพล์ไฟล์ต้นทาง

- [ ] **Step 3: เขียน `lib/entry-rows.ts`**

```ts
/**
 * แถวเบาสำหรับหน้ารายการและแถบข้าง + ตรรกะกรอง/ค้นหา/แบ่งหน้า
 *
 * แยกจาก lib/entry-queries.ts โดยตั้งใจ: ไฟล์นี้ไม่แตะ Prisma เลยจึงคอมไพล์เดี่ยว
 * แล้วทดสอบด้วย node ได้ (โปรเจกต์ไม่มี test runner) ส่วนไฟล์นั้นเป็นตัวคิวรีล้วน
 */

import { matchTier, splitTerms, type SearchableEntry } from "@/lib/entry-search";

/** สถานะงานของ entry — ตรงกับที่ isIncomplete เดิมแยกไว้ แต่แตกเป็น 3 ค่าแทน boolean */
export type EntryStatus = "no-prompt" | "awaiting-clip" | "posted";

/**
 * ฟิลด์ที่หน้ารายการและแถบข้างใช้จริง
 *
 * ห้ามเพิ่ม chatgptOutput / productInfo / productSpec / riskModule / caption / hashtags
 * เข้ามาเด็ดขาด — สี่ตัวแรกกินรวมกัน ~11.4 KB จาก 12.4 KB ต่อแถว และเป็นสาเหตุที่
 * หน้าเดิมส่ง 23.5 MB ที่ 1,800 แถว (ดูสเปกหัวข้อ 1.2)
 */
export type EntryRow = {
  id: string;
  productName: string;
  angle: string;
  videoUrl: string;
  postedAt: Date | null;
  createdAt: Date;
  duplicatedFromId: string | null;
  status: EntryStatus;
  /** ชื่อไฟล์รูปแรก — URL เต็มประกอบเป็น /api/uploads/<id>/<thumbnailFilename> */
  thumbnailFilename: string | null;
  // สามตัวล่างนี้หน้ารายการกับแถบข้างไม่ได้ใช้ แต่ /dashboard ต้องใช้: DashboardPanel
  // รับ entries เป็น PostTimeEntry & ScoreboardEntry ซึ่งบังคับให้มีครบ เป็น scalar
  // เล็กๆ ทั้งสามตัวจึงรวมมาในแถวเบาได้โดยไม่กระทบเป้าหมายเรื่องขนาด
  postedTimeOfDay: string | null;
  postedTimeSource: string | null;
  isScheduledPost: boolean;
};

export const PER_PAGE = 30;

const STATUSES: EntryStatus[] = ["no-prompt", "awaiting-clip", "posted"];

/** ชั้นที่น่าเชื่อถือกว่าได้เลขน้อยกว่า เพื่อให้ sort ดันขึ้นบน */
const TIER_RANK = { name: 0, notes: 1, info: 2 } as const;

/**
 * มีคลิปแล้วถือว่าจบ ไม่ว่าจะมี prompt หรือไม่ — entry เก่าบางตัวลงคลิปไปโดยเขียน
 * prompt เองนอกแอป จึงมี videoUrl แต่ไม่มี chatgptOutput
 */
export function entryStatus(entry: { hasOutput: boolean; videoUrl: string }): EntryStatus {
  if (entry.videoUrl.trim() !== "") return "posted";
  return entry.hasOutput ? "awaiting-clip" : "no-prompt";
}

/**
 * กรองตามสถานะก่อน แล้วค่อยค้นหา — ลำดับนี้สำคัญเพราะการค้นหาเปลี่ยนลำดับแถว
 * ส่วนการกรองสถานะไม่เปลี่ยน
 *
 * ไม่มีคำค้น = คงลำดับที่ส่งเข้ามาทั้งหมด (ซึ่งคือลำดับจาก sortEntriesForRail)
 * มีคำค้น = ดันชั้นที่น่าเชื่อถือกว่าขึ้นบน แต่ภายในชั้นเดียวกันคงลำดับเดิม
 * (Array.prototype.sort เสถียรตามสเปก ES2019+ จึงพึ่งพฤติกรรมนี้ได้)
 */
export function searchAndFilter<T extends SearchableEntry & { status: EntryStatus }>(
  rows: T[],
  opts: { query: string; status: EntryStatus | "all" }
): T[] {
  const byStatus =
    opts.status === "all" ? rows : rows.filter((r) => r.status === opts.status);

  const terms = splitTerms(opts.query);
  if (terms.length === 0) return byStatus;

  const ranked: { row: T; rank: number }[] = [];
  for (const row of byStatus) {
    const tier = matchTier(row, terms);
    if (tier !== null) ranked.push({ row, rank: TIER_RANK[tier] });
  }
  ranked.sort((a, b) => a.rank - b.rank);
  return ranked.map((r) => r.row);
}

/** หน้าที่เกินขอบถูกดึงกลับเข้าขอบเสมอ ไม่ throw — ผู้ใช้แก้ URL เองได้ */
export function paginate<T>(
  rows: T[],
  page: number
): { items: T[]; totalPages: number; page: number } {
  const totalPages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const safePage = Math.min(Math.max(1, Math.floor(page) || 1), totalPages);
  const start = (safePage - 1) * PER_PAGE;
  return { items: rows.slice(start, start + PER_PAGE), totalPages, page: safePage };
}

function firstParam(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

export function parseStatusParam(
  raw: string | string[] | undefined
): EntryStatus | "all" {
  const value = firstParam(raw);
  return STATUSES.find((s) => s === value) ?? "all";
}

export function parsePageParam(raw: string | string[] | undefined): number {
  const n = Number.parseInt(firstParam(raw) ?? "", 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}
```

- [ ] **Step 4: คอมไพล์แล้วรันสคริปต์ทดสอบให้ผ่านทั้งหมด**

ไฟล์นี้ import `@/lib/entry-search` ซึ่งเป็น path alias — คอมไพล์เดี่ยวไม่ได้ ต้องคอมไพล์ทั้งคู่พร้อม alias:

Run:
```bash
npx tsc lib/entry-rows.ts lib/entry-search.ts \
  --outDir "<scratch>/build" --module commonjs --target ES2017 \
  --moduleResolution node --skipLibCheck \
  --baseUrl . --paths '{"@/*":["./*"]}'
```
Expected: ไม่มี error และเกิดไฟล์ `<scratch>/build/lib/entry-rows.js` กับ `<scratch>/build/lib/entry-search.js`

**หมายเหตุ:** `--outDir` จะสร้างโครง `lib/` ข้างใน ให้แก้ `require` ในสคริปต์ทดสอบเป็น `<scratch>/build/lib/entry-rows.js` ถ้าโครงออกมาแบบนั้น ตรวจด้วย `ls "<scratch>/build"` ก่อนรัน

Run: `node "<scratch>/test-rows.js"`
Expected: ทุกบรรทัด `PASS` และปิดท้าย `ALL PASS`

**ห้ามแก้ค่าคาดหวังในสคริปต์ทดสอบเพื่อให้ผ่าน**

- [ ] **Step 5: ตรวจกับข้อมูลจริง**

เขียนไฟล์ `<scratch>/verify-rows.js` (อ่าน `dev.db` แบบ **readonly** ห้ามเขียน — แทน `<REPO>` ด้วย `C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt`):

```js
const Database = require("<REPO>/node_modules/better-sqlite3");
const { entryStatus, searchAndFilter, paginate, PER_PAGE } = require("<scratch>/build/lib/entry-rows.js");
const db = new Database("<REPO>/dev.db", { readonly: true });

const raw = db.prepare(`
  SELECT id, productName, productInfo, extraNotes, videoUrl, chatgptOutput FROM PromptEntry
`).all();

const rows = raw.map((r) => ({
  id: r.id,
  productName: r.productName,
  productInfo: r.productInfo,
  extraNotes: r.extraNotes,
  status: entryStatus({ hasOutput: (r.chatgptOutput || "").trim() !== "", videoUrl: r.videoUrl || "" }),
}));

let failed = 0;
function check(label, got, want) {
  const ok = got === want;
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"} ${label}: ${got} (คาด ${want})`);
}

console.log(`entries ทั้งหมด: ${rows.length}\n`);

console.log("=== สถานะต้องรวมกันได้เท่าจำนวนทั้งหมด ===");
const counts = { "no-prompt": 0, "awaiting-clip": 0, posted: 0 };
for (const r of rows) counts[r.status]++;
console.log(`  ยังไม่มี prompt ${counts["no-prompt"]} · รอลงคลิป ${counts["awaiting-clip"]} · ลงแล้ว ${counts.posted}`);
check("ผลรวม", counts["no-prompt"] + counts["awaiting-clip"] + counts.posted, rows.length);

console.log("\n=== กรองสถานะแล้วต้องได้ตามที่นับไว้ ===");
for (const s of ["no-prompt", "awaiting-clip", "posted"]) {
  check(s, searchAndFilter(rows, { query: "", status: s }).length, counts[s]);
}

console.log("\n=== ค้นหาต้องให้ผลเท่ากับที่สเปกก่อนหน้าวัดไว้ (ตรรกะเดิม ย้ายที่รันเฉยๆ) ===");
console.log("  (ตัวเลขอาจต่างจากที่สเปกเก่าจดไว้ถ้าผู้ใช้เพิ่ม entry ใหม่ — ที่ต้องตรงคือ");
console.log("   ผลของ searchAndFilter ต้องเท่ากับการเรียก matchTier ตรงๆ)");
const { splitTerms, matchTier } = require("<scratch>/build/lib/entry-search.js");
for (const q of ["ที่นอน แมว", "ชั้นวาง เหล็ก", "ผ้า", "แมว", "สแตนเลส"]) {
  const terms = splitTerms(q);
  const direct = rows.filter((r) => matchTier(r, terms) !== null).length;
  check(`"${q}"`, searchAndFilter(rows, { query: q, status: "all" }).length, direct);
}

console.log("\n=== แบ่งหน้าต้องครบไม่ตกหล่นไม่ซ้ำ ===");
const all = searchAndFilter(rows, { query: "", status: "all" });
const { totalPages } = paginate(all, 1);
const seen = new Set();
let sum = 0;
for (let p = 1; p <= totalPages; p++) {
  const { items } = paginate(all, p);
  sum += items.length;
  for (const it of items) seen.add(it.id);
}
check("จำนวนรวมทุกหน้า", sum, all.length);
check("ไม่มี id ซ้ำข้ามหน้า", seen.size, all.length);
check("จำนวนหน้า", totalPages, Math.max(1, Math.ceil(all.length / PER_PAGE)));

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
```

Run: `node "<scratch>/verify-rows.js"`
Expected: ทุกบรรทัด `PASS` และ `ALL PASS`

- [ ] **Step 6: ตรวจ type และ lint**

Run: `npx tsc --noEmit`
Expected: ไม่มี error

Run: `npm run lint`
Expected: ไม่มี error (ถ้า error ชี้ไปที่ไฟล์ใน `.next-dev` ให้ `rm -rf .next-dev` แล้วรันใหม่)

- [ ] **Step 7: Commit**

```bash
git diff tsconfig.json   # ต้องว่าง ถ้าไม่ว่างให้ git checkout -- tsconfig.json
git add lib/entry-rows.ts
git commit -F - <<'EOF'
Add the row shape and list logic the routes will share

The page currently ships every entry with its full chatgptOutput, which is
8.7 KB of the 12.4 KB each row costs. This defines the subset the rail and
the list actually read, and the filtering, tiering, and pagination that run
over it, as pure functions so they can be tested without a runner.

Search ordering reuses matchTier unchanged; only the caller moves.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 2: `lib/entry-queries.ts` + แยก `/dashboard` และ `/core-prompt` ออกเป็น route

**Files:**
- Create: `lib/entry-queries.ts`
- Create: `app/dashboard/page.tsx`
- Create: `app/core-prompt/page.tsx`
- Modify: `app/page.tsx`
- Modify: `components/prompt-workspace.tsx`
- Modify: `components/workspace-tabs.tsx`

**Interfaces:**
- Consumes จาก Task 1: `entryStatus`, `type EntryRow`, `type EntryStatus` จาก `@/lib/entry-rows`
- Produces (Task 3-4 ใช้ต่อ):
  - `function getEntryRows(): Promise<EntryRow[]>` — แถวเบาทุกแถว เรียงด้วย `sortEntriesForRail` แล้ว
  - `function getDashboardData(): Promise<{ orders, clipMetrics, followerActivity, reminder, reminderActive, lastOrdersImportedAt, lastMetricsImportedAt }>`

**บริบทที่ต้องรู้:**

`app/page.tsx` ตอนนี้ดึง 5 ตารางพร้อมกันแล้วส่งลง `PromptWorkspace` ทั้งหมด แท็บ ③ ใช้แค่ `corePrompts` และแท็บ ④ ใช้ `orders`/`clipMetrics`/`followerActivity`/`reminder` — สองก้อนนี้ถูกโหลดทุกครั้งแม้ผู้ใช้อยู่แท็บ ① งานนี้ย้ายสองแท็บนั้นออกเป็น route ของตัวเอง

**การหา `hasOutput` โดยไม่โหลด `chatgptOutput`:** Prisma เลือกฟิลด์แบบคำนวณไม่ได้ วิธีที่ใช้คือคิวรีแยกอีกอันที่ `select: { id: true }` เท่านั้น แล้วทำเป็น `Set` — คืนมาแค่ id จึงเบามาก ห้ามใช้วิธี select `chatgptOutput` มาแล้วแปลงเป็น boolean ฝั่ง server เพราะนั่นคือการโหลด 8.7 KB/แถวที่เราพยายามเลี่ยง

`components/dashboard-panel.tsx` รับ prop `onOpenEntry: (entryId: string) => void` (เพิ่มเมื่อ commit `36e0294`) — ใน route ใหม่ยังต้องมี แต่เปลี่ยนไปใช้ `router.push` แทน callback ที่ตั้ง state

`reminderActive` ใช้ทั้งใน `DashboardPanel` และเป็นจุดแดงบนแท็บ ④ — พอแยก route แล้วจุดแดงต้องคำนวณที่ไหนสักที่ที่ทุกหน้าเห็น **ตัดจุดแดงออกไปก่อนในงานนี้** แล้วให้ `reminder-banner.tsx` ในหน้า `/dashboard` ทำหน้าที่เตือนแทน (แถบเตือนนั้นละเอียดกว่าจุดแดงอยู่แล้ว) — ถ้าคิดถึงจุดแดงค่อยเพิ่มทีหลังผ่าน layout ร่วม

- [ ] **Step 1: เขียน `lib/entry-queries.ts`**

```ts
import { prisma } from "@/lib/prisma";
import { sortEntriesForRail } from "@/lib/entry-sort";
import { entryStatus, type EntryRow } from "@/lib/entry-rows";
import { IMPORT_STALE_DAYS, type ReminderState } from "@/lib/dashboard";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * ฟิลด์ที่ดึงมาทำแถวเบา — ห้ามเพิ่ม chatgptOutput / productInfo / productSpec /
 * riskModule / caption / hashtags เข้ามา (ดูคอมเมนต์ที่ EntryRow ใน lib/entry-rows.ts)
 */
const ROW_SELECT = {
  id: true,
  productName: true,
  angle: true,
  videoUrl: true,
  postedAt: true,
  createdAt: true,
  duplicatedFromId: true,
  postedTimeOfDay: true,
  postedTimeSource: true,
  isScheduledPost: true,
  productImages: {
    select: { filename: true },
    orderBy: { sortOrder: "asc" },
    take: 1,
  },
} as const;

/**
 * แถวเบาทุกแถว เรียงตามลำดับเดียวกับแถบข้างเดิม (ยังไม่ลงคลิปบนสุด แล้วใหม่ไปเก่า)
 *
 * ทำสองคิวรี: อันแรกเอาฟิลด์ที่ต้องแสดง อันที่สองเอาแค่ id ของแถวที่มี chatgptOutput
 * เพื่อรู้สถานะโดยไม่ต้องโหลดข้อความ 8.7 KB/แถวมาทั้งก้อน
 */
export async function getEntryRows(): Promise<EntryRow[]> {
  const [rows, withOutput] = await Promise.all([
    prisma.promptEntry.findMany({ select: ROW_SELECT }),
    prisma.promptEntry.findMany({
      where: { NOT: { chatgptOutput: "" } },
      select: { id: true },
    }),
  ]);

  const hasOutputIds = new Set(withOutput.map((r) => r.id));

  return sortEntriesForRail(rows).map((r) => ({
    id: r.id,
    productName: r.productName,
    angle: r.angle,
    videoUrl: r.videoUrl,
    postedAt: r.postedAt,
    createdAt: r.createdAt,
    duplicatedFromId: r.duplicatedFromId,
    status: entryStatus({ hasOutput: hasOutputIds.has(r.id), videoUrl: r.videoUrl }),
    thumbnailFilename: r.productImages[0]?.filename ?? null,
    postedTimeOfDay: r.postedTimeOfDay,
    postedTimeSource: r.postedTimeSource,
    isScheduledPost: r.isScheduledPost,
  }));
}

function daysSince(lastMs: number): number {
  return Math.floor((Date.now() - lastMs) / DAY_MS);
}

/** ข้อมูลทั้งหมดที่หน้า /dashboard ใช้ — ย้ายมาจาก app/page.tsx เดิมทั้งดุ้น */
export async function getDashboardData() {
  const [orders, clipMetrics, followerActivity] = await Promise.all([
    prisma.affiliateOrder.findMany({ orderBy: { orderDate: "asc" } }),
    prisma.clipMetric.findMany({ orderBy: { capturedOn: "asc" } }),
    prisma.followerActivity.findMany({
      orderBy: [{ activityOn: "asc" }, { hour: "asc" }],
    }),
  ]);

  let daysSinceOrdersImport: number | null = null;
  let lastOrdersImportedAt: Date | null = null;
  if (orders.length > 0) {
    const last = Math.max(...orders.map((o) => o.importedAt.getTime()));
    lastOrdersImportedAt = new Date(last);
    daysSinceOrdersImport = daysSince(last);
  }

  let daysSinceMetricsImport: number | null = null;
  let lastMetricsImportedAt: Date | null = null;
  if (clipMetrics.length > 0) {
    const last = Math.max(...clipMetrics.map((m) => m.importedAt.getTime()));
    lastMetricsImportedAt = new Date(last);
    daysSinceMetricsImport = daysSince(last);
  }

  const unmatchedSoldProducts = new Set(
    orders.filter((o) => o.matchedEntryId === null).map((o) => o.contentId)
  ).size;

  const reminder: ReminderState = {
    daysSinceOrdersImport,
    daysSinceMetricsImport,
    unmatchedSoldProducts,
  };

  const reminderActive =
    (daysSinceOrdersImport !== null && daysSinceOrdersImport > IMPORT_STALE_DAYS) ||
    (daysSinceMetricsImport !== null && daysSinceMetricsImport > IMPORT_STALE_DAYS) ||
    unmatchedSoldProducts > 0;

  return {
    orders,
    clipMetrics,
    followerActivity,
    reminder,
    reminderActive,
    lastOrdersImportedAt,
    lastMetricsImportedAt,
  };
}
```

- [ ] **Step 2: สร้าง `app/core-prompt/page.tsx`**

```tsx
import { prisma } from "@/lib/prisma";
import { CorePromptPanel } from "@/components/core-prompt-panel";
import { AppHeader } from "@/components/app-header";

export default async function CorePromptPage() {
  const corePrompts = await prisma.corePrompt.findMany({
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="flex min-h-screen flex-1 flex-col lg:h-screen lg:overflow-hidden">
      <AppHeader active="core" />
      <div className="flex flex-1 flex-col gap-5 p-4 sm:p-6 lg:overflow-y-auto">
        <CorePromptPanel
          corePrompts={corePrompts.filter((c) => c.kind === "core")}
          kind="core"
          title="Core Prompt · สร้างวิดีโอ"
        />
        <CorePromptPanel
          corePrompts={corePrompts.filter((c) => c.kind === "caption")}
          kind="caption"
          title="SEO Prompt · Caption & Hashtag"
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: สร้าง `components/app-header.tsx` (แทน `ClapperHeader` + `WorkspaceTabs` สำหรับหน้าที่ไม่ผูกกับ entry)**

`ClapperHeader` เดิมบังคับให้มี `sceneName` กับ `takeNumber` ซึ่งหน้า `/dashboard` และ `/core-prompt` ไม่มี — ทำหัวที่ไม่ต้องใช้สองค่านั้น

**ก่อนเขียน ให้เช็กชื่อไอคอนก่อน:**

Run: `grep -o 'export {[^}]*' node_modules/lucide-react/dist/esm/icons/clapperboard.mjs`
Expected: เห็น `Clapperboard as default`

```tsx
import Link from "next/link";
import { Clapperboard } from "lucide-react";

import { cn } from "@/lib/utils";

export type NavKey = "list" | "entry" | "core" | "dashboard";

const NAV: { key: NavKey; href: string; label: string }[] = [
  { key: "list", href: "/", label: "รายการสินค้า" },
  { key: "core", href: "/core-prompt", label: "Core Prompt" },
  { key: "dashboard", href: "/dashboard", label: "รายได้" },
];

/**
 * หัวเว็บของหน้าที่ไม่ผูกกับ entry ตัวใดตัวหนึ่ง
 *
 * แยกจาก ClapperHeader เพราะตัวนั้นบังคับให้มีชื่อสินค้ากับเลข take ซึ่งหน้ารายการ
 * หน้ารายได้ และหน้า Core Prompt ไม่มี
 */
export function AppHeader({
  active,
  children,
}: {
  active: NavKey;
  children?: React.ReactNode;
}) {
  return (
    <header className="relative bg-ink text-paper">
      <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <Clapperboard className="size-6 shrink-0 text-marigold" strokeWidth={1.75} />
          <div>
            <h1 className="font-display text-xl leading-none tracking-wide text-paper sm:text-2xl">
              Pooling Prompt
            </h1>
            <p className="mt-1 text-xs text-paper/60">
              ประกอบ Core Prompt สำหรับวิดีโอ TikTok Shop
            </p>
          </div>
        </Link>
        {children}
      </div>

      <nav className="flex flex-wrap gap-1 px-4 pb-3 sm:px-6" aria-label="เมนูหลัก">
        {NAV.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active === item.key ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 font-mono text-xs tracking-wide transition-colors",
              "focus-visible:ring-2 focus-visible:ring-marigold focus-visible:outline-none",
              active === item.key
                ? "bg-marigold text-ink"
                : "text-paper/60 hover:bg-ink-2 hover:text-paper"
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="clapper-stripes h-2 w-full" />
    </header>
  );
}
```

- [ ] **Step 4: สร้าง `app/dashboard/page.tsx`**

```tsx
import { getDashboardData, getEntryRows } from "@/lib/entry-queries";
import { AppHeader } from "@/components/app-header";
import { DashboardRoute } from "@/components/dashboard-route";

export default async function DashboardPage() {
  const [data, rows] = await Promise.all([getDashboardData(), getEntryRows()]);

  return (
    <div className="flex min-h-screen flex-1 flex-col lg:h-screen lg:overflow-hidden">
      <AppHeader active="dashboard" />
      <div className="flex flex-1 flex-col p-4 sm:p-6 lg:overflow-y-auto">
        <DashboardRoute
          orders={data.orders}
          clipMetrics={data.clipMetrics}
          followerActivity={data.followerActivity}
          reminder={data.reminder}
          reminderActive={data.reminderActive}
          lastOrdersImportedAt={data.lastOrdersImportedAt}
          lastMetricsImportedAt={data.lastMetricsImportedAt}
          entries={rows.map((r) => ({
            id: r.id,
            duplicatedFromId: r.duplicatedFromId,
            postedAt: r.postedAt,
            productName: r.productName,
            videoUrl: r.videoUrl,
            postedTimeOfDay: r.postedTimeOfDay,
            postedTimeSource: r.postedTimeSource,
            isScheduledPost: r.isScheduledPost,
          }))}
          now={new Date()}
        />
      </div>
    </div>
  );
}
```

ทั้ง 8 ฟิลด์นี้คือสิ่งที่ `DashboardPanel` บังคับพอดี — prop `entries` มีชนิด `(PostTimeEntry & ScoreboardEntry & { duplicatedFromId: string | null })[]` โดย `PostTimeEntry` (`components/post-time-panel.tsx:25`) ต้องการ `id` `productName` `videoUrl` `postedTimeOfDay` `postedTimeSource` `isScheduledPost` และ `ScoreboardEntry` (`lib/weekly-scoreboard.ts:6`) ต้องการ `id` `postedAt`

- [ ] **Step 5: สร้าง `components/dashboard-route.tsx`**

เป็น client component บางๆ ที่ห่อ `DashboardPanel` เพื่อแปลง `onOpenEntry` จาก callback เป็นการเปลี่ยนหน้า:

```tsx
"use client";

import { useRouter } from "next/navigation";

import { DashboardPanel } from "@/components/dashboard-panel";
import type { ComponentProps } from "react";

type DashboardPanelProps = ComponentProps<typeof DashboardPanel>;

/**
 * แปลง onOpenEntry ของ DashboardPanel จาก callback ที่เคยตั้ง state ในหน้าเดียว
 * ให้กลายเป็นการเปลี่ยน route แทน — ตัว DashboardPanel ไม่ต้องรู้เรื่อง routing
 */
export function DashboardRoute(props: Omit<DashboardPanelProps, "onOpenEntry">) {
  const router = useRouter();
  return (
    <DashboardPanel
      {...props}
      onOpenEntry={(entryId) => router.push(`/entry/${entryId}`)}
    />
  );
}
```

- [ ] **Step 6: ตัดแท็บ ③ กับ ④ ออกจาก `prompt-workspace.tsx`**

ในไฟล์ `components/prompt-workspace.tsx`:

1. ลบบล็อก `{tab === "core" && (...)}` และ `{tab === "dashboard" && (...)}` ออกทั้งหมด
2. ลบ props `corePrompts`, `affiliateOrders`, `clipMetrics`, `followerActivity`, `reminder`, `reminderActive`, `lastOrdersImportedAt`, `lastMetricsImportedAt`, `now` ออกจาก signature และ type
3. ลบ `dashboardEntries` useMemo ออก
4. ลบ import ที่ไม่ได้ใช้แล้ว: `CorePromptPanel`, `DashboardPanel`, และ type ที่ตามมาด้วย
5. `usedAngles` ยังต้องใช้ `affiliateOrders` กับ `clipMetrics` — **ยังอย่าเพิ่งลบสองตัวนี้** ให้คงไว้ก่อน Task 3 จะย้ายการคำนวณนี้ไปฝั่ง server ทั้งหมด

**หมายเหตุ:** `openEntry` ที่มีอยู่ยังคงไว้เหมือนเดิม (Task 3 จะจัดการ) และ `railResetKey` ยังคงไว้

- [ ] **Step 7: แก้ `components/workspace-tabs.tsx` ให้เหลือแค่แท็บของ entry**

```tsx
"use client";

import { cn } from "@/lib/utils";

export type WorkspaceTab = "brief" | "production";

const TABS: { id: WorkspaceTab; label: string }[] = [
  { id: "brief", label: "① Brief & Script" },
  { id: "production", label: "② ผลลัพธ์ & คลิป" },
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
            title={isDisabled ? "ยังไม่ได้บันทึกสินค้านี้" : undefined}
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

- [ ] **Step 8: แก้ `app/page.tsx` ให้เลิกดึงข้อมูลของสองแท็บที่ย้ายออกไป**

ลบ `corePrompt.findMany` / `affiliateOrder.findMany` / `clipMetric.findMany` / `followerActivity.findMany` และตรรกะ reminder ทั้งหมดออก เหลือเฉพาะ:

```tsx
import { prisma } from "@/lib/prisma";
import { PromptWorkspace } from "@/components/prompt-workspace";
import { sortEntriesForRail } from "@/lib/entry-sort";

export default async function PoolingPrompt() {
  const [prompts, orders, clipMetrics] = await Promise.all([
    prisma.promptEntry.findMany({
      orderBy: { createdAt: "desc" },
      include: { productImages: { orderBy: { sortOrder: "asc" } } },
    }),
    prisma.affiliateOrder.findMany({ orderBy: { orderDate: "asc" } }),
    prisma.clipMetric.findMany({ orderBy: { capturedOn: "asc" } }),
  ]);

  return (
    <PromptWorkspace
      prompts={sortEntriesForRail(prompts)}
      affiliateOrders={orders}
      clipMetrics={clipMetrics}
    />
  );
}
```

(`orders`/`clipMetrics` ยังอยู่เพราะ `usedAngles` ต้องใช้ — Task 3 จะย้ายไปฝั่ง server แล้วตัดออก)

- [ ] **Step 9: ตรวจ type และ lint**

Run: `npx tsc --noEmit`
Expected: ไม่มี error — ถ้ามี ให้ไล่ตามที่ compiler ชี้ ส่วนใหญ่จะเป็น prop ที่ยังส่งอยู่แต่ถูกลบไปแล้ว

Run: `npm run lint`
Expected: ไม่มี error

- [ ] **Step 10: ทดสอบ UI จริงบน isolated dev server**

```bash
cp dev.db dev-test.db
NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001
```

ตรวจ:
- `http://localhost:3001/core-prompt` — เห็น Core Prompt กับ SEO Prompt ครบสองแผง เพิ่มเวอร์ชันใหม่และตั้ง active ได้
- `http://localhost:3001/dashboard` — Weekly Scoreboard, กราฟ, ราย-คลิป, เวลาโพสต์, แถบเตือน, ฟอร์มนำเข้า ครบเหมือนเดิม
- **กดการ์ดคำแนะนำในหน้า dashboard** — เด้งไป `/entry/<id>` แล้วขึ้น 404 (ยังไม่มี route นี้จนกว่าจะถึง Task 3) **นี่คือผลที่คาดไว้ ไม่ใช่บั๊ก**
- `http://localhost:3001/` — ยังทำงานเหมือนเดิม แต่เหลือแค่แท็บ ① กับ ② และเมนูบนหัวยังไม่มี (หน้านี้ยังใช้ `ClapperHeader` เดิม)
- ไม่มี console error / hydration warning

ปิด server แล้ว cleanup: `rm -rf .next-dev dev-test.db`

- [ ] **Step 11: Commit**

```bash
git diff tsconfig.json   # ต้องว่าง
git add lib/entry-queries.ts app/dashboard/page.tsx app/core-prompt/page.tsx \
        components/app-header.tsx components/dashboard-route.tsx \
        components/prompt-workspace.tsx components/workspace-tabs.tsx app/page.tsx
git commit -F - <<'EOF'
Give the dashboard and core prompts their own routes

Both tabs loaded on every request even when the user was writing a brief:
269 orders, 168 follower rows, and every core prompt version, fetched to
render a tab nobody had opened. They now load when visited.

The row query deliberately reads ids of entries that have output rather than
the output itself, so knowing an entry's status costs nothing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 3: `/entry/[id]` และ `/entry/new` + แถบข้างผอม

**Files:**
- Create: `app/entry/[id]/page.tsx`
- Create: `app/entry/new/page.tsx`
- Create: `components/entry-workspace.tsx`
- Modify: `components/history-rail.tsx`
- Modify: `lib/entry-queries.ts`

**Interfaces:**
- Consumes จาก Task 2: `getEntryRows` จาก `@/lib/entry-queries` · `AppHeader` จาก `@/components/app-header`
- Produces (Task 4-5 ใช้ต่อ):
  - `function getEntryDetail(id: string): Promise<EntryDetail | null>` ใน `lib/entry-queries.ts`
  - `function getUsedAngles(entryId: string): Promise<UsedAngleWithOutcome[]>` ใน `lib/entry-queries.ts`
  - `function getDefaultScheduled(): Promise<boolean>` ใน `lib/entry-queries.ts`
  - `HistoryRail` เปลี่ยน props เป็น `{ rows: EntryRow[]; selectedId: string | null; onDuplicate; onDelete }`

**บริบทที่ต้องรู้:**

**`usedAngles` ย้ายไปคำนวณฝั่ง server ทั้งหมด** — สเปกเขียนไว้ว่าจะส่งแถวสายเลือดลง client (~180 KB) แต่ทำฝั่ง server ดีกว่าเพราะผลลัพธ์คือ angle ไม่กี่ตัว ไม่ต้องส่ง `affiliateOrders` กับ `clipMetrics` ลง client เลย **ให้ทำแบบฝั่ง server** ตรรกะเดิมอยู่ที่ `prompt-workspace.tsx` useMemo ชื่อ `usedAngles` — ย้ายมาทั้งดุ้น แต่เปลี่ยน `chatgptOutput: p.chatgptOutput` เป็นการเช็กจาก id set แบบเดียวกับ `getEntryRows`

**เลข take** ต้องเท่าเดิมกับสูตรเดิม `prompts.length - index` โดย `index` คือตำแหน่งในลำดับ `sortEntriesForRail` — คำนวณจาก `getEntryRows()` ที่เรียงแล้ว

**`defaultScheduled`** เดิมคำนวณจาก `prompts` ทั้งหมด (สัดส่วนคลิปที่ตั้งเวลาไว้) — ย้ายเป็นคิวรีนับสองครั้งฝั่ง server

**แถบข้างที่ต้องตัดออก:** ช่องค้นหา · ปุ่มกรอง "ยังไม่ได้กรอกผลลัพธ์" · หัวข้อกลุ่มตามเดือน · การจัดชั้นผลค้นหา · `showInfoMatches` · `isIncomplete` · `monthLabel` · `UNDATED_GROUP` · import ของ `matchTier`/`splitTerms`/`MatchTier`/`Input`/`Search`/`ChevronRight` — ทั้งหมดย้ายไปหน้ารายการใน Task 4

- [ ] **Step 1: เพิ่มคิวรีที่หน้าทำงานต้องใช้ลงใน `lib/entry-queries.ts`**

เพิ่ม import ที่หัวไฟล์:

```ts
import { collectFamily, collectUsedAngles, summarizeEntryOutcome } from "@/lib/angle";
import type { UsedAngleWithOutcome } from "@/components/angle-panel";
```

แล้วเพิ่มท้ายไฟล์:

```ts
export type EntryDetail = NonNullable<Awaited<ReturnType<typeof getEntryDetail>>>;

/** entry ตัวเดียวแบบเต็ม (รวม chatgptOutput) — โหลดเฉพาะตัวที่เปิดอยู่เท่านั้น */
export async function getEntryDetail(id: string) {
  return prisma.promptEntry.findUnique({
    where: { id },
    include: { productImages: { orderBy: { sortOrder: "asc" } } },
  });
}

/**
 * angle ที่เคยใช้กับสินค้าเดียวกัน พร้อมผลลัพธ์ของแต่ละ angle
 *
 * คำนวณฝั่ง server ทั้งหมดเพื่อไม่ต้องส่ง affiliateOrders กับ clipMetrics ลง client —
 * ผลลัพธ์คือ angle ไม่กี่ตัว ส่วนวัตถุดิบคือทั้งตาราง
 *
 * จับกลุ่ม "สินค้าเดียวกัน" ด้วยสายเลือด duplicatedFromId ไม่ใช่ชื่อสินค้า
 * (dev.db มีสินค้าคนละชิ้นที่ชื่อซ้ำกัน จับด้วยชื่อจะเอา angle ของสินค้าอื่นมาปน)
 */
export async function getUsedAngles(entryId: string): Promise<UsedAngleWithOutcome[]> {
  const [lineageRows, withOutput, orders, metrics] = await Promise.all([
    prisma.promptEntry.findMany({
      select: {
        id: true,
        duplicatedFromId: true,
        angle: true,
        videoUrl: true,
        postedAt: true,
      },
    }),
    prisma.promptEntry.findMany({
      where: { NOT: { chatgptOutput: "" } },
      select: { id: true },
    }),
    prisma.affiliateOrder.findMany(),
    prisma.clipMetric.findMany(),
  ]);

  const hasOutputIds = new Set(withOutput.map((r) => r.id));
  // collectUsedAngles อ่าน chatgptOutput เพื่อข้าม "ร่างเปล่า" เท่านั้น จึงเติมค่าตัวแทน
  // ที่ว่าง/ไม่ว่างให้ตรงความจริงพอ ไม่ต้องโหลดข้อความจริง 8.7 KB ต่อแถว
  const lineage = lineageRows.map((r) => ({
    ...r,
    chatgptOutput: hasOutputIds.has(r.id) ? "x" : "",
  }));

  const family = collectFamily(lineage, entryId);
  return collectUsedAngles(family, entryId).map((u) => ({
    ...u,
    outcome: summarizeEntryOutcome({ entryId: u.entryId, orders, metrics }),
  }));
}

/** default ของ toggle "ตั้งเวลาโพสต์" = แบบที่ผู้ใช้ทำบ่อยกว่า */
export async function getDefaultScheduled(): Promise<boolean> {
  const [posted, scheduled] = await Promise.all([
    prisma.promptEntry.count({ where: { NOT: { videoUrl: "" } } }),
    prisma.promptEntry.count({
      where: { NOT: { videoUrl: "" }, isScheduledPost: true },
    }),
  ]);
  if (posted === 0) return false;
  return scheduled > posted / 2;
}
```

- [ ] **Step 2: ทำแถบข้างให้ผอม — เขียน `components/history-rail.tsx` ใหม่ทั้งไฟล์**

```tsx
"use client";

import Link from "next/link";
import { Copy, EllipsisVertical, Plus, Trash2 } from "lucide-react";
import { Menu } from "@base-ui/react/menu";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { EntryRow } from "@/lib/entry-rows";

/** "12 ก.ค." ของวันที่ลงคลิป — postedAt เก็บเป็น UTC midnight จึงอ่านด้วย UTC */
function shortDate(postedAt: Date | null) {
  if (!postedAt) return null;
  return new Date(postedAt).toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/**
 * "12 ก.ค." ของวันที่สร้าง — ใช้กับ entry ที่ยังไม่ได้ลงคลิป (postedAt เป็น null)
 *
 * ต้องแยกจาก shortDate เพราะ createdAt เป็น timestamp จริง (อ่านด้วย local getter)
 * ส่วน postedAt เก็บเป็น UTC midnight — ใช้ตัวจัดรูปแบบร่วมกันจะเพี้ยนไป 1 วันสำหรับ
 * entry ที่สร้างก่อน 7 โมงเช้าเวลาไทย
 */
function shortCreatedDate(createdAt: Date) {
  return new Date(createdAt).toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
  });
}

/**
 * แถบข้างของหน้าทำงาน — โชว์เฉพาะรายการล่าสุดเพื่อสลับงานเร็วๆ
 *
 * การค้นหา ตัวกรอง และการจัดกลุ่มย้ายไปหน้ารายการ (/) ทั้งหมดแล้ว เพราะกว้าง 240px
 * ใส่ได้แค่ชื่อกับวันที่ ไม่มีที่ให้ตัวกรองหรือคอลัมน์สถานะ
 */
export function HistoryRail({
  rows,
  selectedId,
  onDuplicate,
  onDelete,
}: {
  rows: EntryRow[];
  selectedId: string | null;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <aside className="flex w-full shrink-0 flex-col gap-3 overflow-hidden bg-ink px-3 py-4 text-paper lg:h-full lg:w-60">
      <Button
        asChild
        className="w-full bg-marigold text-ink shadow-none hover:bg-marigold/90"
      >
        <Link href="/entry/new">
          <Plus className="size-4" />
          สินค้าใหม่
        </Link>
      </Button>

      <p className="px-1 font-mono text-[0.65rem] tracking-widest text-paper/40 uppercase">
        ล่าสุด
      </p>

      <div className="flex flex-1 flex-col gap-1 overflow-y-auto">
        <ul className="flex flex-col gap-1">
          {rows.map((row) => {
            const isActive = selectedId === row.id;
            const date = shortDate(row.postedAt);
            return (
              <li
                key={row.id}
                className={cn(
                  "group flex items-center rounded-md border-l-2 border-transparent text-sm text-paper/80 transition-colors hover:bg-ink-2 hover:text-paper",
                  isActive && "border-marigold bg-ink-2 text-paper"
                )}
              >
                <Link
                  href={`/entry/${row.id}`}
                  className="flex min-w-0 flex-1 items-start gap-2 py-2 pl-2.5 text-left"
                >
                  {row.thumbnailFilename ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/uploads/${row.id}/${row.thumbnailFilename}`}
                      alt=""
                      loading="lazy"
                      className="size-9 shrink-0 rounded border border-paper/10 object-cover"
                    />
                  ) : (
                    <span className="size-9 shrink-0 rounded border border-dashed border-paper/10" />
                  )}

                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="line-clamp-2 leading-tight">{row.productName}</span>
                    <span className="flex items-center gap-1.5 font-mono text-[0.6rem]">
                      {date ? (
                        <span className="text-paper/30">{date}</span>
                      ) : (
                        <span className="text-paper/20">
                          สร้าง {shortCreatedDate(row.createdAt)}
                        </span>
                      )}
                    </span>
                  </span>
                </Link>

                <Menu.Root>
                  <Menu.Trigger
                    aria-label="เมนูรายการ"
                    className="shrink-0 rounded-md px-1.5 py-2 text-paper/30 opacity-0 transition-opacity hover:text-paper focus-visible:opacity-100 group-hover:opacity-100 data-[popup-open]:opacity-100"
                  >
                    <EllipsisVertical className="size-3.5" />
                  </Menu.Trigger>
                  <Menu.Portal>
                    <Menu.Positioner side="bottom" align="end" sideOffset={4} className="z-50">
                      <Menu.Popup className="min-w-32 rounded-md border border-paper/15 bg-ink-2 py-1 text-sm text-paper shadow-lg">
                        <Menu.Item
                          onClick={() => onDuplicate(row.id)}
                          className="flex cursor-pointer items-center gap-2 px-3 py-1.5 outline-none data-[highlighted]:bg-ink"
                        >
                          <Copy className="size-3.5" />
                          ทำซ้ำ
                        </Menu.Item>
                        <Menu.Item
                          onClick={() => onDelete(row.id)}
                          className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-record outline-none data-[highlighted]:bg-ink"
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
          className="mt-1 rounded-md px-2.5 py-2 text-center font-mono text-[0.65rem] tracking-widest text-paper/40 uppercase transition-colors hover:bg-ink-2 hover:text-paper"
        >
          ดูทั้งหมด
        </Link>
      </div>
    </aside>
  );
}
```

**เลข take หายไปจากแถบข้างโดยตั้งใจ** — มันคือตำแหน่งในลิสต์เต็ม ซึ่งแถบข้างไม่มีลิสต์เต็มแล้ว เลข take ยังอยู่บนหัวหน้าจอ (`ClapperHeader`) ของ entry ที่เปิดอยู่

**ตรวจก่อนใช้ `Button asChild`:** เช็กว่า `components/ui/button.tsx` รองรับ prop `asChild` จริง

Run: `grep -n "asChild" components/ui/button.tsx`
Expected: เจอ — ถ้าไม่เจอ ให้ใช้ `<Link>` ธรรมดาแล้วใส่ class ของปุ่มเองแทน (`inline-flex items-center justify-center gap-2 rounded-md ...`) โดยลอกจาก class ที่ `buttonVariants` สร้าง

- [ ] **Step 3: สร้าง `components/entry-workspace.tsx`**

เป็น client component ที่รับข้อมูลสำเร็จรูปจาก server แทนที่จะรับ array ทั้งหมด ให้ย้ายตรรกะจาก `components/prompt-workspace.tsx` มาโดยเปลี่ยนตามนี้:

**ย้ายมาทั้งดุ้น (ไม่แก้):** `emptyForm`, `entryToForm`, `uploadImagesTo`, `handleAddImages`, `handleRemovePending`, `updatePendingCaption`, `updateField`, `handleExtracted`, `output` useMemo, `handleCopy`, `handleGenerate`, และ type `ProductImageRecord` / `PromptEntry` / `FormState` ที่เกี่ยวข้อง

**เปลี่ยน:**

```tsx
"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// ... imports เดิมที่ยังใช้ ...
import type { EntryRow } from "@/lib/entry-rows";
import type { UsedAngleWithOutcome } from "@/components/angle-panel";

export function EntryWorkspace({
  entry,
  rows,
  takeNumber,
  usedAngles,
  defaultScheduled,
}: {
  entry: PromptEntry | null;
  rows: EntryRow[];
  takeNumber: number;
  usedAngles: UsedAngleWithOutcome[];
  defaultScheduled: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<WorkspaceTab>("brief");
  const [form, setForm] = useState<FormState>(entry ? entryToForm(entry) : emptyForm);
  // ... state อื่นเหมือนเดิม ยกเว้น selectedId และ railResetKey ที่ไม่มีแล้ว ...
```

**`selectedId` หายไป** — แทนที่ด้วย `entry?.id ?? null` ทุกที่ที่เคยใช้
**`railResetKey` หายไป** — แถบข้างไม่มี state ให้รีเซ็ตแล้ว
**`selectedEntry` หายไป** — คือ `entry` ที่รับมาเป็น prop ตรงๆ
**`prompts` หายไป** — ทุกที่ที่เคยใช้ ให้ดูตารางด้านล่าง

| เดิมใช้ `prompts` ทำอะไร | ตอนนี้ |
|---|---|
| `selectedEntry = prompts.find(...)` | prop `entry` |
| `takeNumber` | prop `takeNumber` |
| `defaultScheduled` useMemo | prop `defaultScheduled` |
| `usedAngles` useMemo | prop `usedAngles` |
| `dashboardEntries` useMemo | ลบทิ้ง (ย้ายไป `/dashboard` แล้วใน Task 2) |
| `handleDuplicate` หา source จาก `prompts` | ไม่ต้องหา — `duplicatePrompt` คืน id ใหม่แล้ว `router.push` ไปเลย |

**handler ที่เปลี่ยนเป็นการเปลี่ยนหน้า:**

```tsx
  const [, createAction, isCreating] = useActionState(
    async (_prevState: { ok: boolean } | null, formData: FormData) => {
      const id = await createPrompt(formData);
      if (pendingImages.length > 0) {
        await uploadImagesTo(id, pendingImages);
        setPendingImages([]);
      }
      router.push(`/entry/${id}`);
      return { ok: true };
    },
    null
  );

  function handleDelete(id: string) {
    if (!confirm("ลบรายการนี้?")) return;
    startDeleteTransition(async () => {
      await deletePrompt(id);
      // ลบตัวที่เปิดอยู่แล้วต้องออกจากหน้านี้ ไม่งั้นจะค้างอยู่กับ entry ที่ไม่มีแล้ว
      if (entry?.id === id) router.push("/");
      else router.refresh();
    });
  }

  function handleDuplicate(id: string) {
    startDuplicateTransition(async () => {
      const newId = await duplicatePrompt(id);
      router.push(`/entry/${newId}`);
    });
  }
```

**`handleGenerate` ยังใช้ `setTab("production")` เหมือนเดิม** เพราะ Brief/ผลลัพธ์ ยังเป็นแท็บใน route เดียวกัน

**การเรนเดอร์:** ลอกจาก `prompt-workspace.tsx` เดิม แต่:
- `<HistoryRail>` ส่ง props ใหม่: `rows={rows} selectedId={entry?.id ?? null} onDuplicate={handleDuplicate} onDelete={handleDelete}` (ไม่มี `onSelect` / `onNew` / `key` แล้ว)
- `<ClapperHeader sceneName={form.productName} takeNumber={takeNumber}>` เหมือนเดิม แต่ข้างในใส่ `<WorkspaceTabs active={tab} onChange={setTab} productionDisabled={entry === null} />`
- เหลือแค่บล็อก `{tab === "brief" && ...}` กับ `{tab === "production" && entry && ...}`
- `<ProductionPanel key={entry.id} entry={entry} defaultScheduled={defaultScheduled} />`
- ใน `<BriefForm>` เปลี่ยน `angleEntryId={selectedId}` เป็น `angleEntryId={entry?.id ?? null}` · `angleValue={entry?.angle ?? ""}` · `hasSelectedEntry={entry !== null}` · `productImages={entry?.productImages ?? []}`
- `<ProductSpecPanel>` แสดงเมื่อ `entry !== null` โดยส่ง `entryId={entry.id}`

**ต้องเพิ่มลิงก์กลับหน้ารายการบนหัว** — ใส่ `<Link href="/">` รอบโลโก้ใน `ClapperHeader` หรือเพิ่มลิงก์ในแถบข้าง (Step 2 ใส่ "ดูทั้งหมด" ไว้แล้ว) เลือกอย่างใดอย่างหนึ่งพอ

- [ ] **Step 4: สร้าง `app/entry/[id]/page.tsx`**

```tsx
import { notFound } from "next/navigation";

import {
  getDefaultScheduled,
  getEntryDetail,
  getEntryRows,
  getUsedAngles,
} from "@/lib/entry-queries";
import { EntryWorkspace } from "@/components/entry-workspace";

const RAIL_LIMIT = 15;

export default async function EntryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [entry, rows, usedAngles, defaultScheduled] = await Promise.all([
    getEntryDetail(id),
    getEntryRows(),
    getUsedAngles(id),
    getDefaultScheduled(),
  ]);

  if (entry === null) notFound();

  const index = rows.findIndex((r) => r.id === id);
  const takeNumber = index >= 0 ? rows.length - index : rows.length + 1;

  // 15 อันแรกตามลำดับของแถบข้าง (ยังไม่ลงคลิปบนสุด แล้วใหม่ไปเก่า) บวกตัวที่เปิดอยู่
  // ถ้ามันไม่ติด 15 อันแรก — ไม่งั้นผู้ใช้จะไม่เห็นว่าตัวเองอยู่ตรงไหน
  const recent = rows.slice(0, RAIL_LIMIT);
  const railRows =
    index >= 0 && index >= RAIL_LIMIT ? [...recent, rows[index]] : recent;

  return (
    <EntryWorkspace
      entry={entry}
      rows={railRows}
      takeNumber={takeNumber}
      usedAngles={usedAngles}
      defaultScheduled={defaultScheduled}
    />
  );
}
```

- [ ] **Step 5: สร้าง `app/entry/new/page.tsx`**

```tsx
import { getDefaultScheduled, getEntryRows } from "@/lib/entry-queries";
import { EntryWorkspace } from "@/components/entry-workspace";

const RAIL_LIMIT = 15;

export default async function NewEntryPage() {
  const [rows, defaultScheduled] = await Promise.all([
    getEntryRows(),
    getDefaultScheduled(),
  ]);

  return (
    <EntryWorkspace
      entry={null}
      rows={rows.slice(0, RAIL_LIMIT)}
      takeNumber={rows.length + 1}
      usedAngles={[]}
      defaultScheduled={defaultScheduled}
    />
  );
}
```

- [ ] **Step 6: ตรวจ type และ lint**

Run: `npx tsc --noEmit`
Expected: ไม่มี error — `app/page.tsx` ยังชี้ไปที่ `PromptWorkspace` เดิมซึ่งยังใช้ `HistoryRail` ที่เพิ่งเปลี่ยน props **จะพังตรงนี้แน่นอน** ให้แก้ `prompt-workspace.tsx` ชั่วคราวให้ส่ง props ใหม่ (แปลง `prompts` เป็น `EntryRow` ด้วย `.map()` ในไฟล์นั้น) — Task 4 จะลบทั้งไฟล์ทิ้งอยู่แล้ว

Run: `npm run lint`
Expected: ไม่มี error

- [ ] **Step 7: ทดสอบ UI จริง**

```bash
cp dev.db dev-test.db
NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001
```

ตรวจ (หา id จริงจาก `dev-test.db` ก่อน):
- `http://localhost:3001/entry/<id>` — ฟอร์ม Brief มีข้อมูลของ entry นั้นครบ · แผงสเปกสินค้ามีค่า · แท็บ ② เปิดได้และมีข้อมูล
- **เลข take บนหัวตรงกับที่หน้าเดิม (`/`) แสดงสำหรับ entry เดียวกัน** — เทียบสองหน้าเทียบกันตรงๆ ถ้าไม่ตรงคือสูตรผิด
- แถบข้างโชว์ 15 รายการ ไม่มีช่องค้นหา ไม่มีปุ่มกรอง ไม่มีหัวข้อเดือน
- **กดรายการในแถบข้าง** — เปลี่ยนไป `/entry/<อีก id>` และข้อมูลเปลี่ยนตาม
- **เปิด entry ที่เก่ามาก (ไม่ติด 15 อันแรก)** — ต้องเห็นตัวเองอยู่ในแถบข้างและถูกไฮไลต์
- `/entry/new` — ฟอร์มว่าง · แท็บ ② กดไม่ได้ · แปะรูปแล้วรอไว้ได้ · กดบันทึกแล้วเด้งไป `/entry/<id ใหม่>` พร้อมรูปที่แปะไว้
- **ทำซ้ำ** จากเมนู kebab — เด้งไป entry ใหม่ที่ angle ว่าง แต่ productSpec ถูกก๊อปมา
- **ลบ** entry ที่เปิดอยู่ — เด้งไป `/` (ยังเป็นหน้าเดิมอยู่) · ลบ entry อื่นจากเมนู — อยู่หน้าเดิมแต่แถบข้างอัปเดต
- **สร้างด้วย AI** — ยังทำงาน และเด้งไปแท็บ ② เมื่อเสร็จ
- แผง angle แสดง angle ที่เคยใช้ของสินค้าเดียวกัน (ทดสอบกับ entry ที่มีสายเลือด — หาได้จาก `duplicatedFromId` ที่ไม่ null)
- ไม่มี console error / hydration warning

ปิด server แล้ว cleanup: `rm -rf .next-dev dev-test.db`

- [ ] **Step 8: Commit**

```bash
git diff tsconfig.json   # ต้องว่าง
git add lib/entry-queries.ts app/entry components/entry-workspace.tsx \
        components/history-rail.tsx components/prompt-workspace.tsx
git commit -F - <<'EOF'
Give each entry its own route

Working on an entry meant holding every other entry in memory: the rail took
the full list, the angle panel walked it for lineage, and the scheduled-post
default counted it. The page now loads the one entry it is editing, and the
server hands down the three things that needed the whole list as finished
values.

The rail keeps only what a 240px column can do well - switching between
recent work. Search and filtering move to the list page.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 4: หน้ารายการที่ `/`

**Files:**
- Create: `components/entry-list.tsx`
- Modify: `app/page.tsx`
- Delete: `components/prompt-workspace.tsx`

**Interfaces:**
- Consumes จาก Task 1: `searchAndFilter`, `paginate`, `parseStatusParam`, `parsePageParam`, `type EntryRow`, `type EntryStatus`, `PER_PAGE`
- Consumes จาก Task 2: `getEntryRows` · `AppHeader`
- Produces: ไม่มี (จุดสิ้นสุด)

**บริบทที่ต้องรู้:**

หน้านี้ต้องอ่านข้อความเพื่อค้นหา แต่ห้ามส่งข้อความลง client — จึงคิวรีข้อความแยกต่างหาก **เฉพาะตอนที่มีคำค้น** แล้วรวมกับแถวเบาเพื่อกรอง สุดท้ายส่งลง client แค่ 30 แถวที่เป็นแถวเบาล้วน

ตัวกรองทั้งหมดอยู่ใน URL ไม่ใช่ React state — `searchParams` ในเวอร์ชันนี้เป็น `Promise` ต้อง `await`

ช่องค้นหาต้องเป็น form ที่ submit ไปที่ `/` แบบ GET เพื่อให้ค่าไปอยู่ใน URL โดยไม่ต้องเขียน JS จัดการเอง

- [ ] **Step 1: เพิ่มคิวรีข้อความสำหรับค้นหาใน `lib/entry-queries.ts`**

```ts
/**
 * ข้อความที่ใช้ค้นหา — คิวรีแยกและเรียกเฉพาะตอนมีคำค้นจริงเท่านั้น
 *
 * productInfo หนักราว 2 KB/แถว (~3.6 MB ที่ 1,800 แถว) แต่อยู่ในหน่วยความจำ server
 * เท่านั้น ไม่ได้ถูกส่งลง client — client ได้แค่ 30 แถวเบาของหน้านั้น
 * ถ้าวันหนึ่งช้าเกินไป ทางแก้คือ SQLite FTS5 ไม่ใช่การเปลี่ยนดีไซน์
 */
export async function getSearchText(): Promise<
  Map<string, { productName: string; productInfo: string; extraNotes: string }>
> {
  const rows = await prisma.promptEntry.findMany({
    select: { id: true, productName: true, productInfo: true, extraNotes: true },
  });
  return new Map(
    rows.map((r) => [
      r.id,
      {
        productName: r.productName,
        productInfo: r.productInfo,
        extraNotes: r.extraNotes,
      },
    ])
  );
}
```

- [ ] **Step 2: เขียน `app/page.tsx` ใหม่ทั้งไฟล์**

```tsx
import { getEntryRows, getSearchText } from "@/lib/entry-queries";
import {
  paginate,
  parsePageParam,
  parseStatusParam,
  searchAndFilter,
} from "@/lib/entry-rows";
import { AppHeader } from "@/components/app-header";
import { EntryList } from "@/components/entry-list";

export default async function EntryListPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const query = (Array.isArray(sp.q) ? sp.q[0] : sp.q) ?? "";
  const status = parseStatusParam(sp.status);
  const page = parsePageParam(sp.page);

  const rows = await getEntryRows();

  // อ่านข้อความเฉพาะตอนที่ต้องค้นจริง — ไม่มีคำค้นก็ไม่ต้องแตะ productInfo เลย
  const searchText = query.trim() === "" ? null : await getSearchText();
  const searchable = rows.map((r) => ({
    ...r,
    productName: r.productName,
    productInfo: searchText?.get(r.id)?.productInfo ?? "",
    extraNotes: searchText?.get(r.id)?.extraNotes ?? "",
  }));

  const filtered = searchAndFilter(searchable, { query, status });
  const { items, totalPages, page: safePage } = paginate(filtered, page);

  return (
    <div className="flex min-h-screen flex-1 flex-col lg:h-screen lg:overflow-hidden">
      <AppHeader active="list" />
      <div className="flex flex-1 flex-col p-4 sm:p-6 lg:overflow-y-auto">
        <EntryList
          rows={items.map((r) => ({
            id: r.id,
            productName: r.productName,
            angle: r.angle,
            videoUrl: r.videoUrl,
            postedAt: r.postedAt,
            createdAt: r.createdAt,
            duplicatedFromId: r.duplicatedFromId,
            status: r.status,
            thumbnailFilename: r.thumbnailFilename,
            postedTimeOfDay: r.postedTimeOfDay,
            postedTimeSource: r.postedTimeSource,
            isScheduledPost: r.isScheduledPost,
          }))}
          query={query}
          status={status}
          page={safePage}
          totalPages={totalPages}
          matchCount={filtered.length}
          total={rows.length}
        />
      </div>
    </div>
  );
}
```

**สังเกต:** `items.map()` ตรงนี้ตัด `productInfo`/`extraNotes` ที่เติมเข้าไปเพื่อค้นหาออกก่อนส่งลง client — **ห้ามส่ง `...r` ตรงๆ** ไม่งั้นข้อความ 2 KB/แถวจะติดไปด้วย

- [ ] **Step 3: เขียน `components/entry-list.tsx`**

**เช็กชื่อไอคอนก่อน:**

Run: `grep -o 'export {[^}]*' node_modules/lucide-react/dist/esm/icons/search.mjs node_modules/lucide-react/dist/esm/icons/plus.mjs`
Expected: `Search as default` และ `Plus as default`

```tsx
import Link from "next/link";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { EntryRow, EntryStatus } from "@/lib/entry-rows";
import { Plus, Search } from "lucide-react";

const STATUS_LABEL: Record<EntryStatus, string> = {
  "no-prompt": "ยังไม่มี prompt",
  "awaiting-clip": "รอลงคลิป",
  posted: "ลงแล้ว",
};

const STATUS_STYLE: Record<EntryStatus, string> = {
  "no-prompt": "border-record/40 text-record",
  "awaiting-clip": "border-marigold/40 text-marigold",
  posted: "border-border text-muted-foreground",
};

const FILTERS: { value: EntryStatus | "all"; label: string }[] = [
  { value: "all", label: "ทั้งหมด" },
  { value: "no-prompt", label: "ยังไม่มี prompt" },
  { value: "awaiting-clip", label: "รอลงคลิป" },
  { value: "posted", label: "ลงแล้ว" },
];

/** "12 ก.ค. 2026" — postedAt เก็บเป็น UTC midnight จึงอ่านด้วย UTC */
function postedLabel(postedAt: Date | null) {
  if (!postedAt) return null;
  return new Date(postedAt).toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** createdAt เป็น timestamp จริง อ่านด้วย local getter — ห้ามใช้ตัวเดียวกับ postedLabel */
function createdLabel(createdAt: Date) {
  return new Date(createdAt).toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function buildHref(params: {
  query: string;
  status: EntryStatus | "all";
  page: number;
}) {
  const sp = new URLSearchParams();
  if (params.query.trim() !== "") sp.set("q", params.query);
  if (params.status !== "all") sp.set("status", params.status);
  if (params.page > 1) sp.set("page", String(params.page));
  const qs = sp.toString();
  return qs === "" ? "/" : `/?${qs}`;
}

export function EntryList({
  rows,
  query,
  status,
  page,
  totalPages,
  matchCount,
  total,
}: {
  rows: EntryRow[];
  query: string;
  status: EntryStatus | "all";
  page: number;
  totalPages: number;
  matchCount: number;
  total: number;
}) {
  const isFiltering = query.trim() !== "" || status !== "all";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <form method="get" action="/" className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              name="q"
              defaultValue={query}
              placeholder="ค้นหาสินค้า"
              aria-label="ค้นหาสินค้า"
              className="w-64 pl-8"
            />
          </div>
          {status !== "all" && <input type="hidden" name="status" value={status} />}
          <Button type="submit" variant="secondary">
            ค้นหา
          </Button>
        </form>

        <Button asChild>
          <Link href="/entry/new">
            <Plus className="size-4" />
            สินค้าใหม่
          </Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {FILTERS.map((f) => (
          <Link
            key={f.value}
            href={buildHref({ query, status: f.value, page: 1 })}
            aria-current={status === f.value ? "page" : undefined}
            className={cn(
              "rounded-md px-2.5 py-1.5 font-mono text-[0.65rem] tracking-widest uppercase transition-colors",
              status === f.value
                ? "bg-marigold text-ink"
                : "text-muted-foreground hover:bg-card hover:text-foreground"
            )}
          >
            {f.label}
          </Link>
        ))}
      </div>

      <p className="font-mono text-[0.65rem] tracking-widest text-muted-foreground uppercase">
        {isFiltering ? `พบ ${matchCount} จาก ${total}` : `ทั้งหมด ${total} รายการ`}
      </p>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          {total === 0
            ? "ยังไม่มีรายการ"
            : "ไม่พบรายการ — ลองใช้คำที่สั้นลงหรือน้อยคำลง"}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => {
            const posted = postedLabel(row.postedAt);
            return (
              <li key={row.id}>
                <Link
                  href={`/entry/${row.id}`}
                  className="flex items-start gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:border-marigold/50"
                >
                  {row.thumbnailFilename ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/uploads/${row.id}/${row.thumbnailFilename}`}
                      alt=""
                      loading="lazy"
                      className="size-14 shrink-0 rounded border border-border object-cover"
                    />
                  ) : (
                    <span className="size-14 shrink-0 rounded border border-dashed border-border" />
                  )}

                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <p className="text-sm leading-snug font-medium">{row.productName}</p>
                    {row.angle !== "" && (
                      <p className="line-clamp-1 text-xs text-muted-foreground">
                        angle: {row.angle}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 font-mono text-[0.6rem] tracking-wide",
                        STATUS_STYLE[row.status]
                      )}
                    >
                      {STATUS_LABEL[row.status]}
                    </span>
                    <span className="font-mono text-[0.6rem] text-muted-foreground">
                      {posted ?? `สร้าง ${createdLabel(row.createdAt)}`}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {totalPages > 1 && (
        <nav className="flex items-center justify-center gap-2" aria-label="แบ่งหน้า">
          {page > 1 && (
            <Link
              href={buildHref({ query, status, page: page - 1 })}
              className="rounded-md border border-border px-3 py-1.5 font-mono text-xs transition-colors hover:bg-card"
            >
              ก่อนหน้า
            </Link>
          )}
          <span className="font-mono text-xs text-muted-foreground">
            หน้า {page} จาก {totalPages}
          </span>
          {page < totalPages && (
            <Link
              href={buildHref({ query, status, page: page + 1 })}
              className="rounded-md border border-border px-3 py-1.5 font-mono text-xs transition-colors hover:bg-card"
            >
              ถัดไป
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
```

**ตรวจก่อนใช้ `Button variant="secondary"`:**

Run: `grep -n "secondary" components/ui/button.tsx`
Expected: เจอใน `buttonVariants` — ถ้าไม่มี ให้ใช้ variant ที่มีจริงแทน

- [ ] **Step 4: ลบ `components/prompt-workspace.tsx`**

ไฟล์นี้ไม่มีใครใช้แล้ว แต่ **type `PromptEntry` กับ `ProductImageRecord` ที่ export จากมันถูก import ที่อื่นหลายที่** — ย้ายสองตัวนี้ไปไว้ที่ `components/entry-workspace.tsx` แล้วแก้ import ทุกจุด

Run: `grep -rn "from \"@/components/prompt-workspace\"" --include=*.tsx --include=*.ts .`
Expected: เห็นทุกไฟล์ที่ยัง import อยู่ — แก้ให้ชี้ไป `@/components/entry-workspace` ทั้งหมดก่อนลบ

```bash
git rm components/prompt-workspace.tsx
```

- [ ] **Step 5: ตรวจ type และ lint**

Run: `npx tsc --noEmit`
Expected: ไม่มี error

Run: `npm run lint`
Expected: ไม่มี error

- [ ] **Step 6: ทดสอบ UI จริง**

```bash
cp dev.db dev-test.db
NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001
```

ตรวจ:
- `http://localhost:3001/` — เห็นรายการ 30 แถว มีรูป ชื่อเต็ม สถานะ วันที่ · หัวข้อบอก "ทั้งหมด N รายการ"
- **ชื่อยาว 125 ตัวอักษรแสดงได้เต็ม** (entry "【พร้อมส่ง】 BMZAR เคาเตอร์ครัว...") — นี่คือสิ่งที่แถบข้างทำไม่ได้
- **กดตัวกรองสถานะ** — URL เปลี่ยนเป็น `/?status=...` ผลกรองถูกต้อง จำนวนตรงกับที่ `verify-rows.js` นับไว้
- **ค้นหา "ที่นอน แมว"** (เว้นวรรค) — เจอผลลัพธ์ URL กลายเป็น `/?q=...` และผลที่ตรงชื่ออยู่บนสุด
- **ค้นหาพร้อมกรองสถานะ** — ทั้งสองเงื่อนไขทำงานร่วมกัน และตัวกรองไม่หายเมื่อ submit ค้นหา
- **แบ่งหน้า** — กดถัดไป/ก่อนหน้า URL มี `page=` และของไม่ซ้ำไม่ตกหล่น
- **กด back ของเบราว์เซอร์** — กลับไปสถานะกรอง/ค้นหาก่อนหน้าได้จริง
- **รีเฟรชหน้าที่กรองอยู่** — ตัวกรองยังอยู่
- **แก้ URL เป็น `?page=999` หรือ `?status=มั่ว`** — ไม่พัง ดึงกลับเป็นค่าที่ถูกต้อง
- **กดการ์ดในรายการ** — ไปที่ `/entry/<id>` ถูกตัว
- ปุ่ม "สินค้าใหม่" ไปที่ `/entry/new`
- เมนูบนหัวสลับไป `/dashboard` และ `/core-prompt` ได้
- ไม่มี console error / hydration warning

ปิด server แล้ว cleanup: `rm -rf .next-dev dev-test.db`

- [ ] **Step 7: Commit**

```bash
git diff tsconfig.json   # ต้องว่าง
git add app/page.tsx components/entry-list.tsx lib/entry-queries.ts
git add -u components/prompt-workspace.tsx
git commit -F - <<'EOF'
Replace the home page with a list that can hold a thousand entries

A 240px rail could show about fifteen characters of a name and had nowhere
to put a filter. A full page shows the whole name, the status, and the angle,
and pages through the archive thirty rows at a time.

Filters live in the URL, so back, refresh, and sharing a filtered view all
work. Product text is read only when there is something to search for, and
never leaves the server.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 5: `revalidatePath` ทั้ง 20 จุด + ยืนยันปลายทาง

**Files:**
- Modify: `app/actions.ts`

**Interfaces:**
- Consumes: ไม่มี
- Produces: ไม่มี

**บริบทที่ต้องรู้:**

ทั้ง 20 จุดเขียนไว้ตอนแอปมีหน้าเดียว `revalidatePath("/")` จึงครอบทุกอย่าง ตอนนี้มันครอบแค่หน้ารายการ

เอกสารของ Next เวอร์ชันนี้ (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidatePath.md`) ระบุ:
- path จริง เช่น `revalidatePath("/entry/abc123")` — revalidate หน้าเดียว **ห้ามใส่ `type`**
- route pattern เช่น `revalidatePath("/entry/[id]", "page")` — revalidate ทุกหน้าที่ match **ต้องใส่ `type`**

เอกสารยังระบุว่าปัจจุบัน Next ยัง refresh หน้าที่เคยเข้าไปแล้วให้ด้วยเมื่อกลับไปเยี่ยม แต่เป็นพฤติกรรมชั่วคราวที่จะเปลี่ยน **ห้ามพึ่งพฤติกรรมนี้ ต้องระบุ path ให้ถูกทุกจุด**

`updateProductImageCaption` ตอนนี้ไม่รู้ `entryId` — `prisma.productImage.update()` คืนแถวที่อัปเดตมาให้ ใช้ `image.entryId` จากค่าที่คืนมาได้เลย ส่วน `deleteProductImage` มี `image.entryId` อยู่แล้วจาก `findUnique` ด้านบน

- [ ] **Step 1: แก้ทั้ง 20 จุดตามตารางนี้**

| บรรทัด | ฟังก์ชัน | เปลี่ยนเป็น |
|---|---|---|
| 57 | `createPrompt` | `revalidatePath("/")` (คงเดิม — หน้า entry ใหม่ยังไม่เคยถูก render) |
| 121 | `duplicatePrompt` | `revalidatePath("/")` (คงเดิม เหตุผลเดียวกัน) |
| 127 | `deletePrompt` | `revalidatePath("/")` + `revalidatePath("/dashboard")` |
| 197 | `updateProduction` | `revalidatePath(\`/entry/${entryId}\`)` + `revalidatePath("/")` + `revalidatePath("/dashboard")` |
| 231 | `createCorePrompt` | `revalidatePath("/core-prompt")` |
| 251 | `setActiveCorePrompt` | `revalidatePath("/core-prompt")` |
| 318 | `uploadProductImages` | `revalidatePath(\`/entry/${entryId}\`)` + `revalidatePath("/")` |
| 326 | `updateProductImageCaption` | `revalidatePath(\`/entry/${image.entryId}\`)` |
| 339 | `saveAngle` | `revalidatePath(\`/entry/${entryId}\`)` + `revalidatePath("/")` |
| 352 | `saveProductSpec` | `revalidatePath(\`/entry/${entryId}\`)` |
| 387 | `refreshProductSpec` | `revalidatePath(\`/entry/${entryId}\`)` |
| 572 | `generateWithAI` | `revalidatePath(\`/entry/${entryId}\`)` + `revalidatePath("/")` |
| 649 | `importAffiliateOrders` | `revalidatePath("/dashboard")` |
| 750 | `importClipMetrics` | `revalidatePath("/dashboard")` |
| 788 | `importFollowerActivity` | `revalidatePath("/dashboard")` |
| 808 | `deleteProductImage` | `revalidatePath(\`/entry/${image.entryId}\`)` + `revalidatePath("/")` |
| 888 | `createEntryFromOrder` | `revalidatePath("/")` + `revalidatePath("/dashboard")` |

**เหตุผลของแต่ละกลุ่ม:**
- ใส่ `/` ด้วยเมื่อ action เปลี่ยนสิ่งที่หน้ารายการแสดง: ชื่อสินค้า · สถานะ (`chatgptOutput`/`videoUrl`) · angle · รูปแรก
- ใส่ `/dashboard` ด้วยเมื่อเปลี่ยนสิ่งที่ dashboard นับ: `postedAt` · `videoUrl` · จำนวน entry · ออเดอร์/metrics
- `saveProductSpec` / `refreshProductSpec` / `updateProductImageCaption` ไม่แตะสิ่งที่หน้ารายการแสดง จึงไม่ต้องใส่ `/`

**`updateProductImageCaption` ต้องแก้ให้เก็บผลลัพธ์ก่อน:**

```ts
export async function updateProductImageCaption(id: string, caption: string) {
  const image = await prisma.productImage.update({
    where: { id },
    data: { caption: caption.trim() },
  });
  revalidatePath(`/entry/${image.entryId}`);
}
```

- [ ] **Step 2: ยืนยันว่าไม่มี `revalidatePath("/")` ตกค้างในจุดที่ควรเป็นอย่างอื่น**

Run: `grep -n "revalidatePath" app/actions.ts`
Expected: จำนวนบรรทัดมากกว่า 20 (เพราะบางฟังก์ชันเรียกหลายครั้ง) และไม่มีฟังก์ชันไหนในตารางข้างบนที่ยังเหลือ `revalidatePath("/")` เดี่ยวๆ ทั้งที่ตารางบอกว่าต้องมีมากกว่านั้น

- [ ] **Step 3: ตรวจ type และ lint**

Run: `npx tsc --noEmit`
Expected: ไม่มี error

Run: `npm run lint`
Expected: ไม่มี error

- [ ] **Step 4: ทดสอบว่าทุก mutation เห็นผลทันที**

```bash
cp dev.db dev-test.db
NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001
```

แต่ละข้อคือ "ทำแล้วต้องเห็นผลโดยไม่ต้องรีเฟรชเอง":
- **แก้ angle** ในหน้า entry แล้วกลับไป `/` — คอลัมน์ angle เปลี่ยนตาม
- **วางลิงก์คลิป** ในแท็บ ② แล้วกลับไป `/` — สถานะเปลี่ยนจาก "รอลงคลิป" เป็น "ลงแล้ว"
- **สร้างด้วย AI** จาก entry ที่ยังไม่มี prompt แล้วกลับไป `/` — สถานะเปลี่ยนจาก "ยังไม่มี prompt" เป็น "รอลงคลิป"
- **อัปโหลดรูป** แล้วกลับไป `/` — รูป thumbnail โผล่ในรายการ
- **ลบรูป** แล้วกลับไป `/` — thumbnail เปลี่ยนหรือกลายเป็นกรอบว่าง
- **แก้ caption รูป** แล้วกลับมาที่ entry เดิม — caption ยังอยู่
- **แก้สเปกสินค้า** แล้วกลับมาที่ entry เดิม — สเปกยังอยู่
- **สร้างสินค้าใหม่** — โผล่ใน `/` และในแถบข้าง
- **ทำซ้ำ** — entry ใหม่โผล่ใน `/`
- **ลบ entry** — หายจาก `/`
- **เพิ่มเวอร์ชัน Core Prompt / ตั้ง active** ที่ `/core-prompt` — เห็นผลทันที
- **นำเข้าไฟล์ออเดอร์** ที่ `/dashboard` — ตัวเลขอัปเดต (ใช้ไฟล์ตัวอย่างที่ผู้ใช้มีอยู่ ถ้าไม่มีให้ข้ามข้อนี้แล้วระบุในรายงาน)
- ไม่มี console error / hydration warning

ปิด server แล้ว cleanup: `rm -rf .next-dev dev-test.db`

- [ ] **Step 5: ยืนยันขนาด payload ว่าลดลงจริง**

เขียนไฟล์ `<scratch>/payload-after.js` วัดขนาดของสิ่งที่หน้ารายการจะส่งลง client เทียบกับของเดิม:

```js
const D = require("<REPO>/node_modules/better-sqlite3");
const db = new D("<REPO>/dev.db", { readonly: true });

const all = db.prepare(`SELECT * FROM PromptEntry`).all();
const before = Buffer.byteLength(JSON.stringify(all), "utf8");

// แถวเบา 30 แถวแบบที่หน้ารายการส่งจริง
const light = db.prepare(`
  SELECT id, productName, angle, videoUrl, postedAt, createdAt, duplicatedFromId
  FROM PromptEntry LIMIT 30
`).all();
const after = Buffer.byteLength(JSON.stringify(light), "utf8");

console.log(`เดิม (ทุกแถวเต็ม): ${(before / 1024).toFixed(0)} KB สำหรับ ${all.length} แถว`);
console.log(`ใหม่ (30 แถวเบา):  ${(after / 1024).toFixed(1)} KB`);
console.log(`ต่อแถว: เดิม ${(before / all.length / 1024).toFixed(1)} KB -> ใหม่ ${(after / light.length / 1024).toFixed(2)} KB`);
console.log(`\nที่ 1,800 แถว: เดิม ${((before / all.length) * 1800 / 1024 / 1024).toFixed(1)} MB -> ใหม่ ${(after / 1024).toFixed(1)} KB (คงที่ ไม่โตตามจำนวนแถว)`);
```

Run: `node "<scratch>/payload-after.js"`
Expected: ต่อแถวลดลงอย่างน้อย 5 เท่า และตัวเลขของหน้าใหม่**ไม่ขึ้นกับจำนวนแถวทั้งหมด** — นี่คือเกณฑ์ข้อ 1 ในสเปก

- [ ] **Step 6: Commit**

```bash
git diff tsconfig.json   # ต้องว่าง
git add app/actions.ts
git commit -F - <<'EOF'
Point each action at the pages it actually changes

Every action called revalidatePath("/") because there was only one page.
That now refreshes the list and nothing else, so saving an angle or pasting
a clip link would leave the entry page showing stale data.

Each action now names the entry page it touched, plus the list when it
changes something the list displays and the dashboard when it changes
something the dashboard counts.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Self-Review

**ความครอบคลุมของ spec:**

| ข้อกำหนดใน spec | Task ที่ทำ |
|---|---|
| §4 route `/` | Task 4 |
| §4 route `/entry/[id]` · `/entry/new` | Task 3 |
| §4 route `/dashboard` · `/core-prompt` | Task 2 |
| §4 แท็บกลายเป็นลิงก์ | Task 2 (`AppHeader`) + Task 2 Step 7 (แท็บ entry เหลือ 2) |
| §4 หน้าทำงานไม่โหลด core prompt | Task 3 (ไม่มี corePrompts ใน props เลย) |
| §4.1 นิยามแถวเบา + ห้ามมีฟิลด์หนัก | Task 1 (`EntryRow` + คอมเมนต์) + Task 2 (`ROW_SELECT`) |
| §4.1 `hasOutput` เป็น boolean คำนวณฝั่ง server | Task 2 Step 1 (คิวรี id set) |
| §5.1 คอลัมน์ + สถานะ 3 ค่า | Task 1 (`entryStatus`) + Task 4 Step 3 |
| §5.1 ตัวกรองอยู่ใน URL | Task 4 Steps 2-3 (`searchParams` + `buildHref`) |
| §5.1 ใช้ `sortEntriesForRail` เดิม | Task 2 (`getEntryRows`) |
| §5.2 ไม่มีคอลัมน์รายได้ | Task 4 Step 3 (ไม่มี) |
| §5.3 30 แถว/หน้า ทำฝั่ง server | Task 1 (`PER_PAGE`, `paginate`) + Task 4 Step 2 |
| §6.1 แถบข้างเหลือ 15 ล่าสุด + ตัวที่เปิด | Task 3 Steps 2, 4 |
| §6.1 ตัดช่องค้นหา/ตัวกรอง/หัวข้อเดือน | Task 3 Step 2 (เขียนไฟล์ใหม่) |
| §6.1 ลิงก์ "ดูทั้งหมด" | Task 3 Step 2 |
| §6.1 คลิกแล้วเป็น `<Link>` | Task 3 Step 2 |
| §6.2 เลข take เท่าเดิม | Task 3 Step 4 + ทดสอบ Step 7 |
| §6.3 Brief/ผลลัพธ์ ยังเป็นแท็บ | Task 3 Step 3 |
| §7 ค้นหาย้ายไป server ใช้ `entry-search` เดิม | Task 1 (`searchAndFilter`) + Task 4 Steps 1-2 |
| §8 angle/สายเลือดไม่ส่งของหนักลง client | Task 3 Step 1 (`getUsedAngles` ทำฝั่ง server ทั้งหมด) |
| §9 `revalidatePath` 20 จุด | Task 5 |
| §12.1 payload ไม่โตตามจำนวน entry | Task 5 Step 5 (วัดจริง) |
| §12.2 `/dashboard` ไม่โหลดตอนอยู่หน้าอื่น | Task 2 |
| §12.3 ค้นหาให้ผลเท่าเดิม | Task 1 Step 5 (เทียบกับ `matchTier` ตรงๆ) |
| §12.4 เลข take ไม่เปลี่ยน | Task 3 Step 7 |
| §12.5 การเรียงลำดับเหมือนเดิม | Task 2 (`sortEntriesForRail`) + Task 1 Step 5 |
| §12.6 mutation เห็นผลทันที | Task 5 Step 4 |
| §12.7 กดการ์ดคำแนะนำไปถูก entry | Task 2 Step 5 (`DashboardRoute`) + ทดสอบ Task 3 Step 7 |

**จุดที่แผนนี้ตัดสินใจต่างจากสเปก (ดีขึ้น):** สเปก §8 บอกให้ส่งแถวสายเลือดลง client ~180 KB แผนนี้คำนวณ `usedAngles` ฝั่ง server ทั้งหมดแทน จึงไม่ต้องส่งทั้งสายเลือดและ `affiliateOrders`/`clipMetrics` ลง client เลย — ระบุไว้ใน Task 3 บริบทแล้ว

**ความสอดคล้องของชื่อ/ชนิด:** `EntryRow` / `EntryStatus` / `PER_PAGE` / `entryStatus` / `searchAndFilter` / `paginate` / `parseStatusParam` / `parsePageParam` นิยามใน Task 1 ใช้ชื่อเดิมทั้ง Task 2-5 ✓ · `getEntryRows` / `getDashboardData` นิยาม Task 2 ใช้ต่อ Task 3-4 ✓ · `getEntryDetail` / `getUsedAngles` / `getDefaultScheduled` นิยาม Task 3 ใช้ใน Task 3 เอง ✓ · `getSearchText` นิยามและใช้ใน Task 4 ✓ · `AppHeader` + `NavKey` นิยาม Task 2 ใช้ Task 2 และ 4 ✓ · `WorkspaceTab` เหลือ `"brief" | "production"` ใน Task 2 แล้วใช้ใน Task 3 ✓ · props ใหม่ของ `HistoryRail` (`rows`/`selectedId`/`onDuplicate`/`onDelete`) นิยาม Task 3 Step 2 ใช้ Task 3 Step 3 ✓

**ความเสี่ยงที่รู้ตัว:** Task 3 Step 6 ระบุไว้ชัดว่า `tsc` จะพังเพราะ `prompt-workspace.tsx` ยังใช้ `HistoryRail` แบบเก่า และให้แก้ชั่วคราวก่อนที่ Task 4 จะลบทิ้ง — ถ้าไม่เขียนไว้ผู้ทำจะสับสนว่าทำผิด
