import {
  activateRevisionEpisode,
  addArtifactRevision,
  applyEpisodeWaiver,
  confirmBriefChangeProposal,
  createArtifactRevision,
  createBriefChangeProposal,
  createResearchArtifact,
  createResearchBrief,
  createResearchDecision,
  createResearchIssue,
  createResearchProject,
  createResearchSnapshot as createFinalResearchSnapshot,
  createReviewInputSnapshot,
  createRevisionEpisode,
  disputeResearchIssue,
  disposeRevisionEpisode,
  exportResearchBriefYaml,
  getActiveResearchBriefVersion,
  getResearchBriefVersion,
  parseResearchSource,
  recordEpisodeReview,
  requireEpisodeUserAction,
  reopenResearchIssue,
  resolveResearchIssue,
  stableResearchHash,
  submitEpisodeCandidate,
  supersedeResearchDecision,
  transitionResearchDecision,
  verifyResearchSnapshotHash,
  waiveResearchIssue,
  type ArtifactRevision,
  type BriefChangeProposal,
  type BriefChangeSet,
  type Clock,
  type EpisodeOutcome,
  type IdFactory,
  type ResearchActor,
  type ResearchArtifact,
  type ResearchBrief,
  type ResearchBriefVersion,
  type ResearchDecision,
  type ResearchIssue,
  type ResearchProject,
  type ResearchSnapshot,
  type ResearchSource,
  type RevisionEpisode,
} from "@sestina/research";
import { createResearchStore, createSqliteReviewRunRepository, type ResearchStore } from "@sestina/research-store";
import {
  calculateReviewInputHash,
  CheckerRegistry,
  deriveCoverage,
  deriveReviewObligations,
  deriveReviewOutcome,
  FreshnessChecker,
  findingToIssueCandidate,
  IssueIntegrityChecker,
  parseProjectRelativePath,
  parseReviewContext,
  parseReviewRun,
  projectFindings,
  runReview,
  ScopeChecker,
  diffMarkdownBlocks,
  type ObligationAssessment,
  type BlockDiff,
  type ObligationCoverage,
  type ReviewObligation,
  type ReviewOutcome,
  type ReviewRun,
  type ReviewRunRepository,
  type FindingProjection,
} from "@sestina/review";
import {
  exportCapsule as exportReviewCapsule,
  importCapsuleResponse as importReviewCapsuleResponse,
  renderReviewJson,
  renderReviewMarkdown,
  type CapsuleCandidateResponse,
  type ReviewCapsule,
} from "@sestina/reports";
import {
  backupDatabase,
  checkDatabaseIntegrity,
  openDatabase,
  readSchemaVersion,
  RUNTIME_VERSION,
  SCHEMA_VERSION,
  type StorageDatabase,
} from "@sestina/storage";
import type {
  ActivateBriefCommand,
  AcceptBriefChangeCommand,
  ApplyEpisodeWaiverCommand,
  CreateArtifactCommand,
  CreateArtifactWithRevisionCommand,
  CreateResearchSnapshotCommand,
  CreateRevisionCommand,
  EditBriefCommand,
  ExportCapsuleCommand,
  InitializeProjectCommand,
  OpenIssueCommand,
  ProposeBriefChangeCommand,
  ReopenIssueCommand,
  RecordDecisionCommand,
  RecordUserDispositionCommand,
  RenderReviewReportCommand,
  ResolveIssueCommand,
  RunDeterministicReviewCommand,
  StartRevisionEpisodeCommand,
  SubmitCandidateRevisionCommand,
  SupersedeDecisionCommand,
  TransitionDecisionCommand,
  DisputeIssueCommand,
  WaiveIssueCommand,
} from "./commands/index.js";
import { RELEASE_IDENTITY } from "./release-identity.js";
import { coreErr, coreOk, fromDomain, mapDomainError, type CoreResult } from "./errors.js";
import { RandomIdFactory, SystemClock } from "./id-factory.js";
import { CoreUnitOfWork } from "./unit-of-work.js";
import {
  ResearchRoomService,
  type AnalyzedResearchRoomReview,
  type CommitResearchRoomDispositionInput,
  type PrepareResearchRoomReviewInput,
  type PreparedResearchRoomReview,
  type ResearchRoomProvider,
  type ResearchRoomState,
  type RollbackResearchRoomReceiptInput,
} from "./research-room.js";
import type { ResearchRoomReceipt } from "@sestina/research";
import type { CorrectionAppeal } from "@sestina/research";
import {
  CorrectionAppealService,
  type CancelCorrectionAppealSecondOpinionInput,
  type CorrectionAppealCommandInput,
  type CorrectionAppealSecondOpinionProvider,
  type CreateCorrectionAppealInput,
  type PrepareCorrectionAppealSecondOpinionCoreInput,
  type PreparedCorrectionAppealSecondOpinion,
  type ResolveCorrectionAppealInput,
  type RunCorrectionAppealSecondOpinionInput,
  type UpdateCorrectionAppealInput,
} from "./correction-appeal.js";
import {
  ResearchObjectWorkspaceService,
  type AppealDetailProjection,
  type AppealSummaryProjection,
  type AttentionProjection,
  type BriefWorkspaceProjection,
  type DecisionDetailProjection,
  type DecisionSummaryProjection,
  type EvidenceDetailProjection,
  type EvidenceSummaryProjection,
  type EpisodeDetailProjection,
  type EpisodeSummaryProjection,
  type IssueDetailProjection,
  type IssueSummaryProjection,
  type ProjectOverviewProjection,
  type ReceiptDetailProjection,
  type ReceiptSummaryProjection,
  type ResearchObjectSearchProjection,
  type WorkspaceListRequest,
  type WorkspacePage,
  type WorkspaceProviderStatus,
} from "./research-object-workspaces.js";

const PAGE = Object.freeze({ limit: 200 });
const SYSTEM_ACTOR: ResearchActor = Object.freeze({ kind: "system", component: "sestina-core" });
const CHECKERS = Object.freeze([
  Object.freeze({ id: "freshness", version: "1.0.0", kind: "deterministic" as const }),
  Object.freeze({ id: "scope", version: "1.0.0", kind: "deterministic" as const }),
]);

export interface OpenSestinaOptions {
  readonly databasePath: string;
  readonly readOnly?: boolean;
  readonly immutable?: boolean;
  readonly clock?: Clock;
  readonly idFactory?: IdFactory;
  readonly researchRoomProvider?: ResearchRoomProvider;
  readonly researchRoomProviderTimeoutMs?: number;
  readonly correctionAppealSecondOpinionProvider?: CorrectionAppealSecondOpinionProvider;
  readonly correctionAppealSecondOpinionProviderTimeoutMs?: number;
}

export interface DeterministicReviewResult {
  readonly run: ReviewRun;
  readonly episode: RevisionEpisode;
  readonly snapshot: ResearchSnapshot;
  readonly obligations: readonly ReviewObligation[];
  readonly coverage: readonly ObligationCoverage[];
  readonly outcome: ReviewOutcome;
  readonly findingProjection: FindingProjection;
}

export interface CoreDatabaseDiagnostics {
  readonly database: { readonly readable: true; readonly writable: boolean; readonly integrity: "ok" };
  readonly schema: { readonly current: number; readonly expected: number; readonly runtimeVersion: string; readonly status: "current" | "behind" | "too_new" };
  readonly backup: { readonly status: "ok"; readonly schemaVersion: number; readonly hash: string; readonly sizeBytes: number };
}

export interface CoreBriefState {
  readonly brief: ResearchBrief;
  readonly version: ResearchBriefVersion;
  readonly yaml: string;
}

export interface CoreBriefMutation {
  readonly brief: ResearchBrief;
  readonly version: ResearchBriefVersion;
  readonly changedFields: readonly string[];
}

export interface BriefProjectionPublication {
  rollback(): void;
  finalize(): void;
}

export type BriefProjectionPublisher = (yaml: string) => CoreResult<BriefProjectionPublication>;

export interface EpisodeIntegritySummary {
  readonly unresolved: readonly string[];
  readonly stale: readonly string[];
  readonly disputed: readonly string[];
  readonly unproven: readonly string[];
  readonly checkerFailed: readonly string[];
}

export interface CoreReviewSummary {
  readonly run: ReviewRun;
  readonly episode: RevisionEpisode;
  readonly obligations: readonly ReviewObligation[];
  readonly coverage: readonly ObligationCoverage[];
  readonly outcome: ReviewOutcome;
  readonly findingProjection: FindingProjection;
}

function now(clock: Clock): string | undefined {
  try {
    const value = clock.now();
    return value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : undefined;
  } catch {
    return undefined;
  }
}

function sourceFor(actor: ResearchActor, clock: Clock, userConfirmed = false): CoreResult<ResearchSource> {
  const recordedAt = now(clock);
  if (recordedAt === undefined) return coreErr("infrastructure_failure");
  const authority = actor.kind === "user"
    ? (userConfirmed ? "user_confirmed" : "user_recorded")
    : actor.kind === "model"
      ? "model_proposed"
      : actor.kind === "system"
        ? "system_derived"
        : "imported_unconfirmed";
  return fromDomain(parseResearchSource({ actor, authority, recordedAt }));
}

function requireUser(actor: ResearchActor): CoreResult<ResearchActor & { readonly kind: "user" }> {
  return actor.kind === "user" ? coreOk(actor) : coreErr("user_confirmation_required");
}

function hash(value: unknown): CoreResult<string> {
  return fromDomain(stableResearchHash(value));
}

function materializeBriefChanges(changes: BriefChangeSet, idFactory: IdFactory): BriefChangeSet {
  return {
    ...changes,
    ...(changes.fixedDecisions === undefined ? {} : { fixedDecisions: changes.fixedDecisions.map((item) => ({ ...item, id: item.id || idFactory.create("rbrf_") })) }),
    ...(changes.expectedDeltas === undefined ? {} : { expectedDeltas: changes.expectedDeltas.map((item) => ({ ...item, id: item.id || idFactory.create("rbrf_") })) }),
    ...(changes.evidenceBoundaries === undefined ? {} : { evidenceBoundaries: changes.evidenceBoundaries.map((item) => ({ ...item, id: item.id || idFactory.create("rbrf_") })) }),
  };
}

function found<T>(result: CoreResult<T | undefined>): CoreResult<T> {
  return result.ok ? (result.value === undefined ? coreErr("not_found") : coreOk(result.value)) : result;
}

function episodeOutcomeFromCoverage(coverage: readonly ObligationCoverage[]): EpisodeOutcome {
  const scope = coverage.filter((item) => item.obligationId.startsWith("robl_")).some((item) => item.status === "checked_violated")
    ? "violated"
    : coverage.some((item) => item.status === "checked_satisfied")
      ? "compliant"
      : "unknown";
  return Object.freeze({
    fulfillment: "unknown",
    evidence: "unproven",
    scope,
    decisionIntegrity: "unknown",
    issueIntegrity: "unknown",
    userDisposition: "pending",
  });
}

function reviewProducts(run: ReviewRun, episode: RevisionEpisode): {
  readonly obligations: readonly ReviewObligation[];
  readonly coverage: readonly ObligationCoverage[];
  readonly outcome: ReviewOutcome;
} {
  const obligations = deriveReviewObligations(run.context, []);
  const scopeFindings = run.findings.filter((finding) => ["scope_violation", "scope_rule_conflict", "scope_unknown"].includes(finding.kind));
  const scopeCheckerFailed = run.checkerErrors.some((item) => item.checker.id === "scope");
  const assessments: ObligationAssessment[] = obligations
    .filter((obligation) => obligation.dimension === "scope")
    .map((obligation) => {
      const violations = scopeFindings.filter((finding) => finding.kind !== "scope_unknown");
      if (scopeCheckerFailed) return { obligationId: obligation.id, status: "checker_failed" as const, findingIds: scopeFindings.map((item) => item.id), explanation: "The deterministic scope checker failed." };
      if (violations.length > 0) return { obligationId: obligation.id, status: "checked_violated" as const, findingIds: violations.map((item) => item.id), explanation: "Deterministic scope review found an out-of-scope change." };
      if (scopeFindings.some((finding) => finding.kind === "scope_unknown")) return { obligationId: obligation.id, status: "unproven" as const, findingIds: scopeFindings.map((item) => item.id), explanation: "The changed scope could not be located safely." };
      return { obligationId: obligation.id, status: "checked_satisfied" as const, findingIds: [], explanation: "Deterministic diff review found no scope violation." };
    });
  const coverage = deriveCoverage(obligations, assessments, run.findings);
  const userDisposition = episode.status === "accepted" ? "accepted"
    : episode.status === "rejected" ? "rejected"
      : episode.outcome?.userDisposition === "waived" ? "waived"
        : "pending";
  const outcome = deriveReviewOutcome({
    obligations,
    coverage,
    findings: run.findings,
    expectedCheckerIds: run.context.checkerSet.map((item) => item.id),
    completedCheckerIds: run.context.checkerSet.filter((item) => !run.checkerErrors.some((error) => error.checker.id === item.id)).map((item) => item.id),
    failedCheckerIds: run.checkerErrors.map((item) => item.checker.id),
    userDisposition,
  });
  return Object.freeze({ obligations, coverage, outcome });
}

export class SestinaCore {
  readonly #database: StorageDatabase;
  readonly #store: ResearchStore;
  readonly #reviews: ReviewRunRepository;
  readonly #clock: Clock;
  readonly #idFactory: IdFactory;
  readonly #unitOfWork: CoreUnitOfWork;
  readonly #researchRoom: ResearchRoomService;
  readonly #correctionAppeals: CorrectionAppealService;
  readonly #researchObjects: ResearchObjectWorkspaceService;

  constructor(database: StorageDatabase, clock: Clock, idFactory: IdFactory, researchRoomProvider?: ResearchRoomProvider, researchRoomProviderTimeoutMs = 15_000, correctionAppealSecondOpinionProvider?: CorrectionAppealSecondOpinionProvider, correctionAppealSecondOpinionProviderTimeoutMs = 15_000) {
    this.#database = database;
    this.#store = createResearchStore(database);
    this.#reviews = createSqliteReviewRunRepository(database);
    this.#clock = clock;
    this.#idFactory = idFactory;
    this.#unitOfWork = new CoreUnitOfWork(database);
    this.#researchRoom = new ResearchRoomService(this.#store, clock, idFactory, researchRoomProvider, researchRoomProviderTimeoutMs);
    this.#correctionAppeals = new CorrectionAppealService(this.#store, clock, idFactory, (projectId) => this.#researchRoom.getState(projectId), correctionAppealSecondOpinionProvider, correctionAppealSecondOpinionProviderTimeoutMs);
    this.#researchObjects = new ResearchObjectWorkspaceService(this.#store);
  }

  close(): void { this.#database.close(); }

  initializeProject(input: InitializeProjectCommand): CoreResult<ResearchProject> {
    const user = requireUser(input.actor); if (!user.ok) return user;
    const source = sourceFor(user.value, this.#clock); if (!source.ok) return source;
    const project = fromDomain(createResearchProject({ title: input.title, rootPath: input.rootPath ?? ".", source: source.value }, this.ports));
    return project.ok ? fromDomain(this.#store.projects.create(project.value)) : project;
  }

  activateBrief(input: ActivateBriefCommand): CoreResult<ResearchBrief> {
    const user = requireUser(input.actor); if (!user.ok) return user;
    const project = found(this.getProject(input.projectId)); if (!project.ok) return project;
    for (const artifactId of input.targetArtifacts) {
      const artifact = found(fromDomain(this.#store.artifacts.getById(input.projectId, artifactId)));
      if (!artifact.ok) return artifact;
    }
    const source = sourceFor(user.value, this.#clock, true); if (!source.ok) return source;
    const fixedDecisions = input.fixedDecisions.map((item) => ({ ...item, id: item.id ?? this.#idFactory.create("rbrf_") }));
    const expectedDeltas = input.expectedDeltas.map((item) => ({ ...item, id: item.id ?? this.#idFactory.create("rbrf_") }));
    const evidenceBoundaries = input.evidenceBoundaries.map((item) => ({ ...item, id: item.id ?? this.#idFactory.create("rbrf_") }));
    const brief = fromDomain(createResearchBrief({ ...input, projectId: input.projectId, fixedDecisions, expectedDeltas, evidenceBoundaries, source: source.value }, this.ports));
    return brief.ok ? fromDomain(this.#store.briefs.create(brief.value)) : brief;
  }

  getBriefState(projectId: string): CoreResult<CoreBriefState | undefined> {
    const active = this.findActiveBrief(projectId); if (!active.ok) return active;
    if (active.value === undefined) return coreOk(undefined);
    const yaml = fromDomain(exportResearchBriefYaml(active.value.version));
    return yaml.ok ? coreOk(Object.freeze({ ...active.value, yaml: yaml.value })) : yaml;
  }

  editBrief(input: EditBriefCommand): CoreResult<CoreBriefMutation> {
    const user = requireUser(input.actor); if (!user.ok) return user;
    const active = this.findActiveBrief(input.projectId); if (!active.ok) return active;
    if (active.value === undefined) {
      if (input.expectedVersion !== undefined && input.expectedVersion !== 0) return coreErr("stale_state");
      const created = this.activateBrief(input); if (!created.ok) return created;
      const version = getActiveResearchBriefVersion(created.value); if (version === undefined) return coreErr("infrastructure_failure");
      return coreOk(Object.freeze({ brief: created.value, version, changedFields: Object.freeze(["projectQuestion", "currentStage", "currentTask", "targetArtifacts", "fixedDecisions", "allowedChanges", "forbiddenChanges", "expectedDeltas", "evidenceBoundaries", "explicitNonGoals"]) }));
    }
    const currentBrief = active.value.brief;
    if (input.expectedVersion !== undefined && input.expectedVersion !== currentBrief.version) return coreErr("stale_state");
    const source = sourceFor(user.value, this.#clock, true); if (!source.ok) return source;
    const changes = materializeBriefChanges({
      projectQuestion: input.projectQuestion,
      currentStage: input.currentStage,
      currentTask: input.currentTask,
      targetArtifacts: input.targetArtifacts,
      fixedDecisions: input.fixedDecisions.map((item) => ({ ...item, id: item.id ?? this.#idFactory.create("rbrf_") })),
      allowedChanges: input.allowedChanges,
      forbiddenChanges: input.forbiddenChanges,
      expectedDeltas: input.expectedDeltas.map((item) => ({ ...item, id: item.id ?? this.#idFactory.create("rbrf_") })),
      evidenceBoundaries: input.evidenceBoundaries.map((item) => ({ ...item, id: item.id ?? this.#idFactory.create("rbrf_") })),
      explicitNonGoals: input.explicitNonGoals,
    }, this.#idFactory);
    const proposed = fromDomain(createBriefChangeProposal(currentBrief, { changes, reason: "User imported an edited Research Brief", source: source.value }, this.ports)); if (!proposed.ok) return proposed;
    const confirmed = fromDomain(confirmBriefChangeProposal(proposed.value.brief, proposed.value.proposal.id, user.value, proposed.value.brief.version, this.ports)); if (!confirmed.ok) return confirmed;
    return this.#unitOfWork.commit(() => {
      const storedProposal = fromDomain(this.#store.briefs.compareAndSwap(proposed.value.brief, currentBrief.version)); if (!storedProposal.ok) return storedProposal;
      const storedBrief = fromDomain(this.#store.briefs.compareAndSwap(confirmed.value, proposed.value.brief.version)); if (!storedBrief.ok) return storedBrief;
      const version = getActiveResearchBriefVersion(storedBrief.value); if (version === undefined) return coreErr("infrastructure_failure");
      return coreOk(Object.freeze({ brief: storedBrief.value, version, changedFields: proposed.value.proposal.diffFields }));
    });
  }

  proposeBriefChange(input: ProposeBriefChangeCommand): CoreResult<{ readonly brief: ResearchBrief; readonly proposal: BriefChangeProposal }> {
    const active = this.findActiveBrief(input.projectId); if (!active.ok) return active;
    if (active.value === undefined) return coreErr("state_conflict");
    if (input.expectedVersion !== undefined && input.expectedVersion !== active.value.brief.version) return coreErr("stale_state");
    const source = sourceFor(input.actor, this.#clock); if (!source.ok) return source;
    const proposed = fromDomain(createBriefChangeProposal(active.value.brief, { changes: materializeBriefChanges(input.changes, this.#idFactory), reason: input.reason, source: source.value }, this.ports));
    if (!proposed.ok) return proposed;
    const stored = fromDomain(this.#store.briefs.compareAndSwap(proposed.value.brief, active.value.brief.version));
    return stored.ok ? coreOk(Object.freeze({ brief: stored.value, proposal: proposed.value.proposal })) : stored;
  }

  acceptBriefChange(input: AcceptBriefChangeCommand): CoreResult<CoreBriefMutation> {
    const user = requireUser(input.actor); if (!user.ok) return user;
    const located = this.findBriefProposal(input.projectId, input.proposalId); if (!located.ok) return located;
    if (input.expectedVersion !== undefined && input.expectedVersion !== located.value.brief.version) return coreErr("stale_state");
    const confirmed = fromDomain(confirmBriefChangeProposal(located.value.brief, input.proposalId, user.value, located.value.brief.version, this.ports)); if (!confirmed.ok) return confirmed;
    const stored = fromDomain(this.#store.briefs.compareAndSwap(confirmed.value, located.value.brief.version)); if (!stored.ok) return stored;
    const version = getActiveResearchBriefVersion(stored.value); if (version === undefined) return coreErr("infrastructure_failure");
    return coreOk(Object.freeze({ brief: stored.value, version, changedFields: located.value.proposal.diffFields }));
  }

  acceptBriefChangeWithProjection(
    input: AcceptBriefChangeCommand & { readonly reason: string },
    publish: BriefProjectionPublisher,
  ): CoreResult<CoreBriefMutation> {
    const user = requireUser(input.actor); if (!user.ok) return user;
    if (typeof input.reason !== "string" || input.reason.trim().length === 0 || input.reason.trim().length > 4_096 || typeof publish !== "function") return coreErr("invalid_input");
    const located = this.findBriefProposal(input.projectId, input.proposalId); if (!located.ok) return located;
    if (input.expectedVersion === undefined || input.expectedVersion !== located.value.brief.version) return coreErr("stale_state");
    const confirmed = fromDomain(confirmBriefChangeProposal(located.value.brief, input.proposalId, user.value, located.value.brief.version, this.ports)); if (!confirmed.ok) return confirmed;
    let publication: BriefProjectionPublication | undefined;
    const committed = this.#unitOfWork.commit(() => {
      const stored = fromDomain(this.#store.briefs.compareAndSwap(confirmed.value, located.value.brief.version)); if (!stored.ok) return stored;
      const version = getActiveResearchBriefVersion(stored.value); if (version === undefined) return coreErr("infrastructure_failure");
      const yaml = fromDomain(exportResearchBriefYaml(version)); if (!yaml.ok) return yaml;
      const projected = publish(yaml.value); if (!projected.ok) return projected;
      publication = projected.value;
      return coreOk(Object.freeze({ brief: stored.value, version, changedFields: located.value.proposal.diffFields }));
    });
    if (!committed.ok) {
      try { publication?.rollback(); } catch { return coreErr("projection_write_failure"); }
      return committed;
    }
    try { publication?.finalize(); } catch { /* The database and active projection already agree; stale backup cleanup is recoverable. */ }
    return committed;
  }

  createArtifact(input: CreateArtifactCommand): CoreResult<ResearchArtifact> {
    const project = found(this.getProject(input.projectId)); if (!project.ok) return project;
    const path = parseProjectRelativePath(input.relativePath); if (!path.ok) return coreErr("invalid_input");
    const source = sourceFor(input.actor, this.#clock); if (!source.ok) return source;
    const artifact = fromDomain(createResearchArtifact({ projectId: input.projectId, kind: input.kind, title: path.value, source: source.value }, this.ports));
    return artifact.ok ? fromDomain(this.#store.artifacts.create(artifact.value)) : artifact;
  }

  createArtifactWithInitialRevision(input: CreateArtifactWithRevisionCommand): CoreResult<{ readonly artifact: ResearchArtifact; readonly revision: ArtifactRevision }> {
    const project = found(this.getProject(input.projectId)); if (!project.ok) return project;
    const path = parseProjectRelativePath(input.relativePath); if (!path.ok) return coreErr("invalid_input");
    const source = sourceFor(input.actor, this.#clock); if (!source.ok) return source;
    const artifact = fromDomain(createResearchArtifact({ projectId: input.projectId, kind: input.kind, title: path.value, source: source.value }, this.ports)); if (!artifact.ok) return artifact;
    const revision = fromDomain(createArtifactRevision({ projectId: input.projectId, artifactId: artifact.value.id, content: input.content, mediaType: input.mediaType, source: source.value }, this.ports)); if (!revision.ok) return revision;
    const updated = fromDomain(addArtifactRevision(artifact.value, revision.value, artifact.value.version)); if (!updated.ok) return updated;
    return this.#unitOfWork.commit(() => {
      const storedArtifact = fromDomain(this.#store.artifacts.create(artifact.value)); if (!storedArtifact.ok) return storedArtifact;
      const storedRevision = fromDomain(this.#store.revisions.append(revision.value)); if (!storedRevision.ok) return storedRevision;
      return coreOk(Object.freeze({ artifact: updated.value, revision: storedRevision.value }));
    });
  }

  createRevision(input: CreateRevisionCommand): CoreResult<ArtifactRevision> {
    const artifact = found(fromDomain(this.#store.artifacts.getById(input.projectId, input.artifactId))); if (!artifact.ok) return artifact;
    const source = sourceFor(input.actor, this.#clock); if (!source.ok) return source;
    const revision = fromDomain(createArtifactRevision({ projectId: input.projectId, artifactId: input.artifactId, ...(input.parentRevisionId ? { parentRevisionId: input.parentRevisionId } : {}), content: input.content, mediaType: input.mediaType, source: source.value }, this.ports));
    if (!revision.ok) return revision;
    const updated = fromDomain(addArtifactRevision(artifact.value, revision.value, artifact.value.version, { allowFork: input.allowFork }));
    if (!updated.ok) return updated;
    return this.#unitOfWork.commit(() => fromDomain(this.#store.revisions.append(revision.value)));
  }

  recordDecision(input: RecordDecisionCommand): CoreResult<ResearchDecision> {
    const brief = this.findBriefVersion(input.projectId, input.effectiveBriefVersionId); if (!brief.ok) return brief;
    const source = sourceFor(input.actor, this.#clock); if (!source.ok) return source;
    const created = fromDomain(createResearchDecision({ projectId: input.projectId, statement: input.statement, scope: input.scope, rationale: input.rationale, effectiveBriefVersionId: input.effectiveBriefVersionId, reopenConditions: input.reopenConditions, source: source.value }, this.ports));
    if (!created.ok) return created;
    return this.#unitOfWork.commit(() => {
      const persisted = fromDomain(this.#store.decisions.create(created.value)); if (!persisted.ok) return persisted;
      if ((input.status ?? "proposed") === "proposed") return persisted;
      const accepted = fromDomain(transitionResearchDecision(persisted.value, "accepted", input.actor, persisted.value.version, "User accepted decision", this.#clock));
      if (!accepted.ok) return accepted;
      const acceptedStored = fromDomain(this.#store.decisions.appendTransition(accepted.value, persisted.value.version)); if (!acceptedStored.ok) return acceptedStored;
      if (input.status !== "frozen") return acceptedStored;
      const frozen = fromDomain(transitionResearchDecision(acceptedStored.value, "frozen", input.actor, acceptedStored.value.version, "User froze decision", this.#clock));
      return frozen.ok ? fromDomain(this.#store.decisions.appendTransition(frozen.value, acceptedStored.value.version)) : frozen;
    });
  }

  transitionDecision(input: TransitionDecisionCommand): CoreResult<ResearchDecision> {
    const user = requireUser(input.actor); if (!user.ok) return user;
    const current = found(fromDomain(this.#store.decisions.getById(input.projectId, input.decisionId))); if (!current.ok) return current;
    if (input.expectedVersion !== undefined && input.expectedVersion !== current.value.version) return coreErr("stale_state");
    const transitioned = fromDomain(transitionResearchDecision(current.value, input.target, user.value, current.value.version, input.reason, this.#clock));
    return transitioned.ok ? fromDomain(this.#store.decisions.appendTransition(transitioned.value, current.value.version)) : transitioned;
  }

  supersedeDecision(input: SupersedeDecisionCommand): CoreResult<{ readonly superseded: ResearchDecision; readonly replacement: ResearchDecision }> {
    const user = requireUser(input.actor); if (!user.ok) return user;
    const current = found(fromDomain(this.#store.decisions.getById(input.projectId, input.decisionId))); if (!current.ok) return current;
    if (input.expectedVersion !== undefined && input.expectedVersion !== current.value.version) return coreErr("stale_state");
    const brief = this.findBriefVersion(input.projectId, input.effectiveBriefVersionId); if (!brief.ok) return brief;
    const source = sourceFor(user.value, this.#clock); if (!source.ok) return source;
    const replacement = fromDomain(createResearchDecision({ projectId: input.projectId, statement: input.statement, scope: input.scope, rationale: input.rationale, effectiveBriefVersionId: input.effectiveBriefVersionId, reopenConditions: input.reopenConditions, source: source.value }, this.ports)); if (!replacement.ok) return replacement;
    const superseded = fromDomain(supersedeResearchDecision(current.value, replacement.value, user.value, current.value.version, replacement.value.version, input.reason, this.#clock)); if (!superseded.ok) return superseded;
    return this.#unitOfWork.commit(() => {
      const storedReplacement = fromDomain(this.#store.decisions.create(replacement.value)); if (!storedReplacement.ok) return storedReplacement;
      const storedCurrent = fromDomain(this.#store.decisions.appendTransition(superseded.value.superseded, current.value.version)); if (!storedCurrent.ok) return storedCurrent;
      const storedAccepted = fromDomain(this.#store.decisions.appendTransition(superseded.value.replacement, replacement.value.version)); if (!storedAccepted.ok) return storedAccepted;
      return coreOk(Object.freeze({ superseded: storedCurrent.value, replacement: storedAccepted.value }));
    });
  }

  openIssue(input: OpenIssueCommand): CoreResult<ResearchIssue> {
    const revision = found(fromDomain(this.#store.revisions.getById(input.projectId, input.sourceArtifactId, input.sourceRevisionId))); if (!revision.ok) return revision;
    if (revision.value.content.contentHash !== input.sourceRevisionContentHash) return coreErr("stale_state");
    const source = sourceFor(input.actor, this.#clock); if (!source.ok) return source;
    const issue = fromDomain(createResearchIssue({ ...input, source: source.value }, this.ports));
    return issue.ok ? fromDomain(this.#store.issues.create(issue.value)) : issue;
  }

  resolveIssue(input: ResolveIssueCommand): CoreResult<ResearchIssue> {
    const user = requireUser(input.actor); if (!user.ok) return user;
    const current = found(fromDomain(this.#store.issues.getById(input.projectId, input.issueId))); if (!current.ok) return current;
    if (input.expectedVersion !== undefined && input.expectedVersion !== current.value.version) return coreErr("stale_state");
    const active = this.findActiveBrief(input.projectId); if (!active.ok) return active;
    const decisions = this.listDecisions(input.projectId); if (!decisions.ok) return decisions;
    const resolved = fromDomain(resolveResearchIssue(current.value, user.value, current.value.version, input.reason, {
      resolutionEvidenceId: input.resolutionEvidenceId,
      ...(active.value ? { briefVersionId: active.value.version.id } : {}),
      frozenDecisionIds: decisions.value.filter((item) => item.status === "frozen").map((item) => item.id),
    }, this.#clock));
    return resolved.ok ? fromDomain(this.#store.issues.appendTransition(resolved.value, current.value.version)) : resolved;
  }

  resolveIssueWithCanonicalEvidence(input: ResolveIssueCommand): CoreResult<ResearchIssue> {
    const evidence = found(fromDomain(this.#store.argumentEvidence.getById(input.projectId, input.resolutionEvidenceId))); if (!evidence.ok) return evidence;
    if (evidence.value.state !== "current") return coreErr("state_conflict");
    return this.resolveIssue(input);
  }

  waiveIssue(input: WaiveIssueCommand): CoreResult<ResearchIssue> {
    const user = requireUser(input.actor); if (!user.ok) return user;
    if (input.scope.kind !== "issue" || input.scope.issueId !== input.issueId) return coreErr("invalid_input");
    const current = found(fromDomain(this.#store.issues.getById(input.projectId, input.issueId))); if (!current.ok) return current;
    if (input.expectedVersion !== undefined && input.expectedVersion !== current.value.version) return coreErr("stale_state");
    const reason = input.invalidationCondition === undefined ? input.reason : `${input.reason} Invalidation condition: ${input.invalidationCondition}`;
    const waived = fromDomain(waiveResearchIssue(current.value, user.value, current.value.version, reason, this.#clock));
    return waived.ok ? fromDomain(this.#store.issues.appendTransition(waived.value, current.value.version)) : waived;
  }

  disputeIssue(input: DisputeIssueCommand): CoreResult<ResearchIssue> {
    const user = requireUser(input.actor); if (!user.ok) return user;
    const current = found(fromDomain(this.#store.issues.getById(input.projectId, input.issueId))); if (!current.ok) return current;
    if (input.expectedVersion !== undefined && input.expectedVersion !== current.value.version) return coreErr("stale_state");
    const disputed = fromDomain(disputeResearchIssue(current.value, user.value, current.value.version, input.reason, this.#clock));
    return disputed.ok ? fromDomain(this.#store.issues.appendTransition(disputed.value, current.value.version)) : disputed;
  }

  reopenIssue(input: ReopenIssueCommand): CoreResult<ResearchIssue> {
    const user = requireUser(input.actor); if (!user.ok) return user;
    const current = found(fromDomain(this.#store.issues.getById(input.projectId, input.issueId))); if (!current.ok) return current;
    if (input.expectedVersion !== undefined && input.expectedVersion !== current.value.version) return coreErr("stale_state");
    const reopened = fromDomain(reopenResearchIssue(current.value, user.value, current.value.version, input.reason, { ...input.context, userRequested: true }, this.#clock));
    return reopened.ok ? fromDomain(this.#store.issues.appendTransition(reopened.value, current.value.version)) : reopened;
  }

  startRevisionEpisode(input: StartRevisionEpisodeCommand): CoreResult<RevisionEpisode> {
    const artifact = found(fromDomain(this.#store.artifacts.getById(input.projectId, input.artifactId))); if (!artifact.ok) return artifact;
    const baseline = found(fromDomain(this.#store.revisions.getById(input.projectId, input.artifactId, input.baselineRevisionId))); if (!baseline.ok) return baseline;
    const brief = this.findBriefVersion(input.projectId, input.briefVersionId); if (!brief.ok) return brief;
    const decisions = fromDomain(this.#store.decisions.listByScope(input.projectId, undefined, PAGE)); if (!decisions.ok) return decisions;
    const issues = fromDomain(this.#store.issues.listByStatus(input.projectId, undefined, PAGE)); if (!issues.ok) return issues;
    if (decisions.value.nextCursor !== undefined || issues.value.nextCursor !== undefined) return coreErr("state_conflict");
    const activeDecisions = decisions.value.items.filter((item): item is ResearchDecision & { readonly status: "accepted" | "frozen" } => item.status === "accepted" || item.status === "frozen");
    const projectFingerprint = hash({ projectId: input.projectId, artifactId: input.artifactId, artifactVersion: artifact.value.version, briefVersionId: brief.value.version.id, decisions: activeDecisions.map((item) => [item.id, item.version, item.status]), issues: issues.value.items.map((item) => [item.id, item.version, item.status]) }); if (!projectFingerprint.ok) return projectFingerprint;
    const repositoryFingerprint = hash({ baselineRevisionId: baseline.value.id, baselineContentHash: baseline.value.content.contentHash, activeRevisionId: artifact.value.activeRevisionId }); if (!repositoryFingerprint.ok) return repositoryFingerprint;
    const source = sourceFor(input.actor, this.#clock); if (!source.ok) return source;
    const created = fromDomain(createRevisionEpisode({
      projectId: input.projectId,
      artifactId: input.artifactId,
      source: source.value,
      lockedStart: {
        briefVersionId: brief.value.version.id,
        baselineRevisionId: baseline.value.id,
        activeDecisions: activeDecisions.map((item) => ({ decisionId: item.id, status: item.status, version: item.version })),
        relevantIssues: issues.value.items.map((item) => ({ issueId: item.id, status: item.status, version: item.version })),
        evidenceBoundaryIds: brief.value.version.evidenceBoundaries.map((item) => item.id),
        checkerVersion: CHECKERS.map((item) => `${item.id}@${item.version}`).join(","),
        projectStateFingerprint: projectFingerprint.value,
        repositoryStateFingerprint: repositoryFingerprint.value,
      },
    }, this.ports));
    if (!created.ok) return created;
    const activated = fromDomain(activateRevisionEpisode(created.value, SYSTEM_ACTOR, created.value.version, this.#clock)); if (!activated.ok) return activated;
    return this.#unitOfWork.commit(() => {
      const stored = fromDomain(this.#store.episodes.create(created.value)); if (!stored.ok) return stored;
      return fromDomain(this.#store.episodes.compareAndSwap(activated.value, created.value.version));
    });
  }

  submitCandidateRevision(input: SubmitCandidateRevisionCommand): CoreResult<RevisionEpisode> {
    const episode = found(this.getEpisode(input.projectId, input.episodeId)); if (!episode.ok) return episode;
    const candidate = found(fromDomain(this.#store.revisions.getById(input.projectId, episode.value.artifactId, input.candidateRevisionId))); if (!candidate.ok) return candidate;
    const submitted = fromDomain(submitEpisodeCandidate(episode.value, candidate.value.id, input.actor, episode.value.version, this.#clock));
    return submitted.ok ? fromDomain(this.#store.episodes.compareAndSwap(submitted.value, episode.value.version)) : submitted;
  }

  async runDeterministicReview(input: RunDeterministicReviewCommand): Promise<CoreResult<DeterministicReviewResult>> {
    const episode = found(this.getEpisode(input.projectId, input.episodeId)); if (!episode.ok) return episode;
    if (episode.value.status !== "candidate_submitted" || episode.value.candidateRevisionId === undefined) return coreErr("state_conflict");
    const project = found(this.getProject(input.projectId)); if (!project.ok) return project;
    const artifact = found(fromDomain(this.#store.artifacts.getById(input.projectId, episode.value.artifactId))); if (!artifact.ok) return artifact;
    const baseline = found(fromDomain(this.#store.revisions.getById(input.projectId, episode.value.artifactId, episode.value.lockedStart.baselineRevisionId))); if (!baseline.ok) return baseline;
    const candidate = found(fromDomain(this.#store.revisions.getById(input.projectId, episode.value.artifactId, episode.value.candidateRevisionId))); if (!candidate.ok) return candidate;
    const brief = this.findBriefVersion(input.projectId, episode.value.lockedStart.briefVersionId); if (!brief.ok) return brief;
    const defaultEnvironment = hash({ runtime: "local", checkerSet: CHECKERS }); if (!defaultEnvironment.ok) return defaultEnvironment;
    const buildFingerprint = input.buildFingerprint ?? RELEASE_IDENTITY.releaseBuildId;
    const environmentFingerprint = input.environmentFingerprint ?? defaultEnvironment.value;
    if (!/^[0-9a-f]{64}$/.test(buildFingerprint) || !/^[0-9a-f]{64}$/.test(environmentFingerprint)) return coreErr("invalid_input");
    const snapshot = fromDomain(createReviewInputSnapshot(episode.value, { buildVersion: buildFingerprint, limitations: ["Review-input anchor only; content integrity does not prove research correctness."] }, this.ports)); if (!snapshot.ok) return snapshot;
    const contextInput = {
      project: { id: project.value.id, version: project.value.version },
      episode: { id: episode.value.id, version: episode.value.version, artifactId: episode.value.artifactId, baselineRevisionId: baseline.value.id, candidateRevisionId: candidate.value.id },
      baselineRevision: { id: baseline.value.id, artifactId: baseline.value.artifactId, projectId: baseline.value.projectId, ...(baseline.value.parentRevisionId ? { parentRevisionId: baseline.value.parentRevisionId } : {}), contentHash: baseline.value.content.contentHash },
      candidateRevision: { id: candidate.value.id, artifactId: candidate.value.artifactId, projectId: candidate.value.projectId, ...(candidate.value.parentRevisionId ? { parentRevisionId: candidate.value.parentRevisionId } : {}), contentHash: candidate.value.content.contentHash },
      briefVersion: { id: brief.value.version.id, versionNumber: brief.value.version.versionNumber },
      activeDecisions: episode.value.lockedStart.activeDecisions.map((item) => ({ id: item.decisionId, version: item.version, status: item.status })),
      relevantIssues: episode.value.lockedStart.relevantIssues.map((item) => ({ id: item.issueId, version: item.version, status: item.status })),
      evidenceBoundaries: brief.value.version.evidenceBoundaries.filter((item) => episode.value.lockedStart.evidenceBoundaryIds.includes(item.id)).map((item) => ({ id: item.id, statement: item.statement })),
      snapshot: { id: snapshot.value.id, projectId: snapshot.value.projectId, episodeId: snapshot.value.episodeId, hash: snapshot.value.hash },
      checkerSet: CHECKERS,
      environmentFingerprint,
      buildFingerprint,
    };
    const context = parseReviewContext({ ...contextInput, inputHash: calculateReviewInputHash(contextInput) }); if (!context.ok) return { ok: false, error: mapDomainError(context.error) };
    const freshness = new FreshnessChecker({ currentBriefVersionId: brief.value.version.id, artifactActiveRevisionId: artifact.value.activeRevisionId, boundReportInputHash: context.value.inputHash, availableCheckerVersions: CHECKERS, environmentFingerprint, buildFingerprint });
    const scope = new ScopeChecker({
      baselineDocuments: [{ artifactId: artifact.value.id, relativePath: artifact.value.title, markdown: baseline.value.inlineContent ?? "" }],
      candidateDocuments: [{ artifactId: artifact.value.id, relativePath: artifact.value.title, markdown: candidate.value.inlineContent ?? "" }],
      allowedChanges: brief.value.version.allowedChanges,
      forbiddenChanges: brief.value.version.forbiddenChanges,
    });
    const rawRun = await runReview(context.value, new CheckerRegistry([freshness, scope]), { ...this.ports, mode: "sequential" });
    if (!rawRun.ok) return { ok: false, error: mapDomainError(rawRun.error) };
    const issues = this.listIssues(input.projectId); if (!issues.ok) return issues;
    const decisions = this.listDecisions(input.projectId); if (!decisions.ok) return decisions;
    const recordedAt = now(this.#clock); if (recordedAt === undefined) return coreErr("infrastructure_failure");
    const integrated = await new IssueIntegrityChecker({
      findings: rawRun.value.findings,
      issueLookup: { ok: true, issues: issues.value },
      recordedAt,
      reopenContext: {
        currentRevisionContentHash: candidate.value.content.contentHash,
        currentBriefVersionId: brief.value.version.id,
        currentFrozenDecisionIds: decisions.value.filter((item) => item.status === "frozen").map((item) => item.id),
      },
    }).run(context.value);
    const run = parseReviewRun({ ...rawRun.value, findings: integrated.findings });
    if (!run.ok) return { ok: false, error: mapDomainError(run.error) };
    const products = reviewProducts(run.value, episode.value);
    const generatedIssues: ResearchIssue[] = [];
    for (const finding of run.value.findings) {
      if (finding.kind !== "scope_violation" || finding.presentation !== "foreground") continue;
      const candidateIssue = findingToIssueCandidate(finding, context.value, recordedAt); if (!candidateIssue.ok) return { ok: false, error: mapDomainError(candidateIssue.error) };
      const issue = fromDomain(createResearchIssue(candidateIssue.value.input, this.ports));
      if (!issue.ok) return issue;
      generatedIssues.push(issue.value);
    }
    const reviewed = fromDomain(recordEpisodeReview(episode.value, run.value.id, run.value.findings.map((item) => item.id), SYSTEM_ACTOR, episode.value.version, this.#clock)); if (!reviewed.ok) return reviewed;
    const required = fromDomain(requireEpisodeUserAction(reviewed.value, episodeOutcomeFromCoverage(products.coverage), SYSTEM_ACTOR, reviewed.value.version, this.#clock)); if (!required.ok) return required;
    const persisted = this.#unitOfWork.commit(() => {
      const storedSnapshot = fromDomain(this.#store.snapshots.create(snapshot.value)); if (!storedSnapshot.ok) return storedSnapshot;
      const storedRun = this.#reviews.create(run.value); if (!storedRun.ok) return { ok: false, error: mapDomainError(storedRun.error) };
      for (const issue of generatedIssues) { const storedIssue = fromDomain(this.#store.issues.create(issue)); if (!storedIssue.ok) return storedIssue; }
      const storedReviewed = fromDomain(this.#store.episodes.compareAndSwap(reviewed.value, episode.value.version)); if (!storedReviewed.ok) return storedReviewed;
      const storedRequired = fromDomain(this.#store.episodes.compareAndSwap(required.value, reviewed.value.version)); if (!storedRequired.ok) return storedRequired;
      return coreOk(Object.freeze({ run: storedRun.value, episode: storedRequired.value, snapshot: storedSnapshot.value, ...products, findingProjection: projectFindings(storedRun.value.findings) }));
    });
    return persisted;
  }

  recordUserDisposition(input: RecordUserDispositionCommand): CoreResult<RevisionEpisode> {
    const user = requireUser(input.actor); if (!user.ok) return user;
    const episode = found(this.getEpisode(input.projectId, input.episodeId)); if (!episode.ok) return episode;
    const brief = this.findBriefVersion(input.projectId, episode.value.lockedStart.briefVersionId); if (!brief.ok) return brief;
    const disposed = fromDomain(disposeRevisionEpisode(episode.value, input.disposition, user.value, episode.value.version, brief.value.version.id, input.reason, this.#clock));
    return disposed.ok ? fromDomain(this.#store.episodes.compareAndSwap(disposed.value, episode.value.version)) : disposed;
  }

  applyEpisodeWaiver(input: ApplyEpisodeWaiverCommand): CoreResult<RevisionEpisode> {
    const user = requireUser(input.actor); if (!user.ok) return user;
    const episode = found(this.getEpisode(input.projectId, input.episodeId)); if (!episode.ok) return episode;
    const reason = input.invalidationCondition === undefined ? input.reason : `${input.reason} Invalidation condition: ${input.invalidationCondition}`;
    const waived = fromDomain(applyEpisodeWaiver(episode.value, { dimension: input.dimension, scope: input.scope, reason }, user.value, episode.value.version, this.#clock));
    return waived.ok ? fromDomain(this.#store.episodes.compareAndSwap(waived.value, episode.value.version)) : waived;
  }

  getEpisodeIntegritySummary(projectId: string, episodeId: string): CoreResult<EpisodeIntegritySummary> {
    const bundle = this.loadReviewBundle(projectId, episodeId); if (!bundle.ok) return bundle;
    const issues = this.listIssues(projectId); if (!issues.ok) return issues;
    const unresolved = issues.value.filter((item) => ["open", "acknowledged", "reopened"].includes(item.status)).map((item) => item.id).sort();
    const disputed = issues.value.filter((item) => item.status === "disputed").map((item) => item.id).sort();
    const currentById = new Map(issues.value.map((item) => [item.id, item]));
    const stale = bundle.value.episode.lockedStart.relevantIssues.filter((locked) => {
      const current = currentById.get(locked.issueId);
      return current?.version !== locked.version || current.status !== locked.status;
    }).map((item) => item.issueId).sort();
    const products = reviewProducts(bundle.value.run, bundle.value.episode);
    const unproven = products.coverage.filter((item) => item.status === "unproven").map((item) => item.obligationId).sort();
    const checkerFailed = [...new Set([...products.coverage.filter((item) => item.status === "checker_failed").map((item) => item.obligationId), ...bundle.value.run.checkerErrors.map((item) => item.checker.id)])].sort();
    return coreOk(Object.freeze({ unresolved: Object.freeze(unresolved), stale: Object.freeze(stale), disputed: Object.freeze(disputed), unproven: Object.freeze(unproven), checkerFailed: Object.freeze(checkerFailed) }));
  }

  createResearchSnapshot(input: CreateResearchSnapshotCommand): CoreResult<ResearchSnapshot> {
    const episode = found(this.getEpisode(input.projectId, input.episodeId)); if (!episode.ok) return episode;
    const snapshot = fromDomain(createFinalResearchSnapshot(episode.value, { buildVersion: input.buildVersion, limitations: input.limitations }, this.ports));
    return snapshot.ok ? fromDomain(this.#store.snapshots.create(snapshot.value)) : snapshot;
  }

  verifyResearchSnapshot(projectId: string, snapshotId: string): CoreResult<boolean> {
    const snapshot = found(this.getSnapshot(projectId, snapshotId)); if (!snapshot.ok) return snapshot;
    return fromDomain(verifyResearchSnapshotHash(snapshot.value));
  }

  renderReviewReport(input: RenderReviewReportCommand): CoreResult<string> {
    if (input.format !== "markdown" && input.format !== "json") return coreErr("unsupported_format");
    const bundle = this.loadReviewBundle(input.projectId, input.episodeId); if (!bundle.ok) return bundle;
    const products = reviewProducts(bundle.value.run, bundle.value.episode);
    try {
      const reportInput = {
        title: `Review of ${bundle.value.artifact.title}`,
        taskSummary: bundle.value.brief.version.currentTask,
        run: bundle.value.run,
        ...products,
        preservedContent: [],
        userActions: [
          "Semantic review status: semantic_pending. Fulfillment, evidence quality, target substitution, argument depth, and Argument Delta remain unproven.",
          ...(bundle.value.episode.status === "user_action_required" ? ["Accept, reject, or abandon this reviewed candidate explicitly."] : [`Episode disposition: ${bundle.value.episode.status}.`]),
        ],
        findingProjection: projectFindings(bundle.value.run.findings),
      };
      return coreOk(input.format === "markdown" ? renderReviewMarkdown(reportInput, { allFindings: input.allFindings }) : renderReviewJson(reportInput));
    } catch {
      return coreErr("review_blocked");
    }
  }

  renderReviewReportForRun(projectId: string, reviewRunId: string, format: "markdown" | "json", allFindings = false): CoreResult<string> {
    const episode = this.findEpisodeByReviewRun(projectId, reviewRunId); if (!episode.ok) return episode;
    return this.renderReviewReport({ projectId, episodeId: episode.value.id, format, allFindings });
  }

  exportCapsule(input: ExportCapsuleCommand): CoreResult<{ readonly capsule: ReviewCapsule; readonly json: string }> {
    const bundle = this.loadReviewBundle(input.projectId, input.episodeId); if (!bundle.ok) return bundle;
    const snapshot = found(this.getSnapshot(input.projectId, bundle.value.run.snapshotId)); if (!snapshot.ok) return snapshot;
    const activeBrief = this.findActiveBrief(input.projectId); if (!activeBrief.ok) return activeBrief;
    const currentDecisions = this.listDecisions(input.projectId); if (!currentDecisions.ok) return currentDecisions;
    const currentIssues = this.listIssues(input.projectId); if (!currentIssues.ok) return currentIssues;
    const currentEpisodes = this.listEpisodes(input.projectId); if (!currentEpisodes.ok) return currentEpisodes;
    const stateBinding = hash({
      projectId: input.projectId,
      activeBrief: activeBrief.value === undefined ? null : { id: activeBrief.value.brief.id, entityVersion: activeBrief.value.brief.version, versionId: activeBrief.value.version.id },
      artifact: { id: bundle.value.artifact.id, version: bundle.value.artifact.version, activeRevisionId: bundle.value.artifact.activeRevisionId ?? null },
      review: {
        episodeId: bundle.value.episode.id,
        episodeVersion: bundle.value.episode.version,
        episodeStatus: bundle.value.episode.status,
        lockedBriefVersionId: bundle.value.episode.lockedStart.briefVersionId,
        baselineRevisionId: bundle.value.baseline.id,
        baselineContentHash: bundle.value.baseline.content.contentHash,
        candidateRevisionId: bundle.value.candidate.id,
        candidateContentHash: bundle.value.candidate.content.contentHash,
        reviewRunId: bundle.value.run.id,
        reviewRunVersion: bundle.value.run.version,
        reviewInputHash: bundle.value.run.inputHash,
        snapshotId: snapshot.value.id,
        snapshotHash: snapshot.value.hash,
      },
      decisions: [...currentDecisions.value].sort((left, right) => left.id.localeCompare(right.id)).map((decision) => ({ id: decision.id, version: decision.version, status: decision.status })),
      issues: [...currentIssues.value].sort((left, right) => left.id.localeCompare(right.id)).map((issue) => ({ id: issue.id, version: issue.version, status: issue.status })),
      episodes: [...currentEpisodes.value].sort((left, right) => left.id.localeCompare(right.id)).map((episode) => ({ id: episode.id, version: episode.version, status: episode.status, baselineRevisionId: episode.lockedStart.baselineRevisionId, candidateRevisionId: episode.candidateRevisionId ?? null, reviewRunIds: episode.reviewRunIds })),
      checkerSet: bundle.value.run.context.checkerSet,
      environmentFingerprint: bundle.value.run.context.environmentFingerprint,
      buildFingerprint: bundle.value.run.context.buildFingerprint,
    });
    if (!stateBinding.ok) return stateBinding;
    const decisions: { id: string; statement: string; status: string }[] = [];
    for (const locked of bundle.value.episode.lockedStart.activeDecisions) {
      const decision = found(fromDomain(this.#store.decisions.getById(input.projectId, locked.decisionId))); if (!decision.ok) return decision;
      decisions.push({ id: decision.value.id, statement: decision.value.statement, status: locked.status });
    }
    const issues: { id: string; summary: string; status: string }[] = [];
    for (const locked of bundle.value.episode.lockedStart.relevantIssues) {
      const issue = found(fromDomain(this.#store.issues.getById(input.projectId, locked.issueId))); if (!issue.ok) return issue;
      issues.push({ id: issue.value.id, summary: issue.value.summary, status: locked.status });
    }
    const permission = input.includePermittedFullText === true ? "full_text" as const : "summary_only" as const;
    const exported = exportReviewCapsule({
      projectId: input.projectId,
      brief: { id: bundle.value.brief.version.id, summary: bundle.value.brief.version.currentTask, expectedDeltas: bundle.value.brief.version.expectedDeltas.map((item) => item.statement) },
      activeDecisions: decisions,
      relevantIssues: issues,
      baseline: { artifactId: bundle.value.artifact.id, revisionId: bundle.value.baseline.id, relativePath: bundle.value.artifact.title, summary: `${bundle.value.baseline.content.byteLength} bytes; sha256 ${bundle.value.baseline.content.contentHash}`, ...(permission === "full_text" ? { content: bundle.value.baseline.inlineContent } : {}), privacy: "private_a", contentPermission: permission },
      candidate: { artifactId: bundle.value.artifact.id, revisionId: bundle.value.candidate.id, relativePath: bundle.value.artifact.title, summary: `${bundle.value.candidate.content.byteLength} bytes; sha256 ${bundle.value.candidate.content.contentHash}`, ...(permission === "full_text" ? { content: bundle.value.candidate.inlineContent } : {}), privacy: "private_a", contentPermission: permission },
      evidenceBoundaries: bundle.value.brief.version.evidenceBoundaries.map((item) => item.statement),
      expectedDeltas: bundle.value.brief.version.expectedDeltas.map((item) => item.statement),
      snapshotId: snapshot.value.id,
      snapshotHash: snapshot.value.hash,
      reviewInputHash: bundle.value.run.inputHash,
      invalidationConditions: ["Brief, artifact revision, decision, issue, checker set, environment, or build binding changes."],
      buildFingerprint: bundle.value.run.context.buildFingerprint,
      checkerVersions: bundle.value.run.context.checkerSet,
      stateBindingHash: stateBinding.value,
      findingProjection: projectFindings(bundle.value.run.findings),
    }, { includePermittedFullText: input.includePermittedFullText });
    return exported.ok ? coreOk(exported.value) : { ok: false, error: mapDomainError(exported.error) };
  }

  importCapsuleResponse(projectId: string, json: string): CoreResult<CapsuleCandidateResponse> {
    let raw: Record<string, unknown>;
    try { const parsed = JSON.parse(json) as unknown; if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return coreErr("invalid_input"); raw = parsed as Record<string, unknown>; }
    catch { return coreErr("invalid_input"); }
    if (typeof raw.reviewInputHash !== "string") return coreErr("invalid_input");
    const episodes = this.listEpisodes(projectId); if (!episodes.ok) return episodes;
    for (const episode of episodes.value) {
      const runId = episode.reviewRunIds.at(-1); if (runId === undefined) continue;
      const run = found(this.getReviewRun(projectId, runId)); if (!run.ok) return run;
      if (run.value.inputHash !== raw.reviewInputHash || episode.candidateRevisionId === undefined) continue;
      const summaryCapsule = this.exportCapsule({ projectId, episodeId: episode.id }); if (!summaryCapsule.ok) return summaryCapsule;
      let expectedCapsule = summaryCapsule.value.capsule;
      if (raw.capsuleHash !== expectedCapsule.capsuleHash) {
        const fullCapsule = this.exportCapsule({ projectId, episodeId: episode.id, includePermittedFullText: true });
        if (fullCapsule.ok && raw.capsuleHash === fullCapsule.value.capsule.capsuleHash) expectedCapsule = fullCapsule.value.capsule;
      }
      const imported = importReviewCapsuleResponse(json, {
        projectId,
        capsuleHash: expectedCapsule.capsuleHash,
        snapshotHash: expectedCapsule.snapshot.hash,
        reviewInputHash: expectedCapsule.reviewInputHash,
        briefVersionId: episode.lockedStart.briefVersionId,
        artifactRevisionId: episode.candidateRevisionId,
      });
      return imported.ok ? coreOk(imported.value) : { ok: false, error: mapDomainError(imported.error) };
    }
    return coreErr("stale_state");
  }

  getProject(projectId: string): CoreResult<ResearchProject | undefined> { return fromDomain(this.#store.projects.getById(projectId)); }
  listProjects(): CoreResult<readonly ResearchProject[]> {
    const page = fromDomain(this.#store.projects.list(PAGE));
    if (!page.ok) return page;
    return page.value.nextCursor === undefined ? coreOk(page.value.items) : coreErr("state_conflict");
  }

  getActiveBriefProjection(projectId: string): CoreResult<{ readonly briefId: string; readonly versionId: string; readonly yaml: string } | undefined> {
    const page = fromDomain(this.#store.briefs.listByProject(projectId, PAGE));
    if (!page.ok) return page;
    if (page.value.nextCursor !== undefined) return coreErr("state_conflict");
    const versions = page.value.items.flatMap((brief) => {
      const version = getActiveResearchBriefVersion(brief);
      return version === undefined ? [] : [{ brief, version }];
    }).sort((left, right) => right.version.createdAt.localeCompare(left.version.createdAt) || right.version.id.localeCompare(left.version.id));
    const active = versions[0];
    if (active === undefined) return coreOk(undefined);
    const yaml = fromDomain(exportResearchBriefYaml(active.version));
    return yaml.ok ? coreOk(Object.freeze({ briefId: active.brief.id, versionId: active.version.id, yaml: yaml.value })) : yaml;
  }

  getArtifact(projectId: string, artifactId: string): CoreResult<ResearchArtifact | undefined> { return fromDomain(this.#store.artifacts.getById(projectId, artifactId)); }

  listArtifacts(projectId: string): CoreResult<readonly ResearchArtifact[]> {
    const page = fromDomain(this.#store.artifacts.listByProject(projectId, PAGE));
    if (!page.ok) return page;
    return page.value.nextCursor === undefined ? coreOk(page.value.items) : coreErr("state_conflict");
  }

  listRevisions(projectId: string, artifactId: string): CoreResult<readonly ArtifactRevision[]> {
    const page = fromDomain(this.#store.revisions.listByArtifact(projectId, artifactId, PAGE));
    if (!page.ok) return page;
    return page.value.nextCursor === undefined ? coreOk(page.value.items) : coreErr("state_conflict");
  }

  getRevision(projectId: string, revisionId: string): CoreResult<ArtifactRevision | undefined> {
    const artifacts = this.listArtifacts(projectId); if (!artifacts.ok) return artifacts;
    for (const artifact of artifacts.value) {
      const revision = fromDomain(this.#store.revisions.getById(projectId, artifact.id, revisionId));
      if (!revision.ok) return revision;
      if (revision.value !== undefined) return revision;
    }
    return coreOk(undefined);
  }

  diffRevisions(projectId: string, baselineRevisionId: string, candidateRevisionId: string): CoreResult<BlockDiff> {
    const baseline = found(this.getRevision(projectId, baselineRevisionId)); if (!baseline.ok) return baseline;
    const candidate = found(this.getRevision(projectId, candidateRevisionId)); if (!candidate.ok) return candidate;
    if (baseline.value.artifactId !== candidate.value.artifactId) return coreErr("state_conflict");
    const diff = diffMarkdownBlocks(baseline.value.inlineContent ?? "", candidate.value.inlineContent ?? "");
    return diff.ok ? coreOk(diff.value) : { ok: false, error: mapDomainError(diff.error) };
  }

  listEpisodes(projectId: string): CoreResult<readonly RevisionEpisode[]> {
    const page = fromDomain(this.#store.episodes.listByProject(projectId, PAGE));
    if (!page.ok) return page;
    return page.value.nextCursor === undefined ? coreOk(page.value.items) : coreErr("state_conflict");
  }

  listDecisions(projectId: string): CoreResult<readonly ResearchDecision[]> {
    const page = fromDomain(this.#store.decisions.listByScope(projectId, undefined, PAGE));
    if (!page.ok) return page;
    return page.value.nextCursor === undefined ? coreOk(page.value.items) : coreErr("state_conflict");
  }

  getDecision(projectId: string, decisionId: string): CoreResult<ResearchDecision | undefined> { return fromDomain(this.#store.decisions.getById(projectId, decisionId)); }

  listIssues(projectId: string): CoreResult<readonly ResearchIssue[]> {
    const page = fromDomain(this.#store.issues.listByStatus(projectId, undefined, PAGE));
    if (!page.ok) return page;
    return page.value.nextCursor === undefined ? coreOk(page.value.items) : coreErr("state_conflict");
  }

  getIssue(projectId: string, issueId: string): CoreResult<ResearchIssue | undefined> { return fromDomain(this.#store.issues.getById(projectId, issueId)); }

  listSnapshots(projectId: string, episodeId: string): CoreResult<readonly ResearchSnapshot[]> {
    const page = fromDomain(this.#store.snapshots.listByEpisode(projectId, episodeId, PAGE));
    if (!page.ok) return page;
    return page.value.nextCursor === undefined ? coreOk(page.value.items) : coreErr("state_conflict");
  }

  getReviewSummary(projectId: string, reviewRunId: string): CoreResult<CoreReviewSummary> {
    const episode = this.findEpisodeByReviewRun(projectId, reviewRunId); if (!episode.ok) return episode;
    const run = found(this.getReviewRun(projectId, reviewRunId)); if (!run.ok) return run;
    return coreOk(Object.freeze({ run: run.value, episode: episode.value, ...reviewProducts(run.value, episode.value), findingProjection: projectFindings(run.value.findings) }));
  }

  async diagnoseDatabase(input: { readonly backupDirectory: string; readonly dataRoot: string }): Promise<CoreResult<CoreDatabaseDiagnostics>> {
    const integrity = checkDatabaseIntegrity(this.#database.path);
    if (!integrity.ok) return coreErr("infrastructure_failure");
    const current = readSchemaVersion(this.#database);
    const status = current === SCHEMA_VERSION ? "current" as const : current < SCHEMA_VERSION ? "behind" as const : "too_new" as const;
    if (this.#database.readOnly) return coreErr("infrastructure_failure");
    try {
      const backup = await backupDatabase(this.#database, { backupDirectory: input.backupDirectory, dataRoot: input.dataRoot });
      return coreOk(Object.freeze({
        database: Object.freeze({ readable: true as const, writable: true, integrity: "ok" as const }),
        schema: Object.freeze({ current, expected: SCHEMA_VERSION, runtimeVersion: RUNTIME_VERSION, status }),
        backup: Object.freeze({ status: "ok" as const, schemaVersion: backup.version, hash: backup.hash, sizeBytes: backup.sizeBytes }),
      }));
    } catch (error) {
      return { ok: false, error: mapDomainError(typeof error === "object" && error !== null ? error : {}) };
    }
  }

  getEpisode(projectId: string, episodeId: string): CoreResult<RevisionEpisode | undefined> { return fromDomain(this.#store.episodes.getById(projectId, episodeId)); }
  getReviewRun(projectId: string, reviewRunId: string): CoreResult<ReviewRun | undefined> {
    const result = this.#reviews.getById(projectId, reviewRunId);
    return result.ok ? coreOk(result.value) : { ok: false, error: mapDomainError(result.error) };
  }
  getSnapshot(projectId: string, snapshotId: string): CoreResult<ResearchSnapshot | undefined> { return fromDomain(this.#store.snapshots.getById(projectId, snapshotId)); }

  getResearchRoomState(projectId: string): CoreResult<ResearchRoomState> { return this.#researchRoom.getState(projectId); }
  prepareResearchRoomReview(input: PrepareResearchRoomReviewInput): CoreResult<PreparedResearchRoomReview> { return this.#researchRoom.prepare(input); }
  cancelResearchRoomReview(input: { readonly reviewId: string; readonly confirmationNonce: string; readonly manifestHash: string }): CoreResult<{ readonly cancelled: true }> { return this.#researchRoom.cancel(input); }
  analyzeResearchRoomSuggestion(input: { readonly reviewId: string; readonly confirmationNonce: string; readonly manifestHash: string }): Promise<CoreResult<AnalyzedResearchRoomReview>> { return this.#researchRoom.analyze(input); }
  commitResearchRoomDisposition(input: CommitResearchRoomDispositionInput): CoreResult<ResearchRoomReceipt> { return this.#researchRoom.commit(input); }
  listResearchRoomReceipts(projectId: string): CoreResult<readonly ResearchRoomReceipt[]> { return this.#researchRoom.listReceipts(projectId); }
  rollbackResearchRoomReceipt(input: RollbackResearchRoomReceiptInput): CoreResult<ResearchRoomReceipt> { return this.#researchRoom.rollback(input); }

  createCorrectionAppeal(input: CreateCorrectionAppealInput): CoreResult<CorrectionAppeal> { return this.#correctionAppeals.create(input); }
  updateCorrectionAppeal(input: UpdateCorrectionAppealInput): CoreResult<CorrectionAppeal> { return this.#correctionAppeals.update(input); }
  recordCorrectionAppeal(input: CorrectionAppealCommandInput): CoreResult<CorrectionAppeal> { return this.#correctionAppeals.record(input); }
  markCorrectionAppealRecordOnly(input: CorrectionAppealCommandInput): CoreResult<CorrectionAppeal> { return this.#correctionAppeals.markRecordOnly(input); }
  prepareCorrectionAppealSecondOpinion(input: PrepareCorrectionAppealSecondOpinionCoreInput): CoreResult<PreparedCorrectionAppealSecondOpinion> { return this.#correctionAppeals.prepare(input); }
  runCorrectionAppealSecondOpinion(input: RunCorrectionAppealSecondOpinionInput): Promise<CoreResult<CorrectionAppeal>> { return this.#correctionAppeals.run(input); }
  cancelCorrectionAppealSecondOpinion(input: CancelCorrectionAppealSecondOpinionInput): CoreResult<CorrectionAppeal> { return this.#correctionAppeals.cancel(input); }
  resolveCorrectionAppeal(input: ResolveCorrectionAppealInput): CoreResult<CorrectionAppeal> { return this.#correctionAppeals.resolve(input); }
  listCorrectionAppeals(projectId: string): CoreResult<readonly CorrectionAppeal[]> { return this.#correctionAppeals.list(projectId); }
  getCorrectionAppeal(projectId: string, appealId: string): CoreResult<CorrectionAppeal | undefined> { return this.#correctionAppeals.get(projectId, appealId); }

  getProjectOverviewProjection(projectId: string, input: { readonly providerStatus: WorkspaceProviderStatus }): CoreResult<ProjectOverviewProjection> { return this.#researchObjects.getOverview(projectId, input, this.#researchRoom.getAttentionSignals(projectId)); }
  getBriefWorkspaceProjection(projectId: string, historyLimit?: number): CoreResult<BriefWorkspaceProjection> { return this.#researchObjects.getBriefWorkspace(projectId, historyLimit); }
  listDecisionProjections(projectId: string, request: WorkspaceListRequest): CoreResult<WorkspacePage<DecisionSummaryProjection>> { return this.#researchObjects.listDecisions(projectId, request); }
  getDecisionProjection(projectId: string, decisionId: string): CoreResult<DecisionDetailProjection | undefined> { return this.#researchObjects.getDecision(projectId, decisionId); }
  listIssueProjections(projectId: string, request: WorkspaceListRequest): CoreResult<WorkspacePage<IssueSummaryProjection>> { return this.#researchObjects.listIssues(projectId, request); }
  getIssueProjection(projectId: string, issueId: string): CoreResult<IssueDetailProjection | undefined> { return this.#researchObjects.getIssue(projectId, issueId); }
  listEvidenceProjections(projectId: string, request: WorkspaceListRequest): CoreResult<WorkspacePage<EvidenceSummaryProjection>> { return this.#researchObjects.listEvidence(projectId, request); }
  getEvidenceProjection(projectId: string, evidenceId: string): CoreResult<EvidenceDetailProjection | undefined> { return this.#researchObjects.getEvidence(projectId, evidenceId); }
  listEpisodeProjections(projectId: string, request: WorkspaceListRequest): CoreResult<WorkspacePage<EpisodeSummaryProjection>> { return this.#researchObjects.listEpisodes(projectId, request); }
  getEpisodeProjection(projectId: string, episodeId: string): CoreResult<EpisodeDetailProjection | undefined> { return this.#researchObjects.getEpisode(projectId, episodeId); }
  listReceiptProjections(projectId: string, request: WorkspaceListRequest): CoreResult<WorkspacePage<ReceiptSummaryProjection>> { return this.#researchObjects.listReceipts(projectId, request); }
  getReceiptProjection(projectId: string, receiptId: string): CoreResult<ReceiptDetailProjection | undefined> { return this.#researchObjects.getReceipt(projectId, receiptId); }
  listAppealProjections(projectId: string, request: WorkspaceListRequest): CoreResult<WorkspacePage<AppealSummaryProjection>> { return this.#researchObjects.listAppeals(projectId, request); }
  getAppealProjection(projectId: string, appealId: string): CoreResult<AppealDetailProjection | undefined> { return this.#researchObjects.getAppeal(projectId, appealId); }
  getAttentionProjection(projectId: string): CoreResult<AttentionProjection> { return this.#researchObjects.getAttention(projectId, this.#researchRoom.getAttentionSignals(projectId)); }
  searchResearchObjects(projectId: string, input: { readonly query: string; readonly limit: number; readonly cursor?: string }): CoreResult<ResearchObjectSearchProjection> { return this.#researchObjects.search(projectId, input); }

  private get ports(): { readonly clock: Clock; readonly idFactory: IdFactory } { return { clock: this.#clock, idFactory: this.#idFactory }; }

  private findBriefVersion(projectId: string, versionId: string): CoreResult<{ readonly brief: ResearchBrief; readonly version: ResearchBriefVersion }> {
    const page = fromDomain(this.#store.briefs.listByProject(projectId, PAGE)); if (!page.ok) return page;
    if (page.value.nextCursor !== undefined) return coreErr("state_conflict");
    for (const brief of page.value.items) {
      const version = getResearchBriefVersion(brief, versionId);
      if (version !== undefined) return coreOk(Object.freeze({ brief, version }));
    }
    return coreErr("not_found");
  }

  private findActiveBrief(projectId: string): CoreResult<{ readonly brief: ResearchBrief; readonly version: ResearchBriefVersion } | undefined> {
    const page = fromDomain(this.#store.briefs.listByProject(projectId, PAGE)); if (!page.ok) return page;
    if (page.value.nextCursor !== undefined) return coreErr("state_conflict");
    const active = page.value.items.flatMap((brief) => {
      const version = getActiveResearchBriefVersion(brief);
      return version === undefined ? [] : [{ brief, version }];
    }).sort((left, right) => right.version.createdAt.localeCompare(left.version.createdAt) || right.version.id.localeCompare(left.version.id));
    return coreOk(active[0]);
  }

  private findBriefProposal(projectId: string, proposalId: string): CoreResult<{ readonly brief: ResearchBrief; readonly proposal: BriefChangeProposal }> {
    const page = fromDomain(this.#store.briefs.listByProject(projectId, PAGE)); if (!page.ok) return page;
    if (page.value.nextCursor !== undefined) return coreErr("state_conflict");
    for (const brief of page.value.items) {
      const proposal = brief.proposals.find((item) => item.id === proposalId);
      if (proposal !== undefined) return coreOk(Object.freeze({ brief, proposal }));
    }
    return coreErr("not_found");
  }

  private findEpisodeByReviewRun(projectId: string, reviewRunId: string): CoreResult<RevisionEpisode> {
    const episodes = this.listEpisodes(projectId); if (!episodes.ok) return episodes;
    const episode = episodes.value.find((item) => item.reviewRunIds.includes(reviewRunId));
    return episode === undefined ? coreErr("not_found") : coreOk(episode);
  }

  private loadReviewBundle(projectId: string, episodeId: string): CoreResult<{
    readonly episode: RevisionEpisode; readonly run: ReviewRun; readonly artifact: ResearchArtifact; readonly brief: { readonly brief: ResearchBrief; readonly version: ResearchBriefVersion }; readonly baseline: ArtifactRevision; readonly candidate: ArtifactRevision;
  }> {
    const episode = found(this.getEpisode(projectId, episodeId)); if (!episode.ok) return episode;
    const runId = episode.value.reviewRunIds.at(-1); if (runId === undefined || episode.value.candidateRevisionId === undefined) return coreErr("state_conflict");
    const run = found(this.getReviewRun(projectId, runId)); if (!run.ok) return run;
    const artifact = found(fromDomain(this.#store.artifacts.getById(projectId, episode.value.artifactId))); if (!artifact.ok) return artifact;
    const brief = this.findBriefVersion(projectId, episode.value.lockedStart.briefVersionId); if (!brief.ok) return brief;
    const baseline = found(fromDomain(this.#store.revisions.getById(projectId, episode.value.artifactId, episode.value.lockedStart.baselineRevisionId))); if (!baseline.ok) return baseline;
    const candidate = found(fromDomain(this.#store.revisions.getById(projectId, episode.value.artifactId, episode.value.candidateRevisionId))); if (!candidate.ok) return candidate;
    return coreOk(Object.freeze({ episode: episode.value, run: run.value, artifact: artifact.value, brief: brief.value, baseline: baseline.value, candidate: candidate.value }));
  }
}

export async function openSestina(options: OpenSestinaOptions): Promise<CoreResult<SestinaCore>> {
  if (typeof options.databasePath !== "string" || options.databasePath.trim().length === 0) return coreErr("invalid_input");
  if (options.immutable === true && options.readOnly !== true) return coreErr("invalid_input");
  if (options.researchRoomProviderTimeoutMs !== undefined && (!Number.isSafeInteger(options.researchRoomProviderTimeoutMs) || options.researchRoomProviderTimeoutMs < 10 || options.researchRoomProviderTimeoutMs > 120_000)) return coreErr("invalid_input");
  if (options.correctionAppealSecondOpinionProviderTimeoutMs !== undefined && (!Number.isSafeInteger(options.correctionAppealSecondOpinionProviderTimeoutMs) || options.correctionAppealSecondOpinionProviderTimeoutMs < 10 || options.correctionAppealSecondOpinionProviderTimeoutMs > 120_000)) return coreErr("invalid_input");
  try {
    const database = await openDatabase({
      path: options.databasePath,
      readOnly: options.readOnly,
      immutable: options.immutable,
    });
    return coreOk(new SestinaCore(database, options.clock ?? new SystemClock(), options.idFactory ?? new RandomIdFactory(), options.researchRoomProvider, options.researchRoomProviderTimeoutMs, options.correctionAppealSecondOpinionProvider, options.correctionAppealSecondOpinionProviderTimeoutMs));
  } catch (error) {
    return { ok: false, error: mapDomainError(typeof error === "object" && error !== null ? error : {}) };
  }
}
