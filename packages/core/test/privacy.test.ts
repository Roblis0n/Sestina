import { describe, expect, it } from "vitest";
import { getPrivacyManifest } from "../src/index.js";

describe("RI-41 privacy manifest", () => {
  it("is a closed, local-first production contract", () => {
    const manifest = getPrivacyManifest();

    expect(manifest).toMatchObject({
      schemaVersion: "1.0.0",
      networkDefault: "denied",
      automaticTelemetry: false,
      crashReports: false,
      backgroundContentLogging: false,
      stateDirectory: ".sestina/",
      backupDirectory: ".sestina/backups/",
      automaticUpload: false,
      authorityMutationByExternalModel: false,
    });
    expect(manifest.dataFlows).toMatchObject({
      localCoreCli: { available: true, networkUsed: false, automatic: false },
      codexHost: { available: true, networkUsed: true, automatic: false, requiresExplicitUserAction: true, canMutateAuthority: false },
      byokSemanticProvider: {
        available: true,
        enabled: false,
        networkUsed: false,
        automatic: false,
        trigger: "explicit_research_room_manifest_confirmation",
        recipient: "user_configured_openai_compatible_endpoint",
        requiresExplicitUserAction: true,
        canMutateAuthority: false,
      },
      localModel: { available: false, enabled: false, networkUsed: false },
      capsuleTransfer: { available: true, networkUsedBySestina: false, automatic: false, canMutateAuthority: false },
      backupRestore: { available: true, networkUsed: false, automatic: false, restoreRequiresConfirmation: true },
    });
    expect(manifest.dataFlows.byokSemanticProvider.fields).toEqual([
      "user-selected bounded Research Room context",
      "frozen source, input, criterion, rubric, and state bindings",
      "suggestion or appeal question required for the confirmed assessment",
    ]);
    expect(JSON.stringify(manifest)).not.toMatch(/C:\\Users|provider response|api[_-]?key/i);
    expect(() => (manifest.dataFlows as Record<string, unknown>).unexpected = true).toThrow();
  });

  it("returns isolated immutable views rather than mutable global policy", () => {
    const first = getPrivacyManifest();
    const second = getPrivacyManifest();
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.dataFlows)).toBe(true);
  });
});
