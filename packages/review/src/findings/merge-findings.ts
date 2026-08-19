import type { Finding } from "../finding.js";
import type { FindingEvidenceSpan } from "../finding-evidence.js";
import { findingPriority, findingRootCauseKey, type FindingPriority } from "./rank-findings.js";

export interface MergedFinding {
  readonly finding: Finding;
  readonly rawFindingIds: readonly string[];
  readonly criterion: string;
  readonly rootCause: string;
  readonly priority: FindingPriority;
}

function spanKey(span: FindingEvidenceSpan): string {
  return `${span.artifactId}\u0000${span.revisionId}\u0000${span.startLine.toString().padStart(12, "0")}\u0000${span.endLine.toString().padStart(12, "0")}\u0000${span.excerptHash}`;
}

function allSpans(finding: Finding): readonly FindingEvidenceSpan[] { return [...finding.baselineEvidence, ...finding.candidateEvidence]; }

function overlappingSpan(left: Finding, right: Finding): boolean {
  const leftSpans = allSpans(left); const rightSpans = allSpans(right);
  return leftSpans.some((a) => rightSpans.some((b) => a.artifactId === b.artifactId
    && a.revisionId === b.revisionId
    && a.startLine <= b.endLine
    && b.startLine <= a.endLine));
}

function targetKey(finding: Finding): string {
  const target = finding.target;
  return [target.kind, target.artifactId ?? "", target.relativePath ?? "", target.blockId ?? ""].join("\u0000");
}

function criterionKey(finding: Finding): string {
  return finding.kind.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function recoveryKey(finding: Finding): string {
  return finding.minimumRecovery.trim().toLowerCase().replace(/\s+/g, " ");
}

function sameTargetLocation(left: Finding, right: Finding): boolean {
  const leftSpans = allSpans(left); const rightSpans = allSpans(right);
  if (leftSpans.length > 0 && rightSpans.length > 0) return overlappingSpan(left, right);
  return targetKey(left) === targetKey(right);
}

function canMerge(left: MergedFinding, right: Finding): boolean {
  const sameCriterion = left.criterion.split("|").includes(criterionKey(right));
  const sameRecovery = recoveryKey(left.finding) === recoveryKey(right);
  return left.finding.presentation === right.presentation
    && left.rootCause === findingRootCauseKey(right)
    && sameTargetLocation(left.finding, right)
    && (sameCriterion || sameRecovery);
}

function uniqueStrings(values: readonly string[]): readonly string[] { return Object.freeze([...new Set(values)].sort()); }

function uniqueSpans(values: readonly FindingEvidenceSpan[]): readonly FindingEvidenceSpan[] {
  const byKey = new Map<string, FindingEvidenceSpan>();
  for (const value of values) byKey.set(spanKey(value), value);
  return Object.freeze([...byKey.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, value]) => value));
}

function severityRank(finding: Finding): number { return ({ critical: 0, error: 1, warning: 2, info: 3 } as const)[finding.severity]; }
function presentationRank(finding: Finding): number { return ({ foreground: 0, audit_only: 1, suppressed: 2 } as const)[finding.presentation]; }

function primary(left: Finding, right: Finding): Finding {
  const comparison = findingPriority(left) - findingPriority(right)
    || severityRank(left) - severityRank(right)
    || left.id.localeCompare(right.id);
  return comparison <= 0 ? left : right;
}

function combine(left: MergedFinding, right: Finding): MergedFinding {
  const representative = primary(left.finding, right);
  const presentation = presentationRank(left.finding) <= presentationRank(right) ? left.finding.presentation : right.presentation;
  const finding: Finding = Object.freeze({
    ...representative,
    baselineEvidence: uniqueSpans([...left.finding.baselineEvidence, ...right.baselineEvidence]),
    candidateEvidence: uniqueSpans([...left.finding.candidateEvidence, ...right.candidateEvidence]),
    decisionIds: uniqueStrings([...left.finding.decisionIds, ...right.decisionIds]),
    issueIds: uniqueStrings([...left.finding.issueIds, ...right.issueIds]),
    presentation,
  });
  return Object.freeze({
    finding,
    rawFindingIds: uniqueStrings([...left.rawFindingIds, right.id]),
    criterion: uniqueStrings([...left.criterion.split("|"), criterionKey(right)]).join("|"),
    rootCause: left.rootCause,
    priority: findingPriority(finding),
  });
}

function initial(finding: Finding): MergedFinding {
  const rootCause = findingRootCauseKey(finding);
  return Object.freeze({ finding, rawFindingIds: Object.freeze([finding.id]), criterion: criterionKey(finding), rootCause, priority: findingPriority(finding) });
}

export function mergeFindings(findings: readonly Finding[]): readonly MergedFinding[] {
  const merged: MergedFinding[] = [];
  for (const finding of [...findings].sort((left, right) => left.id.localeCompare(right.id))) {
    const index = merged.findIndex((current) => canMerge(current, finding));
    if (index < 0) merged.push(initial(finding));
    else {
      const current = merged[index];
      if (current === undefined) throw new Error("Finding merger index invariant failed");
      merged[index] = combine(current, finding);
    }
  }
  return Object.freeze(merged);
}
