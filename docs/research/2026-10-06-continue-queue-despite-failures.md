# บอทไม่ต้องหยุดทั้งคิวเมื่อสินค้าตัวเดียวพัง — วิจัย 2026-10-06

คำถาม: มีทางที่ดีกว่าการหยุดทั้งคิวไหม ถ้าสินค้าบางตัวพัง บอทก็ยังควรทำงานต่อ
ป้าย: **[ข้อเท็จจริง]** = มีแหล่งอ้างอิงหรือตัวเลขจากเครื่องนี้ · **[ความเห็น]** = การตัดสินใจของผู้เขียน

## 1. ระบบคิวงานที่ใช้กันทั่วไปแยก "งานนี้เสีย" ออกจาก "ระบบปลายทางป่วย"

- **งานเสีย → ลองซ้ำงานนั้นแบบเว้นระยะยาวขึ้นเรื่อยๆ ครบจำนวนครั้งแล้วจอดไว้ แล้วคิวทำงานอื่นต่อ** [ข้อเท็จจริง]
  - AWS SQS: งานถูกย้ายไป dead-letter queue เมื่อถูกหยิบเกิน `maxReceiveCount` ครั้ง และ "DLQs are useful for debugging… you can isolate unconsumed messages" [1]
  - Sidekiq: ลองซ้ำ 25 ครั้งในราว 21 วัน ครบแล้ว "move that job to the Dead Job queue, assuming that it will need manual intervention" [2]
  - Temporal: ค่าเริ่มต้นเว้นระยะ 1 วิ แล้วคูณ 2.0 · error ที่ตั้งเป็น non-retryable คือ "bad input data" ที่ "should be surfaced immediately" [3]
  - BullMQ: มีตัวเลือก `attempts` และ backoff แบบ fixed/exponential พร้อม jitter [4]
- **ระบบปลายทางป่วย → หยุดทั้งคิวชั่วคราว ไม่ใช่โทษว่างานนั้นเสีย** [ข้อเท็จจริง]
  - BullMQ: ถ้า API ภายนอกตอบ 429 ให้เรียก `worker.rateLimit(duration)` แล้ว `throw Worker.RateLimitError()` งานจะกลับไปรอในคิว ไม่ถูกตีเป็นงานพัง และการจำกัดนี้ใช้กับทั้งคิว [5]
  - Circuit breaker (Microsoft Azure Architecture Center) [6] มี 3 สถานะ
    - **Closed**: นับความล้มเหลวล่าสุด ถ้าเกินเกณฑ์ภายในช่วงเวลาที่กำหนดจะเปลี่ยนเป็น Open แล้วเริ่มจับเวลา
    - **Open**: ปฏิเสธทันทีโดยไม่เรียกปลายทาง
    - **Half-Open**: เมื่อหมดเวลา ปล่อย "a limited number of requests" ลองผ่าน ถ้าผ่านก็กลับเป็น Closed ถ้าพังก็กลับเป็น Open แล้วเริ่มจับเวลาใหม่
  - Azure เขียนไว้อีกว่าเวลารอ Open เพิ่มขึ้นได้ ("a few seconds initially… increase… to a few minutes") ควรมี **manual override** ให้คนปิดหรือเปิดวงจรเอง และ "Accelerated circuit breaking" คือ error บางชนิดบอกให้ตัดวงจรทันทีและค้างไว้ขั้นต่ำช่วงหนึ่ง [6]
- **เวลาลองซ้ำ** [ข้อเท็จจริง]
  - Google SRE: "Always use randomized exponential backoff", "Limit retries per request", "Don't retry permanent errors" [7]
  - Google Cloud: รอ `min((2^n)+random_number_milliseconds, maximum_backoff)` ส่วนสุ่มมีไว้กันไคลเอนต์หลายตัว "retry at once, sending requests in synchronized waves" [8]
  - AWS: "Full Jitter" `sleep = random_between(0, min(cap, base * 2 ** attempt))` [9]

## 2. สัญญาณที่แยก "คำขอนี้พัง" ออกจาก "เราโดนจำกัดหรือโดนบล็อก"

- **429** = "the user has sent too many requests in a given amount of time" และ "MAY include a Retry-After" (RFC 6585 §4 ตัวอย่างใช้ `Retry-After: 3600`) [10] · **Retry-After** มีได้สองรูป คือ HTTP-date หรือจำนวนวินาที (RFC 9110 §10.2.3) [11] [ข้อเท็จจริง]
- **403**: "The client SHOULD NOT automatically repeat the request with the same credentials" (RFC 9110 §15.5.4) [11] · **503** = "temporary overload… likely be alleviated after some delay" (§15.6.4) [11] [ข้อเท็จจริง]
- Google AIP-194 [12] [ข้อเท็จจริง]
  - `UNAVAILABLE` "generally transient" ลองซ้ำได้
  - `RESOURCE_EXHAUSTED` "Retries… may not be expected to work for several hours"
  - `PERMISSION_DENIED` "should not retry"
- **ตรวจสอบไม่ได้:** Google ไม่ได้เผยแพร่เอกสารเกณฑ์จับบอท โควตา หรือความหมายของ status ของ RPC `batchexecute` ในหน้าเว็บ Flow · ไม่รู้ว่า Flow ส่ง `Retry-After` มาด้วยหรือไม่ · ตัวเลข ~14 ครั้ง/10 นาที มาจาก gflow-cli ซึ่งเป็นเครื่องมือของบุคคลที่สาม ไม่ใช่เอกสารของ Google

## 3. หลักฐานจากเครื่องนี้ (อ่านอย่างเดียว)

ข้อมูลมาจาก `flow-worker.log` (ตั้งแต่ 2026-09-17), หลักฐานใน `uploads/_flow-failures/` 24 ชุด และ `FlowActivity` (ตั้งแต่ 2026-10-01) [ข้อเท็จจริง]

- **คิวหยุดไปแล้ว 16 ครั้ง** แยกตามสาเหตุดังนี้
  - selector_drift 6
  - generation_timeout 3
  - flow_error 3
  - worker_crash ที่ open-flow (เน็ต) 3
  - download_failed 1
- **พังจริงทั้งระบบแค่ 3 ครั้ง** คือ switch-image-mode วันที่ 21–22 ก.ย. ซึ่ง Flow เปลี่ยนหน้า งานถัดไปก็พังแบบเดียวกัน และต้องแก้โค้ดถึงจะหาย
- **บั๊กโค้ดของบอทเอง 1 ครั้ง** คือ find-video รอบ 4
- **อีก 12 ครั้งหายเมื่อกดรันต่อครั้งเดียว หรือเมื่อย้ายไปทำงานอื่น**
  - generation_timeout ผ่าน 3 ใน 3
  - flow_error ผ่าน 3 ใน 3
  - เน็ตสะดุด ผ่าน 3 ใน 3
  - download_failed ผ่าน 1 ใน 1
  - attach-reference ผ่าน 1 ใน 1
  - goto timeout 1 ครั้ง ซึ่งยังค้างอยู่ตอนนี้
- **สัญญาณบอทไม่เคยเกิดเลย:** ไม่มี captcha, login_required, HTTP 403 หรือ 429 (`bot_signal`/`http_warn` = 0 และใน log ไม่มีคำว่า captcha)
- **เวลาตั้งแต่คิวหยุดจนเริ่มงานถัดไป** เช่น 18.4, 21.2, 28.1 และ 43.4 ชม. รวมราว 117 ชม. ตัวเลขนี้เป็นเพดานบน เพราะนับรวมช่วงที่ผู้ใช้นอนหรือปิดบอทด้วย
- **ตอนนี้คิวหยุดอยู่:** หยุดเป็น `selector_drift` ตั้งแต่ 2026-10-06 18:54 น. เวลาไทย ที่งาน "ผ้าห่มลายนูน" (page.goto timeout) มีงานรออยู่ 3 งาน (queued_r2 2 งาน, queued_r3 1 งาน)
  - งานนี้พังก่อน commit `cb72687` (21:04 น.) ซึ่งตอนนี้ตีเคสแบบนี้เป็นเน็ตสะดุดและข้ามงานให้แล้ว
  - ปุ่ม "ให้บอททำงานอื่นต่อ" ไม่ขึ้น เพราะเหตุหยุดเป็น selector_drift ผู้ใช้ต้องกด "รันต่อ" หรือ "ข้าม" ที่งานนั้นเอง
- **ข้อจำกัด:** มีข้อมูลแค่ 16 เหตุการณ์ในราว 3 สัปดาห์ จึงใช้บอกได้แค่ทิศทาง ใช้คำนวณอัตราที่แม่นยำไม่ได้

## 4. ข้อเสนอสำหรับบอทนี้ [ความเห็น ยกเว้นที่อ้างอิงไว้]

### ก. ชนิดที่เป็นปัญหาของงานนั้น → จอดงานไว้ แล้วทำงานถัดไปเลย (ไม่ลองซ้ำงานนั้นเอง)

- ชนิดที่จอดได้
  - ที่มีอยู่แล้ว: `flow_error` ที่ wait-*, เน็ตสะดุดที่ open-flow
  - เพิ่มใหม่: `generation_timeout`, `download_failed` ที่ download-preview, และด่าน "จำนวนรูปแนบไม่ตรง" ของ attach-reference (เป็นด่านตรวจข้อมูลของงานนั้น ยังไม่ได้กด Generate)
- จอดแบบเดียวกับตอนนี้: งานยังเป็น `failed` มีหลักฐานครบ และกด "รันต่อ" ได้ ซึ่งก็คือ dead-letter ของเรา
- ไม่ลองซ้ำงานนั้นเองตามกฎใน ADR 0002 · ถึงข้อมูลจะบอกว่าลองซ้ำครั้งเดียวมักผ่าน แต่จะเพิ่มทีหลังได้ โดยลองซ้ำครั้งเดียวที่ท้ายคิว แบบ maxReceiveCount = 2 [1]

### ข. ระบบปลายทางป่วย → ตัดวงจร แล้วลองใหม่เองตามเวลา (circuit breaker [6])

- **เกณฑ์เปิดวงจร:** งานพังติดกัน 2 งานโดยไม่มี `round_ok` คั่น ไม่ว่าจะพังชนิดไหน
  - ให้ใช้ตัวนับตัวเดียวแทนตัวนับแยกของ `auto_continue` และ `network_skip`
  - ตอนนี้ถ้าพังสลับชนิดกัน บอทข้ามติดกันได้ถึง 3 งาน
- **Open (หยุด):** ตั้ง `pausedReason` เหมือนเดิม และใช้ `nextWakeAt` ที่มีอยู่แล้ว (ไม่ต้องเพิ่มคอลัมน์) เป็นเวลาที่จะลองใหม่
  - เวลารอ = full jitter ระหว่าง 15 นาทีถึง `min(4 ชม., 15 นาที × 2^k)` [9] เมื่อ k = จำนวนครั้งที่ลองแล้วไม่ผ่าน
  - **ถ้าวงจรเปิดเพราะ 429:** เวลารอไม่ต่ำกว่า 1 ชม. และไม่ต่ำกว่า `Retry-After` [10][11] คูณสุ่ม 1.0–1.5 · งานที่โดน 429 ให้คืนเข้าคิว ไม่ตีเป็นงานพัง เหมือน `RateLimitError` ของ BullMQ [5]
- **Half-Open (ลองหนึ่งงาน):** เมื่อถึงเวลา `main()` ปลดการหยุดเอง แล้วทำงาน**ถัดไปในคิว 1 งาน** ไม่ใช่งานที่พัง
  - ผ่าน → กลับเป็นปกติ (Closed) และรีเซ็ต k
  - พัง → กลับไปหยุด (Open) และเพิ่ม k
  - ลองไม่ผ่านครบ 3 ครั้ง → หยุดถาวรรอคน และแจ้งเตือน
- ปุ่ม "รันต่อ", "ข้าม" และ "ให้บอททำงานอื่นต่อ" ยังอยู่ ใช้เป็น manual override [6]
- เปิดใช้กับ `worker_crash` (รวมเน็ตล่มครั้งที่ 3), `generation_timeout` และ `flow_error` ที่ติดกัน · ตอนเริ่มอาจให้ selector_drift ลองใหม่เองแค่ 1 ครั้ง ข้อมูลวันที่ 21 ก.ย. บอกว่าการรอไม่ได้ทำให้หายเอง

### ค. ต้องหยุดถาวรรอคนเสมอ

- **HTTP 403 และการ์ด "unusual activity"**: RFC 9110 ห้ามส่งคำขอซ้ำเองด้วย credentials เดิม [11] และ ADR 0002 ก็ให้หยุด · ตอนนี้ `blockKindForStatus` รวม 403 กับ 429 ไว้ใน `captcha` เดียวกัน จึงต้อง**แยกชนิดก่อน** ข้อ ข. ถึงจะแตะ 429 ได้
- **`login_required`** (ต้อง login ด้วยโปรไฟล์เดียวกัน รอไปก็ไม่หาย) และ **`host_unsupported`**
- **selector_drift ที่ลองใหม่แล้วยังพังที่ขั้นเดิม** (ต้องแก้โค้ด) และ **worker ล้มทั้งโปรเซส**
- **429 ที่เกิดซ้ำภายใน 24 ชม.**: ถ้า Google ตอบ 429 ซ้ำในเวลาสั้นๆ แปลว่ายังจำกัดอยู่ จึงให้หยุดถาวรแทนที่จะรอแล้วลองซ้ำ (AIP-194: RESOURCE_EXHAUSTED อาจไม่หายเป็นชั่วโมง [12])

**ความเสี่ยงที่ยังไม่รู้:** การให้บอทลองหน้า Flow เองตามเวลา จะถูก Google มองเป็นสัญญาณบอทหรือไม่ ยังตรวจสอบไม่ได้ เพราะไม่มีเอกสาร · ทางที่ใช้ได้ผลแน่ๆ คือข้อ ก. เพราะไม่มีการยิงคำขอซ้ำ

## 5. ทำแล้ว 2026-10-07

- **ข้อ ก.** จอดงานเพิ่ม `generation_timeout`, `download_failed` ที่ download-preview, ด่านจำนวนรูปแนบไม่ตรง · ตัวนับติดกันตัวเดียว จอดได้ไม่เกิน 2 งาน งานที่ 3 หยุด
- **ข้อ ข.** ลองงานถัดไปเองตามเวลา 15 → 30 → 60 นาที ±20% (ตามที่ผู้ใช้อนุมัติ แทน full jitter ในข้อเสนอ) เพดาน 4 ชม. ลองไม่ผ่านครบ 3 ครั้งหยุดรอคน · ใช้กับ `worker_crash`/`generation_timeout`/`flow_error`/`download_failed` เท่านั้น · selector_drift ไม่ลองเองเลย (ไม่ได้ทำ "ลองใหม่ 1 ครั้ง")
- **เพิ่ม:** เปิดบอทใหม่แล้วกู้การหยุดเพราะเน็ตสะดุด/โหลดหน้าไม่ทันเอง (รวมงาน "ผ้าห่มลายนูน" ที่ค้างอยู่)
- **ยังไม่ได้ทำ:** แยก 429 ออกจาก 403 (`blockKindForStatus` ยังรวมเป็น `captcha`) และกฎ `Retry-After`/429 ซ้ำใน 24 ชม. — ยังไม่เคยเจอ 429 จริง
- รายละเอียดและตาราง: `docs/agents/flow-bot.md` หัวข้อ "พังแล้วทำอะไร" · ADR 0002 บรรทัด 2026-10-07

## แหล่งอ้างอิง

1. AWS SQS DLQ — https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html
2. Sidekiq Error Handling — https://github.com/sidekiq/sidekiq/wiki/Error-Handling
3. Temporal Retry Policies — https://docs.temporal.io/encyclopedia/retry-policies
4. BullMQ Retrying failing jobs — https://docs.bullmq.io/guide/retrying-failing-jobs
5. BullMQ Rate limiting (manual rate-limit) — https://docs.bullmq.io/guide/rate-limiting
6. Microsoft Azure, Circuit Breaker pattern — https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker
7. Google SRE Book, Addressing Cascading Failures — https://sre.google/sre-book/addressing-cascading-failures/
8. Google Cloud Memorystore, Exponential backoff — https://docs.cloud.google.com/memorystore/docs/redis/exponential-backoff
9. AWS Architecture Blog, Exponential Backoff and Jitter — https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
10. RFC 6585 §4 (429) — https://www.rfc-editor.org/rfc/rfc6585
11. RFC 9110 §10.2.3, §15.5.4, §15.6.4 — https://www.rfc-editor.org/rfc/rfc9110
12. Google AIP-194 Automatic retry configuration — https://google.aip.dev/194

แหล่งที่ไม่ได้อ่านจากต้นฉบับ: หนังสือ *Release It!* (Nygard) ซึ่งเป็นต้นกำเนิด circuit breaker เพราะเข้าถึงไม่ได้ จึงใช้เอกสารของ Azure แทน
