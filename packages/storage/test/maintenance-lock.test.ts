import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { openDatabase, MaintenanceLock } from "../src/index.js";
import { isSestinaError, SestinaErrorCode } from "@sestina/schema";
import { makeTempDir, removeTempDir, spawnChildScenario } from "./helpers.js";
import type { StorageDatabase } from "../src/index.js";

describe("MaintenanceLock fencing (docs/17 §3.2, docs/29 §9)", () => {
  let dir: string;
  let db: StorageDatabase;

  beforeEach(async () => {
    dir = makeTempDir();
    db = await openDatabase({ path: join(dir, "sestina.db") });
  });
  afterEach(() => {
    db.close();
    removeTempDir(dir);
  });

  it("fences out a stale renew after the lock was taken over (ABA)", async () => {
    const first = await MaintenanceLock.acquire(db, {
      name: "aba-lock",
      ownerId: "logical-owner", // deliberately the SAME logical owner
      ttlMs: 300,
    });
    // Force expiry so another acquisition of the same logical owner takes over.
    db.run("UPDATE maintenance_locks SET expires_at = ? WHERE name = 'aba-lock'", Date.now() - 1);
    const second = await MaintenanceLock.acquire(db, {
      name: "aba-lock",
      ownerId: "logical-owner",
      ttlMs: 60_000,
    });

    // The stale first instance must NOT be able to renew the new holder's lease.
    try {
      first.renew(120_000);
      expect.unreachable("stale renew must throw stale_state");
    } catch (err) {
      expect(isSestinaError(err)).toBe(true);
      if (isSestinaError(err)) {
        expect(err.code).toBe(SestinaErrorCode.stale_state);
      }
    }

    // The stale release must be a no-op: the new holder keeps the row.
    first.release();
    const row = db.get<{ expires_at: number }>(
      "SELECT expires_at FROM maintenance_locks WHERE name = 'aba-lock'",
    );
    expect(row).toBeDefined();
    expect((row?.expires_at ?? 0)).toBeGreaterThan(Date.now());

    // The new holder still works.
    second.renew(120_000);
    second.release();
    expect(db.get("SELECT name FROM maintenance_locks WHERE name = 'aba-lock'")).toBeUndefined();
  });

  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY, 1.5, Number.MAX_SAFE_INTEGER + 2])(
    "rejects renew with invalid ttlMs=%s",
    async (ttlMs) => {
      const lock = await MaintenanceLock.acquire(db, {
        name: "ttl-lock",
        ownerId: "owner-a",
        ttlMs: 60_000,
      });
      try {
        lock.renew(ttlMs);
        expect.unreachable("invalid renew ttl must throw validation_failed");
      } catch (err) {
        expect(isSestinaError(err)).toBe(true);
        if (isSestinaError(err)) {
          expect(err.code).toBe(SestinaErrorCode.validation_failed);
        }
      } finally {
        lock.release();
      }
    },
  );

  it("throws stale_state when renewing a lock that was never held", async () => {
    const lock = await MaintenanceLock.acquire(db, { name: "lost", ownerId: "owner-a", ttlMs: 60_000 });
    lock.release();
    try {
      lock.renew(60_000);
      expect.unreachable("renew after release must throw stale_state");
    } catch (err) {
      expect(isSestinaError(err)).toBe(true);
      if (isSestinaError(err)) {
        expect(err.code).toBe(SestinaErrorCode.stale_state);
      }
    }
  });

  it("excludes a second process while held (real child process)", async () => {
    const path = join(dir, "sestina.db");
    const child = spawnChildScenario({
      scenario: "hold-db-lock",
      env: {
        SESTINA_CHILD_DB_PATH: path,
        SESTINA_CHILD_LOCK_NAME: "cross-process",
        SESTINA_CHILD_OWNER: "child-process",
        SESTINA_CHILD_TTL: "60000",
        SESTINA_CHILD_HOLD_MS: "5000",
      },
    });
    try {
      expect(await child.waitForReady()).toBe(true);

      await expect(
        MaintenanceLock.acquire(db, { name: "cross-process", ownerId: "parent", ttlMs: 60_000 }),
      ).rejects.toSatisfy((err: unknown) => {
        return isSestinaError(err) && err.code === SestinaErrorCode.storage_busy;
      });
    } finally {
      const exit = await child.wait();
      expect(exit).toBe(0);
    }

    // After the child exited, the parent can acquire.
    const lock = await MaintenanceLock.acquire(db, { name: "cross-process", ownerId: "parent", ttlMs: 60_000 });
    lock.release();
  }, 60000);
});
