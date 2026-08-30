import {
  openSestina,
} from "@sestina/core";
import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import {
  mcpErr,
  mcpOk,
  type SestinaMcpResult,
} from "./protocol-errors.js";
import type { ResearchContextPayload, ResearchContextSource } from "./security/content-boundary.js";
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

export interface ProjectReaderAuditBinding {
  readonly projectId: string;
  readonly manifestHash: string;
  readonly payloadHash: string;
}

export interface ProjectReader<TPayload extends object = ResearchContextPayload> {
  readonly health: () => ProjectReaderHealth;
  readonly readResearchContext: () => Promise<SestinaMcpResult<TPayload>>;
  readonly readSerializedResearchContext: () => Promise<SestinaMcpResult<SerializedResearchContext<TPayload>>>;
  readonly auditBinding?: () => ProjectReaderAuditBinding;
  readonly close: () => void;
}

export interface OpenProjectReaderOptions {
  readonly projectRoot: string;
  readonly outputLimitBytes: number;
  readonly queryTimeoutMs: number;
}

export interface OpenFrozenProjectReaderOptions {
  readonly contextFile: string;
  readonly expectedProjectId: string;
  readonly expectedManifestHash: string;
  readonly outputLimitBytes: number;
  readonly queryTimeoutMs: number;
}

export interface FrozenPilotContextPayload extends Readonly<Record<string, unknown>> {
  readonly schemaVersion: "1.0.0";
  readonly contentBoundary: Readonly<Record<string, unknown>>;
  readonly manifestBinding: {
    readonly pilotId: string;
    readonly attemptId: string;
    readonly manifestId: string;
    readonly projectId: string;
    readonly host: "codex";
    readonly purpose: "candidate_generation" | "continuity_check";
  };
  readonly projectStateHash: string;
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
          const brief = opened.value.getBriefState(this.#projectId);
          if (!brief.ok) return brief;
          const episodes = opened.value.listEpisodes(this.#projectId);
          if (!episodes.ok) return episodes;
          const decisions = opened.value.listDecisions(this.#projectId);
          if (!decisions.ok) return decisions;
          const issues = opened.value.listIssues(this.#projectId);
          if (!issues.ok) return issues;
          if (brief.value === undefined) return { ok: true as const, value: undefined };
          const orderedEpisodes = [...episodes.value].sort((left, right) => {
            const leftCurrent = ["active", "candidate_submitted", "reviewed", "user_action_required"].includes(left.status) ? 1 : 0;
            const rightCurrent = ["active", "candidate_submitted", "reviewed", "user_action_required"].includes(right.status) ? 1 : 0;
            return rightCurrent - leftCurrent || right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id);
          });
          const episode = orderedEpisodes[0];
          const issueReopenCondition = (transitions: readonly { readonly reason: string }[]): string | null => {
            const prefix = "Invalidation condition:";
            for (const transition of [...transitions].reverse()) {
              const index = transition.reason.indexOf(prefix);
              if (index >= 0) return transition.reason.slice(index + prefix.length).trim() || null;
            }
            return null;
          };
          const value: ResearchContextSource = {
            projectId: this.#projectId,
            brief: brief.value,
            continuity: {
              currentEpisode: episode === undefined ? null : {
                id: episode.id,
                status: episode.status,
                artifactId: episode.artifactId,
                baselineRevisionId: episode.lockedStart.baselineRevisionId,
                candidateRevisionId: episode.candidateRevisionId ?? null,
              },
              activeDecisions: decisions.value
                .filter((item): item is typeof item & { readonly status: "accepted" | "frozen" } => item.status === "accepted" || item.status === "frozen")
                .map((item) => ({
                  id: item.id,
                  status: item.status,
                  statement: item.statement,
                  reopenCondition: item.reopenConditions.length === 0 ? null : item.reopenConditions.join("; "),
                })),
              relevantIssues: issues.value.map((item) => ({
                id: item.id,
                status: item.status,
                summary: item.summary,
                reopenCondition: issueReopenCondition(item.transitions),
                resolutionRecorded: item.resolution !== undefined || item.status === "waived",
              })),
            },
          };
          return { ok: true as const, value };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

function validFrozenPayload(value: unknown, expectedProjectId: string): value is FrozenPilotContextPayload {
  if (!isRecord(value) || value.schemaVersion !== "1.0.0" || !isRecord(value.contentBoundary) || !isRecord(value.manifestBinding)) return false;
  const boundary = value.contentBoundary;
  const binding = value.manifestBinding;
  return boundary.kind === "untrusted_research_data"
    && boundary.authority === "none"
    && boundary.mayDirectTools === false
    && boundary.grantsPermissions === false
    && boundary.representsUserAcceptance === false
    && boundary.representsAdjudication === false
    && boundary.representsTaskCompletion === false
    && typeof binding.pilotId === "string"
    && typeof binding.attemptId === "string"
    && typeof binding.manifestId === "string"
    && binding.projectId === expectedProjectId
    && binding.host === "codex"
    && (binding.purpose === "candidate_generation" || binding.purpose === "continuity_check")
    && validSha256(value.projectStateHash);
}

class FrozenProjectReader implements ProjectReader<FrozenPilotContextPayload> {
  #closed = false;

  constructor(
    readonly payload: FrozenPilotContextPayload,
    readonly json: string,
    readonly bytes: number,
    readonly binding: ProjectReaderAuditBinding,
  ) {}

  health(): ProjectReaderHealth {
    return Object.freeze({ rootValidated: true, stateDatabaseInitialized: true, projectBinding: "single", readOnly: true });
  }

  auditBinding(): ProjectReaderAuditBinding { return this.binding; }

  readResearchContext(): Promise<SestinaMcpResult<FrozenPilotContextPayload>> {
    return Promise.resolve(this.#closed ? mcpErr("project_state_unavailable") : mcpOk(this.payload));
  }

  readSerializedResearchContext(): Promise<SestinaMcpResult<SerializedResearchContext<FrozenPilotContextPayload>>> {
    return Promise.resolve(this.#closed ? mcpErr("project_state_unavailable") : mcpOk(Object.freeze({ payload: this.payload, json: this.json, bytes: this.bytes })));
  }

  close(): void { this.#closed = true; }
}

export async function openFrozenProjectReader(options: OpenFrozenProjectReaderOptions): Promise<SestinaMcpResult<ProjectReader<FrozenPilotContextPayload>>> {
  if (!isAbsolute(options.contextFile)
    || !validSha256(options.expectedManifestHash)
    || typeof options.expectedProjectId !== "string"
    || options.expectedProjectId.length === 0
    || !Number.isInteger(options.outputLimitBytes)
    || options.outputLimitBytes < MIN_OUTPUT_LIMIT_BYTES
    || options.outputLimitBytes > MAX_OUTPUT_LIMIT_BYTES
    || !Number.isInteger(options.queryTimeoutMs)
    || options.queryTimeoutMs < MIN_QUERY_TIMEOUT_MS
    || options.queryTimeoutMs > MAX_QUERY_TIMEOUT_MS) return mcpErr("invalid_arguments");
  try {
    const canonical = await realpath(options.contextFile);
    if (!(await stat(canonical)).isFile()) return mcpErr("project_state_unavailable");
    const json = await readFile(canonical, "utf8");
    const bytes = Buffer.byteLength(json, "utf8");
    if (bytes > options.outputLimitBytes) return mcpErr("response_too_large");
    const payload = JSON.parse(json) as unknown;
    const digest = createHash("sha256").update(json, "utf8").digest("hex");
    if (digest !== options.expectedManifestHash || !validFrozenPayload(payload, options.expectedProjectId) || JSON.stringify(payload) !== json) return mcpErr("project_state_unavailable");
    const binding = Object.freeze({ projectId: options.expectedProjectId, manifestHash: options.expectedManifestHash, payloadHash: digest });
    return mcpOk(new FrozenProjectReader(Object.freeze(payload), json, bytes, binding));
  } catch {
    return mcpErr("project_state_unavailable");
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
