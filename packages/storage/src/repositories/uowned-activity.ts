import {
  UnownedActivitySchema,
  SestinaErrorCode,
  SestinaError,
  type UnownedActivity,
} from "@sestina/schema";
import type { StorageTransaction } from "../transaction.js";
import { assertInTransaction, fromMs, keysetPage, toMs, type CursorInput, type Page } from "./shared.js";

/**
 * The queue of host activity that could not resolve a project (docs/30
 * §10). The exact raw event JSON is retained so the activity can be
 * re-normalized once the user fixes the attribution; pending items page
 * through the partial index from migration 009.
 */
export interface UnownedActivityRepository {
  insert(activity: UnownedActivity): void;
  get(unownedId: string): UnownedActivity | undefined;
  listPending(input: CursorInput): Page<UnownedActivity>;
  /**
   * Marks the activity resolved. Resolving an already-resolved item is an
   * idempotency violation — the resolution is a one-way attribution fix.
   */
  resolve(unownedId: string, resolution: { projectId: string; taskId: string | null }): void;
}

interface UnownedRow {
  unowned_id: string;
  host: string;
  host_session_id: string;
  occurred_at: number;
  reason: string;
  raw_event: string;
  payload_hash: string;
  created_at: number;
  resolved_at: number | null;
  resolved_project_id: string | null;
  resolved_task_id: string | null;
}

const UNOWNED_COLUMNS = `unowned_id, host, host_session_id, occurred_at, reason, raw_event,
  payload_hash, created_at, resolved_at, resolved_project_id, resolved_task_id`;

function assembleUnowned(row: UnownedRow): UnownedActivity {
  return UnownedActivitySchema.parse({
    unownedId: row.unowned_id,
    host: row.host,
    hostSessionId: row.host_session_id,
    occurredAt: fromMs(row.occurred_at),
    reason: row.reason,
    rawEvent: row.raw_event,
    payloadHash: row.payload_hash,
    createdAt: fromMs(row.created_at),
    resolvedAt: row.resolved_at !== null ? fromMs(row.resolved_at) : undefined,
    resolvedProjectId: row.resolved_project_id ?? undefined,
    resolvedTaskId: row.resolved_task_id ?? undefined,
  });
}

export function createUnownedActivityRepository(tx: StorageTransaction): UnownedActivityRepository {
  return {
    insert(activity) {
      assertInTransaction(tx);
      tx.run(
        `INSERT INTO unowned_activity
           (unowned_id, host, host_session_id, occurred_at, reason, raw_event, payload_hash,
            created_at, resolved_at, resolved_project_id, resolved_task_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        activity.unownedId,
        activity.host,
        activity.hostSessionId,
        toMs(activity.occurredAt),
        activity.reason,
        activity.rawEvent,
        activity.payloadHash,
        toMs(activity.createdAt),
        activity.resolvedAt ? toMs(activity.resolvedAt) : null,
        activity.resolvedProjectId ?? null,
        activity.resolvedTaskId ?? null,
      );
    },

    get(unownedId) {
      const row = tx.get<UnownedRow>(
        `SELECT ${UNOWNED_COLUMNS} FROM unowned_activity WHERE unowned_id = ?`,
        unownedId,
      );
      return row ? assembleUnowned(row) : undefined;
    },

    listPending(input) {
      // The queue is not project-scoped: these are exactly the items whose
      // project could not be resolved (docs/30 §10).
      const page = keysetPage<UnownedRow>(tx, {
        table: "unowned_activity",
        columns: UNOWNED_COLUMNS,
        keyColumn: "created_at",
        idColumn: "unowned_id",
        cursor: input.cursor,
        limit: input.limit,
        extraWhere: "resolved_at IS NULL",
      });
      return { items: page.items.map(assembleUnowned), nextCursor: page.nextCursor };
    },

    resolve(unownedId, resolution) {
      assertInTransaction(tx);
      const result = tx.run(
        `UPDATE unowned_activity
         SET resolved_at = ?, resolved_project_id = ?, resolved_task_id = ?
         WHERE unowned_id = ? AND resolved_at IS NULL`,
        Date.now(),
        resolution.projectId,
        resolution.taskId,
        unownedId,
      );
      if (Number(result.changes) === 0) {
        throw new SestinaError(
          SestinaErrorCode.idempotency_violation,
          "Unowned activity is already resolved",
        );
      }
    },
  };
}
