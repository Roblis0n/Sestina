import type { ConfigLayers, EffectiveConfig, ConfigSourceMap } from "@sestina/schema";
import { EffectiveConfigSchema } from "@sestina/schema";
import { BUILTIN_DEFAULTS, getDefaultSourceMap } from "./defaults.js";
import { mergeConfigs } from "./merge.js";

export interface LoadedConfig {
  value: EffectiveConfig;
  sources: ConfigSourceMap;
}

export function loadEffectiveConfig(
  layers: ConfigLayers,
): LoadedConfig {
  const sources = getDefaultSourceMap();
  const missingFields: string[] = [];

  // Start with builtin defaults
  let effective: Record<string, unknown> = structuredClone(BUILTIN_DEFAULTS);

  // Merge layers in priority order (lowest first): env -> user -> project -> contract -> request
  const layerOrder = [
    { key: "env" as const, source: "env" as const },
    { key: "user" as const, source: "user" as const },
    { key: "project" as const, source: "project" as const },
    { key: "contract" as const, source: "contract" as const },
    { key: "request" as const, source: "request" as const },
  ];

  for (const { key, source } of layerOrder) {
    const layer = layers[key];
    if (layer && Object.keys(layer).length > 0) {
      // Filter out forbidden fields from project config
      const filtered = key === "project" ? filterProjectConfig(layer) : layer;
      if (Object.keys(filtered).length > 0) {
        try {
          effective = mergeConfigs(effective, filtered, source, sources);
        } catch {
          missingFields.push(`${key} layer merge failed`);
        }
      }
    }
  }

  // Validate final config
  const parseResult = EffectiveConfigSchema.safeParse(effective);
  const value: EffectiveConfig = parseResult.success
    ? parseResult.data
    : structuredClone({ ...BUILTIN_DEFAULTS, missingFields: [...missingFields, "schema validation failed"] });

  // Append any layer merge failures to missingFields
  if (missingFields.length > 0) {
    value.missingFields = [...value.missingFields, ...missingFields];
  }

  return { value, sources };
}

// Forbidden key patterns in project config (case-insensitive match)
const FORBIDDEN_KEY_PATTERNS = /^(api[_-]?key|api[_-]?keys|api[_-]?secret|credential|credentials?|secret|secrets?|token|tokens?|password|passwd|auth|authorization|jwt|private[_-]?key|access[_-]?key|secret[_-]?key|bearer|connection[_-]?string|cert|certificate|hook|hooks|command|script|exec|execute|shell|run|system[_-]?prompt|judge[_-]?prompt|judge[_-]?config|judge[_-]?rules)$/i;

function isForbiddenKey(key: string): boolean {
  return FORBIDDEN_KEY_PATTERNS.test(key);
}

function filterProjectConfig(
  layer: Record<string, unknown>,
): Record<string, unknown> {
  return recursiveFilter(layer) as Record<string, unknown>;
}

function recursiveFilter(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map(recursiveFilter);
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const filtered: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      if (!isForbiddenKey(key)) {
        filtered[key] = recursiveFilter(val);
      }
    }
    return filtered;
  }
  return value;
}
