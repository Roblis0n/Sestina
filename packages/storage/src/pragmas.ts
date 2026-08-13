import { DatabaseSync } from "node:sqlite";
import { SestinaError, SestinaErrorCode } from "@sestina/schema";

export const DEFAULT_BUSY_TIMEOUT_MS = 1000;

export interface SecurityPragmaOptions {
  busyTimeoutMs?: number;
  /** False for read-only connections (WAL mode change requires a write). */
  writable?: boolean;
}

/**
 * Applies the documented per-connection baseline (docs/17 §3.1):
 * WAL, foreign_keys=ON, busy_timeout, synchronous=NORMAL,
 * trusted_schema=OFF, defensive mode, and extension loading stays disabled.
 */
export function applySecurityPragmas(
  raw: DatabaseSync,
  options: SecurityPragmaOptions = {},
): void {
  const busyTimeoutMs = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
  if (busyTimeoutMs < 0 || !Number.isInteger(busyTimeoutMs)) {
    throw new SestinaError(SestinaErrorCode.validation_failed, "busyTimeoutMs must be a non-negative integer");
  }

  if (options.writable !== false) {
    const row = raw.prepare("PRAGMA journal_mode=WAL").get() as
      | { journal_mode?: string }
      | undefined;
    if (row?.journal_mode !== "wal") {
      throw new SestinaError(
        SestinaErrorCode.internal_error,
        "WAL journal mode could not be enabled",
      );
    }
    // synchronous is a persistent setting and setting it touches database
    // pages — skip it on read-only diagnostic connections.
    raw.exec("PRAGMA synchronous=NORMAL");
  }

  raw.exec(`PRAGMA busy_timeout=${busyTimeoutMs}`);
  raw.exec("PRAGMA trusted_schema=OFF");
  raw.exec("PRAGMA foreign_keys=ON");
  // SQLite defensive mode (PRAGMA defensive is not reliable on this build;
  // the documented C API is). Blocks writes to sqlite_schema.
  raw.enableDefensive(true);
  // Extension loading: never enabled. The connection is created without
  // allowExtension, which makes it permanently disabled.
}
