import type { Migration } from "../migrator.js";
import type { StorageDatabase } from "../connection.js";

// ── Keyset pagination indexes (docs/22 Task 6 fix, step D) ──
// keysetPage orders by (projectColumn, keyColumn, idColumn) and every
// conversion needs an index that covers the WHERE + ORDER BY without a
// temp b-tree sort. Each index below was verified with EXPLAIN QUERY
// PLAN on a scratch database: after creation the plan degrades from
// "SEARCH … USE TEMP B-TREE FOR ORDER BY" (or a full SCAN) to a single
// covering-index SEARCH.
const DDL = `
CREATE INDEX idx_projects_created ON projects(created_at, project_id);
CREATE INDEX idx_tasks_project_created ON tasks(project_id, created_at, task_id);
CREATE INDEX idx_host_sessions_project_task_started ON host_sessions(project_id, task_id, started_at, session_id);
CREATE INDEX idx_decisions_project_created ON decisions(project_id, created_at, decision_id);
CREATE INDEX idx_decisions_project_task_created ON decisions(project_id, task_id, created_at, decision_id);
CREATE INDEX idx_assertions_project_valid ON situation_assertions(project_id, valid_from, assertion_id);
CREATE INDEX idx_assertions_project_task_valid ON situation_assertions(project_id, task_id, valid_from, assertion_id);
CREATE INDEX idx_evidence_project_observed ON evidence_items(project_id, observed_at, evidence_id);
CREATE INDEX idx_conversations_project_created ON conversations(project_id, created_at, conversation_id);
CREATE INDEX idx_collab_threads_project_created ON collaboration_threads(project_id, created_at, thread_id);
CREATE INDEX idx_review_items_project_created ON review_items(project_id, created_at, review_id);
CREATE INDEX idx_usage_task_call ON provider_usage(task_id, call_at, usage_id);
`;

export const migration007: Migration = {
  version: 7,
  name: "007-keyset-indexes",
  up(db: StorageDatabase): void {
    db.exec(DDL);
  },
};
