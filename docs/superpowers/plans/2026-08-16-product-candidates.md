# หน้า "หาสินค้า" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** แปะแคปหน้าจัดอันดับสินค้า TikTok Shop → ได้ตารางสินค้าจัดอันดับพร้อมคำตัดสิน 🟢/🔴 → กดสร้าง entry ต่อได้ทันที

**Architecture:** ตารางใหม่ `ProductCandidate` เก็บสินค้าที่พิจารณาอยู่ (กันซ้ำด้วย `nameKey` unique) · `lib/candidates.ts` เป็น pure function ล้วน (parse/คำนวณ/ธงเตือน) ทดสอบแยกได้ · `lib/gemini.ts` เพิ่มตัวสกัดที่คืนข้อความบรรทัดละสินค้าคั่นด้วย `|` · หน้าใหม่ `/products` ประกอบจาก server component + client component ตามแบบ `/dashboard`

**Tech Stack:** Next.js 16.2.10 (App Router, Server Actions) · Prisma 7 + better-sqlite3 · `@google/genai` · Tailwind v4 · shadcn/ui บน `@base-ui/react`

**Spec:** `docs/superpowers/specs/2026-08-16-product-candidates-design.md`

## Global Constraints

- ห้ามรัน `npm run build`/`npm run dev` ชน port 3000 (`start.bat` ของผู้ใช้) — ใช้ `npx tsc --noEmit` + `npm run lint` เป็นหลัก ถ้าต้องเปิด dev server ใช้ `cp dev.db dev-test.db` แล้ว `NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001` แล้ว kill ทิ้ง + ลบ `dev-test.db`
- หลังแก้ `prisma/schema.prisma` ต้อง `npx prisma migrate dev --name add-product-candidate` แล้ว `npx prisma generate`
- import Prisma client จาก `@/lib/generated/prisma/client` เท่านั้น (ไม่มี index barrel)
- **`components/candidates-route.tsx` ต้อง import ชนิดข้อมูลจาก `@/lib/candidate-queries` ด้วย `import type` เท่านั้น** — ไฟล์นั้น import `@/lib/prisma` ถ้าเผลอ import แบบธรรมดาจะลาก Prisma เข้า client bundle (บั๊กคลาสเดียวกับที่ `lib/import-log.ts` ห้าม import `node:*` เพราะถูก client component ใช้)
- Gemini API ใช้ **snake_case**: `system_instruction`, `generation_config` — สะกดผิดแล้ว API เงียบ ไม่ error
- อ่าน `isActive: true` ของ `CorePrompt` ต้องใส่ `kind: "core"` ใน where เสมอ ไม่งั้นได้ SEO prompt มาแทน
- ห้าม hex / arbitrary font size (`text-[...]`) ใน `components/*` — ใช้ token เดิม, ขนาดตัวอักษรใช้ `text-xs`(ต่ำสุด)/`sm`/`base`/`lg`/`xl`/`2xl`/`3xl`
- `--border` = เส้นคั่นตกแต่ง · `--border-interactive` = ขอบของสิ่งที่กดได้ ห้ามสลับกัน
- `line-height` ข้อความไทยขั้นต่ำ 1.6 · ห้าม `tracking-widest`/`uppercase` กับข้อความไทย · **ห้าม `font-mono` กับข้อความที่อาจมี glyph ไทย** (เคยพลาดกับ `toLocaleDateString("th-TH")` ที่คืน "16 ส.ค. 2026")
- ปุ่มสูงขั้นต่ำ 36px (`h-9`)
- UI ภาษาไทยทั้งหมด · ห้าม emoji ในโค้ด (ใช้ไอคอน `lucide-react`)
- เช็ก `git diff tsconfig.json` ก่อน commit ทุกครั้งที่เปิด dev server — ถ้าเปลี่ยนให้ `git checkout -- tsconfig.json`
- ห้าม `git add -A` — add เฉพาะไฟล์ที่ระบุในแต่ละ task

## File Structure

| ไฟล์ | หน้าที่ |
|---|---|
| `prisma/schema.prisma` (แก้) | เพิ่ม model `ProductCandidate` |
| `lib/candidates.ts` (ใหม่) | pure function: parse ตัวเลขไทย, parse บรรทัด, normalize ชื่อ, ธงเตือน, คำนวณ %ค่าคอม/ดีมานด์รวม — ไม่มี I/O ไม่ import Prisma/Gemini |
| `scripts/check-candidates.mjs` (ใหม่) | ทดสอบ `lib/candidates.ts` แทน test suite ที่โปรเจกต์ไม่มี |
| `lib/gemini.ts` (แก้) | เพิ่ม `extractCandidateRows` — เรียก Gemini อ่านรูป คืนข้อความดิบ |
| `lib/candidate-queries.ts` (ใหม่) | คิวรี DB ของฟีเจอร์นี้: ดึงรายการ, สรุปรายหมวด, ค่าคอมเฉลี่ยที่ใช้เป็นเกณฑ์ |
| `app/actions.ts` (แก้) | 3 server action: `extractCandidates`, `setCandidateStatus`, `createEntryFromCandidate` |
| `app/products/page.tsx` (ใหม่) | server component ดึงข้อมูล + วาง `AppHeader` |
| `components/candidates-route.tsx` (ใหม่) | client component: แถบเตือน + สรุปหมวด + กล่องแปะรูป + ตาราง |
| `components/app-header.tsx` (แก้) | เพิ่มเมนู "หาสินค้า" |

---

### Task 1: `lib/candidates.ts` + สคริปต์ทดสอบ

**Files:**
- Create: `lib/candidates.ts`
- Create: `scripts/check-candidates.mjs`

**Interfaces:**
- Consumes: ไม่มี (ไฟล์แรกของฟีเจอร์ ไม่พึ่งอะไรเลย)
- Produces:
  - `parseThaiNumber(text: string): number | null`
  - `normalizeName(name: string): string`
  - `detectFlags(name: string): CandidateFlag[]` โดย `type CandidateFlag = "mechanism" | "heavyText"`
  - `parseCandidateRows(raw: string): { rows: ParsedRow[]; skipped: number }` โดย `type ParsedRow = { name: string; price: number; commission: number; weeklySales: number | null; categoryLabel: string }`
  - `commissionPercent(price: number, commission: number): number`
  - `demandTotal(commission: number, weeklySales: number | null): number | null`

- [ ] **Step 1: เขียนสคริปต์ทดสอบที่ต้องล้มเหลวก่อน**

สร้าง `scripts/check-candidates.mjs`:

```js
/**
 * ตรวจตรรกะของ lib/candidates.ts — ทำหน้าที่แทน test suite ที่โปรเจกต์นี้ไม่มี
 *
 * คอมไพล์ .ts ไปยัง temp dir ใต้ project root แล้ว import เข้ามาทดสอบ
 * (ต้องอยู่ใต้ project root เพราะ Node resolve bare specifier จากตำแหน่งไฟล์)
 *
 * รัน: node scripts/check-candidates.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const out = mkdtempSync(join(process.cwd(), ".check-candidates-tmp-"));
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
    ["tsc", "lib/candidates.ts", "--outDir", out, "--module", "es2022", "--target", "ES2017", "--moduleResolution", "bundler"],
    { stdio: "inherit", shell: true }
  );
  const c = await import(pathToFileURL(join(out, "candidates.js")).href);

  // --- parseThaiNumber ---
  check("13.9K -> 13900", c.parseThaiNumber("13.9K"), 13900);
  check("1.4K -> 1400", c.parseThaiNumber("1.4K"), 1400);
  check("816 -> 816", c.parseThaiNumber("816"), 816);
  check("฿29.90 -> 29.9", c.parseThaiNumber("฿29.90"), 29.9);
  check("฿0.96 ไม่ปัดทศนิยมทิ้ง", c.parseThaiNumber("฿0.96"), 0.96);
  check("ช่วงราคา ฿17.52 – 21.90 -> ใช้ค่าต่ำสุด", c.parseThaiNumber("฿17.52 – 21.90"), 17.52);
  check("ช่วงราคาขีดสั้น 17.52 - 21.90 -> ใช้ค่าต่ำสุด", c.parseThaiNumber("17.52 - 21.90"), 17.52);
  check("มีคอมมา 1,250 -> 1250", c.parseThaiNumber("1,250"), 1250);
  check("ขีดกลาง - (ไม่มีข้อมูล) -> null", c.parseThaiNumber("-"), null);
  check("ข้อความว่าง -> null", c.parseThaiNumber("   "), null);
  check("อ่านไม่ออก -> null", c.parseThaiNumber("รีวิวเชิงบวก"), null);

  // --- normalizeName ---
  check(
    "ช่องว่างซ้ำ + ตัวพิมพ์ต่างกัน ได้ key เดียวกัน",
    c.normalizeName("  HEINO  กว้าง40CM  "),
    c.normalizeName("heino กว้าง40cm")
  );
  check("ตัดช่องว่างหัวท้าย", c.normalizeName(" ก ข "), "ก ข");

  // --- detectFlags ---
  checkDeep("ชื่อมี 'พับได้' ติดธงกลไก", c.detectFlags("ตู้เก็บของพับได้ 49CM"), ["mechanism"]);
  checkDeep("ชื่อมี 'หมุน 360' ติดธงกลไก", c.detectFlags("ชั้นวางเครื่องสำอางหมุนได้ 360 องศา"), ["mechanism"]);
  checkDeep("ชื่อมี 'อาหาร' ติดธงข้อความเยอะ", c.detectFlags("อาหารแมวเกรดพรีเมียม"), ["heavyText"]);
  checkDeep("ชื่อปกติไม่ติดธง", c.detectFlags("ชั้นวางของติดผนัง ไม่ต้องเจาะ"), []);
  checkDeep(
    "ติดได้พร้อมกัน 2 ธง",
    c.detectFlags("ที่ให้อาหารแมวอัตโนมัติ"),
    ["mechanism", "heavyText"]
  );

  // --- parseCandidateRows ---
  const sample = [
    "หมวด: ที่เก็บของและชั้นวาง",
    "HEINO กว้าง40CM 5ชั้น ตู้เก็บของพับได้ | 249.00 | 29.90 | 13.9K",
    "ชั้นวางของพร้อมที่ดูดติดผนัง ไม่ต้องเจาะรู | 67.50 | 12.15 | 3.3K",
    "บรรทัดพังไม่มีขีดคั่น",
    "สินค้าไม่มียอดขาย | 55.00 | 2.30 | -",
  ].join("\n");
  const parsed = c.parseCandidateRows(sample);
  check("อ่านได้ 3 แถว (ข้ามบรรทัดพัง)", parsed.rows.length, 3);
  check("นับบรรทัดที่ข้ามได้ถูก", parsed.skipped, 1);
  check("แถวแรกได้ชื่อเต็มไม่ย่อ", parsed.rows[0].name, "HEINO กว้าง40CM 5ชั้น ตู้เก็บของพับได้");
  check("แถวแรกได้ราคา", parsed.rows[0].price, 249);
  check("แถวแรกได้ค่าคอม", parsed.rows[0].commission, 29.9);
  check("แถวแรกได้ยอดขายแปลง K แล้ว", parsed.rows[0].weeklySales, 13900);
  check("ทุกแถวได้หมวดจากหัวข้อ", parsed.rows[2].categoryLabel, "ที่เก็บของและชั้นวาง");
  check("แถวไม่มียอดขาย -> weeklySales เป็น null", parsed.rows[2].weeklySales, null);

  const noHeader = c.parseCandidateRows("สินค้าเดี่ยว | 10.00 | 1.00 | 500");
  check("ไม่มีหัวข้อหมวด -> categoryLabel ว่าง ไม่ throw", noHeader.rows[0].categoryLabel, "");
  check("ไม่มีหัวข้อหมวด ยังอ่านแถวได้", noHeader.rows.length, 1);

  const badNumbers = c.parseCandidateRows("หมวด: ก\nสินค้า | อ่านไม่ออก | 1.00 | 500");
  check("ราคาอ่านไม่ออก -> ข้ามทั้งแถว", badNumbers.rows.length, 0);
  check("ราคาอ่านไม่ออก -> นับเป็น skipped", badNumbers.skipped, 1);

  // --- คำนวณ ---
  checkClose3("%ค่าคอม 29.90/249", c.commissionPercent(249, 29.9), 12.0);
  checkClose3("%ค่าคอม 12.15/67.50", c.commissionPercent(67.5, 12.15), 18.0);
  check("ราคา 0 -> %ค่าคอมเป็น 0 ไม่ใช่ Infinity", c.commissionPercent(0, 5), 0);
  check("ดีมานด์รวม 29.90 x 13900", c.demandTotal(29.9, 13900), 415610);
  check("ไม่มียอดขาย -> ดีมานด์รวมเป็น null", c.demandTotal(29.9, null), null);

  console.log(failed === 0 ? "\nผ่านทุกเคส" : `\nตก ${failed} เคส`);
} finally {
  rmSync(out, { recursive: true, force: true });
}

function checkClose3(name, actual, expected) {
  const ok = Math.abs(actual - expected) < 0.05;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`      ได้ ${actual} ควรได้ ~${expected}`);
}

process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 2: รันเพื่อยืนยันว่าล้มเหลว**

Run: `node scripts/check-candidates.mjs`
Expected: FAIL — `tsc` error ว่าไม่พบไฟล์ `lib/candidates.ts`

- [ ] **Step 3: เขียน `lib/candidates.ts`**

```ts
/**
 * ตรรกะล้วนของหน้า "หาสินค้า" — parse ตัวเลข/บรรทัดจากผลลัพธ์ AI, ธงเตือน, คำนวณ
 *
 * ไฟล์นี้ห้าม import Prisma/Gemini/node:* เพื่อให้ scripts/check-candidates.mjs
 * คอมไพล์และทดสอบได้โดยไม่ต้องมี DB หรือ API key
 */

export type CandidateFlag = "mechanism" | "heavyText";

export type ParsedRow = {
  name: string;
  price: number;
  commission: number;
  weeklySales: number | null;
  categoryLabel: string;
};

/** คำในชื่อสินค้าที่บ่งบอกว่ามีกลไก — AI generate วิดีโอมักเลือกกลไกผิดกับสินค้ากลุ่มนี้ */
const MECHANISM_WORDS = [
  "พับได้", "พับ", "หมุน", "360", "ยืด", "ปรับระดับ", "อัตโนมัติ", "สไลด์", "บานพับ",
];

/** คำที่บ่งบอกว่าน่าจะมีฉลาก/ตารางข้อความบนตัวสินค้า — AI generate ตัวหนังสือเพี้ยนเป็นกลุ่มแรก */
const HEAVY_TEXT_WORDS = [
  "อาหาร", "ขนม", "ผง", "น้ำยา", "ครีม", "เจล", "วิตามิน", "อาหารเสริม",
];

/**
 * แปลงข้อความตัวเลขจากหน้า TikTok Shop เป็นตัวเลขจริง
 *
 * รองรับ: suffix K (13.9K -> 13900), สัญลักษณ์เงิน, คอมมาคั่นหลัก,
 * และช่วงราคา (17.52 – 21.90) ซึ่งเลือกค่าต่ำสุดเสมอตามหลัก conservative ของ Core Prompt
 * คืน null เมื่ออ่านไม่ออกหรือเป็นขีด "-" (ช่องที่หน้านั้นไม่มีข้อมูล)
 */
export function parseThaiNumber(text: string): number | null {
  const cleaned = text.replace(/[฿,\s]/g, "");
  if (cleaned === "" || cleaned === "-") return null;

  // ช่วงตัวเลข: ตัดที่ตัวคั่นช่วง (– en dash, — em dash, - hyphen) แล้วใช้ตัวแรก
  // ต้องเช็คหลังตัด , และช่องว่างแล้ว เพื่อให้ "17.52 – 21.90" กลายเป็น "17.52–21.90"
  const rangeMatch = cleaned.match(/^([\d.]+)[–—-][\d.]+$/);
  const target = rangeMatch ? rangeMatch[1] : cleaned;

  const kMatch = target.match(/^([\d.]+)[Kk]$/);
  if (kMatch) {
    const n = Number.parseFloat(kMatch[1]);
    return Number.isFinite(n) ? Math.round(n * 1000) : null;
  }

  if (!/^[\d.]+$/.test(target)) return null;
  const n = Number.parseFloat(target);
  return Number.isFinite(n) ? n : null;
}

/** ทำให้ชื่อสินค้าเทียบกันได้ตอนกันซ้ำ — ยุบช่องว่างซ้ำ ตัดหัวท้าย ลดเป็นตัวพิมพ์เล็ก */
export function normalizeName(name: string): string {
  return name.replace(/\s+/g, " ").trim().toLowerCase();
}

/** ตรวจธงเตือนจากชื่อสินค้าด้วยคำ ไม่ใช้ AI — ถูกกว่า เร็วกว่า และทดสอบได้ */
export function detectFlags(name: string): CandidateFlag[] {
  const flags: CandidateFlag[] = [];
  if (MECHANISM_WORDS.some((w) => name.includes(w))) flags.push("mechanism");
  if (HEAVY_TEXT_WORDS.some((w) => name.includes(w))) flags.push("heavyText");
  return flags;
}

/**
 * แยกผลลัพธ์ดิบจาก AI เป็นแถวสินค้า
 *
 * ฟอร์แมตที่คาดหวัง:
 *   หมวด: <ชื่อหมวด>
 *   <ชื่อสินค้า> | <ราคา> | <ค่าคอม> | <ยอดขาย>
 *
 * บรรทัดที่ผิดรูปหรือมีตัวเลขที่จำเป็นอ่านไม่ออก จะถูกข้ามเฉพาะบรรทัดนั้นและนับใน skipped
 * ไม่ throw — ปรัชญาเดียวกับ lib/caption.ts (อย่าทิ้งผลลัพธ์ที่จ่ายโควตาไปแล้วทั้งชุด)
 */
export function parseCandidateRows(raw: string): { rows: ParsedRow[]; skipped: number } {
  const rows: ParsedRow[] = [];
  let skipped = 0;
  let categoryLabel = "";

  for (const line of raw.split("\n")) {
    const trimmed = line.replace(/\*\*/g, "").trim();
    if (trimmed === "") continue;

    const headerMatch = trimmed.match(/^หมวด:\s*(.+)$/);
    if (headerMatch) {
      categoryLabel = headerMatch[1].trim();
      continue;
    }

    const parts = trimmed.split("|").map((p) => p.trim());
    if (parts.length !== 4) {
      skipped++;
      continue;
    }

    const [name, priceText, commissionText, salesText] = parts;
    const price = parseThaiNumber(priceText);
    const commission = parseThaiNumber(commissionText);
    if (name === "" || price === null || commission === null) {
      skipped++;
      continue;
    }

    rows.push({
      name,
      price,
      commission,
      weeklySales: parseThaiNumber(salesText),
      categoryLabel,
    });
  }

  return { rows, skipped };
}

/** %ค่าคอม — ราคา 0 คืน 0 แทน Infinity เพื่อไม่ให้ตารางพังถ้า AI อ่านราคาเพี้ยน */
export function commissionPercent(price: number, commission: number): number {
  if (price <= 0) return 0;
  return (commission / price) * 100;
}

/** ดีมานด์รวม — null เมื่อไม่มียอดขาย (แคปมาจากหน้า "คะแนนสูงสุด" ที่ไม่โชว์ตัวเลขนี้) */
export function demandTotal(commission: number, weeklySales: number | null): number | null {
  if (weeklySales === null) return null;
  return commission * weeklySales;
}
```

- [ ] **Step 4: รันเพื่อยืนยันว่าผ่าน**

Run: `node scripts/check-candidates.mjs`
Expected: PASS ทุกเคส และจบด้วย "ผ่านทุกเคส"

- [ ] **Step 5: เช็ก type + lint**

Run: `npx tsc --noEmit`
Expected: ไม่มี error

Run: `npm run lint`
Expected: ไม่มี error

- [ ] **Step 6: Commit**

```bash
git add lib/candidates.ts scripts/check-candidates.mjs
git commit -m "Add pure logic for product candidate parsing and scoring"
```

---

### Task 2: ตาราง `ProductCandidate` + คิวรี

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `lib/candidate-queries.ts`

**Interfaces:**
- Consumes: `commissionPercent`, `demandTotal`, `detectFlags`, `type CandidateFlag` จาก `@/lib/candidates` (Task 1)
- Produces:
  - `type CandidateRow = { id: string; name: string; price: number; commission: number; weeklySales: number | null; categoryLabel: string; capturedOn: Date; status: string; note: string; linkedEntryId: string | null; commissionPercent: number; demandTotal: number | null; flags: CandidateFlag[] }`
  - `type CategorySummary = { label: string; count: number; lastCapturedOn: Date }`
  - `type FocusCategory = { label: string; ratePercent: number; orderCount: number }`
  - `getCandidatesData(): Promise<{ rows: CandidateRow[]; summaries: CategorySummary[]; benchmarkPercent: number; benchmarkOrderCount: number; focus: FocusCategory[] }>`

- [ ] **Step 1: เพิ่ม model ใน `prisma/schema.prisma`**

เพิ่มต่อท้ายไฟล์:

```prisma
/// สินค้าที่กำลังพิจารณาว่าจะทำคลิปไหม — มาจากแคปหน้าจัดอันดับ TikTok Shop
///
/// ไม่ผูก relation กับ PromptEntry โดยตั้งใจ (เก็บ linkedEntryId เป็น String เปล่า)
/// เพราะประวัติการตัดสินใจไม่ควรหายตามเมื่อ entry ถูกลบ
model ProductCandidate {
  id            String   @id @default(cuid())
  /// ชื่อเต็มตามภาพ ไม่ย่อ
  name          String
  /// normalizeName(name) — ใช้จับคู่ตอน upsert กันข้อมูลซ้ำเมื่อแคปสินค้าเดิมอีกรอบ
  nameKey       String   @unique
  price         Float
  commission    Float
  /// null = แคปมาจากหน้าที่ไม่มีตัวเลขยอดขาย (แถบ "คะแนนสูงสุด")
  weeklySales   Int?
  /// ชื่อหมวดที่ AI อ่านจากหัวข้อบนสุดของภาพ
  categoryLabel String
  capturedOn    DateTime
  /// "new" | "interested" | "rejected" | "done"
  status        String   @default("new")
  note          String   @default("")
  linkedEntryId String?
  createdAt     DateTime @default(now())

  @@index([status])
  @@index([categoryLabel])
}
```

- [ ] **Step 2: สร้าง migration + generate client**

Run: `npx prisma migrate dev --name add-product-candidate`
Expected: สร้าง migration สำเร็จ ไม่มี prompt ค้าง

Run: `npx prisma generate`
Expected: generate สำเร็จ

- [ ] **Step 3: เขียน `lib/candidate-queries.ts`**

```ts
import { prisma } from "@/lib/prisma";
import {
  commissionPercent,
  demandTotal,
  detectFlags,
  type CandidateFlag,
} from "@/lib/candidates";

export type CandidateRow = {
  id: string;
  name: string;
  price: number;
  commission: number;
  weeklySales: number | null;
  categoryLabel: string;
  capturedOn: Date;
  status: string;
  note: string;
  linkedEntryId: string | null;
  commissionPercent: number;
  demandTotal: number | null;
  flags: CandidateFlag[];
};

export type CategorySummary = {
  label: string;
  count: number;
  lastCapturedOn: Date;
};

export type FocusCategory = {
  label: string;
  ratePercent: number;
  orderCount: number;
};

/**
 * จับกลุ่มหมวดจากคำในชื่อสินค้า — ใช้กับ "แถบเตือนหมวดที่ควรโฟกัส" เท่านั้น
 *
 * ห้ามเอาไปใช้กับเกณฑ์ตัดสิน 🟢/🔴 (ดูสเปกหัวข้อ "หมายเหตุความไม่สมมาตรที่ตั้งใจ") —
 * แถบเตือนจับกลุ่มพลาดก็แค่เลขบนป้ายคลาดเคลื่อน แต่เกณฑ์ตัดสินขับการตัดสินใจจริง
 * จึงใช้ค่ารวมทั้งร้านที่ไม่มีทางเพี้ยนแทน
 */
function categorize(productName: string): string | null {
  const n = productName;
  if (/แมว|หมา|สุนัข|สัตว์|กระต่าย/.test(n)) return "สัตว์เลี้ยง";
  if (/หม้อ|กระทะ|ช้อน|เขียง|ถ้วย|ชาม|ครัว|กระปุก/.test(n)) return "เครื่องครัว";
  if (/ชั้นวาง|รถเข็น|ตู้|เคาเตอร์|โต๊ะ|ราวตาก|ม่าน|กล่องเก็บ/.test(n)) return "จัดระเบียบบ้าน";
  return null;
}

export async function getCandidatesData(): Promise<{
  rows: CandidateRow[];
  summaries: CategorySummary[];
  benchmarkPercent: number;
  benchmarkOrderCount: number;
  focus: FocusCategory[];
}> {
  const [candidates, paidOrders] = await Promise.all([
    prisma.productCandidate.findMany({ orderBy: { capturedOn: "desc" } }),
    prisma.affiliateOrder.findMany({
      where: { finalRevenue: { gt: 0 } },
      select: { productName: true, gmv: true, finalRevenue: true },
    }),
  ]);

  const rows: CandidateRow[] = candidates.map((c) => ({
    id: c.id,
    name: c.name,
    price: c.price,
    commission: c.commission,
    weeklySales: c.weeklySales,
    categoryLabel: c.categoryLabel,
    capturedOn: c.capturedOn,
    status: c.status,
    note: c.note,
    linkedEntryId: c.linkedEntryId,
    commissionPercent: commissionPercent(c.price, c.commission),
    demandTotal: demandTotal(c.commission, c.weeklySales),
    flags: detectFlags(c.name),
  }));

  // สรุปรายหมวด — นับจำนวนและหาวันเก็บล่าสุดของแต่ละหมวด
  const byCategory = new Map<string, { count: number; last: Date }>();
  for (const c of candidates) {
    const key = c.categoryLabel.trim() === "" ? "ไม่ระบุหมวด" : c.categoryLabel;
    const prev = byCategory.get(key);
    if (!prev) {
      byCategory.set(key, { count: 1, last: c.capturedOn });
    } else {
      prev.count++;
      if (c.capturedOn > prev.last) prev.last = c.capturedOn;
    }
  }
  const summaries: CategorySummary[] = [...byCategory.entries()]
    .map(([label, v]) => ({ label, count: v.count, lastCapturedOn: v.last }))
    .sort((a, b) => b.lastCapturedOn.getTime() - a.lastCapturedOn.getTime());

  // เกณฑ์ตัดสิน 🟢/🔴 — ค่าคอมจริงเฉลี่ยรวมทั้งร้าน (settled ÷ GMV) คำนวณสดทุกครั้ง
  // ใช้ค่าเดียวรวมทุกหมวดโดยตั้งใจ: ไม่ต้องมีตารางจับคู่หมวดที่ต้องดูแล และหมวดที่
  // ไม่เคยขายมาก่อนก็ยังมีค่าเทียบเสมอ
  let benchGmv = 0;
  let benchRev = 0;
  for (const o of paidOrders) {
    benchGmv += o.gmv;
    benchRev += o.finalRevenue ?? 0;
  }
  const benchmarkPercent = benchGmv > 0 ? (benchRev / benchGmv) * 100 : 0;

  // แถบเตือนหมวดที่ควรโฟกัส — ต้องมีจำนวนออเดอร์กำกับเสมอ เพราะบางหมวด %สูง
  // แต่มาจากออเดอร์น้อยมาก ถ้าโชว์แต่ % จะอ่านผิดว่าหมวดนั้นดีกว่า
  const focusMap = new Map<string, { gmv: number; rev: number; n: number }>();
  for (const o of paidOrders) {
    const cat = categorize(o.productName);
    if (cat === null) continue;
    const prev = focusMap.get(cat) ?? { gmv: 0, rev: 0, n: 0 };
    prev.gmv += o.gmv;
    prev.rev += o.finalRevenue ?? 0;
    prev.n++;
    focusMap.set(cat, prev);
  }
  const focus: FocusCategory[] = [...focusMap.entries()]
    .map(([label, v]) => ({
      label,
      ratePercent: v.gmv > 0 ? (v.rev / v.gmv) * 100 : 0,
      orderCount: v.n,
    }))
    .sort((a, b) => b.ratePercent - a.ratePercent);

  return {
    rows,
    summaries,
    benchmarkPercent,
    benchmarkOrderCount: paidOrders.length,
    focus,
  };
}
```

- [ ] **Step 4: เช็ก type + lint**

Run: `npx tsc --noEmit`
Expected: ไม่มี error

Run: `npm run lint`
Expected: ไม่มี error

- [ ] **Step 5: ยืนยันว่าตารางใหม่ใช้งานได้จริง**

Run:
```bash
npx prisma db execute --stdin <<< "SELECT name FROM sqlite_master WHERE type='table' AND name='ProductCandidate';"
```
Expected: เจอตาราง `ProductCandidate`

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations lib/candidate-queries.ts
git commit -m "Add ProductCandidate table and queries"
```

---

### Task 3: สกัดข้อมูลจากรูปด้วย Gemini + server actions

**Files:**
- Modify: `lib/gemini.ts`
- Modify: `app/actions.ts`

**Interfaces:**
- Consumes:
  - `parseCandidateRows`, `normalizeName` จาก `@/lib/candidates` (Task 1)
  - ตาราง `ProductCandidate` (Task 2)
- Produces:
  - `extractCandidateRows(args: { images: GeminiImage[] }): Promise<string>` ใน `lib/gemini.ts`
  - `extractCandidates(formData: FormData): Promise<{ added: number; updated: number; skipped: number }>` ใน `app/actions.ts`
  - `setCandidateStatus(id: string, status: string, note?: string): Promise<void>`
  - `createEntryFromCandidate(id: string): Promise<string>` (คืน id ของ entry ที่สร้าง)

- [ ] **Step 1: เพิ่มตัวสกัดใน `lib/gemini.ts`**

เพิ่มต่อท้ายไฟล์ (หลัง `suggestAngleOptions`):

```ts
const CANDIDATE_INSTRUCTION = `คุณคือผู้ช่วยอ่านตารางจัดอันดับสินค้าจากภาพแคปหน้าจอ TikTok Shop
อ่านทุกภาพที่แนบมา แล้วตอบกลับตามรูปแบบนี้เท่านั้น:

หมวด: <ชื่อหมวดจากหัวข้อบนสุดของภาพ>
<ชื่อสินค้าเต็ม> | <ราคาขาย> | <ค่าคอม> | <ยอดขายต่อสัปดาห์>
<ชื่อสินค้าเต็ม> | <ราคาขาย> | <ค่าคอม> | <ยอดขายต่อสัปดาห์>

กติกา:
- ชื่อสินค้าให้เอาเต็มตามที่เห็นในภาพ ห้ามย่อ ห้ามสรุป
- ตัวเลขให้คัดลอกตามที่เห็น รวมสัญลักษณ์ K เช่น 13.9K (ห้ามแปลงเป็น 13900 เอง)
- ราคาขายคือตัวเลขราคาสินค้า ส่วนค่าคอมคือตัวเลขที่ขึ้นต้นด้วยคำว่า "รับ"
- ยอดขายคือตัวเลขในข้อความ "ขายได้ X ชิ้นในสัปดาห์ที่ผ่านมา"
- ถ้าช่องใดไม่มีในภาพ ให้ใส่ขีด - แทน (เช่นหน้าที่โชว์ "รีวิวเชิงบวก 100.0%" แทนยอดขาย)
- ถ้ามีหลายหมวดในภาพเดียว ให้ขึ้นบรรทัด "หมวด:" ใหม่ก่อนกลุ่มสินค้าของหมวดนั้น
- ห้ามใส่หัวข้ออื่น ห้ามอธิบาย ห้ามสรุปท้าย`;

/**
 * อ่านตารางจัดอันดับสินค้าจากภาพ คืนข้อความดิบให้ parseCandidateRows แยกต่อ
 *
 * ล็อกที่ EXTRACT_MODEL เหมือน extractProductFields — เป็นงานอ่านข้อความจากภาพ
 * ไม่ใช่งานตีความภาพเชิงลึกแบบ extractProductSpec ที่ให้ผู้ใช้เลือกโมเดลเอง
 */
export async function extractCandidateRows(args: {
  images: GeminiImage[];
}): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("ยังไม่ได้ตั้งค่า GEMINI_API_KEY ในไฟล์ .env");
  }

  const client = new GoogleGenAI({ apiKey });
  const input: object[] = [];
  for (const image of args.images) {
    input.push({ type: "image", data: image.base64, mime_type: image.mimeType });
  }

  const response = await client.interactions.create({
    model: EXTRACT_MODEL,
    // snake_case — camelCase จะถูก API เมินแบบเงียบๆ
    system_instruction: CANDIDATE_INSTRUCTION,
    // temperature 0 — งานคัดลอกตัวเลข ไม่ใช่งานสร้างสรรค์
    generation_config: { temperature: 0 },
    input,
  });

  const text = response.output_text;
  if (!text || text.trim() === "") {
    throw new Error("AI ไม่ได้ตอบกลับตอนอ่านข้อมูลจากรูป ลองใหม่อีกครั้ง");
  }
  return text;
}
```

- [ ] **Step 2: เพิ่ม import ใน `app/actions.ts`**

หา import เดิมจาก `@/lib/gemini` แล้วเพิ่ม `extractCandidateRows` เข้าไปในวงเล็บ · แล้วเพิ่มบรรทัดใหม่:

```ts
import { normalizeName, parseCandidateRows } from "@/lib/candidates";
```

- [ ] **Step 3: เพิ่ม 3 action ต่อท้าย `app/actions.ts`**

```ts
/**
 * อ่านแคปหน้าจัดอันดับสินค้า แล้ว upsert ลง ProductCandidate
 *
 * รูปอยู่ใน memory เท่านั้น ไม่เขียนดิสก์ ไม่สร้างแถว ProductImage — เป็นแคปหน้าจัดอันดับ
 * คนละชุดกับรูปสินค้าจริง ปนกันแล้ว 10-part prompt จะเพี้ยน
 */
export async function extractCandidates(
  formData: FormData
): Promise<{ added: number; updated: number; skipped: number }> {
  const rawFiles = formData.getAll("files");
  const files: File[] = [];
  for (const value of rawFiles) {
    if (value instanceof File && value.size > 0) files.push(value);
  }
  if (files.length === 0) {
    throw new Error("กรุณาแนบแคปหน้าจัดอันดับสินค้าอย่างน้อย 1 รูป");
  }

  for (const file of files) {
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      throw new Error("รองรับเฉพาะไฟล์ JPEG, PNG, WebP");
    }
    if (file.size > MAX_IMAGE_BYTES) {
      throw new Error("ไฟล์ใหญ่เกิน 10MB");
    }
  }

  const images = await Promise.all(
    files.map(async (file) => ({
      base64: Buffer.from(await file.arrayBuffer()).toString("base64"),
      mimeType: file.type,
      caption: "",
    }))
  );

  const raw = await extractCandidateRows({ images });
  const { rows, skipped } = parseCandidateRows(raw);

  const capturedOn = new Date();
  let added = 0;
  let updated = 0;

  for (const row of rows) {
    const nameKey = normalizeName(row.name);
    const existing = await prisma.productCandidate.findUnique({ where: { nameKey } });
    if (existing) {
      // อัปเดตตัวเลขล่าสุด แต่คง status/note/linkedEntryId เดิม — ปัดตกแล้วต้องไม่กลับมา
      await prisma.productCandidate.update({
        where: { nameKey },
        data: {
          name: row.name,
          price: row.price,
          commission: row.commission,
          weeklySales: row.weeklySales,
          categoryLabel: row.categoryLabel,
          capturedOn,
        },
      });
      updated++;
    } else {
      await prisma.productCandidate.create({
        data: {
          name: row.name,
          nameKey,
          price: row.price,
          commission: row.commission,
          weeklySales: row.weeklySales,
          categoryLabel: row.categoryLabel,
          capturedOn,
        },
      });
      added++;
    }
  }

  revalidatePath("/products");
  return { added, updated, skipped };
}

export async function setCandidateStatus(
  id: string,
  status: string,
  note?: string
): Promise<void> {
  await prisma.productCandidate.update({
    where: { id },
    data: { status, ...(note === undefined ? {} : { note }) },
  });
  revalidatePath("/products");
}

/**
 * สร้าง PromptEntry จากสินค้าที่เลือก แล้วผูกกลับมาที่ candidate
 * ทำตามแบบ createEntryFromOrder — สร้าง entry ขั้นต่ำแล้วให้ผู้ใช้ไปกรอกต่อในหน้า entry
 */
export async function createEntryFromCandidate(id: string): Promise<string> {
  const candidate = await prisma.productCandidate.findUnique({ where: { id } });
  if (!candidate) {
    throw new Error("ไม่พบสินค้าที่เลือก");
  }

  // ต้องใส่ kind: "core" เสมอ ไม่งั้นได้ SEO prompt มาแทน
  const active = await prisma.corePrompt.findFirst({
    where: { isActive: true, kind: "core" },
  });

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
    where: { id },
    data: { status: "done", linkedEntryId: created.id },
  });

  revalidatePath("/products");
  revalidatePath("/");
  return created.id;
}
```

- [ ] **Step 4: เช็ก type + lint**

Run: `npx tsc --noEmit`
Expected: ไม่มี error

Run: `npm run lint`
Expected: ไม่มี error

- [ ] **Step 5: Commit**

```bash
git add lib/gemini.ts app/actions.ts
git commit -m "Add Gemini extraction and server actions for product candidates"
```

---

### Task 4: หน้า `/products` + UI

**Files:**
- Create: `app/products/page.tsx`
- Create: `components/candidates-route.tsx`
- Modify: `components/app-header.tsx`

**Interfaces:**
- Consumes:
  - `getCandidatesData`, `type CandidateRow`, `type CategorySummary`, `type FocusCategory` จาก `@/lib/candidate-queries` (Task 2)
  - `extractCandidates`, `setCandidateStatus`, `createEntryFromCandidate` จาก `@/app/actions` (Task 3)
  - `playCompletionSound` จาก `@/lib/completion-sound` (มีอยู่แล้วในโปรเจกต์)
  - `IMPORT_STALE_DAYS` จาก `@/lib/import-schedule` (มีอยู่แล้ว)
- Produces: หน้าใช้งานจริงที่ `/products` — ไม่มีใครใช้ต่อจากนี้

- [ ] **Step 1: เพิ่มเมนูใน `components/app-header.tsx`**

แก้ 2 จุด — บรรทัด `export type NavKey`:

```ts
export type NavKey = "list" | "entry" | "core" | "dashboard" | "products";
```

และ array `NAV` (เพิ่ม "หาสินค้า" ต่อจาก "รายการสินค้า"):

```ts
const NAV: { key: NavKey; href: string; label: string }[] = [
  { key: "list", href: "/", label: "รายการสินค้า" },
  { key: "products", href: "/products", label: "หาสินค้า" },
  { key: "core", href: "/core-prompt", label: "Core Prompt" },
  { key: "dashboard", href: "/dashboard", label: "รายได้" },
];
```

- [ ] **Step 2: สร้าง `app/products/page.tsx`**

```tsx
import { getCandidatesData } from "@/lib/candidate-queries";
import { AppHeader } from "@/components/app-header";
import { CandidatesRoute } from "@/components/candidates-route";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const data = await getCandidatesData();

  return (
    <div className="flex min-h-screen flex-1 flex-col lg:h-screen lg:overflow-hidden">
      <AppHeader active="products" />
      <div className="flex flex-1 flex-col p-4 sm:p-6 lg:overflow-y-auto">
        <CandidatesRoute
          rows={data.rows}
          summaries={data.summaries}
          benchmarkPercent={data.benchmarkPercent}
          benchmarkOrderCount={data.benchmarkOrderCount}
          focus={data.focus}
          now={new Date()}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: สร้าง `components/candidates-route.tsx`**

```tsx
"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { ClipboardPaste, Lightbulb, Package, TriangleAlert, X } from "lucide-react";

import {
  createEntryFromCandidate,
  extractCandidates,
  setCandidateStatus,
} from "@/app/actions";
import type {
  CandidateRow,
  CategorySummary,
  FocusCategory,
} from "@/lib/candidate-queries";
import { playCompletionSound } from "@/lib/completion-sound";
import { IMPORT_STALE_DAYS } from "@/lib/import-schedule";
import { Button } from "@/components/ui/button";

const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

type StatusFilter = "active" | "all" | "new" | "interested" | "rejected";

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "active", label: "ยังไม่ปัดตก" },
  { key: "new", label: "ยังไม่ตัดสิน" },
  { key: "interested", label: "สนใจ" },
  { key: "rejected", label: "ปัดตกแล้ว" },
  { key: "all", label: "ทั้งหมด" },
];

function imageFilesFrom(list: FileList | null | undefined): File[] {
  if (!list) return [];
  return Array.from(list).filter((f) => ALLOWED.includes(f.type));
}

function formatThaiDate(d: Date): string {
  return d.toLocaleDateString("th-TH", { day: "numeric", month: "short" });
}

function daysBetween(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

export function CandidatesRoute({
  rows,
  summaries,
  benchmarkPercent,
  benchmarkOrderCount,
  focus,
  now,
}: {
  rows: CandidateRow[];
  summaries: CategorySummary[];
  benchmarkPercent: number;
  benchmarkOrderCount: number;
  focus: FocusCategory[];
  now: Date;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("active");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [isExtracting, startExtracting] = useTransition();
  const [, startUpdating] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const visible = useMemo(() => {
    let list = rows;
    if (filter === "active") list = list.filter((r) => r.status !== "rejected");
    else if (filter !== "all") list = list.filter((r) => r.status === filter);
    if (categoryFilter !== null) {
      list = list.filter((r) => (r.categoryLabel || "ไม่ระบุหมวด") === categoryFilter);
    }
    // เรียงตามดีมานด์รวมมากไปน้อย แถวที่ไม่มีดีมานด์รวม (ขาดยอดขาย) ไปท้ายสุด
    return [...list].sort((a, b) => (b.demandTotal ?? -1) - (a.demandTotal ?? -1));
  }, [rows, filter, categoryFilter]);

  function handleExtract() {
    if (files.length === 0) return;
    setError(null);
    setResult(null);
    startExtracting(async () => {
      let outcome: "success" | "error" = "success";
      try {
        const formData = new FormData();
        for (const f of files) formData.append("files", f);
        const r = await extractCandidates(formData);
        setFiles([]);
        setResult(
          `เพิ่มใหม่ ${r.added} รายการ · อัปเดต ${r.updated} รายการ` +
            (r.skipped > 0 ? ` · ข้ามบรรทัดที่อ่านไม่ออก ${r.skipped}` : "")
        );
      } catch (e) {
        outcome = "error";
        setError(e instanceof Error ? e.message : "อ่านข้อมูลจากรูปไม่สำเร็จ");
      }
      playCompletionSound(outcome);
    });
  }

  function handleStatus(id: string, status: string) {
    startUpdating(async () => {
      try {
        await setCandidateStatus(id, status);
      } catch (e) {
        setError(e instanceof Error ? e.message : "อัปเดตสถานะไม่สำเร็จ");
      }
    });
  }

  function handleCreate(id: string) {
    startUpdating(async () => {
      try {
        await createEntryFromCandidate(id);
      } catch (e) {
        setError(e instanceof Error ? e.message : "สร้างรายการไม่สำเร็จ");
      }
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {/* แถบเตือนหมวดที่ควรโฟกัส — ต้องมีจำนวนออเดอร์กำกับเสมอ เพราะบางหมวด %สูง
          แต่มาจากออเดอร์น้อยมาก ถ้าโชว์แต่ % จะอ่านผิดว่าหมวดนั้นดีกว่า */}
      <section className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-5 leading-relaxed">
        <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <Lightbulb className="size-4 shrink-0 text-primary" />
          หมวดที่ควรโฟกัส — อ้างอิงค่าคอมจริงจากยอดขายของคุณเอง
        </p>
        {focus.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            ยังไม่มีข้อมูลยอดขายพอจะคำนวณ — นำเข้าไฟล์รายได้ในแท็บรายได้ก่อน
          </p>
        ) : (
          <p className="text-sm text-foreground/80">
            {focus.map((f, i) => (
              <span key={f.label}>
                {i > 0 && <span className="text-muted-foreground"> · </span>}
                {f.label} {f.ratePercent.toFixed(1)}%{" "}
                <span className="text-muted-foreground">({f.orderCount} ออเดอร์)</span>
              </span>
            ))}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          แคปจากหน้า &quot;ขายดีที่สุด&quot; (รายการเต็ม 15 อันดับ) เท่านั้น — หมวดอื่นก็แคปได้ ระบบไม่ได้จำกัด
        </p>
      </section>

      {/* สรุปหมวดที่เก็บมาแล้ว */}
      {summaries.length > 0 && (
        <section className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-5 leading-relaxed">
          <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <Package className="size-4 shrink-0 text-primary" />
            เก็บมาแล้วในระบบ
          </p>
          <div className="flex flex-wrap gap-2">
            {summaries.map((s) => {
              const age = daysBetween(s.lastCapturedOn, now);
              const stale = age > IMPORT_STALE_DAYS;
              const selected = categoryFilter === s.label;
              return (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => setCategoryFilter(selected ? null : s.label)}
                  aria-pressed={selected}
                  className={
                    "inline-flex h-9 items-center gap-1.5 rounded-lg border border-border-interactive px-3 text-sm transition-colors " +
                    (selected
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground hover:bg-foreground/5")
                  }
                >
                  {s.label} {s.count} รายการ
                  <span className={selected ? "text-primary-foreground/80" : "text-muted-foreground"}>
                    · {formatThaiDate(s.lastCapturedOn)}
                  </span>
                  {stale && <TriangleAlert className="size-3.5 shrink-0 text-destructive" />}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* กล่องแปะรูป */}
      <section className="flex flex-col gap-3 rounded-xl border border-dashed border-border-interactive bg-surface p-5">
        <div
          role="button"
          tabIndex={0}
          aria-label="เลือกแคปหน้าจัดอันดับสินค้า"
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
          }}
          onPaste={(e) => {
            const picked = imageFilesFrom(e.clipboardData?.files);
            if (picked.length > 0) {
              e.preventDefault();
              setFiles((prev) => [...prev, ...picked]);
            }
          }}
          className="flex cursor-pointer flex-col gap-2"
        >
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <ClipboardPaste className="size-4 shrink-0" />
            กดที่นี่แล้ว Ctrl+V เพื่อแปะแคป หรือกดเพื่อเลือกไฟล์ (แปะหลายใบพร้อมกันได้)
          </p>
          {files.length > 0 && (
            <p className="text-sm text-foreground">แนบไว้ {files.length} รูป</p>
          )}
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={(e) => {
              setFiles((prev) => [...prev, ...imageFilesFrom(e.target.files)]);
              e.target.value = "";
            }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            onClick={handleExtract}
            disabled={isExtracting || files.length === 0}
          >
            {isExtracting ? "กำลังอ่าน..." : "อ่านข้อมูลจากรูป"}
          </Button>
          {files.length > 0 && (
            <Button type="button" variant="outline" onClick={() => setFiles([])}>
              <X className="size-4" />
              ล้างรูป
            </Button>
          )}
        </div>
        {result && <p className="text-sm text-foreground/80">{result}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </section>

      {/* ตัวกรองสถานะ */}
      <div className="inline-flex flex-wrap gap-1 self-start rounded-lg border border-border-interactive p-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className={
              "inline-flex h-9 items-center rounded-md px-3 text-sm font-medium transition-colors " +
              (filter === f.key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground")
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* ตารางผลลัพธ์ */}
      {visible.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface p-5 text-sm leading-relaxed text-muted-foreground">
          ยังไม่มีสินค้าในรายการนี้ — แปะแคปหน้าจัดอันดับสินค้าด้านบนเพื่อเริ่ม
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {visible.map((r) => {
            const better = benchmarkOrderCount > 0 && r.commissionPercent > benchmarkPercent;
            return (
              <li
                key={r.id}
                className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-5 leading-relaxed"
              >
                <div className="flex flex-wrap items-start gap-2">
                  <span
                    aria-hidden
                    className={
                      "mt-1 size-2.5 shrink-0 rounded-full " +
                      (benchmarkOrderCount === 0
                        ? "bg-muted-foreground"
                        : better
                          ? "bg-primary"
                          : "bg-destructive")
                    }
                  />
                  <p className="flex-1 text-base font-medium text-foreground">{r.name}</p>
                </div>

                <p className="text-sm text-foreground/80">
                  ราคา {r.price.toLocaleString()} · ค่าคอม {r.commission.toLocaleString()} ·{" "}
                  {r.weeklySales === null
                    ? "ไม่มีข้อมูลยอดขาย"
                    : `ขายได้ ${r.weeklySales.toLocaleString()}/สัปดาห์`}
                </p>

                <p className="text-sm text-foreground/80">
                  ได้ {r.commissionPercent.toFixed(1)}%
                  {benchmarkOrderCount === 0
                    ? " — ยังไม่มีข้อมูลยอดขายมาเทียบ"
                    : better
                      ? ` — ดีกว่าค่าคอมจริงเฉลี่ยของคุณ (${benchmarkPercent.toFixed(1)}%)`
                      : ` — ต่ำกว่าค่าคอมจริงเฉลี่ยของคุณ (${benchmarkPercent.toFixed(1)}%)`}
                </p>

                {r.demandTotal === null ? (
                  <p className="flex items-start gap-1.5 text-sm text-destructive">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                    แถวนี้ไม่มีตัวเลขยอดขาย (น่าจะมาจากหน้า &quot;คะแนนสูงสุด&quot;) จัดอันดับให้ไม่ได้ —
                    ลองแคปจากหน้า &quot;ขายดีที่สุด&quot; แทน
                  </p>
                ) : (
                  <p className="text-sm text-foreground/80">
                    ดีมานด์รวม {Math.round(r.demandTotal).toLocaleString()}
                  </p>
                )}

                {r.flags.includes("mechanism") && (
                  <p className="flex items-start gap-1.5 text-sm text-foreground/80">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0 text-primary" />
                    ชื่อบ่งบอกว่าอาจมีกลไก (พับ/หมุน/ปรับระดับ) — ตรวจรูปสินค้าก่อนทำ
                  </p>
                )}
                {r.flags.includes("heavyText") && (
                  <p className="flex items-start gap-1.5 text-sm text-foreground/80">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0 text-primary" />
                    อาจมีฉลาก/ข้อความบนตัวสินค้าเยอะ — AI สร้างวิดีโอมักทำตัวหนังสือเพี้ยน
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {r.status === "done" ? (
                    <span className="text-sm text-muted-foreground">สร้างรายการแล้ว</span>
                  ) : (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => handleStatus(r.id, "interested")}
                        disabled={r.status === "interested"}
                      >
                        {r.status === "interested" ? "สนใจอยู่" : "สนใจ"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => handleStatus(r.id, "rejected")}
                        disabled={r.status === "rejected"}
                      >
                        {r.status === "rejected" ? "ปัดตกแล้ว" : "ปัดตก"}
                      </Button>
                      <Button type="button" size="sm" onClick={() => handleCreate(r.id)}>
                        สร้างงานเลย
                      </Button>
                    </>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {r.categoryLabel || "ไม่ระบุหมวด"} · เก็บ {formatThaiDate(r.capturedOn)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: เช็ก type + lint**

Run: `npx tsc --noEmit`
Expected: ไม่มี error

Run: `npm run lint`
Expected: ไม่มี error

- [ ] **Step 5: ตรวจด้วยตาผ่าน isolated dev server**

```bash
cp dev.db dev-test.db
NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001
```

เปิด `http://localhost:3001/products` ตรวจ:
- เมนู "หาสินค้า" ขึ้นในแถบเมนู และไฮไลต์เมื่ออยู่หน้านี้
- แถบหมวดที่ควรโฟกัสแสดง % พร้อมจำนวนออเดอร์ในวงเล็บทุกหมวด
- แปะรูปจริงจาก `C:\Users\patip\Desktop\screenshot tiktok` (เลือกรูปที่เป็นรายการเต็ม เช่นที่มีชื่อสินค้า+ราคา) → กด "อ่านข้อมูลจากรูป" → ได้ยินเสียงแจ้งเตือน → ขึ้นสรุปจำนวนที่เพิ่ม/อัปเดต
- ตารางเรียงจากดีมานด์รวมมากไปน้อย · จุดสีเขียว/แดงตรงกับ %ค่าคอมเทียบเกณฑ์
- กด "ปัดตก" แล้วแถวหายจากตัวกรอง "ยังไม่ปัดตก" · กดตัวกรอง "ปัดตกแล้ว" เห็นแถวนั้น
- แปะรูปชุดเดิมซ้ำอีกครั้ง → รายการที่ปัดตกไว้ยังคงสถานะ "ปัดตกแล้ว" ไม่กลับมา
- กด "สร้างงานเลย" → ไปดูหน้า `/` เห็นรายการใหม่ชื่อตรงกับสินค้านั้น
- กดชื่อหมวดในกล่อง "เก็บมาแล้วในระบบ" แล้วตารางกรองเฉพาะหมวดนั้น กดซ้ำเพื่อยกเลิก
- ไม่มี console error / hydration warning

หลังตรวจเสร็จ: kill dev server · `rm dev-test.db` · `git diff tsconfig.json` ต้องว่าง (ถ้าไม่ว่าง `git checkout -- tsconfig.json`)

- [ ] **Step 6: Commit**

```bash
git add app/products/page.tsx components/candidates-route.tsx components/app-header.tsx
git commit -m "Add product candidates page with ranking and screening"
```
