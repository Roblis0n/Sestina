import { describe, it, beforeEach, afterEach, vi } from "vitest";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { watchEffectiveConfig } from "../src/index.js";

describe("Hot reload", () => {
  const tmpBase = resolve(import.meta.dirname, "../../../.tmp-config-hot-reload");

  beforeEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
    mkdirSync(tmpBase, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
  });

  it("keeps last-known-good config when new config is invalid", async () => {
    const configPath = resolve(tmpBase, "config.json");
    const validConfig = JSON.stringify({
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
    });
    writeFileSync(configPath, validConfig, "utf8");

    const onChange = vi.fn();
    const stop = watchEffectiveConfig(configPath, onChange);

    // Wait briefly then write invalid config
    await new Promise((r) => setTimeout(r, 100));
    writeFileSync(configPath, "not valid json {{{", "utf8");
    await new Promise((r) => setTimeout(r, 200));

    // The callback should NOT have been called with invalid config
    stop();
  });

  it("loads a valid config change via watcher", async () => {
    const configPath = resolve(tmpBase, "config.json");
    const validConfig = JSON.stringify({
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
    });
    writeFileSync(configPath, validConfig, "utf8");

    const changes: unknown[] = [];
    const stop = watchEffectiveConfig(configPath, (cfg) => changes.push(cfg));
    await new Promise((r) => setTimeout(r, 50));

    // Write updated valid config
    const updated = JSON.stringify({
      capture: {
        hostContentLevel: "summary",
        retentionDays: 30,
        hostTextEnabled: true,
        excludePatterns: [],
      },
      privacy: {
        networkDefault: "deny_unless_provider_enabled",
        retentionDays: 30,
        autoCleanup: true,
      },
      notifications: { osEnabled: true, feedEnabled: true, urgentOnly: false },
      runtime: { autoStart: false },
    });
    writeFileSync(configPath, updated, "utf8");
    await new Promise((r) => setTimeout(r, 200));

    stop();
  });
});
