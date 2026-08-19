export type YamlRecord = Readonly<Record<string, unknown>>;

function scalar(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "";
  try { return JSON.parse(trimmed) as unknown; } catch { return trimmed; }
}

/** Strict top-level YAML subset used by Sestina projections.
 * Nested arrays/objects use JSON syntax, which is valid YAML 1.2.
 */
export function parseProjectionYaml(content: string): YamlRecord | undefined {
  const result: Record<string, unknown> = {};
  for (const rawLine of content.replaceAll("\r\n", "\n").split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const separator = line.indexOf(":");
    if (separator < 1) return undefined;
    const key = line.slice(0, separator).trim();
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key) || Object.hasOwn(result, key)) return undefined;
    result[key] = scalar(line.slice(separator + 1));
  }
  return result;
}
