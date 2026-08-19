import { validateResearchActor, type ResearchActor } from "../authority/actor.js";
import { confirmResearchSource } from "../authority/confirmation.js";
import { parseResearchSource, validateUtcTimestamp, type ResearchSource } from "../authority/source.js";
import type { Clock } from "../clock.js";
import { cloneFrozen, isNonBlankString, isRecord, readClock } from "../domain-validation.js";
import { researchError } from "../errors.js";
import { advanceEntityVersion, initialEntityVersion, parseEntityVersion, type EntityVersion } from "../identity/entity-version.js";
import { canonicalStringify } from "../identity/canonical-json.js";
import { parseResearchIdFor } from "../identity/research-id.js";
import type { IdFactory } from "../index.js";
import { err, ok } from "../result.js";
import type { ResearchResult } from "../result.js";
import type { BriefChangeProposal, BriefChangeSet, CreateBriefChangeProposalInput } from "./brief-change.js";
import { parseEvidenceBoundaryRule, type EvidenceBoundaryRule } from "./evidence-boundary-rule.js";
import { parseExpectedDelta, type ExpectedDelta } from "./expected-delta.js";
import { parseResearchStage, type ResearchStage } from "./research-stage.js";
import { findScopeRuleConflict, parseScopeRule, type ScopeRule } from "./scope-rule.js";

export interface BriefConstraint {
  readonly id: string;
  readonly statement: string;
  readonly scope: ScopeRule;
}

export interface ResearchBriefVersionFields {
  readonly projectQuestion: string;
  readonly currentStage: ResearchStage;
  readonly currentTask: string;
  readonly targetArtifacts: readonly string[];
  readonly fixedDecisions: readonly BriefConstraint[];
  readonly allowedChanges: readonly ScopeRule[];
  readonly forbiddenChanges: readonly ScopeRule[];
  readonly expectedDeltas: readonly ExpectedDelta[];
  readonly evidenceBoundaries: readonly EvidenceBoundaryRule[];
  readonly explicitNonGoals: readonly string[];
}

export interface ResearchBriefInput extends ResearchBriefVersionFields {
  readonly projectId: string;
  readonly source: ResearchSource;
}

export interface ResearchBriefVersion extends ResearchBriefVersionFields {
  readonly id: string;
  readonly projectId: string;
  readonly versionNumber: number;
  readonly source: ResearchSource;
  readonly createdAt: string;
  readonly supersedes?: string;
}

export interface ResearchBrief {
  readonly id: string;
  readonly projectId: string;
  readonly currentVersionId: string;
  readonly versions: readonly ResearchBriefVersion[];
  readonly proposals: readonly BriefChangeProposal[];
  readonly version: EntityVersion;
  readonly importState?: {
    readonly status: "draft";
    readonly source: ResearchSource;
  };
  readonly activationSource?: ResearchSource;
}

const FIELD_NAMES: readonly (keyof ResearchBriefVersionFields)[] = [
  "projectQuestion", "currentStage", "currentTask", "targetArtifacts", "fixedDecisions",
  "allowedChanges", "forbiddenChanges", "expectedDeltas", "evidenceBoundaries", "explicitNonGoals",
];

function parseStringList(value: unknown, allowEmpty: boolean): ResearchResult<readonly string[]> {
  if (!Array.isArray(value)) return err(researchError("invalid_research_brief"));
  const result: string[] = [];
  for (const item of value) {
    if (!isNonBlankString(item) || result.includes(item.trim())) return err(researchError("invalid_research_brief"));
    result.push(item.trim());
  }
  if (!allowEmpty && result.length === 0) return err(researchError("invalid_research_brief"));
  return ok(cloneFrozen(result));
}

function parseBriefConstraint(input: unknown): ResearchResult<BriefConstraint> {
  if (!isRecord(input) || !isNonBlankString(input.statement)) return err(researchError("invalid_research_brief"));
  const id = parseResearchIdFor(input.id, "rbrf_"); if (!id.ok) return id;
  const scope = parseScopeRule(input.scope); if (!scope.ok) return scope;
  return ok(cloneFrozen({ id: id.value.id, statement: input.statement.trim(), scope: scope.value }));
}

function parseArray<T>(value: unknown, parser: (item: unknown) => ResearchResult<T>): ResearchResult<readonly T[]> {
  if (!Array.isArray(value)) return err(researchError("invalid_research_brief"));
  const result: T[] = [];
  for (const item of value) { const parsed = parser(item); if (!parsed.ok) return parsed; result.push(parsed.value); }
  return ok(cloneFrozen(result));
}

function parseVersionFields(input: unknown): ResearchResult<ResearchBriefVersionFields> {
  if (!isRecord(input) || !isNonBlankString(input.projectQuestion) || !isNonBlankString(input.currentTask)) return err(researchError("invalid_research_brief"));
  const stage = parseResearchStage(input.currentStage); if (!stage.ok) return stage;
  if (!Array.isArray(input.targetArtifacts)) return err(researchError("invalid_research_brief"));
  const targetArtifacts: string[] = [];
  for (const item of input.targetArtifacts) { const id = parseResearchIdFor(item, "rart_"); if (!id.ok || targetArtifacts.includes(id.value.id)) return err(researchError("invalid_research_brief")); targetArtifacts.push(id.value.id); }
  const fixedDecisions = parseArray(input.fixedDecisions, parseBriefConstraint); if (!fixedDecisions.ok) return fixedDecisions;
  const allowedChanges = parseArray(input.allowedChanges, parseScopeRule); if (!allowedChanges.ok) return allowedChanges;
  const forbiddenChanges = parseArray(input.forbiddenChanges, parseScopeRule); if (!forbiddenChanges.ok) return forbiddenChanges;
  const conflict = findScopeRuleConflict(allowedChanges.value, forbiddenChanges.value); if (!conflict.ok) return conflict;
  if (conflict.value) return err(researchError("scope_rule_conflict"));
  const expectedDeltas = parseArray(input.expectedDeltas, parseExpectedDelta); if (!expectedDeltas.ok) return expectedDeltas;
  if (expectedDeltas.value.length === 0) return err(researchError("invalid_research_brief"));
  const evidenceBoundaries = parseArray(input.evidenceBoundaries, parseEvidenceBoundaryRule); if (!evidenceBoundaries.ok) return evidenceBoundaries;
  const explicitNonGoals = parseStringList(input.explicitNonGoals, true); if (!explicitNonGoals.ok) return explicitNonGoals;
  return ok(cloneFrozen({ projectQuestion: input.projectQuestion.trim(), currentStage: stage.value, currentTask: input.currentTask.trim(), targetArtifacts, fixedDecisions: fixedDecisions.value, allowedChanges: allowedChanges.value, forbiddenChanges: forbiddenChanges.value, expectedDeltas: expectedDeltas.value, evidenceBoundaries: evidenceBoundaries.value, explicitNonGoals: explicitNonGoals.value }));
}

export function parseResearchBriefVersion(input: unknown): ResearchResult<ResearchBriefVersion> {
  if (!isRecord(input) || typeof input.versionNumber !== "number" || !Number.isSafeInteger(input.versionNumber) || input.versionNumber < 1) return err(researchError("invalid_research_brief"));
  const id = parseResearchIdFor(input.id, "rbrf_"); if (!id.ok) return id;
  const projectId = parseResearchIdFor(input.projectId, "rprj_"); if (!projectId.ok) return projectId;
  const fields = parseVersionFields(input); if (!fields.ok) return fields;
  const source = parseResearchSource(input.source); if (!source.ok) return source;
  const createdAt = validateUtcTimestamp(input.createdAt); if (!createdAt.ok) return createdAt;
  let supersedes: string | undefined;
  if (input.supersedes !== undefined) { const parsed = parseResearchIdFor(input.supersedes, "rbrf_"); if (!parsed.ok) return parsed; supersedes = parsed.value.id; }
  if ((input.versionNumber === 1) !== (supersedes === undefined)) return err(researchError("invalid_research_brief"));
  return ok(cloneFrozen({ id: id.value.id, projectId: projectId.value.id, versionNumber: input.versionNumber, ...fields.value, source: source.value, createdAt: createdAt.value, ...(supersedes ? { supersedes } : {}) }));
}

function mergeFields(base: ResearchBriefVersion, changes: BriefChangeSet): ResearchResult<ResearchBriefVersionFields> {
  if (!isRecord(changes)) return err(researchError("invalid_brief_change"));
  const keys = Object.keys(changes);
  if (keys.length === 0 || keys.some((key) => !FIELD_NAMES.includes(key as keyof ResearchBriefVersionFields) || changes[key as keyof BriefChangeSet] === undefined)) return err(researchError("invalid_brief_change"));
  return parseVersionFields({ ...base, ...changes });
}

function parseBriefChangeProposal(input: unknown, base: ResearchBriefVersion): ResearchResult<BriefChangeProposal> {
  if (!isRecord(input) || !isNonBlankString(input.reason) || !Array.isArray(input.diffFields) || (input.status !== "pending" && input.status !== "confirmed")) return err(researchError("invalid_brief_change"));
  const id = parseResearchIdFor(input.id, "rbrf_"); if (!id.ok) return id;
  const briefId = parseResearchIdFor(input.briefId, "rbrf_"); if (!briefId.ok) return briefId;
  const baseVersionId = parseResearchIdFor(input.baseVersionId, "rbrf_"); if (!baseVersionId.ok || baseVersionId.value.id !== base.id) return err(researchError("invalid_brief_change"));
  const source = parseResearchSource(input.source); if (!source.ok) return source;
  const createdAt = validateUtcTimestamp(input.createdAt); if (!createdAt.ok) return createdAt;
  if (!isRecord(input.changes)) return err(researchError("invalid_brief_change"));
  const merged = mergeFields(base, input.changes); if (!merged.ok) return merged;
  const diffFields = Object.keys(input.changes).sort();
  if (input.diffFields.length !== diffFields.length || input.diffFields.some((value, index) => value !== diffFields[index])) return err(researchError("invalid_brief_change"));
  const common = { id: id.value.id, briefId: briefId.value.id, baseVersionId: baseVersionId.value.id, changes: cloneFrozen(input.changes as BriefChangeSet), diffFields, reason: input.reason.trim(), source: source.value, createdAt: createdAt.value };
  if (input.status === "pending") {
    if (input.confirmedBy !== undefined || input.confirmedAt !== undefined || input.activatedVersionId !== undefined) return err(researchError("invalid_brief_change"));
    return ok(cloneFrozen({ ...common, status: "pending" as const }));
  }
  const actor = validateResearchActor(input.confirmedBy); if (!actor.ok || actor.value.kind !== "user") return err(researchError("user_confirmation_required"));
  const confirmedAt = validateUtcTimestamp(input.confirmedAt); if (!confirmedAt.ok) return confirmedAt;
  const activated = parseResearchIdFor(input.activatedVersionId, "rbrf_"); if (!activated.ok) return activated;
  return ok(cloneFrozen({ ...common, status: "confirmed" as const, confirmedBy: actor.value, confirmedAt: confirmedAt.value, activatedVersionId: activated.value.id }));
}

export function parseResearchBrief(input: unknown): ResearchResult<ResearchBrief> {
  if (!isRecord(input) || !Array.isArray(input.versions) || !Array.isArray(input.proposals)) return err(researchError("invalid_research_brief"));
  const id = parseResearchIdFor(input.id, "rbrf_"); if (!id.ok) return id;
  const projectId = parseResearchIdFor(input.projectId, "rprj_"); if (!projectId.ok) return projectId;
  const currentVersionId = parseResearchIdFor(input.currentVersionId, "rbrf_"); if (!currentVersionId.ok) return currentVersionId;
  const version = parseEntityVersion(input.version); if (!version.ok) return version;
  const versions: ResearchBriefVersion[] = [];
  for (const value of input.versions) {
    const parsed = parseResearchBriefVersion(value); if (!parsed.ok) return parsed;
    const previous = versions[versions.length - 1];
    if (parsed.value.projectId !== projectId.value.id || parsed.value.versionNumber !== versions.length + 1 || (previous !== undefined && parsed.value.supersedes !== previous.id) || versions.some((item) => item.id === parsed.value.id)) return err(researchError("invalid_research_brief"));
    versions.push(parsed.value);
  }
  const active = versions[versions.length - 1];
  if (active?.id !== currentVersionId.value.id) return err(researchError("invalid_research_brief"));
  const proposals: BriefChangeProposal[] = [];
  for (const value of input.proposals) {
    if (!isRecord(value)) return err(researchError("invalid_brief_change"));
    const base = versions.find((item) => item.id === value.baseVersionId); if (base === undefined) return err(researchError("invalid_brief_change"));
    const parsed = parseBriefChangeProposal(value, base); if (!parsed.ok || parsed.value.briefId !== id.value.id || proposals.some((item) => item.id === parsed.value.id)) return err(researchError("invalid_brief_change"));
    if (parsed.value.status === "confirmed" && !versions.some((item) => item.id === parsed.value.activatedVersionId)) return err(researchError("invalid_brief_change"));
    proposals.push(parsed.value);
  }
  let importState: ResearchBrief["importState"];
  if (input.importState !== undefined) {
    if (!isRecord(input.importState) || input.importState.status !== "draft") return err(researchError("invalid_research_brief"));
    const draftSource = parseResearchSource(input.importState.source); if (!draftSource.ok) return draftSource;
    if (draftSource.value.authority !== "imported_unconfirmed") return err(researchError("invalid_research_brief"));
    importState = cloneFrozen({ status: "draft" as const, source: draftSource.value });
  }
  let activationSource: ResearchSource | undefined;
  if (input.activationSource !== undefined) {
    const parsed = parseResearchSource(input.activationSource); if (!parsed.ok) return parsed;
    if (parsed.value.authority !== "user_confirmed") return err(researchError("user_confirmation_required"));
    activationSource = parsed.value;
  }
  if (importState !== undefined && activationSource !== undefined) return err(researchError("invalid_research_brief"));
  return ok(cloneFrozen({ id: id.value.id, projectId: projectId.value.id, currentVersionId: currentVersionId.value.id, versions, proposals, version: version.value, ...(importState ? { importState } : {}), ...(activationSource ? { activationSource } : {}) }));
}

export function createResearchBrief(input: ResearchBriefInput, ports: { readonly clock: Clock; readonly idFactory: IdFactory }): ResearchResult<ResearchBrief> {
  if (!isRecord(input)) return err(researchError("invalid_research_brief"));
  const projectId = parseResearchIdFor(input.projectId, "rprj_"); if (!projectId.ok) return projectId;
  const source = parseResearchSource(input.source); if (!source.ok) return source;
  const fields = parseVersionFields(input); if (!fields.ok) return fields;
  const briefId = parseResearchIdFor(ports.idFactory.create("rbrf_"), "rbrf_"); if (!briefId.ok) return briefId;
  const versionId = parseResearchIdFor(ports.idFactory.create("rbrf_"), "rbrf_"); if (!versionId.ok) return versionId;
  const now = readClock(ports.clock); if (!now.ok) return now;
  const version = parseResearchBriefVersion({ id: versionId.value.id, projectId: projectId.value.id, versionNumber: 1, ...fields.value, source: source.value, createdAt: now.value });
  if (!version.ok) return version;
  return parseResearchBrief({ id: briefId.value.id, projectId: projectId.value.id, currentVersionId: version.value.id, versions: [version.value], proposals: [], version: initialEntityVersion() });
}

export function createImportedResearchBriefDraft(
  input: ResearchBriefInput,
  ports: { readonly clock: Clock; readonly idFactory: IdFactory },
): ResearchResult<ResearchBrief> {
  const source = parseResearchSource(input.source); if (!source.ok) return source;
  if (source.value.authority !== "imported_unconfirmed") return err(researchError("invalid_research_brief"));
  const brief = createResearchBrief(input, ports); if (!brief.ok) return brief;
  return parseResearchBrief({ ...brief.value, importState: { status: "draft", source: source.value } });
}

export function activateImportedResearchBriefDraft(
  briefInput: ResearchBrief,
  actorInput: ResearchActor,
  expectedVersion: EntityVersion,
  clock: Clock,
): ResearchResult<ResearchBrief> {
  const brief = parseResearchBrief(briefInput); if (!brief.ok) return brief;
  if (brief.value.importState === undefined) return err(researchError("invalid_research_brief"));
  const actor = validateResearchActor(actorInput); if (!actor.ok || actor.value.kind !== "user") return err(researchError("user_confirmation_required"));
  const next = advanceEntityVersion(brief.value.version, expectedVersion); if (!next.ok) return next;
  const confirmed = confirmResearchSource(brief.value.importState.source, actor.value, clock); if (!confirmed.ok) return confirmed;
  return parseResearchBrief({ ...brief.value, importState: undefined, version: next.value, activationSource: confirmed.value.source });
}

export function createBriefChangeProposal(briefInput: ResearchBrief, input: CreateBriefChangeProposalInput, ports: { readonly clock: Clock; readonly idFactory: IdFactory }): ResearchResult<{ readonly brief: ResearchBrief; readonly proposal: BriefChangeProposal }> {
  const brief = parseResearchBrief(briefInput); if (!brief.ok) return brief;
  if (!isRecord(input) || !isNonBlankString(input.reason) || !isRecord(input.changes)) return err(researchError("invalid_brief_change"));
  const source = parseResearchSource(input.source); if (!source.ok) return source;
  const active = brief.value.versions.at(-1);
  if (active === undefined) return err(researchError("invalid_research_brief"));
  const merged = mergeFields(active, input.changes); if (!merged.ok) return merged;
  const id = parseResearchIdFor(ports.idFactory.create("rbrf_"), "rbrf_"); if (!id.ok) return id;
  const at = readClock(ports.clock); if (!at.ok) return at;
  const proposal = parseBriefChangeProposal({ id: id.value.id, briefId: brief.value.id, baseVersionId: active.id, changes: input.changes, diffFields: Object.keys(input.changes).sort(), reason: input.reason, source: source.value, createdAt: at.value, status: "pending" }, active);
  if (!proposal.ok) return proposal;
  const nextVersion = advanceEntityVersion(brief.value.version, brief.value.version); if (!nextVersion.ok) return nextVersion;
  const updated = parseResearchBrief({ ...brief.value, proposals: [...brief.value.proposals, proposal.value], version: nextVersion.value });
  if (!updated.ok) return updated;
  return ok(cloneFrozen({ brief: updated.value, proposal: proposal.value }));
}

export function confirmBriefChangeProposal(briefInput: ResearchBrief, proposalId: string, actorInput: ResearchActor, expectedVersion: EntityVersion, ports: { readonly clock: Clock; readonly idFactory: IdFactory }): ResearchResult<ResearchBrief> {
  const brief = parseResearchBrief(briefInput); if (!brief.ok) return brief;
  const actor = validateResearchActor(actorInput); if (!actor.ok || actor.value.kind !== "user") return err(researchError("user_confirmation_required"));
  const expected = parseEntityVersion(expectedVersion); if (!expected.ok) return expected;
  const nextEntityVersion = advanceEntityVersion(brief.value.version, expected.value); if (!nextEntityVersion.ok) return nextEntityVersion;
  const id = parseResearchIdFor(proposalId, "rbrf_"); if (!id.ok) return id;
  const proposalIndex = brief.value.proposals.findIndex((item) => item.id === id.value.id);
  if (proposalIndex < 0) return err(researchError("brief_change_not_found"));
  const proposal = brief.value.proposals.at(proposalIndex);
  if (proposal === undefined) return err(researchError("brief_change_not_found"));
  if (proposal.status !== "pending") return err(researchError("brief_change_already_decided"));
  const active = brief.value.versions.at(-1);
  if (active === undefined) return err(researchError("invalid_research_brief"));
  if (proposal.baseVersionId !== active.id) return err(researchError("version_conflict"));
  const fields = mergeFields(active, proposal.changes); if (!fields.ok) return fields;
  const confirmed = confirmResearchSource(proposal.source, actor.value, ports.clock); if (!confirmed.ok) return confirmed;
  const newVersionId = parseResearchIdFor(ports.idFactory.create("rbrf_"), "rbrf_"); if (!newVersionId.ok) return newVersionId;
  const newVersion = parseResearchBriefVersion({ id: newVersionId.value.id, projectId: brief.value.projectId, versionNumber: active.versionNumber + 1, ...fields.value, source: confirmed.value.source, createdAt: confirmed.value.confirmedAt, supersedes: active.id });
  if (!newVersion.ok) return newVersion;
  const decided = cloneFrozen({ ...proposal, status: "confirmed" as const, confirmedBy: actor.value, confirmedAt: confirmed.value.confirmedAt, activatedVersionId: newVersion.value.id });
  const proposals = [...brief.value.proposals]; proposals[proposalIndex] = decided;
  return parseResearchBrief({ ...brief.value, currentVersionId: newVersion.value.id, versions: [...brief.value.versions, newVersion.value], proposals, version: nextEntityVersion.value });
}

export function getActiveResearchBriefVersion(briefInput: ResearchBrief): ResearchBriefVersion | undefined {
  const brief = parseResearchBrief(briefInput); if (!brief.ok) return undefined;
  if (brief.value.importState !== undefined) return undefined;
  const active = brief.value.versions.at(-1);
  return active === undefined ? undefined : cloneFrozen(active);
}

export function getResearchBriefVersion(briefInput: ResearchBrief, versionId: string): ResearchBriefVersion | undefined {
  const brief = parseResearchBrief(briefInput); if (!brief.ok) return undefined;
  const id = parseResearchIdFor(versionId, "rbrf_"); if (!id.ok) return undefined;
  const found = brief.value.versions.find((item) => item.id === id.value.id);
  return found === undefined ? undefined : cloneFrozen(found);
}

export function exportResearchBriefYaml(versionInput: ResearchBriefVersion): ResearchResult<string> {
  const version = parseResearchBriefVersion(versionInput); if (!version.ok) return version;
  const fields: [string, unknown][] = [
    ["id", version.value.id], ["projectId", version.value.projectId], ["version", version.value.versionNumber],
    ["projectQuestion", version.value.projectQuestion], ["currentStage", version.value.currentStage], ["currentTask", version.value.currentTask],
    ["targetArtifacts", version.value.targetArtifacts], ["fixedDecisions", version.value.fixedDecisions], ["allowedChanges", version.value.allowedChanges],
    ["forbiddenChanges", version.value.forbiddenChanges], ["expectedDeltas", version.value.expectedDeltas], ["evidenceBoundaries", version.value.evidenceBoundaries],
    ["explicitNonGoals", version.value.explicitNonGoals], ["createdAt", version.value.createdAt],
  ];
  const lines: string[] = ["# Projection only; import requires validation and explicit user confirmation."];
  for (const [key, value] of fields) { const serialized = canonicalStringify(value); if (!serialized.ok) return serialized; lines.push(`${key}: ${serialized.value}`); }
  return ok(`${lines.join("\n")}\n`);
}
