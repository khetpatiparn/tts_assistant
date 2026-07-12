"use server";

import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { buildPromptText } from "@/lib/prompt-template";
import { getFewShotExamples } from "@/lib/few-shot";
import { generateTenPartPrompt, isGeminiModelId } from "@/lib/gemini";

export async function createPrompt(formData: FormData) {
  const productName = String(formData.get("productName") ?? "").trim();
  const productInfo = String(formData.get("productInfo") ?? "").trim();
  const riskModule = String(formData.get("riskModule") ?? "").trim();
  const extraNotes = String(formData.get("extraNotes") ?? "").trim();
  const images = formData
    .getAll("images")
    .map((value) => String(value).trim())
    .filter((value) => value.length > 0);

  if (!productName || !productInfo) {
    throw new Error("กรุณากรอกชื่อสินค้าและข้อมูลสินค้า");
  }

  const activeCorePrompt = await prisma.corePrompt.findFirst({
    where: { isActive: true },
  });

  const created = await prisma.promptEntry.create({
    data: {
      productName,
      productInfo,
      riskModule,
      extraNotes,
      images: JSON.stringify(images),
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
      videoUrl,
      postedAt: parsedPostedAt,
    },
  });

  revalidatePath("/");
}

export async function createCorePrompt(formData: FormData) {
  const label = String(formData.get("label") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();

  if (!label || !content) {
    throw new Error("กรุณากรอกชื่อเวอร์ชันและเนื้อหา core prompt");
  }

  await prisma.$transaction([
    prisma.corePrompt.updateMany({
      where: { isActive: true },
      data: { isActive: false },
    }),
    prisma.corePrompt.create({
      data: { label, content, isActive: true },
    }),
  ]);

  revalidatePath("/");
}

export async function setActiveCorePrompt(id: string) {
  await prisma.$transaction([
    prisma.corePrompt.updateMany({
      where: { isActive: true },
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

  const files = formData
    .getAll("files")
    .filter((value): value is File => value instanceof File && value.size > 0);
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
        sortOrder: existingCount + index,
      },
    });
  }

  revalidatePath("/");
}

export async function generateWithAI(entryId: string, model: string) {
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

  const core = await prisma.corePrompt.findFirst({ where: { isActive: true } });
  if (!core) {
    throw new Error("ยังไม่ได้ตั้ง Core Prompt ที่ใช้งานอยู่");
  }

  let imageLabels: string[] = [];
  try {
    imageLabels = JSON.parse(entry.images);
  } catch {
    imageLabels = [];
  }

  const brief = buildPromptText({
    productInfo: entry.productInfo,
    riskModule: entry.riskModule,
    extraNotes: entry.extraNotes,
    images: imageLabels,
  });

  const photos = await Promise.all(
    entry.productImages.map(async (image) => ({
      base64: (
        await readFile(path.join(UPLOAD_ROOT, image.entryId, image.filename))
      ).toString("base64"),
      mimeType: image.mimeType,
    }))
  );

  const output = await generateTenPartPrompt({
    model,
    systemInstruction: core.content,
    examples: await getFewShotExamples(entryId),
    brief,
    images: photos,
  });

  await prisma.promptEntry.update({
    where: { id: entryId },
    data: { chatgptOutput: output },
  });

  revalidatePath("/");
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
