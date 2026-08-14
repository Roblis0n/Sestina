import {
  SessionAttachmentSchema,
  SestinaErrorCode,
  SestinaError,
  type SessionAttachment,
} from "@sestina/schema";
import type { StorageTransaction } from "../transaction.js";
import { assertInTransaction, assertValidProjectId, fromMs, toMs } from "./shared.js";

/**
 * Append-only attach/detach history (docs/30 §5): every attach writes a
 * row, the row with detachedAt unset is the current attachment (enforced by
 * the partial unique index from migration 009), and the session's task_id
 * column mirrors the current row.
 */
export interface SessionAttachmentRepository {
  insert(attachment: SessionAttachment): void;
  current(projectId: string, sessionId: string): SessionAttachment | undefined;
  listBySession(projectId: string, sessionId: string): SessionAttachment[];
  /**
   * Detaches the active attachment. Fenced on the attachment row's own
   * project: a session that has no active attachment (or one in another
   * project) fails with session_not_found — no existence leak.
   */
  detach(projectId: string, sessionId: string, detachedAt: string, reason?: string): void;
}

interface AttachmentRow {
  attachment_id: string;
  session_id: string;
  project_id: string;
  task_id: string;
  attached_at: number;
  detached_at: number | null;
  reason: string | null;
}

const ATTACHMENT_COLUMNS = `attachment_id, session_id, project_id, task_id, attached_at, detached_at, reason`;

function assembleAttachment(row: AttachmentRow): SessionAttachment {
  return SessionAttachmentSchema.parse({
    attachmentId: row.attachment_id,
    sessionId: row.session_id,
    projectId: row.project_id,
    taskId: row.task_id,
    attachedAt: fromMs(row.attached_at),
    detachedAt: row.detached_at !== null ? fromMs(row.detached_at) : undefined,
    reason: row.reason ?? undefined,
  });
}

export function createSessionAttachmentRepository(tx: StorageTransaction): SessionAttachmentRepository {
  return {
    insert(attachment) {
      assertInTransaction(tx);
      assertValidProjectId(attachment.projectId);
      tx.run(
        `INSERT INTO session_task_attachments
           (attachment_id, session_id, project_id, task_id, attached_at, detached_at, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        attachment.attachmentId,
        attachment.sessionId,
        attachment.projectId,
        attachment.taskId,
        toMs(attachment.attachedAt),
        attachment.detachedAt ? toMs(attachment.detachedAt) : null,
        attachment.reason ?? null,
      );
    },

    current(projectId, sessionId) {
      assertValidProjectId(projectId);
      const row = tx.get<AttachmentRow>(
        `SELECT ${ATTACHMENT_COLUMNS} FROM session_task_attachments
         WHERE session_id = ? AND detached_at IS NULL`,
        sessionId,
      );
      if (row?.project_id !== projectId) return undefined;
      return assembleAttachment(row);
    },

    listBySession(projectId, sessionId) {
      assertValidProjectId(projectId);
      const rows = tx.all<AttachmentRow>(
        `SELECT ${ATTACHMENT_COLUMNS} FROM session_task_attachments
         WHERE session_id = ? AND project_id = ?
         ORDER BY attached_at, attachment_id`,
        sessionId,
        projectId,
      );
      return rows.map(assembleAttachment);
    },

    detach(projectId, sessionId, detachedAt, reason) {
      assertInTransaction(tx);
      assertValidProjectId(projectId);
      const active = tx.get<{ attachment_id: string; project_id: string }>(
        `SELECT attachment_id, project_id FROM session_task_attachments
         WHERE session_id = ? AND detached_at IS NULL`,
        sessionId,
      );
      if (active?.project_id !== projectId) {
        throw new SestinaError(SestinaErrorCode.session_not_found, "Host session not found");
      }
      tx.run(
        "UPDATE session_task_attachments SET detached_at = ?, reason = ? WHERE attachment_id = ?",
        toMs(detachedAt),
        reason ?? null,
        active.attachment_id,
      );
    },
  };
}
