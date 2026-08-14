import {
  generateId,
  ProjectIdSchema,
  SessionIdSchema,
  SestinaError,
  SestinaErrorCode,
  TaskIdSchema,
  type Decision,
  type Host,
  type HostSession,
  type HostSessionStatus,
  type HostVisibilityLevel,
  type ReviewItem,
  type SestinaProject,
} from "@sestina/schema";
import { hostSessionIdentity } from "@sestina/events";
import {
  createUnitOfWork,
  type CursorInput,
  type HostSessionRecord,
  type Page,
  type StorageDatabase,
} from "@sestina/storage";
import { buildAttachmentAssociationEvent } from "./attach.js";

// ── Host session service (docs/22 Task 8 Step 1, docs/30 §5) ──
// One host session maps to exactly one Sestina session id (the canonical
// derivation from @sestina/events — nobody re-derives their own template).
// On start: an existing session re-resolves idempotently; otherwise exactly
// one active task auto-attaches, more than one stays unattached with the
// candidates listed for human review, and zero creates an unattached shell
// session. UI-driven attach changes preview the consequences (contract
// switch, incomplete items, open reviews, pending decisions) and append an
// association event.

export interface ResolveOnStartInput {
  host: Host;
  hostSessionId: string;
  projectId: string;
  visibilityLevel: HostVisibilityLevel;
  capabilities: string[];
  startedAt: string;
  status?: HostSessionStatus;
}

export type ResolveOnStartResult =
  | { kind: "existing"; project: SestinaProject; hostSession: HostSessionRecord; taskResolution: "existing" }
  | {
      kind: "attached";
      project: SestinaProject;
      hostSession: HostSessionRecord;
      taskResolution: "attached";
      attachedTaskId: string;
    }
  | {
      kind: "ambiguous";
      project: SestinaProject;
      hostSession: HostSessionRecord;
      taskResolution: "ambiguous";
      attachedTaskId: undefined;
      candidateTaskIds: string[];
    }
  | {
      kind: "created_shell";
      project: SestinaProject;
      hostSession: HostSessionRecord;
      taskResolution: "created_shell";
    };

export interface AttachOptions {
  expectedTaskId?: string | null;
  reason?: string;
  occurredAt?: string;
}

export interface AttachPreview {
  currentTaskId?: string;
  targetTaskId: string;
  contractChange: boolean;
  incompleteDeliverables: number;
  openReviews: ReviewItem[];
  pendingDecisions: Decision[];
}

export interface HostSessionService {
  resolveOnStart(input: ResolveOnStartInput): Promise<ResolveOnStartResult>;
  attach(
    projectId: string,
    sessionId: string,
    taskId: string,
    opts?: AttachOptions,
  ): Promise<void>;
  detach(projectId: string, sessionId: string, opts?: AttachOptions): Promise<void>;
  previewAttach(projectId: string, sessionId: string, taskId: string): Promise<AttachPreview>;
  getSession(projectId: string, sessionId: string): HostSessionRecord | undefined;
  listByProject(projectId: string, input: CursorInput): Page<HostSessionRecord>;
  listByTask(projectId: string, taskId: string, input: CursorInput): Page<HostSessionRecord>;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function createHostSessionService(db: StorageDatabase): HostSessionService {
  const uow = createUnitOfWork(db);

  function requireProject(projectId: string): SestinaProject {
    const project = uow.projects.get(projectId);
    if (!project) {
      throw new SestinaError(SestinaErrorCode.project_not_found, "Project not found");
    }
    return project;
  }

  return {
    async resolveOnStart(input) {
      const existing = uow.sessions.getByHostSessionId(input.host, input.hostSessionId);
      if (existing) {
        const project = requireProject(existing.projectId);
        return {
          kind: "existing",
          project,
          hostSession: existing,
          taskResolution: "existing",
        };
      }
      const project = requireProject(input.projectId);
      if (project.status === "archived") {
        throw new SestinaError(
          SestinaErrorCode.validation_failed,
          "Archived projects do not accept new host sessions",
        );
      }
      const sessionId = await hostSessionIdentity(input.host, input.hostSessionId);
      const activeTasks = uow.tasks
        .listByProject(input.projectId, { limit: 500 })
        .items.filter((t) => t.status === "active");

      const session: HostSession = {
        sessionId,
        taskId: activeTasks.length === 1 ? activeTasks[0]?.taskId : undefined,
        host: input.host,
        hostSessionId: input.hostSessionId,
        visibilityLevel: input.visibilityLevel,
        status: input.status ?? "connected",
        capabilities: input.capabilities,
        startedAt: input.startedAt,
      };
      uow.commit((u) => {
        u.sessions.insert(input.projectId, session);
        if (activeTasks.length === 1 && activeTasks[0]) {
          const taskId = activeTasks[0].taskId;
          u.sessionAttachments.insert({
            attachmentId: generateId(),
            sessionId,
            projectId: ProjectIdSchema.parse(input.projectId),
            taskId,
            attachedAt: input.startedAt,
          });
          u.events.appendAssociation(
            buildAttachmentAssociationEvent({
              host: input.host,
              projectId: input.projectId,
              taskId,
              sessionId,
              action: "attach",
              occurredAt: input.startedAt,
              reason: "auto-attached: exactly one active task",
            }),
          );
        }
      });
      const record = uow.sessions.get(input.projectId, sessionId);
      if (!record) {
        throw new SestinaError(SestinaErrorCode.internal_error, "Session was not persisted");
      }
      if (activeTasks.length === 1) {
        const taskId = activeTasks[0]?.taskId ?? "";
        return { kind: "attached", project, hostSession: record, taskResolution: "attached", attachedTaskId: taskId };
      }
      if (activeTasks.length > 1) {
        return {
          kind: "ambiguous",
          project,
          hostSession: record,
          taskResolution: "ambiguous",
          attachedTaskId: undefined,
          candidateTaskIds: activeTasks.map((t) => t.taskId),
        };
      }
      return { kind: "created_shell", project, hostSession: record, taskResolution: "created_shell" };
    },

    // eslint-disable-next-line @typescript-eslint/require-await
    async attach(projectId, sessionId, taskId, opts = {}) {
      const session = uow.sessions.get(projectId, sessionId);
      if (!session) {
        throw new SestinaError(SestinaErrorCode.session_not_found, "Session not found");
      }
      const task = uow.tasks.get(projectId, taskId);
      if (!task) {
        throw new SestinaError(SestinaErrorCode.task_not_found, "Task not found");
      }
      const at = opts.occurredAt ?? nowIso();
      const event = buildAttachmentAssociationEvent({
        host: session.host,
        projectId,
        taskId,
        sessionId,
        action: "attach",
        occurredAt: at,
        reason: opts.reason,
      });
      uow.commit((u) => {
        // The CAS runs first: a stale expectation rolls the whole unit back.
        u.sessions.attach(projectId, sessionId, taskId, { expectedTaskId: opts.expectedTaskId });
        const current = u.sessionAttachments.current(projectId, sessionId);
        if (current) {
          u.sessionAttachments.detach(projectId, sessionId, at, opts.reason);
        }
        u.sessionAttachments.insert({
          attachmentId: generateId(),
          sessionId: SessionIdSchema.parse(sessionId),
          projectId: ProjectIdSchema.parse(projectId),
          taskId: TaskIdSchema.parse(taskId),
          attachedAt: at,
        });
        u.events.appendAssociation(event);
      });
    },

    // eslint-disable-next-line @typescript-eslint/require-await
    async detach(projectId, sessionId, opts = {}) {
      const session = uow.sessions.get(projectId, sessionId);
      if (!session) {
        throw new SestinaError(SestinaErrorCode.session_not_found, "Session not found");
      }
      const current = uow.sessionAttachments.current(projectId, sessionId);
      if (!current) {
        throw new SestinaError(
          SestinaErrorCode.validation_failed,
          "Session is not attached to a task",
        );
      }
      if (opts.expectedTaskId !== undefined && opts.expectedTaskId !== current.taskId) {
        throw new SestinaError(
          SestinaErrorCode.stale_state,
          "Session attachment changed since the detach was requested",
        );
      }
      const at = opts.occurredAt ?? nowIso();
      const event = buildAttachmentAssociationEvent({
        host: session.host,
        projectId,
        taskId: current.taskId,
        sessionId,
        action: "detach",
        occurredAt: at,
        reason: opts.reason,
      });
      uow.commit((u) => {
        u.sessions.attach(projectId, sessionId, null, { expectedTaskId: current.taskId });
        u.sessionAttachments.detach(projectId, sessionId, at, opts.reason);
        u.events.appendAssociation(event);
      });
    },

    // eslint-disable-next-line @typescript-eslint/require-await
    async previewAttach(projectId, sessionId, taskId) {
      const session = uow.sessions.get(projectId, sessionId);
      if (!session) {
        throw new SestinaError(SestinaErrorCode.session_not_found, "Session not found");
      }
      const target = uow.tasks.get(projectId, taskId);
      if (!target) {
        throw new SestinaError(SestinaErrorCode.task_not_found, "Task not found");
      }
      const currentAttachment = uow.sessionAttachments.current(projectId, sessionId);
      // Auto-attached sessions carry their task on the session row too; the
      // attachment history is authoritative when present, the row is the
      // fallback for sessions created before attachment history existed.
      const currentTaskId = currentAttachment?.taskId ?? session.taskId;
      const currentContract = currentTaskId
        ? uow.contracts.getCurrentByTask(projectId, currentTaskId)
        : undefined;
      const targetContract = uow.contracts.getCurrentByTask(projectId, taskId);
      const openReviews = uow.reviews
        .listByProject(projectId, { limit: 500 })
        .items.filter((r) => r.taskId === taskId && r.status === "open");
      const pendingDecisions = uow.decisions
        .listByTask(projectId, taskId, { limit: 500 })
        .items.filter((d) => d.userDecisionNeeded);
      return {
        currentTaskId,
        targetTaskId: taskId,
        contractChange:
          targetContract !== undefined && targetContract.contractId !== currentContract?.contractId,
        incompleteDeliverables: targetContract
          ? targetContract.deliverables.filter(
              (d) => d.status !== "satisfied" && d.status !== "waived",
            ).length
          : 0,
        openReviews,
        pendingDecisions,
      };
    },

    getSession(projectId, sessionId) {
      return uow.sessions.get(projectId, sessionId);
    },

    listByProject(projectId, input) {
      return uow.sessions.listByProject(projectId, input);
    },

    listByTask(projectId, taskId, input) {
      return uow.sessions.listByTask(projectId, taskId, input);
    },
  };
}
