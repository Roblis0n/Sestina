import { bench, describe, expect, beforeAll, afterAll } from "vitest";
import { join } from "node:path";
import { generateId } from "@sestina/schema";
import { openDatabase, createUnitOfWork, search, type StorageDatabase } from "@sestina/storage";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import type { StandardEvent } from "@sestina/schema";

// ── 100k storage benchmark (docs/22 Task 6 Step 5, docs/20 §2.9) ──
// Seeds 100,000 events into one project inside a single transaction, then
// benchmarks index-backed cursor pagination. The query plan is asserted to
// hit the (project_id, stream_sequence) index — no full-table scans.

const EVENT_COUNT = 100_000;
const PAGE_SIZE = 50;

let dir: string;
let db: StorageDatabase;
let projectId: string;
let taskId: string;

function makeEvent(n: number): StandardEvent {
  return {
    schemaVersion: "1.0.0",
    eventId: generateId(),
    idempotencyKey: `bench-${n}-${generateId()}`,
    eventType: "pre_tool",
    host: "codex",
    projectId,
    taskId,
    sessionId: generateId(),
    occurredAt: new Date(1_700_000_000_000 + n * 1000).toISOString(),
    receivedAt: new Date(1_700_000_000_000 + n * 1000 + 50).toISOString(),
    bypass: false,
    privacyClass: "internal",
    rawPayloadHash: "f".repeat(64),
  };
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "sestina-bench-"));
  db = await openDatabase({ path: join(dir, "sestina.db") });
  projectId = generateId();
  taskId = generateId();
  const uow = createUnitOfWork(db);
  await uow.commit((u) => {
    u.projects.insert({
      projectId, name: "bench-project", bindings: [], status: "active",
      createdAt: "2026-08-13T00:00:00.000Z", updatedAt: "2026-08-13T00:00:00.000Z",
    });
    u.tasks.insert({
      taskId, projectId, title: "bench-task", status: "active", priority: "normal",
      createdAt: "2026-08-13T00:00:00.000Z", updatedAt: "2026-08-13T00:00:00.000Z",
    });
  });
  // Bulk seed in one transaction (single prepared statement path).
  await uow.commit((u) => {
    for (let i = 0; i < EVENT_COUNT; i++) {
      u.events.reserve(makeEvent(i), { ownerId: `bench-owner-${i % 16}` });
    }
  });
  // Small collaboration corpus so the FTS bench searches real indexed rows.
  const thread = {
    threadId: generateId(),
    projectId,
    taskId,
    title: "bench thread",
    participantEndpointIds: [],
    status: "active" as const,
    createdBy: "agent" as const,
    createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z",
  };
  await uow.commit((u) => {
    u.collaboration.insertThread(thread);
    for (let i = 0; i < 20; i++) {
      u.collaboration.insertMessage({
        messageId: generateId(),
        threadId: thread.threadId,
        projectId,
        taskId,
        kind: "status",
        sourceEndpointId: generateId(),
        targetEndpointIds: [generateId()],
        summary: `bench corpus message ${i}`,
        constraints: [],
        evidenceRefs: [],
        contextRefs: [],
        authority: {
          actor: "peer_agent",
          directUser: false,
          sourceHost: "codex",
          sourceSessionId: "bench-session",
          contractVersion: 1,
          allowedOutcome: "inform",
        },
        privacyClass: "internal",
        ttlSeconds: 1800,
        hopCount: 0,
        dedupeKey: `bench-dedupe-${i}`,
        createdAt: "2026-08-13T00:00:00.000Z",
        expiresAt: "2099-08-13T00:00:00.000Z",
      });
    }
  });
  console.log(`seeded ${EVENT_COUNT} events + 20 collaboration messages`);
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("storage query at 100k events", () => {
  bench("index-backed cursor page (50 rows)", () => {
    const uow = createUnitOfWork(db);
    const page = uow.events.listByProject(projectId, { limit: PAGE_SIZE });
    expect(page.items.length).toBeLessThanOrEqual(PAGE_SIZE);
  }, { iterations: 20, time: 2000 });

  bench("deep cursor page near the end of 100k history", () => {
    const uow = createUnitOfWork(db);
    const cursor = Buffer.from(`${projectId}.${EVENT_COUNT - 100}.${generateId()}`, "utf8").toString("base64url");
    const page = uow.events.listByProject(projectId, { cursor, limit: PAGE_SIZE });
    expect(page.items.length).toBeGreaterThan(0);
  }, { iterations: 20, time: 2000 });

  bench("project-scoped FTS search over 100k corpus", () => {
    const rows = search(db, { projectId, text: "corpus", kinds: ["collaboration"], limit: 10 });
    expect(rows.length).toBeGreaterThan(0);
  }, { iterations: 10, time: 2000 });
});

describe("query plans at 100k events (docs/20 §9: no full-table scans)", () => {
  bench("plan assertions run against the seeded 100k corpus", () => {
    const plan = db.all<{ id: number; parent: number; notused: number; detail: string }>(
      `EXPLAIN QUERY PLAN
       SELECT event_id FROM events
       WHERE project_id = ? AND (stream_sequence, event_id) > (?, ?)
       ORDER BY stream_sequence, event_id LIMIT 50`,
      projectId,
      EVENT_COUNT - 100,
      generateId(),
    );
    const details = plan.map((r) => r.detail).join(" | ");
    console.log("cursor plan:", details);
    expect(details).toContain("USING INDEX");
    expect(details).not.toMatch(/SCAN\s+events/);

    const ftsPlan = db.all<{ id: number; parent: number; notused: number; detail: string }>(
      `EXPLAIN QUERY PLAN
       SELECT m.message_id FROM fts_collaboration_messages
       JOIN collaboration_messages m ON m.rowid = fts_collaboration_messages.rowid
       WHERE fts_collaboration_messages MATCH 'bench' AND m.project_id = ? LIMIT 50`,
      projectId,
    );
    const ftsDetails = ftsPlan.map((r) => r.detail).join(" | ");
    console.log("fts plan:", ftsDetails);
    expect(ftsDetails).toContain("VIRTUAL TABLE INDEX");
    expect(ftsDetails).not.toMatch(/SCAN\s+collaboration_messages/);

    const row = db.get<{ c: number | bigint }>(
      "SELECT COUNT(*) AS c FROM events WHERE project_id = ?",
      projectId,
    );
    expect(Number(row?.c ?? 0)).toBe(EVENT_COUNT);
  }, { iterations: 3, time: 1000 });
});
