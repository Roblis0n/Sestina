import { createHash } from "node:crypto";

export interface ConfigDiffEntry {
  path: string;
  kind: "added" | "removed" | "changed";
  oldValue?: unknown;
  newValue?: unknown;
}

export interface PreviewResult {
  previewHash: string;
  diff: ConfigDiffEntry[];
  scope: string;
  expectedVersion: number;
}

export interface PreviewOptions {
  scope: string;
  expectedVersion: number;
}

export function previewConfigChange(
  current: Record<string, unknown>,
  proposed: Record<string, unknown>,
  options: PreviewOptions,
): PreviewResult {
  // Compute deterministic diff
  const diff = computeDiff(current, proposed);

  // Build canonical hash input
  const hashInput = {
    scope: options.scope,
    expectedVersion: options.expectedVersion,
    diff,
  };

  const previewHash = createHash("sha256")
    .update(JSON.stringify(hashInput))
    .digest("hex");

  return {
    previewHash,
    diff,
    scope: options.scope,
    expectedVersion: options.expectedVersion,
  };
}

function computeDiff(
  current: Record<string, unknown>,
  proposed: Record<string, unknown>,
  prefix = "",
): ConfigDiffEntry[] {
  const diffs: ConfigDiffEntry[] = [];

  // Check all proposed keys
  for (const [key, newValue] of Object.entries(proposed)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;
    const oldValue = current[key];

    if (newValue !== null && typeof newValue === "object" && !Array.isArray(newValue)) {
      // Recurse into nested objects
      const oldObj =
        oldValue !== null && typeof oldValue === "object" && !Array.isArray(oldValue)
          ? (oldValue as Record<string, unknown>)
          : {};
      diffs.push(...computeDiff(oldObj, newValue as Record<string, unknown>, fullPath));
    } else if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      // Changed leaf
      diffs.push({
        path: fullPath,
        kind: oldValue === undefined ? "added" : "changed",
        oldValue,
        newValue,
      });
    }
  }

  // Sort by path for deterministic ordering
  diffs.sort((a, b) => a.path.localeCompare(b.path));

  return diffs;
}
