# Few-shot Golden Examples Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เปลี่ยน few-shot จากการดึง "2 entry ล่าสุด" (ที่ทำให้ output drift) มาเป็นการสุ่มจากชุดตัวอย่างที่คัด+ขัดจนเพอร์เฟกต์แล้ว แช่แข็งไว้ในไฟล์

**Architecture:** ย้ายแหล่งตัวอย่าง few-shot จาก Prisma query (`lib/few-shot.ts`) ไปเป็นค่าคงที่ในไฟล์ใหม่ `lib/golden-examples.ts` แล้วสุ่มหยิบ 3 อันต่อครั้ง คง signature ของ `getFewShotExamples` ไว้เดิมเพื่อไม่ต้องแตะ caller ใน `app/actions.ts`

**Tech Stack:** TypeScript, Next.js 16 (custom build), Prisma 7 (ถอด dependency ออกจากไฟล์นี้), path alias `@/*` → repo root

## Global Constraints

- ไม่มี test runner — verify ด้วย `npm run build` (type-check ในตัว) + `npm run lint` + node assertion script (one-off) + เจนจริงผ่านหน้าเว็บ
- ห้ามรัน `npm run build`/`npm run dev` ซ้อนกับ `start.bat` ของผู้ใช้ — เช็ก port 3000 ก่อนเสมอ: `netstat -ano | grep ':3000' | grep LISTENING`
- `dev.db` มีข้อมูลจริง ไม่มี backup — ห้าม write ใดๆ; ข้อมูลตัวอย่างถูก dump ไว้แล้วที่ scratch (อ่านจากที่นั่น)
- generated Prisma client import จาก `@/lib/generated/prisma/client` โดยตรง (ไฟล์นี้ไม่ยุ่งกับ client)
- ข้อความ UI/โค้ดคอมเมนต์เป็นภาษาไทยตามสไตล์เดิมของ repo
- ตัวอย่าง golden ต้องขัดให้: ใช้คำ **"วิดีโอสั้น"** (ไม่ใช่ "TikTok Shop") · บทพากย์ลงท้าย **"ค่ะ"** (ไม่ใช่ "ครับ") · Style ระบุ **"เป็นเสียงผู้หญิง"** · ไม่มีวลี **"crop watermark"** · Negative Prompt ห้ามโลโก้แอป/UI/watermark โดย**ไม่เอ่ยชื่อแบรนด์**

## แหล่งข้อมูลตัวอย่าง (dump ไว้แล้ว)

ข้อมูลเต็มของ 25 pre-drift entries อยู่ที่:
`C:/Users/patip/AppData/Local/Temp/claude/C--Users-patip-Desktop-playground-tts-assistant-pooling-pooling-prompt/df3ded66-7ea9-41da-9b1b-2c84eae501a2/scratchpad/candidates.json`
(array ของ `{ id, productName, createdAt, productInfo, riskModule, extraNotes, images (JSON string), chatgptOutput }`)

**6 entry ที่เลือกทำ golden** (คัดให้หมวดหลากหลาย — แมว/ของใช้บ้าน/ของเหลว/ครัว):
1. `ของเล่นแมว ที่ลับเล็บแมว` (ครับ ×4, มี crop watermark)
2. `หมอนสุขภาพ` (ครับ ×4, มี crop watermark)
3. `คอนโดแมวไม้` (ครับ ×2, มี crop watermark)
4. `Dearny น้ำยาปรับผ้านุ่ม` (ครับ ×0 — ตัวอย่าง package-led UGC ของเหลว)
5. `ชั้นวางเครื่องปรุง` (ครับ ×0)
6. `หม้อสแตนเลสพร้อมฝาปิด` (ครับ ×0)

---

### Task 1: สร้าง `lib/golden-examples.ts` พร้อมตัวอย่างที่ขัดแล้ว

**Files:**
- Create: `lib/golden-examples.ts`
- Reference (อ่านอย่างเดียว): scratch `candidates.json` ข้างบน

**Interfaces:**
- Produces:
  - `export type GoldenExample = { productInfo: string; riskModule: string; extraNotes: string; images: string[]; output: string }`
  - `export const GOLDEN_EXAMPLES: GoldenExample[]` (ยาว 6)

**กติกาการขัด output (ใช้กับทั้ง 6 อัน — apply ทุกข้อ):**

- **R1:** แทนที่ `"TikTok Shop"` → `"วิดีโอสั้น"` ทุกที่ใน output (ปกติอยู่ที่ Style section จุดเดียว)
- **R2:** ใน Style section หลังข้อความ `"ใช้ voice-over ภาษาไทยเท่านั้น"` ให้แทรก `" เป็นเสียงผู้หญิง"` ต่อทันที
- **R3:** แทนที่คำลงท้าย `"ครับ"` → `"ค่ะ"` ทุกที่ใน output (คำนี้ปรากฏเฉพาะในบทพากย์เท่านั้น จึงแทนที่ทั้งก้อนได้ปลอดภัย)
- **R4:** ลบวลี `"สำหรับ crop watermark"` ออกจาก Framing section (เช่น `"เผื่อขอบภาพเล็กน้อยสำหรับ crop watermark"` → `"เผื่อขอบภาพเล็กน้อย"`); ถ้าเจอคำ `"crop watermark"` แบบอื่นให้ตัดคำว่า watermark ออกให้ประโยคยังอ่านรู้เรื่อง
- **R5:** ใน Negative Prompt section ให้มี clause ห้ามโลโก้แอป/UI/watermark แบบไม่เอ่ยแบรนด์เสมอ — ถ้าเดิมมีคำว่า `"watermark เพิ่ม"` อยู่แล้ว ให้แทนที่ชิ้นส่วน `"UI overlay, callout, ราคา, watermark เพิ่ม"` เป็น `"UI overlay, callout, ราคา, โลโก้แอปหรือ UI ของแอปโซเชียลใดๆ, watermark"` (คงคำ watermark ทั่วไปไว้ได้ ห้ามใส่ชื่อ TikTok/CapCut)

**`productInfo` / `riskModule` / `extraNotes` / `images`:** ใช้ค่าจาก `candidates.json` ตรงๆ (images: `JSON.parse` string ให้เป็น `string[]`) — ไม่ต้องขัด แก้เฉพาะ `output`

**ตัวอย่างเต็ม before → after (entry #1 `ของเล่นแมว ที่ลับเล็บแมว` — ใช้เป็น pattern อ้างอิง):**

BEFORE (Style + จุดที่ต้องแก้):
```
1. **Style**
สร้างวิดีโอแนวตั้งสำหรับ TikTok Shop ความยาว 10 วินาที สไตล์ UGC ... สินค้าต้องเป็นพระเอกตลอดคลิป ใช้ voice-over ภาษาไทยเท่านั้น น้ำเสียงเป็นกันเอง กระชับ ...
...
5. **Action Timeline**
**Full voice-over script:**
“น้องแมวที่บ้านชอบข่วนโซฟา ลองจัดของเล่นชิ้นนี้ให้เลยครับ ... จิ้มตะกร้าได้เลยครับ”
...
เสียงพากย์: “... ลองจัดของเล่นชิ้นนี้ให้เลยครับ”
...
เสียงพากย์: “จิ้มตะกร้าได้เลยครับ”
...
7. **Framing**
ต้องเห็นสินค้าทั้งชิ้นใน 1–2 วินาทีแรก มีช็อตใกล้ให้เห็นรายละเอียดเชือกป่านและสปริงขนนก เผื่อขอบภาพเล็กน้อยสำหรับ crop watermark
...
9. **Negative Prompt**
ห้ามมีหน้าคน, ห้ามซับ, ห้ามข้อความบนจอ, ห้าม label, poster, UI overlay, callout, ราคา, watermark เพิ่ม, ห้ามตัวหนังสือในฉากหลัง, ...
```

AFTER (จุดเดียวกัน หลัง apply R1–R5):
```
1. **Style**
สร้างวิดีโอแนวตั้งสำหรับวิดีโอสั้น ความยาว 10 วินาที สไตล์ UGC ... สินค้าต้องเป็นพระเอกตลอดคลิป ใช้ voice-over ภาษาไทยเท่านั้น เป็นเสียงผู้หญิง น้ำเสียงเป็นกันเอง กระชับ ...
...
5. **Action Timeline**
**Full voice-over script:**
“น้องแมวที่บ้านชอบข่วนโซฟา ลองจัดของเล่นชิ้นนี้ให้เลยค่ะ ... จิ้มตะกร้าได้เลยค่ะ”
...
เสียงพากย์: “... ลองจัดของเล่นชิ้นนี้ให้เลยค่ะ”
...
เสียงพากย์: “จิ้มตะกร้าได้เลยค่ะ”
...
7. **Framing**
ต้องเห็นสินค้าทั้งชิ้นใน 1–2 วินาทีแรก มีช็อตใกล้ให้เห็นรายละเอียดเชือกป่านและสปริงขนนก เผื่อขอบภาพเล็กน้อย
...
9. **Negative Prompt**
ห้ามมีหน้าคน, ห้ามซับ, ห้ามข้อความบนจอ, ห้าม label, poster, UI overlay, callout, ราคา, โลโก้แอปหรือ UI ของแอปโซเชียลใดๆ, watermark, ห้ามตัวหนังสือในฉากหลัง, ...
```

**โครงไฟล์ที่ต้องได้ (ตัวอย่างแสดง entry เดียว — ที่เหลืออีก 5 ทำแบบเดียวกันจาก candidates.json):**

```ts
// ตัวอย่าง few-shot ที่คัดจาก entry ก่อนช่วง drift แล้วขัดให้เป็นมาตรฐานทองของช่อง:
// วิดีโอสั้น (ไม่ใช่ TikTok Shop) / เสียงผู้หญิง (ลงท้าย "ค่ะ") / ไม่มี crop watermark /
// Negative Prompt ห้ามโลโก้แอปโดยไม่เอ่ยแบรนด์ — แช่แข็งไว้เพื่อกัน output drift
// (ห้ามให้ few-shot หมุนตาม output ล่าสุดที่อาจเพี้ยนอีก)
export type GoldenExample = {
  productInfo: string;
  riskModule: string;
  extraNotes: string;
  images: string[];
  output: string; // 10-part prompt ที่ขัดจนเพอร์เฟกต์แล้ว
};

export const GOLDEN_EXAMPLES: GoldenExample[] = [
  {
    productInfo: "<productInfo ของ 'ของเล่นแมว ที่ลับเล็บแมว' จาก candidates.json>",
    riskModule: "<riskModule เดิม>",
    extraNotes: "<extraNotes เดิม>",
    images: ["ภาพหน้าสินค้า", "ภาพตอนใช้งาน"],
    output: `<chatgptOutput เดิม หลัง apply R1–R5>`,
  },
  // ... อีก 5 อัน: หมอนสุขภาพ, คอนโดแมวไม้, Dearny น้ำยาปรับผ้านุ่ม, ชั้นวางเครื่องปรุง, หม้อสแตนเลสพร้อมฝาปิด
];
```

- [ ] **Step 1: เขียนสคริปต์ช่วยขัด output จาก candidates.json** (ช่วยความแม่น ไม่ใช่ไฟล์ production)

สร้าง `<scratch>/build-golden.js` ที่อ่าน candidates.json เลือก 6 entry ตามชื่อ แล้ว apply R1–R5 ด้วย string ops:

```js
const fs = require('fs');
const SCRATCH = 'C:/Users/patip/AppData/Local/Temp/claude/C--Users-patip-Desktop-playground-tts-assistant-pooling-pooling-prompt/df3ded66-7ea9-41da-9b1b-2c84eae501a2/scratchpad';
const rows = JSON.parse(fs.readFileSync(SCRATCH + '/candidates.json', 'utf8'));
const NAMES = ['ของเล่นแมว ที่ลับเล็บแมว','หมอนสุขภาพ','คอนโดแมวไม้','Dearny น้ำยาปรับผ้านุ่ม','ชั้นวางเครื่องปรุง','หม้อสแตนเลสพร้อมฝาปิด'];

function polish(out) {
  let o = out;
  o = o.split('TikTok Shop').join('วิดีโอสั้น');                                   // R1
  o = o.replace('ใช้ voice-over ภาษาไทยเท่านั้น', 'ใช้ voice-over ภาษาไทยเท่านั้น เป็นเสียงผู้หญิง'); // R2
  o = o.split('ครับ').join('ค่ะ');                                                 // R3
  o = o.split('สำหรับ crop watermark').join('').split('  ').join(' ');             // R4
  o = o.split('UI overlay, callout, ราคา, watermark เพิ่ม')                        // R5
       .join('UI overlay, callout, ราคา, โลโก้แอปหรือ UI ของแอปโซเชียลใดๆ, watermark');
  return o;
}

const examples = NAMES.map((name) => {
  const r = rows.find((x) => x.productName === name);
  if (!r) throw new Error('missing ' + name);
  return {
    productInfo: r.productInfo,
    riskModule: r.riskModule,
    extraNotes: r.extraNotes,
    images: JSON.parse(r.images),
    output: polish(r.chatgptOutput),
  };
});
fs.writeFileSync(SCRATCH + '/golden.json', JSON.stringify(examples, null, 2), 'utf8');
console.log('wrote', examples.length, 'examples');
```

Run: `node <scratch>/build-golden.js`
Expected: `wrote 6 examples`

- [ ] **Step 2: ตรวจผลการขัดว่าครบทุกกติกา (assertion)**

สร้าง `<scratch>/check-golden.js`:

```js
const fs = require('fs');
const SCRATCH = 'C:/Users/patip/AppData/Local/Temp/claude/C--Users-patip-Desktop-playground-tts-assistant-pooling-pooling-prompt/df3ded66-7ea9-41da-9b1b-2c84eae501a2/scratchpad';
const ex = JSON.parse(fs.readFileSync(SCRATCH + '/golden.json', 'utf8'));
let fail = 0;
for (const [i, e] of ex.entries()) {
  const o = e.output;
  const checks = {
    noTikTok: !/tiktok/i.test(o),
    hasVideoSan: o.includes('วิดีโอสั้น'),
    hasFemale: o.includes('เป็นเสียงผู้หญิง'),
    noKrab: !o.includes('ครับ'),
    noCropWatermark: !/crop watermark/i.test(o),
    hasAppLogoBan: o.includes('โลโก้แอปหรือ UI ของแอปโซเชียลใดๆ'),
  };
  for (const [k, v] of Object.entries(checks)) {
    if (!v) { console.log(`FAIL ex#${i} (${k})`); fail++; }
  }
}
console.log(fail === 0 ? 'ALL GOLDEN CHECKS PASS' : `${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
```

Run: `node <scratch>/check-golden.js`
Expected: `ALL GOLDEN CHECKS PASS`

> หมายเหตุ: ถ้าอันไหนไม่ผ่าน (เช่น entry ที่ไม่มีสตริง `"UI overlay, callout, ราคา, watermark เพิ่ม"` ตรงเป๊ะ ทำให้ R5 ไม่ติด) ให้ขัด output อันนั้นด้วยมือให้ครบกติกา R1–R5 ก่อนไปต่อ — เป้าหมายคือทั้ง 6 อันผ่าน assertion

- [ ] **Step 3: เขียน `lib/golden-examples.ts` จริงจาก golden.json**

เอา `type GoldenExample` + คอมเมนต์หัวไฟล์ (ตาม "โครงไฟล์ที่ต้องได้" ข้างบน) แล้ววาง array 6 อันจาก `golden.json` โดยใช้ template literal (backtick) กับ field `output` (เพราะเป็นข้อความหลายบรรทัด) — ระวัง escape backtick/`${` ถ้ามีในเนื้อหา (จากการตรวจ ไม่มี) fields อื่นเป็น string ปกติ

- [ ] **Step 4: ตรวจว่าไฟล์ compile ได้ (type-check เดี่ยว)**

Run: `npx tsc --noEmit lib/golden-examples.ts 2>&1 | head -20`
Expected: ไม่มี error (อาจมี warning module resolution ได้ แต่ต้องไม่มี type error ของ `GoldenExample`)

- [ ] **Step 5: Commit**

```bash
git add lib/golden-examples.ts
git commit -m "Add curated golden few-shot examples frozen to a file

$(printf 'Freeze 6 hand-polished pre-drift outputs (\xe0\xb8\xa7\xe0\xb8\xb4\xe0\xb8\x94\xe0\xb8\xb5\xe0\xb9\x82\xe0\xb8\xad\xe0\xb8\xaa\xe0\xb8\xb1\xe0\xb9\x89\xe0\xb8\x99/female voice/no watermark trigger) as the few-shot source of truth.')

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: เปลี่ยน `lib/few-shot.ts` มาสุ่มจาก golden pool

**Files:**
- Modify: `lib/few-shot.ts` (ทั้งไฟล์)
- Test (one-off): `<scratch>/test-fewshot.mjs`

**Interfaces:**
- Consumes: `GOLDEN_EXAMPLES`, `GoldenExample` จาก `@/lib/golden-examples` (Task 1); `buildPromptText` จาก `@/lib/prompt-template`
- Produces: `getFewShotExamples(excludeEntryId: string): Promise<{ brief: string; output: string }[]>` — signature เดิมเป๊ะ (caller `app/actions.ts` → `generateWithAI` เรียกด้วย `await` param เดียว) แต่ตอนนี้คืน 3 อันสุ่มจาก golden ไม่แตะ DB

- [ ] **Step 1: เขียนไฟล์ `lib/few-shot.ts` ใหม่ทั้งไฟล์**

```ts
import { buildPromptText } from "@/lib/prompt-template";
import { GOLDEN_EXAMPLES } from "@/lib/golden-examples";

/**
 * จำนวนตัวอย่างที่สุ่มหยิบต่อการเจน 1 ครั้ง — 3 อันจากกอง golden ที่คัด+ขัดแล้ว
 * (มากกว่าเดิมที่ 2 เล็กน้อยเพื่อล็อกฟอร์แมตแน่นขึ้น ปลอดภัยเพราะทุกอันในกองสะอาดหมด)
 */
const SAMPLE_COUNT = 3;

/**
 * ตัวอย่าง few-shot ที่ป้อนให้โมเดลตอนสร้าง 10-part prompt — ตอนนี้สุ่มจากชุด golden ที่
 * แช่แข็งไว้ใน lib/golden-examples.ts (ไม่ดึง entry ล่าสุดจาก DB อีกต่อไป)
 *
 * เหตุผล: การดึง "entry ล่าสุด" ทำให้ few-shot หมุนตาม output ที่โมเดลเจนเอง — พอมีอันหนึ่ง
 * หลุด (เช่น watermark, เสียงเพศ) มันก็สอนตัวถัดไปให้หลุดตาม เป็นวงจร drift ไล่ตัวเองออก
 * ชุด golden ตัดวงจรนี้เพราะไม่มีทางให้ output ที่เพี้ยนแอบเข้ากอง
 *
 * คง signature เดิม (async + รับ excludeEntryId) เพื่อไม่ต้องแตะ caller ใน app/actions.ts
 * พารามิเตอร์ไม่ถูกใช้แล้วเพราะ golden ไม่ใช่ entry ในระบบ จึงไม่มีทางชนกับตัวที่กำลังเจน
 */
export async function getFewShotExamples(
  _excludeEntryId: string
): Promise<{ brief: string; output: string }[]> {
  const pool = [...GOLDEN_EXAMPLES];
  // Fisher-Yates shuffle เพื่อให้เห็น anchor สไตล์ต่างกันไปแต่ละครั้ง (ความหลากหลายด้านโทน)
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const picked = pool.slice(0, Math.min(SAMPLE_COUNT, pool.length));
  return picked.map((ex) => ({
    brief: buildPromptText({
      productInfo: ex.productInfo,
      riskModule: ex.riskModule,
      extraNotes: ex.extraNotes,
      images: ex.images,
    }),
    output: ex.output,
  }));
}
```

> `prisma` import เดิมถูกลบทั้งหมด (ไฟล์นี้ไม่แตะ DB แล้ว) — ตรวจว่าไม่มี reference `prisma` ค้าง

- [ ] **Step 2: ตรวจ lint/type ของไฟล์**

Run (เช็ก port 3000 ก่อน ถ้ามี server รันอยู่ให้ทำแค่ lint): `npm run lint 2>&1 | grep -A3 few-shot`
Expected: ไม่มี error/warning ที่ few-shot.ts

หมายเหตุ: ถ้า lint rule `@typescript-eslint/require-await` ฟ้องว่า async ไม่มี await — เพิ่มบรรทัด `// eslint-disable-next-line @typescript-eslint/require-await` เหนือ `export async function` (จำเป็นต้องคง async ไว้เพื่อรักษา signature ให้ caller `await` ได้เหมือนเดิม)

- [ ] **Step 3: เขียน one-off test ตรวจพฤติกรรม getFewShotExamples**

สร้าง `<scratch>/test-fewshot.mjs` (รันผ่าน bundle ไม่ได้ตรงๆ เพราะ path alias — จึงเทสตรรกะสุ่มบน GOLDEN_EXAMPLES แบบ inline):

```js
// ตรวจ 2 อย่าง: (1) สุ่มคืน 3 อันเสมอ (2) การสุ่มให้ชุดต่างกันได้จริง
import fs from 'node:fs';
const SCRATCH = 'C:/Users/patip/AppData/Local/Temp/claude/C--Users-patip-Desktop-playground-tts-assistant-pooling-pooling-prompt/df3ded66-7ea9-41da-9b1b-2c84eae501a2/scratchpad';
const golden = JSON.parse(fs.readFileSync(SCRATCH + '/golden.json', 'utf8'));
function sample(n) {
  const pool = [...golden];
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool.slice(0, Math.min(n, pool.length));
}
const a = sample(3), b = sample(3);
const okCount = a.length === 3;
let sawDifferent = false;
for (let t = 0; t < 20 && !sawDifferent; t++) {
  const s = sample(3).map((e) => e.output.slice(0, 20)).join('|');
  const s2 = sample(3).map((e) => e.output.slice(0, 20)).join('|');
  if (s !== s2) sawDifferent = true;
}
console.log('count==3:', okCount, '| variety:', sawDifferent);
process.exit(okCount && sawDifferent ? 0 : 1);
```

Run: `node <scratch>/test-fewshot.mjs`
Expected: `count==3: true | variety: true`

- [ ] **Step 4: Commit**

```bash
git add lib/few-shot.ts
git commit -m "Source few-shot examples from frozen golden pool, not recent DB entries

$(printf 'Stops the self-reinforcing output drift where a dropped constraint in one\ngenerated output taught the next generation to drop it too.')

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Verify ทั้งฟีเจอร์ (build + เจนจริง)

**Files:** ไม่มีไฟล์ใหม่ — เป็นขั้นตรวจ

**Interfaces:**
- Consumes: `lib/golden-examples.ts` (Task 1), `lib/few-shot.ts` (Task 2)

- [ ] **Step 1: เช็ก port 3000 ก่อน build**

Run: `netstat -ano | grep ':3000' | grep LISTENING`
Expected: ไม่มี output (ถ้ามี = ผู้ใช้รัน `start.bat` อยู่ → หยุดถามผู้ใช้ก่อน อย่า build ซ้อน)

- [ ] **Step 2: Build (type-check ในตัว)**

Run: `npm run build`
Expected: build สำเร็จ ไม่มี type error

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: ไม่มี error ใหม่ที่ `lib/few-shot.ts` หรือ `lib/golden-examples.ts`

- [ ] **Step 4: เจนคลิปจริงผ่านหน้าเว็บ (Playwright ใน scratch dir)**

- รัน `npm run start` (หลัง build) หรือใช้ server ที่ผู้ใช้เปิดไว้
- เปิดแอป → แท็บ ① เลือก entry ที่มีข้อมูลครบ (หรือสร้างใหม่) → กด "สร้างด้วย AI"
- ตรวจ 10-part output ที่ได้ในแท็บ ② ว่า:
  - Style/identity ใช้คำ **"วิดีโอสั้น"** และ **ไม่มีคำ "TikTok"** เลย
  - Style ระบุ **"เป็นเสียงผู้หญิง"** และบทพากย์ลงท้าย **"ค่ะ"**
  - Negative Prompt มี clause **ห้ามโลโก้แอป/UI/watermark**
  - Framing **ไม่มีคำ "crop watermark"**

Expected: ครบทั้ง 4 ข้อ (ตัวอย่าง golden ที่สุ่มเข้าไปเป็นตัว anchor ให้ output ออกมาแบบนี้)

> ถ้ามีข้อไหนหลุด: ตรวจว่า golden ที่สุ่มได้ทั้ง 3 อันมีคุณสมบัตินั้นครบไหม (Task 1 assertion ควรกันไว้แล้ว) — ถ้า golden ครบแต่ output ยังหลุด แปลว่า Core Prompt (system instruction) ยังดึงไปทางเดิม → ต้องรอผู้ใช้แก้ Core Prompt manual (ดู "แทร็ก manual" ด้านล่าง)

- [ ] **Step 5: ยืนยันข้อมูลจริงใน dev.db ไม่ถูกแตะ**

Run:
```bash
node -e "const D=require('C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt/node_modules/better-sqlite3');const db=new D('C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt/dev.db',{readonly:true});console.log('entries',db.prepare('SELECT COUNT(*) c FROM PromptEntry').get().c,'orders',db.prepare('SELECT COUNT(*) c FROM AffiliateOrder').get().c);db.close();"
```
Expected: `entries 25 orders <เท่าเดิม>` (ไม่ลดลง)

---

## แทร็ก manual (นอกขอบเขตโค้ด — ผู้ใช้ทำเองในแอป แท็บ ③ Core Prompt ฝั่ง core)

ไม่อยู่ในแผน implement นี้ แต่ golden examples ถูกออกแบบให้สอดคล้องกับมัน — ผู้ใช้แก้ Core Prompt 3 จุด แล้วบันทึกเป็นเวอร์ชันใหม่:
1. บรรทัด identity `"TikTok Shop"` → `"วิดีโอสั้น"`
2. เพิ่ม `"เป็นเสียงผู้หญิงเสมอ ลงท้ายด้วย ค่ะ"` ต่อจาก `"ใช้ voice-over ภาษาไทยเท่านั้น"`
3. clause ห้าม watermark แบบ**ไม่เอ่ยชื่อ TikTok** เช่น `"ห้ามมีโลโก้แอปหรือ UI ของแอปโซเชียลใดๆ ในวิดีโอ"`

---

## Self-Review (writing-plans checklist)

1. **Spec coverage:**
   - แช่แข็ง golden ในไฟล์ + สุ่ม 3 → Task 1 + Task 2 ✓
   - คัดจาก entry ก่อน drift + ขัด (วิดีโอสั้น/เสียงผู้หญิง/ห้าม watermark) → Task 1 R1–R5 ✓
   - คง signature `getFewShotExamples` → Task 2 Interfaces ✓
   - ไม่แตะ input form / output format / Core Prompt / gemini.ts / prompt-template.ts → ไม่มี task แตะไฟล์เหล่านั้น ✓
   - กอง 5-6 สุ่ม 3 → เลือก 6, `SAMPLE_COUNT = 3` ✓
   - fallback ถ้ากองน้อยกว่า 3 → `Math.min(SAMPLE_COUNT, pool.length)` ✓
   - verify build+lint+เจนจริง+ข้อมูลไม่หาย → Task 3 ✓
2. **Placeholder scan:** โค้ดทุก step เป็นของจริง; ที่เหลืออีก 5 golden ระบุแหล่ง (candidates.json) + กติกาแปลง (R1–R5) + สคริปต์ประกอบ + assertion ครบ ไม่ใช่ placeholder
3. **Type consistency:** `GoldenExample`/`GOLDEN_EXAMPLES` นิยามใน Task 1 ใช้ตรงกันใน Task 2; `getFewShotExamples` คืน `{ brief; output }[]` เท่าเดิม; `buildPromptText` รับ `{ productInfo, riskModule, extraNotes, images }` ตรงกับ `lib/prompt-template.ts` ✓

## Git

แตก branch ใหม่จาก `master`: `feature/few-shot-golden-examples`
