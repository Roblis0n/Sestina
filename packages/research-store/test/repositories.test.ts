import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import {
  FixedClock,
  SequenceIdFactory,
  createResearchProject,
} from "@sestina/research";
import { openDatabase, type StorageDatabase } from "@sestina/storage";
import { createResearchStore } from "../src/index.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

const SOURCE = {
  actor: { kind: "user" as const, actorId: "lead" },
  authority: "user_recorded" as const,
  recordedAt: "2026-08-19T04:00:00.000Z",
};

describe("SQLite research repositories", () => {
  let dir: string;
  let path: string;
  let db: StorageDatabase;

  beforeEach(async () => {
    dir = makeTempDir();
    path = join(dir, "sestina.db");
    db = await openDatabase({ path });
  });

  afterEach(() => {
    db.close();
    removeTempDir(dir);
  });

  it("persists a validated project across close and reopen with text intact", async () => {
    const project = createResearchProject(
      { title: "问题 ‘α’\nDROP TABLE research_projects;", rootPath: ".", source: SOURCE },
      { clock: new FixedClock(SOURCE.recordedAt), idFactory: new SequenceIdFactory() },
    );
    expect(project.ok).toBe(true);
    if (!project.ok) return;

    const created = createResearchStore(db).projects.create(project.value);
    expect(created).toEqual({ ok: true, value: project.value });
    db.close();
    db = await openDatabase({ path });

    expect(createResearchStore(db).projects.getById(project.value.id)).toEqual({
      ok: true,
      value: project.value,
    });
  });
});
