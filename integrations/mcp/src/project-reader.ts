import { constants as fsConstants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import {
  openSestina,
  type CoreBriefState,
  type SestinaCore,
} from "@sestina/core";
import {
  mcpErr,
  mcpOk,
  type SestinaMcpResult,
} from "./protocol-errors.js";

export const DEFAULT_OUTPUT_LIMIT_BYTES = 32_768;
export const DEFAULT_QUERY_TIMEOUT_MS = 2_000;
export const MIN_OUTPUT_LIMIT_BYTES = 1_024;
export const MAX_OUTPUT_LIMIT_BYTES = 65_536;
export const MIN_QUERY_TIMEOUT_MS = 1;
export const MAX_QUERY_TIMEOUT_MS = 10_000;

export interface ResearchContextPayload {
  readonly schemaVersion: "1.0";
  readonly briefId: string;
  readonly versionId: string;
  readonly version: number;
  readonly recordVersion: number;
  readonly projectQuestion: string;
  readonly currentStage: string;
  readonly currentTask: string;
  readonly targetArtifacts: readonly string[];
  readonly fixedDecisions: CoreBriefState["version"]["fixedDecisions"];
  readonly allowedChanges: CoreBriefState["version"]["allowedChanges"];
  readonly forbiddenChanges: CoreBriefState["version"]["forbiddenChanges"];
  readonly expectedDeltas: CoreBriefState["version"]["expectedDeltas"];
  readonly evidenceBoundaries: CoreBriefState["version"]["evidenceBoundaries"];
  readonly explicitNonGoals: readonly string[];
}

export interface ProjectReaderHealth {
  readonly rootValidated: true;
  readonly stateDatabaseInitialized: true;
  readonly projectBinding: "single";
  readonly readOnly: true;
}

export interface ProjectReader {
  readonly health: () => ProjectReaderHealth;
  readonly readResearchContext: () => Promise<SestinaMcpResult<ResearchContextPayload>>;
  readonly close: () => void;
}

export interface OpenProjectReaderOptions {
  readonly projectRoot: string;
  readonly outputLimitBytes: number;
  readonly queryTimeoutMs: number;
}

async function canonicalDirectory(raw: string): Promise<SestinaMcpResult<string>> {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return mcpErr("missing_project_root");
  }
  if (!isAbsolute(raw)) return mcpErr("invalid_project_root");
  try {
    const canonical = await realpath(resolve(raw));
    const metadata = await stat(canonical);
    await access(canonical, fsConstants.R_OK);
    return metadata.isDirectory() ? mcpOk(canonical) : mcpErr("invalid_project_root");
  } catch {
    return mcpErr("invalid_project_root");
  }
}

async function stateDatabase(path: string): Promise<SestinaMcpResult<string>> {
  try {
    const metadata = await stat(path);
    if (!metadata.isFile()) return mcpErr("project_state_unavailable");
    await access(path, fsConstants.R_OK);
    return mcpOk(path);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return mcpErr("project_not_initialized");
    }
    return mcpErr("project_state_unavailable");
  }
}

export async function runWithQueryDeadline<T>(
  work: () => T | Promise<T>,
  timeoutMs: number,
): Promise<SestinaMcpResult<T>> {
  if (!Number.isInteger(timeoutMs) || timeoutMs < MIN_QUERY_TIMEOUT_MS || timeoutMs > MAX_QUERY_TIMEOUT_MS) {
    return mcpErr("query_timeout");
  }
  const startedAt = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<SestinaMcpResult<T>>((resolveDeadline) => {
    timer = setTimeout(() => {
      resolveDeadline(mcpErr("query_timeout"));
    }, timeoutMs);
  });
  const operation = Promise.resolve()
    .then(work)
    .then((value) => performance.now() - startedAt >= timeoutMs
      ? mcpErr<T>("query_timeout")
      : mcpOk(value))
    .catch(() => mcpErr<T>("project_state_unavailable"));
  const result = await Promise.race([operation, deadline]);
  if (timer !== undefined) clearTimeout(timer);
  return result;
}

export function projectResearchContext(state: CoreBriefState): ResearchContextPayload {
  const version = state.version;
  return Object.freeze({
    schemaVersion: "1.0" as const,
    briefId: state.brief.id,
    versionId: version.id,
    version: version.versionNumber,
    recordVersion: state.brief.version,
    projectQuestion: version.projectQuestion,
    currentStage: version.currentStage,
    currentTask: version.currentTask,
    targetArtifacts: version.targetArtifacts,
    fixedDecisions: version.fixedDecisions,
    allowedChanges: version.allowedChanges,
    forbiddenChanges: version.forbiddenChanges,
    expectedDeltas: version.expectedDeltas,
    evidenceBoundaries: version.evidenceBoundaries,
    explicitNonGoals: version.explicitNonGoals,
  });
}

class CoreProjectReader implements ProjectReader {
  readonly #core: SestinaCore;
  readonly #projectId: string;
  readonly #outputLimitBytes: number;
  readonly #queryTimeoutMs: number;
  #closed = false;

  constructor(core: SestinaCore, projectId: string, outputLimitBytes: number, queryTimeoutMs: number) {
    this.#core = core;
    this.#projectId = projectId;
    this.#outputLimitBytes = outputLimitBytes;
    this.#queryTimeoutMs = queryTimeoutMs;
  }

  health(): ProjectReaderHealth {
    return Object.freeze({
      rootValidated: true,
      stateDatabaseInitialized: true,
      projectBinding: "single",
      readOnly: true,
    });
  }

  async readResearchContext(): Promise<SestinaMcpResult<ResearchContextPayload>> {
    if (this.#closed) return mcpErr("project_state_unavailable");
    const queried = await runWithQueryDeadline(
      () => this.#core.getBriefState(this.#projectId),
      this.#queryTimeoutMs,
    );
    if (!queried.ok) return queried;
    if (!queried.value.ok) return mcpErr("project_state_unavailable");
    if (queried.value.value === undefined) return mcpErr("no_active_brief");
    const context = projectResearchContext(queried.value.value);
    if (Buffer.byteLength(JSON.stringify(context), "utf8") > this.#outputLimitBytes) {
      return mcpErr("response_too_large");
    }
    return mcpOk(context);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#core.close();
  }
}

export async function openProjectReader(options: OpenProjectReaderOptions): Promise<SestinaMcpResult<ProjectReader>> {
  const root = await canonicalDirectory(options.projectRoot);
  if (!root.ok) return root;
  if (
    !Number.isInteger(options.outputLimitBytes)
    || options.outputLimitBytes < MIN_OUTPUT_LIMIT_BYTES
    || options.outputLimitBytes > MAX_OUTPUT_LIMIT_BYTES
  ) return mcpErr("response_too_large");
  if (
    !Number.isInteger(options.queryTimeoutMs)
    || options.queryTimeoutMs < MIN_QUERY_TIMEOUT_MS
    || options.queryTimeoutMs > MAX_QUERY_TIMEOUT_MS
  ) return mcpErr("query_timeout");

  const database = await stateDatabase(join(root.value, ".sestina", "state.sqlite"));
  if (!database.ok) return database;
  const opened = await openSestina({ databasePath: database.value, readOnly: true });
  if (!opened.ok) return mcpErr("project_state_unavailable");
  const projects = opened.value.listProjects();
  if (!projects.ok) {
    opened.value.close();
    return mcpErr(projects.error.code === "state_conflict"
      ? "project_binding_inconsistent"
      : "project_state_unavailable");
  }
  if (projects.value.length !== 1 || projects.value[0] === undefined) {
    opened.value.close();
    return mcpErr("project_binding_inconsistent");
  }
  return mcpOk(new CoreProjectReader(
    opened.value,
    projects.value[0].id,
    options.outputLimitBytes,
    options.queryTimeoutMs,
  ));
}
