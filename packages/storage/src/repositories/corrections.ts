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
 * is append-only by structure: supersession is a link written on the NEW
 * record at insert time (the older row is never rewritten), and
 * `incrementRecurrence` is the only other allowed mutation (a monotonic
 * counter, mirrored into both the column and the data JSON). There is
 * deliberately no generic rewrite method.
 */
export interface CorrectionRepository {
  /**
   * Inserts one correction. The owning project is the caller-declared fence
   * project: it must exist, and the correction's task, when present, must
   * belong to it (a foreign task fails with the same task_not_found as a
   * missing one — no existence leak).
   *
   * A `supersededBy` link on the inserted record is validated as it lands:
   * the target must exist in the same project (missing or foreign fail with
   * the same contract_not_found), its createdAt must be strictly older than
   * the new record's, and it must not already be superseded. The link is
   * written on this NEW row only — the target row is never updated.
   */
  insert(projectId: string, correction: Correction): void;
  /** A correction owned by another project behaves exactly like a missing one. */
  get(projectId: string, correctionId: string): Correction | undefined;
  /** Ordered by data.createdAt ascending, then correctionId. */
  listByTask(projectId: string, taskId: string): Correction[];
  /** Ordered by data.createdAt ascending, then correctionId. */
  listByProject(projectId: string): Correction[];
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

/**
 * Deterministic order: createdAt as a PARSED INSTANT ascending (never a
 * lexical string compare - "...:00.500Z" sorts lexically before "...:00Z"
 * because "." < "Z", and mixed fractional precision would invert the order),
 * then correctionId. An unparseable instant (impossible for schema-valid
 * rows, defended anyway) falls through to the id tie-break.
 */
function byCreatedAtThenId(a: Correction, b: Correction): number {
  const aMs = toMs(a.createdAt);
  const bMs = toMs(b.createdAt);
  if (aMs < bMs) return -1;
  if (aMs > bMs) return 1;
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
      // ...and the correction's task, when present, must belong to it (a
      // foreign task fails with the same task_not_found as a missing one, no
      // matter what projectId the record itself claims — no existence leak).
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
      // The record's own projectId must agree with the fence project, or the
      // stored row would have a project_id column of one project and a data
      // JSON claiming another.
      if (correction.projectId !== projectId) {
        throw new SestinaError(
          SestinaErrorCode.validation_failed,
          "correction projectId does not match the fence project",
        );
      }
      // A supersededBy link is validated as it lands (append-only direction:
      // new→old, written on THIS row, never as a rewrite of the older one).
      if (correction.supersededBy !== undefined) {
        const target = tx.get<{ data: string }>(
          "SELECT data FROM corrections WHERE correction_id = ? AND project_id = ?",
          correction.supersededBy,
          projectId,
        );
        if (!target) {
          throw new SestinaError(SestinaErrorCode.contract_not_found, "Correction not found");
        }
        // At most one record may supersede a given target; the existing link
        // lives on the OTHER record, so look it up in reverse.
        const alreadySuperseded = tx.get<{ one: number }>(
          "SELECT 1 AS one FROM corrections WHERE superseded_by = ? AND project_id = ?",
          correction.supersededBy,
          projectId,
        );
        if (alreadySuperseded !== undefined) {
          throw new SestinaError(
            SestinaErrorCode.validation_failed,
            "supersededBy target is already superseded",
          );
        }
        const targetCorrection = CorrectionSchema.parse(JSON.parse(target.data) as unknown);
        // Strictly older as a PARSED INSTANT (fail closed when either side
        // is unparseable): a lexical compare would misorder mixed fractional
        // precision ("...:00.500Z" sorts before "...:00Z").
        const targetMs = toMs(targetCorrection.createdAt);
        const newMs = toMs(correction.createdAt);
        if (!Number.isFinite(targetMs) || !Number.isFinite(newMs) || !(targetMs < newMs)) {
          throw new SestinaError(
            SestinaErrorCode.validation_failed,
            "supersededBy must point at a strictly older correction",
          );
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
