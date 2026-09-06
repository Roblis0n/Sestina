import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openDatabase,
  withTransaction,
  type StorageDatabase,
} from "@sestina/storage";
import { createResearchStore } from "@sestina/research-store";
import {
  FixedClock,
  SequenceIdFactory,
  createResearchProject,
  researchError,
} from "@sestina/research";

const cleanup: { dir: string; db: StorageDatabase }[] = [];
afterEach(async () => {
  for (const { dir, db } of cleanup.splice(0)) {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
it("G3: a failed nested unit rolls back its own writes even when its caller handles the failure", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sestina-g3-red-"));
  const db = await openDatabase({ path: join(dir, "state.sqlite") });
  cleanup.push({ dir, db });
  const store = createResearchStore(db);
  const project = createResearchProject(
    {
      title: "Synthetic failed unit",
      rootPath: ".",
      source: {
        actor: { kind: "user", actorId: "synthetic" },
        authority: "user_recorded",
        recordedAt: "2026-09-01T00:00:00.000Z",
      },
    },
    {
      clock: new FixedClock("2026-09-01T00:00:00.000Z"),
      idFactory: new SequenceIdFactory(900),
    },
  );
  if (!project.ok) throw new Error(project.error.code);
  withTransaction(db, () => {
    const failed = store.unitOfWork.commit((repos) => {
      expect(repos.projects.create(project.value).ok).toBe(true);
      return { ok: false, error: researchError("version_conflict") };
    });
    expect(failed.ok).toBe(false);
  });
  expect(
    store.projects.getById(project.value.id),
    "An unsuccessful nested unit must never become durable through the outer commit.",
  ).toEqual({ ok: true, value: undefined });
});
