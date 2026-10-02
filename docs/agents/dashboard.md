# Revenue dashboard (`/dashboard`, ไฟล์จาก TikTok Studio)

ครอบคลุม: `components/dashboard-route.tsx` → `dashboard-panel.tsx`, `lib/dashboard.ts`, `lib/affiliate.ts`, `lib/clip-metrics.ts`, `lib/csv.ts`, `lib/import-log.ts`, `lib/recommender.ts`, `lib/tiktok-oembed.ts`, ตาราง `AffiliateOrder`/`ClipMetric`/`ImportLog`/`VideoThumbnail` · ข้อมูลทั้งหมดผู้ใช้โหลดมือจาก TikTok Studio (ไม่มี API)

## ออเดอร์และเงิน (`AffiliateOrder`, ไฟล์ xlsx)

- เก็บระดับต่อออเดอร์ dedup ด้วย `orderId` · `importAffiliateOrders` เป็น upsert ที่อัปเดตสถานะย้อนหลัง (รอ → ชำระแล้ว) **จึงให้ผู้ใช้ export ช่วงกว้างที่สุดเสมอ** — ช่วงแคบ = ออเดอร์เก่าที่เพิ่ง settle ไม่ถูกอัปเดต รายได้จริงต่ำกว่าความจริง
- **`lib/affiliate.ts` เป็นไฟล์เดียวที่รู้จัก SheetJS (`xlsx`)** — `sheet_to_json({header:1, raw:false})` อ้างคอลัมน์ตาม index (ไฟล์ใช้ inline strings ไม่มี sharedStrings, วันที่ `DD/MM/YYYY HH:MM:SS`) · คอลัมน์: 0=orderId 2=ชื่อ 3=รหัสสินค้า 5=จำนวน 13=สถานะ 17=รหัสเนื้อหา 23=GMV 34=ค่าคอมจริง 44=รายได้สุดท้าย 45=วันที่
- **จับคู่ออเดอร์กับคลิปด้วย content ID (col 17) = video id ใน `PromptEntry.videoUrl`** (`videoIdFromUrl`) — สินค้าเดียวมีได้หลายคลิป ชื่อสินค้าจึงใช้จับคู่ไม่ได้
- **GMV ≠ เงินจริง** — `summarizeOrders` (`lib/dashboard.ts`) คืน field แยกครบ: `totalGmv` (ทุกสถานะ) · `settledRevenue` (`finalRevenue` ที่สถานะ `PAID_STATUS` = `"ชำระแล้ว"`) = "เงินที่ได้จริง" เป็นพระเอกของหน้า · "กำลังรอ" = `pendingGmv` + `estimatedPendingCommission` (= pendingGmv × อัตราจริง) · หัวหน้าไม่โชว์ GMV รวม
- **`revenueByClip` (`components/revenue-by-clip.tsx`) แบ่งเงิน 3 ทาง (จ่ายแล้ว/รอ/ไม่มีสิทธิ์ `INELIGIBLE_STATUS`) ให้ตรงกับ `summarizeOrders` เสมอ** — แก้ตรรกะฝั่งใดต้องเช็กอีกฝั่ง (เคยโยน "ไม่มีสิทธิ์" ไปปนกับ "รอ")
- `createEntryFromOrder` สร้าง entry ขั้นต่ำจากออเดอร์ที่ยังไม่มีในแอป แล้ว `updateMany` ผูก `matchedEntryId` ให้ทันที
- ไฟล์ตัวอย่างจริง `affiliate_orders_*.xlsx` gitignore ไว้ — อยู่นอก commit เสมอ

## วิวคลิป (`ClipMetric`, ไฟล์ `Content.csv`)

- **`lib/csv.ts` (`parseCsvRows`/`parseMonthDayLabel`) คือ parser CSV ของ TikTok Studio ที่ใช้ร่วมกัน** (`lib/clip-metrics.ts` ใช้อยู่) — parser CSV ใหม่ import จากตรงนี้ (มี BOM-strip/quoted-field แล้ว) · xlsx แยกอยู่ `lib/affiliate.ts` เพราะคนละ format
- **`Content.csv` ให้สูงสุด 15 แถวเสมอ** ไม่ว่าเลือกช่วง 7/28/60/365 วัน — คือ "ท็อป 15 ตามวิว" ของช่วงนั้น ไม่ใช่คลิปทั้งหมด (60 วัน: 15 แถว วิว 67,703→1,159 · 7 วัน: 15 แถวคนละชุด วิวต่ำถึง 321)
- **เลี่ยงเพดาน: export หลายช่วงในวันเดียวกันแล้วอัปทั้งหมด** — `ClipMetric` unique ที่ `(videoId, capturedOn)` และ `capturedOn` มาจากคอลัมน์ `Time` (วันที่ export) ไฟล์วันเดียวกันจึงรวมเป็น snapshot เดียว (พิสูจน์แล้ว 15+15 → 23 คลิป) · ชุดช่วงที่ใช้: 7 + 28 + 60 วัน (`EXPECTED_CLIP_FILES` = 3 ด้านล่าง; ช่วง 365 วันได้คลิปชุดเดียวกับ 60 วันเป๊ะ) · สัปดาห์ที่ลงคลิปเกิน ~12 ให้ export กลางสัปดาห์เพิ่มอีกรอบ ไม่งั้นคลิปวิวน้อยหลุดเพดาน
- **สถิติจากวิวเอียงขึ้นเสมอ** เพราะคลิปที่หลุดเพดานคือคลิปวิวน้อยอย่างเป็นระบบ (median วิวของช่องจากท็อป 15 = 1,828 · เติมคลิปวิวน้อยแล้วเหลือ 1,538) — ยิ่งอัปครอบคลุมยิ่งแม่น · ค่าเฉลี่ยข้ามกลุ่มถูกครอบงำโดย outlier 2–3 ตัว

## Log การนำเข้า (`ImportLog`, `lib/import-log.ts`)

- 1 แถวต่อ 1 ไฟล์ที่อัปสำเร็จ (สรุปหลังอัปเดิมอยู่ใน `useActionState` แล้วหายตอน refresh) · `ImportLogPanel` (`components/import-log-panel.tsx`) ใต้ฟอร์มอัปโหลด แสดงลายเซ็น/เวลาของไฟล์ล่าสุดที่อัปจริงต่อชนิด (รายได้/วิวคลิป) ไม่ทำนาย "รอบถัดไป" · มีเตือน inline "เกินกำหนดมา N วัน" สำหรับ orders/clips (ใช้ `IMPORT_STALE_DAYS`)
- `groupLatestRound` ยึด "วันล่าสุดต่อชนิดไฟล์" (แต่ละไฟล์มีรอบไม่เท่ากัน)
- **`uploadedAt` เป็น timestamp จริง → ตัดวันด้วย local getter** (บั๊กคลาสเดียวกับ `toDateInputValue`/`toLocalDateInputValue` ใน CLAUDE.md)
- **`lib/import-log.ts` ถูก import โดย client component จึง import ได้เฉพาะโค้ดที่รันในเบราว์เซอร์ได้ (ไม่มี `node:*`)** — การ hash ไฟล์อยู่ใน `app/actions.ts`
- `importClipMetrics` รับหลายไฟล์ผ่าน `formData.getAll("files")` (field ชื่อ `files`) ไฟล์ที่อ่านไม่ผ่านถูกข้ามเฉพาะตัวนั้น
- **ไฟล์ซ้ำ (hash ตรง) แค่เตือน ให้อัปต่อได้** — ทุก importer เป็น upsert และการ import ซ้ำโดยตั้งใจเป็นงานจริง (เช่น re-import ย้อนหลังหลังแก้บั๊กวันที่)

## ส่วนประกอบของหน้า

- `lib/dashboard.ts` เป็น aggregation ล้วน (pure) และเป็นเจ้าของ `IMPORT_STALE_DAYS` (7 วัน ใช้ร่วมกันทั้งแถบเตือนและบรรทัดสถานะ)
- กราฟเส้นใน `components/revenue-charts.tsx` ใช้ **Recharts v3.9.2** (library กราฟตัวเดียวในแอป, สีผูกผ่าน `var(--color-*)` ของ Tailwind v4) — API ต่างจากตัวอย่างทั่วไปที่เป็น v2 ยึด prop shape จาก `node_modules/recharts/types/` · sparkline และ bar ราย-คลิปวาดเองด้วย SVG/div
- **แถบเตือน `components/reminder-banner.tsx`** อยู่ในหน้า dashboard เท่านั้น (`dashboard-panel.tsx` แสดงเมื่อ `reminderActive`) · เตือน 2 อย่าง: ข้อมูลเก่ากว่า `IMPORT_STALE_DAYS` / มีสินค้าขายได้ที่ยังไม่มี entry
- **thumbnail คลิปมาจาก TikTok oEmbed** (สาธารณะ ไม่ต้อง auth) — `lib/tiktok-oembed.ts` ไฟล์เดียวที่รู้จัก endpoint · cache ในตาราง `VideoThumbnail` (เก็บแม้ล้มเหลว `ok=false` กันยิงซ้ำ) · resolve ผ่าน Server Action `resolveThumbnail` (client เรียก lazy) · คลิปโดนลบ = ไอคอนแทน
- `components/recommendations.tsx` + `lib/recommender.ts` = แผงงานรายสัปดาห์ ใช้ช่วงความเชื่อมั่น (`lib/stats.ts`: Wilson / rate-ratio) แทนค่าคงที่ที่ปรับมือ (ตรวจด้วย `scripts/check-recommender.mjs`)

## ค่าคงที่ที่ผูกกับสเกลข้อมูล (ทบทวนเป็นระยะ)

- `MAX_BAD_RATIO` (`lib/recommender.ts`) เป็นสัดส่วน (scale-free) — ไม่ต้องทบทวน
- `IMPORT_STALE_DAYS` ผูกกับรอบ settlement ของ TikTok (7 วัน) — TikTok เปลี่ยนรอบเมื่อไหร่ ไม่มีอะไรเตือน ต้องแก้เอง
- `EXPECTED_CLIP_FILES` (3, `lib/import-log.ts`) = จำนวน `Content.csv` ต่อรอบ **ผูกกับการตัดสินใจว่า export ช่วงไหน (7+28+60) ไม่ใช่ค่าที่คำนวณได้** — วัดจากไฟล์จริง 4 ช่วง (2026-08-03): 7/28/60 เพิ่มคลิป 15/+8/+5 ส่วน 365 เพิ่ม 0 · เปลี่ยนชุดช่วงต้องแก้ค่านี้ตาม
- **threshold ใหม่ให้ปรับตัวเองตามข้อมูล หรือมี staleness check แนบมาด้วย** — บทเรียนจาก `CLIP_AWAITING_THRESHOLD` (เตือน "คลิปยังไม่มีรายได้ ≥3 ชิ้น") ที่ติด active ถาวรโดยไม่มีใครสังเกต เพราะอัตราปิดการขายจริงของช่องอยู่แถว 1-in-20 จนกลบเตือนอื่น (ถอดแล้ว)

## ฟีเจอร์ที่ถอดออกแล้ว — เงื่อนไขก่อนทำใหม่

- **"วิวทั้งช่อง"** (นำเข้า `Overview.csv`, `lib/channel-metrics.ts` + `lib/channel-reach.ts`, ตาราง `ChannelMetric`; ถอด 2026-08-03) — ดูรายคลิปไม่ได้ บอกแค่วิวรวมทั้งช่องต่อวัน คุณค่าไม่คุ้มพื้นที่ · ทำใหม่ให้เริ่มจาก `docs/superpowers/specs/2026-08-02-channel-reach-design.md` + `docs/superpowers/plans/2026-08-02-channel-reach.md` (มีบทเรียนเรื่องวันที่ไม่มีปีใน `Overview.csv`)
- **"เวลาโพสต์ vs วิว"** (`lib/post-time.ts`, `components/post-time-panel.tsx`, นำเข้า `FollowerActivity.csv`, ช่องเวลา/สวิตช์ "ตั้งเวลาโพสต์"; ถอด 2026-08-03 พร้อม `lib/video-id-time.ts`) — selection bias จากเพดานท็อป 15 ของ `Content.csv` · **ทำใหม่ได้เมื่อมีแหล่งวิวที่ครบทุกคลิปเท่านั้น**
- **"4 สัปดาห์ล่าสุด"** (`lib/weekly-scoreboard.ts` + `components/weekly-scoreboard.tsx`; ถอด 2026-08-04) — นับ "winner ใหม่" ต่อ `PromptEntry` id ตรงๆ แทนที่จะรวมสายเลือดผ่าน `duplicatedFromId`/`collectFamily` (คลิปที่ทำซ้ำจากสูตรขายดีถูกนับเป็นการค้นพบใหม่) · เงินรายสัปดาห์ถูก settlement lag (~1 สัปดาห์) กับ winner-domination กลบจนอ่านเป็นสัญญาณไม่ได้ · คอลัมน์ที่เหลือซ้ำกับการ์ดอื่น — สถิติต่อสินค้าใหม่ๆ ต้องรวมผ่าน `collectFamily` เสมอ
