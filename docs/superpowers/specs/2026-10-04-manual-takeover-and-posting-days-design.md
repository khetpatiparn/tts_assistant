# ทำต่อเอง (Manual takeover) + โฟลเดอร์ TTS ตามวันโพสต์ + product ID

สรุปจาก grilling 2026-10-04 (คำศัพท์ดู `CONTEXT.md`: Manual takeover, Flow queue, TTS folder, Showcase)

## Problem Statement

บางครั้งผู้ใช้ไม่อยากรอบอท (บอทช้า หรือช่วงที่ว่างมากอยากทำเอง) จึงเข้าไปวาดรูป/ทำคลิปเองใน Google Flow บัญชีหลัก แต่งานนั้นยังค้างอยู่ในหน้าคิว Flow ทำให้หน้ารก และบอทอาจหยิบงานเดียวกันไปทำซ้ำจนเสียเวลา/เครดิต ปุ่มที่มีอยู่ไม่ตรงกับเจตนา: "ข้ามงานนี้" แปลว่าเลิกทำสินค้านั้น ส่วน "ทำคลิปเองแล้ว — ปิดงานนี้" กดได้เฉพาะขั้นทำคลิป

ผู้ใช้กำลังจะทำ "คลิปดอง" (เช่นทำ 20 คลิปในวันเดียวแล้วทยอยโพสต์) แต่โฟลเดอร์ TTS ตั้งชื่อตามวันที่กดส่ง คลิปทั้งหมดจึงกองอยู่วันเดียว ไม่รู้ว่าคลิปไหนสำหรับโพสต์วันไหน

ตอนปักตะกร้า สินค้าที่เพิ่มเข้า Showcase ทีละมากๆ ทำให้สินค้าเก่าถูกดันลงไปจนหายาก การค้นด้วย product ID เร็วกว่า แต่แอปไม่ได้แสดง product ID ให้คัดลอก

## Solution

- ปุ่ม **"ทำต่อเอง"** ในหน้าคิว Flow กดได้ทุกขั้นที่บอทไม่ได้กำลังทำงานนั้น กดครั้งเดียวตอนเริ่มทำเอง งานจบทันที (ไปกลุ่ม "เสร็จแล้ว" พร้อมป้าย "ทำเอง") บอทไม่แตะอีก และระบบสร้างโฟลเดอร์ TTS ของสินค้านั้นให้ทันทีพร้อมเปิด Explorer — มีรูปต้นทางให้ลากไปใช้ใน Flow ได้เลย
- โฟลเดอร์วันที่ในโฟลเดอร์ TTS หมายถึง **วันที่จะโพสต์**: ทุกการส่ง (คลิปที่บอททำเสร็จ และงานที่ทำต่อเอง) ลงวันถัดไปที่ยังไม่เต็ม เริ่มนับจากพรุ่งนี้ วันละ N คลิป (ค่าเริ่มต้น 4 ตั้งได้จากหน้า `/flow`) · กติกาการใช้: โพสต์โฟลเดอร์ที่เก่าที่สุดก่อน
- **Product ID** (เฉพาะสินค้าจาก Showcase) แสดงพร้อมปุ่มคัดลอกในหน้า `/flow` และหน้า entry และอยู่ใน `โพสต์.txt`
- บันทึกพฤติกรรมการทำต่อเองลงสมุดบันทึก Flow ไว้ดูภายหลัง (เป็นการเลือกของผู้ใช้ ไม่ใช่ตัวชี้ว่าบอทพลาด)

## User Stories

1. As the owner, I want a "ทำต่อเอง" button on any Flow job the bot isn't currently working on, so that I can do that product myself in Flow whenever I feel like it
2. As the owner, I want pressing "ทำต่อเอง" to end the job immediately, so that the queue page stops showing products I'm handling myself
3. As the owner, I want the bot to never pick up a job after I pressed "ทำต่อเอง", so that it doesn't draw or render the same product again and waste time or credits
4. As the owner, I want "ทำต่อเอง" available while the job is still queued for round 1, so that I can take over before the bot even starts
5. As the owner, I want "ทำต่อเอง" available while I'm choosing images (round 1 or 2), so that I can take over when none of the 4 images is good enough
6. As the owner, I want "ทำต่อเอง" available while the job waits for its prompt or for render, so that I can render the clip myself when I'm in a hurry
7. As the owner, I want "ทำต่อเอง" available while reviewing the preview clip, so that I can fix the clip myself instead of re-rendering
8. As the owner, I want "ทำต่อเอง" available on a failed job, so that a broken job doesn't block me from finishing that product by hand
9. As the owner, I want "ทำต่อเอง" on a failed job to release the queue pause, so that the bot continues with the other products (same as "ข้ามงานนี้")
10. As the owner, I want the button hidden or disabled while the bot is running that job, so that the bot doesn't overwrite my decision with its own result afterwards
11. As the owner, if the bot claims the job at the same moment I press the button, I want a clear Thai message instead of a silent half-state, so that I know which side won
12. As the owner, I want taken-over jobs grouped under "เสร็จแล้ว" with a "ทำเอง" tag, so that I can tell them apart from clips the bot finished
13. As the owner, I want "ข้ามงานนี้" to keep meaning "I gave up on this product", so that the two meanings never mix
14. As the owner, I want a single button instead of two (start/finish), so that I never have to come back to close a job
15. As the owner, I want the TTS folder for that product created as soon as I press "ทำต่อเอง", so that I don't have to make folders by hand
16. As the owner, I want Explorer to open on that folder right away, so that I can drag the images into Flow immediately
17. As the owner, I want the source photo always in the folder, so that I have something to draw from even if I take over before round 1
18. As the owner, I want the chosen round-1/round-2 images in the folder when they exist, so that I can render the clip myself without hunting for them
19. As the owner, I want the preview/final clip copied when the bot already made one, so that nothing the bot produced is lost
20. As the owner, I want `เสียงพากย์.txt` and `โพสต์.txt` included whenever the app already has the prompt and caption, so that my posting kit is complete
21. As the owner, I want to press "ส่งเข้าโฟลเดอร์ TTS" later (e.g. after running "สร้างด้วย AI") and have it update the same folder, so that late-arriving text joins the right product
22. As the owner, I want every TTS export (bot clip or takeover) placed in a posting-day folder, so that a batch of 20 clips made in one day spreads over the following days
23. As the owner, I want the first posting day to be tomorrow, so that clips made today form tomorrow's batch
24. As the owner, I want each day to hold at most N clips, so that each day folder is exactly one day of posting
25. As the owner, I want N to default to 4, so that it matches my 3–5 clips/day target
26. As the owner, I want to change N from the `/flow` page, so that I can adjust when my posting pace changes without editing files or rebuilding
27. As the owner, I want a day counted as full by the folders actually in it (including ones I made myself), so that manual folders and app folders share the same daily limit
28. As the owner, I want days that already passed to be ignored when picking a slot, so that new clips never land in a date that's already gone
29. As the owner, I want re-exporting a product to update its existing folder rather than allocate a new day, so that a product never appears in two day folders
30. As the owner, I want a deleted folder to get a fresh slot on the next free day, so that re-export after cleanup still works
31. As the owner, I want the product ID of Showcase products shown on the `/flow` job with a copy button, so that I can search it when adding the product to the basket
32. As the owner, I want the product ID on the entry page with a copy button, so that I have it while posting from the entry page too
33. As the owner, I want the product ID in `โพสต์.txt`, so that it travels with the clip into the TTS folder
34. As the owner, I want products not from Showcase to simply show no product ID, so that the UI stays clean
35. As the owner, I want every takeover logged with the stage I took over at and how long the job had waited, so that I can look at my own behaviour later
36. As the owner, I want the behaviour report to summarise takeovers by stage in neutral wording, so that it shows my habits without labelling them bot failures
37. As the owner, I want takeovers excluded from bot statistics such as "renders per approved clip", so that those numbers stay about the bot
38. As the owner, I want Showcase status to stay "กำลังทำ" until the clip link is pasted, so that taking over doesn't make a product look posted
39. As the owner, I want the manual-render panel (shown when auto-render is off) to use the same takeover action, so that there is one way to close a job I did myself

## Implementation Decisions

- **One lifecycle transition replaces "finish manually".** The Flow job lifecycle module gains `takeOver(job, now)` with a gate `canTakeOver(status)` (every open status except the running ones: queued_r1/r2/r3, review_r1/r2/r3, awaiting_prompt, queued_upscale, failed). The plan ends the job `done` with `finishedAt`, and unpauses the worker when the job was `failed`. The existing `finishManually`/`canFinishManually` are folded into it; its callers (the `/flow` detail and the manual-render panel) use the new transition.
- **Race with the bot is closed by a conditional write.** The adapter applies the takeover only where the status is still one of the allowed statuses (same pattern as `claim`'s where-guard); zero rows updated → Thai error "บอทเพิ่งเริ่มทำงานนี้ — รอให้เสร็จแล้วค่อยกดทำต่อเอง".
- **"ทำเอง" is derived, not stored.** No schema change: the tag comes from the latest FlowActivity `user_take_over` row of the job (same way the exported-folder path is derived today). Old `user_finish_manual` rows count as takeovers too.
- **New activity kind `user_take_over`** with detail `{ fromStatus, round, waitedMs }`; not counted in "ยิง Flow วันนี้". The behaviour report gains a neutral "ทำต่อเอง" section (count by stage); bot-quality figures exclude taken-over jobs.
- **TTS export module (`exportClip`) changes:**
  - The clip becomes optional. When the job has no clip file the folder is still made (takeover), with the source photo always copied (`รูปต้นทาง.<ext>`), plus chosen images, voiceover and post text when present. A plain bot export still requires a clip, as today.
  - The export record keeps `video: null` for clip-less exports, so a later press is always an `update` of the same folder (existing `exportAction` rule).
  - **Posting-day allocation replaces export-date naming** for new folders: scan day folders from tomorrow forward, the first day with fewer than N subfolders wins; slot number inside the day stays "highest existing + 1". Month folder follows the chosen day. Pure helper picks the day from `(existing folder counts by day, tomorrow, N)`.
  - `โพสต์.txt` gains the product ID line when known.
- **Takeover action (server):** apply `takeOver`, log `user_take_over`, then run the export with "allow no clip", log `user_export_clip`, open Explorer (respecting `CLIP_EXPORT_NO_OPEN`), revalidate `/flow`, `/showcase`, entry page. An export failure after the takeover succeeded must not undo the takeover — show the job as taken over and the export error message, with "ส่งเข้าโฟลเดอร์ TTS" to retry.
- **Daily quota setting** lives in a small gitignored JSON settings file read/written by a server action (no DB migration, no rebuild); default 4 when missing/invalid; integer 1–20. A compact control "โพสต์วันละ [N] คลิป" sits at the top of `/flow`.
- **Product ID source:** the Showcase row linked to the entry (`linkedEntryId` → `sourceProductId`), resolved in the queries that feed `/flow`, the entry page and the export; no new column.
- **Glossary:** "Manual takeover (ทำต่อเอง)" added to `CONTEXT.md`. ADRs untouched (no hard-to-reverse decision).

## Testing Decisions

- Good tests here check observable outcomes: the job row/plan after a transition, and the files/folders on disk after an export — never internal call order.
- **Seam 1 — lifecycle (existing):** pure plans in `check-flow-lifecycle.mjs` (gate for every status, failed → unpause, running statuses refused); DB parity in `check-flow-lifecycle-db.ts` (the old `finishManually` reference becomes the takeover reference for render-stage statuses; new statuses get new-only assertions, incl. the race guard returning 0 rows).
- **Seam 2 — TTS export against a temp folder (existing, `check-clip-export-fs.mjs`):** takeover with no clip (source photo only / with chosen images / with texts), re-export of a clip-less folder updates in place, posting-day allocation (tomorrow first, fills to N then next day, counts foreign folders, skips past days, month rollover, deleted folder → next free day, re-export never moves days), product ID line in `โพสต์.txt`.
- Pure day-picking helper also covered in `check-clip-export.mjs` (prior art for pure export helpers).
- UI: 1440px screenshot of `/flow` (takeover button, tag, quota control, product ID copy) on the isolated dev server + `shot.mjs` for 390/820.

## Out of Scope

- Handing a job back to the bot after doing a step by hand (e.g. upload my own images, let the bot render) — deferred until real use shows the need.
- Pulling the clip I rendered in my main Flow account back into the app.
- Moving folders automatically when a clip is posted, or re-dating folders of days I didn't post.
- A manual product-ID field for products not from Showcase.
- Searching inside Angle by product ID.

## Further Notes

- Showcase status is computed from the entry's clip link, so a taken-over product stays "กำลังทำ" until posted — intended.
- `start.bat`'s build fingerprint ignores the gitignored settings file, so changing N never triggers a rebuild.
- Posting-day folders change the meaning of the date in `Desktop\TTS\<เดือน>\<วัน>\` for every export from this release on; folders made before keep their export-date meaning.
