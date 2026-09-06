// Connection and pragmas
export { KERNEL_MIGRATIONS, KERNEL_SCHEMA_VERSION, KERNEL_CANONICAL_TABLES, KERNEL_WORKFLOW_TABLES, KERNEL_LEGACY_TABLES, hasKernelSchema } from "./kernel-schema.js";
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
  SQLITE_CANTOPEN,
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
  withReadSnapshot,
  inWriteTransaction,
  createTransactionView,
  type StorageTransaction,
} from "./transaction.js";

// Migrations
export {
  MigrationRunner,
  MIGRATIONS,
  MIGRATION_MANIFEST_VERSION,
  SCHEMA_VERSION,
  RUNTIME_VERSION,
  type Migration,
  type MigrationJournalStatus,
  type MigrationRunnerOptions,
  type MigrationRunResult,
} from "./migrator.js";
export { migration001 } from "./migrations/001-initial.js";
export { migration002 } from "./migrations/002-fts.js";
export { migration003 } from "./migrations/003-maintenance-fencing.js";
export { migration006 } from "./migrations/006-retention-snapshot.js";
export { migration007 } from "./migrations/007-keyset-indexes.js";
export { migration009 } from "./migrations/009-project-scope.js";
export { migration013 } from "./migrations/013-research-core.js";
export { migration014 } from "./migrations/014-review-runs.js";
export { migration015 } from "./migrations/015-argument-graph.js";
export { migration016 } from "./migrations/016-research-room.js";
export { migration017 } from "./migrations/017-correction-appeals.js";
export { migration018 } from "./migrations/018-deliberation-rooms.js";
export { migration019 } from "./migrations/019-project-working-memory.js";
export { migration020 } from "./migrations/020-closed-external-app-pilots.js";

// Leases
export {
  claimEventLease,
  completeEventLease,
  claimMessageDeliveryLease,
  releaseMessageDeliveryLease,
  validateLeaseTtlMs,
  DEFAULT_EVENT_LEASE_TTL_MS,
  DEFAULT_DELIVERY_LEASE_TTL_MS,
  type EventLease,
  type EventLeaseInput,
  type ClaimEventLeaseKind,
  type EventLeaseClaim,
  type MessageDeliveryLeaseInput,
  type ClaimMessageDeliveryLeaseKind,
  type MessageDeliveryLeaseClaim,
  type DeliveryCredential,
  assertDeliveryCredential,
} from "./lease.js";

// Maintenance
export { MaintenanceLock, DEFAULT_MAINTENANCE_LOCK_TTL_MS } from "./maintenance-lock.js";
export {
  MaintenanceGuard,
  maintenanceRootOf,
  maintenanceLockDbPath,
  MAINTENANCE_LOCK_DB_NAME,
  DEFAULT_MAINTENANCE_BUSY_TIMEOUT_MS,
  type MaintenanceGuardOptions,
} from "./maintenance-domain.js";
export { mapFsError } from "./maintenance-domain.js";
export { mapFsError as mapMaintenanceFsError } from "./maintenance-domain.js";

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
  stageVerifiedCopy,
  canonicalizeForIo,
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

// Migration manifest
export { migration004 } from "./migrations/004-activity-stream.js";

// ── Task 6: repositories, streams, search, retention, exports ──
export { createUnitOfWork, type StorageUnitOfWork } from "./unit-of-work.js";
export {
  nextStreamSequence,
  encodeEventCursor,
  decodeEventCursor,
  type EventCursor,
} from "./stream-sequence.js";
export { search, type SearchQuery, type SearchRow, type SearchKind } from "./search.js";
export {
  previewRetention,
  applyRetentionPreview,
  sha256,
  type RetentionConfig,
  type RetentionTarget,
  type RetentionMembers,
  type RetentionPreview,
  type RetentionResult,
  type RetentionApplyOptions,
} from "./retention.js";
export {
  createTombstoneRepository,
  TombstoneSchema,
  type Tombstone,
  type TombstoneRepository,
} from "./tombstones.js";
export {
  exportProject,
  minimiseJson,
  clearExportByMetadata,
  ensureExportDir,
  ExportManifestSchema,
  ExportMetadataSchema,
  type ExportOptions,
  type ExportFile,
  type ExportResult,
  type ExportManifest,
} from "./exports.js";
export type {
  ProjectRepository,
} from "./repositories/projects.js";
export type {
  TaskRepository,
} from "./repositories/tasks.js";
export type {
  HostSessionRepository,
  HostSessionRecord,
} from "./repositories/sessions.js";
export type {
  RootBindingRepository,
  RootBindingRecord,
} from "./repositories/root-bindings.js";
export type {
  SessionAttachmentRepository,
} from "./repositories/session-attachments.js";
export type {
  UnownedActivityRepository,
} from "./repositories/uowned-activity.js";
export type {
  ContractRepository,
} from "./repositories/contracts.js";
export type {
  CorrectionRepository,
} from "./repositories/corrections.js";
export type {
  EventRepository,
  EventReserveResult,
} from "./repositories/events.js";
export type {
  DecisionRepository,
} from "./repositories/decisions.js";
export type {
  DecisionTraceRepository,
} from "./repositories/traces.js";
export type {
  AssertionRepository,
} from "./repositories/assertions.js";
export type {
  EvidenceRepository,
} from "./repositories/evidence.js";
export type {
  ClaimRepository,
} from "./repositories/claims.js";
export type {
  DeliverableRepository,
} from "./repositories/deliverables.js";
export type {
  ConversationRepository,
} from "./repositories/conversations.js";
export type {
  CollaborationRepository,
  DeliveryReserveResult,
} from "./repositories/collaboration.js";
export type {
  ReviewRepository,
} from "./repositories/reviews.js";
export type {
  HostStreamRepository,
} from "./repositories/host-stream.js";
export type {
  NotificationRepository,
} from "./repositories/notifications.js";
export type {
  UsageRepository,
} from "./repositories/usage.js";
export type { CursorInput, Page } from "./repositories/shared.js";
export { keysetPage } from "./repositories/shared.js";
export { verifyKernelLegacyShape, verifyKernelTargetShape, kernelTableFingerprint } from "./kernel-legacy.js";
