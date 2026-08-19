import { parseResearchIdFor } from "@sestina/research";
import { reviewErr, reviewError, reviewOk, type ReviewResult } from "./review-result.js";

export interface FindingEvidenceSpan {
  readonly artifactId: string;
  readonly revisionId: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly excerptHash: string;
}

export function parseFindingEvidenceSpan(input: unknown): ReviewResult<FindingEvidenceSpan> {
  if (typeof input !== "object" || input === null) return reviewErr(reviewError("invalid_finding"));
  const value = input as Record<string, unknown>;
  const artifact = parseResearchIdFor(value.artifactId, "rart_");
  const revision = parseResearchIdFor(value.revisionId, "rrev_");
  if (!artifact.ok || !revision.ok || !Number.isSafeInteger(value.startLine) || !Number.isSafeInteger(value.endLine)) {
    return reviewErr(reviewError("invalid_finding"));
  }
  const startLine = value.startLine as number;
  const endLine = value.endLine as number;
  if (startLine < 1 || endLine < startLine || typeof value.excerptHash !== "string" || !/^[0-9a-f]{64}$/.test(value.excerptHash)) {
    return reviewErr(reviewError("invalid_finding"));
  }
  return reviewOk(Object.freeze({ artifactId: artifact.value.id, revisionId: revision.value.id, startLine, endLine, excerptHash: value.excerptHash }));
}
