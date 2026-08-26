import { describe, expect, it } from "vitest";
import {
  FixedClock,
  SequenceIdFactory,
  cancelCorrectionAppealSecondOpinion,
  completeCorrectionAppealSecondOpinion,
  createCorrectionAppeal,
  deriveAppealComparison,
  failCorrectionAppealSecondOpinion,
  markCorrectionAppealRecordOnly,
  parseCorrectionAppeal,
  prepareCorrectionAppealSecondOpinion,
  recordCorrectionAppeal,
  resolveCorrectionAppeal,
  stableResearchHash,
  startCorrectionAppealSecondOpinion,
  updateCorrectionAppealStatement,
  type AppealSourceBinding,
  type AppealStatement,
  type ResearchActor,
  type SecondOpinionManifest,
  type SecondOpinionResult,
} from "../src/index.js";

const USER: ResearchActor = { kind: "user", actorId: "research-owner" };
const MODEL: ResearchActor = { kind: "model", model: "semantic-judge" };
const CLOCK = new FixedClock("2026-08-26T02:00:00.000Z");
const CRITERION_DEFINITION = "Does the frozen input introduce a conclusion without the premises required to support it?";

function challengedCriterionHash(): string {
  const result = stableResearchHash({ id: "argument-leap", definition: CRITERION_DEFINITION, version: "1.0.0" });
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

function ids(seed = 4_900): SequenceIdFactory {
  return new SequenceIdFactory(seed);
}

function source(factory = ids()): AppealSourceBinding {
  const projectId = factory.create("rprj_");
  const findingId = factory.create("rfnd_");
  const findingSnapshot = {
    id: findingId,
    kind: "argument_leap",
    severity: "warning" as const,
    rationale: "The causal mechanism is asserted without a linking premise.",
    minimumRecovery: "Add the missing premise or narrow the claim.",
    decisionIds: [],
    issueIds: [],
    authority: "model_proposed" as const,
  };
  const createdStateBinding = {
    projectId,
    stateHash: "f".repeat(64),
    briefVersionId: factory.create("rbrf_"),
    briefVersionNumber: 3,
    decisions: [],
    issues: [],
  };
  const findingHash = stableResearchHash(findingSnapshot);
  const createdStateBindingHash = stableResearchHash(createdStateBinding);
  if (!findingHash.ok || !createdStateBindingHash.ok) throw new Error("hash failed");
  return {
    projectId,
    reviewId: factory.create("rrvw_"),
    receiptId: factory.create("rrcp_"),
    findingId,
    findingSchemaVersion: "1.0.0",
    findingSnapshot,
    findingHash: findingHash.value,
    suggestionHash: "b".repeat(64),
    sourceReceiptHash: "c".repeat(64),
    inputBindings: [{
      artifactId: factory.create("rart_"),
      revisionId: factory.create("rrev_"),
      normalizedTextHash: "d".repeat(64),
    }],
    rubric: { criterionId: "argument-leap", version: "1.0.0", definition: CRITERION_DEFINITION, hash: challengedCriterionHash(), sourceRubricHash: "e".repeat(64) },
    createdStateBinding,
    createdStateBindingHash: createdStateBindingHash.value,
  };
}

function statement(): AppealStatement {
  return {
    disagreement: "The finding treats an explicitly bounded interpretation as a causal claim.",
    challengedCriterionId: "argument-leap",
    claimedError: "The cited sentence is conditional, not causal.",
    missingOrMisreadContext: "The preceding paragraph defines the statement as a sensitivity scenario.",
    secondOpinionQuestion: "Does the frozen input actually assert an unsupported causal mechanism?",
    desiredDisposition: "modify_finding_interpretation",
  };
}

function created(seed = 4_900) {
  const factory = ids(seed);
  const result = createCorrectionAppeal({ source: source(factory), statement: statement(), actor: USER }, { clock: CLOCK, idFactory: factory });
  if (!result.ok) throw new Error(result.error.code);
  return { appeal: result.value, factory };
}

function secondResult(appealId: string, attemptId: string): SecondOpinionResult {
  return {
    schemaVersion: "1.0.0",
    appealId,
    attemptId,
    criterionId: "argument-leap",
    assessment: "not_present",
    evidenceSpans: [{
      projectId: source(ids(8_000)).projectId,
      artifactId: ids(8_100).create("rart_"),
      revisionId: ids(8_200).create("rrev_"),
      normalizedTextHash: "d".repeat(64),
      start: 0,
      end: 12,
      quote: "bounded text",
      quoteHash: "2".repeat(64),
      normalizationVersion: "unicode-nfc-lf-v1",
      indexUnit: "unicode_code_point",
    }],
    publicRationale: "The frozen sentence is explicitly conditional and does not assert causality.",
    missingContext: [],
    alternativeExplanations: ["The original finding may have treated a scenario statement as an empirical claim."],
    minimalCorrection: "Qualify the original finding as applying only if the surrounding condition is removed.",
    uncertaintySources: ["Only the frozen input was assessed."],
    hashes: {
      schemaHash: "3".repeat(64),
      rubricHash: challengedCriterionHash(),
      requestHash: "4".repeat(64),
      inputHash: "d".repeat(64),
    },
  };
}

function secondOpinionManifest(stateBindingHash: string): SecondOpinionManifest {
  const withoutCanonicalHash = {
    schemaVersion: "1.0.0" as const,
    requestHash: "4".repeat(64),
    requestBodyHash: "7".repeat(64),
    requestBodyBytes: 512,
    includedFields: ["frozen_input", "criterion_rubric", "user_second_opinion_question"],
    includedObjects: [],
    excludedFields: ["original_finding_verdict", "original_finding_public_rationale", "original_finding_confidence", "original_verdict", "original_public_rationale", "original_confidence", "original_provider_raw_response", "other_agent_assessments"],
    tokenEstimate: { status: "unavailable" as const },
    costEstimate: { status: "unavailable" as const },
    stateBindingHash,
  };
  const canonical = stableResearchHash(withoutCanonicalHash);
  if (!canonical.ok) throw new Error(canonical.error.code);
  return { ...withoutCanonicalHash, canonicalHash: canonical.value };
}

describe("RI-49 correction appeal domain", () => {
  it("rejects a persisted appeal whose transition history skips a legal lifecycle step", () => {
    const { appeal } = created(4_850);
    const forged = {
      ...appeal,
      status: "appeal_record_only",
      transitions: [
        ...appeal.transitions,
        {
          from: "draft",
          to: "appeal_record_only",
          actor: "kernel",
          at: "2026-08-26T02:00:01.000Z",
          reason: "forged_transition",
        },
      ],
      version: 2,
      updatedAt: "2026-08-26T02:00:01.000Z",
    };

    expect(parseCorrectionAppeal(forged)).toMatchObject({
      ok: false,
      error: { code: "invalid_correction_appeal" },
    });
  });

  it("freezes the original Finding and only a user can record or resolve the appeal", () => {
    const { appeal } = created();
    expect(appeal.status).toBe("draft");
    expect(Object.isFrozen(appeal.source.findingSnapshot)).toBe(true);
    expect(recordCorrectionAppeal(appeal, { actor: MODEL, expectedVersion: appeal.version }, CLOCK)).toMatchObject({
      ok: false,
      error: { code: "user_appeal_action_required" },
    });

    const recorded = recordCorrectionAppeal(appeal, { actor: USER, expectedVersion: appeal.version }, CLOCK);
    expect(recorded.ok).toBe(true);
    if (!recorded.ok) return;
    const localOnly = markCorrectionAppealRecordOnly(recorded.value, { expectedVersion: recorded.value.version }, CLOCK);
    expect(localOnly.ok).toBe(true);
    if (!localOnly.ok) return;
    expect(localOnly.value.status).toBe("appeal_record_only");

    expect(resolveCorrectionAppeal(localOnly.value, {
      actor: MODEL,
      expectedVersion: localOnly.value.version,
      kind: "uphold_original_finding",
      publicReason: "A model cannot decide this.",
    }, { clock: CLOCK, idFactory: ids(6_000) })).toMatchObject({ ok: false, error: { code: "user_appeal_action_required" } });

    const resolved = resolveCorrectionAppeal(localOnly.value, {
      actor: USER,
      expectedVersion: localOnly.value.version,
      kind: "modify_finding_interpretation",
      publicReason: "The finding remains useful only for unconditional causal wording.",
    }, { clock: CLOCK, idFactory: ids(6_100) });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value.status).toBe("resolved");
    expect(resolved.value.source.findingSnapshot).toEqual(appeal.source.findingSnapshot);
    expect(resolved.value.resolutions).toHaveLength(1);
    expect(resolved.value.resolutions[0]).toMatchObject({
      kind: "modify_finding_interpretation",
      authority: { actor: { kind: "user" } },
      receipt: { originalFindingHash: appeal.source.findingHash },
    });
  });

  it("uses expected-version transitions and appends a superseding resolution without overwriting history", () => {
    const { appeal, factory } = created(5_000);
    const updated = updateCorrectionAppealStatement(appeal, {
      actor: USER,
      expectedVersion: appeal.version,
      statement: { ...statement(), claimedError: "The original criterion was applied to the wrong sentence." },
    }, CLOCK);
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updateCorrectionAppealStatement(updated.value, {
      actor: USER,
      expectedVersion: appeal.version,
      statement: statement(),
    }, CLOCK)).toMatchObject({ ok: false, error: { code: "version_conflict" } });

    const recorded = recordCorrectionAppeal(updated.value, { actor: USER, expectedVersion: updated.value.version }, CLOCK);
    if (!recorded.ok) throw new Error(recorded.error.code);
    const localOnly = markCorrectionAppealRecordOnly(recorded.value, { expectedVersion: recorded.value.version }, CLOCK);
    if (!localOnly.ok) throw new Error(localOnly.error.code);
    const first = resolveCorrectionAppeal(localOnly.value, {
      actor: USER,
      expectedVersion: localOnly.value.version,
      kind: "defer_insufficient_evidence",
      publicReason: "The frozen context is not sufficient yet.",
    }, { clock: CLOCK, idFactory: factory });
    if (!first.ok) throw new Error(first.error.code);
    const second = resolveCorrectionAppeal(first.value, {
      actor: USER,
      expectedVersion: first.value.version,
      kind: "record_disagreement_without_resolution",
      publicReason: "Keep the disagreement visible without treating either assessment as final truth.",
    }, { clock: CLOCK, idFactory: factory });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.resolutions).toHaveLength(2);
    expect(second.value.resolutions[1]?.supersedesResolutionId).toBe(second.value.resolutions[0]?.id);
  });

  it("requires a fresh explicit Manifest confirmation for one isolated attempt and fences cancellation", () => {
    const { appeal, factory } = created(5_200);
    const recorded = recordCorrectionAppeal(appeal, { actor: USER, expectedVersion: appeal.version }, CLOCK);
    if (!recorded.ok) throw new Error(recorded.error.code);
    const prepared = prepareCorrectionAppealSecondOpinion(recorded.value, {
      actor: USER,
      expectedVersion: recorded.value.version,
      participant: {
        connectionId: "second-opinion-local",
        providerId: "loopback-independent",
        family: "openai_compatible",
        model: "independent-model",
        endpointIdentityHash: "5".repeat(64),
        configGeneration: 1,
        locality: "local",
      },
      independenceBasis: {
        status: "runtime_and_context_isolated",
        originalConnectionId: "primary-judge",
        secondConnectionId: "second-opinion-local",
        identityComparison: "different_runtime_identity",
        contextIsolation: "original_verdict_reason_confidence_and_raw_response_excluded",
      },
      manifest: secondOpinionManifest(appeal.source.createdStateBindingHash),
    }, { clock: CLOCK, idFactory: factory });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.value.status).toBe("awaiting_send_confirmation");
    expect(prepared.value.attempts).toHaveLength(1);

    const attempt = prepared.value.attempts[0];
    if (attempt === undefined) throw new Error("missing attempt");
    const started = startCorrectionAppealSecondOpinion(prepared.value, {
      actor: USER,
      expectedVersion: prepared.value.version,
      attemptId: attempt.id,
      confirmationNonce: attempt.confirmationNonce,
      manifestHash: attempt.manifest.canonicalHash,
    }, CLOCK);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.value.status).toBe("second_opinion_running");

    const cancelled = cancelCorrectionAppealSecondOpinion(started.value, {
      actor: USER,
      expectedVersion: started.value.version,
      attemptId: attempt.id,
    }, CLOCK);
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) return;
    expect(cancelled.value.status).toBe("cancelled");
    expect(completeCorrectionAppealSecondOpinion(cancelled.value, {
      expectedVersion: cancelled.value.version,
      attemptId: attempt.id,
      result: secondResult(cancelled.value.id, attempt.id),
      comparison: deriveAppealComparison({
        originalAssessment: "present",
        originalEvidenceHashes: ["2".repeat(64)],
        secondOpinion: secondResult(cancelled.value.id, attempt.id),
      }),
    }, CLOCK)).toMatchObject({ ok: false, error: { code: "invalid_appeal_transition" } });
  });

  it("preserves a failed attempt, allows a newly confirmed retry, and deterministically compares normalized results", () => {
    const { appeal, factory } = created(5_500);
    const recorded = recordCorrectionAppeal(appeal, { actor: USER, expectedVersion: appeal.version }, CLOCK);
    if (!recorded.ok) throw new Error(recorded.error.code);
    const first = prepareCorrectionAppealSecondOpinion(recorded.value, {
      actor: USER,
      expectedVersion: recorded.value.version,
      participant: {
        connectionId: "second-opinion-local",
        providerId: "loopback-independent",
        family: "openai_compatible",
        model: "independent-model",
        endpointIdentityHash: "5".repeat(64),
        configGeneration: 1,
        locality: "local",
      },
      independenceBasis: {
        status: "runtime_and_context_isolated",
        originalConnectionId: "primary-judge",
        secondConnectionId: "second-opinion-local",
        identityComparison: "different_runtime_identity",
        contextIsolation: "original_verdict_reason_confidence_and_raw_response_excluded",
      },
      manifest: secondOpinionManifest(appeal.source.createdStateBindingHash),
    }, { clock: CLOCK, idFactory: factory });
    if (!first.ok) throw new Error(first.error.code);
    const firstAttempt = first.value.attempts[0];
    if (firstAttempt === undefined) throw new Error("missing attempt");
    const running = startCorrectionAppealSecondOpinion(first.value, {
      actor: USER,
      expectedVersion: first.value.version,
      attemptId: firstAttempt.id,
      confirmationNonce: firstAttempt.confirmationNonce,
      manifestHash: firstAttempt.manifest.canonicalHash,
    }, CLOCK);
    if (!running.ok) throw new Error(running.error.code);
    const failed = failCorrectionAppealSecondOpinion(running.value, {
      expectedVersion: running.value.version,
      attemptId: firstAttempt.id,
      failure: "provider_timeout",
    }, CLOCK);
    expect(failed.ok).toBe(true);
    if (!failed.ok) return;
    expect(failed.value.attempts[0]?.status).toBe("failed");

    const comparison = deriveAppealComparison({
      originalAssessment: "present",
      originalEvidenceHashes: ["9".repeat(64)],
      secondOpinion: secondResult(failed.value.id, firstAttempt.id),
    });
    expect(comparison).toMatchObject({
      relation: "direct_contradiction",
      alternativeExplanation: true,
      nonRedundantIncrement: "present",
      authority: "system_derived",
      canResolveAppeal: false,
    });
  });
});
