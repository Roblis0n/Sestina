import {
  NotificationStateSchema,
  type NotificationState,
} from "@sestina/schema";
import type { StorageTransaction } from "../transaction.js";
import { validateJson } from "../schema-check.js";
import { assertInTransaction, fromMs, toMs } from "./shared.js";

export interface NotificationRepository {
  /** Aggregate state is updatable (acknowledgement toggles). */
  upsertState(state: NotificationState): void;
  get(notificationId: string): NotificationState | undefined;
  listByActivity(activityId: string): NotificationState[];
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

    get(notificationId) {
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

    listByActivity(activityId) {
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
