import {
  HostSessionSchema,
  SestinaErrorCode,
  SestinaError,
  type HostSession,
} from "@sestina/schema";
import type { StorageTransaction } from "../transaction.js";
import { validateJson } from "../schema-check.js";
import {
  assertCursorLimit,
  assertInTransaction,
  fromMs,
  toMs,
  type CursorInput,
  type Page,
} from "./shared.js";

export interface HostSessionRepository {
  insert(session: HostSession): void;
  get(sessionId: string): HostSession | undefined;
  listByTask(taskId: string, input: CursorInput): Page<HostSession>;
  update(session: HostSession): void;
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
}

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

    get(sessionId) {
      const row = tx.get<SessionRow>(
        "SELECT session_id, project_id, task_id, host, host_session_id, status, started_at, data FROM host_sessions WHERE session_id = ?",
        sessionId,
      );
      return row ? assembleSession(row) : undefined;
    },

    listByTask(taskId, input) {
      assertCursorLimit(input.limit);
      const rows = tx.all<SessionRow>(
        "SELECT session_id, project_id, task_id, host, host_session_id, status, started_at, data FROM host_sessions WHERE task_id = ? ORDER BY started_at, session_id LIMIT ?",
        taskId,
        input.limit,
      );
      return { items: rows.map(assembleSession) };
    },

    update(session) {
      assertInTransaction(tx);
      const result = tx.run(
        "UPDATE host_sessions SET status = ?, data = ? WHERE session_id = ?",
        session.status,
        validateJson(HostSessionSchema, session, "HostSession"),
        session.sessionId,
      );
      if (Number(result.changes) === 0) {
        throw new SestinaError(SestinaErrorCode.session_not_found, "Host session not found");
      }
    },
  };
}
