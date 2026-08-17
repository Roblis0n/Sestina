import {
  ReviewItemSchema,
  ReviewActionSchema,
  SestinaErrorCode,
  SestinaError,
  generateId,
  type ReviewItem,
  type ReviewAction,
} from "@sestina/schema";
import type { StorageTransaction } from "../transaction.js";
import { validateJson } from "../schema-check.js";
import {
  assertInTransaction,
  fromMs,
  keysetPage,
  toMs,
  type CursorInput,
  type Page,
} from "./shared.js";

export interface ReviewRepository {
  insertItem(item: ReviewItem): void;
  getItem(projectId: string, reviewId: string): ReviewItem | undefined;
  listByProject(projectId: string, input: CursorInput): Page<ReviewItem>;
  listByTask(projectId: string, taskId: string, input: CursorInput): Page<ReviewItem>;
  /** Actions are append-only (docs/36). */
  appendAction(action: ReviewAction): void;
  listActions(projectId: string, reviewId: string): ReviewAction[];
  /**
   * Project-fenced (docs/22 Task 6): a cross-project review id fails with
   * the same review_not_found as a missing one — no existence leak.
   */
  updateItem(projectId: string, reviewId: string, item: ReviewItem, expectedVersion: number): void;
}

interface ReviewRow {
  review_id: string;
  project_id: string | null;
  task_id: string | null;
  decision_id: string | null;
  status: string;
  created_at: number;
  updated_at: number;
  data: string;
}

function assembleReview(row: ReviewRow): ReviewItem {
  const data = JSON.parse(row.data) as ReviewItem;
  return ReviewItemSchema.parse({
    ...data,
    reviewId: row.review_id,
    projectId: row.project_id ?? data.projectId,
    taskId: row.task_id ?? data.taskId,
    decisionRef: row.decision_id ?? data.decisionRef,
    status: row.status,
    openedAt: fromMs(row.created_at),
    resolvedAt: row.updated_at !== row.created_at ? fromMs(row.updated_at) : data.resolvedAt,
  });
}

export function createReviewRepository(tx: StorageTransaction): ReviewRepository {
  return {
    insertItem(item) {
      assertInTransaction(tx);
      tx.run(
        `INSERT INTO review_items (review_id, project_id, task_id, decision_id, status, created_at, updated_at, data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        item.reviewId,
        item.projectId,
        item.taskId,
        item.decisionRef ?? null,
        item.status,
        toMs(item.openedAt),
        item.resolvedAt ? toMs(item.resolvedAt) : toMs(item.openedAt),
        validateJson(ReviewItemSchema, item, "ReviewItem"),
      );
    },

    getItem(projectId, reviewId) {
      const row = tx.get<ReviewRow>(
        "SELECT review_id, project_id, task_id, decision_id, status, created_at, updated_at, data FROM review_items WHERE review_id = ? AND project_id = ?",
        reviewId,
        projectId,
      );
      return row ? assembleReview(row) : undefined;
    },

    listByProject(projectId, input) {
      const page = keysetPage<ReviewRow>(tx, {
        table: "review_items",
        columns: "review_id, project_id, task_id, decision_id, status, created_at, updated_at, data",
        keyColumn: "created_at",
        idColumn: "review_id",
        projectColumn: "project_id",
        projectId,
        cursor: input.cursor,
        limit: input.limit,
      });
      return { items: page.items.map(assembleReview), nextCursor: page.nextCursor };
    },

    listByTask(projectId, taskId, input) {
      const page = keysetPage<ReviewRow>(tx, {
        table: "review_items",
        columns: "review_id, project_id, task_id, decision_id, status, created_at, updated_at, data",
        keyColumn: "created_at",
        idColumn: "review_id",
        projectColumn: "project_id",
        projectId,
        cursor: input.cursor,
        limit: input.limit,
        extraWhere: "task_id = ?",
        extraParams: [taskId],
      });
      return { items: page.items.map(assembleReview), nextCursor: page.nextCursor };
    },

    appendAction(action) {
      assertInTransaction(tx);
      tx.run(
        "INSERT INTO review_actions (review_action_id, review_id, action, acted_at, data) VALUES (?, ?, ?, ?, ?)",
        generateId(),
        action.reviewId,
        action.action,
        toMs(action.performedAt),
        validateJson(ReviewActionSchema, action, "ReviewAction"),
      );
    },

    listActions(projectId, reviewId) {
      // review_actions has no project column: scope through the review item.
      const rows = tx.all<{ data: string }>(
        `SELECT a.data
         FROM review_actions a
         JOIN review_items ri ON ri.review_id = a.review_id
         WHERE a.review_id = ? AND ri.project_id = ?
         ORDER BY a.acted_at`,
        reviewId,
        projectId,
      );
      return rows.map((r) => ReviewActionSchema.parse(JSON.parse(r.data) as unknown));
    },

    updateItem(projectId, reviewId, item, expectedVersion) {
      assertInTransaction(tx);
      const existing = tx.get<{ data: string; status: string; created_at: number; updated_at: number }>(
        "SELECT data, status, created_at, updated_at FROM review_items WHERE review_id = ? AND project_id = ?",
        reviewId,
        projectId,
      );
      if (!existing) {
        throw new SestinaError(SestinaErrorCode.review_not_found, "Review item not found");
      }
      const existingData = JSON.parse(existing.data) as ReviewItem;
      if (existingData.version !== expectedVersion) {
        throw new SestinaError(SestinaErrorCode.stale_state, "Review item version changed");
      }
      tx.run(
        "UPDATE review_items SET status = ?, updated_at = ?, data = ? WHERE review_id = ? AND project_id = ?",
        item.status,
        item.resolvedAt ? toMs(item.resolvedAt) : existing.updated_at,
        validateJson(ReviewItemSchema, item, "ReviewItem"),
        reviewId,
        projectId,
      );
    },
  };
}
