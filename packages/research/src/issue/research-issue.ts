import { validateResearchActor, type ResearchActor } from "../authority/actor.js";
import { parseResearchSource, validateUtcTimestamp, type ResearchSource } from "../authority/source.js";
import type { ScopeTarget } from "../brief/scope-rule.js";
import { parseScopeRule } from "../brief/scope-rule.js";
import type { Clock } from "../clock.js";
import { cloneFrozen, isNonBlankString, isRecord, readClock } from "../domain-validation.js";
import { researchError } from "../errors.js";
import { advanceEntityVersion, initialEntityVersion, parseEntityVersion, type EntityVersion } from "../identity/entity-version.js";
import { parseResearchIdFor } from "../identity/research-id.js";
import type { IdFactory } from "../index.js";
import { err, ok } from "../result.js";
import type { ResearchResult } from "../result.js";
import { createIssueFingerprint, normalizeIssueFingerprintInput } from "./issue-fingerprint.js";
import { parseIssueKind, type IssueKind } from "./issue-kind.js";
import { evaluateIssueReopenReasons, parseIssueResolutionContext, type IssueReopenContext, type IssueResolutionContext } from "./reopen-condition.js";
import { parseIssueStatus, parseIssueTransition, type IssueStatus, type IssueTransition } from "./issue-transition.js";

export interface ResearchIssueInput {
  readonly projectId: string; readonly kind: IssueKind; readonly target: ScopeTarget;
  readonly violatedCriterion: string; readonly rationaleConcepts: readonly string[]; readonly summary: string;
  readonly sourceArtifactId: string; readonly sourceRevisionId: string; readonly sourceRevisionContentHash: string;
  readonly lineageRootRevisionId: string; readonly source: ResearchSource;
}
export interface IssueResolution extends IssueResolutionContext { readonly reason: string; readonly source: ResearchSource; readonly resolvedAt: string; }
export interface IssueReopenRecord { readonly reasons: readonly string[]; readonly source: ResearchSource; readonly reopenedAt: string; }
export interface ResearchIssue extends ResearchIssueInput {
  readonly id: string; readonly fingerprint: string; readonly status: IssueStatus; readonly transitions: readonly IssueTransition[];
  readonly version: EntityVersion; readonly createdAt: string; readonly updatedAt: string;
  readonly resolution?: IssueResolution; readonly reopenHistory: readonly IssueReopenRecord[];
}

function parseConcepts(input: unknown): ResearchResult<readonly string[]> {
  if (!Array.isArray(input)) return err(researchError("invalid_research_issue"));
  const values: string[] = [];
  for (const value of input) { if (!isNonBlankString(value)) return err(researchError("invalid_research_issue")); values.push(value.trim()); }
  if (values.length === 0) return err(researchError("invalid_research_issue"));
  return ok(cloneFrozen(values));
}

export function parseResearchIssue(input: unknown): ResearchResult<ResearchIssue> {
  if (!isRecord(input) || !isNonBlankString(input.summary) || !isNonBlankString(input.violatedCriterion) || !Array.isArray(input.transitions) || !Array.isArray(input.reopenHistory)) return err(researchError("invalid_research_issue"));
  const id = parseResearchIdFor(input.id, "riss_"); if (!id.ok) return id;
  const projectId = parseResearchIdFor(input.projectId, "rprj_"); if (!projectId.ok) return projectId;
  const kind = parseIssueKind(input.kind); if (!kind.ok) return kind;
  const target = parseScopeRule({ target: input.target, operations: ["rewrite"] }); if (!target.ok) return target;
  const concepts = parseConcepts(input.rationaleConcepts); if (!concepts.ok) return concepts;
  const sourceArtifactId = parseResearchIdFor(input.sourceArtifactId, "rart_"); if (!sourceArtifactId.ok) return sourceArtifactId;
  const sourceRevisionId = parseResearchIdFor(input.sourceRevisionId, "rrev_"); if (!sourceRevisionId.ok) return sourceRevisionId;
  const lineageRootRevisionId = parseResearchIdFor(input.lineageRootRevisionId, "rrev_"); if (!lineageRootRevisionId.ok) return lineageRootRevisionId;
  if (typeof input.sourceRevisionContentHash !== "string" || !/^[0-9a-f]{64}$/.test(input.sourceRevisionContentHash) || typeof input.fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(input.fingerprint)) return err(researchError("invalid_research_issue"));
  const fingerprint = createIssueFingerprint({ kind: kind.value, target: target.value.target, violatedCriterion: input.violatedCriterion, rationaleConcepts: concepts.value, sourceArtifactId: sourceArtifactId.value.id, lineageRootRevisionId: lineageRootRevisionId.value.id });
  if (!fingerprint.ok || fingerprint.value !== input.fingerprint) return err(researchError("invalid_issue_fingerprint"));
  const source = parseResearchSource(input.source); if (!source.ok) return source;
  const status = parseIssueStatus(input.status); if (!status.ok) return status;
  const version = parseEntityVersion(input.version); if (!version.ok) return version;
  const createdAt = validateUtcTimestamp(input.createdAt); if (!createdAt.ok) return createdAt;
  const updatedAt = validateUtcTimestamp(input.updatedAt); if (!updatedAt.ok) return updatedAt;
  const transitions: IssueTransition[] = [];
  for (const value of input.transitions) { const parsed = parseIssueTransition(value); if (!parsed.ok) return parsed; const previous = transitions[transitions.length - 1]; if ((previous === undefined && (parsed.value.from !== null || parsed.value.to !== "open")) || (previous !== undefined && (parsed.value.from !== previous.to || parsed.value.at < previous.at))) return err(researchError("invalid_issue_transition")); transitions.push(parsed.value); }
  const firstTransition = transitions.at(0);
  const lastTransition = transitions.at(-1);
  if (firstTransition?.at !== createdAt.value || lastTransition?.to !== status.value || lastTransition.at !== updatedAt.value) return err(researchError("invalid_research_issue"));
  let resolution: IssueResolution | undefined;
  if (input.resolution !== undefined) {
    if (!isRecord(input.resolution) || !isNonBlankString(input.resolution.reason)) return err(researchError("invalid_research_issue"));
    const context = parseIssueResolutionContext(input.resolution, input.sourceRevisionContentHash); if (!context.ok) return context;
    const resolutionSource = parseResearchSource(input.resolution.source); if (!resolutionSource.ok) return resolutionSource;
    const resolvedAt = validateUtcTimestamp(input.resolution.resolvedAt); if (!resolvedAt.ok) return resolvedAt;
    resolution = { ...context.value, reason: input.resolution.reason.trim(), source: resolutionSource.value, resolvedAt: resolvedAt.value };
  }
  if (["resolved", "suppressed", "reopened"].includes(status.value) !== (resolution !== undefined)) return err(researchError("invalid_research_issue"));
  const reopenHistory: IssueReopenRecord[] = [];
  for (const value of input.reopenHistory) { if (!isRecord(value) || !Array.isArray(value.reasons) || value.reasons.length === 0 || value.reasons.some((reason) => !isNonBlankString(reason))) return err(researchError("invalid_research_issue")); const reopenSource = parseResearchSource(value.source); if (!reopenSource.ok) return reopenSource; const reopenedAt = validateUtcTimestamp(value.reopenedAt); if (!reopenedAt.ok) return reopenedAt; reopenHistory.push({ reasons: value.reasons.map((reason) => String(reason)), source: reopenSource.value, reopenedAt: reopenedAt.value }); }
  return ok(cloneFrozen({ id: id.value.id, projectId: projectId.value.id, kind: kind.value, target: target.value.target, violatedCriterion: input.violatedCriterion.trim(), rationaleConcepts: concepts.value, summary: input.summary.trim(), sourceArtifactId: sourceArtifactId.value.id, sourceRevisionId: sourceRevisionId.value.id, sourceRevisionContentHash: input.sourceRevisionContentHash, lineageRootRevisionId: lineageRootRevisionId.value.id, source: source.value, fingerprint: fingerprint.value, status: status.value, transitions, version: version.value, createdAt: createdAt.value, updatedAt: updatedAt.value, ...(resolution ? { resolution } : {}), reopenHistory }));
}

export function createResearchIssue(input: ResearchIssueInput, ports: { readonly clock: Clock; readonly idFactory: IdFactory }): ResearchResult<ResearchIssue> {
  if (!isRecord(input) || !isNonBlankString(input.summary)) return err(researchError("invalid_research_issue"));
  const normalized = normalizeIssueFingerprintInput(input); if (!normalized.ok) return normalized;
  const projectId = parseResearchIdFor(input.projectId, "rprj_"); if (!projectId.ok) return projectId;
  const sourceRevisionId = parseResearchIdFor(input.sourceRevisionId, "rrev_"); if (!sourceRevisionId.ok) return sourceRevisionId;
  if (typeof input.sourceRevisionContentHash !== "string" || !/^[0-9a-f]{64}$/.test(input.sourceRevisionContentHash)) return err(researchError("invalid_research_issue"));
  const source = parseResearchSource(input.source); if (!source.ok) return source;
  const fingerprint = createIssueFingerprint(input); if (!fingerprint.ok) return fingerprint;
  const id = parseResearchIdFor(ports.idFactory.create("riss_"), "riss_"); if (!id.ok) return id;
  const at = readClock(ports.clock); if (!at.ok) return at;
  return parseResearchIssue({ ...input, id: id.value.id, projectId: projectId.value.id, target: normalized.value.target, sourceArtifactId: normalized.value.sourceArtifactId, lineageRootRevisionId: normalized.value.lineageRootRevisionId, sourceRevisionId: sourceRevisionId.value.id, source: source.value, fingerprint: fingerprint.value, status: "open", transitions: [{ from: null, to: "open", reason: "created", source: source.value, at: at.value }], version: initialEntityVersion(), createdAt: at.value, updatedAt: at.value, reopenHistory: [] });
}

function transitionSource(actorInput: ResearchActor, at: string, userOnly: boolean): ResearchResult<ResearchSource> {
  const actor = validateResearchActor(actorInput); if (!actor.ok) return actor;
  if (userOnly && actor.value.kind !== "user") return err(researchError("user_issue_action_required"));
  const authority = actor.value.kind === "user" ? "user_confirmed" : actor.value.kind === "model" ? "model_proposed" : actor.value.kind === "system" ? "system_derived" : "imported_unconfirmed";
  return parseResearchSource({ actor: actor.value, authority, recordedAt: at });
}

function appendIssueTransition(currentInput: ResearchIssue, target: IssueStatus, actor: ResearchActor, expectedVersion: EntityVersion, reason: string, clock: Clock, userOnly = false, additions: Record<string, unknown> = {}): ResearchResult<ResearchIssue> {
  const current = parseResearchIssue(currentInput); if (!current.ok) return current;
  if (!isNonBlankString(reason)) return err(researchError("invalid_issue_transition"));
  const expected = parseEntityVersion(expectedVersion); if (!expected.ok) return expected;
  const next = advanceEntityVersion(current.value.version, expected.value); if (!next.ok) return next;
  const at = readClock(clock); if (!at.ok) return at;
  const source = transitionSource(actor, at.value, userOnly); if (!source.ok) return source;
  return parseResearchIssue({ ...current.value, ...additions, status: target, transitions: [...current.value.transitions, { from: current.value.status, to: target, reason: reason.trim(), source: source.value, at: at.value }], version: next.value, updatedAt: at.value });
}

export function acknowledgeResearchIssue(current: ResearchIssue, actor: ResearchActor, expectedVersion: EntityVersion, reason: string, clock: Clock): ResearchResult<ResearchIssue> {
  const parsed = parseResearchIssue(current); if (!parsed.ok) return parsed;
  if (parsed.value.status !== "open" && parsed.value.status !== "reopened") return err(researchError("invalid_issue_transition"));
  return appendIssueTransition(parsed.value, "acknowledged", actor, expectedVersion, reason, clock);
}
export function disputeResearchIssue(current: ResearchIssue, actor: ResearchActor, expectedVersion: EntityVersion, reason: string, clock: Clock): ResearchResult<ResearchIssue> {
  const parsed = parseResearchIssue(current); if (!parsed.ok) return parsed;
  if (parsed.value.status !== "open" && parsed.value.status !== "acknowledged" && parsed.value.status !== "reopened") return err(researchError("invalid_issue_transition"));
  return appendIssueTransition(parsed.value, "disputed", actor, expectedVersion, reason, clock, true);
}
export function waiveResearchIssue(current: ResearchIssue, actor: ResearchActor, expectedVersion: EntityVersion, reason: string, clock: Clock): ResearchResult<ResearchIssue> {
  const parsed = parseResearchIssue(current); if (!parsed.ok) return parsed;
  if (parsed.value.status !== "open" && parsed.value.status !== "acknowledged" && parsed.value.status !== "reopened") return err(researchError("invalid_issue_transition"));
  return appendIssueTransition(parsed.value, "waived", actor, expectedVersion, reason, clock, true);
}

export function resolveResearchIssue(current: ResearchIssue, actor: ResearchActor, expectedVersion: EntityVersion, reason: string, resolutionInput: { readonly resolutionEvidenceId: string; readonly briefVersionId?: string; readonly frozenDecisionIds?: readonly string[] }, clock: Clock): ResearchResult<ResearchIssue> {
  const parsed = parseResearchIssue(current); if (!parsed.ok) return parsed;
  if (parsed.value.status !== "open" && parsed.value.status !== "acknowledged" && parsed.value.status !== "reopened") return err(researchError("invalid_issue_transition"));
  const at = readClock(clock); if (!at.ok) return at;
  const source = transitionSource(actor, at.value, false); if (!source.ok) return source;
  const context = parseIssueResolutionContext(resolutionInput, parsed.value.sourceRevisionContentHash); if (!context.ok) return context;
  const resolution: IssueResolution = { ...context.value, reason: reason.trim(), source: source.value, resolvedAt: at.value };
  return appendIssueTransition(parsed.value, "resolved", actor, expectedVersion, reason, clock, false, { resolution });
}

export function suppressResolvedIssue(current: ResearchIssue, actor: ResearchActor, expectedVersion: EntityVersion, reason: string, clock: Clock): ResearchResult<ResearchIssue> {
  const parsed = parseResearchIssue(current); if (!parsed.ok) return parsed;
  if (parsed.value.status !== "resolved") return err(researchError("invalid_issue_transition"));
  return appendIssueTransition(parsed.value, "suppressed", actor, expectedVersion, reason, clock);
}

export function reopenResearchIssue(current: ResearchIssue, actor: ResearchActor, expectedVersion: EntityVersion, reason: string, context: IssueReopenContext, clock: Clock): ResearchResult<ResearchIssue> {
  const parsed = parseResearchIssue(current); if (!parsed.ok) return parsed;
  if (parsed.value.status !== "resolved" && parsed.value.status !== "suppressed") return err(researchError("invalid_issue_transition"));
  const reasons = evaluateIssueReopenReasons(parsed.value.resolution, context); if (!reasons.ok) return reasons;
  if (reasons.value.length === 0) return err(researchError("issue_reopen_not_allowed"));
  const at = readClock(clock); if (!at.ok) return at;
  const source = transitionSource(actor, at.value, reasons.value.includes("user_requested")); if (!source.ok) return source;
  return appendIssueTransition(parsed.value, "reopened", actor, expectedVersion, reason, clock, reasons.value.includes("user_requested"), { reopenHistory: [...parsed.value.reopenHistory, { reasons: reasons.value, source: source.value, reopenedAt: at.value }] });
}
