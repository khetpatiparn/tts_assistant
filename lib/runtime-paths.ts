import { existsSync, lstatSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";

type Environment = Record<string, string | undefined>;

export type RuntimePaths = {
  sandboxRoot: string | null;
  databasePath: string;
  databaseUrl: string;
  uploadRoot: string;
  settingsFile: string;
  workerConfigFile: string;
  profileDir: string;
  stopFile: string;
  exportRoot: string;
  backupRoot: string;
};

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

/** Resolve links in existing ancestors too, including paths that do not exist yet. */
function physicalPath(target: string): string {
  try {
    lstatSync(target); // Unlike existsSync, catches dangling symlinks too.
    return realpathSync.native(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    // A dangling symlink must not become a seemingly safe not-yet-created path.
    try {
      if (lstatSync(target).isSymbolicLink()) throw new Error("Sandbox paths cannot use dangling symlinks.");
    } catch (linkError) {
      if ((linkError as NodeJS.ErrnoException).code !== "ENOENT") throw linkError;
    }
  }
  const parent = path.dirname(target);
  return parent === target ? target : path.join(physicalPath(parent), path.basename(target));
}

function assertPrivatePath(root: string, target: string, label: string): void {
  if (!inside(root, target) || !inside(physicalPath(root), physicalPath(target))) {
    throw new Error(`Sandbox: ${label} must stay inside ANGLE_SANDBOX_ROOT.`);
  }
  // Reject junctions/symlinks even if they currently point within the sandbox.
  let current = target;
  while (current !== path.dirname(root)) {
    if (existsSync(current)) {
      const info = lstatSync(current);
      if (info.isSymbolicLink() || (info.isFile() && info.nlink > 1)) {
        throw new Error(`Sandbox: ${label} cannot use symlinks, junctions, or hardlinked files.`);
      }
    }
    if (current === root) break;
    current = path.dirname(current);
  }
}

/** Server/CLI only. No directories or databases are created by resolving paths. */
export function resolveRuntimePaths(
  env: Environment = process.env,
  cwd = process.cwd(),
  home = os.homedir(),
): RuntimePaths {
  const repo = path.resolve(cwd);
  const sandboxRoot = env.ANGLE_SANDBOX_ROOT ? path.resolve(repo, env.ANGLE_SANDBOX_ROOT) : null;
  const base = sandboxRoot ?? repo;
  const productionDb = path.join(repo, "dev.db");
  const rawDb = env.DATABASE_URL ?? `file:${path.join(base, sandboxRoot ? "dev-test.db" : "dev.db")}`;
  if (!rawDb.startsWith("file:") || rawDb.includes("?") || rawDb.includes("#")) {
    throw new Error("Angle requires a SQLite file: DATABASE_URL without query parameters.");
  }
  const databasePath = path.resolve(repo, rawDb.slice(5));
  const choose = (key: string, fallback: string) => path.resolve(repo, env[key] ?? fallback);
  const result: RuntimePaths = {
    sandboxRoot,
    databasePath,
    databaseUrl: `file:${databasePath}`,
    uploadRoot: choose("ANGLE_UPLOAD_ROOT", path.join(base, "uploads")),
    settingsFile: choose("ANGLE_SETTINGS_FILE", path.join(base, "tts-settings.json")),
    workerConfigFile: choose("ANGLE_WORKER_CONFIG", path.join(base, "flow-worker.config.json")),
    profileDir: choose("ANGLE_FLOW_PROFILE", path.join(base, ".flow-profile")),
    stopFile: choose("ANGLE_STOP_FILE", path.join(base, ".flow-worker.stop")),
    exportRoot: choose("CLIP_EXPORT_ROOT", sandboxRoot ? path.join(base, "exports") : path.join(home, "Desktop", "TTS")),
    backupRoot: choose("ANGLE_BACKUP_ROOT", path.join(base, "backups")),
  };
  if (!sandboxRoot) {
    if (physicalPath(databasePath) !== physicalPath(productionDb)) {
      throw new Error("Test database requires ANGLE_SANDBOX_ROOT; a copied DB alone still shares production files. Use scripts/sandbox.mjs.");
    }
    return result;
  }
  const allowed = path.join(repo, ".scratch", "sandboxes");
  if (!inside(allowed, sandboxRoot) || physicalPath(sandboxRoot) !== sandboxRoot) {
    throw new Error("ANGLE_SANDBOX_ROOT must be a real directory under .scratch/sandboxes, without junctions or symlinks.");
  }
  for (const [label, target] of Object.entries(result)) {
    if (label !== "sandboxRoot" && label !== "databaseUrl" && target !== null) assertPrivatePath(sandboxRoot, target, label);
  }
  return result;
}

export function getRuntimePaths(): RuntimePaths {
  return resolveRuntimePaths(process.env, /* turbopackIgnore: true */ process.cwd());
}

export function assertLiveFlowAllowed(): void {
  if (getRuntimePaths().sandboxRoot) {
    throw new Error("Sandbox: live Flow/browser is disabled. Use offline fixtures; the production browser profile is not shared.");
  }
}
