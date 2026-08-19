import { describe, expect, it } from "vitest";
import { EXIT_CODES, exitCodeForCoreError } from "../src/exit-codes.js";
import { CLI_HELP, runCli } from "../src/main.js";

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

  it("keeps human help stable and expressed as a research workflow", async () => {
    const stdout: string[] = []; const stderr: string[] = [];
    const code = await runCli(["--help"], { cwd: ".", isTTY: false, stdout: (value) => stdout.push(value), stderr: (value) => stderr.push(value) });
    expect(code).toBe(0);
    expect(stdout.join("")).toBe(CLI_HELP);
    expect(stdout.join("")).toContain("local research revision workflow");
    expect(stderr).toEqual([]);
  });
});
