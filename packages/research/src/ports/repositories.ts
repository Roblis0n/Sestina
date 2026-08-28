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
import type { ArgumentClaim } from "../argument/claim.js";
import type { ArgumentEvidence } from "../argument/evidence.js";
import type { MechanismLink } from "../argument/mechanism-link.js";
import type { ClaimEvidenceLink } from "../argument/claim-evidence-link.js";
import type { MechanismEvidenceLink } from "../argument/mechanism-evidence-link.js";
import type { ArgumentDelta } from "../argument/argument-delta.js";
import type { ResearchRoomReceipt } from "../room/research-room.js";
import type { CorrectionAppeal } from "../appeal/correction-appeal.js";
import type { DeliberationRoom, DeliberationSourceKind } from "../deliberation/deliberation-room.js";
import type { ProjectWorkingMemory, ProjectWorkingMemoryState, ResumeCheckpoint } from "../memory/project-working-memory.js";
import type { ClosedExternalAppPilot, ClosedExternalAppPilotStatus, ClosedPilotAttempt, ClosedPilotEvent } from "../pilot/closed-external-app-pilot.js";

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

export interface ArgumentNodeRepository<T> {
  create(value: T): ResearchResult<T>;
  getById(projectId: string, id: string): ResearchResult<T | undefined>;
  listByProject(projectId: string, page: ResearchPageRequest): ResearchResult<ResearchPage<T>>;
  compareAndSwap(value: T, expectedVersion: EntityVersion): ResearchResult<T>;
}
export type ArgumentClaimRepository = ArgumentNodeRepository<ArgumentClaim>;
export type ArgumentEvidenceRepository = ArgumentNodeRepository<ArgumentEvidence>;
export type MechanismLinkRepository = ArgumentNodeRepository<MechanismLink>;
export type ArgumentDeltaRepository = ArgumentNodeRepository<ArgumentDelta>;
export interface ClaimEvidenceLinkRepository {
  create(value: ClaimEvidenceLink): ResearchResult<ClaimEvidenceLink>;
  get(projectId: string, claimId: string, evidenceId: string): ResearchResult<ClaimEvidenceLink | undefined>;
  listByProject(projectId: string, page: ResearchPageRequest): ResearchResult<ResearchPage<ClaimEvidenceLink>>;
  compareAndSwap(value: ClaimEvidenceLink, expectedVersion: EntityVersion): ResearchResult<ClaimEvidenceLink>;
}
export interface MechanismEvidenceLinkRepository {
  create(value: MechanismEvidenceLink): ResearchResult<MechanismEvidenceLink>;
  get(projectId: string, mechanismLinkId: string, evidenceId: string): ResearchResult<MechanismEvidenceLink | undefined>;
  listByProject(projectId: string, page: ResearchPageRequest): ResearchResult<ResearchPage<MechanismEvidenceLink>>;
  compareAndSwap(value: MechanismEvidenceLink, expectedVersion: EntityVersion): ResearchResult<MechanismEvidenceLink>;
}
export interface ArgumentGraphRepositories {
  readonly claims: ArgumentClaimRepository;
  readonly argumentEvidence: ArgumentEvidenceRepository;
  readonly mechanismLinks: MechanismLinkRepository;
  readonly claimEvidenceLinks: ClaimEvidenceLinkRepository;
  readonly mechanismEvidenceLinks: MechanismEvidenceLinkRepository;
  readonly argumentDeltas: ArgumentDeltaRepository;
}

export interface ResearchRoomReceiptRepository {
  create(value: ResearchRoomReceipt): ResearchResult<ResearchRoomReceipt>;
  getById(projectId: string, receiptId: string): ResearchResult<ResearchRoomReceipt | undefined>;
  listByProject(projectId: string, page: ResearchPageRequest): ResearchResult<ResearchPage<ResearchRoomReceipt>>;
  compareAndSwap(value: ResearchRoomReceipt, expectedVersion: EntityVersion): ResearchResult<ResearchRoomReceipt>;
}

export interface CorrectionAppealRepository {
  create(value: CorrectionAppeal): ResearchResult<CorrectionAppeal>;
  getById(projectId: string, appealId: string): ResearchResult<CorrectionAppeal | undefined>;
  getActiveBySource(projectId: string, reviewId: string, findingId: string): ResearchResult<CorrectionAppeal | undefined>;
  listByProject(projectId: string, page: ResearchPageRequest): ResearchResult<ResearchPage<CorrectionAppeal>>;
  compareAndSwap(value: CorrectionAppeal, expectedVersion: EntityVersion): ResearchResult<CorrectionAppeal>;
}

export interface DeliberationRoomRepository {
  create(value: DeliberationRoom): ResearchResult<DeliberationRoom>;
  getById(projectId: string, roomId: string): ResearchResult<DeliberationRoom | undefined>;
  getActiveBySource(projectId: string, sourceKind: DeliberationSourceKind, sourceObjectId: string): ResearchResult<DeliberationRoom | undefined>;
  listByProject(projectId: string, page: ResearchPageRequest): ResearchResult<ResearchPage<DeliberationRoom>>;
  compareAndSwap(value: DeliberationRoom, expectedVersion: EntityVersion): ResearchResult<DeliberationRoom>;
}

export interface ProjectWorkingMemoryRepository {
  create(value: ProjectWorkingMemory): ResearchResult<ProjectWorkingMemory>;
  getById(projectId: string, itemId: string): ResearchResult<ProjectWorkingMemory | undefined>;
  listByProject(projectId: string, page: ResearchPageRequest, states?: readonly ProjectWorkingMemoryState[]): ResearchResult<ResearchPage<ProjectWorkingMemory>>;
  compareAndSwap(value: ProjectWorkingMemory, expectedVersion: EntityVersion): ResearchResult<ProjectWorkingMemory>;
}

export interface ResumeCheckpointRepository {
  append(value: ResumeCheckpoint): ResearchResult<ResumeCheckpoint>;
  getLatest(projectId: string): ResearchResult<ResumeCheckpoint | undefined>;
  listByProject(projectId: string, page: ResearchPageRequest): ResearchResult<ResearchPage<ResumeCheckpoint>>;
}

export interface ClosedExternalAppPilotRepository {
  create(value: ClosedExternalAppPilot): ResearchResult<ClosedExternalAppPilot>;
  getById(projectId: string, pilotId: string): ResearchResult<ClosedExternalAppPilot | undefined>;
  listByProject(projectId: string, page: ResearchPageRequest, statuses?: readonly ClosedExternalAppPilotStatus[]): ResearchResult<ResearchPage<ClosedExternalAppPilot>>;
  listAttempts(projectId: string, pilotId: string, page: ResearchPageRequest): ResearchResult<ResearchPage<ClosedPilotAttempt>>;
  listEvents(projectId: string, pilotId: string, page: ResearchPageRequest): ResearchResult<ResearchPage<ClosedPilotEvent>>;
  compareAndSwap(value: ClosedExternalAppPilot, expectedVersion: EntityVersion): ResearchResult<ClosedExternalAppPilot>;
}

export interface ResearchRepositories extends ArgumentGraphRepositories {
  readonly projects: ResearchProjectRepository;
  readonly artifacts: ResearchArtifactRepository;
  readonly revisions: ArtifactRevisionRepository;
  readonly briefs: ResearchBriefRepository;
  readonly decisions: ResearchDecisionRepository;
  readonly issues: ResearchIssueRepository;
  readonly episodes: RevisionEpisodeRepository;
  readonly snapshots: ResearchSnapshotRepository;
  readonly roomReceipts: ResearchRoomReceiptRepository;
  readonly correctionAppeals: CorrectionAppealRepository;
  readonly deliberationRooms: DeliberationRoomRepository;
  readonly workingMemory: ProjectWorkingMemoryRepository;
  readonly resumeCheckpoints: ResumeCheckpointRepository;
  readonly closedExternalAppPilots: ClosedExternalAppPilotRepository;
}

export interface ResearchUnitOfWork {
  readonly repositories: ResearchRepositories;
  commit<T>(work: (repositories: ResearchRepositories) => ResearchResult<T>): ResearchResult<T>;
}
