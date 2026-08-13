import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import {
  openDatabase,
  SCHEMA_VERSION,
  RUNTIME_VERSION,
  MIGRATIONS,
  MaintenanceLock,
  type StorageDatabase,
  type Migration,
} from "../src/index.js";
import { isSestinaError, SestinaErrorCode } from "@sestina/schema";
import { makeTempDir, removeTempDir, loadStorageFixture, createThread, createEndpoint, createClaudeEndpoint } from "./helpers.js";

// ── Docs/09 §21 minimum table set (Task 5 first migration) ──
const DOC09_MINIMUM_TABLES = [
  "projects",
  "project_root_bindings",
  "tasks",
  "host_sessions",
  "host_stream_events",
  "contracts",
  "contract_versions",
  "boundaries",
  "deliverables",
  "events",
  "decisions",
  "decision_traces",
  "decision_trace_stages",
  "rule_findings",
  "judgment_requests",
  "judge_opinions",
  "situation_assertions",
  "evidence_items",
  "claims",
  "claim_evidence",
  "corrections",
  "override_grants",
  "conversations",
  "conversation_messages",
  "context_refs",
  "governance_actions",
  "collaboration_threads",
  "collaboration_messages",
  "collaboration_delivery_attempts",
  "collaboration_endpoints",
  "collaboration_actions",
  "review_items",
  "review_actions",
  "notification_states",
  "provider_usage",
  "migrations",
  "maintenance_events",
];

// Task 5 lease/maintenance infrastructure on top of the doc 09 minimum set.
const TASK5_INFRASTRUCTURE_TABLES = [
  "event_leases",
  "collaboration_delivery_leases",
  "maintenance_locks",
];

const FTS_TABLES = [
  "fts_claims",
  "fts_evidence",
  "fts_conversation_messages",
  "fts_collaboration_messages",
];

describe("First migration creates the doc 09 §21 minimum schema", () => {
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

  it("creates all minimum tables plus Task 5 lease infrastructure", () => {
    const tables = new Set(
      db.all<{ name: string }>("SELECT name FROM sqlite_schema WHERE type = 'table'").map((r) => r.name),
    );
    for (const table of [...DOC09_MINIMUM_TABLES, ...TASK5_INFRASTRUCTURE_TABLES]) {
      expect(tables.has(table), `missing table ${table}`).toBe(true);
    }
  });

  it("uses STRICT tables", () => {
    for (const table of [...DOC09_MINIMUM_TABLES, ...TASK5_INFRASTRUCTURE_TABLES]) {
      const sql = db
        .get<{ sql: string }>("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?", table)
        ?.sql ?? "";
      expect(sql.trim().toUpperCase().endsWith("STRICT"), `table ${table} is not STRICT`).toBe(true);
    }
  });

  it("records the migration journal with started/completed states", () => {
    const rows = db.all<{
      version: number;
      name: string;
      status: string;
      runtime_version: string;
      started_at: number;
      finished_at: number | null;
    }>("SELECT version, name, status, runtime_version, started_at, finished_at FROM migrations ORDER BY version");
    expect(rows.map((r) => r.version)).toEqual(MIGRATIONS.map((m) => m.version));
    for (const row of rows) {
      expect(row.status).toBe("completed");
      expect(row.runtime_version).toBe(RUNTIME_VERSION);
      expect(row.started_at).toBeGreaterThan(0);
      expect(row.finished_at).toBeGreaterThanOrEqual(row.started_at);
    }
    expect(MIGRATIONS.at(-1)?.version).toBe(SCHEMA_VERSION);
  });

  it("enforces foreign keys", () => {
    expect(() =>
      db.run(
        "INSERT INTO collaboration_messages (message_id, thread_id, project_id, task_id, kind, source_endpoint_id, summary, privacy_class, ttl_seconds, hop_count, dedupe_key, created_at, expires_at, data) VALUES ('x','missing-thread','p','t','status','e','s','internal',1,0,'d',1,2,'{}')",
      ),
    ).toThrow();
  });

  it("cascades collaboration_messages when the thread is deleted", () => {
    const thread = loadStorageFixture("valid-collaboration-thread.json");
    createThread(db, thread);
    db.run("INSERT INTO collaboration_messages (message_id, thread_id, project_id, task_id, kind, source_endpoint_id, summary, privacy_class, ttl_seconds, hop_count, dedupe_key, created_at, expires_at, data) VALUES ('m1', ?, ?, ?, 'status', ?, 's', 'internal', 1, 0, 'd1', 1, 2, '{}')",
      (thread as { threadId: string }).threadId,
      (thread as { projectId: string }).projectId,
      (thread as { taskId: string }).taskId,
      (thread as { participantEndpointIds: string[] }).participantEndpointIds[0]);
    db.run("DELETE FROM collaboration_threads WHERE thread_id = ?", (thread as { threadId: string }).threadId);
    expect(db.get("SELECT message_id FROM collaboration_messages WHERE message_id = 'm1'")).toBeUndefined();
  });

  it("enforces the unique event idempotency key", () => {
    db.run("INSERT INTO events (event_id, idempotency_key, project_id, task_id, event_type, occurred_at, received_at, privacy_class, data) VALUES ('e1','key-1','p','t','stop',1,1,'internal','{}')");
    expect(() =>
      db.run("INSERT INTO events (event_id, idempotency_key, project_id, task_id, event_type, occurred_at, received_at, privacy_class, data) VALUES ('e2','key-1','p','t','stop',1,1,'internal','{}')"),
    ).toThrow();
  });

  it("creates project/task indexes and the message/target dedupe key", () => {
    const indexNames = new Set(
      db.all<{ name: string }>("SELECT name FROM sqlite_schema WHERE type = 'index'").map((r) => r.name),
    );
    for (const index of [
      "idx_events_project_occurred",
      "idx_collab_threads_project_task",
      "idx_collab_messages_thread",
      "idx_collab_attempts_message_target",
      "idx_collab_endpoints_project_task",
    ]) {
      expect(indexNames.has(index), `missing index ${index}`).toBe(true);
    }

    const thread = loadStorageFixture("valid-collaboration-thread.json");
    createThread(db, thread);
    createEndpoint(db, loadStorageFixture("valid-collaboration-endpoint.json"));
    createClaudeEndpoint(db);
    db.run(
      "INSERT INTO collaboration_messages (message_id, thread_id, project_id, task_id, kind, source_endpoint_id, summary, privacy_class, ttl_seconds, hop_count, dedupe_key, created_at, expires_at, data) VALUES (?, ?, ?, ?, 'status', ?, 's', 'internal', 1, 0, 'dk', 1, 2, '{}')",
      "01JGNK8W4QKERM9VA0C3N5Y7ZJ",
      (thread as { threadId: string }).threadId,
      (thread as { projectId: string }).projectId,
      (thread as { taskId: string }).taskId,
      (thread as { participantEndpointIds: string[] }).participantEndpointIds[0],
    );
    const insertAttempt = (attemptId: string, sequence: number): void => {
      db.run(
        "INSERT INTO collaboration_delivery_attempts (attempt_id, message_id, target_endpoint_id, sequence, route, status, started_at, data) VALUES (?, ?, ?, ?, 'mcp-inbox', 'queued', 1, '{}')",
        attemptId,
        "01JGNK8W4QKERM9VA0C3N5Y7ZJ",
        (thread as { participantEndpointIds: string[] }).participantEndpointIds[1] ?? "",
        sequence,
      );
    };
    insertAttempt("a1", 1);
    // Same (message, target, sequence) is a unique idempotency key.
    expect(() => { insertAttempt("a2", 1); }).toThrow();
  });

  it("keeps sensitive bodies in dedicated columns", () => {
    const evidenceColumns = new Set(
      db.all<{ name: string }>("SELECT name FROM pragma_table_info('evidence_items')").map((c) => c.name),
    );
    expect(evidenceColumns.has("excerpt")).toBe(true);
    const conversationColumns = new Set(
      db.all<{ name: string }>("SELECT name FROM pragma_table_info('conversation_messages')").map((c) => c.name),
    );
    expect(conversationColumns.has("body")).toBe(true);
    const collabColumns = new Set(
      db.all<{ name: string }>("SELECT name FROM pragma_table_info('collaboration_messages')").map((c) => c.name),
    );
    expect(collabColumns.has("summary")).toBe(true);
    expect(collabColumns.has("body")).toBe(true);
  });

  it("creates the FTS index tables and keeps them in sync with deletions", () => {
    const tables = new Set(
      db.all<{ name: string }>("SELECT name FROM sqlite_schema WHERE type = 'table'").map((r) => r.name),
    );
    for (const table of FTS_TABLES) {
      expect(tables.has(table), `missing FTS table ${table}`).toBe(true);
    }

    db.run(
      "INSERT INTO claims (claim_id, project_id, task_id, type, status, confidence, text, data) VALUES ('c1', 'p', 't', 'factual', 'supported', 0.9, 'needle claim text', '{}')",
    );
    const found = db.all<{ claim_id: string }>(
      "SELECT rowid AS claim_id FROM fts_claims WHERE fts_claims MATCH 'needle'",
    );
    expect(found.length).toBe(1);

    db.run("DELETE FROM claims WHERE claim_id = 'c1'");
    const afterDelete = db.all<{ claim_id: string }>(
      "SELECT rowid AS claim_id FROM fts_claims WHERE fts_claims MATCH 'needle'",
    );
    expect(afterDelete).toHaveLength(0);
  });

  it("is idempotent: reopening runs no migration twice", async () => {
    db.close();
    const again = await openDatabase({ path: join(dir, "sestina.db") });
    try {
      const rows = again.all<{ version: number; status: string }>(
        "SELECT version, status FROM migrations ORDER BY version",
      );
      expect(rows.map((r) => r.version)).toEqual(MIGRATIONS.map((m) => m.version));
      expect(rows.every((r) => r.status === "completed")).toBe(true);
    } finally {
      again.close();
    }
  });
});

describe("Migration failure keeps the original database readable", () => {
  let dir: string;

  beforeEach(() => { dir = makeTempDir(); });
  afterEach(() => { removeTempDir(dir); });

  function seedV1(path: string): Promise<StorageDatabase> {
    return openDatabase({ path, migrate: { migrations: MIGRATIONS.slice(0, 1) } });
  }

  const brokenV2: Migration = {
    version: 2,
    name: "002-broken",
    up(db) {
      db.exec("CREATE TABLE v2_scratch (x TEXT NOT NULL)");
      db.exec("SELECT * FROM table_that_does_not_exist"); // forces failure after DDL
    },
  };

  it("throws migration_failed, keeps v1 data readable, and keeps a hashed backup", async () => {
    const path = join(dir, "sestina.db");
    const backupDir = join(dir, "backups");
    const v1 = await seedV1(path);
    v1.exec("CREATE TABLE user_data (value TEXT NOT NULL)");
    v1.run("INSERT INTO user_data (value) VALUES ('keep-me')");
    v1.close();

    await expect(
      openDatabase({ path, migrate: { migrations: [...MIGRATIONS.slice(0, 1), brokenV2], backupDirectory: backupDir } }),
    ).rejects.toSatisfy((err: unknown) => {
      return isSestinaError(err) && err.code === SestinaErrorCode.migration_failed;
    });

    // The journal records the failure with an error code.
    const diagnostic = await openDatabase({ path, readOnly: true });
    try {
      expect(diagnostic.get("SELECT value FROM user_data")?.value).toBe("keep-me");
      const failed = diagnostic.get<{ status: string; error_code: string | null }>(
        "SELECT status, error_code FROM migrations WHERE version = 2",
      );
      expect(failed?.status).toBe("failed");
      expect(failed?.error_code).toBeTruthy();
      // v2 DDL was rolled back with the transaction.
      expect(diagnostic.get("SELECT name FROM sqlite_schema WHERE name = 'v2_scratch'")).toBeUndefined();
      // The database file was not replaced by an empty library.
      const tables = diagnostic.all<{ name: string }>(
        "SELECT name FROM sqlite_schema WHERE type='table'",
      ).map((r) => r.name);
      expect(tables).toContain("user_data");
    } finally {
      diagnostic.close();
    }

    // A backup with a verifiable hash exists.
    const backups = readdirSync(backupDir).filter((f) => f.endsWith(".sqlite"));
    expect(backups.length).toBeGreaterThan(0);
    const backupPath = join(backupDir, backups[0] ?? "");
    expect(existsSync(backupPath)).toBe(true);
    const hashSidecar = readFileSync(`${backupPath}.sha256`, "utf8").trim();
    expect(hashSidecar).toMatch(/^[a-f0-9]{64}$/);
  });

  it("retries a failed migration after the code is fixed", async () => {
    const path = join(dir, "sestina.db");
    const backupDir = join(dir, "backups");
    const v1 = await seedV1(path);
    v1.close();

    await expect(
      openDatabase({ path, migrate: { migrations: [...MIGRATIONS.slice(0, 1), brokenV2], backupDirectory: backupDir } }),
    ).rejects.toSatisfy((err: unknown) => isSestinaError(err) && err.code === SestinaErrorCode.migration_failed);

    const fixedV2: Migration = {
      version: 2,
      name: "002-fixed",
      up(db) { db.exec("CREATE TABLE v2_scratch (x TEXT NOT NULL)"); },
    };
    const repaired = await openDatabase({
      path,
      migrate: { migrations: [...MIGRATIONS.slice(0, 1), fixedV2], backupDirectory: backupDir },
    });
    try {
      const row = repaired.get<{ status: string }>("SELECT status FROM migrations WHERE version = 2");
      expect(row?.status).toBe("completed");
      expect(repaired.get("SELECT name FROM sqlite_schema WHERE name='v2_scratch'")).toBeTruthy();
    } finally {
      repaired.close();
    }
  });

  it("backs up before upgrading an existing database even without explicit configuration", async () => {
    const path = join(dir, "auto-backup.db");
    const v1 = await openDatabase({ path, migrate: { migrations: MIGRATIONS.slice(0, 1) } });
    v1.close();

    // A default open migrates v2 and, because the database already exists,
    // takes a hashed backup next to the database file (docs/17 §10).
    const upgraded = await openDatabase({ path });
    upgraded.close();

    const backupsDir = join(dir, "backups");
    expect(existsSync(backupsDir)).toBe(true);
    const backups = readdirSync(backupsDir).filter((f) => f.endsWith(".sqlite"));
    expect(backups.length).toBeGreaterThan(0);
    const sidecars = readdirSync(backupsDir).filter((f) => f.endsWith(".sha256"));
    expect(sidecars.length).toBe(backups.length);
  });

  it("keeps at most 3 successful migration backups", async () => {
    const path = join(dir, "sestina.db");
    const backupDir = join(dir, "backups");
    const migrations: Migration[] = [
      MIGRATIONS[0],
      { version: 2, name: "002", up(db) { db.exec("CREATE TABLE m2 (x TEXT)"); } },
      { version: 3, name: "003", up(db) { db.exec("CREATE TABLE m3 (x TEXT)"); } },
      { version: 4, name: "004", up(db) { db.exec("CREATE TABLE m4 (x TEXT)"); } },
    ];
    // Seed an existing database so the three pending migrations are
    // destructive upgrades that each take a backup.
    const seed = await openDatabase({ path, migrate: { migrations: [MIGRATIONS[0]] } });
    seed.close();
    const db = await openDatabase({ path, migrate: { migrations, backupDirectory: backupDir } });
    db.close();
    const backups = readdirSync(backupDir).filter((f) => f.endsWith(".sqlite"));
    expect(backups).toHaveLength(3);
  });
});

describe("MaintenanceLock (docs/17 §3.2, docs/29 §9)", () => {
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

  it("acquires, renews and releases", async () => {
    const lock = await MaintenanceLock.acquire(db, { name: "maintenance", ownerId: "owner-a" });
    const initial = db.get<{ expires_at: number }>(
      "SELECT expires_at FROM maintenance_locks WHERE name = 'maintenance'",
    );
    lock.renew(120_000);
    const renewed = db.get<{ expires_at: number }>(
      "SELECT expires_at FROM maintenance_locks WHERE name = 'maintenance'",
    );
    expect((renewed?.expires_at ?? 0) - (initial?.expires_at ?? 0)).toBeGreaterThan(30_000);
    lock.release();
    expect(db.get("SELECT owner_id FROM maintenance_locks WHERE name = 'maintenance'")).toBeUndefined();
    const again = await MaintenanceLock.acquire(db, { name: "maintenance", ownerId: "owner-a" });
    again.release();
  });

  it("rejects invalid lock TTLs", async () => {
    await expect(
      MaintenanceLock.acquire(db, { name: "maintenance", ownerId: "owner-a", ttlMs: -5 }),
    ).rejects.toSatisfy((err: unknown) => {
      return isSestinaError(err) && err.code === SestinaErrorCode.validation_failed;
    });
  });

  it("rejects a second owner while held", async () => {
    const lock = await MaintenanceLock.acquire(db, { name: "maintenance", ownerId: "owner-a" });
    try {
      await expect(
        MaintenanceLock.acquire(db, { name: "maintenance", ownerId: "owner-b" }),
      ).rejects.toSatisfy((err: unknown) => {
        return isSestinaError(err) && err.code === SestinaErrorCode.storage_busy;
      });
    } finally {
      lock.release();
    }
    // After release a new owner may take it.
    const next = await MaintenanceLock.acquire(db, { name: "maintenance", ownerId: "owner-b" });
    next.release();
  });

  it("enforces the lock across connections", async () => {
    const other = await openDatabase({ path: join(dir, "sestina.db") });
    try {
      const lock = await MaintenanceLock.acquire(db, { name: "cross-conn", ownerId: "owner-a" });
      try {
        await expect(
          MaintenanceLock.acquire(other, { name: "cross-conn", ownerId: "owner-b" }),
        ).rejects.toSatisfy((err: unknown) => {
          return isSestinaError(err) && err.code === SestinaErrorCode.storage_busy;
        });
      } finally {
        lock.release();
      }
    } finally {
      other.close();
    }
  });

  it("takes over an expired lock", async () => {
    db.run(
      "INSERT INTO maintenance_locks (name, owner_id, expires_at) VALUES ('stale', 'owner-a', ?)",
      Date.now() - 1000,
    );
    const lock = await MaintenanceLock.acquire(db, { name: "stale", ownerId: "owner-b" });
    expect(db.get<{ owner_id: string }>("SELECT owner_id FROM maintenance_locks WHERE name = 'stale'")?.owner_id).toBe("owner-b");
    lock.release();
  });

  it("blocks two acquisitions of the same lock from the same runtime", async () => {
    const other = await openDatabase({ path: join(dir, "sestina.db") });
    try {
      // Same owner id on a different connection must still be refused: the
      // lock is exclusive per acquisition, not per owner id.
      const lock = await MaintenanceLock.acquire(db, { name: "same-runtime", ownerId: "runtime-0.1.0" });
      try {
        await expect(
          MaintenanceLock.acquire(other, { name: "same-runtime", ownerId: "runtime-0.1.0" }),
        ).rejects.toSatisfy((err: unknown) => {
          return isSestinaError(err) && err.code === SestinaErrorCode.storage_busy;
        });
      } finally {
        lock.release();
      }
    } finally {
      other.close();
    }
  });

  it("blocks migrations while another maintenance owner holds the lock", async () => {
    // Fresh database seeded with only the first migration so a second one
    // is pending when the lock is already held.
    const pendingPath = join(dir, "second.db");
    const v1 = await openDatabase({ path: pendingPath, migrate: { migrations: MIGRATIONS.slice(0, 1) } });
    v1.run(
      "INSERT INTO maintenance_locks (name, owner_id, expires_at) VALUES ('migrations', 'other-process', ?)",
      Date.now() + 60_000,
    );
    v1.close();

    await expect(openDatabase({ path: pendingPath })).rejects.toSatisfy((err: unknown) => {
      return isSestinaError(err) && err.code === SestinaErrorCode.storage_busy;
    });
  });
});

describe("Schema-too-new and interrupted journal states", () => {
  let dir: string;

  beforeEach(() => { dir = makeTempDir(); });
  afterEach(() => { removeTempDir(dir); });

  it("refuses writes and offers read-only export when the database schema is newer", async () => {
    const path = join(dir, "sestina.db");
    const first = await openDatabase({ path });
    first.exec("INSERT INTO migrations (version, name, status, runtime_version, started_at, finished_at) VALUES (99, 'future', 'completed', 'x', 1, 2)");
    first.close();

    await expect(openDatabase({ path })).rejects.toSatisfy((err: unknown) => {
      return isSestinaError(err) && err.code === SestinaErrorCode.migration_too_new && err.status === 400;
    });

    const diagnostic = await openDatabase({ path, readOnly: true });
    try {
      expect(diagnostic.all("SELECT name FROM sqlite_schema").length).toBeGreaterThan(0);
      try {
        diagnostic.run("CREATE TABLE nope (x TEXT)");
        expect.unreachable("schema-too-new database must reject writes");
      } catch (err) {
        expect(isSestinaError(err) && isSestinaError(err) && err.code === SestinaErrorCode.database_readonly).toBe(true);
      }
    } finally {
      diagnostic.close();
    }
  });

  it("re-runs a migration left in started state by an interrupted run", async () => {
    const path = join(dir, "sestina.db");
    const first = await openDatabase({ path, migrate: { migrations: MIGRATIONS.slice(0, 1) } });
    first.exec("INSERT INTO migrations (version, name, status, runtime_version, started_at, finished_at) VALUES (2, '002-fts', 'started', 'x', 1, NULL)");
    first.close();

    const second = await openDatabase({ path });
    try {
      const row = second.get<{ status: string }>("SELECT status FROM migrations WHERE version = 2");
      expect(row?.status).toBe("completed");
    } finally {
      second.close();
    }
  });
});
