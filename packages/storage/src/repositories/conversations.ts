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
  assertInTransaction,
  fromMs,
  keysetPage,
  toMs,
  type CursorInput,
  type Page,
} from "./shared.js";

export interface ConversationRepository {
  insertConversation(conversation: Conversation): void;
  getConversation(projectId: string, conversationId: string): Conversation | undefined;
  listByProject(projectId: string, input: CursorInput): Page<Conversation>;
  /** Writes the message and its context_refs rows in one transaction. */
  insertMessage(message: ConversationMessage): void;
  getMessage(projectId: string, messageId: string): ConversationMessage | undefined;
  listMessages(
    projectId: string,
    conversationId: string,
    input: CursorInput,
  ): Page<ConversationMessage>;
  setMessageStatus(projectId: string, messageId: string, status: MessageStatus): void;
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

    getConversation(projectId, conversationId) {
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
         FROM conversations WHERE conversation_id = ? AND project_id = ?`,
        conversationId,
        projectId,
      );
      return row ? assembleConversation(row) : undefined;
    },

    listByProject(projectId, input) {
      const page = keysetPage<{
        conversation_id: string;
        project_id: string;
        task_id: string | null;
        type: string;
        status: string;
        created_at: number;
        updated_at: number;
        data: string;
      }>(tx, {
        table: "conversations",
        columns: "conversation_id, project_id, task_id, type, status, created_at, updated_at, data",
        keyColumn: "created_at",
        idColumn: "conversation_id",
        projectColumn: "project_id",
        projectId,
        cursor: input.cursor,
        limit: input.limit,
      });
      return { items: page.items.map(assembleConversation), nextCursor: page.nextCursor };
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

    getMessage(projectId, messageId) {
      // conversation_messages carries no project column of its own: the
      // project is pinned through the owning conversation.
      const row = tx.get<{
        message_id: string;
        conversation_id: string;
        role: string;
        body: string | null;
        status: string;
        created_at: number;
        data: string;
      }>(
        `SELECT m.message_id, m.conversation_id, m.role, m.body, m.status, m.created_at, m.data
         FROM conversation_messages m
         JOIN conversations c ON c.conversation_id = m.conversation_id
         WHERE m.message_id = ? AND c.project_id = ?`,
        messageId,
        projectId,
      );
      if (!row) return undefined;
      const refs = tx.all<{ ref_type: string; ref_id: string; resolution_status: string; data: string }>(
        "SELECT ref_type, ref_id, resolution_status, data FROM context_refs WHERE conversation_message_id = ?",
        messageId,
      );
      return assembleMessage(row, refs);
    },

    listMessages(projectId, conversationId, input) {
      const page = keysetPage<{
        message_id: string;
        conversation_id: string;
        role: string;
        body: string | null;
        status: string;
        created_at: number;
        data: string;
      }>(tx, {
        table: "conversation_messages m JOIN conversations c ON c.conversation_id = m.conversation_id",
        columns: "m.message_id, m.conversation_id, m.role, m.body, m.status, m.created_at, m.data",
        keyColumn: "m.created_at",
        idColumn: "m.message_id",
        projectColumn: "c.project_id",
        projectId,
        cursor: input.cursor,
        limit: input.limit,
        extraWhere: "m.conversation_id = ?",
        extraParams: [conversationId],
      });
      return {
        items: page.items.map((row) => {
          const refs = tx.all<{ ref_type: string; ref_id: string; resolution_status: string; data: string }>(
            "SELECT ref_type, ref_id, resolution_status, data FROM context_refs WHERE conversation_message_id = ?",
            row.message_id,
          );
          return assembleMessage(row, refs);
        }),
        nextCursor: page.nextCursor,
      };
    },

    setMessageStatus(projectId, messageId, status) {
      assertInTransaction(tx);
      const result = tx.run(
        `UPDATE conversation_messages SET status = ?
         WHERE message_id = ?
           AND EXISTS (
             SELECT 1 FROM conversations c
             WHERE c.conversation_id = conversation_messages.conversation_id
               AND c.project_id = ?)`,
        status,
        messageId,
        projectId,
      );
      if (Number(result.changes) === 0) {
        throw new SestinaError(SestinaErrorCode.internal_error, "Conversation message not found");
      }
    },
  };
}
