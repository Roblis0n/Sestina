import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { openSestina, type CoreErrorCode, type SestinaCore } from "@sestina/core";
import { EXIT_CODES, exitCodeForCoreError, type CliExitCode } from "./exit-codes.js";
import type { CliIo } from "./output.js";
import { findProjectRoot } from "./project-root.js";

export interface OpenedLocalProject {
  readonly root: string;
  readonly stateDirectory: string;
  readonly briefPath: string;
  readonly project: { readonly id: string; readonly title: string };
  readonly core: SestinaCore;
}

export type LocalProjectResult =
  | { readonly ok: true; readonly value: OpenedLocalProject }
  | { readonly ok: false; readonly exitCode: CliExitCode; readonly errorCode: string; readonly message: string };

async function isFile(path: string): Promise<boolean> {
  try { return (await stat(path)).isFile(); } catch { return false; }
}

export function commandExitCode(code: CoreErrorCode): CliExitCode {
  return code === "not_found" ? EXIT_CODES.stateConflict : exitCodeForCoreError(code);
}

export async function openLocalProject(projectOption: string | undefined, io: CliIo): Promise<LocalProjectResult> {
  const root = projectOption === undefined ? await findProjectRoot(io.cwd) : resolve(io.cwd, projectOption);
  if (root === undefined) return { ok: false, exitCode: EXIT_CODES.projectNotInitialized, errorCode: "project_not_initialized", message: "The project is not initialized." };
  const stateDirectory = join(root, ".sestina");
  const databasePath = join(stateDirectory, "state.sqlite");
  const briefPath = join(stateDirectory, "research-brief.yaml");
  if (!(await isFile(databasePath)) || !(await isFile(briefPath))) return { ok: false, exitCode: EXIT_CODES.projectNotInitialized, errorCode: "project_not_initialized", message: "The project is not initialized." };
  const opened = await openSestina({ databasePath });
  if (!opened.ok) return { ok: false, exitCode: exitCodeForCoreError(opened.error.code), errorCode: opened.error.code, message: "Local project state is unavailable." };
  const projects = opened.value.listProjects();
  if (!projects.ok || projects.value.length !== 1 || projects.value[0] === undefined) {
    opened.value.close();
    const code = projects.ok ? "state_conflict" : projects.error.code;
    return { ok: false, exitCode: projects.ok ? EXIT_CODES.stateConflict : commandExitCode(projects.error.code), errorCode: code, message: "The local project binding is inconsistent." };
  }
  const project = projects.value[0];
  return { ok: true, value: { root, stateDirectory, briefPath, project: { id: project.id, title: project.title }, core: opened.value } };
}
