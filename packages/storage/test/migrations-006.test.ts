import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import {
  openDatabase,
  MIGRATIONS,
  SCHEMA_VERSION,
  type StorageDatabase,
} from "../src/index.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

/**
 * Structural tests for migration 006 (docs/22 Task 6 fix): materialized
 * occurred_at on host_stream_events, retention_previews/retention_applied,
 * and the insert trigger that keeps occurred_at populated for new rows.
 */
describe("Migration 006 (retention snapshot)", () => {
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

  function seedSession(nowMs: number): void {
    db.run(
      "INSERT INTO projects (project_id, display_name, created_at, data) VALUES ('p6', 'p6', 0, '{}')",
    );
    db.run(
      "INSERT INTO tasks (task_id, project_id, status, created_at, updated_at, data) VALUES ('t6', 'p6', 'active', 0, 0, '{}')",
    );
    db.run(
      `INSERT INTO host_sessions (session_id, project_id, task_id, host, host_session_id, status, started_at, data)
       VALUES ('s6', 'p6', 't6', 'codex', 'hs-6', 'active', ?, '{}')`,
      nowMs,
    );
  }

  it("records version 6 as completed", () => {
    const row = db.get<{ name: string; status: string }>(
      "SELECT name, status FROM migrations WHERE version = 6",
    );
    expect(row?.name).toBe("006-retention-snapshot");
    expect(row?.status).toBe("completed");
    expect(MIGRATIONS.at(-1)?.version).toBe(SCHEMA_VERSION);
  });

  it("creates retention_previews and retention_applied with the snapshot columns", () => {
    const previewColumns = new Set(
      db.all<{ name: string }>("SELECT name FROM pragma_table_info('retention_previews')").map((c) => c.name),
    );
    for (const column of [
      "preview_id",
      "preview_hash",
      "created_at",
      "config_json",
      "targets_json",
      "total_estimated",
      "data",
    ]) {
      expect(previewColumns.has(column), `retention_previews missing ${column}`).toBe(true);
    }

    const appliedColumns = new Set(
      db.all<{ name: string }>("SELECT name FROM pragma_table_info('retention_applied')").map((c) => c.name),
    );
    for (const column of [
      "applied_id",
      "preview_id",
      "target_object",
      "applied_at",
      "row_count",
      "tombstone_count",
      "data",
    ]) {
      expect(appliedColumns.has(column), `retention_applied missing ${column}`).toBe(true);
    }

    // UNIQUE(preview_id, target_object): true idempotency, one applied row
    // per (preview, target) pair.
    const uniqueIndexes = db.all<{ name: string; unique: number }>(
      "SELECT name, \"unique\" FROM pragma_index_list('retention_applied')",
    );
    expect(uniqueIndexes.some((i) => i.unique === 1)).toBe(true);
  });

  it("adds occurred_at and its index to host_stream_events", () => {
    const columns = new Set(
      db.all<{ name: string }>("SELECT name FROM pragma_table_info('host_stream_events')").map((c) => c.name),
    );
    expect(columns.has("occurred_at")).toBe(true);

    const index = db.get<{ name: string }>(
      "SELECT name FROM sqlite_schema WHERE type = 'index' AND name = 'idx_host_stream_events_occurred'",
    );
    expect(index).toBeDefined();
  });

  it("backfills occurred_at from the data JSON and falls back to the session start", async () => {
    // A legacy v5 database under its own path: upgrade it in place.
    const legacyPath = join(dir, "legacy.db");
    const v5 = await openDatabase({
      path: legacyPath,
      migrate: { migrations: MIGRATIONS.slice(0, 5) },
    });
    v5.run(
      "INSERT INTO projects (project_id, display_name, created_at, data) VALUES ('p6', 'p6', 0, '{}')",
    );
    v5.run(
      "INSERT INTO tasks (task_id, project_id, status, created_at, updated_at, data) VALUES ('t6', 'p6', 'active', 0, 0, '{}')",
    );
    v5.run(
      `INSERT INTO host_sessions (session_id, project_id, task_id, host, host_session_id, status, started_at, data)
       VALUES ('s6', 'p6', 't6', 'codex', 'hs-6', 'active', 1000000, '{}')`,
    );
    v5.run(
      `INSERT INTO host_stream_events (stream_event_id, session_id, sequence, kind, data)
       VALUES ('hse-1', 's6', 1, 'user_message', ?)`,
      JSON.stringify({ occurredAt: "2026-08-13T00:00:00.000Z" }),
    );
    // Legacy row without occurredAt: the backfill falls back to the session start.
    v5.run(
      `INSERT INTO host_stream_events (stream_event_id, session_id, sequence, kind, data)
       VALUES ('hse-2', 's6', 2, 'user_message', '{}')`,
    );
    v5.close();

    const upgraded = await openDatabase({ path: legacyPath });
    try {
      const withTime = upgraded.get<{ occurred_at: number }>(
        "SELECT occurred_at FROM host_stream_events WHERE stream_event_id = 'hse-1'",
      );
      expect(withTime?.occurred_at).toBe(Date.parse("2026-08-13T00:00:00.000Z"));
      const without = upgraded.get<{ occurred_at: number }>(
        "SELECT occurred_at FROM host_stream_events WHERE stream_event_id = 'hse-2'",
      );
      expect(without?.occurred_at).toBe(1_000_000);
    } finally {
      upgraded.close();
    }
  });

  it("keeps occurred_at populated for rows appended after the migration", () => {
    seedSession(2_000_000);
    db.run(
      `INSERT INTO host_stream_events (stream_event_id, session_id, sequence, kind, data)
       VALUES ('hse-a', 's6', 1, 'user_message', ?)`,
      JSON.stringify({ occurredAt: "2026-08-13T12:34:56.789Z" }),
    );
    expect(
      db.get<{ occurred_at: number }>(
        "SELECT occurred_at FROM host_stream_events WHERE stream_event_id = 'hse-a'",
      )?.occurred_at,
    ).toBe(Date.parse("2026-08-13T12:34:56.789Z"));

    // No occurredAt in the JSON: the trigger falls back to the session start.
    db.run(
      `INSERT INTO host_stream_events (stream_event_id, session_id, sequence, kind, data)
       VALUES ('hse-b', 's6', 2, 'user_message', '{}')`,
    );
    expect(
      db.get<{ occurred_at: number }>(
        "SELECT occurred_at FROM host_stream_events WHERE stream_event_id = 'hse-b'",
      )?.occurred_at,
    ).toBe(2_000_000);
  });
});
