import { validateResearchActor, type ResearchActor } from "../authority/actor.js";
import { parseResearchSource, validateUtcTimestamp, type ResearchSource } from "../authority/source.js";
import type { Clock } from "../clock.js";
import { cloneFrozen, isNonBlankString, isRecord, readClock } from "../domain-validation.js";
import { researchError } from "../errors.js";
import { advanceEntityVersion, initialEntityVersion, parseEntityVersion, type EntityVersion } from "../identity/entity-version.js";
import { parseResearchIdFor } from "../identity/research-id.js";
import type { IdFactory } from "../index.js";
import { err, ok } from "../result.js";
import type { ResearchResult } from "../result.js";
import { decisionScopeMatches, decisionScopePriority, parseDecisionScope, type DecisionQueryContext, type DecisionScope } from "./decision-scope.js";
import { parseDecisionStatus, type DecisionStatus } from "./decision-status.js";
import { parseDecisionTransition, type DecisionTransition } from "./decision-transition.js";

export interface ResearchDecisionInput {
  readonly projectId: string;
  readonly statement: string;
  readonly scope: DecisionScope;
  readonly rationale: string;
  readonly effectiveBriefVersionId: string;
  readonly reopenConditions: readonly string[];
  readonly source: ResearchSource;
}

export interface ResearchDecision extends ResearchDecisionInput {
  readonly id: string;
  readonly status: DecisionStatus;
  readonly transitions: readonly DecisionTransition[];
  readonly version: EntityVersion;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly supersedesDecisionId?: string;
  readonly supersededByDecisionId?: string;
}

export interface ActiveDecisionMatch {
  readonly decision: ResearchDecision;
  readonly effectiveStatus: "accepted" | "frozen";
  readonly scopePriority: number;
  readonly priorityExplanation: string;
}

function parseConditions(input: unknown): ResearchResult<readonly string[]> {
  if (!Array.isArray(input)) return err(researchError("invalid_research_decision"));
  const result: string[] = [];
  for (const item of input) {
    if (!isNonBlankString(item) || result.includes(item.trim())) return err(researchError("invalid_research_decision"));
    result.push(item.trim());
  }
  return ok(cloneFrozen(result));
}

export function parseResearchDecision(input: unknown): ResearchResult<ResearchDecision> {
  if (!isRecord(input) || !isNonBlankString(input.statement) || !isNonBlankString(input.rationale) || !Array.isArray(input.transitions)) return err(researchError("invalid_research_decision"));
  const id = parseResearchIdFor(input.id, "rdec_"); if (!id.ok) return id;
  const projectId = parseResearchIdFor(input.projectId, "rprj_"); if (!projectId.ok) return projectId;
  const effectiveBriefVersionId = parseResearchIdFor(input.effectiveBriefVersionId, "rbrf_"); if (!effectiveBriefVersionId.ok) return effectiveBriefVersionId;
  const scope = parseDecisionScope(input.scope); if (!scope.ok) return scope;
  const source = parseResearchSource(input.source); if (!source.ok) return source;
  const conditions = parseConditions(input.reopenConditions); if (!conditions.ok) return conditions;
  const status = parseDecisionStatus(input.status); if (!status.ok) return status;
  const version = parseEntityVersion(input.version); if (!version.ok) return version;
  const createdAt = validateUtcTimestamp(input.createdAt); if (!createdAt.ok) return createdAt;
  const updatedAt = validateUtcTimestamp(input.updatedAt); if (!updatedAt.ok) return updatedAt;
  const transitions: DecisionTransition[] = [];
  for (const value of input.transitions) {
    const parsed = parseDecisionTransition(value); if (!parsed.ok) return parsed;
    const previous = transitions[transitions.length - 1];
    if ((previous === undefined && (parsed.value.from !== null || parsed.value.to !== "proposed")) || (previous !== undefined && (parsed.value.from !== previous.to || parsed.value.at < previous.at))) return err(researchError("invalid_decision_transition"));
    transitions.push(parsed.value);
  }
  const firstTransition = transitions.at(0);
  const lastTransition = transitions.at(-1);
  if (firstTransition?.at !== createdAt.value || lastTransition?.to !== status.value || lastTransition.at !== updatedAt.value) return err(researchError("invalid_research_decision"));
  let supersedesDecisionId: string | undefined;
  if (input.supersedesDecisionId !== undefined) { const parsed = parseResearchIdFor(input.supersedesDecisionId, "rdec_"); if (!parsed.ok) return parsed; supersedesDecisionId = parsed.value.id; }
  let supersededByDecisionId: string | undefined;
  if (input.supersededByDecisionId !== undefined) { const parsed = parseResearchIdFor(input.supersededByDecisionId, "rdec_"); if (!parsed.ok) return parsed; supersededByDecisionId = parsed.value.id; }
  if ((status.value === "superseded") !== (supersededByDecisionId !== undefined) || (status.value !== "superseded" && supersededByDecisionId !== undefined)) return err(researchError("invalid_research_decision"));
  return ok(cloneFrozen({ id: id.value.id, projectId: projectId.value.id, statement: input.statement.trim(), scope: scope.value, rationale: input.rationale.trim(), effectiveBriefVersionId: effectiveBriefVersionId.value.id, reopenConditions: conditions.value, source: source.value, status: status.value, transitions, version: version.value, createdAt: createdAt.value, updatedAt: updatedAt.value, ...(supersedesDecisionId ? { supersedesDecisionId } : {}), ...(supersededByDecisionId ? { supersededByDecisionId } : {}) }));
}

export function createResearchDecision(input: ResearchDecisionInput, ports: { readonly clock: Clock; readonly idFactory: IdFactory }): ResearchResult<ResearchDecision> {
  if (!isRecord(input) || !isNonBlankString(input.statement) || !isNonBlankString(input.rationale)) return err(researchError("invalid_research_decision"));
  const projectId = parseResearchIdFor(input.projectId, "rprj_"); if (!projectId.ok) return projectId;
  const briefVersion = parseResearchIdFor(input.effectiveBriefVersionId, "rbrf_"); if (!briefVersion.ok) return briefVersion;
  const scope = parseDecisionScope(input.scope); if (!scope.ok) return scope;
  const source = parseResearchSource(input.source); if (!source.ok) return source;
  const conditions = parseConditions(input.reopenConditions); if (!conditions.ok) return conditions;
  const id = parseResearchIdFor(ports.idFactory.create("rdec_"), "rdec_"); if (!id.ok) return id;
  const at = readClock(ports.clock); if (!at.ok) return at;
  return parseResearchDecision({ id: id.value.id, projectId: projectId.value.id, statement: input.statement, scope: scope.value, rationale: input.rationale, effectiveBriefVersionId: briefVersion.value.id, reopenConditions: conditions.value, source: source.value, status: "proposed", transitions: [{ from: null, to: "proposed", reason: "created", source: source.value, at: at.value }], version: initialEntityVersion(), createdAt: at.value, updatedAt: at.value });
}

const ALLOWED: Readonly<Record<DecisionStatus, readonly DecisionStatus[]>> = {
  proposed: ["accepted", "rejected", "deferred"],
  deferred: ["accepted", "rejected"],
  accepted: ["frozen"],
  frozen: ["accepted"],
  rejected: [],
  superseded: [],
};

function userTransitionSource(actorInput: ResearchActor, at: string): ResearchResult<ResearchSource> {
  const actor = validateResearchActor(actorInput);
  if (!actor.ok || actor.value.kind !== "user") return err(researchError("user_decision_required"));
  return parseResearchSource({ actor: actor.value, authority: "user_confirmed", recordedAt: at });
}

function appendTransition(current: ResearchDecision, target: DecisionStatus, actor: ResearchActor, expectedVersion: EntityVersion, reason: string, clock: Clock, relation?: { supersedesDecisionId?: string; supersededByDecisionId?: string }): ResearchResult<ResearchDecision> {
  const decision = parseResearchDecision(current); if (!decision.ok) return decision;
  if (!isNonBlankString(reason)) return err(researchError("invalid_decision_transition"));
  const expected = parseEntityVersion(expectedVersion); if (!expected.ok) return expected;
  const next = advanceEntityVersion(decision.value.version, expected.value); if (!next.ok) return next;
  const at = readClock(clock); if (!at.ok) return at;
  const source = userTransitionSource(actor, at.value); if (!source.ok) return source;
  return parseResearchDecision({ ...decision.value, status: target, transitions: [...decision.value.transitions, { from: decision.value.status, to: target, reason: reason.trim(), source: source.value, at: at.value }], version: next.value, updatedAt: at.value, ...(relation?.supersedesDecisionId ? { supersedesDecisionId: relation.supersedesDecisionId } : {}), ...(relation?.supersededByDecisionId ? { supersededByDecisionId: relation.supersededByDecisionId } : {}) });
}

export function transitionResearchDecision(current: ResearchDecision, targetInput: DecisionStatus, actor: ResearchActor, expectedVersion: EntityVersion, reason: string, clock: Clock): ResearchResult<ResearchDecision> {
  const decision = parseResearchDecision(current); if (!decision.ok) return decision;
  const target = parseDecisionStatus(targetInput); if (!target.ok) return target;
  if (target.value === "superseded" || !ALLOWED[decision.value.status].includes(target.value)) return err(researchError("invalid_decision_transition"));
  return appendTransition(decision.value, target.value, actor, expectedVersion, reason, clock);
}

export function supersedeResearchDecision(currentInput: ResearchDecision, replacementInput: ResearchDecision, actor: ResearchActor, currentExpectedVersion: EntityVersion, replacementExpectedVersion: EntityVersion, reason: string, clock: Clock): ResearchResult<{ readonly superseded: ResearchDecision; readonly replacement: ResearchDecision }> {
  const current = parseResearchDecision(currentInput); if (!current.ok) return current;
  const replacement = parseResearchDecision(replacementInput); if (!replacement.ok) return replacement;
  if (current.value.projectId !== replacement.value.projectId || !["accepted", "frozen"].includes(current.value.status) || replacement.value.status !== "proposed") return err(researchError("decision_supersede_required"));
  const superseded = appendTransition(current.value, "superseded", actor, currentExpectedVersion, reason, clock, { supersededByDecisionId: replacement.value.id });
  if (!superseded.ok) return superseded;
  const accepted = appendTransition(replacement.value, "accepted", actor, replacementExpectedVersion, reason, clock, { supersedesDecisionId: current.value.id });
  if (!accepted.ok) return accepted;
  return ok(cloneFrozen({ superseded: superseded.value, replacement: accepted.value }));
}

export function getDecisionStateAt(decisionInput: ResearchDecision, timestamp: string): DecisionStatus | undefined {
  const decision = parseResearchDecision(decisionInput); if (!decision.ok) return undefined;
  const at = validateUtcTimestamp(timestamp); if (!at.ok) return undefined;
  let state: DecisionStatus | undefined;
  for (const transition of decision.value.transitions) { if (transition.at > at.value) break; state = transition.to; }
  return state;
}

export function queryActiveResearchDecisions(decisionsInput: readonly ResearchDecision[], contextInput: DecisionQueryContext): ResearchResult<readonly ActiveDecisionMatch[]> {
  if (!Array.isArray(decisionsInput) || !isRecord(contextInput)) return err(researchError("invalid_research_decision"));
  const projectId = parseResearchIdFor(contextInput.projectId, "rprj_"); if (!projectId.ok) return projectId;
  const artifactId = contextInput.artifactId === undefined ? undefined : parseResearchIdFor(contextInput.artifactId, "rart_");
  if (artifactId !== undefined && !artifactId.ok) return artifactId;
  const briefVersionId = contextInput.briefVersionId === undefined ? undefined : parseResearchIdFor(contextInput.briefVersionId, "rbrf_");
  if (briefVersionId !== undefined && !briefVersionId.ok) return briefVersionId;
  const issueId = contextInput.issueId === undefined ? undefined : parseResearchIdFor(contextInput.issueId, "riss_");
  if (issueId !== undefined && !issueId.ok) return issueId;
  const asOf = contextInput.asOf === undefined ? undefined : validateUtcTimestamp(contextInput.asOf);
  if (asOf !== undefined && !asOf.ok) return asOf;
  const context: DecisionQueryContext = {
    projectId: projectId.value.id,
    ...(artifactId?.ok ? { artifactId: artifactId.value.id } : {}),
    ...(briefVersionId?.ok ? { briefVersionId: briefVersionId.value.id } : {}),
    ...(issueId?.ok ? { issueId: issueId.value.id } : {}),
    ...(asOf?.ok ? { asOf: asOf.value } : {}),
  };
  const matches: ActiveDecisionMatch[] = [];
  for (const value of decisionsInput) {
    const decision = parseResearchDecision(value); if (!decision.ok) return decision;
    if (decision.value.projectId !== projectId.value.id || !decisionScopeMatches(decision.value.scope, context)) continue;
    const state = context.asOf === undefined ? decision.value.status : getDecisionStateAt(decision.value, context.asOf);
    if (state !== "accepted" && state !== "frozen") continue;
    const priority = decisionScopePriority(decision.value.scope);
    matches.push(cloneFrozen({ decision: decision.value, effectiveStatus: state, scopePriority: priority, priorityExplanation: `${decision.value.scope.kind} scope; narrower scopes are listed first but never erase broader decisions` }));
  }
  matches.sort((a, b) => b.scopePriority - a.scopePriority || a.decision.id.localeCompare(b.decision.id));
  return ok(cloneFrozen(matches));
}
