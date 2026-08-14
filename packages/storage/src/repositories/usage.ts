import {
  ProviderUsageSchema,
  type ProviderUsage,
} from "@sestina/schema";
import type { StorageTransaction } from "../transaction.js";
import { validateJson } from "../schema-check.js";
import { assertInTransaction, fromMs, keysetPage, toMs, type CursorInput, type Page } from "./shared.js";

export interface UsageRepository {
  /** Append-only: usage records are never edited (no double-billing). */
  insert(record: ProviderUsage): void;
  listByTask(projectId: string, taskId: string, input: CursorInput): Page<ProviderUsage>;
  sumByTask(projectId: string, taskId: string): { tokensIn: number; tokensOut: number; cost: number };
}

function assemble(row: {
  usage_id: string;
  provider_id: string | null;
  task_id: string | null;
  model: string | null;
  call_at: number;
  tokens_in: number | null;
  tokens_out: number | null;
  cost: number | null;
  data: string;
}): ProviderUsage {
  const data = JSON.parse(row.data) as ProviderUsage;
  return ProviderUsageSchema.parse({
    ...data,
    usageId: row.usage_id,
    providerId: row.provider_id ?? data.providerId,
    taskId: row.task_id ?? undefined,
    model: row.model ?? data.model,
    callAt: fromMs(row.call_at),
    tokensIn: row.tokens_in ?? undefined,
    tokensOut: row.tokens_out ?? undefined,
    cost: row.cost ?? undefined,
  });
}

export function createUsageRepository(tx: StorageTransaction): UsageRepository {
  return {
    insert(record) {
      assertInTransaction(tx);
      tx.run(
        `INSERT INTO provider_usage (usage_id, provider_id, task_id, model, call_at, tokens_in, tokens_out, cost, data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        record.usageId,
        record.providerId,
        record.taskId ?? null,
        record.model,
        toMs(record.callAt),
        record.tokensIn ?? null,
        record.tokensOut ?? null,
        record.cost ?? null,
        validateJson(ProviderUsageSchema, record, "ProviderUsage"),
      );
    },

    listByTask(projectId, taskId, input) {
      // provider_usage has no project column: the project is pinned through
      // the task join (t.project_id = ?), which keysetPage supports via a
      // qualified projectColumn.
      const page = keysetPage<{
        usage_id: string;
        provider_id: string | null;
        task_id: string | null;
        model: string | null;
        call_at: number;
        tokens_in: number | null;
        tokens_out: number | null;
        cost: number | null;
        data: string;
      }>(tx, {
        table: "provider_usage pu JOIN tasks t ON t.task_id = pu.task_id",
        columns: "pu.usage_id, pu.provider_id, pu.task_id, pu.model, pu.call_at, pu.tokens_in, pu.tokens_out, pu.cost, pu.data",
        keyColumn: "pu.call_at",
        idColumn: "pu.usage_id",
        projectColumn: "t.project_id",
        projectId,
        cursor: input.cursor,
        limit: input.limit,
        extraWhere: "pu.task_id = ?",
        extraParams: [taskId],
      });
      return { items: page.items.map(assemble), nextCursor: page.nextCursor };
    },

    sumByTask(projectId, taskId) {
      const row = tx.get<{ tokens_in_sum: number | null; tokens_out_sum: number | null; cost_sum: number | null }>(
        `SELECT SUM(pu.tokens_in) AS tokens_in_sum, SUM(pu.tokens_out) AS tokens_out_sum, SUM(pu.cost) AS cost_sum
         FROM provider_usage pu
         JOIN tasks t ON t.task_id = pu.task_id
         WHERE pu.task_id = ? AND t.project_id = ?`,
        taskId,
        projectId,
      );
      return {
        tokensIn: row?.tokens_in_sum ?? 0,
        tokensOut: row?.tokens_out_sum ?? 0,
        cost: row?.cost_sum ?? 0,
      };
    },
  };
}
