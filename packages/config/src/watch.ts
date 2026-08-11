import { watch, readFileSync, existsSync } from "node:fs";
import type { EffectiveConfig } from "@sestina/schema";
import { EffectiveConfigSchema } from "@sestina/schema";

export interface ConfigWatchError {
  filePath: string;
  message: string;
  fieldErrors?: string[];
}

export type ConfigChangeCallback = (config: EffectiveConfig) => void;
export type ConfigErrorCallback = (error: ConfigWatchError) => void;

/** Injectable filesystem watcher interface — swap for fake in tests. */
export interface FsWatcher {
  onEvent: (handler: (eventType: "change" | "rename") => void) => void;
  onError: (handler: (err: Error) => void) => void;
  close: () => void;
}

/** Create a real fs.watch-based watcher. */
export function createRealWatcher(filePath: string): FsWatcher {
  const w = watch(filePath, (eventType) => {
    if (eventType === "change" || (eventType as string) === "rename") {
      for (const h of changeHandlers) h(eventType);
    }
  });
  const changeHandlers: ((eventType: "change" | "rename") => void)[] = [];
  const errorHandlers: ((err: Error) => void)[] = [];
  w.on("error", (err) => { for (const h of errorHandlers) h(err); });
  return {
    onEvent(handler) { changeHandlers.push(handler); },
    onError(handler) { errorHandlers.push(handler); },
    close() { w.close(); },
  };
}

/**
 * Watch a config file using event-driven fs.watch (no polling).
 * Uses last-known-good: invalid config keeps previous state, valid triggers onChange.
 * Validation errors reported via onError.
 *
 * @param watcherFactory - injected factory; use createRealWatcher in production, fake in tests
 */
export function watchEffectiveConfig(
  configPath: string,
  onChange: ConfigChangeCallback,
  onError?: ConfigErrorCallback,
  watcherFactory: (path: string) => FsWatcher = createRealWatcher,
): () => void {
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
        onError({ filePath: configPath, message: "Config validation failed; keeping last-known-good", fieldErrors });
      }
    } catch (err) {
      if (onError) {
        onError({ filePath: configPath, message: `Config error: ${err instanceof Error ? err.message : String(err)}; keeping last-known-good` });
      }
    }
  };

  let fsWatcher: FsWatcher | null = null;
  let stopped = false;

  const startFsWatcher = (): void => {
    if (stopped) return;
    try {
      if (!existsSync(configPath)) {
        // File doesn't exist yet — retry after delay (file may be created later)
        setTimeout(startFsWatcher, 1000);
        return;
      }
      fsWatcher = watcherFactory(configPath);
      fsWatcher.onEvent(() => { reload(); });
      fsWatcher.onError(() => {
        // Watcher error (e.g., file deleted) — close, retry later
        try { fsWatcher?.close(); } catch { /* ignore */ }
        fsWatcher = null;
        if (!stopped) setTimeout(startFsWatcher, 1000);
      });
    } catch {
      // File may have been deleted between check and watch
      setTimeout(startFsWatcher, 1000);
    }
  };

  startFsWatcher();

  return () => {
    stopped = true;
    try { fsWatcher?.close(); } catch { /* ignore */ }
  };
}
