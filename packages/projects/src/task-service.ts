import {
  generateId,
  ProjectIdSchema,
  SestinaError,
  SestinaErrorCode,
  TaskIdSchema,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from "@sestina/schema";
import {
  createUnitOfWork,
  type CursorInput,
  type Page,
  type StorageDatabase,
} from "@sestina/storage";

// ── Task lifecycle service (docs/22 Task 8 Step 4, docs/30 §6) ──
// The status machine: draft → active|cancelled|archived;
// active → blocked|completed|cancelled|archived; blocked →
// active|cancelled|archived; completed|cancelled reopen to active by
// creating a NEW contract version with the reason recorded on that version
// (the original completion history is never rewritten); archived restores to
// active without inventing contract versions. A read-only database browses
// but never transitions (the storage layer enforces database_readonly).

export interface CreateTaskInput {
  title: string;
  priority?: TaskPriority;
  status?: TaskStatus;
}

export interface TransitionInput {
  taskId: string;
  to: TaskStatus;
  reason?: string;
  expectedStatus?: TaskStatus;
}

const ALLOWED: Record<TaskStatus, readonly TaskStatus[]> = {
  draft: ["active", "cancelled", "archived"],
  active: ["blocked", "completed", "cancelled", "archived"],
  blocked: ["active", "cancelled", "archived"],
  completed: ["active"],
  cancelled: ["active"],
  archived: ["active"],
};

export interface TaskService {
  createTask(projectId: string, input: CreateTaskInput): Task;
  getTask(projectId: string, taskId: string): Task | undefined;
  listTasks(projectId: string, input: CursorInput): Page<Task>;
  transition(projectId: string, input: TransitionInput): Task;
  setPriority(projectId: string, taskId: string, priority: TaskPriority): Task;
}

export function createTaskService(db: StorageDatabase): TaskService {
  const uow = createUnitOfWork(db);

  return {
    createTask(projectId, input) {
      const at = new Date().toISOString();
      const task: Task = {
        // Branded ids via runtime-validated parse (same idiom as the
        // events package's hostSessionIdentity).
        taskId: TaskIdSchema.parse(generateId()),
        projectId: ProjectIdSchema.parse(projectId),
        title: input.title,
        status: input.status ?? "draft",
        priority: input.priority ?? "normal",
        createdAt: at,
        updatedAt: at,
      };
      uow.commit((u) => {
        u.tasks.insert(task);
      });
      return task;
    },

    getTask(projectId, taskId) {
      return uow.tasks.get(projectId, taskId);
    },

    listTasks(projectId, input) {
      return uow.tasks.listByProject(projectId, input);
    },

    transition(projectId, input) {
      const current = uow.tasks.get(projectId, input.taskId);
      if (!current) {
        throw new SestinaError(SestinaErrorCode.task_not_found, "Task not found");
      }
      if (input.expectedStatus !== undefined && input.expectedStatus !== current.status) {
        throw new SestinaError(
          SestinaErrorCode.stale_state,
          "Task status changed since the transition was requested",
        );
      }
      if (input.to === current.status) {
        throw new SestinaError(SestinaErrorCode.validation_failed, "Task is already in that status");
      }
      if (!ALLOWED[current.status].includes(input.to)) {
        throw new SestinaError(
          SestinaErrorCode.validation_failed,
          `Cannot transition a task from ${current.status} to ${input.to}`,
        );
      }
      const at = new Date().toISOString();

      // Reopening a completed/cancelled task versions the contract and
      // records the reason (docs/30 §6); without a contract there is no
      // history to continue.
      if (current.status === "completed" || current.status === "cancelled") {
        const contract = uow.contracts.getCurrentByTask(projectId, current.taskId);
        if (!contract) {
          throw new SestinaError(
            SestinaErrorCode.validation_failed,
            "Reopening requires a current contract",
          );
        }
        const reopened = {
          ...contract,
          version: contract.version + 1,
          status: "active" as const,
          createdAt: at,
          updatedAt: at,
        };
        const updated = { ...current, status: "active" as const, updatedAt: at };
        uow.commit((u) => {
          u.contracts.addVersion(projectId, reopened, contract.version, input.reason);
          u.tasks.update(projectId, updated);
        });
        return updated;
      }

      const updated = { ...current, status: input.to, updatedAt: at };
      uow.commit((u) => {
        u.tasks.update(projectId, updated);
      });
      return updated;
    },

    setPriority(projectId, taskId, priority) {
      const current = uow.tasks.get(projectId, taskId);
      if (!current) {
        throw new SestinaError(SestinaErrorCode.task_not_found, "Task not found");
      }
      const updated = { ...current, priority, updatedAt: new Date().toISOString() };
      uow.commit((u) => {
        u.tasks.update(projectId, updated);
      });
      return updated;
    },
  };
}
