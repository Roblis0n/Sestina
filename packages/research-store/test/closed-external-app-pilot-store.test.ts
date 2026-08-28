import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import {
  FixedClock,
  SequenceIdFactory,
  createClosedExternalAppPilot,
  prepareClosedPilotContext,
  recordClosedPilotPreflight,
  type ClosedExternalAppPilot,
} from "@sestina/research";
import { openDatabase, type StorageDatabase } from "@sestina/storage";
import { createResearchStore, type ResearchStore } from "../src/index.js";
import { makeScenario } from "./fixtures.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

const USER = { kind: "user" as const, actorId: "local-user" };

function value<T>(result: { ok: true; value: T } | { ok: false; error: { code: string } }): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

describe("SQLite RI-52 ClosedExternalAppPilot repository", () => {
  let dir: string;
  let path: string;
  let db: StorageDatabase;
  let store: ResearchStore;
  const scenario = makeScenario(52_000);

  beforeEach(async () => {
    dir = makeTempDir();
    path = join(dir, "sestina.db");
    db = await openDatabase({ path });
    store = createResearchStore(db);
    value(store.projects.create(scenario.project));
  });

  afterEach(() => {
    db.close();
    removeTempDir(dir);
  });

  function pilot(seed = 53_000): ClosedExternalAppPilot {
    return value(createClosedExternalAppPilot({
      projectId: scenario.project.id,
      brief: { id: scenario.ids.create("rbrf_"), versionId: scenario.ids.create("rbrf_"), version: 1 },
      episode: { id: scenario.ids.create("repi_"), version: 1 },
      currentTask: "Review the bounded synthetic candidate.",
      actor: USER,
      evidenceClass: "synthetic_fixture",
    }, { clock: new FixedClock("2026-08-28T04:00:00.000Z"), idFactory: new SequenceIdFactory(seed) }));
  }

  function prepared(base: ClosedExternalAppPilot, seed = 54_000): { readonly preflight: ClosedExternalAppPilot; readonly prepared: ClosedExternalAppPilot } {
    const preflight = value(recordClosedPilotPreflight(base, { expectedVersion: base.version, availability: "available", supportedVersion: "0.148.0", verifiedAt: "2026-08-28T03:59:00.000Z", capabilities: { start: "observed", structuredOutput: "observed", mcp: "observed", readOnlySandbox: "observed", cancellation: "observed", contextIsolation: "observed" } }, { clock: new FixedClock("2026-08-28T04:00:01.000Z"), idFactory: new SequenceIdFactory(seed) }));
    const prepared = value(prepareClosedPilotContext(preflight, {
      expectedVersion: preflight.version,
      kind: "candidate_generation",
      projectStateHash: "a".repeat(64),
      brief: { ...preflight.brief, projectQuestion: "Synthetic question" },
      episode: { ...preflight.episode, status: "active" },
      currentTask: preflight.currentTask,
      decisions: [], issues: [], evidence: [], workingMemory: [],
      excluded: [{ category: "working_memory", reason: "default_zero_selection", source: "project_memory", sensitivity: "project_private" }],
      disclosure: { externalModelServiceMayBeCalled: true, hostCan: ["read_frozen_context"], hostCannot: ["write_project"], timeoutMs: 120_000, outputLimitBytes: 65_536 },
      confirmationExpiresAt: "2026-08-28T04:15:00.000Z",
      actor: USER,
    }, { clock: new FixedClock("2026-08-28T04:00:02.000Z"), idFactory: new SequenceIdFactory(seed + 100) }));
    return { preflight, prepared };
  }

  it("persists project-isolated aggregate JSON, materialized attempts/events, bounded pages, and restart recovery", async () => {
    const first = pilot();
    expect(store.closedExternalAppPilots.create(first)).toEqual({ ok: true, value: first });
    expect(store.closedExternalAppPilots.getById(scenario.project.id, first.id)).toEqual({ ok: true, value: first });
    expect(store.closedExternalAppPilots.getById("rprj_00000000000000000000000001", first.id)).toEqual({ ok: true, value: undefined });
    expect(store.closedExternalAppPilots.listByProject(scenario.project.id, { limit: 1 })).toMatchObject({ ok: true, value: { items: [first] } });
    expect(value(store.closedExternalAppPilots.listEvents(scenario.project.id, first.id, { limit: 1 })).items).toEqual(first.events);

    const next = prepared(first);
    expect(store.closedExternalAppPilots.compareAndSwap(next.preflight, first.version)).toEqual({ ok: true, value: next.preflight });
    expect(store.closedExternalAppPilots.compareAndSwap(next.prepared, next.preflight.version)).toEqual({ ok: true, value: next.prepared });
    expect(value(store.closedExternalAppPilots.listAttempts(scenario.project.id, first.id, { limit: 1 })).items).toHaveLength(1);
    expect(value(store.closedExternalAppPilots.listEvents(scenario.project.id, first.id, { limit: 1 })).nextCursor).toBeDefined();

    db.close();
    db = await openDatabase({ path });
    store = createResearchStore(db);
    expect(store.closedExternalAppPilots.getById(scenario.project.id, first.id)).toEqual({ ok: true, value: next.prepared });
  });

  it("fails closed on stale CAS, duplicate nonce/candidate materialization, and corrupt aggregate state", () => {
    const first = pilot(55_000);
    value(store.closedExternalAppPilots.create(first));
    const next = prepared(first, 56_000);
    value(store.closedExternalAppPilots.compareAndSwap(next.preflight, first.version));
    value(store.closedExternalAppPilots.compareAndSwap(next.prepared, next.preflight.version));
    expect(store.closedExternalAppPilots.compareAndSwap(next.prepared, first.version)).toMatchObject({ ok: false, error: { code: "version_conflict" } });

    const corrupt = JSON.parse(String(db.get<{ data: string }>("SELECT data FROM closed_external_app_pilots WHERE pilot_id = ?", first.id)?.data)) as Record<string, unknown>;
    corrupt.status = "future_unknown_state";
    db.run("UPDATE closed_external_app_pilots SET data = ? WHERE pilot_id = ?", JSON.stringify(corrupt), first.id);
    expect(store.closedExternalAppPilots.getById(scenario.project.id, first.id)).toMatchObject({ ok: false, error: { code: "research_storage_unavailable" } });
  });
});
