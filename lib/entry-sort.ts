/** The subset of an entry this ordering depends on. */
export type SortableEntry = {
  postedAt: Date | null;
  createdAt: Date;
};

/**
 * Order for the history rail: undated entries first (unfinished work worth
 * seeing), then dated entries newest-first. `createdAt` breaks ties so the
 * order is deterministic.
 *
 * Sorted in JS rather than via Prisma `orderBy` because nulls-ordering is
 * unverified on this SQLite setup, and the row count is small enough that
 * the cost is irrelevant.
 */
export function sortEntriesForRail<T extends SortableEntry>(entries: T[]): T[] {
  return [...entries].sort((a, b) => {
    const aPosted = a.postedAt ? new Date(a.postedAt).getTime() : null;
    const bPosted = b.postedAt ? new Date(b.postedAt).getTime() : null;

    if (aPosted === null && bPosted !== null) return -1;
    if (aPosted !== null && bPosted === null) return 1;
    if (aPosted !== null && bPosted !== null && aPosted !== bPosted) {
      return bPosted - aPosted;
    }

    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}
