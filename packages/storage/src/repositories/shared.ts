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
