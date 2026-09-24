# API observations & data dictionary

**G0: NOT PASSED** — มีหลักฐาน **full capture** จากบัญชีจริงครบทั้ง 3 หน้าแล้ว (หน้า 1, หน้า 2, หน้า 34)
checklist §5.3 ติ๊กได้ 5 จาก 6 ข้อ เหลือข้อเดียว (สิทธิ์บัญชี/ความเหมาะสม §3.1) — **ตรวจเอกสารแล้ว
(2026-09-20) พบว่า TikTok Shop Creator Terms ห้าม automated access โดยไม่มี express written
permission ซึ่งยังไม่ได้ขอ** ข้อนี้จึงตอบแล้วว่า "ยังไม่ได้รับอนุญาต" ไม่ใช่แค่ "ยังไม่มีข้อมูล"

> **เปลี่ยนขอบเขต (2026-09-20 รอบที่สี่):** เจ้าของโปรเจกต์อนุญาตให้ทดลองอ่าน **หนึ่งหน้า แบบกดเอง**
> บนบัญชีของตนเอง gate ถูกแยกเป็นสามค่าที่ตอบคนละคำถาม — `G0_VERIFIED` (gate ของ full scan)
> **ยังเป็น `false`** และสถานะการอนุญาตจาก TikTok **ยังเป็น "ยังไม่ได้รับอนุญาต"** ไม่ถูกแก้
> รายละเอียดทั้งหมดอยู่ใน **§7**
>
> **ทดลองจริงแล้วและสำเร็จ (2026-09-20)** — อ่านหน้าแรกได้ 6/6 รายการ, mapping/lossless ID/ขอบเขต
> R11 ทำงานถูกต้องบนข้อมูลสด, ID ตรงกับ fixture เดิม 6/6 · ผลเต็มอยู่ใน **§8**

รอบเก็บหลักฐาน: **2026-09-20** จากบัญชีจริงของผู้ใช้ ผ่าน DevTools → Network (ไม่รันสคริปต์ใด ๆ ไม่ยิง request เพิ่มเอง
ไม่ส่ง Cookie/Authorization/HAR/cURL ออกนอกเครื่อง ตาม spec §5.1)

- อ้างอิง spec: [tiktok_flow_a_extension_plan.md](tiktok_flow_a_extension_plan.md) §5
- adapter ที่มีอยู่ตอนนี้: `mock-v0` (fixture สังเคราะห์ล้วน ไม่มี network)
- `G0_VERIFIED = false` ใน [extension/src/domain/version.ts](../extension/src/domain/version.ts) — **ยังเป็น false และห้ามเปลี่ยน
  จนกว่า checklist §5.3 จะครบทุกข้อพร้อมหลักฐาน**
- ตัวอย่างทั้งหมดในเอกสารนี้ถูกแทนค่าที่ระบุตัวตนแล้ว (seller_id/shop_name/รหัสรูปภาพ) โดยคงรูปแบบและความยาวเดิมไว้

### Fixtures ที่เก็บจากหลักฐานรอบนี้ (full capture ครบทั้ง 3 หน้า)

รอบแรกวาง response ผ่านแชต ซึ่งตัดข้อความที่ 50,000 ตัวอักษรเสมอ ทำให้ได้แค่ partial capture รอบนี้
เก็บลงไฟล์บนดิสก์โดยตรงผ่าน DevTools → Copy response ไม่ผ่านแชต จึงได้ **full capture ครบทุกหน้า**
ไฟล์ partial เดิมถูกลบออกแล้ว

| ไฟล์ | มาจาก | สถานะ |
|---|---|---|
| [tests/fixtures/observed/2026-09-20-page1-offset0-full6products.json](../tests/fixtures/observed/2026-09-20-page1-offset0-full6products.json) | `offset=0&count=6` | **ครบ** 6/6 รายการ |
| [tests/fixtures/observed/2026-09-20-page2-offset6-full6products.json](../tests/fixtures/observed/2026-09-20-page2-offset6-full6products.json) | `offset=6&count=6` | **ครบ** 6/6 รายการ |
| [tests/fixtures/observed/2026-09-20-page34-offset198-full3products.json](../tests/fixtures/observed/2026-09-20-page34-offset198-full3products.json) | `offset=198&count=6` | **ครบ** 3/3 รายการ |
| [tests/fixtures/observed/PROVENANCE.md](../tests/fixtures/observed/PROVENANCE.md) | — | ที่มา วิธีเก็บ สิ่งที่ถูกแทนค่า และข้อจำกัดของการ sanitize |

เพราะเป็น full capture แล้ว **จำนวนรายการในไฟล์ = จำนวนจริงที่ server ส่งมาของหน้านั้น** →
ใช้ทดสอบทั้ง parser/normalizer **และ**เงื่อนไขจบของ pagination ได้แล้ว (ดู §2.2) — ดูรายละเอียดใน
`tests/contract/observed-showcase-contract.test.ts`

---

## 1. Request contract ที่สังเกตได้จริง

| รายการ | ค่าที่สังเกตได้ | สถานะ |
|---|---|---|
| Method | `GET` | **observed** |
| URL | `https://shop.tiktok.com/api/v1/streamer_desktop/showcase_product/list` | **observed** |
| Query (หน้าแรก) | `offset=0&count=6` | **observed** |
| Query (หน้าที่สอง) | `offset=6&count=6` → 200 OK, `Content-Length: 4619` | **observed** |
| Query (หน้าสุดท้าย) | `offset=198&count=6` → 200 OK, ได้ **3 รายการ** (น้อยกว่า `count`) | **observed** |
| หน้าที่เรียกใช้ | กล่อง "Add product links" → แท็บ "Showcase products" ในหน้าอัปโหลดวิดีโอ (`tiktokstudio/upload`) | **observed** |
| Status | `200 OK` | **observed** |
| `Content-Type` | `application/json; charset=utf-8` | **observed** |
| `Content-Encoding` | `br` (brotli) | **observed** |
| `Content-Length` | `4730` (ขนาดหลังบีบอัด; JSON จริงใหญ่กว่านี้มาก) | **observed** |
| `Access-Control-Allow-Origin` | `https://www.tiktok.com` | **observed** |
| หน้าทั้งหมดที่ UI แสดง | 34 หน้า (จากแถบแบ่งหน้าบนจอ) | **observed (จาก UI ไม่ใช่จาก API)** |

**ข้อสังเกตสำคัญ:** endpoint และ method ตรงกับที่ spec §3.1 อนุมานไว้จาก source ของ Triple Bot ทุกประการ
ข้อนี้จึงเลื่อนจาก *assumption* เป็น *observed fact* ได้แล้ว

### `count` — สิ่งที่หลักฐานบอก และสิ่งที่ไม่ได้บอก

| ข้อความ | สถานะ |
|---|---|
| หน้าเว็บของ TikTok ใช้ `count=6` ในทุก request ที่สังเกตได้ (3 หน้า) | **observed** — นี่คือ baseline |
| server ยอมรับ `count=6` และตอบ 200 OK | **observed** |
| server รองรับ `count=50` หรือไม่ | **unknown** |
| server ปฏิเสธ `count=50` | **ไม่มีหลักฐาน — ห้ามอ้าง** |

**สิ่งที่ต้องไม่สับสน:** การที่หน้าเว็บ *ไม่ได้ใช้* `count=50` ในทราฟฟิกที่สังเกตได้ **ไม่ได้หักล้าง**
ข้อความใน spec §3.1 ว่า Triple Bot เริ่มที่ `count=50` แล้ว fallback เป็น 6 — เราแค่ไม่เคยเห็นค่า 50 ถูกส่ง
จึงไม่มีข้อมูลว่าจะเกิดอะไรขึ้น การทดสอบต้องยิง request เอง ซึ่ง**อยู่นอกขอบเขตของรอบนี้**

ผลต่อการออกแบบ: ใช้ `count=6` เป็นค่าที่มีหลักฐานรองรับ ส่วน VA10 (page-size optimization) ยังคงเป็น
**unknown/optional** ไม่ใช่ข้อที่ถูกตัดทิ้งแล้ว

---

## 2. Data dictionary (spec §5.2) — เติมเท่าที่พิสูจน์ได้

| JSON path | Type จริง | ตัวอย่าง (sanitized) | Optional/null ได้ไหม | ความหมายและหลักฐาน | กฎระบบเรา |
|---|---|---|---|---|---|
| `code` | number | `0` | ยังไม่พบกรณีอื่น | `0` มาคู่กับ `message: "success"` | **ไม่ถือ HTTP 200 ว่าสำเร็จเสมอ** ต้องตรวจ `code` |
| `message` | string | `"success"` | ยังไม่พบกรณีอื่น | ข้อความสถานะ | ใช้ `code` ตัดสิน ไม่ใช่ `message` |
| `data.products` | array | 6 รายการเมื่อ `count=6` | ยังไม่พบกรณี missing/null | array ของสินค้าใน Showcase | **missing ≠ empty** |
| `product_id` | **string (มี quote)** | `"1736476547228075452"` (19 หลัก) | ยังไม่พบ null | ตรงกับ Product ID บนหน้าจอทุกตัวที่เทียบ | canonical string; **lossless parse ยังต้องคงไว้เป็นเกราะ** เผื่อ endpoint/เวอร์ชันอื่นส่งเป็นเลขเปล่า |
| `title` | string | ข้อความไทย ยาวสุดที่พบ ~170 ตัวอักษร | ยังไม่พบ null | ชื่อสินค้า | render เป็น text เท่านั้น (V11) |
| `format_available_price` | **string พร้อมสัญลักษณ์สกุลเงิน** | `"฿128.71"` | ยังไม่พบ null | ราคาที่จัดรูปแบบมาแล้วจาก server | **เก็บเป็น display string ตามเดิม ห้ามแปลงเป็นตัวเลข/สกุลเงินเอง** (V07) |
| `stock_status` | number | `1`, `2` | ยังไม่พบ null | พบ 2 ค่า — ดู §2.3 สำหรับการจับคู่กับป้ายบน UI | เก็บ raw enum → `unknown` (V06) |
| `review_status` | number | `1`, `4` | ยังไม่พบ null | พบ 2 ค่า — ดู §2.3 | เก็บ raw enum → `unknown` (V06) |
| `can_added` | boolean | `true` | ยังไม่พบ `false` เลย | **พบ `true` แม้ในสินค้าที่ UI บอกว่า "Unavailable" และมี `status_popup` ว่า "Product not available"** | **ใช้ตัดสินความพร้อมใช้งานไม่ได้** — ยืนยัน spec §3.2 ข้อ 6 |
| `stock_num` | number | `2653`, `0`, `599992` | **หายทั้ง field ได้** — พบสินค้าที่ไม่มี `stock_num` เลย แต่ UI แสดง `0` | จำนวนคงเหลือ | **field หาย ≠ ค่า `0`** ห้ามเติม `0` แทน (V05) |
| `status_popup` | object | `{title, content, button, reason_code}` | **มีเฉพาะบางรายการ** (ไม่พบในสินค้าปกติ) | **พบเฉพาะสินค้าที่ UI ขึ้น "Unavailable"** — `reason_code: 11` = "This product was deleted by the seller", `reason_code: 14` = "This product is no longer an affiliate product" | สัญญาณความไม่พร้อมใช้งานที่ชัดที่สุดที่พบ — ดู §2.3 · **ใช้แล้ว (2026-09-24)**: เก็บแค่การมี/ไม่มี object นี้เป็น `hasStatusPopup: boolean` ใน `NormalizedProduct` (ไม่เก็บ `reason_code`/เนื้อหา เพราะ M1 แค่ต้องรู้ว่า "ตายแน่ๆ" หรือไม่) — ใช้กรองตอน import เข้า pooling_prompt (`lib/showcase-import.ts`) |
| `is_hide` | boolean | `false` | ยังไม่พบ null | ยังไม่ทราบความหมายแน่ชัด | ไม่ใช้ตัดสินใจใน M1 |
| `source` | string | `"Affiliate"` | ยังไม่พบค่าอื่น | ที่มาของรายการ | ไม่ใช้ตัดสินใจใน M1 |
| `seller_info.seller_id` | string | `"7490000000000000001"` (19 หลัก) | ยังไม่พบ null | **ผู้ขายของสินค้าแต่ละชิ้น ไม่ใช่บัญชีผู้ใช้** — **ไม่จำเป็นต้องต่างกันทุกสินค้า**: จาก 15 สินค้าที่เก็บได้ (3 หน้าเต็ม) พบร้านเดียวกันลงมากกว่า 1 ชิ้น 2 คู่ (แก้ข้อสรุปเดิมที่มาจากตัวอย่างแค่ 5 ชิ้น) | **ไม่ใช่ identity ของ source** ห้ามใช้ยืนยันบัญชี และห้ามใช้ dedupe สินค้า |
| `seller_info.shop_name` | string | `"exampleshop_"` | ยังไม่พบ null | ชื่อร้านของผู้ขายสินค้านั้น | เก็บได้ ไม่ใช่ข้อมูลอ่อนไหวของผู้ใช้ |
| `cover` | object | `{height:300, width:300, thumb_uri, thumb_url_list[], uri, url_list[]}` | ยังไม่พบ null | รูปปกสินค้า | URL มี signed query params ที่หมดอายุได้ |
| `images[]` | array of object | โครงสร้างเดียวกับ `cover` | ยังไม่พบ null | รูปเพิ่มเติม (พบ 6–10 รูป/สินค้า) | เช่นเดียวกับ `cover` |
| `affiliate_info` | object | **รูปร่างไม่คงที่** — พบ 3 แบบ: ครบ 7 field, ขาด `included_reward_commission_rate`+`reward_order_type`, และแบบมีแค่ `{est_commission_expense: "-"}` field เดียว | ตัว object เองพบทุกรายการ แต่ **field ข้างในขาดได้** | ดูรายละเอียดใต้ตาราง | **ห้ามสมมติว่ามี field ครบ** |
| `affiliate_info.commission_rate` | number | `100`, `1100`, `1200`, `1300`, `1600` | **ขาดได้** (ไม่มีในแบบ `{est_commission_expense: "-"}`) | ยังไม่ยืนยันหน่วย (น่าจะ basis points แต่**ยังไม่พิสูจน์**) | ไม่ใช้ใน M1 |
| `affiliate_info.commission_expense` | number (float) | `14.16`, `3.41`, `76.44` | **ขาดได้** | จำนวนเงินเป็นตัวเลข | ไม่ใช้ใน M1 |
| `affiliate_info.est_commission_expense` | string | `"฿14.16"`, **`"-"`** | พบทุกรายการที่มี `affiliate_info` | **ค่าเป็นขีด `"-"` ได้ ไม่ใช่ราคาเสมอไป** | ห้าม parse เป็นตัวเลข |
| `affiliate_info.commission_with_currency` | string | `"฿14.16"` | **ขาดได้** | จำนวนเงินพร้อมสกุล | ไม่ใช้ใน M1 |
| `category_info` | object | `{id:"600024", name:"เครื่องครัว", starling_key:"magellan_600024", option_children:[...]}` | ยังไม่พบ null | หมวดหมู่สินค้า (`id` เป็น string) | **ใช้แล้ว (2026-09-24)**: อ่านแค่ `.name` เข้า `categoryLabel: string \| null` ใน `NormalizedProduct` (`null` เมื่อ field หาย ไม่ใช่ข้อความว่าง) |
| `labels[]` | array of object | `{text:"Free sample", theme:100, type:1, icon:{light_url, dark_url, width, height}}` | พบเป็น array ว่างได้หรือไม่ ยังไม่ทราบ | ป้ายโปรโมชัน | ไม่ใช้ใน M1 |
| `source_from`, `platform`, `reward_order_type`, `commission_view_type`, `from_apac` | number/boolean | `2`, `5`, `2`, `0`, `false` | ยังไม่พบค่าอื่น | **ยังไม่ทราบความหมายทั้งหมด** | ไม่ใช้ตัดสินใจใน M1 |
| `promotion_short_cuts`, `label_detailed_info` | object | `{}` (ว่าง) | พบเป็น `{}` ทุกรายการ | ยังไม่ทราบความหมาย | ไม่ใช้ใน M1 |
| `data.total` | number | `201` | ยังไม่พบ null | **จำนวนรายการทั้งหมด** — สอดคล้องกับ UI ที่แสดง 34 หน้า (⌈201/6⌉ = 34) | ใช้ร่วมกับ `offset`+จำนวนที่ได้ เพื่อหาจุดจบ |
| `data.show_trend` | boolean | `false` | ยังไม่พบค่าอื่น | ยังไม่ทราบความหมาย | ไม่ใช้ใน M1 |
| **`has_more`** | **ไม่มี field นี้** | — | — | **ตรวจส่วนท้ายของ `data` แล้ว ไม่มีเลย** | ต้องอนุมานจุดจบเอง |
| **`next_offset`** | **ไม่มี field นี้** | — | — | **ตรวจส่วนท้ายของ `data` แล้ว ไม่มีเลย** | ต้องคำนวณ offset ถัดไปเอง |
| **`cursor`** | **ไม่มี field นี้** | — | — | **ตรวจส่วนท้ายของ `data` แล้ว ไม่มีเลย** | pagination เป็นแบบ offset ล้วน |
| **identity field ของบัญชีผู้ใช้** | **ไม่พบ** | — | — | ในส่วนที่เห็นทั้งหมดไม่มี field ใดระบุว่าเป็นบัญชีใคร | `sourceIdentityVerified: false` เสมอ (V12a) |

### หมายเหตุรูปร่างของ `labels[]`

**รายการใน `labels[]` ไม่ได้มีรูปร่างเดียวกันทั้งหมด** — พบ 3 แบบ:

1. แบบเต็ม: `{text: "Free sample", theme: 100, type: 1, icon: {...}}`
2. แบบที่ `text` เป็น **empty string**: `{text: "", theme: 100, type: 28, icon: {...}}`
3. แบบที่**ไม่มี `text` และไม่มี `icon` เลย**: `{theme: 0, type: 34}`

normalizer ต้องไม่สมมติว่าทุก label มี `text` และต้องแยก `text` ที่หายไป ออกจาก `text` ที่เป็น `""`
นอกจากนี้ยังพบ label ซ้ำกันสองรายการติดกันในสินค้าเดียว (type 25, ข้อความรูปแบบ "N% off" สองครั้ง) —
**เปอร์เซ็นต์ในข้อความไม่คงที่**: สังเกตสินค้าเดียวกัน (`1736686332743353868`) สองครั้งในวันเดียวกัน
ได้ `"59% off"` ตอนเช้าและ `"54% off"` ตอนบ่าย ดังนั้นห้ามผูก assertion หรือ logic ใดกับตัวเลขเปอร์เซ็นต์
ในข้อความนี้ — ถือเป็น display string ที่เปลี่ยนได้ตลอดเวลา ไม่ใช่ identity

## 2.3 Observed pairing: ค่าดิบ ↔ ป้ายบน UI (**ยังไม่ใช่ enum mapping ที่ยืนยันแล้ว**)

หน้า 1 และหน้า 2 ทุกรายการขึ้น **"Active"** เหมือนกันหมด ส่วนหน้าสุดท้าย (34) มีสถานะที่ต่างออกไป
ตารางนี้คือการจับคู่ที่ **สังเกตได้จริง** ระหว่างค่าดิบใน response กับป้ายที่ UI แสดง:

| Product ID | UI แสดง | `stock_status` | `review_status` | `can_added` | `stock_num` | `status_popup` |
|---|---|---|---|---|---|---|
| หน้า 1–2 ทุกรายการ | Active | `1` | `1` | `true` | มีค่า > 0 | **ไม่มี** |
| `1732246042498991343` | **Out of stock** | **`2`** | `1` | `true` | `0` | **ไม่มี** |
| `1736686332743353868` | **Unavailable** | `1` | **`4`** | `true` | **ไม่มี field** | `reason_code: 11` |
| `1735801266111940034` | **Unavailable** | `1` | **`4`** | `true` | `599992` | `reason_code: 14` |

**ข้อสรุปที่ปลอดภัยพอจะบันทึกได้:**

- `can_added` เป็น `true` **ทั้งหมด** รวมถึงสินค้าที่ UI บอกว่าไม่พร้อมใช้งาน → **ใช้ตัดสินไม่ได้**
- ป้าย "Unavailable" ไม่ได้มาจาก `stock_num` — สองรายการที่เป็น "Unavailable" มี `stock_num` ต่างกันสุดขั้ว
  (ไม่มี field เลย กับ `599992`)
- `status_popup` ปรากฏเฉพาะรายการที่ UI ขึ้น "Unavailable" (2/2) และไม่ปรากฏในรายการอื่นเลย

**เหตุผลที่ยัง _ไม่_ เติม `VERIFIED_STOCK_STATUS` / `VERIFIED_REVIEW_STATUS`:**

1. **ตัวอย่างน้อยเกินไป** — `stock_status=2` เห็นครั้งเดียว, `review_status=4` เห็นสองครั้ง
2. **ไม่รู้ขอบเขตของ enum ทั้งหมด** — ไม่ทราบว่ามีค่า `0`, `3`, `5`, … หรือไม่ และแปลว่าอะไร
3. **มีสมมติฐานที่แข่งกันอยู่และยังแยกไม่ออก** — ป้ายบน UI อาจมาจาก `review_status`, จาก `status_popup`,
   หรือจากทั้งคู่ร่วมกัน ข้อมูลเท่าที่มียังตัดตัวเลือกใดออกไม่ได้

ดังนั้น **ทุก enum ยังคงเป็น `unknown` ตาม V06** ตารางนี้เก็บไว้เป็นหลักฐานตั้งต้นให้ VA04 (Status semantics)
ไม่ใช่ข้อสรุป

### Image hosts ที่สังเกตได้

`p16-oec-sg.ibyteimg.com` · `p19-oec-sg.ibyteimg.com` · `p16-oec-va.ibyteimg.com` · `p19-oec-va.ibyteimg.com`

ทุก URL มี query params ที่ดูเหมือน signature/expiry (`dr`, `t`, `ps`, `shp`, `shcp`, `idc`, `from`)
**ยังไม่เติมลง `APPROVED_IMAGE_HOSTS`** จนกว่าจะตัดสินใจเรื่อง policy การเก็บ URL ที่มี signed params

---

## 2.2 หลักฐาน pagination ที่เก็บได้ (หน้า 1 → หน้า 2 → หน้าสุดท้าย)

| | หน้า 1 | หน้า 2 | หน้า 34 (สุดท้าย) |
|---|---|---|---|
| Query | `offset=0&count=6` | `offset=6&count=6` | `offset=198&count=6` |
| Status | `200 OK` | `200 OK` | `200 OK` |
| จำนวนที่ได้ | 6 | 6 | **3 (น้อยกว่า `count`)** |
| `data.total` | `201` | `201` | `201` (ไม่เปลี่ยนเลยทั้งสามหน้า) |
| Product ID (ตัวอย่าง) | `…075452`, `…452118`, `…298068`, `…858857` | `…257672`, `…723379`, `…969897`, `…351215` | `…991343`, `…353868`, `…940034` |
| ซ้ำกับหน้าก่อนหน้าไหม | — | **ไม่ซ้ำเลย** | **ไม่ซ้ำเลย** |

## 2.1 Pagination contract — ข้อความสัญญา หลักฐานที่รองรับ และข้อจำกัด

### ข้อความสัญญา (ณ 2026-09-20)

> Showcase list เป็น **offset pagination ล้วน** client เป็นฝ่ายกำหนด `offset` และ `count` เอง
> server ตอบ `data.products` กับ `data.total` แต่**ไม่ส่งตัวชี้หน้าถัดไปมาเลย** (ไม่มี `has_more`,
> `next_offset`, `cursor`) การเลื่อนหน้าคือ `offset := offset + จำนวนแถวที่ได้รับ`
> และการจบคือเมื่อ `offset + products.length ≥ total`

### หลักฐานที่รองรับแต่ละข้อ

| ข้อความในสัญญา | หลักฐาน | ระดับ |
|---|---|---|
| method/URL/พารามิเตอร์ | 3 requests: `offset=0`, `offset=6`, `offset=198` ทั้งหมด `count=6` → 200 OK | **observed** |
| server ยอมรับ offset ที่ client เลื่อนเอง | หน้า 2 (`offset=6`) คืนชุดใหม่ ไม่ทับหน้า 1 | **observed** |
| หน้าถัดไปไม่มีแถวซ้ำกับหน้าก่อน | เทียบ Product ID ข้ามทั้ง 3 หน้า ไม่ซ้ำเลย | **observed** |
| ไม่มี `has_more`/`next_offset`/`cursor` | ตรวจส่วนท้ายของ `data` ทั้ง 3 หน้า พบเฉพาะ `total` กับ `show_trend` | **observed** |
| `total` คงที่ระหว่างสแกน | `201` เท่ากันทั้ง 3 หน้า | **observed (แค่ช่วงเวลาสั้น ๆ ในรอบเดียว)** |
| `offset + products.length ≥ total` คือจุดจบ | `198 + 3 = 201 = total` (จาก **full capture** ของหน้า 34 — ก่อนหน้านี้ capture ถูกตัดที่สินค้าตัวที่ 2/3 ต้องอาศัย UI ยืนยันจำนวน ตอนนี้พิสูจน์ตรงจาก response body เต็ม) และ UI ไม่มีหน้าที่ 35 | **observed สำหรับกรณีเดียวนี้** — ดู `tests/contract/observed-showcase-contract.test.ts` |

### ข้อจำกัดของสัญญานี้ — สิ่งที่ยังไม่มีหลักฐาน

1. **พฤติกรรมเมื่อ offset เลยขอบเขต** (เช่น `offset=204`) — ไม่ทราบว่าได้ `products: []`, error, หรืออย่างอื่น
   UI ไม่มีทางไปหน้าเกิน 34 และการยิง request เองอยู่นอกขอบเขตรอบนี้ → adapter ต้องรับมือทั้งสองแบบ
2. **`total` ที่เปลี่ยนหรือขัดแย้งกลางคัน** — สังเกตในรอบเดียวที่ข้อมูลนิ่ง ไม่ทราบว่าถ้าผู้ขายลบสินค้า
   ระหว่างสแกนจะเกิดอะไร ทดสอบไว้ด้วย fixture **สังเคราะห์** เท่านั้น
3. **`count` ค่าอื่นนอกจาก 6** — ดู §1
4. **`total` ที่เป็น 0 หรือ Showcase ว่าง** — ไม่เคยสังเกตเห็น

### ช่องว่างระหว่างสัญญากับโค้ดที่มีอยู่ — **ปิดแล้วทั้งสองข้อ** (2026-09-20 รอบ offline)

บันทึกไว้ตอนแรกว่าเป็น "งานของ live adapter" แต่ทั้งสองข้อแก้ได้จริงในชั้น domain/core ล้วน ๆ
จาก evidence fixtures ที่มีอยู่แล้ว **ไม่ต้องมี network หรือ live adapter เลย** จึงแก้ในรอบนี้

**ช่องว่างที่ 1 — `decideAdvance` ไม่ใช้ `total` — ปิดแล้ว**

`extension/src/core/pagination.ts` เพิ่มเงื่อนไข `offset + rawRowCount ≥ total` เข้าไปแล้ว (ก่อน
เงื่อนไข `next_offset` ที่ยังต้องรอ `G0_VERIFIED`) ใช้ได้ทันทีเพราะ `total` เป็น field ที่ยืนยันแล้วว่า
มีอยู่จริงทุกหน้าที่สังเกตได้ ต่างจาก `has_more`/`next_offset` ที่ไม่เคยพบว่ามีอยู่จริงเลย

พิสูจน์ด้วยของจริงโดยตรงใน `tests/contract/observed-showcase-contract.test.ts` — ป้อนหน้า 34
(full capture) เข้า `decideAdvance` แล้วได้ `{kind: 'endpoint_end'}` ถูกต้อง (ก่อนแก้เคยได้ `continue`)
และยืนยันว่าหน้า 1/2 (ยังไม่ถึง total) ยังเดินต่อตามปกติ ไม่จบก่อนเวลา

**อัปเดต (รอบ offline adapter-prep เดียวกัน, ต่อจากรอบแรก):** พฤติกรรมเมื่อ `total` เปลี่ยน/ขัดแย้ง
กลางคัน**ปิดช่องว่างแล้วเช่นกัน** — เดิมโค้ดเคย "จบทันทีที่ถึงเกณฑ์ใหม่" อย่างเงียบ ๆ ตอนนี้แยกเป็น
`conflict` 4 แบบชัดเจน (ยังคงเป็นแนวทางอนุรักษนิยม: หยุดเสมอ ไม่เดา ไม่แก้ `total` เอง ไม่เริ่มสแกนใหม่เอง):

| สถานการณ์ | ผลลัพธ์ |
|---|---|
| `total` เปลี่ยนค่าข้ามหน้า (เพิ่มหรือลด) ของ run เดียวกัน | `conflict: total_changed` |
| `total` เคยมีแล้วหายไป/ผิดชนิดในหน้าถัดมา | `conflict: total_disappeared` |
| `offset + rawRowCount` **เกิน** `total` (ไม่ใช่แค่ถึงพอดี) | `conflict: total_exceeded` |
| ได้หน้าว่างทั้งที่ `offset` ยังไม่ถึง `total` | `conflict: empty_page_but_total_not_reached` |
| `total=0` และ `products=[]` ตั้งแต่หน้าแรก | `endpoint_end` ปกติ (Showcase ว่างจริง ไม่ใช่ error) |

ทั้งหมดยัง**สังเคราะห์ล้วน ไม่เคยพบจากของจริง** — ทดสอบไว้ทั้งระดับ unit
(`tests/contract/pagination-contract.test.ts`) และระดับ runner เต็มรูปแบบ (`tests/unit/runner.test.ts`
describe "pagination_conflict — total เปลี่ยนกลางคัน") ที่พิสูจน์ว่าหยุดจริง ไม่ falsely complete
ไม่วนไม่จบ และข้อมูลที่ commit ไปแล้วก่อนเจอ conflict ยังอยู่ครบ (commit เกิดก่อน `decideAdvance` เสมอ)

**ช่องว่างที่ 2 — `normalizeProduct` อ่านชื่อ field ที่ไม่มีอยู่จริง — ปิดแล้ว**

`extension/src/domain/product.ts` แก้ให้อ่านชื่อจริงแล้ว:

| เดิมอ่าน (ผิด) | แก้เป็น (ชื่อจริงใน response) |
|---|---|
| `price` | `format_available_price` |
| `stock` | `stock_num` |
| `image` | `cover.url_list[0]` (รูปแรกจาก object ลูก — ไม่ใช่ `images[]` ซึ่งยังไม่ได้ใช้) |
| `shop_name` | `seller_info.shop_name` |
| `commission_rate` | `affiliate_info.commission_rate` |

`extension/src/domain/page.ts` (`KNOWN_FIELDS`) แก้ตามให้ตรงกัน — field ที่ยังไม่ได้ใช้จริง
(`category_info`, `labels`, `is_hide`, `source`, `images` ฯลฯ) ยังคงเข้า `schemaInventory` ตามเดิม (V10)

**การเปลี่ยนแปลงย่อยที่ตามมา:** `commissionRate` เปลี่ยน type จาก `string | null` เป็น
`number | string | null` เพราะค่าจริงเป็นตัวเลข (เก็บแบบ raw passthrough ไม่ตีความหน่วย เหมือน
`stockStatusRaw`/`reviewStatusRaw` — หน่วยของ `commission_rate` ยังไม่ยืนยัน ดู §4)
`imageUrl` **ยังคงเป็น `null` เสมอ** แม้ path จะถูกแล้ว เพราะ `APPROVED_IMAGE_HOSTS` ยังว่างโดยตั้งใจ
(V08 — เป็นการตัดสินใจเชิงนโยบายที่แยกจากเรื่อง mapping และยังไม่ทำรอบนี้) ต่างจากก่อนแก้ตรงที่ตอนนี้
รายการที่มีรูปจะได้ warning `image_url_rejected` ที่ถูกต้อง แทนที่จะเงียบเหมือนไม่มีรูปเลย

ยังพบและแก้ mock adapter ของ dashboard (`extension/src/adapters/mock-showcase.ts`) ที่ใช้ชื่อ field
ผิดแบบเดียวกัน — ถ้าไม่แก้ demo ใน dashboard จะโชว์ราคา/สต็อก/ร้าน/รูปเป็นค่าว่างหมดหลังแก้ normalizer

พิสูจน์ทั้งหมดไว้ใน `tests/contract/observed-showcase-contract.test.ts` (เทียบค่าที่ normalizer คืน
กับค่าดิบในไฟล์ตรง ๆ ไม่ hardcode) รวมถึง unit tests เดิมทั้งชุด (`tests/unit/product.test.ts`,
`tests/unit/pagination.test.ts`, `tests/unit/runner.test.ts`) ที่ปรับ fixture ให้ใช้ชื่อ field จริงแล้ว

### ตรวจแล้ว — เก็บ/export เฉพาะ field ที่จำเป็น (ส่วนหนึ่งของ G0 checklist ข้อ 5)

- `NormalizedProduct` (allowlist การ export ตาม V10) มี field ตรงกับ spec §8.1 ครบ บวก `commissionRate`
  ซึ่งมีที่มาจาก V09 + UT05 ที่ระบุชัดว่าเป็น field ที่ต้องมี ไม่มี field อื่นเกินมา
- `ExportPayload` (`extension/src/export/json.ts`) ไม่เปลี่ยน — ยังเป็น allowlist เดิม ไม่มี raw body/headers
- `schemaInventory` เก็บเฉพาะ**ชื่อ** field ที่ไม่รู้จัก ไม่เก็บค่า (ตรวจโค้ดแล้วในรอบนี้)
- `QuarantinedRow` เก็บแค่ `index` + `reasons` ไม่มี raw row เลย
- `imageUrl`/`shopName`/`commissionRate` ที่ normalizer อ่านตอนนี้ ดึงเฉพาะ field เดียวจาก object ลูก
  ไม่ใช่ทั้ง `seller_info`/`affiliate_info`/`cover` object — ไม่มีการ leak field ข้างเคียงที่ไม่ต้องการ

## 3. Gate G0 checklist (spec §5.3)

- [x] **ยืนยัน endpoint/method จากบัญชีจริง** — `GET .../showcase_product/list?offset=0&count=6` → 200 OK พร้อม response body จริง
      (ไม่ใช่ screenshot อย่างเดียว)
- [x] **มี sanitized fixture อย่างน้อย success, page-next, endpoint-end** — **ครบทั้งสามกรณี เป็น full capture**
      · success (หน้า 1, `offset=0`) = 6/6 รายการ
      · page-next (หน้า 2, `offset=6`) = 6/6 รายการ (เดิมไม่มีเลย)
      · endpoint-end (หน้า 34, `offset=198`) = 3/3 รายการ (เดิมเป็น partial 2/3)
      ทั้งสามไฟล์ยืนยันเงื่อนไขจบของ pagination ได้โดยตรงแล้ว (`198+3=201=total`)
      ดู `tests/fixtures/observed/PROVENANCE.md` §2
- [x] **รู้ page size ที่เว็บใช้อยู่จริง และวิธีเลื่อนตำแหน่งที่ server ยอมรับ** — `count=6` และ `offset` เลื่อนทีละ `+count`
      โดย client คำนวณเอง; ยืนยันแล้วด้วยหน้า 2 (`offset=6` → 200 OK, ข้อมูลชุดใหม่ ไม่ทับหน้าแรก, `total` คงที่)
      · *ขอบเขต*: ยืนยันเฉพาะ `count=6` ค่าอื่นยัง unknown (§1)
- [x] **รู้ลักษณะ Product ID ก่อนผ่าน JSON parser** — เป็น **string ที่มี quote ครอบ** 19 หลัก ไม่ใช่เลขเปล่า
      ยืนยันซ้ำด้วย contract test ที่อ่าน byte ดิบจาก fixture
- [x] **เก็บเฉพาะ fields ที่จำเป็น; ระบุ unknowns ใน data dictionary** — data dictionary §2 ครบแล้วเท่าที่หลักฐานมี
      unknowns อยู่ใน §4 ครบ และตอนนี้มีโค้ดที่เลือก field จริงแล้ว (`normalizeProduct`/`KNOWN_FIELDS`
      แก้ให้ตรงกับ observed evidence ในรอบนี้ — ดู §2.1) ตรวจแล้วว่า export ไม่มี field เกินความจำเป็น
      (ดู "ตรวจแล้ว — เก็บ/export เฉพาะ field ที่จำเป็น" ด้านบน)
- [ ] **ตรวจความเหมาะสมในการใช้ internal API และสิทธิ์บัญชี** — **ตรวจเอกสารแล้ว (2026-09-20) — ยัง
      ไม่ติ๊ก PASS เพราะผลคือ "ยังไม่ได้รับอนุญาต" ไม่ใช่ "ตรวจแล้วผ่าน"** ดู §3.1

**G0 ยังไม่ผ่าน** — ติ๊กได้ 5 จาก 6 · เหลือข้อเดียว ซึ่งตอนนี้**ตรวจเอกสารแล้วและมีคำตอบชัดเจน**ว่ายัง
ไม่ได้รับอนุญาต ไม่ใช่แค่ "ยังไม่มีข้อมูล" อีกต่อไป (ดู §3.1) · `G0_VERIFIED` คงเป็น `false`

## 3.1 สิทธิ์บัญชีและความเหมาะสม — สถานะ **ตรวจเอกสารแล้ว: ยังไม่ได้รับอนุญาต**

checklist ข้อนี้มีสองคำถามที่ **ต้องแยกกัน** การตอบข้อแรกไม่ได้ตอบข้อที่สอง

### คำถามที่ 1 — ผู้ใช้มีสิทธิ์เข้าถึงข้อมูลนี้หรือไม่

**สถานะ: มีหลักฐานสนับสนุน**

| หลักฐาน | ที่มา |
|---|---|
| ผู้ใช้เปิด Showcase ของตนเองผ่าน UI ปกติของ TikTok และเห็นข้อมูลครบ | สังเกตโดยตรงตอนเก็บหลักฐาน |
| request มาจากเซสชันที่ผู้ใช้ล็อกอินด้วยบัญชีตนเอง ผ่านหน้าเว็บของ TikTok เอง | สังเกตโดยตรง |
| ข้อมูลที่ได้เป็นรายการสินค้าใน Showcase ของบัญชีนั้น ไม่ใช่ของบัญชีอื่น | เทียบ Product ID กับที่ UI แสดง |

→ **ผู้ใช้เห็นข้อมูลนี้ได้อยู่แล้วโดยชอบ** ข้อนี้ไม่ใช่ปัญหา

### คำถามที่ 2 — ได้รับอนุญาตให้เรียก internal API นี้โดยอัตโนมัติหรือไม่

**สถานะ: ตรวจเอกสารแล้ว (2026-09-20) — คำตอบคือ "ยังไม่ได้รับอนุญาต"**

**สิ่งที่ตรวจแล้ว ≠ สิ่งที่ได้รับอนุญาต** — สองอย่างนี้แยกกันตลอดหัวข้อนี้:
- "ตรวจเอกสารแล้ว" = อ่านและบันทึกสิ่งที่เอกสารเขียนไว้จริง (ทำแล้ว ดูด้านล่าง)
- "ได้รับอนุญาตแล้ว" = TikTok อนุมัติการเข้าถึงแบบอัตโนมัตินี้เป็นลายลักษณ์อักษร (**ยังไม่เกิดขึ้น**)

#### เอกสารที่ตรวจ

| รายการ | ค่า |
|---|---|
| ชื่อเอกสาร | TikTok Shop Creator Terms of Use |
| ขอบเขต | Thailand (base global document + Thailand jurisdiction addendum ใน §25) |
| แก้ไขล่าสุด | 15 กรกฎาคม 2025 |
| มีผลบังคับใช้ | 31 กรกฎาคม 2025 |
| URL | https://seller-th.tiktok.com/university/essay?knowledge_id=4128072518190849&lang=en |
| วิธีเก็บ | ดึงเนื้อหาผ่าน WebFetch (แปลง HTML→markdown แล้วประมวลผลด้วย AI model) 3 ครั้งแยกกัน ไม่ใช่ล็อกอินหรือใช้ session ของผู้ใช้ |

#### ข้อความที่เกี่ยวข้องโดยตรง

พบข้อห้ามการเข้าถึงแบบอัตโนมัติใน **Section 8 ("Your use of TikTok Shop API")** และ
**Section 12 ("What is your responsibility?")** — ข้อความที่ตรงกันในทั้งสามครั้งที่ดึงข้อมูล:

> "you must not use any bot, spider, scraper, data mining or extraction tools, or any other
> automated means of access to the TikTok Platform or TikTok Shop **unless you have our express
> written permission to do so**"

และใน Section 8 เพิ่มเติม:

> "You may not... use any robot, spider, site search or retrieval application, or other device
> to collect information about users of the TikTok Shop for any unauthorised purposes"

Thailand-specific addendum (§25.B) แก้เฉพาะเรื่องอายุขั้นต่ำของ Creator ไม่ได้แก้ไขหรือผ่อนปรน
ข้อห้ามข้างต้นแต่อย่างใด

#### ข้อจำกัดของหลักฐานชิ้นนี้ — ต้องรู้ก่อนใช้

- **WebFetch ไม่ใช่การคัดลอกต้นฉบับ 100%** — เป็นเครื่องมือที่แปลง HTML แล้วให้ AI model สรุป/ดึงข้อความ
  การดึงครั้งที่ 2 และ 3 ระบุเลขมาตรา (Section 8 vs 12) ของประโยคเดียวกันไม่ตรงกันเป๊ะ แม้ **เนื้อหาสาระ**
  (ห้าม automated access โดยไม่มี express written permission) จะตรงกันทั้งสามครั้ง
- **แนะนำให้เจ้าของโปรเจกต์เปิดลิงก์ข้างต้นแล้วอ่าน Section 8 และ 12 ด้วยตนเอง** เพื่อยืนยันเลขมาตรา
  และบริบทแวดล้อมที่แน่นอน ก่อนใช้เป็นฐานการตัดสินใจขั้นสุดท้ายใด ๆ — เอกสารนี้บันทึกสิ่งที่พบ ไม่ใช่
  คำรับรองว่าเป็นข้อความที่ถูกต้อง 100%
- ยังไม่ได้ตรวจเอกสารอื่นที่อาจเกี่ยวข้อง (เช่น TikTok Shop Partner/Open API terms, TikTok ToS ทั่วไป
  นอกเหนือจาก Creator Terms) — ตรวจเฉพาะเอกสารที่ระบุไว้ในคำสั่งรอบนี้เท่านั้น

#### สิ่งที่ยังไม่มีเหมือนเดิม

| สิ่งที่ต้องมี | มีหรือยัง |
|---|---|
| ข้อความใน ToS ระบุจุดยืนต่อ automated access | **มีแล้ว** — ห้าม เว้นแต่มี express written permission (ด้านบน) |
| หลักฐานว่า endpoint นี้เป็น public/documented API ไม่ใช่ internal ของหน้าเว็บ | **ไม่มี** — path ชื่อ `streamer_desktop` บ่งว่าเป็น internal ของ UI |
| API ทางการที่ทำงานเดียวกันได้ (ถ้ามี ควรใช้แทน) | **ยังไม่ได้สำรวจ** |
| จุดยืนต่อ rate limit / robots / anti-automation โดยเฉพาะ | **ยังไม่ทราบเพิ่มเติมจากข้อความข้างต้น** |
| express written permission จาก TikTok สำหรับการใช้งานนี้ | **ยังไม่ได้ขอ** |

**สิ่งที่นับเป็นหลักฐาน และสิ่งที่ไม่นับ:**

- ❌ การที่ผู้ใช้ตอบว่า "ยอมรับ" หรือ "ทำต่อได้เลย" — **ไม่ใช่หลักฐาน** ข้อนี้ถามถึงสิ่งที่ TikTok อนุญาต
  ไม่ใช่สิ่งที่ผู้ใช้ยินดีรับความเสี่ยง ความยินยอมของผู้ใช้ปิด checklist ข้อนี้ไม่ได้
- ❌ การที่ request ทำงานได้และคืน 200 OK — เป็นหลักฐานทางเทคนิค ไม่ใช่หลักฐานเรื่องสิทธิ์
- ❌ การที่ Triple Bot ทำแบบนี้อยู่ — ไม่ได้แปลว่าได้รับอนุญาต
- ✅ ข้อความจากเอกสารสัญญา/นโยบายของ TikTok เอง — **มีแล้ว ระบุชัดว่าห้ามโดยไม่มี express permission**
- ✅ การมีอยู่ของ API ทางการที่ทดแทนได้ — ยังไม่พบ

#### คำถามร่างไว้ให้เจ้าของโปรเจกต์สอบถาม TikTok (ร่างเท่านั้น — ไม่ส่งแทน)

> Hi TikTok Shop team,
>
> I'm a TikTok Shop Creator in Thailand. I'd like to build a personal browser extension that reads
> the product list from my own Showcase (the one shown under "Add product links" when uploading a
> video), so I can export it as a local JSON file — read-only, no automated posting, no bulk
> actions, single account.
>
> I understand the Creator Terms (Section 8/12) prohibit automated access without your express
> written permission. Could you let me know:
> 1. Whether this kind of read-only, single-account, personal-use automation is something I can
>    request permission for, and what the process is.
> 2. Whether TikTok Shop has an official/documented API that already covers reading a Creator's own
>    Showcase product list, which I should use instead of the internal endpoint the web app calls.
>
> Thank you.

**ผลต่อ gate:** ข้อนี้ตอบแล้วว่า **"ยังไม่ได้รับอนุญาต"** (ไม่ใช่ "ไม่ทราบ" เหมือนก่อนหน้านี้) —
**G0 ยังผ่านไม่ได้** จนกว่าจะได้รับ express written permission จาก TikTok จริง หรือพบ API ทางการที่
ใช้แทนได้ `G0_VERIFIED` ยังคงเป็น `false` และจะไม่เปลี่ยนจนกว่าจะมีหลักฐานการอนุญาตจริง ไม่ใช่แค่
การตรวจเอกสารเสร็จ

---

## 4. Unknowns ที่ยังเปิดอยู่ (spec §17)

| คำถาม | สถานะหลังรอบนี้ | ผลถ้าตอบไม่ได้ |
|---|---|---|
| response มี field อะไรทั้งหมด | **ตอบได้เกือบครบ** — ดู §2 รวมส่วนท้ายของ `data` แล้ว; ที่ยังไม่รู้คือ field ที่อาจโผล่เฉพาะในสถานะที่ยังไม่เคยเจอ | normalizer map ได้ครบตามที่เห็น แต่ต้องทนต่อ field ที่ไม่รู้จัก |
| มี identity ที่ไม่เป็น secret หรือไม่ | **ยังไม่พบเลย** ในส่วนที่เห็น (`seller_info` เป็นของผู้ขายแต่ละราย ไม่ใช่บัญชีผู้ใช้) | บังคับหนึ่งบัญชีต่อ profile + label unverified |
| page-end contract คืออะไร (`has_more`/`next_offset`/cursor) | **ตอบแล้ว** — ทั้งสาม field ไม่มีอยู่จริง มีแค่ `data.total`; ยืนยันด้วย **full capture** หน้า 1/2/34 แล้วว่าจุดจบคือ `offset + products.length ≥ total` (198+3 = 201 พอดี) · เหลือเฉพาะกรณี offset เลยขอบเขตที่ยังไม่ทราบ | แยก `reached_endpoint_end` จาก `partial` ได้แล้วสำหรับเส้นทางปกติ — `decideAdvance` implement เงื่อนไขนี้แล้ว (ดู §2.1) รวมถึง fault handling เมื่อ `total` ขัดแย้งด้วย |
| page size 50 รองรับหรือไม่ | **unknown** — สังเกตเห็นแต่ `count=6` (baseline ที่มีหลักฐาน) การไม่เห็นค่า 50 **ไม่ใช่**การหักล้างว่าใช้ไม่ได้ การทดสอบต้องยิง request เอง ซึ่งนอกขอบเขตรอบนี้ | ใช้ `count=6` ไปก่อน · VA10 ยังเป็น optional optimization ที่เปิดค้างไว้ ไม่ใช่ข้อที่ตัดทิ้งแล้ว |
| status enum ค่าไหนพิสูจน์แล้ว | **ยังไม่มีค่าใดยืนยัน** — มี observed pairing แล้ว (§2.3: `stock_status` พบ 1,2 · `review_status` พบ 1,4) แต่ตัวอย่างน้อย ไม่รู้ขอบเขต enum และแยกไม่ออกว่าป้าย UI มาจาก `review_status` หรือ `status_popup` | ทุกค่าเป็น `unknown` ตาม V06 |
| `status_popup.reason_code` มีค่าอะไรบ้าง | **ยังไม่ทราบทั้งหมด** — พบ `11` (ผู้ขายลบสินค้า) และ `14` (ไม่ใช่สินค้า affiliate แล้ว) | ไม่ใช้ตัดสินใจอัตโนมัติ เก็บเป็น raw |
| `affiliate_info` มี field อะไรบ้างที่การันตีได้ | **ไม่มีเลย** — พบรูปร่างต่างกัน 3 แบบ รวมถึงแบบที่มีแค่ `{est_commission_expense: "-"}` | ห้ามสมมติว่ามี field ครบ |
| cookie policy บน Brave ทำงานอย่างไร | **ยังไม่ทราบ** — หลักฐานรอบนี้เก็บจากหน้าเว็บปกติ ไม่ใช่จาก extension context | ไม่ทราบว่า fetch ใน extension จะแนบ session ได้หรือไม่ |
| `can_added` มีความหมายอะไรแน่ | **ยังไม่ทราบ** — พบแต่ `true` | `false` → `unknown` + warning ตาม §8.3 |
| หน่วยของ `commission_rate` | **ยังไม่ทราบ** — `1100`/`1200`/`1600` ดูเหมือน basis points แต่ยังไม่มีหลักฐานยืนยัน | ไม่ใช้ใน M1 |

---

## 5. สิ่งที่ **ไม่ใช่** หลักฐาน

- ค่า `count=50` ที่ spec §3.1 อ้างจาก source ของ Triple Bot — **หลักฐานรอบนี้ไม่ได้หักล้างและไม่ได้ยืนยัน**
  เราสังเกตเห็นแต่ `count=6` เท่านั้น ซึ่งบอกได้แค่ว่า 6 ใช้ได้ ไม่ได้บอกว่า 50 ใช้ไม่ได้ (ดู §1)
- ความหมายของ `stock_status=1` / `review_status=1` ที่ Triple Bot ใช้ — ยังเป็น assumption การเห็นค่า `1` ค่าเดียว
  ไม่ได้พิสูจน์ว่า `1` แปลว่าอะไร
- **พฤติกรรมของ `total` เมื่อเปลี่ยนหรือขัดแย้ง** — ที่ทดสอบไว้ใน `tests/contract/pagination-contract.test.ts`
  เป็น **synthetic ทั้งหมด** ไม่เคยพบจาก TikTok จริง (`total` คงที่ที่ `201` ตลอดทั้งสามหน้าที่สังเกตได้)
- **ตัวเลขที่ไม่ใช่ identity ถือเป็นค่านิ่ง** — พิสูจน์แล้วว่าไม่จริง: `stock_num` ของสินค้าเดิมเปลี่ยนระหว่าง
  สองรอบเก็บหลักฐานในวันเดียวกัน (34,687 → 34,662) และข้อความเปอร์เซ็นต์ส่วนลดก็เปลี่ยนเช่นกัน
  (`"59% off"` → `"54% off"`) ดู `tests/fixtures/observed/PROVENANCE.md` §4
- **seller_id ที่ sanitize แล้วตรงกันข้ามไฟล์** — **ไม่ใช่หลักฐานว่าเป็นร้านเดียวกัน** ตัวนับของ script
  sanitize รีเซ็ตทุกไฟล์ เทียบข้ามไฟล์ไม่ได้ (ดู PROVENANCE §3)

---

## 6. Live adapter — implement แล้วในโหมด offline-only (2026-09-20 รอบที่สอง+สาม)

เตรียมตัวเชื่อมต่อ TikTok สำหรับการทดลองอ่านหนึ่งหน้าในอนาคต **ทุกรอบเขียนโค้ดและทดสอบแบบ
offline ล้วน ไม่เคยเรียก TikTok จริงแม้แต่ครั้งเดียว** — `G0_VERIFIED` คงเป็น `false` ตลอดทุกรอบ
รอบที่สาม (§7) เพิ่มการตรวจเอกสารสิทธิ์ + เตรียม adapter.probe + ช่องทางให้สิทธิ์จาก UI

### สิ่งที่ implement และทดสอบแล้ว (ด้วย fake transport/permission checker เท่านั้น)

| ส่วน | ไฟล์ | ทดสอบด้วย |
|---|---|---|
| ประกอบ request (hostname/path/offset/count) | `extension/src/adapters/live-showcase.ts` (`buildShowcaseRequest`) | `tests/unit/live-showcase.test.ts` |
| แปล transport outcome → `ShowcaseAdapter` contract | เช่นเดียวกัน (`createLiveShowcaseAdapter`) | เช่นเดียวกัน |
| ตรวจ host permission ก่อนยิง request ทุกครั้ง | เช่นเดียวกัน | เช่นเดียวกัน (`describe: permission prerequisite`) |
| transport จริง: fetch + credentials/cache/redirect + timeout + streaming body cap | `extension/src/adapters/live-transport.ts` | `tests/unit/live-transport.test.ts` (inject `fetchImpl` ปลอม) |
| gate ปฏิเสธก่อนออก network เสมอเมื่อ G0 ไม่ผ่าน | `extension/src/adapters/resolve.live.ts` | `tests/unit/resolve-live.test.ts` |
| แยก `challenge_required` (HTML login/CAPTCHA) จาก `schema_changed` | `extension/src/domain/envelope.ts` | `tests/unit/envelope.test.ts` |
| `classifyFailure` หยุดที่ challenge เหมือน auth/access denied | `extension/src/core/retry.ts` | `tests/unit/retry.test.ts` |
| runner แยก stop reason ของแต่ละ error (`redirect_blocked`, `permission_required`, `adapter_invalid_request`, `adapter_body_too_large`, network/timeout ที่ retry ได้) | `extension/src/core/runner.ts` | `tests/unit/runner.test.ts` (หลาย describe ใหม่) |
| pagination fault handling เมื่อ `total` ขัดแย้ง (4 แบบ) | `extension/src/core/pagination.ts` | ดู §2.1 |
| PK03 bidirectional isolation: live code ไม่หลุดเข้า mock bundle และย้อนกลับ | `tests/integration/pk02-pk03-build.test.ts` | build จริงทั้งสอง channel |

รวม **403/403 vitest ผ่าน** (จากเดิม ~352 ก่อนรอบนี้), typecheck ผ่าน, coverage gate exit 0
(7 ไฟล์ที่ gate ≥90% branch ทุกไฟล์), และ **E2E 15/15 ผ่านบนเบราว์เซอร์จริง** (mock channel —
พิสูจน์ว่าการแก้ runner.ts/pagination.ts ไม่กระทบ flow เดิมที่ทำงานอยู่แล้ว)

### สิ่งที่ยังไม่ได้ทดสอบกับ browser session จริง (สำคัญ — อย่าอ่านผิดว่าพร้อมใช้แล้ว)

> **ส่วนนี้ล้าสมัยบางข้อแล้ว** — การทดลองจริงเกิดขึ้นแล้วเมื่อ 2026-09-20 ดูผลใน **§8**
> ข้อที่ยังไม่ถูกพิสูจน์ถูกยกไปสรุปไว้ท้าย §8 แทน

- ~~ยังไม่เคยเรียก `fetch` จริงแม้แต่ครั้งเดียว~~ **พิสูจน์แล้ว (§8)** — `credentials:'include'` แนบ
  เซสชันได้จริงจาก service worker และได้ HTTP 200 พร้อม JSON จริง
- ~~ยังไม่เคยเรียก `chrome.permissions.contains` จริง~~ **แก้แล้ว (2026-09-20 รอบที่สาม)** — ตอนนี้มี
  E2E test (`tests/e2e/probe-and-permission.spec.ts`) ยืนยันบน Chrome จริงแล้ว และ
  ~~`chrome.permissions.request` ยังไม่เคยถูกคลิกจริง~~ **คลิกจริงแล้ว (§8)**
- **`challenge_required` ยังไม่เคยเจอ HTML จริงจาก TikTok** — logic อิง content-type header เป็น
  สมมติฐาน (spec FX09) ไม่ใช่ observed evidence เหมือนส่วนอื่นของเอกสารนี้ (ยังคงเป็นจริง)
- ~~ไม่เคยทดลองแม้แต่ 1 request จริงไปที่ endpoint~~ **ทดลองแล้ว 1 request โดยผู้ใช้กดเอง (§8)**

### ข้อจำกัด heartbeat/retry-wait — ยังไม่ได้จัดการ ยังต้องแก้ก่อนเปิดใช้งานจริง

ข้อจำกัดที่บันทึกไว้ใน [g1-signoff.md](g1-signoff.md) และ [README.md](../README.md) ("ข้อจำกัดที่ทราบ")
**ยังคงอยู่และยังไม่ได้แก้ในรอบนี้**: `store.heartbeat()` ต่ออายุ lease ครั้งละ `leaseTtlMs` (60 วินาที)
ขณะที่ `RETRY_POLICY.maxRetryAfterMs` ยอมให้รอได้ถึง 15 นาที (`rate_limited`/429) — การรอครั้งเดียวที่ยาว
ยังทำให้ lease หมดอายุกลางคันได้ในทางทฤษฎี **ตอนนี้ยิ่งเกี่ยวข้องมากขึ้น** กว่ารอบก่อน เพราะ live adapter
implement แล้วจริง (แม้จะยัง gate ด้วย G0_VERIFIED อยู่) — เมื่อ G0 ผ่านและเริ่มทดลองหนึ่งหน้าจริง
กรณี 429 จาก TikTok จริงจะทำให้เจอช่องว่างนี้ได้ทันที ไม่ใช่แค่ทฤษฎีอีกต่อไป **ต้องแก้ก่อนเปิดใช้งาน
ส่วนที่เกี่ยวข้องกับ retry-after ที่ยาวเกิน heartbeat interval**

### G0 checklist และ gate — ข้อ 6 มีความคืบหน้าจริงแล้ว (2026-09-20 รอบที่สาม)

- **G0 checklist ข้อ 6 ไม่ใช่ `unresolved` ลอย ๆ อีกต่อไป** — ตรวจเอกสาร TikTok Shop Creator Terms
  แล้ว พบข้อห้าม automated access โดยไม่มี express written permission ชัดเจน (ดู §3.1) คำตอบตอนนี้
  คือ **"ยังไม่ได้รับอนุญาต"** ซึ่งเป็นคำตอบที่ชัดกว่า "ไม่ทราบ" แต่ก็**ยังไม่ผ่าน gate** เหมือนเดิม —
  ผ่านได้ก็ต่อเมื่อได้รับอนุญาตจริงเท่านั้น ไม่ใช่แค่ตรวจเอกสารเสร็จ
- **`G0_VERIFIED` ยังเป็น `false`** ใน `extension/src/domain/version.ts` — ไม่มี override/debug switch
  ใด ๆ ถูกเพิ่มเข้ามาเพื่อข้าม gate นี้เลย พิสูจน์ด้วย `tests/unit/resolve-live.test.ts`
- **ไม่มีการเชื่อมต่อ TikTok จริงเกิดขึ้นเลยตลอดทั้งสามรอบ** — ยืนยันด้วย network-deny guard (R15) ที่ยังคง
  ผ่านทุก test รวมถึง test ของ live adapter เองที่ inject fake transport ทุกที่ และ E2E ที่รันจริงบน Chrome

### สิ่งที่เพิ่มในรอบที่สาม (2026-09-20) — เตรียม adapter.probe และช่องทางให้สิทธิ์

**adapter.probe ตรวจแล้วและแก้ให้ตรงข้อกำหนด** (`extension/src/messaging/handle.ts`):
- ยิงหนึ่ง request เดียวเสมอ — **ยืนยันแล้วว่าไม่ใช้ lease หรือ retry machinery ของ `run.*` เลย** ทั้งจาก
  โครงสร้างโค้ด (`ProbeContext` มีแค่ `sourceRef`/`now` เข้าถึง `store`/`registry`/`sleep` ไม่ได้จริง) และ
  ยืนยันซ้ำด้วย unit test ว่ายิงแค่ 1 ครั้งแม้เจอ error ที่ปกติ retry ได้ (เช่น 500)
  → **heartbeat/retry-wait limitation ไม่บล็อก probe นี้** แต่ยังเป็นงานค้างก่อนเปิด full scan ที่ใช้
  retry wait จริง (ดู "ข้อจำกัด heartbeat/retry-wait" ด้านบน)
- 401/403/429/challenge (HTML) ตอนนี้หยุดทันทีพร้อม `outcome` บอกเหตุผลชัดเจน ไม่ normalize ต่อ
- คืนรายการ normalized products จริง พร้อม `resultKind: 'single_page_probe'` กำกับชัดว่าไม่ใช่ผลสแกนครบ
- ไม่มี header/cookie/token หลุดออกมา — ตรวจซ้ำด้วย unit test ที่ยัด canary header เข้าไปโดยเจตนา

**เพิ่มช่องทางให้สิทธิ์จาก user gesture** (`extension/src/dashboard/index.html` + `main.ts`):
- ปุ่ม "อนุญาตให้เข้าถึง shop.tiktok.com" ใน dashboard เรียก `chrome.permissions.request` จาก
  click handler โดยตรง (ไม่ผ่าน background message) — ขอสิทธิ์แค่ origin เดียวตาม
  `optional_host_permissions` ของ manifest เป๊ะ (มี unit test กันไม่ให้ค่าต่างจาก manifest — drift guard)
- background.js **ยังไม่มีทางขอสิทธิ์เองเลย** — ยืนยันด้วย static check เดิมของ PK02 ที่ยังผ่านอยู่

**ทดสอบแล้วด้วย mocks/สภาพแวดล้อมควบคุมทั้งหมด ตาม G0_VERIFIED=false**: unit tests (fake adapter/ctx)
+ E2E บน Chrome จริงกับ mock build (`tests/e2e/probe-and-permission.spec.ts`) — **ไม่มี request ไป
TikTok เกิดขึ้นเลย** ยืนยันซ้ำในทั้งสองระดับ

### สรุปความพร้อมของ live adapter

**พร้อมระดับโค้ด/สถาปัตยกรรมมากขึ้นกว่าเดิม แต่ยังไม่พร้อมเชื่อมจริง** สิ่งที่จำเป็นก่อนทดลองอ่านหนึ่งหน้าจริงได้:

1. **ปิด G0 checklist ข้อ 6** — ตอนนี้รู้แล้วว่าต้องขอ express written permission จาก TikTok (คำถามร่าง
   ไว้ใน §3.1 แล้ว ยังไม่ได้ส่ง) เมื่อได้รับอนุญาตจริงแล้วเปลี่ยน `G0_VERIFIED = true`
2. **แก้ข้อจำกัด heartbeat/retry-wait** ก่อนเปิด full scan (`run.start`) — ไม่บล็อก `adapter.probe`
3. **ทดลองบน browser จริงครั้งแรกด้วย `adapter.probe`** (ไม่ใช่ `run.start`) — เส้นทางนี้ตรวจสอบและ
   ปรับปรุงพร้อมแล้วในรอบนี้ (หยุดถูกต้องที่ 401/403/429/challenge, ไม่ retry, แสดงผล normalized ชัดเจน
   ว่าเป็นผลหนึ่งหน้า) เหลือแค่การได้รับอนุญาตจริงและกดปุ่ม "อนุญาต" ในเบราว์เซอร์ก่อน
4. ทดสอบปุ่ม "อนุญาตให้เข้าถึง shop.tiktok.com" กับ native permission prompt จริงบนเบราว์เซอร์
   (ยังไม่เคยทดสอบเพราะ automation กดผ่าน native dialog ไม่ได้อย่างน่าเชื่อถือ — ต้องเป็นการกดจริงของ
   เจ้าของโปรเจกต์เอง)

---

## 7. เปลี่ยนขอบเขต: จาก offline-only → ทดลอง manual หนึ่งหน้า (2026-09-20 รอบที่สี่)

> **หมายเหตุ:** ขอบเขตถูกขยายอีกครั้งในรอบที่หกของวันเดียวกัน ดู **§9** — ตารางในหัวข้อนี้บันทึก
> สถานะ ณ รอบที่สี่ เก็บไว้เป็นประวัติ ไม่ใช่สถานะปัจจุบัน

**นี่คือการเปลี่ยนขอบเขตที่เจ้าของโปรเจกต์สั่งอย่างชัดแจ้ง ไม่ใช่ debug bypass และไม่ใช่การอ้างว่า
gate ผ่านแล้ว** — บันทึกไว้ที่นี่เพื่อให้ตามรอยได้ว่าใครอนุญาตอะไร เมื่อไร และครอบคลุมแค่ไหน

### สิ่งที่เปลี่ยน

| ก่อนหน้า | ตอนนี้ |
|---|---|
| ทุกเส้นทางที่แตะ network ถูกปิดด้วย `G0_VERIFIED` ค่าเดียว | แยกเป็นสามค่าที่ตอบคนละคำถาม (ดูตารางด้านล่าง) |
| live build ใช้งานไม่ได้เลย (ทุก message ล้มเพราะ gate) | live build ใช้ส่วนที่ไม่แตะ network ได้ + กดทดลองหนึ่งหน้าได้ |
| ไม่เคยยิง TikTok จริงเลย | **ยังไม่เคยยิงจากฝั่ง AI/automation เลย** — ผู้ใช้เป็นผู้กดเองเท่านั้น |

### สามค่าที่แยกกัน (`extension/src/domain/version.ts`)

| ค่า | สถานะ | หมายความว่า |
|---|---|---|
| `G0_TECHNICAL_EVIDENCE_COMPLETE` | `true` | หลักฐานเทคนิคตาม §5.3 ข้อ 1–5 ครบแล้ว (§1–§3 ของเอกสารนี้) |
| `OWNER_MANUAL_PROBE_AUTHORIZED` | `true` | เจ้าของโปรเจกต์อนุญาตให้ทดลองอ่านหนึ่งหน้าบนบัญชีตนเองในรอบนี้ |
| `TIKTOK_AUTOMATED_ACCESS_AUTHORIZED` | **`false`** | **TikTok ยังไม่อนุญาต** — ToS §8/§12 ต้องมี express written permission ซึ่งยังไม่ได้ขอ (§3.1) |
| `G0_VERIFIED` (gate รวมของ full scan) | **`false`** | ยังไม่ผ่าน เพราะข้อข้างบนยังเป็น false |

**ค่าที่เกี่ยวกับ TikTok ไม่ถูกแตะเลย** — ยังบันทึกตามหลักฐานเดิมใน §3.1 ว่า "ยังไม่ได้รับอนุญาต"
การที่เจ้าของโปรเจกต์ยอมรับความเสี่ยงเพื่อทดลองด้วยตนเอง **ไม่ได้แปลว่า TikTok อนุญาต** และไม่ถูก
บันทึกเป็นอย่างนั้นที่ใดในเอกสารนี้

### gate แยกตาม purpose (`extension/src/adapters/resolve.live.ts`)

| purpose | เงื่อนไข | สถานะ | ใช้กับ message |
|---|---|---|---|
| `metadata_only` | ไม่มี (ยิง request ไม่ได้อยู่แล้ว) | เปิด | `app.info`, `status.get`, `run.status`, `run.export`, `data.clear` |
| `manual_probe` | หลักฐานเทคนิคครบ + เจ้าของโปรเจกต์อนุญาต | **เปิดในรอบนี้** | `adapter.probe` |
| `full_scan` | `G0_VERIFIED` | **ยังปิด** | `run.start` |

ทั้งสามค่าเป็น compile-time constant — ไม่มี query string, storage key, message หรือ debug switch
ใดเปลี่ยนได้ตอน runtime (มี PK03 static check เดิมยืนยันว่าไม่มีคำว่า debug/override/bypass ใน bundle)

### สิ่งที่ยังคงบังคับเหมือนเดิมทุกข้อ

- ตรวจ host permission ก่อนยิงทุกครั้ง (`chrome.permissions.contains`) — ไม่มีสิทธิ์ = ไม่ยิง
- ขอสิทธิ์ได้จาก user gesture ในหน้า dashboard เท่านั้น — background ขอเองไม่ได้ (static check)
- หนึ่งคลิก = หนึ่ง request, ไม่มี pagination/retry/polling/การเริ่มเอง + ธงกันกดซ้อนใน service worker
- timeout 20 วินาที, จำกัด body 2 MiB ระหว่างสตรีม, `redirect: 'manual'` ไม่ตาม redirect เอง
- 401/403/429/challenge → หยุดและแจ้งเหตุผล ไม่เปลี่ยนวิธีเพื่อพยายามผ่าน
- ไม่อ่าน/ไม่ export cookie หรือ token ทุกกรณี (มี unit test ยัด canary header ยืนยัน)
- automated test ทั้งหมดยังใช้ fake transport และ network-deny guard — **ไม่มี test ใดยิง TikTok**

### สิ่งที่ยังไม่รู้จนกว่าจะกดทดลองจริง

- **cookie จะถูกแนบไปด้วยหรือไม่** — `credentials: 'include'` จาก service worker ของ extension
  ขึ้นกับนโยบาย SameSite ของคุกกี้ TikTok ด้วย ถ้าได้ `401 auth_required` ทั้งที่ล็อกอินอยู่
  นั่นคือ**ข้อมูลที่มีค่า** ไม่ใช่บั๊กเสมอไป — บันทึกผลแล้วค่อยตัดสินใจต่อ
- พฤติกรรมจริงของ `redirect: 'manual'` เมื่อ TikTok ส่ง 302 ไปหน้า login
- รูปร่าง response จริงยังตรงกับ fixture ที่เก็บไว้เมื่อ 2026-09-20 หรือไม่

*(คำถามข้อ 1 และ 3 ตอบแล้วใน §8 — ข้อ 2 ยังไม่ได้คำตอบเพราะไม่เกิด redirect ขึ้นจริง)*

---

## 8. ผลการทดลองอ่านหนึ่งหน้าจริง (2026-09-20) — **สำเร็จ**

การทดลองครั้งแรกที่ยิง TikTok จริง **ผู้ใช้เป็นผู้ล็อกอิน กดให้สิทธิ์ และกดปุ่มเองทั้งหมด**
AI/automation ไม่ได้เรียก TikTok แทนเลยแม้แต่ครั้งเดียว

### หลักฐานที่ใช้สรุป

ไฟล์ export จากปุ่ม "Export ผลทดสอบหนึ่งหน้า" (`flow-a-probe-probe-1789902474086.json`,
6,826 bytes, `exportedAt: 2026-09-20T11:07:54.086Z`) — **เก็บไว้นอก repo เท่านั้น** ไม่นำเข้า
เพราะเป็นข้อมูลสินค้าจริงที่ยังไม่ได้ sanitize (มี shop name/ราคา/สต็อกจริง) เอกสารนี้บันทึกเฉพาะ
ข้อสรุปเชิงสถิติและการเทียบกับ fixture เดิม ไม่คัดลอกเนื้อหาสินค้ามา

### สิ่งที่พิสูจน์ได้จากการทดลองนี้

| เรื่องที่เคยไม่รู้ | ผลจริง |
|---|---|
| `credentials:'include'` จาก MV3 service worker แนบเซสชันได้ไหม (ความเสี่ยง SameSite) | **ได้** — ไม่เกิด 401 เลย ความกังวลเรื่อง SameSite ไม่เกิดขึ้นจริงกับ endpoint นี้ |
| host permission prompt ของเบราว์เซอร์ทำงานครบวงจรไหม (UI06) | **ได้** — ผู้ใช้กดอนุญาตแล้วยิงผ่าน |
| endpoint/contract ที่บันทึกไว้ยังถูกต้องไหม | **ถูกต้อง** — ได้ envelope ที่ผ่าน `validateEnvelope` และ normalize สำเร็จ 6/6 แถว |
| mapping ที่แก้จาก observed evidence ใช้กับข้อมูลสดได้จริงไหม | **ได้** — `priceDisplay`/`stockQuantity`/`shopName`/`commissionRate` มีค่าครบ 6/6 (ก่อนแก้ mapping ทั้งหมดนี้จะเป็น null) |
| Product ID lossless บนข้อมูลสดไหม | **ใช่** — string 19 หลักครบทุกตัว ไม่ซ้ำกัน |
| ขอบเขต R11 รั่วไหม | **ไม่รั่ว** — สแกนไฟล์ export แล้วไม่พบคำว่า cookie/authorization/bearer/token/headers/bodyText เลยสักคำ |

### เทียบกับ fixture ที่เก็บไว้เมื่อเช้าวันเดียวกัน

- **Product ID ตรงกัน 6/6** กับ `2026-09-20-page1-offset0-full6products.json` → ยืนยันว่ายิงถูก
  endpoint/offset และ contract ไม่เปลี่ยน **แต่ยืนยันไม่ได้ว่าเป็นบัญชีเดียวกัน** — สิ่งที่พิสูจน์คือ
  "รายการสินค้าชุดเดียวกัน" ไม่ใช่ "เจ้าของบัญชีคนเดียวกัน" เพราะ response ไม่มี identity field ใด ๆ
  ให้ตรวจ (§2.2) การที่รายการตรงกันอธิบายได้ด้วยเหตุผลอื่นเช่นกัน — เช่น session เดียวกันในเบราว์เซอร์
  เดียวกัน ซึ่งไม่ใช่หลักฐานเรื่องเจ้าของ นี่คือเหตุผลที่ `sourceIdentityVerified: false` ยังถูกต้อง
  และต้องคงไว้ ไม่ว่าการเรียกจะสำเร็จกี่ครั้ง
- **`stock_num` ขยับอีกครั้ง** — 2 ใน 6 รายการเปลี่ยนค่าระหว่างเช้ากับตอนทดลอง
  (2,653→2,630 และ 34,662→34,632) ยืนยันซ้ำสิ่งที่บันทึกไว้ใน PROVENANCE §4 ว่าตัวเลขที่ไม่ใช่
  identity ขยับตลอดเวลา — ห้ามผูก assertion กับค่าพวกนี้
- **`commission_rate` พบค่าใหม่ที่ไม่เคยเห็น** (1950) เพิ่มจากชุดเดิม — หน่วยยังไม่ยืนยันเหมือนเดิม
  เก็บเป็น raw passthrough ตามเดิม ไม่ตีความ
- enum ยังเป็น `stock_status=1`, `review_status=1`, `can_added=true` ทั้งหมดเหมือนหน้า 1 เดิม
  ไม่มีค่าใหม่ที่ต้องอัปเดต §2.3

### พฤติกรรมของระบบที่ยืนยันแล้วว่าถูกต้อง

- `resultKind: single_page_probe` + `scanCoverage: partial` → ไฟล์บอกตัวเองว่าไม่ใช่ข้อมูลครบ
- `eligibility` เป็น `unknown` ทั้ง 6 รายการ + warning `status_semantics_unverified` (V06 ถูกต้อง
  เพราะ enum ยังไม่ถูกยืนยัน)
- `priceAmountDecimal`/`currency` เป็น `null` + warning `price_amount_unverified` (V07 ถูกต้อง)
- `imageUrl` เป็น `null` ทั้ง 6 รายการ + warning `image_url_rejected` — **ถูกต้องตามที่ออกแบบ**
  เพราะ `APPROVED_IMAGE_HOSTS` ยังว่างโดยตั้งใจ (นโยบาย host รูปยังไม่ตัดสิน) ไม่ใช่บั๊ก
- `sourceIdentityVerified: false` ทุกแถว (V12a)

### สิ่งที่ยังไม่ได้คำตอบจากการทดลองนี้

- **`challenge_required`** — ไม่เกิดขึ้น (ไม่มี CAPTCHA/login page) logic ยังอิงสมมติฐานเหมือนเดิม
- **`redirect: 'manual'`** — ไม่เกิด redirect จึงยังไม่รู้พฤติกรรมจริงเมื่อ TikTok ส่ง 302
- **429/rate limit** — ไม่เกิด (ยิงครั้งเดียว) ข้อจำกัด heartbeat/retry-wait จึงยังไม่ถูกแตะ
- **หน้าอื่นนอกจากหน้าแรก** — ทดลองแค่ `offset=0` ยังไม่ได้ทดสอบการเลื่อนหน้าจริง
- **`count` ค่าอื่นนอกจาก 6** — ยังไม่ทดลอง (VA10 ยัง unknown เหมือนเดิม)

### สิ่งที่ไม่เปลี่ยนจากการทดลองนี้

- **`TIKTOK_AUTOMATED_ACCESS_AUTHORIZED` ยังเป็น `false`** — การที่ request ทำงานได้ **ไม่ใช่**
  หลักฐานว่าได้รับอนุญาต (ย้ำสิ่งที่เขียนไว้แล้วใน §3.1) ToS ยังต้องมี express written permission
- **`G0_VERIFIED` ยังเป็น `false`** — `run.start` (full scan) ยังปิดอยู่

---

## 9. เปลี่ยนขอบเขตอีกครั้ง: หนึ่งหน้า → หลายหน้าจนจบ แบบ manual (2026-09-20 รอบที่หก)

**เจ้าของโปรเจกต์สั่งอย่างชัดแจ้งอีกครั้งหลังการทดลองหนึ่งหน้าสำเร็จ** — เป้าหมายรอบนี้คือ
"ทำให้ปุ่มดึงข้อมูลอ่านหลายหน้าจนจบ แล้ว Export ได้" โดยยังใช้ `count=6` เหมือนเดิม

### สิ่งที่เปลี่ยน

| ก่อนหน้า (§7) | ตอนนี้ |
|---|---|
| `run.start` map ไปที่ purpose `full_scan` → ถูกปฏิเสธด้วย `G0_VERIFIED` | `run.start` map ไปที่ purpose ใหม่ `manual_scan` → เปิดด้วยการอนุญาตของเจ้าของโปรเจกต์ |
| ทดลองได้แค่ `offset=0` หนึ่งครั้ง | ปุ่ม probe อ่านทีละหน้าและเลื่อน offset ได้เมื่อกดเอง + `run.start` สแกนจนจบได้ |
| `OWNER_MANUAL_PROBE_AUTHORIZED` ค่าเดียว | เพิ่ม `OWNER_MANUAL_SCAN_AUTHORIZED` แยกต่างหาก ปิดทีละอันได้ |

`manual_scan` **ไม่ใช่** `full_scan` ที่เปลี่ยนชื่อ — ทั้งสองอ่านข้อมูลชุดเดียวกันแต่ยืนอยู่บน
การอนุญาตคนละชุด `full_scan` ยังต้องรอ `G0_VERIFIED` ซึ่งรวมการอนุญาตจาก TikTok ที่ยังไม่มี
และยังถูกปฏิเสธอยู่เหมือนเดิม (มี test ล็อกไว้ว่าการเปิด `manual_scan` ไม่ทำให้ `full_scan` เปิดตาม)

### สถานะ gate ปัจจุบัน (แทนที่ตารางใน §7)

| ค่า | สถานะ | หมายความว่า |
|---|---|---|
| `G0_TECHNICAL_EVIDENCE_COMPLETE` | `true` | หลักฐานเทคนิคตาม §5.3 ข้อ 1–5 ครบแล้ว |
| `OWNER_MANUAL_PROBE_AUTHORIZED` | `true` | อนุญาตทดลองอ่านทีละหน้าที่ผู้ใช้กดเอง |
| `OWNER_MANUAL_SCAN_AUTHORIZED` | `true` | **ใหม่** — อนุญาตทดลองสแกนหลายหน้าจนจบที่ผู้ใช้กดเอง |
| `TIKTOK_AUTOMATED_ACCESS_AUTHORIZED` | **`false`** | **ไม่เปลี่ยน** — ToS §8/§12 ยังต้องมี express written permission (§3.1) |
| `G0_VERIFIED` (gate ของ `full_scan`) | **`false`** | **ไม่เปลี่ยน** |

| purpose | เงื่อนไข | สถานะ | ใช้กับ message |
|---|---|---|---|
| `metadata_only` | ไม่มี | เปิด | `app.info`, `status.get`, `run.status`, `run.export`, `data.clear` |
| `manual_probe` | หลักฐานเทคนิคครบ + เจ้าของอนุญาตทดลองหนึ่งหน้า | เปิด | `adapter.probe` |
| `manual_scan` | หลักฐานเทคนิคครบ + เจ้าของอนุญาตทดลองหลายหน้า | **เปิดในรอบนี้** | `run.start` |
| `full_scan` | `G0_VERIFIED` | **ยังปิด** | (ยังไม่มี message ใดใช้) |

### ขอบเขตที่การอนุญาตรอบนี้ **ไม่** รวม

- การเริ่มเอง — ไม่มี `chrome.alarms`, polling หรือ auto-resume ใด ๆ ผู้ใช้ต้องกดทุกครั้ง
- `count` ค่าอื่นนอกจาก 6 (VA10 ยัง unknown) และ endpoint อื่นนอกจากที่มี observed evidence
- การรันโดยที่ผู้ใช้ไม่ได้อยู่หน้าจอ — dashboard ต้องเปิดอยู่เพื่อให้เห็นความคืบหน้าและกดยกเลิกได้

### สิ่งที่ยังบังคับเหมือนเดิมทุกข้อ

ทุกข้อในหัวข้อ "สิ่งที่ยังคงบังคับเหมือนเดิมทุกข้อ" ของ §7 ยังใช้อยู่ครบ **ยกเว้นข้อเดียว**
ที่เปลี่ยนไปตามนิยามของงาน: "หนึ่งคลิก = หนึ่ง request" กลายเป็น **"หนึ่งคลิก = หนึ่ง run ที่มี
จุดจบชัดเจน"** — runner เลื่อน offset ทีละ 6 เว้นระยะ `PAGE_INTERVAL_MS` = 1 วินาทีต่อหน้า
หยุดที่ `data.total` ตาม pagination contract ใน §2.1 และหยุดทันทีเมื่อเจอ 401/403/429/challenge/
redirect โดยไม่พยายามหาทางผ่าน

### ช่องว่างที่ต้องปิดก่อน และปิดแล้ว

`RETRY_POLICY.maxRetryAfterMs` ยอมให้รอได้ถึง 15 นาที ขณะที่ lease มีอายุ 60 วินาที — เมื่อเปิด
สแกนหลายหน้า เส้นทาง 429 จะชนช่องว่างนี้ได้จริงเป็นครั้งแรก จึงแก้ก่อนเปิดใช้งาน ไม่ใช่หลังจากนั้น
(`waitWithHeartbeat()` ใน `extension/src/core/runner.ts` — รายละเอียดและหลักฐานอยู่ใน
[test-results.md](test-results.md) § D2 และ [g1-signoff.md](g1-signoff.md))

### การแสดงผลเมื่อข้อมูลไม่ครบ

ถ้า run หยุดก่อนถึงปลายทาง dashboard แสดงแถบเตือนสีแดงเหนือผลลัพธ์ว่า **"ข้อมูลยังไม่ครบ"**
พร้อม `stopReason` ก่อนที่ผู้ใช้จะเห็นรายการสินค้าหรือกด Export ได้ และไฟล์ export เองก็พก
`scanCoverage` + `stopReason` (field ใหม่ในรอบนี้) ติดตัวไปด้วย จึงอธิบายตัวเองได้ว่าขาดเพราะอะไร
โดยไม่ต้องพึ่งความทรงจำของผู้ใช้หรือชื่อไฟล์

---

## 10. ผลการทดลองสแกนหลายหน้าจริง (2026-09-20) — **สำเร็จ พบและแก้บั๊กจริงหนึ่งจุด**

การทดลองสแกน Showcase จริงจนจบครั้งแรก **ผู้ใช้เป็นผู้ล็อกอิน กดให้สิทธิ์ และกดปุ่มเองทั้งหมด**
สแกนได้ **198 รายการ** ไม่ชน rate limit หรือ challenge ระหว่างทางแม้แต่ครั้งเดียว preview แสดง
รายการครบ (Candidate 0 / Other status 198 / Rejected 0 — eligibility เป็น `unknown` ทั้งหมด
ตามที่ออกแบบไว้ เพราะ enum ยังไม่ถูกยืนยัน) เลือกทั้งหมดได้ปกติ

### สิ่งที่ยืนยันแล้วว่าถูกต้อง

- **การยิงหลายหน้าติดกันบนข้อมูลสดไม่ชน rate limit** — สแกนจนจบ (~33 หน้า ที่ `count=6`) โดยไม่มี
  429 เกิดขึ้นเลยตลอด run นี้ (ยังไม่ได้พิสูจน์ว่าจะไม่มีวันเกิด แค่ยืนยันว่าไม่ใช่เหตุการณ์ที่เกิดทุกครั้ง)
- **pagination หยุดถูกจุดจริง** — runner หยุดที่ `data.total` ตาม contract ใน §2.1 ไม่ข้ามหรือดึงเกิน
- **Preview/selection ทำงานถูกต้องบนชุดข้อมูลขนาดใหญ่ขึ้น** (198 รายการ ต่างจาก mock ที่มีแค่ 20)

### สิ่งที่พบว่าผิดและแก้แล้ว — D5

Export ล้มด้วย `export ไม่สำเร็จ: no_report` ทั้งที่ preview ยังแสดงผลอยู่ตรงหน้า สาเหตุคือ
`RunReport` ของ run ที่จบแล้วเก็บอยู่แค่ในหน่วยความจำของ service worker ซึ่งถูก Chrome idle-kill ไป
ก่อนที่ผู้ใช้จะเลือกสินค้าเสร็จและกด Export (ใช้เวลาเลือก 198 รายการนานกว่า MV3 idle timeout)
รายละเอียดเต็มและหลักฐานอยู่ใน [test-results.md](test-results.md) § รอบแก้ D5 และ
[g1-signoff.md](g1-signoff.md) § ข้อจำกัดที่ทราบ (D5) — สรุปสั้น: แก้โดย persist ผลของ run ที่จบแล้ว
ลง IndexedDB จริง (`STORE_FINISHED_REPORT`) แทนที่จะพึ่งความจำของ service worker เพียงอย่างเดียว

### ยืนยันการแก้ D5 ด้วยข้อมูลจริงรอบสอง (2026-09-20)

หลัง deploy โค้ดที่แก้แล้ว ผู้ใช้ทดลองซ้ำด้วย flow เดิมทุกขั้นตอน **แล้วจงใจปล่อยหน้าจอทิ้งไว้เกิน
1 นาทีก่อนกด Export** (นานพอให้ MV3 service worker ถูก Chrome idle-kill ไปแน่นอน) — Export สำเร็จ
ไม่มี `no_report` อีกเลย ไฟล์ที่ได้ (`flow-a-export-b689aaf1-9b90-4225-86e0-d6207a66e113.json`)
ตรวจแล้วครบถูกต้องทุกจุด:

| ตรวจสอบ | ผลจริง |
|---|---|
| `scanCoverage` / `stopReason` | `reached_endpoint_end` / `endpoint_end` — จบเพราะถึงปลายทางจริง |
| `adapterVersion` | `live-v1` — ข้อมูลจริงจาก TikTok |
| จำนวนสินค้า | **201 รายการ** (`selectedProductIds.length` และ `products.length` ตรงกันทั้งคู่) |
| Product ID | string 19 หลักครบทุกตัว ไม่มีค่าใดถูกปัดเสียหาย |
| ข้อมูลอ่อนไหว | สแกนทั้งไฟล์แบบ case-insensitive หาคำว่า `cookie`/`authorization`/`set-cookie`/
  `bodytext`/`bearer`/`session` — **ไม่พบสักคำเดียว** |

จำนวนสินค้าขยับจาก 198 (ตอนเจอบั๊ก) เป็น 201 (ตอนแก้แล้ว) ในการสแกนคนละรอบกัน — เป็นไปตามที่คาด
เพราะ Showcase จริงเปลี่ยนแปลงได้ตลอดเวลา ไม่ใช่สัญญาณว่ามีอะไรผิดปกติ (ดู "สิ่งที่ไม่เปลี่ยนจากการ
ทดลองนี้" ด้านล่าง)

**D5 ถือว่าปิดจบด้วยหลักฐานสามชั้น:** unit test (10 เคส) + E2E ที่หยุด service worker จริงผ่าน CDP
บน mock channel + การใช้งานจริงบนบัญชี TikTok จริงที่จำลองสถานการณ์เดิมเป๊ะแล้วยืนยันว่าไม่พังอีก

### สิ่งที่ยังไม่ได้คำตอบจากการทดลองนี้

- **`challenge_required`/`redirect: 'manual'`/429** — ไม่เกิดขึ้นเลยใน run นี้ logic ยังอิงสมมติฐาน
  เดิมจาก §8 (ยังไม่มีหลักฐานตรงจากข้อมูลจริง)
- **`count` ค่าอื่นนอกจาก 6** — ยังไม่ทดลอง (VA10 ยัง unknown เหมือนเดิม)
- **รูปสินค้า** — `APPROVED_IMAGE_HOSTS` ยังว่างโดยตั้งใจ ยังไม่ตัดสินนโยบาย host

### สิ่งที่ไม่เปลี่ยนจากการทดลองนี้

- **`TIKTOK_AUTOMATED_ACCESS_AUTHORIZED` ยังเป็น `false`** — การที่ scan จนจบทำงานได้ **ไม่ใช่**
  หลักฐานว่าได้รับอนุญาต (ย้ำสิ่งที่เขียนไว้แล้วใน §3.1) ToS ยังต้องมี express written permission
- **`G0_VERIFIED` ยังเป็น `false`** — `manual_scan` ที่เปิดใช้ได้ในรอบนี้ยืนอยู่บนการอนุญาตของ
  เจ้าของโปรเจกต์เท่านั้น ไม่ใช่ `full_scan` (§9) ซึ่งยังต้องรอ TikTok เหมือนเดิม
- **จำนวนสินค้าไม่ใช่ค่าคงที่** — สามรอบที่เก็บหลักฐานไว้ในเอกสารนี้ได้ค่าต่างกัน: 201 (เช้า §8/
  PROVENANCE), 198 (รอบที่เจอบั๊ก D5), 201 (รอบยืนยันการแก้ D5 ด้านบน — บังเอิญตรงกับรอบแรก
  ไม่ใช่ค่าคงที่ที่ผูกกันได้) เพราะ Showcase จริงเปลี่ยนแปลงได้ตลอดเวลา (สอดคล้องกับที่บันทึกไว้แล้ว
  ว่าห้ามผูก assertion กับตัวเลขนี้)

---

## 11. ปลดล็อกรูปสินค้าใน export (2026-09-20 รอบที่เจ็ด) — เตรียมข้อมูลสำหรับ "Flow B" (AI Video)

**เป้าหมายรอบนี้ไม่ใช่ TikTok automation เพิ่มเติม** — แค่ export ข้อมูลที่ Flow A อ่านมาอยู่แล้วให้
ครบขึ้น (ยังอยู่ในขอบเขต §2.2 "แยกข้อมูลดิบที่จำเป็น") เพื่อเตรียมไว้ให้โปรเจกต์แยกในอนาคต
("Flow B" — สร้างวิดีโอด้วย AI สำหรับปักตะกร้า ซึ่ง §2.3 ระบุไว้แล้วว่าอยู่นอกขอบเขตของ Flow A)
เอามาใช้เป็นวัตถุดิบ ไม่ใช่การขยายขอบเขต Flow A เอง

### สิ่งที่เปลี่ยน

- `NormalizedProduct.imageUrl: string | null` (รูปเดียว) → `imageUrls: readonly string[]` (หลายรูป)
- ดึงจาก `images[]` เป็นหลัก ไม่ใช่ `cover` — เช็คแล้วว่า `cover` กับ `images[0]` เป็น URL เดียวกัน
  เป๊ะในสินค้าจริงทุกชิ้นที่สังเกตได้ (15/15 ชิ้น จากไฟล์ observed ทั้ง 3 หน้า) จึงดึงจาก `images[]`
  อย่างเดียวได้ครบกว่าโดยไม่ต้องดึง `cover` ซ้ำ — ยัง fallback ไปที่ `cover` เดี่ยว ๆ ถ้า `images`
  หายไปหรือว่าง (ยังไม่เคยเจอเคสนี้จริง แต่กันไว้)
- `APPROVED_IMAGE_HOSTS` เปิดจากว่างเปล่า → 4 host ที่สังเกตได้จริงจากไฟล์ observed ทั้ง 3 หน้า
  (15 สินค้า): `p16-oec-sg.ibyteimg.com`, `p19-oec-sg.ibyteimg.com`, `p16-oec-va.ibyteimg.com`,
  `p19-oec-va.ibyteimg.com` — จดเฉพาะที่เคยเห็นจริง ไม่เดา pattern กว้างกว่านั้น (เช่น
  `*.ibyteimg.com`) แม้ชื่อจะคล้ายกันมากก็ตาม
  - พบว่า `-sg` (Singapore) กับ `-va` (Virginia) ผสมกันในรายการรูปของสินค้าเดียวกันจริง
    (ไม่ได้แยกตามภูมิภาคเป๊ะ) 3 ใน 15 ชิ้นมีรูปจาก host `-va` ปนอยู่ด้วย
  - ทุกสินค้า (15/15) มี URL รูปอย่างน้อยหนึ่งรูปที่ผ่าน allowlist หลังเปิดทั้ง 4 host — ไม่มีสินค้าไหน
    ได้ `imageUrls` ว่างเปล่าจากข้อมูลจริงที่มีอยู่แล้ว
- Query string ของทุก URL ยังถูกตัดทิ้งเหมือนเดิม (V08 เดิม — อาจมี token) ไม่เปลี่ยนพฤติกรรมนี้
- Preview บนหน้า dashboard โชว์แค่รูปแรก (`imageUrls[0]`) เป็น thumbnail เพื่อไม่ให้ตารางที่มีสินค้า
  เป็นร้อยรกเกินไป — ไฟล์ export ยังมี `imageUrls` ครบทุกรูปอยู่ดี ไม่ได้ตัดทิ้งจากไฟล์

### สิ่งที่ยังไม่รู้

- ยังไม่ยืนยันว่า TikTok มี CDN node อื่นนอกจาก 4 host นี้ไหม (เช่น p17/p18/p20) ถ้ามี รูปจากที่นั่น
  จะถูกปฏิเสธเงียบ ๆ (ไม่ error แค่ `imageUrls` สั้นกว่าที่ควร) — เพิ่ม host ได้ทันทีที่เจอหลักฐานจริง
- แต่ละรูปใน `images[]` คือมุมกล้องอะไรบ้าง (สินค้า, พื้นหลังขาว, ใช้งานจริง ฯลฯ) TikTok ไม่ได้ระบุ
  label กำกับมาด้วย — ต้องดูด้วยตาเองเป็นรายสินค้า
