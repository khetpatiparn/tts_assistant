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
  const dayDir = join(root, "October", "2-10-69");
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
  check("ส่งครั้งแรก → new ที่ <root>\\October\\2-10-69\\1_<ชื่อ>", [a1.outcome, a1.path], ["new", dirA1]);
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

  // 10) ไฟล์ (ไม่ใช่โฟลเดอร์) ชื่อชนช่องถัดไป → mkdir ล้ม แต่ต้องไม่ลบไฟล์นั้นตอน rollback
  const day2 = join(root, "October", "3-10-69");
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
} finally {
  restoreCopyFile();
  rmSync(tmp, { recursive: true, force: true });
}
if (failed > 0) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log("\nall checks passed");
