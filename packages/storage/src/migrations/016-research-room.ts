import type { Migration } from "../migrator.js";

const DDL = `
CREATE TABLE IF NOT EXISTS research_room_receipts (
  receipt_id TEXT PRIMARY KEY CHECK (receipt_id GLOB 'rrcp_*'),
  project_id TEXT NOT NULL CHECK (project_id GLOB 'rprj_*'),
  review_id TEXT NOT NULL CHECK (review_id GLOB 'rrvw_*'),
  source_episode_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('committed','rolled_back')),
  disposition TEXT NOT NULL CHECK (disposition IN ('accepted','rejected','modified_accepted','deferred','direction_changed')),
  provider_status TEXT NOT NULL CHECK (provider_status IN ('semantic_ready','ledger_only')),
  evidence_class TEXT NOT NULL CHECK (evidence_class IN ('owner_scenario','synthetic_fixture','synthetic_adversarial_fixture','user_supplied_review_input')),
  counts_as_external_evidence INTEGER NOT NULL CHECK (counts_as_external_evidence = 0),
  version INTEGER NOT NULL CHECK (version >= 1),
  receipt_hash TEXT NOT NULL CHECK (length(receipt_hash) = 64 AND receipt_hash NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data)),
  UNIQUE (project_id, receipt_id),
  FOREIGN KEY (project_id) REFERENCES research_projects(project_id),
  FOREIGN KEY (project_id, source_episode_id) REFERENCES revision_episodes(project_id, episode_id)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_research_room_receipts_project_created
  ON research_room_receipts(project_id, created_at, receipt_id);
CREATE INDEX IF NOT EXISTS idx_research_room_receipts_project_status
  ON research_room_receipts(project_id, status, updated_at, receipt_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_research_room_receipts_project_review
  ON research_room_receipts(project_id, review_id);
`;

export const migration016: Migration = {
  version: 16,
  name: "016-research-room",
  up(db) { db.exec(DDL); },
};
