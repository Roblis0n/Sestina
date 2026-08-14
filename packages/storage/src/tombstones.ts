import { z } from "zod";
import { generateId } from "@sestina/schema";
import type { StorageTransaction } from "./transaction.js";
import { validateJson } from "./schema-check.js";
import { assertInTransaction, assertValidProjectId, keysetPage, type CursorInput, type Page } from "./repositories/shared.js";

/**
 * Irreversible tombstone for cleaned content (docs/22 Task 6): once
 * DecisionTrace or collaboration bodies are removed by retention, only this
 * structural record remains — no reconstructable summary of the content.
 * The repository exposes insert/list only; there is no update or delete.
 */
export const TombstoneSchema = z.object({
  tombstoneId: z.string().min(1).max(64),
  entityKind: z.enum([
    "host_stream_event",
    "decision_trace",
    "collaboration_message",
    "conversation_message",
  ]),
  entityId: z.string().min(1).max(64),
  projectId: z.string(),
  taskId: z.string().optional(),
  timeRangeFrom: z.number().int().nullable().optional(),
  timeRangeTo: z.number().int().nullable().optional(),
  reason: z.enum(["retention_policy", "user_delete", "expired"]),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  /** Structural summary only — never reconstructable content. */
  summary: z.string().max(200).optional(),
  createdAt: z.number().int(),
});
export type Tombstone = z.infer<typeof TombstoneSchema>;

export interface TombstoneRepository {
  insert(record: Tombstone): void;
  get(tombstoneId: string): Tombstone | undefined;
  listByProject(projectId: string, input: CursorInput): Page<Tombstone>;
}

export function createTombstoneRepository(tx: StorageTransaction): TombstoneRepository {
  return {
    insert(record) {
      assertInTransaction(tx);
      tx.run(
        `INSERT INTO retention_tombstones
           (tombstone_id, entity_kind, entity_id, project_id, task_id, time_range_from,
            time_range_to, reason, content_hash, summary, created_at, data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        record.tombstoneId,
        record.entityKind,
        record.entityId,
        record.projectId,
        record.taskId ?? null,
        record.timeRangeFrom ?? null,
        record.timeRangeTo ?? null,
        record.reason,
        record.contentHash,
        record.summary ?? null,
        record.createdAt,
        validateJson(TombstoneSchema, record, "Tombstone"),
      );
    },

    get(tombstoneId) {
      const row = tx.get<{ data: string }>(
        "SELECT data FROM retention_tombstones WHERE tombstone_id = ?",
        tombstoneId,
      );
      return row ? TombstoneSchema.parse(JSON.parse(row.data) as unknown) : undefined;
    },

    listByProject(projectId, input) {
      assertValidProjectId(projectId);
      const page = keysetPage<{ tombstone_id: string; created_at: number; data: string }>(tx, {
        table: "retention_tombstones",
        columns: "tombstone_id, created_at, data",
        keyColumn: "created_at",
        idColumn: "tombstone_id",
        projectColumn: "project_id",
        projectId,
        cursor: input.cursor,
        limit: input.limit,
      });
      return {
        items: page.items.map((r) => TombstoneSchema.parse(JSON.parse(r.data) as unknown)),
        nextCursor: page.nextCursor,
      };
    },
  };
}

export function makeTombstoneId(): string {
  return generateId();
}
