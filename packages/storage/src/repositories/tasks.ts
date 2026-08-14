import {
  TaskSchema,
  SestinaErrorCode,
  SestinaError,
  type Task,
} from "@sestina/schema";
import type { StorageTransaction } from "../transaction.js";
import { validateJson } from "../schema-check.js";
import {
  assertInTransaction,
  fromMs,
  toMs,
  keysetPage,
  type CursorInput,
  type Page,
} from "./shared.js";

export interface TaskRepository {
  insert(task: Task): void;
  get(projectId: string, taskId: string): Task | undefined;
  listByProject(projectId: string, input: CursorInput): Page<Task>;
  update(task: Task): void;
}

interface TaskRow {
  task_id: string;
  project_id: string;
  status: string;
  created_at: number;
  updated_at: number;
  data: string;
};

function assembleTask(row: TaskRow): Task {
  const data = JSON.parse(row.data) as Task;
  return TaskSchema.parse({
    ...data,
    taskId: row.task_id,
    projectId: row.project_id,
    status: row.status,
    createdAt: fromMs(row.created_at),
    updatedAt: fromMs(row.updated_at),
  });
}

export function createTaskRepository(tx: StorageTransaction): TaskRepository {
  return {
    insert(task) {
      assertInTransaction(tx);
      tx.run(
        "INSERT INTO tasks (task_id, project_id, status, created_at, updated_at, data) VALUES (?, ?, ?, ?, ?, ?)",
        task.taskId,
        task.projectId,
        task.status,
        toMs(task.createdAt),
        toMs(task.updatedAt),
        validateJson(TaskSchema, task, "Task"),
      );
    },

    get(projectId, taskId) {
      const row = tx.get<TaskRow>(
        "SELECT task_id, project_id, status, created_at, updated_at, data FROM tasks WHERE task_id = ? AND project_id = ?",
        taskId,
        projectId,
      );
      return row ? assembleTask(row) : undefined;
    },

    listByProject(projectId, input) {
      const page = keysetPage<TaskRow>(tx, {
        table: "tasks",
        columns: "task_id, project_id, status, created_at, updated_at, data",
        keyColumn: "created_at",
        idColumn: "task_id",
        projectColumn: "project_id",
        projectId,
        cursor: input.cursor,
        limit: input.limit,
      });
      return { items: page.items.map(assembleTask), nextCursor: page.nextCursor };
    },

    update(task) {
      assertInTransaction(tx);
      const result = tx.run(
        "UPDATE tasks SET status = ?, updated_at = ?, data = ? WHERE task_id = ?",
        task.status,
        toMs(task.updatedAt),
        validateJson(TaskSchema, task, "Task"),
        task.taskId,
      );
      if (Number(result.changes) === 0) {
        throw new SestinaError(SestinaErrorCode.task_not_found, "Task not found");
      }
    },
  };
}
