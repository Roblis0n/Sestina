import { describe, it, expect } from "vitest";
import {
  ActorProvenanceSchema,
  ClaimEvidenceLinkSchema,
  ClaimSchema,
  CompletionFactsSchema,
  DeliverableLedgerEntrySchema,
  DeliverableWaiverSchema,
  EvidenceItemSchema,
  EvidenceLocatorSchema,
  MAX_ASSERTION_CONFIRMATIONS,
  MAX_ASSERTION_LIMITATIONS,
  MAX_ASSERTION_SOURCE_REFS,
  MAX_CLAIM_EVIDENCE_REFS,
  MAX_CLAIM_LIMITATIONS,
  MAX_COMPLETION_EVIDENCE_GAPS,
  MAX_DELIVERABLE_EVIDENCE_REFS,
  SituationAssertionSchema,
  validConfirmationSources,
} from "../src/index.js";

const DIRECT_USER = {
  actor: "user",
  channel: "desktop",
  directUser: true,
} as const;

const PEER = {
  actor: "agent",
  channel: "mcp",
  directUser: false,
} as const;

const JUDGE = {
  actor: "system",
  channel: "runtime",
  directUser: false,
} as const;

const NOW = "2026-08-14T00:00:00.000Z";

function makeAssertion(overrides: Record<string, unknown> = {}) {
  return {
    assertionId: "ZFHNM9PDC17ZX7HJXM4EMNEQ0M",
    projectId: "JGP7HHVP7X6E3F3PBJ2RHB7YJW",
    taskId: "RCDW1C3BMD01S9BBS2NY3CEVDR",
    kind: "inference",
    statement: "The source is authoritative",
    sourceRefs: [
      { refType: "judge_opinion", refId: "JO-001" },
    ],
    confidence: 0.99,
    limitations: [],
    status: "active",
    provenance: JUDGE,
    createdAt: NOW,
    version: 1,
    validFrom: NOW,
    ...overrides,
  };
}

describe("SituationAssertion tightening (Task 10)", () => {
  it("accepts a typed assertion with structured provenance and creation time", () => {
    const result = SituationAssertionSchema.safeParse(makeAssertion());
    expect(result.success).toBe(true);
  });

  it("rejects the legacy loose sourceRefs shape", () => {
    const legacy = makeAssertion({
      sourceRefs: [{ ref: "data/sensor.csv", type: "path" }],
    });
    expect(SituationAssertionSchema.safeParse(legacy).success).toBe(false);
  });

  it("requires at least one sourceRef", () => {
    expect(SituationAssertionSchema.safeParse(makeAssertion({ sourceRefs: [] })).success).toBe(
      false,
    );
  });

  it("bounds source, limitation, and confirmation arrays", () => {
    const sourceRef = { refType: "tool_result", refId: "tool" } as const;
    expect(SituationAssertionSchema.safeParse(makeAssertion({
      sourceRefs: Array(MAX_ASSERTION_SOURCE_REFS + 1).fill(sourceRef),
    })).success).toBe(false);
    expect(SituationAssertionSchema.safeParse(makeAssertion({
      limitations: Array(MAX_ASSERTION_LIMITATIONS + 1).fill("bounded"),
    })).success).toBe(false);
    expect(SituationAssertionSchema.safeParse(makeAssertion({
      confirmations: Array(MAX_ASSERTION_CONFIRMATIONS + 1).fill({
        sourceType: "judge_opinion",
        refId: "judge",
      }),
    })).success).toBe(false);
  });

  it("requires a structured missingReason for unknown and unavailable kinds", () => {
    for (const kind of ["unknown", "unavailable"]) {
      expect(SituationAssertionSchema.safeParse(makeAssertion({ kind })).success).toBe(false);
      expect(
        SituationAssertionSchema.safeParse(
          makeAssertion({
            kind,
            sourceRefs: [{ refType: "user_statement", refId: "U-1" }],
            missingReason: {
              reasonKind: "information_missing",
              description: "host did not provide the file listing",
            },
          }),
        ).success,
      ).toBe(true);
    }
  });

  it("a confirmed_fact requires a legal confirmation source", () => {
    const base = {
      kind: "confirmed_fact",
      sourceRefs: [{ refType: "evidence", refId: "E-001" }],
    };
    // No confirmations at all: not confirmed.
    expect(SituationAssertionSchema.safeParse(makeAssertion(base)).success).toBe(false);
    // Verified evidence confirms.
    expect(
      SituationAssertionSchema.safeParse(
        makeAssertion({
          ...base,
          confirmations: [
            {
              sourceType: "verified_evidence",
              evidenceId: "E-001",
              contentHash: "a".repeat(64),
            },
          ],
        }),
      ).success,
    ).toBe(true);
    // A trusted tool result confirms.
    expect(
      SituationAssertionSchema.safeParse(
        makeAssertion({
          ...base,
          confirmations: [{ sourceType: "tool_result", refId: "TR-9", trusted: true }],
        }),
      ).success,
    ).toBe(true);
    // A direct user confirms.
    expect(
      SituationAssertionSchema.safeParse(
        makeAssertion({
          ...base,
          confirmations: [{ sourceType: "direct_user", provenance: DIRECT_USER }],
        }),
      ).success,
    ).toBe(true);
    // A forged direct-user provenance on a peer channel is rejected by the
    // ActorProvenance schema itself.
    expect(ActorProvenanceSchema.safeParse({ ...PEER, directUser: true }).success).toBe(false);
  });

  it("a judge opinion can never confirm a fact, not even with confidence 0.99", () => {
    const judgeOnly = makeAssertion({
      kind: "confirmed_fact",
      confidence: 0.99,
      sourceRefs: [{ refType: "judge_opinion", refId: "JO-001" }],
      confirmations: [{ sourceType: "judge_opinion", refId: "JO-001" }],
    });
    expect(SituationAssertionSchema.safeParse(judgeOnly).success).toBe(false);
    // An untrusted tool result cannot confirm either.
    const untrustedTool = makeAssertion({
      kind: "confirmed_fact",
      confirmations: [{ sourceType: "tool_result", refId: "TR-1", trusted: false }],
    });
    expect(SituationAssertionSchema.safeParse(untrustedTool).success).toBe(false);
  });

  it("validConfirmationSources judges the same rule outside the schema", () => {
    expect(
      validConfirmationSources([
        { sourceType: "judge_opinion", refId: "JO-1" },
      ]),
    ).toBe(false);
    expect(
      validConfirmationSources([
        { sourceType: "verified_evidence", evidenceId: "E-1", contentHash: "a".repeat(64) },
      ]),
    ).toBe(true);
    expect(
      validConfirmationSources([{ sourceType: "direct_user", provenance: DIRECT_USER }]),
    ).toBe(true);
  });
});

describe("EvidenceLocator and contentHash tightening (Task 10)", () => {
  const locator = { type: "path" as const, value: "./outputs/report.md" };

  it("accepts a lowercase 64-hex sha-256 content hash", () => {
    expect(
      EvidenceLocatorSchema.safeParse({ ...locator, contentHash: "b".repeat(64) }).success,
    ).toBe(true);
  });

  it("rejects uppercase, short, and prefixed hashes", () => {
    for (const bad of ["A".repeat(64), "b".repeat(63), "sha256:abc", ""]) {
      expect(EvidenceLocatorSchema.safeParse({ ...locator, contentHash: bad }).success).toBe(
        false,
      );
    }
  });

  it("applies the same hash rule to EvidenceItem.contentHash", () => {
    const item = {
      evidenceId: "E-001",
      taskId: "RCDW1C3BMD01S9BBS2NY3CEVDR",
      type: "artifact",
      locator,
      status: "unverified",
      provenance: "agent output",
      recordedBy: "agent",
      version: 1,
    };
    expect(EvidenceItemSchema.safeParse({ ...item, contentHash: "c".repeat(64) }).success).toBe(
      true,
    );
    expect(EvidenceItemSchema.safeParse({ ...item, contentHash: "C".repeat(64) }).success).toBe(
      false,
    );
  });
});

describe("Claim tightening and ClaimEvidenceLink (Task 10)", () => {
  const claim = {
    claimId: "C-001",
    taskId: "RCDW1C3BMD01S9BBS2NY3CEVDR",
    text: "The cache cut load by 40%",
    type: "causal",
    importance: "critical",
    confidence: 0.8,
    evidenceRefs: ["E-001"],
    status: "unverified",
    limitations: [],
    provenance: PEER,
    createdAt: NOW,
    version: 1,
  };

  it("requires structured provenance and creation time on claims", () => {
    expect(ClaimSchema.safeParse(claim).success).toBe(true);
    expect(ClaimSchema.safeParse({ ...claim, provenance: undefined }).success).toBe(false);
    expect(ClaimSchema.safeParse({ ...claim, createdAt: "not-a-time" }).success).toBe(false);
  });

  it("bounds claim evidence and limitation arrays", () => {
    expect(ClaimSchema.safeParse({
      ...claim,
      evidenceRefs: Array(MAX_CLAIM_EVIDENCE_REFS + 1).fill("E-001"),
    }).success).toBe(false);
    expect(ClaimSchema.safeParse({
      ...claim,
      limitations: Array(MAX_CLAIM_LIMITATIONS + 1).fill("bounded"),
    }).success).toBe(false);
  });

  it("ClaimEvidenceLink is machine-decidable: relation x strength", () => {
    const relations = ["supports", "contradicts", "context"];
    const strengths = ["causal", "correlational", "reported", "unknown"];
    for (const relation of relations) {
      for (const strength of strengths) {
        expect(
          ClaimEvidenceLinkSchema.safeParse({
            claimId: "C-001",
            evidenceId: "E-001",
            relation,
            strength,
            provenance: DIRECT_USER,
            linkedAt: NOW,
          }).success,
        ).toBe(true);
      }
    }
    for (const bad of [
      { relation: "proves", strength: "causal" },
      { relation: "supports", strength: "definitive" },
    ]) {
      expect(
        ClaimEvidenceLinkSchema.safeParse({
          claimId: "C-001",
          evidenceId: "E-001",
          relation: bad.relation,
          strength: bad.strength,
          provenance: DIRECT_USER,
          linkedAt: NOW,
        }).success,
      ).toBe(false);
    }
  });
});

describe("Deliverable waiver provenance (Task 10)", () => {
  const deliverable = {
    deliverableId: "D-001",
    description: "最终报告",
    status: "pending",
    evidenceRefs: [],
    version: 1,
    updatedAt: NOW,
  };

  it("accepts a structured deliverable status", () => {
    expect(DeliverableLedgerEntrySchema.safeParse(deliverable).success).toBe(true);
  });

  it("bounds deliverable evidence refs", () => {
    expect(DeliverableLedgerEntrySchema.safeParse({
      ...deliverable,
      evidenceRefs: Array(MAX_DELIVERABLE_EVIDENCE_REFS + 1).fill("E-001"),
    }).success).toBe(false);
  });

  it("waived requires a structured waiver; a legacy waivedBy string never satisfies it", () => {
    const legacyOnly = { ...deliverable, status: "waived", waivedBy: "someone" };
    expect(DeliverableLedgerEntrySchema.safeParse(legacyOnly).success).toBe(false);
  });

  it("rejects stale waiver metadata on a non-waived deliverable", () => {
    expect(
      DeliverableLedgerEntrySchema.safeParse({
        ...deliverable,
        status: "pending",
        waiver: {
          reason: "previously waived",
          provenance: DIRECT_USER,
          waivedAt: NOW,
        },
      }).success,
    ).toBe(false);
  });

  it("a waiver needs a direct user, a reason and a time", () => {
    expect(
      DeliverableWaiverSchema.safeParse({
        reason: "用户明确放弃该交付物",
        provenance: DIRECT_USER,
        waivedAt: NOW,
      }).success,
    ).toBe(true);
    // Peer/agent provenance can never waive.
    expect(
      DeliverableWaiverSchema.safeParse({
        reason: "agent decided to skip",
        provenance: PEER,
        waivedAt: NOW,
      }).success,
    ).toBe(false);
    // A forged direct-user peer provenance is rejected.
    expect(
      DeliverableWaiverSchema.safeParse({
        reason: "x",
        provenance: { ...PEER, directUser: true },
        waivedAt: NOW,
      }).success,
    ).toBe(false);
    // A waiver without a reason is rejected.
    expect(
      DeliverableWaiverSchema.safeParse({
        reason: "",
        provenance: DIRECT_USER,
        waivedAt: NOW,
      }).success,
    ).toBe(false);
  });
});

describe("CompletionFacts shape (Task 10)", () => {
  it("carries exactly five structured top-level fields", () => {
    const facts = {
      requiredDeliverables: [
        {
          deliverableId: "D-001",
          description: "最终报告",
          status: "pending",
          evidenceRefs: [],
          version: 1,
          updatedAt: NOW,
        },
      ],
      openCriticalClaims: [
        {
          claimId: "C-001",
          taskId: "RCDW1C3BMD01S9BBS2NY3CEVDR",
          text: "The dataset is complete",
          type: "factual",
          importance: "critical",
          confidence: 0.5,
          evidenceRefs: [],
          status: "unverified",
          limitations: [],
          provenance: PEER,
          createdAt: NOW,
          version: 1,
        },
      ],
      unresolvedDecisions: [
        { decisionId: "D-9", reasonCode: "needs_user", summary: "等待用户选择", neededSince: NOW },
      ],
      recentToolFailures: [
        { eventId: "EV-1", toolName: "shell", error: "exit 1", occurredAt: NOW },
      ],
      evidenceGaps: [
        { claimId: "C-001", claimImportance: "critical", missingEvidenceType: "test_result" },
      ],
    };
    const result = CompletionFactsSchema.safeParse(facts);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.data).sort()).toEqual([
        "evidenceGaps",
        "openCriticalClaims",
        "recentToolFailures",
        "requiredDeliverables",
        "unresolvedDecisions",
      ]);
      expect(result.data.requiredDeliverables[0]?.version).toBe(1);
    }
    // The legacy scalar shapes no longer parse.
    expect(CompletionFactsSchema.safeParse({ ...facts, unresolvedDecisions: ["x"] }).success).toBe(
      false,
    );
    expect(CompletionFactsSchema.safeParse({ ...facts, evidenceGaps: ["x"] }).success).toBe(false);
    expect(
      CompletionFactsSchema.safeParse({ ...facts, recentToolFailures: ["x"] }).success,
    ).toBe(false);
  });

  it("bounds fact arrays supplied across the runtime boundary", () => {
    const gap = {
      claimId: "C-001",
      claimImportance: "critical",
      missingEvidenceType: "test_result",
    };
    expect(CompletionFactsSchema.safeParse({
      requiredDeliverables: [],
      openCriticalClaims: [],
      unresolvedDecisions: [],
      recentToolFailures: [],
      evidenceGaps: Array(MAX_COMPLETION_EVIDENCE_GAPS + 1).fill(gap),
    }).success).toBe(false);
  });
});
