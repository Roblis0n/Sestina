import type {
  ArtifactKind,
  DecisionScope,
  DecisionStatus,
  EvidenceBoundaryRule,
  ForbiddenInferenceKind,
  IssueKind,
  ResearchActor,
  ResearchBriefVersionFields,
  ResearchMediaType,
  ResearchStage,
  ScopeRule,
  ScopeTarget,
} from "@sestina/research";

export interface InitializeProjectCommand { readonly title: string; readonly actor: ResearchActor; readonly rootPath?: string; }
export interface ActivateBriefCommand {
  readonly projectId: string; readonly actor: ResearchActor; readonly projectQuestion: string; readonly currentStage: ResearchStage;
  readonly currentTask: string; readonly targetArtifacts: readonly string[];
  readonly fixedDecisions: readonly { readonly id?: string; readonly statement: string; readonly scope: ScopeRule }[];
  readonly allowedChanges: readonly ScopeRule[]; readonly forbiddenChanges: readonly ScopeRule[];
  readonly expectedDeltas: readonly { readonly id?: string; readonly statement: string; readonly scope: ScopeRule }[];
  readonly evidenceBoundaries: readonly { readonly id?: string; readonly scope: ScopeRule; readonly statement: string; readonly forbiddenInferenceKinds: readonly ForbiddenInferenceKind[] }[];
  readonly explicitNonGoals: readonly string[];
}
export interface CreateArtifactCommand { readonly projectId: string; readonly kind: ArtifactKind; readonly relativePath: string; readonly actor: ResearchActor; }
export interface CreateRevisionCommand { readonly projectId: string; readonly artifactId: string; readonly parentRevisionId?: string; readonly content: string; readonly mediaType: ResearchMediaType; readonly actor: ResearchActor; readonly allowFork?: boolean; }
export interface RecordDecisionCommand { readonly projectId: string; readonly actor: ResearchActor; readonly statement: string; readonly scope: DecisionScope; readonly rationale: string; readonly effectiveBriefVersionId: string; readonly reopenConditions: readonly string[]; readonly status?: Extract<DecisionStatus, "proposed" | "accepted" | "frozen">; }
export interface OpenIssueCommand { readonly projectId: string; readonly actor: ResearchActor; readonly kind: IssueKind; readonly target: ScopeTarget; readonly violatedCriterion: string; readonly rationaleConcepts: readonly string[]; readonly summary: string; readonly sourceArtifactId: string; readonly sourceRevisionId: string; readonly sourceRevisionContentHash: string; readonly lineageRootRevisionId: string; }
export interface StartRevisionEpisodeCommand { readonly projectId: string; readonly artifactId: string; readonly briefVersionId: string; readonly baselineRevisionId: string; readonly actor: ResearchActor; }
export interface SubmitCandidateRevisionCommand { readonly projectId: string; readonly episodeId: string; readonly candidateRevisionId: string; readonly actor: ResearchActor; }
export interface RunDeterministicReviewCommand { readonly projectId: string; readonly episodeId: string; readonly buildFingerprint?: string; readonly environmentFingerprint?: string; }
export interface RecordUserDispositionCommand { readonly projectId: string; readonly episodeId: string; readonly disposition: "accepted" | "rejected" | "abandoned"; readonly reason: string; readonly actor: ResearchActor; }
export interface CreateResearchSnapshotCommand { readonly projectId: string; readonly episodeId: string; readonly buildVersion: string; readonly limitations: readonly string[]; }
export interface RenderReviewReportCommand { readonly projectId: string; readonly episodeId: string; readonly format: string; }
export interface ExportCapsuleCommand { readonly projectId: string; readonly episodeId: string; readonly includePermittedFullText?: boolean; }

export type InitialBriefFields = ResearchBriefVersionFields;
export type EvidenceBoundaryInput = EvidenceBoundaryRule;
