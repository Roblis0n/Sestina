import { describe, it, expect } from "vitest";
import { ActorProvenanceSchema, SestinaErrorCode } from "@sestina/schema";
import {
  assertDirectUser,
  isPeer,
  peerCeilingStatus,
  peerReportSourceRefs,
} from "../src/peer-provenance.js";
import {
  assertDirectUser as assertDirectUserViaEntry,
  isPeer as isPeerViaEntry,
  peerCeilingStatus as peerCeilingStatusViaEntry,
  peerReportSourceRefs as peerReportSourceRefsViaEntry,
} from "../src/provenance.js";
import { PEER_HOOK, PEER_MCP, USER, expectSestinaCode, makeHarness } from "./harness.js";

// ── Peer provenance demotion + anti-forgery (docs/22 Task 10) ──

describe("Peer provenance (docs/22 Task 10)", () => {
  it("provenance.ts is the plan-named compat entry and re-exports the same rules", () => {
    // docs/22 lists src/provenance.ts in the Task 10 file plan; the module
    // must expose the identical peer-demotion surface as peer-provenance.ts.
    expect(assertDirectUserViaEntry).toBe(assertDirectUser);
    expect(isPeerViaEntry).toBe(isPeer);
    expect(peerCeilingStatusViaEntry).toBe(peerCeilingStatus);
    expect(peerReportSourceRefsViaEntry).toBe(peerReportSourceRefs);
  });

  it("classifies hook and MCP channels as peers, never as direct users", () => {
    expect(isPeer(PEER_MCP)).toBe(true);
    expect(isPeer(PEER_HOOK)).toBe(true);
    expect(isPeer(USER)).toBe(false);
    expect(peerCeilingStatus()).toBe("unverified");
    // A forged directUser flag on a peer channel is structurally rejected by
    // the schema itself (ActorProvenanceSchema refine).
    expect(
      ActorProvenanceSchema.safeParse({ actor: "user", channel: "mcp", directUser: true }).success,
    ).toBe(false);
    expect(
      ActorProvenanceSchema.safeParse({ actor: "user", channel: "host", directUser: true }).success,
    ).toBe(false);
    expect(
      ActorProvenanceSchema.safeParse({ actor: "agent", channel: "mcp", directUser: true }).success,
    ).toBe(false);
  });

  it("peer report refs stay structural (endpoint/message/thread ids)", () => {
    const refs = peerReportSourceRefs({
      endpointId: "ep-1",
      messageId: "msg-1",
      threadId: "th-1",
    });
    expect(refs.map((ref) => ref.refId)).toEqual(["endpoint:ep-1", "message:msg-1", "thread:th-1"]);
    for (const ref of refs) {
      expect(ref.refType).toBe("host_event");
    }
  });

  it("assertDirectUser rejects peers and agents", () => {
    expectSestinaCode(
      () => {
        assertDirectUser(PEER_MCP, "waive");
      },
      SestinaErrorCode.forbidden,
    );
    expectSestinaCode(
      () => {
        assertDirectUser({ actor: "agent", channel: "runtime", directUser: false }, "waive");
      },
      SestinaErrorCode.forbidden,
    );
    // CLI is a direct-user channel.
    expect(() => {
      assertDirectUser({ actor: "user", channel: "cli", directUser: true }, "waive");
    }).not.toThrow();
  });

  it("peer-recorded situation assertions stay reported and never reach confirmed_fact", () => {
    const h = makeHarness();
    const reported = h.situations.record({
      projectId: h.projectId,
      taskId: h.taskId,
      kind: "reported_fact",
      statement: "peer reports the task completed",
      sourceRefs: peerReportSourceRefs({
        endpointId: "ep-1",
        messageId: "msg-1",
        threadId: "th-1",
      }),
      limitations: [],
      provenance: PEER_HOOK,
    });
    expect(reported.kind).toBe("reported_fact");
    expect(reported.provenance.channel).toBe("host");
    h.confirmations.trust(h.projectId, h.taskId, "hook_observation", "hook-1");
    // The only path to confirmed_fact runs through confirm(), which rejects
    // illegal sources; the peer cannot get there.
    expect(() =>
      h.situations.confirm(h.projectId, reported.assertionId, reported.version, {
        sourceType: "hook_observation",
        refId: "hook-1",
        trusted: true,
      }, { actor: "agent", channel: "runtime", directUser: false }),
    ).not.toThrow();
    // A trusted hook observation IS a legal confirmation source - but it is
    // recorded by the confirmer, not promoted from the peer's own record.
    expect(h.situations.get(h.projectId, reported.assertionId)?.kind).toBe("confirmed_fact");
  });
});
