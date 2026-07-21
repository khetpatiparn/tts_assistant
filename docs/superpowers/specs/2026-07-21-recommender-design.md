# Design: Recommender — "ควรทำอะไรต่อ"

วันที่: 2026-07-21
สถานะ: อนุมัติ scope แล้ว รอ writing-plans

## ปัญหา

ผู้ใช้เป็นครีเอเตอร์ TikTok Shop affiliate คนเดียว ทำคลิปวันละหลายตัว ปัญหาแกนคือ **hit-rate ต่ำ** —
41 คลิป มีแค่ 2 ตัวที่ทำเงินจริง (กิน 77% ของออเดอร์ทั้งหมด) และ 19 คลิปได้ 0 ออเดอร์

คำถามที่ผู้ใช้ถามซ้ำๆ ทุกครั้งที่จะทำคลิปใหม่คือ **"ควรทำอะไรต่อ — สินค้าเดิม angle ใหม่ หรือหาสินค้าใหม่"**
ตอนนี้ต้องเอาข้อมูลมาถาม AI ทีละครั้ง แอปเองไม่เคยบอกอะไร

**ข้อมูลที่มีตอนนี้ตอบคำถามนี้ไม่ได้** เพราะแอปเห็นแค่ฝั่งเงิน (`AffiliateOrder`) — คลิปที่ได้ 0 ออเดอร์
19 ตัวนั้นแยกไม่ออกเลยว่า "คนไม่เห็น" (ปัญหาการกระจาย) หรือ "คนเห็นแล้วไม่ซื้อ" (ปัญหาสินค้า)
ซึ่งสองอย่างนี้ต้องแก้ตรงกันข้ามกัน

## ข้อค้นพบจากข้อมูลจริง (load-bearing — ฐานของทุกการตัดสินใจด้านล่าง)

วิเคราะห์ `creative_data/Content_rainny0192/Content.csv` (วิว/ไลก์/คอมเมนต์/แชร์ ต่อคลิป)
join กับ `AffiliateOrder` + `PromptEntry` ด้วย video id แล้วพบว่า:

### 1. วิวคือ lever ไม่ใช่ conversion — ข้อค้นพบที่สำคัญที่สุด

| คลิป | วิว | ออเดอร์ | conv% |
|---|---|---|---|
| ที่ลับเล็บแมว | 63,053 | 119 | 0.189% |
| ชั้นวางของ 5 ชั้น | 17,856 | 41 | **0.230%** |
| MewaJump | 2,927 | 6 | 0.205% |
| ถ้วยกาแฟ | 1,562 | 3 | 0.192% |
| กระปุกกรองน้ำมัน | 1,038 | 3 | **0.289%** |
| ชั้นวางเครื่องปรุง | 1,828 | 2 | 0.109% |
| ชามสแตนเลส | 1,494 | 1 | 0.067% |

**วิวต่างกัน 60 เท่า (1,038 → 63,053) แต่ conv rate เกาะกลุ่มกันที่ 0.06–0.29%**
ค่าเฉลี่ยทั้งช่อง ≈ **0.19%** (191 ออเดอร์ / 100,464 วิว)

คลิปที่ชนะ **ชนะเพราะได้วิว ไม่ใช่เพราะขายเก่งกว่า** — ที่ลับเล็บแมว conv 0.189% ซึ่งกลางๆ ด้วยซ้ำ
ส่วนชั้นวางของ 5 ชั้น conv สูงกว่าแต่ได้วิวแค่ 1 ใน 4

→ recommender ต้องมองสองแกน (วิว × conversion) เสมอ การดูออเดอร์อย่างเดียวคือการวัดวิวทางอ้อม

### 2. Indicator ที่ทดสอบแล้ว "สอบตก" (ห้ามใช้)

| ตัว | ทำไมใช้ไม่ได้ |
|---|---|
| **settled revenue** | เป็น lagging indicator — ชั้นวางของ 5 ชั้น มี 41 ออเดอร์แต่ settled = 0 เพราะเงิน settle 15–31 วัน ใช้ตัวนี้จับ winner จะรู้ช้าเป็นเดือน |
| **เทียบกับ median** | median orders/day ของช่อง = 0.05, median first7 = **0** → สูตร "X เท่าของ median" พังทันที ต้องใช้ค่าสัมบูรณ์หรือ mean |
| **gmv/order สูง** | false positive: "ชั้นวางของในครัว" ติดธงทั้งที่มี 2 ออเดอร์ และครึ่งนึงโดนคืน/ไม่มีสิทธิ์ |
| **first3/first7 เร็ว อย่างเดียว** | ติดธง "ถ้วยกาแฟ"/"กระปุกกรองน้ำมัน" ที่ออกตัวแรงแล้วตาย (last7 = 0) — ต้องคู่กับ "ยังมีชีวิต" |

### 3. ความครอบคลุมข้อมูล

`Content.csv` มี 15 วิดีโอ จับคู่กับ entry ได้ **13** (อีก 2 เป็นคลิปเก่าก่อนขายของ)
แต่ entry ที่มี videoUrl ในแอปมี **41** → **28 คลิปยังไม่มีข้อมูลวิว** (ไฟล์ครอบคลุม 28 พ.ค. – 16 ก.ค.
ไม่รวมคลิปที่โพสต์ 17–19 ก.ค.) ระบบต้องรับมือกับข้อมูลไม่ครบได้อย่างสง่างาม

### 4. Content.csv ให้ยอดสะสม ไม่มีวิวรายวัน → ต้องเก็บ snapshot

`Total views` คือยอดสะสม ณ วันที่ export ถ้า import ทับโดยไม่เก็บของเก่า **ความเร็ววิวคำนวณไม่ได้เลยตลอดกาล**
(ต่างจาก `AffiliateOrder` ที่มี `orderDate` ต่อแถว จึงคำนวณย้อนหลังได้จากไฟล์ก้อนเดียว)

### 5. เวลาโพสต์: ยังตอบไม่ได้ เพราะไม่มีข้อมูล

- `Content.csv` → "Post time" = วันที่ล้วน ("July 1") ไม่มีชั่วโมง
- `PromptEntry.postedAt` → เก็บเป็น UTC midnight (วันที่ล้วน)

**ไม่มีที่ไหนบันทึกเวลาโพสต์จริงเลย** จึงยืนยันไม่ได้ว่าเวลาส่งผลไหม
ส่วน `FollowerActivity.csv` บอกได้ว่าผู้ติดตามออนไลน์เยอะสุด 19:00–21:00 (พีคย่อยเที่ยง) ต่ำสุด 02:00–03:00
ห่างกัน ~4 เท่า — แต่เป็น "ผู้ติดตามออนไลน์" ซึ่งบน TikTok สำคัญน้อยกว่า FYP ใช้เป็นแนวทางคร่าวๆ เท่านั้น

วันในสัปดาห์และการโพสต์วันละหลายคลิป: **ตัวอย่างน้อยเกินสรุป** (1–2 ตัวอย่างต่อกลุ่ม) ไม่ใส่ในดีไซน์

## ขอบเขต

**ทำ:** import ข้อมูล content (วิว/engagement) พร้อมเก็บ snapshot · detector 4 แบบตามเมทริกซ์ 2 แกน ·
section แสดงผลใน Dashboard · เริ่มเก็บเวลาโพสต์

**ไม่ทำรอบนี้:** วิเคราะห์เวลาโพสต์ (แค่เริ่มเก็บ ยังไม่มีข้อมูลพอ) · หน้าเทียบก่อน-หลัง import แยกต่างหาก ·
เชื่อม TikTok API · แนะนำสินค้าใหม่จาก product pool · วิเคราะห์ follower demographics

## สถาปัตยกรรม

### 1. Data model

**ตารางใหม่ `ClipMetric`** — snapshot ต่อการ import หนึ่งครั้ง

```prisma
model ClipMetric {
  id             String       @id @default(cuid())
  videoId        String
  matchedEntryId String?
  matchedEntry   PromptEntry? @relation(fields: [matchedEntryId], references: [id], onDelete: SetNull)
  title          String
  postedDate     String       // จาก CSV "Post time" เก็บดิบ ("July 1") ไม่ parse
  views          Int
  likes          Int
  comments       Int
  shares         Int
  capturedOn     DateTime     // as-of date ของ snapshot
  importedAt     DateTime     @default(now())

  @@unique([videoId, capturedOn])
}
```

- `@@unique([videoId, capturedOn])` = idempotent ต่อ import ซ้ำไฟล์เดิม (upsert ทับแถวเดิม)
- `capturedOn` มาจากคอลัมน์ `Time` ของ CSV โดย**เดาปีจากวันที่ import** (ถ้าเดือนมากกว่าเดือนปัจจุบันให้ถือเป็นปีก่อน)
- เก็บแถวที่ `matchedEntryId = null` ไว้ด้วย (คลิปเก่าก่อนขายของ) — แพทเทิร์นเดียวกับ `AffiliateOrder`
- จับคู่ด้วย video id จาก `Video link` เทียบกับ `PromptEntry.videoUrl` ผ่าน `videoIdFromUrl` ที่มีอยู่แล้วใน `lib/affiliate.ts`
- `PromptEntry` เพิ่ม back-relation `clipMetrics ClipMetric[]`

**`PromptEntry` เพิ่ม `postedTimeOfDay String?`** — เก็บ "HH:MM"

**ห้ามแตะ `postedAt`** เดิมเด็ดขาด — มันเป็น load-bearing (UTC-midnight + date helper สองตัวใน
`production-panel.tsx` ที่ห้ามสลับกัน + ใช้เรียงลำดับใน `lib/entry-sort.ts` + คำนวณใน dashboard)
การเพิ่มคอลัมน์ใหม่ nullable แยกต่างหาก = ความเสี่ยงศูนย์ ได้ประโยชน์เท่ากัน

เหตุผลที่เก็บทั้งที่ยังวิเคราะห์ไม่ได้: **ต้องเริ่มเก็บก่อนถึงจะวิเคราะห์ได้** ถ้าไม่เริ่มวันนี้
อีก 3 เดือนก็ยังตอบคำถามเรื่องเวลาโพสต์ไม่ได้อยู่ดี

### 2. Parser — `lib/clip-metrics.ts`

ไฟล์เดียวที่รู้จักโครง `Content.csv` (แพทเทิร์นเดียวกับ `lib/affiliate.ts` ที่เป็นไฟล์เดียวที่รู้จัก xlsx)

- เป็น **CSV ไม่ใช่ xlsx** — มี BOM (`﻿`) นำหน้า ต้องตัดทิ้ง, ทุก field ใส่ quote, caption มี comma
  ข้างในจึงต้อง parse แบบรองรับ quoted field (เขียน parser เองสั้นๆ ไม่ต้องลง dependency ใหม่)
- คอลัมน์ (0-based): `0=Time` `1=Video title` `2=Video link` `3=Post time` `4=Total likes`
  `5=Total comments` `6=Total shares` `7=Total views`
- คืน `ClipMetricInput[]` — pure function ไม่แตะ DB

### 3. Detector — `lib/recommender.ts`

**pure function ล้วน ไม่เรียก LLM ไม่แตะ DB** (รับข้อมูลเข้า คืน signal ออก) แบบเดียวกับ `lib/dashboard.ts`

**เหตุผลที่ไม่ใช้ Gemini:** การจับ pattern พวกนี้เป็นคณิตศาสตร์ล้วน → ไม่กินโควตา free tier
(ข้อจำกัดของโปรเจกต์: runtime LLM ต้องเป็น Gemini free tier เท่านั้น) รันได้ทุกครั้งที่เปิดหน้า
ผลลัพธ์ deterministic ไม่มี drift

```ts
export type ClipSignalKind = 'emerging' | 'hidden-gem' | 'reach-no-convert' | 'fading';

export type ClipSignal = {
  kind: ClipSignalKind;
  entryId: string;
  productName: string;
  headline: string;   // ข้อความไทยบรรทัดเดียว
  detail: string;     // ตัวเลขประกอบ
  strength: number;   // ใช้เรียงลำดับ
};
```

**Baseline คำนวณจากข้อมูลเอง** (ไม่ hardcode ตัวเลขช่อง):
- `channelConvRate` = ผลรวมออเดอร์ ÷ ผลรวมวิว ของคลิปที่มีทั้งสองอย่าง (ปัจจุบัน ≈ 0.19%)
- `medianViews` = median ของวิวจากคลิปที่มีข้อมูลวิว

**Guard ก่อนตัดสินทุกกรณี** (ได้จากการทดลองกับข้อมูลจริง):
- ต้องมีวิว ≥ **500** ถึงจะคำนวณ conv (ไม่งั้น 1 ออเดอร์บน 50 วิว = conv 2% หลอกตา)
- ต้องมีออเดอร์ ≥ **2** ถึงจะเคลมเรื่อง conv
- `badRatio` (ไม่มีสิทธิ์ + คืนของ ÷ ออเดอร์ทั้งหมด) < **0.3**

**4 detector:**

| kind | เงื่อนไข | headline สื่อว่า |
|---|---|---|
| `emerging` | `viewDelta ≥ medianViews` **และ** conv ≥ 0.8 × channelConv | กำลังมา — ทำ angle ใหม่ซ้ำตอนนี้ |
| `hidden-gem` | conv ≥ 1.3 × channelConv **และ** วิว < medianViews | ของดีแต่คนไม่เห็น — ทำใหม่/ดันด้วยแอด |
| `reach-no-convert` | วิว ≥ 2 × medianViews **และ** conv ≤ 0.5 × channelConv | คอนเทนต์ใช้ได้ แต่สินค้าไม่ผ่าน — เปลี่ยนสินค้า |
| `fading` | `viewDelta < 0.05 × totalViews` **และ** ไม่มีออเดอร์ใน 7 วัน **และ** เคยมีออเดอร์ ≥ 1 | หยุดแล้ว ไม่ต้องลงแรงต่อ |

**`viewDelta`** = ผลต่าง `views` ระหว่าง snapshot ล่าสุดกับ snapshot ก่อนหน้าของคลิปนั้น

เกณฑ์ตั้งใจให้ **self-scaling ตามขนาดช่อง** ไม่ hardcode ตัวเลขวิว:
- `emerging` ใช้ `viewDelta ≥ medianViews` — คือ "รอบเดียวได้วิวเพิ่มมากกว่าที่คลิปทั่วไปได้ทั้งชีวิต"
  (ตอนนี้ medianViews ≈ 1,741 → ต้องเพิ่ม ≥1,741 วิวในรอบนั้น) พอช่องโตขึ้น เกณฑ์ก็ขยับตามเอง
- `fading` ใช้สัดส่วนของยอดสะสมตัวเอง (< 5%) แทนเลขคงที่ เพื่อให้คลิปใหญ่กับคลิปเล็กตัดสินด้วยมาตรฐานเดียวกัน

**กรณีมี snapshot เดียว** (import ครั้งแรก — สถานการณ์จริงตอนเริ่มใช้): คำนวณ `viewDelta` ไม่ได้
→ ข้าม `emerging` และ `fading` ไปก่อน ใช้ได้เฉพาะ `hidden-gem` / `reach-no-convert` ซึ่งไม่ต้องใช้ delta
UI ต้องบอกผู้ใช้ว่า "สัญญาณด้านความเคลื่อนไหวจะใช้ได้หลัง import รอบที่ 2"

### 4. Server Action — `importClipMetrics`

ใน `app/actions.ts` แบบเดียวกับ `importAffiliateOrders`:
- รับไฟล์ CSV → parse → จับคู่ videoId กับ `PromptEntry.videoUrl` → upsert ตาม `(videoId, capturedOn)`
- คืนสรุป: จำนวนแถว, จับคู่ได้กี่อัน, ไม่จับคู่กี่อัน
- `revalidatePath("/")`

### 5. UI

**`components/recommendations.tsx` (ใหม่)** — section แยกใน Dashboard ไม่ยัดใน reminder banner เดิม

เหตุผล: reminder = "งานบ้านที่ต้องทำแล้วจบ" (ยังไม่ import / คลิปไม่มีรายได้) ส่วน signal = "insight
เชิงกลยุทธ์ที่อยู่ยาว" คนละ lifecycle เอาปนกันแล้วผู้ใช้จะเริ่มมองข้ามกล่องเตือนทั้งกล่อง
และ reminder ตอนนี้แบก 3 เงื่อนไขอยู่แล้ว

- แต่ละแถว: `ClipThumbnail` (ใช้ของเดิม) + ชื่อสินค้า + headline + ตัวเลขประกอบ
- เรียงตาม `strength`
- แถบเงียบๆ ด้านล่างบอกจำนวนคลิปที่ยังไม่มีข้อมูลวิว (ตอนนี้ 28/41) → กระตุ้นให้ export รอบใหม่
- empty state เมื่อยังไม่มี signal

**`components/dashboard-panel.tsx`** — เพิ่มช่องอัปโหลด `Content.csv` ข้างช่อง affiliate เดิม
พร้อมข้อความบอกที่มาของไฟล์ (TikTok Studio → Analytics → Content → Download)

**`components/production-panel.tsx`** — เพิ่มช่องเวลาโพสต์ (`<input type="time">`) ข้างช่องวันที่เดิม
บันทึกลง `postedTimeOfDay` ไม่แตะ logic ของ `postedAt`

### 6. เหตุผลที่ไม่ทำหน้า "เทียบก่อน-หลัง import"

ผู้ใช้ถามถึงเรื่องนี้ — คำตอบคือ **เก็บประวัติ = จำเป็น / หน้าจอเทียบ = ไม่จำเป็น**

การเก็บ snapshot (ข้อ 1) เป็นข้อกำหนดทางเทคนิค ไม่ใช่ฟีเจอร์ UI ส่วนการ "เห็นว่าดีขึ้นหรือแย่ลง"
ถูกตอบผ่าน signal ของ recommender อยู่แล้ว (`emerging` = ดีขึ้น, `fading` = แย่ลง) ซึ่งโผล่ตรงจุดที่
ใช้ตัดสินใจจริง หน้าจอตารางเทียบตัวเลขแยกต่างหากจะซ้ำซ้อนและเป็นหน้าที่เปิดครั้งเดียวแล้วไม่กลับไปอีก

ฝั่ง `AffiliateOrder` ไม่ต้องเก็บ snapshot เพราะมี `orderDate` ต่อแถวอยู่แล้ว

## ไฟล์ที่แตะ

- `prisma/schema.prisma` — `ClipMetric` + `PromptEntry.postedTimeOfDay` + back-relation (+migration)
- `lib/clip-metrics.ts` (ใหม่) — CSV parser
- `lib/recommender.ts` (ใหม่) — detector ล้วน
- `app/actions.ts` — `importClipMetrics` + บันทึก `postedTimeOfDay` ใน `updateProduction`
- `components/recommendations.tsx` (ใหม่) — section แสดงผล
- `components/dashboard-panel.tsx` — ช่องอัปโหลด CSV
- `components/production-panel.tsx` — ช่องเวลาโพสต์
- `app/page.tsx` — ดึง `ClipMetric` ส่งเข้า workspace

## Constraints (จาก CLAUDE.md)

- Next.js 16 custom build — Server Actions/form ทำงานเหมือน v15 คลาสสิก (ยืนยันแล้ว)
- Prisma 7 + driver adapter · import client จาก `@/lib/generated/prisma/client` · หลังแก้ schema
  รัน `npx prisma migrate dev` + `npx prisma generate`
- **ห้ามแตะ `postedAt` semantics** และห้ามสลับ `toDateInputValue` / `toLocalDateInputValue`
- **runtime LLM ต้องเป็น Gemini free tier เท่านั้น** — ฟีเจอร์นี้ไม่เรียก LLM เลยจึงไม่กระทบโควตา
- ห้าม DELETE/UPDATE ไม่มี WHERE บน `dev.db` (ไม่มี backup)
- ไม่มี test runner — verify ด้วย `npm run build` + `npm run lint` + รันจริง
- **ห้ามรัน `npm run build` ตอนที่ผู้ใช้เปิด `start.bat` อยู่** (`.next` พังได้) — เช็ก port 3000 ก่อนเสมอ
- ห้าม emoji ใน UI · ข้อความไทย · ใช้ design token เดิม (`ink`/`marigold`/`rust`/`smoke`/`record`)
- `creative_data/` ต้องถูก gitignore (ข้อมูลส่วนตัว) เหมือน `affiliate_orders_*.xlsx`

## Verification

- `npm run build` + `npm run lint` สะอาด
- import `creative_data/Content_rainny0192/Content.csv` จริง → parse ได้ 15 แถว จับคู่ได้ **13**
  ไม่จับคู่ 2 (คลิปเก่าก่อนขายของ)
- import ไฟล์เดิมซ้ำ → ไม่เกิด snapshot ซ้ำ (unique constraint ทำงาน)
- signal ที่ออกมาต้องตรงกับที่คำนวณมือไว้จากข้อมูลจริง:
  - **กระปุกกรองน้ำมัน** (conv 0.289% = 1.5× ช่อง, วิว 1,038 < median) → `hidden-gem`
  - **ชั้นวางของในครัว** (2 ออเดอร์, badRatio 0.5) → **ไม่ติดธงใดๆ** (guard ทำงาน)
  - **ชามสแตนเลส** (conv 0.067% = 0.35× ช่อง แต่วิว 1,494 ไม่ถึง 2× median) → ไม่ติด `reach-no-convert`
- คลิปที่ไม่มีข้อมูลวิว (28 ตัว) ต้องไม่ทำให้ crash และถูกนับในแถบ "ยังไม่มีข้อมูลวิว"
- ข้อมูลเดิมใน `dev.db` (41 entries / 209 orders / CorePrompt) ต้องไม่หาย

## Git

แตก branch ใหม่จาก `master`: `feature/recommender`
