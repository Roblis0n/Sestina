import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SestinaError, SestinaErrorCode } from "@sestina/schema";
import { sqliteErrcode, SQLITE_CORRUPT, SQLITE_NOTADB } from "./errors.js";

export type IntegrityCheckMode = "quick" | "full";

export interface IntegrityResult {
  ok: boolean;
  error?: string;
}

/**
 * Runs SQLite quick_check (or integrity_check) on a database file
 * (docs/19 §5.3). Never modifies the file: the handle is opened read-only.
 */
export function checkDatabaseIntegrity(
  path: string,
  mode: IntegrityCheckMode = "quick",
): IntegrityResult {
  if (!existsSync(path)) {
    return { ok: false, error: "Database file not found" };
  }
  let temporaryRoot: string | undefined;
  try {
    let sqlitePath = path;
    if (process.platform === "win32" && resolve(path).length >= 240) {
      temporaryRoot = mkdtempSync(join(tmpdir(), "sestina-integrity-"));
      sqlitePath = join(temporaryRoot, "database.sqlite");
      copyFileSync(path, sqlitePath);
    }
    let raw: DatabaseSync;
    try {
      raw = new DatabaseSync(sqlitePath, { open: true, readOnly: true });
    } catch {
      return { ok: false, error: "Database file could not be opened" };
    }
    try {
    const pragma = mode === "full" ? "integrity_check" : "quick_check";
    const rows = raw.prepare(`PRAGMA ${pragma}`).all() as Record<string, unknown>[];
    if (rows.length === 0) {
      return { ok: false, error: "Integrity check returned no rows" };
    }
    const ok = rows.every((row) =>
      Object.values(row).every((value) => value === "ok"),
    );
    return ok ? { ok: true } : { ok: false, error: "Integrity check reported errors" };
    } catch (err) {
      // Never leak native SQLite text into diagnostics (docs/17 §9).
      switch (sqliteErrcode(err)) {
        case SQLITE_NOTADB:
          return { ok: false, error: "The file is not a SQLite database" };
        case SQLITE_CORRUPT:
          return { ok: false, error: "The database appears to be corrupted" };
        default:
          return { ok: false, error: "Integrity check failed" };
      }
    } finally {
      raw.close();
    }
  } finally {
    if (temporaryRoot !== undefined) rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

/**
 * Verifies a database is healthy; throws database_corrupt otherwise.
 * Callers use this before restore/backup decisions (docs/19 §5.3).
 */
export function assertDatabaseHealthy(path: string, mode: IntegrityCheckMode = "quick"): void {
  const result = checkDatabaseIntegrity(path, mode);
  if (!result.ok) {
    throw new SestinaError(
      SestinaErrorCode.database_corrupt,
      "Database failed the integrity check",
    );
  }
}
