# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Custom Next.js version

`next` is pinned at `16.2.10`, well beyond any publicly released Next.js version, and ships its own docs bundle at `node_modules/next/dist/docs/` (a normal npm `next` package does not include this). Treat this as a modified/custom build with breaking API changes vs. training data. Before writing App Router code, check `node_modules/next/dist/docs/01-app/` for the current API — do not assume familiar Next.js conventions (routing, data fetching, config) still apply as-is.

## Commands

- `npm run dev` — start the dev server
- `npm run build` — production build
- `npm run start` — run the production build
- `npm run lint` — ESLint (flat config in `eslint.config.mjs`, extends `eslint-config-next` core-web-vitals + typescript rules)

No test runner is configured in this project.

## Architecture

- App Router under `app/` — currently just `layout.tsx`, `page.tsx`, `globals.css`; no nested routes yet.
- Path alias `@/*` resolves to the repo root (see `tsconfig.json`).
- Styling is Tailwind v4 with CSS-first config: there is no `tailwind.config.*` file — theme tokens (colors, radii, fonts, sidebar/chart variables) are defined via `@theme inline` and `:root`/`.dark` blocks directly in `app/globals.css`.
- shadcn/ui is configured via `components.json`: style `base-nova`, base color `neutral`, icon library `lucide-react`. **Components are built on `@base-ui/react` primitives, not Radix UI** — this differs from most shadcn/ui setups, so when generating or extending components, use Base UI's API/props rather than assuming Radix conventions.
- `lib/utils.ts` exports the standard shadcn `cn()` helper (`clsx` + `tailwind-merge`).
- `components/ui/` holds shadcn-generated primitives (currently only `button.tsx`).

## Product spec

`requirements/req1.md` (Thai) is the source-of-truth product spec and should be consulted directly for full detail — it is not yet reflected in any app code (`app/page.tsx` is still an empty scaffold). Summary: the app is a tool for generating structured AI video-generation prompts for TikTok Shop product videos (target generator: "Gemini Flow"), built from a "Core Prompt" input template (reference product images + store copy + a "Product Risk Module" + optional notes).

The generated output must follow a strict 10-part structure: Style, Scene, Subject, Product Accuracy, Action Timeline, Camera, Framing, Lighting/Color, Negative Prompt, Quick QA Checklist. Key content rules to preserve when working on prompt-generation logic:
- No on-screen text/subtitles/labels/UI overlays/prices in the generated video.
- Thai voiceover only, 3–5 short phrases, ~30–35 words max total, with a hook in the first 1–2 seconds and no dead air.
- Product must appear within 1–2 seconds with clear movement.
- 3–4 visual beats for higher-risk/mechanism products (e.g. foldable/expandable items), 4–5 beats for lower-risk products, sized for a 10-second clip.
- Liquid products (fabric softener, dish soap, etc.) should avoid showing liquid directly and instead use "package-led UGC" (package as hero, before/after style), since real liquid reference photos are usually unavailable.
