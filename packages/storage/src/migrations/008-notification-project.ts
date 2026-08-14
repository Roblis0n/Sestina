import type { Migration } from "../migrator.js";
import type { StorageDatabase } from "../connection.js";

// ── Notification project attribution + fence/pagination indexes (docs/22 Task 6 fix) ──
// 1) notification_states gains project_id so notification reads can be fenced
//    to the requesting project like every other body/scope query. Legacy rows
//    keep the '' default — a fail-closed sentinel that never equals a valid
//    ULID, so pre-migration rows resolve under NO project instead of leaking
//    into whichever project asks first.
// 2) Covering indexes for the keysetPage conversions in this fix: each one
//    covers the (scope, key, id) WHERE + ORDER BY shape without a temp
//    b-tree sort (verified with EXPLAIN QUERY PLAN, same convention as 007).
const DDL = `
ALTER TABLE notification_states ADD COLUMN project_id TEXT NOT NULL DEFAULT '';
CREATE INDEX idx_notification_states_project ON notification_states(project_id, notification_id);
CREATE INDEX idx_notification_states_activity ON notification_states(project_id, activity_id, delivered_at);
CREATE INDEX idx_conversation_messages_conv_created ON conversation_messages(conversation_id, created_at, message_id);
CREATE INDEX idx_collab_messages_thread_created ON collaboration_messages(thread_id, created_at, message_id);
CREATE INDEX idx_collab_messages_task_created ON collaboration_messages(task_id, created_at, message_id);
CREATE INDEX idx_tombstones_project_created ON retention_tombstones(project_id, created_at, tombstone_id);
`;

export const migration008: Migration = {
  version: 8,
  name: "008-notification-project",
  up(db: StorageDatabase): void {
    db.exec(DDL);
  },
};
