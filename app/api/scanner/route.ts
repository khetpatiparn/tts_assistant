import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { importShowcaseBatch } from "@/app/actions";
import { SHOWCASE_CORS_HEADERS } from "@/lib/cors";
import { SCANNER_PROTOCOL, tokensMatch } from "@/lib/scanner-link";

/**
 * ลิงก์ปลายทางของ Showcase Scanner (protocol showcase-scanner/1 — showcase-extension/docs/INTEGRATION.md)
 * แทน /api/showcase-import + /known-ids + /health เดิม · token มาจาก query (ADR 0001) เทียบกับแถว
 * ScannerLink · POST มาเป็น text/plain (simple request ไม่มี preflight) จึงต้อง JSON.parse เอง
 */
const unauthorized = () =>
  NextResponse.json({ error: "unauthorized" }, { status: 401, headers: SHOWCASE_CORS_HEADERS });

async function authorized(req: NextRequest): Promise<boolean> {
  const row = await prisma.scannerLink.findUnique({ where: { id: "singleton" } });
  return row !== null && tokensMatch(req.nextUrl.searchParams.get("token"), row.token);
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: SHOWCASE_CORS_HEADERS });
}

export async function GET(req: NextRequest) {
  if (!(await authorized(req))) return unauthorized();
  const [rows, lastBatch] = await Promise.all([
    prisma.productCandidate.findMany({
      where: { sourceProductId: { not: null } },
      select: { sourceProductId: true },
      distinct: ["sourceProductId"],
    }),
    prisma.candidateBatch.findFirst({
      where: { rows: { some: { sourceProductId: { not: null } } } },
      orderBy: { capturedOn: "desc" },
      select: { capturedOn: true },
    }),
  ]);
  return NextResponse.json(
    {
      protocol: SCANNER_PROTOCOL,
      productIds: rows.map((r) => r.sourceProductId).filter((id): id is string => id !== null),
      lastReceivedAt: lastBatch?.capturedOn.toISOString() ?? null,
    },
    { headers: SHOWCASE_CORS_HEADERS }
  );
}

export async function POST(req: NextRequest) {
  if (!(await authorized(req))) return unauthorized();
  let body: unknown;
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400, headers: SHOWCASE_CORS_HEADERS });
  }
  try {
    const result = await importShowcaseBatch(body);
    return NextResponse.json({ ok: true, ...result }, { headers: SHOWCASE_CORS_HEADERS });
  } catch (e) {
    const message = e instanceof Error ? e.message : "import failed";
    return NextResponse.json({ error: message }, { status: 400, headers: SHOWCASE_CORS_HEADERS });
  }
}
