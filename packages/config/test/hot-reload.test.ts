import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { FsWatcher } from "../src/index.js";
import { watchEffectiveConfig } from "../src/index.js";
import type { EffectiveConfig } from "@sestina/schema";

// ── Fake watcher for deterministic cross-platform testing ──

interface FakeWatcher extends FsWatcher {
  _emitEvent(eventType: "change" | "rename"): void;
  _emitError(err: Error): void;
}

function createFakeWatcher(): FakeWatcher {
  const eventHandlers: ((e: "change" | "rename") => void)[] = [];
  const errorHandlers: ((err: Error) => void)[] = [];
  return {
    onEvent(handler) { eventHandlers.push(handler); },
    onError(handler) { errorHandlers.push(handler); },
    close() { eventHandlers.length = 0; errorHandlers.length = 0; },
    _emitEvent(eventType) { for (const h of eventHandlers) h(eventType); },
    _emitError(err) { for (const h of errorHandlers) h(err); },
  };
}

function writeValidConfig(path: string, overrides: Record<string, unknown> = {}): void {
  const config = {
    capture: { hostContentLevel: "governance_only", retentionDays: 90, hostTextEnabled: false, excludePatterns: [] },
    privacy: { networkDefault: "deny_unless_provider_enabled" as const, retentionDays: 90, autoCleanup: true },
    notifications: { osEnabled: true, feedEnabled: true, urgentOnly: false },
    runtime: { autoStart: true },
    providers: [] as unknown[],
    hostDefaults: {},
    degradation: false,
    missingFields: [] as string[],
    ...overrides,
  };
  writeFileSync(path, JSON.stringify(config), "utf8");
}

// ── Tests ──

describe("watchEffectiveConfig", () => {
  const tmpBase = resolve(import.meta.dirname, "../../../.tmp-config-hot-reload");

  beforeEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
    mkdirSync(tmpBase, { recursive: true });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(tmpBase, { recursive: true, force: true });
  });

  it("emits onChange when file is written, and stop() prevents further callbacks", () => {
    const configPath = resolve(tmpBase, "config.json");
    writeValidConfig(configPath);

    const fakeWatcher = createFakeWatcher();
    const onChange = vi.fn();
    const onError = vi.fn();

    const stop = watchEffectiveConfig(configPath, onChange, onError, () => fakeWatcher);

    // watcher should have been created
    expect(fakeWatcher).toBeDefined();

    // Simulate a file change event
    fakeWatcher._emitEvent("change");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();

    const newConfig = onChange.mock.calls[0][0] as EffectiveConfig;
    expect(newConfig.capture.hostContentLevel).toBe("governance_only");

    // Stop — should prevent further events
    stop();
    fakeWatcher._emitEvent("change");
    expect(onChange).toHaveBeenCalledTimes(1); // no additional call
  });

  it("calls onError and keeps last-known-good when invalid JSON is written", () => {
    const configPath = resolve(tmpBase, "config.json");
    writeValidConfig(configPath);

    const fakeWatcher = createFakeWatcher();
    const onChange = vi.fn();
    const onError = vi.fn();

    const stop = watchEffectiveConfig(configPath, onChange, onError, () => fakeWatcher);

    // Initial change loads valid config
    fakeWatcher._emitEvent("change");
    expect(onChange).toHaveBeenCalledTimes(1);
    onChange.mockClear();

    // Write invalid JSON
    writeFileSync(configPath, "not valid json {{{", "utf8");
    fakeWatcher._emitEvent("change");

    // onChange should NOT fire for invalid config
    expect(onChange).not.toHaveBeenCalled();
    // onError should fire
    expect(onError).toHaveBeenCalledTimes(1);
    const errArg = onError.mock.calls[0][0] as { message: string };
    expect(errArg.message).toContain("keeping last-known-good");

    stop();
  });

  it("calls onError with field errors when schema validation fails", () => {
    const configPath = resolve(tmpBase, "config.json");
    writeValidConfig(configPath);

    const fakeWatcher = createFakeWatcher();
    const onChange = vi.fn();
    const onError = vi.fn();

    const stop = watchEffectiveConfig(configPath, onChange, onError, () => fakeWatcher);

    // Initial load
    fakeWatcher._emitEvent("change");
    onChange.mockClear();

    // Write config with missing required field (no privacy section)
    writeFileSync(configPath, JSON.stringify({ capture: { hostContentLevel: "governance_only", retentionDays: 90, hostTextEnabled: false, excludePatterns: [] } }), "utf8");
    fakeWatcher._emitEvent("change");

    expect(onChange).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    const errArg2 = onError.mock.calls[0][0] as { fieldErrors?: string[] };
    expect(errArg2.fieldErrors).toBeDefined();
    if (errArg2.fieldErrors) {
      expect(errArg2.fieldErrors.length).toBeGreaterThan(0);
    }

    stop();
  });

  it("recovers from watcher error by restarting", () => {
    const configPath = resolve(tmpBase, "config.json");
    writeValidConfig(configPath);

    const fakeWatcher = createFakeWatcher();
    const onChange = vi.fn();
    const onError = vi.fn();

    // track watcher creations
    let creations = 0;
    const factory = (): FsWatcher => {
      creations++;
      return fakeWatcher;
    };

    const stop = watchEffectiveConfig(configPath, onChange, onError, factory);
    expect(creations).toBe(1);

    // Simulate watcher error (e.g., file deleted)
    fakeWatcher._emitError(new Error("ENOENT"));
    // After error, the watcher should attempt restart (setTimeout)
    vi.advanceTimersByTime(1100);
    // Should have created a new watcher
    expect(creations).toBe(2);

    // After restart, events should still work
    fakeWatcher._emitEvent("change");
    expect(onChange).toHaveBeenCalled();

    stop();
  });

  it("handles file not existing at startup, then appearing later", () => {
    const configPath = resolve(tmpBase, "config.json");
    // File does NOT exist initially

    const fakeWatcher = createFakeWatcher();
    const onChange = vi.fn();

    let creations = 0;
    const factory = (): FsWatcher => {
      creations++;
      return fakeWatcher;
    };

    const stop = watchEffectiveConfig(configPath, onChange, undefined, factory);

    // No file → watcher retries (setTimeout)
    expect(creations).toBe(0); // startFsWatcher called setTimeout, not create

    // Create the file and advance timer
    writeValidConfig(configPath);
    vi.advanceTimersByTime(1100);

    // Now watcher should be created
    expect(creations).toBe(1);

    // Simulate change
    fakeWatcher._emitEvent("change");
    expect(onChange).toHaveBeenCalledTimes(1);

    stop();
  });

  it("returns last-known-good via onChange after valid update, then preserves it through invalid update", () => {
    const configPath = resolve(tmpBase, "config.json");
    writeValidConfig(configPath);

    const fakeWatcher = createFakeWatcher();
    const onChange = vi.fn();
    const onError = vi.fn();

    const stop = watchEffectiveConfig(configPath, onChange, onError, () => fakeWatcher);

    // Load initial
    fakeWatcher._emitEvent("change");
    expect(onChange).toHaveBeenCalledTimes(1);
    const first = onChange.mock.calls[0][0] as EffectiveConfig;
    expect(first.capture.hostContentLevel).toBe("governance_only");
    onChange.mockClear();

    // Write updated valid config
    writeValidConfig(configPath, {
      capture: { hostContentLevel: "summary", retentionDays: 30, hostTextEnabled: true, excludePatterns: [] },
    });
    fakeWatcher._emitEvent("change");

    expect(onChange).toHaveBeenCalledTimes(1);
    const updated = onChange.mock.calls[0][0] as EffectiveConfig;
    expect(updated.capture.hostContentLevel).toBe("summary");
    onChange.mockClear();

    // Now write invalid JSON — last-known-good should be preserved (no onChange call)
    writeFileSync(configPath, "garbage {{{", "utf8");
    fakeWatcher._emitEvent("change");

    expect(onChange).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);

    stop();
  });
});
