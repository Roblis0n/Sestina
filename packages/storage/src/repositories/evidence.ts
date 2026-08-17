import {
  ClaimEvidenceLinkSchema,
  EvidenceItemSchema,
  MAX_CLAIM_EVIDENCE_REFS,
  SestinaError,
  SestinaErrorCode,
  isPeerProvenance,
  type ClaimEvidenceLink,
  type EvidenceItem,
  type EvidenceStatus,
} from "@sestina/schema";
import type { StorageTransaction } from "../transaction.js";
import { validateJson } from "../schema-check.js";
import {
  assertInTransaction,
  deriveLedgerHistory,
  fromMs,
  insertLedgerHistory,
  keysetPage,
  parseLedgerActor,
  readLedgerHistory,
  toMs,
  type CursorInput,
  type LedgerHistoryRead,
  type LedgerHistoryWrite,
  type Page,
} from "./shared.js";

export interface EvidenceRepository {
  /** The sensitive excerpt lives in its own column so retention can clear it. */
  insert(projectId: string, item: EvidenceItem): void;
  get(projectId: string, evidenceId: string): EvidenceItem | undefined;
  listByProject(projectId: string, input: CursorInput): Page<EvidenceItem>;
  listByTask(projectId: string, taskId: string, input: CursorInput): Page<EvidenceItem>;
  /** Point lookup for a bounded id list; ids from other projects never match. */
  listByIds(projectId: string, evidenceIds: readonly string[]): EvidenceItem[];
  /** Hash-dedup lookup, scoped to one project+task (docs/22 Task 10). */
  findByContentHash(
    projectId: string,
    taskId: string,
    contentHash: string,
  ): EvidenceItem | undefined;
  /**
   * CAS status transition: applies only when the stored row is at
   * expectedVersion, bumps the version and appends one history row.
   */
  transition(
    projectId: string,
    evidenceId: string,
    expectedVersion: number,
    nextStatus: EvidenceStatus,
    history: LedgerHistoryWrite,
  ): void;
  /**
   * Project-scoped claim->evidence link with a same-task fence: the claim
   * and the evidence item must belong to the same project AND the same task.
   */
  linkClaimEvidence(projectId: string, link: ClaimEvidenceLink): void;
  listClaimLinks(projectId: string, claimId: string): ClaimEvidenceLink[];
  history(projectId: string, evidenceId: string): LedgerHistoryRead[];
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
  version: number;
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
    version: row.version,
  });
}

const EVIDENCE_COLUMNS = `evidence_id, project_id, task_id, type, status, excerpt, content_hash, recorded_by, observed_at, expires_at, version, data`;
const POINT_LOOKUP_CHUNK = 200;
const EVIDENCE_STATUS_TRANSITIONS: Readonly<
  Record<EvidenceStatus, readonly EvidenceStatus[]>
> = {
  unverified: ["verified", "disputed", "superseded", "unavailable"],
  verified: ["verified", "disputed", "superseded", "unavailable"],
  disputed: ["disputed", "superseded", "unavailable"],
  unavailable: ["disputed", "superseded", "unavailable"],
  superseded: [],
};

export function createEvidenceRepository(tx: StorageTransaction): EvidenceRepository {
  return {
    insert(projectId, item) {
      assertInTransaction(tx);
      if (item.version !== 1) {
        throw new SestinaError(
          SestinaErrorCode.validation_failed,
          "A new evidence item must start at version 1",
        );
      }
      if (item.status !== "unverified") {
        throw new SestinaError(
          SestinaErrorCode.validation_failed,
          "A new evidence item must start unverified",
        );
      }
      const task = tx.get<{ project_id: string }>(
        "SELECT project_id FROM tasks WHERE task_id = ?",
        item.taskId,
      );
      if (task?.project_id !== projectId) {
        throw new SestinaError(SestinaErrorCode.task_not_found, "Task not found in project");
      }
      const duplicate = item.contentHash
        ? tx.get<{ evidence_id: string }>(
            `SELECT evidence_id FROM evidence_items
             WHERE project_id = ? AND task_id = ? AND content_hash = ? AND content_hash != ''`,
            projectId,
            item.taskId,
            item.contentHash,
          )
        : undefined;
      if (duplicate) {
        throw new SestinaError(
          SestinaErrorCode.idempotency_violation,
          "An evidence item with this content hash already exists for this task",
        );
      }
      tx.run(
        `INSERT INTO evidence_items
           (evidence_id, project_id, task_id, type, status, excerpt, content_hash,
            recorded_by, observed_at, expires_at, version, data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        item.evidenceId,
        projectId,
        item.taskId,
        item.type,
        item.status,
        item.excerpt ?? null,
        item.contentHash ?? "",
        item.recordedBy,
        item.observedAt ? toMs(item.observedAt) : Date.now(),
        item.expiresAt ? toMs(item.expiresAt) : null,
        item.version,
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

    listByTask(projectId, taskId, input) {
      const page = keysetPage<EvidenceRow>(tx, {
        table: "evidence_items",
        columns: EVIDENCE_COLUMNS,
        keyColumn: "observed_at",
        idColumn: "evidence_id",
        projectColumn: "project_id",
        projectId,
        cursor: input.cursor,
        limit: input.limit,
        extraWhere: "task_id = ?",
        extraParams: [taskId],
      });
      return { items: page.items.map(assembleEvidence), nextCursor: page.nextCursor };
    },

    listByIds(projectId, evidenceIds) {
      if (evidenceIds.length === 0) {
        return [];
      }
      const ids = [...new Set(evidenceIds)];
      const found = new Map<string, EvidenceItem>();
      for (let start = 0; start < ids.length; start += POINT_LOOKUP_CHUNK) {
        const chunk = ids.slice(start, start + POINT_LOOKUP_CHUNK);
        const bindMarkers = chunk.map(() => "?").join(", ");
        const rows = tx.all<EvidenceRow>(
          `SELECT ${EVIDENCE_COLUMNS} FROM evidence_items
           WHERE project_id = ? AND evidence_id IN (${bindMarkers})`,
          projectId,
          ...chunk,
        );
        for (const row of rows) {
          const item = assembleEvidence(row);
          found.set(item.evidenceId, item);
        }
      }
      return ids.flatMap((id) => {
        const item = found.get(id);
        return item ? [item] : [];
      });
    },

    findByContentHash(projectId, taskId, contentHash) {
      if (!contentHash) {
        return undefined;
      }
      const row = tx.get<EvidenceRow>(
        `SELECT ${EVIDENCE_COLUMNS} FROM evidence_items
         WHERE project_id = ? AND task_id = ? AND content_hash = ? AND content_hash != ''`,
        projectId,
        taskId,
        contentHash,
      );
      return row ? assembleEvidence(row) : undefined;
    },

    transition(projectId, evidenceId, expectedVersion, nextStatus, history) {
      assertInTransaction(tx);
      const existing = tx.get<{ status: string; version: number; data: string }>(
        "SELECT status, version, data FROM evidence_items WHERE evidence_id = ? AND project_id = ?",
        evidenceId,
        projectId,
      );
      if (!existing) {
        throw new SestinaError(SestinaErrorCode.evidence_not_found, "Evidence item not found");
      }
      if (existing.version !== expectedVersion) {
        throw new SestinaError(
          SestinaErrorCode.stale_state,
          "Evidence item was modified concurrently; reload and retry",
        );
      }
      const currentData = EvidenceItemSchema.parse({
        ...(JSON.parse(existing.data) as EvidenceItem),
        evidenceId,
        status: existing.status,
        version: existing.version,
      });
      const nextData = EvidenceItemSchema.parse({
        ...currentData,
        status: nextStatus,
        version: expectedVersion + 1,
      });
      if (!EVIDENCE_STATUS_TRANSITIONS[currentData.status].includes(nextStatus)) {
        throw new SestinaError(
          SestinaErrorCode.validation_failed,
          `Illegal evidence status transition: ${currentData.status} -> ${nextStatus}`,
        );
      }
      const ledgerHistory = deriveLedgerHistory(
        history,
        expectedVersion,
        existing.status,
        nextStatus,
        nextStatus === "verified" ? "verify" : nextStatus,
      );
      if (nextStatus === "verified" && isPeerProvenance(parseLedgerActor(ledgerHistory))) {
        throw new SestinaError(
          SestinaErrorCode.forbidden,
          "Peer provenance cannot verify evidence",
        );
      }
      const result = tx.run(
        `UPDATE evidence_items SET status = ?, version = ?, data = ?
         WHERE evidence_id = ? AND project_id = ? AND version = ?`,
        nextStatus,
        expectedVersion + 1,
        validateJson(EvidenceItemSchema, nextData, "EvidenceItem"),
        evidenceId,
        projectId,
        expectedVersion,
      );
      if (Number(result.changes) === 0) {
        throw new SestinaError(
          SestinaErrorCode.stale_state,
          "Evidence item was modified concurrently; reload and retry",
        );
      }
      insertLedgerHistory(
        tx,
        "evidence_history",
        "evidence_id",
        projectId,
        evidenceId,
        ledgerHistory,
      );
    },

    linkClaimEvidence(projectId, link) {
      assertInTransaction(tx);
      const parsedLink = ClaimEvidenceLinkSchema.parse(link);
      const claim = tx.get<{ project_id: string; task_id: string | null }>(
        "SELECT project_id, task_id FROM claims WHERE claim_id = ?",
        link.claimId,
      );
      const evidence = tx.get<{ project_id: string; task_id: string | null }>(
        "SELECT project_id, task_id FROM evidence_items WHERE evidence_id = ?",
        link.evidenceId,
      );
      // Missing, cross-project and cross-task all fail with the same stable
      // error - no cross-project or cross-task existence leak.
      if (
        claim?.project_id !== projectId ||
        evidence?.project_id !== projectId
      ) {
        throw new SestinaError(
          SestinaErrorCode.project_isolation_violation,
          "Claim and evidence item must belong to the same project",
        );
      }
      if (claim.task_id === null || evidence.task_id === null || claim.task_id !== evidence.task_id) {
        throw new SestinaError(
          SestinaErrorCode.validation_failed,
          "Claim and evidence item must belong to the same task",
        );
      }
      const existingLink = tx.get<{
        relation: string;
        strength: string;
        actor: string;
      }>(
        `SELECT relation, strength, actor FROM claim_evidence
         WHERE claim_id = ? AND evidence_id = ?`,
        parsedLink.claimId,
        parsedLink.evidenceId,
      );
      const actor = JSON.stringify(parsedLink.provenance);
      if (existingLink) {
        if (
          existingLink.relation === parsedLink.relation &&
          existingLink.strength === parsedLink.strength &&
          existingLink.actor === actor
        ) {
          return;
        }
        throw new SestinaError(
          SestinaErrorCode.idempotency_violation,
          "claim-evidence authority links are immutable",
        );
      }
      const linkCount = Number(
        tx.get<{ count: number | bigint }>(
          "SELECT COUNT(*) AS count FROM claim_evidence WHERE claim_id = ?",
          parsedLink.claimId,
        )?.count ?? 0,
      );
      if (linkCount >= MAX_CLAIM_EVIDENCE_REFS) {
        throw new SestinaError(
          SestinaErrorCode.limit_exceeded,
          "A claim cannot have more evidence links than the schema bound",
        );
      }
      tx.run(
        `INSERT INTO claim_evidence
           (claim_id, evidence_id, relation, strength, actor, linked_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        parsedLink.claimId,
        parsedLink.evidenceId,
        parsedLink.relation,
        parsedLink.strength,
        actor,
        toMs(parsedLink.linkedAt),
      );
    },

    listClaimLinks(projectId, claimId) {
      const rows = tx.all<{
        claim_id: string;
        evidence_id: string;
        relation: string;
        strength: string;
        actor: string;
        linked_at: number;
      }>(
        `SELECT ce.claim_id, ce.evidence_id, ce.relation, ce.strength, ce.actor, ce.linked_at
         FROM claim_evidence ce
         JOIN claims c ON c.claim_id = ce.claim_id
         WHERE c.project_id = ? AND ce.claim_id = ?
         ORDER BY ce.linked_at, ce.evidence_id
         LIMIT ?`,
        projectId,
        claimId,
        MAX_CLAIM_EVIDENCE_REFS + 1,
      );
      if (rows.length > MAX_CLAIM_EVIDENCE_REFS) {
        throw new SestinaError(
          SestinaErrorCode.limit_exceeded,
          "Claim-evidence links exceed the schema bound",
        );
      }
      return rows.map((row) =>
        ClaimEvidenceLinkSchema.parse({
          claimId: row.claim_id,
          evidenceId: row.evidence_id,
          relation: row.relation,
          strength: row.strength,
          provenance: JSON.parse(row.actor) as unknown,
          linkedAt: fromMs(row.linked_at),
        }),
      );
    },

    history(projectId, evidenceId) {
      return readLedgerHistory(tx, "evidence_history", "evidence_id", projectId, evidenceId);
    },
  };
}
