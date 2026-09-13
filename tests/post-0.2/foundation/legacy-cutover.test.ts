import { it, expect } from "vitest";
import { join } from "node:path";
// Verify the normal public entry, without the frozen-fixture test condition.
import { openSestina } from "../../../packages/core/src/index.js";
import { productionUiProject } from "../ui-factory.js";

it("the public legacy SDK defaults to history reading and rejects direct generic and Room/Pilot writes", async () => {
  const f = await productionUiProject();
  const opened = await openSestina({ databasePath: join(f.root, ".sestina/state.sqlite") });
  if (!opened.ok) throw Error(opened.error.code);
  try {
    expect(opened.value.listProjects().ok).toBe(true);
    expect(opened.value.getActiveBriefProjection(f.projectId).ok).toBe(true);
    expect(opened.value.initializeProject({ title: "Forbidden second writer", actor: { kind: "user", actorId: "synthetic-owner" } })).toMatchObject({ ok: false, error: { code: "storage_readonly" } });
    for (const method of ["commitResearchRoomDisposition", "createDeliberationRoom", "createClosedExternalAppPilot", "runDeterministicReview", "acceptBriefChange", "recordDecision"]) {
      const command = Reflect.get(opened.value, method) as (input: unknown) => unknown;
      expect(await command({ projectId: f.projectId }), method).toMatchObject({ ok: false, error: { code: "storage_readonly" } });
    }
  } finally { opened.value.close(); await f.cleanup(); }
});
