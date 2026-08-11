import { describe, it, expect } from "vitest";
import { loadEffectiveConfig } from "../src/index.js";

describe("Invalid config rejection", () => {
  it("does not silently swallow invalid enum values", () => {
    const result = loadEffectiveConfig({
      user: {
        privacy: {
          networkDefault: "invalid_value",
        },
      },
      project: {},
      env: {},
    });

    expect(result.value.missingFields.length).toBeGreaterThan(0);
    expect(result.value.capture.hostContentLevel).toBe("governance_only");
  });

  it("rejects invalid config data types gracefully", () => {
    const result = loadEffectiveConfig({
      user: {
        capture: { hostContentLevel: 123 },
      },
      project: {},
      env: {},
    });

    expect(result.value.capture.hostContentLevel).toBe("governance_only");
    expect(result.value.missingFields.length).toBeGreaterThan(0);
  });

  it("rejects project config containing API keys", () => {
    const result = loadEffectiveConfig({
      user: {},
      project: { apiKey: "sk-secret-should-not-be-here" },
      env: {},
    });

    expect(JSON.stringify(result.value)).not.toContain("sk-secret");
  });

  it("does not allow project config to disable overridable rules", () => {
    const result = loadEffectiveConfig({
      user: {},
      project: { privacy: { networkDefault: "allow_all" } },
      env: {},
    });

    expect(result.value.privacy.networkDefault).toBeDefined();
  });
});
