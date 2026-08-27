import type { Migration } from "../migrator.js";

const DDL = `
CREATE TABLE IF NOT EXISTS deliberation_rooms (
  room_id TEXT PRIMARY KEY CHECK (room_id GLOB 'rdlr_*'),
  project_id TEXT NOT NULL CHECK (project_id GLOB 'rprj_*'),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('correction_appeal','unresolved_conflict','research_issue','research_decision','research_brief','explicit_project_object')),
  source_object_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','context_prepared','awaiting_manifest_confirmation','blind_round_running','reveal_ready','difference_review','retry_prepared','retry_running','challenge_prepared','challenge_running','waiting_user_resolution','partial','failed','cancelled','stale_conflicted','resolved','closed')),
  version INTEGER NOT NULL CHECK (version >= 1),
  source_hash TEXT NOT NULL CHECK (length(source_hash) = 64 AND source_hash NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data)),
  UNIQUE (project_id, room_id),
  FOREIGN KEY (project_id) REFERENCES research_projects(project_id)
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_deliberation_rooms_one_active_source
  ON deliberation_rooms(project_id, source_kind, source_object_id)
  WHERE status NOT IN ('resolved','closed');
CREATE INDEX IF NOT EXISTS idx_deliberation_rooms_project_updated
  ON deliberation_rooms(project_id, updated_at, room_id);
CREATE INDEX IF NOT EXISTS idx_deliberation_rooms_project_status
  ON deliberation_rooms(project_id, status, updated_at, room_id);
CREATE INDEX IF NOT EXISTS idx_deliberation_rooms_source_history
  ON deliberation_rooms(project_id, source_kind, source_object_id, created_at, room_id);
`;

export const migration018: Migration = {
  version: 18,
  name: "018-deliberation-rooms",
  up(db) {
    db.exec(DDL);
  },
};
