import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  openSestina,
  type CoreResult,
  type ResearchRoomProvider,
  type SestinaCore,
} from "../src/index.js";
import {
  createStableTextSpan,
  prepareCorrectionAppealSecondOpinionRequest,
  type CorrectionAppealSecondOpinionRequest,
  type CorrectionAppealSecondOpinionResponse,
  type ResearchRoomSemanticJudgeRequest,
  type ResearchRoomSemanticJudgeResponse,
} from "@sestina/review";
import { stableResearchHash, type AppealStatement } from "@sestina/research";

const USER = { kind: "user", actorId: "ri49-owner" } as const;
const roots: string[] = [];
const cores: SestinaCore[] = [];

function valueOf<T>(result: CoreResult<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

function sha(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function endpointIdentity(model: string, baseUrlOrigin: string): string {
  const result = stableResearchHash({ family: "openai_compatible", model, baseUrlOrigin });
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

function originalResponse(request: ResearchRoomSemanticJudgeRequest): ResearchRoomSemanticJudgeResponse {
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
      verdict: criterion.id === "argument-leap" || criterion.id === "argument-delta" ? "positive" as const : "negative" as const,
      evidenceSpans: [span.value],
      referencedDecisionIds: [],
      referencedIssueIds: [],
      publicRationale: criterion.id === "argument-leap"
        ? "The suggestion introduces a causal implication without a warrant."
        : criterion.id === "argument-delta"
          ? "The suggestion adds a bounded causal qualification."
          : `No ${criterion.positiveMeaning} is present.`,
      minimalCorrection: criterion.id === "argument-leap" ? "Remove the unsupported causal implication." : "No correction is proposed.",
      uncertainty: "The fixture is synthetic.",
      missingContext: [],
    })),
  };
}

class OriginalProvider implements ResearchRoomProvider {
  readonly id = "original-judge-connection";
  readonly kind = "deterministic_fixture" as const;
  readonly networkAccess = "none" as const;
  readonly binding = Object.freeze({
    id: this.id,
    family: "openai_compatible" as const,
    model: "original-judge",
    baseUrlOrigin: "http://127.0.0.1:18081",
    locality: "local" as const,
    configGeneration: 1,
  });
  prepare(request: ResearchRoomSemanticJudgeRequest) {
    const requestBody = JSON.stringify(request);
    return Object.freeze({
      schemaVersion: "1.0.0" as const,
      endpoint: "http://127.0.0.1:18081/v1/chat/completions",
      provider: this.binding,
      requestHash: request.requestHash,
      requestBody,
      requestBodyHash: sha(requestBody),
      requestBodyBytes: Buffer.byteLength(requestBody, "utf8"),
      responseLimitBytes: request.limits.maxResponseBytes,
      redirectPolicy: "error" as const,
      retryCount: 0 as const,
    });
  }
  analyze(request: ResearchRoomSemanticJudgeRequest): Promise<unknown> {
    return Promise.resolve(originalResponse(request));
  }
}

function secondOpinionResponse(request: CorrectionAppealSecondOpinionRequest): CorrectionAppealSecondOpinionResponse {
  const span = createStableTextSpan(request.context.frozenInput, 0, request.context.frozenInput.normalizedText.length);
  if (!span.ok) throw new Error(span.error.code);
  return {
    schemaVersion: "1.0.0",
    protocolVersion: request.protocol.version,
    protocolHash: request.protocol.hash,
    promptVersion: request.prompt.version,
    promptHash: request.prompt.hash,
    schemaHash: request.responseSchemaHash,
    rubricVersion: request.rubric.version,
    rubricHash: request.rubric.hash,
    appealId: request.appealId,
    attemptId: request.attemptId,
    projectId: request.projectId,
    requestHash: request.requestHash,
    inputHash: request.context.frozenInput.normalizedTextHash,
    criterionId: request.criterion.id,
    provider: request.provider,
    assessment: "not_present",
    evidenceSpans: [span.value],
    publicRationale: "The supplied sentence is explicitly bounded and does not assert a causal result.",
    missingContext: [],
    alternativeExplanations: ["The original judgment may have treated a proposed qualification as an assertion."],
    minimalCorrection: "Read the sentence as a boundary condition rather than a causal conclusion.",
    uncertaintySources: ["Only the frozen suggestion and explicitly selected project context were supplied."],
  };
}

class IndependentProvider {
  readonly id = "independent-second-opinion";
  readonly connectionId = "independent-second-opinion-connection";
  readonly kind = "deterministic_fixture" as const;
  readonly networkAccess = "none" as const;
  readonly endpointIdentityHash = endpointIdentity("independent-judge", "http://127.0.0.1:18082");
  readonly binding = Object.freeze({
    id: this.id,
    family: "openai_compatible" as const,
    model: "independent-judge",
    baseUrlOrigin: "http://127.0.0.1:18082",
    locality: "local" as const,
    configGeneration: 1,
  });
  readonly calls: unknown[] = [];
  prepare(request: CorrectionAppealSecondOpinionRequest) {
    const requestBody = JSON.stringify(request);
    return Object.freeze({
      schemaVersion: "1.0.0" as const,
      endpoint: "http://127.0.0.1:18082/v1/chat/completions",
      provider: this.binding,
      requestHash: request.requestHash,
      requestBody,
      requestBodyHash: sha(requestBody),
      requestBodyBytes: Buffer.byteLength(requestBody, "utf8"),
      responseLimitBytes: request.limits.maxResponseBytes,
      redirectPolicy: "error" as const,
      retryCount: 0 as const,
    });
  }
  analyze(request: CorrectionAppealSecondOpinionRequest, preview: unknown): Promise<unknown> {
    this.calls.push(structuredClone({ request, preview }));
    return Promise.resolve(secondOpinionResponse(request));
  }
}

interface Fixture {
  readonly root: string;
  readonly databasePath: string;
  readonly core: SestinaCore;
  readonly projectId: string;
  readonly receiptId: string;
  readonly findingId: string;
}

async function fixture(secondOpinionProvider?: IndependentProvider): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "sestina-ri49-core-"));
  roots.push(root);
  const databasePath = join(root, "state.sqlite");
  const core = valueOf(await openSestina({
    databasePath,
    researchRoomProvider: new OriginalProvider(),
    ...(secondOpinionProvider ? { correctionAppealSecondOpinionProvider: secondOpinionProvider } : {}),
  }));
  cores.push(core);
  const project = valueOf(core.initializeProject({ title: "RI-49 synthetic project", actor: USER }));
  const artifact = valueOf(core.createArtifactWithInitialRevision({
    projectId: project.id,
    actor: USER,
    kind: "research_note",
    relativePath: "synthetic/appeal.md",
    content: "# Synthetic\n\nThe association is observational.\n",
    mediaType: "text/markdown",
  }));
  valueOf(core.activateBrief({
    projectId: project.id,
    actor: USER,
    projectQuestion: "How should the observational association be interpreted?",
    currentStage: "revision",
    currentTask: "Keep the inference bounded.",
    targetArtifacts: [artifact.artifact.id],
    fixedDecisions: [{ statement: "Do not infer causality.", scope: { target: { kind: "project_path", relativePath: "synthetic" }, operations: ["rewrite"] } }],
    allowedChanges: [{ target: { kind: "artifact", artifactId: artifact.artifact.id }, operations: ["add", "rewrite"] }],
    forbiddenChanges: [{ target: { kind: "project_path", relativePath: "synthetic" }, operations: ["delete"] }],
    expectedDeltas: [{ statement: "Add one bounded qualification.", scope: { target: { kind: "artifact", artifactId: artifact.artifact.id }, operations: ["add"] } }],
    evidenceBoundaries: [{ statement: "The design cannot identify causality.", scope: { target: { kind: "project_path", relativePath: "synthetic" }, operations: ["rewrite"] }, forbiddenInferenceKinds: ["causal"] }],
    explicitNonGoals: ["Replace the research object"],
  }));
  const prepared = valueOf(core.prepareResearchRoomReview({
    projectId: project.id,
    suggestion: "Report the association as causal only after stating that the design cannot establish causality.",
    evidenceClass: "synthetic_fixture",
    countsAsExternalEvidence: false,
  }));
  const analyzed = valueOf(await core.analyzeResearchRoomSuggestion({
    reviewId: prepared.reviewId,
    confirmationNonce: prepared.confirmationNonce,
    manifestHash: prepared.manifestHash,
  }));
  const receipt = valueOf(core.commitResearchRoomDisposition({
    projectId: project.id,
    reviewId: analyzed.reviewId,
    authorityNonce: analyzed.authorityNonce,
    expectedStateBinding: analyzed.stateBinding,
    disposition: "rejected",
    reason: "Keep the original bounded interpretation.",
    actor: USER,
  }));
  const findingId = receipt.semanticJudge?.findings[0]?.id;
  if (findingId === undefined) throw new Error("semantic finding missing");
  return { root, databasePath, core, projectId: project.id, receiptId: receipt.id, findingId };
}

function appealStatement(): AppealStatement {
  return {
    disagreement: "The finding misreads a stated boundary as a causal conclusion.",
    challengedCriterionId: "argument-leap",
    claimedError: "The assessment treats a qualification as the claim it limits.",
    missingOrMisreadContext: "The same sentence says that the design cannot establish causality.",
    secondOpinionQuestion: "Does the frozen sentence actually contain an unsupported argument leap?",
    desiredDisposition: "overturn_original_finding",
  };
}

afterEach(async () => {
  for (const core of cores.splice(0)) core.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("RI-49 Correction Appeal Core", () => {
  it("records and resolves an appeal without requiring a second-opinion Provider, including restart", async () => {
    const state = await fixture();
    const created = valueOf(state.core.createCorrectionAppeal({
      projectId: state.projectId,
      receiptId: state.receiptId,
      findingId: state.findingId,
      statement: appealStatement(),
      actor: USER,
    }));
    expect(created).toMatchObject({ status: "draft", source: { receiptId: state.receiptId, findingId: state.findingId } });
    expect(valueOf(state.core.createCorrectionAppeal({
      projectId: state.projectId,
      receiptId: state.receiptId,
      findingId: state.findingId,
      statement: appealStatement(),
      actor: USER,
    })).id).toBe(created.id);

    const recorded = valueOf(state.core.recordCorrectionAppeal({ projectId: state.projectId, appealId: created.id, expectedVersion: created.version, actor: USER }));
    expect(recorded.status).toBe("appeal_record_only");
    expect(valueOf(state.core.listAppealProjections(state.projectId, { limit: 20 })).items).toEqual([
      expect.objectContaining({ kind: "appeal", id: created.id, findingId: state.findingId, status: "appeal_record_only" }),
    ]);
    expect(valueOf(state.core.getAppealProjection(state.projectId, created.id))).toMatchObject({
      id: created.id,
      source: { receiptId: state.receiptId, findingId: state.findingId },
      userAuthorityOnly: true,
      canAutoResolve: false,
    });
    expect(valueOf(state.core.getAttentionProjection(state.projectId)).items).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "appeal", id: created.id, href: `/project/appeals/${created.id}` }),
    ]));
    expect(valueOf(state.core.getProjectOverviewProjection(state.projectId, { providerStatus: "ledger_only" }))).toMatchObject({ counts: { appeals: 1 }, statuses: { appeals: { appeal_record_only: 1 } } });
    expect(valueOf(state.core.searchResearchObjects(state.projectId, { query: "misreads", limit: 20 })).items).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "appeal", id: created.id, href: `/project/appeals/${created.id}` }),
    ]));
    const receiptProjection = valueOf(state.core.getReceiptProjection(state.projectId, state.receiptId));
    expect(receiptProjection.correctionAppeals[0]).toMatchObject({ appealId: created.id, findingId: state.findingId, status: "appeal_record_only" });
    expect(receiptProjection.appealableFindings[0]).toMatchObject({ findingId: state.findingId, appealId: created.id, action: "open_appeal" });
    expect(receiptProjection.trace.some((entry) => entry.step === "correction_appeal")).toBe(true);
    state.core.close();
    cores.splice(cores.indexOf(state.core), 1);
    const reopened = valueOf(await openSestina({ databasePath: state.databasePath }));
    cores.push(reopened);
    expect(valueOf(reopened.getCorrectionAppeal(state.projectId, created.id))).toMatchObject({ id: created.id, status: "appeal_record_only" });
    const resolved = valueOf(reopened.resolveCorrectionAppeal({
      projectId: state.projectId,
      appealId: created.id,
      expectedVersion: recorded.version,
      kind: "record_disagreement_without_resolution",
      publicReason: "The source remains disputed; no independent runtime was configured.",
      actor: USER,
    }));
    expect(resolved.status).toBe("resolved");
    const recordOnlyResolution = resolved.resolutions[0];
    if (recordOnlyResolution === undefined) throw new Error("resolution missing");
    expect(recordOnlyResolution.receipt.independenceStatus).toBe("not_requested");
    expect(recordOnlyResolution.receipt.receiptHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(valueOf(reopened.resolveCorrectionAppeal({
      projectId: state.projectId,
      appealId: created.id,
      expectedVersion: resolved.version,
      kind: "record_disagreement_without_resolution",
      publicReason: "The source remains disputed; no independent runtime was configured.",
      actor: USER,
    })).version).toBe(resolved.version);
  });

  it("persists the exact send manifest before invoking one independent Provider, resumes after restart, validates, compares, and leaves resolution to the user", async () => {
    const provider = new IndependentProvider();
    const state = await fixture(provider);
    const created = valueOf(state.core.createCorrectionAppeal({ projectId: state.projectId, receiptId: state.receiptId, findingId: state.findingId, statement: appealStatement(), actor: USER }));
    const recorded = valueOf(state.core.recordCorrectionAppeal({ projectId: state.projectId, appealId: created.id, expectedVersion: created.version, actor: USER }));
    const prepared = valueOf(state.core.prepareCorrectionAppealSecondOpinion({
      projectId: state.projectId,
      appealId: created.id,
      expectedVersion: recorded.version,
      actor: USER,
      allowedContext: { includeBrief: true, decisionIds: [], issueIds: [], evidenceIds: [] },
    }));
    expect(provider.calls).toHaveLength(0);
    expect(prepared.contextManifestVisible).toBe(true);
    expect(prepared.appeal.status).toBe("awaiting_send_confirmation");
    for (const excluded of ["original_verdict", "original_public_rationale", "original_confidence", "original_provider_raw_response", "other_agent_assessments"]) {
      expect(prepared.manifest.excludedFields).toContain(excluded);
    }
    expect(JSON.stringify(prepared.request)).not.toContain("The suggestion introduces a causal implication without a warrant.");

    state.core.close();
    cores.splice(cores.indexOf(state.core), 1);
    const reopened = valueOf(await openSestina({ databasePath: state.databasePath, correctionAppealSecondOpinionProvider: provider }));
    cores.push(reopened);
    const restoredAppeal = valueOf(reopened.getCorrectionAppeal(state.projectId, created.id));
    if (restoredAppeal === undefined) throw new Error("appeal missing after restart");
    const restoredState = valueOf(reopened.getResearchRoomState(state.projectId));
    expect(stableResearchHash(restoredState.stateBinding)).toEqual({ ok: true, value: restoredAppeal.source.createdStateBindingHash });
    const sourceReceipt = valueOf(reopened.listResearchRoomReceipts(state.projectId)).find((item) => item.id === restoredAppeal.source.receiptId);
    const binding = restoredAppeal.source.inputBindings[0];
    if (sourceReceipt === undefined || binding === undefined) throw new Error("source binding missing after restart");
    const briefFields = { projectQuestion: restoredState.brief.projectQuestion, currentStage: restoredState.brief.currentStage, currentTask: restoredState.brief.currentTask };
    const briefHash = stableResearchHash({ kind: "brief", id: restoredState.brief.versionId, version: restoredState.brief.versionNumber, fields: briefFields });
    if (!briefHash.ok) throw new Error(briefHash.error.code);
    const rebuilt = prepareCorrectionAppealSecondOpinionRequest({
      appealId: restoredAppeal.id,
      attemptId: prepared.attemptId,
      projectId: restoredAppeal.projectId,
      reviewId: restoredAppeal.source.reviewId,
      findingId: restoredAppeal.source.findingId,
      findingHash: restoredAppeal.source.findingHash,
      stateBindingHash: restoredAppeal.source.createdStateBindingHash,
      provider: provider.binding,
      criterion: { id: restoredAppeal.source.rubric.criterionId, definition: restoredAppeal.source.rubric.definition, version: restoredAppeal.source.rubric.version, hash: restoredAppeal.source.rubric.hash },
      userQuestion: restoredAppeal.statements.at(-1)?.statement.secondOpinionQuestion ?? "missing",
      frozenInput: { projectId: restoredAppeal.projectId, artifactId: binding.artifactId, revisionId: binding.revisionId, text: sourceReceipt.analysis.proposal },
      allowedContext: [{ kind: "brief", id: restoredState.brief.versionId, version: restoredState.brief.versionNumber, hash: briefHash.value, fields: briefFields }],
    });
    if (!rebuilt.ok) throw new Error(rebuilt.error.code);
    expect(rebuilt.value).toEqual(prepared.request);
    const resumed = valueOf(reopened.prepareCorrectionAppealSecondOpinion({
      projectId: state.projectId,
      appealId: created.id,
      expectedVersion: prepared.appeal.version,
      actor: USER,
      allowedContext: { includeBrief: true, decisionIds: [], issueIds: [], evidenceIds: [] },
    }));
    expect(resumed.manifest).toEqual(prepared.manifest);
    expect(resumed.request).toEqual(prepared.request);
    const completed = valueOf(await reopened.runCorrectionAppealSecondOpinion({
      projectId: state.projectId,
      appealId: created.id,
      attemptId: resumed.attemptId,
      expectedVersion: resumed.appeal.version,
      confirmationNonce: resumed.confirmationNonce,
      manifestHash: resumed.manifest.canonicalHash,
      actor: USER,
    }));
    expect(completed.status).toBe("second_opinion_ready");
    expect(completed.resolutions).toEqual([]);
    const completedAttempt = completed.attempts[0];
    if (completedAttempt === undefined) throw new Error("completed attempt missing");
    expect(completedAttempt.status).toBe("completed");
    expect(completedAttempt.independenceBasis.status).toBe("runtime_and_context_isolated");
    expect(completedAttempt.comparison).toMatchObject({ relation: "direct_contradiction", authority: "system_derived", canResolveAppeal: false });
    expect(provider.calls).toHaveLength(1);
    const resolved = valueOf(reopened.resolveCorrectionAppeal({ projectId: state.projectId, appealId: created.id, expectedVersion: completed.version, kind: "overturn_original_finding", publicReason: "The independent bounded review contradicts the original criterion assessment.", actor: USER }));
    expect(resolved.status).toBe("resolved");
    const resolvedEntry = resolved.resolutions[0];
    if (resolvedEntry === undefined) throw new Error("resolved entry missing");
    expect(resolvedEntry.kind).toBe("overturn_original_finding");
    expect(resolvedEntry.authority.actor).toEqual(USER);
  });

  it("blocks the original runtime from serving as its own independent second opinion and never sends", async () => {
    const provider = new IndependentProvider();
    Object.defineProperty(provider, "connectionId", { value: "original-judge-connection" });
    Object.defineProperty(provider, "endpointIdentityHash", { value: endpointIdentity("original-judge", "http://127.0.0.1:18081") });
    const state = await fixture(provider);
    const created = valueOf(state.core.createCorrectionAppeal({ projectId: state.projectId, receiptId: state.receiptId, findingId: state.findingId, statement: appealStatement(), actor: USER }));
    const recorded = valueOf(state.core.recordCorrectionAppeal({ projectId: state.projectId, appealId: created.id, expectedVersion: created.version, actor: USER }));
    expect(state.core.prepareCorrectionAppealSecondOpinion({ projectId: state.projectId, appealId: created.id, expectedVersion: recorded.version, actor: USER, allowedContext: { includeBrief: true, decisionIds: [], issueIds: [], evidenceIds: [] } })).toMatchObject({ ok: false, error: { code: "review_blocked" } });
    expect(provider.calls).toHaveLength(0);
  });
});
