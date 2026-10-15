import { getEntryRows } from "@/lib/entry-queries";
import { getRequiredHashtagsForEntryIds } from "@/lib/flow-queries";
import { EntryWorkspace } from "@/components/entry-workspace";

const RAIL_LIMIT = 15;

export const dynamic = "force-dynamic";

export default async function NewEntryPage() {
  const rail = (await getEntryRows()).slice(0, RAIL_LIMIT);
  const railHashtags = await getRequiredHashtagsForEntryIds(rail.map((r) => r.id));
  const rows = rail.map((r) => ({ ...r, requiredHashtags: railHashtags.get(r.id) ?? [] }));

  return (
    <EntryWorkspace
      entry={null}
      rows={rows}
      usedAngles={[]}
      flowJob={null}
    />
  );
}
