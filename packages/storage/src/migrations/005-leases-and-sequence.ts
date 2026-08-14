import type { Migration } from "../migrator.js";
import type { StorageDatabase } from "../connection.js";

// ── Lease fencing tokens, sequence backfill and unique constraint ──
// Additive only. Two parts:
//  1) retries after a crash re-use the original event row with a NEW
//     fencing token instead of colliding on the idempotency key;
//  2) upgraded databases backfill stream_sequence=0 rows per project in
//     (occurred_at, event_id) order, then lock uniqueness with a real
//     index and replace the old 2-column index with a 3-column one so
//     cursor pagination needs no temp B-tree sort.
const SQL = `
ALTER TABLE event_leases ADD COLUMN fence_token TEXT;
ALTER TABLE collaboration_delivery_leases ADD COLUMN lease_token TEXT;

UPDATE events SET stream_sequence = (
  SELECT numbered.seq FROM (
    SELECT rowid, ROW_NUMBER() OVER (
      PARTITION BY project_id ORDER BY occurred_at, event_id
    ) AS seq
    FROM events
  ) AS numbered
  WHERE numbered.rowid = events.rowid
) WHERE stream_sequence = 0;

-- stream_sequence=0 means "not yet sequenced" (legacy rows before the
-- backfill); production always assigns >= 1, so uniqueness is enforced
-- on the positive range only.
CREATE UNIQUE INDEX idx_events_project_stream_unique ON events(project_id, stream_sequence) WHERE stream_sequence > 0;
DROP INDEX idx_events_project_stream;
CREATE INDEX idx_events_project_stream ON events(project_id, stream_sequence, event_id);
`;

export const migration005: Migration = {
  version: 5,
  name: "005-leases-and-sequence",
  up(db: StorageDatabase): void {
    db.exec(SQL);
  },
};
