import { DatabaseSync } from "node:sqlite";
import { backup as sqliteBackup } from "node:sqlite";
import {
  copyFileSync,
  constants as fsConstants,
  existsSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { SestinaError, SestinaErrorCode } from "@sestina/schema";
import { assertInsideRoot, hashFile } from "./backup.js";
import { checkDatabaseIntegrity } from "./integrity.js";
import { MaintenanceFence, mapFsError } from "./maintenance-fence.js";

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
 * Canonicalises a validated path for file operations: the parent directory
 * is realpath-resolved so later operations use the same fixed location the
 * containment check approved (docs/17 §10).
 */
export function canonicalizeForIo(path: string): string {
  const absolute = resolve(path);
  let parentReal: string;
  try {
    parentReal = realpathSync(dirname(absolute));
  } catch (err) {
    throw mapFsError(err, "Restore path is not accessible");
  }
  return resolve(parentReal, basename(absolute));
}

/**
 * Copies a verified backup to an exclusive temp file in the same directory
 * as `destinationDir`, re-hashes the copy and compares it with the digest
 * fixed before the copy, then verifies SQLite integrity. Any failure
 * removes the temp file (docs/17 §10, docs/19 §5.3).
 */
export async function stageVerifiedCopy(
  sourcePath: string,
  expectedDigest: string,
  destinationDir: string,
): Promise<string> {
  const temp = resolve(
    destinationDir,
    `.restore-tmp-${Date.now()}-${randomBytes(6).toString("hex")}`,
  );
  try {
    copyFileSync(sourcePath, temp, fsConstants.COPYFILE_EXCL);
  } catch (err) {
    rmSync(temp, { force: true });
    throw mapFsError(err, "Failed to stage the restore copy");
  }
  try {
    const actual = await hashFile(temp);
    if (actual !== expectedDigest) {
      throw new SestinaError(
        SestinaErrorCode.database_corrupt,
        "Restore copy hash does not match the verified source digest",
      );
    }
    const health = checkDatabaseIntegrity(temp);
    if (!health.ok) {
      throw new SestinaError(
        SestinaErrorCode.database_corrupt,
        "Restore copy failed the integrity check",
      );
    }
    return temp;
  } catch (err) {
    rmSync(temp, { force: true });
    throw err;
  }
}

/**
 * Restores a database from a verified backup under the common maintenance
 * fence (docs/17 §3.2). The fence is file-based and lives beside — not
 * inside — the target database, so it is held across the entire restore:
 * source verification, pre-restore backup, exclusive temp copy, temp
 * verification, atomic replace, WAL/SHM cleanup and final integrity check.
 * A corrupted current database is preserved as a forensic copy instead of
 * being silently replaced (docs/19 §5.3). The caller must have closed any
 * other handles on `databasePath`.
 */
export async function restoreDatabase(options: RestoreOptions): Promise<RestoreResult> {
  assertInsideRoot(options.dataRoot, options.databasePath, "restore target");
  assertInsideRoot(options.dataRoot, options.backupPath, "restore source");
  const databasePath = canonicalizeForIo(options.databasePath);
  const backupPath = canonicalizeForIo(options.backupPath);

  const fence = await MaintenanceFence.acquire({
    dataRoot: options.dataRoot,
    scope: "restore",
  });
  try {
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

    // Strict sidecar verification when present; when absent, the digest
    // computed now is still the fixed reference for the staged copy.
    const sourceDigest = await hashFile(backupPath);
    const sidecarPath = `${backupPath}.sha256`;
    if (existsSync(sidecarPath)) {
      const recorded = readFileSync(sidecarPath, "utf8").trim();
      if (recorded !== sourceDigest) {
        throw new SestinaError(
          SestinaErrorCode.database_corrupt,
          "Backup file hash does not match its recorded hash",
        );
      }
    }

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

    // Stage, verify, then replace. The staged copy is re-hashed against
    // the digest fixed before the copy, closing the swap window.
    const temp = await stageVerifiedCopy(backupPath, sourceDigest, dirname(databasePath));

    try {
      // The target parent must still exist and the temp must be intact.
      const parentReal = realpathSync(dirname(databasePath));
      const tempCanonical = resolve(parentReal, basename(temp));
      if (!existsSync(tempCanonical)) {
        throw new SestinaError(SestinaErrorCode.database_corrupt, "Staged restore copy disappeared");
      }
      renameSync(tempCanonical, databasePath);
    } catch (err) {
      rmSync(temp, { force: true });
      throw mapFsError(err, "Failed to replace the database");
    }

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
    fence.release();
  }
}
