import {
  COVERAGE_STATUSES,
  parseReviewRun,
  projectFindings,
  type FindingProjection,
  type ObligationCoverage,
  type ReviewObligation,
  type ReviewOutcome,
  type ReviewRun,
} from "@sestina/review";

export interface ReviewReportInput {
  readonly title: string;
  readonly taskSummary: string;
  readonly run: ReviewRun;
  readonly outcome: ReviewOutcome;
  readonly obligations: readonly ReviewObligation[];
  readonly coverage: readonly ObligationCoverage[];
  readonly preservedContent: readonly string[];
  readonly userActions: readonly string[];
  readonly findingProjection?: FindingProjection;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isCoverage(value: unknown): value is ObligationCoverage {
  return isRecord(value)
    && typeof value.obligationId === "string"
    && typeof value.status === "string"
    && COVERAGE_STATUSES.some((status) => status === value.status)
    && isStringArray(value.findingIds)
    && typeof value.explanation === "string";
}

function isObligation(value: unknown): value is ReviewObligation {
  if (!isRecord(value) || !isRecord(value.source)) return false;
  return typeof value.id === "string"
    && ["fulfillment", "evidence", "scope", "decision_integrity", "issue_integrity"].includes(String(value.dimension))
    && typeof value.criterion === "string"
    && ["brief", "decision", "issue", "user"].includes(String(value.source.kind))
    && typeof value.source.id === "string"
    && typeof value.required === "boolean";
}

function isDimensionOutcome(value: unknown): boolean {
  return isRecord(value)
    && Array.isArray(value.coverage) && value.coverage.every(isCoverage)
    && isStringArray(value.obligationIds)
    && isStringArray(value.findingIds)
    && Number.isSafeInteger(value.satisfiedCount)
    && Number.isSafeInteger(value.waivedCount)
    && Number.isSafeInteger(value.notApplicableCount);
}

function isReviewOutcome(value: unknown): value is ReviewOutcome {
  if (!isRecord(value) || !isRecord(value.checkerHealth) || !isRecord(value.dimensions)) return false;
  const dimensions = value.dimensions;
  return typeof value.reviewReady === "boolean"
    && ["pending", "accepted", "rejected", "waived"].includes(String(value.userDisposition))
    && ["healthy", "checker_failed"].includes(String(value.checkerHealth.status))
    && isStringArray(value.checkerHealth.failedCheckerIds)
    && isStringArray(value.checkerHealth.missingCheckerIds)
    && isStringArray(value.checkerHealth.findingIds)
    && isStringArray(value.foregroundFindingIds)
    && isStringArray(value.auditFindingIds)
    && isDimensionOutcome(dimensions.fulfillment)
    && isDimensionOutcome(dimensions.evidence)
    && isDimensionOutcome(dimensions.scope)
    && isDimensionOutcome(dimensions.decisionIntegrity)
    && isDimensionOutcome(dimensions.issueIntegrity);
}

export function normalizeReportInput(input: unknown): ReviewReportInput {
  if (!isRecord(input)
    || typeof input.title !== "string" || input.title.trim().length === 0
    || typeof input.taskSummary !== "string" || input.taskSummary.trim().length === 0
    || !Array.isArray(input.obligations) || !input.obligations.every(isObligation)
    || !Array.isArray(input.coverage) || !input.coverage.every(isCoverage)
    || !isStringArray(input.preservedContent)
    || !isStringArray(input.userActions)
    || !isReviewOutcome(input.outcome)) {
    throw new Error("Invalid review report");
  }
  const run = parseReviewRun(input.run);
  if (!run.ok) throw new Error("Invalid review report");
  const findingProjection = projectFindings(run.value.findings, { preservedParts: input.preservedContent });
  return structuredClone({
    title: input.title.trim(),
    taskSummary: input.taskSummary.trim(),
    run: run.value,
    outcome: input.outcome,
    obligations: input.obligations,
    coverage: input.coverage,
    preservedContent: input.preservedContent,
    userActions: input.userActions,
    findingProjection,
  });
}
