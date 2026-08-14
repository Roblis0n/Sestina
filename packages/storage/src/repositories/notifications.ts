import {
  NotificationStateSchema,
  type NotificationState,
} from "@sestina/schema";
import type { StorageTransaction } from "../transaction.js";
import { validateJson } from "../schema-check.js";
import { assertInTransaction, assertValidProjectId, fromMs, toMs } from "./shared.js";

// ── Project-fenced notification state (docs/22 Task 6 fix) ──
// notification_states.project_id (migration 008) owns the row: reads are
// pinned to it in SQL. Legacy rows carry the fail-closed '' sentinel, which
// never equals a valid ULID, so pre-migration rows resolve under NO project
// instead of leaking into whichever project asks first.
export interface NotificationRepository {
  /** Aggregate state is updatable (acknowledgement toggles). */
  upsertState(state: NotificationState): void;
  get(projectId: string, notificationId: string): NotificationState | undefined;
  listByActivity(projectId: string, activityId: string): NotificationState[];
}

function assemble(row: {
  notification_id: string;
  project_id: string;
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
    projectId: row.project_id !== "" ? row.project_id : data.projectId,
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
        `INSERT INTO notification_states (notification_id, project_id, activity_id, channel, delivered_at, acknowledged, data)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(notification_id) DO UPDATE SET
           project_id = excluded.project_id,
           acknowledged = excluded.acknowledged,
           data = excluded.data`,
        state.notificationId,
        state.projectId,
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
        project_id: string;
        activity_id: string | null;
        channel: string;
        delivered_at: number;
        acknowledged: number;
        data: string;
      }>(
        `SELECT notification_id, project_id, activity_id, channel, delivered_at, acknowledged, data
         FROM notification_states
         WHERE notification_id = ? AND project_id = ?`,
        notificationId,
        projectId,
      );
      return row ? assemble(row) : undefined;
    },

    listByActivity(projectId, activityId) {
      assertValidProjectId(projectId);
      const rows = tx.all<{
        notification_id: string;
        project_id: string;
        activity_id: string | null;
        channel: string;
        delivered_at: number;
        acknowledged: number;
        data: string;
      }>(
        `SELECT notification_id, project_id, activity_id, channel, delivered_at, acknowledged, data
         FROM notification_states
         WHERE activity_id = ? AND project_id = ?
         ORDER BY delivered_at`,
        activityId,
        projectId,
      );
      return rows.map(assemble);
    },
  };
}
