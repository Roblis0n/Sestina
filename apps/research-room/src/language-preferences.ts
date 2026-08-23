import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, posix, win32 } from "node:path";

export type AppLanguage = "zh-CN" | "en";

export interface LanguagePreferenceStore {
  readLanguage(): Promise<AppLanguage | undefined>;
  writeLanguage(language: AppLanguage): Promise<void>;
}

interface PreferenceDocument {
  readonly schemaVersion: "1.0.0";
  readonly language: AppLanguage;
}

export interface DefaultLanguagePreferencePathOptions {
  readonly platform?: NodeJS.Platform;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly homeDirectory?: string;
}

export interface FileLanguagePreferenceStoreOptions {
  readonly filePath: string;
}

export function isAppLanguage(value: unknown): value is AppLanguage {
  return value === "zh-CN" || value === "en";
}

function parsePreference(raw: string): PreferenceDocument | undefined {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return undefined; }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== 2 || keys[0] !== "language" || keys[1] !== "schemaVersion") return undefined;
  if (record.schemaVersion !== "1.0.0" || !isAppLanguage(record.language)) return undefined;
  return { schemaVersion: "1.0.0", language: record.language };
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export function resolveDefaultLanguagePreferencePath(options: DefaultLanguagePreferencePathOptions = {}): string {
  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  const homeDirectory = options.homeDirectory ?? homedir();
  if (platform === "win32") {
    const appData = environment.LOCALAPPDATA?.trim() ?? win32.join(homeDirectory, "AppData", "Local");
    return win32.join(appData, "Sestina", "preferences.json");
  }
  if (platform === "darwin") return posix.join(homeDirectory.replaceAll("\\", "/"), "Library", "Application Support", "Sestina", "preferences.json");
  const config = environment.XDG_CONFIG_HOME?.trim() ?? posix.join(homeDirectory.replaceAll("\\", "/"), ".config");
  return posix.join(config, "sestina", "preferences.json");
}

export function createFileLanguagePreferenceStore(options: FileLanguagePreferenceStoreOptions): LanguagePreferenceStore {
  const filePath = options.filePath;
  let writes = Promise.resolve();
  return Object.freeze({
    async readLanguage(): Promise<AppLanguage | undefined> {
      let raw: string;
      try { raw = await readFile(filePath, "utf8"); }
      catch (error) { if (isMissing(error)) return undefined; throw error; }
      return parsePreference(raw)?.language;
    },
    writeLanguage(language: AppLanguage): Promise<void> {
      const action = async () => {
        if (!isAppLanguage(language)) throw new Error("Unsupported App language.");
        const directory = dirname(filePath);
        await mkdir(directory, { recursive: true });
        const staged = join(directory, `.preferences.${randomBytes(12).toString("hex")}.tmp`);
        const document: PreferenceDocument = { schemaVersion: "1.0.0", language };
        try {
          await writeFile(staged, `${JSON.stringify(document)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
          await rename(staged, filePath);
        } catch (error) {
          await rm(staged, { force: true }).catch(() => undefined);
          throw error;
        }
      };
      const result = writes.then(action, action);
      writes = result.catch(() => undefined);
      return result;
    },
  });
}
