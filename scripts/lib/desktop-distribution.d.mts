export interface DesktopDistribution {
  productName: string;
  appId: string;
  executableName: string;
  storageName: string;
  profile: string;
  baseVersion: string;
  version: string;
  channel: string;
  update: { source?: string; roots: Record<string, string> };
  publicTag?: string;
}
export function desktopDistribution(input: {
  sourceCommit: string;
  target: string;
  version?: string;
  profile?: string;
  tag?: string;
  tagCommit?: string;
  config?: unknown;
}): DesktopDistribution;
export function desktopExecutable(
  identity: { executableName?: string },
  platform: string,
): string;
