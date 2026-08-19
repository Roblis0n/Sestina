import { describe, expect, it } from "vitest";
import {
  NON_DELTA_KINDS,
  SUBSTANTIVE_ARGUMENT_DELTA_KINDS,
  SequenceIdFactory,
  parseArgumentClaim,
  parseArgumentDelta,
  parseMechanismLink,
  parseModelProposedArgumentDelta,
  type ArgumentDelta,
  type ResearchSource,
} from "../src/index.js";

const ids = new SequenceIdFactory(3200);
const projectId = ids.create("rprj_");
const artifactId = ids.create("rart_");
const baselineRevisionId = ids.create("rrev_");
const candidateRevisionId = ids.create("rrev_");
const claimA = ids.create("rclm_");
const claimB = ids.create("rclm_");
const evidenceId = ids.create("revd_");
const expectedDeltaId = ids.create("rbrf_");
const MODEL_SOURCE: ResearchSource = { actor: { kind: "model", provider: "fixture", model: "semantic-reviewer" }, authority: "model_proposed", recordedAt: "2026-08-19T10:00:00.000Z" };
const USER_SOURCE: ResearchSource = { actor: { kind: "user", actorId: "lead" }, authority: "user_confirmed", recordedAt: "2026-08-19T10:00:00.000Z" };

function span(revisionId: string, start: number) {
  return { projectId, artifactId, revisionId, normalizedTextHash: "a".repeat(64), start, end: start + 5, quoteHash: "b".repeat(64), normalizationVersion: "nfkc-lf-v1" as const, indexUnit: "utf16_code_unit" as const };
}

function delta(overrides: Partial<ArgumentDelta> = {}) {
  return {
    id: ids.create("rdlt_"), projectId, artifactId, baselineRevisionId, candidateRevisionId,
    kind: "mechanism_relation", baselineGapSpans: [span(baselineRevisionId, 0)], candidateAdditionSpans: [span(candidateRevisionId, 5)],
    relation: "The condition changes the mediator, which changes the outcome.", supportsExpectedDeltaId: expectedDeltaId,
    evidenceLinkIds: [evidenceId], limitations: ["The direction still requires empirical confirmation"], source: MODEL_SOURCE,
    ...overrides,
  };
}

describe("argument graph primitives", () => {
  it("validates and freezes a Claim and MechanismLink at runtime", () => {
    const claim = parseArgumentClaim({ id: claimA, projectId, artifactId, revisionId: candidateRevisionId, kind: "mechanistic", statement: "The mediator carries the effect.", source: USER_SOURCE });
    expect(claim).toMatchObject({ ok: true, value: { kind: "mechanistic" } });
    if (claim.ok) expect(Object.isFrozen(claim.value)).toBe(true);
    const mechanism = parseMechanismLink({ id: ids.create("rmec_"), projectId, artifactId, revisionId: candidateRevisionId, fromClaimId: claimA, toClaimId: claimB, relation: "mediates", intermediateSteps: ["condition changes mediator", "mediator changes outcome"], source: USER_SOURCE });
    expect(mechanism).toMatchObject({ ok: true, value: { fromClaimId: claimA, toClaimId: claimB } });
  });

  it.each(SUBSTANTIVE_ARGUMENT_DELTA_KINDS)("accepts substantive delta kind %s with a concrete relation", (kind) => {
    expect(parseArgumentDelta(delta({ kind }))).toMatchObject({ ok: true, value: { kind } });
  });

  it.each(NON_DELTA_KINDS)("represents non-delta %s only as no_substantive_delta", (nonDeltaKind) => {
    const result = parseArgumentDelta(delta({ kind: "no_substantive_delta", nonDeltaKind, relation: "No new claim, evidence, boundary, or mechanism relation was added.", evidenceLinkIds: [] }));
    expect(result).toMatchObject({ ok: true, value: { kind: "no_substantive_delta", nonDeltaKind } });
  });

  it("accepts shorter wording that completes a mechanism and rejects complex language without a new relation", () => {
    expect(parseArgumentDelta(delta({ kind: "causal_step_clarification", relation: "Mediator M transmits X to Y." }))).toMatchObject({ ok: true });
    expect(parseArgumentDelta(delta({ kind: "theoretical_contribution", relation: "Uses institutional isomorphism and recursive epistemic performativity." , candidateAdditionSpans: [] }))).toMatchObject({ ok: false });
  });

  it("rejects cross-revision spans, wrong expected-delta IDs and model proposals that impersonate user authority", () => {
    expect(parseArgumentDelta(delta({ candidateAdditionSpans: [span(baselineRevisionId, 0)] }))).toMatchObject({ ok: false });
    expect(parseArgumentDelta(delta({ supportsExpectedDeltaId: ids.create("rdec_") }))).toMatchObject({ ok: false });
    expect(parseModelProposedArgumentDelta(delta({ source: USER_SOURCE }))).toMatchObject({ ok: false, error: { code: "authority_conflict" } });
  });
});
