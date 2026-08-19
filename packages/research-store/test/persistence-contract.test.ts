import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import {
  FixedClock,
  SequenceIdFactory,
  acknowledgeResearchIssue,
  activateRevisionEpisode,
  createArtifactRevision,
  createBriefChangeProposal,
  createResearchArtifact,
  createResearchDecision,
  confirmBriefChangeProposal,
  researchError,
  tombstoneResearchArtifact,
  transitionResearchDecision,
  updateResearchProject,
  type ResearchRepositories,
  type ResearchResult,
} from "@sestina/research";
import {
  SQLITE_FULL,
  mapSqliteError,
  openDatabase,
  type StorageDatabase,
} from "@sestina/storage";
import {
  createResearchStore,
  mapResearchStorageError,
  type ResearchStore,
} from "../src/index.js";
import { makeScenario, SYSTEM_ACTOR, USER_ACTOR, USER_SOURCE } from "./fixtures.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

function expectOk<T>(result: ResearchResult<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

function persistScenario(store: ResearchStore, seed = 2000) {
  const scenario = makeScenario(seed);
  expectOk(store.projects.create(scenario.project));
  expectOk(store.artifacts.create(scenario.emptyArtifact));
  expectOk(store.revisions.append(scenario.revision1));
  expectOk(store.revisions.append(scenario.revision2));
  expectOk(store.briefs.create(scenario.brief));
  expectOk(store.decisions.create(scenario.decision));
  expectOk(store.issues.create(scenario.issue));
  expectOk(store.episodes.create(scenario.episode));
  expectOk(store.snapshots.create(scenario.snapshot));
  return scenario;
}

describe("research-store persistence contract", () => {
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

  it("reopens every RI-11 through RI-15 object with equivalent immutable state", async () => {
    const scenario = persistScenario(createResearchStore(db));
    db.close();
    db = await openDatabase({ path });
    const reopened = createResearchStore(db);

    expect(expectOk(reopened.projects.getById(scenario.project.id))).toEqual(scenario.project);
    expect(expectOk(reopened.artifacts.getById(scenario.project.id, scenario.artifact.id))).toEqual(scenario.artifact);
    expect(expectOk(reopened.revisions.getById(scenario.project.id, scenario.artifact.id, scenario.revision2.id))).toEqual(scenario.revision2);
    expect(expectOk(reopened.briefs.getById(scenario.project.id, scenario.brief.id))).toEqual(scenario.brief);
    expect(expectOk(reopened.decisions.getById(scenario.project.id, scenario.decision.id))).toEqual(scenario.decision);
    expect(expectOk(reopened.issues.getById(scenario.project.id, scenario.issue.id))).toEqual(scenario.issue);
    expect(expectOk(reopened.episodes.getById(scenario.project.id, scenario.episode.id))).toEqual(scenario.episode);
    expect(expectOk(reopened.snapshots.getById(scenario.project.id, scenario.snapshot.id))).toEqual(scenario.snapshot);
    expect(Object.isFrozen(expectOk(reopened.snapshots.getById(scenario.project.id, scenario.snapshot.id)))).toBe(true);
  });

  it("uses database CAS so only one connection can win an expected version", async () => {
    const scenario = makeScenario(3000);
    const storeA = createResearchStore(db);
    expectOk(storeA.projects.create(scenario.project));
    const second = await openDatabase({ path });
    try {
      const storeB = createResearchStore(second);
      const nextA = expectOk(updateResearchProject(
        scenario.project,
        { title: "winner", expectedVersion: scenario.project.version },
        { clock: scenario.clock },
      ));
      const nextB = expectOk(updateResearchProject(
        scenario.project,
        { title: "loser", expectedVersion: scenario.project.version },
        { clock: scenario.clock },
      ));
      expectOk(storeA.projects.compareAndSwap(nextA, scenario.project.version));
      expect(storeB.projects.compareAndSwap(nextB, scenario.project.version)).toMatchObject({
        ok: false,
        error: { code: "version_conflict" },
      });
      expect(expectOk(storeB.projects.getById(scenario.project.id))?.title).toBe("winner");
    } finally {
      second.close();
    }
  });

  it("atomically appends decision and issue transitions without rewriting history", () => {
    const store = createResearchStore(db);
    const scenario = persistScenario(store, 4000);
    const accepted = expectOk(transitionResearchDecision(
      scenario.decision,
      "accepted",
      USER_ACTOR,
      scenario.decision.version,
      "User accepts the boundary",
      scenario.clock,
    ));
    expectOk(store.decisions.appendTransition(accepted, scenario.decision.version));
    expect(store.decisions.appendTransition(accepted, scenario.decision.version)).toMatchObject({
      ok: false,
      error: { code: "version_conflict" },
    });
    expect(expectOk(store.decisions.getById(scenario.project.id, scenario.decision.id))?.transitions)
      .toHaveLength(2);

    const acknowledged = expectOk(acknowledgeResearchIssue(
      scenario.issue,
      SYSTEM_ACTOR,
      scenario.issue.version,
      "Acknowledged",
      scenario.clock,
    ));
    expectOk(store.issues.appendTransition(acknowledged, scenario.issue.version));
    expect(expectOk(store.issues.getById(scenario.project.id, scenario.issue.id))?.transitions)
      .toHaveLength(2);
  });

  it("rolls back the aggregate when a transition insert fails midway", () => {
    const store = createResearchStore(db);
    const scenario = persistScenario(store, 4500);
    const accepted = expectOk(transitionResearchDecision(
      scenario.decision,
      "accepted",
      USER_ACTOR,
      scenario.decision.version,
      "User accepts the boundary",
      scenario.clock,
    ));
    db.exec(
      `CREATE TRIGGER fail_decision_transition
       BEFORE INSERT ON research_decision_transitions
       BEGIN SELECT RAISE(ABORT, 'controlled transition failure'); END`,
    );

    expect(store.decisions.appendTransition(accepted, scenario.decision.version)).toMatchObject({
      ok: false,
      error: { code: "research_storage_unavailable" },
    });
    expect(expectOk(store.decisions.getById(scenario.project.id, scenario.decision.id))).toEqual(
      scenario.decision,
    );
  });

  it("rolls back every repository write when a research unit fails", () => {
    const store = createResearchStore(db);
    const scenario = makeScenario(5000);
    const result = store.unitOfWork.commit((repositories: ResearchRepositories) => {
      const created = repositories.projects.create(scenario.project);
      if (!created.ok) return created;
      return { ok: false, error: researchError("invalid_project") };
    });
    expect(result).toMatchObject({ ok: false, error: { code: "invalid_project" } });
    expect(expectOk(store.projects.getById(scenario.project.id))).toBeUndefined();
  });

  it("keeps projects isolated and rejects a cursor replayed in another project", () => {
    const store = createResearchStore(db);
    const first = makeScenario(6000);
    const second = makeScenario(7000);
    expectOk(store.projects.create(first.project));
    expectOk(store.projects.create(second.project));
    const ids = new SequenceIdFactory(8000);
    const clock = new FixedClock("2026-08-19T05:00:00.000Z");
    const artifacts = Array.from({ length: 3 }, (_, index) => expectOk(createResearchArtifact(
      { projectId: first.project.id, kind: "research_note", title: `same-${index}`, source: USER_SOURCE },
      { clock, idFactory: ids },
    )));
    for (const artifact of artifacts) expectOk(store.artifacts.create(artifact));
    expectOk(store.artifacts.create(second.emptyArtifact));

    const page1 = expectOk(store.artifacts.listByProject(first.project.id, { limit: 1 }));
    const page2 = expectOk(store.artifacts.listByProject(first.project.id, { limit: 1, cursor: page1.nextCursor }));
    const page3 = expectOk(store.artifacts.listByProject(first.project.id, { limit: 1, cursor: page2.nextCursor }));
    expect([...page1.items, ...page2.items, ...page3.items].map((item) => item.id)).toEqual(
      artifacts.map((item) => item.id),
    );
    expect(store.artifacts.listByProject(second.project.id, { limit: 1, cursor: page1.nextCursor }))
      .toMatchObject({ ok: false, error: { code: "invalid_pagination" } });
    expect(expectOk(store.artifacts.getById(second.project.id, artifacts[0]?.id ?? ""))).toBeUndefined();

    const plan = db.all<{ detail: string }>(
      `EXPLAIN QUERY PLAN SELECT artifact_id FROM research_artifacts
       WHERE project_id = ? AND (created_at > ? OR (created_at = ? AND artifact_id > ?))
       ORDER BY created_at, artifact_id LIMIT ?`,
      first.project.id,
      artifacts[0]?.createdAt ?? "",
      artifacts[0]?.createdAt ?? "",
      artifacts[0]?.id ?? "",
      2,
    ).map((row) => row.detail).join("\n");
    expect(plan).toContain("idx_research_artifacts_project_created");
    expect(plan).not.toContain("TEMP B-TREE");
  });

  it("rejects cross-project revision parents at both repository and database boundaries", () => {
    const store = createResearchStore(db);
    const first = makeScenario(9000);
    const second = makeScenario(10000);
    expectOk(store.projects.create(first.project));
    expectOk(store.projects.create(second.project));
    expectOk(store.artifacts.create(first.emptyArtifact));
    expectOk(store.artifacts.create(second.emptyArtifact));
    expectOk(store.revisions.append(first.revision1));
    expectOk(store.revisions.append(second.revision1));
    const forged = expectOk(createArtifactRevision(
      {
        projectId: first.project.id,
        artifactId: first.emptyArtifact.id,
        parentRevisionId: second.revision1.id,
        content: "forged parent",
        mediaType: "text/plain",
        source: USER_SOURCE,
      },
      { clock: first.clock, idFactory: first.ids },
    ));
    expect(store.revisions.append(forged)).toMatchObject({
      ok: false,
      error: { code: "invalid_revision_parent" },
    });
  });

  it("fails closed on corrupt JSON, transition tampering and snapshot tampering", () => {
    const store = createResearchStore(db);
    const scenario = persistScenario(store, 11000);
    db.exec("PRAGMA ignore_check_constraints = ON");
    db.run("UPDATE research_projects SET data = 'not-json' WHERE project_id = ?", scenario.project.id);
    db.exec("PRAGMA ignore_check_constraints = OFF");
    expect(store.projects.getById(scenario.project.id)).toMatchObject({
      ok: false,
      error: { code: "research_storage_unavailable" },
    });

    const transition = db.get<{ data: string }>(
      `SELECT data FROM research_decision_transitions
       WHERE project_id = ? AND decision_id = ? AND transition_index = 0`,
      scenario.project.id,
      scenario.decision.id,
    );
    const tamperedTransition = { ...(JSON.parse(transition?.data ?? "{}") as object), reason: "tampered" };
    db.run(
      `UPDATE research_decision_transitions SET data = ?
       WHERE project_id = ? AND decision_id = ? AND transition_index = 0`,
      JSON.stringify(tamperedTransition),
      scenario.project.id,
      scenario.decision.id,
    );
    expect(store.decisions.getById(scenario.project.id, scenario.decision.id)).toMatchObject({
      ok: false,
      error: { code: "invalid_decision_transition" },
    });

    const snapshot = { ...scenario.snapshot, limitations: ["tampered"] };
    db.run(
      "UPDATE research_snapshots SET data = ? WHERE project_id = ? AND snapshot_id = ?",
      JSON.stringify(snapshot),
      scenario.project.id,
      scenario.snapshot.id,
    );
    expect(store.snapshots.getById(scenario.project.id, scenario.snapshot.id)).toMatchObject({
      ok: false,
      error: { code: "snapshot_hash_mismatch" },
    });
  });

  it("fails closed on an unknown stored enum", () => {
    const store = createResearchStore(db);
    const scenario = persistScenario(store, 11500);
    const stored = JSON.parse(db.get<{ data: string }>(
      "SELECT data FROM research_issues WHERE project_id = ? AND issue_id = ?",
      scenario.project.id,
      scenario.issue.id,
    )?.data ?? "{}") as Record<string, unknown>;
    db.exec("PRAGMA ignore_check_constraints = ON");
    db.run(
      "UPDATE research_issues SET status = ?, data = ? WHERE project_id = ? AND issue_id = ?",
      "invented",
      JSON.stringify({ ...stored, status: "invented" }),
      scenario.project.id,
      scenario.issue.id,
    );
    db.exec("PRAGMA ignore_check_constraints = OFF");

    expect(store.issues.getById(scenario.project.id, scenario.issue.id)).toMatchObject({
      ok: false,
      error: { code: "invalid_issue_transition" },
    });
  });

  it("preserves rejected episode history and forbids overwriting immutable snapshots", () => {
    const store = createResearchStore(db);
    const scenario = persistScenario(store, 12000);
    const episode = expectOk(store.episodes.getById(scenario.project.id, scenario.episode.id));
    expect(episode?.status).toBe("rejected");
    expect(episode?.transitions.map((item) => item.to)).toEqual([
      "draft", "active", "candidate_submitted", "reviewed", "user_action_required", "rejected",
    ]);
    expect(store.snapshots.create(scenario.snapshot)).toMatchObject({
      ok: false,
      error: { code: "version_conflict" },
    });
  });

  it("rejects writes through a read-only database", async () => {
    const scenario = makeScenario(13000);
    db.close();
    db = await openDatabase({ path, readOnly: true, migrate: false });
    expect(createResearchStore(db).projects.create(scenario.project)).toMatchObject({
      ok: false,
      error: { code: "research_storage_readonly" },
    });
  });

  it("maps a real SQLite lock conflict without exposing native error text", async () => {
    const second = await openDatabase({ path, busyTimeoutMs: 10 });
    const scenario = makeScenario(14000);
    db.exec("BEGIN IMMEDIATE");
    try {
      expect(createResearchStore(second).projects.create(scenario.project)).toMatchObject({
        ok: false,
        error: { code: "research_storage_unavailable" },
      });
    } finally {
      db.exec("ROLLBACK");
      second.close();
    }
  });

  it("maps a safely injected SQLite full failure to a content-free domain error", () => {
    const native = Object.assign(new Error("secret native path and content"), { errcode: SQLITE_FULL });
    const mapped = mapResearchStorageError(mapSqliteError(native, "safe storage failure"));
    expect(mapped).toEqual(researchError("research_storage_unavailable"));
    expect(mapped.message).not.toContain("secret");
  });

  it("rejects malformed entities before writing mapper output", () => {
    const store = createResearchStore(db);
    const scenario = makeScenario(14500);
    expect(store.projects.create({ ...scenario.project, version: 0 } as typeof scenario.project)).toMatchObject({
      ok: false,
      error: { code: "invalid_entity_version" },
    });
    expect(expectOk(store.projects.getById(scenario.project.id))).toBeUndefined();
  });

  it("does not write any legacy business table", () => {
    for (const table of ["projects", "tasks", "contracts", "situation_assertions", "evidence_items"]) {
      for (const operation of ["INSERT", "UPDATE", "DELETE"]) {
        db.exec(
          `CREATE TRIGGER deny_research_store_${table}_${operation.toLowerCase()}
           BEFORE ${operation} ON ${table}
           BEGIN SELECT RAISE(ABORT, 'legacy table write'); END`,
        );
      }
    }
    const scenario = makeScenario(15000);
    expectOk(createResearchStore(db).projects.create(scenario.project));
    expect(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM projects")?.count).toBe(0);
    expect(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM tasks")?.count).toBe(0);
  });

  it("persists an episode CAS update only when transition history keeps the stored prefix", () => {
    const store = createResearchStore(db);
    const scenario = makeScenario(16000);
    expectOk(store.projects.create(scenario.project));
    expectOk(store.artifacts.create(scenario.emptyArtifact));
    expectOk(store.revisions.append(scenario.revision1));
    expectOk(store.revisions.append(scenario.revision2));
    expectOk(store.episodes.create(scenario.draftEpisode));
    const active = expectOk(activateRevisionEpisode(
      scenario.draftEpisode,
      SYSTEM_ACTOR,
      scenario.draftEpisode.version,
      scenario.clock,
    ));
    expectOk(store.episodes.compareAndSwap(active, scenario.draftEpisode.version));
    expect(expectOk(store.episodes.getById(scenario.project.id, scenario.draftEpisode.id))?.status).toBe("active");
  });

  it("round-trips artifact tombstones and accepts decisions scoped to historical brief versions", () => {
    const store = createResearchStore(db);
    const scenario = persistScenario(store, 17000);
    const tombstoned = expectOk(tombstoneResearchArtifact(
      scenario.artifact,
      scenario.artifact.version,
      USER_SOURCE,
      scenario.clock,
    ));
    expectOk(store.artifacts.compareAndSwap(tombstoned, scenario.artifact.version));
    expect(expectOk(store.artifacts.getById(scenario.project.id, scenario.artifact.id))?.tombstone)
      .toEqual(tombstoned.tombstone);

    const proposed = expectOk(createBriefChangeProposal(
      scenario.brief,
      { changes: { currentTask: "新的研究任务" }, reason: "推进研究", source: USER_SOURCE },
      { clock: scenario.clock, idFactory: scenario.ids },
    ));
    expectOk(store.briefs.compareAndSwap(proposed.brief, scenario.brief.version));
    const confirmed = expectOk(confirmBriefChangeProposal(
      proposed.brief,
      proposed.proposal.id,
      USER_ACTOR,
      proposed.brief.version,
      { clock: scenario.clock, idFactory: scenario.ids },
    ));
    expectOk(store.briefs.compareAndSwap(confirmed, proposed.brief.version));
    const historicalDecision = expectOk(createResearchDecision(
      {
        projectId: scenario.project.id,
        statement: "旧版 brief 的边界仍可被引用",
        scope: { kind: "brief", briefVersionId: scenario.brief.currentVersionId },
        rationale: "决策作用域是不可变的 brief 版本",
        effectiveBriefVersionId: confirmed.currentVersionId,
        reopenConditions: ["用户修改该边界"],
        source: USER_SOURCE,
      },
      { clock: scenario.clock, idFactory: scenario.ids },
    ));
    expectOk(store.decisions.create(historicalDecision));
    expect(expectOk(store.decisions.getById(scenario.project.id, historicalDecision.id))).toEqual(
      historicalDecision,
    );
  });
});
