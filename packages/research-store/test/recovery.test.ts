import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { createResearchProject, type ResearchResult } from "@sestina/research";
import {
  backupDatabase,
  openDatabase,
  restoreDatabase,
  type StorageDatabase,
} from "@sestina/storage";
import { createResearchStore } from "../src/index.js";
import { makeScenario } from "./fixtures.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

function expectOk<T>(result: ResearchResult<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

describe("research backup and restore", () => {
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

  it("restores a complete research state from the existing hashed backup path", async () => {
    const scenario = makeScenario(17000);
    const store = createResearchStore(db);
    expectOk(store.projects.create(scenario.project));
    expectOk(store.artifacts.create(scenario.emptyArtifact));
    expectOk(store.revisions.append(scenario.revision1));
    expectOk(store.revisions.append(scenario.revision2));
    expectOk(store.briefs.create(scenario.brief));
    expectOk(store.decisions.create(scenario.decision));
    expectOk(store.issues.create(scenario.issue));
    expectOk(store.episodes.create(scenario.episode));
    expectOk(store.snapshots.create(scenario.snapshot));
    const backup = await backupDatabase(db, { backupDirectory: join(dir, "backups") });

    const later = expectOk(createResearchProject(
      { title: "created after backup", rootPath: ".", source: scenario.project.source },
      { clock: scenario.clock, idFactory: scenario.ids },
    ));
    expectOk(store.projects.create(later));
    db.close();
    await restoreDatabase({ databasePath: path, backupPath: backup.path, dataRoot: dir });
    db = await openDatabase({ path });
    const restored = createResearchStore(db);

    expect(expectOk(restored.snapshots.getById(scenario.project.id, scenario.snapshot.id)))
      .toEqual(scenario.snapshot);
    expect(expectOk(restored.artifacts.getById(scenario.project.id, scenario.artifact.id)))
      .toEqual(scenario.artifact);
    expect(expectOk(restored.projects.getById(later.id))).toBeUndefined();
  });
});
