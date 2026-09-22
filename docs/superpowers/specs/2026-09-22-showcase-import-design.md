# นำเข้าสินค้าจาก TikTok Showcase (extension ภายนอก) — ดีไซน์

วันที่: 2026-09-22

## ปัญหา

คอขวดที่กินเวลาที่สุดต่อ 1 คลิปยังเป็นขั้น A-C ตามที่วิเคราะห์ไว้หลายครั้งก่อนหน้านี้ ([[project-hired-worker-video-render-parked]], [[project-product-sourcing-automation-parked]]): **หาสินค้า → แคปรูปสินค้าต้นฉบับ → พิมพ์ชื่อ/บรีฟ** — ฟีเจอร์ Flow bot ที่ทำไปก่อนหน้า (auto-generate prompt, stepper ฯลฯ) ล้วนขัดผิวที่ขั้น D (เรนเดอร์) ซึ่งไม่เคยเป็นคอขวดจริง ไม่ได้แตะ A-C เลยสักจุด

มีโปรเจกต์แยกต่างหาก (บริษัท) ชื่อ **"Export Tiktok Production Lines Extension with Internal API"** — เป็น Chrome extension (MV3) ที่อ่านรายการสินค้าใน **Showcase** ของบัญชี TikTok (หน้า "Add product links" ตอนอัปโหลดคลิป) ผ่าน internal endpoint ของ TikTok เอง (`GET https://shop.tiktok.com/api/v1/streamer_desktop/showcase_product/list?offset&count=6`) ได้ข้อมูลจริงมาแล้ว 198-201 รายการ/บัญชี รวมถึง**รูปสินค้าจากร้านจริง** (`cover`, `images[]` — 6-10 รูป/สินค้า) — ถ้าดึงข้อมูลนี้มาใช้ จะตัดงาน "พิมพ์ชื่อเอง + หารูปต้นฉบับเอง" ออกไปได้เกือบทั้งหมด ตรงคอขวด A-C โดยตรง

## บริบท / แหล่งข้อมูล

โปรเจกต์ต้นทางมีวินัยสูง (G0/G1 compliance gate, permission ขั้นต่ำ, ไม่เก็บ cookie/token, test coverage ≥90%) และ**ตรวจ TikTok Shop Creator Terms of Use เองแล้ว** พบข้อห้ามชัดเจนใน Section 8/12: ห้ามใช้ bot/scraper เข้าถึงแบบอัตโนมัติ**เว้นแต่มี express written permission** ซึ่ง**ยังไม่ได้รับ** — `G0_VERIFIED = false` ในโปรเจกต์นั้น เป็นสถานะที่ตั้งใจค้างไว้จนกว่าจะได้รับอนุญาตจริง

**บัญชีที่ใช้ทดสอบเป็นบัญชีสำรอง** (ไม่ใช่บัญชีรายได้จริง ~฿496+/วัน ของ pooling_prompt) — ยืนยันแล้วในบทสนทนา

### ความเสี่ยงที่บันทึกไว้ตรงๆ — ไม่ซ่อน

ฟีเจอร์นี้พึ่งข้อมูลจากแหล่งที่**ยังไม่ได้รับอนุญาตจาก TikTok อย่างเป็นทางการ** เจ้าของระบบรับทราบและยอมรับความเสี่ยงนี้แล้วโดยตรง (ยืนยันในบทสนทนาออกแบบ 2026-09-22) — ไม่ใช่ช่องโหว่ที่มองข้าม ถ้าสถานะการอนุญาตเปลี่ยน (ได้รับอนุญาตจริง หรือพบว่าถูกปิดกั้น) ต้องกลับมาทบทวนทั้งฟีเจอร์นี้

## การตัดสินใจที่ยืนยันแล้ว

### 1. Copy (ไม่ใช่ move) โค้ด extension เข้ามาเป็นโฟลเดอร์ย่อย

`showcase-extension/` ในรีโป `pooling_prompt` — มี `package.json`/`node_modules`/build script เป็นเอกเทศของตัวเอง ไม่ปนกับ dependency/build ของ Next.js หลัก (กันชนกฎ "ห้ามรัน build ซ้อนกันบน `.next` เดียวกัน" ในหัวข้อ Commands ของ CLAUDE.md — โฟลเดอร์คนละอันคนละ build pipeline เลยไม่มีทางชนกัน) รีโปต้นทางยังคงอยู่และใช้งานแยกต่างหากต่อไป — **โค้ดสองชุดนี้จะไม่ sync กันเองอัตโนมัติ** ถ้าแก้ที่ต้นทาง (เช่น TikTok เปลี่ยน field) ต้องอัปเดตสำเนาในนี้เองด้วยมือ — ยอมรับ trade-off นี้แล้ว

### 2. ทางเข้าข้อมูล 2 ทาง

- **หลัก — push ตรงจาก extension:** API route ใหม่ `POST /api/showcase-import` รับ JSON payload เดียวกับที่ extension export ป้องกันด้วย shared secret (header `X-Showcase-Secret` เทียบกับ env var `SHOWCASE_IMPORT_SECRET`) — ปฏิเสธด้วย `401` ถ้าไม่ตรง/ไม่มี header นี้เหตุผลที่ต้องมี: endpoint นี้รับ URL รูปจากภายนอกแล้วไปดึงมา ถ้าไม่กันเลย กระบวนการอื่นบนเครื่องเดียวกัน (รวมถึงหน้าเว็บที่มี JS ร้ายแบบ DNS-rebinding) มีโอกาสทฤษฎียิงเข้ามาได้
- **สำรอง — อัปโหลดไฟล์มือ:** ฟอร์มอัปโหลด `.json` ในหน้า `/products` เดิม ใช้ import logic เดียวกับ path หลัก (ไม่มี secret check เพราะมาจาก UI ที่ผู้ใช้กดเองอยู่แล้ว เหมือน pattern เดิมของไฟล์ xlsx/CSV)
- **`GET /api/showcase-import/health`** — endpoint เบาๆ ให้ extension ping เช็คว่า pooling_prompt server เปิดอยู่ไหม ก่อนเปิดปุ่ม "ส่ง" ให้กดได้ (ตอบ `200` พร้อม build/version เบาๆ พอยืนยันตัวตนว่าใช่ pooling_prompt จริง ไม่ใช่เว็บอื่นที่บังเอิญเปิด port เดียวกัน)

### 3. ต่อยอด `ProductCandidate`/`CandidateBatch` เดิม ไม่สร้างโมเดลคู่ขนาน

แก่นของปัญหาเหมือนเดิม (pool ให้เลือก → สร้างงาน) ต่างแค่แหล่งข้อมูลกับการมีรูป — ต่อยอดจากของเดิมตรงๆ ตามหลัก scope-cutting แทนที่จะสร้างระบบคู่ขนาน

### 4. เพิ่มตารางใหม่ `CandidateImage` — ของเดิมไม่มีที่เก็บรูปเลย

`ProductCandidate` เดิม (จาก [[candidate-batches-design]]) ไม่มี field รูปแม้แต่ตัวเดียว เพราะออกแบบมาสำหรับข้อมูลจากแคปหน้าจัดอันดับ (ตัวเลขล้วน) เท่านั้น — Showcase มีรูปจริงติดมาด้วยเสมอ (6-10 รูป/สินค้า) ต้องมีที่เก็บใหม่

### 5. โหลดรูปลงดิสก์ทันทีตอน import ไม่รอถึงตอนเลือก

Showcase JSON มี URL รูปที่มี query param หน้าตาเหมือน signature/expiry (`dr`, `t`, `ps`, `shp`, `shcp`, `idc`, `from` — ยืนยันจากเอกสาร `api-observations.md` ของโปรเจกต์ต้นทาง) ถ้าเก็บ "stock" ไว้หลายวันก่อนมาเลือก URL อาจหมดอายุไปแล้ว — ต้องดึงรูปมาเก็บเป็นไฟล์จริงตั้งแต่ตอน import

### 6. Dedupe ด้วย Product ID จริง ไม่ใช่ชื่อ

`extractCandidates` เดิม dedupe ด้วย `normalizeName(name)` เพราะข้อมูลจากแคปหน้าจอไม่มี ID ที่เชื่อถือได้ — Showcase มี `product_id` จริง (string 19 หลัก มี quote ครอบ) ให้ importer ใหม่ใช้ ID นี้แทน แม่นกว่ามาก (กันปัญหาสินค้าชื่อคล้ายกันถูกมองเป็นตัวเดียวกัน)

### 7. ขยาย `createEntryFromCandidate` — เพิ่มขั้นเลือกรูปก่อนสร้าง entry

ถ้า candidate มีรูป (`CandidateImage` ≥1 แถว) ให้โผล่หน้าเลือกรูปก่อน (ใช้ UI แบบเดียวกับ thumbnail picker ใน `brief-form.tsx`/`flow-enqueue-panel.tsx` ที่มีอยู่แล้ว) — เลือกได้ 1 รูปขึ้นไป กดยืนยันแล้วค่อย:
1. สร้าง `PromptEntry` (ชื่อ = `candidate.name` เหมือนเดิม)
2. Copy รูปที่เลือกเข้า `uploads/<entryId>/flow/`
3. สร้าง `FlowJob` (status `queued_r1`) — **ใช้ตรรกะเดียวกับ `enqueueFlowJob` แต่แยกส่วนแกนกลาง (copy ไฟล์ + สร้าง FlowJob) ออกมาเป็น helper ใช้ร่วมกัน** เพราะต้นทางรูปต่างกัน (`enqueueFlowJob` เดิมรับจาก FormData ที่ผู้ใช้อัปโหลด ส่วนที่นี่รูปมีอยู่แล้วบนดิสก์จาก `CandidateImage`)

Candidate ที่ไม่มีรูป (มาจากแคปหน้าจอแบบเดิม) ยังทำงานแบบเดิมทุกอย่าง ไม่กระทบ — ไม่มีขั้นเลือกรูป สร้าง entry เปล่าแล้วให้ไปกรอกต่อเองตามที่เคยเป็น

### 8. ไม่มี auto-bulk-enqueue

การสร้าง entry+เข้าคิว Flow เกิดขึ้น**ทีละตัวจากการกดเลือกของผู้ใช้เท่านั้น** ไม่มีปุ่ม "สร้างทั้งหมดพร้อมกัน" — เหตุผล: Flow bot จำกัดไว้ 24 งาน/วัน (`flow-worker.config.json`) ถ้ายิงทั้ง ~200 ตัวพร้อมกันจะกินคิวเกิน 8 วันและได้ entry ขยะปนเยอะจากสินค้าที่ไม่อยากทำคลิปจริง — ตรงกับที่ปฏิเสธ auto-eligibility-gate ไปแล้วในฟีเจอร์ "หาสินค้า" เดิม ([[project-product-candidates-feature]]: "ไม่มี %-vs-benchmark eligibility gate ... proven harmful on real data")

## โครงสร้างข้อมูล

### ตารางใหม่ `CandidateImage`

```prisma
/// รูปสินค้าจริงจากร้าน ที่มากับ candidate บางแหล่ง (เช่น Showcase import) — candidate ที่มาจาก
/// แคปหน้าจัดอันดับแบบเดิมจะไม่มีแถวในตารางนี้เลย (ไม่ใช่ optional field ว่าง แต่ไม่มีแถวจริงๆ)
model CandidateImage {
  id          String           @id @default(cuid())
  candidateId String
  candidate   ProductCandidate @relation(fields: [candidateId], references: [id], onDelete: Cascade)
  filename    String
  mimeType    String
  sortOrder   Int              @default(0)
  createdAt   DateTime         @default(now())

  @@index([candidateId])
}
```

ไฟล์จริงเก็บที่ `uploads/_candidates/<candidateId>/<filename>` (โฟลเดอร์ใหม่ คู่ขนานกับ `uploads/<entryId>/` เดิม — ใช้ underscore prefix กันชนกับ entryId ที่เป็น cuid ล้วน)

### เปลี่ยน `ProductCandidate`

เพิ่ม field ใหม่ 2 ตัว (ทั้งคู่ optional เพราะ candidate จากแคปหน้าจอไม่มีค่าเหล่านี้):

```prisma
model ProductCandidate {
  // ...fields เดิมทั้งหมดไม่เปลี่ยน...
  /// Product ID จริงจาก Showcase — null สำหรับ candidate จากแคปหน้าจัดอันดับ (ไม่มี ID ที่เชื่อถือได้)
  sourceProductId String?
  images          CandidateImage[]

  @@unique([batchId, sourceProductId])  // เฉพาะแถวที่มีค่านี้ — SQLite unique constraint ยอมให้ NULL ซ้ำได้อยู่แล้ว
}
```

**`nameKey` เดิมยังอยู่และยังใช้ dedupe แบบเดิมสำหรับ candidate ที่ไม่มี `sourceProductId`** (มาจากแคปหน้าจอ) — สอง unique constraint นี้ทำงานคู่ขนานกัน ไม่ชนกัน เพราะ constraint ที่มี `sourceProductId = NULL` ไม่ถูกบังคับใน SQLite (unique index ข้าม NULL) จึงปล่อยให้ `@@unique([batchId, nameKey])` เดิมทำหน้าที่กันซ้ำสำหรับ path เดิมต่อไป

## Data flow เต็มรูปแบบ

```
[Chrome extension บนบัญชีสำรอง]
  ผู้ใช้กด "เริ่มสแกน" ใน extension (ทีละหน้า ตามที่ทดสอบไว้แล้ว — ไม่แตะ path นี้)
  → ผู้ใช้กด "ส่งเข้า pooling_prompt"
  → extension ping GET /api/showcase-import/health ก่อน (ถ้า offline: แสดงสถานะ "ออฟไลน์" ปุ่มกดไม่ได้)
  → POST /api/showcase-import  (header: X-Showcase-Secret)
       │
       ▼
[pooling_prompt: app/api/showcase-import/route.ts]
  1. เช็ค secret — ไม่ตรง → 401
  2. parse+validate body (reuse shape เดียวกับ observed contract ใน api-observations.md ของต้นทาง)
  3. เรียก lib/showcase-import.ts: importShowcaseBatch(payload)
       - สร้าง CandidateBatch ใหม่ (capturedOn = now)
       - ต่อสินค้า: upsert ProductCandidate ด้วย sourceProductId
       - ต่อสินค้า: ยิง fetch ไปโหลดแต่ละรูปจาก cover/images[] → เซฟลง
         uploads/_candidates/<candidateId>/ → สร้างแถว CandidateImage
         (รูปโหลดไม่สำเร็จ = ข้ามรูปนั้น ไม่ทำทั้ง candidate fail — บันทึก warning)
  4. ตอบ { batchId, added, skipped, imagesFailed }
       │
       ▼
[หน้า /products — เห็น batch ใหม่ทันที พร้อมรูป]
  ผู้ใช้เลือก candidate ที่อยากทำ → กด "สร้างงาน"
  → มีรูป? → โผล่ตัวเลือกรูป → เลือก → ยืนยัน
       │
       ▼
[createEntryFromCandidate (ขยายแล้ว)]
  สร้าง PromptEntry + copy รูปที่เลือก + สร้าง FlowJob (queued_r1)
       │
       ▼
[Flow worker เดิม — ไม่เปลี่ยนอะไรเลย] ทำงานตามปกติ
```

## หน้าเว็บที่เปลี่ยน

- `/products` (`components/candidates-route.tsx`): เพิ่มฟอร์มอัปโหลด `.json` (ทางสำรอง) ข้าง form อัปโหลดแคปเดิม · แถวที่มีรูปแสดง thumbnail เล็กๆ (ต่างจากแถวไม่มีรูปที่เป็นตารางตัวเลขล้วนแบบเดิม)
- ปุ่ม "สร้างงาน" (เดิมเรียก `createEntryFromCandidate` ตรงๆ) — ถ้า candidate มีรูป เปลี่ยนเป็นเปิด dialog เลือกรูปก่อน แทนที่จะสร้าง entry ทันที

## Error handling

| สถานการณ์ | พฤติกรรม |
|---|---|
| secret ไม่ตรง/ไม่มี header | `401`, ไม่แตะ DB เลย |
| pooling_prompt server ปิดอยู่ | extension เห็นจาก health-check ก่อนอยู่แล้ว ปุ่มส่งถูกปิดไว้ |
| JSON payload ผิด shape | `400` พร้อมข้อความบอกว่า field ไหนขาด/ผิด — ไม่สร้าง batch ครึ่งๆ กลางๆ (ตาม pattern เดิมของ `extractCandidates`: ล้มทั้งก้อนถ้าไม่มีแถวใช้ได้เลย) |
| โหลดรูปบางรูปไม่สำเร็จ (URL หมดอายุ/เน็ตมีปัญหา) | ข้ามเฉพาะรูปนั้น ไม่ทำทั้ง candidate fail — candidate ที่โหลดรูปไม่ได้เลยสักรูปจะแสดงเป็น "ไม่มีรูป" เหมือน candidate จากแคปหน้าจอ (ยังใช้งานได้ปกติ แค่ไม่มีขั้นเลือกรูป) |
| candidate ซ้ำ (`sourceProductId` ซ้ำในชุดเดียวกัน) | upsert ทับ (เหมือน pattern เดิมของ `nameKey`) |
| ผู้ใช้ปิดหน้าเลือกรูปกลางคัน | ไม่สร้าง entry/FlowJob ใดๆ — candidate ยังอยู่ใน stock รอเลือกใหม่ได้ |

## สิ่งที่ไม่ทำในรอบนี้

- ไม่ sync โค้ด extension กับต้นทางอัตโนมัติ (ยอมรับ trade-off ตามหัวข้อ "การตัดสินใจ" ข้อ 1)
- ไม่ auto-enqueue หลายตัวพร้อมกัน (ข้อ 8 ด้านบน)
- ไม่แตะ `APPROVED_IMAGE_HOSTS` policy ของ extension ต้นทาง (เป็นคนละ concern — ที่นี่แค่โหลดรูปมาเก็บเป็นไฟล์ของตัวเอง ไม่ได้ผูกกับ policy อ้างอิง host เดิม)
- ไม่ทำระบบแจ้งเตือนอัตโนมัติเมื่อ extension ส่งข้อมูลมา (ผู้ใช้เห็นเองตอนเปิดหน้า `/products`)
- ไม่ทำ retry อัตโนมัติสำหรับรูปที่โหลดไม่สำเร็จ — ถ้าต้องการค่อยอิมพอร์ตใหม่ทั้งชุด

## การตรวจสอบ

1. `npx tsc --noEmit` และ `npm run lint` สะอาด
2. `npx prisma migrate dev` สร้าง `CandidateImage` + คอลัมน์ `sourceProductId` สำเร็จบนสำเนา `dev.db`
3. ทดสอบ `POST /api/showcase-import`:
   - ไม่ใส่ header secret → `401`
   - ใส่ secret ผิด → `401`
   - payload ถูกต้อง (ใช้ fixture จาก observed contract ของโปรเจกต์ต้นทาง — sanitize แล้ว) → สร้าง batch + candidate + ดาวน์โหลดรูปสำเร็จ
   - รูปบาง URL หมดอายุ (mock 403/404) → candidate ยังถูกสร้าง แค่รูปที่พังถูกข้าม
4. `GET /api/showcase-import/health` ตอบ `200` เสมอเมื่อ server รันอยู่
5. ทดสอบบน dev server แยก (`NEXT_DIST_DIR=.next-dev`, `dev-test.db`, port 3001) ตาม pattern เดิม:
   - อัปโหลด `.json` ผ่านฟอร์มสำรอง → เห็น batch ใหม่พร้อมรูป
   - กด "สร้างงาน" บน candidate ที่มีรูป → เห็นตัวเลือกรูป → เลือก → เห็น entry ใหม่ + FlowJob สถานะ `queued_r1`
   - กด "สร้างงาน" บน candidate ที่ไม่มีรูป (จากแคปหน้าจอเดิม) → สร้าง entry ทันทีแบบเดิม ไม่มีขั้นเลือกรูป
6. `node scripts/check-contrast.mjs` ผ่าน (ถ้าแตะสี)
7. `node scripts/shot.mjs` ที่ 390/820/1440px ไม่มีหน้าไหนสกรอลแนวนอน
