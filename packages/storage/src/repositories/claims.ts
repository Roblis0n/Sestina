import {
  ClaimSchema,
  SestinaError,
  SestinaErrorCode,
  type Claim,
} from "@sestina/schema";
import type { StorageTransaction } from "../transaction.js";
import { validateJson } from "../schema-check.js";
import {
  assertInTransaction,
  assertCursorLimit,
  deriveLedgerHistory,
  fromMs,
  insertLedgerHistory,
  keysetPage,
  readLedgerHistory,
  toMs,
  type CursorInput,
  type LedgerHistoryRead,
  type LedgerHistoryWrite,
  type Page,
} from "./shared.js";

export interface ClaimRepository {
  /**
   * Insert with a task-in-project fence: the claim's task must exist in the
   * given project. Missing and cross-project tasks fail with the same stable
   * task_not_found error.
   */
  insert(projectId: string, claim: Claim): void;
  get(projectId: string, claimId: string): Claim | undefined;
  listByTask(projectId: string, taskId: string, input: CursorInput): Page<Claim>;
  listByIds(projectId: string, claimIds: readonly string[]): Claim[];
  /**
   * Open critical claims for completion loading: importance=critical and a
   * status that has not settled the claim (anything but supported /
   * not_applicable). Served by idx_claims_task_importance.
   */
  listOpenCritical(projectId: string, taskId: string, limit: number): Claim[];
  /**
   * CAS status recompute: applies `next` only when the stored row is at
   * expectedVersion, bumps the version and appends one history row.
   */
  transition(
    projectId: string,
    claimId: string,
    expectedVersion: number,
    next: Claim,
    history: LedgerHistoryWrite,
  ): void;
  history(projectId: string, claimId: string): LedgerHistoryRead[];
}

interface ClaimRow {
  claim_id: string;
  project_id: string;
  task_id: string | null;
  type: string;
  status: string;
  confidence: number | null;
  text: string;
  importance: string;
  version: number;
  created_at: number;
  data: string;
}

function assembleClaim(row: ClaimRow): Claim {
  const data = JSON.parse(row.data) as Claim;
  return ClaimSchema.parse({
    ...data,
    claimId: row.claim_id,
    taskId: row.task_id ?? data.taskId,
    type: row.type,
    status: row.status,
    confidence: row.confidence ?? data.confidence,
    text: row.text,
    importance: row.importance as Claim["importance"],
    version: row.version,
    createdAt: fromMs(row.created_at),
  });
}

const CLAIM_COLUMNS = `claim_id, project_id, task_id, type, status, confidence, text, importance, version, created_at, data`;
const POINT_LOOKUP_CHUNK = 200;

export function createClaimRepository(tx: StorageTransaction): ClaimRepository {
  return {
    insert(projectId, claim) {
      assertInTransaction(tx);
      if (claim.version !== 1) {
        throw new SestinaError(
          SestinaErrorCode.validation_failed,
          "A new claim must start at version 1",
        );
      }
      const task = tx.get<{ project_id: string }>(
        "SELECT project_id FROM tasks WHERE task_id = ?",
        claim.taskId,
      );
      if (task?.project_id !== projectId) {
        throw new SestinaError(SestinaErrorCode.task_not_found, "Task not found in project");
      }
      tx.run(
        `INSERT INTO claims
           (claim_id, project_id, task_id, type, status, confidence, text, importance,
            version, created_at, data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        claim.claimId,
        projectId,
        claim.taskId,
        claim.type,
        claim.status,
        claim.confidence,
        claim.text,
        claim.importance,
        claim.version,
        toMs(claim.createdAt),
        validateJson(ClaimSchema, claim, "Claim"),
      );
    },

    get(projectId, claimId) {
      const row = tx.get<ClaimRow>(
        `SELECT ${CLAIM_COLUMNS} FROM claims WHERE claim_id = ? AND project_id = ?`,
        claimId,
        projectId,
      );
      return row ? assembleClaim(row) : undefined;
    },

    listByTask(projectId, taskId, input) {
      const page = keysetPage<ClaimRow>(tx, {
        table: "claims",
        columns: CLAIM_COLUMNS,
        keyColumn: "created_at",
        idColumn: "claim_id",
        projectColumn: "project_id",
        projectId,
        cursor: input.cursor,
        limit: input.limit,
        extraWhere: "task_id = ?",
        extraParams: [taskId],
      });
      return { items: page.items.map(assembleClaim), nextCursor: page.nextCursor };
    },

    listByIds(projectId, claimIds) {
      if (claimIds.length === 0) {
        return [];
      }
      const ids = [...new Set(claimIds)];
      const found = new Map<string, Claim>();
      for (let start = 0; start < ids.length; start += POINT_LOOKUP_CHUNK) {
        const chunk = ids.slice(start, start + POINT_LOOKUP_CHUNK);
        const bindMarkers = chunk.map(() => "?").join(", ");
        const rows = tx.all<ClaimRow>(
          `SELECT ${CLAIM_COLUMNS} FROM claims
           WHERE project_id = ? AND claim_id IN (${bindMarkers})`,
          projectId,
          ...chunk,
        );
        for (const row of rows) {
          const claim = assembleClaim(row);
          found.set(claim.claimId, claim);
        }
      }
      return ids.flatMap((id) => {
        const claim = found.get(id);
        return claim ? [claim] : [];
      });
    },

    listOpenCritical(projectId, taskId, limit) {
      assertCursorLimit(limit);
      const rows = tx.all<ClaimRow>(
        `SELECT ${CLAIM_COLUMNS} FROM claims
         WHERE project_id = ? AND task_id = ? AND importance = 'critical'
           AND status NOT IN ('supported', 'not_applicable')
         ORDER BY created_at, claim_id
         LIMIT ?`,
        projectId,
        taskId,
        limit,
      );
      return rows.map(assembleClaim);
    },

    transition(projectId, claimId, expectedVersion, next, history) {
      assertInTransaction(tx);
      if (next.claimId !== claimId) {
        throw new SestinaError(
          SestinaErrorCode.validation_failed,
          "Transition target id must match the claim id",
        );
      }
      if (next.version !== expectedVersion + 1) {
        throw new SestinaError(
          SestinaErrorCode.validation_failed,
          "next.version must be expectedVersion + 1",
        );
      }
      const existing = tx.get<{ status: string; version: number; task_id: string | null }>(
        "SELECT status, version, task_id FROM claims WHERE claim_id = ? AND project_id = ?",
        claimId,
        projectId,
      );
      if (!existing) {
        throw new SestinaError(SestinaErrorCode.claim_not_found, "Claim not found");
      }
      if (existing.version !== expectedVersion) {
        throw new SestinaError(
          SestinaErrorCode.stale_state,
          "Claim was modified concurrently; reload and retry",
        );
      }
      if (existing.task_id === null || next.taskId !== existing.task_id) {
        throw new SestinaError(
          SestinaErrorCode.validation_failed,
          "A claim transition cannot move the claim to another task",
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
        `UPDATE claims SET
           type = ?, status = ?, confidence = ?, text = ?, importance = ?, version = ?, data = ?
         WHERE claim_id = ? AND project_id = ? AND version = ?`,
        next.type,
        next.status,
        next.confidence,
        next.text,
        next.importance,
        next.version,
        validateJson(ClaimSchema, next, "Claim"),
        claimId,
        projectId,
        expectedVersion,
      );
      if (Number(result.changes) !== 1) {
        throw new SestinaError(
          SestinaErrorCode.stale_state,
          "Claim changed concurrently; reload and retry",
        );
      }
      insertLedgerHistory(
        tx,
        "claim_history",
        "claim_id",
        projectId,
        claimId,
        ledgerHistory,
      );
    },

    history(projectId, claimId) {
      return readLedgerHistory(tx, "claim_history", "claim_id", projectId, claimId);
    },
  };
}
