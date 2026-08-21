export interface SestinaReleaseContract {
  readonly schemaVersion: "1.0.0";
  readonly package: "@sestina/cli";
  readonly version: "0.1.0";
  readonly nodeRange: ">=24 <25";
  readonly runtimeVersion: "0.1.0";
  readonly reportSchemaVersion: "1.0.0";
  readonly capsuleResponseSchemaVersion: "1.0.0";
  readonly mcpServerVersion: "0.1.0";
  readonly mcpResearchContextSchemaVersion: "1.1";
  readonly checkerBuildContract: "deterministic-review-v1";
}

export interface ReleaseIdentity extends SestinaReleaseContract {
  readonly databaseSchemaVersion: number;
  readonly migrationManifestVersion: string;
  readonly migrationCount: number;
  readonly releaseBuildId: string;
}

export interface SestinaMigrationManifest {
  readonly schemaVersion: string;
  readonly migrations: readonly { readonly version: number; readonly name: string }[];
}

export const SESTINA_RELEASE_CONTRACT: SestinaReleaseContract;
export const SESTINA_MIGRATION_MANIFEST: SestinaMigrationManifest;
export const SESTINA_RELEASE_IDENTITY: ReleaseIdentity;
export function createReleaseIdentity(input?: {
  readonly databaseSchemaVersion: number;
  readonly migrationManifestVersion: string;
  readonly migrationCount: number;
}): ReleaseIdentity;
