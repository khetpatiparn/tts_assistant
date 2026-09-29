# Showcase Scanner — คู่มือเชื่อมต่อระบบปลายทาง (สำหรับ AI coding agent)

เอกสารนี้อธิบาย protocol `showcase-scanner/1` ที่ extension ใช้ส่งผลสแกนสินค้าไปยัง "ระบบปลายทาง" ของผู้ใช้ (Google Sheets, n8n, เว็บของตัวเอง ฯลฯ) อ่านจบแล้วสร้าง endpoint ได้ทันที เอกสารนี้อธิบายพฤติกรรมของ Showcase Scanner v0.2.x

## 1. สิ่งที่คุณต้องสร้าง

**endpoint เดียว** ที่ URL มีรหัสลับ (`?token=`) ฝังอยู่ ผู้ใช้จะวางลิงก์ทั้งบรรทัดลงในช่อง "ลิงก์ปลายทาง" ของ extension ครั้งเดียวจบ

```
https://your-host.example/scanner?token=<รหัสลับ>
```

- สร้าง token แบบสุ่มอย่างน้อย **32 ไบต์** (เช่น hex 64 ตัวอักษร) — `openssl rand -hex 32`
- เทียบ token แบบ timing-safe ทุก request; ไม่ตรง / ไม่มี = ปฏิเสธ
- ต้องมี **วิธีสร้างลิงก์ใหม่** (เปลี่ยน token ทำให้ลิงก์เก่าใช้ไม่ได้ทันที) เผื่อลิงก์หลุด
- **https บังคับ** ยกเว้น `localhost` / `127.0.0.1` (extension ปฏิเสธลิงก์ `http://` อื่นตั้งแต่ตอนวาง)
- ปลายทางไม่ต้องขอสิทธิ์ใดๆ ใน extension แค่ตอบ CORS ให้ถูก (หัวข้อ 5)

## 2. `POST <link>` — รับผลสแกน

- `Content-Type: text/plain;charset=utf-8` (จงใจ — เป็น "simple request" ไม่มี preflight ทำให้ใช้กับ Google Apps Script ได้) เนื้อหาเป็น **ข้อความ JSON** จึงต้องอ่าน body เป็นข้อความแล้ว `JSON.parse(rawBody)` เอง อย่าพึ่ง body parser ที่ดูจาก content-type
- ตอบ **2xx = รับแล้ว** (ตอบอะไรก็ได้ เช่น `{"ok":true}`; extension อ่าน body แค่ตรวจกฎ unauthorized ด้านล่าง และถ้าเป็น JSON ที่มีตัวเลข `added` / `skipped` / `imagesFailed` จะแสดงสรุปให้ผู้ใช้ — ไม่บังคับ)
- **ต้องตอบภายใน 120 วินาที** (extension ตัดที่ 120 วินาที แล้วบอกผู้ใช้ว่า "ติดต่อปลายทางไม่ได้" ทั้งที่ปลายทางอาจรับไปแล้ว ผู้ใช้จะกดส่งซ้ำ) — อย่าทำงานช้าก่อนตอบ ถ้าต้องทำงานหนัก (เช่น โหลดรูปหลายร้อยรูป) ให้รับข้อมูลลงคิวแล้วตอบทันที
- token ผิด → ตอบ **401** (หรือ 403)
- **Apps Script ตอบ 401 ไม่ได้** (ได้แต่ 200) → ตอบ body `{"error":"unauthorized"}` และไม่เขียนอะไร extension ถือว่าเท่ากับ 401 ทั้งตอน `GET` และ `POST` (ตรวจ regex `"error"\s*:\s*"unauthorized"` ใน body ของ POST ที่ตอบ 2xx)
- JSON เสีย / รูปแบบผิด → ตอบ 400 ได้ (extension แสดงว่า "ปลายทางตอบกลับว่าไม่สำเร็จ (400)" และถ้า body เป็น `{"error":"..."}` จะต่อข้อความ error นั้นให้ด้วย)

### ตัวอย่าง payload (ตัดเหลือสินค้า 1 ตัว; ค่าทั้งหมดเป็นของปลอม)

```json
{
  "resultKind": "full_scan",
  "protocol": "showcase-scanner/1",
  "runId": "run-example-0001",
  "exportedAt": "2026-09-29T07:00:00.000Z",
  "adapterVersion": "0.2.0",
  "sourceRef": "showcase",
  "scanCoverage": "reached_endpoint_end",
  "stopReason": "endpoint_end",
  "dataQuality": "clean",
  "selectedProductIds": ["1736476547228075452"],
  "products": [
    {
      "schemaVersion": 1,
      "sourceRef": "showcase",
      "sourceIdentityVerified": true,
      "productId": "1736476547228075452",
      "title": "ชั้นวางของในครัว 2 ชั้น",
      "priceDisplay": "฿128.71",
      "priceAmountDecimal": null,
      "currency": null,
      "stockQuantity": 120,
      "stockStatusRaw": 1,
      "reviewStatusRaw": 1,
      "canAddRaw": true,
      "commissionRate": 1200,
      "eligibility": "unknown",
      "eligibilityBasis": "adapter-rule-v1-unverified",
      "categoryLabel": "เครื่องครัว",
      "hasStatusPopup": false,
      "imageUrls": [
        "https://p16-oec-sg.ibyteimg.com/example-cover.jpeg",
        "https://p16-oec-sg.ibyteimg.com/example-1.jpeg"
      ],
      "shopName": "exampleshop_",
      "observedAt": "2026-09-29T06:59:00.000Z",
      "validationWarnings": ["price_amount_unverified", "status_semantics_unverified"]
    }
  ]
}
```

ระดับบนสุดคือ `resultKind` (`full_scan` หรือ `single_page_probe` = ผลทดลองอ่านหนึ่งหน้า ควรปฏิเสธหรือไม่นำเข้า), `protocol`, `runId`, `exportedAt`, `adapterVersion`, `sourceRef`, `scanCoverage`, `stopReason`, `dataQuality`, `selectedProductIds`, `products[]` — ส่วนใหญ่ปลายทางไม่ต้องใช้ ใช้แค่ `products[]` ก็พอ

### field ของ `products[]` ที่ควรใช้

| field | ชนิด | ความหมาย |
|---|---|---|
| `productId` | **string** | เลขฐานสิบ ยาวเกิน 2^53 — **ห้ามแปลงเป็น number** (ตัวเลขจะเพี้ยน) เก็บเป็นข้อความเสมอ; ใน Google Sheets ต้องตั้งคอลัมน์เป็น plain text |
| `title` | string | ชื่อสินค้า |
| `priceDisplay` | string \| null | ข้อความราคาตามที่หน้าแสดง เช่น `"฿128.71"` (อาจเป็นช่วงราคา) |
| `priceAmountDecimal` | string \| null | **ปัจจุบัน extension ส่ง `null` เสมอ** (ยังไม่ยืนยันการแปลงราคา) อย่าพึ่งพา — parse จาก `priceDisplay` เอง |
| `currency` | string \| null | **ปัจจุบันเป็น `null` เสมอ** เช่นกัน |
| `commissionRate` | number \| string \| null | ค่าดิบจาก TikTok ในหน่วย **เปอร์เซ็นต์ × 100** (หนึ่งในร้อยของเปอร์เซ็นต์): `1200` = **12%**, `1600` = 16%, `100` = 1% — ตรวจแล้วกับสินค้าจริง 14/14 ชิ้น (Angle หารด้วย 100 แล้วนำไปคำนวณ; `lib/showcase-import.ts`) ตัวอย่างในเอกสารนี้จึงแปลงด้วย `Number()` (มีตัวกัน NaN) แล้วหาร 100 เพื่อได้เปอร์เซ็นต์ · เป็น `null` ได้เมื่อ TikTok ไม่ส่ง |
| `shopName` | string \| null | ชื่อร้าน |
| `imageUrls` | string[] | รูปสินค้า (https, เฉพาะโฮสต์ ibyteimg ที่ extension อนุญาต, ตัด query แล้ว) อาจว่าง |
| `categoryLabel` | string \| null | ชื่อหมวด |
| `hasStatusPopup` | boolean | `true` = TikTok ขึ้นว่าสินค้า "Unavailable" (ผู้ขายลบ / ไม่ใช่สินค้า affiliate แล้ว) → **ควรข้าม ไม่เก็บ** |
| `schemaVersion` | number | ตอนนี้ `1` |

field อื่น (`stockQuantity`, `stockStatusRaw`, `reviewStatusRaw`, `canAddRaw`, `eligibility`, `validationWarnings` ฯลฯ) เป็นข้อมูลดิบ/สถานะภายใน ความหมายของ enum ยังไม่ยืนยัน — ไม่ควรตัดสินใจจากมัน

## 3. ส่งซ้ำได้ — ต้อง upsert

สินค้าตัวเดียวกันอาจถูกส่งมามากกว่าหนึ่งครั้ง (ผู้ใช้กด "ล้างความจำ" / เปลี่ยนเครื่อง / สแกนซ้ำ) ให้ **upsert ด้วย `productId`** ห้ามสร้างแถวซ้ำ และห้าม error เพราะซ้ำ

## 4. `GET <link>` (แนะนำ ไม่บังคับ)

ตอบ JSON:

```json
{ "protocol": "showcase-scanner/1", "productIds": ["1736476547228075452"], "lastReceivedAt": "2026-09-29T07:00:00.000Z" }
```

- `productIds` = สินค้าทั้งหมดที่ปลายทางมีแล้ว (สตริง) · `lastReceivedAt` = เวลา ISO ที่รับครั้งล่าสุด หรือ `null` ถ้ายังไม่เคยรับ
- ตอบถูกรูปแบบ → popup ขึ้น **ไฟเขียว** และ extension **หยุดสแกนเอง** เมื่อเจอหน้าที่ปลายทางมีครบแล้ว
- ไม่ทำ GET → **ไฟเทา** แต่ยังใช้งานได้: extension ใช้ความจำของตัวเอง ("ID ทุกตัวที่ POST สำเร็จ") แทน
- token ผิดตอน GET → 401/403 หรือ body `{"error":"unauthorized"}`

## 5. CORS

ทุก response (รวม error 401/400) ต้องมี:

```
Access-Control-Allow-Origin: *
```

ถ้าเฟรมเวิร์กจัดการ `OPTIONS` ได้ ให้ตอบ **204** พร้อม header เดียวกัน บวก `Access-Control-Allow-Methods: GET, POST, OPTIONS` และ `Access-Control-Allow-Headers: content-type` (POST ของ extension เป็น simple request จึงปกติไม่มี preflight — ตอบ OPTIONS ไว้เป็นการกันเหนียว) ใช้ `*` ได้เพราะไม่มี cookie; การยืนยันตัวตนคือ token ในลิงก์

**Google Apps Script:** ตั้ง CORS header เองไม่ได้ ต้องพึ่ง response ของ Google ที่ redirect จาก `/exec` — **เรายังไม่ได้ทดสอบครบวงจรจริง** ให้ทดสอบ GET และ POST จากเบราว์เซอร์ตามเช็กลิสต์หัวข้อ 8 ก่อนพึ่งพา นอกจากนี้ Apps Script ตอบ 400 ไม่ได้ (200 เสมอ): body `{"error":"invalid JSON body"}` พร้อม HTTP 200 extension นับว่า **ส่งสำเร็จ** (จำ ID ไว้ทั้งที่ไม่ได้บันทึกอะไร) มีเฉพาะ `{"error":"unauthorized"}` ที่นับว่าล้มเหลว — สคริปต์จึงต้องตรวจ payload ให้เข้มก่อนเขียน

## 6. ที่ extension แสดงตามสิ่งที่ปลายทางตอบ

| ปลายทางตอบ | GET (ไฟบน popup / หยุดเอง) | POST (ปุ่มส่ง) |
|---|---|---|
| 2xx + JSON ถูกรูปแบบ (`protocol` ตรง + `productIds` เป็น array) | ไฟเขียว บอกจำนวนสินค้า + รับล่าสุด; ใช้รายการนี้หยุดสแกน | สำเร็จ; จำ ID ที่ส่งทั้งหมดไว้ |
| 2xx แต่ body ไม่ใช่รูปแบบ/ไม่ใช่ JSON | ไฟเทา "ไม่บอกสถานะ" ใช้งานได้; ใช้ความจำของ extension | สำเร็จ |
| 2xx + body `{"error":"unauthorized"}` | ลิงก์ใช้ไม่ได้ (ไฟแดง) | ไม่สำเร็จ "ลิงก์ปลายทางใช้ไม่ได้แล้ว" |
| 401 / 403 | ลิงก์ใช้ไม่ได้ (ไฟแดง) | ไม่สำเร็จ "ลิงก์ปลายทางใช้ไม่ได้แล้ว" |
| 5xx | ติดต่อไม่ได้ (ไฟแดง) ไม่สแกนอัตโนมัติ | ไม่สำเร็จ "ปลายทางตอบกลับว่าไม่สำเร็จ (5xx)" |
| เชื่อมต่อไม่ได้ / timeout (GET 5 วินาที, POST 120 วินาที) / CORS ไม่ผ่าน | ติดต่อไม่ได้ (ไฟแดง) ไม่สแกนอัตโนมัติ | ไม่สำเร็จ "ติดต่อปลายทางไม่ได้" |
| 4xx อื่น (เช่น 404) | ไฟเทา ไม่บอกสถานะ | ไม่สำเร็จ "ปลายทางตอบกลับว่าไม่สำเร็จ (ตัวเลข)" |

หมายเหตุ: หลัง POST ที่ได้ 2xx extension จำ "ทุก ID ที่ส่ง" — แม้ปลายทางจะข้ามบางตัว (เช่น `hasStatusPopup`) ก็ไม่ถูกนับเป็น "ใหม่" ซ้ำทุกรอบ

## 7. ตัวอย่างโค้ดที่รันได้ครบ

ในโฟลเดอร์ `examples/` (ทั้งสามใช้ token, CORS, upsert ตามเอกสารนี้):

- `express.js` — Node + Express, เก็บใน Map (รันจริงแล้ว: `npm i express`, ตั้ง `SCANNER_TOKEN`, `node express.js`)
- `nextjs-route.ts` — Next.js App Router `app/api/scanner/route.ts` (storage เป็นฟังก์ชัน stub ใน Map ให้เปลี่ยนเป็นฐานข้อมูล)
- `apps-script.gs` — Google Apps Script ผูกกับ Google Sheet (แท็บ `Products`) deploy เป็น Web app "Anyone"; token เก็บใน Script Properties ชื่อ `TOKEN`

## 8. Checklist ก่อนส่งลิงก์ให้ผู้ใช้

ทดสอบด้วย curl (แทน `$LINK` เป็น URL ไม่รวม `?token=`):

```bash
# 1) ไม่มี token -> ต้อง 401 (Apps Script: body {"error":"unauthorized"})
curl -i "$LINK"

# 2) มี token -> ต้องได้ JSON รูปแบบ {"protocol":"showcase-scanner/1","productIds":[...],"lastReceivedAt":...}
curl -i "$LINK?token=$TOKEN"

# 3) POST ตัวอย่าง payload (บันทึกจากหัวข้อ 2 เป็น payload.json) -> ต้อง 2xx
curl -i -X POST "$LINK?token=$TOKEN" -H 'Content-Type: text/plain;charset=utf-8' --data @payload.json

# 4) GET อีกครั้ง -> productIds ต้องมี "1736476547228075452"; POST ซ้ำต้องไม่เกิดแถวซ้ำ
curl "$LINK?token=$TOKEN"
```

และตรวจว่า response ทุกตัวมี `Access-Control-Allow-Origin: *`
