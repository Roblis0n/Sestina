import type { CoreErrorCode } from "@sestina/core";

export const EXIT_CODES = Object.freeze({
  success: 0,
  invalidInput: 2,
  projectNotInitialized: 3,
  stateConflict: 4,
  reviewBlockingIssue: 5,
  infrastructureFailure: 6,
  userConfirmationRequired: 7,
  unsupportedFormat: 8,
  operationCancelled: 9,
} as const);

export type CliExitCode = typeof EXIT_CODES[keyof typeof EXIT_CODES];

export function exitCodeForCoreError(code: CoreErrorCode): CliExitCode {
  switch (code) {
    case "invalid_input": return EXIT_CODES.invalidInput;
    case "not_found": return EXIT_CODES.projectNotInitialized;
    case "stale_state":
    case "state_conflict": return EXIT_CODES.stateConflict;
    case "review_blocked": return EXIT_CODES.reviewBlockingIssue;
    case "infrastructure_failure":
    case "projection_write_failure": return EXIT_CODES.infrastructureFailure;
    case "user_confirmation_required": return EXIT_CODES.userConfirmationRequired;
    case "unsupported_format": return EXIT_CODES.unsupportedFormat;
    case "operation_cancelled": return EXIT_CODES.operationCancelled;
  }
}
