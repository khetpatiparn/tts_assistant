# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Custom Next.js version

`next` is pinned at `16.2.10`, well beyond any publicly released Next.js version, and ships its own docs bundle at `node_modules/next/dist/docs/` (a normal npm `next` package does not include this). Treat this as a modified/custom build with breaking API changes vs. training data. Before writing App Router code, check `node_modules/next/dist/docs/01-app/` for the current API — do not assume familiar Next.js conventions (routing, data fetching, config) still apply as-is.

## Commands

- `npm run dev` — start the dev server
- `npm run build` — production build
- `npm run start` — run the production build
- `npm run lint` — ESLint (flat config in `eslint.config.mjs`, extends `eslint-config-next` core-web-vitals + typescript rules)

No test runner is configured in this project.

เครื่อง Windows/git-bash นี้ ถ้าจะ kill process ตาม port ต้องใส่ flag แบบ double-slash: `netstat -ano | grep ':3000' | grep LISTENING` แล้วตามด้วย `taskkill //PID <pid> //F` (ใส่ slash เดียวจะโดนแปลงเป็น path แล้ว error)

`start.bat` / `stop.bat` ที่ root ของ repo ใช้ build+รัน / หยุด production server แบบ background ให้ใช้งานได้โดยไม่ต้องเปิด terminal

## Architecture

- App Router under `app/` — currently just `layout.tsx`, `page.tsx`, `globals.css`; no nested routes yet.
- `app/page.tsx` render `<PromptWorkspace>` (Server Component ที่ดึงข้อมูลผ่าน Prisma) ตัว workspace แบ่งเป็น 3 แท็บผ่าน `components/workspace-tabs.tsx` — ① Brief & Script (`brief-form.tsx` + `script-output.tsx`), ② ผลลัพธ์ & คลิป (`production-panel.tsx`), ③ Core Prompt (`core-prompt-panel.tsx`) โดยมี `components/prompt-workspace.tsx` เป็นตัวถือ state ของแท็บและรายการที่เลือก ส่วน `clapper-header.tsx` กับ `history-rail.tsx` แสดงตลอดทุกแท็บ ส่วน mutation ทั้งหมดอยู่ใน `app/actions.ts` (`'use server'`) การเรียงลำดับรายการใน sidebar อยู่ใน `lib/entry-sort.ts` (เรียงตาม `postedAt` — อันที่ยังไม่ได้ลงคลิปอยู่บนสุด แล้วตามด้วยใหม่→เก่า) ส่วนช่องค้นหา/จัดกลุ่มตามเดือน/ตัวกรอง "ยังไม่ได้กรอกผลลัพธ์" เป็น state ภายใน `history-rail.tsx` เองทั้งหมด
- Path alias `@/*` resolves to the repo root (see `tsconfig.json`).
- Styling is Tailwind v4 with CSS-first config: there is no `tailwind.config.*` file — theme tokens (colors, radii, fonts, sidebar/chart variables) are defined via `@theme inline` and `:root`/`.dark` blocks directly in `app/globals.css`.
- shadcn/ui is configured via `components.json`: style `base-nova`, base color `neutral`, icon library `lucide-react`. **Components are built on `@base-ui/react` primitives, not Radix UI** — this differs from most shadcn/ui setups, so when generating or extending components, use Base UI's API/props rather than assuming Radix conventions.
- `lib/utils.ts` exports the standard shadcn `cn()` helper (`clsx` + `tailwind-merge`).
- `components/ui/` holds shadcn-generated primitives (`button.tsx`, `input.tsx`, `textarea.tsx`)
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
