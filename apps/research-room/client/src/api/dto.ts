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

export interface ProjectOpenResultDto {
  readonly project: { readonly id: string; readonly title: string };
  readonly initialized: boolean;
  readonly setupRequired: boolean;
  readonly localOnly: true;
  readonly pathPersisted: false;
  readonly directoryScanPerformed: false;
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

export type ResearchObjectKind = "decision" | "issue" | "evidence" | "episode" | "receipt" | "appeal";
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
export interface WorkspacePage<T> { readonly schemaVersion: "1.0.0"; readonly projectId: string; readonly datasetVersion: string; readonly items: readonly T[]; readonly nextCursor?: string; }
export interface WorkspaceListRequest { readonly limit: number; readonly cursor?: string; readonly status?: string; readonly query?: string; readonly source?: string; readonly scope?: string; readonly active?: boolean; readonly referencedByCurrentBrief?: boolean; readonly issueKind?: string; readonly relevance?: "current_brief"; readonly unresolved?: boolean; readonly disposition?: string; readonly providerStatus?: string; }
export interface AttentionItemDto { readonly id: string; readonly kind: "brief_candidate" | "decision" | "issue" | "episode" | "review" | "manifest" | "rollback" | "provider" | "appeal"; readonly title: string; readonly reason: string; readonly severity: "high" | "normal"; readonly href: string; readonly primaryAction: string; readonly sourceObject: { readonly kind: string; readonly id: string }; readonly valid: true; readonly createdAt: string; }
export interface AttentionDto { readonly schemaVersion: "1.0.0"; readonly projectId: string; readonly total: number; readonly items: readonly AttentionItemDto[]; readonly truncated: boolean; }
export interface BriefVersionDto { readonly id: string; readonly projectId: string; readonly versionNumber: number; readonly projectQuestion: string; readonly currentStage: string; readonly currentTask: string; readonly targetArtifacts: readonly string[]; readonly fixedDecisions: readonly unknown[]; readonly allowedChanges: readonly unknown[]; readonly forbiddenChanges: readonly unknown[]; readonly expectedDeltas: readonly unknown[]; readonly evidenceBoundaries: readonly unknown[]; readonly explicitNonGoals: readonly string[]; readonly source: Readonly<Record<string, unknown>>; readonly createdAt: string; readonly supersedes?: string; }
export interface BriefCandidateDto { readonly id: string; readonly baseVersionId: string; readonly status: string; readonly changes: Readonly<Record<string, unknown>>; readonly diffFields: readonly string[]; readonly reason: string; readonly createdAt: string; readonly provenance: ProvenanceDto; readonly confirmedAt?: string; readonly activatedVersionId?: string; readonly diff: readonly { readonly field: string; readonly change: "added" | "removed" | "changed" | "unchanged"; readonly before: unknown; readonly after: unknown }[]; readonly impact: { readonly highImpactDirectionChange: boolean; readonly currentTaskChanged: boolean; readonly evidenceBoundaryEffect: "loosened" | "tightened" | "changed" | "unchanged"; readonly fixedDecisionsChanged: boolean; readonly explicitNonGoalsRemoved: readonly string[]; readonly activeEpisodeIds: readonly string[]; readonly activeEpisodesTruncated: boolean; readonly reviewImpact: string; readonly manifestImpact: string; readonly expectedEntityVersion: number }; }
export interface BriefWorkspaceDto { readonly schemaVersion: "1.0.0"; readonly projectId: string; readonly briefId: string; readonly entityVersion: number; readonly active: BriefVersionDto; readonly versions: readonly BriefVersionDto[]; readonly versionCount: number; readonly versionsTruncated: boolean; readonly candidates: readonly BriefCandidateDto[]; readonly candidateCount: number; readonly candidatesTruncated: boolean; }
export interface ProjectOverviewDto { readonly schemaVersion: "1.0.0"; readonly project: { readonly id: string; readonly title: string; readonly version: number; readonly updatedAt: string }; readonly providerStatus: "configured" | "ledger_only"; readonly brief: { readonly id: string; readonly versionId: string; readonly versionNumber: number; readonly question: string; readonly stage: string; readonly task: string }; readonly counts: { readonly decisions: number; readonly issues: number; readonly evidence: number; readonly episodes: number; readonly receipts: number; readonly appeals: number }; readonly statuses: { readonly decisions: Readonly<Record<string, number>>; readonly issues: Readonly<Record<string, number>>; readonly evidence: Readonly<Record<string, number>>; readonly episodes: Readonly<Record<string, number>>; readonly receipts: Readonly<Record<string, number>>; readonly appeals: Readonly<Record<string, number>> }; readonly attention: { readonly total: number; readonly top: readonly AttentionItemDto[] }; readonly currentEpisode?: { readonly id: string; readonly status: string; readonly updatedAt: string; readonly href: string }; readonly latestReceipt?: { readonly id: string; readonly status: string; readonly disposition: string; readonly updatedAt: string; readonly href: string }; readonly recentChanges: readonly { readonly kind: ResearchObjectKind | "brief"; readonly id: string; readonly label: string; readonly status: string; readonly at: string; readonly href: string }[]; }
export interface ResearchObjectSearchResultDto { readonly kind: ResearchObjectKind | "brief"; readonly id: string; readonly title: string; readonly detail: string; readonly status: string; readonly source: string; readonly projectId: string; readonly href: string; }
export interface ResearchObjectSearchDto { readonly schemaVersion: "1.0.0"; readonly projectId: string; readonly datasetVersion: string; readonly query: string; readonly items: readonly ResearchObjectSearchResultDto[]; readonly nextCursor?: string; readonly truncated: boolean; }

export interface ExplicitCommandBase {
  readonly commandType: string;
  readonly projectId: string;
  readonly expectedVersion: number;
  readonly reason: string;
  readonly confirmed: true;
}
