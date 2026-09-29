/**
 * selector ทุกตัวของ Flow อยู่ที่นี่ที่เดียว — วันที่ Flow เปลี่ยนหน้า แก้ไฟล์นี้ไฟล์เดียว
 *
 * ชุด "labs"    = labs.google classic composer (Radix UI + ไอคอน <i class="google-symbols">)
 *                 ทุกตัวถอดจากซอร์ส ffroliva/gflow-cli (v0.68.0, 2026-09-05) ซึ่งใช้งานจริง
 * ชุด "migrated"= flow.google.com (Angular Material) — ยืนยันสดกับบัญชีสำรองแล้ว 2026-09-06
 *                 (ดู "ที่มาของค่าในชุด migrated" ท้ายบล็อกคอมเมนต์นี้)
 *
 * กติกา: หลาย selector ต่อขั้น = ลองตามลำดับ ตัวแรกที่ visible ชนะ (cascade)
 * ไอคอนใช้ ligature name (add_2, upload, crop_16_9, arrow_forward, arrow_drop_down) เพราะ
 * ข้อความบนปุ่มเปลี่ยนตามภาษาโปรไฟล์ Chrome แต่ชื่อไอคอนไม่เปลี่ยน
 */
export type SelectorSet = {
  name: "labs" | "migrated";
  hosts: string[];
  /** ปุ่มยอมรับ consent / ปิดประกาศ — กดได้ทุกตัวที่เจอ ไม่เจอก็ไม่เป็นไร */
  consentButtons: string[];
  overlayCloseButtons: string[];
  /** iframe/element ของ reCAPTCHA หรือข้อความ "unusual traffic" */
  captchaSignals: string[];
  newProject: string[];
  projectUrlFragment: string;
  /**
   * ประกอบ URL ของ project จาก id — คนละรูปแบบกันสองโฮสต์
   * (labs = /fx/tools/flow/project/<id> · migrated = /project/<id>) จึงเก็บเป็นฟังก์ชัน
   * ไม่ใช่ต่อสตริงเองที่ผู้เรียก
   */
  projectUrl: (id: string) => string;
  /**
   * ปุ่ม toggle "Agent" mode ของ composer (class `.agent-mode-chip`, ยืนยันสด 2026-09-23 ผ่าน
   * extension ของ Claude ในเบราว์เซอร์จริงของผู้ใช้ — ไม่ใช่ automation) — ตั้งใจ**ไม่ใช้โหมด
   * Agent เลย** เพราะเป็นแชท AI ที่ตัดสินใจเองว่าจะสร้างกี่ภาพ/สัดส่วนอะไร ไม่รับประกันว่าฟังค่า
   * default ที่ตั้งไว้ (ยืนยันจริง: ตั้ง count=4 ไว้ถูกต้องแล้ว แต่ generate ผ่าน Agent chat ได้แค่
   * ~1 ภาพ) เช็ก `aria-pressed` ของปุ่มนี้ก่อนทุกรอบ — "true" = ON ต้องกดปิดก่อนเริ่มงาน
   * ไม่ใส่ = โฮสต์นี้ไม่มี concept นี้ (labs)
   */
  agentModeChip?: string;
  /**
   * การ์ดผลลัพธ์ที่ Flow วาดไม่สำเร็จ ("Sorry, this image failed to generate") — ไม่มี role=alert
   * จึงไม่ถูกจับโดยเช็ก alert เดิม ถ้าไม่ระบุ wait-results จะนั่งรอจนหมด generationTimeoutMs
   */
  errorTile?: string;
  /**
   * ช่องผลลัพธ์ 1 ช่องในกริดของโปรเจกต์ (ทั้งรูปเสร็จ/กำลังวาด/พัง) และช่องที่กำลังวาด — ใช้ยืนยันว่า
   * Flow รับคำสั่ง Generate แล้ว (ดู generateAccepted ใน flow-signals.ts) ไม่ใส่ = ข้ามการยืนยันนี้ (labs)
   */
  resultTile?: string;
  pendingTile?: string;
  /** ปุ่มเปิดเมนูโหมด/ตั้งค่า (ไอคอน crop_*) */
  modeTrigger: string[];
  /**
   * fallback ชั้นสุดท้ายของ modeTrigger เมื่อ CSS selector ทุกตัวข้างบนพังหมด — หาปุ่มจาก
   * ข้อความเชิงความหมาย (innerText/aria-label/title) แทน ใส่เฉพาะโฮสต์ที่มีหลักฐาน DOM dump จริง
   * รองรับแล้วเท่านั้น (ดู modeTriggerIntent ของ MIGRATED ด้านล่างเป็นตัวอย่าง — ห้ามเดาไปก่อน
   * มีหลักฐาน) ดูคอมเมนต์เต็มที่ worker/dom-heuristics.ts
   */
  modeTriggerIntent?: { match: RegExp; exclude?: RegExp };
  /**
   * element ที่มีอยู่ก็ต่อเมื่อแผงตั้งค่าเปิดอยู่ — ใส่ค่านี้แปลว่า "เปิด/ปิดแผงด้วยการกด
   * modeTrigger สลับ ห้ามใช้ Escape" ไม่ใส่ = พฤติกรรมเดิม (เปิดใหม่ทุกขั้น ปิดด้วย Escape)
   *
   * ที่ต้องมีเพราะเว็บใหม่: Escape ปิดแผงให้เห็นก็จริง แต่คอมโพเนนต์ยังจำว่า "เปิดอยู่"
   * คลิกครั้งถัดไปจึงถูกกลืนไปกับการปิดสถานะค้าง แล้วแผงไม่เปิด (ยืนยันสด 2026-09-06)
   *
   * **ต้องชี้เฉพาะแผงตั้งค่าเท่านั้น ห้ามใช้ตัวห่อ overlay กลางๆ** — ถ้าใส่กว้างไป
   * overlay อื่นที่บังเอิญเปิดอยู่ (changelog แรกเข้า / ข้อความ onboarding / แผงรายละเอียดสื่อ)
   * จะถูกอ่านว่า "แผงตั้งค่าเปิดแล้ว" แล้วข้ามการกด trigger ทำให้ขั้นถัดไปพังโดยรายงานผิดขั้น
   */
  settingsPanelOpen?: string;
  /**
   * ปุ่ม "ปิดแผงตั้งค่า" แบบเจาะจง (เช่นปุ่ม Back) — ใส่เมื่อ `settingsPanelOpen` ชี้ไปที่ panel
   * ฝังถาวร (ไม่ใช่ .cdk-overlay-pane) ที่คลิก modeTrigger ซ้ำไม่ได้ปิดเหมือน overlay เดิม
   * ไม่ใส่ = พฤติกรรมเดิม (กด modeTrigger ซ้ำเพื่อปิด)
   */
  closeSettingsButton?: string[];
  /**
   * radio "Never" ของ "Confirm before generating" — เว็บใหม่ (migrated, ยืนยัน 2026-09-23) มี
   * ตัวเลือกนี้เพิ่มมาโดย default เป็น "Always" (ต้องกดยืนยันก่อนเจนทุกครั้ง) ซึ่งบอทไม่รู้จักหน้า
   * ยืนยันนี้ ต้องสลับเป็น "Never" ก่อนเริ่มงานเสมอ ไม่ใส่ = โฮสต์นี้ไม่มีแนวคิดนี้ (labs)
   */
  confirmPolicyNever?: string;
  /** ไม่ใส่ = โฮสต์นี้ไม่มี concept "สลับโหมด" แยก (migrated ตั้งแต่ 2026-09-23 — ดูคอมเมนต์ที่ modeTrigger) */
  imageTab?: string[];
  modelTrigger: string[];
  /** ต้องแมตช์ 1 ตัวพอดี — 0 หรือ >1 = drift (เคยพังตอน "Nano Banana 2 Lite" โผล่มา) */
  modelOptionNanoBanana2: string;
  aspectTab: (label: string) => string;
  countTabs: string;
  countTabPattern: RegExp;
  addMedia: string[];
  uploadButtonInDialog: string[];
  /**
   * แถวสื่อที่เพิ่งอัปเสร็จในไดอะล็อก (รับชื่อไฟล์) — มีเฉพาะโฮสต์ที่ต้อง "เลือกก่อนกดยืนยัน"
   * ไม่ใส่ = ไดอะล็อกเลือกไฟล์ที่เพิ่งอัปให้เองแล้ว (labs)
   */
  uploadedAssetItem?: (basename: string) => string;
  /** ปุ่มยืนยันเอาสื่อเข้าพรอมต์ · ไม่ใส่ = ใช้ heuristic "ปุ่มไร้ไอคอนตัวสุดท้ายในไดอะล็อก" (labs) */
  confirmMedia?: string[];
  openDialog: string;
  uploadResponseUrlPart: string;
  promptBox: string[];
  submit: string[];
  /**
   * Render คลิป (รอบ 3) — ไม่ใส่ = โฮสต์นี้ Render ไม่ได้ (labs) · ทุกค่าเห็นจริงระหว่างทำคลิป 1 ตัวจนโหลดไฟล์ได้
   * บนบัญชีสำรอง 2026-09-30 (ดู docs/superpowers/specs/2026-09-30-flow-video-render-design.md)
   */
  video?: {
    /** toggle โหมดวิดีโอในแผงตั้งค่า (คู่กับ imageTab) */
    modeTab: string;
    /** toggle "Ingredient" (ไอคอน chrome_extension) — อีกตัวคือ Frame (crop_free) */
    ingredientTab: string;
    /** toggle ทุกตัวในแผง — กรองด้วยข้อความ 720p / 10s / x1 ตอนใช้ */
    optionToggles: string;
    /** ปุ่มโมเดลในแผง + ข้อความที่ต้องเป็น (ไม่เปลี่ยนโมเดลให้ — ผิดแปลว่าหน้าเปลี่ยน ให้คนดู) */
    modelTrigger: string;
    modelLabel: RegExp;
    /** ชิปรูปที่แนบในช่องพรอมต์ — ต้องมี 2 ตัวพอดีก่อนกดสร้าง */
    ingredientChip: string;
    /** ช่องในกริดที่เป็นวิดีโอ (ทั้งกำลังทำและเสร็จ) · ตัววิดีโอในช่อง (ต้อง hover ตัวนี้) · thumbnail ของช่องที่เสร็จ */
    tileContainer: string;
    tile: string;
    tileThumbnail: string;
    /** ปุ่มในช่องที่โผล่เฉพาะตอน hover · เมนู Download (hover แล้วเมนูย่อยเลือกขนาดโผล่) */
    moreOptions: string;
    downloadMenuItem: string;
    menuItem: string;
    /** ตัวอย่างหลัง Render: "720p Original size" (เร็ว ไม่ต้องรอขยาย) — ทุก regex ต้องแมตช์ข้อความเมนูตัวเดียวกัน */
    previewQuality: RegExp[];
    /** หลังผู้ใช้กดผ่าน: "1080p Upscaled" (Flow ขยายให้ตอนโหลด ไม่เสียเครดิต แต่รอนาน) */
    finalQuality: RegExp[];
  };
  results: {
    /** network = ดัก response ของ endpoint เจนรูป · dom = เทียบ <img> ใหม่ที่โผล่ */
    strategy: "network" | "dom";
    responseUrlPart: string;
    /** host ของ URL รูปที่ยอมโหลด */
    imageUrlHosts: string[];
  };
};

const LABS: SelectorSet = {
  name: "labs",
  hosts: ["labs.google"],
  consentButtons: [
    "button#L2AGLb",
    "button[aria-label='Accept all']",
    "button[aria-label='I agree']",
    "button:has-text('Create with Flow')",
    "button:has-text('Get Started')",
  ],
  overlayCloseButtons: [
    "[role='dialog']:has(a[href*='changelog']) button",
    "button:has(i.google-symbols:text('clear'))",
    "button:has(i.google-symbols:text('close'))",
    "[aria-label='Close']",
    "[aria-label='Dismiss']",
  ],
  captchaSignals: [
    "iframe[src*='recaptcha'][src*='bframe']",
    "text=/unusual traffic/i",
    // Flow ใช้คำนี้กับการ์ด/ไดอะล็อกตอนบล็อกบอท (พบจากการแกะ AI4Next 2026-09-29) — เดิมดักแต่ "traffic"
    "text=/unusual activity/i",
    "text=/verify you are human/i",
  ],
  newProject: [
    "button:has(i.google-symbols:text('add_2'))",
    "button:has(i:text('add_2'))",
    "[role='button']:has(i.google-symbols:text('add_2'))",
    "button:has-text('New project')",
  ],
  projectUrlFragment: "/project/",
  projectUrl: (id) => `https://labs.google/fx/tools/flow/project/${id}`,
  modeTrigger: [
    "button[aria-haspopup='menu']:has(i.google-symbols:text('crop_16_9'))",
    "button[aria-haspopup='menu']:has(i.google-symbols:text('crop_9_16'))",
    "button[aria-haspopup='menu']:has(i.google-symbols:text('crop_square'))",
    "button[aria-haspopup='menu']:has(i.google-symbols:text('crop_portrait'))",
    "button[aria-haspopup='menu']:has(i.google-symbols:text('crop_landscape'))",
    "button[aria-haspopup='menu']:has(i.google-symbols:text('crop_original'))",
  ],
  imageTab: [
    "[role='menu'] [role='tab'][aria-controls*='IMAGE']",
    "[role='tab'][aria-controls*='IMAGE']",
    "[role='menu'] [role='tab']:has-text('Image')",
    "[role='menu'] [role='tab']:has(i:text('image'))",
  ],
  modelTrigger: [
    "button[aria-haspopup='menu']:has(i.google-symbols:text-is('arrow_drop_down'))",
  ],
  modelOptionNanoBanana2: "[role='menuitem']:has-text('Nano Banana 2'):not(:has-text('Lite')):not(:has-text('Pro'))",
  aspectTab: (label) => `[role="tab"]:text-is("${label}")`,
  countTabs: '[role="tab"]',
  countTabPattern: /^(1x|x[1-4])$/,
  addMedia: [
    "button[aria-haspopup='dialog']:has(i.google-symbols:text-is('add_2'))",
  ],
  uploadButtonInDialog: [
    "[role='dialog'][data-state='open'] button:has(i.google-symbols:text-is('upload'))",
    "[role='dialog'][data-state='open'] button:has-text('Upload media')",
  ],
  openDialog: "[role='dialog'][data-state='open']",
  uploadResponseUrlPart: "uploadImage",
  promptBox: [
    'div[role="textbox"][data-slate-editor="true"]',
    'div[contenteditable="true"]',
    "textarea",
  ],
  submit: [
    "button:has(i.google-symbols:text('arrow_forward'))",
    "button:has(i:text('arrow_forward'))",
  ],
  results: {
    strategy: "network",
    responseUrlPart: "batchGenerateImages",
    imageUrlHosts: ["googleusercontent.com", "flow-content.google", "googleapis.com"],
  },
};

/**
 * แผงตั้งค่าของเว็บใหม่ไม่ได้เขียนอัตราส่วนเป็นข้อความล้วน — ปุ่มมี mat-icon นำหน้าทำให้
 * innerText เป็น "crop_portrait 3:4" ฉะนั้น :text-is("3:4") แมตช์ไม่ติด ต้องจับด้วยชื่อไอคอน
 * (ยืนยันจาก dump: 16:9=crop_16_9 · 4:3=crop_landscape · 1:1=crop_square · 3:4=crop_portrait · 9:16=crop_9_16)
 */
const MIGRATED_ASPECT_ICON: Record<string, string> = {
  "16:9": "crop_16_9",
  "4:3": "crop_landscape",
  "1:1": "crop_square",
  "3:4": "crop_portrait",
  "9:16": "crop_9_16",
};

/**
 * ยืนยันสดทุกตัวจาก dump DOM ของบัญชีสำรอง 2026-09-06 (หน้า gallery + หน้า project ตอนเปิด
 * settings panel / media picker / เมนูโมเดล จริง) — ไม่มีตัวไหนเหลือเป็น "คำใบ้" แล้ว
 *
 * เกณฑ์การเลือก: เอา class ของแอปเอง (.settings-trigger-button, .add-menu-trigger,
 * .sidebar-upload-btn, .generate-icon-button, .new-project-button) หรือ ligature ของ mat-icon
 * เป็นตัวแรก แล้วให้ aria-label ภาษาอังกฤษเป็นตัวสำรอง — ข้อความบนปุ่มเปลี่ยนตาม copy/ภาษา
 * แต่ class กับชื่อไอคอนไม่เปลี่ยน
 *
 * ปุ่มปิด overlay ถูกล็อกไว้ใน .cdk-overlay-pane ทุกตัวโดยตั้งใจ — บน prompt bar มีปุ่มกากบาท
 * "ล้างพรอมต์" อยู่ด้วย ถ้าปล่อยให้ selector ปิด overlay กว้างเกินไปจะไปกดอันนั้นแล้วลบรูป
 * อ้างอิงที่เพิ่งแนบทิ้ง
 */
const MIGRATED: SelectorSet = {
  name: "migrated",
  hosts: ["flow.google.com"],
  consentButtons: LABS.consentButtons,
  overlayCloseButtons: [
    "button[aria-label='Dismiss banner']",
    "button[aria-label='Got it, dismiss onboarding message']",
    ".cdk-overlay-pane button:has(mat-icon:text-is('close'))",
    ".cdk-overlay-pane [aria-label='Close']",
  ],
  captchaSignals: LABS.captchaSignals,
  newProject: [
    "button.new-project-button",
    "button:has(mat-icon:text-is('add'))",
    "button:has-text('New project')",
  ],
  projectUrlFragment: "/project/",
  projectUrl: (id) => `https://flow.google.com/project/${id}?hl=en`,
  // แก้ 2026-09-23 (รอบ 3 ในวันเดียวกัน — เปลี่ยนกลยุทธ์ทั้งยวงหลังพบว่าโหมด "Agent" (แชท AI)
  // ไม่รับประกันว่าฟังค่า default ที่ตั้งไว้จริง — ยืนยันจริงจากการรัน smoke test เต็มรอบ: ตั้ง
  // count=4 ถูกต้องแล้ว (assertSelected ผ่าน) แต่ Agent chat generate ได้แค่ ~1 ภาพ ไม่ใช่ 4
  // จึงตัดสินใจ**เลี่ยงโหมด Agent ไปเลย** ไม่พยายามควบคุมพารามิเตอร์ผ่านมันอีก — ใช้ปุ่ม toggle
  // agentModeChip ปิด Agent mode ก่อนเสมอ แล้วใช้ popover ตั้งค่าเร็วที่โผล่แทนที่ (ตอน Agent
  // OFF เท่านั้น) ซึ่งกลายเป็นว่า**ตรงกับ selector ดั้งเดิมที่สุด**ของไฟล์นี้ (.settings-trigger-
  // button / aria-label 'Settings trigger') — ที่รอบก่อนพังเพราะตอนนั้น Agent เปิดอยู่ ปุ่มนี้เลย
  // โดนซ่อนด้วย hidden="" (ปุ่มที่เห็นตอน Agent ON คือคนละปุ่ม: .agent-action-button ไอคอน tune)
  // ยืนยันสดทั้งหมดนี้ผ่าน extension ของ Claude ในเบราว์เซอร์จริงของผู้ใช้ (ไม่ใช่ automation ของ
  // เรา จึงไม่ต้องกังวลเรื่อง bot-detection) — ไม่ได้กด Generate เลยระหว่างสำรวจ
  modeTrigger: ["button.settings-trigger-button", "button[aria-label='ทริกเกอร์การตั้งค่า']", "button[aria-label='Settings trigger']"],
  // popover ตอน Agent OFF เป็น custom element <flow-prompt-box-settings> ยืนยันสด — ไม่ใช่แผงฝัง
  // ถาวรแบบตอน Agent ON (flow-settings-view) จึงกลับไปใช้พฤติกรรม overlay แบบเดิม (toggle เปิด/
  // ปิดด้วยการกด modeTrigger ซ้ำ, ไม่ต้องมีปุ่ม Back) — ไม่ต้องประกาศ closeSettingsButton
  settingsPanelOpen: "flow-prompt-box-settings",
  // ไม่มี concept "Confirm before generating" ในเส้นทาง non-agent นี้ (นั่นเป็นของแผง Agent
  // Settings ตอน ON เท่านั้น) — ไม่ต้องประกาศ confirmPolicyNever
  // ยืนยันสด 2026-09-23: ปุ่ม toggle Agent mode เอง — class `.agent-mode-chip` แน่นอน 100%
  // (aria-pressed สลับ true/false ตรงกับสถานะ ไม่ผูกภาษา UI เลย ต่างจาก aria-label ที่เจอว่า
  // เปลี่ยนเป็นไทยได้ในบางเซสชัน — ห้ามพึ่ง aria-label เป็นหลักอีกต่อไปสำหรับปุ่มนี้)
  agentModeChip: "button.agent-mode-chip",
  // custom element ของ Flow เอง ไม่ผูกภาษา UI เลย — ยืนยันจาก page.html ของหลักฐานจริง
  // (uploads/_flow-failures/cmuatn0ud0005mkp72j2t1bgn-1790233471875, 2026-09-24)
  errorTile: "flow-error-tile",
  // ยืนยันจาก page.html ของหลักฐานจริง (uploads/_flow-failures/cmumqwrz50001a4p7d6dkk75h-1790690647902,
  // 2026-09-29): ทุกช่องในกริดห่อด้วย <flow-grid-tile-container> ช่องที่กำลังวาดคือ <flow-pending-tile>
  resultTile: "flow-grid-tile-container",
  pendingTile: "flow-pending-tile",
  // ปุ่ม "รูปภาพ/วิดีโอ" ใน popover ใหม่ — mat-button-toggle มี mat-icon ligature "image"/"videocam"
  // ข้างใน ยืนยันสดตรงกับที่คาดไว้ scope ด้วย <flow-prompt-box-settings> กันชนกับ toggle กลุ่มอื่น
  // ในหน้าเดียวกัน (อัตราส่วน/จำนวน ก็เป็น mat-button-toggle เหมือนกันหมด)
  imageTab: ["flow-prompt-box-settings mat-button-toggle:has(mat-icon:text-is('image'))"],
  modelTrigger: [
    "flow-prompt-box-settings button.mat-mdc-menu-trigger:has(mat-icon:text-is('arrow_drop_down'))",
  ],
  modelOptionNanoBanana2:
    "[role='menuitem']:has-text('Nano Banana 2'):not(:has-text('Lite')):not(:has-text('Pro'))",
  // **สำคัญ: ต่างจากแผง Agent Settings เดิม — สถานะ "ถูกเลือก" ของ popover นี้อยู่ที่ class
  // `mat-button-toggle-checked` บนตัว <mat-button-toggle> เอง ไม่ใช่ aria-checked ของ button
  // ข้างใน (ยืนยันสดชัดเจน: "ตัวที่ถูกเลือกจะมี class mat-button-toggle-checked เพิ่มเข้ามา
  // ไม่ใช่ aria-checked") — จึงชี้ selector ที่ตัว <mat-button-toggle> เอง ไม่ต้องลงไปถึง
  // button[role=radio] ข้างใน (assertSelected ใน flow-driver.ts รองรับเช็คทั้งสองแบบแล้ว)
  aspectTab: (label) => {
    const icon = MIGRATED_ASPECT_ICON[label];
    const scope = "flow-prompt-box-settings mat-button-toggle";
    return icon ? `${scope}:has(mat-icon:text-is('${icon}'))` : `${scope}:has-text("${label}")`;
  },
  // ตัวเลือกจำนวน (x1-x4) เป็น mat-button-toggle เหมือนกันแต่**ไม่มี mat-icon ข้างใน** (ข้อความ
  // ล้วน) ใช้ :not(:has(mat-icon)) กันชนกับ toggle รูปภาพ/วิดีโอ กับอัตราส่วนที่มีไอคอนทั้งคู่
  countTabs: "flow-prompt-box-settings mat-button-toggle:not(:has(mat-icon))",
  countTabPattern: /^x[1-4]$/,
  addMedia: ["button.add-menu-trigger", "button[aria-label='Add ingredients to the prompt box']"],
  uploadButtonInDialog: [
    ".cdk-overlay-pane button.sidebar-upload-btn",
    ".cdk-overlay-pane button:has(mat-icon:text-is('upload'))",
  ],
  // img.asset-thumbnail-image โผล่แทน mat-spinner เมื่ออัปเสร็จ — ใช้เป็นสัญญาณ "อัปจบแล้ว"
  // ที่ไม่ผูกกับภาษา (ระหว่างอัปแถวนี้มี <mat-spinner> กับข้อความ "Uploading" เท่านั้น)
  uploadedAssetItem: (basename) =>
    `.cdk-overlay-pane [role='option'].asset-item:has(img.asset-thumbnail-image):has-text(${JSON.stringify(basename)})`,
  confirmMedia: ["button.detail-add-to-prompt-btn", ".cdk-overlay-pane button:has-text('Add to prompt')"],
  // เหตุผลเดียวกับ settingsPanelOpen: ชี้เฉพาะ overlay ที่เป็นไดอะล็อกเลือกสื่อ (มีปุ่มอัปโหลด
  // ในแถบข้างของตัวเอง) ไม่ใช่ overlay ตัวไหนก็ได้ ไม่งั้น .last() ในขั้น attach-reference
  // อาจไปจับ overlay อื่นแล้วรอ "ปิด" ของผิดตัว
  openDialog: ".cdk-overlay-pane:has(button.sidebar-upload-btn)",
  uploadResponseUrlPart: "batchexecute",
  promptBox: [".ProseMirror[contenteditable='true']", "[contenteditable='true']"],
  submit: ["button.generate-icon-button", "button[aria-label='Start generation']"],
  // เห็นสดทั้งหมด 2026-09-30 (สำรวจด้วยมือบนบัญชีสำรอง ทำคลิปจริง 1 ตัวจนโหลดได้) — ใช้แผงตั้งค่าเดียวกับรูป
  // (<flow-prompt-box-settings>) สถานะเลือก = class mat-button-toggle-checked เหมือนเดิม
  video: {
    modeTab: "flow-prompt-box-settings mat-button-toggle:has(mat-icon:text-is('videocam'))",
    ingredientTab: "flow-prompt-box-settings mat-button-toggle:has(mat-icon:text-is('chrome_extension'))",
    optionToggles: "flow-prompt-box-settings mat-button-toggle",
    modelTrigger: "flow-prompt-box-settings button.mat-mdc-menu-trigger",
    modelLabel: /Omni 1\.1 Flash/,
    ingredientChip: "flow-ingredient-chip",
    // ช่องใหม่หลังกดสร้าง = <flow-grid-tile-container> ที่มี <flow-video-tile> (+ <flow-pending-tile> ระหว่างทำ)
    tileContainer: "flow-grid-tile-container:has(flow-video-tile)",
    tile: "flow-video-tile",
    // ช่องที่เสร็จมีแค่ <img class="thumbnail"> (alt "Generated video thumbnail") ไม่มี <video> ในหน้า
    tileThumbnail: "img.thumbnail",
    moreOptions: "button[aria-label='More options']",
    downloadMenuItem: "[role='menuitem']:has(mat-icon:text-is('download'))",
    menuItem: "[role='menuitem']",
    // เมนูย่อยจริง: 270p Animated GIF / 720p Original size / 1080p Upscaled / 4K Upscaled [disabled]
    previewQuality: [/720p/, /Original size/],
    finalQuality: [/1080p/, /Upscaled/],
  },
  results: {
    // เว็บใหม่ยิงทุกอย่างผ่าน RPC ก้อนเดียว (/_/AiSandboxAngularFrontend/data/batchexecute) ซึ่ง
    // ตอบเป็นข้อความ ไม่ใช่ JSON ที่เดินหา field ได้ จึงอ่านผลจาก <img> ที่โผล่ใหม่แทน
    strategy: "dom",
    responseUrlPart: "batchexecute",
    // รูปในโปรเจกต์เสิร์ฟ 2 รูปแบบ: flow.google.com/asb/... (grid) และ flow-content.google/image/...
    // (thumbnail ในไดอะล็อก) — ยืนยันจาก src จริงของโปรเจกต์ที่เจนด้วยมือไว้
    imageUrlHosts: ["flow.google.com", "flow-content.google", "googleusercontent.com"],
  },
};

export function selectorSetForHost(host: string): SelectorSet {
  if (LABS.hosts.includes(host)) return LABS;
  if (MIGRATED.hosts.includes(host)) return MIGRATED;
  throw new Error(`ไม่รู้จักโฮสต์ ${host} — ไม่มี selector set สำหรับมัน`);
}

export const SELECTOR_SETS = { labs: LABS, migrated: MIGRATED } as const;
