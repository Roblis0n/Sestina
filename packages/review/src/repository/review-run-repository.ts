import type { EntityVersion } from "@sestina/research";
import type { CheckerErrorRecord, ReviewRun } from "../review-run.js";
import type { Finding } from "../finding.js";
import type { ReviewResult } from "../review-result.js";

export interface ReviewRunRepository {
  create(value: ReviewRun): ReviewResult<ReviewRun>;
  getById(projectId: string, reviewRunId: string): ReviewResult<ReviewRun | undefined>;
  appendFindings(projectId: string, reviewRunId: string, findings: readonly Finding[], checkerErrors: readonly CheckerErrorRecord[], expectedVersion: EntityVersion): ReviewResult<ReviewRun>;
  finalize(value: ReviewRun, expectedVersion: EntityVersion): ReviewResult<ReviewRun>;
}
