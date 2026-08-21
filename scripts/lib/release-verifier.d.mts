import type { ArchiveEntry } from "./archive.mjs";

export interface VerifiedRelease {
  readonly manifest: {
    readonly identity: { readonly version: string; readonly releaseBuildId: string; readonly [key: string]: unknown };
    readonly [key: string]: unknown;
  };
  readonly verifiedFiles: readonly string[];
}

export function validateReleaseManifest(manifest: unknown): void;
export function scanReleaseEntries(entries: readonly Pick<ArchiveEntry, "path" | "data">[]): void;
export function parseChecksums(content: string): Map<string, string>;
export function verifyNpmPackageEntries(entries: readonly ArchiveEntry[], manifest: unknown): void;
export function verifyReleaseDirectory(releaseDirectory: string): Promise<VerifiedRelease>;
