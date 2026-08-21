import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import {
  openDatabase,
  backupDatabase,
  restoreDatabase,
  checkDatabaseIntegrity,
  pruneOldBackups,
  MaintenanceGuard,
  stageVerifiedCopy,
  hashFile,
  type StorageDatabase,
} from "../src/index.js";
import { isSestinaError, SestinaErrorCode } from "@sestina/schema";
import { makeTempDir, removeTempDir, corruptDatabaseFile } from "./helpers.js";

describe("backupDatabase (docs/17 §10)", () => {
  let dir: string;
  let db: StorageDatabase;

  beforeEach(async () => {
    dir = makeTempDir();
    db = await openDatabase({ path: join(dir, "sestina.db") });
    db.run("INSERT INTO events (event_id, idempotency_key, project_id, task_id, event_type, occurred_at, received_at, privacy_class, data) VALUES ('e1','bk1','p','t','stop',1,1,'internal','{}')");
  });
  afterEach(() => {
    db.close();
    removeTempDir(dir);
  });

  it("writes a local backup file with a matching SHA-256 hash and version", async () => {
    const backupDir = join(dir, "backups");
    const result = await backupDatabase(db, { backupDirectory: backupDir });

    expect(result.path.startsWith(backupDir)).toBe(true);
    expect(existsSync(result.path)).toBe(true);
    expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.version).toBeGreaterThan(0);

    const sidecar = readFileSync(`${result.path}.sha256`, "utf8").trim();
    expect(sidecar).toBe(result.hash);

    const fileHash = await hashFile(result.path);
    expect(fileHash).toBe(result.hash);

    const integrity = checkDatabaseIntegrity(result.path);
    expect(integrity.ok).toBe(true);
  });

  it("backs up successfully when the destination exceeds the legacy Windows path limit", async () => {
    const backupName = "sestina-v15-backup-0000000000000-000000000000.sqlite";
    let longRoot = join(dir, "第二层 with spaces");
    let segment = 0;
    while (join(longRoot, "backups", "temporary bundle staging directory", backupName).length <= 280) {
      longRoot = join(longRoot, `long-backup-segment-${String(segment).padStart(2, "0")}`);
      segment += 1;
    }
    const backupDir = join(longRoot, "backups", "temporary bundle staging directory");
    mkdirSync(backupDir, { recursive: true });
    expect(join(backupDir, backupName).length).toBeGreaterThan(260);
    const result = await backupDatabase(db, { backupDirectory: backupDir, dataRoot: dir });
    expect(existsSync(result.path)).toBe(true);
    expect(checkDatabaseIntegrity(result.path).ok).toBe(true);
  });

  it("rejects a backup directory outside the data root", async () => {
    const outside = makeTempDir("sestina-outside-");
    try {
      await expect(
        backupDatabase(db, { backupDirectory: join(outside, "backups"), dataRoot: dir }),
      ).rejects.toSatisfy((err: unknown) => isSestinaError(err));
    } finally {
      removeTempDir(outside);
    }
  });

  it("prunes to the 3 most recent successful backups", async () => {
    const backupDir = join(dir, "backups");
    for (let i = 0; i < 5; i++) {
      await backupDatabase(db, { backupDirectory: backupDir });
    }
    const pruned = pruneOldBackups(backupDir, { keep: 3 });
    expect(pruned.length).toBe(2);
    const remaining = readdirSync(backupDir).filter((f) => f.endsWith(".sqlite"));
    expect(remaining).toHaveLength(3);
  });
});

describe("restoreDatabase (docs/17 §10, docs/19 §5.3)", () => {
  let dir: string;

  beforeEach(() => { dir = makeTempDir(); });
  afterEach(() => { removeTempDir(dir); });

  it("restores from backup and creates a pre-restore backup of the current db", async () => {
    const dbPath = join(dir, "sestina.db");
    const backupDir = join(dir, "backups");

    const seed = await openDatabase({ path: dbPath });
    seed.run("INSERT INTO events (event_id, idempotency_key, project_id, task_id, event_type, occurred_at, received_at, privacy_class, data) VALUES ('e1','rk1','p','t','stop',1,1,'internal','{}')");
    const backup = await backupDatabase(seed, { backupDirectory: backupDir });
    seed.run("INSERT INTO events (event_id, idempotency_key, project_id, task_id, event_type, occurred_at, received_at, privacy_class, data) VALUES ('e2','rk2','p','t','stop',1,1,'internal','{}')");
    seed.close();

    const result = await restoreDatabase({ databasePath: dbPath, backupPath: backup.path, dataRoot: dir });

    expect(existsSync(result.preRestoreBackupPath)).toBe(true);
    const restored = await openDatabase({ path: dbPath });
    try {
      expect(restored.get("SELECT event_id FROM events WHERE event_id = 'e1'")).toBeTruthy();
      expect(restored.get("SELECT event_id FROM events WHERE event_id = 'e2'")).toBeUndefined();
    } finally {
      restored.close();
    }
    // The restored file must be healthy.
    expect(checkDatabaseIntegrity(dbPath).ok).toBe(true);
    // And the pre-restore backup contains the later state (e2 present).
    const preRestore = await openDatabase({ path: result.preRestoreBackupPath, readOnly: true });
    try {
      expect(preRestore.get("SELECT event_id FROM events WHERE event_id = 'e2'")).toBeTruthy();
    } finally {
      preRestore.close();
    }
  });

  it("preserves the corrupted file before restoring over it", async () => {
    const dbPath = join(dir, "sestina.db");
    const backupDir = join(dir, "backups");

    const seed = await openDatabase({ path: dbPath });
    seed.run("INSERT INTO events (event_id, idempotency_key, project_id, task_id, event_type, occurred_at, received_at, privacy_class, data) VALUES ('e1','ck1','p','t','stop',1,1,'internal','{}')");
    const backup = await backupDatabase(seed, { backupDirectory: backupDir });
    seed.close();

    corruptDatabaseFile(dbPath);
    expect(checkDatabaseIntegrity(dbPath).ok).toBe(false);

    const result = await restoreDatabase({ databasePath: dbPath, backupPath: backup.path, dataRoot: dir });

    expect(result.corruptCopyPath).toBeTruthy();
    expect(existsSync(result.corruptCopyPath ?? "")).toBe(true);
    expect(existsSync(result.preRestoreBackupPath)).toBe(true);
    expect(checkDatabaseIntegrity(dbPath).ok).toBe(true);
  });

  it("rejects restore targets outside the data root", async () => {
    const dbPath = join(dir, "sestina.db");
    const outside = makeTempDir("sestina-outside-");
    try {
      const seed = await openDatabase({ path: dbPath });
      const backupDir = join(dir, "backups");
      const backup = await backupDatabase(seed, { backupDirectory: backupDir });
      seed.close();

      await expect(
        restoreDatabase({
          databasePath: join(outside, "sestina.db"),
          backupPath: backup.path,
          dataRoot: dir,
        }),
      ).rejects.toSatisfy((err: unknown) => isSestinaError(err));
    } finally {
      removeTempDir(outside);
    }
  });

  it("rejects a backup path outside the data root", async () => {
    const dbPath = join(dir, "sestina.db");
    const outside = makeTempDir("sestina-outside-");
    try {
      const seed = await openDatabase({ path: dbPath });
      seed.run("INSERT INTO events (event_id, idempotency_key, project_id, task_id, event_type, occurred_at, received_at, privacy_class, data) VALUES ('e1','pk1','p','t','stop',1,1,'internal','{}')");
      const outsideBackup = await backupDatabase(seed, { backupDirectory: join(outside, "backups") });
      seed.close();

      await expect(
        restoreDatabase({ databasePath: dbPath, backupPath: outsideBackup.path, dataRoot: dir }),
      ).rejects.toSatisfy((err: unknown) => {
        return isSestinaError(err) && err.code === SestinaErrorCode.validation_failed;
      });
    } finally {
      removeTempDir(outside);
    }
  });

  it("rejects a restore while another process holds the maintenance fence", async () => {
    const dbPath = join(dir, "sestina.db");
    const backupDir = join(dir, "backups");
    const seed = await openDatabase({ path: dbPath });
    seed.run("INSERT INTO events (event_id, idempotency_key, project_id, task_id, event_type, occurred_at, received_at, privacy_class, data) VALUES ('e1','lk1','p','t','stop',1,1,'internal','{}')");
    const backup = await backupDatabase(seed, { backupDirectory: backupDir });
    seed.close();

    const fence = await MaintenanceGuard.acquire({ databasePath: dbPath, scope: "migrations", ownerId: "test" });
    try {
      await expect(
        restoreDatabase({ databasePath: dbPath, backupPath: backup.path, dataRoot: dir }),
      ).rejects.toSatisfy((err: unknown) => {
        return isSestinaError(err) && err.code === SestinaErrorCode.storage_busy;
      });
    } finally {
      fence.release();
    }
    // Generous timeout: the companion lock DB acquisition competes with
    // every other maintenance test under full-repo parallel load.
  }, 15000);

  it("rejects a backup whose recorded sidecar hash does not match", async () => {
    const dbPath = join(dir, "sestina.db");
    const backupDir = join(dir, "backups");
    const seed = await openDatabase({ path: dbPath });
    seed.run("INSERT INTO events (event_id, idempotency_key, project_id, task_id, event_type, occurred_at, received_at, privacy_class, data) VALUES ('e1','hk1','p','t','stop',1,1,'internal','{}')");
    const backup = await backupDatabase(seed, { backupDirectory: backupDir });
    seed.close();

    // Corrupt the recorded hash: restore must refuse the mismatch.
    writeFileSync(
      `${backup.path}.sha256`,
      "0".repeat(64) + "\n",
      "utf8",
    );
    await expect(
      restoreDatabase({ databasePath: dbPath, backupPath: backup.path, dataRoot: dir }),
    ).rejects.toSatisfy((err: unknown) => {
      return isSestinaError(err) && err.code === SestinaErrorCode.database_corrupt;
    });
  });

  it("restores from a sidecar-less backup and records the fixed source digest", async () => {
    const dbPath = join(dir, "sestina.db");
    const backupDir = join(dir, "backups");
    const seed = await openDatabase({ path: dbPath });
    seed.run("INSERT INTO events (event_id, idempotency_key, project_id, task_id, event_type, occurred_at, received_at, privacy_class, data) VALUES ('e1','jk1','p','t','stop',1,1,'internal','{}')");
    const backup = await backupDatabase(seed, { backupDirectory: backupDir });
    seed.close();
    const sidecarPath = `${backup.path}.sha256`;
    rmSync(sidecarPath, { force: true });

    const result = await restoreDatabase({ databasePath: dbPath, backupPath: backup.path, dataRoot: dir });
    expect(checkDatabaseIntegrity(dbPath).ok).toBe(true);
    expect(result.restoredFrom).toBe(backup.path);
  });

  it("stageVerifiedCopy cleans its temp file when the digest mismatches", async () => {
    const backupDir = join(dir, "backups");
    const seed = await openDatabase({ path: join(dir, "sestina.db") });
    const backup = await backupDatabase(seed, { backupDirectory: backupDir });
    seed.close();
    const correct = await hashFile(backup.path);

    await expect(
      stageVerifiedCopy(backup.path, "0".repeat(64), backupDir),
    ).rejects.toSatisfy((err: unknown) => {
      return isSestinaError(err) && err.code === SestinaErrorCode.database_corrupt;
    });
    const leftovers = readdirSync(backupDir).filter((f) => f.includes("restore-tmp"));
    expect(leftovers).toHaveLength(0);

    const staged = await stageVerifiedCopy(backup.path, correct, backupDir);
    expect(existsSync(staged)).toBe(true);
    expect(await hashFile(staged)).toBe(correct);
    rmSync(staged, { force: true });
  });

  it("rejects restoring from a file that is not a healthy database", async () => {
    const dbPath = join(dir, "sestina.db");
    const seeded = await openDatabase({ path: dbPath });
    seeded.close();
    const badBackup = join(dir, "bad.sqlite");
    writeFileSync(badBackup, "garbage-not-a-db", "utf8");

    await expect(
      restoreDatabase({ databasePath: dbPath, backupPath: badBackup, dataRoot: dir }),
    ).rejects.toSatisfy((err: unknown) => {
      return isSestinaError(err) && err.code === SestinaErrorCode.database_corrupt;
    });
  });
});

// ── local helpers (test-only) ──

async function hashFile(path: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("pruneOldBackups validation (docs/17 §10)", () => {
  let dir: string;

  beforeEach(() => { dir = makeTempDir(); });
  afterEach(() => { removeTempDir(dir); });

  it.each([-5, 0, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid keep=%s",
    (keep) => {
      expect(() => pruneOldBackups(join(dir, "backups"), { keep })).toThrow();
    },
  );
});
