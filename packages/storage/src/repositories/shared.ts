import { SestinaError, SestinaErrorCode, isValidId } from "@sestina/schema";
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
  key: number;
  id: string;
}

export function encodeKeysetCursor(key: number, id: string): string {
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
  if (
    typeof parsed.key !== "number" ||
    !Number.isSafeInteger(parsed.key) ||
    parsed.key < 0 ||
    typeof parsed.id !== "string" ||
    parsed.id.length === 0
  ) {
    throw new SestinaError(SestinaErrorCode.validation_failed, "Invalid cursor");
  }
  return { key: parsed.key, id: parsed.id };
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
  const rows = cursor
    ? tx.all<T>(
        `SELECT ${input.columns} FROM ${input.table}
         WHERE ${projectWhere}
           AND (${input.keyColumn} > ? OR (${input.keyColumn} = ? AND ${input.idColumn} > ?))${extra}
         ORDER BY ${input.keyColumn}, ${input.idColumn}
         LIMIT ?`,
        ...projectParams,
        cursor.key,
        cursor.key,
        cursor.id,
        ...extraParams,
        fetchLimit,
      )
    : tx.all<T>(
        `SELECT ${input.columns} FROM ${input.table}
         WHERE ${projectWhere}${extra}
         ORDER BY ${input.keyColumn}, ${input.idColumn}
         LIMIT ?`,
        ...projectParams,
        ...extraParams,
        fetchLimit,
      );
  const hasMore = rows.length > input.limit;
  const pageRows = hasMore ? rows.slice(0, input.limit) : rows;
  const last = pageRows.at(-1) as Record<string, unknown> | undefined;
  return {
    items: pageRows,
    nextCursor:
      hasMore && last
        ? encodeKeysetCursor(
            Number(last[input.keyColumn]),
            String(last[input.idColumn]),
          )
        : undefined,
  };
}
