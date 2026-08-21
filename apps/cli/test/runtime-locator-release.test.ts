import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { locateCodexRuntimeFromCliModule } from "../src/connections/runtime-locator.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("co-located release MCP runtime locator", () => {
  it("resolves only the canonical MCP entry inside the installed CLI package", async () => {
    const root = await mkdtemp(join(tmpdir(), "sestina-installed-cli-")); roots.push(root);
    await mkdir(join(root, "dist", "mcp"), { recursive: true });
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "@sestina/cli", version: "0.1.0" }), "utf8");
    await writeFile(join(root, "dist", "main.js"), "export {};\n", "utf8");
    await writeFile(join(root, "dist", "mcp", "main.js"), "export {};\n", "utf8");
    const located = await locateCodexRuntimeFromCliModule(pathToFileURL(join(root, "dist", "main.js")).href, process.execPath);
    expect(located.ok).toBe(true);
    if (located.ok) {
      expect(located.value.packageRoot).toBe(root);
      expect(located.value.serverEntry).toBe(join(root, "dist", "mcp", "main.js"));
      expect(located.value.nodeExecutable).toBe(process.execPath);
    }
  });

  it("fails closed when the package manifest or co-located entry is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "sestina-broken-cli-")); roots.push(root);
    await mkdir(join(root, "dist"), { recursive: true });
    await writeFile(join(root, "dist", "main.js"), "export {};\n", "utf8");
    expect((await locateCodexRuntimeFromCliModule(pathToFileURL(join(root, "dist", "main.js")).href, process.execPath)).ok).toBe(false);
  });
});
