import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  CorrectionSchema,
  CorrectionPromotionSchema,
  SestinaErrorCode,
  canActAsDirectUser,
  isSestinaError,
  type ActorProvenance,
} from "@sestina/schema";
import {
  recordCorrection,
  normalizeInstruction,
  fingerprintRecurrence,
  type RecordCorrectionInput,
} from "../src/corrections.js";

const NOW = "2026-08-14T10:00:00.000Z";
const LATER = "2026-08-14T11:00:00.000Z";
const FIXED_PROJECT = "01H0000000000000000000000A";
const FIXED_TASK = "01H0000000000000000000000B";

function makeActor(overrides: Partial<ActorProvenance> = {}): ActorProvenance {
  return { actor: "user", channel: "desktop", directUser: true, ...overrides };
}

function makeInput(overrides: Partial<RecordCorrectionInput> = {}): RecordCorrectionInput {
  return {
    projectId: FIXED_PROJECT,
    taskId: FIXED_TASK,
    summary: "prioritize deliverables over formatting",
    normalizedInstruction: "ship the content first, polish later",
    originalEventRef: "event-1",
    failureClass: "fact",
    severity: "moderate",
    actor: makeActor(),
    createdAt: NOW,
    ...overrides,
  };
}

function expectSestinaCode(run: () => void, code: SestinaErrorCode): void {
  try {
    run();
  } catch (err) {
    if (isSestinaError(err) && err.code === code) return;
    throw new Error(`expected SestinaError ${code}`, { cause: err });
  }
  throw new Error(`expected SestinaError ${code}`);
}

/**
 * Independent copy of the documented canonical form: objects re-built with
 * keys in sorted order at every nesting level, so the test verifies the
 * previewHash contract without importing production helpers.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = canonicalize(record[key]);
    }
    return sorted;
  }
  return value;
}

describe("recordCorrection (docs/22 Task 9)", () => {
  it("defaults to task scope and records a direct-user correction that parses", () => {
    const input = makeInput();
    const result = recordCorrection(input);
    expect(result.kind).toBe("recorded");
    if (result.kind !== "recorded") throw new Error("unreachable");
    const correction = result.correction;
    expect(correction.scope).toBe("task");
    expect(correction.taskId).toBe(FIXED_TASK);
    expect(correction.projectId).toBe(FIXED_PROJECT);
    expect(correction.confirmed).toBe(true);
    expect(correction.confirmedAt).toBe(NOW);
    expect(correction.createdAt).toBe(NOW);
    expect(correction.summary).toBe(input.summary);
    expect(correction.originalEventRef).toBe(input.originalEventRef);
    expect(correction.failureClass).toBe("fact");
    expect(correction.severity).toBe("moderate");
    expect(correction.recurrenceCount).toBe(0);
    expect(correction.supersededBy).toBeUndefined();
    expect(CorrectionSchema.parse(correction)).toEqual(correction);
  });

  it("records a cli direct user as confirmed", () => {
    const result = recordCorrection(
      makeInput({ actor: makeActor({ channel: "cli" }) }),
    );
    expect(result.kind).toBe("recorded");
    if (result.kind !== "recorded") throw new Error("unreachable");
    expect(result.correction.confirmed).toBe(true);
    expect(result.correction.confirmedAt).toBe(NOW);
  });

  it("honours an explicit confirmedAt for a direct user", () => {
    const result = recordCorrection(makeInput({ confirmedAt: LATER }));
    expect(result.kind).toBe("recorded");
    if (result.kind !== "recorded") throw new Error("unreachable");
    expect(result.correction.confirmedAt).toBe(LATER);
  });

  it("rejects a task-scoped record without a taskId", () => {
    expectSestinaCode(
      () => recordCorrection(makeInput({ taskId: undefined })),
      SestinaErrorCode.validation_failed,
    );
    expectSestinaCode(
      () => recordCorrection(makeInput({ scope: "task", taskId: undefined })),
      SestinaErrorCode.validation_failed,
    );
  });

  it("records a session-scoped correction without a task", () => {
    const result = recordCorrection(
      makeInput({ scope: "session", taskId: undefined }),
    );
    expect(result.kind).toBe("recorded");
    if (result.kind !== "recorded") throw new Error("unreachable");
    expect(result.correction.scope).toBe("session");
    expect(result.correction.taskId).toBeUndefined();
    expect(CorrectionSchema.parse(result.correction)).toEqual(result.correction);
  });

  it("keeps peer actors as unconfirmed candidates", () => {
    const peer = makeActor({ actor: "agent", channel: "mcp", directUser: false });
    const result = recordCorrection(makeInput({ actor: peer }));
    expect(result.kind).toBe("recorded");
    if (result.kind !== "recorded") throw new Error("unreachable");
    expect(result.correction.confirmed).toBe(false);
    expect(result.correction.confirmedAt).toBeUndefined();
    expect(CorrectionSchema.parse(result.correction)).toEqual(result.correction);
  });

  it("ignores a directUser flag forged on a host channel", () => {
    const forged = makeActor({ channel: "host", directUser: true });
    expect(canActAsDirectUser(forged)).toBe(false);
    const result = recordCorrection(makeInput({ actor: forged }));
    expect(result.kind).toBe("recorded");
    if (result.kind !== "recorded") throw new Error("unreachable");
    expect(result.correction.confirmed).toBe(false);
    expect(result.correction.confirmedAt).toBeUndefined();
  });

  it("never confirms a directUser flag forged on an mcp channel", () => {
    const forged = makeActor({ channel: "mcp", directUser: true });
    expect(canActAsDirectUser(forged)).toBe(false);
    const result = recordCorrection(makeInput({ actor: forged }));
    expect(result.kind).toBe("recorded");
    if (result.kind !== "recorded") throw new Error("unreachable");
    expect(result.correction.confirmed).toBe(false);
    expect(result.correction.confirmedAt).toBeUndefined();
  });

  it("keeps a directUser flag on a non-direct channel as a candidate", () => {
    const runtimeActor = makeActor({ channel: "runtime", directUser: true });
    expect(canActAsDirectUser(runtimeActor)).toBe(false);
    const result = recordCorrection(makeInput({ actor: runtimeActor }));
    expect(result.kind).toBe("recorded");
    if (result.kind !== "recorded") throw new Error("unreachable");
    expect(result.correction.confirmed).toBe(false);
    expect(result.correction.confirmedAt).toBeUndefined();
  });

  it("defaults recurrenceCount to 0 and honours an override", () => {
    const defaulted = recordCorrection(makeInput());
    if (defaulted.kind !== "recorded") throw new Error("unreachable");
    expect(defaulted.correction.recurrenceCount).toBe(0);
    const overridden = recordCorrection(makeInput({ recurrenceCount: 3 }));
    if (overridden.kind !== "recorded") throw new Error("unreachable");
    expect(overridden.correction.recurrenceCount).toBe(3);
  });

  it("defaults correctionId and honours an override", () => {
    const defaulted = recordCorrection(makeInput());
    if (defaulted.kind !== "recorded") throw new Error("unreachable");
    expect(defaulted.correction.correctionId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    const fixedId = "01H0000000000000000000000C";
    const overridden = recordCorrection(makeInput({ correctionId: fixedId }));
    if (overridden.kind !== "recorded") throw new Error("unreachable");
    expect(overridden.correction.correctionId).toBe(fixedId);
  });

  it("passes expiresWhen through untouched", () => {
    const result = recordCorrection(
      makeInput({ expiresWhen: "2026-09-01T00:00:00.000Z" }),
    );
    if (result.kind !== "recorded") throw new Error("unreachable");
    expect(result.correction.expiresWhen).toBe("2026-09-01T00:00:00.000Z");
    expect(CorrectionSchema.parse(result.correction)).toEqual(result.correction);
  });

  it("promotion: project scope never widens silently", () => {
    const input = makeInput({ scope: "project", taskId: undefined });
    const result = recordCorrection(input);
    expect(result.kind).toBe("promotion_required");
    if (result.kind !== "promotion_required") throw new Error("unreachable");
    const { proposal, taskLevelCorrection } = result;
    expect(taskLevelCorrection.scope).toBe("task");
    expect(taskLevelCorrection.taskId).toBeUndefined();
    expect(proposal.toScope).toBe("project");
    expect(proposal.fromScope).toBe("task");
    expect(proposal.fromCorrectionId).toBe(taskLevelCorrection.correctionId);
    expect(proposal.requiresConfirmation).toBe(true);
    expect(proposal.createdAt).toBe(NOW);
    expect(CorrectionPromotionSchema.parse(proposal)).toEqual(proposal);
    expect(CorrectionSchema.parse(taskLevelCorrection)).toEqual(taskLevelCorrection);
  });

  it("promotion: user scope builds the same proposal shape", () => {
    const result = recordCorrection(makeInput({ scope: "user" }));
    expect(result.kind).toBe("promotion_required");
    if (result.kind !== "promotion_required") throw new Error("unreachable");
    expect(result.proposal.toScope).toBe("user");
    expect(result.proposal.requiresConfirmation).toBe(true);
    expect(CorrectionPromotionSchema.parse(result.proposal)).toEqual(result.proposal);
  });

  it("promotion: the proposed boundary is soft, overridable and process-kind", () => {
    const input = makeInput({ scope: "project" });
    const result = recordCorrection(input);
    if (result.kind !== "promotion_required") throw new Error("unreachable");
    const boundary = result.proposal.proposedBoundary;
    expect(boundary.kind).toBe("process");
    expect(boundary.severity).toBe("soft");
    expect(boundary.statement).toBe(input.summary);
    expect(boundary.owner).toBe("user");
    expect(boundary.source.type).toBe("user_directive");
    expect(boundary.source.confidence).toBe(1);
    expect(boundary.overridable).toBe(true);
    expect(boundary.status).toBe("active");
    expect(boundary.validFrom).toBe(NOW);
    expect(boundary.confidence).toBe(1);
  });

  it("promotion: a peer actor can only propose an inferred boundary", () => {
    const peer = makeActor({ actor: "agent", channel: "mcp", directUser: false });
    const result = recordCorrection(
      makeInput({ scope: "project", actor: peer }),
    );
    if (result.kind !== "promotion_required") throw new Error("unreachable");
    expect(result.proposal.proposedBoundary.owner).toBe("inferred");
    expect(result.proposal.proposedBoundary.source.type).toBe("correction");
    expect(result.taskLevelCorrection.confirmed).toBe(false);
  });

  it("promotion: previewHash is the sha256 of the canonical boundary JSON", () => {
    const result = recordCorrection(makeInput({ scope: "user" }));
    if (result.kind !== "promotion_required") throw new Error("unreachable");
    expect(result.proposal.previewHash).toMatch(/^[a-f0-9]{64}$/);
    const recomputed = createHash("sha256")
      .update(JSON.stringify(canonicalize(result.proposal.proposedBoundary)))
      .digest("hex");
    expect(result.proposal.previewHash).toBe(recomputed);
  });

  it("promotion: promotionId comes from correctionId when provided", () => {
    const fixedId = "01H0000000000000000000000C";
    const result = recordCorrection(
      makeInput({ scope: "project", correctionId: fixedId }),
    );
    if (result.kind !== "promotion_required") throw new Error("unreachable");
    expect(result.proposal.promotionId).toBe(fixedId);
    expect(result.taskLevelCorrection.correctionId).toBe(fixedId);
  });

  it("promotion: a task-attached project correction keeps its task anchor", () => {
    const result = recordCorrection(makeInput({ scope: "project" }));
    if (result.kind !== "promotion_required") throw new Error("unreachable");
    expect(result.taskLevelCorrection.taskId).toBe(FIXED_TASK);
    expect(result.taskLevelCorrection.scope).toBe("task");
  });

  it("normalises the instruction before storing and fingerprinting", () => {
    const ragged = recordCorrection(
      makeInput({
        normalizedInstruction: "  ship\tthe\n  content   first, polish later ",
      }),
    );
    if (ragged.kind !== "recorded") throw new Error("unreachable");
    expect(ragged.correction.normalizedInstruction).toBe(
      "ship the content first, polish later",
    );
    const tidy = recordCorrection(makeInput());
    if (tidy.kind !== "recorded") throw new Error("unreachable");
    expect(ragged.correction.recurrenceFingerprint).toBe(
      tidy.correction.recurrenceFingerprint,
    );
  });
});

describe("normalizeInstruction", () => {
  it("trims and collapses internal whitespace runs", () => {
    expect(normalizeInstruction("  a\tb\n\n c  ")).toBe("a b c");
  });

  it("composes to NFC", () => {
    const decomposed = "cafe" + "́";
    expect(normalizeInstruction(decomposed)).toBe("café");
  });

  it("collapses full-width spaces", () => {
    expect(normalizeInstruction("a　　b")).toBe("a b");
  });

  it("is idempotent", () => {
    expect(normalizeInstruction(normalizeInstruction("  a   b "))).toBe("a b");
  });
});

describe("fingerprintRecurrence", () => {
  it("is deterministic and 64-bit lowercase hex", () => {
    const first = fingerprintRecurrence(
      FIXED_PROJECT,
      FIXED_TASK,
      "task",
      "fact",
      "ship the content first",
    );
    const second = fingerprintRecurrence(
      FIXED_PROJECT,
      FIXED_TASK,
      "task",
      "fact",
      "ship the content first",
    );
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{16}$/);
  });

  it("changes with the project", () => {
    const a = fingerprintRecurrence(FIXED_PROJECT, FIXED_TASK, "task", "fact", "x");
    const b = fingerprintRecurrence("01H0000000000000000000000D", FIXED_TASK, "task", "fact", "x");
    expect(a).not.toBe(b);
  });

  it("changes with the task", () => {
    const a = fingerprintRecurrence(FIXED_PROJECT, FIXED_TASK, "task", "fact", "x");
    const b = fingerprintRecurrence(FIXED_PROJECT, "01H0000000000000000000000E", "task", "fact", "x");
    expect(a).not.toBe(b);
  });

  it("changes when the task is absent versus present", () => {
    const a = fingerprintRecurrence(FIXED_PROJECT, undefined, "task", "fact", "x");
    const b = fingerprintRecurrence(FIXED_PROJECT, FIXED_TASK, "task", "fact", "x");
    expect(a).not.toBe(b);
  });

  it("changes with the scope", () => {
    const a = fingerprintRecurrence(FIXED_PROJECT, FIXED_TASK, "task", "fact", "x");
    const b = fingerprintRecurrence(FIXED_PROJECT, FIXED_TASK, "session", "fact", "x");
    expect(a).not.toBe(b);
  });

  it("changes with the failure class", () => {
    const a = fingerprintRecurrence(FIXED_PROJECT, FIXED_TASK, "task", "fact", "x");
    const b = fingerprintRecurrence(FIXED_PROJECT, FIXED_TASK, "task", "rule", "x");
    expect(a).not.toBe(b);
  });

  it("changes with the instruction", () => {
    const a = fingerprintRecurrence(FIXED_PROJECT, FIXED_TASK, "task", "fact", "x");
    const b = fingerprintRecurrence(FIXED_PROJECT, FIXED_TASK, "task", "fact", "y");
    expect(a).not.toBe(b);
  });
});
