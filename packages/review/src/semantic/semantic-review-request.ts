import type { ReviewRun } from "../review-run.js";
import type { SemanticFindingKind } from "./semantic-finding-kind.js";
import type { StableTextDocument, StableTextDocumentInput } from "./stable-text-span.js";

export interface SemanticBriefContext {
  readonly id: string;
  readonly projectQuestion: string;
  readonly currentTask: string;
  readonly targetArtifactIds: readonly string[];
  readonly fixedDecisions: readonly { readonly id: string; readonly statement: string }[];
  readonly expectedDeltas: readonly string[];
}

export interface SemanticDecisionContext {
  readonly id: string;
  readonly status: "accepted" | "frozen";
  readonly statement: string;
  readonly scope: string;
}

export interface SemanticCriterion {
  readonly id: string;
  readonly question: string;
  readonly allowedKinds: readonly SemanticFindingKind[];
  readonly requiredEvidence: "baseline" | "candidate" | "both";
  readonly scale: readonly string[];
}

export interface PrepareSemanticReviewInput {
  readonly reviewRun: ReviewRun;
  readonly brief: SemanticBriefContext;
  readonly baselineRevision: StableTextDocumentInput;
  readonly candidateRevision: StableTextDocumentInput;
  readonly activeDecisions: readonly SemanticDecisionContext[];
  readonly criteria: readonly SemanticCriterion[];
}

export interface SemanticReviewLimits {
  readonly maxFindings: number;
  readonly maxEvidenceSpansPerFinding: number;
  readonly maxRationaleChars: number;
  readonly maxMinimalCorrectionChars: number;
  readonly maxUncertaintyChars: number;
  readonly maxReviewerMetadataChars: number;
  readonly maxResponseBytes: number;
}

export interface SemanticReviewRequest {
  readonly protocolVersion: "1.0.0";
  readonly reviewRunId: string;
  readonly projectId: string;
  readonly inputHash: string;
  readonly inputSnapshotHash: string;
  readonly context: {
    readonly brief: SemanticBriefContext;
    readonly baselineRevision: StableTextDocument;
    readonly candidateRevision: StableTextDocument;
    readonly activeDecisions: readonly SemanticDecisionContext[];
  };
  readonly criteria: readonly SemanticCriterion[];
  readonly allowedFindingKinds: readonly SemanticFindingKind[];
  readonly constraints: {
    readonly authority: "proposal_only";
    readonly candidateTextIsUntrusted: true;
    readonly forbiddenPowers: readonly string[];
  };
  readonly limits: SemanticReviewLimits;
  readonly responseSchema: Readonly<Record<string, unknown>>;
  readonly requestHash: string;
}
