import { createHash } from "node:crypto";
import { resolve, isAbsolute, basename, posix, win32 } from "node:path";
import { SestinaErrorCode, SestinaError } from "@sestina/schema";

export interface SestinaPaths {
  dataDir: string;
  configDir: string;
  configFile: string;
}

const isWindows = (p: NodeJS.Platform): boolean => p === "win32";
const isMac = (p: NodeJS.Platform): boolean => p === "darwin";

export function resolvePlatformPaths(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform,
): SestinaPaths {
  // Check explicit overrides first
  const dataOverride = env.SESTINA_DATA_DIR;
  const configOverride = env.SESTINA_CONFIG_DIR;

  // Reject ambiguous SESTINA_HOME
  if (env.SESTINA_HOME !== undefined && !dataOverride && !configOverride) {
    throw new SestinaError(
      SestinaErrorCode.validation_failed,
      "SESTINA_HOME is ambiguous; use SESTINA_DATA_DIR and/or SESTINA_CONFIG_DIR instead.",
    );
  }

  let dataDir: string;
  let configDir: string;

  if (dataOverride) {
    validateDirectoryPath(dataOverride, "SESTINA_DATA_DIR");
    dataDir = resolve(dataOverride);
  } else {
    dataDir = resolvePlatformDataDir(env, platform);
  }

  if (configOverride) {
    validateDirectoryPath(configOverride, "SESTINA_CONFIG_DIR");
    configDir = resolve(configOverride);
  } else {
    configDir = resolvePlatformConfigDir(env, platform);
  }

  // Normalize Windows paths
  if (isWindows(platform)) {
    dataDir = normalizeWindowsPath(dataDir);
    configDir = normalizeWindowsPath(configDir);
  }

  return { dataDir, configDir, configFile: resolve(configDir, "config.json") };
}

function resolvePlatformDataDir(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform,
): string {
  if (isWindows(platform)) {
    const localAppData = env.LOCALAPPDATA ?? env.APPDATA ?? "";
    if (!localAppData) throw new SestinaError(SestinaErrorCode.validation_failed,"LOCALAPPDATA not available for Windows path resolution");
    return win32.resolve(localAppData, "Sestina", "data");
  }
  if (isMac(platform)) {
    const home = env.HOME ?? "";
    if (!home) throw new SestinaError(SestinaErrorCode.validation_failed,"HOME not available for macOS path resolution");
    return posix.join(home, "Library", "Application Support", "Sestina", "data");
  }
  // Linux
  const xdgDataHome = env.XDG_DATA_HOME;
  if (xdgDataHome) return posix.join(xdgDataHome, "sestina");
  const home = env.HOME ?? "";
  if (!home) throw new SestinaError(SestinaErrorCode.validation_failed,"HOME not available for Linux path resolution");
  return posix.join(home, ".local", "share", "sestina");
}

function resolvePlatformConfigDir(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform,
): string {
  if (isWindows(platform)) {
    const localAppData = env.LOCALAPPDATA ?? env.APPDATA ?? "";
    if (!localAppData) throw new SestinaError(SestinaErrorCode.validation_failed,"LOCALAPPDATA not available for Windows path resolution");
    return win32.resolve(localAppData, "Sestina", "config");
  }
  if (isMac(platform)) {
    const home = env.HOME ?? "";
    if (!home) throw new SestinaError(SestinaErrorCode.validation_failed,"HOME not available for macOS path resolution");
    return posix.join(home, "Library", "Application Support", "Sestina", "config");
  }
  // Linux
  const xdgConfigHome = env.XDG_CONFIG_HOME;
  if (xdgConfigHome) return posix.join(xdgConfigHome, "sestina");
  const home2 = env.HOME ?? "";
  if (!home2) throw new SestinaError(SestinaErrorCode.validation_failed,"HOME not available for Linux path resolution");
  return posix.join(home2, ".config", "sestina");
}

const WINDOWS_DEVICE_NAMES = new Set([
  "CON", "PRN", "AUX", "NUL",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);

function validateDirectoryPath(
  dirPath: string,
  variableName: string,
): void {
  // Reject path traversal attempts
  if (dirPath.includes("..")) {
    throw new SestinaError(SestinaErrorCode.validation_failed,`${variableName} must not contain path traversal segments`);
  }

  // Reject Windows device paths (check before isAbsolute since "NUL" is not absolute)
  const base = basename(dirPath).toUpperCase();
  const nameWithoutExt = base.includes(".") ? base.split(".")[0] : base;
  if (nameWithoutExt && WINDOWS_DEVICE_NAMES.has(nameWithoutExt)) {
    throw new SestinaError(SestinaErrorCode.validation_failed,`${variableName} must not be a reserved device name`);
  }

  if (!isAbsolute(dirPath)) {
    throw new SestinaError(SestinaErrorCode.validation_failed,`${variableName} must be an absolute path`);
  }
}

function normalizeWindowsPath(p: string): string {
  return p.replace(/\//g, "\\");
}

export function hashPath(path: string): string {
  return createHash("sha256").update(path).digest("hex");
}
