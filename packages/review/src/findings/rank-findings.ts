import type { Finding, FindingSeverity } from "../finding.js";
import type { MergedFinding } from "./merge-findings.js";

export type FindingPriority = 1 | 2 | 3 | 4 | 5;

const SEVERITY_ORDER: Readonly<Record<FindingSeverity, number>> = Object.freeze({ critical: 0, error: 1, warning: 2, info: 3 });

function normalizedKind(finding: Finding): string {
  return finding.kind.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function findingRootCauseKey(finding: Finding): string {
  const kind = normalizedKind(finding);
  if (/(focus|target|question|object)_substitution|user_authority|authority_violation|audit_hijack/.test(kind)) return "target_substitution_or_authority";
  if (/scope|data_boundary|data_scope|revision_violation|wrong_revision|stale_revision|privacy/.test(kind)) return "scope_data_or_revision";
  if (/causal|causality/.test(kind)) return "causal_evidence_boundary";
  if (/fresh|stale_(source|evidence)|superseded_evidence/.test(kind)) return "evidence_freshness";
  if (/mechanism.*evidence|evidence.*mechanism/.test(kind)) return "mechanism_evidence_boundary";
  if (/evidence|citation|source_support|claim_support/.test(kind)) return "claim_evidence_boundary";
  if (/expected_delta|argument_delta|shallow_abstraction|delta_unmet|missing_delta/.test(kind)) return "expected_argument_delta";
  return kind.replace(/_\d+$/g, "") || "other";
}

export function findingPriority(finding: Finding): FindingPriority {
  const root = findingRootCauseKey(finding);
  if (root === "target_substitution_or_authority") return 1;
  if (root === "scope_data_or_revision") return 2;
  if (["causal_evidence_boundary", "evidence_freshness", "mechanism_evidence_boundary", "claim_evidence_boundary"].includes(root)) return 3;
  if (root === "expected_argument_delta") return 4;
  return 5;
}

export function compareMergedFindings(left: MergedFinding, right: MergedFinding): number {
  return left.priority - right.priority
    || SEVERITY_ORDER[left.finding.severity] - SEVERITY_ORDER[right.finding.severity]
    || left.finding.id.localeCompare(right.finding.id);
}

export function rankFindings(findings: readonly MergedFinding[]): readonly MergedFinding[] {
  return Object.freeze([...findings].sort(compareMergedFindings));
}
