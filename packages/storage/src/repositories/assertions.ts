import {
  SituationAssertionSchema,
  type SituationAssertion,
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

export interface AssertionRepository {
  /** Insert-only: status evolution writes new rows (supersede, never overwrite). */
  insert(assertion: SituationAssertion): void;
  get(assertionId: string): SituationAssertion | undefined;
  listByProject(projectId: string, input: CursorInput): Page<SituationAssertion>;
  listByTask(taskId: string, input: CursorInput): Page<SituationAssertion>;
}

interface AssertionRow {
  assertion_id: string;
  project_id: string;
  task_id: string | null;
  status: string;
  valid_from: number | null;
  valid_until: number | null;
  data: string;
}

function assembleAssertion(row: AssertionRow): SituationAssertion {
  const data = JSON.parse(row.data) as SituationAssertion;
  return SituationAssertionSchema.parse({
    ...data,
    assertionId: row.assertion_id,
    projectId: row.project_id,
    taskId: row.task_id ?? undefined,
    status: row.status,
    validFrom: row.valid_from !== null ? fromMs(row.valid_from) : data.validFrom,
    validUntil: row.valid_until !== null ? fromMs(row.valid_until) : data.validUntil,
  });
}

const ASSERTION_COLUMNS = `assertion_id, project_id, task_id, status, valid_from, valid_until, data`;

export function createAssertionRepository(tx: StorageTransaction): AssertionRepository {
  return {
    insert(assertion) {
      assertInTransaction(tx);
      tx.run(
        `INSERT INTO situation_assertions
           (assertion_id, project_id, task_id, status, valid_from, valid_until, data)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        assertion.assertionId,
        assertion.projectId,
        assertion.taskId ?? null,
        assertion.status,
        toMs(assertion.validFrom),
        assertion.validUntil ? toMs(assertion.validUntil) : null,
        validateJson(SituationAssertionSchema, assertion, "SituationAssertion"),
      );
    },

    get(assertionId) {
      const row = tx.get<AssertionRow>(
        `SELECT ${ASSERTION_COLUMNS} FROM situation_assertions WHERE assertion_id = ?`,
        assertionId,
      );
      return row ? assembleAssertion(row) : undefined;
    },

    listByProject(projectId, input) {
      assertValidProjectId(projectId);
      assertCursorLimit(input.limit);
      const rows = tx.all<AssertionRow>(
        `SELECT ${ASSERTION_COLUMNS} FROM situation_assertions
         WHERE project_id = ? ORDER BY valid_from, assertion_id LIMIT ?`,
        projectId,
        input.limit,
      );
      return { items: rows.map(assembleAssertion) };
    },

    listByTask(taskId, input) {
      assertCursorLimit(input.limit);
      const rows = tx.all<AssertionRow>(
        `SELECT ${ASSERTION_COLUMNS} FROM situation_assertions
         WHERE task_id = ? ORDER BY valid_from, assertion_id LIMIT ?`,
        taskId,
        input.limit,
      );
      return { items: rows.map(assembleAssertion) };
    },
  };
}
