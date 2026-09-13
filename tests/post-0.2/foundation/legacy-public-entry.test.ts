import { it, expect, vi } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// This file deliberately resolves the normal production exports, not the
// separate condition used to construct synthetic historical fixtures.
vi.mock(
  "@sestina/core",
  async () => import("../../../packages/core/src/index.js"),
);
import { createResearchRoomServer } from "../../../apps/research-room/src/server.js";
import { runCli } from "../../../apps/cli/src/main.js";
import { createKernelProject } from "../../../packages/core/src/index.js";

it("legacy HTTP writing is rejected before a project is open, including direct generic and Room/Pilot paths", async () => {
  const instance = createResearchRoomServer();
  const running = await instance.start();
  try {
    const status = await (await fetch(`${running.origin}/api/status`)).json();
    for (const path of [
      "/api/project/open",
      "/api/reviews/prepare",
      "/api/reviews/commit",
      "/api/project/external-app-pilots",
      "/api/deliberation-rooms",
      "/api/correction-appeals",
    ]) {
      const response = await fetch(`${running.origin}${path}`, {
        method: "POST",
        headers: {
          origin: running.origin,
          "x-sestina-session": status.value.sessionToken,
          "content-type": "application/json",
        },
        body: "{}",
      });
      expect(response.status, path).toBe(410);
      expect((await response.json()).error.code).toBe("legacy_write_disabled");
    }
  } finally {
    await running.close();
  }
});
it("the default CLI rejects old initialization before creating any project files", async () => {
  const root = await mkdtemp(join(tmpdir(), "sestina-cutover-cli-")),
    output: string[] = [];
  try {
    expect(
      await runCli(
        ["init", "--project", root, "--title", "Synthetic", "--yes", "--json"],
        {
          cwd: root,
          isTTY: false,
          stdout: (value) => output.push(value),
          stderr: (value) => output.push(value),
        },
      ),
    ).not.toBe(0);
    expect(output.join("")).toContain("legacy_write_disabled");
    expect(await readdir(root)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("the default CLI reads and diagnoses a schema25 project without reopening the old core", async () => {
  const root = await mkdtemp(join(tmpdir(), "sestina-cutover-reader-"));
  try {
    await createKernelProject({
      projectPath: root,
      title: "Synthetic reader",
      confirmed: true,
    });
    for (const command of ["context", "doctor"]) {
      const output: string[] = [];
      expect(
        await runCli([command, "--project", root, "--json"], {
          cwd: root,
          isTTY: false,
          stdout: (value) => output.push(value),
          stderr: (value) => output.push(value),
        }),
      ).toBe(0);
      const result = JSON.parse(output.join(""));
      expect(result.schema).toBe(25);
      expect(result.readOnly).toBe(true);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
