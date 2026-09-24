import { NextRequest, NextResponse } from "next/server";
import { importShowcaseBatch } from "@/app/actions";
import { SHOWCASE_CORS_HEADERS } from "@/lib/cors";

/**
 * ทางเข้าหลัก — extension ยิง POST ตรงเข้ามาที่นี่ (localhost เท่านั้น ทั้งสองระบบอยู่เครื่อง
 * เดียวกันเสมอ) ป้องกันด้วย shared secret เพราะ endpoint นี้รับ URL รูปจากภายนอกแล้วไปดึงมา —
 * ไม่กันเลย กระบวนการอื่นบนเครื่องเดียวกัน (รวมถึงหน้าเว็บที่มี JS ร้าย) มีโอกาสทฤษฎียิงเข้ามาได้
 *
 * ต้องตอบ CORS header ทั้ง preflight (OPTIONS) และ response จริง — ดูเหตุผลเต็มที่ lib/cors.ts
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: SHOWCASE_CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-showcase-secret");
  const expected = process.env.SHOWCASE_IMPORT_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: SHOWCASE_CORS_HEADERS });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400, headers: SHOWCASE_CORS_HEADERS });
  }

  try {
    const result = await importShowcaseBatch(body);
    return NextResponse.json(result, { status: 200, headers: SHOWCASE_CORS_HEADERS });
  } catch (e) {
    const message = e instanceof Error ? e.message : "import failed";
    return NextResponse.json({ error: message }, { status: 400, headers: SHOWCASE_CORS_HEADERS });
  }
}
