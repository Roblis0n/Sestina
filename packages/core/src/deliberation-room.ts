import { createHash } from "node:crypto";
import {
  DELIBERATION_COMPARISON_DIMENSION_IDS,
  completeDeliberationChallenge,
  completeDeliberationParticipant,
  completeDeliberationParticipantRetry,
  cancelDeliberationParticipant,
  createDeliberationRoom,
  failDeliberationChallenge,
  failDeliberationParticipant,
  failDeliberationParticipantRetry,
  getActiveResearchBriefVersion,
  importManualExternalOpinion,
  inspectDeliberationCommand,
  markDeliberationRoomStale,
  parseResearchId,
  parseResearchIdFor,
  resolveDeliberationRoom,
  recordDeliberationCommand,
  recoverInterruptedDeliberationRoom,
  revealDeliberationRound,
  stableResearchHash,
  startBlindDeliberationRound,
  waitForDeliberationResolution,
  prepareDeliberationChallenge,
  prepareDeliberationContext,
  prepareDeliberationParticipantRetry,
  startDeliberationChallenge,
  startDeliberationParticipantRetry,
  type Clock,
  type DeliberationContextManifest,
  type DeliberationComparisonDimension,
  type DeliberationFrozenContext,
  type DeliberationParticipantFailure,
  type DeliberationParticipantSnapshot,
  type DeliberationProviderReadiness,
  type DeliberationResolutionKind,
  type DeliberationRoom,
  type DeliberationSourceBinding,
  type DeliberationSourceKind,
  type EntityVersion,
  type IdFactory,
  type ResearchActor,
  type ResearchPage,
  type ResearchPageRequest,
  type ResearchResult,
} from "@sestina/research";
import type { ResearchStore } from "@sestina/research-store";
import {
  createDeliberationContextManifest,
  prepareDeliberationParticipantRequest,
  submitDeliberationParticipantAssessment,
  type DeliberationAllowedContextObject,
  type DeliberationParticipantRequest,
  type ResearchRoomSemanticProviderBinding,
} from "@sestina/review";
import { coreErr, coreOk, fromDomain, type CoreResult } from "./errors.js";
import type { ResearchRoomState } from "./research-room.js";

const PAGE = Object.freeze({ limit: 200 });
const MAX_PROVIDER_TIMEOUT_MS = 120_000;
const PROVIDER_TIMEOUT_REASON = Object.freeze({ code: "provider_timeout" as const });
const DEFAULT_COMPARISON_DIMENSIONS: readonly DeliberationComparisonDimension[] = Object.freeze(DELIBERATION_COMPARISON_DIMENSION_IDS.map((id) => Object.freeze({ id, label: id.replaceAll("_", " ") })));
const DEFAULT_STOP_CONDITIONS = Object.freeze(["Both initial attempts are terminal.", "At most one user-confirmed directed challenge may run.", "The Room stops for an explicit user resolution or close action."]);

export interface DeliberationParticipantProviderInput {
  readonly schemaVersion: "1.0.0";
  readonly endpoint: string;
  readonly participantId: string;
  readonly participantSnapshotHash: string;
  readonly requestHash: string;
  readonly requestBody: string;
  readonly requestBodyHash: string;
  readonly requestBodyBytes: number;
  readonly responseLimitBytes: number;
  readonly redirectPolicy: "error";
  readonly retryCount: 0;
}

export interface DeliberationParticipantProvider {
  readonly id: string;
  readonly connectionId: string;
  readonly kind: "deterministic_fixture" | "local" | "external";
  readonly networkAccess: "none" | "loopback" | "external";
  readonly harnessId: string;
  readonly runtimeIdentityHash: string;
  readonly endpointIdentityHash: string;
  readonly secretRefHash: string;
  readonly binding: ResearchRoomSemanticProviderBinding;
  prepare(request: DeliberationParticipantRequest): DeliberationParticipantProviderInput;
  analyze(request: DeliberationParticipantRequest, preview: DeliberationParticipantProviderInput, options: { readonly signal: AbortSignal }): Promise<unknown>;
}

export interface CreateDeliberationRoomInput {
  readonly commandId?: string;
  readonly projectId: string;
  readonly sourceKind: DeliberationSourceKind;
  readonly sourceObjectId: string;
  readonly question: string;
  readonly title: string;
  readonly actor: ResearchActor;
}

export interface PrepareDeliberationRoomInput {
  readonly commandId?: string;
  readonly projectId: string;
  readonly roomId: string;
  readonly expectedVersion: EntityVersion;
  readonly revisionId: string;
  readonly includeBrief: boolean;
  readonly decisionIds: readonly string[];
  readonly issueIds: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly comparisonDimensions?: readonly DeliberationComparisonDimension[];
  readonly stopConditions?: readonly string[];
  readonly actor: ResearchActor;
}

export interface PreparedDeliberationRoom {
  readonly contextManifestsVisible: true;
  readonly room: DeliberationRoom;
  readonly manifests: readonly [DeliberationContextManifest, DeliberationContextManifest];
  readonly requests: readonly [DeliberationParticipantRequest, DeliberationParticipantRequest];
  readonly providerPreviews: readonly [{ readonly endpoint: string; readonly requestBodyBytes: number; readonly responseLimitBytes: number; readonly retryCount: 0; readonly redirectPolicy: "error" }, { readonly endpoint: string; readonly requestBodyBytes: number; readonly responseLimitBytes: number; readonly retryCount: 0; readonly redirectPolicy: "error" }];
}

export interface RunDeliberationRoomBlindRoundInput {
  readonly commandId?: string;
  readonly projectId: string;
  readonly roomId: string;
  readonly expectedVersion: EntityVersion;
  readonly confirmedManifestHashes: readonly [string, string];
  readonly actor: ResearchActor;
}

export interface DeliberationRoomCommandInput {
  readonly commandId?: string;
  readonly projectId: string;
  readonly roomId: string;
  readonly expectedVersion: EntityVersion;
  readonly actor: ResearchActor;
}

export interface RevealDeliberationRoomInput extends DeliberationRoomCommandInput {
  readonly mode: "complete" | "partial" | "cancelled";
}

export interface ResolveDeliberationRoomInput extends DeliberationRoomCommandInput {
  readonly kind: DeliberationResolutionKind;
  readonly publicReason: string;
  readonly combinedText?: string;
}

export interface ImportManualExternalOpinionCoreInput extends DeliberationRoomCommandInput {
  readonly sourceLabel: string;
  readonly providerClaim: string;
  readonly modelClaim: string;
  readonly capturedAt: string;
  readonly contextDisclosure: string;
  readonly sawParticipantAOutput: boolean;
  readonly sawParticipantBOutput: boolean;
  readonly publicContent: string;
}

export interface PrepareDeliberationChallengeCoreInput extends DeliberationRoomCommandInput {
  readonly question: string;
}

export interface PreparedDeliberationChallenge {
  readonly contextManifestVisible: true;
  readonly sharedContextOnly: true;
  readonly room: DeliberationRoom;
  readonly manifests: readonly [DeliberationContextManifest, DeliberationContextManifest];
  readonly requests: readonly [DeliberationParticipantRequest, DeliberationParticipantRequest];
  readonly providerPreviews: readonly [{ readonly endpoint: string; readonly requestBodyBytes: number; readonly responseLimitBytes: number; readonly retryCount: 0; readonly redirectPolicy: "error" }, { readonly endpoint: string; readonly requestBodyBytes: number; readonly responseLimitBytes: number; readonly retryCount: 0; readonly redirectPolicy: "error" }];
}

export interface RunDeliberationChallengeCoreInput extends DeliberationRoomCommandInput {
  readonly challengeId: string;
  readonly confirmedManifestHashes: readonly [string, string];
}

export interface PreparedDeliberationParticipantRetry {
  readonly contextManifestVisible: true;
  readonly room: DeliberationRoom;
  readonly manifest: DeliberationContextManifest;
  readonly request: DeliberationParticipantRequest;
  readonly providerPreview: { readonly endpoint: string; readonly requestBodyBytes: number; readonly responseLimitBytes: number; readonly retryCount: 0; readonly redirectPolicy: "error" };
}

export interface RunDeliberationParticipantRetryCoreInput extends DeliberationRoomCommandInput {
  readonly retryId: string;
  readonly confirmedManifestHash: string;
}

interface RebuiltParticipant {
  readonly request: DeliberationParticipantRequest;
  readonly preview: DeliberationParticipantProviderInput;
}

interface ActiveRun {
  readonly controller: AbortController;
  readonly promise: Promise<CoreResult<DeliberationRoom>>;
}

interface RoomCommand {
  readonly commandId: string;
  readonly kind: string;
  readonly payloadHash: string;
  readonly replay: boolean;
}

type RoomPageReader<T> = (page: ResearchPageRequest) => ResearchResult<ResearchPage<T>>;

function collectPages<T>(read: RoomPageReader<T>): CoreResult<readonly T[]> {
  const values: T[] = [];
  let cursor: string | undefined;
  do {
    const page = fromDomain(read({ ...PAGE, ...(cursor === undefined ? {} : { cursor }) }));
    if (!page.ok) return page;
    values.push(...page.value.items);
    cursor = page.value.nextCursor;
  } while (cursor !== undefined);
  return coreOk(Object.freeze(values));
}

function rawSha(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function same(left: unknown, right: unknown): boolean {
  const a = stableResearchHash(left);
  const b = stableResearchHash(right);
  return a.ok && b.ok && a.value === b.value;
}

function sha(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

function nonBlank(value: unknown, maximum = 16_384): value is string {
  return typeof value === "string" && value.trim().length > 0 && Buffer.byteLength(value.trim(), "utf8") <= maximum;
}

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueStrings(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length > 128 || !value.every((item): item is string => typeof item === "string") || new Set(value).size !== value.length) return undefined;
  return Object.freeze(value.slice());
}

function normalizedFailure(error: unknown, timedOut: boolean): DeliberationParticipantFailure {
  if (timedOut) return "provider_timeout";
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { readonly code?: unknown }).code;
    if (code === "provider_timeout") return "provider_timeout";
    if (code === "provider_offline") return "provider_offline";
    if (code === "provider_network_failed") return "provider_offline";
    if (code === "provider_configuration_changed") return "provider_configuration_changed";
    if (code === "response_too_large") return "response_too_large";
    if (code === "provider_response_too_large") return "response_too_large";
  }
  return "provider_failed";
}

function validProvider(provider: DeliberationParticipantProvider): boolean {
  const runtimeFamily: unknown = provider.binding.family;
  if (!nonBlank(provider.id, 256) || !nonBlank(provider.connectionId, 256) || !nonBlank(provider.harnessId, 256) || !sha(provider.runtimeIdentityHash) || !sha(provider.endpointIdentityHash) || !sha(provider.secretRefHash) || runtimeFamily !== "openai_compatible" || !nonBlank(provider.binding.model, 512) || !Number.isSafeInteger(provider.binding.configGeneration) || provider.binding.configGeneration < 1 || !["local", "external"].includes(provider.binding.locality)) return false;
  try {
    const url = new URL(provider.binding.baseUrlOrigin);
    return url.origin === provider.binding.baseUrlOrigin && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

function snapshotFor(provider: DeliberationParticipantProvider, slot: "a" | "b", id: string): DeliberationParticipantSnapshot {
  return Object.freeze({
    id,
    slot,
    role: "independent_research_assessor" as const,
    connectionId: provider.connectionId,
    providerId: provider.id,
    family: provider.binding.family,
    model: provider.binding.model,
    harnessId: provider.harnessId,
    runtimeIdentityHash: provider.runtimeIdentityHash,
    endpointIdentityHash: provider.endpointIdentityHash,
    secretRefHash: provider.secretRefHash,
    configGeneration: provider.binding.configGeneration,
    locality: provider.binding.locality,
  });
}

function missingSnapshot(slot: "a" | "b", id: string): DeliberationParticipantSnapshot {
  return Object.freeze({
    id,
    slot,
    role: "independent_research_assessor" as const,
    connectionId: `unconfigured-${slot}`,
    providerId: "unconfigured",
    family: "openai_compatible" as const,
    model: "not_configured",
    harnessId: `unconfigured-${slot}`,
    runtimeIdentityHash: rawSha(`unconfigured-runtime-${slot}`),
    endpointIdentityHash: rawSha(`unconfigured-endpoint-${slot}`),
    secretRefHash: rawSha(`unconfigured-secret-${slot}`),
    configGeneration: 1,
    locality: "local" as const,
  });
}

function providerMatches(snapshot: DeliberationParticipantSnapshot, provider: DeliberationParticipantProvider): boolean {
  return snapshot.connectionId === provider.connectionId && snapshot.providerId === provider.id && snapshot.model === provider.binding.model && snapshot.harnessId === provider.harnessId && snapshot.runtimeIdentityHash === provider.runtimeIdentityHash && snapshot.endpointIdentityHash === provider.endpointIdentityHash && snapshot.secretRefHash === provider.secretRefHash && snapshot.configGeneration === provider.binding.configGeneration && snapshot.locality === provider.binding.locality;
}

function validatePreview(request: DeliberationParticipantRequest, preview: DeliberationParticipantProviderInput, provider: DeliberationParticipantProvider): boolean {
  const runtimeSchemaVersion: unknown = preview.schemaVersion;
  const runtimeRedirectPolicy: unknown = preview.redirectPolicy;
  const runtimeRetryCount: unknown = preview.retryCount;
  if (runtimeSchemaVersion !== "1.0.0" || preview.participantId !== request.participant.id || preview.participantSnapshotHash !== request.participantSnapshotHash || preview.requestHash !== request.requestHash || preview.requestBodyHash !== rawSha(preview.requestBody) || preview.requestBodyBytes !== Buffer.byteLength(preview.requestBody, "utf8") || preview.responseLimitBytes !== request.limits.maxResponseBytes || runtimeRedirectPolicy !== "error" || runtimeRetryCount !== 0) return false;
  try {
    const endpoint = new URL(preview.endpoint);
    return endpoint.username === "" && endpoint.password === "" && endpoint.origin === provider.binding.baseUrlOrigin;
  } catch {
    return false;
  }
}

export class DeliberationRoomService {
  readonly #activeRuns = new Map<string, ActiveRun>();

  constructor(
    private readonly store: ResearchStore,
    private readonly clock: Clock,
    private readonly idFactory: IdFactory,
    private readonly readResearchRoomState: (projectId: string) => CoreResult<ResearchRoomState>,
    private readonly providers?: readonly [DeliberationParticipantProvider, DeliberationParticipantProvider],
    private readonly timeoutMs = 15_000,
  ) {}

  get(projectId: string, roomId: string): CoreResult<DeliberationRoom | undefined> {
    if (!parseResearchIdFor(projectId, "rprj_").ok || !parseResearchIdFor(roomId, "rdlr_").ok) return coreErr("invalid_input");
    return fromDomain(this.store.deliberationRooms.getById(projectId, roomId));
  }

  list(projectId: string): CoreResult<readonly DeliberationRoom[]> {
    if (!parseResearchIdFor(projectId, "rprj_").ok) return coreErr("invalid_input");
    const values = collectPages((page) => this.store.deliberationRooms.listByProject(projectId, page));
    if (!values.ok) return values;
    return coreOk(Object.freeze([...values.value].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id))));
  }

  refreshSource(projectId: string, roomId: string): CoreResult<DeliberationRoom> {
    const room = this.require(projectId, roomId); if (!room.ok) return room;
    return this.refreshSourceBinding(room.value);
  }

  recoverInterrupted(): CoreResult<number> {
    const projects = collectPages((page) => this.store.projects.list(page));
    if (!projects.ok) return projects;
    let recovered = 0;
    for (const project of projects.value) {
      const rooms = this.list(project.id); if (!rooms.ok) return rooms;
      for (const room of rooms.value) {
        if (room.status !== "blind_round_running" && room.status !== "challenge_running" && room.status !== "retry_running") continue;
        const next = fromDomain(recoverInterruptedDeliberationRoom(room, this.clock)); if (!next.ok) return next;
        const command = this.command(room, `kernel:restart:${room.id}:${room.version}`, "recover_interrupted_run", { roomId: room.id, interruptedVersion: room.version }); if (!command.ok) return command;
        const stored = this.commitCommand(room, next.value, command.value); if (!stored.ok) return stored;
        recovered += 1;
      }
    }
    return coreOk(recovered);
  }

  create(input: CreateDeliberationRoomInput): CoreResult<DeliberationRoom> {
    if (!nonBlank(input.title, 512) || !nonBlank(input.question, 16_384)) return coreErr("invalid_input");
    const createHash = stableResearchHash({ projectId: input.projectId, sourceKind: input.sourceKind, sourceObjectId: input.sourceObjectId, question: input.question.trim(), title: input.title.trim(), actor: input.actor });
    if (!createHash.ok) return coreErr("invalid_input");
    const commandId = input.commandId ?? `implicit:create:${createHash.value.slice(0, 40)}`;
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(commandId)) return coreErr("invalid_input");
    const source = this.sourceBinding(input); if (!source.ok) return source;
    const existing = fromDomain(this.store.deliberationRooms.getActiveBySource(input.projectId, input.sourceKind, input.sourceObjectId));
    if (!existing.ok) return existing;
    if (existing.value !== undefined) return existing.value.title === input.title.trim() && existing.value.source.question === input.question.trim() ? coreOk(existing.value) : coreErr("state_conflict");
    const participantAId = this.idFactory.create("rpar_");
    const participantBId = this.idFactory.create("rpar_");
    if (!parseResearchIdFor(participantAId, "rpar_").ok || !parseResearchIdFor(participantBId, "rpar_").ok) return coreErr("infrastructure_failure");
    const providerState = this.providerState();
    const participants = providerState.providers === undefined
      ? [missingSnapshot("a", participantAId), missingSnapshot("b", participantBId)] as const
      : [snapshotFor(providerState.providers[0], "a", participantAId), snapshotFor(providerState.providers[1], "b", participantBId)] as const;
    const created = fromDomain(createDeliberationRoom({ source: source.value, title: input.title, participants, providerReadiness: providerState.readiness, commandId, actor: input.actor }, { clock: this.clock, idFactory: this.idFactory }));
    return created.ok ? fromDomain(this.store.deliberationRooms.create(created.value)) : created;
  }

  prepare(input: PrepareDeliberationRoomInput): CoreResult<PreparedDeliberationRoom> {
    const current = this.require(input.projectId, input.roomId); if (!current.ok) return current;
    const freshness = this.refreshSourceBinding(current.value); if (!freshness.ok) return freshness;
    if (freshness.value.status === "stale_conflicted") return coreErr("stale_state");
    if (current.value.providerReadiness !== "configured_distinct") return coreErr("review_blocked");
    const providers = this.validProviders(); if (!providers.ok) return providers;
    const command = this.command(current.value, input.commandId, "prepare_manifests", { expectedVersion: input.expectedVersion, revisionId: input.revisionId, includeBrief: input.includeBrief, decisionIds: input.decisionIds, issueIds: input.issueIds, evidenceIds: input.evidenceIds, ...(input.comparisonDimensions === undefined ? {} : { comparisonDimensions: input.comparisonDimensions }), ...(input.stopConditions === undefined ? {} : { stopConditions: input.stopConditions }), actor: input.actor });
    if (!command.ok) return command;
    if (command.value.replay) return this.preparedProjection(current.value);
    if (current.value.status !== "draft" || !same(current.value.version, input.expectedVersion)) return coreErr(current.value.version !== input.expectedVersion ? "stale_state" : "state_conflict");
    const decisionIds = uniqueStrings(input.decisionIds); const issueIds = uniqueStrings(input.issueIds); const evidenceIds = uniqueStrings(input.evidenceIds);
    const comparisonDimensions = input.comparisonDimensions ?? DEFAULT_COMPARISON_DIMENSIONS;
    const stopConditions = input.stopConditions ?? DEFAULT_STOP_CONDITIONS;
    const runtimeComparisonDimensions: unknown = comparisonDimensions;
    const runtimeStopConditions: unknown = stopConditions;
    if (!input.includeBrief || decisionIds === undefined || issueIds === undefined || evidenceIds === undefined || !parseResearchIdFor(input.revisionId, "rrev_").ok || !Array.isArray(runtimeComparisonDimensions) || runtimeComparisonDimensions.length !== DELIBERATION_COMPARISON_DIMENSION_IDS.length || runtimeComparisonDimensions.some((item, index) => !record(item) || item.id !== DELIBERATION_COMPARISON_DIMENSION_IDS[index] || !nonBlank(item.label, 256)) || !Array.isArray(runtimeStopConditions) || runtimeStopConditions.length === 0 || runtimeStopConditions.length > 32 || runtimeStopConditions.some((item) => !nonBlank(item, 1_024))) return coreErr("invalid_input");
    const state = this.readResearchRoomState(input.projectId); if (!state.ok) return state;
    const stateBindingHash = stableResearchHash(state.value.stateBinding); if (!stateBindingHash.ok) return coreErr("infrastructure_failure");
    const revision = this.findRevision(input.projectId, input.revisionId); if (!revision.ok) return revision;
    if (revision.value.inlineContent === undefined) return coreErr("review_blocked");
    const allowed = this.allowedObjects(state.value, revision.value, { includeBrief: input.includeBrief, decisionIds, issueIds, evidenceIds }); if (!allowed.ok) return allowed;
    const frozenContext = this.frozenContext(current.value.source.question, state.value, allowed.value, evidenceIds, comparisonDimensions, stopConditions, stateBindingHash.value); if (!frozenContext.ok) return frozenContext;
    const roundId = this.idFactory.create("rrnd_");
    if (!parseResearchIdFor(roundId, "rrnd_").ok) return coreErr("infrastructure_failure");
    const requestsResult = this.requestsFor(current.value, roundId, stateBindingHash.value, revision.value, allowed.value, comparisonDimensions);
    if (!requestsResult.ok) return requestsResult;
    const requests = requestsResult.value;
    let previews: readonly [DeliberationParticipantProviderInput, DeliberationParticipantProviderInput];
    try {
      // Both canonical requests exist before either provider adapter is asked to prepare a transport body.
      previews = [providers.value[0].prepare(requests[0]), providers.value[1].prepare(requests[1])];
    } catch {
      return coreErr("review_blocked");
    }
    if (!validatePreview(requests[0], previews[0], providers.value[0]) || !validatePreview(requests[1], previews[1], providers.value[1])) return coreErr("review_blocked");
    const manifestsResult = this.manifestsFor(requests, previews); if (!manifestsResult.ok) return manifestsResult;
    const prepared = fromDomain(prepareDeliberationContext(current.value, { expectedVersion: input.expectedVersion, frozenContext: frozenContext.value, manifests: manifestsResult.value }, this.clock));
    if (!prepared.ok) return prepared;
    const stored = this.commitCommand(current.value, prepared.value, command.value);
    return stored.ok ? this.projection(stored.value, requests, previews) : stored;
  }

  run(input: RunDeliberationRoomBlindRoundInput): Promise<CoreResult<DeliberationRoom>> {
    const key = `${input.projectId}:${input.roomId}`;
    const active = this.#activeRuns.get(key);
    if (active !== undefined) return active.promise;
    const controller = new AbortController();
    const promise = this.runInternal(input, controller).finally(() => { this.#activeRuns.delete(key); });
    this.#activeRuns.set(key, { controller, promise });
    return promise;
  }

  reveal(input: RevealDeliberationRoomInput): CoreResult<DeliberationRoom> {
    const current = this.require(input.projectId, input.roomId); if (!current.ok) return current;
    const command = this.command(current.value, input.commandId, "reveal", { expectedVersion: input.expectedVersion, mode: input.mode, actor: input.actor }); if (!command.ok) return command;
    if (command.value.replay) return coreOk(current.value);
    const next = fromDomain(revealDeliberationRound(current.value, { expectedVersion: input.expectedVersion, actor: input.actor, mode: input.mode }, this.clock));
    return next.ok ? this.commitCommand(current.value, next.value, command.value) : next;
  }

  prepareRetry(input: DeliberationRoomCommandInput): CoreResult<PreparedDeliberationParticipantRetry> {
    const current = this.require(input.projectId, input.roomId); if (!current.ok) return current;
    const freshness = this.refreshSourceBinding(current.value); if (!freshness.ok) return freshness;
    if (freshness.value.status === "stale_conflicted") return coreErr("stale_state");
    const providers = this.validProviders(); if (!providers.ok) return providers;
    const command = this.command(current.value, input.commandId, "prepare_participant_retry", { expectedVersion: input.expectedVersion, actor: input.actor }); if (!command.ok) return command;
    if (command.value.replay) return this.preparedRetryProjection(current.value);
    if (current.value.status !== "partial" || current.value.retry !== undefined || current.value.challenge !== undefined || current.value.initialRound === undefined) return coreErr("state_conflict");
    const participantIndex = current.value.initialRound.attempts.findIndex((attempt) => ["failed", "cancelled", "unknown"].includes(attempt.status));
    if (participantIndex !== 0 && participantIndex !== 1) return coreErr("state_conflict");
    const retryId = this.idFactory.create("rrnd_");
    const attemptId = this.idFactory.create("rdat_");
    if (!parseResearchIdFor(retryId, "rrnd_").ok || !parseResearchIdFor(attemptId, "rdat_").ok) return coreErr("infrastructure_failure");
    const built = this.buildRetryRequest(current.value, participantIndex, retryId, providers.value[participantIndex]); if (!built.ok) return built;
    const next = fromDomain(prepareDeliberationParticipantRetry(current.value, { expectedVersion: input.expectedVersion, actor: input.actor, retryId, attemptId, manifest: built.value.manifest }, this.clock));
    if (!next.ok) return next;
    const stored = this.commitCommand(current.value, next.value, command.value); if (!stored.ok) return stored;
    return this.retryProjection(stored.value, built.value.request, built.value.preview);
  }

  runRetry(input: RunDeliberationParticipantRetryCoreInput): Promise<CoreResult<DeliberationRoom>> {
    const key = `${input.projectId}:${input.roomId}:retry`;
    const active = this.#activeRuns.get(key);
    if (active !== undefined) return active.promise;
    const controller = new AbortController();
    const promise = this.runRetryInternal(input, controller).finally(() => { this.#activeRuns.delete(key); });
    this.#activeRuns.set(key, { controller, promise });
    return promise;
  }

  prepareChallenge(input: PrepareDeliberationChallengeCoreInput): CoreResult<PreparedDeliberationChallenge> {
    const current = this.require(input.projectId, input.roomId); if (!current.ok) return current;
    const freshness = this.refreshSourceBinding(current.value); if (!freshness.ok) return freshness;
    if (freshness.value.status === "stale_conflicted") return coreErr("stale_state");
    const providers = this.validProviders(); if (!providers.ok) return providers;
    const command = this.command(current.value, input.commandId, "prepare_challenge", { expectedVersion: input.expectedVersion, actor: input.actor, question: input.question }); if (!command.ok) return command;
    if (command.value.replay) return this.preparedChallengeProjection(current.value);
    if (current.value.status !== "difference_review" || current.value.challenge !== undefined || current.value.frozenContext === undefined || current.value.differenceSummary === undefined || !nonBlank(input.question, 8_192)) return coreErr("state_conflict");
    const challengeId = this.idFactory.create("rdch_");
    const attemptIds = [this.idFactory.create("rdat_"), this.idFactory.create("rdat_")] as const;
    if (!parseResearchIdFor(challengeId, "rdch_").ok || !parseResearchIdFor(attemptIds[0], "rdat_").ok || !parseResearchIdFor(attemptIds[1], "rdat_").ok) return coreErr("infrastructure_failure");
    const built = this.buildChallengeRequests(current.value, input.question.trim(), challengeId, providers.value); if (!built.ok) return built;
    const next = fromDomain(prepareDeliberationChallenge(current.value, { expectedVersion: input.expectedVersion, actor: input.actor, question: input.question, challengeId, attemptIds, manifests: built.value.manifests, sharedContextHash: built.value.sharedContextHash }, { clock: this.clock }));
    if (!next.ok) return next;
    const stored = this.commitCommand(current.value, next.value, command.value); if (!stored.ok) return stored;
    return this.challengeProjection(stored.value, built.value.requests, built.value.previews);
  }

  runChallenge(input: RunDeliberationChallengeCoreInput): Promise<CoreResult<DeliberationRoom>> {
    const key = `${input.projectId}:${input.roomId}:challenge`;
    const active = this.#activeRuns.get(key);
    if (active !== undefined) return active.promise;
    const controller = new AbortController();
    const promise = this.runChallengeInternal(input, controller).finally(() => { this.#activeRuns.delete(key); });
    this.#activeRuns.set(key, { controller, promise });
    return promise;
  }

  waitForResolution(input: DeliberationRoomCommandInput): CoreResult<DeliberationRoom> {
    const current = this.require(input.projectId, input.roomId); if (!current.ok) return current;
    const command = this.command(current.value, input.commandId, "finish_difference_review", { expectedVersion: input.expectedVersion, actor: input.actor }); if (!command.ok) return command;
    if (command.value.replay) return coreOk(current.value);
    const next = fromDomain(waitForDeliberationResolution(current.value, { expectedVersion: input.expectedVersion, actor: input.actor }, this.clock));
    return next.ok ? this.commitCommand(current.value, next.value, command.value) : next;
  }

  resolve(input: ResolveDeliberationRoomInput): CoreResult<DeliberationRoom> {
    const current = this.require(input.projectId, input.roomId); if (!current.ok) return current;
    const command = this.command(current.value, input.commandId, "resolve", { expectedVersion: input.expectedVersion, actor: input.actor, kind: input.kind, publicReason: input.publicReason, ...(input.combinedText === undefined ? {} : { combinedText: input.combinedText }) }); if (!command.ok) return command;
    if (command.value.replay) return coreOk(current.value);
    const next = fromDomain(resolveDeliberationRoom(current.value, { expectedVersion: input.expectedVersion, actor: input.actor, kind: input.kind, publicReason: input.publicReason, ...(input.combinedText === undefined ? {} : { combinedText: input.combinedText }) }, { clock: this.clock, idFactory: this.idFactory }));
    return next.ok ? this.commitCommand(current.value, next.value, command.value) : next;
  }

  importManual(input: ImportManualExternalOpinionCoreInput): CoreResult<DeliberationRoom> {
    const current = this.require(input.projectId, input.roomId); if (!current.ok) return current;
    const command = this.command(current.value, input.commandId, "import_manual_opinion", { expectedVersion: input.expectedVersion, actor: input.actor, sourceLabel: input.sourceLabel, providerClaim: input.providerClaim, modelClaim: input.modelClaim, capturedAt: input.capturedAt, contextDisclosure: input.contextDisclosure, sawParticipantAOutput: input.sawParticipantAOutput, sawParticipantBOutput: input.sawParticipantBOutput, publicContent: input.publicContent }); if (!command.ok) return command;
    if (command.value.replay) return coreOk(current.value);
    const next = fromDomain(importManualExternalOpinion(current.value, input, { clock: this.clock, idFactory: this.idFactory }));
    return next.ok ? this.commitCommand(current.value, next.value, command.value) : next;
  }

  cancelActive(projectId: string, roomId: string): CoreResult<{ readonly cancelled: true }> {
    const active = this.#activeRuns.get(`${projectId}:${roomId}`) ?? this.#activeRuns.get(`${projectId}:${roomId}:challenge`) ?? this.#activeRuns.get(`${projectId}:${roomId}:retry`);
    if (active === undefined) return coreErr("not_found");
    active.controller.abort();
    return coreOk(Object.freeze({ cancelled: true as const }));
  }

  private async runInternal(input: RunDeliberationRoomBlindRoundInput, controller: AbortController): Promise<CoreResult<DeliberationRoom>> {
    const providers = this.validProviders(); if (!providers.ok) return providers;
    const current = this.require(input.projectId, input.roomId); if (!current.ok) return current;
    const freshness = this.refreshSourceBinding(current.value); if (!freshness.ok) return freshness;
    if (freshness.value.status === "stale_conflicted") return coreErr("stale_state");
    const command = this.command(current.value, input.commandId, "start_blind_round", { expectedVersion: input.expectedVersion, confirmedManifestHashes: input.confirmedManifestHashes, actor: input.actor }); if (!command.ok) return command;
    if (command.value.replay) return coreOk(current.value);
    if (current.value.status !== "awaiting_manifest_confirmation" || current.value.manifests === undefined) return coreErr("state_conflict");
    const rebuiltA = this.reconstruct(current.value, 0, providers.value[0]); if (!rebuiltA.ok) return rebuiltA;
    const rebuiltB = this.reconstruct(current.value, 1, providers.value[1]); if (!rebuiltB.ok) return rebuiltB;
    const started = fromDomain(startBlindDeliberationRound(current.value, { expectedVersion: input.expectedVersion, actor: input.actor, confirmedManifestHashes: input.confirmedManifestHashes }, { clock: this.clock, idFactory: this.idFactory }));
    if (!started.ok) return started;
    const storedStart = this.commitCommand(current.value, started.value, command.value);
    if (!storedStart.ok) return storedStart;
    const rebuilt = [rebuiltA.value, rebuiltB.value] as const;
    const outcomes = await Promise.all([
      this.invoke(providers.value[0], rebuilt[0], controller.signal),
      this.invoke(providers.value[1], rebuilt[1], controller.signal),
    ]);
    let persisted = storedStart.value;
    for (const index of [0, 1] as const) {
      const round = persisted.initialRound;
      if (round === undefined) return coreErr("infrastructure_failure");
      const attempt = round.attempts[index];
      const outcome = outcomes[index];
      let next: ReturnType<typeof completeDeliberationParticipant>;
      if (outcome.ok) {
        const parsed = submitDeliberationParticipantAssessment(rebuilt[index].request, outcome.value);
        next = parsed.ok
          ? completeDeliberationParticipant(persisted, { expectedVersion: persisted.version, roundId: round.id, participantId: persisted.participants[index].id, attemptId: attempt.id, assessment: parsed.value }, this.clock)
          : failDeliberationParticipant(persisted, { expectedVersion: persisted.version, roundId: round.id, participantId: persisted.participants[index].id, attemptId: attempt.id, failure: parsed.error.code === "limit_exceeded" ? "response_too_large" : "response_invalid" }, this.clock);
      } else if (outcome.failure === "cancelled_by_user") {
        next = cancelDeliberationParticipant(persisted, { expectedVersion: persisted.version, actor: input.actor, roundId: round.id, participantId: persisted.participants[index].id, attemptId: attempt.id }, this.clock);
      } else {
        next = failDeliberationParticipant(persisted, { expectedVersion: persisted.version, roundId: round.id, participantId: persisted.participants[index].id, attemptId: attempt.id, failure: outcome.failure }, this.clock);
      }
      if (!next.ok) return fromDomain(next);
      const eventCommand = this.command(persisted, `provider:${attempt.id}:terminal`, "participant_terminal", { attemptId: attempt.id, participantId: attempt.participantId, requestHash: attempt.requestHash, outcome });
      if (!eventCommand.ok) return eventCommand;
      if (eventCommand.value.replay) continue;
      const stored = this.commitCommand(persisted, next.value, eventCommand.value);
      if (!stored.ok) return stored;
      persisted = stored.value;
    }
    return coreOk(persisted);
  }

  private async runRetryInternal(input: RunDeliberationParticipantRetryCoreInput, controller: AbortController): Promise<CoreResult<DeliberationRoom>> {
    const providers = this.validProviders(); if (!providers.ok) return providers;
    const current = this.require(input.projectId, input.roomId); if (!current.ok) return current;
    const freshness = this.refreshSourceBinding(current.value); if (!freshness.ok) return freshness;
    if (freshness.value.status === "stale_conflicted") return coreErr("stale_state");
    const retry = current.value.retry;
    if (retry?.id !== input.retryId) return coreErr("not_found");
    const participantIndex = current.value.participants.findIndex((participant) => participant.id === retry.participantId);
    if (participantIndex !== 0 && participantIndex !== 1) return coreErr("state_conflict");
    const command = this.command(current.value, input.commandId, "start_participant_retry", { expectedVersion: input.expectedVersion, actor: input.actor, retryId: input.retryId, confirmedManifestHash: input.confirmedManifestHash }); if (!command.ok) return command;
    if (command.value.replay) return coreOk(current.value);
    const rebuilt = this.reconstructRetry(current.value, providers.value[participantIndex]); if (!rebuilt.ok) return rebuilt;
    const started = fromDomain(startDeliberationParticipantRetry(current.value, { expectedVersion: input.expectedVersion, actor: input.actor, retryId: input.retryId, confirmedManifestHash: input.confirmedManifestHash }, this.clock));
    if (!started.ok) return started;
    const storedStart = this.commitCommand(current.value, started.value, command.value); if (!storedStart.ok) return storedStart;
    const outcome = await this.invoke(providers.value[participantIndex], rebuilt.value, controller.signal);
    const activeRetry = storedStart.value.retry;
    if (activeRetry === undefined) return coreErr("infrastructure_failure");
    let next: ReturnType<typeof completeDeliberationParticipantRetry>;
    if (outcome.ok) {
      const parsed = submitDeliberationParticipantAssessment(rebuilt.value.request, outcome.value);
      next = parsed.ok
        ? completeDeliberationParticipantRetry(storedStart.value, { expectedVersion: storedStart.value.version, retryId: activeRetry.id, participantId: activeRetry.participantId, attemptId: activeRetry.attempt.id, assessment: parsed.value }, this.clock)
        : failDeliberationParticipantRetry(storedStart.value, { expectedVersion: storedStart.value.version, retryId: activeRetry.id, participantId: activeRetry.participantId, attemptId: activeRetry.attempt.id, failure: parsed.error.code === "limit_exceeded" ? "response_too_large" : "response_invalid" }, this.clock);
    } else {
      next = failDeliberationParticipantRetry(storedStart.value, { expectedVersion: storedStart.value.version, retryId: activeRetry.id, participantId: activeRetry.participantId, attemptId: activeRetry.attempt.id, failure: outcome.failure }, this.clock);
    }
    if (!next.ok) return fromDomain(next);
    const eventCommand = this.command(storedStart.value, `provider:${activeRetry.attempt.id}:terminal`, "participant_retry_terminal", { attemptId: activeRetry.attempt.id, participantId: activeRetry.participantId, requestHash: activeRetry.attempt.requestHash, outcome });
    if (!eventCommand.ok) return eventCommand;
    return eventCommand.value.replay ? coreOk(storedStart.value) : this.commitCommand(storedStart.value, next.value, eventCommand.value);
  }

  private async runChallengeInternal(input: RunDeliberationChallengeCoreInput, controller: AbortController): Promise<CoreResult<DeliberationRoom>> {
    const providers = this.validProviders(); if (!providers.ok) return providers;
    const current = this.require(input.projectId, input.roomId); if (!current.ok) return current;
    const freshness = this.refreshSourceBinding(current.value); if (!freshness.ok) return freshness;
    if (freshness.value.status === "stale_conflicted") return coreErr("stale_state");
    const challenge = current.value.challenge;
    if (challenge?.id !== input.challengeId) return coreErr("not_found");
    const command = this.command(current.value, input.commandId, "start_challenge", { expectedVersion: input.expectedVersion, actor: input.actor, challengeId: input.challengeId, confirmedManifestHashes: input.confirmedManifestHashes }); if (!command.ok) return command;
    if (command.value.replay) return coreOk(current.value);
    const rebuiltA = this.reconstructChallenge(current.value, 0, providers.value[0]); if (!rebuiltA.ok) return rebuiltA;
    const rebuiltB = this.reconstructChallenge(current.value, 1, providers.value[1]); if (!rebuiltB.ok) return rebuiltB;
    const started = fromDomain(startDeliberationChallenge(current.value, { expectedVersion: input.expectedVersion, actor: input.actor, challengeId: input.challengeId, confirmedManifestHashes: input.confirmedManifestHashes }, this.clock));
    if (!started.ok) return started;
    const storedStart = this.commitCommand(current.value, started.value, command.value); if (!storedStart.ok) return storedStart;
    const rebuilt = [rebuiltA.value, rebuiltB.value] as const;
    const outcomes = await Promise.all([
      this.invoke(providers.value[0], rebuilt[0], controller.signal),
      this.invoke(providers.value[1], rebuilt[1], controller.signal),
    ]);
    let persisted = storedStart.value;
    for (const index of [0, 1] as const) {
      const activeChallenge = persisted.challenge;
      if (activeChallenge === undefined) return coreErr("infrastructure_failure");
      const attempt = activeChallenge.attempts[index];
      const outcome = outcomes[index];
      let next: ReturnType<typeof completeDeliberationChallenge>;
      if (outcome.ok) {
        const parsed = submitDeliberationParticipantAssessment(rebuilt[index].request, outcome.value);
        next = parsed.ok
          ? completeDeliberationChallenge(persisted, { expectedVersion: persisted.version, challengeId: activeChallenge.id, participantId: attempt.participantId, attemptId: attempt.id, assessment: parsed.value }, this.clock)
          : failDeliberationChallenge(persisted, { expectedVersion: persisted.version, challengeId: activeChallenge.id, participantId: attempt.participantId, attemptId: attempt.id, failure: parsed.error.code === "limit_exceeded" ? "response_too_large" : "response_invalid" }, this.clock);
      } else {
        next = failDeliberationChallenge(persisted, { expectedVersion: persisted.version, challengeId: activeChallenge.id, participantId: attempt.participantId, attemptId: attempt.id, failure: outcome.failure }, this.clock);
      }
      if (!next.ok) return fromDomain(next);
      const eventCommand = this.command(persisted, `provider:${attempt.id}:terminal`, "challenge_terminal", { attemptId: attempt.id, participantId: attempt.participantId, requestHash: attempt.requestHash, outcome });
      if (!eventCommand.ok) return eventCommand;
      if (eventCommand.value.replay) continue;
      const stored = this.commitCommand(persisted, next.value, eventCommand.value); if (!stored.ok) return stored;
      persisted = stored.value;
    }
    return coreOk(persisted);
  }

  private async invoke(provider: DeliberationParticipantProvider, rebuilt: RebuiltParticipant, parentSignal: AbortSignal): Promise<{ readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly failure: DeliberationParticipantFailure }> {
    const controller = new AbortController();
    const abort = () => { controller.abort(); };
    parentSignal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => { controller.abort(PROVIDER_TIMEOUT_REASON); }, Math.min(this.timeoutMs, MAX_PROVIDER_TIMEOUT_MS));
    try {
      const value = await provider.analyze(rebuilt.request, rebuilt.preview, { signal: controller.signal });
      if (controller.signal.aborted) return { ok: false, failure: controller.signal.reason === PROVIDER_TIMEOUT_REASON ? "provider_timeout" : "cancelled_by_user" };
      return { ok: true, value };
    } catch (error) {
      return { ok: false, failure: parentSignal.aborted ? "cancelled_by_user" : normalizedFailure(error, controller.signal.reason === PROVIDER_TIMEOUT_REASON) };
    } finally {
      clearTimeout(timer);
      parentSignal.removeEventListener("abort", abort);
    }
  }

  private validProviders(): CoreResult<readonly [DeliberationParticipantProvider, DeliberationParticipantProvider]> {
    const providers: readonly DeliberationParticipantProvider[] | undefined = this.providers;
    if (providers?.length !== 2) return coreErr("review_blocked");
    const [a, b] = providers;
    if (a === undefined || b === undefined || !validProvider(a) || !validProvider(b)) return coreErr("review_blocked");
    if (a.connectionId === b.connectionId || a.runtimeIdentityHash === b.runtimeIdentityHash || a.endpointIdentityHash === b.endpointIdentityHash || a.secretRefHash === b.secretRefHash) return coreErr("review_blocked");
    return coreOk(Object.freeze([a, b] as const));
  }

  private providerState(): { readonly readiness: DeliberationProviderReadiness; readonly providers?: readonly [DeliberationParticipantProvider, DeliberationParticipantProvider] } {
    const providers: readonly DeliberationParticipantProvider[] | undefined = this.providers;
    if (providers?.length !== 2) return Object.freeze({ readiness: "blocked_missing_provider" as const });
    const [a, b] = providers;
    if (a === undefined || b === undefined || !validProvider(a) || !validProvider(b)) return Object.freeze({ readiness: "blocked_missing_provider" as const });
    const readiness: DeliberationProviderReadiness = a.connectionId === b.connectionId || a.runtimeIdentityHash === b.runtimeIdentityHash || a.endpointIdentityHash === b.endpointIdentityHash || a.secretRefHash === b.secretRefHash
      ? "same_runtime_not_mutually_independent"
      : "configured_distinct";
    return Object.freeze({ readiness, providers: Object.freeze([a, b] as const) });
  }

  private sourceBinding(input: CreateDeliberationRoomInput): CoreResult<DeliberationSourceBinding> {
    if (!parseResearchIdFor(input.projectId, "rprj_").ok || !parseResearchId(input.sourceObjectId).ok) return coreErr("invalid_input");
    let version: number | undefined;
    switch (input.sourceKind) {
      case "research_issue": {
        const item = fromDomain(this.store.issues.getById(input.projectId, input.sourceObjectId)); if (!item.ok) return item;
        if (item.value === undefined) return coreErr("not_found");
        if (!["open", "acknowledged", "disputed", "reopened"].includes(item.value.status)) return coreErr("state_conflict");
        version = item.value.version; break;
      }
      case "research_decision": {
        const item = fromDomain(this.store.decisions.getById(input.projectId, input.sourceObjectId)); if (!item.ok) return item;
        if (item.value === undefined) return coreErr("not_found");
        version = item.value.version; break;
      }
      case "research_brief": {
        const item = fromDomain(this.store.briefs.getById(input.projectId, input.sourceObjectId)); if (!item.ok) return item;
        if (item.value === undefined) return coreErr("not_found");
        const active = getActiveResearchBriefVersion(item.value); if (active === undefined) return coreErr("state_conflict");
        version = active.versionNumber; break;
      }
      case "correction_appeal": {
        const item = fromDomain(this.store.correctionAppeals.getById(input.projectId, input.sourceObjectId)); if (!item.ok) return item;
        if (item.value === undefined) return coreErr("not_found");
        if (item.value.status === "resolved") return coreErr("state_conflict");
        version = item.value.version; break;
      }
      case "unresolved_conflict":
      case "explicit_project_object": {
        const prefix = parseResearchId(input.sourceObjectId); if (!prefix.ok) return coreErr("invalid_input");
        if (prefix.value.prefix === "riss_") {
          const item = fromDomain(this.store.issues.getById(input.projectId, input.sourceObjectId)); if (!item.ok || item.value === undefined) return item.ok ? coreErr("not_found") : item;
          version = item.value.version;
        } else if (prefix.value.prefix === "rdec_") {
          const item = fromDomain(this.store.decisions.getById(input.projectId, input.sourceObjectId)); if (!item.ok || item.value === undefined) return item.ok ? coreErr("not_found") : item;
          version = item.value.version;
        } else if (prefix.value.prefix === "rapl_") {
          const item = fromDomain(this.store.correctionAppeals.getById(input.projectId, input.sourceObjectId)); if (!item.ok || item.value === undefined) return item.ok ? coreErr("not_found") : item;
          version = item.value.version;
        } else {
          return coreErr("invalid_input");
        }
        break;
      }
      default: return coreErr("invalid_input");
    }
    const base = { kind: input.sourceKind, objectId: input.sourceObjectId, objectVersion: version, question: input.question.trim() };
    const hashed = stableResearchHash(base); if (!hashed.ok) return coreErr("infrastructure_failure");
    return coreOk(Object.freeze({ projectId: input.projectId, ...base, objectVersion: version, sourceHash: hashed.value }));
  }

  private refreshSourceBinding(room: DeliberationRoom): CoreResult<DeliberationRoom> {
    if (["resolved", "closed", "stale_conflicted"].includes(room.status)) return coreOk(room);
    const rebound = this.sourceBinding({
      projectId: room.projectId,
      sourceKind: room.source.kind,
      sourceObjectId: room.source.objectId,
      question: room.source.question,
      title: room.title,
      actor: { kind: "system", component: "ri50-source-freshness" },
    });
    if (rebound.ok && rebound.value.objectVersion === room.source.objectVersion && rebound.value.sourceHash === room.source.sourceHash) return coreOk(room);
    const reason = rebound.ok ? `source_version_changed:${room.source.objectVersion}->${rebound.value.objectVersion}` : "source_unavailable_or_no_longer_actionable";
    const next = fromDomain(markDeliberationRoomStale(room, { expectedVersion: room.version, reason }, this.clock)); if (!next.ok) return next;
    const command = this.command(room, `kernel:source-stale:${room.id}:${room.version}`, "mark_source_stale", { roomId: room.id, sourceHash: room.source.sourceHash, reason }); if (!command.ok) return command;
    return this.commitCommand(room, next.value, command.value);
  }

  private requestsFor(room: DeliberationRoom, roundId: string, stateBindingHash: string, revision: { readonly id: string; readonly projectId: string; readonly artifactId: string; readonly inlineContent?: string }, allowedContext: readonly DeliberationAllowedContextObject[], comparisonDimensions: readonly DeliberationComparisonDimension[]): CoreResult<readonly [DeliberationParticipantRequest, DeliberationParticipantRequest]> {
    if (revision.inlineContent === undefined) return coreErr("review_blocked");
    const requests: DeliberationParticipantRequest[] = [];
    for (const participant of room.participants) {
      const request = prepareDeliberationParticipantRequest({ roomId: room.id, roundId, projectId: room.projectId, participant, source: room.source, stateBindingHash, question: room.source.question, comparisonDimensions, frozenInput: { projectId: room.projectId, artifactId: revision.artifactId, revisionId: revision.id, text: revision.inlineContent }, allowedContext });
      if (!request.ok) return coreErr("review_blocked");
      requests.push(request.value);
    }
    return coreOk(Object.freeze(requests) as unknown as readonly [DeliberationParticipantRequest, DeliberationParticipantRequest]);
  }

  private buildRetryRequest(room: DeliberationRoom, index: 0 | 1, retryId: string, provider: DeliberationParticipantProvider): CoreResult<{ readonly request: DeliberationParticipantRequest; readonly preview: DeliberationParticipantProviderInput; readonly manifest: DeliberationContextManifest }> {
    const baseManifest = room.manifests?.[index];
    if (baseManifest === undefined || room.frozenContext === undefined || !providerMatches(room.participants[index], provider)) return coreErr("state_conflict");
    const revisionObject = baseManifest.includedObjects.find((item) => item.kind === "revision");
    const artifactId = revisionObject?.fields.artifactId;
    if (revisionObject === undefined || artifactId === undefined || !parseResearchIdFor(artifactId, "rart_").ok) return coreErr("stale_state");
    const revision = fromDomain(this.store.revisions.getById(room.projectId, artifactId, revisionObject.id));
    if (!revision.ok) return revision;
    if (revision.value?.inlineContent === undefined) return coreErr("review_blocked");
    const request = prepareDeliberationParticipantRequest({ roomId: room.id, roundId: retryId, projectId: room.projectId, participant: room.participants[index], source: room.source, stateBindingHash: room.frozenContext.stateBindingHash, question: room.source.question, comparisonDimensions: room.frozenContext.comparisonDimensions, frozenInput: { projectId: room.projectId, artifactId, revisionId: revision.value.id, text: revision.value.inlineContent }, allowedContext: baseManifest.includedObjects });
    if (!request.ok) return coreErr("review_blocked");
    let preview: DeliberationParticipantProviderInput;
    try { preview = provider.prepare(request.value); } catch { return coreErr("review_blocked"); }
    if (!validatePreview(request.value, preview, provider)) return coreErr("review_blocked");
    const generated = createDeliberationContextManifest(request.value); if (!generated.ok) return coreErr("review_blocked");
    const { canonicalHash, ...manifestBase } = { ...generated.value, requestBodyHash: preview.requestBodyHash };
    if (!sha(canonicalHash)) return coreErr("review_blocked");
    const canonical = stableResearchHash(manifestBase); if (!canonical.ok) return coreErr("infrastructure_failure");
    return coreOk(Object.freeze({ request: request.value, preview, manifest: Object.freeze({ ...manifestBase, canonicalHash: canonical.value }) }));
  }

  private reconstructRetry(room: DeliberationRoom, provider: DeliberationParticipantProvider): CoreResult<RebuiltParticipant> {
    const retry = room.retry;
    if (retry === undefined) return coreErr("state_conflict");
    const index = room.participants.findIndex((participant) => participant.id === retry.participantId);
    if (index !== 0 && index !== 1) return coreErr("state_conflict");
    const built = this.buildRetryRequest(room, index, retry.id, provider); if (!built.ok) return built;
    if (built.value.request.requestHash !== retry.attempt.requestHash || built.value.preview.requestBodyHash !== retry.manifest.requestBodyHash || built.value.manifest.canonicalHash !== retry.manifest.canonicalHash) return coreErr("stale_state");
    return coreOk(Object.freeze({ request: built.value.request, preview: built.value.preview }));
  }

  private preparedRetryProjection(room: DeliberationRoom): CoreResult<PreparedDeliberationParticipantRetry> {
    const providers = this.validProviders(); if (!providers.ok) return providers;
    const retry = room.retry; if (retry === undefined) return coreErr("state_conflict");
    const index = room.participants.findIndex((participant) => participant.id === retry.participantId);
    if (index !== 0 && index !== 1) return coreErr("state_conflict");
    const rebuilt = this.reconstructRetry(room, providers.value[index]); if (!rebuilt.ok) return rebuilt;
    return this.retryProjection(room, rebuilt.value.request, rebuilt.value.preview);
  }

  private retryProjection(room: DeliberationRoom, request: DeliberationParticipantRequest, preview: DeliberationParticipantProviderInput): CoreResult<PreparedDeliberationParticipantRetry> {
    if (room.retry === undefined) return coreErr("state_conflict");
    return coreOk(Object.freeze({ contextManifestVisible: true as const, room, manifest: room.retry.manifest, request, providerPreview: Object.freeze({ endpoint: preview.endpoint, requestBodyBytes: preview.requestBodyBytes, responseLimitBytes: preview.responseLimitBytes, retryCount: 0 as const, redirectPolicy: "error" as const }) }));
  }

  private buildChallengeRequests(room: DeliberationRoom, question: string, challengeId: string, providers: readonly [DeliberationParticipantProvider, DeliberationParticipantProvider]): CoreResult<{ readonly requests: readonly [DeliberationParticipantRequest, DeliberationParticipantRequest]; readonly previews: readonly [DeliberationParticipantProviderInput, DeliberationParticipantProviderInput]; readonly manifests: readonly [DeliberationContextManifest, DeliberationContextManifest]; readonly sharedContextHash: string }> {
    if (room.initialRound === undefined || room.frozenContext === undefined || room.differenceSummary === undefined || room.manifests === undefined) return coreErr("state_conflict");
    const differenceFields = { categories: JSON.stringify(room.differenceSummary.categories), canonicalHash: room.differenceSummary.canonicalHash };
    if (Object.values(differenceFields).some((value) => !nonBlank(value, 16_384))) return coreErr("review_blocked");
    const differenceBase = { kind: "difference_summary" as const, id: room.id, version: room.version, fields: differenceFields };
    const differenceHash = stableResearchHash(differenceBase); if (!differenceHash.ok) return coreErr("infrastructure_failure");
    const requests: DeliberationParticipantRequest[] = [];
    const sharedContextByParticipant: DeliberationAllowedContextObject[][] = [];
    for (const targetIndex of [0, 1] as const) {
      const peerIndex: 0 | 1 = targetIndex === 0 ? 1 : 0;
      const peerAssessment = room.initialRound.attempts[peerIndex].assessment;
      if (peerAssessment === undefined) return coreErr("state_conflict");
      const revisionObject = room.manifests[targetIndex].includedObjects.find((item) => item.kind === "revision");
      const artifactId = revisionObject?.fields.artifactId;
      if (revisionObject === undefined || artifactId === undefined || !parseResearchIdFor(artifactId, "rart_").ok) return coreErr("stale_state");
      const revision = fromDomain(this.store.revisions.getById(room.projectId, artifactId, revisionObject.id));
      if (!revision.ok) return revision;
      if (revision.value?.inlineContent === undefined) return coreErr("review_blocked");
      const assessmentFields = {
        directAnswer: peerAssessment.directAnswer,
        dimensions: JSON.stringify(peerAssessment.dimensions),
        claims: JSON.stringify(peerAssessment.claims),
        evidenceSpans: JSON.stringify(peerAssessment.evidenceSpans),
        assumptions: JSON.stringify(peerAssessment.assumptions),
        scope: peerAssessment.scope,
        counterexamples: JSON.stringify(peerAssessment.counterexamples),
        alternativeExplanations: JSON.stringify(peerAssessment.alternativeExplanations),
        unknowns: JSON.stringify(peerAssessment.unknowns),
        nextDiscriminatingEvidence: JSON.stringify(peerAssessment.nextDiscriminatingEvidence),
        missingContext: JSON.stringify(peerAssessment.missingContext),
        uncertaintySources: JSON.stringify(peerAssessment.uncertaintySources),
        publicRationale: peerAssessment.publicRationale,
        proposedNextStep: peerAssessment.proposedNextStep,
      };
      if (Object.values(assessmentFields).some((value) => !nonBlank(value, 16_384))) return coreErr("review_blocked");
      const assessmentBase = { kind: "participant_assessment" as const, id: peerAssessment.participantId, version: 1, fields: assessmentFields };
      const assessmentHash = stableResearchHash(assessmentBase); if (!assessmentHash.ok) return coreErr("infrastructure_failure");
      const sharedObjects: DeliberationAllowedContextObject[] = [
        Object.freeze({ ...assessmentBase, hash: assessmentHash.value }),
        Object.freeze({ ...differenceBase, hash: differenceHash.value }),
      ];
      sharedContextByParticipant.push(sharedObjects);
      const allowedContext = [...room.manifests[targetIndex].includedObjects.filter((item) => item.kind !== "participant_assessment" && item.kind !== "difference_summary"), ...sharedObjects];
      const request = prepareDeliberationParticipantRequest({ roomId: room.id, roundId: challengeId, projectId: room.projectId, participant: room.participants[targetIndex], source: room.source, stateBindingHash: room.frozenContext.stateBindingHash, question, comparisonDimensions: room.frozenContext.comparisonDimensions, frozenInput: { projectId: room.projectId, artifactId, revisionId: revision.value.id, text: revision.value.inlineContent }, allowedContext });
      if (!request.ok) return coreErr("review_blocked");
      requests.push(request.value);
    }
    const requestPair = Object.freeze(requests) as unknown as readonly [DeliberationParticipantRequest, DeliberationParticipantRequest];
    let previews: readonly [DeliberationParticipantProviderInput, DeliberationParticipantProviderInput];
    try { previews = [providers[0].prepare(requestPair[0]), providers[1].prepare(requestPair[1])]; } catch { return coreErr("review_blocked"); }
    if (!validatePreview(requestPair[0], previews[0], providers[0]) || !validatePreview(requestPair[1], previews[1], providers[1])) return coreErr("review_blocked");
    const manifests: DeliberationContextManifest[] = [];
    for (const index of [0, 1] as const) {
      const generated = createDeliberationContextManifest(requestPair[index]); if (!generated.ok) return coreErr("review_blocked");
      const { canonicalHash, ...manifestBase } = { ...generated.value, requestBodyHash: previews[index].requestBodyHash };
      if (!sha(canonicalHash)) return coreErr("review_blocked");
      const canonical = stableResearchHash(manifestBase); if (!canonical.ok) return coreErr("infrastructure_failure");
      manifests.push(Object.freeze({ ...manifestBase, canonicalHash: canonical.value }));
    }
    const sharedContext = stableResearchHash(sharedContextByParticipant); if (!sharedContext.ok) return coreErr("infrastructure_failure");
    return coreOk(Object.freeze({ requests: requestPair, previews, manifests: Object.freeze(manifests) as unknown as readonly [DeliberationContextManifest, DeliberationContextManifest], sharedContextHash: sharedContext.value }));
  }

  private reconstructChallenge(room: DeliberationRoom, index: 0 | 1, provider: DeliberationParticipantProvider): CoreResult<RebuiltParticipant> {
    const challenge = room.challenge;
    if (challenge === undefined || room.frozenContext === undefined || !providerMatches(room.participants[index], provider)) return coreErr("state_conflict");
    const manifest = challenge.manifests[index];
    const revisionObject = manifest.includedObjects.find((item) => item.kind === "revision");
    const artifactId = revisionObject?.fields.artifactId;
    if (revisionObject === undefined || artifactId === undefined || !parseResearchIdFor(artifactId, "rart_").ok) return coreErr("stale_state");
    const revision = fromDomain(this.store.revisions.getById(room.projectId, artifactId, revisionObject.id));
    if (!revision.ok) return revision;
    if (revision.value?.inlineContent === undefined) return coreErr("review_blocked");
    const request = prepareDeliberationParticipantRequest({ roomId: room.id, roundId: challenge.id, projectId: room.projectId, participant: room.participants[index], source: room.source, stateBindingHash: manifest.stateBindingHash, question: challenge.question, comparisonDimensions: room.frozenContext.comparisonDimensions, frozenInput: { projectId: room.projectId, artifactId, revisionId: revision.value.id, text: revision.value.inlineContent }, allowedContext: manifest.includedObjects });
    if (!request.ok || request.value.requestHash !== challenge.attempts[index].requestHash) return coreErr("stale_state");
    let preview: DeliberationParticipantProviderInput;
    try { preview = provider.prepare(request.value); } catch { return coreErr("review_blocked"); }
    if (!validatePreview(request.value, preview, provider) || preview.requestBodyHash !== manifest.requestBodyHash) return coreErr("stale_state");
    return coreOk(Object.freeze({ request: request.value, preview }));
  }

  private preparedChallengeProjection(room: DeliberationRoom): CoreResult<PreparedDeliberationChallenge> {
    const providers = this.validProviders(); if (!providers.ok) return providers;
    const a = this.reconstructChallenge(room, 0, providers.value[0]); if (!a.ok) return a;
    const b = this.reconstructChallenge(room, 1, providers.value[1]); if (!b.ok) return b;
    return this.challengeProjection(room, [a.value.request, b.value.request], [a.value.preview, b.value.preview]);
  }

  private challengeProjection(room: DeliberationRoom, requests: readonly [DeliberationParticipantRequest, DeliberationParticipantRequest], previews: readonly [DeliberationParticipantProviderInput, DeliberationParticipantProviderInput]): CoreResult<PreparedDeliberationChallenge> {
    if (room.challenge === undefined) return coreErr("state_conflict");
    return coreOk(Object.freeze({ contextManifestVisible: true as const, sharedContextOnly: true as const, room, manifests: room.challenge.manifests, requests, providerPreviews: previews.map((preview) => Object.freeze({ endpoint: preview.endpoint, requestBodyBytes: preview.requestBodyBytes, responseLimitBytes: preview.responseLimitBytes, retryCount: 0 as const, redirectPolicy: "error" as const })) as unknown as PreparedDeliberationChallenge["providerPreviews"] }));
  }

  private frozenContext(question: string, state: ResearchRoomState, allowed: readonly DeliberationAllowedContextObject[], allowedEvidenceIds: readonly string[], comparisonDimensions: readonly DeliberationComparisonDimension[], stopConditions: readonly string[], stateBindingHash: string): CoreResult<DeliberationFrozenContext> {
    const briefHash = stableResearchHash({ briefId: state.brief.id, versionId: state.brief.versionId, versionNumber: state.brief.versionNumber, projectQuestion: state.brief.projectQuestion, currentStage: state.brief.currentStage, currentTask: state.brief.currentTask });
    if (!briefHash.ok) return coreErr("infrastructure_failure");
    const retainedDecisions = allowed.filter((item) => item.kind === "decision").map((item) => Object.freeze({ id: item.id, version: item.version, hash: item.hash })).sort((left, right) => left.id.localeCompare(right.id));
    const evidence = collectPages((page) => this.store.argumentEvidence.listByProject(state.project.id, page));
    if (!evidence.ok) return evidence;
    const allowedSet = new Set(allowedEvidenceIds);
    const excludedEvidenceIds = evidence.value.map((item) => item.id).filter((id) => !allowedSet.has(id)).sort();
    const base = {
      schemaVersion: "1.0.0" as const,
      question,
      brief: { briefId: state.brief.id, versionId: state.brief.versionId, versionNumber: state.brief.versionNumber, hash: briefHash.value },
      retainedDecisions,
      allowedEvidenceIds: [...allowedEvidenceIds].sort(),
      excludedEvidenceIds,
      comparisonDimensions: comparisonDimensions.map((item) => Object.freeze({ id: item.id, label: item.label.trim() })),
      stopConditions: stopConditions.map((item) => item.trim()),
      budget: { participants: 2 as const, blindInitialRounds: 1 as const, directedChallengeRounds: 1 as const, maximumProviderCalls: 4 as const, automaticRetries: 0 as const, synthesisProviders: 0 as const },
      stateBindingHash,
    };
    const canonical = stableResearchHash(base);
    return canonical.ok ? coreOk(Object.freeze({ ...base, canonicalHash: canonical.value })) : coreErr("infrastructure_failure");
  }

  private manifestsFor(requests: readonly [DeliberationParticipantRequest, DeliberationParticipantRequest], previews: readonly [DeliberationParticipantProviderInput, DeliberationParticipantProviderInput]): CoreResult<readonly [DeliberationContextManifest, DeliberationContextManifest]> {
    const manifests: DeliberationContextManifest[] = [];
    for (const index of [0, 1] as const) {
      const generated = createDeliberationContextManifest(requests[index]);
      if (!generated.ok) return coreErr("review_blocked");
      const withoutCanonical = { ...generated.value, requestBodyHash: previews[index].requestBodyHash };
      const { canonicalHash, ...canonicalInput } = withoutCanonical;
      if (!sha(canonicalHash)) return coreErr("review_blocked");
      const canonical = stableResearchHash(canonicalInput);
      if (!canonical.ok) return coreErr("infrastructure_failure");
      manifests.push(Object.freeze({ ...canonicalInput, canonicalHash: canonical.value }));
    }
    return coreOk(Object.freeze(manifests) as unknown as readonly [DeliberationContextManifest, DeliberationContextManifest]);
  }

  private allowedObjects(state: ResearchRoomState, revision: { readonly id: string; readonly artifactId: string; readonly content: { readonly contentHash: string; readonly mediaType: string } }, selection: { readonly includeBrief: boolean; readonly decisionIds: readonly string[]; readonly issueIds: readonly string[]; readonly evidenceIds: readonly string[] }): CoreResult<readonly DeliberationAllowedContextObject[]> {
    const values: DeliberationAllowedContextObject[] = [];
    const add = (kind: DeliberationAllowedContextObject["kind"], id: string, version: number, fields: Readonly<Record<string, string>>): CoreResult<void> => {
      const calculated = stableResearchHash({ kind, id, version, fields });
      if (!calculated.ok) return coreErr("infrastructure_failure");
      values.push(Object.freeze({ kind, id, version, hash: calculated.value, fields: Object.freeze({ ...fields }) }));
      return coreOk(undefined);
    };
    if (selection.includeBrief) {
      const result = add("brief", state.brief.versionId, state.brief.versionNumber, { projectQuestion: state.brief.projectQuestion, currentStage: state.brief.currentStage, currentTask: state.brief.currentTask }); if (!result.ok) return result;
    }
    for (const id of selection.decisionIds) {
      const item = state.decisions.find((value) => value.id === id); if (item === undefined) return coreErr("not_found");
      const result = add("decision", item.id, item.version, { statement: item.statement, rationale: item.rationale, status: item.status }); if (!result.ok) return result;
    }
    for (const id of selection.issueIds) {
      const item = state.issues.find((value) => value.id === id); if (item === undefined) return coreErr("not_found");
      const result = add("issue", item.id, item.version, { summary: item.summary, issueKind: item.kind, status: item.status }); if (!result.ok) return result;
    }
    for (const id of selection.evidenceIds) {
      if (!parseResearchIdFor(id, "revd_").ok) return coreErr("invalid_input");
      const stored = fromDomain(this.store.argumentEvidence.getById(state.project.id, id)); if (!stored.ok) return stored;
      if (stored.value === undefined) return coreErr("not_found");
      const result = add("evidence", stored.value.id, stored.value.version, { summary: stored.value.summary, evidenceKind: stored.value.kind, state: stored.value.state, inferenceCapacity: stored.value.inferenceCapacity }); if (!result.ok) return result;
    }
    const revisionResult = add("revision", revision.id, 1, { artifactId: revision.artifactId, contentHash: revision.content.contentHash, mediaType: revision.content.mediaType }); if (!revisionResult.ok) return revisionResult;
    values.sort((left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
    return coreOk(Object.freeze(values));
  }

  private findRevision(projectId: string, revisionId: string): CoreResult<{ readonly id: string; readonly projectId: string; readonly artifactId: string; readonly inlineContent?: string; readonly content: { readonly contentHash: string; readonly mediaType: string } }> {
    const artifacts = collectPages((page) => this.store.artifacts.listByProject(projectId, page)); if (!artifacts.ok) return artifacts;
    for (const artifact of artifacts.value) {
      const revision = fromDomain(this.store.revisions.getById(projectId, artifact.id, revisionId));
      if (!revision.ok) return revision;
      if (revision.value !== undefined) return coreOk(revision.value);
    }
    return coreErr("not_found");
  }

  private reconstruct(room: DeliberationRoom, index: 0 | 1, provider: DeliberationParticipantProvider): CoreResult<RebuiltParticipant> {
    const manifest = room.manifests?.[index];
    if (manifest === undefined || room.frozenContext === undefined || !providerMatches(room.participants[index], provider)) return coreErr("review_blocked");
    const revisionObject = manifest.includedObjects.find((item) => item.kind === "revision");
    const artifactId = revisionObject?.fields.artifactId;
    if (revisionObject === undefined || artifactId === undefined || !parseResearchIdFor(artifactId, "rart_").ok) return coreErr("stale_state");
    const revision = fromDomain(this.store.revisions.getById(room.projectId, artifactId, revisionObject.id));
    if (!revision.ok) return revision;
    if (revision.value?.inlineContent === undefined) return coreErr("review_blocked");
    const request = prepareDeliberationParticipantRequest({ roomId: room.id, roundId: manifest.roundId, projectId: room.projectId, participant: room.participants[index], source: room.source, stateBindingHash: manifest.stateBindingHash, question: room.source.question, comparisonDimensions: room.frozenContext.comparisonDimensions, frozenInput: { projectId: room.projectId, artifactId, revisionId: revisionObject.id, text: revision.value.inlineContent }, allowedContext: manifest.includedObjects });
    if (!request.ok || request.value.requestHash !== manifest.requestHash) return coreErr("stale_state");
    let preview: DeliberationParticipantProviderInput;
    try { preview = provider.prepare(request.value); } catch { return coreErr("review_blocked"); }
    if (!validatePreview(request.value, preview, provider) || preview.requestBodyHash !== manifest.requestBodyHash) return coreErr("stale_state");
    return coreOk(Object.freeze({ request: request.value, preview }));
  }

  private preparedProjection(room: DeliberationRoom): CoreResult<PreparedDeliberationRoom> {
    const providers = this.validProviders(); if (!providers.ok) return providers;
    if (room.manifests === undefined) return coreErr("state_conflict");
    const a = this.reconstruct(room, 0, providers.value[0]); if (!a.ok) return a;
    const b = this.reconstruct(room, 1, providers.value[1]); if (!b.ok) return b;
    return this.projection(room, [a.value.request, b.value.request], [a.value.preview, b.value.preview]);
  }

  private command(room: DeliberationRoom, explicitId: string | undefined, kind: string, payload: unknown): CoreResult<RoomCommand> {
    const hashed = stableResearchHash(payload);
    if (!hashed.ok) return coreErr("infrastructure_failure");
    const commandId = explicitId ?? `implicit:${kind}:${hashed.value.slice(0, 40)}`;
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(commandId)) return coreErr("invalid_input");
    const inspected = fromDomain(inspectDeliberationCommand(room, { commandId, kind, payloadHash: hashed.value }));
    if (!inspected.ok) return inspected;
    return coreOk(Object.freeze({ commandId, kind, payloadHash: hashed.value, replay: inspected.value === "replay" }));
  }

  private commitCommand(current: DeliberationRoom, next: DeliberationRoom, command: RoomCommand): CoreResult<DeliberationRoom> {
    const recorded = fromDomain(recordDeliberationCommand(next, command, this.clock));
    return recorded.ok ? fromDomain(this.store.deliberationRooms.compareAndSwap(recorded.value, current.version)) : recorded;
  }

  private projection(room: DeliberationRoom, requests: readonly [DeliberationParticipantRequest, DeliberationParticipantRequest], previews: readonly [DeliberationParticipantProviderInput, DeliberationParticipantProviderInput]): CoreResult<PreparedDeliberationRoom> {
    if (room.manifests === undefined) return coreErr("state_conflict");
    return coreOk(Object.freeze({
      contextManifestsVisible: true as const,
      room,
      manifests: room.manifests,
      requests,
      providerPreviews: previews.map((item) => Object.freeze({ endpoint: item.endpoint, requestBodyBytes: item.requestBodyBytes, responseLimitBytes: item.responseLimitBytes, retryCount: 0 as const, redirectPolicy: "error" as const })) as unknown as PreparedDeliberationRoom["providerPreviews"],
    }));
  }

  private require(projectId: string, roomId: string): CoreResult<DeliberationRoom> {
    const found = this.get(projectId, roomId);
    if (!found.ok) return found;
    return found.value === undefined ? coreErr("not_found") : coreOk(found.value);
  }
}
