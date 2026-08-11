import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  SestinaProjectSchema,
  TaskContractSchema,
  StandardEventSchema,
  DecisionSchema,
  ConversationSchema,
  DecisionTraceSchema,
  ReviewItemSchema,
  HostStreamEventSchema,
  SituationAssertionSchema,
  PreviewConfirmationSchema,
  RpcRequestSchema,
  BoundarySchema,
  GovernanceContextPacketSchema,
  GovernanceAnswerSchema,
} from "../src/index.js";

const FIXTURES_DIR = resolve(import.meta.dirname, "../../../tests/fixtures/schema");
const INVALID_DIR = resolve(FIXTURES_DIR, "invalid");

function loadValid(name: string): unknown {
  return JSON.parse(readFileSync(resolve(FIXTURES_DIR, name), "utf8")) as unknown;
}

function loadInvalid(name: string): unknown {
  return JSON.parse(readFileSync(resolve(INVALID_DIR, name), "utf8")) as unknown;
}

describe("Valid fixture validation", () => {
  it("valid-project.json parses as SestinaProject", () => {
    const data = loadValid("valid-project.json");
    const result = SestinaProjectSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      const roundTripped = SestinaProjectSchema.parse(JSON.parse(JSON.stringify(result.data)));
      expect(roundTripped).toEqual(result.data);
    }
  });

  it("valid-contract.json parses as TaskContract", () => {
    const data = loadValid("valid-contract.json");
    const result = TaskContractSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      const roundTripped = TaskContractSchema.parse(JSON.parse(JSON.stringify(result.data)));
      expect(roundTripped).toEqual(result.data);
    }
  });

  it("valid-event.json parses as StandardEvent", () => {
    const data = loadValid("valid-event.json");
    const result = StandardEventSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      const roundTripped = StandardEventSchema.parse(JSON.parse(JSON.stringify(result.data)));
      expect(roundTripped).toEqual(result.data);
    }
  });

  it("valid-decision.json parses as Decision", () => {
    const data = loadValid("valid-decision.json");
    const result = DecisionSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      const roundTripped = DecisionSchema.parse(JSON.parse(JSON.stringify(result.data)));
      expect(roundTripped).toEqual(result.data);
    }
  });

  it("valid-conversation.json parses as Conversation", () => {
    const data = loadValid("valid-conversation.json");
    const result = ConversationSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      const roundTripped = ConversationSchema.parse(JSON.parse(JSON.stringify(result.data)));
      expect(roundTripped).toEqual(result.data);
    }
  });

  it("valid-decision-trace.json parses as DecisionTrace", () => {
    const data = loadValid("valid-decision-trace.json");
    const result = DecisionTraceSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      const roundTripped = DecisionTraceSchema.parse(JSON.parse(JSON.stringify(result.data)));
      expect(roundTripped).toEqual(result.data);
    }
  });

  it("valid-review.json parses as ReviewItem", () => {
    const data = loadValid("valid-review.json");
    const result = ReviewItemSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      const roundTripped = ReviewItemSchema.parse(JSON.parse(JSON.stringify(result.data)));
      expect(roundTripped).toEqual(result.data);
    }
  });

  it("valid-host-stream.json parses as HostStreamEvent", () => {
    const data = loadValid("valid-host-stream.json");
    const result = HostStreamEventSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      const roundTripped = HostStreamEventSchema.parse(JSON.parse(JSON.stringify(result.data)));
      expect(roundTripped).toEqual(result.data);
    }
  });

  it("valid-situation-assertion.json parses as SituationAssertion", () => {
    const data = loadValid("valid-situation-assertion.json");
    const result = SituationAssertionSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      const roundTripped = SituationAssertionSchema.parse(JSON.parse(JSON.stringify(result.data)));
      expect(roundTripped).toEqual(result.data);
    }
  });

  it("valid-governance-context.json parses as GovernanceContextPacket", () => {
    const data = loadValid("valid-governance-context.json");
    const result = GovernanceContextPacketSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      const roundTripped = GovernanceContextPacketSchema.parse(JSON.parse(JSON.stringify(result.data)));
      expect(roundTripped).toEqual(result.data);
    }
  });

  it("valid-governance-answer.json parses as GovernanceAnswer", () => {
    const data = loadValid("valid-governance-answer.json");
    const result = GovernanceAnswerSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      const roundTripped = GovernanceAnswerSchema.parse(JSON.parse(JSON.stringify(result.data)));
      expect(roundTripped).toEqual(result.data);
    }
  });
});

describe("Invalid fixture validation", () => {
  it("rejects invalid-oversized-contract.json (title > 500 chars)", () => {
    const data = loadInvalid("invalid-oversized-contract.json");
    expect(TaskContractSchema.safeParse(data).success).toBe(false);
  });

  it("rejects invalid-bad-id.json (eventId not 26 chars)", () => {
    const data = loadInvalid("invalid-bad-id.json");
    expect(StandardEventSchema.safeParse(data).success).toBe(false);
  });

  it("rejects invalid-unknown-enum.json (unknown eventType)", () => {
    const data = loadInvalid("invalid-unknown-enum.json");
    expect(StandardEventSchema.safeParse(data).success).toBe(false);
  });

  it("rejects invalid-nan-confidence.json (null confidence)", () => {
    const data = loadInvalid("invalid-nan-confidence.json");
    expect(BoundarySchema.safeParse(data).success).toBe(false);
  });

  it("rejects invalid-missing-schema-version.json (no schemaVersion)", () => {
    const data = loadInvalid("invalid-missing-schema-version.json");
    expect(StandardEventSchema.safeParse(data).success).toBe(false);
  });

  it("rejects invalid-wrong-preview-hash.json (bad previewHash format)", () => {
    const data = loadInvalid("invalid-wrong-preview-hash.json");
    expect(PreviewConfirmationSchema.safeParse(data).success).toBe(false);
  });

  it("rejects invalid-ipc-bad-role.json (clientRole: admin)", () => {
    const data = loadInvalid("invalid-ipc-bad-role.json");
    expect(RpcRequestSchema.safeParse(data).success).toBe(false);
  });
});
