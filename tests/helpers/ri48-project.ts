import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { openSestina, type CoreResult, type ResearchRoomProvider } from "../../packages/core/src/index.js";
import { createStableTextSpan, type ResearchRoomSemanticJudgeRequest } from "../../packages/review/src/index.js";

export const RI48_USER = Object.freeze({ kind: "user" as const, actorId: "ri48-test-owner" });

function valueOf<T>(result: CoreResult<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

export class Ri48FixtureProvider implements ResearchRoomProvider {
  readonly id = "ri48-deterministic-fixture";
  readonly kind = "deterministic_fixture" as const;
  readonly networkAccess = "none" as const;
  readonly binding = Object.freeze({ id: this.id, family: "openai_compatible" as const, model: "fixture", baseUrlOrigin: "http://127.0.0.1:1", locality: "local" as const, configGeneration: 1 });
  calls = 0;
  constructor(private readonly scenario: "reasonable_increment" | "target_substitution" | "repeated_audit" = "reasonable_increment") {}
  prepare(request: ResearchRoomSemanticJudgeRequest) {
    const requestBody = JSON.stringify(request);
    return Object.freeze({ schemaVersion: "1.0.0" as const, endpoint: "http://127.0.0.1:1/v1/chat/completions", provider: this.binding, requestHash: request.requestHash, requestBody, requestBodyHash: createHash("sha256").update(requestBody).digest("hex"), requestBodyBytes: Buffer.byteLength(requestBody), responseLimitBytes: request.limits.maxResponseBytes, redirectPolicy: "error" as const, retryCount: 0 as const });
  }
  analyze(request: ResearchRoomSemanticJudgeRequest): Promise<unknown> {
    this.calls += 1;
    const span = createStableTextSpan(request.context.suggestionDocument, 0, request.context.suggestionDocument.normalizedText.length);
    if (!span.ok) return Promise.reject(new Error(span.error.code));
    return Promise.resolve({
      schemaVersion: "1.0.0",
      protocolVersion: request.protocol.version, protocolHash: request.protocol.hash,
      promptVersion: request.prompt.version, promptHash: request.prompt.hash,
      rubricVersion: request.rubric.version, rubricHash: request.rubric.hash,
      reviewId: request.reviewId, projectId: request.projectId, stateBindingHash: request.stateBindingHash, requestHash: request.requestHash, provider: request.provider,
      assessments: request.criteria.map((criterion) => {
        const positive = (this.scenario === "target_substitution" && criterion.id === "focus-substitution") || (this.scenario === "repeated_audit" && criterion.id === "repeated-audit") || (this.scenario === "reasonable_increment" && criterion.id === "argument-delta");
        const verdict = positive ? "positive" : "negative";
        const rationale = this.scenario === "repeated_audit" && criterion.id === "argument-delta"
          ? "No traceable mechanism relation is added."
          : this.scenario === "target_substitution" && criterion.id === "focus-substitution"
            ? "The suggestion replaces the locked research object."
            : positive ? "Adds a bounded uncertainty statement." : `No ${criterion.positiveMeaning} is present.`;
        return { criterionId: criterion.id, verdict, evidenceSpans: [span.value], referencedDecisionIds: [], referencedIssueIds: [], publicRationale: rationale, minimalCorrection: positive ? criterion.minimalRecoveryFormat.action : "No correction is proposed.", uncertainty: "No material uncertainty in the cited span.", missingContext: [] };
      }),
    });
  }
}

export async function createRi48Project(options: { readonly question?: string; readonly task?: string } = {}): Promise<{ readonly root: string; readonly projectId: string; cleanup(): Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), "sestina-ri48-room-"));
  const stateDir = join(root, ".sestina"); await mkdir(stateDir);
  const opened = valueOf(await openSestina({ databasePath: join(stateDir, "state.sqlite") }));
  const project = valueOf(opened.initializeProject({ title: "RI-48 Synthetic Research Room", rootPath: ".", actor: RI48_USER }));
  valueOf(opened.activateBrief({
    projectId: project.id,
    actor: RI48_USER,
    projectQuestion: options.question ?? "How should a synthetic observational association be reported?",
    currentStage: "revision",
    currentTask: options.task ?? "Add one evidence-bounded qualification.",
    targetArtifacts: [],
    fixedDecisions: [{ statement: "Do not infer causality from the synthetic design.", scope: { target: { kind: "project_path", relativePath: "synthetic" }, operations: ["rewrite"] } }],
    allowedChanges: [{ target: { kind: "project_path", relativePath: "synthetic" }, operations: ["add", "rewrite"] }],
    forbiddenChanges: [{ target: { kind: "project_path", relativePath: "synthetic" }, operations: ["delete"] }],
    expectedDeltas: [{ statement: "Add one bounded qualification.", scope: { target: { kind: "project_path", relativePath: "synthetic" }, operations: ["add"] } }],
    evidenceBoundaries: [{ statement: "Causal effects remain unproven.", scope: { target: { kind: "project_path", relativePath: "synthetic" }, operations: ["rewrite"] }, forbiddenInferenceKinds: ["causal"] }],
    explicitNonGoals: ["Collect external participant data", "Count fixtures as market evidence"],
  }));
  opened.close();
  await writeFile(join(stateDir, "research-brief.yaml"), "# Local projection for explicit project selection.\n", "utf8");
  return { root, projectId: project.id, cleanup: () => rm(root, { recursive: true, force: true }) };
}
