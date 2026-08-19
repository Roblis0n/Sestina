import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { openSestina, type CoreErrorCode, type SestinaCore } from "@sestina/core";
import { EXIT_CODES, exitCodeForCoreError, type CliExitCode } from "../exit-codes.js";
import { failure, success, type CliIo } from "../output.js";
import { ensureProjectRoot } from "../project-root.js";

export interface InitOptions { readonly project?: string; readonly title?: string; readonly yes: boolean; readonly json: boolean; }

const DATABASE_NAME = "state.sqlite";
const BRIEF_NAME = "research-brief.yaml";
const SUGGESTION_NAME = "gitignore-suggestion.txt";

function coreFailure(io: CliIo, json: boolean, code: CoreErrorCode): CliExitCode {
  const exit = exitCodeForCoreError(code);
  return failure(io, json, exit, code, code === "user_confirmation_required" ? "Explicit user confirmation is required." : "Local project initialization failed.");
}

function renderDraft(projectId: string, title: string): string {
  const safeTitle = JSON.stringify(title);
  return [
    "schemaVersion: 1",
    "status: draft",
    `projectId: ${projectId}`,
    `title: ${safeTitle}`,
    "projectQuestion: \"\"",
    "currentStage: revision",
    "currentTask: \"\"",
    "targetArtifacts: []",
    "fixedDecisions: []",
    "allowedChanges: []",
    "forbiddenChanges: []",
    "expectedDeltas: []",
    "evidenceBoundaries: []",
    "explicitNonGoals: []",
    "",
  ].join("\n");
}

async function directoryEntries(path: string): Promise<readonly string[] | undefined> {
  try { return await readdir(path); } catch { return undefined; }
}

async function validExistingState(stateDirectory: string): Promise<boolean> {
  try {
    return (await stat(join(stateDirectory, DATABASE_NAME))).isFile()
      && (await stat(join(stateDirectory, BRIEF_NAME))).isFile()
      && (await stat(join(stateDirectory, SUGGESTION_NAME))).isFile();
  } catch {
    return false;
  }
}

async function openExisting(stateDirectory: string, title: string): Promise<{ readonly core?: SestinaCore; readonly error?: CoreErrorCode }> {
  const opened = await openSestina({ databasePath: join(stateDirectory, DATABASE_NAME) });
  if (!opened.ok) return { error: opened.error.code };
  const projects = opened.value.listProjects();
  if (!projects.ok) { opened.value.close(); return { error: projects.error.code }; }
  if (projects.value.length !== 1 || projects.value[0]?.title !== title) { opened.value.close(); return { error: "state_conflict" }; }
  return { core: opened.value };
}

export async function runInit(options: InitOptions, io: CliIo): Promise<CliExitCode> {
  const rawProject = options.project ?? (io.isTTY ? io.cwd : undefined);
  const requestedTitle = options.title?.trim();
  const title = requestedTitle !== undefined && requestedTitle.length > 0 ? requestedTitle : (io.isTTY && rawProject ? basename(rawProject) : undefined);
  if (rawProject === undefined || title === undefined) return failure(io, options.json, EXIT_CODES.invalidInput, "invalid_input", "Non-interactive init requires --project and --title.");
  if (!options.yes) return failure(io, options.json, EXIT_CODES.userConfirmationRequired, "user_confirmation_required", "Pass --yes to confirm local project initialization.");
  const projectRoot = await ensureProjectRoot(rawProject, io.cwd);
  if (projectRoot === undefined) return failure(io, options.json, EXIT_CODES.infrastructureFailure, "infrastructure_failure", "The project directory is not readable and writable.");
  const stateDirectory = join(projectRoot, ".sestina");
  const existingEntries = await directoryEntries(stateDirectory);
  if (existingEntries !== undefined && existingEntries.length > 0) {
    if (!(await validExistingState(stateDirectory))) return failure(io, options.json, EXIT_CODES.stateConflict, "state_conflict", "A non-empty foreign .sestina directory was preserved.");
    const existing = await openExisting(stateDirectory, title);
    if (existing.error !== undefined) return coreFailure(io, options.json, existing.error);
    existing.core?.close();
    success(io, options.json, { command: "init", initialized: true, idempotent: true, projectRoot: ".", gitignoreSuggestion: ".sestina/" }, "Sestina is already initialized; no files were changed.");
    return EXIT_CODES.success;
  }

  const createdStateDirectory = existingEntries === undefined;
  let core: SestinaCore | undefined;
  try {
    await mkdir(stateDirectory, { recursive: true });
    const opened = await openSestina({ databasePath: join(stateDirectory, DATABASE_NAME) });
    if (!opened.ok) {
      if (createdStateDirectory) await rm(stateDirectory, { recursive: true, force: true }).catch(() => undefined);
      return coreFailure(io, options.json, opened.error.code);
    }
    core = opened.value;
    const project = core.initializeProject({ title, rootPath: ".", actor: { kind: "user", actorId: "cli-user" } });
    if (!project.ok) {
      core.close(); core = undefined;
      if (createdStateDirectory) await rm(stateDirectory, { recursive: true, force: true }).catch(() => undefined);
      return coreFailure(io, options.json, project.error.code);
    }
    await writeFile(join(stateDirectory, BRIEF_NAME), renderDraft(project.value.id, title), { encoding: "utf8", flag: "wx" });
    await writeFile(join(stateDirectory, SUGGESTION_NAME), ".sestina/\n", { encoding: "utf8", flag: "wx" });
    success(io, options.json, { command: "init", initialized: true, idempotent: false, projectRoot: ".", projectId: project.value.id, brief: `.sestina/${BRIEF_NAME}`, gitignoreSuggestion: ".sestina/" }, "Initialized local Sestina state. Add .sestina/ to .gitignore if appropriate.");
    return EXIT_CODES.success;
  } catch {
    if (createdStateDirectory) await rm(stateDirectory, { recursive: true, force: true }).catch(() => undefined);
    return failure(io, options.json, EXIT_CODES.infrastructureFailure, "infrastructure_failure", "Local project initialization failed.");
  } finally {
    core?.close();
  }
}
