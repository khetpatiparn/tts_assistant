# Test results

สถานะที่ใช้ได้มีเพียง `NOT RUN` / `PASS` / `FAIL` / `BLOCKED` / `NOT APPLICABLE` (spec §16.1)
**ห้ามเติม PASS ให้แถวที่ยังไม่ได้รันจริง**

## Environment ของรอบที่รัน (ล่าสุด: M1.5)

> **หมายเหตุ:** หัวข้อนี้บันทึกรอบ M1.5 ตามที่รันจริงตอนนั้น (ไม่ใช่รอบล่าสุดของเอกสารนี้อีกต่อไป) — รอบที่ใหม่กว่าและ
> เป็นรอบล่าสุดจริงคือ § รอบตรวจสอบและปิดช่องว่าง (audit) ด้านล่าง ซึ่งมี environment, จำนวน test และ build hash ของตัวเองแยกต่างหาก

| รายการ | ค่า |
|---|---|
| วันเวลา | 2026-09-19 17:20 (+07:00) |
| OS | Windows 11 Home Single Language 10.0.26200 (win32) |
| Node | v22.20.0 |
| Test runner | Vitest 5.0.1, `pool: forks` · Playwright 1.63.0, Chromium (bundled) |
| Release build hash | `dfb8956c5e49…` (mock build `efacfb243799…`) |
| คำสั่ง | `npm run build:mock && npm run build`, `npx vitest run`, `npm run test:coverage`, `npm run test:e2e` |
| ผลรวม | **19 test files, 280 tests, 280 passed, 0 failed** (vitest) · **8/8 E2E ผ่าน** (Playwright, 29.7s) · coverage threshold gate exit 0 (branch ≥90% ครบทั้ง 7 ไฟล์ที่มีเกณฑ์) |
| Browser | E2E จริงบน Chromium ผ่าน M1.5 (load-unpacked, scan-flow, network-isolation) — **Brave (2026-09-19) และ Chrome (2026-09-19, v153.0.8010.48, Windows 11 25H2) ผ่านทั้งคู่ (VA09)** |

รอบก่อนหน้า: M1.1 (`8231e697fcdf…`) 47 tests · M1.2 (`bad7c1f3560c…`) 111 tests ·
M1.3 ก่อน review (`d1fac3b0e7b8…`) 195 tests · M1.3 หลัง review (`df0e661ca546…`) 203 tests ·
M1.4 (`8e6cbe1d0ffd…`) 254 tests

## M1.4 — ผลที่รันจริง

| Test ID | Fixture/Evidence | Expected | Actual | Status |
|---|---|---|---|
| UI01 | `tests/unit/selection.test.ts` | filter candidate แล้ว Select all → จำนวนตรง filter ทุกแถว; ไม่แตะแถวนอก filter | 11/11 assertions ผ่าน รวม idempotent select-all และ deselect ที่ไม่กระทบ selection แท็บอื่น | PASS |
| UI02 | `tests/unit/export.test.ts`, `tests/unit/run-messages.test.ts` | เลือก 3 จาก 6 → export มี 3 ID ตรงที่เลือก ไม่มีแถวอื่น | ตรงทุกกรณี รวม ID ที่ไม่มีจริง/ซ้ำถูกจัดการอย่างปลอดภัย | PASS |
| UI03 | `tests/unit/export.test.ts` | export partial/unknown run → มี metadata และ warning ไม่ใช้ชื่อ success ครบ | scanCoverage/dataQuality ไหลจาก report ตรง ไม่ถูก relabel | PASS |
| UI04 | `tests/unit/preview.test.ts` (jsdom) | title ไทยยาว/ภาพเสีย/คีย์บอร์ด navigation ใช้ได้ | title 2000 ตัวอักษรแสดงครบ; imageUrl=null แสดง placeholder ไม่ใช่ `<img>` พัง; checkbox เป็น native input มี label ครอบ | PASS |
| UI05 | `tests/unit/preview.test.ts` (jsdom) | preview 5,000 rows ใช้ local pagination ไม่สร้าง DOM ทั้งชุด | render ได้ 50 แถว/หน้า (ไม่ใช่ 5000); เปลี่ยนหน้าไม่สะสม DOM ค้าง | PASS |
| **UT09 (เต็มรูปแบบ)** | `tests/unit/preview.test.ts` (jsdom) | render product rows จาก FX10 เป็น text ไม่เกิด code execution | title/shopName ที่เป็น HTML render เป็นข้อความ ไม่มี element แปลกปลอมและไม่รันโค้ด | PASS |
| **LC02** | `tests/unit/resume.test.ts`, `tests/unit/run-messages.test.ts` | ปิด popup แล้วเปิดใหม่ เห็น run เดิม/checkpoint ไม่เริ่มใหม่เงียบ ๆ | `findActiveRunWithCount` + `resumeDashboardState` แยก running/interrupted/no_active_run ถูกต้อง; `run.status` อ่าน checkpoint เมื่อ in-memory registry ว่าง (SW ถูกหยุด) — **แก้ไข:** ณ M1.4 จุดนี้ยังรายงาน lease ที่กำพร้าแต่ยังไม่หมดอายุเป็น "ไม่มี run ค้าง" แทนที่จะเป็น interrupted (ซ่อนข้อมูลที่ staged ไว้จาก UI) พฤติกรรมนี้เพิ่งถูกทำให้ถูกต้องในรอบตรวจสอบนี้ (Task 4 — ดู § รอบตรวจสอบและปิดช่องว่าง (audit) ด้านล่าง) | PASS |

### ขอบเขตของ M1.4 รอบนี้

- **ทุกอย่างข้างบนพิสูจน์ที่ระดับ module/jsdom** ไม่ใช่ browser จริง — การเชื่อม `background.ts` ↔ `dashboard/main.ts` ↔ `chrome.runtime.sendMessage` จริงยังไม่ได้ทดสอบ
- Export ใช้ `<a download>` + Blob ตาม spec §7.1 (ไม่ขอ permission `downloads`) — **ยังไม่ได้ยืนยันว่าดาวน์โหลดได้จริงบน Brave/Chrome**
- `sourceRef` ยังเป็นค่าคงที่ (`'local-profile-01'`) ไม่มี UI ตั้งค่า — ตรงตาม scope M1 (หนึ่งบัญชีต่อ profile)

## M1.1 — ผลที่รันจริง

| Test ID | Build/Browser | Fixture/Evidence | Expected | Actual | Status | Defect | Tested at |
|---|---|---|---|---|---|---|---|
| IT01 | `8231e697fcdf` / Node 22.20.0 (ไม่มี browser) | `tests/integration/it01-no-network.test.ts` — scope: ชุด suite ของ M1.1 (6 ไฟล์) | ทุก network API ถูกปฏิเสธ, guard ถอดไม่ได้, ledger จับความพยายามที่ถูกกลืน error | 6/6 assertions ผ่าน | PASS | — | 2026-09-19 |
| PK01 | `8231e697fcdf` | `extension/manifest.json` | permissions = `["storage"]` เป๊ะ, ไม่มี host บังคับ, ไม่มี permission ต้องห้าม, CSP ไม่มี unsafe/remote | 10/10 assertions ผ่าน | PASS | — | 2026-09-19 |
| PK03 | `8231e697fcdf` | `dist-release/meta.json` + bundle grep | metafile ไม่มี input ที่เป็น mock/fixture; bundle ไม่มี marker ของ mock; ไม่มี runtime override | 5/5 assertions ผ่าน (รวม positive control) | PASS | — | 2026-09-19 |
| PK02a | `8231e697fcdf` | source scan + bundle scan | ไม่มี `eval`, `new Function`, remote script, HTML-parsing sink ใน `extension/src` และใน bundle | ผ่านทั้ง source และ bundle | PASS | — | 2026-09-19 |
| **load unpacked** | `20326024634c97c3` / Brave, Windows 11 (extension ID `ogjfgfmombcacadhefjbmlhmmgdghpin`) | screenshot จากผู้ใช้ 2026-09-19 | ติดตั้ง `dist/` บน Brave ได้, ไม่ขอสิทธิ์ host, dashboard แสดง banner + build info, Network tab ว่าง | (1) ติดตั้งไม่มี prompt ขอสิทธิ์เว็บไซต์ใดๆ (2) dashboard แสดง banner "MOCK-ONLY PROTOTYPE — G0 ยังไม่ผ่าน" + build info ตรงกับ build hash จริง (3) กด "ทดสอบ mock adapter" ได้ผล http status 200, body 321 ตัวอักษร (4) DevTools service worker → Network tab **ว่างเปล่าสนิท** แม้กดทดสอบแล้ว | PASS | — | 2026-09-19 |

## M1.2 — ผลที่รันจริง

Build `bad7c1f3560c` · Node v22.20.0 · ไม่มี browser

| Test ID | Fixture/Evidence | Expected | Actual | Status |
|---|---|---|---|---|
| UT01 | FX01, FX12 / `tests/unit/product.test.ts` | ID 19 หลักออกมาเป็น string ตรงทุกหลัก | ตรงทั้ง 6 ID; `typeof` เป็น string ทุกแถว | PASS |
| UT02 | FX12 / `tests/unit/json-lossless.test.ts` | lossless หรือ reject ห้ามรับเลขที่ปัดแล้ว | เก็บ `1736749159048840633` และ `9007199254740993` ครบ (JSON.parse ปกติได้ `…840700`) | PASS |
| UT03 | FX08 / `tests/unit/envelope.test.ts` | HTTP 200 + business code ≠ success → API error | `business_error` code 10002 ไม่ใช่ `[]` | PASS |
| UT04 | FX09 / `tests/unit/envelope.test.ts` | `data.products` หาย/null/object → schema error | `schema_changed` ทั้ง 4 รูปแบบ + HTML login page | PASS |
| UT05 | FX07 / `tests/unit/product.test.ts` | image/shop/commission หาย → null + ไม่เติม 0 | null ทั้งกรณี missing และกรณีส่ง null มา | PASS |
| UT06 | FX06 / `tests/unit/product.test.ts` | status ใหม่/unknown → เก็บ raw enum ไม่คัดทิ้ง | `stock_status=77` และ `review_status` ที่หายไปยังอยู่ครบ 6 แถว | PASS |
| UT07 | FX06, FX07 / `tests/unit/product.test.ts` | stock=0 ต่างจาก stock=null | 0 → `0`, null → `null`, ค่าผิดกฎ → `null` + warning | PASS |
| UT08 | FX07 / `tests/unit/product.test.ts` | display คงเดิม; amount แปลงเฉพาะ rule ที่ verified | `฿1,299.00` คงเดิม, amount/currency = null + `price_amount_unverified` | PASS |
| UT10 | FX07 / `tests/unit/page.test.ts` | quarantine, counters ตรง, valid rows ไม่หาย | received 9 = invalid 3 + valid 6; quarantined เก็บ index 6,7,8 | PASS |
| UT11 | FX06 / `tests/unit/product.test.ts` | `can_added=false` → warning, ไม่เลือกอัตโนมัติ | `eligibility=unknown` + `can_add_false_conflicts`; `can_added=true` ไม่ยกระดับ | PASS |
| UT12 | FX10 / `tests/unit/page.test.ts` | secret canaries ไม่พบใน output ใด ๆ | canary ใน nested body, `set-cookie`, `authorization` และ error message ไม่ปรากฏ | PASS |
| UT09a | FX10 / `tests/unit/product.test.ts` | title ที่เป็น HTML ถูกเก็บเป็นข้อความครบตัวอักษร | เก็บตรงตัว ไม่มี code execution | PASS |
| **UT09** | ต้องใช้ preview UI | render product rows จาก FX10 เป็น text | **ยังไม่มี preview UI** | **NOT RUN** |

### Validation rules V01–V14

| Rule | Status | หลักฐาน / เหตุผล |
|---|---|---|
| V01 Envelope | PASS | `envelope.test.ts` — แยก schema/auth/business error ออกจากหน้าว่าง |
| V02 Product ID | PASS | `product.test.ts` — decimal string 1–128 ตัวอักษร, ว่าง/ไม่ใช่เลข/ยาวเกิน → quarantine |
| V03 Precision | PASS | `json-lossless.test.ts` — source-text reviver |
| V04 Title | PASS | `product.test.ts` — ว่างหลัง trim และเกิน 2,000 ตัวอักษร → quarantine |
| V05 Stock | PASS | `product.test.ts` — 0 ≠ null, ค่าผิดกฎ → null + warning ไม่ตัดสินค้า |
| V06 Status | PASS | `product.test.ts` — เก็บ raw enum; **ยังไม่มีค่าใดถูก map** เพราะ G0 ไม่ผ่าน |
| V07 Price | PASS | `product.test.ts` — display คงเดิม, amount/currency null, ช่วงราคาได้ warning แยก |
| V08 URLs | PASS | `product.test.ts` — `javascript:`/`data:`/`http:` ถูกปฏิเสธ, allowlist ยังว่าง, ตัด query ทิ้งเสมอ |
| V09 Optional fields | PASS | `product.test.ts` — null ไม่ใช่ 0 หรือข้อความเดา |
| V10 Unexpected data | PASS | `page.test.ts` — inventory เก็บชื่อ field เท่านั้น มีขอบเขต 64 รายการ; export ใช้ key allowlist |
| V11 UI rendering | PASS | `dom-safety.test.ts` (M1.1) — text-only sink + static guard |
| V12a Source binding (แถว) | PASS | `product.test.ts` — ทุกแถวผูก `sourceRef` และ `sourceIdentityVerified=false` |
| V12b identity mismatch | **PASS** | `runner.test.ts` IT02 |
| V13 Product limit | **PASS** | `pagination.test.ts` + `runner.test.ts` PG13 |
| V14a Byte limit (หน้า) | PASS | `envelope.test.ts` — 2 MiB วัดเป็น byte |
| V14b Staging limit (run) | **PASS** | `checkpoints.test.ts` LC07 |

### ข้อสังเกตเรื่องขอบเขต M1.2

spec §12 เขียน exit gate ของ M1.2 ว่า "V01–V14 + UT ผ่าน" แต่ **V12b, V13 และ V14b เป็นกฎระดับ run**
ซึ่งบังคับใช้ไม่ได้จนกว่าจะมี runner/checkpoint — ตอน M1.2 จึงบันทึกเป็น `NOT RUN` และมาผ่านจริงใน M1.3
ส่วน V06 ที่ `PASS` หมายถึง "กฎถูกบังคับใช้ถูกต้อง" ไม่ได้แปลว่ารู้ความหมายของ enum แล้ว —
ตรงกันข้าม กฎที่ถูกต้องในสภาพปัจจุบันคือ **ทุกแถวต้องเป็น `unknown`** เพราะยังไม่มี enum ใดถูกยืนยัน

### หมายเหตุขอบเขตของ IT01

IT01 ตาม spec เขียนว่า "CI ทุก suite และ test bundle" ณ M1.1 "ทุก suite" คือ 6 ไฟล์ข้างต้น
IT01 เป็น standing regression gate ที่ขยายไปพร้อม suite ไม่ใช่การอ้างว่าครอบคลุมโค้ดที่ยังไม่มี
guard ไม่เป็น vacuous เพราะมี assertion พิสูจน์ว่า (ก) reassign ไม่ได้ และ (ข) ความพยายามที่ถูก `catch` กลืนยังถูกจับได้

## M1.3 — ผลที่รันจริง

Build `df0e661ca546` (หลังแก้ตาม code review) · Node v22.20.0 · ไม่มี browser · **14 files, 203 tests, 203 passed**

### Code review ก่อนขึ้น M1.4

ส่ง subagent ตรวจ diff `d204d57..1d770a8` เทียบ spec §9/§10 เพราะ M1.3 เป็น core ที่ผมเขียนทั้ง test และ code เอง
พบ **bug จริง 3 จุด (Critical)** ที่ test เดิมไม่จับ เพราะ test เดิมพิสูจน์แค่ระดับ module (`retry.ts` เดี่ยวๆ
หรือ `checkpoints.ts` เดี่ยวๆ) ไม่ใช่ระดับ integration ที่ runner ใช้งานจริง:

1. `runner.ts` ส่ง `attempt: 1` คงที่ทุกครั้งให้ `planRetry` — retry limit ต่อ offset (§9.4 "ไม่เกิน 2 ครั้ง")
   ไม่เคยถูกบังคับใช้จริงจาก runner; 5xx/network error ที่เกิดซ้ำจะ retry ไปเรื่อยจนกว่างบ run ทั้งก้อนจะหมด
   ไม่ใช่หยุดหลัง 2 ครั้งตามที่ PG08–PG12 อ้างว่า PASS
2. หยุด retry แล้วรายงาน stop reason เป็น `'rate_limited'` เสมอไม่ว่าสาเหตุจริงจะเป็นอะไร — 500 ที่ค้างจะถูกรายงานผิดว่าเป็น rate limit
3. `checkpoints.ts::acquireLease` อ่าน-ตัดสินใจ-เขียนคนละ transaction กัน สอง lease ที่ขอมาพร้อมกัน
   อ่าน snapshot เดียวกันก่อนต่างฝ่ายต่างเขียน ทำให้**ได้ lease ทั้งคู่**พร้อม generation เดียวกัน — พังทั้ง
   "หนึ่งงานต่อ profile" (LC01) และ fencing ที่ commitPage พึ่งพา

แก้ด้วย TDD ทั้ง 3 จุด (เขียน test จำลอง scenario ก่อน ยืนยันว่า FAIL บนโค้ดเดิมจริง แล้วจึงแก้) พร้อม 2 จุด Important:
เพิ่ม `resumeAfterMs` ใน `RunReport` (ค่าที่มีอยู่แล้วใน `retry.ts` แต่ไม่เคยไหลออกมาถึง caller ตาม §9.4)
และแก้ `pagination_stalled` ที่ false-positive เมื่อหน้ามีแต่แถวเสีย (ไม่ใช่แถวซ้ำ) ให้เดินหน้าสแกนต่อได้ปกติ

**ยังไม่แก้ (บันทึกเป็น known limitation ไม่บล็อก M1.3):** checkpoint/product store ไม่มี retention
ข้ามหลาย run และมีการ `JSON.parse` body ซ้ำหลายครั้งต่อหน้า (envelope/page/identity/metadata แยกกันอ่าน)
ทั้งสองเป็น Important/Minor ที่ review แนะนำแต่ไม่กระทบความถูกต้องของ M1.3

### Pagination & Fault handling (PG01–PG17) — ผ่านครบ

| Test ID | Expected | Actual | Status |
|---|---|---|---|
| PG01 | 198 รายการ count=6 → offsets 0,6,…,192,198; 33 data pages + 1 empty; 198 unique | ตรงทุกข้อ, ID set ตรง 100% | PASS |
| PG02 | count=50 → offsets 0,50,100,150,198; 4 data pages + 1 empty | ตรงทุกข้อ | PASS |
| PG03 | ขอ 50 ได้ 6 → offset ต่อเป็น 6 | offsets 0,6,12,18 ไม่มีสินค้าข้าม | PASS |
| PG04 | raw 6 valid 2 → offset เพิ่ม 6 | receivedRows 6, validRows 2, nextOffset 6 | PASS |
| PG05 | overlap → dedup ตรง, raw/unique แยก | new 6→4, duplicate 2, unique 10 | PASS |
| PG06 | หน้าเดิมตลอด → pagination_stalled/partial | หยุดที่ 6 unique ไม่วนไม่จบ | PASS |
| PG07 | หน้าสั้นแต่ has_more=true → ไม่หยุด | เดินต่อ; หยุดเฉพาะหน้าว่างจริง | PASS |
| PG08 | 401/403 → หยุด ไม่ลด count ไม่ retry | auth_required / access_denied, pageSizeReductions=0 | PASS |
| PG09 | Retry-After=120 → ไม่ยิงก่อน 120s | waitMs=120000; เกินงบ → pause พร้อมเวลาเริ่มใหม่, `report.resumeAfterMs=120000` | PASS |
| PG10 | HTTP-date / ผิดรูป / ไม่มี → ไม่ hot loop | parse ถูกต้อง, ค่าผิดรูปคืน null แล้วใช้ backoff 30s/60s | PASS |
| PG11 | network/5xx retry offset เดิม ไม่เกิน 2 (ทดสอบที่ runner จริง ไม่ใช่แค่ `retry.ts` เดี่ยวๆ) | 3 requests ที่ offset เดิม (1 initial + 2 retry) แล้ว `transport_error`; adapter throw ก็เข้ากฎเดียวกัน; offset ขยับแล้ว attempt counter รีเซ็ต | PASS |
| PG12 | fallback ครั้งเดียว; auth/rate/schema ไม่เข้าทางนี้ | fallback ปิดทั้งหมด (ยังไม่มี error ที่ยืนยัน) | PASS |
| PG13 | ชนเพดาน → partial + reason ไม่ตัดเงียบ | request/product/time limit แยกเหตุผลถูกต้อง | PASS |
| PG14 | metadata ขัดแย้ง → unknown/partial + diagnostic | empty+has_more, next_offset ถอยหลัง/ไม่ขยับ = conflict | PASS |
| PG15 | Cancel ตอน fetch และตอนรอ retry | abort ทันที ไม่มี request ถัดไป ไม่มี late commit | PASS |
| PG16 | ไม่มีสินค้า + envelope ถูกต้อง → endpoint-end 0 rows | ready_complete, ไม่ตีเป็น login failure | PASS |
| PG17 | ID เดิมราคาต่าง → valid ล่าสุด, changedWithinRun, invalid ไม่ทับ | ตรงทุกข้อ | PASS |

### Lifecycle (LC01–LC07)

| Test ID | Expected | Actual | Status |
|---|---|---|---|
| LC01 | active run เดียว ไม่มี network สองชุด | lease ปฏิเสธ run ที่สอง, requests=0; **race จริงด้วย `Promise.all` สอง acquireLease พร้อมกัน → สำเร็จแค่หนึ่ง**; `run.start` ซ้อนถูกปฏิเสธด้วย `already_running` | PASS |
| LC02 | ปิด popup แล้วเปิดใหม่ เห็น run เดิม/checkpoint | ดูตาราง M1.4 ด้านบน | PASS |
| LC03 | terminate SW หลัง commit หน้าแรก → staged คงอยู่, stale lease → Interrupted | เปิด store ใหม่ยังได้ 6 แถวและ checkpoint เดิม; findStaleRuns ทำงาน — **หมายเหตุขอบเขตหลักฐาน (ณ M1.3):** นี่คือ unit simulation บน fake-indexeddb ไม่ใช่การหยุด service worker จริง หลักฐานระดับ browser จริง (Playwright + Chrome DevTools Protocol, ฟัง `ServiceWorker.workerVersionUpdated` จน `runningStatus==='stopped'`) เพิ่มแล้วในรอบตรวจสอบนี้ — ดู § รอบตรวจสอบและปิดช่องว่าง (audit) ด้านล่าง | PASS |
| LC04 | crash ก่อน/หลัง transaction → ไม่มีครึ่งหน้า | transaction abort จริง, rows คงที่ 6, offset ไม่เดิน | PASS |
| LC05 | restart run แล้ว response เก่ากลับมา → fencing ปฏิเสธ | stale_generation, ไม่มีแถวถูกเขียน | PASS |
| LC06 | browser restart → เสนอ scan ใหม่จาก 0 ไม่บอก completed | firstOffset=0, run เก่าเป็น stale — **หมายเหตุขอบเขตหลักฐาน (ณ M1.3):** นี่คือ unit simulation บน fake-indexeddb ไม่ใช่ browser restart จริง หลักฐานระดับ browser จริง (ปิด/เปิด browser จริงบน user-data directory ชั่วคราวที่สร้างด้วย `mkdtemp` และลบด้วย `finally`) เพิ่มแล้วในรอบตรวจสอบนี้ — ดู § รอบตรวจสอบและปิดช่องว่าง (audit) ด้านล่าง | PASS |
| LC07 | IndexedDB quota/write failure → partial/storage_error, offset ไม่เดินโดยข้อมูลหาย | staging_limit_reached, checkpoint ตรงกับจำนวนที่ commit จริง | PASS |

### Integration & Validation rules ที่ปลดล็อกใน M1.3

| ID | Expected | Actual | Status |
|---|---|---|---|
| IT02 | identity เปลี่ยนกลาง run → หยุด identity_changed | หยุดที่ 6 แถว ไม่ผสมข้าม source | PASS |
| IT03 | ไม่มี identity → ระบุ unverified | `sourceIdentityVerified=false` + warning `source_identity_unverified` | PASS |
| V12b | identity mismatch → หยุดและเก็บแยก | ครอบคลุมโดย IT02 | PASS |
| V13 | 5,000 unique/run → stopped_by_limit ไม่ silent truncate | `product_limit_reached` พร้อม droppedByLimit | PASS |
| V14b | staging ไม่เกิน 20 MiB/run | `staging_limit_reached`, offset ไม่เดิน | PASS |
| AT02 | schema เปลี่ยนไม่เท่ากับไม่มีสินค้า | หยุด schema_changed, เก็บของเดิม, partial | PASS |
| AT03 | ไม่ย่น Retry-After | ครอบคลุมโดย PG09/PG10 | PASS |

### ข้อสังเกตของ M1.3

- **exit gate "PG/LC tests ผ่าน" ผ่านแล้ว ยกเว้น LC02** ซึ่งต้องมี UI อ่าน checkpoint — เลื่อนไป M1.4
- `access_denied` เป็น **stop reason** ไม่ใช่ state: §10 ไม่มี state ชื่อนี้ 403 จึงลงเป็น state `failed`
  และไม่ใช่ `auth_required` เพราะ 403 ไม่ใช่ปัญหาการล็อกอิน
- `scanCoverage` เป็น `unknown` เมื่อไม่มีสินค้าเลยไม่ว่าจะหยุดด้วยเหตุผลใด (ไม่ใช่เฉพาะ schema_changed/transport_error
  อย่างที่เคยเขียนไว้ก่อน review) — ไม่มีข้อมูลแปลว่ายังไม่รู้อะไรเกี่ยวกับ endpoint เลย ไม่ใช่แค่บางกรณี
- **ยังไม่มี live adapter** ทุกอย่างข้างบนรันบน mock adapter + fixture สังเคราะห์ล้วน

## M1.5 — ผลที่รันจริง

Build `efacfb243799…` / `dfb8956c5e49…` · Node v22.20.0 · Playwright Chromium

### E2E (Playwright, เบราว์เซอร์จริง)

| Test | Expected | Actual | Status |
|---|---|---|---|
| load-unpacked | extension โหลด, SW ลงทะเบียน, dashboard/popup render ไม่มี console error | 3/3 ผ่าน: extension ID ตรง pattern `^[a-p]{32}$`, service worker ≥1 ตัวลงทะเบียน; dashboard banner มีคำว่า "MOCK-ONLY", `#build-info` มีคำว่า "mock", ปุ่ม start แสดง, ไม่มี console error เลย; popup แสดง `#status` เป็น "idle" | PASS |
| scan-flow | Start → scan 20 ตัว → เลือก → export ได้ไฟล์ที่มีเฉพาะที่เลือก | 3/3 ผ่าน: scan mock 20 ตัว (หน่วงหน้าละ 1s) → run-status เป็น `ready_complete`; เลือก 2 ตัว → export ไฟล์มี `selectedProductIds`/`products` ตรง 2 ID ตามที่เลือกเป๊ะ, `scanCoverage=reached_endpoint_end`, `adapterVersion=mock-v0`; select-all → export ครบ 20; export โดยไม่เลือกอะไร → `products=[]` พร้อม metadata ครบ 8 key (ไม่ error) | PASS |
| network-isolation (ยืนยันครึ่ง PK04 "ไม่มี request ออกนอกเครื่อง") | ไม่มี request ออกนอกเครื่องตลอด flow | 2/2 ผ่าน: ตลอด flow start→scan→select-all→export ไม่มี external request เลยสักครั้ง (`externalRequests` ว่าง 0 รายการ); ไม่มี request ใดที่ URL มีคำว่า "tiktok" | PASS |

รวม E2E: **8 passed, 0 failed (29.7s)**

### Validation (VA)

| VA | หลักฐาน | Status |
|---|---|---|
| VA07 | ผู้ใช้เลือก 3 ตัวแล้ว export — ไฟล์ `flow-a-export-9e01f052…json` มี selectedProductIds และ products ตรงกัน 3 ID ไม่มีแถวอื่น (2026-09-19) | PASS |
| VA08 | DevTools → IndexedDB `flow-a-checkpoints` → `products` ขยายแถวเต็ม: มีเฉพาะ field ใน schema §8.1 ไม่มี cookie/token/session/authorization (2026-09-19) | PASS |
| VA09 | Brave ผ่าน 2026-09-19; Chrome ผ่าน 2026-09-19 (v153.0.8010.48, Windows 11 25H2) — load unpacked ไม่มี permission prompt, Start→scan 20 ตัว→เลือก→export ผ่านครบทุกขั้น | PASS |
| VA02 | ต้องเทียบกับหน้าเว็บ TikTok จริง | BLOCKED (G0) |
| VA04 | ต้องรู้ความหมาย enum จริง ซึ่งเป็นสิ่งที่ G0 มีไว้หาคำตอบ | BLOCKED (G0) |

### Coverage (เกณฑ์ G1: branch ≥90%)

| ไฟล์ | Branch % | ผ่านเกณฑ์ |
|---|---|---|
| domain/envelope.ts | 100% (31/31) | ใช่ |
| domain/product.ts | 93.02% (80/86) | ใช่ |
| domain/page.ts | 100% (15/15) | ใช่ |
| domain/json-lossless.ts | 100% (10/10) | ใช่ |
| core/pagination.ts | 95.23% (40/42) | ใช่ |
| core/retry.ts | 100% (38/38) | ใช่ |
| core/runner.ts | 95.55% (86/90) | ใช่ |

`npm run test:coverage` (vitest threshold gate ตาม `vitest.config.ts`) exit code 0 — ผ่านทั้ง 7 ไฟล์
(coverage รวมทั้งโปรเจกต์ต่ำกว่านี้มาก เพราะรวม `dashboard/main.ts`, `popup/main.ts`, `background.ts` ที่ไม่มีเกณฑ์บังคับ — คุมด้วย E2E/static guard แทน)

### Package security

| ID | Status | หลักฐาน |
|---|---|---|
| PK02 | PASS | `tests/integration/pk02-pk03-build.test.ts` 12/12 ผ่าน: bundle scan ไม่พบ secret pattern, ไม่มีการอ้างถึง `chrome.cookies`, service worker ไม่มีเส้นทางขอ permission เอง, ไม่มี general-purpose credential export |
| PK04 | PASS | ไม่มี request ออกนอกเครื่องตลอด flow — ยืนยันด้วย E2E ที่ครอบทุก scheme แบบ deny-by-default (`isExternalRequest()`) บวก positive control ที่พิสูจน์ว่า listener จับความพยายามได้จริง (ดู § รอบตรวจสอบและปิดช่องว่าง (audit) ด้านล่าง) |
| PK04 (ครึ่ง "allowlisted read-only") | NOT APPLICABLE | ยังไม่มี live adapter จึงยังไม่มี request ใดให้ตรวจ allowlist |
| PK05 | PASS | ผู้ใช้ถอนติดตั้ง extension จริงบนเบราว์เซอร์ (2026-09-19) — การ์ด extension หายไปจาก `chrome://extensions` ทันทีหลัง Remove |

สองแถว PK04 ข้างต้นคือ **id เดียวกัน** แยกตามครึ่งของข้อกำหนด (spec §13.7) — ไม่ใช่การเปลี่ยน requirement และ
**PK04 โดยรวมยังไม่ถือว่า PASS เต็มรายการ** จนกว่าจะมี live adapter ให้ตรวจครึ่ง allowlisted read-only ด้วย

## รอบตรวจสอบและปิดช่องว่าง (audit)

รอบนี้เป็นรอบตรวจสอบและปิดช่องว่างที่ audit ของ M1.5 พบ ไม่ใช่ milestone ใหม่ — แก้ defect จริงในโค้ดและเพิ่มหลักฐาน
test ที่ขาดไป เนื้อหาส่วนนี้**แยกจากผลของ M1.1–M1.5 ด้านบน** ซึ่งยังคงเป็นบันทึกประวัติของรอบที่รันตอนนั้นตามจริง
ไม่ถูกแก้ย้อนหลัง (จุดที่มีการแก้คำอธิบายในตารางเดิม เช่น LC02/LC03/LC06 ด้านบน คือการแก้ **คำอธิบาย** ให้ตรงกับ
ขอบเขตหลักฐานเดิม ไม่ใช่การเปลี่ยนผลที่รันจริง)

### Environment ของรอบนี้

| รายการ | ค่า |
|---|---|
| วันเวลา | 2026-09-20 |
| OS | Windows 11 Home Single Language 10.0.26200 |
| Node | v22.20.0 |
| Test runner | Vitest 5.0.1 · Playwright @playwright/test 1.63.0 |
| Release build hash | mock `fb5e7fa7c8b2…` · release `406c2f811783…` (คำนวณจาก HEAD ปัจจุบันตอนรันรอบนี้ — ดู `scripts/build.mjs`: hash มาจาก source+channel ไม่ใช่ output จึง reproducible จาก commit เดิมได้เสมอ) |
| คำสั่ง | `npm run typecheck` → `npx vitest run` → `npm run test:coverage` → `npm run build:mock && npm run build` → `npm run test:e2e` (รันตามลำดับทีละคำสั่งจริงตามที่ระบุใน Step 1) |
| ผลรวม | typecheck: ผ่าน (exit 0) · vitest: 20 test files / 300 tests ผ่านทั้งหมด (exit 0, 1.93s) · test:coverage: 20 test files / 300 tests ผ่าน, coverage threshold gate exit 0 ครบ 7 ไฟล์ (ดูตาราง coverage ด้านบน — ตัวเลขเดิมยืนยันซ้ำ ไม่มี regression) · build:mock/build: ผ่านทั้งคู่ · test:e2e: 15/15 ผ่าน (6 spec files, 57.1s) |
| Browser | Chromium 153.0.8010.12 (bundled มากับ Playwright 1.63.0, เรียกผ่าน `chromium.launch()` ค่า default ไม่ได้ระบุ channel เฉพาะใน `playwright.config.ts`) |

### Defect ที่พบและแก้ (D1–D4)

**D1 — progress latency วัดไม่ได้จริงโดยโครงสร้าง (structurally unmeetable)**

Dashboard เดิม poll ทุก 1000ms ซึ่งเท่ากับงบ 1 วินาทีของ spec เป๊ะ — ต่อให้ commit เร็วแค่ไหน ตัว poll period เอง
ก็กินงบไปเกือบหมดแล้ว แก้โดยลด `POLL_INTERVAL_MS` เหลือ 250 (`extension/src/dashboard/main.ts`) และเพิ่ม field
`lastCommitAt` ใน `RunCheckpoint` (`extension/src/storage/checkpoints.ts`) จากนั้นเขียน E2E จริง
(`tests/e2e/latency.spec.ts`) ที่ยึดการวัดกับ `lastCommitAt` ไม่ใช่แค่ดูข้อความ `#run-status` เปลี่ยน (ซึ่งวัดได้แค่
คาบ poll ไม่ใช่ latency จริง) — assertion ยึดกับงบจริงของ spec §16: progress ≤1000ms, cancel ≤2000ms

ระหว่างเขียน test นี้พบ race ที่มีอยู่ก่อนแล้วจริง: `resumeDashboardState` เดิมอ่าน checkpoint กับ product count
คนละ transaction กัน ทำให้ commit แทรกกลางระหว่างสองการอ่านได้ จับคู่ timestamp เก่ากับ count ใหม่ (วัดซ้ำได้เป็น lag
ที่เกิดจริง ไม่ใช่ jitter สุ่ม) แก้ด้วย `CheckpointStore.findActiveRunWithCount()` ใหม่ — หนึ่ง transaction อ่านทั้ง
checkpoint และ product count พร้อมกัน (`extension/src/storage/checkpoints.ts`, ใช้ใน
`extension/src/dashboard/resume.ts`)

ตัวเลข progress lag/cancel latency ที่วัดได้จริงของรอบตรวจสอบนี้ (รันจริง 2026-09-20 ด้วย `npm run test:e2e`,
อ่านจาก console log `[วัดจริง]` ที่ `tests/e2e/latency.spec.ts` พิมพ์ออกมา):

- **progress lag สูงสุด = 244 ms จาก 67 ตัวอย่าง** (งบ ≤1000ms ตาม spec §16 → **PASS**) — จุดวัด: สำหรับทุกตัวอย่างที่
  จอแสดงจำนวนน้อยกว่าที่ commit จริงแล้ว (`displayed < committed`) คำนวณ `ตอนที่สุ่มตัวอย่าง (at) − เวลา commit หน้า
  ล่าสุด (lastCommitAt จาก checkpoint)` แล้วเอาค่ามากสุดของทุกตัวอย่างเช่นนั้น
- **cancel latency = 233 ms** (งบ ≤2000ms ตาม spec §16 → **PASS**) — จุดวัด: จากตอนกดปุ่ม Cancel (`clickedAt`) ถึงตอนที่
  `#run-status` แสดงคำว่า "cancelled" ครั้งแรก และยืนยันเพิ่มว่าไม่มี commit เพิ่มอีกใน 2 วินาทีถัดจากนั้น (ไม่มี late
  commit)

**ข้อสังเกตเรื่องความถูกต้องของการวัด progress lag** (ตามที่ระบุไว้ใน comment ของ `tests/e2e/latency.spec.ts`): loop
ที่ใช้วัดเรียก `run.status` เองทุก 50ms ซึ่งเพิ่มภาระเล็กน้อยให้ระบบที่กำลังถูกวัดอยู่ ตัวเลข 244ms ที่ได้จึงเป็น
**ขอบบน (upper bound)** ของ latency จริง ไม่ใช่ค่าที่ต่ำที่สุดที่เป็นไปได้ — เมื่อผ่านเกณฑ์ 1000ms ด้วยขอบบนแล้ว (244ms
เหลือ margin กว่า 750ms) จึงถือว่าผ่านจริงอย่างปลอดภัย ไม่ใช่ผลที่ optimistic เกินจริง

**D2 — `heartbeat()` ไม่เคยถูกเรียกจาก production code เลย**

`CheckpointStore` มี method `heartbeat()` แต่ก่อนรอบนี้ไม่มีจุดใดในโค้ดเรียกมันเลย ทำให้ run ที่ยังทำงานอยู่จริงแต่ใช้
เวลานานเสี่ยงถูกรายงานผิดว่า lease หมดอายุ/interrupted ทั้งที่ยังทำงานอยู่ แก้ใน `extension/src/core/runner.ts` —
เรียก `store.heartbeat()` หลัง commit แต่ละหน้าสำเร็จ

**(อัปเดตจาก final-review fix wave):** การเรียก `heartbeat()` หลัง commit เพียงจุดเดียวตามที่บันทึกไว้ข้างต้นยังไม่ปิด
ช่องว่างจริงของ D2 — `commitPage()` เองก็ต่ออายุ `leaseExpiresAt` อยู่แล้ว (`extension/src/storage/checkpoints.ts`
บรรทัด `leaseExpiresAt: input.now + leaseTtlMs` ซึ่งมีอยู่ก่อน Task 2 แล้ว) จุดที่ heartbeat หลัง commit fire จึงเป็น
การต่ออายุ lease ที่เพิ่งถูกต่อไปหมาด ๆ ไม่กี่ไมโครวินาทีก่อนหน้า ไม่ได้เปลี่ยนพฤติกรรมที่สังเกตได้จริงในกรณีปกติ
ความเสี่ยงจริงอยู่ที่ระหว่างรอ retry/backoff (`deps.sleep(plan.waitMs, ...)` ใน runner.ts) ซึ่งไม่มี `commitPage`
เกิดขึ้นเลย และอาจกินเวลานานกว่า `leaseTtlMs` (60s) ได้จริงตามที่ PG09 ยืนยันไว้แล้ว (Retry-After ได้ถึง 120s) —
แก้เพิ่มโดยเรียก `store.heartbeat()` ก่อนเริ่ม `sleep` ทั้งสองจุดของ retry path (network error และ
business/rate-limited error) ด้วย ไม่ใช่แค่หลัง commit เท่านั้น ตอนนี้ heartbeat จึงยิงทั้ง (1) หลัง commit แต่ละหน้า
สำเร็จ และ (2) ก่อนเริ่มรอ retry/backoff ทุกครั้ง — มี regression test ใหม่ (`tests/unit/runner.test.ts` describe
`D2 gap`) จำลองการรอสะสมนานเกิน `leaseTtlMs` โดยไม่มี commit คั่นกลาง แล้วตรวจ `store.readCheckpoint()` โดยตรงว่า
`leaseExpiresAt` ครอบคลุมตลอดความยาวของการรอครั้งที่สอง (พิสูจน์ด้วย TDD: stash โค้ด runner.ts ที่แก้แล้วกลับไปเป็น
เดิม ยืนยันว่า test ใหม่ FAIL จริงด้วยเหตุผลตรงประเด็น — `leaseExpiresAt` น้อยกว่าจุดสิ้นสุดของการรอ — ก่อนคืนกลับมาเป็น
โค้ดที่แก้แล้วแล้วยืนยันว่า PASS)

**(อัปเดต 2026-09-20 — ปิดจบ):** แม้แก้ตามย่อหน้าข้างบนแล้ว ช่องว่างก็ยังเหลืออยู่อีกชั้นหนึ่ง เพราะ heartbeat
*ครั้งเดียวก่อนรอ* ต่ออายุ lease ได้แค่ `leaseTtlMs` (60 วินาที) ขณะที่ `RETRY_POLICY.maxRetryAfterMs` อนุญาตให้รอ
ได้ถึง 15 นาที — การรอครั้งเดียวที่ยาวเกิน 60 วินาทีจึงยังทำให้ lease หมดอายุกลางคันได้จริง แก้รอบนี้โดยเพิ่ม
`waitWithHeartbeat()` ใน `extension/src/core/runner.ts` ซึ่งซอยการรอเป็นช่วงละ `store.leaseTtlMs / 3` แล้ว
heartbeat คั่นระหว่างช่วง (ความถี่อ่านจาก TTL จริงของ store ไม่ hardcode) และใช้แทน `deps.sleep()` ตรง ๆ ที่จุดรอ
retry ทั้งสองจุด

Regression test ใหม่: `tests/unit/runner.test.ts` เคส `Retry-After: 900` (15 นาที = เพดานของนโยบาย) เก็บ timeline
ของทุกจุดเวลาที่นาฬิกาเดินไปถึง แล้ว assert ว่า (1) `leaseExpiresAt` ไม่เคยน้อยกว่าเวลาปัจจุบัน ณ จุดใดเลย และ
(2) ช่องว่างระหว่างสองจุดเวลาที่ติดกันไม่เกิน `store.leaseTtlMs` พิสูจน์ว่าไม่ใช่ vacuous pass ด้วยการตั้ง
`heartbeatEveryMs` เป็น `Number.MAX_SAFE_INTEGER` ชั่วคราว → test FAIL จริง (`expected 2 to be greater than 30`)
แล้วคืนค่ากลับ → PASS · สถานะ: `npm test` 429/429 PASS, `npm run typecheck` ไม่มี error

**D3 — orphaned lease หลัง service worker ตายถูกซ่อนจาก UI + พบ regression ระดับ Critical ระหว่างแก้**

เมื่อ MV3 service worker ถูกฆ่ากลาง run ทั้งที่ lease ของมันยังไม่หมดอายุ dashboard เดิมแสดง "พร้อมเริ่มใหม่" (ซ่อน
ทั้ง run ที่ค้างและข้อมูลที่ staged ไว้จาก UI) แทนที่จะเป็น "interrupted" และกด Start จะพังด้วย `run_already_active`
แก้ `run.status` ให้รายงาน lease ที่กำพร้าแต่ยังไม่หมดอายุเป็น `interrupted` และแก้ `run.start` ให้ปล่อย lease กำพร้า
ก่อนเริ่มใหม่ (`extension/src/messaging/handle.ts`)

ระหว่าง review พบ TOCTOU race ระดับ **Critical**: การแก้ตามที่ plan เขียนไว้ตรงตัวรอบแรกแทรก `await` คั่นระหว่าง
guard "มี run วิ่งอยู่หรือยัง" กับการ claim registry ทำให้เปิดช่องให้ `run.start` สองครั้งที่ถูก dispatch มาพร้อมกัน
(เช่นดับเบิลคลิก หรือสองแท็บ) ผ่าน guard ได้ทั้งคู่ — แก้โดยย้ายให้การ claim registry เกิดแบบ synchronous ทันทีหลัง
guard ส่วนการปล่อย orphan lease ย้ายเข้าไปอยู่ใน async continuation แทน มี regression test ใหม่ (`Promise.all` ของ
`run.start` สองครั้งพร้อมกัน) พิสูจน์ว่าปิด race แล้วจริง

จากนั้นพิสูจน์ทั้ง LC03 และ LC06 ที่ระดับ browser จริงด้วย Playwright + Chrome DevTools Protocol แทนที่การจำลอง
ระดับ unit เดิมบน fake-indexeddb:
- **LC03** — ฟัง CDP event `ServiceWorker.workerVersionUpdated` แล้วเช็ค `runningStatus === 'stopped'`
  (ไม่ใช้ `context.serviceWorkers().length` เพราะพบว่าค่านี้ไม่เปลี่ยนแม้ worker จะถูกหยุดจริงแล้ว — ไม่น่าเชื่อถือ)
- **LC06** — ปิด/เปิด browser จริงบน user-data directory เดียวกัน (สร้างด้วย `mkdtemp`, ลบด้วย `finally` —
  ไม่แตะ profile จริงของผู้ใช้เลย)

**D4 — ไม่มีเส้นทางลบข้อมูลอยู่เลยในโค้ด ขัดทั้ง PK05 และคำโฆษณาของ README**

ก่อนรอบนี้ไม่มี code path ใดในโปรเจกต์ที่ลบข้อมูลได้เลย ขัดทั้งข้อกำหนด PK05 ของ spec และคำอ้างเดิมใน README ที่บอกว่า
Remove ลบ `chrome.storage` และ IndexedDB — ครึ่ง `chrome.storage` เป็นเท็จมาตั้งแต่ก่อนรอบนี้แล้ว (มี permission
`storage` แต่ไม่เคยเขียนอะไรลง `chrome.storage` เลยสักที่ — ยืนยันด้วยการอ่านโค้ดจริง ไม่มี `chrome.storage`
ปรากฏใน `extension/src` เลย) เพิ่ม message type `data.clear` ใหม่, `CheckpointStore.clearAll()`
(ลบทั้งสอง IndexedDB object store ใน transaction เดียว) และปุ่มในหน้าจัดการพร้อมยืนยันสองจังหวะ ปฏิเสธการล้างขณะมี
run วิ่งอยู่จริงใน service worker ปัจจุบัน — เงื่อนไขเดียวกับ guard ของ `run.start` (`registry.currentController
!== null`; lease ที่กำพร้าแต่ worker เจ้าของหมดอายุไปแล้วไม่กันการล้าง) มีทั้ง unit test และ E2E test จริงพิสูจน์
การปฏิเสธนี้

### หลักฐานใหม่ที่เพิ่ม

- E2E latency test ที่ยึดกับ `lastCommitAt` (ไม่ใช่แค่ข้อความ UI เปลี่ยน) วัด progress lag และ cancel latency จริง
  เทียบงบ 1000ms/2000ms ของ spec §16
- Regression test ที่จับ TOCTOU ของ `run.start` (สอง call พร้อมกันผ่าน `Promise.all`)
- E2E LC03 (service-worker termination จริงผ่าน CDP) และ LC06 (browser close/reopen จริงบน user-data dir ชั่วคราว)
  แทนที่การจำลองระดับ unit เดิมบน fake-indexeddb
- Unit test + E2E test สำหรับ `data.clear` (PK05): ล้างสำเร็จเมื่อไม่มี run ทำงาน, ถูกปฏิเสธเมื่อมี run ทำงานอยู่จริง
- `isExternalRequest()` classifier ใหม่แบบ deny-by-default (fail-closed บน URL ที่ parse ไม่ได้, ครอบทุก scheme
  ยกเว้น allowlist ที่รู้ว่าปลอดภัยบวก loopback host) แก้ช่องโหว่ที่ `ws://` เคยหลุดผ่าน filter เดิมไปได้เฉย ๆ
- Positive-control E2E test ใหม่: `fetch()` ไปยัง loopback port ที่ปิดอยู่ แล้วพิสูจน์ว่า `context.on('request')`
  listener สังเกตเห็นความพยายามนั้นจริง (พิสูจน์ว่าตัวตรวจจับทำงานจริง ไม่ใช่แค่ happy path ที่ว่างเปล่า)
- Test ใหม่พิสูจน์ว่า `assertNoViolations()` (ฝั่ง Node/Vitest) throw จริงเมื่อ ledger ไม่ว่าง และไม่ throw เมื่อว่าง
  (เดิมมีแค่ครึ่ง "บันทึกลง ledger" ที่ถูกทดสอบ ไม่เคยมี test ของครึ่ง "escalate เป็น throw ให้ suite แดง")
- Mock catalog: สอง product ID (`1736749159048840634`, `1736749159048840635`) ปรากฏเป็นตัวเลขไม่มี quote ใน
  wire-format JSON text จริง (type ฝั่ง TypeScript ยังเป็น `string` เหมือนเดิมทุกที่ — เปลี่ยนแค่ wire text) ทำให้
  E2E lossless-parsing assertion เดิม (ที่เทียบสองค่าที่อ่านจากไฟล์ export เดียวกัน จึงพิสูจน์อะไรไม่ได้แม้ ID จะถูก
  ปัดเสียหายไปแล้วก็ตาม) กลายเป็น assertion ที่มีความหมายจริง — เทียบกับ digit string ที่ hardcode ไว้ตรง ๆ และยืนยัน
  ว่าค่าที่ปัดแล้วไม่ปรากฏเลยในไฟล์ export มี E2E test เพิ่มเติมยืนยันว่า source-text reviver ของ `JSON.parse` ใน
  เบราว์เซอร์จริง (ไม่ใช่แค่ของ Node/vitest) ใช้งานได้จริงในบริบทการรันของ extension

### ข้อจำกัดที่ยังเหลือ

- **E2E network listener ผูกหลัง service worker พร้อมแล้ว** — traffic ระหว่างช่วง **startup** ของ service worker
  จึงอยู่นอกหน้าต่างการสังเกตของ harness ปัจจุบัน นี่คือข้อจำกัดจริงที่เปิดเผยไว้ตรงนี้ ไม่ได้ถูกแก้โดย Task 7
- **Node-side Vitest network guard** ครอบ `fetch`/XHR/`WebSocket`/`EventSource`/`sendBeacon` และ TCP ที่ไม่ใช่
  loopback (ครอบ `node:http`/`node:https` ไปด้วยเพราะสุดท้ายลงที่ `net.Socket`) แต่**ไม่ครอบ** `dns` lookup,
  UDP/`dgram`, `child_process`, `worker_threads`, ปลายทาง loopback, การ `connect()` ที่ไม่ระบุ port หรือการแทนที่
  global ด้วย `Object.defineProperty` — `configurable: true` ของ global ที่ล็อกไว้เป็นการตัดสินใจโดยเจตนา เพราะ
  jsdom ต้องการลบ global เหล่านี้ระหว่าง teardown ของแต่ละ test file ไม่ใช่ช่องโหว่ที่มองข้าม
- **`npm run test:e2e` ไม่โหลด Node-side guard เลย** เพราะเป็นคนละ test runner/process จาก Vitest โดยสิ้นเชิง —
  เป็นเรื่องปกติของการแยก suite ไม่ใช่ช่องว่างที่ต้อง "แก้"
- **(จาก Task 8) Product ID ไม่เคยไหลผ่าน `JSON.parse` ธรรมดาใน `runner.ts` เลย** — ยืนยันด้วยการอ่านโค้ดจริง
  (`product_id` ไม่ปรากฏใน `extension/src/core/runner.ts` เลย) `JSON.parse` ธรรมดาที่นั่นใช้กับ pagination metadata
  เท่านั้น (เช่น `next_offset`/`total`) มีแต่ lossless parser ของ `envelope.ts` เท่านั้นที่อ่าน `product_id` —
  บันทึกไว้เป็นขอบเขตที่ยืนยันแล้ว ไม่ใช่ข้อสันนิษฐาน

## รอบแก้ D5 — Export ล้มด้วย `no_report` หลัง scan เสร็จสมบูรณ์ (2026-09-20)

พบจากการใช้งานจริงของผู้ใช้ ไม่ใช่จาก audit — สแกน Showcase ได้ 198 รายการสำเร็จ preview แสดงผลปกติ
เลือกสินค้าทั้งหมดแล้วกด Export แต่ได้ error dialog `export ไม่สำเร็จ: no_report` ทั้งที่ preview ยังคง
แสดงรายการอยู่ตรงหน้า

### สาเหตุ

`RunReport` ของ run ที่จบแล้วถูกเก็บไว้แค่ในตัวแปร `registry.currentReport` ซึ่งอยู่ในหน่วยความจำของ
MV3 service worker เท่านั้น ไม่เคย persist ลง IndexedDB เลย (ต่างจาก checkpoint ระหว่างวิ่งที่ commit
ทีละหน้าอยู่แล้วตาม §10) Chrome ทำ idle-kill service worker ได้เมื่อไม่มี event เข้ามาสักพัก (ปกติ ~30
วินาที) — ผู้ใช้ที่ใช้เวลาเลือกสินค้าหลายร้อยรายการนานกว่านั้นก่อนกด Export จะเจอ service worker ที่ถูก
ปลุกใหม่ (module `background.ts` โหลดใหม่ทั้งหมด, `registry` กลับไปเป็นค่าเริ่มต้นว่างเปล่า) ในขณะที่
dashboard (หน้าเว็บ) ไม่ได้ reload จึงยังโชว์ preview เดิมค้างอยู่ในหน่วยความจำของตัวหน้าเว็บเองตามปกติ
— ไม่มีทางรู้ว่า backend ลืมไปแล้วจนกว่าจะกด action ที่ยิง message ไปหามัน

### การแก้

เพิ่ม object store ใหม่ `STORE_FINISHED_REPORT` ใน `extension/src/storage/checkpoints.ts`
(bump `DB_VERSION` 1→2 พร้อม migration ที่ไม่แตะ `runs`/`products` เดิม) พร้อมเมธอด
`saveFinishedReport`/`readFinishedReport`/`clearFinishedReport` คีย์ด้วย `sourceRef` (สอดคล้องกับ
สถาปัตยกรรม "หนึ่ง run ต่อ profile" เดิม) `handle.ts` เขียนผลลง store ทันทีที่ run จบ **ก่อน** ตั้งค่าใน
`registry` เสมอ (กันช่วงเวลาที่ค่าอยู่ใน memory แต่ยังไม่ถูก persist) และล้าง finished report เก่าตอนเริ่ม
run ใหม่ (ในส่วน fire-and-forget ไม่ใช่ synchronous claim block ของ `run.start` — ไม่แตะ TOCTOU guard
ของ D3 ที่แก้ไปก่อนหน้านี้) `run.status`/`run.export` fallback ไปอ่านจาก store เมื่อ `registry` ว่างเปล่า
และ `run.export` เช็ค `findActiveRunWithCount` ก่อนเสมอเพื่อไม่ให้หยิบผลของ run เก่ามาให้ถ้ามี run ใหม่
ค้างอยู่จริง (`runImport()` release lease ในทุกเส้นทางจบงานอยู่แล้วผ่าน `try/finally` เงื่อนไขนี้จึงเป็นจริง
เฉพาะตอนมี run ที่ยังไม่จบค้างอยู่จริงเท่านั้น)

### หลักฐาน

- **Unit** — `tests/unit/checkpoints.test.ts` describe "finished report" (save/read/clear, แยกตาม
  sourceRef, เขียนทับไม่สะสม, `clearAll` ลบครบทั้งสามสโตร์) และ `tests/unit/run-messages.test.ts`
  describe "D5" (`run.status`/`run.export` fallback หลัง "service worker ตาย" จำลองด้วย registry
  คนละก้อนแต่ store เดิม, guard `run_active` ไม่หยิบผลเก่าเมื่อมี run ค้างจริง, `run.start` ล้างผลเก่า
  ก่อนเริ่ม) — รวม 10 test ใหม่
- **E2E ระดับ browser จริง** — `tests/e2e/lifecycle.spec.ts` เคส D5: สแกนจนจบสมบูรณ์ในเบราว์เซอร์จริง
  หยุด service worker จริงด้วย CDP (`ServiceWorker.stopAllWorkers` ยืนยันด้วย
  `runningStatus === 'stopped'`) **โดยไม่ reload หน้า** (จำลองสถานการณ์จริงที่ผู้ใช้เจอ) แล้วกด Export
  ต้องได้ไฟล์จริง (`resultKind: full_scan`, `scanCoverage: reached_endpoint_end`)
- **ยืนยัน non-vacuous** — ปิด fallback ใน `run.export` ชั่วคราว (`registry.currentReport` เฉย ๆ ไม่มี
  `?? readFinishedReport(...)`) แล้วรัน E2E ซ้ำ → fail จริงด้วย timeout (ปุ่ม Export เรียก `no_report`
  ซึ่งทำให้ dashboard เปิด `window.alert()` ค้างรอ dialog ที่ test ไม่ได้ handle) ก่อนคืนโค้ดกลับมาเป็น
  แบบที่แก้แล้วแล้วยืนยันว่า PASS
- **ยืนยันบนข้อมูลจริง (2026-09-20, รอบสอง)** — หลัง deploy build ที่แก้แล้ว ผู้ใช้ทดลองซ้ำบนบัญชี
  TikTok จริงด้วย flow เดิมทุกขั้นตอน จงใจปล่อยหน้าจอทิ้งไว้เกิน 1 นาทีก่อนกด Export (นานพอให้ MV3
  service worker ถูก Chrome idle-kill จริง) — Export สำเร็จ ได้ไฟล์ 201 รายการครบ
  (`scanCoverage: reached_endpoint_end`, `adapterVersion: live-v1`) สแกนไฟล์ทั้งก้อนหา
  cookie/authorization/set-cookie/bodyText/bearer/session ไม่พบสักคำเดียว รายละเอียดอยู่ใน
  [api-observations.md](api-observations.md) §10 "ยืนยันการแก้ D5 ด้วยข้อมูลจริงรอบสอง"

สถานะ: `npm test` 439/439 PASS · `npm run typecheck` ไม่มี error · `npx playwright test` 20/20 PASS
(mock build hash `118cbb43cc59…`) · ยืนยันบนข้อมูลจริงแล้วว่า Export ทำงานถูกต้องหลัง service worker
idle-kill จริง ไม่ใช่แค่หลักฐานระดับ test เท่านั้น

## ปลดล็อกรูปสินค้าใน export (2026-09-20 รอบที่เจ็ด)

เตรียมข้อมูลรูปสำหรับโปรเจกต์แยกในอนาคต ("Flow B" — AI Video) ตามที่บันทึกไว้ใน
[api-observations.md](api-observations.md) §11 — ยังอยู่ในขอบเขต Flow A เดิม (§2.2) ไม่ใช่การ
ขยายขอบเขตหรือ automation เพิ่มเติมกับ TikTok

**เปลี่ยน:** `NormalizedProduct.imageUrl: string | null` → `imageUrls: readonly string[]` ดึงจาก
`images[]` (หลายรูป, fallback ไปที่ `cover` ถ้า `images` หายไป) และเปิด `APPROVED_IMAGE_HOSTS`
จากว่างเปล่า → 4 host ที่สังเกตได้จริง (`p16-oec-sg.ibyteimg.com`, `p19-oec-sg.ibyteimg.com`,
`p16-oec-va.ibyteimg.com`, `p19-oec-va.ibyteimg.com`)

**หลักฐาน:** unit test ใหม่ 6 เคส (`tests/unit/product.test.ts` describe "imageUrls — ดึงหลายรูปจาก
images[]") + 1 เคสใน `preview.test.ts` (โชว์รูปแรกเป็น thumbnail ไม่ใช่ทุกรูป) + contract test
ที่แก้ใหม่ยืนยันด้วยข้อมูลจริงทั้ง 15 สินค้าในไฟล์ observed ว่าได้ `imageUrls` ไม่ว่างเปล่าเลยสักชิ้น
และไม่มี host แปลกปลอมหลุดเข้ามา (`tests/contract/observed-showcase-contract.test.ts`)

**ผลกระทบที่ตรวจแล้ว:** `core/pagination.ts` (fingerprint เปรียบเทียบสินค้าเปลี่ยน),
`dashboard/preview.ts` (thumbnail), และ 5 ไฟล์ test เดิมที่ต้องแก้ signature ให้ตรง schema ใหม่ —
ไม่กระทบ endpoint, pagination, retry, หรือ eligibility logic เลย

สถานะ: `npm test` 446/446 PASS (+6 จากรอบก่อน) · `npm run typecheck` ไม่มี error ·
`npx playwright test` 20/20 PASS · `npm run test:coverage` exit 0 ผ่านครบ 7 ไฟล์ที่มีเกณฑ์บังคับ
(product.ts branch 92.3%, ดูตารางที่อัปเดตแล้วใน [g1-signoff.md](g1-signoff.md))

## กลุ่มที่ยังไม่ได้รัน

| กลุ่ม | Test IDs | Status | เหตุผล |
|---|---|---|---|
| Unit & Data | UT01–UT12 | **PASS** | ดูตาราง M1.2/M1.4 ด้านบน (UT09 เต็มรูปแบบผ่านใน M1.4) |
| Pagination & Fault | PG01–PG17 | **PASS** | ดูตาราง M1.3 ด้านบน |
| Lifecycle | LC01–LC07 | **PASS** | ดูตาราง M1.3/M1.4 ด้านบน |
| UI | UI01, UI02, UI03 | **PASS** | ดูตาราง M1.4 ด้านบน (jsdom) + E2E scan-flow ในตาราง M1.5 ด้านบน — มีหลักฐานระดับ browser จริงแล้ว (Chromium ผ่าน Playwright และด้วยมือบน Brave+Chrome, VA09) |
| UI | UI04, UI05 | **PASS** | ดูตาราง M1.4 ด้านบน — ยืนยันที่ระดับ jsdom/module เท่านั้น (`tests/unit/preview.test.ts`) **ยังไม่มีหลักฐานระดับ browser จริง** |
| UI permission | UI06 | NOT RUN | เลื่อนไปพร้อม live adapter — ยังไม่มีโค้ดเช็ค chrome.permissions เลย (ดู spec M1.5 §2.2) |
| Integration | IT02, IT03 | **PASS** | ดูตาราง M1.3 ด้านบน |
| Package security | PK02 | **PASS** | ดูตาราง M1.5 ด้านบน |
| Package security | PK04 | **PASS** | ครึ่ง "ไม่มี request ออกนอกเครื่องตลอด flow" — ดูตาราง M1.5 ด้านบน |
| Package security | PK04 (ครึ่ง "allowlisted read-only") | **NOT APPLICABLE** | ยังไม่มี live adapter จึงยังไม่มี request ใดให้ตรวจ allowlist |
| Package security | PK05 | PASS | ผู้ใช้ถอนติดตั้ง extension จริงบนเบราว์เซอร์ (2026-09-19) — การ์ด extension หายไปจาก `chrome://extensions` ทันทีหลัง Remove |
| Warehouse | DB01–DB08 | NOT APPLICABLE | ยังไม่มี Warehouse ในรุ่นนี้ (M2.1) |
| Bridge | WS01–WS12 | NOT APPLICABLE | ยังไม่มี bridge ในรุ่นนี้ และอาจไม่สร้างเลย (M2.2) |
| Validation | VA01, VA05, VA06 | BLOCKED | ต้องผ่าน G0 ก่อน — ยังไม่มีหลักฐานจากบัญชีจริง |
| Validation | VA10 | NOT APPLICABLE | page-size optimization ยังไม่ได้เปิด — spec §14 ระบุว่าไม่ใช่เงื่อนไขจำเป็นของ M1 baseline และห้ามให้คะแนน PASS โดยยังไม่ทดสอบ |
| Validation | VA02, VA04 | BLOCKED | ต้องมีข้อมูลจาก TikTok จริง (G0) |
| Validation | VA03 | BLOCKED (G0) | ครึ่ง mock มีหลักฐานแล้ว — PG01/PG02 ยืนยัน ID set ตรง 100% บน mock dataset ที่รู้รายการ exact; ครึ่ง live ต้องมี sample จากบัญชีจริงตาม spec §14 จึงยัง BLOCKED |
| Validation | VA07, VA08, VA09 | **PASS** | ดูตาราง M1.5 ด้านบน |

## Release gate G1 — ยังไม่ผ่าน

G1 ต้องการ P0 ของ UT/PG/LC/UI/IT/PK ครบ, VA01–VA09 (spec:721 — ไม่รวม VA10), branch coverage ≥90% ของ parser/pagination
และ manual smoke บน Brave/Chrome

ที่ทำแล้วและผ่านจริงในกรอบเดิม (M1.5): E2E harness 8/8 ผ่าน, PK02 PASS, branch coverage ≥90% ครบทั้ง 7 ไฟล์ที่มีเกณฑ์,
VA07/VA08/VA09 PASS, manual smoke บน Brave+Chrome ผ่านทั้งคู่

เพิ่มเติมจากรอบตรวจสอบและปิดช่องว่างนี้ (ดู § รอบตรวจสอบและปิดช่องว่าง (audit) ด้านบน): PK04 แยกเป็น PASS (ครึ่ง
"ไม่มี request ออกนอกเครื่อง") + NOT APPLICABLE (ครึ่ง "allowlisted read-only" — รอ live adapter), PK05 มี unit test
+ E2E test อัตโนมัติเพิ่มสำหรับ `data.clear`, และมี E2E spec ใหม่เพิ่มอีกหลายไฟล์ (latency, LC03/LC06 ระดับ browser,
positive-control ของ network listener, JSON.parse reviver) — **จำนวน E2E ที่ผ่านจริงรวมทั้งรอบนี้ นับใหม่จริงด้วย
`npm run test:e2e` เมื่อ 2026-09-20: 15/15 ผ่าน ครอบ 6 spec files (`clear-data.spec.ts`, `latency.spec.ts`,
`lifecycle.spec.ts`, `load-unpacked.spec.ts`, `network-isolation.spec.ts`, `scan-flow.spec.ts`) ใน 57.1 วินาที —
เพิ่มขึ้นจาก baseline เดิมของ M1.5 ที่ 8/8 (3 spec files) เพราะมี spec ใหม่เพิ่มจากรอบตรวจสอบและปิดช่องว่างนี้**
— progress/cancel latency (D1) ก็วัดจริงแล้วในรอบนี้เช่นกันและ**ผ่านงบทั้งคู่** (progress lag 244ms ≤1000ms,
cancel latency 233ms ≤2000ms — ดูตัวเลขและจุดวัดเต็มใน § รอบตรวจสอบและปิดช่องว่าง (audit) ด้านบน) จึงไม่ใช่เหตุผลที่
G1 ยังไม่ผ่านอีกต่อไป

ที่เหลือให้ G1 ยังไม่ผ่านคือ VA01/VA02/VA03/VA04/VA05/VA06 ซึ่ง BLOCKED บน G0 — ต้องมีหลักฐานจากบัญชี TikTok จริงตาม
spec §5.1 ก่อน (VA10 **ไม่นับ** เป็นเหตุผลที่ G1 ยังไม่ผ่าน เพราะ spec:721 กำหนดขอบเขต G1 ไว้ที่ VA01–VA09 เท่านั้น —
ดูแถว VA10 ด้านบนที่บันทึกเป็น `NOT APPLICABLE` ตาม spec:644)

**รุ่นนี้เป็น mock-only prototype ไม่ใช่ live-ready** ตามข้อกำหนด spec §5.3 และ G1 ข้อ 1
