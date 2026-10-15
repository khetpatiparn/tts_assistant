/** Plan/run the repository's existing offline checks; never starts the app or a worker. */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const AREAS = ["baseline", "flow", "media", "prompt", "showcase", "dashboard", "theme", "ui", "sandbox"];
const FLOW_OFFLINE_CHECKS = new Set([
  "check-flow-worker-pure", "check-flow-jobs", "check-flow-lifecycle", "check-product-image-source",
  "check-flow-activity", "check-flow-activity-hooks", "check-claims", "check-clip-export", "check-clip-export-fs",
]);

function parseArgs(args) {
  const options = { areas: ["baseline"], run: false, json: false, help: false };
  let sawArea = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--area") {
      if (sawArea) throw new Error("Use one --area with comma-separated areas.");
      sawArea = true;
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error("--area needs a value.");
      const names = value.split(",");
      if (names.some((name) => !AREAS.includes(name) && name !== "all")) {
        throw new Error(`Unknown area. Choose: ${AREAS.join(", ")}, all`);
      }
      if (names.includes("all") && names.length !== 1) throw new Error("Use all on its own.");
      options.areas = names[0] === "all" ? [...AREAS] : [...new Set(names)];
    } else if (arg === "--run") options.run = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.run && options.json) throw new Error("--json is for planning only; remove --run.");
  return options;
}

export function createPlan(args, root = REPO_ROOT) {
  const options = parseArgs(args);
  if (options.help) return { ...options, root, tasks: [] };
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  if (pkg.name !== "pooling_prompt" || !existsSync(path.join(root, "prisma", "schema.prisma"))) {
    throw new Error("This helper belongs to the Angle app repository.");
  }

  const tasks = [];
  const add = (id, entrypoint, args = []) => {
    if (tasks.some((task) => task.id === id)) return;
    tasks.push({ id, entrypoint, args, cwd: root });
  };
  const script = (name) => add(name, `scripts/${name}.mjs`);
  // Resolve local binaries without npx downloads, .cmd quoting, or shell interpolation.
  add("typecheck", "node_modules/typescript/bin/tsc", ["--noEmit", "--incremental", "false"]);
  add("lint", "node_modules/eslint/bin/eslint.js", ["."]);

  for (const area of options.areas) {
    if (area === "flow") {
      // Keep the maintained package.json list authoritative. Reject unexpected commands.
      const flowCommands = pkg.scripts?.["check:flow"]?.split(/\s*&&\s*/);
      if (!flowCommands?.length) throw new Error("Missing check:flow in package.json.");
      for (const command of flowCommands) {
        const match = /^node scripts\/(check-[a-z0-9-]+)\.mjs$/.exec(command);
        if (!match || !FLOW_OFFLINE_CHECKS.has(match[1])) {
          throw new Error("check:flow contains an unsupported command; review its offline safety first.");
        }
        script(match[1]);
      }
    }
    if (area === "media") {
      ["check-claims", "check-clip-export", "check-clip-export-fs"].forEach(script);
    }
    if (area === "prompt") script("check-claims");
    if (area === "showcase") {
      ["check-candidates", "check-showcase", "check-showcase-import", "check-scanner-link", "check-required-hashtag"].forEach(script);
    }
    if (area === "dashboard") {
      script("check-recommender");
      script("check-date-filter-label");
      add("check-dashboard-view", "node_modules/tsx/dist/cli.mjs", ["scripts/check-dashboard-view.ts"]);
    }
    if (area === "theme") script("check-contrast");
    if (area === "sandbox") script("check-sandbox");
    if (area === "ui") ["check-clipboard", "check-date-filter-label"].forEach(script);
  }
  return { ...options, root, tasks };
}

export function runPlan(plan, execute = spawnSync) {
  // Preflight the entire list to avoid a half-run caused by missing local dependencies.
  for (const task of plan.tasks) {
    if (!existsSync(path.join(plan.root, task.entrypoint))) {
      throw new Error(`Missing ${task.entrypoint}; install the repository dependencies or review the check list.`);
    }
  }
  for (const task of plan.tasks) {
    console.log(`\n[${task.id}]`);
    const result = execute(process.execPath, [path.join(plan.root, task.entrypoint), ...task.args], {
      cwd: plan.root,
      stdio: "inherit",
      shell: false,
    });
    if (result.error) throw new Error(`${task.id}: ${result.error.message}`);
    if (result.status !== 0) {
      console.error(`Stopped at ${task.id}; later checks were not run.`);
      return Number.isInteger(result.status) && result.status > 0 ? result.status : 1;
    }
  }
  console.log("\nSelected checks passed. This does not prove UI, live API, DB migration, or end-to-end UAT.");
  return 0;
}

function main() {
  try {
    const plan = createPlan(process.argv.slice(2));
    if (plan.help) {
      console.log("node scripts/agent-checks.mjs [--area baseline|flow|media|prompt|showcase|dashboard|theme|ui|sandbox|all] [--run | --json]");
      console.log("Comma-separated areas are supported. Default: plan baseline only. No build, user DB tests, servers, live Flow, or APIs.");
      return;
    }
    if (plan.json) console.log(JSON.stringify(plan, null, 2));
    else if (plan.run) process.exitCode = runPlan(plan);
    else {
      console.log(`Plan only — ${plan.areas.join(", ")}`);
      for (const task of plan.tasks) console.log(`  node ${task.entrypoint} ${task.args.join(" ")}`.trimEnd());
      console.log("Add --run to execute. These checks do not verify runtime TTS or a live user workflow.");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
