import {
  openSestina,
} from "@sestina/core";
import {
  mcpErr,
  mcpOk,
  type SestinaMcpResult,
} from "./protocol-errors.js";
import type { ResearchContextPayload } from "./security/content-boundary.js";
import {
  DEFAULT_QUERY_TIMEOUT_MS,
  DEFAULT_RESEARCH_CONTEXT_BUDGET_BYTES,
  MAX_QUERY_TIMEOUT_MS,
  MAX_RESEARCH_CONTEXT_BUDGET_BYTES,
  MIN_QUERY_TIMEOUT_MS,
  MIN_RESEARCH_CONTEXT_BUDGET_BYTES,
  serializeResearchContext,
  type SerializedResearchContext,
} from "./security/output-limits.js";
import {
  resolveProjectStatePaths,
  revalidateProjectStateDatabase,
} from "./security/path-guard.js";

export const DEFAULT_OUTPUT_LIMIT_BYTES = DEFAULT_RESEARCH_CONTEXT_BUDGET_BYTES;
export const MIN_OUTPUT_LIMIT_BYTES = MIN_RESEARCH_CONTEXT_BUDGET_BYTES;
export const MAX_OUTPUT_LIMIT_BYTES = MAX_RESEARCH_CONTEXT_BUDGET_BYTES;
export {
  DEFAULT_QUERY_TIMEOUT_MS,
  MAX_QUERY_TIMEOUT_MS,
  MIN_QUERY_TIMEOUT_MS,
};
export type { ResearchContextPayload } from "./security/content-boundary.js";
export type { SerializedResearchContext } from "./security/output-limits.js";

export interface ProjectReaderHealth {
  readonly rootValidated: true;
  readonly stateDatabaseInitialized: true;
  readonly projectBinding: "single";
  readonly readOnly: true;
}

export interface ProjectReader {
  readonly health: () => ProjectReaderHealth;
  readonly readResearchContext: () => Promise<SestinaMcpResult<ResearchContextPayload>>;
  readonly readSerializedResearchContext: () => Promise<SestinaMcpResult<SerializedResearchContext>>;
  readonly close: () => void;
}

export interface OpenProjectReaderOptions {
  readonly projectRoot: string;
  readonly outputLimitBytes: number;
  readonly queryTimeoutMs: number;
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

class CoreProjectReader implements ProjectReader {
  readonly #databasePath: string;
  readonly #projectId: string;
  readonly #outputLimitBytes: number;
  readonly #queryTimeoutMs: number;
  #closed = false;

  constructor(databasePath: string, projectId: string, outputLimitBytes: number, queryTimeoutMs: number) {
    this.#databasePath = databasePath;
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
    const result = await this.readSerializedResearchContext();
    return result.ok ? mcpOk(result.value.payload) : result;
  }

  async readSerializedResearchContext(): Promise<SestinaMcpResult<SerializedResearchContext>> {
    if (this.#closed) return mcpErr("project_state_unavailable");
    const queried = await runWithQueryDeadline(
      async () => {
        const opened = await openSestina({
          databasePath: this.#databasePath,
          readOnly: true,
          immutable: true,
        });
        if (!opened.ok) return opened;
        try {
          return opened.value.getBriefState(this.#projectId);
        } finally {
          opened.value.close();
        }
      },
      this.#queryTimeoutMs,
    );
    if (!queried.ok) return queried;
    if (!queried.value.ok) return mcpErr("project_state_unavailable");
    if (queried.value.value === undefined) return mcpErr("no_active_brief");
    return serializeResearchContext(queried.value.value, this.#outputLimitBytes);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
  }
}

export async function openProjectReader(options: OpenProjectReaderOptions): Promise<SestinaMcpResult<ProjectReader>> {
  const paths = await resolveProjectStatePaths(options.projectRoot);
  if (!paths.ok) return paths;
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

  const database = await revalidateProjectStateDatabase(paths.value);
  if (!database.ok) return database;
  const opened = await openSestina({
    databasePath: database.value,
    readOnly: true,
    immutable: true,
  });
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
  const projectId = projects.value[0].id;
  opened.value.close();
  return mcpOk(new CoreProjectReader(database.value, projectId, options.outputLimitBytes, options.queryTimeoutMs));
}
