"use server";

import { mkdir, readFile, writeFile, unlink, copyFile } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { newToken } from "@/lib/scanner-link";
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
} from "@/lib/gemini";
import {
  collectFamily,
  collectUsedAngles,
  parseAngleSuggestions,
  type AngleSuggestion,
} from "@/lib/angle";
import { normalizeName, parseCandidateRows } from "@/lib/candidates";
import { commissionBahtFromPercent, parseShowcasePayload } from "@/lib/showcase-import";
import { downloadImage } from "@/lib/showcase-images";
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
  DEFAULT_CAPTIONS,
  FLOW_STATUS,
  WORKER_STATE_ID,
  afterChoose,
  afterRedo,
  afterResume,
  isOpenStatus,
  sourceFilename,
  type FlowRound,
} from "@/lib/flow-jobs";

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
    const filename = `${crypto.randomUUID()}.${ext}`;
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
      productName: candidate.name,
      productInfo: "",
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
  // กดซ้ำ/เปิดสองแท็บ — ห้ามสร้างงานซ้ำให้สินค้าตัวเดียว
  if (candidate.linkedEntryId !== null) {
    const existing = await prisma.promptEntry.findUnique({ where: { id: candidate.linkedEntryId }, select: { id: true } });
    if (existing) throw new Error("สินค้าตัวนี้เริ่มทำไปแล้ว");
  }

  const active = await prisma.corePrompt.findFirst({ where: { isActive: true, kind: "core" } });

  const created = await prisma.promptEntry.create({
    data: {
      productName: candidate.name,
      productInfo: "",
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
    await enqueueFlowJobCore(created.id, [{ buffer: Buffer.from(await photo.arrayBuffer()), mimeType: photo.type }]);
  } catch (err) {
    flowEnqueueError = err instanceof Error ? err.message : "เข้าคิว Flow อัตโนมัติไม่สำเร็จ";
    console.error("เข้าคิว Flow อัตโนมัติไม่สำเร็จ ผู้ใช้ต้องอัปโหลดรูปเองที่หน้า entry:", err);
  }

  revalidatePath("/showcase");
  revalidatePath("/");
  return { entryId: created.id, flowEnqueueError };
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
      const downloaded = await downloadImage(url);
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
// ทุก action ที่นี่แตะแค่ FlowJob/FlowJobImage/FlowWorkerState — ยกเว้น chooseFlowCandidate
// รอบ 2 ซึ่งเป็นที่เดียวที่สร้าง ProductImage (ก๊อป 2 ไฟล์ที่ผู้ใช้เลือก)
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
  images: { buffer: Buffer; mimeType: string }[]
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

  const job = await prisma.flowJob.create({ data: { entryId, status: FLOW_STATUS.QUEUED_R1, round: 1, attempt: 1 } });
  for (const [index, img] of images.entries()) {
    const filename = sourceFilename(index, extFromMime(img.mimeType));
    await writeFile(path.join(dir, filename), img.buffer);
    await prisma.flowJobImage.create({
      data: { jobId: job.id, kind: "source", round: 0, attempt: 1, index, filename, mimeType: img.mimeType },
    });
  }

  revalidatePath("/flow");
  revalidatePath(`/entry/${entryId}`);
  return job.id;
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
 * ผู้ใช้เลือก 1 ใน 4 — รอบ 1 → เข้าคิวรอบ 2 · รอบ 2 → done และก๊อป 2 รูปที่เลือกเป็น ProductImage
 * (caption ตั้งต้นตาม DEFAULT_CAPTIONS แก้ได้ในหน้า entry เหมือนรูปที่อัปเอง)
 */
export async function chooseFlowCandidate(jobId: string, imageId: string): Promise<void> {
  const job = await prisma.flowJob.findUnique({ where: { id: jobId }, include: { images: true } });
  if (!job) throw new Error("ไม่พบงาน Flow");
  const image = job.images.find((i) => i.id === imageId);
  if (!image || image.kind !== "candidate" || image.round !== job.round || image.attempt !== job.attempt) {
    throw new Error("รูปที่เลือกไม่ใช่ของรอบปัจจุบัน");
  }
  const next = afterChoose(job.status);

  await prisma.$transaction(async (tx) => {
    await tx.flowJobImage.updateMany({
      where: { jobId, kind: "candidate", round: job.round },
      data: { chosen: false },
    });
    await tx.flowJobImage.update({ where: { id: imageId }, data: { chosen: true } });

    if (next.status === FLOW_STATUS.QUEUED_R2) {
      await tx.flowJob.update({ where: { id: jobId }, data: { status: next.status, round: 2, attempt: 1 } });
      return;
    }

    // done: รูปที่เลือกรอบ 1 + รูปนี้ (รอบ 2) → ProductImage 2 แถว
    const round1 = job.images.find((i) => i.kind === "candidate" && i.round === 1 && i.chosen);
    if (!round1) throw new Error("ไม่พบรูปที่เลือกไว้ในรอบ 1");
    const existingCount = await tx.productImage.count({ where: { entryId: job.entryId } });
    const picks: { img: typeof image; round: FlowRound }[] = [
      { img: round1, round: 1 },
      { img: image, round: 2 },
    ];
    // ก๊อปไฟล์ไม่อยู่ใน transaction ของ DB — ถ้า copyFile ของ pick หลังพัง ต้องลบไฟล์ที่ก๊อป
    // สำเร็จไปแล้วของ pick ก่อนหน้าในความพยายามนี้เอง ไม่งั้นจะเหลือไฟล์ค้างดิสก์ที่ไม่มีอะไรอ้างอิง
    // (DB rollback เองอยู่แล้วเพราะอยู่ใน tx แต่ไฟล์บนดิสก์ไม่ transactional)
    const copiedPaths: string[] = [];
    try {
      for (const [i, { img, round }] of picks.entries()) {
        const ext = path.extname(img.filename).slice(1) || "png";
        const filename = `${crypto.randomUUID()}.${ext}`;
        const destPath = joinPath(UPLOAD_ROOT, job.entryId, filename);
        await copyFile(path.join(UPLOAD_ROOT, job.entryId, "flow", img.filename), destPath);
        copiedPaths.push(destPath);
        await tx.productImage.create({
          data: {
            entryId: job.entryId,
            filename,
            mimeType: img.mimeType,
            caption: DEFAULT_CAPTIONS[round],
            sortOrder: existingCount + i,
          },
        });
      }
    } catch (err) {
      // เก็บกวาดไฟล์ที่ก๊อปสำเร็จไปแล้วก่อนพัง — ล้มการเก็บกวาดเองก็ไม่ throw ทับ error เดิม
      for (const copiedPath of copiedPaths) {
        try {
          await unlink(copiedPath);
        } catch {
          // ไม่ต้องทำอะไรเพิ่ม ปล่อยไฟล์ค้างไว้ดีกว่ากลืน error เดิมที่ทำให้ transaction ล้ม
        }
      }
      throw err;
    }
    await tx.flowJob.update({ where: { id: jobId }, data: { status: FLOW_STATUS.DONE, finishedAt: new Date() } });
  });

  revalidatePath("/flow");
  revalidatePath(`/entry/${job.entryId}`);
  revalidatePath("/");
}

/** "ไม่ผ่านสักรูป วาดใหม่" — พรอมต์เดิม attempt+1 · candidate เก่าเก็บไว้ (ข้อมูลว่าเพี้ยนบ่อยแค่ไหน) */
export async function redoFlowRound(jobId: string): Promise<void> {
  const job = await prisma.flowJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error("ไม่พบงาน Flow");
  const next = afterRedo(job.status);
  await prisma.flowJob.update({ where: { id: jobId }, data: { status: next.status, attempt: job.attempt + 1 } });
  revalidatePath("/flow");
  revalidatePath(`/entry/${job.entryId}`);
}

/** "รันต่อ (หลังซ่อม)" — งานที่พังกลับเข้าคิวรอบเดิม และปลดการหยุดของ worker */
export async function resumeFlowWorker(jobId: string): Promise<void> {
  const job = await prisma.flowJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error("ไม่พบงาน Flow");
  if (job.status !== FLOW_STATUS.FAILED) throw new Error("รันต่อได้เฉพาะงานที่พัง");
  const round = (job.round === 2 ? 2 : 1) as FlowRound;
  await prisma.$transaction([
    prisma.flowJob.update({
      where: { id: jobId },
      data: { status: afterResume(round).status, failedStep: "", errorKind: "", errorMessage: "", failureDir: "" },
    }),
    prisma.flowWorkerState.upsert({
      where: { id: WORKER_STATE_ID },
      create: { id: WORKER_STATE_ID, pausedReason: "", pausedAt: null },
      update: { pausedReason: "", pausedAt: null },
    }),
  ]);
  revalidatePath("/flow");
  revalidatePath(`/entry/${job.entryId}`);
}

/** "ข้าม" — ทิ้งงานที่พัง ปลดการหยุดของ worker ให้ทำงานอื่นต่อ */
export async function skipFlowJob(jobId: string): Promise<void> {
  const job = await prisma.flowJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error("ไม่พบงาน Flow");
  if (!isOpenStatus(job.status)) return;
  await prisma.$transaction([
    prisma.flowJob.update({ where: { id: jobId }, data: { status: FLOW_STATUS.SKIPPED, finishedAt: new Date() } }),
    prisma.flowWorkerState.upsert({
      where: { id: WORKER_STATE_ID },
      create: { id: WORKER_STATE_ID, pausedReason: "", pausedAt: null },
      update: { pausedReason: "", pausedAt: null },
    }),
  ]);
  revalidatePath("/flow");
  revalidatePath(`/entry/${job.entryId}`);
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
