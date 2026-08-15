import { describe, expect, it } from "vitest";
import { CollaborationAuthorityResultSchema } from "@sestina/schema";
import type {
  ActorProvenance,
  CollaborationAuthorityResult,
  HandoffAuthorizationRequest,
  HandoffPreauthorization,
  ProjectId,
  TaskId,
} from "@sestina/schema";
import { resolveCollaborationAuthority } from "../src/collaboration-authority.js";

// ── Deterministic test ids (no randomness) ──
const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function deterministicId(seed: number): string {
  // Numerical Recipes LCG, full period 2^32; top 5 bits extracted per character.
  let x = Math.imul(seed + 1, 0x9e3779b9) >>> 0;
  let out = "";
  for (let i = 0; i < 26; i += 1) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out += CROCKFORD_ALPHABET[(x >>> 27) & 31] ?? "0";
  }
  return out;
}

const NOW = "2026-08-15T12:00:00.000Z";
const PROJECT_ID = deterministicId(1) as ProjectId;
const TASK_ID = deterministicId(2) as TaskId;
const SOURCE_ENDPOINT = deterministicId(10);
const TARGET_ENDPOINT = deterministicId(11);
const DELIVERABLE_A = deterministicId(20);
const DELIVERABLE_B = deterministicId(21);
const EXTRA_DELIVERABLE = deterministicId(22);

function directUser(channel: "desktop" | "cli" = "desktop"): ActorProvenance {
  return { actor: "user", channel, directUser: true };
}

function makeGrant(overrides: Partial<HandoffPreauthorization> = {}): HandoffPreauthorization {
  return {
    schemaVersion: "1.0.0",
    preauthorizationId: deterministicId(100),
    projectId: PROJECT_ID,
    taskId: TASK_ID,
    source: { endpointId: SOURCE_ENDPOINT, host: "codex" },
    target: { endpointId: TARGET_ENDPOINT, host: "claude_code" },
    deliverableIds: [DELIVERABLE_A, DELIVERABLE_B],
    pathScope: ["outputs"],
    actionCategories: ["read", "write"],
    contractVersion: 3,
    status: "active",
    confirmedBy: directUser(),
    confirmedAt: NOW,
    ...overrides,
  };
}

function makeRequest(
  overrides: Partial<HandoffAuthorizationRequest> = {},
): HandoffAuthorizationRequest {
  return {
    projectId: PROJECT_ID,
    taskId: TASK_ID,
    handoffRef: "handoff-1",
    currentContractVersion: 3,
    preauthorizations: [],
    source: { endpointId: SOURCE_ENDPOINT, host: "codex" },
    target: { endpointId: TARGET_ENDPOINT, host: "claude_code" },
    deliverableIds: [DELIVERABLE_A, DELIVERABLE_B],
    requestedPaths: ["outputs/report.md"],
    actionCategories: ["read"],
    now: NOW,
    ...overrides,
  };
}

function makeConfirmation(
  confirmedBy: ActorProvenance = directUser(),
  boundOverrides: {
    handoffRef?: string;
    projectId?: string;
    taskId?: string;
    source?: { endpointId?: string; host: string };
    target?: { endpointId?: string; host: string };
    deliverableIds?: string[];
    requestedPaths?: string[];
    actionCategories?: string[];
  } = {},
): NonNullable<HandoffAuthorizationRequest["userConfirmation"]> {
  return {
    userConfirmationId: deterministicId(300),
    handoffRef: "handoff-1",
    projectId: PROJECT_ID,
    taskId: TASK_ID,
    source: { endpointId: SOURCE_ENDPOINT, host: "codex" },
    target: { endpointId: TARGET_ENDPOINT, host: "claude_code" },
    deliverableIds: [DELIVERABLE_A, DELIVERABLE_B],
    requestedPaths: ["outputs"],
    actionCategories: ["read", "write"],
    confirmedBy,
    confirmedAt: NOW,
    messageRef: "held-handoff-1",
    ...boundOverrides,
  };
}

function expectReasons(result: CollaborationAuthorityResult): string[] {
  if (result.decision === "authorized") {
    throw new Error(`expected a non-authorized decision with reasons, got ${result.decision}`);
  }
  return result.reasons;
}

describe("resolveCollaborationAuthority (Task 9 §九 handoff authority resolution)", () => {
  it("authorizes a precise all-fields preauthorization hit", () => {
    const grant = makeGrant({
      deadline: "2026-08-16T00:00:00.000Z",
      budget: { maxToolCalls: 10 },
    });
    const result = resolveCollaborationAuthority(makeRequest({ preauthorizations: [grant] }));
    // A budget is a cap for policy time (Task 11), not a usage counter — it never
    // blocks the evidence match itself.
    expect(result).toEqual({
      decision: "authorized",
      by: "preauthorization",
      preauthorizationId: grant.preauthorizationId,
    });
  });

  it("authorizes with the first matching preauthorization in array order", () => {
    const firstGrant = makeGrant({ preauthorizationId: deterministicId(101) });
    const secondGrant = makeGrant({ preauthorizationId: deterministicId(102) });

    const inOrder = resolveCollaborationAuthority(
      makeRequest({ preauthorizations: [firstGrant, secondGrant] }),
    );
    expect(inOrder).toEqual({
      decision: "authorized",
      by: "preauthorization",
      preauthorizationId: firstGrant.preauthorizationId,
    });

    const reversed = resolveCollaborationAuthority(
      makeRequest({ preauthorizations: [secondGrant, firstGrant] }),
    );
    expect(reversed).toEqual({
      decision: "authorized",
      by: "preauthorization",
      preauthorizationId: secondGrant.preauthorizationId,
    });
  });

  it("never auto-authorizes any field beyond the grant", () => {
    const overreachCases: [
      label: string,
      overrides: Partial<HandoffAuthorizationRequest>,
      offending: string,
    ][] = [
      [
        "an extra deliverable outside the grant",
        { deliverableIds: [DELIVERABLE_A, DELIVERABLE_B, EXTRA_DELIVERABLE] },
        EXTRA_DELIVERABLE,
      ],
      [
        "a path outside the grant path scope",
        { requestedPaths: ["outputs/report.md", "outside/file.txt"] },
        "outside/file.txt",
      ],
      [
        "an extra action category outside the grant",
        { actionCategories: ["read", "delete"] },
        "delete",
      ],
    ];
    for (const [label, overrides, offending] of overreachCases) {
      const result = resolveCollaborationAuthority(
        makeRequest({ preauthorizations: [makeGrant()], ...overrides }),
      );
      expect(result.decision, label).toBe("needs_user_confirmation");
      const reasons = expectReasons(result);
      expect(reasons.length, label).toBeGreaterThan(0);
      expect(reasons.some((reason) => reason.includes(offending)), label).toBe(true);
    }
  });

  it("requires user confirmation when the grant contractVersion drifted", () => {
    const grant = makeGrant({ contractVersion: 2 });
    const result = resolveCollaborationAuthority(
      makeRequest({ preauthorizations: [grant], currentContractVersion: 3 }),
    );
    expect(result.decision).toBe("needs_user_confirmation");
    const reasons = expectReasons(result);
    expect(
      reasons.some(
        (reason) =>
          reason.includes("contractVersion") && reason.includes("2") && reason.includes("3"),
      ),
    ).toBe(true);
  });

  it("returns no_authority when the grant deadline is expired or exactly the request time", () => {
    const expired = resolveCollaborationAuthority(
      makeRequest({ preauthorizations: [makeGrant({ deadline: "2026-08-15T00:00:00.000Z" })] }),
    );
    expect(expired.decision).toBe("no_authority");
    expect(expectReasons(expired).some((reason) => reason.includes("2026-08-15T00:00:00.000Z"))).toBe(
      true,
    );

    // The match is strict: request.now < grant.deadline.
    const equal = resolveCollaborationAuthority(
      makeRequest({ preauthorizations: [makeGrant({ deadline: NOW })] }),
    );
    expect(equal.decision).toBe("no_authority");
    expect(expectReasons(equal).some((reason) => reason.includes(NOW))).toBe(true);
  });

  it("returns no_authority for superseded or expired preauthorizations", () => {
    const superseded = resolveCollaborationAuthority(
      makeRequest({ preauthorizations: [makeGrant({ status: "superseded" })] }),
    );
    expect(superseded.decision).toBe("no_authority");
    expect(expectReasons(superseded).some((reason) => reason.includes("superseded"))).toBe(true);

    const expired = resolveCollaborationAuthority(
      makeRequest({ preauthorizations: [makeGrant({ status: "expired" })] }),
    );
    expect(expired.decision).toBe("no_authority");
    expect(expectReasons(expired).some((reason) => reason.includes("expired"))).toBe(true);

    const supersededBy = resolveCollaborationAuthority(
      makeRequest({
        preauthorizations: [makeGrant({ supersededBy: deterministicId(555) })],
      }),
    );
    expect(supersededBy.decision).toBe("no_authority");
    expect(expectReasons(supersededBy).some((reason) => reason.includes("superseded by"))).toBe(
      true,
    );
  });

  it("returns no_authority for cross-project, cross-task, host, and endpoint mismatches", () => {
    const mismatchedGrants = [
      makeGrant({ projectId: deterministicId(999) as ProjectId }),
      makeGrant({ taskId: deterministicId(998) as TaskId }),
      makeGrant({ source: { endpointId: SOURCE_ENDPOINT, host: "claude_code" } }),
      makeGrant({ source: { endpointId: deterministicId(777), host: "codex" } }),
      makeGrant({ target: { endpointId: TARGET_ENDPOINT, host: "codex" } }),
    ];
    for (const grant of mismatchedGrants) {
      const result = resolveCollaborationAuthority(makeRequest({ preauthorizations: [grant] }));
      expect(result.decision).toBe("no_authority");
      expect(expectReasons(result).length).toBeGreaterThan(0);
    }
  });

  it("returns no_authority with reasons when no evidence matches at all", () => {
    const result = resolveCollaborationAuthority(makeRequest());
    expect(result.decision).toBe("no_authority");
    expect(expectReasons(result).length).toBeGreaterThan(0);
  });

  it("treats a grant without endpointId as host-level and matches project-relative path prefixes", () => {
    const hostLevel = makeGrant({ source: { host: "codex" }, target: { host: "claude_code" } });
    const result = resolveCollaborationAuthority(makeRequest({ preauthorizations: [hostLevel] }));
    expect(result).toEqual({
      decision: "authorized",
      by: "preauthorization",
      preauthorizationId: hostLevel.preauthorizationId,
    });

    // "outputs" covers "outputs", "outputs/" (normalized), and "outputs/report.md".
    const prefixGrant = makeGrant({ pathScope: ["outputs", "data"] });
    const covered = resolveCollaborationAuthority(
      makeRequest({
        preauthorizations: [prefixGrant],
        requestedPaths: ["outputs", "outputs/", "outputs/report.md", "data/nested/x.csv"],
      }),
    );
    expect(covered.decision).toBe("authorized");

    // Trailing slashes on granted paths are normalized: "data/" === "data".
    const slashGrant = makeGrant({ pathScope: ["data/"] });
    const slashCovered = resolveCollaborationAuthority(
      makeRequest({ preauthorizations: [slashGrant], requestedPaths: ["data/x"] }),
    );
    expect(slashCovered.decision).toBe("authorized");

    // "." covers the whole project.
    const wholeProject = makeGrant({ pathScope: ["."] });
    const whole = resolveCollaborationAuthority(
      makeRequest({ preauthorizations: [wholeProject], requestedPaths: ["anything/at/all.txt"] }),
    );
    expect(whole.decision).toBe("authorized");

    // Prefix matching is boundary-safe: a sibling prefix is not covered...
    const sibling = resolveCollaborationAuthority(
      makeRequest({
        preauthorizations: [makeGrant()],
        requestedPaths: ["outputs-backup/x.txt"],
      }),
    );
    expect(sibling.decision).toBe("needs_user_confirmation");
    expect(
      expectReasons(sibling).some((reason) => reason.includes("outputs-backup/x.txt")),
    ).toBe(true);

    // ...and a leading "./" is a distinct path (only trailing slashes are normalized).
    const dotSlash = resolveCollaborationAuthority(
      makeRequest({ preauthorizations: [makeGrant()], requestedPaths: ["./outputs/x"] }),
    );
    expect(dotSlash.decision).toBe("needs_user_confirmation");

    // A scope consisting only of slashes covers nothing.
    const slashOnly = makeGrant({ pathScope: ["//"] });
    const slashOnlyResult = resolveCollaborationAuthority(
      makeRequest({ preauthorizations: [slashOnly], requestedPaths: ["/x"] }),
    );
    expect(slashOnlyResult.decision).toBe("needs_user_confirmation");
    expect(expectReasons(slashOnlyResult).some((reason) => reason.includes("/x"))).toBe(true);
  });

  it("never authorizes a request path that escapes the project via a \"..\" segment", () => {
    // A whole-project grant covers nothing outside the project root, so a
    // ".." request must fall through to confirmation.
    const wholeProject = makeGrant({ pathScope: ["."] });
    const grantResult = resolveCollaborationAuthority(
      makeRequest({
        preauthorizations: [wholeProject],
        requestedPaths: ["../secrets/keys.md"],
      }),
    );
    expect(grantResult.decision).toBe("needs_user_confirmation");
    expect(expectReasons(grantResult).join("\n")).toContain("does not cover path");

    // A one-shot confirmation granting the whole project must not release it
    // either — the requested path escapes the project entirely.
    const confirmation = makeConfirmation(directUser(), { requestedPaths: ["."] });
    const confirmationResult = resolveCollaborationAuthority(
      makeRequest({ userConfirmation: confirmation, requestedPaths: ["../secrets/keys.md"] }),
    );
    expect(confirmationResult.decision).toBe("no_authority");
  });

  it("never treats a grant path containing a \"..\" segment as covering anything", () => {
    const traversalGrant = makeGrant({ pathScope: ["outputs/.."] });
    const result = resolveCollaborationAuthority(
      makeRequest({
        preauthorizations: [traversalGrant],
        requestedPaths: ["outputs/../elsewhere/x.txt"],
      }),
    );
    expect(result.decision).toBe("needs_user_confirmation");
    expect(expectReasons(result).join("\n")).toContain("does not cover path");
  });

  it("never authorizes vague grants and requires user confirmation for them", () => {
    const vagueCases = [
      { grant: makeGrant({ deliverableIds: [] }), field: "deliverableIds" },
      { grant: makeGrant({ pathScope: [] }), field: "pathScope" },
      { grant: makeGrant({ actionCategories: [] }), field: "actionCategories" },
    ];
    for (const { grant, field } of vagueCases) {
      const result = resolveCollaborationAuthority(makeRequest({ preauthorizations: [grant] }));
      expect(result.decision).toBe("needs_user_confirmation");
      expect(expectReasons(result).some((reason) => reason.includes(field))).toBe(true);
    }

    // Even an empty request is never authorized by a vague grant.
    const emptyRequest = resolveCollaborationAuthority(
      makeRequest({
        preauthorizations: [makeGrant({ pathScope: [] })],
        deliverableIds: [],
        requestedPaths: [],
        actionCategories: [],
      }),
    );
    expect(emptyRequest.decision).toBe("needs_user_confirmation");
  });

  it("a valid user confirmation releases only the current held handoff", () => {
    const request = makeRequest({ userConfirmation: makeConfirmation() });
    const result = resolveCollaborationAuthority(request);
    expect(result.decision).toBe("authorized");
    if (result.decision !== "authorized") {
      throw new Error("expected authorized");
    }
    expect(result.by).toBe("user_confirmation");
    expect(result.preauthorizationId).toBeUndefined();
    expect(Object.hasOwn(result, "preauthorizationId")).toBe(false);

    // No permanence: a second handoff without its own confirmation is not authorized.
    const second = resolveCollaborationAuthority(makeRequest());
    expect(second.decision).toBe("no_authority");

    // The confirmation also releases a handoff whose grant overreached — the direct
    // user wins over the preauthorization evidence.
    const overreachRequest = makeRequest({
      preauthorizations: [makeGrant({ actionCategories: ["read"] })],
      actionCategories: ["read", "write"],
      userConfirmation: makeConfirmation(),
    });
    expect(resolveCollaborationAuthority(overreachRequest)).toEqual({
      decision: "authorized",
      by: "user_confirmation",
    });
  });

  it("never authorizes a confirmation copied from a different held handoff", () => {
    // A confirmation is one-shot evidence for ONE held handoff. A copied or
    // replayed confirmation must not release a different handoff, even when
    // its provenance is a genuine direct user.
    const copiedCases: [
      label: string,
      boundOverrides: Parameters<typeof makeConfirmation>[1],
      requestOverrides: Partial<HandoffAuthorizationRequest>,
    ][] = [
      [
        "different handoffRef",
        { handoffRef: "handoff-1" },
        { handoffRef: "handoff-2" },
      ],
      [
        "different project",
        { projectId: deterministicId(400) },
        { projectId: PROJECT_ID },
      ],
      [
        "different task",
        { taskId: deterministicId(401) },
        { taskId: TASK_ID },
      ],
      [
        "different target endpoint",
        { target: { endpointId: deterministicId(402), host: "claude_code" } },
        { target: { endpointId: TARGET_ENDPOINT, host: "claude_code" } },
      ],
      [
        "extra deliverable beyond the confirmed handoff",
        { deliverableIds: [DELIVERABLE_A] },
        { deliverableIds: [DELIVERABLE_A, DELIVERABLE_B] },
      ],
      [
        "path outside the confirmed handoff",
        { requestedPaths: ["outputs"] },
        { requestedPaths: ["../secrets/keys.md"] },
      ],
      [
        "action category beyond the confirmed handoff",
        { actionCategories: ["read"] },
        { actionCategories: ["read", "delete"] },
      ],
    ];
    for (const [label, boundOverrides, requestOverrides] of copiedCases) {
      const result = resolveCollaborationAuthority(
        makeRequest({
          userConfirmation: makeConfirmation(directUser(), boundOverrides),
          ...requestOverrides,
        }),
      );
      expect(result.decision, label).not.toBe("authorized");
      expect(expectReasons(result).length, label).toBeGreaterThan(0);
    }
  });

  it("never authorizes a peer-forged directUser confirmation", () => {
    // Bypass the schema refine on purpose: these objects can only exist via a cast
    // or a deserialization path that skipped validation. The resolver must refuse.
    const peerForgedHost = { actor: "user", channel: "host", directUser: true } as ActorProvenance;
    const peerForgedMcp = { actor: "user", channel: "mcp", directUser: true } as ActorProvenance;
    const agentForgedDesktop = {
      actor: "agent",
      channel: "desktop",
      directUser: true,
    } as ActorProvenance;

    for (const forged of [peerForgedHost, peerForgedMcp, agentForgedDesktop]) {
      const result = resolveCollaborationAuthority(
        makeRequest({ userConfirmation: makeConfirmation(forged) }),
      );
      expect(result.decision).toBe("no_authority");
      expect(expectReasons(result).length).toBeGreaterThan(0);
    }
  });

  it("never lets a preauthorization with forged peer provenance match", () => {
    const peerForgedHost = { actor: "user", channel: "host", directUser: true } as ActorProvenance;
    const agentForgedDesktop = {
      actor: "agent",
      channel: "desktop",
      directUser: true,
    } as ActorProvenance;

    const forgedHostGrant = makeGrant({ confirmedBy: peerForgedHost });
    const forgedAgentGrant = makeGrant({
      confirmedBy: agentForgedDesktop,
      preauthorizationId: deterministicId(601),
    });
    for (const forged of [forgedHostGrant, forgedAgentGrant]) {
      const result = resolveCollaborationAuthority(makeRequest({ preauthorizations: [forged] }));
      expect(result.decision).toBe("no_authority");
      expect(expectReasons(result).length).toBeGreaterThan(0);
    }

    // A forged grant is invisible evidence: it can neither authorize nor mask a
    // valid grant later in the array.
    const valid = makeGrant({ preauthorizationId: deterministicId(602) });
    const mixed = resolveCollaborationAuthority(
      makeRequest({ preauthorizations: [forgedHostGrant, valid] }),
    );
    expect(mixed).toEqual({
      decision: "authorized",
      by: "preauthorization",
      preauthorizationId: valid.preauthorizationId,
    });
  });

  it("is deterministic for the same request", () => {
    const request = makeRequest({
      preauthorizations: [
        makeGrant({ deadline: "2026-08-15T00:00:00.000Z" }),
        makeGrant({ deliverableIds: [DELIVERABLE_A], preauthorizationId: deterministicId(700) }),
        makeGrant({ preauthorizationId: deterministicId(701), deadline: "2026-08-16T00:00:00.000Z" }),
      ],
    });
    const first = resolveCollaborationAuthority(request);
    const second = resolveCollaborationAuthority(request);
    expect(second).toEqual(first);
    // Dead and overreaching grants earlier in the array never mask the first full match.
    expect(first).toEqual({
      decision: "authorized",
      by: "preauthorization",
      preauthorizationId: deterministicId(701),
    });
  });

  it("always returns a result that parses via CollaborationAuthorityResultSchema", () => {
    const hugeExtras = Array.from({ length: 200 }, (_, index) => deterministicId(1000 + index));
    const cases: CollaborationAuthorityResult[] = [
      resolveCollaborationAuthority(
        makeRequest({
          preauthorizations: [makeGrant({ deadline: "2026-08-16T00:00:00.000Z" })],
        }),
      ),
      resolveCollaborationAuthority(makeRequest({ userConfirmation: makeConfirmation() })),
      resolveCollaborationAuthority(
        makeRequest({ preauthorizations: [makeGrant({ deliverableIds: [DELIVERABLE_A] })] }),
      ),
      resolveCollaborationAuthority(makeRequest()),
      resolveCollaborationAuthority(
        makeRequest({
          preauthorizations: [makeGrant({ deadline: "2026-08-15T00:00:00.000Z" })],
        }),
      ),
      // A huge overreach must still produce schema-valid (<= 500 char) reasons.
      resolveCollaborationAuthority(
        makeRequest({ preauthorizations: [makeGrant()], deliverableIds: hugeExtras }),
      ),
    ];
    for (const result of cases) {
      expect(CollaborationAuthorityResultSchema.parse(result)).toEqual(result);
    }

    const huge = resolveCollaborationAuthority(
      makeRequest({ preauthorizations: [makeGrant()], deliverableIds: hugeExtras }),
    );
    expect(huge.decision).toBe("needs_user_confirmation");
    const reasons = expectReasons(huge);
    expect(reasons.length).toBeGreaterThan(0);
    for (const reason of reasons) {
      expect(reason.length).toBeLessThanOrEqual(500);
    }
  });
});
