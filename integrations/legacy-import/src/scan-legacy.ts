import { existsSync } from "node:fs";
import { TaskContractSchema } from "@sestina/schema";
import { openDatabase, type StorageDatabase } from "@sestina/storage";
import { deterministicResearchId, hashCanonical, safeTimestamp } from "./identity.js";
import {
  LEGACY_IMPORT_MAPPING_VERSION,
  type DeferredLegacyCandidate,
  type LegacyCompletionRow,
  type LegacyContractRow,
  type LegacyCorrectionRow,
  type LegacyEvidenceRow,
  type LegacyProjectRow,
  type LegacyScanItem,
  type LegacyScanResult,
  type LegacySnapshot,
  type UnrecognizedLegacyData,
} from "./types.js";

const EMPTY_COUNTS = Object.freeze({ projects: 0, contracts: 0, corrections: 0, evidence: 0, completion: 0 });
const IMPORT_TABLES = new Set(["projects", "tasks", "contracts", "corrections", "evidence_items"]);
const SYSTEM_TABLES = new Set([
  "migrations", "schema_version", "events", "claims", "decisions", "situation_assertions",
  "deliverables", "contract_versions", "event_delivery", "message_delivery", "outbox",
  "host_sessions", "root_bindings", "session_attachments", "unowned_activity", "reviews",
  "conversations", "collaboration_messages", "notifications", "usage_records", "tombstones",
  "maintenance_fence", "retention_snapshots", "research_projects", "research_artifacts",
  "research_artifact_revisions", "research_briefs", "research_decisions", "research_decision_transitions",
  "research_issues", "research_issue_transitions", "revision_episodes", "research_snapshots",
]);

function tableExists(db: StorageDatabase, name: string): boolean {
  return db.get("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = ?", name) !== undefined;
}

function parseJson(value: string): unknown {
  try { return JSON.parse(value); } catch { return undefined; }
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function normalizeSqliteValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return { blobDigest: hashCanonical([...value]) };
  if (Array.isArray(value)) return value.map(normalizeSqliteValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeSqliteValue(item)]));
  }
  return value;
}

function allRows(db: StorageDatabase, table: string): readonly Record<string, unknown>[] {
  const rows = db.all(`SELECT * FROM ${quoteIdentifier(table)}`)
    .map((row) => normalizeSqliteValue(row) as Record<string, unknown>);
  return rows.toSorted((left, right) => hashCanonical(left).localeCompare(hashCanonical(right)));
}

function empty(status: "no_content" | "unavailable", code?: "legacy_source_unavailable"): LegacySnapshot {
  const fingerprint = hashCanonical({ status });
  return {
    scan: Object.freeze({
      status,
      mappingVersion: LEGACY_IMPORT_MAPPING_VERSION,
      sourceFingerprint: fingerprint,
      sourceDatabaseFingerprint: fingerprint,
      counts: EMPTY_COUNTS,
      items: [], deferred: [], unrecognized: [],
      ...(code ? { error: { code, message: "Legacy research source is unavailable" } } : {}),
    }),
    projects: [], contracts: [], corrections: [], evidence: [], completions: [],
  };
}

export async function loadLegacySnapshot(sourcePath: string): Promise<LegacySnapshot> {
  if (!existsSync(sourcePath)) return empty("no_content");
  let db: StorageDatabase | undefined;
  try {
    db = await openDatabase({ path: sourcePath, readOnly: true, migrate: false });
    const tables = db.all<{ name: string }>(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ).map((row) => row.name);
    const readableDb = db;
    const fullDigestInput = tables.map((table) => ({ table, rows: allRows(readableDb, table) }));

    const projects: LegacyProjectRow[] = tableExists(db, "projects")
      ? db.all<{ project_id: string; display_name: string; created_at: string | number; data: string }>(
        "SELECT project_id, display_name, created_at, data FROM projects ORDER BY project_id",
      ).map((row) => ({ projectId: row.project_id, displayName: row.display_name, createdAt: safeTimestamp(row.created_at), data: row.data }))
      : [];
    const contracts: LegacyContractRow[] = tableExists(db, "contracts") && tableExists(db, "tasks")
      ? db.all<{ contract_id: string; task_id: string; project_id: string; data: string }>(
        "SELECT c.contract_id, c.task_id, t.project_id, c.data FROM contracts c JOIN tasks t ON t.task_id = c.task_id ORDER BY c.contract_id",
      ).map((row) => ({ contractId: row.contract_id, taskId: row.task_id, projectId: row.project_id, data: row.data }))
      : [];
    const corrections: LegacyCorrectionRow[] = tableExists(db, "corrections")
      ? db.all<{ correction_id: string; project_id: string; task_id: string | null; data: string }>(
        "SELECT correction_id, project_id, task_id, data FROM corrections ORDER BY correction_id",
      ).map((row) => ({ correctionId: row.correction_id, projectId: row.project_id, ...(row.task_id ? { taskId: row.task_id } : {}), data: row.data }))
      : [];
    const evidence: LegacyEvidenceRow[] = tableExists(db, "evidence_items")
      ? db.all<{ evidence_id: string; project_id: string; task_id: string | null; data: string }>(
        "SELECT evidence_id, project_id, task_id, data FROM evidence_items ORDER BY evidence_id",
      ).map((row) => ({ evidenceId: row.evidence_id, projectId: row.project_id, ...(row.task_id ? { taskId: row.task_id } : {}), data: row.data }))
      : [];
    const completions: LegacyCompletionRow[] = [];
    for (const row of contracts) {
      const parsed = TaskContractSchema.safeParse(parseJson(row.data));
      if (!parsed.success) continue;
      for (const deliverable of parsed.data.deliverables) {
        if (deliverable.status !== "satisfied") continue;
        completions.push({
          completionId: `${row.contractId}:${deliverable.deliverableId}`,
          contractId: row.contractId,
          projectId: row.projectId,
          data: JSON.stringify({ deliverableId: deliverable.deliverableId, evidenceRefs: deliverable.evidenceRefs }),
        });
      }
    }

    const identities = [
      ...projects.map((row) => ["project", row.projectId]),
      ...contracts.map((row) => ["contract", row.contractId]),
      ...corrections.map((row) => ["correction", row.correctionId]),
      ...evidence.map((row) => ["evidence", row.evidenceId]),
      ...completions.map((row) => ["completion", row.completionId]),
    ].toSorted((a, b) => `${a[0]}:${a[1]}`.localeCompare(`${b[0]}:${b[1]}`));
    const sourceDatabaseFingerprint = hashCanonical({ identities });

    const item = (
      kind: LegacyScanItem["kind"], legacyId: string, legacyProjectId: string | undefined,
      data: string, mappingStatus: LegacyScanItem["mappingStatus"], targetIds: readonly string[],
    ): LegacyScanItem => Object.freeze({
      planItemId: hashCanonical({ kind, legacyId, sourceDatabaseFingerprint, version: LEGACY_IMPORT_MAPPING_VERSION }),
      kind, legacyId, ...(legacyProjectId ? { legacyProjectId } : {}),
      sourceDigest: hashCanonical({ data }), mappingStatus, targetIds,
    });
    const target = (prefix: Parameters<typeof deterministicResearchId>[0], kind: string, id: string, role: string) =>
      deterministicResearchId(prefix, sourceDatabaseFingerprint, kind, id, role, LEGACY_IMPORT_MAPPING_VERSION);
    const items: LegacyScanItem[] = [
      ...projects.map((row) => item("project", row.projectId, row.projectId, row.data, "mappable", [target("rprj_", "project", row.projectId, "project")])),
      ...contracts.map((row) => item("contract", row.contractId, row.projectId, row.data, "mappable", [
        target("rart_", "contract", row.contractId, "support-artifact"),
        target("rbrf_", "contract", row.contractId, "brief"),
      ])),
      ...corrections.map((row) => item("correction", row.correctionId, row.projectId, row.data, "mappable", [target("rdec_", "correction", row.correctionId, "decision")])),
      ...evidence.map((row) => item("evidence", row.evidenceId, row.projectId, row.data, "deferred", [])),
      ...completions.map((row) => item("completion", row.completionId, row.projectId, row.data, "deferred", [])),
    ].toSorted((left, right) => left.planItemId.localeCompare(right.planItemId));
    const deferred: DeferredLegacyCandidate[] = items.filter((candidate) => candidate.mappingStatus === "deferred").map((candidate) => ({
      planItemId: candidate.planItemId,
      kind: candidate.kind as "evidence" | "completion",
      legacyId: candidate.legacyId,
      sourceDigest: candidate.sourceDigest,
      reason: candidate.kind === "evidence" ? "research_evidence_domain_unavailable" : "episode_acceptance_requires_user",
      authority: "imported_unconfirmed",
    }));
    const unrecognized: UnrecognizedLegacyData[] = [];
    for (const table of tables) {
      if (IMPORT_TABLES.has(table) || SYSTEM_TABLES.has(table) || table.includes("_fts")) continue;
      const rows = allRows(db, table);
      unrecognized.push({ legacyType: table, rowCount: rows.length, contentDigest: hashCanonical(rows), reason: "unsupported_legacy_table" });
    }
    const sourceFingerprint = hashCanonical(fullDigestInput);
    return {
      scan: Object.freeze({
        status: items.length === 0 && unrecognized.length === 0 ? "no_content" : "ready",
        mappingVersion: LEGACY_IMPORT_MAPPING_VERSION,
        sourceFingerprint,
        sourceDatabaseFingerprint,
        counts: Object.freeze({ projects: projects.length, contracts: contracts.length, corrections: corrections.length, evidence: evidence.length, completion: completions.length }),
        items: Object.freeze(items), deferred: Object.freeze(deferred), unrecognized: Object.freeze(unrecognized),
      }),
      projects, contracts, corrections, evidence, completions,
    };
  } catch {
    return empty("unavailable", "legacy_source_unavailable");
  } finally {
    db?.close();
  }
}

export async function scanLegacyDatabase(sourcePath: string): Promise<LegacyScanResult> {
  return (await loadLegacySnapshot(sourcePath)).scan;
}
