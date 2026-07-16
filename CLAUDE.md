# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Custom Next.js version

`next` is pinned at `16.2.10`, well beyond any publicly released Next.js version, and ships its own docs bundle at `node_modules/next/dist/docs/` (a normal npm `next` package does not include this). Treat this as a modified/custom build with breaking API changes vs. training data. Before writing App Router code, check `node_modules/next/dist/docs/01-app/` for the current API — do not assume familiar Next.js conventions (routing, data fetching, config) still apply as-is.

## Commands

No test runner is configured in this project.

เครื่อง Windows/git-bash นี้ ถ้าจะ kill process ตาม port ต้องใส่ flag แบบ double-slash: `netstat -ano | grep ':3000' | grep LISTENING` แล้วตามด้วย `taskkill //PID <pid> //F` (ใส่ slash เดียวจะโดนแปลงเป็น path แล้ว error)

`start.bat` / `stop.bat` ที่ root ของ repo ใช้ build+รัน / หยุด production server แบบ background ให้ใช้งานได้โดยไม่ต้องเปิด terminal

**ห้ามรัน `npm run build`/`npm run dev` ซ้อนกันหลายตัวพร้อมกันในโฟลเดอร์นี้** (เช่น agent รันพร้อมที่ผู้ใช้เปิด `start.bat` เอง) — `.next` จะเขียนทับกันจนพังแบบ `Cannot find module 'better-sqlite3-...'` ตอน `npm run start` ถ้าเจอ ให้ `rm -rf .next` แล้ว build ใหม่

## Architecture

- `app/page.tsx` render `<PromptWorkspace>` (Server Component ที่ดึงข้อมูลผ่าน Prisma) ตัว workspace แบ่งเป็น 3 แท็บผ่าน `components/workspace-tabs.tsx` — ① Brief & Script (`brief-form.tsx` — มีช่องอัปโหลดรูปสินค้าจริง + `script-output.tsx` — มีปุ่ม "สร้างด้วย AI" กับ dropdown เลือกโมเดล), ② ผลลัพธ์ & คลิป (`production-panel.tsx` — 10-part prompt textarea, Caption/Hashtags fields + ปุ่มคัดลอกทั้งหมด, video URL, posted date), ③ Core Prompt (`core-prompt-panel.tsx` ×2 instances — แยก `kind`: core vs caption) โดยมี `components/prompt-workspace.tsx` เป็นตัวถือ state ของแท็บและรายการที่เลือก ส่วน `clapper-header.tsx` กับ `history-rail.tsx` แสดงตลอดทุกแท็บ ส่วน mutation ทั้งหมดอยู่ใน `app/actions.ts` (`'use server'`) การเรียงลำดับรายการใน sidebar อยู่ใน `lib/entry-sort.ts` (เรียงตาม `postedAt` — อันที่ยังไม่ได้ลงคลิปอยู่บนสุด แล้วตามด้วยใหม่→เก่า) ส่วนช่องค้นหา/จัดกลุ่มตามเดือน/ตัวกรอง "ยังไม่ได้กรอกผลลัพธ์" เป็น state ภายใน `history-rail.tsx` เองทั้งหมด
- Path alias `@/*` resolves to the repo root (see `tsconfig.json`).
- Styling is Tailwind v4 with CSS-first config: there is no `tailwind.config.*` file — theme tokens (colors, radii, fonts, sidebar/chart variables) are defined via `@theme inline` and `:root`/`.dark` blocks directly in `app/globals.css`.
- shadcn/ui is configured via `components.json`: style `base-nova`, base color `neutral`, icon library `lucide-react`. **Components are built on `@base-ui/react` primitives, not Radix UI** — this differs from most shadcn/ui setups, so when generating or extending components, use Base UI's API/props rather than assuming Radix conventions.
- `lib/utils.ts` exports the standard shadcn `cn()` helper (`clsx` + `tailwind-merge`).
- Design tokens ที่กำหนดเอง (สีชื่อ `ink`/`paper`/`marigold`/`rust`/`smoke`/`record`, ฟอนต์ `Chonburi`/`IBM Plex Sans Thai`/`JetBrains Mono`) อยู่ใน `app/globals.css` และ `app/layout.tsx` — ให้ใช้ของเดิม อย่าเพิ่มสี/ฟอนต์ใหม่ขึ้นมาเอง
- Layout เป็น fixed-viewport-with-internal-scroll (header คงที่ + sidebar/เนื้อหาสกรอลแยกกันเองที่ `lg:` ขึ้นไป) — จุดสำคัญคือ **`body` ใน `app/layout.tsx` ต้องมี `lg:h-full lg:overflow-hidden` ด้วย ไม่ใช่แค่ inner div** เพราะ flex child ที่มี `flex-1` จะดันความสูงของ ancestor ที่มีแค่ `min-height` ให้ยืดเกิน viewport ได้ ถ้าจะแก้/เพิ่ม scroll region ใหม่ ต้องเช็กทั้ง chain ตั้งแต่ `body` ลงมา

## Database

- ใช้ SQLite ผ่าน Prisma 7 (`@prisma/adapter-better-sqlite3` + `better-sqlite3`) — Prisma 7 บังคับต้องใช้ driver adapter แล้ว ต่อ connection string ตรงๆ แบบเดิมไม่ได้
- datasource URL อยู่ใน `prisma.config.ts` (ไม่ใช่ `schema.prisma`) โหลดผ่าน `dotenv/config`
- generated client (`lib/generated/prisma/`, ถูก gitignore) **ไม่มี index barrel** — ต้อง import จาก `@/lib/generated/prisma/client` โดยตรง ไม่ใช่ import จาก directory เฉยๆ
- ตัว adapter class ชื่อ export คือ `PrismaBetterSqlite3` (สังเกตตัวพิมพ์เล็ก-ใหญ่ให้ดี) จาก `@prisma/adapter-better-sqlite3`
- หลังแก้ `prisma/schema.prisma` ให้รัน `npx prisma migrate dev --name <name>` แล้วตามด้วย `npx prisma generate`
- เช็ก/เคลียร์ข้อมูล local: `npx prisma db execute --stdin <<< "SELECT/DELETE ..."` กับ `dev.db`
- **ห้ามรัน `DELETE FROM <table>;` แบบไม่มี `WHERE`** ตอนเคลียร์ข้อมูลทดสอบ — `dev.db` ไม่มี backup/WAL และถูก gitignore ไว้ ลบไปแล้วกู้คืนไม่ได้ ให้ระบุ `WHERE` เจาะจงแถวที่ตัวเองสร้างทดสอบเท่านั้น (เช่น `WHERE productName = '...'`)
- `CorePrompt` เก็บ core prompt แบบมีเวอร์ชัน มี `isActive` ได้ทีละอันเดียว (บังคับผ่าน transaction ใน `app/actions.ts`) — ตอนสร้าง `PromptEntry` ใหม่ระบบจะผูกเวอร์ชันที่ active อยู่ให้อัตโนมัติ
- `CorePrompt` แยกชนิดด้วยคอลัมน์ `kind` — `core` (สร้างวิดีโอ) กับ `caption` (SEO prompt) **active ได้ทีละอันต่อ kind** ห้ามลืมใส่ `kind` ใน `where` ของ transaction ไม่งั้นการเพิ่มเวอร์ชันฝั่งหนึ่งจะไปปิด active ของอีกฝั่ง เนื้อหาตั้งต้นของ SEO prompt อยู่ที่ `prisma/seed/seo-prompt-v1.md` seed ด้วย `node prisma/seed/seed-seo-prompt.mjs` (idempotent)
- **กฎเดียวกันนี้ใช้กับทุก query ที่อ่าน `isActive: true` ด้วย ไม่ใช่แค่ตอนเขียน** — `findFirst({ where: { isActive: true } })` แบบไม่ใส่ `kind` จะได้แถวมั่วเมื่อมี 2 kind active พร้อมกัน (เคยพังเงียบมาแล้ว 2 จุดคือใน `generateWithAI` และ `createPrompt` ก่อนถูกแก้)
- `ProductImage` เก็บแค่ metadata ของรูปสินค้าจริง — ตัวไฟล์อยู่บนดิสก์ที่ `uploads/<entryId>/` (gitignore ไว้) เสิร์ฟกลับผ่าน `app/api/uploads/[...path]/route.ts` ลบ entry แล้วแถวรูปหายตาม (`onDelete: Cascade`) แต่ไฟล์บนดิสก์ไม่ได้ถูกลบ

## Gemini API (ปุ่ม "สร้างด้วย AI")

- แอปเรียก Gemini เองผ่าน `@google/genai` (ไม่ใช่ `@google/generative-ai` ตัวเก่า) — `lib/gemini.ts` เป็นไฟล์เดียวที่รู้จัก SDK, `lib/few-shot.ts` เลือกตัวอย่างเก่ามา 2 อัน, `generateWithAI(entryId, model)` ใน `app/actions.ts` เป็นตัวประกอบทั้งหมดแล้วบันทึกลง `chatgptOutput`
- **API ตัวนี้ใช้ snake_case**: `system_instruction` (ไม่ใช่ `systemInstruction`) และ `temperature` อยู่ใน `generation_config` — สะกดผิดแล้ว API **เงียบ** ไม่ error แต่ Core Prompt จะไม่ถูกส่งไปเลย ห้ามเดา shape ให้อ่าน `CreateModelInteraction` ใน `node_modules/@google/genai/dist/genai.d.ts` และห้ามกลบด้วย `as any`
- **รายชื่อโมเดลอยู่ที่เดียวคือ `GEMINI_MODELS` ใน `lib/gemini.ts`** — dropdown สร้างจากตัวนี้ และ Server Action ก็ validate ด้วยตัวนี้ (โมเดลส่งมาจาก client เชื่อไม่ได้) ตอนนี้มี `gemini-3.1-flash-lite` (default, ~15 วิ) กับ `gemini-3.5-flash` (~54 วิ ยาว/ละเอียดกว่า) โควตา free tier แยกคนละ pool กัน ดูตัวเลขจริงที่ `https://aistudio.google.com/rate-limit`
- อัปโหลดรูปวิ่งผ่าน Server Action ซึ่ง**จำกัด body 1MB by default** — `next.config.ts` เลยตั้ง `experimental.serverActions.bodySizeLimit` ไว้ ถ้ารูปใหญ่ขึ้นต้องขยายตรงนี้ ไม่ใช่ที่ action
- `GEMINI_API_KEY` อยู่ใน `.env` (gitignore แล้ว) — **ห้าม commit เด็ดขาด** และเวลาแก้ `.env` ระวังไฟล์ไม่มี newline ปิดท้าย (เคย append แล้วไปต่อท้ายบรรทัด key จน key พัง)
- เส้นทาง manual เดิม (คัดลอก prompt ไปวางในแชทเอง แล้ว paste คำตอบกลับ) ยังใช้ได้ปกติ — เป็น fallback ตอน API ล่มหรือโควตาหมด
- ปุ่ม "สร้างด้วย AI" ทำงาน 2 ขั้นใน action เดียว: (1) รูป+บรีฟ+Core Prompt → 10-part prompt ด้วยโมเดลที่ผู้ใช้เลือก (2) 10-part prompt (ข้อความล้วน ไม่ส่งรูป) + SEO Prompt → Caption/Hashtags ด้วย `CAPTION_MODEL` = `gemini-3.1-flash-lite` **เสมอ** (โควตาแยก pool และ 3.5-flash มีแค่ 20 ครั้ง/วัน)
- **ขั้น 1 ต้องบันทึกลง DB ก่อนขั้น 2 เสมอ และขั้น 2 ห้าม throw** — `generateWithAI` คืน `{ captionError }` แทน ถ้า throw ก่อน `revalidatePath` หน้าเว็บจะไม่เห็น 10-part prompt ที่บันทึกไปแล้ว
- `lib/caption.ts` แยกคำตอบเป็น caption/hashtags ถ้าโมเดลตอบผิดฟอร์แมตจะยัดทั้งก้อนลง caption ไม่ทิ้งของ

## Dashboard รายได้ (แท็บ ④)

- ตาราง `AffiliateOrder` เก็บออเดอร์ระดับต่อออเดอร์ (dedup ด้วย `orderId`) นำเข้าจากไฟล์ xlsx ที่ผู้ใช้โหลดเองจาก TikTok Studio (ไม่มี API — โหลดมือเท่านั้น)
- `lib/affiliate.ts` เป็นไฟล์เดียวที่รู้จัก SheetJS (`xlsx`) — parse ด้วย `sheet_to_json({header:1, raw:false})` อ้างคอลัมน์ตาม index (ไฟล์ใช้ inline strings ไม่มี sharedStrings, วันที่รูปแบบ `DD/MM/YYYY HH:MM:SS`) คอลัมน์ที่ใช้: 0=orderId 2=ชื่อ 3=รหัสสินค้า 5=จำนวน 13=สถานะ 17=รหัสเนื้อหา 23=GMV 34=ค่าคอมจริง 44=รายได้สุดท้าย 45=วันที่
- **จับคู่ออเดอร์กับคลิปด้วย content ID (col 17) = video id ใน `PromptEntry.videoUrl`** (ดึงด้วย `videoIdFromUrl`) ห้ามจับด้วยชื่อสินค้า — สินค้าเดียวมีได้หลายคลิป
- **GMV ≠ เงินจริง** — `summarizeOrders` แยก `totalGmv` (ทุกสถานะ) กับ `settledRevenue` (`finalRevenue` ที่ settle แล้ว) สถานะจ่ายแล้ว = `PAID_STATUS` (`"ชำระแล้ว"`)
- `lib/dashboard.ts` เป็น aggregation ล้วน (pure) · กราฟใน `components/revenue-charts.tsx` วาดเองด้วย SVG ไม่มี chart library · reminder banner เตือนเมื่อข้อมูลเก่า >7 วัน / มีคลิปยังไม่มีรายได้ / มีสินค้าขายได้ที่ยังไม่มี entry
- ไฟล์ตัวอย่างจริง `affiliate_orders_*.xlsx` gitignore ไว้ — ห้าม commit
- ส่วนเงินแยก "เงินที่ได้จริง" (`settledRevenue`) เป็นพระเอก กับ "กำลังรอ" (`pendingGmv` + `estimatedPendingCommission` = pendingGmv × อัตราจริง) — ไม่โชว์ GMV รวมเป็นหัวอีก (`summarizeOrders` ใน `lib/dashboard.ts` คืน field แยกครบ)
- thumbnail คลิปมาจาก **TikTok oEmbed** (สาธารณะ ไม่ต้อง auth) — `lib/tiktok-oembed.ts` ไฟล์เดียวที่รู้จัก endpoint, cache ในตาราง `VideoThumbnail` (เก็บแม้ล้มเหลว ok=false กันยิงซ้ำ), resolve ผ่าน Server Action `resolveThumbnail` (client เรียก lazy), fallback เป็นไอคอนเมื่อคลิปโดนลบ — นี่คือการยิงเน็ตออกนอกเครื่องที่เดียวของแอป
- `createEntryFromOrder` สร้าง entry ขั้นต่ำจากออเดอร์ที่ยังไม่มีในแอป แล้ว `updateMany` ผูก `matchedEntryId` ให้ทันที
- **ธีม dashboard ทำเป็นกลางๆ ไม่ใส่ motif คลปเปอร์บอร์ด** (ผู้ใช้กำลังจะเลิกธีมหนัง — การเปลี่ยนชื่อ+re-theme ทั้งแอปเป็นโปรเจกต์แยก)
- `revenueByClip` (ราย-คลิปใน `components/revenue-by-clip.tsx`) ต้องแบ่งเงินแบบ 3 ทาง (จ่ายแล้ว/รอ/ไม่มีสิทธิ์) **ให้ตรงกับ `summarizeOrders` เสมอ** — เคยพลาดโยนออเดอร์ "ไม่มีสิทธิ์" ไปปนกับ "รอ" มาแล้ว ถ้าแก้ตรรกะแบ่งเงินฝั่งใดฝั่งหนึ่ง ต้องเช็กอีกฝั่งด้วย
- แถบเตือน (`reminder-banner.tsx`) แสดงเฉพาะในแท็บ dashboard เท่านั้น (ไม่อยู่ที่ header อีกต่อไป) — ที่แท็บ ④ เองมีจุดแดงเล็กๆ บอกสถานะ (`workspace-tabs.tsx` รับ prop `dashboardAlert` จาก `reminderActive` เดิม) ส่วนข้อความในแบนเนอร์บอกชื่อคลิปที่รอจริง (`awaitingClips`) ไม่ใช่แค่ตัวเลข

## Testing / verification

- โปรเจกต์นี้ไม่มี test runner ให้ verify การเปลี่ยนแปลงด้วยการรันจริง: `npm run build` (type-check ด้วยในตัว) + `npm run lint` แล้วไล่ทดสอบผ่าน Playwright — ตัวนี้ไม่ได้เป็น dependency ของโปรเจกต์ ต้องติดตั้งแยกใน scratch dir เอง แล้วชี้ไปที่ `npm run dev`/`npm run start` พร้อม screenshot ตรวจสถานะสำคัญๆ
- Server Actions, `revalidatePath`, และ `<form action={...}>` ใน Next.js เวอร์ชันกำหนดเองนี้ทำงานเหมือน App Router เวอร์ชัน v15 คลาสสิกทุกอย่าง — ตรวจสอบกับ `node_modules/next/dist/docs/` แล้ว ไม่ต้องเช็กซ้ำสำหรับงาน CRUD/form ทั่วไป

## Product spec

`requirements/req1.md` (ภาษาไทย) เป็น source-of-truth ของสเปกผลิตภัณฑ์ — ให้ไปอ่านตรงนั้นสำหรับรายละเอียดเต็ม ตอนนี้แอป implement ตามสเปกแล้ว: `lib/prompt-template.ts` ประกอบข้อความ Core Prompt, `app/actions.ts` บันทึกข้อมูลลง DB สรุป: แอปนี้เป็นเครื่องมือสร้าง prompt สำหรับ AI video generation ของวิดีโอ TikTok Shop (ตัว generator เป้าหมายคือ "Gemini Flow") จาก "Core Prompt" input template (รูปสินค้าอ้างอิง + ข้อมูลร้านค้า + "Product Risk Module" + โน้ตเพิ่มเติม)

The generated output must follow a strict 10-part structure: Style, Scene, Subject, Product Accuracy, Action Timeline, Camera, Framing, Lighting/Color, Negative Prompt, Quick QA Checklist. Key content rules to preserve when working on prompt-generation logic:
- No on-screen text/subtitles/labels/UI overlays/prices in the generated video.
- Thai voiceover only, 3–5 short phrases, ~30–35 words max total, with a hook in the first 1–2 seconds and no dead air.
- Product must appear within 1–2 seconds with clear movement.
- 3–4 visual beats for higher-risk/mechanism products (e.g. foldable/expandable items), 4–5 beats for lower-risk products, sized for a 10-second clip.
- Liquid products (fabric softener, dish soap, etc.) should avoid showing liquid directly and instead use "package-led UGC" (package as hero, before/after style), since real liquid reference photos are usually unavailable.
