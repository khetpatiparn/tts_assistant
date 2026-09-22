# G1 Sign-off — Flow A Showcase Importer

> ## นี่คือ mock-only prototype G1 ไม่ใช่ live-ready
>
> **G0 ยังไม่ผ่าน** ยังไม่มีหลักฐานจากบัญชี TikTok จริง และยังไม่มี live adapter
> ทุกผลการทดสอบด้านล่างได้มาจาก mock adapter + fixture สังเคราะห์ล้วน
> **ห้ามตีความว่าระบบนี้ใช้งานกับ TikTok จริงได้แล้ว**

**ผลตัดสิน G1: ยังไม่ผ่าน** — ดูแถว ❌ ในตาราง G1 checklist ด้านล่าง (เหลือข้อเดียว: VA01–VA09) และ
[test-results.md](test-results.md) § Release gate G1 — (อัปเดต 2026-09-20: แถว progress/cancel latency เปลี่ยนจาก
❌ NOT RUN เป็น ✅ PASS แล้ว หลังวัดจริงใน Task 10 ของรอบตรวจสอบและปิดช่องว่าง จึงไม่ใช่เหตุผลที่ G1 ยังไม่ผ่านอีกต่อไป —
เหตุผลที่เหลือมีจุดเดียวคือ VA01–VA09 ที่ BLOCKED บน G0)

**วันที่:** 2026-09-20
**Build:** mock `eafcae61668f…` · release `df02eb2e52d0…` (หลัง final-review fix wave — ดู
[test-results.md](test-results.md) § รอบตรวจสอบและปิดช่องว่าง (audit) สำหรับ hash ของรอบ audit ก่อนหน้านี้ที่ยังไม่มีการแก้
runner.ts/handle.ts; hash คำนวณจาก source ทั้งหมดใน `extension/src` + `manifest.json` — เปลี่ยนทุกครั้งที่ source เปลี่ยน
ไม่ใช่ timestamp จึง reproducible จาก commit เดิมได้เสมอ ดู `scripts/build.mjs`)
**Environment:** Windows 11 Home Single Language 10.0.26200 · Node v22.20.0 · Brave (เวอร์ชันไม่ได้บันทึกไว้ — ดู "ข้อจำกัดที่ทราบ") · Chrome 153.0.8010.48 (Windows 11 25H2) · Playwright 1.63.0, Chromium (bundled)

## สรุปผลทดสอบ

| กลุ่ม | PASS | NOT RUN | BLOCKED | N/A |
|---|---|---|---|---|
| UT (unit & data) | 12 | 0 | 0 | 0 |
| PG (pagination & fault) | 17 | 0 | 0 | 0 |
| LC (lifecycle) | 7 | 0 | 0 | 0 |
| UI | 5 | 1 | 0 | 0 |
| IT (integration) | 3 | 0 | 0 | 0 |
| PK (package security) | 4 | 0 | 0 | 1 |
| VA (validation) | 3 | 0 | 6 | 1 |
| DB/WS (M2) | 0 | 0 | 0 | 20 |

หมายเหตุ: แถว PK นับ PK01/PK02/PK03/PK05 เป็น `PASS` เต็มรายการ (4) ส่วน PK04 นับอยู่ในคอลัมน์ `N/A` (1) เพราะยังไม่ปิด
ครบทั้งสองครึ่งของข้อกำหนด — **ครึ่ง "ไม่มี request ออกนอกเครื่อง" ได้ `PASS` จริงแล้ว** (ยืนยันด้วย E2E ทุก scheme แบบ
deny-by-default + positive control) ส่วนครึ่ง "allowlisted read-only" เป็น `NOT APPLICABLE` เพราะยังไม่มี live adapter
— การนับไว้ที่ N/A ไม่ได้แปลว่า PK04 ยังไม่ได้ตรวจอะไรเลยหรือ FAIL ดูรายละเอียดใน [test-results.md](test-results.md)
§ M1.5 Package security

รายละเอียดทั้งหมดอยู่ใน [test-results.md](test-results.md)

## Branch coverage เทียบเกณฑ์ ≥90%

| ไฟล์ | Branch % | ผ่านเกณฑ์ |
|---|---|---|
| domain/envelope.ts | 100% (33/33) | ใช่ |
| domain/product.ts | 92.3% (96/104) | ใช่ |
| domain/page.ts | 100% (15/15) | ใช่ |
| domain/json-lossless.ts | 100% (10/10) | ใช่ |
| core/pagination.ts | 95.16% (59/62) | ใช่ |
| core/retry.ts | 100% (39/39) | ใช่ |
| core/runner.ts | 96.15% (100/104) | ใช่ |

`npm run test:coverage` (vitest threshold gate) exit code 0 — ผ่านทั้ง 7 ไฟล์ที่มีเกณฑ์บังคับ

## G1 checklist (spec §16)

| ข้อ | สถานะ | หมายเหตุ |
|---|---|---|
| G0 ผ่าน หรือ label ชัดว่า mock-only prototype | ✅ | label ครบทั้ง manifest name, dashboard banner, `G0_VERIFIED=false` |
| P0 ของ UT/PG/LC/UI/IT/PK ใน scope ผ่านทั้งหมด | ✅ | ทุก P0 ผ่านครบ: UT01–UT04/UT06/UT07/UT09–UT12, PG01–PG10/PG12–PG15/PG17, LC01/LC03–LC05/LC07, UI02/UI03, IT01/IT02, PK01–PK05 — PK04 แยกเป็นสองครึ่งภายใต้ id เดิม (ครึ่ง "ไม่มี request ออกนอกเครื่อง" PASS, ครึ่ง "allowlisted read-only" NOT APPLICABLE จนกว่าจะมี live adapter) — รายการที่ยังไม่รันมีแค่ UI06 (P1, เลื่อนไปพร้อม live adapter) ไม่ใช่ P0 ค้าง |
| VA01–VA09 ผ่านส่วนที่อยู่ใน scope | ❌ | VA07/VA08/VA09 ผ่านครบ (VA09 ทั้ง Brave และ Chrome); VA01/02/03/04/05/06 BLOCKED บน G0 |
| Branch coverage ≥90% ของ parser/pagination/error state | ✅ | ครบทั้ง 7 ไฟล์ที่มีเกณฑ์ (93.02%–100%) ดูตารางด้านบน |
| Mock 198 records ได้ ID set ตรง 100% | ✅ | PG01/PG02 |
| Precision ของ Product ID และ price handling ผ่าน | ✅ | UT01/UT02/UT08 |
| interruption/cancel/limits ไม่ถูกแสดงเป็น complete | ✅ | PG13/PG15/LC03–LC07 |
| Export ไม่พบ secrets; package สิทธิ์ต่ำสุด | ✅ | UT12, PK01, PK02, VA08 |
| ใช้งาน keyboard ได้ | ✅ | UI04 — native checkbox ใน label (หลักฐานระดับ jsdom/module เท่านั้น ยังไม่มีหลักฐานระดับ browser จริง — ดู "ข้อจำกัดที่ทราบ" ด้านล่าง) |
| progress หลัง commit หน้า ≤1 วินาที; Cancel เปลี่ยนสถานะ ≤2 วินาที | ✅ | **PASS** — วัดจริงแล้วด้วย `tests/e2e/latency.spec.ts` (รัน 2026-09-20 ผ่าน `npm run test:e2e`, อ่านค่าจาก console log `[วัดจริง]`): progress lag สูงสุด = **244 ms** จาก 67 ตัวอย่าง (จุดวัด: สำหรับตัวอย่างที่จอแสดงน้อยกว่าจำนวนที่ commit จริง คำนวณเวลาตั้งแต่ `lastCommitAt` ของ checkpoint ถึงตอนสุ่มตัวอย่างนั้น แล้วเอาค่ามากสุด — ยึดกับ `lastCommitAt` จริง ไม่ใช่แค่ข้อความ UI เปลี่ยน) เทียบงบ ≤1000ms ผ่านด้วย margin กว่า 750ms; cancel latency = **233 ms** (จุดวัด: จากกดปุ่ม Cancel ถึงตอนที่ UI แสดง "cancelled" ครั้งแรก และยืนยันไม่มี commit เพิ่มอีกใน 2 วินาทีถัดมา) เทียบงบ ≤2000ms ผ่านด้วย margin กว่า 1700ms — ทั้งสองค่าคือขอบบน (upper bound) เพราะ loop วัด progress lag เองก็เรียก `run.status` เพิ่มภาระเล็กน้อย จึงถือว่าผ่านจริงอย่างปลอดภัย รายละเอียดเพิ่มเติมดู [test-results.md](test-results.md) § รอบตรวจสอบและปิดช่องว่าง (audit) |
| build instructions, install/uninstall, clear data, known limitations, rollback | ✅ | README |

## ข้อจำกัดที่ทราบ

- **ไม่มี live adapter** — release channel โยน `live_adapter_not_implemented` โดยเจตนา
- **UI06 ยังไม่ทดสอบ** — ไม่มีโค้ดเช็ค `chrome.permissions` เลย จึงไม่มีพฤติกรรมให้ทดสอบ เลื่อนไปพร้อม live adapter
- **Brave version ไม่ได้บันทึก** — รอบทดสอบ E2E/manual smoke ที่มีอยู่ไม่ได้จดเลขเวอร์ชัน Brave ไว้ มีแค่ชื่อ browser
  (Chrome บันทึกแล้ว: 153.0.8010.48, Windows 11 25H2)
- **PK04 แยกเป็นสองครึ่งภายใต้ id เดิม** — ครึ่ง "ไม่มี request ออกนอกเครื่อง" `PASS` (E2E ยืนยันทุก scheme แบบ
  deny-by-default + positive control ที่พิสูจน์ว่า listener จับความพยายามได้จริง); ครึ่ง "allowlisted read-only"
  `NOT APPLICABLE` เพราะยังไม่มี live adapter จึงยังไม่มี request ใดให้ตรวจ allowlist (ไม่ใช่การเปลี่ยน requirement)
- **UI04/UI05 ยังเป็นหลักฐานระดับ jsdom/module เท่านั้น** — UI01–UI03 มีหลักฐานระดับ browser จาก E2E scan-flow แล้ว
  แต่ UI04 (preview accessibility/keyboard) และ UI05 (preview pagination) ยังไม่มีหลักฐานระดับ browser จริง
- **eligibility ของทุกสินค้าเป็น `unknown`** — ถูกต้องตาม V06/§8.3 เพราะยังไม่มี enum ใดถูกยืนยัน
- **ไม่มี icon** — Chrome ใช้ไอคอน default
- **รอบตรวจสอบและปิดช่องว่าง (audit) วันเดียวกันนี้** แก้ defect จริง 4 จุดที่พบ (D1 progress-latency วัดไม่ได้จริงตาม
  โครงสร้างเดิม, D2 `heartbeat()` ไม่เคยถูกเรียกจาก production code, D3 orphaned lease ถูกซ่อนจาก UI พร้อม
  regression TOCTOU ที่พบและแก้ระหว่างทาง, D4 ไม่มีเส้นทางลบข้อมูลอยู่เลยในโค้ด) และเพิ่มหลักฐานระดับ browser จริงให้
  LC03/LC06 (เดิมเป็น unit simulation บน fake-indexeddb) — รายละเอียดทั้งหมดอยู่ใน
  [test-results.md](test-results.md) § รอบตรวจสอบและปิดช่องว่าง (audit)
- ~~**D2 heartbeat ยังปิดช่องว่างไม่สนิทสำหรับ retry wait ที่ยาวมาก**~~ — **ปิดจบแล้ว (2026-09-20)**
  ปัญหาเดิม: `store.heartbeat()` ต่ออายุ lease ครั้งละ `leaseTtlMs` (60 วินาที) แต่
  `RETRY_POLICY.maxRetryAfterMs` (`extension/src/core/retry.ts`) อนุญาตให้ retry wait ยาวได้ถึง 15 นาที —
  การ heartbeat ครั้งเดียว *ก่อน* เริ่มรอจึงแค่ลดโอกาส ไม่ได้ปิดสนิท

  การแก้: `runImport()` ใช้ `waitWithHeartbeat()` แทน `deps.sleep()` ตรง ๆ ที่จุดรอ retry ทั้งสองจุด
  (network error และ rate limit) โดยซอยการรอเป็นช่วงละ `store.leaseTtlMs / 3` แล้ว heartbeat คั่น
  ระหว่างช่วง — ความถี่อ่านจาก TTL จริงของ store ไม่ hardcode จึงไม่ drift ถ้ามีคนแก้ `leaseTtlMs`
  ภายหลัง และถ้า service worker ตายกลางทาง lease ยังหมดอายุตาม TTL ตามปกติ ความหมายของ lease
  ในฐานะสัญญาณ "ยังมีชีวิตอยู่" จึงไม่เสียไป

  หลักฐาน: `tests/unit/runner.test.ts` เคส `Retry-After` 900 วินาที (15 นาที = เพดานของนโยบาย)
  ตรวจ *ทุกจุดเวลา* ที่นาฬิกาเดินไปถึงว่า `leaseExpiresAt` ยังอยู่ข้างหน้าเสมอ และช่องว่างระหว่าง
  สองจุดเวลาที่ติดกันไม่เกิน `leaseTtlMs` — ยืนยันว่า test ไม่ใช่ vacuous pass ด้วยการตั้งช่วงซอยเป็น
  `Number.MAX_SAFE_INTEGER` ชั่วคราวแล้วเห็น test fail จริง

- ~~**D5 — Export ล้มด้วย `no_report` หลัง scan เสร็จสมบูรณ์ ทั้งที่ preview ยังโชว์ผลลัพธ์อยู่**~~ —
  **ปิดจบแล้ว (2026-09-20)** พบจากการใช้งานจริงของผู้ใช้ (สแกนได้ 198 รายการ เลือกทั้งหมดแล้วกด
  Export แต่ได้ error dialog `export ไม่สำเร็จ: no_report`)

  สาเหตุ: `RunReport` ของ run ที่จบแล้วถูกเก็บไว้แค่ในตัวแปร `registry.currentReport` ซึ่งอยู่ใน
  หน่วยความจำของ MV3 service worker เท่านั้น (ไม่เคย persist ลง IndexedDB — ต่างจาก checkpoint
  ระหว่างวิ่งที่ commit ทีละหน้าอยู่แล้ว) Chrome ทำ idle-kill service worker ได้เมื่อไม่มี event
  มาสักพัก (ปกติ ~30 วินาที) ผู้ใช้ที่ใช้เวลาเลือกสินค้าหลายร้อยรายการนานกว่านั้นก่อนกด Export จะเจอ
  service worker ที่ถูกปลุกใหม่ (module `background.ts` โหลดใหม่ทั้งหมด) ซึ่ง `registry` กลับไปเป็น
  ค่าเริ่มต้นว่างเปล่า ขณะที่ dashboard (หน้าเว็บ) ไม่ได้ reload จึงยังโชว์ preview เดิมค้างอยู่ใน
  หน่วยความจำของตัวหน้าเว็บเองตามปกติ — ผู้ใช้ไม่มีทางรู้ว่า backend ลืมไปแล้วจนกว่าจะกด action ที่ยิง
  message ไปหามัน

  การแก้: เพิ่ม object store ใหม่ `STORE_FINISHED_REPORT` ใน
  `extension/src/storage/checkpoints.ts` (bump `DB_VERSION` 1→2 พร้อม migration ที่ไม่แตะ
  runs/products เดิม) พร้อมเมธอด `saveFinishedReport`/`readFinishedReport`/`clearFinishedReport`
  คีย์ด้วย `sourceRef` (สอดคล้องกับสถาปัตยกรรม "หนึ่ง run ต่อ profile" เดิม) `handle.ts` เขียนผล
  ลง store ทันทีที่ run จบ **ก่อน** ตั้งค่าใน `registry` เสมอ (กันช่วงเวลาที่ค่าอยู่ใน memory แต่ยังไม่
  ถูก persist) และล้าง finished report เก่าตอนเริ่ม run ใหม่ (ในส่วน fire-and-forget ไม่ใช่ synchronous
  claim block — ไม่แตะ TOCTOU guard ของ D3 ที่แก้ไปก่อนหน้า) `run.status`/`run.export` fallback ไป
  อ่านจาก store เมื่อ `registry` ว่างเปล่า และ `run.export` เช็ค `findActiveRunWithCount` ก่อนเสมอ
  เพื่อไม่ให้หยิบผลของ run เก่ามาให้ถ้ามี run ใหม่ค้างอยู่จริง (`runImport()` release lease ในทุก
  เส้นทางจบงานอยู่แล้วผ่าน `try/finally` เงื่อนไขนี้จึงเป็นจริงเฉพาะตอนมี run ที่ยังไม่จบค้างอยู่จริง)

  หลักฐาน: `tests/unit/checkpoints.test.ts` describe "finished report" (save/read/clear,
  แยกตาม sourceRef, เขียนทับไม่สะสม, `clearAll` ลบครบ) และ `tests/unit/run-messages.test.ts`
  describe "D5" (`run.status`/`run.export` fallback หลัง "service worker ตาย" จำลองด้วย registry
  คนละก้อน, guard `run_active` ไม่หยิบผลเก่าเมื่อมี run ค้างจริง, `run.start` ล้างผลเก่าก่อนเริ่ม) —
  ยืนยัน non-vacuous ด้วยการปิด fallback ชั่วคราวแล้วเห็น E2E fail จริง (timeout เพราะ `no_report`
  ทำให้เกิด `alert()` ค้าง) ก่อนคืนกลับมาเป็นโค้ดที่แก้แล้ว ระดับ browser จริง:
  `tests/e2e/lifecycle.spec.ts` เคส D5 — สแกนจนจบสมบูรณ์ในเบราว์เซอร์จริง หยุด service worker จริง
  ด้วย CDP (`ServiceWorker.stopAllWorkers` ยืนยันด้วย `runningStatus === 'stopped'`) **โดยไม่ reload
  หน้า** (จำลองสถานการณ์จริงที่ผู้ใช้เจอ) แล้วกด Export ต้องได้ไฟล์จริง

  **ยืนยันซ้ำบนข้อมูลจริง (2026-09-20)** — ผู้ใช้ทดลองซ้ำบนบัญชี TikTok จริงด้วย flow เดิมที่เคยพัง
  จงใจปล่อยหน้าจอทิ้งไว้เกิน 1 นาทีก่อนกด Export (ให้ service worker ถูก idle-kill จริง ไม่ใช่จำลอง)
  Export สำเร็จ ได้ไฟล์ 201 รายการครบ ไม่มี `no_report` และไม่มีข้อมูลอ่อนไหวรั่วไหล — ดู
  [api-observations.md](api-observations.md) §10 และ [test-results.md](test-results.md)
  § รอบแก้ D5 สำหรับรายละเอียดเต็ม

## สิ่งที่ต้องทำก่อน live-ready G1

1. ผ่าน G0: เก็บหลักฐานจากบัญชีจริงตาม spec §5.1 แล้วเติม data dictionary — **เหลือเฉพาะข้อ 6
   (สิทธิ์บัญชี/ความเหมาะสม)** ตรวจเอกสาร TikTok Shop Creator Terms แล้ว (2026-09-20) พบว่าห้าม
   automated access โดยไม่มี express written permission — **คำตอบคือ "ยังไม่ได้รับอนุญาต" ไม่ใช่
   unresolved ลอย ๆ อีกต่อไป** แต่ก็ยังไม่ผ่าน gate เหมือนเดิมจนกว่าจะได้รับอนุญาตจริง ข้ออื่นครบแล้ว
   ดู [api-observations.md](api-observations.md) §3.1
2. ~~สร้าง live adapter + permission gating~~ **implement แล้วและเปิดให้ทดลองหนึ่งหน้าแบบกดเองแล้ว**
   (2026-09-20) — `adapter.probe` ยิงครั้งเดียว ไม่ใช้ lease/retry, หยุดถูกต้องที่
   401/403/429/challenge/redirect, มีธงกันกดซ้อน, แสดงรายการ normalized พร้อมป้าย "ผลทดสอบหนึ่งหน้า"
   และ export ตัวอย่างได้ผ่าน exporter เดิม (payload ระบุ `resultKind: single_page_probe`)
   **gate ถูกแยกเป็นสามค่า** — full scan (`run.start`) ยังปิดด้วย `G0_VERIFIED=false` เหมือนเดิม
   ดู [api-observations.md](api-observations.md) §7 · **ทดลองจริงแล้วสำเร็จ 2026-09-20** —
   อ่านหน้าแรก 6/6 รายการ, credentials/permission prompt/mapping/lossless ID ถูกต้องบนข้อมูลสด,
   ไม่มีข้อมูลลับรั่ว (ดู §8) · เหลือ: challenge/redirect/429 และการเลื่อนหน้า ที่ยังไม่เคยเกิดจริง
3. รัน VA01/VA02/VA03/VA04/VA05/VA06 กับข้อมูลจริง
4. เติม `VERIFIED_STOCK_STATUS`, `VERIFIED_REVIEW_STATUS`, `APPROVED_IMAGE_HOSTS` ตามหลักฐาน
5. แก้ข้อจำกัด heartbeat/retry-wait ก่อนเปิดใช้งานเส้นทาง 429/`Retry-After` ที่ยาวเกิน 60 วินาที
   (ไม่บล็อก `adapter.probe` เพราะ probe ไม่ผ่าน retry machinery เลย — เฉพาะ `run.start` เท่านั้น)
