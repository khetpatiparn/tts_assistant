# Pooling Prompt

เครื่องมือ local สำหรับสร้าง prompt วิดีโอ AI ของ TikTok Shop (เป้าหมายคือ Gemini Flow) — กรอกข้อมูลสินค้า + รูปสินค้าจริง แล้วให้ Gemini API ประกอบเป็น 10-part prompt พร้อม Caption/Hashtag สำหรับโพสต์ ครบในหน้าเดียว

ดู `CLAUDE.md` สำหรับรายละเอียดสถาปัตยกรรม, gotcha ที่เจอมาแล้ว และ `requirements/req1.md` สำหรับสเปกผลิตภัณฑ์เต็ม (ภาษาไทย)

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

**ห้ามรัน `npm run build`/`npm run dev` ซ้อนกันหลายตัวพร้อมกัน** (เช่นรัน dev server เองพร้อมกับที่ agent กำลัง build) — `.next` จะเขียนทับกันจนพัง ดู `CLAUDE.md` สำหรับวิธีแก้

## คำสั่งอื่นๆ

```bash
npm run build   # production build (type-check ในตัว)
npm run lint    # ESLint
```

ไม่มี test runner ในโปรเจกต์นี้ — verify ด้วยการรันจริงตามที่ระบุใน `CLAUDE.md`
