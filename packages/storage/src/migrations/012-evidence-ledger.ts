import {
  ActorProvenanceSchema,
  AssertionSourceRefSchema,
  ConfirmationSourceSchema,
  EvidenceItemSchema,
  MAX_ASSERTION_CONFIRMATIONS,
  MAX_ASSERTION_LIMITATIONS,
  MAX_ASSERTION_SOURCE_REFS,
  MAX_CLAIM_EVIDENCE_REFS,
  MAX_CLAIM_LIMITATIONS,
} from "@sestina/schema";
import type { Migration } from "../migrator.js";
import type { StorageDatabase } from "../connection.js";

// ── Evidence ledger (docs/22 Task 10, docs/09 §15/§21) ──
// 1) Version columns for CAS on situation_assertions / evidence_items /
//    claims, plus assertion kind + superseded_by projection columns backfilled
//    from the data JSON (the JSON stays authoritative for the full object).
// 2) task_deliverables: the append-only completion ledger, synced from
//    contracts, with its own history table.
// 3) Append-only history tables for assertions/evidence/claims/deliverables:
//    every status transition writes a row; nothing ever updates them.
// 4) The unique partial index on (project_id, task_id, content_hash) makes
//    evidence hash-dedup a database-level guarantee, scoped per project+task
//    as the spec requires. It is created only AFTER legacy non-hex content
//    hashes have been cleared, so pre-Task-10 values like 'h' can neither
//    trip the unique constraint nor survive as bogus dedup anchors.
// 5) Query indexes for CompletionFacts: open critical claims, tool-failure
//    events, open review items and per-task listing.
// 6) Legacy pre-provenance rows (written by the Task 6-era schemas) are
//    normalized honestly: provenance becomes the runtime (never a user),
//    confirmed_fact without a legal confirmation source is demoted to
//    reported_fact, unknown/unavailable get a structured missingReason, and
//    loose sourceRefs become typed evidence refs. Nothing is fabricated as
//    user-authored or confirmed.
const DDL = `
ALTER TABLE situation_assertions ADD COLUMN kind TEXT NOT NULL DEFAULT 'reported_fact';
ALTER TABLE situation_assertions ADD COLUMN superseded_by TEXT;
ALTER TABLE situation_assertions ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE evidence_items ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE claims ADD COLUMN importance TEXT NOT NULL DEFAULT 'supporting';
ALTER TABLE claims ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE claims ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;

ALTER TABLE claim_evidence ADD COLUMN relation TEXT NOT NULL DEFAULT 'context';
ALTER TABLE claim_evidence ADD COLUMN strength TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE claim_evidence ADD COLUMN actor TEXT NOT NULL DEFAULT '{"actor":"system","channel":"runtime","directUser":false}';
ALTER TABLE claim_evidence ADD COLUMN linked_at INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX idx_tasks_project_task_identity
  ON tasks(project_id, task_id);

CREATE TABLE task_deliverables (
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  deliverable_id TEXT NOT NULL,
  status TEXT NOT NULL,
  version INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (project_id, task_id, deliverable_id),
  FOREIGN KEY (project_id, task_id)
    REFERENCES tasks(project_id, task_id) ON DELETE CASCADE
) STRICT;
CREATE INDEX idx_task_deliverables_project_task
  ON task_deliverables(project_id, task_id, deliverable_id);

CREATE TABLE assertion_history (
  history_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  assertion_id TEXT NOT NULL,
  action TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  expected_version INTEGER NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT,
  at INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_assertion_history_assertion
  ON assertion_history(project_id, assertion_id, at, history_id);

CREATE TABLE evidence_history (
  history_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  evidence_id TEXT NOT NULL,
  action TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  expected_version INTEGER NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT,
  at INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_evidence_history_evidence
  ON evidence_history(project_id, evidence_id, at, history_id);

CREATE TABLE claim_history (
  history_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  claim_id TEXT NOT NULL,
  action TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  expected_version INTEGER NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT,
  at INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_claim_history_claim
  ON claim_history(project_id, claim_id, at, history_id);

CREATE TABLE deliverable_history (
  history_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  deliverable_id TEXT NOT NULL,
  action TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  expected_version INTEGER NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT,
  at INTEGER NOT NULL,
  FOREIGN KEY (project_id, task_id, deliverable_id)
    REFERENCES task_deliverables(project_id, task_id, deliverable_id) ON DELETE CASCADE
) STRICT;
CREATE INDEX idx_deliverable_history_deliverable
  ON deliverable_history(project_id, task_id, deliverable_id, at, history_id);

CREATE INDEX idx_assertions_superseded_by
  ON situation_assertions(superseded_by)
  WHERE superseded_by IS NOT NULL;

CREATE INDEX idx_claims_task_importance
  ON claims(project_id, task_id, importance, status);

CREATE INDEX idx_claims_project_task_created
  ON claims(project_id, task_id, created_at, claim_id);

CREATE INDEX idx_events_tool_failure
  ON events(project_id, task_id, occurred_at, event_id)
  WHERE event_type = 'tool_failure';

CREATE INDEX idx_review_items_task_status
  ON review_items(project_id, task_id, status);
CREATE INDEX idx_review_items_project_task_created
  ON review_items(project_id, task_id, created_at, review_id);
`;

const BACKFILL = `
  UPDATE situation_assertions SET
    kind = COALESCE(json_extract(data, '$.kind'), 'reported_fact'),
    superseded_by = json_extract(data, '$.supersededBy'),
    version = MAX(1, CAST(COALESCE(json_extract(data, '$.version'), 1) AS INTEGER));
  UPDATE evidence_items SET
    version = MAX(1, CAST(COALESCE(json_extract(data, '$.version'), 1) AS INTEGER));
  UPDATE claims SET
    importance = COALESCE(json_extract(data, '$.importance'), 'supporting'),
    version = MAX(1, CAST(COALESCE(json_extract(data, '$.version'), 1) AS INTEGER)),
    created_at = COALESCE(
      CAST(strftime('%s', json_extract(data, '$.createdAt')) AS INTEGER) * 1000,
      0
    );
`;

const CONTENT_HASH_UNIQUE_INDEX = `
CREATE UNIQUE INDEX idx_evidence_task_content_hash
  ON evidence_items(project_id, task_id, content_hash)
  WHERE content_hash != '';
`;

const HEX64 = /^[a-f0-9]{64}$/;
const RUNTIME_PROVENANCE = { actor: "system", channel: "runtime", directUser: false } as const;

function clearEvidenceHash(
  db: StorageDatabase,
  row: { evidence_id: string; data: string },
): void {
  let data = row.data;
  try {
    const parsed = JSON.parse(row.data) as Record<string, unknown>;
    delete parsed.contentHash;
    data = JSON.stringify(parsed);
  } catch {
    // The projection must still be safe even if an unrelated corrupt legacy
    // JSON payload cannot be repaired by this migration.
  }
  db.run(
    "UPDATE evidence_items SET content_hash = '', data = ? WHERE evidence_id = ?",
    data,
    row.evidence_id,
  );
}

/**
 * Reconciles legacy hashes before the unique index is created. Invalid hashes
 * are removed. For a legitimate duplicate, the lexicographically first row
 * remains the dedup anchor and later rows lose both projection and JSON hash.
 */
function reconcileLegacyContentHashes(db: StorageDatabase): void {
  const rows = db.all<{
    evidence_id: string;
    project_id: string;
    task_id: string | null;
    content_hash: string;
    data: string;
  }>(
    `SELECT evidence_id, project_id, task_id, content_hash, data
     FROM evidence_items
     WHERE content_hash != ''
     ORDER BY project_id, task_id, content_hash, evidence_id`,
  );
  const seen = new Set<string>();
  for (const row of rows) {
    const scope = JSON.stringify([row.project_id, row.task_id, row.content_hash]);
    if (!HEX64.test(row.content_hash) || seen.has(scope)) {
      clearEvidenceHash(db, row);
      continue;
    }
    seen.add(scope);
  }
}

interface LegacyEvidenceRow {
  evidence_id: string;
  project_id: string;
  task_id: string | null;
  type: string;
  status: string;
  excerpt: string | null;
  content_hash: string;
  recorded_by: string;
  observed_at: number;
  expires_at: number | null;
  version: number;
  data: string;
}

function legacyTimestamp(ms: number, row: LegacyEvidenceRow, field: string): string {
  try {
    return new Date(ms).toISOString();
  } catch {
    throw new Error(
      `Migration 012 cannot normalize evidence ${row.evidence_id}: ${field} is not a valid timestamp`,
    );
  }
}

/**
 * Reassembles every legacy row exactly as the repository will read it. Safe
 * payload-only defects are repaired; identity and locator defects fail the
 * migration, preventing a database that upgrades successfully but cannot be
 * read through the Task 10 schema.
 */
function normalizeLegacyEvidence(db: StorageDatabase): void {
  const rows = db.all<LegacyEvidenceRow>(
    `SELECT evidence_id, project_id, task_id, type, status, excerpt, content_hash,
            recorded_by, observed_at, expires_at, version, data
     FROM evidence_items
     ORDER BY evidence_id`,
  );
  for (const row of rows) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(row.data) as Record<string, unknown>;
    } catch {
      throw new Error(
        `Migration 012 cannot normalize evidence ${row.evidence_id}: data is not valid JSON`,
      );
    }
    const jsonTaskId = typeof parsed.taskId === "string" ? parsed.taskId : undefined;
    if (row.task_id !== null && jsonTaskId !== undefined && jsonTaskId !== row.task_id) {
      throw new Error(
        `Migration 012 cannot normalize evidence ${row.evidence_id}: task identity differs between projection and data`,
      );
    }
    const taskId = row.task_id ?? jsonTaskId;
    const taskInProject = taskId === undefined
      ? undefined
      : db.get<{ task_id: string }>(
          "SELECT task_id FROM tasks WHERE task_id = ? AND project_id = ?",
          taskId,
          row.project_id,
        );
    if (taskId === undefined || taskInProject === undefined) {
      throw new Error(
        `Migration 012 cannot normalize evidence ${row.evidence_id}: task identity is missing or outside the evidence project`,
      );
    }
    const rawLocator = parsed.locator;
    const locator =
      rawLocator !== null && typeof rawLocator === "object" && !Array.isArray(rawLocator)
        ? { ...(rawLocator as Record<string, unknown>) }
        : rawLocator;
    if (
      locator !== null &&
      typeof locator === "object" &&
      "contentHash" in locator &&
      (typeof locator.contentHash !== "string" || !HEX64.test(locator.contentHash))
    ) {
      delete locator.contentHash;
    }
    const excerpt = row.excerpt === null ? undefined : row.excerpt.slice(0, 5_000);
    const provenance =
      typeof parsed.provenance === "string"
        ? parsed.provenance.slice(0, 2_000)
        : parsed.provenance;
    const candidate = {
      ...parsed,
      evidenceId: row.evidence_id,
      taskId,
      type: row.type,
      locator,
      excerpt,
      contentHash: row.content_hash || undefined,
      status: row.status,
      provenance,
      recordedBy: row.recorded_by,
      observedAt: legacyTimestamp(row.observed_at, row, "observed_at"),
      expiresAt:
        row.expires_at === null
          ? undefined
          : legacyTimestamp(row.expires_at, row, "expires_at"),
      version: row.version,
    };
    const normalized = EvidenceItemSchema.safeParse(candidate);
    if (!normalized.success) {
      const issues = normalized.error.issues
        .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
        .join("; ");
      throw new Error(
        `Migration 012 cannot normalize evidence ${row.evidence_id}: ${issues}`,
      );
    }
    db.run(
      `UPDATE evidence_items SET task_id = ?, excerpt = ?, data = ?
       WHERE evidence_id = ? AND project_id = ?`,
      taskId,
      normalized.data.excerpt ?? null,
      JSON.stringify(normalized.data),
      row.evidence_id,
      row.project_id,
    );
  }
}

function isTypedSourceRef(value: unknown): boolean {
  return AssertionSourceRefSchema.safeParse(value).success;
}

/**
 * Normalizes one legacy assertion JSON into the Task 10 shape and resyncs the
 * projection columns from the normalized JSON (kind may be demoted). Returns
 * null when nothing needed to change.
 */
function normalizeAssertionData(
  row: { assertion_id: string; valid_from: number | null; data: string },
): {
  data: string;
  kind: string;
  supersededBy: string | null;
  version: number;
} | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(row.data) as Record<string, unknown>;
  } catch {
    return null;
  }
  let dirty = false;
  if (!ActorProvenanceSchema.safeParse(parsed.provenance).success) {
    parsed.provenance = RUNTIME_PROVENANCE;
    dirty = true;
  }
  if (typeof parsed.createdAt !== "string") {
    parsed.createdAt = new Date(row.valid_from ?? 0).toISOString();
    dirty = true;
  }
  if (
    !Array.isArray(parsed.sourceRefs) ||
    parsed.sourceRefs.length === 0 ||
    parsed.sourceRefs.length > MAX_ASSERTION_SOURCE_REFS ||
    !parsed.sourceRefs.every(isTypedSourceRef)
  ) {
    // Loose legacy refs (e.g. {ref, type:"path"}) pointed at evidence
    // locators; typed refs that are already valid survive untouched.
    const converted = Array.isArray(parsed.sourceRefs)
      ? (parsed.sourceRefs as unknown[])
          .map((ref) => {
            if (isTypedSourceRef(ref)) {
              return ref;
            }
            const legacy = ref as { ref?: unknown; refId?: unknown };
            const legacyId = typeof legacy.ref === "string"
              ? legacy.ref
              : typeof legacy.refId === "string"
                ? legacy.refId
                : undefined;
            return legacyId !== undefined && legacyId.length > 0
              ? { refType: "evidence", refId: legacyId.slice(0, 200) }
              : null;
          })
          .filter((ref): ref is { refType: string; refId: string } => ref !== null)
      : [];
    if (converted.length === 0) {
      converted.push({ refType: "evidence", refId: `legacy-assertion:${row.assertion_id}` });
    }
    parsed.sourceRefs = converted.slice(0, MAX_ASSERTION_SOURCE_REFS);
    dirty = true;
  }
  const limitations = Array.isArray(parsed.limitations)
    ? parsed.limitations
        .filter((value): value is string => typeof value === "string")
        .slice(0, MAX_ASSERTION_LIMITATIONS)
        .map((value) => value.slice(0, 2000))
    : [];
  if (JSON.stringify(limitations) !== JSON.stringify(parsed.limitations)) {
    parsed.limitations = limitations;
    dirty = true;
  }
  if (Array.isArray(parsed.confirmations)) {
    const confirmations = parsed.confirmations
      .flatMap((value) => {
        const result = ConfirmationSourceSchema.safeParse(value);
        return result.success ? [result.data] : [];
      })
      .slice(0, MAX_ASSERTION_CONFIRMATIONS);
    if (JSON.stringify(confirmations) !== JSON.stringify(parsed.confirmations)) {
      parsed.confirmations = confirmations;
      dirty = true;
    }
  }
  if (parsed.kind === "confirmed_fact") {
    // A legacy confirmed_fact carries no legal ConfirmationSource; high
    // historical confidence is not a confirmation. Honest demotion.
    parsed.kind = "reported_fact";
    dirty = true;
  }
  if (
    (parsed.kind === "unknown" || parsed.kind === "unavailable") &&
    typeof parsed.missingReason !== "object"
  ) {
    parsed.missingReason = {
      reasonKind: "not_resolvable",
      description:
        "legacy row recorded before structured missing reasons existed; the original observation is preserved in the statement",
    };
    dirty = true;
  }
  if (!dirty) {
    return null;
  }
  return {
    data: JSON.stringify(parsed),
    kind: typeof parsed.kind === "string" ? parsed.kind : "reported_fact",
    supersededBy: typeof parsed.supersededBy === "string" ? parsed.supersededBy : null,
    version:
      typeof parsed.version === "number" && Number.isInteger(parsed.version) && parsed.version >= 1
        ? parsed.version
        : 1,
  };
}

function normalizeLegacyAssertions(db: StorageDatabase): void {
  const rows = db.all<{ assertion_id: string; valid_from: number | null; data: string }>(
    "SELECT assertion_id, valid_from, data FROM situation_assertions",
  );
  for (const row of rows) {
    const normalized = normalizeAssertionData(row);
    if (normalized) {
      db.run(
        "UPDATE situation_assertions SET kind = ?, superseded_by = ?, version = ?, data = ? WHERE assertion_id = ?",
        normalized.kind,
        normalized.supersededBy,
        normalized.version,
        normalized.data,
        row.assertion_id,
      );
    }
  }
}

function normalizeLegacyClaims(db: StorageDatabase): void {
  const rows = db.all<{ claim_id: string; data: string }>(
    "SELECT claim_id, data FROM claims",
  );
  for (const row of rows) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(row.data) as Record<string, unknown>;
    } catch {
      continue;
    }
    let dirty = false;
    if (!ActorProvenanceSchema.safeParse(parsed.provenance).success) {
      parsed.provenance = RUNTIME_PROVENANCE;
      dirty = true;
    }
    const evidenceRefs = Array.isArray(parsed.evidenceRefs)
      ? parsed.evidenceRefs
          .filter((value): value is string =>
            typeof value === "string" && value.length > 0 && value.length <= 64)
          .slice(0, MAX_CLAIM_EVIDENCE_REFS)
      : [];
    if (JSON.stringify(evidenceRefs) !== JSON.stringify(parsed.evidenceRefs)) {
      parsed.evidenceRefs = evidenceRefs;
      dirty = true;
    }
    const limitations = Array.isArray(parsed.limitations)
      ? parsed.limitations
          .filter((value): value is string => typeof value === "string")
          .slice(0, MAX_CLAIM_LIMITATIONS)
          .map((value) => value.slice(0, 2000))
      : [];
    if (JSON.stringify(limitations) !== JSON.stringify(parsed.limitations)) {
      parsed.limitations = limitations;
      dirty = true;
    }
    if (dirty) {
      db.run("UPDATE claims SET data = ? WHERE claim_id = ?", JSON.stringify(parsed), row.claim_id);
    }
  }
}

export const migration012: Migration = {
  version: 12,
  name: "012-evidence-ledger",
  up(db: StorageDatabase): void {
    db.exec(DDL);
    // Backfill projection columns from the data JSON (COALESCE keeps the
    // safe column default when the JSON lacks the key).
    db.exec(BACKFILL);
    // Honest normalization of pre-provenance ledger rows (see header note 6).
    normalizeLegacyAssertions(db);
    normalizeLegacyClaims(db);
    // Invalid and duplicate legacy content hashes must be reconciled before
    // the unique partial index, or a valid duplicate would abort the upgrade.
    reconcileLegacyContentHashes(db);
    normalizeLegacyEvidence(db);
    db.exec(CONTENT_HASH_UNIQUE_INDEX);
  },
};
