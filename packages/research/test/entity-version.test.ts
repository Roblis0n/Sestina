/**
 * RI-10: entity version primitive.
 *
 * Versions are branded positive safe integers starting at 1 and advancing
 * by exactly one under compare-and-swap. Stale expectations fail with the
 * stable VERSION_CONFLICT code.
 */
import { describe, it, expect } from "vitest";
import {
  initialEntityVersion,
  parseEntityVersion,
  advanceEntityVersion,
  type EntityVersion,
} from "../src/index.js";

describe("initialEntityVersion", () => {
  it("starts at 1", () => {
    const v: EntityVersion = initialEntityVersion();
    expect(parseEntityVersion(v)).toEqual({ ok: true, value: v });
    expect(v as number).toBe(1);
  });
});

describe("advanceEntityVersion", () => {
  it("advances from N to N+1 when the expectation matches", () => {
    const v1 = initialEntityVersion();
    const r = advanceEntityVersion(v1, v1);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value as number).toBe(2);
  });

  it("advances twice in a row", () => {
    let current = initialEntityVersion();
    const step1 = advanceEntityVersion(current, current);
    expect(step1.ok).toBe(true);
    if (step1.ok) {
      current = step1.value;
      const step2 = advanceEntityVersion(current, current);
      expect(step2.ok).toBe(true);
      if (step2.ok) expect(step2.value as number).toBe(3);
    }
  });

  it("returns VERSION_CONFLICT for a stale expected version", () => {
    const v1 = initialEntityVersion();
    const stepped = advanceEntityVersion(v1, v1);
    expect(stepped.ok).toBe(true);
    if (!stepped.ok) return;
    const v2 = stepped.value;
    // Caller still expects v1 while the entity is at v2.
    const stale = advanceEntityVersion(v2, v1);
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.error.code).toBe("version_conflict");
    }
    // The current version is unchanged by the failure.
    expect(v2 as number).toBe(2);
  });

  it("rejects forged invalid branded values at the public boundary", () => {
    const valid = initialEntityVersion();
    const invalidCurrent = advanceEntityVersion(0 as EntityVersion, valid);
    expect(invalidCurrent.ok).toBe(false);
    if (!invalidCurrent.ok) {
      expect(invalidCurrent.error.code).toBe("invalid_entity_version");
    }

    const invalidExpected = advanceEntityVersion(valid, 0 as EntityVersion);
    expect(invalidExpected.ok).toBe(false);
    if (!invalidExpected.ok) {
      expect(invalidExpected.error.code).toBe("invalid_entity_version");
    }
  });
});

describe("parseEntityVersion rejections", () => {
  it("rejects 0, negatives, fractions, NaN, Infinity and unsafe integers", () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      const r = parseEntityVersion(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("invalid_entity_version");
    }
  });

  it("rejects non-number input", () => {
    expect(parseEntityVersion("1").ok).toBe(false);
    expect(parseEntityVersion(null).ok).toBe(false);
    expect(parseEntityVersion(undefined).ok).toBe(false);
  });

  it("accepts every safe positive integer round-trip", () => {
    const r = parseEntityVersion(Number.MAX_SAFE_INTEGER);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value as number).toBe(Number.MAX_SAFE_INTEGER);
  });
});
