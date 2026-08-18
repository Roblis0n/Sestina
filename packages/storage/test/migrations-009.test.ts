import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import {
  openDatabase,
  MIGRATIONS,
  type StorageDatabase,
} from "../src/index.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

/**
 * Structural tests for migration 009 (docs/22 Task 8): nullable
 * host_sessions.task_id (sessions can be unattached/ambiguous, docs/30 §5),
 * canonical project_root_bindings columns, session_task_attachments
 * history, and the unowned_activity queue (docs/30 §10).
 */
describe("Migration 009 (project scope)", () => {
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

  function seedProjectAndTask(nowMs: number): void {
    db.run(
      "INSERT INTO projects (project_id, display_name, created_at, data) VALUES ('p9', 'p9', 0, '{}')",
    );
    db.run(
      "INSERT INTO tasks (task_id, project_id, status, created_at, updated_at, data) VALUES ('t9', 'p9', 'active', 0, 0, '{}')",
    );
    db.run(
      `INSERT INTO host_sessions (session_id, project_id, task_id, host, host_session_id, status, started_at, data)
       VALUES ('s9', 'p9', 't9', 'codex', 'hs-9', 'connected', ?, '{}')`,
      nowMs,
    );
  }

  it("records version 9 as completed", () => {
    const row = db.get<{ name: string; status: string }>(
      "SELECT name, status FROM migrations WHERE version = 9",
    );
    expect(row?.name).toBe("009-project-scope");
    expect(row?.status).toBe("completed");
    expect(MIGRATIONS.at(-1)?.version).toBe(12);
  });

  it("makes host_sessions.task_id nullable", () => {
    const column = db.get<{ notnull: number }>(
      "SELECT \"notnull\" FROM pragma_table_info('host_sessions') WHERE name = 'task_id'",
    );
    expect(column?.notnull).toBe(0);

    // An unattached session can be stored (docs/30 §5).
    seedProjectAndTask(1_000_000);
    db.run(
      `INSERT INTO host_sessions (session_id, project_id, task_id, host, host_session_id, status, started_at, data)
       VALUES ('s9-unattached', 'p9', NULL, 'claude_code', 'hs-9b', 'connected', 1_000_001, '{}')`,
    );
    const row = db.get<{ task_id: string | null }>(
      "SELECT task_id FROM host_sessions WHERE session_id = 's9-unattached'",
    );
    expect(row?.task_id).toBeNull();
  });

  it("preserves existing session task ids through the rebuild (upgrade path)", async () => {
    // A legacy v8 database under its own path: upgrade it in place.
    const legacyPath = join(dir, "legacy.db");
    const v8 = await openDatabase({
      path: legacyPath,
      migrate: { migrations: MIGRATIONS.slice(0, 8) },
    });
    v8.run(
      "INSERT INTO projects (project_id, display_name, created_at, data) VALUES ('p9', 'p9', 0, '{}')",
    );
    v8.run(
      "INSERT INTO tasks (task_id, project_id, status, created_at, updated_at, data) VALUES ('t9', 'p9', 'active', 0, 0, '{}')",
    );
    v8.run(
      `INSERT INTO host_sessions (session_id, project_id, task_id, host, host_session_id, status, started_at, data)
       VALUES ('s9', 'p9', 't9', 'codex', 'hs-9', 'connected', 1000000, ?)`,
      JSON.stringify({ visibilityLevel: "tool_lifecycle" }),
    );
    v8.close();

    const upgraded = await openDatabase({ path: legacyPath });
    try {
      const row = upgraded.get<{ task_id: string | null }>(
        "SELECT task_id FROM host_sessions WHERE session_id = 's9'",
      );
      expect(row?.task_id).toBe("t9");
      // The attachment history is backfilled with one active row.
      const attachment = upgraded.get<{ task_id: string; detached_at: number | null }>(
        "SELECT task_id, detached_at FROM session_task_attachments WHERE session_id = 's9'",
      );
      expect(attachment?.task_id).toBe("t9");
      expect(attachment?.detached_at).toBeNull();
    } finally {
      upgraded.close();
    }
  });

  it("detaches sessions when their task is deleted instead of cascading them away", () => {
    seedProjectAndTask(2_000_000);
    db.run("DELETE FROM tasks WHERE task_id = 't9'");
    const row = db.get<{ task_id: string | null }>(
      "SELECT task_id FROM host_sessions WHERE session_id = 's9'",
    );
    expect(row?.task_id).toBeNull();
  });

  it("adds the canonical root-binding columns and backfills the fingerprint from JSON", async () => {
    const columns = new Set(
      db.all<{ name: string }>("SELECT name FROM pragma_table_info('project_root_bindings')").map((c) => c.name),
    );
    for (const column of ["fingerprint", "confirmed", "source", "case_semantics"]) {
      expect(columns.has(column), `project_root_bindings missing ${column}`).toBe(true);
    }

    // The backfill runs during the upgrade: seed a legacy v8 binding whose
    // data JSON carries the fingerprint (Task 6 shape), then migrate it.
    const legacyPath = join(dir, "legacy-bindings.db");
    const v8 = await openDatabase({
      path: legacyPath,
      migrate: { migrations: MIGRATIONS.slice(0, 8) },
    });
    v8.run(
      "INSERT INTO projects (project_id, display_name, created_at, data) VALUES ('p9', 'p9', 0, '{}')",
    );
    v8.run(
      `INSERT INTO project_root_bindings (project_id, root_path, status, created_at, data)
       VALUES ('p9', '/work/root', 'active', 0, ?)`,
      JSON.stringify({ fingerprint: "fp-123", establishedAt: "2026-08-01T00:00:00.000Z" }),
    );
    v8.close();

    const upgraded = await openDatabase({ path: legacyPath });
    try {
      const binding = upgraded.get<{ fingerprint: string; confirmed: number; source: string }>(
        "SELECT fingerprint, confirmed, source FROM project_root_bindings WHERE project_id = 'p9'",
      );
      expect(binding?.fingerprint).toBe("fp-123");
      expect(binding?.confirmed).toBe(0);
      expect(binding?.source).toBe("discovered");
    } finally {
      upgraded.close();
    }
  });

  it("creates the unowned activity queue with a pending index", () => {
    const columns = new Set(
      db.all<{ name: string }>("SELECT name FROM pragma_table_info('unowned_activity')").map((c) => c.name),
    );
    for (const column of [
      "unowned_id",
      "host",
      "host_session_id",
      "occurred_at",
      "reason",
      "raw_event",
      "payload_hash",
      "created_at",
      "resolved_at",
      "resolved_project_id",
      "resolved_task_id",
    ]) {
      expect(columns.has(column), `unowned_activity missing ${column}`).toBe(true);
    }
    const indexes = db.all<{ name: string }>(
      "SELECT name FROM sqlite_schema WHERE type = 'index' AND tbl_name = 'unowned_activity'",
    );
    expect(indexes.some((i) => i.name === "idx_unowned_pending")).toBe(true);

    db.run(
      `INSERT INTO unowned_activity (unowned_id, host, host_session_id, occurred_at, reason, raw_event, payload_hash, created_at)
       VALUES ('u1', 'codex', 'hs-x', 1, 'no_project', '{"type":"turn.started"}', ?, 2)`,
      "a".repeat(64),
    );
    const pending = db.all<{ unowned_id: string }>(
      "SELECT unowned_id FROM unowned_activity WHERE resolved_at IS NULL ORDER BY created_at",
    );
    expect(pending.map((p) => p.unowned_id)).toEqual(["u1"]);
  });
});
