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

  it("detects removed keys with kind: removed", () => {
    const current: Record<string, unknown> = {
      capture: { hostContentLevel: "governance_only", retentionDays: 90, hostTextEnabled: false, excludePatterns: [] },
      privacy: { networkDefault: "deny_unless_provider_enabled", retentionDays: 90, autoCleanup: true },
    };

    const proposed: Record<string, unknown> = {
      capture: { hostContentLevel: "governance_only", retentionDays: 90, hostTextEnabled: false, excludePatterns: [] },
      // privacy key removed entirely
    };

    const preview = previewConfigChange(current, proposed, { scope: "task", expectedVersion: 0 });
    const removedEntries = preview.diff.filter((d) => d.kind === "removed");
    expect(removedEntries.length).toBeGreaterThan(0);
    const privacyRemoved = removedEntries.find((d) => d.path.startsWith("privacy"));
    expect(privacyRemoved).toBeDefined();
  });

  it("produces the same hash with differently-ordered input keys", () => {
    const a: Record<string, unknown> = { a: 1, b: 2 };
    const b: Record<string, unknown> = { b: 2, a: 1 };
    const proposed: Record<string, unknown> = { c: 3 };

    const previewA = previewConfigChange(a, proposed, { scope: "task", expectedVersion: 0 });
    const previewB = previewConfigChange(b, proposed, { scope: "task", expectedVersion: 0 });
    expect(previewA.previewHash).toBe(previewB.previewHash);
  });

  it("produces different hashes for different scopes", () => {
    const current: Record<string, unknown> = { key: "value" };
    const proposed: Record<string, unknown> = { key: "new" };

    const task = previewConfigChange(current, proposed, { scope: "task", expectedVersion: 0 });
    const project = previewConfigChange(current, proposed, { scope: "project", expectedVersion: 0 });
    expect(task.previewHash).not.toBe(project.previewHash);
  });
});
