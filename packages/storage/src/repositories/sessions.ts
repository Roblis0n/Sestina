import {
  HostSessionSchema,
  SestinaErrorCode,
  SestinaError,
  type HostSession,
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

export interface HostSessionRepository {
  insert(session: HostSession): void;
  get(projectId: string, sessionId: string): HostSession | undefined;
  listByTask(projectId: string, taskId: string, input: CursorInput): Page<HostSession>;
  update(projectId: string, session: HostSession): void;
}

interface SessionRow {
  session_id: string;
  project_id: string;
  task_id: string;
  host: string;
  host_session_id: string;
  status: string;
  started_at: number;
  data: string;
};

function assembleSession(row: SessionRow): HostSession {
  const data = JSON.parse(row.data) as HostSession;
  return HostSessionSchema.parse({
    ...data,
    sessionId: row.session_id,
    taskId: row.task_id,
    host: row.host,
    hostSessionId: row.host_session_id,
    status: row.status,
    startedAt: fromMs(row.started_at),
  });
}

export function createSessionRepository(tx: StorageTransaction): HostSessionRepository {
  return {
    insert(session) {
      assertInTransaction(tx);
      // HostSession carries no projectId of its own: the project is derived
      // from the task the session is attached to (docs/09 §16).
      const task = tx.get<{ project_id: string }>(
        "SELECT project_id FROM tasks WHERE task_id = ?",
        session.taskId,
      );
      if (!task) {
        throw new SestinaError(SestinaErrorCode.task_not_found, "Task not found");
      }
      tx.run(
        `INSERT INTO host_sessions (session_id, project_id, task_id, host, host_session_id, status, started_at, data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        session.sessionId,
        task.project_id,
        session.taskId,
        session.host,
        session.hostSessionId,
        session.status,
        toMs(session.startedAt),
        validateJson(HostSessionSchema, session, "HostSession"),
      );
    },

    get(projectId, sessionId) {
      const row = tx.get<SessionRow>(
        "SELECT session_id, project_id, task_id, host, host_session_id, status, started_at, data FROM host_sessions WHERE session_id = ? AND project_id = ?",
        sessionId,
        projectId,
      );
      return row ? assembleSession(row) : undefined;
    },

    listByTask(projectId, taskId, input) {
      const page = keysetPage<SessionRow>(tx, {
        table: "host_sessions",
        columns: "session_id, project_id, task_id, host, host_session_id, status, started_at, data",
        keyColumn: "started_at",
        idColumn: "session_id",
        projectColumn: "project_id",
        projectId,
        cursor: input.cursor,
        limit: input.limit,
        extraWhere: "task_id = ?",
        extraParams: [taskId],
      });
      return { items: page.items.map(assembleSession), nextCursor: page.nextCursor };
    },

    update(projectId, session) {
      assertInTransaction(tx);
      const result = tx.run(
        "UPDATE host_sessions SET status = ?, data = ? WHERE session_id = ? AND project_id = ?",
        session.status,
        validateJson(HostSessionSchema, session, "HostSession"),
        session.sessionId,
        projectId,
      );
      if (Number(result.changes) === 0) {
        throw new SestinaError(SestinaErrorCode.session_not_found, "Host session not found");
      }
    },
  };
}
