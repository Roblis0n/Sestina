import {
  SestinaProjectSchema,
  ProjectRootBindingSchema,
  SestinaErrorCode,
  SestinaError,
  type SestinaProject,
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

export interface ProjectRepository {
  insert(project: SestinaProject): void;
  get(projectId: string): SestinaProject | undefined;
  list(input: CursorInput): Page<SestinaProject>;
  update(project: SestinaProject): void;
  /** Aggregates are updatable, but archive never deletes (docs/08). */
  archive(projectId: string, atMs: number): void;
}

interface ProjectRow {
  project_id: string;
  display_name: string;
  created_at: number;
  data: string;
}

interface BindingRow {
  root_path: string;
  status: string;
  created_at: number;
  data: string;
}

function assembleProject(row: ProjectRow, bindings: BindingRow[]): SestinaProject {
  const data = JSON.parse(row.data) as SestinaProject;
  const bindingData = bindings.map((b) => {
    const parsed = ProjectRootBindingSchema.parse(JSON.parse(b.data) as unknown);
    return { ...parsed, rootPath: b.root_path, establishedAt: fromMs(b.created_at) };
  });
  return SestinaProjectSchema.parse({
    ...data,
    projectId: row.project_id,
    name: row.display_name,
    createdAt: fromMs(row.created_at),
    bindings: bindingData,
  });
}

export function createProjectRepository(tx: StorageTransaction): ProjectRepository {
  return {
    insert(project) {
      assertInTransaction(tx);
      assertValidProjectId(project.projectId);
      tx.run(
        "INSERT INTO projects (project_id, display_name, created_at, data) VALUES (?, ?, ?, ?)",
        project.projectId,
        project.name,
        toMs(project.createdAt),
        validateJson(SestinaProjectSchema, project, "SestinaProject"),
      );
      for (const binding of project.bindings) {
        tx.run(
          "INSERT INTO project_root_bindings (project_id, root_path, status, created_at, data) VALUES (?, ?, 'active', ?, ?)",
          project.projectId,
          binding.rootPath,
          toMs(binding.establishedAt),
          validateJson(ProjectRootBindingSchema, binding, "ProjectRootBinding"),
        );
      }
    },

    get(projectId) {
      assertValidProjectId(projectId);
      const row = tx.get<ProjectRow>(
        "SELECT project_id, display_name, created_at, data FROM projects WHERE project_id = ?",
        projectId,
      );
      if (!row) return undefined;
      const bindings = tx.all<BindingRow>(
        "SELECT root_path, status, created_at, data FROM project_root_bindings WHERE project_id = ? AND status = 'active'",
        projectId,
      );
      return assembleProject(row, bindings);
    },

    list(input) {
      // Projects sit at the top of the hierarchy, so the page is not
      // project-scoped (keysetPage's projectColumn stays unset).
      const page = keysetPage<ProjectRow>(tx, {
        table: "projects",
        columns: "project_id, display_name, created_at, data",
        keyColumn: "created_at",
        idColumn: "project_id",
        cursor: input.cursor,
        limit: input.limit,
      });
      return { items: page.items.map((r) => assembleProject(r, [])), nextCursor: page.nextCursor };
    },

    update(project) {
      assertInTransaction(tx);
      assertValidProjectId(project.projectId);
      const result = tx.run(
        "UPDATE projects SET display_name = ?, data = ? WHERE project_id = ?",
        project.name,
        validateJson(SestinaProjectSchema, project, "SestinaProject"),
        project.projectId,
      );
      if (Number(result.changes) === 0) {
        throw new SestinaError(SestinaErrorCode.project_not_found, "Project not found");
      }
    },

    archive(projectId, atMs) {
      assertInTransaction(tx);
      assertValidProjectId(projectId);
      const existing = tx.get<{ data: string }>(
        "SELECT data FROM projects WHERE project_id = ?",
        projectId,
      );
      if (!existing) {
        throw new SestinaError(SestinaErrorCode.project_not_found, "Project not found");
      }
      const parsed = JSON.parse(existing.data) as SestinaProject;
      const archived = SestinaProjectSchema.parse({
        ...parsed,
        status: "archived",
        updatedAt: fromMs(atMs),
      });
      tx.run(
        "UPDATE projects SET data = ? WHERE project_id = ?",
        validateJson(SestinaProjectSchema, archived, "SestinaProject"),
        projectId,
      );
    },
  };
}
