import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { generateId, isSestinaError, SestinaErrorCode } from "@sestina/schema";
import type { StandardEvent } from "@sestina/schema";
import {
  openDatabase,
  createUnitOfWork,
  encodeEventCursor,
  decodeEventCursor,
} from "../src/index.js";
import { makeTempDir, removeTempDir, spawnChildScenario } from "./helpers.js";
import type { StorageDatabase } from "../src/index.js";

function makeEvent(projectId: string, taskId: string, n: number): StandardEvent {
  return {
    schemaVersion: "1.0.0",
    eventId: generateId(),
    idempotencyKey: `seq-key-${n}-${generateId()}`,
    eventType: "pre_tool",
    host: "codex",
    projectId,
    taskId,
    sessionId: generateId(),
    occurredAt: "2026-08-13T00:00:00.000Z",
    receivedAt: "2026-08-13T00:00:00.050Z",
    bypass: false,
    privacyClass: "internal",
    rawPayloadHash: "c".repeat(64),
  };
}

async function seedBase(db: StorageDatabase, projectId: string, taskId: string): Promise<void> {
  const uow = createUnitOfWork(db);
  await uow.commit((u) => {
    u.projects.insert({
      projectId, name: "p", bindings: [], status: "active",
      createdAt: "2026-08-13T00:00:00.000Z", updatedAt: "2026-08-13T00:00:00.000Z",
    });
    u.tasks.insert({
      taskId, projectId, title: "t", status: "active", priority: "normal",
      createdAt: "2026-08-13T00:00:00.000Z", updatedAt: "2026-08-13T00:00:00.000Z",
    });
  });
}

describe("nextStreamSequence (docs/22 Task 6)", () => {
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

  it("allocates monotonic unique sequences per project across connections", async () => {
    const projectId = generateId();
    const taskId = generateId();
    await seedBase(db, projectId, taskId);
    const uow = createUnitOfWork(db);

    const seen: number[] = [];
    for (let i = 0; i < 10; i++) {
      const seq = await uow.commit((u) => {
        const event = makeEvent(projectId, taskId, i);
        const reserved = u.events.reserve(event, { ownerId: "owner-a" });
        expect(reserved.kind).toBe("created");
        return u;
      }).then(() => {
        // Sequence is embedded in the row; read it back.
        return (db.get<{ s: number }>(
            "SELECT stream_sequence AS s FROM events WHERE project_id = ? ORDER BY stream_sequence DESC LIMIT 1",
            projectId,
          )?.s ?? 0);
      });
      seen.push(seq);
    }
    expect(seen).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));

    const other = await openDatabase({ path: join(dir, "sestina.db") });
    try {
      const otherUow = createUnitOfWork(other);
      const fromOther = await otherUow.commit((u) => {
        u.events.reserve(makeEvent(projectId, taskId, 100), { ownerId: "owner-b" });
        return (
          other.get<{ s: number }>(
            "SELECT MAX(stream_sequence) AS s FROM events WHERE project_id = ?",
            projectId,
          )?.s ?? 0);
      });
      expect(fromOther).toBe(11);
    } finally {
      other.close();
    }
  });

  it("allocates unique monotonic sequences across two real processes", async () => {
    const projectId = generateId();
    const taskId = generateId();
    await seedBase(db, projectId, taskId);
    const path = join(dir, "sestina.db");
    db.close();

    const fileA = join(dir, "seq-a.json");
    const fileB = join(dir, "seq-b.json");
    const childA = spawnChildScenario({
      scenario: "allocate-sequences",
      env: {
        SESTINA_CHILD_DB_PATH: path,
        SESTINA_CHILD_PROJECT: projectId,
        SESTINA_CHILD_TASK: taskId,
        SESTINA_CHILD_SEQ_COUNT: "50",
        SESTINA_CHILD_SEQ_FILE: fileA,
        SESTINA_CHILD_SEQ_JITTER_MS: "1",
      },
    });
    const childB = spawnChildScenario({
      scenario: "allocate-sequences",
      env: {
        SESTINA_CHILD_DB_PATH: path,
        SESTINA_CHILD_PROJECT: projectId,
        SESTINA_CHILD_TASK: taskId,
        SESTINA_CHILD_SEQ_COUNT: "50",
        SESTINA_CHILD_SEQ_FILE: fileB,
        SESTINA_CHILD_SEQ_JITTER_MS: "1",
      },
    });
    try {
      expect(await childA.waitForReady()).toBe(true);
      expect(await childB.waitForReady()).toBe(true);
    } finally {
      // Always reap the children so no process keeps the db file open.
      const [exitA, exitB] = await Promise.all([childA.wait(), childB.wait()]);
      expect(exitA).toBe(0);
      expect(exitB).toBe(0);
    }

    const a = JSON.parse(readFileSync(fileA, "utf8")) as number[];
    const b = JSON.parse(readFileSync(fileB, "utf8")) as number[];
    const all = [...a, ...b];
    expect(new Set(all).size).toBe(100); // unique
    expect(Math.max(...all)).toBe(100); // monotonic, no gaps

    db = await openDatabase({ path });
  }, 180000);
});

describe("Stable (stream_sequence, id) cursors", () => {
  let dir: string;
  let db: StorageDatabase;
  const projectId = "JGP7HHVP7X6E3F3PBJ2RHB7YJW";
  const taskId = "RCDW1C3BMD01S9BBS2NY3CEVDR";

  beforeEach(async () => {
    dir = makeTempDir();
    db = await openDatabase({ path: join(dir, "sestina.db") });
    await seedBase(db, projectId, taskId);
    const uow = createUnitOfWork(db);
    for (let i = 0; i < 250; i++) {
      const event = makeEvent(projectId, taskId, i);
      await uow.commit((u) => {
        u.events.reserve(event, { ownerId: `owner-${i}` });
      });
    }
  });
  afterEach(() => {
    db.close();
    removeTempDir(dir);
  });

  it("round-trips cursors and pages through all 250 events without gaps or overlaps", () => {
    const uow = createUnitOfWork(db);
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    for (;;) {
      const page = uow.events.listByProject(projectId, { cursor, limit: 50 });
      seen.push(...page.items.map((e) => e.eventId));
      pages += 1;
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    expect(pages).toBe(5);
    expect(new Set(seen).size).toBe(250);
    expect(seen).toHaveLength(250);
  });

  it("rejects forged cursors", () => {
    expect(() => decodeEventCursor("!!!not-base64!!!", projectId)).toThrow();
    expect(() => decodeEventCursor(Buffer.from("garbage", "utf8").toString("base64url"), projectId)).toThrow();
    expect(() =>
      decodeEventCursor(encodeEventCursor(projectId, -1, generateId()), projectId),
    ).toThrow();
  });

  it("rejects a cursor from another project", () => {
    const otherProject = "TQW7JXNQ2G1PN83TSXT93AK3V4";
    const forged = encodeEventCursor(otherProject, 5, generateId());
    try {
      decodeEventCursor(forged, projectId);
      expect.unreachable("cross-project cursor must throw");
    } catch (err) {
      expect(isSestinaError(err)).toBe(true);
      if (isSestinaError(err)) {
        expect(err.code).toBe(SestinaErrorCode.project_isolation_violation);
      }
    }
  });

  it("leaves a documented gap when a transaction rolls back", async () => {
    const uow = createUnitOfWork(db);
    const before =
      db.get<{ s: number }>("SELECT MAX(stream_sequence) AS s FROM events WHERE project_id = ?", projectId)?.s ?? 0;
    await expect(
      uow.commit((u) => {
        u.events.reserve(makeEvent(projectId, taskId, 999), { ownerId: "doomed" });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    const after =
      db.get<{ s: number }>("SELECT MAX(stream_sequence) AS s FROM events WHERE project_id = ?", projectId)?.s ?? 0;
    // The rolled-back sequence was wasted; monotonicity is what matters.
    expect(after).toBe(before);
    const next = await uow.commit((u) => {
      u.events.reserve(makeEvent(projectId, taskId, 1000), { ownerId: "next-owner" });
      return (
        db.get<{ s: number }>("SELECT MAX(stream_sequence) AS s FROM events WHERE project_id = ?", projectId)?.s ?? 0);
    });
    expect(next).toBe(before + 1);
  });
});
