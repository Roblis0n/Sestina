import {
  SestinaError,
  SestinaErrorCode,
  type ProjectRootBinding,
} from "@sestina/schema";
import {
  createUnitOfWork,
  type RootBindingRecord,
  type StorageDatabase,
} from "@sestina/storage";

// ── Root binding port (docs/30 §3/§4) ──
// The storage-side binding repository, lifted into a small port so the
// project services compose reads and writes without touching raw SQL.
// The database enforces the invariant that one root has at most one active
// binding (partial unique index from migration 001).

export interface RootBindingPort {
  addBinding(projectId: string, binding: ProjectRootBinding): void;
  confirmBinding(projectId: string, rootPath: string): void;
  archiveBinding(projectId: string, rootPath: string): void;
  restoreBinding(projectId: string, rootPath: string): void;
  listByProject(projectId: string): RootBindingRecord[];
  listAllByRootPath(rootPath: string): RootBindingRecord[];
  findActiveByFingerprint(fingerprint: string): RootBindingRecord[];
  /** Archives the old binding and inserts the new one as user-confirmed. */
  repointBinding(projectId: string, fromRootPath: string, to: ProjectRootBinding): void;
}

function toRecord(
  projectId: string,
  binding: ProjectRootBinding,
  status: "active" | "archived",
): RootBindingRecord {
  return {
    projectId,
    rootPath: binding.rootPath,
    label: binding.label,
    status,
    establishedAt: binding.establishedAt,
    fingerprint: binding.fingerprint,
    confirmed: binding.confirmed ?? false,
    source: binding.source ?? "discovered",
    caseSemantics: binding.caseSemantics,
  };
}

export function createRootBindingPort(db: StorageDatabase): RootBindingPort {
  const uow = createUnitOfWork(db);
  return {
    addBinding(projectId, binding) {
      uow.commit((u) => {
        u.rootBindings.insert(toRecord(projectId, binding, "active"));
      });
    },

    confirmBinding(projectId, rootPath) {
      uow.commit((u) => {
        u.rootBindings.confirm(projectId, rootPath);
      });
    },

    archiveBinding(projectId, rootPath) {
      uow.commit((u) => {
        u.rootBindings.setStatus(projectId, rootPath, "archived");
      });
    },

    restoreBinding(projectId, rootPath) {
      uow.commit((u) => {
        u.rootBindings.setStatus(projectId, rootPath, "active");
      });
    },

    listByProject(projectId) {
      return uow.rootBindings.listByProject(projectId);
    },

    listAllByRootPath(rootPath) {
      return uow.rootBindings.listAllByRootPath(rootPath);
    },

    findActiveByFingerprint(fingerprint) {
      return uow.rootBindings.findActiveByFingerprint(fingerprint);
    },

    repointBinding(projectId, fromRootPath, to) {
      uow.commit((u) => {
        const existing = u.rootBindings.get(projectId, fromRootPath);
        if (!existing) {
          throw new SestinaError(SestinaErrorCode.project_not_found, "Project not found");
        }
        u.rootBindings.setStatus(projectId, fromRootPath, "archived");
        u.rootBindings.insert(toRecord(projectId, to, "active"));
      });
    },
  };
}
