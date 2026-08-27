import { describe, expect, it } from "vitest";
import {
  DELIBERATION_COMPARISON_DIMENSION_IDS,
  DELIBERATION_DIFFERENCE_CATEGORIES,
  FixedClock,
  SequenceIdFactory,
  completeDeliberationChallenge,
  completeDeliberationParticipant,
  completeDeliberationParticipantRetry,
  createDeliberationRoom,
  deriveDeliberationDifferenceSummary,
  failDeliberationParticipant,
  importManualExternalOpinion,
  parseDeliberationRoom,
  prepareDeliberationChallenge,
  prepareDeliberationContext,
  prepareDeliberationParticipantRetry,
  resolveDeliberationRoom,
  revealDeliberationRound,
  stableResearchHash,
  startBlindDeliberationRound,
  startDeliberationChallenge,
  startDeliberationParticipantRetry,
  waitForDeliberationResolution,
  type DeliberationContextManifest,
  type DeliberationFrozenContext,
  type DeliberationParticipantAssessment,
  type DeliberationParticipantSnapshot,
  type DeliberationSourceBinding,
  type ResearchActor,
} from "../src/index.js";

const USER: ResearchActor = { kind: "user", actorId: "research-owner" };
const MODEL: ResearchActor = { kind: "model", model: "participant-model" };
const CLOCK = new FixedClock("2026-08-26T08:00:00.000Z");

function valueOf<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly code: string } }): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

function hash(value: unknown): string {
  return valueOf(stableResearchHash(value));
}

function fixture(seed = 50_000) {
  const ids = new SequenceIdFactory(seed);
  const projectId = ids.create("rprj_");
  const objectId = ids.create("riss_");
  const sourceBase = {
    kind: "research_issue" as const,
    objectId,
    objectVersion: 3,
    question: "Does the current evidence justify retaining a causal interpretation?",
  };
  const source: DeliberationSourceBinding = {
    projectId,
    ...sourceBase,
    sourceHash: hash(sourceBase),
  };
  const participants: readonly [DeliberationParticipantSnapshot, DeliberationParticipantSnapshot] = [
    {
      id: ids.create("rpar_"),
      slot: "a",
      role: "independent_research_assessor",
      connectionId: "connection-a",
      providerId: "provider-a",
      family: "openai_compatible",
      model: "model-a",
      harnessId: "harness-a",
      runtimeIdentityHash: "a".repeat(64),
      endpointIdentityHash: "b".repeat(64),
      secretRefHash: "c".repeat(64),
      configGeneration: 4,
      locality: "local",
    },
    {
      id: ids.create("rpar_"),
      slot: "b",
      role: "independent_research_assessor",
      connectionId: "connection-b",
      providerId: "provider-b",
      family: "openai_compatible",
      model: "model-b",
      harnessId: "harness-b",
      runtimeIdentityHash: "d".repeat(64),
      endpointIdentityHash: "e".repeat(64),
      secretRefHash: "f".repeat(64),
      configGeneration: 7,
      locality: "external",
    },
  ];
  const created = valueOf(createDeliberationRoom({ source, title: "Causal interpretation", participants, providerReadiness: "configured_distinct", commandId: `create-${seed}-room`, actor: USER }, { clock: CLOCK, idFactory: ids }));
  return { ids, source, participants, room: created };
}

function manifest(roomId: string, participant: DeliberationParticipantSnapshot, suffix: string): DeliberationContextManifest {
  const withoutHash = {
    schemaVersion: "1.0.0" as const,
    roomId,
    roundId: roomId.replace("rdlr_", "rrnd_"),
    participantId: participant.id,
    participantSlot: participant.slot,
    requestHash: suffix.repeat(64),
    requestBodyHash: suffix === "1" ? "2".repeat(64) : "3".repeat(64),
    participantSnapshotHash: hash(participant),
    includedFields: ["source.question", `participant.${participant.slot}.role`],
    includedObjects: [{ kind: "issue" as const, id: roomId.replace("rdlr_", "riss_"), version: 3, hash: "4".repeat(64), fields: { status: "open" } }],
    excludedFields: [
      "other_participant_output",
      "other_participant_private_context",
      "other_participant_session",
      "provider_raw_response",
      "hidden_chain_of_thought",
    ],
    stateBindingHash: "5".repeat(64),
    protocol: { version: "1.0.0", hash: "6".repeat(64) },
    prompt: { version: "1.0.0", hash: "7".repeat(64) },
    responseSchema: { version: "1.0.0", hash: "8".repeat(64) },
    rubric: { version: "1.0.0", hash: "9".repeat(64) },
    tokenBudget: 4_096,
    maxResponseBytes: 65_536,
    tools: "none" as const,
    roomContextOnly: true as const,
  };
  return { ...withoutHash, canonicalHash: hash(withoutHash) };
}

function prepared(seed = 50_000) {
  const base = fixture(seed);
  const manifests: readonly [DeliberationContextManifest, DeliberationContextManifest] = [
    manifest(base.room.id, base.participants[0], "1"),
    manifest(base.room.id, base.participants[1], "a"),
  ];
  const briefIds = new SequenceIdFactory(seed + 900);
  const frozenWithoutHash = {
    schemaVersion: "1.0.0" as const,
    question: base.source.question,
    brief: { briefId: briefIds.create("rbrf_"), versionId: briefIds.create("rbrf_"), versionNumber: 1, hash: "b".repeat(64) },
    retainedDecisions: [],
    allowedEvidenceIds: [],
    excludedEvidenceIds: [],
    comparisonDimensions: DELIBERATION_COMPARISON_DIMENSION_IDS.map((id) => ({ id, label: id.replaceAll("_", " ") })),
    stopConditions: ["Both initial attempts are terminal."],
    budget: { participants: 2 as const, blindInitialRounds: 1 as const, directedChallengeRounds: 1 as const, maximumProviderCalls: 4 as const, automaticRetries: 0 as const, synthesisProviders: 0 as const },
    stateBindingHash: "5".repeat(64),
  };
  const frozenContext: DeliberationFrozenContext = { ...frozenWithoutHash, canonicalHash: hash(frozenWithoutHash) };
  const room = valueOf(prepareDeliberationContext(base.room, { expectedVersion: base.room.version, frozenContext, manifests }, CLOCK));
  return { ...base, manifests, room };
}

function running(seed = 50_000) {
  const base = prepared(seed);
  const room = valueOf(startBlindDeliberationRound(base.room, {
    expectedVersion: base.room.version,
    actor: USER,
    confirmedManifestHashes: base.manifests.map((item) => item.canonicalHash) as readonly [string, string],
  }, { clock: CLOCK, idFactory: base.ids }));
  return { ...base, room };
}

function assessment(roomId: string, projectId: string, roundId: string, participant: DeliberationParticipantSnapshot, requestHash: string, variant: "a" | "b" | "challenge" = participant.slot): DeliberationParticipantAssessment {
  const supporting = variant === "a";
  return {
    schemaVersion: "1.0.0",
    roomId,
    roundId,
    participantId: participant.id,
    participantSlot: participant.slot,
    requestHash,
    assessment: supporting ? "support" : variant === "b" ? "mixed" : "oppose",
    directAnswer: supporting
      ? "Retain only an explicitly qualified association; causality is not established."
      : "Remove the causal interpretation until a mechanism and design are supplied.",
    dimensions: DELIBERATION_COMPARISON_DIMENSION_IDS.map((dimensionId) => ({ dimensionId, position: supporting ? "qualify" as const : "challenge" as const, summary: supporting ? "Retain a bounded association." : "Do not retain a causal claim.", evidenceSpanIds: [`${variant}-span-1`] })),
    claims: [{
      claimId: `${variant}-claim-1`,
      stance: supporting ? "support" : "challenge",
      text: supporting ? "The observed association remains reportable with a limitation." : "The evidence does not identify a causal mechanism.",
      evidenceSpanIds: [`${variant}-span-1`],
    }],
    evidenceSpans: [{
      spanId: `${variant}-span-1`,
      projectId,
      artifactId: new SequenceIdFactory(71_000).create("rart_"),
      revisionId: new SequenceIdFactory(72_000).create("rrev_"),
      normalizedTextHash: "b".repeat(64),
      start: 0,
      end: 24,
      quote: supporting ? "association is observed" : "cannot establish causality",
      quoteHash: supporting ? "c".repeat(64) : "d".repeat(64),
      normalizationVersion: "nfkc-lf-v1",
      indexUnit: "utf16_code_unit",
    }],
    assumptions: supporting ? ["The reported association is the bounded target."] : ["The target is a causal explanation."],
    scope: supporting ? "Reporting language" : "Causal identification",
    counterexamples: supporting ? [] : ["A stable association can remain confounded."],
    alternativeExplanations: supporting ? ["Residual confounding"] : ["Selection bias", "Residual confounding"],
    unknowns: ["The causal mechanism is unknown."],
    nextDiscriminatingEvidence: supporting ? ["A preregistered replication"] : ["A credible identification strategy"],
    missingContext: supporting ? [] : ["Identification strategy"],
    uncertaintySources: ["Synthetic evidence only"],
    publicRationale: supporting ? "The evidence supports association but not causal identification." : "The design and mechanism are insufficient for causality.",
    proposedNextStep: supporting ? "Narrow the claim." : "Request design evidence.",
    hashes: {
      responseSchemaHash: "8".repeat(64),
      rubricHash: "9".repeat(64),
      requestHash,
    },
  };
}

function bothComplete(seed = 50_000) {
  const base = running(seed);
  const round = base.room.initialRound;
  if (round === undefined) throw new Error("missing round");
  const afterA = valueOf(completeDeliberationParticipant(base.room, {
    expectedVersion: base.room.version,
    roundId: round.id,
    participantId: base.participants[0].id,
    attemptId: round.attempts[0].id,
    assessment: assessment(base.room.id, base.room.projectId, round.id, base.participants[0], base.manifests[0].requestHash, "a"),
  }, CLOCK));
  const afterB = valueOf(completeDeliberationParticipant(afterA, {
    expectedVersion: afterA.version,
    roundId: round.id,
    participantId: base.participants[1].id,
    attemptId: round.attempts[1].id,
    assessment: assessment(base.room.id, base.room.projectId, round.id, base.participants[1], base.manifests[1].requestHash, "b"),
  }, CLOCK));
  return { ...base, afterA, room: afterB };
}

describe("RI-50 deliberation room aggregate", () => {
  it("admits only legal project-object sources and exactly two identity-isolated participants", () => {
    const { room, participants } = fixture();
    expect(room).toMatchObject({ status: "draft", authority: "user_owned", participants });
    expect(parseDeliberationRoom(room).ok).toBe(true);

    const duplicateRuntime = [participants[0], { ...participants[1], runtimeIdentityHash: participants[0].runtimeIdentityHash }] as const;
    const rejected = createDeliberationRoom({ source: fixture(51_000).source, title: "Rejected", participants: duplicateRuntime, providerReadiness: "configured_distinct", commandId: "create-duplicate-runtime", actor: USER }, { clock: CLOCK, idFactory: new SequenceIdFactory(51_100) });
    expect(rejected).toMatchObject({ ok: false, error: { code: "invalid_deliberation_participants" } });

    const modelCreated = createDeliberationRoom({ source: fixture(52_000).source, title: "Rejected", participants, providerReadiness: "configured_distinct", commandId: "create-model-rejected", actor: MODEL }, { clock: CLOCK, idFactory: new SequenceIdFactory(52_100) });
    expect(modelCreated).toMatchObject({ ok: false, error: { code: "user_deliberation_action_required" } });
  });

  it("freezes two distinct manifests before dispatch and records protocol-enforced mutual blindness", () => {
    const { room, manifests } = running();
    expect(room.status).toBe("blind_round_running");
    expect(room.initialRound).toMatchObject({
      requestsFrozenBeforeDispatch: true,
      dispatchPolicy: "parallel_no_retry",
      revealPolicy: "both_valid_terminal_or_explicit_partial_cancel",
      blindness: {
        status: "protocol_enforced",
        participantAExcludedParticipantB: true,
        participantBExcludedParticipantA: true,
      },
    });
    expect(manifests[0].canonicalHash).not.toBe(manifests[1].canonicalHash);
    expect(room.initialRound?.attempts.map((item) => item.requestHash)).toEqual(manifests.map((item) => item.requestHash));
  });

  it("keeps the first completion sealed, rejects stale or cross-attempt output, then creates a deterministic Difference Summary", () => {
    const { afterA, room, manifests, participants } = bothComplete();
    expect(afterA.status).toBe("blind_round_running");
    expect(afterA.initialRound?.reveal).toBeUndefined();
    expect(afterA.initialRound?.attempts[0]).toMatchObject({ status: "completed", sealed: true });
    expect(room.status).toBe("reveal_ready");

    const round = room.initialRound;
    if (round === undefined) throw new Error("missing round");
    const late = completeDeliberationParticipant(room, {
      expectedVersion: room.version,
      roundId: round.id,
      participantId: participants[0].id,
      attemptId: round.attempts[1].id,
      assessment: assessment(room.id, room.projectId, round.id, participants[0], manifests[0].requestHash, "a"),
    }, CLOCK);
    expect(late).toMatchObject({ ok: false, error: { code: "invalid_deliberation_attempt" } });

    const revealed = valueOf(revealDeliberationRound(room, { expectedVersion: room.version, actor: USER, mode: "complete" }, CLOCK));
    expect(revealed.status).toBe("difference_review");
    expect(revealed.initialRound?.attempts.every((item) => !item.sealed)).toBe(true);
    const kinds = revealed.differenceSummary?.categories.filter((item) => item.status !== "absent").map((item) => item.kind) ?? [];
    expect(kinds).toEqual(expect.arrayContaining(["qualified_difference", "fact_selection_difference", "assumption_difference", "scope_difference", "candidate_unique_increment", "unresolved", "unproven"]));
    expect(revealed.differenceSummary).toMatchObject({ authority: "system_derived", canResolveRoom: false, winner: null, ranking: null, score: null });
    const leftAssessment = round.attempts[0].assessment;
    const rightAssessment = round.attempts[1].assessment;
    if (leftAssessment === undefined || rightAssessment === undefined) throw new Error("completed assessments missing");
    expect(deriveDeliberationDifferenceSummary(leftAssessment, rightAssessment).categories.map((item) => item.kind)).toEqual(DELIBERATION_DIFFERENCE_CATEGORIES);
  });

  it("allows one user-confirmed directed challenge and no automatic second round", () => {
    const base = bothComplete(53_000);
    const revealed = valueOf(revealDeliberationRound(base.room, { expectedVersion: base.room.version, actor: USER, mode: "complete" }, CLOCK));
    const challengeId = base.ids.create("rdch_");
    const attemptIds = [base.ids.create("rdat_"), base.ids.create("rdat_")] as const;
    const challengeManifests = base.manifests.map((manifest, index) => {
      const { canonicalHash: initialCanonicalHash, ...challengeManifestBase } = { ...manifest, roundId: challengeId, requestHash: (index === 0 ? "e" : "f").repeat(64) };
      expect(initialCanonicalHash).toBe(manifest.canonicalHash);
      return { ...challengeManifestBase, canonicalHash: hash(challengeManifestBase) };
    }) as readonly [DeliberationContextManifest, DeliberationContextManifest];
    const prepared = valueOf(prepareDeliberationChallenge(revealed, {
      expectedVersion: revealed.version,
      actor: USER,
      question: "Which exact evidence would change your conclusion?",
      challengeId,
      attemptIds,
      manifests: challengeManifests,
      sharedContextHash: "9".repeat(64),
    }, { clock: CLOCK }));
    expect(prepared).toMatchObject({ status: "challenge_prepared", challenge: { status: "prepared", userConfirmed: false, attempts: [{ status: "prepared" }, { status: "prepared" }] } });
    const preparedChallenge = prepared.challenge;
    if (preparedChallenge === undefined) throw new Error("prepared challenge missing");
    const started = valueOf(startDeliberationChallenge(prepared, { expectedVersion: prepared.version, actor: USER, challengeId: preparedChallenge.id, confirmedManifestHashes: preparedChallenge.manifests.map((manifest) => manifest.canonicalHash) as readonly [string, string] }, CLOCK));
    expect(started).toMatchObject({ status: "challenge_running", challenge: { status: "running", userConfirmed: true, attempts: [{ status: "running" }, { status: "running" }] } });
    const challenge = started.challenge;
    if (challenge === undefined) throw new Error("running challenge missing");
    const afterA = valueOf(completeDeliberationChallenge(started, {
      expectedVersion: started.version,
      challengeId: challenge.id,
      participantId: base.participants[0].id,
      attemptId: challenge.attempts[0].id,
      assessment: assessment(started.id, started.projectId, challenge.id, base.participants[0], challenge.attempts[0].requestHash, "a"),
    }, CLOCK));
    expect(afterA.status).toBe("challenge_running");
    const completed = valueOf(completeDeliberationChallenge(afterA, {
      expectedVersion: afterA.version,
      challengeId: challenge.id,
      participantId: base.participants[1].id,
      attemptId: challenge.attempts[1].id,
      assessment: assessment(started.id, started.projectId, challenge.id, base.participants[1], challenge.attempts[1].requestHash, "challenge"),
    }, CLOCK));
    expect(completed.status).toBe("waiting_user_resolution");
    const again = prepareDeliberationChallenge(completed, { expectedVersion: completed.version, actor: USER, question: "Retry?", challengeId: base.ids.create("rdch_"), attemptIds: [base.ids.create("rdat_"), base.ids.create("rdat_")], manifests: challengeManifests, sharedContextHash: "9".repeat(64) }, { clock: CLOCK });
    expect(again).toMatchObject({ ok: false, error: { code: "deliberation_round_limit_reached" } });
  });

  it("supports an explicit partial reveal after a terminal failure without fabricating a fallback", () => {
    const base = running(54_000);
    const round = base.room.initialRound;
    if (round === undefined) throw new Error("initial round missing");
    const afterA = valueOf(completeDeliberationParticipant(base.room, {
      expectedVersion: base.room.version,
      roundId: round.id,
      participantId: base.participants[0].id,
      attemptId: round.attempts[0].id,
      assessment: assessment(base.room.id, base.room.projectId, round.id, base.participants[0], base.manifests[0].requestHash, "a"),
    }, CLOCK));
    const failed = valueOf(failDeliberationParticipant(afterA, {
      expectedVersion: afterA.version,
      roundId: round.id,
      participantId: base.participants[1].id,
      attemptId: round.attempts[1].id,
      failure: "provider_timeout",
    }, CLOCK));
    expect(failed.status).toBe("reveal_ready");
    const partial = valueOf(revealDeliberationRound(failed, { expectedVersion: failed.version, actor: USER, mode: "partial" }, CLOCK));
    expect(partial).toMatchObject({ status: "partial", initialRound: { reveal: { mode: "partial", explicitUserAction: true } } });
    expect(partial.differenceSummary?.categories.find((item) => item.kind === "unproven")?.status).toBe("present");
    expect(partial.initialRound?.attempts[1]).toMatchObject({ status: "failed", failure: "provider_timeout" });
  });

  it("enters failed when neither participant produces a valid assessment and never fabricates a Difference Summary", () => {
    const base = running(54_500);
    const round = base.room.initialRound;
    if (round === undefined) throw new Error("initial round missing");
    const afterA = valueOf(failDeliberationParticipant(base.room, {
      expectedVersion: base.room.version,
      roundId: round.id,
      participantId: base.participants[0].id,
      attemptId: round.attempts[0].id,
      failure: "provider_offline",
    }, CLOCK));
    const failed = valueOf(failDeliberationParticipant(afterA, {
      expectedVersion: afterA.version,
      roundId: round.id,
      participantId: base.participants[1].id,
      attemptId: round.attempts[1].id,
      failure: "provider_timeout",
    }, CLOCK));
    expect(failed.status).toBe("failed");
    expect(failed.differenceSummary).toBeUndefined();
    expect(revealDeliberationRound(failed, { expectedVersion: failed.version, actor: USER, mode: "partial" }, CLOCK)).toMatchObject({
      ok: false,
      error: { code: "invalid_deliberation_transition" },
    });
  });

  it("retries only the failed participant after a new user-confirmed Manifest and disables a fifth-call challenge", () => {
    const base = running(54_750);
    const round = base.room.initialRound;
    if (round === undefined) throw new Error("initial round missing");
    const afterA = valueOf(completeDeliberationParticipant(base.room, {
      expectedVersion: base.room.version,
      roundId: round.id,
      participantId: base.participants[0].id,
      attemptId: round.attempts[0].id,
      assessment: assessment(base.room.id, base.room.projectId, round.id, base.participants[0], base.manifests[0].requestHash, "a"),
    }, CLOCK));
    const afterFailure = valueOf(failDeliberationParticipant(afterA, {
      expectedVersion: afterA.version,
      roundId: round.id,
      participantId: base.participants[1].id,
      attemptId: round.attempts[1].id,
      failure: "provider_timeout",
    }, CLOCK));
    const partial = valueOf(revealDeliberationRound(afterFailure, { expectedVersion: afterFailure.version, actor: USER, mode: "partial" }, CLOCK));
    const retryId = base.ids.create("rrnd_");
    const { canonicalHash: initialCanonicalHash, ...retryManifestBase } = { ...base.manifests[1], roundId: retryId, requestHash: "e".repeat(64), requestBodyHash: "f".repeat(64) };
    expect(initialCanonicalHash).toBe(base.manifests[1].canonicalHash);
    const retryManifest = { ...retryManifestBase, canonicalHash: hash(retryManifestBase) };
    const preparedRetry = valueOf(prepareDeliberationParticipantRetry(partial, {
      expectedVersion: partial.version,
      actor: USER,
      retryId,
      attemptId: base.ids.create("rdat_"),
      manifest: retryManifest,
    }, CLOCK));
    expect(preparedRetry).toMatchObject({ status: "retry_prepared", retry: { participantId: base.participants[1].id, priorAttemptId: round.attempts[1].id, userConfirmed: false } });
    const startedRetry = valueOf(startDeliberationParticipantRetry(preparedRetry, { expectedVersion: preparedRetry.version, actor: USER, retryId, confirmedManifestHash: retryManifest.canonicalHash }, CLOCK));
    const activeRetry = startedRetry.retry;
    if (activeRetry === undefined) throw new Error("running retry missing");
    const completedRetry = valueOf(completeDeliberationParticipantRetry(startedRetry, {
      expectedVersion: startedRetry.version,
      retryId,
      participantId: base.participants[1].id,
      attemptId: activeRetry.attempt.id,
      assessment: assessment(startedRetry.id, startedRetry.projectId, retryId, base.participants[1], retryManifest.requestHash, "b"),
    }, CLOCK));
    expect(completedRetry.status).toBe("reveal_ready");
    const completeReveal = valueOf(revealDeliberationRound(completedRetry, { expectedVersion: completedRetry.version, actor: USER, mode: "complete" }, CLOCK));
    expect(completeReveal).toMatchObject({ status: "difference_review", retry: { status: "completed", attempt: { sealed: false } } });
    expect(completeReveal.initialRound?.attempts[0].id).toBe(round.attempts[0].id);
    expect(prepareDeliberationChallenge(completeReveal, { expectedVersion: completeReveal.version, actor: USER, question: "Would this create a fifth call?", challengeId: base.ids.create("rdch_"), attemptIds: [base.ids.create("rdat_"), base.ids.create("rdat_")], manifests: base.manifests, sharedContextHash: "9".repeat(64) }, { clock: CLOCK })).toMatchObject({ ok: false, error: { code: "deliberation_round_limit_reached" } });
  });

  it("labels manual external opinions as non-blind unverified imports and never converts them into participants", () => {
    const base = prepared(55_000);
    const imported = valueOf(importManualExternalOpinion(base.room, {
      expectedVersion: base.room.version,
      actor: USER,
      sourceLabel: "External colleague note",
      providerClaim: "Unknown hosted assistant",
      modelClaim: "Claimed Model X",
      capturedAt: "2026-08-26T09:55:00.000Z",
      contextDisclosure: "The author saw the original question and Participant A's summary.",
      sawParticipantAOutput: true,
      sawParticipantBOutput: false,
      publicContent: "The observational design cannot establish causality.",
    }, { clock: CLOCK, idFactory: base.ids }));
    expect(imported.manualExternalOpinions[0]).toMatchObject({
      capturedAt: "2026-08-26T09:55:00.000Z",
      exposure: { sawParticipantAOutput: true, sawParticipantBOutput: false },
      blindnessVerification: "not_verifiable",
      classification: "manual_non_blind",
      verification: "unverified_external_import",
      authority: "external_claim_only",
      canActAsParticipant: false,
      canResolveRoom: false,
    });
    expect(imported.participants).toEqual(base.participants);
  });

  it("keeps canonical research objects unchanged until a separate authority action and appends superseding user resolutions", () => {
    const base = bothComplete(56_000);
    const revealed = valueOf(revealDeliberationRound(base.room, { expectedVersion: base.room.version, actor: USER, mode: "complete" }, CLOCK));
    const waiting = valueOf(waitForDeliberationResolution(revealed, { expectedVersion: revealed.version, actor: USER }, CLOCK));
    const modelResolution = resolveDeliberationRoom(waiting, { expectedVersion: waiting.version, actor: MODEL, kind: "keep_disputed", publicReason: "Model cannot decide." }, { clock: CLOCK, idFactory: base.ids });
    expect(modelResolution).toMatchObject({ ok: false, error: { code: "user_deliberation_action_required" } });

    const resolved = valueOf(resolveDeliberationRoom(waiting, { expectedVersion: waiting.version, actor: USER, kind: "combine_edit", publicReason: "Keep the association and remove causal wording.", combinedText: "Report an association; causal identification remains unproven." }, { clock: CLOCK, idFactory: base.ids }));
    expect(resolved).toMatchObject({ status: "resolved", resolutions: [{ kind: "combine_edit", authority: { actor: { kind: "user" } }, receipt: { roomScopeOnly: true, canonicalMutationAuthorized: false, separateAuthorityRequired: true } }] });
    expect(resolved.resolutions[0]?.receipt.unproven).toEqual(expect.arrayContaining(["mutual_cognitive_independence", "repeatable_non_redundant_value_in_real_cases", "external_user_value"]));

    const superseded = valueOf(resolveDeliberationRoom(resolved, { expectedVersion: resolved.version, actor: USER, kind: "request_evidence", publicReason: "Request the identification strategy before adopting wording." }, { clock: CLOCK, idFactory: base.ids }));
    expect(superseded.resolutions).toHaveLength(2);
    expect(superseded.resolutions[1]?.supersedesResolutionId).toBe(resolved.resolutions[0]?.id);
  });
});
