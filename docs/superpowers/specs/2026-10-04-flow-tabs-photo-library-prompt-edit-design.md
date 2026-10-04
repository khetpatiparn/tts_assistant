# คิว Flow แบ่งแท็บ + คลังรูป + เปลี่ยนรูปต้นทาง + แก้พรอมต์ใน /flow

สรุปจาก grilling 2026-10-04 รอบที่สอง (คำศัพท์ดู `CONTEXT.md`: Source photo, Shop photos, Photo library, Flow queue, Render, Preview clip, Manual takeover, TTS folder) · ต่อจาก `2026-10-04-manual-takeover-and-posting-days-design.md` และรวมจุดแก้จากรีวิวของสเปกนั้นไว้ด้วย

## Problem Statement

หน้าคิว Flow รวมทุกอย่างที่รอผู้ใช้ไว้กลุ่มเดียว ("ต้องให้คุณดู" = เลือกรูปรอบ 1, เลือกรูปรอบ 2, ดูคลิป, งานพัง ปนกัน) ผู้ใช้ต้องไล่อ่านทีละแถวว่าแต่ละงานรออะไร

เมื่อ Flow วาดรูปจากรูปต้นทางออกมาไม่ดี ผู้ใช้เปลี่ยนรูปต้นทางไม่ได้ (ปุ่ม "เลือกรูปใหม่" ใน Showcase กดได้เฉพาะตอน Flow วาดไม่สำเร็จ/ถูกข้าม) ทำได้แค่ "วาดใหม่" ด้วยรูปเดิม ทั้งที่รูปจากร้านอื่นๆ ยังเก็บอยู่ในเครื่อง และรูปที่ Flow วาดในรอบเก่าก็ไม่มีที่ให้กลับไปดู (การส่งรูปต้นทางใหม่ด้วยวิธีเดิมยังเขียนทับไฟล์รอบเก่าด้วย)

เวลาอยากทำเองโดยไม่ให้บอททำคลิป หน้า entry ไม่มีรูปพร้อมใช้ เพราะรูปสินค้าในหน้า entry มาตอนเลือกรูปรอบ 2 เท่านั้น

ตอนดูคลิปตัวอย่างแล้วอยากปรับ 10-part prompt ก่อนเรนเดอร์ใหม่ ต้องสลับไปแก้ที่หน้า entry แล้วกลับมากดที่ /flow · ตอนโพสต์ต้องคัดลอกแคปชันและแฮชแท็กแยกกัน

## Solution

- หน้า `/flow` แบ่งเป็น **แท็บตามสิ่งที่ผู้ใช้ต้องทำ**: เลือกรูป (รอบ 1+2 มีป้ายรอบ) · ดูคลิป · พัง · บอทกำลังทำ/รอคิว (บอกว่าวาดรูปหรือเรนเดอร์คลิป) · เสร็จ/ข้าม — มีตัวเลขต่อแท็บ เปิดมาอยู่แท็บแรกที่มีงานรอผู้ใช้
- **คลังรูป** ในหน้า entry: รูปจากร้าน + รูปที่ Flow วาดทุกรอบ (รวมรอบที่ไม่ได้เลือกและที่วาดใหม่) — แต่ละรูป "เพิ่มเข้ารูปสินค้า" หรือ "ใช้เป็นรูปต้นทางใหม่" (ครอปก่อนได้ทั้งคู่)
- **เปลี่ยนรูปต้นทาง** ได้ตั้งแต่เลือกรูปรอบ 1 จนถึงก่อนเริ่มเรนเดอร์คลิป (รวมงานพังรอบ 1-2 และงานที่ถูกข้าม) จากคลังรูป, หน้า `/flow` และหน้า Showcase — งานเริ่มวาดรอบ 1 ใหม่ด้วยรูปใหม่ รูปที่วาดไปแล้วยังอยู่ในคลังรูป
- **ยืนยันรูปต้นทางแล้วรูปนั้นอยู่ในรูปสินค้าของหน้า entry ทันที** — เลือกรูปรอบ 2 แล้วรูปต้นทางนั้นถูกแทนด้วยรูปที่ Flow วาด 2 รูป รูปที่ผู้ใช้เพิ่มเองจากคลังรูปอยู่ต่อ · เปลี่ยนรูปต้นทาง = รูปในหน้า entry เปลี่ยนตาม
- **แก้ 10-part prompt ในหน้า `/flow`** ขั้นรอเรนเดอร์/งานพังรอบเรนเดอร์ ("บันทึก") และขั้นดูคลิป ("บันทึกแล้วเรนเดอร์ใหม่" 15 เครดิต) · ตรวจคำต้องห้ามกับพรอมต์ฉบับใหม่ · เก็บ log การแก้
- ปุ่ม **"คัดลอกแคปชัน + แฮชแท็ก"** ครั้งเดียวได้ทั้งคู่
- แก้จุดค้างจากรีวิวฟีเจอร์ "ทำต่อเอง"

## User Stories

แท็บของคิว Flow
1. As the owner, I want the Flow queue split into tabs by what I have to do, so that I see image choices and clip reviews separately
2. As the owner, I want a "เลือกรูป" tab holding both round-1 and round-2 choices with a round badge, so that one tab covers the same kind of decision
3. As the owner, I want a "ดูคลิป" tab for preview clips waiting for my approval, so that clip reviews never hide among image choices
4. As the owner, I want a "พัง" tab for failed jobs, so that failures stand out
5. As the owner, I want a "บอทกำลังทำ / รอคิว" tab that says whether each job is drawing images or rendering a clip, so that I know what the bot is busy with
6. As the owner, I want a "เสร็จ / ข้าม" tab, so that finished, taken-over and skipped jobs are out of my way but still reachable
7. As the owner, I want a count on every tab, so that I can see the workload at a glance
8. As the owner, I want the page to open on the first tab that has jobs waiting for me, so that I land where the work is
9. As the owner, I want the selected tab kept in the URL, so that reloading (the page auto-refreshes every 30 s) never throws me back to another tab
10. As the owner, I want the selected job to stay selected when it moves to another tab after an action, so that I don't lose my place
11. As the owner, I want jobs waiting for a prompt ("รอพรอมต์") shown in the bot tab with the existing "สร้างพรอมต์ตอนนี้" action, so that a stuck prompt is still visible

คลังรูป
12. As the owner, I want a photo library on the entry page, so that I can look back at every photo of the product at any time
13. As the owner, I want all shop photos imported from Showcase in the library, so that photos I didn't pick are never lost
14. As the owner, I want every image Flow drew for this product, from every round and redraw, in the library, so that a decent unchosen image can still be used
15. As the owner, I want the library to keep old Flow images after I change the source photo, so that starting over never deletes earlier work
16. As the owner, I want products not from Showcase to show only the Flow images section, so that the library is still useful for them
17. As the owner, I want "เพิ่มเข้ารูปสินค้า" on any library photo, so that I can add images for my own manual work or for "สร้างด้วย AI"
18. As the owner, I want to crop a library photo before adding it, so that I can cut out shop text or banners
19. As the owner, I want "ใช้เป็นรูปต้นทางใหม่" on any library photo while the source photo can still change, so that I can restart drawing from a better photo
20. As the owner, I want the library to make clear which photo is the current source photo and which are already product images, so that I don't add duplicates by accident

เปลี่ยนรูปต้นทาง
21. As the owner, I want to change the source photo from review of round 1 up to just before render starts, so that a bad drawing never forces me to take over
22. As the owner, I want changing the source photo to work on jobs that failed in round 1–2 or were skipped, so that I can retry a product with a different photo
23. As the owner, I want changing the source photo blocked while the bot is working on that job, so that the bot never overwrites my change
24. As the owner, I want changing the source photo to restart the job at round 1 with the new photo, so that both reference images come from the new photo
25. As the owner, I want a "เปลี่ยนรูปต้นทาง" action on the job in `/flow`, using the same picker and crop as Showcase and listing all shop photos, so that I can fix it where I notice the problem
26. As the owner, I want the Showcase "เลือกรูปใหม่" to follow the same rule (any stage before render, not just after failures), so that both pages behave the same
27. As the owner, I want extra prompt text kept or cleared the same way as "วาดใหม่", so that the new attempt starts clean unless I type something
28. As the owner, I want a source-photo change logged, so that I can later see how often my first photo choice fails

รูปสินค้าในหน้า entry
29. As the owner, I want the confirmed source photo added to the entry's product images immediately, so that I can work manually right away
30. As the owner, I want the auto-added source photo replaced by the two Flow images when I choose round 2, so that "สร้างด้วย AI" keeps getting clean images without shop text
31. As the owner, I want product images I added myself from the library kept when round 2 is chosen, so that my deliberate choices are never removed
32. As the owner, I want the auto-added source photo swapped when I change the source photo, so that the entry always shows the current one
33. As the owner, I want this to apply to products queued by screenshot from the entry page too, so that the behaviour doesn't depend on where the product came from

แก้พรอมต์ใน /flow
34. As the owner, I want the 10-part prompt on `/flow` editable while the job waits for render, so that the bot renders my improved prompt
35. As the owner, I want it editable after a preview clip, with "บันทึกแล้วเรนเดอร์ใหม่", so that saving and re-rendering is one click
36. As the owner, I want the 15-credit cost written next to "บันทึกแล้วเรนเดอร์ใหม่", so that I never spend credits by surprise
37. As the owner, I want it editable on a job that failed in the render round, so that I can fix the prompt before "รันต่อ"
38. As the owner, I want it read-only while the bot is rendering, so that my edit isn't silently ignored
39. As the owner, if the bot claims the job while I'm saving, I want the prompt still saved and a message that this render used the old prompt, so that I know the edit applies next time
40. As the owner, I want the claim checker to run on the edited prompt, so that banned words are caught before render
41. As the owner, I want the plain "เรนเดอร์ใหม่" (old prompt) still there, so that I can re-render without editing
42. As the owner, I want each prompt edit logged with the stage, the length change and whether I re-rendered, so that I can see later whether editing helps clips pass sooner
43. As the owner, I want edits from `/flow` to show on the entry page and vice versa, so that there is one prompt per product

โพสต์
44. As the owner, I want a "คัดลอกแคปชัน + แฮชแท็ก" button, so that one copy gives me the whole post text

จุดค้างจากรีวิว "ทำต่อเอง"
45. As the owner, I want the TTS-folder error shown after taking over a job that already has a clip, so that a failed folder creation is never silent
46. As the owner, I want the source photo copied into every TTS folder, so that it is always there as the spec promised
47. As the owner, I want taking over a job that just failed to always release the queue pause, so that the bot never stays stuck
48. As the owner, I want "ส่งเข้าโฟลเดอร์ TTS" pressed again to refresh the text files even when the clip didn't change, so that late caption/prompt edits reach the folder
49. As the owner, I want the list of takeover-able statuses defined in one place, so that a new status can't be forgotten in one copy

## Implementation Decisions

- **Tabs are a pure grouping.** A pure function in the Flow jobs module maps a job's status (+ round) to one tab key (`choose` / `clip` / `failed` / `bot` / `closed`) and orders tabs; the `/flow` route renders tabs from it. The tab is a URL search param (like the entry list); default = first of `choose`/`clip`/`failed` that has jobs, else `bot`. `awaiting_prompt` belongs to `bot`. The bot tab shows the round kind ("วาดรูป รอบ N" / "เรนเดอร์คลิป" / "โหลด 1080p").
- **"Change source photo" is a lifecycle transition on the existing job, not a new job.** `changeSource(job, now)` with gate `canChangeSource(status, round)` = review_r1, queued_r2, review_r2, awaiting_prompt, queued_r3, failed with round ≤ 2, skipped, and queued_r1 (not running_*; not round ≥ 3 once render started). Plan: status queued_r1, round 1, attempt + 1, all `chosen` flags cleared, failure fields cleared, extraPrompt set from input (normalised, empty by default), unpause when the job was failed. The new source photo is written with a **unique filename per attempt** and a new `source` row; earlier `source`/`candidate` rows and files are kept (they feed the photo library). Race-guarded conditional write like takeover. Activity kind `user_change_source` `{ fromStatus, round, attempt }`.
  - Showcase "เลือกรูปใหม่" uses this transition when a job exists (gate replaces the old "retry only after flow_error/skip" rule; captcha/blocked jobs stay excluded as today); it creates a new job only when the entry has no job.
  - The worker must keep working with multiple `source` rows: it uses the newest `source` row of the current attempt. Candidate filenames already include round+attempt, so attempts never overwrite each other.
- **Photo library is a read model.** A query builds `{ shopPhotos[], flowImages[] }` for an entry: shop photos from every Showcase row linked to the entry (dedup by sourceProductId, ordered), Flow images from every job/attempt of the entry (candidate rows, newest first, labelled round/attempt, chosen marked); each item flags "is current source" / "already a product image". Served through the existing uploads route.
- **Adding to product images** copies the (optionally cropped) file into the entry's upload folder and creates a `ProductImage` with an empty caption at the end of the sort order.
- **Auto source product image without a schema change.** The auto-added source photo is a `ProductImage` whose filename uses a reserved prefix; enqueue/changeSource replace that row (and its file); round-2 choose deletes it and adds the two Flow images as today. Rows without the prefix (user-added) are never touched automatically.
- **Prompt edit on `/flow`.** A server action `saveFlowPrompt(jobId, text, rerender)` writes `PromptEntry.chatgptOutput` (same field the entry page edits), allowed when the job is queued_r3, review_r3 or failed with round 3; with `rerender` (review_r3 only) it applies the existing re-render transition in the same transaction. If the job is already running_r3 the prompt is still saved and the result says the current render uses the old prompt. Logs `user_edit_prompt` `{ stage, lengthBefore, lengthAfter, rerender }`. The claim checker component reads the edited text live.
- **Copy caption + hashtags** = caption, blank line, hashtags (same joining as the post text, without the product name/ID).
- **Review fixes:** export error shown for every takeover; source photo copied into every TTS folder (bot and takeover); takeover race guard conditions on the exact status read (so unpause matches); re-export with an unchanged clip rewrites text files (only the clip copy is skipped); takeover statuses derived from one list in the lifecycle module (used by gate, adapter guard and UI); refusal message as one constant; UI uses lifecycle helpers instead of string-prefix checks.
- **Glossary:** Shop photos (รูปจากร้าน) and Photo library (คลังรูป) added to `CONTEXT.md`. No ADR (nothing hard to reverse).

## Testing Decisions

- Tests check outcomes: plans and rows after a transition, files/folders on disk after an export, and the read model's items — not call order.
- **Seam 1 — lifecycle (existing `check-flow-lifecycle.mjs` + `check-flow-lifecycle-db.ts`):** `changeSource` gate for every status/round, plan (attempt+1, chosen cleared, failed→unpause, extraPrompt), race guard returns 0 rows; takeover guard on exact status; prompt-save gate per status incl. running_r3; save+rerender in one transaction.
- **Seam 2 — TTS export on a temp folder (existing `check-clip-export-fs.mjs`):** source photo in every folder, re-export with same clip rewrites texts.
- **Pure checks (existing `check-flow-jobs.mjs`):** tab mapping for every status/round, default tab, bot-tab round labels; caption+hashtags copy text; auto-source filename prefix helper.
- **Photo library read model** on a DB copy (extend the lifecycle DB check or a sibling script run the same way): after changeSource the old candidates remain and are listed; shop photos dedup across Showcase rows; current source / already-added flags; round-2 choose removes only the auto source product image.
- **Worker**: a pure check that the source path picks the newest source row of the current attempt (no live Flow needed).
- UI: 1440px screenshots of `/flow` tabs, prompt editor states and entry-page library on the isolated dev server + `shot.mjs` 390/820/1440.

## Out of Scope

- Regenerating caption/hashtags after a prompt edit.
- Keeping full prompt history/versions.
- Changing the source photo after render started (use ทำต่อเอง + library instead).
- Handing a manually done step back to the bot.
- Deleting photos from the library or from disk.
- Uploading arbitrary new photos into the library (adding from the existing "เลือกรูปจากเครื่อง" on the entry page stays as is).

## Further Notes

- Older entries whose Flow images were overwritten by the old retry path cannot be recovered; the library shows what is on disk.
- The worker change (newest source row) touches bot code that only runs against live Flow — verify with the existing free smoke `s2`/`s3` after `flow-worker-stop.bat`.
