import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

// ── Child-process harness ──
// Spawned by parent tests via `vitest run` with SESTINA_CHILD_SCENARIO set.
// Imports stay inside the scenario blocks; in a normal run all scenarios
// are skipped and the file contributes nothing.

const scenario = process.env.SESTINA_CHILD_SCENARIO ?? "";

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  return raw === undefined ? fallback : Number(raw);
}

function envString(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("child scenarios (spawned by parent cross-process tests)", () => {
  describe.skipIf(scenario !== "hold-db-lock")("hold-db-lock", () => {
    it("child holds a database maintenance lock on the shared database", async () => {
      const { openDatabase, MaintenanceLock } = await import("../../src/index.js");
      const db = await openDatabase({
        path: envString("SESTINA_CHILD_DB_PATH", ""),
        migrate: false,
      });
      const lock = await MaintenanceLock.acquire(db, {
        name: envString("SESTINA_CHILD_LOCK_NAME", "cross-process"),
        ownerId: envString("SESTINA_CHILD_OWNER", "child"),
        ttlMs: envNumber("SESTINA_CHILD_TTL", 60000),
      });
      console.log(`CHILD_READY pid=${process.pid}`);
      await delay(envNumber("SESTINA_CHILD_HOLD_MS", 6000));
      lock.release();
      db.close();
      expect(true).toBe(true);
    }, 60000);
  });

  describe.skipIf(scenario !== "hold-fence")("hold-fence", () => {
    it("child holds the shared maintenance fence", async () => {
      const { MaintenanceFence } = await import("../../src/index.js");
      const fence = await MaintenanceFence.acquire({
        dataRoot: envString("SESTINA_CHILD_ROOT", ""),
        scope: envString("SESTINA_CHILD_SCOPE", "migrations"),
        ttlMs: envNumber("SESTINA_CHILD_TTL", 60000),
      });
      console.log(`CHILD_READY pid=${process.pid}`);
      await delay(envNumber("SESTINA_CHILD_HOLD_MS", 6000));
      fence.release();
      expect(true).toBe(true);
    }, 60000);
  });

  describe.skipIf(scenario !== "acquire-fence-short")("acquire-fence-short", () => {
    it("child acquires a short-lived fence, records its token, then exits without releasing", async () => {
      const { MaintenanceFence } = await import("../../src/index.js");
      const fence = await MaintenanceFence.acquire({
        dataRoot: envString("SESTINA_CHILD_ROOT", ""),
        scope: "restore",
        ttlMs: envNumber("SESTINA_CHILD_TTL", 250),
      });
      writeFileSync(
        envString("SESTINA_CHILD_TOKEN_FILE", join(envString("SESTINA_CHILD_ROOT", "."), "token.txt")),
        fence.token,
        "utf8",
      );
      console.log(`CHILD_READY pid=${process.pid}`);
      // Simulated crash: no release().
      expect(true).toBe(true);
    }, 60000);
  });

  describe.skipIf(scenario !== "allocate-sequences")("allocate-sequences", () => {
    it("child allocates stream sequences and records them for the parent", async () => {
      const { openDatabase, withTransaction, nextStreamSequence } = await import("../../src/index.js");
      const { generateId } = await import("@sestina/schema");
      const { writeFileSync } = await import("node:fs");
      const db = await openDatabase({
        path: envString("SESTINA_CHILD_DB_PATH", ""),
        migrate: false,
      });
      const count = envNumber("SESTINA_CHILD_SEQ_COUNT", 50);
      const projectId = envString("SESTINA_CHILD_PROJECT", "");
      const taskId = envString("SESTINA_CHILD_TASK", "");
      const allocated: number[] = [];
      for (let i = 0; i < count; i++) {
        // Small interleave jitter between allocations, never inside the tx.
        await delay(envNumber("SESTINA_CHILD_SEQ_JITTER_MS", 0));
        const seq = await withTransaction(db, (tx) => {
          const sequence = nextStreamSequence(tx, projectId);
          // Persist the row so the allocation is durable across processes.
          tx.run(
            `INSERT INTO events
               (event_id, idempotency_key, project_id, task_id, session_id, event_type,
                occurred_at, received_at, privacy_class, stream_sequence, data)
             VALUES (?, ?, ?, ?, NULL, 'stop', 1, 1, 'internal', ?, '{}')`,
            generateId(),
            generateId(),
            projectId,
            taskId,
            sequence,
          );
          return sequence;
        });
        allocated.push(seq);
      }
      writeFileSync(
        envString("SESTINA_CHILD_SEQ_FILE", ""),
        JSON.stringify(allocated),
        "utf8",
      );
      console.log(`CHILD_READY pid=${process.pid}`);
      db.close();
      expect(allocated.length).toBe(count);
    }, 60000);
  });

  describe.skipIf(scenario !== "stale-release-fence")("stale-release-fence", () => {
    it("child attempts a release with a stale token; the current fence must survive", async () => {
      const { MaintenanceFence } = await import("../../src/index.js");
      const root = envString("SESTINA_CHILD_ROOT", "");
      const token = envString("SESTINA_CHILD_TOKEN", "");
      const stale = MaintenanceFence.attach(root, token);
      stale.release(); // must be a no-op: the token no longer owns the fence
      const current = MaintenanceFence.peek(root);
      console.log("STALE_RELEASE_RESULT fence_token=" + (current?.token ?? "none"));
      expect(current).toBeDefined();
      expect(current?.token).not.toBe(token);
    }, 60000);
  });
});
