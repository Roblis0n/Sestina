import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, writeFileSync, rmSync, mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { applyConfirmedConfigChange } from "../src/index.js";

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k: string, v: unknown) => {
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      const obj = v as Record<string, unknown>;
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(obj).sort()) sorted[k] = obj[k];
      return sorted;
    }
    return v;
  });
}

function computeHash(current: unknown, proposed: unknown, scope: string, expectedVersion: number): string {
  const currentObj = (current ?? {}) as Record<string, unknown>;
  const proposedObj = proposed as Record<string, unknown>;
  const allKeys = new Set([...Object.keys(currentObj), ...Object.keys(proposedObj)]);
  const diff: { path: string; kind: string; oldValue?: unknown; newValue?: unknown }[] = [];
  for (const key of [...allKeys].sort()) {
    if (!(key in currentObj)) {
      diff.push({ path: key, kind: "added", newValue: proposedObj[key] });
    } else if (!(key in proposedObj)) {
      diff.push({ path: key, kind: "removed", oldValue: currentObj[key] });
    } else if (canonicalJson(currentObj[key]) !== canonicalJson(proposedObj[key])) {
      diff.push({ path: key, kind: "changed", oldValue: currentObj[key], newValue: proposedObj[key] });
    }
  }
  diff.sort((a, b) => a.path.localeCompare(b.path));
  return createHash("sha256").update(canonicalJson({ scope, expectedVersion, diff })).digest("hex");
}

describe("Atomic write", () => {
  const tmpBase = resolve(import.meta.dirname, "../../../.tmp-config-tests");

  beforeEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
    mkdirSync(tmpBase, { recursive: true });
    process.env.SESTINA_CONFIG_DIR = tmpBase;
  });

  afterEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
    delete process.env.SESTINA_CONFIG_DIR;
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
      expectedVersion: 0 as const,
      scope: "task" as const,
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

  it("rejects previewHash that does not match content", () => {
    const target = resolve(tmpBase, "hash-mismatch.json");
    writeFileSync(target, JSON.stringify({ version: 0 }), "utf8");

    const wrongHash = "f".repeat(64);
    const confirmation = {
      previewHash: wrongHash,
      expectedVersion: 0 as const,
      scope: "task" as const,
      provenance: {
        actor: "user" as const,
        channel: "desktop" as const,
        directUser: true,
      },
    };

    expect(() =>
      { applyConfirmedConfigChange(target, { version: 1 }, confirmation); },
    ).toThrow();
  });

  it("rejects directUser=false confirmation", () => {
    const target = resolve(tmpBase, "no-user.json");
    writeFileSync(target, JSON.stringify({ version: 0 }), "utf8");

    const newContent = { version: 1 };
    const confirmation = {
      previewHash: computeHash({ version: 0 }, newContent, "task", 0),
      expectedVersion: 0 as const,
      scope: "task" as const,
      provenance: {
        actor: "agent" as const,
        channel: "mcp" as const,
        directUser: false,
      },
    };

    expect(() =>
      { applyConfirmedConfigChange(target, newContent, confirmation); },
    ).toThrow();
  });

  it("verifies backup file is created on successful write", () => {
    const target = resolve(tmpBase, "with-backup.json");
    writeFileSync(target, JSON.stringify({ version: 0 }), "utf8");

    const newContent = { version: 1 };
    const confirmation = {
      previewHash: computeHash({ version: 0 }, newContent, "task", 0),
      expectedVersion: 0 as const,
      scope: "task" as const,
      provenance: {
        actor: "user" as const,
        channel: "desktop" as const,
        directUser: true,
      },
    };

    applyConfirmedConfigChange(target, newContent, confirmation);

    // Check backup was created in the same directory
    const files: string[] = readdirSync(tmpBase);
    const backupFiles = files.filter((f) => f.startsWith(".config-backup-"));
    expect(backupFiles.length).toBe(1);
    // Verify backup content matches original
    const backupFile = backupFiles[0];
    expect(backupFile).toBeDefined();
    const backupContent: Record<string, unknown> = JSON.parse(
      readFileSync(resolve(tmpBase, backupFile!), "utf8"),
    ) as Record<string, unknown>;
    expect(backupContent.version).toBe(0);
  });

  it("rejects target path outside platform config directory", () => {
    const badTarget = resolve(tmpBase, "..", "escape.json");

    const confirmation = {
      previewHash: "d".repeat(64),
      expectedVersion: 0 as const,
      scope: "task" as const,
      provenance: {
        actor: "user" as const,
        channel: "desktop" as const,
        directUser: true,
      },
    };

    expect(() =>
      { applyConfirmedConfigChange(badTarget, { key: "escaped" }, confirmation); },
    ).toThrow();
  });
});
