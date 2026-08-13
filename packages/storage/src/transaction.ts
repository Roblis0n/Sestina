import { StorageDatabase, type QueryResult } from "./connection.js";

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

class TransactionView implements StorageTransaction {
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

const savepointCounters = new WeakMap<StorageDatabase, number>();

/**
 * Runs `fn` inside a short write transaction (BEGIN IMMEDIATE).
 * If the unit throws, the whole unit is rolled back.
 *
 * Invariant (docs/17 §3.2, docs/22 Task 5): provider network calls and host
 * delivery must never happen inside this transaction — write pending state,
 * COMMIT, call the host, then complete with a conditional update.
 *
 * Nested calls on the same connection use SAVEPOINTs so an inner failure
 * rolls back only the inner unit.
 *
 * Synchronous units commit synchronously: node:sqlite's busy-wait is
 * synchronous, so yielding to the microtask queue between BEGIN and COMMIT
 * would let other connections block the whole thread while the lock is
 * held. Only genuinely async units (an await point inside fn) ever yield.
 */
export async function withTransaction<T>(
  db: StorageDatabase,
  fn: (tx: StorageTransaction) => T | Promise<T>,
): Promise<T> {
  db.assertWritable();
  const tx = new TransactionView(db);

  if (db.isTransaction) {
    const n = (savepointCounters.get(db) ?? 0) + 1;
    savepointCounters.set(db, n);
    const savepoint = `sp_task5_${n}`;
    db.exec(`SAVEPOINT ${savepoint}`);
    return runUnit(callUnit(fn, tx, () => {
      db.exec(`ROLLBACK TO ${savepoint}`);
      db.exec(`RELEASE ${savepoint}`);
    }), {
      commit: () => { db.exec(`RELEASE ${savepoint}`); },
      rollback: () => {
        db.exec(`ROLLBACK TO ${savepoint}`);
        db.exec(`RELEASE ${savepoint}`);
      },
    });
  }

  db.exec("BEGIN IMMEDIATE");
  return runUnit(callUnit(fn, tx, () => { db.exec("ROLLBACK"); }), {
    commit: () => { db.exec("COMMIT"); },
    rollback: () => { db.exec("ROLLBACK"); },
  });
}

/** Invokes the unit; a synchronous throw rolls back immediately. */
function callUnit<T>(
  fn: (tx: StorageTransaction) => T | Promise<T>,
  tx: StorageTransaction,
  rollback: () => void,
): T | Promise<T> {
  try {
    return fn(tx);
  } catch (err) {
    safeRollback({ rollback });
    throw err;
  }
}

function runUnit<T>(
  result: T | Promise<T>,
  ops: { commit: () => void; rollback: () => void },
): Promise<T> {
  if (result !== null && typeof result === "object" && "then" in result) {
    const promise = result;
    return promise.then(
      (value) => {
        try {
          ops.commit();
          return value;
        } catch (err) {
          // A failed COMMIT must never leave the connection inside a
          // half-open transaction.
          safeRollback(ops);
          throw err;
        }
      },
      (err: unknown) => {
        safeRollback(ops);
        throw err;
      },
    );
  }
  // Synchronous unit: commit without yielding to the event loop.
  try {
    ops.commit();
    return Promise.resolve(result);
  } catch (err) {
    safeRollback(ops);
    throw err;
  }
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
