import {
  StandardEventSchema,
  SestinaErrorCode,
  SestinaError,
  type StandardEvent,
  type EventId,
} from "@sestina/schema";
import type { StorageTransaction } from "../transaction.js";
import { validateJson } from "../schema-check.js";
import { claimEventLease, type EventLease } from "../lease.js";
import { nextStreamSequence } from "../stream-sequence.js";
import { decodeEventCursor, encodeEventCursor } from "../stream-sequence.js";
import {
  assertCursorLimit,
  assertInTransaction,
  assertValidProjectId,
  fromMs,
  toMs,
  type CursorInput,
  type Page,
} from "./shared.js";

export type EventReserveResult =
  | { kind: "created"; eventId: EventId; lease: EventLease }
  | { kind: "completed"; decisionId: string };

export interface EventRepository {
  /**
   * Reserves the processing lease for an event idempotency key
   * (docs/22 Task 6 Step 1): a duplicate key returns the original decision
   * without creating a second lease or a second event row.
   */
  reserve(
    event: StandardEvent,
    opts: { ownerId: string; ttlMs?: number },
  ): EventReserveResult;
  /**
   * Appends a non-governed association event (docs/30 §5): an append-only
   * record without a processing lease — the judge pipeline never sees it.
   * Replaying the same idempotency key with an identical payload/scope is a
   * no-op; reusing it differently fails with idempotency_violation.
   */
  appendAssociation(event: StandardEvent): void;
  get(projectId: string, eventId: string): StandardEvent | undefined;
  listByProject(projectId: string, input: CursorInput): Page<StandardEvent>;
}

interface EventRow {
  event_id: string;
  idempotency_key: string;
  project_id: string;
  task_id: string;
  session_id: string | null;
  event_type: string;
  occurred_at: number;
  received_at: number;
  privacy_class: string;
  stream_sequence: number;
  data: string;
}

function assembleEvent(row: EventRow): StandardEvent {
  const data = JSON.parse(row.data) as StandardEvent;
  return StandardEventSchema.parse({
    ...data,
    eventId: row.event_id,
    idempotencyKey: row.idempotency_key,
    projectId: row.project_id,
    taskId: row.task_id,
    sessionId: row.session_id ?? undefined,
    eventType: row.event_type,
    occurredAt: fromMs(row.occurred_at),
    receivedAt: fromMs(row.received_at),
    privacyClass: row.privacy_class,
  });
}

export function createEventRepository(tx: StorageTransaction): EventRepository {
  return {
    reserve(event, opts) {
      assertInTransaction(tx);
      const claim = claimEventLease(tx, {
        idempotencyKey: event.idempotencyKey,
        ownerId: opts.ownerId,
        packetHash: event.rawPayloadHash,
        ttlMs: opts.ttlMs,
      });
      if (claim.kind === "already_completed") {
        const decision = tx.get<{ decision_id: string }>(
          `SELECT d.decision_id FROM decisions d
           JOIN events e ON e.event_id = d.event_id
           WHERE e.idempotency_key = ? AND e.project_id = ?`,
          event.idempotencyKey,
          event.projectId,
        );
        if (!decision) {
          throw new SestinaError(
            SestinaErrorCode.internal_error,
            "Completed event has no decision",
          );
        }
        return { kind: "completed", decisionId: decision.decision_id };
      }
      if (claim.kind === "wait_for_existing") {
        throw new SestinaError(
          SestinaErrorCode.storage_busy,
          "Event processing is already in progress",
        );
      }
      // Crash retry: if the original row already exists, verify identity and
      // REUSE it with the new fencing token instead of colliding on the
      // unique idempotency key (docs/19 §10).
      const existing = tx.get<{
        event_id: string; project_id: string; task_id: string;
        session_id: string | null; data: string;
      }>(
        `SELECT event_id, project_id, task_id, session_id, data
         FROM events WHERE idempotency_key = ?`,
        event.idempotencyKey,
      );
      if (existing) {
        const existingData = JSON.parse(existing.data) as { rawPayloadHash?: string };
        const sameSession = (existing.session_id ?? undefined) === event.sessionId;
        if (
          existing.project_id !== event.projectId ||
          existing.task_id !== event.taskId ||
          !sameSession ||
          existingData.rawPayloadHash !== event.rawPayloadHash
        ) {
          throw new SestinaError(
            SestinaErrorCode.idempotency_violation,
            "Idempotency key reused with a different payload or scope",
          );
        }
        return {
          kind: "created",
          eventId: existing.event_id as EventId,
          lease: {
            idempotencyKey: event.idempotencyKey,
            ownerId: opts.ownerId,
            token: claim.token ?? "",
            expiresAt: tx.get<{ expires_at: number }>(
              "SELECT expires_at FROM event_leases WHERE idempotency_key = ?",
              event.idempotencyKey,
            )?.expires_at ?? 0,
          },
        };
      }
      const sequence = nextStreamSequence(tx, event.projectId);
      tx.run(
        `INSERT INTO events
           (event_id, idempotency_key, project_id, task_id, session_id, event_type,
            occurred_at, received_at, privacy_class, stream_sequence, data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        event.eventId,
        event.idempotencyKey,
        event.projectId,
        event.taskId,
        event.sessionId,
        event.eventType,
        toMs(event.occurredAt),
        toMs(event.receivedAt),
        event.privacyClass,
        sequence,
        validateJson(StandardEventSchema, event, "StandardEvent"),
      );
      const lease = tx.get<{ expires_at: number }>(
        "SELECT expires_at FROM event_leases WHERE idempotency_key = ?",
        event.idempotencyKey,
      );
      return {
        kind: "created",
        eventId: event.eventId,
        lease: {
          idempotencyKey: event.idempotencyKey,
          ownerId: opts.ownerId,
          token: claim.token ?? "",
          expiresAt: lease ? lease.expires_at : 0,
        },
      };
    },

    appendAssociation(event) {
      assertInTransaction(tx);
      const existing = tx.get<{
        project_id: string; task_id: string; session_id: string | null; data: string;
      }>(
        "SELECT project_id, task_id, session_id, data FROM events WHERE idempotency_key = ?",
        event.idempotencyKey,
      );
      if (existing) {
        const existingData = JSON.parse(existing.data) as { rawPayloadHash?: string };
        const sameSession = (existing.session_id ?? undefined) === event.sessionId;
        if (
          existing.project_id !== event.projectId ||
          existing.task_id !== event.taskId ||
          !sameSession ||
          existingData.rawPayloadHash !== event.rawPayloadHash
        ) {
          throw new SestinaError(
            SestinaErrorCode.idempotency_violation,
            "Idempotency key reused with a different payload or scope",
          );
        }
        return;
      }
      const sequence = nextStreamSequence(tx, event.projectId);
      tx.run(
        `INSERT INTO events
           (event_id, idempotency_key, project_id, task_id, session_id, event_type,
            occurred_at, received_at, privacy_class, stream_sequence, data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        event.eventId,
        event.idempotencyKey,
        event.projectId,
        event.taskId,
        event.sessionId,
        event.eventType,
        toMs(event.occurredAt),
        toMs(event.receivedAt),
        event.privacyClass,
        sequence,
        validateJson(StandardEventSchema, event, "StandardEvent"),
      );
    },

    get(projectId, eventId) {
      const row = tx.get<EventRow>(
        `SELECT event_id, idempotency_key, project_id, task_id, session_id, event_type,
                occurred_at, received_at, privacy_class, stream_sequence, data
         FROM events WHERE event_id = ? AND project_id = ?`,
        eventId,
        projectId,
      );
      return row ? assembleEvent(row) : undefined;
    },

    listByProject(projectId, input) {
      assertValidProjectId(projectId);
      assertCursorLimit(input.limit);
      const cursor = input.cursor
        ? decodeEventCursor(input.cursor, projectId)
        : undefined;
      const fetchLimit = input.limit + 1;
      // The row-value comparison is served by idx_events_project_stream
      // (project_id, stream_sequence, event_id) as a single index range —
      // EXPLAIN QUERY PLAN shows no temp b-tree (regression test in
      // stream-sequence.test.ts). If that ever regresses, the equivalent
      // OR-expanded form is `stream_sequence > ? OR (stream_sequence = ?
      // AND event_id > ?)`.
      const rows = cursor
        ? tx.all<EventRow>(
            `SELECT event_id, idempotency_key, project_id, task_id, session_id, event_type,
                    occurred_at, received_at, privacy_class, stream_sequence, data
             FROM events
             WHERE project_id = ? AND (stream_sequence, event_id) > (?, ?)
             ORDER BY stream_sequence, event_id
             LIMIT ?`,
            projectId,
            cursor.sequence,
            cursor.id,
            fetchLimit,
          )
        : tx.all<EventRow>(
            `SELECT event_id, idempotency_key, project_id, task_id, session_id, event_type,
                    occurred_at, received_at, privacy_class, stream_sequence, data
             FROM events
             WHERE project_id = ?
             ORDER BY stream_sequence, event_id
             LIMIT ?`,
            projectId,
            fetchLimit,
          );
      const hasMore = rows.length > input.limit;
      const pageRows = hasMore ? rows.slice(0, input.limit) : rows;
      const items = pageRows.map(assembleEvent);
      const last = pageRows.at(-1);
      return {
        items,
        nextCursor:
          hasMore && last
            ? encodeEventCursor(projectId, last.stream_sequence, last.event_id)
            : undefined,
      };
    },
  };
}
