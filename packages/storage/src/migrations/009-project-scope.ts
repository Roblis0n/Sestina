import type { Migration } from "../migrator.js";
import type { StorageDatabase } from "../connection.js";

// ── Project scope (docs/22 Task 8, docs/30) ──
// 1) host_sessions.task_id becomes nullable: a session may be unattached
//    while its task attachment is ambiguous (docs/30 §5 "未关联会话"). The
//    NOT NULL column cannot be altered in place, so its values are staged,
//    the column dropped and re-added nullable with ON DELETE SET NULL — a
//    deleted task detaches its sessions instead of cascading them away.
//    (DROP COLUMN on the child side keeps host_stream_events' FK intact, so
//    no PRAGMA foreign_keys juggling is needed.)
// 2) project_root_bindings gains canonical columns (fingerprint, confirmed,
//    source, case_semantics) so binding identity is queryable; legacy
//    fingerprints are backfilled from the data JSON.
// 3) session_task_attachments records the append-only attach/detach history;
//    the row with detached_at unset is the current attachment, enforced by a
//    partial unique index. Legacy sessions are backfilled with one active row.
// 4) unowned_activity is the queue for host events that cannot resolve a
//    project (docs/30 §10). The exact raw event JSON is retained so the
//    event can be re-normalized once the user fixes the attribution.
// 5) contract_versions gains an optional revision_reason: reopening a
//    completed/cancelled task records why on the new version (docs/30 §6)
//    without rewriting the original completion history.
const DDL = `
CREATE TABLE migration_009_session_task (
  session_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL
) STRICT;
INSERT INTO migration_009_session_task SELECT session_id, task_id FROM host_sessions;
-- Every index on the dropped column must go first: this SQLite build's
-- DROP COLUMN does not auto-drop indexes that reference the column, and
-- 007's keyset index covers it too.
DROP INDEX idx_host_sessions_task;
DROP INDEX idx_host_sessions_project_task_started;
ALTER TABLE host_sessions DROP COLUMN task_id;
ALTER TABLE host_sessions ADD COLUMN task_id TEXT REFERENCES tasks(task_id) ON DELETE SET NULL;
UPDATE host_sessions
  SET task_id = (SELECT m.task_id FROM migration_009_session_task m WHERE m.session_id = host_sessions.session_id);
DROP TABLE migration_009_session_task;
CREATE INDEX idx_host_sessions_task ON host_sessions(task_id);
CREATE INDEX idx_host_sessions_project_task_started ON host_sessions(project_id, task_id, started_at, session_id);

ALTER TABLE project_root_bindings ADD COLUMN fingerprint TEXT NOT NULL DEFAULT '';
ALTER TABLE project_root_bindings ADD COLUMN confirmed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE project_root_bindings ADD COLUMN source TEXT NOT NULL DEFAULT 'discovered';
ALTER TABLE project_root_bindings ADD COLUMN case_semantics TEXT NOT NULL DEFAULT '';
UPDATE project_root_bindings
  SET fingerprint = COALESCE(json_extract(data, '$.fingerprint'), '')
  WHERE fingerprint = '';

CREATE TABLE session_task_attachments (
  attachment_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES host_sessions(session_id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  attached_at INTEGER NOT NULL,
  detached_at INTEGER,
  reason TEXT
) STRICT;
CREATE INDEX idx_session_attachments_session ON session_task_attachments(session_id, attached_at);
CREATE UNIQUE INDEX idx_session_attachments_active ON session_task_attachments(session_id) WHERE detached_at IS NULL;
INSERT INTO session_task_attachments (attachment_id, session_id, project_id, task_id, attached_at)
  SELECT 'backfill-' || session_id, session_id, project_id, task_id, started_at
  FROM host_sessions WHERE task_id IS NOT NULL;

CREATE TABLE unowned_activity (
  unowned_id TEXT PRIMARY KEY,
  host TEXT NOT NULL,
  host_session_id TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  reason TEXT NOT NULL,
  raw_event TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  resolved_project_id TEXT,
  resolved_task_id TEXT
) STRICT;
CREATE INDEX idx_unowned_pending ON unowned_activity(created_at, unowned_id) WHERE resolved_at IS NULL;
CREATE INDEX idx_unowned_host_session ON unowned_activity(host, host_session_id);

ALTER TABLE contract_versions ADD COLUMN revision_reason TEXT;
`;

export const migration009: Migration = {
  version: 9,
  name: "009-project-scope",
  up(db: StorageDatabase): void {
    db.exec(DDL);
  },
};
