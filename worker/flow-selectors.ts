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
  /** ปุ่มเปิดเมนูโหมด/ตั้งค่า (ไอคอน crop_*) */
  modeTrigger: string[];
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
  imageTab: string[];
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
  modeTrigger: ["button.settings-trigger-button", "button[aria-label='Settings trigger']"],
  // จับ overlay ที่เป็น "แผงตั้งค่า" จริงๆ ด้วยของที่อยู่แต่ในแผงนี้ 2 ตัว (คั่นด้วย , = ตัวไหน
  // ติดก็ถือว่าเปิด · ทั้งคู่ชี้ pane เดียวกันจึงนับได้ 1 ไม่ซ้อน) ยืนยันสด 2026-09-06:
  // แผงตั้งค่าเปิด → 1 · เปิดแค่ไดอะล็อกเลือกสื่อ → 0 (ตัว .cdk-overlay-pane เปล่าได้ 1 = false positive)
  // .settings-content-overlay เป็น class ของคอมโพเนนต์เอง จึงเป็นตัวแรก ส่วน aria-label ผูกภาษา
  // อังกฤษเป็นตัวสำรอง · ปุ่มเลือกโมเดลมีทั้งโหมดวิดีโอและรูป จึงเช็กได้ก่อนสลับโหมด
  settingsPanelOpen:
    ".cdk-overlay-pane:has(.settings-content-overlay), .cdk-overlay-pane:has(button[aria-label='Select model family'])",
  imageTab: [
    ".cdk-overlay-pane [role='radio']:has(mat-icon:text-is('image'))",
    ".cdk-overlay-pane [role='radio']:has-text('Image')",
  ],
  modelTrigger: [
    "button[aria-label='Select model family']",
    ".cdk-overlay-pane button:has(mat-icon:text-is('arrow_drop_down'))",
  ],
  modelOptionNanoBanana2:
    ".cdk-overlay-pane [role='menuitem']:has-text('Nano Banana 2'):not(:has-text('Lite')):not(:has-text('Pro'))",
  aspectTab: (label) => {
    const icon = MIGRATED_ASPECT_ICON[label];
    return icon
      ? `.cdk-overlay-pane [role='radio']:has(mat-icon:text-is('${icon}'))`
      : `.cdk-overlay-pane [role='radio']:has-text("${label}")`;
  },
  countTabs: ".cdk-overlay-pane [role='radio']",
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
