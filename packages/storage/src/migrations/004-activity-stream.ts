import type { Migration } from "../migrator.js";
import type { StorageDatabase } from "../connection.js";

// ── Task 6: activity stream sequence, tombstones, export metadata ──
// Additive only (docs/09 §22): events gain a project-monotonic
// stream_sequence for stable (stream_sequence, id) cursors (docs/22 Task 6);
// retention tombstones keep an irreversible record after sensitive bodies
// are cleaned; export metadata records what was exported and when it
// expires.
const SQL = `
ALTER TABLE events ADD COLUMN stream_sequence INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_events_project_stream ON events(project_id, stream_sequence);
ALTER TABLE project_root_bindings ADD COLUMN data TEXT NOT NULL DEFAULT '{}';

CREATE TABLE retention_tombstones (
  tombstone_id TEXT PRIMARY KEY,
  entity_kind TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  task_id TEXT,
  time_range_from INTEGER,
  time_range_to INTEGER,
  reason TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  summary TEXT,
  created_at INTEGER NOT NULL,
  data TEXT NOT NULL
) STRICT;
CREATE INDEX idx_tombstones_project ON retention_tombstones(project_id, created_at);

CREATE TABLE export_metadata (
  export_id TEXT PRIMARY KEY,
  project_id TEXT,
  task_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('minimal','full','diagnostic')),
  scope_json TEXT NOT NULL,
  output_path TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','ready','expired','purged')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  data TEXT NOT NULL
) STRICT;
CREATE INDEX idx_exports_project ON export_metadata(project_id, created_at);
`;

export const migration004: Migration = {
  version: 4,
  name: "004-activity-stream",
  up(db: StorageDatabase): void {
    db.exec(SQL);
  },
};
