export interface DesktopRequirement {
  id: string;
  target: string;
  cases: string[];
}

export interface DesktopReadinessResult {
  schema: 1;
  scope: "remaining_g10_g11_evidence_only";
  sourceCommit: string | null;
  remainingPrerequisitesSatisfied: boolean;
  g12Acceptance: "not_executed";
  g13Cutover: "not_executed";
  errors: string[];
  checks: Array<{
    id: string;
    status: "passed" | "not_established";
    reason?: string;
    observationSha256?: string;
  }>;
}

export const remainingDesktopRequirements: DesktopRequirement[];
export function fileSha256(path: string): string;
export function inspectDesktopReadiness(
  input: unknown,
  baseDirectory?: string,
): DesktopReadinessResult;
