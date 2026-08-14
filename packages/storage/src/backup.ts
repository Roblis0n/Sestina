import { backup as sqliteBackup } from "node:sqlite";
import {
  createReadStream,
  mkdirSync,
  existsSync,
  readdirSync,
  statSync,
  lstatSync,
  rmSync,
  writeFileSync,
  realpathSync,
} from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { dirname, join, relative, resolve, sep, isAbsolute } from "node:path";
import { SestinaError, SestinaErrorCode } from "@sestina/schema";
import type { StorageDatabase } from "./connection.js";
import { checkDatabaseIntegrity } from "./integrity.js";
import { mapFsError } from "./maintenance-domain.js";

export interface BackupOptions {
  backupDirectory: string;
  /** Optional data root; when set, the backup directory must live inside it. */
  dataRoot?: string;
}

export interface BackupResult {
  path: string;
  hash: string;
  version: number;
  sizeBytes: number;
}

const BACKUP_NAME_PATTERN = /^sestina-v\d+-backup-[\w-]+\.sqlite$/;

/** Streams the file through SHA-256 without loading it fully into memory. */
export async function hashFile(path: string): Promise<string> {
  return new Promise((resolveHash, rejectHash) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk as Buffer));
    stream.on("end", () => { resolveHash(hash.digest("hex")); });
    stream.on("error", rejectHash);
  });
}

/**
 * Creates a local SQLite backup with its version and SHA-256 hash recorded
 * in a `.sha256` sidecar (docs/17 §10, docs/22 Task 5). The backup file is
 * integrity-checked before it is reported.
 */
export async function backupDatabase(
  db: StorageDatabase,
  options: BackupOptions,
): Promise<BackupResult> {
  if (options.dataRoot) {
    assertInsideRoot(options.dataRoot, options.backupDirectory, "backup directory");
  }
  try {
    mkdirSync(options.backupDirectory, { recursive: true });
  } catch (err) {
    throw mapFsError(err, "Failed to create the backup directory");
  }

  const version = readSchemaVersion(db);
  const suffix = randomBytes(6).toString("hex");
  const path = join(options.backupDirectory, `sestina-v${version}-backup-${Date.now()}-${suffix}.sqlite`);

  await sqliteBackup(db.raw, path);

  let hash: string;
  try {
    hash = await hashFile(path);
  } catch (err) {
    rmSync(path, { force: true });
    throw mapFsError(err, "Failed to hash the backup file");
  }
  writeFileSync(`${path}.sha256`, `${hash}\n`, "utf8");

  const integrity = checkDatabaseIntegrity(path);
  if (!integrity.ok) {
    rmSync(path, { force: true });
    rmSync(`${path}.sha256`, { force: true });
    throw new SestinaError(
      SestinaErrorCode.database_corrupt,
      "Backup verification failed",
    );
  }

  return { path, hash, version, sizeBytes: statSync(path).size };
}

/**
 * Prunes old migration backups down to the most recent `keep`
 * (default 3, docs/17 §10). Only files matching the Sestina backup
 * naming pattern are ever touched.
 */
export function pruneOldBackups(
  directory: string,
  options: { keep?: number } = {},
): string[] {
  const keep = options.keep ?? 3;
  if (!Number.isSafeInteger(keep) || keep < 1) {
    throw new SestinaError(
      SestinaErrorCode.validation_failed,
      "keep must be a positive safe integer",
    );
  }
  if (!existsSync(directory)) return [];
  const files = readdirSync(directory)
    .filter((name) => BACKUP_NAME_PATTERN.test(name))
    .sort((a, b) => {
      const ma = statSync(join(directory, a)).mtimeMs;
      const mb = statSync(join(directory, b)).mtimeMs;
      return ma - mb; // oldest first
    });
  const toDelete = files.slice(0, Math.max(0, files.length - keep));
  for (const name of toDelete) {
    rmSync(join(directory, name), { force: true });
    rmSync(join(directory, `${name}.sha256`), { force: true });
  }
  return toDelete;
}

export function readSchemaVersion(db: StorageDatabase): number {
  try {
    const row = db.get<{ v: number }>(
      "SELECT COALESCE(MAX(version), 0) AS v FROM migrations WHERE status = 'completed'",
    );
    return row?.v ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Rejects targets outside the given data root (symlink/junction safe:
 * the final component is lstat-resolved so existing symlinks pointing
 * outside the root are caught, and the nearest existing ancestor is
 * realpath-resolved, docs/17 §10).
 */
export function assertInsideRoot(root: string, target: string, label: string): void {
  const rootReal = resolve(realpathSync(root));
  let probe = resolve(target);
  try {
    // lstat sees symlinks/junctions even when the link target is missing.
    lstatSync(probe);
    probe = resolve(realpathSync(probe));
  } catch {
    while (!existsSync(probe)) {
      const parent = dirname(probe);
      if (parent === probe) break;
      probe = parent;
    }
    probe = resolve(realpathSync(probe));
  }
  const rel = relative(rootReal, probe);
  if (rel !== "" && (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))) {
    throw new SestinaError(
      SestinaErrorCode.validation_failed,
      `${label} must be inside the Sestina data directory`,
    );
  }
}
