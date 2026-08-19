import { describe, expect, it } from "vitest";
import { EXIT_CODES, exitCodeForCoreError } from "../src/exit-codes.js";

describe("CLI exit-code contract", () => {
  it("keeps the published numeric meanings fixed", () => {
    expect(EXIT_CODES).toEqual({
      success: 0,
      invalidInput: 2,
      projectNotInitialized: 3,
      stateConflict: 4,
      reviewBlockingIssue: 5,
      infrastructureFailure: 6,
      userConfirmationRequired: 7,
      unsupportedFormat: 8,
    });
    expect(exitCodeForCoreError("review_blocked")).toBe(5);
    expect(exitCodeForCoreError("unsupported_format")).toBe(8);
  });
});
