import { MIGRATIONS, MIGRATION_MANIFEST_VERSION, RUNTIME_VERSION, SCHEMA_VERSION } from "@sestina/storage";
import { CAPSULE_RESPONSE_SCHEMA_VERSION, REVIEW_REPORT_SCHEMA_VERSION } from "@sestina/reports";
import { describe, expect, it } from "vitest";
import { getReleaseIdentity } from "../src/index.js";

describe("Core release identity", () => {
  it("derives schema and migration facts from the production manifest", () => {
    const identity = getReleaseIdentity();
    expect(identity).toMatchObject({
      package: "@sestina/cli",
      version: "0.1.0",
      nodeRange: ">=24 <25",
      runtimeVersion: RUNTIME_VERSION,
      databaseSchemaVersion: SCHEMA_VERSION,
      migrationManifestVersion: MIGRATION_MANIFEST_VERSION,
      migrationCount: MIGRATIONS.length,
      reportSchemaVersion: REVIEW_REPORT_SCHEMA_VERSION,
      capsuleResponseSchemaVersion: CAPSULE_RESPONSE_SCHEMA_VERSION,
      mcpServerVersion: "0.1.0",
      mcpResearchContextSchemaVersion: "1.1",
    });
    expect(Object.isFrozen(identity)).toBe(true);
  });
});
