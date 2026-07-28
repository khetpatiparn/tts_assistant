# Sidebar Search and Scannability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** แก้บั๊กค้นหาหลายคำที่คืนผลว่างเสมอ จัดผลค้นหาเป็นชั้นตามความน่าเชื่อถือ และทำให้แต่ละแถวในแถบข้างแยกออกจากกันได้ด้วยรูปสินค้า+ชื่อ 2 บรรทัด

**Architecture:** ตรรกะค้นหาทั้งหมดถูกแยกออกจาก `history-rail.tsx` ไปเป็น pure function ใน `lib/entry-search.ts` เพื่อให้ทดสอบได้ด้วยสคริปต์ node (โปรเจกต์ไม่มี test runner) · `history-rail.tsx` เหลือหน้าที่แสดงผลอย่างเดียว · การกดการ์ดคำแนะนำใช้แบบแผน callback เดิมที่ `prompt-workspace.tsx` มีอยู่แล้ว (`setSelectedId` + `setTab("brief")` แบบเดียวกับ `handleDuplicate`)

**Tech Stack:** Next.js 16.2.10 (custom build) · React 19 · Tailwind v4 CSS-first · lucide-react v1.23.0 · Prisma 7 + SQLite (อ่านอย่างเดียวในงานนี้ ไม่แก้ schema)

**Spec:** `docs/superpowers/specs/2026-07-28-sidebar-search-and-scan-design.md`

## Global Constraints

- **ห้ามรัน `npm run build` หรือ `npm run dev` บนพอร์ต 3000** — ผู้ใช้รัน `start.bat` อยู่และใช้แอปทำงานหาเงินจริงทุกวัน ใช้ `npx tsc --noEmit` แทน build · ถ้าต้องรันแอปให้ใช้ isolated dev server เท่านั้น: `cp dev.db dev-test.db` แล้ว `NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001` แล้ว cleanup ด้วย `rm -rf .next-dev dev-test.db`
- **ห้ามแตะ `dev.db` ตัวจริงในการทดสอบที่มีการเขียน** — อ่านแบบ `readonly: true` ได้
- **ไม่มี test runner และไม่มี `tsx` ในโปรเจกต์ ห้ามติดตั้งเพิ่ม** — ทดสอบ pure function ด้วยการคอมไพล์ไฟล์เดียวไป scratch แล้วรันด้วย node: `npx tsc <file> --outDir "<scratch>/build" --module commonjs --target ES2017 --skipLibCheck`
- **สคริปต์ทดสอบต้องเขียนเป็นไฟล์ `.js` จริงด้วย Write tool ในโฟลเดอร์ scratch** (ห้าม `node -e "..."` ผ่าน bash — git-bash แปลง path จนพัง) และ `require()` ด้วย absolute path เข้า `node_modules` ของ repo
- **ห้าม emoji** ทุกที่ · ข้อความ UI เป็นภาษาไทย
- **ใช้ design token เดิมเท่านั้น**: `ink` `ink-2` `paper` `marigold` `rust` `smoke` `record` `border` `card` `muted-foreground` `foreground` `background` `primary-foreground` — ห้ามเพิ่มสีใหม่ (ตรวจแล้ว `ink-2` มีจริงใน `app/globals.css:15`)
- **ไอคอน lucide ต้องชื่อ canonical** — ต้องเปิดไฟล์ `node_modules/lucide-react/dist/esm/icons/<kebab-name>.mjs` เช็กก่อนใช้ทุกครั้ง
- **ห้ามใช้ `next/image`** — route เสิร์ฟรูปเป็นไฟล์ตรงอยู่แล้ว และโค้ดเดิมใน `brief-form.tsx` ใช้ `<img>` พร้อม `eslint-disable-next-line @next/next/no-img-element` เป็นแบบแผน
- **Layout เป็น fixed-viewport-with-internal-scroll** — แถบข้างมี `lg:h-full` และรายการอยู่ใน `overflow-y-auto` การเพิ่มความสูงแถวต้องไม่ทำให้ chain นี้พัง
- **`git diff tsconfig.json` ต้องว่างก่อน commit ทุกครั้ง** (dev server แก้ไฟล์นี้เองได้ — repo pin `target: "ES2017"` ไว้ตั้งใจ) ถ้าไม่ว่างให้ `git checkout -- tsconfig.json`
- **ห้าม `git add -A`** — ระบุไฟล์ที่แก้เสมอ
- ทำงานบน branch `feature/sidebar-search-and-scan` (สร้างแล้ว spec commit อยู่บนนั้น)
- **ห้ามแตะ `lib/recommender.ts` · `lib/angle.ts` · `lib/dashboard.ts` · `lib/weekly-scoreboard.ts` · `lib/entry-sort.ts`**

---

### Task 1: `lib/entry-search.ts` — ตรรกะค้นหา (pure)

**Files:**
- Create: `lib/entry-search.ts`
- Create (scratch, ไม่ commit): `<scratch>/test-search.js`

**Interfaces:**
- Consumes: ไม่มี (pure ล้วน รับ shape แคบๆ เป็น argument)
- Produces (Task 2 ใช้ต่อ):
  - `type SearchableEntry = { productName: string; productInfo: string; extraNotes: string }`
  - `type MatchTier = "name" | "notes" | "info"`
  - `function splitTerms(query: string): string[]`
  - `function matchTier<T extends SearchableEntry>(entry: T, terms: string[]): MatchTier | null`

**บริบทที่ต้องรู้:**

ตรรกะปัจจุบันอยู่ใน `components/history-rail.tsx` ฟังก์ชัน `matchesQuery` (บรรทัด 23-29) — เอาคำค้นทั้งประโยคไปหาเป็น substring เดียว ทำให้พิมพ์เว้นวรรคแล้วได้ 0 เสมอ

`riskModule` **ไม่ถูกค้นโดยตั้งใจ** — มีคอมเมนต์อธิบายไว้แล้วที่บรรทัด 19-22 ว่าเนื้อหาเป็นวลีซ้ำทั่วไป ("พับได้"/"มีกลไก") ที่ใช้ร่วมกันหลายสิบรายการ **ห้ามเพิ่มเข้ามา**

**กฎการจัดชั้น** (สำคัญ พลาดง่าย) — จัดตาม**ฟิลด์ที่อ่อนที่สุดที่จำเป็นต้องใช้** แต่ละรายการอยู่ได้ชั้นเดียว:
1. ทุกคำอยู่ใน `productName` → `"name"`
2. ไม่เข้าข้อ 1 แต่ทุกคำอยู่ใน `productName + extraNotes` รวมกัน → `"notes"`
3. ไม่เข้าข้อ 1-2 แต่ทุกคำอยู่ในทั้งสามฟิลด์รวมกัน → `"info"`
4. ไม่เข้าเลย → `null`

- [ ] **Step 1: เขียนสคริปต์ทดสอบที่ยังไม่ผ่าน**

เขียนไฟล์ `<scratch>/test-search.js` ด้วย Write tool (แทน `<scratch>` ด้วย scratchpad dir ของเซสชัน):

```js
const { splitTerms, matchTier } = require("<scratch>/build/entry-search.js");

let failed = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label} — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
}

// ---------- splitTerms ----------
eq("คำเดียว", splitTerms("แมว"), ["แมว"]);
eq("สองคำ", splitTerms("ที่นอน แมว"), ["ที่นอน", "แมว"]);
eq("เว้นวรรคหน้าหลัง", splitTerms("  แมว  "), ["แมว"]);
eq("เว้นวรรคหลายช่อง", splitTerms("ที่นอน    แมว"), ["ที่นอน", "แมว"]);
eq("ค่าว่าง", splitTerms(""), []);
eq("มีแต่ช่องว่าง", splitTerms("   "), []);
eq("ตัวพิมพ์ใหญ่ถูกลดเป็นเล็ก", splitTerms("BMZAR Petlusci"), ["bmzar", "petlusci"]);

// ---------- matchTier ----------
const e = (name, info = "", notes = "") => ({ productName: name, productInfo: info, extraNotes: notes });

eq("ไม่มีคำค้น -> null", matchTier(e("อะไรก็ได้"), []), null);
eq("ตรงชื่อ คำเดียว", matchTier(e("ที่นอนแมว"), ["แมว"]), "name");
eq("ตรงชื่อ สองคำติดกัน", matchTier(e("ที่นอนแมว"), ["ที่นอน", "แมว"]), "name");
eq("ตรงชื่อ สองคำสลับลำดับ", matchTier(e("ที่นอนแมว"), ["แมว", "ที่นอน"]), "name");
eq("ไม่เจอเลย -> null", matchTier(e("ชั้นวางเหล็ก"), ["แมว"]), null);

// ชั้น notes: คำหนึ่งอยู่ชื่อ อีกคำอยู่โน้ต
eq("คำกระจายระหว่างชื่อกับโน้ต -> notes",
   matchTier(e("ชั้นวางเหล็ก", "", "อยากเน้นห้องครัว"), ["ชั้นวาง", "ครัว"]), "notes");
eq("ทุกคำอยู่ในโน้ตล้วน -> notes",
   matchTier(e("สินค้า", "", "เน้นคนอยู่หอ"), ["คนอยู่หอ"]), "notes");

// ชั้น info: ต้องพึ่ง productInfo
eq("คำกระจายระหว่างชื่อกับรายละเอียด -> info",
   matchTier(e("ชั้นวางเหล็ก", "โครงสร้างเหล็กหนา"), ["ชั้นวาง", "หนา"]), "info");
eq("ทุกคำอยู่ในรายละเอียดล้วน -> info",
   matchTier(e("สินค้า", "แบรนด์ BMZAR"), ["bmzar"]), "info");

// ชั้นสูงกว่าชนะเสมอ — เจอทั้งชื่อและรายละเอียดต้องได้ name ไม่ใช่ info
eq("เจอทั้งชื่อและรายละเอียด -> name (ไม่ซ้ำสองชั้น)",
   matchTier(e("แมว", "แมวแมวแมว"), ["แมว"]), "name");
eq("เจอทั้งโน้ตและรายละเอียด -> notes",
   matchTier(e("สินค้า", "คำนี้อยู่ในรายละเอียด", "คำนี้อยู่ในโน้ต"), ["คำนี้"]), "notes");

// ตัวพิมพ์เล็กใหญ่
eq("ไม่สนตัวพิมพ์", matchTier(e("BMZAR เคาเตอร์"), ["bmzar"]), "name");

// riskModule ต้องไม่ถูกค้น — ส่ง entry ที่มี riskModule ก็ไม่ควรแมตช์
eq("riskModule ไม่ถูกค้น",
   matchTier({ productName: "ก", productInfo: "ข", extraNotes: "ค", riskModule: "พับได้" }, ["พับได้"]), null);

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 2: รันให้เห็นว่าล้มเหลว**

Run: `node "<scratch>/test-search.js"`
Expected: FAIL — `Cannot find module '<scratch>/build/entry-search.js'` เพราะยังไม่ได้เขียนและคอมไพล์ไฟล์ต้นทาง

- [ ] **Step 3: เขียน `lib/entry-search.ts`**

```ts
/**
 * ตรรกะค้นหารายการในแถบข้าง — แยกออกมาจาก history-rail.tsx เพื่อให้ทดสอบได้
 * (โปรเจกต์ไม่มี test runner จึงต้องเป็น pure function ที่คอมไพล์เดี่ยวแล้วรันด้วย node ได้)
 */

/** ฟิลด์ที่คำค้นถูกนำไปแมตช์ — riskModule ถูกตัดออกตั้งใจ ดูคอมเมนต์ใน matchTier */
export type SearchableEntry = {
  productName: string;
  productInfo: string;
  extraNotes: string;
};

/** ชั้นของผลลัพธ์ เรียงตามความน่าเชื่อถือจากมากไปน้อย */
export type MatchTier = "name" | "notes" | "info";

/**
 * ตัดคำค้นด้วยช่องว่าง แล้วลดเป็นตัวพิมพ์เล็ก
 *
 * เดิม matchesQuery เอาคำค้นทั้งประโยครวมเว้นวรรคไปหาเป็น substring เดียว ทำให้พิมพ์
 * เว้นวรรคเมื่อไหร่ได้ 0 เสมอทั้งที่มีของอยู่ (ทดสอบกับข้อมูลจริงล้มเหลว 5/5 เคส เช่น
 * "ที่นอน แมว" ได้ 0 ทั้งที่แยกคำแล้วเจอ 7 รายการ) — และล้มเหลวแบบเงียบ ไม่มีอะไรบอกสาเหตุ
 */
export function splitTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter((t) => t !== "");
}

/**
 * จัดชั้นของรายการตาม "ฟิลด์ที่อ่อนที่สุดที่จำเป็นต้องใช้" เพื่อให้ทุกคำถูกเจอครบ
 *
 * เมื่อค้นหลายคำ รายการหนึ่งอาจเจอคำหนึ่งในชื่อ อีกคำในรายละเอียด — กฎนี้ทำให้แต่ละรายการ
 * ตกอยู่ชั้นเดียวเสมอ ไม่ซ้ำสองที่ และชั้นที่น่าเชื่อถือกว่าชนะเสมอ
 *
 * riskModule ไม่ถูกค้นโดยตั้งใจ (ยกมาจากคอมเมนต์เดิมใน history-rail.tsx): เนื้อหาเป็นวลีซ้ำ
 * ทั่วไป ("พับได้" / "มีกลไก") ที่ใช้ร่วมกันหลายสิบรายการ ถ้ารวมเข้ามาผลค้นหาจะกว้างขึ้น
 * แทนที่จะแคบลง
 */
export function matchTier<T extends SearchableEntry>(
  entry: T,
  terms: string[]
): MatchTier | null {
  if (terms.length === 0) return null;

  const name = entry.productName.toLowerCase();
  const nameAndNotes = name + " " + entry.extraNotes.toLowerCase();
  const all = nameAndNotes + " " + entry.productInfo.toLowerCase();

  if (terms.every((t) => name.includes(t))) return "name";
  if (terms.every((t) => nameAndNotes.includes(t))) return "notes";
  if (terms.every((t) => all.includes(t))) return "info";
  return null;
}
```

- [ ] **Step 4: คอมไพล์แล้วรันสคริปต์ทดสอบให้ผ่านทั้งหมด**

`lib/entry-search.ts` ไม่ import อะไรเลย จึงคอมไพล์เดี่ยวได้:

Run: `npx tsc lib/entry-search.ts --outDir "<scratch>/build" --module commonjs --target ES2017 --skipLibCheck`
Expected: ไม่มี error และเกิดไฟล์ `<scratch>/build/entry-search.js`

Run: `node "<scratch>/test-search.js"`
Expected: ทุกบรรทัด `PASS` และปิดท้าย `ALL PASS`

**ห้ามแก้ค่าคาดหวังในสคริปต์ทดสอบเพื่อให้ผ่าน**

- [ ] **Step 5: ตรวจกับข้อมูลจริงว่าตัวเลขตรงกับที่ spec วัดไว้**

เขียนไฟล์ `<scratch>/verify-search.js` (อ่าน `dev.db` แบบ **readonly** ห้ามเขียน — แทน `<REPO>` ด้วย `C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt`):

```js
const Database = require("<REPO>/node_modules/better-sqlite3");
const { splitTerms, matchTier } = require("<scratch>/build/entry-search.js");
const db = new Database("<REPO>/dev.db", { readonly: true });

const rows = db.prepare(`SELECT productName, productInfo, extraNotes FROM PromptEntry`).all();
console.log(`entries ทั้งหมด: ${rows.length}\n`);

// เคสที่ spec บันทึกไว้ว่าเดิมได้ 0 — ต้องเจอตามจำนวนนี้
const multi = [["ที่นอน แมว", 7], ["ชั้นวาง เหล็ก", 6], ["ขวด น้ำ", 3], ["ชามอาหาร สแตนเลส", 1], ["กระดาษ กรง", 2]];
let failed = 0;
console.log("=== คำค้นหลายคำ (เดิมได้ 0 ทุกเคส) ===");
for (const [q, want] of multi) {
  const terms = splitTerms(q);
  const got = rows.filter((r) => matchTier(r, terms) !== null).length;
  const ok = got === want;
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"} "${q}" → ${got} รายการ (คาด ${want})`);
}

console.log("\n=== การแบ่งชั้น (ตัวเลขชั้น name ต้องตรงกับที่ spec วัด) ===");
for (const [q, wantName] of [["ผ้า", 9], ["ครัว", 5], ["แมว", 11], ["สแตนเลส", 10], ["ชั้นวาง เหล็ก", 1]]) {
  const terms = splitTerms(q);
  const t = { name: 0, notes: 0, info: 0 };
  for (const r of rows) { const k = matchTier(r, terms); if (k) t[k]++; }
  const ok = t.name === wantName;
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"} "${q}" → ตรงชื่อ ${t.name} (คาด ${wantName}) · โน้ต ${t.notes} · รายละเอียด ${t.info}  รวม ${t.name+t.notes+t.info}`);
}

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
```

Run: `node "<scratch>/verify-search.js"`
Expected: ทุกบรรทัด `PASS` และ `ALL PASS` — ยืนยันว่าตรรกะใหม่ให้ตัวเลขตรงกับที่ spec วัดไว้จากข้อมูลจริง

- [ ] **Step 6: ตรวจ type และ lint**

Run: `npx tsc --noEmit`
Expected: ไม่มี error

Run: `npm run lint`
Expected: ไม่มี error (ถ้า error ชี้ไปที่ไฟล์ใน `.next-dev` ให้ `rm -rf .next-dev` แล้วรันใหม่)

- [ ] **Step 7: Commit**

```bash
git diff tsconfig.json   # ต้องว่าง ถ้าไม่ว่างให้ git checkout -- tsconfig.json
git add lib/entry-search.ts
git commit -m "Match search terms individually instead of as one string

A space in the query guaranteed zero results — the whole phrase was matched
as a single substring, so \"ที่นอน แมว\" found nothing while seven entries
contained both words.

Results are tiered by the weakest field a match needed, so an entry appears
once and the strongest match wins. riskModule stays excluded for the reason
the original comment gives.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: ต่อตรรกะค้นหาใหม่เข้าแถบข้าง + จัดผลเป็นชั้น

**Files:**
- Modify: `components/history-rail.tsx`

**Interfaces:**
- Consumes จาก Task 1: `splitTerms`, `matchTier`, `type MatchTier` จาก `@/lib/entry-search`
- Produces: ไม่มี (งานภายในคอมโพเนนต์)

**บริบทที่ต้องรู้:**
- ฟังก์ชัน `matchesQuery` เดิม (บรรทัด 19-29 รวมคอมเมนต์) **ต้องลบทิ้ง** — ตรรกะย้ายไป `lib/entry-search.ts` แล้ว
- `useMemo` ที่ชื่อ `groups` (บรรทัด 71-97) เป็นตัวที่ต้องแก้ — ตอนนี้กรองแบนแล้วจัดกลุ่มตามเดือนเสมอ
- **เลข take (`takeNumber`) ต้องคำนวณจากลิสต์เต็มเสมอ ไม่ใช่จากลิสต์ที่กรองแล้ว** — มีคอมเมนต์อธิบายไว้ที่บรรทัด 69-70 ว่าเลขต้องคงที่ไม่ว่าจะกรองอะไรออก **ห้ามเปลี่ยนพฤติกรรมนี้**
- ตัวกรอง `onlyIncomplete` ต้องยังใช้ร่วมกับคำค้นได้เหมือนเดิม
- **เมื่อไม่มีคำค้น ต้องแสดงกลุ่มตามเดือนเหมือนเดิมทุกประการ** — การแบ่งชั้นทำงานเฉพาะตอนค้นหา

- [ ] **Step 1: เพิ่ม import และลบ `matchesQuery` เดิม**

เพิ่ม import:

```tsx
import { matchTier, splitTerms, type MatchTier } from "@/lib/entry-search";
```

แล้วลบฟังก์ชัน `matchesQuery` พร้อมคอมเมนต์บล็อกเหนือมัน (บรรทัด 19-29) ออกทั้งหมด

- [ ] **Step 2: เปลี่ยน `groups` useMemo ให้คืนผลสองโหมด**

แทนที่ `useMemo` ที่ชื่อ `groups` (บรรทัด 71-97) ทั้งบล็อกด้วย:

```tsx
  // เมื่อไม่มีคำค้น: จัดกลุ่มตามเดือนเหมือนเดิม
  // เมื่อมีคำค้น: จัดเป็นชั้นตามความน่าเชื่อถือของฟิลด์ที่แมตช์ เพื่อให้ของที่ตรงจริงอยู่บนสุด
  //   (ค้น "ผ้า" เคยได้ 28 จาก 71 รายการเพราะแมตช์ productInfo ที่เป็นข้อความร้าน)
  const view = useMemo(() => {
    const numbered = prompts.map((entry, index) => ({
      entry,
      takeNumber: prompts.length - index,
    }));

    const terms = splitTerms(query);
    const afterFilter = numbered.filter(
      ({ entry }) => !onlyIncomplete || isIncomplete(entry)
    );

    if (terms.length === 0) {
      // Entries arrive pre-sorted, so walking them in order yields month
      // buckets already in the right sequence.
      const buckets: { label: string; items: typeof numbered }[] = [];
      for (const item of afterFilter) {
        const label = monthLabel(item.entry.postedAt);
        const last = buckets[buckets.length - 1];
        if (last && last.label === label) last.items.push(item);
        else buckets.push({ label, items: [item] });
      }
      return { mode: "months" as const, buckets };
    }

    const tiers: Record<MatchTier, typeof numbered> = { name: [], notes: [], info: [] };
    for (const item of afterFilter) {
      const tier = matchTier(item.entry, terms);
      if (tier) tiers[tier].push(item);
    }
    return { mode: "search" as const, tiers };
  }, [prompts, query, onlyIncomplete]);

  const visibleCount =
    view.mode === "months"
      ? view.buckets.reduce((sum, g) => sum + g.items.length, 0)
      : view.tiers.name.length + view.tiers.notes.length + view.tiers.info.length;
```

แล้วลบบรรทัดคำนวณ `visibleCount` เดิม (บรรทัด 99) ออก — ถูกแทนที่ด้วยตัวใหม่ข้างบนแล้ว

- [ ] **Step 3: เพิ่ม state สำหรับพับหัวข้อ "พบในรายละเอียดสินค้า"**

วางต่อจาก `const [onlyIncomplete, setOnlyIncomplete] = useState(false);` (บรรทัด 65):

```tsx
  // ผลที่แมตช์เฉพาะ productInfo (ข้อความร้าน) พับไว้เป็นค่าเริ่มต้น — เป็นต้นเหตุที่ทำให้
  // ผลค้นบวม แต่ยังต้องเก็บไว้เพราะบางครั้งค้นชื่อแบรนด์ที่ปรากฏแค่ในข้อความร้าน
  const [showInfoMatches, setShowInfoMatches] = useState(false);
```

- [ ] **Step 4: แยกการเรนเดอร์รายการออกเป็นฟังก์ชันย่อย**

ตอนนี้ JSX ของแต่ละแถว (บรรทัด 148-210 ทั้งบล็อก `group.items.map(...)`) ถูกใช้ที่เดียว แต่หลังแบ่งโหมดจะต้องใช้ 2 ที่ (โหมดเดือน + โหมดค้นหา) — ย้ายออกมาเป็นฟังก์ชันภายในคอมโพเนนต์เพื่อไม่ให้โค้ดซ้ำ

วางฟังก์ชันนี้ก่อน `return (` ของคอมโพเนนต์:

```tsx
  function renderItems(items: { entry: PromptEntry; takeNumber: number }[]) {
    return (
      <ul className="flex flex-col gap-1">
        {items.map(({ entry, takeNumber }) => {
          const isActive = selectedId === entry.id;
          const date = shortDate(entry.postedAt);
          return (
            <li
              key={entry.id}
              className={cn(
                "group flex items-center rounded-md border-l-2 border-transparent text-sm text-paper/80 transition-colors hover:bg-ink-2 hover:text-paper",
                isActive && "border-marigold bg-ink-2 text-paper"
              )}
            >
              <button
                type="button"
                onClick={() => onSelect(entry)}
                className="flex min-w-0 flex-1 items-center gap-2 py-2 pl-2.5 text-left"
              >
                <span className="shrink-0 font-mono text-[0.65rem] text-marigold/80">
                  T{String(takeNumber).padStart(2, "0")}
                </span>
                <span className="min-w-0 flex-1 truncate">{entry.productName}</span>
                {date && (
                  <span className="shrink-0 font-mono text-[0.6rem] text-paper/30">
                    {date}
                  </span>
                )}
              </button>

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
                        onClick={() => onDuplicate(entry.id)}
                        className="flex cursor-pointer items-center gap-2 px-3 py-1.5 outline-none data-[highlighted]:bg-ink"
                      >
                        <Copy className="size-3.5" />
                        ทำซ้ำ
                      </Menu.Item>
                      <Menu.Item
                        onClick={() => onDelete(entry.id)}
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
    );
  }
```

**หมายเหตุ:** เนื้อหาใน `renderItems` คือ JSX เดิมยกมาทั้งดุ้น ยังไม่เปลี่ยนหน้าตาแถว — Task 3 จะมาแก้ข้างในฟังก์ชันนี้จุดเดียว

- [ ] **Step 5: แทนที่บล็อกเรนเดอร์รายการด้วยโหมดคู่**

แทนที่ `<div className="flex flex-1 flex-col gap-3 overflow-y-auto">` ทั้งบล็อก (บรรทัด 141-221) ด้วย:

```tsx
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto">
        {view.mode === "months" &&
          view.buckets.map((group) => (
            <div key={group.label} className="flex flex-col gap-1">
              <p className="px-1 font-mono text-[0.6rem] tracking-widest text-marigold/60 uppercase">
                {group.label}
              </p>
              {renderItems(group.items)}
            </div>
          ))}

        {view.mode === "search" && (
          <>
            {view.tiers.name.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="px-1 font-mono text-[0.6rem] tracking-widest text-marigold/60 uppercase">
                  ตรงชื่อสินค้า ({view.tiers.name.length})
                </p>
                {renderItems(view.tiers.name)}
              </div>
            )}

            {view.tiers.notes.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="px-1 font-mono text-[0.6rem] tracking-widest text-marigold/60 uppercase">
                  พบในโน้ตของฉัน ({view.tiers.notes.length})
                </p>
                {renderItems(view.tiers.notes)}
              </div>
            )}

            {view.tiers.info.length > 0 && (
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={() => setShowInfoMatches((v) => !v)}
                  aria-expanded={showInfoMatches}
                  className="flex items-center gap-1 px-1 text-left font-mono text-[0.6rem] tracking-widest text-paper/40 uppercase hover:text-paper/70"
                >
                  <ChevronRight
                    className={cn("size-3 transition-transform", showInfoMatches && "rotate-90")}
                  />
                  พบในรายละเอียดสินค้า ({view.tiers.info.length})
                </button>
                {showInfoMatches && renderItems(view.tiers.info)}
              </div>
            )}
          </>
        )}

        {total === 0 && (
          <p className="px-2.5 py-2 text-sm text-paper/40">ยังไม่มีรายการ</p>
        )}
        {total > 0 && visibleCount === 0 && (
          <p className="px-2.5 py-2 text-sm text-paper/40">
            ไม่พบรายการ — ลองใช้คำที่สั้นลงหรือน้อยคำลง
          </p>
        )}
      </div>
```

- [ ] **Step 6: เพิ่มไอคอน `ChevronRight` เข้า import**

**ก่อนใช้ ต้องเช็กชื่อ canonical จริงก่อน:**

Run: `grep -o 'export {[^}]*' node_modules/lucide-react/dist/esm/icons/chevron-right.mjs`
Expected: เห็น `ChevronRight as default` — ถ้าไม่ตรงให้ใช้ชื่อที่เห็นจริงแทน

แล้วแก้บรรทัด import ของ lucide (บรรทัด 4) ให้เป็น:

```tsx
import { ChevronRight, Copy, EllipsisVertical, Plus, Search, Trash2 } from "lucide-react";
```

- [ ] **Step 7: ตรวจ type และ lint**

Run: `npx tsc --noEmit`
Expected: ไม่มี error

Run: `npm run lint`
Expected: ไม่มี error

- [ ] **Step 8: ทดสอบ UI จริงบน isolated dev server**

```bash
cp dev.db dev-test.db
NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001
```

เปิด `http://localhost:3001` แท็บ ① แล้วตรวจ:
- **ไม่มีคำค้น:** แสดงกลุ่มตามเดือนเหมือนเดิม (มิ.ย. 13 · ก.ค. 51 · ยังไม่ได้ลงคลิป 7) ไม่มีอะไรเปลี่ยน
- **พิมพ์ "ที่นอน แมว"** (เว้นวรรค) → **เจอ 7 รายการ** (เดิมได้ 0) แบ่งเป็นชั้น
- **พิมพ์ "ผ้า"** → หัวข้อ "ตรงชื่อสินค้า (9)" อยู่บนสุด และ "พบในรายละเอียดสินค้า" ขึ้นเลขที่เหลือ โดยพับไว้
- **กดหัวข้อที่พับ** → กางออกเห็นรายการ กดอีกครั้งพับกลับ
- **พิมพ์คำที่ไม่มีจริง** เช่น "ซซซ" → ขึ้น "ไม่พบรายการ — ลองใช้คำที่สั้นลงหรือน้อยคำลง"
- **เลข T## ต้องไม่เปลี่ยนตอนกรอง** — จำเลขของรายการหนึ่งไว้ แล้วพิมพ์ค้นให้เหลือน้อยลง เลขต้องเท่าเดิม
- **ตัวกรอง "ยังไม่ได้กรอกผลลัพธ์"** ยังทำงาน และใช้ร่วมกับคำค้นได้ (เปิดตัวกรองแล้วพิมพ์ค้น ผลต้องแคบลงทั้งสองเงื่อนไข)
- เลือกรายการ · เมนู kebab (ทำซ้ำ/ลบ) ยังทำงานปกติทั้งสองโหมด
- ไม่มี console error/hydration warning

ปิด server แล้ว cleanup: `rm -rf .next-dev dev-test.db`

- [ ] **Step 9: Commit**

```bash
git diff tsconfig.json   # ต้องว่าง
git add components/history-rail.tsx
git commit -m "Tier search results by which field matched

Searching \"ผ้า\" returned twenty-eight of seventy-one entries because the
pasted store text matches almost anything. Name matches now lead, and the
store-text matches sit behind a collapsed heading so recall survives without
burying the result you wanted.

Month grouping is untouched when the query is empty.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: รูปสินค้า + ชื่อ 2 บรรทัด + วันที่สร้างเมื่อยังไม่ลงคลิป

**Files:**
- Modify: `components/history-rail.tsx`

**Interfaces:**
- Consumes จาก Task 2: ฟังก์ชัน `renderItems` ที่แยกไว้แล้ว
- Produces: ไม่มี

**บริบทที่ต้องรู้:**
- `PromptEntry` ฝั่ง client (`components/prompt-workspace.tsx`) มี `productImages: ProductImageRecord[]` และ `createdAt: Date` อยู่แล้ว ไม่ต้องเพิ่ม field
- `ProductImageRecord` มี `{ id, entryId, filename, mimeType, caption, sortOrder }`
- รูปถูกเรียง `sortOrder` มาแล้วจาก `app/page.tsx:24` (`include: { productImages: { orderBy: { sortOrder: "asc" } } }`) — ใช้ `productImages[0]` ได้เลย
- URL รูป: `/api/uploads/<entryId>/<filename>` — route มีอยู่แล้วที่ `app/api/uploads/[...path]/route.ts`
- **21 จาก 71 รายการไม่มีรูป** (entry เก่าก่อนมีฟีเจอร์รูป) ต้องขึ้นกรอบว่างขนาดเท่ากันไม่ให้ layout เหลื่อม

**กับดัก timezone (สำคัญ):** `postedAt` เก็บเป็น **UTC midnight** ส่วน `createdAt` เป็น **timestamp จริง** — ต้องใช้ตัวจัดรูปแบบคนละตัว ใช้ตัวเดียวกันจะได้วันที่เพี้ยนไป 1 วันสำหรับ entry ที่สร้างก่อน 7 โมงเช้าเวลาไทย (กับดักเดียวกับ `toDateInputValue` / `toLocalDateInputValue` ใน `production-panel.tsx` ที่ CLAUDE.md เตือนไว้)

- [ ] **Step 1: เพิ่มตัวจัดรูปแบบวันที่สร้าง**

วางต่อจากฟังก์ชัน `shortDate` ที่มีอยู่ (บรรทัด 40-47 เดิม):

```tsx
/**
 * "12 ก.ค." ของวันที่สร้าง — ใช้กับ entry ที่ยังไม่ได้ลงคลิป (postedAt เป็น null)
 *
 * ต้องแยกจาก shortDate เพราะ createdAt เป็น timestamp จริง (อ่านด้วย local getter)
 * ส่วน postedAt เก็บเป็น UTC midnight — ใช้ตัวจัดรูปแบบร่วมกันจะเพี้ยนไป 1 วันสำหรับ
 * entry ที่สร้างก่อน 7 โมงเช้าเวลาไทย (กับดักเดียวกับ toDateInputValue ใน production-panel.tsx)
 */
function shortCreatedDate(createdAt: Date) {
  return new Date(createdAt).toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
  });
}
```

**เพิ่ม `timeZone: "UTC"` ให้ `shortDate` เดิมด้วย** (ตรวจแล้วว่าตอนนี้ยังไม่มี) — `postedAt` เก็บเป็น UTC midnight จึงควรอ่านด้วย UTC

**ข้อนี้เป็นการทำให้ทนทานขึ้น ไม่ใช่แก้บั๊กที่เห็นอยู่** — ที่ UTC+7 เวลา UTC midnight บวก 7 ชั่วโมงยังเป็นวันเดิม ผลที่แสดงจึงเหมือนกันทั้งก่อนและหลังแก้ **วันที่ที่แสดงอยู่ตอนนี้ต้องไม่เปลี่ยนแม้แต่รายการเดียว** ถ้าเปลี่ยนแปลว่าแก้ผิดจุด ให้ย้อนกลับทันที

- [ ] **Step 2: แก้แถวใน `renderItems` ให้มีรูป + ชื่อ 2 บรรทัด + วันที่สร้าง**

ใน `renderItems` แทนที่บล็อก `<button type="button" onClick={() => onSelect(entry)} ...>` ทั้งก้อน (ตั้งแต่ `<button` จนถึง `</button>`) ด้วย:

```tsx
              <button
                type="button"
                onClick={() => onSelect(entry)}
                className="flex min-w-0 flex-1 items-start gap-2 py-2 pl-2.5 text-left"
              >
                {entry.productImages[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/uploads/${entry.productImages[0].entryId}/${entry.productImages[0].filename}`}
                    alt=""
                    loading="lazy"
                    className="size-9 shrink-0 rounded border border-paper/10 object-cover"
                  />
                ) : (
                  <span className="size-9 shrink-0 rounded border border-dashed border-paper/10" />
                )}

                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="line-clamp-2 leading-tight">{entry.productName}</span>
                  <span className="flex items-center gap-1.5 font-mono text-[0.6rem]">
                    <span className="text-marigold/80">
                      T{String(takeNumber).padStart(2, "0")}
                    </span>
                    {date ? (
                      <span className="text-paper/30">{date}</span>
                    ) : (
                      <span className="text-paper/20">
                        สร้าง {shortCreatedDate(entry.createdAt)}
                      </span>
                    )}
                  </span>
                </span>
              </button>
```

**สิ่งที่เปลี่ยน:** `items-center` → `items-start` (ให้รูปชิดบนเมื่อชื่อยาว 2 บรรทัด) · เลข T## กับวันที่ย้ายลงมาอยู่บรรทัดที่สองใต้ชื่อ (เพื่อคืนความกว้างให้ชื่อ) · `truncate` → `line-clamp-2`

- [ ] **Step 3: ยืนยันว่า `line-clamp-2` เรนเดอร์จริง**

ตรวจแล้วว่า `line-clamp` มีอยู่ใน core ของ Tailwind **4.3.2** ที่โปรเจกต์ใช้ (ไม่ต้องลง plugin เพิ่ม) แต่ **ยังไม่เคยถูกใช้ที่ไหนในโปรเจกต์นี้เลย** จึงต้องยืนยันด้วยตาว่า class ถูก generate ออกมาจริง

ทดสอบใน Step 5 กับ entry ชื่อยาว 125 ตัวอักษร: ชื่อต้องแสดง **2 บรรทัดแล้วตัด** ไม่ใช่ล้นออกหรือแสดงครบทุกบรรทัด

ถ้าไม่ทำงาน (ชื่อยาวล้นแถว) ให้เปลี่ยน `line-clamp-2` เป็น:

```tsx
className="leading-tight [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] overflow-hidden"
```

- [ ] **Step 4: ตรวจ type และ lint**

Run: `npx tsc --noEmit`
Expected: ไม่มี error

Run: `npm run lint`
Expected: ไม่มี error

- [ ] **Step 5: ทดสอบ UI จริง**

```bash
cp dev.db dev-test.db
NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001
```

ตรวจในแท็บ ①:
- **รูปแสดงผล** — รายการที่มีรูป (50 จาก 71) ขึ้นรูปสินค้า · รายการที่ไม่มีรูป (21 รายการ) ขึ้นกรอบเส้นประขนาดเท่ากัน **layout ไม่เหลื่อม**
- **ชื่อยาวขึ้น 2 บรรทัด** — หา entry ชื่อ "【พร้อมส่ง】 BMZAR เคาเตอร์ครัว..." (ยาว 125 ตัวอักษร) **ต้องเห็นคำว่า "เคาเตอร์ครัว"** ซึ่งเดิมถูกตัดหายไป
- **คู่ BMZAR แยกออกจากกันได้** — ทั้งคู่ยังไม่ได้ลงคลิป เดิมไม่มีวันที่โชว์เลยทั้งคู่ ตอนนี้ต้องเห็น "สร้าง 21 ก.ค." กับ "สร้าง 28 ก.ค."
- **วันที่ลงคลิปยังถูกต้อง** — เทียบ entry สัก 2-3 อันกับค่า `postedAt` ใน `dev-test.db` ว่าวันตรง ไม่เพี้ยนไป 1 วัน
- **เลื่อนลิสต์ 71 รายการได้ลื่น** รูปโหลดแบบ lazy (เลื่อนแล้วรูปล่างค่อยโหลด)
- ไม่มี horizontal scroll ในแถบข้าง · ไม่มี console error (โดยเฉพาะ 404 ของรูป)
- โหมดค้นหาจาก Task 2 ยังทำงาน และแถวในผลค้นหาก็มีรูปเหมือนกัน

ปิด server แล้ว cleanup: `rm -rf .next-dev dev-test.db`

- [ ] **Step 6: Commit**

```bash
git diff tsconfig.json   # ต้องว่าง
git add components/history-rail.tsx
git commit -m "Show the product photo and give the name a second line

The rail left about fifteen characters for a name, and the part that says
what the product is usually sits at the end — \"【พร้อมส่ง】 BMZAR เคาเตอร์ครัว\"
displayed as \"【พร้อมส่ง】 BMZ\". The thumbnail is 36px, which is exactly two
lines of small text, so the extra line costs no height.

Entries with no clip yet showed no date at all, which left the two BMZAR rows
identical; they now show when they were created, read with local getters
since createdAt is a real timestamp and postedAt is UTC midnight.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: กดการ์ดคำแนะนำแล้วเด้งไปที่ entry

**Files:**
- Modify: `components/recommendations.tsx`
- Modify: `components/dashboard-panel.tsx`
- Modify: `components/prompt-workspace.tsx`

**Interfaces:**
- Consumes: ไม่มีจาก task ก่อนหน้า
- Produces: prop ใหม่ `onOpenEntry: (entryId: string) => void` บน `Recommendations` และ `DashboardPanel`

**บริบทที่ต้องรู้:**
- `Recommendations` (`components/recommendations.tsx:96-99`) map `signals` โดยมี `s.entryId` อยู่แล้ว — `<div key={s.entryId + s.kind} ...>` คือตัวที่จะทำให้กดได้
- `DashboardPanel` เรนเดอร์ `<Recommendations>` ที่บรรทัด 154-159 — ต้องส่ง prop ผ่าน
- `prompt-workspace.tsx` มีทั้ง `selectedId` และ `tab` state และมีแบบแผนอยู่แล้ว: `startNew()` (บรรทัด 192-200) และ `handleDuplicate()` (บรรทัด 212-224) ต่างก็เรียก `setTab("brief")` คู่กับการตั้ง `selectedId`
- `selectPrompt(entry)` (บรรทัด 184-190) ตั้ง `selectedId` + `form` + เคลียร์ error — **ใช้ซ้ำได้ ไม่ต้องเขียนตรรกะใหม่**

- [ ] **Step 1: เพิ่ม handler ใน `prompt-workspace.tsx`**

วางต่อจากฟังก์ชัน `selectPrompt` (หลังบรรทัด 190):

```tsx
  /**
   * กดการ์ดคำแนะนำในแท็บรายได้ แล้วเด้งมาที่ entry นั้นในแท็บ Brief
   *
   * แก้ friction ข้ามแท็บ: เดิมต้องจำชื่อสินค้าจากการ์ดแล้วมาไล่หาเองในแถบข้าง
   * (เลือกทำแบบนี้แทนการเอารายได้ไปโชว์ในแถบข้าง เพราะเงินมี settlement lag 7+ วัน
   * คลิปที่เพิ่งลงจะขึ้น ฿0 แล้วอ่านเหมือนว่าเจ๊ง — ดู spec หัวข้อ 6)
   */
  function openEntry(entryId: string) {
    const entry = prompts.find((p) => p.id === entryId);
    if (!entry) return;
    selectPrompt(entry);
    setTab("brief");
  }
```

- [ ] **Step 2: ส่ง prop ลง `DashboardPanel`**

ในบล็อก `<DashboardPanel ... />` ของ `prompt-workspace.tsx` (ราวบรรทัด 377-386) เพิ่ม:

```tsx
              onOpenEntry={openEntry}
```

- [ ] **Step 3: รับ prop ใน `DashboardPanel` แล้วส่งต่อ**

ใน `components/dashboard-panel.tsx` เพิ่ม `onOpenEntry` เข้า destructure params และเข้า type:

```tsx
  onOpenEntry,
```
```tsx
  onOpenEntry: (entryId: string) => void;
```

แล้วส่งต่อในบล็อก `<Recommendations>` (บรรทัด 154-159):

```tsx
        onOpenEntry={onOpenEntry}
```

- [ ] **Step 4: ทำการ์ดให้กดได้ใน `recommendations.tsx`**

เพิ่ม `onOpenEntry` เข้า destructure params และ type ของ `Recommendations` (ราวบรรทัด 54-70):

```tsx
  onOpenEntry,
```
```tsx
  onOpenEntry: (entryId: string) => void;
```

แล้วเปลี่ยน `<div key={s.entryId + s.kind} className="flex flex-col gap-1 border-t border-border pt-3 first:border-t-0 first:pt-0">` (บรรทัด 99) เป็น `<button>`:

```tsx
            <button
              type="button"
              key={s.entryId + s.kind}
              onClick={() => onOpenEntry(s.entryId)}
              className="flex flex-col gap-1 border-t border-border pt-3 text-left transition-colors first:border-t-0 first:pt-0 hover:bg-muted/40"
            >
```

และปิดด้วย `</button>` แทน `</div>` ที่ปิดบล็อกนั้น

**ระวัง:** ข้างในการ์ดไม่มีปุ่มหรือลิงก์อื่นอยู่แล้ว (มีแต่ `<span>` กับ `<p>`) จึงไม่เกิดปัญหาปุ่มซ้อนปุ่ม — ตรวจซ้ำด้วยตาก่อนแก้

- [ ] **Step 5: ตรวจ type และ lint**

Run: `npx tsc --noEmit`
Expected: ไม่มี error — ถ้า error บอกว่า prop ขาด ให้ไล่ดูว่าส่งครบทั้ง 3 จุด (`prompt-workspace` → `dashboard-panel` → `recommendations`)

Run: `npm run lint`
Expected: ไม่มี error

- [ ] **Step 6: ทดสอบ UI จริง**

```bash
cp dev.db dev-test.db
NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001
```

ตรวจ:
- ไปแท็บ **④ รายได้** → การ์ด "ควรทำอะไรต่อ" มีสัญญาณอยู่
- **กดที่การ์ด** → เด้งไปแท็บ ① Brief พร้อม**เลือก entry ที่ถูกต้อง** (ชื่อสินค้าในฟอร์มตรงกับที่การ์ดบอก และแถวนั้นถูกไฮไลต์ในแถบข้าง)
- ทดสอบกดการ์ดหลายอันว่าไปถูก entry ทุกครั้ง
- การ์ดมี hover state ให้รู้ว่ากดได้
- ส่วนอื่นของแท็บ ④ (Weekly Scoreboard, กราฟ, ราย-คลิป, เวลาโพสต์, ฟอร์มนำเข้า) ยังทำงานเหมือนเดิม
- ไม่มี console error/hydration warning

ปิด server แล้ว cleanup: `rm -rf .next-dev dev-test.db`

- [ ] **Step 7: Commit**

```bash
git diff tsconfig.json   # ต้องว่าง
git add components/recommendations.tsx components/dashboard-panel.tsx components/prompt-workspace.tsx
git commit -m "Open the entry a recommendation points at

Acting on \"remake this winner\" meant reading the product name off the card,
switching tabs, and hunting for it in a list of seventy-one. The card already
holds the entry id.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**ความครอบคลุมของ spec:**

| ข้อกำหนดใน spec | Task ที่ทำ |
|---|---|
| §1 แยกคำค้นหา (แก้บั๊ก) | Task 1 (`splitTerms`) + assert 5 เคสที่เคยได้ 0 |
| §2 จัดผลเป็น 3 ชั้น | Task 1 (`matchTier`) + Task 2 (เรนเดอร์) |
| §2 กฎจัดชั้นตามฟิลด์ที่อ่อนที่สุด | Task 1 Step 3 + assert เคส "เจอทั้งชื่อและรายละเอียด -> name" |
| §2 พับ "พบในรายละเอียดสินค้า" | Task 2 Steps 3, 5 |
| §2 ไม่มีคำค้น = กลุ่มเดือนเหมือนเดิม | Task 2 Step 2 (`mode: "months"`) + ทดสอบ Step 8 |
| §2 `riskModule` ไม่ถูกค้น | Task 1 Step 3 (คอมเมนต์) + assert เฉพาะ |
| §3 ไม่พบผลลัพธ์ = บอกทางออก | Task 2 Step 5 |
| §4 รูปสินค้า + ชื่อ 2 บรรทัด | Task 3 Step 2 |
| §4 ไม่มีรูป = กรอบว่างขนาดเท่ากัน | Task 3 Step 2 (`<span>` เส้นประ) + ทดสอบ Step 5 |
| §4 lazy load | Task 3 Step 2 (`loading="lazy"`) |
| §5 วันที่สร้างเมื่อยังไม่ลงคลิป | Task 3 Steps 1-2 |
| §5 กับดัก timezone | Task 3 Step 1 (แยก `shortCreatedDate`) + ทดสอบวันไม่เพี้ยน |
| §6 กดการ์ดแล้วเด้งไป entry | Task 4 |
| เลข T## คงที่ไม่ว่ากรองอะไร | Task 2 Step 2 (คำนวณจาก `prompts` เต็ม) + ทดสอบ Step 8 |
| ตัวกรอง `onlyIncomplete` ใช้ร่วมกับคำค้นได้ | Task 2 Step 2 (`afterFilter`) + ทดสอบ Step 8 |

**สิ่งที่ spec ระบุว่าไม่ทำ และแผนนี้ไม่ได้ทำ:** รายได้ในแถบข้าง · หัวข้อติดหนึบ · เปลี่ยนการจัดกลุ่มเดือน · ตัวกรอง/การเรียงใหม่ · แตะ `lib/recommender.ts`/`lib/angle.ts`/`lib/dashboard.ts`/`lib/weekly-scoreboard.ts`/`lib/entry-sort.ts` · ใช้ `next/image` ✓

**ความสอดคล้องของชื่อ/ชนิด:** `splitTerms` / `matchTier` / `SearchableEntry` / `MatchTier` ใช้ชื่อเดียวกันใน Task 1 และ 2 ✓ · `renderItems` นิยามใน Task 2 Step 4 และถูกแก้ไขข้างในโดย Task 3 Step 2 (ไม่เปลี่ยน signature) ✓ · `shortCreatedDate` นิยามและใช้ใน Task 3 ทั้งคู่ ✓ · `onOpenEntry: (entryId: string) => void` ใช้ชื่อและชนิดเดียวกันทั้ง 3 ไฟล์ใน Task 4 ✓ · `view.mode` เป็น discriminated union (`"months"` / `"search"`) ใช้สม่ำเสมอใน Task 2 Steps 2 และ 5 ✓
