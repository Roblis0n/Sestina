import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
  updateActiveBrief,
} from "./fixture.js";

const cleanup: string[] = [];

afterEach(async () => {
  for (const root of cleanup.splice(0)) await removeProjectFixture(root);
});

describe("@sestina/mcp project reader", () => {
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
        schemaVersion: "1.0",
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
