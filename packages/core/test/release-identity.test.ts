import { MIGRATIONS, MIGRATION_MANIFEST_VERSION, RUNTIME_VERSION, SCHEMA_VERSION } from "@sestina/storage";
import { CAPSULE_RESPONSE_SCHEMA_VERSION, REVIEW_REPORT_SCHEMA_VERSION } from "@sestina/reports";
import { describe, expect, it } from "vitest";
import { getReleaseIdentity } from "../src/index.js";

describe("Core release identity", () => {
  it("derives schema and migration facts from the production manifest", () => {
    const identity = getReleaseIdentity();
    expect(identity).toMatchObject({
      product: "Sestina Research Room",
      productId: "local-interactive-research-app",
      package: "@sestina/research-room",
      cliPackage: "@sestina/cli",
      primaryInterface: "research-room",
      businessKernel: "research-deliberation-kernel",
      releaseChannel: "private_release_candidate",
      version: "0.2.0-rc.1",
      nodeRange: ">=24 <25",
      runtimeVersion: RUNTIME_VERSION,
      databaseSchemaVersion: SCHEMA_VERSION,
      migrationManifestVersion: MIGRATION_MANIFEST_VERSION,
      migrationCount: MIGRATIONS.length,
      reportSchemaVersion: REVIEW_REPORT_SCHEMA_VERSION,
      capsuleResponseSchemaVersion: CAPSULE_RESPONSE_SCHEMA_VERSION,
      mcpServerVersion: "0.2.0-rc.1",
      mcpResearchContextSchemaVersion: "1.1",
      supportedSchemaMinimum: 16,
      futureSchemaPolicy: "fail_closed",
      downgradeSupported: false,
    });
    expect(identity.migrationManifestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(identity)).toBe(true);
  });
});
