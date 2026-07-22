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
  isGeminiModelId,
} from "@/lib/gemini";
import { parseCaptionOutput } from "@/lib/caption";
import { parseAffiliateXlsx, videoIdFromUrl } from "@/lib/affiliate";
import { parseContentCsv } from "@/lib/clip-metrics";
import { parseFollowerActivityCsv } from "@/lib/follower-activity";
import { handleFromUrl, buildVideoUrl, fetchOembedThumbnail } from "@/lib/tiktok-oembed";

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

export async function deletePrompt(id: string) {
  await prisma.promptEntry.delete({ where: { id } });
  revalidatePath("/");
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
    },
  });

  revalidatePath("/");
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

  revalidatePath("/");
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

  revalidatePath("/");
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

  revalidatePath("/");
}

export async function updateProductImageCaption(id: string, caption: string) {
  await prisma.productImage.update({
    where: { id },
    data: { caption: caption.trim() },
  });
  revalidatePath("/");
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

  const photos = entry.productImages; // เรียง sortOrder แล้วจาก include ด้านบน
  const brief = buildPromptText({
    productName: entry.productName,
    productInfo: entry.productInfo,
    riskModule: entry.riskModule,
    extraNotes: entry.extraNotes,
    imageCaptions: photos.map((p) => p.caption),
  });

  const geminiImages = await Promise.all(
    photos.map(async (image) => ({
      base64: (
        await readFile(path.join(UPLOAD_ROOT, image.entryId, image.filename))
      ).toString("base64"),
      mimeType: image.mimeType,
      caption: image.caption,
    }))
  );

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

  revalidatePath("/");
  return { captionError };
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

  revalidatePath("/");
  return {
    total: orders.length,
    matched,
    unmatched: orders.length - matched,
    unmatchedProducts: [...unmatchedMap.values()].sort((a, b) => b.orders - a.orders),
  };
}

export type ClipMetricImportSummary = {
  total: number;
  matched: number;
  unmatched: number;
};

export async function importClipMetrics(
  formData: FormData
): Promise<ClipMetricImportSummary> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("กรุณาเลือกไฟล์ Content (.csv)");
  }

  const text = await file.text();
  const importedAt = new Date();
  let metrics;
  try {
    metrics = parseContentCsv(text, importedAt);
  } catch {
    throw new Error("อ่านไฟล์ไม่สำเร็จ — ต้องเป็นไฟล์ Content (.csv) จาก TikTok Studio");
  }
  if (metrics.length === 0) {
    throw new Error("ไม่พบข้อมูลคลิปในไฟล์");
  }

  const entries = await prisma.promptEntry.findMany({
    select: { id: true, videoUrl: true },
  });
  const videoToEntry = new Map<string, string>();
  for (const e of entries) {
    const vid = videoIdFromUrl(e.videoUrl);
    if (vid) videoToEntry.set(vid, e.id);
  }

  // upsert ด้วย (videoId, capturedOn) — โยนไฟล์เดิมซ้ำได้ ไม่เกิด snapshot ซ้ำ
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

  const matched = metrics.filter((m) => videoToEntry.has(m.videoId)).length;
  revalidatePath("/");
  return { total: metrics.length, matched, unmatched: metrics.length - matched };
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

  const text = await file.text();
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

  revalidatePath("/");
  return {
    total: rows.length,
    days: new Set(rows.map((r) => r.activityOn.getTime())).size,
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
}
