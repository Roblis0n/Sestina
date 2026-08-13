import { SestinaError, SestinaErrorCode } from "@sestina/schema";
import type { StorageDatabase } from "./connection.js";

export const DEFAULT_MAINTENANCE_LOCK_TTL_MS = 60_000;

export interface MaintenanceLockOptions {
  name: string;
  ownerId: string;
  ttlMs?: number;
}

/**
 * Cross-process exclusive maintenance lock stored in the database itself
 * (docs/17 §3.2, docs/19 §5.1, docs/29 §9). Acquisition uses BEGIN IMMEDIATE:
 * contenders fail with storage_busy after the busy budget instead of
 * polling indefinitely.
 */
export class MaintenanceLock {
  private held = true;

  private constructor(
    private readonly db: StorageDatabase,
    private readonly name: string,
    private readonly ownerId: string,
    private readonly ttlMs: number,
  ) {}

  // Async API shape for symmetry with the rest of the storage layer; the
  // acquisition itself is synchronous (SQLite busy-wait is synchronous).
  // eslint-disable-next-line @typescript-eslint/require-await
  static async acquire(
    db: StorageDatabase,
    options: MaintenanceLockOptions,
  ): Promise<MaintenanceLock> {
    db.assertWritable();
    const ttlMs = options.ttlMs ?? DEFAULT_MAINTENANCE_LOCK_TTL_MS;
    if (!Number.isInteger(ttlMs) || ttlMs < 1) {
      throw new SestinaError(SestinaErrorCode.validation_failed, "ttlMs must be a positive integer");
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      const now = Date.now();
      const row = db.get<{ owner_id: string; expires_at: number }>(
        "SELECT owner_id, expires_at FROM maintenance_locks WHERE name = ?",
        options.name,
      );
      // Any unexpired row — even with the same owner id — means the lock is
      // held elsewhere. Same-instance re-entrancy is covered by renew();
      // cross-instance same-owner re-acquire must fail so one holder's
      // release() can never delete another holder's lease.
      if (row && row.expires_at > now) {
        throw new SestinaError(
          SestinaErrorCode.storage_busy,
          "Maintenance lock is held by another owner",
        );
      }
      db.run(
        `INSERT INTO maintenance_locks (name, owner_id, expires_at)
         VALUES (?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET
           owner_id = excluded.owner_id,
           expires_at = excluded.expires_at`,
        options.name,
        options.ownerId,
        now + ttlMs,
      );
      db.exec("COMMIT");
      return new MaintenanceLock(db, options.name, options.ownerId, ttlMs);
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  /** Extends the lease while still held. */
  renew(ttlMs: number = this.ttlMs): void {
    this.assertHeld();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.run(
        "UPDATE maintenance_locks SET expires_at = ? WHERE name = ? AND owner_id = ?",
        Date.now() + ttlMs,
        this.name,
        this.ownerId,
      );
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  /** Releases the lock (idempotent). */
  release(): void {
    if (!this.held) return;
    this.held = false;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.run(
        "DELETE FROM maintenance_locks WHERE name = ? AND owner_id = ?",
        this.name,
        this.ownerId,
      );
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  private assertHeld(): void {
    if (!this.held) {
      throw new SestinaError(SestinaErrorCode.stale_state, "Maintenance lock is released");
    }
  }
}
