import type { Migration } from "../migrator.js";

const DDL = `
CREATE TABLE IF NOT EXISTS research_projects (
  project_id TEXT PRIMARY KEY CHECK (project_id GLOB 'rprj_*'),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  root_path TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data))
) STRICT;

CREATE TABLE IF NOT EXISTS research_artifacts (
  artifact_id TEXT PRIMARY KEY CHECK (artifact_id GLOB 'rart_*'),
  project_id TEXT NOT NULL CHECK (project_id GLOB 'rprj_*'),
  kind TEXT NOT NULL CHECK (kind IN ('manuscript','section','interview','codebook','dataset','analysis','review_response','research_note')),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  version INTEGER NOT NULL CHECK (version >= 1),
  active_revision_id TEXT,
  tombstoned INTEGER NOT NULL CHECK (tombstoned IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data)),
  UNIQUE (project_id, artifact_id),
  FOREIGN KEY (project_id) REFERENCES research_projects(project_id),
  FOREIGN KEY (project_id, artifact_id, active_revision_id)
    REFERENCES artifact_revisions(project_id, artifact_id, revision_id)
) STRICT;

CREATE TABLE IF NOT EXISTS artifact_revisions (
  revision_id TEXT PRIMARY KEY CHECK (revision_id GLOB 'rrev_*'),
  project_id TEXT NOT NULL CHECK (project_id GLOB 'rprj_*'),
  artifact_id TEXT NOT NULL CHECK (artifact_id GLOB 'rart_*'),
  parent_revision_id TEXT,
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data)),
  UNIQUE (project_id, artifact_id, revision_id),
  FOREIGN KEY (project_id, artifact_id)
    REFERENCES research_artifacts(project_id, artifact_id),
  FOREIGN KEY (project_id, artifact_id, parent_revision_id)
    REFERENCES artifact_revisions(project_id, artifact_id, revision_id)
) STRICT;

CREATE TABLE IF NOT EXISTS research_briefs (
  brief_id TEXT PRIMARY KEY CHECK (brief_id GLOB 'rbrf_*'),
  project_id TEXT NOT NULL CHECK (project_id GLOB 'rprj_*'),
  current_version_id TEXT NOT NULL CHECK (current_version_id GLOB 'rbrf_*'),
  version INTEGER NOT NULL CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data)),
  UNIQUE (project_id, brief_id),
  FOREIGN KEY (project_id) REFERENCES research_projects(project_id)
) STRICT;

CREATE TABLE IF NOT EXISTS research_decisions (
  decision_id TEXT PRIMARY KEY CHECK (decision_id GLOB 'rdec_*'),
  project_id TEXT NOT NULL CHECK (project_id GLOB 'rprj_*'),
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('project','artifact','brief','issue')),
  scope_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('proposed','accepted','rejected','deferred','frozen','superseded')),
  version INTEGER NOT NULL CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data)),
  UNIQUE (project_id, decision_id),
  FOREIGN KEY (project_id) REFERENCES research_projects(project_id)
) STRICT;

CREATE TABLE IF NOT EXISTS research_decision_transitions (
  project_id TEXT NOT NULL,
  decision_id TEXT NOT NULL,
  transition_index INTEGER NOT NULL CHECK (transition_index >= 0),
  from_status TEXT,
  to_status TEXT NOT NULL CHECK (to_status IN ('proposed','accepted','rejected','deferred','frozen','superseded')),
  occurred_at TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data)),
  PRIMARY KEY (project_id, decision_id, transition_index),
  FOREIGN KEY (project_id, decision_id)
    REFERENCES research_decisions(project_id, decision_id)
) STRICT;

CREATE TABLE IF NOT EXISTS research_issues (
  issue_id TEXT PRIMARY KEY CHECK (issue_id GLOB 'riss_*'),
  project_id TEXT NOT NULL CHECK (project_id GLOB 'rprj_*'),
  fingerprint TEXT NOT NULL CHECK (length(fingerprint) = 64 AND fingerprint NOT GLOB '*[^0-9a-f]*'),
  source_artifact_id TEXT NOT NULL CHECK (source_artifact_id GLOB 'rart_*'),
  source_revision_id TEXT NOT NULL CHECK (source_revision_id GLOB 'rrev_*'),
  lineage_root_revision_id TEXT NOT NULL CHECK (lineage_root_revision_id GLOB 'rrev_*'),
  status TEXT NOT NULL CHECK (status IN ('open','acknowledged','disputed','waived','resolved','suppressed','reopened')),
  version INTEGER NOT NULL CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data)),
  UNIQUE (project_id, issue_id),
  FOREIGN KEY (project_id) REFERENCES research_projects(project_id),
  FOREIGN KEY (project_id, source_artifact_id)
    REFERENCES research_artifacts(project_id, artifact_id),
  FOREIGN KEY (project_id, source_artifact_id, source_revision_id)
    REFERENCES artifact_revisions(project_id, artifact_id, revision_id),
  FOREIGN KEY (project_id, source_artifact_id, lineage_root_revision_id)
    REFERENCES artifact_revisions(project_id, artifact_id, revision_id)
) STRICT;

CREATE TABLE IF NOT EXISTS research_issue_transitions (
  project_id TEXT NOT NULL,
  issue_id TEXT NOT NULL,
  transition_index INTEGER NOT NULL CHECK (transition_index >= 0),
  from_status TEXT,
  to_status TEXT NOT NULL CHECK (to_status IN ('open','acknowledged','disputed','waived','resolved','suppressed','reopened')),
  occurred_at TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data)),
  PRIMARY KEY (project_id, issue_id, transition_index),
  FOREIGN KEY (project_id, issue_id)
    REFERENCES research_issues(project_id, issue_id)
) STRICT;

CREATE TABLE IF NOT EXISTS revision_episodes (
  episode_id TEXT PRIMARY KEY CHECK (episode_id GLOB 'repi_*'),
  project_id TEXT NOT NULL CHECK (project_id GLOB 'rprj_*'),
  artifact_id TEXT NOT NULL CHECK (artifact_id GLOB 'rart_*'),
  baseline_revision_id TEXT NOT NULL CHECK (baseline_revision_id GLOB 'rrev_*'),
  candidate_revision_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('draft','active','candidate_submitted','reviewed','user_action_required','accepted','rejected','abandoned')),
  version INTEGER NOT NULL CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data)),
  UNIQUE (project_id, episode_id),
  FOREIGN KEY (project_id, artifact_id)
    REFERENCES research_artifacts(project_id, artifact_id),
  FOREIGN KEY (project_id, artifact_id, baseline_revision_id)
    REFERENCES artifact_revisions(project_id, artifact_id, revision_id),
  FOREIGN KEY (project_id, artifact_id, candidate_revision_id)
    REFERENCES artifact_revisions(project_id, artifact_id, revision_id)
) STRICT;

CREATE TABLE IF NOT EXISTS research_snapshots (
  snapshot_id TEXT PRIMARY KEY CHECK (snapshot_id GLOB 'rsnp_*'),
  project_id TEXT NOT NULL CHECK (project_id GLOB 'rprj_*'),
  episode_id TEXT NOT NULL CHECK (episode_id GLOB 'repi_*'),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data)),
  UNIQUE (project_id, snapshot_id),
  FOREIGN KEY (project_id, episode_id)
    REFERENCES revision_episodes(project_id, episode_id)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_research_projects_created
  ON research_projects(created_at, project_id);
CREATE INDEX IF NOT EXISTS idx_research_artifacts_project_created
  ON research_artifacts(project_id, created_at, artifact_id);
CREATE INDEX IF NOT EXISTS idx_research_artifacts_project_active
  ON research_artifacts(project_id, tombstoned, artifact_id);
CREATE INDEX IF NOT EXISTS idx_artifact_revisions_artifact_created
  ON artifact_revisions(project_id, artifact_id, created_at, revision_id);
CREATE INDEX IF NOT EXISTS idx_artifact_revisions_parent
  ON artifact_revisions(project_id, artifact_id, parent_revision_id, revision_id);
CREATE INDEX IF NOT EXISTS idx_research_briefs_project_created
  ON research_briefs(project_id, created_at, brief_id);
CREATE INDEX IF NOT EXISTS idx_research_decisions_project_created
  ON research_decisions(project_id, created_at, decision_id);
CREATE INDEX IF NOT EXISTS idx_research_decisions_project_scope
  ON research_decisions(project_id, scope_kind, scope_key, created_at, decision_id);
CREATE INDEX IF NOT EXISTS idx_research_decisions_active
  ON research_decisions(project_id, status, decision_id)
  WHERE status IN ('accepted','frozen');
CREATE INDEX IF NOT EXISTS idx_research_decision_transitions_order
  ON research_decision_transitions(project_id, decision_id, transition_index);
CREATE INDEX IF NOT EXISTS idx_research_issues_project_created
  ON research_issues(project_id, created_at, issue_id);
CREATE INDEX IF NOT EXISTS idx_research_issues_project_status
  ON research_issues(project_id, status, created_at, issue_id);
CREATE INDEX IF NOT EXISTS idx_research_issue_transitions_order
  ON research_issue_transitions(project_id, issue_id, transition_index);
CREATE INDEX IF NOT EXISTS idx_revision_episodes_project_created
  ON revision_episodes(project_id, created_at, episode_id);
CREATE INDEX IF NOT EXISTS idx_revision_episodes_project_status
  ON revision_episodes(project_id, status, created_at, episode_id);
CREATE INDEX IF NOT EXISTS idx_research_snapshots_project_created
  ON research_snapshots(project_id, created_at, snapshot_id);
CREATE INDEX IF NOT EXISTS idx_research_snapshots_episode_created
  ON research_snapshots(project_id, episode_id, created_at, snapshot_id);
`;

export const migration013: Migration = {
  version: 13,
  name: "013-research-core",
  up(db) {
    db.exec(DDL);
  },
};
