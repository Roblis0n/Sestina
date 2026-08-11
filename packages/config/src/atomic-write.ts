import { writeFileSync, renameSync, readFileSync, existsSync, unlinkSync, copyFileSync } from "node:fs";
import { dirname, resolve as pathResolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { SestinaErrorCode, SestinaError, ActorProvenanceSchema } from "@sestina/schema";

export interface WriteConfirmation {
  previewHash: string;
  expectedVersion: number;
  scope: string;
  provenance: {
    actor: string;
    channel: string;
    directUser: boolean;
    challengeId?: string;
  };
}

export function applyConfirmedConfigChange(
  targetPath: string,
  newContent: unknown,
  confirmation: WriteConfirmation,
): void {
  // Validate provenance shape and rules
  const provenanceResult = ActorProvenanceSchema.safeParse(confirmation.provenance);
  if (!provenanceResult.success) {
    throw new SestinaError(
      SestinaErrorCode.insufficient_confirmation_source,
      `Invalid provenance: ${provenanceResult.error.message}`,
    );
  }

  if (!confirmation.provenance.directUser) {
    throw new SestinaError(
      SestinaErrorCode.direct_user_confirmation_required,
      "Config changes require direct user confirmation",
    );
  }

  // Verify previewHash matches content
  // Hash must match preview.ts structure: {scope, expectedVersion, diff}
  const currentContent: Record<string, unknown> = existsSync(targetPath)
    ? JSON.parse(readFileSync(targetPath, "utf8")) as Record<string, unknown>
    : {};
  const proposedContent = newContent as Record<string, unknown>;
  const verifyDiff = computeSimpleDiff(currentContent, proposedContent);
  const actualHash = createHash("sha256")
    .update(JSON.stringify({
      scope: confirmation.scope,
      expectedVersion: confirmation.expectedVersion,
      diff: verifyDiff,
    }))
    .digest("hex");
  if (actualHash !== confirmation.previewHash) {
    throw new SestinaError(
      SestinaErrorCode.preview_changed,
      "Config content does not match preview hash",
    );
  }

  // Check expected version if file exists
  if (existsSync(targetPath)) {
    const current: Record<string, unknown> = JSON.parse(readFileSync(targetPath, "utf8")) as Record<string, unknown>;
    const currentVersion = current.version ?? 0;

    if (typeof currentVersion === "number" && currentVersion !== confirmation.expectedVersion) {
      throw new SestinaError(
        SestinaErrorCode.config_version_conflict,
        `Expected version ${confirmation.expectedVersion} but current is ${currentVersion}`,
      );
    }
  } else if (confirmation.expectedVersion !== 0) {
    throw new SestinaError(
      SestinaErrorCode.config_version_conflict,
      `Expected version ${confirmation.expectedVersion} but file does not exist`,
    );
  }

  const dir = dirname(targetPath);

  // Directory must already exist (caller's responsibility)
  if (!existsSync(dir)) {
    throw new SestinaError(
      SestinaErrorCode.internal_error,
      "Config directory does not exist",
    );
  }

  const content = JSON.stringify(newContent, null, 2);
  const tmpPath = pathResolve(dir, `.config-tmp-${randomUUID()}`);
  const backupPath = pathResolve(dir, `.config-backup-${randomUUID()}`);

  try {
    // Create backup of current config before overwrite
    if (existsSync(targetPath)) {
      copyFileSync(targetPath, backupPath);
    }

    // Write to temp file
    writeFileSync(tmpPath, content, { encoding: "utf8", flush: true });

    // Atomic rename
    renameSync(tmpPath, targetPath);
  } catch {
    // Clean up temp file on failure
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch {
      // Best effort cleanup
    }

    throw new SestinaError(
      SestinaErrorCode.internal_error,
      "Failed to write config",
    );
  }
}

interface SimpleDiffEntry {
  path: string;
  kind: "added" | "removed" | "changed";
  oldValue?: unknown;
  newValue?: unknown;
}

function computeSimpleDiff(
  current: Record<string, unknown>,
  proposed: Record<string, unknown>,
  prefix = "",
): SimpleDiffEntry[] {
  const entries: SimpleDiffEntry[] = [];
  const allKeys = new Set([...Object.keys(current), ...Object.keys(proposed)]);

  for (const key of [...allKeys].sort()) {
    const fullPath = prefix ? `${prefix}.${key}` : key;
    const oldV = current[key];
    const newV = proposed[key];

    if (!(key in current)) {
      entries.push({ path: fullPath, kind: "added", newValue: newV });
    } else if (!(key in proposed)) {
      entries.push({ path: fullPath, kind: "removed", oldValue: oldV });
    } else if (
      newV !== null && typeof newV === "object" && !Array.isArray(newV) &&
      oldV !== null && typeof oldV === "object" && !Array.isArray(oldV)
    ) {
      entries.push(
        ...computeSimpleDiff(
          oldV as Record<string, unknown>,
          newV as Record<string, unknown>,
          fullPath,
        ),
      );
    } else if (JSON.stringify(oldV) !== JSON.stringify(newV)) {
      entries.push({
        path: fullPath,
        kind: "changed",
        oldValue: oldV,
        newValue: newV,
      });
    }
  }

  entries.sort((a, b) => a.path.localeCompare(b.path));
  return entries;
}
