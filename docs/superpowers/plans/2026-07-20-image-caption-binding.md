# Image-Caption Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ผูก caption ของรูปสินค้าแต่ละใบเข้ากับตัวรูปแล้ว interleave ตอนส่งเข้า Gemini เพื่อให้โมเดลรู้ว่ารูปใบไหนคือด้านไหน (แทนการเดาตามตำแหน่ง) พร้อมส่ง productName และเสริมการดึงโครงสร้างลง Product Accuracy

**Architecture:** ย้าย caption จาก JSON array บน `PromptEntry.images` ไปเป็นคอลัมน์ `caption` บน `ProductImage` (แหล่งความจริงเดียว จำนวน caption = จำนวนรูปเสมอ) แล้วในเส้นทางเจน ส่ง caption ประกบรูปของมันทีละคู่ในลำดับเดียวกัน UI รวมช่อง caption เข้าไปอยู่ใต้ thumbnail รูปแต่ละใบ

**Tech Stack:** Next.js 16 (custom build, App Router + Server Actions), Prisma 7 + better-sqlite3 adapter, `@google/genai`, React 19, Tailwind v4, Base UI

## Global Constraints

- **ไม่มี test runner** — verify ทุก task ด้วย `npm run build` (type-check ในตัว) + `npm run lint` + รันจริง ไม่ใช่ unit test
- **ห้ามรัน `npm run build` ซ้อนกับ `start.bat`** — ขอให้ผู้ใช้ปิด production server ก่อน build ทุกครั้ง (`.next` พังได้ตาม CLAUDE.md); เช็ก port: `netstat -ano | grep ':3000' | grep LISTENING`
- **Prisma 7 driver adapter** — generated client import จาก `@/lib/generated/prisma/client` เท่านั้น หลังแก้ schema ต้อง `npx prisma migrate dev` แล้ว `npx prisma generate`
- **Gemini API ใช้ snake_case** — `system_instruction`, `generation_config`, `mime_type` — ห้ามเดา shape อ่าน `CreateModelInteraction` ใน `node_modules/@google/genai/dist/genai.d.ts` ห้ามกลบด้วย `as any`
- **แก้ dev.db ต้องผ่าน `npx prisma db execute` หรือ Prisma เท่านั้น** — ห้าม standalone better-sqlite3 write script (โดน classifier บล็อก) ทุก statement ต้องมี `WHERE` scoped (dev.db ไม่มี backup)
- **`CorePrompt` query อ่าน `isActive: true` ต้องใส่ `kind` เสมอ** (ไม่แตะใน plan นี้ แต่ห้ามเผลอถอด)
- **สคริปต์เช็ก dev.db แบบ readonly** — เขียนเป็นไฟล์ `.js` จริงใน scratch dir, `require()` better-sqlite3 ด้วย absolute path เข้า `node_modules` ของ repo, เปิดด้วย `{readonly:true}`
- **branch:** ทำทั้งหมดบน `feature/image-caption-binding` (มี spec commit `1670f82` อยู่แล้ว)

---

### Task 1: Schema — คอลัมน์ caption บน ProductImage + migration + backfill

**Files:**
- Modify: `prisma/schema.prisma:45-53` (model `ProductImage`)
- Create (ชั่วคราว): scratch `check-caption.js` (readonly verify)

**Interfaces:**
- Produces: `ProductImage.caption: string` (default `""`) — Task 2 และ Task 3 อ่าน/เขียนคอลัมน์นี้

- [ ] **Step 1: เพิ่มคอลัมน์ caption ใน schema**

แก้ `prisma/schema.prisma` model `ProductImage` เพิ่มบรรทัด `caption` (วางก่อน `sortOrder`):

```prisma
model ProductImage {
  id        String      @id @default(cuid())
  entryId   String
  entry     PromptEntry @relation(fields: [entryId], references: [id], onDelete: Cascade)
  filename  String
  mimeType  String
  caption   String      @default("")
  sortOrder Int         @default(0)
  createdAt DateTime    @default(now())
}
```

- [ ] **Step 2: รัน migration + regenerate client**

ยืนยันก่อนว่า port 3000 ว่าง (ผู้ใช้ปิด `start.bat` แล้ว) จากนั้น:

Run: `npx prisma migrate dev --name add_product_image_caption`
Expected: migration ใหม่ถูกสร้างใน `prisma/migrations/`, ไม่มี data loss warning (เป็นการเพิ่มคอลัมน์ที่มี default)

Run: `npx prisma generate`
Expected: สำเร็จ ไม่มี error

- [ ] **Step 3: Backfill caption จาก label เดิม (best-effort)**

copy `PromptEntry.images[i]` → `productImages[i].caption` ตาม `sortOrder` ผ่าน `prisma db execute` (guarded ด้วย `json_valid`, scoped ด้วย `WHERE caption = ''`):

```bash
npx prisma db execute --stdin <<'SQL'
UPDATE ProductImage
SET caption = COALESCE(
  (SELECT CASE WHEN json_valid(pe.images)
              THEN json_extract(pe.images, '$[' || ProductImage.sortOrder || ']')
         END
   FROM PromptEntry pe WHERE pe.id = ProductImage.entryId),
  ''
)
WHERE caption = '';
SQL
```

Expected: รันสำเร็จ (best-effort — entry ที่เคยมี label≠จำนวนรูปจะได้ caption เท่าที่ตรง sortOrder ส่วนเกินตกหล่น ยอมรับได้)

- [ ] **Step 4: Verify แบบ readonly**

เขียนไฟล์ scratch `check-caption.js`:

```js
const D = require('C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt/node_modules/better-sqlite3');
const db = new D('C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt/dev.db', { readonly: true });
const total = db.prepare('SELECT COUNT(*) c FROM ProductImage').get().c;
const withCaption = db.prepare("SELECT COUNT(*) c FROM ProductImage WHERE caption != ''").get().c;
console.log('ProductImage ทั้งหมด:', total, '| มี caption:', withCaption);
for (const r of db.prepare('SELECT filename, caption, sortOrder FROM ProductImage ORDER BY entryId, sortOrder LIMIT 8').all()) {
  console.log(' ', r.sortOrder, '|', r.caption || '(ว่าง)');
}
db.close();
```

Run: `node <scratch>/check-caption.js`
Expected: คอลัมน์ `caption` มีอยู่จริง, backfill เอา label เก่ามาใส่บางแถว

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: สำเร็จ (ยังไม่มีโค้ดใช้ caption — แค่ต้อง compile ผ่านหลัง prisma generate)

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "Add caption column to ProductImage and backfill from legacy labels"
```

---

### Task 2: Engine — buildPromptText + gemini interleave + few-shot + generateWithAI

**Files:**
- Modify: `lib/prompt-template.ts` (ทั้งไฟล์ — signature + productName + Product Accuracy)
- Modify: `lib/gemini.ts:20-62` (`GeminiImage` + interleave)
- Modify: `lib/few-shot.ts` (map golden → imageCaptions)
- Modify: `lib/golden-examples.ts` (เพิ่ม `productName` ในแต่ละ example)
- Modify: `app/actions.ts:251-280` (`generateWithAI`)
- Modify: `components/prompt-workspace.tsx:204-213` (preview `output` useMemo)

**Interfaces:**
- Consumes: `ProductImage.caption` (Task 1)
- Produces:
  - `buildPromptText(args: { productName: string; productInfo: string; riskModule: string; extraNotes: string; imageCaptions: string[] }): string`
  - `type GeminiImage = { base64: string; mimeType: string; caption: string }`
  - `type GoldenExample` เพิ่ม field `productName: string`

- [ ] **Step 1: เปลี่ยน buildPromptText — signature + productName + เสริม Product Accuracy**

แทนที่ `lib/prompt-template.ts` ทั้งไฟล์ด้วย:

```ts
export type PromptFormData = {
  productName: string;
  productInfo: string;
  riskModule: string;
  extraNotes: string;
  imageCaptions: string[];
};

export function buildPromptText({
  productName,
  productInfo,
  riskModule,
  extraNotes,
  imageCaptions,
}: PromptFormData): string {
  const imageLines = imageCaptions
    .map((caption, index) => `รูปที่ ${index + 1}: ${caption || "[ไม่มีคำอธิบาย]"}`)
    .join("\n");

  return `ใช้ Core Prompt ด้านบนสร้าง prompt สำหรับ Gemini Flow

ให้วิเคราะห์ข้อมูลสินค้า รูปอ้างอิง, Product Accuracy, Product Risk, Category Module, Shot / Angle Template และ Performance Card ภายในก่อน
แต่ไม่ต้องแสดง Product Card หรือ Performance Card ออกมา

ให้ output เฉพาะ prompt สำหรับ Gemini Flow ตามโครงสร้าง 10 ส่วนของ Core Prompt
โดยเขียนให้กระชับ ไม่ซ้ำ ไม่มีคำสั่งที่ขัดกัน และเหมาะกับคลิป 10 วินาที

ชื่อสินค้า:
"""
${productName}
"""

รูปอ้างอิงที่แนบ (แต่ละใบมี caption กำกับ และจะถูกแนบให้ดูทีละใบพร้อม caption ด้านล่างของโจทย์นี้):
${imageLines}

ข้อมูลสินค้าจากเว็บ/ร้านค้า:
"""
${productInfo}
"""

Product Risk Module ที่ต้องใช้:
"""
${riskModule}
"""

ข้อมูลเพิ่มเติมจากฉัน ถ้ามี:
"""
${extraNotes}
"""

สิ่งที่ต้องทำ:
- เลือก use case เดียวที่เหมาะที่สุด เสี่ยงเพี้ยนน้อย และขายของได้ใน 10 วินาที
- เลือก action ที่ง่ายที่สุดแต่เห็นประโยชน์สินค้าเร็ว
- อ่านรูปอ้างอิงแต่ละใบตาม caption ที่กำกับ แล้วถอดโครงสร้างที่เห็นจริง (รูปทรง สี ชิ้นส่วน สัดส่วน ตำแหน่ง logo ด้านหน้า/หลัง กลไก) ลง Product Accuracy และ Critical Product Structure ให้ครบ**ตามระดับความเสี่ยงของสินค้า** — สินค้าซับซ้อน/อสมมาตร (logo ด้านเดียว, พับ/กาง/มีกลไก) ให้บรรยายละเอียดพอจะกันเพี้ยน ส่วนสินค้าเรียบง่ายเขียนสั้นกระชับ ไม่ต้องยัดเยิน
- caption ของรูปคือความจริงเรื่องด้าน/ชิ้นส่วน ใช้เพื่อไม่ให้ output บรรยายผิดด้าน (เช่นถ้า caption บอก logo อยู่ด้านหน้าเท่านั้น ห้ามให้ output ใส่ logo ด้านหลัง)
- วิเคราะห์ Product Accuracy ที่ห้ามพลาดจากรูปและข้อมูลสินค้า
- วิเคราะห์ Critical Product Structure ที่ต้องคงไว้
- วิเคราะห์จุดที่ AI มีโอกาสทำเพี้ยน แล้วใส่กันไว้ใน Product Accuracy / Negative Prompt
- เลือกจำนวน visual beats ให้เหมาะกับความเสี่ยงของสินค้า
- ถ้าสินค้าเสี่ยงเพี้ยนสูง เช่น พับได้ กางได้ ยืดได้ หมุนได้ มีโครงขา หรือมีกลไก ให้ใช้ 3–4 visual beats ที่ปลอดภัยกว่า
- ถ้าสินค้าเสี่ยงต่ำ ให้ใช้ 4–5 visual beats เพื่อให้คลิปมีจังหวะ

กฎสำคัญ:
- ใช้รูปอ้างอิงเป็นหลักก่อนข้อมูลเว็บ
- ห้ามเดาคุณสมบัติที่ไม่มีในรูปหรือข้อมูลสินค้า
- ถ้าไม่แน่ใจ ให้เลือกทาง conservative และเสี่ยงเพี้ยนน้อยที่สุด
- ห้ามเคลมเกินจริง
- ต้องเห็นสินค้าใน 1–2 วินาทีแรก
- ภายใน 2 วินาทีแรกต้องมี movement ชัดเจน
- คลิปต้องเร็ว แต่ห้ามทำให้สินค้า วิธีใช้ หรือโครงสร้างเพี้ยน
- ห้ามมีข้อความทุกชนิดในวิดีโอ
- ห้ามซับ ห้าม label ห้าม poster ห้าม UI overlay ห้าม callout ห้ามราคา ห้ามตัวหนังสือในฉากหลัง
- บทพากย์ไทยเท่านั้น 3–5 วลี/จังหวะพูดสั้น รวมประมาณ 30–35 คำเท่านั้นและห้ามเกิน 35 คำ มี hook ใน 1–2 วินาทีแรก และไม่มี dead air ยาว

**important**:
กรณีที่เป็นสินค้าแนวน้ำยาปรับผ้านุ่ม/ซักผ้า/ล้างจาน/ของเหลวต่างๆ
เนื่องจากสินค้าแนวของเหลวมักจะไม่มีรูปที่เป็นของเหลวต้นฉบับให้ จึงต้องไม่เน้นไปเรื่องการเทให้เห็นของเหลว
ไม่ควรให้คลิปพึ่งการเห็นตัวของเหลวเป็นหลัก
ให้ทำแนว Package-led UGC คือ "แพ็กเกจเป็นพระเอก + before /after ของการแก้ปัญหาที่ได้จากการใช้สินค้าแทน"

Output:
สร้าง prompt สำหรับ Gemini Flow ตาม 10 ส่วนนี้เท่านั้น:
1. Style
2. Scene
3. Subject
4. Product Accuracy
5. Action Timeline
6. Camera
7. Framing
8. Lighting / Color
9. Negative Prompt
10. Quick QA Checklist`;
}

export const DEFAULT_IMAGE_LABELS = ["ภาพหน้าสินค้า", "ภาพตอนใช้งาน"];
```

หมายเหตุ: เอาคำว่า "TikTok Shop" ออกจาก 2 บรรทัด ("จังหวะ TikTok Shop" → "จังหวะ", "คลิปต้องเร็วแบบ TikTok Shop" → "คลิปต้องเร็ว") ตามแนวเดียวกับ v7 core prompt ที่ลบ trigger คำว่า TikTok

- [ ] **Step 2: interleave caption+รูป ใน gemini.ts**

แก้ `lib/gemini.ts` — เปลี่ยน type และ loop รูป:

เปลี่ยน type (บรรทัด 20):
```ts
export type GeminiImage = { base64: string; mimeType: string; caption: string };
```

แทนที่ block ที่ push รูป (บรรทัด 48-52 เดิม) ด้วย:
```ts
  // Then the real task, then each photo immediately preceded by its caption so the
  // model binds "รูปที่ N = this side" instead of guessing by position.
  input.push({ type: "text", text: `### โจทย์จริง\n${args.brief}` });
  for (const [index, image] of args.images.entries()) {
    input.push({
      type: "text",
      text: `รูปที่ ${index + 1}${image.caption ? ` — ${image.caption}` : ""}`,
    });
    input.push({ type: "image", data: image.base64, mime_type: image.mimeType });
  }
```

- [ ] **Step 3: เพิ่ม productName ใน golden examples + map เป็น imageCaptions ใน few-shot.ts**

ใน `lib/golden-examples.ts` เพิ่ม field `productName: string` ใน `type GoldenExample` และใส่ค่าในทั้ง 6 entry (ชื่อสินค้าจริงของแต่ละตัว):

```ts
export type GoldenExample = {
  productName: string;
  productInfo: string;
  riskModule: string;
  extraNotes: string;
  images: string[];
  output: string;
};
```

ค่าที่ใส่ต่อ entry (ตามลำดับใน `GOLDEN_EXAMPLES`): `"ของเล่นแมว ที่ลับเล็บแมว"`, `"หมอนสุขภาพ"`, `"คอนโดแมวไม้"`, `"Dearny น้ำยาปรับผ้านุ่ม"`, `"ชั้นวางเครื่องปรุง"`, `"หม้อสแตนเลสพร้อมฝาปิด"`
(ยืนยันชื่อจริงกับ `productName` ของ entry ต้นทางถ้าสงสัย — อ่าน readonly จาก dev.db)

ใน `lib/few-shot.ts` แก้ `.map` ให้เรียก buildPromptText signature ใหม่:
```ts
  return picked.map((ex) => ({
    brief: buildPromptText({
      productName: ex.productName,
      productInfo: ex.productInfo,
      riskModule: ex.riskModule,
      extraNotes: ex.extraNotes,
      imageCaptions: ex.images,
    }),
    output: ex.output,
  }));
```

- [ ] **Step 4: ประกอบ brief/images ใหม่ใน generateWithAI**

ใน `app/actions.ts` ลบ block `imageLabels` (บรรทัด 251-263 เดิม: `let imageLabels ... JSON.parse ... buildPromptText({... images: imageLabels})`) แล้วแทน block การประกอบ brief + photos ด้วย:

```ts
  const photos = entry.productImages; // เรียง sortOrder แล้วจาก include ด้านบน
  const brief = buildPromptText({
    productName: entry.productName,
    productInfo: entry.productInfo,
    riskModule: entry.riskModule,
    extraNotes: entry.extraNotes,
    imageCaptions: photos.map((p) => p.caption),
  });

  const geminiImages = await Promise.all(
    photos.map(async (image) => ({
      base64: (
        await readFile(path.join(UPLOAD_ROOT, image.entryId, image.filename))
      ).toString("base64"),
      mimeType: image.mimeType,
      caption: image.caption,
    }))
  );

  const output = await generateTenPartPrompt({
    model,
    systemInstruction: core.content,
    examples: await getFewShotExamples(entryId),
    brief,
    images: geminiImages,
  });
```

- [ ] **Step 5: อัปเดต preview useMemo ใน prompt-workspace.tsx**

แก้ `components/prompt-workspace.tsx` บรรทัด 204-213 ให้เข้ากับ signature ใหม่ (form.images ยังมีอยู่ ถูกลบใน Task 3):
```ts
  const output = useMemo(
    () =>
      buildPromptText({
        productName: form.productName,
        productInfo: form.productInfo,
        riskModule: form.riskModule,
        extraNotes: form.extraNotes,
        imageCaptions: form.images,
      }),
    [form]
  );
```

- [ ] **Step 6: Verify build + lint**

ยืนยัน port 3000 ว่างก่อน แล้ว:
Run: `npm run build`
Expected: สำเร็จ ไม่มี type error (ทุก caller ของ buildPromptText/generateTenPartPrompt ใช้ signature ใหม่ครบ)

Run: `npm run lint`
Expected: ไม่มี warning ใหม่

- [ ] **Step 7: Commit**

```bash
git add lib/prompt-template.ts lib/gemini.ts lib/few-shot.ts lib/golden-examples.ts app/actions.ts components/prompt-workspace.tsx
git commit -m "Interleave each product photo with its caption when calling Gemini"
```

---

### Task 3: Form UX — caption ต่อรูป, ถอดช่อง label ลอย

**Files:**
- Modify: `app/actions.ts` (`uploadProductImages` รับ captions, `createPrompt` เลิกเขียน label, เพิ่ม `updateProductImageCaption`)
- Modify: `components/prompt-workspace.tsx` (`pendingImages` เป็น `{file,caption}[]`, ถอด form.images)
- Modify: `components/brief-form.tsx` (ถอด Field "รูปอ้างอิงที่แนบ", เพิ่ม caption input ใต้รูป)

**Interfaces:**
- Consumes: `updateProductImageCaption`, `ProductImage.caption`
- Produces:
  - `uploadProductImages` อ่าน `formData.getAll("captions")` คู่ขนานกับ `files`
  - `updateProductImageCaption(id: string, caption: string): Promise<void>`
  - `ProductImageRecord` เพิ่ม field `caption: string`

- [ ] **Step 1: uploadProductImages รับ caption ต่อไฟล์**

ใน `app/actions.ts` `uploadProductImages` — หลังบรรทัดดึง `files` เพิ่มการดึง captions และใส่ตอน create:

หลัง `const files = formData.getAll("files")...` เพิ่ม:
```ts
  const captions = formData.getAll("captions").map((c) => String(c));
```

ใน loop `prisma.productImage.create` เพิ่ม `caption`:
```ts
    await prisma.productImage.create({
      data: {
        entryId,
        filename,
        mimeType: file.type,
        caption: (captions[index] ?? "").trim(),
        sortOrder: existingCount + index,
      },
    });
```

- [ ] **Step 2: createPrompt เลิกเขียน label + เพิ่ม updateProductImageCaption**

ใน `createPrompt` ลบ block อ่าน `images` (บรรทัด 23-26) และเปลี่ยน `images: JSON.stringify(images)` ใน create เป็น `images: "[]"` (คงคอลัมน์ไว้ ไม่แบก label อีก):
```ts
  const created = await prisma.promptEntry.create({
    data: {
      productName,
      productInfo,
      riskModule,
      extraNotes,
      images: "[]",
      corePromptId: activeCorePrompt?.id ?? null,
    },
  });
```

เพิ่ม action ใหม่ (วางใกล้ `deleteProductImage`):
```ts
export async function updateProductImageCaption(id: string, caption: string) {
  await prisma.productImage.update({
    where: { id },
    data: { caption: caption.trim() },
  });
  revalidatePath("/");
}
```

- [ ] **Step 3: prompt-workspace — pendingImages ถือ caption, ถอด form.images**

ใน `components/prompt-workspace.tsx`:

(a) `FormState` (บรรทัด 33-38 area) ลบ field `images`. `emptyForm` ลบ `images: DEFAULT_IMAGE_LABELS`. `entryToForm` ลบ block parse images ทั้งหมด (บรรทัด 67-70, 78) — เอา `images` ออกจาก object ที่ return.

(b) เปลี่ยน state:
```ts
  const [pendingImages, setPendingImages] = useState<{ file: File; caption: string }[]>([]);
```

(c) `uploadImagesTo` ส่ง captions คู่ไฟล์:
```ts
  function uploadImagesTo(entryId: string, items: { file: File; caption: string }[]) {
    const formData = new FormData();
    formData.set("entryId", entryId);
    for (const { file, caption } of items) {
      formData.append("files", file);
      formData.append("captions", caption);
    }
    return uploadProductImages(formData);
  }
```

(d) `handleAddImages` — wrap File เป็น `{file, caption:""}`:
```ts
  function handleAddImages(files: File[]) {
    if (files.length === 0) return;
    setImageError(null);
    if (selectedId === null) {
      setPendingImages((prev) => [...prev, ...files.map((file) => ({ file, caption: "" }))]);
      return;
    }
    startUploading(async () => {
      try {
        await uploadImagesTo(selectedId, files.map((file) => ({ file, caption: "" })));
      } catch (e) {
        setImageError(e instanceof Error ? e.message : "แนบรูปไม่สำเร็จ");
      }
    });
  }
```

(e) เพิ่ม callback แก้ caption ของรูป pending:
```ts
  function updatePendingCaption(index: number, caption: string) {
    setPendingImages((prev) => prev.map((it, i) => (i === index ? { ...it, caption } : it)));
  }
```

(f) ลบ `updateImage`, `addImage`, `removeImage` (บรรทัด 180-193)

(g) preview `output` useMemo — ดึง caption จากรูปจริง (saved ใช้ productImages, ยังไม่ save ใช้ pending):
```ts
  const output = useMemo(() => {
    const imageCaptions =
      selectedEntry !== null
        ? selectedEntry.productImages.map((p) => p.caption)
        : pendingImages.map((p) => p.caption);
    return buildPromptText({
      productName: form.productName,
      productInfo: form.productInfo,
      riskModule: form.riskModule,
      extraNotes: form.extraNotes,
      imageCaptions,
    });
  }, [form, selectedEntry, pendingImages]);
```
(ย้ายประกาศ `selectedEntry` ขึ้นก่อน useMemo ถ้าจำเป็น — ปัจจุบันอยู่บรรทัด 242 ให้ย้ายขึ้นเหนือ useMemo)

(h) `createAction` เดิมเรียก `uploadImagesTo(id, pendingImages)` — ตอนนี้ `pendingImages` เป็น `{file,caption}[]` ตรง signature ใหม่แล้ว ไม่ต้องแก้

(i) แก้ props ที่ส่งให้ `<BriefForm>`: ลบ `onImageChange={updateImage}`, `onAddImage={addImage}`, `onRemoveImage={removeImage}`; เพิ่ม `onUpdatePendingCaption={updatePendingCaption}` และ `onSaveCaption={(id, caption) => updateProductImageCaption(id, caption)}` (import `updateProductImageCaption` จาก `@/app/actions`)

- [ ] **Step 4: brief-form — ถอด Field label ลอย, เพิ่ม caption ใต้รูป**

ใน `components/brief-form.tsx`:

(a) `FormState` type (บรรทัด 12-18) ลบ field `images`

(b) props type ของ `BriefForm`: ลบ `onImageChange`, `onAddImage`, `onRemoveImage`; เปลี่ยน `pendingImages: File[]` เป็น `pendingImages: { file: File; caption: string }[]`; เพิ่ม `onUpdatePendingCaption: (index: number, caption: string) => void` และ `onSaveCaption: (id: string, caption: string) => void`. `ProductImageRecord` (ใน prompt-workspace ที่ import มา) ต้องมี `caption: string` — เพิ่มใน type นั้น

(c) ลบ Field "รูปอ้างอิงที่แนบ" ทั้งบล็อก (บรรทัด 180-215)

(d) `pendingPreviews` useMemo เปลี่ยนอ้าง `.file`:
```ts
  const pendingPreviews = useMemo(
    () => pendingImages.map((it) => URL.createObjectURL(it.file)),
    [pendingImages]
  );
```

(e) ใน dropzone: ใต้ thumbnail รูป **saved** (`productImages.map`) เพิ่ม caption input; และ **pending** (`pendingImages.map`) เพิ่ม caption input ผูกกับ index. หุ้มรูป+input เป็น column และ `stopPropagation` กัน click ทะลุไปเปิด file dialog:

รูป saved — เปลี่ยน element ต่อรูปเป็น:
```tsx
              {productImages.map((image) => (
                <div key={image.id} className="flex w-24 flex-col gap-1">
                  <div className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/uploads/${image.entryId}/${image.filename}`}
                      alt="รูปสินค้า"
                      className="size-24 rounded-md border border-border object-cover"
                    />
                    <button
                      type="button"
                      aria-label="ลบรูป"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteProductImage(image.id);
                      }}
                      className="absolute -top-1.5 -right-1.5 rounded-full bg-record p-0.5 text-paper"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                  <Input
                    defaultValue={image.caption}
                    placeholder="อธิบายรูปนี้ เช่น ด้านหน้า มี logo"
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => onSaveCaption(image.id, e.target.value)}
                    className="h-7 text-xs"
                  />
                </div>
              ))}
```

รูป pending — เปลี่ยนเป็น:
```tsx
              {pendingImages.map((item, index) => (
                <div key={`${item.file.name}-${index}`} className="flex w-24 flex-col gap-1">
                  <div className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={pendingPreviews[index]}
                      alt="รูปสินค้า (ยังไม่บันทึก)"
                      className="size-24 rounded-md border border-dashed border-marigold object-cover"
                    />
                    <button
                      type="button"
                      aria-label="ลบรูป"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemovePending(index);
                      }}
                      className="absolute -top-1.5 -right-1.5 rounded-full bg-record p-0.5 text-paper"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                  <Input
                    value={item.caption}
                    placeholder="อธิบายรูปนี้ เช่น ด้านหลัง ไม่มี logo"
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => onUpdatePendingCaption(index, e.target.value)}
                    className="h-7 text-xs"
                  />
                </div>
              ))}
```

(f) ลบ `<input name="images" .../>` ที่ผูกกับ label เดิม (อยู่ใน Field ที่ลบไปแล้ว — ยืนยันไม่มีตกค้าง)

- [ ] **Step 5: Verify build + lint**

ยืนยัน port 3000 ว่าง แล้ว:
Run: `npm run build`
Expected: สำเร็จ ไม่มี type error (FormState ไม่มี images แล้ว, props ตรงกันหมด)

Run: `npm run lint`
Expected: ไม่มี warning ใหม่

- [ ] **Step 6: Verify ในแอปจริง**

รันแอป (`npm run dev` หรือ `start.bat`) แล้วทดสอบด้วย Playwright (ติดตั้งใน scratch) หรือด้วยมือ + screenshot:
- สร้าง entry ใหม่ → วางรูป 2-3 ใบ → พิมพ์ caption ใต้แต่ละรูป → กด "สร้าง Prompt"
- เลือก entry นั้นใหม่ → caption ที่พิมพ์ยังอยู่ใต้รูป (persist ผ่าน `ProductImage.caption`)
- เพิ่มรูปให้ entry ที่ save แล้ว → พิมพ์ caption → กดออกจาก field → reload → caption ยังอยู่
Expected: caption ผูกกับรูปแต่ละใบ ไม่มีช่อง label ลอยแยกอีก

- [ ] **Step 7: Commit**

```bash
git add app/actions.ts components/prompt-workspace.tsx components/brief-form.tsx
git commit -m "Move caption onto each photo in the upload UI, drop free-standing labels"
```

---

### Task 4: End-to-end verify + ปรับ Product Accuracy ถ้าจำเป็น

**Files:**
- (เผื่อ) Modify: `lib/golden-examples.ts` (เสริม section Product Accuracy ในตัวอย่าง)
- Create (ชั่วคราว): scratch script เทียบ output

**Interfaces:**
- Consumes: ทั้ง pipeline จาก Task 1-3

- [ ] **Step 1: รัน Gemini จริงกับสินค้ายาก (multi-photo, อสมมาตร)**

ในแอปจริง สร้าง entry ทดสอบสินค้าที่มี logo ด้านเดียว/หลายรูป (หรือใช้ "กระติกน้ำแข็ง" เดิม) → ใส่รูปพร้อม caption ระบุด้าน (เช่น "ด้านหน้า มี logo", "ด้านหลัง ไม่มี logo") → กด "สร้างด้วย AI" (โมเดล flash-lite, โควตาแยก pool)

Run: อ่าน output ล่าสุดแบบ readonly:
```js
const D = require('C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt/node_modules/better-sqlite3');
const db = new D('C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt/dev.db', { readonly: true });
const r = db.prepare("SELECT productName, chatgptOutput FROM PromptEntry ORDER BY createdAt DESC LIMIT 1").get();
console.log(r.productName); console.log('---'); console.log(r.chatgptOutput);
db.close();
```
Expected: section **Product Accuracy / Critical Product Structure** บรรยายด้าน/logo/โครงสร้างถูกต้องตาม caption (ไม่สลับหน้า-หลัง, logo ไม่ไปโผล่ผิดด้าน)

- [ ] **Step 2: รัน Gemini จริงกับสินค้าง่าย — เช็ก regression**

สร้าง entry สินค้าง่าย (เช่นชุดช้อนส้อม รูปเดียว caption สั้น) → เจน → อ่าน output
Expected: Product Accuracy กระชับ ไม่บวมยัดเยิน โครงยังเป็น 10 ส่วนครบ (ไม่ regress จากของเดิม)

- [ ] **Step 3: (เงื่อนไข) เสริม golden examples ถ้า output ถูกดึงให้บาง**

ถ้า Step 1 พบว่า Product Accuracy ยังบางเกินสำหรับสินค้ายาก (few-shot anchor ดึงกลับ) → แก้ `lib/golden-examples.ts` เสริมรายละเอียดโครงสร้างใน section Product Accuracy ของ example ที่เป็นสินค้ามีโครงสร้าง (เช่น คอนโดแมวไม้, ชั้นวางเครื่องปรุง) ให้เป็น anchor ที่ละเอียดขึ้น แล้วเจนซ้ำยืนยัน
Expected: output ยากดีขึ้นโดยง่ายไม่ regress (ถ้าไม่จำเป็น ข้าม step นี้)

- [ ] **Step 4: Verify build + lint สุดท้าย**

Run: `npm run build`
Expected: สำเร็จ

Run: `npm run lint`
Expected: ไม่มี warning

- [ ] **Step 5: Commit (ถ้ามีการแก้ golden ใน Step 3)**

```bash
git add lib/golden-examples.ts
git commit -m "Strengthen Product Accuracy anchor in golden examples"
```

---

## Self-Review (ผู้เขียนแผนตรวจแล้ว)

**Spec coverage:** ทุกหัวข้อใน spec มี task รองรับ — §1 data model → Task 1 · §2 form UX → Task 3 · §3 interleave → Task 2 Step 2 · §4 productName → Task 2 Step 1/4 · §5 Product Accuracy → Task 2 Step 1 + Task 4 · §backward compat → Task 1 Step 3 · §verification → Task 3 Step 6 + Task 4 · out-of-scope ไม่มี task (ถูกต้อง)

**Type consistency:** `buildPromptText({productName, productInfo, riskModule, extraNotes, imageCaptions})` ใช้เหมือนกันทุก caller (few-shot, generateWithAI, preview) · `GeminiImage = {base64,mimeType,caption}` ตรงกันระหว่าง gemini.ts producer และ generateWithAI consumer · `pendingImages: {file,caption}[]` ตรงกันระหว่าง prompt-workspace และ brief-form props · `updateProductImageCaption(id, caption)` signature เดียวทั้ง action และ caller

**Placeholder scan:** ไม่มี TBD/TODO — โค้ดครบทุก step ที่แก้โค้ด verification เป็นคำสั่งจริงของโปรเจกต์ (ไม่มี test runner จึงใช้ build/lint/prisma/real-run แทน unit test โดยตั้งใจ ระบุไว้ใน Global Constraints)
