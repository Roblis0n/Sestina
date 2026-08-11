import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { applyConfirmedConfigChange } from "../src/index.js";

describe("Atomic write", () => {
  const tmpBase = resolve(import.meta.dirname, "../../../.tmp-config-tests");

  beforeEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
    mkdirSync(tmpBase, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
  });

  it("atomically writes a config file via temp + rename", () => {
    const target = resolve(tmpBase, "config.json");
    const initial = JSON.stringify({ version: 0 });

    // Write initial with version 0
    writeFileSync(target, initial, "utf8");

    const confirmation = {
      previewHash: "a".repeat(64),
      expectedVersion: 0 as const,
      provenance: {
        actor: "user" as const,
        channel: "desktop" as const,
        directUser: true,
      },
    };

    const newContent = { version: 1 };
    applyConfirmedConfigChange(target, newContent, confirmation);

    const data: Record<string, unknown> = JSON.parse(readFileSync(target, "utf8")) as Record<string, unknown>;
    expect(data.version).toBe(1);
  });

  it("preserves original file on write failure", () => {
    const target = resolve(tmpBase, "readonly.json");
    const initial = JSON.stringify({ key: "original" });
    writeFileSync(target, initial, "utf8");

    const confirmation = {
      previewHash: "b".repeat(64),
      expectedVersion: 0 as const,
      provenance: {
        actor: "user" as const,
        channel: "desktop" as const,
        directUser: true,
      },
    };

    // Point to a non-existent directory to test failure recovery
    const badTarget = resolve(tmpBase, "nonexistent-dir", "config.json");
    expect(() =>
      { applyConfirmedConfigChange(badTarget, { key: "updated" }, confirmation); },
    ).toThrow();

    // Original file should still be intact
    const data2: Record<string, unknown> = JSON.parse(readFileSync(target, "utf8")) as Record<string, unknown>;
    expect(data2.key).toBe("original");
  });

  it("detects concurrent modification via config_version_conflict", () => {
    const target = resolve(tmpBase, "concurrent.json");
    writeFileSync(target, JSON.stringify({ version: 5 }), "utf8");

    const confirmation = {
      previewHash: "c".repeat(64),
      expectedVersion: 0 as const, // doesn't match current version
      provenance: {
        actor: "user" as const,
        channel: "desktop" as const,
        directUser: true,
      },
    };

    expect(() =>
      { applyConfirmedConfigChange(target, { version: 2 }, confirmation); },
    ).toThrow();
  });
});
