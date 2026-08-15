import type { Migration } from "../migrator.js";
import type { StorageDatabase } from "../connection.js";

// ── Correction lookup indexes (docs/22 Task 9, docs/33 §7) ──
// 1) idx_corrections_project_task serves listByTask (WHERE project_id AND
//    task_id) directly — without it SQLite scans the whole table per list.
// 2) idx_corrections_project_scope serves project-scoped reads filtered by
//    scope.
// 3) idx_corrections_superseded_by serves supersession-chain walks (finding
//    every record a newer correction superseded).
const DDL = `
CREATE INDEX idx_corrections_project_task
  ON corrections(project_id, task_id);
CREATE INDEX idx_corrections_project_scope
  ON corrections(project_id, scope);
CREATE INDEX idx_corrections_superseded_by
  ON corrections(superseded_by);
`;

export const migration011: Migration = {
  version: 11,
  name: "011-correction-indexes",
  up(db: StorageDatabase): void {
    db.exec(DDL);
  },
};
