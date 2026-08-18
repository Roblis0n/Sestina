import {
  DeliverableLedgerEntrySchema,
  SestinaError,
  SestinaErrorCode,
  type DeliverableLedgerEntry,
} from "@sestina/schema";
import type { StorageTransaction } from "../transaction.js";
import { validateJson } from "../schema-check.js";
import {
  assertInTransaction,
  assertCursorLimit,
  deriveLedgerHistory,
  fromMs,
  insertLedgerHistory,
  readLedgerHistory,
  toMs,
  type LedgerHistoryRead,
  type LedgerHistoryWrite,
  type CursorInput,
  type Page,
} from "./shared.js";

// ── Deliverable completion ledger (docs/22 Task 10, docs/09 §21) ──
// Synced from the compiled contract, append-only in status history: the
// task_deliverables row holds the current state, deliverable_history holds
// every transition that ever happened.
export interface DeliverableRepository {
  /**
   * Contract-sync upsert: inserts when absent, otherwise applies the entry
   * only under CAS (entry.version must be exactly one above the stored
   * version). Divergent local state fails with stale_state so the caller can
   * reconcile instead of silently overwriting the ledger.
   */
  upsert(
    projectId: string,
    taskId: string,
    entry: DeliverableLedgerEntry,
    history: LedgerHistoryWrite,
  ): void;
  get(
    projectId: string,
    taskId: string,
    deliverableId: string,
  ): DeliverableLedgerEntry | undefined;
  /** Stable deliverable_id ordering; served by idx_task_deliverables_project_task. */
  listByTask(projectId: string, taskId: string): DeliverableLedgerEntry[];
  listPageByTask(
    projectId: string,
    taskId: string,
    input: CursorInput,
  ): Page<DeliverableLedgerEntry>;
  /**
   * CAS status transition (satisfied/waived/failed/...): applies `next` only
   * when the stored row is at expectedVersion, bumps the version and appends
   * one history row.
   */
  transition(
    projectId: string,
    taskId: string,
    deliverableId: string,
    expectedVersion: number,
    next: DeliverableLedgerEntry,
    history: LedgerHistoryWrite,
  ): void;
  history(projectId: string, taskId: string, deliverableId: string): LedgerHistoryRead[];
}

interface DeliverableRow {
  deliverable_id: string;
  project_id: string;
  task_id: string;
  status: string;
  version: number;
  updated_at: number;
  data: string;
}

function assembleDeliverable(row: DeliverableRow): DeliverableLedgerEntry {
  const data = JSON.parse(row.data) as DeliverableLedgerEntry;
  return DeliverableLedgerEntrySchema.parse({
    ...data,
    deliverableId: row.deliverable_id,
    status: row.status,
    version: row.version,
    updatedAt: fromMs(row.updated_at),
  });
}

function encodeDeliverableCursor(deliverableId: string): string {
  return `d1.${Buffer.from(deliverableId, "utf8").toString("base64url")}`;
}

function decodeDeliverableCursor(cursor: string): string {
  if (!cursor.startsWith("d1.")) {
    throw new SestinaError(SestinaErrorCode.validation_failed, "Invalid deliverable cursor");
  }
  const id = Buffer.from(cursor.slice(3), "base64url").toString("utf8");
  if (id.length === 0 || id.length > 64) {
    throw new SestinaError(SestinaErrorCode.validation_failed, "Invalid deliverable cursor");
  }
  return id;
}

export function createDeliverableRepository(tx: StorageTransaction): DeliverableRepository {
  return {
    upsert(projectId, taskId, entry, history) {
      assertInTransaction(tx);
      const task = tx.get<{ project_id: string }>(
        "SELECT project_id FROM tasks WHERE task_id = ?",
        taskId,
      );
      if (task?.project_id !== projectId) {
        throw new SestinaError(SestinaErrorCode.task_not_found, "Task not found in project");
      }
      const existing = tx.get<{ status: string; version: number }>(
        `SELECT status, version FROM task_deliverables
         WHERE deliverable_id = ? AND project_id = ? AND task_id = ?`,
        entry.deliverableId,
        projectId,
        taskId,
      );
      const existingVersion = existing?.version ?? 0;
      if (!existing) {
        if (entry.version !== 1) {
          throw new SestinaError(
            SestinaErrorCode.validation_failed,
            "A new deliverable must start at version 1",
          );
        }
        const ledgerHistory = deriveLedgerHistory(
          history,
          0,
          null,
          entry.status,
          "sync",
        );
        tx.run(
          `INSERT INTO task_deliverables
             (project_id, task_id, deliverable_id, status, version, updated_at, data)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          projectId,
          taskId,
          entry.deliverableId,
          entry.status,
          entry.version,
          toMs(entry.updatedAt),
          validateJson(DeliverableLedgerEntrySchema, entry, "DeliverableLedgerEntry"),
        );
        insertLedgerHistory(
          tx,
          "deliverable_history",
          "deliverable_id",
          projectId,
          entry.deliverableId,
          ledgerHistory,
          taskId,
        );
        return;
      }
      if (entry.version !== existingVersion + 1) {
        throw new SestinaError(
          SestinaErrorCode.stale_state,
          "Deliverable ledger diverged from the contract sync; reconcile before updating",
        );
      }
      const ledgerHistory = deriveLedgerHistory(
        history,
        existingVersion,
        existing.status,
        entry.status,
        entry.active ? "contract_sync" : "contract_remove",
      );
      const result = tx.run(
        `UPDATE task_deliverables SET status = ?, version = ?, updated_at = ?, data = ?
         WHERE deliverable_id = ? AND project_id = ? AND task_id = ? AND version = ?`,
        entry.status,
        entry.version,
        toMs(entry.updatedAt),
        validateJson(DeliverableLedgerEntrySchema, entry, "DeliverableLedgerEntry"),
        entry.deliverableId,
        projectId,
        taskId,
        existingVersion,
      );
      if (Number(result.changes) === 0) {
        throw new SestinaError(
          SestinaErrorCode.stale_state,
          "Deliverable ledger changed concurrently; reload and retry",
        );
      }
      insertLedgerHistory(
        tx,
        "deliverable_history",
        "deliverable_id",
        projectId,
        entry.deliverableId,
        ledgerHistory,
        taskId,
      );
    },

    get(projectId, taskId, deliverableId) {
      const row = tx.get<DeliverableRow>(
        `SELECT deliverable_id, project_id, task_id, status, version, updated_at, data
         FROM task_deliverables
         WHERE deliverable_id = ? AND project_id = ? AND task_id = ?`,
        deliverableId,
        projectId,
        taskId,
      );
      return row ? assembleDeliverable(row) : undefined;
    },

    listByTask(projectId, taskId) {
      const rows = tx.all<DeliverableRow>(
        `SELECT deliverable_id, project_id, task_id, status, version, updated_at, data
         FROM task_deliverables
         WHERE project_id = ? AND task_id = ?
         ORDER BY deliverable_id`,
        projectId,
        taskId,
      );
      return rows.map(assembleDeliverable);
    },

    listPageByTask(projectId, taskId, input) {
      assertCursorLimit(input.limit);
      const after = input.cursor ? decodeDeliverableCursor(input.cursor) : undefined;
      const rows = tx.all<DeliverableRow>(
        `SELECT deliverable_id, project_id, task_id, status, version, updated_at, data
         FROM task_deliverables
         WHERE project_id = ? AND task_id = ?
           AND (? IS NULL OR deliverable_id > ?)
         ORDER BY deliverable_id
         LIMIT ?`,
        projectId,
        taskId,
        after ?? null,
        after ?? null,
        input.limit + 1,
      );
      const hasMore = rows.length > input.limit;
      const items = rows.slice(0, input.limit).map(assembleDeliverable);
      const last = items.at(-1);
      return {
        items,
        nextCursor: hasMore && last ? encodeDeliverableCursor(last.deliverableId) : undefined,
      };
    },

    transition(projectId, taskId, deliverableId, expectedVersion, next, history) {
      assertInTransaction(tx);
      if (next.deliverableId !== deliverableId) {
        throw new SestinaError(
          SestinaErrorCode.validation_failed,
          "Transition target id must match the deliverable id",
        );
      }
      if (next.version !== expectedVersion + 1) {
        throw new SestinaError(
          SestinaErrorCode.validation_failed,
          "next.version must be expectedVersion + 1",
        );
      }
      const existing = tx.get<{ status: string; version: number }>(
        `SELECT status, version FROM task_deliverables
         WHERE deliverable_id = ? AND project_id = ? AND task_id = ?`,
        deliverableId,
        projectId,
        taskId,
      );
      if (!existing) {
        throw new SestinaError(
          SestinaErrorCode.deliverable_not_found,
          "Deliverable not found for this task",
        );
      }
      if (existing.version !== expectedVersion) {
        throw new SestinaError(
          SestinaErrorCode.stale_state,
          "Deliverable was modified concurrently; reload and retry",
        );
      }
      const ledgerHistory = deriveLedgerHistory(
        history,
        expectedVersion,
        existing.status,
        next.status,
        "transition",
      );
      const result = tx.run(
        `UPDATE task_deliverables SET status = ?, version = ?, updated_at = ?, data = ?
         WHERE deliverable_id = ? AND project_id = ? AND task_id = ? AND version = ?`,
        next.status,
        next.version,
        toMs(next.updatedAt),
        validateJson(DeliverableLedgerEntrySchema, next, "DeliverableLedgerEntry"),
        deliverableId,
        projectId,
        taskId,
        expectedVersion,
      );
      if (Number(result.changes) === 0) {
        throw new SestinaError(
          SestinaErrorCode.stale_state,
          "Deliverable was modified concurrently; reload and retry",
        );
      }
      insertLedgerHistory(
        tx,
        "deliverable_history",
        "deliverable_id",
        projectId,
        deliverableId,
        ledgerHistory,
        taskId,
      );
    },

    history(projectId, taskId, deliverableId) {
      return readLedgerHistory(
        tx,
        "deliverable_history",
        "deliverable_id",
        projectId,
        deliverableId,
        taskId,
      );
    },
  };
}
