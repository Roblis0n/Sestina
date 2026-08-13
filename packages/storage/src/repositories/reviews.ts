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
  assertCursorLimit,
  assertInTransaction,
  assertValidProjectId,
  fromMs,
  toMs,
  type CursorInput,
  type Page,
} from "./shared.js";

export interface ReviewRepository {
  insertItem(item: ReviewItem): void;
  getItem(reviewId: string): ReviewItem | undefined;
  listByProject(projectId: string, input: CursorInput): Page<ReviewItem>;
  /** Actions are append-only (docs/36). */
  appendAction(action: ReviewAction): void;
  listActions(reviewId: string): ReviewAction[];
  updateItem(reviewId: string, item: ReviewItem, expectedVersion: number): void;
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

    getItem(reviewId) {
      const row = tx.get<ReviewRow>(
        "SELECT review_id, project_id, task_id, decision_id, status, created_at, updated_at, data FROM review_items WHERE review_id = ?",
        reviewId,
      );
      return row ? assembleReview(row) : undefined;
    },

    listByProject(projectId, input) {
      assertValidProjectId(projectId);
      assertCursorLimit(input.limit);
      const rows = tx.all<ReviewRow>(
        "SELECT review_id, project_id, task_id, decision_id, status, created_at, updated_at, data FROM review_items WHERE project_id = ? ORDER BY created_at, review_id LIMIT ?",
        projectId,
        input.limit,
      );
      return { items: rows.map(assembleReview) };
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

    listActions(reviewId) {
      const rows = tx.all<{ data: string }>(
        "SELECT data FROM review_actions WHERE review_id = ? ORDER BY acted_at",
        reviewId,
      );
      return rows.map((r) => ReviewActionSchema.parse(JSON.parse(r.data) as unknown));
    },

    updateItem(reviewId, item, expectedVersion) {
      assertInTransaction(tx);
      const existing = tx.get<{ data: string; status: string; created_at: number; updated_at: number }>(
        "SELECT data, status, created_at, updated_at FROM review_items WHERE review_id = ?",
        reviewId,
      );
      if (!existing) {
        throw new SestinaError(SestinaErrorCode.internal_error, "Review item not found");
      }
      const existingData = JSON.parse(existing.data) as ReviewItem;
      if (existingData.version !== expectedVersion) {
        throw new SestinaError(SestinaErrorCode.stale_state, "Review item version changed");
      }
      tx.run(
        "UPDATE review_items SET status = ?, updated_at = ?, data = ? WHERE review_id = ?",
        item.status,
        item.resolvedAt ? toMs(item.resolvedAt) : existing.updated_at,
        validateJson(ReviewItemSchema, item, "ReviewItem"),
        reviewId,
      );
    },
  };
}
