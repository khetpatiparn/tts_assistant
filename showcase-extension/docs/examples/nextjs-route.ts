// Showcase Scanner destination — Next.js App Router route handler (protocol showcase-scanner/1)
//
// Save as app/api/scanner/route.ts. Destination link: https://<your-host>/api/scanner?token=<SCANNER_TOKEN>
// Set SCANNER_TOKEN in .env (random, >= 32 bytes, e.g. `openssl rand -hex 32`). Changing it invalidates the old link.
// The storage below is an in-memory Map so this file is self-contained; swap the three storage
// functions for your database (they are the only part you need to change).
import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

const PROTOCOL = "showcase-scanner/1";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
} as const;

type StoredProduct = {
  productId: string;
  title: string;
  priceDisplay: string | null;
  commissionPercent: number | null;
  shopName: string | null;
  categoryLabel: string | null;
  imageUrls: string[];
  receivedAt: string;
};

// ---- storage stubs (replace with your database) ----
const store = new Map<string, StoredProduct>();
let lastReceivedAt: string | null = null;

async function saveProducts(items: StoredProduct[]): Promise<void> {
  for (const item of items) store.set(item.productId, item); // upsert by productId
  lastReceivedAt = new Date().toISOString();
}
async function listProductIds(): Promise<string[]> {
  return [...store.keys()];
}
async function getLastReceivedAt(): Promise<string | null> {
  return lastReceivedAt;
}
// ----------------------------------------------------

// commissionRate is number | string | null, in hundredths of a percent (1200 = 12%).
function commissionPercent(raw: unknown): number | null {
  const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
  return typeof n === "number" && Number.isFinite(n) ? n / 100 : null;
}

function authorized(req: NextRequest): boolean {
  const expected = process.env.SCANNER_TOKEN ?? "";
  const given = req.nextUrl.searchParams.get("token");
  if (expected.length < 32 || given === null) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const unauthorized = () => NextResponse.json({ error: "unauthorized" }, { status: 401, headers: CORS });

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return unauthorized();
  return NextResponse.json(
    { protocol: PROTOCOL, productIds: await listProductIds(), lastReceivedAt: await getLastReceivedAt() },
    { headers: CORS },
  );
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return unauthorized();
  let body: unknown;
  try {
    // The extension sends text/plain, so req.json() is not appropriate: parse the raw text.
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400, headers: CORS });
  }
  const list = (body as { products?: unknown } | null)?.products;
  if (!Array.isArray(list)) {
    return NextResponse.json({ error: "products must be an array" }, { status: 400, headers: CORS });
  }
  const now = new Date().toISOString();
  const items: StoredProduct[] = [];
  let skipped = 0;
  for (const raw of list as Array<Record<string, unknown> | null>) {
    // productId is a digit string longer than 2^53: keep it a string.
    if (!raw || typeof raw.productId !== "string" || raw.productId === "" || raw.hasStatusPopup === true) {
      skipped++;
      continue;
    }
    items.push({
      productId: raw.productId,
      title: typeof raw.title === "string" ? raw.title : "",
      priceDisplay: typeof raw.priceDisplay === "string" ? raw.priceDisplay : null,
      commissionPercent: commissionPercent(raw.commissionRate), // 1200 -> 12 (%)
      shopName: typeof raw.shopName === "string" ? raw.shopName : null,
      categoryLabel: typeof raw.categoryLabel === "string" ? raw.categoryLabel : null,
      imageUrls: Array.isArray(raw.imageUrls) ? raw.imageUrls.filter((u): u is string => typeof u === "string") : [],
      receivedAt: now,
    });
  }
  await saveProducts(items);
  return NextResponse.json({ ok: true, saved: items.length, skipped }, { headers: CORS });
}
