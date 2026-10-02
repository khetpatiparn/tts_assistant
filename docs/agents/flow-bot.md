# Flow bot (`worker/`, หน้า `/flow`, `FlowJob`/`FlowJobImage`/`FlowWorkerState`/`FlowActivity`)

อ่านก่อน: `docs/adr/0002-flow-bot-drives-the-web-ui-on-a-backup-account.md` (ทำไมคุมหน้าเว็บบนบัญชีสำรอง) · `docs/adr/0003-flow-clip-files-are-captured-not-downloaded.md` (ทำไมดักไฟล์แทนดาวน์โหลด + เมาส์เส้นตรง) · คำศัพท์ (Flow queue, Render, Preview clip, Final clip, Backup account, TTS folder) อยู่ `CONTEXT.md`
spec/แผนรอบแรก: `docs/superpowers/specs/2026-09-06-flow-image-bot-design.md` · `docs/superpowers/plans/2026-09-06-flow-image-bot.md` · ความเร็ว: `docs/superpowers/specs/2026-09-30-flow-bot-speed-and-resilience-design.md` · Render + DOM จริงที่สำรวจสด: `docs/superpowers/specs/2026-09-30-flow-video-render-design.md`

## โปรเซสและวงจรชีวิตของบอท

- **บอทเป็นโปรเซสแยกจาก Next** (`worker/index.ts`) คุยกับเว็บผ่านตาราง `FlowJob`/`FlowJobImage`/`FlowWorkerState` เท่านั้น — `/flow` refresh ตัวเองทุก 30 วิ เพราะ worker เรียก `revalidatePath` ไม่ได้
- **worker import จาก `lib/` ได้** (`npm run flow-worker` = `tsx` ซึ่งอ่าน alias `@/` จาก `tsconfig.json`) เฉพาะโมดูลที่ไม่ผูกกับ Next (ไม่มี `next/*`, `"use server"`, `revalidatePath`) · พรอมต์ Flow 2 แบบตายตัวมีที่เดียวคือ `buildFlowPrompt` และรูปแบบลิงก์โปรเจกต์มีที่เดียวคือ `flowGoogleProjectUrl` (ทั้งคู่ใน `lib/flow-jobs.ts`) — บอทพิมพ์/เปิดด้วยฟังก์ชันเดียวกับที่หน้าเว็บโชว์ (`flow-driver.ts` และ `projectUrl` ของชุด `migrated` ใน `flow-selectors.ts` import ไปใช้) ไม่มีสำเนาให้แก้คู่กันแล้ว · `scripts/check-flow-jobs.mjs` ตรวจว่าไม่มีสำเนากลับมาใน `worker/`
- **สถานะของงาน (FlowJob) เปลี่ยนที่เดียวคือ `lib/flow-lifecycle.ts`** — ทุกจังหวะ (ผู้ใช้กดที่ Checkpoint: `choose`/`redo`/`approveRender`/`retryUpscale`/`resume`/`skip`/`finishManually` · บอท: `claim`/`imagesReady`/`previewReady`/`finalClipSaved`/`finalClipMissing`/`roundFailed` · เปิดบอท: `staleUpscale`/`staleRender`/`staleRunning`/`loginRecovered`) คืนแผน = แพตช์ของงาน + ลบ/สร้างแถวคลิป + ปลดการหยุด แล้ว `lib/flow-lifecycle-db.ts` (`applyPlan`/`applyBulk`) เขียนลง DB ในทรานแซกชันเดียว · `app/actions.ts` และ `worker/index.ts` ห้ามเขียน `flowJob`/`flowJobImage` หรือปลด pause เอง (`scripts/check-flow-lifecycle.mjs` ตรวจ) — ไฟล์บนดิสก์ / `revalidatePath` / `logUserActivity` / แจ้งเตือน / `pauseWorker` ยังอยู่ที่ผู้เรียก · gate ของปุ่ม (`canApproveRender`/`canRetryUpscale`/`canFinishManually`) และ `friendlyJobMessage` อยู่ไฟล์เดียวกัน (pure, client import ได้)
- **errorMessage ขึ้นต้น "ได้ 720p" = งานจบด้วย Preview clip** — โปรโตคอลในข้อความ (ไม่มีคอลัมน์แยก) เขียนด้วย `previewOnlyMessage` อ่านด้วย `isPreviewOnlyMessage` เท่านั้น (ทั้งคู่ใน `lib/flow-lifecycle.ts`)
- เปิด: `flow-worker.bat` หรือ `start.bat` (เปิดบอทให้ทุกครั้ง) · หยุด: `flow-worker-stop.bat` หรือ `stop.bat` — ทั้งคู่สร้างไฟล์ `.flow-worker.stop` ให้บอทจบเองหลังงานปัจจุบัน
- **เปิดซ้อนได้ปลอดภัยเพราะ `main()` เปิด Chrome ก่อนแตะ DB** — โปรไฟล์ `.flow-profile` เปิดได้ทีละโปรเซส ตัวที่สอง launch ไม่ขึ้นแล้ว `exit(0)` เงียบๆ (ยืนยันด้วยการเปิด 2 ตัวจริง) → **stale sweep และ `upsertState` ทุกตัวต้องอยู่หลัง `launchFlowBrowser`** ไม่งั้นตัวที่สองจะทำให้งานที่ตัวแรกกำลังวาดกลายเป็น failed
- **เปิดเองตอนเข้า Windows:** shortcut `Angle (start app + Flow bot).lnk` ใน `shell:startup` รัน `start.bat silent` = server + บอทโดยไม่เด้งแท็บเบราว์เซอร์ (ลบ shortcut ถ้าจะเลิก) · เน็ตมักยังไม่ต่อตอนเพิ่งเปิดเครื่อง บอทจึงลอง `openFlowAndSettle` ใหม่ทุก 30 วิ สูงสุด 10 ครั้ง **เฉพาะ error `net::ERR_*`** ครบแล้วยังไม่มีเน็ต = ปิดตัวเองโดยไม่ pause คิว
- **ติดตั้งเป็นแอป (PWA):** `app/manifest.ts` + `public/icons/` (ยืนยันด้วย CDP `Page.getInstallabilityErrors` = ว่าง) · เลือก PWA แทน Electron โดยตั้งใจ (เหตุผลในคอมเมนต์ของ manifest) · ไม่มี service worker โดยตั้งใจ · `components/flow-title-badge.tsx` (อยู่ใน `app/layout.tsx`) โพล `/api/flow-status` ทุก 30 วิ ใส่ `(N)`/`⚠` หน้าชื่อแท็บทุกหน้า และตัวเลขบนไอคอน taskbar ด้วย `navigator.setAppBadge` (เฉพาะตอนติดตั้งเป็นแอป)
- **server และบอทรันในหน้าต่างซ่อน** (`powershell Start-Process -WindowStyle Hidden` — ผู้ใช้ไม่อยากเห็น console บน taskbar) · output อยู่ `pp-server.log`/`flow-worker.log` · หยุดด้วย `stop.bat`
- **หน้าต่างที่เห็นมีแค่ Chrome ของบอท (headed) — ปล่อยให้เปิดค้างไม่ย่อ** (หน้าเพจเป็น hidden ขณะบอทคลิก = สัญญาณบอท) ย้ายไปไว้ข้างหลังได้
- **ผู้ใช้ปิดหน้าต่าง Chrome ของบอท = บอทออกเงียบๆ ไม่หยุดคิว** (`context.on("close")` + `closingOnPurpose`) → ทุกจุดที่โค้ดปิด browser เองต้องผ่าน `closeBrowser()` · ตอนเปิดบอท ถ้า pause ค้างอยู่แต่ไม่มีงาน `failed` เลย บอทปลดให้เอง (กันทางตันที่ไม่มีงานให้กด "รันต่อ")
- **session หลุด (`login_required`) = บอทปิดตัวเอง** ทั้งตอนเริ่มและกลางคิว เพราะ Flow Login ต้องใช้โปรไฟล์เดียวกัน รอค้างไว้ก็ login ไม่ได้ · ตอนเริ่มเช็ก login ก่อน `selectorSetForHost` (ไม่งั้นหน้า login ถูกรายงานผิดเป็น `host_unsupported`) · เปิดบอทใหม่แล้ว session ใช้ได้ → ปลด pause + คืนงาน `errorKind=login_required` เข้าคิวรอบเดิม (การเปิดบอทใหม่คือการกระทำของคน ไม่ขัดกฎ "ไม่ retry เอง")
- **แจ้งเตือนเมื่อบอทต้องการคน:** `worker/notify.ts` ยิง Windows toast (PowerShell 5.1 + WinRT ไม่ต้องติดตั้งอะไร) ตอนรูปรอบใดพร้อมให้เลือก และทุกครั้งที่ `pauseWorker` — fire-and-forget (ไม่ throw ไม่ await) · ปิดด้วย `FLOW_NOTIFY=0`

## บัญชีและการ login

- **login ผ่าน `flow-login.bat` (Chrome จริง ไม่ใช่ Playwright) ด้วยบัญชี Flow สำรองเท่านั้น** แล้วปิด Chrome ก่อนเปิด worker — Google ปฏิเสธ sign-in จาก browser ที่ automation เปิด · โปรไฟล์อยู่ `.flow-profile/` (gitignore) เปิดได้ทีละโปรเซส → สคริปต์ที่ใช้ Flow จริง (smoke, dl-spy) ต้อง `stop.bat` ก่อน
- **เปิดโปรเจกต์ของบอทจากเครื่องผู้ใช้ = Brave โปรไฟล์บัญชีสำรอง** (`openFlowProjectInBackupProfile` ใน `app/actions.ts`, ปุ่มใน `components/flow-job-parts.tsx`) — Brave ของผู้ใช้ล็อกอินบัญชีหลัก ลิงก์ธรรมดาจึงเปิดไม่ได้ · โปรไฟล์หาเองจาก `Local State` ของ Brave ด้วย `pickBackupBrowserProfile` (`lib/flow-jobs.ts`: ชื่อโปรไฟล์ match `flow|สำรอง|backup` และต้องเจอตัวเดียว ไม่งั้น null ไม่เดา) · ตั้งเองได้ด้วย `FLOW_BACKUP_BROWSER_PROFILE` / `FLOW_BACKUP_BROWSER_EXE` · ชี้ไปโปรไฟล์ Brave เสมอ ไม่ใช่ `.flow-profile` ของบอท (ชนกับบอทที่เปิดอยู่)
- **`components/manual-render-panel.tsx` (ทางทำคลิปเองในบัญชีหลัก) มีแต่ของที่เปิดในบัญชีหลักได้** — ไม่ใส่ลิงก์โปรเจกต์ของบอท ยกเว้นแถว "โหลดคลิปไม่ได้" ที่กำกับชัดว่า "เปิดโปรเจกต์ในบัญชีสำรอง"

## Selector และหลักฐานตอนพัง

- **selector ทั้งหมดอยู่ `worker/flow-selectors.ts` ไฟล์เดียว** 2 ชุด: `labs` (labs.google) · `migrated` (flow.google.com — ยืนยันครบรอบ 1–2 ด้วย E2E แล้ว) · selector ของวิดีโอทุกตัวอยู่ใน `video` ของชุด `migrated` และมาจาก DOM จริงใน spec Render — selector ใหม่ต้องยืนยันจาก DOM จริงเท่านั้น
- Flow เปลี่ยนหน้า → บอทพังที่ขั้นแรกที่หา element ไม่เจอ พร้อมหลักฐานใน `uploads/_flow-failures/<jobId>-<ts>/` (screenshot.png / page.html / steps.log / state.json) → แก้ selector ของขั้นนั้น → ยืนยันด้วย `npm run flow-smoke:s2 -- <รูป> "<ชื่อสินค้า>"` → กด "รันต่อ" ใน `/flow`
- **`attach-reference` พังแบบ `selector_drift` อาจเป็นของปลอมจาก `humanClick` ช้า (CPU แย่ง)** — แก้ต้นเหตุแล้วด้วย `prepareHumanClick` (`worker/humanize.ts`: หน่วง+เลื่อนเมาส์ก่อนเริ่มจับเวลา `waitForEvent("filechooser")`) ถ้ายังเจอ ให้กด "รันต่อ" เฉยๆ 1 ครั้งก่อน พังซ้ำที่ขั้นเดิมค่อยแก้ selector
- **promise ที่สร้างไว้รอแข่งกับอีกตัว (เช่น `uploadResponse` = `page.waitForResponse` คู่กับ `waitForEvent("filechooser")`) ต้องแนบ `.catch(() => {})` ทันทีที่สร้าง** — ไม่งั้นพอตัวคู่แข่ง throw ก่อน มันจะหมดเวลาทีหลัง (`uploadTimeoutMs` 120s) เป็น unhandled rejection ที่ฆ่าโปรเซส worker ทั้งตัว · `await` ตัวจริงยังโยน error ปกติ
- **Jev (TypeSafe) คือด่านสุดท้ายตอน selector พัง** — `firstVisible` ลอง CSS → `findByIntent` → `findByJev` (`worker/dom-heuristics.ts` + `worker/jev.ts`, key `TYPESAFE_API_KEY` ใน `.env`, ปิดด้วย `FLOW_JEV=0`) ส่งรายการปุ่มที่มองเห็น (มีชื่อ class) ให้ Jev เลือก รับเฉพาะความมั่นใจ ≥ `JEV_MIN_PROBABILITY` (0.93)
  - `JEV_INTENT` (ใน `worker/flow-driver.ts`) มีเฉพาะปุ่มที่กดผิดแล้วไม่เสียของ: สร้างโปรเจกต์/ตั้งค่า/แนบรูป/อัปโหลด/Add to prompt — Generate และช่องพิมพ์พรอมต์อยู่นอกรายการนี้เสมอ
  - บรรทัด "Jev เลือกปุ่มแทน selector…" ใน steps.log = Flow เปลี่ยนหน้าแล้ว → เอาคำอธิบายปุ่มไปแก้ selector ถาวรใน `flow-selectors.ts`
  - เรียก Jev ไม่ได้ (เน็ต/key/โควตา) = คืน null เงียบๆ พฤติกรรมเหมือนไม่มี Jev · ทดสอบย้อนหลังกับ page.html จริง 9 หน้า: ถูก 14 ผิด 0 ไม่กด 4 (ไม่หยิบปุ่ม "tune" ของ Agent เพราะไม่ถึงเกณฑ์)

## พังแล้วทำอะไร: นโยบายหยุดคิวและสัญญาณบอท

- **พังแล้วหยุดทั้งคิว บอทไม่ retry เอง (ตั้งใจ)** — ยิงซ้ำใส่หน้าที่พังคือสัญญาณบอทที่ชัดที่สุด (ADR 0002) · `errorKind` `captcha` (รวม HTTP 403) = พักอย่างน้อย 1 ชั่วโมงก่อนรันต่อ (gflow-cli: ~14 submissions/10 นาที → 403)
- **`worker/flow-signals.ts` (pure, ตรวจใน `npm run check:flow`) แยกสัญญาณบอทออกจาก `flow_error`:**
  1. `<flow-error-tile>` ใช้ทั้งตอนวาดพังและตอนโดนบล็อก → ข้อความการ์ดมี "unusual activity" = `captcha` (captchaSignals ดักทั้ง "unusual traffic" และ "unusual activity")
  2. โฮสต์ `dom` (flow.google.com): 401/403/429 ของ batchexecute หลังกด Generate = หยุด (404/500 ของ RPC อื่นไม่นับ เพราะ batchexecute รวมหลาย RPC)
  3. กด Generate แล้ว 45 วิไม่มีช่องใหม่ใน `flow-grid-tile-container`/`flow-pending-tile` = คลิกไม่ติด → หยุดและรายงาน (กด Generate ได้ครั้งเดียวต่อรอบ — กดซ้ำได้งานเจนซ้อน ตามที่ AI4Next พบ)
  - ไม่แน่ใจให้เอียงไปทาง `captcha` (พักยาว) เสมอ เพราะคำแนะนำของ `flow_error` คือ "กดรันต่อ" = ยิงซ้ำใส่หน้าที่บล็อกเรา
- **`wait-results`: Flow วาดไม่สำเร็จเอง (`<flow-error-tile>`, การ์ด "Failed... this image failed to generate", ไม่เสียเครดิต) = `flow_error` ภายในไม่กี่วินาที** แยกจาก generation_timeout จริง (`generationTimeoutMs` 5 นาที) · สาเหตุฝั่ง Flow ยังไม่รู้ (ชั่วคราว/โควตา/รูปอ้างอิง) · คำแนะนำผู้ใช้: "รันต่อ" 1 ครั้ง → พังซ้ำที่สินค้าเดิมให้ "ข้ามงานนี้" หรือเปลี่ยนรูปอ้างอิง (สินค้าจาก Showcase กด "เลือกรูปใหม่" ในแท็บ "กำลังทำ")

## จังหวะและเพดาน (`flow-worker.config.json`, แก้ได้ไม่ต้อง build)

- ค่าปัจจุบัน (เร่งแล้วตาม spec speed-and-resilience — ผู้ใช้ยอมรับความเสี่ยงบนบัญชีสำรอง หลัง 4 สัปดาห์ไม่เคยเจอสัญญาณโดนจับ): พักระหว่างสินค้า 30–90 วิ · พักยาว 5–10 นาทีทุก 12–16 สินค้า · `dailyBatchCap` 60 ชุด/วัน · `videoDailyCap` 20 คลิป/วัน · ดูค่าจริงในไฟล์
- ว่างนานเท่าพักยาวขั้นต่ำ = นับเป็นพักยาวแล้ว (`idleCountsAsLongBreak`)
- `actionDelayMs` / `typeCharDelayMs` / เส้นโค้งเมาส์ (`mouse.curve`) คงค่าเดิมไว้ — เป็นจังหวะมนุษย์ ไม่ใช่ปุ่มเร่งความเร็ว
- จังหวะของ extension AI4Next (ปิด auto-pause, ~15–20 ครั้ง/10 นาที) ไม่ใช่ต้นแบบของบอทนี้

## สมุดบันทึก `FlowActivity`

- **ฝั่งบอท** (`worker/activity.ts` fire-and-forget ไม่ throw · kind อยู่ `lib/flow-activity.ts`): ทุก Generate/อัปโหลด/สร้างโปรเจกต์/โหลด + HTTP 429/403/5xx (`http_warn`) + captcha/login (`bot_signal`) + พักจริง + config ตอนเปิดบอท · หน้า `/flow` โชว์ "ยิง Flow วันนี้ N · ถี่สุด X/10 นาที · สัญญาณเตือน"
- "ถี่สุด X/10 นาที" นับทุกคำขอ (อัปโหลด/สร้างโปรเจกต์/โหลด/Generate) — เทียบตรงๆ กับเกณฑ์ ~14 submissions/10 นาทีของ gflow-cli (นับเฉพาะ Generate) ไม่ได้
- **ฝั่งผู้ใช้** (เริ่มเก็บ 2026-10-01 ย้อนหลังไม่ได้): kind ขึ้นต้น `user_` (เข้าคิว/เลือกรูป/วาดใหม่/ผ่าน/เรนเดอร์ใหม่/ข้าม/รันต่อ/ปิดเอง/สร้างพรอมต์ตอนนี้/ส่งเข้าโฟลเดอร์) เขียนจาก server action ผ่าน `lib/flow-user-activity.ts` (ไม่ throw) · ไม่นับใน "ยิง Flow วันนี้" · `waitedMs` = เวลาตั้งแต่ `FlowJob.updatedAt` ก่อน action เขียนทับ
- **`node scripts/flow-activity-report.mjs <วัน>`** — สรุปทั้งสองฝั่ง (หัวข้อ "พฤติกรรมของคุณ": เรนเดอร์กี่ครั้งต่อคลิปที่ผ่าน, เครดิตต่อคลิป, รอผู้ใช้นานแค่ไหน) · **บัญชีโดนแบนเมื่อไหร่ รันสคริปต์นี้เป็นอย่างแรก** แล้วตั้งบัญชีใหม่ให้อยู่ใต้ความถี่ที่เห็น

## รอบ 1–2: วาดรูปอ้างอิง

- **ข้อความเพิ่มเติม `FlowJob.extraPrompt`** ผ่าน `normalizeExtraPrompt` (ยุบบรรทัดเป็นช่องว่างเพราะ Enter ในช่อง Flow = ส่ง · ≤200 ตัวเพราะบอทพิมพ์ทีละตัว) ต่อท้ายพรอมต์ตายตัวด้วยช่องว่างเดียว · **ว่าง = พรอมต์เดิมทุกตัวอักษร**
  - ตั้งได้ตอน "ทำคลิปตัวนี้"/"เลือกรูปใหม่" (Showcase) และ "วาดใหม่" · ช่องในหน้าคิวใช้กับ "วาดใหม่" ของรอบนั้นเท่านั้น
  - "ใช้รูปนี้ → รอบ 2" ล้าง `extraPrompt` เป็นค่าว่างเสมอ — ข้อความรอบ 1 มักสั่งเฉพาะภาพพื้นหลังขาว ติดไปรอบ 2 แล้วภาพตอนใช้งานออกมาเหมือนรอบ 1
  - ข้อความที่ใช้จริงของแต่ละชุดเก็บที่ `FlowJobImage.promptExtra` โชว์ใต้รูป
- **ภาพจุดเช็ก 4 จุดต่อรอบ** (ตั้งค่า / แนบรูป / พรอมต์ก่อนกด / ผลลัพธ์): `checkpoint()` ใน runRound เขียน `uploads/<entryId>/flow/checkpoints/r{round}-a{attempt}-{n}-{name}.jpg` (JPEG q55, ถ่ายด้วย CDP หน้าเว็บมองไม่เห็น, พังเองได้โดยไม่ทำให้งานพัง) · หน้า `/flow` "ดูขั้นตอนที่บอททำ" โชว์ attempt ล่าสุดที่มีภาพ (`listCheckpoints` ใน `lib/flow-queries.ts` อ่านจากชื่อไฟล์) · worker ลบไฟล์เก่ากว่า 14 วันตอนเปิด (`sweepOldCheckpoints`) ส่วน `_flow-failures/` เก็บไว้ตลอด
- `ProductImage` ถูกสร้างจาก Flow ที่เดียวคือ `chooseFlowCandidate` รอบ 2 (ก๊อป 2 ไฟล์ที่เลือก caption ตั้งต้น "สินค้า พื้นหลังขาว"/"สินค้าตอนใช้งาน") — pipeline อื่นไม่ต้องรู้จัก Flow

## รอบ 3–4: Render คลิป

- **ลำดับสถานะ:** เลือกรูปรอบ 2 (ก๊อปเป็น `ProductImage`) → `awaiting_prompt` (round 3, ล้าง `extraPrompt`) → `generateWithAI` บันทึก 10-part prompt สำเร็จแล้วย้ายเป็น `queued_r3` เอง → บอท Render (Video · Ingredients · 9:16 · Omni 1.1 Flash · 720p · 10s · x1 = 15 เครดิต, แนบรูปที่เลือก 2 รอบ) → โหลด Preview clip `r3-a<n>.mp4` → `review_r3` · "เรนเดอร์ใหม่" = attempt+1 ลบไฟล์+แถวตัวอย่างเก่าทิ้ง · "ผ่าน" = `queued_upscale` (round 4) → บอทกลับโปรเจกต์เดิม โหลด **1080p Upscaled** เป็น `r3-final.mp4` (แถวเดิม `chosen=true`) ลบตัวอย่าง → `done` · แถว kind `"video"` มีได้แถวเดียวต่องาน
- **พรอมต์ Render วางทั้งก้อนด้วย `insertText`** (`chatgptOutput` + ข้อความเพิ่มเติม) — ~3,000 ตัวพิมพ์ทีละตัวใช้หลายนาที และ Enter = ส่ง
- Gemini ล้มหลังเลือกรูปรอบ 2 → บอทลองสร้างพรอมต์ซ้ำเอง 1 ครั้ง · ผู้ใช้กด "สร้างพรอมต์ตอนนี้" ในแถว `awaiting_prompt` ได้
- **ลำดับหยิบงาน `claimOrder` (`lib/flow-jobs.ts`):** โหลด 1080p → รอบ 2 → Render → รอบ 1 · `videoDailyCap` (นับ `FlowWorkerState.todayRenders`) แยกจาก `dailyBatchCap` ครบฝั่งไหนหยุดเฉพาะฝั่งนั้น · โหลด 1080p ไม่นับเพดานไหนเลย (ไม่เสียเครดิต) · timeout แยก `renderTimeoutMs`/`renderDownloadTimeoutMs`
- **การ์ดพังของวิดีโอใน `wait-render`** ตรวจด้วย `<flow-error-tile>` ตามสมมติฐานเดียวกับรูป — ยังไม่มีหลักฐาน DOM ของการ์ด error/policy/เครดิตหมดของวิดีโอ (หัวข้อ "ยังไม่รู้" ใน spec Render) เจอจริงเมื่อไหร่ให้ยืนยัน selector จาก `_flow-failures/`
- งานรอบ 3–4 ที่พัง "รันต่อ" กลับคิวรอบเดิม (`FlowJob.round`) · หน้า Showcase ถือว่าพังรอบ 3–4 = blocked เสมอ (แม้ `flow_error`) เพราะ "เลือกรูปใหม่" จะทิ้งรูปที่เลือกไว้ทั้ง 2 รอบ
- **คลิปที่เรนเดอร์แล้วไม่มีทางกลายเป็น failed:**
  - stale sweep ตอนเปิดบอท: `running_r3` ที่มีแถว `FlowActivity` `generate_video` ตั้งแต่ `startedAt` → `review_r3` ไม่มีแถว video + `STALE_RENDER_MESSAGE` ไม่หยุดคิว (`staleRenderRecovery`/`staleRender` ใน `lib/flow-lifecycle.ts`) — คลิปอยู่ในโปรเจกต์แล้ว "รันต่อ" จะเรนเดอร์ซ้ำเสีย 15 เครดิต · ยังไม่ได้กดสร้าง = failed + หยุดคิวเหมือนงานค้างอื่น
  - stale sweep: `running_upscale` ที่มีตัวอย่าง 720p → `done` ด้วย 720p ไม่หยุดคิว
  - รอบ 4 พัง (ยกเว้น captcha/login) → `done` ด้วย 720p + หมายเหตุ ไม่หยุดคิว
  - โหลดตัวอย่างรอบ 3 ไม่ได้ทุกทาง → `review_r3` **ไม่มีแถว video** + `errorMessage` บอกเหตุ · หน้า `/flow` โชว์ทางเปิดโปรเจกต์ในบัญชีสำรองให้โหลดเอง · ปุ่ม "ผ่าน" ปิด (`canApproveRender`) "เรนเดอร์ใหม่" เปิด
- **สวิตช์ `renderEnabled` (ตอนนี้ `true`)** — ผู้ใช้ลองปิดแล้วทำคลิปเองในบัญชีหลัก แล้วเลือกกลับมาใช้อัตโนมัติ · `false` = เลือกรูปรอบ 2 แล้วงาน `done` (`choose` ใน `lib/flow-lifecycle.ts`) หน้าคิวโชว์ `components/manual-render-panel.tsx` (เปิด Flow · คัดลอกรูปเป็น PNG ลงคลิปบอร์ด/ดาวน์โหลด · คัดลอก 10-part prompt · สูตร) งานที่ค้างขั้นทำคลิปจากก่อนปิดกด "ทำคลิปเองแล้ว — ปิดงานนี้" (`finishRenderManually`) · โค้ด Render ทั้งหมดยังอยู่
- `/api/uploads` ตอบ `.mp4` + HTTP Range (206) — `<video>` ต้องใช้ถึงจะเลื่อนดูได้ · หน้า entry แท็บ ② โชว์คลิป (1080p ถ้ามี ไม่งั้นตัวอย่างพร้อมป้าย) ผ่าน `getRenderVideoForEntry` (`lib/flow-queries.ts`)

### ได้ไฟล์คลิปมาอย่างไร (ADR 0003)

- **ลำดับรอบ 3: ลิงก์ตรงก่อน เมนูทีหลัง** — hover ช่องคลิปแล้ว Flow ใส่ `<video src="https://flow-content.google/video/<uuid>?…">` ดึงได้ตรงๆ ไม่ต้อง cookie (`downloadVideoDirect`; `pickDirectVideoUrl` รับเฉพาะ host นี้) ได้ 720p · ไม่ได้ → เมนู
- **เมนูโหลด ⋯ → Download เปิดด้วยเมาส์เส้นตรง:** ชี้ Download → รอเมนูย่อย → เลื่อนแนวนอนเข้าเมนูย่อย → แนวดิ่งถึงตัวเลือก → คลิก (คีย์บอร์ดใช้ไม่ได้: ArrowRight ไม่เปิดเมนูย่อย Enter เปิดหน้าแก้ไขคลิป · เส้นโค้งผ่านรายการอื่นทำเมนูย่อยปิด)
- **ไฟล์จากเมนูได้ด้วยการดัก:** `page.route` ดักคำขอไฟล์ → abort → ดึงเองด้วย `page.request.get` URL เดียวกัน (`menuRequestFileUrl`) — ทางนี้ทางเดียว เพราะ Chrome ของบอท crash ทันทีที่เริ่มดาวน์โหลด blob (event download/saveAs) · กลไกจริง: คลิก "1080p Upscaled" → toast "Upscaling your video…" → ~40 วิ หน้าเว็บ fetch `flow-content.google/video/<mediaId>_upsampled?Expires…` (video/mp4 ~5.7 MB) · 720p "Original size" fetch `/video/<id>` แบบเดียวกัน · หลัง abort หน้า Flow ขึ้น toast "Failed to download media" — ปกติ
- **`flowMediaId` (uuid ของคลิป) เก็บตอนรอบ 3** = uuid จากลิงก์ตรงที่โหลดตัวอย่างได้ (`lastDirectVideoUuid`) หรือถ้าลิงก์ตรงไม่ได้ ใช้ id จาก thumbnail ตอนเรนเดอร์เสร็จ (สองค่าคือ uuid เดียวกัน ยืนยันสดแล้ว)
- **รอบ 4 หาช่องคลิปด้วย `FlowJobImage.flowMediaId` แบบยืนยัน id ทุกครั้ง** — `tileIndexOf`/`findTileIndex` (`worker/flow-driver.ts`): id จาก thumbnail → ช่องที่จำไว้ในรอบนี้ (`foundTiles`) → เปิดเมนูโหลด 720p ของทีละช่องแล้วอ่าน id จากคำขอ `/video/<id>` ที่ถูก abort (ไม่โหลดจริง ไม่เสียเครดิต) รับเฉพาะช่องที่ id ตรง · ส่องแม้โปรเจกต์มีช่องเดียว (`knownTileIndex`/`fileUrlIsMedia` ใน `worker/flow-signals.ts`) — เปิดโปรเจกต์ใหม่แล้ว thumbnail และ `<video src>` เป็น `/asb/<ลายเซ็น>` ไม่มี id
- ตอนโหลด 1080p URL `_upsampled` ที่ดักได้ต้องมี id ตรงกับ `mediaId` — ไม่ตรง = ไม่โหลด จบด้วย 720p
- **เมนูโหลดพังเมื่อไหร่ ให้รัน `npm run flow-smoke:dl -- <projectId>` ก่อนแก้** (สอดแนม ไม่เสียเครดิต · `stop.bat` ก่อน) — ค่าเริ่มต้นใช้ abort + ดึงเองแบบบอท (`DL_SPY_SAVEAS=1` คือทางเดิมที่ทำ Chrome crash) · ผลอยู่ `worker/smoke/out/dl-spy/` · ภาพเมนูของบอทเองอยู่ `uploads/<entryId>/flow/checkpoints/r3-final-5-menu.jpg` / `-6-submenu.jpg` (ไม่โผล่ในหน้า `/flow`)

## ปุ่ม "ส่งเข้าโฟลเดอร์ TTS"

- `exportClipToFolder` (`app/actions.ts`) + helper pure `lib/clip-export.ts` (ตรวจด้วย `scripts/check-clip-export.mjs`) — ก๊อปคลิป (`คลิป-1080p.mp4`/`คลิป-720p.mp4`) + รูปที่เลือกรอบ 1/2 + `เสียงพากย์.txt` + `โพสต์.txt` ไปที่ `<root>\<Month>\<d-m-yy>\<n>_<ชื่อสั้น≤30>\` (ปี พ.ศ. 2 หลัก, ไม่เติม 0, `n` = เลขสูงสุดของโฟลเดอร์ย่อยในวันนั้น +1) แล้วเปิด Explorer
- root = `CLIP_EXPORT_ROOT` (ไม่ตั้ง = `Desktop\TTS`) · `CLIP_EXPORT_NO_OPEN=1` ไม่เปิด Explorer · **ตอนทดสอบตั้ง `CLIP_EXPORT_ROOT` ชี้ scratch เสมอ** — `Desktop\TTS` คือโฟลเดอร์งานจริงของผู้ใช้
- กดซ้ำปลอดภัย: ทุกครั้งที่ส่งบันทึก `FlowActivity` kind `user_export_clip` (`detail: { path, video }` — video = ชื่อไฟล์คลิปตอนส่ง) แล้ว `exportAction` ตัดสินจากแถวล่าสุด: คลิปเดิม + โฟลเดอร์ยังอยู่ = ไม่ก๊อป คืน path เดิม (`alreadyExported`) · คลิปเปลี่ยน (720p → 1080p / เรนเดอร์ใหม่) หรือแถวเก่าที่ไม่มี `video` = เขียนทับในโฟลเดอร์เดิมและลบคลิปอีกขนาดทิ้ง (`updated`) · โฟลเดอร์ถูกลบ = ช่องใหม่ของวันนี้ · หน้า `/flow` ชวนกดอัปเดตเมื่อคลิปที่ส่งไว้ไม่ใช่คลิปปัจจุบัน (`exportStaleHint`)
- สร้างโฟลเดอร์หลังเช็กว่ามีไฟล์คลิปแล้วเท่านั้น และลบทิ้งถ้าก๊อปล้มกลางทาง

## ทดสอบ

- `npm run check:flow` (pure ทั้งหมด ไม่แตะ Flow)
- `npx tsx scripts/check-flow-lifecycle-db.ts dev-test.db` — รัน `applyPlan`/`applyBulk` กับ SQLite จริง (สำเนาเท่านั้น `cp dev.db dev-test.db` ก่อน · ปฏิเสธ `dev.db`) เทียบคู่ทุกจังหวะของ FlowJob กับโค้ด Prisma เดิมก่อน 321bee2 (ฝั่ง `OLD` ในสคริปต์) · ไม่อยู่ใน `check:flow` เพราะต้องมีสำเนา DB · ตั้งใจเปลี่ยนจังหวะไหนต้องแก้ `OLD` ของจังหวะนั้นด้วย
- smoke `npm run flow-smoke:s1|s2|s3|dl` ใช้บัญชีสำรองจริง และต้อง `stop.bat` ก่อน (โปรไฟล์เปิดได้ทีละตัว)
- `FLOW_FORCE_FAIL_STEP=<step>` บังคับพังเพื่อทดสอบ fail-fast — "รันต่อ" หลังพังใช้ได้จริงทั้ง fail path ปลอมและของจริงโดยไม่ต้องแก้ selector
- เวลาจริงบนบัญชีสำรอง (E2E 2026-09-07): เปิดโปรเจกต์ใหม่ + ตั้งโมเดล/สัดส่วน/จำนวนรูป ~2–2.5 นาที · ตัวเจน (`click-generate` → ผลลัพธ์) ~35–45 วิ · ทั้งรอบ (open-flow ถึง download-4) รอบแรกของโปรเจกต์ ~3–4 นาที รอบถัดไปในโปรเจกต์เดิม ~1.5–2 นาที (ข้าม ensure-project และค่าที่ตั้งไว้ยังติดอยู่)

## ประวัติ (เหตุผลเบื้องหลังกฎด้านบน)

- 2026-09-07 — E2E ชุด `migrated` ผ่านครบ open-flow ถึง download-4 ทั้งรอบ 1–2 · `attach-reference` selector_drift ปลอมจากคลิกช้า (รีรันเดิมผ่านใน 23 วิ) → `prepareHumanClick` · `uploadResponse` ค้างฆ่าโปรเซส worker → `.catch` ทันที
- 2026-09-24 — บอทมองไม่เห็นการ์ด `<flow-error-tile>` (ไม่มี `role=alert`) เลยรอครบ 5 นาทีแล้วรายงานผิดว่า "รอนานเกิน" → แยก `flow_error`
- 2026-09-29 — ผู้ใช้ปิดหน้าต่าง Chrome ที่เด้งหลังเข้า Windows → เดิมเป็น `worker_crash` + pause ค้างแบบไม่มีงานให้ "รันต่อ" (ทางตัน) → ออกเงียบๆ · แกะ extension AI4Next เทียบ → `flow-signals.ts`
- 2026-09-30 — เร่งจังหวะ · ลองปิด `renderEnabled` แล้วเปิดคืน ("สุดท้ายเราต้องการความ automation") · migration `20260930120000_add_flow_today_renders` (`todayRenders` + `flowMediaId`) และ `20260930200000_add_flow_activity` — ถ้า `/flow` หรือบอทพังเพราะไม่มีคอลัมน์/ตารางเหล่านี้ = `dev.db` ยังไม่ได้ `migrate deploy` (ขั้นตอนใน CLAUDE.md หัวข้อ Database)
- 2026-10-01 — Chrome ของบอท crash ตอนดาวน์โหลด blob (crash dump ใน `.flow-profile/Crashpad/reports` 2 ครั้ง งานค้าง "กำลังโหลด 1080p" เป็นชั่วโมง) → ดัก + ดึงเอง · คีย์บอร์ดเปิดเมนูผิดหน้า → เมาส์เส้นตรง · thumbnail เป็น `/asb/` หลังเปิดโปรเจกต์ใหม่ → ส่องเมนูหา id
- 2026-10-02 — `extraPrompt` เลิกติดข้ามรอบ 1 → 2 (ผู้ใช้เจอภาพรอบ 2 ออกมาเหมือนรอบ 1)
