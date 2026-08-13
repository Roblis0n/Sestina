import { SestinaError, SestinaErrorCode } from "@sestina/schema";
import type { StorageDatabase } from "./connection.js";
import { assertValidProjectId } from "./repositories/shared.js";

export type SearchKind = "claim" | "evidence" | "conversation" | "collaboration";

export interface SearchQuery {
  /** Required: every body query is pinned to one project (docs/22 Task 6). */
  projectId: string;
  text: string;
  kinds?: readonly SearchKind[];
  limit: number;
}

export interface SearchRow {
  kind: SearchKind;
  id: string;
  projectId: string;
  snippet: string;
  occurredAt: number;
}

/**
 * Project-scoped FTS search. The FTS indexes carry no project column, so
 * every query joins the owning row back to its project; rows from other
 * projects can never surface (docs/22 Task 6, docs/31 §8).
 */
export function search(db: StorageDatabase, query: SearchQuery): SearchRow[] {
  assertValidProjectId(query.projectId);
  if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 500) {
    throw new SestinaError(SestinaErrorCode.validation_failed, "limit must be an integer between 1 and 500");
  }
  if (query.text.trim().length === 0) {
    throw new SestinaError(SestinaErrorCode.validation_failed, "search text must not be empty");
  }
  // Quote as an FTS phrase so user text can never inject MATCH operators.
  const matchExpression = `"${query.text.replaceAll('"', '""')}"`;
  const kinds = new Set<SearchKind>(query.kinds ?? ["claim", "evidence", "conversation", "collaboration"]);
  const rows: SearchRow[] = [];

  if (kinds.has("claim")) {
    for (const row of db.all<{ claim_id: string; text: string; project_id: string }>(
      `SELECT c.claim_id, c.text, c.project_id
       FROM fts_claims
       JOIN claims c ON c.rowid = fts_claims.rowid
       WHERE fts_claims MATCH ? AND c.project_id = ?
       LIMIT ?`,
      matchExpression,
      query.projectId,
      query.limit,
    )) {
      rows.push({ kind: "claim", id: row.claim_id, projectId: row.project_id, snippet: row.text, occurredAt: 0 });
    }
  }

  if (kinds.has("evidence")) {
    for (const row of db.all<{ evidence_id: string; excerpt: string; project_id: string; observed_at: number }>(
      `SELECT e.evidence_id, e.excerpt, e.project_id, e.observed_at
       FROM fts_evidence
       JOIN evidence_items e ON e.rowid = fts_evidence.rowid
       WHERE fts_evidence MATCH ? AND e.project_id = ?
       LIMIT ?`,
      matchExpression,
      query.projectId,
      query.limit,
    )) {
      rows.push({ kind: "evidence", id: row.evidence_id, projectId: row.project_id, snippet: row.excerpt, occurredAt: row.observed_at });
    }
  }

  if (kinds.has("conversation")) {
    for (const row of db.all<{ message_id: string; body: string | null; project_id: string; created_at: number }>(
      `SELECT m.message_id, m.body, c.project_id, m.created_at
       FROM fts_conversation_messages
       JOIN conversation_messages m ON m.rowid = fts_conversation_messages.rowid
       JOIN conversations c ON c.conversation_id = m.conversation_id
       WHERE fts_conversation_messages MATCH ? AND c.project_id = ?
       LIMIT ?`,
      matchExpression,
      query.projectId,
      query.limit,
    )) {
      rows.push({ kind: "conversation", id: row.message_id, projectId: row.project_id, snippet: row.body ?? "", occurredAt: row.created_at });
    }
  }

  if (kinds.has("collaboration")) {
    for (const row of db.all<{ message_id: string; summary: string; project_id: string; created_at: number }>(
      `SELECT m.message_id, m.summary, m.project_id, m.created_at
       FROM fts_collaboration_messages
       JOIN collaboration_messages m ON m.rowid = fts_collaboration_messages.rowid
       WHERE fts_collaboration_messages MATCH ? AND m.project_id = ?
       LIMIT ?`,
      matchExpression,
      query.projectId,
      query.limit,
    )) {
      rows.push({ kind: "collaboration", id: row.message_id, projectId: row.project_id, snippet: row.summary, occurredAt: row.created_at });
    }
  }

  return rows.slice(0, query.limit);
}
