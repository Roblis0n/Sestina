export interface ArchiveEntryInput {
  readonly path: string;
  readonly data: Uint8Array | string;
  readonly mode?: number;
}

export interface ArchiveEntry {
  readonly path: string;
  readonly data: Buffer;
  readonly mode: number;
}

export interface ArchiveLimits {
  readonly maxFiles: number;
  readonly maxTotalBytes: number;
  readonly maxEntryBytes: number;
}

export function validateArchiveEntries(entries: readonly ArchiveEntryInput[], limits?: ArchiveLimits): readonly ArchiveEntry[];
export function createDeterministicTarGzip(outputPath: string, entries: readonly ArchiveEntryInput[]): Promise<void>;
export function createDeterministicZip(outputPath: string, entries: readonly ArchiveEntryInput[]): Promise<void>;
export function inspectTarGzip(inputPath: string, limits?: ArchiveLimits): Promise<readonly ArchiveEntry[]>;
export function inspectZip(inputPath: string, limits?: ArchiveLimits): Promise<readonly ArchiveEntry[]>;
export function extractTarGzip(inputPath: string, outputDirectory: string, limits?: ArchiveLimits): Promise<void>;
export function extractZip(inputPath: string, outputDirectory: string, limits?: ArchiveLimits): Promise<void>;
