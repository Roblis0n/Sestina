import {
  HostStreamEventSchema,
  SestinaErrorCode,
  SestinaError,
  type HostStreamEvent,
} from "@sestina/schema";
import type { StorageTransaction } from "../transaction.js";
import { validateJson } from "../schema-check.js";
import { assertInTransaction } from "./shared.js";

export interface HostStreamRepository {
  /** Append-only; UNIQUE(session_id, sequence) deduplicates re-deliveries. */
  append(event: HostStreamEvent): void;
  listBySession(
    sessionId: string,
    input: { afterSequence?: number; limit: number },
  ): HostStreamEvent[];
  /** Explicit range with gap detection support (docs/34 §6). */
  listBySessionRange(sessionId: string, from: number, to: number): HostStreamEvent[];
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

    listBySession(sessionId, input) {
      const rows = input.afterSequence !== undefined
        ? tx.all<{ stream_event_id: string; session_id: string; sequence: number; kind: string; data: string }>(
            "SELECT stream_event_id, session_id, sequence, kind, data FROM host_stream_events WHERE session_id = ? AND sequence > ? ORDER BY sequence LIMIT ?",
            sessionId,
            input.afterSequence,
            input.limit,
          )
        : tx.all<{ stream_event_id: string; session_id: string; sequence: number; kind: string; data: string }>(
            "SELECT stream_event_id, session_id, sequence, kind, data FROM host_stream_events WHERE session_id = ? ORDER BY sequence LIMIT ?",
            sessionId,
            input.limit,
          );
      return rows.map(assemble);
    },

    listBySessionRange(sessionId, from, to) {
      if (from > to) {
        throw new SestinaError(SestinaErrorCode.validation_failed, "Invalid sequence range");
      }
      const rows = tx.all<{ stream_event_id: string; session_id: string; sequence: number; kind: string; data: string }>(
        "SELECT stream_event_id, session_id, sequence, kind, data FROM host_stream_events WHERE session_id = ? AND sequence >= ? AND sequence <= ? ORDER BY sequence",
        sessionId,
        from,
        to,
      );
      return rows.map(assemble);
    },
  };
}
