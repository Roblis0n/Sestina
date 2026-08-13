import {
  DecisionTraceSchema,
  DecisionTraceStageSchema,
  generateId,
  type DecisionTrace,
} from "@sestina/schema";
import type { StorageTransaction } from "../transaction.js";
import { validateJson } from "../schema-check.js";
import { assertInTransaction, toMs } from "./shared.js";

export interface DecisionTraceRepository {
  /** Writes the trace and its stages in one transaction; append-only. */
  insert(trace: DecisionTrace): void;
  get(traceId: string): DecisionTrace | undefined;
  listByDecision(decisionId: string): DecisionTrace[];
}

export function createDecisionTraceRepository(tx: StorageTransaction): DecisionTraceRepository {
  return {
    insert(trace) {
      assertInTransaction(tx);
      const createdAt = toMs(
        trace.stages[0]?.startedAt ?? new Date().toISOString(),
      );
      tx.run(
        "INSERT INTO decision_traces (trace_id, decision_id, contract_version_id, created_at, data) VALUES (?, ?, NULL, ?, ?)",
        trace.traceId,
        trace.decisionId,
        createdAt,
        validateJson(DecisionTraceSchema, trace, "DecisionTrace"),
      );
      trace.stages.forEach((stage, index) => {
        tx.run(
          `INSERT INTO decision_trace_stages
             (stage_id, trace_id, stage, sequence, started_at, finished_at, data)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          generateId(),
          trace.traceId,
          stage.stage,
          index + 1,
          toMs(stage.startedAt),
          stage.completedAt ? toMs(stage.completedAt) : null,
          validateJson(DecisionTraceStageSchema, stage, "DecisionTraceStage"),
        );
      });
    },

    get(traceId) {
      const row = tx.get<{ decision_id: string; created_at: number; data: string }>(
        "SELECT decision_id, created_at, data FROM decision_traces WHERE trace_id = ?",
        traceId,
      );
      if (!row) return undefined;
      const stages = tx.all<{ data: string }>(
        "SELECT data FROM decision_trace_stages WHERE trace_id = ? ORDER BY sequence",
        traceId,
      );
      const data = JSON.parse(row.data) as DecisionTrace;
      return DecisionTraceSchema.parse({
        ...data,
        traceId,
        decisionId: row.decision_id,
        stages: stages.map((s) =>
          DecisionTraceStageSchema.parse(JSON.parse(s.data) as unknown),
        ),
      });
    },

    listByDecision(decisionId) {
      const rows = tx.all<{ trace_id: string }>(
        "SELECT trace_id FROM decision_traces WHERE decision_id = ? ORDER BY created_at",
        decisionId,
      );
      return rows
        .map((r) => this.get(r.trace_id))
        .filter((t): t is DecisionTrace => t !== undefined);
    },
  };
}
