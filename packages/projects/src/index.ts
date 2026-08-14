import {
  SestinaError,
  SestinaErrorCode,
  type Host,
  type HostSession,
  type HostVisibilityLevel,
  type SestinaProject,
  type UnownedActivityReason,
} from "@sestina/schema";
import { createUnitOfWork, type StorageDatabase } from "@sestina/storage";
import { createProjectDiscovery } from "./discovery.js";
import { createHostSessionService } from "./session-service.js";

export * from "./project-identity.js";
export * from "./root-bindings.js";
export * from "./project-service.js";
export * from "./task-service.js";
export * from "./session-service.js";
export * from "./collaboration-endpoints.js";
export * from "./attach.js";
export * from "./discovery.js";
export * from "./search-scope.js";

// ── Event routing pipeline (docs/30 §10) ──
// Routes a host event context to a project: an existing session resolves
// through its natural (host, hostSessionId) key; otherwise the root path
// drives discovery, which may attach, create a shell session, or report
// ambiguity. Unresolvable contexts queue as unowned activity with the exact
// raw event retained for re-normalization — the queue, not a guess.

export interface ResolveEventContext {
  host: Host;
  hostSessionId: string;
  rootPath?: string;
  rawEvent?: string;
  occurredAt?: string;
  gitRemote?: string;
  visibilityLevel?: HostVisibilityLevel;
  capabilities?: string[];
}

export type ResolveProjectResult =
  | {
      kind: "resolved";
      project: SestinaProject;
      hostSession: HostSession;
      taskResolution: "attached" | "created_shell" | "ambiguous";
      attachedTaskId?: string;
      candidateTaskIds?: string[];
    }
  | { kind: "unowned"; reason: UnownedActivityReason; unownedId?: string };

export async function resolveProjectAndTask(
  db: StorageDatabase,
  context: ResolveEventContext,
): Promise<ResolveProjectResult> {
  const uow = createUnitOfWork(db);
  const existing = uow.sessions.getByHostSessionId(context.host, context.hostSessionId);
  if (existing) {
    const project = uow.projects.get(existing.projectId);
    if (!project) {
      throw new SestinaError(
        SestinaErrorCode.internal_error,
        "Session references a missing project",
      );
    }
    const attachment = uow.sessionAttachments.current(existing.projectId, existing.sessionId);
    const attachedTaskId = attachment?.taskId ?? existing.taskId;
    if (attachedTaskId !== undefined) {
      return {
        kind: "resolved",
        project,
        hostSession: existing,
        taskResolution: "attached",
        attachedTaskId,
      };
    }
    return {
      kind: "resolved",
      project,
      hostSession: existing,
      taskResolution: "created_shell",
    };
  }

  const discovery = createProjectDiscovery(db);
  const sessions = createHostSessionService(db);

  const unowned = (reason: UnownedActivityReason): ResolveProjectResult => {
    if (context.rawEvent === undefined) {
      return { kind: "unowned", reason };
    }
    const activity = discovery.enqueueUnowned({
      host: context.host,
      hostSessionId: context.hostSessionId,
      occurredAt: context.occurredAt ?? new Date().toISOString(),
      reason,
      rawEvent: context.rawEvent,
    });
    return { kind: "unowned", reason, unownedId: activity.unownedId };
  };

  if (context.rootPath === undefined) {
    return unowned("no_project");
  }

  const discovered = await discovery.discover(context.rootPath, {
    gitRemote: context.gitRemote,
  });
  if (discovered.kind === "needs_confirmation") {
    return unowned("ambiguous_binding");
  }
  if (discovered.kind === "attached" && discovered.project.status === "archived") {
    // Archived projects do not accept new sessions: the root is bound but
    // unusable until a human decides (docs/30 §6/§10).
    return unowned("root_conflict");
  }

  const resolution = await sessions.resolveOnStart({
    host: context.host,
    hostSessionId: context.hostSessionId,
    projectId: discovered.project.projectId,
    visibilityLevel: context.visibilityLevel ?? "tool_lifecycle",
    capabilities: context.capabilities ?? [],
    startedAt: context.occurredAt ?? new Date().toISOString(),
  });
  if (resolution.kind === "existing") {
    // Unreachable in practice (checked above); defensively re-resolve.
    return {
      kind: "resolved",
      project: resolution.project,
      hostSession: resolution.hostSession,
      taskResolution: "attached",
      attachedTaskId: resolution.hostSession.taskId,
    };
  }
  return {
    kind: "resolved",
    project: resolution.project,
    hostSession: resolution.hostSession,
    taskResolution: resolution.taskResolution,
    attachedTaskId:
      resolution.kind === "attached" ? resolution.attachedTaskId : undefined,
    candidateTaskIds:
      resolution.kind === "ambiguous" ? resolution.candidateTaskIds : undefined,
  };
}
