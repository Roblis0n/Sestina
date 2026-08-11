import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { applyConfirmedConfigChange } from "../src/index.js";

function computeHash(current: unknown, proposed: unknown, scope: string, expectedVersion: number): string {
  // Match preview.ts hash structure: {scope, expectedVersion, diff}
  const currentObj = (current ?? {}) as Record<string, unknown>;
  const proposedObj = proposed as Record<string, unknown>;
  const allKeys = new Set([...Object.keys(currentObj), ...Object.keys(proposedObj)]);
  const diff: { path: string; kind: string; oldValue?: unknown; newValue?: unknown }[] = [];
  for (const key of [...allKeys].sort()) {
    if (!(key in currentObj)) {
      diff.push({ path: key, kind: "added", newValue: proposedObj[key] });
    } else if (!(key in proposedObj)) {
      diff.push({ path: key, kind: "removed", oldValue: currentObj[key] });
    } else if (JSON.stringify(currentObj[key]) !== JSON.stringify(proposedObj[key])) {
      diff.push({
        path: key,
        kind: "changed",
        oldValue: currentObj[key],
        newValue: proposedObj[key],
      });
    }
  }
  diff.sort((a, b) => a.path.localeCompare(b.path));
  return createHash("sha256")
    .update(JSON.stringify({ scope, expectedVersion, diff }))
    .digest("hex");
}

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
      scope: "task" as const,
      provenance: {
        actor: "user" as const,
        channel: "desktop" as const,
        directUser: true,
      },
    };

    const newContent = { version: 1 };
    confirmation.previewHash = computeHash({ version: 0 }, newContent, confirmation.scope, confirmation.expectedVersion);
    applyConfirmedConfigChange(target, newContent, confirmation);

    const data: Record<string, unknown> = JSON.parse(readFileSync(target, "utf8")) as Record<string, unknown>;
    expect(data.version).toBe(1);
  });

  it("preserves original file on write failure", () => {
    const target = resolve(tmpBase, "readonly.json");
    const initial = JSON.stringify({ key: "original" });
    writeFileSync(target, initial, "utf8");

    const newContent2 = { key: "updated" };
    const confirmation = {
      previewHash: computeHash({ key: "original" }, newContent2, "task", 0),
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
      { applyConfirmedConfigChange(badTarget, newContent2, confirmation); },
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
