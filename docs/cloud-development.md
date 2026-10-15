# พัฒนาต่อบน Codex Cloud

เอกสารนี้เป็น handoff ของโค้ด ไม่ได้หมายความว่าสร้างหรือ Publish Cloud Environment แล้ว

เลือก branch ที่มี `docs/angle-system-master-plan.md`, `lib/runtime-paths.ts` และ `scripts/sandbox.mjs` ไม่ใช่ master เก่าที่อาจยังไม่มีงานเหล่านี้

## Setup สำหรับอ่าน/แก้โค้ดและทดสอบ offline

ต้องมี Node.js ที่รองรับ dependencies ใน package-lock และ native better-sqlite3 (เครื่องที่ตรวจล่าสุดใช้ Node24) จากนั้นรันที่ root repo:

```sh
npm ci
npx prisma generate
node scripts/agent-checks.mjs --area baseline --run
node scripts/check-sandbox.mjs
```

`prisma generate` สร้าง client ที่ gitignore ไว้ ไม่ต้องนำ generated client จาก Windows ไปใช้บน Linux และไม่ deploy migration ของเครื่องจริง check-sandbox สร้าง SQLite/schema/ไฟล์ fixture เองใน temp จึงไม่ต้องอัปโหลด dev.db, uploads หรือ API key

Skill `angle-checks` อยู่ใน `.agents/skills/angle-checks/` ให้ agent อ่าน SKILL.md ใน repo ได้ และ discovery รองรับใน environment ที่เปิด repo skills

## หากต้องเปิด UI ด้วยฐานข้อมูลว่าง

คำสั่งตัวอย่างสำหรับ shell Linux ภายใน cloud workspace เท่านั้น:

```sh
export ANGLE_SANDBOX_ROOT="$PWD/.scratch/sandboxes/cloud-ui"
export DATABASE_URL="file:$ANGLE_SANDBOX_ROOT/dev-test.db"
export NEXT_DIST_DIR=.next-dev
export GEMINI_API_KEY=""
export TYPESAFE_API_KEY=""
mkdir -p "$ANGLE_SANDBOX_ROOT/uploads" "$ANGLE_SANDBOX_ROOT/exports"
npx prisma db push
node -e 'const fs = require("node:fs"); const path = require("node:path"); const root = process.env.ANGLE_SANDBOX_ROOT; const config = JSON.parse(fs.readFileSync("flow-worker.config.json", "utf8")); config.profileDir = path.join(root, ".flow-profile"); fs.writeFileSync(path.join(root, "flow-worker.config.json"), JSON.stringify(config)); fs.writeFileSync(path.join(root, "tts-settings.json"), JSON.stringify({autoGenerateTts: false, autoMergeVideo: false}));'
npm run dev -- --hostname 0.0.0.0 -p 3051
```

db push ข้างต้นใช้สร้าง schema ของ DB ว่างเฉพาะ sandbox ไม่ใช่ขั้นตอน deploy ของ production และไม่ใช้ `scripts/sandbox.mjs prepare` เพราะบน cloud ไม่มี DB จริงเป็นต้นทาง การ preview พอร์ตใน cloud ต้องใช้วิธีที่ environment นั้นรองรับ ไม่ใช่ localhost ของมือถือโดยตรง

## ขอบเขตงานระหว่างปิดคอม

- ทำ Ticket ทีละใบ เริ่มจากสถานะใน Master Plan; X01/X05 มี implementation แล้ว
- ไม่เริ่ม Flow worker หรือใช้โปรไฟล์จริง การตรวจบัญชี/เรนเดอร์ Flow บน Windows ทำภายหลังเมื่อเปิดเครื่อง
- รายงานแยก type/lint, offline fixture checks, UI และ live checks; ไม่อ้างว่าทดสอบครบจาก mock
- ไม่อัปโหลด `.env`, DB จริง, รูป/คลิป, scanner token หรือ browser profile; ไม่ใส่ credentials ลง source
- บันทึกผลเป็น commit/PR และระบุว่าทำ Ticket ใด ก่อนนำผลกลับมาที่เครื่องจริง
