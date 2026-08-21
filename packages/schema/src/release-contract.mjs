import { createHash } from "node:crypto";
import migrationManifest from "./migration-manifest.json" with { type: "json" };

const PRODUCT_VERSION = "0.1.0";

export const SESTINA_RELEASE_CONTRACT = Object.freeze({
  schemaVersion: "1.0.0",
  package: "@sestina/cli",
  version: PRODUCT_VERSION,
  nodeRange: ">=24 <25",
  runtimeVersion: PRODUCT_VERSION,
  reportSchemaVersion: "1.0.0",
  capsuleResponseSchemaVersion: "1.0.0",
  mcpServerVersion: PRODUCT_VERSION,
  mcpResearchContextSchemaVersion: "1.1",
  checkerBuildContract: "deterministic-review-v1",
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

export function createReleaseIdentity(database = AUTHORITATIVE_DATABASE_INPUT) {
  if (!Number.isSafeInteger(database.databaseSchemaVersion) || database.databaseSchemaVersion < 1) throw new TypeError("invalid_database_schema_version");
  if (!Number.isSafeInteger(database.migrationCount) || database.migrationCount < 1) throw new TypeError("invalid_migration_count");
  if (typeof database.migrationManifestVersion !== "string" || database.migrationManifestVersion.length === 0) throw new TypeError("invalid_migration_manifest_version");
  const inputs = Object.freeze({
    ...SESTINA_RELEASE_CONTRACT,
    databaseSchemaVersion: database.databaseSchemaVersion,
    migrationManifestVersion: database.migrationManifestVersion,
    migrationCount: database.migrationCount,
  });
  const releaseBuildId = createHash("sha256").update(JSON.stringify(inputs), "utf8").digest("hex");
  return Object.freeze({ ...inputs, releaseBuildId });
}

export const SESTINA_RELEASE_IDENTITY = createReleaseIdentity();
