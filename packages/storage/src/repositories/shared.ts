import {
  ActorProvenanceSchema,
  SestinaError,
  SestinaErrorCode,
  isValidId,
  type ActorProvenance,
} from "@sestina/schema";
import type { StorageTransaction } from "../transaction.js";

// ── Shared repository primitives ──

export interface CursorInput {
  cursor?: string;
  limit: number;
}

export interface Page<T> {
  items: T[];
  nextCursor?: string;
}

export function toMs(iso: string): number {
  return Date.parse(iso);
}

export function fromMs(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * Repository write methods must run inside a transaction (the same
 * invariant as lease claims: BEGIN IMMEDIATE serialises the read-check-write
 * sequences, docs/17 §3.2).
 */
export function assertInTransaction(tx: StorageTransaction): void {
  if (!tx.database.isTransaction) {
    throw new SestinaError(
      SestinaErrorCode.internal_error,
      "Repository write must run inside a transaction",
    );
  }
}

/** Body/scope queries must always be pinned to a project (docs/22 Task 6). */
export function assertValidProjectId(projectId: string): void {
  if (!isValidId(projectId)) {
    throw new SestinaError(SestinaErrorCode.validation_failed, "projectId is not a valid ULID");
  }
}

// ── Append-only ledger history (docs/22 Task 10) ──
// Every status transition on assertions/evidence/claims/deliverables writes
// one history row; history rows are never updated or deleted.

export interface LedgerHistoryWrite {
  historyId: string;
  action: string;
  fromStatus: string | null;
  toStatus: string;
  /** The CAS version the caller expected to update from. */
  expectedVersion: number;
  /** Serialized ActorProvenance JSON. */
  actorJson: string;
  reason?: string;
  /** Epoch milliseconds. */
  atMs: number;
}

export interface LedgerHistoryRead {
  historyId: string;
  action: string;
  fromStatus: string | null;
  toStatus: string;
  expectedVersion: number;
  actor: unknown;
  reason: string | null;
  at: string;
}

/** Parses and canonicalizes the authenticated actor carried by a ledger write. */
export function parseLedgerActor(entry: LedgerHistoryWrite): ActorProvenance {
  let actor: unknown;
  try {
    actor = JSON.parse(entry.actorJson) as unknown;
  } catch {
    throw new SestinaError(SestinaErrorCode.validation_failed, "Ledger actor is invalid JSON");
  }
  const parsedActor = ActorProvenanceSchema.safeParse(actor);
  if (!parsedActor.success) {
    throw new SestinaError(
      SestinaErrorCode.validation_failed,
      "Ledger actor is not valid provenance",
    );
  }
  return parsedActor.data;
}

/** Validates caller context and derives state/version fields from the row. */
export function deriveLedgerHistory(
  entry: LedgerHistoryWrite,
  expectedVersion: number,
  fromStatus: string | null,
  toStatus: string,
  action = entry.action,
): LedgerHistoryWrite {
  if (
    entry.expectedVersion !== expectedVersion ||
    entry.toStatus !== toStatus ||
    (entry.fromStatus !== null && entry.fromStatus !== fromStatus)
  ) {
    throw new SestinaError(
      SestinaErrorCode.validation_failed,
      "Ledger history does not match the authoritative transition",
    );
  }
  const parsedActor = parseLedgerActor(entry);
  if (
    entry.historyId.length === 0 ||
    entry.historyId.length > 64 ||
    !Number.isSafeInteger(entry.atMs) ||
    entry.atMs < 0 ||
    action.length === 0 ||
    action.length > 100 ||
    (entry.reason?.length ?? 0) > 2000
  ) {
    throw new SestinaError(
      SestinaErrorCode.validation_failed,
      "Ledger history metadata is invalid",
    );
  }
  return {
    ...entry,
    action,
    fromStatus,
    toStatus,
    expectedVersion,
    actorJson: JSON.stringify(parsedActor),
  };
}

export function insertLedgerHistory(
  tx: StorageTransaction,
  table: "assertion_history" | "evidence_history" | "claim_history" | "deliverable_history",
  entityIdColumn: "assertion_id" | "evidence_id" | "claim_id" | "deliverable_id",
  projectId: string,
  entityId: string,
  entry: LedgerHistoryWrite,
  taskId?: string,
): void {
  // Inserts and contract syncs also pass through provenance/shape validation.
  const validated = deriveLedgerHistory(
    entry,
    entry.expectedVersion,
    entry.fromStatus,
    entry.toStatus,
  );
  if (table === "deliverable_history") {
    if (taskId === undefined) {
      throw new SestinaError(
        SestinaErrorCode.internal_error,
        "Deliverable history requires a task scope",
      );
    }
    tx.run(
      `INSERT INTO deliverable_history
         (history_id, project_id, task_id, deliverable_id, action, from_status, to_status,
          expected_version, actor, reason, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      validated.historyId,
      projectId,
      taskId,
      entityId,
      validated.action,
      validated.fromStatus,
      validated.toStatus,
      validated.expectedVersion,
      validated.actorJson,
      validated.reason ?? null,
      validated.atMs,
    );
    return;
  }
  tx.run(
    `INSERT INTO ${table}
       (history_id, project_id, ${entityIdColumn}, action, from_status, to_status,
        expected_version, actor, reason, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    validated.historyId,
    projectId,
    entityId,
    validated.action,
    validated.fromStatus,
    validated.toStatus,
    validated.expectedVersion,
    validated.actorJson,
    validated.reason ?? null,
    validated.atMs,
  );
}

export function readLedgerHistory(
  tx: StorageTransaction,
  table: "assertion_history" | "evidence_history" | "claim_history" | "deliverable_history",
  entityIdColumn: "assertion_id" | "evidence_id" | "claim_id" | "deliverable_id",
  projectId: string,
  entityId: string,
  taskId?: string,
): LedgerHistoryRead[] {
  if (table === "deliverable_history" && taskId === undefined) {
    throw new SestinaError(
      SestinaErrorCode.internal_error,
      "Deliverable history requires a task scope",
    );
  }
  const rows = tx.all<{
    history_id: string;
    action: string;
    from_status: string | null;
    to_status: string;
    expected_version: number;
    actor: string;
    reason: string | null;
    at: number;
  }>(
    table === "deliverable_history"
      ? `SELECT history_id, action, from_status, to_status, expected_version, actor, reason, at
         FROM deliverable_history
         WHERE project_id = ? AND task_id = ? AND deliverable_id = ?
         ORDER BY rowid`
      : `SELECT history_id, action, from_status, to_status, expected_version, actor, reason, at
         FROM ${table}
         WHERE project_id = ? AND ${entityIdColumn} = ?
         ORDER BY rowid`,
    ...(table === "deliverable_history"
      ? [projectId, taskId, entityId]
      : [projectId, entityId]),
  );
  return rows.map((row) => ({
    historyId: row.history_id,
    action: row.action,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    expectedVersion: row.expected_version,
    actor: JSON.parse(row.actor) as unknown,
    reason: row.reason,
    at: fromMs(row.at),
  }));
}

/** Cursor pagination limit sanity (no offset scans of 100k history). */
export function assertCursorLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new SestinaError(SestinaErrorCode.validation_failed, "limit must be an integer between 1 and 500");
  }
}


// ── Keyset pagination (docs/22 Task 6: no offset scans of 100k history) ──
// Cursors are opaque, versioned keyset markers — NOT an anti-forgery
// mechanism. Every page fetches limit+1 rows and emits nextCursor only
// when more rows exist.

export interface KeysetCursor {
  key: number | null;
  id: string;
}

export function encodeKeysetCursor(key: number | null, id: string): string {
  return `k1.${Buffer.from(JSON.stringify({ key, id }), "utf8").toString("base64url")}`;
}

export function decodeKeysetCursor(cursor: string): KeysetCursor {
  const prefix = "k1.";
  if (!cursor.startsWith(prefix)) {
    throw new SestinaError(SestinaErrorCode.validation_failed, "Invalid cursor");
  }
  let parsed: { key?: unknown; id?: unknown };
  try {
    parsed = JSON.parse(
      Buffer.from(cursor.slice(prefix.length), "base64url").toString("utf8"),
    ) as { key?: unknown; id?: unknown };
  } catch {
    throw new SestinaError(SestinaErrorCode.validation_failed, "Invalid cursor");
  }
  const keyValid =
    parsed.key === null ||
    (typeof parsed.key === "number" &&
      Number.isSafeInteger(parsed.key) &&
      parsed.key >= 0);
  if (
    !keyValid ||
    typeof parsed.id !== "string" ||
    parsed.id.length === 0
  ) {
    throw new SestinaError(SestinaErrorCode.validation_failed, "Invalid cursor");
  }
  // keyValid is a separate boolean so TS cannot narrow parsed.key here.
  return { key: parsed.key as number | null, id: parsed.id };
}

export interface KeysetPageInput {
  table: string;
  columns: string;
  keyColumn: string;
  idColumn: string;
  /**
   * Optional WHERE-safe column that holds the project id (may be qualified,
   * e.g. "t.project_id" for a joined table). When set, projectId is
   * required and validated; when omitted the page is not project-scoped
   * (only `projects.list`, the top of the hierarchy, omits it).
   */
  projectColumn?: string;
  projectId?: string;
  cursor?: string;
  limit: number;
  /** Optional extra filter appended as "AND <extraWhere>" with params. */
  extraWhere?: string;
  extraParams?: unknown[];
}

/**
 * Generic index-friendly keyset page: orders by (keyColumn, idColumn) and
 * fetches limit+1 rows so nextCursor is only emitted when a further page
 * exists. When projectColumn/projectId are set the page is pinned to that
 * project. The caller must ensure an index on (projectColumn?, keyColumn,
 * idColumn) or equivalent exists.
 */
export function keysetPage<T extends object>(
  tx: StorageTransaction,
  input: KeysetPageInput,
): Page<T> {
  assertCursorLimit(input.limit);
  if (input.projectColumn !== undefined && input.projectId === undefined) {
    throw new SestinaError(
      SestinaErrorCode.validation_failed,
      "projectId is required when projectColumn is set",
    );
  }
  if (input.projectId !== undefined) {
    assertValidProjectId(input.projectId);
  }
  const projectWhere =
    input.projectColumn !== undefined ? `${input.projectColumn} = ?` : "1=1";
  const projectParams =
    input.projectColumn !== undefined && input.projectId !== undefined
      ? [input.projectId]
      : [];
  const cursor = input.cursor ? decodeKeysetCursor(input.cursor) : undefined;
  const fetchLimit = input.limit + 1;
  const extra = input.extraWhere ? ` AND ${input.extraWhere}` : "";
  const extraParams = input.extraParams ?? [];
  // NULL sorts first in SQLite ASC, so a cursor inside the NULL group must
  // resume "same NULL key, id after cursor" before falling into the
  // non-NULL rows; a plain `key > ?` comparison would silently drop the
  // rest of the NULL group.
  const cursorWhere =
    cursor === undefined
      ? ""
      : cursor.key === null
        ? ` AND (${input.keyColumn} IS NULL AND ${input.idColumn} > ? OR ${input.keyColumn} IS NOT NULL)`
        : ` AND (${input.keyColumn} > ? OR (${input.keyColumn} = ? AND ${input.idColumn} > ?))`;
  const cursorParams =
    cursor === undefined
      ? []
      : cursor.key === null
        ? [cursor.id]
        : [cursor.key, cursor.key, cursor.id];
  const rows = tx.all<T>(
    `SELECT ${input.columns} FROM ${input.table}
     WHERE ${projectWhere}${cursorWhere}${extra}
     ORDER BY ${input.keyColumn}, ${input.idColumn}
     LIMIT ?`,
    ...projectParams,
    ...cursorParams,
    ...extraParams,
    fetchLimit,
  );
  const hasMore = rows.length > input.limit;
  const pageRows = hasMore ? rows.slice(0, input.limit) : rows;
  const last = pageRows.at(-1) as Record<string, unknown> | undefined;
  // SQLite keys result columns of qualified references (e.g. "m.created_at")
  // by their last identifier segment, so strip any qualifier before reading
  // the boundary row.
  const keyProp = input.keyColumn.split(".").at(-1) ?? input.keyColumn;
  const idProp = input.idColumn.split(".").at(-1) ?? input.idColumn;
  return {
    items: pageRows,
    nextCursor:
      hasMore && last
        ? encodeKeysetCursor(
            last[keyProp] == null ? null : Number(last[keyProp]),
            String(last[idProp]),
          )
        : undefined,
  };
}
