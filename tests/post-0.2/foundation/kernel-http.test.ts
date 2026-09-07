import { it, expect } from "vitest";
import { createResearchRoomServer } from "../../../apps/research-room/src/server.js";
import {
  applicationFixture,
  ApplicationProvider,
} from "../application-fixtures.js";

it.each([false, true])(
  "G4/G5: actual HTTP session uses durable Review and typed commit (Provider=%s)",
  async (withProvider) => {
    const provider = new ApplicationProvider(),
      f = await applicationFixture();
    f.kernel.close();
    const server = createResearchRoomServer({
      kernelProvider: async () => (withProvider ? provider : undefined),
    });
    const running = await server.start();
    const call = async (path: string, body: unknown, authorized = true) => {
      const response = await fetch(`${running.origin}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(authorized
            ? { "x-sestina-session": server.application.sessionToken }
            : {}),
        },
        body: JSON.stringify(body),
      });
      return {
        status: response.status,
        data: (await response.json()) as {
          ok: boolean;
          value: any;
          error?: { code: string };
        },
      };
    };
    const command = async (body: Record<string, unknown>) =>
      await call("/api/kernel/reviews", { projectId: f.projectId, ...body });
    try {
      expect(
        (await call("/api/kernel/open", { projectPath: f.root }, false)).status,
      ).toBe(403);
      expect(
        (await call("/api/kernel/open", { projectPath: f.root })).data.ok,
      ).toBe(true);
      let r = (
        await command({
          action: "create",
          suggestion: "Save a real research decision",
        })
      ).data.value;
      expect(r.status).toBe("draft");
      if (withProvider) {
        const p = (
          await command({
            action: "prepare_manifest",
            reviewId: r.id,
            expectedVersion: r.version,
            selection: {},
            useProvider: true,
          })
        ).data.value;
        expect(p.manifest.exactRequestBody).toContain(
          "Save a real research decision",
        );
        expect(
          (
            await command({
              action: "confirm_manifest",
              reviewId: r.id,
              expectedVersion: p.review.version,
              manifestIdentityHash: p.manifest.identityHash,
              confirmed: false,
            })
          ).status,
        ).toBe(403);
        r = (
          await command({
            action: "confirm_manifest",
            reviewId: r.id,
            expectedVersion: p.review.version,
            manifestIdentityHash: p.manifest.identityHash,
            confirmed: true,
          })
        ).data.value;
        r = (
          await command({
            action: "prepare_attempt",
            reviewId: r.id,
            expectedVersion: r.version,
          })
        ).data.value;
        expect(
          (
            await command({
              action: "start_attempt",
              reviewId: r.id,
              expectedVersion: r.version,
              manifestIdentityHash: p.manifest.identityHash,
              confirmed: true,
            })
          ).data.ok,
        ).toBe(true);
        expect(provider.calls).toEqual([p.manifest.exactRequestBody]);
        r = (await command({ action: "read", reviewId: r.id })).data.value
          .review;
      } else
        r = (
          await command({
            action: "skip_assessment",
            reviewId: r.id,
            expectedVersion: r.version,
          })
        ).data.value;
      const generic = await call("/api/reviews/commit", {
        projectId: f.projectId,
        reviewId: r.id,
        disposition: "accepted",
        actor: { kind: "user" },
      });
      expect(generic.data.ok).toBe(false);
      const payload = {
        kind: "create_decision",
        mode: "create",
        statement: "Do not claim causation",
        rationale: "Only observation is available",
        scope: { kind: "project" },
        reopenConditions: [],
        reason: "Explicit user choice",
      };
      r = (
        await command({
          action: "prepare_effect",
          reviewId: r.id,
          expectedVersion: r.version,
          payload,
        })
      ).data.value;
      const input = {
        action: "commit",
        reviewId: r.id,
        expectedVersion: r.version,
        previewHash: r.effectDraft.previewHash,
        authorityCommandId: r.effectDraft.authorityCommandId,
        confirmed: true,
      };
      expect(
        (
          await call(
            "/api/kernel/reviews",
            { projectId: f.projectId, ...input },
            false,
          )
        ).status,
      ).toBe(403);
      const saved = await command(input);
      expect(saved.data.ok).toBe(true);
      expect(saved.data.value.resultingObjects[0].kind).toBe("decision");
      expect((await command(input)).data.value).toEqual(saved.data.value);
      expect(
        (
          await command({
            action: "lookup",
            authorityCommandId: input.authorityCommandId,
          })
        ).data.value,
      ).toEqual(saved.data.value);
      expect(
        (await command({ action: "read", reviewId: r.id })).data.value.review
          .status,
      ).toBe("committed");
      expect(
        (
          await command({
            ...input,
            projectId: "rprj_00000000000000000000000000",
          })
        ).data.ok,
      ).toBe(false);
      expect(JSON.stringify(saved.data.value)).not.toContain(
        "exactRequestBody",
      );
    } finally {
      await running.close();
      await f.cleanup();
    }
  },
);
