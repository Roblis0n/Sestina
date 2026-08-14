import { describe, it, expect } from "vitest";

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

  describe.skipIf(scenario !== "hold-maintenance")("hold-maintenance", () => {
    it("child holds the shared maintenance guard on the lock database", async () => {
      const { MaintenanceGuard } = await import("../../src/index.js");
      const guard = await MaintenanceGuard.acquire({
        databasePath: envString("SESTINA_CHILD_DB_PATH", ""),
        scope: envString("SESTINA_CHILD_SCOPE", "migrations"),
        ownerId: "child-process",
      });
      console.log(`CHILD_READY pid=${process.pid}`);
      await delay(envNumber("SESTINA_CHILD_HOLD_MS", 6000));
      guard.release();
      expect(true).toBe(true);
    }, 120000);
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
        await delay(envNumber("SESTINA_CHILD_SEQ_JITTER_MS", 0));
        const seq = withTransaction(db, (tx) => {
          const sequence = nextStreamSequence(tx, projectId);
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

});
