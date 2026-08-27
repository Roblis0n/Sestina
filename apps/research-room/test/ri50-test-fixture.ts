import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createStableTextSpan,
  openSestina,
  type CoreResult,
  type DeliberationParticipantProvider,
  type DeliberationParticipantProviderInput,
  type DeliberationParticipantRequest,
  type DeliberationParticipantResponse,
} from "@sestina/core";

const USER = { kind: "user", actorId: "ri50-browser-owner" } as const;

function valueOf<T>(result: CoreResult<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

function sha(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function participantResponse(request: DeliberationParticipantRequest): DeliberationParticipantResponse {
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
    directAnswer: a
      ? "Retain the observational association only with an explicit causal limitation."
      : "Do not retain causal language until a credible identification strategy is supplied.",
    dimensions: request.context.comparisonDimensions.map((dimension) => ({
      dimensionId: dimension.id,
      position: a ? "qualify" as const : "challenge" as const,
      summary: a ? `Bounded support on ${dimension.label}.` : `The current evidence does not settle ${dimension.label}.`,
      evidenceSpanIds: [a ? "a-public-span" : "b-public-span"],
    })),
    claims: [{
      claimId: a ? "a-bounded-claim" : "b-identification-claim",
      stance: a ? "qualify" : "challenge",
      text: a ? "The association remains reportable if causality is explicitly disclaimed." : "The design cannot identify a causal effect or mechanism.",
      evidenceSpanIds: [a ? "a-public-span" : "b-public-span"],
    }],
    evidenceSpans: [{ spanId: a ? "a-public-span" : "b-public-span", ...span.value }],
    assumptions: [a ? "The bounded target is reporting an association." : "The disputed target is a causal interpretation."],
    scope: a ? "Reporting language and limitations" : "Causal identification and mechanism",
    counterexamples: a ? [] : ["A stable observational association may still be confounded."],
    alternativeExplanations: a ? ["Residual confounding"] : ["Selection bias", "Residual confounding"],
    unknowns: ["The causal mechanism remains unknown."],
    nextDiscriminatingEvidence: a ? ["A preregistered replication with the same bounded claim"] : ["A credible identification strategy with falsification checks"],
    missingContext: a ? [] : ["Identification assumptions and sensitivity analysis"],
    uncertaintySources: ["Safe deterministic RI-50 fixture context"],
    publicRationale: a
      ? "The frozen source supports reporting the observed association but explicitly limits causal interpretation."
      : "The same frozen source does not establish causality or identify a mechanism, so causal wording remains unsupported.",
    proposedNextStep: a ? "Keep the claim associative and adjacent to its limitation." : "Request design evidence before any causal interpretation.",
  };
}

export type Ri50ProviderMode = "success" | "failure" | "invalid" | "hang";

export interface Ri50ProviderCall {
  readonly slot: "a" | "b";
  readonly request: DeliberationParticipantRequest;
  readonly startedAt: number;
}

export interface Ri50ProviderCoordinator {
  readonly prepared: Set<"a" | "b">;
  readonly calls: Ri50ProviderCall[];
}

export function createRi50ProviderCoordinator(): Ri50ProviderCoordinator {
  return { prepared: new Set(), calls: [] };
}

export class Ri50ParticipantProvider implements DeliberationParticipantProvider {
  readonly id: string;
  readonly connectionId: string;
  readonly kind = "deterministic_fixture" as const;
  readonly networkAccess = "none" as const;
  readonly harnessId: string;
  readonly runtimeIdentityHash: string;
  readonly endpointIdentityHash: string;
  readonly secretRefHash: string;
  readonly binding;

  constructor(
    readonly slot: "a" | "b",
    private readonly coordinator: Ri50ProviderCoordinator,
    private readonly mode: Ri50ProviderMode = "success",
    private readonly delayMs = 0,
  ) {
    this.id = `ri50-provider-${slot}`;
    this.connectionId = `ri50-connection-${slot}`;
    this.harnessId = `ri50-harness-${slot}`;
    this.runtimeIdentityHash = (slot === "a" ? "1" : "2").repeat(64);
    this.endpointIdentityHash = (slot === "a" ? "3" : "4").repeat(64);
    this.secretRefHash = (slot === "a" ? "5" : "6").repeat(64);
    this.binding = Object.freeze({
      id: this.id,
      family: "openai_compatible" as const,
      model: `ri50-bounded-model-${slot}`,
      baseUrlOrigin: `http://127.0.0.1:${slot === "a" ? "18101" : "18102"}`,
      locality: slot === "a" ? "local" as const : "external" as const,
      configGeneration: slot === "a" ? 11 : 22,
    });
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

  async analyze(request: DeliberationParticipantRequest, _preview: DeliberationParticipantProviderInput, options: { readonly signal: AbortSignal }): Promise<unknown> {
    if (!this.coordinator.prepared.has("a") || !this.coordinator.prepared.has("b")) throw new Error("both RI-50 requests must be prepared before dispatch");
    this.coordinator.calls.push({ slot: this.slot, request: structuredClone(request), startedAt: Date.now() });
    if (this.mode === "hang") await new Promise<void>((_resolve, reject) => { options.signal.addEventListener("abort", () => { reject(Object.assign(new Error("cancelled"), { code: "cancelled_by_user" })); }, { once: true }); });
    if (this.delayMs > 0) await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, this.delayMs);
      options.signal.addEventListener("abort", () => { clearTimeout(timer); reject(Object.assign(new Error("cancelled"), { code: "cancelled_by_user" })); }, { once: true });
    });
    if (this.mode === "failure") throw Object.assign(new Error("safe synthetic Provider failure"), { code: "provider_offline" });
    if (this.mode === "invalid") return { unexpected: "field" };
    return participantResponse(request);
  }
}

export function createRi50ParticipantPair(options: { readonly modeA?: Ri50ProviderMode; readonly modeB?: Ri50ProviderMode; readonly delayA?: number; readonly delayB?: number } = {}) {
  const coordinator = createRi50ProviderCoordinator();
  return {
    coordinator,
    providers: [
      new Ri50ParticipantProvider("a", coordinator, options.modeA, options.delayA),
      new Ri50ParticipantProvider("b", coordinator, options.modeB, options.delayB),
    ] as const,
  };
}

export interface Ri50FixtureProject {
  readonly projectId: string;
  readonly artifactId: string;
  readonly revisionId: string;
  readonly issueId: string;
}

export async function createRi50FixtureProject(root: string): Promise<Ri50FixtureProject> {
  const stateDirectory = join(root, ".sestina");
  await mkdir(stateDirectory);
  const core = valueOf(await openSestina({ databasePath: join(stateDirectory, "state.sqlite") }));
  try {
    const project = valueOf(core.initializeProject({ title: "Bounded Interpretation Lab", actor: USER }));
    const artifact = valueOf(core.createArtifactWithInitialRevision({
      projectId: project.id,
      actor: USER,
      kind: "research_note",
      relativePath: "synthetic/bounded-interpretation.md",
      content: "The observational association is stable across the recorded sample, but this design cannot establish causality or identify a mechanism. A second reasonable interpretation is that the association remains reportable only when its inferential limit is stated directly. This safe synthetic fixture is intentionally long enough to exercise desktop wrapping without containing private project data.",
      mediaType: "text/markdown",
    }));
    valueOf(core.activateBrief({
      projectId: project.id,
      actor: USER,
      projectQuestion: "How should a stable observational association be reported without overstating causal evidence?",
      currentStage: "analysis",
      currentTask: "Choose a bounded interpretation while preserving the evidence boundary.",
      targetArtifacts: [artifact.artifact.id],
      fixedDecisions: [],
      allowedChanges: [{ target: { kind: "artifact", artifactId: artifact.artifact.id }, operations: ["rewrite"] }],
      forbiddenChanges: [{ target: { kind: "project_path", relativePath: "synthetic" }, operations: ["delete"] }],
      expectedDeltas: [{ statement: "State the interpretation and the next discriminating evidence.", scope: { target: { kind: "artifact", artifactId: artifact.artifact.id }, operations: ["rewrite"] } }],
      evidenceBoundaries: [{ statement: "The current design cannot identify a causal effect or mechanism.", scope: { target: { kind: "artifact", artifactId: artifact.artifact.id }, operations: ["rewrite"] }, forbiddenInferenceKinds: ["causal"] }],
      explicitNonGoals: ["Select a winner by vote", "Treat fixture output as external validation", "Collect hidden chain of thought"],
    }));
    const issue = valueOf(core.openIssue({
      projectId: project.id,
      actor: USER,
      kind: "evidence_boundary",
      target: { kind: "artifact", artifactId: artifact.artifact.id },
      violatedCriterion: "causal_identification",
      rationaleConcepts: ["observational_design", "bounded_interpretation", "alternative_explanation"],
      summary: "Two reasonable interpretations remain: report a qualified association, or withhold interpretation until an identification strategy exists.",
      sourceArtifactId: artifact.artifact.id,
      sourceRevisionId: artifact.revision.id,
      sourceRevisionContentHash: artifact.revision.content.contentHash,
      lineageRootRevisionId: artifact.revision.id,
    }));
    await writeFile(join(stateDirectory, "research-brief.yaml"), "# safe synthetic RI-50 production fixture\n", "utf8");
    return { projectId: project.id, artifactId: artifact.artifact.id, revisionId: artifact.revision.id, issueId: issue.id };
  } finally {
    core.close();
  }
}
