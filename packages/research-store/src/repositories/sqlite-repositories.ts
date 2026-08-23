import {
  addArtifactRevision,
  canonicalStringify,
  parseArtifactRevision,
  parseDecisionScope,
  parseEntityVersion,
  parseIssueStatus,
  parseResearchArtifact,
  parseResearchBrief,
  parseResearchDecision,
  parseResearchIdFor,
  parseResearchIssue,
  parseResearchPageRequest,
  parseResearchProject,
  parseResearchRoomReceipt,
  parseResearchSnapshot,
  parseRevisionEpisode,
  researchError,
  type ArtifactRevision,
  type DecisionScope,
  type IssueStatus,
  type ResearchArtifact,
  type ResearchBrief,
  type ResearchDecision,
  type ResearchIdPrefix,
  type ResearchIssue,
  type ResearchPage,
  type ResearchPageRequest,
  type ResearchProject,
  type ResearchRoomReceipt,
  type ResearchRepositories,
  type ResearchResult,
  type ResearchSnapshot,
  type RevisionEpisode,
} from "@sestina/research";
import type { StorageDatabase } from "@sestina/storage";
import { decodeDomainJson, encodeDomainJson } from "../mappers/domain-json.js";
import {
  immutablePage,
  notFound,
  readResult,
  requireExpectedNext,
  writeResult,
} from "./base.js";
import { decodeCursor, encodeCursor } from "./pagination.js";
import { createArgumentGraphRepositories } from "./sqlite-argument-repositories.js";

interface StoredRow {
  readonly project_id: string;
  readonly entity_id: string;
  readonly created_at: string;
  readonly data: string;
}

type Parser<T> = (input: unknown) => ResearchResult<T>;

function validId(value: string, prefix: ResearchIdPrefix): ResearchResult<string> {
  const parsed = parseResearchIdFor(value, prefix);
  return parsed.ok ? { ok: true, value: parsed.value.id } : parsed;
}

function requireProject(db: StorageDatabase, projectId: string): ResearchResult<void> {
  const id = validId(projectId, "rprj_");
  if (!id.ok) return id;
  const row = db.get<{ project_id: string }>(
    "SELECT project_id FROM research_projects WHERE project_id = ?",
    id.value,
  );
  return row === undefined ? notFound() : { ok: true, value: undefined };
}

function sameValue(left: unknown, right: unknown): boolean {
  const a = canonicalStringify(left);
  const b = canonicalStringify(right);
  return a.ok && b.ok && a.value === b.value;
}

function pageRows<T>(
  db: StorageDatabase,
  input: {
    readonly table: string;
    readonly idColumn: string;
    readonly idPrefix: ResearchIdPrefix;
    readonly projectId?: string;
    readonly where: string;
    readonly params: readonly unknown[];
    readonly page: ResearchPageRequest;
    readonly parser: Parser<T>;
  },
): ResearchResult<ResearchPage<T>> {
  const page = parseResearchPageRequest(input.page);
  if (!page.ok) return page;
  if (input.projectId !== undefined) {
    const project = validId(input.projectId, "rprj_");
    if (!project.ok) return project;
  }
  const cursor = decodeCursor(page.value, input.projectId);
  if (!cursor.ok) return cursor;
  if (cursor.value !== undefined) {
    const boundaryId = validId(cursor.value.id, input.idPrefix);
    if (!boundaryId.ok) return { ok: false, error: researchError("invalid_pagination") };
  }
  const cursorWhere = cursor.value === undefined
    ? ""
    : ` AND (created_at > ? OR (created_at = ? AND ${input.idColumn} > ?))`;
  const cursorParams = cursor.value === undefined
    ? []
    : [cursor.value.sortKey, cursor.value.sortKey, cursor.value.id];
  const rows = db.all<StoredRow>(
    `SELECT project_id, ${input.idColumn} AS entity_id, created_at, data
     FROM ${input.table}
     WHERE ${input.where}${cursorWhere}
     ORDER BY created_at, ${input.idColumn}
     LIMIT ?`,
    ...input.params,
    ...cursorParams,
    page.value.limit + 1,
  );
  const hasMore = rows.length > page.value.limit;
  const selected = hasMore ? rows.slice(0, page.value.limit) : rows;
  const items: T[] = [];
  for (const row of selected) {
    const decoded = decodeDomainJson(row.data, input.parser);
    if (!decoded.ok) return decoded;
    items.push(decoded.value);
  }
  const last = selected.at(-1);
  return {
    ok: true,
    value: immutablePage(
      items,
      hasMore && last !== undefined
        ? encodeCursor(last.project_id, last.created_at, last.entity_id)
        : undefined,
    ),
  };
}

function transitionRows(
  db: StorageDatabase,
  table: "research_decision_transitions" | "research_issue_transitions",
  idColumn: "decision_id" | "issue_id",
  projectId: string,
  id: string,
): ResearchResult<readonly unknown[]> {
  const rows = db.all<{ data: string }>(
    `SELECT data FROM ${table}
     WHERE project_id = ? AND ${idColumn} = ?
     ORDER BY transition_index`,
    projectId,
    id,
  );
  const transitions: unknown[] = [];
  for (const row of rows) {
    try {
      transitions.push(JSON.parse(row.data) as unknown);
    } catch {
      return { ok: false, error: researchError("research_storage_unavailable") };
    }
  }
  return { ok: true, value: Object.freeze(transitions) };
}

function readDecisionRow(
  db: StorageDatabase,
  row: { readonly data: string },
  projectId: string,
  decisionId: string,
): ResearchResult<ResearchDecision> {
  const decision = decodeDomainJson(row.data, parseResearchDecision);
  if (!decision.ok) return decision;
  const transitions = transitionRows(
    db,
    "research_decision_transitions",
    "decision_id",
    projectId,
    decisionId,
  );
  if (!transitions.ok) return transitions;
  return sameValue(decision.value.transitions, transitions.value)
    ? decision
    : { ok: false, error: researchError("invalid_decision_transition") };
}

function readIssueRow(
  db: StorageDatabase,
  row: { readonly data: string },
  projectId: string,
  issueId: string,
): ResearchResult<ResearchIssue> {
  const issue = decodeDomainJson(row.data, parseResearchIssue);
  if (!issue.ok) return issue;
  const transitions = transitionRows(
    db,
    "research_issue_transitions",
    "issue_id",
    projectId,
    issueId,
  );
  if (!transitions.ok) return transitions;
  return sameValue(issue.value.transitions, transitions.value)
    ? issue
    : { ok: false, error: researchError("invalid_issue_transition") };
}

function insertDecisionTransitions(db: StorageDatabase, value: ResearchDecision): ResearchResult<void> {
  for (const [index, transition] of value.transitions.entries()) {
    const data = canonicalStringify(transition);
    if (!data.ok) return data;
    db.run(
      `INSERT INTO research_decision_transitions
         (project_id, decision_id, transition_index, from_status, to_status, occurred_at, data)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      value.projectId,
      value.id,
      index,
      transition.from,
      transition.to,
      transition.at,
      data.value,
    );
  }
  return { ok: true, value: undefined };
}

function insertIssueTransitions(db: StorageDatabase, value: ResearchIssue): ResearchResult<void> {
  for (const [index, transition] of value.transitions.entries()) {
    const data = canonicalStringify(transition);
    if (!data.ok) return data;
    db.run(
      `INSERT INTO research_issue_transitions
         (project_id, issue_id, transition_index, from_status, to_status, occurred_at, data)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      value.projectId,
      value.id,
      index,
      transition.from,
      transition.to,
      transition.at,
      data.value,
    );
  }
  return { ok: true, value: undefined };
}

function scopeKey(scope: DecisionScope): string {
  switch (scope.kind) {
    case "project": return "";
    case "artifact": return scope.artifactId;
    case "brief": return scope.briefVersionId;
    case "issue": return scope.issueId;
  }
}

function requireDecisionScopeTarget(
  db: StorageDatabase,
  projectId: string,
  scope: DecisionScope,
): ResearchResult<void> {
  if (scope.kind === "project") return requireProject(db, projectId);
  if (scope.kind === "brief") {
    const rows = db.all<{ data: string }>(
      "SELECT data FROM research_briefs WHERE project_id = ?",
      projectId,
    );
    for (const row of rows) {
      const brief = decodeDomainJson(row.data, parseResearchBrief);
      if (!brief.ok) return brief;
      if (brief.value.versions.some((version) => version.id === scope.briefVersionId)) {
        return { ok: true, value: undefined };
      }
    }
    return notFound();
  }
  const config = scope.kind === "artifact"
    ? { table: "research_artifacts", column: "artifact_id", id: scope.artifactId }
    : { table: "research_issues", column: "issue_id", id: scope.issueId };
  const row = db.get(
    `SELECT ${config.column} FROM ${config.table} WHERE project_id = ? AND ${config.column} = ?`,
    projectId,
    config.id,
  );
  return row === undefined ? notFound() : { ok: true, value: undefined };
}

function requireBriefArtifacts(db: StorageDatabase, value: ResearchBrief): ResearchResult<void> {
  for (const version of value.versions) {
    for (const artifactId of version.targetArtifacts) {
      const row = db.get(
        "SELECT artifact_id FROM research_artifacts WHERE project_id = ? AND artifact_id = ?",
        value.projectId,
        artifactId,
      );
      if (row === undefined) return notFound();
    }
  }
  return { ok: true, value: undefined };
}

function insertRevision(db: StorageDatabase, value: ArtifactRevision): ResearchResult<ArtifactRevision> {
  const parsed = parseArtifactRevision(value);
  if (!parsed.ok) return parsed;
  const artifact = db.get<{ artifact_id: string }>(
    "SELECT artifact_id FROM research_artifacts WHERE project_id = ? AND artifact_id = ?",
    parsed.value.projectId,
    parsed.value.artifactId,
  );
  if (artifact === undefined) return notFound();
  if (parsed.value.parentRevisionId !== undefined) {
    const parent = db.get<{ revision_id: string }>(
      `SELECT revision_id FROM artifact_revisions
       WHERE project_id = ? AND artifact_id = ? AND revision_id = ?`,
      parsed.value.projectId,
      parsed.value.artifactId,
      parsed.value.parentRevisionId,
    );
    if (parent === undefined) {
      return { ok: false, error: researchError("invalid_revision_parent") };
    }
  }
  const existing = db.get<{ revision_id: string }>(
    "SELECT revision_id FROM artifact_revisions WHERE project_id = ? AND revision_id = ?",
    parsed.value.projectId,
    parsed.value.id,
  );
  if (existing !== undefined) return { ok: false, error: researchError("version_conflict") };
  const data = encodeDomainJson(parsed.value, parseArtifactRevision);
  if (!data.ok) return data;
  db.run(
    `INSERT INTO artifact_revisions
       (revision_id, project_id, artifact_id, parent_revision_id, content_hash, created_at, data)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    parsed.value.id,
    parsed.value.projectId,
    parsed.value.artifactId,
    parsed.value.parentRevisionId ?? null,
    parsed.value.content.contentHash,
    parsed.value.createdAt,
    data.value,
  );
  return parsed;
}

export function createResearchRepositories(db: StorageDatabase): ResearchRepositories {
  const projects: ResearchRepositories["projects"] = {
    create(value) {
      return writeResult(db, () => {
        const parsed = parseResearchProject(value);
        if (!parsed.ok) return parsed;
        if (db.get("SELECT project_id FROM research_projects WHERE project_id = ?", parsed.value.id)) {
          return { ok: false, error: researchError("version_conflict") };
        }
        const data = encodeDomainJson(parsed.value, parseResearchProject);
        if (!data.ok) return data;
        db.run(
          `INSERT INTO research_projects
             (project_id, title, root_path, version, created_at, updated_at, data)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          parsed.value.id,
          parsed.value.title,
          parsed.value.rootPath,
          parsed.value.version,
          parsed.value.createdAt,
          parsed.value.updatedAt,
          data.value,
        );
        return parsed;
      });
    },
    getById(projectId) {
      return readResult<ResearchProject | undefined>(() => {
        const id = validId(projectId, "rprj_");
        if (!id.ok) return id;
        const row = db.get<{ data: string }>(
          "SELECT data FROM research_projects WHERE project_id = ?",
          id.value,
        );
        return row === undefined
          ? { ok: true, value: undefined }
          : decodeDomainJson(row.data, parseResearchProject);
      });
    },
    list(page) {
      return readResult(() => pageRows(db, {
        table: "research_projects",
        idColumn: "project_id",
        idPrefix: "rprj_",
        where: "1=1",
        params: [],
        page,
        parser: parseResearchProject,
      }));
    },
    compareAndSwap(value, expectedVersion) {
      return writeResult(db, () => {
        const parsed = parseResearchProject(value);
        if (!parsed.ok) return parsed;
        const expected = parseEntityVersion(expectedVersion);
        if (!expected.ok) return expected;
        if (parsed.value.version !== expected.value + 1) {
          return { ok: false, error: researchError("version_conflict") };
        }
        const data = encodeDomainJson(parsed.value, parseResearchProject);
        if (!data.ok) return data;
        const result = db.run(
          `UPDATE research_projects
           SET title = ?, root_path = ?, version = ?, updated_at = ?, data = ?
           WHERE project_id = ? AND version = ?`,
          parsed.value.title,
          parsed.value.rootPath,
          parsed.value.version,
          parsed.value.updatedAt,
          data.value,
          parsed.value.id,
          expected.value,
        );
        return Number(result.changes) === 1
          ? parsed
          : { ok: false, error: researchError("version_conflict") };
      });
    },
  };

  const artifacts: ResearchRepositories["artifacts"] = {
    create(value) {
      return writeResult(db, () => {
        const parsed = parseResearchArtifact(value);
        if (!parsed.ok) return parsed;
        const project = requireProject(db, parsed.value.projectId);
        if (!project.ok) return project;
        const data = encodeDomainJson(parsed.value, parseResearchArtifact);
        if (!data.ok) return data;
        db.run(
          `INSERT INTO research_artifacts
             (artifact_id, project_id, kind, title, version, active_revision_id,
              tombstoned, created_at, updated_at, data)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          parsed.value.id,
          parsed.value.projectId,
          parsed.value.kind,
          parsed.value.title,
          parsed.value.version,
          null,
          parsed.value.tombstone === undefined ? 0 : 1,
          parsed.value.createdAt,
          parsed.value.createdAt,
          data.value,
        );
        for (const revision of parsed.value.revisions) {
          const inserted = insertRevision(db, revision);
          if (!inserted.ok) return inserted;
        }
        if (parsed.value.activeRevisionId !== undefined) {
          db.run(
            "UPDATE research_artifacts SET active_revision_id = ? WHERE project_id = ? AND artifact_id = ?",
            parsed.value.activeRevisionId,
            parsed.value.projectId,
            parsed.value.id,
          );
        }
        return parsed;
      });
    },
    getById(projectId, artifactId) {
      return readResult<ResearchArtifact | undefined>(() => {
        const project = validId(projectId, "rprj_"); if (!project.ok) return project;
        const id = validId(artifactId, "rart_"); if (!id.ok) return id;
        const row = db.get<{ data: string }>(
          "SELECT data FROM research_artifacts WHERE project_id = ? AND artifact_id = ?",
          project.value,
          id.value,
        );
        if (row === undefined) return { ok: true, value: undefined };
        const artifact = decodeDomainJson(row.data, parseResearchArtifact);
        if (!artifact.ok) return artifact;
        const revisionRows = db.all<{ data: string }>(
          `SELECT data FROM artifact_revisions
           WHERE project_id = ? AND artifact_id = ?
           ORDER BY created_at, revision_id`,
          project.value,
          id.value,
        );
        const revisions: ArtifactRevision[] = [];
        for (const revisionRow of revisionRows) {
          const revision = decodeDomainJson(revisionRow.data, parseArtifactRevision);
          if (!revision.ok) return revision;
          revisions.push(revision.value);
        }
        return sameValue(artifact.value.revisions, revisions)
          ? artifact
          : { ok: false, error: researchError("invalid_artifact") };
      });
    },
    listByProject(projectId, page) {
      return readResult(() => pageRows(db, {
        table: "research_artifacts",
        idColumn: "artifact_id",
        idPrefix: "rart_",
        projectId,
        where: "project_id = ?",
        params: [projectId],
        page,
        parser: parseResearchArtifact,
      }));
    },
    compareAndSwap(value, expectedVersion) {
      return writeResult(db, () => {
        const parsed = parseResearchArtifact(value);
        if (!parsed.ok) return parsed;
        const expected = parseEntityVersion(expectedVersion); if (!expected.ok) return expected;
        if (parsed.value.version !== expected.value + 1) return { ok: false, error: researchError("version_conflict") };
        const currentRow = db.get<{ data: string }>(
          "SELECT data FROM research_artifacts WHERE project_id = ? AND artifact_id = ? AND version = ?",
          parsed.value.projectId,
          parsed.value.id,
          expected.value,
        );
        if (currentRow === undefined) return { ok: false, error: researchError("version_conflict") };
        const current = decodeDomainJson(currentRow.data, parseResearchArtifact);
        if (!current.ok) return current;
        if (!sameValue(current.value.revisions, parsed.value.revisions)) {
          return { ok: false, error: researchError("invalid_revision") };
        }
        const data = encodeDomainJson(parsed.value, parseResearchArtifact); if (!data.ok) return data;
        const result = db.run(
          `UPDATE research_artifacts
           SET kind = ?, title = ?, version = ?, active_revision_id = ?, tombstoned = ?, data = ?
           WHERE project_id = ? AND artifact_id = ? AND version = ?`,
          parsed.value.kind,
          parsed.value.title,
          parsed.value.version,
          parsed.value.activeRevisionId ?? null,
          parsed.value.tombstone === undefined ? 0 : 1,
          data.value,
          parsed.value.projectId,
          parsed.value.id,
          expected.value,
        );
        return Number(result.changes) === 1 ? parsed : { ok: false, error: researchError("version_conflict") };
      });
    },
  };

  const revisions: ResearchRepositories["revisions"] = {
    append(value) {
      return writeResult(db, () => {
        const parsed = parseArtifactRevision(value); if (!parsed.ok) return parsed;
        const row = db.get<{ data: string; version: number }>(
          "SELECT data, version FROM research_artifacts WHERE project_id = ? AND artifact_id = ?",
          parsed.value.projectId,
          parsed.value.artifactId,
        );
        if (row === undefined) return notFound();
        const artifact = decodeDomainJson(row.data, parseResearchArtifact); if (!artifact.ok) return artifact;
        const next = addArtifactRevision(
          artifact.value,
          parsed.value,
          artifact.value.version,
          { allowFork: parsed.value.parentRevisionId !== artifact.value.activeRevisionId && artifact.value.revisions.length > 0 },
        );
        if (!next.ok) return next;
        const inserted = insertRevision(db, parsed.value); if (!inserted.ok) return inserted;
        const data = encodeDomainJson(next.value, parseResearchArtifact); if (!data.ok) return data;
        const update = db.run(
          `UPDATE research_artifacts
           SET version = ?, active_revision_id = ?, data = ?
           WHERE project_id = ? AND artifact_id = ? AND version = ?`,
          next.value.version,
          next.value.activeRevisionId ?? null,
          data.value,
          next.value.projectId,
          next.value.id,
          artifact.value.version,
        );
        return Number(update.changes) === 1 ? parsed : { ok: false, error: researchError("version_conflict") };
      });
    },
    getById(projectId, artifactId, revisionId) {
      return readResult<ArtifactRevision | undefined>(() => {
        const project = validId(projectId, "rprj_"); if (!project.ok) return project;
        const artifact = validId(artifactId, "rart_"); if (!artifact.ok) return artifact;
        const revision = validId(revisionId, "rrev_"); if (!revision.ok) return revision;
        const row = db.get<{ data: string }>(
          `SELECT data FROM artifact_revisions
           WHERE project_id = ? AND artifact_id = ? AND revision_id = ?`,
          project.value,
          artifact.value,
          revision.value,
        );
        return row === undefined ? { ok: true, value: undefined } : decodeDomainJson(row.data, parseArtifactRevision);
      });
    },
    listByArtifact(projectId, artifactId, page) {
      const artifact = validId(artifactId, "rart_");
      if (!artifact.ok) return artifact;
      return readResult(() => pageRows(db, {
        table: "artifact_revisions",
        idColumn: "revision_id",
        idPrefix: "rrev_",
        projectId,
        where: "project_id = ? AND artifact_id = ?",
        params: [projectId, artifact.value],
        page,
        parser: parseArtifactRevision,
      }));
    },
  };

  const briefs: ResearchRepositories["briefs"] = {
    create(value) {
      return writeResult(db, () => {
        const parsed = parseResearchBrief(value); if (!parsed.ok) return parsed;
        const project = requireProject(db, parsed.value.projectId); if (!project.ok) return project;
        const artifactsExist = requireBriefArtifacts(db, parsed.value); if (!artifactsExist.ok) return artifactsExist;
        const data = encodeDomainJson(parsed.value, parseResearchBrief); if (!data.ok) return data;
        const first = parsed.value.versions.at(0);
        const last = parsed.value.versions.at(-1);
        if (first === undefined || last === undefined) return { ok: false, error: researchError("invalid_research_brief") };
        db.run(
          `INSERT INTO research_briefs
             (brief_id, project_id, current_version_id, version, created_at, updated_at, data)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          parsed.value.id, parsed.value.projectId, parsed.value.currentVersionId,
          parsed.value.version, first.createdAt, last.createdAt, data.value,
        );
        return parsed;
      });
    },
    getById(projectId, briefId) {
      return readResult<ResearchBrief | undefined>(() => {
        const project = validId(projectId, "rprj_"); if (!project.ok) return project;
        const id = validId(briefId, "rbrf_"); if (!id.ok) return id;
        const row = db.get<{ data: string }>(
          "SELECT data FROM research_briefs WHERE project_id = ? AND brief_id = ?",
          project.value, id.value,
        );
        return row === undefined ? { ok: true, value: undefined } : decodeDomainJson(row.data, parseResearchBrief);
      });
    },
    listByProject(projectId, page) {
      return readResult(() => pageRows(db, {
        table: "research_briefs", idColumn: "brief_id", idPrefix: "rbrf_",
        projectId, where: "project_id = ?", params: [projectId], page, parser: parseResearchBrief,
      }));
    },
    compareAndSwap(value, expectedVersion) {
      return writeResult(db, () => {
        const parsed = parseResearchBrief(value); if (!parsed.ok) return parsed;
        const artifactsExist = requireBriefArtifacts(db, parsed.value); if (!artifactsExist.ok) return artifactsExist;
        const expected = parseEntityVersion(expectedVersion); if (!expected.ok) return expected;
        if (parsed.value.version !== expected.value + 1) return { ok: false, error: researchError("version_conflict") };
        const data = encodeDomainJson(parsed.value, parseResearchBrief); if (!data.ok) return data;
        const last = parsed.value.versions.at(-1);
        if (last === undefined) return { ok: false, error: researchError("invalid_research_brief") };
        const result = db.run(
          `UPDATE research_briefs SET current_version_id = ?, version = ?, updated_at = ?, data = ?
           WHERE project_id = ? AND brief_id = ? AND version = ?`,
          parsed.value.currentVersionId, parsed.value.version, last.createdAt, data.value,
          parsed.value.projectId, parsed.value.id, expected.value,
        );
        return Number(result.changes) === 1 ? parsed : { ok: false, error: researchError("version_conflict") };
      });
    },
  };

  const decisions: ResearchRepositories["decisions"] = {
    create(value) {
      return writeResult(db, () => {
        const parsed = parseResearchDecision(value); if (!parsed.ok) return parsed;
        const project = requireDecisionScopeTarget(db, parsed.value.projectId, parsed.value.scope); if (!project.ok) return project;
        const data = encodeDomainJson(parsed.value, parseResearchDecision); if (!data.ok) return data;
        db.run(
          `INSERT INTO research_decisions
             (decision_id, project_id, scope_kind, scope_key, status, version, created_at, updated_at, data)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          parsed.value.id, parsed.value.projectId, parsed.value.scope.kind, scopeKey(parsed.value.scope),
          parsed.value.status, parsed.value.version, parsed.value.createdAt, parsed.value.updatedAt, data.value,
        );
        const transitions = insertDecisionTransitions(db, parsed.value); if (!transitions.ok) return transitions;
        return parsed;
      });
    },
    getById(projectId, decisionId) {
      return readResult<ResearchDecision | undefined>(() => {
        const project = validId(projectId, "rprj_"); if (!project.ok) return project;
        const id = validId(decisionId, "rdec_"); if (!id.ok) return id;
        const row = db.get<{ data: string }>(
          "SELECT data FROM research_decisions WHERE project_id = ? AND decision_id = ?",
          project.value, id.value,
        );
        return row === undefined ? { ok: true, value: undefined } : readDecisionRow(db, row, project.value, id.value);
      });
    },
    listByScope(projectId, scopeInput, page) {
      let scope: DecisionScope | undefined;
      if (scopeInput !== undefined) {
        const parsed = parseDecisionScope(scopeInput); if (!parsed.ok) return parsed;
        scope = parsed.value;
      }
      const where = scope === undefined
        ? "project_id = ?"
        : "project_id = ? AND scope_kind = ? AND scope_key = ?";
      const params = scope === undefined
        ? [projectId]
        : [projectId, scope.kind, scopeKey(scope)];
      const result = readResult(() => pageRows(db, {
        table: "research_decisions", idColumn: "decision_id", idPrefix: "rdec_",
        projectId, where, params, page, parser: parseResearchDecision,
      }));
      if (!result.ok) return result;
      for (const decision of result.value.items) {
        const verified = decisions.getById(projectId, decision.id);
        if (!verified.ok) return verified;
      }
      return result;
    },
    appendTransition(value, expectedVersion) {
      return writeResult(db, () => {
        const next = parseResearchDecision(value); if (!next.ok) return next;
        const target = requireDecisionScopeTarget(db, next.value.projectId, next.value.scope); if (!target.ok) return target;
        const expected = parseEntityVersion(expectedVersion); if (!expected.ok) return expected;
        const row = db.get<{ data: string }>(
          "SELECT data FROM research_decisions WHERE project_id = ? AND decision_id = ? AND version = ?",
          next.value.projectId, next.value.id, expected.value,
        );
        if (row === undefined) return { ok: false, error: researchError("version_conflict") };
        const current = readDecisionRow(db, row, next.value.projectId, next.value.id); if (!current.ok) return current;
        const versions = requireExpectedNext(current.value.version, expected.value, next.value.version); if (!versions.ok) return versions;
        if (
          next.value.transitions.length !== current.value.transitions.length + 1 ||
          !sameValue(next.value.transitions.slice(0, -1), current.value.transitions)
        ) return { ok: false, error: researchError("invalid_decision_transition") };
        const transition = next.value.transitions.at(-1);
        if (transition === undefined) return { ok: false, error: researchError("invalid_decision_transition") };
        const data = encodeDomainJson(next.value, parseResearchDecision); if (!data.ok) return data;
        const update = db.run(
          `UPDATE research_decisions
           SET scope_kind = ?, scope_key = ?, status = ?, version = ?, updated_at = ?, data = ?
           WHERE project_id = ? AND decision_id = ? AND version = ?`,
          next.value.scope.kind, scopeKey(next.value.scope), next.value.status, next.value.version,
          next.value.updatedAt, data.value, next.value.projectId, next.value.id, expected.value,
        );
        if (Number(update.changes) !== 1) return { ok: false, error: researchError("version_conflict") };
        const transitionData = canonicalStringify(transition); if (!transitionData.ok) return transitionData;
        db.run(
          `INSERT INTO research_decision_transitions
             (project_id, decision_id, transition_index, from_status, to_status, occurred_at, data)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          next.value.projectId, next.value.id, current.value.transitions.length,
          transition.from, transition.to, transition.at, transitionData.value,
        );
        return next;
      });
    },
  };

  const issues: ResearchRepositories["issues"] = {
    create(value) {
      return writeResult(db, () => {
        const parsed = parseResearchIssue(value); if (!parsed.ok) return parsed;
        const project = requireProject(db, parsed.value.projectId); if (!project.ok) return project;
        const data = encodeDomainJson(parsed.value, parseResearchIssue); if (!data.ok) return data;
        db.run(
          `INSERT INTO research_issues
             (issue_id, project_id, fingerprint, source_artifact_id, source_revision_id,
              lineage_root_revision_id, status, version, created_at, updated_at, data)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          parsed.value.id, parsed.value.projectId, parsed.value.fingerprint,
          parsed.value.sourceArtifactId, parsed.value.sourceRevisionId, parsed.value.lineageRootRevisionId,
          parsed.value.status,
          parsed.value.version, parsed.value.createdAt, parsed.value.updatedAt, data.value,
        );
        const transitions = insertIssueTransitions(db, parsed.value); if (!transitions.ok) return transitions;
        return parsed;
      });
    },
    getById(projectId, issueId) {
      return readResult<ResearchIssue | undefined>(() => {
        const project = validId(projectId, "rprj_"); if (!project.ok) return project;
        const id = validId(issueId, "riss_"); if (!id.ok) return id;
        const row = db.get<{ data: string }>(
          "SELECT data FROM research_issues WHERE project_id = ? AND issue_id = ?",
          project.value, id.value,
        );
        return row === undefined ? { ok: true, value: undefined } : readIssueRow(db, row, project.value, id.value);
      });
    },
    listByStatus(projectId, statusInput, page) {
      let status: IssueStatus | undefined;
      if (statusInput !== undefined) {
        const parsed = parseIssueStatus(statusInput); if (!parsed.ok) return parsed;
        status = parsed.value;
      }
      const where = status === undefined ? "project_id = ?" : "project_id = ? AND status = ?";
      const params = status === undefined ? [projectId] : [projectId, status];
      const result = readResult(() => pageRows(db, {
        table: "research_issues", idColumn: "issue_id", idPrefix: "riss_",
        projectId, where, params, page, parser: parseResearchIssue,
      }));
      if (!result.ok) return result;
      for (const issue of result.value.items) {
        const verified = issues.getById(projectId, issue.id);
        if (!verified.ok) return verified;
      }
      return result;
    },
    appendTransition(value, expectedVersion) {
      return writeResult(db, () => {
        const next = parseResearchIssue(value); if (!next.ok) return next;
        const expected = parseEntityVersion(expectedVersion); if (!expected.ok) return expected;
        const row = db.get<{ data: string }>(
          "SELECT data FROM research_issues WHERE project_id = ? AND issue_id = ? AND version = ?",
          next.value.projectId, next.value.id, expected.value,
        );
        if (row === undefined) return { ok: false, error: researchError("version_conflict") };
        const current = readIssueRow(db, row, next.value.projectId, next.value.id); if (!current.ok) return current;
        const versions = requireExpectedNext(current.value.version, expected.value, next.value.version); if (!versions.ok) return versions;
        if (
          next.value.transitions.length !== current.value.transitions.length + 1 ||
          !sameValue(next.value.transitions.slice(0, -1), current.value.transitions)
        ) return { ok: false, error: researchError("invalid_issue_transition") };
        const transition = next.value.transitions.at(-1);
        if (transition === undefined) return { ok: false, error: researchError("invalid_issue_transition") };
        const data = encodeDomainJson(next.value, parseResearchIssue); if (!data.ok) return data;
        const update = db.run(
          `UPDATE research_issues
           SET fingerprint = ?, status = ?, version = ?, updated_at = ?, data = ?
           WHERE project_id = ? AND issue_id = ? AND version = ?`,
          next.value.fingerprint, next.value.status, next.value.version, next.value.updatedAt,
          data.value, next.value.projectId, next.value.id, expected.value,
        );
        if (Number(update.changes) !== 1) return { ok: false, error: researchError("version_conflict") };
        const transitionData = canonicalStringify(transition); if (!transitionData.ok) return transitionData;
        db.run(
          `INSERT INTO research_issue_transitions
             (project_id, issue_id, transition_index, from_status, to_status, occurred_at, data)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          next.value.projectId, next.value.id, current.value.transitions.length,
          transition.from, transition.to, transition.at, transitionData.value,
        );
        return next;
      });
    },
  };

  const episodes: ResearchRepositories["episodes"] = {
    create(value) {
      return writeResult(db, () => {
        const parsed = parseRevisionEpisode(value); if (!parsed.ok) return parsed;
        const artifact = db.get<{ artifact_id: string }>(
          "SELECT artifact_id FROM research_artifacts WHERE project_id = ? AND artifact_id = ?",
          parsed.value.projectId, parsed.value.artifactId,
        );
        if (artifact === undefined) return notFound();
        const data = encodeDomainJson(parsed.value, parseRevisionEpisode); if (!data.ok) return data;
        db.run(
          `INSERT INTO revision_episodes
             (episode_id, project_id, artifact_id, baseline_revision_id, candidate_revision_id,
              status, version, created_at, updated_at, data)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          parsed.value.id, parsed.value.projectId, parsed.value.artifactId,
          parsed.value.lockedStart.baselineRevisionId, parsed.value.candidateRevisionId ?? null,
          parsed.value.status,
          parsed.value.version, parsed.value.createdAt, parsed.value.updatedAt, data.value,
        );
        return parsed;
      });
    },
    getById(projectId, episodeId) {
      return readResult<RevisionEpisode | undefined>(() => {
        const project = validId(projectId, "rprj_"); if (!project.ok) return project;
        const id = validId(episodeId, "repi_"); if (!id.ok) return id;
        const row = db.get<{ data: string }>(
          "SELECT data FROM revision_episodes WHERE project_id = ? AND episode_id = ?",
          project.value, id.value,
        );
        return row === undefined ? { ok: true, value: undefined } : decodeDomainJson(row.data, parseRevisionEpisode);
      });
    },
    listByProject(projectId, page) {
      return readResult(() => pageRows(db, {
        table: "revision_episodes", idColumn: "episode_id", idPrefix: "repi_",
        projectId, where: "project_id = ?", params: [projectId], page, parser: parseRevisionEpisode,
      }));
    },
    compareAndSwap(value, expectedVersion) {
      return writeResult(db, () => {
        const next = parseRevisionEpisode(value); if (!next.ok) return next;
        const expected = parseEntityVersion(expectedVersion); if (!expected.ok) return expected;
        const row = db.get<{ data: string }>(
          "SELECT data FROM revision_episodes WHERE project_id = ? AND episode_id = ? AND version = ?",
          next.value.projectId, next.value.id, expected.value,
        );
        if (row === undefined) return { ok: false, error: researchError("version_conflict") };
        const current = decodeDomainJson(row.data, parseRevisionEpisode); if (!current.ok) return current;
        const versions = requireExpectedNext(current.value.version, expected.value, next.value.version); if (!versions.ok) return versions;
        if (
          next.value.transitions.length < current.value.transitions.length ||
          !sameValue(next.value.transitions.slice(0, current.value.transitions.length), current.value.transitions)
        ) return { ok: false, error: researchError("invalid_episode_transition") };
        const data = encodeDomainJson(next.value, parseRevisionEpisode); if (!data.ok) return data;
        const update = db.run(
          `UPDATE revision_episodes SET candidate_revision_id = ?, status = ?, version = ?, updated_at = ?, data = ?
           WHERE project_id = ? AND episode_id = ? AND version = ?`,
          next.value.candidateRevisionId ?? null, next.value.status, next.value.version, next.value.updatedAt, data.value,
          next.value.projectId, next.value.id, expected.value,
        );
        return Number(update.changes) === 1 ? next : { ok: false, error: researchError("version_conflict") };
      });
    },
  };

  const snapshots: ResearchRepositories["snapshots"] = {
    create(value) {
      return writeResult(db, () => {
        const parsed = parseResearchSnapshot(value); if (!parsed.ok) return parsed;
        const episode = db.get<{ episode_id: string }>(
          "SELECT episode_id FROM revision_episodes WHERE project_id = ? AND episode_id = ?",
          parsed.value.projectId, parsed.value.episodeId,
        );
        if (episode === undefined) return notFound();
        if (db.get("SELECT snapshot_id FROM research_snapshots WHERE snapshot_id = ?", parsed.value.id)) {
          return { ok: false, error: researchError("version_conflict") };
        }
        const data = encodeDomainJson(parsed.value, parseResearchSnapshot); if (!data.ok) return data;
        db.run(
          `INSERT INTO research_snapshots
             (snapshot_id, project_id, episode_id, content_hash, created_at, data)
           VALUES (?, ?, ?, ?, ?, ?)`,
          parsed.value.id, parsed.value.projectId, parsed.value.episodeId,
          parsed.value.hash, parsed.value.createdAt, data.value,
        );
        return parsed;
      });
    },
    getById(projectId, snapshotId) {
      return readResult<ResearchSnapshot | undefined>(() => {
        const project = validId(projectId, "rprj_"); if (!project.ok) return project;
        const id = validId(snapshotId, "rsnp_"); if (!id.ok) return id;
        const row = db.get<{ data: string }>(
          "SELECT data FROM research_snapshots WHERE project_id = ? AND snapshot_id = ?",
          project.value, id.value,
        );
        return row === undefined ? { ok: true, value: undefined } : decodeDomainJson(row.data, parseResearchSnapshot);
      });
    },
    listByEpisode(projectId, episodeId, page) {
      const episode = validId(episodeId, "repi_"); if (!episode.ok) return episode;
      return readResult(() => pageRows(db, {
        table: "research_snapshots", idColumn: "snapshot_id", idPrefix: "rsnp_",
        projectId, where: "project_id = ? AND episode_id = ?", params: [projectId, episode.value],
        page, parser: parseResearchSnapshot,
      }));
    },
  };

  const roomReceipts: ResearchRepositories["roomReceipts"] = {
    create(value) {
      return writeResult(db, () => {
        const parsed = parseResearchRoomReceipt(value); if (!parsed.ok) return parsed;
        const project = requireProject(db, parsed.value.projectId); if (!project.ok) return project;
        if (db.get("SELECT receipt_id FROM research_room_receipts WHERE receipt_id = ? OR (project_id = ? AND review_id = ?)", parsed.value.id, parsed.value.projectId, parsed.value.reviewId)) return { ok: false, error: researchError("version_conflict") };
        if (parsed.value.sourceEpisodeId !== undefined && db.get("SELECT episode_id FROM revision_episodes WHERE project_id = ? AND episode_id = ?", parsed.value.projectId, parsed.value.sourceEpisodeId) === undefined) return notFound();
        const data = encodeDomainJson(parsed.value, parseResearchRoomReceipt); if (!data.ok) return data;
        db.run(
          `INSERT INTO research_room_receipts
             (receipt_id, project_id, review_id, source_episode_id, status, disposition, provider_status,
              evidence_class, counts_as_external_evidence, version, receipt_hash, created_at, updated_at, data)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
          parsed.value.id, parsed.value.projectId, parsed.value.reviewId, parsed.value.sourceEpisodeId ?? null,
          parsed.value.status, parsed.value.disposition.kind, parsed.value.providerStatus, parsed.value.evidenceClass,
          parsed.value.version, parsed.value.receiptHash, parsed.value.createdAt, parsed.value.updatedAt, data.value,
        );
        return parsed;
      });
    },
    getById(projectId, receiptId) {
      return readResult<ResearchRoomReceipt | undefined>(() => {
        const project = validId(projectId, "rprj_"); const id = validId(receiptId, "rrcp_"); if (!project.ok || !id.ok) return { ok: false, error: researchError("invalid_research_room_receipt") };
        const row = db.get<{ data: string }>("SELECT data FROM research_room_receipts WHERE project_id = ? AND receipt_id = ?", project.value, id.value);
        return row === undefined ? { ok: true, value: undefined } : decodeDomainJson(row.data, parseResearchRoomReceipt);
      });
    },
    listByProject(projectId, page) {
      return readResult(() => pageRows(db, {
        table: "research_room_receipts", idColumn: "receipt_id", idPrefix: "rrcp_",
        projectId, where: "project_id = ?", params: [projectId], page, parser: parseResearchRoomReceipt,
      }));
    },
    compareAndSwap(value, expectedVersion) {
      return writeResult(db, () => {
        const next = parseResearchRoomReceipt(value); const expected = parseEntityVersion(expectedVersion); if (!next.ok || !expected.ok) return { ok: false, error: researchError("invalid_research_room_receipt") };
        const row = db.get<{ data: string }>("SELECT data FROM research_room_receipts WHERE project_id = ? AND receipt_id = ? AND version = ?", next.value.projectId, next.value.id, expected.value);
        if (row === undefined) return { ok: false, error: researchError("version_conflict") };
        const current = decodeDomainJson(row.data, parseResearchRoomReceipt); if (!current.ok) return current;
        const versions = requireExpectedNext(current.value.version, expected.value, next.value.version); if (!versions.ok) return versions;
        const immutable = (receipt: ResearchRoomReceipt) => {
          const fields: Record<string, unknown> = { ...receipt };
          for (const key of ["status", "rollback", "version", "updatedAt", "receiptHash"]) Reflect.deleteProperty(fields, key);
          return fields;
        };
        const immutableCurrent = immutable(current.value);
        const immutableNext = immutable(next.value);
        if (current.value.status !== "committed" || next.value.status !== "rolled_back" || !current.value.rollback.available || next.value.rollback.available || !sameValue(immutableCurrent, immutableNext)) return { ok: false, error: researchError("version_conflict") };
        const data = encodeDomainJson(next.value, parseResearchRoomReceipt); if (!data.ok) return data;
        const update = db.run(
          `UPDATE research_room_receipts SET status = ?, version = ?, receipt_hash = ?, updated_at = ?, data = ?
           WHERE project_id = ? AND receipt_id = ? AND version = ?`,
          next.value.status, next.value.version, next.value.receiptHash, next.value.updatedAt, data.value,
          next.value.projectId, next.value.id, expected.value,
        );
        return Number(update.changes) === 1 ? next : { ok: false, error: researchError("version_conflict") };
      });
    },
  };

  return Object.freeze({ projects, artifacts, revisions, briefs, decisions, issues, episodes, snapshots, roomReceipts, ...createArgumentGraphRepositories(db) });
}
