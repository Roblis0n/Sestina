import {
  CollaborationEndpointIdSchema,
  CollaborationHostSchema,
  ProjectIdSchema,
  SestinaError,
  SestinaErrorCode,
  TaskIdSchema,
  type CollaborationCapability,
  type CollaborationEndpoint,
  type CollaborationInboundPolicy,
  type Host,
} from "@sestina/schema";
import { deriveDeterministicId, hostIdentityInput } from "@sestina/events";
import { createUnitOfWork, type StorageDatabase } from "@sestina/storage";

// ── Collaboration endpoint service (docs/22 Task 8 invariant, docs/30 §8) ──
// An endpoint may only bind to a confirmed session of the same project and
// task: the (host, hostSessionId) pair must map to an existing session whose
// active attachment row is the requested task. Endpoint ids derive
// deterministically from the host session identity, so re-registration is an
// idempotent handshake update. Capability changes come from the handshake
// and race through compare-and-swap on the previous capability.

export interface RegisterEndpointInput {
  host: Host;
  hostSessionId: string;
  projectId: string;
  taskId: string;
  capability: CollaborationCapability;
  transportIds?: string[];
  inboundPolicy?: CollaborationInboundPolicy;
  at?: string;
}

export interface CollaborationEndpointService {
  register(input: RegisterEndpointInput): Promise<CollaborationEndpoint>;
  onHandshake(
    projectId: string,
    endpointId: string,
    capability: CollaborationCapability,
    opts?: { expectedCapability?: CollaborationCapability; at?: string },
  ): void;
  get(projectId: string, endpointId: string): CollaborationEndpoint | undefined;
  listForTask(projectId: string, taskId: string): CollaborationEndpoint[];
  setInboundPolicy(
    projectId: string,
    endpointId: string,
    policy: CollaborationInboundPolicy,
    opts?: { expectedCapability?: CollaborationCapability },
  ): void;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function createCollaborationEndpointService(
  db: StorageDatabase,
): CollaborationEndpointService {
  const uow = createUnitOfWork(db);

  return {
    async register(input) {
      // Endpoints only exist between the two agent hosts (schema constraint);
      // other host kinds fail as a SestinaError, never a raw ZodError.
      const endpointHost = CollaborationHostSchema.safeParse(input.host);
      if (!endpointHost.success) {
        throw new SestinaError(
          SestinaErrorCode.validation_failed,
          "Collaboration endpoints only support codex and claude_code hosts",
        );
      }
      const session = uow.sessions.getByHostSessionId(input.host, input.hostSessionId);
      if (session?.projectId !== input.projectId) {
        throw new SestinaError(
          SestinaErrorCode.validation_failed,
          "Endpoint requires an existing session of this project",
        );
      }
      const attachment = uow.sessionAttachments.current(input.projectId, session.sessionId);
      if (attachment?.taskId !== input.taskId) {
        throw new SestinaError(
          SestinaErrorCode.validation_failed,
          "Endpoint requires a confirmed session attached to the task",
        );
      }
      const endpointId = await deriveDeterministicId(
        "endpoint",
        hostIdentityInput(input.host, input.hostSessionId),
      );
      const existing = uow.collaboration
        .listEndpoints(input.projectId)
        .find((e) => e.endpointId === endpointId);
      if (existing && existing.taskId !== input.taskId) {
        throw new SestinaError(
          SestinaErrorCode.validation_failed,
          "Endpoint is already bound to a different task",
        );
      }
      const at = input.at ?? nowIso();
      if (existing) {
        const updated: CollaborationEndpoint = {
          ...existing,
          capability: input.capability,
          transportIds: input.transportIds ?? existing.transportIds,
          inboundPolicy: input.inboundPolicy ?? existing.inboundPolicy,
          connected: true,
          lastSeenAt: at,
        };
        uow.commit((u) => {
          u.collaboration.updateEndpoint(input.projectId, updated, {
            expectedCapability: existing.capability,
          });
        });
        return updated;
      }
      const endpoint: CollaborationEndpoint = {
        endpointId: CollaborationEndpointIdSchema.parse(endpointId),
        projectId: ProjectIdSchema.parse(input.projectId),
        taskId: TaskIdSchema.parse(input.taskId),
        host: endpointHost.data,
        hostSessionId: input.hostSessionId,
        capability: input.capability,
        transportIds: input.transportIds ?? [],
        inboundPolicy: input.inboundPolicy ?? "accept",
        connected: true,
        lastSeenAt: at,
      };
      uow.commit((u) => {
        u.collaboration.insertEndpoint(endpoint);
      });
      return endpoint;
    },

    onHandshake(projectId, endpointId, capability, opts) {
      const endpoint = uow.collaboration
        .listEndpoints(projectId)
        .find((e) => e.endpointId === endpointId);
      if (!endpoint) {
        throw new SestinaError(
          SestinaErrorCode.collaboration_endpoint_not_found,
          "Collaboration endpoint not found",
        );
      }
      const updated: CollaborationEndpoint = {
        ...endpoint,
        capability,
        connected: true,
        lastSeenAt: opts?.at ?? nowIso(),
      };
      uow.commit((u) => {
        u.collaboration.updateEndpoint(projectId, updated, {
          expectedCapability: opts?.expectedCapability,
        });
      });
    },

    get(projectId, endpointId) {
      return uow.collaboration.listEndpoints(projectId).find((e) => e.endpointId === endpointId);
    },

    listForTask(projectId, taskId) {
      return uow.collaboration.listEndpoints(projectId, taskId);
    },

    setInboundPolicy(projectId, endpointId, policy, opts) {
      const endpoint = uow.collaboration
        .listEndpoints(projectId)
        .find((e) => e.endpointId === endpointId);
      if (!endpoint) {
        throw new SestinaError(
          SestinaErrorCode.collaboration_endpoint_not_found,
          "Collaboration endpoint not found",
        );
      }
      const updated: CollaborationEndpoint = { ...endpoint, inboundPolicy: policy };
      uow.commit((u) => {
        u.collaboration.updateEndpoint(projectId, updated, {
          expectedCapability: opts?.expectedCapability,
        });
      });
    },
  };
}
