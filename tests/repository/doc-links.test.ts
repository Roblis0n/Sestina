import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPOSITORY_ROOT = resolve(import.meta.dirname, "..", "..");
const DOC_LINK_SCRIPT = resolve(
  REPOSITORY_ROOT,
  "scripts",
  "check-doc-links.mjs",
);
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("check-doc-links nested documentation", () => {
  it("reports a broken link inside a nested docs directory", () => {
    const root = mkdtempSync(join(tmpdir(), "sestina-doc-links-"));
    temporaryRoots.push(root);
    const nestedDocs = join(root, "docs", "nested");
    mkdirSync(nestedDocs, { recursive: true });
    writeFileSync(
      join(nestedDocs, "index.md"),
      "[missing document](missing.md)\n",
    );

    const result = spawnSync(
      process.execPath,
      [DOC_LINK_SCRIPT, "--root", root],
      { encoding: "utf-8", timeout: 15_000 },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/docs[\\/]nested[\\/]index\.md/);
    expect(result.stderr).toContain("broken link -> missing.md");
  });
});
