export interface ContractVerificationError {
  readonly check: string;
  readonly message: string;
}

export interface ContractVerificationResult {
  readonly ok: boolean;
  readonly repoRoot: string;
  readonly contractsRoot: string;
  readonly errors: readonly ContractVerificationError[];
  readonly summary: {
    readonly contracts: readonly string[];
    readonly failedCheckKinds: readonly string[];
    readonly verdict: "PASSED" | "FAILED";
  };
}

export interface ContractVerificationOptions {
  readonly repoRoot?: string;
  readonly contractsRoot?: string;
}

export const CHECKS: Readonly<Record<string, string>> & {
  readonly ABSOLUTE_PATH: string;
  readonly CROSS_EFFECT_REVISION: string;
  readonly CV_EVIDENCE_EXISTS: string;
  readonly CV_RESOLVED: string;
  readonly EFFECT_AUTHORITY: string;
  readonly FORBIDDEN_TOKEN: string;
  readonly MANIFEST_CANONICALIZATION: string;
  readonly MANIFEST_HASH: string;
  readonly REVIEW_UNKNOWN_STATE: string;
};

export const CONTRACT_DIR: string;
export const REQUIRED_CONTRACTS: readonly string[];
export const REQUIRED_RECORDS: readonly string[];

export function validateContracts(
  options?: ContractVerificationOptions,
): ContractVerificationResult;

export function formatVerificationResult(
  result: ContractVerificationResult,
): string;
