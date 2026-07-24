# Duplicate Clip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เพิ่มปุ่ม "ทำซ้ำ" ที่ก๊อป entry (ข้อความ + รูปสินค้า + output/caption) เป็น entry ใหม่ที่พร้อมทำคลิปซ้ำ โดยไม่ต้องหา/ทำรูปใหม่

**Architecture:** เพิ่ม 1 คอลัมน์ nullable (`duplicatedFromId`) ใน `PromptEntry`, สร้าง Server Action `duplicatePrompt` ที่ก๊อป row + ก๊อปไฟล์รูปบนดิสก์ + สร้างแถว `ProductImage` ชุดใหม่, แล้ว wire ปุ่มใน `history-rail.tsx` กับ handler ใน `prompt-workspace.tsx` ที่เลือก entry ใหม่ + เด้งไปแท็บ Brief

**Tech Stack:** Next.js 16 (custom build) App Router + Server Actions · Prisma 7 + `@prisma/adapter-better-sqlite3` · React 19 · lucide-react · Tailwind v4

## Global Constraints

- Prisma 7 บังคับ driver adapter — import client จาก `@/lib/generated/prisma/client` เท่านั้น (ไม่มี barrel)
- หลังแก้ `prisma/schema.prisma` รัน `npx prisma migrate dev --name <name>` แล้วตามด้วย `npx prisma generate` — ห้าม `prisma migrate reset`
- **ห้ามรัน `npm run build`/`npm run dev` ชนกับ `start.bat` ของผู้ใช้ที่ port 3000** — ใช้ `npx tsc --noEmit` เช็ก type (ไม่เขียน `.next`)
- ทดสอบ UI ใช้ isolated dev server เท่านั้น: `cp dev.db dev-test.db` แล้ว `NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001` — cleanup `dev-test.db` หลังเสร็จ, **ห้ามแตะ/kill port 3000**
- **เช็ก `git diff tsconfig.json` ก่อน commit ทุกครั้ง** — dev server อาจ auto-patch, ถ้าเปลี่ยนให้ `git checkout -- tsconfig.json` (repo pin `target: "ES2017"` ตั้งใจ)
- ห้าม emoji · ข้อความ UI ภาษาไทย · ใช้ design token (`marigold`/`record`/`paper`/`ink`) + ไอคอน lucide เดิม
- ไม่มี test runner — verify ด้วย `npx tsc --noEmit` + `npm run lint` + Playwright ใน scratch dir
- **ห้าม `git add -A`** — add เฉพาะไฟล์ที่ตั้งใจแก้
- Branch: `feature/duplicate-clip` (สร้างแล้ว) · spec committed เป็น `8ef4357`

---

### Task 1: Schema — เพิ่มคอลัมน์ `duplicatedFromId`

**Files:**
- Modify: `prisma/schema.prisma` (model `PromptEntry`, ~บรรทัด 32)
- Create: `prisma/migrations/<timestamp>_add_duplicated_from/migration.sql` (Prisma สร้างให้)

**Interfaces:**
- Produces: คอลัมน์ `duplicatedFromId String?` บน `PromptEntry` — Task 2 จะเขียนค่าลงไปตอน duplicate

- [ ] **Step 1: เพิ่มฟิลด์ใน schema**

ใน `prisma/schema.prisma` model `PromptEntry` เพิ่มบรรทัดต่อจาก `  createdAt   DateTime @default(now())`:

```prisma
model PromptEntry {
  id          String   @id @default(cuid())
  productName String
  productInfo String
  riskModule  String
  extraNotes  String
  images      String
  createdAt   DateTime @default(now())
  duplicatedFromId String?
```

(เพิ่มแค่บรรทัด `duplicatedFromId String?` — ส่วนที่เหลือของ model คงเดิมทั้งหมด ไม่ต้องแตะ)

- [ ] **Step 2: รัน migration**

Run: `npx prisma migrate dev --name add_duplicated_from`
Expected: `Your database is now in sync with your schema.` และมีโฟลเดอร์ migration ใหม่โผล่ใน `prisma/migrations/`

**หมายเหตุ:** การเพิ่มคอลัมน์ nullable เป็น additive/non-destructive และเร็ว — ปลอดภัยแม้ `start.bat` ของผู้ใช้รันอยู่ (เขียน `dev.db` แค่ชั่วขณะ) **ห้ามใช้ `prisma migrate reset`** (ล้างข้อมูลจริง)

- [ ] **Step 3: verify migration SQL ถูกต้อง**

Run: `cat prisma/migrations/*_add_duplicated_from/migration.sql`
Expected: มีบรรทัด `ALTER TABLE "PromptEntry" ADD COLUMN "duplicatedFromId" TEXT;`

- [ ] **Step 4: regenerate client + type-check**

Run: `npx prisma generate`
Expected: `Generated Prisma Client`

Run: `npx tsc --noEmit`
Expected: ผ่าน ไม่มี error

- [ ] **Step 5: เช็ก tsconfig แล้ว commit**

Run: `git diff tsconfig.json`
Expected: ว่าง — ถ้าไม่ว่างให้ `git checkout -- tsconfig.json` ก่อน

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "Add duplicatedFromId column to PromptEntry"
```

---

### Task 2: Server Action `duplicatePrompt` + ปุ่ม "ทำซ้ำ" ใน UI

**Files:**
- Modify: `app/actions.ts` (เพิ่มฟังก์ชัน `duplicatePrompt`)
- Modify: `components/history-rail.tsx` (import + prop + ปุ่ม)
- Modify: `components/prompt-workspace.tsx` (import + handler + wiring)

**Interfaces:**
- Consumes: คอลัมน์ `duplicatedFromId` จาก Task 1 · `UPLOAD_ROOT`, `mkdir`/`readFile`/`writeFile`/`path`/`revalidatePath`/`prisma` (มีอยู่แล้วใน `app/actions.ts`) · `entryToForm`, `useTransition`, state setters (มีอยู่แล้วใน `prompt-workspace.tsx`)
- Produces: `duplicatePrompt(sourceId: string): Promise<string>` (คืน id ของ entry ใหม่)

- [ ] **Step 1: เพิ่ม action `duplicatePrompt` ใน `app/actions.ts`**

วางฟังก์ชันนี้ต่อจาก `createPrompt` (หลังบรรทัด `}` ปิด `createPrompt` ~บรรทัด 50) — `crypto.randomUUID()` ใช้ได้ (มีใน `uploadProductImages` อยู่แล้ว), import ทั้งหมดที่ใช้มีครบแล้วด้านบนไฟล์:

```ts
export async function duplicatePrompt(sourceId: string): Promise<string> {
  const source = await prisma.promptEntry.findUnique({
    where: { id: sourceId },
    include: { productImages: { orderBy: { sortOrder: "asc" } } },
  });
  if (!source) {
    throw new Error("ไม่พบรายการที่ต้องการทำซ้ำ");
  }

  // ก๊อปเฉพาะฟิลด์ที่ใช้ซ้ำได้ — ปล่อย videoUrl/วันเวลาโพสต์เป็น default เพราะเป็นข้อเท็จจริงรายคลิป
  const created = await prisma.promptEntry.create({
    data: {
      productName: source.productName,
      productInfo: source.productInfo,
      riskModule: source.riskModule,
      extraNotes: source.extraNotes,
      images: source.images,
      corePromptId: source.corePromptId,
      chatgptOutput: source.chatgptOutput,
      caption: source.caption,
      hashtags: source.hashtags,
      duplicatedFromId: source.id,
    },
  });

  await mkdir(path.join(UPLOAD_ROOT, created.id), { recursive: true });

  for (const image of source.productImages) {
    let data: Buffer;
    try {
      data = await readFile(path.join(UPLOAD_ROOT, image.entryId, image.filename));
    } catch {
      // ไฟล์ต้นฉบับหายบนดิสก์ — ข้ามรูปใบนี้ ไม่ให้ทั้ง action ล้ม (row เป็น source of truth
      // แต่คลิปซ้ำที่ขาดรูปบางใบ ดีกว่า error ทั้งหมด — แนวเดียวกับ deleteProductImage)
      continue;
    }
    const ext =
      image.mimeType === "image/png" ? "png" : image.mimeType === "image/webp" ? "webp" : "jpg";
    const filename = `${crypto.randomUUID()}.${ext}`;
    await writeFile(path.join(UPLOAD_ROOT, created.id, filename), data);
    await prisma.productImage.create({
      data: {
        entryId: created.id,
        filename,
        mimeType: image.mimeType,
        caption: image.caption,
        sortOrder: image.sortOrder,
      },
    });
  }

  revalidatePath("/");
  return created.id;
}
```

- [ ] **Step 2: เพิ่มปุ่ม "ทำซ้ำ" ใน `components/history-rail.tsx`**

2.1 แก้ import ไอคอน (บรรทัด 4) — เพิ่ม `Copy`:

```tsx
import { Copy, Plus, Search, Trash2 } from "lucide-react";
```

2.2 เพิ่ม prop `onDuplicate` ใน type ของ `HistoryRail` (บล็อก props ~บรรทัด 41-47) — เพิ่มบรรทัดต่อจาก `onNew: () => void;`:

```tsx
  onSelect: (entry: PromptEntry) => void;
  onNew: () => void;
  onDuplicate: (id: string, event: React.MouseEvent) => void;
  onDelete: (id: string, event: React.MouseEvent) => void;
```

และเพิ่ม `onDuplicate` ใน destructure params ของฟังก์ชัน (~บรรทัด 37-48) ต่อจาก `onNew,`:

```tsx
export function HistoryRail({
  prompts,
  selectedId,
  onSelect,
  onNew,
  onDuplicate,
  onDelete,
}: {
```

2.3 เพิ่มปุ่ม "ทำซ้ำ" ก่อนปุ่มลบ (span `Trash2` ~บรรทัด 155-162) — วาง span ใหม่แทรกก่อนหน้า span ลบ:

```tsx
                      <span
                        role="button"
                        aria-label="ทำซ้ำรายการ"
                        onClick={(event) => onDuplicate(entry.id, event)}
                        className="shrink-0 text-paper/30 opacity-0 transition-opacity group-hover:opacity-100 hover:text-marigold"
                      >
                        <Copy className="size-3.5" />
                      </span>
                      <span
                        role="button"
                        aria-label="ลบรายการ"
                        onClick={(event) => onDelete(entry.id, event)}
                        className="shrink-0 text-paper/30 opacity-0 transition-opacity group-hover:opacity-100 hover:text-record"
                      >
                        <Trash2 className="size-3.5" />
                      </span>
```

(span ลบยังเหมือนเดิม — แค่เพิ่ม span ทำซ้ำไว้ข้างหน้า)

- [ ] **Step 3: wire handler ใน `components/prompt-workspace.tsx`**

3.1 เพิ่ม `duplicatePrompt` ใน import จาก `@/app/actions` (บล็อก import ~บรรทัด 5-12) — เพิ่มบรรทัด:

```tsx
import {
  createPrompt,
  deletePrompt,
  duplicatePrompt,
  generateWithAI,
  updateProductImageCaption,
  uploadProductImages,
} from "@/app/actions";
```

3.2 เพิ่ม transition สำหรับ duplicate ต่อจากบรรทัด `const [, startDeleteTransition] = useTransition();` (~บรรทัด 107):

```tsx
  const [, startDeleteTransition] = useTransition();
  const [, startDuplicateTransition] = useTransition();
```

3.3 เพิ่ม handler `handleDuplicate` ต่อจากฟังก์ชัน `handleDelete` (~หลังบรรทัด 198):

```tsx
  function handleDuplicate(id: string, event: React.MouseEvent) {
    event.stopPropagation();
    const source = prompts.find((p) => p.id === id);
    if (!source) return;
    startDuplicateTransition(async () => {
      const newId = await duplicatePrompt(id);
      setSelectedId(newId);
      setForm(entryToForm(source)); // ข้อความคลิปซ้ำ = source เป๊ะ — ตั้งตรงไม่พึ่ง auto-sync
      setPendingImages([]);
      setImageError(null);
      setGenError(null);
      setTab("brief");
    });
  }
```

3.4 ส่ง prop `onDuplicate` ให้ `HistoryRail` (~บรรทัด 282-288) — เพิ่มต่อจาก `onNew={startNew}`:

```tsx
        <HistoryRail
          prompts={prompts}
          selectedId={selectedId}
          onSelect={selectPrompt}
          onNew={startNew}
          onDuplicate={handleDuplicate}
          onDelete={handleDelete}
        />
```

- [ ] **Step 4: type-check + lint**

Run: `npx tsc --noEmit`
Expected: ผ่าน ไม่มี error

Run: `npm run lint`
Expected: สะอาด ไม่มี warning ใหม่

- [ ] **Step 5: verify UI จริงบน isolated dev server**

```bash
cp dev.db dev-test.db
NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001
```

เปิด `localhost:3001` แท็บ Brief แล้วตรวจ (ใช้ Playwright ใน scratch dir):

1. เลือกสินค้าที่มีรูปสินค้าจริง (มี productImages) — hover รายการใน sidebar เห็นไอคอน **ทำซ้ำ (Copy)** ข้างไอคอนลบ
2. กด "ทำซ้ำ" → เกิด entry ใหม่ที่ **ถูกเลือกอัตโนมัติ** และ **อยู่แท็บ Brief**
3. entry ใหม่: ชื่อสินค้า/ข้อมูล/risk/โน้ต ตรงกับต้นฉบับ · **รูปสินค้าโชว์ครบทุกใบ** (caption ตรง) · เปิดแท็บ "ผลลัพธ์ & คลิป" เห็น 10-part output + caption + hashtag ตรงกับต้นฉบับ · ช่อง video URL **ว่าง** · วันโพสต์ **ว่าง**
4. ลบรูป 1 ใบใน entry ใหม่ → กลับไปดู entry ต้นฉบับ รูป **ไม่หาย** (ไฟล์/แถวแยกกัน)

ตรวจ dev-test.db ด้วยสคริปต์ node + `better-sqlite3` (readonly, absolute path เข้า `node_modules` ของ repo ตาม CLAUDE.md):
- entry ใหม่มี `duplicatedFromId` = id ต้นฉบับ
- มีแถว `ProductImage` ใหม่ผูก `entryId` ใหม่ จำนวนเท่ารูปต้นฉบับ (filename ต่างกัน)

เช็กไฟล์บนดิสก์: `ls uploads/<newId>/` มีไฟล์รูปครบ

หยุด dev server ตัวเอง แล้ว `rm dev-test.db` (โฟลเดอร์ `uploads/<newId>` ที่เกิดตอนเทสต์ลบทิ้งได้ — gitignore อยู่แล้ว ไม่ต้อง commit)

- [ ] **Step 6: เช็ก tsconfig แล้ว commit**

Run: `git diff tsconfig.json`
Expected: ว่าง — ถ้าไม่ว่างให้ `git checkout -- tsconfig.json` ก่อน

```bash
git add app/actions.ts components/history-rail.tsx components/prompt-workspace.tsx
git commit -m "Add ทำซ้ำ (duplicate) action and history-rail button"
```

---

## Self-Review

**Spec coverage:**
- §1 Data model `duplicatedFromId` → Task 1 ✓
- §2 Server Action `duplicatePrompt` (ก๊อปฟิลด์ + ไฟล์รูป + แถว, เคสไฟล์หาย, สดใหม่ videoUrl/วันโพสต์) → Task 2 Step 1 ✓
- §3 UI ปุ่มใน history rail + handler เลือก entry ใหม่ + เด้ง Brief → Task 2 Step 2-3 ✓
- §4 Flow หลังใช้งาน (สลับรูปเองด้วยของเดิม) → ไม่ต้องเขียนโค้ดเพิ่ม (ใช้ลบ/เพิ่มรูปที่มีอยู่) ✓
- Non-goals (ไม่ทำ angle/lineage UI/remodel) → plan ไม่มี task ไหนทำ ✓
- Verification checklist ทั้งหมด → Task 2 Step 5 ✓

**ไม่ต้องแตะ:** `PromptEntry` client type (`prompt-workspace.tsx:35-53`) และ `app/page.tsx` — `duplicatedFromId` ไม่ถูก consume ฝั่ง client การเพิ่มคอลัมน์ nullable ไม่กระทบ query/mapping เดิม

**Placeholder scan:** ไม่มี TBD/TODO · ทุก step ที่แก้โค้ดมีโค้ดเต็ม · verification เป็นคำสั่งจริง + ผลที่คาดหวังเจาะจง · ไม่มี unit test เพราะโปรเจกต์ไม่มี test runner (ระบุใน Global Constraints)

**Type consistency:** `duplicatePrompt(sourceId: string): Promise<string>` ใช้ตรงกันระหว่าง action (Task 2 Step 1) กับ handler (`await duplicatePrompt(id)` Step 3.3) · `onDuplicate: (id: string, event: React.MouseEvent) => void` ตรงกันระหว่าง type ใน history-rail (Step 2.2), การเรียก `onDuplicate(entry.id, event)` (Step 2.3), และ `handleDuplicate` (Step 3.3) · `duplicatedFromId` ตรงกับชื่อคอลัมน์ Task 1

**จุดต้องระวังตอน implement:** ปุ่มทำซ้ำเป็น `<span role="button">` ซ้อนใน `<button>` ของ list item — ตามแพตเทิร์นเดิมของปุ่มลบ (invalid HTML แต่ใช้ทั้งไฟล์อยู่แล้ว) `event.stopPropagation()` ใน `handleDuplicate` กันไม่ให้ไป trigger `onSelect` ของ item
