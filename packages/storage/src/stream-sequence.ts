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
  // Allocation is a read-check-then-write unit: it must run inside a
  // transaction (BEGIN IMMEDIATE serialises writers). The unique index
  // (project_id, stream_sequence) is the database-level backstop.
  if (!tx.database.isTransaction) {
    throw new SestinaError(
      SestinaErrorCode.internal_error,
      "nextStreamSequence must run inside a transaction",
    );
  }
  assertValidProjectId(projectId);
  const row = tx.get<{ max_seq: number | null }>(
    "SELECT MAX(stream_sequence) AS max_seq FROM events WHERE project_id = ?",
    projectId,
  );
  return (row?.max_seq ?? 0) + 1;
}

// ── Stable (stream_sequence, id) cursors ──
//
// Cursors are versioned and HMAC-authenticated with an injected secret
// (SESTINA_CURSOR_KEY). Without the key configured, cursors are signed with
// a per-process secret and therefore do not survive restarts — callers that
// need durable cursors must provide the key. The signature is the forgery
// barrier; base64 is only the transport encoding.

export interface EventCursor {
  projectId: string;
  sequence: number;
  id: string;
}

const CURSOR_VERSION = "v1";
const HMAC_ALGORITHM = "sha256";

function cursorKey(): Buffer {
  const configured = process.env.SESTINA_CURSOR_KEY;
  if (configured && configured.length >= 32) {
    return Buffer.from(configured.slice(0, 128), "utf8");
  }
  return processCursorKey();
}

// Lazy per-process fallback key (cursors do not survive restarts without
// the environment key — honest degradation, not a fake guarantee).
let perProcessCursorKey: Buffer | undefined;
function processCursorKey(): Buffer {
  perProcessCursorKey ??= Buffer.from(cryptoRandomKey(), "utf8");
  return perProcessCursorKey;
}

import { randomBytes, createHmac } from "node:crypto";

function cryptoRandomKey(): string {
  return randomBytes(32).toString("hex");
}

function signCursor(payload: string): string {
  return createHmac(HMAC_ALGORITHM, cursorKey()).update(payload).digest("base64url");
}

export function encodeEventCursor(projectId: string, sequence: number, id: string): string {
  const payload = Buffer.from(
    JSON.stringify({ v: CURSOR_VERSION, projectId, sequence, id }),
    "utf8",
  ).toString("base64url");
  return `${CURSOR_VERSION}.${payload}.${signCursor(`${CURSOR_VERSION}.${payload}`)}`;
}

/**
 * Decodes a cursor and pins it to the expected project. Forged, tampered
 * or cross-version cursors are rejected with validation_failed; a valid
 * cursor from another project is a project_isolation_violation
 * (docs/22 Task 6).
 */
export function decodeEventCursor(cursor: string, expectedProjectId: string): EventCursor {
  const parts = cursor.split(".");
  if (parts.length !== 3) {
    throw new SestinaError(SestinaErrorCode.validation_failed, "Invalid cursor");
  }
  const [version, payload, signature] = parts as [string, string, string];
  if (version !== CURSOR_VERSION) {
    throw new SestinaError(SestinaErrorCode.validation_failed, "Invalid cursor");
  }
  const expected = signCursor(`${version}.${payload}`);
  if (!timingSafeEqual(expected, signature)) {
    throw new SestinaError(SestinaErrorCode.validation_failed, "Invalid cursor");
  }
  let parsed: { projectId?: unknown; sequence?: unknown; id?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      projectId?: unknown; sequence?: unknown; id?: unknown;
    };
  } catch {
    throw new SestinaError(SestinaErrorCode.validation_failed, "Invalid cursor");
  }
  if (
    typeof parsed.projectId !== "string" ||
    typeof parsed.sequence !== "number" ||
    !Number.isSafeInteger(parsed.sequence) ||
    parsed.sequence < 0 ||
    typeof parsed.id !== "string"
  ) {
    throw new SestinaError(SestinaErrorCode.validation_failed, "Invalid cursor");
  }
  if (!isValidId(parsed.id)) {
    throw new SestinaError(SestinaErrorCode.validation_failed, "Invalid cursor");
  }
  if (parsed.projectId !== expectedProjectId) {
    throw new SestinaError(
      SestinaErrorCode.project_isolation_violation,
      "Cursor belongs to a different project",
    );
  }
  return { projectId: parsed.projectId, sequence: parsed.sequence, id: parsed.id };
}

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  let diff = 0;
  for (let i = 0; i < bufA.length; i++) {
    diff |= (bufA[i] ?? 0) ^ (bufB[i] ?? 0);
  }
  return diff === 0;
}
