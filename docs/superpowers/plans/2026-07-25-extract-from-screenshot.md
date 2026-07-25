# Extract From Screenshot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** แผงในแท็บ Brief ที่รับแคปหน้าสินค้า TikTok Shop แล้วให้ Gemini สกัด ชื่อสินค้า+รายละเอียด มาเติมช่องฟอร์มให้เอง — แทน workflow มือ (แคป → วางในแชท Gemini → ก๊อป → วางกลับ)

**Architecture:** Task 1 เพิ่มฝั่ง server ทั้งสาย: parser (`lib/extract.ts` ตามแบบ `lib/caption.ts`) + ฟังก์ชันเรียกโมเดล (`lib/gemini.ts` — ไฟล์เดียวที่รู้จัก SDK) + Server Action ที่รับรูป in-memory ล้วน (ไม่มีดิสก์/DB) · Task 2 เพิ่มแผงเปิด/ปิดใน `brief-form.tsx` ที่แย่ง window paste เฉพาะตอนเปิด แล้วส่งผลสกัดกลับผ่าน callback ไปเติม form state ใน `prompt-workspace.tsx`

**Tech Stack:** Next.js 16 (custom build) Server Actions · `@google/genai` (Gemini, snake_case API) · React 19 · lucide-react v1.23.0 · Tailwind v4

## Global Constraints

- **`lib/gemini.ts` เป็นไฟล์เดียวที่รู้จัก SDK** · Gemini API ใช้ **snake_case** (`system_instruction`, `generation_config`) — สะกดผิด API **เงียบ** ไม่ error · ห้ามกลบ type error ด้วย `as any` ให้เช็ค `CreateModelInteraction` ใน `node_modules/@google/genai/dist/genai.d.ts`
- **รูปสกัดห้ามแตะดิสก์/DB** — in-memory เท่านั้น ไม่เขียน `uploads/` ไม่สร้างแถว `ProductImage` ไม่เรียก `revalidatePath`
- ล็อกโมเดลสกัดที่ `gemini-3.1-flash-lite` เสมอ (โควตา 500/วัน แยก pool — เหตุผลเดียวกับ `CAPTION_MODEL`)
- ไอคอนใช้ `ScanText` (ยืนยันแล้วว่าเป็นชื่อ canonical ใน lucide v1.23.0 ไม่ใช่ alias)
- **ห้ามรัน `npm run build`/`npm run dev` เปล่าๆ** — ชนกับ production server ของผู้ใช้ที่ port 3000 (`start.bat`) ใช้ `npx tsc --noEmit` เช็ก type
- ทดสอบ UI ใช้ isolated dev server เท่านั้น: `cp dev.db dev-test.db` แล้ว `NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001` — cleanup `dev-test.db` หลังเสร็จ, **ห้ามแตะ/kill port 3000** (การเรียก Gemini จริงใช้ `GEMINI_API_KEY` จาก `.env` ซึ่ง dev server โหลดเองผ่าน dotenv)
- **เช็ก `git diff tsconfig.json` ก่อน commit ทุกครั้ง** — ถ้าเปลี่ยนให้ `git checkout -- tsconfig.json` (repo pin `target: "ES2017"` ตั้งใจ)
- ห้าม emoji · ข้อความ UI ภาษาไทย · design token เดิม (`marigold` accent, `record` error, `ink`/`paper`)
- ไม่มี test runner — verify ด้วย `npx tsc --noEmit` + `npm run lint` + สคริปต์ node ใน scratch + Playwright
- **ห้าม `git add -A`** — add เฉพาะไฟล์ที่ตั้งใจแก้
- Branch: `feature/extract-from-screenshot` (สร้างแล้ว) · spec committed เป็น `1861f9a`

---

### Task 1: ฝั่ง server — parser + Gemini + Server Action

**Files:**
- Create: `lib/extract.ts`
- Modify: `lib/gemini.ts` (เพิ่มท้ายไฟล์ ต่อจากบล็อก `generateCaptionAndHashtags`)
- Modify: `app/actions.ts` (imports บรรทัด 9-14, 20 + เพิ่ม action ใหม่)

**Interfaces:**
- Consumes: `GeminiImage` type และ pattern เดิมใน `lib/gemini.ts` · ค่าคงที่ `ALLOWED_IMAGE_TYPES`/`MAX_IMAGE_BYTES` ที่มีอยู่แล้วใน `app/actions.ts:182-183`
- Produces: `extractProductInfo(formData: FormData): Promise<{ productName: string; productInfo: string }>` — Task 2 เรียกตัวนี้จาก client

- [ ] **Step 1: สร้าง `lib/extract.ts`**

```ts
/**
 * แยกคำตอบของโมเดลเป็นชื่อสินค้ากับรายละเอียดสินค้า
 *
 * ถ้าโมเดลตอบผิดฟอร์แมตจนแยกไม่ได้ ให้คืนทั้งก้อนเป็น productInfo แทนการ throw —
 * ผู้ใช้ตัดแปะเองได้ ดีกว่าเสียผลลัพธ์ที่จ่ายโควตาไปแล้วทิ้งทั้งหมด (แบบเดียวกับ lib/caption.ts)
 */
export function parseExtractOutput(raw: string): {
  productName: string;
  productInfo: string;
} {
  const text = raw.replace(/\*\*/g, "").trim();
  const match = text.match(
    /ชื่อสินค้า:\s*([\s\S]*?)\n\s*รายละเอียดสินค้า:\s*([\s\S]*)/
  );

  if (!match) {
    return { productName: "", productInfo: text };
  }

  return { productName: match[1].trim(), productInfo: match[2].trim() };
}
```

- [ ] **Step 2: ทดสอบ parser ด้วยสคริปต์ node ใน scratch**

เขียนไฟล์ทดสอบใน scratch dir (นอก repo) — **ห้าม inline `node -e`** (git-bash แปลง path ในสตริงพัง) และ require ด้วย absolute path ไม่ได้เพราะเป็น TS ให้ทดสอบผ่าน `npx tsx` จาก repo root แทน หรือเขียน logic ซ้ำเป็น js ล้วนใน scratch เพื่อเช็ค regex อย่างเดียว วิธีที่ตรงที่สุด: สร้างไฟล์ `scratch-test-extract.mjs` ใน scratch dir:

```js
// ทดสอบ regex เดียวกับ lib/extract.ts (คัดลอก logic มาเช็คพฤติกรรม 3 เคส)
function parseExtractOutput(raw) {
  const text = raw.replace(/\*\*/g, "").trim();
  const match = text.match(/ชื่อสินค้า:\s*([\s\S]*?)\n\s*รายละเอียดสินค้า:\s*([\s\S]*)/);
  if (!match) return { productName: "", productInfo: text };
  return { productName: match[1].trim(), productInfo: match[2].trim() };
}

const ok = parseExtractOutput("ชื่อสินค้า: ชั้นวางของ 5 ชั้น\nรายละเอียดสินค้า: วัสดุเหล็ก รับน้ำหนัก 50 กก.");
console.assert(ok.productName === "ชั้นวางของ 5 ชั้น", "case1 name FAIL");
console.assert(ok.productInfo === "วัสดุเหล็ก รับน้ำหนัก 50 กก.", "case1 info FAIL");

const bad = parseExtractOutput("อ่านไม่ออกครับ ภาพเบลอ");
console.assert(bad.productName === "", "case2 name FAIL");
console.assert(bad.productInfo === "อ่านไม่ออกครับ ภาพเบลอ", "case2 info FAIL");

const bold = parseExtractOutput("**ชื่อสินค้า:** กระทะ\n**รายละเอียดสินค้า:** เคลือบไม่ติด");
console.assert(bold.productName === "กระทะ", "case3 name FAIL");
console.assert(bold.productInfo === "เคลือบไม่ติด", "case3 info FAIL");

console.log("ALL PASS");
```

Run: `node <scratch>/scratch-test-extract.mjs`
Expected: `ALL PASS` (ไม่มีบรรทัด FAIL)

- [ ] **Step 3: เพิ่มฟังก์ชันสกัดใน `lib/gemini.ts`**

วางต่อท้ายไฟล์ (หลังฟังก์ชัน `generateCaptionAndHashtags` ปิดที่บรรทัด 112):

```ts
/**
 * งานสกัดข้อความจากแคปหน้าสินค้าล็อกที่โมเดลเร็วเสมอ เหตุผลเดียวกับ CAPTION_MODEL:
 * เป็นงานอ่านข้อความล้วน ไม่ควรจ่ายโควตาโมเดลละเอียด (20/วัน) ให้งานที่ flash-lite (500/วัน) ทำได้
 */
export const EXTRACT_MODEL: GeminiModelId = "gemini-3.1-flash-lite";

const EXTRACT_INSTRUCTION = `คุณคือผู้ช่วยสกัดข้อความจากภาพแคปหน้าจอสินค้า TikTok Shop
อ่านทุกภาพที่แนบมา แล้วตอบกลับในรูปแบบนี้เท่านั้น:

ชื่อสินค้า: <ชื่อสินค้าตามที่เห็นในภาพ>
รายละเอียดสินค้า: <รายละเอียด/คำอธิบายสินค้าทั้งหมดที่อ่านได้จากภาพ เรียงต่อกัน>

กติกา: คัดลอกข้อความตามที่เห็นจริงในภาพ ใช้ภาษาเดิมตามภาพ ไม่แต่งเติม ไม่สรุปย่อ ไม่ใส่ความเห็น
ถ้าข้อความบางส่วนถูกตัดขอบภาพ ให้ใส่เท่าที่อ่านได้`;

export async function extractProductFields(args: {
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
    // snake_case — camelCase จะถูก API เมินแบบเงียบๆ (ดูคอมเมนต์ใน generateTenPartPrompt)
    system_instruction: EXTRACT_INSTRUCTION,
    // temperature 0 — งานคัดลอกข้อความ ไม่ใช่งานสร้างสรรค์
    generation_config: { temperature: 0 },
    input,
  });

  const text = response.output_text;
  if (!text || text.trim() === "") {
    throw new Error("AI ไม่ได้ตอบกลับตอนสกัดข้อมูล ลองใหม่อีกครั้ง");
  }
  return text;
}
```

- [ ] **Step 4: เพิ่ม Server Action ใน `app/actions.ts`**

4.1 แก้ import จาก `@/lib/gemini` (บรรทัด 9-13) — เพิ่ม `extractProductFields`:

```ts
import {
  generateTenPartPrompt,
  generateCaptionAndHashtags,
  extractProductFields,
  isGeminiModelId,
} from "@/lib/gemini";
```

4.2 เพิ่ม import ใหม่ (ข้างๆ `import { parseCaptionOutput } from "@/lib/caption";` บรรทัด 14):

```ts
import { parseExtractOutput } from "@/lib/extract";
```

4.3 วาง action ใหม่ต่อจากฟังก์ชัน `updateProductImageCaption` (ปิดที่บรรทัด 254):

```ts
/**
 * สกัดชื่อสินค้า+รายละเอียดจากแคปหน้าสินค้า TikTok Shop — รูปเป็นของใช้แล้วทิ้ง:
 * อยู่แค่ใน memory ไม่เขียนดิสก์ ไม่สร้างแถว DB (คนละชุดกับรูปสินค้าจริงใน ProductImage)
 */
export async function extractProductInfo(
  formData: FormData
): Promise<{ productName: string; productInfo: string }> {
  const rawFiles = formData.getAll("files");
  const files: File[] = [];
  for (const value of rawFiles) {
    if (value instanceof File && value.size > 0) files.push(value);
  }
  if (files.length === 0) {
    throw new Error("กรุณาแนบแคปหน้าสินค้าอย่างน้อย 1 รูป");
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

  const raw = await extractProductFields({ images });
  // ไม่ revalidatePath — action นี้ไม่แตะข้อมูลใดๆ
  return parseExtractOutput(raw);
}
```

**หมายเหตุตำแหน่ง:** `ALLOWED_IMAGE_TYPES`/`MAX_IMAGE_BYTES` ประกาศที่บรรทัด 182-183 — action ใหม่อยู่หลังบรรทัด 254 จึงเห็นค่าคงที่แน่นอน

- [ ] **Step 5: type-check + lint**

Run: `npx tsc --noEmit`
Expected: ผ่าน ไม่มี error

Run: `npm run lint`
Expected: สะอาด ไม่มี warning ใหม่

- [ ] **Step 6: เช็ก tsconfig แล้ว commit**

Run: `git diff tsconfig.json`
Expected: ว่าง — ถ้าไม่ว่างให้ `git checkout -- tsconfig.json` ก่อน

```bash
git add lib/extract.ts lib/gemini.ts app/actions.ts
git commit -m "Add server-side product info extraction from screenshots"
```

---

### Task 2: ฝั่ง UI — แผงสกัดใน BriefForm + callback ใน workspace

**Files:**
- Modify: `components/brief-form.tsx` (imports บรรทัด 3-6 · props · state · paste handler บรรทัด 112-122 · JSX ก่อน `</section>`)
- Modify: `components/prompt-workspace.tsx` (handler ใหม่ + prop ในบล็อก `<BriefForm>` ~บรรทัด 316-325)

**Interfaces:**
- Consumes: `extractProductInfo(formData: FormData): Promise<{ productName: string; productInfo: string }>` จาก Task 1 · helper เดิมใน brief-form: `rejectionReason`, `imageFilesFrom`
- Produces: ไม่มี — task สุดท้าย

- [ ] **Step 1: แก้ imports ใน `brief-form.tsx`**

แทนที่บรรทัด 3-6 เดิม:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardPaste, X } from "lucide-react";

import { deleteProductImage } from "@/app/actions";
```

ด้วย:

```tsx
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ClipboardPaste, ScanText, X } from "lucide-react";

import { deleteProductImage, extractProductInfo } from "@/app/actions";
```

- [ ] **Step 2: เพิ่ม prop `onExtracted`**

ใน destructure params ของ `BriefForm` เพิ่มบรรทัดต่อจาก `onSaveCaption,`:

```tsx
  onExtracted,
```

ใน type block เพิ่มบรรทัดต่อจาก `onSaveCaption: (id: string, caption: string) => void;`:

```tsx
  onExtracted: (fields: { productName: string; productInfo: string }) => void;
```

- [ ] **Step 3: เพิ่ม state แผงสกัด**

วางต่อจาก `const [localError, setLocalError] = useState<string | null>(null);` (บรรทัด 82):

```tsx
  // แผงสกัดข้อมูลจากแคปหน้าสินค้า — รูปชุดนี้ใช้แล้วทิ้ง อยู่แค่ใน memory ฝั่ง client
  const [extractOpen, setExtractOpen] = useState(false);
  const [extractImages, setExtractImages] = useState<File[]>([]);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [isExtracting, startExtracting] = useTransition();
  const extractInputRef = useRef<HTMLInputElement>(null);

  const extractPreviews = useMemo(
    () => extractImages.map((file) => URL.createObjectURL(file)),
    [extractImages]
  );
  useEffect(() => {
    return () => {
      for (const url of extractPreviews) URL.revokeObjectURL(url);
    };
  }, [extractPreviews]);
```

- [ ] **Step 4: เพิ่มฟังก์ชัน accept + extract**

วางต่อจากฟังก์ชัน `acceptFiles` (ปิดที่บรรทัด 106 เดิม):

```tsx
  function acceptExtractFiles(files: File[]) {
    if (files.length === 0) return;
    const reason = rejectionReason(files);
    if (reason) {
      setExtractError(reason);
      return;
    }
    setExtractError(null);
    setExtractImages((prev) => [...prev, ...files]);
  }

  function handleExtract() {
    if (extractImages.length === 0) return;
    setExtractError(null);
    startExtracting(async () => {
      try {
        const formData = new FormData();
        for (const file of extractImages) formData.append("files", file);
        const fields = await extractProductInfo(formData);
        onExtracted(fields);
        setExtractImages([]);
        setExtractOpen(false);
      } catch (e) {
        setExtractError(e instanceof Error ? e.message : "สกัดข้อมูลไม่สำเร็จ");
      }
    });
  }
```

- [ ] **Step 5: แก้ window paste handler ให้ route ตามสถานะแผง**

แทนที่ `useEffect` เดิม (บรรทัด 112-122 — ตัวที่มีคอมเมนต์ "Pasting a screenshot must work...") ทั้งบล็อกด้วย:

```tsx
  // Pasting a screenshot must work wherever the cursor happens to be, so the
  // listener lives on the window. BriefForm only renders on the Brief tab, so it
  // cannot swallow pastes elsewhere. Text pastes carry no files and fall through
  // to the focused input untouched.
  useEffect(() => {
    function handlePaste(event: ClipboardEvent) {
      const files = imageFilesFrom(event.clipboardData?.files);
      if (files.length === 0) return;
      event.preventDefault();
      // ตอนแผงสกัดเปิดอยู่ paste ต้องเข้าแผงสกัด ไม่ใช่รูปสินค้าจริง — ตัดสินใน
      // handler เดียว ไม่ตั้ง listener ซ้อนกันสองตัวแข่งกัน (effect นี้ไม่มี deps
      // array ตั้งใจ: ลงทะเบียนใหม่ทุก render closure จึงเห็น state สดเสมอ)
      if (extractOpen) {
        acceptExtractFiles(files);
      } else {
        acceptFiles(files);
      }
    }

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  });
```

- [ ] **Step 6: เพิ่ม JSX แผงสกัด**

วางเป็น section ใหม่ต่อจาก `</div>` ที่ปิดบล็อก "รูปสินค้าจริง" (บรรทัด 306 เดิม — div ที่มี `{shownError && ...}` เป็นลูกสุดท้าย) ก่อน `</section>`:

```tsx
      {/* สกัดข้อมูลจากแคปหน้าสินค้า — รูปชุดนี้เป็นคนละชุดกับรูปสินค้าจริงด้านบน:
          ส่งให้ AI อ่านข้อความแล้วทิ้ง ไม่ถูกเก็บลงดิสก์/DB และห้ามปนเข้ารูปสินค้าจริง
          เพราะแคปหน้าข้อความจะทำให้ 10-part prompt ตอน generate วิดีโอเพี้ยน */}
      <div className="flex flex-col gap-1.5 border-t border-border pt-5">
        <button
          type="button"
          onClick={() => setExtractOpen((open) => !open)}
          aria-expanded={extractOpen}
          className="flex items-center gap-1.5 self-start font-mono text-xs tracking-widest text-marigold uppercase hover:text-marigold/80"
        >
          <ScanText className="size-3.5" />
          สกัดจากแคปหน้าสินค้า
        </button>

        {extractOpen && (
          <div className="flex flex-col gap-3 rounded-lg border border-dashed border-marigold/40 p-3">
            <div
              role="button"
              tabIndex={0}
              aria-label="วางหรือเลือกแคปหน้าสินค้าเพื่อสกัดข้อมูล"
              onClick={() => extractInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") extractInputRef.current?.click();
              }}
              className="flex cursor-pointer flex-col gap-2"
            >
              {extractImages.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {extractImages.map((file, index) => (
                    <div key={`${file.name}-${index}`} className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={extractPreviews[index]}
                        alt="แคปหน้าสินค้า (ใช้สกัดแล้วทิ้ง)"
                        className="size-24 rounded-md border border-dashed border-marigold object-cover"
                      />
                      <button
                        type="button"
                        aria-label="ลบแคป"
                        onClick={(e) => {
                          e.stopPropagation();
                          setExtractImages((prev) => prev.filter((_, i) => i !== index));
                        }}
                        className="absolute -top-1.5 -right-1.5 rounded-full bg-record p-0.5 text-paper"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <p className="flex items-center gap-1.5 font-mono text-[0.7rem] text-muted-foreground">
                <ClipboardPaste className="size-3.5 shrink-0" />
                กด Ctrl+V เพื่อวางแคปหน้าสินค้า (ชื่อ/รายละเอียด) — รูปชุดนี้ใช้สกัดแล้วทิ้ง ไม่ถูกเก็บ
              </p>

              <input
                ref={extractInputRef}
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp"
                hidden
                onChange={(e) => {
                  acceptExtractFiles(imageFilesFrom(e.target.files));
                  e.target.value = "";
                }}
              />
            </div>

            <Button
              type="button"
              size="sm"
              onClick={handleExtract}
              disabled={isExtracting || extractImages.length === 0}
              className="self-start bg-marigold text-ink hover:bg-marigold/90"
            >
              {isExtracting ? "กำลังสกัด..." : "สกัดข้อมูล"}
            </Button>

            {extractError && (
              <p className="font-mono text-[0.7rem] text-record">{extractError}</p>
            )}
          </div>
        )}
      </div>
```

- [ ] **Step 7: เพิ่ม handler + prop ใน `prompt-workspace.tsx`**

7.1 วางฟังก์ชันต่อจาก `handleDuplicate` (ปิดที่ ~บรรทัด 213):

```tsx
  function handleExtracted(fields: { productName: string; productInfo: string }) {
    // ค่าว่างไม่ทับของเดิม — กันเคส parser fallback คืน productName ว่างมาลบชื่อที่พิมพ์ไว้แล้ว
    setForm((f) => ({
      ...f,
      productName: fields.productName || f.productName,
      productInfo: fields.productInfo || f.productInfo,
    }));
  }
```

7.2 ในบล็อก `<BriefForm ...>` (~บรรทัด 316-325) เพิ่ม prop ต่อจาก `onSaveCaption={...}`:

```tsx
                onExtracted={handleExtracted}
```

- [ ] **Step 8: type-check + lint**

Run: `npx tsc --noEmit`
Expected: ผ่าน ไม่มี error

Run: `npm run lint`
Expected: สะอาด ไม่มี warning ใหม่

- [ ] **Step 9: verify UI จริง (เรียก Gemini จริง)**

```bash
cp dev.db dev-test.db
NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001
```

เตรียมรูปทดสอบ: สร้างภาพ PNG ที่มีข้อความไทยจำลองหน้าสินค้า (เช่นวาดด้วย Playwright screenshot ของ HTML ง่ายๆ ที่มีข้อความ "ชั้นวางของ 5 ชั้น วัสดุเหล็ก รับน้ำหนัก 50 กก.") หรือใช้แคปจริงถ้ามีใน scratch

เปิด `localhost:3001` (Playwright ใน scratch dir นอก repo) ตรวจ 7 ข้อ:

1. แผงสกัดเริ่มต้น**ปิด** — เห็นแค่ปุ่ม "สกัดจากแคปหน้าสินค้า"
2. ยังไม่เปิดแผง: แนบรูปผ่าน file input ของ dropzone รูปสินค้าจริง → เข้ารูปสินค้าจริงตามเดิม (no regression)
3. เปิดแผง → เพิ่มรูปทดสอบผ่าน file input ของแผงสกัด → รูปโผล่ในแผง **ไม่โผล่ในรูปสินค้าจริง**
4. กด "สกัดข้อมูล" → ปุ่มเปลี่ยนเป็น "กำลังสกัด..." → เสร็จแล้วช่อง**ชื่อสินค้า**และ**ข้อมูลสินค้าจากเว็บ/ร้านค้า**ถูกเติมด้วยข้อความที่ตรงกับในรูป → แผงปิด รูปในแผงถูกเคลียร์
5. ช่อง Product Risk Module / ข้อมูลเพิ่มเติมจากฉัน **ไม่ถูกแตะ**
6. ตรวจ side effects: ไม่มีโฟลเดอร์/ไฟล์ใหม่ใน `uploads/` เกิดจากการสกัด และจำนวนแถว `ProductImage` ใน dev-test.db เท่าเดิม (เช็คด้วยสคริปต์ better-sqlite3 readonly ตามแพตเทิร์น CLAUDE.md)
7. console ไม่มี error / hydration error

หยุด dev server ตัวเอง แล้ว `rm dev-test.db`

- [ ] **Step 10: เช็ก tsconfig แล้ว commit**

Run: `git diff tsconfig.json`
Expected: ว่าง — ถ้าไม่ว่างให้ `git checkout -- tsconfig.json` ก่อน

```bash
git add components/brief-form.tsx components/prompt-workspace.tsx
git commit -m "Add extract-from-screenshot panel to the brief form"
```

---

## Self-Review

**Spec coverage:** §1 parser → Task 1 Step 1-2 · §2 `extractProductFields`+`EXTRACT_MODEL` → Task 1 Step 3 · §3 Server Action in-memory ไม่ revalidate → Task 1 Step 4 · §4 แผง UI + paste routing + `onExtracted` + ค่าว่างไม่ทับ → Task 2 Step 1-7 · §5 เรื่องไม่ใช่สินค้าไม่ทำ feature → ไม่มี task (ถูกต้อง) · Non-goals ทุกข้อ → ไม่มี task ไหนทำ · Verification ทุกข้อใน spec → Task 2 Step 9

**Placeholder scan:** ไม่มี TBD/TODO · ทุก step มีโค้ดเต็ม · ไม่มี unit test เพราะไม่มี test runner (parser ใช้สคริปต์ node ใน scratch แทน — logic เล็กพอที่การเช็ค regex คู่ขนานจะพิสูจน์พฤติกรรมได้)

**Type consistency:** `extractProductInfo(formData: FormData): Promise<{ productName: string; productInfo: string }>` ตรงกันระหว่าง action (Task 1 Step 4) กับจุดเรียก (Task 2 Step 4) · `onExtracted: (fields: { productName: string; productInfo: string }) => void` ตรงกันระหว่าง prop type (Step 2), จุดเรียก `onExtracted(fields)` (Step 4), และ `handleExtracted` (Step 7) · `GeminiImage` = `{ base64, mimeType, caption }` — action สร้าง object ตรง shape (caption: "")

**จุดที่ต้องระวังตอน implement:** paste handler เดิม**ไม่มี deps array ตั้งใจ** (คอมเมนต์ระบุแล้ว) ห้าม "แก้ให้ถูก" โดยเติม deps เพราะจะทำให้ closure ค้าง · ปุ่ม "สกัดข้อมูล" ต้องเป็น `type="button"` (อยู่นอก form อยู่แล้ว แต่กันพลาด) · การทดสอบ Step 9 เรียก Gemini จริง — ถ้าเจอ 400 Input blocked (safety false positive กับรูปทดสอบ) ให้เปลี่ยนเนื้อหารูปทดสอบ ไม่ใช่บั๊กโค้ด
