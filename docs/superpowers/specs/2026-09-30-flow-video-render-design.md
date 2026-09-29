# Flow bot: Render คลิป (วิดีโอ) — Design

คำศัพท์: ดู `CONTEXT.md` (Flow queue, Render, Checkpoint)

## การตัดสินใจ (grilling 2026-09-30)

| เรื่อง | ตัดสินใจ |
|---|---|
| บัญชี | บัญชีสำรองของบอท (โปรไฟล์ `.flow-profile` เดียวกับงานรูป) มี 1,000 เครดิต = playground |
| สูตร (ตามที่ผู้ใช้ทำมือ) | Video · **Ingredients** · 9:16 · **Omni 1.1 Flash** · 720p · **10s** · **x1** = 15 เครดิต |
| สิ่งที่แนบ | รูปที่ผู้ใช้เลือกรอบ 1 (พื้นหลังขาว) + รอบ 2 (ตอนใช้งาน) — 2 รูป |
| พรอมต์ | 10-part prompt ของ Entry (`PromptEntry.chatgptOutput`) ทั้งก้อน **วาง** ไม่พิมพ์ทีละตัว (ยาว ~3,000 ตัว + มีขึ้นบรรทัด 58 ครั้ง — Enter ในช่อง Flow = ส่ง) |
| จังหวะเริ่ม | **อัตโนมัติ** ทันทีที่ `generateWithAI` บันทึก 10-part prompt สำเร็จหลังเลือกรูปรอบ 2 (ผู้ใช้ไม่เคยแก้พรอมต์ก่อนใช้ — เจอปัญหาค่อยเปลี่ยน) |
| จำนวน | 1 วิดีโอ ไม่มีตัวเลือกให้เลือก |
| หลังได้วิดีโอ | **รอผู้ใช้ดูก่อน** — ปุ่ม "ผ่าน" / "เรนเดอร์ใหม่" (พิมพ์ข้อความเพิ่มเติมต่อท้ายพรอมต์ได้เหมือนงานรูป) กดผ่านถึงนับว่าเสร็จ |
| ไฟล์ | โหลด **720p Original size** (ไม่ upscale) เก็บใน Angle แสดงในหน้างาน + หน้าคิว Flow ดาวน์โหลดได้ — ยังไม่โพสต์ TikTok ให้ |
| เพดาน | 10 คลิป/วัน (150 เครดิต) กันเครดิตหมดวันเดียวถ้ามีอะไรผิด |
| จุดเช็ก | ภาพ 4 จุดเหมือนงานรูป (ตั้งค่า / แนบรูป / พรอมต์ก่อนกด / ผลลัพธ์) |

## หน้าเว็บจริงที่สำรวจสด (บัญชีสำรอง 2026-09-30 00:35-00:43, โปรเจกต์ `6e887814-…`)

ทุกข้อด้านล่างเห็นจริงระหว่างทำวิดีโอ 1 คลิปจนโหลดไฟล์ได้ (ใช้ 15 เครดิต)

**ตั้งค่า** — popover เดิม `flow-prompt-box-settings` (เปิดด้วย `button.settings-trigger-button` ตอน Agent ปิด) · สถานะเลือก = class `mat-button-toggle-checked` บน `<mat-button-toggle>`
- โหมด: `mat-button-toggle:has(mat-icon:text-is('videocam'))` (รูป = `image`)
- พอเป็น Video แผงเปลี่ยนเป็น: Frame (`crop_free`) / **Ingredient (`chrome_extension`)** · 16:9 (`crop_16_9`) / **9:16 (`crop_9_16`)** · ปุ่มโมเดล `button.mat-mdc-menu-trigger` ข้อความ "Omni 1.1 Flash" · 360p / **720p** · 4s/6s/8s/**10s** · **x1**-x4
- ค่าเริ่มต้นของโปรเจกต์ใหม่ในโหมด Video: Ingredient ✓ · 9:16 ✓ · Omni 1.1 Flash · 720p ✓ · **8s** (ต้องกด 10s) · x1 ✓
- ป้ายบนปุ่ม trigger หลังตั้งเสร็จ: `Video · 720p · 10s` + `crop_9_16` + `x1` — ใช้ยืนยันทั้งชุดได้ในบรรทัดเดียว

**แนบรูป 2 รูป**
- `button.add-menu-trigger` → `.cdk-overlay-pane button.sidebar-upload-btn` → filechooser **รับ 2 ไฟล์พร้อมกันได้** (`setFiles([a, b])`)
- ไดอะล็อกเลือกได้ทีละรูป (ไม่มี multi-select): คลิกแถว `[role=option].asset-item:has-text(<ชื่อไฟล์>)` → ครั้งแรกต้องกด `button.detail-add-to-prompt-btn` · ครั้งที่สอง (เปิดไดอะล็อกใหม่) คลิกแถวแล้วแนบ+ปิดเอง — โค้ด attach-reference เดิมรองรับทั้งสองแบบอยู่แล้ว ("ไดอะล็อกยังเปิดอยู่ไหม")
- ยืนยัน: ในช่องพรอมต์มี `flow-ingredient-chip` 2 ตัว (`flow-image-ingredient-chip img.chip-image`)
- รูปที่อัปโหลดโผล่เป็นช่องในกริดด้วย (`flow-grid-tile-container` + `flow-image-tile`) — นับ tilesBefore หลังแนบ

**พรอมต์** — `page.keyboard.insertText(text)` ในช่อง `.ProseMirror` ได้ 59 ย่อหน้าครบ ไม่ส่งกลางคัน ปุ่ม generate ไม่ disabled

**กดสร้าง/รอ** — `button.generate-icon-button` · ทันทีหลังกด: ช่องใหม่ `flow-grid-tile-container` ที่มี `flow-video-tile` + `flow-pending-tile` (ข้อความ `play_circle N%`) → `generateAccepted` เดิมใช้ได้ · เสร็จใน ~1.5 นาที (pending หาย) · ช่องที่เสร็จมีแค่ `img.thumbnail` (alt "Generated video thumbnail") **ไม่มี `<video>` ในหน้า**

**ดาวน์โหลด** — ต้องเอาเมาส์วางบน `flow-video-tile` จริง (hover) ปุ่มถึงโผล่ → `button[aria-label="More options"]` ในช่องนั้น → hover `[role=menuitem]:has(mat-icon:text-is('download'))` → เมนูย่อย: `270p Animated GIF` / **`720p Original size`** / `1080p Upscaled` / `4K Upscaled [disabled]` → คลิก "Original size" = เบราว์เซอร์ดาวน์โหลด blob → จับด้วย `page.waitForEvent("download")` + `saveAs`
- ไฟล์ที่ได้: mp4 (`ftypisom`) **720×1280, 10.01 วิ, มีแทร็กเสียง, 5.1 MB** ชื่อที่ Flow ตั้ง `Cat_scratching_pad_video_review_<ts>.mp4`

## ยังไม่รู้ / ต้องเผื่อ
- การ์ด error ของวิดีโอ — สันนิษฐานว่าเป็น `flow-error-tile` เหมือนรูป (ยังไม่เคยเห็นวิดีโอพัง)
- ข้อความ policy/ปฏิเสธเนื้อหาของวิดีโอ (เสียงพูด/คน) — ยังไม่เห็น
- เครดิตหมด — ยังไม่เห็นหน้าตา
