import { describe, it, expect } from "vitest";
import { loadEffectiveConfig } from "../src/index.js";

describe("Config precedence and defaults", () => {
  it("keeps governance_only and no-network defaults unless explicitly enabled", () => {
    const result = loadEffectiveConfig({
      user: {},
      project: {},
      env: {},
    });

    expect(result.value.capture.hostContentLevel).toBe("governance_only");
    expect(result.value.privacy.networkDefault).toBe("deny_unless_provider_enabled");
    expect(result.value.runtime.autoStart).toBe(true);
    expect(result.sources["capture.hostContentLevel"]).toBe("builtin");
    expect(result.sources["privacy.networkDefault"]).toBe("builtin");
    expect(result.sources["runtime.autoStart"]).toBe("builtin");
  });

  it("respects precedence: request > contract > project > user > env > builtin", () => {
    const result = loadEffectiveConfig({
      request: { capture: { hostContentLevel: "full_text" } },
      contract: {},
      project: { capture: { hostContentLevel: "summary" } },
      user: {
        capture: {
          hostContentLevel: "governance_only",
          retentionDays: 90,
          hostTextEnabled: false,
          excludePatterns: [],
        },
        privacy: {
          networkDefault: "deny_unless_provider_enabled" as const,
          retentionDays: 90,
          autoCleanup: true,
        },
        notifications: { osEnabled: true, feedEnabled: true, urgentOnly: false },
        runtime: { autoStart: true },
        hostDefaults: {},
      },
      env: {},
    });

    expect(result.value.capture.hostContentLevel).toBe("full_text");
    expect(result.sources["capture.hostContentLevel"]).toBe("request");
  });

  it("allows project config to override user config for capture level", () => {
    const result = loadEffectiveConfig({
      user: {
        capture: {
          hostContentLevel: "governance_only" as const,
          retentionDays: 90,
          hostTextEnabled: false,
          excludePatterns: [],
        },
        privacy: {
          networkDefault: "deny_unless_provider_enabled" as const,
          retentionDays: 90,
          autoCleanup: true,
        },
        notifications: { osEnabled: true, feedEnabled: true, urgentOnly: false },
        runtime: { autoStart: true },
        hostDefaults: {},
      },
      project: { capture: { hostContentLevel: "summary" } },
      env: {},
    });

    expect(result.value.capture.hostContentLevel).toBe("summary");
    expect(result.sources["capture.hostContentLevel"]).toBe("project");
  });

  it("tracks sources for every effective field", () => {
    const result = loadEffectiveConfig({
      user: {
        defaultProvider: "openai-main",
        providers: [
          {
            providerId: "openai-main",
            type: "openai" as const,
            model: "gpt-5.6",
            apiKeyEnvVar: "OPENAI_API_KEY",
            timeoutMs: 8000,
          },
        ],
        capture: {
          hostContentLevel: "governance_only" as const,
          retentionDays: 90,
          hostTextEnabled: false,
          excludePatterns: [],
        },
        privacy: {
          networkDefault: "deny_unless_provider_enabled" as const,
          retentionDays: 90,
          autoCleanup: true,
        },
        notifications: { osEnabled: true, feedEnabled: true, urgentOnly: false },
        runtime: { autoStart: true },
        hostDefaults: {},
      },
      project: {},
      env: {},
    });

    expect(result.sources["capture.hostContentLevel"]).toBe("user");
    expect(result.sources["privacy.networkDefault"]).toBe("user");
    expect(result.sources["runtime.autoStart"]).toBe("user");
    expect(result.sources["notifications.osEnabled"]).toBe("user");
  });

  it("returns active providers array from configuration", () => {
    const result = loadEffectiveConfig({
      user: {
        providers: [
          {
            providerId: "openai-main",
            type: "openai" as const,
            model: "gpt-5.6",
            apiKeyEnvVar: "OPENAI_API_KEY",
          },
        ],
        capture: {
          hostContentLevel: "governance_only" as const,
          retentionDays: 90,
          hostTextEnabled: false,
          excludePatterns: [],
        },
        privacy: {
          networkDefault: "deny_unless_provider_enabled" as const,
          retentionDays: 90,
          autoCleanup: true,
        },
        notifications: { osEnabled: true, feedEnabled: true, urgentOnly: false },
        runtime: { autoStart: true },
        hostDefaults: {},
      },
      project: {},
      env: {},
    });

    expect(result.value.providers).toHaveLength(1);
    expect(result.value.providers[0].providerId).toBe("openai-main");
  });
});
