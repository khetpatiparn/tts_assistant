"use server";

import { mkdir, readFile, writeFile, unlink, stat } from "node:fs/promises";
import os from "node:os";
import { spawn } from "node:child_process";
import path from "node:path";
import { parseExportDetail } from "@/lib/clip-export";
import { clipExportRoot, exportClip } from "@/lib/clip-export-fs";
import { readPostsPerDay, writePostsPerDay } from "@/lib/tts-settings";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { newToken } from "@/lib/scanner-link";
import { logUserActivity, waitedMsSince } from "@/lib/flow-user-activity";
import { getProductIdsByEntry, getTookOverJobIds } from "@/lib/flow-queries";
import { buildPromptText } from "@/lib/prompt-template";
import { getFewShotExamples } from "@/lib/few-shot";
import {
  generateTenPartPrompt,
  generateCaptionAndHashtags,
  extractProductFields,
  extractProductSpec,
  extractCandidateRows,
  suggestAngleOptions,
  isGeminiModelId,
  shortenProductName,
} from "@/lib/gemini";
import {
  collectFamily,
  collectUsedAngles,
  parseAngleSuggestions,
  type AngleSuggestion,
} from "@/lib/angle";
import { normalizeName, parseCandidateRows } from "@/lib/candidates";
import { commissionBahtFromPercent, originalImageUrl, parseShowcasePayload } from "@/lib/showcase-import";
import { downloadImage } from "@/lib/showcase-images";
import { showcaseFlowState } from "@/lib/showcase";
import { loadWorkerConfig } from "@/worker/config";
import { CANDIDATE_IMAGE_ROOT, UPLOAD_ROOT, joinPath } from "@/lib/upload-paths";
import { Prisma } from "@/lib/generated/prisma/client";
import { parseCaptionOutput } from "@/lib/caption";
import { parseExtractOutput } from "@/lib/extract";
import { parseAffiliateXlsx, videoIdFromUrl } from "@/lib/affiliate";
import { parseContentCsv } from "@/lib/clip-metrics";
import { handleFromUrl, buildVideoUrl, fetchOembedThumbnail } from "@/lib/tiktok-oembed";
import { parseMonthDayLabel } from "@/lib/csv";
import { createHash } from "crypto";
import type { ImportKind } from "@/lib/import-log";
import {
  FLOW_STATUS,
  acceptShortName,
  SHORT_NAME_TIMEOUT_MS,
  withTimeout,
  FULL_TITLE_PREFIX,
  flowProjectUrl,
  pickBackupBrowserProfile,
  EXTRA_PROMPT_MAX,
  sourceFilename,
} from "@/lib/flow-jobs";
import { autoSourceFilename, isAutoSourceImage } from "@/lib/auto-source-image";
import { removeAutoSourceFiles, replaceAutoSourceImage, replaceAutoSourceWithFlowImages } from "@/lib/auto-source-image-db";
import {
  approveRender,
  choose,
  enqueue,
  promptReady,
  redo,
  resume,
  retryUpscale,
  skip,
  takeOver,
  TAKEOVER_BOT_BUSY_MESSAGE,
} from "@/lib/flow-lifecycle";
import { addImage, applyBulk, applyPlan, applyTakeOver, createJob } from "@/lib/flow-lifecycle-db";

export async function createPrompt(formData: FormData) {
  const productName = String(formData.get("productName") ?? "").trim();
  const productInfo = String(formData.get("productInfo") ?? "").trim();
  const riskModule = String(formData.get("riskModule") ?? "").trim();
  const extraNotes = String(formData.get("extraNotes") ?? "").trim();

  if (!productName || !productInfo) {
    throw new Error("กรุณากรอกชื่อสินค้าและข้อมูลสินค้า");
  }

  const activeCorePrompt = await prisma.corePrompt.findFirst({
    where: { isActive: true, kind: "core" },
  });

  const created = await prisma.promptEntry.create({
    data: {
      productName,
      productInfo,
      riskModule,
      extraNotes,
      images: "[]",
      corePromptId: activeCorePrompt?.id ?? null,
    },
  });

  revalidatePath("/");

  return created.id;
}

export async function duplicatePrompt(sourceId: string): Promise<string> {
  const source = await prisma.promptEntry.findUnique({
    where: { id: sourceId },
    include: { productImages: { orderBy: { sortOrder: "asc" } } },
  });
  if (!source) {
    throw new Error("ไม่พบรายการที่ต้องการทำซ้ำ");
  }

  // ก๊อปเฉพาะฟิลด์ที่ใช้ซ้ำได้ — ปล่อย videoUrl/วันเวลาโพสต์เป็น default เพราะเป็นข้อเท็จจริงรายคลิป
  //
  // สองฟิลด์นี้มีกฎตรงข้ามกัน อย่าสลับ:
  // - `angle` ตั้งใจไม่ก๊อป (ปล่อย default "") — คลิปใหม่ต้องได้ angle ใหม่เสมอ นี่คือหัวใจของ
  //   ฟีเจอร์ angle tracking ถ้าเพิ่ม angle: source.angle กลับเข้ามา จะทำให้ collectUsedAngles
  //   (lib/angle.ts) นับ angle เดิมว่า "ใช้ไปแล้ว" ทันทีทั้งที่คลิปใหม่ยังไม่ได้ถ่ายจริง
  // - `productSpec` ตั้งใจก๊อป — ทำซ้ำคือสินค้าตัวเดิม รูปร่าง/วัสดุ/กลไกไม่เปลี่ยน จึงไม่ควร
  //   จ่ายโควตาสกัดใหม่ ถ้าลบออกจะทำให้ทุกคลิปที่ทำซ้ำต้องเรียก Gemini เพิ่มโดยไม่ได้อะไรกลับมา
  const created = await prisma.promptEntry.create({
    data: {
      productName: source.productName,
      productInfo: source.productInfo,
      riskModule: source.riskModule,
      extraNotes: source.extraNotes,
      images: source.images,
      corePromptId: source.corePromptId,
      chatgptOutput: source.chatgptOutput,
      caption: source.caption,
      hashtags: source.hashtags,
      productSpec: source.productSpec,
      duplicatedFromId: source.id,
    },
  });

  await mkdir(path.join(UPLOAD_ROOT, created.id), { recursive: true });

  for (const image of source.productImages) {
    let data: Buffer;
    try {
      data = await readFile(path.join(UPLOAD_ROOT, image.entryId, image.filename));
    } catch {
      // ไฟล์ต้นฉบับหายบนดิสก์ — ข้ามรูปใบนี้ ไม่ให้ทั้ง action ล้ม (row เป็น source of truth
      // แต่คลิปซ้ำที่ขาดรูปบางใบ ดีกว่า error ทั้งหมด — แนวเดียวกับ deleteProductImage)
      continue;
    }
    const ext =
      image.mimeType === "image/png"
        ? "png"
        : image.mimeType === "image/webp"
          ? "webp"
          : image.mimeType === "image/heic"
            ? "heic"
            : image.mimeType === "image/heif"
              ? "heif"
              : "jpg";
    // รูปต้นทางอัตโนมัติคงเป็นรูปอัตโนมัติใน entry ใหม่ (prefix เดิม) — เข้าคิว Flow ของ entry ใหม่/เลือกรอบ 2 จะแทนมันได้
    // ไม่งั้นมันกลายเป็น "รูปที่ผู้ใช้เพิ่มเอง" ค้างอยู่ตลอดและส่งรูปของร้านให้ Gemini ต่อหลังได้รูปที่ Flow วาดแล้ว
    const filename = isAutoSourceImage(image.filename) ? autoSourceFilename(ext) : `${crypto.randomUUID()}.${ext}`;
    await writeFile(joinPath(UPLOAD_ROOT, created.id, filename), data);
    await prisma.productImage.create({
      data: {
        entryId: created.id,
        filename,
        mimeType: image.mimeType,
        caption: image.caption,
        sortOrder: image.sortOrder,
      },
    });
  }

  revalidatePath("/");
  return created.id;
}

export async function deletePrompt(id: string) {
  await prisma.promptEntry.delete({ where: { id } });
  revalidatePath("/");
  revalidatePath("/dashboard");
}

export async function updateProduction(formData: FormData) {
  const id = String(formData.get("id") ?? "").trim();
  if (!id) {
    throw new Error("ไม่พบรายการที่ต้องการบันทึก");
  }

  const chatgptOutput = String(formData.get("chatgptOutput") ?? "").trim();
  const caption = String(formData.get("caption") ?? "").trim();
  const hashtags = String(formData.get("hashtags") ?? "").trim();
  const videoUrl = String(formData.get("videoUrl") ?? "").trim();
  const rawPostedAt = String(formData.get("postedAt") ?? "").trim();

  if (videoUrl !== "") {
    let isValidUrl = false;
    try {
      const parsed = new URL(videoUrl);
      isValidUrl = parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      isValidUrl = false;
    }
    if (!isValidUrl) {
      throw new Error("ลิงก์คลิปต้องเป็น URL http/https ที่ถูกต้อง");
    }
  }

  // <input type="date"> submits "YYYY-MM-DD". Parse as UTC midnight so the
  // stored date matches what the user picked regardless of server timezone.
  let parsedPostedAt: Date | null = null;
  if (rawPostedAt !== "") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rawPostedAt)) {
      throw new Error("วันที่ลงคลิปไม่ถูกต้อง");
    }
    parsedPostedAt = new Date(`${rawPostedAt}T00:00:00.000Z`);
    if (Number.isNaN(parsedPostedAt.getTime())) {
      throw new Error("วันที่ลงคลิปไม่ถูกต้อง");
    }
  }

  const existing = await prisma.promptEntry.findUnique({ where: { id } });
  if (!existing) {
    throw new Error("ไม่พบรายการที่ต้องการบันทึก");
  }

  await prisma.promptEntry.update({
    where: { id },
    data: {
      chatgptOutput,
      caption,
      hashtags,
      videoUrl,
      postedAt: parsedPostedAt,
    },
  });

  revalidatePath(`/entry/${id}`);
  revalidatePath("/");
  revalidatePath("/dashboard");
}

const PROMPT_KINDS = ["core", "caption"] as const;
type PromptKind = (typeof PROMPT_KINDS)[number];

function isPromptKind(value: string): value is PromptKind {
  return PROMPT_KINDS.includes(value as PromptKind);
}

export async function createCorePrompt(formData: FormData) {
  const label = String(formData.get("label") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();
  const kind = String(formData.get("kind") ?? "core");

  // kind มาจาก client — เชื่อไม่ได้
  if (!isPromptKind(kind)) {
    throw new Error("ชนิด prompt ไม่ถูกต้อง");
  }
  if (!label || !content) {
    throw new Error("กรุณากรอกชื่อเวอร์ชันและเนื้อหา prompt");
  }

  await prisma.$transaction([
    // ปิด active เฉพาะ kind เดียวกัน — ห้ามไปปิดของอีกชนิด
    prisma.corePrompt.updateMany({
      where: { isActive: true, kind },
      data: { isActive: false },
    }),
    prisma.corePrompt.create({
      data: { label, content, kind, isActive: true },
    }),
  ]);

  revalidatePath("/core-prompt");
}

export async function setActiveCorePrompt(id: string) {
  const target = await prisma.corePrompt.findUnique({ where: { id } });
  if (!target) {
    throw new Error("ไม่พบเวอร์ชันที่ต้องการใช้");
  }

  await prisma.$transaction([
    prisma.corePrompt.updateMany({
      where: { isActive: true, kind: target.kind },
      data: { isActive: false },
    }),
    prisma.corePrompt.update({
      where: { id },
      data: { isActive: true },
    }),
  ]);

  revalidatePath("/core-prompt");
}

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export async function uploadProductImages(formData: FormData) {
  const entryId = String(formData.get("entryId") ?? "").trim();
  if (!entryId) {
    throw new Error("ไม่พบรายการที่ต้องการแนบรูป");
  }

  const entry = await prisma.promptEntry.findUnique({ where: { id: entryId } });
  if (!entry) {
    throw new Error("ไม่พบรายการที่ต้องการแนบรูป");
  }

  const rawFiles = formData.getAll("files");
  const rawCaptions = formData.getAll("captions").map((c) => String(c));
  const files: File[] = [];
  const captions: string[] = [];
  for (let i = 0; i < rawFiles.length; i++) {
    const value = rawFiles[i];
    if (value instanceof File && value.size > 0) {
      files.push(value);
      captions.push(rawCaptions[i] ?? "");
    }
  }
  if (files.length === 0) {
    throw new Error("กรุณาเลือกรูปอย่างน้อย 1 รูป");
  }

  for (const file of files) {
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      throw new Error("รองรับเฉพาะไฟล์ JPEG, PNG, WebP, HEIC");
    }
    if (file.size > MAX_IMAGE_BYTES) {
      throw new Error("ไฟล์ใหญ่เกิน 10MB");
    }
  }

  const existingCount = await prisma.productImage.count({ where: { entryId } });
  await mkdir(path.join(UPLOAD_ROOT, entryId), { recursive: true });

  for (const [index, file] of files.entries()) {
    const ext =
      file.type === "image/png"
        ? "png"
        : file.type === "image/webp"
          ? "webp"
          : file.type === "image/heic"
            ? "heic"
            : file.type === "image/heif"
              ? "heif"
              : "jpg";
    // A generated name, never the uploaded one — "../../evil.js" would escape UPLOAD_ROOT.
    const filename = `${crypto.randomUUID()}.${ext}`;

    await writeFile(
      joinPath(UPLOAD_ROOT, entryId, filename),
      Buffer.from(await file.arrayBuffer())
    );

    await prisma.productImage.create({
      data: {
        entryId,
        filename,
        mimeType: file.type,
        caption: (captions[index] ?? "").trim(),
        sortOrder: existingCount + index,
      },
    });
  }

  revalidatePath(`/entry/${entryId}`);
  revalidatePath("/");
}

export async function updateProductImageCaption(id: string, caption: string) {
  const image = await prisma.productImage.update({
    where: { id },
    data: { caption: caption.trim() },
  });
  revalidatePath(`/entry/${image.entryId}`);
}

/**
 * บันทึก angle ของคลิป — ต้องเป็น action แยกไม่ผ่าน form submit เพราะ generateWithAI
 * อ่านค่าจาก DB ไม่ใช่จากฟอร์ม (ถ้าเก็บใน form state โมเดลจะไม่เห็น angle เลย)
 * แนวเดียวกับ updateProductImageCaption ด้านบน
 */
export async function saveAngle(entryId: string, angle: string) {
  await prisma.promptEntry.update({
    where: { id: entryId },
    data: { angle: angle.trim() },
  });
  revalidatePath(`/entry/${entryId}`);
  revalidatePath("/");
}

/**
 * บันทึกสเปกสินค้าที่ผู้ใช้แก้เอง — ต้องเป็น action แยกไม่ผ่าน form submit เพราะ generateWithAI
 * อ่านค่าจาก DB ไม่ใช่จากฟอร์ม (ถ้าเก็บใน form state โมเดลจะไม่เห็นสเปกเลย)
 * แนวเดียวกับ saveAngle และ updateProductImageCaption
 */
/**
 * เปิด/ปิดโหมดปลอดภัย — action แยกเหมือน saveAngle เพราะ generateWithAI อ่านจาก DB ไม่ใช่ form state
 *
 * ใช้ตอนเรนเดอร์เพี้ยนซ้ำจนใกล้ต้องทิ้งสินค้า: เปิดแล้วพรอมต์จะสั่งให้สินค้าอยู่นิ่ง
 * ให้กล้องเป็นตัวเคลื่อน และห้ามมีคนในเฟรม ซึ่งตัดแหล่งความเพี้ยนที่ใหญ่ที่สุดออกทั้งหมด
 */
export async function saveSafeMode(entryId: string, safeMode: boolean) {
  await prisma.promptEntry.update({
    where: { id: entryId },
    data: { safeMode },
  });
  revalidatePath(`/entry/${entryId}`);
}

export async function saveProductSpec(entryId: string, spec: string) {
  await prisma.promptEntry.update({
    where: { id: entryId },
    data: { productSpec: spec.trim() },
  });
  revalidatePath(`/entry/${entryId}`);
}

/**
 * สกัดสเปกใหม่ทับของเดิม (ปุ่ม "สกัดสเปกใหม่" — ใช้ตอนเปลี่ยนรูปสินค้า)
 * เขียนทับเมื่อสำเร็จเท่านั้น: ถ้า API ล้ม สเปกเดิมที่ผู้ใช้อาจแก้มือไว้ต้องไม่หาย
 */
export async function refreshProductSpec(entryId: string, model: string): Promise<string> {
  // โมเดลมาจาก client เชื่อไม่ได้ ต้อง validate ก่อนส่งให้ API เสมอ
  if (!isGeminiModelId(model)) {
    throw new Error("โมเดลไม่ถูกต้อง");
  }

  const entry = await prisma.promptEntry.findUnique({
    where: { id: entryId },
    include: { productImages: { orderBy: { sortOrder: "asc" } } },
  });
  if (!entry) {
    throw new Error("ไม่พบรายการที่ต้องการสกัดสเปก");
  }
  if (entry.productImages.length === 0) {
    throw new Error("กรุณาแนบรูปสินค้าจริงอย่างน้อย 1 รูปก่อนสกัดสเปก");
  }

  const spec = await extractProductSpec({
    model,
    productName: entry.productName,
    productInfo: entry.productInfo,
    images: await loadGeminiImages(entry.productImages),
  });

  await prisma.promptEntry.update({
    where: { id: entryId },
    data: { productSpec: spec },
  });
  revalidatePath(`/entry/${entryId}`);
  return spec;
}

/**
 * ขอ angle ใหม่ 3 แบบจาก AI โดยให้เห็น angle ที่เคยใช้กับสินค้าเดียวกัน (สายเลือดการทำซ้ำ)
 * ไม่ revalidatePath — action นี้ไม่แตะข้อมูลใดๆ (แนวเดียวกับ extractProductInfo)
 */
export async function suggestAngles(entryId: string): Promise<AngleSuggestion[]> {
  const entries = await prisma.promptEntry.findMany({
    select: {
      id: true,
      duplicatedFromId: true,
      angle: true,
      videoUrl: true,
      postedAt: true,
      chatgptOutput: true,
      productName: true,
      productInfo: true,
      productSpec: true,
    },
  });

  const current = entries.find((e) => e.id === entryId);
  if (!current) {
    throw new Error("ไม่พบรายการที่ต้องการคิด angle");
  }

  const family = collectFamily(entries, entryId);
  const used = collectUsedAngles(family, entryId);

  const raw = await suggestAngleOptions({
    productName: current.productName,
    productInfo: current.productInfo,
    productSpec: current.productSpec,
    usedAngles: used.map((u) => u.text),
  });
  return parseAngleSuggestions(raw);
}

/**
 * สกัดชื่อสินค้า+รายละเอียดจากแคปหน้าสินค้า TikTok Shop — รูปเป็นของใช้แล้วทิ้ง:
 * อยู่แค่ใน memory ไม่เขียนดิสก์ ไม่สร้างแถว DB (คนละชุดกับรูปสินค้าจริงใน ProductImage)
 */
export async function extractProductInfo(
  formData: FormData
): Promise<{ productName: string; productInfo: string }> {
  const rawFiles = formData.getAll("files");
  const files: File[] = [];
  for (const value of rawFiles) {
    if (value instanceof File && value.size > 0) files.push(value);
  }
  if (files.length === 0) {
    throw new Error("กรุณาแนบแคปหน้าสินค้าอย่างน้อย 1 รูป");
  }

  for (const file of files) {
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      throw new Error("รองรับเฉพาะไฟล์ JPEG, PNG, WebP, HEIC");
    }
    if (file.size > MAX_IMAGE_BYTES) {
      throw new Error("ไฟล์ใหญ่เกิน 10MB");
    }
  }

  const images = await Promise.all(
    files.map(async (file) => ({
      base64: Buffer.from(await file.arrayBuffer()).toString("base64"),
      mimeType: file.type,
      caption: "",
    }))
  );

  const raw = await extractProductFields({ images });
  // ไม่ revalidatePath — action นี้ไม่แตะข้อมูลใดๆ
  return parseExtractOutput(raw);
}

/** อ่านไฟล์รูปจากดิสก์เป็น base64 ให้พร้อมส่ง Gemini — ใช้ร่วมกันระหว่างสกัดสเปกกับเจน 10 ส่วน */
async function loadGeminiImages(
  images: { entryId: string; filename: string; mimeType: string; caption: string }[]
) {
  return Promise.all(
    images.map(async (image) => ({
      base64: (
        await readFile(path.join(UPLOAD_ROOT, image.entryId, image.filename))
      ).toString("base64"),
      mimeType: image.mimeType,
      caption: image.caption,
    }))
  );
}

export async function generateWithAI(
  entryId: string,
  model: string
): Promise<{ captionError: string | null }> {
  // The model string arrives from the client — never hand it to the API unchecked.
  if (!isGeminiModelId(model)) {
    throw new Error("โมเดลไม่ถูกต้อง");
  }

  const entry = await prisma.promptEntry.findUnique({
    where: { id: entryId },
    include: { productImages: { orderBy: { sortOrder: "asc" } } },
  });
  if (!entry) {
    throw new Error("ไม่พบรายการที่ต้องการสร้าง");
  }
  if (entry.productImages.length === 0) {
    throw new Error("กรุณาแนบรูปสินค้าจริงอย่างน้อย 1 รูปก่อนสร้างด้วย AI");
  }

  const core = await prisma.corePrompt.findFirst({ where: { isActive: true, kind: "core" } });
  if (!core) {
    throw new Error("ยังไม่ได้ตั้ง Core Prompt ที่ใช้งานอยู่");
  }

  // ขั้นที่ 0: สกัดสเปกสินค้าถ้ายังไม่มี แล้วบันทึกไว้ใช้ซ้ำ
  // ห้ามทับของเดิม — ผู้ใช้อาจแก้สเปกด้วยมือไว้ การเจนซ้ำต้องไม่ลบการแก้นั้นทิ้ง
  // พังตรงนี้ให้ throw ได้เลย ยังไม่มีอะไรถูกบันทึก ผู้ใช้กดใหม่ได้โดยไม่เสียของ
  // (ต่างจากขั้น caption ที่ห้าม throw เพราะ 10-part บันทึกไปแล้ว)
  let productSpec = entry.productSpec;
  if (productSpec.trim() === "") {
    productSpec = await extractProductSpec({
      model,
      productName: entry.productName,
      productInfo: entry.productInfo,
      images: await loadGeminiImages(entry.productImages),
    });
    await prisma.promptEntry.update({
      where: { id: entryId },
      data: { productSpec },
    });
  }
  const photos = entry.productImages; // เรียง sortOrder แล้วจาก include ด้านบน
  const brief = buildPromptText({
    productName: entry.productName,
    productInfo: entry.productInfo,
    riskModule: entry.riskModule,
    extraNotes: entry.extraNotes,
    imageCaptions: photos.map((p) => p.caption),
    angle: entry.angle,
    productSpec,
    safeMode: entry.safeMode,
  });

  const geminiImages = await loadGeminiImages(photos);

  const output = await generateTenPartPrompt({
    model,
    systemInstruction: core.content,
    examples: await getFewShotExamples(entryId),
    brief,
    images: geminiImages,
  });

  // บันทึกผลของ stage 1 ให้เสร็จก่อนเสมอ — ถ้า stage 2 พัง 10-part prompt ต้องไม่หายไปด้วย
  await prisma.promptEntry.update({
    where: { id: entryId },
    data: { chatgptOutput: output },
  });

  // มีงาน Flow รอพรอมต์อยู่ (เพิ่งเลือกรูปรอบ 2) → ส่งให้บอท Render คลิปต่อทันที — พรอมต์บันทึกแล้วจริง
  // จึงทำตรงนี้ ไม่รอขั้น caption · ครอบกรณีที่ผู้ใช้มากด "สร้างด้วย AI" เองทีหลังด้วย (ถ้าตัวอัตโนมัติพัง)
  // งานที่ Render ไปแล้ว (review_r3/done) ไม่ถูกแตะ — เรนเดอร์ใหม่ต้องกดเองที่หน้าคิว Flow
  const renderQueued = await applyBulk(promptReady(), { entryId });
  if (renderQueued > 0) revalidatePath("/flow");

  let captionError: string | null = null;

  const seoPrompt = await prisma.corePrompt.findFirst({
    where: { isActive: true, kind: "caption" },
  });

  if (!seoPrompt) {
    captionError = "ยังไม่ได้ตั้ง SEO Prompt ที่ใช้งานอยู่";
  } else {
    try {
      const parsed = parseCaptionOutput(
        await generateCaptionAndHashtags({
          systemInstruction: seoPrompt.content,
          tenPartPrompt: output,
        })
      );
      await prisma.promptEntry.update({
        where: { id: entryId },
        data: { caption: parsed.caption, hashtags: parsed.hashtags },
      });
    } catch (e) {
      captionError = e instanceof Error ? e.message : "สร้าง Caption ไม่สำเร็จ";
    }
  }

  revalidatePath(`/entry/${entryId}`);
  revalidatePath("/");
  return { captionError };
}

/** sha256 ของไฟล์ดิบ — ใช้ตรวจว่าผู้ใช้เลือกไฟล์เดิมซ้ำ */
function hashFile(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * บันทึกว่าอัปไฟล์อะไรไปเมื่อไร — เรียก**หลัง** import สำเร็จเท่านั้น
 * ไฟล์ที่ parse ไม่ผ่านต้องไม่ถูกบันทึกว่าอัปแล้ว ไม่งั้นแผงสถานะจะโกหก
 */
async function writeImportLog(args: {
  kind: ImportKind;
  fileHash: string;
  rowCount: number;
  summary: string;
}) {
  await prisma.importLog.create({ data: args });
}

/** "2 ส.ค." — สำหรับ Date ที่เป็น timestamp จริง (orderDate, uploadedAt) */
function shortLocal(d: Date): string {
  return d.toLocaleDateString("th-TH", { day: "numeric", month: "short" });
}

/** "2 ส.ค." — สำหรับ Date ที่เก็บเป็น UTC midnight (statsOn, postedAt) */
function shortUtc(d: Date): string {
  return d.toLocaleDateString("th-TH", { day: "numeric", month: "short", timeZone: "UTC" });
}

export type AffiliateImportSummary = {
  total: number;
  matched: number;
  unmatched: number;
  unmatchedProducts: { contentId: string; productName: string; orders: number }[];
};

export async function importAffiliateOrders(
  formData: FormData
): Promise<AffiliateImportSummary> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("กรุณาเลือกไฟล์ affiliate orders (.xlsx)");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let orders;
  try {
    orders = parseAffiliateXlsx(buffer);
  } catch {
    throw new Error("อ่านไฟล์ไม่สำเร็จ — ต้องเป็นไฟล์ affiliate orders (.xlsx) จาก TikTok Studio");
  }
  if (orders.length === 0) {
    throw new Error("ไม่พบออเดอร์ในไฟล์");
  }

  // สร้าง map video id -> entry id จาก videoUrl ที่เก็บไว้
  const entries = await prisma.promptEntry.findMany({
    select: { id: true, videoUrl: true },
  });
  const videoToEntry = new Map<string, string>();
  for (const e of entries) {
    const vid = videoIdFromUrl(e.videoUrl);
    if (vid) videoToEntry.set(vid, e.id);
  }

  // upsert กันซ้ำด้วย orderId — โยนไฟล์ทับได้ อัปเดตสถานะ/ยอดให้ด้วย
  for (const o of orders) {
    const matchedEntryId = videoToEntry.get(o.contentId) ?? null;
    await prisma.affiliateOrder.upsert({
      where: { orderId: o.orderId },
      create: { ...o, matchedEntryId },
      update: {
        productName: o.productName,
        status: o.status,
        gmv: o.gmv,
        itemsSold: o.itemsSold,
        itemsRefunded: o.itemsRefunded,
        actualCommission: o.actualCommission,
        finalRevenue: o.finalRevenue,
        matchedEntryId,
        importedAt: new Date(),
      },
    });
  }

  const matched = orders.filter((o) => videoToEntry.has(o.contentId)).length;
  const unmatchedMap = new Map<
    string,
    { contentId: string; productName: string; orders: number }
  >();
  for (const o of orders) {
    if (videoToEntry.has(o.contentId)) continue;
    const ex = unmatchedMap.get(o.contentId);
    if (ex) ex.orders++;
    else
      unmatchedMap.set(o.contentId, {
        contentId: o.contentId,
        productName: o.productName,
        orders: 1,
      });
  }

  const orderTimes = orders.map((o) => o.orderDate.getTime());
  await writeImportLog({
    kind: "orders",
    fileHash: hashFile(buffer),
    rowCount: orders.length,
    summary:
      `${orders.length} ออเดอร์ · ` +
      `${shortLocal(new Date(Math.min(...orderTimes)))}–${shortLocal(new Date(Math.max(...orderTimes)))}`,
  });

  revalidatePath("/dashboard");
  return {
    total: orders.length,
    matched,
    unmatched: orders.length - matched,
    unmatchedProducts: [...unmatchedMap.values()].sort((a, b) => b.orders - a.orders),
  };
}

export type ClipMetricImportSummary = {
  /** จำนวนไฟล์ที่นำเข้าสำเร็จ */
  files: number;
  total: number;
  matched: number;
  unmatched: number;
  /** ลายเซ็นของไฟล์ที่ hash ตรงกับที่เคยอัปแล้ว — เตือนอย่างเดียว ไม่บล็อก */
  duplicates: string[];
  /**
   * จำนวนไฟล์ที่อ่านไม่ผ่าน — ไฟล์ที่เหลือยังทำงานต่อ
   * เป็นจำนวนไม่ใช่ชื่อไฟล์ เพราะ TikTok ตั้งชื่อ Content.csv เหมือนกันทุกไฟล์
   * (นี่คือเหตุผลทั้งหมดที่ฟีเจอร์หลายไฟล์นี้ต้องมี) ใส่ชื่อไฟล์ซ้ำกันไปก็แยกไม่ออกว่าไฟล์ไหน
   */
  failed: number;
};

/**
 * นำเข้า Content.csv 1 ไฟล์ — เนื้อในเดิมของ importClipMetrics ที่แยกออกมาเพื่อวนเรียกหลายไฟล์
 *
 * คืน null เมื่อไฟล์อ่านไม่ผ่าน เพื่อให้ผู้เรียกข้ามเฉพาะไฟล์นั้นแล้วทำไฟล์ที่เหลือต่อได้
 * (export จาก TikTok พลาดทีละไฟล์ได้ ไม่ควรทำให้ทั้งชุดล้ม)
 */
async function importOneContentFile(
  buffer: Buffer,
  importedAt: Date
): Promise<{ total: number; matched: number; summary: string } | null> {
  let metrics;
  try {
    metrics = parseContentCsv(buffer.toString("utf8"), importedAt);
  } catch {
    return null;
  }
  if (metrics.length === 0) return null;

  const entries = await prisma.promptEntry.findMany({
    select: { id: true, videoUrl: true },
  });
  const videoToEntry = new Map<string, string>();
  for (const e of entries) {
    const vid = videoIdFromUrl(e.videoUrl);
    if (vid) videoToEntry.set(vid, e.id);
  }

  // upsert ด้วย (videoId, capturedOn) — โยนไฟล์เดิมซ้ำได้ ไม่เกิด snapshot ซ้ำ
  //
  // matchedEntryId ถูก set ที่นี่ที่เดียว ไม่มีที่อื่นแตะ ClipMetric.matchedEntryId เลย
  for (const m of metrics) {
    const matchedEntryId = videoToEntry.get(m.videoId) ?? null;
    await prisma.clipMetric.upsert({
      where: { videoId_capturedOn: { videoId: m.videoId, capturedOn: m.capturedOn } },
      create: { ...m, matchedEntryId },
      update: {
        title: m.title,
        postedDate: m.postedDate,
        views: m.views,
        likes: m.likes,
        comments: m.comments,
        shares: m.shares,
        matchedEntryId,
        importedAt: new Date(),
      },
    });
  }

  // ลายเซ็นให้ผู้ใช้แยกออกว่าไฟล์ไหนคือช่วงไหน โดยไม่ต้องเปลี่ยนชื่อไฟล์
  // ใช้ "คลิปเก่าสุดที่โพสต์" เพราะวัดจากไฟล์จริงแล้วแยกช่วง 7/28/60 วันออกจากกันได้
  // (1 ก.ค. / 19 มิ.ย. / 28 พ.ค.) — แต่ **ไม่เดาชื่อช่วงให้** เพราะแยก 60 กับ 365 ไม่ออก
  const postedTimes = metrics
    .map((m) => parseMonthDayLabel(m.postedDate, importedAt))
    .filter((d): d is Date => d !== null)
    .map((d) => d.getTime());
  const oldest = postedTimes.length > 0 ? ` · เก่าสุด ${shortUtc(new Date(Math.min(...postedTimes)))}` : "";

  const matched = metrics.filter((m) => videoToEntry.has(m.videoId)).length;
  return {
    total: metrics.length,
    matched,
    summary: `${metrics.length} คลิป${oldest}`,
  };
}

export async function importClipMetrics(
  formData: FormData
): Promise<ClipMetricImportSummary> {
  const picked = formData.getAll("files").filter(
    (f): f is File => f instanceof File && f.size > 0
  );
  if (picked.length === 0) {
    throw new Error("กรุณาเลือกไฟล์ Content (.csv) อย่างน้อย 1 ไฟล์");
  }

  const importedAt = new Date();
  let files = 0;
  let total = 0;
  let matched = 0;
  const duplicates: string[] = [];
  let failed = 0;

  for (const f of picked) {
    const buffer = Buffer.from(await f.arrayBuffer());
    const result = await importOneContentFile(buffer, importedAt);
    if (!result) {
      failed++;
      continue;
    }

    const fileHash = hashFile(buffer);
    const seen = await prisma.importLog.findFirst({ where: { fileHash, kind: "clips" } });
    if (seen) duplicates.push(result.summary);

    await writeImportLog({
      kind: "clips",
      fileHash,
      rowCount: result.total,
      summary: result.summary,
    });

    files++;
    total += result.total;
    matched += result.matched;
  }

  if (files === 0) {
    throw new Error("อ่านไฟล์ไม่สำเร็จ — ต้องเป็นไฟล์ Content (.csv) จาก TikTok Studio");
  }

  revalidatePath("/dashboard");
  return { files, total, matched, unmatched: total - matched, duplicates, failed };
}


export async function deleteProductImage(id: string) {
  const image = await prisma.productImage.findUnique({ where: { id } });
  if (!image) return;

  await prisma.productImage.delete({ where: { id } });

  // The row is the source of truth; a file that is already gone must not fail the delete.
  try {
    await unlink(path.join(UPLOAD_ROOT, image.entryId, image.filename));
  } catch {
    // nothing to remove
  }

  revalidatePath(`/entry/${image.entryId}`);
  revalidatePath("/");
}

/**
 * หา thumbnail ของคลิปจาก content id — อ่าน cache ก่อน ถ้าไม่มีค่อยยิง oEmbed แล้ว cache
 * เก็บผลแม้ล้มเหลว (ok=false) เพื่อไม่ยิงซ้ำถี่ๆ
 */
export async function resolveThumbnail(
  contentId: string,
  videoUrl?: string
): Promise<{ thumbnailUrl: string | null }> {
  const cached = await prisma.videoThumbnail.findUnique({ where: { contentId } });
  if (cached) return { thumbnailUrl: cached.thumbnailUrl };

  // หา URL: ถ้ามี videoUrl (คลิปที่จับคู่แล้ว) ใช้ตรงๆ; ถ้าไม่มี ประกอบจาก handle ของ entry ใดก็ได้
  let url = videoUrl && videoUrl.trim() !== "" ? videoUrl : undefined;
  if (!url) {
    const anyEntry = await prisma.promptEntry.findFirst({
      where: { videoUrl: { not: "" } },
      select: { videoUrl: true },
    });
    const handle = anyEntry ? handleFromUrl(anyEntry.videoUrl) : null;
    if (handle) url = buildVideoUrl(contentId, handle);
  }

  if (!url) {
    await prisma.videoThumbnail.create({
      data: { contentId, thumbnailUrl: null, title: null, ok: false },
    });
    return { thumbnailUrl: null };
  }

  const r = await fetchOembedThumbnail(url);
  await prisma.videoThumbnail.upsert({
    where: { contentId },
    create: { contentId, thumbnailUrl: r.thumbnailUrl, title: r.title, ok: r.ok },
    update: {
      thumbnailUrl: r.thumbnailUrl,
      title: r.title,
      ok: r.ok,
      fetchedAt: new Date(),
    },
  });
  return { thumbnailUrl: r.thumbnailUrl };
}

/**
 * สร้าง entry ขั้นต่ำจากออเดอร์ที่ขายได้แต่ยังไม่มีในแอป แล้วผูกออเดอร์ที่มี content id เดียวกันให้เลย
 * (ปิด loop reconciliation ทันที ไม่ต้องรอ import รอบใหม่)
 */
export async function createEntryFromOrder(contentId: string, productName: string) {
  const name = productName.trim() || "สินค้าจากออเดอร์";
  const anyEntry = await prisma.promptEntry.findFirst({
    where: { videoUrl: { not: "" } },
    select: { videoUrl: true },
  });
  const handle = anyEntry ? handleFromUrl(anyEntry.videoUrl) : null;
  const videoUrl = handle ? buildVideoUrl(contentId, handle) : "";

  const active = await prisma.corePrompt.findFirst({
    where: { isActive: true, kind: "core" },
  });

  const created = await prisma.promptEntry.create({
    data: {
      productName: name,
      productInfo: "",
      riskModule: "",
      extraNotes: "",
      images: "[]",
      corePromptId: active?.id ?? null,
      videoUrl,
    },
  });

  await prisma.affiliateOrder.updateMany({
    where: { contentId },
    data: { matchedEntryId: created.id },
  });

  revalidatePath("/");
  revalidatePath("/dashboard");
}

/**
 * อ่านแคปหน้าจัดอันดับสินค้า แล้ว upsert ลง ProductCandidate
 *
 * รูปอยู่ใน memory เท่านั้น ไม่เขียนดิสก์ ไม่สร้างแถว ProductImage — เป็นแคปหน้าจัดอันดับ
 * คนละชุดกับรูปสินค้าจริง ปนกันแล้ว 10-part prompt จะเพี้ยน
 */
export async function extractCandidates(
  formData: FormData
): Promise<{ batchId: string; added: number; skipped: number }> {
  const rawFiles = formData.getAll("files");
  const files: File[] = [];
  for (const value of rawFiles) {
    if (value instanceof File && value.size > 0) files.push(value);
  }
  if (files.length === 0) {
    throw new Error("กรุณาแนบแคปหน้าจัดอันดับสินค้าอย่างน้อย 1 รูป");
  }

  for (const file of files) {
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      throw new Error("รองรับเฉพาะไฟล์ JPEG, PNG, WebP, HEIC");
    }
    if (file.size > MAX_IMAGE_BYTES) {
      throw new Error("ไฟล์ใหญ่เกิน 10MB");
    }
  }

  const images = await Promise.all(
    files.map(async (file) => ({
      base64: Buffer.from(await file.arrayBuffer()).toString("base64"),
      mimeType: file.type,
      caption: "",
    }))
  );

  const raw = await extractCandidateRows({ images });
  const { rows, skipped } = parseCandidateRows(raw);

  // ต้องเช็คก่อนสร้างชุด ไม่งั้นจะเหลือชุดเปล่าค้างในรายการให้ผู้ใช้มางงว่าคืออะไร
  if (rows.length === 0) {
    throw new Error("อ่านข้อมูลจากรูปไม่ได้เลยสักแถว ลองแคปใหม่ให้เห็นตัวเลขชัดขึ้น");
  }

  const capturedOn = new Date();

  // สร้างชุด + upsert ทุกแถวในทรานแซกชันเดียว — ก่อนหน้านี้ไม่มีทรานแซกชันคลุม ถ้า DB ล้ม
  // กลางลูป (เช่น แถวที่ 20 จาก 40) จะเหลือ "ชุดครึ่งๆ กลางๆ" ค้างอยู่จริงในตาราง ซึ่งมี
  // capturedOn ใหม่กว่าชุดเดิมจึงถูกนับเป็น "ชุดล่าสุด" ทันทีและบังชุดที่ครบถ้วนกว่าไปเงียบๆ
  // ทั้งที่ผู้ใช้เห็นแค่ error banner ซึ่งอ่านได้ว่า "ไม่มีอะไรถูกบันทึกเลย" ห่อด้วย
  // $transaction แบบ callback (ไม่ใช่ array แบบจุดอื่นในไฟล์นี้) เพราะจำนวนแถว/เนื้อหาแต่ละ
  // แถวรู้ได้ตอนรันไทม์เท่านั้น (ผลจาก parseCandidateRows) และต้องใช้ batch.id ที่เพิ่งสร้าง
  // ในทุก upsert ถัดไป ล้มตรงไหนก็ rollback ทั้งก้อน ไม่เหลือชุดเปล่าหรือชุดครึ่งๆ กลางๆ ค้าง
  const seenKeys = new Set<string>();
  const batch = await prisma.$transaction(async (tx) => {
    const created = await tx.candidateBatch.create({ data: { capturedOn } });

    // ชุดใหม่ไม่แตะชุดเก่าเลย — สินค้าชื่อเดิมอยู่คนละชุดได้ แต่ในชุดเดียวกันยังกันซ้ำอยู่
    // เพราะแคปแบบเลื่อนจอมักมีสินค้าซ้ำตรงรอยต่อระหว่างภาพ
    for (const row of rows) {
      const nameKey = normalizeName(row.name);
      await tx.productCandidate.upsert({
        where: { batchId_nameKey: { batchId: created.id, nameKey } },
        create: {
          batchId: created.id,
          name: row.name,
          nameKey,
          price: row.price,
          commission: row.commission,
          weeklySales: row.weeklySales,
          categoryLabel: row.categoryLabel,
          capturedOn,
        },
        update: {
          name: row.name,
          price: row.price,
          commission: row.commission,
          weeklySales: row.weeklySales,
          categoryLabel: row.categoryLabel,
        },
      });
      seenKeys.add(nameKey);
    }

    return created;
  });

  revalidatePath("/products");
  return { batchId: batch.id, added: seenKeys.size, skipped };
}

/**
 * ลบทั้งชุด — แถวในชุดหายตามด้วย FK cascade
 *
 * ตัว PromptEntry ที่เคยสร้างจากแถวในชุดนี้ไม่ถูกลบ (ไม่มี relation ผูกกัน linkedEntryId
 * เป็น String เปล่าโดยตั้งใจ) ลบชุดจึงเสียแค่ "ลิงก์" ไม่ใช่ตัวงาน
 */
export async function deleteCandidateBatch(batchId: string): Promise<void> {
  await prisma.candidateBatch.delete({ where: { id: batchId } });
  revalidatePath("/products");
}

/**
 * ชื่อสินค้าที่จะใช้สร้าง entry จากชื่อร้าน (Showcase/หาสินค้า) — ย่อด้วย Gemini ให้เหลือ 2–5 คำ เหมือนเส้นทางแคปเอง
 * เพราะบอทพิมพ์ productName ลงพรอมต์วาดรูปของ Flow ทันที ชื่อ SEO ยาวที่มีคุณสมบัติทำให้รูปมีตัวหนังสือ (เจอจริง 2026-10-02)
 * ชื่อเต็มเก็บไว้ใน productInfo ให้ 10-part prompt ยังเห็นข้อมูลครบ · ล้มเหลวทุกแบบ (รวมเกิน SHORT_NAME_TIMEOUT_MS) = ใช้ชื่อเต็มเหมือนเดิม
 * ห้ามทำให้สร้างงานพัง · ผู้เรียกที่มีเช็กกันสร้างซ้ำต้องเรียกก่อนเช็กนั้น (ดู startShowcaseProduct)
 */
async function shortNameForEntry(fullTitle: string): Promise<{ productName: string; productInfo: string }> {
  let name = fullTitle;
  try {
    name = acceptShortName(await withTimeout(shortenProductName(fullTitle), SHORT_NAME_TIMEOUT_MS, "ย่อชื่อสินค้า"), fullTitle);
  } catch (e) {
    console.error("ย่อชื่อสินค้าไม่สำเร็จ ใช้ชื่อเต็ม:", e instanceof Error ? e.message : e);
  }
  return { productName: name, productInfo: name === fullTitle ? "" : `${FULL_TITLE_PREFIX}${fullTitle}` };
}

/**
 * สร้าง PromptEntry จากสินค้าที่เลือก แล้วผูกกลับมาที่ candidate
 * ทำตามแบบ createEntryFromOrder — สร้าง entry ขั้นต่ำแล้วให้ผู้ใช้ไปกรอกต่อในหน้า entry
 */
export async function createEntryFromCandidate(id: string): Promise<string> {
  const candidate = await prisma.productCandidate.findUnique({ where: { id } });
  if (!candidate) {
    throw new Error("ไม่พบสินค้าที่เลือก");
  }

  // ต้องใส่ kind: "core" เสมอ ไม่งั้นได้ SEO prompt มาแทน
  const active = await prisma.corePrompt.findFirst({
    where: { isActive: true, kind: "core" },
  });

  const created = await prisma.promptEntry.create({
    data: {
      ...(await shortNameForEntry(candidate.name)),
      riskModule: "",
      extraNotes: "",
      images: "[]",
      corePromptId: active?.id ?? null,
    },
  });

  await prisma.productCandidate.update({
    where: { id },
    data: { linkedEntryId: created.id },
  });

  revalidatePath("/products");
  // หน้า Showcase ใช้ทางนี้ด้วยกับสินค้าที่โหลดรูปของร้านไม่ได้สักรูป (ไม่มีอะไรให้เลือก/ครอป)
  revalidatePath("/showcase");
  revalidatePath("/");
  return created.id;
}

/**
 * หน้า Showcase: "ทำคลิปตัวนี้" — รับรูปต้นทาง 1 รูป (รูปของร้านที่ผู้ใช้เลือก ครอปแล้วหรือไม่ก็ได้ ครอปทำ
 * ในเบราว์เซอร์แล้วส่งมาเป็นไฟล์) → สร้าง Entry → เข้าคิว Flow ในกดเดียว
 *
 * รับเป็นไฟล์ ไม่ใช่ id ของ CandidateImage เพราะรูปที่ครอปแล้วไม่มีอยู่บนดิสก์ — รูปต้นฉบับของร้านใน
 * uploads/_candidates/ ไม่ถูกแก้ ผู้ใช้เลือก/ครอปใหม่ได้เสมอ
 */
export async function startShowcaseProduct(
  formData: FormData
): Promise<{ entryId: string; flowEnqueueError: string | null }> {
  const candidateId = String(formData.get("candidateId") ?? "");
  const photo = formData.get("photo");
  if (!(photo instanceof File) || photo.size === 0) throw new Error("กรุณาเลือกรูป 1 รูป");

  const candidate = await prisma.productCandidate.findUnique({ where: { id: candidateId } });
  if (!candidate || candidate.sourceProductId === null) throw new Error("ไม่พบสินค้าที่เลือก");
  // ย่อชื่อ (เรียก Gemini สูงสุด SHORT_NAME_TIMEOUT_MS) ก่อนเช็กกันซ้ำ — ช่วงระหว่าง guard กับ create ต้องสั้นที่สุด
  // ไม่งั้นกดซ้ำ/สองแท็บระหว่างรอ Gemini จะผ่าน guard ทั้งคู่แล้วได้งานซ้ำ
  const naming = await shortNameForEntry(candidate.name);
  // กดซ้ำ/เปิดสองแท็บ — ห้ามสร้างงานซ้ำให้สินค้าตัวเดียว
  if (candidate.linkedEntryId !== null) {
    const existing = await prisma.promptEntry.findUnique({ where: { id: candidate.linkedEntryId }, select: { id: true } });
    if (existing) throw new Error("สินค้าตัวนี้เริ่มทำไปแล้ว");
  }

  const active = await prisma.corePrompt.findFirst({ where: { isActive: true, kind: "core" } });

  const created = await prisma.promptEntry.create({
    data: {
      ...naming,
      riskModule: "",
      extraNotes: "",
      images: "[]",
      corePromptId: active?.id ?? null,
    },
  });

  await prisma.productCandidate.update({
    where: { id: candidateId },
    data: { linkedEntryId: created.id },
  });

  // เข้าคิว Flow — entry ต้องถูกสร้างสำเร็จไปแล้วเสมอไม่ว่าขั้นนี้จะพังหรือไม่ (เช่น enqueueFlowJobCore
  // validate ไม่ผ่านเพราะไฟล์ใหญ่เกิน 10MB หรือชนิดไฟล์ไม่รองรับ) — ผู้ใช้
  // ไปอัปโหลดรูปเองที่หน้า entry ได้ตามปกติเสมอ entry ที่สร้างไปแล้วไม่หาย แต่ต้องคืน error
  // กลับไปให้ผู้เรียกโชว์ใน UI ด้วย ไม่ใช่แค่ console.error เงียบๆ (ผู้ใช้เคยไม่มีทางรู้เลยว่า
  // งาน Flow ไม่ได้ถูกสร้างจนกว่าจะบังเอิญสังเกตเห็นทีหลัง)
  let flowEnqueueError: string | null = null;
  try {
    await enqueueFlowJobCore(
      created.id,
      [{ buffer: Buffer.from(await photo.arrayBuffer()), mimeType: photo.type }],
      String(formData.get("extraPrompt") ?? "")
    );
  } catch (err) {
    flowEnqueueError = err instanceof Error ? err.message : "เข้าคิว Flow อัตโนมัติไม่สำเร็จ";
    console.error("เข้าคิว Flow อัตโนมัติไม่สำเร็จ ผู้ใช้ต้องอัปโหลดรูปเองที่หน้า entry:", err);
  }

  revalidatePath("/showcase");
  revalidatePath("/");
  return { entryId: created.id, flowEnqueueError };
}

/**
 * หน้า Showcase แท็บ "กำลังทำ": "เลือกรูปใหม่" — ใช้ Entry เดิม ส่งรูปต้นทางใหม่เข้าคิว Flow
 * ใช้ได้เฉพาะเมื่องานล่าสุด Flow วาดไม่สำเร็จเอง (flow_error) / ถูกข้าม / ยังไม่มีงาน — ตรวจซ้ำฝั่ง server ด้วย
 * showcaseFlowState เพราะ client อาจค้างหน้าเก่า · งานที่พังค้างอยู่ถูกเปลี่ยนเป็น "ข้าม" และปลดการหยุดของ
 * worker เหมือนปุ่ม "ข้ามงานนี้" (ผู้ใช้เลือกแทนงานนั้นแล้ว) · **captcha ไม่เข้าเงื่อนไขโดยตั้งใจ** ดู showcaseFlowState
 */
export async function retryShowcasePhoto(formData: FormData): Promise<{ entryId: string }> {
  const candidateId = String(formData.get("candidateId") ?? "");
  const photo = formData.get("photo");
  if (!(photo instanceof File) || photo.size === 0) throw new Error("กรุณาเลือกรูป 1 รูป");

  const candidate = await prisma.productCandidate.findUnique({ where: { id: candidateId } });
  if (!candidate || candidate.sourceProductId === null || candidate.linkedEntryId === null) {
    throw new Error("ไม่พบงานของสินค้านี้");
  }
  const entryId = candidate.linkedEntryId;
  const latest = await prisma.flowJob.findFirst({ where: { entryId }, orderBy: { createdAt: "desc" } });
  const state = showcaseFlowState(
    latest === null ? null : { status: latest.status, errorKind: latest.errorKind, round: latest.round }
  );
  if (state === "blocked") throw new Error("งาน Flow ของสินค้านี้หยุดด้วยเหตุผลอื่น — ไปจัดการที่หน้า คิว Flow ก่อน");
  if (state === "busy") throw new Error("งาน Flow ของสินค้านี้ยังทำงานอยู่ หรือเสร็จแล้ว");

  if (latest !== null && latest.status === FLOW_STATUS.FAILED) await skipFlowJob(latest.id);
  await enqueueFlowJobCore(
    entryId,
    [{ buffer: Buffer.from(await photo.arrayBuffer()), mimeType: photo.type }],
    String(formData.get("extraPrompt") ?? "")
  );
  revalidatePath("/showcase");
  return { entryId };
}

/**
 * หน้า Showcase: "ไม่ทำแล้ว" / "กู้คืน" — เซ็ตทุกแถวของ sourceProductId เดียวกันพร้อมกัน เพราะสินค้าตัวเดียว
 * อยู่ได้หลายชุด (ดู buildShowcaseItems) ถ้าเซ็ตแถวเดียว กู้คืนแล้วแถวอื่นที่ยังเซ็ตไว้จะดึงกลับไปเป็น "ไม่ทำแล้ว"
 */
export async function setShowcaseDismissed(candidateId: string, dismissed: boolean): Promise<void> {
  const candidate = await prisma.productCandidate.findUnique({
    where: { id: candidateId },
    select: { sourceProductId: true },
  });
  if (!candidate || candidate.sourceProductId === null) throw new Error("ไม่พบสินค้าที่เลือก");
  await prisma.productCandidate.updateMany({
    where: { sourceProductId: candidate.sourceProductId },
    data: { dismissedAt: dismissed ? new Date() : null },
  });
  revalidatePath("/showcase");
}


/**
 * นำเข้า Showcase JSON (จาก extension ภายนอก หรือไฟล์ที่อัปโหลดมือ) → CandidateBatch ใหม่
 *
 * ต่างจาก extractCandidates (แคปหน้าจัดอันดับ) ตรงที่มี Product ID จริงให้ dedupe และมีรูปสินค้า
 * จริงติดมาด้วย — โหลดรูปลงดิสก์ทันทีในฟังก์ชันนี้เพราะ URL ในไฟล์ JSON หมดอายุได้ (ดูสเปก)
 *
 * โหลดรูปบางรูปไม่สำเร็จ = ข้ามเฉพาะรูปนั้น ไม่ทำทั้ง candidate fail (ดูสเปกหัวข้อ error handling)
 */
export async function importShowcaseBatch(
  payload: unknown
): Promise<{ batchId: string; added: number; skipped: number; imagesFailed: number }> {
  const { rows, skipped } = parseShowcasePayload(payload);
  if (rows.length === 0) {
    throw new Error("ไม่มีสินค้าที่นำเข้าได้เลยสักรายการในไฟล์นี้");
  }

  const capturedOn = new Date();
  let imagesFailed = 0;

  // สร้างชุด + candidate ทุกแถวในทรานแซกชันเดียวก่อน (เหมือน extractCandidates) — การโหลดรูป
  // (I/O ช้า, ไม่ transactional) ทำแยกหลัง transaction commit แล้ว เพื่อไม่ให้ธุรกรรม DB ค้าง
  // รอ network นานเกินไป — ถ้าโหลดรูปพังกลางทาง candidate ที่สร้างไปแล้วยังอยู่ครบ แค่ไม่มีรูป
  let batch;
  try {
    batch = await prisma.$transaction(async (tx) => {
      const created = await tx.candidateBatch.create({ data: { capturedOn } });
      for (const row of rows) {
        // row.commission คือ "เปอร์เซ็นต์" (ดูหมายเหตุใน NormalizedShowcaseCandidate) แต่
        // ProductCandidate.commission เป็นบาทต่อชิ้นเหมือน candidate ทุกแหล่งอื่นในระบบ —
        // ต้องแปลงก่อนเขียนเสมอ ไม่งั้น "ค่าคอม" ที่แสดงผล/commissionPercent/demandTotal/ป้าย
        // จัดอันดับจะผิดหน่วยกันทั้งหมด (เคยเป็นบั๊ก Critical ของ final review รอบนี้)
        const commissionBaht = commissionBahtFromPercent(row.price, row.commission);
        await tx.productCandidate.upsert({
          where: { batchId_sourceProductId: { batchId: created.id, sourceProductId: row.sourceProductId } },
          create: {
            batchId: created.id,
            name: row.name,
            // ผูก nameKey กับ sourceProductId เสมอ (ต่างจาก extractCandidates ที่ใช้แค่
            // normalizeName(name) เพราะแคปหน้าจัดอันดับไม่มี ID ที่เชื่อถือได้) — สินค้าคนละตัว
            // ใน Showcase payload เดียวกันตั้งชื่อซ้ำกันได้จริง (ร้านก๊อปชื่อกันเป็นเรื่องปกติบน
            // TikTok Shop) ถ้าใช้แค่ normalizeName(name) แถวที่สองจะชน @@unique([batchId, nameKey])
            // แล้วทำให้ transaction ทั้งก้อน rollback (ดู catch ด้านล่างเป็นด่านกันสำรอง)
            nameKey: `${normalizeName(row.name)}::${row.sourceProductId}`,
            price: row.price,
            commission: commissionBaht,
            weeklySales: null,
            categoryLabel: row.categoryLabel,
            sourceProductId: row.sourceProductId,
            capturedOn,
          },
          update: {
            name: row.name,
            price: row.price,
            commission: commissionBaht,
            categoryLabel: row.categoryLabel,
          },
        });
      }
      return created;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new Error(
        "นำเข้าไม่สำเร็จ — มีสินค้าในไฟล์นี้ชนกันในระบบ (ชื่อหรือรหัสสินค้าซ้ำ) ลองนำเข้าไฟล์นี้ใหม่อีกครั้ง"
      );
    }
    throw err;
  }

  const created = await prisma.productCandidate.findMany({
    where: { batchId: batch.id },
    select: { id: true, sourceProductId: true },
  });
  const idByProductId = new Map(created.map((c) => [c.sourceProductId, c.id]));

  for (const row of rows) {
    const candidateId = idByProductId.get(row.sourceProductId);
    if (!candidateId) continue; // ไม่ควรเกิด แต่กันไว้เผื่อ race
    const dir = path.join(CANDIDATE_IMAGE_ROOT, candidateId);
    let sortOrder = 0;
    for (const url of row.imageUrls) {
      // ขนาดเต็มก่อน (thumbnail ของ Showcase 300px ดูไม่รู้เรื่อง) · โหลดไม่ได้/ใหญ่เกิน 10MB → ถอยไปลิงก์เดิม
      const big = originalImageUrl(url);
      const downloaded = (await downloadImage(big)) ?? (big === url ? null : await downloadImage(url));
      if (!downloaded) {
        imagesFailed++;
        continue;
      }
      await mkdir(dir, { recursive: true });
      const filename = `${crypto.randomUUID()}.${downloaded.ext}`;
      await writeFile(joinPath(dir, filename), downloaded.buffer);
      await prisma.candidateImage.create({
        data: {
          candidateId,
          filename,
          mimeType: `image/${downloaded.ext === "jpg" ? "jpeg" : downloaded.ext}`,
          sortOrder: sortOrder++,
        },
      });
    }
  }

  revalidatePath("/showcase");
  return { batchId: batch.id, added: created.length, skipped, imagesFailed };
}

/** ทางสำรอง — อัปโหลดไฟล์ .json มือแทนการรับ push จาก extension */
export async function importShowcaseFile(
  formData: FormData
): Promise<{ batchId: string; added: number; skipped: number; imagesFailed: number }> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("กรุณาเลือกไฟล์ .json ที่ export มาจาก extension");
  }
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("ไฟล์ไม่ใช่ JSON ที่ถูกต้อง");
  }
  return importShowcaseBatch(parsed);
}

// ---------------------------------------------------------------------------
// Flow image bot (spec docs/superpowers/specs/2026-09-06-flow-image-bot-design.md)
// ทุก action ที่นี่แตะแค่ FlowJob/FlowJobImage/FlowWorkerState — ยกเว้นสองที่ที่แตะ ProductImage (lib/auto-source-image-db.ts):
// เข้าคิว (enqueueFlowJobCore) ใส่/แทนรูปต้นทางอัตโนมัติ · chooseFlowCandidate รอบ 2 ลบรูปนั้นแล้วก๊อป 2 ไฟล์ที่ผู้ใช้เลือก
// ---------------------------------------------------------------------------

function extFromMime(mime: string): "png" | "webp" | "jpg" {
  return mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
}

/**
 * แกนกลางของการเข้าคิว Flow — แยกจาก FormData เพราะตอนนี้มีสองต้นทางของรูป:
 * (1) ผู้ใช้อัปโหลดผ่านฟอร์ม (FormData, path เดิม) (2) รูปที่โหลดมาแล้วจาก Showcase import
 * ผ่าน CandidateImage (Task 8) — ทั้งสองทางต้องได้ผลลัพธ์เดียวกันทุกจุด (validation, FlowJob
 * ที่สร้าง, error message) จึงรวมไว้ที่เดียวแล้วให้สองทางเรียกใช้ร่วมกัน
 */
async function enqueueFlowJobCore(
  entryId: string,
  images: { buffer: Buffer; mimeType: string }[],
  extraPrompt = ""
): Promise<string> {
  if (!entryId) throw new Error("ไม่พบรายการที่ต้องการเข้าคิว Flow");
  const entry = await prisma.promptEntry.findUnique({ where: { id: entryId }, select: { id: true, productName: true } });
  if (!entry) throw new Error("ไม่พบรายการที่ต้องการเข้าคิว Flow");
  if (entry.productName.trim() === "") throw new Error("ต้องมีชื่อสินค้าก่อน (พรอมต์ของ Flow ใช้ชื่อสินค้า)");

  const open = await prisma.flowJob.findFirst({
    where: { entryId, status: { notIn: [FLOW_STATUS.DONE, FLOW_STATUS.SKIPPED] } },
    select: { id: true },
  });
  if (open) throw new Error("รายการนี้มีงาน Flow ค้างอยู่แล้ว");

  if (images.length === 0) throw new Error("กรุณาเลือกรูปแคปสินค้าอย่างน้อย 1 รูป");
  for (const img of images) {
    // HEIC ไม่รับ — Flow อัปโหลดไม่ได้ และ Playwright ส่งไฟล์ตามที่เป็น
    if (!["image/jpeg", "image/png", "image/webp"].includes(img.mimeType)) {
      throw new Error("รองรับเฉพาะ JPEG, PNG, WebP");
    }
    if (img.buffer.length > MAX_IMAGE_BYTES) throw new Error("ไฟล์ใหญ่เกิน 10MB");
  }

  const dir = path.join(UPLOAD_ROOT, entryId, "flow");
  await mkdir(dir, { recursive: true });

  const plan = enqueue(
    extraPrompt,
    images.map((img, index) => ({ filename: sourceFilename(index, extFromMime(img.mimeType)), mimeType: img.mimeType })),
  );
  const job = await createJob(entryId, plan.job);
  for (const [index, img] of images.entries()) {
    const row = plan.sourceRows[index];
    await writeFile(path.join(dir, row.filename), img.buffer);
    await addImage(job.id, row);
  }

  // รูปต้นทาง (รูปแรก) เป็นรูปสินค้าของ entry ทันที ทำเองได้เลยไม่ต้องรอ Flow — เข้าคิวซ้ำแทนแถวเดิม เลือกรอบ 2 แทนด้วยรูปที่
  // Flow วาด (lib/auto-source-image-db.ts) · งานเข้าคิวสำเร็จไปแล้ว ขั้นนี้พังห้ามทำให้เข้าคิวพัง ผู้ใช้อัปรูปเองที่หน้า entry ได้
  try {
    await replaceAutoSourceImage(UPLOAD_ROOT, entryId, images[0]);
  } catch (err) {
    console.error("ใส่รูปต้นทางเข้ารูปสินค้าไม่สำเร็จ (งาน Flow เข้าคิวแล้ว):", err);
  }

  await logUserActivity({
    kind: "user_enqueue",
    jobId: job.id,
    round: 1,
    detail: { round: 1, attempt: 1, images: images.length, ...extraDetail(job.extraPrompt) },
  });
  revalidatePath("/flow");
  revalidatePath(`/entry/${entryId}`);
  revalidatePath("/"); // รูปแรกของรายการ = ภาพย่อในหน้ารายการ
  return job.id;
}

/** detail ของข้อความเพิ่มเติม (ความยาว + ข้อความ ≤200) สำหรับสมุดบันทึกพฤติกรรมผู้ใช้ */
function extraDetail(extra: string | undefined): { extraPromptLen: number; extraPrompt?: string } {
  const text = (extra ?? "").slice(0, EXTRA_PROMPT_MAX);
  return text === "" ? { extraPromptLen: 0 } : { extraPromptLen: text.length, extraPrompt: text };
}

/** อัปรูปแคปสินค้า + สร้างงาน queued_r1 — 1 entry มีงานค้างได้ทีละ 1 */
export async function enqueueFlowJob(formData: FormData): Promise<string> {
  const entryId = String(formData.get("entryId") ?? "").trim();
  const files = formData.getAll("files").filter((v): v is File => v instanceof File && v.size > 0);
  const images = await Promise.all(
    files.map(async (file) => ({ buffer: Buffer.from(await file.arrayBuffer()), mimeType: file.type }))
  );
  return enqueueFlowJobCore(entryId, images);
}

/**
 * ผู้ใช้เลือก 1 ใน 4 — รอบ 1 → เข้าคิวรอบ 2 · รอบ 2 → ลบรูปต้นทางอัตโนมัติ + ก๊อป 2 รูปที่เลือกเป็น ProductImage แล้วรอ 10-part prompt
 * (awaiting_prompt, รอบ 3 = Render) · generateWithAI เป็นคนส่งต่อเข้าคิว Render
 * (caption ตั้งต้นตาม DEFAULT_CAPTIONS แก้ได้ในหน้า entry เหมือนรูปที่อัปเอง)
 */
/**
 * @param extraPrompt ข้อความเพิ่มเติมสำหรับรอบ 2 (ช่องที่ผู้ใช้เห็นตอนเลือกรูปรอบ 1 — เติมมาจากของรอบ 1) ·
 *   undefined = ไม่แตะค่าเดิม (ติดจากรอบ 1 ไปเอง) · ใช้เฉพาะตอนไปรอบ 2 ตอนปิดงานไม่มีรอบถัดไปให้ใช้
 */
export async function chooseFlowCandidate(jobId: string, imageId: string, extraPrompt?: string): Promise<void> {
  const job = await prisma.flowJob.findUnique({ where: { id: jobId }, include: { images: true } });
  if (!job) throw new Error("ไม่พบงาน Flow");
  // Render อัตโนมัติปิดอยู่ = จบงานที่รูปรอบ 2 ผู้ใช้ทำคลิปเองใน Flow บัญชีหลัก — ดู WorkerConfig.renderEnabled
  const plan = choose(job, job.images.find((i) => i.id === imageId), () => loadWorkerConfig().renderEnabled, new Date());
  const image = plan.image;

  let removedAutoSource: string[] = [];
  await prisma.$transaction(async (tx) => {
    if (!plan.copyToProductImages) {
      await applyPlan(jobId, plan, tx);
      return;
    }

    // จบรอบ 2: รูปที่เลือกรอบ 1 + รูปนี้ (รอบ 2) → ProductImage 2 แถว
    const round1 = job.images.find((i) => i.kind === "candidate" && i.round === 1 && i.chosen);
    if (!round1) throw new Error("ไม่พบรูปที่เลือกไว้ในรอบ 1");
    // รูปต้นทางอัตโนมัติ (แถว) ออก รูปที่ Flow วาด 2 รูปเข้า — รูปที่ผู้ใช้เพิ่มเองไม่ถูกแตะ
    removedAutoSource = await replaceAutoSourceWithFlowImages(tx, UPLOAD_ROOT, job.entryId, [
      { filename: round1.filename, mimeType: round1.mimeType, round: 1 },
      { filename: image.filename, mimeType: image.mimeType, round: 2 },
    ]);
    await applyPlan(jobId, plan, tx);
  });
  // ไฟล์ของรูปต้นทางอัตโนมัติลบหลัง commit เท่านั้น — ทรานแซกชันล้ม = แถวยังอยู่ ไฟล์ต้องยังเปิดได้
  await removeAutoSourceFiles(UPLOAD_ROOT, job.entryId, removedAutoSource);

  await logUserActivity({
    kind: "user_choose",
    jobId,
    round: job.round,
    detail: {
      round: job.round,
      attempt: job.attempt,
      candidateIndex: image.index,
      toStatus: plan.next,
      ...(plan.next === FLOW_STATUS.QUEUED_R2 ? extraDetail(extraPrompt) : { extraPromptLen: 0 }),
      waitedMs: waitedMsSince(job.updatedAt),
    },
  });
  revalidatePath("/flow");
  revalidatePath(`/entry/${job.entryId}`);
  revalidatePath("/");
}

/**
 * "ทำต่อเอง" (Manual takeover) — ผู้ใช้รับงานไปทำเองใน Flow บัญชีหลัก ได้ทุกขั้นที่บอทไม่ได้กำลังทำอยู่ · กดครั้งเดียว
 * งานจบ (done) ทันที บอทไม่แตะอีก · ใช้ทั้งปุ่ม "ทำต่อเอง" ของหน้า /flow และปุ่มของแผงทำคลิปเอง
 * เขียนด้วย applyTakeOver (where status กันแข่งกับบอท) — 0 แถว = บอทหยิบงานนี้ไปก่อนแล้ว
 * จากนั้นสร้างโฟลเดอร์ TTS ของสินค้านี้ให้ทันที (ไม่ต้องมีคลิป: รูปต้นทาง + รูปที่เลือก + ข้อความที่มี) แล้วเปิด Explorer ·
 * export ล้ม = งานยังเป็น "ทำเอง" ตามเดิม คืน exportError ให้หน้าเว็บโชว์ (กด "ส่งเข้าโฟลเดอร์ TTS" ลองใหม่ได้)
 * ทำต่อเองไม่ได้ (บอทหยิบไปก่อน/งานจบแล้ว) คืน taken=false พร้อมข้อความไทย แทน throw — ข้อความ throw จาก server action
 * ถูกซ่อนใน production build ผู้ใช้จึงจะไม่เห็นว่าฝั่งไหนชนะ
 */
export async function takeOverFlowJob(
  jobId: string
): Promise<{ taken: boolean; message: string | null; exportPath: string | null; exportError: string | null }> {
  const job = await prisma.flowJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error("ไม่พบงาน Flow");
  const refused = (message: string) => {
    revalidatePath("/flow");
    return { taken: false, message, exportPath: null, exportError: null };
  };
  let plan;
  try {
    plan = takeOver(job, new Date());
  } catch (e) {
    return refused(e instanceof Error ? e.message : "ทำต่อเองไม่ได้");
  }
  const changed = await applyTakeOver(jobId, plan, job.status);
  if (changed === 0) return refused(TAKEOVER_BOT_BUSY_MESSAGE);
  await logUserActivity({
    kind: "user_take_over",
    jobId,
    round: job.round,
    detail: { fromStatus: job.status, round: job.round, waitedMs: waitedMsSince(job.updatedAt) },
  });
  let exportPath: string | null = null;
  let exportError: string | null = null;
  try {
    exportPath = (await exportJobToFolder(jobId, { allowNoClip: true })).path;
  } catch (e) {
    exportError = e instanceof Error ? e.message : "ส่งเข้าโฟลเดอร์ TTS ไม่สำเร็จ";
  }
  revalidatePath("/flow");
  revalidatePath("/showcase");
  revalidatePath(`/entry/${job.entryId}`);
  return { taken: true, message: null, exportPath, exportError };
}

function openInExplorer(dir: string): void {
  if (process.env.CLIP_EXPORT_NO_OPEN === "1") return;
  try {
    spawn("explorer.exe", [dir], { detached: true, stdio: "ignore" }).unref();
  } catch {
    // เปิดโฟลเดอร์ไม่ได้ไม่ใช่เรื่องร้ายแรง — ไฟล์ส่งแล้ว
  }
}

/**
 * เปิดโปรเจกต์ Flow ของงานในโปรไฟล์ Brave ของบัญชีสำรอง (Brave ของผู้ใช้ล็อกอินบัญชีหลักไว้ ลิงก์ธรรมดาจึงเปิดไม่ได้)
 * เซิร์ฟเวอร์รันบนเครื่องเดียวกัน จึงสั่ง brave.exe --profile-directory=<โปรไฟล์> ได้ตรงๆ
 * · ตั้งเองได้ด้วย FLOW_BACKUP_BROWSER_PROFILE (เช่น "Profile 3") / FLOW_BACKUP_BROWSER_EXE
 * · ห้ามชี้ไป .flow-profile ของบอท — ชนกับบอทที่เปิดอยู่
 */
export async function openFlowProjectInBackupProfile(jobId: string): Promise<void> {
  const job = await prisma.flowJob.findUnique({ where: { id: jobId }, select: { flowProjectId: true } });
  if (!job) throw new Error("ไม่พบงาน Flow");
  const url = flowProjectUrl(job.flowProjectId);
  if (url === "") throw new Error("งานนี้ยังไม่มีโปรเจกต์ใน Flow");
  const exe = process.env.FLOW_BACKUP_BROWSER_EXE ?? "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe";
  if (!(await stat(exe).then((st) => st.isFile(), () => false))) throw new Error("ไม่เจอ Brave ในเครื่อง — กด คัดลอกลิงก์ แล้วเปิดเองแทน");
  let profile = process.env.FLOW_BACKUP_BROWSER_PROFILE ?? null;
  if (profile === null) {
    try {
      const localState = JSON.parse(
        await readFile(path.join(os.homedir(), "AppData", "Local", "BraveSoftware", "Brave-Browser", "User Data", "Local State"), "utf8"),
      ) as { profile?: { info_cache?: Record<string, { name?: unknown }> } };
      profile = pickBackupBrowserProfile(localState.profile?.info_cache ?? {});
    } catch {
      profile = null;
    }
  }
  if (profile === null) {
    throw new Error('ยังไม่เจอโปรไฟล์ Brave ของบัญชีสำรอง — สร้างโปรไฟล์ใน Brave ให้ชื่อมีคำว่า "Flow สำรอง" แล้วล็อกอินบัญชีสำรองในนั้น');
  }
  spawn(exe, [`--profile-directory=${profile}`, url], { detached: true, stdio: "ignore" }).unref();
}

/**
 * งานหาข้อมูล + ส่งเข้าโฟลเดอร์ TTS ของงานเดียว (ใช้ทั้งปุ่ม "ส่งเข้าโฟลเดอร์ TTS" และ takeOverFlowJob) — งานดิสก์ทั้งชุด
 * (ตัดสินส่งซ้ำ/วันโพสต์/เลขช่อง/ก๊อป/ลบคลิปอีกขนาด/rollback) อยู่ exportClip ใน lib/clip-export-fs.ts · ที่นี่แค่หางาน
 * อ่านแถว user_export_clip ล่าสุด อ่านโควต้าต่อวัน บันทึกแถวใหม่ (เมื่อไม่ใช่ already) และเปิด Explorer ·
 * งานที่เคยทำต่อเอง (หรือ allowNoClip) ส่งโดยไม่มีคลิปได้ · Product ID มาจากแถว Showcase ที่ผูกกับ entry
 */
async function exportJobToFolder(
  jobId: string,
  opts: { allowNoClip?: boolean } = {}
): Promise<{ path: string; alreadyExported: boolean; updated: boolean; files: string[] }> {
  const job = await prisma.flowJob.findUnique({
    where: { id: jobId },
    include: {
      entry: { select: { productName: true, chatgptOutput: true, caption: true, hashtags: true } },
      images: true,
    },
  });
  if (!job) throw new Error("ไม่พบงาน Flow");

  const [latest, tookOver, productIds, perDay] = await Promise.all([
    prisma.flowActivity.findFirst({ where: { kind: "user_export_clip", jobId }, orderBy: { at: "desc" } }),
    getTookOverJobIds([jobId]),
    getProductIdsByEntry([job.entryId]),
    readPostsPerDay(),
  ]);
  const result = await exportClip({
    root: clipExportRoot(),
    now: new Date(),
    perDay,
    allowNoClip: opts.allowNoClip === true || tookOver.has(jobId),
    job: { ...job.entry, productId: productIds.get(job.entryId) ?? null, flowDir: joinPath(UPLOAD_ROOT, job.entryId, "flow"), images: job.images },
    prev: latest === null ? null : parseExportDetail(latest.detail),
  });
  if (result.outcome !== "already") {
    await logUserActivity({ kind: "user_export_clip", jobId, round: job.round, detail: result.record });
  }
  openInExplorer(result.path);
  return { path: result.path, alreadyExported: result.outcome === "already", updated: result.outcome === "updated", files: result.files };
}

/** "ส่งเข้าโฟลเดอร์ TTS" — already = เปิดโฟลเดอร์เดิม ไม่บันทึกแถวใหม่ (รายละเอียดดู exportJobToFolder) */
export async function exportClipToFolder(
  jobId: string
): Promise<{ path: string; alreadyExported: boolean; updated: boolean; files: string[] }> {
  return exportJobToFolder(jobId);
}

/** ตั้ง "โพสต์วันละกี่คลิป" (1–20) จากหน้า /flow — เก็บใน tts-settings.json ไม่ต้อง build ใหม่ · มีผลกับการส่งครั้งถัดไป */
export async function setPostsPerDay(value: number): Promise<number> {
  const n = await writePostsPerDay(value);
  revalidatePath("/flow");
  return n;
}

/**
 * "ผ่าน" คลิปตัวอย่าง 720p → ให้บอทกลับไปโหลดคลิปเดิมแบบ 1080p Upscaled (round 4, queued_upscale) — บอทหยิบงานนี้
 * ก่อนงานอื่นและไม่นับเพดาน · งานเป็น done เมื่อบอทได้ไฟล์ 1080p แล้ว (worker/index.ts)
 */
export async function approveFlowRender(jobId: string): Promise<void> {
  const job = await prisma.flowJob.findUnique({ where: { id: jobId }, include: { images: true } });
  if (!job) throw new Error("ไม่พบงาน Flow");
  await applyPlan(jobId, approveRender(job, job.images.some((i) => i.kind === "video")));
  await logUserActivity({
    kind: "user_approve_render",
    jobId,
    round: job.round,
    detail: { round: job.round, attempt: job.attempt, waitedMs: waitedMsSince(job.updatedAt) },
  });
  revalidatePath("/flow");
  revalidatePath(`/entry/${job.entryId}`);
}

/**
 * "ลองโหลด 1080p อีกครั้ง" — งานที่จบด้วย 720p กลับเข้าคิวรอบ 4 (โหลดคลิปเดิมจากโปรเจกต์ ไม่เรนเดอร์ใหม่ ไม่เสียเครดิต)
 * ถ้ารอบนี้ก็ไม่ได้ บอทจบงานด้วย 720p เหมือนเดิม (worker/index.ts)
 */
export async function retryFlowUpscale(jobId: string): Promise<void> {
  const job = await prisma.flowJob.findUnique({ where: { id: jobId }, include: { images: true } });
  if (!job) throw new Error("ไม่พบงาน Flow");
  await applyPlan(jobId, retryUpscale(job, job.images.find((i) => i.kind === "video") ?? null));
  await logUserActivity({
    kind: "user_retry_upscale",
    jobId,
    round: 4,
    detail: { round: 4, attempt: job.attempt, waitedMs: waitedMsSince(job.updatedAt) },
  });
  revalidatePath("/flow");
  revalidatePath(`/entry/${job.entryId}`);
}

/**
 * "ไม่ผ่านสักรูป วาดใหม่" / "เรนเดอร์ใหม่" (คลิป) — attempt+1 · candidate/คลิปเก่าเก็บไว้ (ข้อมูลว่าเพี้ยนบ่อยแค่ไหน)
 * @param extraPrompt ข้อความต่อท้ายพรอมต์สำหรับครั้งนี้ (รูป = ต่อท้ายพรอมต์ตายตัว · คลิป = ต่อท้าย 10-part prompt)
 *   "" = กลับเป็นพรอมต์ตั้งต้น · undefined = ใช้ค่าเดิมของงาน
 */
export async function redoFlowRound(jobId: string, extraPrompt?: string): Promise<void> {
  const job = await prisma.flowJob.findUnique({ where: { id: jobId }, include: { images: true } });
  if (!job) throw new Error("ไม่พบงาน Flow");
  const plan = redo(job, extraPrompt);
  if (plan.deleteVideoRows) {
    // คลิปตัวอย่างที่ไม่ผ่านลบทิ้งทั้งไฟล์และแถว (ต่างจากรูป candidate ที่เก็บไว้) — ไฟล์ละหลาย MB และงานมีคลิปได้
    // แถวเดียว หน้าเว็บจะได้ไม่ชี้ไปคลิปที่ผู้ใช้ปัดตกแล้ว · จำนวนครั้งที่เรนเดอร์ยังดูได้จาก attempt
    for (const v of job.images.filter((i) => i.kind === "video")) {
      await unlink(joinPath(UPLOAD_ROOT, job.entryId, "flow", v.filename)).catch(() => undefined);
    }
  }
  await applyPlan(jobId, plan);
  await logUserActivity({
    kind: plan.isRender ? "user_redo_render" : "user_redraw",
    jobId,
    round: job.round,
    detail: {
      round: job.round,
      attempt: job.attempt,
      nextAttempt: job.attempt + 1,
      ...extraDetail(plan.extraPrompt),
      waitedMs: waitedMsSince(job.updatedAt),
    },
  });
  revalidatePath("/flow");
  revalidatePath(`/entry/${job.entryId}`);
}

/** "รันต่อ (หลังซ่อม)" — งานที่พังกลับเข้าคิวรอบเดิม และปลดการหยุดของ worker */
export async function resumeFlowWorker(jobId: string): Promise<void> {
  const job = await prisma.flowJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error("ไม่พบงาน Flow");
  // round 3 = งาน Render ที่พัง → กลับเข้าคิว Render (queued_r3) ไม่ใช่วาดรูปใหม่
  await applyPlan(jobId, resume(job));
  await logUserActivity({
    kind: "user_resume",
    jobId,
    round: job.round,
    detail: {
      round: job.round,
      attempt: job.attempt,
      failedStep: job.failedStep,
      errorKind: job.errorKind,
      waitedMs: waitedMsSince(job.updatedAt),
    },
  });
  revalidatePath("/flow");
  revalidatePath(`/entry/${job.entryId}`);
}

/** "ข้าม" — ทิ้งงานที่พัง ปลดการหยุดของ worker ให้ทำงานอื่นต่อ */
export async function skipFlowJob(jobId: string): Promise<void> {
  const job = await prisma.flowJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error("ไม่พบงาน Flow");
  const plan = skip(job, new Date());
  if (plan === null) return;
  await applyPlan(jobId, plan);
  await logUserActivity({
    kind: "user_skip",
    jobId,
    round: job.round,
    detail: { round: job.round, attempt: job.attempt, fromStatus: job.status, waitedMs: waitedMsSince(job.updatedAt) },
  });
  revalidatePath("/flow");
  revalidatePath(`/entry/${job.entryId}`);
}

/**
 * บันทึกว่าผู้ใช้กด "สร้างพรอมต์ตอนนี้" ในแถว awaiting_prompt (เรียกจากหน้าเว็บหลัง generateWithAI สำเร็จ —
 * generateWithAI เองถูกเรียกอัตโนมัติด้วย จึงแยกไม่ได้ที่ตัว action นั้น) · ไม่ throw
 */
export async function logFlowPromptNow(entryId: string): Promise<void> {
  try {
    const job = await prisma.flowJob.findFirst({
      where: { entryId },
      orderBy: { createdAt: "desc" },
      select: { id: true, round: true, attempt: true },
    });
    if (!job) return;
    await logUserActivity({
      kind: "user_prompt_now",
      jobId: job.id,
      round: job.round,
      detail: { round: job.round, attempt: job.attempt },
    });
  } catch (err) {
    console.error("[logFlowPromptNow]", err);
  }
}

/** token ของลิงก์ปลายทาง Showcase Scanner — สร้างครั้งแรกที่มีคนขอ */
export async function getScannerToken(): Promise<string> {
  // อ่านก่อน — หน้า /products เรียกทุกครั้งที่เรนเดอร์ ไม่ควรเขียน DB ทุกครั้ง
  const existing = await prisma.scannerLink.findUnique({ where: { id: "singleton" } });
  if (existing) return existing.token;
  // สร้างเฉพาะตอนยังไม่มีแถว · upsert (update ว่าง) กันชนกันถ้ามีคนสร้างพร้อมกัน แล้วคืนของที่ชนะ
  const row = await prisma.scannerLink.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", token: newToken() },
    update: {},
  });
  return row.token;
}

/** "สร้างลิงก์ใหม่" — ลิงก์เก่าใช้ไม่ได้ทันที (extension จะเห็นไฟแดง "ลิงก์ใช้ไม่ได้แล้ว") */
export async function regenerateScannerToken(): Promise<string> {
  const token = newToken();
  await prisma.scannerLink.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", token },
    update: { token, createdAt: new Date() },
  });
  revalidatePath("/showcase");
  return token;
}
