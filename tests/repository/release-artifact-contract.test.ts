import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("RI-42 release entrypoints", () => {
  it("exposes build, verifier, fresh-install, and no-publish workflow gates", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")) as { readonly scripts: Readonly<Record<string, string>> };
    expect(packageJson.scripts["release:build"]).toBe("node scripts/build-release.mjs");
    expect(packageJson.scripts["release:verify"]).toBe("node scripts/verify-release-artifact.mjs");
    expect(packageJson.scripts["release:fresh-install"]).toBe("node scripts/run-fresh-install.mjs");
    const workflow = await readFile(new URL("../../.github/workflows/release.yml", import.meta.url), "utf8");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("windows-latest");
    expect(workflow).toContain("macos-latest");
    expect(workflow).toContain("ubuntu-latest");
    expect(workflow).not.toMatch(/npm\s+publish/u);
  });
});
