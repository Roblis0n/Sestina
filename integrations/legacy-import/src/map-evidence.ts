import type { DeferredLegacyCandidate, LegacyCompletionRow, LegacyEvidenceRow, LegacyScanItem } from "./types.js";

export function mapLegacyEvidenceCandidate(row: LegacyEvidenceRow, item: LegacyScanItem): DeferredLegacyCandidate {
  return Object.freeze({ planItemId: item.planItemId, kind: "evidence", legacyId: row.evidenceId, sourceDigest: item.sourceDigest, reason: "research_evidence_domain_unavailable", authority: "imported_unconfirmed" });
}

export function mapLegacyCompletionCandidate(row: LegacyCompletionRow, item: LegacyScanItem): DeferredLegacyCandidate {
  return Object.freeze({ planItemId: item.planItemId, kind: "completion", legacyId: row.completionId, sourceDigest: item.sourceDigest, reason: "episode_acceptance_requires_user", authority: "imported_unconfirmed" });
}
