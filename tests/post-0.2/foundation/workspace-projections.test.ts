import { it, expect } from "vitest";
import {
  applicationFixture,
  ready,
  commit,
  session,
} from "../application-fixtures.js";
import { readKernelWorkspaceSnapshot } from "@sestina/research-store";

it("G8: all views locate the same actual commit and persist on restart", async () => {
  const f = await applicationFixture();
  try {
    const r = await ready(f, "Synthetic view consistency 中文");
    const result = commit(f, r, {
      kind: "record_only",
      outcome: "reference_only",
      reason: "User retains this as a reference",
    });
    const views = [
      "today",
      "project",
      "search",
      "attention",
      "resume",
      "history",
    ].map((view) => f.kernel.workspace({ view }, session));
    expect(new Set(views.map((v) => v.inputHash)).size).toBe(1);
    expect(views.every((v) => v.sourceProjectStateRevision === 2)).toBe(true);
    const detail = f.kernel.workspace(
      { view: "receipt", id: result.id },
      session,
    );
    expect(detail.detail).toMatchObject({
      id: result.id,
      reviewId: r.id,
      afterProjectStateRevision: 2,
      recordOnlyOutcome: "reference_only",
    });
    expect(views[0]!.items.some((v) => v.id === r.id)).toBe(false);
    const resumed = f.kernel.workspace({ view: "resume", id: r.id }, session);
    expect(resumed.detail).toEqual(f.kernel.readReview(r.id, session));
    const before = f.kernel.workspace({ view: "today" }, session);
    expect(
      f.kernel.rebuildWorkspace(session).every((result) => result.ok),
    ).toBe(true);
    expect(f.kernel.workspace({ view: "today" }, session).inputHash).toBe(
      before.inputHash,
    );
    await f.restart();
    expect(f.kernel.workspace({ view: "history" }, session).inputHash).toBe(
      detail.inputHash,
    );
  } finally {
    await f.cleanup();
  }
});
it("G8: pagination binds workflow identity, rejects mixed pages and never leaks outbound bodies", async () => {
  const f = await applicationFixture();
  try {
    for (let i = 0; i < 4; i++)
      f.kernel.createReview(`Synthetic searchable ${i}`, session);
    const first = f.kernel.workspace(
      { view: "search", query: "searchable", limit: 2 },
      session,
    );
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();
    const next = f.kernel.workspace(
      {
        view: "search",
        query: "searchable",
        limit: 2,
        cursor: first.nextCursor,
      },
      session,
    );
    expect(new Set([...first.items, ...next.items].map((v) => v.id)).size).toBe(
      4,
    );
    f.kernel.createReview("Synthetic new draft", session);
    expect(() =>
      f.kernel.workspace(
        {
          view: "search",
          query: "searchable",
          limit: 2,
          cursor: first.nextCursor,
        },
        session,
      ),
    ).toThrow();
    expect(JSON.stringify(first)).not.toMatch(
      /exactRequestBody|rawResponse|authorityCommandId/,
    );
    expect(
      readKernelWorkspaceSnapshot(f.kernel.database, f.projectId).head.revision,
    ).toBe(1);
  } finally {
    await f.cleanup();
  }
});

it("G8: full-text search includes saved Brief scope and boundaries, without indexing arbitrary metadata", async () => {
  const f = await applicationFixture();
  try {
    const brief = f.kernel.brief(session).brief!;
    const r = await ready(f, "Save the scope exclusion");
    commit(f, r, {
      kind: "patch_brief",
      targetId: brief.id,
      expectedVersion: brief.version,
      baseVersionId: brief.currentVersionId,
      changes: { explicitNonGoals: ["Synthetic excluded inquiry albatross"] },
      reason: "Record the user's scope",
    });
    const result = f.kernel.workspace(
      { view: "search", query: "albatross" },
      session,
    );
    expect(result.items).toContainEqual(
      expect.objectContaining({ kind: "brief", matchReason: "content" }),
    );
  } finally {
    await f.cleanup();
  }
});
