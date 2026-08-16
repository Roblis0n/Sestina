import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import {
  CorrectionSchema,
  generateId,
  SestinaErrorCode,
  type ActorProvenance,
  type Correction,
  type SestinaProject,
  type Task,
} from "@sestina/schema";
import { openDatabase, createUnitOfWork } from "../src/index.js";
import { makeTempDir, removeTempDir, expectSestinaCode } from "./helpers.js";
import type { StorageDatabase } from "../src/index.js";

const T0 = "2026-08-14T00:00:00.000Z";

function makeProject(overrides: Partial<SestinaProject> = {}): SestinaProject {
  return {
    projectId: generateId(),
    name: "correction-project",
    bindings: [],
    status: "active",
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

function makeTask(projectId: string, overrides: Partial<Task> = {}): Task {
  return {
    taskId: generateId(),
    projectId,
    title: "correction task",
    status: "active",
    priority: "normal",
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

function makeCorrection(
  projectId: string,
  taskId: string,
  overrides: Partial<Correction> = {},
): Correction {
  const actor: ActorProvenance = {
    actor: "user",
    channel: "desktop",
    directUser: true,
  };
  return {
    schemaVersion: "1.0.0",
    correctionId: generateId(),
    projectId,
    taskId,
    scope: "task",
    summary: "correction summary",
    normalizedInstruction: "correction instruction",
    originalEventRef: "event-ref-1",
    failureClass: "fact",
    severity: "moderate",
    actor,
    confirmed: true,
    recurrenceCount: 0,
    recurrenceFingerprint: "deadbeefdeadbeef",
    createdAt: T0,
    ...overrides,
  };
}

describe("CorrectionRepository (docs/22 Task 9)", () => {
  let dir: string;
  let db: StorageDatabase;
  const projectA = generateId();
  const projectB = generateId();
  const taskA = generateId();
  const taskB = generateId();

  beforeEach(async () => {
    dir = makeTempDir();
    db = await openDatabase({ path: join(dir, "sestina.db") });
    const uow = createUnitOfWork(db);
    uow.commit((u) => {
      u.projects.insert(makeProject({ projectId: projectA }));
      u.projects.insert(makeProject({ projectId: projectB }));
      u.tasks.insert(makeTask(projectA, { taskId: taskA }));
      u.tasks.insert(makeTask(projectB, { taskId: taskB }));
    });
  });

  afterEach(() => {
    db.close();
    removeTempDir(dir);
  });

  it("inserts and reads back the full correction", () => {
    const correction = makeCorrection(projectA, taskA, {
      expiresWhen: "2026-08-20T00:00:00.000Z",
    });
    const uow = createUnitOfWork(db);
    uow.commit((u) => {
      u.corrections.insert(projectA, correction);
    });
    const read = uow.corrections.get(projectA, correction.correctionId);
    expect(read).toEqual(correction);
    expect(CorrectionSchema.parse(read as unknown)).toEqual(correction);
  });

  it("rejects a correction whose task belongs to another project, writing nothing", () => {
    const correction = makeCorrection(projectB, taskB);
    const uow = createUnitOfWork(db);
    expectSestinaCode(() => {
      uow.commit((u) => {
        u.corrections.insert(projectA, correction);
      });
    }, SestinaErrorCode.task_not_found);
    expect(uow.corrections.get(projectA, correction.correctionId)).toBeUndefined();
    expect(uow.corrections.get(projectB, correction.correctionId)).toBeUndefined();
    const count = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM corrections");
    expect(count?.n).toBe(0);
  });

  it("rejects a correction whose own projectId disagrees with the fence project, writing nothing", () => {
    // The row would otherwise carry a project_id column of A with a data JSON
    // claiming B — an internally inconsistent record.
    const mismatched = makeCorrection(projectB, taskA);
    const uow = createUnitOfWork(db);
    expectSestinaCode(() => {
      uow.commit((u) => {
        u.corrections.insert(projectA, mismatched);
      });
    }, SestinaErrorCode.validation_failed);
    const count = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM corrections");
    expect(count?.n).toBe(0);
  });

  it("rejects an insert into a project that does not exist, writing nothing", () => {
    const ghost = generateId();
    const correction = makeCorrection(ghost, generateId());
    const uow = createUnitOfWork(db);
    expectSestinaCode(() => {
      uow.commit((u) => {
        u.corrections.insert(ghost, correction);
      });
    }, SestinaErrorCode.project_not_found);
    const count = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM corrections");
    expect(count?.n).toBe(0);
  });

  it("treats a foreign-project id exactly like a missing id on reads", () => {
    const correction = makeCorrection(projectA, taskA);
    const uow = createUnitOfWork(db);
    uow.commit((u) => {
      u.corrections.insert(projectA, correction);
    });
    expect(uow.corrections.get(projectB, correction.correctionId)).toBeUndefined();
    expect(uow.corrections.get(projectA, generateId())).toBeUndefined();
  });

  it("fences listByTask through task ownership", () => {
    const correction = makeCorrection(projectA, taskA);
    const uow = createUnitOfWork(db);
    uow.commit((u) => {
      u.corrections.insert(projectA, correction);
    });
    expect(uow.corrections.listByTask(projectB, taskA)).toHaveLength(0);
    expect(uow.corrections.listByTask(projectA, generateId())).toHaveLength(0);
    expect(uow.corrections.listByTask(projectA, taskA)).toHaveLength(1);
  });

  it("compares createdAt as instants, not lexically (fractional precision)", () => {
    // Lexically "...:00.500Z" < "...:00Z" ('.' < 'Z'), but chronologically
    // 00.500 is LATER than 00. Ordering and the strictly-older supersede
    // check must compare parsed instants.
    const plain = makeCorrection(projectA, taskA, {
      createdAt: "2026-08-14T02:00:00Z",
    });
    const fractional = makeCorrection(projectA, taskA, {
      createdAt: "2026-08-14T02:00:00.500Z",
    });
    const uow = createUnitOfWork(db);
    uow.commit((u) => {
      u.corrections.insert(projectA, fractional);
      u.corrections.insert(projectA, plain);
    });
    expect(uow.corrections.listByTask(projectA, taskA).map((c) => c.createdAt)).toEqual([
      "2026-08-14T02:00:00Z",
      "2026-08-14T02:00:00.500Z",
    ]);
  });

  it("supersede accepts a strictly older instant written with different precision", () => {
    const target = makeCorrection(projectA, taskA, {
      createdAt: "2026-08-14T02:00:00Z",
    });
    const uow = createUnitOfWork(db);
    uow.commit((u) => {
      u.corrections.insert(projectA, target);
    });
    // Same second, half a second later: chronologically strictly older
    // target, even though the lexical comparison would order it backwards.
    const newer = makeCorrection(projectA, taskA, {
      createdAt: "2026-08-14T02:00:00.500Z",
      supersededBy: target.correctionId,
    });
    uow.commit((u) => {
      u.corrections.insert(projectA, newer);
    });
    expect(uow.corrections.get(projectA, newer.correctionId)?.supersededBy).toBe(
      target.correctionId,
    );
  });

  it("supersede rejects an equal instant written with different precision", () => {
    const target = makeCorrection(projectA, taskA, {
      createdAt: "2026-08-14T02:00:00Z",
    });
    const uow = createUnitOfWork(db);
    uow.commit((u) => {
      u.corrections.insert(projectA, target);
    });
    // "02:00:00.000Z" is the SAME instant as "02:00:00Z": not strictly older.
    const sameInstant = makeCorrection(projectA, taskA, {
      createdAt: "2026-08-14T02:00:00.000Z",
      supersededBy: target.correctionId,
    });
    expectSestinaCode(() => {
      uow.commit((u) => {
        u.corrections.insert(projectA, sameInstant);
      });
    }, SestinaErrorCode.validation_failed);
    const count = db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM corrections WHERE project_id = ?",
      projectA,
    );
    expect(count?.n).toBe(1);
  });

  it("orders listByTask by data.createdAt ascending, then correctionId", () => {
    const baseId = "01H" + "0".repeat(22);
    const early = makeCorrection(projectA, taskA, {
      correctionId: `${baseId}1`,
      createdAt: "2026-08-14T01:00:00.000Z",
    });
    const middle = makeCorrection(projectA, taskA, {
      correctionId: `${baseId}2`,
      createdAt: "2026-08-14T02:00:00.000Z",
    });
    const tieA = makeCorrection(projectA, taskA, {
      correctionId: `${baseId}4`,
      createdAt: "2026-08-14T02:00:00.000Z",
    });
    const tieB = makeCorrection(projectA, taskA, {
      correctionId: `${baseId}5`,
      createdAt: "2026-08-14T02:00:00.000Z",
    });
    const latest = makeCorrection(projectA, taskA, {
      correctionId: `${baseId}3`,
      createdAt: "2026-08-14T03:00:00.000Z",
    });
    const uow = createUnitOfWork(db);
    uow.commit((u) => {
      for (const c of [latest, tieB, early, middle, tieA]) {
        u.corrections.insert(projectA, c);
      }
    });
    const ordered = uow.corrections.listByTask(projectA, taskA);
    expect(ordered.map((c) => c.correctionId)).toEqual([
      early.correctionId,
      middle.correctionId,
      tieA.correctionId,
      tieB.correctionId,
      latest.correctionId,
    ]);
  });

  it("listByProject returns only this project's corrections", () => {
    const uow = createUnitOfWork(db);
    uow.commit((u) => {
      u.corrections.insert(projectA, makeCorrection(projectA, taskA));
      u.corrections.insert(projectA, makeCorrection(projectA, taskA));
      u.corrections.insert(projectB, makeCorrection(projectB, taskB));
    });
    const listA = uow.corrections.listByProject(projectA);
    expect(listA).toHaveLength(2);
    for (const c of listA) {
      expect(c.projectId).toBe(projectA);
    }
    expect(uow.corrections.listByProject(generateId())).toHaveLength(0);
  });

  it("carries the supersededBy link on the NEW record and never rewrites the old one", () => {
    const older = makeCorrection(projectA, taskA, {
      createdAt: "2026-08-14T01:00:00.000Z",
    });
    const uow = createUnitOfWork(db);
    uow.commit((u) => {
      u.corrections.insert(projectA, older);
    });
    const rawBefore = db.get<{ data: string }>(
      "SELECT data FROM corrections WHERE correction_id = ?",
      older.correctionId,
    )?.data;
    expect(rawBefore).toBeDefined();

    const newer = makeCorrection(projectA, taskA, {
      createdAt: "2026-08-14T02:00:00.000Z",
      supersededBy: older.correctionId,
    });
    uow.commit((u) => {
      u.corrections.insert(projectA, newer);
    });

    // The link lives on the new record; the old row was never rewritten.
    const rawAfter = db.get<{ data: string }>(
      "SELECT data FROM corrections WHERE correction_id = ?",
      older.correctionId,
    )?.data;
    expect(rawAfter).toBe(rawBefore);

    const readOlder = uow.corrections.get(projectA, older.correctionId);
    expect(readOlder?.supersededBy).toBeUndefined();
    expect(readOlder).toEqual(older);
    const readNewer = uow.corrections.get(projectA, newer.correctionId);
    expect(readNewer?.supersededBy).toBe(older.correctionId);
  });

  it("insert rejects a supersededBy target that is missing or in another project, writing nothing", () => {
    const foreign = makeCorrection(projectB, taskB);
    const uow = createUnitOfWork(db);
    uow.commit((u) => {
      u.corrections.insert(projectB, foreign);
    });
    const badForeign = makeCorrection(projectA, taskA, {
      createdAt: "2026-08-14T02:00:00.000Z",
      supersededBy: foreign.correctionId,
    });
    expectSestinaCode(() => {
      uow.commit((u) => {
        u.corrections.insert(projectA, badForeign);
      });
    }, SestinaErrorCode.contract_not_found);
    const badMissing = makeCorrection(projectA, taskA, {
      createdAt: "2026-08-14T02:00:00.000Z",
      supersededBy: generateId(),
    });
    expectSestinaCode(() => {
      uow.commit((u) => {
        u.corrections.insert(projectA, badMissing);
      });
    }, SestinaErrorCode.contract_not_found);
    const count = db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM corrections WHERE project_id = ?",
      projectA,
    );
    expect(count?.n).toBe(0);
  });

  it("insert rejects a supersededBy target that is not strictly older", () => {
    const target = makeCorrection(projectA, taskA, {
      createdAt: "2026-08-14T02:00:00.000Z",
    });
    const uow = createUnitOfWork(db);
    uow.commit((u) => {
      u.corrections.insert(projectA, target);
    });
    // Same instant: a link must point at an OLDER record.
    const sameInstant = makeCorrection(projectA, taskA, {
      createdAt: target.createdAt,
      supersededBy: target.correctionId,
    });
    expectSestinaCode(() => {
      uow.commit((u) => {
        u.corrections.insert(projectA, sameInstant);
      });
    }, SestinaErrorCode.validation_failed);
    // Newer target than the linking record: the arrow would point backwards.
    const backwards = makeCorrection(projectA, taskA, {
      createdAt: "2026-08-14T01:00:00.000Z",
      supersededBy: target.correctionId,
    });
    expectSestinaCode(() => {
      uow.commit((u) => {
        u.corrections.insert(projectA, backwards);
      });
    }, SestinaErrorCode.validation_failed);
    const count = db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM corrections WHERE project_id = ?",
      projectA,
    );
    expect(count?.n).toBe(1);
  });

  it("insert rejects a supersededBy target that is already superseded", () => {
    const oldest = makeCorrection(projectA, taskA, {
      createdAt: "2026-08-14T01:00:00.000Z",
    });
    const middle = makeCorrection(projectA, taskA, {
      createdAt: "2026-08-14T02:00:00.000Z",
      supersededBy: oldest.correctionId,
    });
    const uow = createUnitOfWork(db);
    uow.commit((u) => {
      u.corrections.insert(projectA, oldest);
      u.corrections.insert(projectA, middle);
    });
    // oldest is already superseded by middle; a second link onto it is rejected.
    const latest = makeCorrection(projectA, taskA, {
      createdAt: "2026-08-14T03:00:00.000Z",
      supersededBy: oldest.correctionId,
    });
    expectSestinaCode(() => {
      uow.commit((u) => {
        u.corrections.insert(projectA, latest);
      });
    }, SestinaErrorCode.validation_failed);
    // A chain THROUGH the middle record is fine: middle itself is not yet superseded.
    const newest = makeCorrection(projectA, taskA, {
      createdAt: "2026-08-14T04:00:00.000Z",
      supersededBy: middle.correctionId,
    });
    uow.commit((u) => {
      u.corrections.insert(projectA, newest);
    });
    expect(uow.corrections.get(projectA, newest.correctionId)?.supersededBy).toBe(
      middle.correctionId,
    );
  });

  it("incrementRecurrence is monotonic and leaves every other field intact", () => {
    const correction = makeCorrection(projectA, taskA, { recurrenceCount: 2 });
    const uow = createUnitOfWork(db);
    uow.commit((u) => {
      u.corrections.insert(projectA, correction);
    });
    uow.commit((u) => {
      u.corrections.incrementRecurrence(projectA, correction.correctionId, 5);
    });
    const read = uow.corrections.get(projectA, correction.correctionId);
    expect(read?.recurrenceCount).toBe(5);
    const column = db.get<{ recurrence_count: number }>(
      "SELECT recurrence_count FROM corrections WHERE correction_id = ?",
      correction.correctionId,
    );
    expect(column?.recurrence_count).toBe(5);
    const rawText = db.get<{ data: string }>(
      "SELECT data FROM corrections WHERE correction_id = ?",
      correction.correctionId,
    )?.data;
    const raw = JSON.parse(rawText ?? "null") as Correction;
    expect(raw.recurrenceCount).toBe(5);
    expect({ ...raw, recurrenceCount: correction.recurrenceCount }).toEqual(correction);
  });

  it("incrementRecurrence rejects counts that do not increase", () => {
    const correction = makeCorrection(projectA, taskA, { recurrenceCount: 3 });
    const uow = createUnitOfWork(db);
    uow.commit((u) => {
      u.corrections.insert(projectA, correction);
    });
    expectSestinaCode(() => {
      uow.commit((u) => {
        u.corrections.incrementRecurrence(projectA, correction.correctionId, 3);
      });
    }, SestinaErrorCode.validation_failed);
    expectSestinaCode(() => {
      uow.commit((u) => {
        u.corrections.incrementRecurrence(projectA, correction.correctionId, 1);
      });
    }, SestinaErrorCode.validation_failed);
    expect(uow.corrections.get(projectA, correction.correctionId)?.recurrenceCount).toBe(3);
  });

  it("incrementRecurrence uses the same error for missing and cross-project ids", () => {
    const correction = makeCorrection(projectA, taskA);
    const uow = createUnitOfWork(db);
    uow.commit((u) => {
      u.corrections.insert(projectA, correction);
    });
    expectSestinaCode(() => {
      uow.commit((u) => {
        u.corrections.incrementRecurrence(projectA, generateId(), 1);
      });
    }, SestinaErrorCode.contract_not_found);
    expectSestinaCode(() => {
      uow.commit((u) => {
        u.corrections.incrementRecurrence(projectB, correction.correctionId, 1);
      });
    }, SestinaErrorCode.contract_not_found);
  });

  it("rejects writes outside a transaction", () => {
    const correction = makeCorrection(projectA, taskA);
    const uow = createUnitOfWork(db);
    expectSestinaCode(() => {
      uow.corrections.insert(projectA, correction);
    }, SestinaErrorCode.internal_error);
    expectSestinaCode(() => {
      uow.corrections.incrementRecurrence(projectA, correction.correctionId, 1);
    }, SestinaErrorCode.internal_error);
  });

  it("rolls back the whole unit when a later write throws", () => {
    const correction = makeCorrection(projectA, taskA);
    const uow = createUnitOfWork(db);
    expect(() => {
      uow.commit((u) => {
        u.corrections.insert(projectA, correction);
        throw new Error("unit failed");
      });
    }).toThrow("unit failed");
    expect(uow.corrections.get(projectA, correction.correctionId)).toBeUndefined();
    const count = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM corrections");
    expect(count?.n).toBe(0);
  });

  it("a readonly database rejects correction writes and persists nothing", async () => {
    const correction = makeCorrection(projectA, taskA);
    db.close();
    const ro = await openDatabase({ path: join(dir, "sestina.db"), readOnly: true });
    const roUow = createUnitOfWork(ro);
    expectSestinaCode(() => {
      roUow.commit((u) => {
        u.corrections.insert(projectA, correction);
      });
    }, SestinaErrorCode.database_readonly);
    expectSestinaCode(() => {
      roUow.commit((u) => {
        u.corrections.incrementRecurrence(projectA, correction.correctionId, 1);
      });
    }, SestinaErrorCode.database_readonly);
    ro.close();
    const reopened = await openDatabase({ path: join(dir, "sestina.db") });
    try {
      expect(createUnitOfWork(reopened).corrections.get(projectA, correction.correctionId)).toBeUndefined();
    } finally {
      reopened.close();
    }
  });

  it("rejects a correction whose data fails schema validation, writing nothing", () => {
    const peer: ActorProvenance = { actor: "user", channel: "mcp", directUser: false };
    // CorrectionSchema refine: only a direct user can confirm a correction.
    const bad = { ...makeCorrection(projectA, taskA, { actor: peer }), confirmed: true };
    const uow = createUnitOfWork(db);
    expectSestinaCode(() => {
      uow.commit((u) => {
        u.corrections.insert(projectA, bad);
      });
    }, SestinaErrorCode.validation_failed);
    const count = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM corrections");
    expect(count?.n).toBe(0);
  });
});
