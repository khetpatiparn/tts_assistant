import { getEntryRows, getSearchText } from "@/lib/entry-queries";
import {
  paginate,
  parsePageParam,
  parseStatusParam,
  searchAndFilter,
} from "@/lib/entry-rows";
import { AppHeader } from "@/components/app-header";
import { EntryList } from "@/components/entry-list";

export default async function EntryListPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const query = (Array.isArray(sp.q) ? sp.q[0] : sp.q) ?? "";
  const status = parseStatusParam(sp.status);
  const page = parsePageParam(sp.page);

  const rows = await getEntryRows();

  // อ่านข้อความเฉพาะตอนที่ต้องค้นจริง — ไม่มีคำค้นก็ไม่ต้องแตะ productInfo เลย
  const searchText = query.trim() === "" ? null : await getSearchText();
  const searchable = rows.map((r) => ({
    ...r,
    productName: r.productName,
    productInfo: searchText?.get(r.id)?.productInfo ?? "",
    extraNotes: searchText?.get(r.id)?.extraNotes ?? "",
  }));

  const filtered = searchAndFilter(searchable, { query, status });
  const { items, totalPages, page: safePage } = paginate(filtered, page);

  return (
    <div className="flex min-h-screen flex-1 flex-col lg:h-screen lg:overflow-hidden">
      <AppHeader active="list" />
      <div className="flex flex-1 flex-col p-4 sm:p-6 lg:overflow-y-auto">
        <EntryList
          rows={items.map((r) => ({
            id: r.id,
            productName: r.productName,
            angle: r.angle,
            videoUrl: r.videoUrl,
            postedAt: r.postedAt,
            createdAt: r.createdAt,
            duplicatedFromId: r.duplicatedFromId,
            status: r.status,
            thumbnailFilename: r.thumbnailFilename,
            postedTimeOfDay: r.postedTimeOfDay,
            postedTimeSource: r.postedTimeSource,
            isScheduledPost: r.isScheduledPost,
          }))}
          query={query}
          status={status}
          page={safePage}
          totalPages={totalPages}
          matchCount={filtered.length}
          total={rows.length}
        />
      </div>
    </div>
  );
}
