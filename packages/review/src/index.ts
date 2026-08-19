export type { CheckerObservation, CheckerResult, ResearchChecker } from "./checker.js";
export { CheckerRegistry } from "./registry.js";
export { calculateReviewInputHash, parseReviewContext } from "./review-context.js";
export type {
  CheckerIdentity, CheckerKind, ReviewBriefBinding, ReviewContext, ReviewContextInput,
  ReviewDecisionBinding, ReviewEpisodeBinding, ReviewEvidenceBoundaryBinding, ReviewIssueBinding,
  ReviewProjectBinding, ReviewRevisionBinding, ReviewSnapshotBinding,
} from "./review-context.js";
export { createFinding, parseFinding } from "./finding.js";
export type { Finding, FindingConfidence, FindingPresentation, FindingProvenance, FindingSeverity, FindingTarget } from "./finding.js";
export { parseFindingEvidenceSpan } from "./finding-evidence.js";
export type { FindingEvidenceSpan } from "./finding-evidence.js";
export { appendReviewFindings, createReviewRun, finalizeReviewRun, parseReviewRun, runReview } from "./review-run.js";
export type { CheckerErrorRecord, ReviewRun, ReviewRunStatus } from "./review-run.js";
export { reviewErr, reviewError, reviewOk } from "./review-result.js";
export type { ReviewError, ReviewErrorCode, ReviewResult } from "./review-result.js";
export type { ReviewRunRepository } from "./repository/review-run-repository.js";
export { FreshnessChecker } from "./checkers/freshness-checker.js";
export type { FreshnessObservation } from "./checkers/freshness-checker.js";
export { FRESHNESS_REASONS, FRESHNESS_RATIONALE, FRESHNESS_RECOVERY } from "./checkers/freshness-reasons.js";
export type { FreshnessReason } from "./checkers/freshness-reasons.js";
export { findingIdFromFingerprint, reviewFingerprint } from "./checkers/fingerprint.js";
export { ScopeChecker } from "./checkers/scope-checker.js";
export type { ConfirmedScopeProposal, ScopeCheckInput, ScopeDocument } from "./checkers/scope-checker.js";
export { diffMarkdownBlocks } from "./diff/block-diff.js";
export type { BlockChange, BlockChangeOperation, BlockDiff } from "./diff/block-diff.js";
export { parseMarkdownStructure } from "./diff/markdown-structure.js";
export type { MarkdownBlock, MarkdownHeading, MarkdownStructure } from "./diff/markdown-structure.js";
export { parseProjectRelativePath } from "./diff/path-policy.js";
export { findingToIssueCandidate } from "./issue/finding-to-issue-candidate.js";
export type { FindingIssueCandidate } from "./issue/finding-to-issue-candidate.js";
export { decideFindingSuppression } from "./issue/suppression-decision.js";
export type { IssueLookupResult, SuppressionDecision } from "./issue/suppression-decision.js";
export { IssueIntegrityChecker } from "./checkers/issue-integrity-checker.js";
export type { IssueIntegrityInput } from "./checkers/issue-integrity-checker.js";
export { deriveReviewObligations } from "./outcome/obligation.js";
export type { ObligationSource, OutcomeDimension, ReviewObligation, UserReviewCheck } from "./outcome/obligation.js";
export { COVERAGE_STATUSES, deriveCoverage } from "./outcome/coverage.js";
export type { CoverageStatus, ObligationAssessment, ObligationCoverage } from "./outcome/coverage.js";
export { compareFindingSeverity, isBlockingCoverageStatus, isForegroundFinding } from "./outcome/severity-policy.js";
export { deriveReviewOutcome } from "./outcome/derive-outcome.js";
export type { DimensionOutcome, ReviewOutcome, UserReviewDisposition } from "./outcome/derive-outcome.js";
