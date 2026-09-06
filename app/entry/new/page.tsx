import { getEntryRows } from "@/lib/entry-queries";
import { EntryWorkspace } from "@/components/entry-workspace";

const RAIL_LIMIT = 15;

export const dynamic = "force-dynamic";

export default async function NewEntryPage() {
  const rows = await getEntryRows();

  return (
    <EntryWorkspace
      entry={null}
      rows={rows.slice(0, RAIL_LIMIT)}
      usedAngles={[]}
      flowJob={null}
    />
  );
}
