# Angle Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เก็บ "angle" (มุมนำเสนอ) ต่อคลิป ให้ AI เสนอ angle ใหม่ที่ไม่ซ้ำของเดิมโดยดูจากคลิปก่อนหน้าของสินค้าเดียวกัน และส่ง angle ที่เลือกเข้าโจทย์ตอนสร้าง 10-part prompt

**Architecture:** ตรรกะทั้งหมด (หาสายเลือดการทำซ้ำ, คัด angle ที่ใช้แล้ว, สกัด angle จาก prompt เก่า, parse คำตอบโมเดล, สรุปผลลัพธ์ต่อ entry) อยู่ใน `lib/angle.ts` เป็น pure function ล้วน ทดสอบด้วยสคริปต์ node ได้ · `lib/gemini.ts` เป็นไฟล์เดียวที่รู้จัก SDK เหมือนเดิม · UI แยกเป็น `components/angle-panel.tsx` ไม่ยัดเพิ่มใน `brief-form.tsx` ที่ใหญ่อยู่แล้ว · ช่อง angle บันทึกลง DB ผ่าน server action ของตัวเอง (ไม่ผ่าน form submit) เพราะ `generateWithAI` อ่านค่าจาก DB

**Tech Stack:** Next.js 16.2.10 (custom build) · Prisma 7 + SQLite (`@prisma/adapter-better-sqlite3`) · `@google/genai` · React 19 Server Actions · Tailwind v4 CSS-first · lucide-react v1.23.0

**Spec:** `docs/superpowers/specs/2026-07-26-angle-tracking-design.md`

## Global Constraints

- **ห้ามรัน `npm run build` หรือ `npm run dev` บนพอร์ต 3000** — ผู้ใช้รัน `start.bat` อยู่และใช้แอปทำงานหาเงินจริงทุกวัน ใช้ `npx tsc --noEmit` แทน build · ถ้าต้องรันแอปให้ใช้ isolated dev server เท่านั้น: `cp dev.db dev-test.db` แล้ว `NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001` แล้ว cleanup ด้วย `rm -rf .next-dev dev-test.db`
- **ห้ามแตะ `dev.db` ตัวจริงในการทดสอบที่มีการเขียน** — อ่านแบบ `readonly: true` ได้ · ห้าม `DELETE FROM` แบบไม่มี `WHERE`
- **สคริปต์ตรวจ/ทดสอบต้องเขียนเป็นไฟล์ `.js` จริงด้วย Write tool ในโฟลเดอร์ scratch** (ห้าม `node -e "..."` ผ่าน bash — git-bash แปลง path จนพัง) และ `require()` ด้วย absolute path เข้า `node_modules` ของ repo
- **ไม่มี test runner และไม่มี `tsx` ในโปรเจกต์ ห้ามติดตั้งเพิ่ม** — ทดสอบ pure function ด้วยการคอมไพล์ไฟล์เดียวไป scratch แล้วรันด้วย node: `npx tsc <file> --outDir "<scratch>/build" --module commonjs --target ES2017 --skipLibCheck`
- **Gemini API ใช้ snake_case**: `system_instruction` และ `generation_config` — สะกดเป็น camelCase แล้ว API **เงียบ ไม่ error** แต่คำสั่งจะไม่ถึงโมเดลเลย · ห้ามกลบ type error ด้วย `as any` · โมเดลต้องเป็นค่าใน `GEMINI_MODELS` เท่านั้น
- **Prisma 7**: หลังแก้ `prisma/schema.prisma` ต้อง `npx prisma migrate dev --name <name>` แล้วตามด้วย `npx prisma generate` · import client จาก `@/lib/generated/prisma/client` (ไม่มี index barrel)
- **ห้าม emoji** ทุกที่ · ข้อความ UI เป็นภาษาไทย
- **ใช้ design token เดิมเท่านั้น**: `ink` `paper` `marigold` `rust` `smoke` `record` `border` `card` `muted-foreground` `foreground` `primary-foreground` — ห้ามเพิ่มสีใหม่
- **ไอคอน lucide ต้องชื่อ canonical** — ตรวจแล้ว: `Compass` เป็นชื่อจริงใน `node_modules/lucide-react/dist/esm/icons/compass.mjs` (ห้ามเปลี่ยนไปใช้ชื่ออื่นโดยไม่เปิดไฟล์ `.mjs` เช็ก)
- **`git diff tsconfig.json` ต้องว่างก่อน commit ทุกครั้ง** (dev server แก้ไฟล์นี้เองได้ — repo pin `target: "ES2017"` ไว้ตั้งใจ) ถ้าไม่ว่างให้ `git checkout -- tsconfig.json`
- **ห้าม `git add -A`** — ระบุไฟล์ที่แก้เสมอ
- ทำงานบน branch `feature/angle-tracking` (สร้างแล้ว spec commit อยู่บนนั้น)
- **ห้ามแตะ `lib/recommender.ts`** (เพิ่มบรรทัดสถานะที่ชั้นแสดงผลเท่านั้น) · ห้ามแตะตรรกะการนำเข้าไฟล์ใน `app/actions.ts` · ห้ามแตะ `lib/weekly-scoreboard.ts` / `components/weekly-scoreboard.tsx`

---

### Task 1: `lib/angle.ts` — ตรรกะ angle ทั้งหมด (pure) + คอลัมน์ `angle`

**Files:**
- Modify: `prisma/schema.prisma` (model `PromptEntry`)
- Create: `lib/angle.ts`
- Create (scratch, ไม่ commit): `<scratch>/test-angle.js`

**Interfaces:**
- Consumes: ไม่มี (pure ล้วน รับ shape แคบๆ เป็น argument)
- Produces (Task 3-5 ใช้ต่อ):
  - `type LineageEntry = { id: string; duplicatedFromId: string | null }`
  - `type AngleEntry = LineageEntry & { angle: string; videoUrl: string; postedAt: Date | null; chatgptOutput: string }`
  - `type UsedAngle = { entryId: string; text: string; posted: boolean; postedAt: Date | null }`
  - `type AngleSuggestion = { text: string; why: string }`
  - `type EntryOutcome = { views: number | null; orders: number; settledRevenue: number }`
  - `type RepeatStatus = { repeats: number; postedRepeats: number; lastPostedAt: Date | null; hasUnposted: boolean }`
  - `function collectFamily<T extends LineageEntry>(entries: T[], entryId: string): T[]`
  - `function collectUsedAngles(family: AngleEntry[], currentId: string): UsedAngle[]`
  - `function extractAngleHints(output: string): string`
  - `function parseAngleSuggestions(raw: string): AngleSuggestion[]`
  - `function summarizeEntryOutcome(args: { entryId: string; orders: { matchedEntryId: string | null; finalRevenue: number | null }[]; metrics: { matchedEntryId: string | null; views: number; capturedOn: Date }[] }): EntryOutcome`
  - `function repeatStatus<T extends LineageEntry & { videoUrl: string; postedAt: Date | null }>(entries: T[], entryId: string): RepeatStatus`

- [ ] **Step 1: เพิ่มคอลัมน์ `angle` ใน schema**

ใน `prisma/schema.prisma` model `PromptEntry` เพิ่มบรรทัดนี้ต่อจาก `extraNotes  String`:

```prisma
  angle       String   @default("")
```

- [ ] **Step 2: รัน migration + generate**

Run: `npx prisma migrate dev --name add_angle_to_prompt_entry`
Expected: migration ใหม่ถูกสร้างและ apply สำเร็จ

Run: `npx prisma generate`
Expected: สำเร็จ ไม่มี error

- [ ] **Step 3: เขียนสคริปต์ทดสอบที่ยังไม่ผ่าน**

เขียนไฟล์ `<scratch>/test-angle.js` ด้วย Write tool (แทน `<scratch>` ด้วย scratchpad dir ของเซสชัน):

```js
const {
  collectFamily,
  collectUsedAngles,
  extractAngleHints,
  parseAngleSuggestions,
  summarizeEntryOutcome,
  repeatStatus,
} = require("<scratch>/build/angle.js");

let failed = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label} — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
}
function ok(label, cond, note) {
  if (!cond) failed++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${note ? " — " + note : ""}`);
}

// ---------- collectFamily ----------
const lineage = [
  { id: "A", duplicatedFromId: null },
  { id: "B", duplicatedFromId: "A" },
  { id: "C", duplicatedFromId: "B" },
  { id: "D", duplicatedFromId: null }, // คนละสินค้า ต้องไม่ปน
];
eq("family จากต้นฉบับ", collectFamily(lineage, "A").map((e) => e.id), ["A", "B", "C"]);
eq("family จากลูกกลาง", collectFamily(lineage, "B").map((e) => e.id), ["A", "B", "C"]);
eq("family จากลูกท้ายสุด", collectFamily(lineage, "C").map((e) => e.id), ["A", "B", "C"]);
eq("entry เดี่ยวได้ตัวเอง", collectFamily(lineage, "D").map((e) => e.id), ["D"]);
eq("id ที่ไม่มีอยู่ได้ลิสต์ว่าง", collectFamily(lineage, "ZZ"), []);
// พ่อถูกลบไปแล้ว — ต้องไม่พังและต้องหยุดที่ตัวเอง
eq(
  "พ่อหาย (entry ถูกลบ) ไม่พัง",
  collectFamily([{ id: "X", duplicatedFromId: "GONE" }], "X").map((e) => e.id),
  ["X"]
);

// ---------- collectUsedAngles ----------
const d = (iso) => new Date(iso);
const family = [
  // ลงคลิปแล้ว + ไม่มี angle เก็บไว้ -> ต้องสกัดจาก chatgptOutput
  {
    id: "A",
    duplicatedFromId: null,
    angle: "",
    videoUrl: "https://www.tiktok.com/@x/video/111",
    postedAt: d("2026-07-01T00:00:00.000Z"),
    chatgptOutput: "1. Style\nอะไรก็ได้\n\n2. Scene\nห้องนั่งเล่น แมวเล่นเอง\n\n3. Subject\nของเล่นไม้",
  },
  // ตั้ง angle ไว้แต่ยังไม่ลง -> นับเป็น "วางแผนไว้"
  {
    id: "B",
    duplicatedFromId: "A",
    angle: "เสียงกริ่งดึงแมว — มุมห้องนอน",
    videoUrl: "",
    postedAt: null,
    chatgptOutput: "1. Style\n...\n\n2. Scene\nไม่ควรถูกใช้\n\n3. Subject\n...",
  },
  // ร่างเปล่า: ยังไม่ลง + ไม่มี angle แต่ถือ chatgptOutput ของต้นฉบับมา -> ต้องถูกข้าม
  {
    id: "C",
    duplicatedFromId: "A",
    angle: "",
    videoUrl: "",
    postedAt: null,
    chatgptOutput: "1. Style\n...\n\n2. Scene\nห้องนั่งเล่น แมวเล่นเอง\n\n3. Subject\n...",
  },
  // ตัวที่กำลังแก้อยู่ -> ต้องถูกตัดออก
  {
    id: "SELF",
    duplicatedFromId: "A",
    angle: "ของฉันเอง",
    videoUrl: "",
    postedAt: null,
    chatgptOutput: "",
  },
];
const used = collectUsedAngles(family, "SELF");
eq("จำนวน angle ที่ใช้แล้ว (ข้ามร่างเปล่า + ข้ามตัวเอง)", used.map((u) => u.entryId), ["A", "B"]);
eq("A ถือว่าลงแล้ว", used[0].posted, true);
ok("A สกัดฉากจาก prompt เก่าได้", used[0].text.includes("ห้องนั่งเล่น"), used[0].text);
eq("B ใช้ angle ที่เก็บไว้ตรงๆ", used[1].text, "เสียงกริ่งดึงแมว — มุมห้องนอน");
eq("B ยังไม่ได้ลง", used[1].posted, false);

// ---------- extractAngleHints ----------
// แบบเยื้องบรรทัด (ข้อมูลจริง entry 12 ก.ค.)
const indented = `1. **Style**
   สร้างวิดีโอแนวตั้ง

2. **Scene**
   ฉากเดียวบนพื้นห้องนั่งเล่นในบ้านหรือคอนโด ให้แมวเล่นกับลูกบอลแขวน

3. **Subject**
   ของเล่นแมว

5. **Action Timeline**
   **Full voice-over script:**
   "แมว เบื่อ ของเล่น เดิม ง่าย ใช่ไหม ชุด นี้ มี เสา ลับเล็บ"

**00:00-00:02**
เปิดด้วยภาพสินค้า`;
const hintsIndented = extractAngleHints(indented);
ok("เยื้องบรรทัด: ได้ฉาก", hintsIndented.includes("ห้องนั่งเล่น"), hintsIndented);
ok("เยื้องบรรทัด: ได้บทพูด", hintsIndented.includes("เบื่อ"), hintsIndented);
ok("เยื้องบรรทัด: ไม่ลากเวลาเข้ามา", !hintsIndented.includes("00:00"), hintsIndented);

// แบบไม่เยื้อง (ข้อมูลจริง entry 26 ก.ค.)
const flat = `1. **Style**
สร้างวิดีโอแนวตั้ง

2. **Scene**
ฉากในมุมห้องนั่งเล่นที่มีแสงสว่าง พื้นไม้สะอาดตา

3. **Subject**
ที่ลับเล็บแมว 4 in 1

5. **Action Timeline**
**Full voice-over script:**
"เบื่อไหมคะ น้องแมวชอบข่วนเฟอร์นิเจอร์"

**00:00-00:02**
เปิดคลิปด้วยมือ`;
const hintsFlat = extractAngleHints(flat);
ok("ไม่เยื้อง: ได้ฉาก", hintsFlat.includes("แสงสว่าง"), hintsFlat);
ok("ไม่เยื้อง: ได้บทพูด", hintsFlat.includes("ข่วนเฟอร์นิเจอร์"), hintsFlat);

// ไม่มีหัวข้อเลย -> fallback ไม่ throw
const garbage = "x".repeat(900);
const hintsGarbage = extractAngleHints(garbage);
ok("ข้อความมั่ว: ไม่ throw และตัดที่ 600", hintsGarbage.length === 600, `len=${hintsGarbage.length}`);
eq("ข้อความว่าง: คืนค่าว่าง", extractAngleHints(""), "");

// ---------- parseAngleSuggestions ----------
const wellFormed = `1. เปิดด้วยเสียงกริ่งดึงแมวเข้ามาเล่น ถ่ายมุมห้องนอน
เพราะ: ยังไม่เคยใช้เสียงเป็นตัวเปิด
2. โชว์ว่าเก็บง่ายไม่เกะกะ ถ่ายมุมข้างตู้
เพราะ: จับกลุ่มคนห้องเล็ก
3. **เทียบก่อน-หลัง** โซฟาไม่ถูกข่วน
เพราะ: เห็นผลลัพธ์ชัด`;
const parsed = parseAngleSuggestions(wellFormed);
eq("ฟอร์แมตถูก: ได้ 3 ตัวเลือก", parsed.length, 3);
ok("ตัวเลือกแรกมีเนื้อหา", parsed[0].text.includes("เสียงกริ่ง"), parsed[0].text);
eq("ตัวเลือกแรกมีเหตุผล", parsed[0].why, "ยังไม่เคยใช้เสียงเป็นตัวเปิด");
ok("ลอก ** ออกแล้ว", !parsed[2].text.includes("**"), parsed[2].text);

const noWhy = `1. angle หนึ่ง
2. angle สอง`;
const parsedNoWhy = parseAngleSuggestions(noWhy);
eq("ไม่มีเพราะ: ยังได้ 2 ตัวเลือก", parsedNoWhy.length, 2);
eq("ไม่มีเพราะ: why ว่าง", parsedNoWhy[0].why, "");

const unnumbered = "โมเดลตอบมาเป็นย่อหน้าเดียวไม่มีเลขข้อ";
const parsedUn = parseAngleSuggestions(unnumbered);
eq("ผิดฟอร์แมต: คืนก้อนเดียวไม่ทิ้งของ", parsedUn.length, 1);
eq("ผิดฟอร์แมต: เนื้อหาครบ", parsedUn[0].text, unnumbered);
eq("ข้อความว่าง: คืนลิสต์ที่มี 1 ช่องว่าง", parseAngleSuggestions("   ").length, 1);

// ---------- summarizeEntryOutcome ----------
const orders = [
  { matchedEntryId: "A", finalRevenue: 50 },
  { matchedEntryId: "A", finalRevenue: 25.5 },
  { matchedEntryId: "A", finalRevenue: null }, // ยังไม่ได้เงิน — นับออเดอร์แต่ไม่นับเงิน
  { matchedEntryId: "B", finalRevenue: 10 },
  { matchedEntryId: null, finalRevenue: 99 },
];
const metrics = [
  { matchedEntryId: "A", views: 100, capturedOn: d("2026-07-21T00:00:00.000Z") },
  { matchedEntryId: "A", views: 180, capturedOn: d("2026-07-26T00:00:00.000Z") },
  { matchedEntryId: "B", views: 5, capturedOn: d("2026-07-26T00:00:00.000Z") },
];
eq(
  "outcome ของ A ใช้ snapshot ล่าสุด",
  summarizeEntryOutcome({ entryId: "A", orders, metrics }),
  { views: 180, orders: 3, settledRevenue: 75.5 }
);
eq(
  "entry ที่ไม่มีข้อมูลวิว -> views = null (ไม่ใช่ 0)",
  summarizeEntryOutcome({ entryId: "NOPE", orders, metrics }),
  { views: null, orders: 0, settledRevenue: 0 }
);

// ---------- repeatStatus ----------
const rs = [
  { id: "A", duplicatedFromId: null, videoUrl: "u", postedAt: d("2026-07-01T00:00:00.000Z") },
  { id: "B", duplicatedFromId: "A", videoUrl: "u", postedAt: d("2026-07-26T00:00:00.000Z") },
  { id: "C", duplicatedFromId: "A", videoUrl: "", postedAt: null },
  { id: "D", duplicatedFromId: null, videoUrl: "u", postedAt: d("2026-07-10T00:00:00.000Z") },
];
eq("A มีลูก 2 ตัว ลงแล้ว 1", repeatStatus(rs, "A"), {
  repeats: 2,
  postedRepeats: 1,
  lastPostedAt: d("2026-07-26T00:00:00.000Z").toISOString(),
  hasUnposted: true,
});
eq("B ไม่มีลูก", repeatStatus(rs, "B"), {
  repeats: 0,
  postedRepeats: 0,
  lastPostedAt: null,
  hasUnposted: false,
});
eq("D ไม่มีลูก (ไม่นับ A/B/C)", repeatStatus(rs, "D").repeats, 0);

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
```

**หมายเหตุ:** `eq` เทียบด้วย `JSON.stringify` ซึ่งแปลง `Date` เป็น ISO string อยู่แล้ว — ค่าคาดหวังของ `lastPostedAt` จึงเขียนเป็น `.toISOString()`

- [ ] **Step 4: รันให้เห็นว่าล้มเหลว**

Run: `node "<scratch>/test-angle.js"`
Expected: FAIL — `Cannot find module '<scratch>/build/angle.js'` เพราะยังไม่ได้เขียนและคอมไพล์ไฟล์ต้นทาง

- [ ] **Step 5: เขียน `lib/angle.ts`**

```ts
/** entry เท่าที่การไต่สายเลือดต้องใช้ */
export type LineageEntry = {
  id: string;
  duplicatedFromId: string | null;
};

/** entry เท่าที่การคัด angle ต้องใช้ */
export type AngleEntry = LineageEntry & {
  angle: string;
  videoUrl: string;
  postedAt: Date | null;
  chatgptOutput: string;
};

export type UsedAngle = {
  entryId: string;
  text: string;
  /** ลงคลิปจริงแล้วหรือยัง — ยังไม่ลงคือ "วางแผนไว้" */
  posted: boolean;
  postedAt: Date | null;
};

export type AngleSuggestion = { text: string; why: string };

export type EntryOutcome = {
  /** null = ยังไม่มีข้อมูลวิว ซึ่งต่างจาก 0 วิว — ห้ามยุบสองอันนี้เป็นค่าเดียวกัน */
  views: number | null;
  orders: number;
  settledRevenue: number;
};

export type RepeatStatus = {
  repeats: number;
  postedRepeats: number;
  lastPostedAt: Date | null;
  hasUnposted: boolean;
};

/**
 * หาสมาชิกทั้งหมดในสายเลือดการทำซ้ำ (ไต่ขึ้นหาต้นฉบับ แล้วแผ่ลงหาลูกหลานทุกชั้น)
 *
 * จัดกลุ่มด้วยสายเลือด ไม่ใช่ชื่อสินค้า — ในข้อมูลจริงมี entry ชื่อ "ที่ลับเล็บแมว"
 * สองอันที่เป็นสินค้าคนละชิ้นกันจริงๆ (ของเล่นไม้ 4-in-1 กับบ้านลับเล็บกระดาษ 2 ชั้น)
 * การจับกลุ่มด้วยชื่อจะเอา angle ของสินค้าอื่นมาปนทันที
 */
export function collectFamily<T extends LineageEntry>(entries: T[], entryId: string): T[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  let root = byId.get(entryId);
  if (!root) return [];

  // ไต่ขึ้นหา root — เผื่อพ่อถูกลบไปแล้ว (duplicatedFromId ไม่ใช่ FK) และเผื่อวนลูป
  const climbed = new Set<string>([root.id]);
  while (root.duplicatedFromId !== null) {
    const parent = byId.get(root.duplicatedFromId);
    if (!parent || climbed.has(parent.id)) break;
    climbed.add(parent.id);
    root = parent;
  }

  // แผ่ลงจาก root แบบ BFS
  const family: T[] = [];
  const visited = new Set<string>();
  const queue: T[] = [root];
  while (queue.length > 0) {
    const current = queue.shift() as T;
    if (visited.has(current.id)) continue;
    visited.add(current.id);
    family.push(current);
    for (const e of entries) {
      if (e.duplicatedFromId === current.id && !visited.has(e.id)) queue.push(e);
    }
  }
  return family;
}

/**
 * angle ที่ถือว่า "ใช้ไปแล้ว" ในสายเลือดนี้ (ไม่รวม entry ที่กำลังแก้อยู่)
 *
 * ต้องกรอง "ร่างเปล่า" (ยังไม่ลงคลิป + ยังไม่ตั้ง angle) ออก เพราะ duplicatePrompt
 * ก๊อป chatgptOutput ของต้นฉบับมาด้วย (app/actions.ts) — ถ้าไม่กรอง ร่างที่ยังไม่ได้
 * regenerate จะถูกอ่านว่าใช้ angle เดียวกับต้นฉบับ ทำให้รายการซ้ำตัวเองทันที
 */
export function collectUsedAngles(family: AngleEntry[], currentId: string): UsedAngle[] {
  const out: UsedAngle[] = [];
  for (const entry of family) {
    if (entry.id === currentId) continue;
    const posted = entry.videoUrl.trim() !== "";
    const stored = entry.angle.trim();
    if (stored !== "") {
      out.push({ entryId: entry.id, text: stored, posted, postedAt: entry.postedAt });
    } else if (posted) {
      const hints = extractAngleHints(entry.chatgptOutput);
      if (hints !== "") {
        out.push({ entryId: entry.id, text: hints, posted: true, postedAt: entry.postedAt });
      }
    }
    // ร่างเปล่า: ข้ามทิ้ง
  }
  return out;
}

/** เก็บเนื้อหาใต้หัวข้อเลข `heading` จนถึงหัวข้อเลข `next` (ทนการเยื้องบรรทัด) */
function sectionBody(lines: string[], heading: number, next: number): string {
  const headRe = new RegExp(`^\\s*${heading}\\.\\s`);
  const nextRe = new RegExp(`^\\s*${next}\\.\\s`);
  const start = lines.findIndex((line) => headRe.test(line));
  if (start === -1) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => nextRe.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join(" ").replace(/\s+/g, " ").trim();
}

const SCRIPT_MARKER = "Full voice-over script:";

/**
 * สกัด "แนวคลิป" จาก 10-part prompt ของคลิปเก่าที่ทำก่อนมีฟีเจอร์นี้ — เอาหัวข้อ Scene
 * กับบทพากย์มาพอให้รู้ว่าคลิปนั้นเล่ามุมไหน (ไม่ migrate ข้อมูล สกัดสดตอนต้องใช้)
 *
 * ต้องทนการเยื้องบรรทัด: ข้อมูลจริงมีทั้งแบบเยื้อง 3 ช่องและไม่เยื้องเลย
 * สกัดไม่ได้ให้คืน 600 ตัวอักษรแรก ไม่ throw — ข้อมูลคลุมเครือดีกว่าไม่มีเลย
 */
export function extractAngleHints(output: string): string {
  const text = output.replace(/\*\*/g, "");
  if (text.trim() === "") return "";
  const lines = text.split("\n");
  const parts: string[] = [];

  const scene = sectionBody(lines, 2, 3);
  if (scene !== "") parts.push("ฉาก: " + scene);

  const markerIndex = text.indexOf(SCRIPT_MARKER);
  if (markerIndex !== -1) {
    const collected: string[] = [];
    for (const raw of text.slice(markerIndex + SCRIPT_MARKER.length).split("\n")) {
      const line = raw.trim().replace(/^[“"]+|[”"]+$/g, "");
      if (line === "") {
        if (collected.length > 0) break;
        continue;
      }
      // หยุดเมื่อถึงบรรทัดเวลา (00:00-00:02) ซึ่งเป็นจุดเริ่ม timeline
      if (/^\d{2}:\d{2}/.test(line)) break;
      collected.push(line);
      if (collected.join(" ").length > 300) break;
    }
    if (collected.length > 0) {
      parts.push("บทพูด: " + collected.join(" ").slice(0, 300));
    }
  }

  if (parts.length === 0) return text.trim().slice(0, 600);
  return parts.join(" · ");
}

/**
 * แยกคำตอบของโมเดลเป็นรายการ angle
 * ผิดฟอร์แมตแล้วไม่ throw — คืนทั้งก้อนเป็นตัวเลือกเดียว ผู้ใช้ตัดแปะเองได้
 * ดีกว่าทิ้งผลลัพธ์ที่จ่ายโควตาไปแล้ว (แนวเดียวกับ lib/caption.ts)
 */
export function parseAngleSuggestions(raw: string): AngleSuggestion[] {
  const text = raw.replace(/\*\*/g, "").trim();
  const out: AngleSuggestion[] = [];
  for (const block of text.split(/\n(?=\s*\d+[.)]\s)/)) {
    const body = block.replace(/^\s*\d+[.)]\s*/, "").trim();
    if (body === "") continue;
    const withWhy = body.match(/^([\s\S]*?)\n\s*เพราะ:\s*([\s\S]*)$/);
    if (withWhy) {
      out.push({
        text: withWhy[1].replace(/\s+/g, " ").trim(),
        why: withWhy[2].replace(/\s+/g, " ").trim(),
      });
    } else {
      out.push({ text: body.replace(/\s+/g, " ").trim(), why: "" });
    }
  }
  if (out.length === 0) return [{ text, why: "" }];
  return out;
}

/**
 * ผลลัพธ์จริงของ entry หนึ่ง — แสดงข้างรายการ angle เพื่อให้เห็นว่าแนวนั้นขายได้ไหม
 * settledRevenue ใช้นิยามเดียวกับ summarizeOrders ใน lib/dashboard.ts (ผลรวม finalRevenue)
 * เพื่อไม่ให้ตัวเลขสองที่ในแอปขัดกันเอง
 */
export function summarizeEntryOutcome(args: {
  entryId: string;
  orders: { matchedEntryId: string | null; finalRevenue: number | null }[];
  metrics: { matchedEntryId: string | null; views: number; capturedOn: Date }[];
}): EntryOutcome {
  const { entryId, orders, metrics } = args;
  let orderCount = 0;
  let settledRevenue = 0;
  for (const o of orders) {
    if (o.matchedEntryId !== entryId) continue;
    orderCount++;
    settledRevenue += o.finalRevenue ?? 0;
  }

  let views: number | null = null;
  let latest = -Infinity;
  for (const m of metrics) {
    if (m.matchedEntryId !== entryId) continue;
    const at = m.capturedOn.getTime();
    if (at > latest) {
      latest = at;
      views = m.views;
    }
  }

  return { views, orders: orderCount, settledRevenue };
}

/**
 * สถานะการทำซ้ำของ entry หนึ่ง — นับเฉพาะ "ลูกหลาน" ไม่นับตัวเองและไม่นับต้นฉบับ
 * ใช้เติมบรรทัดสถานะในการ์ดคำแนะนำ แทนการให้ผู้ใช้ติ๊ก checkbox เอง
 * (ปัญหาต้นทางของผู้ใช้คือลืม — ของที่ต้องจำไปติ๊กคือของที่ลืมได้อีกอย่าง)
 */
export function repeatStatus<
  T extends LineageEntry & { videoUrl: string; postedAt: Date | null },
>(entries: T[], entryId: string): RepeatStatus {
  const descendants: T[] = [];
  const visited = new Set<string>([entryId]);
  const queue: string[] = [entryId];
  while (queue.length > 0) {
    const currentId = queue.shift() as string;
    for (const e of entries) {
      if (e.duplicatedFromId !== currentId || visited.has(e.id)) continue;
      visited.add(e.id);
      descendants.push(e);
      queue.push(e.id);
    }
  }

  let postedRepeats = 0;
  let hasUnposted = false;
  let lastPostedAt: Date | null = null;
  for (const e of descendants) {
    if (e.videoUrl.trim() !== "") {
      postedRepeats++;
      if (e.postedAt && (lastPostedAt === null || e.postedAt > lastPostedAt)) {
        lastPostedAt = e.postedAt;
      }
    } else {
      hasUnposted = true;
    }
  }

  return { repeats: descendants.length, postedRepeats, lastPostedAt, hasUnposted };
}
```

- [ ] **Step 6: คอมไพล์แล้วรันสคริปต์ทดสอบให้ผ่านทั้งหมด**

`lib/angle.ts` ไม่ import อะไรเลย จึงคอมไพล์เดี่ยวได้:

Run: `npx tsc lib/angle.ts --outDir "<scratch>/build" --module commonjs --target ES2017 --skipLibCheck`
Expected: ไม่มี error และเกิดไฟล์ `<scratch>/build/angle.js`

Run: `node "<scratch>/test-angle.js"`
Expected: ทุกบรรทัด `PASS` และปิดท้าย `ALL PASS`

ถ้ามี FAIL ให้แก้ `lib/angle.ts` จนผ่านครบ **ห้ามแก้ค่าคาดหวังในสคริปต์ทดสอบเพื่อให้ผ่าน**

- [ ] **Step 7: ทดสอบ `extractAngleHints` กับ 10-part prompt จริงในฐานข้อมูล**

เขียนไฟล์ `<scratch>/hints-real.js` (อ่าน `dev.db` แบบ **readonly** ห้ามเขียน):

```js
const Database = require("<REPO>/node_modules/better-sqlite3");
const { extractAngleHints } = require("<scratch>/build/angle.js");
const db = new Database("<REPO>/dev.db", { readonly: true });

const rows = db
  .prepare(
    `SELECT id, productName, date(createdAt) d, length(chatgptOutput) len, chatgptOutput
     FROM PromptEntry WHERE chatgptOutput <> '' ORDER BY createdAt DESC LIMIT 12`
  )
  .all();

let empty = 0;
for (const r of rows) {
  const hints = extractAngleHints(r.chatgptOutput);
  const fellBack = !hints.startsWith("ฉาก:") && !hints.startsWith("บทพูด:");
  if (hints.trim() === "") empty++;
  console.log(`${r.d} | ${r.productName.slice(0, 28)} | ${fellBack ? "FALLBACK" : "ok"} | ${hints.slice(0, 110)}`);
}
console.log(`\nสกัดไม่ได้เลย ${empty}/${rows.length} รายการ`);
```

(แทน `<REPO>` ด้วย `C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt`)

Run: `node "<scratch>/hints-real.js"`
Expected: ไม่ throw · **ส่วนใหญ่ต้องขึ้น `ok` ไม่ใช่ `FALLBACK`** และเห็นข้อความฉาก/บทพูดเป็นภาษาไทยที่อ่านรู้เรื่อง · ถ้าเกินครึ่งเป็น FALLBACK ให้กลับไปแก้ regex/การไล่บรรทัดใน `extractAngleHints` แล้วรันซ้ำ

- [ ] **Step 8: ตรวจ type และ lint**

Run: `npx tsc --noEmit`
Expected: ไม่มี error

Run: `npm run lint`
Expected: ไม่มี error (ถ้า error ชี้ไปที่ไฟล์ใน `.next-dev` ให้ `rm -rf .next-dev` แล้วรันใหม่)

- [ ] **Step 9: Commit**

```bash
git diff tsconfig.json   # ต้องว่าง ถ้าไม่ว่างให้ git checkout -- tsconfig.json
git add prisma/schema.prisma prisma/migrations lib/angle.ts
git commit -m "Add angle column and the pure logic behind it

Groups clips by duplicate lineage rather than product name: the database
already holds two entries both named the cat scratcher that are physically
different products, so matching on the name would mix one product's angles
into another's.

Empty drafts are skipped when collecting used angles. duplicatePrompt copies
chatgptOutput, so a duplicate that has not been regenerated yet would
otherwise read as having already used its parent's angle.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: ส่ง angle เข้าโจทย์ AI (`buildPromptText`)

**Files:**
- Modify: `lib/prompt-template.ts`
- Modify: `lib/few-shot.ts:33-39`
- Create (scratch, ไม่ commit): `<scratch>/baseline-brief.txt`, `<scratch>/test-brief.js`

**Interfaces:**
- Consumes: ไม่มีจาก Task 1
- Produces: `PromptFormData` มีฟิลด์ `angle: string` เพิ่ม (required) — Task 3 ส่ง `entry.angle` เข้ามา

**บริบทที่ต้องรู้:** `buildPromptText` ถูกเรียก 2 ที่ — `generateWithAI` (`app/actions.ts:377`) และ `getFewShotExamples` (`lib/few-shot.ts:33`) · **entry เดิม 55 อันมี `angle = ""` ทั้งหมด** ข้อความโจทย์ตอน angle ว่างจึงต้องเหมือนเดิม**ทุกตัวอักษร** ไม่งั้นคือ regression กับทุกคลิปที่ยังไม่ตั้ง angle

- [ ] **Step 1: เก็บ baseline ของข้อความโจทย์ก่อนแก้**

เขียนไฟล์ `<scratch>/dump-brief.js`:

```js
const { buildPromptText } = require("<scratch>/build-tpl/prompt-template.js");
const fs = require("fs");
const text = buildPromptText({
  productName: "สินค้าทดสอบ",
  productInfo: "รายละเอียด\nหลายบรรทัด",
  riskModule: "-",
  extraNotes: "",
  imageCaptions: ["ภาพหน้าสินค้า", ""],
});
fs.writeFileSync(process.argv[2], text, "utf8");
console.log("bytes:", Buffer.byteLength(text, "utf8"));
```

Run: `npx tsc lib/prompt-template.ts --outDir "<scratch>/build-tpl" --module commonjs --target ES2017 --skipLibCheck`
Run: `node "<scratch>/dump-brief.js" "<scratch>/baseline-brief.txt"`
Expected: ไฟล์ baseline ถูกเขียน และพิมพ์จำนวน bytes ออกมา — **บันทึกเลข bytes นี้ไว้**

- [ ] **Step 2: เขียนสคริปต์ทดสอบที่ยังไม่ผ่าน**

เขียนไฟล์ `<scratch>/test-brief.js`:

```js
const { buildPromptText } = require("<scratch>/build-tpl2/prompt-template.js");
const fs = require("fs");

let failed = 0;
function ok(label, cond, note) {
  if (!cond) failed++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${note ? " — " + note : ""}`);
}

const base = {
  productName: "สินค้าทดสอบ",
  productInfo: "รายละเอียด\nหลายบรรทัด",
  riskModule: "-",
  extraNotes: "",
  imageCaptions: ["ภาพหน้าสินค้า", ""],
};

// 1) angle ว่าง -> ต้องเหมือน baseline เป๊ะทุกตัวอักษร (กัน regression กับ 55 entries เดิม)
const baseline = fs.readFileSync("<scratch>/baseline-brief.txt", "utf8");
const withoutAngle = buildPromptText({ ...base, angle: "" });
ok("angle ว่าง: ข้อความเหมือน baseline เป๊ะ", withoutAngle === baseline,
   `len ${withoutAngle.length} vs ${baseline.length}`);
ok("angle ว่าง: ไม่มีบล็อก angle", !withoutAngle.includes("Angle ที่ต้องใช้"));
ok("angle ว่าง: ยังมีคำสั่งเลือก use case เอง", withoutAngle.includes("เลือก use case เดียวที่เหมาะที่สุด"));

// 2) angle ไม่ว่าง -> มีบล็อก angle และคำสั่งต้องสลับ (ไม่ปล่อยสองประโยคที่ขัดกันไว้ทั้งคู่)
const angleText = "เสียงกริ่งดึงแมวเข้ามาเล่นเอง ถ่ายมุมห้องนอน";
const withAngle = buildPromptText({ ...base, angle: angleText });
ok("มี angle: มีบล็อก angle", withAngle.includes("Angle ที่ต้องใช้"));
ok("มี angle: มีเนื้อหา angle", withAngle.includes(angleText));
ok("มี angle: ไม่มีคำสั่งให้เลือก use case เอง",
   !withAngle.includes("เลือก use case เดียวที่เหมาะที่สุด"));
ok("มี angle: มีคำสั่งห้ามเลือกเอง", withAngle.includes("ห้ามเลือก use case อื่นเอง"));

// 3) angle ที่มีแต่ช่องว่าง ถือว่าว่าง
ok("angle เป็นช่องว่าง: ถือว่าว่าง", buildPromptText({ ...base, angle: "   \n " }) === baseline);

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 3: รันให้เห็นว่าล้มเหลว**

Run: `npx tsc lib/prompt-template.ts --outDir "<scratch>/build-tpl2" --module commonjs --target ES2017 --skipLibCheck`
Run: `node "<scratch>/test-brief.js"`
Expected: FAIL — เคสที่มี angle ล้มหมด (ยังไม่มีบล็อก angle ในฟังก์ชัน) แต่เคส "angle ว่าง" ผ่าน

- [ ] **Step 4: แก้ `lib/prompt-template.ts`**

เพิ่ม `angle` เข้า type (ต่อจาก `extraNotes: string;`):

```ts
  angle: string;
```

แก้ signature ของ `buildPromptText` ให้ destructure `angle` เพิ่ม (ต่อจาก `extraNotes,`):

```ts
  angle,
```

เพิ่มโค้ดคำนวณ 2 ตัวนี้ก่อน `return` (ใต้บรรทัดที่คำนวณ `imageLines`):

```ts
  // angle ว่าง = พฤติกรรมเดิมทุกตัวอักษร (entry เดิมทั้งหมดยังไม่มี angle)
  // angle ไม่ว่าง = ล็อกแกนคลิปไว้ และต้องถอนคำสั่ง "เลือก use case เอง" ออก
  // ไม่งั้นโจทย์จะมีสองประโยคที่ขัดกันเอง
  const trimmedAngle = angle.trim();
  const angleBlock =
    trimmedAngle === ""
      ? ""
      : `
Angle ที่ต้องใช้สำหรับคลิปนี้ (บังคับ ห้ามเปลี่ยนเอง):
"""
${trimmedAngle}
"""
`;
  const useCaseRule =
    trimmedAngle === ""
      ? "- เลือก use case เดียวที่เหมาะที่สุด เสี่ยงเพี้ยนน้อย และขายของได้ใน 10 วินาที"
      : "- ใช้ Angle ที่กำหนดไว้ด้านบนเป็นแกนของคลิป ห้ามเลือก use case อื่นเอง แต่ยังต้องเลือกวิธีนำเสนอที่เสี่ยงเพี้ยนน้อยและขายของได้ใน 10 วินาที";
```

ใน template string: แทรก `${angleBlock}` ต่อจากบล็อก "ข้อมูลเพิ่มเติมจากฉัน ถ้ามี" (หลัง `"""` ปิดของ `${extraNotes}`) และแทนบรรทัด use case เดิมด้วย `${useCaseRule}`

**สำคัญ:** `angleBlock` ขึ้นต้นและลงท้ายด้วย `\n` อยู่แล้ว — ตอนแทรกต้องไม่เพิ่มบรรทัดว่างเกิน ไม่งั้นเคส "angle ว่าง เหมือน baseline เป๊ะ" จะไม่ผ่าน ให้รันสคริปต์ทดสอบยืนยัน

- [ ] **Step 5: แก้ `lib/few-shot.ts`**

ในการเรียก `buildPromptText` (บรรทัด 33-39) เพิ่มบรรทัดนี้ (golden examples ไม่มี angle):

```ts
      angle: "",
```

- [ ] **Step 6: รันสคริปต์ทดสอบให้ผ่านทั้งหมด**

Run: `npx tsc lib/prompt-template.ts --outDir "<scratch>/build-tpl2" --module commonjs --target ES2017 --skipLibCheck`
Run: `node "<scratch>/test-brief.js"`
Expected: ทุกบรรทัด `PASS` และปิดท้าย `ALL PASS`

- [ ] **Step 7: ตรวจ type และ lint**

Run: `npx tsc --noEmit`
Expected: ไม่มี error — ถ้ามี error ว่า `angle` ขาดใน `buildPromptText` ที่ `app/actions.ts` ให้**หยุดและอย่าแก้ที่นั้น** (Task 3 เป็นเจ้าของไฟล์นั้น) ให้ใส่ `angle: ""` ชั่วคราวเพื่อให้ compile ผ่าน แล้วบันทึกไว้ในรายงานว่า Task 3 ต้องเปลี่ยนเป็น `entry.angle`

Run: `npm run lint`
Expected: ไม่มี error

- [ ] **Step 8: Commit**

```bash
git diff tsconfig.json   # ต้องว่าง
git add lib/prompt-template.ts lib/few-shot.ts app/actions.ts
git commit -m "Let the brief carry a required angle

With no angle the brief is byte-identical to before, which matters because
all 55 existing entries have none. With one, the block is added and the
'pick the best use case yourself' rule is swapped out — leaving both in
would hand the model two contradicting instructions.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Gemini + server actions

**Files:**
- Modify: `lib/gemini.ts` (เพิ่มท้ายไฟล์)
- Modify: `app/actions.ts` (imports + action ใหม่ 2 ตัว + แก้ `generateWithAI`)

**Interfaces:**
- Consumes จาก Task 1: `collectFamily`, `collectUsedAngles`, `parseAngleSuggestions`, `type AngleSuggestion` จาก `@/lib/angle`
- Consumes จาก Task 2: `buildPromptText` ที่รับ `angle`
- Produces (Task 4 ใช้ต่อ):
  - `async function saveAngle(entryId: string, angle: string): Promise<void>`
  - `async function suggestAngles(entryId: string): Promise<AngleSuggestion[]>`

- [ ] **Step 1: เพิ่มฟังก์ชันเรียก Gemini ใน `lib/gemini.ts`**

วางต่อท้ายไฟล์:

```ts
/**
 * งานคิด angle ล็อกที่โมเดลเร็วเสมอ เหตุผลเดียวกับ CAPTION_MODEL/EXTRACT_MODEL:
 * เป็นงานข้อความล้วนสั้นๆ ไม่ควรจ่ายโควตาโมเดลละเอียด (20/วัน) ให้งานที่ flash-lite (500/วัน) ทำได้
 */
export const ANGLE_MODEL: GeminiModelId = "gemini-3.1-flash-lite";

const ANGLE_INSTRUCTION = `คุณคือผู้ช่วยคิดมุมนำเสนอ (angle) สำหรับคลิปสั้นขายสินค้าบน TikTok Shop ความยาว 10 วินาที
เสนอ angle ใหม่ 3 แบบที่ต่างกันชัดเจน และต้องไม่ซ้ำแนวกับ angle ที่เคยใช้ไปแล้ว

ตอบกลับในรูปแบบนี้เท่านั้น:
1. <angle: ปัญหาหรือแรงจูงใจที่ใช้เปิดคลิป + ฉากที่ใช้ + สิ่งที่โชว์ เขียนรวมใน 1-2 บรรทัด>
เพราะ: <เหตุผลสั้นบรรทัดเดียวว่าทำไม angle นี้น่าลอง และต่างจากของเดิมอย่างไร>
2. <angle>
เพราะ: <เหตุผล>
3. <angle>
เพราะ: <เหตุผล>

กติกา: ทุก angle ต้องถ่ายได้จริงในคลิป 10 วินาที ไม่มีข้อความบนจอ ไม่มีหน้าคน
ห้ามเขียนบทพูด ห้ามบรรยายโครงสร้างสินค้า ห้ามใส่หัวข้ออื่นนอกเหนือจากฟอร์แมตด้านบน
เขียนเป็นภาษาไทย`;

export async function suggestAngleOptions(args: {
  productName: string;
  productInfo: string;
  usedAngles: string[];
}): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("ยังไม่ได้ตั้งค่า GEMINI_API_KEY ในไฟล์ .env");
  }

  const client = new GoogleGenAI({ apiKey });

  const usedBlock =
    args.usedAngles.length === 0
      ? "ยังไม่เคยทำคลิปสินค้านี้มาก่อน"
      : args.usedAngles.map((a, i) => `${i + 1}. ${a}`).join("\n");

  const response = await client.interactions.create({
    model: ANGLE_MODEL,
    // snake_case — camelCase จะถูก API เมินแบบเงียบๆ (ดูคอมเมนต์ใน generateTenPartPrompt)
    system_instruction: ANGLE_INSTRUCTION,
    // อุณหภูมิสูงกว่างานสกัด/caption เพราะงานนี้ต้องการความหลากหลาย ไม่ใช่ความแม่น
    generation_config: { temperature: 0.9 },
    input: [
      {
        type: "text",
        text:
          `### ชื่อสินค้า\n${args.productName}\n\n` +
          `### ข้อมูลสินค้า\n${args.productInfo}\n\n` +
          `### angle ที่เคยใช้ไปแล้ว (ห้ามซ้ำแนวนี้)\n${usedBlock}`,
      },
    ],
  });

  const text = response.output_text;
  if (!text || text.trim() === "") {
    throw new Error("AI ไม่ได้ตอบกลับตอนคิด angle ลองใหม่อีกครั้ง");
  }
  return text;
}
```

- [ ] **Step 2: เพิ่ม imports ใน `app/actions.ts`**

เพิ่ม `suggestAngleOptions` เข้าไปใน import ที่มีอยู่แล้วจาก `@/lib/gemini` และเพิ่ม import ใหม่:

```ts
import {
  collectFamily,
  collectUsedAngles,
  parseAngleSuggestions,
  type AngleSuggestion,
} from "@/lib/angle";
```

- [ ] **Step 3: เพิ่ม server action 2 ตัว**

วางต่อจาก `updateProductImageCaption` (ราวบรรทัด 311):

```ts
/**
 * บันทึก angle ของคลิป — ต้องเป็น action แยกไม่ผ่าน form submit เพราะ generateWithAI
 * อ่านค่าจาก DB ไม่ใช่จากฟอร์ม (ถ้าเก็บใน form state โมเดลจะไม่เห็น angle เลย)
 * แนวเดียวกับ updateProductImageCaption ด้านบน
 */
export async function saveAngle(entryId: string, angle: string) {
  await prisma.promptEntry.update({
    where: { id: entryId },
    data: { angle: angle.trim() },
  });
  revalidatePath("/");
}

/**
 * ขอ angle ใหม่ 3 แบบจาก AI โดยให้เห็น angle ที่เคยใช้กับสินค้าเดียวกัน (สายเลือดการทำซ้ำ)
 * ไม่ revalidatePath — action นี้ไม่แตะข้อมูลใดๆ (แนวเดียวกับ extractProductInfo)
 */
export async function suggestAngles(entryId: string): Promise<AngleSuggestion[]> {
  const entries = await prisma.promptEntry.findMany({
    select: {
      id: true,
      duplicatedFromId: true,
      angle: true,
      videoUrl: true,
      postedAt: true,
      chatgptOutput: true,
      productName: true,
      productInfo: true,
    },
  });

  const current = entries.find((e) => e.id === entryId);
  if (!current) {
    throw new Error("ไม่พบรายการที่ต้องการคิด angle");
  }

  const family = collectFamily(entries, entryId);
  const used = collectUsedAngles(family, entryId);

  const raw = await suggestAngleOptions({
    productName: current.productName,
    productInfo: current.productInfo,
    usedAngles: used.map((u) => u.text),
  });
  return parseAngleSuggestions(raw);
}
```

- [ ] **Step 4: ส่ง angle เข้า `buildPromptText` ใน `generateWithAI`**

ในการเรียก `buildPromptText` (ราวบรรทัด 377) เปลี่ยน `angle: ""` (หรือเพิ่มถ้ายังไม่มี) ให้เป็น:

```ts
    angle: entry.angle,
```

- [ ] **Step 5: ตรวจ type และ lint**

Run: `npx tsc --noEmit`
Expected: ไม่มี error

Run: `npm run lint`
Expected: ไม่มี error

- [ ] **Step 6: ทดสอบ `suggestAngles` กับ Gemini จริง**

เขียนไฟล์ `<scratch>/try-suggest.js` ที่เรียก `suggestAngleOptions` ตรงๆ ผ่าน parser (ไม่ผ่าน Next.js เพื่อไม่ต้องรัน server):

```js
require("<REPO>/node_modules/dotenv/config");
const { suggestAngleOptions } = require("<scratch>/build-gem/gemini.js");
const { parseAngleSuggestions } = require("<scratch>/build/angle.js");

(async () => {
  const raw = await suggestAngleOptions({
    productName: "ที่ลับเล็บแมว",
    productInfo: "ของเล่นแมว 4 in 1 ไม้แท้ มีกังหันไม้ ลูกบอลมีกริ่ง เสาลับเล็บพันเชือกป่าน รางลูกบอลที่ฐาน",
    usedAngles: ["ฉาก: ห้องนั่งเล่น แมวเล่นเอง · บทพูด: แมวเบื่อของเล่นเดิมๆ ใช่ไหม"],
  });
  console.log("=== RAW ===\n" + raw);
  console.log("\n=== PARSED ===");
  console.dir(parseAngleSuggestions(raw), { depth: null });
})();
```

Run: `npx tsc lib/gemini.ts --outDir "<scratch>/build-gem" --module commonjs --target ES2017 --skipLibCheck --esModuleInterop --moduleResolution node`
Run: `node "<scratch>/try-suggest.js"`
Expected: ได้ **3 ตัวเลือก** ที่ parse แยก `text`/`why` ได้ครบ และเนื้อหา**ต่างจาก** angle เดิมที่ส่งไป (ไม่ใช่ "แมวเบื่อของเล่นเดิม" ซ้ำ) · ถ้า parse ได้แค่ 1 ตัวเลือกแปลว่าฟอร์แมตคำตอบไม่ตรง ให้ปรับ `ANGLE_INSTRUCTION` แล้วลองใหม่

**ถ้า Gemini ตอบ error เรื่องโควตา/คีย์** ให้บันทึกไว้ในรายงานและข้าม step นี้ (ทดสอบผ่าน UI ใน Task 4 แทน) — ห้ามแก้โค้ดให้กลบ error

- [ ] **Step 7: Commit**

```bash
git diff tsconfig.json   # ต้องว่าง
git add lib/gemini.ts app/actions.ts
git commit -m "Suggest angles from what the product has already used

The angle field needs its own action rather than riding the brief form:
generateWithAI reads the entry from the database, so a value living only in
form state would never reach the model.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: แผง Angle ใน UI

**Files:**
- Create: `components/angle-panel.tsx`
- Modify: `components/brief-form.tsx` (imports, props, render)
- Modify: `components/prompt-workspace.tsx` (คำนวณข้อมูลแล้วส่ง props)

**Interfaces:**
- Consumes จาก Task 1: `collectFamily`, `collectUsedAngles`, `summarizeEntryOutcome`, `type UsedAngle`, `type EntryOutcome`
- Consumes จาก Task 3: `saveAngle`, `suggestAngles`
- Produces: `<AnglePanel entryId angle used onSaved />`

**บริบทที่ต้องรู้:**
- `brief-form.tsx` ใหญ่อยู่แล้ว — แผงนี้ต้องเป็นไฟล์แยก `components/angle-panel.tsx` และ `brief-form.tsx` แค่ render มัน
- แผงต้องอยู่**นอก `<form>`** (form ซ้อน form ไม่ได้ และปุ่มในนั้นต้องไม่ submit ฟอร์ม) — วางต่อจากบล็อก "รูปสินค้าจริง" ซึ่งอยู่นอกฟอร์มอยู่แล้ว
- แสดงเฉพาะเมื่อมี entry ถูกเลือก (`entryId !== null`) เพราะ angle ต้องมี entry ให้บันทึก
- `prompt-workspace.tsx` มี `prompts`, `affiliateOrders`, `clipMetrics` ครบแล้ว — คำนวณ `used` ที่นี่แล้วส่งลงไป ไม่ต้องเพิ่ม query

- [ ] **Step 1: เขียน `components/angle-panel.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { Compass } from "lucide-react";

import { saveAngle, suggestAngles } from "@/app/actions";
import type { AngleSuggestion, EntryOutcome, UsedAngle } from "@/lib/angle";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export type UsedAngleWithOutcome = UsedAngle & { outcome: EntryOutcome };

function baht(n: number): string {
  return "฿" + n.toLocaleString("th-TH", { maximumFractionDigits: 0 });
}

function thaiShortDate(d: Date): string {
  return d.toLocaleDateString("th-TH", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** บรรทัดผลลัพธ์ของ angle หนึ่ง — ข้อเท็จจริงล้วน ไม่จัดอันดับว่า angle ไหนดีกว่า
 *  เพราะสินค้าหนึ่งมีคลิปแค่ 1-3 อัน เทียบกันแล้วสรุปไม่ได้ (อ่าน noise) */
function outcomeLine(item: UsedAngleWithOutcome): string {
  if (!item.posted) return "ยังไม่ได้ลงคลิป";
  const bits: string[] = [];
  if (item.postedAt) bits.push("ลงแล้ว " + thaiShortDate(item.postedAt));
  bits.push(item.outcome.views === null ? "ยังไม่มีข้อมูลวิว" : `${item.outcome.views.toLocaleString("th-TH")} วิว`);
  bits.push(`${item.outcome.orders} ออเดอร์`);
  bits.push(baht(item.outcome.settledRevenue));
  return bits.join(" · ");
}

export function AnglePanel({
  entryId,
  angle,
  used,
}: {
  entryId: string;
  angle: string;
  used: UsedAngleWithOutcome[];
}) {
  const [draft, setDraft] = useState(angle);
  const [suggestions, setSuggestions] = useState<AngleSuggestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSuggesting, startSuggesting] = useTransition();
  const [isSaving, startSaving] = useTransition();

  // entry เปลี่ยนตัว -> โหลด angle ของตัวใหม่ (BriefForm ไม่ถูก key ตาม entry)
  const [loadedFor, setLoadedFor] = useState(entryId);
  if (loadedFor !== entryId) {
    setLoadedFor(entryId);
    setDraft(angle);
    setSuggestions([]);
    setError(null);
  }

  function commit(value: string) {
    if (value.trim() === angle.trim()) return;
    setError(null);
    startSaving(async () => {
      try {
        await saveAngle(entryId, value);
      } catch (e) {
        setError(e instanceof Error ? e.message : "บันทึก angle ไม่สำเร็จ");
      }
    });
  }

  function handleSuggest() {
    setError(null);
    startSuggesting(async () => {
      try {
        setSuggestions(await suggestAngles(entryId));
      } catch (e) {
        setError(e instanceof Error ? e.message : "คิด angle ไม่สำเร็จ");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-5">
      <span className="flex items-center gap-1.5 font-mono text-xs tracking-widest text-marigold uppercase">
        <Compass className="size-3.5" />
        Angle ของคลิปนี้
      </span>

      {used.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3">
          <span className="font-mono text-[0.65rem] tracking-widest text-muted-foreground uppercase">
            เคยใช้กับสินค้านี้แล้ว {used.length} angle
          </span>
          {used.map((item) => (
            <div key={item.entryId} className="flex flex-col gap-0.5">
              <span className="text-sm text-foreground/90">{item.text}</span>
              <span className="font-mono text-[0.7rem] text-muted-foreground">
                {outcomeLine(item)}
              </span>
            </div>
          ))}
        </div>
      )}

      <Button
        type="button"
        size="sm"
        onClick={handleSuggest}
        disabled={isSuggesting}
        className="self-start bg-marigold text-ink hover:bg-marigold/90"
      >
        {isSuggesting ? "กำลังคิด..." : "เสนอ angle ใหม่"}
      </Button>

      {suggestions.length > 0 && (
        <div className="flex flex-col gap-2">
          {suggestions.map((s, index) => (
            <button
              key={index}
              type="button"
              onClick={() => {
                setDraft(s.text);
                commit(s.text);
              }}
              className="flex flex-col gap-0.5 rounded-lg border border-border p-2.5 text-left hover:border-marigold"
            >
              <span className="text-sm text-foreground/90">{s.text}</span>
              {s.why !== "" && (
                <span className="font-mono text-[0.7rem] text-muted-foreground">
                  เพราะ: {s.why}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      <Textarea
        rows={2}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commit(draft)}
        placeholder="มุมนำเสนอของคลิปนี้ — กดปุ่มด้านบนให้ AI เสนอ หรือพิมพ์เองก็ได้"
      />
      <span className="font-mono text-[0.7rem] text-muted-foreground">
        {isSaving ? "กำลังบันทึก..." : "บันทึกเมื่อคลิกออกจากช่อง"}
      </span>

      {error && <p className="font-mono text-[0.7rem] text-record">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: เพิ่ม props และ render ใน `components/brief-form.tsx`**

เพิ่ม import ต่อจาก import ของ `deleteProductImage`:

```tsx
import { AnglePanel, type UsedAngleWithOutcome } from "@/components/angle-panel";
```

เพิ่ม 2 บรรทัดใน destructure params (ต่อจาก `onExtracted,`):

```tsx
  angleEntryId,
  angleValue,
  usedAngles,
```

และใน type (ต่อจากบรรทัด `onExtracted: ...`):

```tsx
  angleEntryId: string | null;
  angleValue: string;
  usedAngles: UsedAngleWithOutcome[];
```

แล้ว render ต่อท้าย **หลังบล็อก "รูปสินค้าจริง" ปิด** (ก่อน `</section>` ปิดท้าย component):

```tsx
      {/* แผง angle อยู่นอก <form> เพราะมีปุ่ม/ช่องของตัวเองที่ต้องไม่ submit ฟอร์ม
          และ angle บันทึกผ่าน server action ของมันเอง (generateWithAI อ่านจาก DB) */}
      {angleEntryId !== null && (
        <AnglePanel entryId={angleEntryId} angle={angleValue} used={usedAngles} />
      )}
```

- [ ] **Step 3: คำนวณ `usedAngles` แล้วส่ง props ใน `components/prompt-workspace.tsx`**

เพิ่ม imports:

```tsx
import {
  collectFamily,
  collectUsedAngles,
  summarizeEntryOutcome,
} from "@/lib/angle";
import type { UsedAngleWithOutcome } from "@/components/angle-panel";
```

เพิ่ม `useMemo` นี้ต่อจาก `dashboardEntries` (ราวบรรทัด 282):

```tsx
  // angle ที่เคยใช้กับสินค้าเดียวกัน (จับกลุ่มด้วยสายเลือดการทำซ้ำ ไม่ใช่ชื่อสินค้า)
  const usedAngles = useMemo<UsedAngleWithOutcome[]>(() => {
    if (selectedId === null) return [];
    const lineage = prompts.map((p) => ({
      id: p.id,
      duplicatedFromId: p.duplicatedFromId,
      angle: p.angle,
      videoUrl: p.videoUrl,
      postedAt: p.postedAt,
      chatgptOutput: p.chatgptOutput,
    }));
    const family = collectFamily(lineage, selectedId);
    return collectUsedAngles(family, selectedId).map((u) => ({
      ...u,
      outcome: summarizeEntryOutcome({
        entryId: u.entryId,
        orders: affiliateOrders,
        metrics: clipMetrics,
      }),
    }));
  }, [prompts, selectedId, affiliateOrders, clipMetrics]);
```

ส่ง props ในบล็อก `<BriefForm ...>` (ต่อจาก `onExtracted={handleExtracted}`):

```tsx
                angleEntryId={selectedId}
                angleValue={selectedEntry?.angle ?? ""}
                usedAngles={usedAngles}
```

- [ ] **Step 4: เพิ่ม `angle` และ `duplicatedFromId` เข้า type `PromptEntry`**

ใน `components/prompt-workspace.tsx` type `PromptEntry` (ราวบรรทัด 36-55) ตรวจว่ามี 2 ฟิลด์นี้ ถ้าขาดให้เพิ่ม:

```tsx
  angle: string;
  duplicatedFromId: string | null;
```

Run: `npx tsc --noEmit`
Expected: ไม่มี error — ถ้า error บอกว่า `angle`/`duplicatedFromId` ไม่มีใน type ให้เพิ่มตามด้านบน (Prisma คืนฟิลด์เหล่านี้อยู่แล้วจาก `findMany` ใน `app/page.tsx` ที่ไม่ได้ใส่ `select`)

- [ ] **Step 5: ตรวจ lint**

Run: `npm run lint`
Expected: ไม่มี error

- [ ] **Step 6: ทดสอบ UI จริงบน isolated dev server**

```bash
cp dev.db dev-test.db
NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001
```

เปิด `http://localhost:3001` แล้วตรวจ:
- **entry ที่มีสายเลือด:** เลือก entry "ที่ลับเล็บแมว" ที่สร้าง 26 ก.ค. → แผง "Angle ของคลิปนี้" แสดง **1 angle** (ของ entry 12 ก.ค.) พร้อมบรรทัด "ลงแล้ว ... · ... วิว · ... ออเดอร์ · ฿..." ที่ตัวเลขตรงกับ `dev-test.db`
- **เคสสำคัญ (กรองร่างเปล่า):** กดเมนู kebab ที่ entry 12 ก.ค. → ทำซ้ำ → entry ใหม่ถูกเลือก → แผง angle ต้องแสดง **1 angle เท่านั้น** (ของ 12 ก.ค.) **ไม่ใช่ 2** — พิสูจน์ว่าร่างที่ยังไม่ regenerate และยังไม่ลงคลิปถูกข้าม ทั้งที่มันถือ `chatgptOutput` ของต้นฉบับอยู่
- **ปุ่มทำซ้ำไม่ก๊อป angle:** ตั้ง angle ให้ entry ต้นทางก่อน → ทำซ้ำ → ช่อง angle ของ entry ใหม่ต้อง**ว่าง**
- **บันทึกจริง:** พิมพ์ angle → คลิกออกจากช่อง (เห็น "กำลังบันทึก...") → กด F5 → ค่ายังอยู่
- **เสนอ angle:** กด "เสนอ angle ใหม่" → ได้ 3 ตัวเลือกพร้อม "เพราะ:" → คลิกอันหนึ่ง → ค่าเข้าช่องและถูกบันทึก (F5 แล้วยังอยู่)
- **angle ถึงโมเดลจริง:** ตั้ง angle แล้วกด "สร้างด้วย AI" → 10-part prompt ที่ได้ต้องสะท้อน angle นั้น (เช่นถ้า angle บอกห้องนอน ต้องไม่ออกมาเป็นห้องนั่งเล่นเหมือนเดิม)
- **entry ที่ไม่มีสายเลือด:** เลือก entry อื่น (ส่วนใหญ่ของ 55 อัน) → ไม่มีบล็อก "เคยใช้..." แต่ยังมีปุ่มและช่อง angle ใช้ได้ ไม่ error
- **หน้า "สินค้าใหม่":** กด "สินค้าใหม่" → **ไม่มี**แผง angle (ยังไม่มี entry ให้บันทึก) และฟอร์มยังสร้าง entry ใหม่ได้ปกติ
- ส่วนอื่นของฟอร์ม (แผงสกัด, risk module, extra notes, รูปสินค้าจริง) ทำงานเหมือนเดิม · Console ไม่มี error/hydration warning

ปิด server แล้ว cleanup: `rm -rf .next-dev dev-test.db`

- [ ] **Step 7: Commit**

```bash
git diff tsconfig.json   # ต้องว่าง
git add components/angle-panel.tsx components/brief-form.tsx components/prompt-workspace.tsx
git commit -m "Add the angle panel to the brief tab

Lives outside the brief form and saves through its own action, since the
form only ever creates new entries and generateWithAI reads the database.
Shows each past angle's views, orders and revenue as plain facts without
ranking them — one to three clips per product cannot separate a better
angle from luck.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: บรรทัดสถานะ "ทำซ้ำแล้ว" + ปิดกับดักปุ่ม submit

**Files:**
- Modify: `components/recommendations.tsx`
- Modify: `components/prompt-workspace.tsx` (เพิ่ม `duplicatedFromId` เข้า `dashboardEntries` + prop ปุ่ม)
- Modify: `components/dashboard-panel.tsx` (ขยาย type ของ prop `entries`)
- Modify: `components/brief-form.tsx` (ป้ายปุ่ม submit)

**Interfaces:**
- Consumes จาก Task 1: `repeatStatus`, `type LineageEntry`
- Produces: ไม่มี (งานปลายทาง)

**บริบทที่ต้องรู้:** `dashboardEntries` (`prompt-workspace.tsx:271-282`) มี `id`, `productName`, `videoUrl`, `postedAt` ครบแล้ว — ขาดแค่ `duplicatedFromId` · `Recommendations` รับ prop `entries` มาจาก `DashboardPanel` · **ห้ามแตะ `lib/recommender.ts`** — เพิ่มบรรทัดที่ชั้นแสดงผลเท่านั้น

- [ ] **Step 1: เพิ่ม `duplicatedFromId` เข้า `dashboardEntries`**

ใน `components/prompt-workspace.tsx` useMemo ของ `dashboardEntries` เพิ่มบรรทัด (หลัง `id: p.id,`):

```tsx
        duplicatedFromId: p.duplicatedFromId,
```

- [ ] **Step 2: ขยาย type ของ prop `entries` ใน `components/dashboard-panel.tsx`**

หา type ของ prop `entries` (ราวบรรทัด 55) แล้วเพิ่ม `duplicatedFromId` เข้าไปใน intersection ที่มีอยู่ เช่น:

```tsx
  entries: (PostTimeEntry & ScoreboardEntry & { duplicatedFromId: string | null })[];
```

- [ ] **Step 3: เพิ่มบรรทัดสถานะใน `components/recommendations.tsx`**

เพิ่ม import:

```tsx
import { repeatStatus } from "@/lib/angle";
```

ขยาย type ของ prop `entries` (บรรทัด 24) จาก `{ id: string; productName: string }[]` เป็น:

```tsx
  entries: {
    id: string;
    productName: string;
    duplicatedFromId: string | null;
    videoUrl: string;
    postedAt: Date | null;
  }[];
```

เพิ่ม helper ใต้ `KIND_STYLE` (ราวบรรทัด 20):

```tsx
/**
 * บรรทัดบอกว่าทำตามคำแนะนำนี้ไปแล้วหรือยัง — ตรวจจากสายเลือดการทำซ้ำ ไม่ใช่ให้ติ๊กเอง
 * (ปัญหาต้นทางของผู้ใช้คือลืม/ไม่ได้ทำ ของที่ต้องจำไปติ๊กคือของที่ลืมได้อีกอย่าง)
 * เลือก "บอกสถานะ" ไม่ใช่ "ซ่อนคำแนะนำ" เพราะถ้าซ่อนจะไม่รู้ว่าคลิปต้นฉบับยังโตอยู่
 */
function repeatLine(
  entries: {
    id: string;
    duplicatedFromId: string | null;
    videoUrl: string;
    postedAt: Date | null;
  }[],
  entryId: string
): string | null {
  const status = repeatStatus(entries, entryId);
  if (status.repeats === 0) return null;
  const bits = [`ทำซ้ำไปแล้ว ${status.repeats} คลิป`];
  if (status.lastPostedAt) {
    bits.push(
      "ลงล่าสุด " +
        status.lastPostedAt.toLocaleDateString("th-TH", {
          day: "numeric",
          month: "short",
          timeZone: "UTC",
        })
    );
  }
  if (status.hasUnposted) bits.push("มีที่ยังไม่ได้ลง");
  return bits.join(" · ");
}
```

แล้วใน map ของ signals เพิ่มบรรทัดต่อจาก `<p ...>{s.detail}</p>`:

```tsx
              {(() => {
                const line = repeatLine(entries, s.entryId);
                return line === null ? null : (
                  <p className="font-mono text-[0.7rem] text-marigold">{line}</p>
                );
              })()}
```

- [ ] **Step 4: ปิดกับดักปุ่ม submit ใน `components/brief-form.tsx`**

เพิ่ม prop `hasSelectedEntry: boolean` (ใน destructure params และ type — วางต่อจาก `angleEntryId` ที่เพิ่มใน Task 4)

แทนที่ปุ่ม submit (บรรทัด ~374-381) ด้วย:

```tsx
        <div className="flex flex-col gap-1">
          <Button
            type="submit"
            disabled={isCreating}
            size="lg"
            className="mt-1 self-start bg-rust text-primary-foreground hover:bg-rust/90"
          >
            {isCreating
              ? "กำลังสร้าง..."
              : hasSelectedEntry
                ? "สร้างเป็นรายการใหม่"
                : "สร้าง Prompt"}
          </Button>
          {/* ปุ่มนี้เรียก createPrompt ซึ่งสร้าง entry ใหม่ที่ duplicatedFromId = null เสมอ
              กดพลาดหลังกดทำซ้ำ = สายเลือดขาด ระบบตามรอย angle ไม่ได้ */}
          {hasSelectedEntry && (
            <span className="font-mono text-[0.7rem] text-muted-foreground">
              จะได้รายการใหม่ที่ไม่ผูกกับสินค้าเดิม — ถ้าจะแก้รายการนี้ ใช้ปุ่ม &quot;สร้างด้วย AI&quot; ทางขวา
            </span>
          )}
        </div>
```

ส่ง prop จาก `components/prompt-workspace.tsx` ในบล็อก `<BriefForm ...>`:

```tsx
                hasSelectedEntry={selectedId !== null}
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

- แท็บ **④ รายได้** → การ์ด "ควรทำอะไรต่อ" → signal ของ "ที่ลับเล็บแมว" (entry 12 ก.ค.) ต้องมีบรรทัดสีเหลือง **"ทำซ้ำไปแล้ว 1 คลิป · ลงล่าสุด 26 ก.ค."**
- signal ของสินค้าอื่นที่ไม่มีลูก → **ไม่มี**บรรทัดนี้
- ทำซ้ำ entry นั้นเพิ่มอีก 1 อัน (ยังไม่ลงคลิป) → บรรทัดเปลี่ยนเป็น "ทำซ้ำไปแล้ว 2 คลิป · ลงล่าสุด 26 ก.ค. · มีที่ยังไม่ได้ลง"
- แท็บ **① Brief** เลือก entry ใดก็ได้ → ปุ่มล่างเป็น **"สร้างเป็นรายการใหม่"** พร้อมข้อความเตือนใต้ปุ่ม
- กด **"สินค้าใหม่"** → ปุ่มกลับเป็น **"สร้าง Prompt"** และไม่มีข้อความเตือน → กรอกชื่อ+ข้อมูลแล้วกด → สร้าง entry ใหม่ได้ปกติ
- Console ไม่มี error/hydration warning · แท็บอื่นและแผง angle จาก Task 4 ยังทำงานเหมือนเดิม

cleanup: `rm -rf .next-dev dev-test.db`

- [ ] **Step 7: Commit**

```bash
git diff tsconfig.json   # ต้องว่าง
git add components/recommendations.tsx components/prompt-workspace.tsx components/dashboard-panel.tsx components/brief-form.tsx
git commit -m "Say whether a repeat suggestion was already acted on

detectSignals recomputes from metrics every render, so the same advice looked
identical whether or not the clip had been remade. Lineage already answers
that, which beats a checkbox the user would have to remember to tick.

Also stops the submit button from quietly claiming to edit the selected
entry — it always creates a new unlinked one.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**ความครอบคลุมของ spec:**

| ข้อกำหนดใน spec | Task ที่ทำ |
|---|---|
| คอลัมน์ `angle` (ไม่มีตารางใหม่) | Task 1 Steps 1-2 |
| จัดกลุ่มด้วยสายเลือด ไม่ใช่ชื่อสินค้า | Task 1 (`collectFamily`) |
| นิยาม "ใช้ไปแล้ว" 3 สถานะ + กรองร่างเปล่า | Task 1 (`collectUsedAngles`) + Task 4 Step 6 (ทดสอบ UI) |
| สกัด angle จาก prompt เก่า ทนการเยื้องบรรทัด | Task 1 (`extractAngleHints`) + Step 7 (ทดสอบกับข้อมูลจริง) |
| ปุ่มเสนอ angle 3 แบบ + parser ไม่ throw | Task 1 (`parseAngleSuggestions`) + Task 3 |
| `ANGLE_MODEL` ล็อก flash-lite + temperature สูง | Task 3 Step 1 |
| ไม่ `revalidatePath` ใน `suggestAngles` | Task 3 Step 3 |
| แผงแยกไฟล์ ไม่ยัดใน brief-form | Task 4 Step 1 |
| บันทึกผ่าน action ของตัวเอง (ไม่ผ่าน form) | Task 3 (`saveAngle`) + Task 4 Step 1 (`onBlur`) |
| แสดง วิว/ออเดอร์/รายได้ ไม่จัดอันดับ | Task 1 (`summarizeEntryOutcome`) + Task 4 (`outcomeLine`) |
| `buildPromptText` รับ angle + สลับคำสั่ง use case | Task 2 |
| angle ว่าง = พฤติกรรมเดิมเป๊ะ | Task 2 Steps 1-2 (baseline byte-compare) |
| ปุ่มทำซ้ำไม่ก๊อป angle | ไม่ต้องแก้โค้ด (`duplicatePrompt` ใช้ explicit field list) — ทดสอบยืนยันใน Task 4 Step 6 |
| บรรทัดสถานะ "ทำซ้ำแล้ว" จากสายเลือด ไม่ใช้ checkbox | Task 1 (`repeatStatus`) + Task 5 |
| ปิดกับดักปุ่ม "สร้าง Prompt" | Task 5 Step 4 |
| ไม่แตะ `lib/recommender.ts` | Task 5 (แก้ชั้นแสดงผลเท่านั้น) |

**สิ่งที่ spec ระบุว่าไม่ทำ และแผนนี้ไม่ได้ทำ:** จำกัดจำนวน angle · จัดอันดับ angle · หมวดหมู่/คลัง angle กลาง · checkbox · บล็อกการใช้ angle ซ้ำ · migrate/backfill 55 entries · แก้การ์ดรก · path อัปเดตฟอร์ม Brief ✓

**ความสอดคล้องของชื่อ/ชนิด:** `collectFamily` `collectUsedAngles` `extractAngleHints` `parseAngleSuggestions` `summarizeEntryOutcome` `repeatStatus` `LineageEntry` `AngleEntry` `UsedAngle` `AngleSuggestion` `EntryOutcome` `RepeatStatus` ใช้ชื่อเดียวกันทุกจุดใน Task 1/3/4/5 ✓ · `suggestAngleOptions` (lib/gemini) ต่างจาก `suggestAngles` (action) โดยตั้งใจ — action ห่อ Gemini + parser ✓ · `UsedAngleWithOutcome` นิยามที่ `components/angle-panel.tsx` และถูก import โดย brief-form (Task 4 Step 2) และ prompt-workspace (Task 4 Step 3) ✓ · `angle` ใน `PromptFormData` เป็น required ทำให้ทุก caller ต้องแก้ — ครอบคลุมทั้ง `lib/few-shot.ts` (Task 2 Step 5) และ `app/actions.ts` (Task 3 Step 4) ✓
