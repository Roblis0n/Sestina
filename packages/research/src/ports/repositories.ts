import type { ArtifactRevision } from "../artifact/artifact-revision.js";
import type { ResearchArtifact } from "../artifact/research-artifact.js";
import type { ResearchBrief } from "../brief/research-brief.js";
import type { DecisionScope } from "../decision/decision-scope.js";
import type { ResearchDecision } from "../decision/research-decision.js";
import { isRecord } from "../domain-validation.js";
import type { RevisionEpisode } from "../episode/revision-episode.js";
import { researchError } from "../errors.js";
import type { EntityVersion } from "../identity/entity-version.js";
import type { IssueStatus } from "../issue/issue-transition.js";
import type { ResearchIssue } from "../issue/research-issue.js";
import type { ResearchProject } from "../project/research-project.js";
import { err, ok } from "../result.js";
import type { ResearchResult } from "../result.js";
import type { ResearchSnapshot } from "../snapshot/research-snapshot.js";

export const RESEARCH_PAGE_LIMIT_MAX = 200;

export interface ResearchPageRequest {
  readonly limit: number;
  readonly cursor?: string;
}

export interface ResearchPage<T> {
  readonly items: readonly T[];
  readonly nextCursor?: string;
}

export function parseResearchPageRequest(input: unknown): ResearchResult<ResearchPageRequest> {
  if (
    !isRecord(input) ||
    typeof input.limit !== "number" ||
    !Number.isSafeInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > RESEARCH_PAGE_LIMIT_MAX ||
    (input.cursor !== undefined &&
      (typeof input.cursor !== "string" || input.cursor.length === 0 || input.cursor.length > 4096))
  ) {
    return err(researchError("invalid_pagination"));
  }
  return ok({
    limit: input.limit,
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
  });
}

export interface ResearchProjectRepository {
  create(value: ResearchProject): ResearchResult<ResearchProject>;
  getById(projectId: string): ResearchResult<ResearchProject | undefined>;
  list(page: ResearchPageRequest): ResearchResult<ResearchPage<ResearchProject>>;
  compareAndSwap(value: ResearchProject, expectedVersion: EntityVersion): ResearchResult<ResearchProject>;
}

export interface ResearchArtifactRepository {
  create(value: ResearchArtifact): ResearchResult<ResearchArtifact>;
  getById(projectId: string, artifactId: string): ResearchResult<ResearchArtifact | undefined>;
  listByProject(projectId: string, page: ResearchPageRequest): ResearchResult<ResearchPage<ResearchArtifact>>;
  compareAndSwap(value: ResearchArtifact, expectedVersion: EntityVersion): ResearchResult<ResearchArtifact>;
}

export interface ArtifactRevisionRepository {
  append(value: ArtifactRevision): ResearchResult<ArtifactRevision>;
  getById(projectId: string, artifactId: string, revisionId: string): ResearchResult<ArtifactRevision | undefined>;
  listByArtifact(projectId: string, artifactId: string, page: ResearchPageRequest): ResearchResult<ResearchPage<ArtifactRevision>>;
}

export interface ResearchBriefRepository {
  create(value: ResearchBrief): ResearchResult<ResearchBrief>;
  getById(projectId: string, briefId: string): ResearchResult<ResearchBrief | undefined>;
  listByProject(projectId: string, page: ResearchPageRequest): ResearchResult<ResearchPage<ResearchBrief>>;
  compareAndSwap(value: ResearchBrief, expectedVersion: EntityVersion): ResearchResult<ResearchBrief>;
}

export interface ResearchDecisionRepository {
  create(value: ResearchDecision): ResearchResult<ResearchDecision>;
  getById(projectId: string, decisionId: string): ResearchResult<ResearchDecision | undefined>;
  listByScope(projectId: string, scope: DecisionScope | undefined, page: ResearchPageRequest): ResearchResult<ResearchPage<ResearchDecision>>;
  appendTransition(value: ResearchDecision, expectedVersion: EntityVersion): ResearchResult<ResearchDecision>;
}

export interface ResearchIssueRepository {
  create(value: ResearchIssue): ResearchResult<ResearchIssue>;
  getById(projectId: string, issueId: string): ResearchResult<ResearchIssue | undefined>;
  listByStatus(projectId: string, status: IssueStatus | undefined, page: ResearchPageRequest): ResearchResult<ResearchPage<ResearchIssue>>;
  appendTransition(value: ResearchIssue, expectedVersion: EntityVersion): ResearchResult<ResearchIssue>;
}

export interface RevisionEpisodeRepository {
  create(value: RevisionEpisode): ResearchResult<RevisionEpisode>;
  getById(projectId: string, episodeId: string): ResearchResult<RevisionEpisode | undefined>;
  listByProject(projectId: string, page: ResearchPageRequest): ResearchResult<ResearchPage<RevisionEpisode>>;
  compareAndSwap(value: RevisionEpisode, expectedVersion: EntityVersion): ResearchResult<RevisionEpisode>;
}

export interface ResearchSnapshotRepository {
  create(value: ResearchSnapshot): ResearchResult<ResearchSnapshot>;
  getById(projectId: string, snapshotId: string): ResearchResult<ResearchSnapshot | undefined>;
  listByEpisode(projectId: string, episodeId: string, page: ResearchPageRequest): ResearchResult<ResearchPage<ResearchSnapshot>>;
}

export interface ResearchRepositories {
  readonly projects: ResearchProjectRepository;
  readonly artifacts: ResearchArtifactRepository;
  readonly revisions: ArtifactRevisionRepository;
  readonly briefs: ResearchBriefRepository;
  readonly decisions: ResearchDecisionRepository;
  readonly issues: ResearchIssueRepository;
  readonly episodes: RevisionEpisodeRepository;
  readonly snapshots: ResearchSnapshotRepository;
}

export interface ResearchUnitOfWork {
  readonly repositories: ResearchRepositories;
  commit<T>(work: (repositories: ResearchRepositories) => ResearchResult<T>): ResearchResult<T>;
}
