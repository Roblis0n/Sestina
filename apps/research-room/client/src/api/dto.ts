export type AppLanguage = "zh-CN" | "en";
export type ThemePreference = "system" | "light" | "dark" | "high_contrast";
export type MotionPreference = "system" | "on" | "off";
export type EvidenceClass =
  | "owner_scenario"
  | "synthetic_fixture"
  | "synthetic_adversarial_fixture";
export type DispositionKind =
  | "accepted"
  | "rejected"
  | "modified_accepted"
  | "deferred"
  | "direction_changed";

export interface StatusDto {
  readonly localOnly: true;
  readonly telemetry: false;
  readonly projectOpen: boolean;
  readonly recoveryRequired: boolean;
  readonly projectSetupRequired?: boolean;
  readonly project?: { readonly id: string; readonly title: string };
  readonly directoryPickerAvailable: boolean;
  readonly languagePreference: AppLanguage | null;
  readonly sessionToken: string;
}

export interface ProviderConfigDto {
  readonly family: "openai_compatible";
  readonly providerId: string;
  readonly model: string;
  readonly baseUrl: string;
  readonly locality: "local" | "external";
  readonly generation: number;
  readonly timeoutMs: number;
  readonly maxOutputTokens?: number;
}

export interface ProviderStatusDto {
  readonly mode: "configured" | "offline_ledger";
  readonly injected?: boolean;
  readonly secretConfigured?: boolean;
  readonly config?: ProviderConfigDto;
  readonly projectReopenRequired?: boolean;
}
export interface ProviderConnectionTestDto { readonly reachable: true; readonly requestKind: "metadata_only_no_research_context"; readonly endpoint: string; readonly providerId: string; readonly model: string; readonly locality: "local" | "external"; readonly httpStatus: number; }

export type CodexCapabilityStateDto = "observed" | "unavailable" | "unproven";
export interface CodexHostStatusDto {
  readonly availability: "available" | "unavailable";
  readonly supportedVersion: string | null;
  readonly verifiedAt?: string;
  readonly capabilities: { readonly start: CodexCapabilityStateDto; readonly structuredOutput: CodexCapabilityStateDto; readonly mcp: CodexCapabilityStateDto; readonly readOnlySandbox: CodexCapabilityStateDto; readonly cancellation: CodexCapabilityStateDto; readonly contextIsolation: CodexCapabilityStateDto };
  readonly configurationSeparateFromVerification: true;
}

export type ClosedExternalAppPilotStatusDto = "draft" | "preflight_ready" | "context_confirmation_required" | "context_confirmed" | "launching" | "running" | "candidate_received" | "candidate_confirmation_required" | "review_required" | "user_disposition_required" | "continuity_check_ready" | "continuity_check_running" | "continuity_verified" | "closed" | "stale" | "expired" | "cancelled" | "failed" | "blocked_host_unavailable" | "interrupted_unknown";
export interface ClosedPilotManifestDto {
  readonly id: string;
  readonly attemptId: string;
  readonly purpose: "candidate_generation" | "continuity_check";
  readonly included: readonly { readonly category: string; readonly id: string; readonly version: number; readonly source: string; readonly sensitivity: "public" | "project_private"; readonly contentHash: string; readonly contentBytes: number }[];
  readonly excluded: readonly { readonly category: string; readonly id?: string; readonly reason: string; readonly source: string; readonly sensitivity: "public" | "project_private" | "secret_never_send" }[];
  readonly workingMemorySelection: { readonly defaultSelectedCount: 0; readonly selectedIds: readonly string[]; readonly neverSendIncludedCount: 0 };
  readonly disclosure: { readonly externalModelServiceMayBeCalled: boolean; readonly hostCan: readonly string[]; readonly hostCannot: readonly string[]; readonly timeoutMs: number; readonly outputLimitBytes: number; readonly invocationLimit: 1; readonly automaticRetries: 0; readonly sandbox: "read_only"; readonly projectWrite: false };
  readonly payload: Readonly<Record<string, unknown>>;
  readonly payloadUtf8: string;
  readonly payloadBytes: number;
  readonly payloadHash: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}
export interface ClosedPilotAttemptDto { readonly id: string; readonly kind: "candidate_generation" | "continuity_check"; readonly ordinal: 1 | 2; readonly status: "prepared" | "confirmed" | "launching" | "running" | "completed" | "failed" | "cancelled" | "unknown"; readonly manifestId: string; readonly manifestHash: string; readonly confirmationNonce: string; readonly confirmationExpiresAt: string; readonly confirmedAt?: string; readonly confirmationConsumedAt?: string; readonly invocationId?: string; readonly startedAt?: string; readonly completedAt?: string; readonly cancelledAt?: string; readonly failedAt?: string; readonly failureCode?: string; readonly mcpObservation?: { readonly health: "completed"; readonly getResearchContext: "completed"; readonly payloadHash: string }; readonly stdoutBytes?: number; readonly stderrBytes?: number; readonly usage?: Readonly<Record<string, number>> | "unavailable"; }
export interface ClosedPilotCandidateDto { readonly id: string; readonly status: "received" | "imported" | "rejected" | "stale"; readonly candidateMarkdown: string; readonly materialDelta: string; readonly preservedDecisionIds: readonly string[]; readonly affectedIssueIds: readonly string[]; readonly evidenceUsed: readonly string[]; readonly unknowns: readonly string[]; readonly reopenResolvedIssue: boolean; readonly authority: "model_proposed"; readonly canMutateAuthority: false; readonly attemptId: string; readonly invocationId: string; readonly manifestId: string; readonly manifestHash: string; readonly candidateHash: string; readonly receivedAt: string; readonly importedAt?: string; readonly rejectedAt?: string; }
export interface ClosedExternalAppPilotDto {
  readonly schemaVersion: "1.0.0"; readonly id: string; readonly projectId: string; readonly host: "codex"; readonly authority: "external_host_proposal_only"; readonly canMutateAuthority: false;
  readonly brief: { readonly id: string; readonly versionId: string; readonly version: number }; readonly episode: { readonly id: string; readonly version: number }; readonly currentTask: string; readonly evidenceClass: "synthetic_fixture" | "owner_operated_closed_host_observation"; readonly status: ClosedExternalAppPilotStatusDto; readonly version: number;
  readonly invocationBudget: { readonly candidateMaximum: 2; readonly continuityMaximum: 2; readonly candidateAttemptsUsed: number; readonly continuityAttemptsUsed: number; readonly automaticRetries: 0 };
  readonly preflight?: CodexHostStatusDto; readonly manifests: readonly ClosedPilotManifestDto[]; readonly attempts: readonly ClosedPilotAttemptDto[]; readonly candidate?: ClosedPilotCandidateDto;
  readonly review?: { readonly reviewId: string; readonly importedRevisionId: string; readonly reviewMode: "ledger_only" | "provider_assisted"; readonly boundAt: string };
  readonly disposition?: { readonly reviewId: string; readonly receiptId: string; readonly traceId: string; readonly disposition: string; readonly decidedBy: "user"; readonly decidedAt: string };
  readonly continuity?: Readonly<Record<string, unknown>>; readonly feedback?: { readonly codes: readonly string[]; readonly note?: string; readonly recordedAt: string }; readonly failure?: { readonly code: string; readonly publicReason: string; readonly at: string };
  readonly events: readonly Readonly<Record<string, unknown>>[]; readonly createdAt: string; readonly updatedAt: string; readonly startedAt?: string; readonly cancelledAt?: string; readonly failedAt?: string; readonly closedAt?: string;
}
export interface ClosedPilotImportDto { readonly pilot: ClosedExternalAppPilotDto; readonly revision: Readonly<Record<string, unknown>>; readonly review: PreparedReviewDto; }
export interface ClosedPilotReviewRestoreDto { readonly pilot: ClosedExternalAppPilotDto; readonly review: PreparedReviewDto; }
export interface ClosedPilotDispositionDto { readonly pilot: ClosedExternalAppPilotDto; readonly receipt: ResearchRoomReceiptDto; }
export interface ClosedPilotEvidenceDto { readonly schemaVersion: "1.0.0"; readonly evidenceClass: "synthetic_fixture" | "owner_operated_closed_host_observation"; readonly host: "codex"; readonly projectBindingHash: string; readonly pilotBindingHash: string; readonly stableOutcome: ClosedExternalAppPilotStatusDto; readonly stages: Readonly<Record<string, boolean>>; readonly counts: Readonly<Record<string, number>>; readonly context: readonly { readonly purpose: string; readonly categories: readonly string[]; readonly bytes: number; readonly hash: string; readonly selectedWorkingMemoryCount: number }[]; readonly stableErrorCode?: string; readonly feedbackCodes: readonly string[]; readonly authorityMutationCount: 0; readonly automaticRetryCount: 0; readonly externalUserEvidenceCount: 0; }

export interface ProjectOpenResultDto {
  readonly project: { readonly id: string; readonly title: string };
  readonly initialized: boolean;
  readonly setupRequired: boolean;
  readonly recoveryRequired: boolean;
  readonly localOnly: true;
  readonly pathPersisted: false;
  readonly directoryScanPerformed: false;
}

export interface RecoveryBackupSummaryDto {
  readonly backupId: string;
  readonly kind: "manual" | "pre_restore" | "pre_upgrade";
  readonly createdAt?: string;
  readonly projectId?: string;
  readonly databaseSchemaVersion?: number;
  readonly databaseSizeBytes?: number;
  readonly briefSizeBytes?: number;
  readonly verification: "verified" | "failed";
  readonly valid: boolean;
}

export interface ProjectRecoveryStatusDto {
  readonly currentState: "healthy" | "recovery_required";
  readonly databaseIntegrity: "ok" | "failed" | "missing";
  readonly currentBriefBinding: "matched" | "mismatched" | "unavailable";
  readonly schema: { readonly status: "recognized" | "too_old" | "too_new" | "migration_failed" | "unavailable"; readonly version?: number; readonly failedVersion?: number; readonly supportedVersion: number; readonly supportedMinimum: number };
  readonly projectId?: string;
  readonly restoreAvailable: boolean;
  readonly backups: readonly RecoveryBackupSummaryDto[];
  readonly networkUsed: false;
}

export interface ProjectStateBackupDto {
  readonly backupId: string;
  readonly kind: "manual" | "pre_restore" | "pre_upgrade";
  readonly projectId: string;
  readonly integrity: "ok";
  readonly briefBinding: "matched";
  readonly databaseHash: string;
  readonly briefHash: string;
  readonly bindingHash: string;
  readonly databaseSchemaVersion: number;
  readonly databaseSizeBytes: number;
  readonly briefSizeBytes: number;
  readonly networkUsed: false;
}

export interface PreparedProjectStateRestoreDto {
  readonly backupId: string;
  readonly kind: "manual" | "pre_restore" | "pre_upgrade";
  readonly projectId: string;
  readonly createdAt: string;
  readonly databaseIntegrity: "ok";
  readonly briefBinding: "matched";
  readonly databaseSchemaVersion: number;
  readonly databaseSizeBytes: number;
  readonly briefSizeBytes: number;
  readonly runtimeVersion: string;
  readonly manifestHash: string;
  readonly bindingHash: string;
  readonly compatibility: "supported";
  readonly currentStatePreservation: "complete_bundle_or_forensic_copy";
  readonly confirmationRequired: true;
  readonly confirmationNonce: string;
  readonly stateBinding: string;
  readonly expiresAt: string;
  readonly currentState: Pick<ProjectRecoveryStatusDto, "currentState" | "databaseIntegrity" | "currentBriefBinding" | "schema" | "projectId">;
  readonly networkUsed: false;
}

export interface ExecutedProjectStateRestoreDto {
  readonly restored: true;
  readonly backupId: string;
  readonly projectId: string;
  readonly preRestoreBackupId: string;
  readonly forensicCopyPreserved: boolean;
  readonly databaseIntegrity: "ok";
  readonly briefBinding: "matched";
  readonly sourceManifestHash: string;
  readonly sourceBindingHash: string;
  readonly rollback: { readonly performed: false; readonly currentStatePreserved: true };
  readonly networkUsed: false;
  readonly confirmationConsumed: true;
  readonly postRestoreStateBinding: string;
  readonly reopened: true;
  readonly project: { readonly id: string; readonly title: string };
}

export interface SelectedDirectoryDto extends Partial<ProjectOpenResultDto> {
  readonly selected: boolean;
}

export interface DirectoryPickerCancellationDto {
  readonly cancelRequested: boolean;
}

export type SelectedDirectoryPreviewDto =
  | { readonly selected: false }
  | ({ readonly selected: true; readonly initializationRequired: false } & ProjectOpenResultDto)
  | {
      readonly selected: true;
      readonly initializationRequired: true;
      readonly projectTitle: string;
      readonly confirmationNonce: string;
      readonly localOnly: true;
      readonly pathPersisted: false;
      readonly directoryScanPerformed: false;
      readonly writesPerformed: false;
      readonly creates: readonly string[];
    };

export interface BriefDto {
  readonly projectQuestion: string;
  readonly currentStage: string;
  readonly currentTask: string;
  readonly fixedDecisions: readonly { readonly statement: string }[];
}

export interface ResearchRoomReceiptDto {
  readonly id: string;
  readonly version: number;
  readonly status: string;
  readonly receiptHash: string;
  readonly disposition: { readonly kind: DispositionKind; readonly reason?: string };
  readonly rollback: { readonly available: boolean; readonly reason?: string };
  readonly providerStatus?: "semantic_ready" | "ledger_only";
  readonly semanticJudge?: {
    readonly assessments: readonly AssessmentDto[];
    readonly responseHashes: { readonly requestHash: string };
    readonly derivation?: string;
  };
}

export interface ResearchRoomStateDto {
  readonly project: { readonly id: string; readonly title: string };
  readonly brief: BriefDto;
  readonly decisions: readonly { readonly statement: string; readonly status: string }[];
  readonly issues: readonly { readonly summary: string; readonly status: string }[];
  readonly currentEpisode?: { readonly id: string; readonly status: string };
  readonly receipts: readonly ResearchRoomReceiptDto[];
}

export interface ManifestFieldDto {
  readonly category: string;
  readonly source: string;
  readonly sensitivity: string;
}

export interface SemanticJudgeManifestDto {
  readonly provider: {
    readonly id: string;
    readonly model: string;
    readonly locality: "local" | "external";
  };
  readonly request: {
    readonly endpoint: string;
    readonly requestBodyBytes: number;
    readonly requestHash: string;
    readonly requestBodyHash: string;
    readonly requestBody: string;
  };
  readonly protocol: { readonly version: string; readonly hash: string };
  readonly prompt: { readonly version: string; readonly hash: string };
  readonly rubric: { readonly version: string; readonly hash: string };
  readonly excludedFields: readonly string[];
}

export interface ContextManifestDto {
  readonly fields: readonly ManifestFieldDto[];
  readonly networkRequired: boolean;
  readonly networkUsed: boolean;
  readonly sendStatus: string;
  readonly countsAsExternalEvidence: false;
  readonly workingMemory?: {
    readonly authority: "working_memory_context_only_non_authoritative";
    readonly manifestId: string;
    readonly manifestHash: string;
    readonly payloadHash: string;
    readonly included: readonly { readonly itemId: string; readonly version: number; readonly contentHash: string }[];
    readonly excluded: readonly { readonly itemId: string; readonly state: ProjectMemoryStateDto; readonly reason: ProjectMemoryManifestExclusionReasonDto }[];
  };
  readonly semanticJudge?: SemanticJudgeManifestDto;
}

export interface PreparedReviewDto {
  readonly reviewId: string;
  readonly confirmationNonce: string;
  readonly manifestHash: string;
  readonly contextManifestVisible: true;
  readonly manifest: ContextManifestDto;
}

export interface EvidenceSpanDto {
  readonly quote: string;
  readonly start: number;
  readonly end: number;
  readonly quoteHash: string;
}

export interface AssessmentDto {
  readonly criterionId: string;
  readonly verdict: "positive" | "negative" | "unknown";
  readonly publicRationale: string;
  readonly uncertainty?: string;
  readonly missingContext: readonly string[];
  readonly evidenceSpans: readonly EvidenceSpanDto[];
  readonly minimalCorrection?: string;
}

export interface FindingDto {
  readonly kind: string;
  readonly summary: string;
}

export interface SemanticFindingDto {
  readonly id: string;
  readonly kind: string;
  readonly severity: "info" | "warning" | "error";
  readonly rationale: string;
  readonly minimumRecovery: string;
  readonly decisionIds: readonly string[];
  readonly issueIds: readonly string[];
  readonly authority: "model_proposed";
}

export interface ArgumentDeltaDto {
  readonly genuineAdditions: readonly string[];
  readonly summary: string;
}

export interface AnalyzedReviewDto {
  readonly reviewId: string;
  readonly authorityNonce: string;
  readonly stateBinding: Readonly<Record<string, unknown>>;
  readonly providerStatus: "semantic_ready" | "ledger_only";
  readonly ledgerOnlyReason?: string;
  readonly manifest: ContextManifestDto;
  readonly semanticJudge?: {
    readonly assessments: readonly AssessmentDto[];
    readonly findings: readonly SemanticFindingDto[];
    readonly reasonableIncrement: {
      readonly status: string;
      readonly blockingCriteria: readonly string[];
    };
  };
  readonly analysis: {
    readonly findings: readonly FindingDto[];
    readonly argumentDelta: ArgumentDeltaDto;
    readonly alternativeExplanations: readonly string[];
    readonly unknowns: readonly string[];
    readonly unproven: readonly string[];
    readonly minimalCorrection: string;
  };
}

export interface ProviderSaveInput {
  readonly providerId: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly timeoutMs: number;
  readonly maxOutputTokens?: number;
  readonly apiKey?: string;
}

export interface CommitDispositionInput {
  readonly projectId: string;
  readonly reviewId: string;
  readonly authorityNonce: string;
  readonly expectedStateBinding: Readonly<Record<string, unknown>>;
  readonly disposition: DispositionKind;
  readonly reason: string;
  readonly modifiedProposal?: string;
  readonly redirectQuestion?: string;
}

export type ResearchObjectKind = "decision" | "issue" | "evidence" | "episode" | "receipt" | "appeal" | "deliberation_room";
export interface ProvenanceDto { readonly authority: string; readonly actorKind: string; readonly recordedAt: string; }
export type DecisionScopeDto = { readonly kind: "project" } | { readonly kind: "artifact"; readonly artifactId: string } | { readonly kind: "brief"; readonly briefVersionId: string } | { readonly kind: "issue"; readonly issueId: string };
export interface DecisionSummaryDto { readonly kind: "decision"; readonly id: string; readonly statement: string; readonly status: string; readonly scope: DecisionScopeDto; readonly rationale: string; readonly effectiveBriefVersionId: string; readonly reopenConditions: readonly string[]; readonly active: boolean; readonly referencedByCurrentBrief: boolean; readonly supersedesDecisionId?: string; readonly supersededByDecisionId?: string; readonly version: number; readonly createdAt: string; readonly updatedAt: string; readonly provenance: ProvenanceDto; }
export interface DecisionDetailDto extends DecisionSummaryDto { readonly availableActions: readonly ("accept" | "reject" | "freeze" | "supersede")[]; readonly timeline: readonly unknown[]; readonly lineage: readonly { readonly id: string; readonly statement: string; readonly status: string; readonly version: number; readonly relation: "ancestor" | "current" | "replacement" }[]; readonly lineageTruncated: boolean; readonly relatedBriefVersionIds: readonly string[]; readonly relatedIssueIds: readonly string[]; readonly relatedEpisodeIds: readonly string[]; readonly relatedReceiptIds: readonly string[]; readonly relationsTruncated: boolean; }
export interface IssueSummaryDto { readonly kind: "issue"; readonly id: string; readonly issueKind: string; readonly summary: string; readonly status: string; readonly violatedCriterion: string; readonly fingerprint: string; readonly recurrenceCount: number; readonly requiresUserAction: boolean; readonly version: number; readonly createdAt: string; readonly updatedAt: string; readonly provenance: ProvenanceDto; }
export interface IssueDetailDto extends IssueSummaryDto { readonly availableActions: readonly ("resolve" | "waive" | "dispute" | "reopen")[]; readonly target: Readonly<Record<string, unknown>>; readonly rationaleConcepts: readonly string[]; readonly sourceArtifactId: string; readonly sourceRevisionId: string; readonly sourceRevisionContentHash: string; readonly lineageRootRevisionId: string; readonly firstSeenAt: string; readonly lastSeenAt: string; readonly resolution?: Readonly<Record<string, unknown>>; readonly reopenHistory: readonly unknown[]; readonly timeline: readonly unknown[]; readonly relatedBriefVersionIds: readonly string[]; readonly relatedDecisionIds: readonly string[]; readonly relatedEvidenceIds: readonly string[]; readonly relatedEpisodeIds: readonly string[]; readonly relatedReceiptIds: readonly string[]; readonly relationsTruncated: boolean; }
export interface EvidenceSummaryDto { readonly kind: "evidence"; readonly id: string; readonly evidenceKind: string; readonly summary: string; readonly state: string; readonly inferenceCapacity: string; readonly artifactId?: string; readonly revisionId?: string; readonly version: number; readonly provenance: ProvenanceDto; }
export interface EvidenceDetailDto extends EvidenceSummaryDto { readonly contentVersionHash?: string; readonly safeLocator: Readonly<Record<string, unknown>>; readonly capturedAt: string; readonly sensitivity: "not_recorded"; readonly confidence: "not_recorded"; readonly uncertainty: string; readonly userVerificationState: "user_recorded" | "not_user_verified"; readonly claimLinks: readonly unknown[]; readonly mechanismLinks: readonly unknown[]; readonly relatedBriefVersionIds: readonly string[]; readonly relatedDecisionIds: readonly string[]; readonly relatedIssueIds: readonly string[]; readonly relatedEpisodeIds: readonly string[]; readonly relationsTruncated: boolean; }
export interface EpisodeSummaryDto { readonly kind: "episode"; readonly id: string; readonly artifactId: string; readonly status: string; readonly version: number; readonly createdAt: string; readonly updatedAt: string; readonly provenance: ProvenanceDto; }
export interface EpisodeDetailDto extends EpisodeSummaryDto { readonly lockedStart: Readonly<Record<string, unknown>>; readonly lockedStartHash: string; readonly candidateRevisionId?: string; readonly reviewRunIds: readonly string[]; readonly findingIds: readonly string[]; readonly outcome?: Readonly<Record<string, unknown>>; readonly waivers: readonly unknown[]; readonly timeline: readonly unknown[]; readonly lockedBrief?: { readonly versionId: string; readonly stage: string; readonly task: string }; readonly argumentDeltas: readonly { readonly receiptId: string; readonly kind: string; readonly summary: string }[]; readonly relatedDecisionIds: readonly string[]; readonly relatedIssueIds: readonly string[]; readonly relatedReceiptIds: readonly string[]; readonly relationsTruncated: boolean; }
export interface ObjectReceiptSummaryDto { readonly kind: "receipt"; readonly id: string; readonly reviewId: string; readonly sourceEpisodeId?: string; readonly status: string; readonly providerStatus: string; readonly evidenceClass: string; readonly disposition: Readonly<Record<string, unknown>>; readonly rollback: Readonly<Record<string, unknown>>; readonly version: number; readonly receiptHash: string; readonly createdAt: string; readonly updatedAt: string; }
export interface ObjectReceiptDetailDto extends ObjectReceiptSummaryDto { readonly countsAsExternalEvidence: false; readonly ledgerOnlyReason?: string; readonly suggestionHash: string; readonly argumentDelta: Readonly<Record<string, unknown>>; readonly findings: readonly unknown[]; readonly alternativeExplanations: readonly string[]; readonly unknowns: readonly string[]; readonly unproven: readonly string[]; readonly minimalCorrection: string; readonly contextFields: readonly unknown[]; readonly network: Readonly<Record<string, unknown>>; readonly authority: Readonly<Record<string, unknown>>; readonly beforeStateHash: string; readonly afterStateHash: string; readonly relatedBriefVersionIds: readonly string[]; readonly relatedDecisionIds: readonly string[]; readonly relatedIssueIds: readonly string[]; readonly correctionAppeals: readonly { readonly appealId: string; readonly findingId: string; readonly status: CorrectionAppealStatusDto; readonly updatedAt: string; readonly href: string }[]; readonly appealableFindings: readonly { readonly findingId: string; readonly kind: string; readonly severity: "info" | "warning" | "error"; readonly appealId?: string; readonly action: "create_appeal" | "open_appeal" | "unavailable"; readonly href?: string; readonly unavailableReason?: string }[]; readonly trace: readonly { readonly step: string; readonly summary: string }[]; }
export type CorrectionAppealStatusDto = "draft" | "recorded" | "awaiting_send_confirmation" | "second_opinion_running" | "second_opinion_ready" | "appeal_record_only" | "waiting_user_resolution" | "provider_failed" | "cancelled" | "stale_conflicted" | "resolved";
export type AppealResolutionKindDto = "uphold_original_finding" | "overturn_original_finding" | "modify_finding_interpretation" | "defer_insufficient_evidence" | "record_disagreement_without_resolution";
export interface AppealStatementDto { readonly disagreement: string; readonly challengedCriterionId: string; readonly claimedError: string; readonly missingOrMisreadContext: string; readonly secondOpinionQuestion: string; readonly desiredDisposition?: AppealResolutionKindDto; }
export interface AppealSummaryDto { readonly kind: "appeal"; readonly id: string; readonly reviewId: string; readonly sourceReceiptId: string; readonly findingId: string; readonly criterionId: string; readonly status: CorrectionAppealStatusDto; readonly disagreement: string; readonly version: number; readonly attemptCount: number; readonly resolutionCount: number; readonly createdAt: string; readonly updatedAt: string; }
export interface AppealManifestObjectDto { readonly kind: "brief" | "decision" | "issue" | "evidence"; readonly id: string; readonly version: number; readonly hash: string; readonly fields: Readonly<Record<string, string>>; }
export interface AppealManifestDto { readonly schemaVersion: "1.0.0"; readonly canonicalHash: string; readonly requestHash: string; readonly requestBodyHash: string; readonly requestBodyBytes: number; readonly includedFields: readonly string[]; readonly includedObjects: readonly AppealManifestObjectDto[]; readonly excludedFields: readonly string[]; readonly tokenEstimate: Readonly<Record<string, unknown>>; readonly costEstimate: Readonly<Record<string, unknown>>; readonly stateBindingHash: string; }
export interface AppealAttemptDto { readonly id: string; readonly ordinal: number; readonly status: "prepared" | "running" | "completed" | "failed" | "cancelled" | "unknown"; readonly participant: Readonly<Record<string, unknown>>; readonly independenceBasis: Readonly<Record<string, unknown>>; readonly manifest: AppealManifestDto; readonly confirmationNonce: string; readonly preparedAt: string; readonly startedAt?: string; readonly completedAt?: string; readonly cancelledAt?: string; readonly failedAt?: string; readonly failure?: string; readonly result?: Readonly<Record<string, unknown>>; readonly comparison?: Readonly<Record<string, unknown>>; }
export interface AppealDetailDto extends AppealSummaryDto { readonly source: Readonly<Record<string, unknown>>; readonly lineage: Readonly<Record<string, unknown>>; readonly statements: readonly { readonly version: number; readonly statement: AppealStatementDto; readonly actor: Readonly<Record<string, unknown>>; readonly recordedAt: string }[]; readonly attempts: readonly AppealAttemptDto[]; readonly resolutions: readonly Readonly<Record<string, unknown>>[]; readonly timeline: readonly Readonly<Record<string, unknown>>[]; readonly latestComparison?: Readonly<Record<string, unknown>>; readonly availableActions: readonly ("edit" | "record" | "record_only" | "prepare_second_opinion" | "confirm_send" | "cancel" | "resolve" | "retry_with_new_manifest")[]; readonly userAuthorityOnly: true; readonly canAutoResolve: false; readonly relatedReceiptHref: string; }
export interface PreparedAppealSecondOpinionDto { readonly schemaVersion: "1.0.0"; readonly contextManifestVisible: true; readonly appeal: AppealDetailDto; readonly attemptId: string; readonly confirmationNonce: string; readonly manifest: AppealManifestDto; readonly providerPreview: { readonly endpoint: string; readonly requestBodyBytes: number; readonly responseLimitBytes: number; readonly retryCount: 0; readonly redirectPolicy: "error" }; }
export type DeliberationRoomStatusDto = "draft" | "context_prepared" | "awaiting_manifest_confirmation" | "blind_round_running" | "reveal_ready" | "difference_review" | "challenge_prepared" | "challenge_running" | "waiting_user_resolution" | "partial" | "retry_prepared" | "retry_running" | "failed" | "cancelled" | "stale_conflicted" | "resolved" | "closed";
export interface DeliberationSourceDto { readonly projectId: string; readonly kind: "correction_appeal" | "research_issue" | "research_decision" | "research_brief" | "research_object"; readonly objectId: string; readonly objectVersion: number; readonly question: string; readonly sourceHash: string; }
export interface DeliberationParticipantStateDto { readonly slot: "a" | "b"; readonly providerId: string; readonly model: string; readonly status: string; }
export interface DeliberationParticipantDto { readonly id: string; readonly slot: "a" | "b"; readonly role: "independent_research_assessor"; readonly connectionId: string; readonly providerId: string; readonly family: "openai_compatible"; readonly model: string; readonly harnessId: string; readonly runtimeIdentityHash: string; readonly endpointIdentityHash: string; readonly secretRefHash: string; readonly configGeneration: number; readonly locality: "local" | "external"; }
export interface DeliberationManifestDto { readonly schemaVersion: "1.0.0"; readonly roomId: string; readonly roundId: string; readonly participantId: string; readonly participantSlot: "a" | "b"; readonly requestHash: string; readonly requestBodyHash: string; readonly participantSnapshotHash: string; readonly includedFields: readonly string[]; readonly includedObjects: readonly Readonly<Record<string, unknown>>[]; readonly excludedFields: readonly string[]; readonly stateBindingHash: string; readonly protocol: Readonly<Record<string, string>>; readonly prompt: Readonly<Record<string, string>>; readonly responseSchema: Readonly<Record<string, string>>; readonly rubric: Readonly<Record<string, string>>; readonly tokenBudget: number; readonly maxResponseBytes: number; readonly tools: "none"; readonly roomContextOnly: true; readonly canonicalHash: string; }
export interface DeliberationAssessmentDto { readonly assessment: "support" | "oppose" | "mixed" | "unknown"; readonly directAnswer: string; readonly dimensions: readonly Readonly<Record<string, unknown>>[]; readonly claims: readonly Readonly<Record<string, unknown>>[]; readonly evidenceSpans: readonly Readonly<Record<string, unknown>>[]; readonly assumptions: readonly string[]; readonly scope: string; readonly counterexamples: readonly string[]; readonly alternativeExplanations: readonly string[]; readonly unknowns: readonly string[]; readonly nextDiscriminatingEvidence: readonly string[]; readonly missingContext: readonly string[]; readonly uncertaintySources: readonly string[]; readonly publicRationale: string; readonly proposedNextStep: string; readonly participantId: string; readonly participantSlot: "a" | "b"; readonly roundId: string; readonly requestHash: string; }
export interface DeliberationAttemptDto { readonly id: string; readonly participantId: string; readonly requestHash: string; readonly status: "prepared" | "running" | "completed" | "failed" | "cancelled" | "unknown"; readonly sealed: boolean; readonly preparedAt?: string; readonly startedAt?: string; readonly completedAt?: string; readonly failedAt?: string; readonly cancelledAt?: string; readonly failure?: string; readonly assessment?: DeliberationAssessmentDto; }
export interface DeliberationDifferenceSummaryDto { readonly schemaVersion: "1.0.0"; readonly categories: readonly { readonly kind: string; readonly status: "present" | "absent" | "unproven"; readonly statements: readonly string[]; readonly sourceReferences: readonly string[] }[]; readonly authority: "system_derived"; readonly canResolveRoom: false; readonly winner: null; readonly ranking: null; readonly score: null; readonly canonicalHash: string; }
export interface ManualExternalOpinionDto { readonly id: string; readonly sourceLabel: string; readonly providerClaim: string; readonly modelClaim: string; readonly capturedAt: string; readonly contextDisclosure: string; readonly exposure: { readonly sawParticipantAOutput: boolean; readonly sawParticipantBOutput: boolean }; readonly blindnessVerification: "not_verifiable"; readonly publicContent: string; readonly classification: "manual_non_blind"; readonly verification: "unverified_external_import"; readonly importedAt: string; }
export interface DeliberationRetryDto { readonly id: string; readonly participantId: string; readonly priorAttemptId: string; readonly status: "prepared" | "running" | "completed" | "failed" | "cancelled" | "unknown"; readonly manifest: DeliberationManifestDto; readonly attempt: DeliberationAttemptDto; readonly userConfirmed: boolean; readonly preparedAt: string; readonly startedAt?: string; readonly completedAt?: string; }
export interface DeliberationRoomSummaryDto { readonly kind: "deliberation_room"; readonly id: string; readonly title: string; readonly status: DeliberationRoomStatusDto; readonly providerReadiness: "configured_distinct" | "blocked_missing_provider" | "same_runtime_not_mutually_independent"; readonly source: DeliberationSourceDto; readonly participantStates: readonly [DeliberationParticipantStateDto, DeliberationParticipantStateDto]; readonly differenceSummaryAvailable: boolean; readonly providerCallCount: number; readonly providerCallLimit: 4; readonly challengeStatus?: string; readonly retryStatus?: string; readonly manualOpinionCount: number; readonly resolutionCount: number; readonly version: number; readonly createdAt: string; readonly updatedAt: string; }
export interface DeliberationRoomDetailDto extends DeliberationRoomSummaryDto { readonly participants: readonly [DeliberationParticipantDto, DeliberationParticipantDto]; readonly manifests?: readonly [DeliberationManifestDto, DeliberationManifestDto]; readonly assessments: readonly DeliberationAttemptDto[]; readonly reveal?: { readonly mode: "complete" | "partial" | "cancelled"; readonly explicitUserAction: true; readonly revealedAt: string }; readonly differenceSummary?: DeliberationDifferenceSummaryDto; readonly challenge?: { readonly id: string; readonly question: string; readonly status: string; readonly userConfirmed: boolean; readonly manifests: readonly [DeliberationManifestDto, DeliberationManifestDto]; readonly attempts: readonly [DeliberationAttemptDto, DeliberationAttemptDto]; readonly preparedAt: string; readonly startedAt?: string; readonly completedAt?: string }; readonly retry?: DeliberationRetryDto; readonly manualExternalOpinions: readonly ManualExternalOpinionDto[]; readonly resolutions: readonly Readonly<Record<string, unknown>>[]; readonly trace: readonly { readonly step: string; readonly summary: string; readonly at: string }[]; readonly availableActions: readonly ("prepare_manifests" | "confirm_and_start" | "cancel" | "reveal_complete" | "reveal_partial" | "prepare_retry" | "confirm_retry" | "prepare_challenge" | "finish_review" | "import_manual_opinion" | "resolve" | "close")[]; readonly userAuthorityOnly: true; readonly canAutoResolve: false; readonly sourceHref: string; readonly receiptHrefs: readonly string[]; }
export interface PreparedDeliberationDto { readonly schemaVersion: "1.0.0"; readonly contextManifestsVisible: true; readonly sharedContextOnly?: true; readonly room: DeliberationRoomDetailDto; readonly manifests: readonly [DeliberationManifestDto, DeliberationManifestDto]; readonly providerPreviews: readonly [{ readonly endpoint: string; readonly requestBodyBytes: number; readonly responseLimitBytes: number; readonly retryCount: 0; readonly redirectPolicy: "error" }, { readonly endpoint: string; readonly requestBodyBytes: number; readonly responseLimitBytes: number; readonly retryCount: 0; readonly redirectPolicy: "error" }]; }
export interface PreparedDeliberationRetryDto { readonly schemaVersion: "1.0.0"; readonly contextManifestVisible: true; readonly room: DeliberationRoomDetailDto; readonly manifest: DeliberationManifestDto; readonly providerPreview: { readonly endpoint: string; readonly requestBodyBytes: number; readonly responseLimitBytes: number; readonly retryCount: 0; readonly redirectPolicy: "error" }; }
export interface WorkspacePage<T> { readonly schemaVersion: "1.0.0"; readonly projectId: string; readonly datasetVersion: string; readonly items: readonly T[]; readonly nextCursor?: string; }
export interface WorkspaceListRequest { readonly limit: number; readonly cursor?: string; readonly status?: string; readonly query?: string; readonly source?: string; readonly scope?: string; readonly active?: boolean; readonly referencedByCurrentBrief?: boolean; readonly issueKind?: string; readonly relevance?: "current_brief"; readonly unresolved?: boolean; readonly disposition?: string; readonly providerStatus?: string; }
export interface AttentionItemDto { readonly id: string; readonly kind: "brief_candidate" | "decision" | "issue" | "episode" | "review" | "manifest" | "rollback" | "provider" | "appeal" | "deliberation_room" | "memory" | "external_app_pilot"; readonly title: string; readonly reason: string; readonly severity: "high" | "normal"; readonly href: string; readonly primaryAction: string; readonly sourceObject: { readonly kind: string; readonly id: string }; readonly valid: true; readonly createdAt: string; }
export interface AttentionDto { readonly schemaVersion: "1.0.0"; readonly projectId: string; readonly total: number; readonly items: readonly AttentionItemDto[]; readonly truncated: boolean; }
export interface BriefVersionDto { readonly id: string; readonly projectId: string; readonly versionNumber: number; readonly projectQuestion: string; readonly currentStage: string; readonly currentTask: string; readonly targetArtifacts: readonly string[]; readonly fixedDecisions: readonly unknown[]; readonly allowedChanges: readonly unknown[]; readonly forbiddenChanges: readonly unknown[]; readonly expectedDeltas: readonly unknown[]; readonly evidenceBoundaries: readonly unknown[]; readonly explicitNonGoals: readonly string[]; readonly source: Readonly<Record<string, unknown>>; readonly createdAt: string; readonly supersedes?: string; }
export interface BriefCandidateDto { readonly id: string; readonly baseVersionId: string; readonly status: string; readonly changes: Readonly<Record<string, unknown>>; readonly diffFields: readonly string[]; readonly reason: string; readonly createdAt: string; readonly provenance: ProvenanceDto; readonly confirmedAt?: string; readonly activatedVersionId?: string; readonly diff: readonly { readonly field: string; readonly change: "added" | "removed" | "changed" | "unchanged"; readonly before: unknown; readonly after: unknown }[]; readonly impact: { readonly highImpactDirectionChange: boolean; readonly currentTaskChanged: boolean; readonly evidenceBoundaryEffect: "loosened" | "tightened" | "changed" | "unchanged"; readonly fixedDecisionsChanged: boolean; readonly explicitNonGoalsRemoved: readonly string[]; readonly activeEpisodeIds: readonly string[]; readonly activeEpisodesTruncated: boolean; readonly reviewImpact: string; readonly manifestImpact: string; readonly expectedEntityVersion: number }; }
export interface BriefWorkspaceDto { readonly schemaVersion: "1.0.0"; readonly projectId: string; readonly briefId: string; readonly entityVersion: number; readonly active: BriefVersionDto; readonly versions: readonly BriefVersionDto[]; readonly versionCount: number; readonly versionsTruncated: boolean; readonly candidates: readonly BriefCandidateDto[]; readonly candidateCount: number; readonly candidatesTruncated: boolean; }
export interface ProjectOverviewDto { readonly schemaVersion: "1.0.0"; readonly project: { readonly id: string; readonly title: string; readonly version: number; readonly updatedAt: string }; readonly providerStatus: "configured" | "ledger_only"; readonly brief: { readonly id: string; readonly versionId: string; readonly versionNumber: number; readonly question: string; readonly stage: string; readonly task: string }; readonly counts: { readonly decisions: number; readonly issues: number; readonly evidence: number; readonly episodes: number; readonly receipts: number; readonly appeals: number; readonly deliberationRooms: number }; readonly statuses: { readonly decisions: Readonly<Record<string, number>>; readonly issues: Readonly<Record<string, number>>; readonly evidence: Readonly<Record<string, number>>; readonly episodes: Readonly<Record<string, number>>; readonly receipts: Readonly<Record<string, number>>; readonly appeals: Readonly<Record<string, number>>; readonly deliberationRooms: Readonly<Record<string, number>> }; readonly attention: { readonly total: number; readonly top: readonly AttentionItemDto[] }; readonly currentEpisode?: { readonly id: string; readonly status: string; readonly updatedAt: string; readonly href: string }; readonly latestReceipt?: { readonly id: string; readonly status: string; readonly disposition: string; readonly updatedAt: string; readonly href: string }; readonly recentChanges: readonly { readonly kind: ResearchObjectKind | "brief"; readonly id: string; readonly label: string; readonly status: string; readonly at: string; readonly href: string }[]; }
export interface ResearchObjectSearchResultDto { readonly kind: ResearchObjectKind | "brief" | "memory" | "external_app_pilot"; readonly id: string; readonly title: string; readonly detail: string; readonly status: string; readonly source: string; readonly projectId: string; readonly href: string; }
export interface ResearchObjectSearchDto { readonly schemaVersion: "1.0.0"; readonly projectId: string; readonly datasetVersion: string; readonly query: string; readonly items: readonly ResearchObjectSearchResultDto[]; readonly nextCursor?: string; readonly truncated: boolean; }

export type ProjectMemoryKindDto = "term" | "working_hint" | "resume_note" | "workset";
export type ProjectMemoryStateDto = "candidate" | "active" | "stale" | "expired" | "retired" | "forgotten";
export type ProjectMemoryManifestExclusionReasonDto = "not_selected" | "candidate_not_confirmed" | "stale_source" | "expired" | "retired" | "forgotten" | "never_send" | "sensitivity_forbids_send";
export type ProjectMemorySensitivityDto = "public" | "project_private" | "sensitive" | "secret_never_send";
export type ProjectMemoryOutboundPolicyDto = "never_send" | "explicit_manifest_only";
export type ProjectMemoryObjectKindDto = "brief" | "decision" | "issue" | "evidence" | "episode" | "appeal" | "deliberation_room" | "receipt" | "artifact" | "revision";
export type ProjectMemoryContentDto = { readonly term: string; readonly definition: string } | { readonly text: string } | { readonly purpose: string; readonly refs: readonly { readonly kind: ProjectMemoryObjectKindDto; readonly id: string; readonly version: number }[] };
export type ProjectMemorySourceDto = { readonly kind: "direct_user"; readonly actorId: string } | { readonly kind: "project_object"; readonly objectKind: ProjectMemoryObjectKindDto; readonly objectId: string; readonly objectVersion: number; readonly contentFingerprint: string };
export type ProjectMemoryRetentionDto = { readonly policy: "current_episode"; readonly episodeId: string } | { readonly policy: "until_date"; readonly expiresAt: string } | { readonly policy: "until_unpinned" };
export interface ProjectMemoryTransitionDto { readonly action: "created" | "confirmed" | "edited" | "source_stale" | "expired" | "renewed" | "retired"; readonly from?: Exclude<ProjectMemoryStateDto, "forgotten">; readonly to: Exclude<ProjectMemoryStateDto, "forgotten">; readonly actor: "user" | "kernel"; readonly at: string; readonly publicReason: string; }
export interface ProjectMemoryItemDto {
  readonly id: string; readonly projectId: string; readonly authorityClass: "working_memory_non_authoritative"; readonly state: ProjectMemoryStateDto; readonly version: number; readonly recallEligible: boolean; readonly manifestEligible: boolean;
  readonly content?: ProjectMemoryContentDto; readonly contentHash?: string; readonly kind?: ProjectMemoryKindDto; readonly source?: ProjectMemorySourceDto; readonly retention?: ProjectMemoryRetentionDto; readonly sensitivity?: ProjectMemorySensitivityDto; readonly outboundPolicy?: ProjectMemoryOutboundPolicyDto; readonly semanticConflict?: "semantic_conflict_unchecked"; readonly staleReason?: "source_version_changed" | "source_content_changed" | "source_unavailable"; readonly createdAt?: string; readonly updatedAt?: string; readonly confirmedAt?: string; readonly expiredAt?: string; readonly retiredAt?: string; readonly forgottenAt?: string; readonly tombstone?: "irreversible_forget_recorded"; readonly transitions?: readonly ProjectMemoryTransitionDto[];
}
export interface ResumeCheckpointDto { readonly schemaVersion: "1.0.0"; readonly id: string; readonly projectId: string; readonly authorityClass: "resume_checkpoint_non_authoritative"; readonly projectVersion: number; readonly authorityBindings: readonly { readonly kind: string; readonly id: string; readonly version: number }[]; readonly memoryBindings: readonly { readonly id: string; readonly version: number; readonly state: ProjectMemoryStateDto }[]; readonly reviewedByUserId: string; readonly reviewedAt: string; readonly publicReason: string; readonly version: number; }
export type ResumeAuthorityBindingKindDto = "project" | "brief" | "decision" | "issue" | "evidence" | "episode" | "appeal" | "deliberation_room" | "receipt";
export type ResumeAuthorityChangeDto =
  | { readonly change: "added"; readonly kind: ResumeAuthorityBindingKindDto; readonly id: string; readonly afterVersion: number }
  | { readonly change: "updated"; readonly kind: ResumeAuthorityBindingKindDto; readonly id: string; readonly beforeVersion: number; readonly afterVersion: number }
  | { readonly change: "removed"; readonly kind: ResumeAuthorityBindingKindDto; readonly id: string; readonly beforeVersion: number };
export type ResumeWorkingMemoryChangeDto =
  | { readonly change: "added"; readonly id: string; readonly afterVersion: number; readonly afterState: ProjectMemoryStateDto }
  | { readonly change: "updated"; readonly id: string; readonly beforeVersion: number; readonly afterVersion: number; readonly beforeState: ProjectMemoryStateDto; readonly afterState: ProjectMemoryStateDto }
  | { readonly change: "removed"; readonly id: string; readonly beforeVersion: number; readonly beforeState: ProjectMemoryStateDto };
export interface ResumeChangesDto { readonly projectChanged: boolean; readonly authority: readonly ResumeAuthorityChangeDto[]; readonly workingMemory: readonly ResumeWorkingMemoryChangeDto[]; readonly summaryAuthority: "system_derived_deterministic_non_authoritative"; }
export interface ProjectMemoryProjectionDto {
  readonly schemaVersion: "1.0.0"; readonly projectId: string;
  readonly projectState: { readonly authorityClass: "kernel_authoritative_projection"; readonly projectVersion: number; readonly projectQuestion?: string; readonly currentTask?: string; readonly currentBrief?: { readonly id: string; readonly version: number }; readonly currentEpisode?: { readonly id: string; readonly status: string; readonly version: number }; readonly activeDecisions: readonly { readonly id: string; readonly statement: string; readonly status: string; readonly version: number }[]; readonly openIssues: readonly { readonly id: string; readonly summary: string; readonly status: string; readonly version: number }[]; readonly activeAppeals: readonly { readonly id: string; readonly status: string; readonly version: number }[]; readonly activeDeliberations: readonly { readonly id: string; readonly status: string; readonly version: number }[]; readonly recentReceipt?: { readonly id: string; readonly status: string; readonly version: number }; readonly unproven: readonly string[]; readonly stateHash: string };
  readonly workingMemory: { readonly authorityClass: "working_memory_non_authoritative"; readonly items: readonly ProjectMemoryItemDto[]; readonly activeCount: number; readonly nextCursor?: string; readonly semanticConflict: "semantic_conflict_unchecked"; readonly defaultOutboundPolicy: "never_send" };
  readonly resume: { readonly authorityClass: "resume_checkpoint_non_authoritative"; readonly checkpoint?: ResumeCheckpointDto; readonly changes?: ResumeChangesDto; readonly reviewed: boolean };
  readonly attention: readonly { readonly id: string; readonly kind: "memory_candidate" | "memory_stale" | "memory_expired" | "memory_expiring"; readonly title: string; readonly reason: string; readonly href: "/project/memory"; readonly severity: "normal" | "high" }[];
}
export interface ProjectMemoryManifestDto {
  readonly schemaVersion: "1.0.0"; readonly manifestId: string; readonly projectId: string; readonly authorityClass: "explicit_context_manifest_non_authoritative"; readonly status: "previewed" | "confirmed" | "consumed"; readonly provider: { readonly id: string; readonly kind: "none" | "deterministic_fixture" | "local" | "external"; readonly configHash: string; readonly networkRequired: boolean }; readonly projectStateHash: string;
  readonly included: readonly { readonly itemId: string; readonly kind: ProjectMemoryKindDto; readonly version: number; readonly contentHash: string; readonly source: ProjectMemorySourceDto; readonly state: "active"; readonly sensitivity: ProjectMemorySensitivityDto; readonly outboundPolicy: "explicit_manifest_only"; readonly contentBytes: number; readonly stale: false; readonly willLeaveDevice: boolean }[];
  readonly excluded: readonly { readonly itemId: string; readonly state: ProjectMemoryStateDto; readonly reason: ProjectMemoryManifestExclusionReasonDto }[];
  readonly providerPayload: { readonly schemaVersion: "1.0.0"; readonly projectId: string; readonly authority: "working_memory_context_only_non_authoritative"; readonly items: readonly { readonly itemId: string; readonly kind: ProjectMemoryKindDto; readonly version: number; readonly contentHash: string; readonly content: ProjectMemoryContentDto; readonly source: ProjectMemorySourceDto; readonly sensitivity: ProjectMemorySensitivityDto }[] };
  readonly manifestHash: string; readonly confirmationNonce: string; readonly createdAt: string; readonly expiresAt: string; readonly version: number;
}

export interface ExplicitCommandBase {
  readonly commandType: string;
  readonly projectId: string;
  readonly expectedVersion: number;
  readonly reason: string;
  readonly confirmed: true;
}
