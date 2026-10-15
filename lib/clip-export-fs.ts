/**
 * ส่งงานเข้าโฟลเดอร์ TTS ทั้งชุด — ส่วนที่แตะดิสก์ของปุ่ม "ส่งเข้าโฟลเดอร์ TTS" อยู่ที่นี่ที่เดียว (ฝั่งเซิร์ฟเวอร์เท่านั้น ใช้ node:fs)
 * ตรรกะ pure (ชื่อโฟลเดอร์/วันที่/เลือกวันโพสต์/ตัดสินส่งซ้ำ) อยู่ lib/clip-export.ts ซึ่ง client import ได้ — ห้ามย้าย node:* ไปที่นั่น
 * server action (exportClipToFolder / takeOverFlowJob ใน app/actions.ts) ถือแค่: หางานจาก DB · อ่านแถว user_export_clip ล่าสุดเป็น prev ·
 * บันทึก `record` ที่คืนไป (เมื่อ outcome ไม่ใช่ "already") · เปิด Explorer
 * ทดสอบกับโฟลเดอร์ชั่วคราวจริง: scripts/check-clip-export-fs.mjs
 */
import { copyFile, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { extractVoiceoverScript } from "@/lib/claim-check";
import {
  DEFAULT_POSTS_PER_DAY, MONTHS, buildPostText, exportAction, exportClipName, exportDateParts, nextSlotNumber, otherExportClipName,
  pickPostingDay, shortFolderName, slotFolderName, sourcePhotoName, tomorrowOf,
  type ExportRecord,
} from "@/lib/clip-export";
import { FINAL_VIDEO_FILENAME, currentSourceImage } from "@/lib/flow-jobs";
import { joinPath } from "@/lib/upload-paths";
import { getRuntimePaths } from "@/lib/runtime-paths";

/** root ของโฟลเดอร์ TTS = CLIP_EXPORT_ROOT ถ้าตั้ง ไม่งั้น Desktop\TTS (โฟลเดอร์งานจริงของผู้ใช้ — ตอนทดสอบต้องตั้ง env นี้เสมอ) */
export function clipExportRoot(): string {
  return getRuntimePaths().exportRoot;
}

/** ข้อมูลของงานที่ต้องใช้ส่ง — images = แถว FlowJobImage ของงาน, flowDir = uploads/<entryId>/flow */
export type ClipExportJob = {
  productName: string;
  chatgptOutput: string;
  caption: string;
  hashtags: string;
  /** Product ID จาก Showcase (สินค้าที่ไม่ได้มาจาก Showcase = ไม่มี) — ลงบรรทัดท้าย โพสต์.txt */
  productId?: string | null;
  flowDir: string;
  images: { kind: string; round: number; chosen: boolean; filename: string; index?: number; attempt?: number }[];
};

/** already = คลิปเดิม โฟลเดอร์ยังอยู่ ไม่ก๊อปคลิป (ข้อความ/รูปเขียนใหม่) · updated = เขียนทับในโฟลเดอร์เดิม · new = ช่องใหม่ของวันโพสต์ */
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

async function subdirNames(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

/**
 * จำนวนโฟลเดอร์ย่อยของแต่ละวันที่มีอยู่จริงใต้ root (key = ชื่อโฟลเดอร์วัน "d-m-yy") — นับของที่ผู้ใช้สร้างเองด้วย
 * (โฟลเดอร์ย่อยเท่านั้น ไฟล์เดี่ยวไม่นับ) · อ่านเฉพาะโฟลเดอร์เดือนอังกฤษ (January…December) ที่ app สร้าง
 */
async function countFoldersByDay(root: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const month of (await subdirNames(root)).filter((n) => MONTHS.includes(n))) {
    for (const day of (await subdirNames(path.join(root, month))).filter((n) => /^\d+-\d+-\d+$/.test(n))) {
      counts[day] = (counts[day] ?? 0) + (await subdirNames(path.join(root, month, day))).length;
    }
  }
  return counts;
}

/**
 * ส่งคลิป + รูปที่เลือกรอบ 1/2 + เสียงพากย์.txt + โพสต์.txt ของงานไปที่ <root>\<Month>\<d-m-yy>\<n>_<ชื่อสั้น≤30>\
 * วันที่ (d-m-yy) = "วันที่จะโพสต์": ไล่จากพรุ่งนี้ไปข้างหน้า วันแรกที่มีโฟลเดอร์ย่อยน้อยกว่า perDay (ค่าเริ่มต้น 4) · เลขช่อง = สูงสุดของวันนั้น +1
 * prev = แถว user_export_clip ล่าสุดของงาน (null = ยังไม่เคยส่ง) ตัดสินด้วย exportAction · ส่งซ้ำ/อัปเดตไม่ย้ายวัน
 * allowNoClip = ทำต่อเอง: งานไม่มีไฟล์คลิปก็สร้างโฟลเดอร์ได้ — ใส่รูปต้นทาง (รูปต้นทาง.<ext>) เสมอ + รูปที่เลือก/เสียงพากย์/โพสต์ ตามที่มี
 * และ record.video = null (กดซ้ำจึงเป็น update ของโฟลเดอร์เดิมเสมอ) · งานปกติของบอทยังต้องมีคลิป
 * ลำดับที่ต้องคงไว้: เช็กว่ามีไฟล์คลิปก่อนสร้างโฟลเดอร์ใดๆ · ส่งใหม่แล้วก๊อปล้มกลางทาง = ลบโฟลเดอร์ใหม่ทิ้ง ·
 * อัปเดตแล้วล้ม = ห้ามลบโฟลเดอร์ (เป็นของที่ผู้ใช้ส่งไว้แล้ว) · error ที่ throw เป็นข้อความไทยพร้อมโชว์ผู้ใช้
 */
export async function exportClip(args: {
  root: string;
  now: Date;
  job: ClipExportJob;
  prev: ExportRecord | null;
  /** คลิปต่อวันโพสต์ (ไม่ส่ง = 4) */
  perDay?: number;
  allowNoClip?: boolean;
}): Promise<ClipExportResult> {
  const { root, now, job, prev } = args;
  const perDay = args.perDay ?? DEFAULT_POSTS_PER_DAY;
  const videoRow = job.images.find((i) => i.kind === "video");
  let video: { filename: string; src: string } | null = null;
  if (videoRow) {
    const src = joinPath(job.flowDir, videoRow.filename);
    if (await isFile(src)) video = { filename: videoRow.filename, src };
    else if (!args.allowNoClip) throw new Error("หาไฟล์คลิปในเครื่องไม่เจอ");
  } else if (!args.allowNoClip) {
    throw new Error("งานนี้ยังไม่มีไฟล์คลิป");
  }
  const record: ExportRecord = { path: "", video: video?.filename ?? null };

  // งานไม่มีคลิปส่ง "" (ไม่เท่ากับ video ของแถวเดิมเลย) → ส่งซ้ำเป็น update เสมอ
  const action = exportAction(prev, prev !== null && (await isDir(prev.path)), video?.filename ?? "");

  /**
   * เขียนของทั้งชุดลง dir — ใช้ทั้งส่งใหม่ อัปเดต และกดซ้ำโดยคลิปไม่เปลี่ยน (ไฟล์ชื่อเดิมถูกเขียนทับ)
   * copyClip=false (กดซ้ำคลิปเดิม) ข้ามแค่การก๊อปคลิป/ลบคลิปอีกขนาด · รูปต้นทาง รูปที่เลือก ข้อความเขียนใหม่เสมอ
   */
  async function writeContents(dir: string, copyClip = true): Promise<string[]> {
    const files: string[] = [];
    if (video !== null) {
      const isFinal = video.filename === FINAL_VIDEO_FILENAME;
      const clipName = exportClipName(isFinal);
      const mergedVideoPath = joinPath(job.flowDir, "r3-merged.mp4");
      const videoSrc = (await isFile(mergedVideoPath)) ? mergedVideoPath : video.src;
      if (copyClip) {
        await copyFile(videoSrc, joinPath(dir, clipName));
        // อัปเดต 720p → 1080p: ห้ามเหลือคลิปอีกขนาดค้างไว้ให้หยิบผิดตัวไปโพสต์
        await rm(joinPath(dir, otherExportClipName(isFinal)), { force: true });
        files.push(clipName);
      } else if (await isFile(joinPath(dir, clipName))) {
        files.push(clipName); // กดซ้ำคลิปเดิม: ไม่ก๊อปทับ แต่คลิปยังอยู่ในรายการไฟล์
      }
    }

    // ไฟล์เสียงพากย์ (TTS) — หากมีการสร้างเสียงพากย์ไว้ ก๊อปปี้ไปเป็น เสียงพากย์.wav
    const ttsAudioPath = joinPath(job.flowDir, "tts-audio.wav");
    if (await isFile(ttsAudioPath)) {
      const audioName = "เสียงพากย์.wav";
      await copyFile(ttsAudioPath, joinPath(dir, audioName));
      files.push(audioName);
    }

    // รูปต้นทางอยู่ในทุกโฟลเดอร์ (งานบอทและทำต่อเอง) — ของที่ต้องลากเข้า Flow ถ้าจะเรนเดอร์ใหม่เอง · รูปปัจจุบัน (หลังเปลี่ยนรูปต้นทาง = แถวล่าสุด)
    const source = currentSourceImage(job.images.map((i) => ({ ...i, attempt: i.attempt ?? 1, index: i.index ?? 0 })));
    if (source) {
      const src = joinPath(job.flowDir, source.filename);
      if (await isFile(src)) {
        const name = sourcePhotoName(path.extname(source.filename));
        await copyFile(src, joinPath(dir, name));
        files.push(name);
      }
    }

    const chosen = (round: number) => job.images.find((i) => i.kind === "candidate" && i.round === round && i.chosen);
    for (const [row, label] of [[chosen(1), "รูป-พื้นหลังขาว"], [chosen(2), "รูป-ตอนใช้งาน"]] as const) {
      if (!row) continue;
      const src = joinPath(job.flowDir, row.filename);
      if (!(await isFile(src))) continue;
      const name = `${label}${path.extname(row.filename)}`;
      await copyFile(src, joinPath(dir, name));
      files.push(name);
    }

    // ข้อความว่างตอนนี้ = ลบไฟล์เก่า (ตอนอัปเดต) ไม่ปล่อยข้อความของคลิปก่อนค้างไว้
    const texts: [string, string][] = [
      ["เสียงพากย์.txt", extractVoiceoverScript(job.chatgptOutput).trim()],
      ["โพสต์.txt", buildPostText({ productName: job.productName, caption: job.caption, hashtags: job.hashtags, productId: job.productId })],
    ];
    for (const [name, text] of texts) {
      if (text === "") {
        await rm(joinPath(dir, name), { force: true });
        continue;
      }
      await writeFile(joinPath(dir, name), text + "\n", "utf8");
      files.push(name);
    }
    return files;
  }

  if ((action === "update" || action === "already") && prev !== null) {
    try {
      const files = await writeContents(prev.path, action === "update");
      return { path: prev.path, outcome: action === "update" ? "updated" : "already", files, record: { ...record, path: prev.path } };
    } catch (err) {
      // โฟลเดอร์นี้เป็นของที่ผู้ใช้ส่งไว้แล้ว — ห้ามลบทิ้งตอนอัปเดตพัง
      throw friendlyError(err);
    }
  }

  let created = "";
  try {
    const postingDay = pickPostingDay(await countFoldersByDay(root), tomorrowOf(now), perDay);
    const { month, day } = exportDateParts(postingDay);
    const dayDir = path.join(root, month, day);
    await mkdir(dayDir, { recursive: true });
    const n = nextSlotNumber(await subdirNames(dayDir));
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
