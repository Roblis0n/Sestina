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
