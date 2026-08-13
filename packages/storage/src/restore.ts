import { DatabaseSync } from "node:sqlite";
import { backup as sqliteBackup } from "node:sqlite";
import {
  copyFileSync,
  constants as fsConstants,
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { SestinaError, SestinaErrorCode } from "@sestina/schema";
import { assertInsideRoot, hashFile } from "./backup.js";
import { checkDatabaseIntegrity } from "./integrity.js";
import { MaintenanceLock } from "./maintenance-lock.js";
import { openDatabase } from "./connection.js";

export interface RestoreOptions {
  /** Absolute or relative path of the database to restore into. */
  databasePath: string;
  /** Path of the backup file to restore from. */
  backupPath: string;
  /** Sestina data root both paths must live inside (docs/17 §10). */
  dataRoot: string;
}

export interface RestoreResult {
  restoredFrom: string;
  /** Backup of the previous database taken before replacing it (docs/17 §10). */
  preRestoreBackupPath: string;
  /** Preserved copy of the corrupted file, when the previous db was damaged. */
  corruptCopyPath?: string;
}

/**
 * Restores a database from a verified backup. The current database is
 * backed up again first (docs/17 §10); a corrupted current database is
 * preserved as a forensic copy instead of being silently replaced
 * (docs/19 §5.3). The caller must have closed any other handles on
 * `databasePath`.
 *
 * Serialisation (docs/17 §3.2): the restore acquires the "restore"
 * maintenance lock inside the target database while preparing the copies.
 * The final replace is an atomic same-directory rename; on Windows the OS
 * sharing rules additionally refuse the rename while any other process
 * still has the database open.
 */
export async function restoreDatabase(options: RestoreOptions): Promise<RestoreResult> {
  const databasePath = resolve(options.databasePath);
  const backupPath = resolve(options.backupPath);
  assertInsideRoot(options.dataRoot, databasePath, "restore target");
  assertInsideRoot(options.dataRoot, backupPath, "restore source");

  if (!existsSync(backupPath)) {
    throw new SestinaError(SestinaErrorCode.validation_failed, "Backup file not found");
  }
  const backupHealth = checkDatabaseIntegrity(backupPath);
  if (!backupHealth.ok) {
    throw new SestinaError(
      SestinaErrorCode.database_corrupt,
      "Backup file failed the integrity check",
    );
  }

  // Verifying the recorded hash when a sidecar exists: reject backups whose
  // bytes no longer match what was originally produced.
  const sidecarPath = `${backupPath}.sha256`;
  if (existsSync(sidecarPath)) {
    const recorded = readFileSync(sidecarPath, "utf8").trim();
    const actual = await hashFile(backupPath);
    if (recorded !== actual) {
      throw new SestinaError(
        SestinaErrorCode.database_corrupt,
        "Backup file hash does not match its recorded hash",
      );
    }
  }

  // Maintenance lock on the target database (best effort: an unreadable
  // target still allows restoring over it, guarded by the atomic rename).
  let lock: MaintenanceLock | null = null;
  let lockDb: Awaited<ReturnType<typeof openDatabase>> | null = null;
  if (existsSync(databasePath)) {
    try {
      lockDb = await openDatabase({ path: databasePath, migrate: false });
      lock = await MaintenanceLock.acquire(lockDb, { name: "restore", ownerId: `restore-${randomBytes(4).toString("hex")}` });
    } catch (err) {
      if (err instanceof SestinaError && err.code === SestinaErrorCode.database_corrupt) {
        // Damaged target: proceed without the lock (documented above).
        lockDb?.close();
        lockDb = null;
      } else {
        lockDb?.close();
        throw err;
      }
    }
  }

  try {
    let preRestoreBackupPath = "";
    let corruptCopyPath: string | undefined;

    if (existsSync(databasePath)) {
      const currentHealth = checkDatabaseIntegrity(databasePath);
      if (!currentHealth.ok) {
        corruptCopyPath = `${databasePath}.corrupt-${Date.now()}-${randomBytes(3).toString("hex")}`;
        copyFileSync(databasePath, corruptCopyPath);
      }

      preRestoreBackupPath = `${databasePath}.pre-restore-${Date.now()}-${randomBytes(3).toString("hex")}.sqlite`;
      try {
        // Prefer the SQLite backup API so WAL contents are included.
        const raw = new DatabaseSync(databasePath, { open: true, readOnly: true });
        try {
          await sqliteBackup(raw, preRestoreBackupPath);
        } finally {
          raw.close();
        }
      } catch {
        // The current database may be damaged; preserve its raw bytes instead.
        copyFileSync(databasePath, preRestoreBackupPath);
      }
      const preRestoreHash = await hashFile(preRestoreBackupPath);
      writeFileSync(`${preRestoreBackupPath}.sha256`, `${preRestoreHash}\n`, "utf8");
    }

    // The lock connection must be closed before the rename so the OS can
    // replace the file.
    lock?.release();
    lockDb?.close();
    lock = null;
    lockDb = null;

    // Atomic replace: exclusive temp file in the same directory, verified
    // in place, then renamed over the target.
    const temp = `${databasePath}.restore-tmp-${Date.now()}-${randomBytes(4).toString("hex")}`;
    copyFileSync(backupPath, temp, fsConstants.COPYFILE_EXCL);
    const tempHealth = checkDatabaseIntegrity(temp);
    if (!tempHealth.ok) {
      rmSync(temp, { force: true });
      throw new SestinaError(
        SestinaErrorCode.database_corrupt,
        "Restore copy failed verification",
      );
    }
    renameSync(temp, databasePath);

    // Stale WAL/SHM sidecars belong to the previous database.
    for (const suffix of ["-wal", "-shm"]) {
      rmSync(`${databasePath}${suffix}`, { force: true });
    }

    const restoredHealth = checkDatabaseIntegrity(databasePath);
    if (!restoredHealth.ok) {
      throw new SestinaError(
        SestinaErrorCode.database_corrupt,
        "Restored database failed verification",
      );
    }

    return { restoredFrom: backupPath, preRestoreBackupPath, corruptCopyPath };
  } finally {
    if (lock) {
      try {
        lock.release();
      } catch {
        // Best effort: the connection is being closed anyway.
      }
    }
    lockDb?.close();
  }
}
