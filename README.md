# Pooling Prompt

[![Next.js](https://img.shields.io/badge/Next.js-16.2.10-000000?logo=next.js&logoColor=white)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Prisma](https://img.shields.io/badge/Prisma-7-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Gemini API](https://img.shields.io/badge/Gemini-API-8E75B2?logo=googlegemini&logoColor=white)](https://ai.google.dev)

เครื่องมือ local สำหรับ workflow การสร้างวิดีโอ TikTok Shop แบบ end-to-end — ตั้งแต่กรอกข้อมูลสินค้า, ประกอบ prompt สำหรับ AI video generation (เป้าหมายคือ **Gemini Flow**), สร้าง Caption/Hashtag, ไปจนถึงติดตามรายได้ affiliate จริงจากคลิปที่ลงแล้ว ครบในหน้าเดียว ไม่ต้องสลับแอป

> อ่าน [`CLAUDE.md`](./CLAUDE.md) สำหรับรายละเอียดสถาปัตยกรรม, gotcha ที่เจอมาแล้ว และการตัดสินใจเชิงเทคนิค · [`requirements/req1.md`](./requirements/req1.md) สำหรับสเปกผลิตภัณฑ์เต็ม (ภาษาไทย)

## ฟีเจอร์

| แท็บ | หน้าที่ |
|---|---|
| **① Brief & Script** | กรอกข้อมูลสินค้า + แนบรูปสินค้าจริง (paste/drag-drop) แล้วกด "สร้างด้วย AI" ให้ Gemini ประกอบ prompt ให้อัตโนมัติ (เลือกได้ระหว่างโมเดลเร็ว/ละเอียด) |
| **② ผลลัพธ์ & คลิป** | 10-part prompt ที่พร้อมส่งเข้า Gemini Flow, Caption/Hashtag ที่สร้างอัตโนมัติพร้อมปุ่มคัดลอก, ลิงก์คลิปที่ลงจริง + วันที่โพสต์ (auto-fill ให้เมื่อวางลิงก์) |
| **③ Core Prompt** | จัดการ template หลักแบบมีเวอร์ชัน แยกกันระหว่าง prompt สร้างวิดีโอ กับ SEO prompt สำหรับ Caption |
| **④ รายได้** | นำเข้าไฟล์ affiliate order จาก TikTok Studio, จับคู่ออเดอร์กับคลิปด้วย video ID, แยกเงินที่ได้จริงออกจากเงินที่ยังรอ, thumbnail คลิปจริงผ่าน TikTok oEmbed, แจ้งเตือนเมื่อถึงรอบต้องนำเข้าข้อมูลใหม่ |

**หลักการออกแบบที่ยึดตลอดทั้งแอป:** ข้อมูลเงิน (GMV vs. เงินที่ settle แล้ว) ต้องไม่ทำให้เข้าใจผิด, ไม่มี emoji ใน UI, ทุกอย่างใช้งานได้แม้ Gemini API ล่ม (มี manual fallback เสมอ)

## Tech Stack

| | |
|---|---|
| Framework | Next.js 16 (App Router, custom build) + React 19 |
| Database | SQLite ผ่าน Prisma 7 (`@prisma/adapter-better-sqlite3`) |
| Styling | Tailwind CSS v4 (CSS-first config) + shadcn/ui (`@base-ui/react` primitives) |
| AI | Gemini API ผ่าน `@google/genai` |
| Charts | Recharts |
| Data import | SheetJS (`xlsx`) สำหรับไฟล์ affiliate order |

## เริ่มต้นใช้งาน

ติดตั้ง dependency:

```bash
npm install
```

สร้างไฟล์ `.env` ที่ root แล้วใส่:

```
DATABASE_URL="file:./dev.db"
GEMINI_API_KEY="<คีย์จาก aistudio.google.com>"
```

สร้างฐานข้อมูล (SQLite ผ่าน Prisma):

```bash
npx prisma migrate dev
node prisma/seed/seed-seo-prompt.mjs
```

รัน dev server:

```bash
npm run dev
```

เปิด [http://localhost:3000](http://localhost:3000)

## รันแบบ background (ไม่ต้องเปิด terminal ค้างไว้)

ใช้ `start.bat` / `stop.bat` ที่ root — build แล้วรัน production server เป็น background process ให้เอง

> **ห้ามรัน `npm run build`/`npm run dev` ซ้อนกันหลายตัวพร้อมกัน** (เช่นรัน dev server เองพร้อมกับที่ agent กำลัง build) — `.next` จะเขียนทับกันจนพัง ดู [`CLAUDE.md`](./CLAUDE.md) สำหรับวิธีแก้

## คำสั่งอื่นๆ

| คำสั่ง | หน้าที่ |
|---|---|
| `npm run build` | production build (type-check ในตัว) |
| `npm run lint` | ESLint |

ไม่มี test runner ในโปรเจกต์นี้ — verify ด้วยการรันจริงตามที่ระบุใน [`CLAUDE.md`](./CLAUDE.md)
