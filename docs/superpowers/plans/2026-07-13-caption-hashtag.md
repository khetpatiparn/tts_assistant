# Caption & Hashtag อัตโนมัติ — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** กด "สร้างด้วย AI" ครั้งเดียว ได้ครบทั้ง 10-part prompt, Caption และ Hashtag พร้อมโพสต์ TikTok

**Architecture:** ต่อ stage ที่ 2 เข้ากับ Server Action `generateWithAI` ที่มีอยู่ — บันทึก 10-part prompt ลง DB ให้เสร็จก่อน แล้วยิง 10-part prompt นั้นกลับเข้า Gemini อีกครั้ง (ข้อความล้วน ไม่ส่งรูป) โดยใช้ SEO prompt ที่เก็บใน DB เป็น system instruction ผลลัพธ์ถูกแยกเป็น caption/hashtags แล้วบันทึกลง `PromptEntry`

**Tech Stack:** Next.js 16.2.10 (custom build) · Prisma 7 + SQLite (driver adapter) · `@google/genai` · Tailwind v4 · shadcn/ui บน Base UI

**Spec:** `docs/superpowers/specs/2026-07-13-caption-hashtag-design.md` — อ่านก่อนเริ่ม

## Global Constraints

- **`@google/genai` ใช้ snake_case**: `system_instruction` (ไม่ใช่ `systemInstruction`) และ `temperature` อยู่ใน `generation_config` — **สะกดผิดแล้ว API เงียบ ไม่ error แต่ prompt จะไม่ถูกส่งไปเลย** ห้ามเดา shape ให้ดู `lib/gemini.ts` ที่ทำงานได้อยู่แล้วเป็นแบบอย่าง และห้ามกลบด้วย `as any`
- **stage ที่ 2 ต้องใช้ `gemini-3.1-flash-lite` เสมอ** ไม่ว่าผู้ใช้เลือกโมเดลไหนใน dropdown — โควตาแยกคนละ pool และ `gemini-3.5-flash` มีแค่ 20 ครั้ง/วัน
- **บันทึก `chatgptOutput` ลง DB ก่อนเริ่ม stage 2 เสมอ** — ความล้มเหลวของ caption ต้องไม่ทำให้ 10-part prompt หาย
- **`generateWithAI` ต้องไม่ throw เมื่อ caption ล้มเหลว** — ให้ return `{ captionError }` แทน (ถ้า throw ก่อน `revalidatePath` หน้าเว็บจะไม่เห็น 10-part prompt ที่บันทึกไปแล้วจนกว่าจะ refresh)
- **`dev.db` มีข้อมูลจริงของผู้ใช้ 17 entries + Core Prompt v4 ไม่มี backup** — **ห้ามรัน `DELETE FROM <table>;` แบบไม่มี `WHERE`** เด็ดขาด ตอนล้างข้อมูลทดสอบให้ระบุ `WHERE productName = '...'` เจาะจงแถวที่ตัวเองสร้างเท่านั้น (เคยลบข้อมูลผู้ใช้พังมาแล้ว)
- **ห้าม commit `.env` / `GEMINI_API_KEY`**
- **ไม่มี test runner** — "test" คือ `npm run build` (type-check ในตัว) + `npm run lint` + ขับจริงผ่าน Playwright ห้ามเพิ่ม Jest/Vitest
- **Playwright ไม่ใช่ dependency ของโปรเจกต์** — ติดตั้งใน scratchpad dir ของ session เท่านั้น ห้ามใส่ใน `package.json`
- **ใช้ design token เดิมเท่านั้น** — สี `ink`/`ink-2`/`paper`/`marigold`/`rust`/`smoke`/`record`, ฟอนต์ `font-display`/`font-sans`/`font-mono` และใช้ `Button`/`Input`/`Textarea` จาก `components/ui/`
- **ข้อความ UI เป็นภาษาไทยทั้งหมด** ให้เข้ากับของเดิม (`สร้าง Prompt`, `คัดลอก`, `บันทึกผลลัพธ์`)
- **Windows/git-bash: kill process ตาม port ด้วย double slash** — `netstat -ano | grep ':3000' | grep LISTENING` แล้ว `taskkill //PID <pid> //F` เช็ก port 3000 ก่อนสตาร์ท dev server
- **commit ทุก task ห้ามรวบ**

## File Structure

**Created**
- `lib/caption.ts` — แยกข้อความที่โมเดลตอบกลับเป็น `{ caption, hashtags }` (หน้าที่เดียว ทดสอบง่าย)
- `prisma/seed/seo-prompt-v1.md` — เนื้อหา SEO prompt ตั้งต้น (เก็บเป็นไฟล์เพื่อให้ seed ซ้ำได้และเห็น diff เวลาแก้)
- `prisma/seed/seed-seo-prompt.mjs` — สคริปต์ insert แถว `kind = "caption"` แถวแรก รันครั้งเดียว

**Modified**
- `prisma/schema.prisma` — `CorePrompt.kind`, `PromptEntry.caption`, `PromptEntry.hashtags`
- `lib/gemini.ts` — เพิ่ม `CAPTION_MODEL` + `generateCaptionAndHashtags()`
- `app/actions.ts` — `generateWithAI` ต่อ stage 2, `updateProduction` บันทึก caption/hashtags, `createCorePrompt`/`setActiveCorePrompt` รู้จัก `kind`
- `app/page.tsx` — ไม่ต้องแก้ query (ดึง corePrompts ทั้งหมดอยู่แล้ว) แต่ต้องส่ง `kind` ต่อ
- `components/prompt-workspace.tsx` — type เพิ่มฟิลด์, แยก corePrompts ตาม kind, รับ `captionError`
- `components/core-prompt-panel.tsx` — รับ props `kind` + `title` เพื่อใช้ซ้ำได้ 2 ที่
- `components/production-panel.tsx` — ช่อง Caption/Hashtags + ปุ่ม "คัดลอกทั้งหมด"
- `CLAUDE.md` — บันทึกสิ่งที่เรียนรู้

**Boundaries:** `lib/gemini.ts` เป็นไฟล์เดียวที่ import `@google/genai` · `lib/caption.ts` เป็น pure function ไม่แตะ DB/network · `app/actions.ts` เป็นชั้นบางๆ ที่ประกอบทุกอย่างเข้าด้วยกัน

---

### Task 1: พิสูจน์ว่า flash-lite เขียน caption ได้ดีพอ (ต้องผ่านก่อนถึงจะทำ Task 2)

**ทำใน scratch dir ไม่ใช่ในโปรเจกต์** — ถ้าไม่ผ่านจะได้ทิ้งได้เลยไม่มีขยะตกค้าง

**Files:**
- Create: `$SCRATCH/caption-check.mjs` (ไม่ commit)

**Interfaces:**
- Consumes: `chatgptOutput` ของ entry เก่าใน `dev.db` (read-only), เนื้อหา SEO prompt จาก Appendix ของ spec
- Produces: คำตัดสินว่าผ่าน/ไม่ผ่าน — ถ้าผ่านจึงไป Task 2

- [ ] **Step 1: เขียน harness**

สร้าง `$SCRATCH/caption-check.mjs` โดยติดตั้ง dep ใน scratch dir: `npm i @google/genai better-sqlite3 dotenv`

```js
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { GoogleGenAI } from "@google/genai";

const PROJ = "C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt";
const MODEL = "gemini-3.1-flash-lite";
const SEO_PROMPT = fs.readFileSync(process.argv[2], "utf8"); // path ไปยังไฟล์ SEO prompt

const db = new Database(path.join(PROJ, "dev.db"), { readonly: true });
const rows = db
  .prepare(
    `SELECT productName, chatgptOutput FROM PromptEntry
     WHERE length(chatgptOutput) > 2000
       AND (productName LIKE '%แก้วกาแฟ%' OR productName LIKE '%ลับเล็บ%' OR productName LIKE '%ชั้นวาง%')
     LIMIT 3`
  )
  .all();
db.close();

const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

for (const row of rows) {
  const t0 = Date.now();
  const res = await client.interactions.create({
    model: MODEL,
    system_instruction: SEO_PROMPT,          // snake_case — ห้ามเปลี่ยนเป็น camelCase
    generation_config: { temperature: 0.3 },
    input: [
      {
        type: "text",
        text: `### Video Prompt\n${row.chatgptOutput}\n\n### Output Mode\nready_to_post`,
      },
    ],
  });
  const out = res.output_text ?? "";
  fs.writeFileSync(`caption-${row.productName}.txt`, out);

  // ตรวจตามเกณฑ์
  const m = out.match(/Caption:\s*([\s\S]*?)\n\s*Hashtags:\s*([\s\S]*)/i);
  const caption = m ? m[1].trim() : null;
  const tags = m ? m[2].trim().split(/\s+/).filter((t) => t.startsWith("#")) : [];
  const banned = tags.filter((t) => /#(fyp|viral|trending|ขึ้นฟีด|ฟีด|tiktok)$/i.test(t));

  console.log({
    product: row.productName,
    seconds: ((Date.now() - t0) / 1000).toFixed(1),
    parsed: Boolean(m),
    captionChars: caption ? caption.replace(/\s/g, "").length : 0,
    tagCount: tags.length,
    bannedTags: banned,
    caption,
    tags,
  });
}
```

- [ ] **Step 2: รันกับ SEO prompt จริง**

คัดลอกเนื้อหาในบล็อก ` ```markdown ` ของหัวข้อ **Appendix** ใน `docs/superpowers/specs/2026-07-13-caption-hashtag-design.md` ไปไว้ที่ `$SCRATCH/seo-prompt.md` (เอาเฉพาะเนื้อ ไม่เอา fence) แล้วรัน:

```bash
node caption-check.mjs "$SCRATCH/seo-prompt.md"
```

- [ ] **Step 3: ตัดสินตามเกณฑ์**

ทั้ง 3 อันต้อง:
- `parsed: true` (แยก Caption/Hashtags ได้)
- `captionChars` อยู่ระหว่าง 70–140
- `tagCount` 4–5
- `bannedTags` ว่าง
- **ตรวจด้วยตา:** ชื่อสินค้าอยู่ช่วงต้นของ caption · hashtag อย่างน้อย 3 อันเฉพาะเจาะจงกับสินค้า · ไม่มีการเคลมเกินข้อมูล (ราคา/ส่งฟรี/ขายดี/รักษาโรค)

เทียบกับตัวอย่าง caption ที่ผู้ใช้เขียนไว้ใน spec (แก้วกาแฟ / ที่ลับเล็บแมว / ชั้นวางของ) ว่าคุณภาพใกล้เคียงกันไหม

**ถ้าไม่ผ่าน: หยุด รายงานผลจริงให้ผู้ใช้ ห้ามเดินหน้าต่อ** (ทางเลือกที่จะเสนอ: ใช้ 3.5-flash เฉพาะ stage นี้ / ปรับ SEO prompt / ใส่ few-shot จากตัวอย่าง caption ของผู้ใช้)

- [ ] **Step 4: ไม่ต้อง commit อะไร** — harness อยู่ใน scratch เท่านั้น

---

### Task 2: Schema + seed SEO prompt

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/seed/seo-prompt-v1.md`
- Create: `prisma/seed/seed-seo-prompt.mjs`
- Create: `prisma/migrations/<timestamp>_caption_and_prompt_kind/migration.sql` (generate เอา ห้ามเขียนมือ)

**Interfaces:**
- Produces:
  - `CorePrompt.kind: string` (`"core"` | `"caption"`, default `"core"`)
  - `PromptEntry.caption: string` (default `""`), `PromptEntry.hashtags: string` (default `""`)
  - แถว `CorePrompt` ที่ `kind = "caption"`, `label = "SEO v1"`, `isActive = true` อยู่ใน `dev.db`

- [ ] **Step 1: แก้ schema**

ใน `prisma/schema.prisma` เพิ่ม `kind` ใน `model CorePrompt`:

```prisma
  kind      String        @default("core")
```

และเพิ่ม 2 บรรทัดใน `model PromptEntry` (ฟิลด์เดิมห้ามแตะ):

```prisma
  caption        String      @default("")
  hashtags       String      @default("")
```

`@default("core")` ทำให้ 4 แถวเดิมกลายเป็น `kind = "core"` อัตโนมัติ ไม่ต้องเขียน data migration

- [ ] **Step 2: migrate + generate**

```bash
npx prisma migrate dev --name caption_and_prompt_kind
npx prisma generate
```

ยืนยันว่าข้อมูลจริงรอด:
```bash
node -e "
const D = require('better-sqlite3');
const db = new D('dev.db', { readonly: true });
console.log('entries:', db.prepare('SELECT COUNT(*) c FROM PromptEntry').get().c);
console.log('core prompts:', db.prepare(\"SELECT COUNT(*) c FROM CorePrompt WHERE kind = 'core'\").get().c);
db.close();"
```
คาดหวัง: `entries: 17` และ core prompts เท่ากับจำนวนเดิม (ทุกแถวต้องเป็น `kind = 'core'`)

- [ ] **Step 3: เก็บเนื้อหา SEO prompt เป็นไฟล์**

สร้าง `prisma/seed/seo-prompt-v1.md` โดยคัดลอกเนื้อหาในบล็อก ` ```markdown ` ของหัวข้อ **Appendix** ใน `docs/superpowers/specs/2026-07-13-caption-hashtag-design.md` มาทั้งหมด (เอาเฉพาะเนื้อข้างใน ไม่เอาตัว fence) — ห้ามย่อ ห้ามแก้ถ้อยคำ นี่คือ prompt ที่ผู้ใช้เขียนเอง

- [ ] **Step 4: สคริปต์ seed**

สร้าง `prisma/seed/seed-seo-prompt.mjs`:

```js
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const root = process.cwd();
const content = fs.readFileSync(
  path.join(root, "prisma/seed/seo-prompt-v1.md"),
  "utf8"
);

const db = new Database(path.join(root, "dev.db"));

const existing = db
  .prepare("SELECT COUNT(*) c FROM CorePrompt WHERE kind = 'caption'")
  .get().c;

if (existing > 0) {
  console.log(`มี caption prompt อยู่แล้ว ${existing} เวอร์ชัน — ไม่ทำอะไร`);
} else {
  db.prepare(
    `INSERT INTO CorePrompt (id, label, content, isActive, kind, createdAt)
     VALUES (?, ?, ?, 1, 'caption', ?)`
  ).run(
    `seo${Date.now().toString(36)}`,
    "SEO v1",
    content,
    Date.now()
  );
  console.log("seed SEO v1 เรียบร้อย");
}

db.close();
```

รัน: `node prisma/seed/seed-seo-prompt.mjs`
คาดหวัง: `seed SEO v1 เรียบร้อย` และรันซ้ำอีกครั้งต้องขึ้นว่าไม่ทำอะไร (idempotent — ห้ามสร้างซ้ำ)

ตรวจว่าลงจริง:
```bash
node -e "
const D = require('better-sqlite3');
const db = new D('dev.db', { readonly: true });
console.log(db.prepare(\"SELECT label, kind, isActive, length(content) len FROM CorePrompt WHERE kind='caption'\").all());
db.close();"
```
คาดหวัง: 1 แถว `label: 'SEO v1'`, `isActive: 1`, `len` หลายพันตัวอักษร

- [ ] **Step 5: build + lint**

```bash
npm run build && npm run lint
```
คาดหวัง: สะอาด

- [ ] **Step 6: commit**

```bash
git add prisma/schema.prisma prisma/migrations prisma/seed
git commit -m "Store caption output and a second kind of prompt"
```

---

### Task 3: สร้าง Caption ด้วย Gemini

**Files:**
- Create: `lib/caption.ts`
- Modify: `lib/gemini.ts`
- Modify: `app/actions.ts`

**Interfaces:**
- Consumes: `CorePrompt` ที่ `kind = "caption"` + `isActive` (Task 2), `generateTenPartPrompt` เดิม
- Produces:
  - `lib/caption.ts` → `parseCaptionOutput(raw: string): { caption: string; hashtags: string }`
  - `lib/gemini.ts` → `CAPTION_MODEL` และ `generateCaptionAndHashtags(args: { systemInstruction: string; tenPartPrompt: string }): Promise<string>` (คืนข้อความดิบ)
  - `app/actions.ts` → `generateWithAI(entryId: string, model: string): Promise<{ captionError: string | null }>` (เดิม return `void`)

- [ ] **Step 1: ตัวแยกข้อความ**

สร้าง `lib/caption.ts`:

```ts
/**
 * แยกคำตอบของโมเดลเป็น caption กับ hashtags
 *
 * ถ้าโมเดลตอบผิดฟอร์แมตจนแยกไม่ได้ ให้คืนข้อความทั้งก้อนเป็น caption แทนการ throw —
 * ผู้ใช้ตัดแปะเองได้ ดีกว่าเสียผลลัพธ์ที่จ่ายโควตาไปแล้วทิ้งทั้งหมด
 */
export function parseCaptionOutput(raw: string): {
  caption: string;
  hashtags: string;
} {
  const text = raw.replace(/\*\*/g, "").trim();
  const match = text.match(/Caption:\s*([\s\S]*?)\n\s*Hashtags:\s*([\s\S]*)/i);

  if (!match) {
    return { caption: text, hashtags: "" };
  }

  return {
    caption: match[1].trim(),
    hashtags: match[2].trim().replace(/\s+/g, " "),
  };
}
```

- [ ] **Step 2: เรียก Gemini**

ใน `lib/gemini.ts` เพิ่มท้ายไฟล์ (ห้ามแตะ `generateTenPartPrompt` เดิม):

```ts
/**
 * Caption ถูกล็อกไว้ที่โมเดลเร็วเสมอ ไม่ตามที่ผู้ใช้เลือกใน dropdown:
 * โควตา free tier แยกคนละ pool และ gemini-3.5-flash มีแค่ 20 ครั้ง/วัน — การจ่าย
 * โควตานั้นไปกับงานเขียนข้อความล้วนจะเหลือคลิปทำได้แค่ครึ่งเดียวโดยไม่ได้อะไรกลับมา
 */
export const CAPTION_MODEL: GeminiModelId = "gemini-3.1-flash-lite";

export async function generateCaptionAndHashtags(args: {
  systemInstruction: string;
  tenPartPrompt: string;
}): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("ยังไม่ได้ตั้งค่า GEMINI_API_KEY ในไฟล์ .env");
  }

  const client = new GoogleGenAI({ apiKey });

  const response = await client.interactions.create({
    model: CAPTION_MODEL,
    // snake_case — camelCase จะถูก API เมินแบบเงียบๆ แล้ว SEO prompt จะไม่ไปถึงโมเดลเลย
    system_instruction: args.systemInstruction,
    generation_config: { temperature: 0.3 },
    input: [
      {
        type: "text",
        text: `### Video Prompt\n${args.tenPartPrompt}\n\n### Output Mode\nready_to_post`,
      },
    ],
  });

  const text = response.output_text;
  if (!text || text.trim() === "") {
    throw new Error("AI ไม่ได้ตอบกลับตอนสร้าง Caption");
  }
  return text;
}
```

**ไม่ส่งรูปใน stage นี้** — SEO prompt ใช้แค่ข้อความจาก 10-part prompt

- [ ] **Step 3: ต่อเข้า Server Action**

ใน `app/actions.ts` แก้ import ให้ดึงของใหม่มาด้วย:

```ts
import {
  generateTenPartPrompt,
  generateCaptionAndHashtags,
  isGeminiModelId,
} from "@/lib/gemini";
import { parseCaptionOutput } from "@/lib/caption";
```

แล้วแก้ท้ายฟังก์ชัน `generateWithAI` — จากเดิมที่จบด้วย

```ts
  await prisma.promptEntry.update({
    where: { id: entryId },
    data: { chatgptOutput: output },
  });

  revalidatePath("/");
}
```

เปลี่ยนเป็น:

```ts
  // บันทึกผลของ stage 1 ให้เสร็จก่อนเสมอ — ถ้า stage 2 พัง 10-part prompt ต้องไม่หายไปด้วย
  await prisma.promptEntry.update({
    where: { id: entryId },
    data: { chatgptOutput: output },
  });

  let captionError: string | null = null;

  const seoPrompt = await prisma.corePrompt.findFirst({
    where: { isActive: true, kind: "caption" },
  });

  if (!seoPrompt) {
    captionError = "ยังไม่ได้ตั้ง SEO Prompt ที่ใช้งานอยู่";
  } else {
    try {
      const parsed = parseCaptionOutput(
        await generateCaptionAndHashtags({
          systemInstruction: seoPrompt.content,
          tenPartPrompt: output,
        })
      );
      await prisma.promptEntry.update({
        where: { id: entryId },
        data: { caption: parsed.caption, hashtags: parsed.hashtags },
      });
    } catch (e) {
      captionError = e instanceof Error ? e.message : "สร้าง Caption ไม่สำเร็จ";
    }
  }

  revalidatePath("/");
  return { captionError };
}
```

**ห้าม throw เมื่อ caption พัง** — ถ้า throw ก่อน `revalidatePath` หน้าเว็บจะไม่เห็น 10-part prompt ที่บันทึกไปแล้วจนกว่าจะ refresh เอง

- [ ] **Step 4: ให้ `updateProduction` บันทึก caption/hashtags ด้วย**

ใน `app/actions.ts` ฟังก์ชัน `updateProduction` เพิ่มการอ่านค่า 2 ตัวนี้จาก formData (วางถัดจากบรรทัด `const chatgptOutput = ...`):

```ts
  const caption = String(formData.get("caption") ?? "").trim();
  const hashtags = String(formData.get("hashtags") ?? "").trim();
```

แล้วเพิ่มลงใน `data` ของ `prisma.promptEntry.update`:

```ts
    data: {
      chatgptOutput,
      caption,
      hashtags,
      videoUrl,
      postedAt: parsedPostedAt,
    },
```

- [ ] **Step 5: ให้ `createCorePrompt` / `setActiveCorePrompt` รู้จัก kind**

ยังอยู่ใน `app/actions.ts` — แทนที่ 2 ฟังก์ชันนี้ทั้งตัว:

```ts
const PROMPT_KINDS = ["core", "caption"] as const;
type PromptKind = (typeof PROMPT_KINDS)[number];

function isPromptKind(value: string): value is PromptKind {
  return PROMPT_KINDS.includes(value as PromptKind);
}

export async function createCorePrompt(formData: FormData) {
  const label = String(formData.get("label") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();
  const kind = String(formData.get("kind") ?? "core");

  // kind มาจาก client — เชื่อไม่ได้
  if (!isPromptKind(kind)) {
    throw new Error("ชนิด prompt ไม่ถูกต้อง");
  }
  if (!label || !content) {
    throw new Error("กรุณากรอกชื่อเวอร์ชันและเนื้อหา prompt");
  }

  await prisma.$transaction([
    // ปิด active เฉพาะ kind เดียวกัน — ห้ามไปปิดของอีกชนิด
    prisma.corePrompt.updateMany({
      where: { isActive: true, kind },
      data: { isActive: false },
    }),
    prisma.corePrompt.create({
      data: { label, content, kind, isActive: true },
    }),
  ]);

  revalidatePath("/");
}

export async function setActiveCorePrompt(id: string) {
  const target = await prisma.corePrompt.findUnique({ where: { id } });
  if (!target) {
    throw new Error("ไม่พบเวอร์ชันที่ต้องการใช้");
  }

  await prisma.$transaction([
    prisma.corePrompt.updateMany({
      where: { isActive: true, kind: target.kind },
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

- [ ] **Step 6: build + lint**

```bash
npm run build && npm run lint
```
คาดหวัง: สะอาด (จะยังไม่มี UI ใช้ค่าที่ return มา — ปกติ)

- [ ] **Step 7: commit**

```bash
git add lib/caption.ts lib/gemini.ts app/actions.ts
git commit -m "Generate the caption and hashtags after the video prompt"
```

---

### Task 4: UI — ช่อง Caption/Hashtags + ปุ่มคัดลอกทั้งหมด + แท็บ ③ สองกล่อง

**Files:**
- Modify: `components/prompt-workspace.tsx`
- Modify: `components/production-panel.tsx`
- Modify: `components/core-prompt-panel.tsx`

**Interfaces:**
- Consumes: `generateWithAI` ที่ตอนนี้ return `{ captionError }` (Task 3), `PromptEntry.caption` / `.hashtags`, `CorePromptRecord.kind`
- Produces:
  - `CorePromptPanel` รับ props `{ corePrompts, kind, title }` ใช้ซ้ำได้ทั้ง core และ caption
  - ผู้ใช้เห็นและแก้ caption/hashtags ได้ในแท็บ ② และคัดลอกทั้งก้อนได้ด้วยปุ่มเดียว

- [ ] **Step 1: เพิ่มฟิลด์ใน type**

ใน `components/prompt-workspace.tsx` เพิ่ม 2 บรรทัดใน type `PromptEntry` (ฟิลด์เดิมห้ามแตะ):

```tsx
  caption: string;
  hashtags: string;
```

และเพิ่ม 1 บรรทัดใน type `CorePromptRecord`:

```tsx
  kind: string;
```

- [ ] **Step 2: รับ captionError**

ยังอยู่ใน `components/prompt-workspace.tsx` — แก้ `handleGenerate` (ของเดิมทิ้งค่าที่ return มา):

```tsx
  function handleGenerate() {
    if (!selectedEntry) return;
    setGenError(null);
    startGenerating(async () => {
      try {
        const result = await generateWithAI(selectedEntry.id, model);
        // 10-part prompt บันทึกแล้วแน่นอน แม้ caption จะพัง — ไปแท็บผลลัพธ์เสมอ
        setTab("production");
        if (result.captionError) {
          setGenError(`สร้าง 10-part prompt สำเร็จ แต่ Caption ไม่สำเร็จ: ${result.captionError}`);
        }
      } catch (e) {
        setGenError(e instanceof Error ? e.message : "สร้างด้วย AI ไม่สำเร็จ");
      }
    });
  }
```

**หมายเหตุ:** `genError` ถูกแสดงในแท็บ Brief ซึ่งตอนนี้เราสลับไปแท็บ production แล้ว — ให้ย้ายบล็อกแสดง `genError` ออกจาก brief tab มาไว้ที่ระดับบนของ workspace (ใต้ `<ClapperHeader>` ก่อน `<div className="flex flex-1 ...">`) เพื่อให้เห็นได้ทุกแท็บ:

```tsx
      {genError && (
        <p className="mx-4 mt-3 rounded-md border border-record/40 bg-record/10 px-3 py-2 text-sm text-record sm:mx-6">
          {genError}
        </p>
      )}
```

(ลบบล็อก `{genError && ...}` เดิมที่อยู่ในแท็บ brief ออก)

- [ ] **Step 3: แยก corePrompts ตาม kind แล้วส่งให้ 2 กล่อง**

ยังอยู่ใน `components/prompt-workspace.tsx` — แทนที่บล็อกแท็บ core:

```tsx
        {tab === "core" && (
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
        )}
```

- [ ] **Step 4: ทำให้ CorePromptPanel ใช้ซ้ำได้**

ใน `components/core-prompt-panel.tsx`:

เปลี่ยน signature:

```tsx
export function CorePromptPanel({
  corePrompts,
  kind,
  title,
}: {
  corePrompts: CorePromptRecord[];
  kind: string;
  title: string;
}) {
```

เปลี่ยนหัวข้อของกล่องซ้าย จาก `Core Prompt · เวอร์ชัน` เป็น `{title}`:

```tsx
          <h2 className="font-mono text-xs tracking-widest text-rust uppercase">
            {title}
          </h2>
```

และเพิ่ม hidden input ใน `<form action={addAction}>` เพื่อบอก Server Action ว่าเป็น prompt ชนิดไหน (ใส่เป็นลูกตัวแรกของ form):

```tsx
          <input type="hidden" name="kind" value={kind} />
```

- [ ] **Step 5: ช่อง Caption/Hashtags ในแท็บผลลัพธ์**

ใน `components/production-panel.tsx`:

เพิ่ม import ไอคอน:

```tsx
import { Check, Copy, ExternalLink } from "lucide-react";
```

เพิ่ม state (วางถัดจาก `const [postedAt, setPostedAt] = useState(...)`):

```tsx
  const [caption, setCaption] = useState(entry.caption);
  const [hashtags, setHashtags] = useState(entry.hashtags);
  const [copied, setCopied] = useState(false);
```

ขยาย block sync ค่าจากเซิร์ฟเวอร์ที่มีอยู่แล้ว (ที่ตอนนี้ดูแค่ `chatgptOutput`) ให้ครอบคลุม caption/hashtags ด้วย — "สร้างด้วย AI" เขียนทับทั้งสามค่าโดย id ไม่เปลี่ยน React จึงไม่ remount ให้เอง:

```tsx
  const [lastServer, setLastServer] = useState({
    chatgptOutput: entry.chatgptOutput,
    caption: entry.caption,
    hashtags: entry.hashtags,
  });
  if (
    entry.chatgptOutput !== lastServer.chatgptOutput ||
    entry.caption !== lastServer.caption ||
    entry.hashtags !== lastServer.hashtags
  ) {
    setLastServer({
      chatgptOutput: entry.chatgptOutput,
      caption: entry.caption,
      hashtags: entry.hashtags,
    });
    setChatgptOutput(entry.chatgptOutput);
    setCaption(entry.caption);
    setHashtags(entry.hashtags);
  }
```

(ลบ `lastServerOutput` state เดิมกับ if-block ของมันออก แล้วใช้ตัวนี้แทน)

เพิ่มฟังก์ชันคัดลอก:

```tsx
  async function copyForPost() {
    // ผู้ใช้โพสต์แบบ caption แล้วขึ้นบรรทัดใหม่ตบด้วย hashtag — คัดลอกให้ตรงแบบนั้นเลย
    await navigator.clipboard.writeText(`${caption}\n${hashtags}`.trim());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
```

แล้วเพิ่ม JSX ใต้ `<div>` ของช่อง 10-part prompt (ก่อน `<div className="grid gap-5 sm:grid-cols-2">`):

```tsx
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-3">
            <label className="text-sm font-medium text-foreground/90">
              Caption &amp; Hashtags
            </label>
            <Button
              type="button"
              size="sm"
              onClick={copyForPost}
              disabled={!caption && !hashtags}
              className="bg-marigold text-ink hover:bg-marigold/90"
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? "คัดลอกแล้ว" : "คัดลอกทั้งหมด"}
            </Button>
          </div>
          <Textarea
            name="caption"
            rows={3}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Caption จะถูกสร้างอัตโนมัติหลังกด สร้างด้วย AI"
            className="font-sans text-sm leading-[1.6em]"
          />
          <Input
            name="hashtags"
            value={hashtags}
            onChange={(e) => setHashtags(e.target.value)}
            placeholder="#แฮชแท็ก จะถูกสร้างอัตโนมัติ"
            className="font-mono text-xs"
          />
        </div>
```

ทั้งสองช่องอยู่ใน `<form action={action}>` เดิม จึงถูกบันทึกด้วยปุ่ม "บันทึกผลลัพธ์" ที่มีอยู่แล้ว

- [ ] **Step 6: build + lint**

```bash
npm run build && npm run lint
```
คาดหวัง: สะอาด

- [ ] **Step 7: ขับจริงในเบราว์เซอร์**

เคลียร์ port 3000 ก่อน แล้วสตาร์ท dev server:
```bash
netstat -ano | grep ':3000' | grep LISTENING   # ถ้ามี PID: taskkill //PID <pid> //F
npm run dev &
timeout 60 bash -c 'until curl -sf http://localhost:3000 >/dev/null; do sleep 1; done' && echo UP
```

ติดตั้ง Playwright ใน scratchpad (ไม่ใช่ในโปรเจกต์) แล้วเขียน `$SCRATCH/caption-ui.js` ให้ครอบคลุม:

1. สร้าง entry ชื่อ `ทดสอบแคปชัน` + วางรูปสินค้าจริง (Ctrl+V ผ่าน `ClipboardEvent` ที่มี `File`) — ดูวิธีจาก `$SCRATCH/paste.js` เดิมของ session ก่อนได้ ถ้าไม่มีให้เขียนใหม่
2. กด **สร้างด้วย AI** → รอ `textarea[name="chatgptOutput"]`
3. ตรวจว่า `textarea[name="caption"]` และ `input[name="hashtags"]` **มีค่าจริง ไม่ว่าง**
4. กด **คัดลอกทั้งหมด** → อ่าน clipboard (ให้ permission `clipboard-read`) → ต้องเท่ากับ `caption + "\n" + hashtags`
5. แก้ caption ด้วยมือ → กด **บันทึกผลลัพธ์** → reload → เลือก entry เดิม → ค่าที่แก้ต้องยังอยู่
6. ไปแท็บ **Core Prompt** → ต้องเห็น **2 กล่อง** และเวอร์ชันไม่ปนกัน (กล่อง SEO เห็นแค่ `SEO v1`)
7. ไม่มี console error

รายงานผลจริงเป็นตัวเลข/ข้อความ ห้ามสรุปว่า "น่าจะผ่าน"

- [ ] **Step 8: ทดสอบเส้นทางที่ caption ล้มเหลว**

พิสูจน์ว่า 10-part prompt ไม่หายเมื่อ stage 2 พัง — ปิด SEO prompt ชั่วคราวแล้วกดสร้างใหม่:

```bash
npx prisma db execute --stdin <<< "UPDATE CorePrompt SET isActive = 0 WHERE kind = 'caption';"
```

กด "สร้างด้วย AI" อีกครั้งบน entry ทดสอบ → ต้องได้ 10-part prompt ครบ + ขึ้นข้อความเตือนสีแดงว่า Caption ไม่สำเร็จ (ไม่ crash ไม่หน้าขาว)

แล้วเปิดกลับ:
```bash
npx prisma db execute --stdin <<< "UPDATE CorePrompt SET isActive = 1 WHERE kind = 'caption' AND label = 'SEO v1';"
```

- [ ] **Step 9: ล้างข้อมูลทดสอบ (เจาะจงเท่านั้น)**

```bash
npx prisma db execute --stdin <<< "DELETE FROM PromptEntry WHERE productName = 'ทดสอบแคปชัน';"
rm -rf uploads/*
```

ยืนยันข้อมูลจริงอยู่ครบ:
```bash
node -e "
const D = require('better-sqlite3');
const db = new D('dev.db', { readonly: true });
console.log('entries:', db.prepare('SELECT COUNT(*) c FROM PromptEntry').get().c);
console.log('caption prompts:', db.prepare(\"SELECT COUNT(*) c FROM CorePrompt WHERE kind='caption' AND isActive=1\").get().c);
db.close();"
```
คาดหวัง: `entries: 17` และ `caption prompts: 1`

ปิด dev server: `netstat -ano | grep ':3000' | grep LISTENING` แล้ว `taskkill //PID <pid> //F`

- [ ] **Step 10: commit**

```bash
git add components/prompt-workspace.tsx components/production-panel.tsx components/core-prompt-panel.tsx
git commit -m "Show and copy the generated caption and hashtags"
```

---

### Task 5: บันทึกลง CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: อัปเดตหัวข้อ Database**

เพิ่มบรรทัดต่อจากบรรทัดที่พูดถึง `CorePrompt`:

```
- `CorePrompt` แยกชนิดด้วยคอลัมน์ `kind` — `core` (สร้างวิดีโอ) กับ `caption` (SEO prompt) **active ได้ทีละอันต่อ kind** ห้ามลืมใส่ `kind` ใน `where` ของ transaction ไม่งั้นการเพิ่มเวอร์ชันฝั่งหนึ่งจะไปปิด active ของอีกฝั่ง เนื้อหาตั้งต้นของ SEO prompt อยู่ที่ `prisma/seed/seo-prompt-v1.md` seed ด้วย `node prisma/seed/seed-seo-prompt.mjs` (idempotent)
```

- [ ] **Step 2: อัปเดตหัวข้อ Gemini API**

เพิ่มบรรทัด:

```
- ปุ่ม "สร้างด้วย AI" ทำงาน 2 ขั้นใน action เดียว: (1) รูป+บรีฟ+Core Prompt → 10-part prompt ด้วยโมเดลที่ผู้ใช้เลือก (2) 10-part prompt (ข้อความล้วน ไม่ส่งรูป) + SEO Prompt → Caption/Hashtags ด้วย `CAPTION_MODEL` = `gemini-3.1-flash-lite` **เสมอ** (โควตาแยก pool และ 3.5-flash มีแค่ 20 ครั้ง/วัน)
- **ขั้น 1 ต้องบันทึกลง DB ก่อนขั้น 2 เสมอ และขั้น 2 ห้าม throw** — `generateWithAI` คืน `{ captionError }` แทน ถ้า throw ก่อน `revalidatePath` หน้าเว็บจะไม่เห็น 10-part prompt ที่บันทึกไปแล้ว
- `lib/caption.ts` แยกคำตอบเป็น caption/hashtags ถ้าโมเดลตอบผิดฟอร์แมตจะยัดทั้งก้อนลง caption ไม่ทิ้งของ
```

- [ ] **Step 3: อัปเดตหัวข้อ Architecture**

แก้บรรทัดที่อธิบายแท็บ ② และ ③ ให้ตรงกับของจริง: แท็บ ② มีช่อง Caption/Hashtags + ปุ่มคัดลอกทั้งหมด · แท็บ ③ มี 2 กล่อง (`core-prompt-panel.tsx` ตัวเดียวกัน ส่ง `kind` ต่างกัน)

- [ ] **Step 4: build + lint แล้ว commit**

```bash
npm run build && npm run lint
git add CLAUDE.md
git commit -m "Document the caption generation stage"
```

---

## Verification (ทั้งฟีเจอร์)

- `npm run build` + `npm run lint` สะอาด
- กด "สร้างด้วย AI" ครั้งเดียว → ได้ครบ 3 อย่าง (10-part prompt, Caption, Hashtags) → refresh แล้วยังอยู่
- ปุ่ม "คัดลอกทั้งหมด" ได้ `caption + "\n" + hashtags`
- แก้ caption ด้วยมือ → บันทึกผลลัพธ์ → refresh แล้วค่าที่แก้ยังอยู่
- **stage 2 ล้มเหลว → 10-part prompt ยังอยู่ครบ** + ขึ้นข้อความเตือน ไม่ crash
- แท็บ ③ จัดการเวอร์ชัน 2 ชนิดแยกกัน ไม่ปนกัน
- regression: เส้นทาง manual เดิม (คัดลอก meta-prompt ไปวางแชทเอง แล้ว paste กลับ) ยังใช้ได้
- ข้อมูลจริง 17 entries + Core Prompt v4 ยังอยู่ครบ

## Git

ทำบน branch ใหม่จาก `master`: `feature/caption-hashtag`
