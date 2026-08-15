import {
  CorrectionSchema,
  SestinaErrorCode,
  SestinaError,
  type Correction,
} from "@sestina/schema";
import type { StorageTransaction } from "../transaction.js";
import { validateJson } from "../schema-check.js";
import { assertInTransaction, fromMs, toMs } from "./shared.js";

/**
 * Project-fenced correction history (docs/33 §7, docs/22 Task 9). History
 * is append-only by structure: `markSuperseded` may only link a newer
 * record onto an older one (the older row's data JSON is never rewritten)
 * and `incrementRecurrence` is the only other allowed mutation (a monotonic
 * counter, mirrored into both the column and the data JSON). There is
 * deliberately no generic rewrite method.
 */
export interface CorrectionRepository {
  /**
   * Inserts one correction. The owning project is the caller-declared fence
   * project: it must exist, and the correction's task, when present, must
   * belong to it (a foreign task fails with the same task_not_found as a
   * missing one — no existence leak).
   */
  insert(projectId: string, correction: Correction): void;
  /** A correction owned by another project behaves exactly like a missing one. */
  get(projectId: string, correctionId: string): Correction | undefined;
  /** Ordered by data.createdAt ascending, then correctionId. */
  listByTask(projectId: string, taskId: string): Correction[];
  /** Ordered by data.createdAt ascending, then correctionId. */
  listByProject(projectId: string): Correction[];
  /**
   * Append-only supersession: updates ONLY the target row's superseded_by
   * column. Missing and foreign-project ids fail with the same code.
   */
  markSuperseded(projectId: string, correctionId: string, supersededById: string): void;
  /**
   * Monotonic recurrence counter: updates the recurrence_count column and
   * the recurrenceCount field inside the data JSON; every other field of
   * the data JSON is preserved. A newCount that does not increase the
   * current value is rejected.
   */
  incrementRecurrence(projectId: string, correctionId: string, newCount: number): void;
}

interface CorrectionRow {
  correction_id: string;
  project_id: string | null;
  task_id: string | null;
  scope: string;
  severity: string;
  confirmed: number;
  recurrence_count: number;
  expires_at: number | null;
  superseded_by: string | null;
  data: string;
}

function assembleCorrection(row: CorrectionRow): Correction {
  const data = JSON.parse(row.data) as Correction;
  return CorrectionSchema.parse({
    ...data,
    correctionId: row.correction_id,
    projectId: row.project_id ?? data.projectId,
    taskId: row.task_id ?? data.taskId,
    scope: row.scope,
    severity: row.severity,
    confirmed: row.confirmed === 1,
    recurrenceCount: row.recurrence_count,
    ...(row.expires_at != null ? { expiresWhen: fromMs(row.expires_at) } : {}),
    ...(row.superseded_by != null ? { supersededBy: row.superseded_by } : {}),
  });
}

/** Deterministic order: data.createdAt ascending, then correctionId. */
function byCreatedAtThenId(a: Correction, b: Correction): number {
  if (a.createdAt < b.createdAt) return -1;
  if (a.createdAt > b.createdAt) return 1;
  if (a.correctionId < b.correctionId) return -1;
  if (a.correctionId > b.correctionId) return 1;
  return 0;
}

const COLUMNS =
  "correction_id, project_id, task_id, scope, severity, confirmed, recurrence_count, expires_at, superseded_by, data";

export function createCorrectionRepository(tx: StorageTransaction): CorrectionRepository {
  return {
    insert(projectId, correction) {
      assertInTransaction(tx);
      const data = validateJson(CorrectionSchema, correction, "Correction");
      // Fence before writing: the owning project must exist.
      const project = tx.get<{ project_id: string }>(
        "SELECT project_id FROM projects WHERE project_id = ?",
        projectId,
      );
      if (!project) {
        throw new SestinaError(SestinaErrorCode.project_not_found, "Project not found");
      }
      // ...and the correction's task, when present, must belong to it.
      if (correction.taskId !== undefined) {
        const task = tx.get<{ task_id: string }>(
          "SELECT task_id FROM tasks WHERE task_id = ? AND project_id = ?",
          correction.taskId,
          projectId,
        );
        if (!task) {
          throw new SestinaError(SestinaErrorCode.task_not_found, "Task not found");
        }
      }
      tx.run(
        `INSERT INTO corrections
           (correction_id, project_id, task_id, scope, severity, confirmed,
            recurrence_count, expires_at, superseded_by, data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        correction.correctionId,
        projectId,
        correction.taskId ?? null,
        correction.scope,
        correction.severity,
        correction.confirmed ? 1 : 0,
        correction.recurrenceCount,
        correction.expiresWhen !== undefined ? toMs(correction.expiresWhen) : null,
        correction.supersededBy ?? null,
        data,
      );
    },

    get(projectId, correctionId) {
      const row = tx.get<CorrectionRow>(
        `SELECT ${COLUMNS} FROM corrections WHERE correction_id = ? AND project_id = ?`,
        correctionId,
        projectId,
      );
      return row ? assembleCorrection(row) : undefined;
    },

    listByTask(projectId, taskId) {
      // The task must belong to this project; otherwise the list is empty,
      // exactly like a task that has no corrections at all.
      const task = tx.get<{ task_id: string }>(
        "SELECT task_id FROM tasks WHERE task_id = ? AND project_id = ?",
        taskId,
        projectId,
      );
      if (!task) return [];
      const rows = tx.all<CorrectionRow>(
        `SELECT ${COLUMNS} FROM corrections WHERE project_id = ? AND task_id = ?`,
        projectId,
        taskId,
      );
      return rows.map(assembleCorrection).sort(byCreatedAtThenId);
    },

    listByProject(projectId) {
      const rows = tx.all<CorrectionRow>(
        `SELECT ${COLUMNS} FROM corrections WHERE project_id = ?`,
        projectId,
      );
      return rows.map(assembleCorrection).sort(byCreatedAtThenId);
    },

    markSuperseded(projectId, correctionId, supersededById) {
      assertInTransaction(tx);
      // Same face for a missing row and a foreign-project row (no existence leak).
      const row = tx.get<{ correction_id: string }>(
        "SELECT correction_id FROM corrections WHERE correction_id = ? AND project_id = ?",
        correctionId,
        projectId,
      );
      if (!row) {
        throw new SestinaError(SestinaErrorCode.contract_not_found, "Correction not found");
      }
      tx.run(
        "UPDATE corrections SET superseded_by = ? WHERE correction_id = ? AND project_id = ?",
        supersededById,
        correctionId,
        projectId,
      );
    },

    incrementRecurrence(projectId, correctionId, newCount) {
      assertInTransaction(tx);
      const row = tx.get<{ recurrence_count: number; data: string }>(
        "SELECT recurrence_count, data FROM corrections WHERE correction_id = ? AND project_id = ?",
        correctionId,
        projectId,
      );
      if (!row) {
        throw new SestinaError(SestinaErrorCode.contract_not_found, "Correction not found");
      }
      if (!Number.isInteger(newCount) || newCount <= row.recurrence_count) {
        throw new SestinaError(
          SestinaErrorCode.validation_failed,
          "recurrenceCount must be a larger integer",
        );
      }
      const data = CorrectionSchema.parse(JSON.parse(row.data) as unknown);
      tx.run(
        "UPDATE corrections SET recurrence_count = ?, data = ? WHERE correction_id = ? AND project_id = ?",
        newCount,
        validateJson(CorrectionSchema, { ...data, recurrenceCount: newCount }, "Correction"),
        correctionId,
        projectId,
      );
    },
  };
}
