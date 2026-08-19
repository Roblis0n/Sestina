import { describe, expect, it } from "vitest";
import { CLAIM_KINDS, EVIDENCE_KINDS, SequenceIdFactory, parseArgumentClaim, parseArgumentEvidence, parseClaimEvidenceLink, parseMechanismEvidenceLink } from "../src/index.js";

const ids = new SequenceIdFactory(3400); const projectId = ids.create("rprj_"); const artifactId = ids.create("rart_"); const revisionId = ids.create("rrev_"); const claimId = ids.create("rclm_"); const mechanismLinkId = ids.create("rmec_");
const source = { actor: { kind: "user" as const, actorId: "lead" }, authority: "user_recorded" as const, recordedAt: "2026-08-19T11:00:00.000Z" };

describe("Claim–Evidence–Mechanism domain", () => {
  it.each(CLAIM_KINDS)("round-trips claim kind %s through runtime validation", (kind) => {
    expect(parseArgumentClaim({ id: ids.create("rclm_"), projectId, artifactId, revisionId, kind, statement: `${kind} claim`, source, version: 1 })).toMatchObject({ ok: true, value: { kind } });
  });

  it.each(EVIDENCE_KINDS)("round-trips evidence kind %s through runtime validation", (kind) => {
    const value = { id: ids.create("revd_"), projectId, kind, summary: `${kind} evidence`, state: "current", inferenceCapacity: kind === "literature_source" ? "background_only" : "descriptive", ...(kind === "artifact_span" ? { artifactId, revisionId, contentVersionHash: "a".repeat(64) } : {}), source, version: 1 };
    expect(parseArgumentEvidence(value)).toMatchObject({ ok: true, value: { kind } });
  });

  it("keeps unproven/disputed/stale link state distinct from false", () => {
    const evidenceId = ids.create("revd_");
    expect(parseClaimEvidenceLink({ projectId, claimId, evidenceId, role: "supports", status: "unproven", source, version: 1 })).toMatchObject({ ok: true, value: { status: "unproven" } });
    expect(parseMechanismEvidenceLink({ projectId, mechanismLinkId, evidenceId, stepIndex: 0, status: "stale", source, version: 1 })).toMatchObject({ ok: true, value: { status: "stale" } });
  });
});
