import { describe, expect, it } from "vitest";
import { createReleaseIdentity, SESTINA_RELEASE_CONTRACT } from "../src/index.js";

describe("Sestina release contract", () => {
  it("keeps one stable private-preview product identity", () => {
    expect(SESTINA_RELEASE_CONTRACT).toEqual({
      schemaVersion: "1.0.0",
      package: "@sestina/cli",
      version: "0.1.0",
      nodeRange: ">=24 <25",
      runtimeVersion: "0.1.0",
      reportSchemaVersion: "1.0.0",
      capsuleResponseSchemaVersion: "1.0.0",
      mcpServerVersion: "0.1.0",
      mcpResearchContextSchemaVersion: "1.1",
      checkerBuildContract: "deterministic-review-v1",
    });
    expect(Object.isFrozen(SESTINA_RELEASE_CONTRACT)).toBe(true);
  });

  it("derives a deterministic build id only from release inputs", () => {
    const input = { databaseSchemaVersion: 15, migrationManifestVersion: "1.0.0", migrationCount: 15 } as const;
    const first = createReleaseIdentity(input);
    const second = createReleaseIdentity(input);
    expect(first).toEqual(second);
    expect(first.releaseBuildId).toMatch(/^[0-9a-f]{64}$/);
    expect(first.databaseSchemaVersion).toBe(15);
    expect(first.migrationCount).toBe(15);
    expect(createReleaseIdentity({ ...input, migrationCount: 16 }).releaseBuildId).not.toBe(first.releaseBuildId);
  });
});
