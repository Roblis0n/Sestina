import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync, constants, type StatementSync } from "node:sqlite";
import { statSync, existsSync, readFileSync } from "node:fs";
import { KERNEL_CANONICAL_TABLES, KERNEL_WORKFLOW_TABLES } from "./kernel-schema.js";
import { SestinaError, SestinaErrorCode } from "@sestina/schema";
import { applySecurityPragmas, DEFAULT_BUSY_TIMEOUT_MS } from "./pragmas.js";
import { mapSqliteError, sqliteErrcode, SQLITE_ERROR, SQLITE_CORRUPT, SQLITE_NOTADB } from "./errors.js";
import { MigrationRunner, MIGRATIONS, type Migration } from "./migrator.js";

export interface OpenDatabaseOptions {
  path: string;
  readOnly?: boolean;
  /**
   * Opens a read-only file as an immutable SQLite URI. This prevents SQLite
   * from creating WAL/SHM sidecars and must never be used for writable opens.
   */
  immutable?: boolean;
  busyTimeoutMs?: number;
  /**
   * Defaults to true on writable opens. Pass false to skip migrations,
   * or an object to override the migration set / backup directory.
   * `migrate: false` is a diagnostics escape hatch: it skips the
   * schema-too-new guard as well, so callers must not use it for normal
   * writable operation.
   */
  migrate?: boolean | { backupDirectory?: string; migrations?: readonly Migration[]; verifiedStagingCopy?: boolean; onMigrationApplied?: (version: number) => void | Promise<void> };
}

export interface QueryResult {
  changes: number | bigint;
  lastInsertRowid: number | bigint;
}

/** Values node:sqlite accepts as bind parameters. */
type SqlBindValue = null | number | bigint | string | Uint8Array;

/**
 * Normalises JS values into bindable SQLite parameters. Plain objects are
 * NEVER silently stringified: JSON columns must pass their schema first
 * (validateJson) — callers that need JSON pass the validated string.
 */
function normalizeParams(params: unknown[]): SqlBindValue[] {
  return params.map((p): SqlBindValue => {
    if (p === undefined) return null;
    if (typeof p === "boolean") return p ? 1 : 0;
    if (typeof p === "string" || typeof p === "number" || typeof p === "bigint") {
      return p;
    }
    if (p === null) return null;
    if (p instanceof Uint8Array) return p;
    throw new TypeError("Unsupported bind parameter type — pass schema-validated JSON strings");
  });
}

const PRAGMA_NAME_PATTERN = /^[a-z_]+$/i;

/**
 * node:sqlite has no statement-release API, so each connection caches its
 * prepared statements (bounded LRU) to avoid unbounded growth on long-lived
 * background connections.
 */
const STATEMENT_CACHE_LIMIT = 100;

export class StorageDatabase {
  readonly path: string;
  readonly readOnly: boolean;
  private readonly rawDb: DatabaseSync;
  private readonly statementCache = new Map<string, StatementSync>();
  private closed = false;
  private kernelPolicy = false;
  /** Set only by the owner of the external maintenance guard. */
  maintenanceOwned = false;
  private kernelMode: "none" | "workflow" | "canonical" | "migration" = "none";
  private readonly fileIdentity: string;

  constructor(path: string, raw: DatabaseSync, readOnly: boolean) {
    this.path = path;
    this.rawDb = raw;
    this.readOnly = readOnly;
    const info = statSync(path); this.fileIdentity = `${info.dev}:${info.ino}`;
  }

  /** Storage capability only. The Kernel owns authorization and project scope. */
  withKernelWrite<T>(mode: "workflow" | "canonical" | "migration", work: () => T): T {
    if (!this.isTransaction) throw new SestinaError(SestinaErrorCode.internal_error, "Kernel writes require an enclosing transaction");
    const before = this.kernelMode;
    if (before === "workflow" && mode !== "workflow") throw new SestinaError(SestinaErrorCode.database_readonly, "Workflow cannot acquire canonical write access");
    this.kernelMode = before === "canonical" || before === "migration" ? before : mode;
    this.refreshKernelAuthorizer();
    try {
      const result = work();
      if (result !== null && typeof result === "object" && "then" in result) throw new SestinaError(SestinaErrorCode.internal_error, "Kernel writes must be synchronous");
      return result;
    } finally { this.kernelMode = before; this.refreshKernelAuthorizer(); }
  }

  enableKernelWriteBoundary(): void { this.kernelPolicy = true; this.refreshKernelAuthorizer(); }
  get isKernelCanonicalWrite(): boolean { return this.kernelMode === "canonical" || this.kernelMode === "migration"; }
  private refreshKernelAuthorizer(): void {
    if (!this.kernelPolicy) return;
    this.statementCache.clear();
    // setAuthorizer invalidates previously compiled SQLite statements too.
    // Keep trusted_schema OFF; no unsafe user SQL functions are installed.
    this.rawDb.setAuthorizer((action, table, argument) => {
      if (this.kernelMode === "migration") return constants.SQLITE_OK;
      if ([constants.SQLITE_SELECT, constants.SQLITE_READ, constants.SQLITE_FUNCTION, constants.SQLITE_TRANSACTION, constants.SQLITE_SAVEPOINT, constants.SQLITE_RECURSIVE].includes(action)) return constants.SQLITE_OK;
      if ([constants.SQLITE_INSERT, constants.SQLITE_UPDATE, constants.SQLITE_DELETE].includes(action)) {
        const workflow = (KERNEL_WORKFLOW_TABLES as readonly string[]).includes(table ?? "") && table !== "research_projection_outbox";
        const canonical = (KERNEL_CANONICAL_TABLES as readonly string[]).includes(table ?? "") || table === "research_projection_outbox";
        return this.kernelMode === "canonical" && (canonical || workflow) || this.kernelMode === "workflow" && workflow ? constants.SQLITE_OK : constants.SQLITE_DENY;
      }
      // PRAGMA integrity/foreign-key diagnostics are reads; setters, ATTACH,
      // schema mutation and writable_schema are never exposed by this mode.
      if (action === constants.SQLITE_PRAGMA) {
        const diagnostics = ["integrity_check", "quick_check", "foreign_key_check", "foreign_keys", "journal_mode", "table_info", "index_list", "index_info", "foreign_key_list", "wal_checkpoint", "data_version"];
        return diagnostics.includes(table ?? "") && (argument === null || ["table_info", "index_list", "index_info", "foreign_key_list", "wal_checkpoint"].includes(table ?? "")) ? constants.SQLITE_OK : constants.SQLITE_DENY;
      }
      return constants.SQLITE_DENY;
    });
  }

  /** The underlying node:sqlite handle (advanced/diagnostics only). */
  get raw(): DatabaseSync {
    this.ensureOpen();
    return this.rawDb;
  }

  /** True while a BEGIN/SAVEPOINT transaction is active on this connection. */
  get isTransaction(): boolean {
    this.ensureOpen();
    return this.rawDb.isTransaction;
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new SestinaError(SestinaErrorCode.internal_error, "Database is closed");
    }
  }

  assertWritable(): void {
    if (this.readOnly) {
      throw new SestinaError(
        SestinaErrorCode.database_readonly,
        "Database is open read-only",
      );
    }
    const info = statSync(this.path);
    if (`${info.dev}:${info.ino}` !== this.fileIdentity) throw new SestinaError(SestinaErrorCode.stale_state, "Database was replaced; reopen the project");
    if (!this.maintenanceOwned) assertNoIncompleteKernelMigration(this.path);
  }

  /**
   * Reads a scalar PRAGMA value (e.g. pragma("journal_mode") === "wal").
   * Only plain query pragmas are accepted — setter forms ("name=value")
   * are rejected so this public method cannot mutate connection settings.
   */
  pragma(name: string): unknown {
    if (!PRAGMA_NAME_PATTERN.test(name)) {
      throw new SestinaError(
        SestinaErrorCode.validation_failed,
        "Invalid PRAGMA name",
      );
    }
    this.ensureOpen();
    try {
      const row = this.prepareCached(`PRAGMA ${name}`).get() as
        | Record<string, unknown>
        | undefined;
      if (!row) return undefined;
      const values = Object.values(row);
      return values[0];
    } catch (err) {
      throw mapSqliteError(err, "PRAGMA query failed");
    }
  }

  exec(sql: string): void {
    this.ensureOpen();
    this.assertWritable();
    try {
      this.rawDb.exec(sql);
    } catch (err) {
      throw mapSqliteError(err, "Database statement failed");
    }
  }

  run(sql: string, ...params: unknown[]): QueryResult {
    this.ensureOpen();
    this.assertWritable();
    try {
      return this.prepareCached(sql).run(...normalizeParams(params));
    } catch (err) {
      throw mapSqliteError(err, "Database write failed");
    }
  }

  // The row type parameter appears only in the return position.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | undefined {
    this.ensureOpen();
    try {
      return this.prepareCached(sql).get(...normalizeParams(params)) as T | undefined;
    } catch (err) {
      throw mapSqliteError(err, "Database query failed");
    }
  }

  all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
    this.ensureOpen();
    try {
      return this.prepareCached(sql).all(...normalizeParams(params)) as T[];
    } catch (err) {
      throw mapSqliteError(err, "Database query failed");
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.statementCache.clear();
    this.rawDb.close();
  }

  /** Bounded per-connection statement cache (node:sqlite lacks finalize). */
  private prepareCached(sql: string): StatementSync {
    const existing = this.statementCache.get(sql);
    if (existing) {
      // LRU refresh: move to the end.
      this.statementCache.delete(sql);
      this.statementCache.set(sql, existing);
      return existing;
    }
    const statement = this.rawDb.prepare(sql);
    this.statementCache.set(sql, statement);
    while (this.statementCache.size > STATEMENT_CACHE_LIMIT) {
      const oldest = this.statementCache.keys().next().value;
      if (oldest === undefined) break;
      this.statementCache.delete(oldest);
    }
    return statement;
  }
}

/**
 * Opens a Sestina database with the documented security baseline and,
 * on writable opens, applies pending migrations (docs/17 §3.1, docs/09 §22).
 */
export async function openDatabase(options: OpenDatabaseOptions): Promise<StorageDatabase> {
  const readOnly = options.readOnly ?? false;
  if (!readOnly) assertNoIncompleteKernelMigration(options.path);
  if (!readOnly && typeof options.migrate === "object" &&
      options.migrate.migrations?.some(m => m.version >= 21) &&
      !options.migrate.verifiedStagingCopy && existsSync(options.path) && statSync(options.path).size > 0) {
    // Inspect through a read-only handle before writable PRAGMAs can change
    // even the old database's journal-mode header. Existing upgrades require
    // the Core's verified staging-copy coordinator.
    const inspection = new DatabaseSync(options.path, { readOnly: true });
    const requestedMigrations = options.migrate.migrations;
    try {
      const rows = inspection.prepare("SELECT version,name,status FROM migrations ORDER BY version").all() as { version: number; name: string; status: string }[];
      if (rows.length !== requestedMigrations.length || rows.some((r, i) => r.status !== "completed" || r.version !== requestedMigrations[i]?.version || r.name !== requestedMigrations[i].name))
        throw new SestinaError(SestinaErrorCode.migration_failed, "Existing projects require a verified migration copy");
    } finally { inspection.close(); }
  }
  const immutable = options.immutable ?? false;
  if (immutable && !readOnly) {
    throw new SestinaError(
      SestinaErrorCode.validation_failed,
      "Immutable database opens must be read-only",
    );
  }
  let raw: DatabaseSync;
  try {
    const sqlitePath = immutable
      ? (() => {
          const uri = pathToFileURL(options.path);
          uri.searchParams.set("immutable", "1");
          return uri;
        })()
      : options.path;
    raw = new DatabaseSync(sqlitePath, { open: true, readOnly });
  } catch (err) {
    throw mapSqliteError(err, "Failed to open database");
  }

  const db = new StorageDatabase(options.path, raw, readOnly);
  try {
    applySecurityPragmas(raw, {
      busyTimeoutMs: options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS,
      writable: !readOnly,
    });
  } catch (err) {
    raw.close();
    throw mapSqliteError(err, "Failed to configure the database connection");
  }

  // Canary: a non-SQLite file must be reported as corruption, never replaced.
  // Uses the raw handle so the native errcode is visible. Read-only
  // diagnostics read only the schema page so a damaged table area still
  // allows browsing sqlite_schema (docs/19 §5.3).
  try {
    if (readOnly) {
      raw.prepare("SELECT name FROM sqlite_schema LIMIT 1").get();
    } else {
      raw.prepare("SELECT COUNT(*) AS c FROM migrations").get();
    }
  } catch (err) {
    const errcode = sqliteErrcode(err);
    if (errcode === SQLITE_NOTADB || errcode === SQLITE_CORRUPT) {
      raw.close();
      throw new SestinaError(
        SestinaErrorCode.database_corrupt,
        "The file is not a valid Sestina database",
      );
    }
    if (errcode !== SQLITE_ERROR) {
      // IO errors and the like must not be swallowed.
      raw.close();
      throw mapSqliteError(err, "Failed to read database");
    }
    // SQLITE_ERROR here usually means "no such table: migrations" on a
    // fresh file. A file that already contains tables but no Sestina
    // journal is a foreign database: refuse rather than bootstrap it.
    if (!readOnly) {
      const foreignTables = raw
        .prepare("SELECT COUNT(*) AS c FROM sqlite_schema WHERE type = 'table'")
        .get() as { c: number } | undefined;
      if ((foreignTables?.c ?? 0) > 0) {
        raw.close();
        throw new SestinaError(
          SestinaErrorCode.database_corrupt,
          "The file is not a Sestina database",
        );
      }
    }
  }

  if (!readOnly && options.migrate !== false) {
    const migrateOpts = typeof options.migrate === "object" ? options.migrate : {};
    const runner = new MigrationRunner(
      db,
      migrateOpts.migrations ?? MIGRATIONS,
      {
        // Destructive migrations on an existing database are always backed
        // up (docs/17 §10); the default location is next to the database.
        backupDirectory: migrateOpts.backupDirectory ?? join(dirname(options.path), "backups"),
        verifiedStagingCopy: migrateOpts.verifiedStagingCopy,
        onMigrationApplied: migrateOpts.onMigrationApplied,
      },
    );
    try {
      await runner.run();
    } catch (err) {
      raw.close();
      throw err;
    }
  }

  if (db.get("SELECT name FROM sqlite_schema WHERE type='table' AND name='research_project_state_heads'")) db.enableKernelWriteBoundary();
  return db;
}

function assertNoIncompleteKernelMigration(databasePath: string): void {
  const journal = join(dirname(databasePath), ".kernel-migration.json");
  if (!existsSync(journal)) return;
  try {
    if (statSync(journal).size > 65_536) throw new Error("oversize");
    const value = JSON.parse(readFileSync(journal, "utf8")) as { schemaVersion?: unknown; stage?: unknown };
    if (value.schemaVersion !== "1.0.0" || !["swapped", "rolled_back"].includes(String(value.stage))) throw new Error("incomplete");
  } catch { throw new SestinaError(SestinaErrorCode.migration_failed, "Kernel migration requires recovery before writing"); }
}
