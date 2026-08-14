import {
  EvidenceItemSchema,
  SestinaErrorCode,
  SestinaError,
  type EvidenceItem,
  type EvidenceStatus,
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

export interface EvidenceRepository {
  /** The sensitive excerpt lives in its own column so retention can clear it. */
  insert(item: EvidenceItem): void;
  get(projectId: string, evidenceId: string): EvidenceItem | undefined;
  listByProject(projectId: string, input: CursorInput): Page<EvidenceItem>;
  /**
   * Project-fenced (docs/22 Task 6): a cross-project evidence id fails with
   * the same evidence_not_found as a missing one — no existence leak.
   */
  updateStatus(projectId: string, evidenceId: string, status: EvidenceStatus): void;
  /** Idempotent claim→evidence link (composite primary key). */
  linkClaim(claimId: string, evidenceId: string): void;
}

interface EvidenceRow {
  evidence_id: string;
  project_id: string;
  task_id: string | null;
  type: string;
  status: string;
  excerpt: string | null;
  content_hash: string;
  recorded_by: string;
  observed_at: number;
  expires_at: number | null;
  data: string;
}

function assembleEvidence(row: EvidenceRow): EvidenceItem {
  const data = JSON.parse(row.data) as EvidenceItem;
  return EvidenceItemSchema.parse({
    ...data,
    evidenceId: row.evidence_id,
    taskId: row.task_id ?? data.taskId,
    type: row.type,
    excerpt: row.excerpt ?? undefined,
    contentHash: row.content_hash || undefined,
    status: row.status,
    recordedBy: row.recorded_by,
    observedAt: fromMs(row.observed_at),
    expiresAt: row.expires_at !== null ? fromMs(row.expires_at) : undefined,
  });
}

const EVIDENCE_COLUMNS = `evidence_id, project_id, task_id, type, status, excerpt, content_hash, recorded_by, observed_at, expires_at, data`;

export function createEvidenceRepository(tx: StorageTransaction): EvidenceRepository {
  return {
    insert(item) {
      assertInTransaction(tx);
      // EvidenceItem carries no projectId: the project comes from its task.
      const task = tx.get<{ project_id: string }>(
        "SELECT project_id FROM tasks WHERE task_id = ?",
        item.taskId,
      );
      if (!task) {
        throw new SestinaError(SestinaErrorCode.task_not_found, "Task not found");
      }
      tx.run(
        `INSERT INTO evidence_items
           (evidence_id, project_id, task_id, type, status, excerpt, content_hash,
            recorded_by, observed_at, expires_at, data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        item.evidenceId,
        task.project_id,
        item.taskId,
        item.type,
        item.status,
        item.excerpt ?? null,
        item.contentHash ?? "",
        item.recordedBy,
        item.observedAt ? toMs(item.observedAt) : Date.now(),
        item.expiresAt ? toMs(item.expiresAt) : null,
        validateJson(EvidenceItemSchema, item, "EvidenceItem"),
      );
    },

    get(projectId, evidenceId) {
      const row = tx.get<EvidenceRow>(
        `SELECT ${EVIDENCE_COLUMNS} FROM evidence_items WHERE evidence_id = ? AND project_id = ?`,
        evidenceId,
        projectId,
      );
      return row ? assembleEvidence(row) : undefined;
    },

    listByProject(projectId, input) {
      const page = keysetPage<EvidenceRow>(tx, {
        table: "evidence_items",
        columns: EVIDENCE_COLUMNS,
        keyColumn: "observed_at",
        idColumn: "evidence_id",
        projectColumn: "project_id",
        projectId,
        cursor: input.cursor,
        limit: input.limit,
      });
      return { items: page.items.map(assembleEvidence), nextCursor: page.nextCursor };
    },

    updateStatus(projectId, evidenceId, status) {
      assertInTransaction(tx);
      const result = tx.run(
        "UPDATE evidence_items SET status = ? WHERE evidence_id = ? AND project_id = ?",
        status,
        evidenceId,
        projectId,
      );
      if (Number(result.changes) === 0) {
        throw new SestinaError(SestinaErrorCode.evidence_not_found, "Evidence item not found");
      }
    },

    linkClaim(claimId, evidenceId) {
      assertInTransaction(tx);
      const claimProject = tx.get<{ project_id: string }>(
        "SELECT project_id FROM claims WHERE claim_id = ?",
        claimId,
      );
      const evidenceProject = tx.get<{ project_id: string }>(
        "SELECT project_id FROM evidence_items WHERE evidence_id = ?",
        evidenceId,
      );
      if (!claimProject || !evidenceProject) {
        throw new SestinaError(SestinaErrorCode.internal_error, "Claim or evidence item not found");
      }
      if (claimProject.project_id !== evidenceProject.project_id) {
        throw new SestinaError(
          SestinaErrorCode.project_isolation_violation,
          "Claim and evidence belong to different projects",
        );
      }
      tx.run(
        "INSERT INTO claim_evidence (claim_id, evidence_id) VALUES (?, ?) ON CONFLICT(claim_id, evidence_id) DO NOTHING",
        claimId,
        evidenceId,
      );
    },
  };
}
