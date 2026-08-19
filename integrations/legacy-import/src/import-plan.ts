import { hashCanonical } from "./identity.js";
import type { LegacyImportPlan, LegacyScanResult } from "./types.js";

export function createLegacyImportPlan(scan: LegacyScanResult): LegacyImportPlan {
  const body = {
    mappingVersion: scan.mappingVersion,
    sourceFingerprint: scan.sourceFingerprint,
    sourceDatabaseFingerprint: scan.sourceDatabaseFingerprint,
    items: scan.items,
    deferred: scan.deferred,
    unrecognized: scan.unrecognized,
  };
  return Object.freeze({ ...body, planHash: hashCanonical(body) });
}

export function verifyLegacyImportPlan(plan: LegacyImportPlan): boolean {
  const { planHash: _ignored, ...body } = plan;
  return hashCanonical(body) === plan.planHash;
}
