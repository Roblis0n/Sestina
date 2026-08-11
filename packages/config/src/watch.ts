import { watch, readFileSync, existsSync } from "node:fs";
import { dirname, basename } from "node:path";
import type { EffectiveConfig } from "@sestina/schema";
import { EffectiveConfigSchema } from "@sestina/schema";

export interface ConfigWatchError {
  filePath: string;
  message: string;
  fieldErrors?: string[];
}

export type ConfigChangeCallback = (config: EffectiveConfig) => void;
export type ConfigErrorCallback = (error: ConfigWatchError) => void;

/** Injectable filesystem watcher — swap for fake in tests. */
export interface FsWatcher {
  /** Register a handler for filesystem events. Receives (filename, eventType). */
  onEvent: (handler: (filename: string, eventType: "change" | "rename") => void) => void;
  onError: (handler: (err: Error) => void) => void;
  close: () => void;
}

/** Create a real watcher on the parent directory. */
export function createRealWatcher(filePath: string): FsWatcher {
  const dir = dirname(filePath);
  const changeHandlers: ((filename: string, eventType: "change" | "rename") => void)[] = [];
  const errorHandlers: ((err: Error) => void)[] = [];

  const w = watch(dir, (eventType, filename) => {
    for (const h of changeHandlers) h(filename ?? "", eventType);
  });
  w.on("error", (err) => { for (const h of errorHandlers) h(err); });
  return {
    onEvent(handler) { changeHandlers.push(handler); },
    onError(handler) { errorHandlers.push(handler); },
    close() { w.close(); },
  };
}

/**
 * Watch a config file via its parent directory (handles atomic replace,
 * delete/recreate, and ignores unrelated files). Event-driven — no polling.
 * Uses last-known-good: invalid config triggers onError, not onChange.
 */
export function watchEffectiveConfig(
  configPath: string,
  onChange: ConfigChangeCallback,
  onError?: ConfigErrorCallback,
  watcherFactory: (path: string) => FsWatcher = createRealWatcher,
): () => void {
  let stopped = false;
  let fsWatcher: FsWatcher | null = null;
  const targetName = basename(configPath);

  const reload = (): void => {
    try {
      if (!existsSync(configPath)) return;
      const raw: Record<string, unknown> = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
      const parsed = EffectiveConfigSchema.safeParse(raw);
      if (parsed.success) {
        onChange(parsed.data);
      } else if (onError) {
        const fieldErrors = parsed.error.issues.map(
          (issue) => `${issue.path.join(".")}: ${issue.message}`,
        );
        onError({
          filePath: configPath,
          message: "Config validation failed; keeping last-known-good",
          fieldErrors,
        });
      }
    } catch (err) {
      if (onError) {
        onError({
          filePath: configPath,
          message: `Config error: ${err instanceof Error ? err.message : String(err)}; keeping last-known-good`,
        });
      }
    }
  };

  const startFsWatcher = (): void => {
    if (stopped) return;
    try {
      fsWatcher = watcherFactory(configPath);
      fsWatcher.onEvent((filename) => {
        if (filename === targetName) reload();
      });
      fsWatcher.onError(() => {
        try { fsWatcher?.close(); } catch { /* ignore */ }
        fsWatcher = null;
        setTimeout(startFsWatcher, 1000);
      });
    } catch {
      setTimeout(startFsWatcher, 1000);
    }
  };

  startFsWatcher();

  return () => {
    stopped = true;
    try { fsWatcher?.close(); } catch { /* ignore */ }
  };
}
