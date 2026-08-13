import { createHash } from "node:crypto";
import { SestinaError, SestinaErrorCode } from "@sestina/schema";
import type { StorageDatabase } from "./connection.js";
import { withTransaction } from "./transaction.js";
import { MaintenanceFence } from "./maintenance-fence.js";
import { createTombstoneRepository, makeTombstoneId } from "./tombstones.js";

export interface RetentionConfig {
  captureRetentionDays: number;
  privacyRetentionDays: number;
  collaborationMessageRetentionDays: number;
  /** Test clock; defaults to Date.now(). */
  nowMs?: number;
}

export interface RetentionTarget {
  /** Stable object identifier. */
  object: string;
  table: string;
  /** Columns cleared to NULL when deleteRows is false. */
  columns: readonly string[];
  deleteRows: boolean;
  timeRange: { from: number | null; to: number };
  estimatedCount: number;
}

export interface RetentionPreview {
  previewHash: string;
  createdAt: number;
  targets: readonly RetentionTarget[];
  totalEstimated: number;
}

export interface RetentionResult {
  appliedTargets: number;
  tombstoneCount: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Fixes the retention targets (objects, tables, time ranges, estimated
 * counts) and hashes them into a preview (docs/22 Task 6). The snapshot
 * pins the target SET; row membership is decided by the time range at
 * apply time.
 */
export function previewRetention(db: StorageDatabase, config: RetentionConfig): RetentionPreview {
  const now = config.nowMs ?? Date.now();
  validateRetentionConfig(config);

  const targets: RetentionTarget[] = [];
  const captureCutoff = now - config.captureRetentionDays * DAY_MS;
  const privacyCutoff = now - config.privacyRetentionDays * DAY_MS;
  const collabCutoff = now - config.collaborationMessageRetentionDays * DAY_MS;

  targets.push({
    object: "host_stream_events",
    table: "host_stream_events",
    columns: [],
    deleteRows: true,
    timeRange: { from: null, to: captureCutoff },
    estimatedCount: count(db, "SELECT COUNT(*) AS c FROM host_stream_events hse JOIN host_sessions s ON s.session_id = hse.session_id WHERE s.started_at <= ?", captureCutoff),
  });

  targets.push({
    object: "conversation_bodies",
    table: "conversation_messages",
    columns: ["body"],
    deleteRows: false,
    timeRange: { from: null, to: privacyCutoff },
    estimatedCount: count(db, "SELECT COUNT(*) AS c FROM conversation_messages WHERE body IS NOT NULL AND created_at <= ?", privacyCutoff),
  });

  targets.push({
    object: "collaboration_bodies",
    table: "collaboration_messages",
    columns: ["summary", "body"],
    deleteRows: false,
    timeRange: { from: null, to: collabCutoff },
    estimatedCount: count(db, "SELECT COUNT(*) AS c FROM collaboration_messages WHERE (summary <> '' OR body IS NOT NULL) AND created_at <= ?", collabCutoff),
  });

  targets.push({
    object: "decision_traces",
    table: "decision_traces",
    columns: [],
    deleteRows: true,
    timeRange: { from: null, to: privacyCutoff },
    estimatedCount: count(db, "SELECT COUNT(*) AS c FROM decision_traces WHERE created_at <= ?", privacyCutoff),
  });

  targets.push({
    object: "expired_evidence_excerpts",
    table: "evidence_items",
    columns: ["excerpt"],
    deleteRows: false,
    timeRange: { from: null, to: now },
    estimatedCount: count(db, "SELECT COUNT(*) AS c FROM evidence_items WHERE excerpt IS NOT NULL AND expires_at IS NOT NULL AND expires_at <= ?", now),
  });

  const createdAt = now;
  return {
    previewHash: hashTargets(targets, createdAt),
    createdAt,
    targets,
    totalEstimated: targets.reduce((sum, t) => sum + t.estimatedCount, 0),
  };
}

/**
 * Applies a retention preview under the common maintenance fence
 * (docs/17 §3.2): the snapshot hash is re-verified, then bodies, FTS
 * entries (via the 002 triggers) and export metadata are cleaned inside
 * one write transaction. DecisionTrace and collaboration content leave
 * irreversible tombstones only.
 */
export async function applyRetentionPreview(
  db: StorageDatabase,
  input: { preview: RetentionPreview; dataRoot: string },
): Promise<RetentionResult> {
  const { preview } = input;
  const recomputed = hashTargets(preview.targets, preview.createdAt);
  if (recomputed !== preview.previewHash) {
    throw new SestinaError(SestinaErrorCode.preview_changed, "Retention preview changed since it was created");
  }

  const fence = await MaintenanceFence.acquire({ dataRoot: input.dataRoot, scope: "retention" });
  try {
    return await withTransaction(db, (tx) => {
      const tombstones = createTombstoneRepository(tx);
      let tombstoneCount = 0;
      const now = Date.now();

      for (const target of preview.targets) {
        switch (target.object) {
          case "host_stream_events": {
            const rows = tx.all<{ stream_event_id: string; session_id: string; project_id: string; content: string }>(
              `SELECT hse.stream_event_id, hse.session_id, s.project_id, hse.data AS content
               FROM host_stream_events hse
               JOIN host_sessions s ON s.session_id = hse.session_id
               WHERE s.started_at <= ?`,
              target.timeRange.to,
            );
            for (const row of rows) {
              const hash = sha256(row.content);
              tombstones.insert({
                tombstoneId: makeTombstoneId(),
                entityKind: "host_stream_event",
                entityId: row.stream_event_id,
                projectId: row.project_id,
                timeRangeFrom: null,
                timeRangeTo: target.timeRange.to,
                reason: "retention_policy",
                contentHash: hash,
                summary: "host stream event removed by retention",
                createdAt: now,
              });
              tombstoneCount += 1;
              tx.run("DELETE FROM host_stream_events WHERE stream_event_id = ?", row.stream_event_id);
            }
            break;
          }
          case "conversation_bodies": {
            const rows = tx.all<{ message_id: string; project_id: string; content: string }>(
              `SELECT m.message_id, c.project_id, coalesce(m.body, '') AS content
               FROM conversation_messages m
               JOIN conversations c ON c.conversation_id = m.conversation_id
               WHERE m.body IS NOT NULL AND m.created_at <= ?`,
              target.timeRange.to,
            );
            for (const row of rows) {
              const hash = sha256(row.content);
              tombstones.insert({
                tombstoneId: makeTombstoneId(),
                entityKind: "conversation_message",
                entityId: row.message_id,
                projectId: row.project_id,
                timeRangeFrom: null,
                timeRangeTo: target.timeRange.to,
                reason: "retention_policy",
                contentHash: hash,
                summary: "conversation message body removed by retention",
                createdAt: now,
              });
              tombstoneCount += 1;
              tx.run(
                "UPDATE conversation_messages SET body = NULL, data = json_remove(data, '$.body') WHERE message_id = ?",
                row.message_id,
              );
            }
            break;
          }
          case "collaboration_bodies": {
            const rows = tx.all<{ message_id: string; project_id: string; content: string }>(
              `SELECT message_id, project_id, coalesce(summary, '') || '|' || coalesce(body, '') AS content
               FROM collaboration_messages
               WHERE (summary <> '' OR body IS NOT NULL) AND created_at <= ?`,
              target.timeRange.to,
            );
            for (const row of rows) {
              const hash = sha256(row.content);
              tombstones.insert({
                tombstoneId: makeTombstoneId(),
                entityKind: "collaboration_message",
                entityId: row.message_id,
                projectId: row.project_id,
                timeRangeFrom: null,
                timeRangeTo: target.timeRange.to,
                reason: "retention_policy",
                contentHash: hash,
                summary: "collaboration message body removed by retention",
                createdAt: now,
              });
              tombstoneCount += 1;
              tx.run(
                "UPDATE collaboration_messages SET summary = '', body = NULL, data = json_remove(json_remove(data, '$.summary'), '$.body') WHERE message_id = ?",
                row.message_id,
              );
            }
            break;
          }
          case "decision_traces": {
            const rows = tx.all<{ trace_id: string; decision_id: string; project_id: string; content: string }>(
              `SELECT t.trace_id, t.decision_id, d.project_id, t.data AS content
               FROM decision_traces t
               JOIN decisions d ON d.decision_id = t.decision_id
               WHERE t.created_at <= ?`,
              target.timeRange.to,
            );
            for (const row of rows) {
              const hash = sha256(row.content);
              tombstones.insert({
                tombstoneId: makeTombstoneId(),
                entityKind: "decision_trace",
                entityId: row.trace_id,
                projectId: row.project_id,
                timeRangeFrom: null,
                timeRangeTo: target.timeRange.to,
                reason: "retention_policy",
                contentHash: hash,
                // Structural only — nothing of the trace content survives.
                summary: "decision trace removed by retention",
                createdAt: now,
              });
              tombstoneCount += 1;
              tx.run("DELETE FROM decision_trace_stages WHERE trace_id = ?", row.trace_id);
              tx.run("DELETE FROM decision_traces WHERE trace_id = ?", row.trace_id);
            }
            break;
          }
          case "expired_evidence_excerpts": {
            const changed = tx.run(
              "UPDATE evidence_items SET excerpt = NULL, data = json_remove(data, '$.excerpt') WHERE excerpt IS NOT NULL AND expires_at IS NOT NULL AND expires_at <= ?",
              target.timeRange.to,
            );
            tombstoneCount += Number(changed.changes);
            break;
          }
        }
      }

      // Expired export metadata moves to purged (docs/17 §12).
      tx.run(
        "UPDATE export_metadata SET status = 'purged' WHERE expires_at IS NOT NULL AND expires_at <= ? AND status != 'purged'",
        now,
      );

      return { appliedTargets: preview.targets.length, tombstoneCount };
    });
  } finally {
    fence.release();
  }
}

function hashTargets(targets: readonly RetentionTarget[], createdAt: number): string {
  const canonical = JSON.stringify({
    createdAt,
    targets: targets.map((t) => ({
      object: t.object,
      table: t.table,
      columns: [...t.columns],
      deleteRows: t.deleteRows,
      timeRange: t.timeRange,
    })),
  });
  return sha256(canonical);
}

export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function count(db: StorageDatabase, sql: string, ...params: unknown[]): number {
  const row = db.get<{ c: number | bigint }>(sql, ...params);
  return Number(row?.c ?? 0);
}

function validateRetentionConfig(config: RetentionConfig): void {
  for (const [name, value] of [
    ["captureRetentionDays", config.captureRetentionDays],
    ["privacyRetentionDays", config.privacyRetentionDays],
    ["collaborationMessageRetentionDays", config.collaborationMessageRetentionDays],
  ] as const) {
    if (!Number.isInteger(value) || value < 1 || value > 3650) {
      throw new SestinaError(SestinaErrorCode.validation_failed, `${name} must be an integer between 1 and 3650`);
    }
  }
}
