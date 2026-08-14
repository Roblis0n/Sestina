import { randomUUID } from "node:crypto";
import { mkdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SestinaError, SestinaErrorCode } from "@sestina/schema";
import { SQLITE_BUSY, SQLITE_LOCKED, sqliteErrcode } from "./errors.js";

export const MAINTENANCE_LOCK_DB_NAME = ".sestina-maintenance.sqlite";
export const DEFAULT_MAINTENANCE_BUSY_TIMEOUT_MS = 2000;

export interface MaintenanceGuardOptions {
  /** The database path the maintenance domain derives from. */
  databasePath: string;
  /** Diagnostic scope: migrations | restore | retention | exports. */
  scope: string;
  /** Logical owner label for diagnostics. */
  ownerId: string;
  busyTimeoutMs?: number;
}

/**
 * Canonical maintenance root: the realpath-resolved directory of the
 * database file. Every maintenance operation (migrations, restore,
 * retention, exports) derives its mutex from THIS root — never from a
 * caller-provided value — so two operations on the same database can
 * never land on different lock files (docs/17 §3.2).
 */
export function maintenanceRootOf(databasePath: string): string {
  const absolute = resolve(databasePath);
  let parent: string;
  try {
    parent = realpathSync(dirname(absolute));
  } catch (err) {
    throw mapMaintenanceFsError(err, "Maintenance root is not accessible");
  }
  return parent;
}

export function maintenanceLockDbPath(databasePath: string): string {
  return join(maintenanceRootOf(databasePath), MAINTENANCE_LOCK_DB_NAME);
}

const BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS maintenance_holds (
  name TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  token TEXT NOT NULL,
  scope TEXT NOT NULL,
  pid INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  heartbeat_at INTEGER NOT NULL
) STRICT;`;

/**
 * Cross-process maintenance mutex backed by a companion SQLite lock
 * database (docs/17 §3.2, docs/22 Task 5/6):
 *
 * - The guard holds BEGIN EXCLUSIVE on a dedicated connection for the
 *   ENTIRE maintenance operation — no expiry, no takeover, no ABA, and no
 *   renew discipline required for operations longer than a TTL.
 * - A crashed or forcibly killed process releases the lock automatically
 *   when the OS closes its file handles — takeover-after-crash is free.
 * - The hold row is diagnostics only; ownership is the SQLite write lock
 *   itself, which is a real process-level CAS primitive.
 */
export class MaintenanceGuard {
  private readonly raw: DatabaseSync;
  private readonly name: string;
  private held = true;

  private constructor(raw: DatabaseSync, name: string) {
    this.raw = raw;
    this.name = name;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  static async acquire(options: MaintenanceGuardOptions): Promise<MaintenanceGuard> {
    const lockDbPath = maintenanceLockDbPath(options.databasePath);
    mkdirSync(dirname(lockDbPath), { recursive: true });
    const raw = new DatabaseSync(lockDbPath, { open: true });
    raw.exec(`PRAGMA busy_timeout=${options.busyTimeoutMs ?? DEFAULT_MAINTENANCE_BUSY_TIMEOUT_MS}`);
    const token = randomUUID();
    const now = Date.now();
    try {
      raw.exec("BEGIN EXCLUSIVE");
      raw.exec(BOOTSTRAP_SQL);
      raw.prepare(
        `INSERT INTO maintenance_holds (name, owner_id, token, scope, pid, started_at, heartbeat_at)
         VALUES ('maintenance', ?, ?, ?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET
           owner_id = excluded.owner_id,
           token = excluded.token,
           scope = excluded.scope,
           pid = excluded.pid,
           started_at = excluded.started_at,
           heartbeat_at = excluded.heartbeat_at`,
      ).run(options.ownerId, token, options.scope, process.pid, now, now);
      return new MaintenanceGuard(raw, "maintenance");
    } catch (err) {
      const errcode = sqliteErrcode(err);
      raw.close();
      if (errcode === SQLITE_BUSY || errcode === SQLITE_LOCKED) {
        throw new SestinaError(
          SestinaErrorCode.storage_busy,
          "Maintenance lock is held by another owner",
        );
      }
      throw mapMaintenanceFsError(err, "Failed to acquire the maintenance lock");
    }
  }

  /** Reads the diagnostic hold row (never used for ownership decisions). */
  static peek(databasePath: string): { ownerId: string; scope: string; pid: number } | undefined {
    const lockDbPath = maintenanceLockDbPath(databasePath);
    let raw: DatabaseSync;
    try {
      raw = new DatabaseSync(lockDbPath, { open: true, readOnly: true });
    } catch {
      return undefined;
    }
    try {
      const row = raw
        .prepare("SELECT owner_id, scope, pid FROM maintenance_holds WHERE name = 'maintenance'")
        .get() as { owner_id: string; scope: string; pid: number } | undefined;
      if (!row) return undefined;
      return { ownerId: row.owner_id, scope: row.scope, pid: row.pid };
    } catch {
      return undefined;
    } finally {
      raw.close();
    }
  }

  /** Refreshes the diagnostics heartbeat (ownership never depends on it). */
  heartbeat(): void {
    this.assertHeld();
    try {
      this.raw
        .prepare("UPDATE maintenance_holds SET heartbeat_at = ? WHERE name = ?")
        .run(Date.now(), this.name);
    } catch (err) {
      throw mapMaintenanceFsError(err, "Failed to update the maintenance lock");
    }
  }

  /** Releases the lock (idempotent); a killed process never needs this. */
  release(): void {
    if (!this.held) return;
    this.held = false;
    try {
      this.raw.prepare("DELETE FROM maintenance_holds WHERE name = ?").run(this.name);
      this.raw.exec("COMMIT");
    } catch {
      // Best effort — closing the connection releases the lock anyway.
    }
    try {
      this.raw.close();
    } catch {
      // Already closed by the OS (killed process).
    }
  }

  private assertHeld(): void {
    if (!this.held) {
      throw new SestinaError(SestinaErrorCode.stale_state, "Maintenance lock is released");
    }
  }
}

function mapMaintenanceFsError(err: unknown, message: string): SestinaError {
  if (err instanceof SestinaError) return err;
  return new SestinaError(SestinaErrorCode.internal_error, message);
}

/** Maps native fs errors to stable SestinaErrors without leaking OS text. */
export function mapFsError(err: unknown, message: string): SestinaError {
  if (err instanceof SestinaError) return err;
  const code = (err as { code?: unknown }).code;
  if (code === "ENOENT") {
    return new SestinaError(SestinaErrorCode.validation_failed, message);
  }
  if (code === "EEXIST" || code === "EINVAL") {
    return new SestinaError(SestinaErrorCode.validation_failed, message);
  }
  if (code === "EPERM" || code === "EACCES" || code === "EBUSY") {
    return new SestinaError(SestinaErrorCode.storage_busy, message);
  }
  return new SestinaError(SestinaErrorCode.internal_error, message);
}
