import { describe, it, expect } from "vitest";
import {
  SestinaProjectSchema,
  TaskSchema,
  HostSessionSchema,
  TaskContractSchema,
  StandardEventSchema,
  EvidenceItemSchema,
  ClaimSchema,
  SituationAssertionSchema,
  JudgmentPacketSchema,
  JudgeOpinionSchema,
  DecisionSchema,
  DecisionRevisionSchema,
  OverrideGrantSchema,
  ConversationSchema,
  ConversationMessageSchema,
  ReviewItemSchema,
  DecisionTraceSchema,
  HostStreamEventSchema,
  ActivityEventSchema,
  NotificationStateSchema,
  HealthCheckSchema,
  generateId,
  ActorProvenanceSchema,
  PreviewConfirmationSchema,
  RpcRequestSchema,
  RpcSuccessSchema,
  RpcFailureSchema,
} from "../src/index.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FIXTURES = resolve(import.meta.dirname, "../../../tests/fixtures/schema");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(resolve(FIXTURES, name), "utf8")) as unknown;
}

describe("Schema round-trips", () => {
  it("round-trips SestinaProject", () => {
    const value = loadFixture("valid-project.json");
    const result = SestinaProjectSchema.safeParse(value);
    expect(result.success).toBe(true);
    if (result.success) {
      const roundTripped = SestinaProjectSchema.parse(JSON.parse(JSON.stringify(result.data)));
      expect(roundTripped).toEqual(result.data);
    }
  });

  it("round-trips Task", () => {
    const task = {
      taskId: "RCDW1C3BMD01S9BBS2NY3CEVDR",
      projectId: "JGP7HHVP7X6E3F3PBJ2RHB7YJW",
      title: "Research climate data anomalies",
      status: "active" as const,
      priority: "high" as const,
      createdAt: "2026-08-10T10:00:00.000Z",
      updatedAt: "2026-08-10T10:00:00.000Z",
    };
    const result = TaskSchema.safeParse(task);
    expect(result.success).toBe(true);
    if (result.success) {
      const roundTripped = TaskSchema.parse(JSON.parse(JSON.stringify(result.data)));
      expect(roundTripped).toEqual(result.data);
    }
  });

  it("round-trips HostSession", () => {
    const session = {
      sessionId: "5A86VWS1MD4MX66HAJXYY3RW3M",
      taskId: "RCDW1C3BMD01S9BBS2NY3CEVDR",
      host: "codex" as const,
      hostSessionId: "host-session-123",
      visibilityLevel: "tool_lifecycle" as const,
      status: "connected" as const,
      capabilities: ["tool_interception", "stream_events"],
      startedAt: "2026-08-10T10:00:00.000Z",
    };
    const result = HostSessionSchema.safeParse(session);
    expect(result.success).toBe(true);
    if (result.success) {
      const roundTripped = HostSessionSchema.parse(JSON.parse(JSON.stringify(result.data)));
      expect(roundTripped).toEqual(result.data);
    }
  });

  it("round-trips TaskContract", () => {
    const value = loadFixture("valid-contract.json");
    const result = TaskContractSchema.safeParse(value);
    expect(result.success).toBe(true);
    if (result.success) {
      const roundTripped = TaskContractSchema.parse(JSON.parse(JSON.stringify(result.data)));
      expect(roundTripped).toEqual(result.data);
    }
  });

  it("round-trips StandardEvent", () => {
    const value = loadFixture("valid-event.json");
    const result = StandardEventSchema.safeParse(value);
    expect(result.success).toBe(true);
    if (result.success) {
      const roundTripped = StandardEventSchema.parse(JSON.parse(JSON.stringify(result.data)));
      expect(roundTripped).toEqual(result.data);
    }
  });

  it("requires rawPayloadHash to be a lowercase sha256 hex digest", () => {
    const base = loadFixture("valid-event.json") as Record<string, unknown>;
    const valid = StandardEventSchema.safeParse({
      ...base,
      rawPayloadHash: "a".repeat(64),
    });
    expect(valid.success).toBe(true);
    // "sha256:test123" is the value this repo's fixture used to ship —
    // keeping it rejected is the point of the format pin.
    for (const bad of [
      "sha256:test123",
      "",
      "not-hex",
      "A".repeat(64),
      "a".repeat(63),
    ]) {
      expect(
        StandardEventSchema.safeParse({ ...base, rawPayloadHash: bad }).success,
      ).toBe(false);
    }
  });

  it("round-trips EvidenceItem", () => {
    const evidence = {
      evidenceId: "E-001",
      taskId: "RCDW1C3BMD01S9BBS2NY3CEVDR",
      type: "primary_source" as const,
      locator: {
        type: "path" as const,
        value: "/project/data/sensor_2024.csv",
      },
      status: "verified" as const,
      provenance: "User uploaded dataset",
      recordedBy: "user" as const,
      version: 1,
    };
    const result = EvidenceItemSchema.safeParse(evidence);
    expect(result.success).toBe(true);
    if (result.success) {
      const roundTripped = EvidenceItemSchema.parse(JSON.parse(JSON.stringify(result.data)));
      expect(roundTripped).toEqual(result.data);
    }
  });

  it("round-trips Claim", () => {
    const claim = {
      claimId: "C-001",
      taskId: "RCDW1C3BMD01S9BBS2NY3CEVDR",
      text: "The dataset contains valid temperature readings",
      type: "factual" as const,
      importance: "critical" as const,
      confidence: 0.95,
      evidenceRefs: ["E-001"],
      status: "supported" as const,
      limitations: ["Based on format validation only"],
      provenance: { actor: "agent", channel: "runtime", directUser: false },
      createdAt: "2026-08-10T10:00:00.000Z",
      version: 1,
    };
    const result = ClaimSchema.safeParse(claim);
    expect(result.success).toBe(true);
    if (result.success) {
      const roundTripped = ClaimSchema.parse(JSON.parse(JSON.stringify(result.data)));
      expect(roundTripped).toEqual(result.data);
    }
  });

  it("round-trips SituationAssertion", () => {
    const value = loadFixture("valid-situation-assertion.json");
    const result = SituationAssertionSchema.safeParse(value);
    expect(result.success).toBe(true);
    if (result.success) {
      const roundTripped = SituationAssertionSchema.parse(JSON.parse(JSON.stringify(result.data)));
      expect(roundTripped).toEqual(result.data);
    }
  });

  it("round-trips JudgmentPacket", () => {
    const packet = {
      schemaVersion: "1.0.0" as const,
      judgmentId: "J-001",
      task: {
        objective: "Analyze sensor data",
        currentDeliverables: ["Statistical summary"],
      },
      relevantBoundaries: [
        {
          boundaryId: "B-001",
          kind: "scope" as const,
          severity: "hard" as const,
          statement: "Do not send data externally",
        },
      ],
      candidateIssueTypes: ["scope_inflation" as const],
      currentEvent: {
        eventType: "pre_tool" as const,
        toolName: "write_file",
        category: "write" as const,
        resourceRefs: ["/project/output/report.md"],
        isExternal: false,
      },
      relevantEvidence: [],
      recentCorrections: [],
      requestedDecision: "action" as const,
      allowedOpinionActions: ["allow" as const, "block" as const],
      privacy: {
        redactions: 0,
        originalChars: 5000,
        sentChars: 5000,
      },
    };
    const result = JudgmentPacketSchema.safeParse(packet);
    expect(result.success).toBe(true);
    if (result.success) {
      const roundTripped = JudgmentPacketSchema.parse(JSON.parse(JSON.stringify(result.data)));
      expect(roundTripped).toEqual(result.data);
    }
  });

  it("round-trips JudgeOpinion", () => {
    const opinion = {
      issueDetected: true,
      issueTypes: ["scope_inflation" as const],
      severity: 3,
      confidence: 0.9,
      recommendedAction: "block" as const,
      boundaryIds: ["B-001"],
      reason: "Writing to protected output path",
      recoverySteps: ["Provide evidence or use temporary path"],
      evidenceGaps: [],
    };
    const result = JudgeOpinionSchema.safeParse(opinion);
    expect(result.success).toBe(true);
    if (result.success) {
      const roundTripped = JudgeOpinionSchema.parse(JSON.parse(JSON.stringify(result.data)));
      expect(roundTripped).toEqual(result.data);
    }
  });

  it("round-trips Decision", () => {
    const value = loadFixture("valid-decision.json");
    const result = DecisionSchema.safeParse(value);
    expect(result.success).toBe(true);
    if (result.success) {
      const roundTripped = DecisionSchema.parse(JSON.parse(JSON.stringify(result.data)));
      expect(roundTripped).toEqual(result.data);
    }
  });

  it("round-trips DecisionRevision", () => {
    const revision = {
      revisionId: "REV-001",
      originalDecisionId: "33G0R2J5TS2ZN1Z42ME80RK5AM",
      revisedById: "3BVTKJW69H7D1AJSME7JH69AQC",
      reason: "New evidence provided",
      newCategory: "allow" as const,
      newReason: "User confirmed intentional update",
      createdAt: "2026-08-10T11:00:00.000Z",
    };
    const result = DecisionRevisionSchema.safeParse(revision);
    expect(result.success).toBe(true);
    if (result.success) {
      const roundTripped = DecisionRevisionSchema.parse(JSON.parse(JSON.stringify(result.data)));
      expect(roundTripped).toEqual(result.data);
    }
  });

  it("round-trips OverrideGrant", () => {
    const override = {
      overrideId: "OV-001",
      decisionId: "33G0R2J5TS2ZN1Z42ME80RK5AM",
      reason: "User explicitly allows this write",
      scope: "single_use" as const,
      boundaryIds: ["B-001"],
      issuedBy: {
        actor: "user" as const,
        channel: "desktop" as const,
        directUser: true,
      },
      issuedAt: "2026-08-10T10:06:00.000Z",
      status: "active" as const,
    };
    const result = OverrideGrantSchema.safeParse(override);
    expect(result.success).toBe(true);
    if (result.success) {
      const roundTripped = OverrideGrantSchema.parse(JSON.parse(JSON.stringify(result.data)));
      expect(roundTripped).toEqual(result.data);
    }
  });

  it("round-trips Conversation", () => {
    const value = loadFixture("valid-conversation.json");
    const result = ConversationSchema.safeParse(value);
    expect(result.success).toBe(true);
    if (result.success) {
      const roundTripped = ConversationSchema.parse(JSON.parse(JSON.stringify(result.data)));
      expect(roundTripped).toEqual(result.data);
    }
  });

  it("round-trips ConversationMessage", () => {
    const message = {
      messageId: "MSG-001",
      conversationId: "1PN83TSXT93AK3V4TQW7JXNQ2G",
      role: "sestina" as const,
      body: "I have blocked the write operation because it targets a protected path.",
      contextRefs: [],
      confirmable: false,
      status: "complete" as const,
      createdAt: "2026-08-10T12:00:00.000Z",
    };
    const result = ConversationMessageSchema.safeParse(message);
    expect(result.success).toBe(true);
    if (result.success) {
      const roundTripped = ConversationMessageSchema.parse(JSON.parse(JSON.stringify(result.data)));
      expect(roundTripped).toEqual(result.data);
    }
  });

  it("round-trips ReviewItem", () => {
    const value = loadFixture("valid-review.json");
    const result = ReviewItemSchema.safeParse(value);
    expect(result.success).toBe(true);
    if (result.success) {
      const roundTripped = ReviewItemSchema.parse(JSON.parse(JSON.stringify(result.data)));
      expect(roundTripped).toEqual(result.data);
    }
  });

  it("round-trips DecisionTrace", () => {
    const value = loadFixture("valid-decision-trace.json");
    const result = DecisionTraceSchema.safeParse(value);
    expect(result.success).toBe(true);
    if (result.success) {
      const roundTripped = DecisionTraceSchema.parse(JSON.parse(JSON.stringify(result.data)));
      expect(roundTripped).toEqual(result.data);
    }
  });

  it("round-trips HostStreamEvent", () => {
    const value = loadFixture("valid-host-stream.json");
    const result = HostStreamEventSchema.safeParse(value);
    expect(result.success).toBe(true);
    if (result.success) {
      const roundTripped = HostStreamEventSchema.parse(JSON.parse(JSON.stringify(result.data)));
      expect(roundTripped).toEqual(result.data);
    }
  });

  it("round-trips ActivityEvent", () => {
    const activity = {
      activityId: "A-001",
      occurredAt: "2026-08-10T10:05:00.200Z",
      eventType: "decision_blocked",
      projectId: "JGP7HHVP7X6E3F3PBJ2RHB7YJW",
      taskId: "RCDW1C3BMD01S9BBS2NY3CEVDR",
      decisionId: "33G0R2J5TS2ZN1Z42ME80RK5AM",
      summary: "Agent blocked from writing to report.md",
      category: "block" as const,
      attentionLevel: "badge" as const,
    };
    const result = ActivityEventSchema.safeParse(activity);
    expect(result.success).toBe(true);
    if (result.success) {
      const roundTripped = ActivityEventSchema.parse(JSON.parse(JSON.stringify(result.data)));
      expect(roundTripped).toEqual(result.data);
    }
  });

  it("round-trips NotificationState", () => {
    const notification = {
      notificationId: "N-001",
      projectId: generateId(),
      activityId: "A-001",
      deliveredAt: "2026-08-10T10:05:01.000Z",
      channel: "feed_item" as const,
      acknowledged: false,
    };
    const result = NotificationStateSchema.safeParse(notification);
    expect(result.success).toBe(true);
    if (result.success) {
      const roundTripped = NotificationStateSchema.parse(JSON.parse(JSON.stringify(result.data)));
      expect(roundTripped).toEqual(result.data);
    }
  });

  it("rejects NotificationState without a project", () => {
    const notification = {
      notificationId: "N-002",
      activityId: "A-002",
      deliveredAt: "2026-08-10T10:05:01.000Z",
      channel: "feed_item" as const,
      acknowledged: false,
    };
    expect(NotificationStateSchema.safeParse(notification).success).toBe(false);
  });

  it("round-trips HealthCheck", () => {
    const health = {
      component: "sqlite" as const,
      status: "healthy" as const,
      message: "Database connection OK",
      checkedAt: "2026-08-10T10:00:00.000Z",
      latencyMs: 2,
    };
    const result = HealthCheckSchema.safeParse(health);
    expect(result.success).toBe(true);
    if (result.success) {
      const roundTripped = HealthCheckSchema.parse(JSON.parse(JSON.stringify(result.data)));
      expect(roundTripped).toEqual(result.data);
    }
  });

  it("round-trips ActorProvenance", () => {
    const provenance = {
      actor: "user" as const,
      channel: "desktop" as const,
      directUser: true,
    };
    const result = ActorProvenanceSchema.safeParse(provenance);
    expect(result.success).toBe(true);
    if (result.success) {
      const roundTripped = ActorProvenanceSchema.parse(JSON.parse(JSON.stringify(result.data)));
      expect(roundTripped).toEqual(result.data);
    }
  });

  it("round-trips PreviewConfirmation", () => {
    const confirmation = {
      previewHash: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
      expectedVersion: 1,
      provenance: {
        actor: "user" as const,
        channel: "desktop" as const,
        directUser: true,
      },
    };
    const result = PreviewConfirmationSchema.safeParse(confirmation);
    expect(result.success).toBe(true);
    if (result.success) {
      const roundTripped = PreviewConfirmationSchema.parse(JSON.parse(JSON.stringify(result.data)));
      expect(roundTripped).toEqual(result.data);
    }
  });
});

describe("IPC round-trips", () => {
  it("round-trips RpcRequest", () => {
    const req = {
      jsonrpc: "2.0" as const,
      id: "req-1",
      method: "project.list",
      meta: {
        protocolVersion: "1.0.0" as const,
        clientRole: "cli" as const,
        clientVersion: "0.1.0",
        timestamp: "2026-08-10T12:00:00.000Z",
        deadlineMs: 5000,
        maxResponseBytes: 262144,
      },
    };
    const result = RpcRequestSchema.safeParse(req);
    expect(result.success).toBe(true);
    if (result.success) {
      const roundTripped = RpcRequestSchema.parse(JSON.parse(JSON.stringify(result.data)));
      expect(roundTripped).toEqual(result.data);
    }
  });

  it("round-trips RpcSuccess", () => {
    const res = {
      jsonrpc: "2.0" as const,
      id: "req-1",
      result: { projects: [] },
      meta: {
        protocolVersion: "1.0.0" as const,
        serverVersion: "0.1.0",
        processingMs: 15,
      },
    };
    const result = RpcSuccessSchema.safeParse(res);
    expect(result.success).toBe(true);
    if (result.success) {
      const roundTripped = RpcSuccessSchema.parse(JSON.parse(JSON.stringify(result.data)));
      expect(roundTripped).toEqual(result.data);
    }
  });

  it("round-trips RpcFailure", () => {
    const fail = {
      jsonrpc: "2.0" as const,
      id: "req-1",
      error: {
        code: "task_not_found" as const,
        message: "Task not found",
      },
      meta: {
        protocolVersion: "1.0.0" as const,
        serverVersion: "0.1.0",
      },
    };
    const result = RpcFailureSchema.safeParse(fail);
    expect(result.success).toBe(true);
    if (result.success) {
      const roundTripped = RpcFailureSchema.parse(JSON.parse(JSON.stringify(result.data)));
      expect(roundTripped).toEqual(result.data);
    }
  });
});
