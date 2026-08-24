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
    readonly category: "research_question" | "current_stage" | "current_task" | "fixed_decisions" | "expected_deltas" | "evidence_boundaries" | "explicit_non_goals" | "accepted_decisions" | "open_issues" | "issue_history" | "receipt_summary" | "current_episode" | "single_suggestion" | "semantic_criteria";
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
  readonly semanticJudge?: {
    readonly protocol: { readonly version: string; readonly hash: string };
    readonly prompt: { readonly version: string; readonly hash: string };
    readonly rubric: { readonly version: string; readonly hash: string };
    readonly provider: {
      readonly id: string;
      readonly family: "openai_compatible";
      readonly model: string;
      readonly baseUrlOrigin: string;
      readonly locality: "local" | "external";
      readonly configGeneration: number;
    };
    readonly request: {
      readonly endpoint: string;
      readonly requestHash: string;
      readonly requestBody: string;
      readonly requestBodyHash: string;
      readonly requestBodyBytes: number;
      readonly responseLimitBytes: number;
      readonly redirectPolicy: "error";
      readonly retryCount: 0;
    };
    readonly excludedFields: readonly string[];
  };
}

export interface ResearchRoomSemanticJudgeTrace {
  readonly responseHashes: {
    readonly protocolHash: string;
    readonly promptHash: string;
    readonly rubricHash: string;
    readonly requestHash: string;
  };
  readonly assessments: readonly {
    readonly criterionId: string;
    readonly verdict: "positive" | "negative" | "unknown";
    readonly evidenceSpans: readonly {
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
    }[];
    readonly referencedDecisionIds: readonly string[];
    readonly referencedIssueIds: readonly string[];
    readonly publicRationale: string;
    readonly minimalCorrection: string;
    readonly uncertainty: string;
    readonly missingContext: readonly string[];
  }[];
  readonly findings: readonly {
    readonly id: string;
    readonly kind: string;
    readonly severity: "info" | "warning" | "error";
    readonly rationale: string;
    readonly minimumRecovery: string;
    readonly decisionIds: readonly string[];
    readonly issueIds: readonly string[];
    readonly authority: "model_proposed";
  }[];
  readonly argumentDelta: {
    readonly status: "substantive" | "no_substantive_delta" | "unknown";
    readonly summary: string;
    readonly evidenceSpans: ResearchRoomSemanticJudgeTrace["assessments"][number]["evidenceSpans"];
  };
  readonly reasonableIncrement: {
    readonly status: "supported" | "not_supported" | "unknown";
    readonly authority: "system_derived";
    readonly canMutateAuthority: false;
    readonly blockingCriteria: readonly string[];
  };
  readonly derivation: "system_derived_from_validated_assessments";
}

export interface ResearchRoomReceipt {
  readonly schemaVersion: "1.0.0";
  readonly id: string;
  readonly projectId: string;
  readonly reviewId: string;
  readonly sourceEpisodeId?: string;
  readonly status: "committed" | "rolled_back";
  readonly providerStatus: ResearchRoomProviderStatus;
  readonly ledgerOnlyReason?: "provider_not_configured" | "provider_failed" | "provider_timeout" | "provider_invalid_response" | "provider_configuration_changed" | "provider_aborted";
  readonly evidenceClass: ResearchRoomEvidenceClass;
  readonly countsAsExternalEvidence: false;
  readonly suggestionHash: string;
  readonly manifest: ResearchRoomContextManifest;
  readonly analysis: ResearchRoomAnalysisPayload;
  readonly semanticJudge?: ResearchRoomSemanticJudgeTrace;
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
function positiveInteger(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) > 0; }

function parseSemanticProvider(input: unknown): ResearchRoomContextManifest["semanticJudge"] extends infer T
  ? T extends { readonly provider: infer P } ? P | undefined : never
  : never {
  if (!isRecord(input) || !hasExactKeys(input, ["id", "family", "model", "baseUrlOrigin", "locality", "configGeneration"])) return undefined;
  if (text(input.id, 128) === undefined || input.family !== "openai_compatible" || text(input.model, 256) === undefined || !["local", "external"].includes(String(input.locality)) || !positiveInteger(input.configGeneration)) return undefined;
  try {
    const url = new URL(String(input.baseUrlOrigin));
    if (url.origin !== input.baseUrlOrigin || url.username !== "" || url.password !== "") return undefined;
  } catch { return undefined; }
  return cloneFrozen(input as unknown as NonNullable<ResearchRoomContextManifest["semanticJudge"]>["provider"]);
}

function parseVersionHash(input: unknown): { readonly version: string; readonly hash: string } | undefined {
  if (!isRecord(input) || !hasExactKeys(input, ["version", "hash"]) || text(input.version, 64) === undefined || !sha(input.hash)) return undefined;
  return cloneFrozen({ version: input.version as string, hash: input.hash });
}

function parseSemanticManifest(input: unknown): NonNullable<ResearchRoomContextManifest["semanticJudge"]> | undefined {
  if (!isRecord(input) || !hasExactKeys(input, ["protocol", "prompt", "rubric", "provider", "request", "excludedFields"]) || !isRecord(input.request)) return undefined;
  const protocol = parseVersionHash(input.protocol); const prompt = parseVersionHash(input.prompt); const rubric = parseVersionHash(input.rubric); const provider = parseSemanticProvider(input.provider); const excludedFields = stringList(input.excludedFields, 64);
  if (protocol === undefined || prompt === undefined || rubric === undefined || provider === undefined || excludedFields === undefined || !hasExactKeys(input.request, ["endpoint", "requestHash", "requestBody", "requestBodyHash", "requestBodyBytes", "responseLimitBytes", "redirectPolicy", "retryCount"])) return undefined;
  if (text(input.request.endpoint, 2_048) === undefined || !sha(input.request.requestHash) || typeof input.request.requestBody !== "string" || !sha(input.request.requestBodyHash) || !positiveInteger(input.request.requestBodyBytes) || Buffer.byteLength(input.request.requestBody, "utf8") !== input.request.requestBodyBytes || !positiveInteger(input.request.responseLimitBytes) || input.request.redirectPolicy !== "error" || input.request.retryCount !== 0) return undefined;
  return cloneFrozen({ protocol, prompt, rubric, provider, request: input.request, excludedFields } as unknown as NonNullable<ResearchRoomContextManifest["semanticJudge"]>);
}

function parseSemanticTrace(input: unknown): ResearchRoomSemanticJudgeTrace | undefined {
  if (!isRecord(input) || !hasExactKeys(input, ["responseHashes", "assessments", "findings", "argumentDelta", "reasonableIncrement", "derivation"]) || !isRecord(input.responseHashes) || !Array.isArray(input.assessments) || !Array.isArray(input.findings) || !isRecord(input.argumentDelta) || !isRecord(input.reasonableIncrement)) return undefined;
  if (!hasExactKeys(input.responseHashes, ["protocolHash", "promptHash", "rubricHash", "requestHash"]) || !Object.values(input.responseHashes).every(sha) || input.derivation !== "system_derived_from_validated_assessments") return undefined;
  if (input.assessments.length !== 9 || new Set(input.assessments.map((item) => isRecord(item) ? item.criterionId : undefined)).size !== 9) return undefined;
  for (const assessment of input.assessments) {
    if (!isRecord(assessment) || !hasExactKeys(assessment, ["criterionId", "verdict", "evidenceSpans", "referencedDecisionIds", "referencedIssueIds", "publicRationale", "minimalCorrection", "uncertainty", "missingContext"]) || text(assessment.criterionId, 128) === undefined || !["positive", "negative", "unknown"].includes(String(assessment.verdict)) || !Array.isArray(assessment.evidenceSpans) || assessment.evidenceSpans.length > 8 || stringList(assessment.missingContext, 8) === undefined || text(assessment.publicRationale, 4_096) === undefined || text(assessment.minimalCorrection, 4_096) === undefined || text(assessment.uncertainty, 4_096) === undefined) return undefined;
    for (const id of Array.isArray(assessment.referencedDecisionIds) ? assessment.referencedDecisionIds : []) { if (!parseResearchIdFor(id, "rdec_").ok) return undefined; }
    for (const id of Array.isArray(assessment.referencedIssueIds) ? assessment.referencedIssueIds : []) { if (!parseResearchIdFor(id, "riss_").ok) return undefined; }
    if (!Array.isArray(assessment.referencedDecisionIds) || !Array.isArray(assessment.referencedIssueIds)) return undefined;
    for (const span of assessment.evidenceSpans) {
      if (!isRecord(span) || !hasExactKeys(span, ["projectId", "artifactId", "revisionId", "normalizedTextHash", "start", "end", "quote", "quoteHash", "normalizationVersion", "indexUnit"]) || !parseResearchIdFor(span.projectId, "rprj_").ok || !parseResearchIdFor(span.artifactId, "rart_").ok || !parseResearchIdFor(span.revisionId, "rrev_").ok || !sha(span.normalizedTextHash) || !sha(span.quoteHash) || !Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end) || Number(span.start) < 0 || Number(span.end) <= Number(span.start) || typeof span.quote !== "string" || text(span.normalizationVersion, 64) === undefined || text(span.indexUnit, 64) === undefined) return undefined;
    }
  }
  for (const finding of input.findings) {
    if (!isRecord(finding) || !hasExactKeys(finding, ["id", "kind", "severity", "rationale", "minimumRecovery", "decisionIds", "issueIds", "authority"]) || !parseResearchIdFor(finding.id, "rfnd_").ok || text(finding.kind, 128) === undefined || !["info", "warning", "error"].includes(String(finding.severity)) || text(finding.rationale, 4_096) === undefined || text(finding.minimumRecovery, 4_096) === undefined || finding.authority !== "model_proposed" || !Array.isArray(finding.decisionIds) || !Array.isArray(finding.issueIds)) return undefined;
  }
  if (!hasExactKeys(input.argumentDelta, ["status", "summary", "evidenceSpans"]) || !["substantive", "no_substantive_delta", "unknown"].includes(String(input.argumentDelta.status)) || text(input.argumentDelta.summary, 4_096) === undefined || !Array.isArray(input.argumentDelta.evidenceSpans)) return undefined;
  if (!hasExactKeys(input.reasonableIncrement, ["status", "authority", "canMutateAuthority", "blockingCriteria"]) || !["supported", "not_supported", "unknown"].includes(String(input.reasonableIncrement.status)) || input.reasonableIncrement.authority !== "system_derived" || input.reasonableIncrement.canMutateAuthority !== false || stringList(input.reasonableIncrement.blockingCriteria, 32) === undefined) return undefined;
  return cloneFrozen(input as unknown as ResearchRoomSemanticJudgeTrace);
}

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
  for (const raw of input.fields) { if (!isRecord(raw) || !hasExactKeys(raw, ["category", "source", "sensitivity", "included", "truncated"]) || !["research_question", "current_stage", "current_task", "fixed_decisions", "expected_deltas", "evidence_boundaries", "explicit_non_goals", "accepted_decisions", "open_issues", "issue_history", "receipt_summary", "current_episode", "single_suggestion", "semantic_criteria"].includes(String(raw.category)) || !["active_research_brief", "versioned_research_state", "explicit_user_input"].includes(String(raw.source)) || !["research_state", "user_supplied_text"].includes(String(raw.sensitivity)) || raw.included !== true || typeof raw.truncated !== "boolean") return err(researchError("invalid_research_room_receipt")); fields.push(raw as unknown as ResearchRoomContextManifest["fields"][number]); }
  const semanticJudge = input.semanticJudge === undefined ? undefined : parseSemanticManifest(input.semanticJudge);
  if (input.semanticJudge !== undefined && semanticJudge === undefined) return err(researchError("invalid_research_room_receipt"));
  return ok(cloneFrozen({ ...input, reviewId: review.value.id, evidenceClass: evidence.value, countsAsExternalEvidence: false, fields, ...(semanticJudge ? { semanticJudge } : {}) } as unknown as ResearchRoomContextManifest));
}

function receiptPayload(value: Omit<ResearchRoomReceipt, "receiptHash">): Omit<ResearchRoomReceipt, "receiptHash"> { return value; }

export function parseResearchRoomReceipt(input: unknown): ResearchResult<ResearchRoomReceipt> {
  if (!isRecord(input) || input.schemaVersion !== "1.0.0" || !["committed", "rolled_back"].includes(String(input.status)) || !["semantic_ready", "ledger_only"].includes(String(input.providerStatus)) || input.countsAsExternalEvidence !== false || !isRecord(input.disposition) || !isRecord(input.rollback) || !isRecord(input.authority) || !sha(input.suggestionHash) || !sha(input.receiptHash)) return err(researchError("invalid_research_room_receipt"));
  const id = parseResearchIdFor(input.id, "rrcp_"); const project = parseResearchIdFor(input.projectId, "rprj_"); const review = parseResearchIdFor(input.reviewId, "rrvw_"); const evidence = parseResearchRoomEvidenceClass(input.evidenceClass); const manifest = parseResearchRoomContextManifest(input.manifest); const analysis = parseResearchRoomAnalysisPayload(input.analysis); const before = parseResearchRoomStateBinding(input.before); const after = parseResearchRoomStateBinding(input.after); const version = parseEntityVersion(input.version); const createdAt = validateUtcTimestamp(input.createdAt); const updatedAt = validateUtcTimestamp(input.updatedAt);
  if (!id.ok || !project.ok || !review.ok || !evidence.ok || !manifest.ok || !analysis.ok || !before.ok || !after.ok || !version.ok || !createdAt.ok || !updatedAt.ok) return err(researchError("invalid_research_room_receipt"));
  const semanticJudge = input.semanticJudge === undefined ? undefined : parseSemanticTrace(input.semanticJudge);
  if (input.semanticJudge !== undefined && semanticJudge === undefined) return err(researchError("invalid_research_room_receipt"));
  if (input.sourceEpisodeId !== undefined) { const episode = parseResearchIdFor(input.sourceEpisodeId, "repi_"); if (!episode.ok) return err(researchError("invalid_research_room_receipt")); }
  if (!RESEARCH_ROOM_DISPOSITIONS.includes(input.disposition.kind as ResearchRoomDispositionKind) || text(input.disposition.reason, 4_096) === undefined) return err(researchError("invalid_research_room_receipt"));
  const actor = validateResearchActor(input.authority.actor); const confirmedAt = validateUtcTimestamp(input.authority.confirmedAt); if (!actor.ok || actor.value.kind !== "user" || !confirmedAt.ok) return err(researchError("user_confirmation_required"));
  const withoutHash = { ...input }; delete withoutHash.receiptHash; const calculated = stableResearchHash(withoutHash); if (!calculated.ok || calculated.value !== input.receiptHash) return err(researchError("invalid_research_room_receipt"));
  return ok(cloneFrozen(input as unknown as ResearchRoomReceipt));
}

export function createResearchRoomReceipt(input: Omit<ResearchRoomReceipt, "schemaVersion" | "id" | "status" | "authority" | "version" | "createdAt" | "updatedAt" | "receiptHash"> & { readonly actor: ResearchActor }, ports: { readonly clock: Clock; readonly idFactory: IdFactory }): ResearchResult<ResearchRoomReceipt> {
  const actor = validateResearchActor(input.actor); if (!actor.ok || actor.value.kind !== "user") return err(researchError("user_confirmation_required"));
  const id = parseResearchIdFor(ports.idFactory.create("rrcp_"), "rrcp_"); const at = readClock(ports.clock); if (!id.ok || !at.ok) return err(researchError("invalid_research_room_receipt"));
  const value = receiptPayload({ schemaVersion: "1.0.0", id: id.value.id, projectId: input.projectId, reviewId: input.reviewId, ...(input.sourceEpisodeId ? { sourceEpisodeId: input.sourceEpisodeId } : {}), status: "committed", providerStatus: input.providerStatus, ...(input.ledgerOnlyReason ? { ledgerOnlyReason: input.ledgerOnlyReason } : {}), evidenceClass: input.evidenceClass, countsAsExternalEvidence: false, suggestionHash: input.suggestionHash, manifest: input.manifest, analysis: input.analysis, ...(input.semanticJudge ? { semanticJudge: input.semanticJudge } : {}), disposition: input.disposition, before: input.before, after: input.after, rollback: input.rollback, authority: { actor: actor.value, confirmedAt: at.value }, version: initialEntityVersion(), createdAt: at.value, updatedAt: at.value });
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
