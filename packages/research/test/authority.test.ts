/**
 * RI-10: actors, sources, authority transitions, user confirmation and
 * UTC timestamps.
 *
 * Authority levels are bound to actor kinds; model/system/import actors can
 * never forge or overwrite user authority, and every failure carries a
 * stable error code.
 */
import { describe, it, expect } from "vitest";
import {
  parseResearchSource,
  validateAuthorityTransition,
  confirmResearchSource,
  FixedClock,
  validateUtcTimestamp,
  type ResearchActor,
  type ResearchSource,
  type AuthorityLevel,
} from "../src/index.js";

const USER_ACTOR: ResearchActor = { kind: "user", actorId: "user-1" };
const MODEL_ACTOR: ResearchActor = { kind: "model", provider: "p", model: "m" };
const SYSTEM_ACTOR: ResearchActor = { kind: "system", component: "checker" };
const IMPORT_ACTOR: ResearchActor = { kind: "import", sourceSystem: "legacy" };
const AT = "2026-08-18T10:00:00.000Z";

function source(
  actor: ResearchActor,
  authority: AuthorityLevel,
  recordedAt = AT,
): ResearchSource {
  return { actor, authority, recordedAt };
}

describe("actor/authority pairing (five legal pairs)", () => {
  it.each([
    ["user", "user_confirmed"],
    ["user", "user_recorded"],
    ["model", "model_proposed"],
    ["system", "system_derived"],
    ["import", "imported_unconfirmed"],
  ] as const)("accepts %s with %s", (kind, authority) => {
    const actorByKind = {
      user: USER_ACTOR,
      model: MODEL_ACTOR,
      system: SYSTEM_ACTOR,
      import: IMPORT_ACTOR,
    };
    const r = parseResearchSource(source(actorByKind[kind], authority));
    expect(r.ok).toBe(true);
  });

  it.each([
    ["model", "user_confirmed"],
    ["system", "user_confirmed"],
    ["import", "user_confirmed"],
    ["model", "user_recorded"],
    ["system", "user_recorded"],
  ] as const)("rejects %s with %s", (kind, authority) => {
    const actorByKind = {
      model: MODEL_ACTOR,
      system: SYSTEM_ACTOR,
      import: IMPORT_ACTOR,
    };
    const r = parseResearchSource(source(actorByKind[kind], authority));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("authority_conflict");
  });
});

describe("actor field validation", () => {
  it("rejects blank actor identifiers", () => {
    const r = parseResearchSource(source({ kind: "user", actorId: "   " }, "user_confirmed"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invalid_actor");
  });

  it("rejects a system actor without a component", () => {
    const r = parseResearchSource(source({ kind: "system", component: "" }, "system_derived"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invalid_actor");
  });

  it("rejects an import actor without a sourceSystem", () => {
    const r = parseResearchSource(source({ kind: "import", sourceSystem: " " }, "imported_unconfirmed"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invalid_actor");
  });

  it("rejects an unknown authority level", () => {
    const r = parseResearchSource(source(USER_ACTOR, "totally_fine" as AuthorityLevel));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invalid_authority_level");
  });

  it("rejects a source with a missing actor or timestamp", () => {
    expect(parseResearchSource({ authority: "user_recorded", recordedAt: AT }).ok).toBe(false);
    expect(parseResearchSource({ actor: USER_ACTOR, authority: "user_recorded" }).ok).toBe(false);
  });
});

describe("authority transitions", () => {
  it("rejects malformed current and incoming sources before comparing authority", () => {
    const malformedCurrent = source(
      { kind: "user", actorId: " " },
      "user_confirmed",
    );
    const badCurrent = validateAuthorityTransition(
      malformedCurrent,
      source(USER_ACTOR, "user_recorded"),
    );
    expect(badCurrent.ok).toBe(false);
    if (!badCurrent.ok) expect(badCurrent.error.code).toBe("invalid_actor");

    const malformedIncoming = source(
      MODEL_ACTOR,
      "model_proposed",
      "2026-08-18T10:00:00",
    );
    const badIncoming = validateAuthorityTransition(
      source(SYSTEM_ACTOR, "system_derived"),
      malformedIncoming,
    );
    expect(badIncoming.ok).toBe(false);
    if (!badIncoming.ok) {
      expect(badIncoming.error.code).toBe("invalid_timestamp");
    }
  });

  it("rejects a model proposal overwriting a user confirmation", () => {
    const r = validateAuthorityTransition(
      source(USER_ACTOR, "user_confirmed"),
      source(MODEL_ACTOR, "model_proposed"),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("authority_conflict");
  });

  it("rejects system content replacing a user confirmation", () => {
    const r = validateAuthorityTransition(
      source(USER_ACTOR, "user_confirmed"),
      source(SYSTEM_ACTOR, "system_derived"),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("authority_conflict");
  });

  it("rejects imported state replacing a user confirmation before user confirmation exists", () => {
    const r = validateAuthorityTransition(
      source(USER_ACTOR, "user_confirmed"),
      source(IMPORT_ACTOR, "imported_unconfirmed"),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("authority_conflict");
  });

  it("allows a user record to replace a model proposal", () => {
    const r = validateAuthorityTransition(
      source(MODEL_ACTOR, "model_proposed"),
      source(USER_ACTOR, "user_recorded"),
    );
    expect(r.ok).toBe(true);
  });

  it("allows a model proposal to replace a system derivation", () => {
    const r = validateAuthorityTransition(
      source(SYSTEM_ACTOR, "system_derived"),
      source(MODEL_ACTOR, "model_proposed"),
    );
    expect(r.ok).toBe(true);
  });
});

describe("user confirmation", () => {
  it("a user actor confirms a proposal into a new user_confirmed source", () => {
    const proposal = source(MODEL_ACTOR, "model_proposed");
    const clock = new FixedClock("2026-08-18T12:00:00.000Z");
    const r = confirmResearchSource(proposal, USER_ACTOR, clock);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const confirmed = r.value;
      expect(confirmed.source.authority).toBe("user_confirmed");
      expect(confirmed.source.actor).toEqual(USER_ACTOR);
      expect(confirmed.source.recordedAt).toBe("2026-08-18T12:00:00.000Z");
      // The confirmed proposal keeps a value-equivalent source snapshot.
      expect(confirmed.confirmedProposal).toEqual(proposal);
      expect(confirmed.confirmedAt).toBe("2026-08-18T12:00:00.000Z");
    }
  });

  it("model, system and import actors cannot forge a confirmation", () => {
    const proposal = source(MODEL_ACTOR, "model_proposed");
    for (const actor of [MODEL_ACTOR, SYSTEM_ACTOR, IMPORT_ACTOR]) {
      const r = confirmResearchSource(proposal, actor, new FixedClock(AT));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("authority_conflict");
    }
  });

  it("does not mutate the input proposal", () => {
    const proposal = source(MODEL_ACTOR, "model_proposed");
    const snapshot = JSON.stringify(proposal);
    const r = confirmResearchSource(proposal, USER_ACTOR, new FixedClock(AT));
    expect(r.ok).toBe(true);
    expect(JSON.stringify(proposal)).toBe(snapshot);
  });

  it("does not retain mutable aliases to the proposal or confirming actor", () => {
    const proposalActor = { kind: "model", provider: "before" } as ResearchActor;
    const proposal = source(proposalActor, "model_proposed");
    const confirmingActor = { kind: "user", actorId: "user-before" } as ResearchActor;
    const r = confirmResearchSource(proposal, confirmingActor, new FixedClock(AT));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    (proposalActor as { provider?: string }).provider = "after";
    (confirmingActor as { actorId?: string }).actorId = "user-after";
    expect(r.value.confirmedProposal.actor).toEqual({
      kind: "model",
      provider: "before",
    });
    expect(r.value.source.actor).toEqual({
      kind: "user",
      actorId: "user-before",
    });
  });

  it("returns invalid_timestamp instead of throwing when the clock is invalid", () => {
    const invalidClock = { now: () => new Date(Number.NaN) };
    expect(() =>
      confirmResearchSource(
        source(MODEL_ACTOR, "model_proposed"),
        USER_ACTOR,
        invalidClock,
      ),
    ).not.toThrow();
    const r = confirmResearchSource(
      source(MODEL_ACTOR, "model_proposed"),
      USER_ACTOR,
      invalidClock,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invalid_timestamp");
  });
});

describe("UTC timestamps", () => {
  it("accepts a Z-terminated UTC timestamp", () => {
    const r = validateUtcTimestamp(AT);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("2026-08-18T10:00:00.000Z");
  });

  it("normalizes +00:00 to Z consistently", () => {
    const r = validateUtcTimestamp("2026-08-18T10:00:00.000+00:00");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("2026-08-18T10:00:00.000Z");
  });

  it("rejects a timestamp without a timezone", () => {
    expect(validateUtcTimestamp("2026-08-18T10:00:00.000").ok).toBe(false);
  });

  it("rejects a non-UTC offset", () => {
    expect(validateUtcTimestamp("2026-08-18T10:00:00.000+08:00").ok).toBe(false);
  });

  it("rejects invalid dates and empty strings", () => {
    expect(validateUtcTimestamp("2026-13-45T99:00:00.000Z").ok).toBe(false);
    expect(validateUtcTimestamp("").ok).toBe(false);
  });

  it("rejects non-string input", () => {
    expect(validateUtcTimestamp(123).ok).toBe(false);
    expect(validateUtcTimestamp(null).ok).toBe(false);
  });

  it("rejects a bad timestamp inside a source", () => {
    const r = parseResearchSource(source(USER_ACTOR, "user_recorded", "2026-08-18T10:00:00.000"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invalid_timestamp");
  });
});
