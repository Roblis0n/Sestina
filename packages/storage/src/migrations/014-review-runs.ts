import type { Migration } from "../migrator.js";

const DDL = `
CREATE TABLE IF NOT EXISTS review_runs (
  review_run_id TEXT PRIMARY KEY CHECK (review_run_id GLOB 'rrun_*'),
  project_id TEXT NOT NULL CHECK (project_id GLOB 'rprj_*'),
  episode_id TEXT NOT NULL CHECK (episode_id GLOB 'repi_*'),
  snapshot_id TEXT NOT NULL CHECK (snapshot_id GLOB 'rsnp_*'),
  input_hash TEXT NOT NULL CHECK (length(input_hash) = 64 AND input_hash NOT GLOB '*[^0-9a-f]*'),
  status TEXT NOT NULL CHECK (status IN ('running','completed_no_findings','completed_with_findings','completed_with_checker_errors')),
  version INTEGER NOT NULL CHECK (version >= 1),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  data TEXT NOT NULL CHECK (json_valid(data)),
  UNIQUE (project_id, review_run_id),
  FOREIGN KEY (project_id) REFERENCES research_projects(project_id),
  FOREIGN KEY (project_id, episode_id) REFERENCES revision_episodes(project_id, episode_id),
  FOREIGN KEY (project_id, snapshot_id) REFERENCES research_snapshots(project_id, snapshot_id)
) STRICT;

CREATE TABLE IF NOT EXISTS review_findings (
  finding_id TEXT PRIMARY KEY CHECK (finding_id GLOB 'rfnd_*'),
  project_id TEXT NOT NULL CHECK (project_id GLOB 'rprj_*'),
  review_run_id TEXT NOT NULL CHECK (review_run_id GLOB 'rrun_*'),
  checker_id TEXT NOT NULL CHECK (length(trim(checker_id)) > 0),
  checker_version TEXT NOT NULL CHECK (length(trim(checker_version)) > 0),
  checker_kind TEXT NOT NULL CHECK (checker_kind IN ('deterministic','semantic')),
  severity TEXT NOT NULL CHECK (severity IN ('info','warning','error','critical')),
  presentation TEXT NOT NULL CHECK (presentation IN ('foreground','audit_only','suppressed')),
  data TEXT NOT NULL CHECK (json_valid(data)),
  UNIQUE (project_id, review_run_id, finding_id),
  FOREIGN KEY (project_id, review_run_id) REFERENCES review_runs(project_id, review_run_id)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_review_runs_project_started
  ON review_runs(project_id, started_at, review_run_id);
CREATE INDEX IF NOT EXISTS idx_review_runs_episode_started
  ON review_runs(project_id, episode_id, started_at, review_run_id);
CREATE INDEX IF NOT EXISTS idx_review_findings_run
  ON review_findings(project_id, review_run_id, checker_id, checker_version, finding_id);
`;

export const migration014: Migration = {
  version: 14,
  name: "014-review-runs",
  up(db) { db.exec(DDL); },
};
