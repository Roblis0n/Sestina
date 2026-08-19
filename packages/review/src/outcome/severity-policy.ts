import type { CoverageStatus } from "./coverage.js";
import type { Finding } from "../finding.js";

const BLOCKING = new Set<CoverageStatus>(["checked_violated", "unproven", "stale", "disputed", "checker_failed"]);
export function isBlockingCoverageStatus(status: CoverageStatus): boolean { return BLOCKING.has(status); }
export function isForegroundFinding(finding: Finding): boolean { return finding.presentation === "foreground"; }

const SEVERITY_ORDER = { critical: 0, error: 1, warning: 2, info: 3 } as const;
export function compareFindingSeverity(left: Finding, right: Finding): number {
  return SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] || left.id.localeCompare(right.id);
}
