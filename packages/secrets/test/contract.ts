/**
 * Shared SecretBackend contract tests.
 *
 * Every platform backend MUST pass this suite — it defines the
 * minimal invariants: store, retrieve, delete, describe without
 * leaking secret material.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { SecretBackend } from "../src/port.js";

/** A backend factory provided by each platform-specific test file. */
export function secretBackendContract(
  factory: () => SecretBackend,
  _opts?: { skipDescribeLeakCheck?: boolean },
) {
  void _opts; // reserved for future use
  describe("SecretBackend contract", () => {
    let backend: SecretBackend;

    beforeEach(() => {
      backend = factory();
    });

    afterEach(async () => {
      // Clean up any test keys
      await backend.delete("sestina/test").catch(() => undefined);
      await backend.delete("sestina/test2").catch(() => undefined);
      await backend.delete("sestina/overwrite").catch(() => undefined);
    });

    it("stores, retrieves, and deletes without exposing secret material", async () => {
      await backend.set("sestina/test", "synthetic-secret-123");
      expect(await backend.get("sestina/test")).toBe("synthetic-secret-123");
      expect(await backend.describe("sestina/test")).toEqual({
        configured: true,
      });
      await backend.delete("sestina/test");
      expect(await backend.get("sestina/test")).toBeUndefined();
    });

    it("returns configured: false for missing secrets", async () => {
      expect(await backend.describe("sestina/nonexistent")).toEqual({
        configured: false,
      });
    });

    it("get returns undefined for missing secrets", async () => {
      expect(await backend.get("sestina/nonexistent")).toBeUndefined();
    });

    it("delete is idempotent — no error on missing key", async () => {
      await expect(
        backend.delete("sestina/nonexistent"),
      ).resolves.toBeUndefined();
    });

    it("overwrites existing value", async () => {
      await backend.set("sestina/overwrite", "original");
      await backend.set("sestina/overwrite", "updated");
      expect(await backend.get("sestina/overwrite")).toBe("updated");
    });

    it("describe never reveals the secret value", async () => {
      await backend.set("sestina/test", "super-secret-value-do-not-leak");
      const desc = await backend.describe("sestina/test");
      expect(desc).toEqual({ configured: true });
      // The describe result MUST NOT contain the secret value
      const serialized = JSON.stringify(desc);
      expect(serialized).not.toContain("super-secret-value-do-not-leak");
      expect(serialized).not.toContain("secret");
    });

    it("handles empty string secrets", async () => {
      await backend.set("sestina/test", "");
      expect(await backend.get("sestina/test")).toBe("");
      await backend.delete("sestina/test");
      expect(await backend.get("sestina/test")).toBeUndefined();
    });

    it("handles special characters in secret values", async () => {
      const special = '!@#$%^&*()_+-=[]{}|;:\'",.<>?/~`\n\t\r\x00';
      await backend.set("sestina/test", special);
      expect(await backend.get("sestina/test")).toBe(special);
    });

    it("handles Unicode secret values", async () => {
      const unicode = "секрет 🔐 🔑 密钥 prueba";
      await backend.set("sestina/test", unicode);
      expect(await backend.get("sestina/test")).toBe(unicode);
    });

    it("isolation: different refs store independent values", async () => {
      await backend.set("sestina/test", "value-a");
      await backend.set("sestina/test2", "value-b");
      expect(await backend.get("sestina/test")).toBe("value-a");
      expect(await backend.get("sestina/test2")).toBe("value-b");
    });

    it("health returns a valid status object", async () => {
      const status = await backend.health();
      expect(status).toHaveProperty("available");
      expect(status).toHaveProperty("backend");
      expect([
        "dpapi",
        "keychain",
        "secret-service",
        "environment",
        "none",
      ]).toContain(status.backend);
      if (!status.available) {
        expect(status.reason).toBeDefined();
      }
    });
  });
}
