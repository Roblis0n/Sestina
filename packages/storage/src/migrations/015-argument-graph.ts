import type { Migration } from "../migrator.js";

const DDL = `
CREATE TABLE IF NOT EXISTS argument_claims (
  claim_id TEXT PRIMARY KEY CHECK (claim_id GLOB 'rclm_*'), project_id TEXT NOT NULL, artifact_id TEXT NOT NULL,
  revision_id TEXT NOT NULL, kind TEXT NOT NULL, version INTEGER NOT NULL CHECK (version >= 1), created_at TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data)), UNIQUE(project_id, claim_id),
  FOREIGN KEY(project_id, artifact_id, revision_id) REFERENCES artifact_revisions(project_id, artifact_id, revision_id)
) STRICT;
CREATE TABLE IF NOT EXISTS argument_evidence (
  evidence_id TEXT PRIMARY KEY CHECK (evidence_id GLOB 'revd_*'), project_id TEXT NOT NULL, artifact_id TEXT, revision_id TEXT,
  kind TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('current','stale','disputed')), inference_capacity TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version >= 1), created_at TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)),
  UNIQUE(project_id, evidence_id), FOREIGN KEY(project_id) REFERENCES research_projects(project_id),
  FOREIGN KEY(project_id, artifact_id, revision_id) REFERENCES artifact_revisions(project_id, artifact_id, revision_id),
  CHECK ((artifact_id IS NULL) = (revision_id IS NULL))
) STRICT;
CREATE TABLE IF NOT EXISTS argument_mechanism_links (
  mechanism_link_id TEXT PRIMARY KEY CHECK(mechanism_link_id GLOB 'rmec_*'), project_id TEXT NOT NULL, artifact_id TEXT NOT NULL,
  revision_id TEXT NOT NULL, from_claim_id TEXT NOT NULL, to_claim_id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version >= 1),
  created_at TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), UNIQUE(project_id, mechanism_link_id),
  FOREIGN KEY(project_id, artifact_id, revision_id) REFERENCES artifact_revisions(project_id, artifact_id, revision_id),
  FOREIGN KEY(project_id, from_claim_id) REFERENCES argument_claims(project_id, claim_id),
  FOREIGN KEY(project_id, to_claim_id) REFERENCES argument_claims(project_id, claim_id)
) STRICT;
CREATE TABLE IF NOT EXISTS argument_claim_evidence_links (
  project_id TEXT NOT NULL, claim_id TEXT NOT NULL, evidence_id TEXT NOT NULL, role TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('proven','unproven','disputed','stale')), version INTEGER NOT NULL CHECK(version >= 1),
  created_at TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), PRIMARY KEY(project_id, claim_id, evidence_id),
  FOREIGN KEY(project_id, claim_id) REFERENCES argument_claims(project_id, claim_id),
  FOREIGN KEY(project_id, evidence_id) REFERENCES argument_evidence(project_id, evidence_id)
) STRICT;
CREATE TABLE IF NOT EXISTS argument_mechanism_evidence_links (
  project_id TEXT NOT NULL, mechanism_link_id TEXT NOT NULL, evidence_id TEXT NOT NULL, step_index INTEGER NOT NULL CHECK(step_index >= 0),
  status TEXT NOT NULL CHECK(status IN ('proven','unproven','disputed','stale')), version INTEGER NOT NULL CHECK(version >= 1),
  created_at TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), PRIMARY KEY(project_id, mechanism_link_id, evidence_id),
  FOREIGN KEY(project_id, mechanism_link_id) REFERENCES argument_mechanism_links(project_id, mechanism_link_id),
  FOREIGN KEY(project_id, evidence_id) REFERENCES argument_evidence(project_id, evidence_id)
) STRICT;
CREATE TABLE IF NOT EXISTS argument_deltas (
  delta_id TEXT PRIMARY KEY CHECK(delta_id GLOB 'rdlt_*'), project_id TEXT NOT NULL, artifact_id TEXT NOT NULL,
  baseline_revision_id TEXT NOT NULL, candidate_revision_id TEXT NOT NULL, kind TEXT NOT NULL, version INTEGER NOT NULL CHECK(version >= 1),
  created_at TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), UNIQUE(project_id, delta_id),
  FOREIGN KEY(project_id, artifact_id, baseline_revision_id) REFERENCES artifact_revisions(project_id, artifact_id, revision_id),
  FOREIGN KEY(project_id, artifact_id, candidate_revision_id) REFERENCES artifact_revisions(project_id, artifact_id, revision_id)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_argument_claims_project_revision ON argument_claims(project_id, revision_id, claim_id);
CREATE INDEX IF NOT EXISTS idx_argument_evidence_project_revision ON argument_evidence(project_id, revision_id, evidence_id);
CREATE INDEX IF NOT EXISTS idx_argument_mechanisms_project_revision ON argument_mechanism_links(project_id, revision_id, mechanism_link_id);
CREATE INDEX IF NOT EXISTS idx_argument_claim_evidence_claim ON argument_claim_evidence_links(project_id, claim_id, evidence_id);
CREATE INDEX IF NOT EXISTS idx_argument_mechanism_evidence_mechanism ON argument_mechanism_evidence_links(project_id, mechanism_link_id, evidence_id);
CREATE INDEX IF NOT EXISTS idx_argument_deltas_project_candidate ON argument_deltas(project_id, candidate_revision_id, delta_id);
`;

export const migration015: Migration = { version: 15, name: "015-argument-graph", up(db) { db.exec(DDL); } };
