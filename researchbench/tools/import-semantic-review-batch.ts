import { submitSemanticReview, type Finding, type ReviewRun, type SemanticReviewRequest, type SemanticReviewResult } from "@sestina/review";

export interface SemanticReviewBatchBinding {
  readonly run: ReviewRun;
  readonly request: SemanticReviewRequest;
}

export interface ImportedSemanticReview {
  readonly customId: string;
  readonly result: SemanticReviewResult<readonly Finding[]>;
}

/** Imports untrusted JSONL responses without persisting or mutating research state. */
export function importSemanticReviewBatch(
  jsonl: string,
  resolve: (customId: string) => SemanticReviewBatchBinding | undefined,
): readonly ImportedSemanticReview[] {
  const seen = new Set<string>();
  return jsonl.split(/\r?\n/).filter((line) => line.trim().length > 0).map((line) => {
    let decoded: unknown;
    try { decoded = JSON.parse(line) as unknown; } catch { throw new Error("invalid semantic review batch JSONL"); }
    if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) throw new Error("invalid semantic review batch row");
    const row = decoded as Record<string, unknown>;
    if (Object.keys(row).sort().join("|") !== "customId|response" || typeof row.customId !== "string" || row.customId.length === 0 || seen.has(row.customId)) throw new Error("invalid semantic review batch row");
    seen.add(row.customId);
    const binding = resolve(row.customId);
    if (binding === undefined) throw new Error("unknown semantic review batch ID");
    return Object.freeze({ customId: row.customId, result: submitSemanticReview(binding.run, binding.request, row.response) });
  });
}
