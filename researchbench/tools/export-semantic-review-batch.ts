import type { SemanticReviewRequest } from "@sestina/review";

export interface SemanticReviewBatchRequest {
  readonly customId: string;
  readonly request: SemanticReviewRequest;
}

/** Offline JSONL export only. Execution belongs to the host, a local model, or user-owned BYOK tooling. */
export function exportSemanticReviewBatch(entries: readonly SemanticReviewBatchRequest[]): string {
  const ids = new Set<string>();
  return entries.map((entry) => {
    if (typeof entry.customId !== "string" || entry.customId.trim().length === 0 || ids.has(entry.customId)) throw new Error("invalid semantic review batch ID");
    ids.add(entry.customId);
    return JSON.stringify({ customId: entry.customId, protocolVersion: "1.0.0", request: entry.request });
  }).join("\n");
}
