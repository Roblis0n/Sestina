import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import {
  openDatabase,
  withTransaction,
  claimEventLease,
  completeEventLease,
  claimMessageDeliveryLease,
  releaseMessageDeliveryLease,
  DEFAULT_EVENT_LEASE_TTL_MS,
  type StorageDatabase,
} from "../src/index.js";
import { isSestinaError, SestinaErrorCode } from "@sestina/schema";
import { makeTempDir, removeTempDir, loadStorageFixture, createThread, createEndpoint, createClaudeEndpoint } from "./helpers.js";

const CONNECTIONS = 20;
const CLAIMS_PER_CONNECTION = 5;

describe("Event lease concurrency (docs/22 Step 5: 100 concurrent claims, one owner per key)", () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = makeTempDir();
    path = join(dir, "sestina.db");
    const setup = await openDatabase({ path });
    setup.close();
  });
  afterEach(() => { removeTempDir(dir); });

  it("gives one shared key a single owner across 100 concurrent claims", async () => {
    const connections: StorageDatabase[] = [];
    try {
      for (let i = 0; i < CONNECTIONS; i++) {
        connections.push(await openDatabase({ path }));
      }
      const key = "shared-event-key";
      const acquired: string[] = [];
      const waited: string[] = [];
      const perConnection = await Promise.all(
        connections.map(async (db, ci) => {
          const out: string[] = [];
          for (let n = 0; n < CLAIMS_PER_CONNECTION; n++) {
            // Yield between claims (never inside the transaction) so the
            // connections interleave at claim boundaries.
            await Promise.resolve();
            const result = await withTransaction(db, (tx) =>
              claimEventLease(tx, { idempotencyKey: key, ownerId: `owner-${ci}-${n}` }),
            );
            out.push(result);
          }
          return out;
        }),
      );
      for (const results of perConnection) {
        for (const result of results) {
          if (result === "acquired") acquired.push(result);
          else if (result === "wait_for_existing") waited.push(result);
        }
      }
      // 100 claims, exactly one owner.
      expect(acquired).toHaveLength(1);
      expect(waited.length + acquired.length).toBe(CONNECTIONS * CLAIMS_PER_CONNECTION);
    } finally {
      for (const c of connections) c.close();
    }
  });

  it("gives each of 100 distinct keys exactly one owner", async () => {
    const connections: StorageDatabase[] = [];
    try {
      for (let i = 0; i < CONNECTIONS; i++) {
        connections.push(await openDatabase({ path }));
      }
      const keys = Array.from({ length: 100 }, (_, i) => `distinct-key-${i}`);
      const outcomes = await Promise.all(
        keys.map(async (key, ki) => {
          const first = connections[ki % CONNECTIONS];
          const second = connections[(ki + 1) % CONNECTIONS];
          if (!first || !second) {
            throw new Error("connection pool under-provisioned");
          }
          const [a, b] = await Promise.all([
            withTransaction(first, (tx) =>
              claimEventLease(tx, { idempotencyKey: key, ownerId: `owner-a-${ki}` }),
            ),
            withTransaction(second, (tx) =>
              claimEventLease(tx, { idempotencyKey: key, ownerId: `owner-b-${ki}` }),
            ),
          ]);
          return { a, b };
        }),
      );
      for (const { a, b } of outcomes) {
        const owners = [a, b].sort();
        expect(owners).toEqual(["acquired", "wait_for_existing"]);
      }
    } finally {
      for (const c of connections) c.close();
    }
  });

  it("requires a transaction: claiming outside one is rejected", async () => {
    const db = await openDatabase({ path });
    try {
      const rawTx = {
        database: db,
        run: db.run.bind(db),
        get: db.get.bind(db),
        all: db.all.bind(db),
        exec: db.exec.bind(db),
      };
      try {
        claimEventLease(rawTx, { idempotencyKey: "naked-key", ownerId: "owner-a" });
        expect.unreachable("claim outside a transaction must throw");
      } catch (err) {
        expect(isSestinaError(err)).toBe(true);
        if (isSestinaError(err)) {
          expect(err.code).toBe(SestinaErrorCode.internal_error);
        }
      }
    } finally {
      db.close();
    }
  });

  it("returns wait_for_existing for an unexpired foreign owner and acquires after expiry", async () => {
    const db = await openDatabase({ path });
    try {
      const first = await withTransaction(db, (tx) =>
        claimEventLease(tx, { idempotencyKey: "expiry-key", ownerId: "owner-a" }),
      );
      expect(first).toBe("acquired");

      const second = await withTransaction(db, (tx) =>
        claimEventLease(tx, { idempotencyKey: "expiry-key", ownerId: "owner-b" }),
      );
      expect(second).toBe("wait_for_existing");

      // Expire the lease manually, then the next claim takes over.
      db.run("UPDATE event_leases SET expires_at = ? WHERE idempotency_key = 'expiry-key'", Date.now() - 1);
      const third = await withTransaction(db, (tx) =>
        claimEventLease(tx, { idempotencyKey: "expiry-key", ownerId: "owner-b" }),
      );
      expect(third).toBe("acquired");

      const row = db.get<{ owner_id: string; expires_at: number }>(
        "SELECT owner_id, expires_at FROM event_leases WHERE idempotency_key = 'expiry-key'",
      );
      expect(row?.owner_id).toBe("owner-b");
      expect(row?.expires_at).toBeGreaterThan(Date.now());
    } finally {
      db.close();
    }
  });

  it("reports already_completed after the lease is completed, even past expiry", async () => {
    const db = await openDatabase({ path });
    try {
      await withTransaction(db, (tx) =>
        claimEventLease(tx, { idempotencyKey: "completed-key", ownerId: "owner-a" }),
      );
      await withTransaction(db, (tx) =>
        { completeEventLease(tx, { idempotencyKey: "completed-key", ownerId: "owner-a" }); },
      );

      const again = await withTransaction(db, (tx) =>
        claimEventLease(tx, { idempotencyKey: "completed-key", ownerId: "owner-b" }),
      );
      expect(again).toBe("already_completed");

      db.run("UPDATE event_leases SET expires_at = ? WHERE idempotency_key = 'completed-key'", Date.now() - 1);
      const afterExpiry = await withTransaction(db, (tx) =>
        claimEventLease(tx, { idempotencyKey: "completed-key", ownerId: "owner-b" }),
      );
      expect(afterExpiry).toBe("already_completed");
    } finally {
      db.close();
    }
  });

  it("stores the packet hash and default TTL on claim", async () => {
    const db = await openDatabase({ path });
    try {
      await withTransaction(db, (tx) =>
        claimEventLease(tx, {
          idempotencyKey: "hash-key",
          ownerId: "owner-a",
          packetHash: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        }),
      );
      const row = db.get<{ packet_hash: string; expires_at: number }>(
        "SELECT packet_hash, expires_at FROM event_leases WHERE idempotency_key = 'hash-key'",
      );
      expect(row?.packet_hash).toBe("abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789");
      expect(row?.expires_at).toBeLessThanOrEqual(Date.now() + DEFAULT_EVENT_LEASE_TTL_MS + 5000);
      expect(row?.expires_at).toBeGreaterThan(Date.now());
    } finally {
      db.close();
    }
  });
});

describe("Collaboration delivery leases (one active delivery owner per message+target)", () => {
  let dir: string;
  let path: string;
  let db: StorageDatabase;

  beforeEach(async () => {
    dir = makeTempDir();
    path = join(dir, "sestina.db");
    db = await openDatabase({ path });
    const thread = loadStorageFixture("valid-collaboration-thread.json");
    const message = loadStorageFixture("valid-collaboration-message.json");
    const endpoint = loadStorageFixture("valid-collaboration-endpoint.json");
    createThread(db, thread);
    createEndpoint(db, endpoint);
    createClaudeEndpoint(db);
    db.run(
      "INSERT INTO collaboration_messages (message_id, thread_id, project_id, task_id, kind, source_endpoint_id, summary, privacy_class, ttl_seconds, hop_count, dedupe_key, created_at, expires_at, data) VALUES (?, ?, ?, ?, 'consult', ?, ?, 'internal', ?, ?, ?, ?, ?, ?)",
      (message as { messageId: string }).messageId,
      (thread as { threadId: string }).threadId,
      (thread as { projectId: string }).projectId,
      (thread as { taskId: string }).taskId,
      (message as { sourceEndpointId: string }).sourceEndpointId,
      (message as { summary: string }).summary,
      (message as { ttlSeconds: number }).ttlSeconds,
      (message as { hopCount: number }).hopCount,
      (message as { dedupeKey: string }).dedupeKey,
      Date.now(),
      Date.now() + 1000,
      JSON.stringify(message),
    );
  });
  afterEach(() => {
    db.close();
    removeTempDir(dir);
  });

  const MESSAGE_ID = "01JGNK8W4QKERM9VA0C3N5Y7ZJ";
  const TARGET = "01JGNQAY6SMGTNB2CE5Q7A9BMM";

  it("grants only one owner across 100 concurrent claims for the same message+target", async () => {
    const connections: StorageDatabase[] = [];
    try {
      for (let i = 0; i < CONNECTIONS; i++) {
        connections.push(await openDatabase({ path }));
      }
      const outcomes = await Promise.all(
        connections.map(async (conn, ci) => {
          const out: string[] = [];
          for (let n = 0; n < CLAIMS_PER_CONNECTION; n++) {
            // Yield between claims (never inside the transaction) so the
            // connections interleave at claim boundaries.
            await Promise.resolve();
            out.push(
              await withTransaction(conn, (tx) =>
                claimMessageDeliveryLease(tx, {
                  messageId: MESSAGE_ID,
                  targetEndpointId: TARGET,
                  ownerId: `deliverer-${ci}-${n}`,
                }),
              ),
            );
          }
          return out;
        }),
      );
      const flat = outcomes.flat();
      const acquired = flat.filter((r) => r === "acquired");
      const waited = flat.filter((r) => r === "wait_for_existing");
      expect(acquired).toHaveLength(1);
      expect(waited.length + acquired.length).toBe(CONNECTIONS * CLAIMS_PER_CONNECTION);
    } finally {
      for (const c of connections) c.close();
    }
  });

  it("never lets a wrong owner release a delivery lease", async () => {
    await withTransaction(db, (tx) =>
      claimMessageDeliveryLease(tx, {
        messageId: MESSAGE_ID,
        targetEndpointId: TARGET,
        ownerId: "deliverer-real",
      }),
    );
    await withTransaction(db, (tx) =>
      { releaseMessageDeliveryLease(tx, {
        messageId: MESSAGE_ID,
        targetEndpointId: TARGET,
        ownerId: "deliverer-impostor",
      }); },
    );
    // The real owner still holds the lease: a fresh claim by anyone else
    // must still wait.
    const claim = await withTransaction(db, (tx) =>
      claimMessageDeliveryLease(tx, {
        messageId: MESSAGE_ID,
        targetEndpointId: TARGET,
        ownerId: "deliverer-third",
      }),
    );
    expect(claim).toBe("wait_for_existing");
  });

  it("returns already_delivered when a delivered attempt exists", async () => {
    await withTransaction(db, (tx) =>
      claimMessageDeliveryLease(tx, {
        messageId: MESSAGE_ID,
        targetEndpointId: TARGET,
        ownerId: "deliverer-1",
      }),
    );
    db.run(
      "INSERT INTO collaboration_delivery_attempts (attempt_id, message_id, target_endpoint_id, sequence, route, status, started_at, finished_at, data) VALUES ('delivered-attempt', ?, ?, 1, 'mcp-inbox', 'delivered', ?, ?, '{}')",
      MESSAGE_ID,
      TARGET,
      Date.now(),
      Date.now(),
    );
    await withTransaction(db, (tx) =>
      { releaseMessageDeliveryLease(tx, {
        messageId: MESSAGE_ID,
        targetEndpointId: TARGET,
        ownerId: "deliverer-1",
      }); },
    );

    const result = await withTransaction(db, (tx) =>
      claimMessageDeliveryLease(tx, {
        messageId: MESSAGE_ID,
        targetEndpointId: TARGET,
        ownerId: "deliverer-2",
      }),
    );
    expect(result).toBe("already_delivered");
  });

  it("keeps attempts append-only: both attempts persist with their own sequence", () => {
    const insert = (attemptId: string, sequence: number, status: string): void => {
      db.run(
        "INSERT INTO collaboration_delivery_attempts (attempt_id, message_id, target_endpoint_id, sequence, route, status, started_at, data) VALUES (?, ?, ?, ?, 'mcp-inbox', ?, ?, '{}')",
        attemptId,
        MESSAGE_ID,
        TARGET,
        sequence,
        status,
        Date.now(),
      );
    };
    insert("attempt-1", 1, "delivered");
    insert("attempt-2", 2, "failed");
    const rows = db.all<{ attempt_id: string; sequence: number; status: string }>(
      "SELECT attempt_id, sequence, status FROM collaboration_delivery_attempts WHERE message_id = ? AND target_endpoint_id = ? ORDER BY sequence",
      MESSAGE_ID,
      TARGET,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.attempt_id).toBe("attempt-1");
    expect(rows[1]?.attempt_id).toBe("attempt-2");
  });

  it("maps a lock timeout during lease claim to storage_busy", async () => {
    const holder = await openDatabase({ path });
    const contender = await openDatabase({ path, busyTimeoutMs: 60 });
    try {
      holder.exec("BEGIN IMMEDIATE");
      try {
        await withTransaction(contender, (tx) =>
          claimEventLease(tx, { idempotencyKey: "busy-lease-key", ownerId: "contender" }),
        );
        expect.unreachable("claim under a held write lock must fail with storage_busy");
      } catch (err) {
        expect(isSestinaError(err)).toBe(true);
        if (isSestinaError(err)) {
          expect(err.code).toBe(SestinaErrorCode.storage_busy);
        }
      }
    } finally {
      holder.exec("ROLLBACK");
      holder.close();
      contender.close();
    }
  });
});
