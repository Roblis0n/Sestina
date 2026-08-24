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
