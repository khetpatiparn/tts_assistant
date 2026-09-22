# Flow A — TikTok Showcase Importer

## Implementation Plan, Test Plan & Validation Specification

- เจ้าของงาน: เขต
- วันที่: 19 กันยายน 2026
- เอกสารเวอร์ชัน: 1.0
- สถานะ: แผนเพื่อเริ่มพัฒนา ยังไม่มี implementation หรือผลทดสอบระบบจริง
- เป้าหมาย: Browser Extension สำหรับ Brave/Chrome บน Windows; เชื่อมระบบ Next.js + SQLite เดิมได้ภายหลัง
- ขอบเขต: บัญชี TikTok ของผู้ใช้เองหรือบัญชีที่ได้รับอนุญาตเท่านั้น

> นิยาม Flow A: อ่านข้อมูลสินค้าใน Showcase → รวบรวมหลายหน้า → ตรวจและจัดรูปข้อมูล → Preview/เลือก → Export JSON หรือบันทึก Product Warehouse
>
> ไม่ใช่การเพิ่มสินค้าลง Showcase ไม่ใช่การปักสินค้ากับวิดีโอ และไม่ใช่การโพสต์ TikTok

## 1. อ่านส่วนไหนก่อน

| ต้องการ | ส่วนที่อ่าน |
|---|---|
| เข้าใจว่าจะสร้างอะไร | 2–4: ขอบเขต หลักฐาน และสถาปัตยกรรม |
| เริ่มทำงานพัฒนา | 5–10 และ 12: discovery, permissions, data, pagination, lifecycle, milestones |
| ตรวจว่าข้อมูลถูกต้อง | 8 และ 14: runtime validation และ validation tests |
| ทดสอบระบบ | 13 และ 15–16: test matrix, UAT, release gates |
| เชื่อมระบบเดิมผ่าน localhost | 11: optional bridge และ security gate |

เริ่มจาก M0 แล้วทำ M1 ให้ใช้งานได้ก่อน ไม่ต้องรอสร้าง Desktop App หรือ WebSocket ให้ครบทั้งระบบ

## 2. เป้าหมายและขอบเขต

### 2.1 รุ่นส่งมอบ

| รุ่น | สิ่งที่ได้ | สิ่งที่ยังไม่ต้องมี |
|---|---|---|
| M0 — Evidence & Contract | ตัวอย่าง response ที่ลบข้อมูลอ่อนไหว, data dictionary, pagination contract | ยังไม่ทำ automation หลายหน้า |
| M1 — Standalone Importer | Extension ดึงสินค้า, progress, cancel, preview, เลือก, export JSON | ไม่ต้องมี localhost server หรือ WebSocket |
| M2 — Warehouse Integration | นำ JSON เข้า Next.js/SQLite; optional authenticated bridge สำหรับส่งตรง | ไม่รวม generation/publishing |

M2 มีสองทาง: นำเข้าไฟล์ JSON ด้วยผู้ใช้ก่อน หรือเพิ่ม local bridge เมื่อจำเป็นต้องควบคุม extension จากแอป ทั้งสองทางใช้ schema และ backend validation เดียวกัน

### 2.2 อยู่ในขอบเขต

- ใช้ browser session ที่ผู้ใช้ล็อกอินด้วยตนเอง ไม่รับรหัสผ่าน
- ดึงเฉพาะ Showcase ของบัญชีปัจจุบันผ่าน read-only request ที่ตรวจสอบแล้ว
- แยกข้อมูลดิบที่จำเป็นออกจากการตีความสถานะ เช่น Active/Unknown
- เก็บสถานะรายการที่ใช้ไม่ได้ไว้ให้ตรวจ ไม่ทิ้งรวมเป็นคำว่า “หมดสต๊อก”
- ตัดข้อมูลซ้ำโดย Product ID พร้อมรักษาความแม่นยำของเลข ID
- แสดงผลครบ/บางส่วน/ตรวจยืนยันไม่ได้อย่างตรงไปตรงมา
- รุ่นแรกหนึ่งงานต่อ browser profile และหนึ่งบัญชีต่อ profile

### 2.3 นอกขอบเขต

- ค้นหรือดึงสินค้าทั้ง TikTok Shop Marketplace
- เพิ่ม/ลบสินค้าใน Showcase, ปักตะกร้า, upload, post, like หรือ follow
- Google Flow, Grok, generation batch และ Flow B/C
- export cookie/token, ดึง SSO, ปลอม session, ข้าม CAPTCHA หรือ security challenge
- สแกนพอร์ต local อัตโนมัติเพื่อเชื่อม app ที่ไม่รู้จัก
- multi-account switching ใน profile เดียว, cloud deployment, Web Store publication
- load test หรือการพยายามทำให้ TikTok rate-limit บัญชีจริง

## 3. หลักฐาน ข้อสันนิษฐาน และข้อแก้ความเข้าใจ

### 3.1 สิ่งที่ยืนยันได้จาก package Triple Bot 11.9.8 ที่ผู้ใช้ส่ง

อ้างอิงฟังก์ชัน pullAllProducts และ runPullProducts ใน 11.9.8_0/src/background.js ไม่ใช่เอกสาร API ที่ TikTok รับรอง

| ประเด็น | หลักฐานใน source | สิ่งที่ยังยืนยันไม่ได้ |
|---|---|---|
| Endpoint | GET https://shop.tiktok.com/api/v1/streamer_desktop/showcase_product/list | ใช้ได้กับบัญชี/ภูมิภาค/เวอร์ชันเว็บของเขตปัจจุบันหรือไม่ |
| การส่ง credentials | fetch ใช้ credentials: include | browser policy/สิทธิ์บัญชี/ข้อกำหนด session ปัจจุบัน |
| Pagination | offset/count; เริ่ม count=50 และมี fallback เป็น 6 | ขนาดสูงสุด, silent cap, total/has_more ที่มีจริง |
| Response | อ่าน code, message, data.products | schema ทั้งหมด รวมถึง fields ที่ Triple Bot ไม่ได้ใช้ |
| สถานะสินค้า | source ทดสอบ stock_status=1 และ review_status=1 | ความหมาย enum ทุกค่า และความสามารถปักจริง ณ เวลาโพสต์ |
| ข้อมูลที่ส่งออก | id, title, price, image, stock, shop, canAdd | ไม่มีหลักฐานว่า API มีแค่นี้ |
| ขีดจำกัด | ส่ง array สูงสุด 2,000 รายการ; นับต่อได้ | จำนวนที่ UI แสดงไม่เท่ากับจำนวนทั้งหมดเสมอ |

### 3.2 สิ่งที่ไม่ควรยกมาจาก Triple Bot ตรง ๆ

1. ไม่ใช้ error ทุกชนิดเป็นเหตุลด count: 401/403/429 ไม่ได้แปลว่า page size ใหญ่เกินไป
2. ไม่ตี missing data.products เป็น array ว่าง เพราะอาจเป็น schema เปลี่ยนหรือ error
3. ไม่ถือหน้า duplicate ทั้งหน้าว่า “ครบแล้ว”: อาจเป็น offset ไม่ทำงานหรือข้อมูลเคลื่อนระหว่างดึง
4. ไม่ลดเวลารอ Retry-After ของ server ให้สั้นลง; ถ้าเกินงบเวลาต้องพักหรือหยุด
5. ไม่ถือ stock_status/review_status ว่าเป็นข้อพิสูจน์ว่าปักกับทุกวิดีโอได้
6. ไม่ใช้ Boolean can_added เพียงตัวเดียวเป็นคำตัดสินสิทธิ์ปักสินค้า
7. ไม่คัดลอก source/assets/แบรนด์ ให้เขียนระบบใหม่ตาม requirement และหลักฐานที่ตรวจได้

### 3.3 แก้ข้อสรุปจากบทสนทนาก่อนหน้า

- การให้ browser แนบ cookie ใน fetch กับการใช้ chrome.cookies อ่านค่า cookie เป็นคนละเรื่อง: M1 ไม่ต้องอ่าน cookie จึงไม่ขอ permission cookies โดยไม่มีเหตุผล [เอกสาร Cookies API](https://developer.chrome.com/docs/extensions/reference/api/cookies)
- host_permissions อนุญาตให้ extension context ติดต่อ host ที่ระบุ แต่ไม่ข้าม authentication/authorization ของ TikTok และไม่เท่ากับสิทธิ์เข้าถึงทุกบัญชี [เอกสาร cross-origin requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)
- ล็อกอินแล้วไม่ได้รับประกันว่า fetch ใช้งานได้ทุกเครื่อง: cookie policy, partitioning, browser settings และการตอบจาก TikTok ต้องทดสอบจริง ไม่สั่งปิด security settings ทั้งระบบ [เอกสาร storage and cookies](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies)
- count=50 เป็นการเลือกของ Triple Bot ไม่ใช่ค่ามาตรฐานหรือค่าที่พิสูจน์ว่าเร็ว/ปลอดภัยที่สุด
- การตีความ OpenBot ว่าใช้ endpoint เดียวกันยังเป็นข้อสันนิษฐาน ไม่ใช่หลักฐานที่ใช้ล็อกสถาปัตยกรรม
- JSON เป็นรูปแบบข้อมูล; HTTPS เป็นช่องทางขอสินค้าจาก TikTok; WebSocket เป็นทางเลือกสำหรับคุยกับแอป local ทั้งสามไม่ใช่สิ่งเดียวกัน
- Client ส่ง bearer token ไปให้ server อย่างเดียวไม่ได้พิสูจน์ว่า server ตัวจริง: หากต้องกัน server ปลอม ต้องยืนยันอีกฝ่ายก่อนส่งข้อมูลด้วย

## 4. สถาปัตยกรรมที่เสนอ

### 4.1 M1: Extension แบบ standalone

| Component | หน้าที่ |
|---|---|
| Popup | ปุ่มเปิดหน้าจัดการและสถานะสั้น ๆ ไม่เป็นเจ้าของ long-running job |
| Extension dashboard | Start/Cancel, progress, preview, selection, export; เป็นหน้า extension แยก |
| MV3 service worker | รับคำสั่งเฉพาะ, ตรวจสิทธิ์, เรียก read-only adapter, จัดการ job |
| TikTok adapter | สร้าง URL ที่ allowlist, fetch HTTPS, แปล error, decode response |
| Pagination engine | เลื่อน offset ตาม contract, deduplicate, จัดการ bounds/retry |
| Validator/normalizer | ตรวจข้อมูล runtime, รักษา ID, ตีความสถานะพร้อม provenance |
| IndexedDB | เก็บ staging rows/checkpoints ต่อ runId แบบ transactional |
| chrome.storage | settings ที่ไม่อ่อนไหว เช่น page size ที่ผ่านการตรวจและ schema version |
| JSON exporter | ส่งออกเฉพาะข้อมูลที่เลือกพร้อม metadata ว่าการสแกนครบหรือไม่ |

เส้นทางข้อมูล: ผู้ใช้กด Start → worker ขอสินค้า HTTPS → validate/stage → dashboard preview → ผู้ใช้เลือกและดาวน์โหลด JSON

ไม่ inject content script และไม่ควบคุมหน้า TikTok ใน M1 หากการทดสอบชี้ว่าแนวทางนี้ใช้ไม่ได้ ให้หยุดที่ discovery gate และทบทวนแบบ ไม่เพิ่มสิทธิ์หรือวิธีหลบการตรวจอัตโนมัติ

### 4.2 M2: เชื่อม Warehouse

ตัวเลือกเริ่มต้น: ผู้ใช้ export JSON จาก M1 แล้วนำเข้าใน Next.js เป็นการพิสูจน์ schema และ database ก่อนเพิ่มช่องทาง realtime

ตัวเลือกภายหลัง: extension เชื่อม local bridge ที่จับคู่แล้ว → ส่ง sanitized product chunks → backend staging → ผู้ใช้ยืนยันนำเข้า → transaction ใน SQLite

ใช้ transport interface แยกจาก TikTok adapter เพื่อเปลี่ยนระหว่าง File Export กับ WebSocket โดยไม่แก้กฎ pagination/data validation

## 5. M0 — Discovery ก่อนเขียน connector จริง

### 5.1 เก็บหลักฐานแบบไม่ก่อ side effect

1. ใช้บัญชีที่ตนมีสิทธิ์และ profile ทดสอบ; ปิด extension automation อื่นชั่วคราวเพื่อลดการปะปน
2. เปิด DevTools → Network → Fetch/XHR ก่อนเปิด Add product links
3. เปิด Showcase, เปลี่ยนหนึ่งหน้า และค้นหา Product ID หนึ่งครั้งตามการใช้งานปกติ
4. จด method, hostname, path และเฉพาะ query parameters ที่ไม่อ่อนไหว
5. ดู Response ของหน้าแรก/ถัดไป/สุดท้าย และตัวอย่างสถานะต่าง ๆ ที่มีอยู่จริง
6. เปรียบเทียบ Product ID ใน response กับแถวบนหน้าจอ
7. ตรวจว่ามี total, has_more, next_offset, cursor, error envelope และข้อมูลตัวตนบัญชีที่ไม่เป็น secret หรือไม่
8. สร้าง sanitized fixtures และ data dictionary โดยไม่ส่ง Cookie/Authorization/HAR/cURL ทั้งชุดออกนอกเครื่อง

อ่าน response ผ่าน Network ได้โดยไม่ต้องรันสคริปต์ที่บุคคลอื่นให้ใน Console [Chrome DevTools Network](https://developer.chrome.com/docs/devtools/network/reference)

ไม่จำเป็นต้องรอให้ session จริงหมดอายุหรือจงใจเรียกถี่: กรณี auth error, 429 และ challenge ให้จำลองใน mock

### 5.2 Data dictionary ที่ต้องสร้าง

| JSON path | Type จริง | ตัวอย่างที่ลบข้อมูลอ่อนไหว | Optional/null ได้ไหม | ความหมายและหลักฐาน | กฎระบบเรา |
|---|---|---|---|---|---|
| code | รอตรวจ | รอตรวจ | รอตรวจ | success/error convention | ไม่ถือ HTTP 200 ว่าสำเร็จเสมอ |
| data.products | รอตรวจ | รอตรวจ | รอตรวจ | array ของ Showcase | missing ไม่ใช่ empty |
| product_id | รอตรวจ | เลขจำลอง | รอตรวจ | เทียบกับ Product ID บน UI | canonical string |
| stock_status | รอตรวจ | รอตรวจ | รอตรวจ | แยกค่าที่ observed/unknown | เก็บ raw enum |
| review_status | รอตรวจ | รอตรวจ | รอตรวจ | ห้ามเดาค่าที่ยังไม่รู้ | เก็บ raw enum |
| pagination metadata | รอตรวจ | รอตรวจ | รอตรวจ | วิธีบอกหน้าถัดไป/จบ | กำหนด adapter contract |
| price/currency/commission | รอตรวจ | รอตรวจ | รอตรวจ | มีจริงหรือไม่มี | ไม่สร้างค่าที่ไม่มี |

### 5.3 Gate G0: ผ่านก่อนเริ่ม live importer

- [ ] ยืนยัน endpoint/method จากบัญชีจริง ไม่ใช้ screenshot อย่างเดียวพิสูจน์ request
- [ ] มี sanitized fixture อย่างน้อย success, page-next, endpoint-end; mock แยกจาก observed fixture
- [ ] รู้ page size ที่เว็บใช้อยู่จริง และวิธีเลื่อนตำแหน่งที่ server ยอมรับ
- [ ] รู้ลักษณะ Product ID ก่อนผ่าน JSON parser เพื่อไม่ทำเลขสูญเสีย precision
- [ ] เก็บเฉพาะ fields ที่จำเป็น; ระบุ unknowns ใน data dictionary
- [ ] ตรวจความเหมาะสมในการใช้ internal API และสิทธิ์บัญชีก่อนใช้งานจริง หากไม่อนุญาต ให้หยุดเส้นทางนี้และใช้ช่องทางที่ได้รับอนุญาต

M0 ไม่ผ่านยังทำ UI/unit tests ด้วย mock ได้ แต่ห้ามอ้างว่าใช้งานกับ TikTok จริงได้แล้ว

## 6. Functional requirements และการตรวจรับ

| ID | Requirement | เกณฑ์หลัก |
|---|---|---|
| R01 | อ่านข้อมูลจากแหล่งที่ตรวจแล้ว | เก็บ evidence และ schema version |
| R02 | ขอสิทธิ์เท่าที่ใช้ | ไม่มี cookies, debugger, nativeMessaging หรือ host กว้างเกินงานใน M1 |
| R03 | Start/Cancel หนึ่งงานต่อ profile | ไม่มี start ซ้อน; cancel ไม่ปล่อยหน้าใหม่ตามมา |
| R04 | Pagination ไม่ข้ามแถวด้วย requested count | advance ตาม contract/จำนวนดิบที่ได้รับจริง |
| R05 | จบงานอย่างตรงไปตรงมา | แยก endpoint-end, partial และ unknown |
| R06 | Validate/normalize โดยไม่ทำข้อมูลเพี้ยน | ID ตรงทุกหลัก; missing ไม่กลายเป็น 0 |
| R07 | Deduplicate และแยกสถานะสินค้า | ไม่ทิ้ง Unknown/Unavailable เงียบ ๆ |
| R08 | Preview/เลือก/Export | ได้เฉพาะสินค้าที่เลือกและมี completeness metadata |
| R09 | จัดการ failure อย่างปลอดภัย | bounded retry; ไม่มี bypass เมื่อ 401/403/challenge |
| R10 | ทนต่อ MV3 shutdown | มี checkpoint; ไม่ค้าง Running ตลอดไป |
| R11 | ข้อมูลไม่รั่ว/ไม่สร้างผลบน TikTok | ไม่มี session ในไฟล์/logs; ไม่มี write request |
| R12 | Import Warehouse แบบ idempotent | retry ไม่เพิ่มแถวซ้ำ; transaction/rollback |
| R13 | Optional bridge ยืนยันทั้งสองฝั่ง | server ปลอม/command ก่อน auth ถูกปฏิเสธ |
| R14 | ผูกข้อมูลกับ source/account ให้ชัด | ไม่มีการ merge ข้ามบัญชีโดยเดา |
| R15 | ทดสอบอัตโนมัติไม่แตะ TikTok จริง | mock-only CI และ network deny-by-default |

## 7. Permission และโครงสร้างโครงการ

### 7.1 Permissions ที่ตั้งใจใช้

| Permission/host | M1 | เหตุผล/ข้อจำกัด |
|---|---|---|
| storage | ใช้ | เก็บ settings; IndexedDB ใช้ staging |
| https://shop.tiktok.com/* | candidate ที่ต้องยืนยันใน M0 | ติดต่อ API host เดียว; ตรวจ path/method ซ้ำใน code |
| cookies | ไม่ใช้ | ไม่อ่าน/แก้/export cookie |
| scripting, activeTab, tabs | ไม่ขอเพียงเพื่อดึง JSON | ไม่อ่าน DOM/ประวัติแท็บ; พิจารณาใหม่ถ้า scope เปลี่ยน |
| webRequest, debugger | ไม่ใช้ | ไม่ดัก session/header หรือ sniff packet |
| nativeMessaging | ไม่ใช้ | ไม่มี executable/launcher ใน MVP |
| alarms | ยังไม่ใช้ | ไม่มี background auto-sync; resume โดยผู้ใช้ |
| downloads | ยังไม่ใช้ | ทดลอง user-triggered Blob download ใน extension page; ทดสอบ Brave/Chrome จริง |
| localhost | เฉพาะ M2 bridge | ขอแบบ optional; URL/port allowlist ใน code เพราะ host permission ไม่ได้แทนการตรวจ port |
| Incognito/Tor | ไม่รองรับ | ไม่ขอผู้ใช้เปิด extension ใน private profile |

host permission ควบคุมระดับ host ไม่ใช่ route allowlist: worker ต้อง hardcode method/path ที่อนุญาตและไม่รับ arbitrary URL จาก message [Chrome network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)

### 7.2 โครงสร้างไฟล์ที่วางแผน

| Path | หน้าที่ |
|---|---|
| extension/manifest.json | MV3, CSP และสิทธิ์ขั้นต่ำ |
| extension/src/background.ts | message validation และ job dispatch |
| extension/src/dashboard/ | dashboard/preview/export UI |
| extension/src/core/runner.ts | state machine, cancellation, retry |
| extension/src/adapters/tiktok-showcase.ts | verified API contract |
| extension/src/domain/product.ts | normalized types และ runtime validators |
| extension/src/storage/checkpoints.ts | IndexedDB transaction, run lease/fencing |
| extension/src/export/json.ts | export schema และ sanitization |
| extension/src/bridge/ | M2 pairing/transport เท่านั้น |
| tests/fixtures/ | synthetic และ sanitized observed fixtures แยก folder |
| tests/unit/, tests/integration/, tests/e2e/ | automated suites |
| docs/api-observations.md | data dictionary, evidence, unknowns |
| docs/test-results.md | ผลที่รันจริง ไม่ pre-fill เป็น Pass |

เสนอ TypeScript และ UI ขนาดเล็ก ไม่บังคับ React; backend ใช้ Next.js/SQLite ที่มีอยู่โดยเพิ่ม feature แยก หลังดูโครงสร้าง repo จริงก่อนแก้ไข

## 8. Data model และ runtime validation

### 8.1 Normalized product

ตัวอย่างนี้เป็น schema ของระบบเราและข้อมูลจำลอง ไม่ใช่ raw response จริงของ TikTok

```json
{
  "schemaVersion": 1,
  "sourceRef": "local-profile-01",
  "sourceIdentityVerified": false,
  "productId": "1736749159048840633",
  "title": "สินค้าทดสอบ A",
  "priceDisplay": "฿153.71",
  "priceAmountDecimal": null,
  "currency": null,
  "stockQuantity": 100,
  "stockStatusRaw": 1,
  "reviewStatusRaw": 1,
  "canAddRaw": null,
  "eligibility": "candidate",
  "eligibilityBasis": "adapter-rule-v1",
  "imageUrl": null,
  "shopName": null,
  "observedAt": "2026-09-19T10:00:00Z",
  "validationWarnings": []
}
```

candidate หมายถึงผ่านกฎคัดเลือกของ importer ไม่ใช่การรับประกันว่าสามารถปักกับวิดีโอได้จริง ค่า amount/currency ในตัวอย่างยัง null เพราะไม่ควรสร้างข้อเท็จจริงทางราคาเพียงจาก formatted text

### 8.2 Validation rules

| Rule | การตรวจ | เมื่อไม่ผ่าน |
|---|---|---|
| V01 — Envelope | JSON object, success code ตาม observed contract, products เป็น array | หยุด schema/auth/API error; ห้ามรายงานสินค้าหมด |
| V02 — Product ID | non-empty decimal string; prototype จำกัด 1–128 ตัวอักษร | quarantine แถว; ห้ามเดา ID |
| V03 — Precision | ถ้า upstream ส่งเลข JSON ไม่ใส่ quotes ต้อง lossless-parse ก่อนแปลง | ถ้า parse เป็น unsafe Number แล้วให้ reject; String(number) แก้ไม่ได้ |
| V04 — Title | string ไม่ว่าง หลัง trim; prototype สูงสุด 2,000 ตัวอักษร | quarantine; แสดง rejected count |
| V05 — Stock | non-negative safe integer หรือ null; 0 ต่างจากไม่ทราบ | invalid optional field → null + warning ไม่ตัดสินค้าเอง |
| V06 — Status | เก็บ enum ดิบ; map เฉพาะค่าที่ M0 ยืนยัน | ค่าใหม่/missing → unknown ไม่บังคับ active/inactive |
| V07 — Price | เก็บ display; decimal amount/currency เฉพาะที่มีหลักฐานและ parser รองรับ | ช่วงราคา/รูปแบบกำกวม → amount null + warning |
| V08 — URLs | approved HTTPS image CDN เท่านั้น; ปฏิเสธ javascript/file/data และ URL มี account secret | ตั้ง null + warning; backend ไม่ fetch URL ตามอำเภอใจ |
| V09 — Optional fields | missing commission/shop/image ไม่เติม 0 หรือข้อความเดา | null; UI แสดง “ไม่ทราบ” |
| V10 — Unexpected data | fields ใหม่เข้า schema inventory แต่ไม่ส่งออกทั้งหมดอัตโนมัติ | review schema; export ใช้ allowlist |
| V11 — UI rendering | แสดง title/shop เป็น text ไม่ innerHTML | XSS payload กลายเป็นข้อความ ไม่รัน |
| V12 — Source binding | run ผูก sourceRef ตั้งแต่เริ่ม; verified identity หาก API มี | mismatch → หยุดและเก็บแยก ห้าม merge |
| V13 — Product limit | 5,000 unique valid products ต่อ run ใน prototype | stopped_by_limit/partial ไม่มี silent truncate |
| V14 — Byte limit | raw page ไม่เกิน 2 MiB; staging ไม่เกิน 20 MiB/run | ยกเลิกอ่านและรายงาน limit; UI ไม่ crash |

ค่าความยาว/ขนาดเป็นข้อกำหนดทดลองของเรา ไม่ใช่ข้อจำกัด TikTok ต้องปรับด้วย fixtures โดยยังรักษา hard bound

### 8.3 สถานะและการไม่ทิ้งข้อมูล

- eligibility = candidate / unavailable / out_of_stock / unknown ตาม rule version และหลักฐาน
- ค่า enum ที่ยังไม่ยืนยันทั้งหมดคงเป็น unknown แม้ Triple Bot comment จะให้คำอธิบายไว้
- canAddRaw=false เป็นข้อมูลขัดกับการเสนอว่าใช้งานได้: ให้เป็น unknown พร้อม warning จนยืนยันความหมายใน M0; ไม่อยู่ใน Select all ของ Candidate และไม่ใช้ can_added=true ลบล้างสถานะอื่น
- Preview แยกแถบ Candidate, Other status, Rejected; default ไม่เลือกอะไร
- “เลือกทั้งหมด” ต้องระบุว่าหมายถึงทุกแถวที่ผ่าน filter ไม่ใช่ทุก record ใน API
- ผู้ใช้ยัง export valid non-candidate เพื่อเก็บ warehouse ได้เมื่อยืนยัน แต่มีสถานะกำกับและไม่เปิด publish อัตโนมัติ

### 8.4 Raw data และ privacy

Production: ไม่เก็บ raw body ทั้งหมดถาวร เก็บ normalized fields, raw enums, warnings และ source provenance ที่จำเป็น

Discovery/debug: เก็บ raw sample เฉพาะเมื่อผู้ใช้เลือกเอง ตรวจลบ secrets/PII/URL tokens ก่อนแชร์, อยู่ local, retention ที่เสนอ 7 วันหรือกดลบเอง ไม่มี upload telemetry

ชื่อ field ไม่ใช่หลักฐานว่าไม่มี secret: ตรวจ nested values, URL query และ signed URLs ด้วย ก่อนทำ fixture/export

### 8.5 Warehouse schema สำหรับ M2

| Table | Key สำคัญ | ความหมาย |
|---|---|---|
| product_sources | source_ref | แหล่งข้อมูลจาก browser profile; account ID nullable, verified flag |
| import_runs | run_id | coverage, quality, timestamps, schema/adapter version |
| import_items | run_id + product_id | staging ที่ผ่าน validation ก่อนยืนยัน |
| warehouse_products | source_ref + product_id | สินค้าล่าสุดของ source นั้น |
| product_sets | set_id | ชุดสินค้าที่ผู้ใช้ตั้งชื่อ |
| product_set_items | set_id + source_ref + product_id | ความสัมพันธ์หลายชุดต่อสินค้า |
| import_receipts | idempotency_key | ป้องกัน commit/retry ซ้ำ |

ห้ามใช้ sourceRef ที่ผู้ใช้ตั้งชื่อเป็นหลักฐานยืนยันบัญชี: MVP บังคับหนึ่งบัญชีต่อ browser profile และแสดงคำเตือนว่า identity ยังไม่ verified ถ้า response ไม่มีข้อมูลยืนยัน ไม่อ้างว่าตรวจการสลับบัญชีเงียบ ๆ ได้

Partial scan หรือการเลือก import เพียงบางสินค้า ห้ามลบ/mark missing สินค้าอื่นใน Warehouse รุ่นนี้ทำ upsert เท่านั้น ไม่มี auto-delete แม้สแกนถึงปลายทาง

## 9. Pagination, retry และความครบถ้วน

### 9.1 นโยบาย page size

- ค่าเริ่มต้นใช้จำนวนที่พบจาก request ของหน้าเว็บใน M0; 6 เป็นเพียง candidate จาก Triple Bot
- ไม่ทดลอง count=50 ทุก sync; เพิ่ม optimization ภายหลังเฉพาะเมื่อมีหลักฐานว่า server รองรับ
- หาก server จำกัดส่งกลับน้อยกว่าที่ขอ ให้ใช้จำนวนที่ได้รับตาม pagination contract
- การลด count อัตโนมัติอนุญาตเฉพาะ error ที่ยืนยันว่าเป็น invalid page size และลดได้ครั้งเดียว
- auth failure, forbidden, CAPTCHA/challenge และ rate limit ห้ามเปลี่ยน count เพื่อพยายามผ่าน

### 9.2 ลำดับการดึง

1. สร้าง runId, lock profile และ sourceRef; ยืนยันสิทธิ์กับผู้ใช้
2. เริ่ม offset=0 ด้วย page size ที่ตรวจแล้ว; หนึ่ง request ที่กำลังทำต่อ profile
3. fetch เฉพาะ GET ของ endpoint ที่ allowlist, credentials: include, cache: no-store; ไม่แก้ Cookie header เอง
4. ถ้า redirect ออกจาก contract ให้หยุดเพื่อยืนยัน login/endpoint ไม่ตาม redirect โดยไม่ตรวจ
5. ตรวจ HTTP status, content type, bounded body, success envelope แล้วจึง parse products
6. ตรวจว่า array ว่างจริงหรือ schema หาย; array ว่างจะนับเป็น endpoint-end ได้เมื่อ envelope ถูกต้องเท่านั้น
7. Validate/normalize ทุกแถว, quarantine แถวเสีย, deduplicate valid Product ID; ถ้า ID เดิมมีค่าต่างกัน ใช้ข้อมูล valid ที่พบล่าสุด บันทึก changedWithinRun=true และ quality warning โดยไม่เพิ่ม unique count; แถวใหม่ที่ invalid ไม่ทับค่าดีเดิม
8. Commit หน้าและ checkpoint ใน IndexedDB transaction เดียว จากนั้นค่อยรายงาน progress
9. Advance ตาม next_offset/cursor หากมีและ M0 ยืนยัน; ถ้า contract เป็น offset ของแถว ใช้ offset += rawList.length ไม่ใช่จำนวน unique/active/valid
10. รอระยะที่กำหนดแล้วขอหน้าต่อไป; ตรวจ cancel/bounds ก่อนทุก request

ถ้า offset contract ยังไม่ยืนยัน การใช้ list.length ก็ยังเป็นข้อสันนิษฐาน ไม่ใช่กฎที่ใช้ได้กับทุก API

### 9.3 กรณีหยุด

| เหตุการณ์ | ผลของ run |
|---|---|
| valid empty page หรือ has_more=false ตาม contract | reached_endpoint_end |
| page ซ้ำจนไม่มี ID ใหม่ แต่ metadata ยังบอกมีต่อ/ไม่ชัด | partial + pagination_stalled ไม่ใช่ completed |
| schema เปลี่ยน/metadata ขัดแย้ง | partial ถ้ามีข้อมูลก่อนหน้า ไม่เช่นนั้น failed |
| 401/403 หรือ challenge | stop: auth_required / access_denied / challenge_required ตามหลักฐาน |
| พลาดชั่วคราวจน retry หมด | partial/failed ตามจำนวนข้อมูลที่มี |
| เวลา/จำนวนหน้า/จำนวนสินค้า/พื้นที่ถึง limit | partial พร้อม reason ที่ตรงจริง |
| ผู้ใช้ Cancel | cancelled; export ที่มีได้โดยเตือนว่า partial |

Request รอบสุดท้ายที่ได้ [] ยังนับเป็นหนึ่ง request เช่น mock สินค้า 198 รายการ count=50 จะมี 4 หน้าที่มีสินค้า และอีก 1 empty request ถ้าไม่มี metadata บอกจบ ห้ามรายงานว่าใช้ 4 requests เสมอ

### 9.4 นโยบาย retry และ bounds ที่เสนอ

| ค่า | เริ่มต้น prototype | หมายเหตุ |
|---|---|---|
| Concurrent TikTok requests | 1/profile | ไม่เปิด parallel pagination ใน M1 |
| ระยะห่างหน้า | 1,000 ms หลังจบหน้าก่อน | ไม่ใช่คำรับรอง rate limit ปลอดภัยจาก TikTok |
| Request timeout | 20 วินาที รวมอ่าน body | AbortController; bounded reader |
| Network/5xx retries | สูงสุด 2 ครั้งต่อ offset | backoff 2s, 4s + jitter; ไม่เปลี่ยน offset |
| 429 | พักตาม Retry-After ถ้ารองรับ retry | ไม่ทำ retry อัตโนมัติถ้าไม่มีงบเวลา; ไม่หมุน IP/account |
| ไม่มี Retry-After | backoff ที่เสนอ 30s, 60s สูงสุด 2 ครั้ง | test ด้วย fake clock; manual Resume หลังหมด budget |
| Budget ต่อ run | 10 นาที, สูงสุด 600 requests รวม retry | ถึง limit ให้ partial |
| Hard size limit | 5,000 products / 20 MiB staging | ต้องมี cap ที่ตรวจได้จริง |

Retry-After มีได้ทั้งวินาทีและ HTTP-date หาก server ขอรอ 120 วินาที ต้องไม่ตัดเป็น 10 วินาทีแล้ว retry; พักให้ครบหรือหยุดและบอกเวลาที่เริ่มใหม่ได้ [MDN Retry-After](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Retry-After)

### 9.5 ความหมายของ “ครบ”

ใช้ metadata แยกสามมิติ:

- scanCoverage: reached_endpoint_end / partial / unknown
- dataQuality: clean / warnings / rejected_rows
- snapshotConsistency: unverified เป็น default เพราะ offset API อาจไม่มี atomic snapshot

การ deduplicate แก้แถวซ้ำ แต่ไม่รับประกันว่าไม่มีรายการตกหล่นเมื่อมีการเพิ่ม/ลบสินค้าระหว่างดึง UI ใช้คำว่า “สแกนถึงปลายทางที่ API แจ้งในรอบนี้” ไม่ใช่ “ตรงฐานข้อมูล TikTok 100%”

ตัวนับควรแยก: requests, successfulPages, receivedRows, invalidRows, duplicateValidRows, uniqueValidProducts, candidates, otherStatus, unknownStatus, selectedProducts, exportedProducts

สำหรับแถวที่ประมวลผลแล้ว: receivedRows = invalidRows + duplicateValidRows + uniqueValidProducts และ uniqueValidProducts = candidates + otherStatus + unknownStatus

## 10. Job lifecycle และประสบการณ์ผู้ใช้

สถานะหลัก: idle → validating → fetching → ready_complete/ready_partial → exported หรือ committed

สถานะที่แทรกได้: waiting_retry, auth_required, permission_required, interrupted, cancelled, failed

- ปิด popup ไม่ใช่ cancel เพราะงานอยู่ worker ไม่ใช่ popup
- ปิด dashboard: ทำต่อได้ตราบ worker ยังทำงาน; หาก worker ถูกหยุด เก็บ partial และให้ผู้ใช้ตัดสินใจเริ่มใหม่ ไม่รับประกันทำต่อหลังปิด browser
- MV3 worker สามารถถูกหยุดได้ ต้อง persist ข้อมูลหลังแต่ละหน้าและไม่ใช้ global variables เป็นแหล่งความจริงเพียงอย่างเดียว [Service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- checkpoint มี runId, sourceRef, adapterVersion, lastCommittedPage, nextOffset, timestamps, attempt counters และ lease generation
- commit ทุกหน้าต้องตรวจ generation เพื่อไม่ให้ response เก่าหลัง cancel/restart เขียนทับ run ใหม่
- หนึ่งงานยาวไม่ควรเป็น event handler ที่ไม่คืนค่าตลอดสิบนาที: แบ่งเป็น bounded step ต่อหน้า, persist ก่อนส่งงานถัดไป และทดสอบว่าระหว่างรอ retry worker ถูกหยุดแล้ว UI กู้สถานะ interrupted ได้
- เมื่อ UI เปิดใหม่ ให้ตรวจ lease/heartbeat ที่หมดอายุแล้วเปลี่ยน Running เป็น Interrupted ไม่ปล่อย spinner ตลอดไป
- หลัง browser restart หรือ pause นาน ค่า offset อาจไม่สะท้อนชุดเดิม: ค่า default เริ่ม scan ใหม่จาก 0 เป็น run ใหม่ ส่วนผลเก่าเก็บเป็น partial; resume offset เดิมต้องมี contract รองรับ snapshot จึงค่อยเพิ่ม
- Cancel ใช้ AbortController และยกเลิก timer retry; response ที่มาถึงช้าถูกละทิ้ง
- UI แสดงชื่อ source/profile ที่ผู้ใช้กำหนดและเตือนห้ามเปลี่ยนบัญชีระหว่าง scan
- JSON export มี runId, exportedAt, adapterVersion, sourceRef, coverage, quality, selected IDs และ normalized products ไม่มี headers/token

## 11. Optional local bridge สำหรับ M2

### 11.1 ทำเมื่อมีเหตุผลใช้งานจริง

เพิ่ม bridge เมื่อจำเป็นต้อง Start/Cancel จากหน้า Next.js หรือส่ง progress/ข้อมูลโดยไม่เลือกไฟล์ทุกครั้ง ไม่จำเป็นสำหรับการพิสูจน์ว่า API ดึงสินค้าได้

เสนอแยก local bridge process จาก Next.js routes เพื่อไม่สมมติว่า deployment ทุกแบบรองรับ WebSocket upgrade แล้ว reuse schema/import service เดียวกัน

ค่าตัวอย่างสำหรับพัฒนา: 127.0.0.1:43187 เป็น port ที่เสนอ ไม่ใช่ค่าจริงของ Triple Bot หาก port ไม่ว่างให้แจ้งผู้ใช้ ไม่ไล่เชื่อม service ใดก็ตามที่ตอบ health check

### 11.2 Trust model และ pairing

ภัยที่ออกแบบป้องกัน: เว็บอื่นเชื่อม localhost, local process ไม่มี secret ปลอม bridge, replay message, command ที่อยู่นอก scope และข้อมูลไม่ตรง run/source

ไม่ได้รับประกันป้องกัน malware ระดับ OS หรือ process ที่อ่านไฟล์/หน่วยความจำบัญชีผู้ใช้ได้; extension storage ไม่ใช่ hardware secret vault

ข้อกำหนดก่อนเปิด bridge:

1. ผู้ใช้เริ่ม Pair จาก local app/CLI ที่ตนเปิดเอง แสดง key สุ่ม cryptographically secure 32 bytes เพื่อ paste ใน Extension Options; ไม่ได้จาก health response ของ port ที่พบเอง
2. ไม่ใช้รหัส 6 หลักแลก long-term secret ผ่านช่องทางที่ยังไม่ authenticate หากไม่มี pairing protocol ที่ผ่านการตรวจและ rate limit
3. การเชื่อมใหม่ต้องพิสูจน์ทั้ง bridge และ extension ว่าถือ key เดียวกัน โดยไม่ส่ง key ตรง ๆ ไปยัง peer ที่ยังไม่ตรวจสอบ
4. Design candidate: challenge-response ด้วย primitives มาตรฐานและ role-separated transcript (protocol version, both nonces, instance IDs, expiry); server proof ต้องถูกตรวจ ก่อน product data/คำสั่งใด ๆ
5. ใช้ implementation/protocol ที่ผ่าน security review และ test vectors ไม่เขียน cryptographic algorithm เอง; ยังเป็น gate ค้างจนเลือกแบบที่ตรวจได้
6. ใช้ session binding, sequence และ message integrity สำหรับ commands/results เพื่อกัน replay/tamper; handshake เพียงครั้งเดียวไม่พอหากข้อมูลต่อมาไม่ถูกผูกกับ session
7. Unpair/rotate ยกเลิก session เก่าและ key เก่า; ไม่เก็บ key ใน source, query string, logs หรือ chrome.storage.sync
8. จำกัด Origin แบบ exact allowlist ตาม Extension ID ที่จับคู่และ Host/port ที่ตั้งไว้; Origin ปลอมจาก non-browser client ได้ จึงไม่ใช้แทน authentication
9. เปิด listener เฉพาะ loopback; ไม่ใช้ 0.0.0.0 และไม่เปิดออกอินเทอร์เน็ต

ค่า prototype เพิ่มเติม: auth timeout 5 วินาที, จำกัด connection ที่ยังไม่ auth และความถี่ handshake; bridge key เก็บฝั่ง local ใน OS credential store หรือไฟล์ที่จำกัดสิทธิ์บัญชีผู้ใช้ ส่วน extension ไม่ใช้ sync storage และต้องยอมรับข้อจำกัดการป้องกันจาก malware ในบัญชี OS เดียวกัน

หลักการตรวจ Origin, authorization รายคำสั่ง, payload size และการไม่ log tokens อิง [OWASP WebSocket Security](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html) ส่วน mutual-auth design ข้างต้นเป็น requirement ของโครงการ ต้องตรวจทานเพิ่ม ไม่อ้างว่า OWASP รับรองแบบที่เราวาง

ws:// loopback ไม่มี confidentiality จาก transport; authentication/MAC ไม่ใช่ encryption หาก threat model ต้องป้องกันการอ่านข้อมูลระหว่างทาง ให้ใช้ wss:// ที่ validate server certificate หรือพิจารณา Native Messaging เป็น design แยก ห้ามปิด TLS verification เพื่อให้ผ่าน

ถ้า security gate ยังไม่ผ่าน ให้ใช้ File Import ต่อได้ ไม่ลดมาตรการเพื่อเปิด bridge ให้สำเร็จ

### 11.3 Message contract หลัง auth เท่านั้น

```json
{
  "protocolVersion": 1,
  "messageId": "uuid",
  "runId": "uuid",
  "type": "products.chunk",
  "sourceRef": "local-profile-01",
  "sequence": 3,
  "payload": {
    "chunkIndex": 0,
    "products": []
  }
}
```

นี่คือ application envelope เท่านั้น ไม่ใช่รูปแบบ cryptographic frame; ต้องห่อใน authenticated session ตาม protocol ที่เลือก

อนุญาตเฉพาะ: import.start, import.cancel, import.status, products.chunk, chunk.ack, import.finish, import.error; กำหนดสิทธิ์ direction ให้แต่ละ type เช่น server ห้ามปลอม products.chunk เป็น client

- กำหนด payload cap 256 KiB/message, chunk ไม่เกิน 100 products และไม่เกิน byte cap; row ใหญ่เกิน chunk แสดง validation error
- deduplicate chunk ด้วย runId + chunkIndex และ digest; key เดิมแต่เนื้อหาต่างต้อง reject
- ข้อมูลเข้าฝั่ง server เป็น staging เท่านั้น; finish marker ไม่ใช่ auto-commit
- ผู้ใช้ยืนยันเลือกสินค้าที่ Next.js ก่อน commit แบบ atomic; response หายหลัง commit ให้ retry ด้วย idempotency key เดิมได้
- reconnect ให้ handshake ใหม่ก่อน แล้ว reconcile ACK ไม่เริ่มดึง TikTok ซ้ำอัตโนมัติ
- ใช้ endpoint/action allowlist ไม่รับ arbitrary fetch URL, eval หรือ action ปัก/โพสต์
- server ผูก extension instance กับ sourceRef ที่อนุญาตตอนจับคู่; sourceRef ใน message ต้องตรง binding ไม่เชื่อค่า client อย่างเดียว

## 12. แผนพัฒนาและลำดับงาน

ประมาณการสำหรับ developer 1 คน เป็น focused working days ไม่ใช่วันรับประกัน; G0/API access อาจเป็น blocker ที่ประเมินล่วงหน้าไม่ได้

| Milestone | งาน | Deliverables | Dependency | Exit gate | ประมาณ |
|---|---|---|---|---|---|
| M0 | เก็บ evidence, privacy review, contract | observations, sanitized fixtures, dictionary | บัญชีทดสอบที่ได้รับอนุญาต | G0 | 1–2 วันเมื่อเข้าถึงได้ |
| M1.1 | scaffold MV3 + dashboard + message schema | build โหลด unpacked ได้, no-network mock mode | M0 หรือใช้ synthetic fixtures ชั่วคราว | R02/R15 ผ่าน | 1 วัน |
| M1.2 | parser/validator/normalizer | typed domain, error taxonomy, unit tests | schema baseline | V01–V14 + UT ผ่าน | 1–2 วัน |
| M1.3 | runner/pagination/checkpoints/cancel | bounded job engine และ fault injection | M1.2 | PG/LC tests ผ่าน | 2–3 วัน |
| M1.4 | preview/selection/export | ใช้งาน Flow A standalone ครบ | M1.3 | UI/data tests ผ่าน | 1–2 วัน |
| M1.5 | manual smoke Brave/Chrome + UAT | signed-off test report, known limits | G0 + M1.4 | G1 | 1–2 วัน |
| M2.1 | JSON import + SQLite staging/transaction | Warehouse integration ไม่ต้องมี WS | G1 + ตรวจ repo เดิม | DB tests ผ่าน | 1–2 วัน |
| M2.2 | optional bridge/pairing/reconnect | reviewed protocol + security tests | M2.1 + bridge auth decision | G2 | 3–5 วันขึ้นกับ security review |

ก่อนแก้ repo เดิมให้ตรวจ schema/migrations/API conventions และสำรองฐานข้อมูลทดสอบ ไม่ใช้ข้อมูล production ใน migration test

### Task checklist

- [ ] ปิด unknowns ที่จำเป็นใน M0
- [ ] Lock schemaVersion/adapterVersion และสร้าง synthetic fixtures
- [ ] เขียน validator และ pagination tests ก่อน real adapter
- [ ] Implement mock adapter ที่จำลอง page cap, error, duplicate และ schema drift ได้
- [ ] ทำ runner แบบ cancel/checkpoint ได้ก่อนเพิ่ม UI เต็ม
- [ ] ทำ preview/selection/export และ privacy tests
- [ ] ทดสอบ manual request 1 หน้าใน profile ทดสอบ จากนั้นค่อย approved full scan
- [ ] ทำผลการทดสอบและ G1 sign-off
- [ ] เพิ่ม Warehouse file import
- [ ] เพิ่ม bridge เฉพาะเมื่อจำเป็นและ G2 ผ่าน

## 13. Test plan

### 13.1 กลยุทธ์และ environment

| ชั้นทดสอบ | สิ่งที่ตรวจ | Environment |
|---|---|---|
| Unit | parsing, ID precision, enum mapping, counters, pagination, retry | Node test runner/Vitest, fake clock, injected transport |
| Contract | observed fixtures ยังตรง schema; unexpected fields/error envelope | sanitized snapshots, ไม่เรียก live API ใน CI |
| Integration | runner ↔ IndexedDB ↔ UI; importer ↔ SQLite | local mocks + temporary database |
| Extension E2E | permissions, messages, dashboard, export, worker restart | Playwright Chromium persistent test context |
| Security | scope, XSS, leak, bridge auth/origin/replay | mock bridge/controlled local environment |
| Manual compatibility | Brave/Chrome cookie behavior, downloads, permissions | Windows test profile; login ด้วยผู้ใช้เอง |
| UAT/Validation | ข้อมูลตรงหน้าเว็บและแก้ use case จริง | บัญชีทดสอบที่ได้รับอนุญาต; งบ request จำกัด |

Playwright แนะนำ bundled Chromium + persistent context สำหรับ extension tests; ไม่ชี้ automation ไปยัง browser profile หลักของผู้ใช้ [Playwright Chrome extensions](https://playwright.dev/docs/chrome-extensions)

อย่าสมมติ page.route ดัก request ของ extension service worker ได้ครบ: unit/integration ใช้ injectable transport และ extension E2E ใช้ test build/local mock adapter ที่ควบคุมได้ พร้อม test ป้องกัน mock/debug override หลุดใน release

record: OS, Brave/Chrome/Chromium version, extension build hash, adapter/schema version, test time, fixture hash และผลจริง; ไม่เก็บ login state ใน repository

### 13.2 Fixture set ที่ต้องมี

| ID | เนื้อหา |
|---|---|
| FX01 | success หน้าแรก: 6 valid products พร้อม IDs string ยาวและภาษาไทย |
| FX02 | page ถัดไปไม่มีแถวซ้ำ |
| FX03 | valid empty list และกรณี has_more=false แยกกัน |
| FX04 | ขอ 50 ได้ 6 เพราะ mock cap |
| FX05 | หน้า overlap และหน้าซ้ำทั้งหน้า |
| FX06 | known/unknown/missing stock/review status และ can_added ขัดแย้ง |
| FX07 | missing/null fields, formatted price, price range, malformed product |
| FX08 | HTTP 401/403/429/500, HTTP-date Retry-After, HTTP 200 business error |
| FX09 | HTML challenge/login, invalid JSON, products field หาย |
| FX10 | XSS/SQL-like text, dangerous URL, secret canaries ใน nested fields |
| FX11 | 198 products สังเคราะห์, page size 6/50, exact expected IDs |
| FX12 | 5,001 products/oversized bodies/schema change/quoted และ unquoted large IDs |

observed fixtures กับ synthetic fixtures ต้องติดป้ายแยกชัด: FX ชื่อเดียวกันไม่แปลว่าพบเหตุการณ์นั้นจาก TikTok จริงแล้ว

### 13.3 Test cases: Unit & Data

Priority P0 = data/security/release blocker; P1 = core UX/reliability; ทุก case เริ่มสถานะ NOT RUN

| ID | Pri | Req | ขั้นตอน/ข้อมูลทดสอบ | Expected result |
|---|---|---|---|---|
| UT01 | P0 | R06 | parse FX01 ที่มี ID ยาว 19 หลัก | export ID เป็น string ตรงทุกหลัก |
| UT02 | P0 | R06 | parse unquoted large ID ใน FX12 | lossless parser รักษาค่า หรือ reject; ห้ามรับเลขที่ rounded |
| UT03 | P0 | R06 | HTTP 200 แต่ business code ไม่ success | API error ไม่ใช่ []/success |
| UT04 | P0 | R05 | data.products หาย/null/object | schema error ไม่ถือ endpoint-end |
| UT05 | P1 | R06 | image/shop/commission หาย | null + warning ตามกฎ ไม่ crash/ไม่เติม 0 |
| UT06 | P0 | R07 | status ใหม่/unknown ใน FX06 | unknown เก็บ raw enum ไม่คัดทิ้ง |
| UT07 | P0 | R07 | stock=0 vs stock=null | แยก 0 กับไม่ทราบ ไม่หลอกว่าเหมือนกัน |
| UT08 | P1 | R06 | ราคา “฿1,299.00” และช่วงราคา | display คงเดิม; amount แปลงเฉพาะ rule ที่ verified |
| UT09 | P0 | R11 | title เป็น HTML/script ใน FX10 | render text ไม่เกิด code execution |
| UT10 | P0 | R06 | invalid ID/title แทรกในหน้า valid | quarantine, counters ตรง, valid rows ไม่หาย |
| UT11 | P0 | R07 | can_added=false แต่ status ผ่าน | warning/ไม่เลือกอัตโนมัติ; ไม่ส่งว่า guaranteed addable |
| UT12 | P0 | R11 | secret canaries ใน nested body/header/error | ไม่พบใน export, logs, screenshots หรือ diagnostic bundle |

### 13.4 Test cases: Pagination & Fault Handling

| ID | Pri | Req | ขั้นตอน/ข้อมูลทดสอบ | Expected result |
|---|---|---|---|---|
| PG01 | P0 | R04 | FX11 จำนวน 198, count=6, ไม่มี end metadata | offsets 0,6,…,192,198; 33 data pages + 1 empty; 198 unique |
| PG02 | P0 | R04 | FX11 count=50 ที่ mock อนุญาต | offsets 0,50,100,150,198; 4 data pages + 1 empty |
| PG03 | P0 | R04 | request 50 แต่ mock คืน 6 | offset ต่อเป็น 6 ไม่ใช่ 50; ไม่มีสินค้า skip |
| PG04 | P0 | R04 | หน้า raw 6 แต่ valid/candidate เหลือ 2 | offset เพิ่ม 6 ไม่ใช่ 2 |
| PG05 | P0 | R05 | FX05 overlap ID บางตัว | dedup ตรง, count raw/unique แยก, offset ตาม raw count |
| PG06 | P0 | R05 | mock คืนหน้าเดิมตลอด | หยุด pagination_stalled/partial ไม่ loop ไม่อ้าง complete |
| PG07 | P0 | R05 | ได้หน้าสั้นแต่ยัง has_more=true | ไม่หยุดเพียงเพราะ length<count |
| PG08 | P0 | R09 | 401/403/challenge ในหน้าแรก/กลางทาง | หยุด ไม่ fallback count ไม่ retry เพื่อข้าม; partial ถ้ามีข้อมูล |
| PG09 | P0 | R09 | 429 Retry-After=120 | ไม่มี request ก่อน 120s; pause/stop ถ้าเกิน budget |
| PG10 | P0 | R09 | Retry-After เป็น HTTP-date/ผิดรูป/ไม่มี | parse หรือ bounded fallback ตาม policy; ไม่ hot loop |
| PG11 | P1 | R09 | network/500 ก่อนสำเร็จ | retry offset เดิมไม่เกิน 2; backoff; ไม่มี duplicates |
| PG12 | P0 | R09 | verified invalid-count error แล้วกลับ baseline | fallback ครั้งเดียว; auth/rate/schema error ไม่เข้าทางนี้ |
| PG13 | P0 | R05 | page/request/byte/product/time cap | partial + reason; ไม่มี silent truncate |
| PG14 | P0 | R05 | metadata ขัดแย้ง เช่น has_more=true แต่ next_offset ถอยหลัง | unknown/partial + diagnostic; ไม่อ้างครบ |
| PG15 | P0 | R03 | กด Cancel ตอน fetch และตอนรอ retry | abort; ไม่มี request ถัดไป/late commit |
| PG16 | P1 | R05 | ไม่มีสินค้าและ envelope ถูกต้อง | endpoint-end 0 rows; UI ไม่ตีเป็น login failure |
| PG17 | P0 | R07 | ID เดิมสองหน้าแต่ราคาต่างกัน แล้วมีแถว invalid ของ ID เดิม | ใช้ valid ล่าสุดเพียงหนึ่งแถว, changedWithinRun=true, warning; invalid ไม่ทับข้อมูลดี |

### 13.5 Test cases: Lifecycle, UI และ Integration

| ID | Pri | Req | ขั้นตอน/ข้อมูลทดสอบ | Expected result |
|---|---|---|---|---|
| LC01 | P0 | R03 | Start สองครั้ง/สอง dashboard tab | มี active run เดียว ไม่มี network สองชุด |
| LC02 | P1 | R10 | ปิด popup ระหว่าง mock scan แล้วเปิดใหม่ | เห็น run เดิม/checkpoint ไม่เริ่มใหม่เงียบ ๆ |
| LC03 | P0 | R10 | terminate SW หลัง commit หน้าแรก | staged page คงอยู่; stale lease → Interrupted |
| LC04 | P0 | R10 | crash ก่อน/หลัง page transaction | ไม่มีครึ่งหน้า/offset เดินแต่ rows ไม่ถูกเก็บ |
| LC05 | P0 | R10 | restart run แล้วให้ response เก่ากลับมา | fencing ปฏิเสธ late write |
| LC06 | P1 | R10 | browser restart ระหว่าง scan | เสนอ scan ใหม่จาก 0; ไม่บอก completed เอง |
| LC07 | P0 | R10 | IndexedDB quota/write failure | หยุด partial/storage_error; offset ไม่ advance โดยข้อมูลหาย |
| UI01 | P1 | R08 | filter candidate แล้ว Select all | จำนวนตรง filter ทุกหน้า; ปุ่มบอกจำนวนชัด |
| UI02 | P0 | R08 | เลือก 3 จาก 6 แล้ว export | มี 3 ID ตรงที่เลือก ไม่มีแถวอื่น |
| UI03 | P0 | R05 | export partial/unknown run | มี metadata และ warning; ไม่ใช้ชื่อ success ครบ |
| UI04 | P1 | R08 | title ไทยยาว/ภาพเสีย/คีย์บอร์ด navigation | text อ่านได้ placeholder ใช้ได้ focus/button ใช้ได้ |
| UI05 | P1 | R08 | เปิด preview mock 5,000 rows | ใช้ local pagination/virtualization ไม่สร้าง DOM ทั้งชุดโดยไม่จำเป็น |
| UI06 | P1 | R02 | ไม่ให้/ถอน host permission | permission_required; ไม่เพิ่ม host กว้างเอง |
| IT01 | P0 | R15 | CI ทุก suite และ test bundle | ไม่มี request ไป TikTok; fail เมื่อหลุด external network |
| IT02 | P0 | R14 | mock account identity เปลี่ยนกลาง run | หยุด identity_changed; ห้ามผสม source |
| IT03 | P1 | R14 | response ไม่มี identity | UI ระบุ unverified และ single-profile constraint ไม่แสดงบัญชีว่า verified |

### 13.6 Test cases: Warehouse และ Optional Bridge

ทดสอบกลุ่ม DB สำหรับ M2 file import; กลุ่ม WS เฉพาะเมื่อเปิด direct bridge ไม่ถือผ่านโดยอัตโนมัติถ้ายังไม่สร้าง

| ID | Pri | Req | ขั้นตอน/ข้อมูลทดสอบ | Expected result |
|---|---|---|---|---|
| DB01 | P0 | R12 | import ชุดเดิมสองครั้งด้วย key เดิม | receipt เดิม; จำนวน row ไม่เพิ่ม |
| DB02 | P0 | R12 | key เดิมแต่ payload เปลี่ยน | conflict reject ไม่แก้ผลเดิมเงียบ ๆ |
| DB03 | P0 | R12 | throw ระหว่าง commit transaction | rollback ทุก row หรือ commit ครบ ไม่มีครึ่งชุด |
| DB04 | P0 | R14 | Product ID เดียวจาก source A/B | records แยก source ไม่ overwrite ข้ามกัน |
| DB05 | P0 | R05 | import partial/subset แล้วเทียบข้อมูลเดิม | ไม่มี delete/mark missing สินค้าอื่น |
| DB06 | P0 | R06 | ไฟล์ JSON version ไม่รองรับ/URL/ID ไม่ถูกต้อง | reject พร้อม field errors ไม่เชื่อ client validation |
| DB07 | P1 | R12 | commit สำเร็จแต่ response หาย | retry idempotent ไม่ duplicate |
| DB08 | P0 | R11 | SQL-like product title | parameterized query; ข้อความถูกเก็บไม่ execute |
| WS01 | P0 | R13 | fake server ตอบ health ถูกแต่ไม่มี key | ไม่มี commands/products ออกจน server proof ผ่าน |
| WS02 | P0 | R13 | wrong/missing key หรือ command ก่อน auth | ปิด/reject ภายใน auth timeout; ไม่เรียก TikTok |
| WS03 | P0 | R13 | origin เว็บอื่น/missing/unexpected Host | handshake ถูกปฏิเสธแม้รูปแบบ message ถูก |
| WS04 | P0 | R13 | replay nonce/session/sequence/MAC หรือแก้ payload | reject ทุกกรณี; ไม่มี replay action |
| WS05 | P0 | R13 | ส่ง publish/cookie-export/arbitrary URL | reject action ไม่อยู่ Flow A |
| WS06 | P0 | R13 | oversized frame/flood ใน mock | bounded connection/payload/rate; process ไม่ล่ม |
| WS07 | P0 | R12 | ACK หาย, ส่ง chunk เดิม, reconnect | auth ใหม่ + dedup; ไม่ duplicate staging |
| WS08 | P0 | R13 | unpair/rotate ขณะเชื่อมอยู่ | ปิด session เก่า; key เก่าใช้ไม่ได้ |
| WS09 | P0 | R11 | ตรวจ listener และ network จากเครื่องทดสอบอื่น | listen loopback เท่านั้น ไม่รับจาก LAN |
| WS10 | P0 | R11 | ตรวจ artifacts/logs หลัง pairing/reconnect | ไม่มี pairing key/token/session secrets |
| WS11 | P0 | R13 | fake bridge ทำ transparent relay แล้วแก้ command | message integrity ตรวจพบการแก้ไข; ระบุว่าการ relay/การอ่าน plaintext ยังเป็น residual risk ของ ws |
| WS12 | P0 | R14 | instance ที่จับคู่ source A ส่ง chunk อ้าง source B | reject source mismatch แม้ authentication ผ่าน |

### 13.7 Manifest/package security checks

| ID | Pri | Req | ตรวจ | Expected result |
|---|---|---|---|---|
| PK01 | P0 | R02 | manifest/release bundle | ไม่พบ cookies/debugger/nativeMessaging/`<all_urls>` โดยไม่มี approved scope |
| PK02 | P0 | R11 | grep/build review | ไม่มี eval/remote code loader/embedded secrets หรือ general-purpose credential export |
| PK03 | P0 | R15 | release config | ไม่มี mock API override/fixture bypass/auth skip ที่ผู้ใช้เว็บสั่งเปิดได้ |
| PK04 | P0 | R11 | method/path network log ของ mock E2E | TikTok calls เป็น allowlisted read-only request เท่านั้น |
| PK05 | P1 | R11 | cache/fixtures retention และ Clear data | ลบข้อมูลของ extension ตามที่แจ้ง โดยไม่ลบ cookie TikTok |

## 14. Validation tests — พิสูจน์ว่าใช้ได้จริงและข้อมูลตรง

Unit test พิสูจน์ว่าโค้ดทำตามกฎ แต่ยังไม่พิสูจน์ว่ากฎตรงกับ TikTok จริง ส่วนนี้เป็นการตรวจ business/data correctness ด้วยหลักฐานและผู้ใช้

| ID | Validation | ขั้นตอน | ผ่านเมื่อ | หลักฐานที่เก็บ |
|---|---|---|---|---|
| VA01 | Endpoint identity | เทียบ Network กับ adapter config | method/host/path และรูปแบบ query ตรง observed request | notes ไม่รวม secrets |
| VA02 | Row correspondence | สุ่มสินค้าอย่างน้อย 10 ตัวจาก ≥2 หน้า หรือทั้งหมดถ้าน้อยกว่า | ID/title/status ตรง ณ เวลาตรวจ; ราคา/stock ที่เปลี่ยนตามเวลาถูกตรวจใหม่ไม่ด่วนสรุป bug | sanitized comparison sheet |
| VA03 | Pagination completeness | mock dataset ที่รู้รายการ exact + live ชุดเล็กที่ตรวจได้ทั้งหมด | mock ID set ตรง 100%; live ไม่มี mismatch ที่อธิบายไม่ได้ | expected/actual IDs + request counts |
| VA04 | Status semantics | เทียบ enum กับ UI ของตัวอย่างที่มีจริง | known mapping มีหลักฐาน; ค่าที่ไม่พบยัง unknown | dictionary version |
| VA05 | Login prerequisite | ทดลองหนึ่งหน้าใน profile ที่ login และ profile ทดสอบที่ไม่ login | logged-out หยุด/แจ้งชัด; logged-in ได้ valid response หรือบันทึก blocker จริง | ผลและ browser/settings version |
| VA06 | No-open-tab assumption | หลังได้ session ปกติ ปิดแท็บ TikTok แล้วขอหนึ่งหน้า | บันทึกว่าได้/ไม่ได้ตามจริง; ไม่อ้าง universal support | permission+cookie-policy notes ไม่รวมค่า cookie |
| VA07 | User intent | เขตเลือกสินค้า 3 รายการแล้ว export/import | warehouse/JSON มีเฉพาะ 3 ID; เข้าใจ partial/unknown และไม่มีการโพสต์ | UAT sign-off |
| VA08 | Privacy boundary | ตรวจไฟล์/log/storage ที่เกิดจาก test ด้วย canaries | ไม่มีรหัสผ่าน/session cookie/auth tokens; debug sample ถูก sanitize | scan summary |
| VA09 | Browser compatibility | ทำ basic Flow A บน Brave และ Chrome Windows | Start/Cancel/preview/export ผ่านทั้งสอง หรือระบุ unsupported โดยไม่ปิด security ทั้งเครื่อง | test matrix พร้อมเวอร์ชันจริง |
| VA10 | Page-size optimization | ถ้าจะเปิด 50 เปรียบเทียบกับ baseline บน approved sample ที่ไม่เปลี่ยน | normalized ID set ตรง, error ไม่เพิ่ม, มีประโยชน์วัดได้; ไม่ใช้ผลนี้อ้างรู้ rate limit | request/time/count comparison |

VA10 ไม่ใช่เงื่อนไขจำเป็นของ M1 baseline ถ้าไม่ได้เปิด optimization; ห้ามให้คะแนน Pass โดยยังไม่ทดสอบ

สำหรับ VA03 จำนวนสินค้าที่เห็นว่า 33 หน้าไม่พิสูจน์ว่ามี 198 พอดี เพราะหน้าสุดท้ายอาจไม่เต็ม และรายการเปลี่ยนระหว่าง scan ได้ ต้องเทียบ ID set หรือ metadata ที่ตรวจแล้ว

### 14.1 Live validation safety budget

- ทดลองหนึ่งหน้าก่อน แล้วจึงขอผู้ใช้เริ่ม full scan เองเมื่อผลถูกต้อง
- ไม่มี scheduled polling ใน MVP; live run ไม่เป็น CI gate ที่ยิงทุก commit
- Stop ทันทีเมื่อ auth denied, challenge, 429 หรือพฤติกรรมผิดคาด ไม่ retry เพื่อสร้างหลักฐานเพิ่ม
- Error/load/security tests ทั้งหมดใช้ synthetic/local mock; ไม่สร้างรายการสินค้า ไม่เปลี่ยนบัญชี ไม่โพสต์จริงเพื่อทดสอบ Flow A
- network trace/HAR หากจำเป็นต้องเก็บ local ให้ตรวจ secrets ก่อนนำออก ห้ามแนบทั้งหมดโดยอัตโนมัติ

## 15. ตัวอย่าง executable test specifications

เป็น Given/When/Then สำหรับนำไปเขียน test code ในขั้นพัฒนา ไม่ใช่ผลทดสอบที่รันแล้ว

### AT01 — Server cap ไม่ทำให้ข้ามสินค้า

```gherkin
Given mock มีสินค้า ID 1 ถึง 18 และคืนสูงสุดครั้งละ 6
And importer ขอ count=50 โดยใช้ offset contract ที่ตรวจแล้ว
When importer สแกนจนได้ valid empty page
Then request offsets ต้องเป็น 0, 6, 12, 18
And uniqueValidProducts ต้องเป็น 18
And ID set ต้องตรง expected ทุกตัว
And scanCoverage ต้องเป็น reached_endpoint_end
```

### AT02 — Schema เปลี่ยนไม่เท่ากับไม่มีสินค้า

```gherkin
Given หน้าแรกมีสินค้า valid 6 รายการ
And หน้าถัดไปตอบ HTTP 200 แต่ไม่มี data.products
When importer ตรวจ response
Then ต้องหยุดด้วย schema_changed
And เก็บ 6 รายการเดิมใน staging
And scanCoverage ต้องเป็น partial
And ห้ามลบหรือ mark missing สินค้าใน Warehouse
```

### AT03 — ไม่ย่น Retry-After

```gherkin
Given mock ตอบ 429 พร้อม Retry-After: 120
When fake clock เดินถึงวินาทีที่ 119
Then ต้องไม่มี request เพิ่ม
When fake clock เดินครบ 120 วินาทีและ job ยังไม่ถูกยกเลิก
Then retry ได้เฉพาะ offset เดิมภายใน retry budget
```

### AT04 — Bridge ปลอม

```gherkin
Given local process ตอบ health ได้และเปิด WebSocket ได้
But process ไม่สามารถให้ server authentication proof ที่ถูกต้อง
When extension พยายามเชื่อมต่อ
Then pairing secret ต้องไม่ถูกส่งตรงให้ process
And ห้ามส่ง products หรือยอมรับ import.start
And ผู้ใช้เห็นว่าไม่สามารถยืนยัน bridge ได้
```

### AT05 — ตอบกลับหายหลังบันทึก

```gherkin
Given backend commit สินค้า 3 รายการสำเร็จ
And connection หลุดก่อน client ได้ receipt
When client ส่ง commit ด้วย idempotency key และ digest เดิมอีกครั้ง
Then backend คืน receipt เดิม
And Warehouse ยังมีสินค้าใหม่เพียง 3 รายการ
```

## 16. Release gates และ Definition of Done

### G1 — M1 Standalone Importer

- [ ] G0 ผ่านหรือ label ชัดว่า mock-only prototype ไม่ใช่ live-ready
- [ ] P0 ของ UT/PG/LC/UI/IT/PK ที่อยู่ใน scope ผ่านทั้งหมด; ไม่มี Critical/High defect ค้าง
- [ ] VA01–VA09 ผ่านส่วนที่อยู่ใน scope; inability to authenticate = blocker สำหรับ live-ready ไม่ใช่ reason ให้ข้าม test
- [ ] Branch coverage เป้าหมาย ≥90% สำหรับ parser/pagination/error state; coverage ไม่แทน semantic validation
- [ ] Mock 198 records ได้ ID set ตรง 100%; test 0/1/6/7/exact multiple/capped/overlap ครบ
- [ ] Precision ของ Product ID และ price handling ผ่าน; rejected/unknown ไม่หายเงียบ
- [ ] interruption/cancel/limits ไม่ถูกแสดงเป็น complete
- [ ] Export ไม่พบ secrets; package สิทธิ์ต่ำสุด
- [ ] ใช้งาน keyboard ได้; user มองเห็นว่าอะไรถูกเลือกและอะไรจะส่งออก
- [ ] การทดสอบ UI ด้วย mock: progress หลัง commit หน้า ≤1 วินาที; Cancel หยุดการเริ่ม request ใหม่ทันที และ UI เปลี่ยนสถานะ ≤2 วินาทีบนเครื่องทดสอบที่บันทึกสเปก
- [ ] มี build instructions, install/uninstall, clear data, known limitations และ rollback package

### G2 — M2 Warehouse/Bridge

- [ ] G1 + DB01–DB08 ผ่าน
- [ ] migration ทดสอบบน temporary DB และ backup/rollback มีขั้นตอน ไม่ทำลาย DB เดิม
- [ ] หากเปิด bridge: WS01–WS12 ผ่าน, protocol review และ crypto test vectors ผ่านก่อน release
- [ ] ไม่มีประโยค “localhost ปลอดภัยอยู่แล้ว” เป็น security assumption
- [ ] ทดสอบ reconnect, revoke/rotate และ import idempotency จริงบน mock
- [ ] ถ้าไม่มี bridge กลุ่ม WS ระบุ NOT APPLICABLE พร้อมเหตุผล ไม่ระบุ Pass

### 16.1 การบันทึกผลทดสอบ

ใช้สถานะ NOT RUN / PASS / FAIL / BLOCKED / NOT APPLICABLE เท่านั้น

| Test ID | Build/Browser | Fixture/Evidence | Expected | Actual | Status | Defect | Tested at |
|---|---|---|---|---|---|---|---|
| ตัวอย่าง PG01 | รอ build | FX11 | 198 IDs ตรงทั้งหมด | ยังไม่รัน | NOT RUN | — | — |

งานเขียนเอกสารนี้ไม่ถือเป็นการรัน UT/E2E/UAT ใด ๆ และไม่มีการเชื่อมบัญชี TikTok ของผู้ใช้

## 17. ความเสี่ยงและการตัดสินใจที่ยังค้าง

| เรื่อง | ผลกระทบ | แนวทาง/เงื่อนไขหยุด |
|---|---|---|
| Internal endpoint เปลี่ยน/ไม่อนุญาต | connector ใช้ไม่ได้ | isolate adapter; fail closed; ช่องทางที่ได้รับอนุญาต/นำเข้าไฟล์ |
| Session ใช้ไม่ได้ใน extension context | M1 fetch ไม่ผ่าน | บันทึก policy/permission; ไม่ export cookies แก้ปัญหา |
| ข้อมูลที่ต้องการไม่มีใน API | warehouse enrichment ทำไม่ได้จาก endpoint นี้ | nullable; ระบุ missing ไม่ scrape เพิ่มนอก scope |
| Offset data drift | ซ้ำ/ตกหล่นแม้ dedup แล้ว | completeness qualifier; restart เมื่อ interrupted; ไม่ auto-delete |
| ไม่มี identity field | แยกบัญชีอัตโนมัติไม่น่าเชื่อถือ | หนึ่งบัญชีต่อ profile; unverified source label; ห้าม merge อัตโนมัติ |
| MV3 termination/storage quota | งานหายหรือค้าง | page transactions, fencing, interrupted state, bounded data |
| Bridge mutual auth ยังไม่ออกแบบผ่าน review | ข้อมูลอาจถึง process ปลอม | ใช้ file import ต่อ ไม่เปิด bridge |
| เอา rate test ไปยิงบัญชีจริง | บัญชีถูกจำกัด | mock-only load/error tests; live manual budget |

คำถามที่ตอบหลัง M0: response มีอะไรทั้งหมด, identity ที่ไม่เป็น secret มีไหม, page-end contract คืออะไร, size 50 รองรับหรือไม่, status enum ไหนพิสูจน์แล้ว, cookie policy บน Brave ทำงานอย่างไร

ไม่ต้องรอคำตอบที่ไม่จำเป็นต่อ M1 เช่น commission API หรือ auto-post เพื่อเริ่มเขียน mock/domain/UI

## 18. เริ่มทำอะไรเป็นอันดับแรก

1. เก็บ sanitized Response ของหน้าแรกและหน้าถัดไปจากบัญชีทดสอบ พร้อม query ที่ไม่อ่อนไหว
2. ทำ data dictionary และยืนยัน G0
3. เขียน mock + validator + pagination tests แล้วค่อยเชื่อม fetch จริงแบบหนึ่งหน้า
4. ทำ M1 ให้ Preview/เลือก/Export ใช้งานได้ ก่อนเพิ่ม Warehouse integration และ WebSocket

ผลสำเร็จของรุ่นแรกไม่ใช่ “ยิง endpoint ได้” แต่คือ “นำเข้าสินค้าได้ถูกตัวครบตามหลักฐาน อธิบายข้อจำกัดได้ และไม่มี session หรือ action ที่ไม่ตั้งใจหลุดออกไป”
