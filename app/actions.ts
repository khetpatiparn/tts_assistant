"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";

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
  const rawViews = String(formData.get("views") ?? "").trim();

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

  const parsedViews = rawViews === "" ? null : Number(rawViews);
  if (parsedViews !== null && (!Number.isInteger(parsedViews) || parsedViews < 0)) {
    throw new Error("ยอดวิวต้องเป็นจำนวนเต็มไม่ติดลบ");
  }

  const existing = await prisma.promptEntry.findUnique({ where: { id } });
  if (!existing) {
    throw new Error("ไม่พบรายการที่ต้องการบันทึก");
  }

  // Only stamp viewsUpdatedAt when the number actually changes, so the
  // timestamp keeps telling you how old the figure is.
  const viewsChanged = parsedViews !== existing.views;

  await prisma.promptEntry.update({
    where: { id },
    data: {
      chatgptOutput,
      videoUrl,
      views: parsedViews,
      viewsUpdatedAt: viewsChanged
        ? parsedViews === null
          ? null
          : new Date()
        : existing.viewsUpdatedAt,
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
