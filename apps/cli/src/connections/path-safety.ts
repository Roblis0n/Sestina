import { access, lstat, realpath, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { findProjectRoot } from "../project-root.js";
import { CODEX_SKILL_RELATIVE_ROOT } from "./codex-skill.js";

export interface ConnectionPaths {
  readonly projectRoot: string;
  readonly configPath: string;
  readonly skillRoot: string;
  readonly skillPath: string;
  readonly metadataPath: string;
  readonly backupRoot: string;
}

export type ConnectionPathResult =
  | { readonly ok: true; readonly value: ConnectionPaths }
  | { readonly ok: false; readonly error: { readonly code: "project_not_initialized" | "state_conflict" | "infrastructure_failure" } };

function contained(root: string, target: string): boolean {
  const value = relative(root, target);
  return value.length === 0 || (value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value));
}

async function existingPrefixesContained(root: string, target: string): Promise<boolean> {
  const rel = relative(root, target);
  if (!contained(root, target)) return false;
  let cursor = root;
  for (const segment of rel.split(sep).filter((value) => value.length > 0)) {
    cursor = join(cursor, segment);
    try {
      await lstat(cursor);
      const canonical = await realpath(cursor);
      if (!contained(root, canonical)) return false;
    } catch {
      break;
    }
  }
  return true;
}

async function regularContainedFile(root: string, path: string): Promise<boolean> {
  try {
    const canonical = await realpath(path);
    return contained(root, canonical) && (await stat(canonical)).isFile();
  } catch {
    return false;
  }
}

export async function resolveConnectionPaths(projectOption: string | undefined, cwd: string): Promise<ConnectionPathResult> {
  const candidate = projectOption === undefined ? await findProjectRoot(cwd) : resolve(cwd, projectOption);
  if (candidate === undefined) return { ok: false, error: { code: "project_not_initialized" } };
  let projectRoot: string;
  try {
    projectRoot = await realpath(candidate);
    if (!(await stat(projectRoot)).isDirectory()) return { ok: false, error: { code: "project_not_initialized" } };
    await access(projectRoot, constants.R_OK | constants.W_OK);
  } catch {
    return { ok: false, error: { code: "project_not_initialized" } };
  }
  const databasePath = join(projectRoot, ".sestina", "state.sqlite");
  const briefPath = join(projectRoot, ".sestina", "research-brief.yaml");
  if (!(await regularContainedFile(projectRoot, databasePath)) || !(await regularContainedFile(projectRoot, briefPath))) {
    return { ok: false, error: { code: "project_not_initialized" } };
  }
  const skillRoot = join(projectRoot, ...CODEX_SKILL_RELATIVE_ROOT.split("/"));
  const paths: ConnectionPaths = {
    projectRoot,
    configPath: join(projectRoot, ".codex", "config.toml"),
    skillRoot,
    skillPath: join(skillRoot, "SKILL.md"),
    metadataPath: join(skillRoot, "agents", "openai.yaml"),
    backupRoot: join(projectRoot, ".sestina", "backups", "host-connections", "codex"),
  };
  for (const target of [paths.configPath, paths.skillPath, paths.metadataPath, paths.backupRoot]) {
    if (!(await existingPrefixesContained(projectRoot, target))) {
      return { ok: false, error: { code: "state_conflict" } };
    }
  }
  return { ok: true, value: paths };
}

export async function revalidateConnectionTargets(paths: ConnectionPaths): Promise<boolean> {
  for (const target of [paths.configPath, paths.skillPath, paths.metadataPath, paths.backupRoot]) {
    if (!(await existingPrefixesContained(paths.projectRoot, target))) return false;
  }
  return true;
}

export function parentDirectoriesForSkillCleanup(paths: ConnectionPaths): readonly string[] {
  return [dirname(paths.metadataPath), paths.skillRoot];
}
