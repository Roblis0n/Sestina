import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { type ResearchActor } from "@sestina/research";
import {
  createStableTextSpan,
  type DeliberationParticipantRequest,
  type DeliberationParticipantResponse,
} from "@sestina/review";
import {
  openSestina,
  type DeliberationParticipantProvider,
  type DeliberationParticipantProviderInput,
  type SestinaCore,
} from "../src/index.js";

const USER: ResearchActor = { kind: "user", actorId: "research-owner" };
const roots: string[] = [];
const cores: SestinaCore[] = [];

function valueOf<T>(result: { ok: true; value: T } | { ok: false; error: { code: string } }): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

function sha(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function response(request: DeliberationParticipantRequest): DeliberationParticipantResponse {
  const span = createStableTextSpan(request.context.frozenInput, 0, request.context.frozenInput.normalizedText.length);
  if (!span.ok) throw new Error(span.error.code);
  const a = request.participant.slot === "a";
  return {
    schemaVersion: "1.0.0",
    protocolVersion: request.protocol.version,
    protocolHash: request.protocol.hash,
    promptVersion: request.prompt.version,
    promptHash: request.prompt.hash,
    schemaVersionHash: request.responseSchemaHash,
    rubricVersion: request.rubric.version,
    rubricHash: request.rubric.hash,
    roomId: request.roomId,
    roundId: request.roundId,
    projectId: request.projectId,
    participantId: request.participant.id,
    participantSlot: request.participant.slot,
    participantSnapshotHash: request.participantSnapshotHash,
    requestHash: request.requestHash,
    inputHash: request.context.frozenInput.normalizedTextHash,
    assessment: a ? "support" : "mixed",
    directAnswer: a ? "Retain only a qualified association." : "Request an identification strategy before retaining causal language.",
    dimensions: request.context.comparisonDimensions.map((item) => ({ dimensionId: item.id, position: a ? "qualify" as const : "challenge" as const, summary: a ? `Bounded support on ${item.label}.` : `Challenge on ${item.label}.`, evidenceSpanIds: [a ? "a-span" : "b-span"] })),
    claims: [{ claimId: a ? "a-claim" : "b-claim", stance: a ? "qualify" : "challenge", text: a ? "The association remains reportable with a limitation." : "Causality is not identified by this design.", evidenceSpanIds: [a ? "a-span" : "b-span"] }],
    evidenceSpans: [{ spanId: a ? "a-span" : "b-span", ...span.value }],
    assumptions: [a ? "Reporting an association is the bounded target." : "The requested target is a causal interpretation."],
    scope: a ? "Reporting language" : "Causal identification",
    counterexamples: a ? [] : ["Stable associations can remain confounded."],
    alternativeExplanations: a ? ["Residual confounding"] : ["Selection bias", "Residual confounding"],
    unknowns: ["The causal mechanism remains unknown."],
    nextDiscriminatingEvidence: a ? ["Preregistered replication"] : ["A credible identification strategy"],
    missingContext: a ? [] : ["Identification strategy"],
    uncertaintySources: ["Synthetic fixture context"],
    publicRationale: a ? "The text supports association but explicitly limits causality." : "The design cannot establish causality or a mechanism.",
    proposedNextStep: a ? "Narrow the claim." : "Request design evidence.",
  };
}

interface Coordinator {
  prepared: Set<"a" | "b">;
  calls: { readonly slot: "a" | "b"; readonly request: DeliberationParticipantRequest; readonly preview: DeliberationParticipantProviderInput }[];
}

class ParticipantProvider implements DeliberationParticipantProvider {
  readonly id: string;
  readonly connectionId: string;
  readonly kind = "deterministic_fixture" as const;
  readonly networkAccess = "none" as const;
  readonly harnessId: string;
  readonly runtimeIdentityHash: string;
  readonly endpointIdentityHash: string;
  readonly secretRefHash: string;
  readonly binding;

  constructor(readonly slot: "a" | "b", private readonly coordinator: Coordinator, private readonly failure?: "provider_timeout" | "provider_failed") {
    this.id = `ri50-provider-${slot}`;
    this.connectionId = `ri50-connection-${slot}`;
    this.harnessId = `ri50-harness-${slot}`;
    this.runtimeIdentityHash = slot.repeat(64);
    this.endpointIdentityHash = (slot === "a" ? "c" : "d").repeat(64);
    this.secretRefHash = (slot === "a" ? "e" : "f").repeat(64);
    this.binding = Object.freeze({ id: this.id, family: "openai_compatible" as const, model: `ri50-model-${slot}`, baseUrlOrigin: `http://127.0.0.1:${slot === "a" ? "18101" : "18102"}`, locality: slot === "a" ? "local" as const : "external" as const, configGeneration: slot === "a" ? 1 : 2 });
  }

  prepare(request: DeliberationParticipantRequest): DeliberationParticipantProviderInput {
    this.coordinator.prepared.add(this.slot);
    const requestBody = JSON.stringify(request);
    return Object.freeze({
      schemaVersion: "1.0.0" as const,
      endpoint: `${this.binding.baseUrlOrigin}/v1/chat/completions`,
      participantId: request.participant.id,
      participantSnapshotHash: request.participantSnapshotHash,
      requestHash: request.requestHash,
      requestBody,
      requestBodyHash: sha(requestBody),
      requestBodyBytes: Buffer.byteLength(requestBody, "utf8"),
      responseLimitBytes: request.limits.maxResponseBytes,
      redirectPolicy: "error" as const,
      retryCount: 0 as const,
    });
  }

  analyze(request: DeliberationParticipantRequest, preview: DeliberationParticipantProviderInput): Promise<unknown> {
    if (!this.coordinator.prepared.has("a") || !this.coordinator.prepared.has("b")) throw new Error("both requests must be prepared before either dispatch");
    const serialized = JSON.stringify(request);
    expect(serialized).not.toContain(this.slot === "a" ? "ri50-connection-b" : "ri50-connection-a");
    this.coordinator.calls.push({ slot: this.slot, request: structuredClone(request), preview: structuredClone(preview) });
    if (this.failure === "provider_timeout") return Promise.reject(Object.assign(new Error("timeout"), { code: "provider_timeout" }));
    if (this.failure === "provider_failed") return Promise.reject(Object.assign(new Error("failed"), { code: "provider_failed" }));
    return Promise.resolve(response(request));
  }
}

class HangingParticipantProvider extends ParticipantProvider {
  override analyze(_request: DeliberationParticipantRequest, _preview: DeliberationParticipantProviderInput, options: { readonly signal: AbortSignal }): Promise<unknown> {
    return new Promise((_, reject) => {
      options.signal.addEventListener("abort", () => { reject(Object.assign(new Error("cancelled"), { code: "cancelled_by_user" })); }, { once: true });
    });
  }
}

interface Fixture {
  readonly root: string;
  readonly databasePath: string;
  readonly core: SestinaCore;
  readonly coordinator: Coordinator;
  readonly providers: readonly [ParticipantProvider, ParticipantProvider];
  readonly projectId: string;
  readonly artifactId: string;
  readonly revisionId: string;
  readonly issueId: string;
}

async function fixture(failureB?: "provider_timeout" | "provider_failed"): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "sestina-ri50-core-")); roots.push(root);
  const databasePath = join(root, "state.sqlite");
  const coordinator: Coordinator = { prepared: new Set(), calls: [] };
  const providers = [new ParticipantProvider("a", coordinator), new ParticipantProvider("b", coordinator, failureB)] as const;
  const core = valueOf(await openSestina({ databasePath, deliberationParticipantProviders: providers })); cores.push(core);
  const project = valueOf(core.initializeProject({ title: "RI-50 synthetic project", actor: USER }));
  const artifact = valueOf(core.createArtifactWithInitialRevision({ projectId: project.id, actor: USER, kind: "research_note", relativePath: "synthetic/causal-claim.md", content: "The observational association is stable, but this design cannot establish causality or identify a mechanism.", mediaType: "text/markdown" }));
  valueOf(core.activateBrief({
    projectId: project.id,
    actor: USER,
    projectQuestion: "How should the observational association be interpreted?",
    currentStage: "revision",
    currentTask: "Decide whether causal language is justified.",
    targetArtifacts: [artifact.artifact.id],
    fixedDecisions: [],
    allowedChanges: [{ target: { kind: "artifact", artifactId: artifact.artifact.id }, operations: ["rewrite"] }],
    forbiddenChanges: [{ target: { kind: "project_path", relativePath: "synthetic" }, operations: ["delete"] }],
    expectedDeltas: [{ statement: "Bound the interpretation to the evidence.", scope: { target: { kind: "artifact", artifactId: artifact.artifact.id }, operations: ["rewrite"] } }],
    evidenceBoundaries: [{ statement: "Do not infer causality from an observational association.", scope: { target: { kind: "artifact", artifactId: artifact.artifact.id }, operations: ["rewrite"] }, forbiddenInferenceKinds: ["causal"] }],
    explicitNonGoals: ["Treat fixture output as real external value"],
  }));
  const issue = valueOf(core.openIssue({ projectId: project.id, actor: USER, kind: "evidence_boundary", target: { kind: "artifact", artifactId: artifact.artifact.id }, violatedCriterion: "causal_identification", rationaleConcepts: ["causality", "observational_design"], summary: "Whether causal language should be retained remains unresolved.", sourceArtifactId: artifact.artifact.id, sourceRevisionId: artifact.revision.id, sourceRevisionContentHash: artifact.revision.content.contentHash, lineageRootRevisionId: artifact.revision.id }));
  return { root, databasePath, core, coordinator, providers, projectId: project.id, artifactId: artifact.artifact.id, revisionId: artifact.revision.id, issueId: issue.id };
}

afterEach(async () => {
  for (const core of cores.splice(0)) core.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("RI-50 Deliberation Room Core", () => {
  it("persists both exact manifests before dispatch, rebuilds them after restart, runs both providers in parallel, and leaves resolution to the user", async () => {
    const state = await fixture();
    const room = valueOf(state.core.createDeliberationRoom({ projectId: state.projectId, sourceKind: "research_issue", sourceObjectId: state.issueId, question: "Does the current evidence justify retaining a causal interpretation?", title: "Causal interpretation", actor: USER }));
    const prepared = valueOf(state.core.prepareDeliberationRoom({ projectId: state.projectId, roomId: room.id, expectedVersion: room.version, revisionId: state.revisionId, includeBrief: true, decisionIds: [], issueIds: [state.issueId], evidenceIds: [], actor: USER }));
    expect(prepared.contextManifestsVisible).toBe(true);
    expect(prepared.room.status).toBe("awaiting_manifest_confirmation");
    expect(prepared.requests).toHaveLength(2);
    expect(prepared.requests[0].roundId).toBe(prepared.requests[1].roundId);
    expect(prepared.requests[0].requestHash).not.toBe(prepared.requests[1].requestHash);
    expect(state.coordinator.calls).toHaveLength(0);
    expect(state.coordinator.prepared).toEqual(new Set(["a", "b"]));

    state.core.close(); cores.splice(cores.indexOf(state.core), 1);
    state.coordinator.prepared.clear();
    const reopened = valueOf(await openSestina({ databasePath: state.databasePath, deliberationParticipantProviders: state.providers })); cores.push(reopened);
    const restored = valueOf(reopened.getDeliberationRoom(state.projectId, room.id));
    if (restored === undefined) throw new Error("room missing after restart");
    const restoredManifests = restored.manifests;
    if (restoredManifests === undefined) throw new Error("manifests missing after restart");
    const completed = valueOf(await reopened.runDeliberationRoomBlindRound({ projectId: state.projectId, roomId: room.id, expectedVersion: restored.version, confirmedManifestHashes: restoredManifests.map((item) => item.canonicalHash) as readonly [string, string], actor: USER }));
    expect(completed.status).toBe("reveal_ready");
    expect(completed.initialRound?.attempts).toEqual([
      expect.objectContaining({ status: "completed", sealed: true }),
      expect.objectContaining({ status: "completed", sealed: true }),
    ]);
    expect(valueOf(reopened.getDeliberationRoomProjection(state.projectId, room.id))?.assessments).toEqual([]);
    expect(state.coordinator.calls.map((item) => item.slot).sort()).toEqual(["a", "b"]);
    expect(state.coordinator.calls.map((item) => item.preview)).toMatchObject([{ retryCount: 0 }, { retryCount: 0 }]);

    const revealed = valueOf(reopened.revealDeliberationRoom({ projectId: state.projectId, roomId: room.id, expectedVersion: completed.version, mode: "complete", actor: USER }));
    expect(revealed).toMatchObject({ status: "difference_review", differenceSummary: { authority: "system_derived", canResolveRoom: false, winner: null, ranking: null, score: null } });
    const preparedChallenge = valueOf(reopened.prepareDeliberationChallenge({ commandId: "prepare-causal-challenge-0001", projectId: state.projectId, roomId: room.id, expectedVersion: revealed.version, question: "Which exact evidence would change the bounded conclusion?", actor: USER }));
    expect(preparedChallenge).toMatchObject({ contextManifestVisible: true, sharedContextOnly: true, room: { status: "challenge_prepared" } });
    expect(preparedChallenge.requests.every((request) => request.context.allowedObjects.map((item) => item.kind).includes("participant_assessment") && request.context.allowedObjects.map((item) => item.kind).includes("difference_summary"))).toBe(true);
    expect(JSON.stringify(preparedChallenge.requests)).not.toContain("rawProviderResponse");
    const challenge = preparedChallenge.room.challenge;
    if (challenge === undefined) throw new Error("prepared challenge missing");
    const waiting = valueOf(await reopened.runDeliberationChallenge({ commandId: "run-causal-challenge-0001", projectId: state.projectId, roomId: room.id, expectedVersion: preparedChallenge.room.version, challengeId: challenge.id, confirmedManifestHashes: preparedChallenge.manifests.map((manifest) => manifest.canonicalHash) as readonly [string, string], actor: USER }));
    expect(waiting).toMatchObject({ status: "waiting_user_resolution", challenge: { status: "completed", userConfirmed: true } });
    const replayedWaiting = valueOf(await reopened.runDeliberationChallenge({ commandId: "run-causal-challenge-0001", projectId: state.projectId, roomId: room.id, expectedVersion: preparedChallenge.room.version, challengeId: challenge.id, confirmedManifestHashes: preparedChallenge.manifests.map((manifest) => manifest.canonicalHash) as readonly [string, string], actor: USER }));
    expect(replayedWaiting.version).toBe(waiting.version);
    expect(state.coordinator.calls).toHaveLength(4);
    const resolved = valueOf(reopened.resolveDeliberationRoom({ commandId: "resolve-causal-room-0001", projectId: state.projectId, roomId: room.id, expectedVersion: waiting.version, kind: "keep_disputed", publicReason: "The two bounded assessments disagree on scope; retain the dispute pending evidence.", actor: USER }));
    expect(resolved).toMatchObject({ status: "resolved", resolutions: [{ receipt: { canonicalMutationAuthorized: false, separateAuthorityRequired: true } }] });
    expect(reopened.resolveDeliberationRoom({ commandId: "resolve-causal-room-0001", projectId: state.projectId, roomId: room.id, expectedVersion: waiting.version, kind: "adopt_a", publicReason: "Conflicting reuse must fail.", actor: USER })).toMatchObject({ ok: false, error: { code: "state_conflict" } });

    const roomProjection = valueOf(reopened.getDeliberationRoomProjection(state.projectId, room.id));
    expect(roomProjection).toMatchObject({ kind: "deliberation_room", id: room.id, status: "resolved", userAuthorityOnly: true });
    expect(roomProjection?.trace.map((item) => item.step)).toEqual(expect.arrayContaining(["source", "manifests", "blind_round", "difference", "resolution_receipt"]));
    const roomPage = valueOf(reopened.listDeliberationRoomProjections(state.projectId, { limit: 20 }));
    expect(roomPage.items).toEqual([expect.objectContaining({ id: room.id, status: "resolved" })]);
    const overview = valueOf(reopened.getProjectOverviewProjection(state.projectId, { providerStatus: "configured" }));
    expect(overview.counts.deliberationRooms).toBe(1);
    expect(overview.statuses.deliberationRooms).toMatchObject({ resolved: 1 });
    expect(valueOf(reopened.searchResearchObjects(state.projectId, { query: "Causal interpretation", limit: 20 })).items).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "deliberation_room", id: room.id })]));
  });

  it("normalizes one Provider failure without retry or fallback and requires an explicit partial reveal", async () => {
    const state = await fixture("provider_timeout");
    const room = valueOf(state.core.createDeliberationRoom({ projectId: state.projectId, sourceKind: "research_issue", sourceObjectId: state.issueId, question: "Does the current evidence justify retaining a causal interpretation?", title: "Partial room", actor: USER }));
    const prepared = valueOf(state.core.prepareDeliberationRoom({ projectId: state.projectId, roomId: room.id, expectedVersion: room.version, revisionId: state.revisionId, includeBrief: true, decisionIds: [], issueIds: [state.issueId], evidenceIds: [], actor: USER }));
    const completed = valueOf(await state.core.runDeliberationRoomBlindRound({ projectId: state.projectId, roomId: room.id, expectedVersion: prepared.room.version, confirmedManifestHashes: prepared.manifests.map((item) => item.canonicalHash) as readonly [string, string], actor: USER }));
    expect(completed).toMatchObject({ status: "reveal_ready", initialRound: { attempts: [expect.objectContaining({ status: "completed" }), expect.objectContaining({ status: "failed", failure: "provider_timeout" })] } });
    expect(state.coordinator.calls).toHaveLength(2);
    const partial = valueOf(state.core.revealDeliberationRoom({ projectId: state.projectId, roomId: room.id, expectedVersion: completed.version, mode: "partial", actor: USER }));
    expect(partial).toMatchObject({ status: "partial", initialRound: { reveal: { explicitUserAction: true, mode: "partial" } } });
  });

  it("uses a fresh confirmed Manifest to retry only the failed participant and prevents a fifth Provider call", async () => {
    const state = await fixture("provider_timeout");
    const room = valueOf(state.core.createDeliberationRoom({ projectId: state.projectId, sourceKind: "research_issue", sourceObjectId: state.issueId, question: "Should the failed view be retried?", title: "Retry room", actor: USER }));
    const prepared = valueOf(state.core.prepareDeliberationRoom({ projectId: state.projectId, roomId: room.id, expectedVersion: room.version, revisionId: state.revisionId, includeBrief: true, decisionIds: [], issueIds: [state.issueId], evidenceIds: [], actor: USER }));
    const terminal = valueOf(await state.core.runDeliberationRoomBlindRound({ projectId: state.projectId, roomId: room.id, expectedVersion: prepared.room.version, confirmedManifestHashes: prepared.manifests.map((item) => item.canonicalHash) as readonly [string, string], actor: USER }));
    const partial = valueOf(state.core.revealDeliberationRoom({ projectId: state.projectId, roomId: room.id, expectedVersion: terminal.version, mode: "partial", actor: USER }));
    state.core.close(); cores.splice(cores.indexOf(state.core), 1);
    const retryProviders = [new ParticipantProvider("a", state.coordinator), new ParticipantProvider("b", state.coordinator)] as const;
    const reopened = valueOf(await openSestina({ databasePath: state.databasePath, deliberationParticipantProviders: retryProviders })); cores.push(reopened);
    const retryPrepared = valueOf(reopened.prepareDeliberationParticipantRetry({ commandId: "prepare-participant-retry-0001", projectId: state.projectId, roomId: room.id, expectedVersion: partial.version, actor: USER }));
    expect(retryPrepared).toMatchObject({ contextManifestVisible: true, room: { status: "retry_prepared", retry: { participantId: room.participants[1].id, userConfirmed: false } } });
    expect(retryPrepared.manifest.canonicalHash).not.toBe(prepared.manifests[1].canonicalHash);
    const preparedRetry = retryPrepared.room.retry;
    if (preparedRetry === undefined) throw new Error("prepared retry missing");
    const retried = valueOf(await reopened.runDeliberationParticipantRetry({ commandId: "run-participant-retry-0001", projectId: state.projectId, roomId: room.id, expectedVersion: retryPrepared.room.version, retryId: preparedRetry.id, confirmedManifestHash: retryPrepared.manifest.canonicalHash, actor: USER }));
    expect(retried).toMatchObject({ status: "reveal_ready", retry: { status: "completed", attempt: { sealed: true } } });
    expect(state.coordinator.calls).toHaveLength(3);
    expect(state.coordinator.calls[2]?.slot).toBe("b");
    const revealed = valueOf(reopened.revealDeliberationRoom({ commandId: "reveal-participant-retry-0001", projectId: state.projectId, roomId: room.id, expectedVersion: retried.version, mode: "complete", actor: USER }));
    expect(revealed).toMatchObject({ status: "difference_review", retry: { status: "completed", attempt: { sealed: false } } });
    expect(reopened.prepareDeliberationChallenge({ commandId: "forbidden-fifth-call-0001", projectId: state.projectId, roomId: room.id, expectedVersion: revealed.version, question: "Would this exceed the call budget?", actor: USER })).toMatchObject({ ok: false, error: { code: "state_conflict" } });
  });

  it("preserves a draft and manual fallback when Providers are unavailable without claiming mutual blindness", async () => {
    const state = await fixture();
    state.core.close(); cores.splice(cores.indexOf(state.core), 1);
    const unconfigured = valueOf(await openSestina({ databasePath: state.databasePath })); cores.push(unconfigured);
    const room = valueOf(unconfigured.createDeliberationRoom({ projectId: state.projectId, sourceKind: "research_issue", sourceObjectId: state.issueId, question: "Should this be discussed?", title: "Provider-free record", actor: USER }));
    expect(room).toMatchObject({ status: "draft", providerReadiness: "blocked_missing_provider" });
    expect(unconfigured.prepareDeliberationRoom({ projectId: state.projectId, roomId: room.id, expectedVersion: room.version, revisionId: state.revisionId, includeBrief: true, decisionIds: [], issueIds: [state.issueId], evidenceIds: [], actor: USER })).toMatchObject({ ok: false, error: { code: "review_blocked" } });
    const imported = valueOf(unconfigured.importManualExternalOpinion({ projectId: state.projectId, roomId: room.id, expectedVersion: room.version, sourceLabel: "Pasted public opinion", providerClaim: "Unknown provider", modelClaim: "Unknown model", capturedAt: "2026-08-26T08:30:00.000Z", contextDisclosure: "The opinion may have seen the room question and is not verified blind.", sawParticipantAOutput: true, sawParticipantBOutput: false, publicContent: "The claim should remain bounded until stronger evidence is available.", actor: USER }));
    expect(imported).toMatchObject({ providerReadiness: "blocked_missing_provider", manualExternalOpinions: [{ capturedAt: "2026-08-26T08:30:00.000Z", exposure: { sawParticipantAOutput: true, sawParticipantBOutput: false }, blindnessVerification: "not_verifiable", classification: "manual_non_blind", verification: "unverified_external_import", canActAsParticipant: false, canResolveRoom: false }] });
  });

  it("marks an interrupted blind round uncertain on reopen and never pretends the lost Provider writes succeeded", async () => {
    const state = await fixture();
    const room = valueOf(state.core.createDeliberationRoom({ projectId: state.projectId, sourceKind: "research_issue", sourceObjectId: state.issueId, question: "Should the interrupted round be trusted?", title: "Interrupted round", actor: USER }));
    const prepared = valueOf(state.core.prepareDeliberationRoom({ projectId: state.projectId, roomId: room.id, expectedVersion: room.version, revisionId: state.revisionId, includeBrief: true, decisionIds: [], issueIds: [state.issueId], evidenceIds: [], actor: USER }));
    state.core.close(); cores.splice(cores.indexOf(state.core), 1);
    const hangingProviders = [new HangingParticipantProvider("a", state.coordinator), new HangingParticipantProvider("b", state.coordinator)] as const;
    const interrupted = valueOf(await openSestina({ databasePath: state.databasePath, deliberationParticipantProviders: hangingProviders })); cores.push(interrupted);
    void interrupted.runDeliberationRoomBlindRound({ projectId: state.projectId, roomId: room.id, expectedVersion: prepared.room.version, confirmedManifestHashes: prepared.manifests.map((item) => item.canonicalHash) as readonly [string, string], actor: USER });
    await Promise.resolve();
    expect(valueOf(interrupted.getDeliberationRoom(state.projectId, room.id))?.status).toBe("blind_round_running");
    interrupted.close(); cores.splice(cores.indexOf(interrupted), 1);
    const reopened = valueOf(await openSestina({ databasePath: state.databasePath, deliberationParticipantProviders: state.providers })); cores.push(reopened);
    const recovered = valueOf(reopened.getDeliberationRoom(state.projectId, room.id));
    expect(recovered).toMatchObject({ status: "failed", initialRound: { attempts: [expect.objectContaining({ status: "unknown", failure: "result_write_uncertain" }), expect.objectContaining({ status: "unknown", failure: "result_write_uncertain" })] } });
    expect(recovered?.differenceSummary).toBeUndefined();
  });

  it("marks a Room stale when the bound source version changes before dispatch", async () => {
    const state = await fixture();
    const room = valueOf(state.core.createDeliberationRoom({ projectId: state.projectId, sourceKind: "research_issue", sourceObjectId: state.issueId, question: "Is this still the same source state?", title: "Source freshness", actor: USER }));
    const issue = valueOf(state.core.getIssue(state.projectId, state.issueId));
    if (issue === undefined) throw new Error("issue missing");
    valueOf(state.core.disputeIssue({ projectId: state.projectId, issueId: state.issueId, expectedVersion: issue.version, reason: "The source changed after the Room was bound.", actor: USER }));
    const result = state.core.prepareDeliberationRoom({ projectId: state.projectId, roomId: room.id, expectedVersion: room.version, revisionId: state.revisionId, includeBrief: true, decisionIds: [], issueIds: [state.issueId], evidenceIds: [], actor: USER });
    expect(result).toMatchObject({ ok: false, error: { code: "stale_state" } });
    const stale = valueOf(state.core.getDeliberationRoom(state.projectId, room.id));
    expect(stale?.status).toBe("stale_conflicted");
    expect(stale?.transitions.some((transition) => transition.reason.includes("source_version_changed"))).toBe(true);
  });
});
