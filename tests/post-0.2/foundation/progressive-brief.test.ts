import { it, expect } from "vitest";
import {
  applicationFixture,
  ready,
  session,
  commit,
} from "../application-fixtures.js";
import {
  readKernelSnapshot,
  projectKernelContext,
} from "@sestina/research-store";
import {
  openSestina,
  migrateKernelProject,
  openResearchDeliberationKernel,
} from "@sestina/core";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { USER, value } from "../factory.js";
import { resolveUser } from "../application-fixtures.js";
import { briefFieldDiff } from "../../../packages/core/src/kernel-brief.js";

it("G6: a field-state conflict is shown separately from unrelated progressive fields", () => {
  const base = {currentTask:"Inspect the claim",progressive:{sections:{currentTask:{status:"provided"},explicitNonGoals:{status:"not_provided"}},knownUnknowns:[],acceptedDecisions:[],evidenceThresholds:[]}};
  const current = {...base,progressive:{...base.progressive,sections:{...base.progressive.sections,explicitNonGoals:{status:"intentionally_empty",publicReason:"No exclusions for this task"}}}};
  const candidate = {...base,progressive:{...base.progressive,sections:{...base.progressive.sections,explicitNonGoals:{status:"provided"}}}};
  const diff=briefFieldDiff(base as Parameters<typeof briefFieldDiff>[0],current as Parameters<typeof briefFieldDiff>[1],candidate);
  expect(diff).toContainEqual(expect.objectContaining({field:"progressive.sections.explicitNonGoals",conflict:true,base:{status:"not_provided"},current:{status:"intentionally_empty",publicReason:"No exclusions for this task"},candidate:{status:"provided"}}));
  expect(diff.some(row=>row.field==="progressive")).toBe(false);
});

it("G6: first task-only Brief creates no inferred research content and commits once", async () => {
  const root = await mkdtemp(join(tmpdir(), "sestina-g6-empty-"));
  await mkdir(join(root, ".sestina"));
  const core = value(
    await openSestina({ databasePath: join(root, ".sestina/state.sqlite") }),
  );
  value(
    core.initializeProject({
      title: "Synthetic minimal task",
      rootPath: ".",
      actor: USER,
    }),
  );
  core.close();
  let k: Awaited<ReturnType<typeof openResearchDeliberationKernel>> | undefined;
  try {
    await migrateKernelProject({ projectRoot: root });
    k = await openResearchDeliberationKernel(root, { resolveUser });
    const d = k.createReview("Start from the user's task", session);
    const r = await k.skipAssessment(d.id, d.version, session);
    const fields = {
      projectQuestion: "",
      currentTask: "Check observational limitations",
      currentStage: "",
      targetArtifacts: [],
      fixedDecisions: [],
      allowedChanges: [],
      forbiddenChanges: [],
      expectedDeltas: [],
      evidenceBoundaries: [],
      explicitNonGoals: ["Do not rank research quality"],
    };
    const sections = Object.fromEntries(
      [
        ...Object.keys(fields),
        "knownUnknowns",
        "acceptedDecisions",
        "evidenceThresholds",
      ].map((key) => [
        key,
        { status: ["currentTask", "explicitNonGoals"].includes(key) ? "provided" : "not_provided" },
      ]),
    );
    const prepared = k.prepareEffect(
      r.id,
      r.version,
      {
        kind: "patch_brief",
        mode: "initialize",
        fields: {
          ...fields,
          progressive: {
            schemaVersion: "2.0.0",
            sections,
            knownUnknowns: [],
            acceptedDecisions: [],
            evidenceThresholds: [],
          },
        },
        reason: "Start the stated task",
      },
      session,
    );
    expect(k.brief(session).active).toBe(null);
    const draft = prepared.effectDraft!;
    const receipt = k.commitEffect(
      r.id,
      prepared.version,
      draft.previewHash,
      draft.authorityCommandId,
      session,
    );
    expect(
      k.commitEffect(
        r.id,
        prepared.version,
        draft.previewHash,
        draft.authorityCommandId,
        session,
      ),
    ).toEqual(receipt);
    expect(k.brief(session).active).toMatchObject(fields);
    expect(k.brief(session).projectStateRevision).toBe(2);
    k.close();
    k = await openResearchDeliberationKernel(root, { resolveUser });
    expect(k.brief(session).active).toMatchObject(fields);
  } finally {
    k?.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("G6: progressive candidate stays a draft across restart and commits field states with the real Brief", async () => {
  const f = await applicationFixture();
  try {
    const before = readKernelSnapshot(f.kernel.database, f.kernel.projectId);
    const b = before.state.objects.find((o) => o.kind === "brief")!;
    const current = (b.data.versions as Record<string, unknown>[]).at(-1)!;
    const fields = [
      "projectQuestion",
      "currentTask",
      "currentStage",
      "targetArtifacts",
      "fixedDecisions",
      "allowedChanges",
      "forbiddenChanges",
      "expectedDeltas",
      "evidenceBoundaries",
      "explicitNonGoals",
      "knownUnknowns",
      "acceptedDecisions",
      "evidenceThresholds",
    ];
    const sections = Object.fromEntries(
      fields.map((k) => [
        k,
        { status: k === "projectQuestion" ? "provided" : "not_provided" },
      ]),
    );
    sections.explicitNonGoals = {
      status: "intentionally_empty",
      publicReason: "No non-goals for this bounded task",
    } as { status: string };
    const payload = {
      kind: "patch_brief",
      targetId: b.id,
      expectedVersion: b.version,
      baseVersionId: current.id,
      reason: "Remove unsupported defaults",
      changes: {
        currentTask: "",
        currentStage: "",
        targetArtifacts: [],
        fixedDecisions: [],
        allowedChanges: [],
        forbiddenChanges: [],
        expectedDeltas: [],
        evidenceBoundaries: [],
        explicitNonGoals: [],
        progressive: {
          schemaVersion: "2.0.0",
          sections,
          knownUnknowns: [],
          acceptedDecisions: [],
          evidenceThresholds: [],
        },
      },
    };
    const r = await ready(f);
    const draft = f.kernel.prepareEffect(r.id, r.version, payload, session);
    expect(readKernelSnapshot(f.kernel.database, f.kernel.projectId)).toEqual(
      before,
    );
    await f.restart();
    expect(f.kernel.readReview(r.id, session).review.effectDraft).toEqual(
      draft.effectDraft,
    );
    const receipt = f.kernel.commitEffect(
      r.id,
      draft.version,
      draft.effectDraft!.previewHash,
      draft.effectDraft!.authorityCommandId,
      session,
    );
    const after = readKernelSnapshot(f.kernel.database, f.kernel.projectId);
    expect(after.head.revision).toBe(before.head.revision + 1);
    expect(receipt.effectKind).toBe("patch_brief");
    const next = after.state.objects.find((o) => o.id === b.id)!;
    expect((next.data.versions as unknown[])[0]).toEqual(
      (b.data.versions as unknown[])[0],
    );
    const context = projectKernelContext(after, "Consider evidence", {});
    expect(context.limitations).toContain("Brief currentTask: not_provided.");
    expect(context.limitations).not.toContain(
      "Brief explicitNonGoals: not_provided.",
    );
    expect(JSON.stringify(context.projection)).toContain("intentionally_empty");
    const stale = { ...payload, expectedVersion: b.version };
    expect(() => commit(f, draft, stale)).toThrow();
  } finally {
    await f.cleanup();
  }
});
