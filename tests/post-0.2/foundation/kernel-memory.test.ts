import { it, expect } from "vitest";
import {
  applicationFixture,
  ApplicationProvider,
  session,
} from "../application-fixtures.js";
import { RandomIdFactory } from "@sestina/core";
const ids = new RandomIdFactory();
it("G7: private Memory cannot enter an external Provider request even after explicit selection", async () => {
  const provider = new ApplicationProvider();
  Object.assign(provider.identity, {
    locality: "external",
    origin: "https://synthetic.invalid",
  });
  const f = await applicationFixture(provider);
  try {
    const input = {
      action: "create",
      kind: "working_hint",
      content: { text: "Synthetic private planning note" },
      retention: { policy: "until_unpinned" },
      sensitivity: "project_private",
      outboundPolicy: "explicit_manifest_only",
      publicReason: "User-owned planning context",
    };
    const command = ids.create("rpev_");
    const receipt = f.kernel.governMemory(command, 1, input, session);
    expect(f.kernel.governMemory(command, 1, input, session)).toEqual(receipt);
    const item = f.kernel.memory(session).items[0]!.item;
    f.kernel.governMemory(
      ids.create("rpev_"),
      2,
      {
        action: "confirm",
        itemId: item.id,
        expectedVersion: item.version,
        publicReason: "Use this context",
      },
      session,
    );
    const active = f.kernel.memory(session).items[0]!.item;
    if (active.state === "forgotten") throw Error("unexpected tombstone");
    const r = f.kernel.createReview("Synthetic change", session);
    await expect(
      f.kernel.prepareManifest(
        r.id,
        r.version,
        {
          memory: [
            {
              id: active.id,
              version: active.version,
              contentHash: active.contentHash,
            },
          ],
        },
        true,
        session,
      ),
    ).rejects.toBeDefined();
    expect(provider.calls).toEqual([]);
    expect(f.kernel.recallMemory("add_context", [], session)).toHaveLength(1);
    expect(f.kernel.memory(session).projectStateRevision).toBe(3);
  } finally {
    await f.cleanup();
  }
});
it.each([false, true])(
  "G7: Forget erases tracked request and assessment bodies, retaining proof and restart safety (sent=%s)",
  async (sent) => {
    const provider = new ApplicationProvider();
    const f = await applicationFixture(provider);
    try {
      f.kernel.governMemory(
        ids.create("rpev_"),
        1,
        {
          action: "create",
          kind: "working_hint",
          content: { text: "SYNTHETIC_FORGET_SECRET_913" },
          retention: { policy: "until_unpinned" },
          sensitivity: "public",
          outboundPolicy: "explicit_manifest_only",
          publicReason: "Planning context",
        },
        session,
      );
      const first = f.kernel.memory(session).items[0]!.item;
      f.kernel.governMemory(
        ids.create("rpev_"),
        2,
        {
          action: "confirm",
          itemId: first.id,
          expectedVersion: first.version,
          publicReason: "Use planning context",
        },
        session,
      );
      const item = f.kernel.memory(session).items[0]!.item;
      if (item.state === "forgotten") throw Error("unexpected tombstone");
      const draft = f.kernel.createReview(
        "Review a synthetic decision",
        session,
      );
      const prepared = await f.kernel.prepareManifest(
        draft.id,
        draft.version,
        {
          memory: [
            {
              id: item.id,
              version: item.version,
              contentHash: item.contentHash,
            },
          ],
        },
        true,
        session,
      );
      expect(prepared.manifest.exactRequestBody).toContain(
        "SYNTHETIC_FORGET_SECRET_913",
      );
      if (sent) {
        const c = await f.kernel.confirmManifest(
          draft.id,
          prepared.review.version,
          prepared.manifest.identityHash,
          session,
        );
        const a = f.kernel.prepareAttempt(draft.id, c.version, session);
        await f.kernel.startAttempt(
          draft.id,
          a.version,
          prepared.manifest.identityHash,
          session,
        );
      }
      const command = ids.create("rpev_");
      const input = {
        action: "forget",
        itemId: item.id,
        expectedVersion: item.version,
        publicReason: "user_requested_irreversible_forget",
        confirmation: "FORGET",
      };
      const receipt = f.kernel.governMemory(command, 3, input, session);
      expect(f.kernel.governMemory(command, 3, input, session)).toEqual(
        receipt,
      );
      expect(f.kernel.inspectManifest(draft.id, session)).toMatchObject({
        exactRequestBody: null,
        identityHash: prepared.manifest.identityHash,
        bodyRedaction: expect.any(Object),
      });
      expect(
        f.kernel.database
          .all<{ data: string }>("SELECT data FROM context_manifests")
          .map((r) => r.data)
          .join(),
      ).not.toContain("SYNTHETIC_FORGET_SECRET_913");
      expect(f.kernel.memory(session).items[0]!.item.state).toBe("forgotten");
      expect(f.kernel.readReview(draft.id, session).review.status).toBe(
        "stale",
      );
      await f.restart();
      expect(
        f.kernel.inspectManifest(draft.id, session)?.exactRequestBody,
      ).toBeNull();
      expect(f.kernel.recallMemory("add_context", [], session)).toEqual([]);
      expect(provider.calls).toHaveLength(sent ? 1 : 0);
    } finally {
      await f.cleanup();
    }
  },
);
