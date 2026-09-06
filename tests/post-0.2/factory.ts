import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSestina, type ResearchRoomProvider } from "@sestina/core";
import { createStableTextSpan, type ResearchRoomSemanticJudgeRequest } from "@sestina/review";

export const USER = { kind: "user", actorId: "synthetic-owner" } as const;
export function value<T>(result: { ok: true; value: T } | { ok: false; error: { code: string } }): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

/** Deliberately unsupported semantic rationale, but correct protocol binding. */
export class SyntheticProvider implements ResearchRoomProvider {
  readonly id = "g1-synthetic";
  readonly kind = "deterministic_fixture" as const;
  readonly networkAccess = "none" as const;
  readonly binding = { id: this.id, family: "openai_compatible" as const, model: "synthetic", baseUrlOrigin: "http://127.0.0.1:1", locality: "local" as const, configGeneration: 1 };
  readonly calls: unknown[] = [];
  constructor(readonly mode: "valid" | "failure" | "invalid" = "valid") {}
  prepare(request: ResearchRoomSemanticJudgeRequest) {
    const body = JSON.stringify(request);
    return { schemaVersion: "1.0.0" as const, endpoint: `${this.binding.baseUrlOrigin}/v1/chat/completions`, provider: this.binding, requestHash: request.requestHash,
      requestBody: body, requestBodyHash: createHash("sha256").update(body).digest("hex"), requestBodyBytes: Buffer.byteLength(body), responseLimitBytes: request.limits.maxResponseBytes, redirectPolicy: "error" as const, retryCount: 0 as const };
  }
  analyze(request: ResearchRoomSemanticJudgeRequest): Promise<unknown> {
    this.calls.push(request);
    if (this.mode === "failure") return Promise.reject(new Error("synthetic offline"));
    if (this.mode === "invalid") return Promise.resolve("{invalid-json");
    const span = value(createStableTextSpan(request.context.suggestionDocument, 0, request.context.suggestionDocument.normalizedText.length));
    return Promise.resolve({ schemaVersion: "1.0.0", protocolVersion: request.protocol.version, protocolHash: request.protocol.hash,
      promptVersion: request.prompt.version, promptHash: request.prompt.hash, rubricVersion: request.rubric.version, rubricHash: request.rubric.hash,
      reviewId: request.reviewId, projectId: request.projectId, stateBindingHash: request.stateBindingHash, requestHash: request.requestHash, provider: request.provider,
      assessments: request.criteria.map((criterion) => ({ criterionId: criterion.id, verdict: criterion.id === "argument-delta" ? "positive" : "negative",
        evidenceSpans: [span], referencedDecisionIds: [], referencedIssueIds: [], publicRationale: `${criterion.id}: Synthetic unsupported inference: the moon is green, therefore this conclusion is correct.`,
        minimalCorrection: "None proposed.", uncertainty: "Unknown semantic correctness.", missingContext: [] })) });
  }
}

/** Uses real Core + SQLite and emits a project usable by the built UI. */
export async function syntheticProject(provider?: ResearchRoomProvider, timeoutMs?: number) {
  const root = await mkdtemp(join(tmpdir(), "sestina-g1-synthetic-"));
  const state = join(root, ".sestina"); await mkdir(state);
  const databasePath = join(state, "state.sqlite");
  const core = value(await openSestina({ databasePath, researchRoomProvider: provider, researchRoomProviderTimeoutMs: timeoutMs }));
  const project = value(core.initializeProject({ title: "G1 synthetic project", rootPath: ".", actor: USER }));
  const artifact = value(core.createArtifactWithInitialRevision({ projectId: project.id, actor: USER, kind: "research_note", relativePath: "synthetic.md", content: "Synthetic observational result.", mediaType: "text/markdown" }));
  value(core.activateBrief({ projectId: project.id, actor: USER, projectQuestion: "How should an observational association be reported?", currentStage: "revision", currentTask: "Retain limitations.", targetArtifacts: [artifact.artifact.id],
    fixedDecisions: [{ statement: "Retain observational limits.", scope: { target: { kind: "artifact", artifactId: artifact.artifact.id }, operations: ["rewrite"] } }],
    allowedChanges: [{ target: { kind: "artifact", artifactId: artifact.artifact.id }, operations: ["add", "rewrite"] }],
    forbiddenChanges: [{ target: { kind: "artifact", artifactId: artifact.artifact.id }, operations: ["delete"] }],
    expectedDeltas: [{ statement: "Add an uncertainty qualification.", scope: { target: { kind: "artifact", artifactId: artifact.artifact.id }, operations: ["add"] } }],
    evidenceBoundaries: [{ statement: "No causal inference from observations.", scope: { target: { kind: "artifact", artifactId: artifact.artifact.id }, operations: ["rewrite"] }, forbiddenInferenceKinds: ["causal"] }],
    explicitNonGoals: ["Collect participant data"] }));
  const brief = value(core.getActiveBriefProjection(project.id));
  if (!brief) throw new Error("fixture Brief binding missing");
  const episode = value(core.startRevisionEpisode({ projectId: project.id, artifactId: artifact.artifact.id, briefVersionId: brief.versionId, baselineRevisionId: artifact.revision.id, actor: USER }));
  await writeFile(join(state, "research-brief.yaml"), brief.yaml);
  return { root, state, databasePath, projectId: project.id, core, artifact, episode,
    prepare: () => value(core.prepareResearchRoomReview({ projectId: project.id, suggestion: "Retain the observational limitation. Retain the observational limitation.", evidenceClass: "synthetic_adversarial_fixture", countsAsExternalEvidence: false })),
    async cleanup() { core.close(); await rm(root, { recursive: true, force: true }); } };
}
