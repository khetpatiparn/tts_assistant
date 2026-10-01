# Showcase listing facts + claim check — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Scope cut 2026-10-01 (user decision):** execute **Task 1 and Task 5 only** (claim checker + warnings). Tasks 2, 3, 4, 6 are parked — see the spec status line for the triggers that bring them back. Task 5 consumes only Task 1.

**Goal:** Showcase jobs get a short product name and ban-safe facts read from the shop's gallery images; every clip's voice-over/caption/hashtags get a risky-claim warning before posting.

**Architecture:** Two pure modules (`lib/claim-check.ts`, `lib/listing-facts.ts`) hold all rules and are tested by a node check script. `lib/gemini.ts` gets two flash-lite calls (short name; structured listing items via `response_format` JSON schema). `app/actions.ts` wires them into `startShowcaseProduct` and `generateWithAI` (best-effort, never throws). UI shows warnings from `checkClaims`. No schema migration: results live in existing `PromptEntry.productName` / `productInfo`.

**Tech Stack:** Next.js 16 custom build, Prisma 7 + SQLite, `@google/genai` interactions API (snake_case), TypeScript, node `.mjs` check scripts (no test runner).

**Spec:** `docs/superpowers/specs/2026-10-01-showcase-listing-facts-design.md`

## Global Constraints

- Gemini interactions API is **snake_case**: `system_instruction`, `generation_config`, `response_format` — camelCase is silently ignored. Read `CreateModelInteraction` / `TextResponseFormat_2` in `node_modules/@google/genai/dist/genai.d.ts`; never `as any`.
- Structured output shape: `response_format: { type: "text", mime_type: "application/json", schema: { ...JSON schema... } }`.
- Both new Gemini calls use `EXTRACT_MODEL` (`gemini-3.1-flash-lite`).
- Listing extraction and name shortening must **never throw** to the user: failure = fall back (full title / skip) + `console.error`.
- `lib/claim-check.ts` and `lib/listing-facts.ts` must have **no imports** (client components import them).
- Listing items of kind `risky`, and any item whose text hits a `ban` word, never reach any prompt.
- Diversity rule text (verbatim, appended under the listing-claims block):
  `กติกาการใช้รายการด้านบน: เป็นขอบเขตของข้อเท็จจริงเรื่องตัวสินค้าที่พูดได้ ไม่ใช่บทที่ต้องพูด · ไม่ต้องพูดครบทุกข้อ เลือก 1–2 ข้อที่เข้ากับ angle/use case ของคลิปนี้ หรือไม่พูดเลยก็ได้ · ห้ามลอกถ้อยคำของร้าน ให้เล่าใหม่เป็นภาษาพูดของคนใช้จริง · hook สถานการณ์ อารมณ์ มุมเล่า และ CTA คิดได้อิสระ · ห้ามอ้างคุณสมบัติหรือผลลัพธ์ของสินค้าที่ไม่อยู่ในรายการและมองไม่เห็นจากรูป`
- Placeholder prefix for the full shop title in `productInfo`: `ชื่อเต็มจากร้าน: ` (exact).
- Never touch the real `dev.db` or port 3000; DB experiments use `dev-test.db` (copy `dev.db`, `dev.db-wal`, `dev.db-shm` together). UI smoke on port 3001 with `NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db"`; afterwards kill port 3001 and `git checkout -- tsconfig.json`.
- UI rules (CLAUDE.md): no `text-[...]`, no hex in components, Button/buttonVariants, Thai line-height ≥1.6, no uppercase/tracking on Thai.
- Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Negative Prompt / QA Checklist sections contain banned words as *examples of what not to say* ("ห้ามพูดว่าดีที่สุด") — the checker must not flag them; only voice-over lines, the full voice-over script block, caption and hashtags are checked. (Task 1 test)
2. Gemini returns malformed JSON, an empty list, or `kind` values outside the enum → no crash, no partial garbage written; unknown kinds are dropped. (Task 2 test)
3. A product whose shop images have no readable text (pure photos) → listing items empty → `productInfo` keeps only the full-title line and later "สร้างด้วย AI" doesn't loop re-extracting forever: extraction is attempted once per `generateWithAI` call only while `needsListingExtraction` is true; an empty-but-successful extraction writes a marker so it is not retried. (Task 2 test + Task 4)
4. Duplicated entries (`duplicatePrompt`) and manual-capture entries have no linked `ProductCandidate` → extraction silently skipped, behaviour identical to today. (Task 4 reviewer check)
5. Short name from Gemini that is empty, longer than 60 chars, or contains a newline → fall back to the full title. (Task 2 test via `acceptShortName`)

---

### Task 1: Claim checker (pure) + real-data validation

**Files:**
- Create: `lib/claim-check.ts`
- Create: `scripts/check-claims.mjs`
- Create: `scripts/claim-scan.js` (read-only real-data scan, not part of check:flow)
- Modify: `package.json` (add `check:claims`, append to `check:flow`)

**Interfaces:**
- Produces:
  - `export type ClaimLevel = "ban" | "check";`
  - `export type ClaimHit = { word: string; level: ClaimLevel; where: "voiceover" | "caption" | "hashtags"; snippet: string };`
  - `export const BAN_WORDS: readonly string[]`, `export const CHECK_WORDS: readonly string[]`
  - `export function extractVoiceover(tenPart: string): string` — joined audience-facing voice-over text
  - `export function findClaimWords(text: string): { word: string; level: ClaimLevel; index: number }[]`
  - `export function checkClaims(input: { tenPart: string; caption: string; hashtags: string }): ClaimHit[]`

- [ ] **Step 1: Write the failing test** — `scripts/check-claims.mjs`

```js
/**
 * ตรวจ lib/claim-check.ts (pure) — รัน: node scripts/check-claims.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const out = mkdtempSync(join(process.cwd(), ".check-claims-tmp-"));
let failed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`      ได้ ${a} ควรได้ ${e}`);
}
try {
  execFileSync("npx", ["tsc", "lib/claim-check.ts", "--outDir", out, "--module", "es2022", "--target", "ES2017", "--moduleResolution", "bundler"], { stdio: "inherit", shell: true });
  const c = await import(pathToFileURL(join(out, "claim-check.js")).href);

  const tenPart = [
    "5. **Action Timeline**",
    "**Full voice-over script:**",
    "“ตะขอตัวนี้ดีที่สุดเลย แขวนได้เยอะ”",
    "",
    "**00:00–00:02**",
    "มือคล้องตะขอ",
    "เสียงพากย์: “ทนทานมาก ใช้ได้นาน”",
    "",
    "9. **Negative Prompt**",
    "ห้ามพูดว่าดีที่สุด ห้ามคำว่า 100% ห้ามการันตี",
  ].join("\n");

  const vo = c.extractVoiceover(tenPart);
  check("voice-over รวม script + บรรทัดเสียงพากย์", vo.includes("ดีที่สุดเลย") && vo.includes("ทนทานมาก"), true);
  check("voice-over ไม่รวม Negative Prompt", vo.includes("ห้ามคำว่า 100%"), false);

  const hits = c.checkClaims({ tenPart, caption: "ของแท้ 100% ปลอดภัย", hashtags: "#ขายดี #ตะขอ" });
  check("เจอ ดีที่สุด (ban) ในเสียงพากย์", hits.some((h) => h.word === "ดีที่สุด" && h.level === "ban" && h.where === "voiceover"), true);
  check("เจอ ทนทาน (check) ในเสียงพากย์", hits.some((h) => h.word === "ทนทาน" && h.level === "check" && h.where === "voiceover"), true);
  check("ไม่จับ 100% จาก Negative Prompt (ในเสียงพากย์ไม่มี 100%)", hits.filter((h) => h.where === "voiceover" && h.word === "100%").length, 0);
  check("เจอ 100% (ban) ในแคปชัน", hits.some((h) => h.word === "100%" && h.where === "caption"), true);
  check("เจอ ปลอดภัย (check) ในแคปชัน", hits.some((h) => h.word === "ปลอดภัย" && h.level === "check" && h.where === "caption"), true);
  check("เจอ ขายดี (check) ในแฮชแท็ก", hits.some((h) => h.word === "ขายดี" && h.where === "hashtags"), true);
  check("ข้อความสะอาด = ไม่มี hit", c.checkClaims({ tenPart: "เสียงพากย์: “แขวนเสื้อได้เยอะ ประหยัดพื้นที่”", caption: "จัดระเบียบหลังประตู", hashtags: "#ตะขอ" }), []);
  check("คำเดียวกันซ้ำในที่เดียวกัน รายงานครั้งเดียว", c.checkClaims({ tenPart: "", caption: "ดีที่สุด ดีที่สุด", hashtags: "" }).length, 1);
  check("snippet มีคำที่เจอ", c.checkClaims({ tenPart: "", caption: "กล่องนี้ถูกที่สุดในตลาด", hashtags: "" })[0].snippet.includes("ถูกที่สุด"), true);
  check("ถูกที่สุด จับเป็นคำเดียว ไม่ซ้ำกับ ดีที่สุด", c.checkClaims({ tenPart: "", caption: "ถูกที่สุด", hashtags: "" }).map((h) => h.word), ["ถูกที่สุด"]);
} finally {
  rmSync(out, { recursive: true, force: true });
}
console.log(failed === 0 ? "\nผ่านทุกเคส" : `\nตก ${failed} เคส`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 2: Run it — expect FAIL** (`node scripts/check-claims.mjs` → tsc error: cannot find `lib/claim-check.ts`)

- [ ] **Step 3: Implement** — `lib/claim-check.ts`

```ts
/**
 * ตัวตรวจคำเสี่ยงในข้อความที่ออกสู่คนดู (เสียงพากย์ / แคปชัน / แฮชแท็ก) — pure ห้าม import อะไร (client ใช้)
 * กฎ TikTok Shop: คำโฆษณาต้องตรงหน้าสินค้า และห้ามเสมอ: การันตีผล สุขภาพ อันดับ 1/ดีที่สุด/ถูกที่สุด รางวัล/ใบรับรอง ราคา
 * · ban = ลบก่อนโพสต์ · check = ใช้ได้ถ้าหน้าสินค้าเขียนไว้จริง (แค่เตือน ไม่จำกัดคลังคำ — ผู้ใช้กลัวคลิปซ้ำกัน)
 */
export type ClaimLevel = "ban" | "check";
export type ClaimHit = { word: string; level: ClaimLevel; where: "voiceover" | "caption" | "hashtags"; snippet: string };

export const BAN_WORDS: readonly string[] = [
  "ดีที่สุด", "ถูกที่สุด", "อันดับ 1", "อันดับหนึ่ง", "เบอร์ 1", "เบอร์หนึ่ง", "100%", "การันตี", "รับประกันผล",
  "ได้ผลแน่นอน", "เห็นผลทันที", "หายขาด", "รักษา", "ลดน้ำหนัก", "ฆ่าเชื้อ", "ทางการแพทย์", "ของแท้",
];
export const CHECK_WORDS: readonly string[] = [
  "ปลอดภัย", "ทนทาน", "เกรดอาหาร", "ไม่เป็นสนิม", "ขายดี", "กันน้ำ", "รับน้ำหนัก", "ไร้สารพิษ", "ออร์แกนิก",
];

/** ข้อความเสียงพากย์ที่คนดูได้ยิน: บล็อก "Full voice-over script" + ทุกบรรทัด "เสียงพากย์:" · ไม่รวม Negative Prompt/QA */
export function extractVoiceover(tenPart: string): string {
  const lines = tenPart.replace(/\r\n/g, "\n").split("\n");
  const picked: string[] = [];
  let inScript = false;
  for (const line of lines) {
    const t = line.trim();
    if (/voice-?over script/i.test(t)) { inScript = true; continue; }
    if (inScript) {
      if (t === "" || t.startsWith("**") || /^\d+\.\s/.test(t)) { if (t !== "") inScript = false; else if (picked.length > 0) inScript = false; continue; }
      picked.push(t);
      continue;
    }
    const m = /^(?:[-*]\s*)?เสียงพากย์\s*[:：]\s*(.+)$/.exec(t);
    if (m) picked.push(m[1]);
  }
  return picked.join("\n");
}

/** หาคำเสี่ยงในข้อความ · คำยาวกว่าชนะ (ไม่รายงาน "ที่สุด" ซ้อนกัน) · คืนตำแหน่งแรกของแต่ละคำ */
export function findClaimWords(text: string): { word: string; level: ClaimLevel; index: number }[] {
  const all = [
    ...BAN_WORDS.map((word) => ({ word, level: "ban" as ClaimLevel })),
    ...CHECK_WORDS.map((word) => ({ word, level: "check" as ClaimLevel })),
  ].sort((a, b) => b.word.length - a.word.length);
  const taken: [number, number][] = [];
  const found: { word: string; level: ClaimLevel; index: number }[] = [];
  for (const { word, level } of all) {
    let from = 0;
    let firstFree = -1;
    for (;;) {
      const i = text.indexOf(word, from);
      if (i < 0) break;
      const overlaps = taken.some(([s, e]) => i < e && i + word.length > s);
      if (!overlaps) { taken.push([i, i + word.length]); if (firstFree < 0) firstFree = i; }
      from = i + word.length;
    }
    if (firstFree >= 0) found.push({ word, level, index: firstFree });
  }
  return found.sort((a, b) => a.index - b.index);
}

function snippetAround(text: string, index: number, word: string): string {
  const s = Math.max(0, index - 20);
  const e = Math.min(text.length, index + word.length + 20);
  return `${s > 0 ? "…" : ""}${text.slice(s, e).replace(/\s+/g, " ").trim()}${e < text.length ? "…" : ""}`;
}

export function checkClaims(input: { tenPart: string; caption: string; hashtags: string }): ClaimHit[] {
  const parts: [ClaimHit["where"], string][] = [
    ["voiceover", extractVoiceover(input.tenPart)],
    ["caption", input.caption],
    ["hashtags", input.hashtags],
  ];
  const hits: ClaimHit[] = [];
  for (const [where, text] of parts) {
    for (const f of findClaimWords(text)) {
      hits.push({ word: f.word, level: f.level, where, snippet: snippetAround(text, f.index, f.word) });
    }
  }
  return hits;
}
```

(If `extractVoiceover`'s end-of-script detection fails a test, simplify: the script block ends at the first line starting with `**` after at least one picked line. Keep behaviour pinned by the tests.)

- [ ] **Step 4: Run — expect PASS** (`node scripts/check-claims.mjs` → `ผ่านทุกเคส`)

- [ ] **Step 5: Real-data validation (read-only)** — `scripts/claim-scan.js` reads a DB path from argv (default `dev-test.db`), runs `checkClaims` on the 60 newest entries with `chatgptOutput <> ''` and prints every hit with entry name + snippet. It must `require()` better-sqlite3 by absolute path from the repo (`path.join(__dirname, "..", "node_modules", "better-sqlite3")`), open `{ readonly: true, fileMustExist: true }`, and import the compiled claim-check the same way the check script does (compile to a temp dir with `npx tsc`). Run it against a fresh `dev-test.db` copy. **Read every hit.** Remove or adjust any word whose hits are nonsense (e.g. a word matching inside an unrelated longer word); record the counts and the decision in the report. Do not tune the list just to reach zero hits — real risky words should still be reported.

- [ ] **Step 6: package.json** — add `"check:claims": "node scripts/check-claims.mjs"` and append ` && node scripts/check-claims.mjs` to `check:flow`. Run `npm run check:flow` → all pass.

- [ ] **Step 7: Commit**

```bash
git add lib/claim-check.ts scripts/check-claims.mjs scripts/claim-scan.js package.json
git commit -m "Claim checker: flag risky words in voice-over, caption and hashtags

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Listing facts rules (pure)

**Files:**
- Create: `lib/listing-facts.ts`
- Create: `scripts/check-listing-facts.mjs`
- Modify: `package.json` (`check:flow` += ` && node scripts/check-listing-facts.mjs`)

**Interfaces:**
- Consumes: `findClaimWords` from `lib/claim-check.ts` — **exception to "no imports"**: `lib/listing-facts.ts` may import from `./claim-check` (relative, pure). Compile both files together in the check script.
- Produces:
  - `export const FULL_TITLE_PREFIX = "ชื่อเต็มจากร้าน: ";`
  - `export const LISTING_DONE_MARKER = "ข้อมูลจากรูปร้านค้า:";` (first line of a finished extraction block — present even when no items)
  - `export type ListingKind = "visual_fact" | "listing_claim" | "risky";`
  - `export type ListingItem = { text: string; kind: ListingKind };`
  - `export const DIVERSITY_RULE: string` (verbatim from Global Constraints)
  - `export function parseListingItems(raw: string): ListingItem[]` — tolerant JSON parse of `{ "items": [{ "text", "kind" }] }`; bad JSON → `[]`; drops unknown kinds, empty/whitespace text, trims, dedupes by text
  - `export function needsListingExtraction(productInfo: string): boolean` — true when `productInfo.trim() === ""` or every non-empty line starts with `FULL_TITLE_PREFIX`
  - `export function formatListingFacts(fullTitle: string, items: ListingItem[]): { text: string; dropped: number }`
  - `export function acceptShortName(candidate: string, fullTitle: string): string` — returns trimmed candidate if 1–60 chars and single line, else `fullTitle`

- [ ] **Step 1: Write the failing test** — `scripts/check-listing-facts.mjs` (same harness as Task 1; compile `lib/listing-facts.ts lib/claim-check.ts` together; import `listing-facts.js`). Cases:

```js
  const L = await import(pathToFileURL(join(out, "listing-facts.js")).href);
  const raw = JSON.stringify({ items: [
    { text: "ตะขอ 5 อัน", kind: "visual_fact" },
    { text: "แถบยึดกว้าง 4.5 cm", kind: "visual_fact" },
    { text: "มุมมนกลม ไม่ขูดขีดเสื้อผ้า", kind: "listing_claim" },
    { text: "รับน้ำหนักได้ดีที่สุด", kind: "listing_claim" },
    { text: "ลดราคา 50%", kind: "risky" },
    { text: "  ", kind: "visual_fact" },
    { text: "ตะขอ 5 อัน", kind: "visual_fact" },
    { text: "อะไรก็ได้", kind: "weird" },
  ] });
  const items = L.parseListingItems(raw);
  check("parse ตัดค่าว่าง/ซ้ำ/kind แปลก", items.length, 5);
  check("parse JSON เสีย = []", L.parseListingItems("not json {"), []);
  check("parse ไม่มี items = []", L.parseListingItems("{}"), []);

  const f = L.formatListingFacts("ตะขอหลังประตู 2in1 ดีที่สุด", items);
  check("มีบรรทัดชื่อเต็ม", f.text.startsWith(L.FULL_TITLE_PREFIX), true);
  check("มี marker ว่าสกัดแล้ว", f.text.includes(L.LISTING_DONE_MARKER), true);
  check("ข้อเท็จจริงเข้า", f.text.includes("ตะขอ 5 อัน") && f.text.includes("4.5 cm"), true);
  check("listing_claim สะอาดเข้า", f.text.includes("มุมมนกลม"), true);
  check("listing_claim ที่มีคำ ban ถูกตัด", f.text.includes("รับน้ำหนักได้ดีที่สุด"), false);
  check("risky ไม่เข้า", f.text.includes("ลดราคา"), false);
  check("นับที่ตัดทิ้ง = 2", f.dropped, 2);
  check("มีกติกาความหลากหลายเมื่อมีจุดเด่น", f.text.includes(L.DIVERSITY_RULE), true);
  check("ชื่อเต็มที่มีคำ ban ไม่ถูกส่ง (บรรทัดชื่อเต็มเขียน แต่ตัดคำ ban ออก)", f.text.split("\n")[0].includes("ดีที่สุด"), false);

  const empty = L.formatListingFacts("กล่องใส", []);
  check("ไม่มีรายการ ยังมี marker (กันสกัดซ้ำทุกครั้ง)", empty.text.includes(L.LISTING_DONE_MARKER), true);
  check("ไม่มีจุดเด่น = ไม่ใส่กติกา", empty.text.includes(L.DIVERSITY_RULE), false);

  check("needs: ว่าง", L.needsListingExtraction(""), true);
  check("needs: มีแค่ชื่อเต็ม", L.needsListingExtraction(`${L.FULL_TITLE_PREFIX}ตะขอ`), true);
  check("needs: สกัดแล้ว", L.needsListingExtraction(f.text), false);
  check("needs: ผู้ใช้พิมพ์เอง", L.needsListingExtraction("ข้อมูลจากร้าน: ไม้ไผ่"), false);

  check("ชื่อสั้นปกติ", L.acceptShortName("  ตะขอแขวนหลังประตู ", "ยาว"), "ตะขอแขวนหลังประตู");
  check("ชื่อสั้นว่าง → ชื่อเต็ม", L.acceptShortName("", "ชื่อเต็ม"), "ชื่อเต็ม");
  check("ชื่อสั้นเกิน 60 → ชื่อเต็ม", L.acceptShortName("ก".repeat(61), "ชื่อเต็ม"), "ชื่อเต็ม");
  check("ชื่อสั้นหลายบรรทัด → ชื่อเต็ม", L.acceptShortName("ตะขอ\nแขวน", "ชื่อเต็ม"), "ชื่อเต็ม");
```

- [ ] **Step 2: Run — expect FAIL** (module missing)

- [ ] **Step 3: Implement** — `lib/listing-facts.ts`

```ts
/**
 * กฎของ "ข้อมูลจากรูปร้านค้า" ของงาน Showcase (pure — spec 2026-10-01-showcase-listing-facts-design.md)
 * AI ติดป้ายหมวด แต่ **โค้ดนี้** เป็นคนคัดว่าอะไรเข้าพรอมต์ · risky และบรรทัดที่โดนคำ ban ไม่เข้าเด็ดขาด
 */
import { findClaimWords } from "./claim-check";

export const FULL_TITLE_PREFIX = "ชื่อเต็มจากร้าน: ";
export const LISTING_DONE_MARKER = "ข้อมูลจากรูปร้านค้า:";
export type ListingKind = "visual_fact" | "listing_claim" | "risky";
export type ListingItem = { text: string; kind: ListingKind };
const KINDS: readonly string[] = ["visual_fact", "listing_claim", "risky"];

export const DIVERSITY_RULE =
  "กติกาการใช้รายการด้านบน: เป็นขอบเขตของข้อเท็จจริงเรื่องตัวสินค้าที่พูดได้ ไม่ใช่บทที่ต้องพูด · ไม่ต้องพูดครบทุกข้อ เลือก 1–2 ข้อที่เข้ากับ angle/use case ของคลิปนี้ หรือไม่พูดเลยก็ได้ · ห้ามลอกถ้อยคำของร้าน ให้เล่าใหม่เป็นภาษาพูดของคนใช้จริง · hook สถานการณ์ อารมณ์ มุมเล่า และ CTA คิดได้อิสระ · ห้ามอ้างคุณสมบัติหรือผลลัพธ์ของสินค้าที่ไม่อยู่ในรายการและมองไม่เห็นจากรูป";

export function parseListingItems(raw: string): ListingItem[] {
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return []; }
  const list = (data as { items?: unknown })?.items;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: ListingItem[] = [];
  for (const it of list) {
    const text = typeof (it as { text?: unknown })?.text === "string" ? (it as { text: string }).text.replace(/\s+/g, " ").trim() : "";
    const kind = (it as { kind?: unknown })?.kind;
    if (text === "" || typeof kind !== "string" || !KINDS.includes(kind) || seen.has(text)) continue;
    seen.add(text);
    out.push({ text, kind: kind as ListingKind });
  }
  return out;
}

export function needsListingExtraction(productInfo: string): boolean {
  const lines = productInfo.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  return lines.every((l) => l.startsWith(FULL_TITLE_PREFIX.trim()));
}

const hasBan = (text: string) => findClaimWords(text).some((w) => w.level === "ban");

/** ชื่อเต็มของร้านเก็บไว้อ้างอิง แต่ตัดคำ ban ออกก่อน (ชื่อ SEO มักมี "ดีที่สุด/ขายดี") */
function cleanTitle(title: string): string {
  let t = title;
  for (const w of findClaimWords(title).filter((x) => x.level === "ban")) t = t.split(w.word).join("");
  return t.replace(/\s+/g, " ").trim();
}

export function formatListingFacts(fullTitle: string, items: ListingItem[]): { text: string; dropped: number } {
  const facts = items.filter((i) => i.kind === "visual_fact" && !hasBan(i.text));
  const claims = items.filter((i) => i.kind === "listing_claim" && !hasBan(i.text));
  const dropped = items.length - facts.length - claims.length;
  const lines = [`${FULL_TITLE_PREFIX}${cleanTitle(fullTitle)}`, LISTING_DONE_MARKER];
  if (facts.length > 0) {
    lines.push("ข้อเท็จจริงที่เห็นจากรูปร้านค้า (ใช้บรรยายรูปทรงให้ถูก):", ...facts.map((f) => `- ${f.text}`));
  }
  if (claims.length > 0) {
    lines.push("จุดเด่นที่หน้าสินค้าเขียนไว้:", ...claims.map((c) => `- ${c.text}`), DIVERSITY_RULE);
  }
  if (facts.length === 0 && claims.length === 0) lines.push("(ไม่พบข้อความที่ใช้ได้ในรูปร้านค้า)");
  return { text: lines.join("\n"), dropped };
}

export function acceptShortName(candidate: string, fullTitle: string): string {
  const t = candidate.trim();
  if (t === "" || t.length > 60 || /\n/.test(t)) return fullTitle;
  return t;
}
```

- [ ] **Step 4: Run — expect PASS**; also `npx tsc --noEmit`.
- [ ] **Step 5: Add to `check:flow`, run `npm run check:flow`, commit** (`lib/listing-facts.ts scripts/check-listing-facts.mjs package.json`, message `Listing facts rules: classify, drop risky/banned, diversity rule`).

---

### Task 3: Gemini calls + dry-run against real shop images

**Files:**
- Modify: `lib/gemini.ts` (append two functions + instructions)
- Create: `scripts/listing-dry-run.ts` (run with `npx tsx`)

**Interfaces:**
- Consumes: `GeminiImage`, `EXTRACT_MODEL`, `GoogleGenAI` (already in `lib/gemini.ts`); `parseListingItems`, `ListingItem` from `lib/listing-facts.ts`.
- Produces:
  - `export async function shortenProductName(fullTitle: string): Promise<string>` — raw model answer (caller applies `acceptShortName`); throws on API error (caller catches)
  - `export async function extractListingItems(args: { fullTitle: string; images: GeminiImage[] }): Promise<ListingItem[]>` — throws on API error/empty answer (caller catches)

- [ ] **Step 1: Implement** (append to `lib/gemini.ts`)

```ts
const SHORT_NAME_INSTRUCTION = `ย่อชื่อสินค้า TikTok Shop ให้เหลือชื่อเรียกสั้น 2–5 คำ ที่บอกว่าสินค้าคืออะไร เช่น "ตะขอแขวนหลังประตู" "กล่องพลาสติกใสมีฝา"
ตัดคำโฆษณา/SEO ทิ้งทั้งหมด (เช่น เกรดอาหาร ขายดี ดีที่สุด เหมาะหอพัก คอนโด ราคาถูก ส่งไว พร้อมส่ง) ห้ามใส่วงเล็บ ห้ามใส่ราคา
ตอบเป็น JSON ตาม schema เท่านั้น`;

export async function shortenProductName(fullTitle: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("ยังไม่ได้ตั้งค่า GEMINI_API_KEY ในไฟล์ .env");
  const client = new GoogleGenAI({ apiKey });
  const response = await client.interactions.create({
    model: EXTRACT_MODEL,
    // snake_case ทั้งหมด — camelCase ถูกเมินเงียบๆ (ดู generateTenPartPrompt)
    system_instruction: SHORT_NAME_INSTRUCTION,
    generation_config: { temperature: 0 },
    response_format: {
      type: "text",
      mime_type: "application/json",
      schema: { type: "object", properties: { shortName: { type: "string" } }, required: ["shortName"] },
    },
    input: [{ type: "text", text: fullTitle }],
  });
  const text = response.output_text ?? "";
  const parsed = JSON.parse(text) as { shortName?: unknown };
  return typeof parsed.shortName === "string" ? parsed.shortName : "";
}

const LISTING_INSTRUCTION = `คุณอ่านรูปแกลเลอรีของสินค้าใน TikTok Shop (รูปสินค้า + รูป infographic ที่มีข้อความ) แล้วแตกเป็นรายการข้อความสั้นๆ ทีละเรื่อง
ติดป้าย kind ให้ทุกรายการ:
- visual_fact: ข้อเท็จจริงที่ตรวจได้จากรูป — ขนาด/ตัวเลข จำนวนชิ้น วัสดุ สี รูปทรง วิธีติดตั้ง/กลไก ของที่ได้ในกล่อง
- listing_claim: จุดเด่นที่ร้านเขียนไว้ซึ่งไม่ใช่คำเสี่ยง เช่น "มุมมนกลม"
- risky: การันตีผล, เรื่องสุขภาพ/ความปลอดภัย/ฆ่าเชื้อ/สารพิษ, อันดับ 1/ดีที่สุด/ถูกที่สุด, รางวัล/ใบรับรอง/มาตรฐาน, ราคา/โปร/ส่วนลด, ความทนทานหรือการรับน้ำหนักแบบเกินจริง — ไม่แน่ใจให้ใส่ risky
กติกา: อ่านเฉพาะที่เห็นจริง ห้ามเดา ห้ามแต่งเติม · ภาษาไทย สั้น กระชับ รายการละเรื่องเดียว · ไม่ต้องใส่ชื่อร้าน
ตอบเป็น JSON ตาม schema เท่านั้น`;

export async function extractListingItems(args: { fullTitle: string; images: GeminiImage[] }): Promise<ListingItem[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("ยังไม่ได้ตั้งค่า GEMINI_API_KEY ในไฟล์ .env");
  const client = new GoogleGenAI({ apiKey });
  const input: object[] = [{ type: "text", text: `ชื่อสินค้าในร้าน: ${args.fullTitle}` }];
  for (const [i, image] of args.images.entries()) {
    input.push({ type: "text", text: `รูปที่ ${i + 1}` });
    input.push({ type: "image", data: image.base64, mime_type: image.mimeType });
  }
  const response = await client.interactions.create({
    model: EXTRACT_MODEL,
    system_instruction: LISTING_INSTRUCTION,
    generation_config: { temperature: 0 },
    response_format: {
      type: "text",
      mime_type: "application/json",
      schema: {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: { text: { type: "string" }, kind: { type: "string", enum: ["visual_fact", "listing_claim", "risky"] } },
              required: ["text", "kind"],
            },
          },
        },
        required: ["items"],
      },
    },
    input,
  });
  const text = response.output_text;
  if (!text || text.trim() === "") throw new Error("AI ไม่ได้ตอบกลับตอนอ่านรูปร้านค้า");
  return parseListingItems(text);
}
```

Add `import { parseListingItems, type ListingItem } from "@/lib/listing-facts";` at the top of `lib/gemini.ts`. If `tsc` rejects `response_format` (e.g. `mime_type` type), read `TextResponseFormat_2` / `TextResponseFormatMimeType` in `genai.d.ts` and fix the literal — do not cast to `any`.

- [ ] **Step 2: Dry-run script** — `scripts/listing-dry-run.ts` (tsx; loads `.env` via `import "dotenv/config"`; uses `@/lib/prisma`? No — use better-sqlite3 directly on the DB path given by `DATABASE_URL`/argv to avoid writing). For each candidate id passed on argv (default: the 3 Showcase candidates linked to entries — query `ProductCandidate where sourceProductId is not null and linkedEntryId is not null`), read its `name` and `CandidateImage` files (`uploads/_candidates/<candidateId>/<filename>`, max 10, sorted by `sortOrder`), call `shortenProductName` → `acceptShortName`, then `extractListingItems`, then `formatListingFacts`, and print: full title, short name, each item with its kind, `dropped`, the final text, and the milliseconds of each Gemini call. **Read-only: no DB writes.**
- [ ] **Step 3: Run it** — `DATABASE_URL="file:./dev-test.db" npx tsx scripts/listing-dry-run.ts` against a fresh `dev-test.db` copy (needs `GEMINI_API_KEY` in `.env`; this calls the real Gemini API ~6 times — allowed). Paste the full output into the task report. If a call fails because of the schema, fix and re-run.
- [ ] **Step 4:** `npx tsc --noEmit`, eslint on changed files, commit (`lib/gemini.ts scripts/listing-dry-run.ts`, message `Gemini: short product name and listing items (structured output); dry-run script`).

---

### Task 4: Wire into start + generate + spec extraction

**Files:**
- Modify: `app/actions.ts` (`startShowcaseProduct` ~1131-1190; `generateWithAI` ~527-640; add helper `loadCandidateImages`)
- Modify: `lib/gemini.ts` `extractProductSpec` — no signature change needed (it already takes `images: GeminiImage[]` with captions)

**Interfaces:**
- Consumes: `shortenProductName`, `extractListingItems` (Task 3); `acceptShortName`, `formatListingFacts`, `needsListingExtraction`, `FULL_TITLE_PREFIX` (Task 2).
- Produces: `async function loadCandidateImages(candidateId: string, limit: number, caption: string): Promise<GeminiImage[]>` (module-private in `app/actions.ts`): reads `CandidateImage` rows ordered by `sortOrder`, files from `joinPath(CANDIDATE_IMAGE_ROOT, candidateId, filename)` (paths only via `lib/upload-paths.ts` — CLAUDE.md rule), skips unreadable files.

- [ ] **Step 1: `startShowcaseProduct`** — before `prisma.promptEntry.create`:

```ts
  // ชื่อร้านเป็นชื่อ SEO ยาว 100+ ตัว — ย่อเหมือนเส้นทางแคปเองก่อน (บอทพิมพ์ productName ในพรอมต์รอบ 1 ทันที)
  // ล้มเหลวทุกแบบ = ใช้ชื่อเต็มเหมือนเดิม ห้ามทำให้การเริ่มงานพัง
  let shortName = candidate.name;
  try {
    shortName = acceptShortName(await shortenProductName(candidate.name), candidate.name);
  } catch (e) {
    console.error("ย่อชื่อสินค้าไม่สำเร็จ ใช้ชื่อเต็ม:", e instanceof Error ? e.message : e);
  }
```
and in `create.data`: `productName: shortName, productInfo: \`${FULL_TITLE_PREFIX}${candidate.name}\``.

- [ ] **Step 2: `generateWithAI`** — right after the `core` check and **before** step 0, add a best-effort block:

```ts
  // ขั้นก่อน 0: งานจาก Showcase → อ่านรูปแกลเลอรีของร้าน (ครั้งเดียว) เป็นข้อเท็จจริง/จุดเด่นที่หน้าสินค้ายืนยัน
  // คำเสี่ยงถูกตัดทิ้งใน formatListingFacts · ล้มเหลว = ข้ามเงียบๆ ไม่ทำให้ "สร้างด้วย AI" พัง (spec §2)
  const candidate = await prisma.productCandidate.findFirst({
    where: { linkedEntryId: entryId, sourceProductId: { not: null } },
    select: { id: true, name: true },
  });
  let productInfo = entry.productInfo;
  if (candidate && needsListingExtraction(productInfo)) {
    try {
      const images = await loadCandidateImages(candidate.id, 10, "");
      if (images.length > 0) {
        const items = await extractListingItems({ fullTitle: candidate.name, images });
        const formatted = formatListingFacts(candidate.name, items);
        productInfo = formatted.text;
        await prisma.promptEntry.update({ where: { id: entryId }, data: { productInfo } });
        console.log(`อ่านรูปร้านค้า ${entryId}: ${items.length} รายการ ตัดทิ้ง ${formatted.dropped}`);
      }
    } catch (e) {
      console.error("อ่านรูปร้านค้าไม่สำเร็จ (ข้าม):", e instanceof Error ? e.message : e);
    }
  }
```
Then use the local `productInfo` (not `entry.productInfo`) in both the `extractProductSpec` call and `buildPromptText`.

- [ ] **Step 3: Step 0 sees real photos** — in the `extractProductSpec` call, append up to 4 shop photos:

```ts
      images: [
        ...(await loadGeminiImages(entry.productImages)),
        ...(candidate ? await loadCandidateImages(candidate.id, 4, "รูปจริงจากร้านค้า") : []),
      ],
```

- [ ] **Step 4: Verify** — `npx tsc --noEmit`, eslint, `npm run check:flow`. Then on a fresh `dev-test.db` (port 3001 not needed): write a scratch script (in the scratchpad, not the repo) that imports nothing from Next and instead re-runs Step 2's logic through `npx tsx` against `dev-test.db` for one of the 3 Showcase entries, OR (preferred) start the dev server on 3001 with `dev-test.db` and press "สร้างด้วย AI" on one Showcase entry through Playwright; confirm `productInfo` now contains `LISTING_DONE_MARKER`, the 10-part prompt was generated, and a second press does not re-extract (log line appears once). This calls real Gemini (allowed). Clean up per Global Constraints.
- [ ] **Step 5: Commit** (`app/actions.ts`, message `Showcase: short name at start, shop-image facts before step 0, real photos in spec extraction`).

**Reviewer checklist (Task 4):** `duplicatePrompt`/manual entries untouched (no candidate → no call) · no path built with `path.join(process.cwd(), "uploads", …)` · no throw escapes the two new try blocks · step 0 still only runs when `productSpec` is empty · `productInfo` used consistently after the block.

---

### Task 5: Show claim warnings (Flow ready-to-post card + entry tab ②)

**Files:**
- Create: `components/claim-warnings.tsx`
- Modify: `components/flow-clip-layout.tsx` (`ReadyToPostCard`)
- Modify: `components/production-panel.tsx` (near the caption/hashtags editor and copy button)

**Interfaces:**
- Consumes: `checkClaims`, `ClaimHit` (Task 1). `FlowJobRow` already has `prompt`, `caption`, `hashtags`. `production-panel` has local `caption`/`hashtags` state and the entry's `chatgptOutput` (verify the prop name in the component; add it to props if missing).
- Produces: `export function ClaimWarnings({ tenPart, caption, hashtags }: { tenPart: string; caption: string; hashtags: string })` — renders nothing when there are no hits.

- [ ] **Step 1: Component** — `components/claim-warnings.tsx` (`"use client"`): compute `checkClaims(...)` with `useMemo`; render a box `border-l-4 border-status-warning bg-surface-2 p-3 text-sm leading-relaxed` with title `ตรวจคำก่อนโพสต์` and one line per hit:
  - `ban`: `พบ "<word>" ใน<ที่> — ลบก่อนโพสต์` (ที่: เสียงพากย์ / แคปชัน / แฮชแท็ก) + the snippet in `text-muted-foreground`
  - `check`: `พบ "<word>" ใน<ที่> — เช็กว่าหน้าสินค้าเขียนไว้จริงไหม`
  - footer `text-xs text-muted-foreground`: `เป็นคำเตือน ไม่ได้แก้ข้อความให้`
- [ ] **Step 2:** Render `<ClaimWarnings tenPart={job.prompt} caption={job.caption} hashtags={job.hashtags} />` at the top of `ReadyToPostCard` (only in the non-empty branch). In `production-panel.tsx`, render it above the caption/hashtags editor using the **live** state values (so it updates while the user edits).
- [ ] **Step 3: Verify** — `npx tsc --noEmit`, eslint, `node scripts/check-contrast.mjs` (only if tokens touched). UI smoke on 3001 with a fresh `dev-test.db`: set one done Showcase entry's caption in **dev-test.db only** to include `ดีที่สุด` and `ทนทาน`; screenshot `/flow?job=<id>` at 1920×1080 and `/entry/<entryId>` tab ② at 1440×900; confirm both warnings render, and that a clean caption shows no box. Save screenshots to the scratchpad. Clean up.
- [ ] **Step 4: Commit** (`components/claim-warnings.tsx components/flow-clip-layout.tsx components/production-panel.tsx`, message `Show risky-claim warnings before posting`).

---

### Task 6: Backfill script + docs

**Files:**
- Create: `scripts/backfill-showcase-facts.ts`
- Modify: `CLAUDE.md` (Showcase section), spec status line

- [ ] **Step 1: Script** — `npx tsx scripts/backfill-showcase-facts.ts [--dry] <entryId…>` (no ids = every entry linked to a Showcase candidate that has no video posted yet). For each: load entry + candidate via Prisma (`@/lib/prisma`, honours `DATABASE_URL`); if `productName === candidate.name` → shorten (Task 3 + `acceptShortName`); if `needsListingExtraction(productInfo)` → extract + `formatListingFacts`. Never touch `productSpec`, `chatgptOutput`, caption. Print before/after per field and ms per call. `--dry` = print only, no writes. Errors per entry are printed and the script continues.
- [ ] **Step 2: Test it on `dev-test.db`** — `DATABASE_URL="file:./dev-test.db" npx tsx scripts/backfill-showcase-facts.ts --dry` then without `--dry`, then run again and confirm the second run changes nothing (idempotent). Paste outputs into the report.
- [ ] **Step 3: CLAUDE.md** — add under "Showcase Scanner ↔ Angle" a bullet: short name at start (`acceptShortName`, full title kept as `ชื่อเต็มจากร้าน:` in `productInfo`); shop-image facts read once in `generateWithAI` before step 0 via structured output, code drops `risky` + `ban` words (`lib/listing-facts.ts`); listing claims are a *boundary not a script* (diversity rule); step 0 also sees 4 real shop photos; `lib/claim-check.ts` warns in /flow and entry tab ②; `scripts/claim-scan.js` re-validates the word list on real data; backfill command for the user (they run it on the real DB via `!`). Update the spec status line to `implemented 2026-10-01`.
- [ ] **Step 4: Commit** (`scripts/backfill-showcase-facts.ts CLAUDE.md docs/superpowers/specs/2026-10-01-showcase-listing-facts-design.md`, message `Backfill script for Showcase facts; docs`).

## Deviation recorded

- Spec said "ย่อรูปด้านยาว ≤768px": dropped — shop images are 50–110 KB each, ≤10 per product, and `sharp` is not a direct dependency. Revisit only if the dry-run shows slow calls or token errors.
- Dropped `risky` items are only logged (count), not shown in the UI (scope cut; the claim checker covers what reaches the audience).
