import { cloneFrozen, isNonBlankString, isRecord, readClock } from "../domain-validation.js";
import { researchError } from "../errors.js";
import type { Clock } from "../clock.js";
import type { IdFactory } from "../index.js";
import { stableResearchHash } from "../identity/canonical-json.js";
import { advanceEntityVersion, initialEntityVersion, parseEntityVersion, type EntityVersion } from "../identity/entity-version.js";
import { parseResearchIdFor } from "../identity/research-id.js";
import { err, ok, type ResearchResult } from "../result.js";
import { validateResearchActor, type ResearchActor } from "../authority/actor.js";
import { validateUtcTimestamp } from "../authority/source.js";

export const RESEARCH_ROOM_EVIDENCE_CLASSES = ["owner_scenario", "synthetic_fixture", "synthetic_adversarial_fixture", "user_supplied_review_input"] as const;
export type ResearchRoomEvidenceClass = (typeof RESEARCH_ROOM_EVIDENCE_CLASSES)[number];
export const RESEARCH_ROOM_DISPOSITIONS = ["accepted", "rejected", "modified_accepted", "deferred", "direction_changed"] as const;
export type ResearchRoomDispositionKind = (typeof RESEARCH_ROOM_DISPOSITIONS)[number];
export type ResearchRoomProviderStatus = "semantic_ready" | "ledger_only";
export type ResearchRoomFindingKind = "reasonable_increment" | "target_substitution" | "repeated_audit" | "argument_leap" | "pseudo_depth" | "evidence_gap" | "provider_unavailable";
export type ResearchRoomDeltaKind = "mechanism_relation" | "conceptual_distinction" | "evidence_link" | "counterexample_or_negative_case" | "boundary_condition" | "alternative_explanation" | "causal_step_clarification" | "theoretical_contribution" | "research_object_transformation" | "no_substantive_delta" | "unproven";

export interface ResearchRoomFinding {
  readonly kind: ResearchRoomFindingKind;
  readonly severity: "info" | "warning" | "error";
  readonly summary: string;
  readonly affectedDecisionIds: readonly string[];
}

export interface ResearchRoomAnalysisPayload {
  readonly schemaVersion: "1.0.0";
  readonly proposal: string;
  readonly findings: readonly ResearchRoomFinding[];
  readonly argumentDelta: {
    readonly kind: ResearchRoomDeltaKind;
    readonly summary: string;
    readonly genuineAdditions: readonly string[];
  };
  readonly alternativeExplanations: readonly string[];
  readonly unknowns: readonly string[];
  readonly minimalCorrection: string;
  readonly unproven: readonly string[];
}

export interface ResearchRoomStateBinding {
  readonly projectId: string;
  readonly stateHash: string;
  readonly briefVersionId: string;
  readonly briefVersionNumber: number;
  readonly currentEpisodeId?: string;
  readonly currentEpisodeVersion?: number;
  readonly decisions: readonly { readonly id: string; readonly version: number; readonly status: "accepted" | "frozen" }[];
  readonly issues: readonly { readonly id: string; readonly version: number; readonly status: string }[];
}

export interface ResearchRoomContextManifest {
  readonly schemaVersion: "1.0.0";
  readonly reviewId: string;
  readonly providerId: string;
  readonly providerKind: "none" | "deterministic_fixture" | "local" | "external";
  readonly networkRequired: boolean;
  readonly sendStatus: "not_sent" | "sent_to_provider";
  readonly networkUsed: boolean;
  readonly fields: readonly {
    readonly category: "research_question" | "current_task" | "fixed_decisions" | "accepted_decisions" | "open_issues" | "current_episode" | "single_suggestion";
    readonly source: "active_research_brief" | "versioned_research_state" | "explicit_user_input";
    readonly sensitivity: "research_state" | "user_supplied_text";
    readonly included: true;
    readonly truncated: boolean;
  }[];
  readonly contextHash: string;
  readonly suggestionHash: string;
  readonly stateBindingHash: string;
  readonly evidenceClass: ResearchRoomEvidenceClass;
  readonly countsAsExternalEvidence: false;
}

export interface ResearchRoomReceipt {
  readonly schemaVersion: "1.0.0";
  readonly id: string;
  readonly projectId: string;
  readonly reviewId: string;
  readonly sourceEpisodeId?: string;
  readonly status: "committed" | "rolled_back";
  readonly providerStatus: ResearchRoomProviderStatus;
  readonly ledgerOnlyReason?: "provider_not_configured" | "provider_failed" | "provider_timeout" | "provider_invalid_response";
  readonly evidenceClass: ResearchRoomEvidenceClass;
  readonly countsAsExternalEvidence: false;
  readonly suggestionHash: string;
  readonly manifest: ResearchRoomContextManifest;
  readonly analysis: ResearchRoomAnalysisPayload;
  readonly disposition: {
    readonly kind: ResearchRoomDispositionKind;
    readonly reason: string;
    readonly modifiedProposal?: string;
    readonly redirectQuestion?: string;
  };
  readonly before: ResearchRoomStateBinding;
  readonly after: ResearchRoomStateBinding;
  readonly rollback: {
    readonly available: boolean;
    readonly priorQuestion?: string;
    readonly rolledBackAt?: string;
    readonly reason?: string;
    readonly restoredStateHash?: string;
    readonly rollbackBriefVersionId?: string;
  };
  readonly authority: { readonly actor: ResearchActor & { readonly kind: "user" }; readonly confirmedAt: string };
  readonly version: EntityVersion;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly receiptHash: string;
}

const FINDING_KINDS = new Set<ResearchRoomFindingKind>(["reasonable_increment", "target_substitution", "repeated_audit", "argument_leap", "pseudo_depth", "evidence_gap", "provider_unavailable"]);
const DELTA_KINDS = new Set<ResearchRoomDeltaKind>(["mechanism_relation", "conceptual_distinction", "evidence_link", "counterexample_or_negative_case", "boundary_condition", "alternative_explanation", "causal_step_clarification", "theoretical_contribution", "research_object_transformation", "no_substantive_delta", "unproven"]);

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort(); const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function text(value: unknown, max = 8_192): string | undefined {
  if (!isNonBlankString(value)) return undefined;
  const normalized = value.trim();
  return Buffer.byteLength(normalized, "utf8") <= max ? normalized : undefined;
}

function stringList(value: unknown, maxItems = 32): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length > maxItems) return undefined;
  const values: string[] = [];
  for (const item of value) { const parsed = text(item, 2_048); if (parsed === undefined || values.includes(parsed)) return undefined; values.push(parsed); }
  return cloneFrozen(values);
}

function sha(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value); }

export function parseResearchRoomEvidenceClass(value: unknown): ResearchResult<ResearchRoomEvidenceClass> {
  return typeof value === "string" && RESEARCH_ROOM_EVIDENCE_CLASSES.includes(value as ResearchRoomEvidenceClass)
    ? ok(value as ResearchRoomEvidenceClass) : err(researchError("invalid_research_room_review"));
}

export function parseResearchRoomAnalysisPayload(input: unknown, options: { readonly providerResponse?: boolean } = {}): ResearchResult<ResearchRoomAnalysisPayload> {
  if (!isRecord(input) || !hasExactKeys(input, ["schemaVersion", "proposal", "findings", "argumentDelta", "alternativeExplanations", "unknowns", "minimalCorrection", "unproven"]) || input.schemaVersion !== "1.0.0" || !Array.isArray(input.findings) || input.findings.length > 32 || !isRecord(input.argumentDelta)) return err(researchError("invalid_research_room_review"));
  const proposal = text(input.proposal, 16_384); const minimalCorrection = text(input.minimalCorrection, 4_096);
  const alternatives = stringList(input.alternativeExplanations); const unknowns = stringList(input.unknowns); const unproven = stringList(input.unproven);
  if (proposal === undefined || minimalCorrection === undefined || alternatives === undefined || unknowns === undefined || unproven === undefined || unproven.length === 0) return err(researchError("invalid_research_room_review"));
  const findings: ResearchRoomFinding[] = [];
  for (const raw of input.findings) {
    if (!isRecord(raw) || !hasExactKeys(raw, ["kind", "severity", "summary", "affectedDecisionIds"]) || !FINDING_KINDS.has(raw.kind as ResearchRoomFindingKind) || !["info", "warning", "error"].includes(String(raw.severity))) return err(researchError("invalid_research_room_review"));
    if (options.providerResponse && raw.kind === "provider_unavailable") return err(researchError("invalid_research_room_review"));
    const summary = text(raw.summary, 4_096); if (summary === undefined || !Array.isArray(raw.affectedDecisionIds) || raw.affectedDecisionIds.length > 64) return err(researchError("invalid_research_room_review"));
    const ids: string[] = []; for (const id of raw.affectedDecisionIds) { const parsed = parseResearchIdFor(id, "rdec_"); if (!parsed.ok || ids.includes(parsed.value.id)) return err(researchError("invalid_research_room_review")); ids.push(parsed.value.id); }
    findings.push({ kind: raw.kind as ResearchRoomFindingKind, severity: raw.severity as ResearchRoomFinding["severity"], summary, affectedDecisionIds: ids });
  }
  if (!hasExactKeys(input.argumentDelta, ["kind", "summary", "genuineAdditions"]) || !DELTA_KINDS.has(input.argumentDelta.kind as ResearchRoomDeltaKind) || (options.providerResponse && input.argumentDelta.kind === "unproven")) return err(researchError("invalid_research_room_review"));
  const deltaSummary = text(input.argumentDelta.summary, 4_096); const additions = stringList(input.argumentDelta.genuineAdditions);
  if (deltaSummary === undefined || additions === undefined) return err(researchError("invalid_research_room_review"));
  return ok(cloneFrozen({ schemaVersion: "1.0.0", proposal, findings, argumentDelta: { kind: input.argumentDelta.kind as ResearchRoomDeltaKind, summary: deltaSummary, genuineAdditions: additions }, alternativeExplanations: alternatives, unknowns, minimalCorrection, unproven }));
}

export function parseResearchRoomStateBinding(input: unknown): ResearchResult<ResearchRoomStateBinding> {
  if (!isRecord(input) || !sha(input.stateHash) || !Number.isSafeInteger(input.briefVersionNumber) || Number(input.briefVersionNumber) < 1 || !Array.isArray(input.decisions) || !Array.isArray(input.issues)) return err(researchError("invalid_research_room_receipt"));
  const project = parseResearchIdFor(input.projectId, "rprj_"); const brief = parseResearchIdFor(input.briefVersionId, "rbrf_"); if (!project.ok || !brief.ok) return err(researchError("invalid_research_room_receipt"));
  let currentEpisodeId: string | undefined; let currentEpisodeVersion: number | undefined;
  if (input.currentEpisodeId !== undefined || input.currentEpisodeVersion !== undefined) { const episode = parseResearchIdFor(input.currentEpisodeId, "repi_"); if (!episode.ok || !Number.isSafeInteger(input.currentEpisodeVersion) || Number(input.currentEpisodeVersion) < 1) return err(researchError("invalid_research_room_receipt")); currentEpisodeId = episode.value.id; currentEpisodeVersion = Number(input.currentEpisodeVersion); }
  const decisions: ResearchRoomStateBinding["decisions"][number][] = [];
  for (const raw of input.decisions) { if (!isRecord(raw) || !["accepted", "frozen"].includes(String(raw.status)) || !Number.isSafeInteger(raw.version) || Number(raw.version) < 1) return err(researchError("invalid_research_room_receipt")); const id = parseResearchIdFor(raw.id, "rdec_"); if (!id.ok) return err(researchError("invalid_research_room_receipt")); decisions.push({ id: id.value.id, version: Number(raw.version), status: raw.status as "accepted" | "frozen" }); }
  const issues: ResearchRoomStateBinding["issues"][number][] = [];
  for (const raw of input.issues) { if (!isRecord(raw) || !isNonBlankString(raw.status) || !Number.isSafeInteger(raw.version) || Number(raw.version) < 1) return err(researchError("invalid_research_room_receipt")); const id = parseResearchIdFor(raw.id, "riss_"); if (!id.ok) return err(researchError("invalid_research_room_receipt")); issues.push({ id: id.value.id, version: Number(raw.version), status: raw.status.trim() }); }
  return ok(cloneFrozen({ projectId: project.value.id, stateHash: input.stateHash, briefVersionId: brief.value.id, briefVersionNumber: Number(input.briefVersionNumber), ...(currentEpisodeId ? { currentEpisodeId, currentEpisodeVersion } : {}), decisions, issues }));
}

export function parseResearchRoomContextManifest(input: unknown): ResearchResult<ResearchRoomContextManifest> {
  if (!isRecord(input) || input.schemaVersion !== "1.0.0" || !isNonBlankString(input.providerId) || !["none", "deterministic_fixture", "local", "external"].includes(String(input.providerKind)) || typeof input.networkRequired !== "boolean" || !["not_sent", "sent_to_provider"].includes(String(input.sendStatus)) || typeof input.networkUsed !== "boolean" || !Array.isArray(input.fields) || !sha(input.contextHash) || !sha(input.suggestionHash) || !sha(input.stateBindingHash) || input.countsAsExternalEvidence !== false) return err(researchError("invalid_research_room_receipt"));
  const review = parseResearchIdFor(input.reviewId, "rrvw_"); const evidence = parseResearchRoomEvidenceClass(input.evidenceClass); if (!review.ok || !evidence.ok) return err(researchError("invalid_research_room_receipt"));
  const fields: ResearchRoomContextManifest["fields"][number][] = [];
  for (const raw of input.fields) { if (!isRecord(raw) || !hasExactKeys(raw, ["category", "source", "sensitivity", "included", "truncated"]) || !["research_question", "current_task", "fixed_decisions", "accepted_decisions", "open_issues", "current_episode", "single_suggestion"].includes(String(raw.category)) || !["active_research_brief", "versioned_research_state", "explicit_user_input"].includes(String(raw.source)) || !["research_state", "user_supplied_text"].includes(String(raw.sensitivity)) || raw.included !== true || typeof raw.truncated !== "boolean") return err(researchError("invalid_research_room_receipt")); fields.push(raw as unknown as ResearchRoomContextManifest["fields"][number]); }
  return ok(cloneFrozen({ ...input, reviewId: review.value.id, evidenceClass: evidence.value, countsAsExternalEvidence: false, fields } as unknown as ResearchRoomContextManifest));
}

function receiptPayload(value: Omit<ResearchRoomReceipt, "receiptHash">): Omit<ResearchRoomReceipt, "receiptHash"> { return value; }

export function parseResearchRoomReceipt(input: unknown): ResearchResult<ResearchRoomReceipt> {
  if (!isRecord(input) || input.schemaVersion !== "1.0.0" || !["committed", "rolled_back"].includes(String(input.status)) || !["semantic_ready", "ledger_only"].includes(String(input.providerStatus)) || input.countsAsExternalEvidence !== false || !isRecord(input.disposition) || !isRecord(input.rollback) || !isRecord(input.authority) || !sha(input.suggestionHash) || !sha(input.receiptHash)) return err(researchError("invalid_research_room_receipt"));
  const id = parseResearchIdFor(input.id, "rrcp_"); const project = parseResearchIdFor(input.projectId, "rprj_"); const review = parseResearchIdFor(input.reviewId, "rrvw_"); const evidence = parseResearchRoomEvidenceClass(input.evidenceClass); const manifest = parseResearchRoomContextManifest(input.manifest); const analysis = parseResearchRoomAnalysisPayload(input.analysis); const before = parseResearchRoomStateBinding(input.before); const after = parseResearchRoomStateBinding(input.after); const version = parseEntityVersion(input.version); const createdAt = validateUtcTimestamp(input.createdAt); const updatedAt = validateUtcTimestamp(input.updatedAt);
  if (!id.ok || !project.ok || !review.ok || !evidence.ok || !manifest.ok || !analysis.ok || !before.ok || !after.ok || !version.ok || !createdAt.ok || !updatedAt.ok) return err(researchError("invalid_research_room_receipt"));
  if (input.sourceEpisodeId !== undefined) { const episode = parseResearchIdFor(input.sourceEpisodeId, "repi_"); if (!episode.ok) return err(researchError("invalid_research_room_receipt")); }
  if (!RESEARCH_ROOM_DISPOSITIONS.includes(input.disposition.kind as ResearchRoomDispositionKind) || text(input.disposition.reason, 4_096) === undefined) return err(researchError("invalid_research_room_receipt"));
  const actor = validateResearchActor(input.authority.actor); const confirmedAt = validateUtcTimestamp(input.authority.confirmedAt); if (!actor.ok || actor.value.kind !== "user" || !confirmedAt.ok) return err(researchError("user_confirmation_required"));
  const withoutHash = { ...input }; delete withoutHash.receiptHash; const calculated = stableResearchHash(withoutHash); if (!calculated.ok || calculated.value !== input.receiptHash) return err(researchError("invalid_research_room_receipt"));
  return ok(cloneFrozen(input as unknown as ResearchRoomReceipt));
}

export function createResearchRoomReceipt(input: Omit<ResearchRoomReceipt, "schemaVersion" | "id" | "status" | "authority" | "version" | "createdAt" | "updatedAt" | "receiptHash"> & { readonly actor: ResearchActor }, ports: { readonly clock: Clock; readonly idFactory: IdFactory }): ResearchResult<ResearchRoomReceipt> {
  const actor = validateResearchActor(input.actor); if (!actor.ok || actor.value.kind !== "user") return err(researchError("user_confirmation_required"));
  const id = parseResearchIdFor(ports.idFactory.create("rrcp_"), "rrcp_"); const at = readClock(ports.clock); if (!id.ok || !at.ok) return err(researchError("invalid_research_room_receipt"));
  const value = receiptPayload({ schemaVersion: "1.0.0", id: id.value.id, projectId: input.projectId, reviewId: input.reviewId, ...(input.sourceEpisodeId ? { sourceEpisodeId: input.sourceEpisodeId } : {}), status: "committed", providerStatus: input.providerStatus, ...(input.ledgerOnlyReason ? { ledgerOnlyReason: input.ledgerOnlyReason } : {}), evidenceClass: input.evidenceClass, countsAsExternalEvidence: false, suggestionHash: input.suggestionHash, manifest: input.manifest, analysis: input.analysis, disposition: input.disposition, before: input.before, after: input.after, rollback: input.rollback, authority: { actor: actor.value, confirmedAt: at.value }, version: initialEntityVersion(), createdAt: at.value, updatedAt: at.value });
  const hash = stableResearchHash(value); return hash.ok ? parseResearchRoomReceipt({ ...value, receiptHash: hash.value }) : hash;
}

export function rollBackResearchRoomReceipt(currentInput: ResearchRoomReceipt, input: { readonly actor: ResearchActor; readonly expectedVersion: EntityVersion; readonly reason: string; readonly restoredStateHash: string; readonly rollbackBriefVersionId?: string }, clock: Clock): ResearchResult<ResearchRoomReceipt> {
  const current = parseResearchRoomReceipt(currentInput); const actor = validateResearchActor(input.actor); const reason = text(input.reason, 4_096); const expected = parseEntityVersion(input.expectedVersion);
  if (!current.ok) return current; if (!actor.ok || actor.value.kind !== "user") return err(researchError("user_confirmation_required")); if (current.value.status !== "committed" || !current.value.rollback.available) return err(researchError("invalid_research_room_transition")); if (reason === undefined || !sha(input.restoredStateHash) || !expected.ok) return err(researchError("invalid_research_room_receipt"));
  const next = advanceEntityVersion(current.value.version, expected.value); const at = readClock(clock); if (!next.ok || !at.ok) return err(researchError("version_conflict"));
  const { receiptHash: _oldHash, ...base } = current.value;
  void _oldHash;
  const withoutHash = receiptPayload({ ...base, status: "rolled_back", rollback: { available: false, ...(current.value.rollback.priorQuestion ? { priorQuestion: current.value.rollback.priorQuestion } : {}), rolledBackAt: at.value, reason, restoredStateHash: input.restoredStateHash, ...(input.rollbackBriefVersionId ? { rollbackBriefVersionId: input.rollbackBriefVersionId } : {}) }, version: next.value, updatedAt: at.value });
  const hash = stableResearchHash(withoutHash); return hash.ok ? parseResearchRoomReceipt({ ...withoutHash, receiptHash: hash.value }) : hash;
}
