import { kernelBytesHash } from "@sestina/research";
import { expect, it, vi } from "vitest";
import {
  applicationFixture,
  session,
  ready,
  commit,
} from "../application-fixtures.js";
import {
  previewKernelPreMigrationRestore,
  restoreKernelPreMigrationBackup,
} from "@sestina/core";
import { openDatabase, withTransaction } from "@sestina/storage";
import {
  createKernelRepositories,
  readKernelWorkspaceSnapshot,
} from "@sestina/research-store";

it("G8: another connection's workflow commit cannot split a captured read snapshot", async () => {
  const f = await applicationFixture();
  const other = await openDatabase({ path: f.databasePath, migrate: false });
  try {
    const review = f.kernel.createReview("Original saved draft", session),
      db = f.kernel.database;
    const original = db.all.bind(db);
    let injected = false;
    const spy = vi.spyOn(db, "all").mockImplementation((sql, ...args) => {
      if (!injected && sql.startsWith("SELECT * FROM research_reviews")) {
        injected = true;
        withTransaction(other, () =>
          other.withKernelWrite("workflow", () =>
            createKernelRepositories(other).reviews.compareAndSwap(
              {
                ...review,
                suggestion: "New concurrent draft",
                suggestionHash: kernelBytesHash("New concurrent draft"),
                version: review.version + 1,
              },
              review.version,
            ),
          ),
        );
      }
      return original(sql, ...args);
    });
    const captured = readKernelWorkspaceSnapshot(db, f.projectId);
    spy.mockRestore();
    expect(injected).toBe(true);
    expect(
      captured.workflows.reviews.find((r) => r.id === review.id)?.suggestion,
    ).toBe("Original saved draft");
    const next = readKernelWorkspaceSnapshot(db, f.projectId);
    expect(next.head.revision).toBe(captured.head.revision);
    expect(next.inputHash).not.toBe(captured.inputHash);
    expect(
      next.workflows.reviews.find((r) => r.id === review.id)?.suggestion,
    ).toBe("New concurrent draft");
  } finally {
    vi.restoreAllMocks();
    other.close();
    await f.cleanup();
  }
});
it("G9: restore preview is bound to current contents and refuses a stale confirmation", async () => {
  const f = await applicationFixture();
  try {
    f.kernel.close();
    const preview = await previewKernelPreMigrationRestore(f.root);
    await f.restart();
    commit(f, await ready(f, "Changed after restore preview"), {
      kind: "record_only",
      outcome: "reference_only",
      reason: "A real saved result",
    });
    f.kernel.close();
    await expect(
      restoreKernelPreMigrationBackup(f.root, undefined, preview.previewHash),
    ).rejects.toThrow("source_changed");
    const fresh = await previewKernelPreMigrationRestore(f.root);
    expect(fresh.previewHash).not.toBe(preview.previewHash);
    expect(
      (
        await restoreKernelPreMigrationBackup(
          f.root,
          undefined,
          fresh.previewHash,
        )
      ).stage,
    ).toBe("rolled_back");
  } finally {
    await f.cleanup();
  }
});
