import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import {
  MAX_CLAIM_EVIDENCE_REFS,
  generateId,
  type Claim,
  type ClaimEvidenceLink,
  type EvidenceItem,
  type ReviewItem,
  type SituationAssertion,
  type StandardEvent,
} from "@sestina/schema";
import { buildCompletionFacts } from "@sestina/evidence";
import {
  openDatabase,
  createUnitOfWork,
  MIGRATIONS,
  SCHEMA_VERSION,
  previewRetention,
  applyRetentionPreview,
  createTombstoneRepository,
  createTransactionView,
  withTransaction,
  search,
  type StorageDatabase,
} from "../src/index.js";
import { migration012 } from "../src/migrations/012-evidence-ledger.js";
import { makeTempDir, removeTempDir } from "./helpers.js";
import { readLedgerHistory } from "../src/repositories/shared.js";

/** Asserts the call throws a SestinaError with the given code (repo idiom). */
function expectSestinaCode(run: () => unknown, code: string | number): void {
  try {
    run();
  } catch (error) {
    const actual =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : undefined;
    if (actual === String(code)) return;
    throw new Error(`expected code ${code}, got ${actual}`, { cause: error });
  }
  throw new Error(`expected a SestinaError with code ${code}`);
}

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW_MS = Date.parse("2026-08-01T00:00:00.000Z");
const NOW_ISO = "2026-08-01T00:00:00.000Z";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);
const HASH_E = "e".repeat(64);

function actorProvenance(overrides: Record<string, unknown> = {}) {
  return { actor: "agent", channel: "runtime", directUser: false, ...overrides };
}

interface Seed {
  projectId: string;
  taskId: string;
  projectB: string;
  taskB: string;
}

function makeAssertion(seed: Seed, overrides: Record<string, unknown> = {}): SituationAssertion {
  return {
    assertionId: "as-1",
    projectId: seed.projectId,
    taskId: seed.taskId,
    kind: "reported_fact",
    statement: "synthetic statement for tests",
    sourceRefs: [{ refType: "tool_result", refId: "tool-1" }],
    limitations: [],
    status: "active",
    provenance: actorProvenance(),
    createdAt: NOW_ISO,
    version: 1,
    validFrom: NOW_ISO,
    ...overrides,
  } as SituationAssertion;
}

function makeEvidence(seed: Seed, overrides: Record<string, unknown> = {}): EvidenceItem {
  return {
    evidenceId: "ev-1",
    taskId: seed.taskId,
    type: "primary_source",
    locator: { type: "path", value: "synthetic/relative/path.txt" },
    status: "unverified",
    provenance: "synthetic",
    recordedBy: "agent",
    observedAt: NOW_ISO,
    version: 1,
    ...overrides,
  } as EvidenceItem;
}

function makeClaim(seed: Seed, overrides: Record<string, unknown> = {}): Claim {
  return {
    claimId: "cl-1",
    taskId: seed.taskId,
    text: "synthetic claim text",
    type: "factual",
    importance: "supporting",
    confidence: 0.4,
    evidenceRefs: [],
    status: "unverified",
    limitations: [],
    provenance: actorProvenance(),
    createdAt: NOW_ISO,
    version: 1,
    ...overrides,
  } as Claim;
}

function makeReview(seed: Seed, overrides: Record<string, unknown> = {}): ReviewItem {
  return {
    reviewId: generateId(),
    projectId: seed.projectId,
    taskId: seed.taskId,
    trigger: "user_decision_required",
    title: "synthetic review",
    description: "synthetic description",
    requiredDecision: "choose",
    availableActions: ["accept"],
    contextRefs: [],
    status: "open",
    priority: 2,
    openedAt: NOW_ISO,
    version: 1,
    ...overrides,
  } as ReviewItem;
}

function makeToolFailure(seed: Seed, overrides: Record<string, unknown> = {}): StandardEvent {
  return {
    schemaVersion: "1.0.0",
    eventId: generateId(),
    idempotencyKey: `failure-${generateId()}`,
    eventType: "tool_failure",
    host: "codex",
    projectId: seed.projectId,
    taskId: seed.taskId,
    sessionId: generateId(),
    action: {
      toolName: "shell",
      category: "execute",
      reversible: true,
      external: false,
      resourceRefs: [],
      securitySummary: "exit_code 1",
    },
    occurredAt: NOW_ISO,
    receivedAt: NOW_ISO,
    bypass: false,
    privacyClass: "internal",
    rawPayloadHash: "c".repeat(64),
    ...overrides,
  } as StandardEvent;
}

function historyWrite(overrides: Record<string, unknown> = {}) {
  return {
    historyId: generateId(),
    action: "transition",
    fromStatus: null,
    toStatus: "next",
    expectedVersion: 1,
    actorJson: JSON.stringify(actorProvenance()),
    reason: "synthetic reason",
    atMs: NOW_MS,
    ...overrides,
  };
}

describe("Evidence ledger storage (docs/22 Task 10)", () => {
  let dir: string;
  let db: StorageDatabase;

  beforeEach(async () => {
    dir = makeTempDir();
    db = await openDatabase({ path: join(dir, "sestina.db") });
  });
  afterEach(() => {
    db.close();
    removeTempDir(dir);
  });

  function seedProjectTask(): Seed {
    const seed: Seed = {
      projectId: generateId(),
      taskId: generateId(),
      projectB: generateId(),
      taskB: generateId(),
    };
    const uow = createUnitOfWork(db);
    uow.commit((u) => {
      u.projects.insert({
        projectId: seed.projectId, name: "p", bindings: [], status: "active",
        createdAt: NOW_ISO, updatedAt: NOW_ISO,
      });
      u.tasks.insert({
        taskId: seed.taskId, projectId: seed.projectId, title: "t", status: "active",
        priority: "normal", createdAt: NOW_ISO, updatedAt: NOW_ISO,
      });
      u.projects.insert({
        projectId: seed.projectB, name: "pb", bindings: [], status: "active",
        createdAt: NOW_ISO, updatedAt: NOW_ISO,
      });
      u.tasks.insert({
        taskId: seed.taskB, projectId: seed.projectB, title: "tb", status: "active",
        priority: "normal", createdAt: NOW_ISO, updatedAt: NOW_ISO,
      });
    });
    return seed;
  }

  // ── Migration 012 ──

  it("records version 12 as completed with the ledger structures present", () => {
    const row = db.get<{ name: string; status: string }>(
      "SELECT name, status FROM migrations WHERE version = 12",
    );
    expect(row?.name).toBe("012-evidence-ledger");
    expect(row?.status).toBe("completed");
    expect(MIGRATIONS.at(-1)?.version).toBe(SCHEMA_VERSION);
    const tables = new Set(
      db.all<{ name: string }>("SELECT name FROM sqlite_schema WHERE type = 'table'")
        .map((r) => r.name),
    );
    expect(tables.has("task_deliverables")).toBe(true);
    expect(tables.has("assertion_history")).toBe(true);
    expect(tables.has("evidence_history")).toBe(true);
    expect(tables.has("claim_history")).toBe(true);
    expect(tables.has("deliverable_history")).toBe(true);
    const indexes = new Set(
      db.all<{ name: string }>("SELECT name FROM sqlite_schema WHERE type = 'index'")
        .map((r) => r.name),
    );
    expect(indexes.has("idx_evidence_task_content_hash")).toBe(true);
    expect(indexes.has("idx_events_tool_failure")).toBe(true);
    expect(indexes.has("idx_claims_task_importance")).toBe(true);
    expect(indexes.has("idx_task_deliverables_project_task")).toBe(true);
  });

  it("upgrades a v11 database in place and backfills the projection columns", async () => {
    const legacyPath = join(dir, "legacy-012.db");
    const projectId = generateId();
    const taskId = generateId();
    const v11 = await openDatabase({
      path: legacyPath,
      migrate: { migrations: MIGRATIONS.slice(0, 11) },
    });
    v11.run(
      "INSERT INTO projects (project_id, display_name, created_at, data) VALUES (?, 'p', 0, '{}')",
      projectId,
    );
    v11.run(
      `INSERT INTO tasks (task_id, project_id, status, created_at, updated_at, data)
       VALUES (?, ?, 'active', 0, 0, '{}')`,
      taskId,
      projectId,
    );
    const legacyBase = {
      assertionId: "as-legacy",
      projectId,
      taskId,
      statement: "legacy row",
      sourceRefs: [{ refType: "tool_result", refId: "tool-legacy" }],
      limitations: [],
      status: "active",
      provenance: actorProvenance(),
      createdAt: NOW_ISO,
      validFrom: NOW_ISO,
    };
    v11.run(
      `INSERT INTO situation_assertions (assertion_id, project_id, task_id, status, valid_from, valid_until, data)
       VALUES ('as-legacy', ?, ?, 'active', ?, NULL, ?)`,
      projectId,
      taskId,
      NOW_MS,
      JSON.stringify(legacyBase),
    );
    v11.run(
      `INSERT INTO situation_assertions (assertion_id, project_id, task_id, status, valid_from, valid_until, data)
       VALUES ('as-sup', ?, ?, 'superseded', ?, NULL, ?)`,
      projectId,
      taskId,
      NOW_MS,
      JSON.stringify({ ...legacyBase, assertionId: "as-sup", supersededBy: "as-new" }),
    );
    v11.run(
      `INSERT INTO situation_assertions (assertion_id, project_id, task_id, status, valid_from, valid_until, data)
       VALUES ('as-invalid-ref', ?, ?, 'active', ?, NULL, ?)`,
      projectId,
      taskId,
      NOW_MS,
      JSON.stringify({
        ...legacyBase,
        assertionId: "as-invalid-ref",
        sourceRefs: [{ refType: "not-a-real-source", refId: "legacy-ref" }],
      }),
    );
    const legacyClaim = {
      claimId: "cl-legacy",
      taskId,
      text: "legacy claim",
      type: "factual",
      confidence: 0.5,
      evidenceRefs: [],
      status: "unverified",
      limitations: [],
      provenance: actorProvenance(),
      createdAt: NOW_ISO,
    };
    v11.run(
      `INSERT INTO claims (claim_id, project_id, task_id, type, status, confidence, text, data)
       VALUES ('cl-legacy', ?, ?, 'factual', 'unverified', 0.5, 'legacy claim', ?)`,
      projectId,
      taskId,
      JSON.stringify(legacyClaim),
    );
    for (const evidenceId of ["ev-duplicate-a", "ev-duplicate-b"]) {
      v11.run(
        `INSERT INTO evidence_items
           (evidence_id, project_id, task_id, type, status, excerpt, content_hash,
            recorded_by, observed_at, expires_at, data)
         VALUES (?, ?, ?, 'primary_source', 'verified', NULL, ?, 'agent', ?, NULL, ?)`,
        evidenceId,
        projectId,
        taskId,
        HASH_A,
        NOW_MS,
        JSON.stringify({
          evidenceId,
          taskId,
          type: "primary_source",
          locator: { type: "artifact", value: evidenceId },
          contentHash: HASH_A,
          status: "verified",
          provenance: "legacy-import",
          recordedBy: "agent",
          observedAt: NOW_ISO,
          version: 1,
        }),
      );
    }
    v11.run(
      `INSERT INTO evidence_items
         (evidence_id, project_id, task_id, type, status, excerpt, content_hash,
          recorded_by, observed_at, expires_at, data)
       VALUES ('ev-normalize', ?, ?, 'primary_source', 'verified', NULL, ?, 'agent', ?, NULL, ?)`,
      projectId,
      taskId,
      HASH_B,
      NOW_MS,
      JSON.stringify({
        evidenceId: "ev-normalize",
        taskId,
        type: "primary_source",
        locator: {
          type: "artifact",
          value: "legacy-normalization-target",
          contentHash: "not-a-sha256",
        },
        contentHash: HASH_B,
        status: "verified",
        provenance: "p".repeat(2_500),
        recordedBy: "agent",
        observedAt: NOW_ISO,
        version: 1,
      }),
    );
    v11.close();

    const upgraded = await openDatabase({ path: legacyPath });
    try {
      const assertion = upgraded.get<{ kind: string; version: number }>(
        "SELECT kind, version FROM situation_assertions WHERE assertion_id = 'as-legacy'",
      );
      expect(assertion?.kind).toBe("reported_fact");
      expect(assertion?.version).toBe(1);
      const superseded = upgraded.get<{ superseded_by: string | null }>(
        "SELECT superseded_by FROM situation_assertions WHERE assertion_id = 'as-sup'",
      );
      expect(superseded?.superseded_by).toBe("as-new");
      const claim = upgraded.get<{ importance: string; version: number; created_at: number }>(
        "SELECT importance, version, created_at FROM claims WHERE claim_id = 'cl-legacy'",
      );
      expect(claim?.importance).toBe("supporting");
      expect(claim?.version).toBe(1);
      expect(claim?.created_at).toBe(NOW_MS);
      const indexRow = upgraded.get<{ name: string }>(
        "SELECT name FROM sqlite_schema WHERE type = 'index' AND name = 'idx_evidence_task_content_hash'",
      );
      expect(indexRow?.name).toBe("idx_evidence_task_content_hash");
      // And the upgraded rows still parse through the repository.
      const uow = createUnitOfWork(upgraded);
      const loaded = uow.assertions.get(projectId, "as-legacy");
      expect(loaded?.kind).toBe("reported_fact");
      expect(loaded?.version).toBe(1);
      expect(uow.assertions.get(projectId, "as-invalid-ref")?.sourceRefs[0])
        .toMatchObject({ refType: "evidence" });
      const duplicateHashes = ["ev-duplicate-a", "ev-duplicate-b"]
        .map((id) => uow.evidence.get(projectId, id)?.contentHash);
      expect(duplicateHashes.filter((hash) => hash === HASH_A)).toHaveLength(1);
      expect(duplicateHashes.filter((hash) => hash === undefined)).toHaveLength(1);
      const normalizedEvidence = uow.evidence.get(projectId, "ev-normalize");
      expect(normalizedEvidence?.contentHash).toBe(HASH_B);
      expect(normalizedEvidence?.locator.contentHash).toBeUndefined();
      expect(normalizedEvidence?.provenance).toHaveLength(2_000);
    } finally {
      upgraded.close();
    }
  });

  it("fails migration 012 before committing unreadable evidence identities or locators", async () => {
    const cases = [
      {
        name: "overlong-id",
        evidenceId: "x".repeat(65),
        locator: { type: "artifact", value: "valid" },
      },
      {
        name: "empty-locator",
        evidenceId: "ev-empty-locator",
        locator: { type: "artifact", value: "" },
      },
      {
        name: "overlong-locator",
        evidenceId: "ev-overlong-locator",
        locator: { type: "artifact", value: "x".repeat(4_001) },
      },
    ] as const;

    for (const testCase of cases) {
      const legacyPath = join(dir, `legacy-012-invalid-${testCase.name}.db`);
      const projectId = generateId();
      const taskId = generateId();
      const v11 = await openDatabase({
        path: legacyPath,
        migrate: { migrations: MIGRATIONS.slice(0, 11) },
      });
      try {
        v11.run(
          "INSERT INTO projects (project_id, display_name, created_at, data) VALUES (?, 'p', 0, '{}')",
          projectId,
        );
        v11.run(
          `INSERT INTO tasks (task_id, project_id, status, created_at, updated_at, data)
           VALUES (?, ?, 'active', 0, 0, '{}')`,
          taskId,
          projectId,
        );
        v11.run(
          `INSERT INTO evidence_items
             (evidence_id, project_id, task_id, type, status, excerpt, content_hash,
              recorded_by, observed_at, expires_at, data)
           VALUES (?, ?, ?, 'primary_source', 'unverified', NULL, '', 'import', ?, NULL, ?)`,
          testCase.evidenceId,
          projectId,
          taskId,
          NOW_MS,
          JSON.stringify({
            evidenceId: testCase.evidenceId,
            taskId,
            type: "primary_source",
            locator: testCase.locator,
            status: "unverified",
            provenance: "legacy-import",
            recordedBy: "import",
            observedAt: NOW_ISO,
            version: 1,
          }),
        );
        expect(() => {
          withTransaction(v11, () => {
            migration012.up(v11);
          });
        }).toThrow(new RegExp(`Migration 012 cannot normalize evidence ${testCase.evidenceId}`));
      } finally {
        v11.close();
      }
    }
  });

  it("repairs only project-valid legacy evidence task projections and rejects identity conflicts", async () => {
    const validPath = join(dir, "legacy-012-null-task.db");
    const projectId = generateId();
    const taskId = generateId();
    const valid = await openDatabase({
      path: validPath,
      migrate: { migrations: MIGRATIONS.slice(0, 11) },
    });
    try {
      valid.run(
        "INSERT INTO projects (project_id, display_name, created_at, data) VALUES (?, 'p', 0, '{}')",
        projectId,
      );
      valid.run(
        `INSERT INTO tasks (task_id, project_id, status, created_at, updated_at, data)
         VALUES (?, ?, 'active', 0, 0, '{}')`,
        taskId,
        projectId,
      );
      valid.run(
        `INSERT INTO evidence_items
           (evidence_id, project_id, task_id, type, status, excerpt, content_hash,
            recorded_by, observed_at, expires_at, data)
         VALUES ('ev-null-task', ?, NULL, 'primary_source', 'unverified', NULL, '',
                 'import', ?, NULL, ?)`,
        projectId,
        NOW_MS,
        JSON.stringify(makeEvidence(
          { projectId, taskId, projectB: projectId, taskB: taskId },
          { evidenceId: "ev-null-task", locator: { type: "artifact", value: "legacy" } },
        )),
      );
      withTransaction(valid, () => {
        migration012.up(valid);
      });
      expect(valid.get<{ task_id: string }>(
        "SELECT task_id FROM evidence_items WHERE evidence_id = 'ev-null-task'",
      )?.task_id).toBe(taskId);
      expect(createUnitOfWork(valid).evidence.listByTask(projectId, taskId, { limit: 10 }).items)
        .toHaveLength(1);
    } finally {
      valid.close();
    }

    for (const mode of ["json-column-mismatch", "cross-project-task"] as const) {
      const invalidPath = join(dir, `legacy-012-${mode}.db`);
      const projectA = generateId();
      const projectB = generateId();
      const taskA = generateId();
      const taskB = generateId();
      const invalid = await openDatabase({
        path: invalidPath,
        migrate: { migrations: MIGRATIONS.slice(0, 11) },
      });
      try {
        invalid.run(
          "INSERT INTO projects (project_id, display_name, created_at, data) VALUES (?, 'a', 0, '{}')",
          projectA,
        );
        invalid.run(
          "INSERT INTO projects (project_id, display_name, created_at, data) VALUES (?, 'b', 0, '{}')",
          projectB,
        );
        invalid.run(
          `INSERT INTO tasks (task_id, project_id, status, created_at, updated_at, data)
           VALUES (?, ?, 'active', 0, 0, '{}')`,
          taskA,
          projectA,
        );
        invalid.run(
          `INSERT INTO tasks (task_id, project_id, status, created_at, updated_at, data)
           VALUES (?, ?, 'active', 0, 0, '{}')`,
          taskB,
          projectB,
        );
        const columnTaskId = mode === "json-column-mismatch" ? taskA : taskB;
        invalid.run(
          `INSERT INTO evidence_items
             (evidence_id, project_id, task_id, type, status, excerpt, content_hash,
              recorded_by, observed_at, expires_at, data)
           VALUES ('ev-bad-scope', ?, ?, 'primary_source', 'unverified', NULL, '',
                   'import', ?, NULL, ?)`,
          projectA,
          columnTaskId,
          NOW_MS,
          JSON.stringify(makeEvidence(
            { projectId: projectA, taskId: taskB, projectB, taskB },
            { evidenceId: "ev-bad-scope", locator: { type: "artifact", value: "legacy" } },
          )),
        );
        expect(() => {
          withTransaction(invalid, () => {
            migration012.up(invalid);
          });
        }).toThrow(/Migration 012 cannot normalize evidence ev-bad-scope: task identity/);
        expect(invalid.all<{ name: string }>("PRAGMA table_info(evidence_items)")
          .some((column) => column.name === "version")).toBe(false);
      } finally {
        invalid.close();
      }
    }
  });

  it("normalizes genuinely legacy pre-provenance rows so repository reads keep working", async () => {
    // Real Task 6-era rows: no provenance/createdAt/version in the data JSON,
    // loose sourceRefs, kind=confirmed_fact with no confirmations, and a
    // non-hex content_hash on evidence. Migration 012 must normalize them
    // honestly instead of leaving reads to fail validation.
    const legacyPath = join(dir, "legacy-012-old-shape.db");
    const projectId = generateId();
    const taskId = generateId();
    const v11 = await openDatabase({
      path: legacyPath,
      migrate: { migrations: MIGRATIONS.slice(0, 11) },
    });
    v11.run(
      "INSERT INTO projects (project_id, display_name, created_at, data) VALUES (?, 'p', 0, '{}')",
      projectId,
    );
    v11.run(
      `INSERT INTO tasks (task_id, project_id, status, created_at, updated_at, data)
       VALUES (?, ?, 'active', 0, 0, '{}')`,
      taskId,
      projectId,
    );
    const oldBase = {
      assertionId: "as-old",
      projectId,
      taskId,
      statement: "legacy confirmed statement",
      sourceRefs: [{ ref: "data/old.csv", type: "path" }],
      confidence: 0.9,
      limitations: [],
      status: "active",
      validFrom: NOW_ISO,
    };
    v11.run(
      `INSERT INTO situation_assertions (assertion_id, project_id, task_id, status, valid_from, valid_until, data)
       VALUES ('as-old', ?, ?, 'active', ?, NULL, ?)`,
      projectId,
      taskId,
      NOW_MS,
      JSON.stringify({ ...oldBase, kind: "confirmed_fact" }),
    );
    v11.run(
      `INSERT INTO situation_assertions (assertion_id, project_id, task_id, status, valid_from, valid_until, data)
       VALUES ('as-old-unknown', ?, ?, 'active', ?, NULL, ?)`,
      projectId,
      taskId,
      NOW_MS,
      JSON.stringify({
        ...oldBase,
        assertionId: "as-old-unknown",
        kind: "unknown",
        sourceRefs: [],
        confidence: undefined,
      }),
    );
    v11.run(
      `INSERT INTO claims (claim_id, project_id, task_id, type, status, confidence, text, data)
       VALUES ('cl-old', ?, ?, 'factual', 'unverified', 0.5, 'legacy claim', ?)`,
      projectId,
      taskId,
      JSON.stringify({
        claimId: "cl-old",
        taskId,
        text: "legacy claim",
        type: "factual",
        importance: "material",
        confidence: 0.5,
        evidenceRefs: [],
        status: "unverified",
        limitations: [],
      }),
    );
    v11.run(
      `INSERT INTO evidence_items
         (evidence_id, project_id, task_id, type, status, excerpt, content_hash, recorded_by, observed_at, expires_at, data)
       VALUES ('ev-old', ?, ?, 'primary_source', 'verified', 'legacy excerpt', 'h', 'user', ?, NULL, ?)`,
      projectId,
      taskId,
      NOW_MS,
      JSON.stringify({
        evidenceId: "ev-old",
        taskId,
        type: "primary_source",
        locator: { type: "path", value: "old/relative.csv" },
        excerpt: "legacy excerpt",
        status: "verified",
        provenance: "legacy-import",
        recordedBy: "user",
        observedAt: NOW_ISO,
      }),
    );
    v11.close();

    const upgraded = await openDatabase({ path: legacyPath });
    try {
      const uow = createUnitOfWork(upgraded);
      const assertion = uow.assertions.get(projectId, "as-old");
      expect(assertion).toBeDefined();
      // Demoted: a legacy confirmed_fact without a legal confirmation source
      // is honestly a reported fact, and its provenance is the runtime.
      expect(assertion?.kind).toBe("reported_fact");
      expect(assertion?.provenance.actor).toBe("system");
      expect(assertion?.provenance.directUser).toBe(false);
      expect(assertion?.statement).toBe("legacy confirmed statement");
      expect(assertion?.sourceRefs.length).toBeGreaterThan(0);
      const unknown = uow.assertions.get(projectId, "as-old-unknown");
      expect(unknown?.kind).toBe("unknown");
      expect(unknown?.missingReason?.reasonKind).toBe("not_resolvable");
      const claim = uow.claims.get(projectId, "cl-old");
      expect(claim?.provenance.actor).toBe("system");
      expect(claim?.importance).toBe("material");
      const evidence = uow.evidence.get(projectId, "ev-old");
      expect(evidence?.excerpt).toBe("legacy excerpt");
      // A legacy non-hex content hash is not a valid dedup anchor: dropped.
      expect(evidence?.contentHash).toBeUndefined();
    } finally {
      upgraded.close();
    }
  });

  // ── Query plans (EXPLAIN QUERY PLAN) ──

  it("serves open critical claims without a table scan or temp b-tree", () => {
    const plan = db
      .all<{ detail: string }>(
        `EXPLAIN QUERY PLAN
         SELECT claim_id FROM claims
         WHERE project_id = 'p' AND task_id = 't' AND importance = 'critical'
           AND status NOT IN ('supported', 'not_applicable')
         ORDER BY created_at, claim_id`,
      )
      .map((row) => row.detail)
      .join("\n");
    expect(plan).toContain("idx_claims");
    expect(plan).not.toContain("SCAN claims");
    expect(plan).not.toContain("TEMP B-TREE");
  });

  it("serves the evidence content-hash dedup lookup from the partial index", () => {
    const plan = db
      .all<{ detail: string }>(
        `EXPLAIN QUERY PLAN
         SELECT evidence_id FROM evidence_items
         WHERE project_id = 'p' AND task_id = 't' AND content_hash = '${HASH_A}'
           AND content_hash != ''`,
      )
      .map((row) => row.detail)
      .join("\n");
    expect(plan).toContain("idx_evidence_task_content_hash");
    expect(plan).not.toContain("SCAN evidence_items");
  });

  it("serves recent tool failures from the partial event index", () => {
    const plan = db
      .all<{ detail: string }>(
        `EXPLAIN QUERY PLAN
         SELECT event_id FROM events
         WHERE project_id = 'p' AND task_id = 't' AND event_type = 'tool_failure'
           AND occurred_at <= ${NOW_MS}
         ORDER BY occurred_at, event_id`,
      )
      .map((row) => row.detail)
      .join("\n");
    expect(plan).toContain("idx_events_tool_failure");
    expect(plan).not.toContain("SCAN events");
    expect(plan).not.toContain("TEMP B-TREE");
  });

  it("provides real review and tool-failure sources for CompletionFacts", () => {
    const seed = seedProjectTask();
    const review = makeReview(seed);
    const failure = makeToolFailure(seed);
    const uow = createUnitOfWork(db);
    uow.commit((u) => {
      u.reviews.insertItem(review);
      u.reviews.insertItem(makeReview(seed, {
        reviewId: generateId(),
        projectId: seed.projectB,
        taskId: seed.taskB,
        title: "foreign review",
      }));
      u.events.reserve(failure, { ownerId: "facts-test" });
      u.events.reserve(makeToolFailure(seed, {
        eventId: generateId(),
        idempotencyKey: `failure-${generateId()}`,
        projectId: seed.projectB,
        taskId: seed.taskB,
        action: {
          toolName: "foreign-tool",
          category: "execute",
          reversible: true,
          external: false,
          resourceRefs: [],
          securitySummary: "foreign failure",
        },
        rawPayloadHash: "d".repeat(64),
      }), { ownerId: "facts-test-foreign" });
    });

    const reviews = uow.reviews.listByTask(seed.projectId, seed.taskId, { limit: 10 });
    expect(reviews.items.map((row) => row.reviewId)).toEqual([review.reviewId]);
    const failures = uow.events.listRecentToolFailures(
      seed.projectId,
      seed.taskId,
      NOW_MS - 1,
      10,
    );
    expect(failures).toEqual([{
      eventId: failure.eventId,
      toolName: "shell",
      error: "exit_code 1",
      occurredAt: NOW_ISO,
    }]);

    const facts = buildCompletionFacts(
      seed.projectId,
      seed.taskId,
      {
        tasks: { hasTask: (projectId, taskId) => uow.tasks.get(projectId, taskId) !== undefined },
        deliverables: uow.deliverables,
        claims: uow.claims,
        evidence: uow.evidence,
        decisions: uow.decisions,
        reviews: uow.reviews,
        toolFailures: uow.events,
      },
      NOW_MS + 1,
    );
    expect(facts.unresolvedDecisions.map((row) => row.decisionId)).toContain(review.reviewId);
    expect(facts.recentToolFailures.map((row) => row.eventId)).toEqual([failure.eventId]);
  });

  it("serves the deliverable listByTask ordering from the index", () => {
    const plan = db
      .all<{ detail: string }>(
        `EXPLAIN QUERY PLAN
         SELECT deliverable_id FROM task_deliverables
         WHERE project_id = 'p' AND task_id = 't'
         ORDER BY deliverable_id`,
      )
      .map((row) => row.detail)
      .join("\n");
    expect(plan).toContain("idx_task_deliverables_project_task");
    expect(plan).not.toContain("SCAN task_deliverables");
    expect(plan).not.toContain("TEMP B-TREE");
  });

  // ── Evidence hash dedup ──

  it("rejects a duplicate content hash within one task but allows it across tasks/projects", () => {
    const seed = seedProjectTask();
    const uow = createUnitOfWork(db);
    uow.commit((u) => {
      u.evidence.insert(seed.projectId, makeEvidence(seed, { contentHash: HASH_A }));
    });
    expectSestinaCode(
      () => {
        uow.commit((u) => {
          u.evidence.insert(seed.projectId, makeEvidence(seed, { evidenceId: "ev-dup", contentHash: HASH_A }));
        });
      },
      "idempotency_violation",
    );
    // Same hash, different task in the same project: a different dedup scope.
    const otherTask = generateId();
    uow.commit((u) => {
      u.tasks.insert({
        taskId: otherTask, projectId: seed.projectId, title: "t1b", status: "active",
        priority: "normal", createdAt: NOW_ISO, updatedAt: NOW_ISO,
      });
      u.evidence.insert(
        seed.projectId,
        makeEvidence(seed, { evidenceId: "ev-other-task", taskId: otherTask, contentHash: HASH_A }),
      );
    });
    // Same hash, different project: allowed (project-scoped dedup).
    uow.commit((u) => {
      u.evidence.insert(
        seed.projectB,
        makeEvidence(seed, { evidenceId: "ev-other-project", taskId: seed.taskB, contentHash: HASH_A }),
      );
    });
    expect(uow.evidence.findByContentHash(seed.projectB, seed.taskB, HASH_A)?.evidenceId)
      .toBe("ev-other-project");
    expect(uow.evidence.get(seed.projectId, "ev-dup")).toBeUndefined();
  });

  it("chunks large evidence and claim point lookups without losing stable id order", () => {
    const seed = seedProjectTask();
    const uow = createUnitOfWork(db);
    uow.commit((u) => {
      u.evidence.insert(seed.projectId, makeEvidence(seed));
      u.claims.insert(seed.projectId, makeClaim(seed));
    });
    const evidenceIds = Array.from({ length: 1_200 }, (_, index) => `missing-e-${index}`);
    evidenceIds[250] = "ev-1";
    evidenceIds[1_050] = "ev-1";
    const claimIds = Array.from({ length: 1_200 }, (_, index) => `missing-c-${index}`);
    claimIds[350] = "cl-1";
    claimIds[1_100] = "cl-1";

    expect(uow.evidence.listByIds(seed.projectId, evidenceIds).map((item) => item.evidenceId))
      .toEqual(["ev-1"]);
    expect(uow.claims.listByIds(seed.projectId, claimIds).map((claim) => claim.claimId))
      .toEqual(["cl-1"]);
  });

  // ── CAS transitions ──

  it("rejects authority-derived states through generic repository writes", () => {
    const seed = seedProjectTask();
    const uow = createUnitOfWork(db);
    const directUser = actorProvenance({
      actor: "user",
      channel: "desktop",
      directUser: true,
    });
    expectSestinaCode(
      () => {
        uow.commit((u) => {
          u.assertions.insert(makeAssertion(seed, {
            kind: "confirmed_fact",
            confirmations: [{ sourceType: "direct_user", provenance: directUser }],
          }));
        });
      },
      "validation_failed",
    );
    expectSestinaCode(
      () => {
        uow.commit((u) => {
          u.evidence.insert(seed.projectId, makeEvidence(seed, { status: "verified" }));
        });
      },
      "validation_failed",
    );

    uow.commit((u) => {
      u.assertions.insert(makeAssertion(seed));
      u.evidence.insert(seed.projectId, makeEvidence(seed));
    });
    expectSestinaCode(
      () => {
        uow.commit((u) => {
          u.assertions.transition(
            seed.projectId,
            "as-1",
            1,
            makeAssertion(seed, {
              kind: "confirmed_fact",
              confirmations: [{ sourceType: "direct_user", provenance: directUser }],
              version: 2,
            }),
            historyWrite({ toStatus: "active" }),
          );
        });
      },
      "validation_failed",
    );
    expectSestinaCode(
      () => {
        uow.commit((u) => {
          u.evidence.transition(
            seed.projectId,
            "ev-1",
            1,
            "verified",
            historyWrite({
              toStatus: "verified",
              actorJson: JSON.stringify({ actor: "agent", channel: "mcp", directUser: false }),
            }),
          );
        });
      },
      "forbidden",
    );
    expect(uow.assertions.get(seed.projectId, "as-1")?.kind).toBe("reported_fact");
    expect(uow.evidence.get(seed.projectId, "ev-1")?.status).toBe("unverified");
  });

  it("revalidates verified-evidence confirmation authority inside persistence", () => {
    const seed = seedProjectTask();
    const siblingTaskId = generateId();
    const uow = createUnitOfWork(db);
    uow.commit((u) => {
      u.tasks.insert({
        taskId: siblingTaskId,
        projectId: seed.projectId,
        title: "sibling",
        status: "active",
        priority: "normal",
        createdAt: NOW_ISO,
        updatedAt: NOW_ISO,
      });
      u.assertions.insert(makeAssertion(seed));
      u.evidence.insert(seed.projectId, makeEvidence(seed, { contentHash: HASH_A }));
      u.evidence.insert(seed.projectId, makeEvidence(seed, {
        evidenceId: "ev-cross-task",
        taskId: siblingTaskId,
        contentHash: HASH_B,
      }));
      u.evidence.insert(seed.projectId, makeEvidence(seed, {
        evidenceId: "ev-expired",
        contentHash: HASH_C,
        expiresAt: "2026-08-02T00:00:00.000Z",
      }));
      u.evidence.insert(seed.projectB, makeEvidence(seed, {
        evidenceId: "ev-foreign",
        taskId: seed.taskB,
        contentHash: HASH_D,
      }));
      u.evidence.transition(
        seed.projectId,
        "ev-1",
        1,
        "verified",
        historyWrite({ toStatus: "verified" }),
      );
      u.evidence.transition(seed.projectId, "ev-cross-task", 1, "verified",
        historyWrite({ toStatus: "verified" }));
      u.evidence.transition(seed.projectId, "ev-expired", 1, "verified",
        historyWrite({ toStatus: "verified" }));
      u.evidence.transition(seed.projectB, "ev-foreign", 1, "verified",
        historyWrite({ toStatus: "verified" }));
    });
    const invalidConfirmations = [
      { sourceType: "verified_evidence" as const, evidenceId: "missing", contentHash: HASH_A },
      { sourceType: "verified_evidence" as const, evidenceId: "ev-1", contentHash: HASH_E },
      { sourceType: "verified_evidence" as const, evidenceId: "ev-cross-task", contentHash: HASH_B },
      { sourceType: "verified_evidence" as const, evidenceId: "ev-expired", contentHash: HASH_C },
      { sourceType: "verified_evidence" as const, evidenceId: "ev-foreign", contentHash: HASH_D },
    ];
    for (const confirmation of invalidConfirmations) {
      expectSestinaCode(
        () => {
          uow.commit((u) => {
            u.assertions.confirm(
              seed.projectId,
              "as-1",
              1,
              confirmation,
              actorProvenance(),
              historyWrite({
                action: "confirm",
                toStatus: "active",
                actorJson: JSON.stringify({ actor: "system", channel: "runtime", directUser: false }),
              }),
            );
          });
        },
        "insufficient_confirmation_source",
      );
      expect(uow.assertions.get(seed.projectId, "as-1")?.version).toBe(1);
      expect(uow.assertions.history(seed.projectId, "as-1")).toHaveLength(0);
    }
    expectSestinaCode(
      () => {
        uow.commit((u) => {
          u.assertions.confirm(
            seed.projectId,
            "as-1",
            1,
            { sourceType: "verified_evidence", evidenceId: "ev-1", contentHash: HASH_A },
            actorProvenance(),
            historyWrite({ action: "confirm", toStatus: "active" }),
          );
        });
      },
      "validation_failed",
    );
    expect(uow.assertions.get(seed.projectId, "as-1")?.version).toBe(1);
    expect(uow.assertions.history(seed.projectId, "as-1")).toHaveLength(0);
    const confirmed = uow.commit((u) =>
      u.assertions.confirm(
        seed.projectId,
        "as-1",
        1,
        { sourceType: "verified_evidence", evidenceId: "ev-1", contentHash: HASH_A },
        actorProvenance(),
        historyWrite({
          action: "confirm",
          toStatus: "active",
          actorJson: JSON.stringify({ actor: "system", channel: "runtime", directUser: false }),
        }),
      ));
    expect(confirmed.kind).toBe("confirmed_fact");
    expect(confirmed.confirmations).toEqual([
      { sourceType: "verified_evidence", evidenceId: "ev-1", contentHash: HASH_A },
    ]);
    expect(uow.assertions.history(seed.projectId, "as-1").map((row) => row.action))
      .toEqual(["confirm"]);
  });

  it("accepts only persisted hook-capability observations as hook confirmation authority", () => {
    const seed = seedProjectTask();
    const uow = createUnitOfWork(db);
    const hostStream = makeToolFailure(seed, {
      eventId: generateId(),
      idempotencyKey: `stream-${generateId()}`,
      eventType: "host_stream",
      sourceCapability: "stream",
    });
    const spoofedHookType = makeToolFailure(seed, {
      eventId: generateId(),
      idempotencyKey: `stream-${generateId()}`,
      eventType: "user_prompt",
      sourceCapability: "stream",
    });
    const realHook = makeToolFailure(seed, {
      eventId: generateId(),
      idempotencyKey: `hook-${generateId()}`,
      eventType: "user_prompt",
      sourceCapability: "hooks",
    });
    uow.commit((u) => {
      u.assertions.insert(makeAssertion(seed));
      u.events.reserve(hostStream, { ownerId: "confirmation-test" });
      u.events.reserve(spoofedHookType, { ownerId: "confirmation-test" });
      u.events.reserve(realHook, { ownerId: "confirmation-test" });
    });
    for (const event of [hostStream, spoofedHookType]) {
      expectSestinaCode(
        () => {
          uow.commit((u) => {
            u.assertions.confirm(
              seed.projectId,
              "as-1",
              1,
              { sourceType: "hook_observation", refId: event.eventId, trusted: true },
              actorProvenance(),
              historyWrite({
                action: "confirm",
                toStatus: "active",
                actorJson: JSON.stringify({ actor: "system", channel: "runtime", directUser: false }),
              }),
            );
          });
        },
        "insufficient_confirmation_source",
      );
    }
    const confirmed = uow.commit((u) => u.assertions.confirm(
      seed.projectId,
      "as-1",
      1,
      { sourceType: "hook_observation", refId: realHook.eventId, trusted: false },
      actorProvenance(),
      historyWrite({
        action: "confirm",
        toStatus: "active",
        actorJson: JSON.stringify({ actor: "system", channel: "runtime", directUser: false }),
      }),
    ));
    expect(confirmed.kind).toBe("confirmed_fact");
    expect(confirmed.confirmations).toEqual([
      { sourceType: "hook_observation", refId: realHook.eventId, trusted: true },
    ]);
    expect(uow.assertions.history(seed.projectId, "as-1")).toHaveLength(1);
  });

  it("does not revive terminal evidence through the raw repository boundary", () => {
    const seed = seedProjectTask();
    const uow = createUnitOfWork(db);
    const terminalRows = [
      { evidenceId: "ev-disputed", status: "disputed" as const, contentHash: HASH_A },
      { evidenceId: "ev-superseded", status: "superseded" as const, contentHash: HASH_B },
      { evidenceId: "ev-unavailable", status: "unavailable" as const, contentHash: HASH_C },
    ];
    uow.commit((u) => {
      for (const row of terminalRows) {
        u.evidence.insert(seed.projectId, makeEvidence(seed, {
          evidenceId: row.evidenceId,
          contentHash: row.contentHash,
        }));
        u.evidence.transition(
          seed.projectId,
          row.evidenceId,
          1,
          row.status,
          historyWrite({ toStatus: row.status }),
        );
      }
      u.assertions.insert(makeAssertion(seed, { assertionId: "as-terminal" }));
    });
    for (const row of terminalRows) {
      expectSestinaCode(
        () => {
          uow.commit((u) => {
            u.evidence.transition(
              seed.projectId,
              row.evidenceId,
              2,
              "unverified",
              historyWrite({ expectedVersion: 2, toStatus: "unverified" }),
            );
          });
        },
        "validation_failed",
      );
      expectSestinaCode(
        () => {
          uow.commit((u) => {
            u.evidence.transition(
              seed.projectId,
              row.evidenceId,
              2,
              "verified",
              historyWrite({ expectedVersion: 2, toStatus: "verified" }),
            );
          });
        },
        "validation_failed",
      );
      expect(uow.evidence.get(seed.projectId, row.evidenceId)?.status).toBe(row.status);
      expect(uow.evidence.get(seed.projectId, row.evidenceId)?.version).toBe(2);
      expect(uow.evidence.history(seed.projectId, row.evidenceId)).toHaveLength(1);
    }
    expectSestinaCode(
      () => {
        uow.commit((u) => {
          u.assertions.confirm(
            seed.projectId,
            "as-terminal",
            1,
            { sourceType: "verified_evidence", evidenceId: "ev-disputed", contentHash: HASH_A },
            actorProvenance(),
            historyWrite({
              action: "confirm",
              toStatus: "active",
              actorJson: JSON.stringify({ actor: "system", channel: "runtime", directUser: false }),
            }),
          );
        });
      },
      "insufficient_confirmation_source",
    );
  });

  it("keeps assertion evidence payload immutable across generic transitions", () => {
    const seed = seedProjectTask();
    const uow = createUnitOfWork(db);
    uow.commit((u) => {
      u.assertions.insert(makeAssertion(seed));
      u.evidence.insert(seed.projectId, makeEvidence(seed, { contentHash: HASH_A }));
      u.evidence.transition(
        seed.projectId,
        "ev-1",
        1,
        "verified",
        historyWrite({ toStatus: "verified" }),
      );
      u.assertions.confirm(
        seed.projectId,
        "as-1",
        1,
        { sourceType: "verified_evidence", evidenceId: "ev-1", contentHash: HASH_A },
        actorProvenance(),
        historyWrite({
          action: "confirm",
          toStatus: "active",
          actorJson: JSON.stringify({ actor: "system", channel: "runtime", directUser: false }),
        }),
      );
    });
    const confirmed = uow.assertions.get(seed.projectId, "as-1");
    expect(confirmed?.kind).toBe("confirmed_fact");
    if (confirmed === undefined) {
      throw new Error("expected a persisted confirmed assertion");
    }

    expectSestinaCode(
      () => {
        uow.commit((u) => {
          u.assertions.transition(
            seed.projectId,
            "as-1",
            2,
            {
              ...confirmed,
              statement: "tampered after confirmation",
              sourceRefs: [{ refType: "tool_result", refId: "forged-tool" }],
              provenance: actorProvenance({ actor: "system" }),
              status: "disputed",
              version: 3,
            },
            historyWrite({ expectedVersion: 2, toStatus: "disputed" }),
          );
        });
      },
      "validation_failed",
    );
    expect(uow.assertions.get(seed.projectId, "as-1")).toEqual(confirmed);
    expect(uow.assertions.history(seed.projectId, "as-1")).toHaveLength(1);
    const expired = { ...confirmed, status: "expired" as const, validUntil: NOW_ISO, version: 3 };
    uow.commit((u) => {
      u.assertions.transition(
        seed.projectId,
        "as-1",
        2,
        expired,
        historyWrite({ expectedVersion: 2, toStatus: "expired" }),
      );
    });
    expectSestinaCode(
      () => {
        uow.commit((u) => {
          u.assertions.transition(
            seed.projectId,
            "as-1",
            3,
            { ...expired, status: "active", version: 4 },
            historyWrite({ expectedVersion: 3, toStatus: "active" }),
          );
        });
      },
      "validation_failed",
    );
    expect(uow.assertions.get(seed.projectId, "as-1")?.status).toBe("expired");
    expect(uow.assertions.get(seed.projectId, "as-1")?.version).toBe(3);
    expect(uow.assertions.history(seed.projectId, "as-1")).toHaveLength(2);
  });

  it("bumps versions and appends history on CAS transitions", () => {
    const seed = seedProjectTask();
    const uow = createUnitOfWork(db);
    uow.commit((u) => {
      u.assertions.insert(makeAssertion(seed));
      u.evidence.insert(seed.projectId, makeEvidence(seed, { contentHash: HASH_A }));
      u.claims.insert(seed.projectId, makeClaim(seed));
    });
    uow.commit((u) => {
      u.assertions.transition(seed.projectId, "as-1", 1,
        makeAssertion(seed, { status: "disputed", version: 2 }),
        historyWrite({ toStatus: "disputed" }));
      u.evidence.transition(seed.projectId, "ev-1", 1, "verified",
        historyWrite({ toStatus: "verified" }));
      u.claims.transition(seed.projectId, "cl-1", 1,
        makeClaim(seed, { status: "supported", version: 2 }),
        historyWrite({ toStatus: "supported" }));
    });
    expect(uow.assertions.get(seed.projectId, "as-1")?.status).toBe("disputed");
    expect(uow.assertions.get(seed.projectId, "as-1")?.version).toBe(2);
    expect(uow.evidence.get(seed.projectId, "ev-1")?.status).toBe("verified");
    expect(uow.evidence.get(seed.projectId, "ev-1")?.version).toBe(2);
    const rawEvidence = db.get<{ status: string; version: number; data: string }>(
      "SELECT status, version, data FROM evidence_items WHERE evidence_id = 'ev-1'",
    );
    expect(rawEvidence?.status).toBe("verified");
    expect(rawEvidence?.version).toBe(2);
    expect(JSON.parse(rawEvidence?.data ?? "{}")).toMatchObject({
      status: "verified",
      version: 2,
    });
    expect(uow.claims.get(seed.projectId, "cl-1")?.status).toBe("supported");
    // History is append-only: the original states survive as rows.
    const assertionHistory = uow.assertions.history(seed.projectId, "as-1");
    expect(assertionHistory).toHaveLength(1);
    expect(assertionHistory[0]?.fromStatus).toBe("active");
    expect(assertionHistory[0]?.toStatus).toBe("disputed");
    expect(uow.evidence.history(seed.projectId, "ev-1")).toHaveLength(1);
    expect(uow.claims.history(seed.projectId, "cl-1")).toHaveLength(1);
    // A second transition appends rather than overwrites.
    uow.commit((u) => {
      u.assertions.transition(seed.projectId, "as-1", 2,
        makeAssertion(seed, { status: "expired", validUntil: NOW_ISO, version: 3 }),
        historyWrite({ expectedVersion: 2, toStatus: "expired" }));
    });
    expect(uow.assertions.history(seed.projectId, "as-1")).toHaveLength(2);
    expect(uow.assertions.history(seed.projectId, "as-1").map((h) => h.toStatus))
      .toEqual(["disputed", "expired"]);
  });

  it("rejects a CAS transition with a stale expected version (stale_state)", () => {
    const seed = seedProjectTask();
    const uow = createUnitOfWork(db);
    uow.commit((u) => {
      u.evidence.insert(seed.projectId, makeEvidence(seed, { contentHash: HASH_A }));
    });
    uow.commit((u) => {
      u.evidence.transition(seed.projectId, "ev-1", 1, "verified",
        historyWrite({ toStatus: "verified" }));
    });
    expectSestinaCode(
      () => {
        uow.commit((u) => {
          u.evidence.transition(seed.projectId, "ev-1", 1, "verified",
            historyWrite({ toStatus: "verified" }));
        });
      },
      "stale_state",
    );
  });

  it("rejects mismatched or malformed ledger metadata before changing state", () => {
    const seed = seedProjectTask();
    const uow = createUnitOfWork(db);
    uow.commit((u) => {
      u.evidence.insert(seed.projectId, makeEvidence(seed));
    });
    expectSestinaCode(
      () => {
        uow.commit((u) => {
          u.evidence.transition(
            seed.projectId,
            "ev-1",
            1,
            "verified",
            historyWrite({
              expectedVersion: 99,
              toStatus: "disputed",
              actorJson: "{}",
            }),
          );
        });
      },
      "validation_failed",
    );
    expect(uow.evidence.get(seed.projectId, "ev-1")).toMatchObject({
      status: "unverified",
      version: 1,
    });
    expect(uow.evidence.history(seed.projectId, "ev-1")).toEqual([]);
  });

  it("enforces version one on new assertion, evidence, and claim rows", () => {
    const seed = seedProjectTask();
    const uow = createUnitOfWork(db);
    for (const insert of [
      () => {
        uow.commit((u) => { u.assertions.insert(makeAssertion(seed, { version: 2 })); });
      },
      () => {
        uow.commit((u) => {
          u.evidence.insert(
            seed.projectId,
            makeEvidence(seed, { evidenceId: "ev-v2", version: 2 }),
          );
        });
      },
      () => {
        uow.commit((u) => {
          u.claims.insert(seed.projectId, makeClaim(seed, { claimId: "cl-v2", version: 2 }));
        });
      },
      () => {
        uow.commit((u) => {
          u.deliverables.upsert(
            seed.projectId,
            seed.taskId,
            {
              deliverableId: "dl-v2",
              description: "invalid initial version",
              status: "pending",
              evidenceRefs: [],
              version: 2,
              updatedAt: NOW_ISO,
            },
            historyWrite({ expectedVersion: 0, toStatus: "pending" }),
          );
        });
      },
    ]) {
      expectSestinaCode(insert, "validation_failed");
    }
  });

  it("keeps assertion and claim task identity immutable across transitions", () => {
    const seed = seedProjectTask();
    const otherTaskId = generateId();
    const uow = createUnitOfWork(db);
    uow.commit((u) => {
      u.tasks.insert({
        taskId: otherTaskId,
        projectId: seed.projectId,
        title: "other",
        status: "active",
        priority: "normal",
        createdAt: NOW_ISO,
        updatedAt: NOW_ISO,
      });
      u.assertions.insert(makeAssertion(seed));
      u.claims.insert(seed.projectId, makeClaim(seed));
    });
    expectSestinaCode(
      () => {
        uow.commit((u) => {
          u.assertions.transition(
            seed.projectId,
            "as-1",
            1,
            makeAssertion(seed, { taskId: otherTaskId, status: "disputed", version: 2 }),
            historyWrite({ toStatus: "disputed" }),
          );
        });
      },
      "validation_failed",
    );
    expectSestinaCode(
      () => {
        uow.commit((u) => {
          u.claims.transition(
            seed.projectId,
            "cl-1",
            1,
            makeClaim(seed, { taskId: otherTaskId, status: "supported", version: 2 }),
            historyWrite({ toStatus: "supported" }),
          );
        });
      },
      "validation_failed",
    );
  });

  it("rejects a CAS transition raced from a second connection with stale_state", async () => {
    const seed = seedProjectTask();
    const uowA = createUnitOfWork(db);
    uowA.commit((u) => {
      u.evidence.insert(seed.projectId, makeEvidence(seed, { contentHash: HASH_A }));
    });
    const second = await openDatabase({ path: join(dir, "sestina.db") });
    try {
      const uowB = createUnitOfWork(second);
      // Connection B wins the race to verify.
      uowB.commit((u) => {
        u.evidence.transition(seed.projectId, "ev-1", 1, "verified",
          historyWrite({ toStatus: "verified" }));
      });
      // Connection A still holds version 1: its write must fail, not clobber.
      expectSestinaCode(
        () => {
          uowA.commit((u) => {
            u.evidence.transition(seed.projectId, "ev-1", 1, "verified",
              historyWrite({ toStatus: "verified" }));
          });
        },
        "stale_state",
      );
      expect(uowB.evidence.get(seed.projectId, "ev-1")?.status).toBe("verified");
      expect(uowB.evidence.history(seed.projectId, "ev-1")).toHaveLength(1);
    } finally {
      second.close();
    }
  });

  // ── Project/task fences ──

  it("fences assertion inserts to tasks that belong to the assertion's project", () => {
    const seed = seedProjectTask();
    const uow = createUnitOfWork(db);
    // Task from project B on an assertion of project A: same stable error as
    // a missing task - no cross-project existence leak.
    expectSestinaCode(
      () => {
        uow.commit((u) => {
          u.assertions.insert(makeAssertion(seed, { taskId: seed.taskB }));
        });
      },
      "task_not_found",
    );
    expectSestinaCode(
      () => {
        uow.commit((u) => {
          u.assertions.insert(makeAssertion(seed, { taskId: generateId() }));
        });
      },
      "task_not_found",
    );
  });

  it("fences claim inserts and deliverable upserts to the given project's tasks", () => {
    const seed = seedProjectTask();
    const uow = createUnitOfWork(db);
    expectSestinaCode(
      () => {
        uow.commit((u) => {
          u.claims.insert(seed.projectId, makeClaim(seed, { taskId: seed.taskB }));
        });
      },
      "task_not_found",
    );
    expectSestinaCode(
      () => {
        uow.commit((u) => {
          u.deliverables.upsert(
            seed.projectId, seed.taskB,
            {
              deliverableId: "dl-1", description: "d", status: "pending",
              evidenceRefs: [], version: 1, updatedAt: NOW_ISO,
            },
            historyWrite({ expectedVersion: 0, toStatus: "pending" }),
          );
        });
      },
      "task_not_found",
    );
  });

  it("fences claim-evidence links to the same project AND the same task", () => {
    const seed = seedProjectTask();
    const taskA2 = generateId();
    const uow = createUnitOfWork(db);
    uow.commit((u) => {
      u.tasks.insert({
        taskId: taskA2, projectId: seed.projectId, title: "ta2", status: "active",
        priority: "normal", createdAt: NOW_ISO, updatedAt: NOW_ISO,
      });
      u.claims.insert(seed.projectId, makeClaim(seed));
      u.claims.insert(seed.projectB, makeClaim(seed, { claimId: "cl-b", taskId: seed.taskB }));
      u.evidence.insert(seed.projectId, makeEvidence(seed, { contentHash: HASH_A }));
      u.evidence.insert(
        seed.projectId,
        makeEvidence(seed, { evidenceId: "ev-b", taskId: taskA2, contentHash: HASH_B }),
      );
    });
    const link = (claimId: string, evidenceId: string): ClaimEvidenceLink => ({
      claimId,
      evidenceId,
      relation: "supports",
      strength: "causal",
      provenance: actorProvenance(),
      linkedAt: NOW_ISO,
    });
    // Cross-project link: rejected with the isolation error.
    expectSestinaCode(
      () => {
        uow.commit((u) => {
          u.evidence.linkClaimEvidence(seed.projectId, link("cl-b", "ev-1"));
        });
      },
      "project_isolation_violation",
    );
    // Same project, different task: rejected.
    expectSestinaCode(
      () => {
        uow.commit((u) => {
          u.evidence.linkClaimEvidence(seed.projectId, link("cl-1", "ev-b"));
        });
      },
      "validation_failed",
    );
    // Same project and task: accepted and readable back with classification.
    uow.commit((u) => {
      u.evidence.linkClaimEvidence(seed.projectId, link("cl-1", "ev-1"));
    });
    const links = uow.evidence.listClaimLinks(seed.projectId, "cl-1");
    expect(links).toHaveLength(1);
    expect(links[0]?.relation).toBe("supports");
    expect(links[0]?.strength).toBe("causal");
    expect(links[0]?.provenance).toEqual(actorProvenance());
    expectSestinaCode(
      () => {
        uow.commit((u) => {
          u.evidence.linkClaimEvidence(seed.projectId, {
            ...link("cl-1", "ev-1"),
            relation: "context",
            strength: "reported",
          });
        });
      },
      "idempotency_violation",
    );
    expect(uow.evidence.listClaimLinks(seed.projectId, "cl-1")[0])
      .toMatchObject({ relation: "supports", strength: "causal" });
  });

  it("caps immutable claim-evidence authority links at the schema bound", () => {
    const seed = seedProjectTask();
    const uow = createUnitOfWork(db);
    const evidenceIds = Array.from(
      { length: MAX_CLAIM_EVIDENCE_REFS + 1 },
      (_, index) => `ev-cap-${String(index).padStart(3, "0")}`,
    );
    uow.commit((u) => {
      u.claims.insert(seed.projectId, makeClaim(seed));
      for (const evidenceId of evidenceIds) {
        u.evidence.insert(seed.projectId, makeEvidence(seed, { evidenceId }));
      }
      for (const evidenceId of evidenceIds.slice(0, MAX_CLAIM_EVIDENCE_REFS)) {
        u.evidence.linkClaimEvidence(seed.projectId, {
          claimId: "cl-1",
          evidenceId,
          relation: "supports",
          strength: "reported",
          provenance: actorProvenance(),
          linkedAt: NOW_ISO,
        });
      }
    });
    expectSestinaCode(
      () => {
        uow.commit((u) => {
          const overflowEvidenceId =
            evidenceIds[MAX_CLAIM_EVIDENCE_REFS] ?? "missing-overflow-evidence";
          u.evidence.linkClaimEvidence(seed.projectId, {
            claimId: "cl-1",
            evidenceId: overflowEvidenceId,
            relation: "supports",
            strength: "reported",
            provenance: actorProvenance(),
            linkedAt: NOW_ISO,
          });
        });
      },
      "limit_exceeded",
    );
    expect(uow.evidence.listClaimLinks(seed.projectId, "cl-1"))
      .toHaveLength(MAX_CLAIM_EVIDENCE_REFS);
  });

  it("lists assertion superseders through the superseded_by projection", () => {
    const seed = seedProjectTask();
    const uow = createUnitOfWork(db);
    uow.commit((u) => {
      u.assertions.insert(makeAssertion(seed));
      u.assertions.insert(makeAssertion(seed, {
        assertionId: "as-2", status: "superseded", supersededBy: "as-1",
      }));
    });
    const superseders = uow.assertions.listSuperseders(seed.projectId, "as-1");
    expect(superseders.map((a) => a.assertionId)).toEqual(["as-2"]);
    expect(uow.assertions.listSuperseders(seed.projectB, "as-1")).toHaveLength(0);
  });

  it("project-fences tombstone get: another project sees undefined", () => {
    const seed = seedProjectTask();
    const tx = createTransactionView(db);
    withTransaction(db, () => {
      createTombstoneRepository(tx).insert({
        tombstoneId: "tb-1",
        entityKind: "evidence_excerpt",
        entityId: "ev-1",
        projectId: seed.projectId,
        reason: "expired",
        contentHash: HASH_A,
        createdAt: NOW_MS,
      });
    });
    const reader = createTombstoneRepository(createTransactionView(db));
    expect(reader.get(seed.projectId, "tb-1")?.entityKind).toBe("evidence_excerpt");
    expect(reader.get(seed.projectB, "tb-1")).toBeUndefined();
  });

  it("transitions deliverables under CAS with append-only history", () => {
    const seed = seedProjectTask();
    const uow = createUnitOfWork(db);
    uow.commit((u) => {
      u.deliverables.upsert(
        seed.projectId, seed.taskId,
        {
          deliverableId: "dl-1", description: "d", status: "pending",
          evidenceRefs: [], version: 1, updatedAt: NOW_ISO,
        },
        historyWrite({ expectedVersion: 0, toStatus: "pending" }),
      );
    });
    uow.commit((u) => {
      u.deliverables.transition(
        seed.projectId, seed.taskId, "dl-1", 1,
        {
          deliverableId: "dl-1", description: "d", status: "in_progress",
          evidenceRefs: [], version: 2, updatedAt: NOW_ISO,
        },
        historyWrite({ expectedVersion: 1, toStatus: "in_progress" }),
      );
    });
    const ledger = uow.deliverables.listByTask(seed.projectId, seed.taskId);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.status).toBe("in_progress");
    expect(ledger[0]?.version).toBe(2);
    expect(uow.deliverables.history(seed.projectId, seed.taskId, "dl-1").map((h) => h.toStatus))
      .toEqual(["pending", "in_progress"]);
    // Stale CAS on the deliverable fails too.
    expectSestinaCode(
      () => {
        uow.commit((u) => {
          u.deliverables.transition(
            seed.projectId,
            seed.taskId,
            "dl-1",
            1,
            {
              deliverableId: "dl-1",
              description: "d",
              status: "failed",
              evidenceRefs: [],
              version: 2,
              updatedAt: NOW_ISO,
            },
            historyWrite({ expectedVersion: 1, toStatus: "failed" }),
          );
        });
      },
      "stale_state",
    );
  });

  it("scopes deliverable identity and history to project plus task", () => {
    const seed = seedProjectTask();
    const siblingTaskId = generateId();
    const uow = createUnitOfWork(db);
    uow.commit((u) => {
      u.tasks.insert({
        taskId: siblingTaskId,
        projectId: seed.projectId,
        title: "sibling",
        status: "active",
        priority: "normal",
        createdAt: NOW_ISO,
        updatedAt: NOW_ISO,
      });
      u.deliverables.upsert(
        seed.projectId,
        seed.taskId,
        {
          deliverableId: "shared-id",
          description: "first task",
          status: "pending",
          evidenceRefs: [],
          version: 1,
          updatedAt: NOW_ISO,
        },
        historyWrite({ expectedVersion: 0, toStatus: "pending" }),
      );
      u.deliverables.upsert(
        seed.projectId,
        siblingTaskId,
        {
          deliverableId: "shared-id",
          description: "sibling task",
          status: "pending",
          evidenceRefs: [],
          version: 1,
          updatedAt: NOW_ISO,
        },
        historyWrite({ expectedVersion: 0, toStatus: "pending" }),
      );
    });
    expect(uow.deliverables.get(seed.projectId, seed.taskId, "shared-id")?.description)
      .toBe("first task");
    expect(uow.deliverables.get(seed.projectId, siblingTaskId, "shared-id")?.description)
      .toBe("sibling task");
    expect(uow.deliverables.history(seed.projectId, seed.taskId, "shared-id")).toHaveLength(1);
    expect(uow.deliverables.history(seed.projectId, siblingTaskId, "shared-id")).toHaveLength(1);
  });

  it("fails closed when deliverable history is read without a task scope", () => {
    const seed = seedProjectTask();
    const tx = createTransactionView(db);
    expectSestinaCode(
      () => readLedgerHistory(
        tx,
        "deliverable_history",
        "deliverable_id",
        seed.projectId,
        "shared-id",
      ),
      "internal_error",
    );
  });

  // ── Retention B9: expired evidence excerpts leave real tombstones ──

  it("writes an irreversible tombstone before clearing an expired evidence excerpt", async () => {
    const seed = seedProjectTask();
    const uow = createUnitOfWork(db);
    const expiresIso = new Date(Date.now() - DAY_MS).toISOString();
    uow.commit((u) => {
      u.evidence.insert(seed.projectId, makeEvidence(seed, {
        evidenceId: "ev-exp",
        excerpt: "sensitive-synthetic-excerpt-content",
        contentHash: HASH_A,
        expiresAt: expiresIso,
      }));
    });
    // FTS sees the excerpt before retention.
    const before = search(db, {
      projectId: seed.projectId, text: "sensitive-synthetic", kinds: ["evidence"], limit: 10,
    });
    expect(before.filter((r) => r.id === "ev-exp")).toHaveLength(1);

    const apply = (previewId: string) =>
      applyRetentionPreview(db, {
        previewId,
        databasePath: join(dir, "sestina.db"),
        busyTimeoutMs: 400,
      });
    const config = {
      captureRetentionDays: 90,
      privacyRetentionDays: 90,
      collaborationMessageRetentionDays: 90,
    };
    await apply(previewRetention(db, config).previewId);

    // The excerpt is gone from BOTH the column and the data JSON.
    const row = db.get<{ excerpt: string | null; data: string }>(
      "SELECT excerpt, data FROM evidence_items WHERE evidence_id = 'ev-exp'",
    );
    expect(row?.excerpt).toBeNull();
    expect(JSON.parse(row?.data ?? "{}")).not.toHaveProperty("excerpt");
    // A real tombstone exists with the irreversible hash of the excerpt.
    const list = createTombstoneRepository(createTransactionView(db))
      .listByProject(seed.projectId, { limit: 100 }).items;
    const excerptTombstone = list.find((t) => t.entityId === "ev-exp");
    expect(excerptTombstone?.entityKind).toBe("evidence_excerpt");
    expect(excerptTombstone?.reason).toBe("expired");
    expect(excerptTombstone?.contentHash).toMatch(/^[a-f0-9]{64}$/);
    // FTS residue is zero.
    const after = search(db, {
      projectId: seed.projectId, text: "sensitive-synthetic", kinds: ["evidence"], limit: 10,
    });
    expect(after).toHaveLength(0);
    // Idempotent: re-applying cannot duplicate tombstones.
    await apply(previewRetention(db, config).previewId);
    const recheck = createTombstoneRepository(createTransactionView(db))
      .listByProject(seed.projectId, { limit: 100 }).items;
    expect(recheck.filter((t) => t.entityId === "ev-exp")).toHaveLength(1);
  });
});
