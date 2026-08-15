import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import {
  generateId,
  SestinaErrorCode,
  type SestinaProject,
  type Task,
  type TaskContract,
} from "@sestina/schema";
import { openDatabase, createUnitOfWork, type StorageDatabase } from "../src/index.js";
import { makeTempDir, removeTempDir, loadSchemaFixture, expectSestinaCode } from "./helpers.js";

// Task 9 hardening: the initial contract insert must be attributed to a task
// inside the caller's project, and the first version must be exactly 1.

function makeProject(overrides: Partial<SestinaProject> = {}): SestinaProject {
  return {
    projectId: generateId(),
    name: "storage-project",
    bindings: [],
    status: "active",
    privacy: { captureLevel: "minimal", defaultExportMinimisation: true },
    defaultTemplateId: null,
    createdAt: "2026-08-15T00:00:00.000Z",
    updatedAt: "2026-08-15T00:00:00.000Z",
    ...overrides,
  };
}

function makeTask(projectId: string, overrides: Partial<Task> = {}): Task {
  return {
    taskId: generateId(),
    projectId,
    title: "storage-task",
    status: "active",
    priority: "normal",
    createdAt: "2026-08-15T00:00:00.000Z",
    updatedAt: "2026-08-15T00:00:00.000Z",
    ...overrides,
  };
}

describe("ContractRepository.insert hardening (Task 9)", () => {
  let db: StorageDatabase;
  let dir: string;

  beforeEach(async () => {
    dir = makeTempDir("sestina-contract-insert-");
    db = await openDatabase({ path: join(dir, "sestina.db") });
  });

  afterEach(() => {
    db.close();
    removeTempDir(dir);
  });

  it("inserts a version-1 contract attributed to a task in the caller's project", () => {
    const uow = createUnitOfWork(db);
    const project = makeProject();
    const contract = loadSchemaFixture("valid-contract.json") as TaskContract;
    uow.commit((u) => {
      u.projects.insert(project);
      u.tasks.insert(makeTask(project.projectId, { taskId: contract.taskId }));
      u.contracts.insert(project.projectId, contract);
    });
    expect(
      uow.contracts.getCurrentByTask(project.projectId, contract.taskId)?.version,
    ).toBe(1);
  });

  it("rejects the initial insert when the task is not in the caller's project", () => {
    const uow = createUnitOfWork(db);
    const owner = makeProject();
    const stranger = makeProject();
    const contract = loadSchemaFixture("valid-contract.json") as TaskContract;
    uow.commit((u) => {
      u.projects.insert(owner);
      u.projects.insert(stranger);
      // The task belongs to `owner`; the insert claims `stranger`.
      u.tasks.insert(makeTask(owner.projectId, { taskId: contract.taskId }));
      expectSestinaCode(() => {
        u.contracts.insert(stranger.projectId, contract);
      }, SestinaErrorCode.task_not_found);
    });
    // Nothing was written: the fence failed before any insert.
    expect(
      uow.contracts.getCurrentByTask(owner.projectId, contract.taskId),
    ).toBeUndefined();
    expect(
      uow.contracts.getCurrentByTask(stranger.projectId, contract.taskId),
    ).toBeUndefined();
  });

  it("rejects the initial insert when the first version is not 1", () => {
    const uow = createUnitOfWork(db);
    const project = makeProject();
    const contract = {
      ...(loadSchemaFixture("valid-contract.json") as TaskContract),
      version: 2,
    };
    uow.commit((u) => {
      u.projects.insert(project);
      u.tasks.insert(makeTask(project.projectId, { taskId: contract.taskId }));
      expectSestinaCode(() => {
        u.contracts.insert(project.projectId, contract);
      }, SestinaErrorCode.validation_failed);
    });
    expect(
      uow.contracts.getCurrentByTask(project.projectId, contract.taskId),
    ).toBeUndefined();
  });
});
