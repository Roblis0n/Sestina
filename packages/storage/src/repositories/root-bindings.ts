import {
  ProjectRootBindingSchema,
  SestinaErrorCode,
  SestinaError,
} from "@sestina/schema";
import type { StorageTransaction } from "../transaction.js";
import { validateJson } from "../schema-check.js";
import { assertInTransaction, assertValidProjectId, fromMs, toMs } from "./shared.js";

/**
 * A project root binding read back with its canonical columns
 * (migration 009): fingerprint, confirmed, source and case_semantics are
 * first-class columns, authoritative over the data JSON (docs/30 §3/§4).
 */
export interface RootBindingRecord {
  projectId: string;
  rootPath: string;
  label?: string;
  status: "active" | "archived";
  establishedAt: string;
  fingerprint: string;
  confirmed: boolean;
  source: "discovered" | "user_added" | "user_confirmed";
  caseSemantics?: "case_insensitive" | "case_sensitive";
}

export interface RootBindingRepository {
  insert(binding: RootBindingRecord): void;
  get(projectId: string, rootPath: string): RootBindingRecord | undefined;
  listByProject(projectId: string): RootBindingRecord[];
  listAllByRootPath(rootPath: string): RootBindingRecord[];
  findActiveByFingerprint(fingerprint: string): RootBindingRecord[];
  /** Marks the binding confirmed by the user (docs/30 §4 re-association). */
  confirm(projectId: string, rootPath: string): void;
  setStatus(projectId: string, rootPath: string, status: "active" | "archived"): void;
}

interface BindingRow {
  project_id: string;
  root_path: string;
  status: string;
  created_at: number;
  fingerprint: string;
  confirmed: number;
  source: string;
  case_semantics: string;
  data: string;
}

const BINDING_COLUMNS = `project_id, root_path, status, created_at, fingerprint,
  confirmed, source, case_semantics, data`;

function assembleBinding(row: BindingRow): RootBindingRecord {
  const data = ProjectRootBindingSchema.parse(JSON.parse(row.data) as unknown);
  return {
    ...data,
    projectId: row.project_id,
    rootPath: row.root_path,
    status: row.status as RootBindingRecord["status"],
    establishedAt: fromMs(row.created_at),
    // Canonical columns are authoritative; a legacy row written without
    // them (pre-009 insert path) falls back to the data JSON fingerprint.
    fingerprint: row.fingerprint !== "" ? row.fingerprint : data.fingerprint,
    confirmed: row.confirmed !== 0,
    source: row.source as RootBindingRecord["source"],
    caseSemantics:
      row.case_semantics === ""
        ? data.caseSemantics
        : (row.case_semantics as RootBindingRecord["caseSemantics"]),
  };
}

export function createRootBindingRepository(tx: StorageTransaction): RootBindingRepository {
  return {
    insert(binding) {
      assertInTransaction(tx);
      assertValidProjectId(binding.projectId);
      tx.run(
        `INSERT INTO project_root_bindings
           (project_id, root_path, status, created_at, fingerprint, confirmed, source, case_semantics, data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        binding.projectId,
        binding.rootPath,
        binding.status,
        toMs(binding.establishedAt),
        binding.fingerprint,
        binding.confirmed ? 1 : 0,
        binding.source,
        binding.caseSemantics ?? "",
        validateJson(ProjectRootBindingSchema, binding, "ProjectRootBinding"),
      );
    },

    get(projectId, rootPath) {
      assertValidProjectId(projectId);
      const row = tx.get<BindingRow>(
        `SELECT ${BINDING_COLUMNS} FROM project_root_bindings WHERE project_id = ? AND root_path = ?`,
        projectId,
        rootPath,
      );
      return row ? assembleBinding(row) : undefined;
    },

    listByProject(projectId) {
      assertValidProjectId(projectId);
      const rows = tx.all<BindingRow>(
        `SELECT ${BINDING_COLUMNS} FROM project_root_bindings WHERE project_id = ? ORDER BY root_path`,
        projectId,
      );
      return rows.map(assembleBinding);
    },

    listAllByRootPath(rootPath) {
      const rows = tx.all<BindingRow>(
        `SELECT ${BINDING_COLUMNS} FROM project_root_bindings WHERE root_path = ? ORDER BY project_id`,
        rootPath,
      );
      return rows.map(assembleBinding);
    },

    findActiveByFingerprint(fingerprint) {
      const rows = tx.all<BindingRow>(
        `SELECT ${BINDING_COLUMNS} FROM project_root_bindings WHERE fingerprint = ? AND status = 'active' ORDER BY project_id`,
        fingerprint,
      );
      return rows.map(assembleBinding);
    },

    confirm(projectId, rootPath) {
      assertInTransaction(tx);
      assertValidProjectId(projectId);
      const result = tx.run(
        `UPDATE project_root_bindings SET confirmed = 1, source = 'user_confirmed'
         WHERE project_id = ? AND root_path = ?`,
        projectId,
        rootPath,
      );
      if (Number(result.changes) === 0) {
        throw new SestinaError(SestinaErrorCode.project_not_found, "Project not found");
      }
    },

    setStatus(projectId, rootPath, status) {
      assertInTransaction(tx);
      assertValidProjectId(projectId);
      const result = tx.run(
        "UPDATE project_root_bindings SET status = ? WHERE project_id = ? AND root_path = ?",
        status,
        projectId,
        rootPath,
      );
      if (Number(result.changes) === 0) {
        throw new SestinaError(SestinaErrorCode.project_not_found, "Project not found");
      }
    },
  };
}
