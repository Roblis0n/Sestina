export interface SestinaReleaseContract {
  readonly schemaVersion: "2.0.0";
  readonly product: "Sestina Research Room";
  readonly productId: "local-interactive-research-app";
  readonly package: "@sestina/research-room";
  readonly cliPackage: "@sestina/cli";
  readonly primaryInterface: "research-room";
  readonly businessKernel: "research-deliberation-kernel";
  readonly releaseChannel: "public_preview";
  readonly version: "0.2.0";
  readonly nodeRange: ">=24 <25";
  readonly runtimeVersion: "0.2.0";
  readonly reportSchemaVersion: "1.0.0";
  readonly capsuleResponseSchemaVersion: "1.0.0";
  readonly mcpServerVersion: "0.2.0";
  readonly mcpResearchContextSchemaVersion: "1.1";
  readonly checkerBuildContract: "deterministic-review-v1";
  readonly supportedSchemaMinimum: 16;
  readonly futureSchemaPolicy: "fail_closed";
  readonly downgradeSupported: false;
}

export interface ReleaseIdentity extends SestinaReleaseContract {
  readonly databaseSchemaVersion: number;
  readonly migrationManifestVersion: string;
  readonly migrationCount: number;
  readonly migrationManifestHash: string;
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
