import type { Migration } from "../migrator.js";
import type { StorageDatabase } from "../connection.js";

// ── Retention true snapshot (docs/22 Task 6 fix) ──
// Additive only:
//  1) host_stream_events materializes occurred_at (ms) so retention can
//     filter on the event's own time instead of the session start; legacy
//     rows are backfilled from the data JSON with a COALESCE-style
//     fallback to the session start, and an insert trigger keeps new
//     appends in sync.
//  2) retention_previews persists the preview (hash + config + per-target
//     member summaries); retention_applied records every applied
//     (preview_id, target_object) pair once — apply is idempotent by
//     record, never by live re-matching.
const DDL = `
ALTER TABLE host_stream_events ADD COLUMN occurred_at INTEGER;
CREATE INDEX idx_host_stream_events_occurred ON host_stream_events(occurred_at);

CREATE TABLE retention_previews (
  preview_id TEXT PRIMARY KEY,
  preview_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  config_json TEXT NOT NULL,
  targets_json TEXT NOT NULL,
  total_estimated INTEGER NOT NULL,
  data TEXT NOT NULL
) STRICT;

CREATE TABLE retention_applied (
  applied_id TEXT PRIMARY KEY,
  preview_id TEXT NOT NULL,
  target_object TEXT NOT NULL,
  applied_at INTEGER NOT NULL,
  row_count INTEGER NOT NULL,
  tombstone_count INTEGER NOT NULL,
  data TEXT NOT NULL,
  UNIQUE (preview_id, target_object)
) STRICT;

-- Keep occurred_at populated for rows appended after the migration:
-- COALESCE(occurredAt -> ms, session started_at) mirrors the backfill.
CREATE TRIGGER trg_host_stream_events_occurred_ai
AFTER INSERT ON host_stream_events
BEGIN
  UPDATE host_stream_events
  SET occurred_at = COALESCE(
    CAST(ROUND((julianday(json_extract(NEW.data, '$.occurredAt')) - 2440587.5) * 86400000) AS INTEGER),
    (SELECT s.started_at FROM host_sessions s WHERE s.session_id = NEW.session_id)
  )
  WHERE stream_event_id = NEW.stream_event_id;
END;
`;

export const migration006: Migration = {
  version: 6,
  name: "006-retention-snapshot",
  up(db: StorageDatabase): void {
    db.exec(DDL);
    backfillHostStreamOccurredAt(db);
  },
};

/**
 * Backfills occurred_at in milliseconds from each legacy row's data JSON
 * (`occurredAt` is an ISO timestamp). Rows without a parseable occurredAt
 * fall back to the session's started_at — the COALESCE semantics of the
 * insert trigger — so no row is ever left NULL.
 */
function backfillHostStreamOccurredAt(db: StorageDatabase): void {
  const rows = db.all<{ stream_event_id: string; session_id: string; data: string }>(
    "SELECT stream_event_id, session_id, data FROM host_stream_events",
  );
  for (const row of rows) {
    let occurredMs: number | null = null;
    try {
      const parsed = JSON.parse(row.data) as { occurredAt?: unknown };
      if (typeof parsed.occurredAt === "string") {
        const parsedMs = Date.parse(parsed.occurredAt);
        if (Number.isFinite(parsedMs)) {
          occurredMs = parsedMs;
        }
      }
    } catch {
      // Not valid JSON — use the session fallback below.
    }
    occurredMs ??= db.get<{ started_at: number }>(
      "SELECT started_at FROM host_sessions WHERE session_id = ?",
      row.session_id,
    )?.started_at ?? 0;
    db.run(
      "UPDATE host_stream_events SET occurred_at = ? WHERE stream_event_id = ?",
      occurredMs,
      row.stream_event_id,
    );
  }
}
