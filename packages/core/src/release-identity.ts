import { SESTINA_RELEASE_IDENTITY, type ReleaseIdentity } from "@sestina/schema";
import { MIGRATIONS, MIGRATION_MANIFEST_VERSION, RUNTIME_VERSION, SCHEMA_VERSION } from "@sestina/storage";
import { CAPSULE_RESPONSE_SCHEMA_VERSION, REVIEW_REPORT_SCHEMA_VERSION } from "@sestina/reports";

function sameValue(left: unknown, right: unknown): boolean { return left === right; }

if (!sameValue(SESTINA_RELEASE_IDENTITY.databaseSchemaVersion, SCHEMA_VERSION)
  || !sameValue(SESTINA_RELEASE_IDENTITY.migrationCount, MIGRATIONS.length)
  || !sameValue(SESTINA_RELEASE_IDENTITY.migrationManifestVersion, MIGRATION_MANIFEST_VERSION)
  || !sameValue(SESTINA_RELEASE_IDENTITY.runtimeVersion, RUNTIME_VERSION)
  || !sameValue(SESTINA_RELEASE_IDENTITY.reportSchemaVersion, REVIEW_REPORT_SCHEMA_VERSION)
  || !sameValue(SESTINA_RELEASE_IDENTITY.capsuleResponseSchemaVersion, CAPSULE_RESPONSE_SCHEMA_VERSION)) {
  throw new Error("Release identity does not match the production runtime.");
}

export const RELEASE_IDENTITY: ReleaseIdentity = SESTINA_RELEASE_IDENTITY;

export function getReleaseIdentity(): ReleaseIdentity {
  return RELEASE_IDENTITY;
}
