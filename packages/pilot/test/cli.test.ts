import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runPilotCli } from "../src/index.js";

const BUILD_ID =
  "86469e5ccc3c3b593084c6207545a4d8bfd1d23f19016d1d63973b49052c3085";
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function capture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stdout: (value: string) => stdout.push(value),
      stderr: (value: string) => stderr.push(value),
    },
    stdout,
    stderr,
  };
}

describe("standalone Pilot CLI", () => {
  it("starts a consented local session without printing its private path", async () => {
    const parent = await mkdtemp(join(tmpdir(), "sestina-pilot-cli-"));
    temporaryRoots.push(parent);
    const privateRoot = join(parent, "pilot-private");
    const output = capture();
    const exitCode = await runPilotCli(
      [
        "session",
        "start",
        "--private-root",
        privateRoot,
        "--participant-code",
        "EXT-0001",
        "--session-ordinal",
        "1",
        "--participant-role",
        "external_researcher",
        "--host-entry",
        "research_room",
        "--material-type",
        "paper",
        "--consent-version",
        "2026-08-30",
        "--consent-acknowledged",
        "true",
        "--release-version",
        "0.2.0",
        "--release-build-id",
        BUILD_ID,
        "--release-channel",
        "public_preview",
        "--release-platform",
        "windows_x64",
        "--distribution-source",
        "github_release",
        "--release-source-commit",
        "2222222222222222222222222222222222222222",
        "--release-asset-sha256",
        "3333333333333333333333333333333333333333333333333333333333333333",
        "--operating-mode",
        "ledger_only",
        "--at",
        "2026-08-21T01:00:00.000Z",
      ],
      output.io,
    );
    expect(exitCode).toBe(0);
    expect(output.stderr).toEqual([]);
    expect(output.stdout.join("" )).not.toContain(privateRoot);
    expect(existsSync(privateRoot)).toBe(true);
  });

  it("returns a stable, content-free error for malformed input", async () => {
    const output = capture();
    const canary = "SYNTHETIC_SECRET_CANARY_SHOULD_NOT_BE_ECHOED";
    const exitCode = await runPilotCli(
      ["session", "show", "--private-root", canary, "--session-id", canary],
      output.io,
    );
    expect(exitCode).toBe(2);
    expect(output.stdout).toEqual([]);
    expect(output.stderr.join("" )).toBe(
      '{"error":"pilot_input_invalid","ok":false}\n',
    );
    expect(output.stderr.join("" )).not.toContain(canary);
  });
});
