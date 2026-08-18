/**
 * RI-09: public API surface of @sestina/research.
 *
 * The package must expose its domain primitives (result helpers, Clock port,
 * IdFactory port, deterministic fakes) from the package root only, and every
 * error branch must be distinguishable through a stable `code`.
 */
import { describe, it, expect } from "vitest";
import {
  ok,
  err,
  researchError,
  FixedClock,
  SequenceIdFactory,
  type Clock,
  type IdFactory,
  type ResearchResult,
  type ResearchError,
  type ResearchErrorCode,
} from "../src/index.js";

describe("result helpers", () => {
  it("ok() wraps a value", () => {
    const r: ResearchResult<number> = ok(41);
    expect(r).toEqual({ ok: true, value: 41 });
  });

  it("err() wraps an error and consumers branch on the stable code", () => {
    const r = err(researchError("version_conflict"));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("version_conflict");
      // Error text is never used for control flow.
      switch (r.error.code) {
        case "version_conflict":
          break;
        default:
          throw new Error("unexpected code branch");
      }
    }
  });

  it("errors carry only safe scalar details", () => {
    const e: ResearchError = researchError("invalid_entity_version", {
      actual: "number",
    });
    expect(e.code).toBe("invalid_entity_version");
    expect(e.details).toEqual({ actual: "number" });
    const codes: ResearchErrorCode[] = ["invalid_entity_version"];
    expect(codes).toContain(e.code);
  });
});

describe("FixedClock", () => {
  it("returns the same instant on every call", () => {
    const clock: Clock = new FixedClock("2026-08-18T10:00:00.000Z");
    const first = clock.now();
    const second = clock.now();
    expect(first.toISOString()).toBe("2026-08-18T10:00:00.000Z");
    expect(second.toISOString()).toBe("2026-08-18T10:00:00.000Z");
  });

  it("is not polluted when callers mutate a returned Date", () => {
    const clock = new FixedClock("2026-08-18T10:00:00.000Z");
    const leaked = clock.now();
    leaked.setFullYear(1999);
    expect(clock.now().toISOString()).toBe("2026-08-18T10:00:00.000Z");
  });
});

describe("SequenceIdFactory", () => {
  it("creates prefixed ids with a 26 char uppercase Crockford suffix", () => {
    const factory: IdFactory = new SequenceIdFactory();
    const id = factory.create("rprj_");
    expect(id).toMatch(/^rprj_[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("is deterministic for a given seed", () => {
    const a = new SequenceIdFactory(7);
    const b = new SequenceIdFactory(7);
    expect(a.create("rdec_")).toBe(b.create("rdec_"));
    expect(a.create("rdec_")).not.toBe(a.create("rdec_"));
  });

  it("advances monotonically within one factory", () => {
    const factory = new SequenceIdFactory();
    const first = factory.create("riss_");
    const second = factory.create("riss_");
    const third = factory.create("riss_");
    expect(first < second).toBe(true);
    expect(second < third).toBe(true);
  });
});
