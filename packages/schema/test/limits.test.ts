import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ID_SCHEMA,
  TaskContractSchema,
  StandardEventSchema,
  BoundarySchema,
  PreviewConfirmationSchema,
  RpcRequestSchema,
  ConversationMessageSchema,
  ActorProvenanceSchema,
} from "../src/index.js";

const FIXTURES = resolve(import.meta.dirname, "../../../tests/fixtures/schema");
const INVALID = resolve(FIXTURES, "invalid");

function loadInvalid(name: string): unknown {
  return JSON.parse(readFileSync(resolve(INVALID, name), "utf8")) as unknown;
}

describe("Limits and malicious input rejection", () => {
  it("rejects an oversized title (>500 chars)", () => {
    const contract = loadInvalid("invalid-oversized-contract.json");
    expect(TaskContractSchema.safeParse(contract).success).toBe(false);
  });

  it("rejects a non-26-char ID", () => {
    expect(ID_SCHEMA.safeParse("abc").success).toBe(false);
    expect(ID_SCHEMA.safeParse("").success).toBe(false);
    expect(ID_SCHEMA.safeParse("a".repeat(27)).success).toBe(false);
  });

  it("rejects an unknown enum value for eventType", () => {
    const event = loadInvalid("invalid-unknown-enum.json");
    expect(StandardEventSchema.safeParse(event).success).toBe(false);
  });

  it("rejects NaN/null confidence values", () => {
    const bad = loadInvalid("invalid-nan-confidence.json");
    expect(BoundarySchema.safeParse(bad).success).toBe(false);
  });

  it("rejects missing schemaVersion in StandardEvent", () => {
    const event = loadInvalid("invalid-missing-schema-version.json");
    expect(StandardEventSchema.safeParse(event).success).toBe(false);
  });

  it("rejects bad event ID format", () => {
    const event = loadInvalid("invalid-bad-id.json");
    expect(StandardEventSchema.safeParse(event).success).toBe(false);
  });

  it("rejects previewHash with invalid format", () => {
    const data = loadInvalid("invalid-wrong-preview-hash.json");
    expect(PreviewConfirmationSchema.safeParse(data).success).toBe(false);
  });

  it("rejects unknown client role in RPC", () => {
    const data = loadInvalid("invalid-ipc-bad-role.json");
    expect(RpcRequestSchema.safeParse(data).success).toBe(false);
  });

  it("rejects excessively long message body (>25000 chars)", () => {
    const long = "x".repeat(50000);
    const result = ConversationMessageSchema.safeParse({
      messageId: "MSG-LONG",
      conversationId: "1PN83TSXT93AK3V4TQW7JXNQ2G",
      role: "user",
      body: long,
      contextRefs: [],
      confirmable: false,
      status: "complete",
      createdAt: new Date().toISOString(),
    });
    expect(result.success).toBe(false);
  });

  it("strips unknown fields (Zod non-strict default)", () => {
    // Zod strips unknown keys by default (non-strict mode).
    const result = ActorProvenanceSchema.safeParse({
      actor: "user",
      channel: "desktop",
      directUser: true,
      unknownField: "should be stripped",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      // Verify the unknown field is not present in the parsed output
      expect(Object.prototype.hasOwnProperty.call(result.data, "unknownField")).toBe(false);
    }
  });

  it("rejects non-Crockford characters in ID (I, L, O, U)", () => {
    expect(ID_SCHEMA.safeParse("I23456789ABCDEFGHJKMNPQRS").success).toBe(false);
    expect(ID_SCHEMA.safeParse("L23456789ABCDEFGHJKMNPQRS").success).toBe(false);
    expect(ID_SCHEMA.safeParse("O23456789ABCDEFGHJKMNPQRS").success).toBe(false);
    expect(ID_SCHEMA.safeParse("U23456789ABCDEFGHJKMNPQRS").success).toBe(false);
  });

  it("rejects non-string inputs for ID_SCHEMA", () => {
    expect(ID_SCHEMA.safeParse(123).success).toBe(false);
    expect(ID_SCHEMA.safeParse(null).success).toBe(false);
    expect(ID_SCHEMA.safeParse(undefined).success).toBe(false);
    expect(ID_SCHEMA.safeParse({}).success).toBe(false);
  });
});
