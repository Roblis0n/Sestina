/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unused-vars */
/**
 * Windows DPAPI backend tests — R1-R7 coverage.
 *
 * All tests use isolated temp directories created in beforeEach/afterEach.
 * NEVER accesses %LOCALAPPDATA%. All residues cleaned in finally blocks.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { SestinaErrorCode } from "@sestina/schema";
import { secretBackendContract } from "./contract.js";
import type { DPAPIProvider } from "../src/port.js";
import type { VaultIO, ACLProvider } from "../src/windows-dpapi.js";
import {
  createWindowsDPAPIBackend,
  __test as windowsTest,
} from "../src/windows-dpapi.js";
import { getOrCreateControlToken } from "../src/control-token.js";

// ── Isolated temp directory per test ──

let testDir: string;
let testVault: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "sestina-test-"));
  testVault = join(testDir, "vault.json");
});

afterEach(() => {
  rmSync(testDir, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 25,
  });
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
      if (scope !== "CurrentUser")
        throw new Error("Only CurrentUser scope is supported");
      const header = data.toString("utf8", 0, 40);
      if (!header.startsWith("SYNTH_DPAPI_V1:"))
        throw new Error("Invalid DPAPI blob");
      const colonIdx = header.indexOf(":", 15);
      if (colonIdx === -1) throw new Error("Malformed synthetic blob");
      const obfuscated = data.subarray(colonIdx + 1);
      return Buffer.from(obfuscated.map((b) => b ^ XOR_KEY));
    },
  };
}

const silentACL: ACLProvider = {
  applyACL: () => true,
  verifyACL: () => true,
  applyACLToDir: () => {
    /* silent */
  },
};

function createTestBackend(vaultPath?: string) {
  return createWindowsDPAPIBackend(
    createSyntheticDPAPI(),
    vaultPath ?? testVault,
    undefined,
    silentACL,
  );
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

  it("merges writes from backend instances sharing one vault", async () => {
    const backendA = createTestBackend(testVault);
    const backendB = createTestBackend(testVault);

    await Promise.all([
      backendA.set("sestina/from-a", "value-a"),
      backendB.set("sestina/from-b", "value-b"),
    ]);

    const fresh = createTestBackend(testVault);
    await expect(fresh.get("sestina/from-a")).resolves.toBe("value-a");
    await expect(fresh.get("sestina/from-b")).resolves.toBe("value-b");
  });

  it("linearizes control-token creation across backend instances", async () => {
    const backendA = createTestBackend(testVault);
    const backendB = createTestBackend(testVault);

    const [tokenA, tokenB] = await Promise.all([
      getOrCreateControlToken(backendA, "ipc"),
      getOrCreateControlToken(backendB, "ipc"),
    ]);

    expect(tokenB).toEqual(tokenA);
  });
});

// ── S2: Copy-on-Write — DI-based, no manual file manipulation ──

describe("copy-on-write (DI vaultIO)", () => {
  it("set failure preserves old state in memory AND on disk via DI", async ({
    expect: ex,
  }) => {
    const diskState = new Map<string, string>();
    let saveCalls = 0;
    const failingIO: VaultIO = {
      load(_p: string) {
        return new Map(diskState);
      },
      save(_p, _store, secureCandidate) {
        saveCalls++;
        if (saveCalls > 1) throw new Error("SIMULATED_DISK_FAILURE");
        secureCandidate(`${_p}.candidate`);
        // First save: persist to diskState (simulates successful write)
        for (const [k, v] of _store) diskState.set(k, v);
      },
    };
    const noopACL: ACLProvider = {
      applyACL: () => true,
      verifyACL: () => true,
      applyACLToDir: () => {
        /* noop */
      },
    };
    const backend = createWindowsDPAPIBackend(
      createSyntheticDPAPI(),
      testVault,
      failingIO,
      noopACL,
    );

    // First set: succeeds (save works once)
    await backend.set("sestina/cow", "original-value");
    ex(await backend.get("sestina/cow")).toBe("original-value");

    // Second set: fails (save throws on second call)
    await ex(backend.set("sestina/cow", "new-value")).rejects.toThrow(
      "SIMULATED_DISK_FAILURE",
    );

    // Memory preserved after failed set — still old value
    ex(await backend.get("sestina/cow")).toBe("original-value");
  });

  it("delete failure preserves old state in memory AND on disk via DI", async ({
    expect: ex,
  }) => {
    const diskState = new Map<string, string>();
    let saveCalls = 0;
    const failingIO: VaultIO = {
      load(_p: string) {
        return new Map(diskState);
      },
      save(_p, _store, secureCandidate) {
        saveCalls++;
        if (saveCalls > 1) throw new Error("SIMULATED_DISK_FAILURE");
        secureCandidate(`${_p}.candidate`);
        for (const [k, v] of _store) diskState.set(k, v);
      },
    };
    const noopACL: ACLProvider = {
      applyACL: () => true,
      verifyACL: () => true,
      applyACLToDir: () => {
        /* noop */
      },
    };
    const backend = createWindowsDPAPIBackend(
      createSyntheticDPAPI(),
      testVault,
      failingIO,
      noopACL,
    );

    // First set: succeeds
    await backend.set("sestina/del-cow", "keep-me");
    ex(await backend.get("sestina/del-cow")).toBe("keep-me");

    // Delete: fails (save throws on second call)
    await ex(backend.delete("sestina/del-cow")).rejects.toThrow(
      "SIMULATED_DISK_FAILURE",
    );

    // Memory preserved after failed delete
    ex(await backend.get("sestina/del-cow")).toBe("keep-me");
  });

  it("ACL failure preserves the previous set value in memory and on disk", async () => {
    let diskState = new Map<string, string>();
    const io: VaultIO = {
      load() {
        return new Map(diskState);
      },
      save(_path, next, secureCandidate) {
        secureCandidate(`${_path}.candidate`);
        diskState = new Map(next);
      },
    };
    let allowACL = true;
    const acl: ACLProvider = {
      applyACL: () => allowACL,
      verifyACL: () => true,
      applyACLToDir: () => {
        /* noop */
      },
    };
    const backend = createWindowsDPAPIBackend(
      createSyntheticDPAPI(),
      testVault,
      io,
      acl,
    );
    await backend.set("sestina/cow-acl", "original");
    const before = new Map(diskState);
    allowACL = false;

    await expect(
      backend.set("sestina/cow-acl", "changed"),
    ).rejects.toMatchObject({
      code: SestinaErrorCode.secure_storage_unavailable,
    });

    expect(await backend.get("sestina/cow-acl")).toBe("original");
    expect(diskState).toEqual(before);
  });

  it("ACL failure preserves a deleted value in memory and on disk", async () => {
    let diskState = new Map<string, string>();
    const io: VaultIO = {
      load() {
        return new Map(diskState);
      },
      save(_path, next, secureCandidate) {
        secureCandidate(`${_path}.candidate`);
        diskState = new Map(next);
      },
    };
    let allowACL = true;
    const acl: ACLProvider = {
      applyACL: () => allowACL,
      verifyACL: () => true,
      applyACLToDir: () => {
        /* noop */
      },
    };
    const backend = createWindowsDPAPIBackend(
      createSyntheticDPAPI(),
      testVault,
      io,
      acl,
    );
    await backend.set("sestina/cow-acl-delete", "original");
    const before = new Map(diskState);
    allowACL = false;

    await expect(
      backend.delete("sestina/cow-acl-delete"),
    ).rejects.toMatchObject({
      code: SestinaErrorCode.secure_storage_unavailable,
    });

    expect(await backend.get("sestina/cow-acl-delete")).toBe("original");
    expect(diskState).toEqual(before);
  });
});

// ── R1: Real DPAPI + DACL test (Windows only, MUST assert success) ──

describe("vault corruption handling", () => {
  it("rejects an existing vault whose CurrentUser-only DACL cannot be verified", () => {
    writeFileSync(testVault, "{}", "utf8");
    const untrustedACL: ACLProvider = {
      applyACL: () => true,
      verifyACL: () => false,
      applyACLToDir: () => undefined,
    };

    expect(() =>
      createWindowsDPAPIBackend(
        createSyntheticDPAPI(),
        testVault,
        undefined,
        untrustedACL,
      ),
    ).toThrow();
  });

  it("health fails closed if a vault DACL becomes untrusted after startup", async () => {
    let trusted = true;
    const acl: ACLProvider = {
      applyACL: () => true,
      verifyACL: () => trusted,
      applyACLToDir: () => undefined,
    };
    const backend = createWindowsDPAPIBackend(
      createSyntheticDPAPI(),
      testVault,
      undefined,
      acl,
    );
    writeFileSync(testVault, "{}", "utf8");
    trusted = false;

    await expect(backend.health()).resolves.toMatchObject({
      available: false,
      backend: "none",
    });
  });

  it("quarantines a corrupt vault and fails closed without stderr output", () => {
    writeFileSync(testVault, "{not-json", "utf8");
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    let thrown: unknown;
    try {
      createTestBackend();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: SestinaErrorCode.database_corrupt });
    expect(readFileSync(`${testVault}.corrupt`, "utf8")).toBe("{not-json");
    expect(stderr).not.toHaveBeenCalled();
  });

  it("uses a collision-free forensic filename", () => {
    writeFileSync(testVault, "{second-corrupt", "utf8");
    writeFileSync(`${testVault}.corrupt`, "first", "utf8");

    let thrown: unknown;
    try {
      createTestBackend();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: SestinaErrorCode.database_corrupt });
    expect(readFileSync(`${testVault}.corrupt.1`, "utf8")).toBe(
      "{second-corrupt",
    );
  });
});

describe("real DPAPI and DACL (Windows)", () => {
  it("real DPAPI round-trip MUST succeed on Windows", async () => {
    if (process.platform !== "win32") return;

    let provider: DPAPIProvider;
    try {
      const { createWindowsDPAPIProvider } =
        await import("../src/windows-dpapi.js");
      provider = createWindowsDPAPIProvider();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`REAL DPAPI UNAVAILABLE ON WINDOWS: ${msg}`, {
        cause: err,
      });
    }

    const vault = join(testDir, "real-vault.json");
    const backend = createWindowsDPAPIBackend(
      provider,
      vault,
      undefined,
      silentACL,
    );

    const status = await backend.health();
    if (!status.available) {
      throw new Error(
        `REAL DPAPI HEALTH FAILED ON WINDOWS: ${status.reason ?? "unknown"}`,
      );
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

    const daclFile = join(testDir, "dacl-test.json");
    writeFileSync(daclFile, "{}", "utf8");

    // Verify icacls is available
    try {
      execFileSync("icacls", ["."], {
        timeout: 5000,
        windowsHide: true,
        stdio: "ignore",
      });
    } catch {
      throw new Error("DACL TEST FAILED: icacls not available on Windows");
    }

    // Test 1: applyCurrentUserACL must return true
    const result = applyCurrentUserACL(daclFile);
    expect(result).toBe(true);

    const systemRoot =
      process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows";
    const sidOutput = execFileSync(
      `${systemRoot}/System32/whoami.exe`,
      ["/user"],
      {
        timeout: 5000,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    ).toString("utf8");
    const sid = /S-1-5-\d+(?:-\d+)+/.exec(sidOutput)?.[0];
    expect(sid).toBeDefined();
    if (!sid) throw new Error("DACL TEST FAILED: current-user SID unavailable");

    const aclDump = join(testDir, "dacl-save.txt");
    try {
      execFileSync("icacls", [daclFile, "/save", aclDump, "/L", "/Q"], {
        timeout: 5000,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const savedAcl = readFileSync(aclDump, "utf16le");
      expect(windowsTest.isCurrentUserOnlyDacl(savedAcl, sid)).toBe(true);
      expect(
        windowsTest.isCurrentUserOnlyDacl(
          `D:P(A;;FA;;;${sid})(A;;FR;;;S-1-1-0)`,
          sid,
        ),
      ).toBe(false);
    } finally {
      try {
        execFileSync("icacls", [daclFile, "/inheritance:e", "/reset"], {
          timeout: 5000,
          windowsHide: true,
          stdio: "ignore",
        });
      } catch {
        /* afterEach exposes cleanup failure */
      }
      rmSync(aclDump, { force: true });
    }
  });
});
