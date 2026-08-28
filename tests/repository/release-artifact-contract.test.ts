import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("RI-53 Research Room release entrypoints", () => {
  it("exposes product-scoped build, verifier, lifecycle, and no-publish gates", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")) as { readonly scripts: Readonly<Record<string, string>> };
    expect(packageJson.scripts["release:build"]).toBe("node scripts/build-release.mjs");
    expect(packageJson.scripts["release:verify"]).toBe("node scripts/verify-release-artifact.mjs");
    expect(packageJson.scripts["release:fresh-install"]).toBe("node scripts/run-fresh-install.mjs");
    expect(packageJson.scripts["verify:ri53"]).toContain("ri53");
    const workflow = await readFile(new URL("../../.github/workflows/release.yml", import.meta.url), "utf8");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("fail-fast: false");
    expect(workflow).toContain("windows-latest");
    expect(workflow).toContain("macos-latest");
    expect(workflow).toContain("ubuntu-latest");
    expect(workflow).toContain("pnpm verify:ri53");
    expect(workflow).toContain("sestina-research-room-");
    expect(workflow).not.toContain("draft-private-release");
    expect(workflow).not.toMatch(/gh\s+release\s+create/u);
    expect(workflow).not.toMatch(/npm\s+publish/u);
  });

  it("makes Research Room the artifact entry and keeps CLI/MCP subordinate", async () => {
    const builder = await readFile(new URL("../../scripts/build-release.mjs", import.meta.url), "utf8");
    expect(builder).toContain("Sestina Research Room");
    expect(builder).toContain("apps/research-room/dist/main.js");
    expect(builder).toContain("apps/research-room/dist/client");
    expect(builder).toContain("apps/research-room/dist/mcp");
    expect(builder).toContain("nativeSecretBackend");
    expect(builder).toContain("RECOVERY-AND-UPGRADE.md");
    expect(builder).toContain("SECURITY.md");
    expect(builder).not.toContain("npmName");
    expect(builder).not.toContain("npmPackagePaths");
  });
});
