import { createHash } from "node:crypto";
import migrationManifest from "./migration-manifest.json" with { type: "json" };

const PRODUCT_VERSION = "0.2.0-rc.1";

export const SESTINA_RELEASE_CONTRACT = Object.freeze({
  schemaVersion: "2.0.0",
  product: "Sestina Research Room",
  productId: "local-interactive-research-app",
  package: "@sestina/research-room",
  cliPackage: "@sestina/cli",
  primaryInterface: "research-room",
  businessKernel: "research-deliberation-kernel",
  releaseChannel: "private_release_candidate",
  version: PRODUCT_VERSION,
  nodeRange: ">=24 <25",
  runtimeVersion: PRODUCT_VERSION,
  reportSchemaVersion: "1.0.0",
  capsuleResponseSchemaVersion: "1.0.0",
  mcpServerVersion: PRODUCT_VERSION,
  mcpResearchContextSchemaVersion: "1.1",
  checkerBuildContract: "deterministic-review-v1",
  supportedSchemaMinimum: 16,
  futureSchemaPolicy: "fail_closed",
  downgradeSupported: false,
});

export const SESTINA_MIGRATION_MANIFEST = Object.freeze({
  schemaVersion: migrationManifest.schemaVersion,
  migrations: Object.freeze(migrationManifest.migrations.map((entry) => Object.freeze({ ...entry }))),
});

const AUTHORITATIVE_DATABASE_INPUT = Object.freeze({
  databaseSchemaVersion: Math.max(...SESTINA_MIGRATION_MANIFEST.migrations.map((entry) => entry.version)),
  migrationManifestVersion: SESTINA_MIGRATION_MANIFEST.schemaVersion,
  migrationCount: SESTINA_MIGRATION_MANIFEST.migrations.length,
});

const MIGRATION_MANIFEST_HASH = createHash("sha256")
  .update(JSON.stringify(SESTINA_MIGRATION_MANIFEST), "utf8")
  .digest("hex");

export function createReleaseIdentity(database = AUTHORITATIVE_DATABASE_INPUT) {
  if (!Number.isSafeInteger(database.databaseSchemaVersion) || database.databaseSchemaVersion < 1) throw new TypeError("invalid_database_schema_version");
  if (!Number.isSafeInteger(database.migrationCount) || database.migrationCount < 1) throw new TypeError("invalid_migration_count");
  if (typeof database.migrationManifestVersion !== "string" || database.migrationManifestVersion.length === 0) throw new TypeError("invalid_migration_manifest_version");
  const inputs = Object.freeze({
    ...SESTINA_RELEASE_CONTRACT,
    databaseSchemaVersion: database.databaseSchemaVersion,
    migrationManifestVersion: database.migrationManifestVersion,
    migrationCount: database.migrationCount,
    migrationManifestHash: MIGRATION_MANIFEST_HASH,
  });
  const releaseBuildId = createHash("sha256").update(JSON.stringify(inputs), "utf8").digest("hex");
  return Object.freeze({ ...inputs, releaseBuildId });
}

export const SESTINA_RELEASE_IDENTITY = createReleaseIdentity();
