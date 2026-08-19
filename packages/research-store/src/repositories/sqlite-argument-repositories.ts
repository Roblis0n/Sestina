import {
  parseArgumentClaim, parseArgumentDelta, parseArgumentEvidence, parseClaimEvidenceLink, parseEntityVersion,
  parseMechanismEvidenceLink, parseMechanismLink, parseResearchIdFor, parseResearchPageRequest, researchError,
  type ArgumentGraphRepositories, type EntityVersion, type ResearchIdPrefix, type ResearchPage, type ResearchPageRequest,
  type ResearchResult,
} from "@sestina/research";
import type { StorageDatabase } from "@sestina/storage";
import { decodeDomainJson, encodeDomainJson } from "../mappers/domain-json.js";
import { immutablePage, readResult, requireExpectedNext, writeResult } from "./base.js";
import { decodeCursor, encodeCursor } from "./pagination.js";

interface Versioned { readonly id: string; readonly projectId: string; readonly version: EntityVersion; readonly source: { readonly recordedAt: string } }
type Parser<T> = (input: unknown) => ResearchResult<T>;
interface NodeConfig<T extends Versioned> { readonly table: string; readonly idColumn: string; readonly prefix: ResearchIdPrefix; readonly parser: Parser<T>; readonly columns: (value: T) => Readonly<Record<string, string | null>>; readonly validate?: (value: T) => ResearchResult<void>; }

function nodeRepository<T extends Versioned>(db: StorageDatabase, config: NodeConfig<T>) {
  return {
    create(value: T): ResearchResult<T> {
      return writeResult(db, () => {
        const parsed = config.parser(value); if (!parsed.ok) return parsed;
        if (parsed.value.version !== 1) return { ok: false, error: researchError("version_conflict") };
        const valid = config.validate?.(parsed.value); if (valid !== undefined && !valid.ok) return valid;
        const data = encodeDomainJson(parsed.value, config.parser); if (!data.ok) return data;
        const extra = config.columns(parsed.value); const names = Object.keys(extra); const placeholders = names.map(() => "?");
        db.run(`INSERT INTO ${config.table} (${config.idColumn}, project_id, ${names.join(", ")}, version, created_at, data) VALUES (?, ?, ${placeholders.join(", ")}, ?, ?, ?)`, parsed.value.id, parsed.value.projectId, ...Object.values(extra), parsed.value.version, parsed.value.source.recordedAt, data.value);
        return parsed;
      });
    },
    getById(projectId: string, id: string): ResearchResult<T | undefined> {
      return readResult<T | undefined>(() => {
        const project = parseResearchIdFor(projectId, "rprj_"); const entity = parseResearchIdFor(id, config.prefix); if (!project.ok || !entity.ok) return { ok: false, error: researchError("research_record_not_found") };
        const row = db.get<{ data: string }>(`SELECT data FROM ${config.table} WHERE project_id = ? AND ${config.idColumn} = ?`, project.value.id, entity.value.id);
        return row === undefined ? { ok: true, value: undefined } : decodeDomainJson(row.data, config.parser);
      });
    },
    listByProject(projectId: string, pageInput: ResearchPageRequest): ResearchResult<ResearchPage<T>> {
      return readResult(() => {
        const project = parseResearchIdFor(projectId, "rprj_"); const page = parseResearchPageRequest(pageInput); if (!project.ok || !page.ok) return { ok: false, error: researchError("invalid_pagination") };
        const cursor = decodeCursor(page.value, project.value.id); if (!cursor.ok) return cursor;
        const rows = db.all<{ entity_id: string; created_at: string; data: string }>(`SELECT ${config.idColumn} AS entity_id, created_at, data FROM ${config.table} WHERE project_id = ? ${cursor.value ? `AND (created_at > ? OR (created_at = ? AND ${config.idColumn} > ?))` : ""} ORDER BY created_at, ${config.idColumn} LIMIT ?`, project.value.id, ...(cursor.value ? [cursor.value.sortKey, cursor.value.sortKey, cursor.value.id] : []), page.value.limit + 1);
        const selected = rows.slice(0, page.value.limit); const items: T[] = []; for (const row of selected) { const decoded = decodeDomainJson(row.data, config.parser); if (!decoded.ok) return decoded; items.push(decoded.value); }
        const last = selected.at(-1); return { ok: true, value: immutablePage(items, rows.length > page.value.limit && last ? encodeCursor(project.value.id, last.created_at, last.entity_id) : undefined) };
      });
    },
    compareAndSwap(value: T, expectedVersion: EntityVersion): ResearchResult<T> {
      return writeResult(db, () => {
        const next = config.parser(value); const expected = parseEntityVersion(expectedVersion); if (!next.ok || !expected.ok) return next.ok ? { ok: false, error: researchError("version_conflict") } : next;
        const valid = config.validate?.(next.value); if (valid !== undefined && !valid.ok) return valid;
        const row = db.get<{ data: string }>(`SELECT data FROM ${config.table} WHERE project_id = ? AND ${config.idColumn} = ? AND version = ?`, next.value.projectId, next.value.id, expected.value); if (!row) return { ok: false, error: researchError("version_conflict") };
        const current = decodeDomainJson(row.data, config.parser); if (!current.ok) return current; const versions = requireExpectedNext(current.value.version, expected.value, next.value.version); if (!versions.ok) return versions;
        const data = encodeDomainJson(next.value, config.parser); if (!data.ok) return data;
        const extra = config.columns(next.value); const names = Object.keys(extra);
        const changed = db.run(`UPDATE ${config.table} SET ${names.map((name) => `${name} = ?`).join(", ")}, version = ?, data = ? WHERE project_id = ? AND ${config.idColumn} = ? AND version = ?`, ...Object.values(extra), next.value.version, data.value, next.value.projectId, next.value.id, expected.value);
        return Number(changed.changes) === 1 ? next : { ok: false, error: researchError("version_conflict") };
      });
    },
  };
}

function linkRepository<T extends { readonly projectId: string; readonly version: EntityVersion; readonly source: { readonly recordedAt: string } }>(db: StorageDatabase, config: { table: string; leftColumn: string; rightColumn: string; leftPrefix: ResearchIdPrefix; rightPrefix: ResearchIdPrefix; parser: Parser<T>; keys(value: T): readonly [string, string]; columns(value: T): Readonly<Record<string, string | number>>; validate?: (value: T) => ResearchResult<void> }) {
  return {
    create(value: T): ResearchResult<T> { return writeResult(db, () => { const parsed = config.parser(value); if (!parsed.ok) return parsed; if (parsed.value.version !== 1) return { ok: false, error: researchError("version_conflict") }; const valid = config.validate?.(parsed.value); if (valid !== undefined && !valid.ok) return valid; const [left, right] = config.keys(parsed.value); const data = encodeDomainJson(parsed.value, config.parser); if (!data.ok) return data; const extra = config.columns(parsed.value); const names = Object.keys(extra); db.run(`INSERT INTO ${config.table} (project_id, ${config.leftColumn}, ${config.rightColumn}, ${names.join(", ")}, version, created_at, data) VALUES (?, ?, ?, ${names.map(() => "?").join(", ")}, ?, ?, ?)`, parsed.value.projectId, left, right, ...Object.values(extra), 1, parsed.value.source.recordedAt, data.value); return parsed; }); },
    get(projectId: string, leftId: string, rightId: string): ResearchResult<T | undefined> { return readResult<T | undefined>(() => { const project = parseResearchIdFor(projectId, "rprj_"); const left = parseResearchIdFor(leftId, config.leftPrefix); const right = parseResearchIdFor(rightId, config.rightPrefix); if (!project.ok || !left.ok || !right.ok) return { ok: false, error: researchError("research_record_not_found") }; const row = db.get<{ data: string }>(`SELECT data FROM ${config.table} WHERE project_id = ? AND ${config.leftColumn} = ? AND ${config.rightColumn} = ?`, project.value.id, left.value.id, right.value.id); return row ? decodeDomainJson(row.data, config.parser) : { ok: true, value: undefined }; }); },
    listByProject(projectId: string, pageInput: ResearchPageRequest): ResearchResult<ResearchPage<T>> { return readResult(() => { const project = parseResearchIdFor(projectId, "rprj_"); const page = parseResearchPageRequest(pageInput); if (!project.ok || !page.ok || page.value.cursor !== undefined) return { ok: false, error: researchError("invalid_pagination") }; const rows = db.all<{ data: string }>(`SELECT data FROM ${config.table} WHERE project_id = ? ORDER BY created_at, ${config.leftColumn}, ${config.rightColumn} LIMIT ?`, project.value.id, page.value.limit); const items: T[] = []; for (const row of rows) { const decoded = decodeDomainJson(row.data, config.parser); if (!decoded.ok) return decoded; items.push(decoded.value); } return { ok: true, value: immutablePage(items, undefined) }; }); },
    compareAndSwap(value: T, expectedVersion: EntityVersion): ResearchResult<T> { return writeResult(db, () => { const next = config.parser(value); const expected = parseEntityVersion(expectedVersion); if (!next.ok || !expected.ok) return next.ok ? { ok: false, error: researchError("version_conflict") } : next; const valid = config.validate?.(next.value); if (valid !== undefined && !valid.ok) return valid; const [left, right] = config.keys(next.value); const row = db.get<{ data: string }>(`SELECT data FROM ${config.table} WHERE project_id = ? AND ${config.leftColumn} = ? AND ${config.rightColumn} = ? AND version = ?`, next.value.projectId, left, right, expected.value); if (!row) return { ok: false, error: researchError("version_conflict") }; const current = decodeDomainJson(row.data, config.parser); if (!current.ok) return current; const versions = requireExpectedNext(current.value.version, expected.value, next.value.version); if (!versions.ok) return versions; const data = encodeDomainJson(next.value, config.parser); if (!data.ok) return data; const extra = config.columns(next.value); const names = Object.keys(extra); const changed = db.run(`UPDATE ${config.table} SET ${names.map((name) => `${name} = ?`).join(", ")}, version = ?, data = ? WHERE project_id = ? AND ${config.leftColumn} = ? AND ${config.rightColumn} = ? AND version = ?`, ...Object.values(extra), next.value.version, data.value, next.value.projectId, left, right, expected.value); return Number(changed.changes) === 1 ? next : { ok: false, error: researchError("version_conflict") }; }); },
  };
}

export function createArgumentGraphRepositories(db: StorageDatabase): ArgumentGraphRepositories {
  const claims = nodeRepository(db, { table: "argument_claims", idColumn: "claim_id", prefix: "rclm_", parser: parseArgumentClaim, columns: (value) => ({ artifact_id: value.artifactId, revision_id: value.revisionId, kind: value.kind }) });
  const argumentEvidence = nodeRepository(db, { table: "argument_evidence", idColumn: "evidence_id", prefix: "revd_", parser: parseArgumentEvidence, columns: (value) => ({ artifact_id: value.artifactId ?? null, revision_id: value.revisionId ?? null, kind: value.kind, state: value.state, inference_capacity: value.inferenceCapacity }) });
  const mechanismLinks = nodeRepository(db, { table: "argument_mechanism_links", idColumn: "mechanism_link_id", prefix: "rmec_", parser: parseMechanismLink, columns: (value) => ({ artifact_id: value.artifactId, revision_id: value.revisionId, from_claim_id: value.fromClaimId, to_claim_id: value.toClaimId }), validate: (value) => { const rows = db.all<{ data: string }>("SELECT data FROM argument_claims WHERE project_id = ? AND claim_id IN (?, ?)", value.projectId, value.fromClaimId, value.toClaimId); if (rows.length !== 2) return { ok: false, error: researchError("research_record_not_found") }; for (const row of rows) { const claim = decodeDomainJson(row.data, parseArgumentClaim); if (!claim.ok || claim.value.artifactId !== value.artifactId || claim.value.revisionId !== value.revisionId) return { ok: false, error: researchError("invalid_mechanism_link") }; } return { ok: true, value: undefined }; } });
  const argumentDeltas = nodeRepository(db, { table: "argument_deltas", idColumn: "delta_id", prefix: "rdlt_", parser: parseArgumentDelta, columns: (value) => ({ artifact_id: value.artifactId, baseline_revision_id: value.baselineRevisionId, candidate_revision_id: value.candidateRevisionId, kind: value.kind }), validate: (value) => { for (const evidenceId of value.evidenceLinkIds) { const evidence = db.get<{ artifact_id: string | null; revision_id: string | null }>("SELECT artifact_id, revision_id FROM argument_evidence WHERE project_id = ? AND evidence_id = ?", value.projectId, evidenceId); if (!evidence || (evidence.revision_id !== null && (evidence.artifact_id !== value.artifactId || evidence.revision_id !== value.candidateRevisionId))) return { ok: false, error: researchError("invalid_argument_delta") }; } return { ok: true, value: undefined }; } });
  const claimEvidenceLinks = linkRepository(db, { table: "argument_claim_evidence_links", leftColumn: "claim_id", rightColumn: "evidence_id", leftPrefix: "rclm_", rightPrefix: "revd_", parser: parseClaimEvidenceLink, keys: (value) => [value.claimId, value.evidenceId], columns: (value) => ({ role: value.role, status: value.status }), validate: (value) => { const claim = db.get<{ artifact_id: string; revision_id: string }>("SELECT artifact_id, revision_id FROM argument_claims WHERE project_id = ? AND claim_id = ?", value.projectId, value.claimId); const evidence = db.get<{ artifact_id: string | null; revision_id: string | null }>("SELECT artifact_id, revision_id FROM argument_evidence WHERE project_id = ? AND evidence_id = ?", value.projectId, value.evidenceId); if (!claim || !evidence) return { ok: false, error: researchError("research_record_not_found") }; return evidence.revision_id !== null && (evidence.artifact_id !== claim.artifact_id || evidence.revision_id !== claim.revision_id) ? { ok: false, error: researchError("invalid_evidence_link") } : { ok: true, value: undefined }; } });
  const mechanismEvidenceLinks = linkRepository(db, { table: "argument_mechanism_evidence_links", leftColumn: "mechanism_link_id", rightColumn: "evidence_id", leftPrefix: "rmec_", rightPrefix: "revd_", parser: parseMechanismEvidenceLink, keys: (value) => [value.mechanismLinkId, value.evidenceId], columns: (value) => ({ step_index: value.stepIndex, status: value.status }), validate: (value) => { const mechanism = db.get<{ artifact_id: string; revision_id: string }>("SELECT artifact_id, revision_id FROM argument_mechanism_links WHERE project_id = ? AND mechanism_link_id = ?", value.projectId, value.mechanismLinkId); const evidence = db.get<{ artifact_id: string | null; revision_id: string | null }>("SELECT artifact_id, revision_id FROM argument_evidence WHERE project_id = ? AND evidence_id = ?", value.projectId, value.evidenceId); if (!mechanism || !evidence) return { ok: false, error: researchError("research_record_not_found") }; return evidence.revision_id !== null && (evidence.artifact_id !== mechanism.artifact_id || evidence.revision_id !== mechanism.revision_id) ? { ok: false, error: researchError("invalid_evidence_link") } : { ok: true, value: undefined }; } });
  return Object.freeze({ claims, argumentEvidence, mechanismLinks, claimEvidenceLinks, mechanismEvidenceLinks, argumentDeltas });
}
