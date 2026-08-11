import { watch } from "node:fs";
import { readFileSync, existsSync } from "node:fs";
import type { EffectiveConfig } from "@sestina/schema";
import { EffectiveConfigSchema } from "@sestina/schema";

export type ConfigChangeCallback = (config: EffectiveConfig) => void;

export function watchEffectiveConfig(
  configPath: string,
  onChange: ConfigChangeCallback,
): () => void {
  // Load initial config if it exists
  if (existsSync(configPath)) {
    try {
      const raw: Record<string, unknown> = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
      const parsed = EffectiveConfigSchema.safeParse(raw);
      if (parsed.success) {
        // Initial config loaded successfully, but not calling onChange
        // since caller should already have the initial state
      }
    } catch {
      // Will use builtin defaults until valid config arrives
    }
  }

  // Debounce timer to handle rapid writes
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const watcher = watch(configPath, (eventType) => {
    if (eventType !== "change") return;

    // Debounce rapid successive events
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      try {
        const raw: Record<string, unknown> = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
        const parsed = EffectiveConfigSchema.safeParse(raw);
        if (parsed.success) {
          onChange(parsed.data);
        }
        // Invalid config: keep last-known-good, don't call onChange
      } catch {
        // Invalid JSON: keep last-known-good
      }
    }, 100);
  });

  return () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    watcher.close();
  };
}
