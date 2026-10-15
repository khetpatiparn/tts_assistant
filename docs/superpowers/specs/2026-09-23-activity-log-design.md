# Activity Log System — Design Spec

## Goal

Capture business-decision-level activity across `pooling_prompt` — user decisions, backend
(Gemini/Flow) system events, and a correlation layer against existing content-performance data —
so the data can be (1) browsed in a new UI page, (2) queried by Claude Code on request for
analysis, and (3) is typed strictly enough from day one to later feed a structured-decision model
(e.g. a "System 1" model like typesafe.ai's Jev) without a schema rework, should that ever become
worth pursuing. Point (3) is a design constraint on typing discipline only — no actual model
integration is in scope of this spec.

**Explicitly NOT a goal:** raw UI-click/telemetry logging (mouse coordinates, hover time, page
views). That data teaches UX friction, not decision-making, and isn't reconstructible into "what
was decided and why" — the actual thing worth capturing here.

## Why business-decision granularity, not click-level

This app already persists the *final* state of most decisions (`PromptEntry.chatgptOutput`,
`angle`, `productSpec`, `CorePrompt` versions, `FlowJob` attempts) but not the *sequence* that led
there — e.g. a user trying angle A, disliking the AI output, hand-editing the prompt, regenerating,
then switching to angle B leaves only the final state visible today. A business-decision-level log
with full context per event captures that path, which is both what a human analyst needs to see
*and* the shape of data a future automated-decision system would need to learn from — click
coordinates give neither.

## Data model

One new Prisma model:

```prisma
model ActivityLog {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
  category  String   // "user_action" | "system_event"
  eventType String   // discriminant — see the ActivityEvent union below
  entryId   String?  // FK-shaped (no relation enforced — PromptEntry rows can be deleted;
                      // see "Deleted entries" below) — the join key back to PromptEntry
  payload   String   // JSON.stringify of the typed ActivityEvent for this eventType

  @@index([category, eventType])
  @@index([entryId])
  @@index([createdAt])
}
```

`entryId` is **not** a Prisma relation field (no `@relation`, no `onDelete`) — deliberately, so
deleting a `PromptEntry` never cascades into deleting its own history; a log row survives its
entry being deleted, and readers must treat a dangling `entryId` as normal, not a foreign-key bug.

No `content_performance` category exists as stored rows — see "Content-performance correlation"
below; it is a query-time join over existing tables, not new storage.

## Typed event shapes (code-level, not enforced by the DB)

SQLite has no native enum/union type, so `payload` is a JSON string at rest, but every write goes
through one function that only accepts a closed TypeScript discriminated union — this is what
keeps the data structured enough to be Jev-compatible later, and is the single place that would
need to grow if a new event type is added:

```typescript
// lib/activity-log.ts
export type ActivityEvent =
  // -- user_action --
  | { eventType: "entry_created"; entryId: string; source: "manual" | "duplicate" | "candidate" | "order" }
  | { eventType: "entry_deleted"; entryId: string }
  | { eventType: "production_updated"; entryId: string; videoUrl: string | null; postedAt: string | null }
  | { eventType: "core_prompt_created"; kind: "core" | "caption"; corePromptId: string }
  | { eventType: "core_prompt_activated"; kind: "core" | "caption"; corePromptId: string }
  | { eventType: "angle_saved"; entryId: string; angle: string }
  | { eventType: "safe_mode_saved"; entryId: string; safeMode: boolean }
  | { eventType: "product_spec_saved"; entryId: string; manual: boolean } // manual=false → came from refreshProductSpec (AI)
  | { eventType: "ai_generate"; entryId: string; model: string; angle: string; corePromptId: string | null }
  | { eventType: "candidates_extracted"; batchId: string; addedCount: number; skippedCount: number }
  | { eventType: "showcase_imported"; batchId: string; addedCount: number; skippedCount: number; imagesFailed: number; via: "push" | "manual_upload" }
  | { eventType: "flow_job_enqueued"; jobId: string; entryId: string; round: 1 | 2 }
  | { eventType: "flow_candidate_chosen"; jobId: string; imageId: string }
  | { eventType: "flow_round_redone"; jobId: string }
  | { eventType: "flow_worker_resumed"; jobId: string }
  | { eventType: "flow_job_skipped"; jobId: string }
  | { eventType: "affiliate_orders_imported"; addedCount: number; updatedCount: number }
  | { eventType: "clip_metrics_imported"; addedCount: number }
  // -- system_event --
  | { eventType: "gemini_call"; entryId: string | null; step: "extract_spec" | "generate_prompt" | "generate_caption" | "suggest_angle" | "extract_candidates"; model: string; ok: boolean; latencyMs: number; error: string | null }
  | { eventType: "flow_job_step"; jobId: string; step: FlowStep; ok: boolean; errorKind: string | null };

export async function logActivity(event: ActivityEvent): Promise<void> {
  const category = event.eventType.startsWith("gemini_") || event.eventType === "flow_job_step" ? "system_event" : "user_action";
  const entryId = "entryId" in event ? event.entryId : null;
  await prisma.activityLog.create({ data: { category, eventType: event.eventType, entryId, payload: JSON.stringify(event) } });
}
```

(Exact field names above are a starting point for the implementation plan to refine against the
real call sites — the binding constraint is "closed union, no loose `Record<string, unknown>`
payload," not these exact 19 variants.)

## Where each event gets logged

All `user_action` and Gemini-related `system_event` writes happen from **`app/actions.ts`**,
alongside the existing Server Action that makes the decision — one `await logActivity(...)` call
per action, after the action's own DB writes succeed (never before — a logged event must reflect
something that actually happened). Concretely:

| Server Action (existing) | Event(s) to log |
|---|---|
| `createPrompt` | `entry_created` (source: "manual") |
| `duplicatePrompt` | `entry_created` (source: "duplicate") |
| `deletePrompt` | `entry_deleted` |
| `updateProduction` | `production_updated` |
| `createCorePrompt` | `core_prompt_created` |
| `setActiveCorePrompt` | `core_prompt_activated` |
| `saveAngle` | `angle_saved` |
| `saveSafeMode` | `safe_mode_saved` |
| `saveProductSpec` | `product_spec_saved` (manual: true) |
| `refreshProductSpec` | `product_spec_saved` (manual: false) + `gemini_call` (step: extract_spec) |
| `suggestAngles` | `gemini_call` (step: suggest_angle) |
| `generateWithAI` | `ai_generate` + `gemini_call` ×2 (generate_prompt, generate_caption — caption call logs even on its own internal failure, matching this action's existing "caption never throws" contract) |
| `extractCandidates` | `candidates_extracted` + `gemini_call` (step: extract_candidates) |
| `createEntryFromCandidate` / `createEntryFromCandidateWithImages` | `entry_created` (source: "candidate") |
| `importShowcaseBatch` / `importShowcaseFile` | `showcase_imported` |
| `enqueueFlowJob` / `createEntryFromCandidateWithImages`'s internal enqueue | `flow_job_enqueued` |
| `chooseFlowCandidate` | `flow_candidate_chosen` |
| `redoFlowRound` | `flow_round_redone` |
| `resumeFlowWorker` | `flow_worker_resumed` |
| `skipFlowJob` | `flow_job_skipped` |
| `createEntryFromOrder` | `entry_created` (source: "order") |
| `importAffiliateOrders` | `affiliate_orders_imported` |
| `importClipMetrics` | `clip_metrics_imported` |

**`worker/` writes `flow_job_step` directly via Prisma**, not through `logActivity` (the worker is
a separate Node process from Next, per existing architecture — it already writes `FlowJob`/
`FlowJobImage` rows directly today, this follows the same pattern). One row per entry in
`FLOW_STEPS` (`open-flow`, `ensure-project`, ..., `download-4`), written as each step's `await
step(...)` wrapper in `flow-driver.ts` completes or throws.

## Content-performance correlation (not new storage)

Views/orders/revenue already live in `AffiliateOrder` and `ClipMetric`, joined to entries via
`videoIdFromUrl`/`matchedEntryId` exactly as the existing dashboard does. The new piece is a query
function, `lib/activity-analysis.ts`, that joins `ActivityLog` rows (by `entryId`) against those
existing tables — e.g. "for this entry, what was the `angle_saved`/`ai_generate` event, and what
did the resulting clip earn." This is read-only aggregation, following the same "pure function,
hand-tested with a check script" pattern as `lib/dashboard.ts`/`lib/candidates.ts` — no new
tables, no new import path.

## UI

New route `/activity` (placeholder name — confirm during planning), following the existing
`app-header.tsx` navigation pattern used by `/`, `/dashboard`, `/core-prompt`. Scope for the first
version: a reverse-chronological table of `ActivityLog` rows, filterable by `category`/`eventType`/
`entryId`, rendering each row's `payload` as a compact one-line summary (event-type-specific
formatting, not raw JSON). No charts, no export, no `content_performance` correlation view in the
UI yet — that stays a query Claude Code runs on request, until a concrete recurring question
justifies building a dedicated view for it.

## Retention

No deletion policy. Volume at this app's real scale (a few dozen decisions/day) makes table growth
a non-issue for years; a retention policy would be premature complexity. Revisit only if `dev.db`
size actually becomes a problem in practice.

## Testing / verification

Per this repo's existing convention (no test runner): `lib/activity-log.ts`'s `logActivity`
itself needs no pure-logic test (it's a thin Prisma write, same class as other one-line DB writes
in `app/actions.ts` that aren't separately unit-tested). `lib/activity-analysis.ts`'s join/
aggregation logic **is** pure and gets a `scripts/check-activity-analysis.mjs` following the
`scripts/check-candidates.mjs`/`scripts/check-dashboard.mjs` pattern. End-to-end verification
(does clicking things actually produce the right rows) happens via the isolated-dev-server manual
pass, same as every other feature in this codebase.

## Global constraints (repeated from CLAUDE.md, binding on the implementation plan)

- No test runner in this repo — `npx tsc --noEmit` + `npm run lint` + hand-rolled check scripts
  are the verification bar.
- After the schema change: `npx prisma migrate dev --name <name>` then `npx prisma generate`.
- `worker/` is a separate Node process from Next — it writes to `dev.db` directly via its own
  Prisma client, never via a Server Action.
- Never run `npm run build`/`npm run dev` (unscoped) against the same `.next` as the user's
  `start.bat`; use `NEXT_DIST_DIR=.next-dev` + a copied `dev-test.db` for isolated testing.
- Thai-language UI copy; no arbitrary Tailwind sizes or hex colors in `components/*`; run
  `node scripts/check-contrast.mjs` if any new color is introduced.

## Open questions for the implementation plan (not blocking this spec)

- Exact final list/field-shape of the `ActivityEvent` union above should be re-verified against
  the live code of each Server Action at planning time, not assumed from this spec alone.
- Whether `generateWithAI`'s caption-call logging should log even when the whole action's caption
  step is a soft-fail (per this action's existing `captionError` contract) — spec's default is
  yes, log it either way, since a failed Gemini call is itself a real system event worth capturing.
