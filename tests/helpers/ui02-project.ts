import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSestina, type CoreResult } from "../../packages/core/src/index.js";
import { parseArgumentEvidence, type ResearchResult } from "../../packages/research/src/index.js";
import { createResearchStore } from "../../packages/research-store/src/index.js";
import { openDatabase } from "../../packages/storage/src/index.js";

export const UI02_USER = Object.freeze({ kind: "user" as const, actorId: "ui02-browser-owner" });
export const UI02_EVIDENCE_ID = "revd_01ARZ3NDEKTSV4RRFFQ69G5FAV";

function coreValue<T>(result: CoreResult<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

function researchValue<T>(result: ResearchResult<T>): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

export interface Ui02ProjectFixture {
  readonly root: string;
  readonly projectId: string;
  readonly title: string;
  readonly question: string;
  readonly originalTask: string;
  readonly artifactId: string;
  readonly revisionId: string;
  readonly briefVersionId: string;
  readonly acceptedDecisionId: string;
  readonly resolveIssueId: string;
  readonly waiveIssueId: string;
  readonly disputeIssueId: string;
  readonly evidenceId: string;
  readonly evidenceSummary: string;
  readonly episodeId: string;
  cleanup(): Promise<void>;
}

export async function createUi02Project(options: { readonly title?: string; readonly question?: string; readonly uniqueToken?: string; readonly evidenceId?: string; readonly evidenceSummary?: string } = {}): Promise<Ui02ProjectFixture> {
  const title = options.title ?? "UI-02 Continuity Workspace";
  const question = options.question ?? "How can canonical research objects preserve project continuity without weakening user authority?";
  const originalTask = "Inspect one bounded continuity change across the canonical ledgers.";
  const uniqueToken = options.uniqueToken ?? "disk-only-canary-ui02";
  const evidenceId = options.evidenceId ?? UI02_EVIDENCE_ID;
  const evidenceSummary = options.evidenceSummary ?? "Canonical evidence for UI-02 browser authority commands.";
  const root = await mkdtemp(join(tmpdir(), "sestina-ui02-browser-"));
  const stateDirectory = join(root, ".sestina");
  await mkdir(stateDirectory);
  const databasePath = join(stateDirectory, "state.sqlite");
  const core = coreValue(await openSestina({ databasePath }));
  let coreClosed = false;
  try {
    const project = coreValue(core.initializeProject({ title, rootPath: ".", actor: UI02_USER }));
    const created = coreValue(core.createArtifactWithInitialRevision({
      projectId: project.id,
      actor: UI02_USER,
      kind: "research_note",
      relativePath: "notes/ui-02-continuity.md",
      content: "# UI-02 continuity\n\nA bounded local research note with explicit provenance.",
      mediaType: "text/markdown",
    }));
    const fixedDecisionStatement = "Keep every authority-bearing mutation behind explicit user confirmation.";
    const brief = coreValue(core.activateBrief({
      projectId: project.id,
      actor: UI02_USER,
      projectQuestion: question,
      currentStage: "revision",
      currentTask: originalTask,
      targetArtifacts: [created.artifact.id],
      fixedDecisions: [{ statement: fixedDecisionStatement, scope: { target: { kind: "project_path", relativePath: "notes" }, operations: ["rewrite"] } }],
      allowedChanges: [{ target: { kind: "artifact", artifactId: created.artifact.id }, operations: ["add", "rewrite"] }],
      forbiddenChanges: [{ target: { kind: "project_path", relativePath: "archives" }, operations: ["delete"] }],
      expectedDeltas: [{ statement: "Add one navigable, evidence-bounded continuity relation.", scope: { target: { kind: "artifact", artifactId: created.artifact.id }, operations: ["add"] } }],
      evidenceBoundaries: [{ statement: "A local file is not canonical Evidence until explicitly recorded.", scope: { target: { kind: "project_path", relativePath: "notes" }, operations: ["rewrite"] }, forbiddenInferenceKinds: ["causal"] }],
      explicitNonGoals: ["Scan arbitrary project files", "Treat fixture behavior as external validation"],
    }));
    const acceptedDecision = coreValue(core.recordDecision({
      projectId: project.id,
      actor: UI02_USER,
      statement: fixedDecisionStatement,
      scope: { kind: "project" },
      rationale: "Navigation and convenience controls cannot bypass the research owner.",
      effectiveBriefVersionId: brief.currentVersionId,
      reopenConditions: ["The authority contract changes."],
      status: "accepted",
    }));
    const issueBase = {
      projectId: project.id,
      actor: UI02_USER,
      target: { kind: "artifact" as const, artifactId: created.artifact.id },
      sourceArtifactId: created.artifact.id,
      sourceRevisionId: created.revision.id,
      sourceRevisionContentHash: created.revision.content.contentHash,
      lineageRootRevisionId: created.revision.id,
    };
    const resolveIssue = coreValue(core.openIssue({
      ...issueBase,
      kind: "evidence_boundary",
      violatedCriterion: "evidence_boundary",
      rationaleConcepts: ["canonical_evidence", "provenance"],
      summary: "Resolve the evidence boundary with canonical project Evidence.",
    }));
    const waiveIssue = coreValue(core.openIssue({
      ...issueBase,
      kind: "repeated_audit",
      violatedCriterion: "repeated_audit",
      rationaleConcepts: ["bounded_scope", "invalidation_condition"],
      summary: "Waive one bounded repeated audit with an explicit invalidation condition.",
    }));
    const disputeIssue = coreValue(core.openIssue({
      ...issueBase,
      kind: "argument_leap",
      violatedCriterion: "argument_leap",
      rationaleConcepts: ["user_dispute", "uncertainty"],
      summary: "Dispute an alleged argument leap without silently resolving it.",
    }));
    const episode = coreValue(core.startRevisionEpisode({
      projectId: project.id,
      artifactId: created.artifact.id,
      baselineRevisionId: created.revision.id,
      briefVersionId: brief.currentVersionId,
      actor: UI02_USER,
    }));
    core.close();
    coreClosed = true;

    const database = await openDatabase({ path: databasePath });
    try {
      const evidence = researchValue(parseArgumentEvidence({
        id: evidenceId,
        projectId: project.id,
        artifactId: created.artifact.id,
        revisionId: created.revision.id,
        kind: "artifact_span",
        summary: evidenceSummary,
        state: "current",
        inferenceCapacity: "descriptive",
        contentVersionHash: created.revision.content.contentHash,
        source: { actor: UI02_USER, authority: "user_recorded", recordedAt: "2026-08-25T10:00:00.000Z" },
        version: 1,
      }));
      researchValue(createResearchStore(database).argumentEvidence.create(evidence));
    } finally {
      database.close();
    }

    await writeFile(join(stateDirectory, "research-brief.yaml"), "# Durable projection replaced by an explicit Brief activation.\n", "utf8");
    await writeFile(join(root, "ordinary-project-note.txt"), `This ordinary file contains ${uniqueToken} and must never enter structured search.\n`, "utf8");
    return {
      root,
      projectId: project.id,
      title,
      question,
      originalTask,
      artifactId: created.artifact.id,
      revisionId: created.revision.id,
      briefVersionId: brief.currentVersionId,
      acceptedDecisionId: acceptedDecision.id,
      resolveIssueId: resolveIssue.id,
      waiveIssueId: waiveIssue.id,
      disputeIssueId: disputeIssue.id,
      evidenceId,
      evidenceSummary,
      episodeId: episode.id,
      cleanup: () => rm(root, { recursive: true, force: true }),
    };
  } catch (error) {
    if (!coreClosed) core.close();
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}
