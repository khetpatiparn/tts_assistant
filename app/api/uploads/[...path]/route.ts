import { readFile } from "node:fs/promises";
import path from "node:path";

const UPLOAD_ROOT = path.join(process.cwd(), "uploads");

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: segments } = await params;

  const target = path.join(UPLOAD_ROOT, ...segments);
  // Reject any path that escapes the upload root (e.g. via "..").
  if (!path.resolve(target).startsWith(path.resolve(UPLOAD_ROOT) + path.sep)) {
    return new Response("Not found", { status: 404 });
  }

  const mime = MIME_BY_EXT[path.extname(target).toLowerCase()];
  if (!mime) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const file = await readFile(target);
    return new Response(new Uint8Array(file), {
      headers: {
        "Content-Type": mime,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
