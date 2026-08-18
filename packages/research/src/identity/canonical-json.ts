/**
 * Deterministic canonical JSON serialization and stable SHA-256 hashing.
 *
 * Object keys are sorted recursively; array order is significant.
 * Unsupported values (undefined, NaN, Infinity, bigint, function, symbol)
 * and cyclic structures fail with the stable `canonicalization_failed`
 * code. Failures never embed the input body.
 */
import { createHash } from "node:crypto";
import { researchError } from "../errors.js";
import { err, ok } from "../result.js";
import type { ResearchResult } from "../result.js";

/** Internal content-free sentinel; never escapes this module. */
class UnsupportedValue extends Error {}

function serialize(value: unknown, seen: Set<object>): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw new UnsupportedValue();
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "bigint":
    case "symbol":
    case "function":
    case "undefined":
      throw new UnsupportedValue();
    case "object": {
      if (seen.has(value)) throw new UnsupportedValue();
      seen.add(value);
      try {
        if (Array.isArray(value)) {
          if (Object.getPrototypeOf(value) !== Array.prototype) {
            throw new UnsupportedValue();
          }
          const items: string[] = [];
          for (let index = 0; index < value.length; index += 1) {
            const descriptor = Object.getOwnPropertyDescriptor(
              value,
              String(index),
            );
            if (descriptor === undefined || !("value" in descriptor)) {
              throw new UnsupportedValue();
            }
            const item: unknown = descriptor.value;
            items.push(serialize(item, seen));
          }
          return `[${items.join(",")}]`;
        }

        const prototype = Reflect.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
          throw new UnsupportedValue();
        }
        const record = value as Record<string, unknown>;
        const descriptors = Object.getOwnPropertyDescriptors(record);
        const keys: string[] = [];
        for (const symbol of Object.getOwnPropertySymbols(record)) {
          const descriptor = Object.getOwnPropertyDescriptor(record, symbol);
          if (descriptor?.enumerable !== true) continue;
          throw new UnsupportedValue();
        }
        for (const key of Object.keys(descriptors)) {
          const descriptor = descriptors[key];
          if (descriptor?.enumerable !== true) continue;
          if (!("value" in descriptor)) throw new UnsupportedValue();
          keys.push(key);
        }
        keys.sort();
        const entries = keys.map((key) => {
          const descriptor = descriptors[key];
          if (descriptor === undefined || !("value" in descriptor)) {
            throw new UnsupportedValue();
          }
          const inner: unknown = descriptor.value;
          if (inner === undefined) throw new UnsupportedValue();
          return `${JSON.stringify(key)}:${serialize(inner, seen)}`;
        });
        return `{${entries.join(",")}}`;
      } finally {
        seen.delete(value);
      }
    }
  }
  throw new UnsupportedValue();
}

export function canonicalStringify(value: unknown): ResearchResult<string> {
  try {
    return ok(serialize(value, new Set()));
  } catch {
    return err(researchError("canonicalization_failed"));
  }
}

export function stableResearchHash(value: unknown): ResearchResult<string> {
  const canonical = canonicalStringify(value);
  if (!canonical.ok) return canonical;
  return ok(
    createHash("sha256").update(canonical.value, "utf8").digest("hex"),
  );
}
