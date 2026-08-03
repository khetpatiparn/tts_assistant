"use server";

import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { buildPromptText } from "@/lib/prompt-template";
import { getFewShotExamples } from "@/lib/few-shot";
import {
  generateTenPartPrompt,
  generateCaptionAndHashtags,
  extractProductFields,
  extractProductSpec,
  suggestAngleOptions,
  isGeminiModelId,
} from "@/lib/gemini";
import {
  collectFamily,
  collectUsedAngles,
  parseAngleSuggestions,
  type AngleSuggestion,
} from "@/lib/angle";
import { parseCaptionOutput } from "@/lib/caption";
import { parseExtractOutput } from "@/lib/extract";
import { parseAffiliateXlsx, videoIdFromUrl } from "@/lib/affiliate";
import { parseContentCsv } from "@/lib/clip-metrics";
import { parseFollowerActivityCsv } from "@/lib/follower-activity";
import { parseOverviewCsv } from "@/lib/channel-metrics";
import { handleFromUrl, buildVideoUrl, fetchOembedThumbnail } from "@/lib/tiktok-oembed";
import { uploadedAtFromVideoId, thaiDateKey } from "@/lib/video-id-time";
import { parseMonthDayLabel } from "@/lib/csv";
import { createHash } from "crypto";
import type { ImportKind } from "@/lib/import-log";

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
      image.mimeType === "image/png" ? "png" : image.mimeType === "image/webp" ? "webp" : "jpg";
    const filename = `${crypto.randomUUID()}.${ext}`;
    await writeFile(path.join(UPLOAD_ROOT, created.id, filename), data);
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
  const rawPostedTime = String(formData.get("postedTimeOfDay") ?? "").trim();
  // <input type="time"> ส่ง "HH:MM" — ค่าว่างแปลว่ายังไม่ระบุ
  if (rawPostedTime !== "" && !/^\d{2}:\d{2}$/.test(rawPostedTime)) {
    throw new Error("เวลาที่ลงคลิปไม่ถูกต้อง");
  }
  const isScheduledPost = String(formData.get("isScheduledPost") ?? "") === "true";

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
      postedTimeOfDay: rawPostedTime === "" ? null : rawPostedTime,
      postedTimeSource: isScheduledPost
        ? rawPostedTime === ""
          ? null
          : "manual"
        : "derived",
      isScheduledPost,
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

const UPLOAD_ROOT = path.join(process.cwd(), "uploads");
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
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
      throw new Error("รองรับเฉพาะไฟล์ JPEG, PNG, WebP");
    }
    if (file.size > MAX_IMAGE_BYTES) {
      throw new Error("ไฟล์ใหญ่เกิน 10MB");
    }
  }

  const existingCount = await prisma.productImage.count({ where: { entryId } });
  await mkdir(path.join(UPLOAD_ROOT, entryId), { recursive: true });

  for (const [index, file] of files.entries()) {
    const ext =
      file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    // A generated name, never the uploaded one — "../../evil.js" would escape UPLOAD_ROOT.
    const filename = `${crypto.randomUUID()}.${ext}`;

    await writeFile(
      path.join(UPLOAD_ROOT, entryId, filename),
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
      throw new Error("รองรับเฉพาะไฟล์ JPEG, PNG, WebP");
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
  /** ลายเซ็นของไฟล์ที่อ่านไม่ผ่าน — ไฟล์ที่เหลือยังทำงานต่อ */
  failed: string[];
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
  // สำคัญ: matchedEntryId ถูก set ที่นี่เท่านั้น (ไม่มีที่อื่นแตะ ClipMetric.matchedEntryId เลย)
  // และ cross-check เรื่อง isScheduledPost ด้านล่างก็รันในรอบเดียวกันนี้พอดี — เพราะเหตุนี้
  // คลิปที่ตั้งเวลาไว้จะไม่มีทาง "โผล่เป็น live" ได้เลย: ถ้ายังไม่เคย import ไฟล์นี้ คลิปจะยังไม่มี
  // views จับคู่ (analyzePostTimes ข้ามไปเป็น skippedNoViews) และพอ import ครั้งแรกที่มันได้ views
  // มัน ก็จะได้ isScheduledPost มาพร้อมกันในรอบเดียวกันเสมอ — **ถ้าวันหน้ามีจุดอื่นมา set
  // ClipMetric.matchedEntryId แยกจากตรงนี้ (เช่น re-link ตอนแก้ videoUrl) การรับประกันนี้จะพังทันที**
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

  // เวลาจาก video id คือ "เวลาอัปโหลด" ถ้าวันเผยแพร่จริงในไฟล์ไม่ตรงกัน แปลว่าคลิปนั้นตั้งเวลาไว้
  // → เวลาที่ถอดได้เชื่อไม่ได้ ต้องทำเครื่องหมายไว้เพื่อให้ analyzePostTimes ตัดออก
  // ทำแบบนี้เพราะระบบต้องไม่พึ่งว่าผู้ใช้ติ๊ก toggle ถูก — ข้อมูลจริงจับได้ทีหลังเสมอ
  for (const m of metrics) {
    const entryId = videoToEntry.get(m.videoId);
    if (!entryId) continue;
    const uploadedAt = uploadedAtFromVideoId(m.videoId);
    if (!uploadedAt) continue;
    const publishedOn = parseMonthDayLabel(m.postedDate, importedAt);
    if (!publishedOn) continue;

    const scheduled = thaiDateKey(uploadedAt) !== publishedOn.toISOString().slice(0, 10);
    if (!scheduled) continue;

    const entry = await prisma.promptEntry.findUnique({
      where: { id: entryId },
      select: { isScheduledPost: true, postedTimeSource: true },
    });
    if (!entry || entry.isScheduledPost) continue;

    await prisma.promptEntry.update({
      where: { id: entryId },
      data: {
        isScheduledPost: true,
        // เวลาที่เคยติดป้ายว่า derived ใช้ไม่ได้แล้ว — ล้างทิ้ง ไม่เก็บของปลอมไว้
        postedTimeSource: entry.postedTimeSource === "manual" ? "manual" : null,
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
  const failed: string[] = [];

  for (const f of picked) {
    const buffer = Buffer.from(await f.arrayBuffer());
    const result = await importOneContentFile(buffer, importedAt);
    if (!result) {
      failed.push(f.name);
      continue;
    }

    const fileHash = hashFile(buffer);
    const seen = await prisma.importLog.findFirst({ where: { fileHash } });
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

export type FollowerActivityImportSummary = {
  total: number;
  days: number;
};

export async function importFollowerActivity(
  formData: FormData
): Promise<FollowerActivityImportSummary> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("กรุณาเลือกไฟล์ FollowerActivity (.csv)");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const text = buffer.toString("utf8");
  const importedAt = new Date();
  let rows;
  try {
    rows = parseFollowerActivityCsv(text, importedAt);
  } catch {
    throw new Error("อ่านไฟล์ไม่สำเร็จ — ต้องเป็นไฟล์ FollowerActivity (.csv) จาก TikTok Studio");
  }
  if (rows.length === 0) {
    throw new Error("ไม่พบข้อมูลผู้ติดตามในไฟล์");
  }

  // upsert ด้วย (activityOn, hour) — โยนไฟล์เดิมซ้ำได้ ไม่เกิดแถวซ้ำ
  for (const r of rows) {
    await prisma.followerActivity.upsert({
      where: { activityOn_hour: { activityOn: r.activityOn, hour: r.hour } },
      create: r,
      update: { active: r.active, importedAt: new Date() },
    });
  }

  const days = new Set(rows.map((r) => r.activityOn.getTime())).size;
  await writeImportLog({
    kind: "followers",
    fileHash: hashFile(buffer),
    rowCount: rows.length,
    summary: `${rows.length} แถว · ${days} วัน`,
  });

  revalidatePath("/dashboard");
  return {
    total: rows.length,
    days: new Set(rows.map((r) => r.activityOn.getTime())).size,
  };
}

export type ChannelMetricImportSummary = {
  total: number;
  skipped: number;
  firstDate: Date | null;
  lastDate: Date | null;
};

/**
 * นำเข้า Overview.csv — วิวรวมทั้งช่องรายวัน
 *
 * ต่างจาก Content.csv ตรงที่ไฟล์นี้ไม่มีเพดาน 15 แถว จึงเป็นแหล่งวิวชุดเดียวที่ครบ
 * ทุกคลิป ใช้เป็นตัวหารของ conversion ระดับช่องที่ไม่มี selection bias
 */
export async function importChannelMetrics(
  formData: FormData
): Promise<ChannelMetricImportSummary> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("กรุณาเลือกไฟล์ Overview (.csv)");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const text = buffer.toString("utf8");
  const importedAt = new Date();
  let parsed;
  try {
    parsed = parseOverviewCsv(text, importedAt);
  } catch {
    throw new Error("อ่านไฟล์ไม่สำเร็จ — ต้องเป็นไฟล์ Overview (.csv) จาก TikTok Studio");
  }
  if (parsed.rows.length === 0) {
    throw new Error("ไม่พบข้อมูลวิวรายวันในไฟล์ — ตรวจว่าเลือก Overview.csv ไม่ใช่ไฟล์อื่น");
  }

  // upsert ด้วย statsOn — โยนไฟล์เดิมซ้ำได้ ไม่เกิดแถวซ้ำ (ช่วง 28 วันของแต่ละไฟล์ทับกันอยู่แล้ว)
  for (const r of parsed.rows) {
    await prisma.channelMetric.upsert({
      where: { statsOn: r.statsOn },
      create: r,
      update: { ...r, importedAt: new Date() },
    });
  }

  const times = parsed.rows.map((r) => r.statsOn.getTime());
  await writeImportLog({
    kind: "channel",
    fileHash: hashFile(buffer),
    rowCount: parsed.rows.length,
    summary:
      `${parsed.rows.length} วัน · ` +
      `${shortUtc(new Date(Math.min(...times)))}–${shortUtc(new Date(Math.max(...times)))}`,
  });

  revalidatePath("/dashboard");
  return {
    total: parsed.rows.length,
    skipped: parsed.skipped,
    firstDate: new Date(Math.min(...times)),
    lastDate: new Date(Math.max(...times)),
  };
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
