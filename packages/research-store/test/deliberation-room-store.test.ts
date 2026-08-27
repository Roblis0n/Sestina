import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import {
  createDeliberationRoom,
  importManualExternalOpinion,
  stableResearchHash,
  type DeliberationParticipantSnapshot,
  type DeliberationSourceBinding,
} from "@sestina/research";
import { openDatabase, SCHEMA_VERSION, type StorageDatabase } from "@sestina/storage";
import { createResearchStore } from "../src/index.js";
import { makeScenario, USER_ACTOR } from "./fixtures.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

function value<T>(result: { ok: true; value: T } | { ok: false; error: { code: string } }): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

function hash(value: unknown): string {
  const result = stableResearchHash(value);
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

describe("SQLite RI-50 deliberation room repository", () => {
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

  function roomFixture(seed: number) {
    const scenario = makeScenario(seed);
    const sourceBase = { kind: "research_issue" as const, objectId: scenario.ids.create("riss_"), objectVersion: 2, question: "Does the evidence justify a causal interpretation?" };
    const source: DeliberationSourceBinding = { projectId: scenario.project.id, ...sourceBase, sourceHash: hash(sourceBase) };
    const participants: readonly [DeliberationParticipantSnapshot, DeliberationParticipantSnapshot] = [
      { id: scenario.ids.create("rpar_"), slot: "a", role: "independent_research_assessor", connectionId: `conn-a-${seed}`, providerId: `provider-a-${seed}`, family: "openai_compatible", model: "model-a", harnessId: "harness-a", runtimeIdentityHash: "a".repeat(64), endpointIdentityHash: "b".repeat(64), secretRefHash: "c".repeat(64), configGeneration: 1, locality: "local" },
      { id: scenario.ids.create("rpar_"), slot: "b", role: "independent_research_assessor", connectionId: `conn-b-${seed}`, providerId: `provider-b-${seed}`, family: "openai_compatible", model: "model-b", harnessId: "harness-b", runtimeIdentityHash: "d".repeat(64), endpointIdentityHash: "e".repeat(64), secretRefHash: "f".repeat(64), configGeneration: 2, locality: "external" },
    ];
    const room = value(createDeliberationRoom({ source, title: "Causal interpretation", participants, providerReadiness: "configured_distinct", commandId: "create-store-room", actor: USER_ACTOR }, { clock: scenario.clock, idFactory: scenario.ids }));
    return { scenario, source, room };
  }

  it("uses schema 19 and persists, reopens, pages, and project-isolates the complete aggregate JSON", async () => {
    expect(SCHEMA_VERSION).toBe(19);
    expect(db.get<{ name: string }>("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'deliberation_rooms'")?.name).toBe("deliberation_rooms");
    const fixture = roomFixture(18_000);
    const store = createResearchStore(db);
    value(store.projects.create(fixture.scenario.project));
    expect(store.deliberationRooms.create(fixture.room)).toEqual({ ok: true, value: fixture.room });
    expect(store.deliberationRooms.getActiveBySource(fixture.room.projectId, fixture.source.kind, fixture.source.objectId)).toEqual({ ok: true, value: fixture.room });
    expect(store.deliberationRooms.listByProject(fixture.room.projectId, { limit: 1 })).toMatchObject({ ok: true, value: { items: [fixture.room] } });
    expect(store.deliberationRooms.getById(makeScenario(18_500).project.id, fixture.room.id)).toEqual({ ok: true, value: undefined });

    db.close();
    db = await openDatabase({ path });
    expect(createResearchStore(db).deliberationRooms.getById(fixture.room.projectId, fixture.room.id)).toEqual({ ok: true, value: fixture.room });
  });

  it("enforces expected-version CAS, append-only history, and one active room per bound source", () => {
    const fixture = roomFixture(19_000);
    const store = createResearchStore(db);
    value(store.projects.create(fixture.scenario.project));
    value(store.deliberationRooms.create(fixture.room));
    const updated = value(importManualExternalOpinion(fixture.room, {
      expectedVersion: fixture.room.version,
      actor: USER_ACTOR,
      sourceLabel: "Manual note",
      providerClaim: "Unknown hosted provider",
      modelClaim: "Unknown model",
      capturedAt: "2026-08-26T08:30:00.000Z",
      contextDisclosure: "The author saw the room question.",
      sawParticipantAOutput: false,
      sawParticipantBOutput: false,
      publicContent: "The current design cannot establish causality.",
    }, { clock: fixture.scenario.clock, idFactory: fixture.scenario.ids }));
    expect(store.deliberationRooms.compareAndSwap(updated, fixture.room.version)).toEqual({ ok: true, value: updated });
    expect(store.deliberationRooms.compareAndSwap(updated, fixture.room.version)).toMatchObject({ ok: false, error: { code: "version_conflict" } });

    const duplicate = value(createDeliberationRoom({ source: fixture.source, title: "Duplicate room", participants: fixture.room.participants, providerReadiness: "configured_distinct", commandId: "create-store-duplicate", actor: USER_ACTOR }, { clock: fixture.scenario.clock, idFactory: fixture.scenario.ids }));
    expect(store.deliberationRooms.create(duplicate)).toMatchObject({ ok: false, error: { code: "deliberation_room_already_active" } });

    const stored = value(store.deliberationRooms.getById(fixture.room.projectId, fixture.room.id));
    expect(stored?.manualExternalOpinions).toEqual(updated.manualExternalOpinions);
    expect(stored?.transitions.slice(0, fixture.room.transitions.length)).toEqual(fixture.room.transitions);
  });
});
