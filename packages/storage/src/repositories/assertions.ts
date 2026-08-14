import {
  SituationAssertionSchema,
  type SituationAssertion,
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

export interface AssertionRepository {
  /** Insert-only: status evolution writes new rows (supersede, never overwrite). */
  insert(assertion: SituationAssertion): void;
  get(projectId: string, assertionId: string): SituationAssertion | undefined;
  listByProject(projectId: string, input: CursorInput): Page<SituationAssertion>;
  listByTask(projectId: string, taskId: string, input: CursorInput): Page<SituationAssertion>;
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

    get(projectId, assertionId) {
      const row = tx.get<AssertionRow>(
        `SELECT ${ASSERTION_COLUMNS} FROM situation_assertions WHERE assertion_id = ? AND project_id = ?`,
        assertionId,
        projectId,
      );
      return row ? assembleAssertion(row) : undefined;
    },

    listByProject(projectId, input) {
      const page = keysetPage<AssertionRow>(tx, {
        table: "situation_assertions",
        columns: ASSERTION_COLUMNS,
        keyColumn: "valid_from",
        idColumn: "assertion_id",
        projectColumn: "project_id",
        projectId,
        cursor: input.cursor,
        limit: input.limit,
      });
      return { items: page.items.map(assembleAssertion), nextCursor: page.nextCursor };
    },

    listByTask(projectId, taskId, input) {
      const page = keysetPage<AssertionRow>(tx, {
        table: "situation_assertions",
        columns: ASSERTION_COLUMNS,
        keyColumn: "valid_from",
        idColumn: "assertion_id",
        projectColumn: "project_id",
        projectId,
        cursor: input.cursor,
        limit: input.limit,
        extraWhere: "task_id = ?",
        extraParams: [taskId],
      });
      return { items: page.items.map(assembleAssertion), nextCursor: page.nextCursor };
    },
  };
}
