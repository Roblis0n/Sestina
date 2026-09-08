import { it, expect } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createResearchRoomServer } from "../../../apps/research-room/src/server.js";
import { KernelApplicationApi } from "../../../apps/research-room/src/kernel-api.js";
import { applicationFixture, session } from "../application-fixtures.js";
it("G9: read-only browsing reads real projections but refuses draft and authority mutations", async () => {
  const f = await applicationFixture();
  f.kernel.close();
  const api = new KernelApplicationApi({});
  try {
    const opened = await api.open({ projectPath: f.root, readOnly: true });
    expect(opened.readOnly).toBe(true);
    expect(
      await api.execute({
        projectId: f.projectId,
        action: "workspace",
        query: { view: "project" },
      }),
    ).toMatchObject({ status: "ready", sourceProjectStateRevision: 1 });
    await expect(
      api.execute({
        projectId: f.projectId,
        action: "create",
        suggestion: "Must not write",
      }),
    ).rejects.toThrow("authority_required");
    api.close();
    await f.restart();
    expect(
      f.kernel.workspace({ view: "history" }, session)
        .sourceProjectStateRevision,
    ).toBe(1);
  } finally {
    api.close();
    await f.cleanup();
  }
});
it("G9: explicit candidate creation opens a real local project and never overwrites unknown state", async () => {
  const root = await mkdtemp(join(tmpdir(), "sestina-g9-start-")),
    app = createResearchRoomServer(),
    server = await app.start();
  const post = async (body: unknown) => {
    const r = await fetch(server.origin + "/api/kernel/create", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-sestina-session": app.application.sessionToken,
      },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  };
  try {
    expect(
      (
        await post({
          projectPath: root,
          title: "Synthetic first research",
          confirmed: true,
        })
      ).body,
    ).toMatchObject({ ok: true, value: { schema: 25 } });
    const unknown = join(root, "unknown");
    await mkdir(join(unknown, ".sestina"), { recursive: true });
    await writeFile(
      join(unknown, ".sestina/user-note"),
      "Keep this unknown state",
    );
    expect(
      (
        await post({
          projectPath: unknown,
          title: "Do not overwrite",
          confirmed: true,
        })
      ).body.ok,
    ).toBe(false);
    expect(await readFile(join(unknown, ".sestina/user-note"), "utf8")).toBe(
      "Keep this unknown state",
    );
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});
