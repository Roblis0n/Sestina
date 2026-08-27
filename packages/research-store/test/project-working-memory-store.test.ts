import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import {
  FixedClock,
  SequenceIdFactory,
  confirmProjectWorkingMemory,
  createProjectWorkingMemoryCandidate,
  createResumeCheckpoint,
  forgetProjectWorkingMemory,
  type ProjectWorkingMemory,
} from "@sestina/research";
import { openDatabase, type StorageDatabase } from "@sestina/storage";
import { createResearchStore, type ResearchStore } from "../src/index.js";
import { makeScenario, USER_ACTOR } from "./fixtures.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

describe("project working memory store", () => {
  let dir: string;
  let path: string;
  let db: StorageDatabase;
  let store: ResearchStore;
  const scenario = makeScenario(12_000);
  const ports = { clock: new FixedClock("2026-08-27T08:00:00.000Z"), idFactory: new SequenceIdFactory(13_000) };

  beforeEach(async () => {
    dir = makeTempDir();
    path = join(dir, "sestina.db");
    db = await openDatabase({ path });
    store = createResearchStore(db);
    const created = store.projects.create(scenario.project);
    if (!created.ok) throw new Error(created.error.code);
  });

  afterEach(() => {
    db.close();
    removeTempDir(dir);
  });

  function candidate(text = "Keep the evidence boundary visible."): ProjectWorkingMemory {
    const result = createProjectWorkingMemoryCandidate({
      projectId: scenario.project.id,
      kind: "working_hint",
      content: { text },
      source: { kind: "direct_user", actorId: USER_ACTOR.actorId },
      retention: { policy: "until_unpinned" },
      sensitivity: "project_private",
      outboundPolicy: "never_send",
      publicReason: "User explicitly created this candidate.",
      actor: USER_ACTOR,
    }, ports);
    if (!result.ok) throw new Error(result.error.code);
    return result.value;
  }

  it("persists strict project isolation, bounded paging, and compare-and-swap", () => {
    const first = candidate();
    expect(store.workingMemory.create(first)).toEqual({ ok: true, value: first });
    expect(store.workingMemory.getById("rprj_00000000000000000000000001", first.id)).toEqual({ ok: true, value: undefined });
    expect(store.workingMemory.listByProject(scenario.project.id, { limit: 1 })).toMatchObject({ ok: true, value: { items: [first] } });

    const active = confirmProjectWorkingMemory(first, { expectedVersion: first.version, actor: USER_ACTOR, publicReason: "confirmed" }, { ...ports, clock: new FixedClock("2026-08-27T08:01:00.000Z") });
    if (!active.ok) throw new Error(active.error.code);
    expect(store.workingMemory.compareAndSwap(active.value, first.version)).toEqual({ ok: true, value: active.value });
    expect(store.workingMemory.compareAndSwap(active.value, first.version)).toMatchObject({ ok: false, error: { code: "version_conflict" } });
  });

  it("survives restart and fail-closes corrupted enum data", async () => {
    const first = candidate();
    const created = store.workingMemory.create(first); if (!created.ok) throw new Error(created.error.code);
    db.close();
    db = await openDatabase({ path });
    store = createResearchStore(db);
    expect(store.workingMemory.getById(scenario.project.id, first.id)).toEqual({ ok: true, value: first });
    const corrupted = JSON.parse(String(db.get<{ data: string }>("SELECT data FROM project_working_memory WHERE item_id = ?", first.id)?.data)) as Record<string, unknown>;
    corrupted.state = "future_unknown_state";
    db.run("UPDATE project_working_memory SET data = ? WHERE item_id = ?", JSON.stringify(corrupted), first.id);
    expect(store.workingMemory.getById(scenario.project.id, first.id)).toMatchObject({ ok: false, error: { code: "research_storage_unavailable" } });
  });

  it("replaces forgotten content with the minimal opaque tombstone and never revives it on restart", async () => {
    const first = candidate("Sensitive working content that must disappear.");
    const created = store.workingMemory.create(first); if (!created.ok) throw new Error(created.error.code);
    const forgotten = forgetProjectWorkingMemory(first, { expectedVersion: first.version, actor: USER_ACTOR, confirmation: "FORGET", publicReason: "user_requested_irreversible_forget" }, { ...ports, clock: new FixedClock("2026-08-27T08:05:00.000Z") });
    if (!forgotten.ok) throw new Error(forgotten.error.code);
    expect(store.workingMemory.compareAndSwap(forgotten.value, first.version)).toEqual({ ok: true, value: forgotten.value });
    const row = db.get<{ data: string; kind: string | null; outbound_policy: string | null; source_object_id: string | null }>("SELECT data, kind, outbound_policy, source_object_id FROM project_working_memory WHERE item_id = ?", first.id);
    expect(row?.data === undefined ? undefined : JSON.parse(row.data)).toEqual(forgotten.value);
    expect(row).toMatchObject({ kind: null, outbound_policy: null, source_object_id: null });
    expect(row?.data).not.toContain("Sensitive working content");
    db.close();
    db = await openDatabase({ path });
    store = createResearchStore(db);
    expect(store.workingMemory.getById(scenario.project.id, first.id)).toEqual({ ok: true, value: forgotten.value });
  });

  it("appends and restores the latest project-bound Resume Checkpoint", () => {
    const checkpoint = createResumeCheckpoint({
      projectId: scenario.project.id,
      projectVersion: scenario.project.version,
      authorityBindings: [{ kind: "project", id: scenario.project.id, version: scenario.project.version }],
      memoryBindings: [],
      actor: USER_ACTOR,
      publicReason: "Reviewed current project state.",
    }, { ...ports, idFactory: new SequenceIdFactory(14_000) });
    if (!checkpoint.ok) throw new Error(checkpoint.error.code);
    expect(store.resumeCheckpoints.append(checkpoint.value)).toEqual({ ok: true, value: checkpoint.value });
    expect(store.resumeCheckpoints.getLatest(scenario.project.id)).toEqual({ ok: true, value: checkpoint.value });
    expect(store.resumeCheckpoints.getLatest("rprj_00000000000000000000000001")).toEqual({ ok: true, value: undefined });
  });
});
