import { constants as fsConstants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  mcpErr,
  mcpOk,
  type SestinaMcpResult,
} from "../protocol-errors.js";

export interface ValidatedProjectStatePaths {
  readonly projectRoot: string;
  readonly stateDirectory: string;
  readonly databasePath: string;
}

function sameCanonicalPath(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.toLocaleLowerCase("en-US") === right.toLocaleLowerCase("en-US")
    : left === right;
}

export function canonicalPathWithin(canonicalRoot: string, canonicalTarget: string): boolean {
  const difference = relative(canonicalRoot, canonicalTarget);
  return difference === "" || (
    !isAbsolute(difference)
    && difference !== ".."
    && !difference.startsWith(`..${sep}`)
  );
}

async function readableDirectory(path: string): Promise<boolean> {
  const metadata = await stat(path);
  if (!metadata.isDirectory()) return false;
  await access(path, fsConstants.R_OK);
  return true;
}

async function readableRegularFile(path: string): Promise<boolean> {
  const metadata = await stat(path);
  if (!metadata.isFile()) return false;
  await access(path, fsConstants.R_OK);
  return true;
}

function isMissing(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "ENOENT";
}

export async function resolveProjectStatePaths(rawProjectRoot: string): Promise<SestinaMcpResult<ValidatedProjectStatePaths>> {
  if (typeof rawProjectRoot !== "string" || rawProjectRoot.trim().length === 0) {
    return mcpErr("missing_project_root");
  }
  if (!isAbsolute(rawProjectRoot)) return mcpErr("invalid_project_root");

  let projectRoot: string;
  try {
    projectRoot = await realpath(resolve(rawProjectRoot));
    if (!await readableDirectory(projectRoot)) return mcpErr("invalid_project_root");
  } catch {
    return mcpErr("invalid_project_root");
  }

  let stateDirectory: string;
  try {
    stateDirectory = await realpath(join(projectRoot, ".sestina"));
    if (!canonicalPathWithin(projectRoot, stateDirectory)) return mcpErr("project_state_unavailable");
    if (!await readableDirectory(stateDirectory)) return mcpErr("project_state_unavailable");
  } catch (error) {
    return mcpErr(isMissing(error) ? "project_not_initialized" : "project_state_unavailable");
  }

  let databasePath: string;
  try {
    databasePath = await realpath(join(stateDirectory, "state.sqlite"));
    if (
      !canonicalPathWithin(projectRoot, databasePath)
      || !canonicalPathWithin(stateDirectory, databasePath)
    ) return mcpErr("project_state_unavailable");
    if (!await readableRegularFile(databasePath)) return mcpErr("project_state_unavailable");
  } catch (error) {
    return mcpErr(isMissing(error) ? "project_not_initialized" : "project_state_unavailable");
  }

  return mcpOk(Object.freeze({ projectRoot, stateDirectory, databasePath }));
}

export async function revalidateProjectStateDatabase(
  paths: ValidatedProjectStatePaths,
): Promise<SestinaMcpResult<string>> {
  try {
    const stateDirectory = await realpath(paths.stateDirectory);
    const databasePath = await realpath(paths.databasePath);
    if (
      !sameCanonicalPath(stateDirectory, paths.stateDirectory)
      || !sameCanonicalPath(databasePath, paths.databasePath)
      || !canonicalPathWithin(paths.projectRoot, stateDirectory)
      || !canonicalPathWithin(paths.projectRoot, databasePath)
      || !canonicalPathWithin(stateDirectory, databasePath)
      || !await readableDirectory(stateDirectory)
      || !await readableRegularFile(databasePath)
    ) return mcpErr("project_state_unavailable");
    return mcpOk(databasePath);
  } catch {
    return mcpErr("project_state_unavailable");
  }
}
