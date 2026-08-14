import { dirname, join } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { SestinaError, SestinaErrorCode } from "@sestina/schema";
import { applySecurityPragmas, DEFAULT_BUSY_TIMEOUT_MS } from "./pragmas.js";
import { mapSqliteError, sqliteErrcode, SQLITE_ERROR, SQLITE_CORRUPT, SQLITE_NOTADB } from "./errors.js";
import { MigrationRunner, MIGRATIONS, type Migration } from "./migrator.js";

export interface OpenDatabaseOptions {
  path: string;
  readOnly?: boolean;
  busyTimeoutMs?: number;
  /**
   * Defaults to true on writable opens. Pass false to skip migrations,
   * or an object to override the migration set / backup directory.
   * `migrate: false` is a diagnostics escape hatch: it skips the
   * schema-too-new guard as well, so callers must not use it for normal
   * writable operation.
   */
  migrate?: boolean | { backupDirectory?: string; migrations?: readonly Migration[] };
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

  constructor(path: string, raw: DatabaseSync, readOnly: boolean) {
    this.path = path;
    this.rawDb = raw;
    this.readOnly = readOnly;
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
  let raw: DatabaseSync;
  try {
    raw = new DatabaseSync(options.path, { open: true, readOnly });
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
      },
    );
    try {
      await runner.run();
    } catch (err) {
      raw.close();
      throw err;
    }
  }

  return db;
}
