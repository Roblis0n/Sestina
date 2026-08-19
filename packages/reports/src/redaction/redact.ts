import { truncateUtf8 } from "../limits.js";

const WINDOWS_PATH = /\b[A-Za-z]:[\\/](?:[^\s<>"'`|]+[\\/]?)+/g;
const UNC_PATH = /(?:\\\\|\/\/|\\)(?:[^\\/\s<>"'`|]+[\\/])+(?:[^\\/\s<>"'`|]+)/g;
const HOME_PATH = /~[\\/](?:[^\s<>"'`|]+[\\/]?)+/g;
const UNIX_PATH = /(^|[\s([{"'`])\/(?:Users|home|root|etc|var|tmp|opt|private)(?:\/[^\s<>"'`|)\]}]+)+/g;

export function redactAbsolutePaths(value: string): string {
  return value
    .replace(WINDOWS_PATH, "[redacted-path]")
    .replace(UNC_PATH, "[redacted-path]")
    .replace(HOME_PATH, "[redacted-path]")
    .replace(UNIX_PATH, (_match, prefix: string) => `${prefix}[redacted-path]`);
}

export function redactAndLimit(value: string, maxBytes: number): { readonly text: string; readonly omittedBytes: number } {
  return truncateUtf8(redactAbsolutePaths(value), maxBytes);
}

export function redactUnknownStrings<T>(value: T): T {
  if (typeof value === "string") return redactAbsolutePaths(value) as T;
  if (Array.isArray(value)) return value.map(redactUnknownStrings) as T;
  if (typeof value === "object" && value !== null) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactUnknownStrings(item)])) as T;
  return value;
}
