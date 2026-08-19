import type { Finding } from "../finding.js";
import { mergeFindings, type MergedFinding } from "./merge-findings.js";
import { preservePositive, type PreservedPositiveProjection } from "./preserve-positive.js";
import { rankFindings } from "./rank-findings.js";

export const DEFAULT_FOREGROUND_FINDING_LIMIT = 3;

export interface RawFindingProjection { readonly findingId: string; readonly presentation: Finding["presentation"]; readonly finding: Finding; }
export interface SuppressedFindingProjection { readonly findingId: string; readonly reason: "issue_status_or_duplicate_suppression"; readonly finding: Finding; }
export interface FindingProjectionMetrics {
  readonly rawFindingCount: number; readonly mergedFindingCount: number; readonly foregroundFindingCount: number; readonly suppressedFindingCount: number;
  readonly returnToMainTaskActions: readonly string[]; readonly unnecessaryFindingCount: number;
}
export interface FindingProjection {
  readonly raw: readonly RawFindingProjection[]; readonly merged: readonly MergedFinding[]; readonly foreground: readonly MergedFinding[];
  readonly suppressed: readonly SuppressedFindingProjection[]; readonly auditTrail: readonly MergedFinding[];
  readonly omissions: { readonly mergedOutsideForeground: number; readonly suppressed: number };
  readonly preserved: PreservedPositiveProjection; readonly metrics: FindingProjectionMetrics;
}
export interface FindingProjectionOptions { readonly maxForeground?: number; readonly preservedParts?: readonly string[]; readonly unnecessaryFindingIds?: readonly string[]; }

function maxForeground(value: number | undefined): number {
  if (value === undefined) return DEFAULT_FOREGROUND_FINDING_LIMIT;
  if (!Number.isSafeInteger(value) || value < 0) return DEFAULT_FOREGROUND_FINDING_LIMIT;
  return Math.min(value, DEFAULT_FOREGROUND_FINDING_LIMIT);
}

export function projectFindings(findings: readonly Finding[], options: FindingProjectionOptions = {}): FindingProjection {
  const sortedRaw = [...findings].sort((left, right) => left.id.localeCompare(right.id));
  const rawIds = new Set(sortedRaw.map((finding) => finding.id));
  const unnecessaryFindingCount = new Set((options.unnecessaryFindingIds ?? []).filter((id) => rawIds.has(id))).size;
  const raw = Object.freeze(sortedRaw.map((finding) => Object.freeze({ findingId: finding.id, presentation: finding.presentation, finding })));
  const suppressed = Object.freeze(sortedRaw.filter((finding) => finding.presentation === "suppressed").map((finding) => Object.freeze({ findingId: finding.id, reason: "issue_status_or_duplicate_suppression" as const, finding })));
  const activeMerged = rankFindings(mergeFindings(sortedRaw.filter((finding) => finding.presentation !== "suppressed")));
  const candidates = activeMerged.filter((item) => item.finding.presentation === "foreground");
  const foreground = Object.freeze(candidates.slice(0, maxForeground(options.maxForeground)));
  const foregroundIds = new Set(foreground.map((item) => item.finding.id));
  const auditTrail = Object.freeze(activeMerged.filter((item) => item.finding.presentation === "audit_only" || !foregroundIds.has(item.finding.id)));
  const actions = Object.freeze([...new Set(foreground.map((item) => item.finding.minimumRecovery.trim()).filter((item) => item.length > 0))]);
  return Object.freeze({
    raw,
    merged: activeMerged,
    foreground,
    suppressed,
    auditTrail,
    omissions: Object.freeze({ mergedOutsideForeground: Math.max(0, candidates.length - foreground.length), suppressed: suppressed.length }),
    preserved: preservePositive(options.preservedParts ?? []),
    metrics: Object.freeze({
      rawFindingCount: raw.length,
      mergedFindingCount: activeMerged.length,
      foregroundFindingCount: foreground.length,
      suppressedFindingCount: suppressed.length,
      returnToMainTaskActions: actions,
      unnecessaryFindingCount,
    }),
  });
}

export function selectProjectedFindings(projection: FindingProjection, allFindings: boolean): readonly Finding[] {
  return allFindings ? Object.freeze(projection.raw.map((item) => item.finding)) : Object.freeze(projection.foreground.map((item) => item.finding));
}
