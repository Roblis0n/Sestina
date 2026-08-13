import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { openDatabase, RUNTIME_VERSION } from "../src/index.js";
import { isSestinaError, SestinaErrorCode } from "@sestina/schema";
import { makeTempDir, removeTempDir } from "./helpers.js";

describe("Schema-too-new refusal (docs/09 §22, docs/19 §3)", () => {
  let dir: string;

  beforeEach(() => { dir = makeTempDir(); });
  afterEach(() => { removeTempDir(dir); });

  async function createFutureDatabase(path: string): Promise<void> {
    const db = await openDatabase({ path });
    db.run("INSERT INTO events (event_id, idempotency_key, project_id, task_id, event_type, occurred_at, received_at, privacy_class, data) VALUES ('e1','sk1','p','t','stop',1,1,'internal','{}')");
    db.exec(
      "INSERT INTO migrations (version, name, status, runtime_version, started_at, finished_at) VALUES (99, 'future-schema', 'completed', 'future-runtime', 1, 2)",
    );
    db.close();
  }

  it("rejects writes with migration_too_new and keeps the file intact", async () => {
    const path = join(dir, "sestina.db");
    await createFutureDatabase(path);

    await expect(openDatabase({ path })).rejects.toSatisfy((err: unknown) => {
      return isSestinaError(err) && err.code === SestinaErrorCode.migration_too_new;
    });
  });

  it("offers read-only export from a newer database", async () => {
    const path = join(dir, "sestina.db");
    await createFutureDatabase(path);

    const readOnly = await openDatabase({ path, readOnly: true });
    try {
      expect(readOnly.readOnly).toBe(true);
      const events = readOnly.all<{ event_id: string }>("SELECT event_id FROM events");
      expect(events.map((e) => e.event_id)).toContain("e1");

      try {
        readOnly.run("INSERT INTO events (event_id, idempotency_key, project_id, task_id, event_type, occurred_at, received_at, privacy_class, data) VALUES ('e2','sk2','p','t','stop',1,1,'internal','{}')");
        expect.unreachable("a newer schema must refuse writes");
      } catch (err) {
        expect(isSestinaError(err) && err.code === SestinaErrorCode.database_readonly).toBe(true);
      }
    } finally {
      readOnly.close();
    }
  });

  it("keeps the journal untouched by the refused open", async () => {
    const path = join(dir, "sestina.db");
    await createFutureDatabase(path);

    await expect(openDatabase({ path })).rejects.toSatisfy((err: unknown) => {
      return isSestinaError(err) && err.code === SestinaErrorCode.migration_too_new;
    });

    const readOnly = await openDatabase({ path, readOnly: true });
    try {
      const future = readOnly.get<{ runtime_version: string; status: string }>(
        "SELECT runtime_version, status FROM migrations WHERE version = 99",
      );
      expect(future).toEqual({ runtime_version: "future-runtime", status: "completed" });
    } finally {
      readOnly.close();
    }
  });

  it("records the runtime version in its own journal", async () => {
    const path = join(dir, "sestina.db");
    const db = await openDatabase({ path });
    try {
      const rows = db.all<{ runtime_version: string }>("SELECT DISTINCT runtime_version FROM migrations");
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.runtime_version).toBe(RUNTIME_VERSION);
      }
    } finally {
      db.close();
    }
  });

  it("reports migration_failed when a recorded failure blocks writes", async () => {
    const path = join(dir, "sestina.db");
    const db = await openDatabase({ path });
    db.run(
      "INSERT INTO migrations (version, name, status, runtime_version, started_at, finished_at, error_code) VALUES (50, 'broken', 'failed', ?, 1, 2, 'test-error')",
      RUNTIME_VERSION,
    );
    db.close();

    await expect(openDatabase({ path })).rejects.toSatisfy((err: unknown) => {
      return isSestinaError(err) && err.code === SestinaErrorCode.migration_failed;
    });
  });
});
