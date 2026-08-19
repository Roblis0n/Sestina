import type { SemanticFindingKind } from "./semantic-finding-kind.js";
import type { StableTextSpan } from "./stable-text-span.js";

export interface SemanticReviewerMetadata {
  readonly provider?: string;
  readonly model?: string;
  readonly sessionId?: string;
}

export interface SemanticFindingProposal {
  readonly id: string;
  readonly kind: SemanticFindingKind;
  readonly target: StableTextSpan;
  readonly baselineEvidence: readonly StableTextSpan[];
  readonly candidateEvidence: readonly StableTextSpan[];
  readonly decisionIds: readonly string[];
  readonly criterionId: string;
  readonly rationale: string;
  readonly minimalCorrection: string;
  readonly confidence: "low" | "medium" | "high";
  readonly uncertainty?: string;
}

export interface SemanticReviewProposal {
  readonly protocolVersion: "1.0.0";
  readonly reviewRunId: string;
  readonly inputHash: string;
  readonly inputSnapshotHash: string;
  readonly requestHash: string;
  readonly reviewer: SemanticReviewerMetadata;
  readonly findings: readonly SemanticFindingProposal[];
}
