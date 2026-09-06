import { randomUUID, createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  statfs,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import {
  openDatabase,
  MaintenanceGuard,
  KERNEL_MIGRATIONS,
  verifyKernelLegacyShape,
  kernelTableFingerprint,
  type StorageDatabase,
} from "@sestina/storage";
import {
  backfillKernelProject,
  validateKernelDatabase,
  kernelBriefDocument,
} from "@sestina/research-store";
import { KernelFault, kernelCanonicalJson } from "@sestina/research";
import { openSestina } from "./sestina-core.js";

const DB = "state.sqlite";
const BRIEF = "research-brief.yaml";
const JOURNAL = ".kernel-migration.json";
const stages = [
  "previewed",
  "copied",
  "migrating",
  "validated",
  "swapped",
  "failed",
  "rolled_back",
] as const;
export type KernelMigrationStage = (typeof stages)[number];
export type KernelMigrationFaultPoint =
  | "before_backup"
  | "backup_verified"
  | "copied"
  | `migration_${21 | 22 | 23 | 24 | 25}`
  | "backfilled"
  | "before_validation"
  | "validated"
  | "before_swap"
  | "old_moved"
  | "database_installed"
  | "brief_installed"
  | "before_completion";
export class KernelMigrationError extends Error {
  constructor(
    readonly code:
      | "invalid_project"
      | "source_changed"
      | "too_new"
      | "partial_schema"
      | "maintenance_busy"
      | "migration_failed"
      | "recovery_required",
  ) {
    super(code);
    this.name = "KernelMigrationError";
  }
}
export interface KernelMigrationPreview {
  readonly projectId: string;
  readonly sourceSchema: number;
  readonly targetSchema: 25;
  readonly sourceDatabaseHash: string;
  readonly sourceBriefHash: string | null;
  readonly sourceWalHash: string | null;
  readonly sourceBytes: number;
  readonly estimatedRequiredBytes: number;
  readonly tables: readonly {
    name: string;
    rows: number;
    contentHash: string;
    disposition:
      | "canonical_preserved"
      | "history_readonly"
      | "derived_rebuild"
      | "migration_metadata";
  }[];
}
interface Journal {
  schemaVersion: "1.0.0";
  intent: "upgrade" | "restore_backup";
  runId: string;
  projectId: string;
  sourceSchema: number;
  targetSchema: 25;
  sourceDatabaseHash: string;
  sourceBriefHash: string | null;
  sourceWalHash: string | null;
  backupDatabaseHash: string | null;
  backupBriefHash: string | null;
  targetDatabaseHash: string | null;
  targetBriefHash: string | null;
  stage: KernelMigrationStage;
  swapProgress: "none" | "old_moved" | "database_installed" | "brief_installed";
  completedMigrationVersions: number[];
  failureCode: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface KernelMigrationOptions {
  readonly projectRoot: string;
  readonly faultInjection?: (
    point: KernelMigrationFaultPoint,
  ) => void | Promise<void>;
}
function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) fail("invalid_project");
  return value;
}
function fail(code: KernelMigrationError["code"]): never {
  throw new KernelMigrationError(code);
}
const sha = (value: Uint8Array | string) =>
  createHash("sha256").update(value).digest("hex");
async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (e) {
    if ((e as { code?: string }).code === "ENOENT") return false;
    throw e;
  }
}
async function file(
  path: string,
  optional = false,
  max = 16 * 1024 ** 3,
): Promise<Buffer | null> {
  if (optional && !(await exists(path))) return null;
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > max)
    fail("invalid_project");
  const bytes = await readFile(path);
  if (bytes.byteLength !== info.size) fail("source_changed");
  return bytes;
}
async function paths(projectRoot: string) {
  const root = resolve(projectRoot);
  const data = join(root, ".sestina");
  for (const path of [root, data]) {
    const s = await lstat(path).catch(() => fail("invalid_project"));
    if (!s.isDirectory() || s.isSymbolicLink()) fail("invalid_project");
  }
  return {
    root,
    data,
    database: join(data, DB),
    brief: join(data, BRIEF),
    journal: join(data, JOURNAL),
    runs: join(data, "kernel-migrations"),
  };
}
async function durableWrite(
  path: string,
  bytes: string | Buffer,
  exclusive = false,
) {
  const handle = await open(path, exclusive ? "wx" : "w", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function saveJournal(path: string, journal: Journal) {
  journal.updatedAt = new Date().toISOString();
  const temp = `${path}.${journal.runId}.tmp`;
  await durableWrite(temp, kernelCanonicalJson(journal) + "\n");
  await rename(temp, path);
}
async function readJournal(path: string): Promise<Journal | null> {
  if (!(await exists(path))) return null;
  const bytes = await file(path, false, 65_536);
  let v: unknown;
  try {
    v = JSON.parse(required(bytes).toString("utf8"));
  } catch {
    fail("recovery_required");
  }
  if (!v || typeof v !== "object" || Array.isArray(v))
    fail("recovery_required");
  const j = v as Record<string, unknown>;
  const keys = [
    "schemaVersion",
    "intent",
    "runId",
    "projectId",
    "sourceSchema",
    "targetSchema",
    "sourceDatabaseHash",
    "sourceBriefHash",
    "sourceWalHash",
    "backupDatabaseHash",
    "backupBriefHash",
    "targetDatabaseHash",
    "targetBriefHash",
    "stage",
    "swapProgress",
    "completedMigrationVersions",
    "failureCode",
    "createdAt",
    "updatedAt",
  ];
  if (
    Object.keys(j).length !== keys.length ||
    Object.keys(j).some((key) => !keys.includes(key)) ||
    j.schemaVersion !== "1.0.0" ||
    !["upgrade", "restore_backup"].includes(String(j.intent)) ||
    typeof j.runId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      j.runId,
    ) ||
    typeof j.projectId !== "string" ||
    !/^rprj_[0-9A-HJKMNP-TV-Z]{26}$/.test(j.projectId) ||
    typeof j.sourceSchema !== "number" ||
    !Number.isInteger(j.sourceSchema) ||
    j.sourceSchema < 16 ||
    j.sourceSchema > 20 ||
    j.targetSchema !== 25 ||
    !stages.includes(j.stage as KernelMigrationStage) ||
    !["none", "old_moved", "database_installed", "brief_installed"].includes(
      String(j.swapProgress),
    )
  )
    fail("recovery_required");
  for (const hash of [
    j.sourceDatabaseHash,
    j.sourceBriefHash,
    j.sourceWalHash,
    j.backupDatabaseHash,
    j.backupBriefHash,
    j.targetDatabaseHash,
    j.targetBriefHash,
  ])
    if (
      hash !== null &&
      (typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash))
    )
      fail("recovery_required");
  if (
    !Array.isArray(j.completedMigrationVersions) ||
    j.completedMigrationVersions.some(
      (n: unknown) =>
        typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 25,
    )
  )
    fail("recovery_required");
  if (
    typeof j.sourceDatabaseHash !== "string" ||
    typeof j.createdAt !== "string" ||
    typeof j.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(j.createdAt)) ||
    !Number.isFinite(Date.parse(j.updatedAt)) ||
    (j.failureCode !== null &&
      (typeof j.failureCode !== "string" ||
        !/^[a-z_]{1,80}$/.test(j.failureCode)))
  )
    fail("recovery_required");
  return j as unknown as Journal;
}
async function fingerprint(data: string) {
  const database = await file(join(data, DB));
  const brief = await file(join(data, BRIEF), true, 4_194_304);
  const wal = await file(join(data, `${DB}-wal`), true);
  return {
    database: required(database),
    brief,
    wal,
    hashes: {
      sourceDatabaseHash: sha(required(database)),
      sourceBriefHash: brief === null ? null : sha(brief),
      sourceWalHash: wal === null || wal.length === 0 ? null : sha(wal),
    },
  };
}
async function assertFingerprint(
  data: string,
  expected: Pick<
    KernelMigrationPreview,
    "sourceDatabaseHash" | "sourceBriefHash" | "sourceWalHash"
  >,
) {
  const now = (await fingerprint(data)).hashes;
  if (
    now.sourceDatabaseHash !== expected.sourceDatabaseHash ||
    now.sourceBriefHash !== expected.sourceBriefHash ||
    now.sourceWalHash !== expected.sourceWalHash
  )
    fail("source_changed");
}
async function validateLegacy(databasePath: string, brief: Buffer | null) {
  const db = await openDatabase({ path: databasePath, readOnly: true });
  let sourceSchema: number;
  let tables: KernelMigrationPreview["tables"];
  try {
    if (
      db.pragma("integrity_check") !== "ok" ||
      db.all("PRAGMA foreign_key_check").length !== 0
    )
      fail("invalid_project");
    const migrations = db.all<{
      version: number;
      name: string;
      status: string;
    }>("SELECT version,name,status FROM migrations ORDER BY version");
    sourceSchema = migrations.at(-1)?.version ?? 0;
    if (sourceSchema > 20) fail("too_new");
    if (
      sourceSchema < 16 ||
      migrations.length !== sourceSchema ||
      migrations.some(
        (r, i) =>
          r.version !== i + 1 ||
          r.status !== "completed" ||
          r.name !== KERNEL_MIGRATIONS[i]?.name,
      )
    )
      fail("partial_schema");
    verifyKernelLegacyShape(db, sourceSchema);
    tables = db
      .all<{ name: string; sql: string }>(
        "SELECT name,sql FROM sqlite_schema WHERE type='table' ORDER BY name",
      )
      .map((t) => {
        if (!/^[a-z0-9_]+$/.test(t.name)) fail("invalid_project");
        const canonical =
          [
            "research_projects",
            "research_artifacts",
            "artifact_revisions",
            "research_briefs",
            "research_decisions",
            "research_decision_transitions",
            "research_issues",
            "research_issue_transitions",
            "revision_episodes",
            "research_snapshots",
            "project_working_memory",
          ].includes(t.name) || t.name.startsWith("argument_");
        return {
          name: t.name,
          ...kernelTableFingerprint(db, t.name),
          disposition: t.name.startsWith("fts_")
            ? ("derived_rebuild" as const)
            : ["migrations", "maintenance_locks"].includes(t.name)
              ? ("migration_metadata" as const)
              : canonical
                ? ("canonical_preserved" as const)
                : ("history_readonly" as const),
        };
      });
  } finally {
    db.close();
  }
  const opened = await openSestina({ databasePath, readOnly: true });
  if (!opened.ok) fail("invalid_project");
  try {
    const projects = opened.value.listProjects();
    if (!projects.ok || projects.value.length !== 1) fail("invalid_project");
    const projectId = required(projects.value[0]).id;
    const active = opened.value.getActiveBriefProjection(projectId);
    if (!active.ok) fail("invalid_project");
    if (
      active.value
        ? brief?.toString("utf8") !== active.value.yaml
        : brief !== null
    )
      fail("invalid_project");
    return { projectId, sourceSchema, tables };
  } finally {
    opened.value.close();
  }
}
async function copiedSnapshot(data: string) {
  const initial = await fingerprint(data);
  const directory = await mkdtemp(join(tmpdir(), "sestina-migration-inspect-"));
  try {
    await durableWrite(join(directory, DB), initial.database, true);
    if (initial.wal)
      await durableWrite(join(directory, `${DB}-wal`), initial.wal, true);
    if (initial.brief)
      await durableWrite(join(directory, BRIEF), initial.brief, true);
    await assertFingerprint(data, initial.hashes);
    const result = await validateLegacy(join(directory, DB), initial.brief);
    return { initial, result };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
export async function previewKernelMigration(
  projectRoot: string,
): Promise<KernelMigrationPreview> {
  const p = await paths(projectRoot);
  const journal = await readJournal(p.journal);
  if (journal && !["swapped", "rolled_back"].includes(journal.stage))
    fail("recovery_required");
  const { initial, result } = await copiedSnapshot(p.data);
  const sourceBytes =
    initial.database.length +
    (initial.wal?.length ?? 0) +
    (initial.brief?.length ?? 0);
  return {
    ...result,
    targetSchema: 25,
    ...initial.hashes,
    sourceBytes,
    estimatedRequiredBytes: sourceBytes * 4 + 16_777_216,
  };
}
async function guarded(
  projectRoot: string,
  work: (p: Awaited<ReturnType<typeof paths>>) => Promise<unknown>,
) {
  const p = await paths(projectRoot);
  const guard = await MaintenanceGuard.acquire({
    databasePath: p.database,
    scope: "kernel_migration",
    ownerId: "kernel-migration",
    busyTimeoutMs: 1000,
  }).catch(() => fail("maintenance_busy"));
  try {
    return await work(p);
  } finally {
    guard.release();
  }
}
async function verifiedBackup(run: string, journal: Journal) {
  const backup = join(run, "backup");
  for (const directory of [join(run, ".."), run, backup]) {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) fail("recovery_required");
  }
  const source = await fingerprint(backup);
  if (
    sha(source.database) !== journal.backupDatabaseHash ||
    (source.brief === null ? null : sha(source.brief)) !==
      journal.backupBriefHash
  )
    fail("recovery_required");
  const verified = await validateLegacy(join(backup, DB), source.brief);
  if (
    verified.projectId !== journal.projectId ||
    verified.sourceSchema !== journal.sourceSchema
  )
    fail("recovery_required");
  return backup;
}

export async function migrateKernelProject(
  options: KernelMigrationOptions,
): Promise<{
  readonly stage: "swapped";
  readonly runId: string;
  readonly projectId: string;
}> {
  const preview = await previewKernelMigration(options.projectRoot);
  return (await guarded(options.projectRoot, async (p) => {
    await assertFingerprint(p.data, preview);
    const capacity = await statfs(p.data);
    if (capacity.bavail * capacity.bsize < preview.estimatedRequiredBytes)
      fail("invalid_project");
    const existing = await readJournal(p.journal);
    if (existing && !["rolled_back", "swapped"].includes(existing.stage))
      fail("recovery_required");
    if (await exists(p.runs)) {
      const s = await lstat(p.runs);
      if (!s.isDirectory() || s.isSymbolicLink()) fail("invalid_project");
    } else await mkdir(p.runs);
    const runId = randomUUID();
    const run = join(p.runs, runId);
    const stage = join(run, "staging");
    const backup = join(run, "backup");
    const original = join(run, "original");
    await mkdir(run);
    await mkdir(stage);
    await mkdir(backup);
    await mkdir(original);
    const createdAt = new Date().toISOString();
    const journal: Journal = {
      schemaVersion: "1.0.0",
      intent: "upgrade",
      runId,
      projectId: preview.projectId,
      sourceSchema: preview.sourceSchema,
      targetSchema: 25,
      sourceDatabaseHash: preview.sourceDatabaseHash,
      sourceBriefHash: preview.sourceBriefHash,
      sourceWalHash: preview.sourceWalHash,
      backupDatabaseHash: null,
      backupBriefHash: null,
      targetDatabaseHash: null,
      targetBriefHash: null,
      stage: "previewed",
      swapProgress: "none",
      completedMigrationVersions: [],
      failureCode: null,
      createdAt,
      updatedAt: createdAt,
    };
    await saveJournal(p.journal, journal);
    let sourceLock: DatabaseSync | undefined;
    try {
      // The maintenance fence blocks current-runtime transactions. SQLite's
      // write lock additionally detects a writer from an older runtime.
      sourceLock = new DatabaseSync(p.database, { readOnly: true });
      sourceLock.exec("PRAGMA busy_timeout=1000");
      sourceLock.exec("BEGIN IMMEDIATE");
      await assertFingerprint(p.data, preview);
      await options.faultInjection?.("before_backup");
      const input = await fingerprint(p.data);
      await durableWrite(join(backup, DB), input.database, true);
      if (input.wal)
        await durableWrite(join(backup, `${DB}-wal`), input.wal, true);
      if (input.brief)
        await durableWrite(join(backup, BRIEF), input.brief, true);
      // Materialize the WAL in the backup, then validate the bound pair.
      const b = await openDatabase({ path: join(backup, DB), migrate: false });
      try {
        b.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      } finally {
        b.close();
      }
      journal.backupDatabaseHash = sha(required(await file(join(backup, DB))));
      journal.backupBriefHash = input.brief === null ? null : sha(input.brief);
      await verifiedBackup(run, journal);
      await saveJournal(p.journal, journal);
      await options.faultInjection?.("backup_verified");
      await copyFile(join(backup, DB), join(stage, DB));
      if (input.brief) await copyFile(join(backup, BRIEF), join(stage, BRIEF));
      journal.stage = "copied";
      await saveJournal(p.journal, journal);
      await options.faultInjection?.("copied");
      journal.stage = "migrating";
      await saveJournal(p.journal, journal);
      const staged = await openDatabase({
        path: join(stage, DB),
        migrate: {
          migrations: KERNEL_MIGRATIONS,
          backupDirectory: join(stage, "migration-backups"),
          verifiedStagingCopy: true,
          async onMigrationApplied(version) {
            journal.completedMigrationVersions.push(version);
            await saveJournal(p.journal, journal);
            if (version >= 21 && version <= 25)
              await options.faultInjection?.(
                `migration_${version as 21 | 22 | 23 | 24 | 25}`,
              );
          },
        },
      });
      try {
        backfillKernelProject(staged, {
          runId,
          sourceSchema: preview.sourceSchema,
          sourceHash: preview.sourceDatabaseHash,
          backupHash: journal.backupDatabaseHash,
          tableMappings: preview.tables,
          createdAt,
        });
        await options.faultInjection?.("backfilled");
        for (const table of preview.tables.filter((t) =>
          ["canonical_preserved", "history_readonly"].includes(t.disposition),
        )) {
          const actual = kernelTableFingerprint(staged, table.name);
          if (
            actual.rows !== table.rows ||
            actual.contentHash !== table.contentHash
          )
            fail("migration_failed");
        }
        const targetBrief = kernelBriefDocument(staged, preview.projectId);
        await durableWrite(join(stage, BRIEF), targetBrief);
        await options.faultInjection?.("before_validation");
        validateKernelDatabase(staged, preview.projectId, targetBrief);
        staged.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      } finally {
        staged.close();
      }
      journal.targetDatabaseHash = sha(required(await file(join(stage, DB))));
      journal.targetBriefHash = sha(required(await file(join(stage, BRIEF))));
      journal.stage = "validated";
      await saveJournal(p.journal, journal);
      await options.faultInjection?.("validated");
      await verifiedBackup(run, journal);
      await assertFingerprint(p.data, preview);
      await options.faultInjection?.("before_swap");
      sourceLock.exec("ROLLBACK");
      sourceLock.close();
      sourceLock = undefined;
      // Journal intent precedes every pair replacement. Ordinary writable
      // opens refuse any nonterminal journal, so no half-pair can be selected.
      for (const name of [DB, `${DB}-wal`, `${DB}-shm`, BRIEF])
        if (await exists(join(p.data, name)))
          await rename(join(p.data, name), join(original, name));
      journal.swapProgress = "old_moved";
      await saveJournal(p.journal, journal);
      await options.faultInjection?.("old_moved");
      await rename(join(stage, DB), p.database);
      journal.swapProgress = "database_installed";
      await saveJournal(p.journal, journal);
      await options.faultInjection?.("database_installed");
      await rename(join(stage, BRIEF), p.brief);
      journal.swapProgress = "brief_installed";
      await saveJournal(p.journal, journal);
      await options.faultInjection?.("brief_installed");
      const target = await openDatabase({ path: p.database, readOnly: true });
      try {
        validateKernelDatabase(
          target,
          preview.projectId,
          required(await file(p.brief)).toString("utf8"),
        );
      } finally {
        target.close();
      }
      await options.faultInjection?.("before_completion");
      journal.stage = "swapped";
      await saveJournal(p.journal, journal);
      return { stage: "swapped" as const, runId, projectId: preview.projectId };
    } catch (error) {
      if (sourceLock) {
        try {
          sourceLock.exec("ROLLBACK");
        } catch {
          /* preserve failure */
        }
        sourceLock.close();
      }
      journal.stage = "failed";
      journal.failureCode =
        error instanceof KernelMigrationError
          ? error.code
          : error instanceof KernelFault
            ? error.code
            : "migration_failed";
      await saveJournal(p.journal, journal);
      // Recovery is explicit and verifiable; failures never run SQL against
      // the original or silently retry a stage or a Provider request.
      throw new KernelMigrationError("migration_failed");
    }
  })) as { stage: "swapped"; runId: string; projectId: string };
}

export async function recoverKernelMigration(projectRoot: string): Promise<{
  readonly stage: "swapped" | "rolled_back";
  readonly runId: string;
}> {
  return (await guarded(projectRoot, async (p) => {
    const j = await readJournal(p.journal);
    if (!j) fail("recovery_required");
    const run = join(p.runs, j.runId);
    const info = await lstat(run);
    if (!info.isDirectory() || info.isSymbolicLink()) fail("recovery_required");
    if (
      j.intent === "upgrade" &&
      j.targetDatabaseHash &&
      j.targetBriefHash &&
      (await exists(p.database)) &&
      (await exists(p.brief))
    ) {
      const dbBytes = required(await file(p.database));
      const briefBytes = required(await file(p.brief));
      if (
        sha(dbBytes) === j.targetDatabaseHash &&
        sha(briefBytes) === j.targetBriefHash
      ) {
        const db = await openDatabase({ path: p.database, readOnly: true });
        try {
          validateKernelDatabase(db, j.projectId, briefBytes.toString("utf8"));
        } finally {
          db.close();
        }
        j.stage = "swapped";
        j.failureCode = null;
        await saveJournal(p.journal, j);
        return { stage: "swapped" as const, runId: j.runId };
      }
    }
    if (
      j.intent === "upgrade" &&
      j.swapProgress === "none" &&
      (await exists(p.database))
    ) {
      await assertFingerprint(p.data, j);
      j.stage = "rolled_back";
      await saveJournal(p.journal, j);
      return { stage: "rolled_back" as const, runId: j.runId };
    }
    // Only files recorded by this migration may be replaced. Unknown data is preserved.
    if (await exists(p.database)) {
      const hash = sha(required(await file(p.database)));
      if (
        ![
          j.sourceDatabaseHash,
          j.targetDatabaseHash,
          j.backupDatabaseHash,
        ].includes(hash)
      )
        fail("recovery_required");
    }
    if (await exists(p.brief)) {
      const hash = sha(required(await file(p.brief)));
      if (
        ![j.sourceBriefHash, j.targetBriefHash, j.backupBriefHash].includes(
          hash,
        )
      )
        fail("recovery_required");
    }
    const backup = await verifiedBackup(run, j);
    const recovery = join(run, `restore-${randomUUID()}`);
    await mkdir(recovery);
    await copyFile(join(backup, DB), join(recovery, DB));
    if (j.backupBriefHash)
      await copyFile(join(backup, BRIEF), join(recovery, BRIEF));
    const quarantine = join(recovery, "replaced");
    await mkdir(quarantine);
    for (const name of [DB, `${DB}-wal`, `${DB}-shm`, BRIEF])
      if (await exists(join(p.data, name)))
        await rename(join(p.data, name), join(quarantine, name));
    await rename(join(recovery, DB), p.database);
    if (j.backupBriefHash) await rename(join(recovery, BRIEF), p.brief);
    const restored = await validateLegacy(
      p.database,
      await file(p.brief, true, 4_194_304),
    );
    if (
      restored.projectId !== j.projectId ||
      restored.sourceSchema !== j.sourceSchema
    )
      fail("recovery_required");
    j.stage = "rolled_back";
    j.failureCode = null;
    await saveJournal(p.journal, j);
    return { stage: "rolled_back" as const, runId: j.runId };
  })) as { stage: "swapped" | "rolled_back"; runId: string };
}

export async function openKernelProject(
  projectRoot: string,
  readOnly = false,
): Promise<StorageDatabase> {
  const p = await paths(projectRoot);
  const j = await readJournal(p.journal);
  if (j && !["swapped", "rolled_back"].includes(j.stage))
    fail("recovery_required");
  // Decode and validate before any writable SQLite configuration is applied.
  const inspected = await openDatabase({
    path: p.database,
    readOnly: true,
    migrate: false,
  });
  try {
    const projects = inspected.all<{ project_id: string }>(
      "SELECT project_id FROM research_projects",
    );
    if (projects.length !== 1) fail("invalid_project");
    validateKernelDatabase(
      inspected,
      required(projects[0]).project_id,
      required(await file(p.brief)).toString("utf8"),
      true,
    );
    if (readOnly) return inspected;
  } catch (error) {
    inspected.close();
    throw error;
  }
  inspected.close();
  const db = await openDatabase({ path: p.database, migrate: false });
  try {
    const projects = db.all<{ project_id: string }>(
      "SELECT project_id FROM research_projects",
    );
    if (projects.length !== 1) fail("invalid_project");
    validateKernelDatabase(
      db,
      required(projects[0]).project_id,
      required(await file(p.brief)).toString("utf8"),
      true,
    );
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

/** Explicit local maintenance action; restores an immutable old pair, never reverse SQL. */
export async function restoreKernelPreMigrationBackup(
  projectRoot: string,
): Promise<{ readonly stage: "rolled_back"; readonly runId: string }> {
  await guarded(projectRoot, async (p) => {
    const j = await readJournal(p.journal);
    if (j?.stage !== "swapped") fail("recovery_required");
    const current = await openKernelProject(projectRoot, true);
    try {
      // A pre-migration copy may contain text forgotten after migration. This
      // foundation refuses resurrection; it never silently erases a redaction.
      if (
        current.get(
          "SELECT redaction_id FROM research_privacy_redactions WHERE project_id=? AND source_revision>1",
          j.projectId,
        )
      )
        fail("recovery_required");
      await verifiedBackup(join(p.runs, j.runId), j);
      const bytes = await fingerprint(p.data);
      j.targetDatabaseHash = bytes.hashes.sourceDatabaseHash;
      j.targetBriefHash = bytes.hashes.sourceBriefHash;
      j.intent = "restore_backup";
      j.stage = "validated";
      j.failureCode = null;
      await saveJournal(p.journal, j);
    } finally {
      current.close();
    }
  });
  const restored = await recoverKernelMigration(projectRoot);
  if (restored.stage !== "rolled_back") fail("recovery_required");
  return { stage: "rolled_back", runId: restored.runId };
}
