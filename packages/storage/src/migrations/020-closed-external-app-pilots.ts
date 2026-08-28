import type { Migration } from "../migrator.js";

const DDL = `
CREATE TABLE IF NOT EXISTS closed_external_app_pilots (
  pilot_id TEXT PRIMARY KEY CHECK (pilot_id GLOB 'rpil_*'),
  project_id TEXT NOT NULL CHECK (project_id GLOB 'rprj_*'),
  host TEXT NOT NULL CHECK (host IN ('codex')),
  brief_id TEXT NOT NULL CHECK (brief_id GLOB 'rbrf_*'),
  brief_version INTEGER NOT NULL CHECK (brief_version >= 1),
  episode_id TEXT NOT NULL CHECK (episode_id GLOB 'repi_*'),
  status TEXT NOT NULL CHECK (status IN ('draft','preflight_ready','context_confirmation_required','context_confirmed','launching','running','candidate_received','candidate_confirmation_required','review_required','user_disposition_required','continuity_check_ready','continuity_check_running','continuity_verified','closed','stale','expired','cancelled','failed','blocked_host_unavailable','interrupted_unknown')),
  version INTEGER NOT NULL CHECK (version >= 1),
  current_manifest_id TEXT CHECK (current_manifest_id IS NULL OR current_manifest_id GLOB 'rman_*'),
  current_manifest_hash TEXT CHECK (current_manifest_hash IS NULL OR (length(current_manifest_hash) = 64 AND current_manifest_hash NOT GLOB '*[^0-9a-f]*')),
  candidate_id TEXT CHECK (candidate_id IS NULL OR candidate_id GLOB 'rpca_*'),
  candidate_hash TEXT CHECK (candidate_hash IS NULL OR (length(candidate_hash) = 64 AND candidate_hash NOT GLOB '*[^0-9a-f]*')),
  review_id TEXT CHECK (review_id IS NULL OR review_id GLOB 'rrvw_*'),
  receipt_id TEXT CHECK (receipt_id IS NULL OR receipt_id GLOB 'rrcp_*'),
  continuity_attempt_id TEXT CHECK (continuity_attempt_id IS NULL OR continuity_attempt_id GLOB 'rpat_*'),
  evidence_class TEXT NOT NULL CHECK (evidence_class IN ('synthetic_fixture','owner_operated_closed_host_observation')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT,
  data TEXT NOT NULL CHECK (json_valid(data)),
  UNIQUE (project_id, pilot_id),
  FOREIGN KEY (project_id) REFERENCES research_projects(project_id)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_closed_external_app_pilots_project_updated
  ON closed_external_app_pilots(project_id, updated_at DESC, pilot_id DESC);
CREATE INDEX IF NOT EXISTS idx_closed_external_app_pilots_project_status
  ON closed_external_app_pilots(project_id, status, updated_at DESC, pilot_id DESC);
CREATE INDEX IF NOT EXISTS idx_closed_external_app_pilots_attention
  ON closed_external_app_pilots(project_id, status, updated_at DESC)
  WHERE status IN ('candidate_received','candidate_confirmation_required','review_required','user_disposition_required','stale','failed','blocked_host_unavailable','interrupted_unknown');
CREATE UNIQUE INDEX IF NOT EXISTS idx_closed_external_app_pilots_candidate_once
  ON closed_external_app_pilots(project_id, candidate_hash)
  WHERE candidate_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS closed_external_app_pilot_attempts (
  attempt_id TEXT PRIMARY KEY CHECK (attempt_id GLOB 'rpat_*'),
  pilot_id TEXT NOT NULL CHECK (pilot_id GLOB 'rpil_*'),
  project_id TEXT NOT NULL CHECK (project_id GLOB 'rprj_*'),
  kind TEXT NOT NULL CHECK (kind IN ('candidate_generation','continuity_check')),
  ordinal INTEGER NOT NULL CHECK (ordinal IN (1,2)),
  status TEXT NOT NULL CHECK (status IN ('prepared','confirmed','launching','running','completed','failed','cancelled','unknown')),
  manifest_id TEXT NOT NULL CHECK (manifest_id GLOB 'rman_*'),
  manifest_hash TEXT NOT NULL CHECK (length(manifest_hash) = 64 AND manifest_hash NOT GLOB '*[^0-9a-f]*'),
  confirmation_nonce TEXT NOT NULL UNIQUE CHECK (confirmation_nonce GLOB 'rpno_*'),
  confirmation_expires_at TEXT NOT NULL,
  confirmed_at TEXT,
  confirmation_consumed_at TEXT,
  invocation_id TEXT UNIQUE CHECK (invocation_id IS NULL OR invocation_id GLOB 'rpiv_*'),
  started_at TEXT,
  completed_at TEXT,
  failure_code TEXT,
  data TEXT NOT NULL CHECK (json_valid(data)),
  UNIQUE (pilot_id, kind, ordinal),
  UNIQUE (project_id, pilot_id, attempt_id),
  FOREIGN KEY (project_id, pilot_id) REFERENCES closed_external_app_pilots(project_id, pilot_id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX IF NOT EXISTS idx_closed_external_app_pilot_attempts_pilot
  ON closed_external_app_pilot_attempts(project_id, pilot_id, ordinal, attempt_id);
CREATE INDEX IF NOT EXISTS idx_closed_external_app_pilot_attempts_running
  ON closed_external_app_pilot_attempts(project_id, status, started_at, attempt_id)
  WHERE status IN ('launching','running');

CREATE TABLE IF NOT EXISTS closed_external_app_pilot_events (
  event_id TEXT PRIMARY KEY CHECK (event_id GLOB 'rpev_*'),
  pilot_id TEXT NOT NULL CHECK (pilot_id GLOB 'rpil_*'),
  project_id TEXT NOT NULL CHECK (project_id GLOB 'rprj_*'),
  event_index INTEGER NOT NULL CHECK (event_index >= 0),
  from_status TEXT,
  to_status TEXT NOT NULL,
  reason TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data)),
  UNIQUE (pilot_id, event_index),
  UNIQUE (project_id, pilot_id, event_id),
  FOREIGN KEY (project_id, pilot_id) REFERENCES closed_external_app_pilots(project_id, pilot_id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX IF NOT EXISTS idx_closed_external_app_pilot_events_pilot
  ON closed_external_app_pilot_events(project_id, pilot_id, event_index, event_id);

CREATE TRIGGER IF NOT EXISTS trg_closed_external_app_pilot_events_no_update
BEFORE UPDATE ON closed_external_app_pilot_events
BEGIN
  SELECT RAISE(ABORT, 'closed_external_app_pilot_events_append_only');
END;

CREATE TRIGGER IF NOT EXISTS trg_closed_external_app_pilot_events_no_delete
BEFORE DELETE ON closed_external_app_pilot_events
BEGIN
  SELECT RAISE(ABORT, 'closed_external_app_pilot_events_append_only');
END;
`;

export const migration020: Migration = {
  version: 20,
  name: "020-closed-external-app-pilots",
  up(db) {
    db.exec(DDL);
  },
};
