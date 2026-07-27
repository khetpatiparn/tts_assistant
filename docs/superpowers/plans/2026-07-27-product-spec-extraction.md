# Product Spec Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** แยกงาน "มองรูปแล้วถอดสเปกสินค้า" ออกมาเป็นการเรียก AI ของตัวเอง แล้วป้อนสเปกนั้นเป็นข้อความให้ขั้นเจน 10 ส่วน เพื่อไม่ให้รายละเอียดพื้นผิว/กลไกหายระหว่างทาง

**Architecture:** เพิ่มคอลัมน์ `productSpec` บน `PromptEntry` และฟังก์ชัน `extractProductSpec` ใน `lib/gemini.ts` (ไฟล์เดียวที่รู้จัก SDK เหมือนเดิม) · `generateWithAI` สกัดสเปกก่อนถ้ายังไม่มี แล้วส่งเข้า `buildPromptText` · UI เป็นคอมโพเนนต์แยก `components/product-spec-panel.tsx` ที่แก้สเปกได้และบันทึกผ่าน server action ของตัวเอง · กฎที่ต้องปรับจูนบ่อยไปอยู่ใน Core Prompt v8 (ฐานข้อมูล แก้ในแอปได้) ส่วนโค้ดแก้เฉพาะสิ่งที่ต้องลบ

**Tech Stack:** Next.js 16.2.10 (custom build) · Prisma 7 + SQLite (`@prisma/adapter-better-sqlite3`) · `@google/genai` · React 19 Server Actions · Tailwind v4 CSS-first · lucide-react v1.23.0

**Spec:** `docs/superpowers/specs/2026-07-27-product-spec-extraction-design.md`

## Global Constraints

- **ห้ามรัน `npm run build` หรือ `npm run dev` บนพอร์ต 3000** — ผู้ใช้รัน `start.bat` อยู่และใช้แอปทำงานหาเงินจริงทุกวัน ใช้ `npx tsc --noEmit` แทน build · ถ้าต้องรันแอปให้ใช้ isolated dev server เท่านั้น: `cp dev.db dev-test.db` แล้ว `NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001` แล้ว cleanup ด้วย `rm -rf .next-dev dev-test.db`
- **ห้ามแตะ `dev.db` ตัวจริงในการทดสอบที่มีการเขียน** — อ่านแบบ `readonly: true` ได้ · ห้าม `DELETE FROM` แบบไม่มี `WHERE`
- **สคริปต์ตรวจ/ทดสอบต้องเขียนเป็นไฟล์ `.js` จริงด้วย Write tool ในโฟลเดอร์ scratch** (ห้าม `node -e "..."` ผ่าน bash — git-bash แปลง path จนพัง) และ `require()` ด้วย absolute path เข้า `node_modules` ของ repo
- **ไม่มี test runner และไม่มี `tsx` ในโปรเจกต์ ห้ามติดตั้งเพิ่ม** — ทดสอบ pure function ด้วยการคอมไพล์ไฟล์เดียวไป scratch แล้วรันด้วย node: `npx tsc <file> --outDir "<scratch>/build" --module commonjs --target ES2017 --skipLibCheck`
- **Gemini API ใช้ snake_case**: `system_instruction` และ `generation_config` — สะกดเป็น camelCase แล้ว API **เงียบ ไม่ error** แต่คำสั่งจะไม่ถึงโมเดลเลย · ห้ามกลบ type error ด้วย `as any` · โมเดลต้องเป็นค่าใน `GEMINI_MODELS` เท่านั้นและต้อง validate ด้วย `isGeminiModelId` ก่อนส่งให้ API เสมอ (ค่ามาจาก client เชื่อไม่ได้)
- **Prisma 7**: หลังแก้ `prisma/schema.prisma` ต้อง `npx prisma migrate dev --name <name>` แล้วตามด้วย `npx prisma generate`
- **ห้าม emoji** ทุกที่ · ข้อความ UI เป็นภาษาไทย
- **ใช้ design token เดิมเท่านั้น**: `ink` `paper` `marigold` `rust` `smoke` `record` `border` `card` `muted-foreground` `foreground` `primary-foreground` `background` — ห้ามเพิ่มสีใหม่
- **ไอคอน lucide ต้องชื่อ canonical** — ตรวจแล้ว: `PackageSearch` เป็นชื่อจริงใน `node_modules/lucide-react/dist/esm/icons/package-search.mjs` (ห้ามเปลี่ยนไปใช้ชื่ออื่นโดยไม่เปิดไฟล์ `.mjs` เช็ก)
- **`git diff tsconfig.json` ต้องว่างก่อน commit ทุกครั้ง** (dev server แก้ไฟล์นี้เองได้ — repo pin `target: "ES2017"` ไว้ตั้งใจ) ถ้าไม่ว่างให้ `git checkout -- tsconfig.json`
- **ห้าม `git add -A`** — ระบุไฟล์ที่แก้เสมอ
- ทำงานบน branch `feature/product-spec-extraction` (สร้างแล้ว spec commit อยู่บนนั้น)
- **ห้ามแตะ `lib/recommender.ts` · `lib/angle.ts` · `lib/weekly-scoreboard.ts` · `lib/golden-examples.ts`** และห้ามแก้ตรรกะการนำเข้าไฟล์ใน `app/actions.ts`

---

### Task 1: คอลัมน์ `productSpec` + ฟังก์ชันเรียก Gemini

**Files:**
- Modify: `prisma/schema.prisma` (model `PromptEntry`)
- Modify: `lib/gemini.ts` (เพิ่มท้ายไฟล์)

**Interfaces:**
- Consumes: `GeminiImage`, `GeminiModelId` ที่มีอยู่แล้วใน `lib/gemini.ts`
- Produces (Task 2 ใช้ต่อ): `async function extractProductSpec(args: { model: GeminiModelId; productName: string; productInfo: string; images: GeminiImage[] }): Promise<string>`

**บริบทที่ต้องรู้:** `lib/gemini.ts` มีฟังก์ชันพี่น้องอยู่แล้ว 4 ตัว (`generateTenPartPrompt`, `generateCaptionAndHashtags`, `extractProductFields`, `suggestAngleOptions`) — ทุกตัวใช้แพตเทิร์นเดียวกัน: เช็ก `GEMINI_API_KEY` → สร้าง client → เรียกด้วย snake_case → เช็กคำตอบว่าง **ให้เดินตามแพตเทิร์นนั้นเป๊ะ อ่านของจริงในไฟล์ก่อนเขียน**

- [ ] **Step 1: เพิ่มคอลัมน์ใน schema**

ใน `prisma/schema.prisma` model `PromptEntry` เพิ่มบรรทัดนี้ต่อจาก `angle       String   @default("")`:

```prisma
  productSpec String   @default("")
```

- [ ] **Step 2: รัน migration + generate**

Run: `npx prisma migrate dev --name add_product_spec_to_prompt_entry`
Expected: migration ใหม่ถูกสร้างและ apply สำเร็จ

Run: `npx prisma generate`
Expected: สำเร็จ ไม่มี error

- [ ] **Step 3: เขียน `extractProductSpec` ใน `lib/gemini.ts`**

วางต่อท้ายไฟล์:

```ts
/**
 * สกัดสเปกสินค้าจากรูป — เป็นขั้นแยกต่างหากก่อนเจน 10 ส่วน
 *
 * เหตุผลที่ต้องแยก: เดิมโมเดลต้องมองรูป + ถอดสเปก + แต่งฉาก/กล้อง/บทพูด + คุมฟอร์แมต
 * 10 ส่วนพร้อมกันในการเรียกครั้งเดียว งานที่โดนเบียดคือการถอดสเปก — วัดจากพรอมต์ 10 คลิป
 * ล่าสุดพบว่าใช้บรรยายตัวสินค้าแค่ 20.7% ที่เหลือเป็น style/scene/camera ที่แทบเหมือนกัน
 * ทุกสินค้า ผลคือพื้นผิวแผ่นชั้น (ชั้นวาง) และกลไกฝา (กล่องขนม) ไม่เคยถูกเขียนลงพรอมต์เลย
 * แล้ว Flow เดาเอาเองจนเพี้ยน
 *
 * ไม่ล็อกโมเดลไว้ที่ flash-lite ต่างจาก CAPTION_MODEL/EXTRACT_MODEL/ANGLE_MODEL เพราะนี่เป็น
 * งาน "มองรูป" ไม่ใช่งานข้อความล้วน — ตรงกับแบบแผนเดิมที่งาน vision ให้ผู้ใช้เลือกโมเดลเอง
 * และเพราะสกัดครั้งเดียวต่อสินค้าแล้วใช้ซ้ำ การใช้โมเดลละเอียด (20/วัน) จึงไม่เปลืองโควตา
 */
const PRODUCT_SPEC_INSTRUCTION = `คุณคือผู้ช่วยถอดสเปกสินค้าจากรูปถ่ายจริง เพื่อส่งต่อให้ AI สร้างวิดีโอ

อ่านรูปทุกใบที่แนบมาอย่างละเอียด แล้วตอบกลับตามหัวข้อนี้เท่านั้น:

รูปทรงและสัดส่วน:
วัสดุและพื้นผิว (แยกทีละส่วน ระบุให้ชัดว่าทึบหรือมีรู):
ชิ้นส่วนและกลไก (เปิด/ปิด/พับ/หมุน/ถอด — อธิบายว่าทำงานอย่างไร):
สี:
ฉลาก/โลโก้/ข้อความบนตัวสินค้า (ตำแหน่ง สี ขนาด ข้อความที่อ่านได้):
จุดที่ AI มักทำเพี้ยนกับสินค้าแบบนี้:

กติกา:
- บรรยายเฉพาะสิ่งที่เห็นในรูปจริง ห้ามเดาสิ่งที่มองไม่เห็น
- ถ้าข้อมูลสินค้าจากร้านขัดกับสิ่งที่เห็นในรูป ให้ยึดรูปและทิ้งคำนั้นไป (ข้อมูลร้านมักแปลด้วยเครื่องจากภาษาจีนและผิดจากของจริง)
- ห้ามใช้คำนามหรือคำขยายที่กำกวม เช่น "กระปุก" (ให้ระบุว่ากล่อง/โหล/ถัง ตามทรงที่เห็น) หรือ "โปร่ง" (ให้ระบุว่าทึบ หรือ มีรู/ตะแกรง)
- หัวข้อ "วัสดุและพื้นผิว" กับ "ชิ้นส่วนและกลไก" ห้ามข้ามเด็ดขาด แม้สินค้าจะดูเรียบง่าย
- เขียนเป็นภาษาไทย กระชับแต่ครบ ไม่ต้องมีคำนำหรือบทสรุป`;

export async function extractProductSpec(args: {
  model: GeminiModelId;
  productName: string;
  productInfo: string;
  images: GeminiImage[];
}): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("ยังไม่ได้ตั้งค่า GEMINI_API_KEY ในไฟล์ .env");
  }

  const client = new GoogleGenAI({ apiKey });

  const input: object[] = [];
  input.push({
    type: "text",
    text:
      `### ชื่อสินค้า\n${args.productName}\n\n` +
      `### ข้อมูลสินค้าจากร้าน (ใช้ประกอบ แต่ยึดรูปเป็นหลัก)\n${args.productInfo}`,
  });
  // แนบ caption นำหน้ารูปของตัวเองทีละคู่ เหมือน generateTenPartPrompt — กันโมเดลเดาด้านผิด
  for (const [index, image] of args.images.entries()) {
    input.push({
      type: "text",
      text: `รูปที่ ${index + 1}${image.caption ? ` — ${image.caption}` : ""}`,
    });
    input.push({ type: "image", data: image.base64, mime_type: image.mimeType });
  }

  const response = await client.interactions.create({
    model: args.model,
    // snake_case — camelCase จะถูก API เมินแบบเงียบๆ (ดูคอมเมนต์ใน generateTenPartPrompt)
    system_instruction: PRODUCT_SPEC_INSTRUCTION,
    // ต่ำกว่างานเจนพรอมต์เพราะเป็นงานสังเกตและบันทึก ไม่ใช่งานสร้างสรรค์
    generation_config: { temperature: 0.2 },
    input,
  });

  const text = response.output_text;
  if (!text || text.trim() === "") {
    throw new Error("AI ไม่ได้ตอบกลับตอนสกัดสเปกสินค้า ลองใหม่อีกครั้ง");
  }
  return text;
}
```

- [ ] **Step 4: ตรวจ type และ lint**

Run: `npx tsc --noEmit`
Expected: ไม่มี error

Run: `npm run lint`
Expected: ไม่มี error (ถ้า error ชี้ไปที่ไฟล์ใน `.next-dev` ให้ `rm -rf .next-dev` แล้วรันใหม่)

- [ ] **Step 5: ทดสอบเรียก Gemini จริงกับรูปสินค้าที่รู้คำตอบอยู่แล้ว**

เขียนไฟล์ `<scratch>/try-spec.js` ด้วย Write tool (แทน `<REPO>` ด้วย `C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt`):

```js
require("<REPO>/node_modules/dotenv/config");
const fs = require("fs");
const path = require("path");
const Database = require("<REPO>/node_modules/better-sqlite3");
const { extractProductSpec } = require("<scratch>/build-gem/gemini.js");

const db = new Database("<REPO>/dev.db", { readonly: true });

(async () => {
  for (const name of ["ขนมอกไก่ฟรีซดราย", "ชั้นวางของเหล็กอเนกประสงค์"]) {
    const e = db.prepare(`SELECT id, productName, productInfo FROM PromptEntry WHERE productName = ?`).get(name);
    if (!e) { console.log(`ข้าม ${name} (ไม่พบ)`); continue; }
    const rows = db.prepare(`SELECT filename, caption, mimeType FROM ProductImage WHERE entryId = ? ORDER BY sortOrder`).all(e.id);
    const images = rows.map((r) => ({
      base64: fs.readFileSync(path.join("<REPO>/uploads", e.id, r.filename)).toString("base64"),
      mimeType: r.mimeType,
      caption: r.caption,
    }));
    console.log("=".repeat(70));
    console.log(`${name} (รูป ${images.length} ใบ)`);
    const spec = await extractProductSpec({
      model: "gemini-3.1-flash-lite",
      productName: e.productName,
      productInfo: e.productInfo,
      images,
    });
    console.log(spec);
  }
})();
```

Run: `npx tsc lib/gemini.ts --outDir "<scratch>/build-gem" --module commonjs --target ES2017 --skipLibCheck --esModuleInterop --moduleResolution node`
Run: `node "<scratch>/try-spec.js"`

Expected — ตรวจด้วยตา 3 ข้อ:
1. **ทั้งสองสินค้าต้องมีครบทั้ง 6 หัวข้อ** โดยเฉพาะ "วัสดุและพื้นผิว" และ "ชิ้นส่วนและกลไก"
2. **ชั้นวาง:** หัวข้อพื้นผิวต้องบอกว่าแผ่นชั้นทึบ/เรียบ (ไม่ใช่ตะแกรง)
3. **กล่องขนม:** หัวข้อกลไกต้องบอกว่าฝาพับ/บานพับ และหัวข้อรูปทรงต้อง**ไม่ใช้คำว่า "กระปุก"**

ถ้าข้อ 2 หรือ 3 ไม่ผ่าน ให้ปรับ `PRODUCT_SPEC_INSTRUCTION` แล้วรันใหม่จนผ่าน **บันทึกผลที่ได้ทั้งหมดลงรายงาน**

**ถ้า Gemini ตอบ error เรื่องโควตา/คีย์** ให้บันทึกไว้ในรายงานและข้าม step นี้ (ไปทดสอบผ่าน UI ใน Task 4 แทน) — ห้ามแก้โค้ดให้กลบ error

- [ ] **Step 6: Commit**

```bash
git diff tsconfig.json   # ต้องว่าง ถ้าไม่ว่างให้ git checkout -- tsconfig.json
git add prisma/schema.prisma prisma/migrations lib/gemini.ts
git commit -m "Extract the product spec in its own call

Measured across the last ten prompts, only 20.7% of each one describes the
product; the rest is style and camera boilerplate that barely varies. Two
packaging failures traced to the same gap — the shelf's surface and the snack
box's lid mechanism were never written down, so the video model guessed.

Unlike the caption and angle helpers this one follows the user's model choice,
because it is a vision task and it runs once per product rather than per
generation.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Server actions + ต่อสายเข้า `generateWithAI`

**Files:**
- Modify: `app/actions.ts` (imports, `duplicatePrompt`, action ใหม่ 2 ตัว, `generateWithAI`)

**Interfaces:**
- Consumes จาก Task 1: `extractProductSpec` จาก `@/lib/gemini`
- Produces (Task 3 ใช้ต่อ):
  - `async function saveProductSpec(entryId: string, spec: string): Promise<void>`
  - `async function refreshProductSpec(entryId: string, model: string): Promise<string>`

**บริบทที่ต้องรู้:**
- `generateWithAI` (`app/actions.ts:~404`) อ่าน entry จาก DB **ไม่ใช่จากฟอร์ม** — สเปกจึงต้องบันทึกลง DB ด้วย action ของตัวเอง ไม่ผ่าน form submit (แบบเดียวกับ `saveAngle` และ `updateProductImageCaption`)
- `buildPromptText` ถูกเรียกที่ `app/actions.ts:434` — Task 3 จะเพิ่มพารามิเตอร์ `productSpec` ให้ ตอนนี้**ยังไม่ต้องแตะบรรทัดนั้น**
- `duplicatePrompt` (`app/actions.ts:~70`) มีคอมเมนต์อธิบายเรื่อง `angle` อยู่แล้ว — ต้องขยายให้ครอบคลุม `productSpec` ที่มีกฎตรงข้ามกัน

- [ ] **Step 1: เพิ่ม `extractProductSpec` เข้า import**

ใน `app/actions.ts` เพิ่ม `extractProductSpec` เข้าไปใน import ที่มีอยู่แล้วจาก `@/lib/gemini`

- [ ] **Step 2: ให้ `duplicatePrompt` ก๊อป `productSpec` และขยายคอมเมนต์**

แทนที่คอมเมนต์เดิมเหนือ `prisma.promptEntry.create` (บล็อกที่ขึ้นต้นด้วย `// ก๊อปเฉพาะฟิลด์ที่ใช้ซ้ำได้`) ด้วย:

```ts
  // ก๊อปเฉพาะฟิลด์ที่ใช้ซ้ำได้ — ปล่อย videoUrl/วันเวลาโพสต์เป็น default เพราะเป็นข้อเท็จจริงรายคลิป
  //
  // สองฟิลด์นี้มีกฎตรงข้ามกัน อย่าสลับ:
  // - `angle` ตั้งใจไม่ก๊อป (ปล่อย default "") — คลิปใหม่ต้องได้ angle ใหม่เสมอ นี่คือหัวใจของ
  //   ฟีเจอร์ angle tracking ถ้าเพิ่ม angle: source.angle กลับเข้ามา จะทำให้ collectUsedAngles
  //   (lib/angle.ts) นับ angle เดิมว่า "ใช้ไปแล้ว" ทันทีทั้งที่คลิปใหม่ยังไม่ได้ถ่ายจริง
  // - `productSpec` ตั้งใจก๊อป — ทำซ้ำคือสินค้าตัวเดิม รูปร่าง/วัสดุ/กลไกไม่เปลี่ยน จึงไม่ควร
  //   จ่ายโควตาสกัดใหม่ ถ้าลบออกจะทำให้ทุกคลิปที่ทำซ้ำต้องเรียก Gemini เพิ่มโดยไม่ได้อะไรกลับมา
```

แล้วเพิ่มบรรทัดนี้เข้าไปใน `data: {...}` ต่อจาก `extraNotes: source.extraNotes,`:

```ts
      productSpec: source.productSpec,
```

- [ ] **Step 3: เพิ่ม server action 2 ตัว**

วางต่อจาก `saveAngle` (ค้นด้วย `grep -n "export async function saveAngle" app/actions.ts`):

```ts
/**
 * บันทึกสเปกสินค้าที่ผู้ใช้แก้เอง — ต้องเป็น action แยกไม่ผ่าน form submit เพราะ generateWithAI
 * อ่านค่าจาก DB ไม่ใช่จากฟอร์ม (ถ้าเก็บใน form state โมเดลจะไม่เห็นสเปกเลย)
 * แนวเดียวกับ saveAngle และ updateProductImageCaption
 */
export async function saveProductSpec(entryId: string, spec: string) {
  await prisma.promptEntry.update({
    where: { id: entryId },
    data: { productSpec: spec.trim() },
  });
  revalidatePath("/");
}

/**
 * สกัดสเปกใหม่ทับของเดิม (ปุ่ม "สกัดสเปกใหม่" — ใช้ตอนเปลี่ยนรูปสินค้า)
 * เขียนทับเมื่อสำเร็จเท่านั้น: ถ้า API ล้ม สเปกเดิมที่ผู้ใช้อาจแก้มือไว้ต้องไม่หาย
 */
export async function refreshProductSpec(entryId: string, model: string): Promise<string> {
  // โมเดลมาจาก client เชื่อไม่ได้ ต้อง validate ก่อนส่งให้ API เสมอ
  if (!isGeminiModelId(model)) {
    throw new Error("โมเดลไม่ถูกต้อง");
  }

  const entry = await prisma.promptEntry.findUnique({
    where: { id: entryId },
    include: { productImages: { orderBy: { sortOrder: "asc" } } },
  });
  if (!entry) {
    throw new Error("ไม่พบรายการที่ต้องการสกัดสเปก");
  }
  if (entry.productImages.length === 0) {
    throw new Error("กรุณาแนบรูปสินค้าจริงอย่างน้อย 1 รูปก่อนสกัดสเปก");
  }

  const spec = await extractProductSpec({
    model,
    productName: entry.productName,
    productInfo: entry.productInfo,
    images: await loadGeminiImages(entry.productImages),
  });

  await prisma.promptEntry.update({
    where: { id: entryId },
    data: { productSpec: spec },
  });
  revalidatePath("/");
  return spec;
}
```

- [ ] **Step 4: แยก helper อ่านรูปเป็นฟังก์ชันร่วม**

ตอนนี้ `generateWithAI` มีโค้ดอ่านไฟล์รูปเป็น base64 อยู่แล้ว (บล็อก `const geminiImages = await Promise.all(...)`) และ `refreshProductSpec` ต้องใช้ตรรกะเดียวกัน — แยกออกมาเป็น helper เพื่อไม่ให้ซ้ำสองที่

วาง helper นี้ไว้เหนือ `generateWithAI` (นอก `export` เพราะใช้ในไฟล์นี้เท่านั้น):

```ts
/** อ่านไฟล์รูปจากดิสก์เป็น base64 ให้พร้อมส่ง Gemini — ใช้ร่วมกันระหว่างสกัดสเปกกับเจน 10 ส่วน */
async function loadGeminiImages(
  images: { entryId: string; filename: string; mimeType: string; caption: string }[]
) {
  return Promise.all(
    images.map(async (image) => ({
      base64: (
        await readFile(path.join(UPLOAD_ROOT, image.entryId, image.filename))
      ).toString("base64"),
      mimeType: image.mimeType,
      caption: image.caption,
    }))
  );
}
```

แล้วแทนที่บล็อก `const geminiImages = await Promise.all(...)` ใน `generateWithAI` ด้วย:

```ts
  const geminiImages = await loadGeminiImages(photos);
```

- [ ] **Step 5: ให้ `generateWithAI` สกัดสเปกก่อนถ้ายังไม่มี**

ใน `generateWithAI` แทรกบล็อกนี้**หลัง**การเช็ก `core` (บรรทัด `throw new Error("ยังไม่ได้ตั้ง Core Prompt ที่ใช้งานอยู่")` ปิดวงเล็บแล้ว) และ**ก่อน** `const photos = entry.productImages;`:

```ts
  // ขั้นที่ 0: สกัดสเปกสินค้าถ้ายังไม่มี แล้วบันทึกไว้ใช้ซ้ำ
  // ห้ามทับของเดิม — ผู้ใช้อาจแก้สเปกด้วยมือไว้ การเจนซ้ำต้องไม่ลบการแก้นั้นทิ้ง
  // พังตรงนี้ให้ throw ได้เลย ยังไม่มีอะไรถูกบันทึก ผู้ใช้กดใหม่ได้โดยไม่เสียของ
  // (ต่างจากขั้น caption ที่ห้าม throw เพราะ 10-part บันทึกไปแล้ว)
  let productSpec = entry.productSpec;
  if (productSpec.trim() === "") {
    productSpec = await extractProductSpec({
      model,
      productName: entry.productName,
      productInfo: entry.productInfo,
      images: await loadGeminiImages(entry.productImages),
    });
    await prisma.promptEntry.update({
      where: { id: entryId },
      data: { productSpec },
    });
  }
```

**หมายเหตุ:** ตัวแปร `productSpec` นี้ Task 3 จะเอาไปส่งเข้า `buildPromptText` — ตอนนี้ TypeScript จะเตือนว่าประกาศแล้วไม่ได้ใช้ ให้แก้ชั่วคราวด้วยการเพิ่ม `void productSpec;` ต่อท้ายบล็อก พร้อมคอมเมนต์ `// TODO(task-3): ส่งเข้า buildPromptText` แล้วบันทึกไว้ในรายงาน

- [ ] **Step 6: ตรวจ type และ lint**

Run: `npx tsc --noEmit`
Expected: ไม่มี error

Run: `npm run lint`
Expected: ไม่มี error

- [ ] **Step 7: Commit**

```bash
git diff tsconfig.json   # ต้องว่าง
git add app/actions.ts
git commit -m "Wire the spec extraction into generation and duplication

The spec is only extracted when the entry has none, so a hand-corrected spec
survives regeneration. Duplicating copies it — same product, same shape — which
is the opposite of the angle rule right above it, so both now say why.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: ส่งสเปกเข้าโจทย์ + ถอดคำสั่งที่บีบรายละเอียด

**Files:**
- Modify: `lib/prompt-template.ts`
- Modify: `lib/few-shot.ts` (การเรียก `buildPromptText`)
- Modify: `app/actions.ts` (การเรียก `buildPromptText` ใน `generateWithAI`)
- Modify: `components/prompt-workspace.tsx:249-257` (การเรียก `buildPromptText` ใน useMemo preview)
- Create (scratch, ไม่ commit): `<scratch>/test-brief.js`

**Interfaces:**
- Consumes จาก Task 2: `productSpec` ที่ `generateWithAI` เตรียมไว้แล้ว
- Produces: `PromptFormData` มีฟิลด์ `productSpec: string` เพิ่ม (required)

**บริบทที่ต้องรู้ — สำคัญมาก:**
`buildPromptText` ถูกเรียก **3 ที่** ต้องแก้ให้ครบทั้งหมด ไม่งั้น type error:
1. `app/actions.ts:434` (`generateWithAI`) → ส่ง `productSpec` ที่ Task 2 เตรียมไว้
2. `components/prompt-workspace.tsx:249` (useMemo คำนวณ preview ที่ผู้ใช้เห็นสด) → ส่ง `selectedEntry?.productSpec ?? ""`
3. `lib/few-shot.ts:33` (golden examples) → ส่ง `""`

*(ฟีเจอร์ angle ก่อนหน้านี้พลาดจุดที่ 2 เพราะแผนไม่ได้ระบุ — คราวนี้ระบุครบแล้ว)*

**ต่างจากฟีเจอร์ angle:** งานนี้**ไม่มี**ข้อกำหนด byte-identical เพราะการลบ "ไม่ต้องยัดเยิน" ตั้งใจให้เปลี่ยนพฤติกรรมกับทุก entry รวมถึง 58 อันที่ไม่มีสเปก

- [ ] **Step 1: เขียนสคริปต์ทดสอบที่ยังไม่ผ่าน**

เขียนไฟล์ `<scratch>/test-brief.js` ด้วย Write tool:

```js
const { buildPromptText } = require("<scratch>/build-tpl/prompt-template.js");

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
  angle: "",
};

// 1) คำสั่งที่บีบรายละเอียดต้องหายไปจากทุกกรณี
for (const [label, spec] of [["ไม่มีสเปก", ""], ["มีสเปก", "รูปทรง: กล่องเหลี่ยม"]]) {
  const text = buildPromptText({ ...base, productSpec: spec });
  ok(`${label}: ไม่มีคำว่า "ไม่ต้องยัดเยิน"`, !text.includes("ไม่ต้องยัดเยิน"));
  ok(`${label}: ไม่มีเงื่อนไข "ตามระดับความเสี่ยงของสินค้า"`, !text.includes("ตามระดับความเสี่ยงของสินค้า"));
  ok(`${label}: บังคับบรรยายพื้นผิว`, text.includes("พื้นผิว"));
  ok(`${label}: บังคับบรรยายกลไก`, text.includes("กลไก"));
  ok(`${label}: ห้ามคำกำกวม`, text.includes("กำกวม"));
}

// 2) สเปกว่าง -> ไม่มีบล็อกสเปก แต่ยังทำงานได้
const without = buildPromptText({ ...base, productSpec: "" });
ok("สเปกว่าง: ไม่มีหัวข้อสเปก", !without.includes("สเปกสินค้าที่สกัดจากรูป"));
ok("สเปกว่าง: ยังมีหัวข้ออื่นครบ", without.includes("ข้อมูลสินค้าจากเว็บ/ร้านค้า"));

// 3) มีสเปก -> มีบล็อกและมีเนื้อหา
const specText = "รูปทรงและสัดส่วน: กล่องสี่เหลี่ยม\nชิ้นส่วนและกลไก: ฝาพับมีบานพับ";
const withSpec = buildPromptText({ ...base, productSpec: specText });
ok("มีสเปก: มีหัวข้อสเปก", withSpec.includes("สเปกสินค้าที่สกัดจากรูป"));
ok("มีสเปก: มีเนื้อหาครบ", withSpec.includes("ฝาพับมีบานพับ"));
ok("มีสเปก: บอกว่าสเปกคือความจริงหลัก", withSpec.includes("ความจริงหลัก"));

// 4) สเปกที่มีแต่ช่องว่าง ถือว่าว่าง
ok("สเปกช่องว่าง: ถือว่าว่าง",
   buildPromptText({ ...base, productSpec: "  \n " }) === without);

// 5) angle ยังทำงานเหมือนเดิม (ไม่ regress)
const withAngle = buildPromptText({ ...base, productSpec: "", angle: "มุมทดสอบ" });
ok("angle ยังทำงาน", withAngle.includes("Angle ที่ต้องใช้") && withAngle.includes("มุมทดสอบ"));

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 2: รันให้เห็นว่าล้มเหลว**

Run: `npx tsc lib/prompt-template.ts --outDir "<scratch>/build-tpl" --module commonjs --target ES2017 --skipLibCheck`
Run: `node "<scratch>/test-brief.js"`
Expected: FAIL หลายข้อ (ยังมี "ไม่ต้องยัดเยิน" อยู่ · ยังไม่มีบล็อกสเปก)

- [ ] **Step 3: แก้ `lib/prompt-template.ts`**

**3.1** เพิ่ม `productSpec` เข้า type `PromptFormData` (ต่อจาก `angle: string;`):

```ts
  productSpec: string;
```

**3.2** เพิ่ม `productSpec` เข้า destructure ของ `buildPromptText` (ต่อจาก `angle,`):

```ts
  productSpec,
```

**3.3** เพิ่มบล็อกนี้ต่อจากการคำนวณ `useCaseRule` (ก่อน `return`):

```ts
  // สเปกที่ขั้นที่ 0 สกัดจากรูปมาให้ — ป้อนเป็นข้อความเพื่อให้ขั้นนี้ไม่ต้องดึงข้อเท็จจริง
  // จากรูปเองระหว่างที่ต้องแต่งฉาก/กล้อง/บทพูดไปด้วย ซึ่งเป็นจุดที่รายละเอียดเคยหาย
  const trimmedSpec = productSpec.trim();
  const specBlock =
    trimmedSpec === ""
      ? ""
      : `
สเปกสินค้าที่สกัดจากรูป (ความจริงหลักเรื่องข้อเท็จจริงของสินค้า ถ้าขัดกับข้อมูลร้านให้ยึดอันนี้):
"""
${trimmedSpec}
"""
`;
```

**3.4** แทรก `${specBlock}` เข้าไปใน template string — วางต่อจากบล็อก "ข้อมูลสินค้าจากเว็บ/ร้านค้า" (หลัง `"""` ที่ปิด `${productInfo}`) โดยให้บรรทัดว่างเดิมยังอยู่ครบ

**3.5** แทนที่บรรทัดคำสั่งที่บีบรายละเอียด — หาบรรทัดที่ขึ้นต้นด้วย `- อ่านรูปอ้างอิงแต่ละใบตาม caption ที่กำกับ` (บรรทัด 73) แล้วแทนทั้งบรรทัดด้วย 2 บรรทัดนี้:

```
- อ่านรูปอ้างอิงแต่ละใบตาม caption ที่กำกับ แล้วถอดโครงสร้างที่เห็นจริง (รูปทรง สี ชิ้นส่วน สัดส่วน ตำแหน่ง logo ด้านหน้า/หลัง กลไก) ลง Product Accuracy และ Critical Product Structure — **ต้องบรรยายพื้นผิว/วัสดุ และกลไกการใช้งานของส่วนที่ถูกใช้ในคลิปเสมอ** ไม่ว่าจะประเมินว่าสินค้าเสี่ยงเพี้ยนสูงหรือต่ำก็ตาม
- ห้ามใช้คำที่กำกวมในการบรรยายสินค้า — ระบุทรงให้ชัด (กล่อง/โหล/ถัง ไม่ใช่คำรวมๆ) และระบุพื้นผิวให้ชัด (ทึบ หรือ มีรู/ตะแกรง ไม่ใช่คำว่า "โปร่ง") และใช้คำเรียกสินค้าแบบเดียวกันตลอดพรอมต์
```

**สิ่งที่หายไปโดยตั้งใจ:** `ให้ครบตามระดับความเสี่ยงของสินค้า` · `สินค้าซับซ้อน/อสมมาตร ... ให้บรรยายละเอียดพอจะกันเพี้ยน ส่วนสินค้าเรียบง่ายเขียนสั้นกระชับ ไม่ต้องยัดเยิน` — เพราะนี่คือเงื่อนไขที่โมเดลตัดสินพลาดทั้ง 2 เคส และเป็นสิ่งที่จะบีบสเปกกลับลงไปเหลือ 4 bullet

- [ ] **Step 4: รันสคริปต์ทดสอบให้ผ่านทั้งหมด**

Run: `npx tsc lib/prompt-template.ts --outDir "<scratch>/build-tpl" --module commonjs --target ES2017 --skipLibCheck`
Run: `node "<scratch>/test-brief.js"`
Expected: ทุกบรรทัด `PASS` และปิดท้าย `ALL PASS`

**ห้ามแก้ค่าคาดหวังในสคริปต์ทดสอบเพื่อให้ผ่าน**

- [ ] **Step 5: แก้ call sites ทั้ง 3 จุด**

**5.1** `lib/few-shot.ts` — ในการเรียก `buildPromptText` เพิ่ม (golden examples ไม่มีสเปก):

```ts
      productSpec: "",
```

**5.2** `app/actions.ts:434` — ในการเรียก `buildPromptText` ของ `generateWithAI` เพิ่ม:

```ts
    productSpec,
```

แล้วลบ `void productSpec;` กับคอมเมนต์ `// TODO(task-3): ...` ที่ Task 2 ใส่ไว้ชั่วคราวออก

**5.3** `components/prompt-workspace.tsx:249` — ในการเรียก `buildPromptText` ของ useMemo เพิ่ม:

```tsx
      productSpec: selectedEntry?.productSpec ?? "",
```

ตรวจว่า `selectedEntry` อยู่ใน dependency array ของ useMemo นั้นแล้ว (ควรมีอยู่แล้วจากงาน angle) ถ้ายังไม่มีให้เพิ่ม

- [ ] **Step 6: เพิ่ม `productSpec` เข้า type `PromptEntry` ฝั่ง client**

ใน `components/prompt-workspace.tsx` type `PromptEntry` เพิ่มบรรทัด (ต่อจาก `angle: string;`):

```tsx
  productSpec: string;
```

- [ ] **Step 7: ตรวจ type และ lint**

Run: `npx tsc --noEmit`
Expected: ไม่มี error — ถ้ายังมี error ว่า `productSpec` ขาด ให้ค้นด้วย `grep -rn "buildPromptText" app components lib` แล้วแก้ให้ครบทุกจุด

Run: `npm run lint`
Expected: ไม่มี error

- [ ] **Step 8: Commit**

```bash
git diff tsconfig.json   # ต้องว่าง
git add lib/prompt-template.ts lib/few-shot.ts app/actions.ts components/prompt-workspace.tsx
git commit -m "Stop telling the brief not to overdo the product description

The old rule only asked for surface and mechanism detail when the model judged
the product risky — and it judged a hinged-lid container simple, then wrote
four bullets. Removing the conditional matters more than the new wording: with
'don't overdo it' still in place, step two would compress the extracted spec
straight back down.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: แผงสเปกใน UI

**Files:**
- Create: `components/product-spec-panel.tsx`
- Modify: `components/prompt-workspace.tsx` (imports, layout แท็บ brief)

**Interfaces:**
- Consumes จาก Task 2: `saveProductSpec`, `refreshProductSpec` จาก `@/app/actions`
- Produces: `<ProductSpecPanel entryId spec model />`

**บริบทที่ต้องรู้:**
- แท็บ brief ตอนนี้เป็น 2 คอลัมน์: `<BriefForm />` กับ `<ScriptOutput />` อยู่ใน `<div className="flex flex-col gap-5 xl:flex-row">`
- แผงสเปกต้องอยู่**เหนือ `ScriptOutput` ในคอลัมน์ขวา** ไม่ใช่คอลัมน์ที่สาม (จะแคบเกินไป) → ต้องห่อ `ScriptOutput` ด้วย div ใหม่
- `model` ที่ผู้ใช้เลือกอยู่ใน state ของ `prompt-workspace.tsx` แล้ว (ตัวแปร `model`) — ส่งลงมาให้แผงใช้ตอนกดสกัดใหม่
- แผงนี้มีปุ่มของตัวเอง ต้อง `type="button"` ทุกปุ่ม และอยู่นอก `<form>` ใดๆ (คอลัมน์ขวาไม่มี form อยู่แล้ว)

- [ ] **Step 1: เขียน `components/product-spec-panel.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { PackageSearch } from "lucide-react";

import { refreshProductSpec, saveProductSpec } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function ProductSpecPanel({
  entryId,
  spec,
  model,
}: {
  entryId: string;
  spec: string;
  model: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(spec);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startSaving] = useTransition();
  const [isRefreshing, startRefreshing] = useTransition();

  // entry เปลี่ยนตัว -> โหลดสเปกของตัวใหม่ (คอลัมน์นี้ไม่ได้ถูก key ตาม entry)
  const [loadedFor, setLoadedFor] = useState(entryId);
  if (loadedFor !== entryId) {
    setLoadedFor(entryId);
    setDraft(spec);
    setError(null);
  }

  function commit(value: string) {
    if (value.trim() === spec.trim()) return;
    setError(null);
    startSaving(async () => {
      try {
        await saveProductSpec(entryId, value);
      } catch (e) {
        setError(e instanceof Error ? e.message : "บันทึกสเปกไม่สำเร็จ");
      }
    });
  }

  function handleRefresh() {
    setError(null);
    startRefreshing(async () => {
      try {
        setDraft(await refreshProductSpec(entryId, model));
      } catch (e) {
        setError(e instanceof Error ? e.message : "สกัดสเปกไม่สำเร็จ");
      }
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex items-center gap-1.5 font-mono text-xs tracking-widest text-marigold uppercase hover:text-marigold/80"
        >
          <PackageSearch className="size-3.5" />
          สเปกสินค้า (สกัดจากรูป)
        </button>

        <Button
          type="button"
          size="sm"
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="bg-marigold text-ink hover:bg-marigold/90"
        >
          {isRefreshing ? "กำลังสกัด..." : "สกัดสเปกใหม่"}
        </Button>
      </div>

      {draft.trim() === "" && !isRefreshing && (
        <p className="font-mono text-[0.7rem] text-muted-foreground">
          ยังไม่มีสเปก — จะถูกสกัดอัตโนมัติตอนกด &quot;สร้างด้วย AI&quot; ครั้งแรก
        </p>
      )}

      {open && (
        <>
          <Textarea
            rows={12}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commit(draft)}
            placeholder="สเปกสินค้าที่ AI ถอดจากรูป — แก้ได้ถ้าอ่านผิด"
            className="font-sans text-sm leading-[1.6em]"
          />
          <span className="font-mono text-[0.7rem] text-muted-foreground">
            {isSaving ? "กำลังบันทึก..." : "บันทึกเมื่อคลิกออกจากช่อง"}
          </span>
        </>
      )}

      {error && <p className="font-mono text-[0.7rem] text-record">{error}</p>}
    </section>
  );
}
```

- [ ] **Step 2: ต่อสายใน `components/prompt-workspace.tsx`**

เพิ่ม import:

```tsx
import { ProductSpecPanel } from "@/components/product-spec-panel";
```

แล้วห่อ `<ScriptOutput ... />` ในแท็บ brief ด้วย div ใหม่ที่มีแผงสเปกอยู่ข้างบน — เปลี่ยนจาก:

```tsx
              <ScriptOutput
```

เป็น (คงพร็อพเดิมของ `ScriptOutput` ไว้ทั้งหมด แค่ห่อเพิ่ม):

```tsx
              <div className="flex flex-1 flex-col gap-5">
                {selectedId !== null && (
                  <ProductSpecPanel
                    entryId={selectedId}
                    spec={selectedEntry?.productSpec ?? ""}
                    model={model}
                  />
                )}
                <ScriptOutput
```

และปิด div ที่เพิ่มเข้ามาหลัง `/>` ของ `ScriptOutput`:

```tsx
                />
              </div>
```

**ระวัง:** `ScriptOutput` มี `className="flex flex-1 ..."` อยู่แล้ว การห่อด้วย div ที่มี `flex-1` จะทำให้ layout ยังเต็มคอลัมน์เหมือนเดิม — ตรวจด้วยตาใน Step 4

- [ ] **Step 3: ตรวจ type และ lint**

Run: `npx tsc --noEmit`
Expected: ไม่มี error

Run: `npm run lint`
Expected: ไม่มี error

- [ ] **Step 4: ทดสอบ UI จริงบน isolated dev server**

```bash
cp dev.db dev-test.db
NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001
```

เปิด `http://localhost:3001` แท็บ ① แล้วตรวจ:

- **ยังไม่มีสเปก:** เลือก entry เก่าที่ยังไม่มีสเปก → แผงขึ้นข้อความ "ยังไม่มีสเปก — จะถูกสกัดอัตโนมัติ..."
- **สกัดอัตโนมัติ:** กด "สร้างด้วย AI" → หลังเสร็จ กางแผงดู → **ต้องมีสเปกครบ 6 หัวข้อ**
- **เคสสำคัญ (ห้ามทับของที่แก้มือ):** แก้ข้อความในสเปก → คลิกออก (เห็น "กำลังบันทึก...") → กด F5 → ค่ายังอยู่ → **กด "สร้างด้วย AI" อีกครั้ง → สเปกที่แก้ต้องยังอยู่ ไม่ถูกสกัดทับ**
- **สกัดใหม่:** กด "สกัดสเปกใหม่" → สเปกเปลี่ยนเป็นชุดใหม่ → F5 แล้วยังอยู่
- **สเปกถึงโมเดลจริง:** ใส่ข้อความที่สังเกตง่ายลงสเปก (เช่น "ชิ้นส่วนและกลไก: ฝาพับมีบานพับด้านหลัง") → กด "สร้างด้วย AI" → **10-part prompt ที่ได้ต้องสะท้อนคำนั้น**
- **ทำซ้ำก๊อปสเปก:** เลือก entry ที่มีสเปก → กดเมนู kebab → ทำซ้ำ → entry ใหม่ต้อง**มีสเปกเดิมติดมาด้วย** (ต่างจาก angle ที่ต้องว่าง — ตรวจทั้งสองอย่างพร้อมกัน)
- **หน้า "สินค้าใหม่":** กด "สินค้าใหม่" → **ไม่มี**แผงสเปก และฟอร์มยังสร้าง entry ได้ปกติ
- **Layout:** คอลัมน์ขวายังเต็มความสูงเหมือนเดิม ช่อง 10-part ไม่ถูกบีบ · ย่อหน้าต่างแคบแล้วไม่มี horizontal scroll ที่ตัวหน้า
- Console ไม่มี error/hydration warning · แผง angle และส่วนอื่นของแท็บ ① ยังทำงานเหมือนเดิม

ปิด server แล้ว cleanup: `rm -rf .next-dev dev-test.db`

- [ ] **Step 5: Commit**

```bash
git diff tsconfig.json   # ต้องว่าง
git add components/product-spec-panel.tsx components/prompt-workspace.tsx
git commit -m "Show the extracted spec where it can be corrected

A wrong spec would otherwise propagate into every prompt as fact, with nothing
to show why the output drifted. Editing saves through its own action, since the
brief form only creates entries and generateWithAI reads the database.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Core Prompt v8 + วัดผล + เอกสาร

**Files:**
- Create: `prisma/seed/core-prompt-v8.md`
- Create: `<scratch>/measure-alloc.js` (ไม่ commit)
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: ทุกอย่างจาก Task 1-4
- Produces: ไม่มี (งานปลายทาง)

**บริบทที่ต้องรู้:** `CorePrompt` เก็บใน DB มีเวอร์ชัน สลับ active ได้ในแท็บ ③ — **ห้ามเขียนสคริปต์ seed และห้ามแตะ DB** ไฟล์นี้เป็นเนื้อหาให้ผู้ใช้ก๊อปไปวางสร้างเวอร์ชันใหม่เอง (แบบเดียวกับ `prisma/seed/seo-prompt-v1.md` ที่มีอยู่แล้ว) เพราะ v8 ต้องถูกปรับจูนหลายรอบระหว่างทดสอบ

- [ ] **Step 1: อ่าน Core Prompt v7 ที่ active อยู่**

เขียนไฟล์ `<scratch>/dump-core.js`:

```js
const Database = require("<REPO>/node_modules/better-sqlite3");
const fs = require("fs");
const db = new Database("<REPO>/dev.db", { readonly: true });
const c = db.prepare(`SELECT label, content FROM CorePrompt WHERE isActive = 1 AND kind = 'core'`).get();
console.log("label:", c.label, "| ยาว", c.content.length, "ตัวอักษร");
fs.writeFileSync(process.argv[2], c.content, "utf8");
```

Run: `node "<scratch>/dump-core.js" "<scratch>/core-v7.md"`
Expected: ได้ไฟล์ v7 ออกมา (ประมาณ 9,268 ตัวอักษร)

- [ ] **Step 2: เขียน `prisma/seed/core-prompt-v8.md`**

ก๊อปเนื้อหา v7 ทั้งหมดมาเป็นฐาน แล้ว**เพิ่มหัวข้อใหม่ต่อท้าย** (ไม่แก้ของเดิม เพื่อให้ diff อ่านง่ายและ rollback ชัด):

```markdown
## กฎความแม่นยำของสินค้า (v8)

- **สเปกสินค้าที่แนบมาในโจทย์คือความจริงหลักเรื่องข้อเท็จจริงของสินค้า** — รูปทรง วัสดุ พื้นผิว กลไก สี ฉลาก ถ้าสเปกขัดกับข้อมูลร้านหรือขัดกับที่คุณเดาจากรูปเอง ให้ยึดสเปก
- **ต้องบรรยายพื้นผิว/วัสดุ และกลไกการใช้งานเสมอ** สำหรับส่วนของสินค้าที่จะถูกใช้งานในคลิป (เช่น ฝาที่ต้องเปิด แผ่นที่ต้องวางของ ข้อต่อที่ต้องพับ) — ห้ามข้ามด้วยเหตุผลว่าสินค้าดูเรียบง่าย
- **ห้ามใช้คำกำกวมเรียกสินค้าหรือบรรยายพื้นผิว** ระบุทรงให้ชัด (กล่อง / โหล / ถัง / กระบอก ตามที่เห็นจริง) และระบุพื้นผิวให้ชัด (แผ่นทึบ / มีรู / ตะแกรง) — ห้ามใช้คำว่า "โปร่ง" เพราะโมเดลวิดีโอตีความเป็นรูหรือตาข่าย
- **ใช้คำเรียกสินค้าคำเดียวกันตลอดทั้งพรอมต์** และแนบคำขยายรูปทรงไปด้วยทุกครั้งที่เอ่ยถึง — คำนามที่ถูกย้ำหลายครั้งมีน้ำหนักมากกว่าคำขยายที่พูดครั้งเดียว
- **ถ้าสินค้ามีฉลากหรือข้อความบนตัวสินค้า** ให้บรรยายฉลากไว้ในหัวข้อ Subject/Product Accuracy (สี ขนาด ตำแหน่ง) และให้ Negative Prompt ห้ามเฉพาะ**ข้อความที่เพิ่มเข้ามาในวิดีโอ** (ซับ/overlay/callout) ไม่ใช่ห้ามข้อความบนตัวสินค้า
```

- [ ] **Step 3: เขียนสคริปต์วัดสัดส่วนไว้ใช้เทียบก่อน/หลัง**

เขียนไฟล์ `<scratch>/measure-alloc.js`:

```js
const Database = require("<REPO>/node_modules/better-sqlite3");
const db = new Database(process.argv[2] || "<REPO>/dev.db", { readonly: true });

const rows = db.prepare(`
  SELECT productName, chatgptOutput FROM PromptEntry
  WHERE chatgptOutput <> '' ORDER BY createdAt DESC LIMIT 10
`).all();

let totalProduct = 0, totalAll = 0, n = 0;
console.log("สินค้า".padEnd(34) + "ข้อ3+4".padStart(8) + "ทั้งหมด".padStart(12) + "สัดส่วน".padStart(10));
for (const r of rows) {
  const lines = r.chatgptOutput.split("\n");
  const seen = new Set(); const marks = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*(\d+)\.\s*\*{0,2}([^*\n]+)/);
    if (m && +m[1] >= 1 && +m[1] <= 10 && !seen.has(+m[1])) { seen.add(+m[1]); marks.push({ n: +m[1], at: i }); }
  }
  if (marks.length < 5) continue;
  const seg = {};
  for (let k = 0; k < marks.length; k++) {
    seg[marks[k].n] = lines.slice(marks[k].at, marks[k + 1] ? marks[k + 1].at : lines.length).join("\n").length;
  }
  const product = (seg[3] || 0) + (seg[4] || 0);
  totalProduct += product; totalAll += r.chatgptOutput.length; n++;
  console.log(r.productName.slice(0, 32).padEnd(34) + String(product).padStart(8) +
    String(r.chatgptOutput.length).padStart(12) + `${((product / r.chatgptOutput.length) * 100).toFixed(0)}%`.padStart(10));
}
console.log(`\nเฉลี่ย ${n} คลิป: ${((totalProduct / totalAll) * 100).toFixed(1)}% (ค่าฐานก่อนแก้คือ 20.7%)`);
```

Run: `node "<scratch>/measure-alloc.js"`
Expected: ได้ **20.7%** (ค่าฐานจากพรอมต์เก่าที่ยังไม่ผ่านระบบใหม่) — ยืนยันว่าสคริปต์วัดตรงกับที่บันทึกไว้ใน spec

- [ ] **Step 4: ทดสอบปลายทางกับสินค้าจริง 2 ตัว**

```bash
cp dev.db dev-test.db
NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001
```

ในแอป (พอร์ต 3001) ทำตามนี้:
1. แท็บ ③ → สร้าง Core Prompt เวอร์ชันใหม่ วางเนื้อหาจาก `prisma/seed/core-prompt-v8.md` → กดใช้งาน
2. แท็บ ① → หา entry **"ขนมอกไก่ฟรีซดราย"** และ **"ชั้นวางของเหล็กอเนกประสงค์"** → **กดทำซ้ำทั้งคู่** (เพื่อไม่ทับของเดิม รูปถูกก๊อปให้ด้วย)
3. บนตัวที่ทำซ้ำ: ล้างสเปกให้ว่าง (ลบข้อความในแผงแล้วคลิกออก) → กด "สร้างด้วย AI"
4. **ทำซ้ำขั้นที่ 3 รวม 3 รอบต่อสินค้า** (temperature 0.3 ผลไม่นิ่ง)

เกณฑ์ผ่าน — ต้องได้ **3/3 รอบ**:

| สินค้า | เกณฑ์ |
|---|---|
| ชั้นวางเหล็ก | ข้อ 3 หรือ 4 ระบุว่าแผ่นชั้นเป็นแผ่นทึบ/เรียบ (ไม่ใช่ตะแกรง) |
| กล่องขนม | ข้อ 3/4 **ไม่ใช้คำว่า "กระปุก"** และมีคำว่าฝาพับ/บานพับ |

**ถ้าผ่านแค่ 1-2 ใน 3** ให้บันทึกไว้ในรายงานว่ากฎยังอ่อน และระบุว่าผู้ต้องสงสัยอันดับแรกคือ golden examples ที่ไม่มีตัวอย่างสาธิตการบรรยายพื้นผิว/กลไก (spec ระบุว่าเป็นงานรอบถัดไป ไม่ต้องแก้ในแผนนี้)

- [ ] **Step 5: วัดสัดส่วนใหม่**

Run: `node "<scratch>/measure-alloc.js" "<REPO>/dev-test.db"`
Expected: สัดส่วนของ 2 entry ที่เพิ่งเจนต้อง**สูงกว่า 20.7% อย่างเห็นได้ชัด** — บันทึกตัวเลขจริงลงรายงาน

ปิด server แล้ว cleanup: `rm -rf .next-dev dev-test.db`

- [ ] **Step 6: เพิ่มเอกสารใน `CLAUDE.md`**

อ่านหัวข้อ **"Gemini API (ปุ่ม 'สร้างด้วย AI')"** ก่อน แล้วเพิ่มบูลเล็ตต่อท้ายหัวข้อนั้น ให้เข้ากับสไตล์และความหนาแน่นของบูลเล็ตรอบข้าง ครอบคลุมข้อเท็จจริงเหล่านี้ (ตรวจกับโค้ดจริงก่อนเขียน อย่าลอกตามนี้ดื้อๆ):

- ปุ่ม "สร้างด้วย AI" ตอนนี้ทำงาน **3 ขั้น** ไม่ใช่ 2 — ขั้นที่ 0 คือสกัดสเปกสินค้าจากรูป (`extractProductSpec` ใน `lib/gemini.ts`) เก็บลง `PromptEntry.productSpec`
- **ขั้นที่ 0 สกัดเฉพาะเมื่อ `productSpec` ว่าง** — ห้ามทับของเดิม เพราะผู้ใช้แก้สเปทด้วยมือได้ผ่านแผงใน UI
- `extractProductSpec` **ไม่ล็อกโมเดลไว้ที่ flash-lite** ต่างจาก `CAPTION_MODEL`/`EXTRACT_MODEL`/`ANGLE_MODEL` เพราะเป็นงาน vision และสกัดครั้งเดียวต่อสินค้า
- **`duplicatePrompt` ก๊อป `productSpec` แต่ไม่ก๊อป `angle`** — กฎตรงข้ามกันโดยตั้งใจ มีคอมเมนต์อธิบายทั้งสองฝั่งในโค้ดแล้ว
- `buildPromptText` รับ `productSpec` เพิ่ม — **มี 3 call sites** (`app/actions.ts`, `components/prompt-workspace.tsx`, `lib/few-shot.ts`)
- **`lib/prompt-template.ts` ถอดเงื่อนไข "ตามระดับความเสี่ยงของสินค้า" และคำว่า "ไม่ต้องยัดเยิน" ออกโดยตั้งใจ** — เงื่อนไขนั้นคือจุดที่โมเดลตัดสินพลาดจนไม่บรรยายพื้นผิว/กลไก และ "ไม่ต้องยัดเยิน" จะบีบสเปกที่สกัดมากลับลงไป **ห้ามใส่กลับ**
- กฎที่ต้องปรับจูนบ่อยอยู่ใน **Core Prompt (ฐานข้อมูล แก้ในแท็บ ③ ได้ ไม่ต้อง rebuild)** ส่วนโค้ดเก็บเฉพาะสิ่งที่ต้องลบ — เนื้อหา v8 ตั้งต้นอยู่ที่ `prisma/seed/core-prompt-v8.md`

- [ ] **Step 7: Commit**

```bash
git diff tsconfig.json   # ต้องว่าง
git add prisma/seed/core-prompt-v8.md CLAUDE.md
git commit -m "Add the tunable accuracy rules as Core Prompt v8

These live in the database rather than the template so they can be reworded in
the app and switched back with one click — the build cannot be re-run while the
user's production server holds the .next directory.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**ความครอบคลุมของ spec:**

| ข้อกำหนดใน spec | Task ที่ทำ |
|---|---|
| คอลัมน์ `productSpec` (ไม่มีตารางใหม่) | Task 1 Steps 1-2 |
| `extractProductSpec` + หัวข้อตายตัว 6 หัวข้อ | Task 1 Step 3 |
| โมเดลตามที่ผู้ใช้เลือก (ไม่ล็อก flash-lite) | Task 1 Step 3 · Task 2 Step 3 |
| `temperature` ต่ำ (0.2) | Task 1 Step 3 |
| `saveProductSpec` (action ของตัวเอง ไม่ผ่าน form) | Task 2 Step 3 |
| `refreshProductSpec` เขียนทับเมื่อสำเร็จเท่านั้น | Task 2 Step 3 (update หลัง await) |
| `generateWithAI` สกัดเฉพาะเมื่อว่าง ห้ามทับ | Task 2 Step 5 + Task 4 Step 4 (ทดสอบ) |
| ขั้นที่ 0 พัง throw ได้ | Task 2 Step 5 (คอมเมนต์กำกับ) |
| ตัด "ไม่ต้องยัดเยิน" + เงื่อนไขความเสี่ยง | Task 3 Step 3.5 + assert ใน Step 1 |
| บล็อกสเปกใน `buildPromptText` | Task 3 Steps 3.3-3.4 |
| แก้ call sites ครบ 3 จุด | Task 3 Step 5 |
| `duplicatePrompt` ก๊อป `productSpec` + คอมเมนต์ 2 ฝั่ง | Task 2 Step 2 + Task 4 Step 4 (ทดสอบ) |
| Core Prompt v8 เป็นไฟล์ ไม่ใช่ seed script | Task 5 Step 2 |
| UI แยกไฟล์ แก้ได้ + ปุ่มสกัดใหม่ | Task 4 Steps 1-2 |
| วัดผลด้วยสัดส่วน 20.7% | Task 5 Steps 3, 5 |
| ทดสอบ 2 สินค้า × 3 รอบ | Task 5 Step 4 |
| ความเสี่ยง: สเปกผิดต้องแก้ได้ | Task 4 (textarea แก้ได้) |
| ความเสี่ยง: golden examples ไม่สาธิต | Task 5 Step 4 (ระบุว่าเป็นอาการที่ต้องบันทึก ไม่แก้ในแผนนี้) |

**สิ่งที่ spec ระบุว่าไม่ทำ และแผนนี้ไม่ได้ทำ:** ไม่แตะฟอร์มอินพุต · ไม่ลบ Risk Module · ไม่แนบรูปเข้า few-shot · ไม่ทำ negative boilerplate ตามหมวด · ไม่แก้ golden examples · ไม่แตะ `lib/recommender.ts`/`lib/angle.ts`/`lib/weekly-scoreboard.ts` · ไม่เขียนสคริปต์ seed ✓

**ความสอดคล้องของชื่อ/ชนิด:** `extractProductSpec` (lib/gemini) · `saveProductSpec` / `refreshProductSpec` / `loadGeminiImages` (app/actions) · `ProductSpecPanel` (component) · `productSpec` เป็นชื่อฟิลด์เดียวกันทั้ง schema, `PromptFormData`, type `PromptEntry` ฝั่ง client และทุก call site ✓ · `loadGeminiImages` ถูกนิยามใน Task 2 Step 4 และถูกใช้ใน Task 2 Steps 3 และ 5 ทั้งคู่อยู่ใน task เดียวกัน ✓ · ตัวแปร `productSpec` ที่ Task 2 Step 5 สร้างและใส่ `void` ชั่วคราว ถูกเก็บกวาดใน Task 3 Step 5.2 ✓
