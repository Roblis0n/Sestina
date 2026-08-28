/**
 * Public API of @sestina/research.
 *
 * Consumers must import from the package root only; internal modules are
 * not part of the contract.
 */
export { researchError } from "./errors.js";
export type { ResearchError, ResearchErrorDetails, ResearchErrorCode } from "./errors.js";

export { ok, err } from "./result.js";
export type { ResearchResult } from "./result.js";

export type { Clock } from "./clock.js";

export {
  RESEARCH_ID_PREFIXES,
  parseResearchId,
  parseResearchIdFor,
  isResearchId,
  isResearchIdFor,
} from "./identity/research-id.js";
export type { ResearchIdPrefix, ResearchId, ParsedResearchId } from "./identity/research-id.js";

export {
  initialEntityVersion,
  parseEntityVersion,
  advanceEntityVersion,
} from "./identity/entity-version.js";
export type { EntityVersion } from "./identity/entity-version.js";

export { canonicalStringify, stableResearchHash } from "./identity/canonical-json.js";

export { validateResearchActor } from "./authority/actor.js";
export type { ResearchActor, ResearchActorKind } from "./authority/actor.js";

export {
  AUTHORITY_LEVELS,
  isAuthorityLevel,
  actorKindForAuthority,
  actorMatchesAuthority,
  validateAuthorityTransition,
} from "./authority/authority-level.js";
export type { AuthorityLevel } from "./authority/authority-level.js";

export {
  validateUtcTimestamp,
  parseResearchSource,
} from "./authority/source.js";
export type { ResearchSource } from "./authority/source.js";

export { confirmResearchSource } from "./authority/confirmation.js";
export type { ConfirmedSource } from "./authority/confirmation.js";

export { FixedClock, SequenceIdFactory } from "./testing/fakes.js";

export {
  createResearchProject,
  updateResearchProject,
  parseResearchProject,
} from "./project/research-project.js";
export type {
  ResearchProject,
  CreateResearchProjectInput,
  UpdateResearchProjectInput,
} from "./project/research-project.js";

export { ARTIFACT_KINDS, parseArtifactKind } from "./artifact/artifact-kind.js";
export type { ArtifactKind } from "./artifact/artifact-kind.js";
export {
  contentReferenceForInline,
  parseContentReference,
} from "./artifact/content-reference.js";
export type {
  ContentReference,
  ResearchMediaType,
} from "./artifact/content-reference.js";
export {
  createArtifactRevision,
  parseArtifactRevision,
  rebuildArtifactRevisionChain,
} from "./artifact/artifact-revision.js";
export type {
  ArtifactRevision,
  CreateArtifactRevisionInput,
} from "./artifact/artifact-revision.js";
export {
  createResearchArtifact,
  parseResearchArtifact,
  addArtifactRevision,
  chooseArtifactBranch,
  tombstoneResearchArtifact,
  getArtifactRevision,
} from "./artifact/research-artifact.js";
export type {
  ResearchArtifact,
  ArtifactTombstone,
} from "./artifact/research-artifact.js";

export { RESEARCH_STAGES, parseResearchStage } from "./brief/research-stage.js";
export type { ResearchStage } from "./brief/research-stage.js";
export {
  parseScopeRule,
  normalizedScopeTargetKey,
  findScopeRuleConflict,
} from "./brief/scope-rule.js";
export type {
  ScopeRule,
  ScopeTarget,
  ScopeOperation,
} from "./brief/scope-rule.js";
export { parseExpectedDelta } from "./brief/expected-delta.js";
export type { ExpectedDelta } from "./brief/expected-delta.js";
export { parseEvidenceBoundaryRule } from "./brief/evidence-boundary-rule.js";
export type {
  EvidenceBoundaryRule,
  ForbiddenInferenceKind,
} from "./brief/evidence-boundary-rule.js";
export type {
  BriefChangeStatus,
  BriefChangeSet,
  BriefChangeProposal,
  CreateBriefChangeProposalInput,
} from "./brief/brief-change.js";
export {
  createResearchBrief,
  createImportedResearchBriefDraft,
  activateImportedResearchBriefDraft,
  parseResearchBrief,
  parseResearchBriefVersion,
  createBriefChangeProposal,
  confirmBriefChangeProposal,
  getActiveResearchBriefVersion,
  getResearchBriefVersion,
  exportResearchBriefYaml,
} from "./brief/research-brief.js";
export type {
  BriefConstraint,
  ResearchBriefVersionFields,
  ResearchBriefInput,
  ResearchBriefVersion,
  ResearchBrief,
} from "./brief/research-brief.js";

export { DECISION_STATUSES, parseDecisionStatus } from "./decision/decision-status.js";
export type { DecisionStatus } from "./decision/decision-status.js";
export {
  parseDecisionScope,
  decisionScopeMatches,
  decisionScopePriority,
} from "./decision/decision-scope.js";
export type {
  DecisionScope,
  DecisionQueryContext,
} from "./decision/decision-scope.js";
export { parseDecisionTransition } from "./decision/decision-transition.js";
export type { DecisionTransition } from "./decision/decision-transition.js";
export {
  createResearchDecision,
  parseResearchDecision,
  transitionResearchDecision,
  supersedeResearchDecision,
  getDecisionStateAt,
  queryActiveResearchDecisions,
} from "./decision/research-decision.js";
export type {
  ResearchDecisionInput,
  ResearchDecision,
  ActiveDecisionMatch,
} from "./decision/research-decision.js";

export { ISSUE_KINDS, parseIssueKind } from "./issue/issue-kind.js";
export type { IssueKind } from "./issue/issue-kind.js";
export {
  createIssueFingerprint,
  normalizeIssueFingerprintInput,
} from "./issue/issue-fingerprint.js";
export type {
  IssueFingerprintInput,
  NormalizedIssueFingerprintInput,
} from "./issue/issue-fingerprint.js";
export {
  parseIssueResolutionContext,
  evaluateIssueReopenReasons,
} from "./issue/reopen-condition.js";
export type {
  IssueReopenContext,
  IssueResolutionContext,
} from "./issue/reopen-condition.js";
export {
  ISSUE_STATUSES,
  parseIssueStatus,
  parseIssueTransition,
} from "./issue/issue-transition.js";
export type {
  IssueStatus,
  IssueTransition,
} from "./issue/issue-transition.js";
export {
  createResearchIssue,
  parseResearchIssue,
  acknowledgeResearchIssue,
  disputeResearchIssue,
  waiveResearchIssue,
  resolveResearchIssue,
  suppressResolvedIssue,
  reopenResearchIssue,
} from "./issue/research-issue.js";
export type {
  ResearchIssueInput,
  ResearchIssue,
  IssueResolution,
  IssueReopenRecord,
} from "./issue/research-issue.js";
export { matchResearchIssue } from "./issue/issue-matcher.js";
export type { IssueMatch } from "./issue/issue-matcher.js";

export { EPISODE_STATUSES, parseEpisodeStatus } from "./episode/episode-status.js";
export type { EpisodeStatus } from "./episode/episode-status.js";
export { parseEpisodeOutcome } from "./episode/episode-outcome.js";
export type {
  EpisodeOutcome,
  WaivableOutcomeDimension,
} from "./episode/episode-outcome.js";
export {
  createRevisionEpisode,
  parseRevisionEpisode,
  activateRevisionEpisode,
  submitEpisodeCandidate,
  recordEpisodeReview,
  requireEpisodeUserAction,
  applyEpisodeWaiver,
  disposeRevisionEpisode,
} from "./episode/revision-episode.js";
export type {
  LockedIssueState,
  LockedDecisionState,
  EpisodeLockedStart,
  EpisodeTransition,
  EpisodeWaiver,
  CreateRevisionEpisodeInput,
  RevisionEpisode,
} from "./episode/revision-episode.js";
export { calculateResearchSnapshotHash } from "./snapshot/snapshot-hash.js";
export {
  createResearchSnapshot,
  createReviewInputSnapshot,
  parseResearchSnapshot,
  verifyResearchSnapshotHash,
  rebuildEpisodeFromSnapshot,
} from "./snapshot/research-snapshot.js";
export type { ResearchSnapshot } from "./snapshot/research-snapshot.js";

export {
  RESEARCH_ROOM_DISPOSITIONS,
  RESEARCH_ROOM_EVIDENCE_CLASSES,
  createResearchRoomReceipt,
  parseResearchRoomAnalysisPayload,
  parseResearchRoomContextManifest,
  parseResearchRoomEvidenceClass,
  parseResearchRoomReceipt,
  parseResearchRoomStateBinding,
  rollBackResearchRoomReceipt,
} from "./room/research-room.js";
export type {
  ResearchRoomAnalysisPayload,
  ResearchRoomContextManifest,
  ResearchRoomDeltaKind,
  ResearchRoomDispositionKind,
  ResearchRoomEvidenceClass,
  ResearchRoomFinding,
  ResearchRoomFindingKind,
  ResearchRoomProviderStatus,
  ResearchRoomReceipt,
  ResearchRoomSemanticJudgeTrace,
  ResearchRoomStateBinding,
} from "./room/research-room.js";

export {
  APPEAL_RESOLUTION_KINDS,
  CORRECTION_APPEAL_STATUSES,
  SECOND_OPINION_FAILURES,
  cancelCorrectionAppealSecondOpinion,
  completeCorrectionAppealSecondOpinion,
  createCorrectionAppeal,
  deriveAppealComparison,
  failCorrectionAppealSecondOpinion,
  markCorrectionAppealRecordOnly,
  markCorrectionAppealStale,
  parseAppealSourceBinding,
  parseCorrectionAppeal,
  parseSecondOpinionResult,
  prepareCorrectionAppealSecondOpinion,
  recordCorrectionAppeal,
  resolveCorrectionAppeal,
  startCorrectionAppealSecondOpinion,
  updateCorrectionAppealStatement,
} from "./appeal/correction-appeal.js";
export type {
  AppealComparison,
  AppealIndependenceBasis,
  AppealReceipt,
  AppealResolution,
  AppealResolutionKind,
  AppealSourceBinding,
  AppealStatement,
  AppealStatementVersion,
  AppealTransition,
  CorrectionAppeal,
  CorrectionAppealStatus,
  SecondOpinionAttempt,
  SecondOpinionEvidenceSpan,
  SecondOpinionFailure,
  SecondOpinionManifest,
  SecondOpinionParticipantSnapshot,
  SecondOpinionResult,
} from "./appeal/correction-appeal.js";

export {
  DELIBERATION_DIFFERENCE_CATEGORIES,
  DELIBERATION_COMPARISON_DIMENSION_IDS,
  DELIBERATION_PARTICIPANT_FAILURES,
  DELIBERATION_RESOLUTION_KINDS,
  DELIBERATION_ROOM_STATUSES,
  DELIBERATION_SOURCE_KINDS,
  cancelDeliberationParticipant,
  completeDeliberationChallenge,
  completeDeliberationParticipant,
  completeDeliberationParticipantRetry,
  createDeliberationRoom,
  deriveDeliberationDifferenceSummary,
  failDeliberationChallenge,
  failDeliberationParticipant,
  failDeliberationParticipantRetry,
  importManualExternalOpinion,
  inspectDeliberationCommand,
  markDeliberationRoomStale,
  parseDeliberationContextManifest,
  parseDeliberationFrozenContext,
  parseDeliberationParticipantAssessment,
  parseDeliberationParticipantSnapshot,
  parseDeliberationRoom,
  parseDeliberationSourceBinding,
  prepareDeliberationChallenge,
  prepareDeliberationContext,
  prepareDeliberationParticipantRetry,
  recordDeliberationCommand,
  recoverInterruptedDeliberationRoom,
  resolveDeliberationRoom,
  revealDeliberationRound,
  startBlindDeliberationRound,
  startDeliberationChallenge,
  startDeliberationParticipantRetry,
  waitForDeliberationResolution,
} from "./deliberation/deliberation-room.js";
export type {
  DeliberationChallenge,
  DeliberationCommandReceipt,
  DeliberationComparisonDimension,
  DeliberationComparisonDimensionId,
  DeliberationContextManifest,
  DeliberationDifferenceCategory,
  DeliberationDifferenceItem,
  DeliberationDifferenceSummary,
  DeliberationEvidenceSpan,
  DeliberationInitialRound,
  DeliberationFrozenContext,
  DeliberationParticipantAssessment,
  DeliberationParticipantAttempt,
  DeliberationParticipantFailure,
  DeliberationParticipantRetry,
  DeliberationParticipantSnapshot,
  DeliberationProviderReadiness,
  DeliberationResolution,
  DeliberationResolutionKind,
  DeliberationResolutionReceipt,
  DeliberationRoom,
  DeliberationRoomStatus,
  DeliberationSourceBinding,
  DeliberationSourceKind,
  DeliberationTransition,
  ManualExternalOpinion,
} from "./deliberation/deliberation-room.js";

export {
  PROJECT_WORKING_MEMORY_KINDS,
  PROJECT_WORKING_MEMORY_STATES,
  PROJECT_WORKING_MEMORY_SENSITIVITIES,
  PROJECT_WORKING_MEMORY_OUTBOUND_POLICIES,
  PROJECT_WORKING_MEMORY_OBJECT_KINDS,
  PROJECT_WORKING_MEMORY_MAX_CONTENT_BYTES,
  PROJECT_WORKING_MEMORY_MAX_REFS,
  PROJECT_WORKING_MEMORY_MAX_ACTIVE_ITEMS,
  RESUME_CHECKPOINT_MAX_BINDINGS,
  RESUME_AUTHORITY_BINDING_KINDS,
  createProjectWorkingMemoryCandidate,
  confirmProjectWorkingMemory,
  editProjectWorkingMemory,
  markProjectWorkingMemorySourceStale,
  expireProjectWorkingMemory,
  renewProjectWorkingMemory,
  retireProjectWorkingMemory,
  forgetProjectWorkingMemory,
  isProjectWorkingMemoryRecallEligible,
  parseProjectWorkingMemory,
  createResumeCheckpoint,
  parseResumeCheckpoint,
  computeResumeChanges,
} from "./memory/project-working-memory.js";

export {
  CLOSED_EXTERNAL_APP_PILOT_STATUSES,
  CLOSED_PILOT_FAILURE_CODES,
  bindClosedPilotDisposition,
  bindClosedPilotReview,
  cancelClosedPilotAttempt,
  closeClosedExternalAppPilot,
  completeClosedPilotContinuity,
  confirmClosedPilotContext,
  createClosedExternalAppPilot,
  createClosedPilotEvidenceExport,
  expireClosedPilotConfirmation,
  failClosedPilotAttempt,
  importClosedPilotCandidate,
  markClosedPilotAttemptRunning,
  markClosedPilotStale,
  parseClosedExternalAppPilot,
  prepareClosedPilotContext,
  receiveClosedPilotCandidate,
  recordClosedPilotFeedback,
  recordClosedPilotPreflight,
  recoverInterruptedClosedPilot,
  rejectClosedPilotCandidate,
  requireClosedPilotCandidateConfirmation,
  restoreClosedPilotReview,
  startClosedPilotAttempt,
} from "./pilot/closed-external-app-pilot.js";
export type {
  ClosedExternalAppPilot,
  ClosedExternalAppPilotStatus,
  ClosedPilotAttempt,
  ClosedPilotAttemptKind,
  ClosedPilotAttemptStatus,
  ClosedPilotCandidate,
  ClosedPilotCandidateInput,
  ClosedPilotCapabilityState,
  ClosedPilotContinuityBinding,
  ClosedPilotContinuityObservation,
  ClosedPilotDispositionBinding,
  ClosedPilotEvidenceClass,
  ClosedPilotEvidenceExport,
  ClosedPilotEvent,
  ClosedPilotFailure,
  ClosedPilotFailureCode,
  ClosedPilotFeedback,
  ClosedPilotFeedbackCode,
  ClosedPilotFrozenContextPayload,
  ClosedPilotHostCapabilities,
  ClosedPilotManifestExclusion,
  ClosedPilotManifestIncludedItem,
  ClosedPilotMcpObservation,
  ClosedPilotPreflight,
  ClosedPilotReviewBinding,
  PilotContextManifest,
  PrepareClosedPilotContextInput,
} from "./pilot/closed-external-app-pilot.js";
export type {
  ProjectWorkingMemoryKind,
  ProjectWorkingMemoryState,
  ProjectWorkingMemorySensitivity,
  ProjectWorkingMemoryOutboundPolicy,
  ProjectWorkingMemoryContent,
  ProjectWorkingMemoryObjectRef,
  ProjectWorkingMemoryObjectKind,
  ProjectWorkingMemorySource,
  ProjectWorkingMemoryRetention,
  ProjectWorkingMemoryStaleReason,
  ProjectWorkingMemoryTransition,
  LiveProjectWorkingMemory,
  ForgottenProjectWorkingMemory,
  ProjectWorkingMemory,
  CreateProjectWorkingMemoryCandidateInput,
  ResumeAuthorityBindingKind,
  ResumeAuthorityBinding,
  ResumeMemoryBinding,
  ResumeCheckpoint,
  ResumeCurrentSnapshot,
  ResumeChanges,
} from "./memory/project-working-memory.js";

export { CLAIM_KINDS, parseArgumentClaim, parseClaim } from "./argument/claim.js";
export type { ArgumentClaim, Claim, ClaimKind } from "./argument/claim.js";
export { parseMechanismLink } from "./argument/mechanism-link.js";
export type { MechanismLink } from "./argument/mechanism-link.js";
export { NON_DELTA_KINDS, SUBSTANTIVE_ARGUMENT_DELTA_KINDS, parseArgumentDelta, parseModelProposedArgumentDelta } from "./argument/argument-delta.js";
export type { ArgumentDelta, ArgumentDeltaKind, ArgumentSpanReference, NonDeltaKind, SubstantiveArgumentDeltaKind } from "./argument/argument-delta.js";
export { EVIDENCE_KINDS, EVIDENCE_STATES, INFERENCE_CAPACITIES, parseArgumentEvidence, parseEvidence } from "./argument/evidence.js";
export type { ArgumentEvidence, Evidence, EvidenceKind, EvidenceState, InferenceCapacity } from "./argument/evidence.js";
export { parseClaimEvidenceLink } from "./argument/claim-evidence-link.js";
export type { ClaimEvidenceLink, ClaimEvidenceRole, EvidenceLinkStatus } from "./argument/claim-evidence-link.js";
export { parseMechanismEvidenceLink } from "./argument/mechanism-evidence-link.js";
export type { MechanismEvidenceLink } from "./argument/mechanism-evidence-link.js";

export {
  RESEARCH_PAGE_LIMIT_MAX,
  parseResearchPageRequest,
} from "./ports/repositories.js";
export type {
  ResearchPageRequest,
  ResearchPage,
  ResearchProjectRepository,
  ResearchArtifactRepository,
  ArtifactRevisionRepository,
  ResearchBriefRepository,
  ResearchDecisionRepository,
  ResearchIssueRepository,
  RevisionEpisodeRepository,
  ResearchSnapshotRepository,
  ArgumentNodeRepository,
  ArgumentClaimRepository,
  ArgumentEvidenceRepository,
  MechanismLinkRepository,
  ArgumentDeltaRepository,
  ClaimEvidenceLinkRepository,
  MechanismEvidenceLinkRepository,
  ArgumentGraphRepositories,
  ResearchRoomReceiptRepository,
  CorrectionAppealRepository,
  DeliberationRoomRepository,
  ProjectWorkingMemoryRepository,
  ResumeCheckpointRepository,
  ClosedExternalAppPilotRepository,
  ResearchRepositories,
  ResearchUnitOfWork,
} from "./ports/repositories.js";

import type { ResearchIdPrefix } from "./identity/research-id.js";

export interface IdFactory {
  create(prefix: ResearchIdPrefix): string;
}
