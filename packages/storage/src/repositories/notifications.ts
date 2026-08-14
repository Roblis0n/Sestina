import {
  NotificationStateSchema,
  type NotificationState,
} from "@sestina/schema";
import type { StorageTransaction } from "../transaction.js";
import { validateJson } from "../schema-check.js";
import { assertInTransaction, assertValidProjectId, fromMs, toMs } from "./shared.js";

// ── Project attribution gap (docs/22 Task 6 invariant) ──
// notification_states has NO project column, and there is no activities
// table to join against: activity_id is a free-form reference with no
// foreign key into events/decisions. The projectId argument below is
// therefore validated but CANNOT be enforced in SQL yet — these reads can
// still return rows from other projects. Closing the gap needs a migration
// (add notification_states.project_id + index, and write it in
// upsertState); until that lands, callers must not rely on these reads for
// cross-project separation.
export interface NotificationRepository {
  /** Aggregate state is updatable (acknowledgement toggles). */
  upsertState(state: NotificationState): void;
  get(projectId: string, notificationId: string): NotificationState | undefined;
  listByActivity(projectId: string, activityId: string): NotificationState[];
}

function assemble(row: {
  notification_id: string;
  activity_id: string | null;
  channel: string;
  delivered_at: number;
  acknowledged: number;
  data: string;
}): NotificationState {
  const data = JSON.parse(row.data) as NotificationState;
  return NotificationStateSchema.parse({
    ...data,
    notificationId: row.notification_id,
    activityId: row.activity_id ?? data.activityId,
    deliveredAt: fromMs(row.delivered_at),
    channel: row.channel,
    acknowledged: row.acknowledged !== 0,
  });
}

export function createNotificationRepository(tx: StorageTransaction): NotificationRepository {
  return {
    upsertState(state) {
      assertInTransaction(tx);
      tx.run(
        `INSERT INTO notification_states (notification_id, activity_id, channel, delivered_at, acknowledged, data)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(notification_id) DO UPDATE SET
           acknowledged = excluded.acknowledged,
           data = excluded.data`,
        state.notificationId,
        state.activityId,
        state.channel,
        toMs(state.deliveredAt),
        state.acknowledged ? 1 : 0,
        validateJson(NotificationStateSchema, state, "NotificationState"),
      );
    },

    get(projectId, notificationId) {
      assertValidProjectId(projectId);
      const row = tx.get<{
        notification_id: string;
        activity_id: string | null;
        channel: string;
        delivered_at: number;
        acknowledged: number;
        data: string;
      }>(
        "SELECT notification_id, activity_id, channel, delivered_at, acknowledged, data FROM notification_states WHERE notification_id = ?",
        notificationId,
      );
      return row ? assemble(row) : undefined;
    },

    listByActivity(projectId, activityId) {
      assertValidProjectId(projectId);
      const rows = tx.all<{
        notification_id: string;
        activity_id: string | null;
        channel: string;
        delivered_at: number;
        acknowledged: number;
        data: string;
      }>(
        "SELECT notification_id, activity_id, channel, delivered_at, acknowledged, data FROM notification_states WHERE activity_id = ? ORDER BY delivered_at",
        activityId,
      );
      return rows.map(assemble);
    },
  };
}
