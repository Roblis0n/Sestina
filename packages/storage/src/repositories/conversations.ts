import {
  ConversationSchema,
  ConversationMessageSchema,
  ContextRefSchema,
  SestinaErrorCode,
  SestinaError,
  type Conversation,
  type ConversationMessage,
  type MessageStatus,
} from "@sestina/schema";
import type { StorageTransaction } from "../transaction.js";
import { validateJson } from "../schema-check.js";
import {
  assertCursorLimit,
  assertInTransaction,
  assertValidProjectId,
  fromMs,
  toMs,
  type CursorInput,
  type Page,
} from "./shared.js";

export interface ConversationRepository {
  insertConversation(conversation: Conversation): void;
  getConversation(conversationId: string): Conversation | undefined;
  listByProject(projectId: string, input: CursorInput): Page<Conversation>;
  /** Writes the message and its context_refs rows in one transaction. */
  insertMessage(message: ConversationMessage): void;
  getMessage(messageId: string): ConversationMessage | undefined;
  listMessages(conversationId: string, input: CursorInput): Page<ConversationMessage>;
  setMessageStatus(messageId: string, status: MessageStatus): void;
}

function assembleConversation(row: {
  conversation_id: string;
  project_id: string;
  task_id: string | null;
  type: string;
  status: string;
  created_at: number;
  updated_at: number;
  data: string;
}): Conversation {
  const data = JSON.parse(row.data) as Conversation;
  return ConversationSchema.parse({
    ...data,
    conversationId: row.conversation_id,
    projectId: row.project_id,
    taskId: row.task_id ?? undefined,
    type: row.type,
    status: row.status,
    createdAt: fromMs(row.created_at),
    updatedAt: fromMs(row.updated_at),
  });
}

function assembleMessage(
  row: {
    message_id: string;
    conversation_id: string;
    role: string;
    body: string | null;
    status: string;
    created_at: number;
    data: string;
  },
  refs: { ref_type: string; ref_id: string; resolution_status: string; data: string }[],
): ConversationMessage {
  const data = JSON.parse(row.data) as ConversationMessage;
  const contextRefs = refs.map((r) => {
    const parsed = ContextRefSchema.parse(JSON.parse(r.data) as unknown);
    return { ...parsed, refType: r.ref_type, refId: r.ref_id, resolutionStatus: r.resolution_status };
  });
  return ConversationMessageSchema.parse({
    ...data,
    messageId: row.message_id,
    conversationId: row.conversation_id,
    role: row.role,
    body: row.body ?? undefined,
    status: row.status,
    createdAt: fromMs(row.created_at),
    contextRefs,
  });
}

export function createConversationRepository(tx: StorageTransaction): ConversationRepository {
  return {
    insertConversation(conversation) {
      assertInTransaction(tx);
      tx.run(
        `INSERT INTO conversations (conversation_id, project_id, task_id, type, status, created_at, updated_at, data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        conversation.conversationId,
        conversation.projectId,
        conversation.taskId ?? null,
        conversation.type,
        conversation.status,
        toMs(conversation.createdAt),
        toMs(conversation.updatedAt),
        validateJson(ConversationSchema, conversation, "Conversation"),
      );
    },

    getConversation(conversationId) {
      const row = tx.get<{
        conversation_id: string;
        project_id: string;
        task_id: string | null;
        type: string;
        status: string;
        created_at: number;
        updated_at: number;
        data: string;
      }>(
        `SELECT conversation_id, project_id, task_id, type, status, created_at, updated_at, data
         FROM conversations WHERE conversation_id = ?`,
        conversationId,
      );
      return row ? assembleConversation(row) : undefined;
    },

    listByProject(projectId, input) {
      assertValidProjectId(projectId);
      assertCursorLimit(input.limit);
      const rows = tx.all<{
        conversation_id: string;
        project_id: string;
        task_id: string | null;
        type: string;
        status: string;
        created_at: number;
        updated_at: number;
        data: string;
      }>(
        `SELECT conversation_id, project_id, task_id, type, status, created_at, updated_at, data
         FROM conversations WHERE project_id = ? ORDER BY created_at, conversation_id LIMIT ?`,
        projectId,
        input.limit,
      );
      return { items: rows.map(assembleConversation) };
    },

    insertMessage(message) {
      assertInTransaction(tx);
      tx.run(
        `INSERT INTO conversation_messages (message_id, conversation_id, role, body, status, created_at, data)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        message.messageId,
        message.conversationId,
        message.role,
        message.body,
        message.status,
        toMs(message.createdAt),
        validateJson(ConversationMessageSchema, message, "ConversationMessage"),
      );
      for (const ref of message.contextRefs) {
        tx.run(
          `INSERT INTO context_refs (conversation_message_id, ref_type, ref_id, resolution_status, data)
           VALUES (?, ?, ?, ?, ?)`,
          message.messageId,
          ref.refType,
          ref.refId,
          ref.resolutionStatus,
          validateJson(ContextRefSchema, ref, "ContextRef"),
        );
      }
    },

    getMessage(messageId) {
      const row = tx.get<{
        message_id: string;
        conversation_id: string;
        role: string;
        body: string | null;
        status: string;
        created_at: number;
        data: string;
      }>(
        `SELECT message_id, conversation_id, role, body, status, created_at, data
         FROM conversation_messages WHERE message_id = ?`,
        messageId,
      );
      if (!row) return undefined;
      const refs = tx.all<{ ref_type: string; ref_id: string; resolution_status: string; data: string }>(
        "SELECT ref_type, ref_id, resolution_status, data FROM context_refs WHERE conversation_message_id = ?",
        messageId,
      );
      return assembleMessage(row, refs);
    },

    listMessages(conversationId, input) {
      assertCursorLimit(input.limit);
      const rows = tx.all<{
        message_id: string;
        conversation_id: string;
        role: string;
        body: string | null;
        status: string;
        created_at: number;
        data: string;
      }>(
        `SELECT message_id, conversation_id, role, body, status, created_at, data
         FROM conversation_messages WHERE conversation_id = ? ORDER BY created_at, message_id LIMIT ?`,
        conversationId,
        input.limit,
      );
      return {
        items: rows.map((row) => {
          const refs = tx.all<{ ref_type: string; ref_id: string; resolution_status: string; data: string }>(
            "SELECT ref_type, ref_id, resolution_status, data FROM context_refs WHERE conversation_message_id = ?",
            row.message_id,
          );
          return assembleMessage(row, refs);
        }),
      };
    },

    setMessageStatus(messageId, status) {
      assertInTransaction(tx);
      const result = tx.run(
        "UPDATE conversation_messages SET status = ? WHERE message_id = ?",
        status,
        messageId,
      );
      if (Number(result.changes) === 0) {
        throw new SestinaError(SestinaErrorCode.internal_error, "Conversation message not found");
      }
    },
  };
}
