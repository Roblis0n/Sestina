import {
  ProviderUsageSchema,
  type ProviderUsage,
} from "@sestina/schema";
import type { StorageTransaction } from "../transaction.js";
import { validateJson } from "../schema-check.js";
import { assertCursorLimit, assertInTransaction, fromMs, toMs, type CursorInput, type Page } from "./shared.js";

export interface UsageRepository {
  /** Append-only: usage records are never edited (no double-billing). */
  insert(record: ProviderUsage): void;
  listByTask(taskId: string, input: CursorInput): Page<ProviderUsage>;
  sumByTask(taskId: string): { tokensIn: number; tokensOut: number; cost: number };
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

const USAGE_COLUMNS = `usage_id, provider_id, task_id, model, call_at, tokens_in, tokens_out, cost, data`;

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

    listByTask(taskId, input) {
      assertCursorLimit(input.limit);
      const rows = tx.all<{
        usage_id: string;
        provider_id: string | null;
        task_id: string | null;
        model: string | null;
        call_at: number;
        tokens_in: number | null;
        tokens_out: number | null;
        cost: number | null;
        data: string;
      }>(
        `SELECT ${USAGE_COLUMNS} FROM provider_usage WHERE task_id = ? ORDER BY call_at, usage_id LIMIT ?`,
        taskId,
        input.limit,
      );
      return { items: rows.map(assemble) };
    },

    sumByTask(taskId) {
      const row = tx.get<{ tokens_in_sum: number | null; tokens_out_sum: number | null; cost_sum: number | null }>(
        "SELECT SUM(tokens_in) AS tokens_in_sum, SUM(tokens_out) AS tokens_out_sum, SUM(cost) AS cost_sum FROM provider_usage WHERE task_id = ?",
        taskId,
      );
      return {
        tokensIn: row?.tokens_in_sum ?? 0,
        tokensOut: row?.tokens_out_sum ?? 0,
        cost: row?.cost_sum ?? 0,
      };
    },
  };
}
