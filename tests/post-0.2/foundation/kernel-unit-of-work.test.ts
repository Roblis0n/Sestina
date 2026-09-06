import { beforeAll, afterAll, expect, it } from "vitest";
import { migrateKernelProject, openKernelProject } from "@sestina/core";
import {
  createResearchUnitOfWork,
  createResearchStore,
  readKernelSnapshot,
  projectKernelContext,
} from "@sestina/research-store";
import type { KernelWritePoint } from "@sestina/research";
import { oldCorpus } from "../legacy-fixtures.js";
import { capability, decision, prepare } from "../kernel-fixtures.js";
import { value } from "../factory.js";

let corpus: Awaited<ReturnType<typeof oldCorpus>>;
beforeAll(async () => {
  corpus = await oldCorpus();
});
afterAll(async () => {
  await corpus?.cleanup();
});
async function fixture(fault?: KernelWritePoint) {
  const p = await corpus.project(20);
  await migrateKernelProject({ projectRoot: p.root });
  const db = await openKernelProject(p.root);
  const uow = createResearchUnitOfWork(db, {
    authorize: (c) => c.authorityCapability === capability,
    faultInjection: (point) => {
      if (point === fault) throw new Error("synthetic injected failure");
    },
  }).kernel!;
  return {
    ...p,
    db,
    uow,
    projectId: p.entry.projectId,
    async cleanup() {
      db.close();
      await p.cleanup();
    },
  };
}
it("G3: object, terminal Review, head, event, Receipt, command identity and outbox commit together", async () => {
  const f = await fixture();
  try {
    const proposed = decision(f.db, f.projectId);
    const p = prepare(f.uow, f.projectId, "create_decision", [
      { kind: "decision", id: proposed.id, version: 0 },
    ]);
    const receipt = value(
      f.uow.commitCanonical(p.command, (repos) => {
        value(repos.decisions.create(proposed));
      }),
    );
    expect(receipt.resultingObjects).toEqual([
      { kind: "decision", id: proposed.id, version: 1 },
    ]);
    expect(receipt.assessmentAvailability).toBe("not_requested");
    expect(readKernelSnapshot(f.db, f.projectId).head.revision).toBe(2);
    expect(
      f.uow.repositories.reviews.getById(f.projectId, p.review.id),
    ).toMatchObject({
      status: "committed",
      terminalOutcome: { receiptId: receipt.id },
    });
    expect(
      value(f.uow.lookupCommand(f.projectId, p.command.authorityCommandId)),
    ).toEqual(receipt);
    expect(f.db.all("SELECT * FROM research_projection_outbox")).toHaveLength(
      2,
    );
    f.db.close();
    const reopened = await openKernelProject(f.root);
    try {
      expect(readKernelSnapshot(reopened, f.projectId).head.revision).toBe(2);
    } finally {
      reopened.close();
    }
  } finally {
    await f.cleanup();
  }
});
it("G3: record-only advances once without inventing a research object", async () => {
  const f = await fixture();
  try {
    const before = readKernelSnapshot(f.db, f.projectId);
    const p = prepare(f.uow, f.projectId);
    const receipt = value(f.uow.commitCanonical(p.command, () => {}));
    const after = readKernelSnapshot(f.db, f.projectId);
    expect(after.state.objects).toEqual(before.state.objects);
    expect(after.head.revision).toBe(2);
    expect(after.head.canonicalHash).not.toBe(before.head.canonicalHash);
    expect(receipt.resultingObjects).toEqual([]);
    expect(
      f.uow.repositories.reviews.getById(f.projectId, p.review.id)?.status,
    ).toBe("disposed");
  } finally {
    await f.cleanup();
  }
});
it.each([
  "object",
  "review_terminal",
  "revision_event",
  "revision_head",
  "receipt",
  "command_identity",
  "projection_outbox",
  "before_commit",
] as KernelWritePoint[])(
  "G3: failure at %s rolls back every canonical write",
  async (point) => {
    const f = await fixture(point);
    try {
      const proposed = decision(f.db, f.projectId);
      const p = prepare(f.uow, f.projectId, "create_decision", [
        { kind: "decision", id: proposed.id, version: 0 },
      ]);
      const before = readKernelSnapshot(f.db, f.projectId);
      expect(
        f.uow.commitCanonical(p.command, (repos) => {
          value(repos.decisions.create(proposed));
        }).ok,
      ).toBe(false);
      expect(readKernelSnapshot(f.db, f.projectId)).toEqual(before);
      expect(
        f.uow.repositories.reviews.getById(f.projectId, p.review.id),
      ).toEqual(p.review);
      expect(
        f.db.all("SELECT * FROM research_transition_receipts"),
      ).toHaveLength(0);
      expect(
        f.db.all("SELECT * FROM research_authority_commands"),
      ).toHaveLength(0);
      expect(f.db.all("SELECT * FROM research_projection_outbox")).toHaveLength(
        1,
      );
    } finally {
      await f.cleanup();
    }
  },
);
it("G3: retries return the first result and conflicting reuse fails before any callback", async () => {
  const f = await fixture();
  try {
    const proposed = decision(f.db, f.projectId);
    const p = prepare(f.uow, f.projectId, "create_decision", [
      { kind: "decision", id: proposed.id, version: 0 },
    ]);
    let calls = 0;
    const work = (repos: ReturnType<typeof createResearchStore>) => {
      calls++;
      value(repos.decisions.create(proposed));
    };
    const first = f.uow.commitCanonical(p.command, work);
    const second = f.uow.commitCanonical(p.command, work);
    expect(second).toEqual(first);
    expect(first.ok).toBe(true);
    expect(calls).toBe(1);
    expect(readKernelSnapshot(f.db, f.projectId).head.revision).toBe(2);
    expect(
      f.uow.commitCanonical(
        {
          ...p.command,
          publicReason: "Different command with reused identity.",
        },
        work,
      ),
    ).toMatchObject({ ok: false, error: { code: "idempotency_conflict" } });
    expect(calls).toBe(1);
  } finally {
    await f.cleanup();
  }
});
it("G3: an uncertain response is resolved by command identity and actual durable result", async () => {
  const f = await fixture("after_commit");
  try {
    const p = prepare(f.uow, f.projectId);
    expect(f.uow.commitCanonical(p.command, () => {})).toMatchObject({
      ok: false,
      error: { code: "commit_uncertain" },
    });
    expect(
      value(f.uow.lookupCommand(f.projectId, p.command.authorityCommandId)),
    ).toMatchObject({ afterProjectStateRevision: 2, id: p.command.receiptId });
  } finally {
    await f.cleanup();
  }
});
it("G3: two real connections prepared at the same revision cannot both commit", async () => {
  const f = await fixture();
  const other = await openKernelProject(f.root);
  try {
    const uowB = createResearchUnitOfWork(other, {
      authorize: (c) => c.authorityCapability === capability,
    }).kernel!;
    const a = prepare(f.uow, f.projectId);
    const b = prepare(uowB, f.projectId);
    expect(f.uow.commitCanonical(a.command, () => {}).ok).toBe(true);
    expect(uowB.commitCanonical(b.command, () => {})).toMatchObject({
      ok: false,
      error: { code: "stale_revision" },
    });
    expect(uowB.repositories.reviews.getById(f.projectId, b.review.id)).toEqual(
      b.review,
    );
    expect(readKernelSnapshot(other, f.projectId).head.revision).toBe(2);
  } finally {
    other.close();
    await f.cleanup();
  }
});
it("G3: a reader sees one snapshot even when another connection commits between its reads", async () => {
  const f = await fixture();
  const other = await openKernelProject(f.root);
  try {
    const b = createResearchUnitOfWork(other, {
      authorize: (c) => c.authorityCapability === capability,
    }).kernel!;
    const proposed = decision(other, f.projectId);
    const p = prepare(b, f.projectId, "create_decision", [
      { kind: "decision", id: proposed.id, version: 0 },
    ]);
    const before = readKernelSnapshot(f.db, f.projectId);
    const snapshot = readKernelSnapshot(f.db, f.projectId, () => {
      value(
        b.commitCanonical(p.command, (repos) => {
          value(repos.decisions.create(proposed));
        }),
      );
    });
    expect(snapshot).toEqual(before);
    expect(readKernelSnapshot(f.db, f.projectId).head.revision).toBe(2);
  } finally {
    other.close();
    await f.cleanup();
  }
});
it("G3: default authority denies, legacy repositories cannot bypass, and projections exclude unselected Memory", async () => {
  const f = await fixture();
  try {
    const proposed = decision(f.db, f.projectId);
    const p = prepare(f.uow, f.projectId, "create_decision", [
      { kind: "decision", id: proposed.id, version: 0 },
    ]);
    const denied = createResearchUnitOfWork(f.db).kernel!;
    expect(denied.commitCanonical(p.command, () => {})).toMatchObject({
      ok: false,
      error: { code: "authority_required" },
    });
    expect(createResearchStore(f.db).decisions.create(proposed).ok).toBe(false);
    expect(() =>
      f.db.run("UPDATE research_project_state_heads SET revision=100"),
    ).toThrow();
    const snapshot = readKernelSnapshot(f.db, f.projectId);
    const projection = projectKernelContext(snapshot, "Synthetic suggestion.");
    expect(projectKernelContext(snapshot, "Synthetic suggestion.")).toEqual(
      projection,
    );
    expect(JSON.stringify(projection.projection)).not.toContain(
      "Synthetic active context",
    );
    expect(JSON.stringify(projection.projection)).not.toContain("requestBody");
    expect(JSON.stringify(projection.projection)).not.toContain("rootPath");
  } finally {
    await f.cleanup();
  }
});
it("G3: diagnostic SQL cannot turn off foreign keys or enable schema writes", async () => {
  const f = await fixture();
  try {
    expect(() => f.db.exec("PRAGMA foreign_keys=OFF")).toThrow();
    expect(() => f.db.raw.exec("PRAGMA writable_schema=ON")).toThrow();
    expect(f.db.pragma("foreign_keys")).toBe(1);
  } finally {
    await f.cleanup();
  }
});
it("G3: a callback cannot create an object absent from the confirmed object-version set", async () => {
  const f = await fixture();
  try {
    const object = decision(f.db, f.projectId);
    const p = prepare(f.uow, f.projectId, "create_decision", []);
    expect(
      f.uow.commitCanonical(p.command, (repos) => {
        value(repos.decisions.create(object));
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid_record" } });
    expect(readKernelSnapshot(f.db, f.projectId).head.revision).toBe(1);
  } finally {
    await f.cleanup();
  }
});
