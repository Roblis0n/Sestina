import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { FsWatcher } from "../src/index.js";
import { watchEffectiveConfig } from "../src/index.js";
import type { EffectiveConfig } from "@sestina/schema";

// ── Fake directory-based watcher for deterministic testing ──

interface FakeWatcher extends FsWatcher {
  _emit(filename: string, eventType: "change" | "rename"): void;
  _emitError(err: Error): void;
}

function createFakeWatcher(): FakeWatcher {
  const eventHandlers: ((filename: string, eventType: "change" | "rename") => void)[] = [];
  const errorHandlers: ((err: Error) => void)[] = [];
  return {
    onEvent(handler) { eventHandlers.push(handler); },
    onError(handler) { errorHandlers.push(handler); },
    close() { eventHandlers.length = 0; errorHandlers.length = 0; },
    _emit(filename: string, eventType: "change" | "rename") {
      for (const h of eventHandlers) h(filename, eventType);
    },
    _emitError(err: Error) { for (const h of errorHandlers) h(err); },
  };
}

function writeValidConfig(path: string, overrides: Record<string, unknown> = {}): void {
  const config = {
    capture: { hostContentLevel: "governance_only", retentionDays: 90, hostTextEnabled: false, excludePatterns: [] },
    privacy: { networkDefault: "deny_unless_provider_enabled" as const, retentionDays: 90, autoCleanup: true },
    notifications: { osEnabled: true, feedEnabled: true, urgentOnly: false },
    runtime: { autoStart: true },
    collaboration: {
      enabled: true,
      sameProjectOnly: true,
      allowRemoteTransport: false,
      defaultInboundPolicy: "accept" as const,
      handoffRequiresUserConfirmation: true,
      maxHops: 4,
      maxOutstandingConsultsPerTask: 8,
      maxMessagesPerMinutePerTask: 12,
      maxMessageBytes: 16384,
      maxContextRefs: 8,
      defaultTtlSeconds: 1800,
      maxTtlSeconds: 86400,
      messageRetentionDays: 90,
    },
    providers: [] as unknown[],
    hostDefaults: {},
    degradation: false,
    missingFields: [] as string[],
    ...overrides,
  };
  writeFileSync(path, JSON.stringify(config), "utf8");
}

function firstArg(fn: ReturnType<typeof vi.fn>): unknown {
  const call = fn.mock.calls[0];
  if (!call) throw new Error("Expected mock to have been called at least once");
  return call[0];
}

// ── Tests ──

describe("watchEffectiveConfig", () => {
  const tmpBase = resolve(import.meta.dirname, "../../../.tmp-config-hot-reload");

  beforeEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
    mkdirSync(tmpBase, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
  });

  it("fires onChange when file is written", () => {
    const configPath = resolve(tmpBase, "config.json");
    writeValidConfig(configPath);
    const fakeWatcher = createFakeWatcher();
    const onChange = vi.fn();
    const onError = vi.fn();

    const stop = watchEffectiveConfig(configPath, onChange, onError, () => fakeWatcher);
    fakeWatcher._emit("config.json", "change");

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect((firstArg(onChange) as EffectiveConfig).capture.hostContentLevel).toBe("governance_only");
    stop();
  });

  it("fires onChange on atomic rename (temp-write-then-rename)", () => {
    const configPath = resolve(tmpBase, "config.json");
    writeValidConfig(configPath);
    const fakeWatcher = createFakeWatcher();
    const onChange = vi.fn();

    const stop = watchEffectiveConfig(configPath, onChange, undefined, () => fakeWatcher);
    fakeWatcher._emit("config.json", "rename");

    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
  });

  it("survives delete and fires onChange on recreate", () => {
    const configPath = resolve(tmpBase, "config.json");
    writeValidConfig(configPath);
    const fakeWatcher = createFakeWatcher();
    const onChange = vi.fn();
    const onError = vi.fn();

    const stop = watchEffectiveConfig(configPath, onChange, onError, () => fakeWatcher);
    rmSync(configPath);
    fakeWatcher._emit("config.json", "rename");
    expect(onChange).not.toHaveBeenCalled();

    writeValidConfig(configPath, {
      capture: { hostContentLevel: "summary", retentionDays: 30, hostTextEnabled: true, excludePatterns: [] },
    });
    fakeWatcher._emit("config.json", "change");

    expect(onChange).toHaveBeenCalledTimes(1);
    expect((firstArg(onChange) as EffectiveConfig).capture.hostContentLevel).toBe("summary");
    stop();
  });

  it("ignores events for unrelated files in the same directory", () => {
    const configPath = resolve(tmpBase, "config.json");
    writeValidConfig(configPath);
    const fakeWatcher = createFakeWatcher();
    const onChange = vi.fn();

    const stop = watchEffectiveConfig(configPath, onChange, undefined, () => fakeWatcher);
    fakeWatcher._emit("other-file.log", "change");
    fakeWatcher._emit("unrelated.json", "rename");

    expect(onChange).not.toHaveBeenCalled();
    stop();
  });

  it("recovers from watcher error and continues working", () => {
    vi.useFakeTimers();
    const configPath = resolve(tmpBase, "config.json");
    writeValidConfig(configPath);
    const fakeWatcher = createFakeWatcher();
    const onChange = vi.fn();

    let creations = 0;
    const factory = (): FsWatcher => { creations++; return fakeWatcher; };

    const stop = watchEffectiveConfig(configPath, onChange, undefined, factory);
    expect(creations).toBe(1);

    fakeWatcher._emitError(new Error("EPERM"));
    vi.advanceTimersByTime(1100);
    expect(creations).toBe(2);

    fakeWatcher._emit("config.json", "change");
    expect(onChange).toHaveBeenCalledTimes(1);

    stop();
    vi.useRealTimers();
  });

  it("stop() prevents any further callbacks", () => {
    const configPath = resolve(tmpBase, "config.json");
    writeValidConfig(configPath);
    const fakeWatcher = createFakeWatcher();
    const onChange = vi.fn();

    const stop = watchEffectiveConfig(configPath, onChange, undefined, () => fakeWatcher);
    fakeWatcher._emit("config.json", "change");
    expect(onChange).toHaveBeenCalledTimes(1);

    stop();
    fakeWatcher._emit("config.json", "change");
    fakeWatcher._emit("config.json", "rename");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("calls onError and does NOT call onChange when invalid JSON is written", () => {
    const configPath = resolve(tmpBase, "config.json");
    writeValidConfig(configPath);
    const fakeWatcher = createFakeWatcher();
    const onChange = vi.fn();
    const onError = vi.fn();

    const stop = watchEffectiveConfig(configPath, onChange, onError, () => fakeWatcher);
    fakeWatcher._emit("config.json", "change");
    expect(onChange).toHaveBeenCalledTimes(1);
    onChange.mockClear();

    writeFileSync(configPath, "not valid json {{{", "utf8");
    fakeWatcher._emit("config.json", "change");

    expect(onChange).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(firstArg(onError).message).toContain("keeping last-known-good");
    stop();
  });

  it("calls onError with fieldErrors when schema validation fails", () => {
    const configPath = resolve(tmpBase, "config.json");
    writeValidConfig(configPath);
    const fakeWatcher = createFakeWatcher();
    const onChange = vi.fn();
    const onError = vi.fn();

    const stop = watchEffectiveConfig(configPath, onChange, onError, () => fakeWatcher);
    fakeWatcher._emit("config.json", "change");
    onChange.mockClear();

    writeFileSync(configPath, JSON.stringify({
      capture: { hostContentLevel: "governance_only", retentionDays: 90, hostTextEnabled: false, excludePatterns: [] },
    }), "utf8");
    fakeWatcher._emit("config.json", "change");

    expect(onChange).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    const err = firstArg(onError) as { fieldErrors?: string[] };
    expect(err.fieldErrors).toBeDefined();
    const ferr = err.fieldErrors;
    if (ferr) {
      expect(ferr.length).toBeGreaterThan(0);
    }
    stop();
  });
});
