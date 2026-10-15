---
name: angle-checks
description: Select and run existing offline verification scripts for the Angle TikTok affiliate app after code changes or when asked to check it. Covers the app's Flow lifecycle, prompts, Showcase, dashboard, media export, and theme checks; use the separate workflow for database, UI, or live-browser validation.
---

# Angle checks

Use this in an Angle repository (`package.json` name `pooling_prompt`, `prisma/schema.prisma`, and its `AGENTS.md`). Resolve the root from the current workspace, not a remembered absolute checkout. If it is another project, do not apply these commands there.

Read the repository's current `AGENTS.md` and the subsystem guide it names before choosing checks. They are authoritative for production coexistence and domain rules. Preserve existing user changes.

## Routine offline checks

Use the maintained helper in the repo, not copied shell chains:

```text
node scripts/agent-checks.mjs --area flow
node scripts/agent-checks.mjs --area flow --run
```

The first command prints a plan; the second runs it. Areas: `baseline`, `flow`, `media`, `prompt`, `showcase`, `dashboard`, `theme`, `ui`, `sandbox`. Combine areas with commas; `all` is for an explicitly broad verification request. Type/lint run once in every plan. If the helper is unavailable in another checkout, inspect package.json and the relevant script before executing the equivalent commands; do not silently install packages or create another helper.

Choose from the actual change:

| Change | Area |
|---|---|
| Flow lifecycle, worker, attachments, activity | flow |
| TTS/merge/export or media-readiness integration | media; add flow when lifecycle changes |
| Prompt composition or voiceover extraction/claims | prompt |
| Scanner receiver, candidate or Showcase logic, required tags | showcase |
| Revenue aggregation, import view, recommender | dashboard |
| Color tokens | theme |
| Layout, clipboard, date labels | ui; add theme if colors change |
| Small unrelated app logic | baseline + a meaningful focused check if available |
| Runtime paths, sandbox preparation or storage isolation | sandbox (synthetic SQLite/files only) |

These are existing checks, not coverage guarantees: `prompt` currently exercises claim parsing, and `media` covers claims/export, not real Gemini synthesis, FFmpeg output, model behavior, or every prompt invariant. Add a targeted regression check for newly changed behavior when needed. Report gaps instead of saying end-to-end passed.

For the helper itself run `node scripts/check-agent-checks.mjs`, plus ESLint on changed helper files. No reason to rerun every application test for a documentation-only change.

## Other verification modes

Read [references/isolated-validation.md](references/isolated-validation.md) only when DB integration, screenshots, extension work, a build, or a live Flow/API test is needed. The routine helper deliberately excludes those operations.

After execution report selected areas, pass/fail, and what was not verified. On failure inspect it, distinguish existing failures from this change, and rerun only the affected checks after a relevant fix. Never call a planned command a passing check.
