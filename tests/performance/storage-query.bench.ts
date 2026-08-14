import { afterAll, beforeAll, bench, describe, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { generateId, StandardEventSchema, type StandardEvent } from "@sestina/schema";
import type {
  ConversationId,
  EventId,
  ProjectId,
  SessionId,
  TaskId,
} from "@sestina/schema";
import {
  createUnitOfWork,
  encodeEventCursor,
  MIGRATIONS,
  openDatabase,
  SCHEMA_VERSION,
  search,
  validateJson,
  withTransaction,
  type StorageDatabase,
} from "@sestina/storage";

// ── 100k storage benchmark (docs/22 Task 6 Step 5, docs/20 §2.9) ──
// Scenarios:
//   1. 100k events seeded through the event repository: benchmarks
//      index-backed keyset cursor pagination (first page and deep page).
//   2. 100k conversation_messages seeded through the conversation
//      repository: the FTS5 triggers index every body (storage FTS insert
//      path), and a project-scoped FTS query over the corpus is benchmarked
//      with kinds: ["conversation"].
//   3. Upgrade backfill: a database built with ONLY migrations 001-004 is
//      loaded with 100k legacy events (stream_sequence = 0), then the full
//      migrator runs to latest — exercising migration 005's per-project
//      stream_sequence backfill window function.
//   4. Order-of-magnitude anti-regression thresholds asserted from samples
//      measured inside the timed iterations (cursor page < 50 ms, FTS
//      query < 20 ms).
// NOTE: vitest's bench runner executes only the TOP-LEVEL beforeAll/afterAll
// hooks (describe-level hooks never run in this mode), so all setup — query
// plan printing included — lives in the top-level hooks. Query plans print
// once up front, never inside timed iterations.

// ── Thresholds (order-of-magnitude anti-regression guards) ──
// Measured on this machine the cursor page lands around 0.3-0.7 ms and the
// FTS query around 0.05-0.1 ms; a regression to a full table scan lands
// above 100 ms, so these bounds are wide enough for Windows variance while
// still catching any plan that stops using the indexes.
const CURSOR_PAGE_THRESHOLD_MS = 50;
const FTS_QUERY_THRESHOLD_MS = 20;

const EVENT_COUNT = 100_000;
const CONVERSATION_COUNT = 100_000;
const PAGE_SIZE = 50;
const BASE_MS = 1_700_000_000_000;
const NOW_ISO = "2026-08-14T00:00:00.000Z";

let dir: string;
let db: StorageDatabase;
// Branded IDs: generateId() emits schema-valid ULIDs, so the casts below
// only attach the compile-time brand; every row is still re-validated by
// the repositories (validateJson) before it reaches a JSON column.
let projectId: ProjectId;
let taskId: TaskId;
let deepCursor: string;

// Upgrade-backfill scenario state (built in the top-level beforeAll).
let upgradeDir: string | undefined;
let upgradedDb: StorageDatabase | undefined;
let legacyProjectA = generateId() as ProjectId;
let upgradeDeepCursor = "";

// ── Sample collection (timing is measured inside the timed iteration) ──

const samples = new Map<string, number[]>();

function recordSample(name: string, ms: number): void {
  const existing = samples.get(name);
  if (existing) existing.push(ms);
  else samples.set(name, [ms]);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    const value = sorted[mid];
    if (value === undefined) throw new Error("median of empty sample set");
    return value;
  }
  const lower = sorted[mid - 1];
  const upper = sorted[mid];
  if (lower === undefined || upper === undefined) throw new Error("median of empty sample set");
  return (lower + upper) / 2;
}

function timed(name: string, work: () => void): void {
  const start = performance.now();
  work();
  recordSample(name, performance.now() - start);
}

function assertMedianBelow(name: string, limitMs: number, label: string): void {
  const values = samples.get(name) ?? [];
  expect(values.length, `${label}: collected samples`).toBeGreaterThan(0);
  const med = median(values);
  console.log(
    `[bench] ${label}: median ${med.toFixed(2)} ms over ${values.length} samples (threshold ${limitMs} ms)`,
  );
  expect(med, `${label}: median`).toBeLessThan(limitMs);
}

function removeTempDir(path: string): void {
  // Windows may briefly hold file handles after close() (WAL sidecars).
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  rmSync(path, { recursive: true, force: true });
}

function explainPlan(db: StorageDatabase, sql: string, ...params: unknown[]): string {
  return db
    .all<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, ...params)
    .map((row) => row.detail)
    .join(" | ");
}

function makeEvent(
  n: number,
  scope: { projectId: ProjectId; taskId: TaskId },
  prefix: string,
): StandardEvent {
  return {
    schemaVersion: "1.0.0",
    eventId: generateId() as EventId,
    idempotencyKey: `${prefix}-${n}-${generateId()}`,
    eventType: "pre_tool",
    host: "codex",
    projectId: scope.projectId,
    taskId: scope.taskId,
    sessionId: generateId() as SessionId,
    occurredAt: new Date(BASE_MS + n * 1000).toISOString(),
    receivedAt: new Date(BASE_MS + n * 1000 + 50).toISOString(),
    bypass: false,
    privacyClass: "internal",
    rawPayloadHash: "f".repeat(64),
  };
}

beforeAll(async () => {
  // ── Scenario 1+2: 100k events + 100k-message conversation FTS corpus ──
  dir = mkdtempSync(join(tmpdir(), "sestina-bench-"));
  db = await openDatabase({ path: join(dir, "sestina.db") });
  projectId = generateId() as ProjectId;
  taskId = generateId() as TaskId;
  const uow = createUnitOfWork(db);
  uow.commit((u) => {
    u.projects.insert({
      projectId, name: "bench-project", bindings: [], status: "active",
      createdAt: NOW_ISO, updatedAt: NOW_ISO,
    });
    u.tasks.insert({
      taskId, projectId, title: "bench-task", status: "active", priority: "normal",
      createdAt: NOW_ISO, updatedAt: NOW_ISO,
    });
  });

  // Bulk seed in one transaction (single prepared statement path).
  const t0 = performance.now();
  uow.commit((u) => {
    for (let i = 0; i < EVENT_COUNT; i++) {
      u.events.reserve(makeEvent(i, { projectId, taskId }, "bench"), {
        ownerId: `bench-owner-${i % 16}`,
      });
    }
  });
  console.log(`[bench] seeded ${EVENT_COUNT} events in ${(performance.now() - t0).toFixed(0)} ms`);

  // 100k conversation messages: every INSERT fires the FTS5 trigger on
  // conversation_messages, so fts_conversation_messages mirrors the corpus
  // (docs/31 §8). One transaction keeps the seed fast.
  const conversationId = generateId() as ConversationId;
  uow.commit((u) => {
    u.conversations.insertConversation({
      conversationId, projectId, taskId, type: "governance_chat",
      title: "bench conversation corpus", status: "active",
      createdAt: NOW_ISO, updatedAt: NOW_ISO,
    });
  });
  const t1 = performance.now();
  uow.commit((u) => {
    for (let i = 0; i < CONVERSATION_COUNT; i++) {
      u.conversations.insertMessage({
        messageId: generateId(),
        conversationId,
        role: "user",
        body: `benchmark corpus message ${i}`,
        contextRefs: [],
        confirmable: true,
        status: "complete",
        createdAt: NOW_ISO,
      });
    }
  });
  console.log(
    `[bench] seeded ${CONVERSATION_COUNT} conversation messages (FTS corpus) in ${(performance.now() - t1).toFixed(0)} ms`,
  );

  // The FTS index holds exactly the seeded corpus.
  const ftsCount = Number(
    db.get<{ c: number | bigint }>("SELECT COUNT(*) AS c FROM fts_conversation_messages")?.c ?? 0,
  );
  expect(ftsCount).toBe(CONVERSATION_COUNT);
  const contentCount = Number(
    db.get<{ c: number | bigint }>("SELECT COUNT(*) AS c FROM conversation_messages")?.c ?? 0,
  );
  expect(contentCount).toBe(CONVERSATION_COUNT);

  // Deep cursor anchor: a real row near the end of the stream, signed with
  // the real cursor machinery (no hand-rolled cursors).
  const anchor = db.get<{ event_id: string }>(
    "SELECT event_id FROM events WHERE project_id = ? AND stream_sequence = ?",
    projectId,
    EVENT_COUNT - 100,
  );
  if (!anchor) throw new Error("deep cursor anchor row missing");
  deepCursor = encodeEventCursor(projectId, EVENT_COUNT - 100, anchor.event_id);

  // ── Query plans print ONCE here, outside the timed iterations, and the
  //    anti-full-scan invariants are asserted up front (docs/20 §9).
  const firstPlan = explainPlan(
    db,
    "SELECT event_id FROM events WHERE project_id = ? ORDER BY stream_sequence, event_id LIMIT 50",
    projectId,
  );
  console.log("[bench] cursor plan (first page):", firstPlan);
  expect(firstPlan).toMatch(/USING (COVERING )?INDEX/);
  expect(firstPlan).not.toMatch(/SCAN\s+events/);

  const deepPlan = explainPlan(
    db,
    `SELECT event_id FROM events
     WHERE project_id = ? AND (stream_sequence, event_id) > (?, ?)
     ORDER BY stream_sequence, event_id LIMIT 50`,
    projectId,
    EVENT_COUNT - 100,
    generateId(),
  );
  console.log("[bench] cursor plan (deep row-value form):", deepPlan);
  expect(deepPlan).toMatch(/USING (COVERING )?INDEX/);
  expect(deepPlan).not.toMatch(/SCAN\s+events/);

  const ftsPlan = explainPlan(
    db,
    `SELECT m.message_id
     FROM fts_conversation_messages
     JOIN conversation_messages m ON m.rowid = fts_conversation_messages.rowid
     JOIN conversations c ON c.conversation_id = m.conversation_id
     WHERE fts_conversation_messages MATCH '"benchmark"' AND c.project_id = ? LIMIT 10`,
    projectId,
  );
  console.log("[bench] FTS conversation plan:", ftsPlan);
  expect(ftsPlan).toContain("VIRTUAL TABLE INDEX");
  expect(ftsPlan).not.toMatch(/SCAN\s+conversation_messages/);

  // Warm the prepared statements and the page cache once so the timed
  // iterations measure steady state, not first-run costs.
  createUnitOfWork(db).events.listByProject(projectId, { limit: PAGE_SIZE });
  createUnitOfWork(db).events.listByProject(projectId, { cursor: deepCursor, limit: PAGE_SIZE });
  search(db, { projectId, text: "benchmark", kinds: ["conversation"], limit: 10 });

  // ── Scenario 3: migration 005 upgrade backfill on a legacy v4 DB ──
  const LEGACY_EVENTS_PER_PROJECT = 50_000;
  upgradeDir = mkdtempSync(join(tmpdir(), "sestina-bench-upgrade-"));
  const legacyPath = join(upgradeDir, "legacy.db");
  legacyProjectA = generateId() as ProjectId;
  const legacyProjectB = generateId() as ProjectId;

  // 1) Build a database with ONLY migrations 001-004: schema v4, where
  //    events carry stream_sequence DEFAULT 0 and no backfill has run.
  const legacy = await openDatabase({ path: legacyPath, migrate: { migrations: MIGRATIONS.slice(0, 4) } });
  expect(
    Number(
      legacy.get<{ v: number }>(
        "SELECT MAX(version) AS v FROM migrations WHERE status = 'completed'",
      )?.v,
    ),
  ).toBe(4);

  // 2) Insert 100k events in the old shape (stream_sequence left at its
  //    DEFAULT 0), interleaved across two projects so the backfill must
  //    partition per project. One transaction keeps the seed fast.
  const t2 = performance.now();
  withTransaction(legacy, () => {
    legacy.run(
      "INSERT INTO projects (project_id, display_name, created_at, data) VALUES (?, ?, ?, '{}')",
      legacyProjectA,
      "legacy-project-a",
      BASE_MS,
    );
    legacy.run(
      "INSERT INTO projects (project_id, display_name, created_at, data) VALUES (?, ?, ?, '{}')",
      legacyProjectB,
      "legacy-project-b",
      BASE_MS,
    );
    const taskA = generateId() as TaskId;
    const taskB = generateId() as TaskId;
    legacy.run(
      "INSERT INTO tasks (task_id, project_id, status, created_at, updated_at, data) VALUES (?, ?, 'active', ?, ?, '{}')",
      taskA, legacyProjectA, BASE_MS, BASE_MS,
    );
    legacy.run(
      "INSERT INTO tasks (task_id, project_id, status, created_at, updated_at, data) VALUES (?, ?, 'active', ?, ?, '{}')",
      taskB, legacyProjectB, BASE_MS, BASE_MS,
    );
    for (let i = 0; i < EVENT_COUNT; i++) {
      const useA = i % 2 === 0;
      const event = makeEvent(
        i,
        { projectId: useA ? legacyProjectA : legacyProjectB, taskId: useA ? taskA : taskB },
        "legacy",
      );
      legacy.run(
        `INSERT INTO events
           (event_id, idempotency_key, project_id, task_id, session_id, event_type,
            occurred_at, received_at, privacy_class, data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        event.eventId,
        event.idempotencyKey,
        event.projectId,
        event.taskId,
        event.sessionId,
        event.eventType,
        Date.parse(event.occurredAt),
        Date.parse(event.receivedAt),
        event.privacyClass,
        validateJson(StandardEventSchema, event, "StandardEvent"),
      );
    }
  });
  // Every row is still in the un-sequenced legacy state.
  expect(
    Number(
      legacy.get<{ c: number }>(
        "SELECT COUNT(*) AS c FROM events WHERE stream_sequence != 0",
      )?.c,
    ),
  ).toBe(0);
  console.log(
    `[bench] seeded ${EVENT_COUNT} legacy v4 events in ${(performance.now() - t2).toFixed(0)} ms`,
  );
  legacy.close();

  // 3) Run the full migrator to latest (the default writable-open path).
  //    Migration 005 backfills stream_sequence per project with a window
  //    function and swaps in the unique 3-column index. The wall time
  //    includes the automatic hashed pre-migration backup.
  const t3 = performance.now();
  upgradedDb = await openDatabase({ path: legacyPath });
  console.log(
    `[bench] upgraded legacy v4 database (005 backfill) in ${(performance.now() - t3).toFixed(0)} ms`,
  );

  // 4) Contiguity: each project owns exactly 1..N.
  for (const project of [legacyProjectA, legacyProjectB]) {
    const stats = upgradedDb.get<{ c: number; mn: number; mx: number; dc: number }>(
      `SELECT COUNT(*) AS c, MIN(stream_sequence) AS mn, MAX(stream_sequence) AS mx,
              COUNT(DISTINCT stream_sequence) AS dc
       FROM events WHERE project_id = ?`,
      project,
    );
    expect(Number(stats?.c)).toBe(LEGACY_EVENTS_PER_PROJECT);
    expect(Number(stats?.mn)).toBe(1);
    expect(Number(stats?.mx)).toBe(LEGACY_EVENTS_PER_PROJECT);
    // c == dc == mx with mn == 1: values are exactly 1..N, no gaps.
    expect(Number(stats?.dc)).toBe(LEGACY_EVENTS_PER_PROJECT);
  }
  expect(
    Number(
      upgradedDb.get<{ c: number }>(
        "SELECT COUNT(*) AS c FROM events WHERE stream_sequence = 0",
      )?.c,
    ),
  ).toBe(0);
  expect(
    Number(
      upgradedDb.get<{ v: number }>(
        "SELECT MAX(version) AS v FROM migrations WHERE status = 'completed'",
      )?.v,
    ),
  ).toBe(SCHEMA_VERSION);

  // 5) A deep cursor page near the end of the upgraded project's stream
  //    returns rows through the new index.
  const legacyAnchor = upgradedDb.get<{ event_id: string }>(
    "SELECT event_id FROM events WHERE project_id = ? AND stream_sequence = ?",
    legacyProjectA,
    LEGACY_EVENTS_PER_PROJECT - 100,
  );
  if (!legacyAnchor) throw new Error("deep cursor anchor row missing after upgrade");
  upgradeDeepCursor = encodeEventCursor(
    legacyProjectA,
    LEGACY_EVENTS_PER_PROJECT - 100,
    legacyAnchor.event_id,
  );
  const upgradedPage = createUnitOfWork(upgradedDb).events.listByProject(legacyProjectA, {
    cursor: upgradeDeepCursor,
    limit: PAGE_SIZE,
  });
  expect(upgradedPage.items.length).toBeGreaterThan(0);
});

afterAll(() => {
  // Order-of-magnitude anti-regression thresholds over the measured medians.
  assertMedianBelow("cursor-first", CURSOR_PAGE_THRESHOLD_MS, "keyset cursor page (first page)");
  assertMedianBelow("cursor-deep", CURSOR_PAGE_THRESHOLD_MS, "keyset cursor page (deep, near 100k)");
  assertMedianBelow(
    "cursor-upgraded",
    CURSOR_PAGE_THRESHOLD_MS,
    "keyset cursor page (upgraded legacy db)",
  );
  assertMedianBelow(
    "fts-conversation",
    FTS_QUERY_THRESHOLD_MS,
    "FTS conversation query over 100k corpus",
  );
  upgradedDb?.close();
  if (upgradeDir) removeTempDir(upgradeDir);
  db.close();
  removeTempDir(dir);
});

describe("storage queries at 100k events and 100k-message conversation corpus", () => {
  bench("keyset cursor page (first page, 50 rows)", () => {
    timed("cursor-first", () => {
      const page = createUnitOfWork(db).events.listByProject(projectId, { limit: PAGE_SIZE });
      expect(page.items.length).toBe(PAGE_SIZE);
    });
  }, { iterations: 20, time: 2000 });

  bench("keyset cursor page near the end of 100k history", () => {
    timed("cursor-deep", () => {
      const page = createUnitOfWork(db).events.listByProject(projectId, {
        cursor: deepCursor,
        limit: PAGE_SIZE,
      });
      expect(page.items.length).toBeGreaterThan(0);
    });
  }, { iterations: 20, time: 2000 });

  bench("project-scoped FTS search over the 100k conversation corpus", () => {
    timed("fts-conversation", () => {
      const rows = search(db, { projectId, text: "benchmark", kinds: ["conversation"], limit: 10 });
      expect(rows.length).toBeGreaterThan(0);
    });
  }, { iterations: 10, time: 2000 });
});

describe("migration 005 upgrade backfill over a legacy 100k-event database", () => {
  bench("keyset cursor page on the upgraded legacy database (deep)", () => {
    const upgraded = upgradedDb;
    if (!upgraded) throw new Error("upgraded database unavailable");
    timed("cursor-upgraded", () => {
      const page = createUnitOfWork(upgraded).events.listByProject(legacyProjectA, {
        cursor: upgradeDeepCursor,
        limit: PAGE_SIZE,
      });
      expect(page.items.length).toBeGreaterThan(0);
    });
  }, { iterations: 20, time: 2000 });
});
