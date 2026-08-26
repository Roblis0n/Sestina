import type { MotionPreference, ThemePreference } from "../api/dto.js";

export const APPEARANCE_STORAGE_KEY = "sestina.app.appearance.v1";

export interface AppearancePreferences {
  readonly version: 1;
  readonly theme: ThemePreference;
  readonly reducedMotion: MotionPreference;
  readonly reducedTransparency: boolean;
}

export interface AppearanceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface AppearanceDocumentRoot {
  readonly dataset: {
    theme?: string;
    motion?: string;
    transparency?: string;
  };
  readonly style: {
    colorScheme: string;
  };
}

export function defaultAppearancePreferences(): AppearancePreferences {
  return Object.freeze({
    version: 1,
    theme: "system",
    reducedMotion: "system",
    reducedTransparency: false,
  });
}

function isAppearancePreferences(value: unknown): value is AppearancePreferences {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    Object.keys(candidate).every((key) => ["reducedMotion", "reducedTransparency", "theme", "version"].includes(key)) &&
    candidate.version === 1 &&
    ["system", "light", "dark", "high_contrast"].includes(String(candidate.theme)) &&
    ["system", "on", "off"].includes(String(candidate.reducedMotion)) &&
    typeof candidate.reducedTransparency === "boolean"
  );
}

function browserStorage(): AppearanceStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function readAppearancePreferences(storage = browserStorage()): AppearancePreferences {
  if (!storage) return defaultAppearancePreferences();
  try {
    const raw = storage.getItem(APPEARANCE_STORAGE_KEY);
    if (raw === null) return defaultAppearancePreferences();
    const parsed: unknown = JSON.parse(raw);
    return isAppearancePreferences(parsed) ? Object.freeze({ ...parsed }) : defaultAppearancePreferences();
  } catch {
    return defaultAppearancePreferences();
  }
}

export function writeAppearancePreferences(preferences: AppearancePreferences, storage = browserStorage()): void {
  if (!storage || !isAppearancePreferences(preferences)) return;
  try {
    storage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // The App remains usable with safe defaults when browser preference storage is unavailable.
  }
}

export function applyAppearanceToDocument(preferences: AppearancePreferences, documentRoot: AppearanceDocumentRoot = document.documentElement): void {
  documentRoot.dataset.theme = preferences.theme;
  documentRoot.dataset.motion = preferences.reducedMotion;
  documentRoot.dataset.transparency = preferences.reducedTransparency || preferences.theme === "high_contrast" ? "reduced" : "normal";
  documentRoot.style.colorScheme = preferences.theme === "dark" || preferences.theme === "high_contrast" ? "dark" : preferences.theme === "light" ? "light" : "light dark";
}
