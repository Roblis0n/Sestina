import { describe, it, expect } from "vitest";
import { SestinaErrorCode, generateId } from "@sestina/schema";
import {
  AGENT,
  HASH_A,
  HASH_B,
  NOW_ISO,
  PEER_MCP,
  USER,
  errorCode,
  expectSestinaCode,
  makeHarness,
} from "./harness.js";

// ── SituationService rules (docs/22 Task 10, B3) ──

describe("SituationService (docs/22 Task 10)", () => {
  it("records the five non-confirmed kinds and never mixes them", () => {
    const h = makeHarness();
    for (const kind of ["reported_fact", "inference", "assumption"] as const) {
      const assertion = h.situations.record({
        projectId: h.projectId,
        taskId: h.taskId,
        kind,
        statement: `synthetic ${kind}`,
        sourceRefs: [{ refType: "tool_result", refId: "tool-1" }],
        limitations: [],
        provenance: AGENT,
      });
      expect(assertion.kind).toBe(kind);
      expect(assertion.status).toBe("active");
      expect(assertion.version).toBe(1);
    }
    // unknown/unavailable require a structured missingReason.
    for (const kind of ["unknown", "unavailable"] as const) {
      expectSestinaCode(
        () => {
          h.situations.record({
            projectId: h.projectId,
            taskId: h.taskId,
            kind,
            statement: `synthetic ${kind}`,
            sourceRefs: [{ refType: "tool_result", refId: "tool-1" }],
            limitations: [],
            provenance: AGENT,
          });
        },
        SestinaErrorCode.validation_failed,
      );
      const assertion = h.situations.record({
        projectId: h.projectId,
        taskId: h.taskId,
        kind,
        statement: `synthetic ${kind}`,
        sourceRefs: [{ refType: "tool_result", refId: "tool-1" }],
        limitations: [],
        missingReason: { reasonKind: "information_missing", description: "synthetic gap" },
        provenance: AGENT,
      });
      expect(assertion.kind).toBe(kind);
    }
  });

  it("confirms only after resolving persisted evidence, trusted observations, or the authenticated user", () => {
    const h = makeHarness();
    const evidence = h.evidence.record(h.projectId, {
      taskId: h.taskId,
      type: "test_result",
      locator: { type: "artifact", value: "verified-result" },
      contentHash: HASH_A,
      provenance: AGENT,
    });
    h.evidence.verify(h.projectId, evidence.evidenceId, evidence.version, USER);
    const assertion = h.situations.record({
      projectId: h.projectId,
      taskId: h.taskId,
      kind: "reported_fact",
      statement: "synthetic",
      sourceRefs: [{ refType: "tool_result", refId: "tool-1" }],
      limitations: [],
      provenance: AGENT,
    });
    const confirmed = h.situations.confirm(
      h.projectId,
      assertion.assertionId,
      assertion.version,
      { sourceType: "verified_evidence", evidenceId: evidence.evidenceId, contentHash: HASH_A },
      AGENT,
    );
    expect(confirmed.kind).toBe("confirmed_fact");
    expect(confirmed.version).toBe(2);
    const viaUser = h.situations.record({
      projectId: h.projectId,
      taskId: h.taskId,
      kind: "reported_fact",
      statement: "synthetic 2",
      sourceRefs: [{ refType: "user_statement", refId: "u-1" }],
      limitations: [],
      provenance: AGENT,
    });
    expect(
      h.situations
        .confirm(h.projectId, viaUser.assertionId, viaUser.version, {
          sourceType: "direct_user",
          provenance: { actor: "user", channel: "desktop", directUser: true },
        }, USER)
        .kind,
    ).toBe("confirmed_fact");
  });

  it("rejects caller-forged confirmation authority", () => {
    const h = makeHarness();
    const newAssertion = () => h.situations.record({
      projectId: h.projectId,
      taskId: h.taskId,
      kind: "reported_fact",
      statement: "authority must be resolved",
      sourceRefs: [{ refType: "tool_result", refId: "tool-1" }],
      limitations: [],
      provenance: AGENT,
    });

    const missing = newAssertion();
    expectSestinaCode(
      () => h.situations.confirm(
        h.projectId,
        missing.assertionId,
        missing.version,
        { sourceType: "verified_evidence", evidenceId: "missing", contentHash: HASH_A },
        AGENT,
      ),
      SestinaErrorCode.insufficient_confirmation_source,
    );

    const unverifiedEvidence = h.evidence.record(h.projectId, {
      taskId: h.taskId,
      type: "test_result",
      locator: { type: "artifact", value: "unverified" },
      contentHash: HASH_A,
      provenance: AGENT,
    });
    const unverified = newAssertion();
    expectSestinaCode(
      () => h.situations.confirm(
        h.projectId,
        unverified.assertionId,
        unverified.version,
        {
          sourceType: "verified_evidence",
          evidenceId: unverifiedEvidence.evidenceId,
          contentHash: HASH_A,
        },
        AGENT,
      ),
      SestinaErrorCode.insufficient_confirmation_source,
    );

    h.evidence.verify(
      h.projectId,
      unverifiedEvidence.evidenceId,
      unverifiedEvidence.version,
      USER,
    );
    const hashMismatch = newAssertion();
    expectSestinaCode(
      () => h.situations.confirm(
        h.projectId,
        hashMismatch.assertionId,
        hashMismatch.version,
        {
          sourceType: "verified_evidence",
          evidenceId: unverifiedEvidence.evidenceId,
          contentHash: HASH_B,
        },
        AGENT,
      ),
      SestinaErrorCode.insufficient_confirmation_source,
    );

    const expiredEvidence = h.evidence.record(h.projectId, {
      taskId: h.taskId,
      type: "test_result",
      locator: { type: "artifact", value: "expired" },
      contentHash: HASH_B,
      expiresAt: "2026-07-31T00:00:00.000Z",
      provenance: AGENT,
    });
    h.evidence.verify(h.projectId, expiredEvidence.evidenceId, expiredEvidence.version, USER);
    const expired = newAssertion();
    expectSestinaCode(
      () => h.situations.confirm(
        h.projectId,
        expired.assertionId,
        expired.version,
        {
          sourceType: "verified_evidence",
          evidenceId: expiredEvidence.evidenceId,
          contentHash: HASH_B,
        },
        AGENT,
      ),
      SestinaErrorCode.insufficient_confirmation_source,
    );

    const foreignEvidence = h.evidence.record(h.otherProjectId, {
      taskId: h.otherTaskId,
      type: "test_result",
      locator: { type: "artifact", value: "foreign" },
      contentHash: HASH_A,
      provenance: AGENT,
    });
    h.evidence.verify(
      h.otherProjectId,
      foreignEvidence.evidenceId,
      foreignEvidence.version,
      USER,
    );
    const crossProject = newAssertion();
    expectSestinaCode(
      () => h.situations.confirm(
        h.projectId,
        crossProject.assertionId,
        crossProject.version,
        {
          sourceType: "verified_evidence",
          evidenceId: foreignEvidence.evidenceId,
          contentHash: HASH_A,
        },
        AGENT,
      ),
      SestinaErrorCode.insufficient_confirmation_source,
    );

    const siblingTaskId = generateId();
    h.world.tasks.set(siblingTaskId, h.projectId);
    const siblingEvidence = h.evidence.record(h.projectId, {
      taskId: siblingTaskId,
      type: "test_result",
      locator: { type: "artifact", value: "sibling" },
      contentHash: "c".repeat(64),
      provenance: AGENT,
    });
    h.evidence.verify(h.projectId, siblingEvidence.evidenceId, siblingEvidence.version, USER);
    const crossTask = newAssertion();
    expectSestinaCode(
      () => h.situations.confirm(
        h.projectId,
        crossTask.assertionId,
        crossTask.version,
        {
          sourceType: "verified_evidence",
          evidenceId: siblingEvidence.evidenceId,
          contentHash: "c".repeat(64),
        },
        AGENT,
      ),
      SestinaErrorCode.insufficient_confirmation_source,
    );

    const forgedTool = newAssertion();
    expectSestinaCode(
      () => h.situations.confirm(
        h.projectId,
        forgedTool.assertionId,
        forgedTool.version,
        { sourceType: "tool_result", refId: "not-persisted", trusted: true },
        AGENT,
      ),
      SestinaErrorCode.insufficient_confirmation_source,
    );

    const forgedUser = newAssertion();
    expectSestinaCode(
      () => h.situations.confirm(
        h.projectId,
        forgedUser.assertionId,
        forgedUser.version,
        { sourceType: "direct_user", provenance: USER },
        PEER_MCP,
      ),
      SestinaErrorCode.insufficient_confirmation_source,
    );
  });

  it("never confirms through a judge opinion, an untrusted tool result or a peer 'user'", () => {
    const h = makeHarness();
    const judge = h.situations.record({
      projectId: h.projectId,
      taskId: h.taskId,
      kind: "inference",
      statement: "judge thinks so",
      sourceRefs: [{ refType: "judge_opinion", refId: "op-1" }],
      limitations: [],
      provenance: AGENT,
    });
    expectSestinaCode(
      () => {
        h.situations.confirm(h.projectId, judge.assertionId, judge.version, {
          sourceType: "judge_opinion",
          refId: "op-1",
        }, AGENT);
      },
      SestinaErrorCode.insufficient_confirmation_source,
    );
    expect(h.situations.get(h.projectId, judge.assertionId)?.kind).toBe("inference");

    const tool = h.situations.record({
      projectId: h.projectId,
      taskId: h.taskId,
      kind: "reported_fact",
      statement: "tool said so",
      sourceRefs: [{ refType: "tool_result", refId: "tool-9" }],
      limitations: [],
      provenance: AGENT,
    });
    expectSestinaCode(
      () => {
        h.situations.confirm(h.projectId, tool.assertionId, tool.version, {
          sourceType: "tool_result",
          refId: "tool-9",
          trusted: false,
        }, AGENT);
      },
      SestinaErrorCode.insufficient_confirmation_source,
    );
    // A direct_user confirmation on a peer channel is structurally illegal.
    const peerAssertion = h.situations.record({
      projectId: h.projectId,
      taskId: h.taskId,
      kind: "reported_fact",
      statement: "peer claims to be the user",
      sourceRefs: [{ refType: "tool_result", refId: "tool-peer" }],
      limitations: [],
      provenance: PEER_MCP,
    });
    expectSestinaCode(
      () => {
        h.situations.confirm(h.projectId, peerAssertion.assertionId, peerAssertion.version, {
          sourceType: "direct_user",
          provenance: { actor: "user", channel: "mcp", directUser: true },
        }, PEER_MCP);
      },
      SestinaErrorCode.insufficient_confirmation_source,
    );
    expect(h.situations.get(h.projectId, peerAssertion.assertionId)?.kind).toBe("reported_fact");
  });

  it("disputes and expires under CAS, keeping append-only history", () => {
    const h = makeHarness();
    const assertion = h.situations.record({
      projectId: h.projectId,
      taskId: h.taskId,
      kind: "reported_fact",
      statement: "synthetic",
      sourceRefs: [{ refType: "tool_result", refId: "tool-1" }],
      limitations: [],
      provenance: AGENT,
    });
    h.situations.dispute(
      h.projectId,
      assertion.assertionId,
      assertion.version,
      AGENT,
      "synthetic dispute",
    );
    expect(h.situations.get(h.projectId, assertion.assertionId)?.status).toBe("disputed");
    h.situations.expire(h.projectId, assertion.assertionId, assertion.version + 1, AGENT);
    expect(h.situations.get(h.projectId, assertion.assertionId)?.status).toBe("expired");
    const history = h.situations.history(h.projectId, assertion.assertionId);
    expect(history.map((row) => row.toStatus)).toEqual(["disputed", "expired"]);
    expect(history[0]?.fromStatus).toBe("active");
    // A terminal (expired/superseded) assertion cannot be disputed afterwards.
    expectSestinaCode(
      () => {
        h.situations.dispute(
          h.projectId,
          assertion.assertionId,
          assertion.version + 2,
          AGENT,
          "late dispute",
        );
      },
      SestinaErrorCode.validation_failed,
    );
  });

  it("requires the caller's expected version for assertion transitions", () => {
    const h = makeHarness();
    const assertion = h.situations.record({
      projectId: h.projectId,
      taskId: h.taskId,
      kind: "reported_fact",
      statement: "synthetic",
      sourceRefs: [{ refType: "tool_result", refId: "tool-1" }],
      limitations: [],
      provenance: AGENT,
    });
    h.situations.dispute(
      h.projectId,
      assertion.assertionId,
      assertion.version,
      AGENT,
      "first writer",
    );
    expectSestinaCode(
      () => {
        h.situations.expire(h.projectId, assertion.assertionId, assertion.version, AGENT);
      },
      SestinaErrorCode.stale_state,
    );
  });

  it("supersedes append-only within the same project and task only", () => {
    let currentMs = Date.parse(NOW_ISO);
    const h = makeHarness({
      now: () => new Date(currentMs).toISOString(),
      nowMs: () => currentMs,
      newId: () => generateId(),
      redactExcerpt: (excerpt: string) => excerpt,
    });
    const target = h.situations.record({
      projectId: h.projectId,
      taskId: h.taskId,
      kind: "reported_fact",
      statement: "old",
      sourceRefs: [{ refType: "tool_result", refId: "tool-1" }],
      limitations: [],
      provenance: AGENT,
    });
    currentMs += 1; // the replacement must be strictly newer than the target
    const input = {
      kind: "reported_fact" as const,
      statement: "new",
      sourceRefs: [{ refType: "tool_result", refId: "tool-2" }],
      limitations: [],
      provenance: AGENT,
    };
    const replacement = h.situations.supersede(
      h.projectId,
      h.taskId,
      target.assertionId,
      target.version,
      input,
    );
    const after = h.situations.get(h.projectId, target.assertionId);
    expect(after?.status).toBe("superseded");
    expect(after?.supersededBy).toBe(replacement.assertionId);
    // The old row points at the new one.
    expect(h.stores.situations.rows.get(target.assertionId)?.supersededBy)
      .toBe(replacement.assertionId);

    // Missing, cross-project and cross-task all fail with the same error.
    for (const [projectId, taskId, id] of [
      [h.projectId, h.taskId, "no-such-assertion"],
      [h.otherProjectId, h.otherTaskId, target.assertionId],
      [h.projectId, h.otherTaskId, target.assertionId],
    ] as const) {
      try {
        h.situations.supersede(projectId, taskId, id, target.version, input);
        expect.unreachable("supersede should have failed for " + id);
      } catch (error) {
        expect(errorCode(error)).toBe(SestinaErrorCode.assertion_not_found);
      }
    }
    // An already-superseded target is not unclaimed.
    expectSestinaCode(
      () => {
        h.situations.supersede(
          h.projectId,
          h.taskId,
          target.assertionId,
          after?.version ?? target.version + 1,
          input,
        );
      },
      SestinaErrorCode.validation_failed,
    );
  });

  it("supersede requires the target to be strictly older", () => {
    let currentMs = Date.parse(NOW_ISO);
    const ports = {
      now: () => new Date(currentMs).toISOString(),
      nowMs: () => currentMs,
      newId: () => `id-${currentMs}`,
      redactExcerpt: (excerpt: string) => excerpt,
    };
    const h = makeHarness(ports);
    const target = h.situations.record({
      projectId: h.projectId,
      taskId: h.taskId,
      kind: "reported_fact",
      statement: "old",
      sourceRefs: [{ refType: "tool_result", refId: "tool-1" }],
      limitations: [],
      provenance: AGENT,
    });
    const input = {
      kind: "reported_fact" as const,
      statement: "new",
      sourceRefs: [{ refType: "tool_result", refId: "tool-2" }],
      limitations: [],
      provenance: AGENT,
    };
    // Same instant: NOT strictly older.
    expectSestinaCode(
      () => {
        h.situations.supersede(
          h.projectId,
          h.taskId,
          target.assertionId,
          target.version,
          input,
        );
      },
      SestinaErrorCode.validation_failed,
    );
    // One tick later: allowed.
    currentMs += 1;
    const replacement = h.situations.supersede(
      h.projectId,
      h.taskId,
      target.assertionId,
      target.version,
      input,
    );
    expect(h.situations.get(h.projectId, target.assertionId)?.status).toBe("superseded");
    expect(h.situations.get(h.projectId, replacement.assertionId)?.status).toBe("active");
    void USER;
  });
});
