import {
  HostStreamEventSchema,
  SestinaErrorCode,
  SestinaError,
  type HostStreamEvent,
} from "@sestina/schema";
import type { StorageTransaction } from "../transaction.js";
import { validateJson } from "../schema-check.js";
import { assertCursorLimit, assertInTransaction } from "./shared.js";

export interface HostStreamRepository {
  /** Append-only; UNIQUE(session_id, sequence) deduplicates re-deliveries. */
  append(event: HostStreamEvent): void;
  listBySession(
    projectId: string,
    sessionId: string,
    input: { afterSequence?: number; limit: number },
  ): HostStreamEvent[];
  /** Explicit range with gap detection support (docs/34 §6). */
  listBySessionRange(projectId: string, sessionId: string, from: number, to: number): HostStreamEvent[];
}

function assemble(row: {
  stream_event_id: string;
  session_id: string;
  sequence: number;
  kind: string;
  data: string;
}): HostStreamEvent {
  const data = JSON.parse(row.data) as HostStreamEvent;
  return HostStreamEventSchema.parse({
    ...data,
    streamEventId: row.stream_event_id,
    sessionId: row.session_id,
    sequence: row.sequence,
    eventType: row.kind,
  });
}

export function createHostStreamRepository(tx: StorageTransaction): HostStreamRepository {
  return {
    append(event) {
      assertInTransaction(tx);
      tx.run(
        "INSERT INTO host_stream_events (stream_event_id, session_id, sequence, kind, data) VALUES (?, ?, ?, ?, ?)",
        event.streamEventId,
        event.sessionId,
        event.sequence,
        event.eventType,
        validateJson(HostStreamEventSchema, event, "HostStreamEvent"),
      );
    },

    listBySession(projectId, sessionId, input) {
      assertCursorLimit(input.limit);
      // host_stream_events has no project column: scope through the session.
      const select = `SELECT e.stream_event_id, e.session_id, e.sequence, e.kind, e.data
        FROM host_stream_events e
        JOIN host_sessions s ON s.session_id = e.session_id
        WHERE e.session_id = ? AND s.project_id = ?`;
      const rows = input.afterSequence !== undefined
        ? tx.all<{ stream_event_id: string; session_id: string; sequence: number; kind: string; data: string }>(
            `${select} AND e.sequence > ? ORDER BY e.sequence LIMIT ?`,
            sessionId,
            projectId,
            input.afterSequence,
            input.limit,
          )
        : tx.all<{ stream_event_id: string; session_id: string; sequence: number; kind: string; data: string }>(
            `${select} ORDER BY e.sequence LIMIT ?`,
            sessionId,
            projectId,
            input.limit,
          );
      return rows.map(assemble);
    },

    listBySessionRange(projectId, sessionId, from, to) {
      if (from > to) {
        throw new SestinaError(SestinaErrorCode.validation_failed, "Invalid sequence range");
      }
      const rows = tx.all<{ stream_event_id: string; session_id: string; sequence: number; kind: string; data: string }>(
        `SELECT e.stream_event_id, e.session_id, e.sequence, e.kind, e.data
         FROM host_stream_events e
         JOIN host_sessions s ON s.session_id = e.session_id
         WHERE e.session_id = ? AND s.project_id = ? AND e.sequence >= ? AND e.sequence <= ?
         ORDER BY e.sequence`,
        sessionId,
        projectId,
        from,
        to,
      );
      return rows.map(assemble);
    },
  };
}
