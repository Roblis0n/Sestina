import {
  mcpErr,
  mcpOk,
  type SestinaMcpResult,
} from "../protocol-errors.js";
import {
  projectResearchContext,
  type ResearchContextSource,
  type ResearchContextPayload,
} from "./content-boundary.js";

export const MAX_INBOUND_JSONRPC_MESSAGE_BYTES = 65_536;
export const MAX_RESEARCH_TEXT_BYTES = 8_192;
export const MAX_RESEARCH_COLLECTION_ITEMS = 128;
export const DEFAULT_RESEARCH_CONTEXT_BUDGET_BYTES = 32_768;
export const MIN_RESEARCH_CONTEXT_BUDGET_BYTES = 1_024;
export const MAX_RESEARCH_CONTEXT_BUDGET_BYTES = 65_536;
export const MAX_MCP_RESULT_BYTES = 262_144;
export const DEFAULT_QUERY_TIMEOUT_MS = 2_000;
export const MIN_QUERY_TIMEOUT_MS = 1;
export const MAX_QUERY_TIMEOUT_MS = 10_000;

export interface SerializedResearchContext {
  readonly payload: ResearchContextPayload;
  readonly json: string;
  readonly bytes: number;
}

export interface SerializedMcpResult<T> {
  readonly value: T;
  readonly json: string;
  readonly bytes: number;
}

export function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export function validateResearchText(value: string): SestinaMcpResult<undefined> {
  return utf8ByteLength(value) <= MAX_RESEARCH_TEXT_BYTES
    ? mcpOk(undefined)
    : mcpErr("response_too_large");
}

export function validateResearchCollection(value: readonly unknown[]): SestinaMcpResult<undefined> {
  return value.length <= MAX_RESEARCH_COLLECTION_ITEMS
    ? mcpOk(undefined)
    : mcpErr("response_too_large");
}

function validateStrings(values: readonly string[]): SestinaMcpResult<undefined> {
  const collection = validateResearchCollection(values);
  if (!collection.ok) return collection;
  for (const value of values) {
    const bounded = validateResearchText(value);
    if (!bounded.ok) return bounded;
  }
  return mcpOk(undefined);
}

type ScopeRule = ResearchContextSource["brief"]["version"]["allowedChanges"][number];

function validateScopeRule(rule: ScopeRule): SestinaMcpResult<undefined> {
  const operations = validateStrings(rule.operations);
  if (!operations.ok) return operations;
  switch (rule.target.kind) {
    case "artifact": return validateResearchText(rule.target.artifactId);
    case "heading": return validateStrings([rule.target.artifactId, rule.target.heading]);
    case "block": return validateStrings([rule.target.artifactId, rule.target.blockId]);
    case "project_path": return validateResearchText(rule.target.relativePath);
  }
}

function validateBriefSource(state: ResearchContextSource["brief"]): SestinaMcpResult<undefined> {
  const version = state.version;
  const scalarStrings = validateStrings([
    state.brief.id,
    version.id,
    version.projectQuestion,
    version.currentStage,
    version.currentTask,
  ]);
  if (!scalarStrings.ok) return scalarStrings;

  for (const strings of [version.targetArtifacts, version.explicitNonGoals]) {
    const bounded = validateStrings(strings);
    if (!bounded.ok) return bounded;
  }

  for (const rules of [version.allowedChanges, version.forbiddenChanges]) {
    const collection = validateResearchCollection(rules);
    if (!collection.ok) return collection;
    for (const rule of rules) {
      const bounded = validateScopeRule(rule);
      if (!bounded.ok) return bounded;
    }
  }

  for (const values of [version.fixedDecisions, version.expectedDeltas]) {
    const collection = validateResearchCollection(values);
    if (!collection.ok) return collection;
    for (const item of values) {
      const strings = validateStrings([item.id, item.statement]);
      if (!strings.ok) return strings;
      const scope = validateScopeRule(item.scope);
      if (!scope.ok) return scope;
    }
  }

  const evidenceCollection = validateResearchCollection(version.evidenceBoundaries);
  if (!evidenceCollection.ok) return evidenceCollection;
  for (const item of version.evidenceBoundaries) {
    const strings = validateStrings([item.id, item.statement]);
    if (!strings.ok) return strings;
    const scope = validateScopeRule(item.scope);
    if (!scope.ok) return scope;
    const inferenceKinds = validateStrings(item.forbiddenInferenceKinds);
    if (!inferenceKinds.ok) return inferenceKinds;
    if (item.allowedSourceIds !== undefined) {
      const sourceIds = validateStrings(item.allowedSourceIds);
      if (!sourceIds.ok) return sourceIds;
    }
  }
  return mcpOk(undefined);
}

function validateContinuityPayload(payload: ResearchContextPayload["continuity"]): SestinaMcpResult<undefined> {
  if (payload.currentEpisode !== null) {
    const episode = validateStrings([
      payload.currentEpisode.id,
      payload.currentEpisode.status,
      payload.currentEpisode.artifactId,
      payload.currentEpisode.baselineRevisionId,
      ...(payload.currentEpisode.candidateRevisionId === null ? [] : [payload.currentEpisode.candidateRevisionId]),
    ]);
    if (!episode.ok) return episode;
  }
  for (const decision of payload.activeDecisions) {
    const bounded = validateStrings([
      decision.id,
      decision.status,
      decision.statement,
      ...(decision.reopenCondition === null ? [] : [decision.reopenCondition]),
    ]);
    if (!bounded.ok) return bounded;
  }
  for (const issue of payload.relevantIssues) {
    const bounded = validateStrings([
      issue.id,
      issue.status,
      issue.summary,
      ...(issue.reopenCondition === null ? [] : [issue.reopenCondition]),
    ]);
    if (!bounded.ok) return bounded;
  }
  return mcpOk(undefined);
}

function serializeJson(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

export function serializeResearchContext(
  source: ResearchContextSource,
  outputLimitBytes: number,
): SestinaMcpResult<SerializedResearchContext> {
  if (
    !Number.isInteger(outputLimitBytes)
    || outputLimitBytes < MIN_RESEARCH_CONTEXT_BUDGET_BYTES
    || outputLimitBytes > MAX_RESEARCH_CONTEXT_BUDGET_BYTES
  ) return mcpErr("response_too_large");
  const projectId = validateResearchText(source.projectId);
  if (!projectId.ok) return projectId;
  const boundedSource = validateBriefSource(source.brief);
  if (!boundedSource.ok) return boundedSource;
  const payload = projectResearchContext(source, MAX_RESEARCH_COLLECTION_ITEMS);
  const boundedContinuity = validateContinuityPayload(payload.continuity);
  if (!boundedContinuity.ok) return boundedContinuity;
  const json = serializeJson(payload);
  if (json === undefined) return mcpErr("response_too_large");
  const bytes = utf8ByteLength(json);
  return bytes <= outputLimitBytes
    ? mcpOk(Object.freeze({ payload, json, bytes }))
    : mcpErr("response_too_large");
}

export function serializeMcpResult<T>(value: T): SestinaMcpResult<SerializedMcpResult<T>> {
  const json = serializeJson(value);
  if (json === undefined) return mcpErr("response_too_large");
  const bytes = utf8ByteLength(json);
  return bytes <= MAX_MCP_RESULT_BYTES
    ? mcpOk(Object.freeze({ value, json, bytes }))
    : mcpErr("response_too_large");
}

export function isInboundLimitError(error: Error): boolean {
  return error.message === `ReadBuffer exceeded maximum size of ${MAX_INBOUND_JSONRPC_MESSAGE_BYTES} bytes`;
}
