import { SestinaError, SestinaErrorCode, isValidId } from "@sestina/schema";
import type { StorageTransaction } from "./transaction.js";
import { assertValidProjectId } from "./repositories/shared.js";

/**
 * Allocates the next project-monotonic stream sequence
 * (docs/22 Task 6, docs/34 §6). Must run inside a transaction: BEGIN
 * IMMEDIATE serialises writers across connections and processes, so
 * sequences are unique and monotonic. A rolled-back transaction may leave
 * a gap — gaps are expected and cursors never rely on contiguity.
 */
export function nextStreamSequence(tx: StorageTransaction, projectId: string): number {
  assertValidProjectId(projectId);
  const row = tx.get<{ max_seq: number | null }>(
    "SELECT MAX(stream_sequence) AS max_seq FROM events WHERE project_id = ?",
    projectId,
  );
  return (row?.max_seq ?? 0) + 1;
}

// ── Stable (stream_sequence, id) cursors ──

export interface EventCursor {
  projectId: string;
  sequence: number;
  id: string;
}

export function encodeEventCursor(projectId: string, sequence: number, id: string): string {
  return Buffer.from(`${projectId}.${sequence}.${id}`, "utf8").toString("base64url");
}

/**
 * Decodes a cursor and pins it to the expected project. Malformed cursors
 * are rejected with validation_failed; a cursor from another project is a
 * project_isolation_violation (docs/22 Task 6).
 */
export function decodeEventCursor(cursor: string, expectedProjectId: string): EventCursor {
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    throw new SestinaError(SestinaErrorCode.validation_failed, "Invalid cursor");
  }
  const parts = decoded.split(".");
  if (parts.length !== 3) {
    throw new SestinaError(SestinaErrorCode.validation_failed, "Invalid cursor");
  }
  const [projectId, sequenceRaw, id] = parts as [string, string, string];
  const sequence = Number(sequenceRaw);
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw new SestinaError(SestinaErrorCode.validation_failed, "Invalid cursor");
  }
  if (!isValidId(id)) {
    throw new SestinaError(SestinaErrorCode.validation_failed, "Invalid cursor");
  }
  if (projectId !== expectedProjectId) {
    throw new SestinaError(
      SestinaErrorCode.project_isolation_violation,
      "Cursor belongs to a different project",
    );
  }
  return { projectId, sequence, id };
}
