import type { Migration } from "../migrator.js";
import type { StorageDatabase } from "../connection.js";

// ── Lookup indexes (docs/22 Task 8, docs/30) ──
// 1) idx_host_sessions_project_started serves the project-scoped session
//    keyset page (sessions.listByProject: WHERE project_id ORDER BY
//    started_at, session_id) directly — without it SQLite materializes a
//    temp b-tree for every page.
// 2) idx_project_root_bindings_fingerprint_active is a partial index on the
//    active-binding fingerprint lookup used by discovery and root moves
//    (docs/30 §3/§4); only active rows are indexed, so the hot lookup never
//    scans archived bindings.
const DDL = `
CREATE INDEX idx_host_sessions_project_started
  ON host_sessions(project_id, started_at, session_id);
CREATE INDEX idx_project_root_bindings_fingerprint_active
  ON project_root_bindings(fingerprint) WHERE status = 'active';
`;

export const migration010: Migration = {
  version: 10,
  name: "010-lookup-indexes",
  up(db: StorageDatabase): void {
    db.exec(DDL);
  },
};
