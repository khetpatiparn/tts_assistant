# Requirement traceability — R01–R15

อ้างอิง [tiktok_flow_a_extension_plan.md](tiktok_flow_a_extension_plan.md) §6 (requirements) และ §13 (test cases)
ผลรันจริงอยู่ใน [test-results.md](test-results.md) เอกสารนี้บอกเฉพาะว่า requirement ผูกกับโมดูลและ test ใด

## สถานะรวม

| Milestone | สถานะ |
|---|---|
| M0 / G0 | **ยังไม่ผ่าน** — ไม่มีหลักฐานจากบัญชีจริง |
| M1.1 | implement แล้ว รอ manual smoke + review |
| M1.2 | implement แล้ว — UT01–UT08, UT10–UT12 และ V01–V11 ผ่าน |
| M1.3 | implement แล้ว — PG01–PG17, LC01–LC07, IT02, IT03 ผ่าน (หลัง code review แก้ bug จริง 3 จุด) |
| M1.4 | implement แล้ว — UI01–UI05, UT09 เต็มรูปแบบผ่านที่ระดับ module/jsdom; **ยังไม่ได้ smoke test บน browser จริง** |
| M1.5 | ปิด scope ที่ทำได้ในสภาพ mock-only นี้แล้ว — E2E harness, VA07/VA08/VA09/PK05 ผ่านครบ, coverage วัดแล้ว, PK04 แยกครึ่งภายใต้ id เดิม (ดูตาราง traceability ด้านล่าง) **G1 ยังไม่ผ่าน** เพราะ VA01–VA06 ยัง BLOCKED บน G0 (ดู g1-signoff.md) |
| M2.1–M2.2 | ยังไม่เริ่ม |

## ตาราง traceability

| Req | ความหมายย่อ | Module | Test ID | Milestone | สถานะปัจจุบัน |
|---|---|---|---|---|---|
| R01 | อ่านจากแหล่งที่ตรวจแล้ว | [api-observations.md](api-observations.md), `extension/src/adapters/` | VA01 | M1.1 (เอกสาร) → M1.5 | เอกสารพร้อม, VA01 BLOCKED บน G0 |
| **R02** | **สิทธิ์เท่าที่ใช้** | [extension/manifest.json](../extension/manifest.json), [adapters/live-showcase.ts](../extension/src/adapters/live-showcase.ts), [dashboard/main.ts](../extension/src/dashboard/main.ts) | **PK01**, UI06 | M1.1 (PK01) → live adapter (UI06) | PK01 **PASS**; โค้ดเช็ค `chrome.permissions.contains` implement แล้วและมี **หลักฐานระดับ browser จริง** แล้ว (2026-09-20, E2E บน Chrome จริงกับ mock build — `tests/e2e/probe-and-permission.spec.ts`); dashboard มี UI แสดงสถานะสิทธิ์ + ปุ่ม "อนุญาต" ที่เรียก `chrome.permissions.request` จาก user gesture โดยตรงแล้ว (ไม่ผ่าน background, มี static check ยืนยัน) **UI06 PASS แล้ว (2026-09-20)** — เจ้าของโปรเจกต์กดปุ่มขอสิทธิ์ผ่าน native permission prompt จริง แล้วยิง probe ไปยัง endpoint จริงได้สำเร็จ (ดู api-observations.md §8) · ส่วนเส้นทาง "ถอนสิทธิ์แล้ว UI เปลี่ยนเป็น permission_required" ยังไม่ได้ทดสอบ |
| R03 | Start/Cancel หนึ่งงานต่อ profile | [core/runner.ts](../extension/src/core/runner.ts) | LC01, PG15 | M1.3 | **PASS** |
| R04 | Pagination ไม่ข้ามแถว | [core/pagination.ts](../extension/src/core/pagination.ts) | PG01–PG05 | M1.3 | **PASS** — 2026-09-20 เพิ่ม `data.total` เป็นเงื่อนไขจบ (ยืนยันด้วย observed full capture) พร้อม fault handling เมื่อ `total` ขัดแย้งกลางคัน (synthetic, ดู api-observations.md §2.1) |
| R05 | จบงานอย่างตรงไปตรงมา | [core/runner.ts](../extension/src/core/runner.ts) | PG06, PG13, PG14, PG16, UT04 | M1.3 | **PASS** |
| R06 | Validate/normalize ไม่ทำข้อมูลเพี้ยน | [domain/product.ts](../extension/src/domain/product.ts), [json-lossless.ts](../extension/src/domain/json-lossless.ts), [envelope.ts](../extension/src/domain/envelope.ts) | UT01–UT05, UT08 | M1.2 | **PASS** |
| R07 | Deduplicate และแยกสถานะ | [domain/product.ts](../extension/src/domain/product.ts), [core/pagination.ts](../extension/src/core/pagination.ts) | UT06, UT07, UT11, PG17 | M1.2–M1.3 | **PASS** |
| R08 | Preview/เลือก/Export | [dashboard/selection.ts](../extension/src/dashboard/selection.ts), [dashboard/preview.ts](../extension/src/dashboard/preview.ts), [export/json.ts](../extension/src/export/json.ts) | UI01–UI05 | M1.4 | **PASS** — UI01/UI02/UI03 มีหลักฐานระดับ browser จริงจาก E2E scan-flow (M1.5); UI04/UI05 ยืนยันที่ระดับ jsdom/module เท่านั้น ยังไม่มีหลักฐานระดับ browser (ดู test-results.md) |
| R09 | จัดการ failure อย่างปลอดภัย | [core/retry.ts](../extension/src/core/retry.ts), [core/runner.ts](../extension/src/core/runner.ts) | PG08–PG12 | M1.3 | **PASS** (ขอบเขต mock-only เดิม) — 2026-09-20 เพิ่ม fault handling ของ live-adapter-specific errors (`challenge_required`, `redirect_blocked`, `permission_required`, `adapter_invalid_request`/`adapter_body_too_large`, network/timeout ที่ retry ได้) ทดสอบด้วย fake adapter ทั้งหมด ยังไม่มีหลักฐานระดับ browser/TikTok จริง (ดู api-observations.md §6) |
| R10 | ทนต่อ MV3 shutdown | [storage/checkpoints.ts](../extension/src/storage/checkpoints.ts), [dashboard/resume.ts](../extension/src/dashboard/resume.ts) | LC01–LC07 | M1.3–M1.4 | **PASS** (LC03/LC06 มีหลักฐานระดับ browser จริงเพิ่มจากรอบตรวจสอบและปิดช่องว่าง — เดิม M1.3 เป็น unit simulation บน fake-indexeddb เท่านั้น ดู test-results.md § รอบตรวจสอบและปิดช่องว่าง (audit)) |
| R11 | ข้อมูลไม่รั่ว/ไม่สร้างผล | [dashboard/dom.ts](../extension/src/dashboard/dom.ts), [dashboard/preview.ts](../extension/src/dashboard/preview.ts), [domain/page.ts](../extension/src/domain/page.ts), manifest, build | **PK02a**, **UT09**, **UT12**, PK02, PK04, PK05 | M1.1–M1.5 | **PASS** — PK02a, UT09 (เต็มรูปแบบ), UT12, PK02, PK05 (ถอนติดตั้งจริง 2026-09-19 → IndexedDB หาย) ผ่านครบ; **PK04 แยกเป็นสองครึ่งภายใต้ id เดิม** — ครึ่ง "ไม่มี request ออกนอกเครื่อง" `PASS` (ยืนยันด้วย E2E ทุก scheme แบบ deny-by-default + positive control), ครึ่ง "allowlisted read-only" `NOT APPLICABLE` จนกว่าจะมี live adapter (ไม่ใช่การเปลี่ยน requirement) — ทุกส่วนของ R11 ที่ทดสอบได้ในสภาพ mock-only นี้ผ่านหมดแล้ว ส่วนที่เหลือของ PK04 เป็น `NOT APPLICABLE` ไม่ใช่ gap ที่ยังค้างอยู่ (ดู test-results.md § M1.5 Package security) |
| R12 | Import Warehouse แบบ idempotent | M2 | DB01–DB08 | M2.1 | NOT APPLICABLE ในรุ่นนี้ |
| R13 | Optional bridge ยืนยันทั้งสองฝั่ง | M2 | WS01–WS12 | M2.2 | NOT APPLICABLE ในรุ่นนี้ |
| R14 | ผูกข้อมูลกับ source/account ให้ชัด | [core/runner.ts](../extension/src/core/runner.ts), [domain/product.ts](../extension/src/domain/product.ts) | IT02, IT03, DB04 | M1.3 | IT02/IT03 **PASS**; DB04 → M2.1 |
| **R15** | **test ไม่แตะบริการจริง** | [tests/setup/no-network.ts](../tests/setup/no-network.ts), [scripts/build.mjs](../scripts/build.mjs) | **IT01**, **PK03** | M1.1 | IT01 PASS, PK03 PASS |

## Exit gate ของแต่ละ milestone

Requirement ไม่ได้ "ผ่าน" ด้วยตัวเอง — ต้องมี test เป็นหลักฐาน

```
M1.1 — R02 พิสูจน์ด้วย: PK01 (P0)  +  UI06 (P1, เลื่อนไปพร้อม live adapter — ดูหมายเหตุด้านล่าง)
       R15 พิสูจน์ด้วย: IT01 (P0)  +  PK03 (P0)
       manual: load unpacked บน Brave (2026-09-19) ผ่าน — ยังไม่ได้ทดสอบ Chrome
M1.2 — V01–V11 + UT01–UT08/UT10–UT12 ผ่านครบ
M1.3 — PG01–PG17 + LC01–LC07 ผ่านครบ (แก้ bug จริง 3 จุดจาก code review ก่อนนับว่าผ่าน)
M1.4 — UI01–UI05 + UT09 เต็มรูปแบบ ผ่านที่ระดับ module/jsdom — manual smoke test ยังไม่ได้ทำ
M1.5 — E2E harness (Playwright, Chromium) 8/8 ผ่าน: load-unpacked, scan-flow, network-isolation (ยืนยันครึ่ง PK04
       "ไม่มี request ออกนอกเครื่อง")
       PK02 PASS (bundle scan) · coverage threshold gate ผ่านครบ 7 ไฟล์ (branch ≥90%, ดู test-results.md)
       VA07/VA08/VA09/PK05 PASS (หลักฐานผู้ใช้ 2026-09-19, VA09 ทั้ง Brave และ Chrome) — เหลือ VA01–VA06 ที่ BLOCKED บน G0
       (VA10 ไม่อยู่ใน scope ของ G1 ตาม spec:721 — บันทึกเป็น NOT APPLICABLE)
```

### หมายเหตุการตีความ test ID

- **UI06 ยังคง `NOT RUN`** เหตุผลตรงคือ **ยังไม่มีการ implement permission-handling code เลย** — ไม่ใช่เพราะต้องรอ
  response จริงจาก live adapter หรือรอ live adapter ทางเทคนิค การเลื่อนไปทำพร้อม live adapter เป็น**การตัดสินใจเรื่อง
  scope** ไม่ใช่ข้อจำกัดที่บังคับให้ต้องมี live adapter ก่อนจึงจะเขียนโค้ดนี้ได้ ครึ่งที่มีความหมายของ UI06 คือการ
  **ถอน host permission จริง**แล้วดูว่า UI เปลี่ยนเป็น `permission_required` ผ่าน `chrome.permissions.remove()` —
  E2E harness (Playwright) พร้อมใช้ตั้งแต่ M1.5 แล้ว แต่**ยังไม่มีโค้ดเช็ค `chrome.permissions` ในโปรเจกต์เลย**
  (ดู spec M1.5 §2.2) จึงไม่มีพฤติกรรมให้ทดสอบ
  M1.1 เตรียมพื้นไว้แล้วสองอย่าง: `permission_required` อยู่ใน `JobState` vocabulary และ host เป็น `optional_host_permissions`
  ซึ่งทำให้ `permission_required` เป็นสถานะ default ตอนติดตั้งใหม่ ทดสอบได้โดยไม่ต้องไปกดในหน้า settings ของ browser
- **PK02a เป็นชื่อที่โครงการตั้งเอง ไม่ใช่การเปลี่ยนชื่อ PK02** จนถึง M1.4 PK02 เต็มรูปแบบ (Req R11) ยังตรวจไม่ได้
  เพราะยังไม่มีการยิง request จริงในโปรเจกต์ ส่วนที่ตรวจได้ตอนนั้นคือ "ไม่มี eval/remote code loader/HTML sink
  ใน source และ bundle" จึงบันทึกเป็น PK02a แยกไว้ — **ใน M1.5 ขยาย PK02 ให้ครอบคลุม secret pattern,
  `chrome.cookies`, permission.request ใน service worker และ credential export path ด้วย bundle scan
  (`tests/integration/pk02-pk03-build.test.ts`) แล้ว PK02 จึงเป็น `PASS`** (ดู test-results.md § M1.5)
- **PK04 แยกเป็นสองครึ่งภายใต้ id เดิม ไม่ใช่สถานะ `PASS (บางส่วน)`** (สถานะนั้นผิดกฎ §16.1 — เอาออกแล้วในรอบตรวจสอบ
  และปิดช่องว่างนี้) ครึ่ง "ไม่มี request ออกนอกเครื่อง" เป็น `PASS` เพราะมี E2E harness (Playwright) ยืนยันด้วยทุก
  scheme แบบ deny-by-default บวก positive control ที่พิสูจน์ว่า listener จับความพยายามได้จริง — ส่วนครึ่ง
  "allowlisted read-only" เป็น `NOT APPLICABLE` เพราะยังไม่มี live adapter จึงยังไม่มี request ใดให้ตรวจ allowlist
  (ไม่ใช่การเปลี่ยน requirement — PK04 โดยรวมยังไม่ถือว่า PASS เต็มรายการ)
  **PK05 เป็น `PASS`** — ผู้ใช้ถอนติดตั้ง extension จริงแล้ว (2026-09-19) การ์ดหายจาก `chrome://extensions` ทันที
  และตอนนี้ยังมี unit test + E2E test อัตโนมัติพิสูจน์ปุ่มล้างข้อมูล (`data.clear`) เพิ่มด้วย (ดู test-results.md)
  ส่วน `NOT APPLICABLE` สงวนไว้สำหรับกลุ่ม DB/WS ที่ยังไม่มี Warehouse/bridge ในรุ่นนี้ และ VA10 (page-size
  optimization ที่ยังไม่ได้เปิด — spec:644)
