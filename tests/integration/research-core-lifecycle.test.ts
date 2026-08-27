import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { openSestina, type CoreResult, type SestinaCore } from "../../packages/core/src/index.js";

const roots: string[] = [];
const cores: SestinaCore[] = [];
const USER = { kind: "user", actorId: "researcher" } as const;
const MODEL = { kind: "model", model: "offline-writer" } as const;

function valueOf<T>(result: CoreResult<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

afterEach(async () => {
  for (const core of cores.splice(0)) core.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("@sestina/core research lifecycle", () => {
  it("runs an empty-database revision lifecycle and reopens equivalent persisted state", async () => {
    const root = await mkdtemp(join(tmpdir(), "sestina-core-"));
    roots.push(root);
    const databasePath = join(root, "state.sqlite");
    const opened = await openSestina({ databasePath });
    const core = valueOf(opened);
    cores.push(core);

    const project = valueOf(core.initializeProject({ title: "Offline paper", actor: USER }));
    const rejectedAuthority = core.initializeProject({ title: "Forged project", actor: MODEL });
    expect(rejectedAuthority).toMatchObject({ ok: false, error: { code: "user_confirmation_required" } });
    const brief = valueOf(core.activateBrief({
      projectId: project.id,
      actor: USER,
      projectQuestion: "Does the revised claim stay within the observed evidence?",
      currentStage: "revision",
      currentTask: "Tighten the results claim",
      targetArtifacts: [],
      fixedDecisions: [],
      allowedChanges: [{ target: { kind: "project_path", relativePath: "paper/manuscript.md" }, operations: ["add", "delete", "rewrite"] }],
      forbiddenChanges: [],
      expectedDeltas: [{ statement: "Qualify the results claim", scope: { target: { kind: "project_path", relativePath: "paper/manuscript.md" }, operations: ["rewrite"] } }],
      evidenceBoundaries: [],
      explicitNonGoals: ["Add new data"],
    }));
    const artifact = valueOf(core.createArtifact({ projectId: project.id, kind: "manuscript", relativePath: "paper/manuscript.md", actor: USER }));
    const unsafePath = core.createArtifact({ projectId: project.id, kind: "manuscript", relativePath: "C:\\Users\\private\\secret.md", actor: USER });
    expect(unsafePath).toEqual({ ok: false, error: { code: "invalid_input", message: "The request is invalid." } });
    const baseline = valueOf(core.createRevision({ projectId: project.id, artifactId: artifact.id, content: "# Results\n\nThe intervention caused the improvement.\n", mediaType: "text/markdown", actor: USER }));
    const decision = valueOf(core.recordDecision({
      projectId: project.id,
      actor: USER,
      statement: "Do not claim causality",
      scope: { kind: "artifact", artifactId: artifact.id },
      rationale: "The design is observational",
      effectiveBriefVersionId: brief.currentVersionId,
      reopenConditions: ["A causal design is supplied"],
      status: "frozen",
    }));
    const issue = valueOf(core.openIssue({
      projectId: project.id,
      actor: USER,
      kind: "argument_leap",
      target: { kind: "artifact", artifactId: artifact.id },
      violatedCriterion: "Causal claims require causal evidence",
      rationaleConcepts: ["causality", "observational design"],
      summary: "The baseline overstates causality",
      sourceArtifactId: artifact.id,
      sourceRevisionId: baseline.id,
      sourceRevisionContentHash: baseline.content.contentHash,
      lineageRootRevisionId: baseline.id,
    }));
    const episode = valueOf(core.startRevisionEpisode({ projectId: project.id, artifactId: artifact.id, briefVersionId: brief.currentVersionId, baselineRevisionId: baseline.id, actor: USER }));
    const candidate = valueOf(core.createRevision({ projectId: project.id, artifactId: artifact.id, parentRevisionId: baseline.id, content: "# Results\n\nThe improvement was associated with the intervention.\n", mediaType: "text/markdown", actor: MODEL }));
    valueOf(core.submitCandidateRevision({ projectId: project.id, episodeId: episode.id, candidateRevisionId: candidate.id, actor: MODEL }));
    const reviewed = valueOf(await core.runDeterministicReview({ projectId: project.id, episodeId: episode.id }));
    expect(reviewed.episode.status).toBe("user_action_required");
    expect(reviewed.outcome.dimensions.fulfillment.coverage[0]?.status).toBe("unproven");
    expect(reviewed.run.context.activeDecisions).toContainEqual(expect.objectContaining({ id: decision.id }));
    expect(reviewed.run.context.relevantIssues).toContainEqual(expect.objectContaining({ id: issue.id }));

    const accepted = valueOf(core.recordUserDisposition({ projectId: project.id, episodeId: episode.id, disposition: "accepted", reason: "The causal overclaim is removed", actor: USER }));
    const memoryCanary = "ri51-project-working-memory-must-not-enter-ordinary-export";
    const memoryCandidate = valueOf(core.createProjectMemoryCandidate({ projectId: project.id, kind: "resume_note", content: { text: memoryCanary }, retention: { policy: "until_unpinned" }, sensitivity: "project_private", outboundPolicy: "never_send", publicReason: "Exercise ordinary export exclusion.", actor: USER }));
    valueOf(core.confirmProjectMemory({ projectId: project.id, itemId: memoryCandidate.id, expectedVersion: memoryCandidate.version, publicReason: "Keep this note local to governed project memory.", actor: USER }));
    const snapshot = valueOf(core.createResearchSnapshot({ projectId: project.id, episodeId: accepted.id, buildVersion: "sestina-core-test", limitations: ["Content integrity is not semantic proof"] }));
    const beforeReport = valueOf(core.getEpisode(project.id, accepted.id));
    const report = valueOf(core.renderReviewReport({ projectId: project.id, episodeId: accepted.id, format: "markdown" }));
    const capsule = valueOf(core.exportCapsule({ projectId: project.id, episodeId: accepted.id }));
    expect(valueOf(core.getEpisode(project.id, accepted.id))).toEqual(beforeReport);
    expect(report).toContain("Unchecked or uncertain");
    expect(capsule.capsule.hashMeaning).toBe("content_integrity_only_not_signature_or_proof");
    expect(report).not.toContain(memoryCanary);
    expect(capsule.json).not.toContain(memoryCanary);

    const responseFor = (capsuleHash: string, snapshotHash: string, reviewInputHash: string) => JSON.stringify({
      schemaVersion: "1.0.0",
      authority: "model_proposed_candidate_only",
      projectId: project.id,
      capsuleHash,
      snapshotHash,
      reviewInputHash,
      briefVersionId: brief.currentVersionId,
      artifactRevisionId: candidate.id,
      response: { summary: "Bounded model proposal", findings: ["Candidate observation"] },
    });
    const initialResponse = responseFor(capsule.capsule.capsuleHash, capsule.capsule.snapshot.hash, capsule.capsule.reviewInputHash);
    expect(valueOf(core.importCapsuleResponse(project.id, initialResponse))).toMatchObject({ status: "candidate", authority: "model_proposed", canMutateAuthority: false });

    const editedBrief = valueOf(core.editBrief({
      projectId: project.id,
      actor: USER,
      expectedVersion: brief.version,
      projectQuestion: "Does the revised claim stay within the observed evidence?",
      currentStage: "revision",
      currentTask: "Tighten the results claim and preserve the observational boundary",
      targetArtifacts: [],
      fixedDecisions: [],
      allowedChanges: [{ target: { kind: "project_path", relativePath: "paper/manuscript.md" }, operations: ["add", "delete", "rewrite"] }],
      forbiddenChanges: [],
      expectedDeltas: [{ statement: "Qualify the results claim", scope: { target: { kind: "project_path", relativePath: "paper/manuscript.md" }, operations: ["rewrite"] } }],
      evidenceBoundaries: [],
      explicitNonGoals: ["Add new data"],
    }));
    expect(core.importCapsuleResponse(project.id, initialResponse)).toMatchObject({ ok: false, error: { code: "stale_state" } });

    const afterBrief = valueOf(core.exportCapsule({ projectId: project.id, episodeId: accepted.id }));
    const afterBriefResponse = responseFor(afterBrief.capsule.capsuleHash, afterBrief.capsule.snapshot.hash, afterBrief.capsule.reviewInputHash);
    expect(valueOf(core.importCapsuleResponse(project.id, afterBriefResponse))).toMatchObject({ status: "candidate" });
    valueOf(core.resolveIssue({ projectId: project.id, issueId: issue.id, actor: USER, reason: "The candidate removes the overclaim", resolutionEvidenceId: candidate.id }));
    expect(core.importCapsuleResponse(project.id, afterBriefResponse)).toMatchObject({ ok: false, error: { code: "stale_state" } });

    const afterIssue = valueOf(core.exportCapsule({ projectId: project.id, episodeId: accepted.id }));
    const afterIssueResponse = responseFor(afterIssue.capsule.capsuleHash, afterIssue.capsule.snapshot.hash, afterIssue.capsule.reviewInputHash);
    expect(valueOf(core.importCapsuleResponse(project.id, afterIssueResponse))).toMatchObject({ status: "candidate" });
    valueOf(core.startRevisionEpisode({ projectId: project.id, artifactId: artifact.id, briefVersionId: editedBrief.version.id, baselineRevisionId: candidate.id, actor: USER }));
    expect(core.importCapsuleResponse(project.id, afterIssueResponse)).toMatchObject({ ok: false, error: { code: "stale_state" } });

    core.close();
    const reopened = valueOf(await openSestina({ databasePath, readOnly: true }));
    cores.push(reopened);
    expect(valueOf(reopened.getProject(project.id))).toEqual(project);
    expect(valueOf(reopened.getEpisode(project.id, accepted.id))).toEqual(accepted);
    expect(valueOf(reopened.getReviewRun(project.id, reviewed.run.id))).toEqual(reviewed.run);
    expect(valueOf(reopened.getSnapshot(project.id, snapshot.id))).toEqual(snapshot);
    reopened.close();
  });
});
