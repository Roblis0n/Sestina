/**
 * RI-10: research id validation.
 *
 * Ids are prefix + 26 Crockford base32 characters. Prefixes are not
 * interchangeable, inputs are never truncated or silently repaired, and
 * the deterministic fake factory output must satisfy the validators.
 */
import { describe, it, expect } from "vitest";
import {
  isResearchId,
  isResearchIdFor,
  parseResearchId,
  parseResearchIdFor,
  SequenceIdFactory,
  type ParsedResearchId,
} from "../src/index.js";

const VALID_SUFFIX = "01ARZ3NDEKTSV4RRFFQ69G5FAV"; // 26 chars, Crockford

const ALL_PREFIXES = [
  "rprj_",
  "rart_",
  "rrev_",
  "repi_",
  "rbrf_",
  "rdec_",
  "riss_",
  "rclm_",
  "revd_",
  "rmec_",
  "rdlt_",
  "rrun_",
  "rfnd_",
  "rsnp_",
] as const;

describe("valid ids for every prefix", () => {
  it.each(ALL_PREFIXES)("accepts a well-formed %s id", (prefix) => {
    const id = prefix + VALID_SUFFIX;
    expect(isResearchId(id)).toBe(true);
    expect(isResearchIdFor(id, prefix)).toBe(true);
    const parsed = parseResearchId(id);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const value: ParsedResearchId = parsed.value;
      expect(value.prefix).toBe(prefix);
      expect(value.suffix).toBe(VALID_SUFFIX);
    }
  });
});

describe("rejections", () => {
  it("rejects an unknown prefix", () => {
    const r = parseResearchId("zzzz_" + VALID_SUFFIX);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invalid_research_id");
  });

  it("rejects a wrong suffix length (short and long)", () => {
    expect(isResearchId("rprj_" + VALID_SUFFIX.slice(0, 25))).toBe(false);
    expect(isResearchId("rprj_" + VALID_SUFFIX + "0")).toBe(false);
  });

  it("rejects non-Crockford characters (I, L, O, U)", () => {
    expect(isResearchId("rprj_" + "I".repeat(26))).toBe(false);
    expect(isResearchId("rprj_" + "L".repeat(26))).toBe(false);
    expect(isResearchId("rprj_" + "O".repeat(26))).toBe(false);
    expect(isResearchId("rprj_" + "U".repeat(26))).toBe(false);
  });

  it("rejects lowercase suffixes", () => {
    expect(isResearchId("rprj_" + VALID_SUFFIX.toLowerCase())).toBe(false);
  });

  it("rejects a project id used as an artifact id", () => {
    const projectId = "rprj_" + VALID_SUFFIX;
    expect(isResearchIdFor(projectId, "rart_")).toBe(false);
    const r = parseResearchIdFor(projectId, "rart_");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("invalid_research_id");
      expect(r.error.details?.expectedPrefix).toBe("rart_");
    }
  });

  it("rejects empty input, null and non-strings", () => {
    expect(isResearchId("")).toBe(false);
    expect(isResearchId(null)).toBe(false);
    expect(isResearchId(undefined)).toBe(false);
    expect(isResearchId(42)).toBe(false);
    expect(isResearchId({ id: "rprj_x" })).toBe(false);
  });
});

describe("fake factory output is validator-clean", () => {
  it("SequenceIdFactory ids pass parseResearchIdFor for their prefix", () => {
    const factory = new SequenceIdFactory();
    for (const prefix of ALL_PREFIXES) {
      const id = factory.create(prefix);
      const parsed = parseResearchIdFor(id, prefix);
      expect(parsed.ok).toBe(true);
      expect(isResearchIdFor(id, prefix)).toBe(true);
    }
  });

  it("the generated sequence is deterministic and non-repeating", () => {
    const a = new SequenceIdFactory(100);
    const b = new SequenceIdFactory(100);
    const firstRun = [a.create("rprj_"), a.create("rprj_"), a.create("rprj_")];
    const secondRun = [b.create("rprj_"), b.create("rprj_"), b.create("rprj_")];
    expect(firstRun).toEqual(secondRun);
    expect(new Set(firstRun).size).toBe(3);
  });
});
