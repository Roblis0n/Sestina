import {
  ProjectIdSchema,
  SestinaError,
  SestinaErrorCode,
  type ProjectRootBinding,
  type SestinaProject,
} from "@sestina/schema";
import {
  createUnitOfWork,
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

// ── Project lifecycle service (docs/22 Task 8, docs/30 §3/§4/§6) ──
// Project ids are derived from binding fingerprints, never from path
// plaintext. Roots are added only by explicit user action; conflicting roots
// fail with validation_failed for human review instead of last-write-wins.
// Archiving keeps all data — a status flip, never a delete.

export interface ProjectFingerprintPort {
  compute(rootPath: string, gitRemote?: string): RootFingerprint;
}

export interface CreateProjectInput {
  name: string;
  roots: string[];
  description?: string;
  gitRemote?: string;
}

export interface ProjectService {
  createProject(input: CreateProjectInput): Promise<SestinaProject>;
  getProject(projectId: string): SestinaProject | undefined;
  listProjects(input?: CursorInput): Page<SestinaProject>;
  renameProject(projectId: string, name: string): SestinaProject;
  setDescription(projectId: string, description: string): SestinaProject;
  archiveProject(projectId: string): SestinaProject;
  restoreProject(projectId: string): SestinaProject;
  addRoot(projectId: string, rootPath: string, opts?: { gitRemote?: string }): Promise<SestinaProject>;
  removeRoot(projectId: string, rootPath: string): SestinaProject;
  repointRoot(
    projectId: string,
    fromRootPath: string,
    toRootPath: string,
    opts?: { gitRemote?: string },
  ): Promise<SestinaProject>;
  /** Same-name projects stay distinguishable (docs/30 §10 short id). */
  displayLabel(project: SestinaProject): string;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function createProjectService(
  db: StorageDatabase,
  ports: { fingerprint?: ProjectFingerprintPort } = {},
): ProjectService {
  const uow = createUnitOfWork(db);
  const bindings: RootBindingPort = createRootBindingPort(db);
  // The port takes a plain-string gitRemote; the pure-compute default takes
  // an options object — adapt it here so remotes are never silently ignored.
  const fingerprint = ports.fingerprint ?? {
    compute: (rootPath, gitRemote) => computeRootFingerprint(rootPath, { gitRemote }),
  };

  function requireProject(projectId: string): SestinaProject {
    const project = uow.projects.get(projectId);
    if (!project) {
      throw new SestinaError(SestinaErrorCode.project_not_found, "Project not found");
    }
    return project;
  }

  function makeBinding(
    fp: RootFingerprint,
    source: ProjectRootBinding["source"],
    confirmed: boolean,
  ): ProjectRootBinding {
    return {
      rootPath: fp.canonicalPath,
      establishedAt: nowIso(),
      fingerprint: fp.fingerprint,
      source,
      confirmed,
      caseSemantics: fp.caseSemantics,
    };
  }

  return {
    async createProject(input) {
      if (input.roots.length === 0) {
        throw new SestinaError(
          SestinaErrorCode.validation_failed,
          "A project needs at least one root",
        );
      }
      const fingerprints = input.roots.map((root) => fingerprint.compute(root, input.gitRemote));
      // A binding conflict goes to human review as validation_failed, never a
      // duplicate-detected idempotency violation (docs/30 §10).
      const canonicalPaths = new Set(fingerprints.map((fp) => fp.canonicalPath));
      if (canonicalPaths.size !== fingerprints.length) {
        throw new SestinaError(
          SestinaErrorCode.validation_failed,
          "Duplicate roots in one project creation",
        );
      }
      for (const canonicalPath of canonicalPaths) {
        const owners = bindings
          .listAllByRootPath(canonicalPath)
          .filter((b) => b.status === "active");
        if (owners.length > 0) {
          throw new SestinaError(
            SestinaErrorCode.validation_failed,
            "Root is actively bound to another project",
          );
        }
      }
      // The id derives from the PATH fingerprint, never the remote one: two
      // distinct projects may share a git remote (docs/30 §10 ambiguity) and
      // must stay distinct. The remote fingerprint lives on bindings for
      // cross-path move matching only.
      const projectId = ProjectIdSchema.parse(
        await deriveProjectId(fingerprints[0]?.pathFingerprint ?? ""),
      );
      const at = nowIso();
      const project: SestinaProject = {
        projectId,
        name: input.name,
        description: input.description,
        bindings: fingerprints.map((fp) => makeBinding(fp, "user_added", true)),
        status: "active",
        createdAt: at,
        updatedAt: at,
      };
      uow.commit((u) => {
        u.projects.insert(project);
      });
      return project;
    },

    getProject(projectId) {
      return uow.projects.get(projectId);
    },

    listProjects(input) {
      return uow.projects.list(input ?? { limit: 50 });
    },

    renameProject(projectId, name) {
      const project = requireProject(projectId);
      const updated = { ...project, name, updatedAt: nowIso() };
      uow.commit((u) => {
        u.projects.update(updated);
      });
      return updated;
    },

    setDescription(projectId, description) {
      const project = requireProject(projectId);
      const updated = { ...project, description, updatedAt: nowIso() };
      uow.commit((u) => {
        u.projects.update(updated);
      });
      return updated;
    },

    archiveProject(projectId) {
      const project = requireProject(projectId);
      const at = nowIso();
      uow.commit((u) => {
        u.projects.archive(projectId, Date.parse(at));
      });
      // Explicit annotation: TS widens a literal override over a spread
      // union-typed property to `string` without it.
      const updated: SestinaProject = { ...project, status: "archived", updatedAt: at };
      return updated;
    },

    restoreProject(projectId) {
      const project = requireProject(projectId);
      const updated: SestinaProject = { ...project, status: "active", updatedAt: nowIso() };
      uow.commit((u) => {
        u.projects.update(updated);
      });
      return updated;
    },

    // Async for the injectable fingerprint port (docs/22); the default
    // port is pure compute, so the body has no await.
    // eslint-disable-next-line @typescript-eslint/require-await
    async addRoot(projectId, rootPath, opts) {
      const project = requireProject(projectId);
      const fp = fingerprint.compute(rootPath, opts?.gitRemote);
      if (project.bindings.some((b) => b.rootPath === fp.canonicalPath)) {
        throw new SestinaError(SestinaErrorCode.validation_failed, "Root is already bound to this project");
      }
      const owners = bindings.listAllByRootPath(fp.canonicalPath).filter((b) => b.status === "active");
      if (owners.length > 0) {
        throw new SestinaError(
          SestinaErrorCode.validation_failed,
          "Root is actively bound to another project",
        );
      }
      const sameIdentity = bindings.findActiveByFingerprint(fp.fingerprint);
      // A Git worktree may belong to the same project, each root binding
      // saved separately (docs/30 §4) — only fingerprints claimed by ANOTHER
      // project block the add.
      const foreign = sameIdentity.filter((b) => b.projectId !== projectId);
      if (foreign.length > 0) {
        throw new SestinaError(
          SestinaErrorCode.validation_failed,
          "Root matches an existing binding fingerprint of another project",
        );
      }
      const added = makeBinding(fp, "user_added", true);
      const updated = {
        ...project,
        bindings: [...project.bindings, added],
        updatedAt: nowIso(),
      };
      uow.commit((u) => {
        u.projects.update(updated);
        u.rootBindings.insert({
          projectId,
          rootPath: added.rootPath,
          label: added.label,
          status: "active",
          establishedAt: added.establishedAt,
          fingerprint: added.fingerprint,
          confirmed: true,
          source: "user_added",
          caseSemantics: added.caseSemantics,
        });
      });
      return updated;
    },

    removeRoot(projectId, rootPath) {
      const project = requireProject(projectId);
      const canonical = fingerprint.compute(rootPath).canonicalPath;
      if (!project.bindings.some((b) => b.rootPath === canonical)) {
        throw new SestinaError(
          SestinaErrorCode.validation_failed,
          "Project has no active binding for this root",
        );
      }
      bindings.archiveBinding(projectId, canonical);
      return requireProject(projectId);
    },

    // eslint-disable-next-line @typescript-eslint/require-await
    async repointRoot(projectId, fromRootPath, toRootPath, opts) {
      requireProject(projectId);
      const from = fingerprint.compute(fromRootPath).canonicalPath;
      const to = fingerprint.compute(toRootPath, opts?.gitRemote);
      // Repointing onto a root with an active binding is a conflict for
      // human review (docs/30 §10) — refuse before touching any row.
      const owners = bindings
        .listAllByRootPath(to.canonicalPath)
        .filter((b) => b.status === "active");
      if (owners.length > 0) {
        throw new SestinaError(
          SestinaErrorCode.validation_failed,
          "Target root is actively bound to another project",
        );
      }
      bindings.repointBinding(projectId, from, makeBinding(to, "user_confirmed", true));
      return requireProject(projectId);
    },

    displayLabel(project) {
      // Same-name projects stay distinguishable (docs/30 §10): name plus
      // the root alias and a stable id suffix, shown together in the UI.
      const alias =
        project.bindings.length > 0
          ? rootAlias(project.bindings[0]?.rootPath ?? "/")
          : "/";
      return `${project.name} · ${alias} · ${project.projectId.slice(0, 8)}`;
    },
  };
}
