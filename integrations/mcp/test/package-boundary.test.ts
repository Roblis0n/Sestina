import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "..", "..");

async function sourceFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(path);
  }
  return files;
}

describe("@sestina/mcp package and architecture boundary", () => {
  it("declares the production package, public entry, scripts, and single binary", async () => {
    const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      name: "@sestina/mcp",
      version: "0.1.0",
      private: true,
      type: "module",
      engines: { node: ">=24 <25" },
      bin: { "sestina-mcp": "./dist/main.js" },
      exports: { ".": "./src/index.ts" },
    });
    const scripts = manifest.scripts;
    if (typeof scripts !== "object" || scripts === null || Array.isArray(scripts)) throw new Error("package_scripts_required");
    expect(typeof (scripts as Record<string, unknown>).test).toBe("string");
    expect(typeof (scripts as Record<string, unknown>).typecheck).toBe("string");
    expect(typeof (scripts as Record<string, unknown>).build).toBe("string");
    expect(manifest).not.toHaveProperty("dependencies");
  });

  it("imports no Sestina package except the public @sestina/core boundary", async () => {
    const imports = new Set<string>();
    for (const file of await sourceFiles(join(packageRoot, "src"))) {
      const source = await readFile(file, "utf8");
      for (const match of source.matchAll(/(?:from|import\s*)\s*["'](@sestina\/[^"']+)["']/gu)) {
        if (match[1] !== undefined) imports.add(match[1]);
      }
      expect(source).not.toMatch(/\.\.\/\.\.\/\.\.\//u);
    }
    expect([...imports]).toEqual(["@sestina/core"]);
  });

  it("does not depend on or replace the retained RI-36 spike", async () => {
    const manifest = await readFile(join(packageRoot, "package.json"), "utf8");
    expect(manifest).not.toContain("mcp-v2-spike");
    await expect(readFile(join(repositoryRoot, "spikes", "mcp-v2", "package.json"), "utf8"))
      .resolves.toContain("@sestina/mcp-v2-spike");
  });

  it("contains no machine path or user-state artifact in production sources", async () => {
    for (const file of await sourceFiles(join(packageRoot, "src"))) {
      const source = await readFile(file, "utf8");
      expect(source).not.toMatch(/[A-Za-z]:\\Users\\/u);
      expect(source).not.toMatch(/state\.sqlite-(?:wal|shm)/u);
      expect(source).not.toMatch(/Semantic Reviewer|Minimal Correction|Finding/u);
    }
  });
});
