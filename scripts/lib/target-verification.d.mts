export function assertExecutedTests(report: unknown): number;
export function canReuseTargetCheck(
  record: unknown,
  binding: unknown,
  evidenceSha256: string,
): boolean;
export function desktopResources(directory: string, platform: string): string;
export function assertDesktopBinary(
  bytes: Buffer,
  platform: string,
  arch: string,
): void;

export const desktopTargets: string[];
export const desktopEvidenceOptions: string[];
export function desktopEvidenceArguments(
  values: Record<string, unknown>,
): string[];
export function assertEvidenceIdentity(record: unknown, binding: unknown): void;
export function assertLifecycleResult(
  record: unknown,
  binding: unknown,
): number;
export function assertReinstallResult(
  record: unknown,
  binding: unknown,
): number;
export function assertReadinessBinding(input: unknown, binding: unknown): void;
export function targetCheckAffected(id: string, paths: string[]): boolean;
export function assertTargetTagIdentity(
  tag: string,
  version: string,
  resolvedCommit: string,
  sourceCommit: string,
): void;
export interface ReleaseAsset {
  target: string;
  role: string;
  name: string;
  sha256: string;
  size: number;
}
export interface ReleaseIndex {
  sourceCommit: string;
  version: string;
  publicTag: string;
  targets: string[];
  assets: ReleaseAsset[];
  [key: string]: unknown;
}
export interface ReleasePackage {
  target: string;
  manifest: string;
  installer: string;
  update: string;
}
export function aggregateTargetResults(results: unknown[]): {
  localPassed: boolean;
  formalAcceptance: string;
  published: boolean;
  remaining: { id: string; status: string }[];
};
export function assembleTargetRelease(
  packages: ReleasePackage[],
  output: string,
): Promise<ReleaseIndex>;
export function inspectTargetRelease(
  directory: string,
  identity: Record<string, unknown>,
): Promise<ReleaseIndex>;
export function verifyPublishedTargetRelease(input: {
  directory: string;
  repository: string;
  identity: Record<string, unknown>;
  output: string;
  runGh?: (args: string[]) => string;
}): Promise<{ passed: boolean }>;
export function assertPublishedInstallations(
  records: { path: string; result: unknown }[],
  index: ReleaseIndex,
  repository: string,
): Promise<void>;
