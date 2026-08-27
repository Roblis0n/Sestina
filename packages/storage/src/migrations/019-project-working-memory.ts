import type { Migration } from "../migrator.js";

const DDL = `
CREATE TABLE IF NOT EXISTS project_working_memory (
  item_id TEXT PRIMARY KEY CHECK (item_id GLOB 'rmem_*'),
  project_id TEXT NOT NULL CHECK (project_id GLOB 'rprj_*'),
  kind TEXT CHECK (kind IS NULL OR kind IN ('term','working_hint','resume_note','workset')),
  status TEXT NOT NULL CHECK (status IN ('candidate','active','stale','expired','retired','forgotten')),
  version INTEGER NOT NULL CHECK (version >= 1),
  outbound_policy TEXT CHECK (outbound_policy IS NULL OR outbound_policy IN ('never_send','explicit_manifest_only')),
  expires_at TEXT,
  source_object_id TEXT,
  source_object_version INTEGER CHECK (source_object_version IS NULL OR source_object_version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data)),
  CHECK (
    (status = 'forgotten' AND kind IS NULL AND outbound_policy IS NULL AND expires_at IS NULL AND source_object_id IS NULL AND source_object_version IS NULL)
    OR
    (status <> 'forgotten' AND kind IS NOT NULL AND outbound_policy IS NOT NULL)
  ),
  UNIQUE (project_id, item_id),
  FOREIGN KEY (project_id) REFERENCES research_projects(project_id)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_project_working_memory_project_updated
  ON project_working_memory(project_id, updated_at DESC, item_id DESC);
CREATE INDEX IF NOT EXISTS idx_project_working_memory_project_state_expiry
  ON project_working_memory(project_id, status, expires_at, updated_at DESC, item_id DESC);
CREATE INDEX IF NOT EXISTS idx_project_working_memory_source
  ON project_working_memory(project_id, source_object_id, source_object_version)
  WHERE source_object_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS resume_checkpoints (
  checkpoint_id TEXT PRIMARY KEY CHECK (checkpoint_id GLOB 'rmcp_*'),
  project_id TEXT NOT NULL CHECK (project_id GLOB 'rprj_*'),
  project_version INTEGER NOT NULL CHECK (project_version >= 1),
  version INTEGER NOT NULL CHECK (version >= 1),
  reviewed_at TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data)),
  UNIQUE (project_id, checkpoint_id),
  FOREIGN KEY (project_id) REFERENCES research_projects(project_id)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_resume_checkpoints_project_reviewed
  ON resume_checkpoints(project_id, reviewed_at DESC, checkpoint_id DESC);

`;

export const migration019: Migration = {
  version: 19,
  name: "019-project-working-memory",
  up(db) {
    db.exec(DDL);
  },
};
