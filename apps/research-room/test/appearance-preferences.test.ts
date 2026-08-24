import { describe, expect, it } from "vitest";
import {
  APPEARANCE_STORAGE_KEY,
  defaultAppearancePreferences,
  readAppearancePreferences,
  applyAppearanceToDocument,
  writeAppearancePreferences,
  type AppearanceDocumentRoot,
  type AppearanceStorage,
} from "../client/src/preferences/appearance.js";

class MemoryStorage implements AppearanceStorage {
  value: string | null = null;
  getItem(key: string): string | null {
    return key === APPEARANCE_STORAGE_KEY ? this.value : null;
  }
  setItem(key: string, value: string): void {
    if (key === APPEARANCE_STORAGE_KEY) this.value = value;
  }
}

describe("App appearance preferences", () => {
  it("defaults to system theme without persisting project or Provider data", () => {
    const storage = new MemoryStorage();
    expect(readAppearancePreferences(storage)).toEqual(defaultAppearancePreferences());
    expect(storage.value).toBeNull();
  });

  it("round-trips only the versioned appearance allowlist", () => {
    const storage = new MemoryStorage();
    writeAppearancePreferences(
      {
        version: 1,
        theme: "high_contrast",
        reducedMotion: "on",
        reducedTransparency: true,
      },
      storage,
    );

    expect(readAppearancePreferences(storage)).toEqual({
      version: 1,
      theme: "high_contrast",
      reducedMotion: "on",
      reducedTransparency: true,
    });
    expect(storage.value).not.toContain("project");
    expect(storage.value).not.toContain("provider");
  });

  it("fails safely to defaults when the stored version or enum is invalid", () => {
    const storage = new MemoryStorage();
    storage.value = JSON.stringify({
      version: 99,
      theme: "remote-theme",
      reducedMotion: "maybe",
      reducedTransparency: "yes",
      projectPath: "private",
    });

    expect(readAppearancePreferences(storage)).toEqual(defaultAppearancePreferences());
  });

  it("forces a non-transparent rendered surface in high contrast without rewriting the stored preference", () => {
    const root: AppearanceDocumentRoot = { dataset: {}, style: { colorScheme: "" } };
    applyAppearanceToDocument({ version: 1, theme: "high_contrast", reducedMotion: "system", reducedTransparency: false }, root);
    expect(root.dataset.theme).toBe("high_contrast");
    expect(root.dataset.transparency).toBe("reduced");
  });
});
