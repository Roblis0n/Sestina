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
import { claimMessageDeliveryLease } from "../lease.js";
import {
  assertCursorLimit,
  assertInTransaction,
  assertValidProjectId,
  fromMs,
  toMs,
  type CursorInput,
  type Page,
} from "./shared.js";

export type DeliveryReserveResult =
  | "acquired"
  | "wait_for_existing"
  | "already_delivered"
  | "expired";

export interface CollaborationRepository {
  // threads
  insertThread(thread: CollaborationThread): void;
  getThread(threadId: string): CollaborationThread | undefined;
  listThreadsByProject(projectId: string, input: CursorInput): Page<CollaborationThread>;
  // endpoints
  insertEndpoint(endpoint: CollaborationEndpoint): void;
  listEndpoints(projectId: string, taskId?: string): CollaborationEndpoint[];
  // messages — append-only (docs/42 §11.1)
  insertMessage(message: CollaborationMessage): void;
  getMessage(messageId: string): CollaborationMessage | undefined;
  listMessages(input: { threadId?: string; taskId?: string; limit: number }): CollaborationMessage[];
  // attempts — append-only (docs/09 §23)
  appendAttempt(attempt: CollaborationDeliveryAttempt): void;
  listAttempts(messageId: string): CollaborationDeliveryAttempt[];
  // actions — append-only (docs/42 §7.2)
  appendAction(action: CollaborationAction): void;
  /** Delivery and processing stay separate projections (docs/42 §7). */
  currentDeliveryState(messageId: string): CollaborationDeliveryStatus | undefined;
  currentProcessingState(messageId: string): CollaborationProcessingStatus | undefined;
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

const ATTEMPT_COLUMNS = `attempt_id, message_id, target_endpoint_id, sequence, route, status,
  started_at, finished_at, adapter_receipt, error, data`;

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

    getThread(threadId) {
      const row = tx.get<{
        thread_id: string;
        project_id: string;
        task_id: string;
        status: string;
        created_at: number;
        updated_at: number;
        data: string;
      }>(
        "SELECT thread_id, project_id, task_id, status, created_at, updated_at, data FROM collaboration_threads WHERE thread_id = ?",
        threadId,
      );
      return row ? assembleThread(row) : undefined;
    },

    listThreadsByProject(projectId, input) {
      assertValidProjectId(projectId);
      assertCursorLimit(input.limit);
      const rows = tx.all<{
        thread_id: string;
        project_id: string;
        task_id: string;
        status: string;
        created_at: number;
        updated_at: number;
        data: string;
      }>(
        "SELECT thread_id, project_id, task_id, status, created_at, updated_at, data FROM collaboration_threads WHERE project_id = ? ORDER BY created_at, thread_id LIMIT ?",
        projectId,
        input.limit,
      );
      return { items: rows.map(assembleThread) };
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

    getMessage(messageId) {
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
      }>(`SELECT ${MESSAGE_COLUMNS} FROM collaboration_messages WHERE message_id = ?`, messageId);
      return row ? assembleMessage(row) : undefined;
    },

    listMessages(input) {
      assertCursorLimit(input.limit);
      const where = input.threadId ? "thread_id = ?" : input.taskId ? "task_id = ?" : null;
      if (!where) {
        throw new SestinaError(SestinaErrorCode.validation_failed, "threadId or taskId is required");
      }
      const rows = tx.all<{
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
        `SELECT ${MESSAGE_COLUMNS} FROM collaboration_messages WHERE ${where} ORDER BY created_at, message_id LIMIT ?`,
        input.threadId ?? input.taskId,
        input.limit,
      );
      return rows.map(assembleMessage);
    },

    appendAttempt(attempt) {
      assertInTransaction(tx);
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

    listAttempts(messageId) {
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
        `SELECT ${ATTEMPT_COLUMNS} FROM collaboration_delivery_attempts WHERE message_id = ? ORDER BY sequence`,
        messageId,
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

    appendAction(action) {
      assertInTransaction(tx);
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

    currentDeliveryState(messageId) {
      const row = tx.get<{ status: string }>(
        "SELECT status FROM collaboration_delivery_attempts WHERE message_id = ? ORDER BY sequence DESC LIMIT 1",
        messageId,
      );
      return (row?.status as CollaborationDeliveryStatus | undefined) ?? undefined;
    },

    currentProcessingState(messageId) {
      const row = tx.get<{ status: string }>(
        "SELECT status FROM collaboration_actions WHERE message_id = ? ORDER BY acted_at DESC, action_id DESC LIMIT 1",
        messageId,
      );
      return (row?.status as CollaborationProcessingStatus | undefined) ?? undefined;
    },

    reserveDelivery(input) {
      assertInTransaction(tx);
      const message = tx.get<{ expires_at: number }>(
        "SELECT expires_at FROM collaboration_messages WHERE message_id = ?",
        input.messageId,
      );
      if (!message) {
        throw new SestinaError(SestinaErrorCode.internal_error, "Collaboration message not found");
      }
      if (message.expires_at <= Date.now()) {
        return "expired";
      }
      return claimMessageDeliveryLease(tx, input);
    },
  };
}
