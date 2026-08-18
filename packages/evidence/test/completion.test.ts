import { describe, it, expect } from "vitest";
import {
  SestinaErrorCode,
  CompletionFactsSchema,
  generateId,
  type Claim,
} from "@sestina/schema";
import { buildCompletionFacts, DEFAULT_FACTS_LIMITS } from "../src/completion-facts.js";
import {
  FakeDecisionSource,
  FakeReviewSource,
  FakeToolFailureSource,
} from "./fakes.js";
import { AGENT, HASH_A, PEER_MCP, USER, expectSestinaCode, makeHarness } from "./harness.js";

// ── Completion facts + deliverable ledger (docs/22 Task 10, B6/B7) ──

describe("Deliverable ledger (docs/22 Task 10)", () => {
  it("syncs contract deliverables once and never resets local progress", () => {
    const h = makeHarness();
    const created = h.deliverables.syncFromContract(
      h.projectId,
      h.taskId,
      [{ deliverableId: "dl-1", description: "synthetic" }],
      1,
      AGENT,
    );
    expect(created).toHaveLength(1);
    // Re-sync versions contract metadata without resetting local progress.
    expect(
      h.deliverables.syncFromContract(
        h.projectId,
        h.taskId,
        [{ deliverableId: "dl-1", description: "changed description" }],
        2,
        AGENT,
      ),
    ).toHaveLength(1);
    expect(h.deliverables.get(h.projectId, h.taskId, "dl-1")?.description)
      .toBe("changed description");
  });

  it("requires live verified evidence for satisfied", () => {
    const h = makeHarness();
    h.deliverables.syncFromContract(
      h.projectId,
      h.taskId,
      [{ deliverableId: "dl-1", description: "synthetic" }],
      1,
      AGENT,
    );
    // No evidence refs at all.
    expectSestinaCode(
      () => {
        h.deliverables.transitionStatus(h.projectId, h.taskId, "dl-1", 1, "satisfied", USER, {
          evidenceRefs: [],
        });
      },
      SestinaErrorCode.validation_failed,
    );
    const unverified = h.evidence.record(h.projectId, {
      taskId: h.taskId,
      type: "primary_source",
      locator: { type: "path", value: "a.txt" },
      contentHash: HASH_A,
      provenance: AGENT,
    });
    // Unverified evidence does not satisfy.
    expectSestinaCode(
      () => {
        h.deliverables.transitionStatus(h.projectId, h.taskId, "dl-1", 1, "satisfied", USER, {
          evidenceRefs: [unverified.evidenceId],
        });
      },
      SestinaErrorCode.validation_failed,
    );
    h.evidence.verify(h.projectId, unverified.evidenceId, unverified.version, USER);
    const entry = h.deliverables.transitionStatus(
      h.projectId,
      h.taskId,
      "dl-1",
      1,
      "satisfied",
      USER,
      { evidenceRefs: [unverified.evidenceId] },
    );
    expect(entry.status).toBe("satisfied");
    expect(entry.version).toBe(2);
    // History is append-only.
    expect(h.deliverables.history(h.projectId, h.taskId, "dl-1").map((row) => row.toStatus))
      .toEqual(["pending", "satisfied"]);
  });

  it("rejects verified evidence owned by a different task in the same project", () => {
    const h = makeHarness();
    const siblingTaskId = generateId();
    h.world.tasks.set(siblingTaskId, h.projectId);
    h.deliverables.syncFromContract(
      h.projectId,
      h.taskId,
      [{ deliverableId: "dl-1", description: "synthetic" }],
      1,
      AGENT,
    );
    const siblingEvidence = h.evidence.record(h.projectId, {
      taskId: siblingTaskId,
      type: "test_result",
      locator: { type: "artifact", value: "sibling-output" },
      provenance: AGENT,
    });
    h.evidence.verify(h.projectId, siblingEvidence.evidenceId, siblingEvidence.version, USER);
    expectSestinaCode(
      () => {
        h.deliverables.transitionStatus(h.projectId, h.taskId, "dl-1", 1, "satisfied", USER, {
          evidenceRefs: [siblingEvidence.evidenceId],
        });
      },
      SestinaErrorCode.validation_failed,
    );
  });

  it("waives only for a direct user with a reason and time", () => {
    const h = makeHarness();
    h.deliverables.syncFromContract(
      h.projectId,
      h.taskId,
      [{ deliverableId: "dl-1", description: "synthetic" }],
      1,
      AGENT,
    );
    // An agent cannot waive.
    expectSestinaCode(
      () => {
        h.deliverables.transitionStatus(h.projectId, h.taskId, "dl-1", 1, "waived", AGENT, {
          waiverReason: "agent wants out",
        });
      },
      SestinaErrorCode.forbidden,
    );
    // A peer cannot waive.
    expectSestinaCode(
      () => {
        h.deliverables.transitionStatus(h.projectId, h.taskId, "dl-1", 1, "waived", PEER_MCP, {
          waiverReason: "peer wants out",
        });
      },
      SestinaErrorCode.forbidden,
    );
    // A direct user without a reason cannot waive.
    expectSestinaCode(
      () => {
        h.deliverables.transitionStatus(h.projectId, h.taskId, "dl-1", 1, "waived", USER, {});
      },
      SestinaErrorCode.validation_failed,
    );
    const waived = h.deliverables.transitionStatus(
      h.projectId,
      h.taskId,
      "dl-1",
      1,
      "waived",
      USER,
      { waiverReason: "user decided it is not needed" },
    );
    expect(waived.status).toBe("waived");
    expect(waived.waiver?.reason).toBe("user decided it is not needed");
    expect(waived.waiver?.waivedAt).toBeDefined();

    const reopened = h.deliverables.transitionStatus(
      h.projectId,
      h.taskId,
      "dl-1",
      waived.version,
      "pending",
      USER,
    );
    expect(reopened.status).toBe("pending");
    expect(reopened.waiver).toBeUndefined();
  });

  it("requires the caller's expected version for deliverable transitions", () => {
    const h = makeHarness();
    h.deliverables.syncFromContract(
      h.projectId,
      h.taskId,
      [{ deliverableId: "dl-1", description: "synthetic" }],
      1,
      AGENT,
    );
    h.deliverables.transitionStatus(h.projectId, h.taskId, "dl-1", 1, "in_progress", USER);
    expectSestinaCode(
      () => {
        h.deliverables.transitionStatus(h.projectId, h.taskId, "dl-1", 1, "failed", USER);
      },
      SestinaErrorCode.stale_state,
    );
  });
});

describe("buildCompletionFacts (docs/22 Task 10)", () => {
  function sources(h: ReturnType<typeof makeHarness>) {
    return {
      tasks: h.world,
      deliverables: h.stores.deliverables,
      claims: h.stores.claims,
      evidence: h.stores.evidence,
      decisions: new FakeDecisionSource([
        {
          decisionId: "d-1",
          reasonCode: "needs_user",
          reason: "user must choose",
          userDecisionNeeded: true,
          createdAt: "2026-08-01T00:00:00.000Z",
        },
        {
          decisionId: "d-2",
          reasonCode: "auto",
          reason: "handled",
          userDecisionNeeded: false,
          createdAt: "2026-08-01T00:00:00.000Z",
        },
      ]),
      reviews: new FakeReviewSource([
        {
          reviewId: "r-1",
          title: "open review",
          status: "open",
          openedAt: "2026-08-01T00:00:00.000Z",
        },
        {
          reviewId: "r-2",
          title: "resolved review",
          status: "resolved",
          openedAt: "2026-08-01T00:00:00.000Z",
        },
        {
          reviewId: "r-3",
          title: "in review",
          status: "in_review",
          openedAt: "2026-08-01T00:00:00.000Z",
        },
      ]),
      toolFailures: new FakeToolFailureSource([
        {
          eventId: "e-1",
          toolName: "shell",
          error: "exit 1",
          occurredAt: "2026-08-01T00:00:00.000Z",
        },
        {
          eventId: "e-0",
          toolName: "editor",
          error: "timeout",
          occurredAt: "2026-08-01T00:00:01.000Z",
        },
        {
          eventId: "e-old",
          toolName: "shell",
          error: "ancient",
          occurredAt: "2020-01-01T00:00:00.000Z",
        },
      ]),
    };
  }

  it("builds exactly the five structured fact fields, bounded and ordered", () => {
    const h = makeHarness();
    h.deliverables.syncFromContract(
      h.projectId,
      h.taskId,
      [
        { deliverableId: "dl-b", description: "second" },
        { deliverableId: "dl-a", description: "first" },
      ],
      1,
      AGENT,
    );
    const critical = h.claims.record(h.projectId, {
      taskId: h.taskId,
      text: "critical open",
      type: "factual",
      importance: "critical",
      confidence: 0.5,
      limitations: [],
      provenance: AGENT,
      evidenceRefs: [],
    });
    const material = h.claims.record(h.projectId, {
      taskId: h.taskId,
      text: "material gap",
      type: "factual",
      importance: "material",
      confidence: 0.5,
      limitations: [],
      provenance: AGENT,
      evidenceRefs: [],
    });
    const facts = buildCompletionFacts(
      h.projectId,
      h.taskId,
      sources(h),
      Date.parse("2026-08-01T12:00:00.000Z"),
    );
    // Exactly five fields.
    expect(Object.keys(facts).sort()).toEqual([
      "evidenceGaps",
      "openCriticalClaims",
      "recentToolFailures",
      "requiredDeliverables",
      "unresolvedDecisions",
    ]);
    expect(CompletionFactsSchema.safeParse(facts).success).toBe(true);
    // Stable deliverable ordering.
    expect(facts.requiredDeliverables.map((d) => d.deliverableId)).toEqual(["dl-a", "dl-b"]);
    // Open critical claims surface, and only critical ones.
    expect(facts.openCriticalClaims.map((c) => c.claimId)).toEqual([critical.claimId]);
    // Decisions needing the user + open/in-review items; resolved excluded.
    expect(facts.unresolvedDecisions.map((d) => d.decisionId).sort()).toEqual(["d-1", "r-1", "r-3"]);
    // Tool failures within the window, newest first, ancient excluded.
    expect(facts.recentToolFailures.map((f) => f.eventId)).toEqual(["e-0", "e-1"]);
    // Gaps cover critical AND material claims without live verified support.
    expect(facts.evidenceGaps.map((g) => g.claimId).sort()).toEqual([critical.claimId, material.claimId].sort());
    // No policy fields anywhere (facts only).
    expect(facts).not.toHaveProperty("allowStop");
    expect(facts).not.toHaveProperty("allow_stop");
  });

  it("loads every deliverable below the authoritative scan fence", () => {
    const h = makeHarness();
    const many: { deliverableId: string; description: string }[] = [];
    for (let i = 0; i < 60; i++) {
      many.push({ deliverableId: `dl-${String(i).padStart(3, "0")}`, description: "synthetic" });
    }
    h.deliverables.syncFromContract(h.projectId, h.taskId, many, 1, AGENT);
    const facts = buildCompletionFacts(
      h.projectId,
      h.taskId,
      sources(h),
      Date.parse("2026-08-01T12:00:00.000Z"),
    );
    expect(facts.requiredDeliverables).toHaveLength(60);
    expect(facts.openCriticalClaims.length).toBeLessThanOrEqual(DEFAULT_FACTS_LIMITS.maxOpenCriticalClaims);
    expect(facts.unresolvedDecisions.length).toBeLessThanOrEqual(DEFAULT_FACTS_LIMITS.maxUnresolvedDecisions);
    expect(facts.recentToolFailures.length).toBeLessThanOrEqual(DEFAULT_FACTS_LIMITS.maxToolFailures);
    expect(facts.evidenceGaps.length).toBeLessThanOrEqual(DEFAULT_FACTS_LIMITS.maxEvidenceGaps);
  });

  it("ignores caller-provided limits instead of letting them filter authoritative facts", () => {
    const h = makeHarness();
    const many = Array.from(
      { length: 60 },
      (_, index) => ({
        deliverableId: `hard-cap-${String(index).padStart(3, "0")}`,
        description: "synthetic",
      }),
    );
    h.deliverables.syncFromContract(h.projectId, h.taskId, many, 1, AGENT);
    const facts = buildCompletionFacts(
      h.projectId,
      h.taskId,
      sources(h),
      Date.parse("2026-08-01T12:00:00.000Z"),
      {
        maxDeliverables: 100_000,
        maxOpenCriticalClaims: 100_000,
        maxUnresolvedDecisions: 100_000,
        maxToolFailures: 100_000,
        maxEvidenceGaps: 100_000,
        toolFailureWindowMs: Number.MAX_SAFE_INTEGER,
      },
    );
    expect(facts.requiredDeliverables).toHaveLength(60);
  });

  it("paginates past resolved rows before deciding there are no unresolved decisions", () => {
    const h = makeHarness();
    const customSources = sources(h);
    customSources.decisions = {
      listByTask(_projectId, _taskId, input) {
        if (input.cursor === undefined) {
          return {
            items: [{
              decisionId: "resolved-first",
              reasonCode: "auto",
              reason: "already handled",
              userDecisionNeeded: false,
              createdAt: "2026-08-01T00:00:00.000Z",
            }],
            nextCursor: "page-2",
          };
        }
        return {
          items: [{
            decisionId: "needs-user-later",
            reasonCode: "needs_user",
            reason: "user must choose",
            userDecisionNeeded: true,
            createdAt: "2026-08-01T00:00:01.000Z",
          }],
        };
      },
    };
    customSources.reviews = new FakeReviewSource([]);
    const facts = buildCompletionFacts(
      h.projectId,
      h.taskId,
      customSources,
      Date.parse("2026-08-01T12:00:00.000Z"),
      { maxUnresolvedDecisions: 1 },
    );
    expect(facts.unresolvedDecisions.map((row) => row.decisionId))
      .toEqual(["needs-user-later"]);
  });

  it("does not silently miss an evidence gap after the first 500 claims", () => {
    const h = makeHarness();
    const base = {
      taskId: h.taskId,
      text: "supporting row",
      type: "factual",
      importance: "supporting",
      confidence: 0.5,
      evidenceRefs: [],
      status: "unverified",
      limitations: [],
      provenance: AGENT,
      createdAt: "2026-08-01T00:00:00.000Z",
      version: 1,
    } satisfies Omit<Claim, "claimId">;
    for (let index = 0; index < 500; index += 1) {
      const claimId = `a-${String(index).padStart(4, "0")}`;
      h.stores.claims.rows.set(`${h.projectId}|${claimId}`, { ...base, claimId });
    }
    const targetId = "z-material-gap";
    h.stores.claims.rows.set(`${h.projectId}|${targetId}`, {
      ...base,
      claimId: targetId,
      text: "material row after page one",
      importance: "material",
    });
    const facts = buildCompletionFacts(
      h.projectId,
      h.taskId,
      sources(h),
      Date.parse("2026-08-01T12:00:00.000Z"),
    );
    expect(facts.evidenceGaps.map((row) => row.claimId)).toContain(targetId);
  });

  it("keeps a causal evidence gap when verified support is only correlational", () => {
    const h = makeHarness();
    const claim = h.claims.record(h.projectId, {
      taskId: h.taskId,
      text: "A causes B",
      type: "causal",
      importance: "material",
      confidence: 0.7,
      limitations: [],
      provenance: AGENT,
      evidenceRefs: [],
    });
    const evidence = h.evidence.record(h.projectId, {
      taskId: h.taskId,
      type: "dataset",
      locator: { type: "artifact", value: "correlation.csv" },
      provenance: AGENT,
    });
    h.evidence.verify(h.projectId, evidence.evidenceId, evidence.version, USER);
    h.claims.linkEvidence(h.projectId, {
      claimId: claim.claimId,
      evidenceId: evidence.evidenceId,
      relation: "supports",
      strength: "correlational",
      provenance: AGENT,
    });
    h.claims.recomputeStatus(h.projectId, claim.claimId, claim.version);
    const facts = buildCompletionFacts(
      h.projectId,
      h.taskId,
      sources(h),
      Date.parse("2026-08-01T12:00:00.000Z"),
    );
    expect(facts.evidenceGaps.map((row) => row.claimId)).toContain(claim.claimId);
  });

  it("an expired verified deliverable evidence ref no longer satisfies", () => {
    const h = makeHarness();
    h.deliverables.syncFromContract(
      h.projectId,
      h.taskId,
      [{ deliverableId: "dl-1", description: "synthetic" }],
      1,
      AGENT,
    );
    const evidence = h.evidence.record(h.projectId, {
      taskId: h.taskId,
      type: "primary_source",
      locator: { type: "path", value: "a.txt" },
      provenance: AGENT,
    });
    h.evidence.verify(h.projectId, evidence.evidenceId, evidence.version, USER);
    h.deliverables.transitionStatus(h.projectId, h.taskId, "dl-1", 1, "satisfied", USER, {
      evidenceRefs: [evidence.evidenceId],
    });
    // The evidence expires in the future relative to a later facts build.
    const laterFacts = Date.parse("2027-01-01T00:00:00.000Z");
    void laterFacts;
    // Simulate expiry by rewriting the row (the ledger check re-reads live).
    h.stores.evidence.rows.set(evidence.evidenceId, {
      ...evidence,
      status: "verified",
      expiresAt: "2026-08-01T00:00:00.000Z",
    });
    // A new satisfied transition with the now-dead ref is refused.
    expectSestinaCode(
      () => {
        h.deliverables.transitionStatus(h.projectId, h.taskId, "dl-1", 2, "satisfied", USER, {
          evidenceRefs: [evidence.evidenceId],
        });
      },
      SestinaErrorCode.validation_failed,
    );
  });

  it("fails closed for a missing task or a task owned by another project", () => {
    const h = makeHarness();
    for (const taskId of [generateId(), h.otherTaskId]) {
      expectSestinaCode(
        () => buildCompletionFacts(
          h.projectId,
          taskId,
          sources(h),
          Date.parse("2026-08-01T12:00:00.000Z"),
        ),
        SestinaErrorCode.task_not_found,
      );
    }
  });

  it("does not let caller-controlled limits or importance filters erase blockers", () => {
    const h = makeHarness();
    h.deliverables.syncFromContract(
      h.projectId,
      h.taskId,
      [{ deliverableId: "required", description: "still pending" }],
      1,
      AGENT,
    );
    const critical = h.claims.record(h.projectId, {
      taskId: h.taskId,
      text: "critical evidence gap",
      type: "factual",
      importance: "critical",
      confidence: 0.5,
      limitations: [],
      provenance: AGENT,
      evidenceRefs: [],
    });
    const facts = buildCompletionFacts(
      h.projectId,
      h.taskId,
      sources(h),
      Date.parse("2026-08-01T12:00:00.000Z"),
      {
        maxDeliverables: 0,
        maxOpenCriticalClaims: 0,
        maxUnresolvedDecisions: 0,
        maxToolFailures: 0,
        maxEvidenceGaps: 0,
        gapImportance: [],
      },
    );
    expect(facts.requiredDeliverables.map((row) => row.deliverableId)).toContain("required");
    expect(facts.openCriticalClaims.map((row) => row.claimId)).toContain(critical.claimId);
    expect(facts.evidenceGaps.map((row) => row.claimId)).toContain(critical.claimId);
  });

  it("never hides a pending deliverable after fifty completed entries", () => {
    const h = makeHarness();
    const contract = Array.from({ length: 51 }, (_, index) => ({
      deliverableId: `dl-${String(index).padStart(3, "0")}`,
      description: "synthetic",
    }));
    h.deliverables.syncFromContract(h.projectId, h.taskId, contract, 1, AGENT);
    for (let index = 0; index < 50; index++) {
      h.deliverables.transitionStatus(
        h.projectId,
        h.taskId,
        `dl-${String(index).padStart(3, "0")}`,
        1,
        "waived",
        USER,
        { waiverReason: "synthetic direct-user waiver" },
      );
    }
    const facts = buildCompletionFacts(
      h.projectId,
      h.taskId,
      sources(h),
      Date.parse("2026-08-01T12:00:00.000Z"),
    );
    expect(facts.requiredDeliverables.map((row) => row.deliverableId)).toContain("dl-050");
    expect(facts.requiredDeliverables.find((row) => row.deliverableId === "dl-050")?.status)
      .toBe("pending");
  });

  it("fails closed when the authoritative deliverable projection exceeds the scan fence", () => {
    const h = makeHarness();
    const contract = Array.from({ length: 5_001 }, (_, index) => ({
      deliverableId: `overflow-${String(index).padStart(4, "0")}`,
      description: "synthetic",
    }));
    h.deliverables.syncFromContract(h.projectId, h.taskId, contract, 1, AGENT);
    expectSestinaCode(
      () => buildCompletionFacts(
        h.projectId,
        h.taskId,
        sources(h),
        Date.parse("2026-08-01T12:00:00.000Z"),
      ),
      SestinaErrorCode.limit_exceeded,
    );
  });

  it("fails closed instead of truncating open critical claims", () => {
    const h = makeHarness();
    for (let index = 0; index <= DEFAULT_FACTS_LIMITS.maxOpenCriticalClaims; index++) {
      h.claims.record(h.projectId, {
        taskId: h.taskId,
        text: `critical blocker ${index}`,
        type: "factual",
        importance: "critical",
        confidence: 0.5,
        evidenceRefs: [],
        limitations: [],
        provenance: AGENT,
      });
    }
    expectSestinaCode(
      () => buildCompletionFacts(
        h.projectId,
        h.taskId,
        sources(h),
        Date.parse("2026-08-01T12:00:00.000Z"),
      ),
      SestinaErrorCode.limit_exceeded,
    );
  });

  it("revalidates satisfied deliverables after evidence expires, changes state, or disappears", () => {
    for (const invalidation of ["expired", "disputed", "superseded", "missing"] as const) {
      const h = makeHarness();
      h.deliverables.syncFromContract(
        h.projectId,
        h.taskId,
        [{ deliverableId: "dl-1", description: invalidation }],
        1,
        AGENT,
      );
      const evidence = h.evidence.record(h.projectId, {
        taskId: h.taskId,
        type: "test_result",
        locator: { type: "artifact", value: invalidation },
        expiresAt: invalidation === "expired" ? "2026-08-02T00:00:00.000Z" : undefined,
        provenance: AGENT,
      });
      h.evidence.verify(h.projectId, evidence.evidenceId, evidence.version, USER);
      h.deliverables.transitionStatus(h.projectId, h.taskId, "dl-1", 1, "satisfied", USER, {
        evidenceRefs: [evidence.evidenceId],
      });
      if (invalidation === "disputed") {
        h.evidence.dispute(h.projectId, evidence.evidenceId, 2, USER, "invalidated");
      } else if (invalidation === "superseded") {
        h.evidence.supersede(h.projectId, evidence.evidenceId, 2, USER, "invalidated");
      } else if (invalidation === "missing") {
        h.stores.evidence.rows.delete(evidence.evidenceId);
      }
      const facts = buildCompletionFacts(
        h.projectId,
        h.taskId,
        sources(h),
        Date.parse("2026-08-03T00:00:00.000Z"),
      );
      expect(facts.requiredDeliverables[0]?.status, invalidation).not.toBe("satisfied");
    }
  });

  it("projects only active required deliverables and preserves progress across contract revisions", () => {
    const h = makeHarness();
    h.deliverables.syncFromContract(
      h.projectId,
      h.taskId,
      [
        { deliverableId: "optional", description: "optional", required: false },
        { deliverableId: "required", description: "old description", required: true },
      ],
      1,
      AGENT,
    );
    h.deliverables.transitionStatus(h.projectId, h.taskId, "required", 1, "in_progress", AGENT);
    h.deliverables.syncFromContract(
      h.projectId,
      h.taskId,
      [{ deliverableId: "required", description: "new description", required: true }],
      2,
      AGENT,
    );
    const revised = h.deliverables.get(h.projectId, h.taskId, "required");
    expect(revised).toMatchObject({
      description: "new description",
      required: true,
      active: true,
      status: "in_progress",
      contractVersion: 2,
    });
    let facts = buildCompletionFacts(
      h.projectId,
      h.taskId,
      sources(h),
      Date.parse("2026-08-01T12:00:00.000Z"),
    );
    expect(facts.requiredDeliverables.map((row) => row.deliverableId)).toEqual(["required"]);

    h.deliverables.syncFromContract(h.projectId, h.taskId, [], 3, AGENT);
    expect(h.deliverables.get(h.projectId, h.taskId, "required")?.active).toBe(false);
    facts = buildCompletionFacts(
      h.projectId,
      h.taskId,
      sources(h),
      Date.parse("2026-08-01T12:00:00.000Z"),
    );
    expect(facts.requiredDeliverables).toEqual([]);
  });

  it("does not keep a user decision unresolved after its review is terminal", () => {
    const h = makeHarness();
    const custom = sources(h);
    custom.decisions = new FakeDecisionSource([
      {
        decisionId: "decision-resolved",
        reasonCode: "needs_user",
        reason: "handled by review",
        userDecisionNeeded: true,
        createdAt: "2026-08-01T00:00:00.000Z",
      },
      {
        decisionId: "decision-open",
        reasonCode: "needs_user",
        reason: "still open",
        userDecisionNeeded: true,
        createdAt: "2026-08-01T00:00:01.000Z",
      },
    ]);
    custom.reviews = new FakeReviewSource([
      {
        reviewId: "review-resolved",
        decisionRef: "decision-resolved",
        title: "resolved review",
        status: "resolved",
        openedAt: "2026-08-01T00:00:00.000Z",
      },
      {
        reviewId: "review-open",
        decisionRef: "decision-open",
        title: "open review",
        status: "open",
        openedAt: "2026-08-01T00:00:01.000Z",
      },
    ]);
    const facts = buildCompletionFacts(
      h.projectId,
      h.taskId,
      custom,
      Date.parse("2026-08-01T12:00:00.000Z"),
    );
    expect(facts.unresolvedDecisions.map((row) => row.decisionId).sort())
      .toEqual(["decision-open", "review-open"]);
  });
});
