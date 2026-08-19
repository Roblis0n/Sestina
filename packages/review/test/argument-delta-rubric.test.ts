import { describe, expect, it } from "vitest";
import { SequenceIdFactory, type ResearchSource } from "@sestina/research";
import { createStableTextDocument, createStableTextSpan, validateArgumentDeltaAssessment, validateShallowAbstractionAssessment } from "../src/index.js";

const ids = new SequenceIdFactory(3300);
const projectId = ids.create("rprj_"); const artifactId = ids.create("rart_"); const baselineRevisionId = ids.create("rrev_"); const candidateRevisionId = ids.create("rrev_");
const baseline = createStableTextDocument({ projectId, artifactId, revisionId: baselineRevisionId, text: "X is associated with Y." });
const candidate = createStableTextDocument({ projectId, artifactId, revisionId: candidateRevisionId, text: "X changes M; M then changes Y." });
if (!baseline.ok || !candidate.ok) throw new Error("document fixture failed");
const gap = createStableTextSpan(baseline.value, 0, baseline.value.normalizedText.length); const addition = createStableTextSpan(candidate.value, 0, candidate.value.normalizedText.length);
if (!gap.ok || !addition.ok) throw new Error("span fixture failed");
const source: ResearchSource = { actor: { kind: "model", model: "fixture" }, authority: "model_proposed", recordedAt: "2026-08-19T10:00:00.000Z" };

function substantive() {
  return {
    verdict: "substantive_delta", rationale: "The shorter candidate adds an explicit mediator relation.",
    delta: { id: ids.create("rdlt_"), projectId, artifactId, baselineRevisionId, candidateRevisionId, kind: "mechanism_relation", baselineGapSpans: [gap.value], candidateAdditionSpans: [addition.value], relation: "X changes M and M changes Y", evidenceLinkIds: [], limitations: [], source },
  };
}

describe("Argument Delta semantic rubric", () => {
  it("RED: validates a concrete mechanism relation without producing a depth score", () => {
    const result = validateArgumentDeltaAssessment(substantive(), baseline.value, candidate.value);
    expect(result).toMatchObject({ ok: true, value: { verdict: "substantive_delta" } });
    if (result.ok) expect("depthScore" in result.value).toBe(false);
    expect(JSON.stringify(result)).not.toContain("100");
  });

  it("classifies vocabulary-only, citation name-drop, repetition and length-only changes as no substantive delta", () => {
    for (const nonDeltaKind of ["abstract_vocabulary_only", "citation_name_drop", "repetition", "length_increase_only"] as const) {
      expect(validateArgumentDeltaAssessment({
        verdict: "no_substantive_delta", rationale: "No concrete relation was added.",
        delta: { ...substantive().delta, id: ids.create("rdlt_"), kind: "no_substantive_delta", nonDeltaKind, relation: "No new relation", evidenceLinkIds: [] },
      }, baseline.value, candidate.value)).toMatchObject({ ok: true, value: { verdict: "no_substantive_delta", delta: { nonDeltaKind } } });
    }
  });

  it("rejects relation/spans mismatches and expected-delta references outside the request", () => {
    expect(validateArgumentDeltaAssessment({ ...substantive(), delta: { ...substantive().delta, candidateAdditionSpans: [gap.value] } }, baseline.value, candidate.value)).toMatchObject({ ok: false });
    expect(validateArgumentDeltaAssessment({ ...substantive(), delta: { ...substantive().delta, supportsExpectedDeltaId: ids.create("rbrf_") } }, baseline.value, candidate.value, { expectedDeltaIds: [] })).toMatchObject({ ok: false });
  });

  it("flags shallow abstraction through missing relations, not terminology count", () => {
    expect(validateShallowAbstractionAssessment({
      verdict: "shallow_abstraction", candidateEvidence: [addition.value],
      missingRelations: ["No mechanism connects X to Y", "The cited theory is not linked to the study material"],
      rationale: "Abstract vocabulary is present, but the required mechanism and evidence link are absent.",
      minimalRecovery: { action: "add the missing X → M → Y relation", resumeTarget: "mechanism paragraph" },
    }, candidate.value)).toMatchObject({ ok: true, value: { verdict: "shallow_abstraction" } });
  });
});
