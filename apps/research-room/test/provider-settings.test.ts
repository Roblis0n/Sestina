import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import type { SecretBackend } from "@sestina/core";
import {
  ProviderConfigurationService,
  ProviderSettingsError,
  createFileProviderConfigStore,
  resolveDefaultSecondOpinionProviderConfigPath,
  resolveDefaultProviderConfigPath,
  validateOpenAICompatibleBaseUrl,
} from "../src/provider-settings.js";

function memorySecrets(): SecretBackend & { readonly values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    get: (ref) => Promise.resolve(values.get(ref)),
    set: (ref, value) => { values.set(ref, value); return Promise.resolve(); },
    delete: (ref) => { values.delete(ref); return Promise.resolve(); },
    describe: (ref) => Promise.resolve({ configured: values.has(ref) }),
    health: () => Promise.resolve({ available: true, backend: "dpapi" as const }),
  };
}

describe("Research Room Provider settings", () => {
  it("saves one external openai_compatible config only with an OS-backed key and never writes the key to config", async () => {
    const root = await mkdtemp(join(tmpdir(), "sestina-provider-settings-"));
    try {
      const filePath = join(root, "provider.json");
      const secrets = memorySecrets();
      const service = new ProviderConfigurationService(createFileProviderConfigStore({ filePath }), secrets);
      await expect(service.save({
        providerId: "primary-judge",
        baseUrl: "https://models.example.test/v1/",
        model: "judge-1",
        timeoutMs: 20_000,
        maxOutputTokens: 2_048,
      })).rejects.toMatchObject({ code: "provider_key_required" });

      const saved = await service.save({
        providerId: "primary-judge",
        baseUrl: "https://models.example.test/v1/",
        model: "judge-1",
        timeoutMs: 20_000,
        maxOutputTokens: 2_048,
        apiKey: "synthetic-key-never-in-config",
      });
      expect(saved).toMatchObject({ family: "openai_compatible", locality: "external", generation: 1, baseUrl: "https://models.example.test/v1" });
      const bytes = await readFile(filePath, "utf8");
      expect(bytes).not.toContain("synthetic-key-never-in-config");
      expect(JSON.parse(bytes)).toEqual(saved);
      expect(await service.status()).toMatchObject({ mode: "configured", secretConfigured: true, config: { generation: 1 } });
      expect(await service.loadRuntimeSnapshot()).toMatchObject({ config: { generation: 1 }, apiKey: "synthetic-key-never-in-config" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("allows explicit loopback HTTP without a key, increments generation, and deletes config separately from secret", async () => {
    const root = await mkdtemp(join(tmpdir(), "sestina-provider-loopback-"));
    try {
      const secrets = memorySecrets();
      const service = new ProviderConfigurationService(createFileProviderConfigStore({ filePath: join(root, "provider.json") }), secrets);
      const first = await service.save({ providerId: "local-judge", baseUrl: "http://127.0.0.1:11434/v1", model: "local", timeoutMs: 4_000 });
      expect(first).toMatchObject({ locality: "local", generation: 1 });
      const second = await service.save({ providerId: "local-judge", baseUrl: "http://localhost:11434/v1", model: "local-2", timeoutMs: 5_000, apiKey: "optional-local-key" });
      expect(second.generation).toBe(2);
      expect(await service.currentGeneration()).toBe(2);
      await service.deleteConfig();
      const offline = await service.status();
      expect(offline).toMatchObject({ mode: "offline_ledger", secretConfigured: true });
      expect("config" in offline).toBe(false);
      expect(await service.currentGeneration()).toBeUndefined();
      await service.deleteSecret();
      expect(await service.status()).toMatchObject({ mode: "offline_ledger", secretConfigured: false });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails closed on corrupt or expanded config and never overwrites it automatically", async () => {
    const root = await mkdtemp(join(tmpdir(), "sestina-provider-corrupt-"));
    try {
      const filePath = join(root, "provider.json");
      const original = '{"schemaVersion":"1.0.0","family":"openai_compatible","apiKey":"must-stay-unread"}\n';
      await writeFile(filePath, original, "utf8");
      const service = new ProviderConfigurationService(createFileProviderConfigStore({ filePath }), memorySecrets());
      await expect(service.status()).rejects.toBeInstanceOf(ProviderSettingsError);
      await expect(service.save({ providerId: "x", baseUrl: "http://127.0.0.1:1/v1", model: "x", timeoutMs: 1_000 })).rejects.toMatchObject({ code: "provider_config_corrupt" });
      expect(await readFile(filePath, "utf8")).toBe(original);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    ["file scheme", "file:///tmp/model"],
    ["external HTTP", "http://models.example.test/v1"],
    ["userinfo", "https://user:secret@models.example.test/v1"],
    ["unspecified", "http://0.0.0.0:11434/v1"],
    ["link local", "http://169.254.169.254/latest"],
    ["metadata host", "https://metadata.google.internal/v1"],
    ["metadata host with trailing dot", "https://metadata.google.internal./v1"],
    ["private external literal", "https://192.168.1.10/v1"],
    ["IPv6 link local", "https://[fe80::1]/v1"],
    ["IPv6 multicast", "https://[ff02::1]/v1"],
    ["query", "https://models.example.test/v1?key=secret"],
    ["fragment", "https://models.example.test/v1#secret"],
  ])("rejects %s Provider URL", (_name, value) => {
    expect(() => validateOpenAICompatibleBaseUrl(value)).toThrow(ProviderSettingsError);
  });

  it("resolves the Provider config below Windows local App data, never inside a project", () => {
    expect(resolveDefaultProviderConfigPath({
      platform: "win32",
      environment: { LOCALAPPDATA: "C:\\local-app-data" },
      homeDirectory: "C:\\unused",
    })).toBe(win32.join("C:\\local-app-data", "Sestina", "provider.json"));
    expect(resolveDefaultProviderConfigPath({
      platform: "win32",
      environment: { LOCALAPPDATA: "   " },
      homeDirectory: "C:\\profile",
    })).toBe(win32.join("C:\\profile", "AppData", "Local", "Sestina", "provider.json"));
    expect(resolveDefaultSecondOpinionProviderConfigPath({
      platform: "win32",
      environment: { LOCALAPPDATA: "C:\\local-app-data" },
      homeDirectory: "C:\\unused",
    })).toBe(win32.join("C:\\local-app-data", "Sestina", "second-opinion-provider.json"));
  });

  it("keeps the original judge and selected second-opinion connection in separate config and secret slots", async () => {
    const root = await mkdtemp(join(tmpdir(), "sestina-provider-role-isolation-"));
    try {
      const secrets = memorySecrets();
      const primary = new ProviderConfigurationService(createFileProviderConfigStore({ filePath: join(root, "provider.json") }), secrets);
      const second = new ProviderConfigurationService(createFileProviderConfigStore({ filePath: join(root, "second-opinion-provider.json") }), secrets, { secretRef: "sestina/research-room/second-opinion/openai-compatible/api-key" });
      await primary.save({ providerId: "original-judge", baseUrl: "https://original.example.test/v1", model: "original", timeoutMs: 2_000, apiKey: "original-key" });
      await second.save({ providerId: "independent-judge", baseUrl: "https://independent.example.test/v1", model: "independent", timeoutMs: 3_000, apiKey: "independent-key" });
      expect(await primary.loadRuntimeSnapshot()).toMatchObject({ config: { providerId: "original-judge" }, apiKey: "original-key" });
      expect(await second.loadRuntimeSnapshot()).toMatchObject({ config: { providerId: "independent-judge" }, apiKey: "independent-key" });
      expect(await readFile(join(root, "provider.json"), "utf8")).not.toContain("independent");
      expect(await readFile(join(root, "second-opinion-provider.json"), "utf8")).not.toContain("original");
      await second.deleteSecret();
      expect(await primary.status()).toMatchObject({ secretConfigured: true });
      expect(await second.status()).toMatchObject({ secretConfigured: false });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
