import { readFileSync, existsSync, statSync } from "node:fs";
import type { EffectiveConfig } from "@sestina/schema";
import { EffectiveConfigSchema } from "@sestina/schema";

export interface ConfigWatchError {
  filePath: string;
  message: string;
  fieldErrors?: string[];
}

export type ConfigChangeCallback = (config: EffectiveConfig) => void;
export type ConfigErrorCallback = (error: ConfigWatchError) => void;

/**
 * Watch a config file using interval-based stat polling (500ms).
 * Uses last-known-good: invalid config keeps previous state, valid triggers onChange.
 * Validation errors reported via onError.
 */
export function watchEffectiveConfig(
  configPath: string,
  onChange: ConfigChangeCallback,
  onError?: ConfigErrorCallback,
): () => void {
  let lastMtimeMs = existsSync(configPath)
    ? statSync(configPath).mtimeMs
    : 0;

  const interval = setInterval(() => {
    try {
      if (!existsSync(configPath)) return;
      const currentMtime = statSync(configPath).mtimeMs;
      if (currentMtime === lastMtimeMs) return;
      lastMtimeMs = currentMtime;

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
          message: `Config error: ${err instanceof Error ? err.message : String(err)}; keeping last-known-good`,
        });
      }
    }
  }, 500);

  return () => {
    clearInterval(interval);
  };
}
