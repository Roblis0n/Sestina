import { parseMarkdownStructure, type MarkdownBlock } from "./markdown-structure.js";
import { cloneReviewValue, reviewErr, reviewOk, type ReviewResult } from "../review-result.js";

export type BlockChangeOperation = "add" | "delete" | "rewrite" | "data_replace" | "move";
export interface BlockChange {
  readonly operation: BlockChangeOperation; readonly blockId: string; readonly heading?: string;
  readonly baseline?: MarkdownBlock; readonly candidate?: MarkdownBlock;
}
export interface BlockDiff { readonly changes: readonly BlockChange[]; readonly scopeUnknown: boolean; readonly unknownReason?: "heading_location_changed"; }

export function diffMarkdownBlocks(baselineMarkdown: string, candidateMarkdown: string): ReviewResult<BlockDiff> {
  const baseline = parseMarkdownStructure(baselineMarkdown); const candidate = parseMarkdownStructure(candidateMarkdown);
  if (!baseline.ok) return reviewErr(baseline.error);
  if (!candidate.ok) return reviewErr(candidate.error);
  const headingRename = baseline.value.headings.length === candidate.value.headings.length && baseline.value.headings.some((heading, index) => {
    const other = candidate.value.headings[index]; return other !== undefined && heading.level === other.level && heading.title !== other.title;
  });
  if (headingRename) return reviewOk(cloneReviewValue({ changes: [], scopeUnknown: true, unknownReason: "heading_location_changed" as const }));

  const beforeUsed = new Set<string>(); const afterUsed = new Set<string>(); const changes: BlockChange[] = [];
  for (const before of baseline.value.blocks) {
    const matches = candidate.value.blocks.filter((after) => after.contentHash === before.contentHash);
    const moved = matches.find((after) => after.id !== before.id && !afterUsed.has(after.id));
    if (moved) {
      beforeUsed.add(before.id); afterUsed.add(moved.id);
      changes.push({ operation: "move", blockId: before.id, ...(moved.heading ? { heading: moved.heading } : {}), baseline: before, candidate: moved });
    }
  }
  for (const before of baseline.value.blocks) {
    if (beforeUsed.has(before.id)) continue;
    const after = candidate.value.blocks.find((value) => value.id === before.id && !afterUsed.has(value.id));
    if (!after) continue;
    beforeUsed.add(before.id); afterUsed.add(after.id);
    if (before.contentHash !== after.contentHash) changes.push({ operation: before.type === "data" && after.type === "data" ? "data_replace" : "rewrite", blockId: before.id, ...(after.heading ? { heading: after.heading } : {}), baseline: before, candidate: after });
  }
  for (const before of baseline.value.blocks) if (!beforeUsed.has(before.id)) changes.push({ operation: "delete", blockId: before.id, ...(before.heading ? { heading: before.heading } : {}), baseline: before });
  for (const after of candidate.value.blocks) if (!afterUsed.has(after.id)) changes.push({ operation: "add", blockId: after.id, ...(after.heading ? { heading: after.heading } : {}), candidate: after });
  changes.sort((left, right) => (left.candidate?.startLine ?? left.baseline?.startLine ?? 0) - (right.candidate?.startLine ?? right.baseline?.startLine ?? 0) || left.blockId.localeCompare(right.blockId));
  return reviewOk(cloneReviewValue({ changes, scopeUnknown: false }));
}
