import { it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  applicationFixture,
  ready,
  commit,
  session,
} from "../application-fixtures.js";
import { publishKernelBriefFile } from "../../../packages/core/src/kernel-brief-publisher.js";

it.each(["prepared", "written", "installed"] as const)(
  "G6: derived Brief publication interruption at %s preserves the committed fact and repairs after reopen",
  async (point) => {
    const f = await applicationFixture();
    try {
      const before = f.kernel.brief(session),
        active = before.active!;
      const receipt = commit(f, await ready(f), {
        kind: "patch_brief",
        targetId: before.brief!.id,
        expectedVersion: before.brief!.version,
        baseVersionId: active.id,
        changes: {
          currentTask: "Synthetic task after a publication interruption",
        },
        reason: "Explicit task update",
      });
      expect(() =>
        publishKernelBriefFile(f.kernel.database, f.kernel.projectId, (p) => {
          if (p === point) throw new Error("synthetic interruption");
        }),
      ).toThrow("synthetic interruption");
      await f.restart();
      expect(f.kernel.brief(session).active!.currentTask).toBe(
        "Synthetic task after a publication interruption",
      );
      expect(
        f.kernel.lookupCommand(receipt.authorityCommandId, session),
      ).toEqual(receipt);
      expect(f.kernel.publishBrief(session)).toMatchObject({
        status: "ready",
        sourceProjectStateRevision: receipt.afterProjectStateRevision,
      });
      const document = JSON.parse(
        await readFile(join(f.root, ".sestina", "research-brief.yaml"), "utf8"),
      );
      expect(document.sourceProjectStateRevision).toBe(
        receipt.afterProjectStateRevision,
      );
      await f.restart();
      expect(f.kernel.brief(session).projectStateRevision).toBe(
        receipt.afterProjectStateRevision,
      );
    } finally {
      await f.cleanup();
    }
  },
);
