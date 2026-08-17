import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { StorageDatabase } from "../src/index.js";

// ── Temp directories (never touch real user data) ──

export function makeTempDir(prefix = "sestina-storage-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function removeTempDir(dir: string): void {
  // Windows may briefly hold file handles after close() (WAL sidecars) —
  // retry a few times before giving up.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      const sab = new SharedArrayBuffer(4);
      Atomics.wait(new Int32Array(sab), 0, 0, 50);
    }
  }
  rmSync(dir, { recursive: true, force: true });
}

// ── Fixtures ──

const FIXTURES = resolve(import.meta.dirname, "../../../tests/fixtures/storage");

export function loadStorageFixture(name: string): unknown {
  return JSON.parse(readFileSync(resolve(FIXTURES, name), "utf8")) as unknown;
}

// ── Corruption helpers (test-only) ──

/**
 * Corrupts the data pages of the events table specifically, so integrity
 * checks and events queries fail while the header and sqlite_schema stay
 * readable for read-only diagnostics (docs/19 §5.3).
 */
export function corruptDatabaseFile(path: string): void {
  const raw = new DatabaseSync(path, { open: true, readOnly: true });
  let rootpage: number;
  try {
    const row = raw
      .prepare("SELECT rootpage FROM sqlite_schema WHERE name = 'events'")
      .get() as { rootpage?: number } | undefined;
    rootpage = row?.rootpage ?? 2;
  } finally {
    raw.close();
  }

  const pageSize = 4096;
  const buf = readFileSync(path);
  // Page N starts at (N-1) * pageSize (page 1 holds the header at offset 0).
  const start = (rootpage - 1) * pageSize;
  const end = Math.min(buf.length, start + pageSize);
  for (let i = start; i < end; i += 64) {
    buf[i] = 0xab;
  }
  writeFileSync(path, buf);
}

/** Writes bytes that are not a SQLite database at all. */
export function writeGarbageFile(path: string): void {
  writeFileSync(path, "this is not a sqlite database, just a plain text file");
}

// ── Minimal seeding helpers (JSON goes through schema before insert) ──

/** Seeds the project/task rows the thread FK requires (idempotent). */
export function createTask(
  db: StorageDatabase,
  input: { taskId: string; projectId: string },
): void {
  db.run(
    `INSERT INTO projects (project_id, display_name, created_at, data)
     VALUES (?, 'test-project', ?, '{}')
     ON CONFLICT(project_id) DO NOTHING`,
    input.projectId,
    Date.now(),
  );
  db.run(
    `INSERT INTO tasks (task_id, project_id, status, created_at, updated_at, data)
     VALUES (?, ?, 'active', ?, ?, '{}')
     ON CONFLICT(task_id) DO NOTHING`,
    input.taskId,
    input.projectId,
    Date.now(),
    Date.now(),
  );
}

export function createThread(db: StorageDatabase, thread: unknown): void {
  createTask(db, {
    taskId: (thread as { taskId: string }).taskId,
    projectId: (thread as { projectId: string }).projectId,
  });
  db.run(
    `INSERT INTO collaboration_threads
       (thread_id, project_id, task_id, status, created_at, updated_at, data)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    (thread as { threadId: string }).threadId,
    (thread as { projectId: string }).projectId,
    (thread as { taskId: string }).taskId,
    (thread as { status: string }).status,
    Date.now(),
    Date.now(),
    JSON.stringify(thread),
  );
}

export function createEndpoint(db: StorageDatabase, endpoint: unknown): void {
  createTask(db, {
    taskId: (endpoint as { taskId: string }).taskId,
    projectId: (endpoint as { projectId: string }).projectId,
  });
  db.run(
    `INSERT INTO collaboration_endpoints
       (endpoint_id, project_id, task_id, host, host_session_id, capability,
        inbound_policy, connected, last_seen_at, data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(endpoint_id) DO NOTHING`,
    (endpoint as { endpointId: string }).endpointId,
    (endpoint as { projectId: string }).projectId,
    (endpoint as { taskId: string }).taskId,
    (endpoint as { host: string }).host,
    (endpoint as { hostSessionId: string }).hostSessionId,
    (endpoint as { capability: string }).capability,
    (endpoint as { inboundPolicy: string }).inboundPolicy,
    (endpoint as { connected: boolean }).connected ? 1 : 0,
    Date.now(),
    JSON.stringify(endpoint),
  );
}

/** Seeds the claude_code endpoint that fixtures target (idempotent). */
export function createClaudeEndpoint(db: StorageDatabase): void {
  const endpoint = loadStorageFixture("valid-collaboration-endpoint.json");
  createEndpoint(db, {
    ...(endpoint as Record<string, unknown>),
    endpointId: "01JGNQAY6SMGTNB2CE5Q7A9BMM",
    host: "claude_code",
    hostSessionId: "session-claude-001",
  });
}

export function createMessage(db: StorageDatabase, message: unknown): void {
  db.run(
    `INSERT INTO collaboration_messages
       (message_id, thread_id, project_id, task_id, kind, source_endpoint_id,
        summary, body, privacy_class, ttl_seconds, hop_count, dedupe_key,
        created_at, expires_at, data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    (message as { messageId: string }).messageId,
    (message as { threadId: string }).threadId,
    (message as { projectId: string }).projectId,
    (message as { taskId: string }).taskId,
    (message as { kind: string }).kind,
    (message as { sourceEndpointId: string }).sourceEndpointId,
    (message as { summary: string }).summary,
    (message as { body?: string }).body ?? null,
    (message as { privacyClass: string }).privacyClass,
    (message as { ttlSeconds: number }).ttlSeconds,
    (message as { hopCount: number }).hopCount,
    (message as { dedupeKey: string }).dedupeKey,
    Date.now(),
    Date.now() + (message as { ttlSeconds: number }).ttlSeconds * 1000,
    JSON.stringify(message),
  );
}


/**
 * Seeds a complete collaboration scenario (project/task/thread/endpoints/
 * evidence refs) so repository ownership checks pass, and returns a live
 * message built from the fixture.
 */
export function seedCollaboration(db: StorageDatabase): {
  thread: unknown; endpoint: unknown; message: unknown; targetEndpointId: string;
} {
  const thread = loadStorageFixture("valid-collaboration-thread.json") as {
    threadId: string; projectId: string; taskId: string; participantEndpointIds: string[];
  };
  const endpoint = loadStorageFixture("valid-collaboration-endpoint.json") as {
    endpointId: string; projectId: string; taskId: string; host: string; hostSessionId: string;
    capability: string; inboundPolicy: string; connected: boolean;
  };
  const message = loadStorageFixture("valid-collaboration-message.json") as Record<string, unknown>;
  createTask(db, { taskId: thread.taskId, projectId: thread.projectId });
  createThread(db, thread);
  createEndpoint(db, endpoint);
  createClaudeEndpoint(db);
  // Evidence refs referenced by the message must resolve.
  for (const ref of (message.evidenceRefs as string[] | undefined) ?? []) {
    db.run(
      `INSERT INTO evidence_items (evidence_id, project_id, task_id, type, status, content_hash, recorded_by, observed_at, expires_at, data)
       VALUES (?, ?, ?, 'primary_source', 'verified', 'h' || ?, 'user', ?, NULL, '{}')
       ON CONFLICT(evidence_id) DO NOTHING`,
      ref,
      thread.projectId,
      thread.taskId,
      ref,
      Date.now(),
    );
  }
  const targetEndpointId = (message.targetEndpointIds as string[] | undefined)?.[0] ?? "";
  return {
    thread,
    endpoint,
    message: {
      ...message,
      createdAt: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    },
    targetEndpointId,
  };
}

// ── Child-process harness (real cross-process tests, docs/21 §9) ──

import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { dirname } from "node:path";

export interface ChildRunOptions {
  scenario: string;
  env?: Record<string, string>;
  /** Max ms to wait for the READY marker (default 20000). */
  readyTimeoutMs?: number;
}

export interface ChildRun {
  process: ChildProcess;
  combinedOutput: () => string;
  /** Resolves true once the child printed CHILD_READY, false on timeout. */
  waitForReady: () => Promise<boolean>;
  /** Resolves with the exit code. */
  wait: () => Promise<number>;
}

const require = createRequire(import.meta.url);

function resolveVitestCli(): string {
  const pkgPath = require.resolve("vitest/package.json");
  return join(dirname(pkgPath), "vitest.mjs");
}

export function spawnChildScenario(options: ChildRunOptions): ChildRun {
  const vitestCli = resolveVitestCli();
  const child = spawn(
    process.execPath,
    [vitestCli, "run", "test/child/child-scenarios.test.ts", "--no-color"],
    {
      cwd: resolve(import.meta.dirname, ".."),
      env: {
        ...process.env,
        SESTINA_CHILD_SCENARIO: options.scenario,
        ...options.env,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  let output = "";
  child.stdout.on("data", (d: Buffer) => { output += d.toString(); });
  child.stderr.on("data", (d: Buffer) => { output += d.toString(); });
  let exitCode: number | null = null;
  const exited = new Promise<number>((resolveExit) => {
    child.on("exit", (code) => {
      exitCode = code ?? -1;
      resolveExit(exitCode);
    });
  });
  return {
    process: child,
    combinedOutput: () => output,
    waitForReady: async () => {
      const deadline = Date.now() + (options.readyTimeoutMs ?? 60000);
      while (Date.now() < deadline) {
        if (output.includes("CHILD_READY")) return true;
        if (exitCode !== null) return false;
        await new Promise((r) => setTimeout(r, 50));
      }
      return output.includes("CHILD_READY");
    },
    wait: () => exited,
  };
}

const SCHEMA_FIXTURES = resolve(import.meta.dirname, "../../../tests/fixtures/schema");

export function loadSchemaFixture(name: string): unknown {
  return JSON.parse(readFileSync(resolve(SCHEMA_FIXTURES, name), "utf8")) as unknown;
}

/** Asserts the call throws a SestinaError with the given code. */
export function expectSestinaCode(run: () => void, code: string): void {
  try {
    run();
  } catch (err) {
    if ((err as { name?: string }).name === "SestinaError") {
      if ((err as { code?: string }).code === code) return;
      throw new Error(`expected code ${code}, got ${(err as { code?: string }).code}`, { cause: err });
    }
    throw new Error("expected a SestinaError", { cause: err });
  }
  throw new Error(`expected a SestinaError with code ${code}`);
}
