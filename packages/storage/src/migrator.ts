import { randomBytes } from "node:crypto";
import { SestinaError, SestinaErrorCode, isSestinaError } from "@sestina/schema";
import type { StorageDatabase } from "./connection.js";
import { withTransaction } from "./transaction.js";
import { MaintenanceLock } from "./maintenance-lock.js";
import { backupDatabase, pruneOldBackups, type BackupResult } from "./backup.js";
import { MIGRATIONS, SCHEMA_VERSION } from "./migrations/manifest.js";

export { MIGRATIONS, SCHEMA_VERSION };

// ── Runtime identity recorded in the migration journal (docs/17 §10) ──
export const RUNTIME_VERSION = "0.1.0";

export interface Migration {
  version: number;
  name: string;
  /** Must be idempotent: a failed run is retried after repair. */
  up(db: StorageDatabase): void;
}

export type MigrationJournalStatus = "started" | "completed" | "failed";

export interface MigrationRunnerOptions {
  backupDirectory?: string;
}

export interface MigrationRunResult {
  state: "ready" | "already_current" | "too_new";
  applied: string[];
  targetVersion: number;
  databaseVersion: number;
}

// ── Bootstrap: journal + maintenance lock exist before any migration ──
const BOOTSTRAP_SQL = `
CREATE TABLE migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('started','completed','failed')),
  runtime_version TEXT NOT NULL,
  backup_path TEXT,
  backup_hash TEXT,
  error_code TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER
) STRICT;
CREATE TABLE maintenance_locks (
  name TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;`;

/**
 * Applies migrations forward-only (docs/09 §22): journal records
 * started/completed/failed states with the runtime version, each migration
 * is preceded by a hashed backup (docs/17 §10), failures refuse writes and
 * keep the original database readable (docs/19 §5.4), and a newer schema
 * is rejected with migration_too_new. Migration/restore serialisation uses
 * the maintenance lock (docs/22 Task 5).
 */
export class MigrationRunner {
  private readonly db: StorageDatabase;
  private readonly migrations: readonly Migration[];
  private readonly options: MigrationRunnerOptions;

  constructor(
    db: StorageDatabase,
    migrations: readonly Migration[],
    options: MigrationRunnerOptions = {},
  ) {
    this.db = db;
    this.migrations = migrations;
    this.options = options;
  }

  async run(): Promise<MigrationRunResult> {
    const db = this.db;
    db.assertWritable();
    const hasJournal = db.get(
      "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'migrations'",
    );
    if (!hasJournal) {
      db.exec(BOOTSTRAP_SQL);
    }

    // Unique owner per acquisition: the lock must be exclusive even between
    // two connections of the same runtime version (docs/29 §9).
    const lockOwnerId = `runtime-${RUNTIME_VERSION}-${randomBytes(4).toString("hex")}`;
    const lock = await MaintenanceLock.acquire(db, {
      name: "migrations",
      ownerId: lockOwnerId,
    });
    try {
      const sorted = [...this.migrations].sort((a, b) => a.version - b.version);
      const seen = new Set<number>();
      for (const migration of sorted) {
        if (seen.has(migration.version)) {
          throw new SestinaError(
            SestinaErrorCode.internal_error,
            "Duplicate migration version in the migration set",
          );
        }
        seen.add(migration.version);
      }

      const targetVersion = sorted.at(-1)?.version ?? 0;
      const completedMax = Number(
        db.get<{ v: number | bigint }>(
          "SELECT COALESCE(MAX(version), 0) AS v FROM migrations WHERE status = 'completed'",
        )?.v ?? 0,
      );

      if (completedMax > targetVersion) {
        throw new SestinaError(
          SestinaErrorCode.migration_too_new,
          "Database schema is newer than this runtime supports",
          400,
          { databaseVersion: completedMax, supportedVersion: targetVersion },
        );
      }

      // A recorded failure for a version this runtime does not know blocks
      // writes (docs/19 §5.4). Failures for known versions are retried below.
      const blockedFailure = db.get<{ version: number }>(
        `SELECT version FROM migrations
         WHERE status = 'failed' AND version NOT IN (${sorted.map(() => "?").join(",") || "NULL"})
         ORDER BY version LIMIT 1`,
        ...sorted.map((m) => m.version),
      );
      if (blockedFailure) {
        throw new SestinaError(
          SestinaErrorCode.migration_failed,
          "A recorded migration failure blocks writes",
          500,
          { version: blockedFailure.version },
        );
      }

      const applied: string[] = [];
      for (const migration of sorted) {
        const existing = db.get<{ status: string }>(
          "SELECT status FROM migrations WHERE version = ?",
          migration.version,
        );
        if (existing?.status === "completed") continue;

        // Destructive migration on an existing database: hashed local backup
        // first (docs/17 §10). A fresh empty database has nothing to lose,
        // so no backup is taken for the very first migration.
        let backup: BackupResult | undefined;
        if (this.options.backupDirectory && completedMax > 0) {
          // The backup may take longer than the lock TTL — renew around it.
          lock.renew();
          backup = await backupDatabase(db, { backupDirectory: this.options.backupDirectory });
          lock.renew();
        }

        const now = Date.now();
        db.run(
          `INSERT INTO migrations
             (version, name, status, runtime_version, started_at, backup_path, backup_hash)
           VALUES (?, ?, 'started', ?, ?, ?, ?)
           ON CONFLICT(version) DO UPDATE SET
             name = excluded.name,
             status = 'started',
             runtime_version = excluded.runtime_version,
             started_at = excluded.started_at,
             backup_path = excluded.backup_path,
             backup_hash = excluded.backup_hash,
             error_code = NULL,
             finished_at = NULL`,
          migration.version,
          migration.name,
          RUNTIME_VERSION,
          now,
          backup?.path ?? null,
          backup?.hash ?? null,
        );

        try {
          await withTransaction(db, () => {
            migration.up(db);
            db.run(
              "UPDATE migrations SET status = 'completed', runtime_version = ?, finished_at = ? WHERE version = ?",
              RUNTIME_VERSION,
              Date.now(),
              migration.version,
            );
          });
          applied.push(migration.name);
          if (this.options.backupDirectory) {
            pruneOldBackups(this.options.backupDirectory, { keep: 3 });
          }
        } catch (err) {
          // Journal the failure outside the rolled-back unit.
          try {
            db.run(
              "UPDATE migrations SET status = 'failed', error_code = ?, finished_at = ? WHERE version = ?",
              errorCodeOf(err),
              Date.now(),
              migration.version,
            );
          } catch {
            // Journal write failed — preserve the original error.
          }
          throw new SestinaError(
            SestinaErrorCode.migration_failed,
            "Database migration failed",
            500,
            { version: migration.version, name: migration.name },
          );
        }
      }

      return {
        state: applied.length > 0 ? "ready" : "already_current",
        applied,
        targetVersion,
        databaseVersion: Math.max(completedMax, targetVersion),
      };
    } finally {
      lock.release();
    }
  }
}

function errorCodeOf(err: unknown): string {
  return isSestinaError(err) ? err.code : SestinaErrorCode.internal_error;
}
