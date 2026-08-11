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

export function watchEffectiveConfig(
  configPath: string,
  onChange: ConfigChangeCallback,
  onError?: ConfigErrorCallback,
): () => void {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function attemptReload(): void {
    // Debounce rapid successive events
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      try {
        if (!existsSync(configPath)) return;
        const raw: Record<string, unknown> = JSON.parse(
          readFileSync(configPath, "utf8"),
        ) as Record<string, unknown>;
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
            message: `Config parse error: ${err instanceof Error ? err.message : String(err)}; keeping last-known-good`,
          });
        }
      }
    }, 150);
  }

  let watcher: ReturnType<typeof watch> | null = null;

  function startWatcher(): void {
    try {
      if (watcher) watcher.close();

      if (!existsSync(configPath)) {
        // File does not exist yet; retry after delay
        setTimeout(startWatcher, 1000);
        return;
      }

      watcher = watch(configPath, () => {
        attemptReload();
      });

      watcher.on("error", (err) => {
        if (onError) {
          onError({
            filePath: configPath,
            message: `File watcher error: ${err.message}`,
          });
        }
        // Restart watcher after error
        watcher?.close();
        setTimeout(startWatcher, 1000);
      });
    } catch {
      // File may not exist; retry later
      setTimeout(startWatcher, 1000);
    }
  }

  startWatcher();

  return () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (watcher) watcher.close();
  };
}
