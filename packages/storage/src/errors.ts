import { SestinaError, SestinaErrorCode } from "@sestina/schema";

// ── SQLite primary result codes we classify (node:sqlite exposes errcode) ──
export const SQLITE_ERROR = 1;
export const SQLITE_CONSTRAINT_UNIQUE = 2067;
export const SQLITE_BUSY = 5;
export const SQLITE_LOCKED = 6;
export const SQLITE_READONLY = 8;
export const SQLITE_CORRUPT = 11;
export const SQLITE_FULL = 13;
export const SQLITE_NOTADB = 26;

export interface SqliteErrorShape {
  errcode?: number;
}

export function sqliteErrcode(err: unknown): number | undefined {
  return err instanceof Error ? (err as Error & SqliteErrorShape).errcode : undefined;
}

/**
 * Maps a native SQLite failure to a stable SestinaError.
 * The native SQLite text is never embedded into the stable message.
 */
export function mapSqliteError(err: unknown, message: string): SestinaError {
  switch (sqliteErrcode(err)) {
    case SQLITE_CONSTRAINT_UNIQUE:
      return new SestinaError(SestinaErrorCode.idempotency_violation, message);
    case SQLITE_BUSY:
    case SQLITE_LOCKED:
      return new SestinaError(SestinaErrorCode.storage_busy, message);
    case SQLITE_CORRUPT:
    case SQLITE_NOTADB:
      return new SestinaError(SestinaErrorCode.database_corrupt, message);
    case SQLITE_READONLY:
      return new SestinaError(SestinaErrorCode.database_readonly, message);
    case SQLITE_FULL:
      return new SestinaError(SestinaErrorCode.disk_full, message);
    default:
      return new SestinaError(SestinaErrorCode.internal_error, message);
  }
}
