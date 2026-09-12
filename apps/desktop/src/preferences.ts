import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  open,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
export interface DesktopPreferences {
  format: "1.0.0";
  language: "en" | "zh-CN";
  appearance: {
    version: 1;
    theme: "system" | "light" | "dark" | "high_contrast";
    reducedMotion: "system" | "on" | "off";
    reducedTransparency: boolean;
  };
  recentProjects: string[];
}
export function parseDesktopPreferences(value: unknown): DesktopPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("preferences_invalid");
  const p = value as Record<string, unknown>;
  const a = p.appearance as Record<string, unknown> | undefined;
  if (
    Object.keys(p).sort().join(",") !==
      "appearance,format,language,recentProjects" ||
    p.format !== "1.0.0" ||
    !["en", "zh-CN"].includes(String(p.language)) ||
    !a ||
    typeof a !== "object" ||
    Array.isArray(a) ||
    Object.keys(a).sort().join(",") !==
      "reducedMotion,reducedTransparency,theme,version" ||
    a.version !== 1 ||
    !["system", "light", "dark", "high_contrast"].includes(String(a.theme)) ||
    !["system", "on", "off"].includes(String(a.reducedMotion)) ||
    typeof a.reducedTransparency !== "boolean" ||
    !Array.isArray(p.recentProjects) ||
    p.recentProjects.length > 8 ||
    p.recentProjects.some(
      (path) =>
        typeof path !== "string" ||
        path.length < 1 ||
        path.length > 4096 ||
        Array.from(path, (character) => character.charCodeAt(0)).some(
          (code) => code < 32,
        ),
    )
  )
    throw Error("preferences_invalid");
  return structuredClone(p) as unknown as DesktopPreferences;
}
export class DesktopPreferenceStore {
  #writes = Promise.resolve();
  constructor(private readonly directory: string) {}
  async root() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const info = await lstat(this.directory);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (await realpath(this.directory)) !== resolve(this.directory)
    )
      throw Error("preferences_path_changed");
  }
  async read(): Promise<DesktopPreferences> {
    const fallback: DesktopPreferences = {
      format: "1.0.0",
      language: "zh-CN",
      appearance: {
        version: 1,
        theme: "system",
        reducedMotion: "system",
        reducedTransparency: false,
      },
      recentProjects: [],
    };
    const path = join(this.directory, "preferences.json");
    const info = await lstat(path).catch(() => undefined);
    if (!info) return fallback;
    if (!info.isFile() || info.isSymbolicLink() || info.size > 65536)
      throw Error("preferences_invalid");
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    if (
      value &&
      typeof value === "object" &&
      Object.keys(value).join(",") === "language" &&
      ["en", "zh-CN"].includes(
        String((value as { language: unknown }).language),
      )
    )
      return {
        ...fallback,
        language: (value as { language: DesktopPreferences["language"] })
          .language,
      };
    return parseDesktopPreferences(value);
  }
  update(patch: Partial<Omit<DesktopPreferences, "format">>) {
    const action = async () => {
      await this.root();
      const next = parseDesktopPreferences({
        ...(await this.read()),
        ...patch,
      });
      const temporary = join(
        this.directory,
        `.preferences-${randomUUID()}.tmp`,
      );
      try {
        const handle = await open(temporary, "wx", 0o600);
        try {
          await handle.writeFile(JSON.stringify(next));
          await handle.sync();
        } finally {
          await handle.close();
        }
        await this.root();
        await rename(temporary, join(this.directory, "preferences.json"));
        return next;
      } finally {
        await rm(temporary, { force: true });
      }
    };
    const result = this.#writes.then(action, action);
    this.#writes = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
