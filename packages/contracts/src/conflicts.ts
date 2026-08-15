import { createHash } from "node:crypto";
import {
  SestinaError,
  SestinaErrorCode,
  type ContractSourceTier,
  type SourceRef,
} from "@sestina/schema";
import type { MergeOutcome } from "./merge.js";

/**
 * A conflict between two or more concurrent patch proposals that touch the
 * same logical field at the same tier with the same createdAt. There is no
 * tie-breaking rule that can be applied honestly, so the conflict carries
 * the full sources of every side for a human decision. The sides array is
 * always at least two entries; both sides' sources are preserved.
 */
export interface ContractConflict {
  conflictId: string;
  description: string;
  sides: readonly {
    proposalId: string;
    sourceTier: ContractSourceTier;
    sourceRefs: readonly SourceRef[];
    createdAt: string;
  }[];
}

/**
 * Deterministic, order-independent conflict id: the two proposal ids are
 * sorted before hashing, so `(a, b, field)` and `(b, a, field)` collide.
 */
export function buildContractConflictId(
  a: string,
  b: string,
  field: string,
): string {
  const [first, second] = a <= b ? [a, b] : [b, a];
  return createHash("sha256")
    .update(JSON.stringify([first, second, field]))
    .digest("hex");
}

/**
 * Narrows a MergeOutcome to the merged branch; throws contract_conflict with
 * the conflict list (both sides' sources) as details when the outcome is
 * conflicted.
 */
export function assertNoConflicts(
  outcome: MergeOutcome,
): asserts outcome is Extract<MergeOutcome, { kind: "merged" }> {
  if (outcome.kind === "conflicted") {
    throw new SestinaError(
      SestinaErrorCode.contract_conflict,
      "Concurrent contract patches conflict",
      undefined,
      outcome.conflicts,
    );
  }
}
