import { randomUUID } from "node:crypto";
import { SestinaError, SestinaErrorCode } from "@sestina/schema";
import type { StorageDatabase } from "./connection.js";
import { validateLeaseTtlMs } from "./lease.js";

export const DEFAULT_MAINTENANCE_LOCK_TTL_MS = 60_000;

export interface MaintenanceLockOptions {
  name: string;
  /** Logical owner label for diagnostics; fencing never relies on it. */
  ownerId: string;
  ttlMs?: number;
}

/**
 * Cross-process exclusive maintenance lock stored in the database
 * (docs/17 §3.2, docs/19 §5.1, docs/29 §9). Every acquisition carries a
 * unique fencing token: after a takeover, a stale holder's renew() throws
 * stale_state and its release() is a no-op — it can never touch the new
 * holder's row (ABA-safe).
 */
export class MaintenanceLock {
  private held = true;
  private readonly fenceToken: string;

  private constructor(
    private readonly db: StorageDatabase,
    private readonly name: string,
    fenceToken: string,
    private readonly ttlMs: number,
  ) {
    this.fenceToken = fenceToken;
  }

  // Async API shape for symmetry with the rest of the storage layer; the
  // acquisition itself is synchronous (SQLite busy-wait is synchronous).
  // eslint-disable-next-line @typescript-eslint/require-await
  static async acquire(
    db: StorageDatabase,
    options: MaintenanceLockOptions,
  ): Promise<MaintenanceLock> {
    db.assertWritable();
    assertNotInTransaction(db);
    const ttlMs = validateLeaseTtlMs(options.ttlMs ?? DEFAULT_MAINTENANCE_LOCK_TTL_MS, "Maintenance lock ttlMs");
    const fenceToken = randomUUID();
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
        `INSERT INTO maintenance_locks (name, owner_id, expires_at, fence_token)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET
           owner_id = excluded.owner_id,
           expires_at = excluded.expires_at,
           fence_token = excluded.fence_token`,
        options.name,
        options.ownerId,
        now + ttlMs,
        fenceToken,
      );
      db.exec("COMMIT");
      return new MaintenanceLock(db, options.name, fenceToken, ttlMs);
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  /**
   * Extends the lease while still held. Throws stale_state when the lock
   * was lost (taken over, expired or released) — never silently succeeds,
   * never resurrects an expired lock.
   */
  renew(ttlMs: number = this.ttlMs): void {
    this.assertHeld();
    assertNotInTransaction(this.db);
    const validated = validateLeaseTtlMs(ttlMs, "Maintenance lock ttlMs");
    this.db.exec("BEGIN IMMEDIATE");
    let changes: number;
    try {
      const result = this.db.run(
        "UPDATE maintenance_locks SET expires_at = ? WHERE name = ? AND fence_token = ? AND expires_at > ?",
        Date.now() + validated,
        this.name,
        this.fenceToken,
        Date.now(),
      );
      changes = Number(result.changes);
      this.db.exec("COMMIT");
    } catch (err) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // Preserve the original failure.
      }
      throw err;
    }
    if (changes === 0) {
      this.held = false;
      throw new SestinaError(
        SestinaErrorCode.stale_state,
        "Maintenance lock is no longer held by this owner",
      );
    }
  }

  /**
   * Releases the lock (idempotent). A stale release is a no-op: the delete
   * is token-guarded so it can never remove a new holder's row.
   */
  release(): void {
    if (!this.held) return;
    this.held = false;
    assertNotInTransaction(this.db);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.run(
        "DELETE FROM maintenance_locks WHERE name = ? AND fence_token = ?",
        this.name,
        this.fenceToken,
      );
      this.db.exec("COMMIT");
    } catch (err) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // Preserve the original failure.
      }
      throw err;
    }
  }

  private assertHeld(): void {
    if (!this.held) {
      throw new SestinaError(SestinaErrorCode.stale_state, "Maintenance lock is released");
    }
  }
}

/**
 * BEGIN IMMEDIATE inside an outer transaction would throw and the catch's
 * ROLLBACK would silently destroy the caller's unit — refuse instead.
 */
function assertNotInTransaction(db: StorageDatabase): void {
  if (db.isTransaction) {
    throw new SestinaError(
      SestinaErrorCode.internal_error,
      "Maintenance lock must not be used inside a transaction",
    );
  }
}
