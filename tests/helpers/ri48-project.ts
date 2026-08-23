import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSestina, type CoreResult, type ResearchRoomProvider } from "../../packages/core/src/index.js";

export const RI48_USER = Object.freeze({ kind: "user" as const, actorId: "ri48-test-owner" });

function valueOf<T>(result: CoreResult<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

export function analysisFor(kind: "reasonable_increment" | "target_substitution" | "repeated_audit") {
  const details = kind === "reasonable_increment"
    ? { delta: "boundary_condition", summary: "Adds a bounded uncertainty statement.", addition: "Adds an uncertainty interval and design limitation.", correction: "Keep the observational wording and add the interval." }
    : kind === "target_substitution"
      ? { delta: "research_object_transformation", summary: "The suggestion replaces the locked research object.", addition: "No admissible addition to the locked research object.", correction: "Return to first-year student descriptions." }
      : { delta: "no_substantive_delta", summary: "The suggestion repeats a resolved terminology audit.", addition: "No traceable mechanism relation is added.", correction: "Add one mechanism relation with a negative case." };
  return {
    schemaVersion: "1.0.0",
    proposal: "A synthetic suggestion for RI-48 browser verification.",
    findings: [{ kind, severity: kind === "reasonable_increment" ? "info" : "warning", summary: details.summary, affectedDecisionIds: [] }],
    argumentDelta: { kind: details.delta, summary: details.summary, genuineAdditions: [details.addition] },
    alternativeExplanations: ["A synthetic alternative explanation remains visible."],
    unknowns: ["External validity remains unknown."],
    minimalCorrection: details.correction,
    unproven: ["No external participant or real second use is proven."],
  };
}

export class Ri48FixtureProvider implements ResearchRoomProvider {
  readonly id = "ri48-deterministic-fixture";
  readonly kind = "deterministic_fixture" as const;
  readonly networkAccess = "none" as const;
  calls = 0;
  constructor(private readonly scenario: "reasonable_increment" | "target_substitution" | "repeated_audit" = "reasonable_increment") {}
  analyze(): Promise<unknown> { this.calls += 1; return Promise.resolve(structuredClone(analysisFor(this.scenario))); }
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
