import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateKernelProject, openResearchDeliberationKernel, openSestina } from "@sestina/core";
import {
  openProjectReader,
  runWithQueryDeadline,
} from "../src/project-reader.js";
import {
  createCorruptProjectFixture,
  createProjectFixture,
  FIXTURE_PREFIX,
  readBriefRecordVersion,
  removeProjectFixture,
  seedContinuityFixture,
  updateActiveBrief,
} from "./fixture.js";

const cleanup: string[] = [];

afterEach(async () => {
  for (const root of cleanup.splice(0)) await removeProjectFixture(root);
});

describe("@sestina/mcp project reader", () => {
  it("reads the schema-25 Brief while the desktop Kernel holds its writer lease", async () => {
    const fixture = await createProjectFixture();
    cleanup.push(fixture.root);
    const legacy = await openSestina({ databasePath: fixture.databasePath });
    if (!legacy.ok) throw new Error("fixture_open");
    try {
      const brief = legacy.value.getBriefState(fixture.projectId);
      if (!brief.ok || !brief.value) throw new Error("fixture_brief");
      await writeFile(join(fixture.root, ".sestina/research-brief.yaml"), brief.value.yaml);
    } finally { legacy.value.close(); }
    await migrateKernelProject({ projectRoot: fixture.root });
    const session = Object.freeze({ synthetic: true });
    const kernel = await openResearchDeliberationKernel(fixture.root, { resolveUser: value => value === session ? { kind: "user", actorId: "synthetic-reader-owner" } : undefined });
    let reader: Awaited<ReturnType<typeof openProjectReader>> | undefined;
    try {
      reader = await openProjectReader({ projectRoot: fixture.root, outputLimitBytes: 32768, queryTimeoutMs: 5000 });
      expect(reader.ok).toBe(true);
      if (!reader.ok) throw new Error("schema25_reader_unavailable");
      const context = await reader.value.readResearchContext();
      expect(context.ok).toBe(true);
      if (context.ok) {
        expect(context.value.projectQuestion).toBe(kernel.brief(session).active!.projectQuestion);
        expect(context.value.contentBoundary.authority).toBe("none");
      }
      const before = kernel.brief(session);
      const draft = kernel.createReview("Synthetic live writer update", session);
      const skipped = await kernel.skipAssessment(draft.id, draft.version, session);
      const prepared = kernel.prepareEffect(draft.id, skipped.version, { kind: "patch_brief", targetId: before.brief!.id, expectedVersion: before.brief!.version, baseVersionId: before.active!.id, changes: { currentTask: "Read the committed desktop change" }, reason: "Synthetic visibility" }, session);
      kernel.commitEffect(draft.id, prepared.version, prepared.effectDraft!.previewHash, prepared.effectDraft!.authorityCommandId!, session);
      const next = await reader.value.readResearchContext();
      expect(next.ok && next.value.currentTask).toBe("Read the committed desktop change");
      expect(next.ok && next.value.source?.projectStateRevision).toBe(kernel.brief(session).projectStateRevision);
      reader.value.close();
      expect((await reader.value.readResearchContext()).ok).toBe(false);
    } finally { if (reader?.ok) reader.value.close(); kernel.close(); }
  });
  it("requires an explicit project root before reading research context", async () => {
    await expect(openProjectReader({
      projectRoot: "",
      outputLimitBytes: 32_768,
      queryTimeoutMs: 2_000,
    })).resolves.toMatchObject({
      ok: false,
      error: { code: "missing_project_root" },
    });
  });

  it("opens one explicit initialized project through Core and returns the bounded canonical Brief", async () => {
    const fixture = await createProjectFixture();
    cleanup.push(fixture.root);
    const opened = await openProjectReader({
      projectRoot: fixture.root,
      outputLimitBytes: 32_768,
      queryTimeoutMs: 2_000,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.value.health()).toEqual({
      rootValidated: true,
      stateDatabaseInitialized: true,
      projectBinding: "single",
      readOnly: true,
    });
    const before = await readBriefRecordVersion(fixture);
    const context = await opened.value.readResearchContext();
    const after = await readBriefRecordVersion(fixture);
    expect(context.ok).toBe(true);
    if (context.ok) {
      expect(context.value).toMatchObject({
        schemaVersion: "1.1",
        projectQuestion: "How can the current research task recover without replacing its goal?",
        currentTask: "Add only the missing claim-evidence relation.",
        fixedDecisions: [{ statement: "Preserve the accepted research question." }],
        allowedChanges: [{ target: { kind: "project_path", relativePath: "manuscript.md" } }],
        forbiddenChanges: [{ target: { kind: "project_path", relativePath: "data/source.csv" } }],
        expectedDeltas: [{ statement: "Add one explicit claim-evidence relation." }],
        evidenceBoundaries: [{ statement: "Do not infer causality from the observational source." }],
        explicitNonGoals: ["Do not replace the research question."],
      });
      expect(JSON.stringify(context.value)).not.toContain(fixture.root);
      expect(JSON.stringify(context.value)).not.toContain(fixture.databasePath);
    }
    expect(after).toBe(before);
    opened.value.close();
    opened.value.close();
  });

  it("projects the current Episode, active decisions, and resolved issues across fresh read-only sessions", async () => {
    const fixture = await createProjectFixture();
    cleanup.push(fixture.root);
    const continuity = await seedContinuityFixture(fixture);
    const databaseBefore = createHash("sha256").update(await readFile(fixture.databasePath)).digest("hex");
    const firstReader = await openProjectReader({ projectRoot: fixture.root, outputLimitBytes: 32_768, queryTimeoutMs: 2_000 });
    expect(firstReader.ok).toBe(true);
    if (!firstReader.ok) return;
    const first = await firstReader.value.readResearchContext();
    firstReader.value.close();
    const secondReader = await openProjectReader({ projectRoot: fixture.root, outputLimitBytes: 32_768, queryTimeoutMs: 2_000 });
    expect(secondReader.ok).toBe(true);
    if (!secondReader.ok) return;
    const second = await secondReader.value.readResearchContext();
    secondReader.value.close();
    expect(first).toEqual(second);
    expect(second).toMatchObject({
      ok: true,
      value: {
        schemaVersion: "1.1",
        continuity: {
          currentEpisode: {
            id: continuity.episodeId,
            status: "active",
            artifactId: continuity.artifactId,
            baselineRevisionId: continuity.baselineRevisionId,
            candidateRevisionId: null,
          },
          activeDecisions: [{
            id: continuity.decisionId,
            status: "frozen",
            statement: "Keep the observational evidence boundary fixed.",
            reopenCondition: "New experimental evidence becomes available.",
          }],
          relevantIssues: [{
            id: continuity.issueId,
            status: "resolved",
            summary: "A causal interpretation exceeds the evidence boundary.",
            reopenCondition: null,
            resolutionRecorded: true,
          }],
          omissions: { activeDecisions: 0, relevantIssues: 0 },
        },
      },
    });
    const serialized = JSON.stringify(second);
    for (const forbidden of ["finding", "minimalCorrection", "provider", fixture.root, fixture.databasePath]) {
      expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
    const databaseAfter = createHash("sha256").update(await readFile(fixture.databasePath)).digest("hex");
    expect(databaseAfter).toBe(databaseBefore);
  });

  it("re-reads Core state on the same connection after a user creates a new active Brief version", async () => {
    const fixture = await createProjectFixture();
    cleanup.push(fixture.root);
    const opened = await openProjectReader({ projectRoot: fixture.root, outputLimitBytes: 32_768, queryTimeoutMs: 2_000 });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const first = await opened.value.readResearchContext();
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    await updateActiveBrief(fixture);
    const second = await opened.value.readResearchContext();
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.value.version).toBe(first.value.version + 1);
      expect(second.value.recordVersion).toBeGreaterThan(first.value.recordVersion);
      expect(second.value.versionId).not.toBe(first.value.versionId);
      expect(second.value).toMatchObject({
        projectQuestion: "How can the updated research task preserve the accepted causal boundary?",
        currentTask: "Add the newly bounded evidence comparison.",
        fixedDecisions: [{ statement: "Keep the observational design fixed." }],
        allowedChanges: [{ target: { relativePath: "results.md" } }],
        forbiddenChanges: [{ target: { relativePath: "methods.md" } }],
        expectedDeltas: [{ statement: "Add one bounded comparison without a causal claim." }],
        evidenceBoundaries: [{ statement: "The comparison remains associational." }],
      });
    }
    opened.value.close();
  });

  it("fails closed for relative, missing, uninitialized, corrupt, and multiply bound project roots", async () => {
    await expect(openProjectReader({ projectRoot: ".", outputLimitBytes: 32_768, queryTimeoutMs: 2_000 }))
      .resolves.toMatchObject({ ok: false, error: { code: "invalid_project_root" } });
    await expect(openProjectReader({ projectRoot: join(tmpdir(), "ri37-missing-root"), outputLimitBytes: 32_768, queryTimeoutMs: 2_000 }))
      .resolves.toMatchObject({ ok: false, error: { code: "invalid_project_root" } });

    const empty = await mkdtemp(join(tmpdir(), FIXTURE_PREFIX));
    cleanup.push(empty);
    await mkdir(join(empty, ".sestina"));
    await expect(openProjectReader({ projectRoot: empty, outputLimitBytes: 32_768, queryTimeoutMs: 2_000 }))
      .resolves.toMatchObject({ ok: false, error: { code: "project_not_initialized" } });

    const corrupt = await createCorruptProjectFixture();
    cleanup.push(corrupt.root);
    const corruptResult = await openProjectReader({ projectRoot: corrupt.root, outputLimitBytes: 32_768, queryTimeoutMs: 2_000 });
    expect(corruptResult).toMatchObject({ ok: false, error: { code: "project_state_unavailable" } });
    expect(JSON.stringify(corruptResult)).not.toContain(corrupt.root);

    const multiple = await createProjectFixture({ projectCount: 2 });
    cleanup.push(multiple.root);
    await expect(openProjectReader({ projectRoot: multiple.root, outputLimitBytes: 32_768, queryTimeoutMs: 2_000 }))
      .resolves.toMatchObject({ ok: false, error: { code: "project_binding_inconsistent" } });
  });

  it("does not fabricate an inactive Brief and suppresses over-budget content", async () => {
    const inactive = await createProjectFixture({ activeBrief: false });
    cleanup.push(inactive.root);
    const inactiveReader = await openProjectReader({ projectRoot: inactive.root, outputLimitBytes: 32_768, queryTimeoutMs: 2_000 });
    expect(inactiveReader.ok).toBe(true);
    if (inactiveReader.ok) {
      await expect(inactiveReader.value.readResearchContext()).resolves.toMatchObject({ ok: false, error: { code: "no_active_brief" } });
      inactiveReader.value.close();
    }

    const large = await createProjectFixture({ currentTask: "x".repeat(8_000) });
    cleanup.push(large.root);
    const bounded = await openProjectReader({ projectRoot: large.root, outputLimitBytes: 1_024, queryTimeoutMs: 2_000 });
    expect(bounded.ok).toBe(true);
    if (bounded.ok) {
      await expect(bounded.value.readResearchContext()).resolves.toMatchObject({ ok: false, error: { code: "response_too_large" } });
      bounded.value.close();
    }
  });

  it("races asynchronous queries and discards synchronous results returned after the deadline", async () => {
    const asynchronous = await runWithQueryDeadline(
      async () => await new Promise<string>((resolveWork) => setTimeout(() => { resolveWork("late"); }, 30)),
      5,
    );
    expect(asynchronous).toMatchObject({ ok: false, error: { code: "query_timeout" } });

    const synchronous = await runWithQueryDeadline(() => {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15);
      return "late";
    }, 5);
    expect(synchronous).toMatchObject({ ok: false, error: { code: "query_timeout" } });
  });
});
