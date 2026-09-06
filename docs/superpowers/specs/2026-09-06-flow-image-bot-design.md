# บอทวาดรูปอ้างอิงสินค้าผ่าน Google Flow — Design

วันที่: 2026-09-06 · สถานะ: รอผู้ใช้ทวน → spike → implement
branch: `flow-image-bot`

## 1. เป้าหมาย

ทุกสินค้า ผู้ใช้ต้องเข้า Google Flow ไปสั่งวาดรูป 2 รอบ (รอบละ 4 รูป เลือก 1) เพื่อได้ "รูปสินค้าพื้นหลังขาว" กับ "รูปสินค้าตอนใช้งาน" มาเป็นรูปอ้างอิงในแอป ก่อนถึงขั้น caption → สกัดสเปก → สร้าง 10-part prompt — ขั้นนี้เป็นงานคลิกซ้ำๆ ที่ทำทุกสินค้า และการเจนรูปใน Flow **ไม่กินเครดิต**

ระบบนี้ให้บอททำขั้นนั้นแทน แบบ **สะสมสินค้าไว้แล้วสั่งรันเป็นชุด** (เช่นข้ามคืน) ผู้ใช้เหลือแค่มาไล่กดเลือกรูปที่ตรงสินค้าจริง

เหตุผลที่เลือก Flow (ไม่ใช่ Gemini API ตรง): ผู้ใช้ไม่ต้องการต้นทุนเพิ่ม (Nano Banana 2 ผ่าน API ≈ ฿12-18/สินค้า) และบอทตัวนี้คือรากฐานของบอทเจนวิดีโอในอนาคตซึ่งไม่มี API ราคาเทียบเท่า ผู้ใช้มีบัญชี Flow สำรอง 2 บัญชี ยอมเอา 1 บัญชีมาเสี่ยง

## 2. ไม่ทำในรอบนี้ (non-goals)

- **ไม่เจนวิดีโอ** — รูปอย่างเดียว วิดีโอเป็นโปรเจกต์ถัดไปที่ต่อยอดจาก primitive ชุดนี้
- ไม่ใช้ Gemini API เป็น fallback (ผู้ใช้ตัดออกเอง)
- ไม่ทำโหมดคู่ขนาน (บอทวิ่งตลอดขณะผู้ใช้หาสินค้า) — เป็นคิวที่สั่งรันเป็นชุด
- ไม่แก้พรอมต์ที่ส่งให้ Flow จาก UI — พรอมต์ 2 แบบตายตัว (ปุ่ม "วาดใหม่" ใช้พรอมต์เดิม)
- ไม่ใช้ proxy / ไม่ปลอม fingerprint / ไม่รันหลาย session / ไม่ reset cookie อัตโนมัติเมื่อโดนสัญญาณ
- ไม่ห่อ `gflow-cli` (ใช้ซอร์สของมันเป็นแผนที่ DOM ของ Flow เท่านั้น)

## 3. workflow ของผู้ใช้ (หลังมีระบบ)

```
[คุณ]  สร้าง entry ตามเดิม (extractProductInfo ให้ productName แล้ว)
       → อัปรูปแคปสินค้าจาก TikTok Shop (1+ รูป) → กด "เข้าคิว Flow"   ← ทำหลายตัวสะสม
[คุณ]  เปิด flow-worker.bat แล้วปล่อย
[บอท]  รอบ 1: แนบรูปแคป + "ขอภาพสินค้าอย่างเดียวเท่านั้น พื้นหลังขาว สินค้าคือ "<productName>""
       3:4 · ×4 · nano banana 2 → โหลด 4 รูป → สถานะ "รอคุณเลือก รอบ 1"
[คุณ]  หน้า /flow → กดเลือก 1 (หรือ "วาดใหม่") → "รอบอท รอบ 2"
[บอท]  รอบ 2: รูปที่เลือกเป็นรูปอ้างอิง + "ขอภาพสินค้าตอนใช้งาน สินค้าคือ "<productName>""
       ×4 โมเดลเดิม → "รอคุณเลือก รอบ 2"
[คุณ]  กดเลือก 1 → 2 รูปที่เลือกกลายเป็น ProductImage ของ entry (caption ตั้งต้นให้)
       → ต่อ caption / สกัดสเปก / สร้าง prompt ตามเดิม ไม่มีอะไรเปลี่ยน
```

## 4. สถาปัตยกรรม — 3 ชิ้น คุยกันผ่านตารางเท่านั้น

```
① Next.js app (เดิม)  ⇄  ② ตารางคิวใน dev.db  ⇄  ③ worker (โปรเซสแยก + Chrome ของตัวเอง)
```

- เว็บกับบอท**ไม่รู้จักกัน** — ไม่มี HTTP/WebSocket ระหว่างกัน ตายฝั่งหนึ่งอีกฝั่งไม่ตาย
- บอทเป็น Node process แยก (`worker/`) เปิดด้วย `flow-worker.bat` ปิดด้วย `flow-worker-stop.bat` (คู่กับ `start.bat`/`stop.bat` เดิม)
- ใช้ Prisma client ตัวเดียวกับแอป (`lib/prisma.ts`) · Playwright เปิด **Chrome จริง** (`channel: "chrome"`, headed) ด้วย persistent profile ที่ `.flow-profile/` (gitignore) — Google บังคับ headed + auth จริง

### 4.1 SQLite ต้องเปิด WAL

`dev.db` ตอนนี้ไม่ได้เปิด WAL — ถ้าบอทเขียนพร้อมเว็บจะชน `database is locked` ให้รัน `PRAGMA journal_mode=WAL` ครั้งเดียว (ติดไปกับไฟล์ถาวร) และตั้ง `busy_timeout` 5000 ms ในทั้งสองโปรเซส ผลข้างเคียง: มี `dev.db-wal`/`dev.db-shm` ข้างๆ — **backup ต้องก๊อป 3 ไฟล์ด้วยกัน หรือ `PRAGMA wal_checkpoint(TRUNCATE)` ก่อน** (จดลง CLAUDE.md)

## 5. Data model (เพิ่ม 3 ตาราง ไม่แก้ตารางเดิม)

```prisma
model FlowJob {
  id            String   @id @default(cuid())
  entryId       String
  entry         PromptEntry @relation(fields: [entryId], references: [id], onDelete: Cascade)
  status        String   // ดู state machine ข้อ 6
  round         Int      @default(1)      // 1 | 2
  attempt       Int      @default(1)      // เพิ่มทุกครั้งที่กด "วาดใหม่" ของรอบนั้น
  failedStep    String   @default("")     // ชื่อขั้นที่พัง เช่น "click-generate"
  errorKind     String   @default("")     // selector_drift | login_required | captcha | generation_timeout | flow_error | download_failed | worker_crash
  errorMessage  String   @default("")
  failureDir    String   @default("")     // uploads/_flow-failures/<jobId>-<ts>/
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  startedAt     DateTime?                 // เริ่มรอบล่าสุด
  finishedAt    DateTime?
  images        FlowJobImage[]
}

model FlowJobImage {
  id        String  @id @default(cuid())
  jobId     String
  job       FlowJob @relation(fields: [jobId], references: [id], onDelete: Cascade)
  kind      String  // "source" (รูปแคปที่ผู้ใช้อัป) | "candidate" (รูปที่ Flow วาด)
  round     Int     @default(0)   // candidate: 1|2 · source: 0
  attempt   Int     @default(1)
  index     Int     @default(0)   // ลำดับใน 4 รูป
  filename  String                // ใต้ uploads/<entryId>/flow/
  mimeType  String
  chosen    Boolean @default(false)
  createdAt DateTime @default(now())
}

model FlowWorkerState {          // แถวเดียว id = "singleton"
  id             String    @id
  lastSeenAt     DateTime?
  currentJobId   String?
  pausedReason   String    @default("")   // ว่าง = ไม่หยุด · ไม่ว่าง = หยุดทั้งคิว
  pausedAt       DateTime?
  todayDate      String    @default("")   // "YYYY-MM-DD" local
  todayBatches   Int       @default(0)    // ชุด 4 รูปที่วาดวันนี้
  sessionStreak  Int       @default(0)    // สินค้าติดต่อกันตั้งแต่พักยาวครั้งล่าสุด
  nextWakeAt     DateTime?                // บอทวางแผนจะหยิบงานถัดไปเมื่อไหร่ (ให้ UI โชว์)
  updatedAt      DateTime  @updatedAt
}
```

- ไฟล์รูป: `uploads/<entryId>/flow/source-*.{ext}` และ `uploads/<entryId>/flow/r<round>-a<attempt>-<index>.png` — เสิร์ฟผ่าน `app/api/uploads/[...path]/route.ts` เดิม
- 1 entry มี FlowJob ที่ยังไม่จบ (`status ∉ {done, skipped}`) ได้ทีละ 1 — บังคับใน action
- ตอน approve รอบ 2: ก๊อป 2 ไฟล์ที่ `chosen` ไปเป็น `uploads/<entryId>/` + สร้าง `ProductImage` 2 แถว (`sortOrder` 0,1 · caption ตั้งต้น `"สินค้า พื้นหลังขาว"` / `"สินค้าตอนใช้งาน"`) — `ProductImage` semantics เดิมไม่เปลี่ยนเลย ทุก pipeline ที่อ่าน `productImages` ไม่ต้องรู้จัก Flow

## 6. State machine ของ FlowJob

```
queued_r1 → running_r1 → review_r1 ─(เลือก 1)→ queued_r2 → running_r2 → review_r2 ─(เลือก 1)→ done
                                    └(วาดใหม่)→ queued_r1 (attempt+1)          └(วาดใหม่)→ queued_r2 (attempt+1)
running_r* ──(พัง)──→ failed ─(รันต่อ หลังซ่อม)→ queued_r<round> (attempt เดิม)
                            └(ข้าม)→ skipped
```

- `review_*` เก็บ candidate ทุก attempt ไว้ (ไม่ลบ) เพื่อเป็นข้อมูลว่าโมเดลเพี้ยนบ่อยแค่ไหน UI โชว์เฉพาะ attempt ล่าสุด
- ตอน worker เริ่มทำงาน ถ้าเจอ job ค้าง `running_*` (worker ตายกลางคัน) → `failed` / `worker_crash` ไม่ reset เป็น queued เอง (กัน loop ถ้าพังซ้ำ)

## 7. พฤติกรรมของ worker

### 7.1 loop หลัก

1. heartbeat ทุก 30 วิ → `FlowWorkerState.lastSeenAt`
2. ถ้า `pausedReason` ไม่ว่าง → นอนรอ (poll 30 วิ) จนผู้ใช้กด "รันต่อ"
3. ถ้านอกช่วง `activeHours` หรือ `todayBatches ≥ dailyBatchCap` → นอนถึงเวลาถัดไป (เขียน `nextWakeAt`)
4. หยิบ job `queued_r2` ก่อน (คนรออยู่) แล้วค่อย `queued_r1` เรียงตาม `createdAt` — claim ด้วย `updateMany({where:{id,status:queued_*}})` กันหยิบซ้ำ
5. ทำรอบ (ข้อ 7.2) → เขียนผล → `sessionStreak++`, `todayBatches++`
6. พักตามข้อ 7.3 → วน

### 7.2 ขั้นตอน 1 รอบ (ทุกขั้นมีชื่อ = `failedStep`)

`open-flow` → `ensure-project` → `attach-reference` (รอบ 1: อัปรูปแคป · รอบ 2: ใช้รูปที่เลือกจาก candidate) → `set-aspect-3-4` → `set-count-4` → `set-model-nano-banana-2` → `type-prompt` → `click-generate` → `wait-results` → `dwell` (รอสุ่มเหมือนคนดูรูป) → `download-4` → `verify-files`

รายละเอียด DOM/selector ของแต่ละขั้น **ยังไม่รู้ — จะรู้จาก spike** (ข้อ 10) และเก็บใน `worker/flow-selectors.ts` ไฟล์เดียว เพื่อให้วันที่ Flow เปลี่ยนหน้าแก้ที่เดียว

### 7.3 ทำตัวเหมือนคน — ทุกค่าอยู่ใน `flow-worker.config.json`

| key | ค่าเริ่มต้น | ความหมาย |
|---|---|---|
| `actionDelayMs` | `[800, 3000]` | หน่วงสุ่มก่อนทุกคลิก |
| `typeCharDelayMs` | `[40, 120]` | พิมพ์ทีละตัวอักษร |
| `dwellAfterResultsMs` | `[5000, 25000]` | นั่งดูรูปก่อนโหลด |
| `betweenBatchesMs` | `[20000, 60000]` | พักระหว่างชุด 4 รูป |
| `betweenProductsMs` | `[120000, 360000]` | พักระหว่างสินค้า |
| `longBreakEvery` | `[4, 6]` | ทำกี่สินค้าติดกันแล้วพักยาว (สุ่มใหม่ทุกครั้ง) |
| `longBreakMs` | `[900000, 2400000]` | พักยาว 15-40 นาที |
| `dailyBatchCap` | `24` | ชุด 4 รูป/วัน (= 12 สินค้า) reset เที่ยงคืน local |
| `activeHours` | `null` | เช่น `["22:00","07:00"]` · null = ตลอดเวลา |
| `generationTimeoutMs` | `300000` | รอผลเกินนี้ = `generation_timeout` |
| `mouse` | `{ curve: true, idleScrollChance: 0.3 }` | เลื่อนเมาส์เป็นเส้นโค้งหลาย step ไม่วาร์ป · บางทีเลื่อนหน้าเปล่าๆ |

หลักการ: Chrome จริง 1 ตัว · PC จริง · IP บ้าน · บัญชีเดียว — ไม่ปลอมอะไรเพิ่ม เริ่มระวังก่อน ค่อยขยับเพดานเมื่อไม่มีสัญญาณอะไรเป็นสัปดาห์

### 7.4 กฎหยุด (หยุดทั้งคิว ไม่ลองซ้ำเอง)

เจออย่างใดอย่างหนึ่ง → job นั้น `failed` + `FlowWorkerState.pausedReason` = errorKind + เก็บหลักฐาน:

| errorKind | ตรวจจากอะไร |
|---|---|
| `selector_drift` | หา element ของขั้นนั้นไม่เจอภายใน timeout |
| `login_required` | URL เด้งไปหน้า accounts.google.com / เจอปุ่ม Sign in |
| `captcha` | เจอ iframe/element ของ reCAPTCHA หรือข้อความ "unusual traffic" |
| `generation_timeout` | รอผลเกิน `generationTimeoutMs` |
| `flow_error` | Flow ขึ้น toast/dialog error หลังกดสร้าง |
| `download_failed` | ได้ไฟล์ไม่ครบ 4 / ไฟล์ 0 byte / ไม่ใช่รูป |
| `worker_crash` | exception ที่ไม่ได้จำแนก หรือเจอ job ค้าง running ตอนเริ่ม |

หลักฐานที่ `uploads/_flow-failures/<jobId>-<ts>/`: `screenshot.png` (full page) · `page.html` · `steps.log` (เวลาแต่ละขั้น) · `state.json` (todayBatches, sessionStreak, เวลาห่างจากชุดก่อน) — ข้อมูลชุดหลังคือของที่ได้จากการเอาบัญชีสำรองมาเสี่ยง: รู้ว่าเจอสัญญาณตอนทำไปแล้วเท่าไหร่ จะได้ปรับ config ให้ระวังขึ้น**ก่อน**โดนแบนจริง

ผู้ใช้กด "รันต่อ" (หลังซ่อม selector / login ใหม่ในหน้าต่างบอท) → `pausedReason` ว่าง + job → `queued_r<round>` · กด "ข้าม" → `skipped` + `pausedReason` ว่าง

## 8. UI

### 8.1 หน้า entry (`components/entry-workspace.tsx` แท็บ ①) — แตะน้อยที่สุด

- แผงใหม่ "รูปแคปสินค้า → Flow": อัปโหลดรูปแคป 1+ รูป (`FlowJobImage kind=source`) + ปุ่ม "เข้าคิว Flow" (สร้าง `FlowJob queued_r1`)
- ถ้ามี job ที่ยังไม่จบ: โชว์สถานะ 1 บรรทัด + ลิงก์ไป `/flow` แทนปุ่ม
- ต้องมี `productName` ก่อน (ปุ่ม disabled ถ้าว่าง) เพราะพรอมต์ใช้ชื่อ

### 8.2 หน้า `/flow` (ใหม่ · เมนูใน `components/app-header.tsx` คู่กับ Dashboard / Core Prompt)

- แถบบน: บอทหายใจอยู่ไหม (`lastSeenAt` < 90 วิ = เขียว) · วันนี้ทำไปกี่ชุด/เพดาน · `nextWakeAt` · นับ job ต่อสถานะ · ถ้า `pausedReason` ไม่ว่าง → แถบแดง + สาเหตุ + ปุ่ม "รันต่อ"/"ข้าม" ที่ job ที่พัง
- แต่ละ job = 1 แถว เรียง: `review_*` ก่อน (คนต้องทำ) → `failed` → `queued/running` → `done` (7 วันล่าสุด)
- แถว `review_*`: **รูปแคปต้นทางวางซ้ายสุดเสมอ** + 4 candidate (attempt ล่าสุด) · กดรูปไหนก็ได้เพื่อขยาย (lightbox: ซ้าย=แคป ขวา=candidate สลับได้ด้วยลูกศร) · ปุ่ม "ใช้รูปนี้ → รอบ 2" / "ใช้รูปนี้ → บันทึกเป็นรูปสินค้า" · ปุ่ม "ไม่ผ่านสักรูป วาดใหม่" (พรอมต์เดิม)
- แถว `failed`: `failedStep` + `errorKind` + ลิงก์ screenshot / page.html
- แถว `done`: 2 รูปที่เลือก + ลิงก์ไป entry
- ยึดกฎ UI ใน CLAUDE.md ทั้งหมด (ปุ่ม ≥44px ต่ำกว่า `lg:`, token สี, ไม่มี arbitrary text size, 1440px checkpoint) · เช็ก 390/820/1440 ด้วย `scripts/shot.mjs`

### 8.3 Server Actions ใหม่ (`app/actions.ts`)

`enqueueFlowJob(entryId, formData)` · `chooseFlowCandidate(jobId, imageId)` (ทำทั้ง round 1→queued_r2 และ round 2→done+ProductImage ตาม round) · `redoFlowRound(jobId)` · `resumeFlowWorker(jobId)` · `skipFlowJob(jobId)` — ทุกตัว `revalidatePath("/flow")` และ `/entry/[id]` ที่กระทบ

## 9. โครงไฟล์

```
worker/
  index.ts              loop หลัก + heartbeat + กฎหยุด
  flow-driver.ts        ขั้นตอน 1 รอบ (ข้อ 7.2) — รับ page + job คืน 4 ไฟล์ หรือ throw FlowStepError(step, kind)
  flow-selectors.ts     selector ทุกตัวรวมที่เดียว
  humanize.ts           sleepRange / typeHuman / moveMouseCurve / idleScroll
  config.ts             โหลด+validate flow-worker.config.json (zod)
  failure.ts            เก็บหลักฐานพัง
flow-worker.config.json
flow-worker.bat / flow-worker-stop.bat
lib/flow-jobs.ts        pure: state transitions + คำนวณสถานะสรุป (ทดสอบแยกได้ เหมือน lib/entry-rows.ts)
app/flow/page.tsx · components/flow-queue.tsx · components/flow-review-row.tsx · components/flow-lightbox.tsx
prisma/migrations/<ts>_flow_jobs/
```

- `playwright` เพิ่มเป็น dependency จริงของ repo (เดิมตั้งใจไม่ใส่ — ตอนนี้ worker ต้องใช้ตอนรัน) · worker รันด้วย `tsx` (รองรับ `@/*` path alias จาก tsconfig)
- `.gitignore` เพิ่ม `.flow-profile/`, `uploads/_flow-failures/`

## 10. Spike ก่อนสร้างของจริง (โค้ดทิ้งได้ อยู่ใน scratch · บัญชีสำรอง)

| ขั้น | พิสูจน์ | ผ่านเมื่อ |
|---|---|---|
| S1 | persistent profile จำ login | login มือ 1 ครั้ง → ปิด/เปิด Chrome ใหม่ ยังอยู่ใน Flow |
| S2 | ทำรอบ 1 ครบ | ได้ 4 ไฟล์ png 3:4 ใน scratch จากรูปแคป+พรอมต์จริง ตั้งค่า ×4 / nano banana 2 ได้ |
| S3 | รอบ 2 อ้างอิงรูปที่เพิ่งวาด | รู้ว่า Flow ให้ "ใช้รูปที่วาดเป็น reference" ผ่านปุ่มไหน (หรือต้องดาวน์โหลดแล้วอัปกลับ) · ได้ 4 ไฟล์ |
| S4 | fail-fast | จงใจใส่ selector ผิด → หยุดทันที + screenshot/html/log ครบ ไม่วนลอง |

สิ่งที่ต้องบันทึกจาก spike (ลงท้าย spec นี้เป็น "Spike findings" ก่อนเขียน plan): selector จริงทุกขั้น · Flow เก็บผลไว้ใน project ยังไง (ต้องสร้าง project ใหม่ต่อสินค้าไหม) · วิธีอ้างอิงรูปรอบ 2 · เวลาเจนจริงต่อชุด · โควตารูปต่อวันของบัญชีสำรอง (ถ้า Flow แสดง) · Google ย้ายจาก `labs.google/fx/tools/flow` ไป `flow.google.com` แล้วหรือยังสำหรับบัญชีนี้

ระหว่างนี้อ่านซอร์ส `ffroliva/gflow-cli` (Python/Playwright) เป็นแผนที่ DOM — ไม่ห่อใช้

## 11. การทดสอบ / verification

- `lib/flow-jobs.ts` (transitions) มี unit test แบบ node script เหมือน `lib/entry-rows.ts`
- `worker/humanize.ts` ทดสอบว่า sleepRange/typeHuman อยู่ในช่วง config
- S4 คือ test ของกฎหยุด — ทำซ้ำได้ด้วย env `FLOW_FORCE_FAIL_STEP=click-generate` ใน worker
- UI: `npx tsc --noEmit` + `npm run lint` + `node scripts/check-contrast.mjs` + `scripts/shot.mjs` 3 ขนาด บน `dev-test.db` (ห้ามใช้ `dev.db` จริง)
- end-to-end จริง: 2-3 สินค้าบนบัญชีสำรอง ผ่านครบ enqueue → review → done → เห็น ProductImage ใน entry

## 12. ความเสี่ยงที่รับไว้

- **ผิด ToS Google** — บัญชีสำรองอาจถูกจำกัด/แบน ผู้ใช้รับทราบและตั้งใจใช้บัญชีนี้เรียนรู้ ไม่แตะบัญชีหลัก
- **Flow เปลี่ยนหน้า** → บอทหยุดจนกว่าจะแก้ `flow-selectors.ts` — ออกแบบให้หยุดเร็วและมีหลักฐานครบ ไม่ใช่ป้องกันไม่ให้พัง
- **PC ต้องเปิดค้าง + หน้าต่าง Chrome ของบอทเปิดอยู่** ตลอดช่วงทำงาน (ย่อได้ ปิดไม่ได้)
- **เพดาน/สัญญาณของ Google ไม่รู้ล่วงหน้า** — ค่า config เริ่มระวัง แล้วปรับจากข้อมูลใน `state.json` ของ failure

## Spike findings (บันทึกระหว่างทำ Task 3-4, 2026-09-06)

### S1 — session persists + host detection (รันโดยผู้ใช้ + controller)

- ผู้ใช้ login บัญชีสำรอง (`khetgammerz@gmail.com`) ผ่าน `flow-login.bat` ครั้งเดียว แล้วปิด Chrome
- Controller รัน `npm run flow-smoke:s1` **2 รอบ** ได้ผลเหมือนกันทั้งคู่:
  ```
  URL=https://flow.google.com/?hl=en
  HOST=flow.google.com
  EMAIL=khetgammerz@gmail.com
  LOGGED_IN=yes
  SELECTOR_SET=migrated
  ```
  → **session persist จริง** (ยืนยันได้จากรัน 2 รอบแยกกันของ Chrome ไม่ต้อง login ซ้ำ)
- **บัญชีนี้ถูกย้ายไปเว็บใหม่ (`flow.google.com`) แล้ว** — ไม่ใช่ `labs.google` classic ที่ selector ชุด `labs` (ยืนยันจาก gflow-cli) ใช้ได้ตรงๆ ต้องใช้ชุด `migrated` ซึ่งตอนเขียนแผนมีแค่ "คำใบ้" ยังไม่ยืนยัน
- `worker/smoke/out/s1-dom.txt` (หน้า gallery ก่อนเข้า project): ยืนยัน UI เป็น **Angular Material** จริง (`mat-icon`, `mdc-button`, ไม่มี `<i class="google-symbols">` เลย) — ปุ่มสร้าง project ใหม่คือ `button.new-project-button` มี `mat-icon` ข้อความ `add` (`icons=[add] text="add New project"`) label ทุกอย่างเป็น **ภาษาอังกฤษ** เพราะบอทเปิดด้วย `locale: "en-US"` + query `?hl=en` (คงอยู่ผ่าน redirect)

### การทดสอบเจนรูปด้วยมือผ่าน Claude extension (บัญชีเดียวกัน, 2026-09-06)

ผู้ใช้สั่ง Claude extension (ควบคุมเบราว์เซอร์ปกติ ภาษาอินเตอร์เฟซเป็น**ไทย** ต่างจากบอทที่บังคับอังกฤษ — โครงสร้างเหมือนกัน แค่ label เป็นคนละภาษา) ให้ลองวาดรูปสินค้า "ที่ลับเล็บแมว" ตามขั้นตอนที่บอทจะทำจริง — **สำเร็จ ได้ครบ 4 รูป ใช้เครดิต 0** (ข้อความในแอปเอง: "การสร้างจะใช้ 0 เครดิต") **ยืนยันว่าฟีเจอร์เจนรูปมีจริงบนเว็บใหม่ ไม่ใช่แค่ทำ UI มาแต่ยังไม่เปิดใช้**

โครงสร้างหน้าจอที่เจอ (แปลเป็นแนวคิด ไม่ใช่ selector — label ที่เห็นเป็นภาษาไทยของบัญชีนั้น บอทจะเห็นเป็นอังกฤษแทน):

1. **หน้า Home/gallery** → การ์ด/ปุ่ม "+ โปรเจกต์ใหม่" ท้าย feed (ตรงกับ `s1-dom.txt`)
2. **หน้า project**: sidebar ซ้าย (สื่อทั้งหมด/รูปภาพ/ตัวละคร/ฉาก/รายการที่อัปโหลด/เครื่องมือ/ถังขยะ/ยุบ) + prompt bar ล่างสุด placeholder "คุณต้องการสร้างอะไร" (EN: "What do you want to create")
3. **ปุ่ม "+" ซ้ายของ prompt bar** → เปิด **media picker แบบ dialog/overlay** มีแท็บ (ทั้งหมด/รูปภาพ/วิดีโอ/เสียง/ตัวละคร/รูปโปรไฟล์/**การอัปโหลด**) ปุ่มล่างซ้าย "อัปโหลดสื่อ" (Upload media) → เปิด native file chooser → เลือกรูป → ปุ่ม "**เพิ่มไปยังพรอมต์**" (Add to prompt) ยืนยัน
4. **ไอคอนตั้งค่า** (สี่เหลี่ยม อยู่หน้าตัวเลือกจำนวน) เปิด panel: toggle รูปภาพ/วิดีโอ · **aspect ratio เป็นกลุ่มตัวเลือก 5 แบบ**: 16:9, 4:3, 1:1, **3:4**, 9:16 · **model เป็น dropdown** มี emoji 🍌 นำหน้า "Nano Banana 2" · **จำนวนเป็นปุ่ม x1/x2/x3/x4** · ข้อความเครดิตอยู่ล่างสุดของ panel
5. **ปุ่ม generate = ลูกศร ขวาสุดของ prompt bar** (ตรงกับที่ gflow-cli อธิบายไว้สำหรับ labs.google — ไอคอน `arrow_forward` ยังเป็นแนวคิดเดียวกันบนเว็บใหม่ แค่เปลี่ยนเป็น `mat-icon`)
6. **ผลลัพธ์เรนเดอร์เป็น gallery/timeline** มี caption ระหว่างรอ ("Requesting product im..." — เห็นแม้พรอมต์เป็นไทย แปลว่า Flow แปลพรอมต์เป็นอังกฤษก่อนประมวลผลภายใน) รูปที่ได้ตรงอัตราส่วน 3:4 ที่ตั้งไว้ทุกรูป

**สรุปสำหรับ Task 4:** ใช้ชุด selector `migrated` เป็นหลัก อิง Angular Material (`mat-icon`, `.cdk-overlay-pane` สำหรับ dialog/panel ลอย) ตามโครงสร้าง 6 ขั้นข้างต้น — ยังต้องยืนยัน class/selector จริงด้วย dump DOM สดตอนอยู่ในหน้า project (s1-dom.txt มีแค่หน้า gallery) ผ่านกระบวนการ debug loop ที่ระบุไว้ใน Task 4 Step 8 อยู่แล้ว

### S2 — รอบเต็ม 12 ขั้นบน flow.google.com (Task 4, 2026-09-06)

- **ผ่านจริง 3 รอบติดกัน** ได้ 4 ไฟล์ JPEG ขนาด 896×1200 (= 3:4 เป๊ะ) ทุกรอบ · เวลาเจนนับจากกด
  generate จนครบ 4 รูปอยู่ที่ **33-45 วินาที** (รูปทยอยโผล่ทีละใบ ไม่ได้มาพร้อมกัน)
- selector ชุด `migrated` ยืนยันสดครบทุกตัวแล้ว ไม่เหลือ "คำใบ้" — ตัวหลักที่ใช้จริง:
  `.settings-trigger-button` · `[role='radio']` ที่จับด้วย ligature ของ `mat-icon`
  (image / crop_portrait) · `button[aria-label='Select model family']` + `[role='menuitem']`
  ("Nano Banana Pro" / "Nano Banana 2" / "Nano Banana 2 Lite" มีจริงครบสามตัว) ·
  `.add-menu-trigger` · `.sidebar-upload-btn` · `.ProseMirror[contenteditable='true']` ·
  `.generate-icon-button`
- **3 จุดที่ต่างจากคำใบ้เดิมและทำให้พังจริงระหว่างทาง:**
  1. `Escape` ปิดแผงตั้งค่าให้เห็นก็จริง แต่คอมโพเนนต์ยังจำว่า "เปิดอยู่" คลิก trigger ครั้งถัดไป
     จึงถูกกลืนไปกับการปิดสถานะค้าง แผงไม่เปิด → ต้องเปิด/ปิดด้วยปุ่ม trigger สลับเท่านั้น
  2. ไดอะล็อกแนบสื่อ **ไม่เลือกไฟล์ที่เพิ่งอัปให้เอง** ต้องกดเลือกแถวนั้นก่อน (สัญญาณ "อัปเสร็จ"
     ที่ไม่ผูกกับภาษา = `img.asset-thumbnail-image` มาแทน `mat-spinner`) และในโปรเจกต์เปล่า
     ไดอะล็อกปิดตัวเองทันทีที่เลือก ไม่มีขั้นกด "Add to prompt"
  3. ปุ่มสัดส่วน/จำนวนเป็น `mat-button-toggle` ใช้ `aria-checked` ไม่ใช่ `aria-selected`
- **อ่านผลจาก DOM ไม่ใช่ network**: เว็บใหม่ยิงทุกอย่างผ่าน RPC ก้อนเดียว
  (`/_/AiSandboxAngularFrontend/data/batchexecute`) ที่ตอบเป็นข้อความ เดินหา field แบบ JSON ไม่ได้ ·
  รูปในกริดเสิร์ฟที่ `flow.google.com/asb/...` (ส่วน thumbnail ในไดอะล็อกเป็น
  `flow-content.google/image/...`) และเป็นไฟล์เต็มความละเอียด ไม่ใช่ thumbnail

### S3 — รอบ 2 ("ตอนใช้งาน") ใช้ project เดิมของรอบ 1 (Task 5, 2026-09-06)

- **รัน S2 ใหม่ก่อนเพื่อได้ fixture สะอาด** (สินค้าเดิม "ที่ลับเล็บแมว") — ได้
  `PROJECT_ID=286cc727-d94f-4b38-a439-94f9a0556bbb` และ `r1-a1-0.jpg`…`r1-a1-3.jpg` (4 ไฟล์ JPEG พื้นขาว
  ผ่านจริง ใช้เวลารวมทั้งรอบ ~2 นาที 14 วิ ตั้งแต่ `open-flow` เริ่มถึง `download-4` เสร็จ)
- **S3 ผ่านจริงในความพยายามครั้งแรก — ไม่ต้อง fallback ไป project ใหม่เลย**: สั่ง
  `npm run flow-smoke:s3 -- worker/smoke/out/s2/r1-a1-0.jpg "ที่ลับเล็บแมว" 286cc727-d94f-4b38-a439-94f9a0556bbb`
  (รอ ~2.5 นาทีหลัง S2 จบก่อนยิง ตามเจตนา `betweenProductsMs`) ขั้น `ensure-project` เจอ URL มี
  `/project/` อยู่แล้วจาก `open-flow` จึงแค่ตัด id ออกจาก URL (**11ms** — ไม่ได้กดปุ่ม "New project" เลย)
  → **ยืนยันแล้วว่า Task 8 ส่ง `job.flowProjectId` เดิมให้รอบ 2 ได้ตรงๆ ไม่ต้องแก้เป็น `projectId: null`
  ตามที่ brief กังวลไว้ล่วงหน้า** (เคสนี้ทดสอบเฉพาะ "project เดิมยังเปิดอยู่ ใช้ต่อทันที" — ยังไม่ได้ลอง
  เคส project ถูกลบ/idle นานจนหมดอายุ ถ้าเจอในโปรดักชันจริงต้องดักที่ `open-flow`/`ensure-project` แยกต่างหาก)
- **ผลลัพธ์ตรงตามคาด**: ได้ 4 ไฟล์ (`r2-a1-0.jpg`…`r2-a1-3.jpg`) เปิดดูด้วยตาแล้วครบทั้ง 4 รูป — สินค้า
  (ชั้นวางลับเล็บแมวรูปอุ้งเท้า) ถูกวางในฉากห้องนั่งเล่นจริง (พื้นไม้/พรม โซฟา ต้นไม้ประดับ แสงธรรมชาติ)
  มีแมวจริง (พันธุ์/สีต่างกันทั้ง 4 ภาพ) กำลังนั่ง/นอน/เกาบนชั้น — ตรงกับพรอมต์รอบ 2 "ขอภาพสินค้าตอนใช้งาน"
  ไม่ใช่แค่พื้นหลังขาวเหมือนรอบ 1 อีกต่อไป — สัดส่วน 3:4 ยังคงถูกต้องทุกภาพ
- **เวลาที่วัดได้ (จาก `steps.log`):**
  - อัปโหลดรูปอ้างอิง (`attach-reference` เริ่ม→เสร็จ): S2 ~19.8s (รูปจากดิสก์ 585KB) ·
    S3 ~28.7s (รูปที่ Flow วาดเองกลับเข้าไปใหม่ ~585KB เท่ากัน — ช้ากว่าเล็กน้อย อาจเป็น variance ปกติ
    ไม่ใช่รูปแบบที่ต่างกันชัดเจน)
  - เจนรูป (`click-generate` เสร็จ → `wait-results` เสร็จ): S2 ~34.9s · S3 ~36.9s — ใกล้เคียงกัน ไม่มี
    หลักฐานว่ารอบ 2 (มีรูปอ้างอิง) ช้ากว่ารอบ 1 (ไม่มีรูปอ้างอิง แค่ prompt ล้วน) อย่างมีนัยสำคัญ
- **ไม่ต้องแก้ selector ตัวไหนเลย** — ชุด `migrated` ที่ยืนยันจาก S2/Task 4 ใช้ได้ตรงกับรอบ 2 ทุกขั้น
  รวมถึงขั้น `attach-reference` ที่อัปโหลดรูปซึ่งเป็นผลลัพธ์จาก Flow เอง (ไม่ใช่รูปถ่ายจากผู้ใช้) ก็ไม่มี
  พฤติกรรมต่างจากรูป PNG ธรรมดาที่ใช้ใน S2

### S4 — พิสูจน์ fail-fast: หยุดก่อนกด generate จริง (Task 5, 2026-09-06)

- รัน `FLOW_FORCE_FAIL_STEP=click-generate npm run flow-smoke:s2 -- worker/smoke/out/s2/r1-a1-0.jpg "ทดสอบ"`
  — console แสดง `S2 FAILED step=click-generate kind=selector_drift: บังคับพังด้วย FLOW_FORCE_FAIL_STEP`
  ตรงตัวทุกตัวอักษรตามที่ brief กำหนด
- `worker/smoke/out/s2-failure/` มีครบ 4 ไฟล์: `screenshot.png` · `page.html` · `steps.log` · `state.json`
- `steps.log` จบที่บรรทัด `type-prompt เสร็จ` — **ไม่มีบรรทัด `click-generate เริ่ม` เลยแม้แต่บรรทัดเดียว**
  เพราะ `step()` ใน `flow-driver.ts` เช็ก `opts.forceFailStep === name` แล้วโยน error ทันทีก่อนเรียก
  `assertPageUsable`/`fn()` ใดๆ → ยืนยันว่าไม่มีการกดปุ่ม generate จริง = ไม่มีรูปถูกเจนเลยแม้แต่ใบเดียว
  (เครดิต/quota ไม่ถูกใช้)
- `state.json`: `"step": "click-generate"`, `"kind": "selector_drift"` ตรงตามที่คาด — ไฟล์มี `url` เป็น URL
  ของ project จริงที่เปิดอยู่ตอนพัง (`https://flow.google.com/project/ea66e01e-...`) ด้วย ซึ่งมีประโยชน์
  เวลา debug ของจริงในอนาคต
- **สรุป S4: fail-fast ทำงานถูกต้อง 100%** — ไม่มี edge case ที่ต้องแก้เพิ่ม
