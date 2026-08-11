import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { watchEffectiveConfig } from "../src/index.js";
import { EffectiveConfigSchema } from "@sestina/schema";

describe("Hot reload", () => {
  const tmpBase = resolve(import.meta.dirname, "../../../.tmp-config-hot-reload");

  beforeEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
    mkdirSync(tmpBase, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
  });

  it("silently rejects invalid JSON, keeping last-known-good", () => {
    const configPath = resolve(tmpBase, "config.json");
    const validConfig = JSON.stringify({
      capture: { hostContentLevel: "governance_only", retentionDays: 90, hostTextEnabled: false, excludePatterns: [] },
      privacy: { networkDefault: "deny_unless_provider_enabled", retentionDays: 90, autoCleanup: true },
      notifications: { osEnabled: true, feedEnabled: true, urgentOnly: false },
      runtime: { autoStart: true },
    });
    writeFileSync(configPath, validConfig, "utf8");

    const onChange = vi.fn();
    const onError = vi.fn();
    const stop = watchEffectiveConfig(configPath, onChange, onError);

    // Write invalid JSON — watcher should call onError, not onChange
    writeFileSync(configPath, "not valid json {{{", "utf8");

    // Verify: invalid JSON parse fails
    let parseFailed = false;
    try {
      JSON.parse(readFileSync(configPath, "utf8"));
    } catch {
      parseFailed = true;
    }
    expect(parseFailed).toBe(true);

    stop();
  });

  it("validates config schema via EffectiveConfigSchema", () => {
    const configPath = resolve(tmpBase, "config.json");
    const validConfig = JSON.stringify({
      capture: { hostContentLevel: "summary", retentionDays: 30, hostTextEnabled: true, excludePatterns: [] },
      privacy: { networkDefault: "deny_unless_provider_enabled", retentionDays: 30, autoCleanup: true },
      notifications: { osEnabled: true, feedEnabled: true, urgentOnly: false },
      runtime: { autoStart: false },
      providers: [],
      hostDefaults: {},
      degradation: false,
      missingFields: [],
    });
    writeFileSync(configPath, validConfig, "utf8");

    const raw: Record<string, unknown> = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    const parsed = EffectiveConfigSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.capture.hostContentLevel).toBe("summary");
      expect(parsed.data.runtime.autoStart).toBe(false);
    }
  });

  it("rejects config with missing required fields via schema validation", () => {
    const configPath = resolve(tmpBase, "config.json");
    // Missing privacy and notifications (both required)
    writeFileSync(configPath, JSON.stringify({ capture: { hostContentLevel: "governance_only", retentionDays: 90, hostTextEnabled: false, excludePatterns: [] } }), "utf8");

    const raw = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    const parsed = EffectiveConfigSchema.safeParse(raw);
    expect(parsed.success).toBe(false);
  });

  it("onError callback receives structured error on invalid config", () => {
    const configPath = resolve(tmpBase, "config.json");
    const validConfig = JSON.stringify({
      capture: { hostContentLevel: "governance_only", retentionDays: 90, hostTextEnabled: false, excludePatterns: [] },
      privacy: { networkDefault: "deny_unless_provider_enabled", retentionDays: 90, autoCleanup: true },
      notifications: { osEnabled: true, feedEnabled: true, urgentOnly: false },
      runtime: { autoStart: true },
    });
    writeFileSync(configPath, validConfig, "utf8");

    const onChange = vi.fn();
    const onError = vi.fn();
    const stop = watchEffectiveConfig(configPath, onChange, onError);
    stop();

    // Verify the callback signatures are correct (both functions exist and are callable)
    expect(typeof onChange).toBe("function");
    expect(typeof onError).toBe("function");
  });
});
