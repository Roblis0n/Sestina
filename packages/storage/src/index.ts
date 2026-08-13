// Connection and pragmas
export {
  openDatabase,
  StorageDatabase,
  type OpenDatabaseOptions,
  type QueryResult,
} from "./connection.js";
export { applySecurityPragmas, DEFAULT_BUSY_TIMEOUT_MS } from "./pragmas.js";

// Errors
export {
  mapSqliteError,
  sqliteErrcode,
  SQLITE_ERROR,
  SQLITE_BUSY,
  SQLITE_LOCKED,
  SQLITE_READONLY,
  SQLITE_CORRUPT,
  SQLITE_FULL,
  SQLITE_NOTADB,
  type SqliteErrorShape,
} from "./errors.js";

// Transactions
export {
  withTransaction,
  inWriteTransaction,
  type StorageTransaction,
} from "./transaction.js";

// Migrations
export {
  MigrationRunner,
  MIGRATIONS,
  SCHEMA_VERSION,
  RUNTIME_VERSION,
  type Migration,
  type MigrationJournalStatus,
  type MigrationRunnerOptions,
  type MigrationRunResult,
} from "./migrator.js";
export { migration001 } from "./migrations/001-initial.js";
export { migration002 } from "./migrations/002-fts.js";

// Leases
export {
  claimEventLease,
  completeEventLease,
  claimMessageDeliveryLease,
  releaseMessageDeliveryLease,
  DEFAULT_EVENT_LEASE_TTL_MS,
  DEFAULT_DELIVERY_LEASE_TTL_MS,
  type EventLease,
  type EventLeaseInput,
  type ClaimEventLeaseResult,
  type MessageDeliveryLeaseInput,
  type ClaimMessageDeliveryLeaseResult,
} from "./lease.js";

// Maintenance
export { MaintenanceLock, DEFAULT_MAINTENANCE_LOCK_TTL_MS } from "./maintenance-lock.js";

// Backup and restore
export {
  backupDatabase,
  pruneOldBackups,
  hashFile,
  assertInsideRoot,
  readSchemaVersion,
  type BackupOptions,
  type BackupResult,
} from "./backup.js";
export {
  restoreDatabase,
  type RestoreOptions,
  type RestoreResult,
} from "./restore.js";

// Integrity
export {
  checkDatabaseIntegrity,
  assertDatabaseHealthy,
  type IntegrityCheckMode,
  type IntegrityResult,
} from "./integrity.js";

// JSON columns go through schema before storage
export { validateJson, type SchemaLike } from "./schema-check.js";
