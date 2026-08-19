import type { ResearchActor } from "@sestina/research";

export const LEGACY_IMPORT_MAPPING_VERSION = "1";

export type LegacyCandidateKind =
  | "project"
  | "contract"
  | "correction"
  | "evidence"
  | "completion";

export interface LegacyCandidateCounts {
  readonly projects: number;
  readonly contracts: number;
  readonly corrections: number;
  readonly evidence: number;
  readonly completion: number;
}

export interface LegacyImportError {
  readonly code:
    | "legacy_source_unavailable"
    | "legacy_source_changed"
    | "legacy_plan_invalid"
    | "legacy_selection_invalid"
    | "legacy_import_conflict"
    | "legacy_import_failed";
  readonly message: string;
}

export interface LegacyScanItem {
  readonly planItemId: string;
  readonly kind: LegacyCandidateKind;
  readonly legacyId: string;
  readonly legacyProjectId?: string;
  readonly sourceDigest: string;
  readonly mappingStatus: "mappable" | "deferred" | "unrecognized";
  readonly targetIds: readonly string[];
}

export interface DeferredLegacyCandidate {
  readonly planItemId: string;
  readonly kind: "evidence" | "completion";
  readonly legacyId: string;
  readonly sourceDigest: string;
  readonly reason: "research_evidence_domain_unavailable" | "episode_acceptance_requires_user";
  readonly authority: "imported_unconfirmed";
}

export interface UnrecognizedLegacyData {
  readonly legacyType: string;
  readonly rowCount: number;
  readonly contentDigest: string;
  readonly reason: "unsupported_legacy_table" | "invalid_legacy_record";
}

export interface LegacyScanResult {
  readonly status: "ready" | "no_content" | "unavailable";
  readonly mappingVersion: string;
  readonly sourceFingerprint: string;
  readonly sourceDatabaseFingerprint: string;
  readonly counts: LegacyCandidateCounts;
  readonly items: readonly LegacyScanItem[];
  readonly deferred: readonly DeferredLegacyCandidate[];
  readonly unrecognized: readonly UnrecognizedLegacyData[];
  readonly error?: LegacyImportError;
}

export interface LegacyImportPlan {
  readonly mappingVersion: string;
  readonly sourceFingerprint: string;
  readonly sourceDatabaseFingerprint: string;
  readonly planHash: string;
  readonly items: readonly LegacyScanItem[];
  readonly deferred: readonly DeferredLegacyCandidate[];
  readonly unrecognized: readonly UnrecognizedLegacyData[];
}

export interface LegacyImportSelection {
  readonly planItemIds: readonly string[];
  readonly selectedBy: ResearchActor;
}

export interface LegacyImportVerificationReport {
  readonly sourceFingerprint: string;
  readonly planHash: string;
  readonly selectionHash: string;
  readonly created: number;
  readonly skipped: number;
  readonly conflicts: number;
  readonly importedIds: readonly string[];
  readonly deferred: readonly DeferredLegacyCandidate[];
  readonly unrecognized: readonly UnrecognizedLegacyData[];
  readonly legacySourceMutated: false;
}

export type LegacyImportExecutionResult =
  | { readonly ok: true; readonly report: LegacyImportVerificationReport }
  | { readonly ok: false; readonly error: LegacyImportError };

export interface LegacyProjectRow {
  readonly projectId: string;
  readonly displayName: string;
  readonly createdAt: string;
  readonly data: string;
}

export interface LegacyContractRow {
  readonly contractId: string;
  readonly taskId: string;
  readonly projectId: string;
  readonly data: string;
}

export interface LegacyCorrectionRow {
  readonly correctionId: string;
  readonly projectId: string;
  readonly taskId?: string;
  readonly data: string;
}

export interface LegacyEvidenceRow {
  readonly evidenceId: string;
  readonly projectId: string;
  readonly taskId?: string;
  readonly data: string;
}

export interface LegacyCompletionRow {
  readonly completionId: string;
  readonly contractId: string;
  readonly projectId: string;
  readonly data: string;
}

export interface LegacySnapshot {
  readonly scan: LegacyScanResult;
  readonly projects: readonly LegacyProjectRow[];
  readonly contracts: readonly LegacyContractRow[];
  readonly corrections: readonly LegacyCorrectionRow[];
  readonly evidence: readonly LegacyEvidenceRow[];
  readonly completions: readonly LegacyCompletionRow[];
}
