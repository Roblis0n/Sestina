/**
 * RI-10: canonical JSON serialization and stable SHA-256 hashing.
 *
 * Object key order must not matter, array order must; unsupported values
 * and cycles fail with a stable code and never echo the input body.
 */
import { describe, it, expect } from "vitest";
import {
  canonicalStringify,
  stableResearchHash,
} from "../src/index.js";

describe("canonicalStringify", () => {
  it("sorts object keys recursively", () => {
    expect(canonicalStringify({ b: 1, a: 2 })).toEqual({
      ok: true,
      value: '{"a":2,"b":1}',
    });
  });

  it("treats semantically equal objects with different insertion orders as equal", () => {
    const a = canonicalStringify({ z: { y: 1, x: 2 }, a: [3, 2, 1] });
    const b = canonicalStringify({ a: [3, 2, 1], z: { x: 2, y: 1 } });
    expect(a).toEqual(b);
    if (a.ok && b.ok) expect(a.value).toBe(b.value);
  });

  it("keeps array order significant", () => {
    const a = canonicalStringify([1, 2, 3]);
    const b = canonicalStringify([3, 2, 1]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.value).not.toBe(b.value);
  });

  it("handles primitives and nested structures stably", () => {
    expect(canonicalStringify(null)).toEqual({ ok: true, value: "null" });
    expect(canonicalStringify(true)).toEqual({ ok: true, value: "true" });
    expect(canonicalStringify("s")).toEqual({ ok: true, value: '"s"' });
    expect(canonicalStringify({ a: [{ c: 1, b: { d: null } }] })).toEqual({
      ok: true,
      value: '{"a":[{"b":{"d":null},"c":1}]}',
    });
  });
});

describe("unsupported values", () => {
  it("rejects NaN and Infinity", () => {
    expect(canonicalStringify(Number.NaN).ok).toBe(false);
    expect(canonicalStringify(Infinity).ok).toBe(false);
    expect(canonicalStringify({ a: Number.NaN }).ok).toBe(false);
  });

  it("rejects undefined, bigint, functions and symbols", () => {
    expect(canonicalStringify(undefined).ok).toBe(false);
    expect(canonicalStringify({ a: undefined }).ok).toBe(false);
    expect(canonicalStringify([undefined]).ok).toBe(false);
    expect(canonicalStringify(1n).ok).toBe(false);
    expect(canonicalStringify(() => 1).ok).toBe(false);
    expect(canonicalStringify(Symbol("x")).ok).toBe(false);
  });

  it("rejects cyclic structures", () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    const r = canonicalStringify(a);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("canonicalization_failed");
  });

  it("rejects non-JSON object types instead of hashing them as empty objects", () => {
    class ResearchRecord {
      readonly value = 1;
    }

    for (const value of [new Date(0), new Map(), new Set(), new ResearchRecord()]) {
      const r = canonicalStringify(value);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("canonicalization_failed");
    }
  });

  it("rejects sparse arrays rather than emitting invalid JSON", () => {
    const sparse = new Array<unknown>(2);
    sparse[1] = "present";
    const r = canonicalStringify(sparse);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("canonicalization_failed");
  });

  it("rejects accessors without evaluating user code", () => {
    let getterCalls = 0;
    const value = Object.defineProperty({}, "secret", {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error("SUPER_PRIVATE_RESEARCH_SENTINEL");
      },
    });
    const r = canonicalStringify(value);
    expect(r.ok).toBe(false);
    expect(getterCalls).toBe(0);
    if (!r.ok) {
      expect(r.error.code).toBe("canonicalization_failed");
      expect(JSON.stringify(r.error)).not.toContain("SUPER_PRIVATE_RESEARCH_SENTINEL");
    }
  });

  it("error payloads never echo the input body", () => {
    const sentinel = "SUPER_PRIVATE_RESEARCH_SENTINEL";
    // Fails because of the undefined field; the sentinel must not leak.
    const r = canonicalStringify({ leak: sentinel, broken: undefined });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(JSON.stringify(r.error)).not.toContain(sentinel);
    }
  });
});

describe("stableResearchHash", () => {
  it("returns a 64 char lowercase hex digest", () => {
    const r = stableResearchHash({ a: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("is identical for key-order-equal objects and stable across calls", () => {
    const first = stableResearchHash({ b: 2, a: 1 });
    const second = stableResearchHash({ a: 1, b: 2 });
    const third = stableResearchHash({ a: 1, b: 2 });
    expect(first).toEqual(second);
    expect(second).toEqual(third);
  });

  it("differs when array order differs", () => {
    const a = stableResearchHash({ items: [1, 2] });
    const b = stableResearchHash({ items: [2, 1] });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.value).not.toBe(b.value);
  });

  it("matches a handwritten expected digest", () => {
    // SHA-256 of the canonical string {"a":1}
    const r = stableResearchHash({ a: 1 });
    expect(r).toEqual({
      ok: true,
      value: "015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862",
    });
  });

  it("propagates canonicalization failures", () => {
    const r = stableResearchHash({ a: Number.NaN });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("canonicalization_failed");
  });
});
