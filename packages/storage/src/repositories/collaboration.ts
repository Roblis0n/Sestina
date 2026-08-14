import { assertCollaborationOwnership } from "@sestina/schema";
import {
  CollaborationThreadSchema,
  CollaborationMessageSchema,
  CollaborationEndpointSchema,
  CollaborationDeliveryAttemptSchema,
  CollaborationActionSchema,
  SestinaErrorCode,
  SestinaError,
  type CollaborationThread,
  type CollaborationMessage,
  type CollaborationEndpoint,
  type CollaborationDeliveryAttempt,
  type CollaborationAction,
  type CollaborationDeliveryStatus,
  type CollaborationProcessingStatus,
} from "@sestina/schema";
import type { StorageTransaction } from "../transaction.js";
import { validateJson } from "../schema-check.js";
import {
  claimMessageDeliveryLease,
  assertDeliveryCredential,
  type DeliveryCredential,
} from "../lease.js";
import {
  assertInTransaction,
  assertValidProjectId,
  fromMs,
  keysetPage,
  toMs,
  type CursorInput,
  type Page,
} from "./shared.js";

export type DeliveryReserveResult =
  | { kind: "acquired"; credential: DeliveryCredential }
  | { kind: "wait_for_existing" }
  | { kind: "already_delivered" }
  | { kind: "expired" };

export interface CollaborationRepository {
  // threads
  insertThread(thread: CollaborationThread): void;
  getThread(projectId: string, threadId: string): CollaborationThread | undefined;
  listThreadsByProject(projectId: string, input: CursorInput): Page<CollaborationThread>;
  // endpoints
  insertEndpoint(endpoint: CollaborationEndpoint): void;
  listEndpoints(projectId: string, taskId?: string): CollaborationEndpoint[];
  // messages — append-only (docs/42 §11.1)
  insertMessage(message: CollaborationMessage): void;
  getMessage(projectId: string, messageId: string): CollaborationMessage | undefined;
  listMessages(
    projectId: string,
    input: { threadId?: string; taskId?: string } & CursorInput,
  ): Page<CollaborationMessage>;
  // attempts — append-only (docs/09 §23)
  appendAttempt(attempt: CollaborationDeliveryAttempt, credential: DeliveryCredential): void;
  listAttempts(projectId: string, messageId: string): CollaborationDeliveryAttempt[];
  // actions — append-only (docs/42 §7.2)
  /**
   * Project-fenced (docs/22 Task 6): the message must belong to the given
   * project, otherwise the append fails with the same
   * collaboration_message_not_found as a missing id — no existence leak.
   */
  appendAction(projectId: string, action: CollaborationAction): void;
  /** Delivery and processing stay separate projections (docs/42 §7). */
  currentDeliveryState(
    projectId: string,
    messageId: string,
  ): CollaborationDeliveryStatus | undefined;
  currentProcessingState(
    projectId: string,
    messageId: string,
  ): CollaborationProcessingStatus | undefined;
  /**
   * Reserves the delivery lease for message+target. Expired messages can
   * never be claimed again (docs/22 Task 6 invariant).
   */
  reserveDelivery(
    input: { messageId: string; targetEndpointId: string; ownerId: string; ttlMs?: number },
  ): DeliveryReserveResult;
}

function assembleThread(row: {
  thread_id: string;
  project_id: string;
  task_id: string;
  status: string;
  created_at: number;
  updated_at: number;
  data: string;
}): CollaborationThread {
  const data = JSON.parse(row.data) as CollaborationThread;
  return CollaborationThreadSchema.parse({
    ...data,
    threadId: row.thread_id,
    projectId: row.project_id,
    taskId: row.task_id,
    status: row.status,
    createdAt: fromMs(row.created_at),
    updatedAt: fromMs(row.updated_at),
  });
}

function assembleMessage(row: {
  message_id: string;
  thread_id: string;
  project_id: string;
  task_id: string;
  kind: string;
  source_endpoint_id: string;
  summary: string;
  body: string | null;
  privacy_class: string;
  ttl_seconds: number;
  hop_count: number;
  dedupe_key: string;
  created_at: number;
  expires_at: number;
  data: string;
}): CollaborationMessage {
  const data = JSON.parse(row.data) as CollaborationMessage;
  return CollaborationMessageSchema.parse({
    ...data,
    messageId: row.message_id,
    threadId: row.thread_id,
    projectId: row.project_id,
    taskId: row.task_id,
    kind: row.kind,
    sourceEndpointId: row.source_endpoint_id,
    summary: row.summary,
    body: row.body ?? undefined,
    privacyClass: row.privacy_class,
    ttlSeconds: row.ttl_seconds,
    hopCount: row.hop_count,
    dedupeKey: row.dedupe_key,
    createdAt: fromMs(row.created_at),
    expiresAt: fromMs(row.expires_at),
  });
}

function assembleEndpoint(row: {
  endpoint_id: string;
  project_id: string;
  task_id: string;
  host: string;
  host_session_id: string;
  capability: string;
  inbound_policy: string;
  connected: number;
  last_seen_at: number | null;
  data: string;
}): CollaborationEndpoint {
  const data = JSON.parse(row.data) as CollaborationEndpoint;
  return CollaborationEndpointSchema.parse({
    ...data,
    endpointId: row.endpoint_id,
    projectId: row.project_id,
    taskId: row.task_id,
    host: row.host,
    hostSessionId: row.host_session_id,
    capability: row.capability,
    inboundPolicy: row.inbound_policy,
    connected: row.connected !== 0,
    lastSeenAt: row.last_seen_at !== null ? fromMs(row.last_seen_at) : undefined,
  });
}

const MESSAGE_COLUMNS = `message_id, thread_id, project_id, task_id, kind, source_endpoint_id,
  summary, body, privacy_class, ttl_seconds, hop_count, dedupe_key, created_at, expires_at, data`;

const ATTEMPT_COLUMNS = `a.attempt_id, a.message_id, a.target_endpoint_id, a.sequence, a.route,
  a.status, a.started_at, a.finished_at, a.adapter_receipt, a.error, a.data`;

export function createCollaborationRepository(tx: StorageTransaction): CollaborationRepository {
  return {
    insertThread(thread) {
      assertInTransaction(tx);
      tx.run(
        `INSERT INTO collaboration_threads (thread_id, project_id, task_id, status, created_at, updated_at, data)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        thread.threadId,
        thread.projectId,
        thread.taskId,
        thread.status,
        toMs(thread.createdAt),
        toMs(thread.updatedAt),
        validateJson(CollaborationThreadSchema, thread, "CollaborationThread"),
      );
    },

    getThread(projectId, threadId) {
      const row = tx.get<{
        thread_id: string;
        project_id: string;
        task_id: string;
        status: string;
        created_at: number;
        updated_at: number;
        data: string;
      }>(
        "SELECT thread_id, project_id, task_id, status, created_at, updated_at, data FROM collaboration_threads WHERE thread_id = ? AND project_id = ?",
        threadId,
        projectId,
      );
      return row ? assembleThread(row) : undefined;
    },

    listThreadsByProject(projectId, input) {
      const page = keysetPage<{
        thread_id: string;
        project_id: string;
        task_id: string;
        status: string;
        created_at: number;
        updated_at: number;
        data: string;
      }>(tx, {
        table: "collaboration_threads",
        columns: "thread_id, project_id, task_id, status, created_at, updated_at, data",
        keyColumn: "created_at",
        idColumn: "thread_id",
        projectColumn: "project_id",
        projectId,
        cursor: input.cursor,
        limit: input.limit,
      });
      return { items: page.items.map(assembleThread), nextCursor: page.nextCursor };
    },

    insertEndpoint(endpoint) {
      assertInTransaction(tx);
      tx.run(
        `INSERT INTO collaboration_endpoints
           (endpoint_id, project_id, task_id, host, host_session_id, capability, inbound_policy, connected, last_seen_at, data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        endpoint.endpointId,
        endpoint.projectId,
        endpoint.taskId,
        endpoint.host,
        endpoint.hostSessionId,
        endpoint.capability,
        endpoint.inboundPolicy,
        endpoint.connected ? 1 : 0,
        endpoint.lastSeenAt ? toMs(endpoint.lastSeenAt) : null,
        validateJson(CollaborationEndpointSchema, endpoint, "CollaborationEndpoint"),
      );
    },

    listEndpoints(projectId, taskId) {
      assertValidProjectId(projectId);
      const rows = taskId
        ? tx.all<{
            endpoint_id: string;
            project_id: string;
            task_id: string;
            host: string;
            host_session_id: string;
            capability: string;
            inbound_policy: string;
            connected: number;
            last_seen_at: number | null;
            data: string;
          }>(
            `SELECT endpoint_id, project_id, task_id, host, host_session_id, capability, inbound_policy, connected, last_seen_at, data
             FROM collaboration_endpoints WHERE project_id = ? AND task_id = ? ORDER BY endpoint_id`,
            projectId,
            taskId,
          )
        : tx.all<{
            endpoint_id: string;
            project_id: string;
            task_id: string;
            host: string;
            host_session_id: string;
            capability: string;
            inbound_policy: string;
            connected: number;
            last_seen_at: number | null;
            data: string;
          }>(
            `SELECT endpoint_id, project_id, task_id, host, host_session_id, capability, inbound_policy, connected, last_seen_at, data
             FROM collaboration_endpoints WHERE project_id = ? ORDER BY endpoint_id`,
            projectId,
          );
      return rows.map(assembleEndpoint);
    },

    insertMessage(message) {
      assertInTransaction(tx);
      // Authoritative ownership check before persistence (docs/42 §6.2):
      // thread, project/task, participants, endpoint bindings, ref owners
      // and the reply chain must all line up.
      const thread = tx.get<{
        thread_id: string; project_id: string; task_id: string; data: string;
      }>("SELECT thread_id, project_id, task_id, data FROM collaboration_threads WHERE thread_id = ?", message.threadId);
      if (!thread) {
        throw new SestinaError(SestinaErrorCode.internal_error, "Collaboration thread not found");
      }
      const threadData = JSON.parse(thread.data) as { participantEndpointIds?: string[] };
      const endpointProjects = new Map<string, { projectId: string; taskId: string }>();
      for (const endpointId of new Set([
        message.sourceEndpointId,
        ...message.targetEndpointIds,
        ...(threadData.participantEndpointIds ?? []),
      ])) {
        const row = tx.get<{ project_id: string; task_id: string }>(
          "SELECT project_id, task_id FROM collaboration_endpoints WHERE endpoint_id = ?",
          endpointId,
        );
        if (row) {
          endpointProjects.set(endpointId, { projectId: row.project_id, taskId: row.task_id });
        }
      }
      const refOwnerProjects = new Map<string, { projectId: string; taskId: string }>();
      const resolveRef = (refType: string, refId: string): void => {
        const table = REF_TABLE_BY_TYPE[refType];
        if (!table) return;
        const row = tx.get<{ project_id: string; task_id: string | null }>(
          `SELECT project_id, task_id FROM ${table} WHERE ${REF_ID_BY_TYPE[refType] ?? "id"} = ?`,
          refId,
        );
        if (row) {
          refOwnerProjects.set(refId, { projectId: row.project_id, taskId: row.task_id ?? message.taskId });
        }
      };
      for (const ref of message.contextRefs) {
        resolveRef(ref.refType, ref.refId);
      }
      for (const evidenceId of message.evidenceRefs) {
        resolveRef("evidence", evidenceId);
      }
      const replyChain = new Map<string, { projectId: string; taskId: string; threadId: string }>();
      if (message.replyToMessageId) {
        const replyRow = tx.get<{ project_id: string; task_id: string; thread_id: string }>(
          "SELECT project_id, task_id, thread_id FROM collaboration_messages WHERE message_id = ?",
          message.replyToMessageId,
        );
        if (replyRow) {
          replyChain.set(message.replyToMessageId, {
            projectId: replyRow.project_id,
            taskId: replyRow.task_id,
            threadId: replyRow.thread_id,
          });
        }
      }
      assertCollaborationOwnership(message, {
        thread: CollaborationThreadSchema.parse({
          ...threadData,
          threadId: thread.thread_id,
          projectId: thread.project_id,
          taskId: thread.task_id,
        }),
        endpointProjects,
        refOwnerProjects,
        replyChain,
      });
      tx.run(
        `INSERT INTO collaboration_messages
           (message_id, thread_id, project_id, task_id, kind, source_endpoint_id, summary, body,
            privacy_class, ttl_seconds, hop_count, dedupe_key, created_at, expires_at, data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        message.messageId,
        message.threadId,
        message.projectId,
        message.taskId,
        message.kind,
        message.sourceEndpointId,
        message.summary,
        message.body ?? null,
        message.privacyClass,
        message.ttlSeconds,
        message.hopCount,
        message.dedupeKey,
        toMs(message.createdAt),
        toMs(message.expiresAt),
        validateJson(CollaborationMessageSchema, message, "CollaborationMessage"),
      );
    },

    getMessage(projectId, messageId) {
      const row = tx.get<{
        message_id: string;
        thread_id: string;
        project_id: string;
        task_id: string;
        kind: string;
        source_endpoint_id: string;
        summary: string;
        body: string | null;
        privacy_class: string;
        ttl_seconds: number;
        hop_count: number;
        dedupe_key: string;
        created_at: number;
        expires_at: number;
        data: string;
      }>(
        `SELECT ${MESSAGE_COLUMNS} FROM collaboration_messages WHERE message_id = ? AND project_id = ?`,
        messageId,
        projectId,
      );
      return row ? assembleMessage(row) : undefined;
    },

    listMessages(projectId, input) {
      const scope = input.threadId ? "thread_id = ?" : input.taskId ? "task_id = ?" : null;
      if (!scope) {
        throw new SestinaError(SestinaErrorCode.validation_failed, "threadId or taskId is required");
      }
      const page = keysetPage<{
        message_id: string;
        thread_id: string;
        project_id: string;
        task_id: string;
        kind: string;
        source_endpoint_id: string;
        summary: string;
        body: string | null;
        privacy_class: string;
        ttl_seconds: number;
        hop_count: number;
        dedupe_key: string;
        created_at: number;
        expires_at: number;
        data: string;
      }>(tx, {
        table: "collaboration_messages",
        columns: MESSAGE_COLUMNS,
        keyColumn: "created_at",
        idColumn: "message_id",
        projectColumn: "project_id",
        projectId,
        cursor: input.cursor,
        limit: input.limit,
        extraWhere: scope,
        extraParams: [input.threadId ?? input.taskId],
      });
      return { items: page.items.map(assembleMessage), nextCursor: page.nextCursor };
    },

    appendAttempt(attempt, credential) {
      assertInTransaction(tx);
      // The current unexpired delivery lease holder alone may append
      // attempts — an uncredentialed caller can never mark a delivery.
      assertDeliveryCredential(tx, {
        messageId: attempt.messageId,
        targetEndpointId: attempt.targetEndpointId,
        credential,
      });
      // Expired messages can never receive new attempts (docs/22 Task 6).
      const message = tx.get<{ expires_at: number }>(
        "SELECT expires_at FROM collaboration_messages WHERE message_id = ?",
        attempt.messageId,
      );
      if (!message) {
        throw new SestinaError(SestinaErrorCode.internal_error, "Collaboration message not found");
      }
      if (message.expires_at <= Date.now() && attempt.status !== "expired") {
        throw new SestinaError(SestinaErrorCode.stale_state, "Collaboration message is expired");
      }
      tx.run(
        `INSERT INTO collaboration_delivery_attempts
           (attempt_id, message_id, target_endpoint_id, sequence, route, status, started_at,
            finished_at, adapter_receipt, error, data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        attempt.attemptId,
        attempt.messageId,
        attempt.targetEndpointId,
        attempt.sequence,
        attempt.route,
        attempt.status,
        toMs(attempt.startedAt),
        attempt.finishedAt ? toMs(attempt.finishedAt) : null,
        attempt.adapterReceipt ?? null,
        attempt.error ?? null,
        validateJson(CollaborationDeliveryAttemptSchema, attempt, "CollaborationDeliveryAttempt"),
      );
    },

    listAttempts(projectId, messageId) {
      // attempts carry no project column: scope through the message.
      const rows = tx.all<{
        attempt_id: string;
        message_id: string;
        target_endpoint_id: string;
        sequence: number;
        route: string;
        status: string;
        started_at: number;
        finished_at: number | null;
        adapter_receipt: string | null;
        error: string | null;
        data: string;
      }>(
        `SELECT ${ATTEMPT_COLUMNS}
         FROM collaboration_delivery_attempts a
         JOIN collaboration_messages m ON m.message_id = a.message_id
         WHERE a.message_id = ? AND m.project_id = ?
         ORDER BY a.sequence`,
        messageId,
        projectId,
      );
      return rows.map((row) => {
        const data = JSON.parse(row.data) as CollaborationDeliveryAttempt;
        return CollaborationDeliveryAttemptSchema.parse({
          ...data,
          attemptId: row.attempt_id,
          messageId: row.message_id,
          targetEndpointId: row.target_endpoint_id,
          sequence: row.sequence,
          route: row.route,
          status: row.status,
          startedAt: fromMs(row.started_at),
          finishedAt: row.finished_at !== null ? fromMs(row.finished_at) : undefined,
          adapterReceipt: row.adapter_receipt ?? undefined,
          error: row.error ?? undefined,
        });
      });
    },

    appendAction(projectId, action) {
      assertInTransaction(tx);
      const owned = tx.get<{ project_id: string }>(
        "SELECT project_id FROM collaboration_messages WHERE message_id = ?",
        action.messageId,
      );
      if (owned?.project_id !== projectId) {
        throw new SestinaError(
          SestinaErrorCode.collaboration_message_not_found,
          "Collaboration message not found",
        );
      }
      tx.run(
        `INSERT INTO collaboration_actions (action_id, message_id, endpoint_id, status, acted_at, note, data)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        action.actionId,
        action.messageId,
        action.endpointId,
        action.status,
        toMs(action.actedAt),
        action.note ?? null,
        validateJson(CollaborationActionSchema, action, "CollaborationAction"),
      );
    },

    currentDeliveryState(projectId, messageId) {
      const row = tx.get<{ status: string }>(
        `SELECT a.status
         FROM collaboration_delivery_attempts a
         JOIN collaboration_messages m ON m.message_id = a.message_id
         WHERE a.message_id = ? AND m.project_id = ?
         ORDER BY a.sequence DESC LIMIT 1`,
        messageId,
        projectId,
      );
      return (row?.status as CollaborationDeliveryStatus | undefined) ?? undefined;
    },

    currentProcessingState(projectId, messageId) {
      const row = tx.get<{ status: string }>(
        `SELECT a.status
         FROM collaboration_actions a
         JOIN collaboration_messages m ON m.message_id = a.message_id
         WHERE a.message_id = ? AND m.project_id = ?
         ORDER BY a.acted_at DESC, a.action_id DESC LIMIT 1`,
        messageId,
        projectId,
      );
      return (row?.status as CollaborationProcessingStatus | undefined) ?? undefined;
    },

    reserveDelivery(input) {
      assertInTransaction(tx);
      const message = tx.get<{ expires_at: number; data: string }>(
        "SELECT expires_at, data FROM collaboration_messages WHERE message_id = ?",
        input.messageId,
      );
      if (!message) {
        throw new SestinaError(SestinaErrorCode.internal_error, "Collaboration message not found");
      }
      if (message.expires_at <= Date.now()) {
        return { kind: "expired" };
      }
      // Only endpoints the message itself declares may be claimed.
      const parsed = JSON.parse(message.data) as { targetEndpointIds?: string[] };
      if (!(parsed.targetEndpointIds ?? []).includes(input.targetEndpointId)) {
        throw new SestinaError(
          SestinaErrorCode.validation_failed,
          "Target endpoint is not declared by the message",
        );
      }
      const claim = claimMessageDeliveryLease(tx, input);
      if (claim.kind === "acquired") {
        return { kind: "acquired", credential: { ownerId: input.ownerId, token: claim.token ?? "" } };
      }
      return { kind: claim.kind };
    },
  };
}


/** refType → (table, id column) for ownership resolution (docs/42 §6.2). */
const REF_TABLE_BY_TYPE: Record<string, string> = {
  task: "tasks",
  decision: "decisions",
  event: "events",
  contract_version: "contract_versions",
  boundary: "boundaries",
  evidence: "evidence_items",
  claim: "claims",
  correction: "corrections",
  host_session: "host_sessions",
  review: "review_items",
};

const REF_ID_BY_TYPE: Record<string, string> = {
  task: "task_id",
  decision: "decision_id",
  event: "event_id",
  contract_version: "contract_version_id",
  boundary: "boundary_id",
  evidence: "evidence_id",
  claim: "claim_id",
  correction: "correction_id",
  host_session: "session_id",
  review: "review_id",
};
