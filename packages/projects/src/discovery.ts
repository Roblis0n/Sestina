import {
  generateId,
  ProjectIdSchema,
  type SestinaProject,
  type UnownedActivity,
  type UnownedActivityReason,
} from "@sestina/schema";
import {
  createUnitOfWork,
  sha256,
  type CursorInput,
  type Page,
  type StorageDatabase,
} from "@sestina/storage";
import {
  computeRootFingerprint,
  deriveProjectId,
  rootAlias,
  type RootFingerprint,
} from "./project-identity.js";
import { createRootBindingPort, type RootBindingPort } from "./root-bindings.js";

// ── Project discovery (docs/30 §4/§10) ──
// A host starting at a root resolves in this order: an active binding at the
// canonical root attaches directly; an active binding with the same identity
// fingerprint elsewhere (a moved root with a known git remote) asks for user
// confirmation; otherwise a discovered project is created from the directory
// name. Host events that cannot resolve a project wait in the unowned queue
// with their exact raw payload retained for re-normalization.

export type DiscoveryResult =
  | { kind: "attached"; project: SestinaProject }
  | { kind: "needs_confirmation"; candidates: SestinaProject[] }
  | { kind: "created"; project: SestinaProject };

export interface EnqueueUnownedInput {
  host: UnownedActivity["host"];
  hostSessionId: string;
  occurredAt: string;
  reason: UnownedActivityReason;
  rawEvent: string;
}

export interface ProjectDiscovery {
  discover(rootPath: string, opts?: { gitRemote?: string }): Promise<DiscoveryResult>;
  enqueueUnowned(input: EnqueueUnownedInput): UnownedActivity;
  listPending(input: CursorInput): Page<UnownedActivity>;
  resolve(unownedId: string, target: { projectId: string; taskId: string | null }): void;
}

export interface DiscoveryFingerprintPort {
  compute(rootPath: string, gitRemote?: string): RootFingerprint;
}

export function createProjectDiscovery(
  db: StorageDatabase,
  ports: { fingerprint?: DiscoveryFingerprintPort } = {},
): ProjectDiscovery {
  const uow = createUnitOfWork(db);
  const bindings: RootBindingPort = createRootBindingPort(db);
  // Adapt the port's string gitRemote to the options-object signature of the
  // pure-compute default (docs/22 "受注入的 realpath/Git fingerprint 端口").
  const fingerprint = ports.fingerprint ?? {
    compute: (rootPath, gitRemote) => computeRootFingerprint(rootPath, { gitRemote }),
  };

  return {
    async discover(rootPath, opts) {
      const fp = fingerprint.compute(rootPath, opts?.gitRemote);
      const atRoot = bindings
        .listAllByRootPath(fp.canonicalPath)
        .filter((b) => b.status === "active");
      if (atRoot.length > 0) {
        const projects = atRoot
          .map((b) => uow.projects.get(b.projectId))
          .filter((p): p is SestinaProject => p !== undefined);
        if (projects.length === 1 && projects[0]) {
          return { kind: "attached", project: projects[0] };
        }
        return { kind: "needs_confirmation", candidates: projects };
      }
      const candidates = bindings
        .findActiveByFingerprint(fp.fingerprint)
        .map((b) => uow.projects.get(b.projectId))
        .filter((p): p is SestinaProject => p !== undefined);
      if (candidates.length > 0) {
        return { kind: "needs_confirmation", candidates };
      }
      // Id from the path fingerprint (see createProject): the remote
      // fingerprint is for binding matching, not project identity.
      const projectId = ProjectIdSchema.parse(await deriveProjectId(fp.pathFingerprint));
      const at = new Date().toISOString();
      const project: SestinaProject = {
        projectId,
        name: rootAlias(fp.canonicalPath),
        bindings: [
          {
            rootPath: fp.canonicalPath,
            establishedAt: at,
            fingerprint: fp.fingerprint,
            source: "discovered",
            confirmed: false,
            caseSemantics: fp.caseSemantics,
          },
        ],
        status: "active",
        createdAt: at,
        updatedAt: at,
      };
      uow.commit((u) => {
        u.projects.insert(project);
      });
      return { kind: "created", project };
    },

    enqueueUnowned(input) {
      const activity: UnownedActivity = {
        unownedId: generateId(),
        host: input.host,
        hostSessionId: input.hostSessionId,
        occurredAt: input.occurredAt,
        reason: input.reason,
        rawEvent: input.rawEvent,
        payloadHash: sha256(input.rawEvent),
        createdAt: input.occurredAt,
      };
      uow.commit((u) => {
        u.unownedActivity.insert(activity);
      });
      return activity;
    },

    listPending(input) {
      return uow.unownedActivity.listPending(input);
    },

    resolve(unownedId, target) {
      uow.commit((u) => {
        u.unownedActivity.resolve(unownedId, target);
      });
    },
  };
}
