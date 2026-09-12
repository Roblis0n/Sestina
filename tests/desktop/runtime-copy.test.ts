import { it, expect } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  symlink,
  rm,
  readFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  preserveInstalledProgram,
  verifyPreservedProgram,
} from "../../apps/desktop/src/runtime-copy.js";
it("preserves internal framework links while refusing links outside the installed program", async () => {
  const root = await mkdtemp(join(tmpdir(), "sestina-runtime-copy-"));
  try {
    const source = join(root, "application"),
      managed = join(root, "recovery");
    await mkdir(join(source, "versions", "A"), { recursive: true });
    await writeFile(
      join(source, "versions", "A", "runtime"),
      "Synthetic executable",
    );
    await symlink(
      join(source, "versions", "A"),
      join(source, "current"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const id = "a".repeat(40);
    await preserveInstalledProgram(source, managed, id);
    const preserved = await verifyPreservedProgram(managed, id);
    expect(await readFile(join(preserved, "current", "runtime"), "utf8")).toBe(
      "Synthetic executable",
    );
    await writeFile(join(preserved, "versions", "A", "runtime"), "changed");
    await expect(verifyPreservedProgram(managed, id)).rejects.toThrow();
    await symlink(
      root,
      join(source, "outside"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(
      preserveInstalledProgram(source, managed, "b".repeat(40)),
    ).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
