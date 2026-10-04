/**
 * ตรวจ lib/clip-export-fs.ts (ส่งเข้าโฟลเดอร์ TTS) กับโฟลเดอร์ชั่วคราวจริงใน os.tmpdir() — ไม่แตะ Desktop\TTS
 * รัน: node scripts/check-clip-export-fs.mjs
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import os from "node:os";
import { join } from "node:path";
import { require as tsxRequire } from "tsx/cjs/api";

const tmp = mkdtempSync(join(os.tmpdir(), "check-clip-export-fs-"));
let failed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`      ได้ ${a}\n      ควรได้ ${e}`);
}
async function rejects(fn) {
  try {
    await fn();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

// ให้ copyFile ล้มเฉพาะไฟล์ปลายทางที่ชื่อตรง — แก้ทั้งอ็อบเจกต์ CJS และ named export ของ ESM (syncBuiltinESMExports)
// จึงได้ผลไม่ว่า module จะ import แบบไหน
const fsp = createRequire(import.meta.url)("node:fs/promises");
const realCopyFile = fsp.copyFile;
function failCopyTo(destIncludes, code) {
  fsp.copyFile = async (src, dest, ...rest) => {
    if (String(dest).includes(destIncludes)) throw Object.assign(new Error("injected"), { code });
    return realCopyFile(src, dest, ...rest);
  };
  syncBuiltinESMExports();
}
function restoreCopyFile() {
  fsp.copyFile = realCopyFile;
  syncBuiltinESMExports();
}

try {
  const M = tsxRequire("../lib/clip-export-fs.ts", import.meta.url);
  const now = new Date(2026, 9, 2, 10, 0, 0);
  const root = join(tmp, "TTS");
  // วันที่ในโฟลเดอร์ = วันโพสต์: ส่งวันที่ 2 ต.ค. → ลงพรุ่งนี้ 3-10-69
  const dayDir = join(root, "October", "3-10-69");
  const ls = (dir) => (existsSync(dir) ? readdirSync(dir).sort() : []);
  const read = (p) => readFileSync(p, "utf8");

  // งานปลอม: uploads/<entry>/flow ของแต่ละงานอยู่ใน tmp
  function makeJob(name, files) {
    const flowDir = join(tmp, "uploads", name, "flow");
    mkdirSync(flowDir, { recursive: true });
    for (const [f, content] of Object.entries(files)) writeFileSync(join(flowDir, f), content);
    return {
      productName: name,
      chatgptOutput: "",
      caption: "แคปชัน",
      hashtags: "#แท็ก",
      flowDir,
      images: [
        { kind: "candidate", round: 1, chosen: true, filename: "r1-a1-2.png" },
        { kind: "candidate", round: 1, chosen: false, filename: "r1-a1-3.png" },
        { kind: "candidate", round: 2, chosen: true, filename: "r2-a1-1.jpg" },
        { kind: "video", round: 3, chosen: false, filename: "r3-a1.mp4" },
      ],
    };
  }
  const withVideo = (job, filename) => ({ ...job, images: job.images.map((i) => (i.kind === "video" ? { ...i, filename } : i)) });

  const jobA = makeJob("กล่องเก็บตะเกียบ", { "r1-a1-2.png": "white", "r1-a1-3.png": "other", "r2-a1-1.jpg": "inuse", "r3-a1.mp4": "clip720" });
  const jobB = makeJob("ที่ลับเล็บแมว", { "r1-a1-2.png": "w", "r2-a1-1.jpg": "u", "r3-a1.mp4": "b720" });

  process.env.CLIP_EXPORT_ROOT = root;
  check("root มาจาก CLIP_EXPORT_ROOT", M.clipExportRoot(), root);

  // 1) ส่งครั้งแรก = ช่อง 1 ของวัน
  const a1 = await M.exportClip({ root, now, job: jobA, prev: null });
  const dirA1 = join(dayDir, "1_กล่องเก็บตะเกียบ");
  check("ส่งครั้งแรก → new ที่ <root>\\October\\3-10-69 (พรุ่งนี้)\\1_<ชื่อ>", [a1.outcome, a1.path], ["new", dirA1]);
  check("ส่งครั้งแรก: ไฟล์ที่คืน", a1.files, ["คลิป-720p.mp4", "รูป-พื้นหลังขาว.png", "รูป-ตอนใช้งาน.jpg", "โพสต์.txt"]);
  check("ส่งครั้งแรก: ไฟล์บนดิสก์ (ไม่มีเสียงพากย์.txt เพราะ chatgptOutput ว่าง)", ls(dirA1), [...a1.files].sort());
  check("ส่งครั้งแรก: เนื้อคลิป/รูปตรงต้นทาง", [read(join(dirA1, "คลิป-720p.mp4")), read(join(dirA1, "รูป-พื้นหลังขาว.png")), read(join(dirA1, "รูป-ตอนใช้งาน.jpg"))], ["clip720", "white", "inuse"]);
  check("ส่งครั้งแรก: โพสต์.txt", read(join(dirA1, "โพสต์.txt")), "กล่องเก็บตะเกียบ\n\nแคปชัน\n\n#แท็ก\n");
  check("ส่งครั้งแรก: record ที่ต้องบันทึก", a1.record, { path: dirA1, video: "r3-a1.mp4" });

  // 2) งานที่สองวันเดียวกัน = ช่อง 2
  const b1 = await M.exportClip({ root, now, job: jobB, prev: null });
  check("งานที่สองวันเดียวกัน → ช่อง 2", [b1.outcome, b1.path], ["new", join(dayDir, "2_ที่ลับเล็บแมว")]);

  // 3) กดซ้ำ คลิปเดิม โฟลเดอร์ยังอยู่ = already ไม่ก๊อปอะไร
  writeFileSync(join(jobA.flowDir, "r3-a1.mp4"), "clip720-changed-on-disk");
  const a2 = await M.exportClip({ root, now, job: jobA, prev: a1.record });
  check("คลิปเดิม + โฟลเดอร์อยู่ → already path เดิม", [a2.outcome, a2.path], ["already", dirA1]);
  check("already: ไม่ก๊อปทับ (เนื้อคลิปยังเป็นของเดิม)", read(join(dirA1, "คลิป-720p.mp4")), "clip720");
  check("already: files = ของในโฟลเดอร์ตอนนี้", [...a2.files].sort(), ls(dirA1));
  check("already: ไม่มีช่องใหม่", ls(dayDir), ["1_กล่องเก็บตะเกียบ", "2_ที่ลับเล็บแมว"]);

  // 4) ส่งไว้ 720p แล้วได้ 1080p = เขียนทับโฟลเดอร์เดิม ลบ คลิป-720p.mp4
  writeFileSync(join(jobA.flowDir, "r3-final.mp4"), "clip1080");
  const jobA1080 = { ...withVideo(jobA, "r3-final.mp4"), chatgptOutput: "" };
  const a3 = await M.exportClip({ root, now, job: jobA1080, prev: a1.record });
  check("720p → 1080p → updated โฟลเดอร์เดิม", [a3.outcome, a3.path], ["updated", dirA1]);
  check("updated: มี คลิป-1080p.mp4 และไม่เหลือ คลิป-720p.mp4", [ls(dirA1).includes("คลิป-1080p.mp4"), ls(dirA1).includes("คลิป-720p.mp4")], [true, false]);
  check("updated: เนื้อคลิป 1080p", read(join(dirA1, "คลิป-1080p.mp4")), "clip1080");
  check("updated: record จำคลิปใหม่", a3.record, { path: dirA1, video: "r3-final.mp4" });
  check("updated: ไม่มีช่องใหม่", ls(dayDir), ["1_กล่องเก็บตะเกียบ", "2_ที่ลับเล็บแมว"]);

  // 5) แถวเก่าไม่มี video = update (ก๊อปซ้ำปลอดภัย) · ข้อความว่างตอนนี้ลบ txt เก่า
  const jobANoPost = { ...jobA1080, productName: "", caption: "", hashtags: "" };
  const a4 = await M.exportClip({ root, now, job: jobANoPost, prev: { path: dirA1, video: null } });
  check("แถวเก่าไม่มี video → updated โฟลเดอร์เดิม", [a4.outcome, a4.path], ["updated", dirA1]);
  check("updated: ข้อความโพสต์ว่างตอนนี้ = ลบ โพสต์.txt เก่า", ls(dirA1).includes("โพสต์.txt"), false);

  // 6) โฟลเดอร์ถูกลบ = ช่องใหม่ถัดจากเลขสูงสุดของวัน
  rmSync(dirA1, { recursive: true, force: true });
  const a5 = await M.exportClip({ root, now, job: jobA1080, prev: a3.record });
  check("โฟลเดอร์ถูกลบ → new ช่อง 3 (สูงสุดตอนนี้คือ 2)", [a5.outcome, a5.path], ["new", join(dayDir, "3_กล่องเก็บตะเกียบ")]);

  // 7) ไม่มีไฟล์คลิป = error และไม่สร้างโฟลเดอร์ใดๆ
  const root2 = join(tmp, "TTS-missing");
  const jobMissing = withVideo(jobA, "r3-a9.mp4");
  check("ไฟล์คลิปหาย → error", await rejects(() => M.exportClip({ root: root2, now, job: jobMissing, prev: null })), "หาไฟล์คลิปในเครื่องไม่เจอ");
  check("ไฟล์คลิปหาย → ไม่สร้าง root", existsSync(root2), false);
  const jobNoVideo = { ...jobA, images: jobA.images.filter((i) => i.kind !== "video") };
  check("ไม่มีแถว video → error", await rejects(() => M.exportClip({ root: root2, now, job: jobNoVideo, prev: null })), "งานนี้ยังไม่มีไฟล์คลิป");
  check("ไม่มีแถว video → ไม่สร้าง root", existsSync(root2), false);

  // 8) ก๊อปล้มกลางทาง (หลังก๊อปคลิปแล้ว) ตอนส่งใหม่ = ลบโฟลเดอร์ใหม่ทิ้ง
  const before = ls(dayDir);
  failCopyTo("รูป-ตอนใช้งาน", "EIO");
  const errMid = await rejects(() => M.exportClip({ root, now, job: jobB, prev: null }));
  restoreCopyFile();
  check("ก๊อปล้มกลางทาง → error ไทย", errMid, "ส่งเข้าโฟลเดอร์ TTS ไม่สำเร็จ ลองอีกครั้ง");
  check("ก๊อปล้มกลางทาง → ไม่เหลือโฟลเดอร์ 4_", ls(dayDir), before);

  failCopyTo("คลิป-", "EPERM");
  const errPerm = await rejects(() => M.exportClip({ root, now, job: jobB, prev: null }));
  restoreCopyFile();
  check("ไม่มีสิทธิ์เขียน → ข้อความสิทธิ์", errPerm, "ไม่มีสิทธิ์เขียนในโฟลเดอร์ TTS");
  check("ไม่มีสิทธิ์เขียน → ไม่เหลือโฟลเดอร์ใหม่", ls(dayDir), before);

  // 9) อัปเดตล้ม = ห้ามลบโฟลเดอร์ที่ผู้ใช้ส่งไว้แล้ว
  const dirB = b1.path;
  writeFileSync(join(jobB.flowDir, "r3-final.mp4"), "b1080");
  failCopyTo("รูป-พื้นหลังขาว", "EIO");
  const errUpd = await rejects(() => M.exportClip({ root, now, job: withVideo(jobB, "r3-final.mp4"), prev: b1.record }));
  restoreCopyFile();
  check("อัปเดตล้ม → error", errUpd, "ส่งเข้าโฟลเดอร์ TTS ไม่สำเร็จ ลองอีกครั้ง");
  check("อัปเดตล้ม → โฟลเดอร์เดิมยังอยู่", existsSync(dirB), true);

  // 10) ไฟล์ (ไม่ใช่โฟลเดอร์) ชื่อชนช่องถัดไป (ส่งวันที่ 3 ต.ค. → วันโพสต์ 4-10-69) → mkdir ล้ม แต่ต้องไม่ลบไฟล์นั้นตอน rollback
  const day2 = join(root, "October", "4-10-69");
  mkdirSync(day2, { recursive: true });
  writeFileSync(join(day2, "1_ที่ลับเล็บแมว"), "ไฟล์ของผู้ใช้");
  const errClash = await rejects(() => M.exportClip({ root, now: new Date(2026, 9, 3, 9), job: jobB, prev: null }));
  check("ชื่อชนไฟล์ → error", errClash, "ส่งเข้าโฟลเดอร์ TTS ไม่สำเร็จ ลองอีกครั้ง");
  const clashFile = join(day2, "1_ที่ลับเล็บแมว");
  check("ชื่อชนไฟล์ → ไฟล์ของผู้ใช้ไม่ถูกลบ", existsSync(clashFile) ? read(clashFile) : null, "ไฟล์ของผู้ใช้");

  // 11) รูปที่เลือกแต่ไฟล์หาย = ข้าม ไม่ล้ม
  const jobC = makeJob("ไม่มีรูป", { "r3-a1.mp4": "c" });
  const c1 = await M.exportClip({ root, now, job: jobC, prev: null });
  check("รูปที่เลือกไฟล์หาย → ข้าม", c1.files, ["คลิป-720p.mp4", "โพสต์.txt"]);

  // =====================================================================================
  // โฟลเดอร์ตามวันโพสต์ + ทำต่อเอง (ไม่มีคลิป) + product ID + ไฟล์ตั้งค่าโควต้า
  // =====================================================================================
  const root4 = join(tmp, "TTS-posting");
  const subdirs = (...p) => ls(join(root4, ...p));
  const mkSource = (job, name = "source-0.png") => {
    writeFileSync(join(job.flowDir, name), "src-photo");
    return { ...job, images: [...job.images, { kind: "source", round: 0, chosen: false, filename: name }] };
  };
  /** งานที่ยังไม่มีคลิป: มีแต่รูปต้นทาง (+ รูปที่เลือกถ้า withChosen) */
  function makeTakeoverJob(name, { withChosen = false, productName = name, caption = "", hashtags = "", chatgptOutput = "", productId = null } = {}) {
    const base = makeJob(name, { "r1-a1-2.png": "w", "r2-a1-1.jpg": "u" });
    const images = withChosen ? base.images.filter((i) => i.kind !== "video") : [];
    return mkSource({ ...base, productName, caption, hashtags, chatgptOutput, productId, images });
  }
  const T = { allowNoClip: true };

  // ---- ทำต่อเอง: ไม่มีคลิป ----
  const tkA = makeTakeoverJob("ต้นทางอย่างเดียว", { productName: "" });
  const rA = await M.exportClip({ root: root4, now, job: tkA, prev: null, ...T });
  check("ทำต่อเอง: มีแต่รูปต้นทาง → โฟลเดอร์ที่พรุ่งนี้ (3-10-69) มีรูปต้นทางอย่างเดียว", [rA.outcome, rA.path, rA.files], ["new", join(root4, "October", "3-10-69", "1_clip"), ["รูปต้นทาง.png"]]);
  check("ทำต่อเอง: รูปต้นทางก๊อปมาครบเนื้อหา", read(join(rA.path, "รูปต้นทาง.png")), "src-photo");
  check("ทำต่อเอง: record มี video เป็น null (กดซ้ำเป็น update เสมอ)", rA.record, { path: rA.path, video: null });

  const tkB = makeTakeoverJob("มีรูปที่เลือก", { withChosen: true, productName: "" });
  const rB = await M.exportClip({ root: root4, now, job: tkB, prev: null, ...T });
  check("ทำต่อเอง: มีรูปที่เลือกรอบ 1/2 → ก๊อปมาด้วย", rB.files, ["รูปต้นทาง.png", "รูป-พื้นหลังขาว.png", "รูป-ตอนใช้งาน.jpg"]);

  const tkC = makeTakeoverJob("มีข้อความ", { withChosen: true, productName: "สินค้า C", caption: "แคปชัน C", hashtags: "#c", chatgptOutput: "เสียงพากย์: สวัสดีครับ", productId: "9988" });
  const rC = await M.exportClip({ root: root4, now, job: tkC, prev: null, ...T });
  check("ทำต่อเอง: มีพรอมต์+แคปชัน → มีเสียงพากย์.txt และ โพสต์.txt", rC.files, ["รูปต้นทาง.png", "รูป-พื้นหลังขาว.png", "รูป-ตอนใช้งาน.jpg", "เสียงพากย์.txt", "โพสต์.txt"]);
  check("ทำต่อเอง: เนื้อเสียงพากย์", read(join(rC.path, "เสียงพากย์.txt")), "สวัสดีครับ\n");
  check("product ID: อยู่ท้าย โพสต์.txt", read(join(rC.path, "โพสต์.txt")), "สินค้า C\n\nแคปชัน C\n\n#c\n\nProduct ID: 9988\n");
  check("ทำต่อเอง: ไม่ใส่คลิปและไม่เหลือไฟล์คลิป", ls(rC.path).some((f) => f.startsWith("คลิป-")), false);

  // ---- กดส่งซ้ำของงานไม่มีคลิป = อัปเดตโฟลเดอร์เดิม (ข้อความมาทีหลัง) ----
  const tkC2 = { ...tkC, caption: "แคปชันใหม่", productId: null };
  const rC2 = await M.exportClip({ root: root4, now: new Date(2026, 9, 2, 18), job: tkC2, prev: rC.record, ...T });
  check("ส่งซ้ำงานไม่มีคลิป → updated โฟลเดอร์เดิม ไม่ขอช่องใหม่", [rC2.outcome, rC2.path], ["updated", rC.path]);
  check("ส่งซ้ำ: ข้อความใหม่เข้าโฟลเดอร์เดิม (product ID ที่หายไปก็ไม่ค้าง)", read(join(rC.path, "โพสต์.txt")), "สินค้า C\n\nแคปชันใหม่\n\n#c\n");
  check("ส่งซ้ำ: ยังไม่มีโฟลเดอร์ซ้ำของงานเดียวกัน", subdirs("October", "3-10-69"), ["1_clip", "2_clip", "3_สินค้า C"]);
  check("ส่งซ้ำ: record ยังเป็น video null", rC2.record, { path: rC.path, video: null });

  // ---- คลิปมาทีหลัง: ส่งซ้ำอัปเดตโฟลเดอร์เดิม ใส่คลิปเพิ่ม ไม่ลบรูปต้นทาง ----
  const tkCClip = { ...tkC2, images: [...tkC2.images, { kind: "video", round: 3, chosen: false, filename: "r3-a1.mp4" }] };
  writeFileSync(join(tkC2.flowDir, "r3-a1.mp4"), "late-clip");
  const rC3 = await M.exportClip({ root: root4, now, job: tkCClip, prev: rC2.record, ...T });
  check("คลิปมาทีหลัง → updated โฟลเดอร์เดิม มีคลิป และรูปต้นทางยังอยู่", [rC3.outcome, rC3.path, ls(rC.path).includes("คลิป-720p.mp4"), ls(rC.path).includes("รูปต้นทาง.png")], ["updated", rC.path, true, true]);

  // ---- กดซ้ำโดยคลิปไม่เปลี่ยน: ข้ามแค่การก๊อปคลิป ข้อความเขียนใหม่ในโฟลเดอร์เดิม ไม่ย้ายวัน (review fix) ----
  writeFileSync(join(tkC2.flowDir, "r3-a1.mp4"), "late-clip-changed-on-disk");
  const tkD = { ...tkCClip, caption: "แคปชัน D", chatgptOutput: "เสียงพากย์: ข้อความใหม่" };
  const rD = await M.exportClip({ root: root4, now, job: tkD, prev: rC3.record, ...T });
  check("คลิปเดิม + มีข้อความใหม่ → outcome already โฟลเดอร์เดิม", [rD.outcome, rD.path], ["already", rC.path]);
  check("already: โพสต์.txt เขียนใหม่", read(join(rC.path, "โพสต์.txt")), "สินค้า C\n\nแคปชัน D\n\n#c\n");
  check("already: เสียงพากย์.txt เขียนใหม่", read(join(rC.path, "เสียงพากย์.txt")), "ข้อความใหม่\n");
  check("already: ไม่ก๊อปคลิปทับ", read(join(rC.path, "คลิป-720p.mp4")), "late-clip");
  check("already: ไม่ย้ายวัน/ไม่ขอช่องใหม่ + files ตรงของในโฟลเดอร์", [subdirs("October", "3-10-69"), [...rD.files].sort()], [["1_clip", "2_clip", "3_สินค้า C"], ls(rC.path)]);

  // ---- รูปต้นทางอยู่ในทุกโฟลเดอร์ รวมงานของบอท (มีคลิป) ทั้งส่งใหม่และอัปเดต (review fix) ----
  const botSrc = mkSource(makeJob("บอทมีต้นทาง", { "r1-a1-2.png": "w", "r2-a1-1.jpg": "u", "r3-a1.mp4": "bot-clip" }));
  const rBot = await M.exportClip({ root: root4, now, job: botSrc, prev: null });
  check("งานบอท (มีคลิป) ส่งใหม่ → มี รูปต้นทาง.png ด้วย", [rBot.outcome, rBot.files.includes("รูปต้นทาง.png"), rBot.files.includes("คลิป-720p.mp4")], ["new", true, true]);
  check("งานบอท: เนื้อรูปต้นทางตรงต้นทาง", read(join(rBot.path, "รูปต้นทาง.png")), "src-photo");
  rmSync(join(rBot.path, "รูปต้นทาง.png"));
  writeFileSync(join(botSrc.flowDir, "r3-final.mp4"), "bot-1080");
  const botSrc1080 = { ...botSrc, images: [...botSrc.images.filter((i) => i.kind !== "video"), { kind: "video", round: 3, chosen: true, filename: "r3-final.mp4" }] };
  const rBot2 = await M.exportClip({ root: root4, now, job: botSrc1080, prev: rBot.record });
  check("งานบอท อัปเดต 720p→1080p → updated และรูปต้นทางกลับมาอยู่ในโฟลเดอร์", [rBot2.outcome, ls(rBot.path).includes("รูปต้นทาง.png")], ["updated", true]);

  // ---- งานปกติ (บอท) ยังต้องมีคลิป ----
  const before4 = JSON.stringify(subdirs("October", "3-10-69"));
  check("ไม่ได้ทำต่อเอง + ไม่มีคลิป → error เดิม ไม่สร้างโฟลเดอร์", await rejects(() => M.exportClip({ root: root4, now, job: tkB, prev: null })), "งานนี้ยังไม่มีไฟล์คลิป");
  check("…และไม่มีโฟลเดอร์เพิ่ม", JSON.stringify(subdirs("October", "3-10-69")), before4);
  const tkNoSrc = { ...makeTakeoverJob("ไม่มีรูปต้นทางในแถว", { productName: "x" }), images: [] };
  const rNoSrc = await M.exportClip({ root: root4, now, job: tkNoSrc, prev: null, ...T });
  check("ทำต่อเอง: ไม่มีแถวรูปต้นทางเลย → ยังสร้างโฟลเดอร์ (มีโพสต์.txt)", rNoSrc.files, ["โพสต์.txt"]);
  const lostBase = makeTakeoverJob("รูปต้นทางหาย", { productName: "" });
  const tkLostSrc = { ...mkSource(lostBase, "source-9.png"), images: [{ kind: "source", round: 0, chosen: false, filename: "source-9.png" }] };
  rmSync(join(tkLostSrc.flowDir, "source-9.png"));
  const rLost = await M.exportClip({ root: root4, now, job: tkLostSrc, prev: null, ...T });
  check("ทำต่อเอง: ไฟล์รูปต้นทางหาย → ข้าม ไม่ล้ม", [rLost.outcome, rLost.files], ["new", []]);

  // ---- วันโพสต์: เติมวันละ N แล้วไล่ไปวันถัดไป ----
  const root5 = join(tmp, "TTS-fill");
  const day5 = (d) => ls(join(root5, "October", d));
  const jobsFill = [1, 2, 3, 4, 5].map((i) => makeJob(`fill${i}`, { "r1-a1-2.png": "w", "r2-a1-1.jpg": "u", "r3-a1.mp4": `c${i}` }));
  const fillPaths = [];
  for (const j of jobsFill) fillPaths.push((await M.exportClip({ root: root5, now, job: j, prev: null, perDay: 2 })).path);
  check("N=2: คลิป 1–2 ลงพรุ่งนี้ (3-10-69) ช่อง 1,2", [day5("3-10-69")], [["1_fill1", "2_fill2"]]);
  check("N=2: คลิป 3–4 ลงมะรืน (4-10-69) นับช่องใหม่ในวันนั้น", [day5("4-10-69")], [["1_fill3", "2_fill4"]]);
  check("N=2: คลิปที่ 5 ลง 5-10-69", [day5("5-10-69")], [["1_fill5"]]);
  check("วันที่ส่ง (2-10-69) ไม่มีโฟลเดอร์เลย — วันที่ในโฟลเดอร์คือวันโพสต์", existsSync(join(root5, "October", "2-10-69")), false);

  // กดซ้ำไม่ย้ายวัน แม้วันนั้นเต็ม
  writeFileSync(join(jobsFill[0].flowDir, "r3-final.mp4"), "fill1-1080");
  const upd = await M.exportClip({ root: root5, now, job: withVideo(jobsFill[0], "r3-final.mp4"), prev: { path: fillPaths[0], video: "r3-a1.mp4" }, perDay: 2 });
  check("ส่งซ้ำ/อัปเดตไม่ย้ายวัน (3-10-69 เต็มแล้วก็ยังอยู่ที่เดิม)", [upd.outcome, upd.path, day5("3-10-69")], ["updated", fillPaths[0], ["1_fill1", "2_fill2"]]);

  // โฟลเดอร์ถูกลบ → ได้ช่องใหม่ของวันแรกที่ว่าง
  rmSync(fillPaths[0], { recursive: true, force: true });
  const re = await M.exportClip({ root: root5, now, job: jobsFill[0], prev: { path: fillPaths[0], video: "r3-a1.mp4" }, perDay: 2 });
  check("โฟลเดอร์ถูกลบ → วันแรกที่ว่างคือ 3-10-69 อีกครั้ง (ช่อง 3 เพราะสูงสุดเดิมคือ 2)", [re.outcome, re.path], ["new", join(root5, "October", "3-10-69", "3_fill1")]);

  // โฟลเดอร์ที่ผู้ใช้ทำเองนับรวม + วันที่ผ่านไปแล้วไม่นับ + เลขช่อง = สูงสุด+1
  const root6 = join(tmp, "TTS-foreign");
  for (const d of ["1-10-69", "2-10-69"]) mkdirSync(join(root6, "October", d), { recursive: true }); // วันที่ผ่านไปแล้ว (ว่าง)
  for (const f of ["1_ของฉัน", "2_ของฉัน", "ทำเอง"]) mkdirSync(join(root6, "October", "3-10-69", f), { recursive: true }); // 3 โฟลเดอร์ย่อย
  writeFileSync(join(root6, "October", "3-10-69", "ไฟล์เดี่ยว.txt"), "ไม่ใช่โฟลเดอร์ ไม่นับ");
  mkdirSync(join(root6, "October", "4-10-69", "7_ของฉัน"), { recursive: true });
  const jf = makeJob("foreign", { "r1-a1-2.png": "w", "r2-a1-1.jpg": "u", "r3-a1.mp4": "f" });
  const f1 = await M.exportClip({ root: root6, now, job: jf, prev: null, perDay: 4 });
  check("นับโฟลเดอร์ที่ผู้ใช้ทำเอง: 3-10-69 มี 3 (ไฟล์เดี่ยวไม่นับ) ยังว่าง 1 → ลงวันนั้น เลขช่อง = สูงสุด+1", f1.path, join(root6, "October", "3-10-69", "3_foreign"));
  const jf2 = makeJob("foreign2", { "r1-a1-2.png": "w", "r2-a1-1.jpg": "u", "r3-a1.mp4": "f2" });
  const f2 = await M.exportClip({ root: root6, now, job: jf2, prev: null, perDay: 4 });
  check("3-10-69 เต็ม 4 → 4-10-69 และเลขช่อง = 7+1", f2.path, join(root6, "October", "4-10-69", "8_foreign2"));
  check("วันที่ผ่านไปแล้วไม่ได้รับคลิปใหม่", [ls(join(root6, "October", "1-10-69")), ls(join(root6, "October", "2-10-69"))], [[], []]);

  // ข้ามเดือน / ข้ามปี
  const root7 = join(tmp, "TTS-rollover");
  const jr = makeJob("rollover", { "r1-a1-2.png": "w", "r2-a1-1.jpg": "u", "r3-a1.mp4": "r" });
  const r1 = await M.exportClip({ root: root7, now: new Date(2026, 9, 31, 10), job: jr, prev: null });
  check("ส่ง 31 ต.ค. → พรุ่งนี้อยู่เดือนถัดไป: November\\1-11-69", r1.path, join(root7, "November", "1-11-69", "1_rollover"));
  const r2 = await M.exportClip({ root: root7, now: new Date(2026, 11, 31, 10), job: jr, prev: null });
  check("ส่ง 31 ธ.ค. → January\\1-1-70", r2.path, join(root7, "January", "1-1-70", "1_rollover"));
  // วันเต็มข้ามเดือน: 31 ต.ค. เต็ม → 1 พ.ย.
  const root8 = join(tmp, "TTS-rollover-full");
  for (const f of ["1_a", "2_b"]) mkdirSync(join(root8, "October", "31-10-69", f), { recursive: true });
  const r3 = await M.exportClip({ root: root8, now: new Date(2026, 9, 30, 10), job: jr, prev: null, perDay: 2 });
  check("พรุ่งนี้ (31 ต.ค.) เต็ม → วันถัดไปอยู่เดือนใหม่ November\\1-11-69", r3.path, join(root8, "November", "1-11-69", "1_rollover"));

  // product ID: ไม่มี = ไม่มีบรรทัด
  const rNoId = await M.exportClip({ root: root4, now, job: { ...jobsFill[1], productId: null, caption: "ก", hashtags: "" }, prev: null });
  check("ไม่มี product ID → โพสต์.txt ไม่มีบรรทัด Product ID", read(join(rNoId.path, "โพสต์.txt")).includes("Product ID"), false);
  const rId = await M.exportClip({ root: root4, now, job: { ...jobsFill[2], productId: "5566" }, prev: null });
  check("ส่งปกติ (มีคลิป) + product ID → ท้าย โพสต์.txt", read(join(rId.path, "โพสต์.txt")).endsWith("Product ID: 5566\n"), true);

  // ---- ไฟล์ตั้งค่าโควต้า (tts-settings.json ที่ root ของ repo, gitignore) ----
  const S = tsxRequire("../lib/tts-settings.ts", import.meta.url);
  const sFile = join(tmp, "tts-settings.json");
  check("ตั้งค่า: ไม่มีไฟล์ → 4", await S.readPostsPerDay(sFile), 4);
  await S.writePostsPerDay(6, sFile);
  check("ตั้งค่า: เขียน 6 แล้วอ่านได้ 6", await S.readPostsPerDay(sFile), 6);
  writeFileSync(sFile, "{oops");
  check("ตั้งค่า: ไฟล์เสีย → 4", await S.readPostsPerDay(sFile), 4);
  writeFileSync(sFile, JSON.stringify({ postsPerDay: 99 }));
  check("ตั้งค่า: ค่านอก 1–20 ในไฟล์ → 4", await S.readPostsPerDay(sFile), 4);
  writeFileSync(sFile, JSON.stringify({ postsPerDay: 5 }));
  for (const bad of [0, 21, 2.5, "abc", null]) {
    check(`ตั้งค่า: เขียน ${JSON.stringify(bad)} → error ไทย ไม่แตะไฟล์`, [await rejects(() => S.writePostsPerDay(bad, sFile)), await S.readPostsPerDay(sFile)], ["ตั้งได้ 1–20 คลิปต่อวัน", 5]);
  }
  check("ตั้งค่า: path ของไฟล์จริงคือ tts-settings.json ที่ root repo", S.TTS_SETTINGS_FILE.endsWith("tts-settings.json"), true);
} finally {
  restoreCopyFile();
  rmSync(tmp, { recursive: true, force: true });
}
if (failed > 0) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log("\nall checks passed");
