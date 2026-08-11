import { writeFileSync, renameSync, readFileSync, existsSync, unlinkSync } from "node:fs";
import { dirname, resolve as pathResolve } from "node:path";
import { randomUUID } from "node:crypto";
import { SestinaErrorCode, SestinaError } from "@sestina/schema";

export interface WriteConfirmation {
  previewHash: string;
  expectedVersion: number;
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
  // Validate direct user provenance
  if (!confirmation.provenance.directUser) {
    throw new SestinaError(
      SestinaErrorCode.direct_user_confirmation_required,
      "Config changes require direct user confirmation",
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
      `Config directory does not exist: ${dir}`,
    );
  }

  const content = JSON.stringify(newContent, null, 2);
  const tmpPath = pathResolve(dir, `.config-tmp-${randomUUID()}`);

  try {
    // Write to temp file
    writeFileSync(tmpPath, content, { encoding: "utf8", flush: true });

    // Atomic rename
    renameSync(tmpPath, targetPath);
  } catch (err) {
    // Clean up temp file on failure
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch {
      // Best effort cleanup
    }

    throw new SestinaError(
      SestinaErrorCode.internal_error,
      `Failed to write config: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
