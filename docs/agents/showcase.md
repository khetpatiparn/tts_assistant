# Showcase (Showcase Scanner extension, ลิงก์ปลายทาง, หน้า `/showcase` + `/products`)

คำศัพท์ (Candidate, Showcase, Source photo, Showcase Scanner, Destination, Destination link) อยู่ `CONTEXT.md` · สเปก: `docs/superpowers/specs/2026-09-29-showcase-destination-link-design.md` · เหตุผลที่ฝังรหัสในลิงก์: `docs/adr/0001-destination-link-secret-in-url.md` · protocol ที่แจกคนอื่น: `showcase-extension/docs/INTEGRATION.md`

## Protocol ลิงก์ปลายทาง (`showcase-scanner/1`)

- **extension ไม่รู้จัก Angle** — ส่งผลสแกนไปที่ "ลิงก์ปลายทาง" ลิงก์เดียว Angle เป็นแค่ปลายทางหนึ่ง ผ่าน route เดียว `app/api/scanner/route.ts`: GET = รายการ product ID ที่มีแล้ว · POST text/plain = นำเข้าผ่าน `importShowcaseBatch`
- **การยืนยันตัวตน = token ในลิงก์อย่างเดียว** — token อยู่ตาราง `ScannerLink` (แถว singleton) เทียบแบบ timing-safe ใน `lib/scanner-link.ts` · ปุ่มคัดลอก/สร้างลิงก์ใหม่อยู่หน้า "หาสินค้า" (`components/scanner-link-box.tsx`) · ระบบเก่า (secret header `x-showcase-secret`, `SHOWCASE_IMPORT_SECRET`, route `/api/showcase-import*`) ลบหมดแล้วรวมถึงใน `.env` — อย่าเอากลับมา
- CORS ของ `/api/scanner` (`lib/cors.ts`) จำเป็น เพราะหน้า extension เป็นคนละ origin เสมอ — extension ไม่มี (และไม่ต้องมี) host permission ของ localhost
- **POST เป็น simple request** (text/plain ไม่มี custom header) — Google Apps Script ต้องรับได้ · extension รอ POST 120 วิ เพราะ Angle โหลดรูปสินค้าในคำขอเดียวกัน
- **แก้ protocol ต้องแก้ 3 ที่พร้อมกัน:** `showcase-extension/extension/src/dashboard/destination.ts` (ฝั่งส่ง) · `app/api/scanner/route.ts` (Angle) · `showcase-extension/docs/INTEGRATION.md` + `showcase-extension/docs/examples/*` (ที่คนอื่นใช้ต่อระบบ)

## แจก extension เป็น zip

- `cd showcase-extension && npm run package` → `dist-zip/showcase-scanner-<version>.zip` — สร้างด้วย `C:\Windows\System32\tar.exe` (Compress-Archive ของ PowerShell 5.1 เขียนชื่อไฟล์เป็น `\` จน macOS/Linux แตกไฟล์พัง)
- **ตัว extension อยู่ที่รากของ zip** (แตกแล้ว Load unpacked ที่โฟลเดอร์นั้นได้ทันที) เอกสาร developer อยู่ใน `developer/` — รุ่นแรกซ่อน extension ในโฟลเดอร์ย่อยแล้วผู้ใช้จริงได้ "Manifest file is missing"
- ชื่อไฟล์/โฟลเดอร์ใน zip ขึ้นต้นด้วยตัวอื่นที่ไม่ใช่ `_` (Chrome ไม่โหลด — `scripts/package.mjs` เช็กให้)
- **คู่มือหลักอยู่ในตัว extension** หน้า `extension/src/help/` (เปิดเองตอนติดตั้งครั้งแรกผ่าน `onInstalled` ใน background.ts, ลิงก์จาก popup/หน้าจัดการ, ปุ่มคัดลอกคู่มือไปให้ AI + ดาวน์โหลด/คัดลอกโค้ด) — ผู้ใช้จริงไม่เปิดไฟล์ `.md` ในโฟลเดอร์ zip · `scripts/build.mjs` ก๊อป `docs/INTEGRATION.md` และ `docs/examples/quickstart-node.mjs` (ตัวอย่างสั้นสุดสำหรับ developer, Node ล้วน รันจริงแล้ว) เข้า `help/` ทุก build → แก้ที่ต้นฉบับใน `docs/` ไม่ใช่สำเนาใน dist

## หน้า `/showcase` กับ `/products` (ตาราง `ProductCandidate` เดียวกัน)

- **คนละขั้นงาน แยกด้วย `sourceProductId`** (ดู Candidate vs Showcase ใน `CONTEXT.md`): `/products` = แคปหน้าจัดอันดับ (`sourceProductId IS NULL`) ไว้เลือกว่าจะเพิ่มอะไรเข้า Showcase · `/showcase` = รายการงานที่ต้องทำ (`sourceProductId NOT NULL`) — **คิวรีของสองหน้ากรองคอลัมน์นี้เสมอ**
- ตรรกะสถานะ (ยังไม่เริ่ม/กำลังทำ/โพสต์แล้ว/ไม่ทำแล้ว) อยู่ `lib/showcase.ts` (pure, ตรวจด้วย `node scripts/check-showcase.mjs`) คิดจาก `linkedEntryId` + `videoUrl` ของ Entry + `dismissedAt`
- ยุบแถวซ้ำด้วย `sourceProductId` (ชื่อสินค้าซ้ำกันได้ข้ามสินค้า) · "ไม่ทำแล้ว" เซ็ต `dismissedAt` ทุกแถวของ `sourceProductId` เดียวกัน
- `SHOWCASE_TRACKING_SINCE` ตัดชุดแรก 197 ตัวทิ้งโดยตั้งใจ (ผู้ใช้เลือกเริ่มนับใหม่)
- งานที่พังรอบ 3–4 ของ Flow = blocked เสมอ (รายละเอียดใน `docs/agents/flow-bot.md`)

## "ทำคลิปตัวนี้" (`startShowcaseProduct`)

- รับ**ไฟล์**รูปต้นทาง 1 รูป (ครอปด้วย canvas ในเบราว์เซอร์ `components/showcase-photo-picker.tsx`) → สร้าง Entry + เข้าคิว Flow
- **ย่อชื่อสินค้าตอนสร้าง entry** — `startShowcaseProduct`/`createEntryFromCandidate` ผ่าน `shortNameForEntry` (`shortenProductName` ด้วย flash-lite + `acceptShortName` ใน `lib/flow-jobs.ts`) · ชื่อเต็มเก็บใน `productInfo` ขึ้นต้น `ชื่อเต็มจากร้าน: ` (`FULL_TITLE_PREFIX`) · ล้มเหลวหรือเกิน `SHORT_NAME_TIMEOUT_MS` (8 วิ, `withTimeout`) = ใช้ชื่อเต็ม ไม่ทำให้สร้างงานพัง · **เหตุผล:** บอทพิมพ์ `productName` ลงพรอมต์วาดรูปของ Flow ชื่อ SEO ยาวที่มีคุณสมบัติ ("หนานุ่มพิเศษ ซึมซับดี…") ทำให้ Flow ใส่ตัวหนังสือลงในรูป
- **ลำดับใน `startShowcaseProduct`: ย่อชื่อ (เรียก Gemini) → เช็กกันสร้างซ้ำ (`linkedEntryId`) → สร้าง** — guard กับ create ติดกันโดยไม่มีการรอ Gemini คั่น (กดซ้ำระหว่างรอจะได้งานซ้ำ — ตรวจใน `scripts/check-flow-jobs.mjs`)
- งานเก่าที่ชื่อยังเป็นชื่อร้าน ย่อด้วย `npx tsx scripts/shorten-showcase-names.ts [--apply]` (เฉพาะงานยังไม่โพสต์, idempotent)

## รูปสินค้าจาก Showcase

- รูปมาเป็น thumbnail 300px (URL `...~tplv-…-resize-jpeg:300:300.jpeg`) — `importShowcaseBatch` โหลด `:0:0` (= ขนาดต้นฉบับ, `originalImageUrl` ใน `lib/showcase-import.ts`) ก่อน ไม่ได้ค่อยถอยไปลิงก์เดิม · CDN ของ ByteDance ไม่ต้องมี signature (ทดสอบสด 300x107 → 1861x661)
- สินค้าที่นำเข้าก่อน 2026-09-29 อัปเกรดรูปด้วย `npx tsx scripts/upgrade-showcase-images.ts <ไฟล์ JSON จาก extension>` (Angle ไม่เก็บลิงก์รูป ต้องใช้ไฟล์ export) — **สคริปต์นี้แก้ไฟล์ใน `uploads/_candidates/` ที่ใช้ร่วมกับ `dev.db` จริง** ทดสอบด้วยแถวปลอมที่มีโฟลเดอร์ของตัวเองเท่านั้น (แถวจริงบน `dev-test.db` = ไฟล์หายจากใต้ `dev.db`)
