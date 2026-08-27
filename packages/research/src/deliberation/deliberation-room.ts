import type { ResearchActor } from "../authority/actor.js";
import { validateResearchActor } from "../authority/actor.js";
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
import { parseResearchId, parseResearchIdFor } from "../identity/research-id.js";
import type { IdFactory } from "../index.js";
import { err, ok, type ResearchResult } from "../result.js";

export const DELIBERATION_ROOM_STATUSES = [
  "draft",
  "context_prepared",
  "awaiting_manifest_confirmation",
  "blind_round_running",
  "reveal_ready",
  "difference_review",
  "challenge_prepared",
  "challenge_running",
  "waiting_user_resolution",
  "partial",
  "retry_prepared",
  "retry_running",
  "failed",
  "cancelled",
  "stale_conflicted",
  "resolved",
  "closed",
] as const;
export type DeliberationRoomStatus = (typeof DELIBERATION_ROOM_STATUSES)[number];

export const DELIBERATION_SOURCE_KINDS = [
  "correction_appeal",
  "unresolved_conflict",
  "research_issue",
  "research_decision",
  "research_brief",
  "explicit_project_object",
] as const;
export type DeliberationSourceKind = (typeof DELIBERATION_SOURCE_KINDS)[number];

export const DELIBERATION_DIFFERENCE_CATEGORIES = [
  "common_ground",
  "direct_conflict",
  "qualified_difference",
  "fact_selection_difference",
  "evidence_weight_difference",
  "assumption_difference",
  "scope_difference",
  "candidate_unique_increment",
  "redundant_restatement",
  "unresolved",
  "unproven",
] as const;
export type DeliberationDifferenceCategory = (typeof DELIBERATION_DIFFERENCE_CATEGORIES)[number];

export const DELIBERATION_RESOLUTION_KINDS = [
  "adopt_a",
  "adopt_b",
  "combine_edit",
  "reject_both",
  "request_evidence",
  "keep_disputed",
  "defer",
  "close_without_change",
] as const;
export type DeliberationResolutionKind = (typeof DELIBERATION_RESOLUTION_KINDS)[number];

export const DELIBERATION_PARTICIPANT_FAILURES = [
  "provider_timeout",
  "provider_offline",
  "provider_failed",
  "response_invalid",
  "response_too_large",
  "persistence_failed",
  "result_write_uncertain",
  "provider_configuration_changed",
  "cancelled_by_user",
] as const;
export type DeliberationParticipantFailure = (typeof DELIBERATION_PARTICIPANT_FAILURES)[number];

export type DeliberationProviderReadiness =
  | "configured_distinct"
  | "blocked_missing_provider"
  | "same_runtime_not_mutually_independent";

export const DELIBERATION_COMPARISON_DIMENSION_IDS = [
  "conclusion",
  "evidence_selection",
  "evidence_weight",
  "assumptions",
  "scope_boundary",
  "counterexamples",
  "alternative_explanations",
  "unknowns",
  "next_discriminating_evidence",
] as const;
export type DeliberationComparisonDimensionId = (typeof DELIBERATION_COMPARISON_DIMENSION_IDS)[number];

export interface DeliberationComparisonDimension {
  readonly id: DeliberationComparisonDimensionId;
  readonly label: string;
}

export interface DeliberationFrozenContext {
  readonly schemaVersion: "1.0.0";
  readonly question: string;
  readonly brief: { readonly briefId: string; readonly versionId: string; readonly versionNumber: number; readonly hash: string };
  readonly retainedDecisions: readonly { readonly id: string; readonly version: number; readonly hash: string }[];
  readonly allowedEvidenceIds: readonly string[];
  readonly excludedEvidenceIds: readonly string[];
  readonly comparisonDimensions: readonly DeliberationComparisonDimension[];
  readonly stopConditions: readonly string[];
  readonly budget: {
    readonly participants: 2;
    readonly blindInitialRounds: 1;
    readonly directedChallengeRounds: 1;
    readonly maximumProviderCalls: 4;
    readonly automaticRetries: 0;
    readonly synthesisProviders: 0;
  };
  readonly stateBindingHash: string;
  readonly canonicalHash: string;
}

export interface DeliberationSourceBinding {
  readonly projectId: string;
  readonly kind: DeliberationSourceKind;
  readonly objectId: string;
  readonly objectVersion: number;
  readonly question: string;
  readonly sourceHash: string;
}

export interface DeliberationParticipantSnapshot {
  readonly id: string;
  readonly slot: "a" | "b";
  readonly role: "independent_research_assessor";
  readonly connectionId: string;
  readonly providerId: string;
  readonly family: "openai_compatible";
  readonly model: string;
  readonly harnessId: string;
  readonly runtimeIdentityHash: string;
  readonly endpointIdentityHash: string;
  readonly secretRefHash: string;
  readonly configGeneration: number;
  readonly locality: "local" | "external";
}

export interface DeliberationContextManifest {
  readonly schemaVersion: "1.0.0";
  readonly roomId: string;
  readonly roundId: string;
  readonly participantId: string;
  readonly participantSlot: "a" | "b";
  readonly requestHash: string;
  readonly requestBodyHash: string;
  readonly participantSnapshotHash: string;
  readonly includedFields: readonly string[];
  readonly includedObjects: readonly {
    readonly kind: "appeal" | "brief" | "decision" | "issue" | "evidence" | "artifact" | "revision" | "participant_assessment" | "difference_summary";
    readonly id: string;
    readonly version: number;
    readonly hash: string;
    readonly fields: Readonly<Record<string, string>>;
  }[];
  readonly excludedFields: readonly string[];
  readonly stateBindingHash: string;
  readonly protocol: { readonly version: string; readonly hash: string };
  readonly prompt: { readonly version: string; readonly hash: string };
  readonly responseSchema: { readonly version: string; readonly hash: string };
  readonly rubric: { readonly version: string; readonly hash: string };
  readonly tokenBudget: number;
  readonly maxResponseBytes: number;
  readonly tools: "none";
  readonly roomContextOnly: true;
  readonly canonicalHash: string;
}

export interface DeliberationEvidenceSpan {
  readonly spanId: string;
  readonly projectId: string;
  readonly artifactId: string;
  readonly revisionId: string;
  readonly normalizedTextHash: string;
  readonly start: number;
  readonly end: number;
  readonly quote: string;
  readonly quoteHash: string;
  readonly normalizationVersion: string;
  readonly indexUnit: "utf16_code_unit";
}

export interface DeliberationParticipantAssessment {
  readonly schemaVersion: "1.0.0";
  readonly roomId: string;
  readonly roundId: string;
  readonly participantId: string;
  readonly participantSlot: "a" | "b";
  readonly requestHash: string;
  readonly assessment: "support" | "oppose" | "mixed" | "uncertain" | "insufficient_context";
  readonly directAnswer: string;
  readonly dimensions: readonly {
    readonly dimensionId: DeliberationComparisonDimensionId;
    readonly position: "support" | "challenge" | "qualify" | "uncertain" | "not_addressed";
    readonly summary: string;
    readonly evidenceSpanIds: readonly string[];
  }[];
  readonly claims: readonly {
    readonly claimId: string;
    readonly stance: "support" | "challenge" | "qualify" | "uncertain";
    readonly text: string;
    readonly evidenceSpanIds: readonly string[];
  }[];
  readonly evidenceSpans: readonly DeliberationEvidenceSpan[];
  readonly assumptions: readonly string[];
  readonly scope: string;
  readonly counterexamples: readonly string[];
  readonly alternativeExplanations: readonly string[];
  readonly unknowns: readonly string[];
  readonly nextDiscriminatingEvidence: readonly string[];
  readonly missingContext: readonly string[];
  readonly uncertaintySources: readonly string[];
  readonly publicRationale: string;
  readonly proposedNextStep: string;
  readonly hashes: {
    readonly responseSchemaHash: string;
    readonly rubricHash: string;
    readonly requestHash: string;
  };
}

export interface DeliberationParticipantAttempt {
  readonly id: string;
  readonly participantId: string;
  readonly requestHash: string;
  readonly status: "prepared" | "running" | "completed" | "failed" | "cancelled" | "unknown";
  readonly sealed: boolean;
  readonly preparedAt?: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly failedAt?: string;
  readonly cancelledAt?: string;
  readonly failure?: DeliberationParticipantFailure;
  readonly assessment?: DeliberationParticipantAssessment;
}

export interface DeliberationDifferenceItem {
  readonly kind: DeliberationDifferenceCategory;
  readonly status: "present" | "absent" | "unproven";
  readonly statements: readonly string[];
  readonly sourceReferences: readonly string[];
}

export interface DeliberationDifferenceSummary {
  readonly schemaVersion: "1.0.0";
  readonly categories: readonly DeliberationDifferenceItem[];
  readonly authority: "system_derived";
  readonly canResolveRoom: false;
  readonly winner: null;
  readonly ranking: null;
  readonly score: null;
  readonly canonicalHash: string;
}

export interface DeliberationInitialRound {
  readonly id: string;
  readonly requestsFrozenBeforeDispatch: true;
  readonly requestsFrozenAt: string;
  readonly dispatchPolicy: "parallel_no_retry";
  readonly revealPolicy: "both_valid_terminal_or_explicit_partial_cancel";
  readonly blindness: {
    readonly status: "protocol_enforced";
    readonly participantAExcludedParticipantB: true;
    readonly participantBExcludedParticipantA: true;
    readonly rawResponsesExcluded: true;
    readonly privateSessionsExcluded: true;
    readonly cognitiveIndependence: "unproven";
  };
  readonly manifests: readonly [DeliberationContextManifest, DeliberationContextManifest];
  readonly attempts: readonly [DeliberationParticipantAttempt, DeliberationParticipantAttempt];
  readonly reveal?: {
    readonly mode: "complete" | "partial" | "cancelled";
    readonly explicitUserAction: true;
    readonly revealedAt: string;
  };
}

export interface DeliberationChallenge {
  readonly id: string;
  readonly question: string;
  readonly status: "prepared" | "running" | "completed" | "failed" | "cancelled";
  readonly userConfirmed: boolean;
  readonly manifests: readonly [DeliberationContextManifest, DeliberationContextManifest];
  readonly attempts: readonly [DeliberationParticipantAttempt, DeliberationParticipantAttempt];
  readonly sharedContextHash: string;
  readonly preparedAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly failure?: DeliberationParticipantFailure;
  readonly assessment?: DeliberationParticipantAssessment;
}

export interface DeliberationParticipantRetry {
  readonly id: string;
  readonly participantId: string;
  readonly priorAttemptId: string;
  readonly status: "prepared" | "running" | "completed" | "failed" | "cancelled" | "unknown";
  readonly manifest: DeliberationContextManifest;
  readonly attempt: DeliberationParticipantAttempt;
  readonly userConfirmed: boolean;
  readonly preparedAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
}

export interface ManualExternalOpinion {
  readonly id: string;
  readonly sourceLabel: string;
  readonly providerClaim: string;
  readonly modelClaim: string;
  readonly capturedAt: string;
  readonly contextDisclosure: string;
  readonly exposure: {
    readonly sawParticipantAOutput: boolean;
    readonly sawParticipantBOutput: boolean;
  };
  readonly blindnessVerification: "not_verifiable";
  readonly publicContent: string;
  readonly classification: "manual_non_blind";
  readonly verification: "unverified_external_import";
  readonly authority: "external_claim_only";
  readonly canActAsParticipant: false;
  readonly canResolveRoom: false;
  readonly importedBy: ResearchActor & { readonly kind: "user" };
  readonly importedAt: string;
  readonly contentHash: string;
}

export interface DeliberationResolutionReceipt {
  readonly schemaVersion: "1.0.0";
  readonly id: string;
  readonly roomId: string;
  readonly projectId: string;
  readonly resolutionId: string;
  readonly sourceRoomHash: string;
  readonly differenceSummaryHash?: string;
  readonly before: { readonly status: DeliberationRoomStatus; readonly version: number };
  readonly after: { readonly status: "resolved" | "closed"; readonly version: number };
  readonly command: {
    readonly kind: DeliberationResolutionKind;
    readonly publicReason: string;
    readonly combinedText?: string;
  };
  readonly roomScopeOnly: true;
  readonly canonicalMutationAuthorized: false;
  readonly separateAuthorityRequired: true;
  readonly unproven: readonly string[];
  readonly authority: {
    readonly actor: ResearchActor & { readonly kind: "user" };
    readonly confirmedAt: string;
  };
  readonly receiptHash: string;
}

export interface DeliberationResolution {
  readonly id: string;
  readonly kind: DeliberationResolutionKind;
  readonly publicReason: string;
  readonly combinedText?: string;
  readonly supersedesResolutionId?: string;
  readonly authority: DeliberationResolutionReceipt["authority"];
  readonly receipt: DeliberationResolutionReceipt;
}

export interface DeliberationTransition {
  readonly from?: DeliberationRoomStatus;
  readonly to: DeliberationRoomStatus;
  readonly actor: "user" | "kernel";
  readonly at: string;
  readonly reason: string;
}

export interface DeliberationCommandReceipt {
  readonly commandId: string;
  readonly kind: string;
  readonly payloadHash: string;
  readonly resultVersion: number;
  readonly recordedAt: string;
}

export interface DeliberationRoom {
  readonly schemaVersion: "1.0.0";
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly source: DeliberationSourceBinding;
  readonly status: DeliberationRoomStatus;
  readonly authority: "user_owned";
  readonly providerReadiness: DeliberationProviderReadiness;
  readonly participants: readonly [DeliberationParticipantSnapshot, DeliberationParticipantSnapshot];
  readonly frozenContext?: DeliberationFrozenContext;
  readonly manifests?: readonly [DeliberationContextManifest, DeliberationContextManifest];
  readonly initialRound?: DeliberationInitialRound;
  readonly differenceSummary?: DeliberationDifferenceSummary;
  readonly challenge?: DeliberationChallenge;
  readonly retry?: DeliberationParticipantRetry;
  readonly manualExternalOpinions: readonly ManualExternalOpinion[];
  readonly resolutions: readonly DeliberationResolution[];
  readonly commandReceipts: readonly DeliberationCommandReceipt[];
  readonly transitions: readonly DeliberationTransition[];
  readonly version: EntityVersion;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const REQUIRED_BLIND_EXCLUSIONS = [
  "other_participant_output",
  "other_participant_private_context",
  "other_participant_session",
  "provider_raw_response",
  "hidden_chain_of_thought",
] as const;

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((item, index) => item === expected[index]);
}

function exactOptional(value: Record<string, unknown>, required: readonly string[], optional: readonly string[]): boolean {
  const actual = Object.keys(value);
  return required.every((key) => actual.includes(key)) && actual.every((key) => required.includes(key) || optional.includes(key));
}

function text(value: unknown, maximum = 16_384): string | undefined {
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

function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

function strings(value: unknown, maximumItems = 64, maximumBytes = 8_192): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length > maximumItems) return undefined;
  const output: string[] = [];
  for (const raw of value) {
    const parsed = text(raw, maximumBytes);
    if (parsed === undefined || output.includes(parsed)) return undefined;
    output.push(parsed);
  }
  return cloneFrozen(output);
}

function user(value: unknown): (ResearchActor & { readonly kind: "user" }) | undefined {
  const parsed = validateResearchActor(value);
  return parsed.ok && parsed.value.kind === "user" ? parsed.value : undefined;
}

function hashOf(value: unknown): string | undefined {
  const hashed = stableResearchHash(value);
  return hashed.ok ? hashed.value : undefined;
}

function at(clock: Clock): ResearchResult<string> {
  const value = readClock(clock);
  return value.ok ? value : err(researchError("invalid_deliberation_room"));
}

function nextVersion(room: DeliberationRoom, expected: EntityVersion): ResearchResult<EntityVersion> {
  const version = advanceEntityVersion(room.version, expected);
  return version.ok ? version : err(researchError("version_conflict", version.error.details));
}

function sourceHashInput(source: Pick<DeliberationSourceBinding, "kind" | "objectId" | "objectVersion" | "question">): unknown {
  return { kind: source.kind, objectId: source.objectId, objectVersion: source.objectVersion, question: source.question };
}

export function parseDeliberationSourceBinding(value: unknown): ResearchResult<DeliberationSourceBinding> {
  if (!isRecord(value) || !exact(value, ["projectId", "kind", "objectId", "objectVersion", "question", "sourceHash"])) return err(researchError("invalid_deliberation_source"));
  const project = parseResearchIdFor(value.projectId, "rprj_");
  const objectId = parseResearchId(value.objectId);
  const kind = value.kind as DeliberationSourceKind;
  const question = text(value.question, 16_384);
  if (!project.ok || !objectId.ok || !DELIBERATION_SOURCE_KINDS.includes(kind) || !integer(value.objectVersion, 1) || question === undefined || !sha(value.sourceHash)) return err(researchError("invalid_deliberation_source"));
  const expectedPrefix: Partial<Record<DeliberationSourceKind, string>> = {
    correction_appeal: "rapl_",
    research_issue: "riss_",
    research_decision: "rdec_",
    research_brief: "rbrf_",
  };
  const prefix = expectedPrefix[kind];
  if (prefix !== undefined && objectId.value.prefix !== prefix) return err(researchError("invalid_deliberation_source"));
  if (kind === "unresolved_conflict" && !["riss_", "rapl_", "rdec_"].includes(objectId.value.prefix)) return err(researchError("invalid_deliberation_source"));
  const expectedHash = hashOf(sourceHashInput({ kind, objectId: objectId.value.id, objectVersion: value.objectVersion, question }));
  if (expectedHash === undefined || expectedHash !== value.sourceHash) return err(researchError("invalid_deliberation_source"));
  return ok(cloneFrozen({ projectId: project.value.id, kind, objectId: objectId.value.id, objectVersion: value.objectVersion, question, sourceHash: value.sourceHash }));
}

export function parseDeliberationParticipantSnapshot(value: unknown): ResearchResult<DeliberationParticipantSnapshot> {
  if (!isRecord(value) || !exact(value, ["id", "slot", "role", "connectionId", "providerId", "family", "model", "harnessId", "runtimeIdentityHash", "endpointIdentityHash", "secretRefHash", "configGeneration", "locality"])) return err(researchError("invalid_deliberation_participants"));
  const id = parseResearchIdFor(value.id, "rpar_");
  const connectionId = text(value.connectionId, 256);
  const providerId = text(value.providerId, 256);
  const model = text(value.model, 512);
  const harnessId = text(value.harnessId, 256);
  if (!id.ok || !["a", "b"].includes(String(value.slot)) || value.role !== "independent_research_assessor" || connectionId === undefined || providerId === undefined || value.family !== "openai_compatible" || model === undefined || harnessId === undefined || !sha(value.runtimeIdentityHash) || !sha(value.endpointIdentityHash) || !sha(value.secretRefHash) || !integer(value.configGeneration, 1) || !["local", "external"].includes(String(value.locality))) return err(researchError("invalid_deliberation_participants"));
  return ok(cloneFrozen({
    id: id.value.id,
    slot: value.slot as "a" | "b",
    role: "independent_research_assessor" as const,
    connectionId,
    providerId,
    family: "openai_compatible" as const,
    model,
    harnessId,
    runtimeIdentityHash: value.runtimeIdentityHash,
    endpointIdentityHash: value.endpointIdentityHash,
    secretRefHash: value.secretRefHash,
    configGeneration: value.configGeneration,
    locality: value.locality as "local" | "external",
  }));
}

function parseParticipants(value: unknown): ResearchResult<readonly [DeliberationParticipantSnapshot, DeliberationParticipantSnapshot]> {
  if (!Array.isArray(value) || value.length !== 2) return err(researchError("invalid_deliberation_participants"));
  const first = parseDeliberationParticipantSnapshot(value[0]);
  const second = parseDeliberationParticipantSnapshot(value[1]);
  if (!first.ok || !second.ok || first.value.slot !== "a" || second.value.slot !== "b") return err(researchError("invalid_deliberation_participants"));
  if (first.value.id === second.value.id) return err(researchError("invalid_deliberation_participants"));
  return ok(cloneFrozen([first.value, second.value] as const));
}

export function parseDeliberationFrozenContext(value: unknown): ResearchResult<DeliberationFrozenContext> {
  const keys = ["schemaVersion", "question", "brief", "retainedDecisions", "allowedEvidenceIds", "excludedEvidenceIds", "comparisonDimensions", "stopConditions", "budget", "stateBindingHash", "canonicalHash"];
  if (!isRecord(value) || !exact(value, keys) || value.schemaVersion !== "1.0.0" || text(value.question, 16_384) === undefined || !isRecord(value.brief) || !exact(value.brief, ["briefId", "versionId", "versionNumber", "hash"]) || !parseResearchIdFor(value.brief.briefId, "rbrf_").ok || !parseResearchIdFor(value.brief.versionId, "rbrf_").ok || !integer(value.brief.versionNumber, 1) || !sha(value.brief.hash) || !Array.isArray(value.retainedDecisions) || value.retainedDecisions.length > 128 || !Array.isArray(value.comparisonDimensions) || value.comparisonDimensions.length !== DELIBERATION_COMPARISON_DIMENSION_IDS.length || !isRecord(value.budget) || !exact(value.budget, ["participants", "blindInitialRounds", "directedChallengeRounds", "maximumProviderCalls", "automaticRetries", "synthesisProviders"]) || value.budget.participants !== 2 || value.budget.blindInitialRounds !== 1 || value.budget.directedChallengeRounds !== 1 || value.budget.maximumProviderCalls !== 4 || value.budget.automaticRetries !== 0 || value.budget.synthesisProviders !== 0 || !sha(value.stateBindingHash) || !sha(value.canonicalHash)) return err(researchError("invalid_deliberation_manifest"));
  const allowedEvidenceIds = strings(value.allowedEvidenceIds, 256, 64);
  const excludedEvidenceIds = strings(value.excludedEvidenceIds, 256, 64);
  const stopConditions = strings(value.stopConditions, 32, 1024);
  if (allowedEvidenceIds === undefined || excludedEvidenceIds === undefined || stopConditions === undefined || stopConditions.length === 0 || allowedEvidenceIds.some((id) => !parseResearchIdFor(id, "revd_").ok || excludedEvidenceIds.includes(id)) || excludedEvidenceIds.some((id) => !parseResearchIdFor(id, "revd_").ok)) return err(researchError("invalid_deliberation_manifest"));
  const retainedDecisions: DeliberationFrozenContext["retainedDecisions"][number][] = [];
  for (const item of value.retainedDecisions) {
    if (!isRecord(item) || !exact(item, ["id", "version", "hash"]) || !parseResearchIdFor(item.id, "rdec_").ok || !integer(item.version, 1) || !sha(item.hash) || retainedDecisions.some((existing) => existing.id === item.id)) return err(researchError("invalid_deliberation_manifest"));
    retainedDecisions.push(cloneFrozen({ id: item.id as string, version: item.version, hash: item.hash }));
  }
  const comparisonDimensions: DeliberationComparisonDimension[] = [];
  for (const [index, item] of value.comparisonDimensions.entries()) {
    if (!isRecord(item) || !exact(item, ["id", "label"]) || item.id !== DELIBERATION_COMPARISON_DIMENSION_IDS[index] || text(item.label, 256) === undefined) return err(researchError("invalid_deliberation_manifest"));
    comparisonDimensions.push(cloneFrozen({ id: item.id as DeliberationComparisonDimensionId, label: String(item.label).trim() }));
  }
  const { canonicalHash, ...withoutHash } = value;
  if (hashOf(withoutHash) !== canonicalHash) return err(researchError("invalid_deliberation_manifest"));
  return ok(cloneFrozen(value as unknown as DeliberationFrozenContext));
}

function parseVersionHash(value: unknown): { readonly version: string; readonly hash: string } | undefined {
  if (!isRecord(value) || !exact(value, ["version", "hash"])) return undefined;
  const version = text(value.version, 64);
  return version === undefined || !sha(value.hash) ? undefined : cloneFrozen({ version, hash: value.hash });
}

export function parseDeliberationContextManifest(value: unknown): ResearchResult<DeliberationContextManifest> {
  const keys = ["schemaVersion", "roomId", "roundId", "participantId", "participantSlot", "requestHash", "requestBodyHash", "participantSnapshotHash", "includedFields", "includedObjects", "excludedFields", "stateBindingHash", "protocol", "prompt", "responseSchema", "rubric", "tokenBudget", "maxResponseBytes", "tools", "roomContextOnly", "canonicalHash"];
  if (!isRecord(value) || !exact(value, keys)) return err(researchError("invalid_deliberation_manifest"));
  const room = parseResearchIdFor(value.roomId, "rdlr_");
  const round = parseResearchId(value.roundId);
  const participant = parseResearchIdFor(value.participantId, "rpar_");
  const includedFields = strings(value.includedFields, 128, 512);
  const excludedFields = strings(value.excludedFields, 128, 512);
  const protocol = parseVersionHash(value.protocol);
  const prompt = parseVersionHash(value.prompt);
  const responseSchema = parseVersionHash(value.responseSchema);
  const rubric = parseVersionHash(value.rubric);
  if (!room.ok || !round.ok || !["rrnd_", "rdch_"].includes(round.value.prefix) || !participant.ok || !["a", "b"].includes(String(value.participantSlot)) || !sha(value.requestHash) || !sha(value.requestBodyHash) || !sha(value.participantSnapshotHash) || includedFields === undefined || includedFields.length === 0 || excludedFields === undefined || REQUIRED_BLIND_EXCLUSIONS.some((item) => !excludedFields.includes(item)) || !sha(value.stateBindingHash) || protocol === undefined || prompt === undefined || responseSchema === undefined || rubric === undefined || !integer(value.tokenBudget, 256, 131_072) || !integer(value.maxResponseBytes, 1_024, 16_777_216) || value.tools !== "none" || value.roomContextOnly !== true || !sha(value.canonicalHash) || !Array.isArray(value.includedObjects) || value.includedObjects.length > 128) return err(researchError("invalid_deliberation_manifest"));
  const includedObjects: DeliberationContextManifest["includedObjects"][number][] = [];
  for (const raw of value.includedObjects) {
    if (!isRecord(raw) || !exact(raw, ["kind", "id", "version", "hash", "fields"]) || !["appeal", "brief", "decision", "issue", "evidence", "artifact", "revision", "participant_assessment", "difference_summary"].includes(String(raw.kind)) || !parseResearchId(raw.id).ok || !integer(raw.version, 1) || !sha(raw.hash) || !isRecord(raw.fields)) return err(researchError("invalid_deliberation_manifest"));
    const fields: Record<string, string> = {};
    for (const [key, rawField] of Object.entries(raw.fields)) {
      const fieldKey = text(key, 256);
      const fieldValue = text(rawField, 8_192);
      if (fieldKey === undefined || fieldValue === undefined || Object.hasOwn(fields, fieldKey)) return err(researchError("invalid_deliberation_manifest"));
      fields[fieldKey] = fieldValue;
    }
    includedObjects.push(cloneFrozen({ kind: raw.kind as DeliberationContextManifest["includedObjects"][number]["kind"], id: raw.id as string, version: raw.version, hash: raw.hash, fields }));
  }
  const { canonicalHash, ...withoutHash } = value;
  const expectedHash = hashOf(withoutHash);
  if (expectedHash === undefined || expectedHash !== canonicalHash) return err(researchError("invalid_deliberation_manifest"));
  return ok(cloneFrozen({
    schemaVersion: "1.0.0" as const,
    roomId: room.value.id,
    roundId: round.value.id,
    participantId: participant.value.id,
    participantSlot: value.participantSlot as "a" | "b",
    requestHash: value.requestHash,
    requestBodyHash: value.requestBodyHash,
    participantSnapshotHash: value.participantSnapshotHash,
    includedFields,
    includedObjects,
    excludedFields,
    stateBindingHash: value.stateBindingHash,
    protocol,
    prompt,
    responseSchema,
    rubric,
    tokenBudget: value.tokenBudget,
    maxResponseBytes: value.maxResponseBytes,
    tools: "none" as const,
    roomContextOnly: true as const,
    canonicalHash: value.canonicalHash,
  }));
}

function parseSpan(value: unknown): DeliberationEvidenceSpan | undefined {
  if (!isRecord(value) || !exact(value, ["spanId", "projectId", "artifactId", "revisionId", "normalizedTextHash", "start", "end", "quote", "quoteHash", "normalizationVersion", "indexUnit"])) return undefined;
  const spanId = text(value.spanId, 128);
  const project = parseResearchIdFor(value.projectId, "rprj_");
  const artifact = parseResearchIdFor(value.artifactId, "rart_");
  const revision = parseResearchIdFor(value.revisionId, "rrev_");
  const quote = text(value.quote, 16_384);
  const normalizationVersion = text(value.normalizationVersion, 128);
  if (spanId === undefined || !project.ok || !artifact.ok || !revision.ok || !sha(value.normalizedTextHash) || !integer(value.start, 0) || !integer(value.end, 1) || value.end <= value.start || quote === undefined || !sha(value.quoteHash) || normalizationVersion === undefined || value.indexUnit !== "utf16_code_unit") return undefined;
  return cloneFrozen({ spanId, projectId: project.value.id, artifactId: artifact.value.id, revisionId: revision.value.id, normalizedTextHash: value.normalizedTextHash, start: value.start, end: value.end, quote, quoteHash: value.quoteHash, normalizationVersion, indexUnit: "utf16_code_unit" as const });
}

export function parseDeliberationParticipantAssessment(value: unknown): ResearchResult<DeliberationParticipantAssessment> {
  const keys = ["schemaVersion", "roomId", "roundId", "participantId", "participantSlot", "requestHash", "assessment", "directAnswer", "dimensions", "claims", "evidenceSpans", "assumptions", "scope", "counterexamples", "alternativeExplanations", "unknowns", "nextDiscriminatingEvidence", "missingContext", "uncertaintySources", "publicRationale", "proposedNextStep", "hashes"];
  if (!isRecord(value) || !exact(value, keys) || value.schemaVersion !== "1.0.0") return err(researchError("invalid_deliberation_result"));
  const room = parseResearchIdFor(value.roomId, "rdlr_");
  const round = parseResearchId(value.roundId);
  const participant = parseResearchIdFor(value.participantId, "rpar_");
  const directAnswer = text(value.directAnswer, 16_384);
  const assumptions = strings(value.assumptions, 32, 4_096);
  const scope = text(value.scope, 4_096);
  const counterexamples = strings(value.counterexamples, 32, 4_096);
  const alternativeExplanations = strings(value.alternativeExplanations, 32, 4_096);
  const unknowns = strings(value.unknowns, 32, 4_096);
  const nextDiscriminatingEvidence = strings(value.nextDiscriminatingEvidence, 32, 4_096);
  const missingContext = strings(value.missingContext, 32, 4_096);
  const uncertaintySources = strings(value.uncertaintySources, 32, 4_096);
  const publicRationale = text(value.publicRationale, 16_384);
  const proposedNextStep = text(value.proposedNextStep, 8_192);
  if (!room.ok || !round.ok || !["rrnd_", "rdch_"].includes(round.value.prefix) || !participant.ok || !["a", "b"].includes(String(value.participantSlot)) || !sha(value.requestHash) || !["support", "oppose", "mixed", "uncertain", "insufficient_context"].includes(String(value.assessment)) || directAnswer === undefined || assumptions === undefined || scope === undefined || counterexamples === undefined || alternativeExplanations === undefined || unknowns === undefined || nextDiscriminatingEvidence === undefined || missingContext === undefined || uncertaintySources === undefined || publicRationale === undefined || proposedNextStep === undefined || !Array.isArray(value.dimensions) || value.dimensions.length !== DELIBERATION_COMPARISON_DIMENSION_IDS.length || !Array.isArray(value.claims) || value.claims.length > 64 || !Array.isArray(value.evidenceSpans) || value.evidenceSpans.length > 64 || !isRecord(value.hashes) || !exact(value.hashes, ["responseSchemaHash", "rubricHash", "requestHash"]) || !sha(value.hashes.responseSchemaHash) || !sha(value.hashes.rubricHash) || value.hashes.requestHash !== value.requestHash) return err(researchError("invalid_deliberation_result"));
  const evidenceSpans: DeliberationEvidenceSpan[] = [];
  for (const raw of value.evidenceSpans) {
    const span = parseSpan(raw);
    if (span === undefined || evidenceSpans.some((item) => item.spanId === span.spanId)) return err(researchError("invalid_deliberation_result"));
    evidenceSpans.push(span);
  }
  const dimensions: DeliberationParticipantAssessment["dimensions"][number][] = [];
  for (const [index, raw] of value.dimensions.entries()) {
    if (!isRecord(raw) || !exact(raw, ["dimensionId", "position", "summary", "evidenceSpanIds"]) || raw.dimensionId !== DELIBERATION_COMPARISON_DIMENSION_IDS[index] || !["support", "challenge", "qualify", "uncertain", "not_addressed"].includes(String(raw.position)) || text(raw.summary, 4_096) === undefined) return err(researchError("invalid_deliberation_result"));
    const evidenceSpanIds = strings(raw.evidenceSpanIds, 64, 128);
    if (evidenceSpanIds === undefined || evidenceSpanIds.some((id) => !evidenceSpans.some((span) => span.spanId === id))) return err(researchError("invalid_deliberation_result"));
    dimensions.push(cloneFrozen({ dimensionId: raw.dimensionId as DeliberationComparisonDimensionId, position: raw.position as DeliberationParticipantAssessment["dimensions"][number]["position"], summary: String(raw.summary).trim(), evidenceSpanIds }));
  }
  const claims: DeliberationParticipantAssessment["claims"][number][] = [];
  for (const raw of value.claims) {
    if (!isRecord(raw) || !exact(raw, ["claimId", "stance", "text", "evidenceSpanIds"])) return err(researchError("invalid_deliberation_result"));
    const claimId = text(raw.claimId, 128);
    const claimText = text(raw.text, 8_192);
    const evidenceSpanIds = strings(raw.evidenceSpanIds, 64, 128);
    if (claimId === undefined || claims.some((item) => item.claimId === claimId) || !["support", "challenge", "qualify", "uncertain"].includes(String(raw.stance)) || claimText === undefined || evidenceSpanIds === undefined || evidenceSpanIds.some((id) => !evidenceSpans.some((span) => span.spanId === id))) return err(researchError("invalid_deliberation_result"));
    claims.push(cloneFrozen({ claimId, stance: raw.stance as DeliberationParticipantAssessment["claims"][number]["stance"], text: claimText, evidenceSpanIds }));
  }
  if (value.assessment === "insufficient_context" && missingContext.length === 0) return err(researchError("invalid_deliberation_result"));
  return ok(cloneFrozen({
    schemaVersion: "1.0.0" as const,
    roomId: room.value.id,
    roundId: round.value.id,
    participantId: participant.value.id,
    participantSlot: value.participantSlot as "a" | "b",
    requestHash: value.requestHash,
    assessment: value.assessment as DeliberationParticipantAssessment["assessment"],
    directAnswer,
    dimensions,
    claims,
    evidenceSpans,
    assumptions,
    scope,
    counterexamples,
    alternativeExplanations,
    unknowns,
    nextDiscriminatingEvidence,
    missingContext,
    uncertaintySources,
    publicRationale,
    proposedNextStep,
    hashes: { responseSchemaHash: value.hashes.responseSchemaHash, rubricHash: value.hashes.rubricHash, requestHash: value.requestHash },
  }));
}

function parseDifferenceSummary(value: unknown): DeliberationDifferenceSummary | undefined {
  if (!isRecord(value) || !exact(value, ["schemaVersion", "categories", "authority", "canResolveRoom", "winner", "ranking", "score", "canonicalHash"]) || value.schemaVersion !== "1.0.0" || value.authority !== "system_derived" || value.canResolveRoom !== false || value.winner !== null || value.ranking !== null || value.score !== null || !sha(value.canonicalHash) || !Array.isArray(value.categories) || value.categories.length !== DELIBERATION_DIFFERENCE_CATEGORIES.length) return undefined;
  const categories: DeliberationDifferenceItem[] = [];
  for (const [index, raw] of value.categories.entries()) {
    if (!isRecord(raw) || !exact(raw, ["kind", "status", "statements", "sourceReferences"]) || raw.kind !== DELIBERATION_DIFFERENCE_CATEGORIES[index] || !["present", "absent", "unproven"].includes(String(raw.status))) return undefined;
    const statements = strings(raw.statements, 64, 8_192);
    const sourceReferences = strings(raw.sourceReferences, 128, 256);
    if (statements === undefined || sourceReferences === undefined) return undefined;
    categories.push(cloneFrozen({ kind: raw.kind as DeliberationDifferenceCategory, status: raw.status as DeliberationDifferenceItem["status"], statements, sourceReferences }));
  }
  const { canonicalHash, ...withoutHash } = value;
  if (hashOf(withoutHash) !== canonicalHash) return undefined;
  return cloneFrozen({
    schemaVersion: "1.0.0",
    categories,
    authority: "system_derived",
    canResolveRoom: false,
    winner: null,
    ranking: null,
    score: null,
    canonicalHash: value.canonicalHash,
  });
}

function parseAttempt(value: unknown): DeliberationParticipantAttempt | undefined {
  if (!isRecord(value) || !exactOptional(value, ["id", "participantId", "requestHash", "status", "sealed"], ["preparedAt", "startedAt", "completedAt", "failedAt", "cancelledAt", "failure", "assessment"])) return undefined;
  if (!parseResearchIdFor(value.id, "rdat_").ok || !parseResearchIdFor(value.participantId, "rpar_").ok || !sha(value.requestHash) || !["prepared", "running", "completed", "failed", "cancelled", "unknown"].includes(String(value.status)) || typeof value.sealed !== "boolean") return undefined;
  if (value.status === "prepared" && text(value.preparedAt, 64) === undefined || value.status !== "prepared" && text(value.startedAt, 64) === undefined) return undefined;
  if (value.failure !== undefined && !DELIBERATION_PARTICIPANT_FAILURES.includes(value.failure as DeliberationParticipantFailure)) return undefined;
  if (value.assessment !== undefined && !parseDeliberationParticipantAssessment(value.assessment).ok) return undefined;
  return cloneFrozen(value as unknown as DeliberationParticipantAttempt);
}

function validInitialRound(value: unknown, room: DeliberationRoom): boolean {
  if (!isRecord(value) || !exactOptional(value, ["id", "requestsFrozenBeforeDispatch", "requestsFrozenAt", "dispatchPolicy", "revealPolicy", "blindness", "manifests", "attempts"], ["reveal"]) || !parseResearchIdFor(value.id, "rrnd_").ok || value.requestsFrozenBeforeDispatch !== true || text(value.requestsFrozenAt, 64) === undefined || value.dispatchPolicy !== "parallel_no_retry" || value.revealPolicy !== "both_valid_terminal_or_explicit_partial_cancel" || !isRecord(value.blindness) || !exact(value.blindness, ["status", "participantAExcludedParticipantB", "participantBExcludedParticipantA", "rawResponsesExcluded", "privateSessionsExcluded", "cognitiveIndependence"]) || value.blindness.status !== "protocol_enforced" || value.blindness.participantAExcludedParticipantB !== true || value.blindness.participantBExcludedParticipantA !== true || value.blindness.rawResponsesExcluded !== true || value.blindness.privateSessionsExcluded !== true || value.blindness.cognitiveIndependence !== "unproven" || !Array.isArray(value.manifests) || value.manifests.length !== 2 || !Array.isArray(value.attempts) || value.attempts.length !== 2) return false;
  const manifests = [parseDeliberationContextManifest(value.manifests[0]), parseDeliberationContextManifest(value.manifests[1])] as const;
  const attempts = [parseAttempt(value.attempts[0]), parseAttempt(value.attempts[1])] as const;
  if (!manifests[0].ok || !manifests[1].ok || attempts[0] === undefined || attempts[1] === undefined) return false;
  for (const index of [0, 1] as const) {
    const manifest = manifests[index];
    const attempt = attempts[index];
    if (!manifest.ok || attempt === undefined || attempt.status === "prepared" || manifest.value.roomId !== room.id || manifest.value.participantId !== room.participants[index].id || attempt.participantId !== room.participants[index].id || attempt.requestHash !== manifest.value.requestHash) return false;
  }
  if (value.reveal !== undefined && (!isRecord(value.reveal) || !exact(value.reveal, ["mode", "explicitUserAction", "revealedAt"]) || !["complete", "partial", "cancelled"].includes(String(value.reveal.mode)) || value.reveal.explicitUserAction !== true || text(value.reveal.revealedAt, 64) === undefined)) return false;
  return true;
}

function validChallenge(value: unknown, room: DeliberationRoom): boolean {
  if (!isRecord(value) || !exactOptional(value, ["id", "question", "status", "userConfirmed", "manifests", "attempts", "sharedContextHash", "preparedAt"], ["startedAt", "completedAt"]) || !parseResearchIdFor(value.id, "rdch_").ok || text(value.question, 8_192) === undefined || !["prepared", "running", "completed", "failed", "cancelled"].includes(String(value.status)) || typeof value.userConfirmed !== "boolean" || !sha(value.sharedContextHash) || text(value.preparedAt, 64) === undefined || !Array.isArray(value.manifests) || value.manifests.length !== 2 || !Array.isArray(value.attempts) || value.attempts.length !== 2) return false;
  const manifests = [parseDeliberationContextManifest(value.manifests[0]), parseDeliberationContextManifest(value.manifests[1])] as const;
  const attempts = [parseAttempt(value.attempts[0]), parseAttempt(value.attempts[1])] as const;
  for (const index of [0, 1] as const) {
    const manifest = manifests[index]; const attempt = attempts[index];
    if (!manifest.ok || attempt === undefined || manifest.value.roomId !== room.id || manifest.value.roundId !== value.id || manifest.value.participantId !== room.participants[index].id || manifest.value.requestHash !== attempt.requestHash || manifest.value.stateBindingHash !== room.frozenContext?.stateBindingHash || attempt.participantId !== room.participants[index].id) return false;
  }
  if (value.status === "prepared" && attempts.some((attempt) => attempt?.status !== "prepared")) return false;
  if (value.status === "running" && attempts.every((attempt) => attempt !== undefined && terminal(attempt))) return false;
  return true;
}

function validRetry(value: unknown, room: DeliberationRoom): boolean {
  if (!isRecord(value) || !exactOptional(value, ["id", "participantId", "priorAttemptId", "status", "manifest", "attempt", "userConfirmed", "preparedAt"], ["startedAt", "completedAt"]) || !parseResearchIdFor(value.id, "rrnd_").ok || !parseResearchIdFor(value.participantId, "rpar_").ok || !parseResearchIdFor(value.priorAttemptId, "rdat_").ok || !["prepared", "running", "completed", "failed", "cancelled", "unknown"].includes(String(value.status)) || typeof value.userConfirmed !== "boolean" || text(value.preparedAt, 64) === undefined) return false;
  const participantIndex = room.participants.findIndex((participant) => participant.id === value.participantId);
  if (participantIndex !== 0 && participantIndex !== 1 || room.initialRound === undefined || room.initialRound.attempts[participantIndex].id !== value.priorAttemptId || room.initialRound.attempts[participantIndex].status === "completed") return false;
  const manifest = parseDeliberationContextManifest(value.manifest);
  const attempt = parseAttempt(value.attempt);
  if (!manifest.ok || attempt === undefined || manifest.value.roomId !== room.id || manifest.value.roundId !== value.id || manifest.value.participantId !== value.participantId || manifest.value.participantSlot !== room.participants[participantIndex].slot || manifest.value.stateBindingHash !== room.frozenContext?.stateBindingHash || attempt.participantId !== value.participantId || attempt.requestHash !== manifest.value.requestHash || attempt.status !== value.status) return false;
  if (value.status === "prepared" && value.userConfirmed || value.status !== "prepared" && !value.userConfirmed) return false;
  return true;
}

export function parseDeliberationRoom(value: unknown): ResearchResult<DeliberationRoom> {
  const required = ["schemaVersion", "id", "projectId", "title", "source", "status", "authority", "providerReadiness", "participants", "manualExternalOpinions", "resolutions", "commandReceipts", "transitions", "version", "createdAt", "updatedAt"];
  const optional = ["frozenContext", "manifests", "initialRound", "differenceSummary", "challenge", "retry"];
  if (!isRecord(value) || !exactOptional(value, required, optional) || value.schemaVersion !== "1.0.0") return err(researchError("invalid_deliberation_room"));
  const id = parseResearchIdFor(value.id, "rdlr_");
  const project = parseResearchIdFor(value.projectId, "rprj_");
  const title = text(value.title, 512);
  const source = parseDeliberationSourceBinding(value.source);
  const participants = parseParticipants(value.participants);
  const version = parseEntityVersion(value.version);
  if (!id.ok || !project.ok || title === undefined || !source.ok || source.value.projectId !== project.value.id || !participants.ok || !DELIBERATION_ROOM_STATUSES.includes(value.status as DeliberationRoomStatus) || value.authority !== "user_owned" || !["configured_distinct", "blocked_missing_provider", "same_runtime_not_mutually_independent"].includes(String(value.providerReadiness)) || !version.ok || text(value.createdAt, 64) === undefined || text(value.updatedAt, 64) === undefined || !Array.isArray(value.manualExternalOpinions) || !Array.isArray(value.resolutions) || !Array.isArray(value.commandReceipts) || value.commandReceipts.length > 4096 || !Array.isArray(value.transitions)) return err(researchError("invalid_deliberation_room"));
  const isolatedFields: (keyof DeliberationParticipantSnapshot)[] = ["connectionId", "runtimeIdentityHash", "endpointIdentityHash", "secretRefHash"];
  const identitiesDistinct = isolatedFields.every((field) => participants.value[0][field] !== participants.value[1][field]);
  if (value.providerReadiness === "configured_distinct" && !identitiesDistinct) return err(researchError("invalid_deliberation_participants"));
  if (value.providerReadiness === "same_runtime_not_mutually_independent" && identitiesDistinct) return err(researchError("invalid_deliberation_participants"));
  const provisional = value as unknown as DeliberationRoom;
  if (value.frozenContext !== undefined) {
    const frozenContext = parseDeliberationFrozenContext(value.frozenContext);
    if (!frozenContext.ok || frozenContext.value.question !== source.value.question) return err(researchError("invalid_deliberation_room"));
  }
  if (value.manifests !== undefined && value.frozenContext === undefined) return err(researchError("invalid_deliberation_room"));
  if (value.manifests !== undefined) {
    if (!Array.isArray(value.manifests) || value.manifests.length !== 2) return err(researchError("invalid_deliberation_room"));
    const first = parseDeliberationContextManifest(value.manifests[0]);
    const second = parseDeliberationContextManifest(value.manifests[1]);
    if (!first.ok || !second.ok || first.value.roomId !== id.value.id || second.value.roomId !== id.value.id || first.value.participantId !== participants.value[0].id || second.value.participantId !== participants.value[1].id) return err(researchError("invalid_deliberation_room"));
  }
  if (value.initialRound !== undefined && !validInitialRound(value.initialRound, provisional)) return err(researchError("invalid_deliberation_room"));
  if (value.differenceSummary !== undefined && parseDifferenceSummary(value.differenceSummary) === undefined) return err(researchError("invalid_deliberation_room"));
  if (value.challenge !== undefined && !validChallenge(value.challenge, provisional)) return err(researchError("invalid_deliberation_room"));
  if (value.retry !== undefined && !validRetry(value.retry, provisional)) return err(researchError("invalid_deliberation_room"));
  for (const opinion of value.manualExternalOpinions) {
    if (!isRecord(opinion) || !exact(opinion, ["id", "sourceLabel", "providerClaim", "modelClaim", "capturedAt", "contextDisclosure", "exposure", "blindnessVerification", "publicContent", "classification", "verification", "authority", "canActAsParticipant", "canResolveRoom", "importedBy", "importedAt", "contentHash"]) || !parseResearchIdFor(opinion.id, "rman_").ok || text(opinion.sourceLabel, 512) === undefined || text(opinion.providerClaim, 512) === undefined || text(opinion.modelClaim, 512) === undefined || text(opinion.capturedAt, 64) === undefined || text(opinion.contextDisclosure, 8_192) === undefined || !isRecord(opinion.exposure) || !exact(opinion.exposure, ["sawParticipantAOutput", "sawParticipantBOutput"]) || typeof opinion.exposure.sawParticipantAOutput !== "boolean" || typeof opinion.exposure.sawParticipantBOutput !== "boolean" || opinion.blindnessVerification !== "not_verifiable" || text(opinion.publicContent, 32_768) === undefined || opinion.classification !== "manual_non_blind" || opinion.verification !== "unverified_external_import" || opinion.authority !== "external_claim_only" || opinion.canActAsParticipant !== false || opinion.canResolveRoom !== false || user(opinion.importedBy) === undefined || text(opinion.importedAt, 64) === undefined || !sha(opinion.contentHash)) return err(researchError("invalid_deliberation_room"));
  }
  for (const resolution of value.resolutions) {
    if (!isRecord(resolution) || !parseResearchIdFor(resolution.id, "rdrr_").ok || !DELIBERATION_RESOLUTION_KINDS.includes(resolution.kind as DeliberationResolutionKind) || text(resolution.publicReason, 16_384) === undefined || !isRecord(resolution.authority) || user(resolution.authority.actor) === undefined || text(resolution.authority.confirmedAt, 64) === undefined || !isRecord(resolution.receipt) || !parseResearchIdFor(resolution.receipt.id, "rdrc_").ok || !sha(resolution.receipt.receiptHash)) return err(researchError("invalid_deliberation_room"));
  }
  const commandIds = new Set<string>();
  for (const receipt of value.commandReceipts) {
    if (!isRecord(receipt) || !exact(receipt, ["commandId", "kind", "payloadHash", "resultVersion", "recordedAt"]) || text(receipt.commandId, 128) === undefined || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(String(receipt.commandId)) || text(receipt.kind, 128) === undefined || !sha(receipt.payloadHash) || !integer(receipt.resultVersion, 1) || receipt.resultVersion > version.value || text(receipt.recordedAt, 64) === undefined || commandIds.has(String(receipt.commandId))) return err(researchError("invalid_deliberation_room"));
    commandIds.add(String(receipt.commandId));
  }
  for (const transition of value.transitions) {
    if (!isRecord(transition) || !exactOptional(transition, ["to", "actor", "at", "reason"], ["from"]) || !DELIBERATION_ROOM_STATUSES.includes(transition.to as DeliberationRoomStatus) || transition.from !== undefined && !DELIBERATION_ROOM_STATUSES.includes(transition.from as DeliberationRoomStatus) || !["user", "kernel"].includes(String(transition.actor)) || text(transition.at, 64) === undefined || text(transition.reason, 512) === undefined) return err(researchError("invalid_deliberation_room"));
  }
  return ok(cloneFrozen(value as unknown as DeliberationRoom));
}

function move(
  roomInput: DeliberationRoom,
  status: DeliberationRoomStatus,
  version: EntityVersion,
  timestamp: string,
  actor: "user" | "kernel",
  reason: string,
  patch: Partial<Pick<DeliberationRoom, "frozenContext" | "manifests" | "initialRound" | "differenceSummary" | "challenge" | "retry" | "manualExternalOpinions" | "resolutions">> = {},
  extraTransitions: readonly DeliberationTransition[] = [],
): ResearchResult<DeliberationRoom> {
  return parseDeliberationRoom({
    ...roomInput,
    ...patch,
    status,
    version,
    updatedAt: timestamp,
    transitions: [...roomInput.transitions, ...extraTransitions, { from: roomInput.status, to: status, actor, at: timestamp, reason }],
  });
}

export function createDeliberationRoom(
  input: {
    readonly source: DeliberationSourceBinding;
    readonly title: string;
    readonly participants: readonly [DeliberationParticipantSnapshot, DeliberationParticipantSnapshot];
    readonly providerReadiness: DeliberationProviderReadiness;
    readonly commandId: string;
    readonly actor: ResearchActor;
  },
  ports: { readonly clock: Clock; readonly idFactory: IdFactory },
): ResearchResult<DeliberationRoom> {
  const actor = user(input.actor);
  if (actor === undefined) return err(researchError("user_deliberation_action_required"));
  const source = parseDeliberationSourceBinding(input.source);
  const participants = parseParticipants(input.participants);
  const title = text(input.title, 512);
  const id = parseResearchIdFor(ports.idFactory.create("rdlr_"), "rdlr_");
  const timestamp = at(ports.clock);
  const commandId = text(input.commandId, 128);
  const payloadHash = hashOf({ source: input.source, title: input.title, participants: input.participants, providerReadiness: input.providerReadiness });
  if (!source.ok) return source;
  if (!participants.ok) return participants;
  if (title === undefined || !id.ok || !timestamp.ok || commandId === undefined || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(commandId) || payloadHash === undefined) return err(researchError("invalid_deliberation_room"));
  return parseDeliberationRoom({
    schemaVersion: "1.0.0",
    id: id.value.id,
    projectId: source.value.projectId,
    title,
    source: source.value,
    status: "draft",
    authority: "user_owned",
    providerReadiness: input.providerReadiness,
    participants: participants.value,
    manualExternalOpinions: [],
    resolutions: [],
    commandReceipts: [{ commandId, kind: "create", payloadHash, resultVersion: initialEntityVersion(), recordedAt: timestamp.value }],
    transitions: [{ to: "draft", actor: "user", at: timestamp.value, reason: "deliberation_room_created" }],
    version: initialEntityVersion(),
    createdAt: timestamp.value,
    updatedAt: timestamp.value,
  });
}

export function inspectDeliberationCommand(
  roomInput: DeliberationRoom,
  input: { readonly commandId: string; readonly kind: string; readonly payloadHash: string },
): ResearchResult<"new" | "replay"> {
  const room = parseDeliberationRoom(roomInput);
  const commandId = text(input.commandId, 128);
  const kind = text(input.kind, 128);
  if (!room.ok) return room;
  if (commandId === undefined || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(commandId) || kind === undefined || !sha(input.payloadHash)) return err(researchError("invalid_deliberation_room"));
  const prior = room.value.commandReceipts.find((receipt) => receipt.commandId === commandId);
  if (prior === undefined) return ok("new");
  return prior.kind === kind && prior.payloadHash === input.payloadHash ? ok("replay") : err(researchError("deliberation_command_conflict"));
}

export function recordDeliberationCommand(
  roomInput: DeliberationRoom,
  input: { readonly commandId: string; readonly kind: string; readonly payloadHash: string },
  clock: Clock,
): ResearchResult<DeliberationRoom> {
  const room = parseDeliberationRoom(roomInput);
  if (!room.ok) return room;
  const inspected = inspectDeliberationCommand(room.value, input);
  if (!inspected.ok) return inspected;
  if (inspected.value === "replay") return room;
  const timestamp = at(clock);
  if (!timestamp.ok) return timestamp;
  return parseDeliberationRoom({ ...room.value, commandReceipts: [...room.value.commandReceipts, { commandId: input.commandId, kind: input.kind, payloadHash: input.payloadHash, resultVersion: room.value.version, recordedAt: timestamp.value }] });
}

export function prepareDeliberationContext(
  roomInput: DeliberationRoom,
  input: { readonly expectedVersion: EntityVersion; readonly frozenContext: DeliberationFrozenContext; readonly manifests: readonly [DeliberationContextManifest, DeliberationContextManifest] },
  clock: Clock,
): ResearchResult<DeliberationRoom> {
  const room = parseDeliberationRoom(roomInput);
  if (!room.ok) return room;
  if (room.value.status !== "draft") return err(researchError("invalid_deliberation_transition"));
  const first = parseDeliberationContextManifest(input.manifests[0]);
  const second = parseDeliberationContextManifest(input.manifests[1]);
  const frozenContext = parseDeliberationFrozenContext(input.frozenContext);
  if (!first.ok || !second.ok || !frozenContext.ok || frozenContext.value.question !== room.value.source.question) return err(researchError("invalid_deliberation_manifest"));
  const manifests = [first.value, second.value] as const;
  for (const index of [0, 1] as const) {
    const participant = room.value.participants[index];
    const manifest = manifests[index];
    if (manifest.roomId !== room.value.id || manifest.participantId !== participant.id || manifest.participantSlot !== participant.slot || manifest.participantSnapshotHash !== hashOf(participant) || manifest.stateBindingHash !== frozenContext.value.stateBindingHash) return err(researchError("invalid_deliberation_manifest"));
  }
  if (first.value.roundId !== second.value.roundId || first.value.canonicalHash === second.value.canonicalHash || first.value.requestHash === second.value.requestHash) return err(researchError("invalid_deliberation_manifest"));
  const version = nextVersion(room.value, input.expectedVersion);
  const timestamp = at(clock);
  if (!version.ok) return version;
  if (!timestamp.ok) return timestamp;
  return move(room.value, "awaiting_manifest_confirmation", version.value, timestamp.value, "kernel", "two_context_manifests_ready_for_user_confirmation", { frozenContext: frozenContext.value, manifests: cloneFrozen(manifests) }, [
    { from: "draft", to: "context_prepared", actor: "kernel", at: timestamp.value, reason: "two_exact_contexts_prepared" },
  ]);
}

export function startBlindDeliberationRound(
  roomInput: DeliberationRoom,
  input: { readonly expectedVersion: EntityVersion; readonly actor: ResearchActor; readonly confirmedManifestHashes: readonly [string, string] },
  ports: { readonly clock: Clock; readonly idFactory: IdFactory },
): ResearchResult<DeliberationRoom> {
  const room = parseDeliberationRoom(roomInput);
  if (!room.ok) return room;
  if (user(input.actor) === undefined) return err(researchError("user_deliberation_action_required"));
  if (room.value.status !== "awaiting_manifest_confirmation") return err(researchError("invalid_deliberation_transition"));
  const manifests = room.value.manifests;
  if (input.confirmedManifestHashes[0] !== manifests?.[0].canonicalHash) return err(researchError("invalid_deliberation_transition"));
  if (input.confirmedManifestHashes[1] !== manifests[1].canonicalHash) return err(researchError("invalid_deliberation_transition"));
  const version = nextVersion(room.value, input.expectedVersion);
  const timestamp = at(ports.clock);
  const attemptA = parseResearchIdFor(ports.idFactory.create("rdat_"), "rdat_");
  const attemptB = parseResearchIdFor(ports.idFactory.create("rdat_"), "rdat_");
  if (!version.ok) return version;
  if (!timestamp.ok || !attemptA.ok || !attemptB.ok) return err(researchError("invalid_deliberation_room"));
  const attempts: readonly [DeliberationParticipantAttempt, DeliberationParticipantAttempt] = cloneFrozen([
    { id: attemptA.value.id, participantId: room.value.participants[0].id, requestHash: manifests[0].requestHash, status: "running", sealed: true, startedAt: timestamp.value },
    { id: attemptB.value.id, participantId: room.value.participants[1].id, requestHash: manifests[1].requestHash, status: "running", sealed: true, startedAt: timestamp.value },
  ]);
  const initialRound: DeliberationInitialRound = cloneFrozen({
    id: manifests[0].roundId,
    requestsFrozenBeforeDispatch: true,
    requestsFrozenAt: timestamp.value,
    dispatchPolicy: "parallel_no_retry",
    revealPolicy: "both_valid_terminal_or_explicit_partial_cancel",
    blindness: {
      status: "protocol_enforced",
      participantAExcludedParticipantB: true,
      participantBExcludedParticipantA: true,
      rawResponsesExcluded: true,
      privateSessionsExcluded: true,
      cognitiveIndependence: "unproven",
    },
    manifests,
    attempts,
  });
  return move(room.value, "blind_round_running", version.value, timestamp.value, "user", "both_frozen_requests_confirmed_before_parallel_dispatch", { initialRound });
}

function terminal(attempt: DeliberationParticipantAttempt): boolean {
  return ["completed", "failed", "cancelled", "unknown"].includes(attempt.status);
}

function initialTerminalStatus(attempts: readonly [DeliberationParticipantAttempt, DeliberationParticipantAttempt]): DeliberationRoomStatus {
  if (!attempts.every(terminal)) return "blind_round_running";
  if (attempts.some((attempt) => attempt.status === "completed" && attempt.assessment !== undefined)) return "reveal_ready";
  return attempts.some((attempt) => attempt.status === "cancelled") ? "cancelled" : "failed";
}

function attemptIndex(room: DeliberationRoom, roundId: string, participantId: string, attemptId: string): 0 | 1 | undefined {
  const round = room.initialRound;
  if (round?.id !== roundId) return undefined;
  for (const index of [0, 1] as const) {
    const attempt = round.attempts[index];
    if (attempt.participantId === participantId && attempt.id === attemptId && room.participants[index].id === participantId) return index;
  }
  return undefined;
}

export function completeDeliberationParticipant(
  roomInput: DeliberationRoom,
  input: { readonly expectedVersion: EntityVersion; readonly roundId: string; readonly participantId: string; readonly attemptId: string; readonly assessment: DeliberationParticipantAssessment },
  clock: Clock,
): ResearchResult<DeliberationRoom> {
  const room = parseDeliberationRoom(roomInput);
  if (!room.ok) return room;
  if (room.value.status !== "blind_round_running" || room.value.initialRound === undefined) return err(researchError("invalid_deliberation_attempt"));
  const index = attemptIndex(room.value, input.roundId, input.participantId, input.attemptId);
  if (index === undefined || room.value.initialRound.attempts[index].status !== "running") return err(researchError("invalid_deliberation_attempt"));
  const assessment = parseDeliberationParticipantAssessment(input.assessment);
  const manifest = room.value.initialRound.manifests[index];
  if (!assessment.ok || assessment.value.roomId !== room.value.id || assessment.value.roundId !== room.value.initialRound.id || assessment.value.participantId !== room.value.participants[index].id || assessment.value.participantSlot !== room.value.participants[index].slot || assessment.value.requestHash !== manifest.requestHash || assessment.value.hashes.responseSchemaHash !== manifest.responseSchema.hash || assessment.value.hashes.rubricHash !== manifest.rubric.hash || assessment.value.evidenceSpans.some((span) => span.projectId !== room.value.projectId)) return err(researchError("invalid_deliberation_result"));
  const version = nextVersion(room.value, input.expectedVersion);
  const timestamp = at(clock);
  if (!version.ok) return version;
  if (!timestamp.ok) return timestamp;
  const attempts = [...room.value.initialRound.attempts] as [DeliberationParticipantAttempt, DeliberationParticipantAttempt];
  attempts[index] = cloneFrozen({ ...attempts[index], status: "completed" as const, sealed: true, completedAt: timestamp.value, assessment: assessment.value });
  const status = initialTerminalStatus(attempts);
  return move(room.value, status, version.value, timestamp.value, "kernel", status === "reveal_ready" ? "both_participant_attempts_terminal" : "participant_output_sealed_while_peer_is_running", { initialRound: cloneFrozen({ ...room.value.initialRound, attempts }) });
}

export function failDeliberationParticipant(
  roomInput: DeliberationRoom,
  input: { readonly expectedVersion: EntityVersion; readonly roundId: string; readonly participantId: string; readonly attemptId: string; readonly failure: DeliberationParticipantFailure },
  clock: Clock,
): ResearchResult<DeliberationRoom> {
  const room = parseDeliberationRoom(roomInput);
  if (!room.ok) return room;
  if (room.value.status !== "blind_round_running" || room.value.initialRound === undefined || !DELIBERATION_PARTICIPANT_FAILURES.includes(input.failure)) return err(researchError("invalid_deliberation_attempt"));
  const index = attemptIndex(room.value, input.roundId, input.participantId, input.attemptId);
  if (index === undefined || room.value.initialRound.attempts[index].status !== "running") return err(researchError("invalid_deliberation_attempt"));
  const version = nextVersion(room.value, input.expectedVersion);
  const timestamp = at(clock);
  if (!version.ok) return version;
  if (!timestamp.ok) return timestamp;
  const attempts = [...room.value.initialRound.attempts] as [DeliberationParticipantAttempt, DeliberationParticipantAttempt];
  attempts[index] = cloneFrozen({ ...attempts[index], status: input.failure === "result_write_uncertain" ? "unknown" as const : "failed" as const, failure: input.failure, failedAt: timestamp.value, sealed: true });
  const status = initialTerminalStatus(attempts);
  return move(room.value, status, version.value, timestamp.value, "kernel", input.failure, { initialRound: cloneFrozen({ ...room.value.initialRound, attempts }) });
}

export function cancelDeliberationParticipant(
  roomInput: DeliberationRoom,
  input: { readonly expectedVersion: EntityVersion; readonly actor: ResearchActor; readonly roundId: string; readonly participantId: string; readonly attemptId: string },
  clock: Clock,
): ResearchResult<DeliberationRoom> {
  const room = parseDeliberationRoom(roomInput);
  if (!room.ok) return room;
  if (user(input.actor) === undefined) return err(researchError("user_deliberation_action_required"));
  if (room.value.status !== "blind_round_running" || room.value.initialRound === undefined) return err(researchError("invalid_deliberation_attempt"));
  const index = attemptIndex(room.value, input.roundId, input.participantId, input.attemptId);
  if (index === undefined || room.value.initialRound.attempts[index].status !== "running") return err(researchError("invalid_deliberation_attempt"));
  const version = nextVersion(room.value, input.expectedVersion);
  const timestamp = at(clock);
  if (!version.ok) return version;
  if (!timestamp.ok) return timestamp;
  const attempts = [...room.value.initialRound.attempts] as [DeliberationParticipantAttempt, DeliberationParticipantAttempt];
  attempts[index] = cloneFrozen({ ...attempts[index], status: "cancelled" as const, failure: "cancelled_by_user" as const, cancelledAt: timestamp.value, sealed: true });
  const status = initialTerminalStatus(attempts);
  return move(room.value, status, version.value, timestamp.value, "user", "participant_attempt_cancelled_without_retry", { initialRound: cloneFrozen({ ...room.value.initialRound, attempts }) });
}

function normalizedSet(values: readonly string[]): Set<string> {
  return new Set(values.map((item) => item.trim().toLocaleLowerCase("en-US")));
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  const a = normalizedSet(left);
  const b = normalizedSet(right);
  return a.size === b.size && [...a].every((item) => b.has(item));
}

function category(kind: DeliberationDifferenceCategory, status: DeliberationDifferenceItem["status"], statements: readonly string[], sourceReferences: readonly string[]): DeliberationDifferenceItem {
  return cloneFrozen({ kind, status, statements, sourceReferences: [...new Set(sourceReferences)] });
}

export function deriveDeliberationDifferenceSummary(left: DeliberationParticipantAssessment, right: DeliberationParticipantAssessment): DeliberationDifferenceSummary {
  const leftEvidence = left.evidenceSpans.map((item) => item.quoteHash);
  const rightEvidence = right.evidenceSpans.map((item) => item.quoteHash);
  const assessmentsSame = left.assessment === right.assessment;
  const dimensionPairs = left.dimensions.map((item, index) => {
    const peer = right.dimensions[index];
    if (peer === undefined) throw new Error("Validated deliberation dimensions lost positional parity.");
    return { left: item, right: peer };
  });
  const changedDimensions = dimensionPairs.filter((item) => item.left.position !== item.right.position).map((item) => item.left.dimensionId);
  const commonDimensions = dimensionPairs.filter((item) => item.left.position === item.right.position).map((item) => item.left.dimensionId);
  const directConflict = [left.assessment, right.assessment].includes("support") && [left.assessment, right.assessment].includes("oppose") || dimensionPairs.some((item) => [item.left.position, item.right.position].includes("support") && [item.left.position, item.right.position].includes("challenge"));
  const qualifiedDifference = (!assessmentsSame || changedDimensions.length > 0) && !directConflict;
  const factSelectionDifference = !sameStringSet(leftEvidence, rightEvidence);
  const evidenceWeightDifference = !factSelectionDifference && (left.dimensions.find((item) => item.dimensionId === "evidence_weight")?.position !== right.dimensions.find((item) => item.dimensionId === "evidence_weight")?.position);
  const assumptionDifference = !sameStringSet(left.assumptions, right.assumptions);
  const scopeDifference = left.scope.trim().toLocaleLowerCase("en-US") !== right.scope.trim().toLocaleLowerCase("en-US");
  const uniqueIncrement = factSelectionDifference
    || !sameStringSet(left.counterexamples, right.counterexamples)
    || !sameStringSet(left.alternativeExplanations, right.alternativeExplanations)
    || !sameStringSet(left.nextDiscriminatingEvidence, right.nextDiscriminatingEvidence)
    || !sameStringSet(left.unknowns, right.unknowns);
  const redundant = assessmentsSame && changedDimensions.length === 0 && !factSelectionDifference && !assumptionDifference && !scopeDifference && !uniqueIncrement;
  const unresolved = directConflict || qualifiedDifference || factSelectionDifference || evidenceWeightDifference || assumptionDifference || scopeDifference;
  const common = commonDimensions.length > 0 || assessmentsSame;
  const refs = [left.participantId, right.participantId, left.roundId, ...left.evidenceSpans.map((item) => item.revisionId), ...right.evidenceSpans.map((item) => item.revisionId)];
  const categories: readonly DeliberationDifferenceItem[] = cloneFrozen([
    category("common_ground", common ? "present" : "absent", common ? [`Shared normalized positions: ${commonDimensions.join(", ") || "overall assessment"}.`] : [], refs),
    category("direct_conflict", directConflict ? "present" : "absent", directConflict ? ["At least one normalized position is directly support-versus-challenge, without selecting a winner."] : [], refs),
    category("qualified_difference", qualifiedDifference ? "present" : "absent", qualifiedDifference ? [`Normalized positions differ on: ${changedDimensions.join(", ") || "overall assessment"}.`] : [], refs),
    category("fact_selection_difference", factSelectionDifference ? "present" : "absent", factSelectionDifference ? ["The participants bind their answers to different evidence selections."] : [], refs),
    category("evidence_weight_difference", evidenceWeightDifference ? "present" : "absent", evidenceWeightDifference ? ["The same selected evidence receives different inferential weight."] : [], refs),
    category("assumption_difference", assumptionDifference ? "present" : "absent", assumptionDifference ? ["The assessments rely on different disclosed assumptions."] : [], refs),
    category("scope_difference", scopeDifference ? "present" : "absent", scopeDifference ? ["The participants answer at different declared scopes."] : [], refs),
    category("candidate_unique_increment", uniqueIncrement ? "present" : "absent", uniqueIncrement ? ["At least one candidate adds traceable evidence selection, a counterexample, an alternative explanation, an unknown, or next discriminating evidence absent from the other; real-case value remains unproven."] : [], refs),
    category("redundant_restatement", redundant ? "present" : "absent", redundant ? ["Normalized positions and bounded increment-bearing fields are the same; wording differences alone are not treated as value."] : [], refs),
    category("unresolved", unresolved ? "present" : "absent", unresolved ? ["Differences remain for user review; the Kernel does not synthesize or select a winner."] : [], refs),
    category("unproven", "present", ["Mutual cognitive independence and repeatable non-redundant value in real cases remain unproven."], refs),
  ]);
  const withoutHash = { schemaVersion: "1.0.0" as const, categories, authority: "system_derived" as const, canResolveRoom: false as const, winner: null, ranking: null, score: null };
  return cloneFrozen({ ...withoutHash, canonicalHash: hashOf(withoutHash) ?? "0".repeat(64) });
}

function partialDifferenceSummary(room: DeliberationRoom): DeliberationDifferenceSummary {
  const refs = [room.id, ...(room.initialRound?.attempts.map((item) => item.participantId) ?? [])];
  const categories = DELIBERATION_DIFFERENCE_CATEGORIES.map((kind) => category(
    kind,
    kind === "unresolved" || kind === "unproven" ? "present" : kind === "candidate_unique_increment" && room.initialRound?.attempts.some((item) => item.assessment !== undefined) ? "unproven" : "absent",
    kind === "unresolved" ? ["A participant did not produce a valid comparable terminal result."] : kind === "unproven" ? ["Partial or cancelled reveal cannot prove agreement, difference, independence, or value."] : [],
    refs,
  ));
  const withoutHash = { schemaVersion: "1.0.0" as const, categories, authority: "system_derived" as const, canResolveRoom: false as const, winner: null, ranking: null, score: null };
  return cloneFrozen({ ...withoutHash, canonicalHash: hashOf(withoutHash) ?? "0".repeat(64) });
}

export function revealDeliberationRound(
  roomInput: DeliberationRoom,
  input: { readonly expectedVersion: EntityVersion; readonly actor: ResearchActor; readonly mode: "complete" | "partial" | "cancelled" },
  clock: Clock,
): ResearchResult<DeliberationRoom> {
  const room = parseDeliberationRoom(roomInput);
  if (!room.ok) return room;
  if (user(input.actor) === undefined) return err(researchError("user_deliberation_action_required"));
  if (room.value.status !== "reveal_ready" || room.value.initialRound === undefined) return err(researchError("invalid_deliberation_transition"));
  const initialCompleted = room.value.initialRound.attempts.filter((attempt) => attempt.status === "completed" && attempt.assessment !== undefined);
  const retry = room.value.retry;
  const retryCompleted = retry?.status === "completed" && retry.attempt.assessment !== undefined ? retry.attempt : undefined;
  const completed = [...initialCompleted, ...(retryCompleted === undefined ? [] : [retryCompleted])].sort((left, right) => room.value.participants.findIndex((participant) => participant.id === left.participantId) - room.value.participants.findIndex((participant) => participant.id === right.participantId));
  if (input.mode === "complete" && (completed.length !== 2 || new Set(completed.map((attempt) => attempt.participantId)).size !== 2)) return err(researchError("invalid_deliberation_transition"));
  if (input.mode !== "complete" && (initialCompleted.length !== 1 || retryCompleted !== undefined)) return err(researchError("invalid_deliberation_transition"));
  if (input.mode === "partial" && !room.value.initialRound.attempts.some((attempt) => ["failed", "unknown"].includes(attempt.status))) return err(researchError("invalid_deliberation_transition"));
  if (input.mode === "cancelled" && !room.value.initialRound.attempts.some((attempt) => attempt.status === "cancelled")) return err(researchError("invalid_deliberation_transition"));
  const version = nextVersion(room.value, input.expectedVersion);
  const timestamp = at(clock);
  if (!version.ok) return version;
  if (!timestamp.ok) return timestamp;
  const attempts = room.value.initialRound.attempts.map((attempt) => cloneFrozen({ ...attempt, sealed: attempt.assessment === undefined ? attempt.sealed : false })) as unknown as readonly [DeliberationParticipantAttempt, DeliberationParticipantAttempt];
  let differenceSummary: DeliberationDifferenceSummary;
  if (input.mode === "complete") {
    const leftAssessment = completed[0]?.assessment;
    const rightAssessment = completed[1]?.assessment;
    if (leftAssessment === undefined || rightAssessment === undefined) return err(researchError("invalid_deliberation_transition"));
    differenceSummary = deriveDeliberationDifferenceSummary(leftAssessment, rightAssessment);
  } else {
    differenceSummary = partialDifferenceSummary(room.value);
  }
  const status: DeliberationRoomStatus = input.mode === "complete" ? "difference_review" : input.mode === "partial" ? "partial" : "cancelled";
  return move(room.value, status, version.value, timestamp.value, "user", `${input.mode}_reveal_confirmed`, {
    initialRound: cloneFrozen({ ...room.value.initialRound, attempts, reveal: { mode: input.mode, explicitUserAction: true as const, revealedAt: timestamp.value } }),
    differenceSummary,
    ...(retryCompleted === undefined || retry === undefined ? {} : { retry: cloneFrozen({ ...retry, attempt: { ...retryCompleted, sealed: false } }) }),
  });
}

export function prepareDeliberationParticipantRetry(
  roomInput: DeliberationRoom,
  input: { readonly expectedVersion: EntityVersion; readonly actor: ResearchActor; readonly retryId: string; readonly attemptId: string; readonly manifest: DeliberationContextManifest },
  clock: Clock,
): ResearchResult<DeliberationRoom> {
  const room = parseDeliberationRoom(roomInput);
  if (!room.ok) return room;
  if (user(input.actor) === undefined) return err(researchError("user_deliberation_action_required"));
  if (room.value.status !== "partial" || room.value.retry !== undefined || room.value.challenge !== undefined || room.value.initialRound === undefined || room.value.frozenContext === undefined) return err(researchError("invalid_deliberation_transition"));
  const failedIndex = room.value.initialRound.attempts.findIndex((attempt) => ["failed", "cancelled", "unknown"].includes(attempt.status));
  const completedCount = room.value.initialRound.attempts.filter((attempt) => attempt.status === "completed" && attempt.assessment !== undefined).length;
  if ((failedIndex !== 0 && failedIndex !== 1) || completedCount !== 1) return err(researchError("invalid_deliberation_transition"));
  const retryId = parseResearchIdFor(input.retryId, "rrnd_");
  const attemptId = parseResearchIdFor(input.attemptId, "rdat_");
  const manifest = parseDeliberationContextManifest(input.manifest);
  const version = nextVersion(room.value, input.expectedVersion);
  const timestamp = at(clock);
  if (!retryId.ok || !attemptId.ok || !manifest.ok || !version.ok || !timestamp.ok) return err(researchError("invalid_deliberation_manifest"));
  const participant = room.value.participants[failedIndex];
  if (manifest.value.roomId !== room.value.id || manifest.value.roundId !== retryId.value.id || manifest.value.participantId !== participant.id || manifest.value.participantSlot !== participant.slot || manifest.value.stateBindingHash !== room.value.frozenContext.stateBindingHash) return err(researchError("invalid_deliberation_manifest"));
  const attempt: DeliberationParticipantAttempt = cloneFrozen({ id: attemptId.value.id, participantId: participant.id, requestHash: manifest.value.requestHash, status: "prepared", sealed: true, preparedAt: timestamp.value });
  const retry: DeliberationParticipantRetry = cloneFrozen({ id: retryId.value.id, participantId: participant.id, priorAttemptId: room.value.initialRound.attempts[failedIndex].id, status: "prepared", manifest: manifest.value, attempt, userConfirmed: false, preparedAt: timestamp.value });
  return move(room.value, "retry_prepared", version.value, timestamp.value, "user", "failed_participant_retry_manifest_prepared", { retry });
}

export function startDeliberationParticipantRetry(
  roomInput: DeliberationRoom,
  input: { readonly expectedVersion: EntityVersion; readonly actor: ResearchActor; readonly retryId: string; readonly confirmedManifestHash: string },
  clock: Clock,
): ResearchResult<DeliberationRoom> {
  const room = parseDeliberationRoom(roomInput);
  if (!room.ok) return room;
  if (user(input.actor) === undefined) return err(researchError("user_deliberation_action_required"));
  if (room.value.status !== "retry_prepared") return err(researchError("invalid_deliberation_transition"));
  const retry = room.value.retry;
  if (retry === undefined) return err(researchError("invalid_deliberation_transition"));
  if (retry.id !== input.retryId || retry.status !== "prepared" || retry.manifest.canonicalHash !== input.confirmedManifestHash) return err(researchError("invalid_deliberation_transition"));
  const version = nextVersion(room.value, input.expectedVersion);
  const timestamp = at(clock);
  if (!version.ok) return version;
  if (!timestamp.ok) return timestamp;
  const attempt = cloneFrozen({ ...retry.attempt, status: "running" as const, startedAt: timestamp.value });
  return move(room.value, "retry_running", version.value, timestamp.value, "user", "failed_participant_retry_confirmed", { retry: cloneFrozen({ ...retry, status: "running" as const, userConfirmed: true, startedAt: timestamp.value, attempt }) });
}

export function completeDeliberationParticipantRetry(
  roomInput: DeliberationRoom,
  input: { readonly expectedVersion: EntityVersion; readonly retryId: string; readonly participantId: string; readonly attemptId: string; readonly assessment: DeliberationParticipantAssessment },
  clock: Clock,
): ResearchResult<DeliberationRoom> {
  const room = parseDeliberationRoom(roomInput);
  if (!room.ok) return room;
  if (room.value.status !== "retry_running") return err(researchError("invalid_deliberation_attempt"));
  const retry = room.value.retry;
  if (retry === undefined) return err(researchError("invalid_deliberation_attempt"));
  if (retry.id !== input.retryId || retry.status !== "running" || retry.participantId !== input.participantId || retry.attempt.id !== input.attemptId || retry.attempt.status !== "running") return err(researchError("invalid_deliberation_attempt"));
  const assessment = parseDeliberationParticipantAssessment(input.assessment);
  if (!assessment.ok || assessment.value.roomId !== room.value.id || assessment.value.roundId !== retry.id || assessment.value.participantId !== retry.participantId || assessment.value.requestHash !== retry.manifest.requestHash || assessment.value.hashes.responseSchemaHash !== retry.manifest.responseSchema.hash || assessment.value.hashes.rubricHash !== retry.manifest.rubric.hash || assessment.value.evidenceSpans.some((span) => span.projectId !== room.value.projectId)) return err(researchError("invalid_deliberation_result"));
  const version = nextVersion(room.value, input.expectedVersion);
  const timestamp = at(clock);
  if (!version.ok) return version;
  if (!timestamp.ok) return timestamp;
  const attempt = cloneFrozen({ ...retry.attempt, status: "completed" as const, completedAt: timestamp.value, assessment: assessment.value, sealed: true });
  return move(room.value, "reveal_ready", version.value, timestamp.value, "kernel", "retry_result_terminal_and_sealed", { retry: cloneFrozen({ ...retry, status: "completed" as const, completedAt: timestamp.value, attempt }) });
}

export function failDeliberationParticipantRetry(
  roomInput: DeliberationRoom,
  input: { readonly expectedVersion: EntityVersion; readonly retryId: string; readonly participantId: string; readonly attemptId: string; readonly failure: DeliberationParticipantFailure },
  clock: Clock,
): ResearchResult<DeliberationRoom> {
  const room = parseDeliberationRoom(roomInput);
  if (!room.ok) return room;
  if (room.value.status !== "retry_running") return err(researchError("invalid_deliberation_attempt"));
  const retry = room.value.retry;
  if (retry === undefined) return err(researchError("invalid_deliberation_attempt"));
  if (retry.id !== input.retryId || retry.status !== "running" || retry.participantId !== input.participantId || retry.attempt.id !== input.attemptId || retry.attempt.status !== "running" || !DELIBERATION_PARTICIPANT_FAILURES.includes(input.failure)) return err(researchError("invalid_deliberation_attempt"));
  const version = nextVersion(room.value, input.expectedVersion);
  const timestamp = at(clock);
  if (!version.ok) return version;
  if (!timestamp.ok) return timestamp;
  const status = input.failure === "cancelled_by_user" ? "cancelled" as const : input.failure === "result_write_uncertain" ? "unknown" as const : "failed" as const;
  const attempt = cloneFrozen({ ...retry.attempt, status, failure: input.failure, ...(status === "cancelled" ? { cancelledAt: timestamp.value } : { failedAt: timestamp.value }), sealed: true });
  return move(room.value, "partial", version.value, timestamp.value, "kernel", `retry_${status}`, { retry: cloneFrozen({ ...retry, status, completedAt: timestamp.value, attempt }) });
}

export function prepareDeliberationChallenge(
  roomInput: DeliberationRoom,
  input: { readonly expectedVersion: EntityVersion; readonly actor: ResearchActor; readonly question: string; readonly challengeId: string; readonly attemptIds: readonly [string, string]; readonly manifests: readonly [DeliberationContextManifest, DeliberationContextManifest]; readonly sharedContextHash: string },
  ports: { readonly clock: Clock },
): ResearchResult<DeliberationRoom> {
  const room = parseDeliberationRoom(roomInput);
  if (!room.ok) return room;
  if (user(input.actor) === undefined) return err(researchError("user_deliberation_action_required"));
  if (room.value.challenge !== undefined || room.value.retry !== undefined) return err(researchError("deliberation_round_limit_reached"));
  if (room.value.status !== "difference_review") return err(researchError("invalid_deliberation_transition"));
  const question = text(input.question, 8_192);
  const version = nextVersion(room.value, input.expectedVersion);
  const timestamp = at(ports.clock);
  const challengeId = parseResearchIdFor(input.challengeId, "rdch_");
  const attemptIds = [parseResearchIdFor(input.attemptIds[0], "rdat_"), parseResearchIdFor(input.attemptIds[1], "rdat_")] as const;
  if (question === undefined || !version.ok) return !version.ok ? version : err(researchError("invalid_deliberation_transition"));
  if (!timestamp.ok || !challengeId.ok || !attemptIds[0].ok || !attemptIds[1].ok || attemptIds[0].value.id === attemptIds[1].value.id || !sha(input.sharedContextHash)) return err(researchError("invalid_deliberation_room"));
  const manifests = [parseDeliberationContextManifest(input.manifests[0]), parseDeliberationContextManifest(input.manifests[1])] as const;
  for (const index of [0, 1] as const) {
    const manifest = manifests[index];
    if (!manifest.ok || manifest.value.roomId !== room.value.id || manifest.value.roundId !== challengeId.value.id || manifest.value.participantId !== room.value.participants[index].id || manifest.value.participantSlot !== room.value.participants[index].slot || manifest.value.stateBindingHash !== room.value.frozenContext?.stateBindingHash) return err(researchError("invalid_deliberation_manifest"));
  }
  if (!manifests[0].ok || !manifests[1].ok) return err(researchError("invalid_deliberation_manifest"));
  const attempts: readonly [DeliberationParticipantAttempt, DeliberationParticipantAttempt] = cloneFrozen([
    { id: attemptIds[0].value.id, participantId: room.value.participants[0].id, requestHash: manifests[0].value.requestHash, status: "prepared", sealed: true, preparedAt: timestamp.value },
    { id: attemptIds[1].value.id, participantId: room.value.participants[1].id, requestHash: manifests[1].value.requestHash, status: "prepared", sealed: true, preparedAt: timestamp.value },
  ]);
  const challenge: DeliberationChallenge = cloneFrozen({ id: challengeId.value.id, question, status: "prepared", userConfirmed: false, manifests: [manifests[0].value, manifests[1].value], attempts, sharedContextHash: input.sharedContextHash, preparedAt: timestamp.value });
  return move(room.value, "challenge_prepared", version.value, timestamp.value, "user", "single_directed_challenge_prepared", { challenge });
}

export function startDeliberationChallenge(
  roomInput: DeliberationRoom,
  input: { readonly expectedVersion: EntityVersion; readonly actor: ResearchActor; readonly challengeId: string; readonly confirmedManifestHashes: readonly [string, string] },
  clock: Clock,
): ResearchResult<DeliberationRoom> {
  const room = parseDeliberationRoom(roomInput);
  if (!room.ok) return room;
  if (user(input.actor) === undefined) return err(researchError("user_deliberation_action_required"));
  if (room.value.status !== "challenge_prepared" || room.value.challenge?.id !== input.challengeId || room.value.challenge.status !== "prepared" || room.value.challenge.manifests[0].canonicalHash !== input.confirmedManifestHashes[0] || room.value.challenge.manifests[1].canonicalHash !== input.confirmedManifestHashes[1]) return err(researchError("invalid_deliberation_transition"));
  const version = nextVersion(room.value, input.expectedVersion);
  const timestamp = at(clock);
  if (!version.ok) return version;
  if (!timestamp.ok) return timestamp;
  const attempts = room.value.challenge.attempts.map((attempt) => cloneFrozen({ ...attempt, status: "running" as const, startedAt: timestamp.value })) as unknown as readonly [DeliberationParticipantAttempt, DeliberationParticipantAttempt];
  return move(room.value, "challenge_running", version.value, timestamp.value, "user", "single_directed_challenge_confirmed", { challenge: cloneFrozen({ ...room.value.challenge, status: "running" as const, userConfirmed: true, startedAt: timestamp.value, attempts }) });
}

export function completeDeliberationChallenge(
  roomInput: DeliberationRoom,
  input: { readonly expectedVersion: EntityVersion; readonly challengeId: string; readonly participantId: string; readonly attemptId: string; readonly assessment: DeliberationParticipantAssessment },
  clock: Clock,
): ResearchResult<DeliberationRoom> {
  const room = parseDeliberationRoom(roomInput);
  if (!room.ok) return room;
  const challenge = room.value.challenge;
  if (room.value.status !== "challenge_running" || challenge?.id !== input.challengeId || challenge.status !== "running") return err(researchError("invalid_deliberation_attempt"));
  const index = challenge.attempts.findIndex((attempt) => attempt.id === input.attemptId && attempt.participantId === input.participantId);
  if (index !== 0 && index !== 1 || challenge.attempts[index].status !== "running") return err(researchError("invalid_deliberation_attempt"));
  const assessment = parseDeliberationParticipantAssessment(input.assessment);
  const participant = room.value.participants[index];
  if (!assessment.ok || assessment.value.roomId !== room.value.id || assessment.value.roundId !== challenge.id || assessment.value.participantId !== participant.id || assessment.value.participantSlot !== participant.slot || assessment.value.requestHash !== challenge.manifests[index].requestHash || assessment.value.evidenceSpans.some((span) => span.projectId !== room.value.projectId)) return err(researchError("invalid_deliberation_result"));
  const version = nextVersion(room.value, input.expectedVersion);
  const timestamp = at(clock);
  if (!version.ok) return version;
  if (!timestamp.ok) return timestamp;
  const attempts = [...challenge.attempts] as [DeliberationParticipantAttempt, DeliberationParticipantAttempt];
  attempts[index] = cloneFrozen({ ...attempts[index], status: "completed" as const, completedAt: timestamp.value, assessment: assessment.value, sealed: true });
  const allTerminal = attempts.every(terminal);
  return move(room.value, allTerminal ? "waiting_user_resolution" : "challenge_running", version.value, timestamp.value, "kernel", allTerminal ? "both_directed_challenge_results_terminal" : "directed_challenge_result_sealed_while_peer_running", { challenge: cloneFrozen({ ...challenge, status: allTerminal ? "completed" as const : "running" as const, ...(allTerminal ? { completedAt: timestamp.value } : {}), attempts }) });
}

export function failDeliberationChallenge(
  roomInput: DeliberationRoom,
  input: { readonly expectedVersion: EntityVersion; readonly challengeId: string; readonly participantId: string; readonly attemptId: string; readonly failure: DeliberationParticipantFailure },
  clock: Clock,
): ResearchResult<DeliberationRoom> {
  const room = parseDeliberationRoom(roomInput);
  if (!room.ok) return room;
  const challenge = room.value.challenge;
  if (room.value.status !== "challenge_running" || challenge?.id !== input.challengeId || challenge.status !== "running" || !DELIBERATION_PARTICIPANT_FAILURES.includes(input.failure)) return err(researchError("invalid_deliberation_attempt"));
  const index = challenge.attempts.findIndex((attempt) => attempt.id === input.attemptId && attempt.participantId === input.participantId);
  if (index !== 0 && index !== 1 || challenge.attempts[index].status !== "running") return err(researchError("invalid_deliberation_attempt"));
  const version = nextVersion(room.value, input.expectedVersion);
  const timestamp = at(clock);
  if (!version.ok) return version;
  if (!timestamp.ok) return timestamp;
  const attempts = [...challenge.attempts] as [DeliberationParticipantAttempt, DeliberationParticipantAttempt];
  attempts[index] = cloneFrozen({ ...attempts[index], status: input.failure === "cancelled_by_user" ? "cancelled" as const : input.failure === "result_write_uncertain" ? "unknown" as const : "failed" as const, failure: input.failure, ...(input.failure === "cancelled_by_user" ? { cancelledAt: timestamp.value } : { failedAt: timestamp.value }), sealed: true });
  const allTerminal = attempts.every(terminal);
  const allCancelled = attempts.every((attempt) => attempt.status === "cancelled");
  const aggregateStatus = allTerminal ? allCancelled ? "cancelled" as const : attempts.every((attempt) => attempt.status === "completed") ? "completed" as const : "failed" as const : "running" as const;
  return move(room.value, allTerminal ? "waiting_user_resolution" : "challenge_running", version.value, timestamp.value, "kernel", input.failure, { challenge: cloneFrozen({ ...challenge, status: aggregateStatus, ...(allTerminal ? { completedAt: timestamp.value } : {}), attempts }) });
}

export function recoverInterruptedDeliberationRoom(
  roomInput: DeliberationRoom,
  clock: Clock,
): ResearchResult<DeliberationRoom> {
  const room = parseDeliberationRoom(roomInput);
  if (!room.ok) return room;
  if (room.value.status !== "blind_round_running" && room.value.status !== "challenge_running" && room.value.status !== "retry_running") return room;
  const version = advanceEntityVersion(room.value.version, room.value.version);
  const timestamp = at(clock);
  if (!version.ok) return version;
  if (!timestamp.ok) return timestamp;
  if (room.value.status === "retry_running") {
    const retry = room.value.retry;
    if (retry?.status !== "running") return err(researchError("invalid_deliberation_room"));
    const attempt = cloneFrozen({ ...retry.attempt, status: "unknown" as const, failedAt: timestamp.value, failure: "result_write_uncertain" as const, sealed: true });
    return move(room.value, "partial", version.value, timestamp.value, "kernel", "interrupted_retry_result_write_uncertain", {
      retry: cloneFrozen({ ...retry, status: "unknown" as const, completedAt: timestamp.value, attempt }),
    });
  }
  if (room.value.status === "challenge_running") {
    const challenge = room.value.challenge;
    if (challenge?.status !== "running") return err(researchError("invalid_deliberation_room"));
    const attempts = challenge.attempts.map((attempt) => attempt.status === "running"
      ? cloneFrozen({ ...attempt, status: "unknown" as const, failedAt: timestamp.value, failure: "result_write_uncertain" as const, sealed: true })
      : attempt) as unknown as readonly [DeliberationParticipantAttempt, DeliberationParticipantAttempt];
    return move(room.value, "waiting_user_resolution", version.value, timestamp.value, "kernel", "interrupted_challenge_result_write_uncertain", {
      challenge: cloneFrozen({ ...challenge, status: "failed" as const, completedAt: timestamp.value, attempts }),
    });
  }
  if (room.value.initialRound === undefined) return err(researchError("invalid_deliberation_room"));
  const attempts = room.value.initialRound.attempts.map((attempt) => attempt.status === "running"
    ? cloneFrozen({ ...attempt, status: "unknown" as const, failedAt: timestamp.value, failure: "result_write_uncertain" as const, sealed: true })
    : attempt) as unknown as readonly [DeliberationParticipantAttempt, DeliberationParticipantAttempt];
  return move(room.value, initialTerminalStatus(attempts), version.value, timestamp.value, "kernel", "interrupted_blind_round_results_marked_uncertain", {
    initialRound: cloneFrozen({ ...room.value.initialRound, attempts }),
  });
}

export function waitForDeliberationResolution(
  roomInput: DeliberationRoom,
  input: { readonly expectedVersion: EntityVersion; readonly actor: ResearchActor },
  clock: Clock,
): ResearchResult<DeliberationRoom> {
  const room = parseDeliberationRoom(roomInput);
  if (!room.ok) return room;
  if (user(input.actor) === undefined) return err(researchError("user_deliberation_action_required"));
  if (!["difference_review", "partial", "failed", "cancelled"].includes(room.value.status)) return err(researchError("invalid_deliberation_transition"));
  const version = nextVersion(room.value, input.expectedVersion);
  const timestamp = at(clock);
  if (!version.ok) return version;
  if (!timestamp.ok) return timestamp;
  return move(room.value, "waiting_user_resolution", version.value, timestamp.value, "user", "user_finished_difference_review");
}

export function importManualExternalOpinion(
  roomInput: DeliberationRoom,
  input: {
    readonly expectedVersion: EntityVersion;
    readonly actor: ResearchActor;
    readonly sourceLabel: string;
    readonly providerClaim: string;
    readonly modelClaim: string;
    readonly capturedAt: string;
    readonly contextDisclosure: string;
    readonly sawParticipantAOutput: boolean;
    readonly sawParticipantBOutput: boolean;
    readonly publicContent: string;
  },
  ports: { readonly clock: Clock; readonly idFactory: IdFactory },
): ResearchResult<DeliberationRoom> {
  const room = parseDeliberationRoom(roomInput);
  if (!room.ok) return room;
  const actor = user(input.actor);
  if (actor === undefined) return err(researchError("user_deliberation_action_required"));
  if (["resolved", "closed"].includes(room.value.status)) return err(researchError("invalid_deliberation_transition"));
  const sourceLabel = text(input.sourceLabel, 512);
  const providerClaim = text(input.providerClaim, 512);
  const modelClaim = text(input.modelClaim, 512);
  const capturedAt = text(input.capturedAt, 64);
  const contextDisclosure = text(input.contextDisclosure, 8_192);
  const publicContent = text(input.publicContent, 32_768);
  const version = nextVersion(room.value, input.expectedVersion);
  const timestamp = at(ports.clock);
  const id = parseResearchIdFor(ports.idFactory.create("rman_"), "rman_");
  if (sourceLabel === undefined || providerClaim === undefined || modelClaim === undefined || capturedAt === undefined || !Number.isFinite(Date.parse(capturedAt)) || contextDisclosure === undefined || typeof input.sawParticipantAOutput !== "boolean" || typeof input.sawParticipantBOutput !== "boolean" || publicContent === undefined || !version.ok || !timestamp.ok || !id.ok) return err(researchError("invalid_manual_external_opinion"));
  const exposure = { sawParticipantAOutput: input.sawParticipantAOutput, sawParticipantBOutput: input.sawParticipantBOutput };
  const contentHash = hashOf({ sourceLabel, providerClaim, modelClaim, capturedAt, contextDisclosure, exposure, blindnessVerification: "not_verifiable", publicContent });
  if (contentHash === undefined) return err(researchError("invalid_manual_external_opinion"));
  const opinion: ManualExternalOpinion = cloneFrozen({ id: id.value.id, sourceLabel, providerClaim, modelClaim, capturedAt, contextDisclosure, exposure, blindnessVerification: "not_verifiable", publicContent, classification: "manual_non_blind", verification: "unverified_external_import", authority: "external_claim_only", canActAsParticipant: false, canResolveRoom: false, importedBy: actor, importedAt: timestamp.value, contentHash });
  return move(room.value, room.value.status, version.value, timestamp.value, "user", "manual_non_blind_external_opinion_imported", { manualExternalOpinions: [...room.value.manualExternalOpinions, opinion] });
}

export function markDeliberationRoomStale(
  roomInput: DeliberationRoom,
  input: { readonly expectedVersion: EntityVersion; readonly reason: string },
  clock: Clock,
): ResearchResult<DeliberationRoom> {
  const room = parseDeliberationRoom(roomInput);
  const reason = text(input.reason, 512);
  if (!room.ok) return room;
  if (reason === undefined || ["resolved", "closed"].includes(room.value.status)) return err(researchError("invalid_deliberation_transition"));
  const version = nextVersion(room.value, input.expectedVersion);
  const timestamp = at(clock);
  if (!version.ok) return version;
  if (!timestamp.ok) return timestamp;
  return move(room.value, "stale_conflicted", version.value, timestamp.value, "kernel", reason);
}

export function resolveDeliberationRoom(
  roomInput: DeliberationRoom,
  input: { readonly expectedVersion: EntityVersion; readonly actor: ResearchActor; readonly kind: DeliberationResolutionKind; readonly publicReason: string; readonly combinedText?: string },
  ports: { readonly clock: Clock; readonly idFactory: IdFactory },
): ResearchResult<DeliberationRoom> {
  const room = parseDeliberationRoom(roomInput);
  const actor = user(input.actor);
  if (!room.ok) return room;
  if (actor === undefined) return err(researchError("user_deliberation_action_required"));
  if (!["waiting_user_resolution", "difference_review", "partial", "failed", "cancelled", "stale_conflicted", "resolved", "closed"].includes(room.value.status) || !DELIBERATION_RESOLUTION_KINDS.includes(input.kind)) return err(researchError("invalid_deliberation_transition"));
  const publicReason = text(input.publicReason, 16_384);
  const combinedText = input.combinedText === undefined ? undefined : text(input.combinedText, 32_768);
  if (publicReason === undefined || input.combinedText !== undefined && combinedText === undefined || input.kind === "combine_edit" && combinedText === undefined) return err(researchError("invalid_deliberation_transition"));
  const version = nextVersion(room.value, input.expectedVersion);
  const timestamp = at(ports.clock);
  const resolutionId = parseResearchIdFor(ports.idFactory.create("rdrr_"), "rdrr_");
  const receiptId = parseResearchIdFor(ports.idFactory.create("rdrc_"), "rdrc_");
  const sourceRoomHash = hashOf(room.value);
  if (!version.ok) return version;
  if (!timestamp.ok || !resolutionId.ok || !receiptId.ok || sourceRoomHash === undefined) return err(researchError("invalid_deliberation_room"));
  const nextStatus = input.kind === "close_without_change" ? "closed" as const : "resolved" as const;
  const receiptWithoutHash = {
    schemaVersion: "1.0.0" as const,
    id: receiptId.value.id,
    roomId: room.value.id,
    projectId: room.value.projectId,
    resolutionId: resolutionId.value.id,
    sourceRoomHash,
    ...(room.value.differenceSummary === undefined ? {} : { differenceSummaryHash: room.value.differenceSummary.canonicalHash }),
    before: { status: room.value.status, version: room.value.version },
    after: { status: nextStatus, version: version.value },
    command: { kind: input.kind, publicReason, ...(combinedText === undefined ? {} : { combinedText }) },
    roomScopeOnly: true as const,
    canonicalMutationAuthorized: false as const,
    separateAuthorityRequired: true as const,
    unproven: ["mutual_cognitive_independence", "repeatable_non_redundant_value_in_real_cases", "external_user_value"],
    authority: { actor, confirmedAt: timestamp.value },
  };
  const receiptHash = hashOf(receiptWithoutHash);
  if (receiptHash === undefined) return err(researchError("invalid_deliberation_room"));
  const receipt: DeliberationResolutionReceipt = cloneFrozen({ ...receiptWithoutHash, receiptHash });
  const prior = room.value.resolutions.at(-1);
  const resolution: DeliberationResolution = cloneFrozen({ id: resolutionId.value.id, kind: input.kind, publicReason, ...(combinedText === undefined ? {} : { combinedText }), ...(prior === undefined ? {} : { supersedesResolutionId: prior.id }), authority: receipt.authority, receipt });
  return move(room.value, nextStatus, version.value, timestamp.value, "user", input.kind, { resolutions: [...room.value.resolutions, resolution] });
}
