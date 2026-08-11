import { describe, it, expect } from "vitest";
import { resolvePlatformPaths } from "../src/index.js";

describe("Platform paths", () => {

  it("returns Windows paths under LOCALAPPDATA when platform is win32", () => {
    const env: Record<string, string | undefined> = {
      LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local",
    };
    const paths = resolvePlatformPaths(env, "win32");
    expect(paths.dataDir).toBe("C:\\Users\\test\\AppData\\Local\\Sestina\\data");
    expect(paths.configDir).toBe("C:\\Users\\test\\AppData\\Local\\Sestina\\config");
  });

  it("returns macOS paths under Library/Application Support", () => {
    const env: Record<string, string | undefined> = {
      HOME: "/Users/test",
    };
    const paths = resolvePlatformPaths(env, "darwin");
    expect(paths.dataDir).toBe("/Users/test/Library/Application Support/Sestina/data");
    expect(paths.configDir).toBe("/Users/test/Library/Application Support/Sestina/config");
  });

  it("returns Linux paths under XDG directories", () => {
    const env: Record<string, string | undefined> = {
      HOME: "/home/test",
    };
    const paths = resolvePlatformPaths(env, "linux");
    expect(paths.dataDir).toBe("/home/test/.local/share/sestina");
    expect(paths.configDir).toBe("/home/test/.config/sestina");
  });

  it("respects SESTINA_DATA_DIR and SESTINA_CONFIG_DIR overrides", () => {
    const env: Record<string, string | undefined> = {
      LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local",
      SESTINA_DATA_DIR: "D:\\custom\\data",
      SESTINA_CONFIG_DIR: "D:\\custom\\config",
    };
    const paths = resolvePlatformPaths(env, "win32");
    expect(paths.dataDir).toBe("D:\\custom\\data");
    expect(paths.configDir).toBe("D:\\custom\\config");
  });

  it("rejects file targets as data/config directories", () => {
    const env: Record<string, string | undefined> = {
      SESTINA_DATA_DIR: "C:\\some\\file.txt",
    };
    expect(() => resolvePlatformPaths(env, "win32")).toThrow();
  });

  it("rejects SESTINA_HOME as ambiguous", () => {
    const env: Record<string, string | undefined> = {
      SESTINA_HOME: "/custom/sestina",
    };
    // Should NOT use SESTINA_HOME, fall back to platform defaults
    const paths = resolvePlatformPaths(env, "linux");
    expect(paths.dataDir).not.toContain("SESTINA_HOME");
    expect(paths.dataDir).toContain(".local/share/sestina");
  });
});
