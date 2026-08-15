import {
  SestinaError,
  SestinaErrorCode,
  type TaskContract,
} from "@sestina/schema";

/**
 * Asserts that `expectedVersion` matches the contract's current version.
 * A mismatch means the caller was working from a stale contract preview and
 * must re-read before applying a patch.
 */
export function assertExpectedVersion(
  contract: TaskContract,
  expectedVersion: number,
): void {
  if (contract.version !== expectedVersion) {
    throw new SestinaError(
      SestinaErrorCode.contract_version_mismatch,
      "Contract version mismatch",
      undefined,
      { actual: contract.version, expected: expectedVersion },
    );
  }
}

/**
 * The version a successful apply produces: exactly one version per apply.
 */
export function nextContractVersion(contract: TaskContract): number {
  return contract.version + 1;
}
