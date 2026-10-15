/**
 * คลังรูป (Photo library, ศัพท์ใน CONTEXT.md) ของ entry — read model ล้วน ไม่มีตาราง/คอลัมน์ของตัวเอง:
 *   - รูปจากร้าน = รูปของแถว Showcase ที่ผูกกับ entry (ยุบซ้ำด้วย sourceProductId — shopPhotosForEntry ใน lib/showcase.ts)
 *   - รูปที่ Flow วาด = แถว candidate รอบ 1–2 ของทุกงาน ทุก attempt ของ entry (รวมที่ไม่ได้เลือก/วาดใหม่/ก่อนเปลี่ยนรูปต้นทาง) ใหม่ก่อน
 *   - ธงต่อรูป: เป็นรูปต้นทางตอนนี้ / อยู่ในรูปสินค้าแล้ว — ตัดสินจาก "เนื้อไฟล์ตรงกัน" (content key จาก lib/photo-library-db.ts)
 *     เพราะรูปสินค้าและรูปต้นทางเป็นสำเนาคนละชื่อไฟล์ (ไม่ครอป = ไฟล์ต้นฉบับทั้งไบต์ · ครอปแล้ว = รูปใหม่ ไม่ตรงรูปไหน)
 * ไฟล์ทั้งหมดเสิร์ฟผ่าน /api/uploads (path สัมพัทธ์ใต้ uploads/ ของ lib/upload-paths.ts)
 *
 * pure (client import ชนิดได้) — ตรวจด้วย scripts/check-flow-lifecycle.mjs · ส่วนอ่าน DB/ดิสก์อยู่ lib/photo-library-db.ts
 */
import { currentSourceImage } from "@/lib/flow-jobs";
import { CHANGE_SOURCE_BOT_BUSY_MESSAGE, CHANGE_SOURCE_REFUSED_MESSAGE, canChangeSource, isBotWorking } from "@/lib/flow-lifecycle";

export type LibraryPhoto = {
  /** "shop:<CandidateImage.id>" | "flow:<FlowJobImage.id>" */
  key: string;
  /** URL ที่เปิดได้ (/api/uploads/...) */
  src: string;
  filename: string;
  /** รูปที่ Flow วาด: "รอบ 1 · ครั้งที่ 2" · รูปจากร้าน: null */
  label: string | null;
  /** ผู้ใช้เลือกรูปนี้ที่ Checkpoint (ล้างเมื่อเปลี่ยนรูปต้นทาง) */
  chosen: boolean;
  isCurrentSource: boolean;
  inProductImages: boolean;
};

export type PhotoLibrary = {
  shopPhotos: LibraryPhoto[];
  flowImages: LibraryPhoto[];
  /** รูปต้นทางของงานล่าสุด — โชว์เสมอแม้ครอปแล้ว (ไม่ตรงรูปไหนในคลัง) · ไม่มีงาน = null */
  currentSource: { src: string } | null;
  /** "ใช้เป็นรูปต้นทางใหม่" ทำกับงานล่าสุดของ entry ตามกติกาเดียวกับ /flow (canChangeSource) · ไม่มีงาน = null (ไม่มีปุ่ม) */
  sourceChange: { jobId: string; allowed: boolean; reason: string | null } | null;
};

type JobImage = { id: string; kind: string; round: number; attempt: number; index: number; filename: string; chosen: boolean; createdAt: Date };
type Job = { id: string; status: string; round: number; createdAt: Date; images: JobImage[] };

export type PhotoLibraryInput = {
  entryId: string;
  shopPhotos: { id: string; candidateId: string; filename: string }[];
  jobs: Job[];
  productImageFilenames: string[];
  /** content key ของไฟล์ (path สัมพัทธ์ใต้ uploads/ คั่นด้วย "/") — key เท่ากัน = เนื้อไฟล์เดียวกัน · ไม่มี key = ไฟล์ไม่อยู่บนดิสก์ */
  contentKeys: Map<string, string>;
};

export const shopPhotoPath = (candidateId: string, filename: string) => `_candidates/${candidateId}/${filename}`;
export const flowImagePath = (entryId: string, filename: string) => `${entryId}/flow/${filename}`;
export const productImagePath = (entryId: string, filename: string) => `${entryId}/${filename}`;
const srcOf = (relPath: string) => `/api/uploads/${relPath}`;

function latestJob(jobs: Job[]): Job | null {
  return jobs.reduce<Job | null>((best, j) => (best === null || j.createdAt.getTime() > best.createdAt.getTime() ? j : best), null);
}

function flowCandidates(jobs: Job[]): JobImage[] {
  return jobs.flatMap((j) => j.images.filter((i) => i.kind === "candidate" && (i.round === 1 || i.round === 2)));
}

/** ไฟล์ที่ต้องอ่านเนื้อ: items = รูปในคลัง · targets = รูปต้นทางตอนนี้ + รูปสินค้า (ที่เทียบด้วย) */
export function libraryFilePaths(input: Omit<PhotoLibraryInput, "contentKeys">): { items: string[]; targets: string[] } {
  const latest = latestJob(input.jobs);
  const source = latest === null ? null : currentSourceImage(latest.images);
  return {
    items: [
      ...input.shopPhotos.map((p) => shopPhotoPath(p.candidateId, p.filename)),
      ...flowCandidates(input.jobs).map((i) => flowImagePath(input.entryId, i.filename)),
    ],
    targets: [
      ...(source === null ? [] : [flowImagePath(input.entryId, source.filename)]),
      ...input.productImageFilenames.map((f) => productImagePath(input.entryId, f)),
    ],
  };
}

export function buildPhotoLibrary(input: PhotoLibraryInput): PhotoLibrary {
  const { entryId, contentKeys } = input;
  const latest = latestJob(input.jobs);
  const source = latest === null ? null : currentSourceImage(latest.images);
  const sourcePath = source === null ? null : flowImagePath(entryId, source.filename);
  const sourceKey = sourcePath === null ? undefined : contentKeys.get(sourcePath);
  const productKeys = new Set(
    input.productImageFilenames.map((f) => contentKeys.get(productImagePath(entryId, f))).filter((k): k is string => k !== undefined),
  );
  const photo = (key: string, relPath: string, filename: string, label: string | null, chosen: boolean): LibraryPhoto | null => {
    const contentKey = contentKeys.get(relPath);
    if (contentKey === undefined) return null; // ไฟล์ไม่อยู่บนดิสก์ (งานเก่าที่ถูกเขียนทับ/ลบไปแล้ว) — คลังโชว์เฉพาะที่มีจริง
    return {
      key,
      src: srcOf(relPath),
      filename,
      label,
      chosen,
      isCurrentSource: sourceKey !== undefined && contentKey === sourceKey,
      inProductImages: productKeys.has(contentKey),
    };
  };

  const shopPhotos = input.shopPhotos
    .map((p) => photo(`shop:${p.id}`, shopPhotoPath(p.candidateId, p.filename), p.filename, null, false))
    .filter((p): p is LibraryPhoto => p !== null);

  // ใหม่ก่อน: ชุดที่วาดทีหลังขึ้นก่อน · ในชุดเดียวกันตาม index · แถวรุ่นเก่าที่ชื่อไฟล์ชนกัน (งานใหม่เคยเริ่ม a1 ซ้ำ) = ไฟล์เดียว โชว์ครั้งเดียว
  const seen = new Set<string>();
  const flowImages = flowCandidates(input.jobs)
    .sort(
      (a, b) =>
        b.createdAt.getTime() - a.createdAt.getTime() || b.round - a.round || b.attempt - a.attempt || a.index - b.index,
    )
    .filter((i) => (seen.has(i.filename) ? false : (seen.add(i.filename), true)))
    .map((i) => photo(`flow:${i.id}`, flowImagePath(entryId, i.filename), i.filename, `รอบ ${i.round} · ครั้งที่ ${i.attempt}`, i.chosen))
    .filter((p): p is LibraryPhoto => p !== null);

  return {
    shopPhotos,
    flowImages,
    currentSource: sourcePath === null ? null : { src: srcOf(sourcePath) },
    sourceChange:
      latest === null
        ? null
        : canChangeSource(latest.status, latest.round)
          ? { jobId: latest.id, allowed: true, reason: null }
          : {
              jobId: latest.id,
              allowed: false,
              reason: isBotWorking(latest.status) ? CHANGE_SOURCE_BOT_BUSY_MESSAGE : CHANGE_SOURCE_REFUSED_MESSAGE,
            },
  };
}
