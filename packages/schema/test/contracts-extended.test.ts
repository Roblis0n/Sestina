import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  SourceSpanSchema,
  sourceSpanExtract,
  ContractSourceTierSchema,
  CONTRACT_SOURCE_TIER_PRECEDENCE,
  sourceTypeToTier,
  ContractFieldPathSchema,
  ContractPatchOperationSchema,
  ContractPatchProposalSchema,
  MaterialAmbiguitySchema,
  SemanticCompletenessSchema,
  ContractTemplateSchema,
  CorrectionSchema,
  CorrectionPromotionSchema,
  HandoffPreauthorizationSchema,
  HandoffAuthorizationRequestSchema,
  CollaborationAuthorityResultSchema,
  TaskContractSchema,
  generateId,
} from "../src/index.js";

const FIXTURES = resolve(import.meta.dirname, "../../../tests/fixtures/schema");
const INVALID = resolve(FIXTURES, "invalid");

function loadValid(name: string): unknown {
  return JSON.parse(readFileSync(resolve(FIXTURES, name), "utf8")) as unknown;
}

function loadInvalid(name: string): unknown {
  return JSON.parse(readFileSync(resolve(INVALID, name), "utf8")) as unknown;
}

describe("SourceSpan", () => {
  it("requires integer code-unit bounds with end >= start", () => {
    expect(SourceSpanSchema.safeParse({ start: 0, end: 5 }).success).toBe(true);
    expect(SourceSpanSchema.safeParse({ start: 0, end: 0 }).success).toBe(true);
    expect(SourceSpanSchema.safeParse({ start: 5, end: 4 }).success).toBe(false);
    expect(SourceSpanSchema.safeParse({ start: -1, end: 2 }).success).toBe(false);
    expect(SourceSpanSchema.safeParse({ start: 1.5, end: 3 }).success).toBe(false);
  });

  it("documents and enforces UTF-16 code-unit indexing with clean slice", () => {
    // Index unit is UTF-16 code units, start inclusive, end exclusive.
    const text = "完成主题分析，核查不要替代主任务 😀";
    // "主题分析" starts at code unit 2, ends at 6 (exclusive).
    const span = { start: 2, end: 6 };
    expect(sourceSpanExtract(text, span)).toBe("主题分析");
    // A span that splits a surrogate pair (emoji occupies 2 code units)
    // is rejected by the extractor: slice would yield an unpaired surrogate.
    const emojiStart = text.indexOf("😀");
    expect(sourceSpanExtract(text, { start: emojiStart, end: emojiStart + 1 })).toBeUndefined();
    // Full emoji span (both halves) is clean.
    expect(sourceSpanExtract(text, { start: emojiStart, end: emojiStart + 2 })).toBe("😀");
  });
});

describe("ContractSourceTier", () => {
  it("defines the fixed 7-level precedence", () => {
    expect(ContractSourceTierSchema.options).toEqual([
      "system_safety",
      "user_directive",
      "confirmed_correction",
      "project_rule",
      "user_default",
      "template",
      "inferred",
    ]);
    expect(CONTRACT_SOURCE_TIER_PRECEDENCE).toEqual([
      "system_safety",
      "user_directive",
      "confirmed_correction",
      "project_rule",
      "user_default",
      "template",
      "inferred",
    ]);
  });

  it("maps boundary source types onto tiers", () => {
    expect(sourceTypeToTier("system_safety")).toBe("system_safety");
    expect(sourceTypeToTier("user_directive")).toBe("user_directive");
    expect(sourceTypeToTier("correction")).toBe("confirmed_correction");
    expect(sourceTypeToTier("project_rule")).toBe("project_rule");
    expect(sourceTypeToTier("user_default")).toBe("user_default");
    expect(sourceTypeToTier("template")).toBe("template");
    expect(sourceTypeToTier("inferred")).toBe("inferred");
  });
});

describe("ContractFieldPath", () => {
  it("accepts only whitelisted sections and fields", () => {
    expect(ContractFieldPathSchema.safeParse({ section: "title" }).success).toBe(true);
    expect(
      ContractFieldPathSchema.safeParse({ section: "objective", field: "primary" }).success,
    ).toBe(true);
    expect(
      ContractFieldPathSchema.safeParse({ section: "budgets", field: "maxToolCallsPerTask" })
        .success,
    ).toBe(true);
    // No raw JSON Pointer: "/objective/primary" is not a valid path.
    expect(ContractFieldPathSchema.safeParse("/objective/primary").success).toBe(false);
    // ID and task-attribution fields are not patchable.
    expect(ContractFieldPathSchema.safeParse({ section: "contractId" }).success).toBe(false);
    expect(ContractFieldPathSchema.safeParse({ section: "taskId" }).success).toBe(false);
    expect(ContractFieldPathSchema.safeParse({ section: "version" }).success).toBe(false);
  });

  it("rejects __proto__ and constructor as field names", () => {
    expect(
      ContractFieldPathSchema.safeParse({ section: "objective", field: "__proto__" }).success,
    ).toBe(false);
    expect(
      ContractFieldPathSchema.safeParse({ section: "objective", field: "constructor" }).success,
    ).toBe(false);
  });
});

describe("ContractPatchOperation", () => {
  it("accepts whitelisted operations", () => {
    const boundary = {
      boundaryId: "B-001",
      kind: "scope",
      severity: "hard",
      statement: "不要删除任何文件",
      source: { type: "user_directive", confidence: 1 },
      owner: "user",
      overridable: false,
      appliesTo: {},
      confidence: 1,
      status: "active",
      validFrom: "2026-08-15T00:00:00.000Z",
    };
    expect(
      ContractPatchOperationSchema.safeParse({
        op: "add_boundary",
        boundary,
        sourceSpan: { start: 0, end: 8 },
      }).success,
    ).toBe(true);
    expect(
      ContractPatchOperationSchema.safeParse({
        op: "set_field",
        path: { section: "objective", field: "priority" },
        value: "critical",
      }).success,
    ).toBe(true);
    expect(
      ContractPatchOperationSchema.safeParse({
        op: "remove_deliverable",
        deliverableId: "D-001",
      }).success,
    ).toBe(true);
  });

  it("rejects unknown operations, unknown fields, and out-of-range indices", () => {
    // Unknown op is not silently dropped.
    expect(ContractPatchOperationSchema.safeParse({ op: "delete_everything" }).success).toBe(false);
    // Unknown extra key on a known op is rejected (strict).
    expect(
      ContractPatchOperationSchema.safeParse({
        op: "remove_deliverable",
        deliverableId: "D-001",
        removeAll: true,
      }).success,
    ).toBe(false);
    // A bare JSON Pointer cannot reach anything.
    expect(
      ContractPatchOperationSchema.safeParse({
        op: "set_field",
        path: "/boundaries/0/severity",
        value: "hard",
      }).success,
    ).toBe(false);
    // Path fields are strings, not indices into arbitrary internals.
    expect(
      ContractPatchOperationSchema.safeParse({
        op: "set_field",
        path: { section: "deliverables", itemIndex: 999999 },
        value: {},
      }).success,
    ).toBe(false);
    // NaN and non-finite values are rejected wherever numbers appear.
    expect(
      ContractPatchOperationSchema.safeParse({
        op: "add_boundary",
        boundary: {
          boundaryId: "B-002",
          kind: "budget",
          severity: "hard",
          statement: "x",
          source: { type: "user_directive", confidence: NaN },
          owner: "user",
          overridable: false,
          appliesTo: {},
          confidence: NaN,
          status: "active",
          validFrom: "2026-08-15T00:00:00.000Z",
        },
      }).success,
    ).toBe(false);
  });

  it("rejects __proto__ and constructor own keys even after JSON.parse", () => {
    // zod's .strict() does not flag prototype-chain key names as extra keys,
    // but JSON.parse creates them as OWN properties — the schema must still
    // refuse them so untrusted input can never smuggle a polluted object.
    const withProto = JSON.parse(
      '{"op":"remove_deliverable","deliverableId":"D-001","__proto__":{"polluted":true}}',
    ) as unknown;
    expect(Object.keys(withProto as object)).toContain("__proto__");
    expect(ContractPatchOperationSchema.safeParse(withProto).success).toBe(false);

    const withConstructor = JSON.parse(
      '{"op":"remove_deliverable","deliverableId":"D-001","constructor":{"prototype":{}}}',
    ) as unknown;
    expect(Object.keys(withConstructor as object)).toContain("constructor");
    expect(ContractPatchOperationSchema.safeParse(withConstructor).success).toBe(false);

    // The proposal envelope is guarded the same way.
    const pollutedProposal = JSON.parse(
      '{"schemaVersion":"1.0.0","proposalId":"KK20FHXCE557SE7BC7Q14C8EF8",' +
        '"contractId":"KK20FHXCE557SE7BC7Q14C8EF8","taskId":"KK20FHXCE557SE7BC7Q14C8EF8",' +
        '"expectedVersion":1,"operations":[{"op":"remove_deliverable","deliverableId":"D-001"}],' +
        '"sourceTier":"inferred","owner":"inferred","sourceRefs":[],"ambiguities":[],' +
        '"createdAt":"2026-08-15T00:00:00.000Z","__proto__":{"polluted":true}}',
    ) as unknown;
    expect(ContractPatchProposalSchema.safeParse(pollutedProposal).success).toBe(false);
  });
});

describe("ContractPatchProposal", () => {
  const baseProposal = {
    schemaVersion: "1.0.0",
    proposalId: generateId(),
    contractId: generateId(),
    taskId: generateId(),
    expectedVersion: 1,
    operations: [
      {
        op: "set_field",
        path: { section: "title" },
        value: "新标题",
      },
    ],
    sourceRefs: [],
    ambiguities: [],
    createdAt: "2026-08-15T00:00:00.000Z",
  };

  it("parses a user-directive proposal", () => {
    const result = ContractPatchProposalSchema.safeParse({
      ...baseProposal,
      sourceTier: "user_directive",
      owner: "user",
    });
    expect(result.success).toBe(true);
  });

  it("forces inferred proposals to have inferred ownership", () => {
    expect(
      ContractPatchProposalSchema.safeParse({
        ...baseProposal,
        sourceTier: "inferred",
        owner: "inferred",
      }).success,
    ).toBe(true);
    // Inferred proposals can never claim user ownership.
    expect(
      ContractPatchProposalSchema.safeParse({
        ...baseProposal,
        sourceTier: "inferred",
        owner: "user",
      }).success,
    ).toBe(false);
  });

  it("rejects proposals without operations", () => {
    expect(
      ContractPatchProposalSchema.safeParse({
        ...baseProposal,
        operations: [],
        sourceTier: "template",
        owner: "project",
      }).success,
    ).toBe(false);
  });
});

describe("MaterialAmbiguity", () => {
  it("parses a high-impact ambiguity with source spans", () => {
    const result = MaterialAmbiguitySchema.safeParse({
      ambiguityId: generateId(),
      kind: "completion_criteria_unclear",
      description: "无法从文本确定验收标准",
      excerpt: "做好就行",
      sourceSpans: [{ start: 3, end: 7 }],
      decisionRequired: true,
    });
    expect(result.success).toBe(true);
  });

  it("requires at least one source span", () => {
    expect(
      MaterialAmbiguitySchema.safeParse({
        ambiguityId: generateId(),
        kind: "completion_criteria_unclear",
        description: "x",
        sourceSpans: [],
        decisionRequired: true,
      }).success,
    ).toBe(false);
  });
});

describe("SemanticCompleteness", () => {
  it("is the honest no-provider carrier and never claims semantic verification", () => {
    expect(
      SemanticCompletenessSchema.safeParse({
        semanticExtractorRan: false,
        completeness: "schema_valid_only",
        unknownFields: ["stopConditions", "budgets"],
        notes: "无 Provider：语义可能不完整，未运行语义检查",
      }).success,
    ).toBe(true);
    // "semantically_verified" is not a state a deterministic compiler may
    // reach — it is reserved for provider/user paths and must not appear
    // from the no-provider compile path (enforced in packages/contracts).
    expect(
      SemanticCompletenessSchema.safeParse({
        semanticExtractorRan: false,
        completeness: "semantically_verified",
        unknownFields: [],
        notes: "",
      }).success,
    ).toBe(false);
  });
});

describe("ContractTemplate", () => {
  it("parses a template with defaults", () => {
    const result = ContractTemplateSchema.safeParse({
      schemaVersion: "1.0.0",
      templateId: "template-software-v1",
      kind: "software",
      name: "软件任务模板",
      defaults: {
        evidencePolicy: {
          requireSourceForClaims: true,
          minEvidenceLevel: "reference",
          allowUserTestimony: true,
        },
        authority: {
          executorCanChooseMethods: true,
          executorCanProposeScope: false,
          executorCanSelfReview: false,
          overridesRequireUserConfirmation: true,
        },
        budgets: {},
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects hard boundaries inside a template", () => {
    const result = ContractTemplateSchema.safeParse({
      schemaVersion: "1.0.0",
      templateId: "template-software-v1",
      kind: "software",
      name: "软件任务模板",
      defaults: {
        evidencePolicy: {
          requireSourceForClaims: true,
          minEvidenceLevel: "reference",
          allowUserTestimony: true,
        },
        authority: {
          executorCanChooseMethods: true,
          executorCanProposeScope: false,
          executorCanSelfReview: false,
          overridesRequireUserConfirmation: true,
        },
        budgets: {},
        boundaries: [
          {
            boundaryId: "B-TPL-1",
            kind: "action",
            severity: "hard",
            statement: "模板不允许硬边界",
            source: { type: "template", confidence: 1 },
            owner: "project",
            overridable: true,
            appliesTo: {},
            confidence: 1,
            status: "active",
            validFrom: "2026-08-15T00:00:00.000Z",
          },
        ],
      },
    });
    expect(result.success).toBe(false);
  });
});

describe("Correction", () => {
  it("round-trips a task-scoped direct-user confirmed correction", () => {
    const value = loadValid("valid-correction.json");
    const result = CorrectionSchema.safeParse(value);
    expect(result.success).toBe(true);
    if (result.success) {
      const roundTripped = CorrectionSchema.parse(JSON.parse(JSON.stringify(result.data)));
      expect(roundTripped).toEqual(result.data);
    }
  });

  it("rejects a peer-sourced correction that claims confirmation", () => {
    const value = loadInvalid("invalid-correction-peer-confirmed.json");
    expect(CorrectionSchema.safeParse(value).success).toBe(false);
  });

  it("rejects unknown failure classes", () => {
    const value = loadValid("valid-correction.json") as Record<string, unknown>;
    expect(
      CorrectionSchema.safeParse({ ...value, failureClass: "hallucinated_class" }).success,
    ).toBe(false);
  });
});

describe("CorrectionPromotion", () => {
  it("parses a structured promotion proposal", () => {
    const result = CorrectionPromotionSchema.safeParse({
      promotionId: generateId(),
      fromCorrectionId: generateId(),
      fromScope: "task",
      toScope: "project",
      proposedBoundary: {
        boundaryId: "B-PROMO-1",
        kind: "process",
        severity: "soft",
        statement: "所有任务都必须先运行测试",
        source: { type: "correction", confidence: 1 },
        owner: "project",
        overridable: true,
        appliesTo: {},
        confidence: 1,
        status: "active",
        validFrom: "2026-08-15T00:00:00.000Z",
      },
      requiresConfirmation: true,
      previewHash: "a".repeat(64),
      createdAt: "2026-08-15T00:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("always requires confirmation", () => {
    expect(
      CorrectionPromotionSchema.safeParse({
        promotionId: generateId(),
        fromCorrectionId: generateId(),
        fromScope: "task",
        toScope: "project",
        proposedBoundary: {
          boundaryId: "B-PROMO-2",
          kind: "process",
          severity: "soft",
          statement: "x",
          source: { type: "correction", confidence: 1 },
          owner: "project",
          overridable: true,
          appliesTo: {},
          confidence: 1,
          status: "active",
          validFrom: "2026-08-15T00:00:00.000Z",
        },
        requiresConfirmation: false,
        previewHash: "b".repeat(64),
        createdAt: "2026-08-15T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});

describe("HandoffPreauthorization", () => {
  it("round-trips a precise preauthorization", () => {
    const value = loadValid("valid-handoff-preauthorization.json");
    const result = HandoffPreauthorizationSchema.safeParse(value);
    expect(result.success).toBe(true);
    if (result.success) {
      const roundTripped = HandoffPreauthorizationSchema.parse(
        JSON.parse(JSON.stringify(result.data)),
      );
      expect(roundTripped).toEqual(result.data);
    }
  });

  it("rejects a peer-sourced confirmation (peer can never confirm)", () => {
    const value = loadInvalid("invalid-preauthorization-peer-confirmed.json");
    expect(HandoffPreauthorizationSchema.safeParse(value).success).toBe(false);
  });

  it("rejects unknown action categories", () => {
    const value = loadValid("valid-handoff-preauthorization.json") as Record<string, unknown>;
    expect(
      HandoffPreauthorizationSchema.safeParse({
        ...value,
        actionCategories: ["publish", "destroy_the_world"],
      }).success,
    ).toBe(false);
  });
});

describe("HandoffAuthorizationRequest", () => {
  const request = {
    projectId: generateId(),
    taskId: generateId(),
    handoffRef: "handoff-message-ref",
    currentContractVersion: 3,
    preauthorizations: [],
    source: { host: "codex" },
    target: { host: "claude_code" },
    deliverableIds: ["D-001"],
    requestedPaths: ["src/parser"],
    actionCategories: ["write"],
    now: "2026-08-15T00:00:00.000Z",
  };

  it("parses a valid request", () => {
    expect(HandoffAuthorizationRequestSchema.safeParse(request).success).toBe(true);
  });

  it("accepts a one-shot user confirmation bound to the same handoff", () => {
    expect(
      HandoffAuthorizationRequestSchema.safeParse({
        ...request,
        userConfirmation: {
          userConfirmationId: generateId(),
          handoffRef: "handoff-message-ref",
          projectId: request.projectId,
          taskId: request.taskId,
          source: request.source,
          target: request.target,
          deliverableIds: request.deliverableIds,
          requestedPaths: request.requestedPaths,
          actionCategories: request.actionCategories,
          confirmedBy: {
            actor: "user",
            channel: "desktop",
            directUser: true,
          },
          confirmedAt: "2026-08-15T00:00:00.000Z",
          messageRef: "handoff-message-ref",
        },
      }).success,
    ).toBe(true);
  });

  it("rejects a user confirmation that does not bind to the held handoff", () => {
    // Without the held-handoff identity a copied confirmation could authorize
    // an arbitrary different request — the schema must require the binding.
    expect(
      HandoffAuthorizationRequestSchema.safeParse({
        ...request,
        userConfirmation: {
          userConfirmationId: generateId(),
          confirmedBy: {
            actor: "user",
            channel: "desktop",
            directUser: true,
          },
          confirmedAt: "2026-08-15T00:00:00.000Z",
          messageRef: "handoff-message-ref",
        },
      }).success,
    ).toBe(false);
  });

  it("rejects a peer-channel confirmation", () => {
    expect(
      HandoffAuthorizationRequestSchema.safeParse({
        ...request,
        userConfirmation: {
          userConfirmationId: generateId(),
          handoffRef: "handoff-message-ref",
          projectId: request.projectId,
          taskId: request.taskId,
          source: request.source,
          target: request.target,
          deliverableIds: request.deliverableIds,
          requestedPaths: request.requestedPaths,
          actionCategories: request.actionCategories,
          confirmedBy: {
            actor: "user",
            channel: "host",
            directUser: false,
          },
          confirmedAt: "2026-08-15T00:00:00.000Z",
          messageRef: "handoff-message-ref",
        },
      }).success,
    ).toBe(false);
  });
});

describe("CollaborationAuthorityResult", () => {
  it("parses all three outcomes", () => {
    expect(
      CollaborationAuthorityResultSchema.safeParse({ decision: "authorized", by: "preauthorization", preauthorizationId: generateId() })
        .success,
    ).toBe(true);
    expect(
      CollaborationAuthorityResultSchema.safeParse({
        decision: "needs_user_confirmation",
        reasons: ["路径越界"],
      }).success,
    ).toBe(true);
    expect(
      CollaborationAuthorityResultSchema.safeParse({ decision: "no_authority", reasons: [] }).success,
    ).toBe(true);
    expect(
      CollaborationAuthorityResultSchema.safeParse({ decision: "allow_queue" }).success,
    ).toBe(false);
  });
});

describe("TaskContract forward compatibility", () => {
  it("still parses the pre-Task-9 contract fixture", () => {
    const old = loadValid("valid-contract.json");
    expect(TaskContractSchema.safeParse(old).success).toBe(true);
  });

  it("parses a new contract with full metadata and parses it again after JSON round-trip", () => {
    const value = loadValid("valid-contract.json") as Record<string, unknown>;
    const extended = {
      ...value,
      semanticCompleteness: {
        semanticExtractorRan: false,
        completeness: "schema_valid_only",
        unknownFields: ["budgets"],
        notes: "无 Provider：语义可能不完整",
      },
      preauthorizations: [],
    };
    const result = TaskContractSchema.safeParse(extended);
    expect(result.success).toBe(true);
    if (result.success) {
      const roundTripped = TaskContractSchema.parse(JSON.parse(JSON.stringify(result.data)));
      expect(roundTripped).toEqual(result.data);
    }
  });
});
