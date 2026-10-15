import { notFound } from "next/navigation";

import { getEntryDetail, getEntryRows, getUsedAngles } from "@/lib/entry-queries";
import {
  getOpenFlowJobForEntry,
  getProductIdsByEntry,
  getRenderVideoForEntry,
  getRequiredHashtagsByEntry,
  getRequiredHashtagsForEntryIds,
  getTtsAudioForEntry,
} from "@/lib/flow-queries";
import { getPhotoLibrary } from "@/lib/photo-library-db";
import { EntryWorkspace } from "@/components/entry-workspace";

const RAIL_LIMIT = 15;

export const dynamic = "force-dynamic";

export default async function EntryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [entry, rows, usedAngles, flowJob, renderVideo, ttsAudio, productIds, photoLibrary] = await Promise.all([
    getEntryDetail(id),
    getEntryRows(),
    getUsedAngles(id),
    getOpenFlowJobForEntry(id),
    getRenderVideoForEntry(id),
    getTtsAudioForEntry(id),
    getProductIdsByEntry([id]),
    getPhotoLibrary(id),
  ]);

  if (entry === null) notFound();

  const requiredHashtags = (await getRequiredHashtagsByEntry(productIds)).get(id) ?? [];

  const index = rows.findIndex((r) => r.id === id);

  // 15 อันแรกตามลำดับของแถบข้าง (ยังไม่ลงคลิปบนสุด แล้วใหม่ไปเก่า) บวกตัวที่เปิดอยู่
  // ถ้ามันไม่ติด 15 อันแรก — ไม่งั้นผู้ใช้จะไม่เห็นว่าตัวเองอยู่ตรงไหน
  const recent = rows.slice(0, RAIL_LIMIT);
  const railBase =
    index >= 0 && index >= RAIL_LIMIT ? [...recent, rows[index]] : recent;
  const railHashtags = await getRequiredHashtagsForEntryIds(railBase.map((r) => r.id));
  const railRows = railBase.map((r) => ({ ...r, requiredHashtags: railHashtags.get(r.id) ?? [] }));

  return (
    <EntryWorkspace
      entry={entry}
      rows={railRows}
      usedAngles={usedAngles}
      flowJob={flowJob}
      renderVideo={renderVideo}
      ttsAudio={ttsAudio}
      productId={productIds.get(id) ?? null}
      requiredHashtags={requiredHashtags}
      photoLibrary={photoLibrary}
    />
  );
}
