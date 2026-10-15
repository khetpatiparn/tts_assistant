/** Offline behavioral checks for the safe check planner/runner; no app/DB/API calls. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPlan, runPlan, REPO_ROOT, AREAS } from "./agent-checks.mjs";

const baseline = createPlan([]);
assert.deepEqual(baseline.tasks.map((task) => task.id), ["typecheck", "lint"]);
assert.equal(baseline.run, false);
const all = createPlan(["--area", "all"]);
assert.equal(new Set(all.tasks.map((task) => task.id)).size, all.tasks.length);
for (const area of AREAS) {
  const plan = createPlan(["--area", area]);
  assert.deepEqual(plan.tasks.slice(0, 2).map((task) => task.id), ["typecheck", "lint"]);
  for (const task of plan.tasks) {
    assert.equal(task.cwd, REPO_ROOT);
    assert.ok(existsSync(path.join(REPO_ROOT, task.entrypoint)), task.entrypoint);
    assert.ok(!/migrate|smoke|worker\/index|next\/dist|backfill|upgrade-showcase/.test(task.entrypoint));
  }
}
assert.ok(createPlan(["--area", "theme"]).tasks.some((task) => task.id === "check-contrast"));
assert.ok(createPlan(["--area", "flow"]).tasks.some((task) => task.id === "check-flow-lifecycle"));
assert.equal(createPlan(["--area", "media,flow"]).tasks.filter((task) => task.id === "check-claims").length, 1);
for (const args of [["--area", "build"], ["--area"], ["--area", "all,flow"], ["--fix"], ["--run", "--json"], ["--area", "flow;echo secret"]]) {
  assert.throws(() => createPlan(args));
}

const cli = spawnSync(process.execPath, [path.join(REPO_ROOT, "scripts/agent-checks.mjs"), "--area", "theme", "--json"], { encoding: "utf8", shell: false });
assert.equal(cli.status, 0, cli.stderr);
assert.equal(JSON.parse(cli.stdout).run, false); // Pure JSON proves no child check output ran.
const bad = spawnSync(process.execPath, [path.join(REPO_ROOT, "scripts/agent-checks.mjs"), "--area", "build", "--run"], { encoding: "utf8", shell: false });
assert.equal(bad.status, 1);
assert.equal(bad.stdout, "");

// Validate execution with stubbed child processes, including fail-fast and missing binaries.
let calls = 0;
assert.equal(runPlan(baseline, (_bin, _args, options) => {
  calls++;
  assert.equal(options.shell, false);
  return { status: 7 };
}), 7);
assert.equal(calls, 1);
calls = 0;
assert.equal(runPlan(baseline, () => { calls++; return { status: 0 }; }), 0);
assert.equal(calls, 2);

const scratch = mkdtempSync(path.join(os.tmpdir(), "angle-check-planner-"));
try {
  mkdirSync(path.join(scratch, "prisma"));
  writeFileSync(path.join(scratch, "prisma/schema.prisma"), "");
  writeFileSync(path.join(scratch, "package.json"), JSON.stringify({ name: "pooling_prompt", scripts: { "check:flow": "node scripts/check-flow-jobs.mjs && node worker/index.ts" } }));
  assert.throws(() => createPlan(["--area", "flow"], scratch), /unsupported command/);
  writeFileSync(path.join(scratch, "package.json"), JSON.stringify({ name: "pooling_prompt", scripts: { "check:flow": "node scripts/check-live-database.mjs" } }));
  assert.throws(() => createPlan(["--area", "flow"], scratch), /unsupported command/);
  assert.throws(() => runPlan(createPlan([], scratch), () => { throw new Error("must not execute"); }), /Missing node_modules/);
} finally {
  assert.equal(path.dirname(path.resolve(scratch)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(scratch).startsWith("angle-check-planner-"));
  rmSync(scratch, { recursive: true, force: true });
}
console.log("PASS agent check planner: area routing, deduplication, dry-run, invalid input, allowlist, local binaries, fail-fast.");
