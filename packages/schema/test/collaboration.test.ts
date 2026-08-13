import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CollaborationThreadSchema,
  CollaborationMessageSchema,
  CollaborationEndpointSchema,
  CollaborationDeliveryAttemptSchema,
  CollaborationActionSchema,
  CollaborationConfigSchema,
  CollaborationAuthoritySchema,
  COLLABORATION_LIMITS,
  assertCollaborationOwnership,
  SestinaErrorCode,
  SestinaError,
  isSestinaError,
} from "../src/index.js";

const FIXTURES = resolve(import.meta.dirname, "../../../tests/fixtures/schema");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(resolve(FIXTURES, name), "utf8")) as unknown;
}

function loadInvalid(name: string): unknown {
  return JSON.parse(readFileSync(resolve(FIXTURES, "invalid", name), "utf8")) as unknown;
}

// Shared valid identifiers used by fixtures and inline cases.
const PROJECT = "JGP7HHVP7X6E3F3PBJ2RHB7YJW";
const TASK = "RCDW1C3BMD01S9BBS2NY3CEVDR";
const THREAD = "01JGNK7V3PJDQK8TZ9B2M4X6YH";
const CODEC_ENDPOINT = "01JGNP9X5RMFSMA1BD4P6Z8AKK";
const CLAUDE_ENDPOINT = "01JGNQAY6SMGTNB2CE5Q7A9BMM";
const OTHER_PROJECT = "TQW7JXNQ2G1PN83TSXT93AK3V4";
const OTHER_TASK = "8VEB2QF6MW04YAJTK9PD3ZGXH1";

function validAuthority(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    actor: "peer_agent",
    directUser: false,
    sourceHost: "codex",
    sourceSessionId: "session-codex-001",
    contractVersion: 3,
    allowedOutcome: "inform",
    ...overrides,
  };
}

function validMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    messageId: "01JGNK8W4QKERM9VA0C3N5Y7ZJ",
    threadId: THREAD,
    projectId: PROJECT,
    taskId: TASK,
    kind: "status",
    sourceEndpointId: CODEC_ENDPOINT,
    targetEndpointIds: [CLAUDE_ENDPOINT],
    summary: "Progress update.",
    constraints: [],
    evidenceRefs: [],
    contextRefs: [],
    authority: validAuthority(),
    privacyClass: "internal",
    ttlSeconds: 1800,
    hopCount: 0,
    dedupeKey: "dedupe-test",
    createdAt: "2026-08-13T02:00:00.000Z",
    expiresAt: "2026-08-13T02:30:00.000Z",
    ...overrides,
  };
}

describe("Collaboration schema round-trips", () => {
  it("round-trips CollaborationThread", () => {
    const result = CollaborationThreadSchema.safeParse(loadFixture("valid-collaboration-thread.json"));
    expect(result.success).toBe(true);
    if (result.success) {
      const roundTripped = CollaborationThreadSchema.parse(JSON.parse(JSON.stringify(result.data)));
      expect(roundTripped).toEqual(result.data);
    }
  });

  it("round-trips CollaborationMessage", () => {
    const result = CollaborationMessageSchema.safeParse(loadFixture("valid-collaboration-message.json"));
    expect(result.success).toBe(true);
    if (result.success) {
      const roundTripped = CollaborationMessageSchema.parse(JSON.parse(JSON.stringify(result.data)));
      expect(roundTripped).toEqual(result.data);
    }
  });

  it("round-trips CollaborationEndpoint", () => {
    const result = CollaborationEndpointSchema.safeParse(loadFixture("valid-collaboration-endpoint.json"));
    expect(result.success).toBe(true);
    if (result.success) {
      const roundTripped = CollaborationEndpointSchema.parse(JSON.parse(JSON.stringify(result.data)));
      expect(roundTripped).toEqual(result.data);
    }
  });

  it("round-trips CollaborationDeliveryAttempt", () => {
    const result = CollaborationDeliveryAttemptSchema.safeParse(loadFixture("valid-collaboration-attempt.json"));
    expect(result.success).toBe(true);
    if (result.success) {
      const roundTripped = CollaborationDeliveryAttemptSchema.parse(JSON.parse(JSON.stringify(result.data)));
      expect(roundTripped).toEqual(result.data);
    }
  });

  it("round-trips CollaborationAction", () => {
    const result = CollaborationActionSchema.safeParse(loadFixture("valid-collaboration-action.json"));
    expect(result.success).toBe(true);
    if (result.success) {
      const roundTripped = CollaborationActionSchema.parse(JSON.parse(JSON.stringify(result.data)));
      expect(roundTripped).toEqual(result.data);
    }
  });
});

describe("Collaboration message kinds", () => {
  it.each([
    ["status", "Progress update."],
    ["consult", "Can you confirm the test result?"],
    ["reply", "The test result is green."],
    ["handoff", "Please take over the remaining tests."],
  ])("accepts kind=%s", (kind, summary) => {
    const result = CollaborationMessageSchema.safeParse(validMessage({ kind, summary }));
    expect(result.success).toBe(true);
  });

  it("rejects any kind outside status|consult|reply|handoff", () => {
    const result = CollaborationMessageSchema.safeParse(validMessage({ kind: "broadcast" }));
    expect(result.success).toBe(false);
    const fixture = CollaborationMessageSchema.safeParse(loadInvalid("invalid-collab-unknown-kind.json"));
    expect(fixture.success).toBe(false);
  });
});

describe("Collaboration peer authority", () => {
  it("round-trips a peer authority with directUser false", () => {
    const authority = {
      actor: "peer_agent",
      directUser: false,
      sourceHost: "codex",
      sourceSessionId: "session-codex-001",
      contractVersion: 3,
      allowedOutcome: "answer",
    };
    const result = CollaborationAuthoritySchema.safeParse(authority);
    expect(result.success).toBe(true);
  });

  it("rejects peer authority with directUser true", () => {
    const result = CollaborationAuthoritySchema.safeParse(
      validAuthority({ directUser: true }),
    );
    expect(result.success).toBe(false);
    const fixture = CollaborationMessageSchema.safeParse(
      loadInvalid("invalid-collab-peer-direct-user.json"),
    );
    expect(fixture.success).toBe(false);
  });

  it("rejects authority actors other than peer_agent", () => {
    expect(CollaborationAuthoritySchema.safeParse(validAuthority({ actor: "user" })).success).toBe(false);
    expect(CollaborationAuthoritySchema.safeParse(validAuthority({ actor: "system" })).success).toBe(false);
  });
});

describe("Collaboration message limits", () => {
  it("rejects ttlSeconds above maxTtlSeconds", () => {
    expect(CollaborationMessageSchema.safeParse(validMessage({ ttlSeconds: 86401 })).success).toBe(false);
    expect(CollaborationMessageSchema.safeParse(loadInvalid("invalid-collab-ttl-too-long.json")).success).toBe(false);
    expect(COLLABORATION_LIMITS.maxTtlSeconds).toBe(86400);
  });

  it("rejects hopCount above maxHops", () => {
    expect(CollaborationMessageSchema.safeParse(validMessage({ hopCount: 5 })).success).toBe(false);
    expect(CollaborationMessageSchema.safeParse(loadInvalid("invalid-collab-hop-exceeded.json")).success).toBe(false);
    expect(COLLABORATION_LIMITS.maxHops).toBe(4);
  });

  it("rejects more than maxContextRefs ContextRefs", () => {
    const ref = { refType: "evidence", refId: "E-001", resolutionStatus: "current" };
    const tooMany = Array.from({ length: 9 }, (_, i) => ({ ...ref, refId: `E-00${i}` }));
    expect(CollaborationMessageSchema.safeParse(validMessage({ contextRefs: tooMany })).success).toBe(false);
    expect(CollaborationMessageSchema.safeParse(loadInvalid("invalid-collab-too-many-context-refs.json")).success).toBe(false);
    expect(COLLABORATION_LIMITS.maxContextRefs).toBe(8);
  });

  it("rejects a body larger than maxMessageBytes", () => {
    const oversizedBody = "x".repeat(16385);
    expect(CollaborationMessageSchema.safeParse(validMessage({ body: oversizedBody })).success).toBe(false);
    expect(COLLABORATION_LIMITS.maxMessageBytes).toBe(16384);
  });

  it("rejects messages whose total text exceeds maxMessageBytes", () => {
    // summary (8 KiB) + body (8 KiB) = 16 KiB + a constraint pushes it over.
    const summary = "s".repeat(8192);
    const body = "b".repeat(8192);
    expect(CollaborationMessageSchema.safeParse(validMessage({ summary, body, constraints: ["x"] })).success).toBe(false);
    // Just at the boundary stays valid: exactly 16 KiB with nothing else.
    expect(CollaborationMessageSchema.safeParse(validMessage({
      summary: "s".repeat(8192),
      body: "b".repeat(8192),
      constraints: [],
      contextRefs: [],
      evidenceRefs: [],
    })).success).toBe(true);
  });

  it("rejects empty targetEndpointIds", () => {
    expect(CollaborationMessageSchema.safeParse(validMessage({ targetEndpointIds: [] })).success).toBe(false);
  });

  it("rejects empty summary", () => {
    expect(CollaborationMessageSchema.safeParse(validMessage({ summary: "" })).success).toBe(false);
  });
});

describe("Collaboration default config (doc 42 §11.2)", () => {
  it("matches the doc 42 defaults exactly", () => {
    const result = CollaborationConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        enabled: true,
        sameProjectOnly: true,
        allowRemoteTransport: false,
        defaultInboundPolicy: "accept",
        handoffRequiresUserConfirmation: true,
        maxHops: 4,
        maxOutstandingConsultsPerTask: 8,
        maxMessagesPerMinutePerTask: 12,
        maxMessageBytes: 16384,
        maxContextRefs: 8,
        defaultTtlSeconds: 1800,
        maxTtlSeconds: 86400,
        messageRetentionDays: 90,
      });
    }
  });

  it("rejects defaultTtlSeconds above maxTtlSeconds", () => {
    const result = CollaborationConfigSchema.safeParse({
      defaultTtlSeconds: 90000,
      maxTtlSeconds: 3600,
    });
    expect(result.success).toBe(false);
  });
});

describe("Collaboration ownership checks", () => {
  const thread = CollaborationThreadSchema.parse(loadFixture("valid-collaboration-thread.json"));
  const message = CollaborationMessageSchema.parse(loadFixture("valid-collaboration-message.json"));

  function expectOwnershipRejected(run: () => void): void {
    try {
      run();
      expect.unreachable("ownership check must reject");
    } catch (err) {
      expect(err).toBeInstanceOf(SestinaError);
      if (isSestinaError(err)) {
        expect(err.code).toBe(SestinaErrorCode.project_mismatch);
      }
    }
  }

  it("passes for a message consistent with its thread", () => {
    expect(() => { assertCollaborationOwnership(message, { thread }); }).not.toThrow();
  });

  it("rejects a message from a different thread", () => {
    const bad = { ...message, threadId: "01JGNK7V3PJDQK8TZ9B2M4X6Y1" as never };
    expectOwnershipRejected(() => { assertCollaborationOwnership(bad, { thread }); });
  });

  it("rejects a message with a different projectId than its thread", () => {
    const bad = { ...message, projectId: OTHER_PROJECT as never };
    expectOwnershipRejected(() => { assertCollaborationOwnership(bad, { thread }); });
  });

  it("rejects a message with a different taskId than its thread", () => {
    const bad = { ...message, taskId: OTHER_TASK as never };
    expectOwnershipRejected(() => { assertCollaborationOwnership(bad, { thread }); });
  });

  it("rejects a source endpoint that is not a thread participant", () => {
    const bad = { ...message, sourceEndpointId: "01JGNQAY6SMGTNB2CE5Q7A9BM1" as never };
    expectOwnershipRejected(() => { assertCollaborationOwnership(bad, { thread }); });
  });

  it("rejects a target endpoint that is not a thread participant", () => {
    const bad = { ...message, targetEndpointIds: ["01JGNQAY6SMGTNB2CE5Q7A9BM2"] as never };
    expectOwnershipRejected(() => { assertCollaborationOwnership(bad, { thread }); });
  });

  it("rejects endpoints bound to a different project", () => {
    const endpointProjects = new Map([
      [CODEC_ENDPOINT, { projectId: OTHER_PROJECT, taskId: TASK }],
      [CLAUDE_ENDPOINT, { projectId: PROJECT, taskId: TASK }],
    ]);
    expectOwnershipRejected(() => { assertCollaborationOwnership(message, { thread, endpointProjects }); });
  });

  it("rejects ContextRef/EvidenceRef ownership outside the project", () => {
    const refOwnerProjects = new Map([
      ["E-001", OTHER_PROJECT],
    ]);
    expectOwnershipRejected(() => { assertCollaborationOwnership(message, { thread, refOwnerProjects }); });
  });

  it("rejects unresolvable ContextRef/EvidenceRef ownership", () => {
    const refOwnerProjects = new Map<string, string>();
    expectOwnershipRejected(() => { assertCollaborationOwnership(message, { thread, refOwnerProjects }); });
  });
});
