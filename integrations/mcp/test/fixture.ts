import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { openSestina } from "@sestina/core";

export const FIXTURE_PREFIX = "Sestina MCP RI37 空格-";

export interface ProjectFixture {
  readonly root: string;
  readonly databasePath: string;
  readonly projectId: string;
}

export interface ContinuityFixture {
  readonly episodeId: string;
  readonly artifactId: string;
  readonly baselineRevisionId: string;
  readonly decisionId: string;
  readonly issueId: string;
}

const actor = Object.freeze({ kind: "user" as const, actorId: "ri37-fixture-user" });

function initialBrief(options: {
  readonly currentTask: string;
  readonly projectQuestion?: string;
  readonly targetArtifacts?: readonly string[];
  readonly explicitNonGoals?: readonly string[];
}) {
  return {
    actor,
    projectQuestion: options.projectQuestion ?? "How can the current research task recover without replacing its goal?",
    currentStage: "revision" as const,
    currentTask: options.currentTask,
    targetArtifacts: options.targetArtifacts ?? [],
    fixedDecisions: [{
      statement: "Preserve the accepted research question.",
      scope: { target: { kind: "project_path" as const, relativePath: "manuscript.md" }, operations: ["rewrite" as const] },
    }],
    allowedChanges: [{
      target: { kind: "project_path" as const, relativePath: "manuscript.md" },
      operations: ["rewrite" as const],
    }],
    forbiddenChanges: [{
      target: { kind: "project_path" as const, relativePath: "data/source.csv" },
      operations: ["data_replace" as const],
    }],
    expectedDeltas: [{
      statement: "Add one explicit claim-evidence relation.",
      scope: { target: { kind: "project_path" as const, relativePath: "manuscript.md" }, operations: ["rewrite" as const] },
    }],
    evidenceBoundaries: [{
      statement: "Do not infer causality from the observational source.",
      scope: { target: { kind: "project_path" as const, relativePath: "data/source.csv" }, operations: ["rewrite" as const] },
      forbiddenInferenceKinds: ["causal" as const],
    }],
    explicitNonGoals: options.explicitNonGoals ?? ["Do not replace the research question."],
  };
}

export async function createProjectFixture(options: {
  readonly activeBrief?: boolean;
  readonly currentTask?: string;
  readonly projectQuestion?: string;
  readonly targetArtifacts?: readonly string[];
  readonly explicitNonGoals?: readonly string[];
  readonly projectCount?: number;
} = {}): Promise<ProjectFixture> {
  const root = await mkdtemp(join(tmpdir(), FIXTURE_PREFIX));
  const stateDirectory = join(root, ".sestina");
  const databasePath = join(stateDirectory, "state.sqlite");
  await mkdir(stateDirectory, { recursive: true });
  const opened = await openSestina({ databasePath });
  if (!opened.ok) throw new Error(opened.error.code);
  try {
    const projectCount = options.projectCount ?? 1;
    let projectId = "";
    for (let index = 0; index < projectCount; index += 1) {
      const project = opened.value.initializeProject({
        title: `RI-37 fixture ${index + 1}`,
        rootPath: ".",
        actor,
      });
      if (!project.ok) throw new Error(project.error.code);
      if (index === 0) projectId = project.value.id;
    }
    if (options.activeBrief !== false) {
      const brief = opened.value.activateBrief({
        projectId,
        ...initialBrief({
          currentTask: options.currentTask ?? "Add only the missing claim-evidence relation.",
          ...(options.projectQuestion === undefined ? {} : { projectQuestion: options.projectQuestion }),
          ...(options.targetArtifacts === undefined ? {} : { targetArtifacts: options.targetArtifacts }),
          ...(options.explicitNonGoals === undefined ? {} : { explicitNonGoals: options.explicitNonGoals }),
        }),
      });
      if (!brief.ok) throw new Error(brief.error.code);
    }
    return { root, databasePath, projectId };
  } finally {
    opened.value.close();
  }
}

export async function createCorruptProjectFixture(): Promise<ProjectFixture> {
  const root = await mkdtemp(join(tmpdir(), FIXTURE_PREFIX));
  const stateDirectory = join(root, ".sestina");
  const databasePath = join(stateDirectory, "state.sqlite");
  await mkdir(stateDirectory, { recursive: true });
  await writeFile(databasePath, "not a SQLite database", "utf8");
  return { root, databasePath, projectId: "unknown" };
}

export async function updateActiveBrief(fixture: ProjectFixture): Promise<void> {
  const opened = await openSestina({ databasePath: fixture.databasePath });
  if (!opened.ok) throw new Error(opened.error.code);
  try {
    const current = opened.value.getBriefState(fixture.projectId);
    if (!current.ok || current.value === undefined) throw new Error("fixture_brief_missing");
    const changed = opened.value.editBrief({
      projectId: fixture.projectId,
      expectedVersion: current.value.brief.version,
      actor,
      projectQuestion: "How can the updated research task preserve the accepted causal boundary?",
      currentStage: "revision",
      currentTask: "Add the newly bounded evidence comparison.",
      targetArtifacts: [],
      fixedDecisions: [{
        statement: "Keep the observational design fixed.",
        scope: { target: { kind: "project_path", relativePath: "methods.md" }, operations: ["rewrite"] },
      }],
      allowedChanges: [{ target: { kind: "project_path", relativePath: "results.md" }, operations: ["rewrite"] }],
      forbiddenChanges: [{ target: { kind: "project_path", relativePath: "methods.md" }, operations: ["delete"] }],
      expectedDeltas: [{
        statement: "Add one bounded comparison without a causal claim.",
        scope: { target: { kind: "project_path", relativePath: "results.md" }, operations: ["rewrite"] },
      }],
      evidenceBoundaries: [{
        statement: "The comparison remains associational.",
        scope: { target: { kind: "project_path", relativePath: "results.md" }, operations: ["rewrite"] },
        forbiddenInferenceKinds: ["causal"],
      }],
      explicitNonGoals: ["Do not redesign the study."],
    });
    if (!changed.ok) throw new Error(changed.error.code);
  } finally {
    opened.value.close();
  }
}

export async function seedContinuityFixture(fixture: ProjectFixture): Promise<ContinuityFixture> {
  const opened = await openSestina({ databasePath: fixture.databasePath });
  if (!opened.ok) throw new Error(opened.error.code);
  try {
    const brief = opened.value.getBriefState(fixture.projectId);
    if (!brief.ok || brief.value === undefined) throw new Error("fixture_brief_missing");
    const decision = opened.value.recordDecision({
      projectId: fixture.projectId,
      actor,
      statement: "Keep the observational evidence boundary fixed.",
      scope: { kind: "project" },
      rationale: "The synthetic source does not identify causality.",
      effectiveBriefVersionId: brief.value.version.id,
      reopenConditions: ["New experimental evidence becomes available."],
      status: "frozen",
    });
    if (!decision.ok) throw new Error(decision.error.code);
    const artifact = opened.value.createArtifactWithInitialRevision({
      projectId: fixture.projectId,
      actor,
      kind: "section",
      relativePath: "manuscript.md",
      content: "# Synthetic baseline\n\nAn observational association was recorded.\n",
      mediaType: "text/markdown",
    });
    if (!artifact.ok) throw new Error(artifact.error.code);
    const issue = opened.value.openIssue({
      projectId: fixture.projectId,
      actor,
      kind: "evidence_boundary",
      target: { kind: "artifact", artifactId: artifact.value.artifact.id },
      violatedCriterion: "Do not infer causality from observational evidence.",
      rationaleConcepts: ["observational evidence", "causal overreach"],
      summary: "A causal interpretation exceeds the evidence boundary.",
      sourceArtifactId: artifact.value.artifact.id,
      sourceRevisionId: artifact.value.revision.id,
      sourceRevisionContentHash: artifact.value.revision.content.contentHash,
      lineageRootRevisionId: artifact.value.revision.id,
    });
    if (!issue.ok) throw new Error(issue.error.code);
    const episode = opened.value.startRevisionEpisode({
      projectId: fixture.projectId,
      artifactId: artifact.value.artifact.id,
      briefVersionId: brief.value.version.id,
      baselineRevisionId: artifact.value.revision.id,
      actor,
    });
    if (!episode.ok) throw new Error(episode.error.code);
    const resolved = opened.value.resolveIssue({
      projectId: fixture.projectId,
      issueId: issue.value.id,
      actor,
      reason: "The synthetic text was corrected and the boundary recorded.",
      resolutionEvidenceId: "synthetic-correction",
    });
    if (!resolved.ok) throw new Error(resolved.error.code);
    return {
      episodeId: episode.value.id,
      artifactId: artifact.value.artifact.id,
      baselineRevisionId: artifact.value.revision.id,
      decisionId: decision.value.id,
      issueId: resolved.value.id,
    };
  } finally {
    opened.value.close();
  }
}

export async function readBriefRecordVersion(fixture: ProjectFixture): Promise<number | undefined> {
  const opened = await openSestina({ databasePath: fixture.databasePath, readOnly: true });
  if (!opened.ok) throw new Error(opened.error.code);
  try {
    const state = opened.value.getBriefState(fixture.projectId);
    if (!state.ok) throw new Error(state.error.code);
    return state.value?.brief.version;
  } finally {
    opened.value.close();
  }
}

export async function removeProjectFixture(root: string): Promise<void> {
  const base = resolve(tmpdir());
  const target = resolve(root);
  const rel = relative(base, target);
  if (
    rel.length === 0
    || rel.startsWith("..")
    || isAbsolute(rel)
    || !target.includes(FIXTURE_PREFIX)
  ) throw new Error("unsafe_fixture_cleanup");
  await rm(target, { recursive: true, force: true });
}
