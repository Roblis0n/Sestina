import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";

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
    .update(canonicalJson(hashInput))
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

  // Check for removed keys (in current but not in proposed)
  for (const [key, oldValue] of Object.entries(current)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;
    if (!(key in proposed)) {
      // Key removed entirely
      diffs.push({
        path: fullPath,
        kind: "removed",
        oldValue,
      });
    } else if (
      oldValue !== null &&
      typeof oldValue === "object" &&
      !Array.isArray(oldValue)
    ) {
      // Check nested removals within objects that still exist
      const newVal = proposed[key];
      if (
        newVal !== null &&
        typeof newVal === "object" &&
        !Array.isArray(newVal)
      ) {
        diffs.push(
          ...computeDiff(
            oldValue as Record<string, unknown>,
            newVal as Record<string, unknown>,
            fullPath,
          ),
        );
      }
    }
  }

  // Deduplicate entries (computeDiff is called for both proposed and current keys)
  const seen = new Set<string>();
  const deduped: ConfigDiffEntry[] = [];
  for (const entry of diffs) {
    const id = `${entry.path}:${entry.kind}`;
    if (!seen.has(id)) {
      seen.add(id);
      deduped.push(entry);
    }
  }

  // Sort by path for deterministic ordering
  deduped.sort((a, b) => a.path.localeCompare(b.path));

  return deduped;
}
