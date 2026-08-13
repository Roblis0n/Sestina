import {
  DecisionSchema,
  SestinaErrorCode,
  SestinaError,
  type Decision,
  type DecisionTrace,
} from "@sestina/schema";
import type { StorageTransaction } from "../transaction.js";
import { validateJson } from "../schema-check.js";
import { completeEventLease, type EventLease } from "../lease.js";
import { createDecisionTraceRepository } from "./traces.js";
import {
  assertCursorLimit,
  assertInTransaction,
  assertValidProjectId,
  fromMs,
  toMs,
  type CursorInput,
  type Page,
} from "./shared.js";

export interface DecisionRepository {
  /**
   * Persists the final decision for a leased event, completes the lease,
   * and optionally writes the trace — all in the same transaction.
   * Decisions are append-only: revisions are new decisions.
   */
  complete(
    input: { lease: EventLease; decision: Decision; trace?: DecisionTrace },
  ): void;
  get(decisionId: string): Decision | undefined;
  listByProject(projectId: string, input: CursorInput): Page<Decision>;
  listByTask(taskId: string, input: CursorInput): Page<Decision>;
}

interface DecisionRow {
  decision_id: string;
  event_id: string;
  project_id: string;
  task_id: string;
  category: string;
  created_at: number;
  data: string;
}

function assembleDecision(row: DecisionRow): Decision {
  const data = JSON.parse(row.data) as Decision;
  return DecisionSchema.parse({
    ...data,
    decisionId: row.decision_id,
    eventId: row.event_id,
    taskId: row.task_id,
    category: row.category,
    createdAt: fromMs(row.created_at),
  });
}

const DECISION_COLUMNS = `decision_id, event_id, project_id, task_id, category, created_at, data`;

export function createDecisionRepository(tx: StorageTransaction): DecisionRepository {
  return {
    complete(input) {
      assertInTransaction(tx);
      const event = tx.get<{ project_id: string; task_id: string }>(
        "SELECT project_id, task_id FROM events WHERE idempotency_key = ?",
        input.lease.idempotencyKey,
      );
      if (!event) {
        throw new SestinaError(SestinaErrorCode.internal_error, "Leased event row is missing");
      }
      tx.run(
        `INSERT INTO decisions (decision_id, event_id, project_id, task_id, category, created_at, data)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        input.decision.decisionId,
        input.decision.eventId,
        event.project_id,
        event.task_id,
        input.decision.category,
        toMs(input.decision.createdAt),
        validateJson(DecisionSchema, input.decision, "Decision"),
      );
      completeEventLease(tx, {
        idempotencyKey: input.lease.idempotencyKey,
        ownerId: input.lease.ownerId,
      });
      if (input.trace) {
        createDecisionTraceRepository(tx).insert(input.trace);
      }
    },

    get(decisionId) {
      const row = tx.get<DecisionRow>(
        `SELECT ${DECISION_COLUMNS} FROM decisions WHERE decision_id = ?`,
        decisionId,
      );
      return row ? assembleDecision(row) : undefined;
    },

    listByProject(projectId, input) {
      assertValidProjectId(projectId);
      assertCursorLimit(input.limit);
      const rows = tx.all<DecisionRow>(
        `SELECT ${DECISION_COLUMNS} FROM decisions WHERE project_id = ? ORDER BY created_at, decision_id LIMIT ?`,
        projectId,
        input.limit,
      );
      return { items: rows.map(assembleDecision) };
    },

    listByTask(taskId, input) {
      assertCursorLimit(input.limit);
      const rows = tx.all<DecisionRow>(
        `SELECT ${DECISION_COLUMNS} FROM decisions WHERE task_id = ? ORDER BY created_at, decision_id LIMIT ?`,
        taskId,
        input.limit,
      );
      return { items: rows.map(assembleDecision) };
    },
  };
}
