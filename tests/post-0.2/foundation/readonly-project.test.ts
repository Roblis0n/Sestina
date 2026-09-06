import { beforeAll, afterAll, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { chmod, readFile } from "node:fs/promises";
import { join } from "node:path";
import { previewKernelMigration, migrateKernelProject } from "@sestina/core";
import { oldCorpus } from "../legacy-fixtures.js";
let corpus: Awaited<ReturnType<typeof oldCorpus>>;
beforeAll(async () => {
  corpus = await oldCorpus();
});
afterAll(async () => {
  await corpus?.cleanup();
});
it("G2: an OS-enforced read-only project remains readable and cannot be migrated in place", async () => {
  const p = await corpus.project(20),
    directory = join(p.root, ".sestina"),
    path = join(directory, "state.sqlite");
  const owner =
    process.platform === "win32"
      ? execFileSync("whoami", [], {
          encoding: "utf8",
          windowsHide: true,
        }).trim()
      : "";
  const acl = (args: string[]) =>
    execFileSync("icacls", args, { windowsHide: true, stdio: "pipe" });
  let protectedDirectory = false;
  try {
    const before = await readFile(path);
    if (process.platform === "win32")
      acl([directory, "/deny", `${owner}:(OI)(CI)(WD,AD,WEA,WA,DC)`]);
    else {
      await chmod(path, 0o444);
      await chmod(directory, 0o555);
    }
    protectedDirectory = true;
    expect((await previewKernelMigration(p.root)).sourceSchema).toBe(20);
    await expect(
      migrateKernelProject({ projectRoot: p.root }),
    ).rejects.toBeDefined();
    expect(await readFile(path)).toEqual(before);
  } finally {
    if (protectedDirectory) {
      if (process.platform === "win32") acl([directory, "/remove:d", owner]);
      else {
        await chmod(directory, 0o755);
        await chmod(path, 0o644);
      }
    }
    await p.cleanup();
  }
});
