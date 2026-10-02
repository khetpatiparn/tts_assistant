/**
 * ส่งงานเข้าโฟลเดอร์ TTS ทั้งชุด — ส่วนที่แตะดิสก์ของปุ่ม "ส่งเข้าโฟลเดอร์ TTS" อยู่ที่นี่ที่เดียว (ฝั่งเซิร์ฟเวอร์เท่านั้น ใช้ node:fs)
 * ตรรกะ pure (ชื่อโฟลเดอร์/วันที่/ตัดสินส่งซ้ำ) อยู่ lib/clip-export.ts ซึ่ง client import ได้ — ห้ามย้าย node:* ไปที่นั่น
 * server action (exportClipToFolder ใน app/actions.ts) ถือแค่: หางานจาก DB · อ่านแถว user_export_clip ล่าสุดเป็น prev ·
 * บันทึก `record` ที่คืนไป (เมื่อ outcome ไม่ใช่ "already") · เปิด Explorer
 * ทดสอบกับโฟลเดอร์ชั่วคราวจริง: scripts/check-clip-export-fs.mjs
 */
import { copyFile, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { extractVoiceoverScript } from "@/lib/claim-check";
import {
  buildPostText, exportAction, exportClipName, exportDateParts, nextSlotNumber, otherExportClipName, shortFolderName, slotFolderName,
  type ExportRecord,
} from "@/lib/clip-export";
import { FINAL_VIDEO_FILENAME } from "@/lib/flow-jobs";
import { joinPath } from "@/lib/upload-paths";

/** root ของโฟลเดอร์ TTS = CLIP_EXPORT_ROOT ถ้าตั้ง ไม่งั้น Desktop\TTS (โฟลเดอร์งานจริงของผู้ใช้ — ตอนทดสอบต้องตั้ง env นี้เสมอ) */
export function clipExportRoot(): string {
  return process.env.CLIP_EXPORT_ROOT ?? path.join(os.homedir(), "Desktop", "TTS");
}

/** ข้อมูลของงานที่ต้องใช้ส่ง — images = แถว FlowJobImage ของงาน, flowDir = uploads/<entryId>/flow */
export type ClipExportJob = {
  productName: string;
  chatgptOutput: string;
  caption: string;
  hashtags: string;
  flowDir: string;
  images: { kind: string; round: number; chosen: boolean; filename: string }[];
};

/** already = คลิปเดิม โฟลเดอร์ยังอยู่ ไม่ก๊อปอะไร · updated = เขียนทับในโฟลเดอร์เดิม · new = ช่องใหม่ของวันนี้ */
export type ClipExportOutcome = "already" | "updated" | "new";

export type ClipExportResult = {
  path: string;
  outcome: ClipExportOutcome;
  /** ชื่อไฟล์ในโฟลเดอร์ที่ส่ง (already = ของที่มีอยู่ในโฟลเดอร์ตอนนี้) */
  files: string[];
  /** สิ่งที่ต้องบันทึกเป็น detail ของแถว user_export_clip (ผู้เรียกบันทึกเมื่อ outcome ไม่ใช่ "already") */
  record: ExportRecord;
};

async function isFile(p: string): Promise<boolean> {
  return stat(p).then((s) => s.isFile(), () => false);
}

async function isDir(p: string): Promise<boolean> {
  return stat(p).then((s) => s.isDirectory(), () => false);
}

function friendlyError(err: unknown): Error {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "EACCES" || code === "EPERM") return new Error("ไม่มีสิทธิ์เขียนในโฟลเดอร์ TTS");
  return new Error("ส่งเข้าโฟลเดอร์ TTS ไม่สำเร็จ ลองอีกครั้ง");
}

/**
 * ส่งคลิป + รูปที่เลือกรอบ 1/2 + เสียงพากย์.txt + โพสต์.txt ของงานไปที่ <root>\<Month>\<d-m-yy>\<n>_<ชื่อสั้น≤30>\
 * prev = แถว user_export_clip ล่าสุดของงาน (null = ยังไม่เคยส่ง) ตัดสินด้วย exportAction
 * ลำดับที่ต้องคงไว้: เช็กว่ามีไฟล์คลิปก่อนสร้างโฟลเดอร์ใดๆ · ส่งใหม่แล้วก๊อปล้มกลางทาง = ลบโฟลเดอร์ใหม่ทิ้ง ·
 * อัปเดตแล้วล้ม = ห้ามลบโฟลเดอร์ (เป็นของที่ผู้ใช้ส่งไว้แล้ว) · error ที่ throw เป็นข้อความไทยพร้อมโชว์ผู้ใช้
 */
export async function exportClip(args: { root: string; now: Date; job: ClipExportJob; prev: ExportRecord | null }): Promise<ClipExportResult> {
  const { root, now, job, prev } = args;
  const video = job.images.find((i) => i.kind === "video");
  if (!video) throw new Error("งานนี้ยังไม่มีไฟล์คลิป");
  const videoSrc = joinPath(job.flowDir, video.filename);
  if (!(await isFile(videoSrc))) throw new Error("หาไฟล์คลิปในเครื่องไม่เจอ");
  const record: ExportRecord = { path: "", video: video.filename };

  const action = exportAction(prev, prev !== null && (await isDir(prev.path)), video.filename);
  if (action === "already" && prev !== null) {
    const files = await readdir(prev.path).catch(() => [] as string[]);
    return { path: prev.path, outcome: "already", files, record: { ...record, path: prev.path } };
  }

  const isFinal = video.filename === FINAL_VIDEO_FILENAME;
  /** เขียนของทั้งชุดลง dir — ใช้ทั้งส่งใหม่และอัปเดตโฟลเดอร์เดิม (ไฟล์ชื่อเดิมถูกเขียนทับ) */
  async function writeContents(dir: string): Promise<string[]> {
    const files: string[] = [];
    const clipName = exportClipName(isFinal);
    await copyFile(videoSrc, path.join(dir, clipName));
    files.push(clipName);
    // อัปเดต 720p → 1080p: ห้ามเหลือคลิปอีกขนาดค้างไว้ให้หยิบผิดตัวไปโพสต์
    await rm(path.join(dir, otherExportClipName(isFinal)), { force: true });

    const chosen = (round: number) => job.images.find((i) => i.kind === "candidate" && i.round === round && i.chosen);
    for (const [row, label] of [[chosen(1), "รูป-พื้นหลังขาว"], [chosen(2), "รูป-ตอนใช้งาน"]] as const) {
      if (!row) continue;
      const src = joinPath(job.flowDir, row.filename);
      if (!(await isFile(src))) continue;
      const name = `${label}${path.extname(row.filename)}`;
      await copyFile(src, path.join(dir, name));
      files.push(name);
    }

    // ข้อความว่างตอนนี้ = ลบไฟล์เก่า (ตอนอัปเดต) ไม่ปล่อยข้อความของคลิปก่อนค้างไว้
    const texts: [string, string][] = [
      ["เสียงพากย์.txt", extractVoiceoverScript(job.chatgptOutput).trim()],
      ["โพสต์.txt", buildPostText({ productName: job.productName, caption: job.caption, hashtags: job.hashtags })],
    ];
    for (const [name, text] of texts) {
      if (text === "") {
        await rm(path.join(dir, name), { force: true });
        continue;
      }
      await writeFile(path.join(dir, name), text + "\n", "utf8");
      files.push(name);
    }
    return files;
  }

  if (action === "update" && prev !== null) {
    try {
      const files = await writeContents(prev.path);
      return { path: prev.path, outcome: "updated", files, record: { ...record, path: prev.path } };
    } catch (err) {
      // โฟลเดอร์นี้เป็นของที่ผู้ใช้ส่งไว้แล้ว — ห้ามลบทิ้งตอนอัปเดตพัง
      throw friendlyError(err);
    }
  }

  const { month, day } = exportDateParts(now);
  const dayDir = path.join(root, month, day);
  let created = "";
  try {
    await mkdir(dayDir, { recursive: true });
    const entries = await readdir(dayDir, { withFileTypes: true });
    const n = nextSlotNumber(entries.filter((e) => e.isDirectory()).map((e) => e.name));
    const dir = path.join(dayDir, slotFolderName(n, shortFolderName(job.productName)));
    await mkdir(dir);
    // นับเป็นของเราหลัง mkdir สำเร็จเท่านั้น — mkdir ชนของที่มีอยู่แล้ว (เช่นไฟล์ชื่อเดียวกัน) ต้องไม่ถูกลบตอน rollback
    created = dir;
    const files = await writeContents(dir);
    return { path: dir, outcome: "new", files, record: { ...record, path: dir } };
  } catch (err) {
    if (created !== "") await rm(created, { recursive: true, force: true }).catch(() => {});
    throw friendlyError(err);
  }
}
