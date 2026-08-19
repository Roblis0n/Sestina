import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TaskContractSchema, type TaskContract } from "@sestina/schema";
import { openDatabase } from "@sestina/storage";
import {
  activateImportedResearchBriefDraft,
  getActiveResearchBriefVersion,
  parseResearchBrief,
} from "@sestina/research";
import {
  createLegacyImportPlan,
  executeLegacyImport,
  scanLegacyDatabase,
} from "../src/index.js";

const PROJECT = "01J00000000000000000000001";
const TASK = "01J00000000000000000000002";
const CONTRACT = "01J00000000000000000000003";
const CORRECTION = "01J00000000000000000000004";
const EVIDENCE = "01J00000000000000000000005";

function contract(): TaskContract {
  return TaskContractSchema.parse({
    schemaVersion: "1.0.0",
    contractId: CONTRACT,
    taskId: TASK,
    version: 1,
    status: "active",
    title: "Legacy research contract",
    objective: { primary: "Keep the research question stable", priority: "high" },
    deliverables: [{
      deliverableId: "legacy-deliverable",
      description: "A bounded revision",
      acceptanceChecks: ["scope remains intact"],
      required: true,
      status: "satisfied",
      evidenceRefs: [EVIDENCE],
    }],
    scope: { in: [], out: [] },
    boundaries: [],
    evidencePolicy: {
      requireSourceForClaims: true,
      minEvidenceLevel: "reference",
      allowUserTestimony: false,
    },
    authority: {
      executorCanChooseMethods: true,
      executorCanProposeScope: true,
      executorCanSelfReview: false,
      overridesRequireUserConfirmation: true,
    },
    budgets: {},
    stopConditions: [],
    assumptions: [],
    correctionRefs: [CORRECTION],
    sourceRefs: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  });
}

async function seedLegacy(path: string): Promise<void> {
  const db = await openDatabase({ path });
  try {
    db.run(
      "INSERT INTO projects (project_id, display_name, created_at, data) VALUES (?, ?, ?, ?)",
      PROJECT,
      "Legacy project",
      Date.parse("2026-08-01T00:00:00.000Z"),
      JSON.stringify({ name: "Legacy project" }),
    );
    db.run(
      "INSERT INTO tasks (task_id, project_id, status, created_at, updated_at, data) VALUES (?, ?, ?, ?, ?, ?)",
      TASK,
      PROJECT,
      "active",
      Date.parse("2026-08-01T00:00:00.000Z"),
      Date.parse("2026-08-01T00:00:00.000Z"),
      JSON.stringify({ taskId: TASK, projectId: PROJECT, title: "Legacy task" }),
    );
    db.run(
      "INSERT INTO contracts (contract_id, task_id, status, data) VALUES (?, ?, ?, ?)",
      CONTRACT,
      TASK,
      "active",
      JSON.stringify(contract()),
    );
    db.run(
      `INSERT INTO corrections
         (correction_id, project_id, task_id, scope, severity, confirmed,
          recurrence_count, expires_at, superseded_by, data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      CORRECTION,
      PROJECT,
      TASK,
      "project",
      "major",
      1,
      1,
      null,
      null,
      JSON.stringify({
        schemaVersion: "1.0.0",
        correctionId: CORRECTION,
        projectId: PROJECT,
        taskId: TASK,
        scope: "project",
        summary: "Do not claim causality",
        normalizedInstruction: "Do not claim causality",
        originalEventRef: "legacy-event",
        failureClass: "inference",
        severity: "major",
        actor: { actor: "user", channel: "desktop", directUser: true },
        confirmed: true,
        recurrenceCount: 1,
        recurrenceFingerprint: "legacy-causal-boundary",
        confirmedAt: "2026-08-01T00:00:00.000Z",
        createdAt: "2026-08-01T00:00:00.000Z",
      }),
    );
    db.run(
      `INSERT INTO evidence_items
         (evidence_id, project_id, task_id, type, status, excerpt, content_hash,
          recorded_by, observed_at, expires_at, version, data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      EVIDENCE,
      PROJECT,
      TASK,
      "reference",
      "verified",
      "private legacy excerpt",
      "a".repeat(64),
      "user",
      Date.parse("2026-08-01T00:00:00.000Z"),
      null,
      1,
      JSON.stringify({ evidenceId: EVIDENCE, status: "verified" }),
    );
    db.run("CREATE TABLE legacy_unknown (id TEXT PRIMARY KEY, payload TEXT) STRICT");
    db.run("INSERT INTO legacy_unknown (id, payload) VALUES ('u1', 'unknown private text')");
  } finally {
    db.close();
  }
}

describe("read-only legacy research importer", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    const { rm } = await import("node:fs/promises");
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  async function setup(): Promise<{ source: string; target: string }> {
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const dir = await mkdtemp(join(tmpdir(), "sestina-legacy-import-"));
    dirs.push(dir);
    const source = join(dir, "legacy.sqlite");
    const target = join(dir, "target.sqlite");
    await seedLegacy(source);
    const targetDb = await openDatabase({ path: target });
    targetDb.close();
    return { source, target };
  }

  it("scans a synthetic database and produces byte-stable dry-run plans", async () => {
    const { source } = await setup();
    const first = await scanLegacyDatabase(source);
    const second = await scanLegacyDatabase(source);
    expect(first).toEqual(second);
    expect(first.counts).toMatchObject({ projects: 1, contracts: 1, corrections: 1, evidence: 1, completion: 1 });
    expect(first.unrecognized.some((item) => item.legacyType === "legacy_unknown")).toBe(true);
    expect(createLegacyImportPlan(first)).toEqual(createLegacyImportPlan(second));
  });

  it("imports selected safe objects and remains idempotent", async () => {
    const { source, target } = await setup();
    const plan = createLegacyImportPlan(await scanLegacyDatabase(source));
    const selected = plan.items
      .filter((item) => ["project", "contract", "correction"].includes(item.kind))
      .map((item) => item.planItemId);
    const db = await openDatabase({ path: target });
    const legacyBefore = readFileSync(source);
    try {
      const first = await executeLegacyImport({
        sourcePath: source,
        targetDatabase: db,
        plan,
        selection: { planItemIds: selected, selectedBy: { kind: "user", actorId: "user-1" } },
      });
      expect(first.ok, JSON.stringify(first)).toBe(true);
      if (!first.ok) return;
      expect(first.report).toMatchObject({ created: 4, skipped: 0, conflicts: 0 });
      const second = await executeLegacyImport({
        sourcePath: source,
        targetDatabase: db,
        plan,
        selection: { planItemIds: selected, selectedBy: { kind: "user", actorId: "user-1" } },
      });
      expect(second).toMatchObject({ ok: true, report: { created: 0, skipped: 4, conflicts: 0 } });

      const brief = db.get<{ data: string }>("SELECT data FROM research_briefs");
      const decision = db.get<{ status: string; data: string }>("SELECT status, data FROM research_decisions");
      expect(JSON.parse(brief?.data ?? "{}")).toMatchObject({ importState: { status: "draft" } });
      expect(decision?.status).toBe("proposed");
      expect(JSON.parse(decision?.data ?? "{}")).toMatchObject({ source: { authority: "imported_unconfirmed" } });
      expect(db.get("SELECT name FROM sqlite_schema WHERE name = 'research_evidence'")).toBeUndefined();
      expect(plan.deferred).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "evidence", authority: "imported_unconfirmed" }),
        expect.objectContaining({ kind: "completion", authority: "imported_unconfirmed" }),
      ]));
      expect(readFileSync(source)).toEqual(legacyBefore);

      const imported = parseResearchBrief(JSON.parse(brief?.data ?? "{}"));
      expect(imported.ok).toBe(true);
      if (!imported.ok) return;
      expect(getActiveResearchBriefVersion(imported.value)).toBeUndefined();
      expect(activateImportedResearchBriefDraft(
        imported.value,
        { kind: "model", model: "legacy" },
        imported.value.version,
        { now: () => new Date("2026-08-02T00:00:00.000Z") },
      )).toMatchObject({ ok: false, error: { code: "user_confirmation_required" } });
      const activated = activateImportedResearchBriefDraft(
        imported.value,
        { kind: "user", actorId: "user-1" },
        imported.value.version,
        { now: () => new Date("2026-08-02T00:00:00.000Z") },
      );
      expect(activated).toMatchObject({ ok: true, value: { activationSource: { authority: "user_confirmed" } } });
      if (activated.ok) expect(getActiveResearchBriefVersion(activated.value)?.id).toBe(imported.value.currentVersionId);
    } finally {
      db.close();
    }
  });

  it("imports a project alone without unselected candidates", async () => {
    const { source, target } = await setup();
    const plan = createLegacyImportPlan(await scanLegacyDatabase(source));
    const project = plan.items.find((item) => item.kind === "project");
    const db = await openDatabase({ path: target });
    try {
      const result = await executeLegacyImport({
        sourcePath: source,
        targetDatabase: db,
        plan,
        selection: { planItemIds: project ? [project.planItemId] : [], selectedBy: { kind: "user", actorId: "user-1" } },
      });
      expect(result).toMatchObject({ ok: true, report: { created: 1 } });
      expect(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM research_briefs")?.count).toBe(0);
    } finally {
      db.close();
    }
  });

  it("rejects a stale plan after source mutation and never changes legacy bytes", async () => {
    const { source, target } = await setup();
    const original = readFileSync(source);
    const plan = createLegacyImportPlan(await scanLegacyDatabase(source));
    const changed = await openDatabase({ path: source });
    changed.run("UPDATE projects SET display_name = 'changed' WHERE project_id = ?", PROJECT);
    changed.close();
    const mutated = readFileSync(source);
    const db = await openDatabase({ path: target });
    try {
      const result = await executeLegacyImport({
        sourcePath: source,
        targetDatabase: db,
        plan,
        selection: { planItemIds: [], selectedBy: { kind: "user", actorId: "user-1" } },
      });
      expect(result).toMatchObject({ ok: false, error: { code: "legacy_source_changed" } });
      expect(readFileSync(source)).toEqual(mutated);
      expect(mutated.equals(original)).toBe(false);
    } finally {
      db.close();
    }
  });

  it("rolls back the batch when a selected write fails", async () => {
    const { source, target } = await setup();
    const plan = createLegacyImportPlan(await scanLegacyDatabase(source));
    const db = await openDatabase({ path: target });
    db.exec("CREATE TRIGGER fail_import BEFORE INSERT ON research_briefs BEGIN SELECT RAISE(ABORT, 'controlled'); END");
    try {
      const result = await executeLegacyImport({
        sourcePath: source,
        targetDatabase: db,
        plan,
        selection: {
          planItemIds: plan.items.filter((item) => ["project", "contract", "correction"].includes(item.kind)).map((item) => item.planItemId),
          selectedBy: { kind: "user", actorId: "user-1" },
        },
      });
      expect(result).toMatchObject({ ok: false, error: { code: "legacy_import_failed" } });
      expect(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM research_projects")?.count).toBe(0);
    } finally {
      db.close();
    }
  });

  it("fails closed when a deterministic target identity has different content", async () => {
    const { source, target } = await setup();
    const plan = createLegacyImportPlan(await scanLegacyDatabase(source));
    const project = plan.items.find((item) => item.kind === "project");
    const db = await openDatabase({ path: target });
    try {
      const selection = { planItemIds: project ? [project.planItemId] : [], selectedBy: { kind: "user" as const, actorId: "user-1" } };
      expect(await executeLegacyImport({ sourcePath: source, targetDatabase: db, plan, selection })).toMatchObject({ ok: true });
      const row = db.get<{ project_id: string; data: string }>("SELECT project_id, data FROM research_projects");
      const changed = JSON.parse(row?.data ?? "{}");
      changed.title = "conflicting title";
      db.run("UPDATE research_projects SET title = ?, data = ? WHERE project_id = ?", changed.title, JSON.stringify(changed), row?.project_id);
      expect(await executeLegacyImport({ sourcePath: source, targetDatabase: db, plan, selection })).toMatchObject({
        ok: false,
        error: { code: "legacy_import_conflict" },
      });
    } finally {
      db.close();
    }
  });

  it("returns a safe empty result when no legacy database exists", async () => {
    const missing = join(process.cwd(), "definitely-missing-legacy.sqlite");
    expect(existsSync(missing)).toBe(false);
    const scan = await scanLegacyDatabase(missing);
    expect(scan).toMatchObject({ status: "no_content", items: [], unrecognized: [] });
    expect(JSON.stringify(scan)).not.toContain(process.cwd());
  });
});
