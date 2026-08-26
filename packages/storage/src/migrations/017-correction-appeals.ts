import type { Migration } from "../migrator.js";

const DDL = `
CREATE TABLE IF NOT EXISTS correction_appeals (
  appeal_id TEXT PRIMARY KEY CHECK (appeal_id GLOB 'rapl_*'),
  project_id TEXT NOT NULL CHECK (project_id GLOB 'rprj_*'),
  review_id TEXT NOT NULL CHECK (review_id GLOB 'rrvw_*'),
  source_receipt_id TEXT NOT NULL CHECK (source_receipt_id GLOB 'rrcp_*'),
  finding_id TEXT NOT NULL CHECK (finding_id GLOB 'rfnd_*'),
  previous_appeal_id TEXT CHECK (previous_appeal_id IS NULL OR previous_appeal_id GLOB 'rapl_*'),
  status TEXT NOT NULL CHECK (status IN ('draft','recorded','awaiting_send_confirmation','second_opinion_running','second_opinion_ready','appeal_record_only','waiting_user_resolution','provider_failed','cancelled','stale_conflicted','resolved')),
  version INTEGER NOT NULL CHECK (version >= 1),
  finding_hash TEXT NOT NULL CHECK (length(finding_hash) = 64 AND finding_hash NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data)),
  UNIQUE (project_id, appeal_id),
  FOREIGN KEY (project_id) REFERENCES research_projects(project_id),
  FOREIGN KEY (previous_appeal_id) REFERENCES correction_appeals(appeal_id)
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_correction_appeals_one_active_finding
  ON correction_appeals(project_id, review_id, finding_id)
  WHERE status <> 'resolved';
CREATE INDEX IF NOT EXISTS idx_correction_appeals_project_updated
  ON correction_appeals(project_id, updated_at, appeal_id);
CREATE INDEX IF NOT EXISTS idx_correction_appeals_project_status
  ON correction_appeals(project_id, status, updated_at, appeal_id);
CREATE INDEX IF NOT EXISTS idx_correction_appeals_source_history
  ON correction_appeals(project_id, review_id, finding_id, created_at, appeal_id);
`;

export const migration017: Migration = {
  version: 17,
  name: "017-correction-appeals",
  up(db) {
    db.exec(DDL);
  },
};
