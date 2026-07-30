# Rebrand: "Angle by LAGR" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** รีแบรนด์แอปทั้งตัวจาก "Pooling Prompt" ธีมคลปเปอร์บอร์ด/หนัง เป็น "Angle by LAGR" ด้วย palette "Dusk Market" — สี, ฟอนต์, ระบบปุ่ม/badge ที่สม่ำเสมอทั้งแอป, และถอดคำศัพท์ธีมหนังออกทั้งหมด

**Architecture:** โทเคนสี (CSS custom properties) **เปลี่ยนทั้งชื่อและค่า** ไม่ใช่แค่ค่า — เพราะการคงชื่อ `marigold` ไว้แต่ให้ค่าเป็นสีเทียลจะทำให้โค้ดอ่านยากในระยะยาว (ตัวแปรชื่อ marigold แต่สีเป็นเทียล) การเปลี่ยนชื่อ token แปลว่าต้อง sweep เปลี่ยนชื่อ Tailwind utility class (`bg-marigold`→`bg-teal` ฯลฯ) ทั่วทั้งแอปด้วย แต่เพราะ shadcn Button component ที่มีอยู่แล้วใช้ semantic layer (`--primary`/`--secondary`/`--destructive`) ซึ่งตรงกับระบบ 5 variant ที่สเปกต้องการเกือบพอดีอยู่แล้ว งานหลักจึงไม่ใช่เขียน component ใหม่ทั้งหมด แต่คือ (1) รีแมปค่า/ชื่อ token (2) ปรับ Button variant เล็กน้อย (3) สร้าง Badge component ใหม่ (4) กวาดเปลี่ยนปุ่ม/badge ที่เขียน className เองแยกจากกันทั่วแอปให้มาใช้ระบบเดียว (5) ถอดคำศัพท์ธีมหนัง

**Tech Stack:** Next.js 16.2.10 (custom build) · React 19 · Tailwind v4 CSS-first · shadcn/ui บน `@base-ui/react` · lucide-react v1.23.0 · next/font/google

**Spec:** `docs/superpowers/specs/2026-07-30-rebrand-angle-design.md`

## Global Constraints

- **ห้ามรัน `npm run build` หรือ `npm run dev` บนพอร์ต 3000** — ผู้ใช้รัน `start.bat` อยู่และใช้แอปทำงานหาเงินจริงทุกวัน ใช้ `npx tsc --noEmit` แทน build · ถ้าต้องรันแอปให้ใช้ isolated dev server เท่านั้น: `cp dev.db dev-test.db` แล้ว `NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001` แล้ว cleanup ด้วย `rm -rf .next-dev dev-test.db`
- **ห้ามแตะ `dev.db` ตัวจริงในการทดสอบที่มีการเขียน** — อ่านแบบ `readonly: true` ได้
- **ไม่มี test runner ในโปรเจกต์** ทดสอบ contrast ratio ด้วยสคริปต์ node ธรรมดา (ไม่ต้องคอมไพล์ TypeScript เพราะเป็นแค่คณิตศาสตร์ล้วน)
- **ห้ามใช้ `node -e "..."` ผ่าน bash สำหรับสคริปต์ที่มี path ฝังอยู่** — เขียนเป็นไฟล์ `.js` จริงด้วย Write tool ในโฟลเดอร์ scratch เสมอ
- **ห้าม emoji** ทุกที่ · ข้อความ UI เป็นภาษาไทย
- **`git diff tsconfig.json` ต้องว่างก่อน commit ทุกครั้ง** ถ้าไม่ว่างให้ `git checkout -- tsconfig.json`
- **ห้าม `git add -A`** — ระบุไฟล์ที่แก้เสมอ
- ทำงานบน branch `feature/rebrand-angle` (สร้างแล้ว spec commit อยู่บนนั้น)
- **ห้ามแตะ `prisma/schema.prisma`** — งานนี้เป็น UI/CSS/copy ล้วน
- **ห้ามเปลี่ยนตรรกะ query/filter/pagination/sort ใดๆ** ที่ทำเสร็จในสองแบรนช์ก่อนหน้า (route-split, list-page-ux-polish) — แก้แค่สี/ฟอนต์/component/คำศัพท์
- **ไอคอน lucide ต้องชื่อ canonical** — เปิดไฟล์ `node_modules/lucide-react/dist/esm/icons/<kebab-name>.mjs` เช็กก่อนใช้ทุกครั้ง (ตรวจแล้ว: `Compass` มีจริง — `export { __iconNode, Compass as default }`)
- **สีทุกคู่ (ตัวหนังสือบนพื้นหลัง) ต้องผ่าน WCAG AA จริง** (คำนวณ relative luminance ตามสูตรมาตรฐาน ไม่ใช่ดูตาเปล่า) — ค่าที่กำหนดในสเปกผ่านการตรวจแล้ว แต่ทุก task ที่เพิ่มคู่สีใหม่ต้องตรวจซ้ำ
- **`--font-mono` (JetBrains Mono) ไม่เปลี่ยน** — คงไว้ตามเดิมทุกจุด

---

### Task 1: โทเคนสี "Dusk Market" + ฟอนต์ใหม่ + กวาดเปลี่ยนชื่อ class ทั่วแอป

**Files:**
- Modify: `app/globals.css`
- Modify: `app/layout.tsx`
- Modify (sweep — ดู Step 5): ทุกไฟล์ที่ใช้ `bg-marigold` / `text-marigold` / `border-marigold` / `bg-rust` / `text-rust` / `border-rust` / `bg-record` / `text-record` / `border-record` / `font-display`

**Interfaces:**
- Consumes: ไม่มี
- Produces (task อื่นใช้ต่อ):
  - Tailwind utility class ใหม่: `bg-teal` `text-teal` `border-teal` (แทน marigold), `bg-amber` `text-amber` `border-amber` (แทน rust), `bg-danger` `text-danger` `border-danger` (แทน record)
  - CSS custom property ใหม่: `--success` / `--success-foreground` (พื้น/ตัวหนังสือของ badge "ลงแล้ว" — เป็น tint แยกจาก `--primary` ที่ตอนนี้คือเทียลเข้มสำหรับปุ่ม)
  - ฟอนต์: `font-sans` (Plus Jakarta Sans + Noto Sans Thai ผสมกัน), `font-display` (เท่ากับ `font-sans` — ไม่มีฟอนต์ display แยกอีกต่อไป)

**บริบทที่ต้องรู้:**

**เหตุผลที่เปลี่ยนชื่อ token ไม่ใช่แค่ค่า:** ถ้าคง `--marigold` ไว้แต่ให้ค่าเป็นสีเทียล ตัวแปรจะชื่อไม่ตรงกับสีที่มันแทนอีกต่อไป (ใครมาอ่านทีหลังจะงงว่าทำไม "marigold" ถึงเป็นสีเทียล) จึงต้องเปลี่ยนชื่อจริงและ sweep ทุกจุดที่ใช้

**Contrast ที่ตรวจผ่านแล้ว (จากสเปก หัวข้อ 3.2-3.3) ห้ามแก้ค่าเหล่านี้:**
- Light ปุ่มหลัก: ขาว `#ffffff` บนเทียล `#0a6d64` = 6.20:1
- Dark ปุ่มหลัก: เข้ม `#0a1f1c` บนเทียลสว่าง `#22c1b3` = 7.63:1 (**ห้ามใช้ตัวหนังสือขาวบนเทียล dark mode** เคยลองแล้วได้แค่ 2.25:1)
- Light canvas/card luminance ต้องอยู่ที่ 0.83/0.92 (**ห้ามใช้ `#ffffff` ล้วนเป็นพื้นการ์ด** เคยลองแล้วจ้าเกินไป)

- [ ] **Step 1: แก้ `:root` (light mode) ใน `app/globals.css`**

แทนที่บล็อกนี้ทั้งหมด:

```css
:root {
  /* named palette — "screening room": ink hardware, paper scripts, tungsten accents */
  --ink: #1c1b18;
  --ink-2: #2a2822;
  --paper: #f6f1e4;
  --marigold: #e2a33b;
  --rust: #b14a2b;
  --smoke: #8a8471;
  --record: #c23b33;

  --background: var(--paper);
  --foreground: var(--ink);
  --card: #fbf8ef;
  --card-foreground: var(--ink);
  --popover: #fbf8ef;
  --popover-foreground: var(--ink);
  --primary: var(--rust);
  --primary-foreground: #fbf8ef;
  --secondary: #ece4d0;
  --secondary-foreground: var(--ink);
  --muted: #efe8d6;
  --muted-foreground: var(--smoke);
  --accent: var(--marigold);
  --accent-foreground: var(--ink);
  --destructive: var(--record);
  --border: #e1d8c0;
  --input: #e1d8c0;
  --ring: var(--marigold);
  --chart-1: var(--marigold);
  --chart-2: var(--rust);
  --chart-3: var(--smoke);
  --chart-4: var(--ink-2);
  --chart-5: var(--record);
  --radius: 0.75rem;
  --sidebar: var(--ink);
  --sidebar-foreground: var(--paper);
  --sidebar-primary: var(--marigold);
  --sidebar-primary-foreground: var(--ink);
  --sidebar-accent: var(--ink-2);
  --sidebar-accent-foreground: var(--paper);
  --sidebar-border: oklch(1 0 0 / 12%);
  --sidebar-ring: var(--marigold);
}
```

ด้วย:

```css
:root {
  /* named palette — "Dusk Market": warm neutral canvas, teal action, amber accent */
  --ink: #1a1d1f;
  --ink-2: #2a2e30;
  --paper: #f0ebe0;
  --teal: #0a6d64;
  --amber: #e8a33b;
  --smoke: #7c7568;
  --danger: #c0392b;

  --background: var(--paper);
  --foreground: var(--ink);
  --card: #f9f6ee;
  --card-foreground: var(--ink);
  --popover: #f9f6ee;
  --popover-foreground: var(--ink);
  --primary: var(--teal);
  --primary-foreground: #ffffff;
  --secondary: #f5e9d3;
  --secondary-foreground: #8a5b1e;
  --muted: #e5e1d8;
  --muted-foreground: var(--smoke);
  --accent: var(--teal);
  --accent-foreground: #ffffff;
  --success: #e3f2f0;
  --success-foreground: var(--teal);
  --destructive: var(--danger);
  --destructive-foreground: var(--danger);
  --border: #ddd5c4;
  --input: #ddd5c4;
  --ring: var(--teal);
  --chart-1: var(--teal);
  --chart-2: var(--amber);
  --chart-3: var(--smoke);
  --chart-4: var(--ink-2);
  --chart-5: var(--danger);
  --radius: 0.75rem;
  --sidebar: var(--ink);
  --sidebar-foreground: var(--paper);
  --sidebar-primary: var(--teal);
  --sidebar-primary-foreground: #ffffff;
  --sidebar-accent: var(--ink-2);
  --sidebar-accent-foreground: var(--paper);
  --sidebar-border: oklch(1 0 0 / 12%);
  --sidebar-ring: var(--teal);
}
```

**หมายเหตุ:** `--destructive-foreground: var(--danger);` เป็นบรรทัดใหม่ (เดิมไม่มี) — Button variant `destructive` เดิมใช้ `text-destructive` ตรงๆ ไม่ได้ใช้ `--destructive-foreground` แต่เพิ่มไว้เผื่อ Task 2 ต้องใช้

- [ ] **Step 2: แก้ `.dark` (dark mode) ใน `app/globals.css`**

แทนที่บล็อกนี้ทั้งหมด:

```css
.dark {
  --ink: #161512;
  --ink-2: #211f1a;
  --paper: #ece4d1;
  --marigold: #e2a33b;
  --rust: #cf6a45;
  --smoke: #a39d89;
  --record: #e0645c;

  --background: var(--ink);
  --foreground: var(--paper);
  --card: var(--ink-2);
  --card-foreground: var(--paper);
  --popover: var(--ink-2);
  --popover-foreground: var(--paper);
  --primary: var(--marigold);
  --primary-foreground: var(--ink);
  --secondary: #33302a;
  --secondary-foreground: var(--paper);
  --muted: #2c2924;
  --muted-foreground: var(--smoke);
  --accent: var(--rust);
  --accent-foreground: var(--paper);
  --destructive: var(--record);
  --border: oklch(1 0 0 / 12%);
  --input: oklch(1 0 0 / 15%);
  --ring: var(--marigold);
  --chart-1: var(--marigold);
  --chart-2: var(--rust);
  --chart-3: var(--smoke);
  --chart-4: var(--paper);
  --chart-5: var(--record);
  --sidebar: #0f0e0c;
  --sidebar-foreground: var(--paper);
  --sidebar-primary: var(--marigold);
  --sidebar-primary-foreground: var(--ink);
  --sidebar-accent: #211f1a;
  --sidebar-accent-foreground: var(--paper);
  --sidebar-border: oklch(1 0 0 / 10%);
  --sidebar-ring: var(--marigold);
}
```

ด้วย:

```css
.dark {
  --ink: #14181a;
  --ink-2: #1e2325;
  --paper: #eef1f0;
  --teal: #22c1b3;
  --amber: #f0b429;
  --smoke: #9aa39f;
  --danger: #f16158;

  --background: var(--ink);
  --foreground: var(--paper);
  --card: var(--ink-2);
  --card-foreground: var(--paper);
  --popover: var(--ink-2);
  --popover-foreground: var(--paper);
  --primary: var(--teal);
  --primary-foreground: #0a1f1c;
  --secondary: #3a2f18;
  --secondary-foreground: var(--amber);
  --muted: #2a2e30;
  --muted-foreground: var(--smoke);
  --accent: var(--teal);
  --accent-foreground: #0a1f1c;
  --success: #14302c;
  --success-foreground: var(--teal);
  --destructive: var(--danger);
  --destructive-foreground: var(--danger);
  --border: oklch(1 0 0 / 12%);
  --input: oklch(1 0 0 / 15%);
  --ring: var(--teal);
  --chart-1: var(--teal);
  --chart-2: var(--amber);
  --chart-3: var(--smoke);
  --chart-4: var(--paper);
  --chart-5: var(--danger);
  --sidebar: #0f1112;
  --sidebar-foreground: var(--paper);
  --sidebar-primary: var(--teal);
  --sidebar-primary-foreground: #0a1f1c;
  --sidebar-accent: #1e2325;
  --sidebar-accent-foreground: var(--paper);
  --sidebar-border: oklch(1 0 0 / 10%);
  --sidebar-ring: var(--teal);
}
```

**สำคัญ:** `--primary-foreground: #0a1f1c;` (ไม่ใช่ขาว) — นี่คือจุดที่แก้บั๊ก contrast fail ที่เจอตอนออกแบบ (ขาวบนเทียลสว่างได้แค่ 2.25:1)

- [ ] **Step 3: แก้ `@theme inline` ให้ตรงกับชื่อ token ใหม่**

หา `@theme inline` block แล้วแก้บรรทัดเหล่านี้ (เปลี่ยนแค่ชื่อตัวแปร ไม่เปลี่ยนตำแหน่ง):

จากเดิม:
```css
  --color-marigold: var(--marigold);
  --color-rust: var(--rust);
  --color-smoke: var(--smoke);
  --color-record: var(--record);
```

เป็น:
```css
  --color-teal: var(--teal);
  --color-amber: var(--amber);
  --color-smoke: var(--smoke);
  --color-danger: var(--danger);
  --color-success: var(--success);
  --color-success-foreground: var(--success-foreground);
```

(`--color-ink`, `--color-ink-2`, `--color-paper` ไม่ต้องแก้ — ชื่อเดิมคงอยู่ แค่ค่าที่ Step 1-2 เปลี่ยนไปแล้ว)

**เพิ่มบรรทัดใหม่ในส่วน destructive-foreground** (ต่อจาก `--color-destructive: var(--destructive);` เดิม ถ้ายังไม่มี):

```css
  --color-destructive-foreground: var(--destructive-foreground);
```

- [ ] **Step 4: แก้ `.clapper-stripes` ให้เป็นเส้นคั่นสีแบรนด์เรียบง่าย (ไม่ใช่ลายคลปเปอร์บอร์ดอีกต่อไป)**

แทนที่:

```css
@layer utilities {
  /* clapperboard clapstick edge — the header's signature stripe */
  .clapper-stripes {
    background-image: repeating-linear-gradient(
      -35deg,
      var(--ink) 0 22px,
      var(--paper) 22px 26px,
      var(--marigold) 26px 30px,
      var(--paper) 30px 34px
    );
  }
}
```

ด้วย:

```css
@layer utilities {
  /* เส้นคั่นบางๆ ไล่สีแบรนด์ท้ายหัวเว็บ — แทนลายคลปเปอร์บอร์ดเดิม */
  .brand-divider {
    background-image: linear-gradient(90deg, var(--teal), var(--amber));
  }
}
```

**หมายเหตุ:** `.clapper-stripes` ถูกใช้ 2 จุด (`app-header.tsx`, `clapper-header.tsx`) — Task 5 จะแก้ทั้งสองจุดให้เรียก `.brand-divider` แทน ยังไม่ต้องแก้ตอนนี้

- [ ] **Step 5: กวาดเปลี่ยนชื่อ Tailwind utility class ทั่วทั้งแอป**

รันคำสั่งนี้เพื่อดูว่ามีกี่ไฟล์ที่ต้องแก้ก่อน:

Run: `grep -rl "marigold\|-rust\b\|-record\b" components/*.tsx app/**/*.tsx 2>/dev/null`

แก้ **ทุกไฟล์ที่เจอ** โดยแทนที่ตามตารางนี้ทุกจุดที่ปรากฏ (ห้ามพลาดแม้แต่จุดเดียว — ตรวจด้วย grep ใน Step 6):

| เดิม | ใหม่ |
|---|---|
| `bg-marigold` | `bg-teal` |
| `text-marigold` | `text-teal` |
| `border-marigold` | `border-teal` |
| `hover:bg-marigold` | `hover:bg-teal` |
| `hover:text-marigold` | `hover:text-teal` |
| `focus-visible:ring-marigold` | `focus-visible:ring-teal` |
| `bg-rust` | `bg-amber` |
| `text-rust` | `text-amber` |
| `border-rust` | `border-amber` |
| `hover:bg-rust` | `hover:bg-amber` |
| `bg-record` | `bg-danger` |
| `text-record` | `text-danger` |
| `border-record` | `border-danger` |
| `hover:bg-record` | `hover:bg-danger` |

**อย่าใช้ sed แบบ blind replace ทั้งไฟล์** — เปิดแต่ละไฟล์ด้วย Edit tool แล้วแทนที่ทีละจุดตามบริบทจริง เพราะบางไฟล์มี string เช่น `bg-marigold/90` (มี opacity suffix) ต้องกลายเป็น `bg-teal/90` ไม่ใช่แค่ `bg-teal`

**ไฟล์ที่ยืนยันแล้วว่าต้องแก้ (จากการสำรวจ):** `angle-panel.tsx`, `app-header.tsx`, `brief-form.tsx`, `clapper-header.tsx`, `clip-thumbnail.tsx`, `core-prompt-panel.tsx`, `dashboard-panel.tsx`, `entry-list.tsx`, `entry-workspace.tsx`, `history-rail.tsx`, `post-time-panel.tsx`, `production-panel.tsx`, `product-spec-panel.tsx`, `recommendations.tsx`, `reconciliation.tsx`, `reminder-banner.tsx`, `revenue-by-clip.tsx`, `revenue-charts.tsx`, `script-output.tsx`, `weekly-scoreboard.tsx`, `workspace-tabs.tsx`

**ข้อยกเว้น:** ปุ่มที่มี ad-hoc className เต็มรูปแบบ (เช่น `bg-marigold text-ink hover:bg-marigold/90` บน `<Button>`) จะถูกแทนที่ทั้งก้อนด้วย `variant` prop ใน **Task 6** ไม่ใช่ Task นี้ — **Task นี้ (Step 5) ให้แก้เฉพาะจุดที่ใช้ class เดี่ยวๆ ไม่ใช่ปุ่มเต็มรูปแบบ** เช่น `text-marigold` บนปุ่ม toggle/disclosure ที่ไม่ใช่ action button, หรือ `text-rust` บน status indicator ข้อความล้วน, หรือ chart legend dot (`bg-marigold` ใน `revenue-by-clip.tsx` legend) — ถ้าไม่แน่ใจว่าจุดไหนเป็นของ Task 5 หรือ Task 6 ให้ดูตาราง "Ad-hoc buttons" ใน Task 6 เป็นหลัก จุดที่ไม่อยู่ในตารางนั้นคือของ Task นี้

- [ ] **Step 6: ตรวจว่าไม่มีชื่อเก่าเหลืออยู่**

Run: `grep -rn "marigold\|\brust\b\|\brecord\b" components/*.tsx app/**/*.tsx 2>/dev/null | grep -v "recommendations\.tsx.*record\b.*//"`
Expected: ไม่มีผลลัพธ์เหลืออยู่เลย ยกเว้นจุดที่ Task 6 จะจัดการ (ปุ่มเต็มรูปแบบ — ให้ตรวจด้วยตาว่าที่เหลืออยู่ตอนนี้ตรงกับรายการใน Task 6 หัวข้อ "Ad-hoc buttons" เท่านั้น)

- [ ] **Step 7: เปลี่ยนฟอนต์ใน `app/layout.tsx`**

แทนที่ทั้งไฟล์:

```tsx
import type { Metadata } from "next";
import { Chonburi, IBM_Plex_Sans_Thai, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";

const bodyFont = IBM_Plex_Sans_Thai({
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
});

const displayFont = Chonburi({
  subsets: ["thai", "latin"],
  weight: "400",
  variable: "--font-display",
});

const monoFont = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Pooling Prompt",
  description: "ประกอบ Core Prompt สำหรับสร้างวิดีโอ TikTok Shop ด้วย Gemini Flow",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="th"
      className={cn(
        "h-full",
        "antialiased",
        bodyFont.variable,
        displayFont.variable,
        monoFont.variable,
        "font-sans"
      )}
    >
      <body className="min-h-full flex flex-col lg:h-full lg:overflow-hidden">
        {children}
      </body>
    </html>
  );
}
```

ด้วย:

```tsx
import type { Metadata } from "next";
import { JetBrains_Mono, Noto_Sans_Thai, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";

// ฟอนต์ Latin/ตัวเลข และฟอนต์ไทยเป็นคนละตระกูลกันโดยตั้งใจ (Plus Jakarta Sans ไม่มี
// Thai glyph) — รวมเป็น --font-sans เดียวใน globals.css ด้วยการเรียงลำดับ fallback
// เบราว์เซอร์จะเลือกฟอนต์ตามตัวอักษรที่พบเอง (Thai -> Noto, Latin/ตัวเลข -> Jakarta)
const latinFont = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-latin",
});

const thaiFont = Noto_Sans_Thai({
  subsets: ["thai"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-thai",
});

const monoFont = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Angle",
  description: "by LAGR — ประกอบ Core Prompt สำหรับสร้างวิดีโอ TikTok Shop ด้วย Gemini Flow",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="th"
      className={cn(
        "h-full",
        "antialiased",
        latinFont.variable,
        thaiFont.variable,
        monoFont.variable,
        "font-sans"
      )}
    >
      <body className="min-h-full flex flex-col lg:h-full lg:overflow-hidden">
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Step 8: ผสม `--font-latin`/`--font-thai` เป็น `--font-sans` เดียวใน `app/globals.css`**

หาบรรทัดนี้ใน `@theme inline`:

```css
  --font-sans: var(--font-sans);
  --font-mono: var(--font-mono);
  --font-display: var(--font-display);
  --font-heading: var(--font-display);
```

แทนที่ด้วย:

```css
  --font-sans: var(--font-latin), var(--font-thai), sans-serif;
  --font-mono: var(--font-mono);
  --font-display: var(--font-sans);
  --font-heading: var(--font-sans);
```

**เหตุผล:** ไม่มีฟอนต์ display แยกอีกต่อไป (`Chonburi` ถูกถอดออก) `font-display`/`font-heading` จึงชี้กลับไปที่ `font-sans` เพื่อไม่ให้ต้องแก้ทุกจุดที่เคยใช้ class `font-display` (เช่น header title) — จุดเหล่านั้นจะได้ฟอนต์เดียวกับ body แต่ยังคุม weight ใหญ่ผ่าน `font-bold`/`text-xl` เดิมได้

- [ ] **Step 9: ตรวจ type และ lint**

Run: `npx tsc --noEmit`
Expected: ไม่มี error

Run: `npm run lint`
Expected: ไม่มี error

- [ ] **Step 10: ตรวจ contrast ทุกคู่หลักด้วยสคริปต์จริง**

เขียนไฟล์ `<scratch>/verify-contrast.js` ด้วย Write tool (แทน `<scratch>` ด้วย scratchpad dir ของเซสชัน):

```js
function hexToRgb(hex) {
  hex = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
}
function relLum([r, g, b]) {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}
function contrast(hex1, hex2) {
  const l1 = relLum(hexToRgb(hex1));
  const l2 = relLum(hexToRgb(hex2));
  const [lighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

let failed = 0;
function check(label, fg, bg, minRatio) {
  const c = contrast(fg, bg);
  const ok = c >= minRatio;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}: ${c.toFixed(2)}:1 (ต้องการ ${minRatio}:1)`);
}

console.log("=== Light mode ===");
check("ปุ่มหลัก (ขาวบนเทียล)", "#ffffff", "#0a6d64", 4.5);
check("ปุ่มรอง (amber-ink บน amber-soft)", "#8a5b1e", "#f5e9d3", 4.5);
check("ปุ่มอันตราย (danger บน danger-soft)", "#c0392b", "#f7e3e0", 4.5);
check("badge ลงแล้ว (teal บน teal-tint)", "#0a6d64", "#e3f2f0", 4.5);
check("ตัวหนังสือหลักบน canvas", "#1a1d1f", "#f0ebe0", 4.5);
check("ตัวหนังสือรองบน card", "#7c7568", "#f9f6ee", 4.5);

console.log("\n=== Dark mode ===");
check("ปุ่มหลัก (dark-ink บนเทียลสว่าง)", "#0a1f1c", "#22c1b3", 4.5);
check("ตัวหนังสือหลักบน canvas dark", "#eef1f0", "#14181a", 4.5);
check("ตัวหนังสือรองบน canvas dark", "#9aa39f", "#14181a", 4.5);
check("ปุ่มรอง dark (amber บน amber-soft dark)", "#f0b429", "#3a2f18", 4.5);

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
```

Run: `node "<scratch>/verify-contrast.js"`
Expected: ทุกบรรทัด `PASS` และปิดท้าย `ALL PASS`

**ถ้ามีคู่ไหน FAIL ห้ามลดเกณฑ์ 4.5 ในสคริปต์เพื่อให้ผ่าน** ให้แก้ hex ใน `globals.css` แทน แล้ววนกลับมารัน Step นี้ใหม่

- [ ] **Step 11: ทดสอบ UI จริง**

```bash
cp dev.db dev-test.db
NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001
```

ตรวจ:
- เปิด `/` — สีพื้นหลังเป็นโทนอุ่น ไม่ขาวจ้า, ฟอนต์เปลี่ยนเป็น Plus Jakarta Sans/Noto Sans Thai แล้ว, ปุ่ม/badge ต่างๆ ยังแสดงผล (สีอาจดูแปลกๆ ชั่วคราวเพราะ Task 6-7 ยังไม่ทำ — เป็นเรื่องปกติ)
- ไม่มี console error เรื่องฟอนต์โหลดไม่ได้
- **บังคับดู dark mode ชั่วคราว**: เปิด browser devtools → เพิ่ม class `dark` ให้ `<html>` ด้วยมือ → ตรวจว่าสีเปลี่ยนเป็นโทนมืดสมเหตุสมผล ไม่มีข้อความอ่านไม่ออก
- ไม่มี hydration warning

ปิด server แล้ว cleanup: `rm -rf .next-dev dev-test.db`

- [ ] **Step 12: Commit**

```bash
git diff tsconfig.json   # ต้องว่าง
git add app/globals.css app/layout.tsx components/angle-panel.tsx components/app-header.tsx \
  components/brief-form.tsx components/clapper-header.tsx components/clip-thumbnail.tsx \
  components/core-prompt-panel.tsx components/dashboard-panel.tsx components/entry-list.tsx \
  components/entry-workspace.tsx components/history-rail.tsx components/post-time-panel.tsx \
  components/production-panel.tsx components/product-spec-panel.tsx components/recommendations.tsx \
  components/reconciliation.tsx components/reminder-banner.tsx components/revenue-by-clip.tsx \
  components/revenue-charts.tsx components/script-output.tsx components/weekly-scoreboard.tsx \
  components/workspace-tabs.tsx
git commit -F - <<'EOF'
Rename the color tokens and swap in the Dusk Market palette

Keeping the old names (marigold, rust, record) while pointing them at
unrelated new colors would leave a variable named marigold holding a teal
hex value indefinitely - confusing for anyone reading the class list six
months from now. Renamed to what the colors actually are (teal, amber,
danger) and swept every usage.

Two contrast pairs failed WCAG AA on measurement during design (white text
on the light-mode teal button, white text on the dark-mode teal button) -
both fixed with darker/lighter variants of the same hue rather than
switching to a different color. Canvas and card brightness were also
brought back down near the old theme's levels; the first attempt at this
palette sat noticeably brighter and read as glare.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 2: ปรับ Button variant ให้ตรงกับระบบ 5 variant ของสเปก

**Files:**
- Modify: `components/ui/button.tsx`

**Interfaces:**
- Consumes จาก Task 1: token ใหม่ (`--primary`, `--secondary`, `--destructive`, `--muted` ที่รีแมปแล้ว)
- Produces (Task 6 ใช้ต่อ):
  - `variant="default"` = ปุ่มหลัก (primary, พื้นทึบเทียล)
  - `variant="secondary"` = ปุ่มรอง (พื้นอำพันอ่อน + กรอบ)
  - `variant="ghost"` = ปุ่มเบาที่สุด
  - `variant="destructive"` = ปุ่มอันตราย/ลบ (พื้นแดงอ่อน)

**บริบทที่ต้องรู้:**

shadcn Button ที่มีอยู่แล้วใช้ semantic layer (`bg-primary`, `bg-secondary`, `bg-destructive/10`) ซึ่งพอ Task 1 รีแมปค่า token แล้ว **variant 4 ใน 5 ตรงกับสเปกทันทีโดยไม่ต้องแก้โค้ด** — มีจุดเดียวที่ขาด: **`secondary` variant เดิมไม่มีเส้นขอบ (border) แต่สเปกต้องการให้ปุ่มรองมีกรอบด้วย**

- [ ] **Step 1: อ่านไฟล์ปัจจุบันเพื่อยืนยันบรรทัดที่จะแก้**

Run: `grep -n "secondary:" components/ui/button.tsx`
Expected: เจอบรรทัด `secondary: "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",`

- [ ] **Step 2: เพิ่ม border ให้ variant secondary**

แทนที่บรรทัดนั้นด้วย:

```tsx
        secondary:
          "border border-[color-mix(in_oklch,var(--secondary-foreground),transparent_80%)] bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
```

(border ใช้สีเดียวกับ `--secondary-foreground` แต่จางลงด้วย `color-mix` ให้ดูเป็นกรอบบางๆ ไม่ใช่เส้นทึบ)

- [ ] **Step 3: ตรวจ type และ lint**

Run: `npx tsc --noEmit`
Expected: ไม่มี error

Run: `npm run lint`
Expected: ไม่มี error

- [ ] **Step 4: ทดสอบ UI จริง**

```bash
cp dev.db dev-test.db
NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001
```

หาปุ่มที่ใช้ `variant="secondary"` อยู่แล้วในแอป (เช่น ปุ่ม "ค้นหา" ในหน้ารายการ `components/entry-list.tsx`) ตรวจว่าตอนนี้มีกรอบบางๆ รอบปุ่มแล้ว ไม่ใช่แค่พื้นสีทึบไม่มีขอบ

ปิด server แล้ว cleanup: `rm -rf .next-dev dev-test.db`

- [ ] **Step 5: Commit**

```bash
git diff tsconfig.json   # ต้องว่าง
git add components/ui/button.tsx
git commit -F - <<'EOF'
Add a border to the secondary button variant

The other four variants already matched the spec's button system once
Task 1 repointed the underlying tokens - only secondary was missing its
border, which the design mockups called for to keep it visually distinct
from a plain filled surface.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 3: สร้าง shared Badge component

**Files:**
- Create: `components/ui/badge.tsx`

**Interfaces:**
- Consumes จาก Task 1: `--success`/`--success-foreground`, `--secondary`/`--secondary-foreground`, `--muted`/`--muted-foreground`, `--destructive`
- Produces (Task 4, Task 6 ใช้ต่อ):
  - `function Badge({ variant, children, className }: { variant: "success" | "warning" | "neutral" | "danger"; children: React.ReactNode; className?: string })`

**บริบทที่ต้องรู้:**

Base UI (`@base-ui/react`) ไม่มี primitive สำหรับ badge/pill โดยเฉพาะ (ต่างจาก Button/Popover ที่มี primitive จริง) — เขียนเป็น plain styled component ธรรมดา ไม่ต้อง wrap Base UI primitive ใดๆ

**แมปกับสถานะจริงในแอป** (จาก `lib/entry-rows.ts` และ `components/entry-list.tsx`):
- `success` = "ลงแล้ว" (posted)
- `warning` = "รอลงคลิป" (awaiting-clip) และ "รอรอบจ่าย" (pending payout)
- `neutral` = "ยังไม่มี prompt" (no-prompt)
- `danger` = สำรองไว้สำหรับสถานะผิดพลาด/วิกฤต (ยังไม่มีจุดใช้ตอนนี้ แต่ใส่ไว้ให้ครบระบบ)

- [ ] **Step 1: เขียน `components/ui/badge.tsx`**

```tsx
import { cn } from "@/lib/utils";

const BADGE_VARIANT_CLASS = {
  success: "bg-success text-success-foreground",
  warning: "bg-secondary text-secondary-foreground",
  neutral: "bg-muted text-muted-foreground",
  danger: "bg-destructive/10 text-destructive",
} as const;

export type BadgeVariant = keyof typeof BADGE_VARIANT_CLASS;

/**
 * Badge สถานะ — ใช้สี tint เสมอ ไม่ใช่สีปุ่ม action (--primary) โดยตั้งใจ
 * เพื่อแยกบทบาท "ระบบบอกสถานะ" ออกจาก "ผู้ใช้กดทำ action" ตามสเปกการรีแบรนด์
 */
export function Badge({
  variant,
  children,
  className,
}: {
  variant: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[0.6rem] font-bold tracking-wide",
        BADGE_VARIANT_CLASS[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
```

- [ ] **Step 2: ตรวจ type และ lint**

Run: `npx tsc --noEmit`
Expected: ไม่มี error (ยังไม่มีที่เรียกใช้ `Badge` แต่ไฟล์ต้อง compile ผ่าน)

Run: `npm run lint`
Expected: ไม่มี error

- [ ] **Step 3: Commit**

```bash
git diff tsconfig.json   # ต้องว่าง
git add components/ui/badge.tsx
git commit -F - <<'EOF'
Add a shared Badge component

Status pills were hand-styled per call site (entry-list.tsx's STATUS_STYLE
lookup, a nested "awaiting payout" pill, core-prompt-panel's active-version
marker) with no shared component. This gives every status indicator in the
app one place to read its color from, using the success/warning/neutral/
danger tint tokens rather than the same solid color the primary button uses.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 4: หน้ารายการ — Badge ใหม่ + เลย์เอาต์แถวที่ตกลงกัน + empty state ชวนลงมือทำ

**Files:**
- Modify: `components/entry-list.tsx`

**Interfaces:**
- Consumes จาก Task 3: `Badge` component
- Produces: ไม่มี

**บริบทที่ต้องรู้:**

เลย์เอาต์แถวที่ตกลงกันหลังเทียบ 3 รอบ (สเปก หัวข้อ 7): ชื่อสินค้า+angle ซ้าย (ไม่ตัด wrap ได้ 2 บรรทัด) — สถิติ (สถานะ/วันที่/ยอดขาย/วิว) จัดกลุ่มขวา มีเส้นคั่นบาง ช่องที่ไม่มีข้อมูลต้องหายไปทั้งช่อง ไม่ใช่โชว์ "—"

**อ่านไฟล์เต็มก่อนแก้เสมอ** — ไฟล์นี้ถูกแก้มาแล้วหลายรอบในสองแบรนช์ก่อนหน้า เนื้อหาปัจจุบันมี type `EntryRow & { sales: EntrySalesSummary | null }`, prop `from`/`to`/`query`/`status`/`page` ครบแล้ว — งานนี้แก้แค่ส่วนเรนเดอร์ (badge, เลย์เอาต์แถว, empty state) ไม่แตะ prop/type/filter logic ใดๆ

- [ ] **Step 1: เพิ่ม import `Badge`**

```tsx
import { Badge } from "@/components/ui/badge";
```

- [ ] **Step 2: ลบ `STATUS_STYLE`/`STATUS_LABEL` object เดิม รวม logic แสดง badge เข้า `Badge` component**

ลบ:
```tsx
const STATUS_LABEL: Record<EntryStatus, string> = {
  "no-prompt": "ยังไม่มี prompt",
  "awaiting-clip": "รอลงคลิป",
  posted: "ลงแล้ว",
};

const STATUS_STYLE: Record<EntryStatus, string> = {
  "no-prompt": "border-record/40 text-record",
  "awaiting-clip": "border-marigold/40 text-marigold",
  posted: "border-border text-muted-foreground",
};
```

แทนที่ด้วย:

```tsx
const STATUS_LABEL: Record<EntryStatus, string> = {
  "no-prompt": "ยังไม่มี prompt",
  "awaiting-clip": "รอลงคลิป",
  posted: "ลงแล้ว",
};

const STATUS_BADGE_VARIANT: Record<EntryStatus, "success" | "warning" | "neutral"> = {
  "no-prompt": "neutral",
  "awaiting-clip": "warning",
  posted: "success",
};
```

- [ ] **Step 3: แก้บล็อกเรนเดอร์แถวทั้งก้อน**

อ่านไฟล์ปัจจุบันเพื่อหาบล็อก `<li key={row.id}>...</li>` ทั้งก้อน (มีทั้ง thumbnail, ชื่อ, angle, badge, วันที่, ยอดขาย, วิว) แล้วแทนที่ทั้งก้อนด้วย:

```tsx
              <li key={row.id}>
                <Link
                  href={`/entry/${row.id}`}
                  className="flex items-center gap-3.5 rounded-lg border border-border bg-card p-3.5 transition-colors hover:border-teal/50"
                >
                  {row.thumbnailFilename ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/uploads/${row.id}/${row.thumbnailFilename}`}
                      alt=""
                      loading="lazy"
                      className="size-11 shrink-0 rounded-lg border border-border object-cover"
                    />
                  ) : (
                    <span className="size-11 shrink-0 rounded-lg border border-dashed border-border" />
                  )}

                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <p className="text-sm leading-snug font-bold">{row.productName}</p>
                    {row.angle !== "" && (
                      <p className="line-clamp-1 text-xs text-muted-foreground">
                        angle: {row.angle}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-4 border-l border-border pl-4">
                    <div className="flex min-w-14 flex-col items-end gap-1">
                      <span className="font-mono text-[0.55rem] tracking-wide text-muted-foreground/70 uppercase">
                        สถานะ
                      </span>
                      <Badge variant={STATUS_BADGE_VARIANT[row.status]}>
                        {STATUS_LABEL[row.status]}
                      </Badge>
                    </div>

                    <div className="flex min-w-14 flex-col items-end gap-0.5">
                      <span className="font-mono text-[0.55rem] tracking-wide text-muted-foreground/70 uppercase">
                        {postedLabel(row.postedAt) ? "วันที่" : "สร้างเมื่อ"}
                      </span>
                      <span className="font-mono text-xs font-semibold">
                        {postedLabel(row.postedAt) ?? createdLabel(row.createdAt)}
                      </span>
                    </div>

                    {row.sales !== null && row.sales.orderCount > 0 && (
                      <div className="flex min-w-16 flex-col items-end gap-0.5">
                        <span className="font-mono text-[0.55rem] tracking-wide text-muted-foreground/70 uppercase">
                          ยอดขาย
                        </span>
                        <span className="font-mono text-xs font-semibold text-teal">
                          {baht(row.sales.settledRevenue)}
                        </span>
                        {row.sales.pendingGmv > 0 && (
                          <Badge variant="warning" className="mt-0.5">
                            รอรอบจ่าย
                          </Badge>
                        )}
                      </div>
                    )}

                    {row.sales !== null && row.sales.views !== null && (
                      <div className="flex min-w-12 flex-col items-end gap-0.5">
                        <span className="font-mono text-[0.55rem] tracking-wide text-muted-foreground/70 uppercase">
                          วิว
                        </span>
                        <span className="font-mono text-xs font-semibold">
                          {row.sales.views.toLocaleString("th-TH")}
                        </span>
                      </div>
                    )}
                  </div>
                </Link>
              </li>
```

**สิ่งที่เปลี่ยนจากเดิม:** โครงสร้างแถวเปลี่ยนจาก "ชื่อซ้าย + ข้อมูลสถานะ/วันที่/ยอดขายเรียงซ้อนแนวตั้งขวา" เป็น "ชื่อซ้ายยืดหยุ่น + สถิติกลุ่มขวาเรียงแนวนอนพร้อม label กำกับแต่ละช่อง คั่นด้วยเส้นบาง" — ช่อง "ยอดขาย"/"วิว" ไม่แสดงเลยถ้าไม่มีข้อมูล (เงื่อนไข `row.sales !== null && ...` เดิมคงไว้)

- [ ] **Step 4: เพิ่มปุ่มใน empty state ทั้งสองกรณี**

หาบล็อกนี้:

```tsx
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          {total === 0
            ? "ยังไม่มีรายการ"
            : query.trim() !== ""
              ? "ไม่พบรายการ — ลองใช้คำที่สั้นลงหรือน้อยคำลง"
              : "ไม่พบรายการ — ลองปรับช่วงวันที่หรือตัวกรองสถานะ"}
        </p>
      ) : (
```

แทนที่ด้วย:

```tsx
      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-4 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            {total === 0
              ? "ยังไม่มีรายการ"
              : query.trim() !== ""
                ? "ไม่พบรายการ — ลองใช้คำที่สั้นลงหรือน้อยคำลง"
                : "ไม่พบรายการ — ลองปรับช่วงวันที่หรือตัวกรองสถานะ"}
          </p>
          {total === 0 ? (
            <Button render={<Link href="/entry/new" />} nativeButton={false} size="sm">
              <Plus className="size-4" />
              เพิ่มสินค้าแรก
            </Button>
          ) : (
            <Button render={<Link href="/" />} nativeButton={false} variant="ghost" size="sm">
              ล้างตัวกรองทั้งหมด
            </Button>
          )}
        </div>
      ) : (
```

(`Plus` และ `Link` ถูก import อยู่แล้วในไฟล์นี้จาก Task ก่อนหน้า — ตรวจว่ามี import อยู่จริงก่อน ถ้าไม่มีให้เพิ่ม)

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

ตรวจ:
- **ชื่อสินค้ายาว 125 ตัวอักษร** (entry "【พร้อมส่ง】 BMZAR เคาเตอร์ครัว...") แสดงเต็มไม่ตัด wrap 2 บรรทัดได้
- **แถวที่มีออเดอร์+ยอดขาย** แสดงช่อง "ยอดขาย"/"วิว" ครบ
- **แถวที่ไม่มีออเดอร์เลย** ไม่มีช่อง "ยอดขาย"/"วิว" โผล่มาเลย (ไม่ใช่ "—")
- **แถวที่มี pending** แสดง badge "รอรอบจ่าย" ต่อท้ายตัวเลขยอดขาย
- **Badge สถานะ 3 แบบ** (ลงแล้ว/รอลงคลิป/ยังไม่มี prompt) ใช้สี tint คนละสีกับปุ่ม action ชัดเจน (เทียบกับปุ่ม "สินค้าใหม่" ที่เป็นเทียลเข้ม)
- **ค้นหาแล้วไม่เจอ** (query ไม่ว่าง) ขึ้นปุ่ม "ล้างตัวกรองทั้งหมด"
- **ฐานข้อมูลว่างจริง** (ถ้าทดสอบได้) ขึ้นปุ่ม "เพิ่มสินค้าแรก" — ถ้าทดสอบจริงไม่ได้เพราะ `dev-test.db` มีข้อมูลอยู่แล้ว ให้ตรวจโค้ดด้วยตาว่า logic ถูกต้อง
- ไม่มี console error / hydration warning

ปิด server แล้ว cleanup: `rm -rf .next-dev dev-test.db`

- [ ] **Step 7: Commit**

```bash
git diff tsconfig.json   # ต้องว่าง
git add components/entry-list.tsx
git commit -F - <<'EOF'
Rebuild the list row with the agreed layout and shared Badge

Three rounds of feedback landed here: a fixed-column table truncated the
125-character product names that exist in real data, and the first
flexible-name layout left the stat column empty and unused. This groups
status/date/revenue/views into one right-aligned cluster with per-field
labels, and drops any stat column that has no data instead of showing a
dash.

Status pills now go through the shared Badge component with tint colors,
replacing the STATUS_STYLE lookup that duplicated color logic Badge now
owns centrally.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 5: รีแบรนด์ — ชื่อแอป, ถอดคำศัพท์ธีมหนัง

**Files:**
- Modify → Rename: `components/clapper-header.tsx` → `components/entry-header.tsx`
- Modify: `components/entry-workspace.tsx`
- Modify: `components/app-header.tsx`
- Modify: `app/entry/[id]/page.tsx`
- Modify: `app/entry/new/page.tsx`

**Interfaces:**
- Consumes จาก Task 1: `.brand-divider` CSS class
- Produces: `EntryHeader` component (แทน `ClapperHeader`) รับ prop แค่ `productName` และ `children` (ไม่มี `takeNumber` อีกต่อไป)

**บริบทที่ต้องรู้:**

`takeNumber` ถูกคำนวณใน `app/entry/[id]/page.tsx:32` และ `app/entry/new/page.tsx:18` แล้วส่งผ่าน `entry-workspace.tsx` ไปจนถึง `ClapperHeader` — ต้องลบทั้งเชนนี้ ไม่ใช่แค่ที่ header

- [ ] **Step 1: สร้าง `components/entry-header.tsx` (เนื้อหาใหม่ทั้งไฟล์ แทนที่ `clapper-header.tsx`)**

```tsx
import Link from "next/link";
import { ArrowLeft, Compass } from "lucide-react";

export function EntryHeader({
  productName,
  children,
}: {
  productName: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="relative bg-ink text-paper">
      <div className="px-4 pt-3 sm:px-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 font-mono text-xs text-paper/50 transition-colors hover:text-paper"
        >
          <ArrowLeft className="size-3.5" />
          กลับไปรายการ
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 px-4 pt-2 pb-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <Compass className="size-6 shrink-0 text-teal" strokeWidth={1.75} />
          <div>
            <h1 className="text-xl leading-none font-extrabold tracking-wide text-paper sm:text-2xl">
              Angle <span className="text-sm font-normal text-paper/50">by LAGR</span>
            </h1>
            <p className="mt-1 text-xs text-paper/60">
              ประกอบ Core Prompt สำหรับวิดีโอ TikTok Shop
            </p>
          </div>
        </div>

        <div className="-rotate-2 rounded-md border border-paper/15 bg-ink-2 px-4 py-2 shadow-[3px_3px_0_0_rgba(0,0,0,0.35)]">
          <p className="max-w-[14rem] truncate font-mono text-sm text-teal">
            {productName || "ยังไม่ตั้งชื่อสินค้า"}
          </p>
        </div>
      </div>

      {children}

      <div className="brand-divider h-1 w-full" />
    </header>
  );
}
```

**สิ่งที่ตัดออก:** `takeNumber` prop, "Take {NN}" แสดงผล, ไอคอน `Clapperboard`, `.clapper-stripes` (เปลี่ยนเป็น `.brand-divider` ความสูง 1px แทน 2px เดิมเพราะไม่ใช่ลายคลปเปอร์บอร์ดที่ต้องหนาแล้ว)

- [ ] **Step 2: ลบไฟล์เก่า**

```bash
git rm components/clapper-header.tsx
```

- [ ] **Step 3: แก้ `components/entry-workspace.tsx`**

หา:
```tsx
import { ClapperHeader } from "@/components/clapper-header";
```
แก้เป็น:
```tsx
import { EntryHeader } from "@/components/entry-header";
```

หา (ใน function signature/props type — มี 2 จุดตาม catalog: `takeNumber,` ใน destructure และ `takeNumber: number;` ใน type):
```tsx
  takeNumber,
```
ลบบรรทัดนี้ทิ้ง (อยู่ในส่วน destructure ของ props)

หา:
```tsx
  takeNumber: number;
```
ลบบรรทัดนี้ทิ้ง (อยู่ในส่วน type ของ props)

หา:
```tsx
      <ClapperHeader sceneName={form.productName} takeNumber={takeNumber}>
```
แก้เป็น:
```tsx
      <EntryHeader productName={form.productName}>
```

หา (ปิด tag):
```tsx
      </ClapperHeader>
```
แก้เป็น:
```tsx
      </EntryHeader>
```

- [ ] **Step 4: แก้ `app/entry/[id]/page.tsx` — ลบการคำนวณ `takeNumber`**

หา:
```tsx
  const index = rows.findIndex((r) => r.id === id);
  const takeNumber = index >= 0 ? rows.length - index : rows.length + 1;
```
ลบทั้งสองบรรทัด (ตัวแปร `index` อาจยังใช้ต่อจากบรรทัดถัดไปสำหรับ `railRows` — **ตรวจโค้ดจริงก่อนลบ** ถ้า `index` ถูกใช้ต่อในการคำนวณ `railRows` ให้เก็บบรรทัด `const index = ...` ไว้ ลบแค่บรรทัด `const takeNumber = ...`)

หา:
```tsx
      takeNumber={takeNumber}
```
ลบบรรทัดนี้ทิ้ง (prop ที่ส่งเข้า `EntryWorkspace`)

- [ ] **Step 5: แก้ `app/entry/new/page.tsx` — ลบ prop `takeNumber`**

หา:
```tsx
      takeNumber={rows.length + 1}
```
ลบบรรทัดนี้ทิ้ง

- [ ] **Step 6: แก้ `components/app-header.tsx`**

แทนที่ทั้งไฟล์:

```tsx
import Link from "next/link";
import { Compass } from "lucide-react";

import { cn } from "@/lib/utils";

export type NavKey = "list" | "entry" | "core" | "dashboard";

const NAV: { key: NavKey; href: string; label: string }[] = [
  { key: "list", href: "/", label: "รายการสินค้า" },
  { key: "core", href: "/core-prompt", label: "Core Prompt" },
  { key: "dashboard", href: "/dashboard", label: "รายได้" },
];

/**
 * หัวเว็บของหน้าที่ไม่ผูกกับ entry ตัวใดตัวหนึ่ง
 *
 * แยกจาก EntryHeader เพราะตัวนั้นบังคับให้มีชื่อสินค้า ซึ่งหน้ารายการ
 * หน้ารายได้ และหน้า Core Prompt ไม่มี
 */
export function AppHeader({
  active,
  children,
}: {
  active: NavKey;
  children?: React.ReactNode;
}) {
  return (
    <header className="relative bg-ink text-paper">
      <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <Compass className="size-6 shrink-0 text-teal" strokeWidth={1.75} />
          <div>
            <h1 className="text-xl leading-none font-extrabold tracking-wide text-paper sm:text-2xl">
              Angle <span className="text-sm font-normal text-paper/50">by LAGR</span>
            </h1>
            <p className="mt-1 text-xs text-paper/60">
              ประกอบ Core Prompt สำหรับวิดีโอ TikTok Shop
            </p>
          </div>
        </Link>
        {children}
      </div>

      <nav className="flex flex-wrap gap-1 px-4 pb-3 sm:px-6" aria-label="เมนูหลัก">
        {NAV.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active === item.key ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 font-mono text-xs tracking-wide transition-colors",
              "focus-visible:ring-2 focus-visible:ring-teal focus-visible:outline-none",
              active === item.key
                ? "bg-teal text-primary-foreground"
                : "text-paper/60 hover:bg-ink-2 hover:text-paper"
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="brand-divider h-1 w-full" />
    </header>
  );
}
```

- [ ] **Step 7: ตรวจ type และ lint**

Run: `npx tsc --noEmit`
Expected: ไม่มี error — ถ้ามี error เรื่อง `takeNumber` ที่ยังหลงเหลือ ให้ไล่ตาม compiler ชี้กลับไปดูว่าลืมลบจุดไหน

Run: `npm run lint`
Expected: ไม่มี error

- [ ] **Step 8: ทดสอบ UI จริง**

```bash
cp dev.db dev-test.db
NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001
```

ตรวจ:
- เปิด `/` — หัวเว็บแสดง "Angle by LAGR" ไม่ใช่ "Pooling Prompt", ไอคอน Compass สีเทียล, เส้นคั่นบางท้ายหัวเว็บไล่สีเทียล→อำพัน
- เปิด `/entry/<id>` — ไม่มีเลข "Take" อีกต่อไป, ปุ่มกลับไปรายการยังอยู่, ชื่อสินค้าแสดงถูกต้อง
- เปิด `/entry/new` — เหมือนกัน ไม่มีเลข Take
- เปิด `/dashboard`, `/core-prompt` — หัวเว็บ "Angle by LAGR" เหมือนกัน
- Browser tab title แสดง "Angle" (ตรวจจาก `<title>` ใน devtools)
- ไม่มี console error / hydration warning

ปิด server แล้ว cleanup: `rm -rf .next-dev dev-test.db`

- [ ] **Step 9: Commit**

```bash
git diff tsconfig.json   # ต้องว่าง
git add components/entry-header.tsx components/entry-workspace.tsx components/app-header.tsx \
  app/entry/\[id\]/page.tsx app/entry/new/page.tsx
git rm components/clapper-header.tsx
git commit -F - <<'EOF'
Rename to Angle by LAGR, drop the take number and clapperboard icon

ClapperHeader became EntryHeader, the Clapperboard icon became Compass, and
the take-number chain (computed in both entry route pages, threaded through
EntryWorkspace, displayed as "Take 01") is gone entirely - it was a pure
movie-theme artifact with no functional use once the number itself carried
no meaning outside the theme.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 6: กวาดปุ่ม ad-hoc ทั้งหมดให้ใช้ Button variant

**Files:**
- Modify: `components/angle-panel.tsx`
- Modify: `components/brief-form.tsx`
- Modify: `components/core-prompt-panel.tsx`
- Modify: `components/dashboard-panel.tsx`
- Modify: `components/production-panel.tsx`
- Modify: `components/product-spec-panel.tsx`
- Modify: `components/reminder-banner.tsx`
- Modify: `components/revenue-by-clip.tsx`
- Modify: `components/script-output.tsx`

**Interfaces:**
- Consumes จาก Task 2: `variant="default"`/`"secondary"`/`"ghost"`/`"destructive"` ของ `Button`
- Produces: ไม่มี

**บริบทที่ต้องรู้ (สำคัญ พลาดง่าย):**

ปุ่มที่เขียน `bg-marigold`/`bg-rust` เต็มรูปแบบ (พร้อม `hover:bg-.../90`) ล้วนเป็น**ปุ่ม action หลักของ context นั้นๆ** (submit, generate, copy) — สเปกกำหนดให้ปุ่มหลักมีแค่สีเดียว (เทียล) ทั้งแอป **ทั้ง `bg-marigold` และ `bg-rust` แบบเต็มรูปแบบทั้งหมดกลายเป็น `variant="default"` (ไม่ต้องใส่ prop `variant` เลย เพราะเป็นค่า default อยู่แล้ว)** — นี่คือจุดที่แก้ความไม่สม่ำเสมอเดิม (สินค้าเดียวกันเคยมีทั้งปุ่ม bg-marigold และ bg-rust ทำหน้าที่เดียวกัน)

ปุ่มไอคอนลบรูป (`bg-record`) ในหน้า `brief-form.tsx` มี 3 จุดซ้ำแบบเดียวกัน (ลบแคป, ลบรูปที่บันทึกแล้ว, ลบรูปที่ยังไม่อัปโหลด) — ทั้งสามกลายเป็น `variant="destructive"` พร้อม `size="icon-xs"` (มีอยู่แล้วใน `buttonVariants`)

ปุ่ม disclosure/toggle (ข้อความ `text-marigold` ไม่มีพื้นหลัง เช่น "สกัดจากแคปหน้าสินค้า", "Product Risk Module") **ไม่ใช่ของ Task นี้** — ตัดสีไปแล้วใน Task 1 Step 5 (`text-marigold`→`text-teal`) เพราะไม่ใช่ action button ที่ต้องแปลงเป็น `<Button>` component (ยังเป็น native `<button>` ข้อความล้วนต่อไป)

- [ ] **Step 1: `components/angle-panel.tsx`**

หา:
```tsx
              <Button
                type="button"
                size="sm"
                onClick={handleSuggest}
                disabled={isSuggesting}
                className="self-start bg-marigold text-ink hover:bg-marigold/90"
              >
```

แก้เป็น:
```tsx
              <Button type="button" size="sm" onClick={handleSuggest} disabled={isSuggesting}>
```

(ลบ `className` ทิ้งทั้งหมด — ไม่ใส่ variant เพราะ `default` คือค่าเริ่มต้นอยู่แล้ว)

- [ ] **Step 2: `components/brief-form.tsx` — 8 จุด**

**จุดที่ 1** (บรรทัดราว 292-300) หา:
```tsx
              <Button
                type="button"
                size="sm"
                onClick={handleExtract}
                disabled={isExtracting || extractImages.length === 0}
                className="self-start bg-marigold text-ink hover:bg-marigold/90"
              >
```
แก้เป็น:
```tsx
              <Button
                type="button"
                size="sm"
                onClick={handleExtract}
                disabled={isExtracting || extractImages.length === 0}
              >
```

**จุดที่ 2** (บรรทัดราว 384-395) หา:
```tsx
          <Button
            type="submit"
            disabled={isCreating}
            size="lg"
            className="mt-1 self-start bg-rust text-primary-foreground hover:bg-rust/90"
          >
```
แก้เป็น:
```tsx
          <Button type="submit" disabled={isCreating} size="lg" className="mt-1 self-start">
```

**จุดที่ 3-5** (ปุ่มลบรูป/แคป — บรรทัดราว 258-268, 447-457, 478-488) หาทั้ง 3 จุดที่มีรูปแบบ:
```tsx
                        className="absolute -top-1.5 -right-1.5 rounded-full bg-record p-0.5 text-paper"
```
แก้บล็อกทั้งก้อนของแต่ละจุด จาก native `<button>` เป็น `<Button>`:

ตัวอย่างจุดที่ 1 (ลบแคป) จากเดิม:
```tsx
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
```
เป็น:
```tsx
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon-xs"
                        aria-label="ลบแคป"
                        onClick={(e) => {
                          e.stopPropagation();
                          setExtractImages((prev) => prev.filter((_, i) => i !== index));
                        }}
                        className="absolute -top-1.5 -right-1.5 rounded-full"
                      >
                        <X className="size-3" />
                      </Button>
```

**ทำแบบเดียวกันทุกเป๊ะกับอีก 2 จุด** (ลบรูปที่บันทึกแล้ว aria-label="ลบรูป", ลบรูปที่ยังไม่อัปโหลด aria-label="ลบรูป") — เปลี่ยน tag จาก `button`→`Button`, เพิ่ม `variant="destructive" size="icon-xs"`, เอา `bg-record p-0.5 text-paper` ออกจาก className (เหลือแค่ `absolute -top-1.5 -right-1.5 rounded-full`) เก็บ `onClick`/`aria-label`/children (ไอคอน `X`) ไว้เหมือนเดิมทุกอย่าง

**เพิ่ม import `Button`** ที่หัวไฟล์ถ้ายังไม่มี:
```tsx
import { Button } from "@/components/ui/button";
```

**จุดที่ 6-8** (ปุ่ม disclosure toggle 3 จุด — "สกัดจากแคปหน้าสินค้า", "Product Risk Module", "ข้อมูลเพิ่มเติมจากฉัน") — **ไม่แก้ใน Task นี้** สีของมันถูกจัดการไปแล้วใน Task 1 Step 5 (`text-marigold`→`text-teal`) ยังคงเป็น native `<button>` เหมือนเดิม

- [ ] **Step 3: `components/core-prompt-panel.tsx` — 2 จุด**

หา:
```tsx
          <Button
            type="submit"
            disabled={isAdding}
            className="self-start bg-rust text-primary-foreground hover:bg-rust/90"
          >
```
แก้เป็น:
```tsx
          <Button type="submit" disabled={isAdding} className="self-start">
```

หา:
```tsx
              <Button
                type="button"
                size="sm"
                disabled={isActivating}
                onClick={() => activate(viewing.id)}
                className="bg-marigold text-ink hover:bg-marigold/90"
              >
```
แก้เป็น:
```tsx
              <Button
                type="button"
                size="sm"
                disabled={isActivating}
                onClick={() => activate(viewing.id)}
              >
```

**หมายเหตุ:** ตัว "ใช้อยู่" status indicator (บรรทัด 67-72, `text-rust`) ถูกจัดการโดย Task 1 Step 5 (`text-rust`→`text-amber`) แล้ว ไม่ต้องแก้เพิ่มใน Task นี้ (ไม่ใช่ปุ่ม เป็นแค่ข้อความ+ไอคอน)

- [ ] **Step 4: `components/dashboard-panel.tsx`**

หา:
```tsx
            <Button
              type="submit"
              size="sm"
              disabled={isImporting}
              className="bg-rust text-primary-foreground hover:bg-rust/90"
            >
```
แก้เป็น:
```tsx
            <Button type="submit" size="sm" disabled={isImporting}>
```

(ปุ่ม import อีก 2 ปุ่มในไฟล์เดียวกัน — นำเข้าข้อมูลวิว/นำเข้าผู้ติดตาม — ใช้ `variant="outline"` สะอาดอยู่แล้ว ไม่ต้องแก้ แต่**ตรวจสอบว่าทั้ง 3 ปุ่ม import นี้ควรมีลำดับความสำคัญเท่ากันไหม** — ถ้าทั้ง 3 เป็น action ระดับเดียวกัน (นำเข้าไฟล์) ให้เปลี่ยนอีก 2 ปุ่มจาก `variant="outline"` เป็นไม่ใส่ variant (default) ด้วยเพื่อความสม่ำเสมอ ตัดสินใจตอนทำจริงโดยดู UI จริงประกอบ — ถ้าไม่แน่ใจให้คงไว้ตามเดิมและระบุไว้ใน commit message ว่าจงใจปล่อยไว้)

- [ ] **Step 5: `components/production-panel.tsx`**

หา:
```tsx
          <Button
            type="button"
            size="sm"
            onClick={copyForPost}
            disabled={!caption && !hashtags}
            className="bg-marigold text-ink hover:bg-marigold/90"
          >
```
แก้เป็น:
```tsx
          <Button type="button" size="sm" onClick={copyForPost} disabled={!caption && !hashtags}>
```

หา:
```tsx
          <Button
            type="submit"
            disabled={isSaving}
            size="lg"
            className="self-start bg-rust text-primary-foreground hover:bg-rust/90"
          >
```
แก้เป็น:
```tsx
          <Button type="submit" disabled={isSaving} size="lg" className="self-start">
```

- [ ] **Step 6: `components/product-spec-panel.tsx`**

หา:
```tsx
              <Button
                type="button"
                size="sm"
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="bg-marigold text-ink hover:bg-marigold/90"
              >
```
แก้เป็น:
```tsx
              <Button type="button" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
```

- [ ] **Step 7: `components/reminder-banner.tsx`**

หา:
```tsx
          <Button
            type="button"
            size="sm"
            onClick={onGoImport}
            className="bg-marigold text-ink hover:bg-marigold/90"
          >
```
แก้เป็น:
```tsx
          <Button type="button" size="sm" onClick={onGoImport}>
```

- [ ] **Step 8: `components/revenue-by-clip.tsx`**

ปุ่ม "ดูทั้งหมด/ย่อ" เป็นข้อความล้วนไม่มีพื้นหลัง (`text-marigold hover:underline`) — สีจัดการไปแล้วจาก Task 1 Step 5 **ไม่ต้องแก้เพิ่มใน Task นี้** (ไม่ใช่ปุ่ม action ที่มีพื้นหลัง)

- [ ] **Step 9: `components/script-output.tsx`**

หา:
```tsx
            className="bg-rust text-primary-foreground hover:bg-rust/90"
```
(บนปุ่ม "สร้างด้วย AI") แก้เป็น: ลบ `className` prop ทิ้งทั้งหมด (ปุ่มนี้ไม่มี className อื่นอยู่ใน prop เดียวกัน — ตรวจโค้ดจริงก่อนว่า className มีแค่ค่านี้ค่าเดียวหรือมีอย่างอื่นปนอยู่ด้วย ถ้ามีให้เก็บส่วนอื่นไว้ ลบแค่ 3 คลาสนี้)

หา:
```tsx
            className="bg-marigold text-ink hover:bg-marigold/90"
```
(บนปุ่ม "คัดลอก") แก้เป็นเดียวกัน: ลบ className ทิ้ง

- [ ] **Step 10: ตรวจ type และ lint**

Run: `npx tsc --noEmit`
Expected: ไม่มี error

Run: `npm run lint`
Expected: ไม่มี error — ถ้ามี unused-import warning เรื่อง `X` icon ในไฟล์ไหนที่ลบปุ่มไป ให้ตรวจว่ายังใช้ icon นั้นอยู่จริง (ควรยังใช้อยู่เพราะแค่เปลี่ยน tag ไม่ได้ลบ icon)

- [ ] **Step 11: ตรวจว่าไม่มี ad-hoc button className หลงเหลือ**

Run: `grep -rn 'className="[^"]*bg-teal\|className="[^"]*bg-amber\|className="[^"]*bg-danger' components/*.tsx | grep -v "Badge\|badge"`

ไล่ดูผลลัพธ์ทีละบรรทัด — ที่เหลืออยู่ควรมีแค่จุดที่ตั้งใจเก็บไว้ (เช่น icon-delete button ที่ยังต้องมี `rounded-full` เฉพาะตำแหน่ง ไม่ใช่สีที่ยังไม่ได้ผ่าน variant)

- [ ] **Step 12: ทดสอบ UI จริง**

```bash
cp dev.db dev-test.db
NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001
```

ตรวจทุกหน้า:
- **หน้า entry** (`/entry/<id>`) แท็บ ① — ปุ่ม "สร้างเป็นรายการใหม่/สร้าง Prompt", ปุ่ม "สกัดข้อมูล", ปุ่ม "เสนอ angle ใหม่", ปุ่ม "สกัดสเปกใหม่" ทั้งหมดเป็นสีเทียลเหมือนกัน (ไม่ใช่ผสมเหลือง/ส้มเหมือนเดิม)
- **ปุ่มลบรูป** (X วงกลมมุมรูป) ยังคงลบรูปได้ปกติ หน้าตาเป็นวงกลมสีแดงเหมือนเดิมแต่ผ่าน `variant="destructive"` แล้ว
- **แท็บ ②** — ปุ่ม "คัดลอกทั้งหมด", "บันทึกผลลัพธ์" เป็นเทียล
- **แท็บ ③ Core Prompt** — ปุ่ม "เพิ่มและใช้เวอร์ชันนี้", "ใช้เวอร์ชันนี้" เป็นเทียล
- **แท็บ ④ รายได้** — ปุ่ม "นำเข้าไฟล์รายได้" เป็นเทียล, แถบเตือนปุ่ม "ไปที่ Dashboard" เป็นเทียล
- **ScriptOutput** (แท็บ ①) — ปุ่ม "สร้างด้วย AI", "คัดลอก" เป็นเทียล
- ทุกปุ่มยังกดใช้งานได้ปกติ (สร้าง/ลบ/คัดลอก/นำเข้า ทดสอบจริงอย่างน้อย 3 อย่าง)
- ไม่มี console error / hydration warning

ปิด server แล้ว cleanup: `rm -rf .next-dev dev-test.db`

- [ ] **Step 13: Commit**

```bash
git diff tsconfig.json   # ต้องว่าง
git add components/angle-panel.tsx components/brief-form.tsx components/core-prompt-panel.tsx \
  components/dashboard-panel.tsx components/production-panel.tsx components/product-spec-panel.tsx \
  components/reminder-banner.tsx components/script-output.tsx
git commit -F - <<'EOF'
Consolidate ad-hoc action buttons onto the shared Button variants

Twenty-two buttons across nine files carried their own color className -
some marigold, some rust, doing the identical job (primary submit/generate/
copy action) with two different colors depending on which file wrote it.
All of them now render through the default variant, which already points
at the same teal token everywhere. The three repeated delete-image icon
buttons move to variant="destructive" with the icon-xs size that already
existed in buttonVariants.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 7: ข้อความระบบ — confirm dialog + ตรวจคำกริยาให้คงที่

**Files:**
- Modify: `components/entry-workspace.tsx`

**Interfaces:**
- Consumes: ไม่มี
- Produces: ไม่มี

**บริบทที่ต้องรู้:**

`confirm("ลบรายการนี้?")` เป็น browser confirm ดิบ (ยังใช้ต่อได้ตามสเปก ไม่ต้องเปลี่ยนเป็น custom dialog) แต่คำถามต้องบอกผลลัพธ์ที่กู้คืนไม่ได้ชัดเจนขึ้น

- [ ] **Step 1: แก้ข้อความ confirm**

หา:
```tsx
    if (!confirm("ลบรายการนี้?")) return;
```
แก้เป็น:
```tsx
    if (!confirm("ลบรายการนี้ถาวร — กู้คืนไม่ได้")) return;
```

- [ ] **Step 2: ตรวจ type และ lint**

Run: `npx tsc --noEmit`
Expected: ไม่มี error

Run: `npm run lint`
Expected: ไม่มี error

- [ ] **Step 3: ทดสอบ UI จริง**

```bash
cp dev.db dev-test.db
NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001
```

กดลบ entry จากเมนู kebab ในแถบข้าง — ตรวจว่า browser confirm dialog ขึ้นข้อความใหม่ "ลบรายการนี้ถาวร — กู้คืนไม่ได้" **กด Cancel อย่ากด OK จริงถ้าใช้ entry จริงใน `dev-test.db` ที่ไม่ได้ตั้งใจลบ**

ปิด server แล้ว cleanup: `rm -rf .next-dev dev-test.db`

- [ ] **Step 4: Commit**

```bash
git diff tsconfig.json   # ต้องว่าง
git add components/entry-workspace.tsx
git commit -F - <<'EOF'
State the delete confirmation's real consequence

"Delete this item?" doesn't say the delete is permanent. This app has no
undo or trash for entries, so the confirm text now says so directly.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 8: ตรวจสอบสุดท้ายทั้งแอป

**Files:**
- ไม่มีไฟล์ที่แก้ (เว้นแต่เจอปัญหาจาก verify แล้วต้องย้อนกลับไปแก้ task ก่อนหน้า)

**Interfaces:**
- Consumes: ทุก task ก่อนหน้า
- Produces: ไม่มี (จุดสิ้นสุดของแผน)

- [ ] **Step 1: กวาดหาคำศัพท์เก่าที่ต้องไม่เหลืออยู่เลย**

Run:
```bash
grep -rn "Pooling Prompt\|Chonburi\|Clapperboard\|clapper-stripes\|ClapperHeader\|takeNumber\|sceneName" \
  app/ components/ lib/ 2>/dev/null
```

Expected: **ไม่มีผลลัพธ์เลย** (ยกเว้นถ้ามีคอมเมนต์ใน `CLAUDE.md`/`docs/` ที่อ้างอิงประวัติ — ไฟล์เหล่านั้นไม่อยู่ใน scope ของ grep นี้อยู่แล้ว)

ถ้าเจอผลลัพธ์เหลืออยู่ ให้ย้อนกลับไปแก้ที่ต้นทาง (Task 5 ถ้าเป็นคำศัพท์ terminology, Task 1 ถ้าเป็นสี)

Run:
```bash
grep -rln "marigold\|bg-rust\b\|text-rust\b\|border-rust\b\|bg-record\b\|text-record\b\|border-record\b" \
  app/ components/ 2>/dev/null
```

Expected: **ไม่มีผลลัพธ์เลย**

- [ ] **Step 2: ตรวจ type และ lint ทั้งโปรเจกต์รอบสุดท้าย**

Run: `npx tsc --noEmit`
Expected: ไม่มี error

Run: `npm run lint`
Expected: ไม่มี error

Run: `git diff tsconfig.json`
Expected: ว่าง

- [ ] **Step 3: รัน contrast verify สคริปต์จาก Task 1 อีกครั้งเพื่อยืนยัน**

Run: `node "<scratch>/verify-contrast.js"` (ไฟล์เดิมจาก Task 1 Step 10 — ถ้าลบไปแล้วให้เขียนใหม่ตามโค้ดใน Task 1 Step 10)
Expected: `ALL PASS`

- [ ] **Step 4: ทดสอบ UI ทั้งแอปแบบเต็มรอบเดียว**

```bash
cp dev.db dev-test.db
NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001
```

ไล่ทุกหน้า:
1. `/` — ชื่อ "Angle by LAGR" บนหัวเว็บ, ปุ่ม "สินค้าใหม่" เทียล, badge สถานะ 3 สีต่างจากปุ่ม, ชื่อยาวไม่ตัด, ค้นหา/กรอง/แบ่งหน้ายังทำงานถูกต้องเหมือนก่อนรีแบรนด์ (regression check กับสองแบรนช์ก่อนหน้า)
2. `/entry/<id>` — ไม่มี "Take", ปุ่มกลับไปรายการทำงาน, ทุกปุ่มในแท็บ ①② เป็นเทียลสม่ำเสมอ, ปุ่มลบรูปแดง
3. `/entry/new` — สร้าง entry ใหม่ได้ปกติ
4. `/dashboard` — นำเข้าไฟล์ได้ปกติ, Weekly Scoreboard/กราฟ/ราย-คลิป/เวลาโพสต์ยังแสดงผลถูกต้อง (สีกราฟเปลี่ยนตาม `--chart-*` ใหม่โดยอัตโนมัติ), กดการ์ดคำแนะนำเด้งไป entry ถูกต้อง
5. `/core-prompt` — เพิ่ม/เปลี่ยนเวอร์ชัน core prompt ได้ปกติ
6. **บังคับ dark mode ชั่วคราว** (เพิ่ม class `dark` ให้ `<html>` ผ่าน devtools) แล้วไล่ดูทั้ง 5 หน้าอีกรอบ — ตรวจว่าตัวหนังสืออ่านออกทุกจุด ปุ่มหลักใช้ตัวหนังสือเข้ม (ไม่ใช่ขาว) บนพื้นเทียลสว่าง
7. ไม่มี console error / hydration warning ตลอดทั้งรอบ

ปิด server แล้ว cleanup: `rm -rf .next-dev dev-test.db`

- [ ] **Step 5: อัปเดต CLAUDE.md**

เปิด `CLAUDE.md` แล้วหาส่วนที่อ้างถึง:
- "Design tokens ที่กำหนดเอง (สีชื่อ `ink`/`paper`/`marigold`/`rust`/`smoke`/`record`, ฟอนต์ `Chonburi`/`IBM Plex Sans Thai`/`JetBrains Mono`)"
- "ธีม dashboard ทำเป็นกลางๆ ไม่ใส่ motif คลปเปอร์บอร์ด (ผู้ใช้กำลังจะเลิกธีมหนัง — การเปลี่ยนชื่อ+re-theme ทั้งแอปเป็นโปรเจกต์แยก)"

แก้ทั้งสองจุดให้ตรงกับความจริงใหม่ (บรรทัดแรกเปลี่ยนชื่อสี+ฟอนต์ตามที่ทำจริง, บรรทัดสองลบทิ้งเพราะ "โปรเจกต์แยก" ที่พูดถึงคืองานนี้เองที่ทำเสร็จแล้ว)

- [ ] **Step 6: Commit**

```bash
git diff tsconfig.json   # ต้องว่าง
git add CLAUDE.md
git commit -F - <<'EOF'
Update CLAUDE.md for the Angle by LAGR rebrand

The design-tokens line still named the old marigold/rust/record/Chonburi
set, and the note about "eventually dropping the movie theme" described
this exact branch as future work.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Self-Review

**ความครอบคลุมของ spec:**

| ข้อกำหนดใน spec | Task ที่ทำ |
|---|---|
| §2 ชื่อแอป "Angle" + "by LAGR" | Task 5 |
| §3.1 แยกสี action/status (60-30-10) | Task 1 (token) + Task 3 (Badge) + Task 6 (buttons ทั้งหมด default variant เดียว) |
| §3.2-3.3 Palette light/dark ผ่าน WCAG | Task 1 |
| §4 ฟอนต์ Plus Jakarta Sans + Noto Sans Thai + JetBrains Mono คงเดิม | Task 1 Steps 7-8 |
| §5 ระบบปุ่ม 5 variant + สม่ำเสมอทุกจุด | Task 2 (variant) + Task 6 (sweep) |
| §6 Badge สถานะใช้ tint | Task 3 + Task 4 |
| §7 เลย์เอาต์แถวรายการ (ผสม 2 แบบ) | Task 4 |
| §8 Empty state + confirm copy + คำกริยาคงที่ | Task 4 (empty state) + Task 7 (confirm) |
| §9 คำศัพท์ธีมหนังทั้งหมด | Task 5 |
| §10 Non-goals (ไม่สร้าง dark toggle, ไม่แตะ schema, ไม่แตะ query logic) | ไม่มี task ใดแตะสิ่งเหล่านี้ — ยืนยันแล้ว |
| §11 แบ่งเป็นหลาย task ตามกลุ่มไฟล์ | แผนนี้มี 8 task แยกตามกลุ่ม |
| §12 เกณฑ์สำเร็จทั้ง 7 ข้อ | Task 8 (grep + contrast + UI + regression check) |

**ความสอดคล้องของชื่อ/ชนิด:** `ClapperHeader`→`EntryHeader` เปลี่ยนทั้ง export name และ prop (`sceneName`→`productName`) ใช้ชื่อเดียวกันทั้ง Task 5 (ไฟล์ใหม่+จุดเรียกใช้ใน `entry-workspace.tsx`) ✓ · `Badge` variant names (`success`/`warning`/`neutral`/`danger`) นิยาม Task 3 ใช้ตรงกันใน Task 4 (`STATUS_BADGE_VARIANT`) ✓ · token names (`teal`/`amber`/`smoke`/`danger`/`success`) นิยาม Task 1 ใช้สม่ำเสมอทุก task ถัดไป ✓ · `.brand-divider` นิยาม Task 1 Step 4 ใช้ใน Task 5 (`EntryHeader`, `AppHeader`) ✓

**จุดที่ต้องระวังเป็นพิเศษที่ระบุไว้ในแผนแล้ว:** Task 1 Step 5 มีตาราง "ข้อยกเว้น" แยกชัดว่าจุดไหนเป็นของ Task 1 (class เดี่ยว) กับ Task 6 (ปุ่มเต็มรูปแบบ) เพื่อไม่ให้ผู้ทำสับสนว่าต้องแก้ที่ไหนก่อน · Task 5 Step 4 เตือนให้ตรวจโค้ดจริงก่อนลบตัวแปร `index` เผื่อถูกใช้ต่อในการคำนวณอื่น
