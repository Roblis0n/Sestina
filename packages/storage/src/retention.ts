import { createHash } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { z } from "zod";
import { generateId, isSestinaError, SestinaError, SestinaErrorCode } from "@sestina/schema";
import type { StorageDatabase } from "./connection.js";
import { withTransaction, type StorageTransaction } from "./transaction.js";
import { MaintenanceGuard, maintenanceRootOf, mapFsError } from "./maintenance-domain.js";
import { createTombstoneRepository, makeTombstoneId } from "./tombstones.js";
import { validateJson } from "./schema-check.js";
import {
  assertExportPathContained,
  readValidatedExportManifest,
} from "./export-manifest.js";

export interface RetentionConfig {
  captureRetentionDays: number;
  privacyRetentionDays: number;
  collaborationMessageRetentionDays: number;
  /** Test clock; defaults to Date.now(). */
  nowMs?: number;
}

/**
 * Member summary of a retention target: the full id list while it is
 * small (<= 5000 members), otherwise a count plus a sha256 digest of the
 * sorted ids. The summary participates in the preview hash, so any
 * membership change between preview and apply is detected.
 */
export type RetentionMembers =
  | { kind: "ids"; ids: string[] }
  | { kind: "digest"; count: number; digest: string };

export interface RetentionTarget {
  /** Stable object identifier. */
  object: string;
  table: string;
  /** Columns cleared to NULL when deleteRows is false. */
  columns: readonly string[];
  deleteRows: boolean;
  timeRange: { from: number | null; to: number };
  estimatedCount: number;
  members: RetentionMembers;
}

export interface RetentionPreview {
  previewId: string;
  previewHash: string;
  createdAt: number;
  targets: readonly RetentionTarget[];
  totalEstimated: number;
}

export interface RetentionResult {
  appliedTargets: number;
  tombstoneCount: number;
}

export interface RetentionApplyOptions {
  /** The persisted preview to apply (read back from the database). */
  previewId: string;
  /** Database path the maintenance fence and data root derive from. */
  databasePath: string;
  busyTimeoutMs?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Members above this limit are stored as { count, digest } only. */
const MEMBER_INLINE_LIMIT = 5000;

// ── Per-target member selectors (ids are recomputed at apply time) ──
interface TargetSelect {
  table: string;
  columns: string[];
  deleteRows: boolean;
  /** Returns one id per row for the cutoff parameter (`timeRange.to`). */
  idsSql: string;
}

const TARGET_SELECTS: Record<string, TargetSelect> = {
  host_stream_events: {
    table: "host_stream_events",
    columns: [],
    deleteRows: true,
    idsSql: "SELECT stream_event_id AS id FROM host_stream_events WHERE occurred_at <= ?",
  },
  conversation_bodies: {
    table: "conversation_messages",
    columns: ["body"],
    deleteRows: false,
    idsSql: "SELECT message_id AS id FROM conversation_messages WHERE body IS NOT NULL AND created_at <= ?",
  },
  collaboration_bodies: {
    table: "collaboration_messages",
    columns: ["summary", "body"],
    deleteRows: false,
    idsSql: "SELECT message_id AS id FROM collaboration_messages WHERE (summary <> '' OR body IS NOT NULL) AND created_at <= ?",
  },
  decision_traces: {
    table: "decision_traces",
    columns: [],
    deleteRows: true,
    idsSql: "SELECT trace_id AS id FROM decision_traces WHERE created_at <= ?",
  },
  expired_evidence_excerpts: {
    table: "evidence_items",
    columns: ["excerpt"],
    deleteRows: false,
    idsSql: "SELECT evidence_id AS id FROM evidence_items WHERE excerpt IS NOT NULL AND expires_at IS NOT NULL AND expires_at <= ?",
  },
  expired_exports: {
    table: "export_metadata",
    columns: [],
    deleteRows: true,
    idsSql: "SELECT export_id AS id FROM export_metadata WHERE expires_at IS NOT NULL AND expires_at <= ? AND status != 'purged'",
  },
};

// Fixed target order (the preview hash and the target list depend on it).
const TARGET_ORDER: readonly string[] = [
  "host_stream_events",
  "conversation_bodies",
  "collaboration_bodies",
  "decision_traces",
  "expired_evidence_excerpts",
  "expired_exports",
];

// ── JSON column schemas (docs/09 §21: JSON enters via schema) ──
const RetentionConfigJsonSchema = z.object({
  captureRetentionDays: z.number().int().min(1).max(3650),
  privacyRetentionDays: z.number().int().min(1).max(3650),
  collaborationMessageRetentionDays: z.number().int().min(1).max(3650),
});

const RetentionMemberIdsSchema = z.object({
  kind: z.literal("ids"),
  ids: z.array(z.string()),
});

const RetentionMemberDigestSchema = z.object({
  kind: z.literal("digest"),
  count: z.number().int().nonnegative(),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
});

const RetentionTargetJsonSchema = z.object({
  object: z.string(),
  table: z.string(),
  columns: z.array(z.string()),
  deleteRows: z.boolean(),
  timeRange: z.object({
    from: z.number().int().nullable(),
    to: z.number().int(),
  }),
  estimatedCount: z.number().int().nonnegative(),
  members: z.discriminatedUnion("kind", [
    RetentionMemberIdsSchema,
    RetentionMemberDigestSchema,
  ]),
});

const RetentionTargetsJsonSchema = z.array(RetentionTargetJsonSchema);

const RetentionPreviewDataSchema = z.object({ nowMs: z.number().int() });

const RetentionAppliedDataSchema = z.object({});

/**
 * Fixes the retention targets (objects, tables, time ranges, estimated
 * counts AND per-target member summaries) and hashes them into a preview
 * that is persisted to retention_previews (docs/22 Task 6 fix). The
 * snapshot pins the target membership; apply re-derives the members from
 * the summaries and refuses with preview_changed on any divergence.
 */
export function previewRetention(db: StorageDatabase, config: RetentionConfig): RetentionPreview {
  const now = config.nowMs ?? Date.now();
  validateRetentionConfig(config);

  const cutoffOf: Record<string, number> = {
    host_stream_events: now - config.captureRetentionDays * DAY_MS,
    conversation_bodies: now - config.privacyRetentionDays * DAY_MS,
    collaboration_bodies: now - config.collaborationMessageRetentionDays * DAY_MS,
    decision_traces: now - config.privacyRetentionDays * DAY_MS,
    expired_evidence_excerpts: now,
    expired_exports: now,
  };

  const targets: RetentionTarget[] = TARGET_ORDER.map((object) => {
    const select = selectFor(object);
    const cutoff = cutoffOf[object] ?? now;
    const ids = fetchSortedIds(db, select.idsSql, cutoff);
    const members: RetentionMembers = ids.length <= MEMBER_INLINE_LIMIT
      ? { kind: "ids", ids }
      : { kind: "digest", count: ids.length, digest: sha256(JSON.stringify(ids)) };
    return {
      object,
      table: select.table,
      columns: select.columns,
      deleteRows: select.deleteRows,
      timeRange: { from: null, to: cutoff },
      estimatedCount: ids.length,
      members,
    };
  });

  const totalEstimated = targets.reduce((sum, t) => sum + t.estimatedCount, 0);
  const previewHash = hashPreview(now, targets, totalEstimated);
  const previewId = generateId();

  withTransaction(db, (tx) => {
    tx.run(
      `INSERT INTO retention_previews
         (preview_id, preview_hash, created_at, config_json, targets_json, total_estimated, data)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      previewId,
      previewHash,
      now,
      validateJson(
        RetentionConfigJsonSchema,
        {
          captureRetentionDays: config.captureRetentionDays,
          privacyRetentionDays: config.privacyRetentionDays,
          collaborationMessageRetentionDays: config.collaborationMessageRetentionDays,
        },
        "Retention config",
      ),
      validateJson(RetentionTargetsJsonSchema, targets, "Retention targets"),
      totalEstimated,
      validateJson(RetentionPreviewDataSchema, { nowMs: now }, "Retention preview data"),
    );
  });

  return {
    previewId,
    previewHash,
    createdAt: now,
    targets,
    totalEstimated,
  };
}

/**
 * Applies a persisted retention preview (docs/22 Task 6 fix). The preview
 * is read back from retention_previews — a caller-supplied in-memory
 * object is never trusted — and its hash is recomputed. The whole apply
 * runs under the maintenance fence (scope retention) in ONE write
 * transaction; per-target member summaries are recomputed and compared,
 * any divergence raises preview_changed, and (preview_id, target_object)
 * pairs already recorded in retention_applied are skipped, so replaying a
 * preview is zero operations.
 *
 * Export directories are deleted AFTER the transaction commits (file IO
 * never happens inside a write transaction): a rollback can therefore
 * never lose user files.
 */
export async function applyRetentionPreview(
  db: StorageDatabase,
  options: RetentionApplyOptions,
): Promise<RetentionResult> {
  const preview = readPersistedPreview(db, options.previewId);

  const guard = await MaintenanceGuard.acquire({
    databasePath: options.databasePath,
    scope: "retention",
    ownerId: "retention",
    busyTimeoutMs: options.busyTimeoutMs,
  });
  db.maintenanceOwned = true;
  try {
    const exportDeletions: { exportId: string; dir: string }[] = [];
    const result = withTransaction(db, (tx) => {
      const tombstones = createTombstoneRepository(tx);
      let tombstoneCount = 0;
      let appliedTargets = 0;
      const now = Date.now();

      for (const target of preview.targets) {
        if (isTargetApplied(tx, preview.previewId, target.object)) continue;

        // Membership is re-derived from the stored summary: any change —
        // added, removed or moved rows — invalidates the snapshot.
        const recomputed = fetchSortedIds(tx, selectFor(target.object).idsSql, target.timeRange.to);
        assertMembersMatch(target.members, recomputed);

        let targetTombstones = 0;
        switch (target.object) {
          case "host_stream_events": {
            for (const id of recomputed) {
              const row = tx.get<{ stream_event_id: string; project_id: string; content: string }>(
                `SELECT hse.stream_event_id, s.project_id, hse.data AS content
                 FROM host_stream_events hse
                 JOIN host_sessions s ON s.session_id = hse.session_id
                 WHERE hse.stream_event_id = ?`,
                id,
              );
              if (!row) continue;
              tombstones.insert({
                tombstoneId: makeTombstoneId(),
                entityKind: "host_stream_event",
                entityId: row.stream_event_id,
                projectId: row.project_id,
                timeRangeFrom: null,
                timeRangeTo: target.timeRange.to,
                reason: "retention_policy",
                contentHash: sha256(row.content),
                summary: "host stream event removed by retention",
                createdAt: now,
              });
              targetTombstones += 1;
              tx.run("DELETE FROM host_stream_events WHERE stream_event_id = ?", id);
            }
            break;
          }
          case "conversation_bodies": {
            for (const id of recomputed) {
              const row = tx.get<{ message_id: string; project_id: string; content: string }>(
                `SELECT m.message_id, c.project_id, coalesce(m.body, '') AS content
                 FROM conversation_messages m
                 JOIN conversations c ON c.conversation_id = m.conversation_id
                 WHERE m.message_id = ?`,
                id,
              );
              if (!row) continue;
              tombstones.insert({
                tombstoneId: makeTombstoneId(),
                entityKind: "conversation_message",
                entityId: row.message_id,
                projectId: row.project_id,
                timeRangeFrom: null,
                timeRangeTo: target.timeRange.to,
                reason: "retention_policy",
                contentHash: sha256(row.content),
                summary: "conversation message body removed by retention",
                createdAt: now,
              });
              targetTombstones += 1;
              tx.run(
                "UPDATE conversation_messages SET body = NULL, data = json_remove(data, '$.body') WHERE message_id = ?",
                id,
              );
            }
            break;
          }
          case "collaboration_bodies": {
            for (const id of recomputed) {
              const row = tx.get<{ message_id: string; project_id: string; content: string }>(
                `SELECT message_id, project_id, coalesce(summary, '') || '|' || coalesce(body, '') AS content
                 FROM collaboration_messages
                 WHERE message_id = ?`,
                id,
              );
              if (!row) continue;
              tombstones.insert({
                tombstoneId: makeTombstoneId(),
                entityKind: "collaboration_message",
                entityId: row.message_id,
                projectId: row.project_id,
                timeRangeFrom: null,
                timeRangeTo: target.timeRange.to,
                reason: "retention_policy",
                contentHash: sha256(row.content),
                summary: "collaboration message body removed by retention",
                createdAt: now,
              });
              targetTombstones += 1;
              tx.run(
                "UPDATE collaboration_messages SET summary = '', body = NULL, data = json_remove(json_remove(data, '$.summary'), '$.body') WHERE message_id = ?",
                id,
              );
            }
            break;
          }
          case "decision_traces": {
            for (const id of recomputed) {
              const row = tx.get<{ trace_id: string; decision_id: string; project_id: string; content: string }>(
                `SELECT t.trace_id, t.decision_id, d.project_id, t.data AS content
                 FROM decision_traces t
                 JOIN decisions d ON d.decision_id = t.decision_id
                 WHERE t.trace_id = ?`,
                id,
              );
              if (!row) continue;
              tombstones.insert({
                tombstoneId: makeTombstoneId(),
                entityKind: "decision_trace",
                entityId: row.trace_id,
                projectId: row.project_id,
                timeRangeFrom: null,
                timeRangeTo: target.timeRange.to,
                reason: "retention_policy",
                contentHash: sha256(row.content),
                // Structural only — nothing of the trace content survives.
                summary: "decision trace removed by retention",
                createdAt: now,
              });
              targetTombstones += 1;
              tx.run("DELETE FROM decision_trace_stages WHERE trace_id = ?", id);
              tx.run("DELETE FROM decision_traces WHERE trace_id = ?", id);
            }
            break;
          }
          case "expired_evidence_excerpts": {
            for (const id of recomputed) {
              const row = tx.get<{ evidence_id: string; project_id: string; excerpt: string | null }>(
                `SELECT evidence_id, project_id, excerpt
                 FROM evidence_items
                 WHERE evidence_id = ? AND excerpt IS NOT NULL`,
                id,
              );
              if (!row) continue;
              // Tombstone FIRST, with the irreversible hash of the excerpt -
              // the same discipline as every other target: the excerpt is
              // sensitive content and its removal must leave an auditable,
              // non-reconstructable record (docs/22 Task 10).
              tombstones.insert({
                tombstoneId: makeTombstoneId(),
                entityKind: "evidence_excerpt",
                entityId: row.evidence_id,
                projectId: row.project_id,
                timeRangeFrom: null,
                timeRangeTo: target.timeRange.to,
                reason: "expired",
                contentHash: sha256(row.excerpt ?? ""),
                summary: "evidence excerpt removed by retention",
                createdAt: now,
              });
              targetTombstones += 1;
              const changed = tx.run(
                "UPDATE evidence_items SET excerpt = NULL, data = json_remove(data, '$.excerpt') WHERE evidence_id = ?",
                id,
              );
              if (Number(changed.changes) === 0) targetTombstones -= 1;
            }
            break;
          }
          case "expired_exports": {
            for (const exportId of recomputed) {
              const row = tx.get<{ export_id: string; output_path: string }>(
                `SELECT export_id, output_path FROM export_metadata
                 WHERE export_id = ? AND expires_at IS NOT NULL AND expires_at <= ? AND status != 'purged'`,
                exportId,
                target.timeRange.to,
              );
              if (!row) continue;
              const decision = planExportPurge(options.databasePath, exportId, row.output_path);
              if (decision.action === "skip") continue; // fail-safe: user files stay
              if (decision.action === "delete") exportDeletions.push({ exportId, dir: decision.dir });
              tx.run("UPDATE export_metadata SET status = 'purged' WHERE export_id = ?", exportId);
            }
            break;
          }
        }

        tx.run(
          `INSERT INTO retention_applied
             (applied_id, preview_id, target_object, applied_at, row_count, tombstone_count, data)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          generateId(),
          preview.previewId,
          target.object,
          now,
          recomputed.length,
          targetTombstones,
          validateJson(RetentionAppliedDataSchema, {}, "Retention applied data"),
        );
        tombstoneCount += targetTombstones;
        appliedTargets += 1;
      }

      return { appliedTargets, tombstoneCount };
    });

    // Deletions run after COMMIT so a rollback never loses files.
    for (const deletion of exportDeletions) {
      deleteValidatedExportDir(options.databasePath, deletion.exportId, deletion.dir);
    }
    return result;
  } finally {
    db.maintenanceOwned = false;
    guard.release();
  }
}

// ── Preview persistence and hashing ──

function readPersistedPreview(db: StorageDatabase, previewId: string): RetentionPreview {
  const row = db.get<{
    preview_id: string;
    preview_hash: string;
    created_at: number;
    targets_json: string;
    total_estimated: number;
  }>(
    `SELECT preview_id, preview_hash, created_at, targets_json, total_estimated
     FROM retention_previews WHERE preview_id = ?`,
    previewId,
  );
  if (!row) {
    throw new SestinaError(
      SestinaErrorCode.validation_failed,
      "Retention preview not found",
    );
  }
  let targets: RetentionTarget[];
  try {
    targets = RetentionTargetsJsonSchema.parse(JSON.parse(row.targets_json) as unknown);
  } catch {
    throw new SestinaError(
      SestinaErrorCode.preview_changed,
      "Retention preview changed since it was created",
    );
  }
  const recomputed = hashPreview(row.created_at, targets, row.total_estimated);
  if (recomputed !== row.preview_hash) {
    throw new SestinaError(
      SestinaErrorCode.preview_changed,
      "Retention preview changed since it was created",
    );
  }
  return {
    previewId: row.preview_id,
    previewHash: row.preview_hash,
    createdAt: row.created_at,
    targets,
    totalEstimated: row.total_estimated,
  };
}

/**
 * The preview hash covers createdAt + targets (tables, columns, time
 * ranges AND member summaries) + totalEstimated.
 */
function hashPreview(createdAt: number, targets: readonly RetentionTarget[], totalEstimated: number): string {
  const canonical = JSON.stringify({
    createdAt,
    targets: targets.map((t) => ({
      object: t.object,
      table: t.table,
      columns: [...t.columns],
      deleteRows: t.deleteRows,
      timeRange: t.timeRange,
      members: t.members,
    })),
    totalEstimated,
  });
  return sha256(canonical);
}

// ── Member summaries ──

function fetchSortedIds(source: Pick<StorageDatabase, "all">, sql: string, cutoff: number): string[] {
  const rows = source.all<{ id: string }>(sql, cutoff);
  return rows.map((r) => r.id).sort();
}

function assertMembersMatch(stored: RetentionMembers, recomputed: string[]): void {
  const changed = (): never => {
    throw new SestinaError(
      SestinaErrorCode.preview_changed,
      "Retention preview changed since it was created",
    );
  };
  if (stored.kind === "ids") {
    if (stored.ids.length !== recomputed.length) changed();
    for (let i = 0; i < recomputed.length; i++) {
      if (stored.ids[i] !== recomputed[i]) changed();
    }
    return;
  }
  if (stored.count !== recomputed.length || sha256(JSON.stringify(recomputed)) !== stored.digest) {
    changed();
  }
}

// ── Expired export purge (fail-safe: never delete user files) ──

type ExportPurgeDecision =
  | { action: "delete"; dir: string }
  | { action: "mark" }   // directory already gone — nothing to delete
  | { action: "skip" };  // validation failed — leave the row alone

function planExportPurge(databasePath: string, exportId: string, outputPath: string): ExportPurgeDecision {
  const root = maintenanceRootOf(databasePath);
  let dir: string;
  try {
    dir = assertExportPathContained(exportId, root, outputPath);
  } catch (err) {
    if (isSestinaError(err) && err.code === SestinaErrorCode.validation_failed) return { action: "skip" };
    throw err;
  }
  if (!existsSync(dir)) return { action: "mark" };
  try {
    readValidatedExportManifest(exportId, dir);
  } catch (err) {
    if (isSestinaError(err) && err.code === SestinaErrorCode.validation_failed) return { action: "skip" };
    throw err;
  }
  return { action: "delete", dir };
}

/**
 * Deletes a validated export directory, re-verifying containment right
 * before the delete so a swapped parent cannot escape the data root.
 */
function deleteValidatedExportDir(databasePath: string, exportId: string, dir: string): void {
  const root = maintenanceRootOf(databasePath);
  const verified = assertExportPathContained(exportId, root, dir);
  try {
    rmSync(verified, { recursive: true, force: true });
  } catch (err) {
    throw mapFsError(err, "Failed to delete the export directory");
  }
}

function selectFor(object: string): TargetSelect {
  const select = TARGET_SELECTS[object];
  if (!select) {
    throw new SestinaError(SestinaErrorCode.internal_error, "Unknown retention target");
  }
  return select;
}

// ── Shared helpers ──

export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function isTargetApplied(tx: StorageTransaction, previewId: string, targetObject: string): boolean {
  return tx.get<{ applied_id: string }>(
    "SELECT applied_id FROM retention_applied WHERE preview_id = ? AND target_object = ?",
    previewId,
    targetObject,
  ) !== undefined;
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
