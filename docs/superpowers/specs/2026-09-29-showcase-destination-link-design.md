# Showcase Scanner — ลิงก์ปลายทาง (Destination link) แทนการผูกกับ Angle

วันที่ 2026-09-29 · จากการ grilling กับผู้ใช้ (คำศัพท์ดู `CONTEXT.md`: Angle, Showcase Scanner, Destination, Destination link) · เหตุผลของรูปแบบลิงก์ดู `docs/adr/0001-destination-link-secret-in-url.md`

## เป้าหมาย

Showcase Scanner จะแจกให้คนรู้จักใช้แบบส่วนตัว — ต้องไม่ผูกกับ Angle อีกต่อไป ผู้ใช้แต่ละคนต่อเข้าระบบของตัวเอง (Google Sheets / n8n / ระบบที่ให้ AI coding agent เขียน) ด้วยวิธีเดียวกัน และ Angle ก็ใช้วิธีเดียวกันนั้น

## การตัดสินใจ

1. **แจกเป็นไฟล์ zip** ให้ติดตั้งแบบ Load unpacked — ไม่ขึ้น Chrome Web Store · **ไม่มีคำเตือนเรื่องข้อตกลง TikTok** เจ้าของบัญชีรับความเสี่ยงเอง (ข้อจำกัดเดิมยังอยู่: อ่าน Showcase ของบัญชีตัวเอง, กดเองทุกครั้ง, ไม่รันเบื้องหลัง)
2. **สิทธิ์ `https://shop.tiktok.com/*` ขอตั้งแต่ติดตั้ง** (`host_permissions`) — เป็นหน้าที่หลักของ extension ไม่มีมันก็ใช้อะไรไม่ได้ · **ปลายทางไม่ต้องขอสิทธิ์ใดๆ** — ยืนยันสดแล้ว (2026-09-29) ว่าหน้า extension ที่ไม่มี host permission ของ localhost ยิง GET และ POST แบบ `text/plain` ไปปลายทางที่ตอบ CORS ได้ครบ → ไม่มี `optional_host_permissions` เลย ไม่มีปุ่มขอสิทธิ์
3. **Destination link** = URL เดียวที่มีรหัสฝังในลิงก์ เช่น `http://localhost:3000/api/scanner?token=…` — https บังคับ ยกเว้น `localhost`/`127.0.0.1` · ปลายทางต้องมีวิธี "สร้างลิงก์ใหม่" (ลิงก์เก่าใช้ไม่ได้ทันที)
4. **Protocol `showcase-scanner/1`** (สิ่งที่ปลายทางต้องทำ):
   - `POST <link>` — body เป็น JSON ของ export payload เดิม + field `protocol: "showcase-scanner/1"` ส่งด้วย `Content-Type: text/plain;charset=utf-8` (simple request ไม่มี preflight — ใช้กับ Google Apps Script ได้) ตอบ 2xx = รับแล้ว, 401/403 = ลิงก์ผิด/ถูกสร้างใหม่ — ปลายทางที่ตั้งสถานะไม่ได้ (Google Apps Script ตอบ 200 เสมอ) ให้ตอบ body `{"error":"unauthorized"}` แทน ซึ่ง extension ถือเท่ากับ 401 ทั้งตอน GET และ POST
   - `GET <link>` (ไม่บังคับ) — ตอบ `{ "protocol": "showcase-scanner/1", "productIds": [...], "lastReceivedAt": "<ISO>|null" }` ใช้ทั้งไฟสถานะและหยุดสแกนเอง
   - ทุก response ต้องมี `Access-Control-Allow-Origin: *`
5. **หยุดสแกนเองเมื่อเจอสินค้าที่ส่งไปแล้ว** — ถาม `GET` ก่อน ถ้าปลายทางไม่รองรับ ใช้ความจำของ extension ("ส่งไปแล้ว" = ทุก ID ใน POST ที่ได้ 2xx) · **ตัด `acceptedIds` ออกจาก protocol** (เคยเสนอในการคุย): ถ้าจำเฉพาะตัวที่ปลายทาง "รับไว้" สินค้าหมดสต็อกที่ Angle ข้ามจะกลายเป็น "ใหม่" ทุกรอบ หยุดเองไม่ทำงาน — สิ่งที่ต้องจำคือ "ส่งแล้ว" · runner นับสินค้าที่ TikTok บอกว่าตายแล้ว (`hasStatusPopup`) เป็น "รู้จักแล้ว" ตอนเช็กหน้า เพราะปลายทางไม่เก็บตัวพวกนี้ ไม่งั้นหน้าที่มีสินค้าตายปนจะไม่มีวันนับเป็นหน้าที่รู้จักแล้ว
6. **ไฟบน popup**: 🟢 ปลายทางตอบ GET ถูกรูปแบบ (บอกจำนวนสินค้า + รับล่าสุดเมื่อ) · ⚪ ปลายทางไม่บอกสถานะ แต่ส่งได้ (บอก "ส่งสำเร็จล่าสุดเมื่อ …" จากความจำ) ปุ่มสแกนกดได้ · 🔴 ติดต่อไม่ได้ / ลิงก์ใช้ไม่ได้แล้ว (401/403) · ⚪ ยังไม่ได้ใส่ลิงก์ (ปุ่มสแกนกดไม่ได้)
7. **Angle ใช้ลิงก์ปลายทางแบบเดียวกัน** — token เก็บใน DB (ตาราง singleton) ไม่ใช่ `.env` · หน้า "หาสินค้า" มีปุ่มคัดลอกลิงก์ + สร้างลิงก์ใหม่ · ลบ route เดิมทั้ง 3 (`/api/showcase-import`, `/known-ids`, `/health`) และการเช็ก `x-showcase-secret`/`SHOWCASE_IMPORT_SECRET` ทั้งหมด (มีผู้ใช้คนเดียว ไม่ต้องรองรับของเก่า)
8. **ปลายทางเดียว** — อยากส่งหลายที่ให้ใช้หลายโปรไฟล์เบราว์เซอร์
9. **เอกสารสำหรับ AI coding agent** (`showcase-extension/docs/INTEGRATION.md`) พร้อมตัวอย่าง Google Apps Script / Node (Express) / Next.js route — ใส่ใน zip พร้อมคู่มือติดตั้ง (`INSTALL.md`)
10. **หน้าจัดการเหลือแค่ของที่ใช้จริง** — หลัก: สแกน → ผลลัพธ์ → ส่ง + export JSON · ส่วน "ตั้งค่า" พับไว้ (กางเองเมื่อยังไม่มีลิงก์): ลิงก์ปลายทาง, หยุดเอง, ล้างความจำ, เครื่องมือ probe
