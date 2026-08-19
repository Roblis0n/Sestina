import { hashCanonical } from "./identity.js";
import type { LegacyImportPlan, LegacyImportVerificationReport } from "./types.js";

export function createVerificationReport(
  plan: LegacyImportPlan,
  selectedIds: readonly string[],
  createdIds: readonly string[],
  skippedIds: readonly string[],
): LegacyImportVerificationReport {
  return Object.freeze({
    sourceFingerprint: plan.sourceFingerprint,
    planHash: plan.planHash,
    selectionHash: hashCanonical([...selectedIds].sort()),
    created: createdIds.length,
    skipped: skippedIds.length,
    conflicts: 0,
    importedIds: Object.freeze([...createdIds].sort()),
    deferred: plan.deferred,
    unrecognized: plan.unrecognized,
    legacySourceMutated: false,
  });
}
