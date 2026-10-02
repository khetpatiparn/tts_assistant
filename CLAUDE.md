# CLAUDE.md

@AGENTS.md

แอป **Angle**: ผลิตคลิป AI ขายสินค้า affiliate บน TikTok Shop — สร้าง 10-part prompt ให้ Google Flow, บอทวาดรูป/เรนเดอร์คลิปใน Flow, ดูรายได้ย้อนกลับ · คำศัพท์ของโดเมนอยู่ `CONTEXT.md` · การตัดสินใจเชิงสถาปัตย์อยู่ `docs/adr/` · สเปกผลิตภัณฑ์อยู่ `requirements/req1.md`

## ระบบย่อย — อ่านไฟล์ของระบบก่อนแตะ

- **Flow bot** (`worker/`, `/flow`, `FlowJob`/`FlowActivity`, `flow-worker.config.json`, Render คลิป, ส่งเข้าโฟลเดอร์ TTS) → `docs/agents/flow-bot.md`
- **Prompt generation** (`lib/gemini.ts`, `lib/prompt-template.ts`, `generateWithAI`, Core Prompt / `CorePrompt`, angle, 10-part structure) → `docs/agents/gemini-prompting.md`
- **Revenue dashboard** (`/dashboard`, `AffiliateOrder`, นำเข้าไฟล์ TikTok Studio, `lib/dashboard.ts`, `lib/recommender.ts`) → `docs/agents/dashboard.md`
- **Showcase** (`showcase-extension/`, `/api/scanner`, `/showcase`, `/products`, `ProductCandidate`) → `docs/agents/showcase.md`

## Custom Next.js version

`next` is pinned at `16.2.10`, well beyond any publicly released Next.js, and ships its own docs at `node_modules/next/dist/docs/`. Treat it as a custom build with breaking API changes: before writing App Router code (routing, data fetching, config), check `node_modules/next/dist/docs/01-app/`. Already verified: Server Actions, `revalidatePath` and `<form action={...}>` behave like classic v15 App Router — ordinary CRUD/form work needs no re-check.

## ทำงานข้างแอปที่ผู้ใช้เปิดใช้อยู่ (ทุกงาน)

ผู้ใช้เปิด `start.bat` ทำคลิปหาเงินทุกวัน: production server พอร์ต 3000 + `.next` + `dev.db` + บอท Flow เป็นของเขา — agent ทำงานคู่ขนานโดยไม่ขอให้ปิด (บล็อกเขา = เขาเสียรายได้) ลำดับการตรวจงาน:

1. **type/lint (พอสำหรับงานส่วนใหญ่):** `npx tsc --noEmit` + `npm run lint` — ไม่เขียน `.next`
2. **ดู UI จริง — ใช้ DB สำเนาและพอร์ต 3001:** `cp dev.db dev-test.db` → `node scripts/enable-wal.mjs dev-test.db` →
   ```bash
   NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001
   ```
   (`distDir` อ่านจาก `NEXT_DIST_DIR` ใน `next.config.ts` · dotenv ไม่ override env จาก shell · `.next-dev`/`dev-test.db` gitignore แล้ว) — ทดสอบกับ `dev-test.db` เสมอ เคยมีแถวทดสอบ ("สินค้าทดสอบ caption") ค้างในข้อมูลจริง
3. **`npm run build` เต็มรูปแบบ** เฉพาะตอนปิดงาน/ก่อน merge และเฉพาะเมื่อพอร์ต 3000 ว่าง — ไม่ว่างให้ถามผู้ใช้ (process บนพอร์ต 3000 ผู้ใช้เป็นคนปิดเอง)

- **หนึ่งโฟลเดอร์ `.next*` = build/dev ทีละตัว** — ซ้อนกันจะพังเป็น `Cannot find module 'better-sqlite3-...'` ตอน `npm run start` แก้ด้วย `rm -rf .next` แล้ว build ใหม่
- **`tsconfig.json` ถูก Next แก้เอง** ตอน dev ครั้งแรก (auto-patch compiler options) และตอน build ด้วย `NEXT_DIST_DIR` อื่นที่ไม่ใช่ `.next`/`.next-dev` (เพิ่ม `<dist>/types/**`) → `git diff tsconfig.json` ก่อน commit ทุกครั้ง ถ้าเปลี่ยนให้ `git checkout -- tsconfig.json` · `target: "ES2017"` pin ไว้ตั้งใจ (BigInt ใช้ `BigInt(32)` เพราะ literal `32n` ต้อง ES2020+)
- **คำสั่งที่แก้ `dev.db` จริง (เช่น `prisma migrate deploy`) ผู้ใช้เป็นคนรัน** — auto-mode classifier ปฏิเสธ (มองเป็น production deploy) · ให้ผู้ใช้ `stop.bat` ก่อน (`next start` ที่ยังเปิดทำให้ `database is locked` หยุดแค่บอทไม่พอ) แล้วรันเองด้วย `! <command>` หลัง `cd` ไป root ของ repo (cwd ของเซสชันอาจค้างใน `showcase-extension/`)

## Commands และ gotcha ของเครื่อง Windows/git-bash

- ไม่มี test runner — ตรวจด้วย tsc/lint + สคริปต์ pure `scripts/check-*.mjs` ของแต่ละระบบ (`npm run check:flow` รวมของ Flow) + Playwright (เป็น dependency ของ repo แล้ว)
- kill process ตามพอร์ต (ของที่ตัวเองเปิด เช่น 3001): `netstat -ano | grep ':3001' | grep LISTENING` แล้ว `taskkill //PID <pid> //F` — flag ต้อง double-slash (slash เดียวโดนแปลงเป็น path)
- สคริปต์ standalone ที่อ่าน DB ตรง: เขียนเป็นไฟล์ `.js` จริงด้วย Write tool (`node -e "..."` ผ่าน git-bash ทำ path ใน string พัง) · `require()` resolve ตามตำแหน่งไฟล์สคริปต์ ไม่ใช่ CWD → สคริปต์นอก repo (scratch) ต้อง `require()` ด้วย absolute path เข้า `node_modules` ของ repo
- **`start.bat` / `stop.bat`** (root): build+รัน production server + บอท Flow แบบหน้าต่างซ่อน / หยุดทั้งคู่ · output ของ server อยู่ `pp-server.log` บอทอยู่ `flow-worker.log` (gitignore) — หา error ของ production ที่นั่น
- **`start.bat` build ใหม่เฉพาะเมื่อโค้ดแอปเปลี่ยน** (`scripts/build-if-changed.mjs`): ลายนิ้วมือจาก git tree + diff + ไฟล์ untracked ใต้ `app/ components/ lib/ prisma/ public/` + config ที่ root เก็บที่ `.next/build-fingerprint.txt` — แก้แค่ `docs/`/`worker/`/`showcase-extension/` ไม่ build ใหม่ · **บังคับ build ใหม่ = ลบ `.next`** (จำเป็นหลัง `npx prisma generate` ที่ schema ไม่เปลี่ยน เพราะ `lib/generated/` ถูก gitignore) · ทดสอบสคริปต์: `NEXT_DIST_DIR=.next-test node scripts/build-if-changed.mjs --dry-run` (แล้วคืน `tsconfig.json`)
- **`.env` (gitignore):** `GEMINI_API_KEY`, `TYPESAFE_API_KEY` — เป็นความลับ อยู่นอก commit เสมอ · ตอน append ให้แน่ใจว่าบรรทัดสุดท้ายมี newline ก่อน (เคยต่อท้ายบรรทัด key จน key พัง)

## Database (SQLite + Prisma 7)

- Prisma 7 บังคับ driver adapter: `PrismaBetterSqlite3` (ตัวพิมพ์ตามนี้) จาก `@prisma/adapter-better-sqlite3` + `better-sqlite3` · datasource URL อยู่ `prisma.config.ts` (โหลดผ่าน `dotenv/config`) ไม่ใช่ `schema.prisma`
- generated client `lib/generated/prisma/` (gitignore) ไม่มี index barrel → import จาก `@/lib/generated/prisma/client`
- แก้ `prisma/schema.prisma` → `npx prisma migrate dev --name <name>` → `npx prisma generate` (กับ DB ทดสอบ)
- **หลัง merge branch ที่แก้ schema เข้า `master`:** ผู้ใช้ `stop.bat` แล้วรัน `npx prisma migrate deploy` → `npx prisma generate` ที่ root (ตามหัวข้อบน) — `dev.db` และ generated client ถูก gitignore จึงไม่มากับ merge ข้ามขั้นนี้ = `start.bat` build ไม่ผ่าน / แอปพังเพราะไม่มีคอลัมน์ใหม่
- **WAL เปิดอยู่** (worker ของบอทกับ Next เขียนพร้อมกันได้) — มี `dev.db-wal`/`dev.db-shm` ข้างๆ เสมอ · backup = ก๊อปทั้ง 3 ไฟล์ หรือ `PRAGMA wal_checkpoint(TRUNCATE)` ก่อนก๊อป · ไฟล์ db ใหม่รัน `node scripts/enable-wal.mjs <file>` หนึ่งครั้ง
- เช็ก/เคลียร์ข้อมูล: `npx prisma db execute --stdin <<< "SELECT ..."` · **ทุก `DELETE` มี `WHERE` เจาะจงแถวที่ตัวเองสร้าง** (เช่น `WHERE productName = '...'`) — `dev.db` ไม่มี backup อัตโนมัติ (WAL คือโหมด concurrency ไม่ใช่ backup) `DELETE FROM <table>;` ลบแล้วกู้ไม่ได้
- **ไฟล์อัปโหลดอยู่ใต้ `uploads/` (gitignore) และ path มาจาก `lib/upload-paths.ts` เท่านั้น** (`UPLOAD_ROOT`, `CANDIDATE_IMAGE_ROOT`, `joinPath`) — `path.join(process.cwd(), "uploads", ...)` หรือ `${uuid}.${ext}` ตรงใน `writeFile`/`copyFile` ทำให้ Turbopack ไล่ไฟล์ทั้งโฟลเดอร์ (warning "Overly broad patterns") และลากหลายหมื่นไฟล์เข้า trace ของทุก route · `outputFileTracingExcludes` ใน `next.config.ts` ตัด `uploads/` อีกชั้น (trace ต่อ route 3,874 → 206 ไฟล์)
- `ProductImage` เก็บแค่ metadata ไฟล์อยู่ `uploads/<entryId>/` เสิร์ฟผ่าน `app/api/uploads/[...path]/route.ts` · ลบ entry แล้วแถวรูปหายตาม (`onDelete: Cascade`) แต่ไฟล์บนดิสก์ยังอยู่
- กฎของตารางเฉพาะระบบ (`CorePrompt` ต้องกรอง `kind`, angle ใช้ `duplicatedFromId`) อยู่ใน `docs/agents/gemini-prompting.md`

## Architecture

- **Routes:** `/` รายการสินค้า (`components/entry-list.tsx` — ค้นหา/กรองสถานะ/แบ่งหน้าเก็บใน URL ไม่ใช่ React state) · `/entry/[id]`, `/entry/new` หน้าทำงานต่อ entry (`components/entry-workspace.tsx` ถือ state ของแท็บย่อย ① Brief & Script (`brief-form.tsx` + `script-output.tsx`) และ ② ผลลัพธ์ & คลิป (`production-panel.tsx`) ผ่าน `workspace-tabs.tsx` · แถบข้าง `history-rail.tsx` = 15 รายการล่าสุด) · `/dashboard` (`dashboard-route.tsx` ห่อ `dashboard-panel.tsx`) · `/core-prompt` (`core-prompt-panel.tsx` ×2 แยก `kind`: core vs caption) · `/flow`, `/showcase`, `/products` (ดูระบบย่อย) · `components/app-header.tsx` = ตัวนำทางร่วม · `entry-header.tsx` เฉพาะหน้า entry
- **ข้อมูล:** คิวรีของหน้ารายการ/entry อยู่ `lib/entry-queries.ts` (pure ของสถานะ/ค้นหา/แบ่งหน้าอยู่ `lib/entry-rows.ts`) · เรียงตาม `postedAt` ใน `lib/entry-sort.ts` (ยังไม่ลงคลิปอยู่บนสุด แล้วใหม่→เก่า) · **mutation ทั้งหมดอยู่ `app/actions.ts` (`'use server'`) และแต่ละ action `revalidatePath` เจาะจง route ที่มันกระทบจริง** (ดูคอมเมนต์ในไฟล์)
- Path alias `@/*` → repo root · `lib/utils.ts` มี `cn()` (`clsx` + `tailwind-merge`)
- shadcn/ui (`components.json`: style `base-nova`, base color `neutral`, icons `lucide-react`) **สร้างบน `@base-ui/react` ไม่ใช่ Radix** — ใช้ API/props ของ Base UI
- **Layout = fixed viewport + scroll ภายใน** (header คงที่ + sidebar/เนื้อหาสกรอลแยกกันที่ `lg:` ขึ้นไป) — `body` ใน `app/layout.tsx` ต้องมี `lg:h-full lg:overflow-hidden` ด้วย (flex child `flex-1` ดัน ancestor ที่มีแค่ `min-height` ให้สูงเกิน viewport) · แก้/เพิ่ม scroll region ให้เช็กทั้ง chain ตั้งแต่ `body`
- **วันที่ 2 คลาส ห้ามสลับ helper:** `toDateInputValue` (UTC — สำหรับ `postedAt` ที่เก็บเป็น UTC midnight) กับ `toLocalDateInputValue` (local — สำหรับ timestamp จริงเช่น `createdAt`) ใน `production-panel.tsx` — ใช้ผิดตัววันเพี้ยน 1 วันสำหรับเวลาก่อน 7 โมงเช้าไทย

## UI rules

- **Tailwind v4 CSS-first** (ไม่มี `tailwind.config.*`) — token ทั้งหมดอยู่ `app/globals.css` (`@theme inline` + `:root`) เป็น 3 ชั้น: primitive OKLCH `--navy-*`/`--brass-*`/`--green-*`/`--red-*` → semantic `--background`/`--surface`/`--primary`/… → คอมโพเนนต์
- สลับสว่าง/มืดด้วย attribute `data-theme` บน `<html>` (token มืดอยู่ `:root[data-theme="dark"]` ไม่ใช่ class `.dark`) ตาม `node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md` · สคริปต์กันกระพริบอยู่ `<head>` ของ `app/layout.tsx` · `components/theme-toggle.tsx` อ่าน/เขียน DOM ตรงโดยไม่มี React state (ตั้งใจ)
- ฟอนต์: **Noto Sans Thai** ทั้งไทยและละติน · **JetBrains Mono เฉพาะตัวเลขที่เรียงเป็นคอลัมน์** (ไม่มี glyph ไทย)
- ① ขนาดตัวอักษรใช้ scale `text-xs` (12px คือพื้นต่ำสุด) / `sm` / `base` / `lg` / `xl` / `2xl` / `3xl` เท่านั้น ไม่ใช้ arbitrary `text-[...]`
- ② สีใน `components/*` มาจาก token เท่านั้น ไม่มี hex · ชื่อสี alias เก่า (`--teal`/`--paper`/`--ink`/`--smoke`/`--amber`/`--danger` และ class อย่าง `bg-teal`) ลบไปแล้ว — โผล่กลับมาในโค้ด = มีคนเพิ่มกลับโดยไม่ตั้งใจ (เช็ก: `grep -rn -E '\b(bg|text|border|ring|fill|stroke|from|to|via)-(teal|paper|ink|smoke|amber|danger)\b' components app lib`)
- ③ **`--border` = เส้นคั่นตกแต่ง · `--border-interactive` = ขอบของสิ่งที่กดได้ (ต้องผ่าน 3:1)** — token ละหน้าที่ (ใช้ตัวเดียวสองหน้าที่คือเหตุที่ธีมเก่าแยกไม่ออกว่าอะไรกดได้)
- ④ ข้อความไทย: `line-height` ≥ 1.6 · ตัวอักษรปกติ ไม่ใช้ `tracking-widest`/`uppercase`
- ⑤ **ปุ่มสูง ≥ 44px ที่ต่ำกว่า `lg:`** คุมที่บล็อก `size` ใน `components/ui/button.tsx` ที่เดียว: ต่ำกว่า `lg:` ทุก variant เป็น `h-11`/`size-11` · ที่ `lg:` แต่ละ variant ใช้ขนาดเดิมของมัน: `default` → `lg:h-9`, `xs`/`sm` → `lg:h-8`, `lg` → `lg:h-10`, `icon` → `lg:size-9`, `icon-xs`/`icon-sm` → `lg:size-8`, `icon-lg` → `lg:size-10` · ปุ่มที่เขียนความสูงเองนอก `buttonVariants` คู่ `h-11`/`size-11` กับค่า `lg:` ของ variant เดิมของปุ่มนั้น · เป้าคลิกไอคอน 24×24px
- **`node scripts/check-contrast.mjs` = test เดียวของธีม** (อ่านค่าจริงจาก `globals.css` ตรวจทุกคู่สีตาม WCAG) — รันให้ผ่านทุกครั้งที่แก้สี · ตกเกณฑ์ให้ปรับค่า `L` ของ primitive เกณฑ์ในสคริปต์คงไว้ตามเดิม
- **Responsive:** breakpoint `base` โทรศัพท์ · `md:` แท็บเล็ต 2 คอลัมน์ · `lg:` เดสก์ท็อป — **เลย์เอาต์ `lg:`/1440px คือสิ่งที่ผู้ใช้ทำงานทุกวัน คงไว้ตามเดิม และเป็น checkpoint บังคับทุกครั้งที่แก้ UI**
  - `node scripts/shot.mjs <outDir>` ถ่ายทุกหน้าที่ 390/820/1440px และ fail ถ้าหน้าสกรอลแนวนอน · ตั้ง `PW_ROOT` = root ของ repo (มี `node_modules/playwright`) และ `ENTRY_ID` = cuid จริงจาก `dev-test.db`
  - Playwright context ต่ำกว่า 1024px ตั้ง `hasTouch: true` — จับบั๊กคลาส hover-only (`group-hover`, `title=`) ที่เคยทำเมนูทำซ้ำ/ลบและคำเตือนหน้าหาสินค้าหายบนมือถือ
