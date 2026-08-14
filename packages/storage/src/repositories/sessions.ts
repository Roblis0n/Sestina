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
  assertValidProjectId,
  fromMs,
  keysetPage,
  toMs,
  type CursorInput,
  type Page,
} from "./shared.js";

/**
 * A host session read back with its owning project (docs/30 §5). The
 * project is derived at write time from the attached task, but sessions may
 * be unattached (migration 009 made task_id nullable), so reads must carry
 * the project column explicitly.
 */
export interface HostSessionRecord extends HostSession {
  projectId: string;
}

export interface HostSessionRepository {
  /**
   * Project-fenced insert (docs/22 Task 6/8): a session whose taskId points
   * at a task in another project fails with task_not_found, exactly like a
   * missing task — no existence leak. A session without a taskId is stored
   * unattached (docs/30 §5 "未关联会话").
   */
  insert(projectId: string, session: HostSession): void;
  get(projectId: string, sessionId: string): HostSessionRecord | undefined;
  getByHostSessionId(host: string, hostSessionId: string): HostSessionRecord | undefined;
  listByProject(projectId: string, input: CursorInput): Page<HostSessionRecord>;
  listByTask(projectId: string, taskId: string, input: CursorInput): Page<HostSessionRecord>;
  /**
   * Compare-and-swap on the current task attachment (docs/30 §5): when
   * expectedTaskId is given and no longer matches, the attach fails with
   * stale_state; a non-null task outside the project fails with
   * task_not_found.
   */
  attach(
    projectId: string,
    sessionId: string,
    taskId: string | null,
    opts?: { expectedTaskId?: string | null },
  ): void;
  update(projectId: string, session: HostSession): void;
}

interface SessionRow {
  session_id: string;
  project_id: string;
  task_id: string | null;
  host: string;
  host_session_id: string;
  status: string;
  started_at: number;
  data: string;
};

function assembleSession(row: SessionRow): HostSessionRecord {
  const data = JSON.parse(row.data) as HostSession;
  return {
    ...HostSessionSchema.parse({
      ...data,
      sessionId: row.session_id,
      taskId: row.task_id ?? undefined,
      host: row.host,
      hostSessionId: row.host_session_id,
      status: row.status,
      startedAt: fromMs(row.started_at),
    }),
    projectId: row.project_id,
  };
}

export function createSessionRepository(tx: StorageTransaction): HostSessionRepository {
  return {
    insert(projectId, session) {
      assertInTransaction(tx);
      assertValidProjectId(projectId);
      // The task must exist in this project (project fence): the session's
      // owning project is derived here and never supplied by the caller.
      if (session.taskId !== undefined) {
        const task = tx.get<{ project_id: string }>(
          "SELECT project_id FROM tasks WHERE task_id = ? AND project_id = ?",
          session.taskId,
          projectId,
        );
        if (!task) {
          throw new SestinaError(SestinaErrorCode.task_not_found, "Task not found");
        }
      }
      tx.run(
        `INSERT INTO host_sessions (session_id, project_id, task_id, host, host_session_id, status, started_at, data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        session.sessionId,
        projectId,
        session.taskId ?? null,
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

    getByHostSessionId(host, hostSessionId) {
      const row = tx.get<SessionRow>(
        "SELECT session_id, project_id, task_id, host, host_session_id, status, started_at, data FROM host_sessions WHERE host = ? AND host_session_id = ?",
        host,
        hostSessionId,
      );
      return row ? assembleSession(row) : undefined;
    },

    listByProject(projectId, input) {
      const page = keysetPage<SessionRow>(tx, {
        table: "host_sessions",
        columns: "session_id, project_id, task_id, host, host_session_id, status, started_at, data",
        keyColumn: "started_at",
        idColumn: "session_id",
        projectColumn: "project_id",
        projectId,
        cursor: input.cursor,
        limit: input.limit,
      });
      return { items: page.items.map(assembleSession), nextCursor: page.nextCursor };
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

    attach(projectId, sessionId, taskId, opts) {
      assertInTransaction(tx);
      assertValidProjectId(projectId);
      const current = tx.get<{ task_id: string | null }>(
        "SELECT task_id FROM host_sessions WHERE session_id = ? AND project_id = ?",
        sessionId,
        projectId,
      );
      if (!current) {
        throw new SestinaError(SestinaErrorCode.session_not_found, "Host session not found");
      }
      if (opts?.expectedTaskId !== undefined && current.task_id !== opts.expectedTaskId) {
        throw new SestinaError(SestinaErrorCode.stale_state, "Session attachment changed");
      }
      if (taskId !== null) {
        const task = tx.get<{ project_id: string }>(
          "SELECT project_id FROM tasks WHERE task_id = ? AND project_id = ?",
          taskId,
          projectId,
        );
        if (!task) {
          throw new SestinaError(SestinaErrorCode.task_not_found, "Task not found");
        }
      }
      tx.run(
        "UPDATE host_sessions SET task_id = ? WHERE session_id = ? AND project_id = ?",
        taskId,
        sessionId,
        projectId,
      );
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
