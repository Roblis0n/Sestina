import type { ResearchActor } from "../authority/actor.js";
import { validateResearchActor } from "../authority/actor.js";
import { validateUtcTimestamp } from "../authority/source.js";
import type { Clock } from "../clock.js";
import { cloneFrozen, isRecord, readClock } from "../domain-validation.js";
import { researchError } from "../errors.js";
import { stableResearchHash } from "../identity/canonical-json.js";
import {
  advanceEntityVersion,
  initialEntityVersion,
  parseEntityVersion,
  type EntityVersion,
} from "../identity/entity-version.js";
import { parseResearchIdFor } from "../identity/research-id.js";
import type { IdFactory } from "../index.js";
import { err, ok, type ResearchResult } from "../result.js";
import { parseResearchRoomStateBinding, type ResearchRoomStateBinding } from "../room/research-room.js";

export const CORRECTION_APPEAL_STATUSES = [
  "draft",
  "recorded",
  "awaiting_send_confirmation",
  "second_opinion_running",
  "second_opinion_ready",
  "appeal_record_only",
  "waiting_user_resolution",
  "provider_failed",
  "cancelled",
  "stale_conflicted",
  "resolved",
] as const;
export type CorrectionAppealStatus = (typeof CORRECTION_APPEAL_STATUSES)[number];

const LEGAL_APPEAL_TRANSITIONS: Readonly<Record<CorrectionAppealStatus, readonly CorrectionAppealStatus[]>> = Object.freeze({
  draft: ["recorded", "stale_conflicted"],
  recorded: ["appeal_record_only", "awaiting_send_confirmation", "waiting_user_resolution", "stale_conflicted", "resolved"],
  awaiting_send_confirmation: ["second_opinion_running", "cancelled", "stale_conflicted"],
  second_opinion_running: ["second_opinion_ready", "provider_failed", "cancelled", "stale_conflicted"],
  second_opinion_ready: ["waiting_user_resolution", "stale_conflicted", "resolved"],
  appeal_record_only: ["awaiting_send_confirmation", "waiting_user_resolution", "stale_conflicted", "resolved"],
  waiting_user_resolution: ["awaiting_send_confirmation", "appeal_record_only", "stale_conflicted", "resolved"],
  provider_failed: ["appeal_record_only", "awaiting_send_confirmation", "waiting_user_resolution", "stale_conflicted", "resolved"],
  cancelled: ["appeal_record_only", "awaiting_send_confirmation", "waiting_user_resolution", "stale_conflicted", "resolved"],
  stale_conflicted: ["appeal_record_only", "waiting_user_resolution", "resolved"],
  resolved: ["resolved"],
});

function isLegalAppealTransition(from: CorrectionAppealStatus, to: CorrectionAppealStatus): boolean {
  return LEGAL_APPEAL_TRANSITIONS[from].includes(to);
}

export const APPEAL_RESOLUTION_KINDS = [
  "uphold_original_finding",
  "overturn_original_finding",
  "modify_finding_interpretation",
  "defer_insufficient_evidence",
  "record_disagreement_without_resolution",
] as const;
export type AppealResolutionKind = (typeof APPEAL_RESOLUTION_KINDS)[number];

export const SECOND_OPINION_FAILURES = [
  "provider_timeout",
  "provider_offline",
  "provider_failed",
  "response_invalid",
  "response_too_large",
  "persistence_failed",
  "result_write_uncertain",
  "provider_configuration_changed",
] as const;
export type SecondOpinionFailure = (typeof SECOND_OPINION_FAILURES)[number];

export interface AppealSourceBinding {
  readonly projectId: string;
  readonly reviewId: string;
  readonly receiptId: string;
  readonly findingId: string;
  readonly findingSchemaVersion: "1.0.0";
  readonly findingSnapshot: {
    readonly id: string;
    readonly kind: string;
    readonly severity: "info" | "warning" | "error";
    readonly rationale: string;
    readonly minimumRecovery: string;
    readonly decisionIds: readonly string[];
    readonly issueIds: readonly string[];
    readonly authority: "model_proposed";
  };
  readonly findingHash: string;
  readonly suggestionHash: string;
  readonly sourceReceiptHash: string;
  readonly inputBindings: readonly {
    readonly artifactId: string;
    readonly revisionId: string;
    readonly normalizedTextHash: string;
  }[];
  readonly rubric: {
    readonly criterionId: string;
    readonly version: string;
    readonly definition: string;
    readonly hash: string;
    readonly sourceRubricHash: string;
  };
  readonly createdStateBinding: ResearchRoomStateBinding;
  readonly createdStateBindingHash: string;
}

export interface AppealStatement {
  readonly disagreement: string;
  readonly challengedCriterionId: string;
  readonly claimedError: string;
  readonly missingOrMisreadContext: string;
  readonly secondOpinionQuestion: string;
  readonly desiredDisposition?: AppealResolutionKind;
}

export interface AppealStatementVersion {
  readonly version: number;
  readonly statement: AppealStatement;
  readonly actor: ResearchActor & { readonly kind: "user" };
  readonly recordedAt: string;
}

export interface SecondOpinionParticipantSnapshot {
  readonly connectionId: string;
  readonly providerId: string;
  readonly family: "openai_compatible";
  readonly model: string;
  readonly endpointIdentityHash: string;
  readonly configGeneration: number;
  readonly locality: "local" | "external";
}

export interface AppealIndependenceBasis {
  readonly status: "runtime_and_context_isolated" | "same_runtime_not_independent" | "independence_unproven";
  readonly originalConnectionId: string;
  readonly secondConnectionId: string;
  readonly identityComparison: "different_runtime_identity" | "same_runtime_identity" | "identity_unproven";
  readonly contextIsolation: "original_verdict_reason_confidence_and_raw_response_excluded";
}

export interface SecondOpinionManifest {
  readonly schemaVersion: "1.0.0";
  readonly canonicalHash: string;
  readonly requestHash: string;
  readonly requestBodyHash: string;
  readonly requestBodyBytes: number;
  readonly includedFields: readonly string[];
  readonly includedObjects: readonly {
    readonly kind: "brief" | "decision" | "issue" | "evidence";
    readonly id: string;
    readonly version: number;
    readonly hash: string;
    readonly fields: Readonly<Record<string, string>>;
  }[];
  readonly excludedFields: readonly string[];
  readonly tokenEstimate: { readonly status: "available"; readonly value: number } | { readonly status: "unavailable" };
  readonly costEstimate: { readonly status: "available"; readonly currency: string; readonly value: number } | { readonly status: "unavailable" };
  readonly stateBindingHash: string;
}

export interface SecondOpinionEvidenceSpan {
  readonly projectId: string;
  readonly artifactId: string;
  readonly revisionId: string;
  readonly normalizedTextHash: string;
  readonly start: number;
  readonly end: number;
  readonly quote: string;
  readonly quoteHash: string;
  readonly normalizationVersion: string;
  readonly indexUnit: string;
}

export interface SecondOpinionResult {
  readonly schemaVersion: "1.0.0";
  readonly appealId: string;
  readonly attemptId: string;
  readonly criterionId: string;
  readonly assessment: "present" | "not_present" | "uncertain" | "insufficient_context";
  readonly evidenceSpans: readonly SecondOpinionEvidenceSpan[];
  readonly publicRationale: string;
  readonly missingContext: readonly string[];
  readonly alternativeExplanations: readonly string[];
  readonly minimalCorrection: string;
  readonly uncertaintySources: readonly string[];
  readonly hashes: {
    readonly schemaHash: string;
    readonly rubricHash: string;
    readonly requestHash: string;
    readonly inputHash: string;
  };
}

export interface AppealComparison {
  readonly schemaVersion: "1.0.0";
  readonly relation: "agreement" | "direct_contradiction" | "qualified_agreement" | "insufficient_for_comparison";
  readonly agreement: boolean;
  readonly directContradiction: boolean;
  readonly qualifiedAgreement: boolean;
  readonly newEvidence: boolean;
  readonly missingContextChange: boolean;
  readonly redundantRestatement: boolean;
  readonly alternativeExplanation: boolean;
  readonly unresolvedConflict: boolean;
  readonly insufficientForComparison: boolean;
  readonly nonRedundantIncrement: "present" | "absent" | "unproven";
  readonly reasons: readonly string[];
  readonly sourceReferences: readonly string[];
  readonly authority: "system_derived";
  readonly canResolveAppeal: false;
}

export interface SecondOpinionAttempt {
  readonly id: string;
  readonly ordinal: number;
  readonly status: "prepared" | "running" | "completed" | "failed" | "cancelled" | "unknown";
  readonly participant: SecondOpinionParticipantSnapshot;
  readonly independenceBasis: AppealIndependenceBasis;
  readonly manifest: SecondOpinionManifest;
  readonly confirmationNonce: string;
  readonly preparedAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly cancelledAt?: string;
  readonly failedAt?: string;
  readonly failure?: SecondOpinionFailure;
  readonly result?: SecondOpinionResult;
  readonly comparison?: AppealComparison;
}

export interface AppealReceipt {
  readonly schemaVersion: "1.0.0";
  readonly id: string;
  readonly projectId: string;
  readonly appealId: string;
  readonly resolutionId: string;
  readonly originalFindingHash: string;
  readonly sourceAppealHash: string;
  readonly secondOpinionResultHash?: string;
  readonly comparisonHash?: string;
  readonly independenceStatus: AppealIndependenceBasis["status"] | "not_requested";
  readonly before: { readonly status: CorrectionAppealStatus; readonly version: number };
  readonly after: { readonly status: "resolved"; readonly version: number };
  readonly command: { readonly kind: AppealResolutionKind; readonly publicReason: string };
  readonly relatedObjects: {
    readonly reviewId: string;
    readonly sourceReceiptId: string;
    readonly findingId: string;
    readonly inputRevisionIds: readonly string[];
  };
  readonly unproven: readonly string[];
  readonly authority: {
    readonly actor: ResearchActor & { readonly kind: "user" };
    readonly confirmedAt: string;
  };
  readonly receiptHash: string;
}

export interface AppealResolution {
  readonly id: string;
  readonly kind: AppealResolutionKind;
  readonly publicReason: string;
  readonly supersedesResolutionId?: string;
  readonly authority: AppealReceipt["authority"];
  readonly receipt: AppealReceipt;
}

export interface AppealTransition {
  readonly from?: CorrectionAppealStatus;
  readonly to: CorrectionAppealStatus;
  readonly actor: "user" | "kernel";
  readonly at: string;
  readonly reason: string;
}

export interface CorrectionAppeal {
  readonly schemaVersion: "1.0.0";
  readonly id: string;
  readonly projectId: string;
  readonly lineage: { readonly previousAppealId?: string; readonly rootAppealId: string };
  readonly source: AppealSourceBinding;
  readonly status: CorrectionAppealStatus;
  readonly statements: readonly AppealStatementVersion[];
  readonly attempts: readonly SecondOpinionAttempt[];
  readonly resolutions: readonly AppealResolution[];
  readonly transitions: readonly AppealTransition[];
  readonly version: EntityVersion;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const REQUIRED_SECOND_OPINION_EXCLUSIONS = [
  "original_finding_verdict",
  "original_finding_public_rationale",
  "original_finding_confidence",
  "original_provider_raw_response",
  "other_agent_assessments",
] as const;

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((item, index) => item === expected[index]);
}

function exactOptional(value: Record<string, unknown>, required: readonly string[], optional: readonly string[]): boolean {
  const keys = Object.keys(value);
  return required.every((key) => keys.includes(key)) && keys.every((key) => required.includes(key) || optional.includes(key));
}

function text(value: unknown, maximum = 8_192): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (normalized.length === 0 || Buffer.byteLength(normalized, "utf8") > maximum) return undefined;
  for (let index = 0; index < normalized.length; index += 1) {
    const code = normalized.charCodeAt(index);
    if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127) return undefined;
    if (code >= 0xd800 && code <= 0xdfff) {
      const next = normalized.charCodeAt(index + 1);
      if (code > 0xdbff || next < 0xdc00 || next > 0xdfff) return undefined;
      index += 1;
    }
  }
  return normalized;
}

function sha(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

function integer(value: unknown, minimum = 1): value is number {
  return Number.isSafeInteger(value) && Number(value) >= minimum;
}

function stringList(value: unknown, maximumItems: number, maximumBytes = 4_096): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length > maximumItems) return undefined;
  const output: string[] = [];
  for (const item of value) {
    const parsed = text(item, maximumBytes);
    if (parsed === undefined || output.includes(parsed)) return undefined;
    output.push(parsed);
  }
  return cloneFrozen(output);
}

function user(value: unknown): (ResearchActor & { readonly kind: "user" }) | undefined {
  const parsed = validateResearchActor(value);
  return parsed.ok && parsed.value.kind === "user" ? parsed.value : undefined;
}

function checkVersion(current: CorrectionAppeal, expected: EntityVersion): ResearchResult<EntityVersion> {
  const next = advanceEntityVersion(current.version, expected);
  return next.ok ? next : err(researchError("version_conflict"));
}

function transition(
  current: CorrectionAppeal,
  to: CorrectionAppealStatus,
  version: EntityVersion,
  at: string,
  actor: "user" | "kernel",
  reason: string,
  patch: Partial<Pick<CorrectionAppeal, "statements" | "attempts" | "resolutions">> = {},
): ResearchResult<CorrectionAppeal> {
  return parseCorrectionAppeal({
    ...current,
    ...patch,
    status: to,
    version,
    updatedAt: at,
    transitions: [...current.transitions, { from: current.status, to, actor, at, reason }],
  });
}

function parseStatement(value: unknown): AppealStatement | undefined {
  if (!isRecord(value) || !exactOptional(value, ["disagreement", "challengedCriterionId", "claimedError", "missingOrMisreadContext", "secondOpinionQuestion"], ["desiredDisposition"])) return undefined;
  const disagreement = text(value.disagreement, 8_192);
  const challengedCriterionId = text(value.challengedCriterionId, 128);
  const claimedError = text(value.claimedError, 8_192);
  const missingOrMisreadContext = text(value.missingOrMisreadContext, 16_384);
  const secondOpinionQuestion = text(value.secondOpinionQuestion, 8_192);
  if (disagreement === undefined || challengedCriterionId === undefined || claimedError === undefined || missingOrMisreadContext === undefined || secondOpinionQuestion === undefined) return undefined;
  if (value.desiredDisposition !== undefined && !APPEAL_RESOLUTION_KINDS.includes(value.desiredDisposition as AppealResolutionKind)) return undefined;
  return cloneFrozen({ disagreement, challengedCriterionId, claimedError, missingOrMisreadContext, secondOpinionQuestion, ...(value.desiredDisposition === undefined ? {} : { desiredDisposition: value.desiredDisposition as AppealResolutionKind }) });
}

export function parseAppealSourceBinding(value: unknown): ResearchResult<AppealSourceBinding> {
  if (!isRecord(value) || !exact(value, ["projectId", "reviewId", "receiptId", "findingId", "findingSchemaVersion", "findingSnapshot", "findingHash", "suggestionHash", "sourceReceiptHash", "inputBindings", "rubric", "createdStateBinding", "createdStateBindingHash"])) return err(researchError("invalid_correction_appeal"));
  const project = parseResearchIdFor(value.projectId, "rprj_");
  const review = parseResearchIdFor(value.reviewId, "rrvw_");
  const receipt = parseResearchIdFor(value.receiptId, "rrcp_");
  const finding = parseResearchIdFor(value.findingId, "rfnd_");
  const state = parseResearchRoomStateBinding(value.createdStateBinding);
  if (!project.ok || !review.ok || !receipt.ok || !finding.ok || !state.ok || state.value.projectId !== project.value.id || value.findingSchemaVersion !== "1.0.0" || !sha(value.findingHash) || !sha(value.suggestionHash) || !sha(value.sourceReceiptHash) || !sha(value.createdStateBindingHash) || !Array.isArray(value.inputBindings) || value.inputBindings.length > 64 || !isRecord(value.findingSnapshot) || !isRecord(value.rubric)) return err(researchError("invalid_correction_appeal"));
  if (!exact(value.findingSnapshot, ["id", "kind", "severity", "rationale", "minimumRecovery", "decisionIds", "issueIds", "authority"]) || value.findingSnapshot.id !== finding.value.id || text(value.findingSnapshot.kind, 128) === undefined || !["info", "warning", "error"].includes(String(value.findingSnapshot.severity)) || text(value.findingSnapshot.rationale, 8_192) === undefined || text(value.findingSnapshot.minimumRecovery, 8_192) === undefined || value.findingSnapshot.authority !== "model_proposed") return err(researchError("invalid_correction_appeal"));
  const decisionIds = stringList(value.findingSnapshot.decisionIds, 64, 128);
  const issueIds = stringList(value.findingSnapshot.issueIds, 64, 128);
  if (decisionIds === undefined || issueIds === undefined || decisionIds.some((id) => !parseResearchIdFor(id, "rdec_").ok) || issueIds.some((id) => !parseResearchIdFor(id, "riss_").ok)) return err(researchError("invalid_correction_appeal"));
  if (!exact(value.rubric, ["criterionId", "version", "definition", "hash", "sourceRubricHash"]) || text(value.rubric.criterionId, 128) === undefined || text(value.rubric.version, 64) === undefined || text(value.rubric.definition, 8_192) === undefined || !sha(value.rubric.hash) || !sha(value.rubric.sourceRubricHash)) return err(researchError("invalid_correction_appeal"));
  const criterionHash = stableResearchHash({ id: value.rubric.criterionId, definition: value.rubric.definition, version: value.rubric.version });
  if (!criterionHash.ok || criterionHash.value !== value.rubric.hash) return err(researchError("appeal_source_mismatch"));
  const bindings: AppealSourceBinding["inputBindings"][number][] = [];
  for (const raw of value.inputBindings) {
    if (!isRecord(raw) || !exact(raw, ["artifactId", "revisionId", "normalizedTextHash"])) return err(researchError("invalid_correction_appeal"));
    const artifactId = text(raw.artifactId, 128);
    const revisionId = text(raw.revisionId, 128);
    const normalizedTextHash = text(raw.normalizedTextHash, 128);
    if (artifactId === undefined || revisionId === undefined || normalizedTextHash === undefined || !parseResearchIdFor(artifactId, "rart_").ok || !parseResearchIdFor(revisionId, "rrev_").ok || !sha(normalizedTextHash)) return err(researchError("invalid_correction_appeal"));
    const key = `${artifactId}:${revisionId}:${normalizedTextHash}`;
    if (bindings.some((item) => `${item.artifactId}:${item.revisionId}:${item.normalizedTextHash}` === key)) return err(researchError("invalid_correction_appeal"));
    bindings.push(cloneFrozen({ artifactId, revisionId, normalizedTextHash }));
  }
  const findingHash = stableResearchHash(value.findingSnapshot);
  const stateHash = stableResearchHash(state.value);
  if (!findingHash.ok || findingHash.value !== value.findingHash || !stateHash.ok || stateHash.value !== value.createdStateBindingHash) return err(researchError("appeal_source_mismatch"));
  return ok(cloneFrozen({ ...value, projectId: project.value.id, reviewId: review.value.id, receiptId: receipt.value.id, findingId: finding.value.id, findingSnapshot: { ...value.findingSnapshot, decisionIds, issueIds }, inputBindings: bindings, createdStateBinding: state.value } as unknown as AppealSourceBinding));
}

function parseParticipant(value: unknown): SecondOpinionParticipantSnapshot | undefined {
  if (!isRecord(value) || !exact(value, ["connectionId", "providerId", "family", "model", "endpointIdentityHash", "configGeneration", "locality"])) return undefined;
  if (text(value.connectionId, 128) === undefined || text(value.providerId, 128) === undefined || value.family !== "openai_compatible" || text(value.model, 256) === undefined || !sha(value.endpointIdentityHash) || !integer(value.configGeneration) || !["local", "external"].includes(String(value.locality))) return undefined;
  return cloneFrozen(value as unknown as SecondOpinionParticipantSnapshot);
}

function parseIndependence(value: unknown): AppealIndependenceBasis | undefined {
  if (!isRecord(value) || !exact(value, ["status", "originalConnectionId", "secondConnectionId", "identityComparison", "contextIsolation"]) || !["runtime_and_context_isolated", "same_runtime_not_independent", "independence_unproven"].includes(String(value.status)) || text(value.originalConnectionId, 128) === undefined || text(value.secondConnectionId, 128) === undefined || !["different_runtime_identity", "same_runtime_identity", "identity_unproven"].includes(String(value.identityComparison)) || value.contextIsolation !== "original_verdict_reason_confidence_and_raw_response_excluded") return undefined;
  if (value.status === "runtime_and_context_isolated" && (value.originalConnectionId === value.secondConnectionId || value.identityComparison !== "different_runtime_identity")) return undefined;
  return cloneFrozen(value as unknown as AppealIndependenceBasis);
}

function parseEstimate(value: unknown, cost: boolean): SecondOpinionManifest["tokenEstimate"] | SecondOpinionManifest["costEstimate"] | undefined {
  if (!isRecord(value) || !["available", "unavailable"].includes(String(value.status))) return undefined;
  if (value.status === "unavailable") return exact(value, ["status"]) ? cloneFrozen({ status: "unavailable" }) : undefined;
  if (cost) {
    return exact(value, ["status", "currency", "value"]) && text(value.currency, 16) !== undefined && typeof value.value === "number" && Number.isFinite(value.value) && value.value >= 0
      ? cloneFrozen(value as unknown as SecondOpinionManifest["costEstimate"]) : undefined;
  }
  return exact(value, ["status", "value"]) && integer(value.value, 0)
    ? cloneFrozen(value as unknown as SecondOpinionManifest["tokenEstimate"]) : undefined;
}

function parseManifest(value: unknown): SecondOpinionManifest | undefined {
  if (!isRecord(value) || !exact(value, ["schemaVersion", "canonicalHash", "requestHash", "requestBodyHash", "requestBodyBytes", "includedFields", "includedObjects", "excludedFields", "tokenEstimate", "costEstimate", "stateBindingHash"]) || value.schemaVersion !== "1.0.0" || !sha(value.canonicalHash) || !sha(value.requestHash) || !sha(value.requestBodyHash) || !integer(value.requestBodyBytes) || !sha(value.stateBindingHash) || !Array.isArray(value.includedObjects) || value.includedObjects.length > 64) return undefined;
  const includedFields = stringList(value.includedFields, 64, 128);
  const excludedFields = stringList(value.excludedFields, 64, 128);
  const includedObjects: SecondOpinionManifest["includedObjects"][number][] = [];
  for (const raw of value.includedObjects) {
    if (!isRecord(raw) || !exact(raw, ["kind", "id", "version", "hash", "fields"]) || !["brief", "decision", "issue", "evidence"].includes(String(raw.kind)) || !integer(raw.version) || !sha(raw.hash) || !isRecord(raw.fields) || Object.keys(raw.fields).length === 0 || Object.keys(raw.fields).length > 32) return undefined;
    const prefix = raw.kind === "brief" ? "rbrf_" : raw.kind === "decision" ? "rdec_" : raw.kind === "issue" ? "riss_" : "revd_";
    if (!parseResearchIdFor(raw.id, prefix).ok || includedObjects.some((item) => item.kind === raw.kind && item.id === raw.id)) return undefined;
    const fields: Record<string, string> = {};
    for (const [key, field] of Object.entries(raw.fields)) {
      const parsed = text(field, 4_096);
      if (!/^[a-z][a-zA-Z0-9]{0,63}$/u.test(key) || parsed === undefined) return undefined;
      fields[key] = parsed;
    }
    const calculated = stableResearchHash({ kind: raw.kind, id: raw.id, version: raw.version, fields });
    if (!calculated.ok || calculated.value !== raw.hash) return undefined;
    includedObjects.push(cloneFrozen({ kind: raw.kind, id: raw.id, version: raw.version, hash: raw.hash, fields } as SecondOpinionManifest["includedObjects"][number]));
  }
  const tokenEstimate = parseEstimate(value.tokenEstimate, false);
  const costEstimate = parseEstimate(value.costEstimate, true) as SecondOpinionManifest["costEstimate"] | undefined;
  if (includedFields === undefined || includedFields.length === 0 || excludedFields === undefined || tokenEstimate === undefined || costEstimate === undefined || REQUIRED_SECOND_OPINION_EXCLUSIONS.some((item) => !excludedFields.includes(item))) return undefined;
  const { canonicalHash: _canonicalHash, ...withoutCanonicalHash } = value;
  void _canonicalHash;
  const canonical = stableResearchHash(withoutCanonicalHash);
  if (!canonical.ok || canonical.value !== value.canonicalHash) return undefined;
  return cloneFrozen({ ...value, includedFields, includedObjects, excludedFields, tokenEstimate, costEstimate } as unknown as SecondOpinionManifest);
}

export function parseSecondOpinionResult(value: unknown): ResearchResult<SecondOpinionResult> {
  if (!isRecord(value) || !exact(value, ["schemaVersion", "appealId", "attemptId", "criterionId", "assessment", "evidenceSpans", "publicRationale", "missingContext", "alternativeExplanations", "minimalCorrection", "uncertaintySources", "hashes"]) || value.schemaVersion !== "1.0.0" || !parseResearchIdFor(value.appealId, "rapl_").ok || !parseResearchIdFor(value.attemptId, "rsop_").ok || text(value.criterionId, 128) === undefined || !["present", "not_present", "uncertain", "insufficient_context"].includes(String(value.assessment)) || !Array.isArray(value.evidenceSpans) || value.evidenceSpans.length > 32 || text(value.publicRationale, 8_192) === undefined || text(value.minimalCorrection, 8_192) === undefined || !isRecord(value.hashes) || !exact(value.hashes, ["schemaHash", "rubricHash", "requestHash", "inputHash"]) || !Object.values(value.hashes).every(sha)) return err(researchError("invalid_second_opinion_result"));
  const missingContext = stringList(value.missingContext, 32, 4_096);
  const alternativeExplanations = stringList(value.alternativeExplanations, 32, 4_096);
  const uncertaintySources = stringList(value.uncertaintySources, 32, 4_096);
  if (missingContext === undefined || alternativeExplanations === undefined || uncertaintySources === undefined) return err(researchError("invalid_second_opinion_result"));
  const spans: SecondOpinionEvidenceSpan[] = [];
  for (const span of value.evidenceSpans) {
    if (!isRecord(span)) return err(researchError("invalid_second_opinion_result"));
    const start = span.start;
    const end = span.end;
    if (!exact(span, ["projectId", "artifactId", "revisionId", "normalizedTextHash", "start", "end", "quote", "quoteHash", "normalizationVersion", "indexUnit"]) || !parseResearchIdFor(span.projectId, "rprj_").ok || !parseResearchIdFor(span.artifactId, "rart_").ok || !parseResearchIdFor(span.revisionId, "rrev_").ok || !sha(span.normalizedTextHash) || !sha(span.quoteHash) || !integer(start, 0) || !integer(end) || end <= start || typeof span.quote !== "string" || Buffer.byteLength(span.quote, "utf8") > 8_192 || text(span.normalizationVersion, 64) === undefined || text(span.indexUnit, 64) === undefined) return err(researchError("invalid_second_opinion_result"));
    if (spans.some((item) => item.revisionId === span.revisionId && !(end <= item.start || start >= item.end))) return err(researchError("invalid_second_opinion_result"));
    spans.push(cloneFrozen({ ...span, start, end } as unknown as SecondOpinionEvidenceSpan));
  }
  return ok(cloneFrozen({ ...value, evidenceSpans: spans, missingContext, alternativeExplanations, uncertaintySources } as unknown as SecondOpinionResult));
}

function parseComparison(value: unknown): AppealComparison | undefined {
  if (!isRecord(value) || !exact(value, ["schemaVersion", "relation", "agreement", "directContradiction", "qualifiedAgreement", "newEvidence", "missingContextChange", "redundantRestatement", "alternativeExplanation", "unresolvedConflict", "insufficientForComparison", "nonRedundantIncrement", "reasons", "sourceReferences", "authority", "canResolveAppeal"]) || value.schemaVersion !== "1.0.0" || !["agreement", "direct_contradiction", "qualified_agreement", "insufficient_for_comparison"].includes(String(value.relation)) || !["present", "absent", "unproven"].includes(String(value.nonRedundantIncrement)) || value.authority !== "system_derived" || value.canResolveAppeal !== false) return undefined;
  for (const key of ["agreement", "directContradiction", "qualifiedAgreement", "newEvidence", "missingContextChange", "redundantRestatement", "alternativeExplanation", "unresolvedConflict", "insufficientForComparison"] as const) if (typeof value[key] !== "boolean") return undefined;
  const reasons = stringList(value.reasons, 32, 1_024);
  const sourceReferences = stringList(value.sourceReferences, 64, 256);
  return reasons === undefined || reasons.length === 0 || sourceReferences === undefined ? undefined : cloneFrozen({ ...value, reasons, sourceReferences } as unknown as AppealComparison);
}

function parseAttempt(value: unknown): SecondOpinionAttempt | undefined {
  if (!isRecord(value) || !exactOptional(value, ["id", "ordinal", "status", "participant", "independenceBasis", "manifest", "confirmationNonce", "preparedAt"], ["startedAt", "completedAt", "cancelledAt", "failedAt", "failure", "result", "comparison"]) || !parseResearchIdFor(value.id, "rsop_").ok || !integer(value.ordinal) || !["prepared", "running", "completed", "failed", "cancelled", "unknown"].includes(String(value.status)) || !sha(value.confirmationNonce) || !validateUtcTimestamp(value.preparedAt).ok) return undefined;
  const participant = parseParticipant(value.participant);
  const independenceBasis = parseIndependence(value.independenceBasis);
  const manifest = parseManifest(value.manifest);
  if (participant === undefined || independenceBasis === undefined || manifest === undefined) return undefined;
  for (const key of ["startedAt", "completedAt", "cancelledAt", "failedAt"] as const) if (value[key] !== undefined && !validateUtcTimestamp(value[key]).ok) return undefined;
  if (value.failure !== undefined && !SECOND_OPINION_FAILURES.includes(value.failure as SecondOpinionFailure)) return undefined;
  const result = value.result === undefined ? undefined : parseSecondOpinionResult(value.result);
  const comparison = value.comparison === undefined ? undefined : parseComparison(value.comparison);
  if (result !== undefined && !result.ok || value.comparison !== undefined && comparison === undefined) return undefined;
  if (value.status === "completed" && (!result?.ok || comparison === undefined)) return undefined;
  if (value.status !== "completed" && (value.result !== undefined || value.comparison !== undefined)) return undefined;
  return cloneFrozen({ ...value, participant, independenceBasis, manifest, ...(result?.ok ? { result: result.value } : {}), ...(comparison ? { comparison } : {}) } as unknown as SecondOpinionAttempt);
}

function parseReceipt(value: unknown): AppealReceipt | undefined {
  if (!isRecord(value) || !exactOptional(value, ["schemaVersion", "id", "projectId", "appealId", "resolutionId", "originalFindingHash", "sourceAppealHash", "independenceStatus", "before", "after", "command", "relatedObjects", "unproven", "authority", "receiptHash"], ["secondOpinionResultHash", "comparisonHash"]) || value.schemaVersion !== "1.0.0" || !parseResearchIdFor(value.id, "rapc_").ok || !parseResearchIdFor(value.projectId, "rprj_").ok || !parseResearchIdFor(value.appealId, "rapl_").ok || !parseResearchIdFor(value.resolutionId, "rapr_").ok || !sha(value.originalFindingHash) || !sha(value.sourceAppealHash) || !["runtime_and_context_isolated", "same_runtime_not_independent", "independence_unproven", "not_requested"].includes(String(value.independenceStatus)) || !isRecord(value.before) || !isRecord(value.after) || !isRecord(value.command) || !isRecord(value.relatedObjects) || !isRecord(value.authority) || !sha(value.receiptHash)) return undefined;
  if (value.secondOpinionResultHash !== undefined && !sha(value.secondOpinionResultHash) || value.comparisonHash !== undefined && !sha(value.comparisonHash)) return undefined;
  if (!exact(value.before, ["status", "version"]) || !CORRECTION_APPEAL_STATUSES.includes(value.before.status as CorrectionAppealStatus) || !integer(value.before.version) || !exact(value.after, ["status", "version"]) || value.after.status !== "resolved" || !integer(value.after.version) || value.after.version !== value.before.version + 1) return undefined;
  if (!exact(value.command, ["kind", "publicReason"]) || !APPEAL_RESOLUTION_KINDS.includes(value.command.kind as AppealResolutionKind) || text(value.command.publicReason, 8_192) === undefined) return undefined;
  if (!exact(value.relatedObjects, ["reviewId", "sourceReceiptId", "findingId", "inputRevisionIds"]) || !parseResearchIdFor(value.relatedObjects.reviewId, "rrvw_").ok || !parseResearchIdFor(value.relatedObjects.sourceReceiptId, "rrcp_").ok || !parseResearchIdFor(value.relatedObjects.findingId, "rfnd_").ok || stringList(value.relatedObjects.inputRevisionIds, 64, 128)?.some((id) => !parseResearchIdFor(id, "rrev_").ok)) return undefined;
  const unproven = stringList(value.unproven, 16, 1_024);
  const actor = user(value.authority.actor);
  if (unproven === undefined || unproven.length === 0 || actor === undefined || !exact(value.authority, ["actor", "confirmedAt"]) || !validateUtcTimestamp(value.authority.confirmedAt).ok) return undefined;
  const withoutHash = { ...value };
  delete withoutHash.receiptHash;
  const calculated = stableResearchHash(withoutHash);
  return calculated.ok && calculated.value === value.receiptHash ? cloneFrozen({ ...value, unproven, authority: { actor, confirmedAt: value.authority.confirmedAt } } as unknown as AppealReceipt) : undefined;
}

export function parseCorrectionAppeal(value: unknown): ResearchResult<CorrectionAppeal> {
  if (!isRecord(value) || !exact(value, ["schemaVersion", "id", "projectId", "lineage", "source", "status", "statements", "attempts", "resolutions", "transitions", "version", "createdAt", "updatedAt"]) || value.schemaVersion !== "1.0.0" || !parseResearchIdFor(value.id, "rapl_").ok || !parseResearchIdFor(value.projectId, "rprj_").ok || !CORRECTION_APPEAL_STATUSES.includes(value.status as CorrectionAppealStatus) || !Array.isArray(value.statements) || value.statements.length === 0 || value.statements.length > 128 || !Array.isArray(value.attempts) || value.attempts.length > 32 || !Array.isArray(value.resolutions) || value.resolutions.length > 64 || !Array.isArray(value.transitions) || value.transitions.length === 0 || value.transitions.length > 256 || !isRecord(value.lineage)) return err(researchError("invalid_correction_appeal"));
  const source = parseAppealSourceBinding(value.source);
  const version = parseEntityVersion(value.version);
  const createdAt = validateUtcTimestamp(value.createdAt);
  const updatedAt = validateUtcTimestamp(value.updatedAt);
  if (!source.ok || source.value.projectId !== value.projectId || !version.ok || !createdAt.ok || !updatedAt.ok || !exactOptional(value.lineage, ["rootAppealId"], ["previousAppealId"]) || !parseResearchIdFor(value.lineage.rootAppealId, "rapl_").ok || value.lineage.previousAppealId !== undefined && !parseResearchIdFor(value.lineage.previousAppealId, "rapl_").ok) return err(researchError("invalid_correction_appeal"));
  const statements: AppealStatementVersion[] = [];
  for (const raw of value.statements) {
    if (!isRecord(raw) || !exact(raw, ["version", "statement", "actor", "recordedAt"]) || !integer(raw.version) || raw.version !== statements.length + 1 || !validateUtcTimestamp(raw.recordedAt).ok) return err(researchError("invalid_correction_appeal"));
    const statement = parseStatement(raw.statement);
    const actor = user(raw.actor);
    if (statement === undefined || actor === undefined || statement.challengedCriterionId !== source.value.rubric.criterionId) return err(researchError("invalid_correction_appeal"));
    statements.push(cloneFrozen({ version: raw.version, statement, actor, recordedAt: raw.recordedAt as string }));
  }
  const attempts: SecondOpinionAttempt[] = [];
  for (const raw of value.attempts) {
    const attempt = parseAttempt(raw);
    if (attempt?.ordinal !== attempts.length + 1 || attempt.manifest.stateBindingHash !== source.value.createdStateBindingHash) return err(researchError("invalid_correction_appeal"));
    if (attempt.result !== undefined && (attempt.result.appealId !== value.id || attempt.result.attemptId !== attempt.id || attempt.result.criterionId !== source.value.rubric.criterionId)) return err(researchError("invalid_correction_appeal"));
    attempts.push(attempt);
  }
  if (attempts.filter((item) => item.status === "prepared" || item.status === "running").length > 1) return err(researchError("invalid_correction_appeal"));
  const resolutions: AppealResolution[] = [];
  for (const raw of value.resolutions) {
    if (!isRecord(raw) || !exactOptional(raw, ["id", "kind", "publicReason", "authority", "receipt"], ["supersedesResolutionId"]) || !parseResearchIdFor(raw.id, "rapr_").ok || !APPEAL_RESOLUTION_KINDS.includes(raw.kind as AppealResolutionKind) || text(raw.publicReason, 8_192) === undefined || raw.supersedesResolutionId !== undefined && raw.supersedesResolutionId !== resolutions.at(-1)?.id) return err(researchError("invalid_correction_appeal"));
    const receipt = parseReceipt(raw.receipt);
    const actor = isRecord(raw.authority) && exact(raw.authority, ["actor", "confirmedAt"]) ? user(raw.authority.actor) : undefined;
    if (receipt === undefined || receipt.appealId !== value.id || receipt.resolutionId !== raw.id || actor === undefined || !validateUtcTimestamp((raw.authority as Record<string, unknown>).confirmedAt).ok) return err(researchError("invalid_correction_appeal"));
    resolutions.push(cloneFrozen({ ...raw, authority: { actor, confirmedAt: (raw.authority as Record<string, unknown>).confirmedAt as string }, receipt } as unknown as AppealResolution));
  }
  const transitions: AppealTransition[] = [];
  for (const raw of value.transitions) {
    if (!isRecord(raw) || !exactOptional(raw, ["to", "actor", "at", "reason"], ["from"]) || raw.from !== undefined && !CORRECTION_APPEAL_STATUSES.includes(raw.from as CorrectionAppealStatus) || !CORRECTION_APPEAL_STATUSES.includes(raw.to as CorrectionAppealStatus) || !["user", "kernel"].includes(String(raw.actor)) || !validateUtcTimestamp(raw.at).ok || text(raw.reason, 512) === undefined) return err(researchError("invalid_correction_appeal"));
    if (transitions.length === 0 ? raw.from !== undefined || raw.to !== "draft" : raw.from !== transitions.at(-1)?.to) return err(researchError("invalid_correction_appeal"));
    if (raw.from !== undefined && !isLegalAppealTransition(raw.from as CorrectionAppealStatus, raw.to as CorrectionAppealStatus)) return err(researchError("invalid_correction_appeal"));
    transitions.push(cloneFrozen(raw as unknown as AppealTransition));
  }
  if (transitions.at(-1)?.to !== value.status || value.status === "resolved" && resolutions.length === 0 || value.status !== "resolved" && resolutions.length > 0) return err(researchError("invalid_correction_appeal"));
  return ok(cloneFrozen({ ...value, source: source.value, statements, attempts, resolutions, transitions, version: version.value } as unknown as CorrectionAppeal));
}

export function createCorrectionAppeal(
  input: { readonly source: AppealSourceBinding; readonly statement: AppealStatement; readonly actor: ResearchActor; readonly previousAppealId?: string; readonly rootAppealId?: string },
  ports: { readonly clock: Clock; readonly idFactory: IdFactory },
): ResearchResult<CorrectionAppeal> {
  const source = parseAppealSourceBinding(input.source);
  const statement = parseStatement(input.statement);
  const actor = user(input.actor);
  const at = readClock(ports.clock);
  const id = parseResearchIdFor(ports.idFactory.create("rapl_"), "rapl_");
  const previousAppealIdValid = input.previousAppealId === undefined || parseResearchIdFor(input.previousAppealId, "rapl_").ok;
  const rootAppealIdValid = input.rootAppealId === undefined || parseResearchIdFor(input.rootAppealId, "rapl_").ok;
  const lineageValid = input.rootAppealId === undefined || input.previousAppealId !== undefined;
  if (!source.ok || statement === undefined) return err(researchError("invalid_correction_appeal"));
  if (statement.challengedCriterionId !== source.value.rubric.criterionId || actor === undefined || !at.ok || !id.ok || !previousAppealIdValid || !rootAppealIdValid || !lineageValid) return err(researchError(actor === undefined ? "user_appeal_action_required" : "invalid_correction_appeal"));
  return parseCorrectionAppeal({
    schemaVersion: "1.0.0",
    id: id.value.id,
    projectId: source.value.projectId,
    lineage: { ...(input.previousAppealId ? { previousAppealId: input.previousAppealId } : {}), rootAppealId: input.rootAppealId ?? input.previousAppealId ?? id.value.id },
    source: source.value,
    status: "draft",
    statements: [{ version: 1, statement, actor, recordedAt: at.value }],
    attempts: [],
    resolutions: [],
    transitions: [{ to: "draft", actor: "user", at: at.value, reason: "correction_appeal_created" }],
    version: initialEntityVersion(),
    createdAt: at.value,
    updatedAt: at.value,
  });
}

export function updateCorrectionAppealStatement(currentInput: CorrectionAppeal, input: { readonly statement: AppealStatement; readonly actor: ResearchActor; readonly expectedVersion: EntityVersion }, clock: Clock): ResearchResult<CorrectionAppeal> {
  const current = parseCorrectionAppeal(currentInput);
  const statement = parseStatement(input.statement);
  const actor = user(input.actor);
  if (!current.ok) return current;
  if (actor === undefined) return err(researchError("user_appeal_action_required"));
  if (current.value.status !== "draft") return err(researchError("invalid_appeal_transition"));
  if (statement?.challengedCriterionId !== current.value.source.rubric.criterionId) return err(researchError("invalid_correction_appeal"));
  const version = checkVersion(current.value, input.expectedVersion);
  const at = readClock(clock);
  if (!version.ok || !at.ok) return version.ok ? err(researchError("invalid_correction_appeal")) : version;
  return parseCorrectionAppeal({ ...current.value, statements: [...current.value.statements, { version: current.value.statements.length + 1, statement, actor, recordedAt: at.value }], version: version.value, updatedAt: at.value });
}

export function recordCorrectionAppeal(currentInput: CorrectionAppeal, input: { readonly actor: ResearchActor; readonly expectedVersion: EntityVersion }, clock: Clock): ResearchResult<CorrectionAppeal> {
  const current = parseCorrectionAppeal(currentInput);
  const actor = user(input.actor);
  if (!current.ok) return current;
  if (actor === undefined) return err(researchError("user_appeal_action_required"));
  if (current.value.status !== "draft") return err(researchError("invalid_appeal_transition"));
  const version = checkVersion(current.value, input.expectedVersion);
  const at = readClock(clock);
  return !version.ok ? version : !at.ok ? err(researchError("invalid_correction_appeal")) : transition(current.value, "recorded", version.value, at.value, "user", "correction_appeal_recorded");
}

export function markCorrectionAppealRecordOnly(currentInput: CorrectionAppeal, input: { readonly expectedVersion: EntityVersion }, clock: Clock): ResearchResult<CorrectionAppeal> {
  const current = parseCorrectionAppeal(currentInput);
  if (!current.ok) return current;
  if (!["recorded", "provider_failed", "cancelled", "stale_conflicted"].includes(current.value.status)) return err(researchError("invalid_appeal_transition"));
  const version = checkVersion(current.value, input.expectedVersion);
  const at = readClock(clock);
  return !version.ok ? version : !at.ok ? err(researchError("invalid_correction_appeal")) : transition(current.value, "appeal_record_only", version.value, at.value, "kernel", "second_opinion_unavailable_or_not_selected");
}

export function prepareCorrectionAppealSecondOpinion(
  currentInput: CorrectionAppeal,
  input: { readonly actor: ResearchActor; readonly expectedVersion: EntityVersion; readonly attemptId?: string; readonly participant: SecondOpinionParticipantSnapshot; readonly independenceBasis: AppealIndependenceBasis; readonly manifest: SecondOpinionManifest },
  ports: { readonly clock: Clock; readonly idFactory: IdFactory },
): ResearchResult<CorrectionAppeal> {
  const current = parseCorrectionAppeal(currentInput);
  const actor = user(input.actor);
  const participant = parseParticipant(input.participant);
  const independence = parseIndependence(input.independenceBasis);
  const manifest = parseManifest(input.manifest);
  if (!current.ok) return current;
  if (actor === undefined) return err(researchError("user_appeal_action_required"));
  if (!["recorded", "appeal_record_only", "provider_failed", "cancelled"].includes(current.value.status) || current.value.attempts.some((item) => item.status === "prepared" || item.status === "running")) return err(researchError("invalid_appeal_transition"));
  if (participant === undefined || independence === undefined || manifest?.stateBindingHash !== current.value.source.createdStateBindingHash) return err(researchError("invalid_second_opinion_manifest"));
  if (independence.status !== "runtime_and_context_isolated" || independence.secondConnectionId !== participant.connectionId) return err(researchError("appeal_independence_not_proven"));
  const version = checkVersion(current.value, input.expectedVersion);
  const at = readClock(ports.clock);
  const id = parseResearchIdFor(input.attemptId ?? ports.idFactory.create("rsop_"), "rsop_");
  if (!version.ok) return version;
  if (!at.ok || !id.ok) return err(researchError("invalid_correction_appeal"));
  const nonceHash = stableResearchHash({ appealId: current.value.id, attemptId: id.value.id, manifestHash: manifest.canonicalHash, ordinal: current.value.attempts.length + 1 });
  if (!nonceHash.ok) return err(researchError("invalid_correction_appeal"));
  const attempt: SecondOpinionAttempt = cloneFrozen({ id: id.value.id, ordinal: current.value.attempts.length + 1, status: "prepared", participant, independenceBasis: independence, manifest, confirmationNonce: nonceHash.value, preparedAt: at.value });
  return transition(current.value, "awaiting_send_confirmation", version.value, at.value, "user", "second_opinion_manifest_prepared", { attempts: [...current.value.attempts, attempt] });
}

export function startCorrectionAppealSecondOpinion(currentInput: CorrectionAppeal, input: { readonly actor: ResearchActor; readonly expectedVersion: EntityVersion; readonly attemptId: string; readonly confirmationNonce: string; readonly manifestHash: string }, clock: Clock): ResearchResult<CorrectionAppeal> {
  const current = parseCorrectionAppeal(currentInput);
  const actor = user(input.actor);
  if (!current.ok) return current;
  if (actor === undefined) return err(researchError("user_appeal_action_required"));
  const last = current.value.attempts.at(-1);
  if (current.value.status !== "awaiting_send_confirmation" || last?.status !== "prepared" || last.id !== input.attemptId || last.confirmationNonce !== input.confirmationNonce || last.manifest.canonicalHash !== input.manifestHash) return err(researchError("user_confirmation_required"));
  const version = checkVersion(current.value, input.expectedVersion);
  const at = readClock(clock);
  if (!version.ok) return version;
  if (!at.ok) return err(researchError("invalid_correction_appeal"));
  const attempts = [...current.value.attempts.slice(0, -1), { ...last, status: "running" as const, startedAt: at.value }];
  return transition(current.value, "second_opinion_running", version.value, at.value, "user", "second_opinion_send_confirmed", { attempts });
}

export function cancelCorrectionAppealSecondOpinion(currentInput: CorrectionAppeal, input: { readonly actor: ResearchActor; readonly expectedVersion: EntityVersion; readonly attemptId: string }, clock: Clock): ResearchResult<CorrectionAppeal> {
  const current = parseCorrectionAppeal(currentInput);
  const actor = user(input.actor);
  if (!current.ok) return current;
  if (actor === undefined) return err(researchError("user_appeal_action_required"));
  const last = current.value.attempts.at(-1);
  if (last?.id !== input.attemptId || !["prepared", "running"].includes(last.status) || !["awaiting_send_confirmation", "second_opinion_running"].includes(current.value.status)) return err(researchError("invalid_appeal_transition"));
  const version = checkVersion(current.value, input.expectedVersion);
  const at = readClock(clock);
  if (!version.ok) return version;
  if (!at.ok) return err(researchError("invalid_correction_appeal"));
  const attempts = [...current.value.attempts.slice(0, -1), { ...last, status: "cancelled" as const, cancelledAt: at.value }];
  return transition(current.value, "cancelled", version.value, at.value, "user", "second_opinion_cancelled", { attempts });
}

export function failCorrectionAppealSecondOpinion(currentInput: CorrectionAppeal, input: { readonly expectedVersion: EntityVersion; readonly attemptId: string; readonly failure: SecondOpinionFailure }, clock: Clock): ResearchResult<CorrectionAppeal> {
  const current = parseCorrectionAppeal(currentInput);
  if (!current.ok) return current;
  const last = current.value.attempts.at(-1);
  if (current.value.status !== "second_opinion_running" || last?.id !== input.attemptId || last.status !== "running" || !SECOND_OPINION_FAILURES.includes(input.failure)) return err(researchError("invalid_appeal_transition"));
  const version = checkVersion(current.value, input.expectedVersion);
  const at = readClock(clock);
  if (!version.ok) return version;
  if (!at.ok) return err(researchError("invalid_correction_appeal"));
  const attempts = [...current.value.attempts.slice(0, -1), { ...last, status: input.failure === "result_write_uncertain" ? "unknown" as const : "failed" as const, failure: input.failure, failedAt: at.value }];
  return transition(current.value, "provider_failed", version.value, at.value, "kernel", input.failure, { attempts });
}

export function completeCorrectionAppealSecondOpinion(currentInput: CorrectionAppeal, input: { readonly expectedVersion: EntityVersion; readonly attemptId: string; readonly result: SecondOpinionResult; readonly comparison: AppealComparison }, clock: Clock): ResearchResult<CorrectionAppeal> {
  const current = parseCorrectionAppeal(currentInput);
  const result = parseSecondOpinionResult(input.result);
  const comparison = parseComparison(input.comparison);
  if (!current.ok) return current;
  const last = current.value.attempts.at(-1);
  if (current.value.status !== "second_opinion_running" || last?.id !== input.attemptId || last.status !== "running") return err(researchError("invalid_appeal_transition"));
  if (!result.ok || comparison === undefined || result.value.appealId !== current.value.id || result.value.attemptId !== last.id || result.value.criterionId !== current.value.source.rubric.criterionId || result.value.hashes.rubricHash !== current.value.source.rubric.hash || result.value.hashes.requestHash !== last.manifest.requestHash || result.value.hashes.inputHash !== current.value.source.inputBindings[0]?.normalizedTextHash || result.value.evidenceSpans.some((span) => span.projectId !== current.value.projectId || !current.value.source.inputBindings.some((binding) => binding.artifactId === span.artifactId && binding.revisionId === span.revisionId && binding.normalizedTextHash === span.normalizedTextHash))) return err(researchError("invalid_second_opinion_result"));
  const version = checkVersion(current.value, input.expectedVersion);
  const at = readClock(clock);
  if (!version.ok) return version;
  if (!at.ok) return err(researchError("invalid_correction_appeal"));
  const attempts = [...current.value.attempts.slice(0, -1), { ...last, status: "completed" as const, completedAt: at.value, result: result.value, comparison }];
  return transition(current.value, "second_opinion_ready", version.value, at.value, "kernel", "second_opinion_validated_and_compared", { attempts });
}

export function markCorrectionAppealStale(currentInput: CorrectionAppeal, input: { readonly expectedVersion: EntityVersion; readonly reason: string }, clock: Clock): ResearchResult<CorrectionAppeal> {
  const current = parseCorrectionAppeal(currentInput);
  const reason = text(input.reason, 512);
  if (!current.ok) return current;
  if (current.value.status === "resolved" || reason === undefined) return err(researchError("invalid_appeal_transition"));
  const version = checkVersion(current.value, input.expectedVersion);
  const at = readClock(clock);
  return !version.ok ? version : !at.ok ? err(researchError("invalid_correction_appeal")) : transition(current.value, "stale_conflicted", version.value, at.value, "kernel", reason);
}

export function deriveAppealComparison(input: { readonly originalAssessment: "present" | "not_present" | "uncertain"; readonly originalEvidenceHashes: readonly string[]; readonly secondOpinion: SecondOpinionResult }): AppealComparison {
  const second = input.secondOpinion.assessment;
  const insufficientForComparison = second === "insufficient_context";
  const agreement = !insufficientForComparison && second !== "uncertain" && input.originalAssessment !== "uncertain" && second === input.originalAssessment;
  const directContradiction = !insufficientForComparison && second !== "uncertain" && input.originalAssessment !== "uncertain" && second !== input.originalAssessment;
  const qualifiedAgreement = !insufficientForComparison && !agreement && !directContradiction;
  const newEvidence = input.secondOpinion.evidenceSpans.some((span) => !input.originalEvidenceHashes.includes(span.quoteHash) && !input.originalEvidenceHashes.includes(span.normalizedTextHash));
  const missingContextChange = input.secondOpinion.missingContext.length > 0;
  const alternativeExplanation = input.secondOpinion.alternativeExplanations.length > 0;
  const redundantRestatement = agreement && !newEvidence && !missingContextChange && !alternativeExplanation;
  const unresolvedConflict = directContradiction || qualifiedAgreement;
  const relation: AppealComparison["relation"] = insufficientForComparison ? "insufficient_for_comparison" : directContradiction ? "direct_contradiction" : qualifiedAgreement ? "qualified_agreement" : "agreement";
  const nonRedundantIncrement: AppealComparison["nonRedundantIncrement"] = insufficientForComparison ? "unproven" : newEvidence || missingContextChange || alternativeExplanation ? "present" : "absent";
  const reasons = [
    `normalized_relation:${relation}`,
    newEvidence ? "second_opinion_cites_new_bound_evidence" : "no_new_bound_evidence",
    missingContextChange ? "second_opinion_changes_missing_context" : "missing_context_unchanged",
    alternativeExplanation ? "second_opinion_adds_alternative_explanation" : "no_alternative_explanation_added",
  ];
  const sourceReferences = [...new Set([input.secondOpinion.appealId, input.secondOpinion.attemptId, ...input.secondOpinion.evidenceSpans.map((span) => span.revisionId)])];
  return cloneFrozen({ schemaVersion: "1.0.0", relation, agreement, directContradiction, qualifiedAgreement, newEvidence, missingContextChange, redundantRestatement, alternativeExplanation, unresolvedConflict, insufficientForComparison, nonRedundantIncrement, reasons, sourceReferences, authority: "system_derived", canResolveAppeal: false });
}

export function resolveCorrectionAppeal(
  currentInput: CorrectionAppeal,
  input: { readonly actor: ResearchActor; readonly expectedVersion: EntityVersion; readonly kind: AppealResolutionKind; readonly publicReason: string },
  ports: { readonly clock: Clock; readonly idFactory: IdFactory },
): ResearchResult<CorrectionAppeal> {
  const current = parseCorrectionAppeal(currentInput);
  const actor = user(input.actor);
  const reason = text(input.publicReason, 8_192);
  if (!current.ok) return current;
  if (actor === undefined) return err(researchError("user_appeal_action_required"));
  if (!APPEAL_RESOLUTION_KINDS.includes(input.kind) || reason === undefined || !["appeal_record_only", "second_opinion_ready", "provider_failed", "cancelled", "stale_conflicted", "recorded", "resolved"].includes(current.value.status)) return err(researchError("invalid_appeal_transition"));
  const version = checkVersion(current.value, input.expectedVersion);
  const at = readClock(ports.clock);
  const resolutionId = parseResearchIdFor(ports.idFactory.create("rapr_"), "rapr_");
  const receiptId = parseResearchIdFor(ports.idFactory.create("rapc_"), "rapc_");
  if (!version.ok) return version;
  if (!at.ok || !resolutionId.ok || !receiptId.ok) return err(researchError("invalid_correction_appeal"));
  const completedAttempt = [...current.value.attempts].reverse().find((item) => item.status === "completed" && item.result !== undefined && item.comparison !== undefined);
  const sourceAppealHash = stableResearchHash(current.value);
  const resultHash = completedAttempt?.result === undefined ? undefined : stableResearchHash(completedAttempt.result);
  const comparisonHash = completedAttempt?.comparison === undefined ? undefined : stableResearchHash(completedAttempt.comparison);
  if (!sourceAppealHash.ok || resultHash !== undefined && !resultHash.ok || comparisonHash !== undefined && !comparisonHash.ok) return err(researchError("invalid_correction_appeal"));
  const receiptWithoutHash = {
    schemaVersion: "1.0.0" as const,
    id: receiptId.value.id,
    projectId: current.value.projectId,
    appealId: current.value.id,
    resolutionId: resolutionId.value.id,
    originalFindingHash: current.value.source.findingHash,
    sourceAppealHash: sourceAppealHash.value,
    ...(resultHash?.ok ? { secondOpinionResultHash: resultHash.value } : {}),
    ...(comparisonHash?.ok ? { comparisonHash: comparisonHash.value } : {}),
    independenceStatus: completedAttempt?.independenceBasis.status ?? "not_requested" as const,
    before: { status: current.value.status, version: current.value.version },
    after: { status: "resolved" as const, version: version.value },
    command: { kind: input.kind, publicReason: reason },
    relatedObjects: { reviewId: current.value.source.reviewId, sourceReceiptId: current.value.source.receiptId, findingId: current.value.source.findingId, inputRevisionIds: current.value.source.inputBindings.map((item) => item.revisionId) },
    unproven: ["A second opinion does not prove the original or alternative interpretation correct.", "Non-redundant value in real research cases remains unproven."],
    authority: { actor, confirmedAt: at.value },
  };
  const receiptHash = stableResearchHash(receiptWithoutHash);
  if (!receiptHash.ok) return err(researchError("invalid_correction_appeal"));
  const receipt = parseReceipt({ ...receiptWithoutHash, receiptHash: receiptHash.value });
  if (receipt === undefined) return err(researchError("invalid_correction_appeal"));
  const resolution: AppealResolution = cloneFrozen({ id: resolutionId.value.id, kind: input.kind, publicReason: reason, ...(current.value.resolutions.at(-1) ? { supersedesResolutionId: current.value.resolutions.at(-1)?.id } : {}), authority: { actor, confirmedAt: at.value }, receipt });
  return transition(current.value, "resolved", version.value, at.value, "user", input.kind, { resolutions: [...current.value.resolutions, resolution] });
}
