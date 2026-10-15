# X01 — ทดสอบ Angle โดยไม่ใช้พื้นที่งานจริง

สถานะ: implementation + ชุดตรวจอัตโนมัติพร้อม · ไม่แก้ schema และไม่ต้อง migrate DB จริง

## เปิดใช้งาน

รันที่ root ของ repo ใน PowerShell หรือ Git Bash:

```text
node scripts/sandbox.mjs prepare my-test
node scripts/sandbox.mjs start my-test
```

prepare ใช้ SQLite online backup อ่าน `dev.db` แบบ read-only รวมข้อมูลที่ commit อยู่ใน WAL ไม่ใช้การก๊อป DB/WAL/SHM แยกกัน ไม่เรียก checkpoint บน DB จริง แล้วคัดลอกไฟล์ของ entry ล่าสุดและรูปจากร้านที่ผูกกับ entry นั้น

หากต้องการสินค้าตัวอื่น:

```text
node scripts/sandbox.mjs prepare product-test --entry <entry-id>
node scripts/sandbox.mjs start product-test
```

คำสั่งเตรียมจะแสดง entry ที่คัดลอกและจำนวนโฟลเดอร์รูปที่ขาด สำเนาเก็บ DB ทั้งชุด แต่ **คัดลอกสื่อเฉพาะ entry ที่เลือก** รายการอื่นยังเห็นในแอปแต่รูป/คลิปอาจโหลดไม่ได้ ไม่ fallback ไปอ่าน uploads จริง และนี่ไม่ใช่ชุด backup ธุรกิจครบทุกไฟล์ (B01 เป็นงานแยก)

ชื่อ sandbox ใช้อักษรเล็ก ตัวเลข และขีดกลาง ยาวไม่เกิน48ตัว ไม่เขียนทับ sandbox ที่มีอยู่แล้ว ถ้า prepare ล้มกลางทางให้ใช้ชื่อใหม่ ชุดที่ไม่เสร็จจะไม่มี sandbox.json จึงเปิดไม่ได้ ไม่มีคำสั่งลบทิ้งอัตโนมัติ

## ข้อมูลไปอยู่ที่ไหน

| สิ่งที่ใช้ | Production ตามเดิม | Sandbox |
|---|---|---|
| DB | dev.db | .scratch/sandboxes/ชื่อ/dev-test.db |
| รูป คลิป candidates และ failure evidence | uploads/ | .scratch/sandboxes/ชื่อ/uploads/ |
| การตั้งค่าเสียง/โควต้า | tts-settings.json | .scratch/sandboxes/ชื่อ/tts-settings.json |
| Worker config | flow-worker.config.json | .scratch/sandboxes/ชื่อ/flow-worker.config.json |
| Browser profile | ค่าใน worker config จริง | สำรอง path แยกไว้ แต่ **ห้ามเปิด live Flow** |
| Stop flag | .flow-worker.stop | .scratch/sandboxes/ชื่อ/.flow-worker.stop |
| ส่งออก | Desktop/TTS หรือ CLIP_EXPORT_ROOT ที่ตั้ง | .scratch/sandboxes/ชื่อ/exports/ |
| พื้นที่สำรองที่เตรียมไว้ | backups/ | .scratch/sandboxes/ชื่อ/backups/ |
| Next | .next + 3050 | .next-dev + 3051 เฉพาะ127.0.0.1 |

Production ยังใช้ path เดิมทั้งหมด ค่าที่ override ใน sandbox ต้องอยู่ภายใน root ของมัน และปฏิเสธ root ที่เป็น junction/symlink หรือไฟล์สำคัญที่เป็น hardlink

start จะตรวจ snapshot และพอร์ต3051ก่อนเริ่ม Next ไม่เรียก start.bat/stop.bat ไม่เปิด Flow หรือ media worker และส่ง API keys เป็นค่าว่างโดยมี precedence เหนือ .env จริง การกดสร้าง AI จึงยังใช้ไม่ได้จนมี workflow mock/อนุญาต live แยกภายหลัง หน้าแอปและไฟล์ export ทดสอบได้ตามปกติ

scanner token ในสำเนาถูกเปลี่ยน ไม่ใช้ token ของปลายทาง production และ heartbeat ของบอทในสำเนาถูกล้างเพื่อไม่ให้ดูเหมือนมีบอทรัน

## เงื่อนไขที่ระบบจะปฏิเสธ

- ตั้งเพียง DATABASE_URL เป็น DB สำเนาแต่ไม่ตั้ง ANGLE_SANDBOX_ROOT
- DB, uploads, settings, config, export, backup, profile หรือ stop flag ชี้ออกนอก sandbox
- Sandbox ใช้ .next แทน .next-dev
- เปิด worker/browser Flow ในโหมด sandbox; worker หลักออกก่อนแตะคิวหรือ stop flag ส่วน smoke browser ปฏิเสธก่อน launch
- start ชื่อที่ prepare ยังไม่สำเร็จ DB หาย/เสีย หรือพอร์ต3051ถูกใช้งาน

guard ทำก่อน Next รับคำขอ รวมถึงใน Prisma config และก่อนสร้าง client การเปลี่ยน root กลาง process ไม่ใช่ workflow ที่รองรับ ให้หยุด dev server ของตนก่อนเปลี่ยน sandbox

## ตรวจอัตโนมัติ

```text
node scripts/check-sandbox.mjs
node scripts/agent-checks.mjs --area sandbox --run
```

check-sandbox สร้าง repo fixture, SQLite, WAL, รูป/วิดีโอจำลองใน temp; ทดสอบ native backup, Prisma update, ตั้งค่า, export และลบรูปจริงใน fixture แล้วตรวจ hash ต้นทาง พร้อมทดสอบ path/junction/hardlink และเปิด worker ใน subprocess ที่ต้องออกโดยไม่เปิด Chrome ไม่อ่าน dev.db ของผู้ใช้

ไฟล์ MP4 ใน fixture เป็น bytes จำลองสำหรับทดสอบการส่งไฟล์ ไม่ได้ทดสอบคุณภาพภาพหรือ FFmpeg การตรวจเสียง/รวมคลิปเป็น UAT ของ Tickets M/V

## UAT ที่คนลองได้

1. เตรียม sandbox ชื่อใหม่และเปิด entry จากลิงก์ที่คำสั่งแสดง
2. ดูรูปที่คัดลอก แล้วแก้ค่าตั้งคลิปต่อวัน → ไฟล์ใน sandbox เปลี่ยน ไฟล์ root repo ไม่เปลี่ยน
3. เพิ่ม/ลบรูปของ entry ใน sandbox → production uploads ยังอยู่ (ใช้รูปสำเนาที่เลือกมาทดสอบ)
4. ส่งวัตถุดิบ/คลิปที่มีอยู่ → อยู่ใน exports ของ sandbox ไม่ออก Desktop/TTS จริง
5. ลองตั้ง ANGLE_UPLOAD_ROOT ให้ชี้ uploads จริงพร้อม sandbox env → startup ต้องปฏิเสธ ไม่เริ่มรับคำขอ
6. หยุด dev server ของตนเมื่อเสร็จ ไม่ใช้ stop.bat เพราะนั่นหยุดงานจริง; ตรวจ git diff tsconfig.json และคืนเฉพาะ include ที่ Next เติมสำหรับ .next-dev โดยรักษาการแก้อื่นไว้

ถ้าต้องเรียก DB integration scripts โดยตรง ให้ตั้ง env ก่อนโหลด Prisma ตัวอย่าง PowerShell (เปลี่ยนชื่อ my-test):

```powershell
$env:ANGLE_SANDBOX_ROOT = (Resolve-Path '.scratch/sandboxes/my-test').Path
$env:DATABASE_URL = 'file:' + (Join-Path $env:ANGLE_SANDBOX_ROOT 'dev-test.db')
$env:NEXT_DIST_DIR = '.next-dev'
npx tsx scripts/check-short-name-db.ts (Join-Path $env:ANGLE_SANDBOX_ROOT 'dev-test.db')
```

ใช้ terminal แยกสำหรับ env ชุดนี้และปิดหลังใช้; ถ้ามี override จาก shell เดิมชี้ของจริง guard จะปฏิเสธ อ่านข้อจำกัดของ script แต่ละตัวก่อนเสมอ ไม่ใช้ generated client ใหม่หรือ migration กับ DB จริงเพื่อแก้ปัญหาของ sandbox
