# Required hashtag (แฮชแท็กที่ต้องลง) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ติ๊กเลือกสินค้าหลายตัวในหน้า `/showcase` แล้วใส่ "แฮชแท็กที่ต้องลง" ให้ทีเดียว และโชว์เป็นป้ายที่ `/showcase`, หัวงาน `/flow`, หน้า entry เพื่อใช้ตอนปักตะกร้า

**Architecture:** ตารางใหม่ `ProductHashtag` (1 แถวต่อสินค้า ผูกด้วย `sourceProductId` ไม่ผูกแถว `ProductCandidate` เพราะส่งซ้ำแล้วได้แถวใหม่) · ตรรกะ pure ทั้งหมดอยู่ `lib/required-hashtag.ts` ทดสอบด้วยสคริปต์ `scripts/check-required-hashtag.mjs` · server action สองตัวเขียน/ลบ · ไม่แตะ extension, `/api/scanner`, `importShowcaseBatch`, `โพสต์.txt`

**Tech Stack:** Next.js 16 custom (App Router, Server Actions), Prisma 7 + better-sqlite3, Tailwind v4 tokens, สคริปต์ตรวจแบบ `node scripts/check-*.mjs` (ไม่มี test runner)

**Spec:** `.scratch/required-hashtag/spec.md` (อ่านคู่กับแผนนี้) · คำศัพท์ `CONTEXT.md` → "Required hashtag" · งานวิจัย `docs/research/2026-10-10-campaign-flag-for-analysis.md`

## Global Constraints

- ทำบน branch `required-hashtag` ห้ามแก้ `dev.db` จริง · ทดสอบกับ `dev-test.db` (สำเนา) พอร์ต 3001 เท่านั้น · `DELETE` ทุกครั้งมี `WHERE` เจาะจง
- ห้ามรัน `npm run build` ระหว่างทำ (พอร์ต 3000 เป็นของผู้ใช้) · ใช้ `npx tsc --noEmit` + `npm run lint`
- Next.js เป็น custom build: Server Actions / `revalidatePath` / `<form action>` ใช้แบบ v15 ได้ ไม่ต้องเช็กซ้ำ
- `tsconfig.json` ห้ามเปลี่ยน: `git diff tsconfig.json` ก่อน commit ทุกครั้ง · `target: "ES2017"`
- UI: สีจาก token เท่านั้น (ไม่มี hex) · ขนาดตัวอักษร `text-xs`/`sm`/`base`… ไม่ใช้ `text-[...]` · ข้อความไทย `leading-relaxed` · ปุ่มต่ำกว่า `lg:` สูง ≥ 44px (ใช้ `Button` ที่จัดการให้แล้ว, ปุ่มเขียนเอง = `h-11 … lg:h-9`) · ไม่มีข้อมูลที่อยู่แค่ใน hover/`title=` · เลย์เอาต์ `lg:`/1440px คงเดิม
- ไม่แก้: `showcase-extension/`, `app/api/scanner/route.ts`, `importShowcaseBatch`, `lib/clip-export*.ts` (`โพสต์.txt`), ฟิลด์ `hashtags` ของ entry
- ใช้คำว่า "แฮชแท็กที่ต้องลง" ใน UI และเอกสาร ไม่ใช้ "แท็ก"/"แคมเปญ"
- commit message ลงท้าย:
  ```
  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_016HDJe73jizaFcY5qkgpYU1
  ```

## Review Focus

กรณีที่สเปกเอ่ยถึงหรือบอกเป็นนัย แต่ไม่ใช่การทดสอบหลัก เรียงจากน่าจะพังที่สุด (แต่ละข้อมี test/ขั้นตรวจใน task ที่ระบุ)

1. ช่องว่าง / `#` เดี่ยว / มีแต่จุลภาค ต้องถูกปฏิเสธ — ห้ามกลายเป็น "ลบแฮชแท็ก" เงียบๆ (Task 1)
2. พิมพ์ติดกัน `#a#b` ต้องแยกเป็น 2 อัน และพิมพ์ไทยล้วนไม่มี `#` (`สินค้ากิจกรรม`) ต้องได้ `#สินค้ากิจกรรม` (Task 1)
3. สแกนส่งสินค้าเดิมซ้ำ (extension POST `/api/scanner`) ต้องไม่ลบ/ไม่ทับแฮชแท็ก (Task 6 ขั้นตรวจบนพอร์ต 3001)
4. DB ที่ยังไม่ migrate (ไม่มีตาราง `ProductHashtag`) ต้องไม่ทำให้ `/flow` และหน้า entry ล่ม (Task 3 — ตามแบบ `FlowActivity`)
5. เปลี่ยนแท็บแล้วที่เลือกไว้ต้องรีเซ็ต ไม่งั้นใส่แฮชแท็กให้สินค้าที่มองไม่เห็น (Task 4)

---

### Task 1: ตรรกะ pure ของแฮชแท็ก (TDD)

**Files:**
- Create: `scripts/check-required-hashtag.mjs`
- Create: `lib/required-hashtag.ts`

**Interfaces:**
- Produces (Task 2–5 ใช้):
  - `normalizeHashtags(input: string): { ok: true; tags: string[] } | { ok: false; message: string }`
  - `serializeHashtags(tags: string[]): string` (คั่นด้วยช่องว่างเดียว — รูปแบบที่เก็บใน DB)
  - `parseStoredHashtags(stored: string): string[]`
  - `suggestHashtags(all: string[][], limit?: number): string[]`
  - `hashtagsForEntries(productIdByEntry: Map<string, string>, tagsByProduct: Map<string, string[]>): Map<string, string[]>`
  - ค่าคงที่ `MAX_HASHTAGS = 10`, `MAX_HASHTAG_LENGTH = 100`

- [ ] **Step 1: เขียนสคริปต์ตรวจก่อน (ยังไม่มีโมดูล)**

สร้าง `scripts/check-required-hashtag.mjs`:

```js
/**
 * ตรวจตรรกะของ lib/required-hashtag.ts (แฮชแท็กที่ต้องลง — CONTEXT.md) — pure ไม่แตะ DB
 *
 * รัน: node scripts/check-required-hashtag.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const out = mkdtempSync(join(process.cwd(), ".check-required-hashtag-tmp-"));
let failed = 0;

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`      ได้ ${JSON.stringify(actual)}\n      ควรได้ ${JSON.stringify(expected)}`);
}

try {
  // โมดูลนี้ไม่ import อะไรเลย — คอมไพล์เดี่ยวได้ ต้องจบด้วย exit 0
  execFileSync(
    "npx",
    ["tsc", "lib/required-hashtag.ts", "--outDir", out, "--module", "es2022", "--target", "ES2017", "--moduleResolution", "bundler"],
    { stdio: "pipe", shell: true }
  );
  const h = await import(pathToFileURL(join(out, "required-hashtag.js")).href);
  const tags = (input) => {
    const r = h.normalizeHashtags(input);
    return r.ok ? r.tags : `ERR:${r.message}`;
  };

  // --- แปลงข้อความที่พิมพ์ ---
  check("มี # อยู่แล้ว", tags("#trendyselected"), ["#trendyselected"]);
  check("ลืมพิมพ์ # = เติมให้", tags("trendyselected"), ["#trendyselected"]);
  check("แยกด้วยช่องว่าง", tags("#a #b"), ["#a", "#b"]);
  check("แยกด้วยจุลภาค (มี/ไม่มีช่องว่าง)", tags("#a,#b, c"), ["#a", "#b", "#c"]);
  check("จุลภาคเต็มความกว้าง", tags("#a，#b"), ["#a", "#b"]);
  check("ขึ้นบรรทัดใหม่/แท็บ = ตัวแยก", tags("#a\n#b\t#c"), ["#a", "#b", "#c"]);
  check("พิมพ์ติดกัน #a#b = 2 อัน", tags("#a#b"), ["#a", "#b"]);
  check("## ซ้อน = อันเดียว", tags("##a"), ["#a"]);
  check("ไทยล้วนไม่มี # = เติมให้", tags("สินค้ากิจกรรม"), ["#สินค้ากิจกรรม"]);
  check("ช่องว่างหัวท้ายถูกตัด", tags("   #a   "), ["#a"]);

  // --- ซ้ำ / ตัวพิมพ์ ---
  check("ซ้ำต่างตัวพิมพ์ = เหลืออันเดียว เก็บตัวพิมพ์ที่พิมพ์ทีหลัง", tags("#TrendySelected #trendyselected"), ["#trendyselected"]);
  check("ซ้ำแล้วคงตำแหน่งของที่พิมพ์ก่อน", tags("#a #b #A"), ["#A", "#b"]);
  check("ลำดับที่พิมพ์คงเดิม", tags("#c #a #b"), ["#c", "#a", "#b"]);

  // --- ปฏิเสธ (ห้ามเงียบจนกลายเป็นลบ) ---
  for (const bad of ["", "   ", "#", "##", ",", " , # , "]) {
    check(`ปฏิเสธ ${JSON.stringify(bad)}`, tags(bad).startsWith("ERR:"), true);
  }
  check("ข้อความปฏิเสธชี้ไปที่ปุ่มลบ", tags("").includes("ลบแฮชแท็ก"), true);
  const ten = Array.from({ length: 10 }, (_, i) => `#t${i}`).join(" ");
  check("10 อันพอดีผ่าน", Array.isArray(tags(ten)) && tags(ten).length === 10, true);
  check("11 อันไม่ผ่าน", tags(`${ten} #t10`).startsWith("ERR:"), true);
  check("ยาว 100 ตัว (รวม #) พอดีผ่าน", Array.isArray(tags("a".repeat(99))), true);
  check("ยาว 101 ตัวไม่ผ่าน", tags("a".repeat(100)).startsWith("ERR:"), true);

  // --- รูปแบบที่เก็บใน DB ---
  check("serialize คั่นช่องว่างเดียว", h.serializeHashtags(["#a", "#b"]), "#a #b");
  check("parse กลับ", h.parseStoredHashtags("#a #b"), ["#a", "#b"]);
  check("parse ค่าว่าง = ไม่มี", h.parseStoredHashtags(""), []);
  check("parse ช่องว่างเกิน", h.parseStoredHashtags("  #a   #b "), ["#a", "#b"]);

  // --- ตัวเลือกที่เคยพิมพ์ ---
  check("ใช้บ่อยสุดก่อน", h.suggestHashtags([["#a"], ["#b", "#a"], ["#a", "#c"], ["#b"]]), ["#a", "#b", "#c"]);
  check("เท่ากัน = ที่เจอก่อนขึ้นก่อน", h.suggestHashtags([["#x"], ["#y"]]), ["#x", "#y"]);
  check("นับต่างตัวพิมพ์เป็นอันเดียว แสดงตัวพิมพ์ที่เจอก่อน", h.suggestHashtags([["#Abc"], ["#abc"]]), ["#Abc"]);
  check("จำกัดจำนวน", h.suggestHashtags([["#a", "#b", "#c"]], 2), ["#a", "#b"]);
  check("ไม่มีสินค้ามีแฮชแท็ก = ว่าง", h.suggestHashtags([[], []]), []);

  // --- เอาไปติดกับ entry ผ่านสินค้า Showcase ---
  const byEntry = h.hashtagsForEntries(
    new Map([["E1", "P1"], ["E2", "P2"], ["E3", "P3"]]),
    new Map([["P1", ["#a"]], ["P3", []]])
  );
  check("entry ที่สินค้ามีแฮชแท็ก", byEntry.get("E1"), ["#a"]);
  check("entry ที่สินค้าไม่มีแถว = ไม่อยู่ใน map", byEntry.has("E2"), false);
  check("entry ที่สินค้ามีรายการว่าง = ไม่อยู่ใน map", byEntry.has("E3"), false);
  check("entry ที่ไม่ได้มาจาก Showcase = ว่าง", h.hashtagsForEntries(new Map(), new Map([["P1", ["#a"]]])).size, 0);

  console.log(failed === 0 ? "\nผ่านทุกเคส" : `\nตก ${failed} เคส`);
} finally {
  rmSync(out, { recursive: true, force: true });
}

process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `node scripts/check-required-hashtag.mjs`
Expected: ล้ม (tsc หาไฟล์ `lib/required-hashtag.ts` ไม่เจอ / exit ไม่ใช่ 0)

- [ ] **Step 3: เขียนโมดูล**

สร้าง `lib/required-hashtag.ts`:

```ts
/**
 * แฮชแท็กที่ต้องลง (Required hashtag — CONTEXT.md) · pure ไม่แตะ DB ไม่ import อะไร
 * ตรวจด้วย node scripts/check-required-hashtag.mjs
 *
 * ผู้ใช้พิมพ์ข้อความเดียว ("#trendyselected #อื่น") ได้รายการแฮชแท็กที่เก็บต่อสินค้า · เก็บใน DB เป็นข้อความคั่นด้วย
 * ช่องว่าง (แฮชแท็กไม่มีช่องว่างอยู่แล้ว) · ใส่ใหม่ = ทับของเดิม · ปล่อยว่างไม่ใช่การลบ (ลบมีปุ่มของตัวเอง)
 */

export const MAX_HASHTAGS = 10;
/** นับรวม # */
export const MAX_HASHTAG_LENGTH = 100;

export type HashtagParse = { ok: true; tags: string[] } | { ok: false; message: string };

/**
 * ตัวแยก = ช่องว่าง/ขึ้นบรรทัด/แท็บ และจุลภาค (ทั้ง , และ ，) · แต่ละก้อนแตกต่อที่ # (พิมพ์ติดกัน #a#b = 2 อัน)
 * ก้อนที่ไม่มี # นำหน้าเติมให้ · ซ้ำกันโดยไม่สนตัวพิมพ์ = เหลืออันเดียว ตำแหน่งของที่พิมพ์ก่อน ตัวพิมพ์ของที่พิมพ์ทีหลัง
 * ไม่มีสักอัน = ปฏิเสธ (ห้ามกลายเป็นการลบเงียบๆ)
 */
export function normalizeHashtags(input: string): HashtagParse {
  const order: string[] = [];
  const shown = new Map<string, string>();
  for (const token of input.split(/[\s,，]+/)) {
    for (const piece of token.split("#")) {
      if (piece === "") continue;
      const tag = `#${piece}`;
      if ([...tag].length > MAX_HASHTAG_LENGTH) {
        return { ok: false, message: `แฮชแท็กยาวเกิน ${MAX_HASHTAG_LENGTH} ตัวอักษร: ${[...tag].slice(0, 20).join("")}…` };
      }
      const key = tag.toLowerCase();
      if (!shown.has(key)) order.push(key);
      shown.set(key, tag);
    }
  }
  if (order.length === 0) {
    return { ok: false, message: "พิมพ์แฮชแท็กอย่างน้อย 1 อัน — ถ้าต้องการลบ ให้กดปุ่ม \"ลบแฮชแท็ก\"" };
  }
  if (order.length > MAX_HASHTAGS) {
    return { ok: false, message: `ใส่ได้ไม่เกิน ${MAX_HASHTAGS} อันต่อสินค้า` };
  }
  return { ok: true, tags: order.map((k) => shown.get(k) as string) };
}

/** รูปแบบที่เก็บใน DB */
export function serializeHashtags(tags: string[]): string {
  return tags.join(" ");
}

export function parseStoredHashtags(stored: string): string[] {
  return stored.split(/\s+/).filter((t) => t !== "");
}

/**
 * ตัวเลือกให้กดแทนการพิมพ์ใหม่ — อันที่สินค้าใช้อยู่บ่อยสุดก่อน (เท่ากัน = ที่เจอก่อน) นับต่างตัวพิมพ์เป็นอันเดียว
 * ไม่มีตารางรายการแยก: คิดจากที่สินค้าถืออยู่ตอนนี้เท่านั้น
 */
export function suggestHashtags(all: string[][], limit = 8): string[] {
  const counts = new Map<string, { tag: string; n: number }>();
  for (const tags of all) {
    for (const tag of tags) {
      const key = tag.toLowerCase();
      const cur = counts.get(key);
      if (cur === undefined) counts.set(key, { tag, n: 1 });
      else cur.n++;
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, limit)
    .map((c) => c.tag);
}

/**
 * แฮชแท็กของแต่ละ entry ผ่านสินค้า Showcase ที่ผูกอยู่ (entry → sourceProductId มาจาก getProductIdsByEntry)
 * entry ที่ไม่ได้มาจาก Showcase หรือสินค้าไม่มีแฮชแท็ก = ไม่อยู่ในผลลัพธ์ (หน้าจอไม่ต้องแสดงอะไร)
 */
export function hashtagsForEntries(
  productIdByEntry: Map<string, string>,
  tagsByProduct: Map<string, string[]>
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const [entryId, productId] of productIdByEntry) {
    const tags = tagsByProduct.get(productId);
    if (tags !== undefined && tags.length > 0) map.set(entryId, tags);
  }
  return map;
}
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `node scripts/check-required-hashtag.mjs`
Expected: ทุกบรรทัด PASS จบด้วย `ผ่านทุกเคส` (exit 0)

- [ ] **Step 5: Commit**

```bash
git add scripts/check-required-hashtag.mjs lib/required-hashtag.ts
git commit -m "Required hashtag: pure logic (normalize/serialize/suggest/attach-to-entry) with check script"
```

(ลงท้าย commit ด้วยสองบรรทัด attribution ใน Global Constraints)

---

### Task 2: รายการ Showcase พกแฮชแท็ก (TDD)

**Files:**
- Modify: `scripts/check-showcase.mjs` (เพิ่มเคส ก่อนบรรทัด `console.log(failed === 0 …`)
- Modify: `lib/showcase.ts` (`ShowcaseItem`, `buildShowcaseItems`)

**Interfaces:**
- Consumes: ไม่มี (รับ `Map<string, string[]>` ที่ผู้เรียกทำเอง)
- Produces: `ShowcaseItem.hashtags: string[]` (ว่าง = ไม่มี) · `buildShowcaseItems(rows, entryVideoUrls, since?, hashtagsByProduct?)` — พารามิเตอร์ที่ 4 ไม่บังคับ ค่าเริ่มต้น map ว่าง

- [ ] **Step 1: เขียนเคสที่ล้ม**

ใน `scripts/check-showcase.mjs` แทรกก่อน `console.log(failed === 0 ? "\nผ่านทุกเคส"…`:

```js
  // --- แฮชแท็กที่ต้องลง ---
  {
    const withTags = s.buildShowcaseItems(
      [row({ sourceProductId: "P1" }), row({ sourceProductId: "P2" })],
      new Map(),
      SINCE,
      new Map([["P1", ["#a", "#b"]]])
    );
    check("สินค้าที่มีแฮชแท็กได้รายการ", withTags.find((i) => i.sourceProductId === "P1").hashtags, ["#a", "#b"]);
    check("สินค้าที่ไม่มี = รายการว่าง (ไม่ใช่ undefined)", withTags.find((i) => i.sourceProductId === "P2").hashtags, []);
    check("ไม่ส่ง map = ทุกตัวว่าง (เรียกแบบเดิมยังได้)", build([row()])[0].hashtags, []);
    const twoBatches = s.buildShowcaseItems(
      [row({ sourceProductId: "P1", capturedOn: day("09-30") }), row({ sourceProductId: "P1", capturedOn: day("10-02") })],
      new Map(),
      SINCE,
      new Map([["P1", ["#x"]]])
    );
    check("สินค้าเดียว 2 ชุด = รายการเดียว แฮชแท็กเดียว", twoBatches.map((i) => i.hashtags), [["#x"]]);
  }

```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `node scripts/check-showcase.mjs`
Expected: เคสใหม่ FAIL (`hashtags` เป็น `undefined`) เคสเดิมยัง PASS

- [ ] **Step 3: แก้ `lib/showcase.ts`**

ใน type `ShowcaseItem` เพิ่มต่อจาก `flowState`:

```ts
  /** แฮชแท็กที่ต้องลง (CONTEXT.md) ของสินค้านี้ · ว่าง = ไม่ต้องลงอะไร */
  hashtags: string[];
```

เปลี่ยนลายเซ็นของ `buildShowcaseItems` เป็น:

```ts
export function buildShowcaseItems(
  rows: ShowcaseSourceRow[],
  entryVideoUrls: Map<string, string>,
  since: Date = SHOWCASE_TRACKING_SINCE,
  hashtagsByProduct: Map<string, string[]> = new Map()
): ShowcaseItem[] {
```

ใน `items.push({ ... })` เพิ่มต่อจาก `flowState: "busy",`:

```ts
      hashtags: hashtagsByProduct.get(sourceProductId) ?? [],
```

และเพิ่มบรรทัดในคอมเมนต์เหนือฟังก์ชัน: `@param hashtagsByProduct แฮชแท็กที่ต้องลงต่อ sourceProductId (ผู้เรียกอ่านจากตาราง ProductHashtag) — ผูกกับสินค้า ไม่ใช่แถว จึงเหมือนกันทุกชุดที่ส่งซ้ำ`

- [ ] **Step 4: รันให้ผ่าน**

Run: `node scripts/check-showcase.mjs`
Expected: ทุกเคส PASS (เคสเดิมไม่แตก)

- [ ] **Step 5: Commit**

```bash
git add scripts/check-showcase.mjs lib/showcase.ts
git commit -m "Required hashtag: Showcase items carry hashtags per product"
```

---

### Task 3: ตาราง + อ่าน/เขียน DB + server actions

**Files:**
- Modify: `prisma/schema.prisma` (เพิ่ม model ท้ายไฟล์ หลัง `ScannerLink`)
- Create: `prisma/migrations/<timestamp>_add_product_hashtag/migration.sql` (สร้างด้วย prisma)
- Create: `lib/hashtag-queries.ts`
- Modify: `lib/showcase-queries.ts`
- Modify: `lib/flow-queries.ts` (`FlowJobRow`, ตัวสร้าง `jobs`, ฟังก์ชันใหม่)
- Modify: `app/actions.ts` (action 2 ตัว ต่อท้าย `setShowcaseDismissed`)

**Interfaces:**
- Consumes: Task 1 (`normalizeHashtags`, `serializeHashtags`, `parseStoredHashtags`, `hashtagsForEntries`), Task 2 (`buildShowcaseItems` พารามิเตอร์ที่ 4)
- Produces:
  - `loadHashtagsByProduct(productIds?: string[]): Promise<Map<string, string[]>>` (`lib/hashtag-queries.ts`) — อ่านทั้งตาราง (ไม่ส่ง ID) หรือเฉพาะ ID ที่ส่ง · ตารางไม่มี (ยังไม่ migrate) = map ว่าง + log
  - `getRequiredHashtagsByEntry(productIds: Map<string, string>): Promise<Map<string, string[]>>` (`lib/flow-queries.ts`)
  - `FlowJobRow.requiredHashtags: string[]`
  - `setRequiredHashtags(sourceProductIds: string[], text: string): Promise<{ updated: number }>` (throw `Error` ข้อความไทยเมื่อพิมพ์ไม่ผ่าน/ไม่พบสินค้า)
  - `clearRequiredHashtags(sourceProductIds: string[]): Promise<{ cleared: number }>`

- [ ] **Step 1: เพิ่ม model**

ต่อท้าย `model ScannerLink { … }` ใน `prisma/schema.prisma`:

```prisma
/// แฮชแท็กที่ต้องลงตอนปักตะกร้า (CONTEXT.md: Required hashtag) — 1 แถวต่อสินค้า ผูกด้วย sourceProductId
/// ไม่ผูกแถว ProductCandidate (ส่งซ้ำจาก extension = แถวใหม่ทุกครั้ง) · hashtags = รายการที่ normalize แล้ว
/// คั่นด้วยช่องว่าง ("#a #b") ดู lib/required-hashtag.ts · ไม่มีแถว = ไม่ต้องลงอะไร · import ไม่แตะตารางนี้
model ProductHashtag {
  sourceProductId String   @id
  hashtags        String
  updatedAt       DateTime @updatedAt
}
```

- [ ] **Step 2: สร้าง migration กับ DB ทดสอบ**

```bash
cp dev.db dev-test.db && cp dev.db-wal dev-test.db-wal 2>/dev/null; node scripts/enable-wal.mjs dev-test.db
DATABASE_URL="file:./dev-test.db" npx prisma migrate dev --name add_product_hashtag
```

ตรวจว่าผลลัพธ์เขียนว่าใช้ `dev-test.db` (ไม่ใช่ `dev.db`) · ถ้ามันถาม reset ฐานข้อมูล ให้ตอบ no แล้วหยุดรายงาน · ตรวจ `prisma/migrations/*_add_product_hashtag/migration.sql` ว่ามีแค่ `CREATE TABLE "ProductHashtag"` (3 คอลัมน์) ไม่มีคำสั่งอื่น · จากนั้น `npx prisma generate`

หมายเหตุ: ถ้ามี `dev-test.db` เก่าอยู่แล้วให้ใช้ชื่ออื่น (เช่น `dev-test14.db`) แล้วใช้ชื่อนั้นต่อทั้งแผน

- [ ] **Step 3: ตัวอ่านที่ทนตารางหาย**

สร้าง `lib/hashtag-queries.ts`:

```ts
import { prisma } from "@/lib/prisma";
import { parseStoredHashtags } from "@/lib/required-hashtag";

/**
 * แฮชแท็กที่ต้องลงต่อ sourceProductId · ไม่ส่ง productIds = ทั้งตาราง (หน้า Showcase) · มีแถวแต่รายการว่าง = ไม่ใส่ใน map
 * DB ที่ยังไม่ migrate (ไม่มีตาราง ProductHashtag) ต้องไม่ทำให้ /flow กับหน้า entry ล่ม — คืน map ว่างแทน
 * (แบบเดียวกับ FlowActivity ใน lib/flow-queries.ts)
 */
export async function loadHashtagsByProduct(productIds?: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (productIds !== undefined && productIds.length === 0) return map;
  const rows = await prisma.productHashtag
    .findMany({
      where: productIds === undefined ? undefined : { sourceProductId: { in: productIds } },
      orderBy: { updatedAt: "desc" },
      select: { sourceProductId: true, hashtags: true },
    })
    .catch((e: unknown) => {
      console.error("อ่าน ProductHashtag ไม่ได้ (ยังไม่ได้ migrate?):", e instanceof Error ? e.message : e);
      return [] as { sourceProductId: string; hashtags: string }[];
    });
  for (const r of rows) {
    const tags = parseStoredHashtags(r.hashtags);
    if (tags.length > 0) map.set(r.sourceProductId, tags);
  }
  return map;
}
```

- [ ] **Step 4: หน้า Showcase อ่านแฮชแท็ก**

ใน `lib/showcase-queries.ts` เพิ่ม `import { loadHashtagsByProduct } from "@/lib/hashtag-queries";` แล้วแก้ `getShowcaseItems` ให้ดึงคู่ขนานกับ `rows`:

```ts
  const [rows, hashtagsByProduct] = await Promise.all([
    prisma.productCandidate.findMany({
      // (where/include เดิมคงไว้ทุกบรรทัด)
    }),
    loadHashtagsByProduct(),
  ]);
```

และเปลี่ยน `buildShowcaseItems(` ให้ส่ง `hashtagsByProduct` เป็นอาร์กิวเมนต์ที่ 4 ต่อจาก `SHOWCASE_TRACKING_SINCE`

- [ ] **Step 5: `/flow` และ entry**

ใน `lib/flow-queries.ts`:

1. `import { loadHashtagsByProduct } from "@/lib/hashtag-queries";` และ `import { hashtagsForEntries } from "@/lib/required-hashtag";`
2. ใน `FlowJobRow` ต่อจาก `productId: string | null;` เพิ่ม:
   ```ts
   /** แฮชแท็กที่ต้องลงของสินค้าจาก Showcase (ว่าง = ไม่ต้องลงอะไร หรือไม่ได้มาจาก Showcase) */
   requiredHashtags: string[];
   ```
3. ฟังก์ชันใหม่ต่อจาก `getProductIdsByEntry`:
   ```ts
   /**
    * แฮชแท็กที่ต้องลงของแต่ละ entry — ผ่านสินค้า Showcase ที่ผูกอยู่ (รับ map entry→Product ID จาก getProductIdsByEntry
    * ไม่คิวรีซ้ำ) · entry ที่ไม่มีแฮชแท็กไม่อยู่ใน map
    */
   export async function getRequiredHashtagsByEntry(productIds: Map<string, string>): Promise<Map<string, string[]>> {
     const tagsByProduct = await loadHashtagsByProduct([...new Set(productIds.values())]);
     return hashtagsForEntries(productIds, tagsByProduct);
   }
   ```
4. ในฟังก์ชันที่สร้าง `jobs` (หลัง `const [tookOverIds, productIds, shopPhotos] = await Promise.all([...])`) เพิ่ม `const requiredHashtags = await getRequiredHashtagsByEntry(productIds);` และในอ็อบเจ็กต์ของแต่ละงาน ต่อจาก `productId: productIds.get(j.entryId) ?? null,` เพิ่ม `requiredHashtags: requiredHashtags.get(j.entryId) ?? [],`

ใน `app/entry/[id]/page.tsx`: เพิ่ม `getRequiredHashtagsByEntry` ใน import จาก `@/lib/flow-queries` และหลังบล็อก `Promise.all` เดิมเพิ่ม

```ts
  const requiredHashtags = (await getRequiredHashtagsByEntry(productIds)).get(id) ?? [];
```

(ก่อน `if (entry === null) notFound();` หรือหลังก็ได้ แต่ต้องอยู่หลัง `productIds` ถูกกำหนด) และส่ง `requiredHashtags={requiredHashtags}` ให้ `<EntryWorkspace … />` (คอมโพเนนต์ยังไม่รับ prop นี้จน Task 5 — tsc จะฟ้องจนถึงตอนนั้น ให้ทำขั้นนี้รวมกับ Task 5 ถ้าต้องการ commit ที่ tsc ผ่าน)

- [ ] **Step 6: server actions**

ใน `app/actions.ts` เพิ่ม `import { normalizeHashtags, serializeHashtags } from "@/lib/required-hashtag";` ใกล้ import อื่นของ `@/lib/*` และต่อท้ายฟังก์ชัน `setShowcaseDismissed` (ก่อนคอมเมนต์ของ `importShowcaseBatch`):

```ts
/** ID ที่เป็นสินค้า Showcase จริง (มีแถว ProductCandidate ที่มี sourceProductId) — อันอื่นข้ามเงียบๆ */
async function existingShowcaseProductIds(ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids.map((i) => i.trim()).filter((i) => i !== ""))];
  if (unique.length === 0) return [];
  const rows = await prisma.productCandidate.findMany({
    where: { sourceProductId: { in: unique } },
    select: { sourceProductId: true },
    distinct: ["sourceProductId"],
  });
  return rows.flatMap((r) => (r.sourceProductId === null ? [] : [r.sourceProductId]));
}

/** แฮชแท็กโผล่ที่ 3 หน้า: รายการ Showcase, งานใน /flow, หน้า entry (ไม่รู้ว่า entry ไหนบ้าง จึง revalidate ทั้งแพตเทิร์น) */
function revalidateHashtagViews(): void {
  revalidatePath("/showcase");
  revalidatePath("/flow");
  revalidatePath("/entry/[id]", "page");
}

/**
 * หน้า Showcase: ใส่ "แฮชแท็กที่ต้องลง" (CONTEXT.md) ให้สินค้าหลายตัวพร้อมกัน — **ทับ**ของเดิม · ผูกด้วย sourceProductId
 * (ไม่ใช่ id ของแถว) · พิมพ์ไม่ผ่าน (ว่าง/ยาวเกิน/เกิน 10 อัน) = throw ข้อความไทย ไม่เขียนอะไร · คืนจำนวนสินค้าที่ใส่จริง
 */
export async function setRequiredHashtags(sourceProductIds: string[], text: string): Promise<{ updated: number }> {
  const parsed = normalizeHashtags(text);
  if (!parsed.ok) throw new Error(parsed.message);
  const ids = await existingShowcaseProductIds(sourceProductIds);
  if (ids.length === 0) throw new Error("ไม่พบสินค้าที่เลือก");
  const value = serializeHashtags(parsed.tags);
  await prisma.$transaction(
    ids.map((sourceProductId) =>
      prisma.productHashtag.upsert({
        where: { sourceProductId },
        create: { sourceProductId, hashtags: value },
        update: { hashtags: value },
      })
    )
  );
  revalidateHashtagViews();
  return { updated: ids.length };
}

/** ปุ่ม "ลบแฮชแท็ก" — ลบแถวของสินค้าที่เลือก (ช่องพิมพ์ว่างไม่ใช่การลบ) · คืนจำนวนที่ลบจริง */
export async function clearRequiredHashtags(sourceProductIds: string[]): Promise<{ cleared: number }> {
  const ids = await existingShowcaseProductIds(sourceProductIds);
  if (ids.length === 0) throw new Error("ไม่พบสินค้าที่เลือก");
  const r = await prisma.productHashtag.deleteMany({ where: { sourceProductId: { in: ids } } });
  revalidateHashtagViews();
  return { cleared: r.count };
}
```

- [ ] **Step 7: ตรวจ type**

Run: `npx tsc --noEmit`
Expected: ผ่าน ยกเว้นที่ค้างจาก `requiredHashtags` prop ของ `EntryWorkspace` (ถ้ายังไม่ทำ Task 5) · ถ้าทำ Step 5 ส่วนหน้า entry รวมกับ Task 5 แล้ว ต้องผ่านทั้งหมด

- [ ] **Step 8: Commit**

```bash
git status --short   # ต้องไม่มี dev.db / dev-test*.db ใน staged
git add prisma/schema.prisma prisma/migrations lib/hashtag-queries.ts lib/showcase-queries.ts lib/flow-queries.ts app/actions.ts
git commit -m "Required hashtag: ProductHashtag table, readers tolerant of unmigrated DB, set/clear server actions"
```

---

### Task 4: หน้า `/showcase` — ติ๊กเลือก + ใส่/ลบแฮชแท็ก + ป้าย

**Files:**
- Modify: `components/showcase-route.tsx`

**Interfaces:**
- Consumes: Task 1 (`suggestHashtags`), Task 2 (`item.hashtags`), Task 3 (`setRequiredHashtags`, `clearRequiredHashtags`)
- Produces: ไม่มี (UI ปลายทาง)

- [ ] **Step 1: import และ state**

เพิ่ม import:

```ts
import { clearRequiredHashtags, setRequiredHashtags } from "@/app/actions";  // รวมเข้า import จาก "@/app/actions" เดิม
import { suggestHashtags } from "@/lib/required-hashtag";
```

(รวม `clearRequiredHashtags`, `setRequiredHashtags` เข้า block `import { … } from "@/app/actions"` ที่มีอยู่ ไม่ import ซ้ำสองบล็อก)

ใน `ShowcaseRoute` ต่อจาก `const [pending, startTransition] = useTransition();` เพิ่ม:

```ts
  // ติ๊กเลือกสินค้า (sourceProductId) เพื่อใส่แฮชแท็กที่ต้องลงทีเดียวหลายตัว · เปลี่ยนแท็บ = ล้าง ไม่งั้นจะใส่ให้ตัวที่มองไม่เห็น
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [hashtagText, setHashtagText] = useState("");
  const suggestions = useMemo(() => suggestHashtags(items.map((i) => i.hashtags)), [items]);
```

และเปลี่ยน `onClick={() => setTab(t)}` ของปุ่มแท็บเป็น

```tsx
            onClick={() => {
              setTab(t);
              setSelected(new Set());
            }}
```

เพิ่มฟังก์ชันต่อจาก `dismiss`:

```ts
  function toggle(sourceProductId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sourceProductId)) next.delete(sourceProductId);
      else next.add(sourceProductId);
      return next;
    });
  }

  function applyHashtags() {
    setMessage(null);
    startTransition(async () => {
      try {
        const { updated } = await setRequiredHashtags([...selected], hashtagText);
        setMessage({ tone: "ok", text: `ใส่แฮชแท็กที่ต้องลงให้ ${updated} สินค้าแล้ว` });
        // ล้างทั้งช่องพิมพ์และที่เลือก — ค่าเก่าค้างแล้วไปใช้กับชุดถัดไปโดยไม่ตั้งใจอันตรายกว่ากดเลือกใหม่
        setHashtagText("");
        setSelected(new Set());
      } catch (e) {
        setMessage({ tone: "error", text: e instanceof Error ? e.message : "ใส่แฮชแท็กไม่สำเร็จ" });
      }
    });
  }

  function removeHashtags() {
    setMessage(null);
    startTransition(async () => {
      try {
        const { cleared } = await clearRequiredHashtags([...selected]);
        setMessage({ tone: "ok", text: cleared > 0 ? `ลบแฮชแท็กของ ${cleared} สินค้าแล้ว` : "สินค้าที่เลือกยังไม่มีแฮชแท็กให้ลบ" });
        setSelected(new Set());
      } catch (e) {
        setMessage({ tone: "error", text: e instanceof Error ? e.message : "ลบแฮชแท็กไม่สำเร็จ" });
      }
    });
  }
```

- [ ] **Step 2: แถบเครื่องมือเหนือรายการ**

ในสาขา `visible.length === 0 ? … : (` ให้ห่อเป็น fragment และใส่แถบนี้ก่อน `<ul …>`:

```tsx
        <>
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSelected(new Set(visible.map((i) => i.sourceProductId)))}
                disabled={pending}
              >
                เลือกทั้งหมดในแท็บนี้
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setSelected(new Set())} disabled={pending || selected.size === 0}>
                ไม่เลือกเลย
              </Button>
              <span className="text-sm leading-relaxed text-muted-foreground" role="status">
                เลือกอยู่ <span className="font-mono">{selected.size}</span> จาก <span className="font-mono">{visible.length}</span>
              </span>
            </div>
            {selected.size > 0 && (
              <div className="flex flex-col gap-2">
                <label htmlFor="required-hashtag-input" className="text-sm leading-relaxed font-medium text-foreground">
                  แฮชแท็กที่ต้องลง (หลายอันเว้นวรรคหรือคั่นด้วยจุลภาค)
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    id="required-hashtag-input"
                    type="text"
                    value={hashtagText}
                    onChange={(e) => setHashtagText(e.target.value)}
                    placeholder="#trendyselected"
                    autoComplete="off"
                    className="h-11 min-w-0 flex-1 rounded-lg border border-border-interactive bg-background px-3 text-sm lg:h-9"
                  />
                  <Button type="button" onClick={applyHashtags} disabled={pending || hashtagText.trim() === ""}>
                    ใส่แฮชแท็ก
                  </Button>
                  <Button type="button" variant="outline" onClick={removeHashtags} disabled={pending}>
                    ลบแฮชแท็ก
                  </Button>
                </div>
                {suggestions.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs leading-relaxed text-muted-foreground">ที่เคยใช้:</span>
                    {suggestions.map((tag) => (
                      <Button key={tag} type="button" variant="outline" size="xs" onClick={() => setHashtagText(tag)} disabled={pending}>
                        {tag}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <ul …>  (รายการเดิม)
        </>
```

(ปิด fragment หลัง `</ul>` ก่อน `)}` เดิม)

- [ ] **Step 3: ช่องติ๊กและป้ายในแต่ละแถว**

ในแต่ละ `<li>` ก่อนบล็อกรูป (`{cover ? (`) เพิ่มช่องติ๊ก (กดได้ทั้งบล็อก ≥ 44px):

```tsx
                <label className="flex size-11 shrink-0 cursor-pointer items-center justify-center lg:size-9">
                  <input
                    type="checkbox"
                    checked={selected.has(item.sourceProductId)}
                    onChange={() => toggle(item.sourceProductId)}
                    aria-label={`เลือก ${item.name}`}
                    className="size-5 accent-primary"
                  />
                </label>
```

และในคอลัมน์ข้อความ (`<div className="flex min-w-0 flex-1 flex-col gap-0.5">`) ต่อท้ายหลัง `<p …>` ราคา/ค่าคอมเดิม:

```tsx
                  {item.hashtags.length > 0 && (
                    <p className="flex flex-wrap items-center gap-1 text-xs leading-relaxed">
                      <span className="text-muted-foreground">แฮชแท็กที่ต้องลง</span>
                      {item.hashtags.map((tag) => (
                        <span key={tag} className="rounded-md bg-surface-2 px-2 py-0.5 text-foreground">
                          {tag}
                        </span>
                      ))}
                    </p>
                  )}
```

(ต้องเห็นป้ายด้วยตัวอักษรบนทุกขนาดจอ ไม่พึ่ง hover)

- [ ] **Step 4: ตรวจ type + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: ผ่าน (ไม่มี error ใหม่; warning เดิมของ repo ไม่นับ) · ตรวจ `grep -rn -E '\b(bg|text|border|ring|fill|stroke|from|to|via)-(teal|paper|ink|smoke|amber|danger)\b' components app lib` ต้องว่าง

- [ ] **Step 5: Commit**

```bash
git add components/showcase-route.tsx
git commit -m "Required hashtag: multi-select + set/remove controls and badge on /showcase"
```

---

### Task 5: ป้ายที่หัวงาน `/flow` และหน้า entry (พร้อมปุ่มคัดลอก)

**Files:**
- Create: `components/required-hashtag-copy.tsx`
- Modify: `components/flow-job-detail.tsx` (บรรทัด ~217)
- Modify: `components/entry-workspace.tsx` (props ~93–103, บล็อก ~273)
- Modify: `app/entry/[id]/page.tsx` (ถ้ายังไม่ได้ทำใน Task 3 Step 5)

**Interfaces:**
- Consumes: Task 3 (`FlowJobRow.requiredHashtags`, `getRequiredHashtagsByEntry`)
- Produces: `RequiredHashtagCopy({ hashtags }: { hashtags: string[] })`

- [ ] **Step 1: คอมโพเนนต์**

สร้าง `components/required-hashtag-copy.tsx` (รูปแบบเดียวกับ `ProductIdCopy`):

```tsx
"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";

import { copyInBrowser } from "@/lib/clipboard";
import { Button } from "@/components/ui/button";

/**
 * แฮชแท็กที่ต้องลง (CONTEXT.md) ของสินค้าจาก Showcase พร้อมปุ่มคัดลอกทั้งหมดเว้นวรรค — ไว้ดูตอนปักตะกร้า
 * ไม่มีแฮชแท็ก = ผู้เรียกไม่ render คอมโพเนนต์นี้เลย (ว่าง = ไม่ต้องลงอะไร)
 */
export function RequiredHashtagCopy({ hashtags }: { hashtags: string[] }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(t);
  }, [state]);
  async function copy() {
    setState((await copyInBrowser(hashtags.join(" "))) === "manual" ? "failed" : "copied");
  }
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-relaxed text-muted-foreground">
      <span>แฮชแท็กที่ต้องลง</span>
      {hashtags.map((tag) => (
        <code key={tag} className="rounded-md bg-surface-2 px-2 py-0.5 text-sm text-foreground select-all">
          {tag}
        </code>
      ))}
      <Button type="button" size="xs" variant="outline" aria-label="คัดลอกแฮชแท็กที่ต้องลง" onClick={copy}>
        {state === "copied" ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />} คัดลอก
      </Button>
      <span role="status">
        {state === "copied" ? "คัดลอกแล้ว" : state === "failed" ? "คัดลอกไม่ได้ — เลือกข้อความแล้วกด Ctrl+C" : ""}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: หัวงาน `/flow`**

ใน `components/flow-job-detail.tsx` เพิ่ม `import { RequiredHashtagCopy } from "@/components/required-hashtag-copy";` ข้าง import `ProductIdCopy` และต่อจากบรรทัด `{job.productId !== null && <ProductIdCopy productId={job.productId} />}` เพิ่ม:

```tsx
            {job.requiredHashtags.length > 0 && <RequiredHashtagCopy hashtags={job.requiredHashtags} />}
```

- [ ] **Step 3: หน้า entry**

ใน `components/entry-workspace.tsx`: import `RequiredHashtagCopy`; ในรายการ props เพิ่ม `requiredHashtags = [],` ต่อจาก `productId = null,` และในชนิดของ props เพิ่ม

```ts
  /** แฮชแท็กที่ต้องลงของสินค้าจาก Showcase (ว่าง = ไม่แสดง) */
  requiredHashtags?: string[];
```

แก้บล็อก Product ID (บรรทัด ~273) ให้เป็น:

```tsx
      {(productId !== null || requiredHashtags.length > 0) && (
        <div className="mx-4 mt-3 flex flex-col gap-1.5 sm:mx-6">
          {productId !== null && <ProductIdCopy productId={productId} />}
          {requiredHashtags.length > 0 && <RequiredHashtagCopy hashtags={requiredHashtags} />}
        </div>
      )}
```

ตรวจว่า `app/entry/[id]/page.tsx` ส่ง `requiredHashtags` ให้แล้ว (Task 3 Step 5)

- [ ] **Step 4: ตรวจ type + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: ผ่านทั้งหมด

- [ ] **Step 5: Commit**

```bash
git add components/required-hashtag-copy.tsx components/flow-job-detail.tsx components/entry-workspace.tsx "app/entry/[id]/page.tsx"
git commit -m "Required hashtag: badge with copy button on /flow job header and entry page"
```

---

### Task 6: ตรวจจริงบนสำเนา DB + เอกสาร

**Files:**
- Modify: `docs/agents/showcase.md` (หัวข้อใหม่ท้ายส่วน `/showcase` กับ `/products`)

**Interfaces:** ไม่มี

- [ ] **Step 1: เอกสาร**

ใน `docs/agents/showcase.md` ต่อท้ายหัวข้อ "หน้า `/showcase` กับ `/products`" (ก่อน "ทำคลิปตัวนี้") เพิ่ม bullet:

```md
- **แฮชแท็กที่ต้องลง (Required hashtag, 2026-10-10)** — ผู้ใช้ติ๊กหลายตัวใน `/showcase` แล้วพิมพ์ครั้งเดียว (`setRequiredHashtags` ทับของเดิม / `clearRequiredHashtags` ปุ่มลบแยก — ช่องว่างไม่ใช่การลบ) · เก็บตาราง `ProductHashtag` ผูก `sourceProductId` (ไม่ผูกแถว `ProductCandidate` เพราะส่งซ้ำได้แถวใหม่ทุกชุด) · **`importShowcaseBatch`/`/api/scanner`/extension ไม่รู้จักตารางนี้เลย — สแกนซ้ำจึงไม่ทับ** (อย่าเพิ่มให้ import แตะ) · ตรรกะ pure (แปลงข้อความ เติม `#` แยก `#a#b` ตัดซ้ำไม่สนตัวพิมพ์ จำกัด 10 อัน/100 ตัว) อยู่ `lib/required-hashtag.ts` ตรวจด้วย `node scripts/check-required-hashtag.mjs` · โชว์ป้ายที่ `/showcase`, หัวงาน `/flow` และหน้า entry (`RequiredHashtagCopy` ผ่าน `getRequiredHashtagsByEntry` ต่อจาก `getProductIdsByEntry`) — **ไม่เขียนลง `โพสต์.txt` และไม่เติมลง `hashtags` ของ entry เอง** (ผู้ใช้ไม่ใช้ไฟล์นั้น) · ตารางไม่มี (ยังไม่ migrate) อ่านแล้วคืนว่าง + log ไม่ทำให้ `/flow`/entry ล่ม · **ไม่เก็บว่าสินค้า "เป็นของกิจกรรม" หรือไม่** — ข้อมูลไม่พอวิเคราะห์ เงื่อนไขกลับมาคิดดู `docs/research/2026-10-10-campaign-flag-for-analysis.md`
```

- [ ] **Step 2: รันชุดตรวจทั้งหมด**

Run: `node scripts/check-required-hashtag.mjs && node scripts/check-showcase.mjs && node scripts/check-showcase-import.mjs && npx tsc --noEmit && npm run lint`
Expected: ผ่านหมด · แล้ว `git diff tsconfig.json` ต้องว่าง

- [ ] **Step 3: เปิดแอปบนสำเนา พอร์ต 3001**

```bash
NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001
```

(รันเบื้องหลัง) · ใน `dev-test.db` ต้องมีสินค้า Showcase อย่างน้อย 3 ตัวในแท็บ "ยังไม่เริ่ม" ถ้าไม่มี ให้ลองแท็บอื่น หรือเตรียมแถวทดสอบด้วยการ POST ไป `/api/scanner?token=<token จากตาราง ScannerLink ของ dev-test.db>` ด้วย payload ตัวอย่างใน `showcase-extension/docs/INTEGRATION.md` (ใช้ `productId` ปลอมที่ขึ้นต้น `TEST-`, `capturedOn` จะเป็นวันนี้ จึงผ่านวันเริ่มนับ) · ทุกอย่างที่ทดสอบเขียนลง `dev-test.db` เท่านั้น

ตรวจด้วย Playwright (หรือ `node scripts/shot.mjs`) และตา:
1. ติ๊ก 2 ตัว → แถบใส่แฮชแท็กโผล่ · พิมพ์ `trendyselected` กด "ใส่แฮชแท็ก" → ข้อความ "ใส่แฮชแท็กที่ต้องลงให้ 2 สินค้าแล้ว", ป้าย `#trendyselected` ขึ้นทั้งสองแถว, ช่องพิมพ์และที่เลือกถูกล้าง
2. ติ๊กตัวเดียวพิมพ์ `#a#b` → ได้ `#a` `#b` สองป้าย (ทับของเดิม)
3. ช่องพิมพ์ว่าง/`#` เดี่ยว → ปุ่มใส่ถูกปิด/ขึ้นข้อความปฏิเสธ ไม่ลบอะไร · กด "ลบแฮชแท็ก" → ป้ายหาย
4. ติ๊กไว้แล้วสลับแท็บ → ที่เลือกหาย (Review Focus 5)
5. **สแกนซ้ำ (Review Focus 3):** ใส่แฮชแท็กให้สินค้า `TEST-…` แล้ว POST payload เดิมซ้ำไป `/api/scanner` → รีเฟรช `/showcase` แฮชแท็กต้องยังอยู่ และไม่มีรายการซ้ำ
6. กด "ทำคลิปตัวนี้" กับสินค้าทดสอบที่มีแฮชแท็ก (ใช้รูปไฟล์เล็กๆ) → `/flow` หัวงานและ `/entry/<id>` ต้องเห็น "แฮชแท็กที่ต้องลง … คัดลอก" และปุ่มคัดลอกใช้ได้ · งานที่ไม่ได้มาจาก Showcase ไม่มีแถบนี้
7. **ตารางหาย (Review Focus 4):** หยุด dev server, ก๊อป `dev.db` เป็น `dev-test-old.db` ใหม่ (ไม่ migrate) เปิดอีกครั้งด้วย `DATABASE_URL="file:./dev-test-old.db"` → `/flow` และ `/entry/<id>` ต้องเปิดได้ (เห็น log "อ่าน ProductHashtag ไม่ได้" ใน terminal) ไม่ล่ม
8. ถ่ายภาพ `/showcase` (มีแถบเลือก + ป้าย) ที่ 390 / 820 / 1440px ด้วย `node scripts/shot.mjs <outDir>` (`PW_ROOT`=root ของ repo, `ENTRY_ID`=cuid จริงจาก `dev-test.db`) — ต้องไม่สกรอลแนวนอน · 1440px ดูเหมือนเดิมนอกจากช่องติ๊ก/แถบใหม่ · ต่ำกว่า 1024px ใช้ `hasTouch: true` และปุ่ม/ช่องติ๊กแตะง่าย

- [ ] **Step 4: เก็บกวาด**

หยุด dev server ของตัวเอง: `netstat -ano | grep ':3001' | grep LISTENING` แล้ว `taskkill //PID <pid> //F` · ลบเฉพาะแถวทดสอบที่ตัวเองสร้างใน **สำเนา** ถ้าต้องการ (`DELETE … WHERE sourceProductId LIKE 'TEST-%'`) · ห้ามแตะ `dev.db` · `git status` ต้องไม่มี `dev-test*.db` ใหม่ติด staged (ไฟล์ untracked ที่มีอยู่แล้วปล่อยไว้)

- [ ] **Step 5: Commit**

```bash
git add docs/agents/showcase.md
git commit -m "Docs: Required hashtag in showcase agent doc"
```

- [ ] **Step 6: รีวิวและส่งต่อให้ผู้ใช้**

ส่ง diff ของ branch (`git diff master…required-hashtag`) ให้ reviewer สดหนึ่งตัวอ่าน เทียบกับสเปก (ให้แค่โค้ดกับสเปก ไม่ใส่ข้อสรุปของเรา) แก้ที่พบ แล้วรายงานผู้ใช้เป็นภาษาธรรมดาว่าเปลี่ยนอะไร ดูตรงไหนบนหน้าจอ และบอกคำสั่งที่ผู้ใช้ต้องรันเอง (ห้ามรันแทน):

```
! cd C:\Users\patip\Desktop\playground\tts_assistant\pooling\pooling_prompt
! stop.bat
! npx prisma migrate deploy
! npx prisma generate
! rm -rf .next
! start.bat
```

(หลัง merge `required-hashtag` เข้า `master` — ดู CLAUDE.md หัวข้อ "หลัง merge branch ที่แก้ schema")

---

## Self-Review

- **Spec coverage:** เลือกหลายแถว/เลือกทั้งแท็บ/ล้างที่เลือก/นับ (Task 4) · พิมพ์ไม่/มี `#`, หลายอัน, ตัดซ้ำ, ตัวพิมพ์ล่าสุด (Task 1) · ทับ + ปุ่มลบแยก + ว่างไม่ลบ (Task 1, 3, 4) · ล้างช่องหลังใส่ (Task 4) · ตัวเลือกที่เคยพิมพ์จากของที่มี (Task 1, 4) · ทุกแท็บ (Task 4: แถบอยู่ทุกแท็บที่มีรายการ) · ป้ายที่ `/showcase`/`/flow`/entry + ปุ่มคัดลอกที่ `/flow`/entry (Task 4, 5) · entry ที่ไม่มาจาก Showcase ไม่แสดง (Task 1 `hashtagsForEntries`, Task 5 เงื่อนไข) · ส่งซ้ำไม่ทับ (ไม่แตะ import + ขั้นตรวจ Task 6.5) · ผูกกับสินค้า ไม่ใช่แถว (Task 3 schema) · dismissed → กู้คืนแล้วแฮชแท็กยังอยู่ (ผูก `sourceProductId`, ไม่เกี่ยวกับ `dismissedAt`) · สินค้าเก่าก่อน 29 ก.ย. ไม่อยู่ใน `/showcase` จึงไม่มีที่ใส่ (ไม่มีโค้ด) · ไม่แตะ extension/`โพสต์.txt` (Global Constraints) · เอกสาร (Task 6)
- **Placeholder scan:** ไม่มี TBD · ขั้นที่บอกให้ "รวม import เดิม" ระบุไฟล์/บล็อกชัดเจน
- **Type consistency:** `normalizeHashtags`/`serializeHashtags`/`parseStoredHashtags`/`suggestHashtags`/`hashtagsForEntries`, `loadHashtagsByProduct`, `getRequiredHashtagsByEntry`, `FlowJobRow.requiredHashtags`, `ShowcaseItem.hashtags`, `setRequiredHashtags`/`clearRequiredHashtags`, `RequiredHashtagCopy` — ชื่อและลายเซ็นตรงกันทุก task
- **Review Focus:** 5 ข้อ ผูกกับ task ที่รับผิดชอบแล้ว (1–2 Task 1, 3 Task 6.5, 4 Task 3 + Task 6.7, 5 Task 4 + Task 6.4)
