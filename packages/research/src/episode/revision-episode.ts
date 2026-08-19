import { validateResearchActor, type ResearchActor } from "../authority/actor.js";
import { parseResearchSource, validateUtcTimestamp, type ResearchSource } from "../authority/source.js";
import type { DecisionScope } from "../decision/decision-scope.js";
import { parseDecisionScope } from "../decision/decision-scope.js";
import type { Clock } from "../clock.js";
import { cloneFrozen, isNonBlankString, isRecord, readClock } from "../domain-validation.js";
import { researchError } from "../errors.js";
import { advanceEntityVersion, initialEntityVersion, parseEntityVersion, type EntityVersion } from "../identity/entity-version.js";
import { stableResearchHash } from "../identity/canonical-json.js";
import { parseResearchIdFor } from "../identity/research-id.js";
import type { IssueStatus } from "../issue/issue-transition.js";
import { parseIssueStatus } from "../issue/issue-transition.js";
import type { IdFactory } from "../index.js";
import { err, ok } from "../result.js";
import type { ResearchResult } from "../result.js";
import { parseEpisodeOutcome, type EpisodeOutcome, type WaivableOutcomeDimension } from "./episode-outcome.js";
import { parseEpisodeStatus, type EpisodeStatus } from "./episode-status.js";

export interface LockedIssueState { readonly issueId: string; readonly status: IssueStatus; readonly version: EntityVersion; }
export interface LockedDecisionState { readonly decisionId: string; readonly status: "accepted" | "frozen"; readonly version: EntityVersion; }
export interface EpisodeLockedStart {
  readonly briefVersionId: string; readonly baselineRevisionId: string; readonly activeDecisions: readonly LockedDecisionState[];
  readonly relevantIssues: readonly LockedIssueState[]; readonly evidenceBoundaryIds: readonly string[];
  readonly checkerVersion: string; readonly projectStateFingerprint: string; readonly repositoryStateFingerprint: string;
}
export interface EpisodeTransition { readonly from: EpisodeStatus | null; readonly to: EpisodeStatus; readonly source: ResearchSource; readonly reason: string; readonly at: string; }
export interface EpisodeWaiver { readonly dimension: WaivableOutcomeDimension; readonly scope: DecisionScope; readonly reason: string; readonly source: ResearchSource; readonly waivedAt: string; }
export interface CreateRevisionEpisodeInput { readonly projectId: string; readonly artifactId: string; readonly source: ResearchSource; readonly lockedStart: EpisodeLockedStart; }
export interface RevisionEpisode extends CreateRevisionEpisodeInput {
  readonly id: string; readonly lockedStartHash: string; readonly status: EpisodeStatus; readonly transitions: readonly EpisodeTransition[];
  readonly candidateRevisionId?: string; readonly reviewRunIds: readonly string[]; readonly findingIds: readonly string[];
  readonly outcome?: EpisodeOutcome; readonly waivers: readonly EpisodeWaiver[]; readonly version: EntityVersion;
  readonly createdAt: string; readonly updatedAt: string;
}

function parseUniqueIds(input: unknown, prefix: Parameters<typeof parseResearchIdFor>[1], errorCode: "invalid_revision_episode"): ResearchResult<readonly string[]> {
  if (!Array.isArray(input)) return err(researchError(errorCode));
  const values: string[] = [];
  for (const value of input) { const id = parseResearchIdFor(value, prefix); if (!id.ok || values.includes(id.value.id)) return err(researchError(errorCode)); values.push(id.value.id); }
  return ok(cloneFrozen(values));
}

function parseLockedStart(input: unknown): ResearchResult<EpisodeLockedStart> {
  if (!isRecord(input) || !isNonBlankString(input.checkerVersion) || typeof input.projectStateFingerprint !== "string" || !/^[0-9a-f]{64}$/.test(input.projectStateFingerprint) || typeof input.repositoryStateFingerprint !== "string" || !/^[0-9a-f]{64}$/.test(input.repositoryStateFingerprint) || !Array.isArray(input.activeDecisions) || !Array.isArray(input.relevantIssues)) return err(researchError("invalid_revision_episode"));
  const briefVersionId = parseResearchIdFor(input.briefVersionId, "rbrf_"); if (!briefVersionId.ok) return briefVersionId;
  const baselineRevisionId = parseResearchIdFor(input.baselineRevisionId, "rrev_"); if (!baselineRevisionId.ok) return baselineRevisionId;
  const activeDecisions: LockedDecisionState[] = [];
  for (const value of input.activeDecisions) {
    if (!isRecord(value) || (value.status !== "accepted" && value.status !== "frozen")) return err(researchError("invalid_revision_episode"));
    const decisionId = parseResearchIdFor(value.decisionId, "rdec_");
    if (!decisionId.ok || activeDecisions.some((item) => item.decisionId === decisionId.value.id)) return err(researchError("invalid_revision_episode"));
    const version = parseEntityVersion(value.version); if (!version.ok) return version;
    activeDecisions.push({ decisionId: decisionId.value.id, status: value.status, version: version.value });
  }
  const evidenceBoundaryIds = parseUniqueIds(input.evidenceBoundaryIds, "rbrf_", "invalid_revision_episode"); if (!evidenceBoundaryIds.ok) return evidenceBoundaryIds;
  const relevantIssues: LockedIssueState[] = [];
  for (const value of input.relevantIssues) {
    if (!isRecord(value)) return err(researchError("invalid_revision_episode"));
    const issueId = parseResearchIdFor(value.issueId, "riss_"); if (!issueId.ok || relevantIssues.some((item) => item.issueId === issueId.value.id)) return err(researchError("invalid_revision_episode"));
    const status = parseIssueStatus(value.status); if (!status.ok) return status;
    const version = parseEntityVersion(value.version); if (!version.ok) return version;
    relevantIssues.push({ issueId: issueId.value.id, status: status.value, version: version.value });
  }
  return ok(cloneFrozen({ briefVersionId: briefVersionId.value.id, baselineRevisionId: baselineRevisionId.value.id, activeDecisions, relevantIssues, evidenceBoundaryIds: evidenceBoundaryIds.value, checkerVersion: input.checkerVersion.trim(), projectStateFingerprint: input.projectStateFingerprint, repositoryStateFingerprint: input.repositoryStateFingerprint }));
}

function parseTransition(input: unknown): ResearchResult<EpisodeTransition> {
  if (!isRecord(input) || !isNonBlankString(input.reason)) return err(researchError("invalid_episode_transition"));
  let from: EpisodeStatus | null;
  if (input.from === null) from = null;
  else { const parsed = parseEpisodeStatus(input.from); if (!parsed.ok) return parsed; from = parsed.value; }
  const to = parseEpisodeStatus(input.to); if (!to.ok) return to;
  const source = parseResearchSource(input.source); if (!source.ok) return source;
  const at = validateUtcTimestamp(input.at); if (!at.ok) return at;
  return ok(cloneFrozen({ from, to: to.value, source: source.value, reason: input.reason.trim(), at: at.value }));
}

function parseWaiver(input: unknown): ResearchResult<EpisodeWaiver> {
  if (!isRecord(input) || !["fulfillment", "evidence", "scope", "decisionIntegrity", "issueIntegrity"].includes(String(input.dimension)) || !isNonBlankString(input.reason)) return err(researchError("invalid_episode_waiver"));
  const scope = parseDecisionScope(input.scope); if (!scope.ok) return scope;
  const source = parseResearchSource(input.source); if (!source.ok || source.value.actor.kind !== "user") return err(researchError("user_episode_action_required"));
  const waivedAt = validateUtcTimestamp(input.waivedAt); if (!waivedAt.ok) return waivedAt;
  return ok(cloneFrozen({ dimension: input.dimension as WaivableOutcomeDimension, scope: scope.value, reason: input.reason.trim(), source: source.value, waivedAt: waivedAt.value }));
}

export function parseRevisionEpisode(input: unknown): ResearchResult<RevisionEpisode> {
  if (!isRecord(input) || !Array.isArray(input.transitions) || !Array.isArray(input.waivers)) return err(researchError("invalid_revision_episode"));
  const id = parseResearchIdFor(input.id, "repi_"); if (!id.ok) return id;
  const projectId = parseResearchIdFor(input.projectId, "rprj_"); if (!projectId.ok) return projectId;
  const artifactId = parseResearchIdFor(input.artifactId, "rart_"); if (!artifactId.ok) return artifactId;
  const source = parseResearchSource(input.source); if (!source.ok) return source;
  const lockedStart = parseLockedStart(input.lockedStart); if (!lockedStart.ok) return lockedStart;
  const lockHash = stableResearchHash(lockedStart.value); if (!lockHash.ok) return lockHash;
  if (input.lockedStartHash !== lockHash.value) return err(researchError("episode_lock_mismatch"));
  const status = parseEpisodeStatus(input.status); if (!status.ok) return status;
  const version = parseEntityVersion(input.version); if (!version.ok) return version;
  const createdAt = validateUtcTimestamp(input.createdAt); if (!createdAt.ok) return createdAt;
  const updatedAt = validateUtcTimestamp(input.updatedAt); if (!updatedAt.ok) return updatedAt;
  const reviewRunIds = parseUniqueIds(input.reviewRunIds, "rrun_", "invalid_revision_episode"); if (!reviewRunIds.ok) return reviewRunIds;
  const findingIds = parseUniqueIds(input.findingIds, "rfnd_", "invalid_revision_episode"); if (!findingIds.ok) return findingIds;
  let candidateRevisionId: string | undefined;
  if (input.candidateRevisionId !== undefined) { const candidate = parseResearchIdFor(input.candidateRevisionId, "rrev_"); if (!candidate.ok) return candidate; candidateRevisionId = candidate.value.id; }
  const candidateRequired = !["draft", "active"].includes(status.value);
  if (candidateRequired !== (candidateRevisionId !== undefined) || (["reviewed", "user_action_required", "accepted", "rejected", "abandoned"].includes(status.value) && reviewRunIds.value.length === 0)) return err(researchError("invalid_revision_episode"));
  let outcome: EpisodeOutcome | undefined;
  if (input.outcome !== undefined) { const parsed = parseEpisodeOutcome(input.outcome); if (!parsed.ok) return parsed; outcome = parsed.value; }
  if (["user_action_required", "accepted", "rejected", "abandoned"].includes(status.value) !== (outcome !== undefined)) return err(researchError("invalid_revision_episode"));
  if (status.value === "accepted" && outcome?.userDisposition !== "accepted") return err(researchError("invalid_episode_outcome"));
  if (status.value === "rejected" && outcome?.userDisposition !== "rejected") return err(researchError("invalid_episode_outcome"));
  const transitions: EpisodeTransition[] = [];
  for (const value of input.transitions) { const parsed = parseTransition(value); if (!parsed.ok) return parsed; const previous = transitions[transitions.length - 1]; if ((previous === undefined && (parsed.value.from !== null || parsed.value.to !== "draft")) || (previous !== undefined && (parsed.value.from !== previous.to || parsed.value.at < previous.at))) return err(researchError("invalid_episode_transition")); transitions.push(parsed.value); }
  const firstTransition = transitions.at(0);
  const lastTransition = transitions.at(-1);
  if (firstTransition?.at !== createdAt.value || lastTransition?.to !== status.value || lastTransition.at !== updatedAt.value) return err(researchError("invalid_revision_episode"));
  const waivers: EpisodeWaiver[] = [];
  for (const value of input.waivers) { const waiver = parseWaiver(value); if (!waiver.ok) return waiver; waivers.push(waiver.value); }
  return ok(cloneFrozen({ id: id.value.id, projectId: projectId.value.id, artifactId: artifactId.value.id, source: source.value, lockedStart: lockedStart.value, lockedStartHash: lockHash.value, status: status.value, transitions, ...(candidateRevisionId ? { candidateRevisionId } : {}), reviewRunIds: reviewRunIds.value, findingIds: findingIds.value, ...(outcome ? { outcome } : {}), waivers, version: version.value, createdAt: createdAt.value, updatedAt: updatedAt.value }));
}

export function createRevisionEpisode(input: CreateRevisionEpisodeInput, ports: { readonly clock: Clock; readonly idFactory: IdFactory }): ResearchResult<RevisionEpisode> {
  if (!isRecord(input)) return err(researchError("invalid_revision_episode"));
  const projectId = parseResearchIdFor(input.projectId, "rprj_"); if (!projectId.ok) return projectId;
  const artifactId = parseResearchIdFor(input.artifactId, "rart_"); if (!artifactId.ok) return artifactId;
  const source = parseResearchSource(input.source); if (!source.ok) return source;
  const lockedStart = parseLockedStart(input.lockedStart); if (!lockedStart.ok) return lockedStart;
  const lockHash = stableResearchHash(lockedStart.value); if (!lockHash.ok) return lockHash;
  const id = parseResearchIdFor(ports.idFactory.create("repi_"), "repi_"); if (!id.ok) return id;
  const at = readClock(ports.clock); if (!at.ok) return at;
  return parseRevisionEpisode({ id: id.value.id, projectId: projectId.value.id, artifactId: artifactId.value.id, source: source.value, lockedStart: lockedStart.value, lockedStartHash: lockHash.value, status: "draft", transitions: [{ from: null, to: "draft", source: source.value, reason: "created", at: at.value }], reviewRunIds: [], findingIds: [], waivers: [], version: initialEntityVersion(), createdAt: at.value, updatedAt: at.value });
}

function actionSource(actorInput: ResearchActor, at: string, userOnly: boolean): ResearchResult<ResearchSource> {
  const actor = validateResearchActor(actorInput); if (!actor.ok) return actor;
  if (userOnly && actor.value.kind !== "user") return err(researchError("user_episode_action_required"));
  const authority = actor.value.kind === "user" ? "user_confirmed" : actor.value.kind === "model" ? "model_proposed" : actor.value.kind === "system" ? "system_derived" : "imported_unconfirmed";
  return parseResearchSource({ actor: actor.value, authority, recordedAt: at });
}

function advanceEpisode(currentInput: RevisionEpisode, target: EpisodeStatus, actor: ResearchActor, expectedVersion: EntityVersion, clock: Clock, reason: string, additions: Record<string, unknown> = {}, userOnly = false): ResearchResult<RevisionEpisode> {
  const current = parseRevisionEpisode(currentInput); if (!current.ok) return current;
  const expected = parseEntityVersion(expectedVersion); if (!expected.ok) return expected;
  const next = advanceEntityVersion(current.value.version, expected.value); if (!next.ok) return next;
  const at = readClock(clock); if (!at.ok) return at;
  const source = actionSource(actor, at.value, userOnly); if (!source.ok) return source;
  return parseRevisionEpisode({ ...current.value, ...additions, status: target, transitions: [...current.value.transitions, { from: current.value.status, to: target, source: source.value, reason, at: at.value }], version: next.value, updatedAt: at.value });
}

export function activateRevisionEpisode(current: RevisionEpisode, actor: ResearchActor, expectedVersion: EntityVersion, clock: Clock): ResearchResult<RevisionEpisode> {
  const parsed = parseRevisionEpisode(current); if (!parsed.ok) return parsed;
  if (parsed.value.status !== "draft") return err(researchError("invalid_episode_transition"));
  return advanceEpisode(parsed.value, "active", actor, expectedVersion, clock, "activated");
}
export function submitEpisodeCandidate(current: RevisionEpisode, candidateRevisionId: string, actor: ResearchActor, expectedVersion: EntityVersion, clock: Clock): ResearchResult<RevisionEpisode> {
  const parsed = parseRevisionEpisode(current); if (!parsed.ok) return parsed;
  if (parsed.value.status !== "active") return err(researchError("invalid_episode_transition"));
  const candidate = parseResearchIdFor(candidateRevisionId, "rrev_"); if (!candidate.ok) return candidate;
  return advanceEpisode(parsed.value, "candidate_submitted", actor, expectedVersion, clock, "candidate_submitted", { candidateRevisionId: candidate.value.id });
}
export function recordEpisodeReview(current: RevisionEpisode, reviewRunId: string, findingIdsInput: readonly string[], actor: ResearchActor, expectedVersion: EntityVersion, clock: Clock): ResearchResult<RevisionEpisode> {
  const parsed = parseRevisionEpisode(current); if (!parsed.ok) return parsed;
  if (parsed.value.status !== "candidate_submitted") return err(researchError("invalid_episode_transition"));
  const run = parseResearchIdFor(reviewRunId, "rrun_"); if (!run.ok) return run;
  const findings = parseUniqueIds(findingIdsInput, "rfnd_", "invalid_revision_episode"); if (!findings.ok) return findings;
  return advanceEpisode(parsed.value, "reviewed", actor, expectedVersion, clock, "review_recorded", { reviewRunIds: [...parsed.value.reviewRunIds, run.value.id], findingIds: [...parsed.value.findingIds, ...findings.value] });
}
export function requireEpisodeUserAction(current: RevisionEpisode, outcomeInput: EpisodeOutcome, actor: ResearchActor, expectedVersion: EntityVersion, clock: Clock): ResearchResult<RevisionEpisode> {
  const parsed = parseRevisionEpisode(current); if (!parsed.ok) return parsed;
  if (parsed.value.status !== "reviewed") return err(researchError("invalid_episode_transition"));
  const outcome = parseEpisodeOutcome(outcomeInput); if (!outcome.ok) return outcome;
  if (outcome.value.userDisposition !== "pending") return err(researchError("invalid_episode_outcome"));
  return advanceEpisode(parsed.value, "user_action_required", actor, expectedVersion, clock, "user_action_required", { outcome: outcome.value });
}

export function applyEpisodeWaiver(current: RevisionEpisode, waiverInput: { readonly dimension: WaivableOutcomeDimension; readonly scope: DecisionScope; readonly reason: string }, actorInput: ResearchActor, expectedVersion: EntityVersion, clock: Clock): ResearchResult<RevisionEpisode> {
  const currentEpisode = parseRevisionEpisode(current); if (!currentEpisode.ok) return currentEpisode;
  if (currentEpisode.value.status !== "user_action_required" || currentEpisode.value.outcome === undefined || !isRecord(waiverInput) || !isNonBlankString(waiverInput.reason)) return err(researchError("invalid_episode_waiver"));
  const expected = parseEntityVersion(expectedVersion); if (!expected.ok) return expected;
  const next = advanceEntityVersion(currentEpisode.value.version, expected.value); if (!next.ok) return next;
  const at = readClock(clock); if (!at.ok) return at;
  const source = actionSource(actorInput, at.value, true); if (!source.ok) return source;
  const scope = parseDecisionScope(waiverInput.scope); if (!scope.ok) return scope;
  if (!["fulfillment", "evidence", "scope", "decisionIntegrity", "issueIntegrity"].includes(waiverInput.dimension)) return err(researchError("invalid_episode_waiver"));
  const waiver: EpisodeWaiver = { dimension: waiverInput.dimension, scope: scope.value, reason: waiverInput.reason.trim(), source: source.value, waivedAt: at.value };
  return parseRevisionEpisode({ ...currentEpisode.value, outcome: { ...currentEpisode.value.outcome, userDisposition: "waived" }, waivers: [...currentEpisode.value.waivers, waiver], version: next.value });
}

export function disposeRevisionEpisode(current: RevisionEpisode, disposition: "accepted" | "rejected" | "abandoned", actor: ResearchActor, expectedVersion: EntityVersion, currentBriefVersionId: string, reason: string, clock: Clock): ResearchResult<RevisionEpisode> {
  const parsed = parseRevisionEpisode(current); if (!parsed.ok) return parsed;
  if (parsed.value.status !== "user_action_required" || parsed.value.outcome === undefined || !isNonBlankString(reason)) return err(researchError("invalid_episode_transition"));
  const brief = parseResearchIdFor(currentBriefVersionId, "rbrf_"); if (!brief.ok) return brief;
  if (brief.value.id !== parsed.value.lockedStart.briefVersionId) return err(researchError("stale_episode_brief"));
  const outcome = { ...parsed.value.outcome, userDisposition: disposition === "accepted" ? "accepted" as const : disposition === "rejected" ? "rejected" as const : parsed.value.outcome.userDisposition };
  return advanceEpisode(parsed.value, disposition, actor, expectedVersion, clock, reason.trim(), { outcome }, true);
}
