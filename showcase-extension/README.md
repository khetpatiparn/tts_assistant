# Flow A — Showcase Importer

MV3 browser extension สำหรับอ่านรายการสินค้าใน Showcase ของบัญชีผู้ใช้เอง → preview → เลือก → export JSON

> ## ⚠️ รุ่นนี้เป็น mock-only prototype ยังไม่ใช่ live-ready
>
> **G0 ยังไม่ผ่าน** ยังไม่มีการเก็บหลักฐานจากบัญชีจริงตาม spec §5.1 ดังนั้น
> - ยังไม่มี adapter ที่ติดต่อบริการภายนอกเลย — release channel โยน `live_adapter_not_implemented`
> - ข้อมูลที่เห็นทั้งหมดมาจาก fixture สังเคราะห์ในเครื่อง
> - **ห้ามอ้างว่าใช้งานกับระบบจริงได้แล้ว** (spec §5.3)

Spec ที่ใช้อ้างอิง: [docs/tiktok_flow_a_extension_plan.md](docs/tiktok_flow_a_extension_plan.md)
สถานะ requirement: [docs/traceability.md](docs/traceability.md) · ผลทดสอบจริง: [docs/test-results.md](docs/test-results.md)

## สถานะปัจจุบัน — M1.5 (G1 sign-off)

มีแล้ว (test ผ่านจริง — ดู [docs/g1-signoff.md](docs/g1-signoff.md)): manifest สิทธิ์ขั้นต่ำ · message schema + validator ·
mock adapter · validator/normalizer (V01–V11) · runner/pagination/retry/checkpoint (PG01–PG17, LC01–LC07) ·
preview/selection/export (UI01–UI05 — UI01–UI03 มีหลักฐานระดับ browser จาก E2E, UI04–UI05 ยังเป็น jsdom/module เท่านั้น) ·
build สองช่องทาง · **E2E อัตโนมัติบน Chromium จริง** — 15/15 ผ่าน ครอบ 6 spec files (`clear-data.spec.ts`,
`latency.spec.ts`, `lifecycle.spec.ts`, `load-unpacked.spec.ts`, `network-isolation.spec.ts`, `scan-flow.spec.ts` —
ดู [docs/test-results.md](docs/test-results.md) § รอบตรวจสอบและปิดช่องว่าง (audit)) ·
branch coverage ≥90% ครบทั้ง 7 ไฟล์ที่มีเกณฑ์ · PK01/PK02/PK03/PK05 PASS · PK04 PASS (ครึ่ง "ไม่มี request ออกนอกเครื่อง")
+ NOT APPLICABLE (ครึ่ง "allowlisted read-only" — รอ live adapter) · VA07/VA08/VA09 PASS (Brave และ Chrome ผ่านทั้งคู่)

ยังไม่มี: G0/live adapter · Warehouse import (M2.1) · optional bridge (M2.2) · UI06 (ยังไม่มีโค้ดเช็ค `chrome.permissions`
เลย เลื่อนไปพร้อม live adapter)

รุ่นนี้เป็น **mock-only prototype G1** ไม่ใช่ live-ready — เหลือ G0 (หลักฐานจากบัญชี TikTok จริง) ก่อนจึงจะรัน
VA01–VA06 ที่ยัง BLOCKED ได้ ดูรายละเอียดทั้งหมดใน [docs/g1-signoff.md](docs/g1-signoff.md)

## ความต้องการของระบบ

Node.js 22 ขึ้นไป · Chromium 124 ขึ้นไป (Brave หรือ Chrome บน Windows) — V03 ใช้ `JSON.parse` source-text reviver

## Build

```bash
npm install
npm run build:mock   # dev channel  → dist/         (mock adapter, ไม่มี network)
npm run build        # live channel → dist-release/ (live adapter, ทดลองอ่านจริงแบบกดเองได้)
```

สองช่องทางเลือก adapter ตอน **compile** ผ่าน esbuild alias ไม่ใช่ runtime flag
โค้ด mock จึงไม่เข้า live bundle เลย และไม่มีสวิตช์ใดที่หน้าเว็บสั่งเปิดได้ (PK03)

`dist/build-info.json` มี `buildHash` สำหรับอ้างอิงในรายงานผลทดสอบ

## ทดลองอ่านจาก Showcase ของตนเอง (live trial)

> **ขอบเขต:** อ่านอย่างเดียว ผู้ใช้เป็นผู้ล็อกอินและกดเองทุกครั้ง ไม่มีการเริ่มเอง ไม่มี polling
> TikTok **ยังไม่ได้อนุญาต**การเข้าถึงอัตโนมัติ (ToS §8/§12 ต้องมี express written permission)
> — ดู [docs/api-observations.md](docs/api-observations.md) §3.1 และ §9

### ติดตั้งและให้สิทธิ์ (ทำครั้งเดียว)

1. `npm run build` → ได้ `dist-release/`
2. เปิด `brave://extensions` (หรือ `chrome://extensions`) → เปิด **Developer mode**
3. **Load unpacked** → เลือกโฟลเดอร์ **`dist-release/`**
   ตอนติดตั้ง **ต้องไม่ขอสิทธิ์เว็บไซต์ใด ๆ** (host permission เป็น optional ขอทีหลังตอนกดปุ่ม)
4. ล็อกอิน TikTok ในเบราว์เซอร์โปรไฟล์เดียวกัน แล้วเปิด Showcase ของตัวเองสักครั้งให้เซสชันสดอยู่
5. เปิดหน้าจัดการของ extension → กด **"อนุญาตให้เข้าถึง shop.tiktok.com"** → ยืนยันใน prompt ของเบราว์เซอร์

### ขั้นที่ 1 — อ่านทีละหน้า (ยืนยันว่าการเลื่อนหน้าทำงานจริง)

6. กด **"อ่านหน้าแรก (offset=0)"** — ยิง `GET .../showcase_product/list?offset=0&count=6` **หนึ่งครั้ง**
7. ถ้าหน้าแรกเต็ม 6 รายการ จะมีปุ่ม **"อ่านหน้าถัดไป (offset=6)"** โผล่ขึ้นมา — กดเพื่อยิงอีก
   **หนึ่งครั้ง** ที่ `offset=6` ปุ่มนี้ไม่เคยยิงเองและไม่เลื่อนต่อเองเกินหนึ่งหน้าต่อหนึ่งคลิก
8. ทั้งสองหน้าควรได้ `สถานะ envelope: ok` และ `offset ที่อ่าน` ตรงกับปุ่มที่กด ถ้าถึงตรงนี้แล้ว
   แปลว่าการเลื่อน offset บนข้อมูลสดใช้ได้จริง — ไปขั้นที่ 2 ได้
9. แต่ละหน้ากด **"Export ผลทดสอบหน้านี้"** เก็บไฟล์ตัวอย่างได้ (ไฟล์ระบุ `resultKind: single_page_probe`)
   ปุ่มนี้ export เฉพาะหน้าที่เพิ่งอ่าน ไม่สะสมข้ามหน้า

### ขั้นที่ 2 — สแกนจนจบแล้ว Export

10. เลื่อนไปหัวข้อ **"สแกน Showcase"** → กด **"เริ่มสแกน"** หนึ่งครั้ง
    runner จะเลื่อน `offset` ทีละ 6 เว้นระยะ 1 วินาทีต่อหน้า จนถึงจุดจบที่ `data.total` บอก
    ระหว่างนี้กด **"ยกเลิก"** ได้ตลอด และปิดหน้าไม่ได้ (ต้องเปิดค้างไว้)
11. เมื่อจบจะเห็นสรุปสถานะ แล้วเลือกสินค้าในแท็บ **candidate / other** → กด **"Export"**
12. **ถ้าหยุดกลางทาง** จะมีแถบเตือนสีแดง **"⚠ ข้อมูลยังไม่ครบ"** พร้อม `เหตุผลที่หยุด` อยู่เหนือ
    รายการ และไฟล์ที่ export จะมี `scanCoverage` ไม่เท่ากับ `reached_endpoint_end` พร้อม
    `stopReason` ติดไปด้วย — ยังกด Export ได้ แต่ทั้งหน้าจอและตัวไฟล์บอกตรง ๆ ว่าไม่ครบ

**ผลที่เป็นไปได้และความหมาย**

| สิ่งที่เห็น | ความหมาย |
|---|---|
| `สถานะ envelope: ok` + รายการสินค้า | อ่านสำเร็จ |
| `auth_required` (401) | เซสชันไม่ถูกส่งไปด้วย/หมดอายุ — อาจเป็นเรื่อง SameSite cookie ไม่ใช่บั๊กเสมอไป |
| `access_denied` (403) | ถูกปฏิเสธสิทธิ์ |
| `rate_limited` (429) | ถูกจำกัดอัตรา — **หยุด ไม่ยิงซ้ำ** |
| `challenge_required` | ได้หน้า HTML (login/CAPTCHA) แทน JSON |
| `ล้มเหลว: adapter_redirect_blocked` | โดน redirect ออกจาก endpoint — ไม่ตามไปโดยไม่ตรวจ |
| `ล้มเหลว: permission_required` | ยังไม่ได้กดอนุญาต host |
| `ล้มเหลว: adapter_timeout` / `adapter_network_error` | เครือข่ายมีปัญหา/ช้าเกิน 20 วินาที |

**ถ้าเกิด error ให้ส่งกลับมาแค่นี้พอ (ไม่ต้องแนบอะไรที่เป็นความลับ):** ข้อความบนหน้าจอทั้งบรรทัด
(`สถานะ envelope` / `ล้มเหลว: <code>`), ค่า `http status`, `ขนาด body`, และ `buildHash` จากกล่อง
"ข้อมูล build" — **ห้ามส่ง** cookie, token, response body ดิบ หรือ screenshot ที่ติดข้อมูลบัญชี

## ติดตั้ง (unpacked)

1. เปิด `brave://extensions` หรือ `chrome://extensions`
2. เปิด **Developer mode**
3. **Load unpacked** → เลือกโฟลเดอร์ `dist/`
4. หน้าติดตั้ง **ต้องไม่ขอสิทธิ์เข้าถึงเว็บไซต์ใด ๆ** — ถ้าขอ แปลว่า manifest ผิด ให้หยุดและตรวจ

เปิดหน้าจัดการได้จาก popup (ปุ่ม "เปิดหน้าจัดการ") หรือจาก Extension options

## ถอนการติดตั้ง / ล้างข้อมูล

- **ล้างข้อมูลโดยไม่ถอนติดตั้ง:** ปุ่ม "ล้างข้อมูลที่เก็บไว้" ในหน้าจัดการ (dashboard) ลบ staged products และ
  checkpoint ทั้งหมดใน IndexedDB (ผ่าน message `data.clear`) ต้องกดยืนยันสองจังหวะก่อนล้างจริง และจะถูกปฏิเสธถ้ามี
  run กำลังทำงานอยู่จริงในหน้านั้น (กันไม่ให้แถวที่ยังวิ่งอยู่ถูก commit กลับเข้ามาใหม่หลังล้าง)
- **ถอนการติดตั้ง:** `brave://extensions` หรือ `chrome://extensions` → Remove — ลบ IndexedDB ของ extension ทั้งหมด
  (object store `runs` และ `products`) **ไม่มีการเขียนอะไรลง `chrome.storage` เลย** แม้จะขอ permission `storage`
  ไว้ (สำหรับ settings ที่ยังไม่ได้ implement) จึงตัดข้ออ้างเดิมที่บอกว่า Remove ลบ `chrome.storage` ด้วย — ไม่มี
  อะไรอยู่ใน `chrome.storage` ให้ลบตั้งแต่แรก
- **จุดยืนเรื่อง retention:** raw response body จาก mock adapter ไม่เคยถูกเก็บลงดิสก์เลย ดังนั้น TTL 7 วันตาม
  spec §8.4 จึงเป็น `NOT APPLICABLE` กับ build นี้ ส่วน normalized staged rows (หลัง validate/normalize แล้ว)
  ไม่มี TTL ตาม design — ถูกจำกัดด้วย cap ต่อ run (20 MiB / 5,000 รายการ) และเส้นทางล้างสองทางข้างต้นแทน
- **ไม่แตะ cookie ของเว็บไซต์ใด ๆ** ทั้งตอนล้างข้อมูลและตอนถอนติดตั้ง — extension ไม่ขอ permission `cookies` และ
  ไม่มีการอ้างถึง `chrome.cookies` ที่ใดในโค้ดหรือ bundle เลย (พิสูจน์ด้วย PK01/PK02 — ดู
  [docs/test-results.md](docs/test-results.md))
- **Rollback:** ลบ `dist/` แล้ว build ใหม่จาก git tag/commit ก่อนหน้า (`git checkout <ref> && npm run build:mock`)

## Test

```bash
npm run typecheck
npm test
```

### E2E (Playwright)

```bash
npx playwright install chromium   # setup ครั้งเดียว — ต้องใช้ network
npm run build:mock                # E2E ทดสอบ dist/ ที่ build แล้ว
npm run test:e2e
```

แยกจาก `npm test` โดยเจตนา เพราะการดาวน์โหลด browser ของ Playwright ขัดกับ
network deny-by-default ของ vitest (R15)

### ข้อควรทราบเรื่อง "no network"

Network deny-by-default (R15) บังคับใช้ที่ **test runtime** เท่านั้น — `npm install` และการดาวน์โหลด
browser สำหรับ E2E ในอนาคตยังใช้ network ตามปกติ IT01 ที่เป็นสีเขียวจึง**ไม่ได้แปลว่า build นี้ airgapped**

guard อยู่ที่ [tests/setup/no-network.ts](tests/setup/no-network.ts) ทำสามอย่าง:
1. แทน `fetch`/`XMLHttpRequest`/`WebSocket`/`EventSource`/`sendBeacon` ด้วย stub ที่ **reassign ไม่ได้**
2. บันทึกทุกความพยายามลง ledger **ก่อน** throw แล้วตรวจใน `afterEach` — โค้ดที่ `catch` แล้วกลืน error ก็ยังทำให้ suite แดง
3. ปฏิเสธ `net.Socket.prototype.connect` เฉพาะ call ที่ระบุ TCP target ที่ไม่ใช่ loopback (ปล่อย IPC ของ test runner ผ่าน)

## ขอบเขตสิทธิ์ (R02)

| สิ่งที่ขอ | เหตุผล |
|---|---|
| `storage` | เก็บ settings ที่ไม่อ่อนไหว |
| `optional_host_permissions: https://shop.tiktok.com/*` | **ยังไม่ได้รับสิทธิ์จนกว่าผู้ใช้จะกดอนุญาตเอง** G0 ยังไม่ผ่าน จึงยังไม่ควรถือสิทธิ์ตั้งแต่ติดตั้ง |

**ไม่ขอและจะไม่ขอ:** `cookies`, `debugger`, `nativeMessaging`, `webRequest`, `scripting`, `activeTab`, `tabs`,
`alarms`, `downloads`, `<all_urls>` · ไม่มี content script · ไม่มี `externally_connectable` · ไม่รองรับ incognito

## ข้อจำกัดที่ทราบ

- **ไม่มี icon** — Chrome จะใช้ไอคอน default; spec §3.2 ข้อ 7 ห้ามคัดลอก asset ของ package อื่น และยังไม่มี asset ของโครงการเอง
- **ทดสอบ load unpacked จริงแล้วทั้ง Brave และ Chrome** (Windows 11, 2026-09-19) — ดู [docs/test-results.md](docs/test-results.md) แถว `load unpacked`/VA09
- CSP ยังเป็นค่า conservative (`script-src 'self'; object-src 'self';`) การรัดเพิ่มต้องทดสอบ reload จริงทีละ directive เพราะ Chrome ปฏิเสธการโหลดทั้งตัวถ้า CSP ไม่ผ่าน
- flow เต็ม (Start → preview → select → export) ผ่าน E2E อัตโนมัติในเบราว์เซอร์จริงแล้ว — ดู [docs/g1-signoff.md](docs/g1-signoff.md)
- **live adapter เปิดให้ทดลอง "อ่านจริงแบบกดเอง" แล้ว ทั้งทีละหน้าและสแกนจนจบ (2026-09-20)**
  gate แยกเป็นค่าที่ตอบคนละคำถาม: หลักฐานเทคนิค (`true`), เจ้าของโปรเจกต์อนุญาตทดลองหนึ่งหน้า
  (`true`), เจ้าของโปรเจกต์อนุญาตทดลองหลายหน้า (`true`), และ **TikTok อนุญาตหรือยัง (`false` —
  ToS ต้องมี express written permission ซึ่งยังไม่ได้ขอ)** `G0_VERIFIED` ซึ่งเป็น gate ของ
  `full_scan` แบบ live-ready จึงยังเป็น `false` และ purpose นั้นยังถูกปฏิเสธอยู่
  ดู [docs/api-observations.md](docs/api-observations.md) §9 — ไม่ใช่ debug bypass แต่เป็นการเปลี่ยน
  ขอบเขตที่บันทึกไว้ชัดเจน · automated test ทุกตัวยังใช้ fake transport และไม่ยิง TikTok เลย
- **ทดลองอ่านหนึ่งหน้าจริงสำเร็จแล้ว (2026-09-20)** — ผู้ใช้กดเอง อ่านหน้าแรกได้ 6/6 รายการ:
  `credentials:'include'` แนบเซสชันได้จริงจาก service worker (ไม่เจอปัญหา SameSite), permission prompt
  ทำงานครบวงจร, mapping/lossless Product ID ถูกต้องบนข้อมูลสด, ไฟล์ export ไม่มี cookie/token รั่วเลย
  · **ยังไม่ได้ทดสอบ:** challenge/redirect/429 และการเลื่อนหน้า (ยิงแค่ `offset=0` ครั้งเดียว)
  ดู [docs/api-observations.md](docs/api-observations.md) §8
- **ทดลองสแกนหลายหน้าจนจบบนข้อมูลสดสำเร็จแล้ว (2026-09-20)** — ผู้ใช้กดเอง สแกนจนจบได้ 198 รายการ
  ไม่ชน rate limit หรือ challenge ระหว่างทาง เลือกสินค้าทั้งหมดได้ปกติ · ระหว่างการทดลองนี้พบบั๊กจริง
  (D5: Export ล้มด้วย `no_report` เมื่อผู้ใช้ใช้เวลาเลือกสินค้านานกว่า MV3 service worker idle timeout
  ก่อนกด Export — ผลของ run ที่จบแล้วเคยอยู่แค่ในหน่วยความจำของ service worker ไม่เคย persist)
  **แก้แล้วและยืนยันซ้ำบนข้อมูลจริงรอบสอง** — จงใจปล่อยหน้าจอทิ้งไว้เกิน 1 นาทีก่อนกด Export
  (ให้ service worker ถูก idle-kill จริง) Export สำเร็จได้ไฟล์ 201 รายการครบ ไม่มี `no_report` อีกเลย
  ดู [docs/api-observations.md](docs/api-observations.md) §10, [docs/g1-signoff.md](docs/g1-signoff.md)
  § ข้อจำกัดที่ทราบ (D5) และ [docs/test-results.md](docs/test-results.md) § รอบแก้ D5 · `count=50`
  และรูปสินค้า (`APPROVED_IMAGE_HOSTS` ยังว่างโดยตั้งใจ) เลื่อนไว้หลังเส้นทางหลักทำงานครบ
- ยังไม่มี Warehouse import หรือ optional bridge (M2)
- `sourceRef` เป็นค่าคงที่ (`local-profile-01`) ยังไม่มี UI ตั้งค่า
- ~~**D2 heartbeat ปิดช่องว่างไม่สนิทสำหรับ retry wait ที่ยาวเกิน 60 วินาที**~~ — **แก้แล้ว (2026-09-20)**
  runner ซอยการรอ retry เป็นช่วง ๆ ยาวช่วงละ `leaseTtlMs / 3` แล้ว heartbeat คั่นระหว่างช่วง
  ความถี่คิดจาก TTL จริงของ store ไม่ hardcode มี test ยืนยันด้วย `Retry-After: 900` (15 นาที ซึ่งเป็น
  ค่าสูงสุดที่นโยบายยอมรับ) ว่า lease ไม่หมดอายุแม้แต่จุดเวลาเดียวตลอดการรอ

## โครงสร้างที่ต่างจาก spec §7.2

| ต่างอย่างไร | เหตุผล |
|---|---|
| เพิ่ม `extension/src/messaging/` | §7.2 รวม message validation ไว้ใน `background.ts` แต่ validator ต้อง unit test ได้โดยไม่ import service worker entry ซึ่งลงทะเบียน listener เป็น side effect |
| เพิ่ม `extension/src/popup/` | §7.2 ไม่ได้ระบุไว้ แต่ §4.1 ต้องการ popup component |
| `extension/src/adapters/resolve.{mock,live}.ts` | กลไก compile-time channel split สำหรับ PK03 |
