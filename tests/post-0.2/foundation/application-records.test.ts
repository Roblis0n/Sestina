import { it, expect } from "vitest";
import { parseKernelReview, parseKernelAssessment, parseArgumentEvidence, kernelHash } from "@sestina/research";
import { draft, ids, at } from "../kernel-fixtures.js";

it("G4: a saved effect retains its exact payload and inspectable preview after decoding", () => {
  const review = draft(ids.create("rprj_"), 1);
  const preview = { payload: { kind: "record_only", outcome: "deferred", reason: "Await new material." }, baseProjectStateRevision: 1,
    objects: [], unchangedObjects: [], compensation: "Create a new Review; history is immutable.", affectedReviews: [], affectedManifests: [] };
  const effectDraft = { effectId: ids.create("rpev_"), effectKind: "record_only", previewHash: kernelHash(preview),
    baseProjectStateRevision: 1, objectVersions: [], payload: preview.payload, preview,
    authorityCommandId: ids.create("rpev_"), allocatedIds: [], preparedAt: at, actorId: "synthetic-owner" };
  expect(parseKernelReview({ ...review, effectDraft }).effectDraft).toEqual(effectDraft);
});

it("G4: evidence retains its stated provenance instead of silently discarding it", () => {
  const provenance = { citation: "Synthetic laboratory record A", locator: "observation 3" };
  const parsed = parseArgumentEvidence({ id: ids.create("revd_"), projectId: ids.create("rprj_"), kind: "literature_source",
    summary: "Synthetic observation only.", state: "current", inferenceCapacity: "descriptive", provenance,
    source: { actor: { kind: "user", actorId: "synthetic-owner" }, authority: "user_recorded", recordedAt: at }, version: 1 });
  expect(parsed.ok && JSON.parse(JSON.stringify(parsed.value)).provenance).toEqual(provenance);
});

it("G5: protocol integrity fields survive independently without semantic promotion", () => {
  const assessment = { availability: "received", requestBound: false, schemaValidated: true, quotesLocated: false,
    claimFieldsParsed: true, semanticCorrectness: "unproven", publicSummary: "Binding is not valid.",
    envelope: { schemaVersion: "2.0.0", request_binding_valid: false, response_schema_valid: true,
      quoted_span_integrity_valid: false, provider_assessment_available: true } };
  expect(parseKernelAssessment(assessment)).toEqual(assessment);
});
