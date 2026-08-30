import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("RI-54 Research Room public-preview release entrypoints", () => {
  it("exposes product-scoped build, verifier, lifecycle, and no-publish gates", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")) as { readonly scripts: Readonly<Record<string, string>> };
    expect(packageJson.scripts["release:build"]).toBe("node scripts/build-release.mjs");
    expect(packageJson.scripts["release:verify"]).toBe("node scripts/verify-release-artifact.mjs");
    expect(packageJson.scripts["release:fresh-install"]).toBe("node scripts/run-fresh-install.mjs");
    expect(packageJson.scripts["verify:ri54"]).toContain("ri54");
    expect(packageJson.scripts["verify:ri54:shared"]).toContain("ri54");
    expect(packageJson.scripts["pilot:kit:package"]).toContain("package-pilot-kit");
    expect(packageJson.scripts["public-release:assemble"]).toContain("assemble-public-release");
    expect(packageJson.scripts["public-release:verify"]).toContain("verify-public-release");
    const workflow = await readFile(new URL("../../.github/workflows/release.yml", import.meta.url), "utf8");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("fail-fast: false");
    expect(workflow).toContain("windows-2025");
    expect(workflow).toContain("macos-15");
    expect(workflow).toContain("ubuntu-24.04");
    expect(workflow).toContain("expected-arch: arm64");
    expect(workflow).toContain("pnpm verify:ri54");
    expect(workflow).toContain("sestina-ri54-");
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
