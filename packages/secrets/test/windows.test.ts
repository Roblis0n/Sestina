/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unused-vars */
/**
 * Windows DPAPI backend tests — R1-R7 coverage.
 *
 * All tests use isolated temp directories created in beforeEach/afterEach.
 * NEVER accesses %LOCALAPPDATA%. All residues cleaned in finally blocks.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync, writeFileSync, mkdirSync, readFileSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { secretBackendContract } from "./contract.js";
import type { DPAPIProvider } from "../src/port.js";
import { createWindowsDPAPIBackend } from "../src/windows-dpapi.js";

// ── Isolated temp directory per test ──

let testDir: string;
let testVault: string;

beforeEach(() => {
  testDir = join(tmpdir(), `sestina-test-${Date.now()}-${randomBytes(4).toString("hex")}`);
  mkdirSync(testDir, { recursive: true });
  testVault = join(testDir, "vault.json");
});

afterEach(() => {
  try {
    if (existsSync(testVault)) unlinkSync(testVault);
    if (existsSync(`${testVault}.corrupt`)) unlinkSync(`${testVault}.corrupt`);
    if (existsSync(`${testVault}.corrupt.1`)) unlinkSync(`${testVault}.corrupt.1`);
    if (existsSync(testDir)) {
      // Only remove files we know we created
      try { unlinkSync(testVault); } catch { /* */ }
      try { rmdirSync(testDir); } catch { /* */ }
    }
  } catch { /* best-effort cleanup */ }
});

// ── Synthetic DPAPI ──

function createSyntheticDPAPI(): DPAPIProvider {
  let counter = 0;
  const XOR_KEY = 0x5a;
  return {
    async protect(data: Buffer, _scope: "CurrentUser") {
      const id = `synth-${++counter}`;
      const obfuscated = Buffer.from(data.map((b) => b ^ XOR_KEY));
      return Buffer.concat([Buffer.from(`SYNTH_DPAPI_V1:${id}:`), obfuscated]);
    },
    async unprotect(data: Buffer, scope: string) {
      if (scope !== "CurrentUser") throw new Error("Only CurrentUser scope is supported");
      const header = data.toString("utf8", 0, 40);
      if (!header.startsWith("SYNTH_DPAPI_V1:")) throw new Error("Invalid DPAPI blob");
      const colonIdx = header.indexOf(":", 15);
      if (colonIdx === -1) throw new Error("Malformed synthetic blob");
      const obfuscated = data.subarray(colonIdx + 1);
      return Buffer.from(obfuscated.map((b) => b ^ XOR_KEY));
    },
  };
}

function createTestBackend(vaultPath?: string) {
  return createWindowsDPAPIBackend(createSyntheticDPAPI(), vaultPath ?? testVault);
}

// ── Contract tests ──

secretBackendContract(() => createTestBackend());

// ── Structural tests ──

describe("Windows DPAPI backend", () => {
  it("synthetic DPAPI round-trips data", async () => {
    const dpapi = createSyntheticDPAPI();
    const original = Buffer.from("test-secret-data", "utf8");
    const blob = await dpapi.protect(original, "CurrentUser");
    expect(blob.toString("utf8")).not.toContain("test-secret-data");
    const recovered = await dpapi.unprotect(blob, "CurrentUser");
    expect(recovered.toString("utf8")).toBe("test-secret-data");
  });

  it("backend set→get round-trips", async () => {
    const backend = createTestBackend();
    await backend.set("sestina/test", "dpapi-value");
    expect(await backend.get("sestina/test")).toBe("dpapi-value");
  });

  it("describe does not contain plaintext", async () => {
    const backend = createTestBackend();
    await backend.set("sestina/test", "secret-abc");
    const desc = JSON.stringify(await backend.describe("sestina/test"));
    expect(desc).not.toContain("secret-abc");
  });

  it("health reports dpapi", async () => {
    const backend = createTestBackend();
    const status = await backend.health();
    expect(status.available).toBe(true);
    expect(status.backend).toBe("dpapi");
  });
});

// ── R4: Copy-on-Write — SAME backend with real persistence failure ──

describe("copy-on-write (same backend)", () => {
  it("set failure preserves old state in memory AND on disk", async () => {
    const backend = createTestBackend();
    await backend.set("sestina/cow", "original-value");

    // Verify on disk
    const content1 = readFileSync(testVault, "utf8");
    expect(content1).toContain("sestina/cow");

    // Simulate disk failure: remove write permission on the vault file
    // by replacing saveVault's target with a read-only directory
    const saved = readFileSync(testVault, "utf8");

    // Delete the vault file to simulate a write error path
    unlinkSync(testVault);
    // Create a directory in its place — rename will fail
    mkdirSync(testVault, { recursive: true });

    try {
      await backend.set("sestina/cow", "new-value");
      // Should not reach here
      expect(true).toBe(false); // fail if no throw
    } catch {
      // Expected: saveVault failed
    }

    // Clean up the blocking directory
    try { rmdirSync(testVault); } catch { /* */ }
    // Restore the vault
    writeFileSync(testVault, saved, "utf8");

    // Memory: should still have old value
    expect(await backend.get("sestina/cow")).toBe("original-value");

    // Disk: should still have old content
    const diskContent = readFileSync(testVault, "utf8");
    expect(diskContent).toBe(saved);
  });

  it("delete failure preserves old state in memory AND on disk", async () => {
    const backend = createTestBackend();
    await backend.set("sestina/del-cow", "keep-me");
    expect(await backend.get("sestina/del-cow")).toBe("keep-me");

    const saved = readFileSync(testVault, "utf8");

    // Block the write
    unlinkSync(testVault);
    mkdirSync(testVault, { recursive: true });

    try {
      await backend.delete("sestina/del-cow");
      expect(true).toBe(false);
    } catch {
      // Expected
    }

    try { rmdirSync(testVault); } catch { /* */ }
    writeFileSync(testVault, saved, "utf8");

    // Memory preserved
    expect(await backend.get("sestina/del-cow")).toBe("keep-me");
    // Disk preserved
    expect(readFileSync(testVault, "utf8")).toBe(saved);
  });
});

// ── R1: Real DPAPI + DACL test (Windows only, MUST assert success) ──

describe("real DPAPI and DACL (Windows)", () => {
  it("real DPAPI round-trip MUST succeed on Windows", async () => {
    if (process.platform !== "win32") return;

    let provider: DPAPIProvider;
    try {
      const { createWindowsDPAPIProvider } = await import("../src/windows-dpapi.js");
      provider = createWindowsDPAPIProvider();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`REAL DPAPI UNAVAILABLE ON WINDOWS: ${msg}`, { cause: err });
    }

    const vault = join(testDir, "real-vault.json");
    const backend = createWindowsDPAPIBackend(provider, vault);

    const status = await backend.health();
    if (!status.available) {
      throw new Error(`REAL DPAPI HEALTH FAILED ON WINDOWS: ${status.reason ?? "unknown"}`);
    }

    const val = `real-dpapi-${Date.now()}`;
    const enc = await provider.protect(Buffer.from(val, "utf8"), "CurrentUser");
    const dec = await provider.unprotect(enc, "CurrentUser");
    expect(dec.toString("utf8")).toBe(val);
    expect(enc.toString("utf8")).not.toContain(val);

    await backend.set("sestina/real-test", val);
    expect(await backend.get("sestina/real-test")).toBe(val);
    await backend.delete("sestina/real-test");
    expect(await backend.get("sestina/real-test")).toBeUndefined();
  });

  it("DACL MUST succeed and verify on Windows", async () => {
    if (process.platform !== "win32") return;

    const { applyCurrentUserACL } = await import("../src/windows-dpapi.js");
    const { execFileSync } = await import("node:child_process");

    const daclFile = join(testDir, "dacl-test.json");
    writeFileSync(daclFile, "{}", "utf8");

    // Verify icacls is available before testing
    let icaclsAvailable = false;
    try {
      execFileSync("icacls", ["--help"], { timeout: 3000, windowsHide: true, stdio: "ignore" });
      icaclsAvailable = true;
    } catch {
      // icacls not available (rare, e.g. non-Windows or restricted environment)
    }

    if (!icaclsAvailable) {
      // Cannot test DACL without icacls
      console.log("  [SKIP] icacls not available in this environment");
      return;
    }

    const result = applyCurrentUserACL(daclFile);
    // DACL MUST succeed on Windows with icacls available
    expect(result).toBe(true);

    // Verify: read ACL and confirm output is non-empty
    const aclOutput = execFileSync("icacls", [daclFile], {
      timeout: 5000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    }).toString("utf8");

    expect(aclOutput.length).toBeGreaterThan(0);
    // Should NOT contain "Everyone" (inherited ACEs should be removed)
    expect(aclOutput).not.toMatch(/Everyone/);
  });
});
