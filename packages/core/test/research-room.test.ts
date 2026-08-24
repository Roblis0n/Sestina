import { readFile, rm, mkdtemp } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  openSestina,
  type CoreResult,
  type ResearchRoomAnalysisPayload,
  type ResearchRoomProvider,
  type SestinaCore,
} from "../src/index.js";
import { createStableTextSpan, type ResearchRoomSemanticJudgeRequest, type ResearchRoomSemanticJudgeResponse } from "@sestina/review";
import { parseResearchRoomReceipt, stableResearchHash } from "@sestina/research";

const USER = { kind: "user", actorId: "ri48-owner" } as const;
const MODEL = { kind: "model", provider: "fixture", model: "deterministic" } as const;
const roots: string[] = [];
const cores: SestinaCore[] = [];

function valueOf<T>(result: CoreResult<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

function semanticPayload(overrides: Partial<ResearchRoomAnalysisPayload> = {}): ResearchRoomAnalysisPayload {
  return {
    schemaVersion: "1.0.0",
    proposal: "Keep the current research question and add one bounded qualification.",
    findings: [{
      kind: "reasonable_increment",
      severity: "info",
      summary: "The suggestion adds a bounded qualification without replacing the target.",
      affectedDecisionIds: [],
    }],
    argumentDelta: {
      kind: "boundary_condition",
      summary: "Adds one explicit boundary condition.",
      genuineAdditions: ["Adds an explicit uncertainty boundary."],
    },
    alternativeExplanations: ["Selection may explain the observed association."],
    unknowns: ["The interval width is not yet known."],
    minimalCorrection: "Keep the association wording and add the interval when available.",
    unproven: ["A causal effect remains unproven."],
    ...overrides,
  };
}

class FixtureProvider implements ResearchRoomProvider {
  readonly id = "ri48-deterministic-fixture";
  readonly kind = "deterministic_fixture" as const;
  readonly networkAccess = "none" as const;
  readonly binding = Object.freeze({
    id: this.id,
    family: "openai_compatible" as const,
    model: "deterministic",
    baseUrlOrigin: "http://127.0.0.1:1",
    locality: "local" as const,
    configGeneration: 1,
  });
  readonly calls: unknown[] = [];
  constructor(private readonly response?: unknown, private readonly failure?: Error) {}
  prepare(request: ResearchRoomSemanticJudgeRequest) {
    const requestBody = JSON.stringify(request);
    return Object.freeze({
      schemaVersion: "1.0.0" as const,
      endpoint: "http://127.0.0.1:1/v1/chat/completions",
      provider: this.binding,
      requestHash: request.requestHash,
      requestBody,
      requestBodyHash: createHash("sha256").update(requestBody, "utf8").digest("hex"),
      requestBodyBytes: Buffer.byteLength(requestBody, "utf8"),
      responseLimitBytes: request.limits.maxResponseBytes,
      redirectPolicy: "error" as const,
      retryCount: 0 as const,
    });
  }
  analyze(request: ResearchRoomSemanticJudgeRequest, preview: unknown): Promise<unknown> {
    this.calls.push(structuredClone({ request, preview }));
    if (this.failure) return Promise.reject(this.failure);
    return Promise.resolve(structuredClone(this.response ?? semanticJudgeResponse(request)));
  }
}

function semanticJudgeResponse(request: ResearchRoomSemanticJudgeRequest): ResearchRoomSemanticJudgeResponse {
  const span = createStableTextSpan(request.context.suggestionDocument, 0, request.context.suggestionDocument.normalizedText.length);
  if (!span.ok) throw new Error(span.error.code);
  return {
    schemaVersion: "1.0.0",
    protocolVersion: request.protocol.version,
    protocolHash: request.protocol.hash,
    promptVersion: request.prompt.version,
    promptHash: request.prompt.hash,
    rubricVersion: request.rubric.version,
    rubricHash: request.rubric.hash,
    reviewId: request.reviewId,
    projectId: request.projectId,
    stateBindingHash: request.stateBindingHash,
    requestHash: request.requestHash,
    provider: request.provider,
    assessments: request.criteria.map((criterion) => ({
      criterionId: criterion.id,
      verdict: criterion.id === "argument-delta" ? "positive" as const : "negative" as const,
      evidenceSpans: [span.value],
      referencedDecisionIds: [],
      referencedIssueIds: [],
      publicRationale: criterion.id === "argument-delta" ? "The suggestion adds one bounded reporting qualification." : `No ${criterion.positiveMeaning} is present.`,
      minimalCorrection: "No correction is proposed.",
      uncertainty: "No material uncertainty in the cited suggestion span.",
      missingContext: [],
    })),
  };
}

interface FixtureState {
  readonly root: string;
  readonly core: SestinaCore;
  readonly projectId: string;
  readonly briefVersionId: string;
  readonly decisionId: string;
  readonly issueId: string;
  readonly episodeId: string;
}

async function fixture(provider?: ResearchRoomProvider): Promise<FixtureState> {
  const root = await mkdtemp(join(tmpdir(), "sestina-ri48-core-"));
  roots.push(root);
  const opened = await openSestina({
    databasePath: join(root, "state.sqlite"),
    ...(provider === undefined ? {} : { researchRoomProvider: provider }),
  });
  const core = valueOf(opened); cores.push(core);
  const project = valueOf(core.initializeProject({ title: "Synthetic Research Room", actor: USER }));
  const artifact = valueOf(core.createArtifactWithInitialRevision({
    projectId: project.id, actor: USER, kind: "research_note", relativePath: "synthetic/note.md",
    content: "# Synthetic note\n\nThe observed association is descriptive.\n", mediaType: "text/markdown",
  }));
  valueOf(core.activateBrief({
    projectId: project.id, actor: USER,
    projectQuestion: "How should a synthetic observational association be reported?",
    currentStage: "revision", currentTask: "Add a bounded uncertainty statement.",
    targetArtifacts: [artifact.artifact.id],
    fixedDecisions: [{ statement: "Do not infer causality from the synthetic observational design.", scope: { target: { kind: "project_path", relativePath: "synthetic" }, operations: ["rewrite"] } }],
    allowedChanges: [{ target: { kind: "artifact", artifactId: artifact.artifact.id }, operations: ["add", "rewrite"] }],
    forbiddenChanges: [{ target: { kind: "project_path", relativePath: "synthetic" }, operations: ["delete"] }],
    expectedDeltas: [{ statement: "Add one evidence-bounded qualification.", scope: { target: { kind: "artifact", artifactId: artifact.artifact.id }, operations: ["add"] } }],
    evidenceBoundaries: [{ statement: "The design cannot identify a causal effect.", scope: { target: { kind: "project_path", relativePath: "synthetic" }, operations: ["rewrite"] }, forbiddenInferenceKinds: ["causal"] }],
    explicitNonGoals: ["Replace the research object", "Collect external participant data"],
  }));
  const briefState = valueOf(core.getBriefState(project.id));
  if (briefState === undefined) throw new Error("brief missing");
  const decision = valueOf(core.recordDecision({
    projectId: project.id, actor: USER, statement: "Retain an observational interpretation.",
    scope: { kind: "project" }, rationale: "The fixture has no randomized assignment.",
    effectiveBriefVersionId: briefState.version.id, reopenConditions: ["Randomized evidence is supplied."], status: "accepted",
  }));
  const issue = valueOf(core.openIssue({
    projectId: project.id, actor: MODEL, kind: "evidence_boundary", target: { kind: "artifact", artifactId: artifact.artifact.id },
    violatedCriterion: "uncertainty_interval_missing", rationaleConcepts: ["uncertainty", "precision"],
    summary: "The synthetic estimate has no uncertainty interval.", sourceArtifactId: artifact.artifact.id,
    sourceRevisionId: artifact.revision.id, sourceRevisionContentHash: artifact.revision.content.contentHash,
    lineageRootRevisionId: artifact.revision.id,
  }));
  const episode = valueOf(core.startRevisionEpisode({
    projectId: project.id, artifactId: artifact.artifact.id, briefVersionId: briefState.version.id,
    baselineRevisionId: artifact.revision.id, actor: USER,
  }));
  return { root, core, projectId: project.id, briefVersionId: briefState.version.id, decisionId: decision.id, issueId: issue.id, episodeId: episode.id };
}

async function analyzed(state: FixtureState, evidenceClass: "synthetic_fixture" | "synthetic_adversarial_fixture" = "synthetic_fixture") {
  const prepared = valueOf(state.core.prepareResearchRoomReview({
    projectId: state.projectId,
    suggestion: "Add the uncertainty interval and retain the observational limitation.",
    evidenceClass,
    countsAsExternalEvidence: false,
  }));
  return valueOf(await state.core.analyzeResearchRoomSuggestion({
    reviewId: prepared.reviewId,
    confirmationNonce: prepared.confirmationNonce,
    manifestHash: prepared.manifestHash,
  }));
}

afterEach(async () => {
  for (const core of cores.splice(0)) core.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("RI-48 Research Deliberation Kernel", () => {
  it("cancels a prepared review before send and invalidates its confirmation", async () => {
    const provider = new FixtureProvider(); const state = await fixture(provider);
    const prepared = valueOf(state.core.prepareResearchRoomReview({ projectId: state.projectId, suggestion: "Keep this local and bounded.", evidenceClass: "synthetic_fixture", countsAsExternalEvidence: false }));
    expect(state.core.cancelResearchRoomReview({ reviewId: prepared.reviewId, confirmationNonce: prepared.confirmationNonce, manifestHash: prepared.manifestHash })).toEqual({ ok: true, value: { cancelled: true } });
    expect(await state.core.analyzeResearchRoomSuggestion({ reviewId: prepared.reviewId, confirmationNonce: prepared.confirmationNonce, manifestHash: prepared.manifestHash })).toMatchObject({ ok: false, error: { code: "user_confirmation_required" } });
    expect(provider.calls).toHaveLength(0);
    expect(valueOf(state.core.listResearchRoomReceipts(state.projectId))).toHaveLength(0);
  });

  it("shows an exact Context Manifest before invoking any Provider and does not write before Authority Gate", async () => {
    const provider = new FixtureProvider(); const state = await fixture(provider);
    const before = valueOf(state.core.listResearchRoomReceipts(state.projectId));
    const prepared = valueOf(state.core.prepareResearchRoomReview({
      projectId: state.projectId, suggestion: "Add a bounded interval.", evidenceClass: "synthetic_fixture", countsAsExternalEvidence: false,
    }));
    expect(provider.calls).toHaveLength(0);
    expect(prepared).toMatchObject({ contextManifestVisible: true, providerStatus: "ready" });
    expect(prepared.manifest).toMatchObject({ sendStatus: "not_sent", networkRequired: false, countsAsExternalEvidence: false });
    expect(prepared.manifest.fields.map((field) => field.category)).toEqual(expect.arrayContaining([
      "research_question", "current_stage", "current_task", "fixed_decisions", "expected_deltas", "evidence_boundaries", "explicit_non_goals", "accepted_decisions", "issue_history", "receipt_summary", "current_episode", "single_suggestion", "semantic_criteria",
    ]));
    const semanticManifest = prepared.manifest.semanticJudge;
    expect(semanticManifest).toBeDefined();
    if (semanticManifest === undefined) throw new Error("missing Semantic Judge manifest");
    expect(semanticManifest.provider).toMatchObject({ family: "openai_compatible", model: "deterministic", configGeneration: 1 });
    expect(semanticManifest.request.retryCount).toBe(0);
    expect(semanticManifest.request.redirectPolicy).toBe("error");
    expect(semanticManifest.request.requestHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(semanticManifest.request.requestBodyHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(valueOf(state.core.listResearchRoomReceipts(state.projectId))).toEqual(before);

    const wrong = await state.core.analyzeResearchRoomSuggestion({ reviewId: prepared.reviewId, confirmationNonce: "wrong", manifestHash: prepared.manifestHash });
    expect(wrong).toMatchObject({ ok: false, error: { code: "user_confirmation_required" } });
    expect(provider.calls).toHaveLength(0);

    const result = valueOf(await state.core.analyzeResearchRoomSuggestion({
      reviewId: prepared.reviewId, confirmationNonce: prepared.confirmationNonce, manifestHash: prepared.manifestHash,
    }));
    expect(provider.calls).toHaveLength(1);
    expect(result).toMatchObject({ providerStatus: "semantic_ready", manifest: { sendStatus: "sent_to_provider", networkUsed: false } });
    expect(result.semanticJudge).toMatchObject({ reasonableIncrement: { status: "supported", authority: "system_derived", canMutateAuthority: false } });
    expect(valueOf(state.core.listResearchRoomReceipts(state.projectId))).toEqual(before);
  });

  it("rejects external-evidence inflation and blocks model, wrong nonce, stale state and replayed commits without partial writes", async () => {
    const state = await fixture(new FixtureProvider());
    expect(state.core.prepareResearchRoomReview({
      projectId: state.projectId, suggestion: "Synthetic", evidenceClass: "synthetic_fixture", countsAsExternalEvidence: true,
    })).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    const review = await analyzed(state);
    const badActor = state.core.commitResearchRoomDisposition({
      projectId: state.projectId, reviewId: review.reviewId, authorityNonce: review.authorityNonce,
      expectedStateBinding: review.stateBinding, disposition: "accepted", reason: "Model tries to decide.", actor: MODEL,
    });
    expect(badActor).toMatchObject({ ok: false, error: { code: "user_confirmation_required" } });
    const badNonce = state.core.commitResearchRoomDisposition({
      projectId: state.projectId, reviewId: review.reviewId, authorityNonce: "wrong",
      expectedStateBinding: review.stateBinding, disposition: "accepted", reason: "Wrong nonce.", actor: USER,
    });
    expect(badNonce).toMatchObject({ ok: false, error: { code: "user_confirmation_required" } });
    expect(valueOf(state.core.listResearchRoomReceipts(state.projectId))).toHaveLength(0);

    valueOf(state.core.recordDecision({
      projectId: state.projectId, actor: USER, statement: "A concurrent owner decision.", scope: { kind: "project" },
      rationale: "Force a state binding conflict.", effectiveBriefVersionId: state.briefVersionId, reopenConditions: [], status: "accepted",
    }));
    expect(state.core.commitResearchRoomDisposition({
      projectId: state.projectId, reviewId: review.reviewId, authorityNonce: review.authorityNonce,
      expectedStateBinding: review.stateBinding, disposition: "accepted", reason: "Now stale.", actor: USER,
    })).toMatchObject({ ok: false, error: { code: "stale_state" } });
    expect(valueOf(state.core.listResearchRoomReceipts(state.projectId))).toHaveLength(0);

    const fresh = await analyzed(state);
    const committed = valueOf(state.core.commitResearchRoomDisposition({
      projectId: state.projectId, reviewId: fresh.reviewId, authorityNonce: fresh.authorityNonce,
      expectedStateBinding: fresh.stateBinding, disposition: "accepted", reason: "Owner accepts the bounded addition.", actor: USER,
    }));
    expect(committed).toMatchObject({ disposition: { kind: "accepted" }, evidenceClass: "synthetic_fixture", countsAsExternalEvidence: false, version: 1 });
    expect(state.core.commitResearchRoomDisposition({
      projectId: state.projectId, reviewId: fresh.reviewId, authorityNonce: fresh.authorityNonce,
      expectedStateBinding: fresh.stateBinding, disposition: "accepted", reason: "Replay.", actor: USER,
    })).toMatchObject({ ok: false, error: { code: "user_confirmation_required" } });
    expect(valueOf(state.core.listResearchRoomReceipts(state.projectId))).toHaveLength(1);
  });

  it.each([
    ["accepted", {}],
    ["rejected", {}],
    ["modified_accepted", { modifiedProposal: "Keep the association claim and add a bounded interval." }],
    ["deferred", {}],
    ["direction_changed", { redirectQuestion: "How should the synthetic selection mechanism itself be studied?" }],
  ] as const)("persists a distinct %s user disposition and complete Episode receipt", async (disposition, extra) => {
    const state = await fixture(new FixtureProvider()); const review = await analyzed(state);
    const receipt = valueOf(state.core.commitResearchRoomDisposition({
      projectId: state.projectId, reviewId: review.reviewId, authorityNonce: review.authorityNonce,
      expectedStateBinding: review.stateBinding, disposition, reason: `Owner chose ${disposition}.`, actor: USER, ...extra,
    }));
    expect(receipt).toMatchObject({
      projectId: state.projectId, reviewId: review.reviewId, sourceEpisodeId: state.episodeId,
      disposition: { kind: disposition }, providerStatus: "semantic_ready", countsAsExternalEvidence: false,
      before: { briefVersionId: state.briefVersionId }, rollback: { available: true },
    });
    expect(typeof receipt.analysis.proposal).toBe("string");
    expect(receipt.analysis.argumentDelta).toBeTruthy();
    expect(Array.isArray(receipt.analysis.unproven)).toBe(true);
    expect(receipt.after.stateHash).toMatch(/^[0-9a-f]{64}$/);
    expect(receipt.receiptHash).toMatch(/^[0-9a-f]{64}$/);
    if (disposition === "direction_changed") {
      expect(valueOf(state.core.getBriefState(state.projectId))?.version.projectQuestion).toBe(extra.redirectQuestion);
      expect(receipt.after.briefVersionId).not.toBe(receipt.before.briefVersionId);
    }
  });

  it("degrades unavailable, failed, timed-out and invalid Providers to explicit ledger_only without semantic claims", async () => {
    for (const provider of [undefined, new FixtureProvider(undefined, new Error("offline")), new FixtureProvider({ ...semanticPayload(), disposition: "accepted" })]) {
      const state = await fixture(provider); const result = await analyzed(state);
      expect(result.providerStatus).toBe("ledger_only");
      expect(result.analysis).toMatchObject({
        findings: [expect.objectContaining({ kind: "provider_unavailable" })],
        argumentDelta: { kind: "unproven", genuineAdditions: [] },
      });
      expect(result.analysis.unproven.some((item) => item.includes("Semantic"))).toBe(true);
      expect(result.manifest.networkUsed).toBe(false);
      expect(valueOf(state.core.listResearchRoomReceipts(state.projectId))).toHaveLength(0);
      expect(state.core.commitResearchRoomDisposition({
        projectId: state.projectId, reviewId: result.reviewId, authorityNonce: result.authorityNonce,
        expectedStateBinding: result.stateBinding, disposition: "accepted", reason: "Cannot accept an unreviewed semantic claim.", actor: USER,
      })).toMatchObject({ ok: false, error: { code: "review_blocked" } });
      const deferred = valueOf(state.core.commitResearchRoomDisposition({
        projectId: state.projectId, reviewId: result.reviewId, authorityNonce: result.authorityNonce,
        expectedStateBinding: result.stateBinding, disposition: "deferred", reason: "Wait for a configured Provider.", actor: USER,
      }));
      expect(deferred).toMatchObject({ providerStatus: "ledger_only", disposition: { kind: "deferred" } });
    }
  });

  it("reopens persisted receipts after restart and rolls back an accepted decision to the exact prior semantic state", async () => {
    const provider = new FixtureProvider(); const state = await fixture(provider); const review = await analyzed(state);
    const receipt = valueOf(state.core.commitResearchRoomDisposition({
      projectId: state.projectId, reviewId: review.reviewId, authorityNonce: review.authorityNonce,
      expectedStateBinding: review.stateBinding, disposition: "direction_changed",
      redirectQuestion: "How should the synthetic selection mechanism itself be studied?",
      reason: "The owner explicitly changes direction.", actor: USER,
    }));
    const { receiptHash: _newHash, semanticJudge: _semanticJudge, manifest: newManifest, ...legacyBase } = receipt;
    const { semanticJudge: _manifestSemanticJudge, ...legacyManifest } = newManifest;
    void _newHash; void _semanticJudge; void _manifestSemanticJudge;
    const legacyPayload = { ...legacyBase, manifest: legacyManifest };
    const legacyHash = stableResearchHash(legacyPayload);
    if (!legacyHash.ok) throw new Error(legacyHash.error.code);
    expect(parseResearchRoomReceipt({ ...legacyPayload, receiptHash: legacyHash.value })).toMatchObject({
      ok: true,
      value: { id: receipt.id, providerStatus: "semantic_ready" },
    });
    state.core.close(); cores.splice(cores.indexOf(state.core), 1);
    const reopened = valueOf(await openSestina({ databasePath: join(state.root, "state.sqlite") })); cores.push(reopened);
    const restoredReceipts = valueOf(reopened.listResearchRoomReceipts(state.projectId));
    expect(restoredReceipts).toHaveLength(1);
    expect(restoredReceipts[0]).toMatchObject({ id: receipt.id, disposition: { kind: "direction_changed" } });
    expect(valueOf(reopened.getResearchRoomState(state.projectId)).stateBinding).toEqual(receipt.after);
    const rolledBack = valueOf(reopened.rollbackResearchRoomReceipt({
      projectId: state.projectId, receiptId: receipt.id, expectedVersion: receipt.version,
      reason: "Restore the previous research direction.", actor: USER,
    }));
    expect(rolledBack).toMatchObject({ status: "rolled_back", version: 2, rollback: { available: false, restoredStateHash: receipt.before.stateHash } });
    expect(valueOf(reopened.getBriefState(state.projectId))?.version.projectQuestion).toBe("How should a synthetic observational association be reported?");
    expect(reopened.rollbackResearchRoomReceipt({
      projectId: state.projectId, receiptId: receipt.id, expectedVersion: receipt.version,
      reason: "Replay rollback.", actor: USER,
    })).toMatchObject({ ok: false, error: { code: "stale_state" } });
  });

  it("keeps all RI-48 scenario fixtures synthetic, complete and machine-checkable", async () => {
    const fixtureRoot = resolve(import.meta.dirname, "../../../tests/fixtures/ri48");
    for (const file of ["reasonable-increment.json", "target-substitution.json", "repeated-audit.json"]) {
      const value = JSON.parse(await readFile(join(fixtureRoot, file), "utf8")) as Record<string, unknown>;
      expect(value).toMatchObject({ schemaVersion: "1.0.0", countsAsExternalEvidence: false });
      expect(["synthetic_fixture", "synthetic_adversarial_fixture"]).toContain(value.evidenceClass);
      expect(value).toHaveProperty("researchBrief.projectQuestion");
      expect(value).toHaveProperty("researchBrief.fixedDecision");
      expect(value).toHaveProperty("researchBrief.openIssue");
      expect(value).toHaveProperty("suggestion");
      expect(value).toHaveProperty("expected.findingKind");
      expect(value).toHaveProperty("expected.argumentDeltaKind");
      expect(value).toHaveProperty("expected.authorityBehavior");
    }
  });
});
