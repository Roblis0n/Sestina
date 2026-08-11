import { describe, it, expect } from "vitest";
import { previewConfigChange } from "../src/index.js";

describe("Config preview", () => {
  it("generates a deterministic SHA-256 preview hash", () => {
    const current: Record<string, unknown> = {
      capture: {
        hostContentLevel: "governance_only",
        retentionDays: 90,
        hostTextEnabled: false,
        excludePatterns: [],
      },
      privacy: {
        networkDefault: "deny_unless_provider_enabled",
        retentionDays: 90,
        autoCleanup: true,
      },
      notifications: { osEnabled: true, feedEnabled: true, urgentOnly: false },
      runtime: { autoStart: true },
    };

    const proposed: Record<string, unknown> = {
      capture: {
        hostContentLevel: "summary",
        retentionDays: 90,
        hostTextEnabled: false,
        excludePatterns: [],
      },
    };

    const preview1 = previewConfigChange(current, proposed, {
      scope: "task",
      expectedVersion: 0,
    });

    const preview2 = previewConfigChange(current, proposed, {
      scope: "task",
      expectedVersion: 0,
    });

    expect(preview1.previewHash).toBe(preview2.previewHash);
    expect(preview1.previewHash).toMatch(/^[a-f0-9]{64}$/);
    expect(preview1.diff.length).toBeGreaterThan(0);
    expect(preview1.diff.some((d) => d.path.includes("hostContentLevel"))).toBe(true);
  });

  it("returns empty diff when no changes detected", () => {
    const config: Record<string, unknown> = {
      capture: {
        hostContentLevel: "governance_only",
        retentionDays: 90,
        hostTextEnabled: false,
        excludePatterns: [],
      },
    };

    const preview = previewConfigChange(config, config, {
      scope: "task",
      expectedVersion: 0,
    });

    expect(preview.diff).toHaveLength(0);
  });

  it("includes expectedVersion and scope in the hash computation", () => {
    const current: Record<string, unknown> = {
      capture: {
        hostContentLevel: "governance_only",
        retentionDays: 90,
        hostTextEnabled: false,
        excludePatterns: [],
      },
    };

    const proposed: Record<string, unknown> = {
      capture: {
        hostContentLevel: "full_text",
        retentionDays: 90,
        hostTextEnabled: false,
        excludePatterns: [],
      },
    };

    const previewV0 = previewConfigChange(current, proposed, {
      scope: "task",
      expectedVersion: 0,
    });

    const previewV1 = previewConfigChange(current, proposed, {
      scope: "task",
      expectedVersion: 1,
    });

    expect(previewV0.previewHash).not.toBe(previewV1.previewHash);
  });
});
