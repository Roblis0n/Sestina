import type { ConfigSourceMap, ConfigLayerSource } from "@sestina/schema";

/**
 * Deep-merge `override` into `base`, tracking the source of each leaf field.
 * Later layers override earlier ones. Arrays are replaced, not merged.
 */
export function mergeConfigs(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
  source: ConfigLayerSource,
  sources: ConfigSourceMap,
  prefix = "",
): Record<string, unknown> {
  const result = { ...base };

  for (const [key, value] of Object.entries(override)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      // Recursively merge nested objects
      const baseVal = base[key];
      const baseObj =
        baseVal !== null && typeof baseVal === "object" && !Array.isArray(baseVal)
          ? (baseVal as Record<string, unknown>)
          : {};
      result[key] = mergeConfigs(
        baseObj,
        value as Record<string, unknown>,
        source,
        sources,
        fullKey,
      );
    } else {
      // Leaf value: override
      result[key] = value;
      sources[fullKey] = source;
    }
  }

  return result;
}
