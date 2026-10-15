# Validation beyond offline checks

Use the repository's current AGENTS and subsystem guides. This reference routes to operations the offline helper does not run.

## DB integration

For the current checkout use `node scripts/sandbox.mjs prepare <name> [--entry <id>]` to snapshot SQLite/WAL and copy the selected entry's media, then `node scripts/sandbox.mjs start <name>` for the isolated app on 3051. Storage lives under `.scratch/sandboxes/<name>`. Other entries retain their DB rows but their media is not copied. Read `docs/sandbox.md` for limitations and the shell environment used by DB scripts. Do not fall back to production uploads for missing images.

`check-flow-lifecycle-db.ts`, `check-short-name-db.ts`, and `check-product-image-source-db.ts` create/update test rows. Inspect the selected script's arguments and guardrails first. Use the sandbox's `dev-test.db`, never production `dev.db`; set ANGLE_SANDBOX_ROOT and DATABASE_URL before importing Prisma. A copied DB without isolated roots is now rejected at startup. A different filename alone is not proof of a separate database (resolve absolute path and avoid hardlinks). With active WAL use SQLite backup, not an unsynchronized copy of DB/WAL/SHM.

DB separation does not separate files. Test actions can replace/delete images from shared uploads. Verify upload/candidate/config/export roots are temporary as well, or use fixtures that only touch their own temporary directory. If the current app lacks complete root overrides, use safe fixture-only script tests and report that full UI mutation testing is not isolated yet. Do not start a dev app and assume a copied DB makes arbitrary clicks safe.

## UI

Use `node scripts/sandbox.mjs start <name>`: it supplies port 3051, NEXT_DIST_DIR=.next-dev, isolated roots, and empty API keys. It never starts Flow; live browser entry points are blocked in sandbox mode. Do not touch .next or stop the user's 3050 server/Flow worker. One dist directory belongs to one running build/dev process.

The screenshot script currently defaults to old port 3001 and omits some newer routes. Explicitly set BASE_URL=http://localhost:3051, PW_ROOT to the repository root (Playwright is installed there), and ENTRY_ID to a real sandbox entry before `node scripts/shot.mjs <absolute-scratch-output>`. Inspect the current PAGES list and check omitted affected routes separately, especially Showcase/TTS. A screenshot script pass does not prove pages outside its list or workflows it never clicks. Check 390/820/1440px; below 1024px use hasTouch=true. Inspect the 1440px result, not only the process exit code.

## Extension

The standalone `showcase-extension` has its own TypeScript/Vitest dependencies. Inspect its package.json and scripts, then run `npm run typecheck` and `npm test` from that directory when extension code changes. `npm run test:e2e` builds mock artifacts; it is not an app-level pure check. Protocol changes require sender, receiver and integration guide updates together. Do not package or install the extension for a backend-only change.

## Build and production

Full build only at handoff/merge when port3050 is free, per AGENTS. If occupied, finish permitted checks and explain that the repository requires the user to stop their own process before the production build. Never kill it. Review tsconfig diff after Next runs, preserving user edits. Production migration/generation/deployment must follow the user's AGENTS procedure; this skill grants no deployment authority.

## Live Flow and APIs

Offline checks never open Chrome or spend Gemini/Flow credits. Before a task that needs a real smoke run, determine current user authorization, budget and session/profile exclusivity from task context. The production browser profile cannot be shared with another running browser. Prefer fixtures for regression tests. A live test requiring the user to stop their bot must be arranged explicitly rather than interrupting income-producing work. Do not test captcha/ban recovery by repeatedly sending real requests.
