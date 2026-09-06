import { SestinaError, SestinaErrorCode } from "@sestina/schema";
import { StorageDatabase, type QueryResult } from "./connection.js";
import { withMaintenanceReadFence } from "./maintenance-domain.js";

export interface StorageTransaction {
  readonly database: StorageDatabase;
  run(sql: string, ...params: unknown[]): QueryResult;
  // The row type parameter appears only in the return position.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | undefined;
  all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[];
  exec(sql: string): void;
}

/** Builds a transaction view over a database (repositories bind to this). */
export function createTransactionView(db: StorageDatabase): StorageTransaction {
  return new TransactionView(db);
}

class TransactionView implements StorageDatabaseView {
  readonly database: StorageDatabase;

  constructor(db: StorageDatabase) {
    this.database = db;
  }

  run(sql: string, ...params: unknown[]): QueryResult {
    return this.database.run(sql, ...params);
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | undefined {
    return this.database.get<T>(sql, ...params);
  }

  all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
    return this.database.all<T>(sql, ...params);
  }

  exec(sql: string): void {
    this.database.exec(sql);
  }
}

interface StorageDatabaseView {
  readonly database: StorageDatabase;
  run(sql: string, ...params: unknown[]): QueryResult;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | undefined;
  all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[];
  exec(sql: string): void;
}

const savepointCounters = new WeakMap<StorageDatabase, number>();

/**
 * Runs `fn` inside a short write transaction (BEGIN IMMEDIATE).
 * If the unit throws, the whole unit is rolled back.
 *
 * Invariant (docs/17 §3.2, docs/22 Task 5): provider network calls and host
 * delivery must never happen inside this transaction — write pending state,
 * COMMIT, call the host, then complete with a conditional update.
 *
 * **Write units are strictly synchronous.** A unit that returns a Promise
 * (thenable) is rejected with internal_error after an immediate rollback:
 * yielding between BEGIN and COMMIT lets other transactions interleave on
 * the same connection, and nested calls would report success for a
 * SAVEPOINT that a later outer rollback silently undoes.
 *
 * Synchronous nesting on the same connection still uses SAVEPOINTs; note
 * that a nested unit's durability always depends on the outer unit's
 * commit (SAVEPOINT semantics).
 */
export function withTransaction<T>(
  db: StorageDatabase,
  fn: (tx: StorageTransaction) => T,
): T {
  if (!db.isTransaction && !db.maintenanceOwned) return withMaintenanceReadFence(db.path, () => runTransaction(db, fn));
  return runTransaction(db, fn);
}

function runTransaction<T>(db: StorageDatabase, fn: (tx: StorageTransaction) => T): T {
  db.assertWritable();
  const tx = new TransactionView(db);

  if (db.isTransaction) {
    const n = (savepointCounters.get(db) ?? 0) + 1;
    savepointCounters.set(db, n);
    const savepoint = `sp_task5_${n}`;
    db.exec(`SAVEPOINT ${savepoint}`);
    const result = callUnit(fn, tx, () => {
      db.exec(`ROLLBACK TO ${savepoint}`);
      db.exec(`RELEASE ${savepoint}`);
    });
    if (isThenable(result)) {
      safeRollback({
        rollback: () => {
          db.exec(`ROLLBACK TO ${savepoint}`);
          db.exec(`RELEASE ${savepoint}`);
        },
      });
      throw new SestinaError(
        SestinaErrorCode.internal_error,
        "Write units must be synchronous",
      );
    }
    db.exec(`RELEASE ${savepoint}`);
    return result;
  }

  db.exec("BEGIN IMMEDIATE");
  const result = callUnit(fn, tx, () => { db.exec("ROLLBACK"); });
  if (isThenable(result)) {
    safeRollback({ rollback: () => { db.exec("ROLLBACK"); } });
    throw new SestinaError(
      SestinaErrorCode.internal_error,
      "Write units must be synchronous",
    );
  }
  try {
    db.exec("COMMIT");
  } catch (err) {
    // A failed COMMIT must never leave the connection half-open.
    safeRollback({ rollback: () => { db.exec("ROLLBACK"); } });
    throw err;
  }
  return result;
}

/** Invokes the unit; a synchronous throw rolls back immediately. */
function callUnit<T>(
  fn: (tx: StorageTransaction) => T,
  tx: StorageTransaction,
  rollback: () => void,
): T {
  try {
    return fn(tx);
  } catch (err) {
    safeRollback({ rollback });
    throw err;
  }
}

function isThenable(value: unknown): boolean {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function safeRollback(ops: { rollback: () => void }): void {
  try {
    ops.rollback();
  } catch {
    // Preserve the original failure.
  }
}

/** True while the connection holds any transaction (BEGIN or SAVEPOINT). */
export function inWriteTransaction(db: StorageDatabase): boolean {
  return db.isTransaction;
}

/** One synchronous SQLite read snapshot, including read-only connections. */
export function withReadSnapshot<T>(db: StorageDatabase, work: () => T): T {
  if (db.isTransaction) return work();
  db.raw.exec("BEGIN");
  try {
    const value = work();
    if (isThenable(value)) throw new SestinaError(SestinaErrorCode.internal_error, "Snapshots must be synchronous");
    db.raw.exec("COMMIT"); return value;
  } catch (error) { if (inWriteTransaction(db)) db.raw.exec("ROLLBACK"); throw error; }
}
