import {
  FixedClock,
  SequenceIdFactory,
  activateRevisionEpisode,
  addArtifactRevision,
  createArtifactRevision,
  createResearchArtifact,
  createResearchBrief,
  createResearchDecision,
  createResearchIssue,
  createResearchProject,
  createResearchSnapshot,
  createRevisionEpisode,
  disposeRevisionEpisode,
  recordEpisodeReview,
  requireEpisodeUserAction,
  submitEpisodeCandidate,
  type ArtifactRevision,
  type ResearchArtifact,
  type ResearchBrief,
  type ResearchDecision,
  type ResearchIssue,
  type ResearchProject,
  type ResearchSnapshot,
  type RevisionEpisode,
} from "@sestina/research";

export const USER_ACTOR = { kind: "user", actorId: "lead" } as const;
export const MODEL_ACTOR = { kind: "model", model: "research-model" } as const;
export const SYSTEM_ACTOR = { kind: "system", component: "research-store-test" } as const;
export const USER_SOURCE = {
  actor: USER_ACTOR,
  authority: "user_recorded" as const,
  recordedAt: "2026-08-19T04:00:00.000Z",
};
export const MODEL_SOURCE = {
  actor: MODEL_ACTOR,
  authority: "model_proposed" as const,
  recordedAt: "2026-08-19T04:00:00.000Z",
};

function value<T>(result: { ok: true; value: T } | { ok: false; error: { code: string } }): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

export interface ResearchScenario {
  readonly clock: FixedClock;
  readonly ids: SequenceIdFactory;
  readonly project: ResearchProject;
  readonly emptyArtifact: ResearchArtifact;
  readonly revision1: ArtifactRevision;
  readonly revision2: ArtifactRevision;
  readonly artifact: ResearchArtifact;
  readonly brief: ResearchBrief;
  readonly decision: ResearchDecision;
  readonly issue: ResearchIssue;
  readonly draftEpisode: RevisionEpisode;
  readonly episode: RevisionEpisode;
  readonly snapshot: ResearchSnapshot;
}

export function makeScenario(seed = 2000): ResearchScenario {
  const clock = new FixedClock("2026-08-19T04:30:00.000Z");
  const ids = new SequenceIdFactory(seed);
  const ports = { clock, idFactory: ids };
  const project = value(createResearchProject(
    { title: "研究项目 α", rootPath: ".", source: USER_SOURCE },
    ports,
  ));
  const emptyArtifact = value(createResearchArtifact(
    { projectId: project.id, kind: "manuscript", title: "论文 ‘核心’", source: USER_SOURCE },
    ports,
  ));
  const revision1 = value(createArtifactRevision(
    {
      projectId: project.id,
      artifactId: emptyArtifact.id,
      content: "第一版\n包含引号 ' 和 SQL ; --",
      mediaType: "text/markdown",
      source: USER_SOURCE,
    },
    ports,
  ));
  const artifact1 = value(addArtifactRevision(
    emptyArtifact,
    revision1,
    emptyArtifact.version,
  ));
  const revision2 = value(createArtifactRevision(
    {
      projectId: project.id,
      artifactId: emptyArtifact.id,
      parentRevisionId: revision1.id,
      content: "第二版：保留研究边界",
      mediaType: "text/markdown",
      source: USER_SOURCE,
    },
    ports,
  ));
  const artifact = value(addArtifactRevision(
    artifact1,
    revision2,
    artifact1.version,
  ));
  const brief = value(createResearchBrief(
    {
      projectId: project.id,
      projectQuestion: "平台治理如何影响参与？",
      currentStage: "analysis",
      currentTask: "收紧解释边界",
      targetArtifacts: [emptyArtifact.id],
      fixedDecisions: [{
        id: ids.create("rbrf_"),
        statement: "横截面数据不得声称因果",
        scope: { target: { kind: "artifact", artifactId: emptyArtifact.id }, operations: ["rewrite"] },
      }],
      allowedChanges: [{
        target: { kind: "heading", artifactId: emptyArtifact.id, heading: "讨论" },
        operations: ["add", "rewrite", "citation_add"],
      }],
      forbiddenChanges: [{
        target: { kind: "heading", artifactId: emptyArtifact.id, heading: "方法" },
        operations: ["rewrite", "data_replace"],
      }],
      expectedDeltas: [{
        id: ids.create("rbrf_"),
        statement: "增加一条有证据边界的解释",
        scope: { target: { kind: "artifact", artifactId: emptyArtifact.id }, operations: ["add"] },
      }],
      evidenceBoundaries: [{
        id: ids.create("rbrf_"),
        scope: { target: { kind: "artifact", artifactId: emptyArtifact.id }, operations: ["rewrite"] },
        statement: "不把相关性表述为因果",
        forbiddenInferenceKinds: ["causal"],
      }],
      explicitNonGoals: ["重新采集数据"],
      source: USER_SOURCE,
    },
    ports,
  ));
  const decision = value(createResearchDecision(
    {
      projectId: project.id,
      statement: "保留非因果表述",
      scope: { kind: "artifact", artifactId: emptyArtifact.id },
      rationale: "研究设计不支持因果识别",
      effectiveBriefVersionId: brief.currentVersionId,
      reopenConditions: ["获得实验设计证据"],
      source: USER_SOURCE,
    },
    ports,
  ));
  const issue = value(createResearchIssue(
    {
      projectId: project.id,
      kind: "evidence_boundary",
      target: { kind: "heading", artifactId: emptyArtifact.id, heading: "讨论" },
      violatedCriterion: "no-causal-claim-without-causal-evidence",
      rationaleConcepts: ["causal claim", "cross sectional data"],
      summary: "讨论部分存在越界因果表述",
      sourceArtifactId: emptyArtifact.id,
      sourceRevisionId: revision2.id,
      sourceRevisionContentHash: revision2.content.contentHash,
      lineageRootRevisionId: revision1.id,
      source: MODEL_SOURCE,
    },
    ports,
  ));
  const draftEpisode = value(createRevisionEpisode(
    {
      projectId: project.id,
      artifactId: emptyArtifact.id,
      source: USER_SOURCE,
      lockedStart: {
        briefVersionId: brief.currentVersionId,
        baselineRevisionId: revision1.id,
        activeDecisions: [],
        relevantIssues: [{ issueId: issue.id, status: issue.status, version: issue.version }],
        evidenceBoundaryIds: [brief.versions[0]?.evidenceBoundaries[0]?.id ?? ids.create("rbrf_")],
        checkerVersion: "checker-1",
        projectStateFingerprint: "a".repeat(64),
        repositoryStateFingerprint: "b".repeat(64),
      },
    },
    ports,
  ));
  const active = value(activateRevisionEpisode(draftEpisode, SYSTEM_ACTOR, draftEpisode.version, clock));
  const submitted = value(submitEpisodeCandidate(active, revision2.id, MODEL_ACTOR, active.version, clock));
  const reviewed = value(recordEpisodeReview(
    submitted,
    ids.create("rrun_"),
    [ids.create("rfnd_")],
    SYSTEM_ACTOR,
    submitted.version,
    clock,
  ));
  const pending = value(requireEpisodeUserAction(
    reviewed,
    {
      fulfillment: "met",
      evidence: "proven",
      scope: "compliant",
      decisionIntegrity: "preserved",
      issueIntegrity: "preserved",
      userDisposition: "pending",
    },
    SYSTEM_ACTOR,
    reviewed.version,
    clock,
  ));
  const episode = value(disposeRevisionEpisode(
    pending,
    "rejected",
    USER_ACTOR,
    pending.version,
    pending.lockedStart.briefVersionId,
    "候选版本削弱了论证",
    clock,
  ));
  const snapshot = value(createResearchSnapshot(
    episode,
    { buildVersion: "research-store-test", limitations: ["Hash proves integrity only"] },
    ports,
  ));
  return { clock, ids, project, emptyArtifact, revision1, revision2, artifact, brief, decision, issue, draftEpisode, episode, snapshot };
}
