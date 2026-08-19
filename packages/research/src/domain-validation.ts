import type { Clock } from "./clock.js";
import { researchError } from "./errors.js";
import { err, ok } from "./result.js";
import type { ResearchResult } from "./result.js";
import { validateUtcTimestamp } from "./authority/source.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function readClock(clock: Clock): ResearchResult<string> {
  try {
    const value = clock.now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      return err(researchError("invalid_timestamp"));
    }
    return validateUtcTimestamp(value.toISOString());
  } catch {
    return err(researchError("invalid_timestamp"));
  }
}

export function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && "value" in descriptor) deepFreeze(descriptor.value);
  }
  return Object.freeze(value);
}

export function cloneFrozen<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

export function parseSafeRelativePath(
  value: unknown,
  options: { allowRoot?: boolean } = {},
): ResearchResult<string> {
  if (!isNonBlankString(value) || value.includes("\0")) {
    return err(researchError("unsafe_relative_path"));
  }
  const normalized = value.replace(/\\/g, "/");
  if (
    normalized.startsWith("/") ||
    normalized.startsWith("//") ||
    /^[A-Za-z]:/.test(normalized)
  ) {
    return err(researchError("unsafe_relative_path"));
  }
  if (options.allowRoot === true && normalized === ".") return ok(".");
  const segments = normalized.split("/");
  if (segments.some((part) => part.length === 0 || part === "." || part === "..")) {
    return err(researchError("unsafe_relative_path"));
  }
  return ok(segments.join("/"));
}
