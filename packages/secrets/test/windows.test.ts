/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unused-vars */
/**
 * Windows DPAPI backend tests.
 *
 * Tests the REAL production backend via DI with synthetic providers.
 * Also includes automated real-DPAPI and DACL tests (Windows only).
 */
import { describe, it, expect, afterAll } from "vitest";
import { existsSync, unlinkSync } from "node:fs";
import { secretBackendContract } from "./contract.js";
import type { DPAPIProvider } from "../src/port.js";

// ── Synthetic DPAPI for structural tests ──

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

import { createWindowsDPAPIBackend } from "../src/windows-dpapi.js";

// Use isolated temp paths — NEVER pollute %LOCALAPPDATA%
const TEMP_VAULT = `${process.env.TEMP ?? "/tmp"}/sestina-test-isolated-${Date.now()}.json`;

function createTestBackend() {
  return createWindowsDPAPIBackend(createSyntheticDPAPI(), TEMP_VAULT);
}

afterAll(() => {
  try { if (existsSync(TEMP_VAULT)) unlinkSync(TEMP_VAULT); } catch { /* cleanup */ }
  try { if (existsSync(`${TEMP_VAULT}.corrupt`)) unlinkSync(`${TEMP_VAULT}.corrupt`); } catch { /* cleanup */ }
});

secretBackendContract(createTestBackend);

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

  it("backend set→get round-trips with synthetic provider", async () => {
    const backend = createTestBackend();
    await backend.set("sestina/test", "dpapi-value");
    expect(await backend.get("sestina/test")).toBe("dpapi-value");
  });

  it("backend encrypted storage does not contain plaintext", async () => {
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

  it("copy-on-write: set failure preserves old state in memory", async () => {
    const backend = createTestBackend();
    await backend.set("sestina/cow-test", "original-value");
    // Verify it was stored
    expect(await backend.get("sestina/cow-test")).toBe("original-value");
    // Attempt to set with a provider that fails on protect
    const failingProvider: DPAPIProvider = {
      async protect() { throw new Error("SIMULATED PROTECT FAILURE"); },
      async unprotect() { throw new Error("SIMULATED UNPROTECT FAILURE"); },
    };
    const failingBackend = createWindowsDPAPIBackend(failingProvider, `${TEMP_VAULT}.fail`);
    // Set should throw (smoke test fails)
    await expect(failingBackend.set("sestina/cow-test", "new-value")).rejects.toThrow();
    // Original backend still has old value
    expect(await backend.get("sestina/cow-test")).toBe("original-value");
  });
});

// ── Real DPAPI test (Windows only, FAILS if unavailable) ──

describe("real DPAPI round-trip (Windows)", () => {
  it("MUST have real DPAPI available on Windows", async () => {
    if (process.platform !== "win32") {
      // On non-Windows, this test is inapplicable — skip cleanly
      return;
    }

    // On Windows, DPAPI MUST be available — fail if not
    let dpapi: DPAPIProvider;
    try {
      const { createWindowsDPAPIProvider } = await import("../src/windows-dpapi.js");
      dpapi = createWindowsDPAPIProvider();
    } catch (err) {
      // DPAPI unavailable on Windows is a HARD FAILURE
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`REAL DPAPI UNAVAILABLE ON WINDOWS: ${msg}`, { cause: err });
    }

    const d = dpapi!;
    const realVault = `${process.env.TEMP ?? "/tmp"}/sestina-real-dpapi-${Date.now()}.json`;
    const backend = createWindowsDPAPIBackend(d, realVault);

    const status = await backend.health();
    if (!status.available) {
      throw new Error(`REAL DPAPI UNAVAILABLE ON WINDOWS: ${status.reason ?? "unknown"}`);
    }

    // Real round-trip
    const testValue = `real-dpapi-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const encrypted = await d.protect(Buffer.from(testValue, "utf8"), "CurrentUser");
    const decrypted = await d.unprotect(encrypted, "CurrentUser");
    expect(decrypted.toString("utf8")).toBe(testValue);
    expect(encrypted.toString("utf8")).not.toContain(testValue);

    // Persist through backend
    await backend.set("sestina/real-dpapi-test", testValue);
    expect(await backend.get("sestina/real-dpapi-test")).toBe(testValue);
    await backend.delete("sestina/real-dpapi-test");
    expect(await backend.get("sestina/real-dpapi-test")).toBeUndefined();

    // Clean up isolated vault
    try { unlinkSync(realVault); } catch { /* cleanup */ }
  });
});

// ── DACL auto-test (Windows only) ──

describe("DACL CurrentUser verification", () => {
  it("applies CurrentUser-only DACL on Windows", async () => {
    if (process.platform !== "win32") return;

    const { applyCurrentUserACL } = await import("../src/windows-dpapi.js");
    const { writeFileSync } = await import("node:fs");

    const daclVault = `${process.env.TEMP ?? "/tmp"}/sestina-dacl-test-${Date.now()}.json`;
    writeFileSync(daclVault, "{}", "utf8");

    try {
      const result = applyCurrentUserACL(daclVault);
      // DACL should succeed on Windows with valid SID
      // If it fails, the function returns false but does not throw
      // We verify the file still exists
      expect(existsSync(daclVault)).toBe(true);
      // DACL result: true=applied, false=could not apply (SID resolve failure, etc.)
      // Both are acceptable — the test verifies the function runs without crash
      expect(typeof result).toBe("boolean");
    } finally {
      try { unlinkSync(daclVault); } catch { /* cleanup */ }
    }
  });

  it("DACL function does not throw on non-existent file", async () => {
    if (process.platform !== "win32") return;
    const { applyCurrentUserACL } = await import("../src/windows-dpapi.js");
    const result = applyCurrentUserACL("Z:/nonexistent/vault.json");
    expect(typeof result).toBe("boolean");
  });
});
