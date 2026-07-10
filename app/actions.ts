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

  const created = await prisma.promptEntry.create({
    data: {
      productName,
      productInfo,
      riskModule,
      extraNotes,
      images: JSON.stringify(images),
    },
  });

  revalidatePath("/");

  return created.id;
}

export async function deletePrompt(id: string) {
  await prisma.promptEntry.delete({ where: { id } });
  revalidatePath("/");
}
