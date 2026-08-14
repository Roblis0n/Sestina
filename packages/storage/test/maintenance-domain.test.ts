import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { existsSync } from "node:fs";
import {
  openDatabase,
  MaintenanceGuard,
  maintenanceLockDbPath,
  restoreDatabase,
  backupDatabase,
} from "../src/index.js";
import { isSestinaError, SestinaErrorCode } from "@sestina/schema";
import { makeTempDir, removeTempDir, spawnChildScenario } from "./helpers.js";

describe("MaintenanceGuard (companion SQLite lock domain, docs/17 §3.2)", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(async () => {
    dir = makeTempDir();
    dbPath = join(dir, "sestina.db");
    const db = await openDatabase({ path: dbPath });
    db.close();
  });
  afterEach(() => { removeTempDir(dir); });

  it("acquires, heartbeats and releases", async () => {
    const guard = await MaintenanceGuard.acquire({ databasePath: dbPath, scope: "migrations", ownerId: "a" });
    expect(existsSync(maintenanceLockDbPath(dbPath))).toBe(true);
    guard.heartbeat();
    guard.release();
    const again = await MaintenanceGuard.acquire({ databasePath: dbPath, scope: "migrations", ownerId: "a" });
    again.release();
  });

  it("throws stale_state when heartbeating after release", async () => {
    const guard = await MaintenanceGuard.acquire({ databasePath: dbPath, scope: "migrations", ownerId: "a" });
    guard.release();
    try {
      guard.heartbeat();
      expect.unreachable("heartbeat after release must throw stale_state");
    } catch (err) {
      expect(isSestinaError(err)).toBe(true);
      if (isSestinaError(err)) {
        expect(err.code).toBe(SestinaErrorCode.stale_state);
      }
    }
  });

  it("excludes any maintenance scope while held (one global domain)", async () => {
    const guard = await MaintenanceGuard.acquire({ databasePath: dbPath, scope: "migrations", ownerId: "a" });
    try {
      await expect(
        MaintenanceGuard.acquire({ databasePath: dbPath, scope: "restore", ownerId: "b" }),
      ).rejects.toSatisfy((err: unknown) => {
        return isSestinaError(err) && err.code === SestinaErrorCode.storage_busy;
      });
      await expect(
        MaintenanceGuard.acquire({ databasePath: dbPath, scope: "retention", ownerId: "c" }),
      ).rejects.toSatisfy((err: unknown) => {
        return isSestinaError(err) && err.code === SestinaErrorCode.storage_busy;
      });
    } finally {
      guard.release();
    }
    const next = await MaintenanceGuard.acquire({ databasePath: dbPath, scope: "restore", ownerId: "b" });
    next.release();
  }, 15000);

  it("survives replacing the target database file while held (lock db is separate)", async () => {
    const guard = await MaintenanceGuard.acquire({ databasePath: dbPath, scope: "restore", ownerId: "a" });
    try {
      // Simulate restore's rename of the target database: the lock lives in
      // the companion database, not in the replaced file.
      const { copyFileSync, renameSync } = await import("node:fs");
      const copy = `${dbPath}.replacement`;
      copyFileSync(dbPath, copy);
      renameSync(copy, dbPath);
      await expect(
        MaintenanceGuard.acquire({ databasePath: dbPath, scope: "migrations", ownerId: "b" }),
      ).rejects.toSatisfy((err: unknown) => {
        return isSestinaError(err) && err.code === SestinaErrorCode.storage_busy;
      });
    } finally {
      guard.release();
    }
  });

  it("blocks migrations and restore while held", async () => {
    const guard = await MaintenanceGuard.acquire({ databasePath: dbPath, scope: "migrations", ownerId: "a" });
    try {
      await expect(openDatabase({ path: dbPath })).rejects.toSatisfy((err: unknown) => {
        return isSestinaError(err) && err.code === SestinaErrorCode.storage_busy;
      });
    } finally {
      guard.release();
    }
    const db = await openDatabase({ path: dbPath });
    db.run("INSERT INTO events (event_id, idempotency_key, project_id, task_id, event_type, occurred_at, received_at, privacy_class, data) VALUES ('e1','mk1','p','t','stop',1,1,'internal','{}')");
    const backupDir = join(dir, "backups");
    const backup = await backupDatabase(db, { backupDirectory: backupDir });
    db.close();

    const held = await MaintenanceGuard.acquire({ databasePath: dbPath, scope: "migrations", ownerId: "a" });
    try {
      await expect(
        restoreDatabase({ databasePath: dbPath, backupPath: backup.path, dataRoot: dir }),
      ).rejects.toSatisfy((err: unknown) => {
        return isSestinaError(err) && err.code === SestinaErrorCode.storage_busy;
      });
    } finally {
      held.release();
    }
  }, 15000);

  it("excludes a second real process while held", async () => {
    const child = spawnChildScenario({
      scenario: "hold-maintenance",
      env: {
        SESTINA_CHILD_DB_PATH: dbPath,
        SESTINA_CHILD_SCOPE: "migrations",
        SESTINA_CHILD_HOLD_MS: "6000",
      },
    });
    try {
      expect(await child.waitForReady()).toBe(true);
      await expect(
        MaintenanceGuard.acquire({ databasePath: dbPath, scope: "restore", ownerId: "parent" }),
      ).rejects.toSatisfy((err: unknown) => {
        return isSestinaError(err) && err.code === SestinaErrorCode.storage_busy;
      });
    } finally {
      expect(await child.wait()).toBe(0);
    }
    const guard = await MaintenanceGuard.acquire({ databasePath: dbPath, scope: "restore", ownerId: "parent" });
    guard.release();
  }, 120000);

  it("takes over after the holder is forcibly killed (no expiry, no ABA)", async () => {
    const child = spawnChildScenario({
      scenario: "hold-maintenance",
      env: {
        SESTINA_CHILD_DB_PATH: dbPath,
        SESTINA_CHILD_SCOPE: "migrations",
        SESTINA_CHILD_HOLD_MS: "120000",
      },
    });
    try {
      expect(await child.waitForReady()).toBe(true);
      await expect(
        MaintenanceGuard.acquire({ databasePath: dbPath, scope: "restore", ownerId: "parent" }),
      ).rejects.toSatisfy((err: unknown) => {
        return isSestinaError(err) && err.code === SestinaErrorCode.storage_busy;
      });

      // Forcibly terminate the holder: the OS closes its handles and the
      // SQLite lock is released automatically.
      child.process.kill();
      const exitCode = await child.wait();
      expect(exitCode).not.toBe(0);

      const guard = await MaintenanceGuard.acquire({ databasePath: dbPath, scope: "restore", ownerId: "parent" });
      guard.heartbeat();
      guard.release();
    } finally {
      if (child.process.exitCode === null) {
        child.process.kill();
        await child.wait();
      }
    }
  }, 120000);

  it("keeps exclusivity for operations longer than any TTL", async () => {
    const child = spawnChildScenario({
      scenario: "hold-maintenance",
      env: {
        SESTINA_CHILD_DB_PATH: dbPath,
        SESTINA_CHILD_SCOPE: "retention",
        SESTINA_CHILD_HOLD_MS: "8000",
      },
    });
    try {
      expect(await child.waitForReady()).toBe(true);
      // Probe several times across the old 60s-TTL scale: exclusivity is
      // not time-based, so every probe must fail while the child holds.
      for (let i = 0; i < 3; i++) {
        await expect(
          MaintenanceGuard.acquire({ databasePath: dbPath, scope: "migrations", ownerId: "probe", busyTimeoutMs: 400 }),
        ).rejects.toSatisfy((err: unknown) => {
          return isSestinaError(err) && err.code === SestinaErrorCode.storage_busy;
        });
        await new Promise((r) => setTimeout(r, 200));
      }
    } finally {
      expect(await child.wait()).toBe(0);
    }
    const guard = await MaintenanceGuard.acquire({ databasePath: dbPath, scope: "migrations", ownerId: "probe" });
    guard.release();
  }, 120000);
});
