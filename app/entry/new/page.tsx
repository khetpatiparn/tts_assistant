import { getDefaultScheduled, getEntryRows } from "@/lib/entry-queries";
import { EntryWorkspace } from "@/components/entry-workspace";

const RAIL_LIMIT = 15;

export default async function NewEntryPage() {
  const [rows, defaultScheduled] = await Promise.all([
    getEntryRows(),
    getDefaultScheduled(),
  ]);

  return (
    <EntryWorkspace
      entry={null}
      rows={rows.slice(0, RAIL_LIMIT)}
      takeNumber={rows.length + 1}
      usedAngles={[]}
      defaultScheduled={defaultScheduled}
    />
  );
}
