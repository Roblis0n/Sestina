import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import {
  createFileLanguagePreferenceStore,
  resolveDefaultLanguagePreferencePath,
  type AppLanguage,
} from "../src/language-preferences.js";

describe("RI-48 local App language preference", () => {
  it("writes only an explicit Chinese or English choice and restores it from a new store instance", async () => {
    const root = await mkdtemp(join(tmpdir(), "sestina-language-preference-"));
    try {
      const filePath = join(root, "preferences.json");
      const store = createFileLanguagePreferenceStore({ filePath });
      await expect(store.readLanguage()).resolves.toBeUndefined();

      await store.writeLanguage("en");
      expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual({ schemaVersion: "1.0.0", language: "en" });
      await expect(createFileLanguagePreferenceStore({ filePath }).readLanguage()).resolves.toBe("en");

      await store.writeLanguage("zh-CN");
      await expect(createFileLanguagePreferenceStore({ filePath }).readLanguage()).resolves.toBe("zh-CN");
      await expect(store.writeLanguage("fr" as AppLanguage)).rejects.toThrow("Unsupported App language");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails closed to first-run choice for corrupt or expanded preference data without rewriting it", async () => {
    const root = await mkdtemp(join(tmpdir(), "sestina-language-corrupt-"));
    try {
      const filePath = join(root, "preferences.json");
      const original = '{"schemaVersion":"1.0.0","language":"en","device":"must-not-enter"}\n';
      await writeFile(filePath, original, "utf8");
      const store = createFileLanguagePreferenceStore({ filePath });

      await expect(store.readLanguage()).resolves.toBeUndefined();
      expect(await readFile(filePath, "utf8")).toBe(original);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("publishes concurrent explicit choices atomically without temporary-file residue", async () => {
    const root = await mkdtemp(join(tmpdir(), "sestina-language-atomic-"));
    try {
      const filePath = join(root, "preferences.json");
      const store = createFileLanguagePreferenceStore({ filePath });
      await Promise.all([store.writeLanguage("zh-CN"), store.writeLanguage("en"), store.writeLanguage("zh-CN")]);

      expect(["zh-CN", "en"]).toContain(await store.readLanguage());
      expect(await readdir(root)).toEqual(["preferences.json"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("resolves the official Windows preference below local App data without a project path", () => {
    const value = resolveDefaultLanguagePreferencePath({
      platform: "win32",
      environment: { LOCALAPPDATA: "C:\\local-app-data" },
      homeDirectory: "C:\\unused-home",
    });
    expect(value).toBe(win32.join("C:\\local-app-data", "Sestina", "preferences.json"));
  });
});
