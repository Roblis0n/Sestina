import type { ResearchActor } from "../authority/actor.js";
import { validateResearchActor } from "../authority/actor.js";
import type { Clock } from "../clock.js";
import { cloneFrozen, isNonBlankString, isRecord, readClock } from "../domain-validation.js";
import { researchError, type ResearchErrorCode } from "../errors.js";
import { canonicalStringify, stableResearchHash } from "../identity/canonical-json.js";
import { advanceEntityVersion, initialEntityVersion, parseEntityVersion, type EntityVersion } from "../identity/entity-version.js";
import { parseResearchId, parseResearchIdFor } from "../identity/research-id.js";
import type { IdFactory } from "../index.js";
import { err, ok, type ResearchResult } from "../result.js";

export const CLOSED_EXTERNAL_APP_PILOT_STATUSES = [
  "draft",
  "preflight_ready",
  "context_confirmation_required",
  "context_confirmed",
  "launching",
  "running",
  "candidate_received",
  "candidate_confirmation_required",
  "review_required",
  "user_disposition_required",
  "continuity_check_ready",
  "continuity_check_running",
  "continuity_verified",
  "closed",
  "stale",
  "expired",
  "cancelled",
  "failed",
  "blocked_host_unavailable",
  "interrupted_unknown",
] as const;
export type ClosedExternalAppPilotStatus = (typeof CLOSED_EXTERNAL_APP_PILOT_STATUSES)[number];

export const CLOSED_PILOT_FAILURE_CODES = [
  "host_unavailable",
  "host_process_failed",
  "host_timeout",
  "host_protocol_mismatch",
  "mcp_not_observed",
  "mcp_call_failed",
  "context_binding_mismatch",
  "output_too_large",
  "candidate_schema_mismatch",
  "manifest_stale",
  "confirmation_expired",
  "cancelled_by_user",
  "invocation_interrupted_after_restart",
  "persistence_failed",
] as const;
export type ClosedPilotFailureCode = (typeof CLOSED_PILOT_FAILURE_CODES)[number];

export type ClosedPilotEvidenceClass = "synthetic_fixture" | "owner_operated_closed_host_observation";
export type ClosedPilotAttemptKind = "candidate_generation" | "continuity_check";
export type ClosedPilotAttemptStatus = "prepared" | "confirmed" | "launching" | "running" | "completed" | "failed" | "cancelled" | "unknown";
export type ClosedPilotCapabilityState = "observed" | "unavailable" | "unproven";

export interface ClosedPilotHostCapabilities {
  readonly start: ClosedPilotCapabilityState;
  readonly structuredOutput: ClosedPilotCapabilityState;
  readonly mcp: ClosedPilotCapabilityState;
  readonly readOnlySandbox: ClosedPilotCapabilityState;
  readonly cancellation: ClosedPilotCapabilityState;
  readonly contextIsolation: ClosedPilotCapabilityState;
}

export interface ClosedPilotPreflight {
  readonly availability: "available" | "unavailable";
  readonly supportedVersion: string | null;
  readonly verifiedAt?: string;
  readonly capabilities: ClosedPilotHostCapabilities;
  readonly configurationSeparateFromVerification: true;
}

export interface ClosedPilotBriefBinding {
  readonly id: string;
  readonly versionId: string;
  readonly version: number;
}

export interface ClosedPilotEpisodeBinding {
  readonly id: string;
  readonly version: number;
}

export interface ClosedPilotContextDecision {
  readonly id: string;
  readonly version: number;
  readonly status: string;
  readonly statement: string;
}

export interface ClosedPilotContextIssue {
  readonly id: string;
  readonly version: number;
  readonly status: string;
  readonly summary: string;
  readonly resolutionRecorded: boolean;
  readonly reopenCondition?: string;
}

export interface ClosedPilotContextEvidence {
  readonly id: string;
  readonly version: number;
  readonly summary: string;
  readonly source: string;
  readonly sensitivity: "public" | "project_private";
}

export interface ClosedPilotContextMemory {
  readonly id: string;
  readonly version: number;
  readonly kind: string;
  readonly content: string;
  readonly source: string;
  readonly sensitivity: "public" | "project_private";
  readonly outboundPolicy: "explicit_manifest_only";
}

export interface ClosedPilotManifestExclusion {
  readonly category: "working_memory" | "research_object" | "provider_secret" | "host_state" | "raw_conversation" | "hidden_reasoning" | "path" | "other";
  readonly id?: string;
  readonly reason: string;
  readonly source: string;
  readonly sensitivity: "public" | "project_private" | "secret_never_send";
}

export interface ClosedPilotFrozenContextPayload {
  readonly schemaVersion: "1.0.0";
  readonly contentBoundary: {
    readonly kind: "untrusted_research_data";
    readonly authority: "none";
    readonly mayDirectTools: false;
    readonly grantsPermissions: false;
    readonly representsUserAcceptance: false;
    readonly representsAdjudication: false;
    readonly representsTaskCompletion: false;
  };
  readonly manifestBinding: {
    readonly pilotId: string;
    readonly attemptId: string;
    readonly manifestId: string;
    readonly projectId: string;
    readonly host: "codex";
    readonly purpose: ClosedPilotAttemptKind;
  };
  readonly projectStateHash: string;
  readonly brief: ClosedPilotBriefBinding & { readonly projectQuestion: string };
  readonly episode: ClosedPilotEpisodeBinding & { readonly status: string };
  readonly currentTask: string;
  readonly decisions: readonly ClosedPilotContextDecision[];
  readonly issues: readonly ClosedPilotContextIssue[];
  readonly evidence: readonly ClosedPilotContextEvidence[];
  readonly workingMemory: readonly ClosedPilotContextMemory[];
}

export interface ClosedPilotManifestIncludedItem {
  readonly category: "brief" | "episode" | "task" | "decision" | "issue" | "evidence" | "working_memory";
  readonly id: string;
  readonly version: number;
  readonly source: string;
  readonly sensitivity: "public" | "project_private";
  readonly contentHash: string;
  readonly contentBytes: number;
}

export interface PilotContextManifest {
  readonly schemaVersion: "1.0.0";
  readonly id: string;
  readonly version: 1;
  readonly pilotId: string;
  readonly projectId: string;
  readonly attemptId: string;
  readonly host: "codex";
  readonly purpose: ClosedPilotAttemptKind;
  readonly included: readonly ClosedPilotManifestIncludedItem[];
  readonly excluded: readonly ClosedPilotManifestExclusion[];
  readonly workingMemorySelection: {
    readonly defaultSelectedCount: 0;
    readonly selectedIds: readonly string[];
    readonly neverSendIncludedCount: 0;
  };
  readonly disclosure: {
    readonly externalModelServiceMayBeCalled: boolean;
    readonly hostCan: readonly string[];
    readonly hostCannot: readonly string[];
    readonly timeoutMs: number;
    readonly outputLimitBytes: number;
    readonly invocationLimit: 1;
    readonly automaticRetries: 0;
    readonly sandbox: "read_only";
    readonly projectWrite: false;
  };
  readonly payload: ClosedPilotFrozenContextPayload;
  readonly payloadUtf8: string;
  readonly payloadBytes: number;
  readonly payloadHash: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface ClosedPilotMcpObservation {
  readonly health: "completed";
  readonly getResearchContext: "completed";
  readonly payloadHash: string;
}

export interface ClosedPilotAttempt {
  readonly id: string;
  readonly kind: ClosedPilotAttemptKind;
  readonly ordinal: 1 | 2;
  readonly status: ClosedPilotAttemptStatus;
  readonly manifestId: string;
  readonly manifestHash: string;
  readonly confirmationNonce: string;
  readonly confirmationExpiresAt: string;
  readonly confirmedAt?: string;
  readonly confirmationConsumedAt?: string;
  readonly invocationId?: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly cancelledAt?: string;
  readonly failedAt?: string;
  readonly failureCode?: ClosedPilotFailureCode;
  readonly mcpObservation?: ClosedPilotMcpObservation;
  readonly stdoutBytes?: number;
  readonly stderrBytes?: number;
  readonly usage?: { readonly inputTokens: number; readonly outputTokens: number } | "unavailable";
}

export interface ClosedPilotCandidateInput {
  readonly candidateMarkdown: string;
  readonly materialDelta: string;
  readonly preservedDecisionIds: readonly string[];
  readonly affectedIssueIds: readonly string[];
  readonly evidenceUsed: readonly string[];
  readonly unknowns: readonly string[];
  readonly reopenResolvedIssue: boolean;
  readonly authority: "model_proposed";
  readonly canMutateAuthority: false;
}

export interface ClosedPilotCandidate extends ClosedPilotCandidateInput {
  readonly id: string;
  readonly status: "received" | "imported" | "rejected" | "stale";
  readonly attemptId: string;
  readonly invocationId: string;
  readonly manifestId: string;
  readonly manifestHash: string;
  readonly candidateHash: string;
  readonly receivedAt: string;
  readonly importedAt?: string;
  readonly rejectedAt?: string;
}

export interface ClosedPilotReviewBinding {
  readonly reviewId: string;
  readonly importedRevisionId: string;
  readonly reviewMode: "ledger_only" | "provider_assisted";
  readonly boundAt: string;
}

export interface ClosedPilotDispositionBinding {
  readonly reviewId: string;
  readonly receiptId: string;
  readonly traceId: string;
  readonly disposition: "accept" | "reject" | "modify" | "defer" | "waive" | "rollback" | "other";
  readonly decidedBy: "user";
  readonly decidedAt: string;
}

export interface ClosedPilotContinuityObservation {
  readonly authority: "host_observation";
  readonly canMutateAuthority: false;
  readonly projectId: string;
  readonly briefId: string;
  readonly briefVersion: number;
  readonly episodeId: string;
  readonly episodeStatus: string;
  readonly decisionStates: readonly { readonly id: string; readonly status: string }[];
  readonly issueStates: readonly { readonly id: string; readonly status: string; readonly treatAsOpenAudit: boolean; readonly reopenProposed: boolean }[];
  readonly canonicalStateHash: string;
  readonly mcpObservation: ClosedPilotMcpObservation;
}

export interface ClosedPilotContinuityBinding extends ClosedPilotContinuityObservation {
  readonly attemptId: string;
  readonly invocationId: string;
  readonly manifestHash: string;
  readonly verifiedAt: string;
}

export type ClosedPilotFeedbackCode = "useful" | "not_useful" | "too_much_setup" | "context_incorrect" | "context_disclosure_unclear" | "candidate_redundant" | "candidate_unsafe_or_misleading" | "stopped_before_completion";

export interface ClosedPilotFeedback {
  readonly codes: readonly ClosedPilotFeedbackCode[];
  readonly note?: string;
  readonly recordedAt: string;
}

export interface ClosedPilotFailure {
  readonly code: ClosedPilotFailureCode;
  readonly publicReason: string;
  readonly at: string;
}

export interface ClosedPilotEvent {
  readonly id: string;
  readonly index: number;
  readonly from: ClosedExternalAppPilotStatus | null;
  readonly to: ClosedExternalAppPilotStatus;
  readonly reason: string;
  readonly actor: "user" | "kernel" | "host";
  readonly at: string;
}

export interface ClosedExternalAppPilot {
  readonly schemaVersion: "1.0.0";
  readonly id: string;
  readonly projectId: string;
  readonly host: "codex";
  readonly authority: "external_host_proposal_only";
  readonly canMutateAuthority: false;
  readonly brief: ClosedPilotBriefBinding;
  readonly episode: ClosedPilotEpisodeBinding;
  readonly currentTask: string;
  readonly evidenceClass: ClosedPilotEvidenceClass;
  readonly status: ClosedExternalAppPilotStatus;
  readonly version: EntityVersion;
  readonly invocationBudget: {
    readonly candidateMaximum: 2;
    readonly continuityMaximum: 2;
    readonly candidateAttemptsUsed: number;
    readonly continuityAttemptsUsed: number;
    readonly automaticRetries: 0;
  };
  readonly preflight?: ClosedPilotPreflight;
  readonly manifests: readonly PilotContextManifest[];
  readonly attempts: readonly ClosedPilotAttempt[];
  readonly candidate?: ClosedPilotCandidate;
  readonly review?: ClosedPilotReviewBinding;
  readonly disposition?: ClosedPilotDispositionBinding;
  readonly continuity?: ClosedPilotContinuityBinding;
  readonly feedback?: ClosedPilotFeedback;
  readonly failure?: ClosedPilotFailure;
  readonly events: readonly ClosedPilotEvent[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt?: string;
  readonly cancelledAt?: string;
  readonly failedAt?: string;
  readonly closedAt?: string;
}

export interface PrepareClosedPilotContextInput {
  readonly expectedVersion: EntityVersion;
  readonly kind: ClosedPilotAttemptKind;
  readonly projectStateHash: string;
  readonly brief: ClosedPilotBriefBinding & { readonly projectQuestion: string };
  readonly episode: ClosedPilotEpisodeBinding & { readonly status: string };
  readonly currentTask: string;
  readonly decisions: readonly ClosedPilotContextDecision[];
  readonly issues: readonly ClosedPilotContextIssue[];
  readonly evidence: readonly ClosedPilotContextEvidence[];
  readonly workingMemory: readonly ClosedPilotContextMemory[];
  readonly excluded: readonly ClosedPilotManifestExclusion[];
  readonly disclosure: {
    readonly externalModelServiceMayBeCalled: boolean;
    readonly hostCan: readonly string[];
    readonly hostCannot: readonly string[];
    readonly timeoutMs: number;
    readonly outputLimitBytes: number;
  };
  readonly confirmationExpiresAt: string;
  readonly actor: ResearchActor;
}

interface Ports {
  readonly clock: Clock;
  readonly idFactory: IdFactory;
}

const MAX_TEXT_BYTES = 65_536;
const MAX_CONTEXT_BYTES = 65_536;
const MAX_ITEMS = 128;
const CAPABILITY_KEYS: readonly (keyof ClosedPilotHostCapabilities)[] = ["start", "structuredOutput", "mcp", "readOnlySandbox", "cancellation", "contextIsolation"];

function fail<T>(code: ResearchErrorCode): ResearchResult<T> {
  return err(researchError(code));
}

function sha(value: unknown): ResearchResult<string> {
  return stableResearchHash(value);
}

function now(clock: Clock): ResearchResult<string> {
  return readClock(clock);
}

function bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function text(value: unknown, max = MAX_TEXT_BYTES): value is string {
  return isNonBlankString(value) && bytes(value) <= max && !value.includes("\0");
}

function shaString(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

function user(actor: ResearchActor): boolean {
  const parsed = validateResearchActor(actor);
  return parsed.ok && parsed.value.kind === "user";
}

function validExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).toSorted().join("\0") === [...keys].toSorted().join("\0");
}

function nextVersion(pilot: ClosedExternalAppPilot, expected: EntityVersion): ResearchResult<EntityVersion> {
  const parsed = parseEntityVersion(expected);
  if (!parsed.ok || parsed.value !== pilot.version) return fail("version_conflict");
  return advanceEntityVersion(pilot.version, parsed.value);
}

function eventId(ports: Ports): ResearchResult<string> {
  const parsed = parseResearchIdFor(ports.idFactory.create("rpev_"), "rpev_");
  return parsed.ok ? ok(parsed.value.id) : fail("invalid_closed_external_app_pilot");
}

function move(
  pilot: ClosedExternalAppPilot,
  expectedVersion: EntityVersion,
  to: ClosedExternalAppPilotStatus,
  reason: string,
  actor: ClosedPilotEvent["actor"],
  ports: Ports,
  patch: Partial<ClosedExternalAppPilot> = {},
): ResearchResult<ClosedExternalAppPilot> {
  const version = nextVersion(pilot, expectedVersion);
  const timestamp = now(ports.clock);
  const id = eventId(ports);
  if (!version.ok) return version;
  if (!timestamp.ok || !id.ok || !text(reason, 512)) return fail("invalid_closed_external_app_pilot");
  const event: ClosedPilotEvent = cloneFrozen({ id: id.value, index: pilot.events.length, from: pilot.status, to, reason, actor, at: timestamp.value });
  const merged: Record<string, unknown> = { ...pilot, ...patch, status: to, version: version.value, updatedAt: timestamp.value, events: [...pilot.events, event] };
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined) Reflect.deleteProperty(merged, key);
  }
  return parseClosedExternalAppPilot(cloneFrozen(merged));
}

function current(input: ClosedExternalAppPilot): ResearchResult<ClosedExternalAppPilot> {
  return parseClosedExternalAppPilot(input);
}

function validCapabilities(input: unknown): input is ClosedPilotHostCapabilities {
  if (!isRecord(input) || !validExactKeys(input, CAPABILITY_KEYS)) return false;
  return CAPABILITY_KEYS.every((key) => ["observed", "unavailable", "unproven"].includes(String(input[key])));
}

function validBrief(value: unknown): value is ClosedPilotBriefBinding {
  return isRecord(value) && parseResearchIdFor(value.id, "rbrf_").ok && parseResearchIdFor(value.versionId, "rbrf_").ok && Number.isSafeInteger(value.version) && Number(value.version) >= 1;
}

function validEpisode(value: unknown): value is ClosedPilotEpisodeBinding {
  return isRecord(value) && parseResearchIdFor(value.id, "repi_").ok && Number.isSafeInteger(value.version) && Number(value.version) >= 1;
}

function validMcpObservation(value: unknown): value is ClosedPilotMcpObservation {
  return isRecord(value) && validExactKeys(value, ["health", "getResearchContext", "payloadHash"]) && value.health === "completed" && value.getResearchContext === "completed" && shaString(value.payloadHash);
}

function pathLike(value: string): boolean {
  return /(?:[A-Za-z]:[\\/]|\/(?:Users|home|var|tmp)\/)/u.test(value);
}

function validStringArray(value: unknown, maxItems = 64, maxBytes = 8_192): value is readonly string[] {
  return Array.isArray(value) && value.length <= maxItems && value.every((item) => text(item, maxBytes));
}

function includedItem(category: ClosedPilotManifestIncludedItem["category"], id: string, version: number, source: string, sensitivity: "public" | "project_private", value: unknown): ResearchResult<ClosedPilotManifestIncludedItem> {
  const canonical = canonicalStringify(value);
  const digest = sha(value);
  if (!canonical.ok || !digest.ok) return fail("invalid_pilot_context_manifest");
  return ok(cloneFrozen({ category, id, version, source, sensitivity, contentHash: digest.value, contentBytes: bytes(canonical.value) }));
}

function attemptIndex(pilot: ClosedExternalAppPilot, attemptId: string): number {
  return pilot.attempts.findIndex((attempt) => attempt.id === attemptId);
}

function manifestForAttempt(pilot: ClosedExternalAppPilot, attempt: ClosedPilotAttempt): PilotContextManifest | undefined {
  return pilot.manifests.find((manifest) => manifest.id === attempt.manifestId && manifest.attemptId === attempt.id);
}

function replaceAttempt(pilot: ClosedExternalAppPilot, index: number, attempt: ClosedPilotAttempt): readonly ClosedPilotAttempt[] {
  const attempts = [...pilot.attempts];
  attempts[index] = cloneFrozen(attempt);
  return cloneFrozen(attempts);
}

function candidateAllowedIds(manifest: PilotContextManifest): { decisions: Set<string>; issues: Set<string>; evidence: Set<string> } {
  return {
    decisions: new Set(manifest.payload.decisions.map((item) => item.id)),
    issues: new Set(manifest.payload.issues.map((item) => item.id)),
    evidence: new Set(manifest.payload.evidence.map((item) => item.id)),
  };
}

function validCandidate(input: unknown, manifest: PilotContextManifest): input is ClosedPilotCandidateInput {
  if (!isRecord(input) || !validExactKeys(input, ["candidateMarkdown", "materialDelta", "preservedDecisionIds", "affectedIssueIds", "evidenceUsed", "unknowns", "reopenResolvedIssue", "authority", "canMutateAuthority"])) return false;
  if (!text(input.candidateMarkdown, 65_536) || !text(input.materialDelta, 16_384) || pathLike(input.candidateMarkdown) || pathLike(input.materialDelta)) return false;
  if (input.authority !== "model_proposed" || input.canMutateAuthority || typeof input.reopenResolvedIssue !== "boolean") return false;
  if (!validStringArray(input.preservedDecisionIds, 64, 256) || !validStringArray(input.affectedIssueIds, 64, 256) || !validStringArray(input.evidenceUsed, 64, 256) || !validStringArray(input.unknowns, 64, 8_192)) return false;
  if ([...input.preservedDecisionIds, ...input.affectedIssueIds, ...input.evidenceUsed].some((id) => !parseResearchId(id).ok)) return false;
  const allowed = candidateAllowedIds(manifest);
  return input.preservedDecisionIds.every((id) => allowed.decisions.has(id)) && input.affectedIssueIds.every((id) => allowed.issues.has(id)) && input.evidenceUsed.every((id) => allowed.evidence.has(id));
}

export function createClosedExternalAppPilot(input: {
  readonly projectId: string;
  readonly brief: ClosedPilotBriefBinding;
  readonly episode: ClosedPilotEpisodeBinding;
  readonly currentTask: string;
  readonly actor: ResearchActor;
  readonly evidenceClass: ClosedPilotEvidenceClass;
}, ports: Ports): ResearchResult<ClosedExternalAppPilot> {
  if (!user(input.actor) || !parseResearchIdFor(input.projectId, "rprj_").ok || !validBrief(input.brief) || !validEpisode(input.episode) || !text(input.currentTask, 16_384) || !["synthetic_fixture", "owner_operated_closed_host_observation"].includes(input.evidenceClass)) return fail("user_pilot_action_required");
  const timestamp = now(ports.clock);
  const id = parseResearchIdFor(ports.idFactory.create("rpil_"), "rpil_");
  const event = eventId(ports);
  if (!timestamp.ok || !id.ok || !event.ok) return fail("invalid_closed_external_app_pilot");
  return parseClosedExternalAppPilot(cloneFrozen({
    schemaVersion: "1.0.0",
    id: id.value.id,
    projectId: input.projectId,
    host: "codex",
    authority: "external_host_proposal_only",
    canMutateAuthority: false,
    brief: input.brief,
    episode: input.episode,
    currentTask: input.currentTask,
    evidenceClass: input.evidenceClass,
    status: "draft",
    version: initialEntityVersion(),
    invocationBudget: { candidateMaximum: 2, continuityMaximum: 2, candidateAttemptsUsed: 0, continuityAttemptsUsed: 0, automaticRetries: 0 },
    manifests: [],
    attempts: [],
    events: [{ id: event.value, index: 0, from: null, to: "draft", reason: "user_created_closed_codex_pilot", actor: "user", at: timestamp.value }],
    createdAt: timestamp.value,
    updatedAt: timestamp.value,
  }));
}

export function recordClosedPilotPreflight(pilotInput: ClosedExternalAppPilot, input: {
  readonly expectedVersion: EntityVersion;
  readonly availability: "available" | "unavailable";
  readonly supportedVersion: string | null;
  readonly verifiedAt?: string;
  readonly capabilities: ClosedPilotHostCapabilities;
}, ports: Ports): ResearchResult<ClosedExternalAppPilot> {
  const pilot = current(pilotInput);
  if (!pilot.ok) return pilot;
  if (!["draft", "blocked_host_unavailable"].includes(pilot.value.status) || !validCapabilities(input.capabilities) || (input.supportedVersion !== null && !text(input.supportedVersion, 128)) || (input.availability === "available" && input.supportedVersion === null)) return fail("invalid_closed_pilot_transition");
  const preflight: ClosedPilotPreflight = cloneFrozen({ availability: input.availability, supportedVersion: input.supportedVersion, ...(input.verifiedAt === undefined ? {} : { verifiedAt: input.verifiedAt }), capabilities: input.capabilities, configurationSeparateFromVerification: true });
  if (input.availability === "unavailable") {
    const at = now(ports.clock);
    if (!at.ok) return fail("invalid_closed_external_app_pilot");
    return move(pilot.value, input.expectedVersion, "blocked_host_unavailable", "codex_host_unavailable", "kernel", ports, { preflight, failure: { code: "host_unavailable", publicReason: "The verified Codex Host is unavailable; no context was sent.", at: at.value } });
  }
  return move(pilot.value, input.expectedVersion, "preflight_ready", "codex_host_preflight_ready", "kernel", ports, { preflight, failure: undefined });
}

function validateContextInput(pilot: ClosedExternalAppPilot, input: PrepareClosedPilotContextInput, timestamp: string): boolean {
  if (!user(input.actor) || !shaString(input.projectStateHash) || !validBrief(input.brief) || !text(input.brief.projectQuestion, 16_384) || !validEpisode(input.episode) || !text(input.episode.status, 128) || !text(input.currentTask, 16_384)) return false;
  if (new Date(input.confirmationExpiresAt).getTime() <= new Date(timestamp).getTime() || new Date(input.confirmationExpiresAt).getTime() - new Date(timestamp).getTime() > 30 * 60_000) return false;
  if (!Number.isSafeInteger(input.disclosure.timeoutMs) || input.disclosure.timeoutMs < 1_000 || input.disclosure.timeoutMs > 300_000 || !Number.isSafeInteger(input.disclosure.outputLimitBytes) || input.disclosure.outputLimitBytes < 1_024 || input.disclosure.outputLimitBytes > 65_536 || !validStringArray(input.disclosure.hostCan, 16, 256) || !validStringArray(input.disclosure.hostCannot, 16, 256)) return false;
  if ([input.decisions, input.issues, input.evidence, input.workingMemory, input.excluded].some((items) => !Array.isArray(items) || items.length > MAX_ITEMS)) return false;
  if (input.kind === "candidate_generation" && (input.brief.id !== pilot.brief.id || input.brief.versionId !== pilot.brief.versionId || input.brief.version !== pilot.brief.version || input.episode.id !== pilot.episode.id || input.episode.version !== pilot.episode.version || input.currentTask !== pilot.currentTask)) return false;
  if (input.kind === "continuity_check" && (input.brief.id !== pilot.brief.id || input.episode.id !== pilot.episode.id || input.brief.version < pilot.brief.version || input.episode.version < pilot.episode.version)) return false;
  if (input.decisions.some((item) => !parseResearchIdFor(item.id, "rdec_").ok || !Number.isSafeInteger(item.version) || item.version < 1 || !text(item.status, 128) || !text(item.statement, 16_384))) return false;
  if (input.issues.some((item) => !parseResearchIdFor(item.id, "riss_").ok || !Number.isSafeInteger(item.version) || item.version < 1 || !text(item.status, 128) || !text(item.summary, 16_384) || typeof item.resolutionRecorded !== "boolean" || (item.reopenCondition !== undefined && !text(item.reopenCondition, 8_192)))) return false;
  if (input.evidence.some((item) => !parseResearchId(item.id).ok || !Number.isSafeInteger(item.version) || item.version < 1 || !text(item.summary, 16_384) || !text(item.source, 512) || !["public", "project_private"].includes(item.sensitivity))) return false;
  if (input.workingMemory.some((item) => !parseResearchIdFor(item.id, "rmem_").ok || !Number.isSafeInteger(item.version) || item.version < 1 || !text(item.kind, 128) || !text(item.content, 16_384) || !text(item.source, 512) || !["public", "project_private"].includes(item.sensitivity))) return false;
  return input.excluded.every((item) => isRecord(item) && text(item.category, 128) && text(item.reason, 512) && text(item.source, 512) && ["public", "project_private", "secret_never_send"].includes(item.sensitivity) && (item.id === undefined || text(item.id, 256)));
}

export function prepareClosedPilotContext(pilotInput: ClosedExternalAppPilot, input: PrepareClosedPilotContextInput, ports: Ports): ResearchResult<ClosedExternalAppPilot> {
  const pilot = current(pilotInput);
  if (!pilot.ok) return pilot;
  const allowed = input.kind === "candidate_generation"
    ? ["preflight_ready", "failed", "cancelled", "expired", "stale", "interrupted_unknown"]
    : ["continuity_check_ready", "failed", "cancelled", "expired", "stale", "interrupted_unknown"];
  if (!allowed.includes(pilot.value.status) || pilot.value.status === "closed") return fail("invalid_closed_pilot_transition");
  const timestamp = now(ports.clock);
  if (!timestamp.ok || !validateContextInput(pilot.value, input, timestamp.value)) return fail("invalid_pilot_context_manifest");
  const prior = pilot.value.attempts.filter((attempt) => attempt.kind === input.kind).length;
  if (prior >= 2) return fail("pilot_attempt_budget_exhausted");
  const attemptId = parseResearchIdFor(ports.idFactory.create("rpat_"), "rpat_");
  const manifestId = parseResearchIdFor(ports.idFactory.create("rman_"), "rman_");
  const nonce = parseResearchIdFor(ports.idFactory.create("rpno_"), "rpno_");
  if (!attemptId.ok || !manifestId.ok || !nonce.ok) return fail("invalid_closed_external_app_pilot");
  const payload: ClosedPilotFrozenContextPayload = cloneFrozen({
    schemaVersion: "1.0.0",
    contentBoundary: { kind: "untrusted_research_data", authority: "none", mayDirectTools: false, grantsPermissions: false, representsUserAcceptance: false, representsAdjudication: false, representsTaskCompletion: false },
    manifestBinding: { pilotId: pilot.value.id, attemptId: attemptId.value.id, manifestId: manifestId.value.id, projectId: pilot.value.projectId, host: "codex", purpose: input.kind },
    projectStateHash: input.projectStateHash,
    brief: input.brief,
    episode: input.episode,
    currentTask: input.currentTask,
    decisions: input.decisions,
    issues: input.issues,
    evidence: input.evidence,
    workingMemory: input.workingMemory,
  });
  const canonical = canonicalStringify(payload);
  const digest = sha(payload);
  if (!canonical.ok || !digest.ok || bytes(canonical.value) > MAX_CONTEXT_BYTES) return fail("pilot_context_too_large");
  const included: ClosedPilotManifestIncludedItem[] = [];
  const candidates: readonly (readonly [ClosedPilotManifestIncludedItem["category"], string, number, string, "public" | "project_private", unknown])[] = [
    ["brief", input.brief.id, input.brief.version, "kernel_brief_projection", "project_private", input.brief],
    ["episode", input.episode.id, input.episode.version, "kernel_episode_projection", "project_private", input.episode],
    ["task", pilot.value.id, pilot.value.version, "pilot_current_task", "project_private", input.currentTask],
    ...input.decisions.map((item) => ["decision", item.id, item.version, "kernel_decision_projection", "project_private", item] as const),
    ...input.issues.map((item) => ["issue", item.id, item.version, "kernel_issue_projection", "project_private", item] as const),
    ...input.evidence.map((item) => ["evidence", item.id, item.version, item.source, item.sensitivity, item] as const),
    ...input.workingMemory.map((item) => ["working_memory", item.id, item.version, item.source, item.sensitivity, item] as const),
  ];
  for (const item of candidates) {
    const projected = includedItem(...item);
    if (!projected.ok) return projected;
    included.push(projected.value);
  }
  const manifest: PilotContextManifest = cloneFrozen({
    schemaVersion: "1.0.0",
    id: manifestId.value.id,
    version: 1,
    pilotId: pilot.value.id,
    projectId: pilot.value.projectId,
    attemptId: attemptId.value.id,
    host: "codex",
    purpose: input.kind,
    included,
    excluded: input.excluded,
    workingMemorySelection: { defaultSelectedCount: 0, selectedIds: input.workingMemory.map((item) => item.id), neverSendIncludedCount: 0 },
    disclosure: { ...input.disclosure, invocationLimit: 1, automaticRetries: 0, sandbox: "read_only", projectWrite: false },
    payload,
    payloadUtf8: canonical.value,
    payloadBytes: bytes(canonical.value),
    payloadHash: digest.value,
    createdAt: timestamp.value,
    expiresAt: input.confirmationExpiresAt,
  });
  const attempt: ClosedPilotAttempt = cloneFrozen({ id: attemptId.value.id, kind: input.kind, ordinal: (prior + 1) as 1 | 2, status: "prepared", manifestId: manifest.id, manifestHash: manifest.payloadHash, confirmationNonce: nonce.value.id, confirmationExpiresAt: manifest.expiresAt });
  return move(pilot.value, input.expectedVersion, "context_confirmation_required", `${input.kind}_context_prepared_for_explicit_confirmation`, "user", ports, { manifests: [...pilot.value.manifests, manifest], attempts: [...pilot.value.attempts, attempt], failure: undefined });
}

export function confirmClosedPilotContext(pilotInput: ClosedExternalAppPilot, input: { readonly expectedVersion: EntityVersion; readonly attemptId: string; readonly manifestId: string; readonly manifestHash: string; readonly confirmationNonce: string; readonly actor: ResearchActor }, ports: Ports): ResearchResult<ClosedExternalAppPilot> {
  const pilot = current(pilotInput);
  if (!pilot.ok) return pilot;
  if (!user(input.actor)) return fail("user_pilot_action_required");
  const index = attemptIndex(pilot.value, input.attemptId);
  const attempt = pilot.value.attempts[index];
  if (attempt?.confirmedAt !== undefined) return fail("pilot_confirmation_replayed");
  if (pilot.value.status !== "context_confirmation_required" || attempt?.status !== "prepared") return fail("invalid_closed_pilot_transition");
  if (attempt.manifestId !== input.manifestId || attempt.manifestHash !== input.manifestHash || attempt.confirmationNonce !== input.confirmationNonce) return fail("pilot_context_mismatch");
  const timestamp = now(ports.clock);
  if (!timestamp.ok) return fail("invalid_closed_external_app_pilot");
  if (new Date(timestamp.value).getTime() >= new Date(attempt.confirmationExpiresAt).getTime()) return fail("pilot_confirmation_expired");
  return move(pilot.value, input.expectedVersion, "context_confirmed", `${attempt.kind}_context_confirmed_for_one_attempt`, "user", ports, { attempts: replaceAttempt(pilot.value, index, { ...attempt, status: "confirmed", confirmedAt: timestamp.value }) });
}

export function startClosedPilotAttempt(pilotInput: ClosedExternalAppPilot, input: { readonly expectedVersion: EntityVersion; readonly attemptId: string; readonly manifestHash: string }, ports: Ports): ResearchResult<ClosedExternalAppPilot> {
  const pilot = current(pilotInput);
  if (!pilot.ok) return pilot;
  const index = attemptIndex(pilot.value, input.attemptId);
  const attempt = pilot.value.attempts[index];
  if (pilot.value.status !== "context_confirmed" || attempt?.status !== "confirmed" || attempt.manifestHash !== input.manifestHash || attempt.confirmedAt === undefined) return fail("invalid_closed_pilot_transition");
  const timestamp = now(ports.clock);
  const invocationId = parseResearchIdFor(ports.idFactory.create("rpiv_"), "rpiv_");
  if (!timestamp.ok || !invocationId.ok) return fail("invalid_closed_external_app_pilot");
  const usedKey = attempt.kind === "candidate_generation" ? "candidateAttemptsUsed" : "continuityAttemptsUsed";
  const used = pilot.value.invocationBudget[usedKey];
  if (used >= 2) return fail("pilot_attempt_budget_exhausted");
  return move(pilot.value, input.expectedVersion, "launching", `${attempt.kind}_codex_process_launching`, "kernel", ports, {
    attempts: replaceAttempt(pilot.value, index, { ...attempt, status: "launching", invocationId: invocationId.value.id, startedAt: timestamp.value, confirmationConsumedAt: timestamp.value }),
    invocationBudget: { ...pilot.value.invocationBudget, [usedKey]: used + 1 },
    ...(pilot.value.startedAt === undefined ? { startedAt: timestamp.value } : {}),
  });
}

export function markClosedPilotAttemptRunning(pilotInput: ClosedExternalAppPilot, input: { readonly expectedVersion: EntityVersion; readonly attemptId: string; readonly invocationId: string }, ports: Ports): ResearchResult<ClosedExternalAppPilot> {
  const pilot = current(pilotInput);
  if (!pilot.ok) return pilot;
  const index = attemptIndex(pilot.value, input.attemptId);
  const attempt = pilot.value.attempts[index];
  if (pilot.value.status !== "launching" || attempt?.status !== "launching" || attempt.invocationId !== input.invocationId) return fail("invalid_closed_pilot_attempt");
  return move(pilot.value, input.expectedVersion, attempt.kind === "candidate_generation" ? "running" : "continuity_check_running", `${attempt.kind}_codex_process_running`, "kernel", ports, { attempts: replaceAttempt(pilot.value, index, { ...attempt, status: "running" }) });
}

export function receiveClosedPilotCandidate(pilotInput: ClosedExternalAppPilot, input: { readonly expectedVersion: EntityVersion; readonly attemptId: string; readonly invocationId: string; readonly manifestHash: string; readonly mcpObservation: ClosedPilotMcpObservation; readonly candidate: ClosedPilotCandidateInput; readonly stdoutBytes?: number; readonly stderrBytes?: number; readonly usage?: { readonly inputTokens: number; readonly outputTokens: number } | "unavailable" }, ports: Ports): ResearchResult<ClosedExternalAppPilot> {
  const pilot = current(pilotInput);
  if (!pilot.ok) return pilot;
  const index = attemptIndex(pilot.value, input.attemptId);
  const attempt = pilot.value.attempts[index];
  if (["cancelled", "closed", "interrupted_unknown", "failed"].includes(pilot.value.status) || attempt?.status === "cancelled" || attempt?.status === "unknown") return fail("pilot_late_result_rejected");
  if (pilot.value.status !== "running" || attempt?.kind !== "candidate_generation" || attempt.status !== "running" || attempt.invocationId !== input.invocationId || attempt.manifestHash !== input.manifestHash || !validMcpObservation(input.mcpObservation) || input.mcpObservation.payloadHash !== attempt.manifestHash || pilot.value.candidate !== undefined) return fail("invalid_closed_pilot_attempt");
  const manifest = manifestForAttempt(pilot.value, attempt);
  if (manifest === undefined || !validCandidate(input.candidate, manifest)) return fail("invalid_closed_pilot_candidate");
  const timestamp = now(ports.clock);
  const candidateId = parseResearchIdFor(ports.idFactory.create("rpca_"), "rpca_");
  const digest = sha(input.candidate);
  if (!timestamp.ok || !candidateId.ok || !digest.ok) return fail("invalid_closed_pilot_candidate");
  const candidate: ClosedPilotCandidate = cloneFrozen({ ...input.candidate, id: candidateId.value.id, status: "received", attemptId: attempt.id, invocationId: attempt.invocationId, manifestId: attempt.manifestId, manifestHash: attempt.manifestHash, candidateHash: digest.value, receivedAt: timestamp.value });
  const completedAttempt: ClosedPilotAttempt = cloneFrozen({ ...attempt, status: "completed", completedAt: timestamp.value, mcpObservation: input.mcpObservation, ...(input.stdoutBytes === undefined ? {} : { stdoutBytes: input.stdoutBytes }), ...(input.stderrBytes === undefined ? {} : { stderrBytes: input.stderrBytes }), usage: input.usage ?? "unavailable" });
  return move(pilot.value, input.expectedVersion, "candidate_received", "strict_model_proposed_candidate_received", "host", ports, { attempts: replaceAttempt(pilot.value, index, completedAttempt), candidate });
}

export function requireClosedPilotCandidateConfirmation(pilotInput: ClosedExternalAppPilot, input: { readonly expectedVersion: EntityVersion }, ports: Ports): ResearchResult<ClosedExternalAppPilot> {
  const pilot = current(pilotInput);
  if (!pilot.ok) return pilot;
  if (pilot.value.status !== "candidate_received" || pilot.value.candidate?.status !== "received") return fail("invalid_closed_pilot_transition");
  return move(pilot.value, input.expectedVersion, "candidate_confirmation_required", "candidate_requires_explicit_import_or_rejection", "kernel", ports);
}

export function importClosedPilotCandidate(pilotInput: ClosedExternalAppPilot, input: { readonly expectedVersion: EntityVersion; readonly actor: ResearchActor }, ports: Ports): ResearchResult<ClosedExternalAppPilot> {
  const pilot = current(pilotInput);
  if (!pilot.ok) return pilot;
  if (!user(input.actor)) return fail("user_pilot_action_required");
  if (pilot.value.status !== "candidate_confirmation_required" || pilot.value.candidate?.status !== "received") return fail("invalid_closed_pilot_transition");
  const timestamp = now(ports.clock);
  if (!timestamp.ok) return fail("invalid_closed_external_app_pilot");
  return move(pilot.value, input.expectedVersion, "review_required", "user_imported_candidate_without_accepting_it", "user", ports, { candidate: { ...pilot.value.candidate, status: "imported", importedAt: timestamp.value } });
}

export function rejectClosedPilotCandidate(pilotInput: ClosedExternalAppPilot, input: { readonly expectedVersion: EntityVersion; readonly actor: ResearchActor }, ports: Ports): ResearchResult<ClosedExternalAppPilot> {
  const pilot = current(pilotInput);
  if (!pilot.ok) return pilot;
  if (!user(input.actor)) return fail("user_pilot_action_required");
  if (pilot.value.status !== "candidate_confirmation_required" || pilot.value.candidate?.status !== "received") return fail("invalid_closed_pilot_transition");
  const timestamp = now(ports.clock);
  if (!timestamp.ok) return fail("invalid_closed_external_app_pilot");
  return move(pilot.value, input.expectedVersion, "closed", "user_rejected_candidate_and_closed_pilot", "user", ports, { candidate: { ...pilot.value.candidate, status: "rejected", rejectedAt: timestamp.value }, closedAt: timestamp.value });
}

export function bindClosedPilotReview(pilotInput: ClosedExternalAppPilot, input: { readonly expectedVersion: EntityVersion; readonly reviewId: string; readonly importedRevisionId: string; readonly reviewMode: "ledger_only" | "provider_assisted" }, ports: Ports): ResearchResult<ClosedExternalAppPilot> {
  const pilot = current(pilotInput);
  if (!pilot.ok) return pilot;
  if (pilot.value.status !== "review_required" || pilot.value.candidate?.status !== "imported" || !parseResearchIdFor(input.reviewId, "rrvw_").ok || !parseResearchIdFor(input.importedRevisionId, "rrev_").ok) return fail("invalid_closed_pilot_transition");
  const timestamp = now(ports.clock);
  if (!timestamp.ok) return fail("invalid_closed_external_app_pilot");
  return move(pilot.value, input.expectedVersion, "user_disposition_required", "existing_sestina_review_bound_to_imported_candidate", "kernel", ports, { review: { reviewId: input.reviewId, importedRevisionId: input.importedRevisionId, reviewMode: input.reviewMode, boundAt: timestamp.value } });
}

export function restoreClosedPilotReview(pilotInput: ClosedExternalAppPilot, input: { readonly expectedVersion: EntityVersion; readonly reviewId: string; readonly reviewMode: "ledger_only" | "provider_assisted"; readonly actor: ResearchActor }, ports: Ports): ResearchResult<ClosedExternalAppPilot> {
  const pilot = current(pilotInput);
  if (!pilot.ok) return pilot;
  if (!user(input.actor) || pilot.value.status !== "user_disposition_required" || pilot.value.candidate?.status !== "imported" || pilot.value.review === undefined || !parseResearchIdFor(input.reviewId, "rrvw_").ok) return fail("invalid_closed_pilot_transition");
  const timestamp = now(ports.clock);
  if (!timestamp.ok) return fail("invalid_closed_external_app_pilot");
  return move(pilot.value, input.expectedVersion, "user_disposition_required", "user_restored_existing_review_after_client_or_process_restart", "user", ports, { review: { ...pilot.value.review, reviewId: input.reviewId, reviewMode: input.reviewMode, boundAt: timestamp.value } });
}

export function bindClosedPilotDisposition(pilotInput: ClosedExternalAppPilot, input: { readonly expectedVersion: EntityVersion; readonly reviewId: string; readonly receiptId: string; readonly traceId: string; readonly disposition: ClosedPilotDispositionBinding["disposition"]; readonly actor: ResearchActor }, ports: Ports): ResearchResult<ClosedExternalAppPilot> {
  const pilot = current(pilotInput);
  if (!pilot.ok) return pilot;
  if (!user(input.actor)) return fail("user_pilot_action_required");
  if (pilot.value.status !== "user_disposition_required" || pilot.value.review?.reviewId !== input.reviewId || !parseResearchIdFor(input.reviewId, "rrvw_").ok || !parseResearchIdFor(input.receiptId, "rrcp_").ok || !parseResearchId(input.traceId).ok || !["accept", "reject", "modify", "defer", "waive", "rollback", "other"].includes(input.disposition)) return fail("invalid_closed_pilot_transition");
  const timestamp = now(ports.clock);
  if (!timestamp.ok) return fail("invalid_closed_external_app_pilot");
  return move(pilot.value, input.expectedVersion, "continuity_check_ready", "user_disposition_recorded_by_existing_authority_gate", "user", ports, { disposition: { reviewId: input.reviewId, receiptId: input.receiptId, traceId: input.traceId, disposition: input.disposition, decidedBy: "user", decidedAt: timestamp.value } });
}

export function completeClosedPilotContinuity(pilotInput: ClosedExternalAppPilot, input: { readonly expectedVersion: EntityVersion; readonly attemptId: string; readonly invocationId: string; readonly manifestHash: string; readonly observation: ClosedPilotContinuityObservation }, ports: Ports): ResearchResult<ClosedExternalAppPilot> {
  const pilot = current(pilotInput);
  if (!pilot.ok) return pilot;
  const index = attemptIndex(pilot.value, input.attemptId);
  const attempt = pilot.value.attempts[index];
  if (pilot.value.status !== "continuity_check_running" || attempt?.kind !== "continuity_check" || attempt.status !== "running" || attempt.invocationId !== input.invocationId || attempt.manifestHash !== input.manifestHash || input.observation.projectId !== pilot.value.projectId || input.observation.briefId !== pilot.value.brief.id || input.observation.episodeId !== pilot.value.episode.id || !shaString(input.observation.canonicalStateHash) || !validMcpObservation(input.observation.mcpObservation) || input.observation.mcpObservation.payloadHash !== attempt.manifestHash) return fail("invalid_closed_pilot_continuity");
  const manifest = manifestForAttempt(pilot.value, attempt);
  if (manifest?.payload.projectStateHash !== input.observation.canonicalStateHash || manifest.payload.brief.version !== input.observation.briefVersion || manifest.payload.episode.status !== input.observation.episodeStatus) return fail("pilot_context_mismatch");
  const decisions = new Map(manifest.payload.decisions.map((item) => [item.id, item.status]));
  const issues = new Map(manifest.payload.issues.map((item) => [item.id, item.status]));
  if (input.observation.decisionStates.some((item) => decisions.get(item.id) !== item.status) || input.observation.issueStates.some((item) => issues.get(item.id) !== item.status || (item.status === "resolved" && item.treatAsOpenAudit))) return fail("pilot_context_mismatch");
  const timestamp = now(ports.clock);
  if (!timestamp.ok) return fail("invalid_closed_external_app_pilot");
  const continuity: ClosedPilotContinuityBinding = cloneFrozen({ ...input.observation, attemptId: attempt.id, invocationId: input.invocationId, manifestHash: input.manifestHash, verifiedAt: timestamp.value });
  return move(pilot.value, input.expectedVersion, "continuity_verified", "fresh_codex_session_observed_updated_canonical_state", "host", ports, { attempts: replaceAttempt(pilot.value, index, { ...attempt, status: "completed", completedAt: timestamp.value, mcpObservation: input.observation.mcpObservation, usage: "unavailable" }), continuity });
}

export function cancelClosedPilotAttempt(pilotInput: ClosedExternalAppPilot, input: { readonly expectedVersion: EntityVersion; readonly attemptId: string; readonly actor: ResearchActor }, ports: Ports): ResearchResult<ClosedExternalAppPilot> {
  const pilot = current(pilotInput);
  if (!pilot.ok) return pilot;
  if (!user(input.actor)) return fail("user_pilot_action_required");
  const index = attemptIndex(pilot.value, input.attemptId);
  const attempt = pilot.value.attempts[index];
  if (attempt === undefined || !["launching", "running"].includes(attempt.status) || !["launching", "running", "continuity_check_running"].includes(pilot.value.status)) return fail("invalid_closed_pilot_attempt");
  const timestamp = now(ports.clock);
  if (!timestamp.ok) return fail("invalid_closed_external_app_pilot");
  return move(pilot.value, input.expectedVersion, "cancelled", "user_cancelled_active_codex_attempt", "user", ports, { attempts: replaceAttempt(pilot.value, index, { ...attempt, status: "cancelled", cancelledAt: timestamp.value, failureCode: "cancelled_by_user" }), cancelledAt: timestamp.value, failure: { code: "cancelled_by_user", publicReason: "The user cancelled this invocation; no late result may be committed.", at: timestamp.value } });
}

export function failClosedPilotAttempt(pilotInput: ClosedExternalAppPilot, input: { readonly expectedVersion: EntityVersion; readonly attemptId: string; readonly failureCode: ClosedPilotFailureCode; readonly publicReason: string }, ports: Ports): ResearchResult<ClosedExternalAppPilot> {
  const pilot = current(pilotInput);
  if (!pilot.ok) return pilot;
  const index = attemptIndex(pilot.value, input.attemptId);
  const attempt = pilot.value.attempts[index];
  if (attempt === undefined || !["launching", "running"].includes(attempt.status) || !CLOSED_PILOT_FAILURE_CODES.includes(input.failureCode) || !text(input.publicReason, 1_024)) return fail("invalid_closed_pilot_attempt");
  const timestamp = now(ports.clock);
  if (!timestamp.ok) return fail("invalid_closed_external_app_pilot");
  return move(pilot.value, input.expectedVersion, input.failureCode === "host_unavailable" ? "blocked_host_unavailable" : "failed", input.failureCode, "kernel", ports, { attempts: replaceAttempt(pilot.value, index, { ...attempt, status: "failed", failedAt: timestamp.value, failureCode: input.failureCode }), failedAt: timestamp.value, failure: { code: input.failureCode, publicReason: input.publicReason, at: timestamp.value } });
}

export function recoverInterruptedClosedPilot(pilotInput: ClosedExternalAppPilot, input: { readonly expectedVersion: EntityVersion }, ports: Ports): ResearchResult<ClosedExternalAppPilot> {
  const pilot = current(pilotInput);
  if (!pilot.ok) return pilot;
  if (!["launching", "running", "continuity_check_running"].includes(pilot.value.status)) return fail("invalid_closed_pilot_transition");
  const index = pilot.value.attempts.findLastIndex((attempt) => ["launching", "running"].includes(attempt.status));
  const attempt = pilot.value.attempts[index];
  if (attempt === undefined) return fail("invalid_closed_pilot_attempt");
  const timestamp = now(ports.clock);
  if (!timestamp.ok) return fail("invalid_closed_external_app_pilot");
  return move(pilot.value, input.expectedVersion, "interrupted_unknown", "active_invocation_became_unknown_after_restart_without_retry", "kernel", ports, { attempts: replaceAttempt(pilot.value, index, { ...attempt, status: "unknown", failedAt: timestamp.value, failureCode: "invocation_interrupted_after_restart" }), failedAt: timestamp.value, failure: { code: "invocation_interrupted_after_restart", publicReason: "The app restarted before invocation completion could be proven; no automatic retry occurred.", at: timestamp.value } });
}

export function markClosedPilotStale(pilotInput: ClosedExternalAppPilot, input: { readonly expectedVersion: EntityVersion; readonly publicReason: string }, ports: Ports): ResearchResult<ClosedExternalAppPilot> {
  const pilot = current(pilotInput);
  if (!pilot.ok) return pilot;
  if (["closed", "cancelled"].includes(pilot.value.status) || !text(input.publicReason, 1_024)) return fail("invalid_closed_pilot_transition");
  const timestamp = now(ports.clock);
  if (!timestamp.ok) return fail("invalid_closed_external_app_pilot");
  const candidate = pilot.value.candidate === undefined ? undefined : { ...pilot.value.candidate, status: "stale" as const };
  return move(pilot.value, input.expectedVersion, "stale", "pilot_context_or_candidate_became_stale", "kernel", ports, { ...(candidate === undefined ? {} : { candidate }), failure: { code: "manifest_stale", publicReason: input.publicReason, at: timestamp.value } });
}

export function expireClosedPilotConfirmation(pilotInput: ClosedExternalAppPilot, input: { readonly expectedVersion: EntityVersion }, ports: Ports): ResearchResult<ClosedExternalAppPilot> {
  const pilot = current(pilotInput);
  if (!pilot.ok) return pilot;
  if (pilot.value.status !== "context_confirmation_required") return fail("invalid_closed_pilot_transition");
  const attempt = pilot.value.attempts.at(-1);
  const timestamp = now(ports.clock);
  if (!timestamp.ok || attempt === undefined || new Date(timestamp.value).getTime() < new Date(attempt.confirmationExpiresAt).getTime()) return fail("invalid_closed_pilot_transition");
  return move(pilot.value, input.expectedVersion, "expired", "context_confirmation_expired_without_dispatch", "kernel", ports, { failure: { code: "confirmation_expired", publicReason: "The one-attempt context confirmation expired; no context was sent.", at: timestamp.value } });
}

export function recordClosedPilotFeedback(pilotInput: ClosedExternalAppPilot, input: { readonly expectedVersion: EntityVersion; readonly codes: readonly ClosedPilotFeedbackCode[]; readonly note?: string; readonly actor: ResearchActor }, ports: Ports): ResearchResult<ClosedExternalAppPilot> {
  const pilot = current(pilotInput);
  if (!pilot.ok) return pilot;
  const allowed: readonly ClosedPilotFeedbackCode[] = ["useful", "not_useful", "too_much_setup", "context_incorrect", "context_disclosure_unclear", "candidate_redundant", "candidate_unsafe_or_misleading", "stopped_before_completion"];
  if (!user(input.actor) || input.codes.length > allowed.length || new Set(input.codes).size !== input.codes.length || input.codes.some((code) => !allowed.includes(code)) || (input.note !== undefined && (!text(input.note, 4_096) || pathLike(input.note)))) return fail("user_pilot_action_required");
  const timestamp = now(ports.clock);
  if (!timestamp.ok) return fail("invalid_closed_external_app_pilot");
  return move(pilot.value, input.expectedVersion, pilot.value.status, "optional_local_pilot_feedback_recorded", "user", ports, { feedback: { codes: input.codes, ...(input.note === undefined ? {} : { note: input.note }), recordedAt: timestamp.value } });
}

export function closeClosedExternalAppPilot(pilotInput: ClosedExternalAppPilot, input: { readonly expectedVersion: EntityVersion; readonly actor: ResearchActor }, ports: Ports): ResearchResult<ClosedExternalAppPilot> {
  const pilot = current(pilotInput);
  if (!pilot.ok) return pilot;
  if (!user(input.actor)) return fail("user_pilot_action_required");
  if (pilot.value.status === "closed" || !["continuity_verified", "failed", "cancelled", "blocked_host_unavailable", "interrupted_unknown", "stale", "expired"].includes(pilot.value.status)) return fail("invalid_closed_pilot_transition");
  const timestamp = now(ports.clock);
  if (!timestamp.ok) return fail("invalid_closed_external_app_pilot");
  return move(pilot.value, input.expectedVersion, "closed", "user_closed_pilot_without_starting_another_stage", "user", ports, { closedAt: timestamp.value });
}

export interface ClosedPilotEvidenceExport {
  readonly schemaVersion: "1.0.0";
  readonly evidenceClass: ClosedPilotEvidenceClass;
  readonly host: "codex";
  readonly projectBindingHash: string;
  readonly pilotBindingHash: string;
  readonly stableOutcome: ClosedExternalAppPilotStatus;
  readonly stages: {
    readonly preflight: boolean;
    readonly contextConfirmed: boolean;
    readonly mcpObserved: boolean;
    readonly candidateReceived: boolean;
    readonly candidateImported: boolean;
    readonly reviewBound: boolean;
    readonly dispositionRecorded: boolean;
    readonly continuityVerified: boolean;
    readonly closed: boolean;
  };
  readonly counts: { readonly manifests: number; readonly attempts: number; readonly candidateAttempts: number; readonly continuityAttempts: number; readonly retries: number };
  readonly context: readonly { readonly purpose: ClosedPilotAttemptKind; readonly categories: readonly string[]; readonly bytes: number; readonly hash: string; readonly selectedWorkingMemoryCount: number }[];
  readonly stableErrorCode?: ClosedPilotFailureCode;
  readonly feedbackCodes: readonly ClosedPilotFeedbackCode[];
  readonly authorityMutationCount: 0;
  readonly automaticRetryCount: 0;
  readonly externalUserEvidenceCount: 0;
}

export function createClosedPilotEvidenceExport(pilotInput: ClosedExternalAppPilot): ResearchResult<ClosedPilotEvidenceExport> {
  const pilot = current(pilotInput);
  if (!pilot.ok) return pilot;
  const projectHash = sha({ projectId: pilot.value.projectId });
  const pilotHash = sha({ pilotId: pilot.value.id, projectId: pilot.value.projectId });
  if (!projectHash.ok || !pilotHash.ok) return fail("invalid_closed_external_app_pilot");
  return ok(cloneFrozen({
    schemaVersion: "1.0.0",
    evidenceClass: pilot.value.evidenceClass,
    host: "codex",
    projectBindingHash: projectHash.value,
    pilotBindingHash: pilotHash.value,
    stableOutcome: pilot.value.status,
    stages: {
      preflight: pilot.value.preflight?.availability === "available",
      contextConfirmed: pilot.value.attempts.some((item) => item.confirmedAt !== undefined),
      mcpObserved: pilot.value.attempts.some((item) => item.mcpObservation !== undefined),
      candidateReceived: pilot.value.candidate !== undefined,
      candidateImported: pilot.value.candidate?.status === "imported",
      reviewBound: pilot.value.review !== undefined,
      dispositionRecorded: pilot.value.disposition !== undefined,
      continuityVerified: pilot.value.continuity !== undefined,
      closed: pilot.value.status === "closed",
    },
    counts: {
      manifests: pilot.value.manifests.length,
      attempts: pilot.value.attempts.length,
      candidateAttempts: pilot.value.attempts.filter((item) => item.kind === "candidate_generation").length,
      continuityAttempts: pilot.value.attempts.filter((item) => item.kind === "continuity_check").length,
      retries: pilot.value.attempts.filter((item) => item.ordinal === 2).length,
    },
    context: pilot.value.manifests.map((manifest) => ({ purpose: manifest.purpose, categories: [...new Set(manifest.included.map((item) => item.category))].sort(), bytes: manifest.payloadBytes, hash: manifest.payloadHash, selectedWorkingMemoryCount: manifest.workingMemorySelection.selectedIds.length })),
    ...(pilot.value.failure === undefined ? {} : { stableErrorCode: pilot.value.failure.code }),
    feedbackCodes: pilot.value.feedback?.codes ?? [],
    authorityMutationCount: 0,
    automaticRetryCount: 0,
    externalUserEvidenceCount: 0,
  }));
}

function persistedValue(value: unknown): unknown {
  return value;
}

export function parseClosedExternalAppPilot(input: unknown): ResearchResult<ClosedExternalAppPilot> {
  if (!isRecord(input) || input.schemaVersion !== "1.0.0" || !parseResearchIdFor(input.id, "rpil_").ok || !parseResearchIdFor(input.projectId, "rprj_").ok || input.host !== "codex" || input.authority !== "external_host_proposal_only" || input.canMutateAuthority !== false || !validBrief(input.brief) || !validEpisode(input.episode) || !text(input.currentTask, 16_384) || !["synthetic_fixture", "owner_operated_closed_host_observation"].includes(String(input.evidenceClass)) || !CLOSED_EXTERNAL_APP_PILOT_STATUSES.includes(input.status as ClosedExternalAppPilotStatus) || !parseEntityVersion(input.version).ok || !Array.isArray(input.manifests) || !Array.isArray(input.attempts) || !Array.isArray(input.events) || !text(input.createdAt, 128) || !text(input.updatedAt, 128)) return fail("invalid_closed_external_app_pilot");
  const pilot = input as unknown as ClosedExternalAppPilot;
  if (!isRecord(pilot.invocationBudget) || persistedValue(pilot.invocationBudget.candidateMaximum) !== 2 || persistedValue(pilot.invocationBudget.continuityMaximum) !== 2 || persistedValue(pilot.invocationBudget.automaticRetries) !== 0 || !Number.isSafeInteger(pilot.invocationBudget.candidateAttemptsUsed) || !Number.isSafeInteger(pilot.invocationBudget.continuityAttemptsUsed) || pilot.invocationBudget.candidateAttemptsUsed < 0 || pilot.invocationBudget.candidateAttemptsUsed > 2 || pilot.invocationBudget.continuityAttemptsUsed < 0 || pilot.invocationBudget.continuityAttemptsUsed > 2) return fail("invalid_closed_external_app_pilot");
  if (pilot.manifests.length > 4 || pilot.attempts.length > 4 || pilot.manifests.length !== pilot.attempts.length || new Set(pilot.manifests.map((item) => item.id)).size !== pilot.manifests.length || new Set(pilot.attempts.map((item) => item.id)).size !== pilot.attempts.length) return fail("invalid_closed_external_app_pilot");
  for (const manifest of pilot.manifests) {
    if (persistedValue(manifest.schemaVersion) !== "1.0.0" || !parseResearchIdFor(manifest.id, "rman_").ok || persistedValue(manifest.version) !== 1 || manifest.pilotId !== pilot.id || manifest.projectId !== pilot.projectId || persistedValue(manifest.host) !== "codex" || !["candidate_generation", "continuity_check"].includes(manifest.purpose) || !parseResearchIdFor(manifest.attemptId, "rpat_").ok || !shaString(manifest.payloadHash) || bytes(manifest.payloadUtf8) !== manifest.payloadBytes || manifest.payloadBytes > MAX_CONTEXT_BYTES || manifest.payload.manifestBinding.manifestId !== manifest.id || manifest.payload.manifestBinding.attemptId !== manifest.attemptId || manifest.payload.manifestBinding.projectId !== pilot.projectId || manifest.payload.manifestBinding.pilotId !== pilot.id || manifest.payload.manifestBinding.purpose !== manifest.purpose || persistedValue(manifest.payload.manifestBinding.host) !== "codex" || persistedValue(manifest.workingMemorySelection.defaultSelectedCount) !== 0 || persistedValue(manifest.workingMemorySelection.neverSendIncludedCount) !== 0 || persistedValue(manifest.disclosure.automaticRetries) !== 0 || persistedValue(manifest.disclosure.invocationLimit) !== 1 || persistedValue(manifest.disclosure.sandbox) !== "read_only" || persistedValue(manifest.disclosure.projectWrite) !== false) return fail("invalid_pilot_context_manifest");
    const canonical = canonicalStringify(manifest.payload);
    const digest = sha(manifest.payload);
    if (!canonical.ok || !digest.ok || canonical.value !== manifest.payloadUtf8 || digest.value !== manifest.payloadHash) return fail("invalid_pilot_context_manifest");
    if (manifest.payload.workingMemory.some((item) => persistedValue(item.outboundPolicy) !== "explicit_manifest_only" || !manifest.workingMemorySelection.selectedIds.includes(item.id))) return fail("invalid_pilot_context_manifest");
  }
  for (const attempt of pilot.attempts) {
    if (!parseResearchIdFor(attempt.id, "rpat_").ok || !["candidate_generation", "continuity_check"].includes(attempt.kind) || ![1, 2].includes(attempt.ordinal) || !["prepared", "confirmed", "launching", "running", "completed", "failed", "cancelled", "unknown"].includes(attempt.status) || !parseResearchIdFor(attempt.manifestId, "rman_").ok || !shaString(attempt.manifestHash) || !parseResearchIdFor(attempt.confirmationNonce, "rpno_").ok || pilot.manifests.every((manifest) => manifest.id !== attempt.manifestId || manifest.attemptId !== attempt.id || manifest.payloadHash !== attempt.manifestHash)) return fail("invalid_closed_pilot_attempt");
    if (attempt.invocationId !== undefined && !parseResearchIdFor(attempt.invocationId, "rpiv_").ok) return fail("invalid_closed_pilot_attempt");
  }
  if (pilot.candidate !== undefined && (persistedValue(pilot.candidate.authority) !== "model_proposed" || persistedValue(pilot.candidate.canMutateAuthority) !== false || !parseResearchIdFor(pilot.candidate.id, "rpca_").ok || !shaString(pilot.candidate.candidateHash))) return fail("invalid_closed_pilot_candidate");
  if (pilot.continuity !== undefined && (persistedValue(pilot.continuity.authority) !== "host_observation" || persistedValue(pilot.continuity.canMutateAuthority) !== false || pilot.continuity.projectId !== pilot.projectId)) return fail("invalid_closed_pilot_continuity");
  if (pilot.events.length === 0 || pilot.events.length > 256 || pilot.events.some((event, index) => !parseResearchIdFor(event.id, "rpev_").ok || event.index !== index || !CLOSED_EXTERNAL_APP_PILOT_STATUSES.includes(event.to) || (index === 0 ? event.from !== null : event.from !== pilot.events[index - 1]?.to) || !text(event.reason, 512) || !["user", "kernel", "host"].includes(event.actor))) return fail("invalid_closed_external_app_pilot");
  if (pilot.events.at(-1)?.to !== pilot.status || (pilot.status === "closed" && pilot.closedAt === undefined) || persistedValue(pilot.authority) !== "external_host_proposal_only" || persistedValue(pilot.canMutateAuthority) !== false) return fail("invalid_closed_external_app_pilot");
  return ok(cloneFrozen(pilot));
}
