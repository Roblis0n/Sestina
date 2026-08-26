import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  openSestina,
  createCorrectionAppealProviderEndpointIdentityHash,
  createStableTextSpan,
  type CorrectionAppealSecondOpinionProvider,
  type CorrectionAppealSecondOpinionProviderInput,
  type CorrectionAppealSecondOpinionRequest,
  type CorrectionAppealSecondOpinionResponse,
  type CoreResult,
  type ResearchRoomSemanticJudgeRequest,
  type ResearchRoomProvider,
} from "@sestina/core";

const USER = { kind: "user", actorId: "ri49-browser-owner" } as const;

function valueOf<T>(result: CoreResult<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

function sha(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
function endpointIdentity(model: string, baseUrlOrigin: string): string {
  const result = createCorrectionAppealProviderEndpointIdentityHash({ id: "identity", family: "openai_compatible", model, baseUrlOrigin, locality: "local", configGeneration: 1 });
  if (result === undefined) throw new Error("invalid endpoint identity");
  return result;
}

function originalResponse(request: ResearchRoomSemanticJudgeRequest) {
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
      uncertainty: "This is a safe synthetic browser fixture.",
      missingContext: [],
    })),
  };
}

export class Ri49OriginalProvider implements ResearchRoomProvider {
  readonly id = "ri49-original-judge";
  readonly kind = "deterministic_fixture" as const;
  readonly networkAccess = "none" as const;
  readonly binding = Object.freeze({ id: this.id, family: "openai_compatible" as const, model: "ri49-original-model", baseUrlOrigin: "http://127.0.0.1:18091", locality: "local" as const, configGeneration: 1 });
  prepare(request: ResearchRoomSemanticJudgeRequest) {
    const requestBody = JSON.stringify(request);
    return Object.freeze({ schemaVersion: "1.0.0" as const, endpoint: "http://127.0.0.1:18091/v1/chat/completions", provider: this.binding, requestHash: request.requestHash, requestBody, requestBodyHash: sha(requestBody), requestBodyBytes: Buffer.byteLength(requestBody, "utf8"), responseLimitBytes: request.limits.maxResponseBytes, redirectPolicy: "error" as const, retryCount: 0 as const });
  }
  analyze(request: ResearchRoomSemanticJudgeRequest): Promise<unknown> { return Promise.resolve(originalResponse(request)); }
}

function secondOpinionResponse(request: CorrectionAppealSecondOpinionRequest): CorrectionAppealSecondOpinionResponse {
  const span = createStableTextSpan(request.context.frozenInput, 0, request.context.frozenInput.normalizedText.length);
  if (!span.ok) throw new Error(span.error.code);
  return {
    schemaVersion: "1.0.0", protocolVersion: request.protocol.version, protocolHash: request.protocol.hash, promptVersion: request.prompt.version, promptHash: request.prompt.hash, schemaHash: request.responseSchemaHash, rubricVersion: request.rubric.version, rubricHash: request.rubric.hash,
    appealId: request.appealId, attemptId: request.attemptId, projectId: request.projectId, requestHash: request.requestHash, inputHash: request.context.frozenInput.normalizedTextHash, criterionId: request.criterion.id, provider: request.provider,
    assessment: "not_present", evidenceSpans: [span.value], publicRationale: "The explicit boundary sentence does not itself assert a causal result.", missingContext: [], alternativeExplanations: ["The original judge may have interpreted the proposed qualification as the claim it was meant to limit."], minimalCorrection: "Keep the boundary statement adjacent to the observational association.", uncertaintySources: ["Only frozen input and explicitly selected project context were supplied."],
  };
}

export class Ri49IndependentProvider implements CorrectionAppealSecondOpinionProvider {
  readonly id = "ri49-independent-opinion";
  readonly connectionId = "ri49-independent-connection";
  readonly kind = "deterministic_fixture" as const;
  readonly networkAccess = "none" as const;
  readonly endpointIdentityHash = endpointIdentity("ri49-independent-model", "http://127.0.0.1:18092");
  readonly binding = Object.freeze({ id: this.id, family: "openai_compatible" as const, model: "ri49-independent-model", baseUrlOrigin: "http://127.0.0.1:18092", locality: "local" as const, configGeneration: 1 });
  constructor(private readonly delayMs = 0, private readonly mode: "success" | "invalid" | "failure" = "success") {}
  prepare(request: CorrectionAppealSecondOpinionRequest): CorrectionAppealSecondOpinionProviderInput {
    const requestBody = JSON.stringify(request);
    return Object.freeze({ schemaVersion: "1.0.0", endpoint: "http://127.0.0.1:18092/v1/chat/completions", provider: this.binding, requestHash: request.requestHash, requestBody, requestBodyHash: sha(requestBody), requestBodyBytes: Buffer.byteLength(requestBody, "utf8"), responseLimitBytes: request.limits.maxResponseBytes, redirectPolicy: "error", retryCount: 0 });
  }
  async analyze(request: CorrectionAppealSecondOpinionRequest, _preview: CorrectionAppealSecondOpinionProviderInput, options: { readonly signal: AbortSignal }): Promise<unknown> {
    if (this.delayMs > 0) await new Promise<void>((resolve, reject) => { const timer = setTimeout(resolve, this.delayMs); options.signal.addEventListener("abort", () => { clearTimeout(timer); reject(Object.assign(new Error("cancelled"), { code: "provider_aborted" })); }, { once: true }); });
    if (this.mode === "failure") throw Object.assign(new Error("synthetic provider failure"), { code: "provider_offline" });
    if (this.mode === "invalid") return { unexpected: "field" };
    return secondOpinionResponse(request);
  }
}

export interface Ri49FixtureProject {
  readonly projectId: string;
  readonly receiptId: string;
  readonly findingIds: readonly string[];
}

export async function createRi49FixtureProject(root: string): Promise<Ri49FixtureProject> {
  const stateDirectory = join(root, ".sestina");
  await mkdir(stateDirectory);
  const core = valueOf(await openSestina({ databasePath: join(stateDirectory, "state.sqlite"), researchRoomProvider: new Ri49OriginalProvider() }));
  try {
    const project = valueOf(core.initializeProject({ title: "Observational Association Lab", actor: USER }));
    const artifact = valueOf(core.createArtifactWithInitialRevision({ projectId: project.id, actor: USER, kind: "research_note", relativePath: "synthetic/observational-association.md", content: "# Observational association\n\nThe association is observational and the design cannot establish causality. This intentionally long fixture keeps the visible appeal interface under realistic research prose without including private data.", mediaType: "text/markdown" }));
    valueOf(core.activateBrief({ projectId: project.id, actor: USER, projectQuestion: "How should an observational association be reported without overstating causal evidence?", currentStage: "revision", currentTask: "Preserve the evidence boundary while evaluating a challenged Semantic Judge finding.", targetArtifacts: [artifact.artifact.id], fixedDecisions: [{ statement: "Do not infer causality from this design.", scope: { target: { kind: "project_path", relativePath: "synthetic" }, operations: ["rewrite"] } }], allowedChanges: [{ target: { kind: "artifact", artifactId: artifact.artifact.id }, operations: ["add", "rewrite"] }], forbiddenChanges: [{ target: { kind: "project_path", relativePath: "synthetic" }, operations: ["delete"] }], expectedDeltas: [{ statement: "Add one bounded qualification.", scope: { target: { kind: "artifact", artifactId: artifact.artifact.id }, operations: ["add"] } }], evidenceBoundaries: [{ statement: "The design cannot identify causality.", scope: { target: { kind: "project_path", relativePath: "synthetic" }, operations: ["rewrite"] }, forbiddenInferenceKinds: ["causal"] }], explicitNonGoals: ["Replace the research question", "Claim real-world validation"] }));
    const prepared = valueOf(core.prepareResearchRoomReview({ projectId: project.id, suggestion: "Report the association as causal only after stating that the design cannot establish causality.", evidenceClass: "synthetic_fixture", countsAsExternalEvidence: false }));
    const analyzed = valueOf(await core.analyzeResearchRoomSuggestion({ reviewId: prepared.reviewId, confirmationNonce: prepared.confirmationNonce, manifestHash: prepared.manifestHash }));
    const receipt = valueOf(core.commitResearchRoomDisposition({ projectId: project.id, reviewId: analyzed.reviewId, authorityNonce: analyzed.authorityNonce, expectedStateBinding: analyzed.stateBinding, disposition: "rejected", reason: "Keep the observational interpretation and preserve the explicit evidence boundary.", actor: USER }));
    const findingIds = receipt.semanticJudge?.findings.map((finding) => finding.id) ?? [];
    if (findingIds.length === 0) throw new Error("RI-49 fixture did not create semantic findings.");
    await writeFile(join(stateDirectory, "research-brief.yaml"), "# safe synthetic RI-49 projection\n", "utf8");
    return { projectId: project.id, receiptId: receipt.id, findingIds };
  } finally { core.close(); }
}
