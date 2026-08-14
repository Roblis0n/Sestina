import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  generateId,
  type SestinaProject,
  type Task,
  type HostSession,
  type TaskContract,
} from "@sestina/schema";
import {
  openDatabase,
  createUnitOfWork,
  type StorageDatabase,
  type StorageUnitOfWork,
} from "@sestina/storage";

// Deterministic timestamps so keyset ordering and CAS fixtures stay stable.
export const T0 = "2026-08-14T00:00:00.000Z";
export const T1 = "2026-08-14T00:01:00.000Z";
export const T2 = "2026-08-14T00:02:00.000Z";
export const T3 = "2026-08-14T00:03:00.000Z";
export const T4 = "2026-08-14T00:04:00.000Z";
export const T5 = "2026-08-14T00:05:00.000Z";

export function makeTempDir(prefix = "sestina-projects-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function removeTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

export async function makeDb(dir: string): Promise<StorageDatabase> {
  return openDatabase({ path: join(dir, "sestina.db") });
}

export function makeProject(overrides: Partial<SestinaProject> = {}): SestinaProject {
  return {
    projectId: generateId(),
    name: "projects-test-project",
    bindings: [],
    status: "active",
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

export function makeTask(projectId: string, overrides: Partial<Task> = {}): Task {
  return {
    taskId: generateId(),
    projectId,
    title: "projects-test task",
    status: "active",
    priority: "normal",
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

export function makeSession(overrides: Partial<HostSession> = {}): HostSession {
  return {
    sessionId: generateId(),
    host: "codex",
    hostSessionId: `host-${generateId()}`,
    visibilityLevel: "tool_lifecycle",
    status: "connected",
    capabilities: ["tool_interception"],
    startedAt: T0,
    ...overrides,
  };
}

export function makeContract(overrides: Partial<TaskContract> = {}): TaskContract {
  const fixture = loadContractFixture();
  return {
    ...fixture,
    contractId: generateId(),
    taskId: generateId(),
    ...overrides,
  };
}

export function loadContractFixture(): TaskContract {
  const url = new URL("../../../tests/fixtures/schema/valid-contract.json", import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as TaskContract;
}

export function loadSchemaFixture(name: string): unknown {
  const url = new URL(`../../../tests/fixtures/schema/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as unknown;
}

/** Runs each mutation inside one synchronous write transaction. */
export function seed(
  db: StorageDatabase,
  ...ops: ((u: StorageUnitOfWork) => void)[]
): void {
  const uow = createUnitOfWork(db);
  uow.commit((u) => {
    for (const op of ops) op(u);
  });
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

/** Async variant for Promise-returning service methods. */
export async function expectSestinaCodeAsync(run: () => Promise<void>, code: string): Promise<void> {
  try {
    await run();
  } catch (err) {
    if ((err as { name?: string }).name === "SestinaError") {
      if ((err as { code?: string }).code === code) return;
      throw new Error(`expected code ${code}, got ${(err as { code?: string }).code}`, { cause: err });
    }
    throw new Error("expected a SestinaError", { cause: err });
  }
  throw new Error(`expected a SestinaError with code ${code}`);
}
