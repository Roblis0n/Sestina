/**
 * Deterministic JSON serialization with sorted keys.
 * Used for hash computation across preview and atomic-write to ensure
 * identical hashes regardless of object key insertion order.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, sortedKeysReplacer);
}

function sortedKeysReplacer(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(value).sort();
    for (const k of keys) {
      sorted[k] = (value as Record<string, unknown>)[k];
    }
    return sorted;
  }
  return value;
}
